/**
 * guildMemberAdd.js — fires when a member joins a guild.
 *
 * Ported from SkyBot v1 (Discordbot-main/src/events/guildMemberAdd.js) +
 * adds a one-time XP bonus for joining (per task spec).
 *
 * v2 flat db:
 *   db.autoRole[guildId]      → [roleId, ...]
 *   db.welcomeConfig[guildId] → { channel, message, ping, image, enabled }
 *   db.leveling[guildId]      → { users, config } (via levelingUtil)
 */
import { Events, EmbedBuilder } from 'discord.js';
import { getDb, saveDb } from '../utils/db.js';
import { addXp, getLevelData, getLevelingConfig, getXpForLevel } from '../utils/levelingUtil.js';

const WELCOME_JOIN_XP = 50; // one-time bonus for joining the server

export default {
  name: Events.GuildMemberAdd,
  async execute(member, client) {
    const db      = getDb();
    const guildId = member.guild.id;

    // ── Auto Role ──────────────────────────────────────────────────────
    const roles = db.autoRole?.[guildId] ?? [];
    for (const roleId of roles) {
      await member.roles.add(roleId).catch(() => {});
    }

    // ── Welcome Message ────────────────────────────────────────────────
    const cfg = db.welcomeConfig?.[guildId];
    if (cfg?.enabled) {
      const channel = member.guild.channels.cache.get(cfg.channel);
      if (channel) {
        const msg = cfg.message
          .replace('{user}',     `<@${member.id}>`)
          .replace('{username}', member.user.username)
          .replace('{server}',   member.guild.name)
          .replace('{count}',    String(member.guild.memberCount));

        const embed = new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle(`👋 Welcome to ${member.guild.name}!`)
          .setDescription(msg)
          .setThumbnail(member.user.displayAvatarURL())
          .setFooter({ text: 'SkyBot v2 • Railway Edition' })
          .setTimestamp();

        if (cfg.image) embed.setImage(cfg.image);

        await channel.send({
          content: cfg.ping ? `<@${member.id}>` : undefined,
          embeds:  [embed],
        }).catch(() => {});
      }
    }

    // ── XP bonus for joining ───────────────────────────────────────────
    try {
      const lvlCfg = getLevelingConfig(guildId);
      if (lvlCfg?.enabled) {
        // addXp handles the standard random per-action gain + cooldown +
        // single level-up. We then add a flat join bonus on top and roll
        // over any additional level-ups triggered by the bonus.
        const result = await addXp(guildId, member.id, client);
        const data = getLevelData(guildId, member.id);

        if (result || data) {
          data.xp      = (data.xp ?? 0) + WELCOME_JOIN_XP;
          data.totalXp = (data.totalXp ?? 0) + WELCOME_JOIN_XP;

          let needed = getXpForLevel((data.level ?? 0) + 1);
          while (data.xp >= needed) {
            data.xp  -= needed;
            data.level = (data.level ?? 0) + 1;
            needed = getXpForLevel((data.level ?? 0) + 1);
          }

          // Persist back through the flat db reference
          if (db.leveling?.[guildId]?.users) {
            db.leveling[guildId].users[member.id] = data;
          }
          await saveDb();
        }
      }
    } catch (err) {
      console.error('[Welcome] XP bonus error:', err.message);
    }
  },
};
