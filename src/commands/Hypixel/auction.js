/**
 * auction.js — View a player's active auctions on the AH
 *
 * Shows: item name, starting bid, highest bid, BIN/auction flag, tier, time remaining.
 * If no IGN given, uses the Discord user's linked account from db.linkedPlayers.
 */
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getUUID, getPlayerAuctions, cleanItemName } from '../../services/hypixel.js';
import { getDb } from '../../utils/db.js';
import { C, formatCoins, formatNumber, errorEmbed } from '../../utils/embeds.js';

const FOOTER = { text: 'SkyBot v2 • Auction Tracker' };

const TIER_EMOJI = {
  COMMON:    '⚪',
  UNCOMMON:  '🟢',
  RARE:      '🔵',
  EPIC:      '🟣',
  LEGENDARY: '🟠',
  MYTHIC:    '🔴',
  DIVINE:    '🟦',
  SPECIAL:   '🟥',
  'VERY SPECIAL': '🟥',
};

export default {
  data: new SlashCommandBuilder()
    .setName('auction')
    .setDescription("View a player's active auctions on the AH")
    .addStringOption(o =>
      o.setName('ign').setDescription('Minecraft IGN (leave blank for linked account)').setRequired(false)
    ),

  cooldown: 3,

  async execute(interaction, client) {
    await interaction.deferReply();
    const db = getDb();
    let ign = interaction.options.getString('ign')?.trim();
    let uuid;

    if (!ign) {
      const linked = db.linkedPlayers?.[interaction.user.id];
      if (!linked) {
        return interaction.editReply({
          embeds: [errorEmbed('Not Linked', 'Use `/link <ign>` first, or provide an IGN.')],
        });
      }
      ({ ign, uuid } = linked);
    }

    try {
      if (!uuid) {
        const mojang = await getUUID(ign);
        ign  = mojang.name;
        uuid = mojang.id;
      }

      const auctions = await getPlayerAuctions(uuid);
      const active = auctions.filter(a => !a.claimed && (a.end ?? 0) > Date.now());

      if (!active.length) {
        return interaction.editReply({
          embeds: [errorEmbed('No Active Auctions', `**${ign}** has no active auctions.`)],
        });
      }

      // Sort by end time soonest first
      active.sort((a, b) => (a.end ?? 0) - (b.end ?? 0));

      const fields = active.slice(0, 10).map(a => {
        const tier    = (a.tier || 'COMMON').toUpperCase();
        const tierE   = TIER_EMOJI[tier] ?? '•';
        const name    = cleanItemName(a.item_name) || cleanItemName(a.item_lore?.split('\n')[0]) || 'Unnamed Item';
        const isBin   = !!a.bin;
        const start   = a.starting_bid ?? 0;
        const highest = a.highest_bid_amount ?? 0;
        const claimBids = a.bids?.length ?? 0;
        const endTs   = Math.floor((a.end ?? 0) / 1000);
        return {
          name: `${tierE} ${name}  [${tier}]`,
          value:
            `${isBin ? '🏷️ BIN' : '🔨 Auction'} — Start: **${formatCoins(start)}**\n` +
            `Highest Bid: **${formatCoins(highest)}**  •  Bids: ${formatNumber(claimBids)}\n` +
            `Ends: <t:${endTs}:R> (<t:${endTs}:t>)`,
          inline: false,
        };
      });

      const embed = new EmbedBuilder()
        .setColor(C.auction)
        .setAuthor({ name: `${ign}'s Active Auctions`, iconURL: `https://mc-heads.net/avatar/${uuid}/64` })
        .setTitle(`🔨 ${ign} — ${active.length} Active Auction${active.length === 1 ? '' : 's'}`)
        .setDescription(
          active.length > 10
            ? `Showing the **10 soonest-ending** auctions (of ${active.length} total).`
            : `Showing all active auctions.`
        )
        .addFields(fields)
        .setThumbnail(`https://mc-heads.net/body/${uuid}/right`)
        .setFooter(FOOTER)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await interaction.editReply({ embeds: [errorEmbed('Auction Error', err.message)] });
    }
  },
};
