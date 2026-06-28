/**
 * SkyBot v2 dashboard types.
 *
 * These mirror the JSON shapes returned by the SkyBot bot HTTP API on
 * port 8080 (proxied via the Caddy gateway using `?XTransformPort=8080`).
 *
 * All numeric coin values are raw integers (1 coin = 1 unit). Use
 * `formatCoins()` from `dashboard-api.ts` to render them compactly.
 */

/** Hypixel item attributes parsed from auction NBT / lore. */
export interface FlipAttributes {
  name: string;
  tier: string;
  isBin: boolean;
  isPet: boolean;
  petLevel: number;
  petCandy: number;
  stars: number;
  reforge: string | null;
  isRecombobulated: boolean;
  hotPotatoBooks: number;
  farmingForDummies: number;
  skin: string | null;
  enchantments: Record<string, number>;
  isShiny: boolean;
  shinyValue: number | null;
  count: number;
  demandScore: number;
}

/** A detected flip — an underpriced BIN auction vs EWMA market price. */
export interface Flip {
  uuid: string;
  attributes: FlipAttributes;
  buyPrice: number;
  marketEwma: number;
  marketP5: number;
  marketP50: number;
  profit: number;
  marginPct: number;
  demandScore: number;
  volumeScore: number;
  confidenceScore: number;
  detectedAt: number;
}

/**
 * Backwards-compatible stripped flip shape — used by `/api/flips/recent`,
 * `/api/flips/top`, `/api/flips/search`. The bot may send EITHER this
 * stripped shape OR the full `Flip` shape (with `attributes`). We accept
 * both and normalize in `normalizeFlip()`.
 */
export interface StrippedFlip {
  uuid: string;
  itemName: string;
  tier: string;
  buyPrice: number;
  ewma: number;
  profit: number;
  marginPct: number;
  demandScore: number;
  volumeScore: number;
  confidenceScore: number;
  sampleCount: number;
  signature: string;
  detectedAt: number;
  /** Optional — present when the bot returns full flip records. */
  attributes?: FlipAttributes;
  /** Optional — present in newer responses. */
  marketEwma?: number;
  marketP5?: number;
  marketP50?: number;
}

/** Active TTS session — one per guild with the bot in a voice channel. */
export interface TTSSession {
  guildId: string;
  guildName: string;
  voiceChannelId: string;
  voiceChannelName: string;
  textChannelId: string;
  textChannelName: string;
  aiMode: boolean;
  queueSize: number;
  speaking: boolean;
  connectionDead: boolean;
}

/** Top-level bot overview stats — mirrors the upgraded `/api/stats` payload. */
export interface BotStats {
  online: boolean;
  uptime: number;
  guilds: number;
  ping: number;
  ttsSessions: number;
  ttsQueueTotal: number;
  flipsDetected: number;
  totalProfitCoins: number;
  itemsTracked: number;
  lastScanAt: number | null;
  /** New AH scan bookkeeping fields (Task 6). */
  scansRun: number;
  lastScanFlipsFound: number;
  lastScanDurationMs: number;
  lastScanAuctionsSeen: number;
  failedScans: number;
  statsOnlyMode: boolean;
  postingToDiscord: boolean;
  /** Auction-sold watcher summary fields. */
  auctionSoldAlerts: number;
  linkedPlayers: number;
  subscriptions: number;
  /** Slash-command registration status. */
  commandsRegistered: boolean;
  commandCount: number;
  commandsRegisteredAt: number | null;
  deployScope: 'guild' | 'global' | 'none' | null;
  /** Welcome-message status. */
  welcomePosted: boolean;
  welcomePostedAt: number | null;
  /** Secret-presence flags surfaced in the setup checklist. */
  DISCORD_TOKEN_SET: boolean;
  CLIENT_ID_SET: boolean;
  GUILD_ID_SET: boolean;
  HYPIXEL_API_KEY_SET: boolean;
  GROQ_API_KEY_SET: boolean;
  AH_FLIP_CHANNEL_ID_SET: boolean;
  PREMIUM_ROLE_ID_SET: boolean;
  VOICERSS_API_KEY_SET: boolean;
}

