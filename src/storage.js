// Simple JSON-file backed storage. No database needed for this bot.
// Everything lives in data/data.json and is loaded once into memory,
// then re-saved to disk every time something changes.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ guilds: {} }, null, 2));
  }
}

function load() {
  ensureFile();
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error('data.json was corrupted, resetting it.', e);
    const fresh = { guilds: {} };
    fs.writeFileSync(DATA_FILE, JSON.stringify(fresh, null, 2));
    return fresh;
  }
}

function save(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

let cache = load();

function getGuild(guildId) {
  if (!cache.guilds[guildId]) {
    cache.guilds[guildId] = {
      panel: null,          // { channelId, messageId, title, description, buttonLabel, imageUrl }
      claimRoles: [],        // role IDs allowed to claim tickets
      ticketCategoryId: null,
      ticketCounter: 0,
      tickets: {}            // channelId -> { openerId, reason, claimedBy, status }
    };
    save(cache);
  }
  return cache.guilds[guildId];
}

function updateGuild(guildId, updater) {
  const g = getGuild(guildId);
  updater(g);
  save(cache);
  return g;
}

module.exports = { getGuild, updateGuild };
