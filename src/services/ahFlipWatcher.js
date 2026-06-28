/**
 * ahFlipWatcher.js — SkyBot v2 Powerful AH Flip Tracker
 *
 * Massive upgrade over v1 (which only scanned page 0 and compared to
 * the lowest BIN on the same page — useless when the whole page is
 * cheap).
 *
 * Features:
 *  A. Multi-page scanning via getAllAuctions(maxPages)
 *  B. Item signature normalization (reforge, stars, recomb, pets, etc.)
 *  C. Price history population for EVERY BIN seen (priceHistory.js)
 *  D. Flip detection using EWMA + margin + profit + demand + confidence
 *  E. Seen-auction deduplication with TTL-based cleanup
 *  F. Smart batching (1-2 individual rich embeds, 3+ batch table embed)
 *  G. Rich per-flip embed builder showing all parsed attributes
 *  H. Per-user subscription alerts via DM (or channelOverride fallback)
 *  I. Profit leaderboard persisted to db every 5 scans (I/O batching)
 *  J. Stats snapshot for dashboard
 *  K. Graceful error handling (rate limit backoff, scan failure continue)
 *  L. Public API: start / stop / getStats / getRecentFlips / getTopFlips / searchFlips
 *
 * Environment variables:
 *   AH_FLIP_CHANNEL_ID       Discord channel to post flips into (REQUIRED to start)
 *   AH_FLIP_INTERVAL         Seconds between scans (default 30, min 20)
 *   AH_FLIP_MAX_PAGES        Number of AH pages to fetch per scan (default 3)
 *   AH_FLIP_MIN_MARGIN       Minimum margin percent to flag a flip (default 25)
 *   AH_FLIP_MIN_PROFIT       Minimum absolute profit in coins (default 500000)
 *   AH_FLIP_MIN_DEMAND       Minimum demand score (default 10)
 *   AH_FLIP_MAX_PER_CYCLE    Max flips surfaced per scan cycle (default 5)
 *   AH_FLIP_MIN_SAMPLES      Minimum price-history samples for reliable EWMA (default 5)
 *   PREMIUM_ROLE_ID          Role to ping on flip posts (optional)
 */
import { getAllAuctions, parseItemAttributes } from './hypixel.js';
import * as priceHistory from './priceHistory.js';
import { getDb, saveDb } from '../utils/db.js';
import { C, formatCoins } from '../utils/embeds.js';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getConfig, getAllConfig, getConfigSource, shouldPostFlipsToDiscord, isFlipWatcherEnabled } from '../utils/runtimeConfig.js';

// ── Configuration (read at runtime via runtimeConfig.js) ─────
// These are now dynamic — admins can change them from the dashboard.
// getConfig() resolves: DB override → env var → hardcoded default.
function cfg() {
  return {
    intervalSec:   Math.max(20, Number(getConfig('AH_FLIP_INTERVAL'))),
    maxPages:      Math.max(1, Number(getConfig('AH_FLIP_MAX_PAGES'))),
    minMarginPct:  Number(getConfig('AH_FLIP_MIN_MARGIN')),
    minProfit:     Number(getConfig('AH_FLIP_MIN_PROFIT')),
    minDemand:     Number(getConfig('AH_FLIP_MIN_DEMAND')),
    maxPerCycle:   Math.max(1, Number(getConfig('AH_FLIP_MAX_PER_CYCLE'))),
    minSamples:    Math.max(1, Number(getConfig('AH_FLIP_MIN_SAMPLES'))),
    channelId:     getConfig('AH_FLIP_CHANNEL_ID'),
    premiumRoleId: getConfig('PREMIUM_ROLE_ID'),
  };
}

// ── Constants (not editable at runtime) ───────────────────────
const SEEN_TTL_MS         = 10 * 60 * 1000;   // auction UUID remembered 10 min
const SEEN_CLEANUP_EVERY  = 5  * 60 * 1000;   // cleanup pass every 5 min
const PERSIST_EVERY       = 5;                 // persist stats every N scans
const RATE_LIMIT_BACKOFF  = 60 * 1000;         // 60s Hypixel 429 backoff
const TOP_FLIPS_MAX       = 100;               // top-flips leaderboard size
const RECENT_FLIPS_MAX    = 20;                // recent-flips ring buffer

