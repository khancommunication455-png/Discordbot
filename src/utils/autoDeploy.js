/**
 * autoDeploy.js — Auto-register slash commands on bot ready
 *
 * Called on the 'ready' event. Registers all slash commands globally
 * (takes ~1hr to propagate) or to a specific guild if GUILD_ID is set
 * (instant — for testing).
 *
 * Idempotent: tracks registration in db.firstRun so we don't spam Discord's
 * API on every restart. Re-registers if the command count changes.
 *
 * This makes the bot work on FIRST Railway deploy — no manual
 * `npm run deploy` needed.
 */
import { REST, Routes } from 'discord.js';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { readdirSync } from 'fs';
import { getDb, saveDb } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Load all slash command definitions from src/commands/.
 * @returns {Promise<Array>} Array of command JSON objects
 */
async function loadCommandJSON() {
  const commands = [];
  async function walk(dir) {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, item.name);
      if (item.isDirectory()) {
        await walk(fullPath);
      } else if (item.name.endsWith('.js') && !item.name.startsWith('_')) {
        try {
          const mod = await import(pathToFileURL(fullPath).href);
          const cmd = mod.default;
          if (cmd?.data?.toJSON) {
            commands.push(cmd.data.toJSON());
          }
        } catch (err) {
          console.warn(`[AutoDeploy] Could not load ${fullPath}:`, err.message);
        }
      }
    }
  }
  await walk(join(__dirname, '..', 'commands'));
  return commands;
}

/**
 * Auto-register slash commands with Discord.
 * Called on bot ready. Skips if already registered (unless force=true).
 *
 * @param {import('discord.js').Client} client
 * @param {boolean} [force=false]  Force re-registration even if already done
 * @returns {Promise<{ok: boolean, count: number, scope: string, error?: string}>}
 */
export async function autoDeployCommands(client, force = false) {
  const TOKEN = process.env.DISCORD_TOKEN;
  const CLIENT_ID = process.env.CLIENT_ID;
  const GUILD_ID = process.env.GUILD_ID;

  if (!TOKEN || !CLIENT_ID) {
    return { ok: false, count: 0, scope: 'none', error: 'DISCORD_TOKEN or CLIENT_ID missing' };
  }

  const db = getDb();
  if (!db.firstRun) db.firstRun = {};
  const prev = db.firstRun;

  try {
    const commands = await loadCommandJSON();
    console.log(`[AutoDeploy] Loaded ${commands.length} command(s) to register`);

    // Skip if already registered with same count (unless forced)
    if (!force && prev.commandsRegistered && prev.commandCount === commands.length) {
      console.log(`[AutoDeploy] Already registered ${commands.length} commands — skipping (force=${force})`);
      return { ok: true, count: commands.length, scope: prev.deployScope || 'global' };
    }

    const rest = new REST({ version: '10' }).setToken(TOKEN);

    if (GUILD_ID) {
      // Guild registration — instant
      console.log(`[AutoDeploy] Registering ${commands.length} commands to guild ${GUILD_ID}...`);
      await rest.put(
        Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
        { body: commands },
      );
      console.log(`[AutoDeploy] ✅ Guild commands registered (instant)`);
      db.firstRun = {
        commandsRegistered: true,
        commandCount: commands.length,
        commandsRegisteredAt: Date.now(),
        deployScope: 'guild',
        welcomePosted: prev.welcomePosted ?? false,
        welcomePostedAt: prev.welcomePostedAt ?? null,
      };
      await saveDb();
      return { ok: true, count: commands.length, scope: 'guild' };
    } else {
      // Global registration — takes ~1hr to propagate
      console.log(`[AutoDeploy] Registering ${commands.length} commands globally (takes ~1hr to propagate)...`);
      await rest.put(
        Routes.applicationCommands(CLIENT_ID),
        { body: commands },
      );
      console.log(`[AutoDeploy] ✅ Global commands registered`);
      db.firstRun = {
        commandsRegistered: true,
        commandCount: commands.length,
        commandsRegisteredAt: Date.now(),
        deployScope: 'global',
        welcomePosted: prev.welcomePosted ?? false,
        welcomePostedAt: prev.welcomePostedAt ?? null,
      };
      await saveDb();
      return { ok: true, count: commands.length, scope: 'global' };
    }
  } catch (err) {
    console.error('[AutoDeploy] Failed:', err.response?.data || err.message);
    return { ok: false, count: 0, scope: 'none', error: err.message };
  }
}

/**
 * Get the auto-deploy status for the dashboard.
 * @returns {object}
 */
export function getAutoDeployStatus() {
  const db = getDb();
  return {
    commandsRegistered: db.firstRun?.commandsRegistered ?? false,
    commandCount: db.firstRun?.commandCount ?? 0,
    commandsRegisteredAt: db.firstRun?.commandsRegisteredAt ?? null,
    deployScope: db.firstRun?.deployScope ?? null,
    welcomePosted: db.firstRun?.welcomePosted ?? false,
    welcomePostedAt: db.firstRun?.welcomePostedAt ?? null,
    clientIdSet: !!process.env.CLIENT_ID,
    guildIdSet: !!process.env.GUILD_ID,
  };
}
