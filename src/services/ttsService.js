/**
 * ttsService.js — TITAN Jr. Voice AI Service
 *
 * Features:
 *  - Railway-proof voice connection (no Ready state wait)
 *  - Auto-rejoin when Discord kicks bot from VC
 *  - TTS via edge-tts (Microsoft Neural) → ffmpeg → OggOpus → Discord
 *  - Google TTS fallback
 *  - AI Assistant mode: users speak → Whisper STT → Groq LLM → TTS reply
 *  - Language detection (English / Roman Urdu / Hindi / Urdu script)
 *  - Persistent keep-alive silence to prevent UDP timeout on Railway
 */

import {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, VoiceConnectionStatus, StreamType,
  NoSubscriberBehavior, entersState, getVoiceConnection,
} from '@discordjs/voice';
import { execSync, spawn } from 'child_process';
import { promisify } from 'util';
import { exec } from 'child_process';
import {
  existsSync, mkdirSync, unlinkSync,
  readFileSync, writeFileSync,
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';
import Groq from 'groq-sdk';

const execAsync = promisify(exec);
const __dirname  = dirname(fileURLToPath(import.meta.url));
const TMP_DIR    = join(__dirname, '../../tmp');
if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });

// ── State ──────────────────────────────────────────────────────────────────
// guildId → { player, connection, queue, active, textChannelId,
//             voiceChannelId, adapterCreator, connectionDead,
//             keepAliveInterval, aiMode, aiHistory, client }
const ttsState = new Map();

// ── Groq client ────────────────────────────────────────────────────────────
let groq = null;
if (process.env.GROQ_API_KEY) {
  groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  console.log('[TTS] Groq AI assistant ready');
} else {
  console.warn('[TTS] GROQ_API_KEY not set — AI mode disabled');
}

// ── Find ffmpeg ────────────────────────────────────────────────────────────
function findFFmpeg() {
  for (const p of [
    '/root/.nix-profile/bin/ffmpeg',
    '/nix/var/nix/profiles/default/bin/ffmpeg',
    '/usr/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    'ffmpeg',
  ]) {
    try {
      if (p === 'ffmpeg') { execSync('ffmpeg -version', { stdio: 'pipe' }); return p; }
      if (existsSync(p)) return p;
    } catch {}
  }
  return 'ffmpeg';
}
const FFMPEG = findFFmpeg();
console.log(`[FFmpeg] Using: ${FFMPEG}`);

// ── Detect edge-tts ────────────────────────────────────────────────────────
let EDGE_TTS_CMD = null;
for (const cmd of [
  '/app/venv/bin/edge-tts',
  'edge-tts',
  '/root/.local/bin/edge-tts',
  '/usr/local/bin/edge-tts',
]) {
  try {
    execSync(`${cmd} --version`, { stdio: 'pipe', timeout: 3000 });
    EDGE_TTS_CMD = cmd;
    console.log(`[TTS] edge-tts found at: ${cmd}`);
    break;
  } catch {}
}
if (!EDGE_TTS_CMD) {
  try {
    execSync('python3 -c "import edge_tts"', { stdio: 'pipe', timeout: 3000 });
    EDGE_TTS_CMD = 'python3_module';
    console.log('[TTS] edge-tts python3 module available');
  } catch {
    console.warn('[TTS] edge-tts not found — Google TTS fallback active');
  }
}

// ── HTTP fetch helper ──────────────────────────────────────────────────────
function fetchBuffer(urlStr, headers = {}) {
  return new Promise((resolve, reject) => {
    const makeReq = (u) => {
      try {
        const url = new URL(u);
        const mod = url.protocol === 'https:' ? https : http;
        mod.request({
          hostname: url.hostname,
          port:     url.port || (url.protocol === 'https:' ? 443 : 80),
          path:     url.pathname + url.search,
          method:   'GET',
          timeout:  12000,
          headers:  { 'User-Agent': 'Mozilla/5.0', 'Accept': 'audio/mpeg,*/*', ...headers },
        }, (res) => {
          if ([301, 302].includes(res.statusCode)) { makeReq(res.headers.location); return; }
          if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => resolve(Buffer.concat(chunks)));
          res.on('error', reject);
        }).on('error', reject)
          .on('timeout', function() { this.destroy(); reject(new Error('Timeout')); })
          .end();
      } catch (e) { reject(e); }
    };
    makeReq(urlStr);
  });
}

