/**
 * tools.js — SkyBot v2 Utility tools command
 *
 * Ported from SkyBot v1 (Discordbot-main/src/commands/Tools/tools.js).
 * Adapted for v2 SkyBot footer, cooldown: 3, and added new subcommands.
 *
 * Original subcommands (kept): calc, color, password, base, timestamp,
 *   avatar, banner
 * New v2 subcommands: ping, serverinfo, userinfo, translate, weather
 *
 * Public APIs (no keys required):
 *   - translate: https://translate.googleapis.com/translate_a/single (free gtx)
 *   - weather:   https://geocoding-api.open-meteo.com + api.open-meteo.com
 */
import { SlashCommandBuilder, EmbedBuilder, ChannelType } from 'discord.js';
import { successEmbed, errorEmbed, C } from '../../utils/embeds.js';

const FOOTER = { text: 'SkyBot v2 • Railway Edition' };

async function fetchJSON(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'SkyBot-v2 (Discord bot)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// WMO weather code → human description + emoji
const WMO = {
  0:  ['☀️ Clear sky',           'Clear skies all around.'],
  1:  ['🌤️ Mainly clear',       'Mostly clear with few clouds.'],
  2:  ['⛅ Partly cloudy',       'A mix of sun and clouds.'],
  3:  ['☁️ Overcast',            'Cloudy skies.'],
  45: ['🌫️ Fog',                 'Visibility reduced by fog.'],
  48: ['🌫️ Rime fog',            'Freezing fog — drive carefully.'],
  51: ['🌦️ Light drizzle',       'Light drizzle falling.'],
  53: ['🌦️ Drizzle',             'Steady drizzle.'],
  55: ['🌧️ Heavy drizzle',       'Heavy drizzle — bring an umbrella.'],
  61: ['🌧️ Light rain',          'Light rain.'],
  63: ['🌧️ Rain',                'Rainfall.'],
  65: ['⛈️ Heavy rain',           'Heavy rain — stay dry!'],
  71: ['🌨️ Light snow',          'Light snow flurries.'],
  73: ['🌨️ Snow',                'Snow falling.'],
  75: ['❄️ Heavy snow',           'Heavy snow — bundle up.'],
  80: ['🌧️ Rain showers',        'Scattered rain showers.'],
  81: ['🌧️ Rain showers',        'Moderate rain showers.'],
  82: ['⛈️ Violent showers',     'Violent rain showers — take cover!'],
  95: ['⛈️ Thunderstorm',         'Thunderstorm nearby.'],
  96: ['⛈️ Thunderstorm + hail',  'Thunderstorm with hail.'],
  99: ['⛈️ Severe thunderstorm', 'Severe thunderstorm with heavy hail.'],
};

export default {
  cooldown: 3,

  data: new SlashCommandBuilder()
    .setName('tools')
    .setDescription('Utility tools')
    .addSubcommand(s => s
      .setName('calc')
      .setDescription('Calculate a math expression')
      .addStringOption(o => o.setName('expression').setDescription('e.g. 2 + 2 * 10').setRequired(true))
    )
    .addSubcommand(s => s
      .setName('color')
      .setDescription('Preview a hex color')
      .addStringOption(o => o.setName('hex').setDescription('Hex color e.g. #ff6600').setRequired(true))
    )
    .addSubcommand(s => s
      .setName('password')
      .setDescription('Generate a secure random password')
      .addIntegerOption(o => o.setName('length').setDescription('Length (8-64)').setMinValue(8).setMaxValue(64).setRequired(false))
    )
    .addSubcommand(s => s
      .setName('base')
      .setDescription('Convert number between bases')
      .addStringOption(o => o.setName('number').setDescription('Number to convert').setRequired(true))
      .addIntegerOption(o => o.setName('from').setDescription('From base (2-36)').setMinValue(2).setMaxValue(36).setRequired(true))
      .addIntegerOption(o => o.setName('to').setDescription('To base (2-36)').setMinValue(2).setMaxValue(36).setRequired(true))
    )
    .addSubcommand(s => s
      .setName('timestamp')
      .setDescription('Get Unix timestamp for a date')
      .addStringOption(o => o.setName('date').setDescription('Date e.g. "2024-12-25" or "tomorrow"').setRequired(false))
    )
    .addSubcommand(s => s
      .setName('avatar')
      .setDescription("Get a user's avatar")
      .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(false))
    )
    .addSubcommand(s => s
      .setName('banner')
      .setDescription("Get a user's banner")
      .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(false))
    )
    // ── New v2 subcommands ──
    .addSubcommand(s => s.setName('ping').setDescription('Bot latency & API ping'))
    .addSubcommand(s => s.setName('serverinfo').setDescription('Server information'))
    .addSubcommand(s => s
      .setName('userinfo')
      .setDescription('User information')
      .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(false))
    )
    .addSubcommand(s => s
      .setName('translate')
      .setDescription('Translate text (auto-detect source → target language)')
      .addStringOption(o => o.setName('text').setDescription('Text to translate').setRequired(true))
      .addStringOption(o => o.setName('to').setDescription('Target language code (default: en) e.g. en, es, fr, de, ja').setRequired(false))
    )
    .addSubcommand(s => s
      .setName('weather')
      .setDescription('Get current weather for a city')
      .addStringOption(o => o.setName('city').setDescription('City name e.g. "San Francisco" or "Tokyo"').setRequired(true))
    ),

  async execute(interaction, client) {
    const sub = interaction.options.getSubcommand();

    // ── CALC ──────────────────────────────────────────────────────────────
    if (sub === 'calc') {
      const expr = interaction.options.getString('expression');
      try {
        // Safe math eval — only allow numbers and operators
        const safe = expr.replace(/[^0-9+\-*/.()% ]/g, '');
        if (!safe.trim()) throw new Error('Invalid expression');
        // eslint-disable-next-line no-new-func
        const result = Function(`"use strict"; return (${safe})`)();
        if (result === undefined || !isFinite(result)) throw new Error('Result is not finite');
        await interaction.reply({
          embeds: [new EmbedBuilder()
            .setColor(C.info)
            .setTitle('🧮 Calculator')
            .addFields(
              { name: 'Expression', value: `\`${expr}\``,  inline: true },
              { name: 'Result',     value: `**${result}**`, inline: true },
            ).setFooter(FOOTER).setTimestamp()
          ],
        });
      } catch {
        await interaction.reply({ embeds: [errorEmbed('Invalid Expression', `Cannot evaluate: \`${expr}\``)] });
      }
    }

    // ── COLOR ─────────────────────────────────────────────────────────────
    else if (sub === 'color') {
      let hex = interaction.options.getString('hex').replace('#', '');
      if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
        return interaction.reply({ embeds: [errorEmbed('Invalid Hex', 'Use format `#ff6600` or `ff6600`')] });
      }
      const color  = parseInt(hex, 16);
      const r = (color >> 16) & 255;
      const g = (color >> 8)  & 255;
      const b =  color        & 255;
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(color)
          .setTitle(`🎨 Color: #${hex.toUpperCase()}`)
          .addFields(
            { name: 'HEX', value: `#${hex.toUpperCase()}`,     inline: true },
            { name: 'RGB', value: `rgb(${r}, ${g}, ${b})`,     inline: true },
            { name: 'Int', value: `${color}`,                   inline: true },
          )
          .setImage(`https://singlecolorimage.com/get/${hex}/200x80`)
          .setFooter(FOOTER).setTimestamp()
        ],
      });
    }

    // ── PASSWORD ──────────────────────────────────────────────────────────
    else if (sub === 'password') {
      const len   = interaction.options.getInteger('length') ?? 16;
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+[]{}';
      let   pwd   = '';
      for (let i = 0; i < len; i++) {
        pwd += chars[Math.floor(Math.random() * chars.length)];
      }
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(C.success)
          .setTitle('🔐 Generated Password')
          .setDescription(`\`${pwd}\``)
          .setFooter({ text: 'Keep this safe — do not share it! • SkyBot v2' })
          .setTimestamp()
        ],
        flags: [64],
      });
    }

    // ── BASE CONVERT ──────────────────────────────────────────────────────
    else if (sub === 'base') {
      const num  = interaction.options.getString('number');
      const from = interaction.options.getInteger('from');
      const to   = interaction.options.getInteger('to');
      try {
        const decimal = parseInt(num, from);
        if (isNaN(decimal)) throw new Error('Invalid number for given base');
        const result  = decimal.toString(to).toUpperCase();
        await interaction.reply({
          embeds: [new EmbedBuilder()
            .setColor(C.info)
            .setTitle('🔢 Base Converter')
            .addFields(
              { name: `Base ${from} Input`,  value: `\`${num}\``,    inline: true },
              { name: `Base ${to} Output`,   value: `\`${result}\``, inline: true },
              { name: 'Decimal',             value: `\`${decimal}\``, inline: true },
            ).setFooter(FOOTER).setTimestamp()
          ],
        });
      } catch (err) {
        await interaction.reply({ embeds: [errorEmbed('Conversion Error', err.message)] });
      }
    }

    // ── TIMESTAMP ─────────────────────────────────────────────────────────
    else if (sub === 'timestamp') {
      const dateStr = interaction.options.getString('date');
      let   date    = dateStr ? new Date(dateStr) : new Date();
      if (isNaN(date.getTime())) date = new Date();
      const unix = Math.floor(date.getTime() / 1000);
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(C.info)
          .setTitle('⏰ Timestamp')
          .addFields(
            { name: 'Date',        value: date.toUTCString(), inline: false },
            { name: 'Unix',        value: `\`${unix}\``,       inline: true  },
            { name: 'Discord',     value: `<t:${unix}:F>`,     inline: true  },
            { name: 'Relative',    value: `<t:${unix}:R>`,     inline: true  },
            { name: 'Copy Format', value: `\`<t:${unix}:F>\``, inline: false },
          ).setFooter(FOOTER).setTimestamp()
        ],
      });
    }

    // ── AVATAR ────────────────────────────────────────────────────────────
    else if (sub === 'avatar') {
      const user = interaction.options.getUser('user') ?? interaction.user;
      const url  = user.displayAvatarURL({ size: 1024, extension: 'png' });
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(C.info)
          .setTitle(`${user.username}'s Avatar`)
          .setImage(url)
          .setFooter(FOOTER).setTimestamp()
        ],
      });
    }

    // ── BANNER ────────────────────────────────────────────────────────────
    else if (sub === 'banner') {
      const user      = await (interaction.options.getUser('user') ?? interaction.user).fetch();
      const bannerUrl = user.bannerURL({ size: 1024 });
      if (!bannerUrl) return interaction.reply({ embeds: [errorEmbed('No Banner', `${user.username} has no banner.`)] });
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(C.info).setTitle(`${user.username}'s Banner`).setImage(bannerUrl).setFooter(FOOTER).setTimestamp()],
      });
    }

    // ── PING ──────────────────────────────────────────────────────────────
    else if (sub === 'ping') {
      const wsPing    = client.ws.ping;
      const uptimeMs  = client.uptime ?? 0;
      const seconds   = Math.floor(uptimeMs / 1000) % 60;
      const minutes   = Math.floor(uptimeMs / 60000) % 60;
      const hours     = Math.floor(uptimeMs / 3600000) % 24;
      const days      = Math.floor(uptimeMs / 86400000);
      const uptimeStr = `${days}d ${hours}h ${minutes}m ${seconds}s`;
      const sentMsg   = await interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(C.info)
          .setTitle('🏓 Pong!')
          .addFields(
            { name: '🌐 WebSocket',  value: `**${wsPing}ms**`,    inline: true },
            { name: '⏱️ Round-trip',  value: 'Measuring…',         inline: true },
            { name: '⌚ Uptime',      value: uptimeStr,            inline: true },
          ).setFooter(FOOTER).setTimestamp()
        ],
        fetchReply: true,
      });
      const rtt = sentMsg.createdTimestamp - interaction.createdTimestamp;
      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(C.info)
          .setTitle('🏓 Pong!')
          .addFields(
            { name: '🌐 WebSocket',  value: `**${wsPing}ms**`, inline: true },
            { name: '⏱️ Round-trip',  value: `**${rtt}ms**`,   inline: true },
            { name: '⌚ Uptime',      value: uptimeStr,        inline: true },
          ).setFooter(FOOTER).setTimestamp()
        ],
      });
    }

    // ── SERVERINFO ────────────────────────────────────────────────────────
    else if (sub === 'serverinfo') {
      const guild = interaction.guild;
      if (!guild) return interaction.reply({ embeds: [errorEmbed('No Guild', 'This command only works in a server.')] });
      await guild.members.fetch({ force: false }).catch(() => {});
      const owner = await guild.fetchOwner().catch(() => null);
      const textChans  = guild.channels.cache.filter(c => c.type === ChannelType.GuildText).size;
      const voiceChans = guild.channels.cache.filter(c => c.type === ChannelType.GuildVoice).size;
      const embed = new EmbedBuilder()
        .setColor(C.info)
        .setTitle(`📊 ${guild.name}`)
        .setThumbnail(guild.iconURL({ size: 256 }))
        .addFields(
          { name: '🆔 Server ID',   value: `\`${guild.id}\``,                   inline: true },
          { name: '👑 Owner',       value: owner ? `<@${owner.id}>` : '—',       inline: true },
          { name: '🌍 Region',      value: guild.preferredLocale ?? '—',         inline: true },
          { name: '👥 Members',     value: `${guild.memberCount}`,              inline: true },
          { name: '🤖 Bots',        value: `${guild.members.cache.filter(m => m.user.bot).size}`, inline: true },
          { name: '💬 Text Chans',  value: `${textChans}`,                       inline: true },
          { name: '🔊 Voice Chans', value: `${voiceChans}`,                      inline: true },
          { name: '📌 Roles',       value: `${guild.roles.cache.size}`,          inline: true },
          { name: '😀 Emojis',      value: `${guild.emojis.cache.size}`,         inline: true },
          { name: '📅 Created',     value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:F>`, inline: true },
          { name: '🚀 Boosts',      value: `Level ${guild.premiumTier} (${guild.premiumSubscriptionCount ?? 0} boosts)`, inline: true },
        )
        .setFooter(FOOTER).setTimestamp();
      await interaction.reply({ embeds: [embed] });
    }

    // ── USERINFO ──────────────────────────────────────────────────────────
    else if (sub === 'userinfo') {
      const user    = interaction.options.getUser('user') ?? interaction.user;
      const member  = interaction.guild?.members.cache.get(user.id)
        ?? await interaction.guild?.members.fetch(user.id).catch(() => null);
      const fetched = await user.fetch().catch(() => user);
      const embed = new EmbedBuilder()
        .setColor(member?.displayColor || C.info)
        .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
        .setThumbnail(user.displayAvatarURL({ size: 256 }))
        .addFields(
          { name: '🆔 User ID',    value: `\`${user.id}\``,                                          inline: true },
          { name: '🤖 Bot',        value: user.bot ? 'Yes' : 'No',                                    inline: true },
          { name: '🎨 Accent',     value: fetched.hexAccentColor ? `\`${fetched.hexAccentColor}\`` : 'None', inline: true },
          { name: '📅 Account',    value: `<t:${Math.floor(user.createdTimestamp / 1000)}:F>`,       inline: true },
        );
      if (member) {
        embed.addFields(
          { name: '📥 Joined',     value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>`,     inline: true },
          { name: '🏆 Top Role',   value: member.roles.highest?.toString() ?? 'None',                 inline: true },
          { name: '📌 Roles',      value: `${member.roles.cache.size - 1}`,                           inline: true },
        );
        if (member.nickname) embed.addFields({ name: '📛 Nickname', value: member.nickname, inline: true });
      }
      embed.setFooter(FOOTER).setTimestamp();
      await interaction.reply({ embeds: [embed] });
    }

    // ── TRANSLATE ─────────────────────────────────────────────────────────
    else if (sub === 'translate') {
      const text = interaction.options.getString('text');
      const to   = (interaction.options.getString('to') ?? 'en').trim().toLowerCase() || 'en';
      await interaction.deferReply();
      try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx` +
                    `&sl=auto&tl=${encodeURIComponent(to)}&dt=t&q=${encodeURIComponent(text)}`;
        const data = await fetchJSON(url);
        // Response shape: [[[translated, original, ...], ...], null, detectedLang, ...]
        const translated = Array.isArray(data?.[0])
          ? data[0].map(seg => seg?.[0] ?? '').join('')
          : '';
        const detected = data?.[2] ?? 'unknown';
        if (!translated) throw new Error('Empty translation');
        const embed = new EmbedBuilder()
          .setColor(C.info)
          .setTitle('🌐 Translation')
          .addFields(
            { name: `📝 Original (${detected})`, value: text.slice(0, 1024),        inline: false },
            { name: `✅ Translated (${to})`,     value: translated.slice(0, 1024),  inline: false },
          )
          .setFooter(FOOTER).setTimestamp();
        await interaction.editReply({ embeds: [embed] });
      } catch (err) {
        await interaction.editReply({ embeds: [errorEmbed('Translation Failed', err.message)] });
      }
    }

    // ── WEATHER ───────────────────────────────────────────────────────────
    else if (sub === 'weather') {
      const city = interaction.options.getString('city');
      await interaction.deferReply();
      try {
        const geo = await fetchJSON(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`
        );
        if (!geo?.results?.length) {
          await interaction.editReply({ embeds: [errorEmbed('Not Found', `Couldn't find city **${city}**.`)] });
          return;
        }
        const place = geo.results[0];
        const wx = await fetchJSON(
          `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
          `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m` +
          `&timezone=auto`
        );
        const cur = wx?.current;
        if (!cur) throw new Error('No current weather data');
        const [label, desc] = WMO[cur.weather_code] ?? ['❓ Unknown', 'Weather code not recognized.'];
        const embed = new EmbedBuilder()
          .setColor(C.info)
          .setTitle(`🌤️ Weather — ${place.name}${place.country ? `, ${place.country}` : ''}`)
          .setDescription(`**${label}** — ${desc}`)
          .addFields(
            { name: '🌡️ Temperature',  value: `${cur.temperature_2m}°C (feels like ${cur.apparent_temperature}°C)`, inline: true },
            { name: '💧 Humidity',     value: `${cur.relative_humidity_2m}%`,                                       inline: true },
            { name: '💨 Wind',         value: `${cur.wind_speed_10m} km/h @ ${cur.wind_direction_10m}°`,           inline: true },
            { name: '🕐 Measured',     value: cur.time ?? '—',                                                      inline: true },
            { name: '📍 Coordinates',  value: `${place.latitude.toFixed(2)}, ${place.longitude.toFixed(2)}`,       inline: true },
            { name: '🌐 Timezone',     value: wx?.timezone ?? '—',                                                  inline: true },
          )
          .setFooter(FOOTER).setTimestamp();
        await interaction.editReply({ embeds: [embed] });
      } catch (err) {
        await interaction.editReply({ embeds: [errorEmbed('Weather Failed', err.message)] });
      }
    }
  },
};
