# Radar

Radar is a browser extension for X. Tap the radar under any post to see the coins trading on that post's story: the biggest one, the first one launched, and the one moving now. Each coin comes with live stats, a holder check and a bundle check.

- Site and downloads: **https://tryradar.fun**
- Edge store: https://microsoftedge.microsoft.com/addons/detail/lchjfepnoaglhmnbbjffhbmfbchnojml
- X: [@radardotfunn](https://x.com/radardotfunn)

No extension? Paste any post link at **https://tryradar.fun/scan** for the same results in the browser.

This repo is the full source of the extension, the website (including the Quick Buy page and Radar on the web) and the server it talks to. It's public so anyone can check what Radar does before installing it.

Not financial advice. Memecoins are extremely risky.

## What Radar never does

- **It never asks for your seed phrase or private key.** Nothing in this code reads or stores either one. Anyone who asks you for them in Radar's name is a scammer.
- **The extension never connects to a wallet and never signs anything.** Its Insta Buy button only opens `tryradar.fun/trade?mint=<contract>&sol=<amount>&insta=1` in a small window; the wallet connects to that page, not to X or the extension.
- **It never holds your SOL.** Quick Buy builds the transaction, and your own wallet signs it.
- **It takes no fee.** PumpPortal, which builds the buy, charges 0.5%. A 0.0001 SOL priority fee goes to the Solana network so the buy lands.
- **No accounts, ads or tracking.** A post only leaves your browser when you tap the radar on it. See [web/privacy.html](web/privacy.html), live at https://tryradar.fun/privacy.
- **No contract addresses by DM.** The official $RADAR contract is posted only on tryradar.fun and @radardotfunn.

## How Quick Buy works

All of it is in [web/trade.js](web/trade.js) and [web/quickbuy-guard.js](web/quickbuy-guard.js).

**Insta Buy** (on every card for a coin Quick Buy can buy) opens this page as a small window over X with the card's amount. If your wallet already trusts tryradar.fun it connects by itself and the buy starts; your wallet still has to approve it. When Solana confirms it, the page tells the card (the coin and the transaction signature, nothing else) and closes itself. The full page, for any amount and slippage, is in the card's menu.

**Which coins:** PumpPortal builds buys on pump.fun, PumpSwap and Raydium. Coins that only trade on Orca or Meteora (such as $WIF and $BONK) get no Insta Buy, and the buy page says why and links the terminals instead (`quickBuyable` in the guard; `test/quickbuy.mjs --live` fails if PumpPortal starts covering Orca).

1. **The coin is looked up from its contract** on DexScreener. A link's own name or ticker is never trusted, so a spoofed link can't show you a fake name.
2. **PumpPortal builds an unsigned buy** for your wallet's public address, the amount and the slippage you picked (`trade-local` API).
3. **Radar checks the transaction before your wallet ever sees it.** It refuses the buy unless:
   - your wallet is the fee payer;
   - it needs exactly one signature, yours;
   - every program it calls is on a short allowlist (Solana system programs, pump.fun, PumpSwap, Raydium and PumpPortal's router);
   - a simulation succeeds;
   - the simulation spends no more than your amount plus 2% and 0.02 SOL for fees and rent.
4. **Your wallet shows the transaction.** It signs only if you approve. The signed transaction is checked again.
5. **The signed buy goes to Solana through Radar's relay** ([server/worker.js](server/worker.js), `/rpc`). The relay only passes a fixed list of read methods plus `simulateTransaction`, `sendTransaction` and `getSignatureStatuses`. It can't sign or change anything: the transaction is already signed by your wallet.

`node test/quickbuy.mjs` runs the guard against fake transactions: a foreign fee payer, extra signers, an unknown program and overspending. `--live` also has PumpPortal build real buys for a throwaway, unfunded wallet and checks that they pass. Nothing is signed or sent.

### Coins paired to another token

PumpPortal can't build buys of coins paired to a token instead of SOL, such as $RADAR, paired to $LARPCHECK. For those, the page builds one `multi_hop_swap` from SOL through the paired token to the coin, with pump.fun's own SDK (`webapp/pump-route.js`). It has no PumpPortal fee, and it goes through the same checks: your wallet pays, only known programs, and a simulation of what it spends.

### Auto-Confirm (optional, Phantom only)

Normally your wallet asks before every buy. Phantom's own Auto-Confirm setting removes that popup, and you can turn it on from the buy page after a warning and a tick. With it on, nothing stands between a page and a signature, so Radar adds its own rules (`web/quickbuy-guard.js`):

- **A link can't start a buy.** A buy only starts by itself when Radar's panel opened the window and vouches for that exact coin and amount, once, within 30 seconds. Anything else waits for a tap.
- **Up to 1 SOL.** Anything larger waits for a tap too.
- **The page refuses to open inside another site**, so a tap can't be tricked.
- **All the usual checks still run**, and the transaction must name the coin on the page.

**The risk that remains:** while Auto-Confirm is on, a hacked tryradar.fun could sign transactions with no popup. Use a wallet holding only what you could lose, and turn it off when you're done.

## Instant Reroute

One tap opens the biggest coin on the post that passes the holder check, or tells you why none did. A contract address written in the post gets the same check. The rules are in [extension/src/ui/holdercheck.js](extension/src/ui/holdercheck.js). A coin passes only if:

- it is trading;
- it has no rug, mint or freeze flags and no RugCheck danger flag;
- its RugCheck score is 30 or lower;
- it has 150+ holders;
- no single wallet holds more than 15%;
- the top 10 hold less than 50%;
- insiders hold less than 25%.

## Launching a coin from a post

`tryradar.fun/launch` lets anyone launch a coin on pump.fun from a post on X, with their own wallet. The source is `webapp/launch.js`, `webapp/launch-guard.js` and `server/launch.js`.

- **Your wallet is the coin's creator and pays for it.** Radar charges nothing. The page makes the new coin's key, uses it for its one signature, and drops it. Radar never sees your wallet's key.
- **Pump's own SDK builds the transaction, with no third party in it.** Before your wallet is asked, the page checks that your wallet pays, that only your wallet and the new coin sign, and that it calls only known programs. A simulation must show it spending no more than 0.05 SOL. A launch costs about 0.006 SOL.
- **Every coin says what it is.** Its description says it was launched with Radar, that Radar did not issue it, and that the poster may have nothing to do with it. Its website is `tryradar.fun/launched`, and its card in Radar is labelled.
- **`tryradar.fun/launched` lists a coin only after its transaction is read back from Solana.**
- **Limits:** one launch per post per wallet on this page, and a warning when a ticker is already used. A coin can't be removed from Solana once it's live, and these checks can't stop someone calling pump.fun directly. Radar doesn't check or endorse these coins.
- **`LAUNCH_STATE`** on the server can hide the panel button or switch launching off, with no store update.

## What Radar uses from Larpcheck

Radar reads verdicts, holder data and lists from [Larpcheck's API](https://larpcheck.app/developers) through its server (`server/lc.js`), which holds the key. It names Larpcheck, links every verdict to its check, and never rewords one.

- **Coin cards:** Larpcheck's verdict, and its holder reading on chains Radar's own holder check doesn't cover.
- **Buy pages:** the verdict, above the buy button. It never blocks or changes a buy.
- **The bot:** the verdict and its link, in replies that carry links.
- **The panel:** Larpcheck's most asked, most real and most larp coins of the day.
- **$RADAR holders:** Larpcheck's record of an account's posts, and an alert when a coin in their feed turns bad. Starting a check and asking about one need a Larpcheck API plan, and stay off without one.

## The Radar bot on X

Tag **@radardotfunn** under any post on X and it replies with that post's coins: the highest market cap, the OG and the mover, each with its number and its contract (a DexScreener link until 5 November 2026, while X refuses crypto addresses from a new app; the address itself after that). It runs on Cloudflare ([bot/worker.js](bot/worker.js)) with the same scan as the extension and the web version, and it checks for tags every minute.

- It answers only a tag someone typed, not replies under @radardotfunn's own posts or conversation ([bot/trigger.js](bot/trigger.js)).
- It never replies to itself, and a tag can never get two replies: the bot saves its place before replying.
- Tickers are cleaned so a coin's name can't make the bot mention people or post links ([bot/reply.js](bot/reply.js)).
- Its X keys are Cloudflare secrets, not in this repo. `node test/bot.mjs` checks its signing against X's published example and its reply format.

## Permissions

| Permission | Why |
|---|---|
| `x.com`, `twitter.com` (content script) | Adds the radar button under posts. A post is sent to Radar's server only when you tap it. Contract addresses shown in posts are looked up on DexScreener (the address only) |
| `api.dexscreener.com`, `cdn.dexscreener.com`, `dd.dexscreener.com` | Prices, pools, market cap, coin images |
| `api.rugcheck.xyz` | Holder and rug checks |
| `api.mainnet-beta.solana.com` | Launch-block and bundle data, read straight from the chain |
| `narrative-radar.millenia-portfolio.workers.dev` | Radar's server: reads the post's story and relays Solana requests |
| `cdn.syndication.twimg.com`, `video.twimg.com` | Reads quoted posts and video in the post you scan |
| `storage` | Settings and a cache, on your device only |
| `declarativeNetRequestWithHostAccess` | One rule: removes the Origin header from the extension's own requests to the public Solana RPC, which refuses requests that carry one ([background.js](extension/src/background.js)) |
| `solana.frontrun.pro` (optional, off by default) | Only asked for if you connect your own Frontrun key in the toolbar popup |

## Check that the download matches this code

The zip on tryradar.fun is the `extension/` folder of this repo, zipped as is, with no build step and no minifying ([scripts/build-web.mjs](scripts/build-web.mjs)). To check it, run this in a clone of this repo:

```bash
curl -LO https://tryradar.fun/radar-extension.zip
mkdir radar-zip && cd radar-zip && unzip ../radar-extension.zip
diff -r --strip-trailing-cr . ../extension
```

No output means the files are identical. The zip is built on Windows, so its text files end lines with CRLF; `--strip-trailing-cr` ignores that difference. The Edge store build is the same folder. The iPhone and Tampermonkey script, `web/radar.user.js`, and Radar on the web, `web/scan.js`, are built from the same files by `scripts/build-userscript.mjs` and `scripts/build-webapp.mjs`, unminified.

## Layout

```
extension/   the extension (Manifest V3): post button, panel, background, chain checks
server/      Cloudflare Worker: reads a post's story, larp check, Solana RPC relay
web/         tryradar.fun: home, privacy, Quick Buy page, Radar on the web (scan)
webapp/      Radar on the web: the extension's panel and checks running in a page, bundled into web/scan.js
userscript/  wrapper that runs the extension as a userscript (iPhone Safari, Tampermonkey)
bot/         the Radar bot on X: replies to tags with the post's coins (Cloudflare Worker)
scripts/     builds the site, the zip, the .crx, the Firefox build, the userscript and web/scan.js
test/        offline tests and live checks against real posts and coins
```

## How a scan works

1. **Read:** the server (`server/`) has an AI model read the post the way a trader would: text, author, replies, the quoted post, the link preview, images and video. It returns the story and the names coins for it launch under.
2. **Search:** those names are looked up on DexScreener, from your own browser.
3. **Pick:** matches are ranked against the story, and the top coin, the OG and the mover are picked.
4. **Check:** holders and rug flags come from RugCheck, and bundles are read straight from the coin's launch block on Solana (`extension/src/lib/solana.js`).

## Run it yourself

```bash
npm install
node scripts/build-web.mjs   # site, extension zip, Firefox build, userscript
node test/reroute.mjs        # offline tests
node test/quickbuy.mjs
node test/frontrun.mjs
```

To load the extension straight from source, open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and pick `extension/`.

The server is a Cloudflare Worker (`npx wrangler deploy`). Its API keys are Worker secrets and are not in this repo.

## Reporting a problem

Found a bug or a security issue? Open an issue here or DM [@radardotfunn](https://x.com/radardotfunn). Please report anything that touches wallets or Quick Buy privately by DM first.