// ── Runtime state ─────────────────────────────────────────────
const state = {
  /** @type {NodeJS.Timeout|null} */
  timer: null,
  /** @type {import('discord.js').Client|null} */
  client: null,
  running: false,
  scansRun: 0,
  failedScans: 0,
  totalFlipsDetected: 0,
  totalProfitCoins: 0,
  lastScanAt: 0,
  lastScanDurationMs: 0,
  lastScanAuctionsSeen: 0,
  lastScanFlipsFound: 0,
  /** Most-recent-first ring of last 20 flips (stripped, serializable). */
  recentFlips: [],
  /** Top 100 flips all-time by profit (sorted desc, serializable). */
  topFlips: [],
  /** @type {Map<string, number>} uuid → first-seen timestamp */
  seenAuctions: new Map(),
  lastSeenCleanup: 0,
  /** Earliest next-scan timestamp (rate-limit backoff window). */
  nextScanAllowedAt: 0,
};

// ── Signature builder ─────────────────────────────────────────
/**
 * Build a normalized item signature from parsed attributes.
 *
 * Signature shape:
 *   `${cleanName}|${tier}|${isPet}|${petLevelBucket}|${stars}|${isRecombobulated}`
 *
 * petLevelBucket = floor(petLevel / 10) * 10 → [0,10,20,...,90]
 *
 * This makes a "Withered Shadow Assassin Helmet" priced only against
 * other "Withered Shadow Assassin Helmet" listings, not against any
 * "Shadow Assassin Helmet" of any reforge.
 *
 * @param {ReturnType<parseItemAttributes>} attrs
 * @returns {string}
 */
export function buildSignature(attrs) {
  const petLevelBucket = attrs.isPet ? Math.floor(attrs.petLevel / 10) * 10 : 0;
  return [
    attrs.name,
    attrs.tier,
    attrs.isPet ? '1' : '0',
    petLevelBucket,
    attrs.stars,
    attrs.isRecombobulated ? '1' : '0',
  ].join('|');
}

// ── Main scan loop ────────────────────────────────────────────
/**
 * Run a single AH scan cycle. Fetches auctions, populates price history,
 * detects flips, posts to channel, alerts subscribers, updates stats.
 *
 * Re-entrancy safe — no-op if a previous scan is still running.
 * Respects rate-limit backoff windows.
 *
 * @returns {Promise<void>}
 */
