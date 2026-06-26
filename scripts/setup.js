/**
 * setup.js — postinstall: downloads yt-dlp if not available
 */
import { execSync } from 'child_process';
import { existsSync, mkdirSync, chmodSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { createWriteStream } from 'fs';
import https from 'https';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN_DIR   = path.join(__dirname, '../bin');
const BIN_PATH  = path.join(BIN_DIR, 'yt-dlp');

function ytdlpAvailable() {
  try { execSync('yt-dlp --version', { stdio: 'pipe', timeout: 5000 }); return true; } catch { return false; }
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    const get  = (u) => https.get(u, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) { get(res.headers.location); return; }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error',  reject);
    }).on('error', reject);
    get(url);
  });
}

async function main() {
  if (ytdlpAvailable()) {
    console.log('[Setup] yt-dlp already installed ✅');
    return;
  }

  console.log('[Setup] yt-dlp not found, attempting installation...');
  if (!existsSync(BIN_DIR)) mkdirSync(BIN_DIR, { recursive: true });

  // Try pip
  try {
    execSync('pip install yt-dlp 2>/dev/null || pip3 install yt-dlp 2>/dev/null', { stdio: 'pipe', timeout: 60000 });
    if (ytdlpAvailable()) { console.log('[Setup] yt-dlp installed via pip ✅'); return; }
  } catch {}

  // Download binary
  try {
    console.log('[Setup] Downloading yt-dlp binary...');
    await downloadFile('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp', BIN_PATH);
    chmodSync(BIN_PATH, 0o755);
    console.log('[Setup] yt-dlp binary downloaded ✅');
  } catch (err) {
    console.warn('[Setup] Could not install yt-dlp:', err.message);
    console.warn('[Setup] Download will still work if yt-dlp is installed on the system.');
  }
}

main().catch(console.error);
