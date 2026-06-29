# 🎮 SkyBot — All-in-One Hypixel Skyblock Discord Bot

A fully-featured Discord bot built for Hypixel Skyblock communities.  
Combines music, moderation, ticket system, carry management, AH flipping tools, profile viewer, video downloader, and more.

---

## ✨ Features

### 🏦 Hypixel Skyblock
| Command | Description |
|---|---|
| `/link <ign>` | Link your Minecraft account to Discord |
| `/profile [ign]` | View full SkyBlock profile (skills, catacombs, networth) 
| `/auction [ign]` | See active AH listings for a player |
| `/bazaar <item>` | Check Bazaar buy/sell prices & spread |
| `!ah <question>` | Ask the AI-powered AH ChatBot (Groq/Llama 3.3) |

### 💰 AH Flip Alerts (Auto)
- Polls AH every **60 seconds**
- Pings `@Premium` role when a BIN auction is 25%+ below market
- Posts exact `/viewauction <uuid>` to copy in-game
- Configure min profit & margin in `ahFlipWatcher.js`

### 🔔 Auction Sold DM Alerts (Auto)
- Checks every **2 minutes** for sold auctions of linked players
- DMs the player when an item sells, showing item name + sold price

### ⚔️ Carry System
| Command | Description |
|---|---|
| `/carry register` | Register carry types you offer (dropdown) |
| `/carry unregister` | Remove yourself from provider list |
| `/carry list [type]` | See all providers, optionally filtered |
| `/carry request <type>` | Ping all providers of that type |
| `/carry prices` | View suggested prices for all carry types |

**Supported carries:** F1–F7, M1–M7, all 6 slayers, Kuudra (Basic/Hot/Burning/Infernal)

### 🗺️ Party Finder
| Command | Description |
|---|---|
| `/partyfinder lfg` | Post a Looking For Group listing |
| `/partyfinder list` | See all active LFG listings |

- Join button notifies the poster via DM
- Auto-expires after 30 minutes

### 🎵 Music
| Command | Description |
|---|---|
| `/music play <query>` | Play a YouTube track or search |
| `/music skip` | Skip current track |
| `/music stop` | Stop music and clear queue |
| `/music queue` | Show current queue |
| `/music pause` / `resume` | Pause/resume |
| `/music loop` | Toggle loop mode |
| `/music volume <0-100>` | Adjust volume |

### 🔨 Moderation
`/mod ban` `/mod kick` `/mod timeout` `/mod warn` `/mod purge` `/mod lock` `/mod unlock`

All actions are logged to `LOG_CHANNEL_ID`.

### 🎫 Tickets
`/ticket setup` — sends a panel with a button to open tickets  
`/ticket close` — deletes the ticket channel  
`/ticket add/remove` — manage user access per ticket

### 👑 Role Management
`/role add` `/role remove` `/role info` `/role all`

### ⬇️ Social Media Downloader
`/download <url>` — supports YouTube, TikTok, Instagram, Twitter/X, Reddit, Facebook, + 1000 more  
Powered by **yt-dlp**. Works on Termux! Quality options: best/1080p/720p/480p/audio.

