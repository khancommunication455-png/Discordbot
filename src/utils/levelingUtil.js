/**
 * levelingUtil.js — Discord guild chat XP / leveling system
 *
 * Adapted for SkyBot v2 flat db (db.leveling instead of db.data.leveling).
 * NOTE: This is the *Discord* leveling system (chat XP), separate from the
 * Hypixel SkyBlock skill/dungeon leveling tables in leveling.js.
 */
import { getDb, saveDb } from './db.js';

const XP_MIN = 15;
const XP_MAX = 40;
const XP_COOLDOWN = 60_000; // 1 min between XP gains

const lastXpGain = new Map(); // userId_guildId → timestamp

export function getXpForLevel(level) {
  return Math.floor(100 * Math.pow(1.35, level));
}

function ensureGuild(db, guildId) {
  if (!db.leveling) db.leveling = {};
  if (!db.leveling[guildId]) db.leveling[guildId] = { users: {}, config: null };
  if (!db.leveling[guildId].users) db.leveling[guildId].users = {};
  return db.leveling[guildId];
}

export function getLevelData(guildId, userId) {
  const db = getDb();
  const guild = ensureGuild(db, guildId);
  if (!guild.users[userId]) {
    guild.users[userId] = { xp: 0, level: 0, totalXp: 0 };
  }
  return guild.users[userId];
}

export async function addXp(guildId, userId, client) {
  const key = `${userId}_${guildId}`;
  const now = Date.now();
  if (lastXpGain.has(key) && now - lastXpGain.get(key) < XP_COOLDOWN) return null;
  lastXpGain.set(key, now);

  const db   = getDb();
  const data = getLevelData(guildId, userId);
  const gain = Math.floor(Math.random() * (XP_MAX - XP_MIN + 1)) + XP_MIN;

  data.xp      += gain;
  data.totalXp += gain;

  const needed = getXpForLevel(data.level + 1);
  let leveledUp = false;

  if (data.xp >= needed) {
    data.xp -= needed;
    data.level++;
    leveledUp = true;
  }

  db.leveling[guildId].users[userId] = data;
  await saveDb();
  return { gain, leveledUp, level: data.level };
}

export function getLeaderboard(guildId) {
  const db = getDb();
  const users = db.leveling?.[guildId]?.users ?? {};
  return Object.entries(users)
    .map(([id, d]) => ({ id, ...d }))
    .sort((a, b) => b.totalXp - a.totalXp);
}

export function getLevelingConfig(guildId) {
  const db = getDb();
  return db.leveling?.[guildId]?.config ?? null;
}

export async function setLevelingConfig(guildId, config) {
  const db = getDb();
  const guild = ensureGuild(db, guildId);
  guild.config = config;
  await saveDb();
}
