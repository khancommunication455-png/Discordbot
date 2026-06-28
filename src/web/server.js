/**
 * server.js — SkyBot v2 Web Dashboard API Server
 *
 * Express server exposing REST endpoints consumed by the Next.js dashboard.
 * Runs on process.env.PORT (Railway sets this) or 8080 fallback.
 *
 * All endpoints return JSON. Auth via DASHBOARD_TOKEN (Bearer header) if set.
 */
import express from 'express';
import { REST, Routes } from 'discord.js';
import { getDb, saveDb, addSubscription, removeSubscription, getAllSubscribers } from '../utils/db.js';
import { getFlipWatcherStats, getRecentFlips, getTopFlips, searchFlips, forceScan, postTestFlip } from '../services/ahFlipWatcher.js';
import { getAuctionSoldStats } from '../services/auctionSoldWatcher.js';
import { getAllTTSStates } from '../services/ttsService.js';
import { exportSnapshot, getStats as getPriceStats, getMarketPrice } from '../services/priceHistory.js';
import { getAllConfig, getConfig, getConfigSource, setConfig, updateConfig, DEFAULTS } from '../utils/runtimeConfig.js';
import { getAutoDeployStatus, autoDeployCommands } from '../utils/autoDeploy.js';
import {
  CARRY_CATEGORIES, ensureGuildConfig, getAllCategories, getCategory, getItem,
  setCategoryChannel, setItemPrice, setItemEnabled,
} from '../utils/carryConfig.js';
import { postCarryPanel } from '../commands/Carries/carry.js';

