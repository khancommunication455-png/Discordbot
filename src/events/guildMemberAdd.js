import { Events, EmbedBuilder } from 'discord.js';
import { getDb } from '../utils/db.js';

export default {
  name: Events.GuildMemberAdd,
  async execute(member, client) {
    const db      = getDb();
    const guildId = member.guild.id;

    // ── Auto Role ──────────────────────────────────────────────────────
    const roles = db.data.autoRole?.[guildId] ?? [];
    for (const roleId of roles) {
      await member.roles.add(roleId).catch(() => {});
    }

    // ── Welcome Message ────────────────────────────────────────────────
    const cfg = db.data.welcomeConfig?.[guildId];
    if (!cfg?.enabled) return;

    const channel = member.guild.channels.cache.get(cfg.channel);
    if (!channel) return;

    const msg = cfg.message
      .replace('{user}',     `<@${member.id}>`)
      .replace('{username}', member.user.username)
      .replace('{server}',   member.guild.name)
      .replace('{count}',    member.guild.memberCount);

    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle(`👋 Welcome to ${member.guild.name}!`)
      .setDescription(msg)
      .setThumbnail(member.user.displayAvatarURL())
      .setTimestamp();

    if (cfg.image) embed.setImage(cfg.image);

    await channel.send({
      content: cfg.ping ? `<@${member.id}>` : undefined,
      embeds:  [embed],
    }).catch(() => {});
  },
};
