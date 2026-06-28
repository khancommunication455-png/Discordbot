/**
 * download.js — SkyBot v2 Social Media Downloader (yt-dlp powered)
 *
 * Supports YouTube, TikTok, Instagram, Twitter/X, Reddit, Facebook, +1000 more.
 * Quality: best/1080p/720p/480p/audio
 *
 * YouTube bot-detection bypass: tries 4 player clients (web_safari, web, android, ios)
 * Discord 25MB limit enforced AFTER successful download.
 */
import { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { existsSync, unlinkSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import { C } from '../../utils/embeds.js';

const execAsync = promisify(exec);
const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP_DIR = join(__dirname, '../../../tmp');
const FOOTER = { text: 'SkyBot v2 • Railway Edition' };
const DISCORD_MAX_BYTES = 25 * 1024 * 1024; // 25MB

if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });

// ── Find yt-dlp ──
function findYtDlp() {
  const paths = ['yt-dlp', '/root/.nix-profile/bin/yt-dlp', '/usr/bin/yt-dlp', '/usr/local/bin/yt-dlp', '/nix/var/nix/profiles/default/bin/yt-dlp'];
  for (const p of paths) {
    try {
      if (p === 'yt-dlp') { execSync('yt-dlp --version', { stdio: 'pipe', timeout: 5000 }); return p; }
      if (existsSync(p)) return p;
    } catch {}
  }
  return 'yt-dlp';
}
const ytdlp = findYtDlp();

// ── Player clients for YouTube bot bypass ──
// 'tv' and 'web_embedded' don't require po_token and work on Railway IPs
const PLAYER_CLIENTS = ['tv', 'web_embedded', 'web_safari', 'web', 'android', 'ios'];

