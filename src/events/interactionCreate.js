/**
 * interactionCreate.js — slash command + button dispatcher
 */
import { Collection } from 'discord.js';

const COOLDOWN_DEFAULT = 3; // seconds

export default {
  name: 'interactionCreate',
  async execute(interaction, client) {
    // ── Autocomplete ──
    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      if (!command || typeof command.autocomplete !== 'function') return;
      try {
        await command.autocomplete(interaction, client);
      } catch (err) {
        console.error(`[Autocomplete] /${interaction.commandName} error:`, err);
      }
      return;
    }

    // ── Button handler ──
    if (interaction.isButton()) {
      // Check services first (ahFlipWatcher copy_ah_ buttons)
      try {
        const { handleButton: flipButton } = await import('../services/ahFlipWatcher.js');
        if (await flipButton(interaction, client)) return;
      } catch {}

      // Check commands with handleButton methods
      for (const command of client.commands.values()) {
        if (typeof command.handleButton === 'function') {
          try {
            if (await command.handleButton(interaction, client)) return;
          } catch (err) {
            console.error('[Button] Error:', err.message);
          }
        }
      }
      return;
    }

    // ── Select menu handler ──
    if (interaction.isStringSelectMenu()) {
      for (const command of client.commands.values()) {
        if (typeof command.handleSelectMenu === 'function') {
          try {
            if (await command.handleSelectMenu(interaction, client)) return;
          } catch (err) {
            console.error('[SelectMenu] Error:', err.message);
          }
        }
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) {
      console.warn(`[Cmd] Unknown command: ${interaction.commandName}`);
      return;
    }

    // Cooldown handling
    const cooldown = command.cooldown ?? COOLDOWN_DEFAULT;
    if (cooldown > 0) {
      if (!client.cooldowns.has(command.data.name)) {
        client.cooldowns.set(command.data.name, new Collection());
      }
      const now = Date.now();
      const timestamps = client.cooldowns.get(command.data.name);
      const expiry = (timestamps.get(interaction.user.id) ?? 0) + cooldown * 1000;
      if (now < expiry) {
        const left = Math.ceil((expiry - now) / 1000);
        return interaction.reply({
          content: `⏱️ Please wait **${left}s** before using \`/${command.data.name}\` again.`,
          ephemeral: true,
        }).catch(() => {});
      }
      timestamps.set(interaction.user.id, now);
      setTimeout(() => timestamps.delete(interaction.user.id), cooldown * 1000);
    }

    try {
      await command.execute(interaction, client);
    } catch (err) {
      console.error(`[Cmd] /${command.data.name} error:`, err);
      const payload = {
        content: `❌ An error occurred while running \`/${command.data.name}\`.`,
        ephemeral: true,
      };
      try {
        if (interaction.deferred) await interaction.editReply(payload);
        else await interaction.reply(payload);
      } catch {}
    }
  },
};
