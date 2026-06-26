import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { getDb, saveDb } from '../../utils/db.js';
import { successEmbed, errorEmbed, infoEmbed } from '../../utils/embeds.js';
import { EmbedBuilder } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('premium')
    .setDescription('Manage premium users (AH flip pings)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(s => s
      .setName('add')
      .setDescription('Give premium to a user')
      .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
    )
    .addSubcommand(s => s
      .setName('remove')
      .setDescription('Remove premium from a user')
      .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
    )
    .addSubcommand(s => s
      .setName('list')
      .setDescription('List all premium users')
    ),

  async execute(interaction, client) {
    const sub = interaction.options.getSubcommand();
    const db  = getDb();

    if (sub === 'add') {
      const user = interaction.options.getUser('user');
      if (!db.data.premiumUsers.includes(user.id)) {
        db.data.premiumUsers.push(user.id);
        await saveDb();
      }
      // Also assign Discord role if set
      if (process.env.PREMIUM_ROLE_ID) {
        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
        await member?.roles.add(process.env.PREMIUM_ROLE_ID).catch(() => {});
      }
      return interaction.reply({ embeds: [successEmbed('Premium Added', `${user} now has premium access.`)] });
    }

    if (sub === 'remove') {
      const user = interaction.options.getUser('user');
      db.data.premiumUsers = db.data.premiumUsers.filter(id => id !== user.id);
      await saveDb();
      if (process.env.PREMIUM_ROLE_ID) {
        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
        await member?.roles.remove(process.env.PREMIUM_ROLE_ID).catch(() => {});
      }
      return interaction.reply({ embeds: [successEmbed('Premium Removed', `${user} no longer has premium.`)] });
    }

    if (sub === 'list') {
      const users = db.data.premiumUsers;
      if (!users.length) return interaction.reply({ embeds: [infoEmbed('Premium List', 'No premium users yet.')] });
      const list = users.map(id => `<@${id}>`).join('\n');
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0xffd700)
          .setTitle(`⭐ Premium Users (${users.length})`)
          .setDescription(list)
          .setTimestamp()
        ],
      });
    }
  },
};
