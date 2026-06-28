/**
 * giveaway.js — SkyBot v2 Giveaway system
 *
 * Ported from SkyBot v1 (Discordbot-main/src/commands/Giveaway/giveaway.js).
 * Adapted for v2 flat db (db.giveaways), button-based participant tracking,
 * SkyBot v2 footer, cooldown: 3.
 *
 * Schema: db.giveaways[guildId][msgId] = {
 *   prize, endsAt, winners (count), channelId, ended,
 *   participants ([userId, ...]), hostId, endedWinners ([userId, ...]),
 * }
 *
 * Exports:
 *   - default                → slash command with start/end/reroll/list/delete
 *   - scheduleGiveaway(...)  → restart timer on bot boot (called from index.js)
 *
 * Button "Enter 🎁" (customId: giveaway_enter) is handled by handleButton()
 * — the v2 interactionCreate dispatcher calls every command's handleButton.
 */
import {
  SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle,
  ActionRowBuilder, PermissionFlagsBits,
} from 'discord.js';
import { getDb, saveDb } from '../../utils/db.js';
import { successEmbed, errorEmbed, warningEmbed, C } from '../../utils/embeds.js';
import { parseDuration, formatDuration } from '../../utils/economy.js';

const FOOTER = { text: 'SkyBot v2 • Railway Edition' };
const ENTER_BTN_ID = 'giveaway_enter';

// In-memory timers: `${guildId}_${msgId}` → timeout
const giveawayTimers = new Map();

function giveawayEmbed(gw) {
  const endsTs = Math.floor((gw.endsAt ?? 0) / 1000);
  const participantCount = (gw.participants ?? []).length;
  const ended = gw.ended;
  const color = ended ? C.success : C.economy;
  const title = ended
    ? `🎉 Giveaway Ended — ${gw.prize}`
    : `🎉 GIVEAWAY — ${gw.prize}`;
  let desc;
  if (ended) {
    const winners = gw.endedWinners ?? [];
    desc = winners.length
      ? `**Winner(s):** ${winners.map(id => `<@${id}>`).join(', ')}\nHosted by <@${gw.hostId}>`
      : `No valid entries. Hosted by <@${gw.hostId}>`;
  } else {
    desc =
      `Click the **Enter** button below to join!\n\n` +
      `**Winners:** ${gw.winners}\n` +
      `**Ends:** <t:${endsTs}:R> (<t:${endsTs}:F>)\n` +
      `**Entries:** ${participantCount}\n` +
      `**Hosted by:** <@${gw.hostId}>`;
  }
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(desc)
    .setFooter(FOOTER)
    .setTimestamp(ended ? null : new Date(gw.endsAt ?? Date.now()));
  return embed;
}

function enterButton(ended = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(ENTER_BTN_ID)
      .setLabel(ended ? 'Giveaway Ended' : 'Enter 🎁')
      .setStyle(ended ? ButtonStyle.Secondary : ButtonStyle.Primary)
      .setDisabled(ended)
  );
}

function pickWinners(participants, count) {
  const eligible = (participants ?? []).filter(id => typeof id === 'string');
  if (!eligible.length) return [];
  // Fisher–Yates shuffle, take first N
  const arr = [...eligible];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, Math.min(count, arr.length));
}

async function endGiveaway(client, guildId, msgId) {
  const db = getDb();
  const gw = db.giveaways?.[guildId]?.[msgId];
  if (!gw || gw.ended) return;
  gw.ended = true;
  gw.endedWinners = pickWinners(gw.participants, gw.winners);
  await saveDb();

  const timer = giveawayTimers.get(`${guildId}_${msgId}`);
  if (timer) { clearTimeout(timer); giveawayTimers.delete(`${guildId}_${msgId}`); }

  try {
    const channel = await client.channels.fetch(gw.channelId);
    if (!channel) return;
    const message = await channel.messages.fetch(msgId);
    await message.edit({ embeds: [giveawayEmbed(gw)], components: [enterButton(true)] });
    if (gw.endedWinners.length) {
      await channel.send({
        content: `🎉 Congratulations ${gw.endedWinners.map(id => `<@${id}>`).join(', ')}! You won **${gw.prize}**!`,
      });
    }
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
  // Clear any existing timer for this giveaway
  const key = `${guildId}_${msgId}`;
  const existing = giveawayTimers.get(key);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => endGiveaway(client, guildId, msgId), delay);
  giveawayTimers.set(key, timer);
}

