/**
 * info.js — Bot info & full command list (all 26 commands)
 */
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { C } from '../../utils/embeds.js';
import { getFlipWatcherStats } from '../../services/ahFlipWatcher.js';
import { getStats as getPriceStats } from '../../services/priceHistory.js';
import { getAllTTSStates } from '../../services/ttsService.js';

const FOOTER = { text: 'SkyBot v2 • Railway Edition' };

export default {
  data: new SlashCommandBuilder()
    .setName('info')
    .setDescription('Show bot info, status, and command list')
    .addStringOption(o =>
      o.setName('section').setDescription('Which section to show').setRequired(false)
        .addChoices(
          { name: 'Overview', value: 'overview' },
          { name: 'Hypixel', value: 'hypixel' },
          { name: 'Voice & TTS', value: 'tts' },
          { name: 'AH Flipper', value: 'flipper' },
          { name: 'Economy & Leveling', value: 'economy' },
          { name: 'Moderation', value: 'moderation' },
          { name: 'Music & Media', value: 'media' },
          { name: 'Utility & Fun', value: 'utility' },
        )),

  async execute(interaction, client) {
    const section = interaction.options.getString('section') ?? 'overview';

    // ── HYPIXEL ───────────────────────────────────────────────
    if (section === 'hypixel') {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(C.hypixel).setTitle('🎯 Hypixel Skyblock Commands')
          .addFields(
            { name: '/link <ign>', value: 'Link your Discord to Minecraft account', inline: false },
            { name: '/profile [ign] [page]', value: 'Full SkyBlock profile (Overview/Skills/Dungeons/Slayers/Mining)', inline: false },
            { name: '/auction [ign]', value: 'See active AH listings for a player', inline: false },
            { name: '/bazaar <item>', value: 'Check Bazaar buy/sell prices & spread (autocomplete)', inline: false },
            { name: '/carry', value: 'Per-category carry system (5 channels):\n• `/carry setchannel <category> <channel>` — [Admin] bind a Discord channel to a carry category (🏰 Dungeons, ⭐ Master Mode, 👹 Slayers, 🐉 Kuudra, 🔥 Crimson)\n• `/carry setprice <item> <price>` — [Admin] edit a carry item\'s price (panel auto-refreshes)\n• `/carry panel [category]` — [Admin] post/refresh the panel embed + tier buttons in the category channel\n• `/carry register <item>` — sign up as a provider (you get pinged when users click your tier button)\n• `/carry unregister <item>` — remove a registration\n• `/carry providers [item]` — list all registered providers\n• `/carry list` — show all categories, their channels, and item counts\n• `/carry prices [category]` — show prices for all items\n• `/carry close` — close the current carry ticket thread\nClick a tier button in any carry channel to open a private ticket thread — providers are pinged, first to **Accept** gets the carry, then **Close** to archive.', inline: false },
            { name: '/partyfinder', value: 'Party finder: post LFG, join parties, auto-expire 30m', inline: false },
            { name: '!ah <question>', value: 'AI AH ChatBot (Groq Llama 3.3 70B) with live price context', inline: false },
          )
          .setFooter(FOOTER).setTimestamp()],
      });
    }

    // ── TTS ───────────────────────────────────────────────────
    if (section === 'tts') {
      const ttsCount = getAllTTSStates().length;
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(C.tts).setTitle('🔊 Voice & TTS Commands')
          .setDescription('Railway-proof TTS — pure HTTP providers (StreamElements + Google), no Python deps.')
          .addFields(
            { name: '/tts start [voice_channel] [text_channel] [ai_mode]', value: 'Join a VC and start reading a text channel', inline: false },
            { name: '/tts stop', value: 'Leave the VC', inline: false },
            { name: '/tts say [text]', value: 'Speak something immediately', inline: false },
            { name: '/tts ai [enabled]', value: 'Toggle Groq AI assistant mode (Llama 3.3 70B)', inline: false },
            { name: '/tts skip', value: 'Stop current speech + clear queue', inline: false },
            { name: '/tts move [voice_channel]', value: 'Move bot to another VC', inline: false },
            { name: '/tts status', value: 'Show TTS status', inline: false },
          )
          .addFields({ name: 'Active Sessions', value: `${ttsCount} guild(s)`, inline: true })
          .setFooter(FOOTER).setTimestamp()],
      });
    }

    // ── FLIPPER ───────────────────────────────────────────────
    if (section === 'flipper') {
      const stats = getFlipWatcherStats();
      const priceStats = getPriceStats();
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(C.flip).setTitle('💰 AH Flip Tracker Commands')
          .setDescription('Powerful multi-page flip scanner with EWMA pricing, item-attribute parsing, and subscriptions.')
          .addFields(
            { name: '/flip subscribe [item] [min_profit]', value: 'Get pinged when an item appears as a flip', inline: false },
            { name: '/flip unsubscribe [item]', value: 'Remove a subscription', inline: false },
            { name: '/flip list', value: 'Show your subscriptions', inline: false },
            { name: '/flip recent [limit]', value: 'Show recent flips', inline: false },
            { name: '/flip top [limit]', value: 'Show top all-time flips', inline: false },
            { name: '/flip search [query]', value: 'Search recent flips', inline: false },
            { name: '/flip stats', value: 'Show flip watcher stats', inline: false },
          )
          .addFields(
            { name: 'Total Detected', value: `${stats.totalFlipsDetected}`, inline: true },
            { name: 'Items Tracked', value: `${priceStats.signatures}`, inline: true },
            { name: 'Scans Run', value: `${stats.scansRun}`, inline: true },
          )
          .setFooter(FOOTER).setTimestamp()],
      });
    }

    // ── ECONOMY & LEVELING ────────────────────────────────────
    if (section === 'economy') {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(C.economy).setTitle('🏦 Economy & Leveling Commands')
          .addFields(
            { name: '/economy balance', value: 'Check your coin balance', inline: false },
            { name: '/economy daily', value: 'Claim daily reward (24h cooldown, streak bonuses)', inline: false },
            { name: '/economy work', value: 'Work for coins', inline: false },
            { name: '/economy pay <user> <amount>', value: 'Pay another user', inline: false },
            { name: '/economy leaderboard', value: 'Top 10 richest users', inline: false },
            { name: '/economy add <user> <amount>', value: '[Admin] Give coins', inline: false },
            { name: '/leveling rank [user]', value: 'Check your XP, level, rank', inline: false },
            { name: '/leveling leaderboard', value: 'Top 10 highest-level users', inline: false },
            { name: '/leveling setchannel', value: '[Admin] Set level-up announcement channel', inline: false },
          )
          .setFooter(FOOTER).setTimestamp()],
      });
    }

    // ── MODERATION ────────────────────────────────────────────
    if (section === 'moderation') {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(C.mod).setTitle('🔨 Moderation Commands')
          .setDescription('All actions logged to LOG_CHANNEL_ID if set.')
          .addFields(
            { name: '/mod ban <user> [reason]', value: 'Ban a user', inline: false },
            { name: '/mod kick <user> [reason]', value: 'Kick a user', inline: false },
            { name: '/mod timeout <user> <duration> [reason]', value: 'Timeout a user', inline: false },
            { name: '/mod warn <user> <reason>', value: 'Warn a user (tracked in DB)', inline: false },
            { name: '/mod purge <count>', value: 'Bulk delete messages', inline: false },
            { name: '/mod lock / unlock', value: 'Lock/unlock current channel', inline: false },
            { name: '/warns list <user>', value: 'List a user\'s warnings', inline: false },
            { name: '/warns add <user> <reason>', value: 'Add a warning manually', inline: false },
            { name: '/warns clear <user>', value: 'Clear all warnings for a user', inline: false },
            { name: '/ticket setup', value: 'Create a ticket panel with a button', inline: false },
            { name: '/ticket close', value: 'Close the current ticket channel', inline: false },
            { name: '/role add / remove', value: 'Add/remove roles from users', inline: false },
            { name: '/reactionroles create', value: 'Set up reaction-role messages', inline: false },
            { name: '/admin cleanup / status / leave', value: 'Admin utilities', inline: false },
            { name: '/config view / set / reset', value: 'Server configuration (welcome, goodbye, autorole, logging)', inline: false },
          )
          .setFooter(FOOTER).setTimestamp()],
      });
    }

    // ── MUSIC & MEDIA ─────────────────────────────────────────
    if (section === 'media') {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(C.music).setTitle('🎵 Music & Media Commands')
          .setDescription('Music powered by yt-dlp + @discordjs/voice. Downloads via yt-dlp.')
          .addFields(
            { name: '/music play <query>', value: 'Play a YouTube track or search', inline: false },
            { name: '/music skip / stop', value: 'Skip current / stop and clear queue', inline: false },
            { name: '/music queue', value: 'Show current queue', inline: false },
            { name: '/music pause / resume', value: 'Pause/resume playback', inline: false },
            { name: '/music loop', value: 'Toggle loop mode', inline: false },
            { name: '/music volume <0-100>', value: 'Adjust volume', inline: false },
            { name: '/music nowplaying', value: 'Show current track info', inline: false },
            { name: '/music shuffle', value: 'Shuffle the queue', inline: false },
            { name: '/download <url> [quality]', value: 'Download video (YT/TikTok/IG/X/Reddit/FB). Quality: best/1080p/720p/480p/audio', inline: false },
            { name: '/removebg', value: 'Remove background from attached image (remove.bg API)', inline: false },
          )
          .setFooter(FOOTER).setTimestamp()],
      });
    }

    // ── UTILITY & FUN ─────────────────────────────────────────
    if (section === 'utility') {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(C.fun).setTitle('🎲 Utility & Fun Commands')
          .addFields(
            { name: '/fun 8ball <question>', value: 'Magic 8-ball', inline: false },
            { name: '/fun roll [sides]', value: 'Roll a dice', inline: false },
            { name: '/fun flip', value: 'Flip a coin', inline: false },
            { name: '/fun rps <rock|paper|scissors>', value: 'Rock paper scissors', inline: false },
            { name: '/fun meme', value: 'Random meme from r/memes', inline: false },
            { name: '/fun joke', value: 'Random joke', inline: false },
            { name: '/fun choose <option1> | <option2> | ...', value: 'Bot chooses for you', inline: false },
            { name: '/fun urban <term>', value: 'Urban Dictionary lookup', inline: false },
            { name: '/giveaway start <duration> <winners> <prize>', value: 'Start a giveaway with join button', inline: false },
            { name: '/giveaway end / reroll / list', value: 'Manage giveaways', inline: false },
            { name: '/tools calc <expression>', value: 'Calculator', inline: false },
            { name: '/tools timestamp <time>', value: 'Generate Discord timestamp', inline: false },
            { name: '/tools weather <city>', value: 'Weather lookup (Open-Meteo)', inline: false },
            { name: '/tools translate <text> <to>', value: 'Translate text (Google)', inline: false },
            { name: '/tools password [length]', value: 'Generate a secure password', inline: false },
            { name: '/tools serverinfo / userinfo', value: 'Discord info embeds', inline: false },
            { name: '/welcome setup / test / disable', value: 'Configure welcome & goodbye messages', inline: false },
            { name: '/premium add / remove / list / check', value: 'Premium user management', inline: false },
          )
          .setFooter(FOOTER).setTimestamp()],
      });
    }

    // ── OVERVIEW ──────────────────────────────────────────────
    const stats = getFlipWatcherStats();
    const priceStats = getPriceStats();
    const ttsCount = getAllTTSStates().length;
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const commandCount = client.commands?.size ?? 26;

    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(C.info).setTitle('🤖 SkyBot v2 — Railway Edition')
        .setDescription('All-in-one Hypixel Skyblock Discord bot with flawless TTS/Voice, powerful AH Flip Tracker, and 26 commands across 8 categories.')
        .addFields(
          { name: '⏱️ Uptime', value: `${hours}h ${minutes}m`, inline: true },
          { name: '🏠 Guilds', value: `${client.guilds?.cache?.size ?? 0}`, inline: true },
          { name: '📡 Ping', value: `${client.ws?.ping ?? 0}ms`, inline: true },
          { name: '🔊 TTS Sessions', value: `${ttsCount}`, inline: true },
          { name: '💰 Flips Detected', value: `${stats.totalFlipsDetected}`, inline: true },
          { name: '📊 Items Tracked', value: `${priceStats.signatures}`, inline: true },
          { name: '📋 Commands Loaded', value: `${commandCount}`, inline: true },
          { name: '🤖 AI Engine', value: process.env.GROQ_API_KEY ? 'Groq (Llama 3.3 70B) ✅' : 'Not configured', inline: true },
          { name: '🎵 Music', value: 'yt-dlp + @discordjs/voice ✅', inline: true },
          { name: 'Command Categories', value: 'Use `/info <section>` for details:\n• `hypixel` — Skyblock commands\n• `tts` — Voice & TTS\n• `flipper` — AH Flip Tracker\n• `economy` — Economy & Leveling\n• `moderation` — Mod, tickets, roles\n• `media` — Music, download, removebg\n• `utility` — Fun, tools, giveaways, welcome', inline: false },
        )
        .setFooter(FOOTER).setTimestamp()],
    });
  },
};
