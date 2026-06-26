import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getDb, saveDb } from '../../utils/db.js';
import { successEmbed, errorEmbed, warningEmbed } from '../../utils/embeds.js';
import { randomUUID } from 'crypto';

export default {
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
    if (!db.data.warnings[guildId])  db.data.warnings[guildId]  = {};
    if (!db.data.userNotes[guildId]) db.data.userNotes[guildId] = {};

    // ── ADD WARNING ───────────────────────────────────────────────────────
    if (sub === 'add') {
      const user   = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason');
      const id     = randomUUID().slice(0, 8).toUpperCase();
      if (!db.data.warnings[guildId][user.id]) db.data.warnings[guildId][user.id] = [];

      db.data.warnings[guildId][user.id].push({
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
          new EmbedBuilder().setColor(0xfee75c)
            .setTitle('⚠️ Warning Issued')
            .addFields(
              { name: 'User',   value: `${user.tag} (${user.id})`,            inline: true },
              { name: 'Mod',    value: interaction.user.tag,                   inline: true },
              { name: 'Reason', value: reason,                                 inline: false },
              { name: 'Case',   value: `\`${id}\``,                           inline: true },
              { name: 'Total',  value: `${db.data.warnings[guildId][user.id].length}`, inline: true },
            ).setTimestamp()
        ]});
      }

      return interaction.reply({ embeds: [warningEmbed('Warning Issued', `**${user.tag}** has been warned.\n**Reason:** ${reason}\n**Case ID:** \`${id}\``)] });
    }

    // ── LIST WARNINGS ─────────────────────────────────────────────────────
    if (sub === 'list') {
      const user  = interaction.options.getUser('user');
      const warns = db.data.warnings[guildId][user.id] ?? [];
      if (!warns.length) return interaction.reply({ embeds: [successEmbed('No Warnings', `**${user.tag}** has no warnings.`)] });

      const fields = warns.map(w => ({
        name:  `Case \`${w.id}\` — <t:${Math.floor(w.ts / 1000)}:D>`,
        value: `**Reason:** ${w.reason}\n**Mod:** <@${w.mod}>`,
        inline: false,
      }));

      const embed = new EmbedBuilder()
        .setColor(0xfee75c)
        .setTitle(`⚠️ Warnings for ${user.tag} (${warns.length})`)
        .setThumbnail(user.displayAvatarURL())
        .addFields(fields)
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    // ── DELETE WARNING ────────────────────────────────────────────────────
    if (sub === 'delete') {
      const user   = interaction.options.getUser('user');
      const warnId = interaction.options.getString('id').toUpperCase();
      const warns  = db.data.warnings[guildId][user.id] ?? [];
      const before = warns.length;
      db.data.warnings[guildId][user.id] = warns.filter(w => w.id !== warnId);
      await saveDb();
      if (db.data.warnings[guildId][user.id].length === before) {
        return interaction.reply({ embeds: [errorEmbed('Not Found', `No warning with ID \`${warnId}\` found.`)] });
      }
      return interaction.reply({ embeds: [successEmbed('Warning Deleted', `Removed warning \`${warnId}\` from **${user.tag}**.`)] });
    }

    // ── CLEAR ─────────────────────────────────────────────────────────────
    if (sub === 'clear') {
      const user = interaction.options.getUser('user');
      db.data.warnings[guildId][user.id] = [];
      await saveDb();
      return interaction.reply({ embeds: [successEmbed('Cleared', `All warnings cleared for **${user.tag}**.`)] });
    }

    // ── NOTE ──────────────────────────────────────────────────────────────
    if (sub === 'note') {
      const user = interaction.options.getUser('user');
      const note = interaction.options.getString('note');
      if (!db.data.userNotes[guildId][user.id]) db.data.userNotes[guildId][user.id] = [];
      db.data.userNotes[guildId][user.id].push({ note, mod: interaction.user.id, ts: Date.now() });
      await saveDb();
      return interaction.reply({ embeds: [successEmbed('Note Added', `Note saved for **${user.tag}**.`)], ephemeral: true });
    }

    // ── NOTES ─────────────────────────────────────────────────────────────
    if (sub === 'notes') {
      const user  = interaction.options.getUser('user');
      const notes = db.data.userNotes[guildId][user.id] ?? [];
      if (!notes.length) return interaction.reply({ embeds: [successEmbed('No Notes', `No notes for **${user.tag}**.`)], ephemeral: true });
      const fields = notes.map((n, i) => ({
        name:  `Note ${i + 1} — <t:${Math.floor(n.ts / 1000)}:D> by <@${n.mod}>`,
        value: n.note,
        inline: false,
      }));
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`📝 Notes for ${user.tag}`).addFields(fields).setTimestamp()],
        ephemeral: true,
      });
    }
  },
};
