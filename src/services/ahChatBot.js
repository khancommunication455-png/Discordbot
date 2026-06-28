/**
 * ahChatBot.js — SkyBot v2 AH/Skyblock AI ChatBot (Groq-powered)
 * =================================================================
 *
 * Answers Hypixel Skyblock economy / Auction House questions using
 * Groq's llama-3.3-70b-versatile model (free tier, fast inference).
 *
 * Two trigger modes:
 *   1. Trigger prefix anywhere:  `!ah <question>` in any channel
 *   2. Auto-respond in a dedicated channel: set `AH_CHATBOT_CHANNEL_ID`
 *      env var — every message in that channel is treated as a question
 *      (no prefix needed).
 *
 * Live context (top 10 BIN auctions) is fetched from the Hypixel AH and
 * injected into the system prompt so the model can answer "what's the
 * going rate for X" with current data.
 *
 * Requires `GROQ_API_KEY` env var. If unset, the service is disabled
 * (a warning is logged, no crash).
 *
 * Exported entry point: startAHChatBot(client) — called from index.js
 * on the 'ready' event.
 */
import Groq from 'groq-sdk';
import { getBazaar, getAHPage } from './hypixel.js';
import { formatCoins, C } from '../utils/embeds.js';
import { EmbedBuilder } from 'discord.js';

const FOOTER = { text: 'SkyBot v2 • Powered by Groq' };
const CHATBOT_TRIGGER = '!ah ';

let groq = null;
let started = false;

// ── Build live-economy context for the system prompt ─────────────────────
async function buildContext() {
  const parts = [];

  // Top BIN listings (most expensive) — gives the model a sense of
  // "what's hot on the AH right now".
  try {
    const page = await getAHPage(0);
    if (page && Array.isArray(page.auctions) && page.auctions.length) {
      const topBin = page.auctions
        .filter((a) => a.bin)
        .sort((a, b) => (b.starting_bid || 0) - (a.starting_bid || 0))
        .slice(0, 10)
        .map((a) => `  - ${a.item_name || 'Unknown'}: ${formatCoins(a.starting_bid)} coins`)
        .join('\n');
      if (topBin) {
        parts.push(`Current top-10 BIN auctions on the Hypixel AH (live):\n${topBin}`);
      }
    }
  } catch (err) {
    console.warn('[AHChatBot] getAHPage context fetch failed:', err.message);
  }

  // Top Bazaar items (highest buy price) — useful for "is X worth selling
  // to bazaar or AH" questions.
  try {
    const bz = await getBazaar();
    if (bz && bz.success !== false && bz.products) {
      const topBz = Object.values(bz.products)
        .map((p) => ({
          name:      p.product_id,
          buyPrice:  p.quick_status?.buyPrice ?? 0,
          sellPrice: p.quick_status?.sellPrice ?? 0,
        }))
        .filter((p) => p.buyPrice > 0)
        .sort((a, b) => b.buyPrice - a.buyPrice)
        .slice(0, 8)
        .map((p) => `  - ${p.name}: buy ${formatCoins(p.buyPrice)} / sell ${formatCoins(p.sellPrice)}`)
        .join('\n');
      if (topBz) {
        parts.push(`Current top-8 Bazaar items by buy price (live):\n${topBz}`);
      }
    }
  } catch (err) {
    console.warn('[AHChatBot] getBazaar context fetch failed:', err.message);
  }

  if (!parts.length) return '';
  return `\n\n--- LIVE HYPIXEL SKYBLOCK ECONOMY SNAPSHOT ---\n${parts.join('\n\n')}\n--- END SNAPSHOT ---\n\n`;
}

// ── Entry point: register the messageCreate listener ─────────────────────
export function startAHChatBot(client) {
  if (started) {
    console.warn('[AHChatBot] startAHChatBot called twice — ignoring.');
    return;
  }
  if (!process.env.GROQ_API_KEY) {
    console.warn('[AHChatBot] GROQ_API_KEY not set — service disabled.');
    return;
  }

  try {
    groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  } catch (err) {
    console.error('[AHChatBot] Groq init failed:', err.message);
    return;
  }

  started = true;

  client.on('messageCreate', async (msg) => {
    if (msg.author.bot) return;

    const isInAHChannel = process.env.AH_CHATBOT_CHANNEL_ID
      && msg.channelId === process.env.AH_CHATBOT_CHANNEL_ID;
    const hasTrigger = msg.content.startsWith(CHATBOT_TRIGGER);

    if (!isInAHChannel && !hasTrigger) return;

    const question = hasTrigger
      ? msg.content.slice(CHATBOT_TRIGGER.length).trim()
      : msg.content.trim();

    if (!question) return;
    if (question.length > 1000) {
      try {
        await msg.reply('❌ Question too long — please keep it under 1000 characters.');
      } catch { /* ignore */ }
      return;
    }

    try { await msg.channel.sendTyping(); } catch { /* ignore */ }

    // Fetch live AH + Bazaar snapshot for the system prompt.
    const context = await buildContext();

    try {
      const completion = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 512,
        temperature: 0.4,
        messages: [
          {
            role: 'system',
            content:
              `You are SkyBot v2, an expert Hypixel Skyblock Auction House assistant.\n`
              + `You answer questions about the Auction House, item prices, flipping strategies, the Bazaar, and the general Skyblock economy.\n`
              + `Be concise, helpful, and accurate. Format coin amounts with K/M/B suffixes (e.g. 12.5M, 1.2B).\n`
              + `If you don't know a current price, say so — do not invent numbers.\n`
              + context,
          },
          { role: 'user', content: question },
        ],
      });

      const reply = completion.choices[0]?.message?.content?.trim()
        ?? 'No answer available.';

      // Discord embed description limit is 4096; leave room for the title.
      const truncated = reply.length > 4000 ? `${reply.slice(0, 3997)}...` : reply;

      const embed = new EmbedBuilder()
        .setColor(C.ai)
        .setTitle('🤖 AH Assistant')
        .setDescription(truncated)
        .setFooter(FOOTER)
        .setTimestamp();

      // If replying in the dedicated AH channel, use a plain reply (no ping).
      // If triggered via !ah, also use a non-pinging reply.
      try {
        await msg.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
      } catch (err) {
        // Fallback: send as a standalone message in the same channel.
        try { await msg.channel.send({ embeds: [embed] }); } catch { /* ignore */ }
        console.warn('[AHChatBot] reply() failed, sent standalone instead:', err.message);
      }
    } catch (err) {
      console.error('[AHChatBot] Groq completion error:', err.message);
      try {
        await msg.reply(`❌ Groq error: \`${err.message}\`\nTry again in a moment.`);
      } catch { /* ignore */ }
    }
  });

  console.log('✅ AH ChatBot ready (trigger: "!ah <question>"'
    + (process.env.AH_CHATBOT_CHANNEL_ID ? ` | auto-respond in channel ${process.env.AH_CHATBOT_CHANNEL_ID})` : ')'));
}
