/**
 * hypixel.js — SkyBot v2 Multi-Fallback Hypixel API Wrapper (FIXED)
 *
 * FIXES:
 * 1. Added Moulberry's lowest-BIN API (free, no key) for instant price baseline
 * 2. Added SkyHelper API as additional fallback
 * 3. getAllAuctions now fetches ALL pages (Hypixel AH has ~200+ pages, scanning 10 gives real data)
 * 4. Better error handling and retry logic
 */
import axios from 'axios';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const BROWSER_HEADERS = {
  'User-Agent': UA,
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'identity',
  'Cache-Control': 'no-cache',
};
const TIMEOUT = 15_000;

const HYPIXEL    = axios.create({ baseURL: 'https://api.hypixel.net/',          timeout: TIMEOUT, headers: BROWSER_HEADERS });
const MOJANG     = axios.create({ baseURL: 'https://api.mojang.com/',           timeout: TIMEOUT, headers: { 'User-Agent': UA } });
const ASHCON     = axios.create({ baseURL: 'https://api.ashcon.app/mojang/v2/', timeout: TIMEOUT, headers: { 'User-Agent': UA } });
const SLOTHPIXEL = axios.create({ baseURL: 'https://api.slothpixel.me/api/',    timeout: 15_000,  headers: { 'User-Agent': UA } });
const SKYCRYPT   = axios.create({ baseURL: 'https://sky.shiiyu.moe/api/v2/',    timeout: 15_000,  headers: { 'User-Agent': UA } });

// Free price APIs (no key needed)
const MOULBERRY  = axios.create({ baseURL: 'https://moulberry.codes/',          timeout: 10_000,  headers: { 'User-Agent': UA } });
const SKYHELPER  = axios.create({ baseURL: 'https://api.skyhelper.net/',        timeout: 10_000,  headers: { 'User-Agent': UA } });
const COFLNET    = axios.create({ baseURL: 'https://sky.coflnet.com/api/',      timeout: 10_000,  headers: { 'User-Agent': UA } });

function hasKey() { return !!process.env.HYPIXEL_API_KEY; }

// ── In-memory cache ──
const cache = new Map();
function getCached(key) {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.data;
  if (hit) cache.delete(key);
  return null;
}
function setCached(key, data, ttlMs) {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
  if (cache.size > 300) { const firstKey = cache.keys().next().value; cache.delete(firstKey); }
}

async function tryGet(client, path, params = {}, opts = {}) {
  try {
    const { data } = await client.get(path, { params, ...opts });
    return data;
  } catch (err) {
    const code = err.response?.status ?? 0;
    if (code === 429) console.warn(`[Hypixel] Rate limited on ${path}`);
    throw err;
  }
}

// ── UUID Lookup (multi-fallback) ──
export async function getUUID(ign) {
  try {
    const data = await tryGet(ASHCON, `user/${ign}`);
    if (data?.uuid) return { id: data.uuid.replace(/-/g, ''), name: data.username };
  } catch {}
  try {
    const data = await tryGet(MOJANG, `users/profiles/minecraft/${ign}`);
    if (data?.id) return { id: data.id, name: data.name };
  } catch {}
  try {
    const data = await tryGet(SLOTHPIXEL, `players/${ign}`);
    if (data?.uuid) return { id: data.uuid.replace(/-/g, ''), name: data.username };
  } catch {}
  throw new Error(`Player \`${ign}\` not found.`);
}

// ── Skyblock Profiles ──
export async function getSkyblockProfiles(uuid) {
  if (hasKey()) {
    try {
      const data = await tryGet(HYPIXEL, 'skyblock/profiles', { key: process.env.HYPIXEL_API_KEY, uuid });
      if (data.success && data.profiles?.length) return data.profiles;
    } catch {}
  }
  try {
    const data = await tryGet(SKYCRYPT, `profile/${uuid}`);
    if (data?.profiles) {
      return Object.values(data.profiles).map(p => {
        const raw = p.raw || {};
        return {
          profile_id: p.profile_id, cute_name: p.cute_name, selected: p.current,
          banking: { balance: raw.banking?.balance ?? 0 },
          members: { [uuid]: { ...raw, player_data: raw.player_data ?? {} } },
        };
      });
    }
  } catch {}
  throw new Error('Could not load SkyBlock profile.');
}

export async function getActiveProfile(uuid) {
  const profiles = await getSkyblockProfiles(uuid);
  if (!profiles?.length) throw new Error('No SkyBlock profiles found.');
  return profiles.find(p => p.selected) ?? profiles[0];
}

