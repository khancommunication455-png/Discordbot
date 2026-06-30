/**
 * music.js — SkyBot v2 Music Player (SoundCloud + Spotify)
 *
 * SWITCHED FROM YOUTUBE: yt-dlp on Railway hits YouTube's bot-detection wall
 * ("Sign in to confirm you're not a bot") on every client spoof — this is an
 * IP-reputation block on Railway's datacenter IP ranges, not fixable via
 * yt-dlp tricks.
 *
 * NEW SOURCES:
 * - SoundCloud: direct search + stream via play-dl (no auth, no IP blocks)
 * - Spotify: play-dl can read track/playlist METADATA (title, artist, duration)
 *   but Spotify's actual audio is DRM-protected and cannot be streamed without
 *   a paid Spotify Premium + Connect SDK integration. So Spotify links are
 *   parsed for title+artist, then that text is searched on SoundCloud and the
 *   best matching track is played instead. This is the same approach most
 *   "Spotify support" Discord bots use under the hood.
 *
 * Supports:
 *   /music play query:lofi hip hop          → SoundCloud search
 *   /music play query:<soundcloud.com/...>  → direct SoundCloud track/url
 *   /music play query:<open.spotify.com/...>→ Spotify metadata → SoundCloud match
 */
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import {
  joinVoiceChannel, createAudioPlayer, createAudioResource,
  AudioPlayerStatus, StreamType, NoSubscriberBehavior,
  VoiceConnectionStatus, entersState,
} from '@discordjs/voice';
import play from 'play-dl';
import { getDb, saveDb } from '../../utils/db.js';
import { C } from '../../utils/embeds.js';

const FOOTER = { text: 'SkyBot v2 • Railway Edition' };

// ── play-dl needs a free SoundCloud client ID — fetched once, cached ──
let scClientReady = false;
async function ensureSoundCloudClient() {
  if (scClientReady) return;
  try {
    const clientID = await play.getFreeClientID();
    await play.setToken({ soundcloud: { client_id: clientID } });
    scClientReady = true;
    console.log('[Music] SoundCloud client ID acquired ✅');
  } catch (e) {
    console.error('[Music] Failed to get SoundCloud client ID:', e.message);
    throw new Error('Could not initialize SoundCloud. Try again shortly.');
  }
}

