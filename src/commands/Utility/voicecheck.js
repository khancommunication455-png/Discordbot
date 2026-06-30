/**
 * voicecheck.js — SkyBot v2 Voice Diagnostic Command
 *
 * Runs the entire TTS pipeline step-by-step in isolation and reports
 * exactly which stage fails, instead of guessing. Use this any time
 * TTS or voice joins silently without obvious errors.
 *
 * Checks (in order):
 *   1. Discord permissions (Connect / Speak / View Channel)
 *   2. FFmpeg binary present and executable
 *   3. TTS provider reachable (StreamElements / Google TTS)
 *   4. Voice connection reaches full Ready state (UDP + WebSocket)
 *   5. End-to-end test playback through the real pipeline
 *
 * If permissions fail, nothing else runs (no point joining voice with
 * no permission to do so). If everything else passes but you still hear
 * nothing in the actual channel, that is the strongest possible signal
 * that Railway's UDP egress for voice traffic is being blocked at the
 * infrastructure level — not a bug in this bot's code.
 */
import { SlashCommandBuilder, ChannelType, EmbedBuilder } from 'discord.js';
import { runVoiceDiagnostic } from '../../services/ttsService.js';
import { C } from '../../utils/embeds.js';

const FOOTER = { text: 'SkyBot v2 • Voice Diagnostic' };

export default {
  data: new SlashCommandBuilder()
    .setName('voicecheck')
    .setDescription('Run a full diagnostic on TTS/voice — finds exactly why audio might be silent')
    .addChannelOption(o => o
      .setName('voice_channel')
      .setDescription('Voice channel to test (defaults to your current voice channel)')
      .addChannelTypes(ChannelType.GuildVoice)
      .setRequired(false)),

  cooldown: 10,

  async execute(interaction) {
    await interaction.deferReply();

    const voiceChannel = interaction.options.getChannel('voice_channel') ?? interaction.member?.voice?.channel;

    if (!voiceChannel) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(C.error)
          .setTitle('❌ No Voice Channel')
          .setDescription('Either join a voice channel first, or specify one with the `voice_channel` option.')
          .setFooter(FOOTER).setTimestamp()],
      });
    }

    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(C.info)
        .setTitle('🔍 Running Voice Diagnostic...')
        .setDescription(`Testing **${voiceChannel.name}** — this takes up to ~20 seconds.`)
        .setFooter(FOOTER).setTimestamp()],
    });

    let result;
    try {
      result = await runVoiceDiagnostic(interaction.guild, voiceChannel.id);
    } catch (err) {
      console.error('[VoiceCheck] Diagnostic crashed:', err);
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(C.error)
          .setTitle('❌ Diagnostic Crashed')
          .setDescription(`Unexpected error: ${err.message}`)
          .setFooter(FOOTER).setTimestamp()],
      });
    }

    const { steps, overallOk } = result;

    const lines = steps.map((s, i) => {
      const icon = s.ok ? '✅' : '❌';
      return `${icon} **${i + 1}. ${s.name}**\n${s.detail}`;
    });

    const embed = new EmbedBuilder()
      .setColor(overallOk ? (C.success ?? 0x00FF00) : (C.error ?? 0xFF0000))
      .setTitle(overallOk ? '✅ All Checks Passed' : '⚠️ Issue(s) Found')
      .setDescription(lines.join('\n\n').slice(0, 4000))
      .setFooter(FOOTER)
      .setTimestamp();

    if (overallOk) {
      embed.addFields({
        name: '🤔 Still hearing nothing?',
        value: 'Every layer the bot can test from inside Node.js passed. At this point the most ' +
          'likely remaining cause is **Discord client-side**: check your own input/output device in ' +
          'Discord settings, make sure you are not server-muted/deafened, and confirm the bot shows ' +
          'a green speaking ring when it talks. If the ring shows but there is still no sound, it ' +
          'points to a local audio routing issue on your device, not the bot.',
      });
    }

    return interaction.editReply({ embeds: [embed] });
  },
};
