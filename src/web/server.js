import express from 'express';
import session from 'express-session';
import passport from 'passport';
import { Strategy as DiscordStrategy } from 'passport-discord';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb, saveDb } from '../utils/db.js';
import { CARRY_TYPES } from '../commands/Carries/carry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function startWebDashboard(client) {
  if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) {
    console.warn('[Web] Missing DISCORD_CLIENT_ID or DISCORD_CLIENT_SECRET. Dashboard disabled.');
    return;
  }

  const app = express();
  const PORT = process.env.PORT || 3000;
  const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

  // Session setup
  app.use(session({
    secret: process.env.SESSION_SECRET || 'super-secret-skybot-key',
    resave: false,
    saveUninitialized: false,
  }));

  // Passport setup
  passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: `${BASE_URL}/api/auth/callback`,
    scope: ['identify', 'guilds']
  }, (accessToken, refreshToken, profile, done) => {
    return done(null, profile);
  }));

  passport.serializeUser((user, done) => done(null, user));
  passport.deserializeUser((obj, done) => done(null, obj));

  app.use(passport.initialize());
  app.use(passport.session());
  
  // Middleware to parse form data
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());

  // View engine
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  // Auth routes
  app.get('/api/auth/login', passport.authenticate('discord'));
  app.get('/api/auth/callback', passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => {
    res.redirect('/dashboard');
  });
  app.get('/api/auth/logout', (req, res) => {
    req.logout(() => {
      res.redirect('/');
    });
  });

  // Middleware to check if user is logged in and is admin
  const checkAuth = async (req, res, next) => {
    if (!req.isAuthenticated()) return res.redirect('/api/auth/login');
    // Check if user is in premiumUsers or is the bot owner (using basic check for now)
    const db = getDb();
    const isPremium = db.data.premiumUsers?.includes(req.user.id);
    
    // Check if they share a server where they have admin
    let isAdmin = isPremium;
    if (!isAdmin) {
      for (const guild of client.guilds.cache.values()) {
        try {
          const member = await guild.members.fetch(req.user.id);
          if (member.permissions.has('Administrator')) {
            isAdmin = true;
            break;
          }
        } catch (e) {}
      }
    }

    if (!isAdmin) return res.send('You must be an Administrator in a server with SkyBot to access the dashboard.');
    next();
  };

  // Dashboard routes
  app.get('/', (req, res) => {
    res.render('index', { user: req.user });
  });

  app.get('/dashboard', checkAuth, (req, res) => {
    const db = getDb();
    res.render('dashboard', { 
      user: req.user, 
      client: client,
      db: db.data,
      carryTypes: CARRY_TYPES
    });
  });

  app.post('/dashboard/settings', checkAuth, async (req, res) => {
    const db = getDb();
    const { guildId, ttsChannel, logChannel, ahChannel } = req.body;
    
    if (guildId) {
      if (!db.data.guildConfig) db.data.guildConfig = {};
      if (!db.data.guildConfig[guildId]) db.data.guildConfig[guildId] = {};
      
      if (ttsChannel) db.data.ttsChannels[guildId] = ttsChannel;
      if (logChannel) db.data.loggingConfig[guildId] = logChannel;
      
      // Update process env for ah watcher (simplified approach)
      if (ahChannel) process.env.AH_FLIP_CHANNEL_ID = ahChannel;

      await saveDb();
    }
    
    res.redirect('/dashboard');
  });

  app.listen(PORT, () => {
    console.log(`[Web] Dashboard running on ${BASE_URL}`);
  });
}
