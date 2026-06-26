/**
 * hypixel.js
 * Multi-fallback Hypixel API wrapper
 *
 * NOTE FOR RAILWAY USERS:
 * Add these to Railway → Settings → Networking → Egress:
 *   api.hypixel.net
 *   api.mojang.com
 *   api.ashcon.app
 *   api.slothpixel.me
 *
 * Without egress rules, Railway blocks ALL outbound on free plan.
 */
import axios from 'axios';

const MOJANG     = axios.create({ baseURL: 'https://api.mojang.com/',         timeout: 10_000 });
const ASHCON     = axios.create({ baseURL: 'https://api.ashcon.app/mojang/v2/',timeout: 10_000 });
const SLOTHPIXEL = axios.create({ baseURL: 'https://api.slothpixel.me/api/',  timeout: 15_000 });
const HYPIXEL    = axios.create({ baseURL: 'https://api.hypixel.net/',         timeout: 12_000 });

// Add User-Agent to all requests to avoid blocks
const UA = 'SkyBot-DiscordBot/1.0';
[MOJANG, ASHCON, SLOTHPIXEL, HYPIXEL].forEach(c => {
  c.defaults.headers.common['User-Agent'] = UA;
});

const SKYCRYPT = axios.create({ baseURL: 'https://sky.shiiyu.moe/api/v2/', timeout: 15_000, headers: { 'User-Agent': UA } });

function hasKey() { return !!process.env.HYPIXEL_API_KEY; }

async function tryGet(client, path, params = {}) {
  try {
    const { data } = await client.get(path, { params });
    return data;
  } catch (err) {
    const code = err.response?.status ?? 0;
    console.warn(`[Hypixel] ${path} failed: ${code} ${err.message?.slice(0,80)}`);
    throw err;
  }
}

// ── UUID Lookup ─────────────────────────────────────────────────────────────
export async function getUUID(ign) {
  // Ashcon — most reliable
  try {
    const data = await tryGet(ASHCON, `user/${ign}`);
    if (data?.uuid) return { id: data.uuid.replace(/-/g,''), name: data.username };
  } catch {}

  // Mojang
  try {
    const data = await tryGet(MOJANG, `users/profiles/minecraft/${ign}`);
    if (data?.id) return { id: data.id, name: data.name };
  } catch {}

  throw new Error(`Player \`${ign}\` not found. Ensure the spelling is correct.`);
}

// ── Skyblock Profiles ────────────────────────────────────────────────────────
export async function getSkyblockProfiles(uuid) {
  // Official Hypixel API (needs key)
  if (hasKey()) {
    try {
      const data = await tryGet(HYPIXEL, 'skyblock/profiles', {
        key: process.env.HYPIXEL_API_KEY, uuid,
      });
      if (data.success && data.profiles?.length) return data.profiles;
    } catch {}
  }

  // SkyCrypt API (No Key Required, highly reliable)
  try {
    const data = await tryGet(SKYCRYPT, `profile/${uuid}`);
    if (data && data.profiles) {
      // SkyCrypt returns an object mapping profile_ids to profile data
      return Object.values(data.profiles).map(p => {
        const raw = p.raw || {};
        return {
          profile_id: p.profile_id,
          cute_name: p.cute_name,
          selected: p.current,
          banking: { balance: raw.banking?.balance ?? p.data?.networth?.bank ?? 0 },
          members: {
            [uuid]: {
              player_data: {
                experience: {
                  SKILL_FARMING: p.data?.skills?.skills?.farming?.xp ?? 0,
                  SKILL_MINING: p.data?.skills?.skills?.mining?.xp ?? 0,
                  SKILL_COMBAT: p.data?.skills?.skills?.combat?.xp ?? 0,
                  SKILL_FORAGING: p.data?.skills?.skills?.foraging?.xp ?? 0,
                  SKILL_FISHING: p.data?.skills?.skills?.fishing?.xp ?? 0,
                  SKILL_ENCHANTING: p.data?.skills?.skills?.enchanting?.xp ?? 0,
                  SKILL_ALCHEMY: p.data?.skills?.skills?.alchemy?.xp ?? 0,
                  SKILL_TAMING: p.data?.skills?.skills?.taming?.xp ?? 0,
                  SKILL_CARPENTRY: p.data?.skills?.skills?.carpentry?.xp ?? 0,
                  SKILL_RUNECRAFTING: p.data?.skills?.skills?.runecrafting?.xp ?? 0,
                }
              },
              dungeons: raw.dungeons ?? {},
              slayer: raw.slayer ?? { slayer_bosses: {} },
              currencies: { coin_purse: p.data?.networth?.purse ?? raw.coin_purse ?? 0 },
              leveling: { experience: raw.leveling?.experience ?? 0 },
              fairy_souls_collected: raw.fairy_souls_collected ?? p.data?.fairy_souls?.collected ?? 0,
              mining_core: raw.mining_core ?? {},
              jacobs_contest: raw.jacobs_contest ?? {},
            }
          }
        };
      });
    }
  } catch {}

  throw new Error('Could not load SkyBlock profile. The Hypixel API might be down.');
}

export async function getActiveProfile(uuid) {
  const profiles = await getSkyblockProfiles(uuid);
  if (!profiles?.length) throw new Error('No SkyBlock profiles found.');
  return profiles.find(p => p.selected) ?? profiles[0];
}

// ── Player Auctions ──────────────────────────────────────────────────────────
export async function getPlayerAuctions(uuid) {
  // Official API - no key needed for public auction endpoints
  try {
    const data = await tryGet(HYPIXEL, 'skyblock/auction', { player: uuid });
    if (data.success) return data.auctions ?? [];
  } catch {}

  throw new Error('Could not fetch auctions.');
}

// ── AH Page ──────────────────────────────────────────────────────────────────
export async function getAHPage(page = 0) {
  try {
    // Official API - no key needed for public auction endpoints
    const data = await tryGet(HYPIXEL, 'skyblock/auctions', { page });
    if (data.success) return data;
  } catch {}
  return { auctions: [], totalPages: 0 };
}

// ── Bazaar ────────────────────────────────────────────────────────────────────
export async function getBazaar() {
  try {
    // Official API - no key needed for public bazaar endpoint
    const data = await tryGet(HYPIXEL, 'skyblock/bazaar');
    if (data.success) return data.products;
  } catch {}

  // SkyCrypt fallback
  try {
    const data = await tryGet(SKYCRYPT, 'bazaar');
    if (data) return data;
  } catch {}

  throw new Error('Bazaar unavailable.');
}

// ── Player Data ────────────────────────────────────────────────────────────────
export async function getPlayerData(uuid) {
  if (hasKey()) {
    try {
      const data = await tryGet(HYPIXEL, 'player', {
        key: process.env.HYPIXEL_API_KEY, uuid,
      });
      if (data.success) return data.player;
    } catch {}
  }
  return { newPackageRank: 'NON', achievements: {}, displayname: '' };
}

export function cleanItemName(name = '') { return name.replace(/§./g,'').trim(); }
export function estimateNetworth(profile, uuid) {
  const member = profile?.members?.[uuid];
  if (!member) return 0;
  return (member.currencies?.coin_purse ?? 0) + (profile.banking?.balance ?? 0);
}
