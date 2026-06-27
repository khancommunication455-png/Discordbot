import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, VoiceConnectionStatus, StreamType,
  NoSubscriberBehavior, entersState,
} from '@discordjs/voice';
import ytdl from '@distube/ytdl-core';
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
async function searchYouTube(query) {
  const isUrl = /^https?:\/\//.test(query);

  if (isUrl) {
    const info = await ytdl.getInfo(query);
    const v    = info.videoDetails;
    const dur  = parseInt(v.lengthSeconds) || 0;
    return {
      title:     v.title,
      url:       v.video_url,
      duration:  `${Math.floor(dur / 60)}:${String(dur % 60).padStart(2, '0')}`,
      thumbnail: v.thumbnails?.slice(-1)[0]?.url ?? null,
      author:    v.author?.name ?? 'Unknown',
      info,
    };
  }

  // YouTube search via public endpoint
  const res  = await fetch(
    `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%3D%3D`,
    { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36' } }
  );
  const html = await res.text();
  const match = html.match(/var ytInitialData = ({.+?});<\/script>/s);
  if (!match) throw new Error('YouTube search returned no results');

  const data     = JSON.parse(match[1]);
  const contents = data?.contents?.twoColumnSearchResultsRenderer
    ?.primaryContents?.sectionListRenderer?.contents?.[0]
    ?.itemSectionRenderer?.contents;
  const video = contents?.find(c => c.videoRenderer)?.videoRenderer;
  if (!video) throw new Error('No video found for that query');

  const dur = video.lengthText?.simpleText ?? '0:00';
  return {
    title:     video.title?.runs?.[0]?.text ?? query,
    url:       `https://www.youtube.com/watch?v=${video.videoId}`,
    duration:  dur,
    thumbnail: video.thumbnail?.thumbnails?.slice(-1)[0]?.url ?? null,
    author:    video.ownerText?.runs?.[0]?.text ?? 'Unknown',
    info:      null, // fetched lazily when streaming
  };
}

// ── Audio stream via ffmpeg ────────────────────────────────────────────────
async function createAudioStream(track) {
  const info   = track.info ?? await ytdl.getInfo(track.url);
  const format = ytdl.chooseFormat(info.formats, { quality: 'highestaudio', filter: 'audioonly' });

  // Output raw PCM — DO NOT use OggOpus+inlineVolume, it requires
  // opusscript native bindings which fail on Railway → silent audio.
  const ff = spawn(FFMPEG, [
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '5',
    '-i', format.url,
    '-vn',
    '-f', 's16le',    // raw signed 16-bit little-endian PCM
    '-ar', '48000',   // 48kHz required by Discord
    '-ac', '2',       // stereo
    'pipe:1',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  ff.stderr.on('data', () => {});
  ff.on('error', e => console.error('[Music][ffmpeg]', e.message));
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