### 🖼️ Remove Background
`/removebg` — attach any image and get it back with the background removed  
Uses [remove.bg](https://remove.bg) free tier (50 credits/month).

### 🤖 AH ChatBot
Trigger with `!ah <your question>` in any channel, or set `AH_CHATBOT_CHANNEL_ID` for a dedicated channel.  
Powered by **Groq (free)** with Llama 3.3 70B + live AH price context.

---

## 🚀 Setup

### 1. Clone & Install
```bash
git clone <your-repo>
cd SkyBot
npm install
```

### 2. Configure `.env`
```bash
cp .env.example .env
# Edit .env with your keys
```

Required keys:
- `DISCORD_TOKEN` — [Discord Developer Portal](https://discord.com/developers)
- `CLIENT_ID` — your bot's application ID
- `HYPIXEL_API_KEY` — from `/api new` in-game on Hypixel
- `GROQ_API_KEY` — free at [console.groq.com](https://console.groq.com)

Optional:
- `REMOVE_BG_API_KEY` — free at [remove.bg/api](https://remove.bg/api)
- `PREMIUM_ROLE_ID` — Discord role ID for AH flip pings
- `AH_FLIP_CHANNEL_ID` — channel for flip alerts
- `AUCTION_SOLD_CHANNEL_ID` — fallback channel for sold alerts
- `CARRY_CHANNEL_ID` — channel where carry requests are posted
- `LOG_CHANNEL_ID` — mod action log channel

### 3. Register Slash Commands
```bash
# Guild-only (instant, for testing):
GUILD_ID=your_server_id node src/deploy-commands.js

# Global (takes ~1 hour):
node src/deploy-commands.js
```

### 4. Start the Bot
```bash
npm start

# Development (auto-restart):
npm run dev
```

### Termux Setup
```bash
pkg install nodejs yt-dlp ffmpeg
npm install
node src/deploy-commands.js
npm start
```

---

## 📁 Project Structure

```
SkyBot/
├── src/
│   ├── index.js                    # Entry point
│   ├── deploy-commands.js          # Command registration
│   ├── commands/
│   │   ├── Hypixel/
│   │   │   ├── link.js             # Account linking
│   │   │   ├── profile.js          # Profile viewer
│   │   │   ├── auction.js          # Active auctions
│   │   │   └── bazaar.js           # Bazaar prices
│   │   ├── Carries/
│   │   │   ├── carry.js            # Full carry system
│   │   │   └── partyfinder.js      # Party finder
│   │   ├── Music/
│   │   │   └── music.js            # Music player
│   │   └── Utility/
│   │       ├── mod.js              # Moderation
│   │       ├── ticket.js           # Ticket commands
│   │       ├── role.js             # Role management
│   │       ├── download.js         # Video downloader
│   │       ├── removebg.js         # BG removal
│   │       ├── premium.js          # Premium management
│   │       ├── admin.js            # Admin utilities
│   │       └── info.js             # Server/user info
│   ├── events/
│   │   ├── ready.js
│   │   ├── interactionCreate.js
│   │   └── buttonHandler.js        # Ticket button handling
│   ├── services/
│   │   ├── hypixel.js              # Hypixel API wrapper
│   │   ├── ahFlipWatcher.js        # Auto flip detection
│   │   ├── auctionSoldWatcher.js   # Sold auction alerts
│   │   └── ahChatBot.js            # AI chatbot
│   └── utils/
│       ├── db.js                   # JSON database (lowdb)
│       └── embeds.js               # Embed helpers
├── data/
│   └── db.json                     # Auto-created on first run
├── tmp/                            # Temp download files
├── .env.example
└── package.json
```

---

## 🔧 Customization

### Carry prices
Edit `CARRY_TYPES` in `src/commands/Carries/carry.js`

### Flip sensitivity
Edit `MIN_PROFIT` and `MIN_MARGIN` in `src/services/ahFlipWatcher.js`

### AH poll interval
Default is every 60 seconds. Edit the cron expression in `ahFlipWatcher.js`:
```js
cron.schedule('*/60 * * * * *', ...) // every 60 seconds
```

---

## 📝 Notes

- **Hypixel API rate limit:** ~120 req/min. The bot is conservative by default.
- **Music** requires `ffmpeg` installed (`pkg install ffmpeg` on Termux).
- **yt-dlp** auto-detected from common paths including Termux's `/data/data/com.termux/files/usr/bin/`.
- **db.json** is auto-created in the `data/` folder on first run — no setup needed.
- All linked player data, premium users, and carry providers persist across restarts.

---

*SkyBot — Built for Hypixel Skyblock communities 🎮*
