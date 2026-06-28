/**
 * carry.js — SkyBot v2 Hypixel Skyblock carry system (per-category channel design)
 *
 * Matches the Skyblock Maniacs screenshot design: each carry category has its
 * OWN Discord channel with a dedicated rich embed panel and a row of tier
 * buttons. Users click a tier button → a private thread is created →
 * registered providers are pinged → a provider accepts → carry happens →
 * the thread is closed.
 *
 * Subcommands:
 *   Admin:    /carry setchannel <category> <channel>
 *             /carry setprice  <item> <price>
 *             /carry panel     [category]
 *   Provider: /carry register   <item>
 *             /carry unregister <item>
 *   User:     /carry providers  [item]
 *             /carry list
 *             /carry prices     [category]
 *             /carry close
 *
 * Button customIds:
 *   carry_request_<itemId>      — request a carry (creates a private thread)
 *   carry_accept_<threadId>     — provider accepts the request
 *   carry_close_<threadId>      — close / delete the carry thread
 *
 * Exports:
 *   default          — slash command object (data, execute, handleButton, autocomplete)
 *   postCarryPanel   — async (client, guildId, categoryId) → posted message | null
 *                      Used by the web dashboard API to refresh a panel.
 */
import {
  SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ChannelType, PermissionFlagsBits, ThreadAutoArchiveDuration,
} from 'discord.js';
import { getDb, saveDb } from '../../utils/db.js';
import { C, errorEmbed, successEmbed } from '../../utils/embeds.js';
import {
  CARRY_CATEGORIES, CATEGORY_CHOICES,
  ensureGuildConfig, getCategory, getAllCategories,
  getCategoryByItemId, getItem, getAllItems,
  setCategoryChannel, setPanelMessageId,
  setItemPrice, setItemEnabled,
  getProvidersForItem, addProvider, removeProviderItem, removeProvider,
  getProviderItems, getAllProviders,
} from '../../utils/carryConfig.js';

const FOOTER = { text: 'SkyBot v2 • Railway Edition' };

// ── Panel embed builder ────────────────────────────────────────────────────
/**
 * Builds the rich embed posted in each category channel.
 * Title:   category.label  (e.g., "Slayer Carry Service")
 * Body:    one line per carry TYPE (grouped by bossName when set):
 *            "👹 : Inferno Demonlord Carry Service"
 *            "👻 : Voidgloom Seraph Carry Service"
 *            ...
 *            "Note: React according to the tier you want."
 */
function buildPanelEmbed(guild, category) {
  // Group items by display name (bossName || label) so each boss appears once
  // even if it has multiple tier variants (e.g., Inferno Demonlord T2/T3/T4).
  const seen = new Set();
  const lines = [];
  for (const it of category.items) {
    if (it.enabled === false) continue;
    const display = it.bossName ?? it.label;
    if (seen.has(display)) continue;
    seen.add(display);
    lines.push(`${it.emoji} : ${display} Carry Service`);
  }

  const description =
    (category.description ? `${category.description}\n\n` : '') +
    lines.join('\n') +
    '\n\n*Note: React according to the tier you want.*';

  return new EmbedBuilder()
    .setColor(C.carry)
    .setTitle(category.label)
    .setDescription(description)
    .setThumbnail(guild?.iconURL?.({ size: 256 }) ?? null)
    .setFooter(FOOTER)
    .setTimestamp();
}

/**
 * Builds the button rows for a category panel.
 * - One ActionRow per 5 enabled items (Discord max 5 buttons / row, 5 rows / message).
 * - Button label: `${emoji} ${tier ? 'Tier ' + tier : label}`
 * - Style: Secondary
 * - customId:  `carry_request_<itemId>` (well under 100 chars)
 */
