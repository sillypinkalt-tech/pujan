const { isClaimStaff } = require('../utils/permissions');
const { isTicketChannel, getTicket } = require('../ticketManager');
const { getGuild, updateGuild } = require('../storage');

module.exports = {
  name: 'close',
  async execute(message) {
    if (!isTicketChannel(message.channel)) {
      return message.reply('🚫 This command only works inside a ticket channel.');
    }

    const ticket = getTicket(message.channel);
    const config = getGuild(message.guild.id);
    const canClose =
      isClaimStaff(message.member, config) || message.author.id === ticket.openerId;

    if (!canClose) {
      return message.reply('🚫 Only staff, the claimer, or the ticket opener can close this ticket.');
    }

    await message.channel.send('🔒 Closing this ticket in 5 seconds...');
    const channelId = message.channel.id;
    const guildId = message.guild.id;

    setTimeout(async () => {
      try {
        await message.channel.delete();
      } catch (e) {
        console.error('Failed to delete ticket channel:', e);
      }
      updateGuild(guildId, (g) => {
        delete g.tickets[channelId];
      });
    }, 5000);
  }
};
