import { SlashCommandBuilder, AttachmentBuilder } from 'discord.js';
import FormData from 'form-data';
import fetch from 'node-fetch';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';

export default {
  data: new SlashCommandBuilder()
    .setName('removebg')
    .setDescription('Remove the background from an image (powered by remove.bg)')
    .addAttachmentOption(o =>
      o.setName('image').setDescription('The image to process (PNG/JPG)').setRequired(true)
    ),
  cooldown: 10,

  async execute(interaction, client) {
    if (!process.env.REMOVE_BG_API_KEY) {
      return interaction.reply({
        embeds: [errorEmbed('Not Configured', 'REMOVE_BG_API_KEY is not set in .env.\nGet a free key at https://www.remove.bg/api')],
        flags: [64],
      });
    }

    await interaction.deferReply();
    const attachment = interaction.options.getAttachment('image');

    if (!attachment.contentType?.startsWith('image/')) {
      return interaction.editReply({ embeds: [errorEmbed('Invalid File', 'Please attach a PNG or JPG image.')] });
    }

    try {
      const form = new FormData();
      form.append('image_url', attachment.url);
      form.append('size', 'auto');

      const res = await fetch('https://api.remove.bg/v1.0/removebg', {
        method: 'POST',
        headers: {
          'X-Api-Key': process.env.REMOVE_BG_API_KEY,
          ...form.getHeaders(),
        },
        body: form,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.errors?.[0]?.title ?? `remove.bg returned ${res.status}`);
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      const file   = new AttachmentBuilder(buffer, { name: 'removed_bg.png' });

      await interaction.editReply({
        embeds: [successEmbed('Background Removed!', `Here's your image with the background removed.`)],
        files: [file],
      });
    } catch (err) {
      await interaction.editReply({ embeds: [errorEmbed('remove.bg Error', err.message)] });
    }
  },
};
