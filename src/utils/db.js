/**
 * db.js — SkyBot v2 lightweight JSON database
 *
 * Uses atomic writes + in-memory cache. No external deps.
 * Persists to data/db.json — works with Railway volumes or ephemeral disk.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir   = join(__dirname, '../../data');
const dbPath    = join(dataDir, 'db.json');
const tmpPath   = join(dataDir, 'db.json.tmp');

mkdirSync(dataDir, { recursive: true });

const defaultData = {
  // ── Hypixel linking ──
  linkedPlayers:   {},          // { discordId: { ign, uuid, linkedAt } }
  premiumUsers:    [],          // [discordId, ...]
  // ── Carry system ──
  carryProviders:  {},
  // ── Discord chat leveling (per-guild) ──
  // { [guildId]: { users: { [userId]: { xp, level, totalXp } }, config: null } }
  leveling:        {},
  // ── TTS ──
  ttsChannels:     {},          // { guildId: textChannelId }
  ttsVoiceChannel: {},          // { guildId: voiceChannelId }
  ttsAIMode:       {},          // { guildId: bool }
  // ── AH Subscriptions ──
  // { discordId: { items: [skyblockId, ...], minProfit: number, channelOverride: id|null } }
  ahSubscriptions: {},
  // ── Runtime-editable config (overrides env vars) ──
  // Set via dashboard /api/config POST. Null = use env var default.
  runtimeConfig: {
    AH_FLIP_MIN_PROFIT:    null,
    AH_FLIP_MIN_MARGIN:    null,
    AH_FLIP_MAX_PAGES:     null,
    AH_FLIP_INTERVAL:      null,
    AH_FLIP_MAX_PER_CYCLE: null,
    AH_FLIP_MIN_DEMAND:    null,
    AH_FLIP_MIN_SAMPLES:   null,
    AH_FLIP_CHANNEL_ID:    null,
    PREMIUM_ROLE_ID:       null,
    AH_FLIP_ENABLED:       null,  // explicit on/off; null = on if channel set
  },
  // ── AH Flip Stats ──
  ahFlipStats: {
    totalDetected:    0,
    totalProfitCoins: 0,
    lastScanAt:       null,
    itemsTracked:     0,
    topFlips:         [],  // last 100 top flips (descending)
  },
  // ── First-run flags ──
  firstRun: {
    commandsRegistered:  false,
    welcomePosted:       false,
    commandsRegisteredAt: null,
    welcomePostedAt:     null,
  },
  // ── Guild config ──
  guildConfig:     {},
  // ── Misc ──
  ticketCount:     0,
  warnings:        {},
};

let cache = null;
let writeQueue = Promise.resolve();

function loadFromDisk() {
  if (!existsSync(dbPath)) return JSON.parse(JSON.stringify(defaultData));
  try {
    const raw = readFileSync(dbPath, 'utf8');
    const parsed = JSON.parse(raw);
    return deepMerge(JSON.parse(JSON.stringify(defaultData)), parsed);
  } catch (err) {
    console.error('[DB] Failed to read db.json, starting fresh:', err.message);
    return JSON.parse(JSON.stringify(defaultData));
  }
}

function deepMerge(target, source) {
  for (const k of Object.keys(source)) {
    if (
      source[k] && typeof source[k] === 'object' && !Array.isArray(source[k]) &&
      target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])
    ) {
      target[k] = deepMerge(target[k], source[k]);
    } else {
      target[k] = source[k];
    }
  }
  return target;
}

export function initDb() {
  cache = loadFromDisk();
  // Write back to ensure file exists with full schema
  atomicWrite(cache);
  console.log('[DB] Initialized at', dbPath);
}

export function getDb() {
  if (!cache) cache = loadFromDisk();
  return cache;
}

export function saveDb() {
  if (!cache) return Promise.resolve();
  // Serialize writes to avoid race conditions
  writeQueue = writeQueue.then(() => atomicWrite(cache)).catch(err => {
    console.error('[DB] Write failed:', err.message);
  });
  return writeQueue;
}

function atomicWrite(data) {
  return new Promise((resolve) => {
    try {
      writeFileSync(tmpPath, JSON.stringify(data, null, 2));
      renameSync(tmpPath, dbPath); // atomic on POSIX
      resolve();
    } catch (err) {
      console.error('[DB] atomicWrite failed:', err.message);
      resolve();
    }
  });
}

// Convenience helpers for AH subscriptions
// Note: getDb() returns the data object directly (not a wrapper with .data)
export function addSubscription(discordId, skyblockId) {
  const db = getDb();
  if (!db.ahSubscriptions[discordId]) {
    db.ahSubscriptions[discordId] = { items: [], minProfit: 0, channelOverride: null };
  }
  const sub = db.ahSubscriptions[discordId];
  if (!sub.items.includes(skyblockId)) {
    sub.items.push(skyblockId);
    saveDb();
    return true;
  }
  return false;
}

export function removeSubscription(discordId, skyblockId) {
  const db = getDb();
  const sub = db.ahSubscriptions[discordId];
  if (!sub) return false;
  const idx = sub.items.indexOf(skyblockId);
  if (idx >= 0) {
    sub.items.splice(idx, 1);
    saveDb();
    return true;
  }
  return false;
}

export function getSubscriptions(discordId) {
  const db = getDb();
  return db.ahSubscriptions[discordId] ?? null;
}

export function getAllSubscribers() {
  const db = getDb();
  return db.ahSubscriptions;
}
