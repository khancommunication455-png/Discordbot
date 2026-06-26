/**
 * deploy-commands.js
 * Run once: `node src/deploy-commands.js`
 * Registers all slash commands to Discord (globally or guild-only).
 */
import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { readdirSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const commands  = [];

async function loadCommands(dir) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      await loadCommands(fullPath);
    } else if (item.name.endsWith('.js') && !item.name.startsWith('_')) {
      const mod = await import(pathToFileURL(fullPath).href);
      const cmd = mod.default;
      if (cmd?.data) {
        commands.push(cmd.data.toJSON());
        console.log(`  📋 Queued: /${cmd.data.name}`);
      }
    }
  }
}

await loadCommands(path.join(__dirname, 'commands'));

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

try {
  console.log(`\n🚀 Registering ${commands.length} slash commands...`);

  const target = process.env.GUILD_ID
    ? Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID)
    : Routes.applicationCommands(process.env.CLIENT_ID);

  const scope = process.env.GUILD_ID ? `guild ${process.env.GUILD_ID}` : 'global';

  await rest.put(target, { body: commands });
  console.log(`✅ Successfully registered to ${scope}!`);
  console.log('ℹ️  Guild commands appear instantly. Global commands take up to 1 hour.');
} catch (err) {
  console.error('❌ Deploy failed:', err);
}
