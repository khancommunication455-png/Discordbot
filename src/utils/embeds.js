/**
 * embeds.js — SkyBot v2 Professional Embed System
 */
import { EmbedBuilder } from 'discord.js';

export const C = {
  success:  0x00D4AA,
  error:    0xFF4757,
  warning:  0xF0A500,
  info:     0x5865F2,
  hypixel:  0x00D4AA,
  auction:  0xF0A500,
  economy:  0xFFD700,
  music:    0x1DB954,
  mod:      0xFF4757,
  fun:      0xFF6B9D,
  leveling: 0x9B59B6,
  carry:    0x00B4D8,
  premium:  0xF0A500,
  tts:      0x5865F2,
  flip:     0xFFD700,
  tool:     0x747F8D,
  white:    0xFFFFFF,
  dark:     0x2F3136,
  ai:       0x9B59B6,
};

const FOOTER = { text: 'SkyBot v2 • Railway Edition' };
const FOOTER_PREMIUM = { text: 'SkyBot v2 Premium • Railway Edition' };

function base(color) {
  return new EmbedBuilder().setColor(color).setFooter(FOOTER).setTimestamp();
}

export function successEmbed(title, desc) {
  return base(C.success).setTitle(title).setDescription(desc ?? null);
}
export function errorEmbed(title, desc) {
  return base(C.error).setTitle(title).setDescription(desc ?? null);
}
export function infoEmbed(title, desc) {
  return base(C.info).setTitle(title).setDescription(desc ?? null);
}
export function warningEmbed(title, desc) {
  return base(C.warning).setTitle(title).setDescription(desc ?? null);
}
export function skyEmbed(title, desc) {
  return base(C.hypixel).setTitle(title).setDescription(desc ?? null);
}
export function goldEmbed(title, desc) {
  return base(C.auction).setTitle(title).setDescription(desc ?? null);
}
export function premiumEmbed(title, desc) {
  return new EmbedBuilder().setColor(C.premium).setTitle(title).setDescription(desc ?? null).setFooter(FOOTER_PREMIUM).setTimestamp();
}
export function loadingEmbed(action) {
  return base(C.info).setTitle(action).setDescription('Please wait...');
}

export function formatCoins(n) {
  if (!n || isNaN(n)) return '0';
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)         return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export function formatNumber(n) {
  if (!n || isNaN(n)) return '0';
  return n.toLocaleString();
}

export function formatCoinsFull(n) {
  if (!n || isNaN(n)) return '0';
  return n.toLocaleString();
}

export const DIVIDER = '\n─────────────────────\n';

export const DOT = {
  green:  '🟢',
  red:    '🔴',
  yellow: '🟡',
  blue:   '🔵',
  white:  '⚪',
};