function formatDuration(sec) {
  sec = Math.floor(sec || 0);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ── Detect link type ──
function isSpotifyUrl(q) { return /open\.spotify\.com\/(track|album|playlist)/i.test(q); }
function isSoundCloudUrl(q) { return /soundcloud\.com\//i.test(q); }

// ── Resolve a query into a playable SoundCloud track ──
async function resolveTrack(query) {
  await ensureSoundCloudClient();

  // ── Spotify link: extract metadata, then search SoundCloud for a match ──
  if (isSpotifyUrl(query)) {
    let spotifyInfo;
    try {
      spotifyInfo = await play.spotify(query);
    } catch (e) {
      throw new Error('Could not read that Spotify link. Make sure it\'s a public track/playlist URL.');
    }

    if (spotifyInfo.type === 'track') {
      const searchQuery = `${spotifyInfo.name} ${spotifyInfo.artists?.[0]?.name ?? ''}`.trim();
      console.log(`[Music] Spotify track "${spotifyInfo.name}" → searching SoundCloud: "${searchQuery}"`);
      return await searchSoundCloud(searchQuery, { spotifyMeta: spotifyInfo });
    }

    if (spotifyInfo.type === 'playlist' || spotifyInfo.type === 'album') {
      // Return first track of playlist/album as a starting point
      const tracks = await spotifyInfo.all_tracks?.() ?? spotifyInfo.fetched_tracks?.get(1) ?? [];
      if (!tracks.length) throw new Error('Spotify playlist/album appears empty or private.');
      const first = tracks[0];
      const searchQuery = `${first.name} ${first.artists?.[0]?.name ?? ''}`.trim();
      console.log(`[Music] Spotify playlist first track "${first.name}" → SoundCloud: "${searchQuery}"`);
      return await searchSoundCloud(searchQuery, { spotifyMeta: first });
    }

    throw new Error('Unsupported Spotify link type.');
  }

  // ── Direct SoundCloud URL ──
  if (isSoundCloudUrl(query)) {
    let info;
    try {
      info = await play.soundcloud(query);
    } catch (e) {
      throw new Error('Could not load that SoundCloud link. It may be private or removed.');
    }
    if (info.type !== 'track') throw new Error('Only individual SoundCloud tracks are supported (not playlists yet).');
    return {
      url: info.url,
      title: info.name || 'Unknown',
      duration: info.durationInSec || 0,
      durationStr: formatDuration(info.durationInSec),
      thumbnail: info.thumbnail || '',
      author: info.user?.name || 'Unknown',
      scTrack: info,
    };
  }

  // ── Plain text search → SoundCloud ──
  return await searchSoundCloud(query);
}

async function searchSoundCloud(query, { spotifyMeta } = {}) {
  let results;
  try {
    results = await play.search(query, { source: { soundcloud: 'tracks' }, limit: 5 });
  } catch (e) {
    throw new Error(`SoundCloud search failed: ${e.message}`);
  }
  if (!results?.length) {
    throw new Error(spotifyMeta
      ? `Found the Spotify track "${spotifyMeta.name}" but no matching version exists on SoundCloud.`
      : 'No results found on SoundCloud for that search.');
  }
  const track = results[0];
  return {
    url: track.url,
    title: track.name || (spotifyMeta?.name ?? 'Unknown'),
    duration: track.durationInSec || 0,
    durationStr: formatDuration(track.durationInSec),
    thumbnail: track.thumbnail || '',
    author: track.user?.name || (spotifyMeta?.artists?.[0]?.name ?? 'Unknown'),
    scTrack: track,
    viaSpotify: !!spotifyMeta,
  };
}

// ── Get a playable audio stream for a resolved SoundCloud track ──
async function getAudioStream(track) {
  const streamInfo = await play.stream_from_info(track.scTrack, { quality: 1 });
  // streamInfo.stream is a Readable; streamInfo.type tells discord.js the encoding
  return streamInfo;
}

// ── Build a stable voice connection that reaches Ready ──
async function buildVoiceConnection(voiceChannel, guildId, adapterCreator) {
  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId,
    adapterCreator,
    selfDeaf: false,
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    console.log('[Music] Voice connection Ready ✅');
    return connection;
  } catch {
    try {
      await entersState(connection, VoiceConnectionStatus.Signalling, 10_000);
      await new Promise(r => setTimeout(r, 4000));
      console.log('[Music] Voice connection (Signalling+sleep) ✅');
      return connection;
    } catch {
      try { connection.destroy(); } catch {}
      throw new Error('Could not join voice channel. Check permissions.');
    }
  }
}

function getGuildState(client, guildId) {
  if (!client.musicQueues) client.musicQueues = new Map();
  if (!client.musicQueues.has(guildId)) {
    const db = getDb();
    const settings = db.musicSettings?.[guildId] || { volume: 100, loop: false };
    client.musicQueues.set(guildId, {
      queue: [], current: 0, player: null, connection: null,
      playing: false, paused: false, volume: settings.volume, loop: settings.loop,
    });
  }
  return client.musicQueues.get(guildId);
}

async function saveSettings(guildId, settings) {
  const db = getDb();
  if (!db.musicSettings) db.musicSettings = {};
  db.musicSettings[guildId] = settings;
  await saveDb();
}

async function playNext(client, guildId, textChannel) {
  const state = getGuildState(client, guildId);

  if (state.queue.length === 0 || state.current >= state.queue.length) {
    state.playing = false;
    state.current = 0;
    try {
      textChannel.send({ embeds: [new EmbedBuilder().setColor(C.info).setTitle('🎵 Queue finished').setFooter(FOOTER).setTimestamp()] });
    } catch {}
    return;
  }

  const track = state.queue[state.current];
  state.playing = true;
  state.paused = false;

  try {
    textChannel.send({
      embeds: [new EmbedBuilder()
        .setColor(C.music ?? 0xFF5500)
        .setTitle('▶️ Now Playing')
        .setDescription(`**${track.title}**\n${track.durationStr} • ${track.author}${track.viaSpotify ? '\n*(matched from Spotify via SoundCloud)*' : ''}`)
        .setFooter(FOOTER).setTimestamp()],
    });
  } catch {}

  if (!state.connection || state.connection.state.status === VoiceConnectionStatus.Destroyed) {
    console.warn('[Music] No voice connection — cannot play');
    state.playing = false;
    return;
  }

  try {
    await entersState(state.connection, VoiceConnectionStatus.Ready, 10_000);
  } catch {
    console.warn('[Music] Connection not Ready before play — continuing anyway');
  }

  let streamInfo;
  try {
    streamInfo = await getAudioStream(track);
  } catch (e) {
    console.error('[Music] Stream fetch failed:', e.message);
    try {
      textChannel.send({ embeds: [new EmbedBuilder().setColor(C.error).setTitle('❌ Playback Error').setDescription(`Could not stream this track: ${e.message.slice(0, 200)}`).setFooter(FOOTER).setTimestamp()] });
    } catch {}
    state.queue.splice(state.current, 1);
    return playNext(client, guildId, textChannel);
  }

  const resource = createAudioResource(streamInfo.stream, {
    inputType: streamInfo.type, // play-dl tells us the correct StreamType (usually Opus or Arbitrary)
    inlineVolume: false,
  });

  if (!state.player) {
    state.player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
    state.connection.subscribe(state.player);

    state.player.on(AudioPlayerStatus.Idle, () => {
      const s = getGuildState(client, guildId);
      if (s.loop) {
        playNext(client, guildId, textChannel);
      } else {
        s.current++;
        if (s.current < s.queue.length) {
          playNext(client, guildId, textChannel);
        } else {
          s.playing = false;
          s.queue = [];
          s.current = 0;
        }
      }
    });

    state.player.on('error', err => {
      console.error('[Music] Player error:', err.message);
      const s = getGuildState(client, guildId);
      s.current++;
      if (s.current < s.queue.length) playNext(client, guildId, textChannel);
      else { s.playing = false; s.queue = []; s.current = 0; }
    });
  } else {
    state.connection.subscribe(state.player);
  }

  state.player.play(resource);
  console.log(`[Music] Playing: ${track.title} (SoundCloud)`);
}

export default {
  data: new SlashCommandBuilder()
    .setName('music').setDescription('Music player (SoundCloud + Spotify)')
    .addSubcommand(s => s.setName('play').setDescription('Play a song from SoundCloud or a Spotify link').addStringOption(o => o.setName('query').setDescription('Song name, SoundCloud URL, or Spotify URL').setRequired(true)))
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
      const sourceLabel = isSpotifyUrl(query) ? 'Spotify' : isSoundCloudUrl(query) ? 'SoundCloud' : 'SoundCloud search';
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.info).setTitle('🔍 Searching...').setDescription(`**${sourceLabel}:** ${query.slice(0, 80)}`).setFooter(FOOTER).setTimestamp()] });

      let track;
      try { track = await resolveTrack(query); }
      catch (err) { return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.error).setTitle('❌ Search Failed').setDescription(err.message).setFooter(FOOTER).setTimestamp()] }); }

      state.queue.push(track);

      if (!state.connection || state.connection.state.status === VoiceConnectionStatus.Destroyed) {
        try {
          state.connection = await buildVoiceConnection(voiceChannel, guildId, interaction.guild.voiceAdapterCreator);
          if (state.player) state.connection.subscribe(state.player);
        } catch (err) {
          return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.error).setTitle('❌ Voice Error').setDescription(err.message).setFooter(FOOTER).setTimestamp()] });
        }
      }

      if (!state.playing) {
        state.current = state.queue.length - 1;
        playNext(client, guildId, interaction.channel);
      }

      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(C.success ?? 0x00FF00)
          .setTitle('✅ Added to Queue')
          .setDescription(`**${track.title}**\n${track.durationStr} • ${track.author}${track.viaSpotify ? '\n*(Spotify → SoundCloud match)*' : ''}\nPosition: ${state.queue.length}`)
          .setFooter(FOOTER).setTimestamp()],
      });
    }

    if (sub === 'skip') {
      if (!state.player) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.error).setTitle('❌ Nothing Playing').setFooter(FOOTER).setTimestamp()] });
      state.player.stop();
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.success ?? 0x00FF00).setTitle('⏭️ Skipped').setFooter(FOOTER).setTimestamp()] });
    }

    if (sub === 'stop') {
      state.queue = []; state.current = 0; state.playing = false;
      try { state.player?.stop(); } catch {}
      try { state.connection?.destroy(); } catch {}
      state.connection = null; state.player = null;
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.success ?? 0x00FF00).setTitle('⏹️ Stopped').setFooter(FOOTER).setTimestamp()] });
    }

    if (sub === 'queue') {
      if (state.queue.length === 0) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.info).setTitle('📜 Queue Empty').setFooter(FOOTER).setTimestamp()] });
      const list = state.queue.map((t, i) => `${i === state.current ? '▶️' : `${i + 1}.`} **${t.title}** (${t.durationStr})`).join('\n');
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.music ?? 0xFF5500).setTitle('📜 Queue').setDescription(list.slice(0, 4000)).setFooter(FOOTER).setTimestamp()] });
    }

    if (sub === 'pause') {
      if (!state.player) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.error).setTitle('❌ Nothing Playing').setFooter(FOOTER).setTimestamp()] });
      state.player.pause(); state.paused = true;
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.success ?? 0x00FF00).setTitle('⏸️ Paused').setFooter(FOOTER).setTimestamp()] });
    }

    if (sub === 'resume') {
      if (!state.player) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.error).setTitle('❌ Nothing Playing').setFooter(FOOTER).setTimestamp()] });
      state.player.unpause(); state.paused = false;
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.success ?? 0x00FF00).setTitle('▶️ Resumed').setFooter(FOOTER).setTimestamp()] });
    }

    if (sub === 'loop') {
      state.loop = !state.loop;
      await saveSettings(guildId, { volume: state.volume, loop: state.loop });
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.success ?? 0x00FF00).setTitle(state.loop ? '🔁 Loop ON' : '🔁 Loop OFF').setFooter(FOOTER).setTimestamp()] });
    }

    if (sub === 'volume') {
      state.volume = interaction.options.getInteger('level');
      await saveSettings(guildId, { volume: state.volume, loop: state.loop });
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.success ?? 0x00FF00).setTitle(`🔊 Volume: ${state.volume}%`).setFooter(FOOTER).setTimestamp()] });
    }

    if (sub === 'nowplaying') {
      if (!state.playing || state.queue.length === 0) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.error).setTitle('❌ Nothing Playing').setFooter(FOOTER).setTimestamp()] });
      const t = state.queue[state.current];
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.music ?? 0xFF5500).setTitle('▶️ Now Playing').setDescription(`**${t.title}**\n${t.durationStr} • ${t.author}`).setFooter(FOOTER).setTimestamp()] });
    }

    if (sub === 'shuffle') {
      if (state.queue.length < 2) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.error).setTitle('❌ Not enough songs').setFooter(FOOTER).setTimestamp()] });
      const current = state.queue[state.current];
      const rest = state.queue.filter((_, i) => i !== state.current);
      rest.sort(() => Math.random() - 0.5);
      state.queue = [current, ...rest];
      state.current = 0;
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.success ?? 0x00FF00).setTitle('🔀 Shuffled').setFooter(FOOTER).setTimestamp()] });
    }
  },
};
