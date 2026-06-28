/**
 * ttsService.js — SkyBot v2 Railway-Proof Discord TTS Service
 * ============================================================
 *
 * Design goals (fixes v1 Railway failure modes):
 *   1. Pure-HTTP TTS providers — NO Python edge-tts, NO native opusscript.
 *      Multi-provider cascading fallback with per-provider retry + timeout.
 *   2. Use prism-media's FFmpeg transcoder to decode MP3 → 48k stereo PCM,
 *      then hand the PCM stream to @discordjs/voice which encodes Opus
 *      internally (works on Railway). NEVER use inlineVolume:true.
 *   3. Railway-aware voice connection: wait for Signalling (WebSocket ACK
 *      only, no UDP) + 2.5s grace sleep for UDP negotiation.
 *   4. Auto-rejoin on Disconnected (5s timeout). Mark dead so the next
 *      queued TTS triggers a rejoin.
 *   5. Keep-alive silence every 45s when idle (prevents UDP timeout /
 *      Discord kicking the bot).
 *   6. Groq AI assistant mode (llama-3.3-70b-versatile, max_tokens 120).
 *   7. Multi-language detection (English / Roman Urdu / Hindi / Urdu script).
 *   8. Telegram-style message cleaning (strip mentions/emoji/code/URLs/md).
 *
 * Self-contained: only external deps are @discordjs/voice, prism-media,
 * discord.js, groq-sdk, and Node built-ins.
 */

import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  StreamType,
  NoSubscriberBehavior,
  entersState,
} from '@discordjs/voice';
import prism from 'prism-media';
import Groq from 'groq-sdk';
import { spawn, execSync } from 'child_process';
import { existsSync } from 'fs';
import https from 'https';
import http from 'http';

// ─── Self-contained color constants (avoid cross-file imports) ────────────
const COLOR = {
  tts: 0x5865F2,
  ai:  0x9B59B6,
  ok:  0x00D4AA,
  err: 0xFF4757,
};

// ─── Per-guild TTS state registry ─────────────────────────────────────────
// guildId → {
//   player, connection, queue, active, textChannelId, voiceChannelId,
//   adapterCreator, connectionDead, keepAliveInterval,
//   aiMode, aiHistory, client, guildId, guildName, startedAt
// }
const ttsState = new Map();

// ─── Groq AI client (lazy init) ───────────────────────────────────────────
let groq = null;
if (process.env.GROQ_API_KEY) {
  try {
    groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    console.log('[TTS] Groq AI assistant ready (llama-3.3-70b-versatile)');
  } catch (e) {
    console.warn('[TTS] Groq init failed:', e.message);
  }
} else {
  console.warn('[TTS] GROQ_API_KEY not set — AI mode unavailable');
}

// ─── FFmpeg binary discovery (Railway nixpacks first) ─────────────────────
/**
 * Locate the FFmpeg binary across common Railway / Linux / dev paths.
 * Falls back to bare `ffmpeg` (resolved from PATH by spawn).
 * @returns {string} Absolute path or 'ffmpeg'
 */
function findFFmpeg() {
  const candidates = [
    '/root/.nix-profile/bin/ffmpeg',        // Railway nixpacks
    '/nix/var/nix/profiles/default/bin/ffmpeg',
    '/usr/bin/ffmpeg',                       // Debian/Ubuntu apt
    '/usr/local/bin/ffmpeg',                 // Manual install
    'ffmpeg',                                // PATH fallback
  ];
  for (const p of candidates) {
    try {
      if (p === 'ffmpeg') {
        execSync('ffmpeg -version', { stdio: 'pipe', timeout: 3000 });
        return p;
      }
      if (existsSync(p)) return p;
    } catch { /* ignore */ }
  }
  return 'ffmpeg';
}

const FFMPEG = findFFmpeg();
// prism-media may consult FFMPEG_PATH; set it explicitly so any internal
// use of prism.FFmpeg picks up our discovered binary.
if (!process.env.FFMPEG_PATH) process.env.FFMPEG_PATH = FFMPEG;
console.log(`[TTS] FFmpeg binary: ${FFMPEG}`);

