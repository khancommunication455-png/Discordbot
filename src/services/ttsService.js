/**
 * ttsService.js — TTS for Railway
 * Uses edge-tts (Microsoft Edge Neural TTS) installed via Python venv
 * Audio piped via ffmpeg for Discord voice
 */
import {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, VoiceConnectionStatus, StreamType, NoSubscriberBehavior,
  entersState,
} from '@discordjs/voice';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import {
  existsSync, mkdirSync, unlinkSync, readFileSync,
  writeFileSync,
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';

const execAsync = promisify(exec);
const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP_DIR   = join(__dirname, '../../tmp');
if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });

const ttsState = new Map();

// ── Find ffmpeg ────────────────────────────────────────────────────────────
function findFFmpeg() {
  const candidates = [
    '/usr/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/root/.nix-profile/bin/ffmpeg',
    '/nix/var/nix/profiles/default/bin/ffmpeg',
    'ffmpeg',
  ];
  for (const c of candidates) {
    try {
      if (c === 'ffmpeg') {
        execSync('ffmpeg -version', { stdio: 'pipe' });
        return c;
      }
      if (existsSync(c)) return c;
    } catch {}
  }
  return 'ffmpeg';
}

// ── Detect edge-tts ────────────────────────────────────────────────────────
let EDGE_TTS_CMD = null;
try {
  const { execSync } = await import('child_process');
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
    execSync('python3 -c "import edge_tts"', { stdio: 'pipe', timeout: 3000 });
    EDGE_TTS_CMD = 'python3_module';
    console.log('[TTS] edge-tts python3 module available');
  }
} catch {
  console.warn('[TTS] edge-tts not found, Google TTS fallback will be used');
}

// ── Google TTS fallback ────────────────────────────────────────────────────
function fetchBuffer(urlStr, headers = {}) {
  return new Promise((resolve, reject) => {
    const makeReq = (u) => {
      try {
        const url = new URL(u);
        const mod = url.protocol === 'https:' ? https : http;
        const req = mod.request({
          hostname: url.hostname,
          port:     url.port || (url.protocol === 'https:' ? 443 : 80),
          path:     url.pathname + url.search,
          method:   'GET',
          timeout:  12000,
          headers:  { 'User-Agent': 'Mozilla/5.0', 'Accept': 'audio/mpeg,*/*', ...headers },
        }, (res) => {
          if (res.statusCode === 301 || res.statusCode === 302) { makeReq(res.headers.location); return; }
          if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => resolve(Buffer.concat(chunks)));
          res.on('error', reject);
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
        req.end();
      } catch (e) { reject(e); }
    };
    makeReq(urlStr);
  });
}

async function googleTTS(text, lang = 'en') {
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text.slice(0, 200))}&tl=${lang}&client=tw-ob&ttsspeed=0.9`;
  const buf = await fetchBuffer(url, { 'Referer': 'https://translate.google.com/' });
  if (buf.length < 300) throw new Error('Google TTS empty');
  return buf;
}

// ── Language detection ─────────────────────────────────────────────────────
function detectLang(text) {
  if (/[\u0600-\u06FF]/.test(text)) return { lang: 'ur', voice: 'ur-PK-AsadNeural' };
  if (/[\u0900-\u097F]/.test(text)) return { lang: 'hi', voice: 'hi-IN-MadhurNeural' };
  if (/\b(aur|hai|hain|kya|yeh|woh|bhai|yaar|nahi|nahin|theek|karo|jana|kyun|kaise|matlab|phir|lekin|toh|bilkul|inshallah|mashallah|accha|abhi|jaldi|bohot|zyada|bas|pakka|zaroor|mujhe|humara|kuch|sab|sirf)\b/i.test(text)) {
    return { lang: 'hi', voice: 'hi-IN-MadhurNeural' };
  }
  return { lang: 'en', voice: 'en-US-GuyNeural' };
}

// ── Synthesize MP3 → PCM buffer ready for Discord ─────────────────────────
async function synthesize(text) {
  const { lang, voice } = detectLang(text);
  const ts       = Date.now();
  const mp3File  = join(TMP_DIR, `tts_${ts}.mp3`);
  const safeText = text.replace(/"/g, "'").slice(0, 400);

  // Generate MP3 via edge-tts
  let mp3Buffer = null;

  if (EDGE_TTS_CMD && EDGE_TTS_CMD !== 'python3_module') {
    try {
      await execAsync(`"${EDGE_TTS_CMD}" --voice "${voice}" --text "${safeText}" --write-media "${mp3File}"`, { timeout: 15000 });
      if (existsSync(mp3File)) {
        mp3Buffer = readFileSync(mp3File);
        unlinkSync(mp3File);
        if (mp3Buffer.length < 500) mp3Buffer = null;
        else console.log(`[TTS] edge-tts ✅ (${mp3Buffer.length} bytes)`);
      }
    } catch (e) { console.warn('[TTS] edge-tts failed:', e.message.split('\n')[0]); }
  }

  if (!mp3Buffer && EDGE_TTS_CMD === 'python3_module') {
    try {
      const pyCmd = existsSync('/app/venv/bin/python3') ? '/app/venv/bin/python3' : 'python3';
      await execAsync(`${pyCmd} -m edge_tts --voice "${voice}" --text "${safeText}" --write-media "${mp3File}"`, { timeout: 15000 });
      if (existsSync(mp3File)) {
        mp3Buffer = readFileSync(mp3File);
        unlinkSync(mp3File);
        if (mp3Buffer.length < 500) mp3Buffer = null;
      }
    } catch (e) { console.warn('[TTS] python3 edge_tts failed:', e.message.split('\n')[0]); }
  }

  if (!mp3Buffer) {
    try {
      mp3Buffer = await googleTTS(safeText, lang);
      console.log(`[TTS] Google TTS fallback ✅ (${mp3Buffer.length} bytes)`);
    } catch (e) { console.error('[TTS] Google TTS failed:', e.message); }
  }

  if (!mp3Buffer) throw new Error('All TTS providers failed');
  return mp3Buffer;
}

// ── Voice connection ───────────────────────────────────────────────────────
export async function setupTTS(guild, voiceChannelId, textChannelId) {
  const old = ttsState.get(guild.id);
  if (old) {
    try { old.player.stop(true); } catch {}
    try { old.connection.destroy(); } catch {}
    await new Promise(r => setTimeout(r, 800));
    ttsState.delete(guild.id);
  }

  const connection = joinVoiceChannel({
    channelId: voiceChannelId, guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false, selfMute: false,
  });

  await new Promise(r => setTimeout(r, 3000));

  const player = createAudioPlayer({
    behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
  });
  connection.subscribe(player);

  const state = { player, connection, queue: [], active: false, textChannelId, voiceChannelId };
  ttsState.set(guild.id, state);

  player.on(AudioPlayerStatus.Idle, () => {
    console.log('[TTS] Player idle — processing next');
    state.active = false;
    setTimeout(() => processQueue(guild.id), 300);
  });
  player.on(AudioPlayerStatus.Playing, () => console.log('[TTS] Player playing ✅'));
  player.on('error', err => {
    console.error('[TTS] Player error:', err.message);
    state.active = false;
    setTimeout(() => processQueue(guild.id), 500);
  });
  connection.on('error', err => console.error('[TTS] Connection error:', err.message));

  // Auto-reconnect on disconnect instead of wiping state
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    console.warn('[TTS] Disconnected — attempting reconnect...');
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
      // Reconnecting — do nothing, let it recover
    } catch {
      // Failed to reconnect — clean up
      console.warn('[TTS] Reconnect failed, destroying connection');
      try { connection.destroy(); } catch {}
      ttsState.delete(guild.id);
    }
  });

  connection.on(VoiceConnectionStatus.Destroyed, () => {
    console.warn('[TTS] Connection destroyed');
    ttsState.delete(guild.id);
  });

  return state;
}

// ── Queue ──────────────────────────────────────────────────────────────────
export async function enqueueTTS(guild, rawText, username) {
  const state = ttsState.get(guild.id);
  if (!state) return false;

  const text = rawText
    .replace(/<@!?\d+>/g, 'someone').replace(/<#\d+>/g, 'channel')
    .replace(/<@&\d+>/g, 'role').replace(/<a?:\w+:\d+>/g, '')
    .replace(/https?:\/\/\S+/gi, 'link').replace(/```[\s\S]*?```/g, 'code')
    .replace(/`[^`]+`/g, 'code').replace(/[*_~|\\]/g, '')
    .replace(/\n+/g, ' ').trim();

  if (!text || text.length > 400) return false;
  state.queue.push(`${username} says, ${text}`);
  if (!state.active) processQueue(guild.id);
  return true;
}

