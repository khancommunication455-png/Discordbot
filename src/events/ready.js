/**
 * ready.js — bot ready event
 */
export default {
  name: 'ready',
  once: true,
  async execute(client) {
    console.log(`\n✅ SkyBot v2 online as ${client.user.tag}`);
    console.log(`📊 Serving ${client.guilds.cache.size} server(s)`);
    console.log(`📡 Ping: ${client.ws.ping}ms`);

    client.user.setActivity('Hypixel Skyblock | /info', { type: 3 });
  },
};
