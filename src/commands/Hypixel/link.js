/**
 * link.js — Link Discord account to Minecraft IGN
 */
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getUUID } from '../../services/hypixel.js';
import { getDb, saveDb } from '../../utils/db.js';
import { C, successEmbed, errorEmbed } from '../../utils/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('link')
    .setDescription('Link your Discord account to your Minecraft IGN')
    .addStringOption(o =>
      o.setName('ign').setDescription('Your Minecraft in-game name').setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply({ flags: [64] });
    const ign = interaction.options.getString('ign').trim();

    try {
      const { id: uuid, name: resolvedIGN } = await getUUID(ign);
      const db = getDb();
      if (!db.linkedPlayers) db.linkedPlayers = {};
      db.linkedPlayers[interaction.user.id] = {
        ign: resolvedIGN,
        uuid,
        linkedAt: Date.now(),
      };
      await saveDb();

      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(C.success)
          .setTitle('✅ Account Linked')
          .setDescription(`Your Discord account is now linked to **${resolvedIGN}**.`)
          .addFields(
            { name: 'IGN', value: resolvedIGN, inline: true },
            { name: 'UUID', value: `\`${uuid}\``, inline: true },
          )
          .setThumbnail(`https://mc-heads.net/avatar/${uuid}/64`)
          .setFooter({ text: 'SkyBot v2 • Railway Edition' })
          .setTimestamp()],
      });
    } catch (err) {
      return interaction.editReply({ embeds: [errorEmbed('Link Failed', err.message)] });
    }
  },
};
