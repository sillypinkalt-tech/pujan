// ============================================================================
//  bot.ts — the whole Discord ticket bot in ONE file.
//
//  Everything lives here on purpose: panel setup, ticket create/claim/close/
//  add/remove/transfer/unclaim, $say, $help, storage, permissions, and the
//  Discord client itself. Scroll to "COMMANDS" to add or edit a command —
//  each one is a self-contained object, so you can add a new command by
//  copy-pasting a block and pushing it into the COMMANDS array.
//
//  Deploy: this file is run directly with `tsx` (no separate build step),
//  so editing it and pushing to GitHub is all Railway needs to pick up the
//  change. See package.json / railway notes at the bottom of this file.
// ============================================================================

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import {
  Client,
  GatewayIntentBits,
  Partials,
  Collection,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionsBitField,
  ChannelType,
  Message,
  GuildMember,
  TextChannel,
  Guild,
  Interaction
} from 'discord.js';

const PREFIX = process.env.PREFIX || '$';

// ============================================================================
//  STORAGE — simple JSON-file backed store. No database needed.
// ============================================================================

interface PanelData {
  channelId: string | null;
  messageId: string | null;
  title: string;
  description: string;
  buttonLabel: string;
  imageUrl: string | null;
}

interface TicketData {
  openerId: string;
  reason: string;
  claimedBy: string | null;
  status: string;
}

interface GuildConfig {
  panel: PanelData | null;
  claimRoles: string[];
  ticketCategoryId: string | null;
  ticketCounter: number;
  tickets: Record<string, TicketData>;
}

interface StoreData {
  guilds: Record<string, GuildConfig>;
}

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');

function ensureFile(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ guilds: {} }, null, 2));
  }
}

function loadStore(): StoreData {
  ensureFile();
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error('data.json was corrupted, resetting it.', e);
    const fresh: StoreData = { guilds: {} };
    fs.writeFileSync(DATA_FILE, JSON.stringify(fresh, null, 2));
    return fresh;
  }
}

function saveStore(data: StoreData): void {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

let cache = loadStore();

function getGuildConfig(guildId: string): GuildConfig {
  if (!cache.guilds[guildId]) {
    cache.guilds[guildId] = {
      panel: null,
      claimRoles: [],
      ticketCategoryId: null,
      ticketCounter: 0,
      tickets: {}
    };
    saveStore(cache);
  }
  return cache.guilds[guildId];
}

function updateGuildConfig(guildId: string, updater: (g: GuildConfig) => void): GuildConfig {
  const g = getGuildConfig(guildId);
  updater(g);
  saveStore(cache);
  return g;
}

// ============================================================================
//  PERMISSIONS
// ============================================================================

function isAdmin(member: GuildMember): boolean {
  return member.permissions.has(PermissionsBitField.Flags.Administrator);
}

function isClaimStaff(member: GuildMember, config: GuildConfig): boolean {
  if (isAdmin(member)) return true;
  if (!config.claimRoles || config.claimRoles.length === 0) return false;
  return member.roles.cache.some((r) => config.claimRoles.includes(r.id));
}

// ============================================================================
//  EMBEDS / COMPONENTS
// ============================================================================

function buildPanelEmbed(panel: PanelData): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(panel.title || 'Support Tickets')
    .setDescription(panel.description || 'Click the button below to open a ticket.')
    .setColor(0x5865f2);
  if (panel.imageUrl) embed.setImage(panel.imageUrl);
  return embed;
}

function buildPanelRow(panel: PanelData): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('create_ticket')
      .setLabel(panel.buttonLabel || 'Create Ticket')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🎫')
  );
}

function buildTicketEmbed(ticket: TicketData): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('🎫 New Ticket')
    .addFields(
      { name: 'Opened by', value: `<@${ticket.openerId}>`, inline: true },
      { name: 'Claimed by', value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : 'Unclaimed', inline: true },
      { name: 'Reason', value: ticket.reason || 'No reason given' }
    )
    .setColor(ticket.claimedBy ? 0x57f287 : 0xfee75c)
    .setTimestamp();
}

