import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { getDb, saveDb } from '../../utils/db.js';
import { successEmbed, errorEmbed } from '../../utils/embeds.js';

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
      .addStringOption(o => o.setName('message').setDescription('Message — use {username} {server}').setRequired(true))
    )
    .addSubcommand(s => s
      .setName('autorole')
      .setDescription('Set role(s) to auto-assign on join')
      .addRoleOption(o => o.setName('role').setDescription('Role to auto-assign').setRequired(true))
    )
    .addSubcommand(s => s.setName('disable').setDescription('Disable welcome messages'))
    .addSubcommand(s => s.setName('test').setDescription('Test the welcome message')),

  async execute(interaction, client) {
    const sub     = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const db      = getDb();

    if (sub === 'setup') {
      const channel = interaction.options.getChannel('channel');
      const message = interaction.options.getString('message');
      const ping    = interaction.options.getBoolean('ping') ?? false;
      const image   = interaction.options.getString('image') ?? null;
      db.data.welcomeConfig[guildId] = { channel: channel.id, message, ping, image, enabled: true };
      await saveDb();
      return interaction.reply({ embeds: [successEmbed('Welcome Setup', `Welcome messages → ${channel}\nPreview: *${message.replace('{user}', `@${interaction.user.username}`).replace('{server}', interaction.guild.name).replace('{count}', interaction.guild.memberCount)}*`)] });
    }

    if (sub === 'goodbye') {
      const channel = interaction.options.getChannel('channel');
      const message = interaction.options.getString('message');
      db.data.goodbyeConfig[guildId] = { channel: channel.id, message, enabled: true };
      await saveDb();
      return interaction.reply({ embeds: [successEmbed('Goodbye Setup', `Goodbye messages → ${channel}`)] });
    }

    if (sub === 'autorole') {
      const role = interaction.options.getRole('role');
      if (!db.data.autoRole[guildId]) db.data.autoRole[guildId] = [];
      if (!db.data.autoRole[guildId].includes(role.id)) db.data.autoRole[guildId].push(role.id);
      await saveDb();
      return interaction.reply({ embeds: [successEmbed('Auto Role Set', `${role} will be assigned to new members on join.`)] });
    }

    if (sub === 'disable') {
      if (db.data.welcomeConfig[guildId]) db.data.welcomeConfig[guildId].enabled = false;
      await saveDb();
      return interaction.reply({ embeds: [successEmbed('Disabled', 'Welcome messages disabled.')] });
    }

    if (sub === 'test') {
      const cfg = db.data.welcomeConfig[guildId];
      if (!cfg?.enabled) return interaction.reply({ embeds: [errorEmbed('Not Set Up', 'Use `/welcome setup` first.')] });
      const msg = cfg.message
        .replace('{user}',     `<@${interaction.user.id}>`)
        .replace('{username}', interaction.user.username)
        .replace('{server}',   interaction.guild.name)
        .replace('{count}',    interaction.guild.memberCount);

      const embed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle(`👋 Welcome to ${interaction.guild.name}!`)
        .setDescription(msg)
        .setThumbnail(interaction.user.displayAvatarURL())
        .setTimestamp();
      if (cfg.image) embed.setImage(cfg.image);

      return interaction.reply({
        content: cfg.ping ? `<@${interaction.user.id}>` : undefined,
        embeds: [embed],
      });
    }
  },
};
