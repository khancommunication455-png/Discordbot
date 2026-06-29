/**
 * music.js — SkyBot v2 Music Player (OggOpus + 6 YouTube clients)
 */
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, StreamType, NoSubscriberBehavior, VoiceConnectionStatus, entersState } from '@discordjs/voice';
import { spawn, execSync } from 'child_process';
import { existsSync } from 'fs';
import { getDb, saveDb } from '../../utils/db.js';
import { C } from '../../utils/embeds.js';

const FOOTER = { text: 'SkyBot v2 • Railway Edition' };

function findBin(name, paths) {
  for (const p of paths) { try { if (p === name) { execSync(`${p} --version`, { stdio: 'pipe', timeout: 5000 }); return p; } if (existsSync(p)) return p; } catch {} }
  return name;
}

const YTDLP = findBin('yt-dlp', ['/root/.nix-profile/bin/yt-dlp', '/usr/bin/yt-dlp', '/usr/local/bin/yt-dlp', 'yt-dlp']);
const FFMPEG = findBin('ffmpeg', ['/root/.nix-profile/bin/ffmpeg', '/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', 'ffmpeg']);
console.log(`[Music] yt-dlp: ${YTDLP} | ffmpeg: ${FFMPEG}`);

function spawnCapture(bin, args, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; try { proc.kill(); } catch {}; reject(new Error('timeout')); } }, timeoutMs);
    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);
    proc.on('error', err => { if (!settled) { settled = true; clearTimeout(timer); reject(err); } });
    proc.on('close', code => { if (settled) return; settled = true; clearTimeout(timer); if (code === 0) resolve(stdout); else reject(new Error(`${bin} exited ${code}: ${stderr.slice(0, 300)}`)); });
  });
}

const PLAYER_CLIENTS = ['tv', 'web_embedded', 'web_safari', 'web', 'android', 'ios'];
const BASE_ARGS = ['--no-playlist', '--no-warnings', '--no-progress', '--no-cookies', '--no-check-certificates'];

async function getVideoInfo(query) {
  const isUrl = /^https?:\/\//.test(query);
  const target = isUrl ? query : `ytsearch1:${query}`;
  for (const client of PLAYER_CLIENTS) {
    try {
      const json = await spawnCapture(YTDLP, ['-J', ...BASE_ARGS, '--extractor-args', `youtube:player_client=${client}`, target], 25000);
      const info = JSON.parse(json);
      const v = info.entries?.length ? info.entries[0] : info;
      const dur = parseInt(v.duration, 10) || 0;
      console.log(`[Music] search via ${client} ✅`);
      return { url: v.webpage_url || v.url || query, title: v.title || 'Unknown', duration: dur, durationStr: v.duration_string || (dur > 0 ? `${Math.floor(dur/60)}:${String(dur%60).padStart(2,'0')}` : 'LIVE'), thumbnail: v.thumbnail || '', author: v.uploader || v.channel || 'Unknown' };
    } catch (err) { console.warn(`[Music] search ${client} failed: ${String(err.message||err).slice(0,100)}`); }
  }
  throw new Error('YouTube is blocking the bot. Try again later or use a direct URL.');
}

async function getAudioUrl(videoUrl) {
  for (const client of PLAYER_CLIENTS) {
    try {
      const out = await spawnCapture(YTDLP, ['-f', 'bestaudio/best', '--format-sort', 'has_audio,abr', '-g', ...BASE_ARGS, '--extractor-args', `youtube:player_client=${client}`, videoUrl], 20000);
      const url = out.split('\n').map(s => s.trim()).filter(Boolean)[0];
      if (url) { console.log(`[Music] audio via ${client} ✅`); return url; }
    } catch (err) { console.warn(`[Music] audio ${client} failed: ${String(err.message||err).slice(0,100)}`); }
  }
  return null;
}