function buildTicketRow(ticket: TicketData): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('claim_ticket')
      .setLabel('Claim')
      .setStyle(ButtonStyle.Success)
      .setEmoji('🙋')
      .setDisabled(!!ticket.claimedBy),
    new ButtonBuilder()
      .setCustomId('close_ticket')
      .setLabel('Close')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🔒')
  );
}

// ============================================================================
//  TICKET MANAGER
// ============================================================================

async function getOrCreateCategory(guild: Guild) {
  const config = getGuildConfig(guild.id);
  if (config.ticketCategoryId) {
    const existing = guild.channels.cache.get(config.ticketCategoryId);
    if (existing) return existing;
  }
  const category = await guild.channels.create({
    name: 'Tickets',
    type: ChannelType.GuildCategory
  });
  updateGuildConfig(guild.id, (g) => {
    g.ticketCategoryId = category.id;
  });
  return category;
}

async function createTicket(guild: Guild, opener: GuildMember, reason: string): Promise<TextChannel> {
  const config = getGuildConfig(guild.id);
  const category = await getOrCreateCategory(guild);
  const ticketNumber = config.ticketCounter + 1;

  const permissionOverwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    {
      id: opener.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory
      ]
    }
  ];

  for (const roleId of config.claimRoles) {
    permissionOverwrites.push({
      id: roleId,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory
      ]
    });
  }

  const channel = (await guild.channels.create({
    name: `ticket-${ticketNumber}`,
    type: ChannelType.GuildText,
    parent: category.id,
    permissionOverwrites
  })) as TextChannel;

  updateGuildConfig(guild.id, (g) => {
    g.ticketCounter = ticketNumber;
    g.tickets[channel.id] = { openerId: opener.id, reason, claimedBy: null, status: 'open' };
  });

  const ticketData = getGuildConfig(guild.id).tickets[channel.id];
  await channel.send({
    content: `<@${opener.id}>`,
    embeds: [buildTicketEmbed(ticketData)],
    components: [buildTicketRow(ticketData)]
  });

  return channel;
}

async function claimTicket(channel: TextChannel, claimer: GuildMember) {
  const guild = channel.guild;
  const config = getGuildConfig(guild.id);
  const ticket = config.tickets[channel.id];
  if (!ticket) return { ok: false as const, reason: 'not_a_ticket' };
  if (ticket.claimedBy) return { ok: false as const, reason: 'already_claimed' };

  updateGuildConfig(guild.id, (g) => {
    g.tickets[channel.id].claimedBy = claimer.id;
  });

  await channel.permissionOverwrites.edit(claimer.id, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true
  });

  const updated = getGuildConfig(guild.id).tickets[channel.id];
  return { ok: true as const, embed: buildTicketEmbed(updated), row: buildTicketRow(updated) };
}

async function unclaimTicket(channel: TextChannel) {
  const guild = channel.guild;
  const config = getGuildConfig(guild.id);
  const ticket = config.tickets[channel.id];
  if (!ticket) return { ok: false as const, reason: 'not_a_ticket' };
  if (!ticket.claimedBy) return { ok: false as const, reason: 'not_claimed' };

  updateGuildConfig(guild.id, (g) => {
    g.tickets[channel.id].claimedBy = null;
  });

  const updated = getGuildConfig(guild.id).tickets[channel.id];
  return { ok: true as const, embed: buildTicketEmbed(updated), row: buildTicketRow(updated) };
}

async function transferTicket(channel: TextChannel, newClaimer: GuildMember) {
  const guild = channel.guild;
  const config = getGuildConfig(guild.id);
  const ticket = config.tickets[channel.id];
  if (!ticket) return { ok: false as const, reason: 'not_a_ticket' };

  updateGuildConfig(guild.id, (g) => {
    g.tickets[channel.id].claimedBy = newClaimer.id;
  });

  await channel.permissionOverwrites.edit(newClaimer.id, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true
  });

  const updated = getGuildConfig(guild.id).tickets[channel.id];
  return { ok: true as const, embed: buildTicketEmbed(updated), row: buildTicketRow(updated) };
}