function buildPanelButtons(category) {
  const enabled = category.items.filter(it => it.enabled !== false);
  const rows = [];
  for (let i = 0; i < enabled.length; i += 5) {
    const slice = enabled.slice(i, i + 5);
    rows.push(new ActionRowBuilder().addComponents(
      slice.map(it => {
        // Label format:  `${emoji} ${tier ? 'Tier ' + tier : label}`
        //   - Slayer/dungeon/master tiers are numeric → "👹 Tier 3"
        //   - Kuudra tiers are named (Basic/Hot/...)     → "🟫 Basic"
        //   - Crimson (no tier) → uses label             → "🗡️ Ashfang Carry"
        let text;
        if (it.tier) {
          text = /^\d+$/.test(it.tier) ? `Tier ${it.tier}` : it.tier;
        } else {
          text = it.label;
        }
        // Discord button labels cap at 80 chars
        const label = `${it.emoji} ${text}`.slice(0, 80);
        return new ButtonBuilder()
          .setCustomId(`carry_request_${it.id}`)
          .setLabel(label)
          .setStyle(ButtonStyle.Secondary);
      }),
    ));
    if (rows.length >= 5) break; // Discord max 5 rows per message
  }
  return rows;
}

// ── Public: post (or refresh) a category's panel in its channel ───────────
/**
 * Posts (or edits in place if a previous panelMessageId exists) the carry
 * panel for a single category in its configured Discord channel.
 *
 * @returns {Promise<{messageId:string, channelId:string} | null>}
 *          null if no channel is configured for this category.
 */
export async function postCarryPanel(client, guildId, categoryId) {
  const category = getCategory(guildId, categoryId);
  if (!category) return null;
  if (!category.channelId) return null;

  const channel = await client.channels.fetch(category.channelId).catch(() => null);
  if (!channel) return null;

  const guild = client.guilds.cache.get(guildId) ?? null;
  const embed = buildPanelEmbed(guild, category);
  const rows  = buildPanelButtons(category);

  // Edit in place if we have a previous panel message id; else send new
  if (category.panelMessageId) {
    const prev = await channel.messages.fetch(category.panelMessageId).catch(() => null);
    if (prev) {
      await prev.edit({ embeds: [embed], components: rows }).catch(async () => {
        // Edit failed (message deleted) → send fresh
        const fresh = await channel.send({ embeds: [embed], components: rows });
        setPanelMessageId(guildId, categoryId, fresh.id);
      });
      return { messageId: prev.id, channelId: channel.id };
    }
  }

  const msg = await channel.send({ embeds: [embed], components: rows });
  setPanelMessageId(guildId, categoryId, msg.id);
  return { messageId: msg.id, channelId: channel.id };
}

// ── Internal: create a carry request thread ────────────────────────────────
async function createCarryRequest(client, interaction, itemId) {
  const guildId  = interaction.guildId;
  const userId   = interaction.user.id;
  const username = interaction.user.username;
  const item     = getItem(guildId, itemId);
  if (!item) return null;

  // Determine the channel to create the thread in:
  //   1. The category channel of the item (preferred)
  //   2. db.carryConfig[guildId].requestChannelId (optional override)
  //   3. The current channel (fallback)
  const def = getCategoryByItemId(itemId);
  const category = def ? getCategory(guildId, def.id) : null;
  let channelId = category?.channelId;
  if (!channelId) {
    const db = getDb();
    channelId = db.carryConfig?.[guildId]?.requestChannelId ?? interaction.channelId;
  }
  if (!channelId) return null;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return null;

  const price     = item.price;
  const providers = getProvidersForItem(itemId);

  const baseName = item.bossName ?? item.label;
  const tierTag  = item.tier ? ` T${item.tier}` : '';
  const threadName = `${item.emoji} ${baseName}${tierTag} — ${username}`.slice(0, 100);

  let thread;
  try {
    thread = await channel.threads.create({
      name:                 threadName,
      autoArchiveDuration:  ThreadAutoArchiveDuration.OneHour,
      type:                 ChannelType.PrivateThread,
      reason:               `Carry request: ${baseName}${tierTag}`,
    });
  } catch {
    // Private threads may be unavailable (e.g., no boost) → public thread fallback
    thread = await channel.threads.create({
      name:                threadName,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneHour,
      reason:              `Carry request: ${baseName}${tierTag}`,
    });
  }

  // Add requester to thread
  await thread.members.add(userId).catch(() => {});

  // Persist ticket metadata so Accept/Close handlers know what item this is.
  const db = getDb();
  if (!db.carryTickets) db.carryTickets = {};
  db.carryTickets[thread.id] = {
    guildId,
    itemId,
    requesterId: userId,
    providerId:  null,
    channelId:   channel.id,
    createdAt:   Date.now(),
  };
  await saveDb();

  const embed = new EmbedBuilder()
    .setColor(C.carry)
    .setTitle(`${item.emoji} Carry Request — ${baseName}${tierTag}`)
    .setDescription(
      `<@${userId}> is looking for a **${baseName}${tierTag}** carry!\n\n` +
      `Providers have been pinged below. The first to **Accept** gets this ticket.\n\u200b`,
    )
    .addFields(
      { name: 'Carry Type',       value: `${item.emoji} ${item.label}`,       inline: true },
      { name: 'Boss',             value: item.bossName ?? '—',                inline: true },
      { name: 'Tier',             value: item.tier ?? '—',                    inline: true },
      { name: 'Suggested Price',  value: `**${price}**`,                      inline: true },
      { name: 'Providers Online', value: `${providers.length} registered`,    inline: true },
      { name: 'Ticket',           value: thread.id,                            inline: true },
    )
    .setFooter(FOOTER)
    .setTimestamp();

  const acceptBtn = new ButtonBuilder()
    .setCustomId(`carry_accept_${thread.id}`)
    .setLabel('Accept')
    .setStyle(ButtonStyle.Success)
    .setEmoji('✅');

  const closeBtn = new ButtonBuilder()
    .setCustomId(`carry_close_${thread.id}`)
    .setLabel('Close')
    .setStyle(ButtonStyle.Danger)
    .setEmoji('🔒');

  const content = providers.length
    ? `${providers.map(id => `<@${id}>`).join(' ')}\n<@${userId}>`
    : `<@${userId}> No providers are registered for this carry yet. Ask in the server!`;

  await thread.send({
    content,
    embeds:     [embed],
    components: [new ActionRowBuilder().addComponents(acceptBtn, closeBtn)],
  });

  return thread;
}

