/**
 * auctionSoldWatcher.js — SkyBot v2 Auction Sold Watcher
 *
 * Polls each linked player's active and recent auctions on Hypixel
 * and alerts them when an auction transitions from claimed=false →
 * claimed=true with a non-zero highest_bid_amount (i.e., it actually
 * sold and was settled).
 *
 * Improvements over v1:
 *  - Per-UUID known-state tracking (Map<uuid, Map<auctionId, rec>>)
 *  - Alert deduplication (each auction UUID alerted at most once)
 *  - DM alert with channel fallback to AUCTION_SOLD_CHANNEL_ID
 *  - 2-minute scan interval (setInterval, not node-cron)
 *  - Stats exposed for the dashboard
 *
 * Environment variables:
 *   AUCTION_SOLD_CHANNEL_ID  Channel to fall back to when DM fails
 */
import { getPlayerAuctions } from './hypixel.js';
import { getDb } from '../utils/db.js';
import { C, formatCoins } from '../utils/embeds.js';
import { EmbedBuilder } from 'discord.js';

// ── Configuration ─────────────────────────────────────────────
const INTERVAL_MS        = 2 * 60 * 1000;   // 2 minutes
const SOLD_CHANNEL_ID    = process.env.AUCTION_SOLD_CHANNEL_ID || null;
const INITIAL_SCAN_DELAY = 8_000;            // grace period before first scan
const PER_PLAYER_DELAY   = 250;              // staggered to be polite to Hypixel

// ── Runtime state ─────────────────────────────────────────────
const state = {
  /** @type {NodeJS.Timeout|null} */
  timer: null,
  /** @type {import('discord.js').Client|null} */
  client: null,
  running: false,
  /**
   * uuid → Map<auctionId, {
   *   claimed: boolean,
   *   highest_bid: number,
   *   alerted: boolean,
   *   itemName: string,
   *   endsAt: number
   * }>
   * @type {Map<string, Map<string, object>>}
   */
  knownAuctions: new Map(),
  totalAlertsSent: 0,
  totalCoinsTracked: 0,
  lastScanAt: 0,
  lastScanDurationMs: 0,
  lastScanPlayersChecked: 0,
  lastScanAuctionsChecked: 0,
  lastScanNewlySold: 0,
  failedScans: 0,
};

/**
 * Run a single sold-auction scan cycle. Iterates every linked player,
 * fetches their auctions from Hypixel, and detects claimed transitions.
 *
 * Re-entrancy safe — no-op if a previous scan is still running.
 *
 * @returns {Promise<void>}
 */
async function runScan() {
  if (state.running) return;
  state.running = true;
  const t0 = Date.now();

  const db = getDb();
  const linkedPlayers = db.linkedPlayers || {};
  const playerList = Object.entries(linkedPlayers).map(([discordId, info]) => ({
    discordId,
    ign: info?.ign,
    uuid: info?.uuid,
  }));

  state.lastScanPlayersChecked = playerList.length;
  let auctionsChecked = 0;
  let newlySold = 0;

  for (const player of playerList) {
    if (!player.uuid) continue;

    let auctions = [];
    try {
      auctions = await getPlayerAuctions(player.uuid);
    } catch (err) {
      console.warn(`[AHSold] getPlayerAuctions failed for ${player.ign || player.uuid}:`, err.message);
      state.failedScans++;
      continue;
    }
    auctionsChecked += auctions.length;

    let knownMap = state.knownAuctions.get(player.uuid);
    if (!knownMap) {
      knownMap = new Map();
      state.knownAuctions.set(player.uuid, knownMap);
    }

    for (const a of auctions) {
      const id = a.uuid || a.id;
      if (!id) continue;

      const claimed  = !!a.claimed;
      const bid      = a.highest_bid_amount || 0;
      const itemName = a.item_name || 'Unknown Item';
      const endsAt   = (a.end ?? 0) * 1000;
      const prev     = knownMap.get(id);

      // First sighting — just record its state, no alert
      if (!prev) {
        knownMap.set(id, {
          claimed,
          highest_bid: bid,
          alerted: false,
          itemName,
          endsAt,
        });
        continue;
      }

      // Transition: was unclaimed → now claimed, with a real bid, not yet alerted
      if (!prev.claimed && claimed && bid > 0 && !prev.alerted) {
        prev.claimed     = claimed;
        prev.highest_bid = bid;
        prev.alerted     = true;
        newlySold++;
        state.totalAlertsSent++;
        state.totalCoinsTracked += bid;
        await sendSoldAlert(state.client, player, {
          uuid: id,
          itemName,
          bid,
          endsAt: prev.endsAt,
        });
      } else {
        // Update tracked state in-place
        prev.claimed = claimed;
        if (bid > prev.highest_bid) prev.highest_bid = bid;
      }
    }

    // Be polite to Hypixel between players
    if (PER_PLAYER_DELAY > 0) {
      await new Promise(r => setTimeout(r, PER_PLAYER_DELAY));
    }
  }

  state.lastScanAt = Date.now();
  state.lastScanDurationMs = state.lastScanAt - t0;
  state.lastScanAuctionsChecked = auctionsChecked;
  state.lastScanNewlySold = newlySold;
  state.running = false;
}