async function googleTTS(text, lang = 'en') {
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text.slice(0, 200))}&tl=${lang}&client=tw-ob&ttsspeed=0.9`;
  const buf = await fetchBuffer(url, { 'Referer': 'https://translate.google.com/' });
  if (buf.length < 300) throw new Error('Google TTS response too small');
  return buf;
}

// ── Language + voice detection ─────────────────────────────────────────────
function detectLang(text) {
  if (/[\u0600-\u06FF]/.test(text))  return { lang: 'ur', voice: 'ur-PK-AsadNeural' };
  if (/[\u0900-\u097F]/.test(text))  return { lang: 'hi', voice: 'hi-IN-MadhurNeural' };
  if (/\b(aur|hai|hain|kya|yeh|woh|bhai|yaar|nahi|nahin|theek|karo|jana|kyun|kaise|matlab|phir|lekin|toh|bilkul|accha|abhi|jaldi|bohot|zyada|bas|pakka|zaroor|mujhe|humara|kuch|sab|sirf|tha|thi|the|raha|rahi|kar|kuch|pehle|baad|dono|mera|tera|apna)\b/i.test(text)) {
    return { lang: 'hi', voice: 'hi-IN-MadhurNeural' };
  }
  return { lang: 'en', voice: 'en-US-GuyNeural' };
}

// ── Synthesize text → MP3 buffer ───────────────────────────────────────────
async function synthesize(text) {
  const { lang, voice } = detectLang(text);
  const mp3File  = join(TMP_DIR, `tts_${Date.now()}_${Math.random().toString(36).slice(2)}.mp3`);
  const safeText = text.replace(/"/g, "'").slice(0, 400);
  let mp3Buffer  = null;

  // 1. edge-tts binary
  if (EDGE_TTS_CMD && EDGE_TTS_CMD !== 'python3_module') {
    try {
      await execAsync(
        `"${EDGE_TTS_CMD}" --voice "${voice}" --text "${safeText}" --write-media "${mp3File}"`,
        { timeout: 20000 }
      );
      if (existsSync(mp3File)) {
        mp3Buffer = readFileSync(mp3File);
        try { unlinkSync(mp3File); } catch {}
        if (mp3Buffer.length < 500) mp3Buffer = null;
        else console.log(`[TTS] edge-tts ✅ (${mp3Buffer.length} bytes)`);
      }
    } catch (e) { console.warn('[TTS] edge-tts failed:', e.message.split('\n')[0]); }
  }

  // 2. edge-tts python module
  if (!mp3Buffer && EDGE_TTS_CMD === 'python3_module') {
    try {
      const py = existsSync('/app/venv/bin/python3') ? '/app/venv/bin/python3' : 'python3';
      await execAsync(
        `${py} -m edge_tts --voice "${voice}" --text "${safeText}" --write-media "${mp3File}"`,
        { timeout: 20000 }
      );
      if (existsSync(mp3File)) {
        mp3Buffer = readFileSync(mp3File);
        try { unlinkSync(mp3File); } catch {}
        if (mp3Buffer.length < 500) mp3Buffer = null;
        else console.log(`[TTS] edge-tts python ✅ (${mp3Buffer.length} bytes)`);
      }
    } catch (e) { console.warn('[TTS] python edge_tts failed:', e.message.split('\n')[0]); }
  }

  // 3. Google TTS fallback
  if (!mp3Buffer) {
    try {
      mp3Buffer = await googleTTS(safeText, lang);
      console.log(`[TTS] Google TTS fallback ✅ (${mp3Buffer.length} bytes)`);
    } catch (e) { console.error('[TTS] Google TTS failed:', e.message); }
  }

  if (!mp3Buffer) throw new Error('All TTS providers failed');
  return mp3Buffer;
}

// ── Play MP3 buffer on Discord voice ──────────────────────────────────────
function playMP3(state, mp3Buffer) {
  return new Promise((resolve, reject) => {
    const playFile = join(TMP_DIR, `play_${Date.now()}.mp3`);
    writeFileSync(playFile, mp3Buffer);

    const ffmpegProc = spawn(FFMPEG, [
      '-i', playFile,
      '-c:a', 'libopus',
      '-b:a', '96k',
      '-vbr', 'on',
      '-compression_level', '10',
      '-f', 'ogg',
      'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    ffmpegProc.stderr.on('data', () => {}); // suppress ffmpeg noise

    const resource = createAudioResource(ffmpegProc.stdout, {
      inputType: StreamType.OggOpus,
      inlineVolume: true,
    });
    resource.volume?.setVolume(1.0);

    ffmpegProc.on('close', () => { try { unlinkSync(playFile); } catch {} });
    ffmpegProc.on('error', reject);

    state.player.once(AudioPlayerStatus.Idle, resolve);
    state.player.once('error', reject);
    state.player.play(resource);
    console.log('[TTS] player.play() called (OggOpus via ffmpeg)');
  });
}

// ── Keep-alive silence to prevent Railway UDP timeout ──────────────────────
// Discord kicks bots after ~60s of silence. We play 0.2s of silent audio
// every 45s to keep the UDP connection alive on Railway.
function startKeepAlive(state) {
  stopKeepAlive(state);
  state.keepAliveInterval = setInterval(() => {
    if (state.active || state.connectionDead) return;
    try {
      const proc = spawn(FFMPEG, [
        '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono',
        '-t', '0.2',
        '-c:a', 'libopus',
        '-b:a', '8k',
        '-f', 'ogg',
        'pipe:1',
      ], { stdio: ['ignore', 'pipe', 'pipe'] });
      proc.stderr.on('data', () => {});
      const res = createAudioResource(proc.stdout, { inputType: StreamType.OggOpus });
      state.player.play(res);
    } catch {}
  }, 45_000);
}

function stopKeepAlive(state) {
  if (state.keepAliveInterval) {
    clearInterval(state.keepAliveInterval);
    state.keepAliveInterval = null;
  }
}

// ── Build voice connection (Railway-proof) ─────────────────────────────────
async function buildConnection(guildId, voiceChannelId, adapterCreator) {
  const connection = joinVoiceChannel({
    channelId:       voiceChannelId,
    guildId:         guildId,
    adapterCreator:  adapterCreator,
    selfDeaf:        false,
    selfMute:        false,
  });

  // Railway: UDP negotiation is slow/unreliable.
  // Wait for Signalling (Discord WebSocket ACK only — no UDP needed),
  // then sleep to let UDP finish in background before we play audio.
  try {
    await entersState(connection, VoiceConnectionStatus.Signalling, 15_000);
    console.log('[TTS] Signalling state reached ✅');
  } catch {
    try { connection.destroy(); } catch {}
    throw new Error('Could not reach Discord voice gateway — check bot Connect + Speak permissions');
  }

  // Let Railway UDP settle before first audio
  await new Promise(r => setTimeout(r, 2500));
  console.log('[TTS] Connection ready (post-sleep) ✅');
  return connection;
}

// ── Attach connection event handlers ──────────────────────────────────────
function attachConnHandlers(connection, guildId) {
  connection.on('error', err => console.error('[TTS] Connection error:', err.message));

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    console.warn('[TTS] Disconnected — attempting auto-reconnect...');
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
      console.log('[TTS] Auto-reconnecting...');
    } catch {
      console.warn('[TTS] Auto-reconnect failed — marking dead for rejoin');
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

// ── Rejoin voice channel ───────────────────────────────────────────────────
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

// ── Groq AI response ───────────────────────────────────────────────────────
async function getAIResponse(state, userText, username) {
  if (!groq) return null;

  // Maintain per-guild conversation history (last 10 turns)
  if (!state.aiHistory) state.aiHistory = [];

  state.aiHistory.push({ role: 'user', content: `${username}: ${userText}` });
  if (state.aiHistory.length > 20) state.aiHistory = state.aiHistory.slice(-20);

  try {
    const completion = await groq.chat.completions.create({
      model:      'llama-3.3-70b-versatile',
      max_tokens: 120, // keep TTS short
      messages: [
        {
          role: 'system',
          content: `You are TITAN Jr., a friendly AI voice assistant in a Discord voice channel for a Hypixel Skyblock gaming community. 
