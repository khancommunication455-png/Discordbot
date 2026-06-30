/**
 * ahFlipWatcher.js — SkyBot v2 AH Flip Tracker FIXED
 *
 * FIXES:
 * 1. Removed dead external price APIs (moulberry.codes = Cloudflare 525,
 *    api.skyhelper.net = does not resolve). Pricing now comes entirely from
 *    the bot's own EWMA/median, built from the 10,000-auction scans already
 *    running every cycle — this data was always more current than the dead
 *    third-party mirrors anyway.
 * 2. minSamples lowered from 5 → 3 by default, so flips surface within the
 *    first 2-3 scan cycles (~60-90s) instead of waiting indefinitely.
 * 3. Channel posting validated on startup with clear log output.
 * 4. seenAuctions TTL reduced to 5min so re-listed items are caught faster.
 */
import { getAllAuctions, parseItemAttributes } from './hypixel.js';
import * as priceHistory from './priceHistory.js';
import { getDb, saveDb } from '../utils/db.js';
import { C, formatCoins } from '../utils/embeds.js';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getConfig, getAllConfig, getConfigSource, shouldPostFlipsToDiscord, isFlipWatcherEnabled } from '../utils/runtimeConfig.js';

// ── Config reader ──
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

const SEEN_TTL_MS        = 5 * 60 * 1000;
const SEEN_CLEANUP_EVERY = 3 * 60 * 1000;
const PERSIST_EVERY      = 5;
const RATE_LIMIT_BACKOFF = 60 * 1000;
const TOP_FLIPS_MAX      = 100;
const RECENT_FLIPS_MAX   = 20;

const state = {
  timer: null,
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
  recentFlips: [],
  topFlips: [],
  seenAuctions: new Map(),
  lastSeenCleanup: 0,
  nextScanAllowedAt: 0,
  statsOnlyMode: false,
};

export function buildSignature(attrs) {
  const petLevelBucket = attrs.isPet ? Math.floor(attrs.petLevel / 10) * 10 : 0;
  return [attrs.name, attrs.tier, attrs.isPet ? '1' : '0', petLevelBucket, attrs.stars, attrs.isRecombobulated ? '1' : '0'].join('|');
}