function isTicketChannel(channel: TextChannel): boolean {
  const config = getGuildConfig(channel.guild.id);
  return !!config.tickets[channel.id];
}

function getTicket(channel: TextChannel): TicketData | null {
  const config = getGuildConfig(channel.guild.id);
  return config.tickets[channel.id] || null;
}

// ============================================================================
//  COMMANDS — add a new prefix command by pushing another object like these
//  into the COMMANDS array below. `name` is what comes after the prefix
//  (e.g. name: 'ping' -> $ping).
// ============================================================================

interface Command {
  name: string;
  description: string;
  usage: string;
  adminOnly: boolean;
  execute: (message: Message, args: string[]) => Promise<any>;
}

const helpCommand: Command = {
  name: 'help',
  description: 'Show this list of commands.',
  usage: '$help',
  adminOnly: false,
  async execute(message) {
    const adminLines: string[] = [];
    const ticketLines: string[] = [];

    for (const cmd of COMMANDS) {
      const line = `**${PREFIX}${cmd.name}** \`${cmd.usage}\`\n${cmd.description}`;
      (cmd.adminOnly ? adminLines : ticketLines).push(line);
    }

    const embed = new EmbedBuilder()
      .setTitle('📖 Bot Commands')
      .setColor(0x5865f2)
      .setFooter({ text: `Prefix: ${PREFIX}` });

    if (adminLines.length) embed.addFields({ name: '🔑 Admin Only', value: adminLines.join('\n\n') });
    if (ticketLines.length) embed.addFields({ name: '🎫 Ticket Channel Commands', value: ticketLines.join('\n\n') });

    await message.channel.send({ embeds: [embed] });
  }
};

