/**
 * server.js — SkyBot v2 Web Dashboard API Server
 *
 * Express server exposing REST endpoints consumed by the Next.js dashboard.
 * Runs on process.env.PORT (Railway sets this) or 8080 fallback.
 *
 * All endpoints return JSON. Auth via DASHBOARD_TOKEN (Bearer header) if set.
 */
import express from 'express';
import { getDb, saveDb, addSubscription, removeSubscription, getAllSubscribers } from '../utils/db.js';
import { getFlipWatcherStats, getRecentFlips, getTopFlips, searchFlips, forceScan, postTestFlip } from '../services/ahFlipWatcher.js';
import { getAuctionSoldStats } from '../services/auctionSoldWatcher.js';
import { getAllTTSStates } from '../services/ttsService.js';
import { exportSnapshot, getStats as getPriceStats, getMarketPrice } from '../services/priceHistory.js';
import { getAllConfig, getConfig, getConfigSource, setConfig, updateConfig, DEFAULTS } from '../utils/runtimeConfig.js';
import { getAutoDeployStatus, autoDeployCommands } from '../utils/autoDeploy.js';

export function startWebDashboard(client) {
  const app = express();
  app.use(express.json());

  // ── CORS — allows Vercel dashboard to call Railway bot ──
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });

  // ── Root status page ──
  app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SkyBot v2</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#0a0e14;color:#e0e0e0;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}.card{max-width:500px;width:100%;background:#111827;border:1px solid #1e293b;border-radius:16px;padding:40px;box-shadow:0 8px 32px rgba(0,0,0,.4)}.logo{width:48px;height:48px;border-radius:12px;background:linear-gradient(135deg,#00D4AA,#00796B);display:flex;align-items:center;justify-content:center;font-size:24px;margin-bottom:20px}h1{font-size:1.4rem;margin-bottom:8px}.status{display:flex;align-items:center;gap:8px;padding:12px 16px;background:#064e3b;border-radius:8px;margin-bottom:20px;color:#34d399;font-weight:600}.dot{width:10px;height:10px;border-radius:50%;background:#34d399;animation:p 2s infinite}@keyframes p{0%,100%{opacity:1}50%{opacity:.5}}.stat{background:#1e293b;border-radius:8px;padding:12px;margin-bottom:8px}.label{font-size:.7rem;text-transform:uppercase;color:#64748b}.val{font-size:1.1rem;font-weight:700;margin-top:4px}a{color:#00D4AA}</style></head><body><div class="card"><div class="logo">🤖</div><h1>SkyBot v2 <span style="font-size:.7rem;color:#00D4AA">Railway Edition</span></h1><div class="status"><span class="dot"></span> Bot is online</div><div class="stat"><div class="label">Uptime</div><div class="val">${Math.floor(process.uptime()/3600)}h ${Math.floor(process.uptime()%3600/60)}m</div></div><div class="stat"><div class="label">Health Check</div><div class="val"><a href="/health">/health</a> | <a href="/api/stats">/api/stats</a></div></div></div></body></html>`);
  });

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

  const port = parseInt(process.env.PORT || '8080', 10);
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`🌐 Web dashboard API listening on :${port}`);
  });

  server.on('error', (err) => {
    console.error('[Web] Server error:', err.message);
  });

  return server;
}
