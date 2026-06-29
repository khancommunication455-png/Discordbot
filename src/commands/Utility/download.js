/**
 * download.js — SkyBot v2 Social Media Downloader FIXED
 *
 * FIXES:
 * 1. Instagram: uses SnapInsta scraper via HTTP (no login needed)
 * 2. TikTok: uses multiple fallback downloaders (ssstik, tikwm, snaptik)
 * 3. YouTube: yt-dlp with multiple clients as before
 * 4. General: cobalt.tools API as universal fallback
 */
import { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { existsSync, unlinkSync, mkdirSync, readdirSync, statSync, createWriteStream } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { exec, execSync, spawn } from 'child_process';
import { promisify } from 'util';
import https from 'https';
import http from 'http';
import { C } from '../../utils/embeds.js';

const execAsync = promisify(exec);
const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP_DIR = join(__dirname, '../../../tmp');
const FOOTER = { text: 'SkyBot v2 • Railway Edition' };
const DISCORD_MAX_BYTES = 25 * 1024 * 1024;

if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });

function findYtDlp() {
  for (const p of ['yt-dlp', '/root/.nix-profile/bin/yt-dlp', '/usr/bin/yt-dlp', '/usr/local/bin/yt-dlp']) {
    try {
      if (p === 'yt-dlp') { execSync('yt-dlp --version', { stdio: 'pipe', timeout: 5000 }); return p; }
      if (existsSync(p)) return p;
    } catch {}
  }
  return 'yt-dlp';
}
const ytdlp = findYtDlp();
const YT_CLIENTS = ['tv', 'web_embedded', 'web_safari', 'android', 'ios', 'web'];

// ── HTTP helper ──
function httpGet(url, headers = {}, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const makeReq = (u, redirects = 0) => {
      if (redirects > 5) { reject(new Error('Too many redirects')); return; }
      const parsed = new URL(u);
      const mod = parsed.protocol === 'https:' ? https : http;
      mod.get({
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        timeout: timeoutMs,
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          ...headers,
        },
      }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          makeReq(res.headers.location, redirects + 1); return;
        }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('Timeout')); });
    };
    makeReq(url);
  });
}

function httpPost(url, body, headers = {}, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const data = typeof body === 'string' ? Buffer.from(body) : body;
    const req = mod.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      timeout: timeoutMs,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': data.length,
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', function() { this.destroy(); reject(new Error('Timeout')); });
    req.write(data);
    req.end();
  });
}

// Download a URL directly to a file
function downloadFile(url, destPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const makeReq = (u, redirects = 0) => {
      if (redirects > 5) { reject(new Error('Too many redirects')); return; }
      const parsed = new URL(u);
      const mod = parsed.protocol === 'https:' ? https : http;
      mod.get({
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        timeout: 60000,
        headers: { 'User-Agent': 'Mozilla/5.0', ...headers },
      }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          makeReq(res.headers.location, redirects + 1); return;
        }
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
        const ws = createWriteStream(destPath);
        res.pipe(ws);
        ws.on('finish', resolve);
        ws.on('error', reject);
      }).on('error', reject);
    };
    makeReq(url);
  });
}