export function startWebDashboard(client) {
  const app = express();
  app.use(express.json());

  // Simple token auth (optional)
  const TOKEN = process.env.DASHBOARD_TOKEN;
  function auth(req, res, next) {
    if (!TOKEN) return next();
    const auth = req.headers.authorization || '';
    const token = auth.replace(/^Bearer\s+/i, '');
    if (token !== TOKEN) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  }

  // ── Health check (no auth) ──────────────────────────────────
  app.get('/health', (req, res) => {
    res.json({ ok: true, uptime: process.uptime(), ts: Date.now() });
  });

  // ── Overview stats ──────────────────────────────────────────
  app.get('/api/stats', auth, (req, res) => {
    try {
      const db = getDb();
      const flipStats = getFlipWatcherStats();
      const priceStats = getPriceStats();
      const ttsStates = getAllTTSStates();
      const soldStats = getAuctionSoldStats();
      const autoDeploy = getAutoDeployStatus();

      const totalTTSQueue = ttsStates.reduce((sum, s) => sum + (s.queue?.length || 0), 0);

      res.json({
        online: true,
        uptime: process.uptime(),
        guilds: client.guilds?.cache?.size ?? 0,
        ping: client.ws?.ping ?? 0,
        ttsSessions: ttsStates.length,
        ttsQueueTotal: totalTTSQueue,
        flipsDetected: flipStats.totalFlipsDetected,
        totalProfitCoins: flipStats.totalProfitCoins,
        itemsTracked: priceStats.signatures,
        lastScanAt: flipStats.lastScanAt,
        scansRun: flipStats.scansRun,
        lastScanFlipsFound: flipStats.lastScanFlipsFound,
        lastScanDurationMs: flipStats.lastScanDurationMs,
        lastScanAuctionsSeen: flipStats.lastScanAuctionsSeen,
        failedScans: flipStats.failedScans,
        statsOnlyMode: flipStats.statsOnlyMode,
        postingToDiscord: flipStats.postingToDiscord,
        auctionSoldAlerts: soldStats.totalAlertsSent,
        linkedPlayers: Object.keys(db.linkedPlayers).length,
        subscriptions: Object.keys(db.ahSubscriptions).length,
        // First-run status
        commandsRegistered: autoDeploy.commandsRegistered,
        commandCount: autoDeploy.commandCount,
        commandsRegisteredAt: autoDeploy.commandsRegisteredAt,
        deployScope: autoDeploy.deployScope,
        welcomePosted: autoDeploy.welcomePosted,
        welcomePostedAt: autoDeploy.welcomePostedAt,
        // Secret presence flags (don't leak values)
        DISCORD_TOKEN_SET: !!process.env.DISCORD_TOKEN,
        CLIENT_ID_SET: !!process.env.CLIENT_ID,
        GUILD_ID_SET: !!process.env.GUILD_ID,
        HYPIXEL_API_KEY_SET: !!process.env.HYPIXEL_API_KEY,
        GROQ_API_KEY_SET: !!process.env.GROQ_API_KEY,
        AH_FLIP_CHANNEL_ID_SET: !!getConfig('AH_FLIP_CHANNEL_ID'),
        PREMIUM_ROLE_ID_SET: !!getConfig('PREMIUM_ROLE_ID'),
        VOICERSS_API_KEY_SET: !!process.env.VOICERSS_API_KEY,
      });
    } catch (err) {
      console.error('[Web] /api/stats error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Recent flips ────────────────────────────────────────────
  app.get('/api/flips/recent', auth, (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
      res.json({ flips: getRecentFlips(limit) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Top flips ───────────────────────────────────────────────
  app.get('/api/flips/top', auth, (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
      res.json({ flips: getTopFlips(limit) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Search flips ────────────────────────────────────────────
  app.get('/api/flips/search', auth, (req, res) => {
    try {
      const q = (req.query.q || '').toString().trim();
      if (!q) return res.json({ flips: [] });
      res.json({ flips: searchFlips(q) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── TTS sessions ────────────────────────────────────────────
  app.get('/api/tts/sessions', auth, (req, res) => {
    try {
      const sessions = getAllTTSStates().map(s => {
        const guild = client.guilds.cache.get(s.guildId);
        return {
          guildId: s.guildId,
          guildName: guild?.name ?? 'Unknown',
          voiceChannelId: s.voiceChannelId,
          voiceChannelName: guild?.channels?.cache?.get(s.voiceChannelId)?.name ?? 'Unknown',
          textChannelId: s.textChannelId,
          textChannelName: guild?.channels?.cache?.get(s.textChannelId)?.name ?? 'Unknown',
          aiMode: s.aiMode,
          queueSize: s.queue?.length || 0,
          speaking: s.active,
          connectionDead: s.connectionDead,
        };
      });
      res.json({ sessions });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Force TTS reconnect ─────────────────────────────────────
  app.post('/api/tts/reconnect', auth, async (req, res) => {
    try {
      const guildId = req.query.guildId || req.body?.guildId;
      if (!guildId) return res.status(400).json({ error: 'guildId required' });
      const guild = client.guilds.cache.get(guildId);
      if (!guild) return res.status(404).json({ error: 'Guild not found' });

      // Force-stop and let next message trigger rejoin
      const { stopTTS } = await import('../services/ttsService.js');
      stopTTS(guildId);
      res.json({ ok: true, message: 'TTS session stopped. Use /tts start in Discord to rejoin.' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Price history lookup ────────────────────────────────────
  app.get('/api/price/lookup', auth, (req, res) => {
    try {
      const item = (req.query.item || '').toString().trim();
      if (!item) return res.json({ items: [] });

      // Search all signatures that contain the item name
      const snapshot = exportSnapshot();
      const matches = snapshot
        .filter(s => s.signature.toLowerCase().includes(item.toLowerCase()))
        .slice(0, 20)
        .map(s => ({
          signature: s.signature,
          ewma: s.ewma,
          p5: s.p5,
          p50: s.p50,
          min: s.min,
          max: s.max,
          count: s.count,
          lastSeen: s.lastSeen,
        }));
      res.json({ items: matches });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── All price history snapshot ──────────────────────────────
  app.get('/api/price/snapshot', auth, (req, res) => {
    try {
      res.json({ items: exportSnapshot(), stats: getPriceStats() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Subscriptions ───────────────────────────────────────────
  app.get('/api/subscriptions', auth, (req, res) => {
    try {
      const subs = getAllSubscribers();
      const list = Object.entries(subs).map(([discordId, sub]) => ({
        discordId,
        items: sub.items || [],
        minProfit: sub.minProfit || 0,
        channelOverride: sub.channelOverride || null,
      }));
      res.json({ subscriptions: list });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/subscriptions', auth, async (req, res) => {
    try {
      const { discordId, item } = req.body || {};
      if (!discordId || !item) return res.status(400).json({ error: 'discordId and item required' });
      const added = addSubscription(discordId, item);
      res.json({ ok: true, added });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/subscriptions', auth, async (req, res) => {
    try {
      const { discordId, item } = req.body || {};
      if (!discordId || !item) return res.status(400).json({ error: 'discordId and item required' });
      const removed = removeSubscription(discordId, item);
      res.json({ ok: true, removed });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Bot config (editable via runtimeConfig.js) ──────────────
  // GET returns current values + source (db override | env | default)
  app.get('/api/config', auth, (req, res) => {
    try {
      const config = getAllConfig();
      const sources = {};
      for (const key of Object.keys(config)) {
        sources[key] = getConfigSource(key);
      }
      res.json({
        values: config,
        sources,
        defaults: DEFAULTS,
        // Secret presence flags (don't leak actual secret values)
        DISCORD_TOKEN_SET: !!process.env.DISCORD_TOKEN,
        CLIENT_ID_SET: !!process.env.CLIENT_ID,
        GUILD_ID_SET: !!process.env.GUILD_ID,
        HYPIXEL_API_KEY_SET: !!process.env.HYPIXEL_API_KEY,
        GROQ_API_KEY_SET: !!process.env.GROQ_API_KEY,
        VOICERSS_API_KEY_SET: !!process.env.VOICERSS_API_KEY,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST updates config (DB override). Body: { key: value, ... }
  // Pass null to clear an override (revert to env/default).
  app.post('/api/config', auth, async (req, res) => {
    try {
      const updates = req.body || {};
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No config keys provided in body' });
      }
      const results = await updateConfig(updates);
      res.json({ ok: true, updated: results });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── Force scan now (bypass interval timer) ──────────────────
  app.post('/api/flips/force-scan', auth, async (req, res) => {
    try {
      const result = await forceScan();
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Post a test flip to Discord channel ─────────────────────
  app.post('/api/flips/test-post', auth, async (req, res) => {
    try {
      const result = await postTestFlip();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Re-register slash commands (manual trigger) ─────────────
  app.post('/api/commands/redeploy', auth, async (req, res) => {
    try {
      const result = await autoDeployCommands(client, true); // force=true
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Auction sold stats ──────────────────────────────────────
  app.get('/api/auction-sold/stats', auth, (req, res) => {
    try {
      res.json(getAuctionSoldStats());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Linked players (for info) ───────────────────────────────
  app.get('/api/linked', auth, (req, res) => {
    try {
      const db = getDb();
      const list = Object.entries(db.linkedPlayers).map(([discordId, info]) => ({
        discordId,
        ign: info.ign,
        uuid: info.uuid,
        linkedAt: info.linkedAt,
      }));
      res.json({ players: list });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Carry system (per-category channel design) ──────────────
  // GET /api/carry/categories?guildId=<id>
  //   Returns all 5 carry categories with guild overrides applied.
  //   If no guildId is provided, returns the default catalog (no overrides).
  app.get('/api/carry/categories', auth, (req, res) => {
    try {
      const guildId = (req.query.guildId || '').toString();
      if (!guildId) {
        // Defaults only (no guild overrides)
        return res.json({
          guildId: null,
          categories: Object.fromEntries(
            Object.entries(CARRY_CATEGORIES).map(([id, def]) => [
              id,
              {
                ...def,
                channelId:      null,
                enabled:        true,
                panelMessageId: null,
                items: def.items.map(it => ({ ...it, enabled: true })),
              },
            ]),
          ),
        });
      }
      ensureGuildConfig(guildId);
      res.json({ guildId, categories: getAllCategories(guildId) });
    } catch (err) {
      console.error('[Web] /api/carry/categories error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/carry/channel   body: { guildId, categoryId, channelId }
  //   Sets the Discord channel for a carry category.
  app.post('/api/carry/channel', auth, async (req, res) => {
    try {
      const { guildId, categoryId, channelId } = req.body || {};
      if (!guildId || !categoryId || !channelId) {
        return res.status(400).json({ error: 'guildId, categoryId, channelId required' });
      }
      if (!CARRY_CATEGORIES[categoryId]) {
        return res.status(400).json({ error: `Unknown categoryId: ${categoryId}` });
      }
      ensureGuildConfig(guildId);
      const ok = setCategoryChannel(guildId, categoryId, channelId);
      if (!ok) return res.status(400).json({ error: 'Failed to set channel' });
      res.json({
        ok,
        categoryId,
        channelId,
        category: getCategory(guildId, categoryId),
      });
    } catch (err) {
      console.error('[Web] /api/carry/channel error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/carry/price   body: { guildId, itemId, price }
  //   Overrides a carry item's price.
  app.post('/api/carry/price', auth, async (req, res) => {
    try {
      const { guildId, itemId, price } = req.body || {};
      if (!guildId || !itemId || !price) {
        return res.status(400).json({ error: 'guildId, itemId, price required' });
      }
      ensureGuildConfig(guildId);
      const ok = setItemPrice(guildId, itemId, String(price));
      if (!ok) return res.status(400).json({ error: `Unknown itemId: ${itemId}` });
      res.json({ ok, itemId, price: String(price), item: getItem(guildId, itemId) });
    } catch (err) {
      console.error('[Web] /api/carry/price error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/carry/panel   body: { guildId, categoryId }
  //   Posts/refreshes the carry panel in the category's channel.
  //   Returns { ok, messageId, channelId } or { error: 'channel not set' }.
  app.post('/api/carry/panel', auth, async (req, res) => {
    try {
      const { guildId, categoryId } = req.body || {};
      if (!guildId || !categoryId) {
        return res.status(400).json({ error: 'guildId, categoryId required' });
      }
      if (!CARRY_CATEGORIES[categoryId]) {
        return res.status(400).json({ error: `Unknown categoryId: ${categoryId}` });
      }
      ensureGuildConfig(guildId);
      const category = getCategory(guildId, categoryId);
      if (!category?.channelId) {
        return res.status(400).json({ error: 'channel not set' });
      }
      const result = await postCarryPanel(client, guildId, categoryId);
      if (!result) {
        return res.status(500).json({ error: 'Failed to post panel (channel not reachable)' });
      }
      res.json({ ok: true, ...result });
    } catch (err) {
      console.error('[Web] /api/carry/panel error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/carry/toggle   body: { guildId, itemId, enabled }
  //   Enable/disable a specific carry item.
  app.post('/api/carry/toggle', auth, async (req, res) => {
    try {
      const { guildId, itemId, enabled } = req.body || {};
      if (!guildId || !itemId || typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'guildId, itemId, enabled (boolean) required' });
      }
      ensureGuildConfig(guildId);
      const ok = setItemEnabled(guildId, itemId, enabled);
      if (!ok) return res.status(400).json({ error: `Unknown itemId: ${itemId}` });
      res.json({ ok, itemId, enabled, item: getItem(guildId, itemId) });
    } catch (err) {
      console.error('[Web] /api/carry/toggle error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Bot launch readiness check ──────────────────────────────
  // Returns a checklist of what's configured vs missing, so the dashboard
  // can show a "Run Bot" button that's only enabled when everything's ready.
  app.get('/api/launch/status', auth, (req, res) => {
    try {
      const db = getDb();
      const carryCfg = db.carryConfig || {};
      const guildIds = Object.keys(carryCfg).filter(gid => {
        const cats = carryCfg[gid]?.categories || {};
        return Object.values(cats).some(c => c.channelId);
      });

      const checks = {
        discordToken:    !!process.env.DISCORD_TOKEN,
        clientId:        !!process.env.CLIENT_ID,
        hypixelApiKey:   !!process.env.HYPIXEL_API_KEY,
        groqApiKey:      !!process.env.GROQ_API_KEY,
        flipChannelId:   !!getConfig('AH_FLIP_CHANNEL_ID'),
        carryChannelsSet: guildIds.length > 0,
        commandsRegistered: db.firstRun?.commandsRegistered ?? false,
        welcomePosted:   db.firstRun?.welcomePosted ?? false,
      };

      const criticalMissing = [];
      if (!checks.discordToken)  criticalMissing.push('DISCORD_TOKEN');
      if (!checks.clientId)      criticalMissing.push('CLIENT_ID');
      if (!checks.hypixelApiKey) criticalMissing.push('HYPIXEL_API_KEY');
      if (!checks.flipChannelId) criticalMissing.push('AH_FLIP_CHANNEL_ID');

      const ready = criticalMissing.length === 0;
      const botRunning = !!process.env.DISCORD_TOKEN;

      res.json({
        ready,
        botRunning,
        checks,
        criticalMissing,
        optionalMissing: !checks.groqApiKey ? ['GROQ_API_KEY (for AI mode)'] : [],
        carryGuildCount: guildIds.length,
        message: ready
          ? (botRunning ? 'Bot is running!' : 'All config ready — set DISCORD_TOKEN in Railway env vars and deploy to start the bot.')
          : `Missing critical env vars: ${criticalMissing.join(', ')}. Set these in your Railway environment variables.`,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Validate a DISCORD_TOKEN without restarting ─────────────
  // POST /api/launch/validate-token  body: { token }
  // Returns { valid, botTag, botId } or { valid: false, error }
  // Does NOT store the token — just validates it for the dashboard.
  app.post('/api/launch/validate-token', auth, async (req, res) => {
    try {
      const { token } = req.body || {};
      if (!token || typeof token !== 'string') {
        return res.status(400).json({ valid: false, error: 'Token required' });
      }
      // Validate by fetching the bot's application info
      const rest = new REST({ version: '10' }).setToken(token);
      try {
        const app = await rest.get(Routes.oauth2CurrentApplication());
        const user = await rest.get(Routes.user());
        res.json({
          valid: true,
          botTag: user?.username ? `${user.username}#${user.discriminator || '0'}` : user?.username,
          botId: user?.id,
          appName: app?.name,
        });
      } catch (err) {
        res.json({ valid: false, error: err.message?.slice(0, 200) || 'Invalid token' });
      }
    } catch (err) {
      res.status(500).json({ valid: false, error: err.message });
    }
  });

  // ─­─ Get all carry categories with full item details ────────
  // Returns the merged category config (defaults + guild overrides)
  app.get('/api/carry/categories', auth, (req, res) => {
    try {
      const guildId = (req.query.guildId || '').toString();
      res.json({
        categories: getAllCategories(guildId),
        defaults: CARRY_CATEGORIES,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  const port = parseInt(process.env.PORT || '8080', 10);
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`🌐 Web dashboard API listening on :${port}`);
  });

  server.on('error', (err) => {
    console.error('[Web] Server error:', err.message);
  });

  return server;
}
