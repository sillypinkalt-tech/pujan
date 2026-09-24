const { EmbedBuilder } = require('discord.js');
const { isAdmin } = require('../utils/permissions');
const { buildPanelEmbed, buildPanelRow } = require('../utils/embeds');
const { updateGuild } = require('../storage');

const STEP_TIMEOUT = 60_000; // 60 seconds per question

// Asks a question in the channel and waits for the same user to reply.
// Returns the Message object, or null if they took too long / typed "cancel".
async function ask(channel, userId, questionText) {
  await channel.send(questionText);
  const collected = await channel
    .awaitMessages({
      filter: (m) => m.author.id === userId,
      max: 1,
      time: STEP_TIMEOUT,
      errors: ['time']
    })
    .catch(() => null);

  if (!collected || collected.size === 0) return null;
  const msg = collected.first();
  if (msg.content.trim().toLowerCase() === 'cancel') return 'CANCELLED';
  return msg;
}

module.exports = {
  name: 'ticketsetup',
  async execute(message) {
    if (!isAdmin(message.member)) {
      return message.reply('🚫 Only server administrators can run `$ticketsetup`.');
    }

    const channel = message.channel;
    const userId = message.author.id;

    await channel.send(
      '🛠️ **Ticket panel setup started.** Answer each question below.\n' +
        'Type `cancel` at any point to stop. Each question times out after 60 seconds.'
    );

    // 1. Title
    const titleMsg = await ask(channel, userId, '**Step 1/5** — What should the panel **title** say?');
    if (!titleMsg) return channel.send('⏱️ Timed out. Run `$ticketsetup` again.');
    if (titleMsg === 'CANCELLED') return channel.send('❌ Setup cancelled.');
    const title = titleMsg.content.trim();

    // 2. Description / message
    const descMsg = await ask(
      channel,
      userId,
      '**Step 2/5** — What **message** should appear in the panel (the description users see)?'
    );
    if (!descMsg) return channel.send('⏱️ Timed out. Run `$ticketsetup` again.');
    if (descMsg === 'CANCELLED') return channel.send('❌ Setup cancelled.');
    const description = descMsg.content.trim();

    // 3. Button label
    const btnMsg = await ask(
      channel,
      userId,
      '**Step 3/5** — What text should the **ticket-creating button** say? (e.g. "Open a Ticket")'
    );
    if (!btnMsg) return channel.send('⏱️ Timed out. Run `$ticketsetup` again.');
    if (btnMsg === 'CANCELLED') return channel.send('❌ Setup cancelled.');
    const buttonLabel = btnMsg.content.trim().slice(0, 80);

    // 4. Image (optional)
    const imgMsg = await ask(
      channel,
      userId,
      '**Step 4/5** — Send an **image** (attach a file or paste an image URL) for the panel, or type `skip`.'
    );
    if (!imgMsg) return channel.send('⏱️ Timed out. Run `$ticketsetup` again.');
    if (imgMsg === 'CANCELLED') return channel.send('❌ Setup cancelled.');

    let imageUrl = null;
    if (imgMsg.attachments.size > 0) {
      imageUrl = imgMsg.attachments.first().url;
    } else if (imgMsg.content.trim().toLowerCase() !== 'skip') {
      const candidate = imgMsg.content.trim();
      if (/^https?:\/\/.+\.(png|jpe?g|gif|webp)(\?.*)?$/i.test(candidate)) {
        imageUrl = candidate;
      } else {
        await channel.send("⚠️ That didn't look like a valid image URL, so no image will be used.");
      }
    }

    // 5. Claim roles
    const roleMsg = await ask(
      channel,
      userId,
      '**Step 5/5** — Mention (or type the IDs of) the **role(s)** allowed to claim tickets, separated by spaces.'
    );
    if (!roleMsg) return channel.send('⏱️ Timed out. Run `$ticketsetup` again.');
    if (roleMsg === 'CANCELLED') return channel.send('❌ Setup cancelled.');

    const mentionedRoles = [...roleMsg.mentions.roles.values()].map((r) => r.id);
    const idMatches = roleMsg.content.match(/\d{15,25}/g) || [];
    const claimRoles = [...new Set([...mentionedRoles, ...idMatches])].filter((id) =>
      message.guild.roles.cache.has(id)
    );

    if (claimRoles.length === 0) {
      return channel.send('❌ No valid roles were recognized. Setup cancelled — run `$ticketsetup` again.');
    }

    const panel = { channelId: null, messageId: null, title, description, buttonLabel, imageUrl };

    // Post the panel
    const embed = buildPanelEmbed(panel);
    const row = buildPanelRow(panel);
    const panelMessage = await channel.send({ embeds: [embed], components: [row] });

    panel.channelId = channel.id;
    panel.messageId = panelMessage.id;

    updateGuild(message.guild.id, (g) => {
      g.panel = panel;
      g.claimRoles = claimRoles;
    });

    const confirm = new EmbedBuilder()
      .setColor(0x57f287)
      .setDescription(
        `✅ **Ticket panel created!**\nClaim roles: ${claimRoles.map((id) => `<@&${id}>`).join(', ')}`
      );
    await channel.send({ embeds: [confirm] });
  }
};