// ── Core scan ──
async function runScan() {
  if (state.running) return;
  const now = Date.now();
  if (now < state.nextScanAllowedAt) {
    const waitSec = Math.ceil((state.nextScanAllowedAt - now) / 1000);
    console.warn(`[AHFlip] Rate-limit backoff, waiting ${waitSec}s`);
    return;
  }

  const C = cfg();
  state.running = true;
  const t0 = Date.now();

  // ── Fetch auctions ──
  let auctions = [];
  try {
    auctions = await getAllAuctions(C.maxPages);
  } catch (err) {
    state.failedScans++;
    if (err?.response?.status === 429) {
      console.warn('[AHFlip] Hypixel 429 — backing off 60s');
      state.nextScanAllowedAt = Date.now() + RATE_LIMIT_BACKOFF;
    } else {
      console.warn('[AHFlip] Scan failed:', err?.message || String(err));
    }
    state.running = false;
    return;
  }

  const flipsThisCycle = [];
  let binsScanned = 0;

  for (const a of auctions) {
    if (!a.bin) continue;
    if (state.seenAuctions.has(a.uuid)) continue;
    state.seenAuctions.set(a.uuid, Date.now());
    binsScanned++;

    let attrs;
    try { attrs = parseItemAttributes(a); }
    catch (err) { console.warn(`[AHFlip] parse failed ${a.uuid}:`, err.message); continue; }
    if (!attrs.name) continue;

    const sig = buildSignature(attrs);
    priceHistory.updatePrice(sig, a.starting_bid);

    const listPrice = a.starting_bid;

    // ── Market price comes from the bot's own EWMA/median history ──
    const market = priceHistory.getMarketPrice(sig);
    if (!market || market.count < C.minSamples) continue;

    const marketPrice = market.ewma;
    if (!marketPrice || marketPrice <= listPrice) continue;

    const priceSource = 'ewma';
    const marginPct = (1 - listPrice / marketPrice) * 100;
    const profit = marketPrice - listPrice;

    // ── Apply thresholds ──
    if (marginPct < C.minMarginPct) continue;
    if (profit < C.minProfit) continue;
    if (attrs.demandScore < C.minDemand) continue;

    // Confidence: higher with more samples, higher demand, and bigger margin
    const sampleCount = market.count;
    const volumeScore = Math.min(100, sampleCount * 4);
    const confidenceScore = Math.min(
      100,
      0.35 * volumeScore +
      0.35 * attrs.demandScore +
      0.3 * Math.min(100, marginPct * 2),
    );

    flipsThisCycle.push({
      uuid: a.uuid,
      itemName: attrs.name,
      tier: attrs.tier,
      buyPrice: listPrice,
      ewma: marketPrice,
      p5: market?.p5 ?? marketPrice * 0.9,
      profit,
      profitFloor: Math.max(0, (market?.p5 ?? marketPrice * 0.9) - listPrice),
      marginPct,
      demandScore: attrs.demandScore,
      volumeScore,
      confidenceScore,
      sampleCount,
      priceSource,
      signature: sig,
      attrs,
      detectedAt: Date.now(),
    });
  }

  flipsThisCycle.sort((a, b) => b.profit - a.profit);

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

  await sendFlips(flipsThisCycle, C);
  await sendSubscriptionAlerts(state.client, flipsThisCycle);

  if (state.scansRun % PERSIST_EVERY === 0) persistStats();

  if (Date.now() - state.lastSeenCleanup > SEEN_CLEANUP_EVERY) { cleanupSeen(); state.lastSeenCleanup = Date.now(); }

  state.running = false;

  const msg = `[AHFlip] Scan #${state.scansRun}: ${auctions.length} auctions, ${binsScanned} new BINs, ${flipsThisCycle.length} flips found`;
  if (flipsThisCycle.length > 0) {
    console.log(msg + ` (top: ${formatCoins(flipsThisCycle[0].profit)} profit — ${flipsThisCycle[0].itemName})`);
  } else {
    console.log(msg + ` (no flips above thresholds)`);
  }
}

function stripFlip(f) {
  return {
    uuid: f.uuid, itemName: f.itemName, tier: f.tier,
    buyPrice: f.buyPrice, ewma: f.ewma, profit: f.profit,
    profitFloor: f.profitFloor, marginPct: f.marginPct,
    demandScore: f.demandScore, volumeScore: f.volumeScore,
    confidenceScore: f.confidenceScore, sampleCount: f.sampleCount,
    priceSource: f.priceSource,
    signature: f.signature, detectedAt: f.detectedAt,
  };
}

function insertTopFlip(arr, flip) {
  arr.push(flip);
  arr.sort((a, b) => b.profit - a.profit);
  if (arr.length > TOP_FLIPS_MAX) arr.pop();
}

function cleanupSeen() {
  const cutoff = Date.now() - SEEN_TTL_MS;
  for (const [uuid, ts] of state.seenAuctions) { if (ts < cutoff) state.seenAuctions.delete(uuid); }
}

function persistStats() {
  try {
    const db = getDb();
    if (!db.ahFlipStats) db.ahFlipStats = {};
    db.ahFlipStats = {
      scansRun: state.scansRun, failedScans: state.failedScans,
      totalFlipsDetected: state.totalFlipsDetected, totalProfitCoins: state.totalProfitCoins,
      lastScanAt: state.lastScanAt, topFlips: state.topFlips.slice(0, 20),
      recentFlips: state.recentFlips.slice(0, 20),
    };
    saveDb().catch(() => {});
  } catch {}
}

