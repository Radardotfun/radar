// Offline: finding new pairs on a story, and following a word. node test/fresh.mjs
import assert from 'node:assert/strict';
import { freshPairs, postWords, storyWords, BADGE_MS, NEW_TAB_MS } from '../extension/src/lib/fresh.js';

assert.deepEqual(storyWords(['regretamine', 'regret', 'elon', 'musk'], 'elonmusk', 'a drug called Regretamine'), ['regretamine', 'regret'], 'the author alone is not the story');
assert.deepEqual(storyWords(['elon', 'mars'], 'elonmusk', 'Elon is going to Mars'), ['elon', 'mars'], 'unless the post says the name');
assert.deepEqual(storyWords(['elon', 'musk'], 'elonmusk', 'look at this'), ['elon', 'musk'], 'nothing else to go on: keep them');
assert.deepEqual(storyWords(['max', 'meta'], '', 'x'), ['max', 'meta'], 'no author: nothing changes');
import { newFollow, checkWatch, FOLLOW_MS } from '../extension/src/lib/alerts.js';

const now = 1_800_000_000_000;
const h = 3_600_000;
const coin = (symbol, name, addr, ageH, extra = {}) => ({
  address: addr, chain: 'solana', symbol, name, createdAt: now - ageH * h, onCurve: true, liquidity: 0, marketCap: 9000, mcapBacked: true,
  volume: { h1: 500, h24: 800 }, txns: { h1: { buys: 8, sells: 2 }, h24: { buys: 12, sells: 3 } }, priceChange: {}, ...extra,
});
const opts = { chains: ['solana'], now };

assert.deepEqual(postWords('JUST IN: Meta develops humanoid robot named Max'), ['Meta', 'Max'].filter((w) => postWords('JUST IN: Meta develops humanoid robot named Max').includes(w)));
assert.ok(postWords('JUST IN: Meta develops humanoid robot named Max').includes('Meta'), 'names count');
assert.deepEqual(postWords('gm everyone hope you have a great day'), [], 'a post that names nothing searches for nothing');
assert.deepEqual(postWords('$BTC is pumping'), [], 'a major is no story');

const max = coin('MAX', 'Max', 'a1', 1);
const late = coin('METAMAX', 'Meta Max', 'a2', 0.5);
const old = coin('OLDMAX', 'Old Max', 'a0', 400);
const lateCopy = coin('MAX', 'Max Two', 'a3', 0.2);
const stranger = coin('DOG', 'Some Dog', 'a4', 0.1);
const dead = coin('MAXX', 'Maxx Max', 'a5', 0.1, { txns: { h1: { buys: 1, sells: 0 }, h24: { buys: 1, sells: 0 } } });
const dust = coin('MAXD', 'Dust Max', 'a9', 0.1, { marketCap: 19, txns: { h1: { buys: 357, sells: 3 }, h24: { buys: 357, sells: 3 } } });
const noPool = coin('MAX', 'Pool Max', 'a6', 0.1, { onCurve: false, liquidity: 200 });
const elsewhere = coin('MAX', 'Chain Max', 'a7', 0.1, { chain: 'ethereum' });
const tooOld = coin('MAXI', 'Maxi Max', 'a8', 30);

