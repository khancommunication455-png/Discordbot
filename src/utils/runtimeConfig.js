/**
 * runtimeConfig.js — Runtime-editable configuration
 *
 * All flip-tracker settings can be overridden at runtime via the dashboard
 * (POST /api/config). Values are stored in db.runtimeConfig and take
 * precedence over environment variables.
 *
 * Resolution order for each key:
 *   1. db.runtimeConfig[key]  (if not null — set via dashboard)
 *   2. process.env[key]       (Railway env var)
 *   3. hardcoded default
 */
import { getDb, saveDb } from './db.js';

// ── Default values (used when neither DB nor env has a value) ──
export const DEFAULTS = {
  AH_FLIP_MIN_PROFIT:    500_000,
  AH_FLIP_MIN_MARGIN:    10,
  AH_FLIP_MAX_PAGES:     10,
  AH_FLIP_INTERVAL:      30,
  AH_FLIP_MAX_PER_CYCLE: 5,
  AH_FLIP_MIN_DEMAND:    0,
  AH_FLIP_MIN_SAMPLES:   5,
  AH_FLIP_CHANNEL_ID:    null,
  PREMIUM_ROLE_ID:       null,
  AH_FLIP_ENABLED:       null,
};

// ── Numeric keys (parsed as Number) ──
const NUMERIC_KEYS = new Set([
  'AH_FLIP_MIN_PROFIT',
  'AH_FLIP_MIN_MARGIN',
  'AH_FLIP_MAX_PAGES',
  'AH_FLIP_INTERVAL',
  'AH_FLIP_MAX_PER_CYCLE',
  'AH_FLIP_MIN_DEMAND',
  'AH_FLIP_MIN_SAMPLES',
]);

/**
 * Get a single config value (DB override → env → default).
 * @param {string} key
 * @returns {string|number|boolean|null}
 */
export function getConfig(key) {
  const db = getDb();
  const dbVal = db.runtimeConfig?.[key];
  if (dbVal !== null && dbVal !== undefined && dbVal !== '') {
    return NUMERIC_KEYS.has(key) ? Number(dbVal) : dbVal;
  }
  const envVal = process.env[key];
  if (envVal !== undefined && envVal !== '') {
    return NUMERIC_KEYS.has(key) ? Number(envVal) : envVal;
  }
  return DEFAULTS[key] ?? null;
}

/**
 * Get all config values as a flat object.
 * @returns {Record<string, string|number|boolean|null>}
 */
export function getAllConfig() {
  const out = {};
  for (const key of Object.keys(DEFAULTS)) {
    out[key] = getConfig(key);
  }
  return out;
}

/**
 * Get the source of a config value ('db' | 'env' | 'default').
 * Useful for the dashboard to show where a value comes from.
 */
export function getConfigSource(key) {
  const db = getDb();
  const dbVal = db.runtimeConfig?.[key];
  if (dbVal !== null && dbVal !== undefined && dbVal !== '') return 'db';
  if (process.env[key]) return 'env';
  return 'default';
}

/**
 * Set a config override in the DB. Pass null to clear (revert to env/default).
 * @param {string} key
 * @param {string|number|boolean|null} value
 */
export async function setConfig(key, value) {
  if (!(key in DEFAULTS)) {
    throw new Error(`Unknown config key: ${key}`);
  }
  const db = getDb();
  if (!db.runtimeConfig) db.runtimeConfig = {};
  // Validate numeric keys
  if (NUMERIC_KEYS.has(key) && value !== null && value !== '') {
    const n = Number(value);
    if (isNaN(n)) throw new Error(`${key} must be a number, got: ${value}`);
    // Apply bounds
    if (key === 'AH_FLIP_INTERVAL' && n < 20) throw new Error('Interval must be >= 20s (Hypixel rate limit)');
    if (key === 'AH_FLIP_MAX_PAGES' && (n < 1 || n > 10)) throw new Error('Max pages must be 1-10');
    if (key === 'AH_FLIP_MAX_PER_CYCLE' && (n < 1 || n > 20)) throw new Error('Max per cycle must be 1-20');
    if (key === 'AH_FLIP_MIN_MARGIN' && (n < 0 || n > 95)) throw new Error('Margin must be 0-95%');
    if (key === 'AH_FLIP_MIN_DEMAND' && (n < 0 || n > 100)) throw new Error('Demand must be 0-100');
    db.runtimeConfig[key] = n;
  } else {
    db.runtimeConfig[key] = value ?? null;
  }
  await saveDb();
  return getConfig(key);
}

/**
 * Bulk update multiple config keys at once.
 * @param {Record<string, string|number|boolean|null>} updates
 */
export async function updateConfig(updates) {
  const results = {};
  for (const [key, value] of Object.entries(updates)) {
    results[key] = await setConfig(key, value);
  }
  return results;
}

/**
 * Check whether the flip watcher should be enabled.
 * Enabled if: AH_FLIP_ENABLED is true, OR (null AND channel ID is set).
 */
export function isFlipWatcherEnabled() {
  const enabled = getConfig('AH_FLIP_ENABLED');
  if (enabled === true) return true;
  if (enabled === false) return false;
  // null — auto-enable if channel is set OR running in stats-only mode
  return true;
}

/**
 * Check whether flips should be posted to Discord (vs stats-only mode).
 */
export function shouldPostFlipsToDiscord() {
  const channelId = getConfig('AH_FLIP_CHANNEL_ID');
  return !!channelId;
}
