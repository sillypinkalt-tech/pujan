const { PermissionsBitField } = require('discord.js');
const { isClaimStaff } = require('../utils/permissions');
const { isTicketChannel } = require('../ticketManager');
const { getGuild } = require('../storage');

module.exports = {
  name: 'add',
  async execute(message, args) {
    if (!isTicketChannel(message.channel)) {
      return message.reply('🚫 This command only works inside a ticket channel.');
    }
    const config = getGuild(message.guild.id);
    if (!isClaimStaff(message.member, config)) {
      return message.reply('🚫 Only staff with a claim role (or admins) can use `$add`.');
    }

    const target = message.mentions.members.first();
    if (!target) {
      return message.reply('Usage: `$add @user`');
    }

    await message.channel.permissionOverwrites.edit(target.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true
    });

    return message.reply(`✅ Added ${target} to this ticket.`);
  }
};