async function runScan() {
  if (state.running) return;
  const now = Date.now();
  if (now < state.nextScanAllowedAt) {
    const waitSec = Math.ceil((state.nextScanAllowedAt - now) / 1000);
    console.warn(`[AHFlip] Skipping scan, rate-limit backoff for ${waitSec}s`);
    return;
  }

  // Re-read config at scan time (admin may have changed it via dashboard)
  const C = cfg();
  state.running = true;
  const t0 = Date.now();

  let auctions = [];
  try {
    auctions = await getAllAuctions(C.maxPages);
  } catch (err) {
    state.failedScans++;
    if (err?.response?.status === 429) {
      console.warn('[AHFlip] Hypixel 429 rate limit — backing off 60s');
      state.nextScanAllowedAt = Date.now() + RATE_LIMIT_BACKOFF;
    } else {
      console.warn('[AHFlip] Scan failed:', err?.message || String(err));
    }
    state.running = false;
    return;
  }

  // ── Phase 1: Build price database (ALL BINs in this scan) ──
  // startScanEpoch resets currentPrices so they get rebuilt fresh.
  // Historical prices (from PREVIOUS scans) are preserved and NOT modified
  // during this phase.
  priceHistory.startScanEpoch();

  const allBins = [];
  for (const a of auctions) {
    if (!a.bin) continue;
    let attrs;
    try { attrs = parseItemAttributes(a); } catch { continue; }
    if (!attrs.name) continue;
    const sig = buildSignature(attrs);
    priceHistory.updatePrice(sig, a.starting_bid);
    allBins.push({ auction: a, attrs, sig });
  }

  // NOTE: Do NOT call finalizeScanEpoch() yet!
  // We need to detect flips using HISTORICAL data (previous scans) only.
  // If we finalize now, the current scan's prices would contaminate the
  // historical median, making cheap items look like flips of themselves.
  //
  // Flip detection uses:
  //   - market.median (from historicalPrices = PREVIOUS scans)
  //   - market.lowestBin (from currentPrices = THIS scan)
  //   - cost = a.starting_bid (THIS scan's price)

  // ── Phase 2: Detect flips using HISTORICAL median vs current cost ──
  const flipsThisCycle = [];
  let binsScanned = 0;
  const MIN_HISTORICAL_SAMPLES = 5; // Need at least 5 past samples for reliable median

  for (const { auction: a, attrs, sig } of allBins) {
    if (state.seenAuctions.has(a.uuid)) continue;
    state.seenAuctions.set(a.uuid, Date.now());
    binsScanned++;

    const market = priceHistory.getMarketPrice(sig);
    if (!market) continue;

    // Need enough HISTORICAL samples for a reliable median
    if (market.count < MIN_HISTORICAL_SAMPLES) continue;

    const cost = a.starting_bid;
    const median = market.median;

    // Skip if no valid historical median
    if (median <= 0) continue;

    // ── Sniper Median: flip if cost is 5%+ below historical median ──
    // This means: the item is priced below what it TYPICALLY sells for
    const marginBelowMedianPct = ((median - cost) / median) * 100;
    if (marginBelowMedianPct < C.minMarginPct) continue;

    // Profit = median - cost (what you could sell it for minus what you pay)
    const profit = median - cost;
    if (profit < C.minProfit) continue;
    if (attrs.demandScore < C.minDemand) continue;

    // Don't flag items where cost >= median (no actual profit opportunity)
    if (cost >= median) continue;

    const marginPct = (profit / cost) * 100;
    const volumeScore = Math.min(100, market.count * 3);
    const confidenceScore = Math.min(
      100,
      Math.round(0.4 * volumeScore + 0.3 * attrs.demandScore + 0.3 * Math.min(100, marginPct * 2))
    );

    flipsThisCycle.push({
      uuid: a.uuid,
      itemName: attrs.name,
      tier: attrs.tier,
      buyPrice: cost,
      lowestBin: market.lowestBin,
      secondLowestBin: market.secondLowestBin,
      median,
      ewma: market.ewma,
      p5: market.p5,
      profit,
      profitFloor: Math.max(0, market.p5 - cost),
      marginPct,
      marginBelowMedianPct,
      demandScore: attrs.demandScore,
      volumeScore,
      confidenceScore,
      sampleCount: market.count,
      volume: market.volume,
      signature: sig,
      finder: 4,
      finderLabel: 'MSNIPE',
      attrs,
      detectedAt: Date.now(),
    });
  }

  // Sort by profit descending
  flipsThisCycle.sort((a, b) => b.profit - a.profit);

  // ── Phase 3: Finalize scan epoch ──
  // NOW move currentPrices → historicalPrices for the NEXT scan.
  // This must happen AFTER flip detection so the current scan's prices
  // don't contaminate the historical median used for THIS scan's flips.
  priceHistory.finalizeScanEpoch();

  // ── Update statistics ──
  state.scansRun++;
  state.lastScanAt = Date.now();
  state.lastScanDurationMs = state.lastScanAt - t0;
  state.lastScanAuctionsSeen = auctions.length;
  state.lastScanFlipsFound = flipsThisCycle.length;
  state.totalFlipsDetected += flipsThisCycle.length;
  for (const f of flipsThisCycle) {
    state.totalProfitCoins += f.profit;
    state.recentFlips.unshift(stripFlip(f));
    if (state.recentFlips.length > RECENT_FLIPS_MAX) state.recentFlips.pop();
    insertTopFlip(state.topFlips, stripFlip(f));
  }

  // ── Post flips to channel (smart batching) ──
  await sendFlips(flipsThisCycle, C);

  // ── Per-user subscription alerts ──
  await sendSubscriptionAlerts(state.client, flipsThisCycle);

  // ── Persist stats every PERSIST_EVERY scans ──
  if (state.scansRun % PERSIST_EVERY === 0) {
    persistStats();
  }

  // ── Periodic seenAuctions cleanup ──
  if (Date.now() - state.lastSeenCleanup > SEEN_CLEANUP_EVERY) {
    cleanupSeen();
    state.lastSeenCleanup = Date.now();
  }

  state.running = false;
  if (flipsThisCycle.length > 0) {
    console.log(`[AHFlip] Scan #${state.scansRun}: ${auctions.length} auctions, ${binsScanned} new BINs, ${flipsThisCycle.length} flips (top profit ${formatCoins(flipsThisCycle[0].profit)})`);
  }
}

/**
 * Strip a flip record down to plain serializable fields for stats/topFlips.
 * Removes the heavy `attrs` object so we don't blow up db.json.
 *
 * @param {object} f  Full flip record
 * @returns {object}  Stripped flip record
 */
function stripFlip(f) {
  return {
    uuid: f.uuid,
    itemName: f.itemName,
    tier: f.tier,
    buyPrice: f.buyPrice,
    ewma: f.ewma,
    profit: f.profit,
    marginPct: f.marginPct,
    demandScore: f.demandScore,
    volumeScore: f.volumeScore,
    confidenceScore: f.confidenceScore,
    sampleCount: f.sampleCount,
    signature: f.signature,
    detectedAt: f.detectedAt,
  };
}

/**
 * Insert a stripped flip into the top-flips leaderboard (kept sorted desc,
 * capped at TOP_FLIPS_MAX entries).
 *
 * @param {Array} arr
 * @param {object} flip
 */
