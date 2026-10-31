# Radar bot: setup

The bot (`bot/worker.js`, Cloudflare Worker `radar-bot`) is deployed in dry mode: every minute it checks for tags,
but it has no X keys yet, so it does nothing. With keys it logs the replies it *would* post until `BOT_LIVE` is `"1"`.

## 1. The account: @radardotfunn

- The bot replies as @radardotfunn, which already has Premium (its replies rank higher) and links tryradar.fun in
  its profile, so "link in bio" works.
- Replies under @radardotfunn's own posts also arrive as mentions (X adds the @ by itself). The bot ignores those and
  plain conversation, and answers only a tag someone typed with little else or with an ask like "coins?" or "scan"
  (`bot/trigger.js`).
- No "Automated" label: that would mark the whole main account as a bot. X allows replying to people who tag you.

## 2. The X developer app (developer.x.com, signed in as @radardotfunn)

1. Open the Developer Console and create an app.
2. **Billing:** save a card and buy credit. X gives $20 free after the first purchase and matches the first
   auto-recharge up to $50. Set a **spending limit** per billing cycle (for example $30).
3. **User authentication settings:** App permissions **Read and write**. Type of app: "Web App, Automated App or
   Bot". Callback URL and website: `https://tryradar.fun`.
4. **Keys and tokens:** generate the API Key and Secret, then the Access Token and Secret.
   Generate the Access Token *after* setting Read and write, or it can only read.

## 3. The keys (you paste them; nobody else sees them)

In a terminal in `bot/`, one at a time, pasting each value when asked:

```
npx wrangler secret put X_API_KEY
npx wrangler secret put X_API_SECRET
npx wrangler secret put X_ACCESS_TOKEN
npx wrangler secret put X_ACCESS_SECRET
```

## 4. Dry run, then live

1. `POST /poll` once (with the bot token) records where the bot starts, so tags from before are never answered.
2. Tag the bot under a few posts. `GET /log` shows the reply it would have posted for each.
3. When the replies look right, set `BOT_LIVE = "1"` in `bot/wrangler.toml` and `npx wrangler deploy`.

The page token is in `.tmp/bot-token.txt` (not in git). Pages: `/health`, `/log`, `/preview?url=<post>`, `POST /poll`.

## Costs and limits

From docs.x.com pricing (29 Oct 2026): $0.005 per post read, $0.01 per reply to a tag, $0.20 for a post with a
link, so replies have no link. About 1.5 to 2 cents a tag. There are no reply caps in the bot (your call): **the
spending limit you set in X's developer console is what bounds the cost**, so set one. A post tagged many times is
scanned once per 10 minutes, and picks under $1K market cap with under $1K daily volume are left out.

Cloudflare's free plan allows 1,000 KV writes a day; the bot writes about twice per minute that has tags, so a bot
tagged in almost every minute of the day would need the Workers Paid plan ($5/month). If a write fails, that round
posts nothing rather than risk replying twice.

## Discord and Telegram

The bot also answers in Discord and Telegram (bot/chat.js), and the narrative wire posts to a Discord channel (bot/wire.js). Each stays off until its secrets are set, from the bot/ folder:

    npx wrangler secret put DISCORD_APP_ID
    npx wrangler secret put DISCORD_PUBLIC_KEY
    npx wrangler secret put DISCORD_BOT_TOKEN
    npx wrangler secret put TELEGRAM_BOT_TOKEN
    npx wrangler secret put TELEGRAM_SECRET

Then POST /chat-setup with the x-bot-token header. It registers the Discord commands and the Telegram webhook, and returns the invite link and the Interactions Endpoint URL.

- **Discord:** turn on Message Content Intent for /watch. In a channel, /watch turns automatic scans on or off, and /wire makes it the narrative wire.
- **Telegram:** in BotFather, /setprivacy to Disable, or the bot only sees commands in groups.
- **Wire check:** GET /wire-preview shows what the wire would post right now.
