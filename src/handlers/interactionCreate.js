const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder
} = require('discord.js');
const { createTicket, claimTicket, getTicket, isTicketChannel } = require('../ticketManager');
const { getGuild } = require('../storage');
const { isClaimStaff } = require('../utils/permissions');

module.exports = async function interactionCreate(interaction) {
  try {
    // --- Button: "Create Ticket" on the panel ---
    if (interaction.isButton() && interaction.customId === 'create_ticket') {
      const modal = new ModalBuilder()
        .setCustomId('ticket_reason_modal')
        .setTitle('Open a Ticket');

      const reasonInput = new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Why do you want to create a ticket?')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Describe your issue or request...')
        .setRequired(true)
        .setMaxLength(1000);

      modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
      return interaction.showModal(modal);
    }

    // --- Modal submit: creates the actual ticket channel ---
    if (interaction.isModalSubmit() && interaction.customId === 'ticket_reason_modal') {
      await interaction.deferReply({ ephemeral: true });
      const reason = interaction.fields.getTextInputValue('reason');
      const channel = await createTicket(interaction.guild, interaction.member, reason);
      return interaction.editReply(`✅ Your ticket has been created: ${channel}`);
    }

    // --- Button: "Claim" inside a ticket channel ---
    if (interaction.isButton() && interaction.customId === 'claim_ticket') {
      if (!isTicketChannel(interaction.channel)) {
        return interaction.reply({ content: '🚫 This is not a ticket channel.', ephemeral: true });
      }

      const config = getGuild(interaction.guild.id);
      if (!isClaimStaff(interaction.member, config)) {
        return interaction.reply({
          content: '🚫 You do not have a claim role, so you cannot claim this ticket.',
          ephemeral: true
        });
      }

      const ticket = getTicket(interaction.channel);
      if (ticket.claimedBy) {
        return interaction.reply({ content: '🚫 This ticket is already claimed.', ephemeral: true });
      }

      const result = await claimTicket(interaction.channel, interaction.member);
      if (!result.ok) {
        return interaction.reply({ content: '🚫 Could not claim this ticket.', ephemeral: true });
      }

      return interaction.update({ embeds: [result.embed], components: [result.row] });
    }

    // --- Button: "Close" inside a ticket channel ---
    if (interaction.isButton() && interaction.customId === 'close_ticket') {
      if (!isTicketChannel(interaction.channel)) {
        return interaction.reply({ content: '🚫 This is not a ticket channel.', ephemeral: true });
      }

      const ticket = getTicket(interaction.channel);
      const config = getGuild(interaction.guild.id);
      const canClose =
        isClaimStaff(interaction.member, config) || interaction.user.id === ticket.openerId;

      if (!canClose) {
        return interaction.reply({
          content: '🚫 Only staff, the claimer, or the ticket opener can close this ticket.',
          ephemeral: true
        });
      }

      await interaction.reply('🔒 Closing this ticket in 5 seconds...');
      const { updateGuild } = require('../storage');
      const channelId = interaction.channel.id;
      const guildId = interaction.guild.id;
      setTimeout(async () => {
        try {
          await interaction.channel.delete();
        } catch (e) {
          console.error('Failed to delete ticket channel:', e);
        }
        updateGuild(guildId, (g) => {
          delete g.tickets[channelId];
        });
      }, 5000);
    }
    // --- Button: "Compose Message" prompt from $say ---
    if (interaction.isButton() && interaction.customId.startsWith('open_say_modal_')) {
      const ownerId = interaction.customId.replace('open_say_modal_', '');
      if (interaction.user.id !== ownerId) {
        return interaction.reply({
          content: '🚫 Only the admin who ran `$say` can use this button.',
          ephemeral: true
        });
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
        new ActionRowBuilder().addComponents(messageInput),
        new ActionRowBuilder().addComponents(embedToggleInput),
        new ActionRowBuilder().addComponents(colorInput)
      );

      return interaction.showModal(modal);
    }

    // --- Modal submit: actually sends the $say message ---
    if (interaction.isModalSubmit() && interaction.customId === 'say_modal') {
      const text = interaction.fields.getTextInputValue('message');
      const embedToggle = (interaction.fields.getTextInputValue('embed_toggle') || '')
        .trim()
        .toLowerCase();
      const colorRaw = (interaction.fields.getTextInputValue('embed_color') || '').trim();

      const wantsEmbed = embedToggle.startsWith('y');
      let color = 0x5865f2; // Discord blurple default
      const colorMatch = colorRaw.match(/^#?([0-9a-fA-F]{6})$/);
      if (colorMatch) color = parseInt(colorMatch[1], 16);

      if (wantsEmbed) {
        const embed = new EmbedBuilder().setDescription(text).setColor(color);
        await interaction.channel.send({ embeds: [embed] });
      } else {
        await interaction.channel.send({
          content: text,
          allowedMentions: { parse: ['everyone', 'users', 'roles'] }
        });
      }

      await interaction.reply({ content: '✅ Message sent.', ephemeral: true });

      // Clean up the "Compose Message" button prompt.
      if (interaction.message) {
        interaction.message.delete().catch(() => {});
      }
    }
  } catch (err) {
    console.error('Interaction handler error:', err);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      interaction
        .reply({ content: '⚠️ Something went wrong. Please try again.', ephemeral: true })
        .catch(() => {});
    }
  }
};
