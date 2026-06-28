/**
 * economy.js — SkyBot v2 Economy command
 *
 * Ported from SkyBot v1 (Discordbot-main/src/commands/Economy/economy.js).
 * Adapted for v2 flat db (db.economy, db.premiumUsers), SkyBot v2 footer,
 * and cooldown: 3.
 *
 * Subcommands:
 *   User:   /economy balance, /economy daily, /economy work, /economy crime,
 *           /economy deposit, /economy withdraw, /economy pay, /economy rob,
 *           /economy gamble, /economy leaderboard
 *   Admin:  /economy add, /economy reset
 */
import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getEconomy, saveEconomy, formatMoney, formatDuration } from '../../utils/economy.js';
import { C } from '../../utils/embeds.js';
import { getDb } from '../../utils/db.js';

const FOOTER   = { text: 'SkyBot v2 • Railway Edition' };
const DAILY    = 1000;
const DAILY_CD = 86_400_000;
const WORK_CD  = 3_600_000;
const CRIME_CD = 7_200_000;
const ROB_CD   = 3_600_000;
const BANK_CAP = 100_000;

const WORK_MSGS = [
  'coded a website for a client', 'delivered pizza in the rain',
  'drove Uber for 3 hours', 'fixed someone\'s broken PC',
  'sold memes on Fiverr', 'streamed on Twitch to 2 viewers',
  'tutored a failing student', 'wrote a bot for someone',
];
const CRIME_MSGS = [
  'robbed a vending machine', 'pickpocketed a tourist',
  'sold fake Yeezys online', 'hacked a parking meter',
  'shoplifted energy drinks', 'ran a lemonade stand without a permit',
];

function e(color, title, desc, fields = []) {
  const embed = new EmbedBuilder().setColor(color).setTitle(title).setFooter(FOOTER).setTimestamp();
  if (desc)         embed.setDescription(desc);
  if (fields.length) embed.addFields(fields);
  return embed;
}