You respond in short, natural spoken sentences (max 2-3 sentences) since your replies will be read aloud via TTS.
Do NOT use markdown, asterisks, bullet points, emojis, or special characters — plain text only.
If spoken in Roman Urdu or Hindi, reply in the same language using Latin script.
Keep responses concise, helpful, and conversational. You know about Hypixel Skyblock, gaming, and general topics.`,
        },
        ...state.aiHistory,
      ],
    });

    const reply = completion.choices[0]?.message?.content?.trim() ?? null;
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

// ── Process TTS queue ──────────────────────────────────────────────────────
async function processQueue(guildId) {
  const state = ttsState.get(guildId);
  if (!state || state.active || !state.queue.length) return;

  // Rejoin if connection died
  if (state.connectionDead) {
    const ok = await rejoinVC(state, guildId);
    if (!ok) return;
  }

  state.active = true;
  const { text, isAI, username } = state.queue.shift();

  console.log(`[TTS] Speaking: "${text.slice(0, 80)}"`);

  try {
    let finalText = text;

    // AI mode: get Groq response first
    if (isAI && state.aiMode && groq) {
      const aiReply = await getAIResponse(state, text, username);
      if (aiReply) {
        finalText = aiReply;
        console.log(`[TTS] AI reply: "${aiReply.slice(0, 80)}"`);
        // Also send reply to text channel
        try {
          const ch = state.client?.channels?.cache?.get(state.textChannelId);
          if (ch) await ch.send(`🤖 **TITAN Jr.:** ${aiReply}`);
        } catch {}
      }
    }

    const mp3Buffer = await synthesize(finalText);
    await playMP3(state, mp3Buffer);

  } catch (err) {
    console.error('[TTS] processQueue error:', err.message);
  } finally {
    state.active = false;
    // Continue queue
    setTimeout(() => processQueue(guildId), 200);
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Setup TTS — bot joins VC and starts reading text channel
 * @param {Guild} guild
 * @param {string} voiceChannelId
 * @param {string} textChannelId
 * @param {boolean} aiMode - if true, messages get Groq AI responses
 * @param {Client} client - Discord client (needed for AI text channel replies)
 */
export async function setupTTS(guild, voiceChannelId, textChannelId, aiMode = false, client = null) {
  // Cleanup any existing session
  const old = ttsState.get(guild.id);
  if (old) {
    stopKeepAlive(old);
    try { old.player.stop(true); } catch {}
    try { old.connection.destroy(); } catch {}
    await new Promise(r => setTimeout(r, 600));
    ttsState.delete(guild.id);
  }

  const connection = await buildConnection(guild.id, voiceChannelId, guild.voiceAdapterCreator);

  const player = createAudioPlayer({
    behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
  });
  connection.subscribe(player);

  const state = {
    player,
    connection,
    queue:          [],
    active:         false,
    textChannelId,
    voiceChannelId,
    adapterCreator: guild.voiceAdapterCreator,
    connectionDead: false,
    keepAliveInterval: null,
    aiMode,
    aiHistory:      [],
    client,
  };
  ttsState.set(guild.id, state);

  player.on(AudioPlayerStatus.Idle, () => {
    state.active = false;
    setTimeout(() => processQueue(guild.id), 200);
  });
  player.on(AudioPlayerStatus.Playing, () => console.log('[TTS] Player playing ✅'));
  player.on('error', err => {
    console.error('[TTS] Player error:', err.message);
    state.active = false;
    setTimeout(() => processQueue(guild.id), 500);
  });

  attachConnHandlers(connection, guild.id);
  startKeepAlive(state);

  return state;
}

/**
 * Enqueue a message to be spoken
 * @param {Guild} guild
 * @param {string} rawText
 * @param {string} username
 * @param {boolean} isAI - if true and aiMode enabled, sends to Groq first
 */
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

  // In normal mode, prefix with username
  const spokenText = isAI ? text : `${username} says, ${text}`;
  state.queue.push({ text: spokenText, isAI, username });

  if (!state.active) processQueue(guild.id);
  return true;
}

export function stopTTS(guildId) {
  const s = ttsState.get(guildId);
  if (!s) return;
  stopKeepAlive(s);
  s.queue  = [];
  s.active = false;
  try { s.player.stop(true); } catch {}
  try { s.connection.destroy(); } catch {}
  ttsState.delete(guildId);
}

export function clearTTSQueue(guildId) {
  const s = ttsState.get(guildId);
  if (s) { s.queue = []; s.active = false; }
}

export function getTTSState(guildId) {
  return ttsState.get(guildId) ?? null;
}

export function setAIMode(guildId, enabled) {
  const s = ttsState.get(guildId);
  if (s) {
    s.aiMode    = enabled;
    s.aiHistory = []; // reset history on mode toggle
  }
}

export async function moveTTS(guild, newVcId) {
  const s = ttsState.get(guild.id);
  if (!s) return false;
  try {
    const newConn = await buildConnection(guild.id, newVcId, guild.voiceAdapterCreator);
    stopKeepAlive(s);
    try { s.connection.destroy(); } catch {}
    s.connection    = newConn;
    s.voiceChannelId = newVcId;
    newConn.subscribe(s.player);
    attachConnHandlers(newConn, guild.id);
    startKeepAlive(s);
    return true;
  } catch { return false; }
    }