const ticketSetupCommand: Command = {
  name: 'ticketsetup',
  description: 'Interactive wizard to build and post the ticket panel (title, message, button text, image, claim roles).',
  usage: '$ticketsetup',
  adminOnly: true,
  async execute(message) {
    const member = message.member as GuildMember;
    if (!isAdmin(member)) {
      await message.reply('🚫 Only server administrators can run `$ticketsetup`.');
      return;
    }

    const channel = message.channel as TextChannel;
    const userId = message.author.id;
    const STEP_TIMEOUT = 60_000;

    async function ask(questionText: string): Promise<Message | 'CANCELLED' | null> {
      await channel.send(questionText);
      const collected = await channel
        .awaitMessages({ filter: (m) => m.author.id === userId, max: 1, time: STEP_TIMEOUT, errors: ['time'] })
        .catch(() => null);
      if (!collected || collected.size === 0) return null;
      const msg = collected.first()!;
      if (msg.content.trim().toLowerCase() === 'cancel') return 'CANCELLED';
      return msg;
    }

    await channel.send(
      '🛠️ **Ticket panel setup started.** Answer each question below.\n' +
        'Type `cancel` at any point to stop. Each question times out after 60 seconds.'
    );

    const titleMsg = await ask('**Step 1/5** — What should the panel **title** say?');
    if (!titleMsg) return void channel.send('⏱️ Timed out. Run `$ticketsetup` again.');
    if (titleMsg === 'CANCELLED') return void channel.send('❌ Setup cancelled.');
    const title = titleMsg.content.trim();

    const descMsg = await ask('**Step 2/5** — What **message** should appear in the panel (the description users see)?');
    if (!descMsg) return void channel.send('⏱️ Timed out. Run `$ticketsetup` again.');
    if (descMsg === 'CANCELLED') return void channel.send('❌ Setup cancelled.');
    const description = descMsg.content.trim();

    const btnMsg = await ask('**Step 3/5** — What text should the **ticket-creating button** say? (e.g. "Open a Ticket")');
    if (!btnMsg) return void channel.send('⏱️ Timed out. Run `$ticketsetup` again.');
    if (btnMsg === 'CANCELLED') return void channel.send('❌ Setup cancelled.');
    const buttonLabel = btnMsg.content.trim().slice(0, 80);

    const imgMsg = await ask('**Step 4/5** — Send an **image** (attach a file or paste an image URL) for the panel, or type `skip`.');
    if (!imgMsg) return void channel.send('⏱️ Timed out. Run `$ticketsetup` again.');
    if (imgMsg === 'CANCELLED') return void channel.send('❌ Setup cancelled.');

    let imageUrl: string | null = null;
    if (imgMsg.attachments.size > 0) {
      imageUrl = imgMsg.attachments.first()!.url;
    } else if (imgMsg.content.trim().toLowerCase() !== 'skip') {
      const candidate = imgMsg.content.trim();
      if (/^https?:\/\/.+\.(png|jpe?g|gif|webp)(\?.*)?$/i.test(candidate)) {
        imageUrl = candidate;
      } else {
        await channel.send("⚠️ That didn't look like a valid image URL, so no image will be used.");
      }
    }

    const roleMsg = await ask('**Step 5/5** — Mention (or type the IDs of) the **role(s)** allowed to claim tickets, separated by spaces.');
    if (!roleMsg) return void channel.send('⏱️ Timed out. Run `$ticketsetup` again.');
    if (roleMsg === 'CANCELLED') return void channel.send('❌ Setup cancelled.');

    const mentionedRoles = [...roleMsg.mentions.roles.values()].map((r) => r.id);
    const idMatches = roleMsg.content.match(/\d{15,25}/g) || [];
    const claimRoles = [...new Set([...mentionedRoles, ...idMatches])].filter((id) =>
      message.guild!.roles.cache.has(id)
    );

    if (claimRoles.length === 0) {
      return void channel.send('❌ No valid roles were recognized. Setup cancelled — run `$ticketsetup` again.');
    }

    const panel: PanelData = { channelId: null, messageId: null, title, description, buttonLabel, imageUrl };
    const panelMessage = await channel.send({ embeds: [buildPanelEmbed(panel)], components: [buildPanelRow(panel)] });
    panel.channelId = channel.id;
    panel.messageId = panelMessage.id;

    updateGuildConfig(message.guild!.id, (g) => {
      g.panel = panel;
      g.claimRoles = claimRoles;
    });

    const confirm = new EmbedBuilder()
      .setColor(0x57f287)
      .setDescription(`✅ **Ticket panel created!**\nClaim roles: ${claimRoles.map((id) => `<@&${id}>`).join(', ')}`);
    await channel.send({ embeds: [confirm] });
  }
};

const sayCommand: Command = {
  name: 'say',
  description: 'Compose and send a message (pings, markdown, emojis, optional embed) via a popup.',
  usage: '$say',
  adminOnly: true,
  async execute(message) {
    const member = message.member as GuildMember;
    if (!isAdmin(member)) {
      await message.reply('🚫 Only server administrators can use `$say`.');
      return;
    }

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`open_say_modal_${message.author.id}`)
        .setLabel('✏️ Compose Message')
        .setStyle(ButtonStyle.Primary)
    );

    const prompt = await message.channel.send({
      content: `${message.author}, click below to compose the message.`,
      components: [row]
    });

    message.delete().catch(() => {});
    setTimeout(() => {
      prompt.delete().catch(() => {});
    }, 120_000);
  }
};

const addCommand: Command = {
  name: 'add',
  description: 'Add a user to the current ticket channel.',
  usage: '$add @user',
  adminOnly: false,
  async execute(message) {
    const channel = message.channel as TextChannel;
    if (!isTicketChannel(channel)) {
      await message.reply('🚫 This command only works inside a ticket channel.');
      return;
    }
    const config = getGuildConfig(message.guild!.id);
    if (!isClaimStaff(message.member as GuildMember, config)) {
      await message.reply('🚫 Only staff with a claim role (or admins) can use `$add`.');
      return;
    }

    const target = message.mentions.members?.first();
    if (!target) {
      await message.reply('Usage: `$add @user`');
      return;
    }

    await channel.permissionOverwrites.edit(target.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true
    });

    await message.reply(`✅ Added ${target} to this ticket.`);
  }
};

