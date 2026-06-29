/**
 * info.js — Bot info & command list
 */
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { C } from '../../utils/embeds.js';
import { getFlipWatcherStats } from '../../services/ahFlipWatcher.js';
import { getStats as getPriceStats } from '../../services/priceHistory.js';
import { getAllTTSStates } from '../../services/ttsService.js';

const FOOTER = { text: 'SkyBot v2 • Railway Edition' };

export default {
  data: new SlashCommandBuilder()
    .setName('info')
    .setDescription('Show bot info, status, and command list')
    .addStringOption(o =>
      o.setName('section').setDescription('Which section to show').setRequired(false)
        .addChoices(
          { name: 'Overview', value: 'overview' },
          { name: 'Hypixel', value: 'hypixel' },
          { name: 'Voice & TTS', value: 'tts' },
          { name: 'AH Flipper', value: 'flipper' },
        )),

  async execute(interaction, client) {
    const section = interaction.options.getString('section') ?? 'overview';

    if (section === 'hypixel') {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(C.hypixel).setTitle('🎯 Hypixel Skyblock Commands')
          .setDescription('All Skyblock-related commands:')
          .addFields(
            { name: '/link <ign>', value: 'Link your Discord to Minecraft account', inline: false },
            { name: '/profile [ign] [page]', value: 'View full SkyBlock profile (skills, dungeons, slayers, mining, NW)', inline: false },
            { name: '/auction [ign]', value: 'See active AH listings for a player', inline: false },
            { name: '/bazaar <item>', value: 'Check Bazaar buy/sell prices & spread', inline: false },
          )
          .setFooter(FOOTER).setTimestamp()],
      });
    }

    if (section === 'tts') {
      const ttsCount = getAllTTSStates().length;
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(C.tts).setTitle('🔊 Voice & TTS Commands')
          .setDescription('Railway-proof TTS — pure HTTP providers (StreamElements + Google), no Python deps.')
          .addFields(
            { name: '/tts start [voice_channel] [text_channel] [ai_mode]', value: 'Join a VC and start reading a text channel', inline: false },
            { name: '/tts stop', value: 'Leave the VC', inline: false },
            { name: '/tts say [text]', value: 'Speak something immediately', inline: false },
            { name: '/tts ai [enabled]', value: 'Toggle Groq AI assistant mode (Llama 3.3 70B)', inline: false },
            { name: '/tts skip', value: 'Stop current speech + clear queue', inline: false },
            { name: '/tts move [voice_channel]', value: 'Move bot to another VC', inline: false },
            { name: '/tts status', value: 'Show TTS status', inline: false },
          )
          .addFields({ name: 'Active Sessions', value: `${ttsCount} guild(s)`, inline: true })
          .setFooter(FOOTER).setTimestamp()],
      });
    }

    if (section === 'flipper') {
      const stats = getFlipWatcherStats();
      const priceStats = getPriceStats();
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(C.flip).setTitle('💰 AH Flip Tracker Commands')
          .setDescription('Powerful multi-page flip scanner with EWMA pricing, item-attribute parsing, and subscriptions.')
          .addFields(
            { name: '/flip subscribe [item] [min_profit]', value: 'Get pinged when an item appears as a flip', inline: false },
            { name: '/flip unsubscribe [item]', value: 'Remove a subscription', inline: false },
            { name: '/flip list', value: 'Show your subscriptions', inline: false },
            { name: '/flip recent [limit]', value: 'Show recent flips', inline: false },
            { name: '/flip top [limit]', value: 'Show top all-time flips', inline: false },
            { name: '/flip search [query]', value: 'Search recent flips', inline: false },
            { name: '/flip stats', value: 'Show flip watcher stats', inline: false },
          )
          .addFields(
            { name: 'Total Detected', value: `${stats.totalFlipsDetected}`, inline: true },
            { name: 'Items Tracked', value: `${priceStats.signatures}`, inline: true },
            { name: 'Scans Run', value: `${stats.scansRun}`, inline: true },
          )
          .setFooter(FOOTER).setTimestamp()],
      });
    }

    // Overview
    const stats = getFlipWatcherStats();
    const priceStats = getPriceStats();
    const ttsCount = getAllTTSStates().length;
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);

    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(C.info).setTitle('🤖 SkyBot v2 — Railway Edition')
        .setDescription('All-in-one Hypixel Skyblock Discord bot with flawless TTS/Voice and a powerful AH Flip Tracker.')
        .addFields(
          { name: '⏱️ Uptime', value: `${hours}h ${minutes}m`, inline: true },
          { name: '🏠 Guilds', value: `${client.guilds.cache.size}`, inline: true },
          { name: '📡 Ping', value: `${client.ws.ping}ms`, inline: true },
          { name: '🔊 TTS Sessions', value: `${ttsCount}`, inline: true },
          { name: '💰 Flips Detected', value: `${stats.totalFlipsDetected}`, inline: true },
          { name: '📊 Items Tracked', value: `${priceStats.signatures}`, inline: true },
          { name: 'Commands', value: 'Use `/info hypixel`, `/info tts`, or `/info flipper` for command lists', inline: false },
        )
        .setFooter(FOOTER).setTimestamp()],
    });
  },
};
