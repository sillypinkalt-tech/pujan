const { isAdmin } = require('../utils/permissions');
const { isTicketChannel, getTicket, unclaimTicket } = require('../ticketManager');

module.exports = {
  name: 'unclaim',
  async execute(message) {
    if (!isTicketChannel(message.channel)) {
      return message.reply('🚫 This command only works inside a ticket channel.');
    }

    const ticket = getTicket(message.channel);
    if (!ticket.claimedBy) {
      return message.reply('This ticket is not currently claimed.');
    }

    const isCurrentClaimer = ticket.claimedBy === message.author.id;
    if (!isCurrentClaimer && !isAdmin(message.member)) {
      return message.reply('🚫 Only the person who claimed this ticket (or an admin) can `$unclaim` it.');
    }

    const result = await unclaimTicket(message.channel);
    if (!result.ok) {
      return message.reply('Something went wrong unclaiming this ticket.');
    }

    return message.channel.send({
      content: `🔓 Ticket unclaimed by ${message.author}.`,
      embeds: [result.embed],
      components: [result.row]
    });
  }
};
