/**
 * priceHistory.js — SkyBot v2 Price Database (historical vs current)
 *
 * CRITICAL: Separates HISTORICAL data from CURRENT scan data.
 * - currentPrices[] — prices from the CURRENT scan (reset each scan)
 * - historicalPrices[] — prices from PREVIOUS scans (accumulated, 30-min TTL)
 *
 * Market price for flip detection = HISTORICAL median (past scans only)
 * Current lowest BIN = cheapest listing in the CURRENT scan
 */
const HISTORICAL_MAX = 100;
const HISTORICAL_TTL_MS = 30 * 60 * 1000;
const store = new Map();
let scanEpoch = false;

export function startScanEpoch() {
  scanEpoch = true;
  for (const rec of store.values()) { rec.currentPrices = []; rec.lowestBin = Infinity; rec.secondLowestBin = Infinity; }
}

export function updatePrice(signature, price) {
  if (!signature || typeof price !== 'number' || !isFinite(price) || price <= 0) return null;
  const now = Date.now();
  let rec = store.get(signature);
  if (!rec) { rec = { currentPrices: [], historicalPrices: [], lowestBin: Infinity, secondLowestBin: Infinity, median: 0, p5: 0, min: price, max: price, count: 0, volume: 0, lastSeen: now, ewma: price }; store.set(signature, rec); }
  rec.count += 1; rec.lastSeen = now;
  if (price < rec.min) rec.min = price;
  if (price > rec.max) rec.max = price;
  if (rec.count > 1) rec.ewma = (0.3 * price) + (0.7 * rec.ewma);
  if (scanEpoch) {
    rec.currentPrices.push(price);
    if (price < rec.lowestBin) { rec.secondLowestBin = rec.lowestBin; rec.lowestBin = price; }
    else if (price < rec.secondLowestBin && price > rec.lowestBin) { rec.secondLowestBin = price; }
  }
  return rec;
}

export function finalizeScanEpoch() {
  scanEpoch = false;
  for (const rec of store.values()) {
    if (rec.currentPrices.length > 0) rec.historicalPrices.push(...rec.currentPrices);
    if (rec.historicalPrices.length > HISTORICAL_MAX) rec.historicalPrices = rec.historicalPrices.slice(-HISTORICAL_MAX);
    if (rec.historicalPrices.length >= 2) {
      const sorted = [...rec.historicalPrices].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      rec.median = sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
      rec.p5 = sorted[Math.max(0, Math.floor(sorted.length * 0.05))];
      rec.volume = Math.round((rec.historicalPrices.length / 30) * 1440);
    }
  }
}

export function getMarketPrice(signature) {
  const rec = store.get(signature);
  if (!rec) return null;
  return { lowestBin: rec.lowestBin === Infinity ? 0 : rec.lowestBin, secondLowestBin: rec.secondLowestBin === Infinity ? 0 : rec.secondLowestBin, median: rec.median, p5: rec.p5, min: rec.min, max: rec.max, count: rec.historicalPrices.length, volume: rec.volume, lastSeen: rec.lastSeen, ewma: rec.ewma };
}

export function getStats() {
  let totalSamples = 0, oldestSeen = Date.now(), hasAny = false;
  for (const r of store.values()) { totalSamples += r.count; if (r.lastSeen < oldestSeen) { oldestSeen = r.lastSeen; hasAny = true; } }
  return { signatures: store.size, totalSamples, oldestSignatureMs: hasAny ? (Date.now() - oldestSeen) : 0 };
}

export function exportSnapshot() {
  const out = [];
  for (const [sig, r] of store.entries()) out.push({ signature: sig, lowestBin: r.lowestBin === Infinity ? 0 : r.lowestBin, secondLowestBin: r.secondLowestBin === Infinity ? 0 : r.secondLowestBin, median: r.median, p5: r.p5, min: r.min, max: r.max, count: r.historicalPrices.length, volume: r.volume, lastSeen: r.lastSeen });
  out.sort((a, b) => b.count - a.count);
  return out;
}

export function prune(maxAgeMs) {
  if (typeof maxAgeMs !== 'number' || maxAgeMs <= 0) return 0;
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  for (const sig of [...store.keys()]) { const r = store.get(sig); if (r && r.lastSeen < cutoff) { store.delete(sig); removed++; } }
  return removed;
}

export function _reset() { store.clear(); scanEpoch = false; }
