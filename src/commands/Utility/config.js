/**
 * config.js — Admin configuration system
 * Note: setDefaultMemberPermissions only on main builder, NOT on subcommands
 */
import {
  SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType,
} from 'discord.js';
import { getDb, saveDb } from '../../utils/db.js';
import { C } from '../../utils/embeds.js';
import { moveTTS, setupTTS, getTTSState } from '../../services/ttsService.js';
import { CARRY_TYPES } from '../Carries/carry.js';
import { getVoiceConnection } from '@discordjs/voice';

const FOOTER = { text: 'TITAN Jr. Config' };

export default {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Admin configuration — carry prices, custom commands, bot settings')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommandGroup(g => g
      .setName('carry')
      .setDescription('Carry system configuration')
      .addSubcommand(s => s
        .setName('setprice')
        .setDescription('Edit price for a carry type')
        .addStringOption(o =>
          o.setName('type').setDescription('Carry type').setRequired(true)
           .addChoices(...Object.entries(CARRY_TYPES).slice(0,25).map(([v,d]) => ({ name: `${d.emoji} ${d.label}`, value: v })))
        )
        .addStringOption(o => o.setName('price').setDescription('New price e.g. 25M').setRequired(true))
      )
      .addSubcommand(s => s
        .setName('addtype')
        .setDescription('Add a custom carry type')
        .addStringOption(o => o.setName('id').setDescription('Unique ID e.g. fishing').setRequired(true))
        .addStringOption(o => o.setName('label').setDescription('Display name e.g. Fishing Carry').setRequired(true))
        .addStringOption(o => o.setName('price').setDescription('Price e.g. 10M').setRequired(true))
        .addStringOption(o => o.setName('emoji').setDescription('Emoji').setRequired(false))
        .addStringOption(o => o.setName('category').setDescription('Category').setRequired(false))
      )
      .addSubcommand(s => s.setName('prices').setDescription('View all carry prices'))
    )
    .addSubcommandGroup(g => g
      .setName('cmd')
      .setDescription('Custom command management')
      .addSubcommand(s => s
        .setName('add')
        .setDescription('Add a custom text command (e.g. !rules)')
        .addStringOption(o => o.setName('trigger').setDescription('Trigger e.g. !rules').setRequired(true))
        .addStringOption(o => o.setName('response').setDescription('Response text').setRequired(true))
        .addStringOption(o => o.setName('title').setDescription('Embed title').setRequired(false))
        .addStringOption(o => o.setName('color').setDescription('Color hex e.g. #ff6600').setRequired(false))
      )
      .addSubcommand(s => s
        .setName('remove')
        .setDescription('Remove a custom command')
        .addStringOption(o => o.setName('trigger').setDescription('Trigger to remove').setRequired(true))
      )
      .addSubcommand(s => s.setName('list').setDescription('List all custom commands'))
      .addSubcommand(s => s
        .setName('edit')
        .setDescription('Edit a custom command response')
        .addStringOption(o => o.setName('trigger').setDescription('Trigger to edit').setRequired(true))
        .addStringOption(o => o.setName('response').setDescription('New response').setRequired(true))
      )
    )
    .addSubcommandGroup(g => g
      .setName('bot')
      .setDescription('Bot voice and channel control')
      .addSubcommand(s => s
        .setName('join')
        .setDescription('Make bot join a voice channel')
        .addChannelOption(o => o.setName('channel').setDescription('Voice channel').addChannelTypes(ChannelType.GuildVoice).setRequired(true))
      )
      .addSubcommand(s => s.setName('leave').setDescription('Make bot leave voice channel'))
      .addSubcommand(s => s
        .setName('movetts')
        .setDescription('Move TTS to a different voice channel')
        .addChannelOption(o => o.setName('channel').setDescription('New voice channel').addChannelTypes(ChannelType.GuildVoice).setRequired(true))
      )
      .addSubcommand(s => s
        .setName('settschannel')
        .setDescription('Change which text channel TTS reads from')
        .addChannelOption(o => o.setName('channel').setDescription('Text channel').addChannelTypes(ChannelType.GuildText).setRequired(true))
      )
    )
    .addSubcommandGroup(g => g
      .setName('settings')
      .setDescription('Server-wide bot settings')
      .addSubcommand(s => s.setName('view').setDescription('View all bot settings for this server'))
      .addSubcommand(s => s
        .setName('prefix')
        .setDescription('Set custom command prefix')
        .addStringOption(o => o.setName('prefix').setDescription('New prefix').setRequired(true))
      )
      .addSubcommand(s => s
        .setName('setlog')
        .setDescription('Set mod log channel')
        .addChannelOption(o => o.setName('channel').setDescription('Log channel').addChannelTypes(ChannelType.GuildText).setRequired(true))
      )
    ),

  async execute(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    const group   = interaction.options.getSubcommandGroup();
    const sub     = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const db      = getDb();

    // Init config
    if (!db.data.guildConfig)                         db.data.guildConfig = {};
    if (!db.data.guildConfig[guildId])                db.data.guildConfig[guildId] = {};
    if (!db.data.guildConfig[guildId].carryPrices)   db.data.guildConfig[guildId].carryPrices = {};
    if (!db.data.guildConfig[guildId].customCarries) db.data.guildConfig[guildId].customCarries = {};
    if (!db.data.guildConfig[guildId].customCmds)    db.data.guildConfig[guildId].customCmds = {};
    const cfg = db.data.guildConfig[guildId];

    const ok  = (t, d)  => interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.success).setTitle(t).setDescription(d).setFooter(FOOTER).setTimestamp()] });
    const err = (t, d)  => interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.error).setTitle(t).setDescription(d).setFooter(FOOTER).setTimestamp()] });

    // ══ CARRY ════════════════════════════════════════════════════════
    if (group === 'carry') {
      if (sub === 'setprice') {
        const type  = interaction.options.getString('type');
        const price = interaction.options.getString('price');
        cfg.carryPrices[type] = price;
        await saveDb();
        // Auto-refresh carry panel
        if (cfg.carryChannelId && cfg.carryPanelMsgId) {
          try {
            const ch  = await client.channels.fetch(cfg.carryChannelId);
            const msg = await ch.messages.fetch(cfg.carryPanelMsgId);
            const { buildPanelEmbed, buildPanelButtons } = await import('../Carries/carry.js');
            await msg.edit({ embeds: [buildPanelEmbed(interaction.guild, guildId)], components: buildPanelButtons(guildId) });
          } catch {}
        }
        return ok('Price Updated', `**${CARRY_TYPES[type]?.emoji} ${CARRY_TYPES[type]?.label}** → **${price}**\nPanel refreshed.`);
      }

      if (sub === 'addtype') {
        const id    = interaction.options.getString('id').toLowerCase().replace(/\s/g, '_');
        const label = interaction.options.getString('label');
        const price = interaction.options.getString('price');
        const emoji = interaction.options.getString('emoji') ?? '⚔️';
        const cat   = interaction.options.getString('category') ?? 'Custom';
        cfg.customCarries[id] = { label, price, emoji, category: cat };
        cfg.carryPrices[id]   = price;
        await saveDb();
        return ok('Carry Type Added', `${emoji} **${label}** at **${price}** in category **${cat}**.`);
      }

      if (sub === 'prices') {
        const lines = Object.entries(CARRY_TYPES).map(([k, d]) => {
          const p = cfg.carryPrices[k] ?? d.price;
          return `${d.emoji} **${d.label}**: ${p}${cfg.carryPrices[k] ? ' ✏️' : ''}`;
        });
        return interaction.editReply({
          embeds: [new EmbedBuilder().setColor(C.carry).setTitle('Current Carry Prices').setDescription(lines.join('\n')).setFooter(FOOTER).setTimestamp()],
        });
      }
    }

    // ══ CMD ══════════════════════════════════════════════════════════
    if (group === 'cmd') {
      if (sub === 'add') {
        const trigger = interaction.options.getString('trigger').toLowerCase().trim();
        const response= interaction.options.getString('response');
        const title   = interaction.options.getString('title') ?? null;
        const color   = parseInt((interaction.options.getString('color') ?? '#5865f2').replace('#',''), 16) || 0x5865f2;
        cfg.customCmds[trigger] = { response, title, color };
        await saveDb();
        return ok('Command Added', `Trigger: \`${trigger}\`\nUsers can now type it in any channel.`);
      }
      if (sub === 'remove') {
        const trigger = interaction.options.getString('trigger').toLowerCase().trim();
        if (!cfg.customCmds[trigger]) return err('Not Found', `No command \`${trigger}\`.`);
        delete cfg.customCmds[trigger];
        await saveDb();
        return ok('Removed', `\`${trigger}\` deleted.`);
      }
      if (sub === 'edit') {
        const trigger  = interaction.options.getString('trigger').toLowerCase().trim();
        const response = interaction.options.getString('response');
        if (!cfg.customCmds[trigger]) return err('Not Found', `No command \`${trigger}\`.`);
        cfg.customCmds[trigger].response = response;
        await saveDb();
        return ok('Updated', `\`${trigger}\` updated.`);
      }
      if (sub === 'list') {
        const cmds = Object.entries(cfg.customCmds ?? {});
        if (!cmds.length) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.info).setTitle('No Custom Commands').setDescription('Add one with `/config cmd add`.').setFooter(FOOTER).setTimestamp()] });
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(C.info)
            .setTitle(`Custom Commands (${cmds.length})`)
            .setDescription(cmds.map(([t, d]) => `\`${t}\` → ${(d.response ?? '').slice(0,60)}`).join('\n'))
            .setFooter(FOOTER).setTimestamp()
          ],
        });
      }
    }

    // ══ BOT ══════════════════════════════════════════════════════════
    if (group === 'bot') {
      if (sub === 'join') {
        const channel = interaction.options.getChannel('channel');
        const { joinVoiceChannel } = await import('@discordjs/voice');
        const conn = joinVoiceChannel({
          channelId: channel.id, guildId,
          adapterCreator: interaction.guild.voiceAdapterCreator,
          selfDeaf: false,
        });
        await new Promise(r => setTimeout(r, 1500));
        return ok('Joined', `Bot joined **${channel.name}**.`);
      }
      if (sub === 'leave') {
        const conn = getVoiceConnection(guildId);
        if (conn) { conn.destroy(); return ok('Left', 'Bot left the voice channel.'); }
        return err('Not Connected', 'Bot is not in a voice channel.');
      }
      if (sub === 'movetts') {
        const channel = interaction.options.getChannel('channel');
        const state   = getTTSState(guildId);
        if (!state) {
          await setupTTS(interaction.guild, channel.id);
          db.data.ttsVoiceChannel[guildId] = channel.id;
          await saveDb();
          return ok('TTS Started', `TTS active in **${channel.name}**.`);
        }
        const moved = await moveTTS(interaction.guild, channel.id);
        if (moved) {
          db.data.ttsVoiceChannel[guildId] = channel.id;
          await saveDb();
          return ok('TTS Moved', `TTS moved to **${channel.name}**.`);
        }
        return err('Move Failed', 'Could not move TTS to that channel.');
      }
      if (sub === 'settschannel') {
        const channel = interaction.options.getChannel('channel');
        db.data.ttsChannels[guildId] = channel.id;
        await saveDb();
        return ok('TTS Channel Updated', `TTS now reads from ${channel}.`);
      }
    }

    // ══ SETTINGS ═════════════════════════════════════════════════════
    if (group === 'settings') {
      if (sub === 'view') {
        const ttsChId = db.data.ttsChannels?.[guildId];
        const vcId    = db.data.ttsVoiceChannel?.[guildId];
        const welcome = db.data.welcomeConfig?.[guildId];
        const levCfg  = db.data.leveling?.[guildId]?.config;
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(C.info)
            .setTitle(`${interaction.guild.name} — Bot Settings`)
            .addFields(
              { name: 'Prefix',       value: cfg.prefix ?? '!',                                    inline: true },
              { name: 'TTS Text',     value: ttsChId ? `<#${ttsChId}>` : 'Off',                   inline: true },
              { name: 'TTS Voice',    value: vcId    ? `<#${vcId}>`    : 'Off',                   inline: true },
              { name: 'Welcome',      value: welcome?.enabled ? `<#${welcome.channel}>` : 'Off',  inline: true },
              { name: 'Leveling',     value: levCfg?.enabled  ? 'On'  : 'Off',                    inline: true },
              { name: 'Custom Cmds',  value: `${Object.keys(cfg.customCmds ?? {}).length}`,       inline: true },
              { name: 'Carry Channel',value: cfg.carryChannelId ? `<#${cfg.carryChannelId}>` : 'Not set', inline: true },
            )
            .setFooter(FOOTER).setTimestamp()
          ],
        });
      }
      if (sub === 'prefix') {
        cfg.prefix = interaction.options.getString('prefix');
        await saveDb();
        return ok('Prefix Updated', `Custom command prefix: \`${cfg.prefix}\``);
      }
      if (sub === 'setlog') {
        const ch = interaction.options.getChannel('channel');
        cfg.logChannel = ch.id;
        await saveDb();
        return ok('Log Channel Set', `Mod logs → ${ch}`);
      }
    }
  },
};