export default {
  data: new SlashCommandBuilder()
    .setName('download')
    .setDescription('Download a video/audio from social media')
    .addStringOption(o => o.setName('url').setDescription('Video URL (YouTube, TikTok, Instagram, etc.)').setRequired(true))
    .addStringOption(o => o.setName('quality').setDescription('Download quality').setRequired(false)
      .addChoices(
        { name: 'Best available', value: 'best' },
        { name: '1080p', value: '1080' },
        { name: '720p', value: '720' },
        { name: '480p', value: '480' },
        { name: 'Audio only (MP3)', value: 'audio' },
      )),

  cooldown: 5,

  async execute(interaction) {
    await interaction.deferReply();

    const url = interaction.options.getString('url');
    const quality = interaction.options.getString('quality') ?? 'best';

    if (!/^https?:\/\//.test(url)) {
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.error).setTitle('❌ Invalid URL').setDescription('Please provide a valid URL starting with http:// or https://').setFooter(FOOTER).setTimestamp()] });
    }

    const ts = Date.now();
    const outTpl = join(TMP_DIR, `dl_${ts}.%(ext)s`);

    await interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.info).setTitle('⬇️ Downloading...').setDescription(`**URL:** ${url.slice(0, 80)}\n**Quality:** ${quality === 'audio' ? 'MP3 Audio' : quality}\n\nThis may take 10-60 seconds depending on video length.`).setFooter(FOOTER).setTimestamp()] });

    // Build format selector with fallbacks
    // The trailing /best ensures we always get SOMETHING even if specific
    // formats aren't available for the chosen player client
    let formatArg;
    if (quality === 'audio') {
      formatArg = `-x --audio-format mp3 --audio-quality 0 -f "bestaudio/best"`;
    } else if (quality === 'best') {
      formatArg = `-f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best[ext=webm]/bestvideo+bestaudio/best"`;
    } else {
      formatArg = `-f "bestvideo[height<=${quality}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${quality}][ext=mp4]/best[height<=${quality}]/best"`;
    }

    // Try multiple player clients for YouTube bot bypass
    let downloadSuccess = false;
    let lastError = null;

    for (const client of PLAYER_CLIENTS) {
      const cmd = `"${ytdlp}" ${formatArg} --no-playlist --no-warnings --no-cookies --no-check-certificates --extractor-args "youtube:player_client=${client}" -o "${outTpl}" "${url}"`;
      try {
        await execAsync(cmd, { timeout: 120_000, maxBuffer: 50 * 1024 * 1024 });
        downloadSuccess = true;
        console.log(`[Download] yt-dlp succeeded via ${client} client ✅`);
        break;
      } catch (err) {
        lastError = err;
        console.warn(`[Download] ${client} client failed: ${String(err.stderr || err.message || err).slice(0, 150)}`);
        // Clean partial files
        try { readdirSync(TMP_DIR).filter(f => f.startsWith(`dl_${ts}`)).forEach(f => { try { unlinkSync(join(TMP_DIR, f)); } catch {} }); } catch {}
      }
    }

    if (!downloadSuccess) {
      const errStr = String(lastError?.stderr || lastError?.message || lastError);
      // Check specific error types for better messages
      let errorMsg;
      if (errStr.includes('Sign in to confirm') || errStr.includes('not a bot')) {
        errorMsg = 'YouTube is blocking the bot from downloading this video. This is a known issue with server IPs. Try a different video or use a direct link.';
      } else if (errStr.includes('Instagram') && errStr.includes('empty media')) {
        errorMsg = 'Instagram requires login to download this post. Instagram blocks downloads from server IPs without authentication. Only public Instagram posts can be downloaded.';
      } else if (errStr.includes('Private video') || errStr.includes('unavailable')) {
        errorMsg = 'This video is private or unavailable.';
      } else if (errStr.includes('page needs to be reloaded')) {
        errorMsg = 'YouTube is blocking the bot. Try again in a few minutes, or use a direct video URL.';
      } else {
        errorMsg = `Download failed: ${errStr.slice(0, 300)}`;
      }
      return interaction.editReply({ embeds: [new EmbedBuilder()
        .setColor(C.error)
        .setTitle('❌ Download Failed')
        .setDescription(errorMsg)
        .setFooter(FOOTER).setTimestamp()] });
    }

    // Find output file
    const files = readdirSync(TMP_DIR)
      .filter(f => f.startsWith(`dl_${ts}`) && !f.endsWith('.part') && !f.endsWith('.ytdl'))
      .map(f => join(TMP_DIR, f));

    if (!files.length) {
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.error).setTitle('❌ Download Failed').setDescription('Download completed but output file not found. The video may be too large or in an unsupported format.').setFooter(FOOTER).setTimestamp()] });
    }

    const filePath = files[0];
    const ext = filePath.split('.').pop() ?? 'mp4';
    const fileSize = statSync(filePath).size;

    // Check Discord 25MB limit
    if (fileSize > DISCORD_MAX_BYTES) {
      try { unlinkSync(filePath); } catch {}
      const sizeMB = (fileSize / 1024 / 1024).toFixed(1);
      const fallback = quality === 'audio'
        ? `File is **${sizeMB}MB** — exceeds Discord's 25MB limit. Try a shorter clip.`
        : `File is **${sizeMB}MB** — exceeds Discord's 25MB limit.\nTry \`/download quality:audio\` for a smaller MP3, or pick a lower resolution (480p).`;
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.warning).setTitle('⚠️ File Too Large').setDescription(fallback).setFooter(FOOTER).setTimestamp()] });
    }

    // Get title (best-effort)
    let title = 'video';
    for (const client of PLAYER_CLIENTS) {
      try {
        const r = await execAsync(`"${ytdlp}" --get-title --no-playlist --no-cookies --no-check-certificates --extractor-args "youtube:player_client=${client}" "${url}" 2>/dev/null`, { timeout: 10_000 });
        title = (r.stdout?.trim() || 'video').slice(0, 60);
        if (title !== 'video') break;
      } catch {}
    }

    const safeName = (title || 'video').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_') || 'video';
    const attachment = new AttachmentBuilder(filePath, { name: `${safeName}.${ext}` });
    const sizeMB = (fileSize / 1024 / 1024).toFixed(2);

    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(C.success)
        .setTitle('✅ Download Complete')
        .setDescription(`**${title}**`)
        .addFields(
          { name: 'Quality', value: quality === 'audio' ? 'MP3 Audio' : quality, inline: true },
          { name: 'Source', value: `[Link](${url})`, inline: true },
          { name: 'Size', value: `${sizeMB} MB`, inline: true },
        )
        .setFooter(FOOTER).setTimestamp()],
      files: [attachment],
    });

    // Clean up after 30s
    setTimeout(() => { try { unlinkSync(filePath); } catch {} }, 30_000);
  },
};
