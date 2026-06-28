/**
 * config.js — SkyBot v2 Server configuration command
 *
 * Replaces v1's Utility/config.js (which was carry/cmd/bot-voice focused).
 * The carry/tts/custom-command config has been moved to dedicated commands
 * (/carry, /tts); this command now centralizes the server-wide settings
 * the task spec calls out: view, set, reset, welcome, goodbye, autorole,
 * logging, birthday.
 *
 * Flat-db paths used:
 *   db.guildConfig[guildId]       — arbitrary key/value store (prefix, etc.)
 *   db.welcomeConfig[guildId]     — welcome message settings
 *   db.goodbyeConfig[guildId]     — goodbye message settings
 *   db.autoRole[guildId]          — array of role IDs assigned on join
 *   db.loggingConfig[guildId]     — { channel, enabled }
 *   db.birthdayChannel[guildId]   — birthday announcement channel ID
 *   db.birthdays[guildId]         — { [userId]: { day, month } }
 */
import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType } from 'discord.js';
import { getDb, saveDb } from '../../utils/db.js';
import { successEmbed, errorEmbed, infoEmbed, warningEmbed, C } from '../../utils/embeds.js';

const FOOTER = { text: 'SkyBot v2 • Railway Edition' };

// Allowlist of /config set keys (prevents arbitrary pollution of guildConfig)
const SETTABLE_KEYS = new Set([
  'prefix',
]);