// ── Slash command definition ──────────────────────────────────────────────
export default {
  data: new SlashCommandBuilder()
    .setName('carry')
    .setDescription('Hypixel Skyblock carry system (per-category channels)')
    .addSubcommand(s => s
      .setName('setchannel')
      .setDescription('(Admin) Set which Discord channel = which carry category')
      .addStringOption(o =>
        o.setName('category').setDescription('Carry category').setRequired(true)
         .addChoices(...CATEGORY_CHOICES))
      .addChannelOption(o =>
        o.setName('channel').setDescription('Discord channel for this category')
         .addChannelTypes(ChannelType.GuildText).setRequired(true))
    )
    .addSubcommand(s => s
      .setName('setprice')
      .setDescription('(Admin) Edit a carry item\'s price (e.g. /carry setprice f7 35M)')
      .addStringOption(o =>
        o.setName('item').setDescription('Carry item (start typing to search)').setRequired(true)
         .setAutocomplete(true))
      .addStringOption(o => o.setName('price').setDescription('New price e.g. 35M').setRequired(true))
    )
    .addSubcommand(s => s
      .setName('panel')
      .setDescription('(Admin) Post / refresh the carry panel in the category channel')
      .addStringOption(o =>
        o.setName('category').setDescription('Category (omit to refresh ALL categories)').setRequired(false)
         .addChoices(...CATEGORY_CHOICES))
    )
    .addSubcommand(s => s
      .setName('register')
      .setDescription('Register yourself as a provider for a carry type')
      .addStringOption(o =>
        o.setName('item').setDescription('Carry item to provide').setRequired(true)
         .setAutocomplete(true))
    )
    .addSubcommand(s => s
      .setName('unregister')
      .setDescription('Remove your registration for a carry type')
      .addStringOption(o =>
        o.setName('item').setDescription('Carry item to stop providing').setRequired(true)
         .setAutocomplete(true))
    )
    .addSubcommand(s => s
      .setName('providers')
      .setDescription('List all registered carry providers (optionally filter by item)')
      .addStringOption(o =>
        o.setName('item').setDescription('Filter by item').setRequired(false)
         .setAutocomplete(true))
    )
    .addSubcommand(s => s.setName('list').setDescription('Show all carry categories, channels, and item counts'))
    .addSubcommand(s => s
      .setName('prices')
      .setDescription('Show prices for all items (or one category)')
      .addStringOption(o =>
        o.setName('category').setDescription('Filter by category').setRequired(false)
         .addChoices(...CATEGORY_CHOICES))
    )
    .addSubcommand(s => s.setName('close').setDescription('Close the current carry ticket thread')),

  cooldown: 3,

  // ── Autocomplete for the `item` options ──────────────────────────────────
  async autocomplete(interaction, client) {
    const focused = interaction.options.getFocused(false, true);
    if (!focused || focused.name !== 'item') return interaction.respond([]);
    const q = (focused.value ?? '').toString().toLowerCase().trim();

    const items = getAllItems(interaction.guildId);
    const scored = items
      .map(it => {
        const hay = `${it.id} ${it.label} ${it.bossName ?? ''} ${it.tier ?? ''} ${getCategoryByItemId(it.id)?.label ?? ''}`.toLowerCase();
        let score = 0;
        if (q && hay.includes(q)) score = 1;
        if (q && it.id.toLowerCase().startsWith(q)) score = 2;
        if (!q) score = 1;
        return { it, score };
      })
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 25);

    return interaction.respond(
      scored.map(({ it }) => {
        const cat = getCategoryByItemId(it.id);
        const tierTag = it.tier ? ` T${it.tier}` : '';
        return {
          name:  `${it.emoji} ${it.label}${tierTag} — ${it.price}  [${cat?.label ?? '?'}]`,
          value: it.id,
        };
      }),
    );
  },

  // ── Command dispatch ─────────────────────────────────────────────────────
  async execute(interaction, client) {
    const sub     = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    ensureGuildConfig(guildId);

    // ── SETCHANNEL ───────────────────────────────────────────────────────
    if (sub === 'setchannel') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ embeds: [errorEmbed('No Permission', 'You need **Manage Server** to use this.')], flags: [64] });
      }
      await interaction.deferReply({ flags: [64] });
      const categoryId = interaction.options.getString('category');
      const channel    = interaction.options.getChannel('channel');
      setCategoryChannel(guildId, categoryId, channel.id);

      // Auto-post the panel right away
      const result = await postCarryPanel(client, guildId, categoryId);

      return interaction.editReply({
        embeds: [successEmbed(
          'Category Channel Set',
          `**${CARRY_CATEGORIES[categoryId].emoji} ${CARRY_CATEGORIES[categoryId].label}** → ${channel}\n` +
          (result ? `Panel posted (message ID: \`${result.messageId}\`).` : 'Set the channel first, then run `/carry panel`.'),
        )],
      });
    }

    // ── SETPRICE ─────────────────────────────────────────────────────────
    if (sub === 'setprice') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ embeds: [errorEmbed('No Permission', 'You need **Manage Server** to use this.')], flags: [64] });
      }
      await interaction.deferReply({ flags: [64] });
      const itemId = interaction.options.getString('item');
      const price  = interaction.options.getString('price');
      const ok = setItemPrice(guildId, itemId, price);
      if (!ok) {
        return interaction.editReply({ embeds: [errorEmbed('Unknown Item', `No carry item with id \`${itemId}\`.`)] });
      }

      // Refresh the panel automatically if a channel is set
      const def = getCategoryByItemId(itemId);
      if (def?.id) await postCarryPanel(client, guildId, def.id);

      const item = getItem(guildId, itemId);
      return interaction.editReply({
        embeds: [successEmbed(
          'Price Updated',
          `**${item.emoji} ${item.label}${item.tier ? ' T' + item.tier : ''}** price set to **${price}**.\n` +
          `Panel auto-refreshed.`,
        )],
      });
    }

    // ── PANEL ────────────────────────────────────────────────────────────
    if (sub === 'panel') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ embeds: [errorEmbed('No Permission', 'You need **Manage Server** to use this.')], flags: [64] });
      }
      await interaction.deferReply({ flags: [64] });
      const categoryId = interaction.options.getString('category');

      if (categoryId) {
        const category = getCategory(guildId, categoryId);
        if (!category) return interaction.editReply({ embeds: [errorEmbed('Unknown Category', categoryId)] });
        if (!category.channelId) {
          return interaction.editReply({ embeds: [errorEmbed('Channel Not Set', `Run \`/carry setchannel ${categoryId} #channel\` first.`)] });
        }
        const result = await postCarryPanel(client, guildId, categoryId);
        return interaction.editReply({
          embeds: [successEmbed('Panel Posted', `**${category.emoji} ${category.label}** panel refreshed in <#${result.channelId}>.\nMessage ID: \`${result.messageId}\``)],
        });
      }

      // No category → post/refresh ALL categories
      const results = [];
      for (const id of Object.keys(CARRY_CATEGORIES)) {
        const cat = getCategory(guildId, id);
        if (!cat?.channelId) { results.push({ id, ok: false, reason: 'no channel' }); continue; }
        try {
          const r = await postCarryPanel(client, guildId, id);
          results.push({ id, ok: !!r, messageId: r?.messageId, channelId: r?.channelId });
        } catch (err) {
          results.push({ id, ok: false, reason: err.message });
        }
      }
      const lines = results.map(r => {
        const emoji = CARRY_CATEGORIES[r.id].emoji;
        const label = CARRY_CATEGORIES[r.id].label;
        if (r.ok) return `${emoji} **${label}** → <#${r.channelId}> (\`${r.messageId}\`)`;
        return `${emoji} **${label}** → ⚠️ ${r.reason ?? 'failed'}`;
      });
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(C.carry)
          .setTitle('Carry Panels Refreshed')
          .setDescription(lines.join('\n'))
          .setFooter(FOOTER)
          .setTimestamp()],
      });
    }

    // ── REGISTER ─────────────────────────────────────────────────────────
    if (sub === 'register') {
      const itemId = interaction.options.getString('item');
      const item   = getItem(guildId, itemId);
      if (!item) return interaction.reply({ embeds: [errorEmbed('Unknown Item', `No carry item with id \`${itemId}\`.`)], flags: [64] });
      const added = addProvider(interaction.user.id, itemId);
      const myItems = getProviderItems(interaction.user.id);
      const list = myItems.map(id => {
        const it = getItem(guildId, id);
        return it ? `${it.emoji} ${it.label}${it.tier ? ' T' + it.tier : ''}` : id;
      }).join('\n') || '*(none)*';
      return interaction.reply({
        embeds: [(added ? successEmbed : infoEmbedOnly)(
          added ? 'Registered' : 'Already Registered',
          added
            ? `You are now a provider for **${item.emoji} ${item.label}${item.tier ? ' T' + item.tier : ''}**.`
            : `You were already registered for that item.`,
        ).addFields({ name: 'Your Carry Items', value: list })],
        flags: [64],
      });
    }

    // ── UNREGISTER ───────────────────────────────────────────────────────
    if (sub === 'unregister') {
      const itemId = interaction.options.getString('item');
      const removed = removeProviderItem(interaction.user.id, itemId);
      if (!removed) {
        return interaction.reply({
          embeds: [errorEmbed('Not Registered', `You weren't registered for \`${itemId}\`.`)],
          flags: [64],
        });
      }
      const myItems = getProviderItems(interaction.user.id);
      const list = myItems.map(id => {
        const it = getItem(guildId, id);
        return it ? `${it.emoji} ${it.label}${it.tier ? ' T' + it.tier : ''}` : id;
      }).join('\n') || '*(none)*';
      return interaction.reply({
        embeds: [successEmbed('Unregistered', `Removed \`${itemId}\` from your provider list.`)
          .addFields({ name: 'Your Carry Items', value: list })],
        flags: [64],
      });
    }

    // ── PROVIDERS ────────────────────────────────────────────────────────
    if (sub === 'providers') {
      const filterItemId = interaction.options.getString('item');
      const providers    = getAllProviders();
      const lines = [];

      for (const [uid, types] of Object.entries(providers)) {
        const safeTypes = Array.isArray(types) ? types : [];
        const relevant  = filterItemId ? safeTypes.filter(t => t === filterItemId) : safeTypes;
        if (!relevant.length) continue;
        const labels = relevant.map(id => {
          const it = getItem(guildId, id);
          return it ? `${it.emoji} ${it.label}${it.tier ? ' T' + it.tier : ''}` : id;
        }).join(' · ');
        lines.push(`<@${uid}>\n╰ ${labels}`);
      }

      if (!lines.length) {
        const item = filterItemId ? getItem(guildId, filterItemId) : null;
        return interaction.reply({
          embeds: [new EmbedBuilder()
            .setColor(C.info)
            .setTitle('No Providers')
            .setDescription(item
              ? `No providers registered for **${item.emoji} ${item.label}${item.tier ? ' T' + item.tier : ''}**.\nUse \`/carry register\` to sign up.`
              : 'No providers registered yet.\nUse `/carry register` to sign up.')
            .setFooter(FOOTER).setTimestamp()],
        });
      }

      const item = filterItemId ? getItem(guildId, filterItemId) : null;
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(C.carry)
          .setTitle(item
            ? `${item.emoji} ${item.label}${item.tier ? ' T' + item.tier : ''} Providers`
            : 'All Carry Providers')
          .setDescription(lines.join('\n\n'))
          .setFooter({ text: `SkyBot v2 • Railway Edition · ${lines.length} provider${lines.length !== 1 ? 's' : ''}` })
          .setTimestamp()],
      });
    }

    // ── LIST ─────────────────────────────────────────────────────────────
    if (sub === 'list') {
      const cats = getAllCategories(guildId);
      const lines = Object.values(cats).map(cat => {
        const enabledItems = cat.items.filter(it => it.enabled !== false).length;
        const channel = cat.channelId ? `<#${cat.channelId}>` : '*(not set — run `/carry setchannel`)*';
        return `${cat.emoji} **${cat.label}**\n╰ Channel: ${channel}\n╰ Items: ${enabledItems}/${cat.items.length} enabled`;
      });
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(C.carry)
          .setTitle('🧭 Carry Categories')
          .setDescription(lines.join('\n\n'))
          .setFooter(FOOTER).setTimestamp()],
      });
    }

    // ── PRICES ───────────────────────────────────────────────────────────
    if (sub === 'prices') {
      const categoryId = interaction.options.getString('category');
      const cats = categoryId ? { [categoryId]: getCategory(guildId, categoryId) } : getAllCategories(guildId);
      const embed = new EmbedBuilder()
        .setColor(C.carry)
        .setTitle(categoryId ? `${CARRY_CATEGORIES[categoryId].emoji} ${CARRY_CATEGORIES[categoryId].label} — Prices` : 'Carry Price List')
        .setDescription('Prices are suggested rates. Negotiate directly with your provider.')
        .setFooter({ text: 'SkyBot v2 • Railway Edition · /carry setprice to edit' })
        .setTimestamp();

      for (const cat of Object.values(cats)) {
        if (!cat) continue;
        const lines = cat.items.map(it => {
          const def = CARRY_CATEGORIES[cat.id].items.find(d => d.id === it.id);
          const edited = def && it.price !== def.price ? ' ✏️' : '';
          const off    = it.enabled === false ? ' 🔴' : '';
          const tier   = it.tier ? ` T${it.tier}` : '';
          return `${it.emoji} **${it.label}${tier}** — ${it.price}${edited}${off}`;
        });
        embed.addFields({ name: `${cat.emoji} ${cat.label}`, value: lines.join('\n'), inline: true });
      }

      return interaction.reply({ embeds: [embed] });
    }

    // ── CLOSE ────────────────────────────────────────────────────────────
    if (sub === 'close') {
      const thread = interaction.channel;
      if (!thread?.isThread?.()) {
        return interaction.reply({
          embeds: [errorEmbed('Not a Thread', 'This command can only be used inside a carry ticket thread.')],
          flags:  [64],
        });
      }
      const db = getDb();
      const ticket = db.carryTickets?.[thread.id];
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(C.info)
          .setTitle('Ticket Closing')
          .setDescription(`This carry thread will be archived in 5 seconds${ticket?.providerId ? ` (provider: <@${ticket.providerId}>)` : ''}.`)
          .setFooter(FOOTER).setTimestamp()],
      });
      setTimeout(() => {
        thread.setArchived(true).catch(() => {});
        if (db.carryTickets) {
          delete db.carryTickets[thread.id];
          saveDb();
        }
      }, 5000);
      return;
    }
  },

  // ── Button handler ──────────────────────────────────────────────────────
  async handleButton(interaction, client) {
    const { customId } = interaction;

    // ── carry_request_<itemId> — request a carry from a panel button ──
    if (customId.startsWith('carry_request_')) {
      const itemId = customId.slice('carry_request_'.length);
      const item   = getItem(interaction.guildId, itemId);
      if (!item) {
        await interaction.reply({ embeds: [errorEmbed('Unknown Item', `Item \`${itemId}\` no longer exists.`)], flags: [64] });
        return true;
      }
      if (item.enabled === false) {
        await interaction.reply({ embeds: [errorEmbed('Disabled', 'This carry item is currently disabled.')], flags: [64] });
        return true;
      }

      await interaction.deferReply({ flags: [64] });
      const thread = await createCarryRequest(client, interaction, itemId);
      if (!thread) {
        await interaction.editReply({
          embeds: [errorEmbed('Request Failed', 'Could not create a carry thread. Make sure a category channel is configured (`/carry setchannel`).')],
        });
        return true;
      }
      await interaction.editReply({
        embeds: [successEmbed('Ticket Created', `Your carry thread has been created: ${thread}\nProviders have been pinged.`)],
      });
      return true;
    }

    // ── carry_accept_<threadId> — provider accepts the request ──
    if (customId.startsWith('carry_accept_')) {
      const threadId = customId.slice('carry_accept_'.length);
      const db       = getDb();
      const ticket   = db.carryTickets?.[threadId];

      if (!ticket) {
        await interaction.reply({ embeds: [errorEmbed('Ticket Not Found', 'This ticket is no longer active.')], flags: [64] });
        return true;
      }
      if (ticket.providerId) {
        await interaction.reply({
          embeds: [errorEmbed('Already Taken', `This ticket was already accepted by <@${ticket.providerId}>.`)],
          flags:  [64],
        });
        return true;
      }

      // Must be registered as a provider for this item
      const myItems = getProviderItems(interaction.user.id);
      if (!myItems.includes(ticket.itemId)) {
        await interaction.reply({
          embeds: [errorEmbed('Not a Provider', `Register for this carry first with \`/carry register\` (item: \`${ticket.itemId}\`).`)],
          flags:  [64],
        });
        return true;
      }

      // Requester cannot accept their own request
      if (ticket.requesterId === interaction.user.id) {
        await interaction.reply({
          embeds: [errorEmbed('Cannot Accept', 'You cannot accept your own carry request.')],
          flags:  [64],
        });
        return true;
      }

      ticket.providerId = interaction.user.id;
      ticket.acceptedAt = Date.now();
      await saveDb();

      const guildId = ticket.guildId;
      const item    = getItem(guildId, ticket.itemId);
      const embed = new EmbedBuilder()
        .setColor(C.success)
        .setTitle('✅ Carry Accepted')
        .setDescription(
          `<@${interaction.user.id}> has accepted this carry request!\n\n` +
          `Please coordinate with <@${ticket.requesterId}> here. When done, click **Close** below or run \`/carry close\`.`,
        )
        .addFields(
          { name: 'Provider',  value: `<@${interaction.user.id}>`,                       inline: true },
          { name: 'Carry',     value: item ? `${item.emoji} ${item.label}${item.tier ? ' T' + item.tier : ''}` : ticket.itemId, inline: true },
          { name: 'Price',     value: item ? `**${item.price}**` : '?',                   inline: true },
        )
        .setFooter(FOOTER)
        .setTimestamp();

      const closeBtn = new ButtonBuilder()
        .setCustomId(`carry_close_${threadId}`)
        .setLabel('Close')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🔒');

      await interaction.reply({
        embeds:     [embed],
        components: [new ActionRowBuilder().addComponents(closeBtn)],
      });
      return true;
    }

    // ── carry_close_<threadId> — close / archive the carry thread ──
    if (customId.startsWith('carry_close_')) {
      const threadId = customId.slice('carry_close_'.length);
      const thread   = interaction.channel;
      if (!thread?.isThread?.() || thread.id !== threadId) {
        await interaction.reply({
          embeds: [errorEmbed('Wrong Channel', 'This button can only be used inside its carry thread.')],
          flags:  [64],
        });
        return true;
      }
      const db = getDb();
      const ticket = db.carryTickets?.[threadId];
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(C.info)
          .setTitle('Ticket Closing')
          .setDescription(`This carry thread will be archived in 5 seconds${ticket?.providerId ? ` (completed by <@${ticket.providerId}>)` : ''}.`)
          .setFooter(FOOTER).setTimestamp()],
      });
      setTimeout(() => {
        thread.setArchived(true).catch(() => {});
        if (db.carryTickets) {
          delete db.carryTickets[threadId];
          saveDb();
        }
      }, 5000);
      return true;
    }

    return false;
  },
};

// Tiny helper so we don't have to import infoEmbed just for one call.
function infoEmbedOnly(title, desc) {
  return new EmbedBuilder().setColor(C.info).setTitle(title).setDescription(desc ?? null).setFooter(FOOTER).setTimestamp();
}
