import { Events, ActivityType } from 'discord.js';

export default {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    client.user.setActivity('Hypixel Skyblock AH', { type: ActivityType.Watching });
    console.log(`\n🎮 SkyBot is live as ${client.user.tag}`);
    console.log(`📊 Serving ${client.guilds.cache.size} server(s)`);
  },
};
