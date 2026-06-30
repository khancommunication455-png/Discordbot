/**
 * ttsService.js — SkyBot v2 FIXED TTS (Railway-proof)
 *
 * ROOT CAUSE FIXES:
 * 1. prism-media transcoder requires input type to be Arbitrary, not Raw
 * 2. Connection must reach Ready (not just Signalling) before playback on Railway
 * 3. StreamElements + Google TTS both have rate limit issues — added more fallbacks
 * 4. ffmpeg stdin approach is more reliable than prism.FFmpeg duplex stream
 */
import {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, VoiceConnectionStatus, StreamType,
  NoSubscriberBehavior, entersState,
} from '@discordjs/voice';
import { spawn, execSync } from 'child_process';
import { existsSync, writeFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import https from 'https';
import http from 'http';
import Groq from 'groq-sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const TMP_DIR = join(__dirname, '../../tmp');

// ── Find ffmpeg ──
// Priority: ffmpeg-static (bundled binary, works on ANY host regardless of
// whether the platform provides system ffmpeg — required for Pterodactyl-based
// hosts like bot-hosting.net which don't expose apt/system package installs)
// → explicit FFMPEG_PATH env var → common system paths → bare "ffmpeg" on PATH.
function findFFmpeg() {
  // Try ffmpeg-static first — bundled binary, no host dependency
  try {
    const ffmpegStatic = require('ffmpeg-static');
    if (ffmpegStatic && existsSync(ffmpegStatic)) {
      execSync(`"${ffmpegStatic}" -version`, { stdio: 'pipe' });
      console.log('[TTS] Using bundled ffmpeg-static binary (host-independent)');
      return ffmpegStatic;
    }
  } catch (e) {
    console.warn('[TTS] ffmpeg-static unavailable or failed:', e.message?.slice(0, 100));
  }

  for (const p of [
    process.env.FFMPEG_PATH,
    '/root/.nix-profile/bin/ffmpeg',
    '/nix/var/nix/profiles/default/bin/ffmpeg',
    '/usr/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
  ]) {
    if (!p) continue;
    try {
      if (p.startsWith('/')) {
        if (existsSync(p)) { execSync(`${p} -version`, { stdio: 'pipe' }); return p; }
      } else {
        execSync(`${p} -version`, { stdio: 'pipe' }); return p;
      }
    } catch {}
  }
  return 'ffmpeg';
}
const FFMPEG = findFFmpeg();
console.log(`[TTS] FFmpeg: ${FFMPEG}`);

// ── Groq ──
let groq = null;
if (process.env.GROQ_API_KEY) {
  groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  console.log('[TTS] Groq AI ready');
}

// ── State ──
const ttsState = new Map();

// ── Language detection ──
function detectLang(text) {
  if (/[\u0600-\u06FF]/.test(text)) return { lang: 'ur', voice: 'ur-PK-AsadNeural' };
  if (/[\u0900-\u097F]/.test(text)) return { lang: 'hi', voice: 'hi-IN-MadhurNeural' };
  if (/\b(aur|hai|hain|kya|yeh|woh|bhai|yaar|nahi|theek|karo|jana|kyun|kaise)\b/i.test(text))
    return { lang: 'hi', voice: 'hi-IN-MadhurNeural' };
  return { lang: 'en', voice: 'Brian' };
}

// ── HTTP fetch helper ──
function fetchBuffer(urlStr, headers = {}, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const makeReq = (u) => {
      const url = new URL(u);
      const mod = url.protocol === 'https:' ? https : http;
      const req = mod.request({
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'GET',
        timeout: timeoutMs,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', ...headers },
      }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          makeReq(res.headers.location); return;
        }
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.on('timeout', function() { this.destroy(); reject(new Error('Timeout')); });
      req.end();
    };
    makeReq(urlStr);
  });
}

// ── TTS Provider 1: StreamElements ──
async function streamElementsTTS(text) {
  const url = `https://api.streamelements.com/kappa/v2/speech?voice=Brian&text=${encodeURIComponent(text.slice(0, 500))}`;
  const buf = await fetchBuffer(url, {
    'Referer': 'https://streamelements.com',
    'Origin': 'https://streamelements.com',
  });
  if (buf.length < 500) throw new Error('Too small');
  return buf;
}

