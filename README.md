# Discord Ticket Bot

A fully customizable ticket bot: admins build the ticket panel through an interactive
setup wizard (custom message, button text, optional image, and claim roles), users
open tickets through a button + a "why do you want a ticket" popup, and staff manage
tickets with `$add`, `$remove`, `$unclaim`, and `$transfer`.

## Setup

1. **Create a bot application**
   - Go to https://discord.com/developers/applications → New Application
   - Go to the **Bot** tab → click **Reset Token** → copy the token
   - Under **Privileged Gateway Intents**, enable **Server Members Intent** and
     **Message Content Intent** (both are required)

2. **Invite the bot to your server**
   - Go to **OAuth2 → URL Generator**
   - Scopes: `bot`
   - Bot permissions: `Manage Channels`, `Manage Roles`, `View Channels`, `Send Messages`,
     `Embed Links`, `Attach Files`, `Read Message History`, `Manage Messages`
   - Open the generated URL and add the bot to your server

3. **Install and configure**
   ```bash
   npm install
   cp .env.example .env
   ```
   Open `.env` and paste your bot token into `BOT_TOKEN=`. Change `PREFIX=` if you
   want a different prefix than `$`.

4. **Run the bot**
   ```bash
   npm start
   ```

## Commands

### Admin only
- **`$ticketsetup`** — Interactive wizard (only real server Administrators can run it).
  It asks you, step by step, in the channel:
  1. Panel title
  2. Panel message/description
  3. Button label
  4. An optional image (attach a file, paste a URL, or type `skip`)
  5. Which role(s) are allowed to claim tickets (mention them or paste role IDs)

  It then posts the finished ticket panel with a button in that channel.
  Type `cancel` at any step to stop, or just wait — each step times out after 60s.

### Anyone (via the panel button)
- Clicking the ticket button opens a popup asking **"Why do you want to create a
  ticket?"**. Submitting it creates a private ticket channel (visible only to the
  opener, the claim roles, and admins) under a `Tickets` category.

### Inside a ticket channel
- **Claim button** — only members with a configured claim role (or admins) can claim.
- **Close button** / **`$close`** — closable by staff, the claimer, or the ticket opener.
- **`$add @user`** — staff/claim-role members add someone to the ticket.
- **`$remove @user`** — staff/claim-role members remove someone (not the opener).
- **`$unclaim`** — only the **current claimer** (or an admin) can unclaim.
- **`$transfer @user`** — only the **current claimer** can hand the ticket to another
  claim-role member.

### Admin only
- **`$say`** — posts a "Compose Message" button (only you can click it). Clicking it
  opens a popup where you type the message. Supports:
  - Real pings: type `@everyone`, `@here`, `<@USER_ID>`, or `<@&ROLE_ID>` in the box
    (Discord's modal text boxes don't autocomplete `@name`, so use the raw mention
    format or IDs — right-click a user/role → Copy ID, with Developer Mode on)
  - Markdown: `#` headers, `**bold**`, `*italic*`, etc.
  - Emojis: regular 🎉 emoji and custom `<:name:id>` emoji
  - An optional embed: fill in "Send as an embed?" with `yes` and optionally a hex
    color. Note: **mentions inside an embed don't trigger a notification ping** —
    that's a Discord limitation, not a bug — so use plain (non-embed) mode if the
    ping actually needs to notify someone.

## Deploying on Railway (via GitHub)

1. Push this folder to a GitHub repo. `.env` and `data/data.json` are already in
   `.gitignore`, so your token and ticket data won't get committed — good.
2. In Railway: **New Project → Deploy from GitHub repo** → pick your repo.
3. Railway auto-detects Node from `package.json` and runs `npm start`. No extra
   config needed.
4. Go to your Railway service's **Variables** tab and add:
   - `BOT_TOKEN` = your bot token
   - `PREFIX` = `$` (optional, defaults to `$` if omitted)
5. Deploy. Check the **Deploy Logs** for `✅ Logged in as ...` to confirm it's live.

**Important — persistent storage:** Railway's filesystem resets on every redeploy
(new commit, restart, etc.), which would wipe `data/data.json` and forget your panel
setup and open tickets. To keep that data across deploys, add a **Railway Volume**
(Service → **Settings → Volumes** → mount it at `/app/data`) so `data/data.json`
survives redeploys. Without a volume, you'll need to re-run `$ticketsetup` after
each deploy.

## Notes

- All configuration and open tickets are stored in `data/data.json`, which is created
  automatically on first run. Back this file up if you care about ticket history.
- Nothing here uses slash commands — everything matches the `$prefix` style you asked
  for (`$ticketsetup`, `$add`, `$remove`, `$unclaim`, `$transfer`, `$say`).
