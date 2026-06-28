/**
 * removebg.js — SkyBot v2 Background Removal (remove.bg API)
 * =================================================================
 *
 * User attaches a PNG/JPG image, bot calls remove.bg, returns the
 * background-removed PNG as a Discord attachment.
 *
 * Requires `REMOVE_BG_API_KEY` env var (free key at https://www.remove.bg/api).
 *
 * v2 changes from v1:
 *   • Uses Node 18+ built-in global `fetch` and global `FormData` (no more
 *     `node-fetch` / `form-data` package deps).
 *   • Footer "SkyBot v2 • Railway Edition"; cooldown: 3.
 */
import { SlashCommandBuilder, AttachmentBuilder } from 'discord.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';

const MAX_BYTES = 25 * 1024 * 1024; // 25MB — remove.bg accepts up to this for the image_url flow
const FOOTER = { text: 'SkyBot v2 • Railway Edition' };

export default {
  data: new SlashCommandBuilder()
    .setName('removebg')
    .setDescription('Remove the background from an image (powered by remove.bg)')
    .addAttachmentOption((o) =>
      o.setName('image').setDescription('The image to process (PNG/JPG)').setRequired(true)),
  cooldown: 3,

  async execute(interaction, client) {
    if (!process.env.REMOVE_BG_API_KEY) {
      return interaction.reply({
        embeds: [errorEmbed(
          'Not Configured',
          '`REMOVE_BG_API_KEY` is not set in the environment.\nGet a free key at https://www.remove.bg/api',
        )],
        flags: [64],
      });
    }

    await interaction.deferReply();
    const attachment = interaction.options.getAttachment('image');

    if (!attachment.contentType?.startsWith('image/')) {
      return interaction.editReply({
        embeds: [errorEmbed('Invalid File', 'Please attach a PNG or JPG image.')],
      });
    }

    if (attachment.size && attachment.size > MAX_BYTES) {
      return interaction.editReply({
        embeds: [errorEmbed('File Too Large', `Image must be under **25MB**. Yours is **${(attachment.size / 1024 / 1024).toFixed(1)}MB**.`)],
      });
    }

    try {
      // Use Node 18+ global FormData + global fetch.
      const form = new FormData();
      form.append('image_url', attachment.url);
      form.append('size', 'auto');

      const res = await fetch('https://api.remove.bg/v1.0/removebg', {
        method: 'POST',
        headers: { 'X-Api-Key': process.env.REMOVE_BG_API_KEY },
        body: form,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const reason = err?.errors?.[0]?.title
          ?? err?.errors?.[0]?.detail
          ?? `remove.bg returned HTTP ${res.status}`;
        throw new Error(reason);
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      if (!buffer || buffer.length < 100) {
        throw new Error('remove.bg returned an empty or too-small response.');
      }
      const file = new AttachmentBuilder(buffer, { name: 'removed_bg.png' });

      await interaction.editReply({
        embeds: [successEmbed(
          '✅ Background Removed!',
          `Here's your image with the background removed.\n*Powered by [remove.bg](https://www.remove.bg)*`,
        )],
        files: [file],
      });
    } catch (err) {
      await interaction.editReply({
        embeds: [errorEmbed('remove.bg Error', err.message || 'Unknown error.')],
      });
    }
  },
};