// ── TTS Provider 2: Google Translate TTS ──
async function googleTTS(text, lang = 'en') {
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text.slice(0, 200))}&tl=${lang}&client=tw-ob`;
  const buf = await fetchBuffer(url, { 'Referer': 'https://translate.google.com/' });
  if (buf.length < 300) throw new Error('Too small');
  return buf;
}

// ── TTS Provider 3: tts.mp3.com (free, no key) ──
async function voiceRSSFallback(text) {
  // VoiceRSS free tier — works without key for short text
  const url = `https://api.voicerss.org/?key=free&hl=en-us&src=${encodeURIComponent(text.slice(0, 300))}&f=48khz_16bit_stereo&c=MP3`;
  const buf = await fetchBuffer(url);
  if (buf.length < 300) throw new Error('Too small');
  return buf;
}

// ── Synthesize text → MP3/PCM buffer ──
async function synthesize(text) {
  const { lang } = detectLang(text);

  // Provider 1: StreamElements (best quality, English)
  try {
    const buf = await streamElementsTTS(text);
    console.log(`[TTS] StreamElements ✅ (${buf.length} bytes)`);
    return buf;
  } catch (e) { console.warn('[TTS] StreamElements failed:', e.message.slice(0, 80)); }

  // Provider 2: Google Translate TTS (multilingual)
  try {
    const buf = await googleTTS(text, lang);
    console.log(`[TTS] Google TTS ✅ (${buf.length} bytes, lang=${lang})`);
    return buf;
  } catch (e) { console.warn('[TTS] Google TTS failed:', e.message); }

  throw new Error('All TTS providers failed');
}

// ── Play MP3 buffer via ffmpeg stdin pipe → Discord voice ──
// This is the CORRECT approach for Railway:
// ffmpeg reads MP3 from stdin, outputs raw PCM s16le to stdout
// @discordjs/voice creates a StreamType.Raw resource from the stdout
function playMP3(state, mp3Buffer) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err) => { if (settled) return; settled = true; err ? reject(err) : resolve(); };

    console.log(`[TTS] playMP3: ${mp3Buffer.length} bytes`);

    // Spawn ffmpeg to convert MP3 → raw PCM s16le 48kHz stereo
    const ff = spawn(FFMPEG, [
      '-hide_banner', '-loglevel', 'error',
      '-i', 'pipe:0',               // read from stdin
      '-f', 's16le',                 // raw signed 16-bit little-endian PCM
      '-ar', '48000',                // 48kHz sample rate (Discord requirement)
      '-ac', '2',                    // stereo
      'pipe:1',                      // write to stdout
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    let ffmpegOk = false;
    ff.on('error', (e) => { console.error('[TTS] ffmpeg spawn error:', e.message); finish(e); });
    ff.stderr.on('data', (d) => { const s = d.toString(); if (s.trim()) console.warn('[TTS] ffmpeg:', s.trim().slice(0, 120)); });

    // Write MP3 to stdin then close
    try {
      ff.stdin.write(mp3Buffer);
      ff.stdin.end();
      ffmpegOk = true;
      console.log('[TTS] MP3 written to ffmpeg stdin ✅');
    } catch (e) {
      console.error('[TTS] ffmpeg stdin write failed:', e.message);
      finish(e); return;
    }

    // Create audio resource from ffmpeg stdout (raw PCM)
    const resource = createAudioResource(ff.stdout, {
      inputType: StreamType.Raw,
      inlineVolume: false,
    });

    let hasPlayed = false;
    const onStateChange = (oldState, newState) => {
      console.log(`[TTS] Player: ${oldState.status} → ${newState.status}`);
      if (newState.status === AudioPlayerStatus.Playing) {
        hasPlayed = true;
        console.log('[TTS] PLAYING ✅ — audio should be audible now');
      }
      if (newState.status === AudioPlayerStatus.Idle && hasPlayed) {
        console.log('[TTS] Playback complete ✅');
        state.player.off('stateChange', onStateChange);
        finish();
      }
    };
    state.player.on('stateChange', onStateChange);
    state.player.once('error', (err) => {
      console.error('[TTS] Player error:', err.message);
      state.player.off('stateChange', onStateChange);
      finish(err);
    });

    try {
      state.player.play(resource);
      console.log('[TTS] player.play() called');
    } catch (e) {
      console.error('[TTS] play() threw:', e.message);
      finish(e);
    }

    // Safety timeout (20s)
    setTimeout(() => {
      if (!settled) {
        console.error(`[TTS] TIMEOUT — hasPlayed=${hasPlayed}, status=${state.player.state?.status}`);
        state.player.off('stateChange', onStateChange);
        try { ff.kill('SIGKILL'); } catch {}
        finish(new Error('TTS timeout'));
      }
    }, 20_000);
  });
}