export default {
  cooldown: 3,

  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Server configuration — view & edit SkyBot settings')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s
      .setName('view')
      .setDescription('View all SkyBot settings for this server')
    )
    .addSubcommand(s => s
      .setName('set')
      .setDescription('Set a server config key (e.g. prefix)')
      .addStringOption(o => o.setName('key').setDescription('Config key').setRequired(true)
        .addChoices({ name: 'prefix', value: 'prefix' })
      )
      .addStringOption(o => o.setName('value').setDescription('New value').setRequired(true))
    )
    .addSubcommand(s => s
      .setName('reset')
      .setDescription('Reset this server\'s guildConfig (preserves welcome/goodbye/autorole)')
    )
    .addSubcommand(s => s
      .setName('welcome')
      .setDescription('Toggle welcome messages on/off (configure via /welcome setup)')
      .addBooleanOption(o => o.setName('enabled').setDescription('Enable welcome messages?').setRequired(true))
    )
    .addSubcommand(s => s
      .setName('goodbye')
      .setDescription('Toggle goodbye messages on/off (configure via /welcome goodbye)')
      .addBooleanOption(o => o.setName('enabled').setDescription('Enable goodbye messages?').setRequired(true))
    )
    .addSubcommand(s => s
      .setName('autorole')
      .setDescription('List or clear auto-assigned roles (add via /welcome autorole)')
      .addStringOption(o => o.setName('action').setDescription('Action').setRequired(true)
        .addChoices(
          { name: 'list',  value: 'list'  },
          { name: 'clear', value: 'clear' },
        )
      )
    )
    .addSubcommand(s => s
      .setName('logging')
      .setDescription('Set or clear the moderation log channel')
      .addChannelOption(o => o.setName('channel').setDescription('Log channel (omit to disable)').addChannelTypes(ChannelType.GuildText).setRequired(false))
    )
    .addSubcommand(s => s
      .setName('birthday')
      .setDescription('Set or clear the birthday announcement channel')
      .addChannelOption(o => o.setName('channel').setDescription('Birthday channel (omit to disable)').addChannelTypes(ChannelType.GuildText).setRequired(false))
    ),

  async execute(interaction, client) {
    await interaction.deferReply({ flags: [64] });

    const sub     = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const db      = getDb();

    // Ensure flat-db structures exist
    if (!db.guildConfig)            db.guildConfig = {};
    if (!db.guildConfig[guildId])   db.guildConfig[guildId] = {};
    if (!db.welcomeConfig)          db.welcomeConfig = {};
    if (!db.goodbyeConfig)          db.goodbyeConfig = {};
    if (!db.autoRole)               db.autoRole = {};
    if (!db.loggingConfig)          db.loggingConfig = {};
    if (!db.birthdayChannel)        db.birthdayChannel = {};

    const cfg = db.guildConfig[guildId];

    // ── VIEW ───────────────────────────────────────────────────────────
    if (sub === 'view') {
      const wlc  = db.welcomeConfig[guildId];
      const bye  = db.goodbyeConfig[guildId];
      const arol = db.autoRole[guildId] ?? [];
      const log  = db.loggingConfig[guildId];
      const bdCh = db.birthdayChannel[guildId];
      const warnCount = Object.values(db.warnings?.[guildId] ?? {}).reduce((s, a) => s + (a?.length ?? 0), 0);
      const bdCount   = Object.keys(db.birthdays?.[guildId] ?? {}).length;

      const embed = new EmbedBuilder()
        .setColor(C.info)
        .setTitle(`⚙️ ${interaction.guild.name} — Configuration`)
        .addFields(
          { name: 'Prefix',           value: `\`${cfg.prefix ?? '!'}\``,                          inline: true  },
          { name: 'Welcome',          value: wlc?.enabled ? `✅ <#${wlc.channel}>` : '❌ Off',     inline: true  },
          { name: 'Goodbye',          value: bye?.enabled ? `✅ <#${bye.channel}>` : '❌ Off',     inline: true  },
          { name: 'Auto Roles',       value: arol.length ? arol.map(r => `<@&${r}>`).join(', ') : 'None', inline: true },
          { name: 'Mod Log',          value: log?.enabled && log.channel ? `✅ <#${log.channel}>` : '❌ Off', inline: true },
          { name: 'Birthday Channel', value: bdCh ? `✅ <#${bdCh}>` : '❌ Off',                     inline: true  },
          { name: 'Total Warnings',   value: `${warnCount}`,                                       inline: true  },
          { name: 'Birthday Records', value: `${bdCount}`,                                         inline: true  },
          { name: 'TTS Voice',        value: db.ttsVoiceChannel?.[guildId] ? `<#${db.ttsVoiceChannel[guildId]}>` : '❌ Off', inline: true },
        )
        .setFooter(FOOTER)
        .setTimestamp();
      return interaction.editReply({ embeds: [embed] });
    }

    // ── SET ────────────────────────────────────────────────────────────
    if (sub === 'set') {
      const key   = interaction.options.getString('key');
      const value = interaction.options.getString('value');
      if (!SETTABLE_KEYS.has(key)) {
        return interaction.editReply({ embeds: [errorEmbed('Invalid Key', `Allowed keys: ${[...SETTABLE_KEYS].join(', ')}`)] });
      }
      cfg[key] = value;
      await saveDb();
      return interaction.editReply({ embeds: [successEmbed('Setting Updated', `\`${key}\` → \`${value}\``)] });
    }

    // ── RESET ──────────────────────────────────────────────────────────
    if (sub === 'reset') {
      db.guildConfig[guildId] = {};
      await saveDb();
      return interaction.editReply({ embeds: [successEmbed('Reset', 'Server guildConfig cleared. Welcome/goodbye/autorole/logging/birthday preserved.')] });
    }

    // ── WELCOME ────────────────────────────────────────────────────────
    if (sub === 'welcome') {
      const enabled = interaction.options.getBoolean('enabled');
      if (!db.welcomeConfig[guildId]) db.welcomeConfig[guildId] = { channel: null, message: '', ping: false, image: null, enabled: false };
      db.welcomeConfig[guildId].enabled = enabled;
      await saveDb();
      if (enabled && !db.welcomeConfig[guildId].channel) {
        return interaction.editReply({ embeds: [warningEmbed('Enabled (no channel)', 'Welcome is on but no channel/message is configured. Run `/welcome setup`.')] });
      }
      return interaction.editReply({ embeds: [successEmbed('Welcome', `Welcome messages **${enabled ? 'enabled' : 'disabled'}**.`)] });
    }

    // ── GOODBYE ────────────────────────────────────────────────────────
    if (sub === 'goodbye') {
      const enabled = interaction.options.getBoolean('enabled');
      if (!db.goodbyeConfig[guildId]) db.goodbyeConfig[guildId] = { channel: null, message: '', enabled: false };
      db.goodbyeConfig[guildId].enabled = enabled;
      await saveDb();
      if (enabled && !db.goodbyeConfig[guildId].channel) {
        return interaction.editReply({ embeds: [warningEmbed('Enabled (no channel)', 'Goodbye is on but no channel/message is configured. Run `/welcome goodbye`.')] });
      }
      return interaction.editReply({ embeds: [successEmbed('Goodbye', `Goodbye messages **${enabled ? 'enabled' : 'disabled'}**.`)] });
    }

    // ── AUTOROLE ───────────────────────────────────────────────────────
    if (sub === 'autorole') {
      const action = interaction.options.getString('action');
      const roles  = db.autoRole[guildId] ?? [];
      if (action === 'list') {
        if (!roles.length) return interaction.editReply({ embeds: [infoEmbed('Auto Roles', 'No auto-roles set. Use `/welcome autorole` to add one.')] });
        const embed = new EmbedBuilder()
          .setColor(C.info)
          .setTitle('🎭 Auto-Assigned Roles')
          .setDescription(roles.map(r => `<@&${r}>`).join('\n'))
          .setFooter(FOOTER)
          .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
      }
      if (action === 'clear') {
        db.autoRole[guildId] = [];
        await saveDb();
        return interaction.editReply({ embeds: [successEmbed('Cleared', 'All auto-roles removed.')] });
      }
    }

    // ── LOGGING ────────────────────────────────────────────────────────
    if (sub === 'logging') {
      const channel = interaction.options.getChannel('channel');
      if (!channel) {
        db.loggingConfig[guildId] = { channel: null, enabled: false };
        await saveDb();
        return interaction.editReply({ embeds: [successEmbed('Logging Off', 'Moderation logging disabled.')] });
      }
      db.loggingConfig[guildId] = { channel: channel.id, enabled: true };
      await saveDb();
      return interaction.editReply({ embeds: [successEmbed('Log Channel Set', `Moderation logs → ${channel}`)] });
    }

    // ── BIRTHDAY ───────────────────────────────────────────────────────
    if (sub === 'birthday') {
      const channel = interaction.options.getChannel('channel');
      if (!channel) {
        delete db.birthdayChannel[guildId];
        await saveDb();
        return interaction.editReply({ embeds: [successEmbed('Birthday Channel Off', 'Birthday announcements disabled.')] });
      }
      db.birthdayChannel[guildId] = channel.id;
      await saveDb();
      return interaction.editReply({ embeds: [successEmbed('Birthday Channel Set', `Birthday announcements → ${channel}`)] });
    }
  },
};