export default {
  cooldown: 3,

  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Giveaway system')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s
      .setName('start')
      .setDescription('Start a giveaway')
      .addStringOption(o => o.setName('prize').setDescription('Prize').setRequired(true))
      .addStringOption(o => o.setName('duration').setDescription('Duration e.g. 1h, 30m, 5d').setRequired(true))
      .addIntegerOption(o => o.setName('winners').setDescription('Number of winners').setRequired(true).setMinValue(1).setMaxValue(10))
      .addChannelOption(o => o.setName('channel').setDescription('Channel (default: current)').setRequired(false))
    )
    .addSubcommand(s => s
      .setName('end')
      .setDescription('End a giveaway early')
      .addStringOption(o => o.setName('message_id').setDescription('Giveaway message ID').setRequired(true))
    )
    .addSubcommand(s => s
      .setName('reroll')
      .setDescription('Reroll a giveaway')
      .addStringOption(o => o.setName('message_id').setDescription('Giveaway message ID').setRequired(true))
    )
    .addSubcommand(s => s
      .setName('list')
      .setDescription('List all active giveaways in this server')
    )
    .addSubcommand(s => s
      .setName('delete')
      .setDescription('Delete a giveaway')
      .addStringOption(o => o.setName('message_id').setDescription('Giveaway message ID').setRequired(true))
    ),

  async execute(interaction, client) {
    const sub     = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const db      = getDb();
    if (!db.giveaways) db.giveaways = {};
    if (!db.giveaways[guildId]) db.giveaways[guildId] = {};

    // ── START ─────────────────────────────────────────────────────────────
    if (sub === 'start') {
      const prize    = interaction.options.getString('prize');
      const durStr   = interaction.options.getString('duration');
      const winners  = interaction.options.getInteger('winners');
      const channel  = interaction.options.getChannel('channel') ?? interaction.channel;
      const durMs    = parseDuration(durStr);

      if (!durMs || durMs < 10000) {
        return interaction.reply({ embeds: [errorEmbed('Invalid Duration', 'Use format like `10m`, `1h`, `2d` (min 10s).')], flags: [64] });
      }

      const endsAt = Date.now() + durMs;
      const giveaway = {
        prize,
        winnerCount: winners,
        winners,
        endsAt,
        hostId: interaction.user.id,
        channelId: channel.id,
        ended: false,
        participants: [],
        endedWinners: [],
      };

      await interaction.deferReply({ flags: [64] });
      try {
        const msg = await channel.send({
          embeds: [giveawayEmbed(giveaway)],
          components: [enterButton(false)],
        });
        db.giveaways[guildId][msg.id] = giveaway;
        await saveDb();
        scheduleGiveaway(client, guildId, msg.id, endsAt);
        await interaction.editReply({
          embeds: [successEmbed('Giveaway Started!', `Giveaway for **${prize}** started in ${channel}.\nEnds <t:${Math.floor(endsAt / 1000)}:R>.`)],
        });
      } catch (err) {
        await interaction.editReply({ embeds: [errorEmbed('Failed', `Couldn't start giveaway: ${err.message}`)] });
      }
    }

    // ── END ───────────────────────────────────────────────────────────────
    else if (sub === 'end') {
      const msgId = interaction.options.getString('message_id');
      const gw    = db.giveaways[guildId]?.[msgId];
      if (!gw) return interaction.reply({ embeds: [errorEmbed('Not Found', 'No giveaway with that message ID.')], flags: [64] });
      const timer = giveawayTimers.get(`${guildId}_${msgId}`);
      if (timer) clearTimeout(timer);
      await endGiveaway(client, guildId, msgId);
      return interaction.reply({ embeds: [successEmbed('Giveaway Ended', 'The giveaway has been ended.')], flags: [64] });
    }

    // ── REROLL ────────────────────────────────────────────────────────────
    else if (sub === 'reroll') {
      const msgId = interaction.options.getString('message_id');
      const gw    = db.giveaways[guildId]?.[msgId];
      if (!gw?.ended) return interaction.reply({ embeds: [errorEmbed('Not Ended', 'This giveaway has not ended yet. Use `/giveaway end` first.')], flags: [64] });

      try {
        const newWinners = pickWinners(gw.participants, gw.winners);
        gw.endedWinners = newWinners;
        await saveDb();
        if (!newWinners.length) {
          return interaction.reply({ embeds: [errorEmbed('No Winners', 'No eligible entries found.')] });
        }
        const channel = await client.channels.fetch(gw.channelId);
        if (channel) {
          const message = await channel.messages.fetch(msgId).catch(() => null);
          if (message) await message.edit({ embeds: [giveawayEmbed(gw)], components: [enterButton(true)] });
          await channel.send({
            content: `🎉 New winner(s) for **${gw.prize}**: ${newWinners.map(id => `<@${id}>`).join(', ')}!`,
          });
        }
        return interaction.reply({ embeds: [successEmbed('Rerolled!', `New winner(s): ${newWinners.map(id => `<@${id}>`).join(', ')}`)] });
      } catch (err) {
        return interaction.reply({ embeds: [errorEmbed('Error', err.message)], flags: [64] });
      }
    }

    // ── LIST ──────────────────────────────────────────────────────────────
    else if (sub === 'list') {
      const all = Object.entries(db.giveaways[guildId] ?? {});
      const active = all.filter(([, gw]) => !gw.ended);
      const ended  = all.filter(([, gw]) => gw.ended);
      if (!all.length) {
        return interaction.reply({ embeds: [errorEmbed('No Giveaways', 'No giveaways found in this server.')] });
      }
      const embed = new EmbedBuilder()
        .setColor(C.economy)
        .setTitle('🎉 Giveaways')
        .setFooter(FOOTER)
        .setTimestamp();
      if (active.length) {
        embed.addFields({
          name: `🟢 Active (${active.length})`,
          value: active.slice(0, 10).map(([id, gw]) =>
            `• **${gw.prize}** — ends <t:${Math.floor(gw.endsAt / 1000)}:R>\n  msg [\`${id}\`] in <#${gw.channelId}>`
          ).join('\n'),
        });
      }
      if (ended.length) {
        embed.addFields({
          name: `⚪ Ended (${ended.length})`,
          value: ended.slice(0, 5).map(([id, gw]) =>
            `• **${gw.prize}** — won by ${(gw.endedWinners ?? []).map(u => `<@${u}>`).join(', ') || '—'}\n  msg \`${id}\``
          ).join('\n'),
        });
      }
      return interaction.reply({ embeds: [embed], flags: [64] });
    }

    // ── DELETE ────────────────────────────────────────────────────────────
    else if (sub === 'delete') {
      const msgId = interaction.options.getString('message_id');
      const gw    = db.giveaways[guildId]?.[msgId];
      const timer = giveawayTimers.get(`${guildId}_${msgId}`);
      if (timer) clearTimeout(timer);
      delete db.giveaways[guildId][msgId];
      await saveDb();
      if (gw) {
        try {
          const ch = await client.channels.fetch(gw.channelId);
          const msg = await ch.messages.fetch(msgId);
          await msg.delete();
        } catch {}
      }
      return interaction.reply({ embeds: [successEmbed('Deleted', 'Giveaway deleted.')], flags: [64] });
    }
  },

  // ── Button handler (called by interactionCreate dispatcher) ────────────
  async handleButton(interaction, client) {
    if (interaction.customId !== ENTER_BTN_ID) return false;
    const guildId = interaction.guildId;
    const msgId   = interaction.message.id;
    const db      = getDb();
    const gw      = db.giveaways?.[guildId]?.[msgId];

    if (!gw) {
      await interaction.reply({ embeds: [errorEmbed('Not Found', 'This giveaway no longer exists.')], flags: [64] });
      return true;
    }
    if (gw.ended) {
      await interaction.reply({ embeds: [errorEmbed('Ended', 'This giveaway has already ended.')], flags: [64] });
      return true;
    }

    const uid    = interaction.user.id;
    const parts  = gw.participants ?? [];
    const idx    = parts.indexOf(uid);
    let joined;
    if (idx >= 0) {
      parts.splice(idx, 1);
      joined = false;
    } else {
      parts.push(uid);
      joined = true;
    }
    gw.participants = parts;
    await saveDb();

    // Update the giveaway message embed (participant count)
    try {
      await interaction.message.edit({ embeds: [giveawayEmbed(gw)] });
    } catch {}

    await interaction.reply({
      embeds: [joined
        ? successEmbed('Joined!', `You're now entered for **${gw.prize}**.\nTotal entries: **${parts.length}**`)
        : warningEmbed('Left', `You've left the giveaway for **${gw.prize}**.`)
      ],
      flags: [64],
    });
    return true;
  },
};
