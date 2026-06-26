import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, VoiceConnectionStatus, StreamType, NoSubscriberBehavior,
  entersState,
} from '@discordjs/voice';
import ytdl from '@distube/ytdl-core';
import { existsSync, execSync } from 'fs';
import { spawn } from 'child_process';
import { C } from '../../utils/embeds.js';

const FOOTER = { text: 'TITAN Jr. Music' };

// ── Find ffmpeg ───────────────────────────────────────────────────────────────
function findFFmpeg() {
  for (const p of [
    process.env.FFMPEG_PATH,
    '/root/.nix-profile/bin/ffmpeg',
    '/usr/bin/ffmpeg',
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

// ── Search YouTube ────────────────────────────────────────────────────────────
async function searchYouTube(query) {
  // Use ytdl-core's search via undocumented but stable YouTube search endpoint
  const isUrl = /^https?:\/\//.test(query);
  if (isUrl) {
    const info = await ytdl.getInfo(query);
    const v = info.videoDetails;
    const dur = parseInt(v.lengthSeconds) || 0;
    return {
      title:     v.title,
      url:       v.video_url,
      duration:  `${Math.floor(dur/60)}:${String(dur%60).padStart(2,'0')}`,
      thumbnail: v.thumbnails?.slice(-1)[0]?.url || null,
      author:    v.author?.name || 'Unknown',
      info,
    };
  }

  // Search using YouTube's internal suggestion API
  const res = await fetch(
    `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%3D%3D`,
    { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36' } }
  );
  const html = await res.text();
  const match = html.match(/var ytInitialData = ({.+?});<\/script>/s);
  if (!match) throw new Error('No search results found');
  const data = JSON.parse(match[1]);
  const contents = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
    ?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents;
  const video = contents?.find(c => c.videoRenderer)?.videoRenderer;
  if (!video) throw new Error('No video found for that query');

  const videoId = video.videoId;
  const title = video.title?.runs?.[0]?.text || query;
  const durText = video.lengthText?.simpleText || '0:00';
  const thumb = video.thumbnail?.thumbnails?.slice(-1)[0]?.url || null;
  const author = video.ownerText?.runs?.[0]?.text || 'Unknown';

  return {
    title,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    duration: durText,
    thumbnail: thumb,
    author,
    info: null, // will fetch when streaming
  };
}

// ── Create audio stream ───────────────────────────────────────────────────────
async function createAudioStream(track) {
  // Get fresh info if we don't have it (search result case)
  let info = track.info;
  if (!info) {
    info = await ytdl.getInfo(track.url);
  }

  // Get best audio format
  const format = ytdl.chooseFormat(info.formats, {
    quality: 'highestaudio',
    filter: 'audioonly',
  });

  // Stream via ffmpeg: mp4/webm audio → OggOpus
  const ff = spawn(FFMPEG, [
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '5',
    '-i', format.url,
    '-vn',
    '-c:a', 'libopus',
    '-b:a', '96k',
    '-vbr', 'on',
    '-f', 'ogg',
    'pipe:1',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  ff.stderr.on('data', () => {});
  ff.on('error', e => console.error('[Music][ffmpeg]', e.message));

  return ff.stdout;
}

// ── Per-guild state ───────────────────────────────────────────────────────────
const musicState = new Map();

async function playNext(guildId) {
  const state = musicState.get(guildId);
  if (!state || !state.queue.length) {
    if (state) state.current = null;
    return;
  }
  const track = state.queue.shift();
  state.current = track;
  try {
    const audioStream = await createAudioStream(track);
    const resource = createAudioResource(audioStream, {
      inputType: StreamType.OggOpus,
      inlineVolume: true,
    });
    resource.volume?.setVolume(state.volume ?? 0.8);
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
  if (existing && existing.voiceChannelId === voiceChannel.id) return existing;

  if (existing) {
    try { existing.player.stop(true); } catch {}
    try { existing.connection.destroy(); } catch {}
    await new Promise(r => setTimeout(r, 500));
    musicState.delete(guild.id);
  }

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: true,
  });

  // Railway has strict UDP restrictions — waiting for Ready times out.
  // Wait for Signalling (Discord gateway ACK) then sleep for UDP to settle.
  try {
    await entersState(connection, VoiceConnectionStatus.Signalling, 15_000);
  } catch {
    try { connection.destroy(); } catch {}
    throw new Error('Could not connect to voice channel — check bot has Connect + Speak permissions');
  }
  await new Promise(r => setTimeout(r, 2000));
  console.log('[Music] Voice connection established');

  const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
  connection.subscribe(player);

  const state = { connection, player, queue: [], current: null, voiceChannelId: voiceChannel.id, volume: 0.8, loop: false };
  musicState.set(guild.id, state);

  player.on(AudioPlayerStatus.Idle, () => {
    if (!musicState.has(guild.id)) return;
    const s = musicState.get(guild.id);
    if (s.loop && s.current) s.queue.unshift(s.current);
    setTimeout(() => playNext(guild.id), 500);
  });
  player.on('error', err => {
    console.error('[Music] Player error:', err.message);
    setTimeout(() => playNext(guild.id), 1000);
  });

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      try { connection.destroy(); } catch {}
      musicState.delete(guild.id);
    }
  });
  connection.on(VoiceConnectionStatus.Destroyed, () => musicState.delete(guild.id));

  return state;
}

// ── Command ───────────────────────────────────────────────────────────────────
export default {
  data: new SlashCommandBuilder()
    .setName('music')
    .setDescription('Music Player — YouTube')
    .addSubcommand(s => s
      .setName('play')
      .setDescription('Play a song from YouTube')
      .addStringOption(o => o.setName('query').setDescription('Song name or YouTube URL').setRequired(true))
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
      .addIntegerOption(o => o.setName('level').setDescription('Volume').setRequired(true).setMinValue(0).setMaxValue(100))
    )
    .addSubcommand(s => s.setName('nowplaying').setDescription('Show currently playing track')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const voiceChannel = interaction.member.voice?.channel;
    const state = musicState.get(interaction.guildId);

    const reply = (embed, eph = false) => {
      const opts = { embeds: [embed], ...(eph ? { flags: [64] } : {}) };
      if (interaction.replied || interaction.deferred) return interaction.editReply(opts);
      return interaction.reply(opts);
    };

    if (!voiceChannel && !['queue', 'nowplaying'].includes(sub)) {
      return reply(new EmbedBuilder().setColor(C.error).setTitle('Not in Voice').setDescription('Join a voice channel first!').setFooter(FOOTER).setTimestamp(), true);
    }

    if (sub === 'play') {
      await interaction.deferReply();
      const query = interaction.options.getString('query');
      try {
        const track = await searchYouTube(query);
        const s = await getOrCreateState(interaction.guild, voiceChannel);
        s.queue.push(track);
        const wasIdle = s.current === null;
        if (wasIdle) playNext(interaction.guildId);

        await interaction.editReply({ embeds: [new EmbedBuilder()
          .setColor(C.music ?? '#1DB954')
          .setTitle(wasIdle ? 'Now Playing' : 'Added to Queue')
          .setDescription(`**[${track.title}](${track.url})**`)
          .addFields(
            { name: 'Duration', value: track.duration, inline: true },
            { name: 'Author',   value: track.author,   inline: true },
            { name: 'Position', value: wasIdle ? 'Now' : `#${s.queue.length}`, inline: true },
          )
          .setThumbnail(track.thumbnail)
          .setFooter(FOOTER).setTimestamp()
        ]});
      } catch (err) {
        console.error('[Music Play Error]', err.message);
        await interaction.editReply({ embeds: [new EmbedBuilder()
          .setColor(C.error).setTitle('Error').setDescription(err.message)
          .setFooter(FOOTER).setTimestamp()
        ]});
      }
    }

    else if (sub === 'skip') {
      if (!state?.current) return reply(new EmbedBuilder().setColor(C.error).setTitle('Nothing Playing').setFooter(FOOTER).setTimestamp(), true);
      const title = state.current.title;
      state.loop = false;
      state.player.stop();
      return reply(new EmbedBuilder().setColor(C.success ?? '#57F287').setTitle('Skipped').setDescription(`Skipped **${title}**`).setFooter(FOOTER).setTimestamp());
    }

    else if (sub === 'stop') {
      if (!state) return reply(new EmbedBuilder().setColor(C.error).setTitle('Nothing Playing').setFooter(FOOTER).setTimestamp(), true);
      state.queue = []; state.current = null; state.loop = false;
      try { state.player.stop(true); } catch {}
      try { state.connection.destroy(); } catch {}
      musicState.delete(interaction.guildId);
      return reply(new EmbedBuilder().setColor(C.success ?? '#57F287').setTitle('Stopped').setDescription('Queue cleared and bot left.').setFooter(FOOTER).setTimestamp());
    }

    else if (sub === 'queue') {
      if (!state?.current) return reply(new EmbedBuilder().setColor(C.info ?? '#5865F2').setTitle('Queue Empty').setDescription('Nothing is playing.').setFooter(FOOTER).setTimestamp());
      const list = state.queue.slice(0, 10).map((t, i) => `**${i+1}.** [${t.title}](${t.url})`).join('\n');
      return reply(new EmbedBuilder()
        .setColor(C.music ?? '#1DB954').setTitle('Music Queue')
        .setDescription(`**Now Playing:** [${state.current.title}](${state.current.url})\n\n${list || 'No more tracks.'}`)
        .setFooter({ text: `${state.queue.length} track(s) · Loop: ${state.loop ? 'ON' : 'OFF'}` }).setTimestamp());
    }

    else if (sub === 'pause') {
      if (!state?.current) return reply(new EmbedBuilder().setColor(C.error).setTitle('Nothing Playing').setFooter(FOOTER).setTimestamp(), true);
      state.player.pause();
      return reply(new EmbedBuilder().setColor(C.music ?? '#1DB954').setTitle('Paused').setFooter(FOOTER).setTimestamp());
    }

    else if (sub === 'resume') {
      if (!state?.current) return reply(new EmbedBuilder().setColor(C.error).setTitle('Nothing Playing').setFooter(FOOTER).setTimestamp(), true);
      state.player.unpause();
      return reply(new EmbedBuilder().setColor(C.music ?? '#1DB954').setTitle('Resumed').setFooter(FOOTER).setTimestamp());
    }

    else if (sub === 'loop') {
      if (!state) return reply(new EmbedBuilder().setColor(C.error).setTitle('Nothing Playing').setFooter(FOOTER).setTimestamp(), true);
      state.loop = !state.loop;
      return reply(new EmbedBuilder().setColor(C.music ?? '#1DB954').setTitle('Loop').setDescription(`Loop is now **${state.loop ? 'ON' : 'OFF'}**`).setFooter(FOOTER).setTimestamp());
    }

    else if (sub === 'volume') {
      const level = interaction.options.getInteger('level');
      if (state) state.volume = level / 100;
      return reply(new EmbedBuilder().setColor(C.music ?? '#1DB954').setTitle('Volume').setDescription(`Volume set to **${level}%**`).setFooter(FOOTER).setTimestamp());
    }

    else if (sub === 'nowplaying') {
      if (!state?.current) return reply(new EmbedBuilder().setColor(C.info ?? '#5865F2').setTitle('Nothing Playing').setFooter(FOOTER).setTimestamp());
      const t = state.current;
      return reply(new EmbedBuilder()
        .setColor(C.music ?? '#1DB954').setTitle('Now Playing')
        .setDescription(`**[${t.title}](${t.url})**`)
        .setThumbnail(t.thumbnail)
        .addFields(
          { name: 'Duration', value: t.duration, inline: true },
          { name: 'Author',   value: t.author,   inline: true },
          { name: 'Queue',    value: `${state.queue.length} up next`, inline: true },
        )
        .setFooter(FOOTER).setTimestamp());
    }
  },
};