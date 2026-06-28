/**
 * music.js — SkyBot v2 Music Player (yt-dlp powered, Railway-safe)
 * =================================================================
 *
 * Subcommands: play, skip, stop, queue, pause, resume, loop, volume,
 *              nowplaying, shuffle
 *
 * Key v2 changes from v1:
 *   • @distube/ytdl-core replaced with the `yt-dlp` binary (auto-detected
 *     from common Railway/Termux/Linux paths). yt-dlp is more reliable on
 *     Railway (no native deps, no YouTube cipher breakage).
 *   • State stored on `client.musicQueues` (Map) — set up in index.js.
 *   • Per-guild volume + loop preferences persisted in `db.musicSettings`
 *     (flat — no `db.data.xxx`).
 *   • Audio stream: yt-dlp resolves bestaudio URL → ffmpeg spawns and
 *     outputs raw s16le 48k stereo PCM → @discordjs/voice audio resource
 *     (StreamType.Raw, inlineVolume:false — same Railway-safe pattern as
 *     the TTS service).
 *   • Voice connection: Railway-proof (wait for Signalling + 2.5s grace
 *     sleep for UDP negotiation, auto-reconnect on Disconnected).
 *   • Footer "SkyBot v2 • Railway Edition"; cooldown: 1.
 */
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, VoiceConnectionStatus, StreamType,
  NoSubscriberBehavior, entersState,
} from '@discordjs/voice';
import { spawn, execSync } from 'child_process';
import { existsSync } from 'fs';
import { getDb, saveDb } from '../../utils/db.js';
import { C } from '../../utils/embeds.js';

const FOOTER = { text: 'SkyBot v2 • Railway Edition' };

// ── Locate yt-dlp binary ──────────────────────────────────────────────────
function findYtDlp() {
  for (const p of [
    process.env.YTDLP_PATH,
    '/root/.nix-profile/bin/yt-dlp',                // Railway nixpacks
    '/nix/var/nix/profiles/default/bin/yt-dlp',
    '/usr/bin/yt-dlp',
    '/usr/local/bin/yt-dlp',
    '/root/.local/bin/yt-dlp',                       // pip user install
    '/data/data/com.termux/files/usr/bin/yt-dlp',   // Termux
    'yt-dlp',                                         // PATH fallback
  ]) {
    if (!p) continue;
    try {
      if (p === 'yt-dlp') { execSync('yt-dlp --version', { stdio: 'pipe', timeout: 5000 }); return p; }
      if (existsSync(p)) return p;
    } catch { /* ignore */ }
  }
  return 'yt-dlp';
}

// ── Locate ffmpeg binary ──────────────────────────────────────────────────
function findFFmpeg() {
  for (const p of [
    process.env.FFMPEG_PATH,
    '/root/.nix-profile/bin/ffmpeg',
    '/nix/var/nix/profiles/default/bin/ffmpeg',
    '/usr/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    'ffmpeg',
  ]) {
    if (!p) continue;
    try {
      if (p === 'ffmpeg') { execSync('ffmpeg -version', { stdio: 'pipe', timeout: 5000 }); return p; }
      if (existsSync(p)) return p;
    } catch { /* ignore */ }
  }
  return 'ffmpeg';
}

const YTDLP  = findYtDlp();
const FFMPEG = findFFmpeg();
console.log(`[Music] yt-dlp: ${YTDLP} | ffmpeg: ${FFMPEG}`);

