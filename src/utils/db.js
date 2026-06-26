/**
 * db.js — lightweight JSON database via lowdb
 */
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir   = path.join(__dirname, '../../data');
const dbPath    = path.join(dataDir, 'db.json');

// Ensure data dir exists (important for Railway volume)
mkdirSync(dataDir, { recursive: true });

const defaultData = {
  // Core
  linkedPlayers:   {},
  premiumUsers:    [],
  carryProviders:  {},
  ahSubscriptions: {},
  ticketCount:     0,
  musicSettings:   {},
  // Economy
  economy:         {},
  // Leveling
  leveling:        {},
  // Giveaways
  giveaways:       {},
  // Welcome / Goodbye
  welcomeConfig:   {},
  goodbyeConfig:   {},
  autoRole:        {},
  // Birthdays
  birthdays:       {},
  birthdayChannel: {},
  // Logging
  loggingConfig:   {},
  // Reaction roles
  reactionRoles:   {},
  // Warnings & notes
  warnings:        {},
  userNotes:       {},
  // Verification
  verifyConfig:    {},
  // Stats channels
  statsChannels:   {},
  // TTS
  ttsChannels:     {},
  ttsVoiceChannel: {},
  guildConfig:     {},
};

let db;

export async function initDb() {
  const adapter = new JSONFile(dbPath);
  db = new Low(adapter, defaultData);
  await db.read();
  // Merge: keep saved data, fill in any missing keys from defaults
  db.data = { ...defaultData, ...db.data };
  await db.write();
}

export function getDb() {
  return db;
}

export async function saveDb() {
  await db.write();
}
