/**
 * dashboard-api.ts — typed client for the SkyBot bot HTTP API.
 *
 * Supports two deployment modes:
 *
 * 1. PRODUCTION (Vercel dashboard + Railway bot):
 *    Set NEXT_PUBLIC_BOT_API_URL env var on Vercel to your Railway bot URL:
 *      NEXT_PUBLIC_BOT_API_URL=https://your-bot-name.up.railway.app
 *    The dashboard calls the bot directly (cross-origin, requires CORS
 *    which is enabled on the bot's Express server).
 *
 * 2. SANDBOX (single-host dev with Caddy gateway):
 *    When NEXT_PUBLIC_BOT_API_URL is not set, the dashboard uses relative
 *    paths with ?XTransformPort=8080, which the Caddy gateway routes to
 *    the bot on port 8080.
 *
 * Every function returns a typed result or throws an `ApiError`.
 */

import type {
  ApiError,
  AuctionSoldStats,
  BotStats,
  CarryCategoriesResponse,
  CarryChannelUpdateResult,
  CarryItemUpdateResult,
  CarryPanelPostResult,
  ConfigKey,
  ConfigValue,
  EditableConfig,
  FirstRunStatus,
  Flip,
  ForceScanResult,
  LaunchStatus,
  LinkedPlayersResponse,
  PriceLookup,
  RedeployResult,
  SetupChecklistItem,
  StrippedFlip,
  Subscription,
  SubscriptionsMap,
  TestPostResult,
  TokenValidation,
  TTSSession,
  UpdateConfigResult,
} from './types'

/** The XTransformPort query value for sandbox mode. */
export const BOT_PORT = '8080'

/**
 * The bot's public URL in production mode.
 * Set NEXT_PUBLIC_BOT_API_URL on Vercel to your Railway bot URL.
 * Example: https://skybot-bot.up.railway.app
 */
export const BOT_API_URL = process.env.NEXT_PUBLIC_BOT_API_URL || ''

/** Whether we're in production mode (cross-origin calls to Railway). */
const IS_PRODUCTION = !!BOT_API_URL

/** Default request timeout (ms). */
const DEFAULT_TIMEOUT = 10000

/**
 * Build the full API URL.
 *
 * - PRODUCTION: `${BOT_API_URL}${path}?params` (cross-origin to Railway)
 * - SANDBOX:    `${path}?XTransformPort=8080&params` (relative, via gateway)
 */
function botUrl(path: string, params?: Record<string, string | number | undefined>): string {
  const url = new URL(path, BOT_API_URL || 'http://localhost')
  if (!IS_PRODUCTION) {
    url.searchParams.set('XTransformPort', BOT_PORT)
  }
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
    }
  }
  // In production: return full URL (cross-origin)
  // In sandbox: return only path+search (relative)
  if (IS_PRODUCTION) {
    return url.toString()
  }
  return `${url.pathname}${url.search}`
}

/** Optional auth token (sent as Bearer header if set). */
const AUTH_TOKEN = process.env.NEXT_PUBLIC_DASHBOARD_TOKEN || ''

/** Wrap fetch in a timeout + JSON parse + friendly error conversion. */
async function tryFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT)
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init?.headers as Record<string, string> ?? {}),
    }
    if (AUTH_TOKEN) {
      headers.Authorization = `Bearer ${AUTH_TOKEN}`
    }
    const res = await fetch(path, {
      ...init,
      signal: controller.signal,
      headers,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      const err: ApiError = {
        message: `Request failed (${res.status} ${res.statusText})${body ? `: ${body.slice(0, 200)}` : ''}`,
        status: res.status,
        endpoint: path,
      }
      throw err
    }
    const json = (await res.json()) as T
    return json
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'message' in e && 'status' in e && (e as ApiError).endpoint) {
      // already an ApiError we constructed above
      throw e
    }
    if (e instanceof DOMException && e.name === 'AbortError') {
      const err: ApiError = {
        message: 'Request timed out — the bot may be starting up or unreachable.',
        endpoint: path,
      }
      throw err
    }
    const err: ApiError = {
      message:
        e instanceof Error
          ? `Network error: ${e.message}`
          : 'Unknown network error — is the bot running on port 8080?',
      endpoint: path,
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }
}

