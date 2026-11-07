// Breaking now pings (extension/src/lib/breakingpings.js): which stories ping, once, and the alert each makes.
// node test/breakingpings.mjs
import assert from 'node:assert/strict';
import { breakingPings, breakingItem, pingWorthy, MIN_COINS, MIN_WALLETS, MIN_CAP, COOLDOWN_MS, MAX_PER_LOOK } from '../extension/src/lib/breakingpings.js';

const now = Date.parse('2026-11-07T16:00:00Z');
const coin = (a, cap, symbol = a.toUpperCase()) => ({ address: `${a}${'x'.repeat(40)}`.slice(0, 44), symbol, name: `${a} coin`, cap });
const story = (word, o = {}) => ({ words: [word], coins: 12, wallets: 8, recent: 4, startedAt: now - 20 * 60_000, first: coin(word + 'first', 6000), biggest: coin(word + 'big', 40_000), ...o });

// ---- a burst: enough coins, wallets, and one coin past the cap
assert.ok(pingWorthy(story('cat')));
assert.ok(!pingWorthy(story('cat', { coins: MIN_COINS - 1 })));
assert.ok(!pingWorthy(story('cat', { wallets: MIN_WALLETS - 1 })));
assert.ok(!pingWorthy(story('cat', { biggest: coin('b', MIN_CAP - 1), first: coin('f', 900) })));
assert.ok(pingWorthy(story('cat', { biggest: null, first: coin('f', MIN_CAP) })), 'the first coin can be the big one');
assert.ok(!pingWorthy(story('', {})));

// ---- the first look only notes what is already breaking
let r = breakingPings([story('cat'), story('dog', { coins: 3 })], null, now);
assert.deepEqual(r.pings, []);
assert.deepEqual(Object.keys(r.seen).sort(), ['cat', 'dog']);
// next look: a new burst pings; one already seen doesn't; a small one waits
r = breakingPings([story('cat'), story('dog', { coins: 3 }), story('Moon'), story('tiny', { wallets: 2 })], r.seen, now + 60_000);
assert.deepEqual(r.pings.map((s) => s.words[0]), ['Moon']);
assert.ok('moon' in r.seen && !('tiny' in r.seen), 'a story not yet a burst stays unseen');
// the small one grows into a burst: it pings then
r = breakingPings([story('tiny')], r.seen, now + 120_000);
assert.deepEqual(r.pings.map((s) => s.words[0]), ['tiny']);
// and never twice inside the cooldown, even after leaving the feed and coming back
r = breakingPings([], r.seen, now + 180_000);
r = breakingPings([story('tiny')], r.seen, now + 240_000);
assert.deepEqual(r.pings, []);
// after the cooldown it can ping again
r = breakingPings([], r.seen, now + COOLDOWN_MS + 200_000);
assert.ok(!('tiny' in r.seen));
r = breakingPings([story('tiny')], r.seen, now + COOLDOWN_MS + 260_000);
assert.equal(r.pings.length, 1);
// at most a few per look
r = breakingPings(Array.from({ length: 6 }, (_, i) => story(`w${i}`)), { old: now }, now);
assert.equal(r.pings.length, MAX_PER_LOOK);
// junk in, nothing out
assert.deepEqual(breakingPings(null, {}, now).pings, []);
assert.deepEqual(breakingPings([{ words: [] }, {}], 'nonsense', now).pings, []);

// ---- the alert
const item = breakingItem(story('Space', { words: ['space', 'cat'] }), now);
assert.equal(item.kind, 'breaking');
assert.equal(item.id, `breaking:space:${now - 20 * 60_000}`);
assert.equal(item.text, '12 coins from 8 wallets · biggest $40.0K');
assert.deepEqual(item.watch, { word: 'space', author: 'Breaking now', label: 'space · cat', url: 'https://x.com/search?q=space&f=live' });
assert.equal(item.coin.symbol, 'SPACEBIG');
assert.equal(item.chart, `https://dexscreener.com/solana/${item.coin.address}`);
assert.equal(item.buy, null, 'a story alert has no buy button');
assert.match(breakingItem(story('a b&c'), now).watch.url, /q=a%20b%26c&f=live$/);

console.log('PASS breakingpings: bursts only, a quiet first look, once per story, the alert');