export default {
  cooldown: 3,

  data: new SlashCommandBuilder()
    .setName('economy')
    .setDescription('Economy system — earn, spend and manage coins')
    .addSubcommand(s => s
      .setName('balance')
      .setDescription('Check wallet and bank balance')
      .addUserOption(o => o.setName('user').setDescription('Check another user').setRequired(false))
    )
    .addSubcommand(s => s.setName('daily').setDescription('Claim your daily reward (24h cooldown)'))
    .addSubcommand(s => s.setName('work').setDescription('Work a job for coins (1h cooldown)'))
    .addSubcommand(s => s.setName('crime').setDescription('Commit a crime — high risk, high reward (2h cooldown)'))
    .addSubcommand(s => s
      .setName('deposit')
      .setDescription('Move coins from wallet to bank (safe from robbery)')
      .addIntegerOption(o => o.setName('amount').setDescription('Amount to deposit').setRequired(true).setMinValue(1))
    )
    .addSubcommand(s => s
      .setName('withdraw')
      .setDescription('Move coins from bank to wallet')
      .addIntegerOption(o => o.setName('amount').setDescription('Amount to withdraw').setRequired(true).setMinValue(1))
    )
    .addSubcommand(s => s
      .setName('pay')
      .setDescription('Send coins to another user')
      .addUserOption(o => o.setName('user').setDescription('Recipient').setRequired(true))
      .addIntegerOption(o => o.setName('amount').setDescription('Amount to send').setRequired(true).setMinValue(1))
    )
    .addSubcommand(s => s
      .setName('rob')
      .setDescription('Attempt to steal from another user\'s wallet')
      .addUserOption(o => o.setName('user').setDescription('Target').setRequired(true))
    )
    .addSubcommand(s => s
      .setName('gamble')
      .setDescription('Bet coins — 55% chance to double your bet')
      .addIntegerOption(o => o.setName('amount').setDescription('Amount to gamble').setRequired(true).setMinValue(10))
    )
    .addSubcommand(s => s.setName('leaderboard').setDescription('Top 10 richest users in this server'))
    // ── Admin subcommands ──
    .addSubcommand(s => s
      .setName('add')
      .setDescription('Add coins to a user (Admin only)')
      .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
      .addIntegerOption(o => o.setName('amount').setDescription('Amount to add').setRequired(true).setMinValue(1))
      .addStringOption(o => o
        .setName('where').setDescription('Wallet or bank').setRequired(false)
        .addChoices({ name: 'Wallet', value: 'wallet' }, { name: 'Bank', value: 'bank' }))
    )
    .addSubcommand(s => s
      .setName('reset')
      .setDescription('Reset a user\'s economy (Admin only)')
      .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
    ),

  async execute(interaction, client) {
    const sub     = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const uid     = interaction.user.id;
    const now     = Date.now();

    // ── BALANCE ──────────────────────────────────────────────────────
    if (sub === 'balance') {
      const target  = interaction.options.getUser('user') ?? interaction.user;
      const d       = getEconomy(guildId, target.id);
      const total   = (d.wallet ?? 0) + (d.bank ?? 0);
      const bankPct = Math.min(100, Math.round(((d.bank ?? 0) / BANK_CAP) * 100));

      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(C.economy)
          .setAuthor({ name: `${target.username}'s Balance`, iconURL: target.displayAvatarURL() })
          .setThumbnail(target.displayAvatarURL({ size: 128 }))
          .addFields(
            { name: '💵 Wallet',    value: `**${formatMoney(d.wallet)}**`,                           inline: true },
            { name: '🏦 Bank',      value: `**${formatMoney(d.bank)}** / ${formatMoney(BANK_CAP)}`,  inline: true },
            { name: '💰 Net Worth', value: `**${formatMoney(total)}**`,                              inline: true },
            { name: 'Bank Usage',   value: `\`${'█'.repeat(Math.floor(bankPct/10))}${'░'.repeat(10-Math.floor(bankPct/10))}\` ${bankPct}%`, inline: false },
          )
          .setFooter(FOOTER).setTimestamp()
        ],
      });
    }

    // ── DAILY ─────────────────────────────────────────────────────────
    if (sub === 'daily') {
      const d  = getEconomy(guildId, uid);
      const cd = DAILY_CD - (now - (d.lastDaily ?? 0));
      if (cd > 0) {
        return interaction.reply({
          embeds: [e(C.error, 'Already Claimed', `You can claim your daily reward again in **${formatDuration(cd)}**.`)],
          flags: [64],
        });
      }
      const db       = getDb();
      const isPrem   = (db.premiumUsers ?? []).includes(uid);
      const amount   = isPrem ? Math.floor(DAILY * 1.5) : DAILY;
      const streak   = (d.streak ?? 0) + 1;
      const bonus    = streak >= 7 ? Math.floor(amount * 0.1) : 0;
      d.wallet      += amount + bonus;
      d.lastDaily    = now;
      d.streak       = streak;
      await saveEconomy(guildId, uid, d);
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(C.economy)
          .setTitle('Daily Reward Claimed')
          .addFields(
            { name: 'Reward',     value: formatMoney(amount),                              inline: true },
            { name: 'Streak',     value: `${streak} day${streak !== 1 ? 's' : ''}`,        inline: true },
            { name: 'Bonus',      value: bonus > 0 ? `+${formatMoney(bonus)} 🔥` : 'None', inline: true },
            { name: 'New Balance', value: `**${formatMoney(d.wallet)}**`,                  inline: false },
          )
          .setDescription(isPrem ? '⭐ Premium bonus applied (+50%)' : streak >= 7 ? '🔥 7-day streak bonus!' : null)
          .setFooter(FOOTER).setTimestamp()
        ],
      });
    }

    // ── WORK ──────────────────────────────────────────────────────────
    if (sub === 'work') {
      const d  = getEconomy(guildId, uid);
      const cd = WORK_CD - (now - (d.lastWork ?? 0));
      if (cd > 0) return interaction.reply({ embeds: [e(C.error, 'On Cooldown', `You can work again in **${formatDuration(cd)}**.`)], flags: [64] });
      const earned    = Math.floor(Math.random() * 601) + 200;
      const job       = WORK_MSGS[Math.floor(Math.random() * WORK_MSGS.length)];
      d.wallet       += earned;
      d.lastWork      = now;
      await saveEconomy(guildId, uid, d);
      return interaction.reply({
        embeds: [e(C.success, 'Work Complete', `You **${job}** and earned **${formatMoney(earned)}**.`)
          .addFields({ name: 'New Balance', value: `**${formatMoney(d.wallet)}**`, inline: true })
        ],
      });
    }

    // ── CRIME ─────────────────────────────────────────────────────────
    if (sub === 'crime') {
      const d  = getEconomy(guildId, uid);
      const cd = CRIME_CD - (now - (d.lastCrime ?? 0));
      if (cd > 0) return interaction.reply({ embeds: [e(C.error, 'Laying Low', `You need to lay low for **${formatDuration(cd)}** before your next crime.`)], flags: [64] });
      const success    = Math.random() > 0.4;
      const crime      = CRIME_MSGS[Math.floor(Math.random() * CRIME_MSGS.length)];
      d.lastCrime      = now;
      if (success) {
        const earned   = Math.floor(Math.random() * 1501) + 500;
        d.wallet      += earned;
        await saveEconomy(guildId, uid, d);
        return interaction.reply({ embeds: [e(C.success, 'Crime Successful', `You **${crime}** and got away with **${formatMoney(earned)}**.`)] });
      } else {
        const fine     = Math.floor(Math.random() * 401) + 100;
        d.wallet       = Math.max(0, d.wallet - fine);
        await saveEconomy(guildId, uid, d);
        return interaction.reply({ embeds: [e(C.error, 'Caught!', `You tried to **${crime}** but were caught.\nFine: **${formatMoney(fine)}**`)] });
      }
    }

    // ── DEPOSIT ───────────────────────────────────────────────────────
    if (sub === 'deposit') {
      const d      = getEconomy(guildId, uid);
      const space  = BANK_CAP - (d.bank ?? 0);
      const amount = Math.min(interaction.options.getInteger('amount'), d.wallet ?? 0, space);
      if (amount <= 0) return interaction.reply({ embeds: [e(C.error, 'Cannot Deposit', 'Your bank is full or wallet is empty.')], flags: [64] });
      d.wallet -= amount; d.bank = (d.bank ?? 0) + amount;
      await saveEconomy(guildId, uid, d);
      return interaction.reply({ embeds: [e(C.success, 'Deposited', `**${formatMoney(amount)}** moved to bank.\n🏦 Bank: **${formatMoney(d.bank)}** / ${formatMoney(BANK_CAP)}`)] });
    }

    // ── WITHDRAW ──────────────────────────────────────────────────────
    if (sub === 'withdraw') {
      const d      = getEconomy(guildId, uid);
      const amount = Math.min(interaction.options.getInteger('amount'), d.bank ?? 0);
      if (amount <= 0) return interaction.reply({ embeds: [e(C.error, 'Cannot Withdraw', 'Your bank balance is insufficient.')], flags: [64] });
      d.bank -= amount; d.wallet = (d.wallet ?? 0) + amount;
      await saveEconomy(guildId, uid, d);
      return interaction.reply({ embeds: [e(C.success, 'Withdrawn', `**${formatMoney(amount)}** moved to wallet.\n💵 Wallet: **${formatMoney(d.wallet)}**`)] });
    }

    // ── PAY ───────────────────────────────────────────────────────────
    if (sub === 'pay') {
      const target = interaction.options.getUser('user');
      const amount = interaction.options.getInteger('amount');
      if (target.id === uid) return interaction.reply({ embeds: [e(C.error, 'Invalid', 'You cannot pay yourself.')], flags: [64] });
      const sender = getEconomy(guildId, uid);
      if ((sender.wallet ?? 0) < amount) return interaction.reply({ embeds: [e(C.error, 'Insufficient Funds', `You only have **${formatMoney(sender.wallet)}** in your wallet.`)], flags: [64] });
      const receiver = getEconomy(guildId, target.id);
      sender.wallet  -= amount; receiver.wallet = (receiver.wallet ?? 0) + amount;
      await saveEconomy(guildId, uid, sender);
      await saveEconomy(guildId, target.id, receiver);
      return interaction.reply({ embeds: [e(C.success, 'Payment Sent', `Sent **${formatMoney(amount)}** to **${target.username}**.`)] });
    }

    // ── ROB ───────────────────────────────────────────────────────────
    if (sub === 'rob') {
      const target = interaction.options.getUser('user');
      if (target.id === uid) return interaction.reply({ embeds: [e(C.error, 'Invalid', 'You cannot rob yourself.')], flags: [64] });
      const robber = getEconomy(guildId, uid);
      const cd     = ROB_CD - (now - (robber.lastRob ?? 0));
      if (cd > 0) return interaction.reply({ embeds: [e(C.error, 'Wanted', `Wait **${formatDuration(cd)}** before attempting another robbery.`)], flags: [64] });
      const victim  = getEconomy(guildId, target.id);
      robber.lastRob = now;
      if ((victim.wallet ?? 0) < 100) {
        await saveEconomy(guildId, uid, robber);
        return interaction.reply({ embeds: [e(C.warning, 'Not Worth It', `${target.username} has less than **$100** in their wallet. Not worth the risk.`)] });
      }
      if (Math.random() > 0.45) {
        const stolen       = Math.floor((victim.wallet ?? 0) * (Math.random() * 0.3 + 0.1));
        victim.wallet     -= stolen; robber.wallet = (robber.wallet ?? 0) + stolen;
        await saveEconomy(guildId, uid, robber);
        await saveEconomy(guildId, target.id, victim);
        return interaction.reply({ embeds: [e(C.success, 'Robbery Successful', `Stole **${formatMoney(stolen)}** from **${target.username}**'s wallet.`)] });
      } else {
        const fine         = Math.floor((robber.wallet ?? 0) * 0.15);
        robber.wallet      = Math.max(0, (robber.wallet ?? 0) - fine);
        await saveEconomy(guildId, uid, robber);
        return interaction.reply({ embeds: [e(C.error, 'Caught in the Act', `You were caught robbing **${target.username}** and fined **${formatMoney(fine)}**.`)] });
      }
    }

    // ── GAMBLE ────────────────────────────────────────────────────────
    if (sub === 'gamble') {
      const d      = getEconomy(guildId, uid);
      const amount = Math.min(interaction.options.getInteger('amount'), d.wallet ?? 0);
      if (amount < 10) return interaction.reply({ embeds: [e(C.error, 'Too Low', 'You need at least **$10** in your wallet to gamble.')], flags: [64] });
      const win    = Math.random() > 0.45;
      d.wallet     = (d.wallet ?? 0) + (win ? amount : -amount);
      await saveEconomy(guildId, uid, d);
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(win ? C.success : C.error)
          .setTitle(win ? 'You Won!' : 'You Lost')
          .addFields(
            { name: 'Bet',     value: formatMoney(amount),              inline: true },
            { name: 'Result',  value: win ? `+${formatMoney(amount)}` : `-${formatMoney(amount)}`, inline: true },
            { name: 'Balance', value: formatMoney(d.wallet),            inline: true },
          )
          .setFooter(FOOTER).setTimestamp()
        ],
      });
    }

    // ── LEADERBOARD ───────────────────────────────────────────────────
    if (sub === 'leaderboard') {
      const db     = getDb();
      const users  = db.economy?.[guildId] ?? {};
      const sorted = Object.entries(users)
        .map(([id, d]) => ({ id, total: (d.wallet ?? 0) + (d.bank ?? 0) }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);

      const medals = ['🥇', '🥈', '🥉'];
      const lines  = sorted.map((u, i) =>
        `${medals[i] ?? `**${i+1}.**`} <@${u.id}> — **${formatMoney(u.total)}**`
      );

      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(C.economy)
          .setTitle('Economy Leaderboard')
          .setDescription(lines.join('\n') || 'No data yet.')
          .setFooter(FOOTER).setTimestamp()
        ],
      });
    }

    // ── ADD (Admin) ───────────────────────────────────────────────────
    if (sub === 'add') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ embeds: [e(C.error, 'No Permission', 'You need **Manage Server** permission to use this command.')], flags: [64] });
      }
      const target = interaction.options.getUser('user');
      const amount = interaction.options.getInteger('amount');
      const where  = interaction.options.getString('where') ?? 'wallet';
      const d      = getEconomy(guildId, target.id);
      if (where === 'bank') d.bank   = (d.bank   ?? 0) + amount;
      else                  d.wallet = (d.wallet ?? 0) + amount;
      d.totalEarned = (d.totalEarned ?? 0) + amount;
      await saveEconomy(guildId, target.id, d);
      return interaction.reply({
        embeds: [e(C.success, 'Coins Added', `Added **${formatMoney(amount)}** to **${target.username}**'s ${where}.\nNew ${where} balance: **${formatMoney(where === 'bank' ? d.bank : d.wallet)}**`)],
        flags: [64],
      });
    }

    // ── RESET (Admin) ─────────────────────────────────────────────────
    if (sub === 'reset') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ embeds: [e(C.error, 'No Permission', 'You need **Manage Server** permission to use this command.')], flags: [64] });
      }
      const target = interaction.options.getUser('user');
      await saveEconomy(guildId, target.id, {
        wallet: 0, bank: 0,
        lastDaily: 0, lastWork: 0, lastCrime: 0, lastRob: 0,
        inventory: [], totalEarned: 0,
      });
      return interaction.reply({
        embeds: [e(C.warning, 'Economy Reset', `**${target.username}**'s economy has been reset to zero.`)],
        flags: [64],
      });
    }
  },
};
