import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, VoiceConnectionStatus, StreamType,
  NoSubscriberBehavior, entersState,
} from '@discordjs/voice';
// ytdl replaced with yt-dlp to avoid Railway IP bans
import { existsSync } from 'fs';           // ✅ only fs stuff from 'fs'
import { execSync, spawn } from 'child_process'; // ✅ execSync from correct module
import { C } from '../../utils/embeds.js';

const FOOTER = { text: 'TITAN Jr. Music' };

// ── Find ffmpeg ────────────────────────────────────────────────────────────
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
      if (p === 'ffmpeg') { execSync('ffmpeg -version', { stdio: 'pipe' }); return p; }
      if (existsSync(p)) return p;
    } catch {}
  }
  return 'ffmpeg';
}
const FFMPEG = findFFmpeg();
console.log(`[Music] ffmpeg: ${FFMPEG}`);

// ── YouTube search ─────────────────────────────────────────────────────────
// Find yt-dlp binary
function findYtDlp() {
  for (const p of ['yt-dlp', '/root/.nix-profile/bin/yt-dlp', '/usr/local/bin/yt-dlp', '/usr/bin/yt-dlp']) {
    try { execSync(`${p} --version`, { stdio: 'pipe', timeout: 5000 }); return p; } catch {}
  }
  return 'yt-dlp';
}
const YTDLP = findYtDlp();
console.log(`[Music] yt-dlp: ${YTDLP}`);

// ── Music Search & Stream ─────────────────────────────────────────────────
// Strategy: SoundCloud via yt-dlp (no IP ban on Railway) + YouTube URL fallback
// YouTube search/stream is blocked on Railway IPs — SoundCloud is not.

async function ytdlpRun(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP, [
      ...args,
      '--no-warnings',
      '--no-playlist',
      '--print-json',
      '--skip-download',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    proc.stdout.on('data', d => out += d);
    proc.stderr.on('data', d => err += d);
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(err.slice(0, 300) || `yt-dlp exit ${code}`));
      try { resolve(JSON.parse(out.trim().split('\n')[0])); }
      catch { reject(new Error('yt-dlp JSON parse failed')); }
    });
    proc.on('error', reject);
  });
}

async function searchYouTube(query) {
  const isYouTubeUrl = /youtube\.com|youtu\.be/.test(query);
  const isUrl        = /^https?:\/\//.test(query);

  // For YouTube URLs: try yt-dlp with invidious extractor (bypasses ban)
  // For queries: search SoundCloud (no ban on Railway)
  let searchArg;
  if (isYouTubeUrl) {
    // Convert to Invidious URL which yt-dlp can fetch without cookies
    const videoId = query.match(/(?:v=|youtu\.be\/)([^&?/]+)/)?.[1];
    searchArg = videoId
      ? `https://invidious.privacyredirect.com/watch?v=${videoId}`
      : query;
  } else if (isUrl) {
    searchArg = query; // SoundCloud/other direct URL
  } else {
    searchArg = `scsearch1:${query}`; // SoundCloud search — works on Railway!
  }

  const info = await ytdlpRun([searchArg]);
  const dur  = info.duration || 0;
  return {
    title:     info.title ?? query,
    url:       info.webpage_url ?? info.original_url ?? searchArg,
    duration:  dur ? `${Math.floor(dur / 60)}:${String(dur % 60).padStart(2, '0')}` : '?',
    thumbnail: info.thumbnail ?? null,
    author:    info.uploader ?? info.artist ?? 'Unknown',
  };
}