function insertTopFlip(arr, flip) {
  arr.push(flip);
  arr.sort((a, b) => b.profit - a.profit);
  if (arr.length > TOP_FLIPS_MAX) arr.length = TOP_FLIPS_MAX;
}

/**
 * Remove stale entries from seenAuctions (older than SEEN_TTL_MS).
 * Auctions get re-listed and re-appear with the same UUID occasionally
 * after a grace period, so we don't want to remember them forever.
 */
function cleanupSeen() {
  const cutoff = Date.now() - SEEN_TTL_MS;
  let removed = 0;
  for (const [uuid, ts] of [...state.seenAuctions.entries()]) {
    if (ts < cutoff) {
      state.seenAuctions.delete(uuid);
      removed++;
    }
  }
  if (removed > 0) {
    console.log(`[AHFlip] Cleaned ${removed} stale seen auctions (size=${state.seenAuctions.size})`);
  }
}

// ── Channel posting (smart batching) ──────────────────────────
/**
 * Post detected flips to the AH flip channel using smart batching:
 *   1 flip  → single rich embed
 *   2 flips → two rich embeds in one message
 *   3+ flips → one batch table embed with top MAX_PER_CYCLE flips
 *
 * @param {Array} flips  Flips detected this cycle (already sorted by profit desc)
 * @returns {Promise<void>}
 */
async function sendFlips(flips, C) {
  if (!C.channelId || !state.client || flips.length === 0) return;
  if (!shouldPostFlipsToDiscord()) return;
  const channel = await state.client.channels.fetch(C.channelId).catch(() => null);
  if (!channel) {
    console.warn(`[AHFlip] Channel not found: ${C.channelId}`);
    return;
  }

  const top = flips.slice(0, C.maxPerCycle);
  const ping = C.premiumRoleId ? `<@&${C.premiumRoleId}> ` : '';
  try {
    if (top.length === 1) {
      // Single flip: embed + "Copy AH ID" button for mobile users
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`copy_ah_${top[0].uuid}`)
          .setLabel('📋 Copy /viewauction')
          .setStyle(ButtonStyle.Primary)
      );
      await channel.send({ content: ping, embeds: [buildFlipEmbed(top[0])], components: [row] });
    } else if (top.length === 2) {
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`copy_ah_${top[0].uuid}`)
            .setLabel('📋 Copy #1')
            .setStyle(ButtonStyle.Primary)
        )
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`copy_ah_${top[1].uuid}`)
            .setLabel('📋 Copy #2')
            .setStyle(ButtonStyle.Secondary)
        );
      await channel.send({
        content: ping,
        embeds: [buildFlipEmbed(top[0]), buildFlipEmbed(top[1])],
        components: [row],
      });
    } else {
      // Batch: embed + buttons for each flip
      const row = new ActionRowBuilder();
      top.slice(0, 5).forEach((f, i) => {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`copy_ah_${f.uuid}`)
            .setLabel(`📋 ${i + 1}`)
            .setStyle(i === 0 ? ButtonStyle.Primary : ButtonStyle.Secondary)
        );
      });
      await channel.send({ content: ping, embeds: [buildBatchEmbed(top)], components: [row] });
    }
  } catch (err) {
    console.warn('[AHFlip] Channel send failed:', err.message);
  }
}

// ── Embed builders ────────────────────────────────────────────
/**
 * Build a rich per-flip embed showing buy/market/profit/margin, parsed
 * item attributes, and demand/volume/confidence scores.
 *
 * @param {object} flip  Full flip record (must include `attrs`)
 * @returns {import('discord.js').EmbedBuilder}
 */
