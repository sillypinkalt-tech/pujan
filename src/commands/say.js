const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { isAdmin } = require('../utils/permissions');

module.exports = {
  name: 'say',
  async execute(message) {
    if (!isAdmin(message.member)) {
      return message.reply('🚫 Only server administrators can use `$say`.');
    }

    // Discord only allows a modal to be opened in response to a button (or
    // slash command) interaction, not directly from a typed message. So we
    // post a button here; clicking it (restricted to this same admin) opens
    // the actual "drop box" where you type your message.
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`open_say_modal_${message.author.id}`)
        .setLabel('✏️ Compose Message')
        .setStyle(ButtonStyle.Primary)
    );

    const prompt = await message.channel.send({
      content: `${message.author}, click below to compose the message.`,
      components: [row]
    });

    // Tidy up the original $say command message if we can.
    message.delete().catch(() => {});

    // Auto-remove the prompt after 2 minutes if nobody clicks it.
    setTimeout(() => {
      prompt.delete().catch(() => {});
    }, 120_000);
  }
};
