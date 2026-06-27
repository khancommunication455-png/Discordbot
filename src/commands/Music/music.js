import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, VoiceConnectionStatus, StreamType,
  NoSubscriberBehavior, entersState,
} from '@discordjs/voice';
import ytdl from '@distube/ytdl-core';
import { existsSync } from 'fs';
import { execSync, spawn } from 'child_process';
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
    info:      null,
  };
}

// ── Audio stream via ffmpeg ────────────────────────────────────────────────
// Pass the CDN URL directly to ffmpeg to avoid ytdl's undici dispatcher,
// which throws "invalid onError method" when its request handler is torn down.
async function createAudioStream(track) {
  let info;
  try {
    info = track.info ?? await ytdl.getInfo(track.url);
  } catch (e) {
    throw new Error(`ytdl.getInfo failed: ${e.message}`);
  }

  let format;
  try {
    format = ytdl.chooseFormat(info.formats, { quality: 'highestaudio', filter: 'audioonly' });
  } catch {
    format = ytdl.chooseFormat(info.formats, { quality: 'lowestaudio' });
  }

  if (!format?.url) throw new Error('No playable audio format found');

  const ff = spawn(FFMPEG, [
    '-reconnect',           '1',
    '-reconnect_streamed',  '1',
    '-reconnect_delay_max', '5',
    '-headers', 'User-Agent: Mozilla/5.0\r\nOrigin: https://www.youtube.com\r\nReferer: https://www.youtube.com/\r\n',
    '-i', format.url,
    '-vn',
    '-f',  's16le',
    '-ar', '48000',
    '-ac', '2',
    'pipe:1',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  ff.stderr.on('data', () => {});
  ff.on('error', e => { console.error('[Music][ffmpeg spawn]', e.message); ff.stdout.destroy(e); });
  ff.on('close', code => { if (code !== 0 && code !== null) console.warn(`[Music][ffmpeg] exit ${code}`); });

  return ff.stdout;
}

// ── Voice connection (Railway-proof) ───────────────────────────────────────
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

  await new Promise(r => setTimeout(r, 2500));
  console.log('[Music] Connection ready ✅');
  return connection;
}

// ── Per-guild music state ──────────────────────────────────────────────────
const musicState = new Map();

// ── playNext — SINGLETON per guild ────────────────────────────────────────
// `state.playing` is a Promise while a track is being fetched/played, null otherwise.
// Callers just call kickPlay(guildId) — it's a no-op if already playing.

function kickPlay(guildId) {
  const state = musicState.get(guildId);
  if (!state) return;
  if (state.playing) return; // already running, the loop will pick up next track

  state.playing = _playLoop(guildId).finally(() => {
    const s = musicState.get(guildId);
    if (s) s.playing = null;
  });
}

async function _playLoop(guildId) {
  while (true) {
    const state = musicState.get(guildId);
    if (!state) return; // guild cleaned up

    if (!state.queue.length) {
      state.current = null;
      return;
    }

    const track = state.queue.shift();
    state.current = track;

    try {
      const stream = await createAudioStream(track);

      // Re-check: state may have been cleaned up during async stream fetch
      const s = musicState.get(guildId);
      if (!s) {
        console.warn('[Music] State gone after stream fetch — aborting');
        return;
      }

      const resource = createAudioResource(stream, {
        inputType: StreamType.Raw,
        inlineVolume: false,
      });

      // Wait for the track to finish playing
      await new Promise((resolve, reject) => {
        let settled = false;
        const done = (err) => {
          if (settled) return;
          settled = true;
          s.player.off(AudioPlayerStatus.Idle,  onIdle);
          s.player.off('error', onErr);
          if (err) reject(err); else resolve();
        };
        const onIdle = () => done(null);
        const onErr  = (e) => done(e);

        s.player.once(AudioPlayerStatus.Idle,  onIdle);
        s.player.once('error', onErr);
        s.player.play(resource);
        console.log(`[Music] Playing: ${track.title}`);
      });

      // Handle loop
      const s2 = musicState.get(guildId);
      if (s2?.loop && track) s2.queue.unshift({ ...track });

    } catch (err) {
      console.error('[Music] playLoop error:', err.message);
      const s = musicState.get(guildId);
      if (s) s.current = null;
      // Brief pause before trying next track
      await new Promise(r => setTimeout(r, 1000));
    }
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
    queue:          [],
    current:        null,
    voiceChannelId: voiceChannel.id,
    volume:         0.8,
    loop:           false,
    playing:        null,  // Promise | null
  };
  musicState.set(guild.id, state);

  // Player error: log only — _playLoop handles recovery via the settled promise
  player.on('error', err => {
    console.error('[Music] Player error:', err.message);
  });

  // Connection events
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
          .setColor(C.music ?? '#1DB954').setTitle('🎵 Now Playing')
          .setDescription(`**[${t.title}](${t.url})**`)
          .addFields(
            { name: 'Duration', value: t.duration, inline: true },
            { name: 'Author',   value: t.author,   inline: true },
            { name: 'Queue',    value: `${state.queue.length} up next`, inline: true },
          )
          .setThumbnail(t.thumbnail)
          .setFooter(FOOTER).setTimestamp()
        );
      }
    }

    // All other commands need the user to be in a voice channel
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
        const isFirst = s.current === null && !s.playing;
        kickPlay(interaction.guildId);

        return interaction.editReply({ embeds: [new EmbedBuilder()
          .setColor(C.music ?? '#1DB954')
          .setTitle(isFirst ? '🎵 Now Playing' : '📋 Added to Queue')
          .setDescription(`**[${track.title}](${track.url})**`)
          .addFields(
            { name: 'Duration', value: track.duration,                                    inline: true },
            { name: 'Author',   value: track.author,                                      inline: true },
            { name: 'Position', value: isFirst ? 'Playing now' : `#${s.queue.length}`,   inline: true },
          )
          .setThumbnail(track.thumbnail)
          .setFooter(FOOTER).setTimestamp()
        ]});
      } catch (err) {
        console.error('[Music] play error:', err.message);
        return interaction.editReply({ embeds: [new EmbedBuilder()
          .setColor(C.error).setTitle('Error')
          .setDescription(`Could not play that track.\n\`${err.message}\``)
          .setFooter(FOOTER).setTimestamp()
        ]});
      }
    }

    if (!state) {
      return reply(new EmbedBuilder()
        .setColor(C.error).setTitle('Not Playing')
        .setDescription('Nothing is playing. Use `/music play` to start.')
        .setFooter(FOOTER).setTimestamp(), true
      );
    }

    // ── SKIP ──────────────────────────────────────────────────────────
    if (sub === 'skip') {
      const title = state.current?.title ?? 'Unknown';
      state.player.stop(); // triggers Idle → _playLoop continues to next
      return reply(new EmbedBuilder()
        .setColor(C.success).setTitle('⏭ Skipped')
        .setDescription(`Skipped **${title}**`)
        .setFooter(FOOTER).setTimestamp()
      );
    }

    // ── STOP ──────────────────────────────────────────────────────────
    if (sub === 'stop') {
      state.queue   = [];
      state.current = null;
      state.loop    = false;
      try { state.player.stop(true); } catch {}
      try { state.connection.destroy(); } catch {}
      musicState.delete(interaction.guildId);
      return reply(new EmbedBuilder()
        .setColor(C.success).setTitle('⏹ Stopped')
        .setDescription('Music stopped and queue cleared.')
        .setFooter(FOOTER).setTimestamp()
      );
    }

    // ── PAUSE ─────────────────────────────────────────────────────────
    if (sub === 'pause') {
      state.player.pause();
      return reply(new EmbedBuilder()
        .setColor(C.info ?? '#5865F2').setTitle('⏸ Paused')
        .setFooter(FOOTER).setTimestamp()
      );
    }

    // ── RESUME ────────────────────────────────────────────────────────
    if (sub === 'resume') {
      state.player.unpause();
      return reply(new EmbedBuilder()
        .setColor(C.success).setTitle('▶ Resumed')
        .setFooter(FOOTER).setTimestamp()
      );
    }

    // ── LOOP ──────────────────────────────────────────────────────────
    if (sub === 'loop') {
      state.loop = !state.loop;
      return reply(new EmbedBuilder()
        .setColor(C.info ?? '#5865F2').setTitle('🔁 Loop')
        .setDescription(`Loop is now **${state.loop ? 'ON' : 'OFF'}**`)
        .setFooter(FOOTER).setTimestamp()
      );
    }

    // ── VOLUME ────────────────────────────────────────────────────────
    if (sub === 'volume') {
      const level = interaction.options.getInteger('level');
      state.volume = level / 100;
      try { state.player._resource?.volume?.setVolume(state.volume); } catch {}
      return reply(new EmbedBuilder()
        .setColor(C.info ?? '#5865F2').setTitle('🔊 Volume')
        .setDescription(`Volume set to **${level}%**`)
        .setFooter(FOOTER).setTimestamp()
      );
    }
  },
};
