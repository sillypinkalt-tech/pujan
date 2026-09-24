const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

function buildPanelEmbed(panel) {
  const embed = new EmbedBuilder()
    .setTitle(panel.title || 'Support Tickets')
    .setDescription(panel.description || 'Click the button below to open a ticket.')
    .setColor(0x5865f2);
  if (panel.imageUrl) embed.setImage(panel.imageUrl);
  return embed;
}

function buildPanelRow(panel) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('create_ticket')
      .setLabel(panel.buttonLabel || 'Create Ticket')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🎫')
  );
  return row;
}

function buildTicketEmbed({ openerId, reason, claimedBy }) {
  const embed = new EmbedBuilder()
    .setTitle('🎫 New Ticket')
    .addFields(
      { name: 'Opened by', value: `<@${openerId}>`, inline: true },
      {
        name: 'Claimed by',
        value: claimedBy ? `<@${claimedBy}>` : 'Unclaimed',
        inline: true
      },
      { name: 'Reason', value: reason || 'No reason given' }
    )
    .setColor(claimedBy ? 0x57f287 : 0xfee75c)
    .setTimestamp();
  return embed;
}

function buildTicketRow({ claimedBy }) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('claim_ticket')
      .setLabel('Claim')
      .setStyle(ButtonStyle.Success)
      .setEmoji('🙋')
      .setDisabled(!!claimedBy),
    new ButtonBuilder()
      .setCustomId('close_ticket')
      .setLabel('Close')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🔒')
  );
  return row;
}

module.exports = { buildPanelEmbed, buildPanelRow, buildTicketEmbed, buildTicketRow };