// ─── Small async helpers ──────────────────────────────────────────────────

/**
 * Race a promise against a timeout — returns the result or rejects.
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} label
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms, label = 'op') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout (${ms}ms)`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── HTTP fetch helper (Node built-in, no axios) ──────────────────────────
/**
 * Fetch a binary buffer from a URL using Node's http/https modules.
 * Follows one level of HTTP 301/302 redirect. Resolves with the body Buffer.
 * @param {string} urlStr
 * @param {Object<string,string>} [headers]
 * @param {number} [timeoutMs=10000]
 * @returns {Promise<Buffer>}
 */
function fetchBuffer(urlStr, headers = {}, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const makeReq = (u) => {
      let url;
      try { url = new URL(u); }
      catch (e) { reject(new Error(`Bad URL: ${u}`)); return; }

      const mod = url.protocol === 'https:' ? https : http;
      const req = mod.request({
        hostname: url.hostname,
        port:     url.port || (url.protocol === 'https:' ? 443 : 80),
        path:     url.pathname + url.search,
        method:   'GET',
        timeout:  timeoutMs,
        headers:  {
          'User-Agent': 'SkyBot/2.0 (Discord TTS)',
          'Accept':     'audio/mpeg, audio/mp3, */*',
          ...headers,
        },
      }, (res) => {
        // Follow a single redirect
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume(); // drain
          makeReq(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} from ${url.hostname}`));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
      req.end();
    };
    makeReq(urlStr);
  });
}

// ─── Language + voice detection ───────────────────────────────────────────
/**
 * Detect language and pick a TTS voice for the given text.
 * Supports English, Urdu script, Devanagari (Hindi), and Roman Urdu/Hindi.
 * @param {string} text
 * @returns {{lang: string, voice: string}}
 */
function detectLang(text) {
  // Arabic-script Urdu
  if (/[\u0600-\u06FF]/.test(text)) return { lang: 'ur', voice: 'ur-PK-AsadNeural' };
  // Devanagari Hindi
  if (/[\u0900-\u097F]/.test(text)) return { lang: 'hi', voice: 'hi-IN-MadhurNeural' };
  // Roman Urdu / Hindi keyword detection.
  // Note: "the" is intentionally excluded — it's an English article and would
  // cause false positives on any English sentence starting with "The ...".
  // We also require 2+ matches to further reduce false positives on English
  // text that happens to contain a single loanword (e.g., "karma", "bas").
  const HINDI_KEYWORDS = /\b(aur|hai|hain|kya|yeh|woh|bhai|yaar|nahi|nahin|theek|karo|jana|kyun|kaise|matlab|phir|lekin|toh|bilkul|accha|abhi|jaldi|bohot|zyada|bas|pakka|zaroor|mujhe|humara|kuch|sab|sirf|tha|thi|raha|rahi|kar)\b/gi;
  const matches = text.match(HINDI_KEYWORDS);
  if (matches && matches.length >= 2) {
    return { lang: 'hi', voice: 'hi-IN-MadhurNeural' };
  }
  // Default English — Brian is StreamElements' default voice
  return { lang: 'en', voice: 'Brian' };
}

// ─── TTS providers (each returns an MP3 Buffer) ───────────────────────────

/**
 * StreamElements TTS — no API key, no rate limit, MP3 response.
 * Most reliable on Railway. Voices are mostly English (Brian, Joanna,
 * Matthew, Raveena for Indian-English accent).
 * @param {string} text
 * @param {string} lang
 * @param {string} voice
 * @returns {Promise<Buffer>}
 */
async function streamElementsTTS(text, lang, voice) {
  // StreamElements lacks native Hindi/Urdu voices — use Raveena (en-IN)
  // for the accent; otherwise prefer the detected voice (Brian default).
  const seVoice = (lang === 'hi' || lang === 'ur') ? 'Raveena' : (voice || 'Brian');
  const url = `https://api.streamelements.com/kappa/v2/speech?voice=${encodeURIComponent(seVoice)}&text=${encodeURIComponent(text.slice(0, 500))}`;
  const buf = await fetchBuffer(url, {}, 9000);
  if (!buf || buf.length < 300) throw new Error('StreamElements response too small');
  return buf;
}

/**
 * Google Translate TTS — supports many languages natively, MP3 response.
 * @param {string} text
 * @param {string} lang
 * @returns {Promise<Buffer>}
 */
async function googleTranslateTTS(text, lang) {
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text.slice(0, 200))}&tl=${lang}&client=tw-ob&ttsspeed=0.95`;
  const buf = await fetchBuffer(url, { Referer: 'https://translate.google.com/' }, 9000);
  if (!buf || buf.length < 300) throw new Error('Google Translate TTS response too small');
  return buf;
}

/**
 * VoiceRSS TTS — only used when VOICERSS_API_KEY is set.
 * @param {string} text
 * @param {string} lang
 * @returns {Promise<Buffer>}
 */
async function voicerssTTS(text, lang) {
  if (!process.env.VOICERSS_API_KEY) {
    throw new Error('VoiceRSS API key not set');
  }
  const hl = lang === 'hi' ? 'hi-in'
           : lang === 'ur' ? 'ur-pk'
           : 'en-us';
  const url = `http://api.voicerss.org/?key=${process.env.VOICERSS_API_KEY}&hl=${hl}&src=${encodeURIComponent(text.slice(0, 500))}&c=MP3&f=48khz_16bit_stereo`;
  const buf = await fetchBuffer(url, {}, 9000);
  if (!buf || buf.length < 300) throw new Error('VoiceRSS response too small');
  return buf;
}

/**
 * Google Dictionary TTS — pronunciation lookup, single-word fallback.
 * Last-resort provider: only useful for short/single-word inputs.
 * @param {string} text
 * @returns {Promise<Buffer>}
 */
async function googleDictionaryTTS(text) {
  const word = text.trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, '');
  if (!word) throw new Error('No valid word for Google Dictionary TTS');
  const url = `https://ssl.gstatic.com/dictionary/static/sounds/oxford/${encodeURIComponent(word)}--_gb_1.mp3`;
  const buf = await fetchBuffer(url, {}, 8000);
  if (!buf || buf.length < 100) throw new Error('Google Dictionary TTS response too small');
  return buf;
}

