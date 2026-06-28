/**
 * tts.js — SkyBot v2 TTS & Voice AI Command
 *
 * Subcommands:
 *   /tts start  [voice_channel] [text_channel] [ai_mode] — join VC, read channel
 *   /tts stop   — leave VC
 *   /tts say    [text] — speak something immediately
 *   /tts ai     [enabled] — toggle AI assistant mode
 *   /tts skip   — stop current + clear queue
 *   /tts status — show current status
 *   /tts move   [voice_channel] — move bot to another VC
 */
import { SlashCommandBuilder, ChannelType, EmbedBuilder } from 'discord.js';
import {
  setupTTS, stopTTS, getTTSState, enqueueTTS, clearTTSQueue, setAIMode, moveTTS,
} from '../../services/ttsService.js';
import { getDb, saveDb } from '../../utils/db.js';
import { C } from '../../utils/embeds.js';

const FOOTER = { text: 'SkyBot v2 TTS • Railway Edition' };
const AI_AVAILABLE = !!process.env.GROQ_API_KEY;

export default {
  data: new SlashCommandBuilder()
    .setName('tts')
    .setDescription('Voice AI — bot reads your text channel & can respond with AI')
    .addSubcommand(s => s
      .setName('start')
      .setDescription('Join a voice channel and start reading messages')
      .addChannelOption(o => o
        .setName('voice_channel').setDescription('Voice channel for bot to join')
        .addChannelTypes(ChannelType.GuildVoice).setRequired(true))
      .addChannelOption(o => o
        .setName('text_channel').setDescription('Text channel to read (default: current)')
        .addChannelTypes(ChannelType.GuildText).setRequired(false))
      .addBooleanOption(o => o
        .setName('ai_mode').setDescription('Enable AI assistant — bot replies with Groq AI')
        .setRequired(false)))
    .addSubcommand(s => s.setName('stop').setDescription('Stop TTS and leave the voice channel'))
    .addSubcommand(s => s
      .setName('say')
      .setDescription('Speak something in voice right now')
      .addStringOption(o => o
        .setName('text').setDescription('What to say (English / Roman Urdu / Hindi)')
        .setRequired(true).setMaxLength(300)))
    .addSubcommand(s => s
      .setName('ai')
      .setDescription('Toggle AI assistant mode — bot listens and responds via Groq')
      .addBooleanOption(o => o
        .setName('enabled').setDescription('Turn AI mode on or off').setRequired(true)))
    .addSubcommand(s => s.setName('skip').setDescription('Stop current speech and clear the queue'))
    .addSubcommand(s => s.setName('status').setDescription('Show TTS status for this server'))
    .addSubcommand(s => s
      .setName('move')
      .setDescription('Move bot to a different voice channel')
      .addChannelOption(o => o
        .setName('voice_channel').setDescription('New voice channel')
        .addChannelTypes(ChannelType.GuildVoice).setRequired(true))),

  cooldown: 3,

  async execute(interaction, client) {
    await interaction.deferReply({ flags: [64] });

    const sub = interaction.options.getSubcommand();
    const db = getDb();
    const guildId = interaction.guildId;

    // ── START ─────────────────────────────────────────────────
    if (sub === 'start') {
      const voiceChannel = interaction.options.getChannel('voice_channel');
      const textChannel = interaction.options.getChannel('text_channel') ?? interaction.channel;
      const aiMode = interaction.options.getBoolean('ai_mode') ?? false;

      if (aiMode && !AI_AVAILABLE) {
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(C.error)
            .setTitle('AI Mode Unavailable')
            .setDescription('`GROQ_API_KEY` is not set.\nAI mode requires a Groq API key (free at console.groq.com).')
            .setFooter(FOOTER).setTimestamp()],
        });
      }

      try {
        await setupTTS(interaction.guild, voiceChannel.id, textChannel.id, aiMode, client);

        if (!db.ttsChannels) db.ttsChannels = {};
        if (!db.ttsVoiceChannel) db.ttsVoiceChannel = {};
        if (!db.ttsAIMode) db.ttsAIMode = {};
        db.ttsChannels[guildId] = textChannel.id;
        db.ttsVoiceChannel[guildId] = voiceChannel.id;
        db.ttsAIMode[guildId] = aiMode;
        await saveDb();

        const modeDesc = aiMode
          ? `🤖 **AI Mode ON** — I'll read messages AND reply with Groq AI\nMessages in <#${textChannel.id}> → I respond aloud`
          : `📢 **Read Mode** — I'll read every message in <#${textChannel.id}> aloud`;

        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(aiMode ? C.ai : C.tts)
            .setTitle(aiMode ? '🤖 Voice AI — Active' : '🔊 TTS Active')
            .setDescription(modeDesc)
            .addFields(
              { name: '📝 Reading', value: `<#${textChannel.id}>`, inline: true },
              { name: '🔊 Speaking', value: `**${voiceChannel.name}**`, inline: true },
              { name: '🤖 AI Mode', value: aiMode ? 'Enabled ✅' : 'Off', inline: true },
              { name: '✨ Engine', value: 'StreamElements + Google TTS (Railway-proof)', inline: false },
            )
            .setFooter(FOOTER).setTimestamp()],
        });
      } catch (err) {
        console.error('[TTS] Setup error:', err);
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(C.error)
            .setTitle('TTS Failed')
            .setDescription(err.message)
            .addFields({ name: 'Fix', value: 'Make sure bot has **Connect** and **Speak** permissions in that voice channel.' })
            .setFooter(FOOTER).setTimestamp()],
        });
      }
    }

    // ── STOP ──────────────────────────────────────────────────
    if (sub === 'stop') {
      stopTTS(guildId);
      delete db.ttsChannels?.[guildId];
      delete db.ttsVoiceChannel?.[guildId];
      delete db.ttsAIMode?.[guildId];
      await saveDb();
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(C.success).setTitle('TTS Stopped')
          .setDescription('Left the voice channel. Use `/tts start` to begin again.')
          .setFooter(FOOTER).setTimestamp()],
      });
    }

    // ── SAY ───────────────────────────────────────────────────
    if (sub === 'say') {
      const state = getTTSState(guildId);
      if (!state) {
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(C.error).setTitle('TTS Not Active')
            .setDescription('Start TTS first: `/tts start #voice-channel`')
            .setFooter(FOOTER).setTimestamp()],
        });
      }
      const text = interaction.options.getString('text');
      await enqueueTTS(interaction.guild, text, interaction.user.username, false);
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(C.success).setTitle('Queued ✅')
          .setDescription(`Speaking: *"${text.slice(0, 100)}"*`)
          .setFooter(FOOTER).setTimestamp()],
      });
    }

    // ── AI TOGGLE ─────────────────────────────────────────────
    if (sub === 'ai') {
      if (!AI_AVAILABLE) {
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(C.error).setTitle('AI Unavailable')
            .setDescription('Set `GROQ_API_KEY` to enable AI mode.')
            .setFooter(FOOTER).setTimestamp()],
        });
      }
      const state = getTTSState(guildId);
      if (!state) {
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(C.error).setTitle('TTS Not Active')
            .setDescription('Start TTS first: `/tts start #voice-channel`')
            .setFooter(FOOTER).setTimestamp()],
        });
      }
      const enabled = interaction.options.getBoolean('enabled');
      setAIMode(guildId, enabled);
      if (!db.ttsAIMode) db.ttsAIMode = {};
      db.ttsAIMode[guildId] = enabled;
      await saveDb();
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(enabled ? C.ai : C.info)
          .setTitle(enabled ? '🤖 AI Mode Enabled' : '📢 AI Mode Disabled')
          .setDescription(enabled
            ? 'Messages will be processed by **Groq AI (Llama 3.3 70B)**. I\'ll reply aloud and post in the text channel.'
            : 'Back to normal read mode — just reading messages aloud.')
          .setFooter(FOOTER).setTimestamp()],
      });
    }

    // ── SKIP ──────────────────────────────────────────────────
    if (sub === 'skip') {
      const state = getTTSState(guildId);
      if (!state) {
        return interaction.editReply({
          embeds: [new EmbedBuilder().setColor(C.error).setTitle('Not Active')
            .setDescription('TTS is not running.').setFooter(FOOTER).setTimestamp()],
        });
      }
      clearTTSQueue(guildId);
      try { state.player?.stop(); } catch {}
      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor(C.success).setTitle('Skipped ✅')
          .setDescription('Current speech stopped, queue cleared.').setFooter(FOOTER).setTimestamp()],
      });
    }

    // ── MOVE ──────────────────────────────────────────────────
    if (sub === 'move') {
      const newVC = interaction.options.getChannel('voice_channel');
      const ok = await moveTTS(interaction.guild, newVC.id);
      if (!ok) {
        return interaction.editReply({
          embeds: [new EmbedBuilder().setColor(C.error).setTitle('Move Failed')
            .setDescription('Could not move to the new voice channel.').setFooter(FOOTER).setTimestamp()],
        });
      }
      if (!db.ttsVoiceChannel) db.ttsVoiceChannel = {};
      db.ttsVoiceChannel[guildId] = newVC.id;
      await saveDb();
      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor(C.success).setTitle('Moved ✅')
          .setDescription(`Now speaking in **${newVC.name}**`).setFooter(FOOTER).setTimestamp()],
      });
    }

    // ── STATUS ────────────────────────────────────────────────
    if (sub === 'status') {
      const state = getTTSState(guildId);
      const ttsChId = db.ttsChannels?.[guildId];
      const vcId = db.ttsVoiceChannel?.[guildId];

      if (!state) {
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(C.info).setTitle('TTS Inactive')
            .setDescription('Use `/tts start #voice-channel` to enable.')
            .setFooter(FOOTER).setTimestamp()],
        });
      }

      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(state.aiMode ? C.ai : C.success)
          .setTitle(state.aiMode ? '🤖 Voice AI Active' : '🔊 TTS Active')
          .addFields(
            { name: 'Text Channel', value: ttsChId ? `<#${ttsChId}>` : '?', inline: true },
            { name: 'Voice Channel', value: vcId ? `<#${vcId}>` : '?', inline: true },
            { name: 'AI Mode', value: state.aiMode ? '🤖 On' : '📢 Off', inline: true },
            { name: 'Queue', value: `${state.queue?.length || 0} pending`, inline: true },
            { name: 'Speaking', value: state.active ? '🔴 Yes' : '🟢 Idle', inline: true },
            { name: 'Connection', value: state.connectionDead ? '❌ Dead (rejoining)' : '✅ Live', inline: true },
          )
          .setFooter(FOOTER).setTimestamp()],
      });
    }
  },
};
