/**
 * carry.js — Full carry system with dedicated channel management
 * 
 * How it works:
 * Admin sets a carry channel with /carry setup
 * Bot posts a permanent carry panel with buttons for each type
 * Users click a button → bot creates a private carry thread
 * Carry providers get pinged → negotiate in thread → done
 * 
 * Admin commands: /carry setup, /carry setprice, /carry addtype, /carry panel
 * User commands:  /carry register, /carry unregister, /carry list, /carry prices
 */
import {
  SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle,
  ChannelType, PermissionFlagsBits, ThreadAutoArchiveDuration,
} from 'discord.js';
import { getDb, saveDb } from '../../utils/db.js';
import { C } from '../../utils/embeds.js';

const FOOTER = { text: 'TITAN Jr. Carry System' };

export const CARRY_TYPES = {
  'f1': { label: 'F1',         emoji: '🗡️', price: '500K',  category: 'Dungeons Normal' },
  'f2': { label: 'F2',         emoji: '🗡️', price: '1M',    category: 'Dungeons Normal' },
  'f3': { label: 'F3',         emoji: '⚔️',  price: '2M',    category: 'Dungeons Normal' },
  'f4': { label: 'F4',         emoji: '⚔️',  price: '4M',    category: 'Dungeons Normal' },
  'f5': { label: 'F5',         emoji: '🔥',  price: '8M',    category: 'Dungeons Normal' },
  'f6': { label: 'F6',         emoji: '🔥',  price: '15M',   category: 'Dungeons Normal' },
  'f7': { label: 'F7',         emoji: '💀',  price: '30M',   category: 'Dungeons Normal' },
  'm1': { label: 'M1',         emoji: '🌟',  price: '15M',   category: 'Dungeons Master' },
  'm2': { label: 'M2',         emoji: '🌟',  price: '25M',   category: 'Dungeons Master' },
  'm3': { label: 'M3',         emoji: '⭐',  price: '40M',   category: 'Dungeons Master' },
  'm4': { label: 'M4',         emoji: '⭐',  price: '60M',   category: 'Dungeons Master' },
  'm5': { label: 'M5',         emoji: '👑',  price: '80M',   category: 'Dungeons Master' },
  'm6': { label: 'M6',         emoji: '👑',  price: '120M',  category: 'Dungeons Master' },
  'm7': { label: 'M7',         emoji: '💎',  price: '200M',  category: 'Dungeons Master' },
  'rev':  { label: 'Revenant', emoji: '🧟',  price: '5M',    category: 'Slayer' },
  'tar':  { label: 'Tarantula',emoji: '🕷️',  price: '5M',    category: 'Slayer' },
  'sven': { label: 'Sven',     emoji: '🐺',  price: '5M',    category: 'Slayer' },
  'eman': { label: 'Enderman', emoji: '👾',  price: '8M',    category: 'Slayer' },
  'blaze':{ label: 'Blaze',    emoji: '🔥',  price: '10M',   category: 'Slayer' },
  'vamp': { label: 'Vampire',  emoji: '🧛',  price: '10M',   category: 'Slayer' },
  'kb':   { label: 'Kuudra Basic',   emoji: '🐉', price: '3M',  category: 'Kuudra' },
  'kh':   { label: 'Kuudra Hot',     emoji: '🐉', price: '6M',  category: 'Kuudra' },
  'kbu':  { label: 'Kuudra Burning', emoji: '🐉', price: '12M', category: 'Kuudra' },
  'ki':   { label: 'Kuudra Infernal',emoji: '🐉', price: '30M', category: 'Kuudra' },
};

function getPrice(guildId, type) {
  const db  = getDb();
  const cfg = db.data.guildConfig?.[guildId];
  return cfg?.carryPrices?.[type] ?? CARRY_TYPES[type]?.price ?? '?';
}