// ── Normalization helpers ─────────────────────────────────────────

/**
 * Normalize a flip record from either the stripped shape (returned by
 * `/api/flips/recent`, `/api/flips/top`, `/api/flips/search`) or the
 * full shape (with `attributes`). Returns a unified `Flip`-like object
 * whose attributes are always populated.
 *
 * The dashboard UI consumes the unified shape so it doesn't have to
 * branch on which endpoint returned the record.
 */
export function normalizeFlip(raw: StrippedFlip): Flip {
  const attrs = raw.attributes ?? {
    name: raw.itemName,
    tier: raw.tier,
    isBin: true,
    isPet: false,
    petLevel: 0,
    petCandy: 0,
    stars: 0,
    reforge: null,
    isRecombobulated: false,
    hotPotatoBooks: 0,
    farmingForDummies: 0,
    skin: null,
    enchantments: {},
    isShiny: false,
    shinyValue: null,
    count: 1,
    demandScore: raw.demandScore,
  }
  return {
    uuid: raw.uuid,
    attributes: attrs,
    buyPrice: raw.buyPrice,
    marketEwma: raw.marketEwma ?? raw.ewma,
    marketP5: raw.marketP5 ?? 0,
    marketP50: raw.marketP50 ?? 0,
    profit: raw.profit,
    marginPct: raw.marginPct,
    demandScore: raw.demandScore,
    volumeScore: raw.volumeScore,
    confidenceScore: raw.confidenceScore,
    detectedAt: raw.detectedAt,
  }
}

// ── Public API surface ────────────────────────────────────────────

/** Health check — resolves `true` if the bot responds, throws otherwise. */
export async function checkHealth(): Promise<boolean> {
  await tryFetch<{ ok?: boolean; status?: string }>(botUrl('/health'))
  return true
}

/** Fetch the bot overview stats (uptime, guilds, ping, flip totals, etc.). */
export async function fetchStats(): Promise<BotStats> {
  return tryFetch<BotStats>(botUrl('/api/stats'))
}

/** Fetch the N most-recent flips (most-recent-first). */
export async function fetchRecentFlips(limit = 20): Promise<Flip[]> {
  const raw = await tryFetch<StrippedFlip[] | { flips?: StrippedFlip[] }>(
    botUrl('/api/flips/recent', { limit }),
  )
  const arr = Array.isArray(raw) ? raw : raw?.flips ?? []
  return arr.map(normalizeFlip)
}

/** Fetch the N most-profitable flips ever detected (sorted desc). */
export async function fetchTopFlips(limit = 10): Promise<Flip[]> {
  const raw = await tryFetch<StrippedFlip[] | { flips?: StrippedFlip[] }>(
    botUrl('/api/flips/top', { limit }),
  )
  const arr = Array.isArray(raw) ? raw : raw?.flips ?? []
  return arr.map(normalizeFlip)
}

/** Search recent flips by item name (case-insensitive substring). */
export async function searchFlips(query: string): Promise<Flip[]> {
  const raw = await tryFetch<StrippedFlip[] | { flips?: StrippedFlip[] }>(
    botUrl('/api/flips/search', { q: query }),
  )
  const arr = Array.isArray(raw) ? raw : raw?.flips ?? []
  return arr.map(normalizeFlip)
}

/** Fetch all active TTS sessions. */
export async function fetchTTSSessions(): Promise<TTSSession[]> {
  const raw = await tryFetch<TTSSession[] | { sessions?: TTSSession[] }>(
    botUrl('/api/tts/sessions'),
  )
  return Array.isArray(raw) ? raw : raw?.sessions ?? []
}

/** Force a TTS session to reconnect (calls POST /api/tts/reconnect). */
export async function reconnectTTS(guildId: string): Promise<{ ok: boolean; message?: string }> {
  return tryFetch<{ ok: boolean; message?: string }>(
    botUrl('/api/tts/reconnect', { guildId }),
    { method: 'POST' },
  )
}

/** Look up price history for an item name (signature substring match).
 * Returns the first matching signature's price data, or null if no matches. */
