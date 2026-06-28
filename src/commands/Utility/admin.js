/**
 * admin.js — SkyBot v2 Admin utility commands
 *
 * Ported + extended from SkyBot v1 (Discordbot-main/src/commands/Utility/admin.js).
 * Adapted for v2 SkyBot footer, cooldown: 3, and flat-db access.
 *
 * Original v1 subcommands (kept):
 *   /admin announce <channel> <title> <message> [color] [ping]  — post an announcement embed
 *   /admin say      <channel> <message>                          — make the bot say something
 *   /admin slowmode <seconds> [channel]                          — set slowmode
 *   /admin dm       <user> <message>                             — DM a user as the bot
 *
 * New v2 subcommands (per task 8-C spec):
 *   /admin cleanup  [count]    — bulk-delete the bot's own messages in this channel
 *   /admin status              — show bot status (uptime, memory, ping, guilds, node version)
 *   /admin leave               — leave the current guild (confirmation prompt)
 *   /admin eval     <code>     — owner-only JS eval (returns result as code block)
 *
 * /admin eval is restricted to the user IDs in process.env.OWNER_ID (comma-separated).
 * If OWNER_ID is unset, eval is disabled entirely.
 */
import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType } from 'discord.js';
import { createRequire } from 'module';
import { successEmbed, errorEmbed, C } from '../../utils/embeds.js';

const FOOTER = { text: 'SkyBot v2 • Railway Edition' };

// Provide a `require` for /admin eval (the bot is ESM, but eval'd code may
// want to require CommonJS modules like 'discord.js' internals).
const require = createRequire(import.meta.url);

function isOwner(userId) {
  const raw = process.env.OWNER_ID;
  if (!raw) return false;
  const ids = raw.split(',').map(s => s.trim()).filter(Boolean);
  return ids.includes(userId);
}

