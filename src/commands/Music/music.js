import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, VoiceConnectionStatus, StreamType, NoSubscriberBehavior,
  entersState,
} from '@discordjs/voice';
import { spawn, execSync, execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { C } from '../../utils/embeds.js';

const FOOTER = { text: 'TITAN Jr. Music' };

// ── Find yt-dlp ──────────────────────────────────────────────────────────────
function findYtDlp() {
  for (const p of ['/root/.nix-profile/bin/yt-dlp', '/app/venv/bin/yt-dlp', '/usr/bin/yt-dlp', 'yt-dlp']) {
    try { execSync(`${p} --version`, { stdio: 'pipe' }); console.log('[Music] yt-dlp found at:', p); return p; } catch {}
  }
  console.error('[Music] yt-dlp not found!');
  return 'yt-dlp';
}

// ── Find ffmpeg ───────────────────────────────────────────────────────────────
function findFFmpeg() {
  for (const p of [process.env.FFMPEG_PATH, '/root/.nix-profile/bin/ffmpeg', '/usr/bin/ffmpeg', 'ffmpeg']) {
    if (!p) continue;
    if (p === 'ffmpeg' || existsSync(p)) return p;
  }
  return 'ffmpeg';
}

const YTDLP = findYtDlp();
const FFMPEG = findFFmpeg();

// Per-guild music state
const musicState = new Map();

async function resolveTrack(query) {
  const isUrl = /^https?:\/\//.test(query);
  // No -f flag during info extraction — format selection only applies at download time
  const args = [
    '--dump-json',
    '--no-playlist',
    '--no-warnings',
    '--default-search', 'ytsearch',
    isUrl ? query : `ytsearch1:${query}`,
  ];
  return new Promise((resolve, reject) => {
    let out = '';
    let errOut = '';
    const proc = spawn(YTDLP, args);
    proc.stdout.on('data', d => { out += d; });
    proc.stderr.on('data', d => { errOut += d; });
    proc.on('close', code => {
      try {
        const lines = out.trim().split('\n').filter(l => l.startsWith('{'));
        if (!lines.length) {
          console.error('[Music] yt-dlp no JSON output. stderr:', errOut.slice(0, 300));
          return reject(new Error('Could not find that track'));
        }
        const info = JSON.parse(lines[0]);
        const dur = info.duration || 0;
        resolve({
          title:     info.title || query,
          url:       info.webpage_url || info.url || query,
          duration:  info.duration_string || `${Math.floor(dur/60)}:${String(dur%60).padStart(2,'0')}`,
          thumbnail: info.thumbnail || null,
          author:    info.uploader || info.channel || 'Unknown',
        });
      } catch (e) {
        console.error('[Music] yt-dlp parse error:', e.message, '| stderr:', errOut.slice(0, 300));
        reject(new Error('Could not find that track'));
      }
    });
    proc.on('error', e => {
      console.error('[Music] yt-dlp spawn error:', e.message);
      reject(new Error(`yt-dlp not found: ${e.message}`));
    });
  });
}

function createStream(url) {
  const dl = spawn(YTDLP, [
    '-f', 'bestaudio/best',
    '-o', '-',
    '--no-playlist',
    '--no-warnings',
    '--no-part',
    url,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  const ff = spawn(FFMPEG, [
    '-i', 'pipe:0',
    '-c:a', 'libopus',
    '-b:a', '96k',
    '-vbr', 'on',
    '-f', 'ogg',
    'pipe:1',
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  dl.stdout.pipe(ff.stdin);
  dl.stderr.on('data', d => { const s = d.toString(); if (!s.includes('fragment')) console.error('[Music][yt-dlp]', s.trim().slice(0,200)); });
  ff.stderr.on('data', () => {});
  dl.on('error', e => { console.error('[Music][yt-dlp spawn]', e.message); try { ff.kill(); } catch {} });
  ff.on('error', e => { console.error('[Music][ffmpeg spawn]', e.message); });

  return ff.stdout;
}

async function playNext(guildId) {
  const state = musicState.get(guildId);
  if (!state || !state.queue.length) {
    if (state) state.current = null;
    return;
  }
  const track = state.queue.shift();
  state.current = track;
  try {
    const resource = createAudioResource(createStream(track.url), {
      inputType: StreamType.OggOpus,
      inlineVolume: true,
    });
    resource.volume?.setVolume(state.volume ?? 0.8);
    state.player.play(resource);
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

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
  } catch {
    connection.destroy();
    throw new Error('Could not connect to voice channel — please try again');
  }

  const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
  connection.subscribe(player);

  const state = { connection, player, queue: [], current: null, voiceChannelId: voiceChannel.id, volume: 0.8, loop: false };
  musicState.set(guild.id, state);

  player.on(AudioPlayerStatus.Idle, () => {
    if (!musicState.has(guild.id)) return;
    const s = musicState.get(guild.id);
    if (s.loop && s.current) {
      s.queue.unshift(s.current);
    }
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
        const track = await resolveTrack(query);
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
        console.error('[Music Play Error]', err);
        await interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.error).setTitle('Error').setDescription(err.message).setFooter(FOOTER).setTimestamp()] });
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
        .setColor(C.music ?? '#1DB954')
        .setTitle('Music Queue')
        .setDescription(`**Now Playing:** [${state.current.title}](${state.current.url})\n\n${list || 'No more tracks.'}`)
        .setFooter({ text: `${state.queue.length} track(s) in queue · Loop: ${state.loop ? 'ON' : 'OFF'}` })
        .setTimestamp());
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
        .setColor(C.music ?? '#1DB954')
        .setTitle('Now Playing')
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