// ─── Cascading multi-provider synthesis ───────────────────────────────────
/**
 * Synthesize text to an MP3 Buffer via a cascading provider chain.
 * Order: StreamElements → Google Translate → VoiceRSS → Google Dictionary.
 * Each provider gets 2 attempts with an 8s timeout. Failures log a warning
 * and fall through to the next provider. Throws only if every provider fails.
 * @param {string} text
 * @returns {Promise<Buffer>} MP3 buffer
 */
async function synthesize(text) {
  const { lang, voice } = detectLang(text);

  // Build provider chain — VoiceRSS only if key configured
  /** @type {{name: string, fn: () => Promise<Buffer>}[]} */
  const providers = [
    { name: 'StreamElements',    fn: () => streamElementsTTS(text, lang, voice) },
    { name: 'GoogleTranslate',   fn: () => googleTranslateTTS(text, lang) },
    { name: 'VoiceRSS',          fn: () => voicerssTTS(text, lang) },
    { name: 'GoogleDictionary',  fn: () => googleDictionaryTTS(text) },
  ];

  let lastErr = null;
  for (const p of providers) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const buf = await withTimeout(p.fn(), 9000, p.name);
        if (buf && buf.length > 200) {
          console.log(`[TTS] ${p.name} ✅ attempt ${attempt} (${buf.length} bytes, lang=${lang})`);
          return buf;
        }
        throw new Error(`${p.name} returned ${buf ? buf.length : 0} bytes (too small)`);
      } catch (e) {
        lastErr = e;
        console.warn(`[TTS] ${p.name} attempt ${attempt} failed: ${e.message}`);
      }
    }
  }
  throw new Error(`All TTS providers failed — last error: ${lastErr?.message ?? 'unknown'}`);
}

