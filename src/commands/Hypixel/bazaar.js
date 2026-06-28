/**
 * bazaar.js — Check Bazaar buy/sell prices for an item
 *
 * Shows: item name, buy price, sell price, spread (coins), spread %,
 *        buy volume, sell volume. Supports product-name autocomplete.
 */
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getBazaar } from '../../services/hypixel.js';
import { C, formatCoins, formatNumber, errorEmbed } from '../../utils/embeds.js';

const FOOTER = { text: 'SkyBot v2 • Bazaar' };

// Cache product names so autocomplete is fast (refreshed with bazaar cache)
let productNameCache = null;
let productNameCacheAt = 0;
const PRODUCT_NAME_TTL = 60_000;

async function getProductNames() {
  if (productNameCache && Date.now() - productNameCacheAt < PRODUCT_NAME_TTL) {
    return productNameCache;
  }
  try {
    const products = await getBazaar();
    const names = Object.keys(products).map(k => ({
      id:   k,
      name: k.replace(/_/g, ' '),
    }));
    productNameCache = names;
    productNameCacheAt = Date.now();
    return names;
  } catch {
    return productNameCache ?? [];
  }
}

export default {
  data: new SlashCommandBuilder()
    .setName('bazaar')
    .setDescription('Check Bazaar buy/sell prices for an item')
    .addStringOption(o =>
      o.setName('item')
        .setDescription('Item name or ID (e.g. ENCHANTED_DIAMOND, "Wheat", "Hyperion Catalyst")')
        .setRequired(true)
        .setAutocomplete(true)
    ),

  cooldown: 3,

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(false).toLowerCase().trim();
    try {
      const names = await getProductNames();
      const filtered = focused
        ? names.filter(n => n.id.toLowerCase().includes(focused) || n.name.toLowerCase().includes(focused))
        : names;
      // Discord caps at 25 choices
      await interaction.respond(
        filtered.slice(0, 25).map(n => ({ name: `${n.name} (${n.id})`, value: n.id }))
      );
    } catch {
      await interaction.respond([]);
    }
  },

  async execute(interaction, client) {
    await interaction.deferReply();
    const query = interaction.options.getString('item').toUpperCase().replace(/\s+/g, '_');

    try {
      const products = await getBazaar();
      const keys = Object.keys(products).filter(k => k.includes(query));
      if (!keys.length) {
        return interaction.editReply({
          embeds: [errorEmbed('Not Found', `No bazaar item matching \`${query}\`.`)],
        });
      }

      const fields = keys.slice(0, 8).map(k => {
        const p = products[k];
        const qs = p.quick_status ?? {};
        const buyPrice  = qs.buyPrice  ?? 0;
        const sellPrice = qs.sellPrice ?? 0;
        const spread    = buyPrice - sellPrice;
        const spreadPct = buyPrice > 0 ? ((spread / buyPrice) * 100).toFixed(2) : '0.00';
        const buyVol    = qs.buyVolume    ?? 0;
        const sellVol   = qs.sellVolume   ?? 0;

        return {
          name: `${k.replace(/_/g, ' ')}  •  \`${k}\``,
          value:
            `Buy:  **${formatCoins(buyPrice)}** coins  •  Vol: ${formatNumber(buyVol)}\n` +
            `Sell: **${formatCoins(sellPrice)}** coins  •  Vol: ${formatNumber(sellVol)}\n` +
            `Spread: **${formatCoins(spread)}** (${spreadPct}%)`,
          inline: false,
        };
      });

      const embed = new EmbedBuilder()
        .setColor(C.economy)
        .setTitle(`📈 Bazaar: "${query}" (${keys.length} result${keys.length === 1 ? '' : 's'})`)
        .setDescription(
          `Live Bazaar prices. **Buy** = instant-sell offers (you buy from). ` +
          `**Sell** = instant-buy orders (you sell to). ` +
          `Spread is the bazaar tax margin.`
        )
        .addFields(fields)
        .setFooter(FOOTER)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await interaction.editReply({ embeds: [errorEmbed('Bazaar Error', err.message)] });
    }
  },
};