const removeCommand: Command = {
  name: 'remove',
  description: 'Remove a user from the current ticket channel.',
  usage: '$remove @user',
  adminOnly: false,
  async execute(message) {
    const channel = message.channel as TextChannel;
    if (!isTicketChannel(channel)) {
      await message.reply('🚫 This command only works inside a ticket channel.');
      return;
    }
    const config = getGuildConfig(message.guild!.id);
    if (!isClaimStaff(message.member as GuildMember, config)) {
      await message.reply('🚫 Only staff with a claim role (or admins) can use `$remove`.');
      return;
    }

    const target = message.mentions.members?.first();
    if (!target) {
      await message.reply('Usage: `$remove @user`');
      return;
    }

    const ticket = getTicket(channel);
    if (target.id === ticket?.openerId) {
      await message.reply("🚫 You can't remove the person who opened the ticket. Use `$close` instead.");
      return;
    }

    await channel.permissionOverwrites.delete(target.id);
    await message.reply(`✅ Removed ${target} from this ticket.`);
  }
};

const closeCommand: Command = {
  name: 'close',
  description: 'Close (delete) the current ticket channel.',
  usage: '$close',
  adminOnly: false,
  async execute(message) {
    const channel = message.channel as TextChannel;
    if (!isTicketChannel(channel)) {
      await message.reply('🚫 This command only works inside a ticket channel.');
      return;
    }

    const ticket = getTicket(channel);
    const config = getGuildConfig(message.guild!.id);
    const canClose = isClaimStaff(message.member as GuildMember, config) || message.author.id === ticket?.openerId;

    if (!canClose) {
      await message.reply('🚫 Only staff, the claimer, or the ticket opener can close this ticket.');
      return;
    }

    await channel.send('🔒 Closing this ticket in 5 seconds...');
    const channelId = channel.id;
    const guildId = message.guild!.id;

    setTimeout(async () => {
      try {
        await channel.delete();
      } catch (e) {
        console.error('Failed to delete ticket channel:', e);
      }
      updateGuildConfig(guildId, (g) => {
        delete g.tickets[channelId];
      });
    }, 5000);
  }
};

const unclaimCommand: Command = {
  name: 'unclaim',
  description: 'Unclaim the current ticket. Only the current claimer or an admin can do this.',
  usage: '$unclaim',
  adminOnly: false,
  async execute(message) {
    const channel = message.channel as TextChannel;
    if (!isTicketChannel(channel)) {
      await message.reply('🚫 This command only works inside a ticket channel.');
      return;
    }

    const ticket = getTicket(channel);
    if (!ticket?.claimedBy) {
      await message.reply('This ticket is not currently claimed.');
      return;
    }

    const isCurrentClaimer = ticket.claimedBy === message.author.id;
    if (!isCurrentClaimer && !isAdmin(message.member as GuildMember)) {
      await message.reply('🚫 Only the person who claimed this ticket (or an admin) can `$unclaim` it.');
      return;
    }

    const result = await unclaimTicket(channel);
    if (!result.ok) {
      await message.reply('Something went wrong unclaiming this ticket.');
      return;
    }

    await channel.send({ content: `🔓 Ticket unclaimed by ${message.author}.`, embeds: [result.embed], components: [result.row] });
  }
};