// ─── Decode MP3 → 48k stereo PCM via prism-media FFmpeg transcoder ────────
/**
 * Create a prism-media FFmpeg transcoder that reads MP3 from stdin
 * and emits 16-bit little-endian PCM at 48kHz stereo on stdout.
 * This is the Railway-safe pattern: no inlineVolume, no opusscript.
 * @returns {import('prism-media').FFmpeg}
 */
function createTranscoder() {
  return new prism.FFmpeg({
    args: [
      '-i',            'pipe:0',
      '-analyzeduration', '0',
      '-loglevel',     '0',
      '-f',            's16le',
      '-ar',           '48000',
      '-ac',           '2',
      'pipe:1',
    ],
  });
}

/**
 * Play an MP3 buffer in the guild's voice channel.
 * Pipes MP3 → prism FFmpeg → 48k PCM → @discordjs/voice audio resource.
 * Resolves when the player returns to Idle, rejects on error.
 * @param {Object} state
 * @param {Buffer} mp3Buffer
 * @returns {Promise<void>}
 */
function playMP3(state, mp3Buffer) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      err ? reject(err) : resolve();
    };

    let transcoder;
    try {
      transcoder = createTranscoder();
    } catch (e) {
      console.error('[TTS] FFmpeg transcoder spawn failed:', e.message);
      finish(e);
      return;
    }

    // prism-media's FFmpeg is a Duplex: write MP3 to it, read PCM from it.
    transcoder.on('error', (err) => {
      console.error('[TTS] Transcoder error:', err.message);
      finish(err);
    });

    // Feed the MP3 buffer into the transcoder's stdin.
    try {
      transcoder.write(mp3Buffer);
      transcoder.end();
    } catch (e) {
      console.error('[TTS] Failed to feed transcoder:', e.message);
      finish(e);
      return;
    }

    // Build the audio resource — Raw PCM, NO inlineVolume (Railway-safe).
    const resource = createAudioResource(transcoder, {
      inputType:      StreamType.Raw,
      inlineVolume:   false,  // CRITICAL: avoids opusscript native binding
    });

    state.player.once(AudioPlayerStatus.Idle, () => finish());
    state.player.once('error', (err) => finish(err));

    try {
      state.player.play(resource);
      console.log('[TTS] player.play() called (Raw PCM 48k stereo via prism-media FFmpeg)');
    } catch (e) {
      console.error('[TTS] player.play() threw:', e.message);
      finish(e);
    }
  });
}

// ─── Keep-alive silence (prevent Railway UDP timeout) ─────────────────────
/**
 * Start the keep-alive interval. Every 45s while the bot is idle, plays
 * 0.2s of silence (FFmpeg anullsrc) so Discord doesn't drop the UDP session.
 * @param {Object} state
 */
function startKeepAlive(state) {
  stopKeepAlive(state);
  state.keepAliveInterval = setInterval(() => {
    if (state.active || state.connectionDead) return;
    try {
      const proc = spawn(FFMPEG, [
        '-f',          'lavfi',
        '-i',          'anullsrc=r=48000:cl=stereo',
        '-t',          '0.2',
        '-f',          's16le',
        '-ar',         '48000',
        '-ac',         '2',
        'pipe:1',
      ], { stdio: ['ignore', 'pipe', 'pipe'] });
      proc.stderr.on('data', () => {});  // suppress
      const resource = createAudioResource(proc.stdout, {
        inputType:    StreamType.Raw,
        inlineVolume: false,
      });
      state.player.play(resource);
    } catch (e) {
      console.warn('[TTS] Keep-alive spawn failed:', e.message);
    }
  }, 45_000);
}

/**
 * Stop the keep-alive interval for a state.
 * @param {Object} state
 */
