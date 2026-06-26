/**
 * ahChatBot.js
 * Watches a designated channel for AH/Skyblock questions.
 * Answers using Groq (llama-3.3-70b-versatile) — free tier.
 */
import Groq from 'groq-sdk';
import { getBazaar, getAHPage } from './hypixel.js';
import { formatCoins } from '../utils/embeds.js';
import { EmbedBuilder } from 'discord.js';

const CHATBOT_TRIGGER = '!ah ';  // or set AH_CHATBOT_CHANNEL_ID to auto-respond in that channel

let groq;

export function startAHChatBot(client) {
  if (!process.env.GROQ_API_KEY) {
    console.warn('[AHChatBot] GROQ_API_KEY not set, disabled.');
    return;
  }
  groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

  client.on('messageCreate', async (msg) => {
    if (msg.author.bot) return;

    const isInAHChannel = process.env.AH_CHATBOT_CHANNEL_ID &&
                          msg.channelId === process.env.AH_CHATBOT_CHANNEL_ID;
    const hasTrigger = msg.content.startsWith(CHATBOT_TRIGGER);

    if (!isInAHChannel && !hasTrigger) return;

    const question = hasTrigger
      ? msg.content.slice(CHATBOT_TRIGGER.length).trim()
      : msg.content.trim();

    if (!question) return;

    await msg.channel.sendTyping();

    // Fetch some live context
    let context = '';
    try {
      const page = await getAHPage(0);
      const topItems = page.auctions
        .filter(a => a.bin)
        .sort((a, b) => b.starting_bid - a.starting_bid)
        .slice(0, 10)
        .map(a => `${a.item_name}: ${formatCoins(a.starting_bid)}`)
        .join('\n');
      context = `\nCurrent top BIN prices on AH (right now):\n${topItems}`;
    } catch {}

    try {
      const completion = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 512,
        messages: [
          {
            role: 'system',
            content: `You are SkyBot, an expert Hypixel Skyblock AH assistant. 
You answer questions about the Auction House, item prices, flipping strategies, Bazaar, and general Skyblock economy.
Be concise and helpful. Format numbers with K/M/B suffixes.
${context}`,
          },
          { role: 'user', content: question },
        ],
      });

      const reply = completion.choices[0]?.message?.content ?? 'No answer available.';

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('🤖 AH Assistant')
        .setDescription(reply.slice(0, 4000))
        .setFooter({ text: `Powered by Groq • Llama 3.3 70B` })
        .setTimestamp();

      await msg.reply({ embeds: [embed] });
    } catch (err) {
      await msg.reply(`❌ Groq error: ${err.message}`);
    }
  });

  console.log('✅ AH ChatBot ready (trigger: "!ah <question>")');
}
