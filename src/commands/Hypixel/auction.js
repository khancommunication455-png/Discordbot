import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getUUID, getPlayerAuctions, cleanItemName } from '../../services/hypixel.js';
import { getDb } from '../../utils/db.js';
import { errorEmbed, formatCoins } from '../../utils/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('auction')
    .setDescription("View a player's active auctions on the AH")
    .addStringOption(o =>
      o.setName('ign').setDescription('Minecraft IGN (leave blank for linked account)').setRequired(false)
    ),
  cooldown: 5,

  async execute(interaction, client) {
    await interaction.deferReply();
    const db = getDb();
    let ign = interaction.options.getString('ign')?.trim();
    let uuid;

    if (!ign) {
      const linked = db.data.linkedPlayers[interaction.user.id];
      if (!linked) return interaction.editReply({ embeds: [errorEmbed('Not Linked', 'Use `/link <ign>` first.')] });
      ({ ign, uuid } = linked);
    }

    try {
      if (!uuid) {
        const mojang = await getUUID(ign);
        ign  = mojang.name;
        uuid = mojang.id;
      }

      const auctions = await getPlayerAuctions(uuid);
      if (!auctions.length) {
        return interaction.editReply({ embeds: [errorEmbed('No Auctions', `**${ign}** has no active auctions.`)] });
      }

      const fields = auctions.slice(0, 10).map(a => ({
        name: cleanItemName(a.item_name),
        value: `${a.bin ? 'BIN' : 'Bid'}: **${formatCoins(a.starting_bid)}** | ` +
               `Highest: ${formatCoins(a.highest_bid_amount)} | ` +
               `Ends: <t:${Math.floor(a.end / 1000)}:R>`,
        inline: false,
      }));

      const embed = new EmbedBuilder()
        .setColor(0xffd700)
        .setTitle(`${ign}'s Active Auctions (${auctions.length})`)
        .addFields(fields)
        .setThumbnail(`https://mc-heads.net/avatar/${uuid}/32`)
        .setFooter({ text: 'SkyBot AH Tracker' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await interaction.editReply({ embeds: [errorEmbed('Error', err.message)] });
    }
  },
};