/** Where a config value came from — `db` (dashboard override), `env`, or `default`. */
export type ConfigSource = 'db' | 'env' | 'default';

/** All known editable AH-flip config keys. */
export type ConfigKey =
  | 'AH_FLIP_MIN_PROFIT'
  | 'AH_FLIP_MIN_MARGIN'
  | 'AH_FLIP_MAX_PAGES'
  | 'AH_FLIP_INTERVAL'
  | 'AH_FLIP_MAX_PER_CYCLE'
  | 'AH_FLIP_MIN_DEMAND'
  | 'AH_FLIP_MIN_SAMPLES'
  | 'AH_FLIP_CHANNEL_ID'
  | 'PREMIUM_ROLE_ID'
  | 'AH_FLIP_ENABLED';

/** Config value can be a number, string, or null (when no override is set). */
export type ConfigValue = number | string | boolean | null;

/** Source map: key → source. */
export type ConfigSources = Partial<Record<ConfigKey, ConfigSource>>;

/** Defaults map: key → default value (may be null when no default exists). */
export type ConfigDefaults = Partial<Record<ConfigKey, ConfigValue>>;

/** Editable config response returned by `GET /api/config`. */
export interface EditableConfig {
  values: Partial<Record<ConfigKey, ConfigValue>>;
  sources: ConfigSources;
  defaults: ConfigDefaults;
  /** Secret-presence flags (mirror of `BotStats`). */
  DISCORD_TOKEN_SET: boolean;
  CLIENT_ID_SET: boolean;
  GUILD_ID_SET: boolean;
  HYPIXEL_API_KEY_SET: boolean;
  GROQ_API_KEY_SET: boolean;
  VOICERSS_API_KEY_SET: boolean;
}

/**
 * Backwards-compat alias: legacy code only needs the secret-presence flags
 * surfaced on `BotConfig`. We keep the type name so older imports still
 * resolve — the canonical editable shape is `EditableConfig`.
 */
export type BotConfig = EditableConfig;

/** Result returned by `POST /api/config` on success. */
export interface UpdateConfigResult {
  ok: true;
  updated: Partial<Record<ConfigKey, ConfigValue>>;
}

/** Result returned by `POST /api/flips/force-scan`. */
export interface ForceScanResult {
  ok: boolean;
  scansRun: number;
  lastScanFlipsFound: number;
  lastScanAuctionsSeen: number;
  lastScanDurationMs: number;
}

/** Result returned by `POST /api/flips/test-post`. */
export interface TestPostResult {
  ok: boolean;
  error?: string;
}

/** Result returned by `POST /api/commands/redeploy`. */
export interface RedeployResult {
  ok: boolean;
  count: number;
  scope: 'guild' | 'global' | 'none' | null;
  error?: string;
}

/** A linked player — Discord ↔ Hypixel IGN mapping. */
export interface LinkedPlayer {
  discordId: string;
  ign: string;
  uuid: string;
  linkedAt: number;
}

/** Wrapper for the `/api/linked` response. */
export interface LinkedPlayersResponse {
  players: LinkedPlayer[];
}

/** Stats returned by `GET /api/auction-sold/stats`. */
export interface AuctionSoldStats {
  totalAlertsSent: number;
  totalCoinsTracked: number;
  lastScanAt: number | null;
  lastScanDurationMs: number;
  lastScanPlayersChecked: number;
  lastScanAuctionsChecked: number;
  lastScanNewlySold: number;
  failedScans: number;
  playersTracked: number;
}

/** First-run setup checklist item. */
export interface SetupChecklistItem {
  key: string;
  label: string;
  ok: boolean;
  hint: string;
  /** Severity: `critical` blocks deployment, `recommended` is nice-to-have. */
  severity: 'critical' | 'recommended';
}

