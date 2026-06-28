/**
 * guildMemberRemove.js — fires when a member leaves or is kicked from a guild.
 *
 * Ported from SkyBot v1 (Discordbot-main/src/events/guildMemberRemove.js).
 * Adapted for v2 flat db (db.goodbyeConfig instead of db.data.goodbyeConfig)
 * and SkyBot v2 • Railway Edition footer.
 *
 * Sends a goodbye message in the configured channel (if enabled). Placeholders
 * supported in the message: {username} {server} {count}.
 */
import { Events, EmbedBuilder } from 'discord.js';
import { getDb } from '../utils/db.js';

export default {
  name: Events.GuildMemberRemove,
  async execute(member, client) {
    const db  = getDb();
    const cfg = db.goodbyeConfig?.[member.guild.id];
    if (!cfg?.enabled) return;

    const channel = member.guild.channels.cache.get(cfg.channel);
    if (!channel) return;

    const msg = cfg.message
      .replace('{username}', member.user.username)
      .replace('{server}',   member.guild.name)
      .replace('{count}',    String(member.guild.memberCount));

    const embed = new EmbedBuilder()
      .setColor(0xED4245)
      .setTitle(`👋 Goodbye from ${member.guild.name}`)
      .setDescription(msg)
      .setThumbnail(member.user.displayAvatarURL())
      .setFooter({ text: 'SkyBot v2 • Railway Edition' })
      .setTimestamp();

    await channel.send({ embeds: [embed] }).catch(() => {});
  },
};