function buildFlipEmbed(flip) {
  const attrs = flip.attrs;
  const color = attrs.rarityColor || C.flip;
  const title = attrs.name.length > 240 ? attrs.name.slice(0, 240) + '…' : attrs.name;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`💰 ${title}`)
    .setDescription(`\`/viewauction ${flip.uuid}\``)
    .addFields(
      { name: 'Buy Price',    value: `${formatCoins(flip.buyPrice)} coins`,     inline: true },
      { name: 'Market EWMA',  value: `${formatCoins(flip.ewma)} coins`,         inline: true },
      { name: 'Profit',       value: `**+${formatCoins(flip.profit)}**`,        inline: true },
      { name: 'Margin',       value: `${flip.marginPct.toFixed(1)}%`,            inline: true },
      { name: 'Profit Floor', value: `${formatCoins(flip.profitFloor)} (p5)`,   inline: true },
      { name: 'Demand',       value: `${flip.demandScore}/100`,                  inline: true },
    );

  // ── Attributes section (only non-zero / non-null) ──
  const attrLines = [];
  if (attrs.isPet) {
    let petLine = `🐾 Pet [Lvl ${attrs.petLevel}]`;
    if (attrs.petCandy > 0) petLine += ` • 🍬 ${attrs.petCandy}`;
    attrLines.push(petLine);
  }
  if (attrs.stars > 0) attrLines.push(`⭐ ${'✪'.repeat(attrs.stars)} (${attrs.stars})`);
  if (attrs.reforge)   attrLines.push(`⚒️ Reforge: **${attrs.reforge}**`);
  if (attrs.isRecombobulated) attrLines.push(`🌀 Recombobulated`);
  if (attrs.hotPotatoBooks > 0) attrLines.push(`🥔 HPB: ${attrs.hotPotatoBooks}`);
  if (attrs.farmingForDummies > 0) attrLines.push(`📘 FFD: ${attrs.farmingForDummies}`);
  if (attrs.isShiny) {
    attrLines.push(`✨ Shiny${attrs.shinyValue != null ? ` (${attrs.shinyValue.toLocaleString()})` : ''}`);
  }
  if (attrs.skin) attrLines.push(`🎨 Skin: ${attrs.skin}`);
  const enchKeys = Object.keys(attrs.enchantments);
  if (enchKeys.length > 0) {
    const shown = enchKeys.slice(0, 5).map(k => `${k} ${attrs.enchantments[k]}`).join(', ');
    const extra = enchKeys.length > 5 ? ` (+${enchKeys.length - 5} more)` : '';
    attrLines.push(`📚 ${shown}${extra}`);
  }
  if (attrLines.length > 0) {
    embed.addFields({ name: 'Attributes', value: attrLines.join('\n'), inline: false });
  }

  embed.addFields(
    { name: 'Volume Score', value: `${flip.volumeScore}/100`,                  inline: true },
    { name: 'Confidence',   value: `${flip.confidenceScore.toFixed(0)}/100`,   inline: true },
    { name: 'Tier',         value: attrs.tier || '—',                          inline: true },
  );

  embed.setFooter({
    text: `SkyBot AH Flipper • EWMA: ${flip.sampleCount} samples • Confidence ${flip.confidenceScore.toFixed(0)}/100`,
  });
  embed.setTimestamp();
  return embed;
}

/**
 * Build a compact batch embed with top N flips in a table-style layout.
 * Used when 3+ flips are detected in one cycle to prevent channel spam.
 *
 * @param {Array} flips  Top flips for this cycle (already sliced)
 * @returns {import('discord.js').EmbedBuilder}
 */
function buildBatchEmbed(flips) {
  const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
  const lines = flips.map((f, i) => {
    const medal = medals[i] || `${i + 1}.`;
    return (
      `${medal} **${f.itemName}**\n` +
      `   Buy ${formatCoins(f.buyPrice)} • EWMA ${formatCoins(f.ewma)} • ` +
      `Profit +${formatCoins(f.profit)} (${f.marginPct.toFixed(1)}%)\n` +
      `   \`/viewauction ${f.uuid}\``
    );
  });
  const totalProfit = flips.reduce((s, f) => s + f.profit, 0);
  const bestMargin = Math.max(...flips.map(f => f.marginPct));
  const avgConf = flips.reduce((s, f) => s + f.confidenceScore, 0) / flips.length;

  return new EmbedBuilder()
    .setColor(C.flip)
    .setTitle(`💰 ${flips.length} Flips Detected This Cycle`)
    .setDescription(lines.join('\n\n'))
    .addFields(
      { name: 'Total Cycle Profit', value: formatCoins(totalProfit),         inline: true },
      { name: 'Best Margin',         value: `${bestMargin.toFixed(1)}%`,     inline: true },
      { name: 'Avg Confidence',      value: `${avgConf.toFixed(0)}/100`,     inline: true },
    )
    .setFooter({ text: 'SkyBot AH Flipper • Batch Mode' })
    .setTimestamp();
}

// ── Per-user subscription alerts ──────────────────────────────
/**
 * For each flip, check db.ahSubscriptions for any user whose subscribed
 * item name (substring, case-insensitive) matches the flip's item name
 * or signature. Respects per-subscription minProfit. Sends a DM or
 * posts to the user's channelOverride.
 *
 * @param {import('discord.js').Client|null} client
 * @param {Array} flips
 * @returns {Promise<void>}
 */
async function sendSubscriptionAlerts(client, flips) {
  if (!client || flips.length === 0) return;
  const db = getDb();
  const subs = db.ahSubscriptions || {};
  for (const [discordId, sub] of Object.entries(subs)) {
    if (!sub || !Array.isArray(sub.items) || sub.items.length === 0) continue;
    const matched = flips.filter(f => {
      const nameLc = (f.itemName || '').toLowerCase();
      const sigLc  = (f.signature || '').toLowerCase();
      const matches = sub.items.some(item => {
        const itemLc = String(item).toLowerCase();
        return nameLc.includes(itemLc) || sigLc.includes(itemLc);
      });
      if (!matches) return false;
      if (sub.minProfit && f.profit < sub.minProfit) return false;
      return true;
    });
    if (matched.length === 0) continue;
    await sendSubscriptionToUser(client, discordId, sub, matched);
  }
}

