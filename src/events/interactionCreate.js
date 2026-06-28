/**
 * interactionCreate.js — slash command dispatcher with cooldowns
 *
 * Handles 4 interaction types:
 *   1. Autocomplete → command.autocomplete(interaction, client)
 *   2. ChatInputCommand → command.execute(interaction, client) (with cooldowns)
 *   3. Button click → first command whose handleButton() returns true wins
 *   4. String select menu → first command whose handleSelectMenu() returns true wins
 *
 * Buttons/selects are dispatched by iterating all loaded commands and calling
 * their optional handleButton/handleSelectMenu hooks (must return truthy if
 * the interaction was claimed). This lets commands own their component
 * interactions without a centralized handler.
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

    // ── Button clicks (e.g. carry panel buttons, partyfinder Join Party) ──
    if (interaction.isButton()) {
      for (const command of client.commands.values()) {
        if (typeof command.handleButton !== 'function') continue;
        try {
          const claimed = await command.handleButton(interaction, client);
          if (claimed) return;
        } catch (err) {
          console.error(`[Button] /${command.data?.name ?? '?'} error:`, err);
          // Don't return — let other handlers try
        }
      }
      // Fall through: unhandled button — silently ignore (or could log)
      return;
    }

    // ── String select menus (e.g. /carry register) ──
    if (interaction.isStringSelectMenu()) {
      for (const command of client.commands.values()) {
        if (typeof command.handleSelectMenu !== 'function') continue;
        try {
          const claimed = await command.handleSelectMenu(interaction, client);
          if (claimed) return;
        } catch (err) {
          console.error(`[SelectMenu] /${command.data?.name ?? '?'} error:`, err);
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
          content: `⏱️ Please wait **${left}s** before using \`${command.data.name}\` again.`,
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
