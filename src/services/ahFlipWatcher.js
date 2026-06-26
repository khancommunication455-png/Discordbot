/**
 * ahFlipWatcher.js
 * Polls the Hypixel AH every 60s, finds underpriced BIN auctions
 * and pings premium role in the configured channel.
 *
 * Flip logic: compare to lowest BIN of same item on current page.
 * For production you'd want a price DB / cofl-style historical data.
 */
import cron from 'node-cron';
import { getAHPage, cleanItemName } from './hypixel.js';
import { goldEmbed, formatCoins } from '../utils/embeds.js';
import { EmbedBuilder } from 'discord.js';

const MIN_PROFIT  = 500_000;   // 500k minimum profit to ping
const MIN_MARGIN  = 0.25;      // item must be at least 25% below market

// In-memory price cache: itemName → lowestBIN
const priceCache = new Map();
const seenAuctions = new Set();

export function startAHFlipWatcher(client) {
  const CHANNEL_ID  = process.env.AH_FLIP_CHANNEL_ID;
  const PREMIUM_ROLE = process.env.PREMIUM_ROLE_ID;

  if (!CHANNEL_ID) {
    console.warn('[AHFlip] AH_FLIP_CHANNEL_ID not set, watcher disabled.');
    return;
  }

  cron.schedule('*/60 * * * * *', async () => {
    try {
      const page0 = await getAHPage(0);
      const auctions = page0.auctions ?? [];

      // Build price cache from BIN auctions
      for (const a of auctions) {
        if (!a.bin) continue;
        const name = cleanItemName(a.item_name);
        const cur = priceCache.get(name);
        if (!cur || a.starting_bid < cur) priceCache.set(name, a.starting_bid);
      }

      const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
      if (!channel) return;

      for (const a of auctions) {
        if (!a.bin) continue;
        if (seenAuctions.has(a.uuid)) continue;
        seenAuctions.add(a.uuid);

        const name = cleanItemName(a.item_name);
        const lowestBIN = priceCache.get(name) ?? a.starting_bid;

        if (a.starting_bid >= lowestBIN) continue; // not a flip

        const profit   = lowestBIN - a.starting_bid;
        const margin   = profit / lowestBIN;

        if (profit < MIN_PROFIT || margin < MIN_MARGIN) continue;

        const embed = new EmbedBuilder()
          .setColor(0xffd700)
          .setTitle('💰 AH Flip Detected!')
          .addFields(
            { name: 'Item',        value: `\`${name}\``,                   inline: true },
            { name: 'Buy Price',   value: formatCoins(a.starting_bid),     inline: true },
            { name: 'Lowest BIN',  value: formatCoins(lowestBIN),          inline: true },
            { name: 'Est. Profit', value: `**${formatCoins(profit)}**`,    inline: true },
            { name: 'Margin',      value: `${(margin * 100).toFixed(1)}%`, inline: true },
            { name: 'Auction ID',  value: `\`/viewauction ${a.uuid}\``,   inline: false },
          )
          .setFooter({ text: 'SkyBot AH Flipper • Data from Hypixel API' })
          .setTimestamp();

        const ping = PREMIUM_ROLE ? `<@&${PREMIUM_ROLE}>` : '';
        await channel.send({ content: ping, embeds: [embed] });
      }

      // Prevent seenAuctions from growing forever
      if (seenAuctions.size > 5000) {
        const arr = [...seenAuctions];
        arr.slice(0, 2500).forEach(id => seenAuctions.delete(id));
      }
    } catch (err) {
      console.error('[AHFlip] Error:', err.message);
    }
  });

  console.log('✅ AH Flip Watcher started (every 60s)');
}
