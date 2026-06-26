import { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, PermissionFlagsBits } from 'discord.js';
import { getDb, saveDb } from '../../utils/db.js';
import { successEmbed, errorEmbed } from '../../utils/embeds.js';
import { parseDuration, formatDuration } from '../../utils/economy.js';

// In-memory timers: guildId+msgId → timeout
const giveawayTimers = new Map();

async function pickWinners(message, count, giveaway) {
  // Fetch reactions
  const reaction = message.reactions.cache.get('🎉');
  if (!reaction) return [];
  const users = await reaction.users.fetch();
  const eligible = users.filter(u => !u.bot).map(u => u.id);
  if (!eligible.length) return [];
  const shuffled = eligible.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

async function endGiveaway(client, guildId, msgId) {
  const db = getDb();
  const gw = db.data.giveaways[guildId]?.[msgId];
  if (!gw || gw.ended) return;
  gw.ended = true;
  await saveDb();

  try {
    const channel = await client.channels.fetch(gw.channelId);
    const message = await channel.messages.fetch(msgId);
    const winners = await pickWinners(message, gw.winnerCount, gw);

    const embed = new EmbedBuilder()
      .setColor(winners.length ? 0x57f287 : 0xed4245)
      .setTitle(`🎉 Giveaway Ended — ${gw.prize}`)
      .setDescription(
        winners.length
          ? `**Winner(s):** ${winners.map(id => `<@${id}>`).join(', ')}\nHosted by <@${gw.hostId}>`
          : `No valid winners. Hosted by <@${gw.hostId}>`
      )
      .setTimestamp();

    await message.edit({ embeds: [embed], components: [] });
    if (winners.length) {
      await channel.send({ content: `🎉 Congratulations ${winners.map(id => `<@${id}>`).join(', ')}! You won **${gw.prize}**!` });
    }
    gw.winners = winners;
    await saveDb();
  } catch (err) {
    console.error('[Giveaway] End error:', err.message);
  }
}

export function scheduleGiveaway(client, guildId, msgId, endsAt) {
  const delay = endsAt - Date.now();
  if (delay <= 0) {
    endGiveaway(client, guildId, msgId);
    return;
  }
  const timer = setTimeout(() => endGiveaway(client, guildId, msgId), delay);
  giveawayTimers.set(`${guildId}_${msgId}`, timer);
}

export default {
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Giveaway system')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s
      .setName('create')
      .setDescription('Create a giveaway')
      .addStringOption(o => o.setName('prize').setDescription('Prize').setRequired(true))
      .addStringOption(o => o.setName('duration').setDescription('Duration e.g. 1h, 30m, 5d').setRequired(true))
      .addIntegerOption(o => o.setName('winners').setDescription('Number of winners').setRequired(true).setMinValue(1).setMaxValue(10))
      .addChannelOption(o => o.setName('channel').setDescription('Channel (default: current)').setRequired(false))
    )
    .addSubcommand(s => s.setName('end').setDescription('End a giveaway early').addStringOption(o => o.setName('message_id').setDescription('Giveaway message ID').setRequired(true)))
    .addSubcommand(s => s.setName('reroll').setDescription('Reroll a giveaway').addStringOption(o => o.setName('message_id').setDescription('Giveaway message ID').setRequired(true)))
    .addSubcommand(s => s.setName('delete').setDescription('Delete a giveaway').addStringOption(o => o.setName('message_id').setDescription('Giveaway message ID').setRequired(true))),

  async execute(interaction, client) {
    const sub     = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const db      = getDb();
    if (!db.data.giveaways[guildId]) db.data.giveaways[guildId] = {};

    // ── CREATE ────────────────────────────────────────────────────────────
    if (sub === 'create') {
      const prize    = interaction.options.getString('prize');
      const durStr   = interaction.options.getString('duration');
      const winners  = interaction.options.getInteger('winners');
      const channel  = interaction.options.getChannel('channel') ?? interaction.channel;
      const durMs    = parseDuration(durStr);

      if (!durMs || durMs < 10000) return interaction.reply({ embeds: [errorEmbed('Invalid Duration', 'Use format like `10m`, `1h`, `2d`')], ephemeral: true });

      const endsAt = Date.now() + durMs;

      const enterBtn = new ButtonBuilder()
        .setCustomId('giveaway_enter')
        .setLabel('Enter 🎉')
        .setStyle(ButtonStyle.Primary);

      const embed = new EmbedBuilder()
        .setColor(0xffd700)
        .setTitle(`🎉 GIVEAWAY — ${prize}`)
        .setDescription(
          `React with 🎉 or click Enter to participate!\n\n` +
          `**Winners:** ${winners}\n**Ends:** <t:${Math.floor(endsAt / 1000)}:R>\n**Hosted by:** <@${interaction.user.id}>`
        )
        .setTimestamp(new Date(endsAt));

      await interaction.deferReply({ ephemeral: true });
      const msg = await channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(enterBtn)] });
      await msg.react('🎉');

      const giveaway = {
        prize, winnerCount: winners, endsAt,
        hostId: interaction.user.id, channelId: channel.id,
        ended: false, entries: [], winners: [],
      };
      db.data.giveaways[guildId][msg.id] = giveaway;
      await saveDb();
      scheduleGiveaway(client, guildId, msg.id, endsAt);

      await interaction.editReply({ embeds: [successEmbed('Giveaway Created!', `Giveaway for **${prize}** started in ${channel}!`)] });
    }

    // ── END ───────────────────────────────────────────────────────────────
    if (sub === 'end') {
      const msgId = interaction.options.getString('message_id');
      const timer = giveawayTimers.get(`${guildId}_${msgId}`);
      if (timer) clearTimeout(timer);
      await endGiveaway(client, guildId, msgId);
      return interaction.reply({ embeds: [successEmbed('Giveaway Ended', 'The giveaway has been ended early.')], ephemeral: true });
    }

    // ── REROLL ────────────────────────────────────────────────────────────
    if (sub === 'reroll') {
      const msgId = interaction.options.getString('message_id');
      const gw    = db.data.giveaways[guildId]?.[msgId];
      if (!gw?.ended) return interaction.reply({ embeds: [errorEmbed('Not Ended', 'This giveaway has not ended yet.')], ephemeral: true });

      try {
        const channel = await client.channels.fetch(gw.channelId);
        const message = await channel.messages.fetch(msgId);
        const winners = await pickWinners(message, gw.winnerCount, gw);
        if (!winners.length) return interaction.reply({ embeds: [errorEmbed('No Winners', 'No eligible entries found.')] });
        await channel.send({ content: `🎉 New winner(s) for **${gw.prize}**: ${winners.map(id => `<@${id}>`).join(', ')}!` });
        return interaction.reply({ embeds: [successEmbed('Rerolled!', `New winner(s): ${winners.map(id => `<@${id}>`).join(', ')}`)] });
      } catch (err) {
        return interaction.reply({ embeds: [errorEmbed('Error', err.message)] });
      }
    }

    // ── DELETE ────────────────────────────────────────────────────────────
    if (sub === 'delete') {
      const msgId = interaction.options.getString('message_id');
      const timer = giveawayTimers.get(`${guildId}_${msgId}`);
      if (timer) clearTimeout(timer);
      delete db.data.giveaways[guildId][msgId];
      await saveDb();
      try {
        const gw = db.data.giveaways[guildId]?.[msgId];
        if (gw) {
          const ch  = await client.channels.fetch(gw.channelId);
          const msg = await ch.messages.fetch(msgId);
          await msg.delete();
        }
      } catch {}
      return interaction.reply({ embeds: [successEmbed('Deleted', 'Giveaway deleted.')], ephemeral: true });
    }
  },
};
