/**
 * welcome.js — SkyBot v2 welcome / goodbye / autorole configuration
 *
 * Ported from SkyBot v1 (Discordbot-main/src/commands/Welcome/welcome.js).
 * Adapted for v2 flat db (db.welcomeConfig, db.goodbyeConfig, db.autoRole
 * instead of db.data.xxx) and SkyBot v2 • Railway Edition footer.
 *
 * Subcommands:
 *   /welcome setup [channel] [message] [ping] [image]
 *     Configure the welcome message. Placeholders: {user} {username} {server} {count}
 *
 *   /welcome goodbye [channel] [message]
 *     Configure the goodbye message. Placeholders: {username} {server} {count}
 *
 *   /welcome autorole [role]
 *     Add a role to the auto-assigned-on-join list.
 *
 *   /welcome disable
 *     Disable welcome messages (config preserved).
 *
 *   /welcome test
 *     Render the welcome message in the channel where the command was run.
 */
import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { getDb, saveDb } from '../../utils/db.js';
import { successEmbed, errorEmbed } from '../../utils/embeds.js';

const FOOTER = { text: 'SkyBot v2 • Railway Edition' };

export default {
  data: new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('Welcome, goodbye, and autorole configuration')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s
      .setName('setup')
      .setDescription('Configure welcome messages')
      .addChannelOption(o => o.setName('channel').setDescription('Welcome channel').addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addStringOption(o => o.setName('message').setDescription('Message — use {user} {username} {server} {count}').setRequired(true))
      .addBooleanOption(o => o.setName('ping').setDescription('Ping the user?').setRequired(false))
      .addStringOption(o => o.setName('image').setDescription('Banner image URL').setRequired(false))
    )
    .addSubcommand(s => s
      .setName('goodbye')
      .setDescription('Configure goodbye messages')
      .addChannelOption(o => o.setName('channel').setDescription('Goodbye channel').addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addStringOption(o => o.setName('message').setDescription('Message — use {username} {server} {count}').setRequired(true))
    )
    .addSubcommand(s => s
      .setName('autorole')
      .setDescription('Set role(s) to auto-assign on join')
      .addRoleOption(o => o.setName('role').setDescription('Role to auto-assign').setRequired(true))
    )
    .addSubcommand(s => s.setName('disable').setDescription('Disable welcome messages'))
    .addSubcommand(s => s.setName('test').setDescription('Test the welcome message')),

  cooldown: 3,

  async execute(interaction, client) {
    const sub     = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const db      = getDb();

    // ── SETUP ────────────────────────────────────────────────────────
    if (sub === 'setup') {
      const channel = interaction.options.getChannel('channel');
      const message = interaction.options.getString('message');
      const ping    = interaction.options.getBoolean('ping') ?? false;
      const image   = interaction.options.getString('image') ?? null;

      // Ensure flat-db structure exists
      if (!db.welcomeConfig) db.welcomeConfig = {};
      db.welcomeConfig[guildId] = { channel: channel.id, message, ping, image, enabled: true };
      await saveDb();

      const preview = message
        .replace('{user}',     `<@${interaction.user.id}>`)
        .replace('{username}', interaction.user.username)
        .replace('{server}',   interaction.guild.name)
        .replace('{count}',    String(interaction.guild.memberCount));

      return interaction.reply({
        embeds: [successEmbed(
          'Welcome Setup',
          `Welcome messages → ${channel}\n\n**Preview:**\n${preview}`
        )],
      });
    }

    // ── GOODBYE ──────────────────────────────────────────────────────
    if (sub === 'goodbye') {
      const channel = interaction.options.getChannel('channel');
      const message = interaction.options.getString('message');

      if (!db.goodbyeConfig) db.goodbyeConfig = {};
      db.goodbyeConfig[guildId] = { channel: channel.id, message, enabled: true };
      await saveDb();

      return interaction.reply({
        embeds: [successEmbed('Goodbye Setup', `Goodbye messages → ${channel}`)],
      });
    }

    // ── AUTOROLE ─────────────────────────────────────────────────────
    if (sub === 'autorole') {
      const role = interaction.options.getRole('role');
      if (!db.autoRole)            db.autoRole = {};
      if (!db.autoRole[guildId])   db.autoRole[guildId] = [];
      if (!db.autoRole[guildId].includes(role.id)) db.autoRole[guildId].push(role.id);
      await saveDb();

      return interaction.reply({
        embeds: [successEmbed('Auto Role Set', `${role} will be assigned to new members on join.`)],
      });
    }

    // ── DISABLE ──────────────────────────────────────────────────────
    if (sub === 'disable') {
      if (!db.welcomeConfig) db.welcomeConfig = {};
      if (db.welcomeConfig[guildId]) db.welcomeConfig[guildId].enabled = false;
      await saveDb();
      return interaction.reply({
        embeds: [successEmbed('Disabled', 'Welcome messages disabled.')],
      });
    }

    // ── TEST ─────────────────────────────────────────────────────────
    if (sub === 'test') {
      const cfg = db.welcomeConfig?.[guildId];
      if (!cfg?.enabled) {
        return interaction.reply({
          embeds: [errorEmbed('Not Set Up', 'Use `/welcome setup` first.')],
        });
      }

      const msg = cfg.message
        .replace('{user}',     `<@${interaction.user.id}>`)
        .replace('{username}', interaction.user.username)
        .replace('{server}',   interaction.guild.name)
        .replace('{count}',    String(interaction.guild.memberCount));

      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle(`👋 Welcome to ${interaction.guild.name}!`)
        .setDescription(msg)
        .setThumbnail(interaction.user.displayAvatarURL())
        .setFooter(FOOTER)
        .setTimestamp();
      if (cfg.image) embed.setImage(cfg.image);

      return interaction.reply({
        content: cfg.ping ? `<@${interaction.user.id}>` : undefined,
        embeds:  [embed],
      });
    }
  },
};
