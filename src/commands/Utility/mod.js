/**
 * mod.js — SkyBot v2 Moderation command
 *
 * Ported from SkyBot v1 (Discordbot-main/src/commands/Utility/mod.js).
 * Adapted for v2 SkyBot footer, cooldown: 3, and flat db access.
 *
 * Subcommands:
 *   /mod ban      <user> [reason] [delete_days]
 *   /mod unban    <user_id> [reason]
 *   /mod kick     <user> [reason]
 *   /mod timeout  <user> <minutes> [reason]
 *   /mod untimeout <user>
 *   /mod warn     <user> <reason>
 *   /mod purge    <amount> [user]
 *   /mod lock     [reason]
 *   /mod unlock
 *   /mod slowmode <seconds>
 *
 * Logs every action to LOG_CHANNEL_ID if set.
 */
import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { C } from '../../utils/embeds.js';

const FOOTER = { text: 'SkyBot v2 • Railway Edition' };

async function modLog(guild, client, data) {
  const chId = process.env.LOG_CHANNEL_ID;
  if (!chId) return;
  const ch = await guild.channels.fetch(chId).catch(() => null);
  if (!ch) return;

  const colors = {
    Ban: C.error, Kick: C.error, Timeout: C.warning, Warn: C.warning,
    Unban: C.success, Untimeout: C.success,
  };

  await ch.send({
    embeds: [new EmbedBuilder()
      .setColor(colors[data.action] ?? C.info)
      .setTitle(`Moderation · ${data.action}`)
      .setThumbnail(data.target?.displayAvatarURL?.() ?? data.target?.avatarURL?.() ?? null)
      .addFields(
        { name: 'User',       value: `${data.target?.tag ?? data.targetId}\n\`${data.targetId}\``, inline: true  },
        { name: 'Moderator',  value: `${data.mod.user?.tag ?? data.mod.tag}`,                       inline: true  },
        { name: 'Action',     value: data.action,                                                  inline: true  },
        { name: 'Reason',     value: data.reason,                                                  inline: false },
        ...(data.extra ? [{ name: 'Details', value: data.extra, inline: false }] : []),
      )
      .setFooter(FOOTER)
      .setTimestamp(),
    ],
  }).catch(() => {});
}