async function processQueue(guildId) {
  const state = ttsState.get(guildId);
  if (!state || state.active || !state.queue.length) return;

  const text   = state.queue.shift();
  state.active = true;
  console.log(`[TTS] Speaking: "${text.slice(0, 60)}"`);

  try {
    const mp3Buffer = await synthesize(text);

    // Write MP3 to disk
    const playFile = join(TMP_DIR, `play_${Date.now()}.mp3`);
    writeFileSync(playFile, mp3Buffer);

    // Use ffmpeg to transcode MP3 → OggOpus stream directly.
    // Feeding OggOpus means @discordjs/voice never needs to re-encode,
    // so opusscript (pure-JS fallback) is bypassed entirely.
    const ffmpegBin = findFFmpeg();
    const { spawn } = await import('child_process');
    const ffmpegProc = spawn(ffmpegBin, [
      '-i', playFile,
      '-c:a', 'libopus',
      '-b:a', '96k',
      '-vbr', 'on',
      '-f', 'ogg',
      'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    ffmpegProc.stderr.on('data', () => {}); // suppress ffmpeg logs

    const resource = createAudioResource(ffmpegProc.stdout, {
      inputType: StreamType.OggOpus,
      inlineVolume: true,
    });
    resource.volume?.setVolume(1.0);

    // Cleanup file after ffmpeg exits
    ffmpegProc.on('close', () => {
      try { unlinkSync(playFile); } catch {}
    });

    state.player.play(resource);
    console.log('[TTS] player.play() called (OggOpus via ffmpeg)');

  } catch (err) {
    console.error('[TTS] processQueue error:', err.message);
    state.active = false;
    setTimeout(() => processQueue(guildId), 300);
  }
}

export function stopTTS(guildId) {
  const s = ttsState.get(guildId);
  if (!s) return;
  s.queue = []; s.active = false;
  try { s.player.stop(true); } catch {}
  try { s.connection.destroy(); } catch {}
  ttsState.delete(guildId);
}
export function clearTTSQueue(guildId) {
  const s = ttsState.get(guildId);
  if (s) { s.queue = []; s.active = false; }
}
export function getTTSState(guildId) { return ttsState.get(guildId) ?? null; }
export async function moveTTS(guild, newVcId) {
  const s = ttsState.get(guild.id);
  if (!s) return false;
  try {
    const conn = joinVoiceChannel({
      channelId: newVcId, guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator, selfDeaf: false,
    });
    await new Promise(r => setTimeout(r, 1000));
    try { s.connection.destroy(); } catch {}
    s.connection = conn; s.voiceChannelId = newVcId;
    conn.subscribe(s.player);
    return true;
  } catch { return false; }
}
