/**
 * embeds.js — SkyBot Professional Embed System
 *
 * Design language: Dark luxury gaming aesthetic
 * Primary: #5865F2 (Discord blurple) → trust, tech
 * Accent:  #00D4AA (teal-green) → SkyBlock coins/success
 * Gold:    #F0A500 → premium, auction house
 * Danger:  #FF4757 → errors, bans
 * Subtle:  #2F3136 → backgrounds (Discord dark)
 *
 * Rules:
 * - Every embed has a footer with bot name + timestamp
 * - Category color is consistent (economy=gold, hypixel=teal, mod=red, etc.)
 * - No bare emoji prefixes on titles — use clean text or a single icon
 * - Fields are always 3-per-row or single full-width, never 2
 * - Descriptions are concise, max 2 sentences
 */

import { EmbedBuilder } from 'discord.js';

// ── Brand Colors ──────────────────────────────────────────────────────────
export const C = {
  // Status
  success:  0x00D4AA,   // teal-green
  error:    0xFF4757,   // vivid red
  warning:  0xF0A500,   // amber
  info:     0x5865F2,   // blurple
  // Categories
  hypixel:  0x00D4AA,   // SkyBlock teal
  auction:  0xF0A500,   // AH gold
  economy:  0xFFD700,   // coin gold
  music:    0x1DB954,   // Spotify green (universal music color)
  mod:      0xFF4757,   // red
  fun:      0xFF6B9D,   // pink
  leveling: 0x9B59B6,   // purple
  carry:    0x00B4D8,   // sky blue
  premium:  0xF0A500,   // gold
  tts:      0x5865F2,   // blurple
  tool:     0x747F8D,   // grey
  // Neutrals
  white:    0xFFFFFF,
  dark:     0x2F3136,
};

// ── Footer ────────────────────────────────────────────────────────────────
const FOOTER = { text: 'TITAN Jr. • Hypixel Skyblock Bot' };
const FOOTER_PREMIUM = { text: 'TITAN Jr. Premium • Hypixel Skyblock Bot' };

function base(color) {
  return new EmbedBuilder().setColor(color).setFooter(FOOTER).setTimestamp();
}

// ── Status Embeds ─────────────────────────────────────────────────────────

export function successEmbed(title, desc) {
  return base(C.success)
    .setTitle(`${title}`)
    .setDescription(desc ? `✦ ${desc}` : null);
}

export function errorEmbed(title, desc) {
  return base(C.error)
    .setTitle(`${title}`)
    .setDescription(desc ? `${desc}` : null);
}

export function infoEmbed(title, desc) {
  return base(C.info)
    .setTitle(`${title}`)
    .setDescription(desc ? `${desc}` : null);
}

export function warningEmbed(title, desc) {
  return base(C.warning)
    .setTitle(`${title}`)
    .setDescription(desc ? `${desc}` : null);
}

// ── Category Embeds ───────────────────────────────────────────────────────

export function skyEmbed(title, desc) {
  return base(C.hypixel).setTitle(title).setDescription(desc ?? null);
}

export function goldEmbed(title, desc) {
  return base(C.auction).setTitle(title).setDescription(desc ?? null);
}

export function premiumEmbed(title, desc) {
  return new EmbedBuilder()
    .setColor(C.premium)
    .setTitle(title)
    .setDescription(desc ?? null)
    .setFooter(FOOTER_PREMIUM)
    .setTimestamp();
}

// ── Loading Embed ─────────────────────────────────────────────────────────
export function loadingEmbed(action) {
  return base(C.info)
    .setTitle(`${action}`)
    .setDescription('Please wait...');
}

// ── Number Formatting ─────────────────────────────────────────────────────
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

// ── Divider Line ──────────────────────────────────────────────────────────
// Use in descriptions between sections
export const DIVIDER = '\n─────────────────────\n';

// ── Status Dot ────────────────────────────────────────────────────────────
export const DOT = {
  green:  '🟢',
  red:    '🔴',
  yellow: '🟡',
  blue:   '🔵',
  white:  '⚪',
};
