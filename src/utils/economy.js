/**
 * economy.js — SkyBot v2 Economy utility functions
 *
 * Ported from SkyBot v1 (Discordbot-main/src/utils/economy.js).
 * Adapted for v2 flat db (db.economy instead of db.data.economy).
 *
 * Provides:
 *   - getEconomy(guildId, userId)  → user economy record (auto-creates)
 *   - saveEconomy(guildId, userId, data) → persists user record (async)
 *   - getBalance(guildId, userId)  → { wallet, bank, total }
 *   - addCoins(guildId, userId, amount, where='wallet')
 *   - removeCoins(guildId, userId, amount, where='wallet')
 *   - transfer(guildId, fromId, toId, amount) → boolean
 *   - formatMoney(n)              → "$1,234"
 *   - parseDuration(str)          → ms  (e.g. "1h" → 3_600_000)
 *   - formatDuration(ms)          → "1h 5m"
 */
import { getDb, saveDb } from './db.js';

export function getEconomy(guildId, userId) {
  const db = getDb();
  if (!db.economy) db.economy = {};
  if (!db.economy[guildId]) db.economy[guildId] = {};
  if (!db.economy[guildId][userId]) {
    db.economy[guildId][userId] = {
      wallet: 0, bank: 0,
      lastDaily: 0, lastWork: 0, lastCrime: 0, lastRob: 0,
      inventory: [], totalEarned: 0,
    };
  }
  return db.economy[guildId][userId];
}

export async function saveEconomy(guildId, userId, data) {
  const db = getDb();
  if (!db.economy) db.economy = {};
  if (!db.economy[guildId]) db.economy[guildId] = {};
  db.economy[guildId][userId] = data;
  await saveDb();
}

export function getBalance(guildId, userId) {
  const d = getEconomy(guildId, userId);
  return {
    wallet: d.wallet ?? 0,
    bank:   d.bank   ?? 0,
    total:  (d.wallet ?? 0) + (d.bank ?? 0),
  };
}

export async function addCoins(guildId, userId, amount, where = 'wallet') {
  const d = getEconomy(guildId, userId);
  const amt = Math.max(0, Math.floor(amount));
  if (where === 'bank') d.bank   = (d.bank   ?? 0) + amt;
  else                  d.wallet = (d.wallet ?? 0) + amt;
  d.totalEarned = (d.totalEarned ?? 0) + amt;
  await saveEconomy(guildId, userId, d);
  return d;
}

export async function removeCoins(guildId, userId, amount, where = 'wallet') {
  const d = getEconomy(guildId, userId);
  const amt = Math.max(0, Math.floor(amount));
  if (where === 'bank') d.bank   = Math.max(0, (d.bank   ?? 0) - amt);
  else                  d.wallet = Math.max(0, (d.wallet ?? 0) - amt);
  await saveEconomy(guildId, userId, d);
  return d;
}

export async function transfer(guildId, fromId, toId, amount) {
  const amt = Math.max(0, Math.floor(amount));
  const from = getEconomy(guildId, fromId);
  const to   = getEconomy(guildId, toId);
  if ((from.wallet ?? 0) < amt) return false;
  from.wallet = (from.wallet ?? 0) - amt;
  to.wallet   = (to.wallet   ?? 0) + amt;
  await saveEconomy(guildId, fromId, from);
  await saveEconomy(guildId, toId,   to);
  return true;
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
