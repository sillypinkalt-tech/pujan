module.exports = function makeMessageCreateHandler(client, commands, prefix) {
  return async function messageCreate(message) {
    if (message.author.bot) return;
    if (!message.guild) return;
    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/\s+/);
    const commandName = args.shift().toLowerCase();

    const command = commands.get(commandName);
    if (!command) return;

    try {
      await command.execute(message, args);
    } catch (err) {
      console.error(`Error running command "${commandName}":`, err);
      message.reply('⚠️ Something went wrong running that command.').catch(() => {});
    }
  };
};
