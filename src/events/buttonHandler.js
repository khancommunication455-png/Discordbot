import { Events, ChannelType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getDb, saveDb } from '../utils/db.js';
import { C } from '../utils/embeds.js';
import { CARRY_TYPES } from '../commands/Carries/carry.js';

const FOOTER = { text: 'TITAN Jr.' };

export default {
  name: Events.InteractionCreate,
  async execute(interaction, client) {
    // ── Select Menus ──────────────────────────────────────────────────
    if (interaction.isStringSelectMenu()) {
      // Carry register
      if (interaction.customId === 'carry_register_select') {
        const db       = getDb();
        const selected = interaction.values;
        if (!db.data.carryProviders) db.data.carryProviders = {};
        db.data.carryProviders[interaction.user.id] = selected;
        await saveDb();

        const guildId    = interaction.guildId;
        const cfg        = db.data.guildConfig?.[guildId];
        const allTypes   = { ...CARRY_TYPES, ...(cfg?.customCarries ?? {}) };
        const typeLabels = selected.map(t => `${allTypes[t]?.emoji ?? ''} **${allTypes[t]?.label ?? t}**`).join('\n');

        return interaction.update({
          embeds: [new EmbedBuilder()
            .setColor(C.success)
            .setTitle('Registration Complete')
            .setDescription(`You are now registered as a carry provider for:\n\n${typeLabels}\n\nYou will be pinged automatically when users request these types.`)
            .setFooter(FOOTER).setTimestamp()
          ],
          components: [],
        });
      }
      return;
    }

    if (!interaction.isButton()) return;
    const { customId } = interaction;

    // ── Carry Request Button (from panel) ─────────────────────────────
    if (customId.startsWith('carry_req_')) {
      const type     = customId.replace('carry_req_', '');
      const db       = getDb();
      const guildId  = interaction.guildId;
      const cfg      = db.data.guildConfig?.[guildId];
      const allTypes = { ...CARRY_TYPES, ...(cfg?.customCarries ?? {}) };
      const info     = allTypes[type];

      if (!info) return interaction.reply({ content: 'Unknown carry type.', flags: [64] });

      await interaction.deferReply({ flags: [64] });

      const providers = db.data.carryProviders ?? {};
      const eligible  = Object.entries(providers)
        .filter(([, types]) => types.includes(type))
        .map(([uid]) => uid);

      const price = cfg?.carryPrices?.[type] ?? info.price ?? '?';

      // Create thread
      let thread;
      try {
        thread = await interaction.channel.threads.create({
          name:                `${info.emoji} ${info.label} · ${interaction.user.username}`,
          autoArchiveDuration: 60,
          type:                ChannelType.PrivateThread,
          reason:              'Carry request',
        });
      } catch {
        try {
          thread = await interaction.channel.threads.create({
            name:                `${info.emoji} ${info.label} · ${interaction.user.username}`,
            autoArchiveDuration: 60,
            reason:              'Carry request',
          });
        } catch (err) {
          return interaction.editReply({
            embeds: [new EmbedBuilder().setColor(C.error).setTitle('Thread Creation Failed').setDescription(`Could not create carry thread: ${err.message}`).setFooter(FOOTER).setTimestamp()],
          });
        }
      }

      await thread.members.add(interaction.user.id).catch(() => {});
      for (const uid of eligible) await thread.members.add(uid).catch(() => {});

      const threadEmbed = new EmbedBuilder()
        .setColor(C.carry)
        .setTitle(`${info.emoji} ${info.label} Carry Request`)
        .setDescription(
          `<@${interaction.user.id}> is looking for a **${info.label}** carry!\n\n` +
          `**How it works:**\n` +
          `1. A provider below will accept your request\n` +
          `2. Coordinate in this thread\n` +
          `3. Complete the carry and make payment\n\u200b`
        )
        .addFields(
          { name: 'Requested by',    value: `<@${interaction.user.id}>`,              inline: true },
          { name: 'Suggested Price', value: `**${price}**`,                           inline: true },
          { name: 'Providers',       value: `${eligible.length} available`,           inline: true },
        )
        .setFooter({ text: 'TITAN Jr. Carry System · Close thread when done' })
        .setTimestamp();

      const acceptBtn = new ButtonBuilder()
        .setCustomId(`carry_accept_${thread.id}`)
        .setLabel('Accept & Carry')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅');

      const closeBtn = new ButtonBuilder()
        .setCustomId(`carry_close_${thread.id}`)
        .setLabel('Close Thread')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🔒');

      await thread.send({
        content: eligible.length
          ? eligible.map(id => `<@${id}>`).join(' ')
          : `No providers registered for **${info.label}** yet.`,
        embeds:     [threadEmbed],
        components: [new ActionRowBuilder().addComponents(acceptBtn, closeBtn)],
      });

      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(C.success)
          .setTitle('Request Created')
          .setDescription(`Your carry thread is ready: ${thread}\n\nProviders have been notified. Please wait for one to respond.`)
          .setFooter(FOOTER).setTimestamp()
        ],
      });
    }

    // ── Carry Accept ──────────────────────────────────────────────────
    if (customId.startsWith('carry_accept_')) {
      const db       = getDb();
      const guildId  = interaction.guildId;
      const providers = db.data.carryProviders ?? {};
      const myTypes  = providers[interaction.user.id] ?? [];

      if (!myTypes.length) {
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(C.error).setTitle('Not a Provider').setDescription('Register as a carry provider first with `/carry register`.').setFooter(FOOTER).setTimestamp()],
          flags: [64],
        });
      }

      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(C.success)
          .setTitle('Carry Accepted')
          .setDescription(`<@${interaction.user.id}> has accepted this carry request!\n\nPlease coordinate with the requester here.`)
          .setFooter(FOOTER).setTimestamp()
        ],
      });
    }

    // ── Carry Close Thread ────────────────────────────────────────────
    if (customId.startsWith('carry_close_')) {
      if (!interaction.channel.isThread()) return;
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(C.info).setTitle('Thread Closing').setDescription('This carry thread will be archived in 5 seconds.').setFooter(FOOTER).setTimestamp()],
      });
      setTimeout(async () => {
        await interaction.channel.setArchived(true).catch(() => {});
      }, 5000);
    }

    // ── Ticket Create ─────────────────────────────────────────────────
    if (customId === 'ticket_create') {
      await interaction.deferReply({ flags: [64] });
      const db = getDb();

      const existing = interaction.guild.channels.cache.find(
        c => c.name === `ticket-${interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '-')}`
      );
      if (existing) {
        return interaction.editReply({ content: `You already have an open ticket: ${existing}` });
      }

      db.data.ticketCount = (db.data.ticketCount ?? 0) + 1;
      await saveDb();

      const { PermissionFlagsBits } = await import('discord.js');
      const ticketChannel = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
        type: ChannelType.GuildText,
        permissionOverwrites: [
          { id: interaction.guild.id,   deny:  [PermissionFlagsBits.ViewChannel] },
          { id: interaction.user.id,    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
          { id: client.user.id,         allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
        ],
      });

      const embed = new EmbedBuilder()
        .setColor(C.info)
        .setTitle(`Ticket #${db.data.ticketCount}`)
        .setDescription(`Hello <@${interaction.user.id}>! Support will be with you shortly.\n\nPlease describe your issue in detail.`)
        .setFooter(FOOTER).setTimestamp();

      const closeBtn = new ButtonBuilder()
        .setCustomId('ticket_close_btn')
        .setLabel('Close Ticket')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🔒');

      await ticketChannel.send({
        content: `<@${interaction.user.id}>`,
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(closeBtn)],
      });

      return interaction.editReply({ content: `✅ Ticket created: ${ticketChannel}` });
    }

    // ── Ticket Close Button ───────────────────────────────────────────
    if (customId === 'ticket_close_btn') {
      if (!interaction.channel.name?.startsWith('ticket-')) return;
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(C.error).setTitle('Closing Ticket').setDescription('This ticket will be deleted in 5 seconds.').setFooter(FOOTER).setTimestamp()],
      });
      setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
    }
  },
};
