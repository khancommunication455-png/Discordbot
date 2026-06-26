import { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';

// In-memory party listings (resets on restart — use db for persistence)
const partyListings = new Map(); // msgId → { owner, floor, classNeeded, ign, note, ts }

const FLOORS = [
  'E','F1','F2','F3','F4','F5','F6','F7','M1','M2','M3','M4','M5','M6','M7'
];

export default {
  data: new SlashCommandBuilder()
    .setName('partyfinder')
    .setDescription('Find or create a dungeon party')
    .addSubcommand(s => s
      .setName('lfg')
      .setDescription('Post a Looking For Group listing')
      .addStringOption(o =>
        o.setName('floor').setDescription('Which floor?').setRequired(true)
         .addChoices(...FLOORS.map(f => ({ name: f, value: f })))
      )
      .addStringOption(o =>
        o.setName('class').setDescription('Class needed (e.g. Healer, Archer, Mage)').setRequired(false)
      )
      .addStringOption(o =>
        o.setName('ign').setDescription('Your Minecraft IGN').setRequired(false)
      )
      .addStringOption(o =>
        o.setName('note').setDescription('Extra info (e.g. 2/4 spots, 800+ cata)').setRequired(false)
      )
    )
    .addSubcommand(s => s
      .setName('list')
      .setDescription('See active LFG listings')
    ),

  async execute(interaction, client) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'lfg') {
      const floor     = interaction.options.getString('floor');
      const cls       = interaction.options.getString('class') ?? 'Any';
      const ign       = interaction.options.getString('ign') ?? interaction.user.username;
      const note      = interaction.options.getString('note') ?? '';

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`🗺️ LFG — ${floor}`)
        .addFields(
          { name: 'Posted by',    value: `<@${interaction.user.id}> (${ign})`, inline: true },
          { name: 'Floor',        value: floor,  inline: true },
          { name: 'Class Needed', value: cls,    inline: true },
          { name: 'Note',         value: note || 'None', inline: false },
        )
        .setFooter({ text: 'Click "Join Party" to notify the poster' })
        .setTimestamp();

      const joinBtn = new ButtonBuilder()
        .setCustomId(`pf_join_${interaction.user.id}`)
        .setLabel('Join Party')
        .setStyle(ButtonStyle.Success)
        .setEmoji('⚔️');

      const msg = await interaction.reply({
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(joinBtn)],
        fetchReply: true,
      });

      partyListings.set(msg.id, {
        owner: interaction.user.id,
        floor, cls, ign, note,
        ts: Date.now(),
      });

      // Auto-expire after 30 min
      setTimeout(async () => {
        partyListings.delete(msg.id);
        await msg.edit({ components: [] }).catch(() => {});
      }, 30 * 60 * 1000);

      // Handle join button
      const collector = msg.createMessageComponentCollector({ time: 30 * 60 * 1000 });
      collector.on('collect', async i => {
        if (i.user.id === interaction.user.id) {
          return i.reply({ content: "You can't join your own party!", ephemeral: true });
        }
        try {
          const owner = await client.users.fetch(interaction.user.id);
          await owner.send({
            embeds: [new EmbedBuilder()
              .setColor(0x57f287)
              .setTitle('Party Join Request')
              .setDescription(`<@${i.user.id}> (${i.user.username}) wants to join your **${floor}** party!`)
              .setTimestamp()
            ],
          });
          await i.reply({ content: `✅ Notified **${ign}** — check DMs!`, ephemeral: true });
        } catch {
          await i.reply({ content: `DM **${ign}** directly to join.`, ephemeral: true });
        }
      });
    }

    if (sub === 'list') {
      if (!partyListings.size) {
        return interaction.reply({ embeds: [errorEmbed('No Listings', 'No active LFG listings right now. Create one with `/partyfinder lfg`!')] });
      }
      const lines = [...partyListings.values()].map(l =>
        `**${l.floor}** — <@${l.owner}> (${l.ign}) | Class: ${l.cls} | ${l.note || 'No note'}`
      );
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('🗺️ Active LFG Listings')
        .setDescription(lines.join('\n'))
        .setTimestamp();
      await interaction.reply({ embeds: [embed] });
    }
  },
};