/**
 * Send a subscription-matched alert to one user. Tries channelOverride
 * first, then falls back to a DM.
 *
 * @param {import('discord.js').Client} client
 * @param {string} discordId
 * @param {{items:Array,minProfit:number,channelOverride:string|null}} sub
 * @param {Array} matched
 */
async function sendSubscriptionToUser(client, discordId, sub, matched) {
  const embed = buildSubscriptionEmbed(matched);
  const content = `🔔 You have ${matched.length} new flip${matched.length === 1 ? '' : 's'} matching your subscriptions!`;

  // Try channel override first
  if (sub.channelOverride) {
    const ch = await client.channels.fetch(sub.channelOverride).catch(() => null);
    if (ch) {
      try {
        await ch.send({ content: `<@${discordId}>`, embeds: [embed] });
        return;
      } catch (err) {
        console.warn(`[AHFlip] Subscription channel send failed for ${discordId}:`, err.message);
      }
    }
  }

  // DM fallback
  try {
    const user = await client.users.fetch(discordId);
    if (user) {
      await user.send({ content, embeds: [embed] });
    }
  } catch (err) {
    console.warn(`[AHFlip] Subscription DM failed for ${discordId}:`, err.message);
  }
}

/**
 * Build a compact subscription alert embed showing up to 5 matched flips.
 *
 * @param {Array} matched
 * @returns {import('discord.js').EmbedBuilder}
 */
function buildSubscriptionEmbed(matched) {
  const top = matched.slice(0, 5);
  const desc = top.map(f =>
    `**${f.itemName}** — ${formatCoins(f.buyPrice)} → ${formatCoins(f.ewma)} ` +
    `(+${formatCoins(f.profit)}, ${f.marginPct.toFixed(1)}%)\n` +
    `\`/viewauction ${f.uuid}\``
  ).join('\n\n');
  return new EmbedBuilder()
    .setColor(C.flip)
    .setTitle(`🔔 Subscription Alert — ${matched.length} match${matched.length === 1 ? '' : 'es'}`)
    .setDescription(desc)
    .setFooter({ text: 'SkyBot AH Flipper • Subscription' })
    .setTimestamp();
}

// ── Stats persistence ─────────────────────────────────────────
/**
 * Persist accumulated flip stats + top-flips leaderboard to db.json.
 * Called every PERSIST_EVERY scans to avoid hammering disk I/O.
 */
function persistStats() {
  try {
    const db = getDb();
    if (!db.ahFlipStats) db.ahFlipStats = {};
    db.ahFlipStats.totalDetected    = state.totalFlipsDetected;
    db.ahFlipStats.totalProfitCoins = state.totalProfitCoins;
    db.ahFlipStats.lastScanAt       = state.lastScanAt;
    db.ahFlipStats.itemsTracked     = priceHistory.getStats().signatures;
    db.ahFlipStats.topFlips         = state.topFlips.slice(0, TOP_FLIPS_MAX);
    saveDb();
  } catch (err) {
    console.warn('[AHFlip] persistStats failed:', err.message);
  }
}

// ── Public API ────────────────────────────────────────────────
/**
 * Start the AH flip watcher.
 * Uses recursive setTimeout so interval changes from the dashboard take
 * effect on the next cycle (no restart needed).
 *
 * Posts to Discord if AH_FLIP_CHANNEL_ID is set (DB override or env).
 * Otherwise runs in STATS-ONLY mode (scans AH, detects flips, feeds
 * dashboard, but doesn't post to Discord).
 *
 * @param {import('discord.js').Client} client
 */