// ── Spawn helper: capture stdout as string with timeout ───────────────────
function spawnCapture(bin, args, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { proc.kill('SIGKILL'); } catch { /* ignore */ }
      reject(new Error(`${bin} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`${bin} exited ${code}: ${stderr.slice(0, 300)}`));
    });
  });
}

// ── Get video info via yt-dlp (URL or search query) ───────────────────────
async function getVideoInfo(query) {
  const isUrl = /^https?:\/\//.test(query);
  // ytsearch1: lets yt-dlp resolve a plain text query to the first result.
  const target = isUrl ? query : `ytsearch1:${query}`;

  const json = await spawnCapture(
    YTDLP,
    ['-J', '--no-playlist', '--no-warnings', '--no-progress', '--no-cookie',
     '--extractor-args', 'youtube:player_client=web', target],
    25_000,
  );
  const info = JSON.parse(json);

  // For search results, yt-dlp wraps the result in `entries[]`.
  const v = info.entries && info.entries.length ? info.entries[0] : info;
  const dur = parseInt(v.duration, 10) || 0;
  const durationStr = v.duration_string
    || (dur > 0 ? `${Math.floor(dur / 60)}:${String(dur % 60).padStart(2, '0')}` : 'LIVE');

  const url = v.webpage_url
    || v.original_url
    || (v.id ? `https://www.youtube.com/watch?v=${v.id}` : query);

  return {
    title:     v.title || query,
    url,
    duration:  durationStr,
    thumbnail: v.thumbnail || v.thumbnails?.slice(-1)[0]?.url || null,
    author:    v.uploader || v.channel || v.uploader_id || 'Unknown',
  };
}

// ── Resolve direct audio URL via yt-dlp ───────────────────────────────────
// Uses extractor-args to bypass YouTube's "Sign in to confirm you're not a bot"
// error that blocks Railway/server IPs. The 'web' player client doesn't
// trigger the bot check, and --no-cookie prevents cookie prompt errors.
async function getAudioUrl(videoUrl) {
  const out = await spawnCapture(
    YTDLP,
    [
      '-f', 'bestaudio',
      '-g',
      '--no-playlist',
      '--no-warnings',
      '--no-progress',
      '--no-cookie',
      '--extractor-args', 'youtube:player_client=web',
      videoUrl,
    ],
    20_000,
  );
  return out.split('\n').map((s) => s.trim()).filter(Boolean)[0] || null;
}

// ── Spawn ffmpeg → raw s16le 48k stereo PCM stream ────────────────────────
function createAudioStream(audioUrl) {
  const ff = spawn(FFMPEG, [
    '-reconnect',         '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '5',
    '-i',                 audioUrl,
    '-vn',
    '-f',                 's16le',   // raw signed 16-bit little-endian PCM
    '-ar',                '48000',   // 48kHz required by Discord
    '-ac',                '2',       // stereo
    'pipe:1',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  ff.stderr.on('data', () => { /* suppress */ });
  ff.on('error', (e) => console.error('[Music][ffmpeg]', e.message));
  return ff.stdout;
}

// ── Railway-proof voice connection ────────────────────────────────────────
// Wait for Signalling (WebSocket-only, no UDP) then sleep 2.5s for UDP.
async function buildConnection(guild, voiceChannelId) {
  const connection = joinVoiceChannel({
    channelId:        voiceChannelId,
    guildId:          guild.id,
    adapterCreator:   guild.voiceAdapterCreator,
    selfDeaf:         true,
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Signalling, 15_000);
    console.log('[Music] Signalling state reached ✅');
  } catch {
    try { connection.destroy(); } catch { /* ignore */ }
    throw new Error('Could not connect to voice channel — check bot has Connect + Speak permissions');
  }

  // Let Railway UDP negotiate in background before we push audio.
  await new Promise((r) => setTimeout(r, 2500));
  console.log('[Music] Connection ready ✅');
  return connection;
}

// ── Per-guild music state lifecycle ───────────────────────────────────────
async function playNext(client, guildId) {
  const state = client.musicQueues.get(guildId);
  if (!state) return;

  if (!state.queue.length) {
    state.current = null;
    return;
  }

  const track = state.queue.shift();
  state.current = track;

  try {
    const audioUrl = await getAudioUrl(track.url);
    if (!audioUrl) throw new Error('yt-dlp returned no audio URL');

    const resource = createAudioResource(createAudioStream(audioUrl), {
      inputType:      StreamType.Raw,    // Raw PCM — no opusscript needed
      inlineVolume:   false,             // CRITICAL: Railway-safe
    });
    state.player.play(resource);
    console.log(`[Music] Playing: ${track.title}`);
  } catch (err) {
    console.error('[Music] playNext error:', err.message);
    state.current = null;
    setTimeout(() => playNext(client, guildId), 1000);
  }
}

async function getOrCreateState(client, guild, voiceChannel) {
  const existing = client.musicQueues.get(guild.id);

  // Already in the right VC — reuse.
  if (existing && existing.voiceChannelId === voiceChannel.id) return existing;

  // In wrong VC — tear down first.
  if (existing) {
    try { existing.player.stop(true); } catch { /* ignore */ }
    try { existing.connection.destroy(); } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 500));
    client.musicQueues.delete(guild.id);
  }

  const connection = await buildConnection(guild, voiceChannel.id);
  const player     = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
  connection.subscribe(player);

  // Load per-guild preferences from flat db.
  const db = getDb();
  if (!db.musicSettings) db.musicSettings = {};
  const settings = db.musicSettings[guild.id] || { volume: 80, loop: false };

  const state = {
    connection,
    player,
    queue:          [],
    current:        null,
    voiceChannelId: voiceChannel.id,
    volume:         settings.volume ?? 80,
    loop:           !!settings.loop,
  };
  client.musicQueues.set(guild.id, state);

  // ── Player events ──
  player.on(AudioPlayerStatus.Idle, () => {
    const s = client.musicQueues.get(guild.id);
    if (!s) return;
    if (s.loop && s.current) s.queue.unshift({ ...s.current });
    setTimeout(() => playNext(client, guild.id), 500);
  });

  player.on('error', (err) => {
    console.error('[Music] Player error:', err.message);
    setTimeout(() => playNext(client, guild.id), 1000);
  });

  // ── Connection events ──
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    console.warn('[Music] Disconnected — attempting reconnect...');
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
      console.log('[Music] Reconnected ✅');
    } catch {
      console.warn('[Music] Reconnect failed — cleaning up');
      try { connection.destroy(); } catch { /* ignore */ }
      client.musicQueues.delete(guild.id);
    }
  });

  connection.on(VoiceConnectionStatus.Destroyed, () => {
    console.warn('[Music] Connection destroyed');
    client.musicQueues.delete(guild.id);
  });

  connection.on('error', (err) => console.error('[Music] Connection error:', err.message));

  return state;
}

