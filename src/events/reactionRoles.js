/**
 * reactionRoles.js — SkyBot v2 Reaction role event listeners
 *
 * Ported from SkyBot v1 (Discordbot-main/src/events/reactionRoles.js).
 * Adapted for v2 flat db (db.reactionRoles instead of db.data.reactionRoles).
 *
 * Exports two named event modules — `reactionAdd` and `reactionRemove` —
 * which the v2 loadEvents() loader registers separately. There is no
 * default export (the loader handles named exports too).
 *
 * Behavior:
 *   - If a message has a registered reaction role binding (per-guild, per-
 *     message, per-emoji), adding the reaction assigns the bound role and
 *     removing it revokes the role.
 *   - Bot reactions and partial fetch failures are silently ignored.
 *   - Emoji key format matches what the slash command stored: for custom
 *     emojis it is the full `<:name:id>` (or `<a:name:id>` for animated),
 *     for unicode emojis it is the literal character.
 */
import { Events } from 'discord.js';
import { getDb } from '../utils/db.js';

async function handleReaction(reaction, user, add) {
  if (user.bot) return;
  if (reaction.partial) await reaction.fetch().catch(() => {});
  if (!reaction.message) return;

  const db      = getDb();
  const guildId = reaction.message.guildId;
  if (!guildId) return;

  const msgId = reaction.message.id;
  const emoji = reaction.emoji.id
    ? `<${reaction.emoji.animated ? 'a' : ''}:${reaction.emoji.name}:${reaction.emoji.id}>`
    : reaction.emoji.name;

  const roleId = db.reactionRoles?.[guildId]?.[msgId]?.[emoji];
  if (!roleId) return;

  const guild  = reaction.message.guild;
  if (!guild) return;
  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) return;

  if (add) {
    await member.roles.add(roleId).catch(() => {});
  } else {
    await member.roles.remove(roleId).catch(() => {});
  }
}

export const reactionAdd = {
  name: Events.MessageReactionAdd,
  async execute(reaction, user, client) {
    await handleReaction(reaction, user, true);
  },
};

export const reactionRemove = {
  name: Events.MessageReactionRemove,
  async execute(reaction, user, client) {
    await handleReaction(reaction, user, false);
  },
};

// No default export — both events are registered via named exports
// (the v2 loadEvents loader iterates Object.entries(mod) and registers
// every export that has a `name` property).

