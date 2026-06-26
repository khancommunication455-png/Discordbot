import { getDb, saveDb } from './db.js';

const XP_MIN = 15;
const XP_MAX = 40;
const XP_COOLDOWN = 60_000; // 1 min between XP gains

const lastXpGain = new Map(); // userId_guildId → timestamp

export function getXpForLevel(level) {
  return Math.floor(100 * Math.pow(1.35, level));
}

export function getLevelData(guildId, userId) {
  const db = getDb();
  if (!db.data.leveling[guildId]) db.data.leveling[guildId] = { users: {}, config: null };
  if (!db.data.leveling[guildId].users[userId]) {
    db.data.leveling[guildId].users[userId] = { xp: 0, level: 0, totalXp: 0 };
  }
  return db.data.leveling[guildId].users[userId];
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

  db.data.leveling[guildId].users[userId] = data;
  await saveDb();
  return { gain, leveledUp, level: data.level };
}

export function getLeaderboard(guildId) {
  const db = getDb();
  const users = db.data.leveling[guildId]?.users ?? {};
  return Object.entries(users)
    .map(([id, d]) => ({ id, ...d }))
    .sort((a, b) => b.totalXp - a.totalXp);
}

export function getLevelingConfig(guildId) {
  const db = getDb();
  return db.data.leveling[guildId]?.config ?? null;
}

export async function setLevelingConfig(guildId, config) {
  const db = getDb();
  if (!db.data.leveling[guildId]) db.data.leveling[guildId] = { users: {} };
  db.data.leveling[guildId].config = config;
  await saveDb();
}
