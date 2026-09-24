const { isClaimStaff } = require('../utils/permissions');
const { isTicketChannel, getTicket } = require('../ticketManager');
const { getGuild } = require('../storage');

module.exports = {
  name: 'remove',
  async execute(message, args) {
    if (!isTicketChannel(message.channel)) {
      return message.reply('🚫 This command only works inside a ticket channel.');
    }
    const config = getGuild(message.guild.id);
    if (!isClaimStaff(message.member, config)) {
      return message.reply('🚫 Only staff with a claim role (or admins) can use `$remove`.');
    }

    const target = message.mentions.members.first();
    if (!target) {
      return message.reply('Usage: `$remove @user`');
    }

    const ticket = getTicket(message.channel);
    if (target.id === ticket.openerId) {
      return message.reply("🚫 You can't remove the person who opened the ticket. Use `$close` instead.");
    }

    await message.channel.permissionOverwrites.delete(target.id);
    return message.reply(`✅ Removed ${target} from this ticket.`);
  }
};
