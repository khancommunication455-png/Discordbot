import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType } from 'discord.js';
import { successEmbed, errorEmbed } from '../../utils/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Admin utility commands')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(s => s
      .setName('announce')
      .setDescription('Send an announcement embed to a channel')
      .addChannelOption(o => o.setName('channel').setDescription('Target channel').setRequired(true).addChannelTypes(ChannelType.GuildText))
      .addStringOption(o => o.setName('title').setDescription('Announcement title').setRequired(true))
      .addStringOption(o => o.setName('message').setDescription('Announcement message').setRequired(true))
      .addStringOption(o => o.setName('color').setDescription('Hex color e.g. #ff0000').setRequired(false))
      .addStringOption(o => o.setName('ping').setDescription('Role to ping (mention)').setRequired(false))
    )
    .addSubcommand(s => s
      .setName('say')
      .setDescription('Make the bot say something in a channel')
      .addChannelOption(o => o.setName('channel').setDescription('Target channel').setRequired(true).addChannelTypes(ChannelType.GuildText))
      .addStringOption(o => o.setName('message').setDescription('Message to send').setRequired(true))
    )
    .addSubcommand(s => s
      .setName('slowmode')
      .setDescription('Set slowmode on a channel')
      .addIntegerOption(o => o.setName('seconds').setDescription('Slowmode in seconds (0 to disable)').setRequired(true).setMinValue(0).setMaxValue(21600))
      .addChannelOption(o => o.setName('channel').setDescription('Target channel (default: current)').setRequired(false))
    )
    .addSubcommand(s => s
      .setName('dm')
      .setDescription('DM a user as the bot')
      .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
      .addStringOption(o => o.setName('message').setDescription('Message to send').setRequired(true))
    ),

  async execute(interaction, client) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'announce') {
      const channel = interaction.options.getChannel('channel');
      const title   = interaction.options.getString('title');
      const message = interaction.options.getString('message');
      const colorHex = interaction.options.getString('color') ?? '#5865f2';
      const ping    = interaction.options.getString('ping') ?? '';
      const color   = parseInt(colorHex.replace('#', ''), 16) || 0x5865f2;

      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`📢 ${title}`)
        .setDescription(message)
        .setFooter({ text: `Announced by ${interaction.user.tag}` })
        .setTimestamp();

      await channel.send({ content: ping || undefined, embeds: [embed] });
      return interaction.reply({ embeds: [successEmbed('Announced', `Message sent to ${channel}.`)], ephemeral: true });
    }

    if (sub === 'say') {
      const channel = interaction.options.getChannel('channel');
      const msg     = interaction.options.getString('message');
      await channel.send(msg);
      return interaction.reply({ embeds: [successEmbed('Sent', `Message sent to ${channel}.`)], ephemeral: true });
    }

    if (sub === 'slowmode') {
      const seconds = interaction.options.getInteger('seconds');
      const channel = interaction.options.getChannel('channel') ?? interaction.channel;
      await channel.setRateLimitPerUser(seconds);
      return interaction.reply({ embeds: [successEmbed('Slowmode', `${channel} slowmode set to **${seconds}s**.`)], ephemeral: true });
    }

    if (sub === 'dm') {
      const user = interaction.options.getUser('user');
      const msg  = interaction.options.getString('message');
      try {
        await user.send(msg);
        return interaction.reply({ embeds: [successEmbed('DM Sent', `Message sent to ${user.tag}.`)], ephemeral: true });
      } catch {
        return interaction.reply({ embeds: [errorEmbed('DM Failed', `Could not DM ${user.tag}. They may have DMs closed.`)], ephemeral: true });
      }
    }
  },
};
