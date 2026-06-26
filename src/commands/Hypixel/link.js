import { SlashCommandBuilder } from 'discord.js';
import { getUUID } from '../../services/hypixel.js';
import { getDb, saveDb } from '../../utils/db.js';
import { successEmbed, errorEmbed } from '../../utils/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('link')
    .setDescription('Link your Minecraft IGN to SkyBot for auction tracking & profile view')
    .addStringOption(o =>
      o.setName('ign').setDescription('Your Minecraft username').setRequired(true)
    ),
  cooldown: 10,

  async execute(interaction, client) {
    await interaction.deferReply();
    const ign = interaction.options.getString('ign').trim();

    try {
      const mojang = await getUUID(ign);
      const db = getDb();
      db.data.linkedPlayers[interaction.user.id] = { ign: mojang.name, uuid: mojang.id };
      await saveDb();

      await interaction.editReply({
        embeds: [successEmbed('Account Linked!',
          `Your Discord is now linked to **${mojang.name}**.\n` +
          `You'll get DM pings when your auctions sell, and you can use \`/profile\`.`
        )],
      });
    } catch (err) {
      await interaction.editReply({ embeds: [errorEmbed('Link Failed', `Could not find player \`${ign}\`. Check the spelling.`)] });
    }
  },
};