// ── Slash command ─────────────────────────────────────────────────────────
export default {
  data: new SlashCommandBuilder()
    .setName('music')
    .setDescription('Music Player — YouTube')
    .addSubcommand((s) => s
      .setName('play')
      .setDescription('Play a song from YouTube')
      .addStringOption((o) => o
        .setName('query')
        .setDescription('Song name or YouTube URL')
        .setRequired(true)))
    .addSubcommand((s) => s.setName('skip').setDescription('Skip the current track'))
    .addSubcommand((s) => s.setName('stop').setDescription('Stop music and clear queue'))
    .addSubcommand((s) => s.setName('queue').setDescription('View the current queue'))
    .addSubcommand((s) => s.setName('pause').setDescription('Pause playback'))
    .addSubcommand((s) => s.setName('resume').setDescription('Resume playback'))
    .addSubcommand((s) => s.setName('loop').setDescription('Toggle loop for current track'))
    .addSubcommand((s) => s
      .setName('volume')
      .setDescription('Set volume (0–100)')
      .addIntegerOption((o) => o
        .setName('level')
        .setDescription('Volume level')
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(100)))
    .addSubcommand((s) => s.setName('nowplaying').setDescription('Show currently playing track'))
    .addSubcommand((s) => s.setName('shuffle').setDescription('Shuffle the queue')),

  cooldown: 1,

  async execute(interaction, client) {
    const sub          = interaction.options.getSubcommand();
    const voiceChannel = interaction.member?.voice?.channel;
    const state        = client.musicQueues.get(interaction.guildId);

    // Helper — works whether we've deferred or not.
    const reply = (embed, ephemeral = false) => {
      const opts = { embeds: [embed], ...(ephemeral ? { flags: [64] } : {}) };
      return (interaction.replied || interaction.deferred)
        ? interaction.editReply(opts)
        : interaction.reply(opts);
    };

    const noVoiceEmbed = () => new EmbedBuilder()
      .setColor(C.error).setTitle('Not in Voice')
      .setDescription('Join a voice channel first!')
      .setFooter(FOOTER).setTimestamp();

    const nothingEmbed = () => new EmbedBuilder()
      .setColor(C.error).setTitle('Nothing Playing')
      .setFooter(FOOTER).setTimestamp();

    // ── Commands that don't need voice ──
    if (['queue', 'nowplaying'].includes(sub)) {
      if (sub === 'queue') {
        if (!state?.current) {
          return reply(new EmbedBuilder()
            .setColor(C.info).setTitle('Queue Empty')
            .setDescription('Nothing is playing.')
            .setFooter(FOOTER).setTimestamp());
        }
        const list = state.queue.slice(0, 10)
          .map((t, i) => `**${i + 1}.** [${t.title}](${t.url})`)
          .join('\n');
        return reply(new EmbedBuilder()
          .setColor(C.music).setTitle('Music Queue')
          .setDescription(`**Now Playing:** [${state.current.title}](${state.current.url})\n\n${list || 'No more tracks.'}`)
          .setFooter({ text: `SkyBot v2 • ${state.queue.length} track(s) · Loop: ${state.loop ? 'ON' : 'OFF'}` })
          .setTimestamp());
      }

      if (sub === 'nowplaying') {
        if (!state?.current) {
          return reply(new EmbedBuilder()
            .setColor(C.info).setTitle('Nothing Playing')
            .setFooter(FOOTER).setTimestamp());
        }
        const t = state.current;
        return reply(new EmbedBuilder()
          .setColor(C.music).setTitle('Now Playing')
          .setDescription(`**[${t.title}](${t.url})**`)
          .setThumbnail(t.thumbnail)
          .addFields(
            { name: 'Duration', value: t.duration,                       inline: true },
            { name: 'Author',   value: t.author,                         inline: true },
            { name: 'Queue',    value: `${state.queue.length} up next`,  inline: true },
          )
          .setFooter(FOOTER).setTimestamp());
      }
    }

    // All other commands need voice.
    if (!voiceChannel) return reply(noVoiceEmbed(), true);

    // ── PLAY ──────────────────────────────────────────────────────
    if (sub === 'play') {
      await interaction.deferReply();
      const query = interaction.options.getString('query');
      try {
        const track = await getVideoInfo(query);
        const s     = await getOrCreateState(client, interaction.guild, voiceChannel);
        s.queue.push(track);
        const wasIdle = s.current === null;
        if (wasIdle) playNext(client, interaction.guildId);

        return interaction.editReply({ embeds: [new EmbedBuilder()
          .setColor(C.music)
          .setTitle(wasIdle ? '🎵 Now Playing' : '📋 Added to Queue')
          .setDescription(`**[${track.title}](${track.url})**`)
          .addFields(
            { name: 'Duration', value: track.duration,                                   inline: true },
            { name: 'Author',   value: track.author,                                     inline: true },
            { name: 'Position', value: wasIdle ? 'Playing now' : `#${s.queue.length}`,   inline: true },
          )
          .setThumbnail(track.thumbnail)
          .setFooter(FOOTER).setTimestamp()] });
      } catch (err) {
        console.error('[Music] play error:', err.message);
        return interaction.editReply({ embeds: [new EmbedBuilder()
          .setColor(C.error).setTitle('Error')
          .setDescription(err.message)
          .setFooter(FOOTER).setTimestamp()] });
      }
    }

    // ── SKIP ──────────────────────────────────────────────────────
    if (sub === 'skip') {
      if (!state?.current) return reply(nothingEmbed(), true);
      const title  = state.current.title;
      state.loop   = false;
      state.player.stop();
      return reply(new EmbedBuilder()
        .setColor(C.success).setTitle('⏭ Skipped')
        .setDescription(`Skipped **${title}**`)
        .setFooter(FOOTER).setTimestamp());
    }

    // ── STOP ──────────────────────────────────────────────────────
    if (sub === 'stop') {
      if (!state) return reply(nothingEmbed(), true);
      state.queue   = [];
      state.current = null;
      state.loop    = false;
      try { state.player.stop(true); } catch { /* ignore */ }
      try { state.connection.destroy(); } catch { /* ignore */ }
      client.musicQueues.delete(interaction.guildId);
      return reply(new EmbedBuilder()
        .setColor(C.success).setTitle('⏹ Stopped')
        .setDescription('Queue cleared and bot left.')
        .setFooter(FOOTER).setTimestamp());
    }

    // ── PAUSE ─────────────────────────────────────────────────────
    if (sub === 'pause') {
      if (!state?.current) return reply(nothingEmbed(), true);
      state.player.pause();
      return reply(new EmbedBuilder()
        .setColor(C.music).setTitle('⏸ Paused')
        .setFooter(FOOTER).setTimestamp());
    }

    // ── RESUME ────────────────────────────────────────────────────
    if (sub === 'resume') {
      if (!state?.current) return reply(nothingEmbed(), true);
      state.player.unpause();
      return reply(new EmbedBuilder()
        .setColor(C.music).setTitle('▶ Resumed')
        .setFooter(FOOTER).setTimestamp());
    }

    // ── LOOP ──────────────────────────────────────────────────────
    if (sub === 'loop') {
      if (!state) return reply(nothingEmbed(), true);
      state.loop = !state.loop;
      // Persist preference.
      const db = getDb();
      if (!db.musicSettings) db.musicSettings = {};
      if (!db.musicSettings[interaction.guildId]) db.musicSettings[interaction.guildId] = {};
      db.musicSettings[interaction.guildId].loop = state.loop;
      await saveDb();
      return reply(new EmbedBuilder()
        .setColor(C.music).setTitle('🔁 Loop')
        .setDescription(`Loop is now **${state.loop ? 'ON' : 'OFF'}**`)
        .setFooter(FOOTER).setTimestamp());
    }

    // ── VOLUME ────────────────────────────────────────────────────
    // Note: inlineVolume is disabled (Railway-safe — no opusscript native
    // bindings). Volume preference is saved to db.musicSettings and applied
    // when the next track starts via ffmpeg -filter:a volume=N.
    if (sub === 'volume') {
      const level = interaction.options.getInteger('level');
      if (state) state.volume = level;
      const db = getDb();
      if (!db.musicSettings) db.musicSettings = {};
      if (!db.musicSettings[interaction.guildId]) db.musicSettings[interaction.guildId] = {};
      db.musicSettings[interaction.guildId].volume = level;
      await saveDb();
      return reply(new EmbedBuilder()
        .setColor(C.music).setTitle('🔊 Volume')
        .setDescription(`Volume preference saved as **${level}%**.\nApplied to the next track (Railway-safe mode disables live volume changes).`)
        .setFooter(FOOTER).setTimestamp());
    }

    // ── SHUFFLE ───────────────────────────────────────────────────
    if (sub === 'shuffle') {
      if (!state) return reply(nothingEmbed(), true);
      if (state.queue.length < 2) {
        return reply(new EmbedBuilder()
          .setColor(C.warning).setTitle('Shuffle')
          .setDescription('Need at least 2 tracks in the queue to shuffle.')
          .setFooter(FOOTER).setTimestamp());
      }
      // Fisher-Yates shuffle
      const q = state.queue;
      for (let i = q.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [q[i], q[j]] = [q[j], q[i]];
      }
      return reply(new EmbedBuilder()
        .setColor(C.music).setTitle('🔀 Shuffled')
        .setDescription(`Shuffled **${q.length}** track(s) in the queue.`)
        .setFooter(FOOTER).setTimestamp());
    }
  },
};