// ── Embed builders ──
function buildFlipEmbed(f) {
  const tierColors = { MYTHIC: 0xFF55FF, LEGENDARY: 0xFFAA00, EPIC: 0xAA00AA, RARE: 0x5555FF, UNCOMMON: 0x55FF55, COMMON: 0xFFFFFF };
  const color = tierColors[f.tier] ?? 0x00D4AA;

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`💰 ${f.itemName}`)
    .addFields(
      { name: '🏷️ Buy Now', value: formatCoins(f.buyPrice), inline: true },
      { name: '📈 Market (EWMA)', value: formatCoins(f.ewma), inline: true },
      { name: '💵 Profit', value: `**+${formatCoins(f.profit)}**`, inline: true },
      { name: '📈 Margin', value: `${f.marginPct.toFixed(1)}%`, inline: true },
      { name: '🎯 Tier', value: f.tier || 'Unknown', inline: true },
      { name: '⭐ Confidence', value: `${Math.round(f.confidenceScore)}/100`, inline: true },
      { name: '📋 Command', value: `\`/viewauction ${f.uuid}\``, inline: false },
    )
    .setFooter({ text: 'SkyBot v2 AH Flipper' })
    .setTimestamp();
}

function buildBatchEmbed(flips) {
  const lines = flips.slice(0, 8).map((f, i) =>
    `\`${i + 1}.\` **${f.itemName}**\n` +
    `   Buy: ${formatCoins(f.buyPrice)} → Profit: **+${formatCoins(f.profit)}** (${f.marginPct.toFixed(0)}%)`
  );
  return new EmbedBuilder()
    .setColor(0x00D4AA)
    .setTitle(`🔥 ${flips.length} Flips Found!`)
    .setDescription(lines.join('\n\n'))
    .setFooter({ text: 'SkyBot v2 AH Flipper • EWMA pricing' })
    .setTimestamp();
}

async function sendFlips(flips, C) {
  if (!shouldPostFlipsToDiscord()) {
    if (flips.length > 0) console.log(`[AHFlip] ${flips.length} flips found but AH_FLIP_CHANNEL_ID not set — skipping Discord post`);
    return;
  }
  if (!state.client) { console.warn('[AHFlip] No client — cannot post'); return; }
  if (!C.channelId) { console.warn('[AHFlip] No AH_FLIP_CHANNEL_ID — cannot post'); return; }
  if (flips.length === 0) return;

  let channel;
  try {
    channel = await state.client.channels.fetch(C.channelId);
  } catch (e) {
    console.error(`[AHFlip] Cannot fetch channel ${C.channelId}:`, e.message);
    return;
  }
  if (!channel) { console.error(`[AHFlip] Channel ${C.channelId} not found`); return; }

  const ping = C.premiumRoleId ? `<@&${C.premiumRoleId}> ` : '';
  const top = flips.slice(0, C.maxPerCycle);

  const row = new ActionRowBuilder().addComponents(
    top.slice(0, 3).map(f => new ButtonBuilder()
      .setLabel(`Copy: ${f.uuid.slice(0, 8)}`)
      .setCustomId(`ah_copy_${f.uuid}`)
      .setStyle(ButtonStyle.Secondary))
  );

  try {
    if (top.length === 1) {
      await channel.send({ content: `${ping}🔥 **Flip detected!**`, embeds: [buildFlipEmbed(top[0])], components: [row] });
    } else if (top.length === 2) {
      await channel.send({ content: `${ping}🔥 **${top.length} flips detected!**`, embeds: [buildFlipEmbed(top[0]), buildFlipEmbed(top[1])], components: [row] });
    } else {
      await channel.send({ content: `${ping}🔥 **${top.length} flips detected!**`, embeds: [buildBatchEmbed(top)], components: [row] });
    }
    console.log(`[AHFlip] Posted ${top.length} flip(s) to channel ${C.channelId}`);
  } catch (e) {
    console.error('[AHFlip] Failed to post flips:', e.message);
  }
}

async function sendSubscriptionAlerts(client, flips) {
  if (!client || !flips.length) return;
  const db = getDb();
  const subs = db.ahSubscriptions ?? {};
  for (const [discordId, sub] of Object.entries(subs)) {
    if (!sub?.items?.length) continue;
    const matched = flips.filter(f =>
      sub.items.some(item => f.itemName.toLowerCase().includes(item.toLowerCase()))
    );
    if (!matched.length) continue;
    try {
      const user = await client.users.fetch(discordId).catch(() => null);
      if (!user) continue;
      for (const f of matched.slice(0, 3)) {
        await user.send({ content: `🔔 **Flip alert for ${f.itemName}!**`, embeds: [buildFlipEmbed(f)] }).catch(() => {});
      }
    } catch (e) {
      console.warn(`[AHFlip] Subscription alert failed for ${discordId}:`, e.message);
    }
  }
}

