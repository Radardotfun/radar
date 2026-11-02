// Breaking now (server/feed.js, bot/wire.js), offline: how stories are found, and the holder delay. node test/feed.mjs
import assert from 'node:assert/strict';
import { findStories } from '../bot/wire.js';
import { feed, FEED_DELAY_MS } from '../server/feed.js';
import { makeToken } from '../server/holder.js';

const now = Date.parse('2026-11-01T12:00:00Z');
const min = 60_000;
let n = 0;
const coin = (name, ago, m = 2000, dev = `dev${n}`) => { n += 1; return { a: `addr${n}`, s: name.split(' ')[0].toUpperCase(), n: name, m, d: dev, t: now - ago * min }; };
const burst = (name, count, ago, top = 20_000) => Array.from({ length: count }, (_, i) => coin(name, ago - i, i === count - 1 ? top : 2000));

// A word needs enough coins, enough different wallets and one coin that has traded up.
assert.equal(findStories(burst('Vamplon', 5, 20), now).length, 0, 'too few coins');
assert.equal(findStories(burst('Vamplon', 8, 20, 3000), now).length, 0, 'nothing traded up');
assert.equal(findStories(Array.from({ length: 8 }, (_, i) => coin('Vamplon', 20 - i, i ? 2000 : 20_000, 'one wallet')), now).length, 0, 'one wallet');
assert.equal(findStories(burst('Super Coin', 12, 20), now).length, 0, 'generic words say nothing');
console.log('PASS feed: a story needs many coins, many wallets and real trading');

// Old launches don't count.
assert.equal(findStories(burst('Vamplon', 8, 50), now).length, 0, 'outside the window');

// One story's two words become one row; separate stories stay apart.
const mixed = [...burst('Chinese China', 8, 25), ...burst('China', 3, 20), ...burst('Chinese', 3, 18), ...burst('Vamplon', 7, 9)];
const stories = findStories(mixed, now);
assert.equal(stories.length, 2);
const china = stories.find((s) => s.words.includes('china'));
assert.deepEqual([...china.words].sort(), ['china', 'chinese']);
assert.equal(china.coins, 14);
const vamp = stories.find((s) => s.words.includes('vamplon'));
assert.equal(vamp.coins, 7);
assert.equal(stories[0], vamp, 'the busiest right now comes first');
assert.equal(vamp.recent, 7);
assert.ok(vamp.first.t <= Math.min(...mixed.filter((c) => c.n === 'Vamplon').map((c) => c.t)), 'first is the earliest');
assert.ok(vamp.big[0].m >= 20_000, 'biggest leads the lookups');
assert.ok(vamp.big.length <= 5, 'few lookups a story');
assert.ok(!vamp.big.some((c) => c.a === vamp.first.a), 'no coin looked up twice');
console.log('PASS feed: overlapping words merge, the busiest leads');

// The server: holders live, everyone else 10 minutes behind, however the request is dressed up.
const asked = [];
const fakeDb = (rows) => ({ prepare: () => ({ bind: (from, to) => ({ all: async () => { asked.push([from, to]); return { results: rows.filter((r) => r.at >= from && r.at <= to).map((r) => ({ coins: JSON.stringify(r.coins) })) }; } }) }) });
const fresh = burst('Vamplon', 8, 6);
const rows = [{ at: now - 3 * min, coins: fresh }];
const store = new Map();
const cache = { match: async (k) => store.get(k.url)?.clone(), put: async (k, v) => { store.set(k.url, v); } };
const env = { DB: fakeDb(rows), HOLDER_SECRET: 'test-secret' };
const opts = { cache, now };
const anon = await feed({}, env, opts);
assert.equal(anon.live, false);
assert.equal(anon.asOf, now - FEED_DELAY_MS);
assert.equal(anon.stories.length, 0, 'a story 3 minutes old is not out yet');
const { token } = await makeToken(env, 'So11111111111111111111111111111111111111112', now);
const holder = await feed({ token }, env, opts);
assert.equal(holder.live, true);
assert.equal(holder.stories.length, 1, 'a holder sees it now');
assert.equal((await feed({ token: 'made-up' }, env, opts)).live, false, 'a bad token gets the delayed list');
assert.equal((await feed({ token: `${token}x` }, env, opts)).live, false, 'a tampered token too');
assert.equal((await feed({ token: (await makeToken({ HOLDER_SECRET: 'other' }, 'So11111111111111111111111111111111111111112', now)).token }, env, opts)).live, false, 'a token from another secret too');
const later = await feed({}, env, { cache, now: now + FEED_DELAY_MS });
assert.equal(later.stories.length, 1, 'ten minutes on, everyone sees it');
console.log('PASS feed: holders are live, everyone else is 10 minutes behind');

// One read a minute, per view, whoever asks.
asked.length = 0;
for (let i = 0; i < 5; i += 1) await feed({}, env, { cache, now: now + 2 * FEED_DELAY_MS });
assert.equal(asked.length, 1, 'the cache answers the rest');
console.log('PASS feed: one database read a minute');
process.exit(0);
