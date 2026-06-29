/**
 * index.js — SkyBot v2 Entry Point (Railway Edition)
 *
 * Boot order:
 * 1. Load .env
 * 2. Find ffmpeg (Railway nixpacks paths first)
 * 3. Init DB
 * 4. Load slash commands + events
 * 5. Login to Discord
 * 6. On ready: start background services (AH flip watcher, auction sold watcher, web API)
 *
 * Designed for Railway: graceful shutdown, no Python deps, no native opus bindings.
 */
import 'dotenv/config';
import { execSync } from 'child_process';
import { existsSync } from 'fs';

// ── Locate ffmpeg BEFORE importing @discordjs/voice ──────────
const ffmpegPaths = [
  '/root/.nix-profile/bin/ffmpeg',
  '/nix/var/nix/profiles/default/bin/ffmpeg',
  '/usr/bin/ffmpeg',
  '/usr/local/bin/ffmpeg',
];
for (const p of ffmpegPaths) {
  if (existsSync(p)) {
    process.env.FFMPEG_PATH = p;
    console.log(`[FFmpeg] Found at: ${p}`);
    break;
  }
}
if (!process.env.FFMPEG_PATH) {
  try {
    const which = execSync('which ffmpeg', { stdio: 'pipe' }).toString().trim();
    if (which) { process.env.FFMPEG_PATH = which; console.log(`[FFmpeg] Found at: ${which}`); }
  } catch {}
}
if (!process.env.FFMPEG_PATH) {
  console.warn('[FFmpeg] Not found — TTS will not work. Install ffmpeg-headless in nixpacks.');
}

import { Client, Collection, GatewayIntentBits, Partials } from 'discord.js';
import { readdirSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { initDb } from './utils/db.js';
import { startAHFlipWatcher } from './services/ahFlipWatcher.js';
import { startAuctionSoldWatcher } from './services/auctionSoldWatcher.js';
import { startWebDashboard } from './web/server.js';
import { autoDeployCommands } from './utils/autoDeploy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Validate env ─────────────────────────────────────────────
const required = ['DISCORD_TOKEN', 'CLIENT_ID'];
const missing = required.filter(k => !process.env[k]);
if (missing.length) {
  console.warn(`⚠️  Missing env vars: ${missing.join(', ')}`);
  console.warn('   Starting in DEMO MODE — web API will respond with empty data.');
  console.warn('   Set DISCORD_TOKEN and CLIENT_ID to enable full bot functionality.');
}
if (!process.env.HYPIXEL_API_KEY) {
  console.warn('⚠️  HYPIXEL_API_KEY not set — some endpoints will fall back to SkyCrypt.');
}
if (!process.env.GROQ_API_KEY) {
  console.warn('⚠️  GROQ_API_KEY not set — AI mode disabled.');
}
if (!process.env.AH_FLIP_CHANNEL_ID) {
  console.warn('⚠️  AH_FLIP_CHANNEL_ID not set — flip alerts will not be posted to Discord.');
}

// ── Discord client ───────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel, Partials.Message],
});

client.commands    = new Collection();
client.cooldowns   = new Collection();

// ── Load commands ────────────────────────────────────────────
async function loadCommands(dir) {
  let count = 0;
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, item.name);
    if (item.isDirectory()) {
      count += await loadCommands(fullPath);
    } else if (item.name.endsWith('.js') && !item.name.startsWith('_')) {
      try {
        const mod = await import(pathToFileURL(fullPath).href);
        const cmd = mod.default;
        if (cmd?.data?.name) {
          client.commands.set(cmd.data.name, cmd);
          console.log(`  ✅ Command: /${cmd.data.name}`);
          count++;
        }
      } catch (err) {
        console.error(`  ❌ Failed to load command ${fullPath}:`, err.message);
      }
    }
  }
  return count;
}

