const { ChannelType, PermissionsBitField } = require('discord.js');
const { getGuild, updateGuild } = require('./storage');
const { buildTicketEmbed, buildTicketRow } = require('./utils/embeds');

async function getOrCreateCategory(guild) {
  const config = getGuild(guild.id);
  if (config.ticketCategoryId) {
    const existing = guild.channels.cache.get(config.ticketCategoryId);
    if (existing) return existing;
  }
  const category = await guild.channels.create({
    name: 'Tickets',
    type: ChannelType.GuildCategory
  });
  updateGuild(guild.id, (g) => {
    g.ticketCategoryId = category.id;
  });
  return category;
}

async function createTicket(guild, opener, reason) {
  const config = getGuild(guild.id);
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

  const channel = await guild.channels.create({
    name: `ticket-${ticketNumber}`,
    type: ChannelType.GuildText,
    parent: category.id,
    permissionOverwrites
  });

  updateGuild(guild.id, (g) => {
    g.ticketCounter = ticketNumber;
    g.tickets[channel.id] = {
      openerId: opener.id,
      reason,
      claimedBy: null,
      status: 'open'
    };
  });

  const ticketData = getGuild(guild.id).tickets[channel.id];
  const embed = buildTicketEmbed(ticketData);
  const row = buildTicketRow(ticketData);
  await channel.send({ content: `<@${opener.id}>`, embeds: [embed], components: [row] });

  return channel;
}

async function claimTicket(channel, claimer) {
  const guild = channel.guild;
  const config = getGuild(guild.id);
  const ticket = config.tickets[channel.id];
  if (!ticket) return { ok: false, reason: 'not_a_ticket' };
  if (ticket.claimedBy) return { ok: false, reason: 'already_claimed' };

  updateGuild(guild.id, (g) => {
    g.tickets[channel.id].claimedBy = claimer.id;
  });

  // Lock the channel down to opener + claimer + admins once claimed.
  await channel.permissionOverwrites.edit(claimer.id, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true
  });

  const updated = getGuild(guild.id).tickets[channel.id];
  const embed = buildTicketEmbed(updated);
  const row = buildTicketRow(updated);
  return { ok: true, embed, row };
}

async function unclaimTicket(channel) {
  const guild = channel.guild;
  const config = getGuild(guild.id);
  const ticket = config.tickets[channel.id];
  if (!ticket) return { ok: false, reason: 'not_a_ticket' };
  if (!ticket.claimedBy) return { ok: false, reason: 'not_claimed' };

  updateGuild(guild.id, (g) => {
    g.tickets[channel.id].claimedBy = null;
  });

  const updated = getGuild(guild.id).tickets[channel.id];
  const embed = buildTicketEmbed(updated);
  const row = buildTicketRow(updated);
  return { ok: true, embed, row };
}

async function transferTicket(channel, newClaimer) {
  const guild = channel.guild;
  const config = getGuild(guild.id);
  const ticket = config.tickets[channel.id];
  if (!ticket) return { ok: false, reason: 'not_a_ticket' };

  const previousClaimer = ticket.claimedBy;

  updateGuild(guild.id, (g) => {
    g.tickets[channel.id].claimedBy = newClaimer.id;
  });

  await channel.permissionOverwrites.edit(newClaimer.id, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true
  });

  if (previousClaimer) {
    // Leave their view access as-is; only the "claimedBy" field changes ownership.
  }

  const updated = getGuild(guild.id).tickets[channel.id];
  const embed = buildTicketEmbed(updated);
  const row = buildTicketRow(updated);
  return { ok: true, embed, row };
}

function isTicketChannel(channel) {
  const config = getGuild(channel.guild.id);
  return !!config.tickets[channel.id];
}

function getTicket(channel) {
  const config = getGuild(channel.guild.id);
  return config.tickets[channel.id] || null;
}

module.exports = {
  createTicket,
  claimTicket,
  unclaimTicket,
  transferTicket,
  isTicketChannel,
  getTicket
};
