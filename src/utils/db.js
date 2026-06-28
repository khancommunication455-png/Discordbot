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
  // carryConfig: per-guild admin-configured carry system
  // {
  //   [guildId]: {
  //     categories: {
  //       'dungeons':  { channelId: '...', emoji: '🏰', label: 'Dungeon Carry Service', enabled: true,
  //                     items: [{ id:'f4', label:'Floor 4', emoji:'🏰', tier:'4', price:'4M' }, ...] },
  //       'master':    { channelId: '...', emoji: '⭐', label: 'Master Mode Carry', enabled: true, items: [...] },
  //       'slayers':   { channelId: '...', emoji: '👹', label: 'Slayer Carry Service', enabled: true, items: [...] },
  //       'kuudra':    { channelId: '...', emoji: '🐉', label: 'Kuudra Carry Service', enabled: true, items: [...] },
  //       'crimson':   { channelId: '...', emoji: '🔥', label: 'Crimson Carry Service', enabled: true, items: [...] },
  //     },
  //     panelMessageIds: { 'dungeons': 'msgId', ... },  // posted panel message IDs (for editing)
  //     requestChannelId: '...',  // where request tickets get posted (optional)
  //   }
  // }
  carryConfig:     {},
  carryTickets:    {},          // { [threadId]: { itemId, requesterId, providerId, createdAt, channelId, guildId } }
  // ── Welcome / Goodbye / Auto-Role (per-guild) ──
  // welcomeConfig: { [guildId]: { channel, message, ping, image, enabled } }
  // goodbyeConfig: { [guildId]: { channel, message, enabled } }
  // autoRole:      { [guildId]: [roleId, ...] }
  welcomeConfig:   {},
  goodbyeConfig:   {},
  autoRole:        {},
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
  // ── Economy (per-guild, per-user) ──
  // { [guildId]: { [userId]: { wallet, bank, lastDaily, lastWork, lastCrime, lastRob, inventory, totalEarned } } }
  economy:         {},
  // ── Giveaways (per-guild, per-message) ──
  // { [guildId]: { [msgId]: { prize, endsAt, winners, channelId, ended, participants, hostId, endedWinners } } }
  giveaways:       {},
  // ── Birthdays (per-guild, per-user) ──
  // { [guildId]: { [userId]: { day, month } } }
  birthdays:       {},
  // ── Misc ──
  ticketCount:     0,
  warnings:        {},
  // ── User notes (private moderator notes, per-guild per-user) ──
  // { [guildId]: { [userId]: [{ note, mod, ts }] } }
  userNotes:       {},
  // ── Reaction roles (per-guild per-message per-emoji → roleId) ──
  // { [guildId]: { [msgId]: { [emojiStr]: roleId } } }
  reactionRoles:   {},
  // ── Per-guild logging config (mod log channel + flags) ──
  // { [guildId]: { channel: id, enabled: bool } }
  loggingConfig:   {},
  // ── Per-guild birthday announcement channel ──
  // { [guildId]: channelId }
  birthdayChannel: {},
  // ── Per-guild music settings (volume + loop preference) ──
  // { [guildId]: { volume: 0-100, loop: bool } }
  musicSettings:   {},
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
