/**
 * tts.js — TITAN Jr. Voice AI Command
 *
 * Subcommands:
 *   /tts start  — bot joins VC, reads text channel
 *   /tts stop   — bot leaves VC
 *   /tts say    — speak something immediately
 *   /tts ai     — toggle AI assistant mode (Groq powered)
 *   /tts skip   — skip current + clear queue
 *   /tts status — show current status
 */

import { SlashCommandBuilder, ChannelType, EmbedBuilder } from 'discord.js';
import {
  setupTTS, stopTTS, getTTSState,
  enqueueTTS, clearTTSQueue, setAIMode,
} from '../../services/ttsService.js';
import { getDb, saveDb } from '../../utils/db.js';
import { C } from '../../utils/embeds.js';

const FOOTER = { text: 'TITAN Jr. TTS' };
const AI_AVAILABLE = !!process.env.GROQ_API_KEY;

export default {
  data: new SlashCommandBuilder()
    .setName('tts')
    .setDescription('Voice AI — bot reads your text channel & can respond with AI')

    // ── START ─────────────────────────────────────────────────────────
    .addSubcommand(s => s
      .setName('start')
      .setDescription('Join a voice channel and start reading messages')
      .addChannelOption(o => o
        .setName('voice_channel')
        .setDescription('Voice channel for bot to join')
        .addChannelTypes(ChannelType.GuildVoice)
        .setRequired(true)
      )
      .addChannelOption(o => o
        .setName('text_channel')
        .setDescription('Text channel to read (default: current channel)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
      )
      .addBooleanOption(o => o
        .setName('ai_mode')
        .setDescription('Enable AI assistant — bot replies to messages with Groq AI')
        .setRequired(false)
      )
    )

    // ── STOP ──────────────────────────────────────────────────────────
    .addSubcommand(s => s
      .setName('stop')
      .setDescription('Stop TTS and leave the voice channel')
    )

    // ── SAY ───────────────────────────────────────────────────────────
    .addSubcommand(s => s
      .setName('say')
      .setDescription('Speak something in voice right now')
      .addStringOption(o => o
        .setName('text')
        .setDescription('What to say (supports English / Roman Urdu / Hindi)')
        .setRequired(true)
        .setMaxLength(300)
      )
    )

    // ── AI MODE TOGGLE ────────────────────────────────────────────────
    .addSubcommand(s => s
      .setName('ai')
      .setDescription('Toggle AI assistant mode — bot listens and responds via Groq')
      .addBooleanOption(o => o
        .setName('enabled')
        .setDescription('Turn AI mode on or off')
        .setRequired(true)
      )
    )

    // ── SKIP ──────────────────────────────────────────────────────────
    .addSubcommand(s => s
      .setName('skip')
      .setDescription('Stop current speech and clear the queue')
    )

    // ── STATUS ────────────────────────────────────────────────────────
    .addSubcommand(s => s
      .setName('status')
      .setDescription('Show TTS status for this server')
    ),

  async execute(interaction, client) {
    await interaction.deferReply({ flags: [64] });

    const sub     = interaction.options.getSubcommand();
    const db      = getDb();
    const guildId = interaction.guildId;

    // ── START ─────────────────────────────────────────────────────────
    if (sub === 'start') {
      const voiceChannel = interaction.options.getChannel('voice_channel');
      const textChannel  = interaction.options.getChannel('text_channel') ?? interaction.channel;
      const aiMode       = interaction.options.getBoolean('ai_mode') ?? false;

      if (aiMode && !AI_AVAILABLE) {
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(C.error)
            .setTitle('AI Mode Unavailable')
            .setDescription('`GROQ_API_KEY` is not set in Railway environment variables.\nAI mode requires Groq API key.')
            .setFooter(FOOTER).setTimestamp()
          ],
        });
      }

      try {
        await setupTTS(interaction.guild, voiceChannel.id, textChannel.id, aiMode, client);

        // Persist to DB
        if (!db.data.ttsChannels)     db.data.ttsChannels     = {};
        if (!db.data.ttsVoiceChannel) db.data.ttsVoiceChannel = {};
        db.data.ttsChannels[guildId]     = textChannel.id;
        db.data.ttsVoiceChannel[guildId] = voiceChannel.id;
        await saveDb();

        const modeDesc = aiMode
          ? `🤖 **AI Mode ON** — I'll read messages AND reply with Groq AI\nMentions & messages in <#${textChannel.id}> → I respond aloud`
          : `📢 **Read Mode** — I'll read every message in <#${textChannel.id}> aloud\nType anything there and I'll speak it`;

        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(aiMode ? C.ai ?? '#9B59B6' : C.tts ?? '#00D4AA')
            .setTitle(aiMode ? '🤖 TITAN Jr. Voice AI — Active' : '🔊 TTS Active')
            .setDescription(modeDesc)
            .addFields(
              { name: '📝 Reading',   value: `<#${textChannel.id}>`,          inline: true },
              { name: '🔊 Speaking',  value: `**${voiceChannel.name}**`,       inline: true },
              { name: '🤖 AI Mode',   value: aiMode ? 'Enabled ✅' : 'Off',   inline: true },
            )
            .setFooter(FOOTER).setTimestamp()
          ],
        });
      } catch (err) {
        console.error('[TTS] Setup error:', err);
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(C.error)
            .setTitle('TTS Failed')
            .setDescription(err.message)
            .addFields({ name: 'Fix', value: 'Make sure bot has **Connect** and **Speak** permissions in that voice channel.' })
            .setFooter(FOOTER).setTimestamp()
          ],
        });
      }
    }

    // ── STOP ──────────────────────────────────────────────────────────
    if (sub === 'stop') {
      stopTTS(guildId);
      delete db.data.ttsChannels?.[guildId];
      delete db.data.ttsVoiceChannel?.[guildId];
      await saveDb();
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(C.success)
          .setTitle('TTS Stopped')
          .setDescription('Left the voice channel. Use `/tts start` to begin again.')
          .setFooter(FOOTER).setTimestamp()
        ],
      });
    }

    // ── SAY ───────────────────────────────────────────────────────────
    if (sub === 'say') {
      const state = getTTSState(guildId);
      if (!state) {
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(C.error)
            .setTitle('TTS Not Active')
            .setDescription('Start TTS first: `/tts start #voice-channel`')
            .setFooter(FOOTER).setTimestamp()
          ],
        });
      }
      const text = interaction.options.getString('text');
      await enqueueTTS(interaction.guild, text, interaction.user.username, false);
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(C.success)
          .setTitle('Queued ✅')
          .setDescription(`Speaking: *"${text.slice(0, 100)}"*`)
          .setFooter(FOOTER).setTimestamp()
        ],
      });
    }

    // ── AI TOGGLE ─────────────────────────────────────────────────────
    if (sub === 'ai') {
      if (!AI_AVAILABLE) {
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(C.error)
            .setTitle('AI Unavailable')
            .setDescription('Set `GROQ_API_KEY` in Railway environment variables to enable AI mode.')
            .setFooter(FOOTER).setTimestamp()
          ],
        });
      }

      const state = getTTSState(guildId);
      if (!state) {
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(C.error)
            .setTitle('TTS Not Active')
            .setDescription('Start TTS first: `/tts start #voice-channel`')
            .setFooter(FOOTER).setTimestamp()
          ],
        });
      }

      const enabled = interaction.options.getBoolean('enabled');
      setAIMode(guildId, enabled);

      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(enabled ? C.ai ?? '#9B59B6' : C.info ?? '#5865F2')
          .setTitle(enabled ? '🤖 AI Mode Enabled' : '📢 AI Mode Disabled')
          .setDescription(
            enabled
              ? `Messages in the TTS channel will now be processed by **Groq AI (Llama 3.3 70B)**.\nI'll reply aloud in voice and post the reply in the text channel.`
              : 'Back to normal read mode — I\'ll just read messages aloud without AI responses.'
          )
          .setFooter(FOOTER).setTimestamp()
        ],
      });
    }

    // ── SKIP ──────────────────────────────────────────────────────────
    if (sub === 'skip') {
      const state = getTTSState(guildId);
      if (!state) {
        return interaction.editReply({
          embeds: [new EmbedBuilder().setColor(C.error).setTitle('Not Active').setDescription('TTS is not running.').setFooter(FOOTER).setTimestamp()],
        });
      }
      clearTTSQueue(guildId);
      try { state.player?.stop(); } catch {}
      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor(C.success).setTitle('Skipped ✅').setDescription('Current speech stopped, queue cleared.').setFooter(FOOTER).setTimestamp()],
      });
    }

    // ── STATUS ────────────────────────────────────────────────────────
    if (sub === 'status') {
      const state   = getTTSState(guildId);
      const ttsChId = db.data.ttsChannels?.[guildId];
      const vcId    = db.data.ttsVoiceChannel?.[guildId];

      if (!state) {
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(C.info ?? '#5865F2')
            .setTitle('TTS Inactive')
            .setDescription('Use `/tts start #voice-channel` to enable.')
            .setFooter(FOOTER).setTimestamp()
          ],
        });
      }

      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(state.aiMode ? C.ai ?? '#9B59B6' : C.success)
          .setTitle(state.aiMode ? '🤖 Voice AI Active' : '🔊 TTS Active')
          .addFields(
            { name: 'Text Channel',   value: ttsChId ? `<#${ttsChId}>` : '?',                 inline: true },
            { name: 'Voice Channel',  value: vcId    ? `<#${vcId}>`    : '?',                 inline: true },
            { name: 'AI Mode',        value: state.aiMode ? '🤖 On' : '📢 Off',              inline: true },
            { name: 'Queue',          value: `${state.queue.length} pending`,                  inline: true },
            { name: 'Speaking',       value: state.active ? '🔴 Yes' : '🟢 Idle',            inline: true },
            { name: 'Connection',     value: state.connectionDead ? '❌ Dead (rejoining)' : '✅ Live', inline: true },
          )
          .setFooter(FOOTER).setTimestamp()
        ],
      });
    }
  },
};
                   