export function startAHFlipWatcher(client) {
  if (state.timer) {
    console.warn('[AHFlip] Watcher already running');
    return;
  }
  state.client = client;
  state.statsOnlyMode = !shouldPostFlipsToDiscord();
  const C = cfg();
  if (state.statsOnlyMode) {
    console.warn('[AHFlip] No AH_FLIP_CHANNEL_ID configured — STATS-ONLY MODE');
    console.warn('[AHFlip]   (scans AH, builds price history, detects flips for dashboard, does NOT post to Discord)');
    console.warn('[AHFlip]   (set AH_FLIP_CHANNEL_ID via dashboard or env to enable Discord posting)');
  } else {
    console.log(
      `[AHFlip] Starting watcher (interval=${C.intervalSec}s, pages=${C.maxPages}, ` +
      `margin=${C.minMarginPct}%, minProfit=${formatCoins(C.minProfit)}, ` +
      `minDemand=${C.minDemand}, minSamples=${C.minSamples}, maxPerCycle=${C.maxPerCycle})`
    );
    console.log(`[AHFlip] Posting flips to channel ${C.channelId}${C.premiumRoleId ? ` (pinging role ${C.premiumRoleId})` : ''}`);
  }

  // Immediate first scan (no delay — user wants flips ASAP on first run)
  state.timer = setTimeout(function scheduleNext() {
    runScan().catch(err => console.warn('[AHFlip] Scan error:', err.message));
    // Re-read interval each cycle so dashboard changes take effect
    const nextDelay = cfg().intervalSec * 1000;
    state.timer = setTimeout(scheduleNext, nextDelay);
  }, 2000);
}

/**
 * Stop the AH flip watcher and persist final stats to db.
 */
export function stopAHFlipWatcher() {
  if (state.timer) clearTimeout(state.timer);
  state.timer = null;
  persistStats();
  console.log('[AHFlip] Watcher stopped');
}

/**
 * Force an immediate scan now (bypasses the interval timer).
 * Called by the dashboard "Force Scan Now" button.
 * @returns {Promise<object>} scan result summary
 */
export async function forceScan() {
  console.log('[AHFlip] Force scan triggered by dashboard');
  await runScan();
  return {
    scansRun: state.scansRun,
    lastScanFlipsFound: state.lastScanFlipsFound,
    lastScanAuctionsSeen: state.lastScanAuctionsSeen,
    lastScanDurationMs: state.lastScanDurationMs,
  };
}

/**
 * Post a test flip embed to the configured Discord channel.
 * Used by the dashboard "Send Test Flip" button to verify channel setup.
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function postTestFlip() {
  const C = cfg();
  if (!C.channelId) return { ok: false, error: 'AH_FLIP_CHANNEL_ID not configured' };
  if (!state.client) return { ok: false, error: 'Bot client not available' };
  const channel = await state.client.channels.fetch(C.channelId).catch(() => null);
  if (!channel) return { ok: false, error: `Channel ${C.channelId} not found` };

  const testEmbed = new EmbedBuilder()
    .setColor(C.flip ?? 0xFFD700)
    .setTitle('🧪 Test Flip — Channel Verified')
    .setDescription('This is a test flip embed. If you can see this, the flip watcher is correctly configured to post to this channel.')
    .addFields(
      { name: 'Buy Price', value: '1,000,000 coins', inline: true },
      { name: 'Market EWMA', value: '2,000,000 coins', inline: true },
      { name: 'Profit', value: '**+1,000,000**', inline: true },
      { name: 'Margin', value: '50.0%', inline: true },
      { name: 'Demand', value: '20/100', inline: true },
      { name: 'Confidence', value: '42/100', inline: true },
      { name: 'Auction ID', value: '`/viewauction test-uuid-1234`', inline: false },
    )
    .setFooter({ text: 'SkyBot AH Flipper • Test Post' })
    .setTimestamp();

  const ping = C.premiumRoleId ? `<@&${C.premiumRoleId}> ` : '';
  await channel.send({ content: `${ping}🧪 **Test flip** — channel verification`, embeds: [testEmbed] });
  return { ok: true };
}

/**
 * Post a welcome message to the flip channel on first run.
 * Called once on bot startup if the channel is configured and we haven't
 * posted a welcome before (tracked in db.firstRun.welcomePosted).
 *
 * @param {import('discord.js').Client} client
 */
export async function postWelcomeMessage(client) {
  const C = cfg();
  if (!C.channelId || !client) return;
  const db = getDb();
  if (db.firstRun?.welcomePosted) return;

  const channel = await client.channels.fetch(C.channelId).catch(() => null);
  if (!channel) {
    console.warn(`[AHFlip] Cannot post welcome — channel ${C.channelId} not found`);
    return;
  }

  const welcomeEmbed = new EmbedBuilder()
    .setColor(0x00D4AA)
    .setTitle('🚀 SkyBot v2 AH Flipper — Online!')
    .setDescription('The flip watcher is now scanning the Hypixel Auction House and will post profitable flips here.')
    .addFields(
      { name: '📊 Scan Interval', value: `Every **${C.intervalSec}s**`, inline: true },
      { name: '📄 Pages Scanned', value: `${C.maxPages} page(s) per cycle`, inline: true },
      { name: '💰 Min Profit', value: formatCoins(C.minProfit), inline: true },
      { name: '📉 Min Margin', value: `${C.minMarginPct}%`, inline: true },
      { name: '🎯 Min Demand', value: `${C.minDemand}/100`, inline: true },
      { name: '📦 Max Per Cycle', value: `${C.maxPerCycle} flips`, inline: true },
      { name: '⚡ Next Steps', value: 'Flips will appear here automatically. Use `/flip subscribe [item]` to get DM alerts for specific items.', inline: false },
    )
    .setFooter({ text: 'SkyBot v2 • Railway Edition • AH Flipper' })
    .setTimestamp();

  const ping = C.premiumRoleId ? `<@&${C.premiumRoleId}> ` : '';
  try {
    await channel.send({ content: `${ping}🚀 **SkyBot v2 is now online**`, embeds: [welcomeEmbed] });
    if (!db.firstRun) db.firstRun = {};
    db.firstRun.welcomePosted = true;
    db.firstRun.welcomePostedAt = Date.now();
    await saveDb();
    console.log('[AHFlip] Welcome message posted to flip channel');
  } catch (err) {
    console.warn('[AHFlip] Welcome message failed:', err.message);
  }
}

