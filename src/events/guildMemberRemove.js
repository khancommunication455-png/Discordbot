import { Events, EmbedBuilder } from 'discord.js';
import { getDb } from '../utils/db.js';

export default {
  name: Events.GuildMemberRemove,
  async execute(member, client) {
    const db  = getDb();
    const cfg = db.data.goodbyeConfig?.[member.guild.id];
    if (!cfg?.enabled) return;

    const channel = member.guild.channels.cache.get(cfg.channel);
    if (!channel) return;

    const msg = cfg.message
      .replace('{username}', member.user.username)
      .replace('{server}',   member.guild.name)
      .replace('{count}',    member.guild.memberCount);

    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle(`👋 Goodbye from ${member.guild.name}`)
      .setDescription(msg)
      .setThumbnail(member.user.displayAvatarURL())
      .setTimestamp();

    await channel.send({ embeds: [embed] }).catch(() => {});
  },
};
