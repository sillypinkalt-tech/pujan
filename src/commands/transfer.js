const { isTicketChannel, getTicket, transferTicket } = require('../ticketManager');
const { getGuild } = require('../storage');
const { isClaimStaff } = require('../utils/permissions');

module.exports = {
  name: 'transfer',
  async execute(message) {
    if (!isTicketChannel(message.channel)) {
      return message.reply('🚫 This command only works inside a ticket channel.');
    }

    const ticket = getTicket(message.channel);
    if (!ticket.claimedBy) {
      return message.reply('🚫 This ticket has not been claimed yet, so there is nothing to transfer.');
    }
    if (ticket.claimedBy !== message.author.id) {
      return message.reply('🚫 Only the current claimer can `$transfer` this ticket.');
    }

    const target = message.mentions.members.first();
    if (!target) {
      return message.reply('Usage: `$transfer @user`');
    }

    const config = getGuild(message.guild.id);
    if (!isClaimStaff(target, config)) {
      return message.reply('🚫 You can only transfer to someone with a claim role.');
    }

    const result = await transferTicket(message.channel, target);
    if (!result.ok) {
      return message.reply('Something went wrong transferring this ticket.');
    }

    return message.channel.send({
      content: `🔁 Ticket transferred from ${message.author} to ${target}.`,
      embeds: [result.embed],
      components: [result.row]
    });
  }
};
