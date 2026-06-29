/**
 * ttsService.js — SkyBot v2 Railway-Proof TTS (OggOpus passthrough)
 *
 * CRITICAL: Uses ffmpeg libopus to encode to OggOpus, then @discordjs/voice
 * passes through pre-encoded opus packets. NO native opus encoder needed.
 *
 * Voice connection: retries Ready up to 3 times (30s each).
 * Before each playback: verifies connection is in Ready state.
 */
import {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, VoiceConnectionStatus, StreamType,
  NoSubscriberBehavior, entersState,
} from '@discordjs/voice';
import { spawn, execSync } from 'child_process';
import { existsSync } from 'fs';
import https from 'https';
import http from 'http';
import Groq from 'groq-sdk';

// ── Find ffmpeg ──
function findFFmpeg() {
  for (const p of ['/root/.nix-profile/bin/ffmpeg', '/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', 'ffmpeg']) {
    try { if (p === 'ffmpeg') { execSync('ffmpeg -version', {stdio:'pipe'}); return p; } if (existsSync(p)) return p; } catch {}
  }
  return 'ffmpeg';
}
const FFMPEG = findFFmpeg();
console.log(`[TTS] FFmpeg: ${FFMPEG}`);

// ── Groq ──
let groq = null;
if (process.env.GROQ_API_KEY) { groq = new Groq({ apiKey: process.env.GROQ_API_KEY }); console.log('[TTS] Groq AI ready'); }

// ── State ──
const ttsState = new Map();

// ── Language detection ──
function detectLang(text) {
  if (/[\u0600-\u06FF]/.test(text)) return { lang: 'ur', voice: 'ur-PK-AsadNeural' };
  if (/[\u0900-\u097F]/.test(text)) return { lang: 'hi', voice: 'hi-IN-MadhurNeural' };
  if (/\b(aur|hai|hain|kya|yeh|woh|bhai|yaar|nahi|theek|karo|jana|kyun|kaise)\b/i.test(text)) return { lang: 'hi', voice: 'hi-IN-MadhurNeural' };
  return { lang: 'en', voice: 'Brian' };
}

// ── HTTP fetch ──
function fetchBuffer(urlStr, headers = {}) {
  return new Promise((resolve, reject) => {
    const makeReq = (u) => {
      const url = new URL(u);
      const mod = url.protocol === 'https:' ? https : http;
      mod.request({ hostname: url.hostname, port: url.port || 443, path: url.pathname + url.search, method: 'GET', timeout: 12000, headers: { 'User-Agent': 'Mozilla/5.0', ...headers } }, (res) => {
        if ([301,302].includes(res.statusCode)) { makeReq(res.headers.location); return; }
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('Timeout')); }).end();
    };
    makeReq(urlStr);
  });
}

// ── Google Translate TTS ──
async function googleTTS(text, lang = 'en') {
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text.slice(0, 200))}&tl=${lang}&client=tw-ob`;
  const buf = await fetchBuffer(url, { 'Referer': 'https://translate.google.com/' });
  if (buf.length < 300) throw new Error('Google TTS response too small');
  return buf;
}

// ── Synthesize text → MP3 buffer ──
async function synthesize(text) {
  const { lang } = detectLang(text);
  // Try StreamElements first
  try {
    const seUrl = `https://api.streamelements.com/kappa/v2/speech?voice=Brian&text=${encodeURIComponent(text.slice(0, 500))}`;
    const buf = await fetchBuffer(seUrl);
    if (buf.length > 500) { console.log(`[TTS] StreamElements ✅ (${buf.length} bytes)`); return buf; }
  } catch (e) { console.warn('[TTS] StreamElements failed:', e.message.slice(0, 80)); }
  // Fallback: Google Translate TTS
  try {
    const buf = await googleTTS(text, lang);
    console.log(`[TTS] Google TTS ✅ (${buf.length} bytes, lang=${lang})`);
    return buf;
  } catch (e) { console.error('[TTS] Google TTS failed:', e.message); }
  throw new Error('All TTS providers failed');
}

// ── Build voice connection (retry Ready, fall back to Signalling) ──
async function buildConnection(guildId, voiceChannelId, adapterCreator) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const connection = joinVoiceChannel({ channelId: voiceChannelId, guildId, adapterCreator, selfDeaf: false, selfMute: false });
    
    // Try Ready first (includes UDP) — 15s timeout
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
      console.log(`[TTS] Ready ✅ (attempt ${attempt}, UDP established)`);
      await new Promise(r => setTimeout(r, 2000));
      return connection;
    } catch {
      console.warn(`[TTS] Ready timed out (attempt ${attempt}/2)`);
    }
    
    // Ready failed — try Signalling (WebSocket only, no UDP needed)
    try {
      await entersState(connection, VoiceConnectionStatus.Signalling, 10_000);
      console.log(`[TTS] Signalling reached (attempt ${attempt}, no UDP — using fallback)`);
      // Extra long grace sleep for UDP to negotiate in background
      await new Promise(r => setTimeout(r, 5000));
      return connection;
    } catch {
      console.warn(`[TTS] Signalling also failed (attempt ${attempt}/2)`);
      try { connection.destroy(); } catch {}
      if (attempt < 2) { console.log('[TTS] Retrying...'); await new Promise(r => setTimeout(r, 3000)); }
    }
  }
  throw new Error('Voice connection failed after 2 attempts — check bot has Connect + Speak permissions in the voice channel');
}