/**
 * Send a "your auction sold" alert. DMs the user first; on DM failure
 * (e.g., user has DMs closed) falls back to AUCTION_SOLD_CHANNEL_ID.
 *
 * @param {import('discord.js').Client|null} client
 * @param {{discordId:string,ign?:string,uuid?:string}} player
 * @param {{uuid:string,itemName:string,bid:number,endsAt:number}} auction
 * @returns {Promise<void>}
 */
async function sendSoldAlert(client, player, auction) {
  if (!client) return;

  const embed = new EmbedBuilder()
    .setColor(C.economy)
    .setTitle(`💰 Auction Sold!`)
    .setDescription(`Your auction for **${auction.itemName}** has been claimed.`)
    .addFields(
      { name: 'Sale Price',  value: `${formatCoins(auction.bid)} coins`, inline: true },
      { name: 'Auction ID',  value: `\`${auction.uuid}\``,                inline: true },
    )
    .setFooter({ text: 'SkyBot Auction Sold Watcher' })
    .setTimestamp();

  // DM attempt
  try {
    const user = await client.users.fetch(player.discordId);
    if (user) {
      await user.send({ embeds: [embed] });
      return;
    }
  } catch (err) {
    console.warn(`[AHSold] DM failed for ${player.discordId}:`, err.message);
  }

  // Channel fallback
  if (SOLD_CHANNEL_ID) {
    try {
      const ch = await client.channels.fetch(SOLD_CHANNEL_ID).catch(() => null);
      if (ch) {
        await ch.send({ content: `<@${player.discordId}>`, embeds: [embed] });
      } else {
        console.warn(`[AHSold] Fallback channel not found: ${SOLD_CHANNEL_ID}`);
      }
    } catch (err) {
      console.warn('[AHSold] Channel send failed:', err.message);
    }
  }
}

// ── Public API ────────────────────────────────────────────────
/**
 * Start the auction sold watcher. Scans every linked player's
 * auctions on a 2-minute interval. First scan runs after an 8s grace
 * period to allow the Discord client to fully ready up.
 *
 * @param {import('discord.js').Client} client
 */
export function startAuctionSoldWatcher(client) {
  if (state.timer) {
    console.warn('[AHSold] Watcher already running');
    return;
  }
  state.client = client;
  console.log(`[AHSold] Starting auction sold watcher (interval=${INTERVAL_MS / 1000}s)`);
  setTimeout(() => {
    runScan().catch(err => console.warn('[AHSold] Initial scan error:', err.message));
  }, INITIAL_SCAN_DELAY);
  state.timer = setInterval(() => {
    runScan().catch(err => console.warn('[AHSold] Scan error:', err.message));
  }, INTERVAL_MS);
}

/**
 * Stop the auction sold watcher.
 */
export function stopAuctionSoldWatcher() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  console.log('[AHSold] Watcher stopped');
}

/**
 * Get a snapshot of sold-watcher stats for the dashboard.
 *
 * @returns {object}
 */
export function getAuctionSoldStats() {
  return {
    totalAlertsSent: state.totalAlertsSent,
    totalCoinsTracked: state.totalCoinsTracked,
    lastScanAt: state.lastScanAt,
    lastScanDurationMs: state.lastScanDurationMs,
    lastScanPlayersChecked: state.lastScanPlayersChecked,
    lastScanAuctionsChecked: state.lastScanAuctionsChecked,
    lastScanNewlySold: state.lastScanNewlySold,
    failedScans: state.failedScans,
    playersTracked: state.knownAuctions.size,
  };
}

/**
 * Force a manual scan cycle (used by the dashboard "scan now" button).
 * Returns a promise that resolves when the scan completes.
 *
 * @returns {Promise<void>}
 */
export async function forceScan() {
  return runScan();
}