const transferCommand: Command = {
  name: 'transfer',
  description: 'Transfer the current ticket to another claim-role member. Only the current claimer can do this.',
  usage: '$transfer @user',
  adminOnly: false,
  async execute(message) {
    const channel = message.channel as TextChannel;
    if (!isTicketChannel(channel)) {
      await message.reply('🚫 This command only works inside a ticket channel.');
      return;
    }

    const ticket = getTicket(channel);
    if (!ticket?.claimedBy) {
      await message.reply('🚫 This ticket has not been claimed yet, so there is nothing to transfer.');
      return;
    }
    if (ticket.claimedBy !== message.author.id) {
      await message.reply('🚫 Only the current claimer can `$transfer` this ticket.');
      return;
    }

    const target = message.mentions.members?.first();
    if (!target) {
      await message.reply('Usage: `$transfer @user`');
      return;
    }

    const config = getGuildConfig(message.guild!.id);
    if (!isClaimStaff(target, config)) {
      await message.reply('🚫 You can only transfer to someone with a claim role.');
      return;
    }

    const result = await transferTicket(channel, target);
    if (!result.ok) {
      await message.reply('Something went wrong transferring this ticket.');
      return;
    }

    await channel.send({
      content: `🔁 Ticket transferred from ${message.author} to ${target}.`,
      embeds: [result.embed],
      components: [result.row]
    });
  }
};

// 👉 Add new commands to this array — order here controls order in $help.
const COMMANDS: Command[] = [
  helpCommand,
  ticketSetupCommand,
  sayCommand,
  addCommand,
  removeCommand,
  closeCommand,
  unclaimCommand,
  transferCommand
];

// ============================================================================
//  DISCORD CLIENT + EVENT HANDLERS
// ============================================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel]
});

