require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const makeMessageCreateHandler = require('./handlers/messageCreate');
const interactionCreateHandler = require('./handlers/interactionCreate');

const PREFIX = process.env.PREFIX || '$';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel]
});

// Load all $prefix commands from src/commands into a Collection.
const commands = new Collection();
const fs = require('fs');
const path = require('path');
const commandFiles = fs
  .readdirSync(path.join(__dirname, 'commands'))
  .filter((f) => f.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(__dirname, 'commands', file));
  commands.set(command.name, command);
}

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`Prefix commands loaded: ${[...commands.keys()].join(', ')}`);
});

client.on('messageCreate', makeMessageCreateHandler(client, commands, PREFIX));
client.on('interactionCreate', interactionCreateHandler);

client.login(process.env.BOT_TOKEN);