const out = freshPairs([max, late, old, lateCopy, stranger, dead, dust, noPool, elsewhere, tooOld], ['Max', 'Meta'], opts);
assert.deepEqual(out.map((t) => t.address).sort(), ['a1', 'a2', 'a3'].sort(), 'named after the story, new, and really trading');
assert.deepEqual(out.map((t) => t.address), ['a2', 'a1', 'a3'], 'firsts of a name come before copies, even newer ones, then newest first');
assert.equal(out.find((t) => t.address === 'a3').copyOf.symbol, 'MAX', 'a copy says what it copies');
assert.equal(out.find((t) => t.address === 'a2').copyOf, null, 'a new name is the first of it');
// Tickers get reused: a small coin dead for months doesn't make a new one a copy, but a big one or a recent one does.
const fresh1 = coin('GOAT', 'Goat', 'g1', 1);
const copyWith = (older) => freshPairs([fresh1, older], ['Goat'], opts).find((t) => t.address === 'g1').copyOf;
assert.equal(copyWith(coin('GOAT', 'Old Goat', 'g0', 24 * 90)), null, 'an old small namesake is not what it copies');
assert.equal(copyWith(coin('GOAT', 'Big Goat', 'g0', 24 * 90, { marketCap: 14_000_000 })).symbol, 'GOAT', 'a big one is');
assert.equal(copyWith(coin('GOAT', 'Deep Goat', 'g0', 24 * 90, { liquidity: 50_000 })).symbol, 'GOAT', 'so is one with deep liquidity');
assert.equal(copyWith(coin('GOAT', 'Week Goat', 'g0', 24 * 3)).symbol, 'GOAT', 'and so is a recent one');
assert.equal(copyWith(coin('GOAT', 'BNB Goat', 'g0', 24 * 3, { chain: 'bsc' })), null, 'another chain is another coin');
// The badge wants coins trading now; the tab also keeps one that traded through the day.
const quietHour = coin('QUIET', 'Quiet Max', 'q1', 5, { onCurve: false, liquidity: 9000, txns: { h1: { buys: 0, sells: 0 }, h24: { buys: 40, sells: 9 } } });
assert.equal(freshPairs([quietHour], ['Max'], opts).length, 1);
assert.equal(freshPairs([quietHour], ['Max'], { ...opts, hot: true }).length, 0);
assert.deepEqual(freshPairs([coin('NEW', 'New One', 'b1', 2), coin('NEWER', 'New Two', 'b2', 1)], ['New One', 'New Two'], opts).map((t) => t.address), ['b2', 'b1'], 'newest first');
assert.equal(freshPairs([coin('MAX', 'Max', 'c1', 7)], ['Max'], { ...opts, maxAge: BADGE_MS }).length, 0, 'the badge only looks back 6 hours');
assert.equal(freshPairs([coin('MAX', 'Max', 'c1', 7)], ['Max'], { ...opts, maxAge: NEW_TAB_MS }).length, 1, 'the tab looks back a day');
assert.equal(freshPairs([{ ...max, createdAt: null }], ['Max'], opts).length, 0, 'an unknown launch time is not new');
assert.equal(freshPairs(null, ['Max'], opts).length, 0);
assert.equal(freshPairs([coin('USDC', 'Max USDC', 'd1', 1)], ['Max'], opts).length, 0, 'a stablecoin is not a memecoin');
console.log('PASS fresh: new pairs are named after the story, really trading, and copies are marked');

// Following a word.
const w = newFollow(' $Meta  Max ', now);
assert.equal(w.word, 'Meta Max');
assert.equal(w.id, 'w:metamax');
assert.equal(w.until, now + FOLLOW_MS);
assert.match(w.url, /^https:\/\/x\.com\/search\?q=Meta%20Max/);
assert.throws(() => newFollow('ab', now), /at least 3 letters/);
assert.throws(() => newFollow('$$$', now), /at least 3 letters/);

const pair = (symbol, name, addr, created, extra = {}) => ({
  chainId: 'solana', dexId: 'pumpfun', pairAddress: `p${addr}`, baseToken: { address: addr, name, symbol }, quoteToken: { address: 'So11111111111111111111111111111111111111112' },
  pairCreatedAt: created, priceUsd: '0.001', priceNative: '0.00001', marketCap: 9000, fdv: 9000, liquidity: { usd: 3000, quote: 15 },
  volume: { h24: 900, h1: 300, m5: 10, h6: 500 }, txns: { h1: { buys: 5, sells: 1 }, h24: { buys: 8, sells: 2 } }, priceChange: {}, ...extra,
});
let results = [pair('MAX', 'Max', 'e1', now - 48 * h)];
let profileCalls = 0;
const deps = { chains: ['solana'], search: async () => results, profiles: async () => { profileCalls += 1; return []; }, tokens: async () => [] };
const follow = newFollow('Max', now);
const first = await checkWatch(follow, deps);
assert.deepEqual(first.hits, [], 'what already exists stays quiet');
assert.ok(first.seen.includes('e1'));
const after = { ...follow, seen: first.seen, primed: true };
results = [...results, pair('MAXX', 'Max Rocket', 'e2', now + 60_000), pair('DOGE2', 'Dog Two', 'e3', now + 60_000)];
const second = await checkWatch(after, deps);
assert.deepEqual(second.hits.map((x) => x.coin.address), ['e2'], 'a new pair named after the word pings');
assert.equal(second.hits[0].tie, 'name');
results = [pair('MAXY', 'Max Early', 'e4', now - 60_000)];
assert.deepEqual((await checkWatch(after, deps)).hits, [], 'a coin from before following it is not new');
assert.equal(profileCalls, 0, 'a word has no post to look up');
console.log('PASS fresh: following a word pings only on new pairs');