function stopKeepAlive(state) {
  if (state.keepAliveInterval) {
    clearInterval(state.keepAliveInterval);
    state.keepAliveInterval = null;
  }
}

// ─── Voice connection lifecycle (Railway-proof) ───────────────────────────
/**
 * Build a Railway-proof voice connection: join VC, wait for Signalling
 * (WebSocket ACK only, no UDP), then sleep 2.5s to let UDP negotiate.
 * @param {string} guildId
 * @param {string} voiceChannelId
 * @param {Function} adapterCreator
 * @returns {Promise<import('@discordjs/voice').VoiceConnection>}
 */
async function buildConnection(guildId, voiceChannelId, adapterCreator) {
  const connection = joinVoiceChannel({
    channelId:      voiceChannelId,
    guildId,
    adapterCreator,
    selfDeaf:       false,
    selfMute:       false,
  });

  // Wait for Signalling — does NOT require UDP (Ready does, and is slow on Railway).
  try {
    await entersState(connection, VoiceConnectionStatus.Signalling, 15_000);
    console.log('[TTS] Signalling state reached ✅');
  } catch {
    try { connection.destroy(); } catch {}
    throw new Error('Could not reach Discord voice gateway — check bot Connect + Speak permissions');
  }

  // Grace sleep: let Railway's UDP negotiate before first audio frame.
  await sleep(2500);
  console.log('[TTS] Connection ready (post-UDP sleep) ✅');
  return connection;
}

/**
 * Attach Disconnected / Destroyed / error handlers to a connection.
 * On Disconnected, attempts auto-rejoin with a 5s timeout. If that fails,
 * marks the connection dead so the next queued TTS triggers a full rejoin.
 * @param {import('@discordjs/voice').VoiceConnection} connection
 * @param {string} guildId
 */
function attachConnHandlers(connection, guildId) {
  connection.on('error', (err) => {
    console.error('[TTS] Connection error:', err.message);
  });

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    console.warn('[TTS] Disconnected — attempting auto-reconnect (5s)...');
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
      console.log('[TTS] Auto-reconnected ✅');
    } catch {
      console.warn('[TTS] Auto-reconnect failed — marking dead for queue-triggered rejoin');
      try { connection.destroy(); } catch {}
      const s = ttsState.get(guildId);
      if (s) { s.connectionDead = true; s.active = false; }
    }
  });

  connection.on(VoiceConnectionStatus.Destroyed, () => {
    console.warn('[TTS] Connection destroyed — queued messages will trigger rejoin');
    const s = ttsState.get(guildId);
    if (s) { s.connectionDead = true; s.active = false; }
  });
}

/**
 * Rejoin the voice channel after the connection died.
 * @param {Object} state
 * @param {string} guildId
 * @returns {Promise<boolean>}
 */
async function rejoinVC(state, guildId) {
  console.log('[TTS] Rejoining voice channel...');
  state.connectionDead = false;
  try {
    const newConn = await buildConnection(guildId, state.voiceChannelId, state.adapterCreator);
    state.connection = newConn;
    newConn.subscribe(state.player);
    attachConnHandlers(newConn, guildId);
    startKeepAlive(state);
    console.log('[TTS] Rejoined ✅');
    return true;
  } catch (e) {
    console.error('[TTS] Rejoin failed:', e.message);
    state.connectionDead = true;
    return false;
  }
}

// ─── Groq AI assistant ────────────────────────────────────────────────────
/**
 * Get a Groq AI reply for a user message. Maintains per-guild conversation
 * history (last 20 messages). Replies are short (max_tokens=120) and
 * plain-text only for TTS friendliness.
 * @param {Object} state
 * @param {string} userText
 * @param {string} username
 * @returns {Promise<string|null>}
 */