// ── Build the carry panel embed + buttons ─────────────────────────────────
function buildPanelEmbed(guild, guildId) {
  const db = getDb();
  const categories = {};
  const allTypes = { ...CARRY_TYPES };

  // Add custom carries
  const customCarries = db.data.guildConfig?.[guildId]?.customCarries ?? {};
  Object.assign(allTypes, customCarries);

  for (const [k, d] of Object.entries(allTypes)) {
    const cat = d.category ?? 'Other';
    if (!categories[cat]) categories[cat] = [];
    const price = getPrice(guildId, k);
    categories[cat].push(`${d.emoji} **${d.label}** — ${price}`);
  }

  const embed = new EmbedBuilder()
    .setColor(C.carry)
    .setTitle(`${guild.name} — Carry Services`)
    .setDescription(
      'Looking for a carry? Select the type below and a provider will be assigned to you.\n' +
      'A private thread will be created where you can negotiate and coordinate.\n\u200b'
    )
    .setThumbnail(guild.iconURL({ size: 256 }) ?? null)
    .setFooter({ text: 'TITAN Jr. Carry System • Click a button below to request' })
    .setTimestamp();

  for (const [cat, lines] of Object.entries(categories)) {
    embed.addFields({ name: cat, value: lines.join('\n'), inline: true });
  }

  return embed;
}

function buildPanelButtons(guildId) {
  const db          = getDb();
  const customCarries = db.data.guildConfig?.[guildId]?.customCarries ?? {};
  const allTypes    = { ...CARRY_TYPES, ...customCarries };
  const categories  = {};

  for (const [k, d] of Object.entries(allTypes)) {
    const cat = d.category ?? 'Other';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push({ key: k, ...d });
  }

  const rows = [];

  for (const [, types] of Object.entries(categories)) {
    // Max 5 buttons per row, max 5 rows = 25 buttons
    let i = 0;
    while (i < types.length && rows.length < 5) {
      const slice = types.slice(i, i + 5);
      const row   = new ActionRowBuilder().addComponents(
        slice.map(t => new ButtonBuilder()
          .setCustomId(`carry_req_${t.key}`)
          .setLabel(t.label)
          .setEmoji(t.emoji)
          .setStyle(ButtonStyle.Secondary)
        )
      );
      rows.push(row);
      i += 5;
    }
  }

  return rows.slice(0, 5); // Discord max 5 rows
}

// ── Create a carry thread ──────────────────────────────────────────────────
async function createCarryThread(interaction, type, client) {
  const db       = getDb();
  const guildId  = interaction.guildId;
  const info     = CARRY_TYPES[type] ?? db.data.guildConfig?.[guildId]?.customCarries?.[type];
  if (!info) return;

  const price     = getPrice(guildId, type);
  const providers = db.data.carryProviders ?? {};
  const eligible  = Object.entries(providers)
    .filter(([, types]) => types.includes(type))
    .map(([uid]) => uid);

  // Create private thread in the carry channel
  const channel = interaction.channel;
  let thread;
  try {
    thread = await channel.threads.create({
      name:                 `${info.emoji} ${info.label} — ${interaction.user.username}`,
      autoArchiveDuration:  ThreadAutoArchiveDuration.OneHour,
      type:                 ChannelType.PrivateThread,
      reason:               'Carry request',
    });
  } catch {
    // Public thread fallback if private threads not available
    thread = await channel.threads.create({
      name:                `${info.emoji} ${info.label} — ${interaction.user.username}`,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneHour,
      reason:              'Carry request',
    });
  }

  // Add requester to thread
  await thread.members.add(interaction.user.id).catch(() => {});

  const embed = new EmbedBuilder()
    .setColor(C.carry)
    .setTitle(`${info.emoji} Carry Request — ${info.label}`)
    .setDescription(
      `<@${interaction.user.id}> is looking for a **${info.label}** carry!\n\n` +
      `Providers have been pinged below. Once a provider responds, negotiate the details here.\n\u200b`
    )
    .addFields(
      { name: 'Carry Type',       value: `${info.emoji} ${info.label}`,              inline: true },
      { name: 'Suggested Price',  value: `**${price}**`,                             inline: true },
      { name: 'Providers Online', value: `${eligible.length} available`,             inline: true },
    )
    .setFooter(FOOTER)
    .setTimestamp();

  // Close button
  const closeBtn = new ButtonBuilder()
    .setCustomId(`carry_close_${thread.id}`)
    .setLabel('Close Thread')
    .setStyle(ButtonStyle.Danger)
    .setEmoji('🔒');

  const acceptBtn = new ButtonBuilder()
    .setCustomId(`carry_accept_${thread.id}`)
    .setLabel('Accept Request')
    .setStyle(ButtonStyle.Success)
    .setEmoji('✅');

  await thread.send({
    content: eligible.length
      ? `${eligible.map(id => `<@${id}>`).join(' ')}\n<@${interaction.user.id}>`
      : `<@${interaction.user.id}> No providers are registered for this type yet. Ask in the server!`,
    embeds:     [embed],
    components: [new ActionRowBuilder().addComponents(acceptBtn, closeBtn)],
  });

  await interaction.reply({
    embeds: [new EmbedBuilder()
      .setColor(C.success)
      .setTitle('Request Created')
      .setDescription(`Your carry thread has been created: ${thread}\nProviders have been notified.`)
      .setFooter(FOOTER).setTimestamp()
    ],
    flags: [64],
  });
}