/** First-run status snapshot — derived from `BotStats`. */
export interface FirstRunStatus {
  items: SetupChecklistItem[];
  /** All `critical` items are ok. */
  ready: boolean;
  /** Number of critical items passing. */
  passedCritical: number;
  totalCritical: number;
  statsOnlyMode: boolean;
  postingToDiscord: boolean;
}

/** Price-history lookup result for a single item signature. */
export interface PriceLookup {
  signature: string;
  ewma: number;
  p5: number;
  p50: number;
  min: number;
  max: number;
  count: number;
  lastSeen: number;
  /** Optional histogram buckets (10 buckets between min..max) for the chart. */
  histogram?: number[];
}

/** One subscriber's subscription entry. */
export interface Subscription {
  discordId: string;
  items: string[];
  itemSignature?: string;
  minProfit?: number;
  channelOverride?: string | null;
}

/** All subscriptions keyed by Discord user ID. */
export type SubscriptionsMap = Record<string, Subscription>;

/** Connection state — derived from health check + last successful fetch. */
export type ConnectionState = 'connected' | 'connecting' | 'disconnected';

/** Generic error payload returned by the API client. */
export interface ApiError {
  message: string;
  status?: number;
  endpoint?: string;
}

// ── Carry system types (Task 11) ─────────────────────────────────

/** A single carry item (e.g. "F7 Carry", "Tier 3 Voidgloom"). */
export interface CarryItem {
  id: string;
  label: string;
  emoji: string;
  /** Tier label — numeric ("3") or named ("Basic", "Hot"). */
  tier: string;
  /** Price string as authored by the admin — e.g. "35M", "2.5B". May be raw number too. */
  price: string | number;
  /** Optional boss grouping — used for slayers where multiple tiers share a boss. */
  bossName?: string;
  enabled: boolean;
}

/** A carry category (dungeons / master / slayers / kuudra / crimson). */
export interface CarryCategory {
  id: string;
  label: string;
  emoji: string;
  description: string;
  /** Discord channel this category posts its panel to. Empty when unset. */
  channelId: string;
  enabled: boolean;
  items: CarryItem[];
}

/** Response of `GET /api/carry/categories?guildId=...`. */
export interface CarryCategoriesResponse {
  categories: Record<string, CarryCategory>;
  /** Default price/label metadata — useful for reset-to-default UIs. */
  defaults: Record<string, Partial<CarryItem>>;
}

/** Response of `POST /api/carry/price` and `POST /api/carry/toggle`. */
export interface CarryItemUpdateResult {
  ok: boolean;
  item?: CarryItem;
  error?: string;
}

/** Response of `POST /api/carry/channel`. */
export interface CarryChannelUpdateResult {
  ok: boolean;
  error?: string;
}

/** Response of `POST /api/carry/panel` — posts the embed+buttons to the bound channel. */
export interface CarryPanelPostResult {
  ok: boolean;
  messageId?: string;
  channelId?: string;
  error?: string;
}

// ── Launch system types (Task 11) ────────────────────────────────

/** Keys surfaced in the launch status `checks` object. */
export type LaunchCheckKey =
  | 'discordToken'
  | 'clientId'
  | 'hypixelApiKey'
  | 'groqApiKey'
  | 'flipChannelId'
  | 'carryChannelsSet'
  | 'commandsRegistered'
  | 'welcomePosted';

/** All-or-nothing map of the 8 launch readiness checks. */
export type LaunchChecks = Record<LaunchCheckKey, boolean>;

/** Response of `GET /api/launch/status`. */
export interface LaunchStatus {
  ready: boolean;
  botRunning: boolean;
  checks: LaunchChecks;
  criticalMissing: string[];
  optionalMissing: string[];
  carryGuildCount: number;
  message: string;
}

/** Response of `POST /api/launch/validate-token`. */
export interface TokenValidation {
  valid: boolean;
  /** Present when valid — the resolved bot identity. */
  botTag?: string;
  botId?: string;
  appName?: string;
  /** Present when invalid. */
  error?: string;
}