// ── Audio stream via ffmpeg ────────────────────────────────────────────────
async function createAudioStream(track) {
  // Stream via yt-dlp piped to ffmpeg
  // SoundCloud URLs work fine; YouTube invidious URLs also work
  console.log(`[Music] streaming: ${track.url}`);

  const ytdlpProc = spawn(YTDLP, [
    track.url,
    '--no-playlist',
    '--no-warnings',
    '-f', 'bestaudio/best',
    '-o', '-',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  const ff = spawn(FFMPEG, [
    '-i', 'pipe:0',
    '-vn',
    '-f', 's16le',
    '-ar', '48000',
    '-ac', '2',
    'pipe:1',
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  ff.stderr.on('data', () => {});
  ff.on('error', e => console.error('[Music][ffmpeg]', e.message));
  ytdlpProc.stderr.on('data', () => {});
  ytdlpProc.on('error', e => console.error('[Music][yt-dlp]', e.message));

  ytdlpProc.stdout.pipe(ff.stdin);
  ytdlpProc.stdout.on('error', () => {});
  ff.stdin.on('error', () => {});

  return ff.stdout;
}

// ── Voice connection (Railway-proof) ───────────────────────────────────────
// Railway has strict UDP — waiting for Ready always times out.
// Strategy: wait for Signalling (WebSocket only, no UDP), then sleep 2.5s.
async function buildConnection(guild, voiceChannelId) {
  const connection = joinVoiceChannel({
    channelId:      voiceChannelId,
    guildId:        guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf:       true,
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Signalling, 15_000);
    console.log('[Music] Signalling state reached ✅');
  } catch {
    try { connection.destroy(); } catch {}
    throw new Error('Could not connect to voice channel — check bot has Connect + Speak permissions');
  }

  // Let Railway UDP negotiate in background before we push audio
  await new Promise(r => setTimeout(r, 2500));
  console.log('[Music] Connection ready ✅');
  return connection;
}

// ── Per-guild music state ──────────────────────────────────────────────────
const musicState = new Map();

async function playNext(guildId) {
  const state = musicState.get(guildId);
  if (!state) return;

  if (!state.queue.length) {
    state.current = null;
    return;
  }

  const track  = state.queue.shift();
  state.current = track;

  try {
    const stream   = await createAudioStream(track);
    const resource = createAudioResource(stream, {
      inputType: StreamType.Raw,   // Raw PCM — no opusscript needed
      inlineVolume: false,
    });
    state.player.play(resource);
    console.log(`[Music] Playing: ${track.title}`);
  } catch (err) {
    console.error('[Music] playNext error:', err.message);
    state.current = null;
    setTimeout(() => playNext(guildId), 1000);
  }
}

async function getOrCreateState(guild, voiceChannel) {
  const existing = musicState.get(guild.id);

  // Already in the right VC — reuse
  if (existing && existing.voiceChannelId === voiceChannel.id) return existing;

  // In wrong VC — tear down first
  if (existing) {
    try { existing.player.stop(true); } catch {}
    try { existing.connection.destroy(); } catch {}
    await new Promise(r => setTimeout(r, 500));
    musicState.delete(guild.id);
  }

  const connection = await buildConnection(guild, voiceChannel.id);
  const player     = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
  connection.subscribe(player);

  const state = {
    connection,
    player,
    queue:         [],
    current:       null,
    voiceChannelId: voiceChannel.id,
    volume:        0.8,
    loop:          false,
  };
  musicState.set(guild.id, state);

  // ── Player events ────────────────────────────────────────────────────
  player.on(AudioPlayerStatus.Idle, () => {
    const s = musicState.get(guild.id);
    if (!s) return;
    if (s.loop && s.current) s.queue.unshift({ ...s.current });
    setTimeout(() => playNext(guild.id), 500);
  });

  player.on('error', err => {
    console.error('[Music] Player error:', err.message);
    setTimeout(() => playNext(guild.id), 1000);
  });

  // ── Connection events ─────────────────────────────────────────────────
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
      try { connection.destroy(); } catch {}
      musicState.delete(guild.id);
    }
  });

  connection.on(VoiceConnectionStatus.Destroyed, () => {
    console.warn('[Music] Connection destroyed');
    musicState.delete(guild.id);
  });

  connection.on('error', err => console.error('[Music] Connection error:', err.message));

  return state;
}

// ── Slash command ──────────────────────────────────────────────────────────
export default {
  data: new SlashCommandBuilder()
    .setName('music')
    .setDescription('Music Player — YouTube')
    .addSubcommand(s => s
      .setName('play')
      .setDescription('Play a song from YouTube')
      .addStringOption(o => o
        .setName('query')
        .setDescription('Song name or YouTube URL')
        .setRequired(true)
      )
    )
    .addSubcommand(s => s.setName('skip').setDescription('Skip the current track'))
    .addSubcommand(s => s.setName('stop').setDescription('Stop music and clear queue'))
    .addSubcommand(s => s.setName('queue').setDescription('View the current queue'))
    .addSubcommand(s => s.setName('pause').setDescription('Pause playback'))
    .addSubcommand(s => s.setName('resume').setDescription('Resume playback'))
    .addSubcommand(s => s.setName('loop').setDescription('Toggle loop for current track'))
    .addSubcommand(s => s
      .setName('volume')
      .setDescription('Set volume (0–100)')
      .addIntegerOption(o => o
        .setName('level')
        .setDescription('Volume level')
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(100)
      )
    )
    .addSubcommand(s => s.setName('nowplaying').setDescription('Show currently playing track')),

  async execute(interaction) {
    const sub          = interaction.options.getSubcommand();
    const voiceChannel = interaction.member?.voice?.channel;
    const state        = musicState.get(interaction.guildId);

    // Helper — works whether we've deferred or not
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

    // Commands that don't need voice
    if (['queue', 'nowplaying'].includes(sub)) {
      if (sub === 'queue') {
        if (!state?.current)
          return reply(new EmbedBuilder().setColor(C.info ?? '#5865F2').setTitle('Queue Empty').setDescription('Nothing is playing.').setFooter(FOOTER).setTimestamp());
        const list = state.queue.slice(0, 10)
          .map((t, i) => `**${i + 1}.** [${t.title}](${t.url})`)
          .join('\n');
        return reply(new EmbedBuilder()
          .setColor(C.music ?? '#1DB954').setTitle('Music Queue')
          .setDescription(`**Now Playing:** [${state.current.title}](${state.current.url})\n\n${list || 'No more tracks.'}`)
          .setFooter({ text: `${state.queue.length} track(s) · Loop: ${state.loop ? 'ON' : 'OFF'}` })
          .setTimestamp()
        );
      }

      if (sub === 'nowplaying') {
        if (!state?.current)
          return reply(new EmbedBuilder().setColor(C.info ?? '#5865F2').setTitle('Nothing Playing').setFooter(FOOTER).setTimestamp());
        const t = state.current;
        return reply(new EmbedBuilder()
          .setColor(C.music ?? '#1DB954').setTitle('Now Playing')
          .setDescription(`**[${t.title}](${t.url})**`)
          .setThumbnail(t.thumbnail)
          .addFields(
            { name: 'Duration', value: t.duration,              inline: true },
            { name: 'Author',   value: t.author,                inline: true },
            { name: 'Queue',    value: `${state.queue.length} up next`, inline: true },
          )
          .setFooter(FOOTER).setTimestamp()
        );
      }
    }

    // All other commands need voice
    if (!voiceChannel)
      return reply(noVoiceEmbed(), true);

    // ── PLAY ─────────────────────────────────────────────────────────
    if (sub === 'play') {
      await interaction.deferReply();
      const query = interaction.options.getString('query');
      try {
        const track = await searchYouTube(query);
        const s     = await getOrCreateState(interaction.guild, voiceChannel);
        s.queue.push(track);
        const wasIdle = s.current === null;
        if (wasIdle) playNext(interaction.guildId);

        return interaction.editReply({ embeds: [new EmbedBuilder()
          .setColor(C.music ?? '#1DB954')
          .setTitle(wasIdle ? '🎵 Now Playing' : '📋 Added to Queue')
          .setDescription(`**[${track.title}](${track.url})**`)
          .addFields(
            { name: 'Duration', value: track.duration,                           inline: true },
            { name: 'Author',   value: track.author,                             inline: true },
            { name: 'Position', value: wasIdle ? 'Playing now' : `#${s.queue.length}`, inline: true },
          )
          .setThumbnail(track.thumbnail)
          .setFooter(FOOTER).setTimestamp()
        ]});
      } catch (err) {
        console.error('[Music] play error:', err.message);
        return interaction.editReply({ embeds: [new EmbedBuilder()
          .setColor(C.error).setTitle('Error')
          .setDescription(err.message)
          .setFooter(FOOTER).setTimestamp()
        ]});
      }
    }

    // ── SKIP ─────────────────────────────────────────────────────────
    if (sub === 'skip') {
      if (!state?.current) return reply(nothingEmbed(), true);
      const title  = state.current.title;
      state.loop   = false;
      state.player.stop();
      return reply(new EmbedBuilder()
        .setColor(C.success ?? '#57F287').setTitle('⏭ Skipped')
        .setDescription(`Skipped **${title}**`)
        .setFooter(FOOTER).setTimestamp()
      );
    }

    // ── STOP ─────────────────────────────────────────────────────────
    if (sub === 'stop') {
      if (!state) return reply(nothingEmbed(), true);
      state.queue   = [];
      state.current = null;
      state.loop    = false;
      try { state.player.stop(true); } catch {}
      try { state.connection.destroy(); } catch {}
      musicState.delete(interaction.guildId);
      return reply(new EmbedBuilder()
        .setColor(C.success ?? '#57F287').setTitle('⏹ Stopped')
        .setDescription('Queue cleared and bot left.')
        .setFooter(FOOTER).setTimestamp()
      );
    }

    // ── PAUSE ────────────────────────────────────────────────────────
    if (sub === 'pause') {
      if (!state?.current) return reply(nothingEmbed(), true);
      state.player.pause();
      return reply(new EmbedBuilder()
        .setColor(C.music ?? '#1DB954').setTitle('⏸ Paused')
        .setFooter(FOOTER).setTimestamp()
      );
    }

    // ── RESUME ───────────────────────────────────────────────────────
    if (sub === 'resume') {
      if (!state?.current) return reply(nothingEmbed(), true);
      state.player.unpause();
      return reply(new EmbedBuilder()
        .setColor(C.music ?? '#1DB954').setTitle('▶ Resumed')
        .setFooter(FOOTER).setTimestamp()
      );
    }

    // ── LOOP ─────────────────────────────────────────────────────────
    if (sub === 'loop') {
      if (!state) return reply(nothingEmbed(), true);
      state.loop = !state.loop;
      return reply(new EmbedBuilder()
        .setColor(C.music ?? '#1DB954').setTitle('🔁 Loop')
        .setDescription(`Loop is now **${state.loop ? 'ON' : 'OFF'}**`)
        .setFooter(FOOTER).setTimestamp()
      );
    }

    // ── VOLUME ───────────────────────────────────────────────────────
    if (sub === 'volume') {
      const level = interaction.options.getInteger('level');
      if (state) {
        state.volume = level / 100;
        // Apply to currently playing resource if any
        try { state.player._resource?.volume?.setVolume(state.volume); } catch {}
      }
      return reply(new EmbedBuilder()
        .setColor(C.music ?? '#1DB954').setTitle('🔊 Volume')
        .setDescription(`Volume set to **${level}%**`)
        .setFooter(FOOTER).setTimestamp()
      );
    }
  },
};
