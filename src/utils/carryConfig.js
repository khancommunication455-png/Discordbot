/**
 * carryConfig.js — SkyBot v2 carry category & item configuration helper
 *
 * Implements the per-category channel design (matching the Skyblock Maniacs
 * screenshots the user provided): each carry category (dungeons, master,
 * slayers, kuudra, crimson) lives in its OWN Discord channel with its OWN
 * rich embed panel and a row of tier buttons.
 *
 * Storage (flat v2 db):
 *   db.carryConfig[guildId] = {
 *     categories: {
 *       [categoryId]: {
 *         channelId:        '123...',   // Discord channel for this category
 *         enabled:          true,       // category-level enable/disable
 *         panelMessageId:   '456...',   // last posted panel message id (for editing)
 *         priceOverrides:   { [itemId]: '35M' },
 *         disabledItems:    { [itemId]: true },
 *       },
 *       ...
 *     },
 *     requestChannelId:     null,       // optional: where request tickets go if not a thread
 *   }
 *
 * Providers are stored separately in db.carryProviders (unchanged):
 *   db.carryProviders = { [userId]: [itemId, ...] }
 */
import { getDb, saveDb } from '../utils/db.js';

// ── Default category definitions (matching the screenshots) ────────────────
export const CARRY_CATEGORIES = {
  dungeons: {
    id: 'dungeons',
    label: 'Dungeon Carry Service',
    emoji: '🏰',
    description: 'Dungeon floor carries',
    items: [
      { id: 'f4', label: 'Floor 4',  emoji: '🏰', tier: '4', price: '4M',  bossName: null },
      { id: 'f5', label: 'Floor 5',  emoji: '🗡️', tier: '5', price: '8M',  bossName: null },
      { id: 'f6', label: 'Floor 6',  emoji: '🔥', tier: '6', price: '15M', bossName: null },
      { id: 'f7', label: 'Floor 7',  emoji: '💀', tier: '7', price: '30M', bossName: null },
    ],
  },
  master: {
    id: 'master',
    label: 'Master Mode Carry Service',
    emoji: '⭐',
    description: 'Master Mode dungeon carries',
    items: [
      { id: 'm2', label: 'Master 2', emoji: '🌟', tier: '2', price: '25M', bossName: null },
      { id: 'm3', label: 'Master 3', emoji: '⭐', tier: '3', price: '40M', bossName: null },
      { id: 'm4', label: 'Master 4', emoji: '⭐', tier: '4', price: '60M', bossName: null },
      { id: 'm5', label: 'Master 5', emoji: '👑', tier: '5', price: '80M', bossName: null },
      { id: 'm6', label: 'Master 6', emoji: '👑', tier: '6', price: '120M', bossName: null },
      { id: 'm7', label: 'Master 7', emoji: '💎', tier: '7', price: '200M', bossName: null },
    ],
  },
  slayers: {
    id: 'slayers',
    label: 'Slayer Carry Service',
    emoji: '👹',
    description: 'Slayer boss carries',
    items: [
      // Revenant Horror
      { id: 'rev_t3', label: 'Revenant Horror', emoji: '👾', tier: '3', price: '3M',  bossName: 'Revenant Horror' },
      { id: 'rev_t4', label: 'Revenant Horror', emoji: '👾', tier: '4', price: '5M',  bossName: 'Revenant Horror' },
      { id: 'rev_t5', label: 'Revenant Horror', emoji: '👾', tier: '5', price: '8M',  bossName: 'Revenant Horror' },
      // Tarantula
      { id: 'tar_t3', label: 'Tarantula', emoji: '🕷️', tier: '3', price: '3M',  bossName: 'Tarantula' },
      { id: 'tar_t4', label: 'Tarantula', emoji: '🕷️', tier: '4', price: '5M',  bossName: 'Tarantula' },
      { id: 'tar_t5', label: 'Tarantula', emoji: '🕷️', tier: '5', price: '8M',  bossName: 'Tarantula' },
      // Sven
      { id: 'sven_t3', label: 'Sven', emoji: '🐺', tier: '3', price: '3M',  bossName: 'Sven' },
      { id: 'sven_t4', label: 'Sven', emoji: '🐺', tier: '4', price: '5M',  bossName: 'Sven' },
      { id: 'sven_t5', label: 'Sven', emoji: '🐺', tier: '5', price: '8M',  bossName: 'Sven' },
      // Enderman (Voidgloom)
      { id: 'eman_t3', label: 'Voidgloom Seraph', emoji: '👻', tier: '3', price: '5M',  bossName: 'Voidgloom Seraph' },
      { id: 'eman_t4', label: 'Voidgloom Seraph', emoji: '👻', tier: '4', price: '8M',  bossName: 'Voidgloom Seraph' },
      // Inferno Demonlord (Blaze)
      { id: 'blaze_t2', label: 'Inferno Demonlord', emoji: '👹', tier: '2', price: '5M',  bossName: 'Inferno Demonlord' },
      { id: 'blaze_t3', label: 'Inferno Demonlord', emoji: '👹', tier: '3', price: '10M', bossName: 'Inferno Demonlord' },
      { id: 'blaze_t4', label: 'Inferno Demonlord', emoji: '👹', tier: '4', price: '15M', bossName: 'Inferno Demonlord' },
    ],
  },
  kuudra: {
    id: 'kuudra',
    label: 'Kuudra Carry Service',
    emoji: '🐉',
    description: 'Kuudra carries',
    items: [
      { id: 'kb',  label: 'Kuudra Basic',    emoji: '🟫', tier: 'Basic',    price: '3M',  bossName: null },
      { id: 'kh',  label: 'Kuudra Hot',      emoji: '🔥', tier: 'Hot',      price: '6M',  bossName: null },
      { id: 'kbu', label: 'Kuudra Burning',  emoji: '🔥', tier: 'Burning',  price: '12M', bossName: null },
      { id: 'kf',  label: 'Kuudra Fiery',    emoji: '🔥', tier: 'Fiery',    price: '20M', bossName: null },
      { id: 'ki',  label: 'Kuudra Infernal', emoji: '🔥', tier: 'Infernal', price: '30M', bossName: null },
    ],
  },
  crimson: {
    id: 'crimson',
    label: 'Crimson Carry Service',
    emoji: '🔥',
    description: 'Crimson Isle carries',
    items: [
      { id: 'ashfang',  label: 'Ashfang Carry',    emoji: '🗡️', tier: null, price: '5M',  bossName: 'Ashfang' },
      { id: 'magma',    label: 'Magma Boss Carry', emoji: '🔥', tier: null, price: '8M',  bossName: 'Magma Boss' },
      { id: 'miniboss', label: 'Miniboss Carry',   emoji: '🗡️', tier: null, price: '3M',  bossName: 'Miniboss' },
    ],
  },
};

