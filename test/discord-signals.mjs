// Radar signals for Discord (bot/discord-signals.js, wired in bot/chat.js): Breaking now's flags that pass every check,
// posted one at a time with the checks listed. Real SQLite stands in for D1; Jupiter and Discord are faked.
// node test/discord-signals.mjs
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { checkCoin, signalMessage, candidates, pick, after, sentToday, webhookOf, lookup, DELAY_MS, WINDOW_MS, MAX_PER_DAY, GATE } from '../bot/discord-signals.js';
import { recordFlag } from '../bot/track.js';
import { createChat, COMMANDS } from '../bot/chat.js';

const sql = new DatabaseSync(':memory:');
sql.exec('CREATE TABLE bot_kv (k TEXT PRIMARY KEY, v TEXT)');
const db = {
  prepare(q) {
    let args = [];
    const api = {
      bind(...a) { args = a; return api; },
      async first() { return sql.prepare(q).get(...args) ?? null; },
      async run() { const r = sql.prepare(q).run(...args); return { meta: { changes: r.changes } }; },
      async all() { return { results: sql.prepare(q).all(...args) }; },
    };
    return api;
  },
};
const now = Date.parse('2026-11-07T15:00:00Z');
const M = (i) => `Sig${String(i).replace(/0/g, 'z')}${'x'.repeat(44)}`.slice(0, 44);

// A coin as Jupiter's assets search gives it, passing every check.
const good = (over = {}, audit = {}) => ({
  id: M(1), symbol: 'GOOD', name: 'Good Coin', mcap: 48_000, liquidity: 14_000, holderCount: 420, organicScoreLabel: 'medium',
  audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true, topHoldersPercentage: 18, botHoldersPercentage: 4, sniperPct: 2, devBalancePercentage: 0, devMints: 2, devMigrations: 1, ...audit },
  stats1h: { buyVolume: 30_000, sellVolume: 21_000 }, ...over,
});

// ---- the checks: all must pass
assert.deepEqual(checkCoin(good()).failed, []);
assert.equal(checkCoin(good()).pass, true);
const fails = (over, audit) => checkCoin(good(over, audit)).failed;
assert.deepEqual(fails({ mcap: GATE.mcap - 1 }), ['market']);
assert.deepEqual(fails({ mcap: NaN }), ['market'], 'no cap read: fails, never "$NaN"');
assert.deepEqual(fails({ liquidity: 1000 }), ['market']);
assert.deepEqual(fails({}, { freezeAuthorityDisabled: false }), ['authority']);
assert.deepEqual(fails({}, { mintAuthorityDisabled: undefined }), ['authority'], 'unknown authority fails');
assert.deepEqual(fails({ holderCount: 40 }), ['holders']);
assert.deepEqual(fails({}, { topHoldersPercentage: 45 }), ['top']);
assert.deepEqual(fails({}, { topHoldersPercentage: undefined }), ['top'], 'unknown top holders fails');
assert.deepEqual(fails({}, { botHoldersPercentage: 35 }), ['bots']);
assert.deepEqual(fails({}, { sniperPct: 30 }), ['snipers']);
assert.deepEqual(fails({}, { devBalancePercentage: 22 }), ['dev bag']);
assert.deepEqual(fails({}, { devMints: 33, devMigrations: 6 }), ['dev record'], 'a serial launcher (the copycat wallet of 7 Nov)');
assert.deepEqual(fails({}, { devMints: undefined }), ['dev record'], 'unknown dev record fails');
assert.deepEqual(fails({ organicScoreLabel: 'low' }), ['organic']);
assert.deepEqual(fails({ stats1h: { buyVolume: 10_000, sellVolume: 12_000 } }), ['buying']);
assert.deepEqual(fails({ stats1h: {} }), ['buying']);
assert.match(checkCoin(good()).lines.join(' | '), /\$48\.0K cap, \$14\.0K liquidity \| mint and freeze off \| 420 holders \| top holders 18% \| bots 4\.0% \| snipers 2\.0% \| dev holds 0\.0% \| dev: 2 coins, 1 bonded \| organic trading medium \| 1h: \$30\.0K bought, \$21\.0K sold/);

