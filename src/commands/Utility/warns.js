/**
 * warns.js — SkyBot v2 Warnings & Notes system
 *
 * Ported from SkyBot v1 (Discordbot-main/src/commands/Utility/warns.js).
 * Adapted for v2 flat db (db.warnings, db.userNotes) and SkyBot footer.
 *
 * Subcommands:
 *   /warns add    <user> <reason>            — issue a warning (DM + log)
 *   /warns list   <user>                     — list a user's warnings
 *   /warns delete <user> <id>                — delete a specific warning by case ID
 *   /warns clear  <user>                     — clear all warnings for a user
 *   /warns note   <user> <note>              — add a private moderator note
 *   /warns notes  <user>                     — view private notes for a user
 *
 * Flat-db schema (db.warnings):
 *   { [guildId]: { [userId]: [{ id, reason, mod, ts }] } }
 * Flat-db schema (db.userNotes):
 *   { [guildId]: { [userId]: [{ note, mod, ts }] } }
 */
import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getDb, saveDb } from '../../utils/db.js';
import { successEmbed, errorEmbed, warningEmbed, C } from '../../utils/embeds.js';
import { randomUUID } from 'crypto';

const FOOTER = { text: 'SkyBot v2 • Railway Edition' };

export default {
  cooldown: 3,

  data: new SlashCommandBuilder()
    .setName('warns')
    .setDescription('Warning and notes system')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand(s => s
      .setName('add')
      .setDescription('Warn a user')
      .addUserOption(o => o.setName('user').setDescription('User to warn').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true))
    )
    .addSubcommand(s => s
      .setName('list')
      .setDescription('List warnings for a user')
      .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
    )
    .addSubcommand(s => s
      .setName('delete')
      .setDescription('Delete a warning by ID')
      .addStringOption(o => o.setName('id').setDescription('Warning ID').setRequired(true))
      .addUserOption(o => o.setName('user').setDescription('User the warning belongs to').setRequired(true))
    )
    .addSubcommand(s => s
      .setName('clear')
      .setDescription('Clear all warnings for a user')
      .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
    )
    .addSubcommand(s => s
      .setName('note')
      .setDescription('Add a private note about a user')
      .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
      .addStringOption(o => o.setName('note').setDescription('Note content').setRequired(true))
    )
    .addSubcommand(s => s
      .setName('notes')
      .setDescription('View notes for a user')
      .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
    ),

  async execute(interaction, client) {
    const sub     = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const db      = getDb();

    if (!db.warnings)             db.warnings = {};
    if (!db.warnings[guildId])    db.warnings[guildId] = {};
    if (!db.userNotes)            db.userNotes = {};
    if (!db.userNotes[guildId])   db.userNotes[guildId] = {};

    // ── ADD WARNING ────────────────────────────────────────────────────
    if (sub === 'add') {
      const user   = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason');
      const id     = randomUUID().slice(0, 8).toUpperCase();
      if (!db.warnings[guildId][user.id]) db.warnings[guildId][user.id] = [];

      db.warnings[guildId][user.id].push({
        id, reason,
        mod: interaction.user.id,
        ts:  Date.now(),
      });
      await saveDb();

      // Try to DM the warned user
      try {
        await user.send({ embeds: [warningEmbed(`Warning from ${interaction.guild.name}`, `**Reason:** ${reason}\n**Case ID:** \`${id}\``)] });
      } catch {}

      // Log to log channel
      const logCh = process.env.LOG_CHANNEL_ID;
      if (logCh) {
        const ch = interaction.guild.channels.cache.get(logCh);
        if (ch) await ch.send({ embeds: [
          new EmbedBuilder().setColor(C.warning)
            .setTitle('⚠️ Warning Issued')
            .addFields(
              { name: 'User',   value: `${user.tag} (${user.id})`,            inline: true  },
              { name: 'Mod',    value: interaction.user.tag,                   inline: true  },
              { name: 'Reason', value: reason,                                 inline: false },
              { name: 'Case',   value: `\`${id}\``,                            inline: true  },
              { name: 'Total',  value: `${db.warnings[guildId][user.id].length}`, inline: true },
            ).setFooter(FOOTER).setTimestamp()
        ]}).catch(() => {});
      }

      return interaction.reply({ embeds: [warningEmbed('Warning Issued', `**${user.tag}** has been warned.\n**Reason:** ${reason}\n**Case ID:** \`${id}\``)] });
    }

    // ── LIST WARNINGS ──────────────────────────────────────────────────
    if (sub === 'list') {
      const user  = interaction.options.getUser('user');
      const warns = db.warnings[guildId][user.id] ?? [];
      if (!warns.length) return interaction.reply({ embeds: [successEmbed('No Warnings', `**${user.tag}** has no warnings.`)] });

      const fields = warns.map(w => ({
        name:  `Case \`${w.id}\` — <t:${Math.floor(w.ts / 1000)}:D>`,
        value: `**Reason:** ${w.reason}\n**Mod:** <@${w.mod}>`,
        inline: false,
      }));

      const embed = new EmbedBuilder()
        .setColor(C.warning)
        .setTitle(`⚠️ Warnings for ${user.tag} (${warns.length})`)
        .setThumbnail(user.displayAvatarURL())
        .addFields(fields)
        .setFooter(FOOTER)
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    // ── DELETE WARNING ─────────────────────────────────────────────────
    if (sub === 'delete') {
      const user   = interaction.options.getUser('user');
      const warnId = interaction.options.getString('id').toUpperCase();
      const warns  = db.warnings[guildId][user.id] ?? [];
      const before = warns.length;
      db.warnings[guildId][user.id] = warns.filter(w => w.id !== warnId);
      await saveDb();
      if (db.warnings[guildId][user.id].length === before) {
        return interaction.reply({ embeds: [errorEmbed('Not Found', `No warning with ID \`${warnId}\` found.`)] });
      }
      return interaction.reply({ embeds: [successEmbed('Warning Deleted', `Removed warning \`${warnId}\` from **${user.tag}**.`)] });
    }

    // ── CLEAR ──────────────────────────────────────────────────────────
    if (sub === 'clear') {
      const user = interaction.options.getUser('user');
      db.warnings[guildId][user.id] = [];
      await saveDb();
      return interaction.reply({ embeds: [successEmbed('Cleared', `All warnings cleared for **${user.tag}**.`)] });
    }

    // ── NOTE ───────────────────────────────────────────────────────────
    if (sub === 'note') {
      const user = interaction.options.getUser('user');
      const note = interaction.options.getString('note');
      if (!db.userNotes[guildId][user.id]) db.userNotes[guildId][user.id] = [];
      db.userNotes[guildId][user.id].push({ note, mod: interaction.user.id, ts: Date.now() });
      await saveDb();
      return interaction.reply({ embeds: [successEmbed('Note Added', `Note saved for **${user.tag}**.`)], flags: [64] });
    }

    // ── NOTES ──────────────────────────────────────────────────────────
    if (sub === 'notes') {
      const user  = interaction.options.getUser('user');
      const notes = db.userNotes[guildId][user.id] ?? [];
      if (!notes.length) return interaction.reply({ embeds: [successEmbed('No Notes', `No notes for **${user.tag}**.`)], flags: [64] });
      const fields = notes.map((n, i) => ({
        name:  `Note ${i + 1} — <t:${Math.floor(n.ts / 1000)}:D> by <@${n.mod}>`,
        value: n.note,
        inline: false,
      }));
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(C.info).setTitle(`📝 Notes for ${user.tag}`).addFields(fields).setFooter(FOOTER).setTimestamp()],
        flags: [64],
      });
    }
  },
};