export async function lookupPrice(item: string): Promise<PriceLookup | null> {
  const raw = await tryFetch<PriceLookup | { items?: PriceLookup[] } | null>(
    botUrl('/api/price/lookup', { item }),
  )
  if (!raw) return null
  // API returns { items: [...] } — take the first match (most samples)
  if (Array.isArray((raw as { items?: PriceLookup[] }).items)) {
    const items = (raw as { items?: PriceLookup[] }).items ?? []
    return items.length > 0 ? items[0] : null
  }
  // Already a single PriceLookup object
  if ((raw as PriceLookup).signature) return raw as PriceLookup
  return null
}

/** Fetch all subscriptions keyed by Discord user ID. */
export async function fetchSubscriptions(): Promise<Subscription[]> {
  const raw = await tryFetch<SubscriptionsMap | Subscription[]>(
    botUrl('/api/subscriptions'),
  )
  if (Array.isArray(raw)) return raw
  // Map → flat list
  return Object.entries(raw).map(([discordId, sub]) => ({ discordId, ...sub }))
}

/** Add a subscription (POST body: { discordId, item }). */
export async function addSubscription(
  discordId: string,
  item: string,
): Promise<{ ok: boolean; message?: string }> {
  return tryFetch<{ ok: boolean; message?: string }>(botUrl('/api/subscriptions'), {
    method: 'POST',
    body: JSON.stringify({ discordId, item }),
  })
}

/** Remove a subscription (DELETE body: { discordId, item }). */
export async function removeSubscription(
  discordId: string,
  item: string,
): Promise<{ ok: boolean; message?: string }> {
  return tryFetch<{ ok: boolean; message?: string }>(botUrl('/api/subscriptions'), {
    method: 'DELETE',
    body: JSON.stringify({ discordId, item }),
  })
}

/** Fetch the editable bot config (values, sources, defaults, secret-presence). */
export async function fetchConfig(): Promise<EditableConfig> {
  return tryFetch<EditableConfig>(botUrl('/api/config'))
}

/**
 * Update one or more config values.
 *
 * Pass `null` for any key to clear the override and revert to env/default.
 * On error the API returns `{ "error": "<message>" }` with a non-2xx status —
 * `tryFetch` surfaces that as an `ApiError` whose `.message` carries the
 * server-side validation reason (e.g. `"AH_FLIP_INTERVAL must be >= 20s"`).
 */
export async function updateConfig(
  patch: Partial<Record<ConfigKey, ConfigValue>>,
): Promise<UpdateConfigResult> {
  return tryFetch<UpdateConfigResult>(botUrl('/api/config'), {
    method: 'POST',
    body: JSON.stringify(patch),
  })
}

/** Trigger an immediate AH scan — calls `POST /api/flips/force-scan`. */
export async function forceScan(): Promise<ForceScanResult> {
  return tryFetch<ForceScanResult>(botUrl('/api/flips/force-scan'), {
    method: 'POST',
  })
}

/** Send a test flip embed to the configured AH flip Discord channel. */
export async function testPostFlip(): Promise<TestPostResult> {
  return tryFetch<TestPostResult>(botUrl('/api/flips/test-post'), {
    method: 'POST',
  })
}

/** Re-register slash commands with Discord — calls `POST /api/commands/redeploy`. */
export async function redeployCommands(): Promise<RedeployResult> {
  return tryFetch<RedeployResult>(botUrl('/api/commands/redeploy'), {
    method: 'POST',
  })
}

/** Fetch auction-sold watcher stats — calls `GET /api/auction-sold/stats`. */
export async function fetchAuctionSoldStats(): Promise<AuctionSoldStats> {
  return tryFetch<AuctionSoldStats>(botUrl('/api/auction-sold/stats'))
}

/** Fetch the list of Discord ↔ Hypixel IGN linked players. */
export async function fetchLinkedPlayers(): Promise<LinkedPlayersResponse> {
  return tryFetch<LinkedPlayersResponse>(botUrl('/api/linked'))
}

/**
 * Derive a `FirstRunStatus` snapshot from the bot stats — used by the
 * `SetupChecklist` to render the deployment-readiness panel at the top of
 * the dashboard. Returns `null` when stats are unavailable.
 */
