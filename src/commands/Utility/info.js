import { SlashCommandBuilder, EmbedBuilder, version as djsVersion } from 'discord.js';
import { C, formatNumber, DIVIDER } from '../../utils/embeds.js';
import os from 'os';

const FOOTER = { text: 'TITAN Jr. • Hypixel Skyblock Bot' };

function uptime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h ${m % 60}m`;
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  return `${m}m ${s % 60}s`;
}

export default {
  data: new SlashCommandBuilder()
    .setName('info')
    .setDescription('Bot and server information')
    .addSubcommand(s => s.setName('bot').setDescription('Bot stats and information'))
    .addSubcommand(s => s.setName('server').setDescription('Server information'))
    .addSubcommand(s => s
      .setName('user')
      .setDescription('User information')
      .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(false))
    )
    .addSubcommand(s => s.setName('ping').setDescription('Check bot latency'))
    .addSubcommand(s => s.setName('help').setDescription('Full command list')),

  async execute(interaction, client) {
    const sub = interaction.options.getSubcommand();

    // ── PING ──────────────────────────────────────────────────────────
    if (sub === 'ping') {
      const sent = await interaction.reply({ content: '...', fetchReply: true });
      const rt   = sent.createdTimestamp - interaction.createdTimestamp;
      const ws   = client.ws.ping;
      const status = ws < 100 ? '🟢 Excellent' : ws < 200 ? '🟡 Good' : '🔴 Poor';

      return interaction.editReply({
        content: '',
        embeds: [new EmbedBuilder()
          .setColor(ws < 100 ? C.success : ws < 200 ? C.warning : C.error)
          .setTitle('Network Latency')
          .addFields(
            { name: 'Roundtrip',    value: `\`${rt}ms\``,    inline: true },
            { name: 'API / WS',     value: `\`${ws}ms\``,    inline: true },
            { name: 'Status',       value: status,            inline: true },
          )
          .setFooter(FOOTER).setTimestamp()
        ],
      });
    }

    // ── BOT INFO ──────────────────────────────────────────────────────
    if (sub === 'bot') {
      await interaction.deferReply();
      const mem  = process.memoryUsage();
      const ramMB = (mem.heapUsed / 1024 / 1024).toFixed(1);
      const totalServers = client.guilds.cache.size;
      const totalUsers   = client.guilds.cache.reduce((a, g) => a + g.memberCount, 0);

      const embed = new EmbedBuilder()
        .setColor(C.info)
        .setAuthor({ name: 'TITAN Jr.', iconURL: client.user.displayAvatarURL() })
        .setTitle('Bot Information')
        .setThumbnail(client.user.displayAvatarURL({ size: 256 }))
        .setDescription('All-in-one Hypixel Skyblock Discord bot — AH flipping, profile viewer, carries, music, moderation and more.')
        .addFields(
          { name: 'Uptime',       value: uptime(client.uptime),           inline: true },
          { name: 'Memory',       value: `${ramMB} MB`,                   inline: true },
          { name: 'Ping',         value: `${client.ws.ping}ms`,           inline: true },
          { name: 'Servers',      value: formatNumber(totalServers),       inline: true },
          { name: 'Users',        value: formatNumber(totalUsers),         inline: true },
          { name: 'Commands',     value: `${client.commands.size}`,        inline: true },
          { name: 'Node.js',      value: process.version,                  inline: true },
          { name: 'Discord.js',   value: `v${djsVersion}`,                inline: true },
          { name: 'Platform',     value: os.platform(),                    inline: true },
        )
        .setFooter(FOOTER).setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // ── SERVER INFO ───────────────────────────────────────────────────
    if (sub === 'server') {
      await interaction.deferReply();
      const g = interaction.guild;
      await g.fetch();

      const verifyLevels = { 0: 'None', 1: 'Low', 2: 'Medium', 3: 'High', 4: 'Highest' };
      const boostTiers   = { 0: 'No Tier', 1: 'Tier I', 2: 'Tier II', 3: 'Tier III' };

      const textChannels  = g.channels.cache.filter(c => c.type === 0).size;
      const voiceChannels = g.channels.cache.filter(c => c.type === 2).size;

      const embed = new EmbedBuilder()
        .setColor(C.info)
        .setAuthor({ name: g.name, iconURL: g.iconURL() ?? undefined })
        .setTitle('Server Information')
        .setThumbnail(g.iconURL({ size: 256 }) ?? null)
        .addFields(
          { name: 'Owner',          value: `<@${g.ownerId}>`,                                      inline: true  },
          { name: 'Created',        value: `<t:${Math.floor(g.createdTimestamp/1000)}:D>`,         inline: true  },
          { name: 'Region',         value: g.preferredLocale,                                      inline: true  },
          { name: 'Members',        value: formatNumber(g.memberCount),                            inline: true  },
          { name: 'Channels',       value: `${textChannels} text · ${voiceChannels} voice`,        inline: true  },
          { name: 'Roles',          value: formatNumber(g.roles.cache.size),                       inline: true  },
          { name: 'Boosts',         value: `${g.premiumSubscriptionCount} · ${boostTiers[g.premiumTier]}`, inline: true },
          { name: 'Verification',   value: verifyLevels[g.verificationLevel],                      inline: true  },
          { name: 'Server ID',      value: `\`${g.id}\``,                                         inline: true  },
        )
        .setImage(g.bannerURL({ size: 1024 }) ?? null)
        .setFooter(FOOTER).setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // ── USER INFO ─────────────────────────────────────────────────────
    if (sub === 'user') {
      await interaction.deferReply();
      const user   = interaction.options.getUser('user') ?? interaction.user;
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      await user.fetch(); // get banner

      const roles = member?.roles.cache
        .filter(r => r.id !== interaction.guild.id)
        .sort((a, b) => b.position - a.position)
        .map(r => `${r}`)
        .slice(0, 10)
        .join(' ') || 'None';

      const badges = {
        Staff:              '👨‍💼',
        Partner:            '🤝',
        Hypesquad:          '🏠',
        BugHunterLevel1:    '🐛',
        BugHunterLevel2:    '🐛',
        HypeSquadOnlineHouse1: '⚡',
        HypeSquadOnlineHouse2: '🧠',
        HypeSquadOnlineHouse3: '💖',
        PremiumEarlySupporter: '⭐',
        ActiveDeveloper:    '💻',
        VerifiedBotDeveloper:'💻',
      };
      const userBadges = (user.flags?.toArray() ?? []).map(f => badges[f] ?? '').filter(Boolean).join(' ') || 'None';

      const embed = new EmbedBuilder()
        .setColor(member?.displayColor || C.info)
        .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
        .setTitle('User Information')
        .setThumbnail(user.displayAvatarURL({ size: 256 }))
        .addFields(
          { name: 'Display Name',  value: member?.displayName ?? user.username,                     inline: true },
          { name: 'Account Type', value: user.bot ? '🤖 Bot' : '👤 Human',                         inline: true },
          { name: 'Badges',       value: userBadges,                                                inline: true },
          { name: 'Created',      value: `<t:${Math.floor(user.createdTimestamp/1000)}:D>`,         inline: true },
          { name: 'Joined Server',value: member ? `<t:${Math.floor(member.joinedTimestamp/1000)}:D>` : 'N/A', inline: true },
          { name: 'Highest Role', value: `${member?.roles.highest ?? 'None'}`,                     inline: true },
          { name: `Roles (${member?.roles.cache.size - 1 ?? 0})`, value: roles,                    inline: false },
          { name: 'User ID',      value: `\`${user.id}\``,                                         inline: true },
        )
        .setImage(user.bannerURL({ size: 1024 }) ?? null)
        .setFooter(FOOTER).setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    // ── HELP ──────────────────────────────────────────────────────────
    if (sub === 'help') {
      const embed = new EmbedBuilder()
        .setColor(C.info)
        .setAuthor({ name: 'TITAN Jr. Commands', iconURL: client.user.displayAvatarURL() })
        .setTitle('Command Reference')
        .setDescription('A complete list of all available commands.')
        .addFields(
          {
            name: '⚔️  Hypixel Skyblock',
            value: '`/link` `/profile` `/auction` `/bazaar`\n`!ah <question>` — AI auction assistant',
            inline: false,
          },
          {
            name: '🛡️  Carry System',
            value: '`/carry register` `/carry request` `/carry list` `/carry prices`\n`/partyfinder lfg` `/partyfinder list`',
            inline: false,
          },
          {
            name: '🎵  Music',
            value: '`/music play` `/music skip` `/music stop` `/music queue`\n`/music pause` `/music resume` `/music loop` `/music volume`',
            inline: false,
          },
          {
            name: '💰  Economy',
            value: '`/economy balance` `/economy daily` `/economy work` `/economy crime`\n`/economy gamble` `/economy pay` `/economy rob` `/economy leaderboard`',
            inline: false,
          },
          {
            name: '📈  Leveling',
            value: '`/leveling setup` `/leveling rank` `/leveling leaderboard`\n`/leveling addxp` `/leveling setxp` `/leveling resetxp`',
            inline: false,
          },
          {
            name: '🔨  Moderation',
            value: '`/mod ban` `/mod kick` `/mod timeout` `/mod warn` `/mod purge`\n`/mod lock` `/mod unlock` `/warns add` `/warns list`',
            inline: false,
          },
          {
            name: '🎫  Server Tools',
            value: '`/ticket setup` `/giveaway create` `/welcome setup`\n`/reactionroles add` `/role add` `/admin announce`',
            inline: false,
          },
          {
            name: '🔊  TTS',
            value: '`/tts start` `/tts stop` `/tts say` `/tts skip` `/tts status`\nSupports Roman Urdu, Hindi, Urdu script & English',
            inline: false,
          },
          {
            name: '⬇️  Downloader & Tools',
            value: '`/download` `/removebg` `/tools calc` `/tools color`\n`/tools password` `/tools avatar` `/tools timestamp`',
            inline: false,
          },
          {
            name: '⚙️  Admin Config',
            value: '`/config carry setprice` `/config cmd add` `/config bot join`\n`/config settings view` `/premium add`',
            inline: false,
          },
        )
        .setFooter(FOOTER).setTimestamp();

      return interaction.reply({ embeds: [embed], flags: [64] });
    }
  },
};