// ── Play MP3 buffer (OggOpus passthrough — NO native encoder) ──
function playMP3(state, mp3Buffer) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err) => { if (settled) return; settled = true; err ? reject(err) : resolve(); };

    console.log(`[TTS] playMP3: ${mp3Buffer.length} bytes`);

    // Spawn ffmpeg to decode MP3 → raw PCM 48k stereo
    // @discordjs/voice encodes PCM → opus using @discordjs/opus
    const ffmpegProc = spawn(FFMPEG, [
      '-i', 'pipe:0', '-analyzeduration', '0', '-loglevel', 'error',
      '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    let pcmBytes = 0, stderrBuf = '';
    ffmpegProc.stdout.on('data', (chunk) => { pcmBytes += chunk.length; if (pcmBytes === chunk.length) console.log('[TTS] First PCM chunk ✅'); });
    ffmpegProc.stderr.on('data', (chunk) => { stderrBuf += chunk.toString(); });
    ffmpegProc.on('error', (err) => { console.error('[TTS] ffmpeg error:', err.message); finish(err); });
    ffmpegProc.on('close', (code) => {
      if (code !== 0 && code !== null) { console.error(`[TTS] ffmpeg exited ${code}: ${stderrBuf.slice(0, 300)}`); finish(new Error(`ffmpeg ${code}`)); return; }
      console.log(`[TTS] ffmpeg done: ${pcmBytes} bytes PCM`);
    });

    try { ffmpegProc.stdin.write(mp3Buffer); ffmpegProc.stdin.end(); console.log('[TTS] MP3 written ✅'); }
    catch (e) { console.error('[TTS] stdin failed:', e.message); finish(e); return; }

    // StreamType.Raw = raw PCM, @discordjs/opus encodes to opus
    const resource = createAudioResource(ffmpegProc.stdout, { inputType: StreamType.Raw, inlineVolume: false });

    // Track player state changes using the CORRECT event: 'stateChange'
    let hasPlayed = false;
    const stateChangeHandler = (oldState, newState) => {
      console.log(`[TTS] Player: ${oldState.status} → ${newState.status}`);
      if (newState.status === AudioPlayerStatus.Playing) {
        hasPlayed = true;
        console.log('[TTS] PLAYING ✅ (audio audible in VC)');
      }
      if (newState.status === AudioPlayerStatus.Idle && hasPlayed) {
        console.log('[TTS] Playback complete');
        state.player.off('stateChange', stateChangeHandler);
        finish();
      }
    };
    state.player.on('stateChange', stateChangeHandler);

    state.player.once('error', (err) => {
      console.error('[TTS] Player error:', err.message);
      state.player.off('stateChange', stateChangeHandler);
      finish(err);
    });

    try {
      state.player.play(resource);
      console.log('[TTS] player.play() (Raw PCM → @discordjs/opus)');
    } catch (e) {
      console.error('[TTS] play() threw:', e.message);
      finish(e);
    }

    setTimeout(() => {
      if (!settled) {
        console.error(`[TTS] TIMEOUT: pcm=${pcmBytes}B, hasPlayed=${hasPlayed}, status=${state.player.state?.status}`);
        if (stderrBuf) console.error('[TTS] ffmpeg stderr:', stderrBuf.slice(0, 300));
        state.player.off('stateChange', stateChangeHandler);
        finish(new Error('TTS timeout'));
      }
    }, 15_000);
  });
}

