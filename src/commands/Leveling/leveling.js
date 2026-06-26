import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { getLevelData, getXpForLevel, getLeaderboard, getLevelingConfig, setLevelingConfig } from '../../utils/levelingUtil.js';
import { getDb, saveDb } from '../../utils/db.js';
import { C } from '../../utils/embeds.js';
import { progressBar } from '../../utils/leveling.js';

const FOOTER = { text: 'TITAN Jr. Leveling' };

export default {
  data: new SlashCommandBuilder()
    .setName('leveling')
    .setDescription('XP leveling system')
    .setDefaultMemberPermissions(0n) // everyone can use rank/leaderboard; admin checks are inside execute
    .addSubcommand(s => s
      .setName('setup')
      .setDescription('Enable leveling and configure level-up messages')
      .addChannelOption(o => o.setName('channel').setDescription('Level-up channel').addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addStringOption(o => o.setName('message').setDescription('Message — use {user} {level}').setRequired(false))
    )
    .addSubcommand(s => s.setName('disable').setDescription('Disable leveling system'))
    .addSubcommand(s => s
      .setName('rank')
      .setDescription('View your rank or another user\'s rank')
      .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(false))
    )
    .addSubcommand(s => s.setName('leaderboard').setDescription('Top 10 users by XP'))
    .addSubcommand(s => s
      .setName('setxp')
      .setDescription('Set a user\'s XP (Admin only)')
      .addUserOption(o => o.setName('user').setDescription('Target').setRequired(true))
      .addIntegerOption(o => o.setName('xp').setDescription('XP amount').setRequired(true).setMinValue(0))
    )
    .addSubcommand(s => s
      .setName('addxp')
      .setDescription('Add XP to a user (Admin only)')
      .addUserOption(o => o.setName('user').setDescription('Target').setRequired(true))
      .addIntegerOption(o => o.setName('xp').setDescription('XP to add').setRequired(true).setMinValue(1))
    )
    .addSubcommand(s => s
      .setName('resetxp')
      .setDescription('Reset a user\'s XP (Admin only)')
      .addUserOption(o => o.setName('user').setDescription('Target').setRequired(true))
    ),

  async execute(interaction, client) {
    const sub     = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const db      = getDb();

    // Admin check for management commands
    const adminSubs = ['setup', 'disable', 'setxp', 'addxp', 'resetxp'];
    if (adminSubs.includes(sub)) {
      const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.ManageGuild);
      if (!isAdmin) {
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(C.error).setTitle('No Permission').setDescription('You need **Manage Server** permission to use this command.').setFooter(FOOTER).setTimestamp()],
          flags: [64],
        });
      }
    }

    if (sub === 'setup') {
      const channel = interaction.options.getChannel('channel');
      const message = interaction.options.getString('message') ?? '🎉 {user} just reached **Level {level}**!';
      await setLevelingConfig(guildId, { enabled: true, channelId: channel.id, message });
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(C.success).setTitle('Leveling Enabled').addFields(
          { name: 'Channel', value: `${channel}`, inline: true },
          { name: 'Message', value: message,       inline: false },
        ).setFooter(FOOTER).setTimestamp()],
      });
    }

    if (sub === 'disable') {
      const cfg = getLevelingConfig(guildId) ?? {};
      await setLevelingConfig(guildId, { ...cfg, enabled: false });
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(C.success).setTitle('Leveling Disabled').setDescription('XP is no longer awarded.').setFooter(FOOTER).setTimestamp()] });
    }

    if (sub === 'rank') {
      const target   = interaction.options.getUser('user') ?? interaction.user;
      const data     = getLevelData(guildId, target.id);
      const needed   = getXpForLevel(data.level + 1);
      const progress = needed > 0 ? Math.min(data.xp / needed, 1) : 0;
      const bar      = progressBar(progress, 14);
      const lb       = getLeaderboard(guildId);
      const rank     = lb.findIndex(u => u.id === target.id) + 1;

      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(C.leveling)
          .setAuthor({ name: `${target.username}'s Rank`, iconURL: target.displayAvatarURL() })
          .setThumbnail(target.displayAvatarURL({ size: 128 }))
          .addFields(
            { name: 'Level',    value: `**${data.level}**`,                        inline: true },
            { name: 'Rank',     value: `**#${rank || '?'}**`,                     inline: true },
            { name: 'Total XP', value: `${data.totalXp?.toLocaleString() ?? 0}`,  inline: true },
            { name: `Progress — ${data.xp?.toLocaleString()} / ${needed.toLocaleString()} XP`, value: bar, inline: false },
          )
          .setFooter(FOOTER).setTimestamp()
        ],
      });
    }

    if (sub === 'leaderboard') {
      const lb     = getLeaderboard(guildId).slice(0, 10);
      const medals = ['🥇','🥈','🥉'];
      const lines  = lb.map((u, i) =>
        `${medals[i] ?? `**${i+1}.**`} <@${u.id}> — Level **${u.level}** · ${(u.totalXp ?? 0).toLocaleString()} XP`
      );
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(C.leveling)
          .setTitle('XP Leaderboard')
          .setDescription(lines.join('\n') || 'No data yet. Start chatting!')
          .setFooter(FOOTER).setTimestamp()
        ],
      });
    }

    if (sub === 'setxp') {
      const target = interaction.options.getUser('user');
      const xp     = interaction.options.getInteger('xp');
      const data   = getLevelData(guildId, target.id);
      let lvl = 0, rem = xp;
      while (rem >= getXpForLevel(lvl + 1)) { rem -= getXpForLevel(lvl + 1); lvl++; }
      data.level = lvl; data.xp = rem; data.totalXp = xp;
      if (!db.data.leveling[guildId]) db.data.leveling[guildId] = { users: {} };
      db.data.leveling[guildId].users[target.id] = data;
      await saveDb();
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(C.success).setTitle('XP Set').setDescription(`**${target.username}** → ${xp.toLocaleString()} XP (Level ${lvl})`).setFooter(FOOTER).setTimestamp()], flags: [64] });
    }

    if (sub === 'addxp') {
      const target = interaction.options.getUser('user');
      const amount = interaction.options.getInteger('xp');
      const data   = getLevelData(guildId, target.id);
      data.xp      = (data.xp ?? 0) + amount;
      data.totalXp = (data.totalXp ?? 0) + amount;
      const needed = getXpForLevel((data.level ?? 0) + 1);
      if (data.xp >= needed) { data.xp -= needed; data.level = (data.level ?? 0) + 1; }
      if (!db.data.leveling[guildId]) db.data.leveling[guildId] = { users: {} };
      db.data.leveling[guildId].users[target.id] = data;
      await saveDb();
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(C.success).setTitle('XP Added').setDescription(`Added **${amount.toLocaleString()} XP** to **${target.username}**. Now Level ${data.level}.`).setFooter(FOOTER).setTimestamp()], flags: [64] });
    }

    if (sub === 'resetxp') {
      const target = interaction.options.getUser('user');
      if (!db.data.leveling[guildId]) db.data.leveling[guildId] = { users: {} };
      db.data.leveling[guildId].users[target.id] = { xp: 0, level: 0, totalXp: 0 };
      await saveDb();
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(C.success).setTitle('XP Reset').setDescription(`**${target.username}**'s XP has been reset to 0.`).setFooter(FOOTER).setTimestamp()], flags: [64] });
    }
  },
};
