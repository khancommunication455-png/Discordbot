/**
 * priceHistory.js — SkyBot v2 Sniper-Grade Price Database
 *
 * Rewritten to match the Coflnet/SkyCofl flip-finding approach:
 *   - Tracks lowestBin + secondLowestBin per signature (Sniper algorithm)
 *   - Tracks median (p50) from recent samples (Sniper Median algorithm)
 *   - Tracks volume (sales/day estimate)
 *
 * A "signature" groups items by relevant modifiers:
 *   name|tier|isPet|petLevelBucket|stars|isRecombobulated|reforge|hpbBucket|keyEnchants
 *
 * Public API:
 *   updatePrice(signature, price)           — add a sample
 *   getMarketPrice(signature)               — returns {lowestBin, secondLowestBin, median, p5, min, max, count, volume, lastSeen}
 *   startScanEpoch()                        — marks the start of a scan (resets lowestBin/secondLowestBin for re-discovery)
 *   finalizeScanEpoch()                     — commits the scan results
 *   getStats()                              — aggregate stats
 *   exportSnapshot()                        — all records for dashboard
 *   prune(maxAgeMs)                         — remove stale records
 */

/** Maximum length of the per-signature recent[] ring buffer. */
const RECENT_MAX = 100;

/** How long to retain samples for median calc (15 min). */
const SAMPLE_TTL_MS = 15 * 60 * 1000;

/**
 * @typedef {Object} PriceRecord
 * @property {number} lowestBin          Current lowest BIN for this signature
 * @property {number} secondLowestBin    Second lowest BIN (validation)
 * @property {number} median             Median (p50) from recent samples
 * @property {number} p5                 5th percentile (conservative floor)
 * @property {number} min                All-time min
 * @property {number} max                All-time max
 * @property {number} count              Total samples ever seen
 * @property {number} volume             Estimated sales per day
 * @property {number} lastSeen           unix ms of last update
 * @property {number[]} recent           last RECENT_MAX {price, ts} samples
 * @property {number} ewma               EWMA (kept for backward compat, not used for flip detection)
 */

/** @type {Map<string, PriceRecord>} */
const store = new Map();

/** Whether we're in a scan epoch (lowestBin gets rebuilt each scan). */
let scanEpoch = false;

/**
 * Update price history for a signature with a new observed price.
 * During a scan epoch, tracks the lowestBin and secondLowestBin.
 * Always updates median from recent samples.
 *
 * @param {string} signature  Normalized item signature
 * @param {number} price      Observed BIN price (coins)
 * @returns {PriceRecord|null} The updated record, or null on invalid input
 */
export function updatePrice(signature, price) {
  if (!signature || typeof signature !== 'string') return null;
  if (typeof price !== 'number' || !isFinite(price) || price <= 0) return null;

  const now = Date.now();
  let rec = store.get(signature);

  if (!rec) {
    rec = {
      lowestBin: price,
      secondLowestBin: Infinity,
      median: price,
      p5: price,
      min: price,
      max: price,
      count: 0,
      volume: 0,
      lastSeen: now,
      recent: [],
      ewma: price,
    };
    store.set(signature, rec);
  }

  rec.count += 1;
  rec.lastSeen = now;

  // Update all-time min/max
  if (price < rec.min) rec.min = price;
  if (price > rec.max) rec.max = price;

  // During a scan epoch, track lowestBin and secondLowestBin
  // These are rebuilt each scan cycle to reflect CURRENT market state
  if (scanEpoch) {
    if (price < rec.lowestBin) {
      rec.secondLowestBin = rec.lowestBin;
      rec.lowestBin = price;
    } else if (price < rec.secondLowestBin && price > rec.lowestBin) {
      rec.secondLowestBin = price;
    }
  }

  // EWMA (kept for backward compat, not primary)
  if (rec.count > 1) {
    rec.ewma = (0.3 * price) + (0.7 * rec.ewma);
  }

  // Add to recent samples with timestamp
  rec.recent.push({ price, ts: now });
  // Prune old samples
  const cutoff = now - SAMPLE_TTL_MS;
  while (rec.recent.length > 0 && rec.recent[0].ts < cutoff) {
    rec.recent.shift();
  }
  // Cap at RECENT_MAX
  if (rec.recent.length > RECENT_MAX) {
    rec.recent = rec.recent.slice(-RECENT_MAX);
  }

  // Recompute median and p5 from recent samples
  if (rec.recent.length >= 2) {
    const sorted = rec.recent.map(s => s.price).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    rec.median = sorted.length % 2 === 0
      ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
      : sorted[mid];
    const p5idx = Math.max(0, Math.floor(sorted.length * 0.05));
    rec.p5 = sorted[p5idx];

    // Estimate volume: samples in last 15 min, scaled to per-day
    const recentCount = rec.recent.length;
    const minutesSpan = SAMPLE_TTL_MS / 60000;
    rec.volume = Math.round((recentCount / minutesSpan) * 60 * 24);
  }

  return rec;
}

/**
 * Start a new scan epoch. Resets lowestBin/secondLowestBin for all
 * records so they get rebuilt during this scan cycle.
 * Call this at the beginning of each AH scan.
 */
export function startScanEpoch() {
  scanEpoch = true;
  for (const rec of store.values()) {
    rec.lowestBin = Infinity;
    rec.secondLowestBin = Infinity;
  }
}

/**
 * Finalize the scan epoch. Records that had no samples during this
 * scan keep their previous lowestBin (Infinity means "not on AH now").
 */
export function finalizeScanEpoch() {
  scanEpoch = false;
  // For records where lowestBin is still Infinity (not seen this scan),
  // keep the old values by not touching them — they'll be pruned by TTL
}

/**
 * Retrieve the current market price snapshot for a signature.
 * Returns null if the signature has never been observed.
 *
 * @param {string} signature
 * @returns {{lowestBin:number,secondLowestBin:number,median:number,p5:number,min:number,max:number,count:number,volume:number,lastSeen:number,ewma:number}|null}
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
    count: rec.count,
    volume: rec.volume,
    lastSeen: rec.lastSeen,
    ewma: rec.ewma,
  };
}

/**
 * Aggregate high-level stats for the dashboard.
 *
 * @returns {{signatures:number,totalSamples:number,oldestSignatureMs:number}}
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
 * Export a flat snapshot of every tracked signature (sorted by sample count desc).
 * Used by the dashboard to render a price-table view.
 *
 * @returns {Array<object>}
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
      count: r.count,
      volume: r.volume,
      lastSeen: r.lastSeen,
    });
  }
  out.sort((a, b) => b.count - a.count);
  return out;
}

/**
 * Remove all signatures whose lastSeen is older than maxAgeMs.
 * Returns the number of records removed.
 *
 * @param {number} maxAgeMs  Maximum age in milliseconds
 * @returns {number} Number of records pruned
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

/**
 * Internal helper: reset the entire store. Used only in tests.
 */
export function _reset() {
  store.clear();
  scanEpoch = false;
}