// ── Internal: ensure guild config exists & has full schema ─────────────────
export function ensureGuildConfig(guildId) {
  const db = getDb();
  if (!db.carryConfig) db.carryConfig = {};
  if (!db.carryConfig[guildId]) {
    db.carryConfig[guildId] = { categories: {}, requestChannelId: null };
  }
  const gc = db.carryConfig[guildId];
  if (!gc.categories) gc.categories = {};
  if (gc.requestChannelId === undefined) gc.requestChannelId = null;

  // Ensure each default category has an override object with all fields
  for (const catId of Object.keys(CARRY_CATEGORIES)) {
    if (!gc.categories[catId]) {
      gc.categories[catId] = {
        channelId:      null,
        enabled:        true,
        panelMessageId: null,
        priceOverrides: {},
        disabledItems:  {},
      };
    } else {
      const c = gc.categories[catId];
      if (c.channelId      === undefined) c.channelId      = null;
      if (c.enabled        === undefined) c.enabled        = true;
      if (c.panelMessageId === undefined) c.panelMessageId = null;
      if (!c.priceOverrides)              c.priceOverrides = {};
      if (!c.disabledItems)               c.disabledItems  = {};
    }
  }
  return gc;
}

// ── Read helpers ───────────────────────────────────────────────────────────

/**
 * Returns a merged category (defaults + guild overrides for channelId, prices,
 * enabled, disabledItems). Returns null if the categoryId is unknown.
 */
export function getCategory(guildId, categoryId) {
  const def = CARRY_CATEGORIES[categoryId];
  if (!def) return null;
  ensureGuildConfig(guildId);
  const db = getDb();
  const oc = db.carryConfig[guildId].categories[categoryId];

  const items = def.items.map(it => ({
    ...it,
    price:   oc.priceOverrides[it.id] ?? it.price,
    enabled: oc.disabledItems[it.id] ? false : true,
  }));

  return {
    id:             def.id,
    label:          def.label,
    emoji:          def.emoji,
    description:    def.description,
    channelId:      oc.channelId,
    enabled:        oc.enabled,
    panelMessageId: oc.panelMessageId,
    items,
  };
}

/** Returns all 5 categories with guild overrides applied. */
export function getAllCategories(guildId) {
  return Object.fromEntries(
    Object.keys(CARRY_CATEGORIES).map(id => [id, getCategory(guildId, id)]),
  );
}

