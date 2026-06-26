import { Events } from 'discord.js';
import { getDb } from '../utils/db.js';

async function handleReaction(reaction, user, add) {
  if (user.bot) return;
  if (reaction.partial) await reaction.fetch().catch(() => {});

  const db      = getDb();
  const guildId = reaction.message.guildId;
  if (!guildId) return;

  const msgId   = reaction.message.id;
  const emoji   = reaction.emoji.id
    ? `<${reaction.emoji.animated ? 'a' : ''}:${reaction.emoji.name}:${reaction.emoji.id}>`
    : reaction.emoji.name;

  const roleId  = db.data.reactionRoles?.[guildId]?.[msgId]?.[emoji];
  if (!roleId) return;

  const guild  = reaction.message.guild;
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