/**
 * Get a snapshot of watcher stats for the dashboard.
 *
 * @returns {object}
 */
export function getFlipWatcherStats() {
  const C = cfg();
  return {
    scansRun: state.scansRun,
    failedScans: state.failedScans,
    totalFlipsDetected: state.totalFlipsDetected,
    totalProfitCoins: state.totalProfitCoins,
    lastScanAt: state.lastScanAt,
    lastScanDurationMs: state.lastScanDurationMs,
    lastScanAuctionsSeen: state.lastScanAuctionsSeen,
    lastScanFlipsFound: state.lastScanFlipsFound,
    itemsTracked: priceHistory.getStats().signatures,
    recentFlips: state.recentFlips.slice(0, RECENT_FLIPS_MAX),
    topFlips: state.topFlips.slice(0, 10),
    seenAuctionsSize: state.seenAuctions.size,
    nextScanAllowedAt: state.nextScanAllowedAt,
    statsOnlyMode: state.statsOnlyMode,
    postingToDiscord: shouldPostFlipsToDiscord(),
    config: {
      intervalSec: C.intervalSec,
      maxPages: C.maxPages,
      minMarginPct: C.minMarginPct,
      minProfit: C.minProfit,
      minDemand: C.minDemand,
      maxPerCycle: C.maxPerCycle,
      minSamples: C.minSamples,
      channelId: C.channelId ? C.channelId.slice(0, 4) + '…' : null,
      premiumRoleId: C.premiumRoleId ? 'set' : null,
      configSource: Object.fromEntries(
        Object.keys(getAllConfig() ?? {}).map(k => [k, getConfigSource(k)])
      ),
    },
  };
}

/**
 * Get the most recent N detected flips (most-recent-first).
 *
 * @param {number} [limit=20]  Maximum results to return (capped at 100)
 * @returns {Array}
 */
export function getRecentFlips(limit = 20) {
  const n = Math.max(1, Math.min(100, Number(limit) || 20));
  return state.recentFlips.slice(0, n);
}

/**
 * Get the top N most-profitable flips ever detected (sorted desc by profit).
 *
 * @param {number} [limit=10]  Maximum results to return (capped at 100)
 * @returns {Array}
 */
export function getTopFlips(limit = 10) {
  const n = Math.max(1, Math.min(100, Number(limit) || 10));
  return state.topFlips.slice(0, n);
}

/**
 * Search the recent-flips ring buffer by item name / tier / signature.
 * Case-insensitive substring match. Returns up to 50 results.
 *
 * @param {string} query  Search string
 * @returns {Array}
 */
export function searchFlips(query) {
  if (!query || typeof query !== 'string') return [];
  const q = query.toLowerCase();
  return state.recentFlips.filter(f =>
    (f.itemName || '').toLowerCase().includes(q) ||
    (f.tier || '').toLowerCase().includes(q) ||
    (f.signature || '').toLowerCase().includes(q)
  ).slice(0, 50);
}

// ── Button handler for "Copy AH ID" buttons ──────────────────
// Called by interactionCreate.js when a button with customId starting
// with "copy_ah_" is clicked. Replies with the /viewauction command
// in an ephemeral message that the user can easily copy on mobile.
export async function handleButton(interaction, client) {
  if (!interaction.customId?.startsWith('copy_ah_')) return false;
  const uuid = interaction.customId.slice(8);
  if (!uuid) return false;

  // Reply with the command in a code block (easy to copy on all platforms)
  await interaction.reply({
    content: `📋 **Copy this command and paste it in Hypixel chat:**\n\`\`\`\n/viewauction ${uuid}\n\`\`\``,
    ephemeral: true,
  });
  return true;
}