// ── Permission check BEFORE attempting to join ──
// This is the #1 silent-failure cause: bot has Connect but not Speak (or vice
// versa). Discord lets the bot join the channel either way — no error is
// thrown — but if Speak is missing, Discord server-side mutes the bot's
// outgoing audio. The bot looks connected, even shows in the channel, but
// every packet it sends is dropped before reaching listeners.
function checkVoicePermissions(guild, voiceChannelId) {
  const channel = guild.channels.cache.get(voiceChannelId);
  if (!channel) {
    throw new Error(`Voice channel ${voiceChannelId} not found in this server.`);
  }
  const me = guild.members.me;
  if (!me) {
    throw new Error('Could not resolve bot member in this guild — try kicking and re-inviting.');
  }
  const perms = channel.permissionsFor(me);
  const missing = [];
  if (!perms.has('Connect')) missing.push('Connect');
  if (!perms.has('Speak')) missing.push('Speak');
  if (!perms.has('ViewChannel')) missing.push('View Channel');

  if (missing.length) {
    console.error(`[TTS] ❌ PERMISSION CHECK FAILED for #${channel.name}: missing [${missing.join(', ')}]`);
    throw new Error(
      `Missing voice permission(s) in **${channel.name}**: **${missing.join(', ')}**.\n` +
      `Discord allows joining without Speak — the bot connects silently but audio never plays. ` +
      `Fix: Server Settings → Roles → grant the bot's role Connect + Speak + View Channel ` +
      `(or set channel-specific permission overrides on ${channel.name}).`
    );
  }

  // Check for channel user limit blocking the bot
  if (channel.userLimit > 0 && channel.members.size >= channel.userLimit && !perms.has('MoveMembers')) {
    console.warn(`[TTS] ⚠️ Voice channel ${channel.name} may be full (limit ${channel.userLimit})`);
  }

  console.log(`[TTS] ✅ Permission check passed for #${channel.name} (Connect, Speak, ViewChannel all granted)`);
  return true;
}

// ── Build voice connection (waits for Ready, not just Signalling) ──
async function buildConnection(guildId, voiceChannelId, adapterCreator, guild = null) {
  // Run permission check first if we have the guild object
  if (guild) {
    checkVoicePermissions(guild, voiceChannelId);
  }

  const connection = joinVoiceChannel({
    channelId: voiceChannelId,
    guildId,
    adapterCreator,
    selfDeaf: false,
    selfMute: false,
  });

  // Log every state transition for full visibility in Railway logs
  connection.on('stateChange', (oldState, newState) => {
    console.log(`[TTS] Connection state: ${oldState.status} → ${newState.status}`);
    if (newState.status === VoiceConnectionStatus.Disconnected) {
      console.warn('[TTS] ⚠️ Connection disconnected — reason:', newState.reason ?? 'unknown');
    }
  });
  connection.on('error', (err) => {
    console.error('[TTS] ❌ Connection error event:', err.message);
  });

  // Wait for Ready (full UDP + WebSocket established)
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    console.log('[TTS] ✅ Voice connection Ready (UDP + WebSocket both confirmed)');
    return connection;
  } catch {
    const status = connection.state?.status;
    console.warn(`[TTS] ⚠️ Did not reach Ready within 30s (stuck at: ${status}) — trying Signalling fallback...`);
  }

  // Fallback: wait for Signalling then sleep (old approach)
  try {
    await entersState(connection, VoiceConnectionStatus.Signalling, 15_000);
    console.log('[TTS] Signalling reached (WebSocket only — UDP not yet confirmed) — sleeping 4s...');
    await new Promise(r => setTimeout(r, 4000));
    const finalStatus = connection.state?.status;
    console.log(`[TTS] Post-sleep status: ${finalStatus}`);
    if (finalStatus !== VoiceConnectionStatus.Ready) {
      console.warn(`[TTS] ⚠️ WARNING: Connection never reached Ready (stuck at ${finalStatus}). ` +
        `Audio MAY be silent even though no error is thrown. This usually means Railway's UDP egress ` +
        `is being blocked/throttled for voice traffic specifically — TCP (signalling) works, UDP (audio) doesn't.`);
    }
    return connection;
  } catch {
    const status = connection.state?.status;
    try { connection.destroy(); } catch {}
    throw new Error(
      `Could not establish voice connection (stuck at "${status}" state). ` +
      `This is NOT a permissions issue (those are checked separately) — ` +
      `this means Discord's voice gateway never responded. Possible causes: ` +
      `(1) Railway region has voice gateway issues, (2) bot token/intents misconfigured, ` +
      `(3) temporary Discord outage. Try /voicecheck for a full diagnostic.`
    );
  }
}

