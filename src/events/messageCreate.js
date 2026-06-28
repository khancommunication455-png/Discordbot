/**
 * messageCreate.js — enqueue TTS for messages in watched channels
 *
 * If a guild has TTS active and the message is in the watched text channel,
 * the message is enqueued for speaking. Bot messages and commands are skipped.
 *
 * If AI mode is on and the message mentions the bot OR starts with "ai ",
 * it's treated as an AI prompt (response is generated + spoken).
 */
import { getTTSState, enqueueTTS } from '../services/ttsService.js';
import { getDb } from '../utils/db.js';

export default {
  name: 'messageCreate',
  async execute(message, client) {
    if (message.author.bot) return;
    if (!message.guild) return; // DMs

    const state = getTTSState(message.guild.id);
    if (!state) return;

    // Only read messages in the watched text channel
    if (message.channelId !== state.textChannelId) return;

    // Skip command prefixes
    if (message.content.startsWith('/')) return;
    if (message.content.startsWith('!')) return;

    const db = getDb();
    const aiMode = db.ttsAIMode?.[message.guild.id] ?? state.aiMode ?? false;

    // AI trigger: mention bot OR prefix with "ai "
    const mentionsBot = message.mentions.has(client.user.id);
    const hasAiPrefix = /^\s*ai\s+/i.test(message.content);

    if (aiMode && (mentionsBot || hasAiPrefix)) {
      const cleanedText = message.content
        .replace(/<@!?\d+>/g, '')
        .replace(/^\s*ai\s+/i, '')
        .trim();
      if (!cleanedText) return;
      await enqueueTTS(message.guild, cleanedText, message.author.username, true);
      return;
    }

    // Normal read mode (or AI mode without trigger): read message aloud
    await enqueueTTS(message.guild, message.content, message.author.username, false);
  },
};
