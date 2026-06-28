/**
 * priceHistory.js — SkyBot v2 Sniper-Grade Price Database
 *
 * CRITICAL FIX: Separates HISTORICAL data from CURRENT scan data.
 *
 * - `currentPrices[]` — prices from the CURRENT scan (reset each scan)
 * - `historicalPrices[]` — prices from PREVIOUS scans (accumulated, 30-min TTL)
 *
 * This prevents the #1 flip false-positive: when a cheap item is listed,
 * it shouldn't drag down the median and make itself look like a flip.
 *
 * Market price for flip detection = HISTORICAL median (past scans only)
 * Current lowest BIN = cheapest listing in the CURRENT scan
 *
 * Public API:
 *   startScanEpoch()                        — resets currentPrices for new scan
 *   updatePrice(signature, price)           — add a sample (goes to currentPrices)
 *   finalizeScanEpoch()                     — moves currentPrices → historicalPrices
 *   getMarketPrice(signature)               — returns {lowestBin, secondLowestBin, median, p5, count, volume, ...}
 *   getStats()                              — aggregate stats
 *   exportSnapshot()                        — all records for dashboard
 *   prune(maxAgeMs)                         — remove stale records
 */

/** Max historical samples per signature. */
const HISTORICAL_MAX = 100;

/** How long to retain historical samples (30 min). */
const HISTORICAL_TTL_MS = 30 * 60 * 1000;

/** @type {Map<string, PriceRecord>} */
const store = new Map();

/** Whether we're collecting current-scan data. */
let scanEpoch = false;

/**
 * @typedef {Object} PriceRecord
 * @property {number[]} currentPrices    Prices seen in the CURRENT scan
 * @property {number[]} historicalPrices  Prices from PREVIOUS scans (for median)
 * @property {number} lowestBin           Cheapest in current scan
 * @property {number} secondLowestBin     2nd cheapest in current scan
 * @property {number} median              Median of HISTORICAL prices
 * @property {number} p5                  5th percentile of HISTORICAL prices
 * @property {number} min                 All-time min
 * @property {number} max                 All-time max
 * @property {number} count               Total samples ever seen
 * @property {number} volume              Estimated sales per day
 * @property {number} lastSeen            unix ms
 * @property {number} ewma                EWMA (kept for compat)
 */

/**
 * Start a new scan epoch. Resets currentPrices for all records.
 */
export function startScanEpoch() {
  scanEpoch = true;
  for (const rec of store.values()) {
    rec.currentPrices = [];
    rec.lowestBin = Infinity;
    rec.secondLowestBin = Infinity;
  }
}

/**
 * Add a price sample. During a scan epoch, goes to currentPrices.
 */
export function updatePrice(signature, price) {
  if (!signature || typeof signature !== 'string') return null;
  if (typeof price !== 'number' || !isFinite(price) || price <= 0) return null;

  const now = Date.now();
  let rec = store.get(signature);

  if (!rec) {
    rec = {
      currentPrices: [],
      historicalPrices: [],
      lowestBin: Infinity,
      secondLowestBin: Infinity,
      median: 0,
      p5: 0,
      min: price,
      max: price,
      count: 0,
      volume: 0,
      lastSeen: now,
      ewma: price,
    };
    store.set(signature, rec);
  }

  rec.count += 1;
  rec.lastSeen = now;

  if (price < rec.min) rec.min = price;
  if (price > rec.max) rec.max = price;

  // EWMA (kept for backward compat)
  if (rec.count > 1) {
    rec.ewma = (0.3 * price) + (0.7 * rec.ewma);
  }

  // During scan epoch, track current prices
  if (scanEpoch) {
    rec.currentPrices.push(price);
    if (price < rec.lowestBin) {
      rec.secondLowestBin = rec.lowestBin;
      rec.lowestBin = price;
    } else if (price < rec.secondLowestBin && price > rec.lowestBin) {
      rec.secondLowestBin = price;
    }
  }

  return rec;
}