const commands = new Collection<string, Command>();
for (const cmd of COMMANDS) commands.set(cmd.name, cmd);

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user?.tag}`);
  console.log(`Prefix commands loaded: ${[...commands.keys()].join(', ')}`);
});

client.on('messageCreate', async (message: Message) => {
  if (message.author.bot) return;
  if (!message.guild) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const commandName = args.shift()!.toLowerCase();

  const command = commands.get(commandName);
  if (!command) return;

  try {
    await command.execute(message, args);
  } catch (err) {
    console.error(`Error running command "${commandName}":`, err);
    message.reply('⚠️ Something went wrong running that command.').catch(() => {});
  }
});

client.on('interactionCreate', async (interaction: Interaction) => {
  try {
    // --- Button: "Create Ticket" on the panel ---
    if (interaction.isButton() && interaction.customId === 'create_ticket') {
      const modal = new ModalBuilder().setCustomId('ticket_reason_modal').setTitle('Open a Ticket');
      const reasonInput = new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Why do you want to create a ticket?')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Describe your issue or request...')
        .setRequired(true)
        .setMaxLength(1000);
      modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput));
      await interaction.showModal(modal);
      return;
    }

    // --- Modal submit: creates the actual ticket channel ---
    if (interaction.isModalSubmit() && interaction.customId === 'ticket_reason_modal') {
      await interaction.deferReply({ ephemeral: true });
      const reason = interaction.fields.getTextInputValue('reason');
      const channel = await createTicket(interaction.guild!, interaction.member as GuildMember, reason);
      await interaction.editReply(`✅ Your ticket has been created: ${channel}`);
      return;
    }

    // --- Button: "Claim" inside a ticket channel ---
    if (interaction.isButton() && interaction.customId === 'claim_ticket') {
      const channel = interaction.channel as TextChannel;
      if (!isTicketChannel(channel)) {
        await interaction.reply({ content: '🚫 This is not a ticket channel.', ephemeral: true });
        return;
      }
      const config = getGuildConfig(interaction.guild!.id);
      const member = interaction.member as GuildMember;
      if (!isClaimStaff(member, config)) {
        await interaction.reply({ content: '🚫 You do not have a claim role, so you cannot claim this ticket.', ephemeral: true });
        return;
      }
      const ticket = getTicket(channel);
      if (ticket?.claimedBy) {
        await interaction.reply({ content: '🚫 This ticket is already claimed.', ephemeral: true });
        return;
      }
      const result = await claimTicket(channel, member);
      if (!result.ok) {
        await interaction.reply({ content: '🚫 Could not claim this ticket.', ephemeral: true });
        return;
      }
      await interaction.update({ embeds: [result.embed], components: [result.row] });
      return;
    }

    // --- Button: "Close" inside a ticket channel ---
    if (interaction.isButton() && interaction.customId === 'close_ticket') {
      const channel = interaction.channel as TextChannel;
      if (!isTicketChannel(channel)) {
        await interaction.reply({ content: '🚫 This is not a ticket channel.', ephemeral: true });
        return;
      }
      const ticket = getTicket(channel);
      const config = getGuildConfig(interaction.guild!.id);
      const canClose = isClaimStaff(interaction.member as GuildMember, config) || interaction.user.id === ticket?.openerId;
      if (!canClose) {
        await interaction.reply({ content: '🚫 Only staff, the claimer, or the ticket opener can close this ticket.', ephemeral: true });
        return;
      }
      await interaction.reply('🔒 Closing this ticket in 5 seconds...');
      const channelId = channel.id;
      const guildId = interaction.guild!.id;
      setTimeout(async () => {
        try {
          await channel.delete();
        } catch (e) {
          console.error('Failed to delete ticket channel:', e);
        }
        updateGuildConfig(guildId, (g) => {
          delete g.tickets[channelId];
        });
      }, 5000);
      return;
    }

    // --- Button: "Compose Message" prompt from $say ---
    if (interaction.isButton() && interaction.customId.startsWith('open_say_modal_')) {
      const ownerId = interaction.customId.replace('open_say_modal_', '');
      if (interaction.user.id !== ownerId) {
        await interaction.reply({ content: '🚫 Only the admin who ran `$say` can use this button.', ephemeral: true });
        return;
      }

      const modal = new ModalBuilder().setCustomId('say_modal').setTitle('Compose Message');
      const messageInput = new TextInputBuilder()
        .setCustomId('message')
        .setLabel('Message')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('**bold**, # headers, emojis 🎉, <@id> / <@&id> / @everyone pings all work')
        .setRequired(true)
        .setMaxLength(4000);
      const embedToggleInput = new TextInputBuilder()
        .setCustomId('embed_toggle')
        .setLabel('Send as an embed? (yes/no, default no)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(3);
      const colorInput = new TextInputBuilder()
        .setCustomId('embed_color')
        .setLabel('Embed color hex (optional, e.g. #5865F2)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(7);

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(messageInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(embedToggleInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(colorInput)
      );
      await interaction.showModal(modal);
      return;
    }

    // --- Modal submit: actually sends the $say message ---
    if (interaction.isModalSubmit() && interaction.customId === 'say_modal') {
      const text = interaction.fields.getTextInputValue('message');
      const embedToggle = (interaction.fields.getTextInputValue('embed_toggle') || '').trim().toLowerCase();
      const colorRaw = (interaction.fields.getTextInputValue('embed_color') || '').trim();

      const wantsEmbed = embedToggle.startsWith('y');
      let color = 0x5865f2;
      const colorMatch = colorRaw.match(/^#?([0-9a-fA-F]{6})$/);
      if (colorMatch) color = parseInt(colorMatch[1], 16);

      const channel = interaction.channel as TextChannel;
      if (wantsEmbed) {
        const embed = new EmbedBuilder().setDescription(text).setColor(color);
        await channel.send({ embeds: [embed] });
      } else {
        await channel.send({ content: text, allowedMentions: { parse: ['everyone', 'users', 'roles'] } });
      }

      await interaction.reply({ content: '✅ Message sent.', ephemeral: true });
      if (interaction.message) interaction.message.delete().catch(() => {});
      return;
    }
  } catch (err) {
    console.error('Interaction handler error:', err);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      interaction.reply({ content: '⚠️ Something went wrong. Please try again.', ephemeral: true }).catch(() => {});
    }
  }
});

client.login(process.env.BOT_TOKEN);

// ============================================================================
//  RAILWAY / GITHUB NOTES
//  - package.json "start" script: "tsx bot.ts"  (tsx runs TS directly, no
//    build step — push this file, Railway installs deps and runs it).
//  - Env vars to set in Railway: BOT_TOKEN, and optionally PREFIX.
//  - To add a command: copy one of the `const xCommand: Command = {...}`
//    blocks above, rename it, and add it to the COMMANDS array.
// ============================================================================
