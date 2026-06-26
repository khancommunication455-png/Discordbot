import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { getDb, saveDb } from '../../utils/db.js';
import { successEmbed, errorEmbed } from '../../utils/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('reactionroles')
    .setDescription('Reaction role system')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand(s => s
      .setName('add')
      .setDescription('Add a reaction role to a message')
      .addStringOption(o => o.setName('message_id').setDescription('Message ID').setRequired(true))
      .addStringOption(o => o.setName('emoji').setDescription('Emoji to react with').setRequired(true))
      .addRoleOption(o => o.setName('role').setDescription('Role to assign').setRequired(true))
    )
    .addSubcommand(s => s
      .setName('remove')
      .setDescription('Remove a reaction role')
      .addStringOption(o => o.setName('message_id').setDescription('Message ID').setRequired(true))
      .addStringOption(o => o.setName('emoji').setDescription('Emoji to remove').setRequired(true))
    )
    .addSubcommand(s => s
      .setName('list')
      .setDescription('List all reaction roles in this server')
    ),

  async execute(interaction, client) {
    const sub     = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const db      = getDb();
    if (!db.data.reactionRoles[guildId]) db.data.reactionRoles[guildId] = {};

    if (sub === 'add') {
      const msgId = interaction.options.getString('message_id');
      const emoji = interaction.options.getString('emoji').trim();
      const role  = interaction.options.getRole('role');

      // Verify message exists
      const msg = await interaction.channel.messages.fetch(msgId).catch(() => null);
      if (!msg) return interaction.reply({ embeds: [errorEmbed('Not Found', 'Message not found in this channel.')], ephemeral: true });

      if (!db.data.reactionRoles[guildId][msgId]) db.data.reactionRoles[guildId][msgId] = {};
      db.data.reactionRoles[guildId][msgId][emoji] = role.id;
      await saveDb();
      await msg.react(emoji).catch(() => {});
      return interaction.reply({ embeds: [successEmbed('Reaction Role Added', `Reacting with ${emoji} on that message will assign ${role}.`)] });
    }

    if (sub === 'remove') {
      const msgId = interaction.options.getString('message_id');
      const emoji = interaction.options.getString('emoji').trim();
      if (db.data.reactionRoles[guildId][msgId]) {
        delete db.data.reactionRoles[guildId][msgId][emoji];
        await saveDb();
      }
      return interaction.reply({ embeds: [successEmbed('Removed', 'Reaction role removed.')] });
    }

    if (sub === 'list') {
      const all = db.data.reactionRoles[guildId];
      const lines = [];
      for (const [msgId, emojis] of Object.entries(all)) {
        for (const [emoji, roleId] of Object.entries(emojis)) {
          lines.push(`Message \`${msgId}\` — ${emoji} → <@&${roleId}>`);
        }
      }
      if (!lines.length) return interaction.reply({ embeds: [errorEmbed('None', 'No reaction roles set up.')] });
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('🎭 Reaction Roles').setDescription(lines.join('\n')).setTimestamp()],
      });
    }
  },
};
