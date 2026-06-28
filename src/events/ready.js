/**
 * ready.js — bot ready event
 */
import { getDb } from '../utils/db.js';

export default {
  name: 'ready',
  once: true,
  async execute(client) {
    console.log(`\n✅ SkyBot v2 online as ${client.user.tag}`);
    console.log(`📊 Serving ${client.guilds.cache.size} server(s)`);
    console.log(`📡 Ping: ${client.ws.ping}ms`);

    client.user.setActivity('Hypixel Skyblock | /info', { type: 3 });

    // ── Restore in-flight giveaways on restart ──
    // Walks db.giveaways and reschedules any active giveaway whose timer
    // was lost when the process restarted. Imported dynamically so the
    // ready event does not crash if the giveaway command fails to load.
    try {
      const { scheduleGiveaway } = await import('../commands/Giveaway/giveaway.js');
      const db    = getDb();
      const guilds = db.giveaways ?? {};
      let restored = 0;
      for (const [guildId, gws] of Object.entries(guilds)) {
        for (const [msgId, gw] of Object.entries(gws ?? {})) {
          if (gw?.ended) continue;
          if (!gw?.endsAt) continue;
          scheduleGiveaway(client, guildId, msgId, gw.endsAt);
          restored++;
        }
      }
      if (restored > 0) console.log(`🎉 Restored ${restored} active giveaway timer(s).`);
    } catch (err) {
      console.error('[Giveaway] Restore-on-ready failed:', err.message);
    }
  },
};