// ---- the message: no mentions, no links or markdown from the coin, the checks, a link to the full scan
const row = { mint: M(1), symbol: 'GOOD', name: 'Good Coin', story: 'space cat', at: now - 14 * 60_000, mc0: 21_000 };
const msg = signalMessage(row, good(), checkCoin(good()), now);
const e = msg.embeds[0];
assert.deepEqual(msg.allowed_mentions, { parse: [] });
assert.equal(e.title, 'Radar signal · $GOOD (Good Coin)');
assert.equal(e.url, `https://dexscreener.com/solana/${M(1)}`);
assert.match(e.description, /^\*\*Breaking now:\*\* "space cat" · flagged 14 min ago at \$21\.0K/);
assert.match(e.description, /\*\*Now:\*\* \$48\.0K cap, \$14\.0K liquidity · 420 holders/);
assert.match(e.description, /\*\*Checks passed:\*\* mint and freeze off · top holders 18% · .* · 1h: \$30\.0K bought, \$21\.0K sold/);
assert.ok(!/\*\*Checks passed:\*\*[^\n]*420 holders/.test(e.description), 'holders are on the Now line, not twice');
assert.match(e.description, new RegExp(`\\[Full scan on Radar\\]\\(https://tryradar\\.fun/scan\\?q=${M(1)}&from=discord\\)`));
assert.match(e.footer.text, /not a prediction/);
assert.ok(!/\bbuy\b/i.test(JSON.stringify(msg).replace(/bought/g, '')), 'never says buy');
const evil = signalMessage({ ...row, story: '[click](https://evil.example) @everyone' }, good({ symbol: '@everyone', name: '**Free** <@123> https://x.co' }), checkCoin(good()), now).embeds[0];
assert.ok(!/@|evil\.example|\*\*Free|x\.co/.test(evil.title + evil.description.split('\n')[0]), `nothing from the coin can mention or link: ${evil.title} ${evil.description.split('\n')[0]}`);

// ---- which flags are looked at: Breaking now only, between DELAY and WINDOW old, not posted, story not on cooldown
const flag = (i, minsAgo, extra = {}) => recordFlag(db, { mint: M(i), source: 'breaking', at: now - minsAgo * 60_000, symbol: `C${i}`, name: `Coin ${i}`, story: `story ${i}`, mc0: 9000, ...extra });
await flag(1, 14, { story: 'space cat' });
await flag(2, 5); // too new: holders see it live, the channel waits
await flag(3, 75); // too old
await flag(4, 30);
await flag(5, 40, { story: 'space cat' }); // same story as 1
await recordFlag(db, { mint: M(6), source: 'diamond', at: now - 20 * 60_000, symbol: 'DH', name: 'DH', mc0: 9000 }); // Diamond Hand: a holder perk
assert.ok(DELAY_MS === 10 * 60_000 && WINDOW_MS === 60 * 60_000);
let rows = await candidates(db, {}, now);
assert.deepEqual(rows.map((r) => r.mint), [M(1), M(4), M(5)]);
rows = await candidates(db, { posted: { [M(4)]: now - 60_000 }, stories: { 'space cat': now - 3_600_000 } }, now);
assert.deepEqual(rows.map((r) => r.mint), [], 'posted coins and stories on cooldown are skipped');

// ---- the pick: the biggest that passes
const assets = new Map([[M(1), good({ id: M(1), mcap: 30_000 })], [M(4), good({ id: M(4), mcap: 90_000 }, { devMints: 40 })], [M(5), good({ id: M(5), mcap: 60_000 })]]);
assert.equal(pick(await candidates(db, {}, now), assets).row.mint, M(5), 'M4 is bigger but fails the dev record');
assert.equal(pick([], assets), null);

