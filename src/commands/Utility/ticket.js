import {
  SlashCommandBuilder, PermissionFlagsBits, ChannelType,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
} from 'discord.js';
import { getDb, saveDb } from '../../utils/db.js';
import { successEmbed, errorEmbed, infoEmbed } from '../../utils/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Ticket system management')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addSubcommand(s => s
      .setName('setup')
      .setDescription('Send the ticket panel to a channel')
      .addChannelOption(o =>
        o.setName('channel').setDescription('Panel channel').setRequired(true)
         .addChannelTypes(ChannelType.GuildText)
      )
      .addStringOption(o => o.setName('title').setDescription('Panel title').setRequired(false))
      .addStringOption(o => o.setName('description').setDescription('Panel description').setRequired(false))
    )
    .addSubcommand(s => s
      .setName('close')
      .setDescription('Close the current ticket channel')
    )
    .addSubcommand(s => s
      .setName('add')
      .setDescription('Add a user to the current ticket')
      .addUserOption(o => o.setName('user').setDescription('User to add').setRequired(true))
    )
    .addSubcommand(s => s
      .setName('remove')
      .setDescription('Remove a user from the current ticket')
      .addUserOption(o => o.setName('user').setDescription('User to remove').setRequired(true))
    ),

  async execute(interaction, client) {
    const sub = interaction.options.getSubcommand();

    // ── SETUP ─────────────────────────────────────────────────────────────
    if (sub === 'setup') {
      const channel = interaction.options.getChannel('channel');
      const title   = interaction.options.getString('title') ?? '🎫 Support Tickets';
      const desc    = interaction.options.getString('description') ??
        'Click the button below to open a support ticket.\nOur team will assist you shortly.';

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(title)
        .setDescription(desc)
        .setFooter({ text: interaction.guild.name })
        .setTimestamp();

      const btn = new ButtonBuilder()
        .setCustomId('ticket_create')
        .setLabel('Open Ticket')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🎫');

      await channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(btn)] });
      await interaction.reply({ embeds: [successEmbed('Panel Sent', `Ticket panel sent to ${channel}.`)], flags: [64] });
    }

    // ── CLOSE ─────────────────────────────────────────────────────────────
    if (sub === 'close') {
      const db = getDb();
      const isTicket = interaction.channel.name.startsWith('ticket-');
      if (!isTicket) {
        return interaction.reply({ embeds: [errorEmbed('Not a Ticket', 'Run this in a ticket channel.')], flags: [64] });
      }

      const closeEmbed = new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle('🔒 Ticket Closing')
        .setDescription('This ticket will be deleted in **5 seconds**.')
        .setTimestamp();

      await interaction.reply({ embeds: [closeEmbed] });
      setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
    }

    // ── ADD ───────────────────────────────────────────────────────────────
    if (sub === 'add') {
      const user = interaction.options.getUser('user');
      await interaction.channel.permissionOverwrites.edit(user, { ViewChannel: true, SendMessages: true });
      await interaction.reply({ embeds: [successEmbed('User Added', `${user} can now see this ticket.`)] });
    }

    // ── REMOVE ────────────────────────────────────────────────────────────
    if (sub === 'remove') {
      const user = interaction.options.getUser('user');
      await interaction.channel.permissionOverwrites.edit(user, { ViewChannel: false });
      await interaction.reply({ embeds: [successEmbed('User Removed', `${user} can no longer see this ticket.`)] });
    }
  },
};
