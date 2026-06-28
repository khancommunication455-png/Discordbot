/**
 * premium.js — SkyBot v2 Premium User Management
 * =================================================================
 *
 * Subcommands: add, remove, list, check
 *
 * Premium users get perks across the bot (extra AH flip pings, daily
 * bonus multiplier, etc.). Membership is stored in flat `db.premiumUsers`
 * (array of Discord IDs) — NOT `db.data.premiumUsers`.
 *
 * Optional `PREMIUM_ROLE_ID` env var: when set, /premium add/remove
 * will also assign/unassign the configured Discord role.
 *
 * Admin-only (ManageGuild). Footer "SkyBot v2 • Railway Edition"; cooldown: 3.
 */
import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { getDb, saveDb } from '../../utils/db.js';
import { successEmbed, errorEmbed, infoEmbed, premiumEmbed, C } from '../../utils/embeds.js';

const FOOTER = { text: 'SkyBot v2 • Railway Edition' };

export default {
  data: new SlashCommandBuilder()
    .setName('premium')
    .setDescription('Manage premium users (AH flip pings, daily bonus, etc.)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s
      .setName('add')
      .setDescription('Give premium to a user')
      .addUserOption((o) => o.setName('user').setDescription('Target user').setRequired(true)))
    .addSubcommand((s) => s
      .setName('remove')
      .setDescription('Remove premium from a user')
      .addUserOption((o) => o.setName('user').setDescription('Target user').setRequired(true)))
    .addSubcommand((s) => s
      .setName('list')
      .setDescription('List all premium users'))
    .addSubcommand((s) => s
      .setName('check')
      .setDescription('Check if a user has premium (defaults to yourself)')
      .addUserOption((o) => o.setName('user').setDescription('User to check').setRequired(false))),

  cooldown: 3,

  async execute(interaction, client) {
    const sub = interaction.options.getSubcommand();
    const db  = getDb();

    // Defensive: ensure flat array exists (deepMerge should handle this, but
    // be safe against hand-edited db.json files).
    if (!Array.isArray(db.premiumUsers)) db.premiumUsers = [];

    // ── ADD ───────────────────────────────────────────────────────
    if (sub === 'add') {
      const user = interaction.options.getUser('user');
      if (db.premiumUsers.includes(user.id)) {
        return interaction.reply({
          embeds: [infoEmbed('Already Premium', `${user} already has premium access.`)],
        });
      }
      db.premiumUsers.push(user.id);
      await saveDb();

      // Assign Discord role if configured
      let roleNote = '';
      if (process.env.PREMIUM_ROLE_ID) {
        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (member) {
          await member.roles.add(process.env.PREMIUM_ROLE_ID).catch(() => {});
          roleNote = '\n📌 Premium role assigned.';
        }
      }

      return interaction.reply({
        embeds: [premiumEmbed(
          '⭐ Premium Added',
          `${user} now has premium access.${roleNote}`,
        )],
      });
    }

    // ── REMOVE ────────────────────────────────────────────────────
    if (sub === 'remove') {
      const user = interaction.options.getUser('user');
      if (!db.premiumUsers.includes(user.id)) {
        return interaction.reply({
          embeds: [infoEmbed('Not Premium', `${user} does not have premium access.`)],
        });
      }
      db.premiumUsers = db.premiumUsers.filter((id) => id !== user.id);
      await saveDb();

      // Remove Discord role if configured
      let roleNote = '';
      if (process.env.PREMIUM_ROLE_ID) {
        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (member) {
          await member.roles.remove(process.env.PREMIUM_ROLE_ID).catch(() => {});
          roleNote = '\n📌 Premium role removed.';
        }
      }

      return interaction.reply({
        embeds: [successEmbed('Premium Removed', `${user} no longer has premium.${roleNote}`)],
      });
    }

    // ── LIST ──────────────────────────────────────────────────────
    if (sub === 'list') {
      const users = db.premiumUsers;
      if (!users.length) {
        return interaction.reply({
          embeds: [infoEmbed('Premium List', 'No premium users yet.\nUse `/premium add @user` to add one.')],
        });
      }
      const list = users.map((id) => `<@${id}>`).join('\n');
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(C.premium)
          .setTitle(`⭐ Premium Users (${users.length})`)
          .setDescription(list)
          .setFooter({ text: `SkyBot v2 • ${users.length} premium member(s)` })
          .setTimestamp()],
      });
    }

    // ── CHECK ─────────────────────────────────────────────────────
    if (sub === 'check') {
      const user = interaction.options.getUser('user') ?? interaction.user;
      const isPremium = db.premiumUsers.includes(user.id);
      return interaction.reply({
        embeds: [isPremium
          ? premiumEmbed('⭐ Premium Active', `${user} **has** premium access.\n\nPerks include:\n• Extra AH flip pings\n• 1.5× daily bonus multiplier\n• Priority command queue`)
          : new EmbedBuilder()
            .setColor(C.info)
            .setTitle('ℹ️ Not Premium')
            .setDescription(`${user} does **not** have premium access.\nAsk an admin to run \`/premium add @${user.username}\`.`)
            .setFooter(FOOTER).setTimestamp()],
        flags: [64],
      });
    }
  },
};
