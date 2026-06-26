import 'dotenv/config';
import { execSync } from 'child_process';
import { existsSync } from 'fs';

// Set FFMPEG_PATH for @discordjs/voice so it can find ffmpeg on Railway
const ffmpegPaths = [
  '/root/.nix-profile/bin/ffmpeg',
  '/usr/bin/ffmpeg',
  '/usr/local/bin/ffmpeg',
  '/nix/var/nix/profiles/default/bin/ffmpeg',
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
import { Client, Collection, GatewayIntentBits, Partials } from 'discord.js';
import { readdirSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
import { initDb } from './utils/db.js';
import { startAHFlipWatcher } from './services/ahFlipWatcher.js';
import { startAuctionSoldWatcher } from './services/auctionSoldWatcher.js';
import { startAHChatBot } from './services/ahChatBot.js';
import { startWebDashboard } from './web/server.js';
// Music now handled directly in music.js via yt-dlp

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildEmojisAndStickers,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction],
});

client.commands    = new Collection();
client.cooldowns   = new Collection();
client.musicQueues = new Map();

// ── Load Commands ─────────────────────────────────────────────────────────────
async function loadCommands(dir) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      await loadCommands(fullPath);
    } else if (item.name.endsWith('.js') && !item.name.startsWith('_')) {
      try {
        const mod = await import(pathToFileURL(fullPath).href);
        const cmd = mod.default;
        if (cmd?.data?.name) {
          client.commands.set(cmd.data.name, cmd);
          console.log(`  ✅ Command: /${cmd.data.name}`);
        }
      } catch (err) {
        console.error(`  ❌ Failed to load command ${fullPath}:`, err.message);
      }
    }
  }
}

// ── Load Events ───────────────────────────────────────────────────────────────
async function loadEvents(dir) {
  for (const file of readdirSync(dir).filter(f => f.endsWith('.js'))) {
    const fullPath = path.join(dir, file);
    try {
      const mod = await import(pathToFileURL(fullPath).href);

      // default export
      if (mod.default?.name) {
        const ev = mod.default;
        ev.once
          ? client.once(ev.name, (...a) => ev.execute(...a, client))
          : client.on(ev.name,   (...a) => ev.execute(...a, client));
        console.log(`  📡 Event: ${ev.name}`);
      }

      // named exports (e.g. reactionAdd, reactionRemove in reactionRoles.js)
      for (const [key, ev] of Object.entries(mod)) {
        if (key === 'default' || !ev?.name) continue;
        ev.once
          ? client.once(ev.name, (...a) => ev.execute(...a, client))
          : client.on(ev.name,   (...a) => ev.execute(...a, client));
        console.log(`  📡 Event: ${ev.name} (${key})`);
      }
    } catch (err) {
      console.error(`  ❌ Failed to load event ${file}:`, err.message);
    }
  }
}

async function main() {
  console.log('🚀 Starting SkyBot...');

  await initDb();
  console.log('📦 Database ready');

  console.log('🎵 Music Player ready (yt-dlp)');

  await loadCommands(path.join(__dirname, 'commands'));
  await loadEvents(path.join(__dirname, 'events'));

  await client.login(process.env.DISCORD_TOKEN);

  client.once('ready', async () => {
    console.log(`\n✅ SkyBot online as ${client.user.tag}`);
    console.log(`📊 Serving ${client.guilds.cache.size} server(s)`);

    // Restore giveaway timers
    try {
      const { scheduleGiveaway } = await import('./commands/Giveaway/giveaway.js');
      const { getDb } = await import('./utils/db.js');
      const db = getDb();
      let restored = 0;
      for (const [guildId, gws] of Object.entries(db.data.giveaways ?? {})) {
        for (const [msgId, gw] of Object.entries(gws)) {
          if (!gw.ended && gw.endsAt > Date.now()) {
            scheduleGiveaway(client, guildId, msgId, gw.endsAt);
            restored++;
          }
        }
      }
      if (restored) console.log(`🎉 Restored ${restored} giveaway(s)`);
    } catch (err) {
      console.error('Failed to restore giveaways:', err.message);
    }

    // Background services
    startAHFlipWatcher(client);
    startAuctionSoldWatcher(client);
    startAHChatBot(client);
    startWebDashboard(client);
    console.log('📡 Background services started');

    client.user.setActivity('Hypixel Skyblock | /info help', { type: 3 });
  });
}

main().catch(err => {
  console.error('💥 Fatal startup error:', err);
  process.exit(1);
});