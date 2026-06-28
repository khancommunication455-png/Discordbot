/**
 * fun.js — SkyBot v2 Fun command
 *
 * Ported from SkyBot v1 (Discordbot-main/src/commands/Fun/fun.js).
 * Adapted for v2 flat db (db.birthdays), SkyBot v2 footer, cooldown: 3.
 *
 * Original subcommands (kept): poll, flip, roll, fight, 8ball, rps,
 *   birthday, birthdays
 * New subcommands added in v2: meme, joke, choose, urban
 *
 * Public APIs (no keys required):
 *   - meme:  https://meme-api.com/gimme
 *   - joke:  https://v2.jokeapi.dev/joke/Any?safe-mode
 *   - urban: https://api.urbandictionary.com/v0/define?term=...
 */
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getDb, saveDb } from '../../utils/db.js';
import { successEmbed, errorEmbed, C } from '../../utils/embeds.js';

const FOOTER = { text: 'SkyBot v2 • Railway Edition' };

async function fetchJSON(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'SkyBot-v2 (Discord bot)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export default {
  cooldown: 3,

  data: new SlashCommandBuilder()
    .setName('fun')
    .setDescription('Fun commands')
    .addSubcommand(s => s
      .setName('poll')
      .setDescription('Create a quick yes/no or custom poll')
      .addStringOption(o => o.setName('question').setDescription('Poll question').setRequired(true))
      .addStringOption(o => o.setName('options').setDescription('Comma-separated options (leave blank for Yes/No)').setRequired(false))
    )
    .addSubcommand(s => s.setName('flip').setDescription('Flip a coin'))
    .addSubcommand(s => s
      .setName('roll')
      .setDescription('Roll a dice')
      .addIntegerOption(o => o.setName('sides').setDescription('Number of sides (default 6)').setMinValue(2).setMaxValue(10000).setRequired(false))
    )
    .addSubcommand(s => s
      .setName('fight')
      .setDescription('Fight another user')
      .addUserOption(o => o.setName('user').setDescription('Who to fight').setRequired(true))
    )
    .addSubcommand(s => s
      .setName('8ball')
      .setDescription('Ask the magic 8-ball a question')
      .addStringOption(o => o.setName('question').setDescription('Your question').setRequired(true))
    )
    .addSubcommand(s => s
      .setName('rps')
      .setDescription('Rock Paper Scissors against the bot')
      .addStringOption(o => o.setName('choice').setDescription('Your choice').setRequired(true).addChoices(
        { name: '🪨 Rock', value: 'rock' },
        { name: '📄 Paper', value: 'paper' },
        { name: '✂️ Scissors', value: 'scissors' },
      ))
    )
    .addSubcommand(s => s
      .setName('birthday')
      .setDescription('Set your birthday')
      .addIntegerOption(o => o.setName('day').setDescription('Day (1-31)').setRequired(true).setMinValue(1).setMaxValue(31))
      .addIntegerOption(o => o.setName('month').setDescription('Month (1-12)').setRequired(true).setMinValue(1).setMaxValue(12))
    )
    .addSubcommand(s => s.setName('birthdays').setDescription('See upcoming birthdays'))
    // ── New v2 subcommands ──
    .addSubcommand(s => s.setName('meme').setDescription('Get a random meme from r/memes'))
    .addSubcommand(s => s.setName('joke').setDescription('Get a random safe joke'))
    .addSubcommand(s => s
      .setName('choose')
      .setDescription('Let the bot pick from a list of options')
      .addStringOption(o => o.setName('options').setDescription('Comma-separated options e.g. "pizza, sushi, tacos"').setRequired(true))
    )
    .addSubcommand(s => s
      .setName('urban')
      .setDescription('Look up a term on Urban Dictionary')
      .addStringOption(o => o.setName('term').setDescription('Word to look up').setRequired(true))
    ),

  async execute(interaction, client) {
    const sub     = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const db      = getDb();

    // ── POLL ──────────────────────────────────────────────────────────────
    if (sub === 'poll') {
      const question = interaction.options.getString('question');
      const optsRaw  = interaction.options.getString('options');
      const opts     = optsRaw ? optsRaw.split(',').map(o => o.trim()).filter(Boolean) : ['Yes', 'No'];
      const emojis   = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];

      const embed = new EmbedBuilder()
        .setColor(C.fun)
        .setTitle(`📊 Poll`)
        .setDescription(`**${question}**\n\n${opts.slice(0, 10).map((o, i) => `${emojis[i]} ${o}`).join('\n')}`)
        .setFooter({ text: `Poll by ${interaction.user.tag} • SkyBot v2` })
        .setTimestamp();

      const msg = await interaction.reply({ embeds: [embed], fetchReply: true });
      for (let i = 0; i < Math.min(opts.length, 10); i++) {
        await msg.react(emojis[i]).catch(() => {});
      }
    }

    // ── FLIP ──────────────────────────────────────────────────────────────
    else if (sub === 'flip') {
      const result = Math.random() > 0.5 ? '🪙 Heads' : '🪙 Tails';
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(C.economy).setTitle('Coin Flip').setDescription(`**${result}**`).setFooter(FOOTER).setTimestamp()] });
    }

    // ── ROLL ──────────────────────────────────────────────────────────────
    else if (sub === 'roll') {
      const sides  = interaction.options.getInteger('sides') ?? 6;
      const result = Math.floor(Math.random() * sides) + 1;
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(C.info).setTitle(`🎲 d${sides}`).setDescription(`You rolled **${result}** out of ${sides}`).setFooter(FOOTER).setTimestamp()] });
    }

    // ── FIGHT ─────────────────────────────────────────────────────────────
    else if (sub === 'fight') {
      const opponent = interaction.options.getUser('user');
      if (opponent.id === interaction.user.id) {
        return interaction.reply({ embeds: [errorEmbed('Error', "You can't fight yourself!")], flags: [64] });
      }
      const win = Math.random() > 0.5;
      const winner = win ? interaction.user : opponent;
      const loser  = win ? opponent : interaction.user;
      const moves  = ['a devastating uppercut', 'a spinning kick', 'a sneaky backstab', 'a headbutt', 'a roundhouse kick', 'a combo finisher'];
      const move   = moves[Math.floor(Math.random() * moves.length)];
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(C.error)
          .setTitle('⚔️ Fight!')
          .setDescription(`**${winner.username}** defeated **${loser.username}** with ${move}! 🏆`)
          .setFooter(FOOTER).setTimestamp()
        ],
      });
    }

    // ── 8BALL ─────────────────────────────────────────────────────────────
    else if (sub === '8ball') {
      const question = interaction.options.getString('question');
      const answers  = [
        '✅ It is certain.', '✅ Without a doubt.', '✅ Yes, definitely!', '✅ You may rely on it.',
        '🟡 Reply hazy, try again.', '🟡 Ask again later.', '🟡 Cannot predict now.',
        '❌ Don\'t count on it.', '❌ My sources say no.', '❌ Very doubtful.',
      ];
      const answer = answers[Math.floor(Math.random() * answers.length)];
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(C.leveling)
          .setTitle('🎱 Magic 8-Ball')
          .addFields(
            { name: 'Question', value: question,  inline: false },
            { name: 'Answer',   value: answer,    inline: false },
          ).setFooter(FOOTER).setTimestamp()
        ],
      });
    }

    // ── RPS ───────────────────────────────────────────────────────────────
    else if (sub === 'rps') {
      const choices = ['rock', 'paper', 'scissors'];
      const emojis  = { rock: '🪨', paper: '📄', scissors: '✂️' };
      const user    = interaction.options.getString('choice');
      const bot     = choices[Math.floor(Math.random() * 3)];
      const wins    = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

      let result;
      if (user === bot)            result = "It's a tie! 🤝";
      else if (wins[user] === bot) result = `You win! ${emojis[user]} beats ${emojis[bot]} 🎉`;
      else                         result = `You lose! ${emojis[bot]} beats ${emojis[user]} 😔`;

      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(C.info)
          .setTitle('✂️ Rock Paper Scissors')
          .addFields(
            { name: 'You',    value: `${emojis[user]} ${user}`,  inline: true },
            { name: 'Bot',    value: `${emojis[bot]} ${bot}`,    inline: true },
            { name: 'Result', value: result,                     inline: false },
          ).setFooter(FOOTER).setTimestamp()
        ],
      });
    }

    // ── BIRTHDAY ──────────────────────────────────────────────────────────
    else if (sub === 'birthday') {
      const day   = interaction.options.getInteger('day');
      const month = interaction.options.getInteger('month');
      if (!db.birthdays) db.birthdays = {};
      if (!db.birthdays[guildId]) db.birthdays[guildId] = {};
      db.birthdays[guildId][interaction.user.id] = { day, month };
      await saveDb();
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      await interaction.reply({ embeds: [successEmbed('Birthday Set', `Your birthday is set to **${months[month-1]} ${day}** 🎂`)] });
    }

    // ── BIRTHDAYS ─────────────────────────────────────────────────────────
    else if (sub === 'birthdays') {
      const bdays = db.birthdays?.[guildId] ?? {};
      if (!Object.keys(bdays).length) return interaction.reply({ embeds: [errorEmbed('No Birthdays', 'No birthdays set yet. Use `/fun birthday`.')] });
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const today  = new Date();
      const sorted = Object.entries(bdays).sort(([, a], [, b]) => {
        const da = new Date(today.getFullYear(), a.month - 1, a.day);
        const db2 = new Date(today.getFullYear(), b.month - 1, b.day);
        if (da < today) da.setFullYear(today.getFullYear() + 1);
        if (db2 < today) db2.setFullYear(today.getFullYear() + 1);
        return da - db2;
      });
      const lines = sorted.slice(0, 15).map(([id, d]) => `<@${id}> — **${months[d.month-1]} ${d.day}**`);
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(0xff69b4).setTitle('🎂 Upcoming Birthdays').setDescription(lines.join('\n')).setFooter(FOOTER).setTimestamp()],
      });
    }

    // ── MEME ──────────────────────────────────────────────────────────────
    else if (sub === 'meme') {
      await interaction.deferReply();
      try {
        const data = await fetchJSON('https://meme-api.com/gimme');
        const embed = new EmbedBuilder()
          .setColor(C.fun)
          .setTitle(data.title ?? 'Meme')
          .setURL(data.postLink ?? null)
          .setImage(data.url ?? null)
          .setFooter({ text: `r/${data.subreddit ?? 'memes'} • SkyBot v2` })
          .setTimestamp();
        await interaction.editReply({ embeds: [embed] });
      } catch (err) {
        await interaction.editReply({ embeds: [errorEmbed('Meme Failed', `Couldn't fetch a meme: ${err.message}`)] });
      }
    }

    // ── JOKE ──────────────────────────────────────────────────────────────
    else if (sub === 'joke') {
      await interaction.deferReply();
      try {
        const data = await fetchJSON('https://v2.jokeapi.dev/joke/Any?safe-mode');
        const embed = new EmbedBuilder()
          .setColor(C.fun)
          .setTitle('😂 Random Joke')
          .setFooter(FOOTER)
          .setTimestamp();
        if (data.type === 'single') {
          embed.setDescription(data.joke);
        } else if (data.type === 'twopart') {
          embed.addFields(
            { name: 'Setup',     value: data.setup     ?? '?', inline: false },
            { name: 'Punchline', value: data.delivery  ?? '?', inline: false },
          );
        } else {
          embed.setDescription('No joke available right now.');
        }
        await interaction.editReply({ embeds: [embed] });
      } catch (err) {
        await interaction.editReply({ embeds: [errorEmbed('Joke Failed', `Couldn't fetch a joke: ${err.message}`)] });
      }
    }

    // ── CHOOSE ────────────────────────────────────────────────────────────
    else if (sub === 'choose') {
      const opts = interaction.options.getString('options')
        .split(',').map(o => o.trim()).filter(Boolean);
      if (opts.length < 2) {
        return interaction.reply({ embeds: [errorEmbed('Not Enough Options', 'Provide at least 2 comma-separated options.')], flags: [64] });
      }
      const pick = opts[Math.floor(Math.random() * opts.length)];
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(C.fun)
          .setTitle('🎲 Choice Made')
          .setDescription(`Options: ${opts.map(o => `\`${o}\``).join(', ')}\n\n🎯 I choose: **${pick}**`)
          .setFooter(FOOTER).setTimestamp()
        ],
      });
    }

    // ── URBAN ─────────────────────────────────────────────────────────────
    else if (sub === 'urban') {
      const term = interaction.options.getString('term');
      await interaction.deferReply();
      try {
        const data = await fetchJSON(`https://api.urbandictionary.com/v0/define?term=${encodeURIComponent(term)}`);
        const list = data?.list ?? [];
        if (!list.length) {
          await interaction.editReply({ embeds: [errorEmbed('Not Found', `No Urban Dictionary entry for **${term}**.`)] });
          return;
        }
        // Pick the top entry (most thumbs up)
        const top = list.sort((a, b) => (b.thumbs_up ?? 0) - (a.thumbs_up ?? 0))[0];
        const def = (top.definition ?? '').slice(0, 1024);
        const ex  = (top.example ?? '').slice(0, 1024);
        const embed = new EmbedBuilder()
          .setColor(C.fun)
          .setTitle(`📖 ${top.word ?? term}`)
          .setURL(top.permalink ?? null)
          .addFields(
            { name: 'Definition', value: def || '—', inline: false },
            ...(ex ? [{ name: 'Example', value: ex, inline: false }] : []),
            { name: '👍 / 👎', value: `${top.thumbs_up ?? 0} / ${top.thumbs_down ?? 0}`, inline: true },
            { name: 'Author',   value: top.author ?? '—', inline: true },
          )
          .setFooter(FOOTER)
          .setTimestamp();
        await interaction.editReply({ embeds: [embed] });
      } catch (err) {
        await interaction.editReply({ embeds: [errorEmbed('Lookup Failed', `Couldn't fetch definition: ${err.message}`)] });
      }
    }
  },
};
