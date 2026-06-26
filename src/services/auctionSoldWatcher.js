/**
 * auctionSoldWatcher.js
 * Polls every 2 minutes for ended auctions of linked players.
 * Sends a DM / channel ping when an item sells.
 */
import cron from 'node-cron';
import { getPlayerAuctions, cleanItemName } from './hypixel.js';
import { getDb } from '../utils/db.js';
import { EmbedBuilder } from 'discord.js';
import { formatCoins } from '../utils/embeds.js';

// Track last-seen auction states per uuid → Set<auctionId>
const knownAuctions = new Map(); // uuid → Map<auctionId, { claimed }>

export function startAuctionSoldWatcher(client) {
  cron.schedule('*/2 * * * *', async () => {
    const db = getDb();
    const linked = db.data.linkedPlayers; // { discordId: { ign, uuid } }

    for (const [discordId, { uuid, ign }] of Object.entries(linked)) {
      try {
        const auctions = await getPlayerAuctions(uuid);
        const prev = knownAuctions.get(uuid) ?? new Map();

        for (const a of auctions) {
          const wasClaimed = prev.get(a.uuid)?.claimed ?? false;
          const isClaimed  = a.claimed ?? false;

          // Sold = highest_bid_amount > 0 AND now claimed (or ended)
          if (!wasClaimed && isClaimed && a.highest_bid_amount > 0) {
            const itemName = cleanItemName(a.item_name);

            const embed = new EmbedBuilder()
              .setColor(0x57f287)
              .setTitle('🎉 Auction Sold!')
              .setDescription(`Hey **${ign}**, your auction just sold!`)
              .addFields(
                { name: 'Item',       value: itemName,                        inline: true },
                { name: 'Sold For',   value: formatCoins(a.highest_bid_amount), inline: true },
              )
              .setFooter({ text: 'SkyBot Auction Tracker' })
              .setTimestamp();

            try {
              const user = await client.users.fetch(discordId);
              await user.send({ embeds: [embed] });
            } catch {
              // DMs closed — try channel
              const ch = process.env.AUCTION_SOLD_CHANNEL_ID;
              if (ch) {
                const channel = await client.channels.fetch(ch).catch(() => null);
                if (channel) await channel.send({ content: `<@${discordId}>`, embeds: [embed] });
              }
            }
          }

          // Update state
          prev.set(a.uuid, { claimed: isClaimed });
        }
        knownAuctions.set(uuid, prev);
      } catch (err) {
        // likely rate limit or offline player — skip
      }
    }
  });
  console.log('✅ Auction Sold Watcher started (every 2m)');
}
