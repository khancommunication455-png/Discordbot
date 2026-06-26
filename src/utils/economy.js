import { getDb, saveDb } from './db.js';

export function getEconomy(guildId, userId) {
  const db = getDb();
  if (!db.data.economy[guildId]) db.data.economy[guildId] = {};
  if (!db.data.economy[guildId][userId]) {
    db.data.economy[guildId][userId] = {
      wallet: 0, bank: 0,
      lastDaily: 0, lastWork: 0, lastCrime: 0, lastRob: 0,
      inventory: [], totalEarned: 0,
    };
  }
  return db.data.economy[guildId][userId];
}

export async function saveEconomy(guildId, userId, data) {
  const db = getDb();
  if (!db.data.economy[guildId]) db.data.economy[guildId] = {};
  db.data.economy[guildId][userId] = data;
  await saveDb();
}

export function formatMoney(n) {
  return `$${(n ?? 0).toLocaleString()}`;
}

export function parseDuration(str) {
  const units = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };
  const match = str.match(/^(\d+)([smhdw])$/i);
  if (!match) return null;
  return parseInt(match[1]) * (units[match[2].toLowerCase()] ?? 0);
}

export function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