// ── Public API ──
export function startAHFlipWatcher(client) {
  if (state.timer) return;
  state.client = client;
  state.statsOnlyMode = !shouldPostFlipsToDiscord();

  const C = cfg();
  console.log(`[AHFlip] Starting watcher — interval=${C.intervalSec}s, pages=${C.maxPages}, minProfit=${formatCoins(C.minProfit)}, minMargin=${C.minMarginPct}%`);

  if (!C.channelId) {
    console.warn('[AHFlip] ⚠️  AH_FLIP_CHANNEL_ID not set — flips will NOT be posted to Discord!');
    console.warn('[AHFlip] Set AH_FLIP_CHANNEL_ID in Railway env vars to a text channel ID.');
  } else {
    console.log(`[AHFlip] Will post flips to channel: ${C.channelId}`);
  }

  // Load previous stats from db
  const db = getDb();
  if (db.ahFlipStats) {
    state.scansRun = db.ahFlipStats.scansRun ?? 0;
    state.totalFlipsDetected = db.ahFlipStats.totalFlipsDetected ?? 0;
    state.totalProfitCoins = db.ahFlipStats.totalProfitCoins ?? 0;
    state.topFlips = db.ahFlipStats.topFlips ?? [];
    state.recentFlips = db.ahFlipStats.recentFlips ?? [];
  }

  // First scan after 3s (let bot fully start), then on interval
  state.timer = setTimeout(function scheduleNext() {
    runScan().catch(err => console.warn('[AHFlip] Scan error:', err.message));
    const nextDelay = cfg().intervalSec * 1000;
    state.timer = setTimeout(scheduleNext, nextDelay);
  }, 3000);
}

export function stopAHFlipWatcher() {
  if (state.timer) clearTimeout(state.timer);
  state.timer = null;
  persistStats();
  console.log('[AHFlip] Watcher stopped');
}

export async function forceScan() {
  console.log('[AHFlip] Force scan triggered');
  await runScan();
  return { scansRun: state.scansRun, lastScanFlipsFound: state.lastScanFlipsFound, lastScanAuctionsSeen: state.lastScanAuctionsSeen, lastScanDurationMs: state.lastScanDurationMs };
}

export async function postTestFlip() {
  const C = cfg();
  if (!C.channelId) return { ok: false, error: 'AH_FLIP_CHANNEL_ID not configured' };
  if (!state.client) return { ok: false, error: 'Bot client not available' };
  const channel = await state.client.channels.fetch(C.channelId).catch(() => null);
  if (!channel) return { ok: false, error: `Channel ${C.channelId} not found — verify the ID is correct` };

  const testEmbed = new EmbedBuilder()
    .setColor(0xFFD700).setTitle('🧪 Test Flip — Channel Verified')
    .setDescription('The flip channel is correctly configured. Real flips will appear here automatically.')
    .addFields(
      { name: 'Buy Price', value: '1,000,000 coins', inline: true },
      { name: 'EWMA Market', value: '2,000,000 coins', inline: true },
      { name: 'Profit', value: '**+1,000,000**', inline: true },
      { name: 'Margin', value: '50.0%', inline: true },
      { name: 'Confidence', value: '75/100', inline: true },
      { name: 'Price Source', value: '📈 EWMA', inline: true },
    ).setFooter({ text: 'SkyBot v2 AH Flipper • EWMA Pricing' }).setTimestamp();

  const ping = C.premiumRoleId ? `<@&${C.premiumRoleId}> ` : '';
  await channel.send({ content: `${ping}🧪 **Test flip — channel verified**`, embeds: [testEmbed] });
  return { ok: true };
}

