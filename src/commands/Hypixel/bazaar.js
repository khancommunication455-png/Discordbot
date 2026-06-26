import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getBazaar } from '../../services/hypixel.js';
import { errorEmbed, formatCoins } from '../../utils/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('bazaar')
    .setDescription('Check Bazaar buy/sell prices for an item')
    .addStringOption(o =>
      o.setName('item').setDescription('Item name or ID (e.g. ENCHANTED_DIAMOND)').setRequired(true)
    ),
  cooldown: 4,

  async execute(interaction, client) {
    await interaction.deferReply();
    const query = interaction.options.getString('item').toUpperCase().replace(/ /g, '_');

    try {
      const products = await getBazaar();
      const keys = Object.keys(products).filter(k => k.includes(query));
      if (!keys.length) {
        return interaction.editReply({ embeds: [errorEmbed('Not Found', `No bazaar item matching \`${query}\`.`)] });
      }

      const fields = keys.slice(0, 8).map(k => {
        const p = products[k];
        const buyPrice  = p.quick_status?.buyPrice  ?? 0;
        const sellPrice = p.quick_status?.sellPrice ?? 0;
        const margin    = buyPrice > 0 ? ((buyPrice - sellPrice) / buyPrice * 100).toFixed(1) : '?';
        return {
          name: k.replace(/_/g, ' '),
          value: `Buy: **${formatCoins(buyPrice)}** | Sell: **${formatCoins(sellPrice)}** | Spread: ${margin}%`,
          inline: false,
        };
      });

      const embed = new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle(`📈 Bazaar: "${query}" (${keys.length} results)`)
        .addFields(fields)
        .setFooter({ text: 'SkyBot Bazaar' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await interaction.editReply({ embeds: [errorEmbed('Bazaar Error', err.message)] });
    }
  },
};