// ---- state: a day's count, the coin, its story; old entries fall off
let st = after({}, { mint: M(5), story: 'space cat' }, now);
assert.equal(sentToday(st, now), 1);
st = after(st, { mint: M(1), story: 'other' }, now + 60_000);
assert.equal(sentToday(st, now + 60_000), 2);
assert.equal(sentToday(st, now + 86_400_000), 0, 'a new day starts at zero');
st = after({ ...st, posted: { old: now - 2 * 86_400_000 } }, { mint: M(4), story: '' }, now);
assert.ok(!('old' in st.posted) && M(4) in st.posted);

assert.equal(webhookOf('https://discord.com/api/webhooks/123456/abc_DEF-9'), 'https://discord.com/api/webhooks/123456/abc_DEF-9');
assert.equal(webhookOf(' https://discordapp.com/api/webhooks/1/x '), 'https://discordapp.com/api/webhooks/1/x');
assert.equal(webhookOf('https://evil.example/api/webhooks/1/x'), null);
assert.equal(webhookOf(undefined), null);

// ---- lookup: one request for many coins
let asked = '';
const got = await lookup(async (u) => { asked = u; return new Response(JSON.stringify([good({ id: M(1) }), { nope: 1 }])); }, [M(1), M(1), M(4)]);
assert.equal(asked, `https://datapi.jup.ag/v1/assets/search?query=${M(1)},${M(4)}`);
assert.deepEqual([...got.keys()], [M(1)]);

// ---- the minute's run in the bot (bot/chat.js)
assert.ok(COMMANDS.some((c) => c.name === 'signals' && c.default_member_permissions === '16'), '/signals for people who manage channels');
const calls = [];
const fakeFetch = async (u, init = {}) => {
  calls.push({ u: String(u), init });
  if (String(u).startsWith('https://datapi.jup.ag/')) return new Response(JSON.stringify([...assets.values()]));
  return new Response('{}', { status: 200 });
};
const chat = createChat({ fetch: fakeFetch });
const HOOK = 'https://discord.com/api/webhooks/42/tok';
// Nowhere to post: nothing is read at all.
assert.equal(await chat.signalsTick({ DB: db }, now), null);
assert.equal(calls.length, 0);
// A webhook: one Jupiter request, one post, saved before posting.
let r = await chat.signalsTick({ DB: db, DISCORD_SIGNALS_WEBHOOK: HOOK }, now);
assert.deepEqual(r, { mint: M(5), ok: true });
assert.equal(calls.length, 2);
assert.equal(calls[1].u, `${HOOK}?wait=true`);
assert.equal(JSON.parse(calls[1].init.body).embeds[0].title, 'Radar signal · $GOOD (Good Coin)');
// Next minute: M5 is posted and "space cat" is on cooldown, so M1 is out too; M4 fails its dev record. Nothing.
r = await chat.signalsTick({ DB: db, DISCORD_SIGNALS_WEBHOOK: HOOK }, now + 60_000);
assert.equal(r, null);
assert.equal(calls.length, 3, 'looked, posted nothing');
// The day's cap stops it before any request.
sql.prepare('UPDATE bot_kv SET v = ? WHERE k = ?').run(JSON.stringify({ day: '2026-11-07', sent: MAX_PER_DAY }), 'signals');
calls.length = 0;
assert.equal(await chat.signalsTick({ DB: db, DISCORD_SIGNALS_WEBHOOK: HOOK }, now + 120_000), null);
assert.equal(calls.length, 0);
// A channel chosen with /signals posts through the bot.
sql.prepare('UPDATE bot_kv SET v = ? WHERE k = ?').run(JSON.stringify({ channel: '777' }), 'signals');
r = await chat.signalsTick({ DB: db, DISCORD_BOT_TOKEN: 'x' }, now);
assert.equal(r.mint, M(5));
assert.equal(calls.at(-1).u, 'https://discord.com/api/v10/channels/777/messages');

console.log('PASS discord-signals: the checks, the message, which flags and when, one post a minute, webhook or channel');
