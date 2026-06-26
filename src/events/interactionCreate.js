import { Events } from 'discord.js';
import { errorEmbed } from '../utils/embeds.js';

export default {
  name: Events.InteractionCreate,
  async execute(interaction, client) {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) {
      return interaction.reply({
        embeds: [errorEmbed('Unknown Command', `\`/${interaction.commandName}\` does not exist.`)],
        ephemeral: true,
      }).catch(() => {});
    }

    // Cooldown check
    const { cooldowns } = client;
    if (!cooldowns.has(command.data.name)) cooldowns.set(command.data.name, new Map());
    const now        = Date.now();
    const timestamps = cooldowns.get(command.data.name);
    const cooldown   = (command.cooldown ?? 3) * 1000;

    if (timestamps.has(interaction.user.id)) {
      const exp = timestamps.get(interaction.user.id) + cooldown;
      if (now < exp) {
        const left = ((exp - now) / 1000).toFixed(1);
        return interaction.reply({
          embeds: [errorEmbed('Cooldown', `Wait **${left}s** before using this again.`)],
          ephemeral: true,
        }).catch(() => {});
      }
    }
    timestamps.set(interaction.user.id, now);
    setTimeout(() => timestamps.delete(interaction.user.id), cooldown);

    try {
      // Auto-defer after 2s if command hasn't replied yet
      // This prevents "application did not respond" on slow commands
      let autoDeferred = false;
      const autoDefer = setTimeout(async () => {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.deferReply().catch(() => {});
          autoDeferred = true;
        }
      }, 2000);

      await command.execute(interaction, client);
      clearTimeout(autoDefer);
    } catch (err) {
      console.error(`[Command Error] /${interaction.commandName}:`, err);
      const errPayload = {
        embeds: [errorEmbed('Error', err.message?.slice(0, 200) ?? 'Something went wrong.')],
        ephemeral: true,
      };
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(errPayload);
        } else {
          await interaction.reply(errPayload);
        }
      } catch {}
    }
  },
};