export function deriveFirstRunStatus(stats: BotStats | null): FirstRunStatus | null {
  if (!stats) return null
  const items: SetupChecklistItem[] = [
    {
      key: 'discord_token',
      label: 'Discord Bot Token',
      ok: stats.DISCORD_TOKEN_SET,
      hint: 'Set DISCORD_TOKEN in Railway env vars. Bot cannot start without it.',
      severity: 'critical',
    },
    {
      key: 'client_id',
      label: 'Discord Client ID',
      ok: stats.CLIENT_ID_SET,
      hint: 'Set CLIENT_ID in Railway env vars. Required for slash-command registration.',
      severity: 'critical',
    },
    {
      key: 'hypixel_api_key',
      label: 'Hypixel API Key',
      ok: stats.HYPIXEL_API_KEY_SET,
      hint: 'Set HYPIXEL_API_KEY — needed for AH page fetches and player data.',
      severity: 'critical',
    },
    {
      key: 'groq_api_key',
      label: 'Groq API Key (AI mode)',
      ok: stats.GROQ_API_KEY_SET,
      hint: 'Optional. Set GROQ_API_KEY to enable the AI assistant TTS mode.',
      severity: 'recommended',
    },
    {
      key: 'ah_flip_channel_id',
      label: 'AH Flip Channel ID',
      ok: stats.AH_FLIP_CHANNEL_ID_SET,
      hint: 'Set AH_FLIP_CHANNEL_ID below in the Bot Configuration panel, or as an env var.',
      severity: 'critical',
    },
    {
      key: 'commands_registered',
      label: 'Slash Commands Registered',
      ok: stats.commandsRegistered,
      hint: 'Click "Redeploy Commands" below to register slash commands with Discord.',
      severity: 'critical',
    },
    {
      key: 'welcome_posted',
      label: 'Welcome Message Posted',
      ok: stats.welcomePosted,
      hint: 'Bot will post a welcome embed on next ready event once token is set.',
      severity: 'recommended',
    },
    {
      key: 'posting_to_discord',
      label: 'Flip Watcher Posting to Discord',
      ok: stats.postingToDiscord && !stats.statsOnlyMode,
      hint: 'Bot is in stats-only mode — set AH_FLIP_CHANNEL_ID to enable Discord posting.',
      severity: 'critical',
    },
  ]
  const critical = items.filter((i) => i.severity === 'critical')
  const passedCritical = critical.filter((i) => i.ok).length
  return {
    items,
    ready: critical.every((i) => i.ok),
    passedCritical,
    totalCritical: critical.length,
    statsOnlyMode: stats.statsOnlyMode,
    postingToDiscord: stats.postingToDiscord,
  }
}

// ── Carry system endpoints (Task 11) ─────────────────────────────

/**
 * Fetch all carry categories (dungeons / master / slayers / kuudra / crimson)
 * with guild overrides applied. When `guildId` is omitted the API returns the
 * default catalog (no overrides, no channel bindings).
 */
export async function fetchCarryCategories(
  guildId?: string,
): Promise<CarryCategoriesResponse> {
  return tryFetch<CarryCategoriesResponse>(
    botUrl('/api/carry/categories', guildId ? { guildId } : undefined),
  )
}

/**
 * Bind a Discord channel to a carry category. The category's panel embed
 * is posted (or refreshed) to this channel on the next `/api/carry/panel` call.
 */
export async function setCarryChannel(
  guildId: string,
  categoryId: string,
  channelId: string,
): Promise<CarryChannelUpdateResult> {
  return tryFetch<CarryChannelUpdateResult>(botUrl('/api/carry/channel'), {
    method: 'POST',
    body: JSON.stringify({ guildId, categoryId, channelId }),
  })
}

/**
 * Override the price of a single carry item. Price is a free-form string
 * ("35M", "2.5B") — the bot stores it verbatim and renders it on the panel.
 */
export async function setCarryItemPrice(
  guildId: string,
  itemId: string,
  price: string,
): Promise<CarryItemUpdateResult> {
  return tryFetch<CarryItemUpdateResult>(botUrl('/api/carry/price'), {
    method: 'POST',
    body: JSON.stringify({ guildId, itemId, price }),
  })
}

