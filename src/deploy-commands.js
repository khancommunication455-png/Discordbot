/**
 * deploy-commands.js — register slash commands with Discord
 *
 * Usage:
 *   GUILD_ID=your_server_id node src/deploy-commands.js   (instant, dev)
 *   node src/deploy-commands.js                            (global, ~1hr propagation)
 */
import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { readdirSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

if (!TOKEN || !CLIENT_ID) {
  console.error('❌ Missing DISCORD_TOKEN or CLIENT_ID in environment.');
  process.exit(1);
}

async function loadCommands(dir) {
  const commands = [];
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, item.name);
    if (item.isDirectory()) {
      commands.push(...await loadCommands(fullPath));
    } else if (item.name.endsWith('.js') && !item.name.startsWith('_')) {
      try {
        const mod = await import(pathToFileURL(fullPath).href);
        const cmd = mod.default;
        if (cmd?.data?.toJSON) {
          commands.push(cmd.data.toJSON());
          console.log(`  ✅ /${cmd.data.name}`);
        }
      } catch (err) {
        console.error(`  ❌ Failed to load ${fullPath}:`, err.message);
      }
    }
  }
  return commands;
}

async function main() {
  console.log('🚀 Loading commands...');
  const commands = await loadCommands(join(__dirname, 'commands'));
  console.log(`\n📦 Loaded ${commands.length} command(s)`);

  const rest = new REST({ version: '10' }).setToken(TOKEN);

  try {
    if (GUILD_ID) {
      console.log(`\n📤 Registering guild commands in ${GUILD_ID}...`);
      await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
        { body: commands },
      );
      console.log('✅ Guild commands registered (instant).');
    } else {
      console.log('\n📤 Registering global commands (takes ~1 hour to propagate)...');
      await rest.put(
        Routes.applicationCommands(CLIENT_ID),
        { body: commands },
      );
      console.log('✅ Global commands registered.');
    }
  } catch (err) {
    console.error('❌ Failed to register commands:', err.response?.data || err.message);
    process.exit(1);
  }
}

main();
