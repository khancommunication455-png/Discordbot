import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { useMainPlayer, useQueue } from 'discord-player';
import { C } from '../../utils/embeds.js';

const FOOTER = { text: 'TITAN Jr. Music' };

export default {
  data: new SlashCommandBuilder()
    .setName('music')
    .setDescription('Advanced Music Player using discord-player')
    .addSubcommand(s => s
      .setName('play')
      .setDescription('Play a song from YouTube, Spotify, SoundCloud, etc.')
      .addStringOption(o => o.setName('query').setDescription('Song name or URL').setRequired(true))
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
    const player = useMainPlayer();
    
    // Most commands require a voice channel
    const voiceChannel = interaction.member.voice?.channel;
    if (!voiceChannel && sub !== 'queue' && sub !== 'nowplaying') {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(C.error).setTitle('Not in Voice').setDescription('Join a voice channel first!').setFooter(FOOTER).setTimestamp()],
        flags: [64]
      });
    }

    const reply = (embed, eph = false) => {
      if (interaction.replied || interaction.deferred) return interaction.editReply({ embeds: [embed] });
      return interaction.reply({ embeds: [embed], ...(eph ? { flags: [64] } : {}) });
    };

    const queue = useQueue(interaction.guildId);

    if (sub === 'play') {
      await interaction.deferReply();
      const query = interaction.options.getString('query');
      
      try {
        // FIXED: Added fallback search engine configuration so play-dl can index text keywords smoothly
        const { track } = await player.play(voiceChannel, query, {
          nodeOptions: {
            metadata: interaction,
            volume: 80,
            leaveOnEmpty: true,
            leaveOnEmptyCooldown: 300000,
            leaveOnEnd: true,
            leaveOnEndCooldown: 300000,
          },
          searchEngine: 'youtube'
        });

        await interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(C.music)
            .setTitle('Added to Queue')
            .setDescription(`**[${track.title}](${track.url})**`)
            .addFields(
              { name: 'Duration', value: track.duration, inline: true },
              { name: 'Author', value: track.author, inline: true }
            )
            .setThumbnail(track.thumbnail)
            .setFooter(FOOTER).setTimestamp()
          ]
        });
      } catch (err) {
        console.error('[Music Play Error]', err);
        await interaction.editReply({
          embeds: [new EmbedBuilder().setColor(C.error).setTitle('Error').setDescription(`Could not play track: ${err.message}`).setFooter(FOOTER).setTimestamp()]
        });
      }
    }

    else if (sub === 'skip') {
      if (!queue || !queue.isPlaying()) return reply(new EmbedBuilder().setColor(C.error).setTitle('Nothing Playing').setDescription('There is no music currently playing.').setFooter(FOOTER).setTimestamp(), true);
      const track = queue.currentTrack;
      queue.node.skip();
      return reply(new EmbedBuilder().setColor(C.success).setTitle('Skipped').setDescription(`Skipped **${track.title}**`).setFooter(FOOTER).setTimestamp());
    }

    else if (sub === 'stop') {
      if (!queue || !queue.isPlaying()) return reply(new EmbedBuilder().setColor(C.error).setTitle('Nothing Playing').setDescription('There is no music currently playing.').setFooter(FOOTER).setTimestamp(), true);
      queue.delete();
      return reply(new EmbedBuilder().setColor(C.success).setTitle('Stopped').setDescription('Queue cleared and bot left.').setFooter(FOOTER).setTimestamp());
    }

    else if (sub === 'queue') {
      if (!queue || !queue.isPlaying()) return reply(new EmbedBuilder().setColor(C.info).setTitle('Queue Empty').setDescription('Nothing is playing.').setFooter(FOOTER).setTimestamp());
      
      const currentTrack = queue.currentTrack;
      const tracks = queue.tracks.toArray();
      const list = tracks.slice(0, 10).map((t, i) => `**${i+1}.** [${t.title}](${t.url})`).join('\n');
      
      return reply(new EmbedBuilder()
        .setColor(C.music)
        .setTitle('Music Queue')
        .setDescription(`**Now Playing:** [${currentTrack.title}](${currentTrack.url})\n\n${list || 'Queue is empty.'}`)
        .setFooter({ text: `TITAN Jr. Music · ${tracks.length} tracks · Vol: ${queue.node.volume}%` })
        .setTimestamp()
      );
    }

    else if (sub === 'pause') {
      if (!queue || !queue.isPlaying()) return reply(new EmbedBuilder().setColor(C.error).setTitle('Nothing Playing').setFooter(FOOTER).setTimestamp(), true);
      queue.node.setPaused(true);
      return reply(new EmbedBuilder().setColor(C.music).setTitle('Paused').setFooter(FOOTER).setTimestamp());
    }

    else if (sub === 'resume') {
      if (!queue || !queue.isPlaying()) return reply(new EmbedBuilder().setColor(C.error).setTitle('Nothing Playing').setFooter(FOOTER).setTimestamp(), true);
      queue.node.setPaused(false);
      return reply(new EmbedBuilder().setColor(C.music).setTitle('Resumed').setFooter(FOOTER).setTimestamp());
    }

    else if (sub === 'loop') {
      if (!queue || !queue.isPlaying()) return reply(new EmbedBuilder().setColor(C.error).setTitle('Nothing Playing').setFooter(FOOTER).setTimestamp(), true);
      const isLoop = queue.repeatMode === 1; // 1 is track loop
      queue.setRepeatMode(isLoop ? 0 : 1);
      return reply(new EmbedBuilder().setColor(C.music).setTitle('Loop').setDescription(`Loop is now **${!isLoop ? 'ON' : 'OFF'}**`).setFooter(FOOTER).setTimestamp());
    }

    else if (sub === 'volume') {
      if (!queue || !queue.isPlaying()) return reply(new EmbedBuilder().setColor(C.error).setTitle('Nothing Playing').setFooter(FOOTER).setTimestamp(), true);
      const level = interaction.options.getInteger('level');
      queue.node.setVolume(level);
      return reply(new EmbedBuilder().setColor(C.music).setTitle('Volume').setDescription(`Volume set to **${level}%**`).setFooter(FOOTER).setTimestamp());
    }

    else if (sub === 'nowplaying') {
      if (!queue || !queue.isPlaying()) return reply(new EmbedBuilder().setColor(C.info).setTitle('Nothing Playing').setFooter(FOOTER).setTimestamp());
      const track = queue.currentTrack;
      const progress = queue.node.createProgressBar();
      
      return reply(new EmbedBuilder()
        .setColor(C.music)
        .setTitle('Now Playing')
        .setDescription(`**[${track.title}](${track.url})**\n\n${progress}`)
        .setThumbnail(track.thumbnail)
        .addFields(
          { name: 'Duration', value: track.duration, inline: true },
          { name: 'Author', value: track.author, inline: true },
        )
        .setFooter(FOOTER).setTimestamp()
      );
    }
  },
};