function createAudioStream(audioUrl) {
  // OggOpus encoding via ffmpeg libopus — no native encoder needed
  const ff = spawn(FFMPEG, ['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5', '-i', audioUrl, '-vn', '-c:a', 'libopus', '-b:a', '96k', '-ar', '48000', '-ac', '2', '-application', 'voip', '-frame_duration', '20', '-f', 'ogg', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
  ff.stderr.on('data', () => {});
  return ff;
}

function getGuildState(client, guildId) {
  if (!client.musicQueues) client.musicQueues = new Map();
  if (!client.musicQueues.has(guildId)) {
    const db = getDb();
    const settings = db.musicSettings?.[guildId] || { volume: 100, loop: false };
    client.musicQueues.set(guildId, { queue: [], current: 0, player: null, connection: null, playing: false, paused: false, volume: settings.volume, loop: settings.loop });
  }
  return client.musicQueues.get(guildId);
}

async function saveSettings(guildId, settings) {
  const db = getDb(); if (!db.musicSettings) db.musicSettings = {};
  db.musicSettings[guildId] = settings; await saveDb();
}

async function playNext(client, guildId, textChannel) {
  const state = getGuildState(client, guildId);
  if (state.queue.length === 0) { state.playing = false; try { textChannel.send({ embeds: [new EmbedBuilder().setColor(C.info).setTitle('🎵 Queue finished').setFooter(FOOTER).setTimestamp()] }); } catch {} return; }
  const track = state.queue[state.current];
  state.playing = true; state.paused = false;
  try { textChannel.send({ embeds: [new EmbedBuilder().setColor(C.music).setTitle('▶️ Now Playing').setDescription(`**${track.title}**\n${track.durationStr} • ${track.author}`).setFooter(FOOTER).setTimestamp()] }); } catch {}

  if (state.connection) { try { await entersState(state.connection, VoiceConnectionStatus.Ready, 15000); console.log('[Music] Voice Ready ✅'); } catch { console.warn('[Music] Voice not Ready'); } }

  const audioUrl = await getAudioUrl(track.url);
  if (!audioUrl) { try { textChannel.send({ embeds: [new EmbedBuilder().setColor(C.error).setTitle('❌ Playback Error').setDescription('Could not get audio URL. YouTube may be blocking.').setFooter(FOOTER).setTimestamp()] }); } catch {} state.queue.splice(state.current, 1); return playNext(client, guildId, textChannel); }

  const ff = createAudioStream(audioUrl);
  const resource = createAudioResource(ff.stdout, { inputType: StreamType.OggOpus, inlineVolume: false });

  if (!state.player) {
    state.player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
    state.connection?.subscribe(state.player);
    state.player.on(AudioPlayerStatus.Idle, () => {
      const s = getGuildState(client, guildId);
      if (s.loop) { playNext(client, guildId, textChannel); }
      else { s.current++; if (s.current < s.queue.length) playNext(client, guildId, textChannel); else { s.playing = false; s.queue = []; s.current = 0; } }
    });
    state.player.on('error', err => console.error('[Music] Player error:', err.message));
  }
  state.player.play(resource);
}

export default {
  data: new SlashCommandBuilder().setName('music').setDescription('Music player')
    .addSubcommand(s => s.setName('play').setDescription('Play a song').addStringOption(o => o.setName('query').setDescription('Song name or URL').setRequired(true)))
    .addSubcommand(s => s.setName('skip').setDescription('Skip current song'))
    .addSubcommand(s => s.setName('stop').setDescription('Stop and clear queue'))
    .addSubcommand(s => s.setName('queue').setDescription('Show queue'))
    .addSubcommand(s => s.setName('pause').setDescription('Pause'))
    .addSubcommand(s => s.setName('resume').setDescription('Resume'))
    .addSubcommand(s => s.setName('loop').setDescription('Toggle loop'))
    .addSubcommand(s => s.setName('volume').setDescription('Set volume').addIntegerOption(o => o.setName('level').setDescription('0-100').setMinValue(0).setMaxValue(100).setRequired(true)))
    .addSubcommand(s => s.setName('nowplaying').setDescription('Show current song'))
    .addSubcommand(s => s.setName('shuffle').setDescription('Shuffle queue')),
  cooldown: 1,
  async execute(interaction, client) {
    await interaction.deferReply();
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const state = getGuildState(client, guildId);

    if (sub === 'play') {
      const voiceChannel = interaction.member?.voice?.channel;
      if (!voiceChannel) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.error).setTitle('❌ Not in Voice').setDescription('Join a voice channel first.').setFooter(FOOTER).setTimestamp()] });
      const query = interaction.options.getString('query');
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.info).setTitle('🔍 Searching...').setDescription(`Looking up: **${query}**`).setFooter(FOOTER).setTimestamp()] });
      let track; try { track = await getVideoInfo(query); } catch (err) { return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.error).setTitle('❌ Search Failed').setDescription(err.message).setFooter(FOOTER).setTimestamp()] }); }
      state.queue.push(track);
      if (!state.connection || state.connection.state.status === 'Destroyed') { state.connection = joinVoiceChannel({ channelId: voiceChannel.id, guildId, adapterCreator: interaction.guild.voiceAdapterCreator, selfDeaf: false }); }
      if (!state.playing) { state.current = state.queue.length - 1; playNext(client, guildId, interaction.channel); }
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.success).setTitle('✅ Added to Queue').setDescription(`**${track.title}**\n${track.durationStr} • ${track.author}\nPosition: ${state.queue.length}`).setFooter(FOOTER).setTimestamp()] });
    }
    if (sub === 'skip') { if (!state.player) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.error).setTitle('❌ Nothing Playing').setFooter(FOOTER).setTimestamp()] }); state.player.stop(); return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.success).setTitle('⏭️ Skipped').setFooter(FOOTER).setTimestamp()] }); }
    if (sub === 'stop') { state.queue = []; state.current = 0; state.playing = false; try { state.player?.stop(); } catch {}; try { state.connection?.destroy(); } catch {}; state.connection = null; state.player = null; return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.success).setTitle('⏹️ Stopped').setFooter(FOOTER).setTimestamp()] }); }
    if (sub === 'queue') { if (state.queue.length === 0) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.info).setTitle('📜 Queue Empty').setFooter(FOOTER).setTimestamp()] }); const list = state.queue.map((t, i) => `${i === state.current ? '▶️' : `${i+1}.`} **${t.title}** (${t.durationStr})`).join('\n'); return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.music).setTitle('📜 Queue').setDescription(list.slice(0, 4000)).setFooter(FOOTER).setTimestamp()] }); }
    if (sub === 'pause') { if (!state.player) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.error).setTitle('❌ Nothing Playing').setFooter(FOOTER).setTimestamp()] }); state.player.pause(); state.paused = true; return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.success).setTitle('⏸️ Paused').setFooter(FOOTER).setTimestamp()] }); }
    if (sub === 'resume') { if (!state.player) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.error).setTitle('❌ Nothing Playing').setFooter(FOOTER).setTimestamp()] }); state.player.unpause(); state.paused = false; return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.success).setTitle('▶️ Resumed').setFooter(FOOTER).setTimestamp()] }); }
    if (sub === 'loop') { state.loop = !state.loop; await saveSettings(guildId, { volume: state.volume, loop: state.loop }); return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.success).setTitle(state.loop ? '🔁 Loop ON' : '🔁 Loop OFF').setFooter(FOOTER).setTimestamp()] }); }
    if (sub === 'volume') { state.volume = interaction.options.getInteger('level'); await saveSettings(guildId, { volume: state.volume, loop: state.loop }); return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.success).setTitle(`🔊 Volume: ${state.volume}%`).setFooter(FOOTER).setTimestamp()] }); }
    if (sub === 'nowplaying') { if (!state.playing || state.queue.length === 0) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.error).setTitle('❌ Nothing Playing').setFooter(FOOTER).setTimestamp()] }); const t = state.queue[state.current]; return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.music).setTitle('▶️ Now Playing').setDescription(`**${t.title}**\n${t.durationStr} • ${t.author}`).setFooter(FOOTER).setTimestamp()] }); }
    if (sub === 'shuffle') { if (state.queue.length < 2) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.error).setTitle('❌ Not enough songs').setFooter(FOOTER).setTimestamp()] }); const current = state.queue[state.current]; const rest = state.queue.filter((_, i) => i !== state.current); rest.sort(() => Math.random() - 0.5); state.queue = [current, ...rest]; return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.success).setTitle('🔀 Shuffled').setFooter(FOOTER).setTimestamp()] }); }
  },
};