export default {
  cooldown: 3,

  data: new SlashCommandBuilder()
    .setName('mod')
    .setDescription('Moderation commands')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand(s => s
      .setName('ban')
      .setDescription('Permanently ban a member from the server')
      .addUserOption(o => o.setName('user').setDescription('Member to ban').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason for ban').setRequired(false))
      .addIntegerOption(o => o.setName('delete_days').setDescription('Delete message history (days)').setMinValue(0).setMaxValue(7).setRequired(false))
    )
    .addSubcommand(s => s
      .setName('unban')
      .setDescription('Unban a user by their ID')
      .addStringOption(o => o.setName('user_id').setDescription('User ID to unban').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false))
    )
    .addSubcommand(s => s
      .setName('kick')
      .setDescription('Kick a member from the server')
      .addUserOption(o => o.setName('user').setDescription('Member to kick').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false))
    )
    .addSubcommand(s => s
      .setName('timeout')
      .setDescription('Temporarily mute a member')
      .addUserOption(o => o.setName('user').setDescription('Member to timeout').setRequired(true))
      .addIntegerOption(o => o.setName('minutes').setDescription('Duration in minutes').setRequired(true).setMinValue(1).setMaxValue(40320))
      .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false))
    )
    .addSubcommand(s => s
      .setName('untimeout')
      .setDescription('Remove a timeout from a member')
      .addUserOption(o => o.setName('user').setDescription('Target member').setRequired(true))
    )
    .addSubcommand(s => s
      .setName('warn')
      .setDescription('Issue a formal warning to a member')
      .addUserOption(o => o.setName('user').setDescription('Member to warn').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason for warning').setRequired(true))
    )
    .addSubcommand(s => s
      .setName('purge')
      .setDescription('Bulk delete messages from a channel')
      .addIntegerOption(o => o.setName('amount').setDescription('Number of messages (1–100)').setRequired(true).setMinValue(1).setMaxValue(100))
      .addUserOption(o => o.setName('user').setDescription('Only delete messages from this user').setRequired(false))
    )
    .addSubcommand(s => s
      .setName('lock')
      .setDescription('Prevent everyone from sending messages in a channel')
      .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false))
    )
    .addSubcommand(s => s
      .setName('unlock')
      .setDescription('Restore message permissions in a channel')
    )
    .addSubcommand(s => s
      .setName('slowmode')
      .setDescription('Set slowmode delay in the current channel')
      .addIntegerOption(o => o.setName('seconds').setDescription('Delay in seconds (0 = off)').setRequired(true).setMinValue(0).setMaxValue(21600))
    ),

  async execute(interaction, client) {
    await interaction.deferReply({ flags: [64] });
    const sub    = interaction.options.getSubcommand();
    const reason = interaction.options.getString('reason') ?? 'No reason provided';

    const reply = (embed) => interaction.editReply({ embeds: [embed] });

    const embed = (color, title, desc) => new EmbedBuilder()
      .setColor(color).setTitle(title).setDescription(desc).setFooter(FOOTER).setTimestamp();

    // ── BAN ───────────────────────────────────────────────────────────
    if (sub === 'ban') {
      const user = interaction.options.getUser('user');
      const days = interaction.options.getInteger('delete_days') ?? 0;
      try {
        await interaction.guild.members.ban(user, { reason, deleteMessageSeconds: days * 86400 });
        await modLog(interaction.guild, client, { action: 'Ban', target: user, targetId: user.id, mod: interaction.member, reason });
        return reply(embed(C.error, 'Member Banned', `**${user.tag}** has been permanently banned.\n**Reason:** ${reason}`));
      } catch (err) {
        return reply(embed(C.error, 'Ban Failed', err.message));
      }
    }

    // ── UNBAN ─────────────────────────────────────────────────────────
    if (sub === 'unban') {
      const userId = interaction.options.getString('user_id');
      try {
        await interaction.guild.members.unban(userId, reason);
        await modLog(interaction.guild, client, { action: 'Unban', targetId: userId, mod: interaction.member, reason });
        return reply(embed(C.success, 'Member Unbanned', `User \`${userId}\` has been unbanned.`));
      } catch (err) {
        return reply(embed(C.error, 'Unban Failed', `User \`${userId}\` not found in ban list.`));
      }
    }

    // ── KICK ──────────────────────────────────────────────────────────
    if (sub === 'kick') {
      const member = interaction.options.getMember('user');
      if (!member) return reply(embed(C.error, 'Not Found', 'That member is not in this server.'));
      try {
        await member.kick(reason);
        await modLog(interaction.guild, client, { action: 'Kick', target: member.user, targetId: member.id, mod: interaction.member, reason });
        return reply(embed(C.warning, 'Member Kicked', `**${member.user.tag}** has been kicked.\n**Reason:** ${reason}`));
      } catch (err) {
        return reply(embed(C.error, 'Kick Failed', err.message));
      }
    }

    // ── TIMEOUT ───────────────────────────────────────────────────────
    if (sub === 'timeout') {
      const member  = interaction.options.getMember('user');
      if (!member) return reply(embed(C.error, 'Not Found', 'That member is not in this server.'));
      const minutes = interaction.options.getInteger('minutes');
      const until   = new Date(Date.now() + minutes * 60 * 1000);
      try {
        await member.timeout(minutes * 60 * 1000, reason);
        await modLog(interaction.guild, client, {
          action: 'Timeout', target: member.user, targetId: member.id,
          mod: interaction.member, reason, extra: `Duration: **${minutes}m** · Expires <t:${Math.floor(until.getTime() / 1000)}:R>`,
        });
        return reply(embed(C.warning, 'Member Timed Out',
          `**${member.user.tag}** has been timed out for **${minutes} minute${minutes !== 1 ? 's' : ''}**.\n**Reason:** ${reason}\n**Expires:** <t:${Math.floor(until.getTime() / 1000)}:R>`
        ));
      } catch (err) {
        return reply(embed(C.error, 'Timeout Failed', err.message));
      }
    }

    // ── UNTIMEOUT ─────────────────────────────────────────────────────
    if (sub === 'untimeout') {
      const member = interaction.options.getMember('user');
      if (!member) return reply(embed(C.error, 'Not Found', 'That member is not in this server.'));
      try {
        await member.timeout(null);
        await modLog(interaction.guild, client, { action: 'Untimeout', target: member.user, targetId: member.id, mod: interaction.member, reason: 'Timeout removed' });
        return reply(embed(C.success, 'Timeout Removed', `**${member.user.tag}**'s timeout has been lifted.`));
      } catch (err) {
        return reply(embed(C.error, 'Untimeout Failed', err.message));
      }
    }

    // ── WARN ──────────────────────────────────────────────────────────
    if (sub === 'warn') {
      const user = interaction.options.getUser('user');
      try {
        await user.send({ embeds: [embed(C.warning, `Warning — ${interaction.guild.name}`, `**Reason:** ${reason}\n\nPlease review the server rules to avoid further action.`)] });
      } catch {}
      await modLog(interaction.guild, client, { action: 'Warn', target: user, targetId: user.id, mod: interaction.member, reason });
      return reply(embed(C.warning, 'Warning Issued', `**${user.tag}** has been warned.\n**Reason:** ${reason}`));
    }

    // ── PURGE ─────────────────────────────────────────────────────────
    if (sub === 'purge') {
      const amount = interaction.options.getInteger('amount');
      const user   = interaction.options.getUser('user');
      let messages = await interaction.channel.messages.fetch({ limit: amount });
      if (user) messages = messages.filter(m => m.author.id === user.id);
      const deleted = await interaction.channel.bulkDelete(messages, true);
      return reply(embed(C.success, 'Messages Purged', `Deleted **${deleted.size}** message${deleted.size !== 1 ? 's' : ''}${user ? ` from **${user.tag}**` : ''}.`));
    }

    // ── LOCK ──────────────────────────────────────────────────────────
    if (sub === 'lock') {
      await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false });
      return reply(embed(C.error, 'Channel Locked', `🔒 <#${interaction.channelId}> has been locked.${reason !== 'No reason provided' ? `\n**Reason:** ${reason}` : ''}`));
    }

    // ── UNLOCK ────────────────────────────────────────────────────────
    if (sub === 'unlock') {
      await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: null });
      return reply(embed(C.success, 'Channel Unlocked', `🔓 <#${interaction.channelId}> has been unlocked.`));
    }

    // ── SLOWMODE ──────────────────────────────────────────────────────
    if (sub === 'slowmode') {
      const seconds = interaction.options.getInteger('seconds');
      await interaction.channel.setRateLimitPerUser(seconds);
      return reply(embed(C.info, 'Slowmode Updated',
        seconds === 0
          ? `Slowmode disabled in <#${interaction.channelId}>.`
          : `Slowmode set to **${seconds}s** in <#${interaction.channelId}>.`
      ));
    }
  },
};
