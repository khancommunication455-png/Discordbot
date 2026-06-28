/**
 * role.js — SkyBot v2 Role management command
 *
 * Ported from SkyBot v1 (Discordbot-main/src/commands/Utility/role.js).
 * Adapted for v2 SkyBot footer, cooldown: 3, and flat-db access.
 *
 * Subcommands:
 *   /role add    <user> <role>   — add a role to a member
 *   /role remove <user> <role>   — remove a role from a member
 *   /role info   <role>          — show info about a role
 *   /role all    <role>          — give a role to every member of the server
 */
import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { successEmbed, errorEmbed, C } from '../../utils/embeds.js';

const FOOTER = { text: 'SkyBot v2 • Railway Edition' };

export default {
  cooldown: 3,

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

    // ── ADD ────────────────────────────────────────────────────────────
    if (sub === 'add') {
      const member = interaction.options.getMember('user');
      const role   = interaction.options.getRole('role');
      if (!member) return interaction.reply({ embeds: [errorEmbed('Not Found', 'That member is not in this server.')], flags: [64] });
      try {
        await member.roles.add(role);
        return interaction.reply({ embeds: [successEmbed('Role Added', `${role} added to ${member}.`)] });
      } catch (err) {
        return interaction.reply({ embeds: [errorEmbed('Add Failed', err.message)], flags: [64] });
      }
    }

    // ── REMOVE ─────────────────────────────────────────────────────────
    if (sub === 'remove') {
      const member = interaction.options.getMember('user');
      const role   = interaction.options.getRole('role');
      if (!member) return interaction.reply({ embeds: [errorEmbed('Not Found', 'That member is not in this server.')], flags: [64] });
      try {
        await member.roles.remove(role);
        return interaction.reply({ embeds: [successEmbed('Role Removed', `${role} removed from ${member}.`)] });
      } catch (err) {
        return interaction.reply({ embeds: [errorEmbed('Remove Failed', err.message)], flags: [64] });
      }
    }

    // ── INFO ───────────────────────────────────────────────────────────
    if (sub === 'info') {
      const role = interaction.options.getRole('role');
      // role.members requires the role cache to be populated; fetch safely.
      let memberCount = 0;
      try { memberCount = role.members.size; } catch {}
      const embed = new EmbedBuilder()
        .setColor(role.color || C.info)
        .setTitle(`Role: ${role.name}`)
        .addFields(
          { name: 'ID',          value: role.id,                                inline: true },
          { name: 'Color',       value: role.hexColor,                          inline: true },
          { name: 'Mentionable', value: role.mentionable ? 'Yes' : 'No',        inline: true },
          { name: 'Hoisted',     value: role.hoist ? 'Yes' : 'No',              inline: true },
          { name: 'Members',     value: `${memberCount}`,                       inline: true },
          { name: 'Position',    value: `${role.position}`,                     inline: true },
          { name: 'Created',     value: `<t:${Math.floor(role.createdTimestamp / 1000)}:D>`, inline: true },
        )
        .setFooter(FOOTER)
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }

    // ── ALL ────────────────────────────────────────────────────────────
    if (sub === 'all') {
      const role = interaction.options.getRole('role');
      await interaction.deferReply();
      try {
        const members = await interaction.guild.members.fetch();
        let count = 0;
        for (const [, member] of members) {
          if (!member.roles.cache.has(role.id)) {
            await member.roles.add(role).catch(() => {});
            count++;
          }
        }
        return interaction.editReply({ embeds: [successEmbed('Mass Role', `Gave ${role} to **${count}** members.`)] });
      } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed('Mass Role Failed', err.message)] });
      }
    }
  },
};
