import { SlashCommandBuilder, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { successEmbed, errorEmbed } from '../../utils/embeds.js';
import { createRequire } from 'module';

export default {
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
      .setDescription('Get a user\'s avatar')
      .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(false))
    )
    .addSubcommand(s => s
      .setName('banner')
      .setDescription('Get a user\'s banner')
      .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(false))
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
        if (!isFinite(result)) throw new Error('Result is not finite');
        await interaction.reply({
          embeds: [new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('🧮 Calculator')
            .addFields(
              { name: 'Expression', value: `\`${expr}\``, inline: true },
              { name: 'Result',     value: `**${result}**`, inline: true },
            ).setTimestamp()
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
          .setTimestamp()
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
          .setColor(0x57f287)
          .setTitle('🔐 Generated Password')
          .setDescription(`\`${pwd}\``)
          .setFooter({ text: 'Keep this safe — do not share it!' })
          .setTimestamp()
        ],
        ephemeral: true,
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
            .setColor(0x5865f2)
            .setTitle('🔢 Base Converter')
            .addFields(
              { name: `Base ${from} Input`,  value: `\`${num}\``,    inline: true },
              { name: `Base ${to} Output`,   value: `\`${result}\``, inline: true },
              { name: 'Decimal',             value: `\`${decimal}\``, inline: true },
            ).setTimestamp()
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
          .setColor(0x5865f2)
          .setTitle('⏰ Timestamp')
          .addFields(
            { name: 'Date',       value: date.toUTCString(), inline: false },
            { name: 'Unix',       value: `\`${unix}\``,      inline: true  },
            { name: 'Discord',    value: `<t:${unix}:F>`,    inline: true  },
            { name: 'Relative',   value: `<t:${unix}:R>`,    inline: true  },
            { name: 'Copy Format',value: `\`<t:${unix}:F>\``, inline: false },
          ).setTimestamp()
        ],
      });
    }

    // ── AVATAR ────────────────────────────────────────────────────────────
    else if (sub === 'avatar') {
      const user = interaction.options.getUser('user') ?? interaction.user;
      const url  = user.displayAvatarURL({ size: 1024, extension: 'png' });
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(`${user.username}'s Avatar`)
          .setImage(url)
          .setTimestamp()
        ],
      });
    }

    // ── BANNER ────────────────────────────────────────────────────────────
    else if (sub === 'banner') {
      const user    = await (interaction.options.getUser('user') ?? interaction.user).fetch();
      const bannerUrl = user.bannerURL({ size: 1024 });
      if (!bannerUrl) return interaction.reply({ embeds: [errorEmbed('No Banner', `${user.username} has no banner.`)] });
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`${user.username}'s Banner`).setImage(bannerUrl).setTimestamp()],
      });
    }
  },
};