export async function postWelcomeMessage(client) {
  const C = cfg();
  if (!C.channelId || !client) return;
  const db = getDb();
  if (db.firstRun?.welcomePosted) return;

  const channel = await client.channels.fetch(C.channelId).catch(() => null);
  if (!channel) { console.warn(`[AHFlip] Cannot post welcome — channel ${C.channelId} not found`); return; }

  const welcomeEmbed = new EmbedBuilder()
    .setColor(0x00D4AA).setTitle('🚀 SkyBot v2 AH Flipper — Online!')
    .setDescription('Scanning the Hypixel Auction House. Flips powered by self-built **EWMA price history** — should appear within 1-3 scan cycles as data builds up.')
    .addFields(
      { name: '📊 Scan Interval', value: `Every **${C.intervalSec}s**`, inline: true },
      { name: '📄 Pages/Scan', value: `${C.maxPages} pages`, inline: true },
      { name: '💰 Min Profit', value: formatCoins(C.minProfit), inline: true },
      { name: '📉 Min Margin', value: `${C.minMarginPct}%`, inline: true },
      { name: '⚡ Price Source', value: 'Self-built EWMA', inline: true },
      { name: '🎯 First Flip ETA', value: `~${C.intervalSec * 2}-${C.intervalSec * 3}s after start`, inline: true },
    ).setFooter({ text: 'SkyBot v2 • Railway Edition • AH Flipper' }).setTimestamp();

  const ping = C.premiumRoleId ? `<@&${C.premiumRoleId}> ` : '';
  try {
    await channel.send({ content: `${ping}🚀 **SkyBot v2 is now online**`, embeds: [welcomeEmbed] });
    if (!db.firstRun) db.firstRun = {};
    db.firstRun.welcomePosted = true;
    db.firstRun.welcomePostedAt = Date.now();
    await saveDb();
    console.log('[AHFlip] Welcome posted to flip channel');
  } catch (err) {
    console.warn('[AHFlip] Welcome message failed:', err.message);
  }
}

export function getFlipWatcherStats() {
  const C = cfg();
  return {
    scansRun: state.scansRun, failedScans: state.failedScans,
    totalFlipsDetected: state.totalFlipsDetected, totalProfitCoins: state.totalProfitCoins,
    lastScanAt: state.lastScanAt, lastScanDurationMs: state.lastScanDurationMs,
    lastScanAuctionsSeen: state.lastScanAuctionsSeen, lastScanFlipsFound: state.lastScanFlipsFound,
    itemsTracked: priceHistory.getStats().signatures,
    recentFlips: state.recentFlips.slice(0, RECENT_FLIPS_MAX),
    topFlips: state.topFlips.slice(0, 10),
    seenAuctionsSize: state.seenAuctions.size,
    pricingMethod: 'self-built-ewma',
    statsOnlyMode: state.statsOnlyMode,
    postingToDiscord: shouldPostFlipsToDiscord(),
    config: {
      intervalSec: C.intervalSec, maxPages: C.maxPages,
      minMarginPct: C.minMarginPct, minProfit: C.minProfit,
      minDemand: C.minDemand, maxPerCycle: C.maxPerCycle, minSamples: C.minSamples,
      channelId: C.channelId ? C.channelId.slice(0, 4) + '…' : null,
      premiumRoleId: C.premiumRoleId ? 'set' : null,
      configSource: Object.fromEntries(Object.keys(getAllConfig() ?? {}).map(k => [k, getConfigSource(k)])),
    },
  };
}

export function getRecentFlips(limit = 20) { return state.recentFlips.slice(0, Math.max(1, Math.min(100, Number(limit) || 20))); }
export function getTopFlips(limit = 10) { return state.topFlips.slice(0, Math.max(1, Math.min(100, Number(limit) || 10))); }
export function searchFlips(query) {
  if (!query || typeof query !== 'string') return [];
  const q = query.toLowerCase();
  return state.recentFlips.filter(f =>
    (f.itemName || '').toLowerCase().includes(q) ||
    (f.tier || '').toLowerCase().includes(q) ||
    (f.signature || '').toLowerCase().includes(q)
  ).slice(0, 50);
}
