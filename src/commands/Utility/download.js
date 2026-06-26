import { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { existsSync, unlinkSync, mkdirSync, readdirSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import { C } from '../../utils/embeds.js';

const execAsync = promisify(exec);
const __dirname  = dirname(fileURLToPath(import.meta.url));
const TMP_DIR    = join(__dirname, '../../../tmp');
const BIN_DIR    = join(__dirname, '../../../bin');
if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });
if (!existsSync(BIN_DIR)) mkdirSync(BIN_DIR, { recursive: true });

// Find yt-dlp — checks PATH, pip locations, and our local bin
function findYtDlp() {
  const candidates = [
    'yt-dlp',                                              // PATH
    '/usr/local/bin/yt-dlp',                              // pip global
    '/usr/bin/yt-dlp',
    '/root/.local/bin/yt-dlp',                            // pip user Railway
    '/home/user/.local/bin/yt-dlp',
    join(BIN_DIR, 'yt-dlp'),                              // our downloaded binary
    '/data/data/com.termux/files/usr/bin/yt-dlp',        // Termux
    '/nix/var/nix/profiles/default/bin/yt-dlp',          // Nixpacks
  ];

  for (const c of candidates) {
    try {
      const bin = c === 'yt-dlp' ? c : (existsSync(c) ? c : null);
      if (!bin) continue;
      execSync(`${bin} --version`, { stdio: 'pipe', timeout: 5000 });
      return bin;
    } catch {}
  }
  return null;
}

// Install yt-dlp at runtime if missing
async function ensureYtDlp() {
  const existing = findYtDlp();
  if (existing) return existing;

  console.log('[Download] yt-dlp not found, installing...');

  // Try pip
  try {
    await execAsync('pip install yt-dlp 2>&1 || pip3 install yt-dlp 2>&1', { timeout: 60000 });
    const found = findYtDlp();
    if (found) { console.log('[Download] yt-dlp installed via pip'); return found; }
  } catch {}

  // Download binary directly
  try {
    const dest = join(BIN_DIR, 'yt-dlp');
    await execAsync(
      `curl -L "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp" -o "${dest}"`,
      { timeout: 60000 }
    );
    chmodSync(dest, 0o755);
    console.log('[Download] yt-dlp binary downloaded');
    return dest;
  } catch {}

  return null;
}

export default {
  data: new SlashCommandBuilder()
    .setName('download')
    .setDescription('Download video from YouTube, TikTok, Instagram, Twitter/X, Reddit + 1000 more sites')
    .addStringOption(o =>
      o.setName('url').setDescription('Video URL').setRequired(true)
    )
    .addStringOption(o =>
      o.setName('quality')
       .setDescription('Quality preset')
       .setRequired(false)
       .addChoices(
         { name: '🏆 Best quality',    value: 'best'  },
         { name: '📺 1080p',           value: '1080'  },
         { name: '📺 720p',            value: '720'   },
         { name: '📺 480p',            value: '480'   },
         { name: '🎵 Audio only MP3',  value: 'audio' },
       )
    ),
  cooldown: 20,

  async execute(interaction, client) {
    await interaction.deferReply();

    const url     = interaction.options.getString('url');
    const quality = interaction.options.getString('quality') ?? 'best';
    const ts      = Date.now();
    const outTpl  = join(TMP_DIR, `dl_${ts}.%(ext)s`);

    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(C.info)
        .setTitle('⬇️ Downloading...')
        .setDescription(`\`${url.slice(0, 80)}\`\nQuality: **${quality === 'audio' ? 'MP3 Audio' : quality}**`)
        .setFooter({ text: 'TITAN Jr. Downloader • yt-dlp' }).setTimestamp()
      ],
    });

    try {
      const ytdlp = await ensureYtDlp();
      if (!ytdlp) {
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(C.error)
            .setTitle('yt-dlp Not Available')
            .setDescription('Could not install yt-dlp on this server.\n\nFor Railway: add `yt-dlp` to your nixpacks.toml under nixPkgs.\nFor Termux: `pkg install yt-dlp`')
            .setFooter({ text: 'TITAN Jr. Downloader' }).setTimestamp()
          ],
        });
      }

      // Build args
      let formatArg;
      if (quality === 'audio') {
        formatArg = `-x --audio-format mp3 --audio-quality 0`;
      } else if (quality === 'best') {
        formatArg = `-f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best[ext=webm]/best"`;
      } else {
        formatArg = `-f "bestvideo[height<=${quality}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${quality}][ext=mp4]/best[height<=${quality}]"`;
      }

      const cmd = `"${ytdlp}" ${formatArg} --no-playlist --max-filesize 24M --no-warnings -o "${outTpl}" "${url}"`;

      // Get title while downloading
      let title = 'video';
      execAsync(`"${ytdlp}" --get-title --no-playlist "${url}" 2>/dev/null`)
        .then(r => { title = (r.stdout?.trim() || 'video').slice(0, 60); })
        .catch(() => {});

      await execAsync(cmd, { timeout: 120_000, maxBuffer: 50 * 1024 * 1024 });

      // Find output file
      const files = readdirSync(TMP_DIR)
        .filter(f => f.startsWith(`dl_${ts}`) && !f.endsWith('.part') && !f.endsWith('.ytdl'))
        .map(f => join(TMP_DIR, f));

      if (!files.length) throw new Error('Download completed but output file not found.');

      const filePath   = files[0];
      const ext        = filePath.split('.').pop() ?? 'mp4';
      const safeName   = (title || 'video').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_');
      const attachment = new AttachmentBuilder(filePath, { name: `${safeName}.${ext}` });

      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(C.success)
          .setTitle('✅ Download Complete')
          .setDescription(`**${title || url.slice(0, 60)}**`)
          .addFields(
            { name: 'Quality', value: quality === 'audio' ? 'MP3 Audio' : quality, inline: true },
            { name: 'Source',  value: `[Link](${url})`,                             inline: true },
          )
          .setFooter({ text: 'TITAN Jr. Downloader • yt-dlp' }).setTimestamp()
        ],
        files: [attachment],
      });

      setTimeout(() => { try { unlinkSync(filePath); } catch {} }, 30_000);

    } catch (err) {
      let msg = (err.message ?? 'Download failed.').split('\n')[0];
      if (msg.includes('max-filesize') || msg.includes('larger than'))
        msg = 'File exceeds Discord\'s **25MB limit**. Try a lower quality or audio only.';
      else if (msg.includes('Unsupported URL'))
        msg = 'This URL is not supported. Try YouTube, TikTok, Instagram, Twitter, Reddit.';
      else if (msg.includes('Private') || msg.includes('private'))
        msg = 'This video is private or age-restricted.';
      else if (msg.includes('not found') || msg.includes('ENOENT'))
        msg = 'yt-dlp installation failed. Contact the server admin.';
      else
        msg = msg.slice(0, 250);

      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(C.error)
          .setTitle('❌ Download Failed')
          .setDescription(msg)
          .setFooter({ text: 'TITAN Jr. Downloader' }).setTimestamp()
        ],
      });
    }
  },
};