export default {
  data: new SlashCommandBuilder()
    .setName('carry')
    .setDescription('Hypixel Skyblock carry system')
    .setDefaultMemberPermissions(0n)
    .addSubcommand(s => s
      .setName('setup')
      .setDescription('(Admin) Set up the carry channel with a permanent panel')
      .addChannelOption(o =>
        o.setName('channel')
         .setDescription('Channel where carry requests will be managed')
         .addChannelTypes(ChannelType.GuildText)
         .setRequired(true)
      )
    )
    .addSubcommand(s => s
      .setName('panel')
      .setDescription('(Admin) Refresh/repost the carry panel in the configured channel')
    )
    .addSubcommand(s => s
      .setName('setprice')
      .setDescription('(Admin) Edit the price for a carry type')
      .addStringOption(o =>
        o.setName('type').setDescription('Carry type to edit').setRequired(true)
         .addChoices(...Object.entries(CARRY_TYPES).slice(0,25).map(([v,d]) => ({ name: `${d.emoji} ${d.label}`, value: v })))
      )
      .addStringOption(o => o.setName('price').setDescription('New price e.g. 25M').setRequired(true))
    )
    .addSubcommand(s => s
      .setName('addtype')
      .setDescription('(Admin) Add a custom carry type to the panel')
      .addStringOption(o => o.setName('id').setDescription('Unique ID e.g. fishing_carry').setRequired(true))
      .addStringOption(o => o.setName('label').setDescription('Display name e.g. Fishing Carry').setRequired(true))
      .addStringOption(o => o.setName('price').setDescription('Price e.g. 20M').setRequired(true))
      .addStringOption(o => o.setName('emoji').setDescription('Emoji e.g. 🎣').setRequired(false))
      .addStringOption(o => o.setName('category').setDescription('Category e.g. Fishing').setRequired(false))
    )
    .addSubcommand(s => s
      .setName('removetype')
      .setDescription('(Admin) Remove a custom carry type')
      .addStringOption(o => o.setName('id').setDescription('ID to remove').setRequired(true))
    )
    .addSubcommand(s => s
      .setName('register')
      .setDescription('Sign up as a carry provider and select your carry types')
    )
    .addSubcommand(s => s
      .setName('unregister')
      .setDescription('Remove yourself from the carry provider list')
    )
    .addSubcommand(s => s
      .setName('providers')
      .setDescription('Browse all registered carry providers')
      .addStringOption(o =>
        o.setName('type').setDescription('Filter by type').setRequired(false)
         .addChoices(...Object.entries(CARRY_TYPES).slice(0,25).map(([v,d]) => ({ name: `${d.emoji} ${d.label}`, value: v })))
      )
    )
    .addSubcommand(s => s.setName('prices').setDescription('View the full carry price list')),

  async execute(interaction, client) {
    const sub     = interaction.options.getSubcommand();
    const db      = getDb();
    const guildId = interaction.guildId;

    // Init config
    if (!db.data.guildConfig)                              db.data.guildConfig = {};
    if (!db.data.guildConfig[guildId])                    db.data.guildConfig[guildId] = { carryPrices: {}, customCarries: {} };
    if (!db.data.guildConfig[guildId].carryPrices)        db.data.guildConfig[guildId].carryPrices = {};
    if (!db.data.guildConfig[guildId].customCarries)      db.data.guildConfig[guildId].customCarries = {};
    if (!db.data.carryProviders)                          db.data.carryProviders = {};
    const cfg = db.data.guildConfig[guildId];

    // ── SETUP ─────────────────────────────────────────────────────────
    if (sub === 'setup') {
      await interaction.deferReply({ flags: [64] });
      const channel = interaction.options.getChannel('channel');
      cfg.carryChannelId = channel.id;
      await saveDb();

      const embed  = buildPanelEmbed(interaction.guild, guildId);
      const rows   = buildPanelButtons(guildId);
      const panelMsg = await channel.send({ embeds: [embed], components: rows });

      cfg.carryPanelMsgId = panelMsg.id;
      await saveDb();

      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(C.success)
          .setTitle('Carry System Set Up')
          .setDescription(`Carry panel posted in ${channel}.\n\nUsers can now click buttons to request carries. Each request creates a private thread where providers are pinged.`)
          .setFooter(FOOTER).setTimestamp()
        ],
      });
    }

    // ── PANEL (refresh) ───────────────────────────────────────────────
    if (sub === 'panel') {
      await interaction.deferReply({ flags: [64] });
      const channelId = cfg.carryChannelId;
      if (!channelId) {
        return interaction.editReply({
          embeds: [new EmbedBuilder().setColor(C.error).setTitle('Not Set Up').setDescription('Run `/carry setup #channel` first.').setFooter(FOOTER).setTimestamp()],
        });
      }

      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel) return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.error).setTitle('Channel Not Found').setDescription('The configured carry channel no longer exists. Run `/carry setup` again.').setFooter(FOOTER).setTimestamp()] });

      // Delete old panel if exists
      if (cfg.carryPanelMsgId) {
        const old = await channel.messages.fetch(cfg.carryPanelMsgId).catch(() => null);
        if (old) await old.delete().catch(() => {});
      }

      const embed    = buildPanelEmbed(interaction.guild, guildId);
      const rows     = buildPanelButtons(guildId);
      const panelMsg = await channel.send({ embeds: [embed], components: rows });
      cfg.carryPanelMsgId = panelMsg.id;
      await saveDb();

      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor(C.success).setTitle('Panel Refreshed').setDescription(`Carry panel updated in ${channel}.`).setFooter(FOOTER).setTimestamp()],
      });
    }

    // ── SETPRICE ──────────────────────────────────────────────────────
    if (sub === 'setprice') {
      await interaction.deferReply({ flags: [64] });
      const type  = interaction.options.getString('type');
      const price = interaction.options.getString('price');
      cfg.carryPrices[type] = price;
      await saveDb();

      // Refresh panel automatically
      if (cfg.carryChannelId && cfg.carryPanelMsgId) {
        const ch  = await client.channels.fetch(cfg.carryChannelId).catch(() => null);
        const msg = ch ? await ch.messages.fetch(cfg.carryPanelMsgId).catch(() => null) : null;
        if (msg) await msg.edit({ embeds: [buildPanelEmbed(interaction.guild, guildId)], components: buildPanelButtons(guildId) }).catch(() => {});
      }

      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(C.success)
          .setTitle('Price Updated')
          .setDescription(`**${CARRY_TYPES[type]?.emoji} ${CARRY_TYPES[type]?.label}** price set to **${price}**\nThe carry panel has been refreshed automatically.`)
          .setFooter(FOOTER).setTimestamp()
        ],
      });
    }

    // ── ADDTYPE ───────────────────────────────────────────────────────
    if (sub === 'addtype') {
      await interaction.deferReply({ flags: [64] });
      const id       = interaction.options.getString('id').toLowerCase().replace(/\s/g, '_');
      const label    = interaction.options.getString('label');
      const price    = interaction.options.getString('price');
      const emoji    = interaction.options.getString('emoji')    ?? '⚔️';
      const category = interaction.options.getString('category') ?? 'Custom';

      cfg.customCarries[id] = { label, price, emoji, category };
      cfg.carryPrices[id]   = price;
      await saveDb();

      // Refresh panel
      if (cfg.carryChannelId && cfg.carryPanelMsgId) {
        const ch  = await client.channels.fetch(cfg.carryChannelId).catch(() => null);
        const msg = ch ? await ch.messages.fetch(cfg.carryPanelMsgId).catch(() => null) : null;
        if (msg) await msg.edit({ embeds: [buildPanelEmbed(interaction.guild, guildId)], components: buildPanelButtons(guildId) }).catch(() => {});
      }

      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(C.success)
          .setTitle('Carry Type Added')
          .setDescription(`${emoji} **${label}** added at **${price}**.\nPanel has been refreshed.`)
          .setFooter(FOOTER).setTimestamp()
        ],
      });
    }

    // ── REMOVETYPE ────────────────────────────────────────────────────
    if (sub === 'removetype') {
      await interaction.deferReply({ flags: [64] });
      const id = interaction.options.getString('id');
      delete cfg.customCarries[id];
      delete cfg.carryPrices[id];
      await saveDb();

      if (cfg.carryChannelId && cfg.carryPanelMsgId) {
        const ch  = await client.channels.fetch(cfg.carryChannelId).catch(() => null);
        const msg = ch ? await ch.messages.fetch(cfg.carryPanelMsgId).catch(() => null) : null;
        if (msg) await msg.edit({ embeds: [buildPanelEmbed(interaction.guild, guildId)], components: buildPanelButtons(guildId) }).catch(() => {});
      }

      return interaction.editReply({
        embeds: [new EmbedBuilder().setColor(C.success).setTitle('Carry Type Removed').setDescription(`Carry type \`${id}\` removed and panel refreshed.`).setFooter(FOOTER).setTimestamp()],
      });
    }

    // ── REGISTER ──────────────────────────────────────────────────────
    if (sub === 'register') {
      const allTypes = { ...CARRY_TYPES, ...(cfg.customCarries ?? {}) };
      const select   = new StringSelectMenuBuilder()
        .setCustomId('carry_register_select')
        .setPlaceholder('Select every carry type you can provide')
        .setMinValues(1)
        .setMaxValues(Math.min(25, Object.keys(allTypes).length))
        .addOptions(Object.entries(allTypes).slice(0,25).map(([value, d]) => ({
          label: d.label, value, emoji: d.emoji,
          description: `Suggested price: ${getPrice(guildId, value)}`,
        })));

      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(C.carry)
          .setTitle('Carry Provider Registration')
          .setDescription('Select all carry types you can provide.\nYou will be pinged automatically when a user requests those types.')
          .setFooter(FOOTER).setTimestamp()
        ],
        components: [new ActionRowBuilder().addComponents(select)],
        flags: [64],
      });
    }

    // ── UNREGISTER ────────────────────────────────────────────────────
    if (sub === 'unregister') {
      delete db.data.carryProviders[interaction.user.id];
      await saveDb();
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(C.success).setTitle('Unregistered').setDescription('You have been removed from the carry provider list.').setFooter(FOOTER).setTimestamp()],
        flags: [64],
      });
    }

    // ── PROVIDERS ─────────────────────────────────────────────────────
    if (sub === 'providers') {
      const filterType = interaction.options.getString('type');
      const providers  = db.data.carryProviders ?? {};
      const allTypes   = { ...CARRY_TYPES, ...(cfg.customCarries ?? {}) };
      const lines      = [];

      for (const [uid, types] of Object.entries(providers)) {
        const relevant = filterType ? types.filter(t => t === filterType) : types;
        if (!relevant.length) continue;
        const labels = relevant.map(t => `${allTypes[t]?.emoji ?? ''}${allTypes[t]?.label ?? t}`).join(' · ');
        lines.push(`<@${uid}>\n╰ ${labels}`);
      }

      if (!lines.length) {
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(C.info).setTitle('No Providers').setDescription('No providers registered yet.\nUse `/carry register` to sign up.').setFooter(FOOTER).setTimestamp()],
        });
      }

      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(C.carry)
          .setTitle(filterType ? `${allTypes[filterType]?.emoji} ${allTypes[filterType]?.label} Providers` : 'All Carry Providers')
          .setDescription(lines.join('\n\n'))
          .setFooter({ text: `TITAN Jr. Carry System · ${lines.length} provider${lines.length !== 1 ? 's' : ''}` })
          .setTimestamp()
        ],
      });
    }

    // ── PRICES ────────────────────────────────────────────────────────
    if (sub === 'prices') {
      const allTypes   = { ...CARRY_TYPES, ...(cfg.customCarries ?? {}) };
      const categories = {};
      for (const [k, d] of Object.entries(allTypes)) {
        const cat = d.category ?? 'Other';
        if (!categories[cat]) categories[cat] = [];
        const price   = getPrice(guildId, k);
        const edited  = cfg.carryPrices[k] && cfg.carryPrices[k] !== CARRY_TYPES[k]?.price ? ' ✏️' : '';
        categories[cat].push(`${d.emoji} **${d.label}** — ${price}${edited}`);
      }

      const embed = new EmbedBuilder()
        .setColor(C.carry)
        .setTitle('Carry Price List')
        .setDescription('Prices are suggested rates. Negotiate directly with your provider.\n✏️ = price edited by admin\n\u200b')
        .setFooter({ text: 'TITAN Jr. Carry System · /carry setprice to edit' })
        .setTimestamp();

      for (const [cat, lines] of Object.entries(categories)) {
        embed.addFields({ name: cat, value: lines.join('\n'), inline: true });
      }

      return interaction.reply({ embeds: [embed] });
    }
  },
};