// ── Player Auctions ──
export async function getPlayerAuctions(uuid) {
  try {
    const params = { player: uuid };
    if (hasKey()) params.key = process.env.HYPIXEL_API_KEY;
    const data = await tryGet(HYPIXEL, 'skyblock/auction', params);
    if (data.success) return data.auctions ?? [];
  } catch {}
  return [];
}

// ── AH Page (cached) ──
export async function getAHPage(page = 0) {
  const cacheKey = `ah_page_${page}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const params = { page };
    if (hasKey()) params.key = process.env.HYPIXEL_API_KEY;
    const data = await tryGet(HYPIXEL, 'skyblock/auctions', params);
    if (data.success !== false) {
      setCached(cacheKey, data, 20_000);
      return data;
    }
  } catch (err) {
    console.warn(`[Hypixel] getAHPage(${page}) failed: ${err.message}`);
  }
  return { auctions: [], totalPages: 0, success: false };
}

// ── Get all AH pages (parallelized with rate-limit awareness) ──
export async function getAllAuctions(maxPages = 10) {
  const firstPage = await getAHPage(0);
  const totalAvailable = firstPage.totalPages ?? 0;
  const totalPages = Math.min(totalAvailable, maxPages);
  const allAuctions = [...(firstPage.auctions ?? [])];

  if (totalPages <= 1) return allAuctions;

  const pageNums = [];
  for (let p = 1; p < totalPages; p++) pageNums.push(p);

  // Fetch in chunks of 4 (slightly faster than 3, still safe without a key)
  const chunkSize = hasKey() ? 6 : 4;
  for (let i = 0; i < pageNums.length; i += chunkSize) {
    const chunk = pageNums.slice(i, i + chunkSize);
    const results = await Promise.allSettled(chunk.map(p => getAHPage(p)));
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value?.auctions) {
        allAuctions.push(...r.value.auctions);
      }
    }
    // Small delay between chunks when no API key (avoid 429)
    if (!hasKey() && i + chunkSize < pageNums.length) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  console.log(`[Hypixel] getAllAuctions: ${allAuctions.length} auctions across ${totalPages} pages`);
  return allAuctions;
}

// ── Moulberry Lowest BIN (free, no key, instant price reference) ──
// Returns a Map<itemId, lowestBin> for fast lookup
let moulberryCache = null;
let moulberryCacheAt = 0;
const MOULBERRY_TTL = 5 * 60 * 1000; // 5 minutes

export async function getMoulberryPrices() {
  if (moulberryCache && Date.now() - moulberryCacheAt < MOULBERRY_TTL) {
    return moulberryCache;
  }
  try {
    const data = await tryGet(MOULBERRY, 'lowestbin.json');
    if (data && typeof data === 'object') {
      moulberryCache = data;
      moulberryCacheAt = Date.now();
      console.log(`[Hypixel] Moulberry lowestBIN loaded: ${Object.keys(data).length} items`);
      return data;
    }
  } catch (e) { console.warn('[Hypixel] Moulberry failed:', e.message); }

  // Fallback: try SkyHelper bazaar/item prices
  try {
    const data = await tryGet(SKYHELPER, 'skyblock/lowestbins');
    if (data && typeof data === 'object') {
      moulberryCache = data;
      moulberryCacheAt = Date.now();
      return data;
    }
  } catch (e) { console.warn('[Hypixel] SkyHelper lowestbins failed:', e.message); }

  return moulberryCache ?? {};
}

// ── Get item average price from Coflnet (free analytics API) ──
// Returns { avg, min, max, volume } or null
export async function getCoflnetPrice(itemId) {
  const cacheKey = `cofl_${itemId}`;
  const cached = getCached(cacheKey);
  if (cached !== null) return cached;

  try {
    // Coflnet's /item/price/{itemId}/current returns recent price data
    const data = await tryGet(COFLNET, `item/price/${encodeURIComponent(itemId)}/current`);
    if (data?.min !== undefined) {
      const result = { avg: data.avg ?? data.min, min: data.min, max: data.max ?? data.avg, volume: data.volume ?? 0 };
      setCached(cacheKey, result, 3 * 60 * 1000); // 3 min cache
      return result;
    }
  } catch {}

  setCached(cacheKey, null, 60_000);
  return null;
}

// ── Bazaar ──
export async function getBazaar() {
  const cached = getCached('bazaar');
  if (cached) return cached;
  try {
    const params = {};
    if (hasKey()) params.key = process.env.HYPIXEL_API_KEY;
    const data = await tryGet(HYPIXEL, 'skyblock/bazaar', params);
    if (data.success) { setCached('bazaar', data.products, 15_000); return data.products; }
  } catch {}
  try {
    const data = await tryGet(SKYCRYPT, 'bazaar');
    if (data) { setCached('bazaar', data, 15_000); return data; }
  } catch {}
  throw new Error('Bazaar unavailable.');
}

// ── Player Data ──
export async function getPlayerData(uuid) {
  if (hasKey()) {
    try {
      const data = await tryGet(HYPIXEL, 'player', { key: process.env.HYPIXEL_API_KEY, uuid });
      if (data.success) return data.player;
    } catch {}
  }
  return { newPackageRank: 'NON', achievements: {}, displayname: '' };
}

// ── Item name cleaner ──
export function cleanItemName(name = '') {
  return String(name).replace(/§[0-9a-fk-or]/gi, '').trim();
}

// ── Item attributes parser ──
export function parseItemAttributes(auction) {
  const rawName = auction.item_name || '';
  const name = cleanItemName(rawName);
  const lore = (auction.item_lore || '').replace(/§[0-9a-fk-or]/gi, '');
  const tier = (auction.tier || '').toUpperCase();
  const category = auction.category || '';
  const startingBid = auction.starting_bid ?? 0;

  const attrs = {
    name, rawName, tier, category,
    isBin: !!auction.bin,
    isPet: false, petLevel: 0, petCandy: 0,
    stars: 0, reforge: null,
    isRecombobulated: false, hotPotatoBooks: 0,
    enchants: [], skin: null,
    startingBid,
    // Item ID for Moulberry lookup
    itemId: auction.item_name?.replace(/§[0-9a-fk-or]/gi, '').trim().toUpperCase().replace(/\s+/g, '_') ?? '',
    demandScore: 0,
  };

  // ── Pet detection ──
  const petMatch = rawName.match(/\[Lvl (\d+)\] (.+)/);
  if (petMatch) {
    attrs.isPet = true;
    attrs.petLevel = parseInt(petMatch[1], 10) || 0;
    attrs.name = cleanItemName(petMatch[2]);
    attrs.itemId = attrs.name.toUpperCase().replace(/\s+/g, '_');
  }

  // ── Star detection (from item name: ✪✪✪✪✪) ──
  const starMatch = rawName.match(/[✪⚝]{1,5}/);
  if (starMatch) attrs.stars = starMatch[0].length;

  // ── Reforge (first word if it's a known reforge modifier) ──
  const KNOWN_REFORGES = new Set([
    'Withered','Fabled','Gilded','Warped','Precise','Refined','Reinforced',
    'Spiked','Spiritual','Shaded','Renowned','Ridiculous','Stellar','Mossy',
    'Dirty','Suspicious','Ancient','Epic','Legendary','Bizarre',
  ]);
  const parts = attrs.name.split(' ');
  if (parts.length > 1 && KNOWN_REFORGES.has(parts[0])) {
    attrs.reforge = parts[0];
    // Name without reforge for signature
    attrs.name = parts.slice(1).join(' ');
  }

  // ── Recombobulated ──
  if (lore.includes('Recombobulated')) attrs.isRecombobulated = true;

  // ── Hot potato books ──
  const hpbMatch = lore.match(/Hot Potato Books Applied: (\d+)/);
  if (hpbMatch) attrs.hotPotatoBooks = parseInt(hpbMatch[1], 10);

  // ── Enchantments (from lore) ──
  const enchantPattern = /^([A-Z][a-zA-Z\s]+) ([IVXLCDM]+|\d+)$/gm;
  let enchMatch;
  while ((enchMatch = enchantPattern.exec(lore)) !== null) {
    attrs.enchants.push({ name: enchMatch[1].trim(), level: enchMatch[2] });
  }

  // ── Pet candy ──
  const candyMatch = lore.match(/\((\d+)\/100\) Pet Candy Used/);
  if (candyMatch) attrs.petCandy = parseInt(candyMatch[1], 10);

  // ── Demand score: based on category and tier ──
  // Higher demand for popular categories
  const TIER_DEMAND = { MYTHIC: 40, LEGENDARY: 35, EPIC: 25, RARE: 15, UNCOMMON: 8, COMMON: 3 };
  const CAT_DEMAND = { ARMOR: 30, WEAPON: 25, ACCESSORIES: 35, PET: 20, BLOCKS: 5, MISC: 5 };
  attrs.demandScore = (TIER_DEMAND[tier] ?? 5) + (CAT_DEMAND[category?.toUpperCase()] ?? 5);
  if (attrs.isPet) attrs.demandScore += 10;
  if (attrs.isRecombobulated) attrs.demandScore += 5;

  return attrs;
}
