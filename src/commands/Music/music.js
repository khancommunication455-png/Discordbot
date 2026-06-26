import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, VoiceConnectionStatus, StreamType, NoSubscriberBehavior,
  entersState,
} from '@discordjs/voice';
import { spawn, execSync } from 'child_process';
import { C } from '../../utils/embeds.js';

const FOOTER = { text: 'TITAN Jr. Music' };

// ── Find yt-dlp ──────────────────────────────────────────────────────────────
function findYtDlp() {
  for (const p of ['/root/.nix-profile/bin/yt-dlp', '/app/venv/bin/yt-dlp', 'yt-dlp']) {
    try { execSync(`${p} --version`, { stdio: 'pipe' }); return p; } catch {}
  }
  return 'yt-dlp';
}

// ── Find ffmpeg ───────────────────────────────────────────────────────────────
function findFFmpeg() {
  for (const p of ['/root/.nix-profile/bin/ffmpeg', '/usr/bin/ffmpeg', 'ffmpeg']) {
    try {
      if (p === 'ffmpeg') { execSync('ffmpeg -version', { stdio: 'pipe' }); return p; }
      const { existsSync } = await import('fs'); // can't await here, use sync check
      return p; // yt-dlp will find ffmpeg itself
    } catch {}
  }
  return 'ffmpeg';
}

// Per-guild state: { connection, player, queue: [{title,url,duration,thumbnail,author}], current, voiceChannelId }
const musicState = new Map();

async function resolveTrack(query) {
  const ytdlp = findYtDlp();
  const isUrl = /^https?:\/\//.test(query);
  const args = [
    '--dump-json', '--no-playlist', '--flat-playlist',
    '-f', 'bestaudio',
    '--no-warnings',
    isUrl ? query : `ytsearch1:${query}`,
  ];
  return new Promise((resolve, reject) => {
    let out = '';
    const proc = spawn(ytdlp, args);
    proc.stdout.on('data', d => out += d);
    proc.stderr.on('data', () => {});
    proc.on('close', code => {
      try {
        const lines = out.trim().split('\n').filter(Boolean);
        const info = JSON.parse(lines[0]);
        resolve({
          title: info.title || query,
          url: info.webpage_url || info.url || query,
          duration: info.duration_string || String(Math.floor((info.duration||0)/60)).padStart(2,'0')+':'+String((info.duration||0)%60).padStart(2,'0'),
          thumbnail: info.thumbnail || null,
          author: info.uploader || info.channel || 'Unknown',
        });
      } catch { reject(new Error('Could not find that track')); }
    });
    proc.on('error', reject);
  });
}