// ── Process queue ──
async function processQueue(guildId) {
  const state = ttsState.get(guildId);
  if (!state || state.active || !state.queue.length) return;

  // Verify connection is active before playing (Ready OR Signalling)
  if (state.connection) {
    const cs = state.connection.state?.status;
    if (cs !== VoiceConnectionStatus.Ready && cs !== VoiceConnectionStatus.Signalling) {
      console.warn(`[TTS] Connection not active (${cs}), waiting...`);
      try {
        await Promise.race([
          entersState(state.connection, VoiceConnectionStatus.Ready, 15_000),
          entersState(state.connection, VoiceConnectionStatus.Signalling, 15_000),
        ]);
        console.log('[TTS] Connection active ✅');
      } catch {
        console.error('[TTS] Connection not active after 15s — skipping');
        state.active = false;
        return;
      }
    }
  }

  state.active = true;
  const { text, isAI, username } = state.queue.shift();
  console.log(`[TTS] Speaking: "${text.slice(0, 80)}"`);

  try {
    let finalText = text;
    if (isAI && state.aiMode && groq) {
      if (!state.aiHistory) state.aiHistory = [];
      state.aiHistory.push({ role: 'user', content: `${username}: ${text}` });
      if (state.aiHistory.length > 20) state.aiHistory = state.aiHistory.slice(-20);
      try {
        const completion = await groq.chat.completions.create({ model: 'llama-3.3-70b-versatile', max_tokens: 120, messages: [{ role: 'system', content: 'You are TITAN Jr., a friendly AI voice assistant in a Discord voice channel for a Hypixel Skyblock gaming community. Respond in short, natural spoken sentences (max 2-3 sentences). Plain text only, no markdown or emojis. If spoken in Roman Urdu or Hindi, reply in the same language using Latin script.' }, ...state.aiHistory] });
        finalText = completion.choices[0]?.message?.content?.trim() ?? text;
        state.aiHistory.push({ role: 'assistant', content: finalText });
        if (state.aiHistory.length > 20) state.aiHistory = state.aiHistory.slice(-20);
        try { const ch = state.client?.channels?.cache?.get(state.textChannelId); if (ch) await ch.send(`🤖 **TITAN Jr.:** ${finalText}`); } catch {}
      } catch (e) { console.error('[TTS] Groq error:', e.message); }
    }

    const mp3Buffer = await synthesize(finalText);
    await playMP3(state, mp3Buffer);
  } catch (err) {
    console.error('[TTS] processQueue error:', err.message);
  } finally {
    state.active = false;
    setTimeout(() => processQueue(guildId), 200);
  }
}

// ── Public API ──
export async function setupTTS(guild, voiceChannelId, textChannelId, aiMode = false, client = null) {
  const old = ttsState.get(guild.id);
  if (old) { try { old.player?.stop?.(); } catch {}; try { old.connection?.destroy?.(); } catch {}; await new Promise(r => setTimeout(r, 600)); ttsState.delete(guild.id); }

  const connection = await buildConnection(guild.id, voiceChannelId, guild.voiceAdapterCreator);
  const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
  connection.subscribe(player);

  const state = { player, connection, queue: [], active: false, textChannelId, voiceChannelId, adapterCreator: guild.voiceAdapterCreator, connectionDead: false, aiMode, aiHistory: [], client };
  ttsState.set(guild.id, state);

  player.on(AudioPlayerStatus.Idle, () => { state.active = false; setTimeout(() => processQueue(guild.id), 200); });
  player.on('error', (err) => { console.error('[TTS] Player error:', err.message); state.active = false; setTimeout(() => processQueue(guild.id), 500); });

  console.log(`[TTS] setupTTS complete for ${guild.id} (aiMode=${aiMode})`);
  return state;
}

export async function enqueueTTS(guild, rawText, username, isAI = false) {
  const state = ttsState.get(guild.id);
  if (!state) return false;
  const text = rawText.replace(/<@!?\d+>/g, 'someone').replace(/<#\d+>/g, 'channel').replace(/<@&\d+>/g, 'role').replace(/<a?:\w+:\d+>/g, '').replace(/https?:\/\/\S+/gi, 'link').replace(/```[\s\S]*?```/g, 'code block').replace(/`[^`]+`/g, 'code').replace(/[*_~|\\]/g, '').replace(/\n+/g, ' ').trim();
  if (!text || text.length > 450) return false;
  const spokenText = isAI ? text : `${username} says, ${text}`;
  state.queue.push({ text: spokenText, isAI, username });
  if (!state.active) processQueue(guild.id);
  return true;
}

export function stopTTS(guildId) { const s = ttsState.get(guildId); if (!s) return; s.queue = []; s.active = false; try { s.player?.stop?.(); } catch {}; try { s.connection?.destroy?.(); } catch {}; ttsState.delete(guildId); }
export function clearTTSQueue(guildId) { const s = ttsState.get(guildId); if (s) { s.queue = []; s.active = false; } }
export function getTTSState(guildId) { return ttsState.get(guildId) ?? null; }
export function setAIMode(guildId, enabled) { const s = ttsState.get(guildId); if (s) { s.aiMode = enabled; s.aiHistory = []; } }
export async function moveTTS(guild, newVcId) { const s = ttsState.get(guild.id); if (!s) return false; try { const c = await buildConnection(guild.id, newVcId, guild.voiceAdapterCreator); try { s.connection?.destroy?.(); } catch {}; s.connection = c; s.voiceChannelId = newVcId; c.subscribe(s.player); return true; } catch { return false; } }
export function getAllTTSStates() { return [...ttsState.values()].map(s => ({ guildId: s.guildId, voiceChannelId: s.voiceChannelId, textChannelId: s.textChannelId, aiMode: s.aiMode, queue: s.queue, active: s.active, connectionDead: s.connectionDead })); }

// ── Button handler for Copy AH ID (called by interactionCreate) ──
export async function handleButton(interaction, client) { return false; }
