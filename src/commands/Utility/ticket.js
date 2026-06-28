/**
 * ticket.js — SkyBot v2 Ticket system command
 *
 * Ported from SkyBot v1 (Discordbot-main/src/commands/Utility/ticket.js).
 * Adapted for v2 SkyBot footer, cooldown: 3, flat db (db.ticketCount),
 * and distributed handleButton hook (the v2 interactionCreate.js
 * dispatcher calls handleButton on every command until one claims it).
 *
 * Subcommands:
 *   /ticket setup [channel] [title] [description]   — post the ticket panel
 *   /ticket close                                   — close the current ticket channel
 *   /ticket add    <user>                           — add a user to the current ticket
 *   /ticket remove <user>                           — remove a user from the current ticket
 *
 * Button flow:
 *   ticket_create  → creates a private channel `ticket-<n>` for the clicker,
 *                    visible only to them + staff (ManageChannels permission).
 *                    Posts a "Close Ticket" button (ticket_close) inside.
 *   ticket_close   → posts a 5-second warning then deletes the channel.
 *
 * db.ticketCount is a single global counter (per v1 convention).
 */
import {
  SlashCommandBuilder, PermissionFlagsBits, ChannelType,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
} from 'discord.js';
import { getDb, saveDb } from '../../utils/db.js';
import { successEmbed, errorEmbed, C } from '../../utils/embeds.js';

const FOOTER = { text: 'SkyBot v2 • Railway Edition' };

export default {
  cooldown: 3,

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

    // ── SETUP ──────────────────────────────────────────────────────────
    if (sub === 'setup') {
      const channel = interaction.options.getChannel('channel');
      const title   = interaction.options.getString('title') ?? '🎫 Support Tickets';
      const desc    = interaction.options.getString('description') ??
        'Click the button below to open a support ticket.\nOur team will assist you shortly.';

      const embed = new EmbedBuilder()
        .setColor(C.info)
        .setTitle(title)
        .setDescription(desc)
        .setFooter(FOOTER)
        .setTimestamp();

      const btn = new ButtonBuilder()
        .setCustomId('ticket_create')
        .setLabel('Open Ticket')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🎫');

      await channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(btn)] });
      return interaction.reply({ embeds: [successEmbed('Panel Sent', `Ticket panel sent to ${channel}.`)], flags: [64] });
    }

    // ── CLOSE ──────────────────────────────────────────────────────────
    if (sub === 'close') {
      const isTicket = (interaction.channel.name ?? '').startsWith('ticket-');
      if (!isTicket) {
        return interaction.reply({ embeds: [errorEmbed('Not a Ticket', 'Run this in a ticket channel.')], flags: [64] });
      }

      const closeEmbed = new EmbedBuilder()
        .setColor(C.error)
        .setTitle('🔒 Ticket Closing')
        .setDescription('This ticket will be deleted in **5 seconds**.')
        .setFooter(FOOTER)
        .setTimestamp();

      await interaction.reply({ embeds: [closeEmbed] });
      setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
      return;
    }

    // ── ADD ────────────────────────────────────────────────────────────
    if (sub === 'add') {
      const user = interaction.options.getUser('user');
      await interaction.channel.permissionOverwrites.edit(user, { ViewChannel: true, SendMessages: true });
      return interaction.reply({ embeds: [successEmbed('User Added', `${user} can now see this ticket.`)] });
    }

    // ── REMOVE ─────────────────────────────────────────────────────────
    if (sub === 'remove') {
      const user = interaction.options.getUser('user');
      await interaction.channel.permissionOverwrites.edit(user, { ViewChannel: false });
      return interaction.reply({ embeds: [successEmbed('User Removed', `${user} can no longer see this ticket.`)] });
    }
  },

  // ── Button dispatcher hook ───────────────────────────────────────────
  // Called by v2 interactionCreate.js for every button click. Must return
  // true if this command claimed the interaction.
  async handleButton(interaction, client) {
    const id = interaction.customId;
    if (id !== 'ticket_create' && id !== 'ticket_close') return false;

    // ── OPEN TICKET ────────────────────────────────────────────────────
    if (id === 'ticket_create') {
      await interaction.deferReply({ flags: [64] });

      const db = getDb();
      if (typeof db.ticketCount !== 'number' || isNaN(db.ticketCount)) db.ticketCount = 0;
      db.ticketCount = (db.ticketCount || 0) + 1;
      const ticketNum = db.ticketCount;
      await saveDb();

      const guild = interaction.guild;
      const opener = interaction.user;

      try {
        const channel = await guild.channels.create({
          name: `ticket-${ticketNum}`,
          type: ChannelType.GuildText,
          parent: interaction.channel?.parentId ?? null,
          permissionOverwrites: [
            { id: guild.roles.everyone, deny: ['ViewChannel'] },
            { id: opener.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'AttachFiles'] },
            // Allow any member with ManageChannels (staff) to see the ticket
            ...(interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)
              ? [{ id: interaction.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] }]
              : []),
          ],
        });

        // Ensure staff (ManageChannels) can see — apply via role override on @everyone is already denied,
        // admins/managers inherit ViewChannel by default if they have Administrator or ManageChannels.
        const openEmbed = new EmbedBuilder()
          .setColor(C.info)
          .setTitle(`🎫 Ticket #${ticketNum}`)
          .setDescription(`Hello ${opener},\n\nPlease describe your issue and a staff member will assist you shortly.`)
          .addFields(
            { name: 'Opened By', value: `${opener.tag}\n\`${opener.id}\``, inline: true },
            { name: 'Channel',   value: `<#${channel.id}>`,                inline: true },
          )
          .setFooter(FOOTER)
          .setTimestamp();

        const closeBtn = new ButtonBuilder()
          .setCustomId('ticket_close')
          .setLabel('Close Ticket')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('🔒');

        await channel.send({
          content: `${opener}`,
          embeds: [openEmbed],
          components: [new ActionRowBuilder().addComponents(closeBtn)],
        });

        await interaction.editReply({ embeds: [successEmbed('Ticket Opened', `Your ticket has been created: ${channel}`)] });
      } catch (err) {
        await interaction.editReply({ embeds: [errorEmbed('Ticket Failed', `Could not create ticket channel: ${err.message}`)] });
      }
      return true;
    }

    // ── CLOSE TICKET ───────────────────────────────────────────────────
    if (id === 'ticket_close') {
      const isTicket = (interaction.channel.name ?? '').startsWith('ticket-');
      if (!isTicket) {
        await interaction.reply({ embeds: [errorEmbed('Not a Ticket', 'This button only works in a ticket channel.')], flags: [64] });
        return true;
      }
      const closeEmbed = new EmbedBuilder()
        .setColor(C.error)
        .setTitle('🔒 Ticket Closing')
        .setDescription('This ticket will be deleted in **5 seconds**.')
        .setFooter(FOOTER)
        .setTimestamp();
      await interaction.reply({ embeds: [closeEmbed] });
      setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
      return true;
    }

    return false;
  },
};