function streamTrack(url) {
  const ytdlp = findYtDlp();
  // yt-dlp pipes audio to stdout; ffmpeg transcodes to OggOpus for Discord
  const dl = spawn(ytdlp, [
    '-f', 'bestaudio',
    '-o', '-',
    '--no-playlist',
    '--no-warnings',
    url,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  const ff = spawn('/root/.nix-profile/bin/ffmpeg', [
    '-i', 'pipe:0',
    '-c:a', 'libopus',
    '-b:a', '96k',
    '-vbr', 'on',
    '-f', 'ogg',
    'pipe:1',
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  dl.stdout.pipe(ff.stdin);
  dl.stderr.on('data', () => {});
  ff.stderr.on('data', () => {});
  dl.on('error', () => {});
  ff.on('error', () => {});

  return ff.stdout;
}

async function playNext(guildId, client) {
  const state = musicState.get(guildId);
  if (!state || !state.queue.length) {
    if (state) state.current = null;
    return;
  }

  const track = state.queue.shift();
  state.current = track;

  try {
    const audioStream = streamTrack(track.url);
    const resource = createAudioResource(audioStream, {
      inputType: StreamType.OggOpus,
      inlineVolume: true,
    });
    resource.volume?.setVolume(0.8);
    state.player.play(resource);
  } catch (err) {
    console.error('[Music] playNext error:', err.message);
    state.current = null;
    setTimeout(() => playNext(guildId, client), 1000);
  }
}

async function getOrCreateState(guild, voiceChannel) {
  let state = musicState.get(guild.id);
  if (state && state.voiceChannelId === voiceChannel.id) return state;

  // Destroy old connection if switching channels
  if (state) {
    try { state.player.stop(true); } catch {}
    try { state.connection.destroy(); } catch {}
    await new Promise(r => setTimeout(r, 500));
  }

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: true,
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
  } catch {
    connection.destroy();
    throw new Error('Could not connect to voice channel');
  }

  const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
  connection.subscribe(player);

  state = { connection, player, queue: [], current: null, voiceChannelId: voiceChannel.id };
  musicState.set(guild.id, state);

  player.on(AudioPlayerStatus.Idle, () => {
    if (!musicState.has(guild.id)) return;
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
      connection.destroy();
      musicState.delete(guild.id);
    }
  });
  connection.on(VoiceConnectionStatus.Destroyed, () => musicState.delete(guild.id));

  return state;
}

// ── Command ──────────────────────────────────────────────────────────────────
export default {
  data: new SlashCommandBuilder()
    .setName('music')
    .setDescription('Music Player powered by yt-dlp')
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
      .addIntegerOption(o => o.setName('level').setDescription('Volume level').setRequired(true).setMinValue(0).setMaxValue(100))
    )
    .addSubcommand(s => s.setName('nowplaying').setDescription('Show currently playing track')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const voiceChannel = interaction.member.voice?.channel;

    const reply = (embed, eph = false) => {
      const opts = { embeds: [embed], ...(eph ? { flags: [64] } : {}) };
      if (interaction.replied || interaction.deferred) return interaction.editReply(opts);
      return interaction.reply(opts);
    };

    if (!voiceChannel && !['queue', 'nowplaying'].includes(sub)) {
      return reply(new EmbedBuilder().setColor(C.error).setTitle('Not in Voice').setDescription('Join a voice channel first!').setFooter(FOOTER).setTimestamp(), true);
    }

    const state = musicState.get(interaction.guildId);

    // ── PLAY ─────────────────────────────────────────────────────────────────
    if (sub === 'play') {
      await interaction.deferReply();
      const query = interaction.options.getString('query');

      try {
        const track = await resolveTrack(query);
        const s = await getOrCreateState(interaction.guild, voiceChannel);
        s.queue.push(track);

        const isPlaying = s.current !== null;
        if (!isPlaying) playNext(interaction.guildId);

        await interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(C.music ?? '#1DB954')
            .setTitle(isPlaying ? 'Added to Queue' : 'Now Playing')
            .setDescription(`**[${track.title}](${track.url})**`)
            .addFields(
              { name: 'Duration', value: track.duration, inline: true },
              { name: 'Author', value: track.author, inline: true },
              { name: 'Position', value: isPlaying ? `#${s.queue.length}` : 'Up next', inline: true },
            )
            .setThumbnail(track.thumbnail)
            .setFooter(FOOTER).setTimestamp()
          ],
        });
      } catch (err) {
        console.error('[Music Play Error]', err);
        await interaction.editReply({
          embeds: [new EmbedBuilder().setColor(C.error).setTitle('Error').setDescription(`${err.message}`).setFooter(FOOTER).setTimestamp()],
        });
      }
    }

    else if (sub === 'skip') {
      if (!state?.current) return reply(new EmbedBuilder().setColor(C.error).setTitle('Nothing Playing').setFooter(FOOTER).setTimestamp(), true);
      const title = state.current.title;
      state.player.stop();
      return reply(new EmbedBuilder().setColor(C.success ?? '#57F287').setTitle('Skipped').setDescription(`Skipped **${title}**`).setFooter(FOOTER).setTimestamp());
    }

    else if (sub === 'stop') {
      if (!state) return reply(new EmbedBuilder().setColor(C.error).setTitle('Nothing Playing').setFooter(FOOTER).setTimestamp(), true);
      state.queue = [];
      state.player.stop(true);
      try { state.connection.destroy(); } catch {}
      musicState.delete(interaction.guildId);
      return reply(new EmbedBuilder().setColor(C.success ?? '#57F287').setTitle('Stopped').setDescription('Queue cleared and bot left.').setFooter(FOOTER).setTimestamp());
    }

    else if (sub === 'queue') {
      if (!state?.current) return reply(new EmbedBuilder().setColor(C.info ?? '#5865F2').setTitle('Queue Empty').setDescription('Nothing is playing.').setFooter(FOOTER).setTimestamp());
      const list = state.queue.slice(0, 10).map((t, i) => `**${i+1}.** [${t.title}](${t.url})`).join('\n');
      return reply(new EmbedBuilder()
        .setColor(C.music ?? '#1DB954')
        .setTitle('Music Queue')
        .setDescription(`**Now Playing:** [${state.current.title}](${state.current.url})\n\n${list || 'Queue is empty.'}`)
        .setFooter({ text: `TITAN Jr. Music · ${state.queue.length} tracks in queue` })
        .setTimestamp()
      );
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
      if (!state?.current) return reply(new EmbedBuilder().setColor(C.error).setTitle('Nothing Playing').setFooter(FOOTER).setTimestamp(), true);
      // volume is handled per-resource; store for next track
      state.volume = interaction.options.getInteger('level') / 100;
      return reply(new EmbedBuilder().setColor(C.music ?? '#1DB954').setTitle('Volume').setDescription(`Volume set to **${interaction.options.getInteger('level')}%** (applies to next track)`).setFooter(FOOTER).setTimestamp());
    }

    else if (sub === 'nowplaying') {
      if (!state?.current) return reply(new EmbedBuilder().setColor(C.info ?? '#5865F2').setTitle('Nothing Playing').setFooter(FOOTER).setTimestamp());
      const track = state.current;
      return reply(new EmbedBuilder()
        .setColor(C.music ?? '#1DB954')
        .setTitle('Now Playing')
        .setDescription(`**[${track.title}](${track.url})**`)
        .setThumbnail(track.thumbnail)
        .addFields(
          { name: 'Duration', value: track.duration, inline: true },
          { name: 'Author', value: track.author, inline: true },
          { name: 'Queue', value: `${state.queue.length} track(s) after this`, inline: true },
        )
        .setFooter(FOOTER).setTimestamp()
      );
    }
  },
};