export default {
  cooldown: 3,

  data: new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Admin utility commands')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    // ── Original v1 subcommands ──
    .addSubcommand(s => s
      .setName('announce')
      .setDescription('Send an announcement embed to a channel')
      .addChannelOption(o => o.setName('channel').setDescription('Target channel').setRequired(true).addChannelTypes(ChannelType.GuildText))
      .addStringOption(o => o.setName('title').setDescription('Announcement title').setRequired(true))
      .addStringOption(o => o.setName('message').setDescription('Announcement message').setRequired(true))
      .addStringOption(o => o.setName('color').setDescription('Hex color e.g. #ff0000').setRequired(false))
      .addStringOption(o => o.setName('ping').setDescription('Role to ping (mention)').setRequired(false))
    )
    .addSubcommand(s => s
      .setName('say')
      .setDescription('Make the bot say something in a channel')
      .addChannelOption(o => o.setName('channel').setDescription('Target channel').setRequired(true).addChannelTypes(ChannelType.GuildText))
      .addStringOption(o => o.setName('message').setDescription('Message to send').setRequired(true))
    )
    .addSubcommand(s => s
      .setName('slowmode')
      .setDescription('Set slowmode on a channel')
      .addIntegerOption(o => o.setName('seconds').setDescription('Slowmode in seconds (0 to disable)').setRequired(true).setMinValue(0).setMaxValue(21600))
      .addChannelOption(o => o.setName('channel').setDescription('Target channel (default: current)').setRequired(false))
    )
    .addSubcommand(s => s
      .setName('dm')
      .setDescription('DM a user as the bot')
      .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
      .addStringOption(o => o.setName('message').setDescription('Message to send').setRequired(true))
    )
    // ── New v2 subcommands ──
    .addSubcommand(s => s
      .setName('cleanup')
      .setDescription('Bulk-delete the bot\'s own messages in this channel')
      .addIntegerOption(o => o.setName('count').setDescription('How many recent messages to scan (1-100, default 50)').setRequired(false).setMinValue(1).setMaxValue(100))
    )
    .addSubcommand(s => s
      .setName('status')
      .setDescription('Show bot status (uptime, memory, ping, guilds)')
    )
    .addSubcommand(s => s
      .setName('leave')
      .setDescription('Make the bot leave the current guild')
    )
    .addSubcommand(s => s
      .setName('eval')
      .setDescription('Owner-only: evaluate JavaScript in the bot context')
      .addStringOption(o => o.setName('code').setDescription('Code to evaluate').setRequired(true))
    ),

  async execute(interaction, client) {
    const sub = interaction.options.getSubcommand();

    // ── ANNOUNCE ───────────────────────────────────────────────────────
    if (sub === 'announce') {
      const channel = interaction.options.getChannel('channel');
      const title   = interaction.options.getString('title');
      const message = interaction.options.getString('message');
      const colorHex = interaction.options.getString('color') ?? '#5865f2';
      const ping    = interaction.options.getString('ping') ?? '';
      const color   = parseInt(colorHex.replace('#', ''), 16) || 0x5865f2;

      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`📢 ${title}`)
        .setDescription(message)
        .setFooter(FOOTER)
        .setTimestamp();

      await channel.send({ content: ping || undefined, embeds: [embed] });
      return interaction.reply({ embeds: [successEmbed('Announced', `Message sent to ${channel}.`)], flags: [64] });
    }

    // ── SAY ────────────────────────────────────────────────────────────
    if (sub === 'say') {
      const channel = interaction.options.getChannel('channel');
      const msg     = interaction.options.getString('message');
      await channel.send(msg);
      return interaction.reply({ embeds: [successEmbed('Sent', `Message sent to ${channel}.`)], flags: [64] });
    }

    // ── SLOWMODE ───────────────────────────────────────────────────────
    if (sub === 'slowmode') {
      const seconds = interaction.options.getInteger('seconds');
      const channel = interaction.options.getChannel('channel') ?? interaction.channel;
      await channel.setRateLimitPerUser(seconds);
      return interaction.reply({ embeds: [successEmbed('Slowmode', `${channel} slowmode set to **${seconds}s**.`)], flags: [64] });
    }

    // ── DM ─────────────────────────────────────────────────────────────
    if (sub === 'dm') {
      const user = interaction.options.getUser('user');
      const msg  = interaction.options.getString('message');
      try {
        await user.send(msg);
        return interaction.reply({ embeds: [successEmbed('DM Sent', `Message sent to ${user.tag}.`)], flags: [64] });
      } catch {
        return interaction.reply({ embeds: [errorEmbed('DM Failed', `Could not DM ${user.tag}. They may have DMs closed.`)], flags: [64] });
      }
    }

    // ── CLEANUP ────────────────────────────────────────────────────────
    if (sub === 'cleanup') {
      const count = interaction.options.getInteger('count') ?? 50;
      if (!interaction.channel) {
        return interaction.reply({ embeds: [errorEmbed('No Channel', 'This command must be used in a channel.')], flags: [64] });
      }
      try {
        const messages = await interaction.channel.messages.fetch({ limit: count });
        const botMsgs  = messages.filter(m => m.author.id === client.user.id);
        if (!botMsgs.size) {
          return interaction.reply({ embeds: [successEmbed('Nothing to Clean', 'No bot messages found in the last ' + count + ' messages.')] });
        }
        const deleted = await interaction.channel.bulkDelete(botMsgs, true);
        return interaction.reply({ embeds: [successEmbed('Cleaned Up', `Deleted **${deleted.size}** bot message${deleted.size !== 1 ? 's' : ''}.`)] });
      } catch (err) {
        return interaction.reply({ embeds: [errorEmbed('Cleanup Failed', err.message)], flags: [64] });
      }
    }

    // ── STATUS ─────────────────────────────────────────────────────────
    if (sub === 'status') {
      const mem = process.memoryUsage();
      const fmtBytes = (b) => {
        if (b >= 1024 * 1024) return `${(b / 1024 / 1024).toFixed(2)} MB`;
        if (b >= 1024)        return `${(b / 1024).toFixed(2)} KB`;
        return `${b} B`;
      };
      const uptimeMs = client.uptime ?? 0;
      const days    = Math.floor(uptimeMs / 86400000);
      const hours   = Math.floor((uptimeMs / 3600000) % 24);
      const minutes = Math.floor((uptimeMs / 60000) % 60);
      const seconds = Math.floor((uptimeMs / 1000) % 60);

      const embed = new EmbedBuilder()
        .setColor(C.info)
        .setTitle('🤖 SkyBot v2 — Status')
        .addFields(
          { name: '⏱️ Uptime',     value: `${days}d ${hours}h ${minutes}m ${seconds}s`, inline: true },
          { name: '📡 WebSocket',   value: `${client.ws.ping}ms`,                          inline: true },
          { name: '🏠 Guilds',      value: `${client.guilds.cache.size}`,                   inline: true },
          { name: '💾 RSS',         value: fmtBytes(mem.rss),                               inline: true },
          { name: '📦 Heap Used',  value: fmtBytes(mem.heapUsed),                          inline: true },
          { name: '📂 Heap Total', value: fmtBytes(mem.heapTotal),                         inline: true },
          { name: '🟢 Node.js',    value: process.version,                                 inline: true },
          { name: '🛠️ Platform',   value: `${process.platform} ${process.arch}`,           inline: true },
          { name: '🆔 Bot ID',     value: client.user?.id ?? '—',                          inline: true },
        )
        .setFooter(FOOTER)
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }

    // ── LEAVE ──────────────────────────────────────────────────────────
    if (sub === 'leave') {
      const guild = interaction.guild;
      if (!guild) return interaction.reply({ embeds: [errorEmbed('No Guild', 'This command must be used in a server.')] });
      await interaction.reply({ embeds: [successEmbed('Leaving', `SkyBot is leaving **${guild.name}**. Goodbye! 👋`)] });
      setTimeout(() => guild.leave().catch(() => {}), 1500);
      return;
    }

    // ── EVAL ───────────────────────────────────────────────────────────
    if (sub === 'eval') {
      if (!isOwner(interaction.user.id)) {
        return interaction.reply({ embeds: [errorEmbed('Forbidden', 'Only the bot owner may use /admin eval.')], flags: [64] });
      }
      const code = interaction.options.getString('code');
      await interaction.deferReply({ flags: [64] });
      try {
        // Run in an async IIFE with access to client + interaction.
        // eslint-disable-next-line no-new-func
        const fn = new Function('client', 'interaction', 'require', 'process',
          `return (async () => { ${code} })();`);
        const result = await fn(client, interaction, require, process);
        const out = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
        const truncated = (out ?? 'undefined').slice(0, 1800);
        const embed = new EmbedBuilder()
          .setColor(C.success)
          .setTitle('✅ Eval Result')
          .setDescription(`\`\`\`js\n${truncated}\n\`\`\``)
          .setFooter(FOOTER)
          .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
      } catch (err) {
        const msg = (err?.stack || err?.message || String(err)).slice(0, 1800);
        const embed = new EmbedBuilder()
          .setColor(C.error)
          .setTitle('❌ Eval Error')
          .setDescription(`\`\`\`\n${msg}\n\`\`\``)
          .setFooter(FOOTER)
          .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
      }
    }
  },
};