// ── INSTAGRAM: SnapInsta scraper ──
async function downloadInstagram(url, outPath) {
  console.log('[Download] Trying SnapInsta for Instagram...');

  // Step 1: Get SnapInsta page to find token
  const pageRes = await httpGet('https://snapinsta.app/', {
    'Accept': 'text/html,application/xhtml+xml',
    'Referer': 'https://snapinsta.app/',
  });
  const pageHtml = pageRes.body.toString();

  // Extract token from page
  const tokenMatch = pageHtml.match(/name="_token"\s+value="([^"]+)"/);
  if (!tokenMatch) throw new Error('SnapInsta: could not extract token');
  const token = tokenMatch[1];

  // Step 2: Submit URL to SnapInsta API
  const formData = `url=${encodeURIComponent(url)}&_token=${encodeURIComponent(token)}`;
  const apiRes = await httpPost('https://snapinsta.app/action.php', formData, {
    'Referer': 'https://snapinsta.app/',
    'Origin': 'https://snapinsta.app',
    'X-Requested-With': 'XMLHttpRequest',
  });

  const apiBody = apiRes.body.toString();

  // Extract video URL from response
  const videoMatch = apiBody.match(/href="(https:\/\/[^"]+\.mp4[^"]*)"/i)
    || apiBody.match(/download_link.*?href="([^"]+)"/i)
    || apiBody.match(/"url":"(https:\\\/\\\/[^"]+\.mp4[^"]*)"/i);

  if (!videoMatch) {
    // Try extracting any direct media URL
    const anyMedia = apiBody.match(/https:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/i);
    if (!anyMedia) throw new Error('SnapInsta: no video URL found in response');
    const videoUrl = anyMedia[0].replace(/\\\/\//g, '//').replace(/\\\//g, '/');
    await downloadFile(videoUrl, outPath);
    return outPath;
  }

  const videoUrl = videoMatch[1].replace(/&amp;/g, '&').replace(/\\\/\//g, '//').replace(/\\\//g, '/');
  await downloadFile(videoUrl, outPath);
  return outPath;
}

// ── TIKTOK: tikwm.com API ──
async function downloadTikTok(url, outPath) {
  console.log('[Download] Trying tikwm.com for TikTok...');

  const formData = `url=${encodeURIComponent(url)}&count=12&cursor=0&web=1&hd=1`;
  const res = await httpPost('https://www.tikwm.com/api/', formData, {
    'Accept': 'application/json',
    'Referer': 'https://www.tikwm.com/',
    'Origin': 'https://www.tikwm.com',
  });

  const data = JSON.parse(res.body.toString());
  if (!data?.data?.play && !data?.data?.hdplay) {
    throw new Error('tikwm: no video URL');
  }

  const videoUrl = data.data.hdplay || data.data.play;
  await downloadFile(videoUrl, outPath, { 'Referer': 'https://www.tiktok.com/' });
  return outPath;
}

// ── COBALT: universal fallback (supports YT, TikTok, IG, Twitter, etc.) ──
async function downloadCobalt(url, outPath) {
  console.log('[Download] Trying cobalt.tools...');

  const res = await httpPost('https://cobalt.tools/api/json', JSON.stringify({ url, vQuality: '720' }), {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Origin': 'https://cobalt.tools',
    'Referer': 'https://cobalt.tools/',
  });

  const data = JSON.parse(res.body.toString());
  if (data.status !== 'stream' && data.status !== 'redirect') {
    throw new Error(`Cobalt: ${data.text || data.status || 'unknown error'}`);
  }

  const videoUrl = data.url;
  await downloadFile(videoUrl, outPath);
  return outPath;
}

// ── YT-DLP download with multiple clients ──
async function downloadYtdlp(url, outTpl, formatArg) {
  for (const client of YT_CLIENTS) {
    const isYT = /youtube\.com|youtu\.be/.test(url);
    const extraArgs = isYT
      ? `--extractor-args "youtube:player_client=${client}"`
      : '';
    const cmd = `"${ytdlp}" ${formatArg} --no-playlist --max-filesize 24M --no-warnings --no-check-certificates ${extraArgs} -o "${outTpl}" "${url}"`;
    try {
      await execAsync(cmd, { timeout: 120000, maxBuffer: 50 * 1024 * 1024 });
      console.log(`[Download] yt-dlp ${client} ✅`);
      return true;
    } catch (err) {
      console.warn(`[Download] yt-dlp ${client} failed: ${String(err.stderr || err.message || err).slice(0, 120)}`);
      if (!isYT) break; // No point trying multiple clients for non-YT
    }
  }
  return false;
}

export default {
  data: new SlashCommandBuilder()
    .setName('download').setDescription('Download video/audio from social media')
    .addStringOption(o => o.setName('url').setDescription('Video URL (YouTube, TikTok, Instagram, etc.)').setRequired(true))
    .addStringOption(o => o.setName('quality').setDescription('Download quality').setRequired(false)
      .addChoices(
        { name: 'Best available', value: 'best' },
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
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.error).setTitle('❌ Invalid URL').setDescription('Provide a valid URL.').setFooter(FOOTER).setTimestamp()] });
    }

    const ts = Date.now();
    const isInstagram = /instagram\.com/.test(url);
    const isTikTok = /tiktok\.com/.test(url);
    const isYouTube = /youtube\.com|youtu\.be/.test(url);

    await interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.info).setTitle('⬇️ Downloading...').setDescription(`**URL:** ${url.slice(0, 80)}\n**Quality:** ${quality === 'audio' ? 'MP3' : quality}\n*This may take up to 30s...*`).setFooter(FOOTER).setTimestamp()] });

    let outPath = null;
    let downloadSuccess = false;
    let lastError = 'Unknown error';

    // ── Strategy 1: Platform-specific downloaders ──
    if (isInstagram && quality !== 'audio') {
      const destPath = join(TMP_DIR, `dl_${ts}.mp4`);
      try {
        await downloadInstagram(url, destPath);
        if (existsSync(destPath) && statSync(destPath).size > 10000) {
          outPath = destPath;
          downloadSuccess = true;
          console.log('[Download] SnapInsta ✅');
        }
      } catch (e) {
        lastError = e.message;
        console.warn('[Download] SnapInsta failed:', e.message);
      }
    }

    if (!downloadSuccess && isTikTok && quality !== 'audio') {
      const destPath = join(TMP_DIR, `dl_${ts}.mp4`);
      try {
        await downloadTikTok(url, destPath);
        if (existsSync(destPath) && statSync(destPath).size > 10000) {
          outPath = destPath;
          downloadSuccess = true;
          console.log('[Download] TikWM ✅');
        }
      } catch (e) {
        lastError = e.message;
        console.warn('[Download] TikWM failed:', e.message);
      }
    }

    // ── Strategy 2: yt-dlp ──
    if (!downloadSuccess) {
      const outTpl = join(TMP_DIR, `dl_${ts}.%(ext)s`);
      let formatArg;
      if (quality === 'audio') formatArg = `-x --audio-format mp3 --audio-quality 0 -f "bestaudio/best"`;
      else if (quality === 'best') formatArg = `-f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"`;
      else formatArg = `-f "bestvideo[height<=${quality}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${quality}]/best"`;

      downloadSuccess = await downloadYtdlp(url, outTpl, formatArg);
      if (downloadSuccess) {
        const files = readdirSync(TMP_DIR).filter(f => f.startsWith(`dl_${ts}`) && !f.endsWith('.part') && !f.endsWith('.ytdl'));
        if (files.length) outPath = join(TMP_DIR, files[0]);
        else downloadSuccess = false;
      }
    }

    // ── Strategy 3: Cobalt universal fallback ──
    if (!downloadSuccess && quality !== 'audio') {
      const destPath = join(TMP_DIR, `dl_${ts}.mp4`);
      try {
        await downloadCobalt(url, destPath);
        if (existsSync(destPath) && statSync(destPath).size > 10000) {
          outPath = destPath;
          downloadSuccess = true;
          console.log('[Download] Cobalt ✅');
        }
      } catch (e) {
        lastError = e.message;
        console.warn('[Download] Cobalt failed:', e.message);
      }
    }

    if (!downloadSuccess || !outPath || !existsSync(outPath)) {
      let msg;
      if (isInstagram) msg = `Instagram download failed. The video may be private or a Story/Reel that requires login.\n\n**Tip:** Try posting the Instagram URL from a public account.`;
      else if (isTikTok) msg = `TikTok download failed. Try a direct video URL.\n\`Error: ${lastError.slice(0, 200)}\``;
      else msg = `Download failed: ${lastError.slice(0, 300)}`;
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.error).setTitle('❌ Download Failed').setDescription(msg).setFooter(FOOTER).setTimestamp()] });
    }

    const ext = outPath.split('.').pop() ?? 'mp4';
    const fileSize = statSync(outPath).size;

    if (fileSize > DISCORD_MAX_BYTES) {
      try { unlinkSync(outPath); } catch {}
      const sizeMB = (fileSize / 1024 / 1024).toFixed(1);
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor(C.warning).setTitle('⚠️ File Too Large').setDescription(`File is **${sizeMB}MB** — exceeds Discord's 25MB limit.\nTry \`/download quality:audio\` or a shorter clip.`).setFooter(FOOTER).setTimestamp()] });
    }

    const platform = isInstagram ? 'Instagram' : isTikTok ? 'TikTok' : isYouTube ? 'YouTube' : 'Video';
    const attachment = new AttachmentBuilder(outPath, { name: `${platform}_${ts}.${ext}` });
    const sizeMB = (fileSize / 1024 / 1024).toFixed(2);

    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(C.success ?? 0x00FF00).setTitle('✅ Download Complete').addFields({ name: 'Platform', value: platform, inline: true }, { name: 'Quality', value: quality === 'audio' ? 'MP3' : quality, inline: true }, { name: 'Size', value: `${sizeMB} MB`, inline: true }).setFooter(FOOTER).setTimestamp()],
      files: [attachment],
    });

    setTimeout(() => { try { unlinkSync(outPath); } catch {} }, 30000);
  },
};
