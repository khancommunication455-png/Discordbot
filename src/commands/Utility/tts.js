import { SlashCommandBuilder, ChannelType, EmbedBuilder } from 'discord.js';
import { setupTTS, stopTTS, getTTSState, enqueueTTS, clearTTSQueue } from '../../services/ttsService.js';
import { getDb, saveDb } from '../../utils/db.js';
import { C } from '../../utils/embeds.js';

const FOOTER = { text: 'TITAN Jr. TTS • StreamElements' };

export default {
  data: new SlashCommandBuilder()
    .setName('tts')
    .setDescription('Text-to-Speech — reads a text channel aloud in a voice channel')
    .addSubcommand(s => s
      .setName('start')
      .setDescription('Start TTS — bot joins voice and reads messages from a text channel')
      .addChannelOption(o =>
        o.setName('voice_channel')
         .setDescription('Voice channel for bot to join')
         .addChannelTypes(ChannelType.GuildVoice)
         .setRequired(true)
      )
      .addChannelOption(o =>
        o.setName('text_channel')
         .setDescription('Text channel to read messages from (default: current channel)')
         .addChannelTypes(ChannelType.GuildText)
         .setRequired(false)
      )
    )
    .addSubcommand(s => s
      .setName('stop')
      .setDescription('Stop TTS and leave the voice channel')
    )
    .addSubcommand(s => s
      .setName('say')
      .setDescription('Make TTS speak something immediately')
      .addStringOption(o =>
        o.setName('text').setDescription('What to say').setRequired(true)
      )
    )
    .addSubcommand(s => s
      .setName('skip')
      .setDescription('Stop current speech and clear the queue')
    )
    .addSubcommand(s => s
      .setName('status')
      .setDescription('Show TTS status for this server')
    ),

  async execute(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const sub     = interaction.options.getSubcommand();
    const db      = getDb();
    const guildId = interaction.guildId;

    // ── START ─────────────────────────────────────────────────────────
    if (sub === 'start') {
      const voiceChannel = interaction.options.getChannel('voice_channel');
      const textChannel  = interaction.options.getChannel('text_channel') ?? interaction.channel;

      try {
        await setupTTS(interaction.guild, voiceChannel.id, textChannel.id);
        db.data.ttsChannels[guildId]     = textChannel.id;
        db.data.ttsVoiceChannel[guildId] = voiceChannel.id;
        await saveDb();

        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(C.tts)
            .setTitle('TTS Active')
            .setDescription(
              `Reading messages from <#${textChannel.id}> aloud in **${voiceChannel.name}**\n\n` +
              `**Language detection (automatic):**\n` +
              `⬥ Roman Urdu → *"bhai kya haal yaar"* → Brian voice\n` +
              `⬥ اردو script → Google Urdu voice\n` +
              `⬥ हिन्दी → Google Hindi voice\n` +
              `⬥ English → Brian voice\n\n` +
              `Just type in <#${textChannel.id}> — I'll read every message aloud!`
            )
            .addFields(
              { name: '📝 Reading',  value: `<#${textChannel.id}>`,      inline: true },
              { name: '🔊 Speaking', value: `**${voiceChannel.name}**`,  inline: true },
            )
            .setFooter(FOOTER).setTimestamp()
          ],
        });
      } catch (err) {
        return interaction.editReply({
          embeds: [new EmbedBuilder().setColor(C.error).setTitle('TTS Failed').setDescription(err.message).setFooter(FOOTER).setTimestamp()],
        });
      }
    }

    // ── STOP ──────────────────────────────────────────────────────────
    if (sub === 'stop') {
      stopTTS(guildId);
      delete db.data.ttsChannels[guildId];
      delete db.data.ttsVoiceChannel[guildId];
      await saveDb();
      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor(C.success).setTitle('TTS Stopped').setDescription('Left the voice channel.').setFooter(FOOTER).setTimestamp()],
      });
    }

    // ── SAY ───────────────────────────────────────────────────────────
    if (sub === 'say') {
      const state = getTTSState(guildId);
      if (!state) {
        return interaction.editReply({
          embeds: [new EmbedBuilder().setColor(C.error).setTitle('TTS Not Active').setDescription('Start TTS first: `/tts start #voice-channel`').setFooter(FOOTER).setTimestamp()],
        });
      }
      const text = interaction.options.getString('text');
      await enqueueTTS(interaction.guild, text, interaction.user.username);
      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor(C.success).setTitle('Queued').setDescription(`Speaking: *"${text.slice(0, 100)}"*`).setFooter(FOOTER).setTimestamp()],
      });
    }

    // ── SKIP ──────────────────────────────────────────────────────────
    if (sub === 'skip') {
      const state = getTTSState(guildId);
      if (!state) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.error).setTitle('Not Active').setDescription('TTS is not running.').setFooter(FOOTER).setTimestamp()] });
      clearTTSQueue(guildId);
      state.player?.stop();
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.success).setTitle('Skipped').setDescription('Queue cleared.').setFooter(FOOTER).setTimestamp()] });
    }

    // ── STATUS ────────────────────────────────────────────────────────
    if (sub === 'status') {
      const state   = getTTSState(guildId);
      const ttsChId = db.data.ttsChannels?.[guildId];
      const vcId    = db.data.ttsVoiceChannel?.[guildId];

      if (!state) {
        return interaction.editReply({
          embeds: [new EmbedBuilder().setColor(C.info).setTitle('TTS Inactive').setDescription('Use `/tts start #voice-channel` to enable.').setFooter(FOOTER).setTimestamp()],
        });
      }

      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(C.success)
          .setTitle('TTS Active')
          .addFields(
            { name: 'Text Channel',  value: ttsChId ? `<#${ttsChId}>` : '?', inline: true },
            { name: 'Voice Channel', value: vcId    ? `<#${vcId}>`    : '?', inline: true },
            { name: 'Queue',         value: `${state.queue.length} pending`,  inline: true },
            { name: 'Speaking',      value: state.active ? 'Yes' : 'No',      inline: true },
          )
          .setFooter(FOOTER).setTimestamp()
        ],
      });
    }
  },
};
