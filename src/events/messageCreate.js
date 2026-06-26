import { Events, EmbedBuilder } from 'discord.js';
import { addXp, getLevelingConfig } from '../utils/levelingUtil.js';
import { getDb } from '../utils/db.js';
import { enqueueTTS, getTTSState } from '../services/ttsService.js';

export default {
  name: Events.MessageCreate,
  async execute(message, client) {
    if (message.author.bot) return;
    if (!message.guild)     return;

    const guildId = message.guildId;
    const db      = getDb();

    // ── Custom Commands ────────────────────────────────────────────────
    const cfg    = db.data.guildConfig?.[guildId];
    const prefix = cfg?.prefix ?? '!';
    const lower  = message.content.toLowerCase().trim();

    // Check custom commands
    if (cfg?.customCmds) {
      for (const [trigger, cmd] of Object.entries(cfg.customCmds)) {
        if (lower === trigger || lower.startsWith(trigger + ' ')) {
          const embed = new EmbedBuilder().setColor(cmd.color ?? 0x5865f2).setTimestamp();
          if (cmd.title)    embed.setTitle(cmd.title);
          if (cmd.response) embed.setDescription(cmd.response);
          await message.channel.send({ embeds: [embed] }).catch(() => {});
          return;
        }
      }
    }

    // ── TTS ────────────────────────────────────────────────────────────
    // Works in any text channel that has been configured as a TTS channel
    const ttsChannelId = db.data.ttsChannels?.[guildId];
    if (ttsChannelId && message.channelId === ttsChannelId) {
      const state = getTTSState(guildId);
      if (state) {
        await enqueueTTS(
          message.guild,
          message.content,
          message.member?.displayName ?? message.author.username
        ).catch(err => console.error('[TTS] Enqueue error:', err.message));
      }
    }

    // ── XP Leveling ────────────────────────────────────────────────────
    const config = getLevelingConfig(guildId);
    if (config?.enabled) {
      try {
        const result = await addXp(guildId, message.author.id, client);
        if (result?.leveledUp) {
          const lvlChannel = config.channelId
            ? message.guild.channels.cache.get(config.channelId) ?? message.channel
            : message.channel;
          const lvlMsg = (config.message ?? '🎉 {user} leveled up to **Level {level}**!')
            .replace('{user}',  `<@${message.author.id}>`)
            .replace('{level}', result.level);
          await lvlChannel.send({
            embeds: [new EmbedBuilder()
              .setColor(0xffd700)
              .setDescription(lvlMsg)
              .setThumbnail(message.author.displayAvatarURL())
              .setTimestamp()
            ],
          }).catch(() => {});
        }
      } catch (err) {
        console.error('[XP] Error:', err.message);
      }
    }
  },
};