// ── Load events ──────────────────────────────────────────────
async function loadEvents(dir) {
  for (const file of readdirSync(dir).filter(f => f.endsWith('.js'))) {
    const fullPath = join(dir, file);
    try {
      const mod = await import(pathToFileURL(fullPath).href);
      if (mod.default?.name) {
        const ev = mod.default;
        ev.once
          ? client.once(ev.name, (...a) => ev.execute(...a, client))
          : client.on(ev.name,   (...a) => ev.execute(...a, client));
        console.log(`  📡 Event: ${ev.name}`);
      }
    } catch (err) {
      console.error(`  ❌ Failed to load event ${file}:`, err.message);
    }
  }
}

// ── Graceful shutdown ────────────────────────────────────────
function shutdown(signal) {
  console.log(`\n${signal} received — shutting down...`);
  try { client.destroy(); } catch {}
  try { process.exit(0); } catch {}
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('💥 Unhandled rejection:', reason);
});

// ── Main ─────────────────────────────────────────────────────
async function main() {
  console.log('🚀 Starting SkyBot v2 (Railway Edition)...');

  await initDb();
  console.log('📦 Database ready');

  console.log('📂 Loading commands...');
  const cmdCount = await loadCommands(join(__dirname, 'commands'));
  console.log(`   ${cmdCount} command(s) loaded`);

  console.log('📂 Loading events...');
  await loadEvents(join(__dirname, 'events'));

  if (!process.env.DISCORD_TOKEN) {
    console.warn('\n🟡 DEMO MODE: No DISCORD_TOKEN — skipping Discord login.');
    console.warn('   Web API will start so the dashboard can render.');
    // Provide a minimal mock client for the web server
    const mockClient = {
      guilds: { cache: { size: 0, get: () => null } },
      ws: { ping: 0 },
      user: null,
      channels: { cache: { get: () => null }, fetch: async () => null },
      users: { fetch: async () => null },
      readyTimestamp: Date.now(),
    };
    try { startAHFlipWatcher(mockClient); } catch (err) { console.error('[AHFlip] Failed to start:', err.message); }
    try { startAuctionSoldWatcher(mockClient); } catch (err) { console.error('[AuctionSold] Failed to start:', err.message); }
    try { startWebDashboard(mockClient); } catch (err) { console.error('[Web] Failed to start:', err.message); }
    console.log('📡 Demo services started');
    return;
  }

  await client.login(process.env.DISCORD_TOKEN);

  client.once('ready', async () => {
    console.log(`\n✅ SkyBot v2 online as ${client.user.tag}`);
    console.log(`📊 Serving ${client.guilds.cache.size} server(s)`);
    console.log(`📡 Ping: ${client.ws.ping}ms`);
    client.user.setActivity('Hypixel Skyblock | /info', { type: 3 });

    // ── First-run: auto-register slash commands ──
    // Makes /tts /flip /info /bazaar etc. work immediately on Railway deploy.
    // No manual `npm run deploy` needed.
    try {
      const result = await autoDeployCommands(client);
      if (result.ok) {
        console.log(`📋 Slash commands: ${result.count} registered (${result.scope})`);
      }
    } catch (err) {
      console.error('[AutoDeploy] Failed:', err.message);
    }

    // ── Background services ──
    try { startAHFlipWatcher(client); } catch (err) { console.error('[AHFlip] Failed to start:', err.message); }
    try { startAuctionSoldWatcher(client); } catch (err) { console.error('[AuctionSold] Failed to start:', err.message); }
    try { startWebDashboard(client); } catch (err) { console.error('[Web] Failed to start:', err.message); }
    console.log('📡 Background services started');

    // ── First-run: post welcome message to flip channel ──
    // Tells users the bot is online and configured correctly.
    try {
      const { postWelcomeMessage } = await import('./services/ahFlipWatcher.js');
      await postWelcomeMessage(client);
    } catch (err) {
      console.error('[Welcome] Failed:', err.message);
    }
  });
}

main().catch(err => {
  console.error('💥 Fatal startup error:', err);
  process.exit(1);
});