/** Returns the default category definition that an item belongs to. */
export function getCategoryByItemId(itemId) {
  for (const def of Object.values(CARRY_CATEGORIES)) {
    if (def.items.some(it => it.id === itemId)) return def;
  }
  return null;
}

/** Returns the merged item (default + guild price/enabled override). */
export function getItem(guildId, itemId) {
  const def = getCategoryByItemId(itemId);
  if (!def) return null;
  const cat = getCategory(guildId, def.id);
  return cat.items.find(it => it.id === itemId) ?? null;
}

/** Flat list of all merged items (used by autocomplete + providers list). */
export function getAllItems(guildId) {
  const all = getAllCategories(guildId);
  return Object.values(all).flatMap(cat => cat.items);
}

// ── Write helpers ──────────────────────────────────────────────────────────

/** Sets the Discord channel for a category. Returns true on success. */
export function setCategoryChannel(guildId, categoryId, channelId) {
  if (!CARRY_CATEGORIES[categoryId]) return false;
  ensureGuildConfig(guildId);
  const db = getDb();
  db.carryConfig[guildId].categories[categoryId].channelId = channelId;
  saveDb();
  return true;
}

/** Enables/disables an entire category. */
export function setCategoryEnabled(guildId, categoryId, enabled) {
  if (!CARRY_CATEGORIES[categoryId]) return false;
  ensureGuildConfig(guildId);
  const db = getDb();
  db.carryConfig[guildId].categories[categoryId].enabled = !!enabled;
  saveDb();
  return true;
}

/** Overrides a carry item's price. Returns true if item exists. */
export function setItemPrice(guildId, itemId, price) {
  const def = getCategoryByItemId(itemId);
  if (!def) return false;
  ensureGuildConfig(guildId);
  const db = getDb();
  db.carryConfig[guildId].categories[def.id].priceOverrides[itemId] = price;
  saveDb();
  return true;
}

/** Enable/disable a specific item. */
export function setItemEnabled(guildId, itemId, enabled) {
  const def = getCategoryByItemId(itemId);
  if (!def) return false;
  ensureGuildConfig(guildId);
  const db = getDb();
  const disabled = db.carryConfig[guildId].categories[def.id].disabledItems;
  if (enabled) delete disabled[itemId];
  else disabled[itemId] = true;
  saveDb();
  return true;
}

/** Stores the panel message id so we can edit-in-place next time. */
export function setPanelMessageId(guildId, categoryId, messageId) {
  if (!CARRY_CATEGORIES[categoryId]) return false;
  ensureGuildConfig(guildId);
  const db = getDb();
  db.carryConfig[guildId].categories[categoryId].panelMessageId = messageId ?? null;
  saveDb();
  return true;
}

/** Returns the list of provider user IDs registered for an item. */
export function getProvidersForItem(itemId) {
  const db = getDb();
  const providers = db.carryProviders ?? {};
  return Object.entries(providers)
    .filter(([, types]) => Array.isArray(types) && types.includes(itemId))
    .map(([uid]) => uid);
}

/** Adds a provider registration for an item. Returns true if newly added. */
export function addProvider(userId, itemId) {
  const db = getDb();
  if (!db.carryProviders) db.carryProviders = {};
  if (!Array.isArray(db.carryProviders[userId])) db.carryProviders[userId] = [];
  if (db.carryProviders[userId].includes(itemId)) return false;
  db.carryProviders[userId].push(itemId);
  saveDb();
  return true;
}

/** Removes a single item from a provider's registration. Returns true if removed. */
export function removeProviderItem(userId, itemId) {
  const db = getDb();
  if (!db.carryProviders) db.carryProviders = {};
  const list = db.carryProviders[userId];
  if (!Array.isArray(list)) return false;
  const idx = list.indexOf(itemId);
  if (idx < 0) return false;
  list.splice(idx, 1);
  if (list.length === 0) delete db.carryProviders[userId];
  saveDb();
  return true;
}

/** Removes a provider entirely (all items). */
export function removeProvider(userId) {
  const db = getDb();
  if (!db.carryProviders) db.carryProviders = {};
  if (!db.carryProviders[userId]) return false;
  delete db.carryProviders[userId];
  saveDb();
  return true;
}

/** Returns the array of item IDs a provider is registered for. */
export function getProviderItems(userId) {
  const db = getDb();
  const list = db.carryProviders?.[userId];
  return Array.isArray(list) ? list : [];
}

/** All providers (raw map). */
export function getAllProviders() {
  const db = getDb();
  return db.carryProviders ?? {};
}

/** Category choice list for slash command options (max 25). */
export const CATEGORY_CHOICES = Object.values(CARRY_CATEGORIES).map(c => ({
  name:  `${c.emoji} ${c.label}`,
  value: c.id,
}));