async function getAIResponse(state, userText, username) {
  if (!groq) return null;
  if (!state.aiHistory) state.aiHistory = [];

  state.aiHistory.push({ role: 'user', content: `${username}: ${userText}` });
  if (state.aiHistory.length > 20) state.aiHistory = state.aiHistory.slice(-20);

  const SYSTEM_PROMPT = `You are TITAN Jr., a friendly AI voice assistant in a Discord voice channel for a Hypixel Skyblock gaming community.
Respond in short, natural spoken sentences (max 2-3 sentences) since your replies will be read aloud via TTS.
Do NOT use markdown, asterisks, bullet points, emojis, or special characters — plain text only.
If spoken in Roman Urdu or Hindi, reply in the same language using Latin script.
Keep responses concise, helpful, and conversational. You know about Hypixel Skyblock, gaming, and general topics.`;

  try {
    const completion = await withTimeout(
      groq.chat.completions.create({
        model:      'llama-3.3-70b-versatile',
        max_tokens: 120,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...state.aiHistory,
        ],
      }),
      12_000,
      'Groq',
    );

    const reply = completion.choices?.[0]?.message?.content?.trim() ?? null;
    if (reply) {
      state.aiHistory.push({ role: 'assistant', content: reply });
      if (state.aiHistory.length > 20) state.aiHistory = state.aiHistory.slice(-20);
    }
    return reply;
  } catch (e) {
    console.error('[TTS] Groq error:', e.message);
    return null;
  }
}

// ─── Telegram-style message cleaning ──────────────────────────────────────
/**
 * Strip Discord mentions, channel mentions, role mentions, custom emojis,
 * Unicode emojis, code blocks, inline code, URLs, and markdown formatting
 * from a raw Discord message before sending it to TTS.
 * @param {string} raw
 * @returns {string}
 */
