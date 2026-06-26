import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { successEmbed, errorEmbed } from '../../utils/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('role')
    .setDescription('Role management commands')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand(s => s
      .setName('add')
      .setDescription('Add a role to a member')
      .addUserOption(o => o.setName('user').setDescription('Target member').setRequired(true))
      .addRoleOption(o => o.setName('role').setDescription('Role to add').setRequired(true))
    )
    .addSubcommand(s => s
      .setName('remove')
      .setDescription('Remove a role from a member')
      .addUserOption(o => o.setName('user').setDescription('Target member').setRequired(true))
      .addRoleOption(o => o.setName('role').setDescription('Role to remove').setRequired(true))
    )
    .addSubcommand(s => s
      .setName('info')
      .setDescription('Get info about a role')
      .addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true))
    )
    .addSubcommand(s => s
      .setName('all')
      .setDescription('Give a role to all members (use carefully!)')
      .addRoleOption(o => o.setName('role').setDescription('Role to assign').setRequired(true))
    ),

  async execute(interaction, client) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
      const member = interaction.options.getMember('user');
      const role   = interaction.options.getRole('role');
      await member.roles.add(role);
      return interaction.reply({ embeds: [successEmbed('Role Added', `${role} added to ${member}.`)] });
    }

    if (sub === 'remove') {
      const member = interaction.options.getMember('user');
      const role   = interaction.options.getRole('role');
      await member.roles.remove(role);
      return interaction.reply({ embeds: [successEmbed('Role Removed', `${role} removed from ${member}.`)] });
    }

    if (sub === 'info') {
      const role = interaction.options.getRole('role');
      const { EmbedBuilder } = await import('discord.js');
      const embed = new EmbedBuilder()
        .setColor(role.color || 0x5865f2)
        .setTitle(`Role: ${role.name}`)
        .addFields(
          { name: 'ID',           value: role.id,                              inline: true },
          { name: 'Color',        value: role.hexColor,                        inline: true },
          { name: 'Mentionable', value: role.mentionable ? 'Yes' : 'No',      inline: true },
          { name: 'Hoisted',     value: role.hoist ? 'Yes' : 'No',            inline: true },
          { name: 'Members',     value: `${role.members.size}`,                inline: true },
          { name: 'Position',    value: `${role.position}`,                    inline: true },
          { name: 'Created',     value: `<t:${Math.floor(role.createdTimestamp / 1000)}:D>`, inline: true },
        )
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'all') {
      const role = interaction.options.getRole('role');
      await interaction.deferReply();
      const members = await interaction.guild.members.fetch();
      let count = 0;
      for (const [, member] of members) {
        if (!member.roles.cache.has(role.id)) {
          await member.roles.add(role).catch(() => {});
          count++;
        }
      }
      return interaction.editReply({ embeds: [successEmbed('Mass Role', `Gave ${role} to **${count}** members.`)] });
    }
  },
};
