/**
 * flip.js — AH Flip subscription manager
 *
 * Subcommands:
 *   /flip subscribe [item] [min_profit] — subscribe to flips of an item
 *   /flip unsubscribe [item] — remove subscription
 *   /flip list — show your subscriptions
 *   /flip recent [limit] — show recent flips
 *   /flip top [limit] — show top all-time flips
 *   /flip search [query] — search recent flips by item name
 *   /flip stats — show flip watcher stats
 */
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getDb, saveDb, addSubscription, removeSubscription, getSubscriptions } from '../../utils/db.js';
import {
  getFlipWatcherStats, getRecentFlips, getTopFlips, searchFlips,
} from '../../services/ahFlipWatcher.js';
import { C, formatCoins, formatNumber } from '../../utils/embeds.js';

const FOOTER = { text: 'SkyBot v2 AH Flipper • Railway Edition' };

function buildFlipEmbed(flip, rank = null) {
  const a = flip.attributes || {};
  const attrBadges = [];
  if (a.isPet) attrBadges.push(`🐾 Lvl ${a.petLevel}`);
  if (a.stars > 0) attrBadges.push(`${'✪'.repeat(a.stars)}`);
  if (a.reforge) attrBadges.push(`⚒️ ${a.reforge}`);
  if (a.isRecombobulated) attrBadges.push('🌀 Recomb');
  if (a.hotPotatoBooks > 0) attrBadges.push(`🥔 ×${a.hotPotatoBooks}`);
  if (a.farmingForDummies > 0) attrBadges.push(`📖 ×${a.farmingForDummies}`);
  if (a.isShiny) attrBadges.push('✨ Shiny');
  if (a.skin) attrBadges.push(`🎨 ${a.skin}`);

  return new EmbedBuilder()
    .setColor(a.rarityColor ?? C.flip)
    .setTitle(`${rank ? `#${rank} ` : ''}💰 ${a.name || 'Unknown Item'}`)
    .addFields(
      { name: 'Buy Price', value: formatCoins(flip.buyPrice), inline: true },
      { name: 'Market EWMA', value: formatCoins(flip.marketEwma), inline: true },
      { name: 'Profit', value: `**+${formatCoins(flip.profit)}**`, inline: true },
      { name: 'Margin', value: `${flip.marginPct.toFixed(1)}%`, inline: true },
      { name: 'Demand', value: `${flip.demandScore}/100`, inline: true },
      { name: 'Confidence', value: `${flip.confidenceScore.toFixed(0)}/100`, inline: true },
      { name: 'Auction ID', value: `\`/viewauction ${flip.uuid}\``, inline: false },
    )
    .setDescription(attrBadges.length ? `**Attributes:** ${attrBadges.join(' • ')}` : null)
    .setFooter({ text: `Samples: ${flip.volumeScore} • SkyBot v2 Flipper` })
    .setTimestamp(flip.detectedAt || Date.now());
}

export default {
  data: new SlashCommandBuilder()
    .setName('flip')
    .setDescription('AH Flip tracker — subscribe, view recent, and search flips')
    .addSubcommand(s => s
      .setName('subscribe')
      .setDescription('Get pinged when an item you want appears as a flip')
      .addStringOption(o => o
        .setName('item').setDescription('Item name (e.g. "Hyperion", "Shadow Assassin Helmet")').setRequired(true))
      .addIntegerOption(o => o
        .setName('min_profit').setDescription('Minimum profit to ping (coins)').setRequired(false)))
    .addSubcommand(s => s
      .setName('unsubscribe')
      .setDescription('Remove a subscription')
      .addStringOption(o => o
        .setName('item').setDescription('Item name to unsubscribe from').setRequired(true)))
    .addSubcommand(s => s.setName('list').setDescription('Show your active subscriptions'))
    .addSubcommand(s => s
      .setName('recent')
      .setDescription('Show recent flips')
      .addIntegerOption(o => o
        .setName('limit').setDescription('How many (1-10)').setRequired(false).setMinValue(1).setMaxValue(10)))
    .addSubcommand(s => s
      .setName('top')
      .setDescription('Show top all-time flips by profit')
      .addIntegerOption(o => o
        .setName('limit').setDescription('How many (1-10)').setRequired(false).setMinValue(1).setMaxValue(10)))
    .addSubcommand(s => s
      .setName('search')
      .setDescription('Search recent flips by item name')
      .addStringOption(o => o
        .setName('query').setDescription('Item name to search').setRequired(true)))
    .addSubcommand(s => s.setName('stats').setDescription('Show flip watcher statistics')),

  cooldown: 3,

  async execute(interaction) {
    await interaction.deferReply();

    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    // ── SUBSCRIBE ─────────────────────────────────────────────
    if (sub === 'subscribe') {
      const item = interaction.options.getString('item').trim().toLowerCase();
      const minProfit = interaction.options.getInteger('min_profit') ?? 0;
      addSubscription(userId, item);
      // Set minProfit override
      const db = getDb();
      if (db.ahSubscriptions[userId]) {
        db.ahSubscriptions[userId].minProfit = minProfit;
        await saveDb();
      }
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(C.success).setTitle('🔔 Subscription Added')
          .setDescription(`You'll be pinged when **${item}** appears as a flip${minProfit > 0 ? ` with profit ≥ ${formatCoins(minProfit)}` : ''}.`)
          .setFooter(FOOTER).setTimestamp()],
      });
    }

    // ── UNSUBSCRIBE ───────────────────────────────────────────
    if (sub === 'unsubscribe') {
      const item = interaction.options.getString('item').trim().toLowerCase();
      const removed = removeSubscription(userId, item);
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(removed ? C.success : C.warning)
          .setTitle(removed ? '🔕 Unsubscribed' : 'Not Subscribed')
          .setDescription(removed ? `Removed subscription for **${item}**.` : `You weren't subscribed to **${item}**.`)
          .setFooter(FOOTER).setTimestamp()],
      });
    }

    // ── LIST ──────────────────────────────────────────────────
    if (sub === 'list') {
      const subInfo = getSubscriptions(userId);
      if (!subInfo || !subInfo.items?.length) {
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(C.info).setTitle('No Subscriptions')
            .setDescription('Use `/flip subscribe [item]` to get pinged on flips.')
            .setFooter(FOOTER).setTimestamp()],
        });
      }
      const list = subInfo.items.map((it, i) => `**${i + 1}.** \`${it}\``).join('\n');
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(C.flip).setTitle(`🔔 Your Subscriptions (${subInfo.items.length})`)
          .setDescription(list)
          .addFields({ name: 'Min Profit Override', value: formatCoins(subInfo.minProfit || 0), inline: true })
          .setFooter(FOOTER).setTimestamp()],
      });
    }

    // ── RECENT ────────────────────────────────────────────────
    if (sub === 'recent') {
      const limit = interaction.options.getInteger('limit') ?? 5;
      const flips = getRecentFlips(limit);
      if (!flips.length) {
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(C.info).setTitle('No Flips Yet')
            .setDescription('The flip watcher is scanning the AH. Check back in a minute!')
            .setFooter(FOOTER).setTimestamp()],
        });
      }
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(C.flip).setTitle(`💰 Recent Flips (${flips.length})`)
          .setDescription(flips.map((f, i) => {
            const a = f.attributes || {};
            return `**${i + 1}. ${a.name || '?'}** — Buy ${formatCoins(f.buyPrice)} → Profit **+${formatCoins(f.profit)}** (${f.marginPct.toFixed(1)}%)\n\`/viewauction ${f.uuid}\``;
          }).join('\n\n'))
          .setFooter(FOOTER).setTimestamp()],
      });
    }

    // ── TOP ───────────────────────────────────────────────────
    if (sub === 'top') {
      const limit = interaction.options.getInteger('limit') ?? 5;
      const flips = getTopFlips(limit);
      if (!flips.length) {
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(C.info).setTitle('No Top Flips Yet')
            .setDescription('Once flips are detected, the leaderboard will populate here.')
            .setFooter(FOOTER).setTimestamp()],
        });
      }
      const embeds = [new EmbedBuilder()
        .setColor(C.premium).setTitle(`🏆 Top ${flips.length} Flips — All Time`)
        .setFooter(FOOTER).setTimestamp()];
      for (const f of flips.slice(0, 5)) {
        embeds.push(buildFlipEmbed(f, flips.indexOf(f) + 1));
      }
      return interaction.editReply({ embeds });
    }

    // ── SEARCH ────────────────────────────────────────────────
    if (sub === 'search') {
      const q = interaction.options.getString('query').trim();
      const flips = searchFlips(q).slice(0, 5);
      if (!flips.length) {
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(C.warning).setTitle('No Matches')
            .setDescription(`No recent flips found matching **"${q}"**.`)
            .setFooter(FOOTER).setTimestamp()],
        });
      }
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(C.flip).setTitle(`🔍 Search: "${q}" (${flips.length} results)`)
          .setDescription(flips.map((f, i) => {
            const a = f.attributes || {};
            return `**${i + 1}. ${a.name || '?'}** — Profit **+${formatCoins(f.profit)}** (${f.marginPct.toFixed(1)}%)\n\`/viewauction ${f.uuid}\``;
          }).join('\n\n'))
          .setFooter(FOOTER).setTimestamp()],
      });
    }

    // ── STATS ─────────────────────────────────────────────────
    if (sub === 'stats') {
      const s = getFlipWatcherStats();
      const lastScanAgo = s.lastScanAt ? `${Math.floor((Date.now() - s.lastScanAt) / 1000)}s ago` : 'never';
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(C.flip).setTitle('📊 Flip Watcher Statistics')
          .addFields(
            { name: 'Total Flips Detected', value: formatNumber(s.totalFlipsDetected), inline: true },
            { name: 'Total Profit Tracked', value: formatCoins(s.totalProfitCoins), inline: true },
            { name: 'Scans Run', value: formatNumber(s.scansRun), inline: true },
            { name: 'Items Tracked', value: formatNumber(s.itemsTracked), inline: true },
            { name: 'Last Scan', value: lastScanAgo, inline: true },
            { name: 'Last Scan Flips', value: formatNumber(s.lastScanFlipsFound), inline: true },
            { name: 'Failed Scans', value: formatNumber(s.failedScans), inline: true },
            { name: 'Last Scan Duration', value: `${s.lastScanDurationMs}ms`, inline: true },
          )
          .setFooter(FOOTER).setTimestamp()],
      });
    }
  },
};