function cleanMessage(raw) {
  return raw
    // User/role/channel mentions → placeholder words
    .replace(/<@!?\d+>/g,        'someone')
    .replace(/<#\d+>/g,          'a channel')
    .replace(/<@&\d+>/g,         'a role')
    // Custom Discord emojis (animated + static)
    .replace(/<a?:\w+:\d+>/g,    '')
    // Unicode emoji (basic ranges — covers most common emoji)
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}]/gu, '')
    // URLs → "link"
    .replace(/https?:\/\/\S+/gi, 'link')
    // Code blocks (triple backtick) and inline code
    .replace(/```[\s\S]*?```/g,  'code block')
    .replace(/`[^`]+`/g,         'code')
    // Markdown formatting chars
    .replace(/[*_~|>\\]/g,       '')
    // Collapse whitespace + newlines
    .replace(/\s+/g,             ' ')
    .trim();
}

// ─── Queue processing ─────────────────────────────────────────────────────
/**
 * Process the next TTS queue item for a guild. Handles connection-dead
 * rejoin, AI mode (Groq → text channel + TTS), and synthesis → playback.
 * @param {string} guildId
 */
async function processQueue(guildId) {
  const state = ttsState.get(guildId);
  if (!state || state.active || !state.queue.length) return;

  // Rejoin if the connection was marked dead.
  if (state.connectionDead) {
    const ok = await rejoinVC(state, guildId);
    if (!ok) return;
  }

  state.active = true;
  const { text, isAI, username } = state.queue.shift();

  console.log(`[TTS] Speaking: "${text.slice(0, 80)}${text.length > 80 ? '...' : ''}"`);

  try {
    let finalText = text;

    // AI mode: route through Groq for a generated reply.
    if (isAI && state.aiMode && groq) {
      const aiReply = await getAIResponse(state, text, username);
      if (aiReply) {
        finalText = aiReply;
        console.log(`[TTS] AI reply: "${aiReply.slice(0, 80)}${aiReply.length > 80 ? '...' : ''}"`);
        // Post reply to the bound text channel.
        try {
          const ch = state.client?.channels?.cache?.get(state.textChannelId);
          if (ch && ch.send) await ch.send(`🤖 **TITAN Jr.:** ${aiReply}`);
        } catch (e) {
          console.warn('[TTS] Failed to post AI reply to text channel:', e.message);
        }
      } else {
        finalText = "Sorry, I couldn't think of a reply right now.";
      }
    }

    const mp3Buffer = await synthesize(finalText);
    await playMP3(state, mp3Buffer);
  } catch (err) {
    console.error('[TTS] processQueue error:', err.message);
    // If FFmpeg spawn itself failed, attempt a rejoin to recover the VC.
    if (/spawn|ENOENT|transcoder/i.test(err.message)) {
      console.warn('[TTS] FFmpeg error — triggering VC rejoin for recovery');
      const s = ttsState.get(guildId);
      if (s) s.connectionDead = true;
    }
  } finally {
    state.active = false;
    // Pump the next queued item shortly.
    setTimeout(() => processQueue(guildId), 200);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Setup TTS for a guild: join the voice channel, create the audio player,
 * start the keep-alive, and bind to a text channel. Cleans up any prior
 * session for the same guild before starting fresh.
 * @param {import('discord.js').Guild} guild
 * @param {string} voiceChannelId
 * @param {string} textChannelId
 * @param {boolean} [aiMode=false] - if true, enqueued messages get Groq AI responses
 * @param {import('discord.js').Client} [client=null] - Discord client (for AI text-channel replies)
 * @returns {Promise<Object>} the new TTS state
 */
export async function setupTTS(guild, voiceChannelId, textChannelId, aiMode = false, client = null) {
  // Tear down any existing session for this guild first.
  const old = ttsState.get(guild.id);
  if (old) {
    stopKeepAlive(old);
    try { old.player.stop(true); } catch {}
    try { old.connection.destroy(); } catch {}
    await sleep(600);
    ttsState.delete(guild.id);
  }

  const connection = await buildConnection(guild.id, voiceChannelId, guild.voiceAdapterCreator);

  // CRITICAL: Use NoSubscriberBehavior.Play, NOT Pause.
  // With Pause, the player auto-pauses if the voice connection's subscription
  // isn't fully active when play() is called — this manifests as
  // "Player status: autopaused" and NO audio comes out (the #1 TTS bug).
  // With Play, the player keeps playing even if the subscription is momentarily
  // missing, and audio reaches Discord once the subscription catches up.
  const player = createAudioPlayer({
    behaviors: { noSubscriber: NoSubscriberBehavior.Play },
  });
  connection.subscribe(player);

  const state = {
    guildId:           guild.id,
    guildName:         guild.name ?? 'unknown',
    startedAt:         Date.now(),
    player,
    connection,
    queue:             [],
    active:            false,
    textChannelId,
    voiceChannelId,
    adapterCreator:    guild.voiceAdapterCreator,
    connectionDead:    false,
    keepAliveInterval: null,
    aiMode,
    aiHistory:         [],
    client,
  };
  ttsState.set(guild.id, state);

  player.on(AudioPlayerStatus.Idle, () => {
    state.active = false;
    setTimeout(() => processQueue(guild.id), 200);
  });
  player.on(AudioPlayerStatus.Playing, () => {
    // Only log on first play; the keep-alive also trips this.
  });
  player.on('error', (err) => {
    console.error('[TTS] Player error:', err.message);
    state.active = false;
    setTimeout(() => processQueue(guild.id), 500);
  });

  attachConnHandlers(connection, guild.id);
  startKeepAlive(state);

  console.log(`[TTS] setupTTS complete for guild ${guild.id} (aiMode=${aiMode})`);
  return state;
}

/**
 * Enqueue a message to be spoken in the guild's voice channel. Cleans the
 * raw text (strips mentions/emoji/code/URLs/markdown) before queuing.
 * Non-AI messages are prefixed with "<username> says,". AI-mode messages
 * are routed through Groq and the reply is spoken instead.
 * @param {import('discord.js').Guild} guild
 * @param {string} rawText
 * @param {string} username
 * @param {boolean} [isAI=false]
 * @returns {Promise<boolean>} true if queued, false if no active session or text invalid
 */
export async function enqueueTTS(guild, rawText, username, isAI = false) {
  const state = ttsState.get(guild.id);
  if (!state) return false;

  const text = cleanMessage(rawText);
  if (!text || text.length > 450) return false;

  // AI mode: send the cleaned user text as-is (Groq gets context via username).
  // Normal mode: prefix with username so listeners know who spoke.
  const spokenText = isAI ? text : `${username} says, ${text}`;
  state.queue.push({ text: spokenText, isAI, username });

  if (!state.active) processQueue(guild.id);
  return true;
}

/**
 * Stop TTS for a guild: stop player, destroy connection, clear queue,
 * remove state. The bot leaves the voice channel.
 * @param {string} guildId
 */
export function stopTTS(guildId) {
  const s = ttsState.get(guildId);
  if (!s) return;
  stopKeepAlive(s);
  s.queue = [];
  s.active = false;
  try { s.player.stop(true); } catch {}
  try { s.connection.destroy(); } catch {}
  ttsState.delete(guildId);
  console.log(`[TTS] stopTTS for guild ${guildId}`);
}

/**
 * Clear the TTS queue for a guild (does not stop the current utterance
 * or leave the voice channel).
 * @param {string} guildId
 */
export function clearTTSQueue(guildId) {
  const s = ttsState.get(guildId);
  if (s) {
    s.queue = [];
    s.active = false;
  }
}

/**
 * Get the raw TTS state object for a guild (or null).
 * @param {string} guildId
 * @returns {Object|null}
 */
export function getTTSState(guildId) {
  return ttsState.get(guildId) ?? null;
}

/**
 * Toggle AI assistant mode for a guild. Resets conversation history.
 * @param {string} guildId
 * @param {boolean} enabled
 */
export function setAIMode(guildId, enabled) {
  const s = ttsState.get(guildId);
  if (s) {
    s.aiMode = enabled;
    s.aiHistory = [];  // reset history on mode toggle
    console.log(`[TTS] AI mode ${enabled ? 'enabled' : 'disabled'} for guild ${guildId}`);
  }
}

/**
 * Move the bot to a new voice channel in the same guild. Reuses the
 * existing audio player and queue. Returns false if no active session
 * or the new connection fails.
 * @param {import('discord.js').Guild} guild
 * @param {string} newVcId
 * @returns {Promise<boolean>}
 */
export async function moveTTS(guild, newVcId) {
  const s = ttsState.get(guild.id);
  if (!s) return false;
  try {
    const newConn = await buildConnection(guild.id, newVcId, guild.voiceAdapterCreator);
    stopKeepAlive(s);
    try { s.connection.destroy(); } catch {}
    s.connection = newConn;
    s.voiceChannelId = newVcId;
    newConn.subscribe(s.player);
    attachConnHandlers(newConn, guild.id);
    startKeepAlive(s);
    console.log(`[TTS] Moved to VC ${newVcId} for guild ${guild.id}`);
    return true;
  } catch (e) {
    console.error('[TTS] moveTTS failed:', e.message);
    return false;
  }
}

/**
 * Get a serializable snapshot of all active TTS states (for the dashboard).
 * Returns an array of plain objects — never exposes live sockets/streams.
 * @returns {Array<Object>}
 */
export function getAllTTSStates() {
  const out = [];
  for (const [guildId, s] of ttsState.entries()) {
    out.push({
      guildId,
      guildName:      s.guildName,
      voiceChannelId: s.voiceChannelId,
      textChannelId:  s.textChannelId,
      aiMode:         s.aiMode,
      queueLength:    s.queue.length,
      active:         s.active,
      connectionDead: s.connectionDead,
      startedAt:      s.startedAt,
      uptimeMs:       Date.now() - s.startedAt,
    });
  }
  return out;
}

// ─── Exports for testing / external probing ───────────────────────────────
export const _internals = {
  detectLang,
  cleanMessage,
  synthesize,
  findFFmpeg,
  fetchBuffer,
};
