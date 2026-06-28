/**
 * reactionroles.js — SkyBot v2 Reaction Roles command
 *
 * Ported from SkyBot v1 (Discordbot-main/src/commands/Utility/reactionroles.js).
 * Adapted for v2 flat db (db.reactionRoles), SkyBot footer, and cooldown: 3.
 *
 * Subcommands:
 *   /reactionroles add    <message_id> <emoji> <role>  — bind an emoji on a message to a role
 *   /reactionroles remove <message_id> <emoji>         — remove a reaction role binding
 *   /reactionroles list                                 — list all reaction roles in this server
 *
 * Flat-db schema (db.reactionRoles):
 *   { [guildId]: { [msgId]: { [emojiStr]: roleId } } }
 *
 * Reaction assignment itself is handled by events/reactionRoles.js
 * (reactionAdd + reactionRemove named exports).
 */
import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { getDb, saveDb } from '../../utils/db.js';
import { successEmbed, errorEmbed, C } from '../../utils/embeds.js';

const FOOTER = { text: 'SkyBot v2 • Railway Edition' };

export default {
  cooldown: 3,

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

    if (!db.reactionRoles)            db.reactionRoles = {};
    if (!db.reactionRoles[guildId])   db.reactionRoles[guildId] = {};

    // ── ADD ────────────────────────────────────────────────────────────
    if (sub === 'add') {
      const msgId = interaction.options.getString('message_id');
      const emoji = interaction.options.getString('emoji').trim();
      const role  = interaction.options.getRole('role');

      // Verify message exists in the current channel
      const msg = await interaction.channel.messages.fetch(msgId).catch(() => null);
      if (!msg) return interaction.reply({ embeds: [errorEmbed('Not Found', 'Message not found in this channel.')], flags: [64] });

      if (!db.reactionRoles[guildId][msgId]) db.reactionRoles[guildId][msgId] = {};
      db.reactionRoles[guildId][msgId][emoji] = role.id;
      await saveDb();
      await msg.react(emoji).catch(() => {});
      return interaction.reply({ embeds: [successEmbed('Reaction Role Added', `Reacting with ${emoji} on that message will assign ${role}.`)] });
    }

    // ── REMOVE ─────────────────────────────────────────────────────────
    if (sub === 'remove') {
      const msgId = interaction.options.getString('message_id');
      const emoji = interaction.options.getString('emoji').trim();
      if (db.reactionRoles[guildId][msgId]) {
        delete db.reactionRoles[guildId][msgId][emoji];
        await saveDb();
      }
      return interaction.reply({ embeds: [successEmbed('Removed', 'Reaction role removed.')] });
    }

    // ── LIST ───────────────────────────────────────────────────────────
    if (sub === 'list') {
      const all = db.reactionRoles[guildId];
      const lines = [];
      for (const [msgId, emojis] of Object.entries(all ?? {})) {
        for (const [emoji, roleId] of Object.entries(emojis ?? {})) {
          lines.push(`Message \`${msgId}\` — ${emoji} → <@&${roleId}>`);
        }
      }
      if (!lines.length) return interaction.reply({ embeds: [errorEmbed('None', 'No reaction roles set up.')] });
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(C.info).setTitle('🎭 Reaction Roles').setDescription(lines.join('\n')).setFooter(FOOTER).setTimestamp()],
      });
    }
  },
};