/**
 * Finalize the scan epoch. Moves currentPrices into historicalPrices
 * and recomputes median/p5 from historical data.
 *
 * CRITICAL: This must be called AFTER all auctions in a scan are processed,
 * BEFORE flip detection runs. This way:
 *   - `lowestBin` / `secondLowestBin` reflect the CURRENT scan (what's buyable NOW)
 *   - `median` / `p5` reflect PREVIOUS scans (historical market price)
 */
export function finalizeScanEpoch() {
  scanEpoch = false;
  const now = Date.now();
  const cutoff = now - HISTORICAL_TTL_MS;

  for (const rec of store.values()) {
    // Move current scan prices into historical
    if (rec.currentPrices.length > 0) {
      rec.historicalPrices.push(...rec.currentPrices);
    }

    // Prune old historical samples (keep last HISTORICAL_MAX)
    if (rec.historicalPrices.length > HISTORICAL_MAX) {
      rec.historicalPrices = rec.historicalPrices.slice(-HISTORICAL_MAX);
    }

    // Recompute median and p5 from HISTORICAL data only
    if (rec.historicalPrices.length >= 2) {
      const sorted = [...rec.historicalPrices].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      rec.median = sorted.length % 2 === 0
        ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
        : sorted[mid];
      const p5idx = Math.max(0, Math.floor(sorted.length * 0.05));
      rec.p5 = sorted[p5idx];

      // Volume estimate: historical samples / 30 min * 1440 min/day
      rec.volume = Math.round((rec.historicalPrices.length / 30) * 1440);
    }
  }
}

/**
 * Get market price snapshot for a signature.
 *
 * Returns:
 *   - lowestBin / secondLowestBin: from CURRENT scan (what's buyable now)
 *   - median / p5: from HISTORICAL data (past market price)
 *   - count: total historical samples
 *
 * @param {string} signature
 * @returns {object|null}
 */
export function getMarketPrice(signature) {
  const rec = store.get(signature);
  if (!rec) return null;
  return {
    lowestBin: rec.lowestBin === Infinity ? 0 : rec.lowestBin,
    secondLowestBin: rec.secondLowestBin === Infinity ? 0 : rec.secondLowestBin,
    median: rec.median,
    p5: rec.p5,
    min: rec.min,
    max: rec.max,
    count: rec.historicalPrices.length,
    volume: rec.volume,
    lastSeen: rec.lastSeen,
    ewma: rec.ewma,
  };
}

/**
 * Aggregate stats for dashboard.
 */
export function getStats() {
  let totalSamples = 0;
  let oldestSeen = Date.now();
  let hasAny = false;
  for (const r of store.values()) {
    totalSamples += r.count;
    if (r.lastSeen < oldestSeen) {
      oldestSeen = r.lastSeen;
      hasAny = true;
    }
  }
  return {
    signatures: store.size,
    totalSamples,
    oldestSignatureMs: hasAny ? (Date.now() - oldestSeen) : 0,
  };
}

/**
 * Export all signatures for dashboard.
 */
export function exportSnapshot() {
  const out = [];
  for (const [sig, r] of store.entries()) {
    out.push({
      signature: sig,
      lowestBin: r.lowestBin === Infinity ? 0 : r.lowestBin,
      secondLowestBin: r.secondLowestBin === Infinity ? 0 : r.secondLowestBin,
      median: r.median,
      p5: r.p5,
      min: r.min,
      max: r.max,
      count: r.historicalPrices.length,
      volume: r.volume,
      lastSeen: r.lastSeen,
    });
  }
  out.sort((a, b) => b.count - a.count);
  return out;
}

/**
 * Remove stale records.
 */
export function prune(maxAgeMs) {
  if (typeof maxAgeMs !== 'number' || maxAgeMs <= 0) return 0;
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  for (const sig of [...store.keys()]) {
    const r = store.get(sig);
    if (r && r.lastSeen < cutoff) {
      store.delete(sig);
      removed++;
    }
  }
  return removed;
}

/** Reset (tests only). */
export function _reset() {
  store.clear();
  scanEpoch = false;
}