/**
 * Post (or refresh in-place) the embed + button panel for a carry category
 * to its bound Discord channel. Returns the resulting message ID.
 */
export async function postCarryPanel(
  guildId: string,
  categoryId: string,
): Promise<CarryPanelPostResult> {
  return tryFetch<CarryPanelPostResult>(botUrl('/api/carry/panel'), {
    method: 'POST',
    body: JSON.stringify({ guildId, categoryId }),
  })
}

/**
 * Enable or disable a single carry item. Disabled items are hidden from the
 * panel embed and their request buttons are not rendered.
 */
export async function toggleCarryItem(
  guildId: string,
  itemId: string,
  enabled: boolean,
): Promise<CarryItemUpdateResult> {
  return tryFetch<CarryItemUpdateResult>(botUrl('/api/carry/toggle'), {
    method: 'POST',
    body: JSON.stringify({ guildId, itemId, enabled }),
  })
}

// ── Launch system endpoints (Task 11) ────────────────────────────

/**
 * Fetch the launch readiness snapshot — used by the LaunchPanel to render
 * the big status card, env-var checklist, and deploy CTA.
 */
export async function fetchLaunchStatus(): Promise<LaunchStatus> {
  return tryFetch<LaunchStatus>(botUrl('/api/launch/status'))
}

/**
 * Validate a Discord bot token by asking the bot's HTTP layer to call
 * Discord's `GET /users/@me` endpoint with the supplied token.
 *
 * The token is sent over the same-origin gateway (port 8080 via Caddy) —
 * it never leaves the bot's process. Returns the resolved bot identity on
 * success or an error message on failure.
 */
export async function validateToken(token: string): Promise<TokenValidation> {
  return tryFetch<TokenValidation>(botUrl('/api/launch/validate-token'), {
    method: 'POST',
    body: JSON.stringify({ token }),
  })
}

// ── Formatting helpers ────────────────────────────────────────────

/** Compact coin formatter — 1,234,567 → "1.2M", 1,500,000,000 → "1.5B". */
export function formatCoins(n: number): string {
  if (!isFinite(n)) return '0'
  const abs = Math.abs(n)
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toFixed(0)
}

/** Full coin formatter with thousands separators — 1234567 → "1,234,567". */
export function formatCoinsFull(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

/** Format a duration in ms as "1d 3h 22m" / "4m 12s" / "12s". */
export function formatUptime(ms: number): string {
  if (!ms || ms < 0) return '0s'
  const s = Math.floor(ms / 1000)
  const days = Math.floor(s / 86_400)
  const hours = Math.floor((s % 86_400) / 3_600)
  const mins = Math.floor((s % 3_600) / 60)
  const secs = s % 60
  if (days > 0) return `${days}d ${hours}h ${mins}m`
  if (hours > 0) return `${hours}h ${mins}m`
  if (mins > 0) return `${mins}m ${secs}s`
  return `${secs}s`
}

/** Relative timestamp formatter — "just now" / "2m ago" / "1h ago" / "3d ago". */
export function formatRelativeTime(ts: number): string {
  if (!ts) return '—'
  const diff = Date.now() - ts
  if (diff < 0) return 'in the future'
  const s = Math.floor(diff / 1000)
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

/** Absolute timestamp formatter — "Apr 5, 14:32:08". */
export function formatTimestamp(ts: number | null | undefined): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/** Hypixel rarity tier → hex color stripe. */
export function tierColorHex(tier: string): string {
  switch ((tier || '').toUpperCase()) {
    case 'COMMON': return '#FFFFFF'
    case 'UNCOMMON': return '#FEBC2C'
    case 'RARE': return '#0099FF'
    case 'EPIC': return '#9C2DC2'
    case 'LEGENDARY': return '#FFA500'
    case 'MYTHIC': return '#FF2171'
    case 'DIVINE': return '#00D4AA'
    case 'SPECIAL': return '#FF2171'
    case 'VERY SPECIAL': return '#FF2171'
    default: return '#9CA3AF'
  }
}