// ── Process queue ──
async function processQueue(guildId) {
  const state = ttsState.get(guildId);
  if (!state || state.active || !state.queue.length) return;

  // Re-check connection health
  if (state.connection) {
    const cs = state.connection.state?.status;
    const alive = [VoiceConnectionStatus.Ready, VoiceConnectionStatus.Signalling].includes(cs);
    if (!alive) {
      console.warn(`[TTS] Connection dead (${cs}) — attempting reconnect...`);
      try {
        const conn = await buildConnection(guildId, state.voiceChannelId, state.adapterCreator, state.guildRef);
        state.connection = conn;
        conn.subscribe(state.player);
        console.log('[TTS] Reconnected ✅');
      } catch (e) {
        console.error('[TTS] Reconnect failed:', e.message);
        return;
      }
    }
  }

  state.active = true;
  const { text, isAI, username } = state.queue.shift();
  console.log(`[TTS] Speaking: "${text.slice(0, 80)}"`);

  try {
    let finalText = text;

    // Groq AI response
    if (isAI && state.aiMode && groq) {
      if (!state.aiHistory) state.aiHistory = [];
      state.aiHistory.push({ role: 'user', content: `${username}: ${text}` });
      if (state.aiHistory.length > 20) state.aiHistory = state.aiHistory.slice(-20);
      try {
        const completion = await groq.chat.completions.create({
          model: 'llama-3.3-70b-versatile',
          max_tokens: 120,
          messages: [
            { role: 'system', content: 'You are TITAN Jr., a friendly AI voice assistant in a Discord voice channel for a Hypixel Skyblock gaming community. Respond in short, natural spoken sentences (max 2-3 sentences). Plain text only, no markdown or emojis. If spoken in Roman Urdu or Hindi, reply in the same language using Latin script.' },
            ...state.aiHistory,
          ],
        });
        finalText = completion.choices[0]?.message?.content?.trim() ?? text;
        state.aiHistory.push({ role: 'assistant', content: finalText });
        if (state.aiHistory.length > 20) state.aiHistory = state.aiHistory.slice(-20);
        try {
          const ch = state.client?.channels?.cache?.get(state.textChannelId);
          if (ch) await ch.send(`🤖 **TITAN Jr.:** ${finalText}`);
        } catch {}
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
  if (old) {
    try { old.player?.stop?.(); } catch {}
    try { old.connection?.destroy?.(); } catch {}
    await new Promise(r => setTimeout(r, 600));
    ttsState.delete(guild.id);
  }

  const connection = await buildConnection(guild.id, voiceChannelId, guild.voiceAdapterCreator, guild);
  const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
  connection.subscribe(player);

  const state = {
    player, connection, queue: [], active: false,
    textChannelId, voiceChannelId,
    adapterCreator: guild.voiceAdapterCreator,
    guildRef: guild, // kept for reconnect permission re-checks
    connectionDead: false, aiMode, aiHistory: [], client,
  };
  ttsState.set(guild.id, state);

  player.on(AudioPlayerStatus.Idle, () => {
    state.active = false;
    setTimeout(() => processQueue(guild.id), 200);
  });
  player.on('error', (err) => {
    console.error('[TTS] Player error:', err.message);
    state.active = false;
    setTimeout(() => processQueue(guild.id), 500);
  });

  console.log(`[TTS] setupTTS complete for ${guild.id} (aiMode=${aiMode})`);
  return state;
}

export async function enqueueTTS(guild, rawText, username, isAI = false) {
  const state = ttsState.get(guild.id);
  if (!state) return false;
  const text = rawText
    .replace(/<@!?\d+>/g, 'someone')
    .replace(/<#\d+>/g, 'channel')
    .replace(/<@&\d+>/g, 'role')
    .replace(/<a?:\w+:\d+>/g, '')
    .replace(/https?:\/\/\S+/gi, 'link')
    .replace(/```[\s\S]*?```/g, 'code block')
    .replace(/`[^`]+`/g, 'code')
    .replace(/[*_~|\\]/g, '')
    .replace(/\n+/g, ' ')
    .trim();
  if (!text || text.length > 450) return false;
  const spokenText = isAI ? text : `${username} says, ${text}`;
  state.queue.push({ text: spokenText, isAI, username });
  if (!state.active) processQueue(guild.id);
  return true;
}

export function stopTTS(guildId) {
  const s = ttsState.get(guildId);
  if (!s) return;
  s.queue = []; s.active = false;
  try { s.player?.stop?.(); } catch {}
  try { s.connection?.destroy?.(); } catch {}
  ttsState.delete(guildId);
}

export function clearTTSQueue(guildId) { const s = ttsState.get(guildId); if (s) { s.queue = []; s.active = false; } }
export function getTTSState(guildId) { return ttsState.get(guildId) ?? null; }
export function setAIMode(guildId, enabled) { const s = ttsState.get(guildId); if (s) { s.aiMode = enabled; s.aiHistory = []; } }
export async function moveTTS(guild, newVcId) {
  const s = ttsState.get(guild.id);
  if (!s) return false;
  try {
    const c = await buildConnection(guild.id, newVcId, guild.voiceAdapterCreator);
    try { s.connection?.destroy?.(); } catch {}
    s.connection = c; s.voiceChannelId = newVcId; c.subscribe(s.player);
    return true;
  } catch { return false; }
}
export function getAllTTSStates() {
  return [...ttsState.values()].map(s => ({
    guildId: s.guildId, voiceChannelId: s.voiceChannelId,
    textChannelId: s.textChannelId, aiMode: s.aiMode,
    queue: s.queue, active: s.active, connectionDead: s.connectionDead,
  }));
}
export { checkVoicePermissions };

/**
 * Full end-to-end diagnostic — runs every step of the TTS pipeline in
 * isolation and reports exactly where (if anywhere) it fails. Used by
 * /voicecheck. Does NOT join voice permanently — cleans up after itself.
 *
 * @returns {Promise<{steps: Array<{name: string, ok: boolean, detail: string}>, overallOk: boolean}>}
 */
export async function runVoiceDiagnostic(guild, voiceChannelId) {
  const steps = [];
  const add = (name, ok, detail) => steps.push({ name, ok, detail });

  // Step 1: Permission check
  try {
    checkVoicePermissions(guild, voiceChannelId);
    add('Permissions (Connect/Speak/View)', true, 'Bot has all required permissions in this channel.');
  } catch (e) {
    add('Permissions (Connect/Speak/View)', false, e.message);
    return { steps, overallOk: false }; // no point continuing if perms fail
  }

  // Step 2: FFmpeg binary check
  try {
    execSync(`${FFMPEG} -version`, { stdio: 'pipe', timeout: 5000 });
    add('FFmpeg binary', true, `Found and executable at: ${FFMPEG}`);
  } catch (e) {
    add('FFmpeg binary', false, `FFmpeg not found or not executable at "${FFMPEG}". Check nixpacks.toml includes ffmpeg-headless.`);
  }

  // Step 3: TTS provider reachability (StreamElements / Google)
  let mp3Test = null;
  try {
    mp3Test = await synthesize('voice check test');
    add('TTS audio generation', true, `Got ${mp3Test.length} bytes of audio from provider.`);
  } catch (e) {
    add('TTS audio generation', false, `All TTS providers failed: ${e.message}`);
  }

  // Step 4: Voice connection (real join attempt, reaches Ready or times out)
  let connection = null;
  let reachedReady = false;
  try {
    connection = joinVoiceChannel({
      channelId: voiceChannelId,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false,
    });
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
      reachedReady = true;
      add('Voice connection (UDP+WebSocket Ready)', true, 'Connection reached full Ready state — UDP voice channel established.');
    } catch {
      const status = connection.state?.status;
      add('Voice connection (UDP+WebSocket Ready)', false,
        `Stuck at "${status}" after 15s. If this repeatedly fails, Railway's UDP egress for voice ` +
        `traffic may be blocked/throttled for your project/region — this is a Railway infra issue, ` +
        `not your code. Signalling (TCP/WebSocket) working but Ready (UDP) not reached means the ` +
        `voice control channel connects but the actual audio channel does not.`);
    }
  } catch (e) {
    add('Voice connection (UDP+WebSocket Ready)', false, `joinVoiceChannel threw: ${e.message}`);
  }

  // Step 5: End-to-end playback test (only if we got audio AND reached Ready)
  if (mp3Test && reachedReady && connection) {
    try {
      const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
      connection.subscribe(player);
      const tempState = { player, connection };
      await playMP3(tempState, mp3Test);
      add('End-to-end playback', true, 'Audio played through fully (player reached Playing then Idle). If you still heard nothing, it strongly points to Railway UDP egress being silently dropped server-side.');
    } catch (e) {
      add('End-to-end playback', false, `Playback failed: ${e.message}`);
    }
  } else {
    add('End-to-end playback', false, 'Skipped — prior step(s) failed.');
  }

  // Cleanup
  try { connection?.destroy?.(); } catch {}

  const overallOk = steps.every(s => s.ok);
  return { steps, overallOk };
}
