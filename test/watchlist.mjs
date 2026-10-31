// Offline: the watchlist's rules. node test/watchlist.mjs
import assert from 'node:assert/strict';
import { MAX_STARS, starOf, toggleStar, sinceStar } from '../extension/src/ui/watchlist.js';

const coin = (n, marketCap = 1000) => ({ address: `a${n}`, chain: 'solana', symbol: `C${n}`, name: `Coin ${n}`, image: null, marketCap, secret: 'x' });
const star = starOf({ ...coin(1, 50_000), liquidity: 9000 }, 'https://x.com/a/status/1', 123);
assert.deepEqual(star, { address: 'a1', chain: 'solana', symbol: 'C1', name: 'Coin 1', image: null, cap: 50_000, liq: 9000, post: 'https://x.com/a/status/1', t: 123 }, 'keeps only what the list needs');
assert.equal(starOf({ ...coin(1), liquidity: 9000, onCurve: true }).liq, 0, 'a launch curve has no pool to measure from');

let list = toggleStar([], star);
assert.equal(list.length, 1);
list = toggleStar(list, starOf(coin(2)));
assert.deepEqual(list.map((s) => s.address), ['a2', 'a1'], 'newest first');
assert.deepEqual(toggleStar(list, starOf(coin(2))).map((s) => s.address), ['a1'], 'a second tap takes it off');
assert.equal(toggleStar(list, null), list);

let full = [];
for (let i = 0; i < MAX_STARS; i++) full = toggleStar(full, starOf(coin(i)));
assert.equal(full.length, MAX_STARS);
assert.equal(toggleStar(full, starOf(coin(99))).length, MAX_STARS, 'a full list stays as it is');
assert.equal(toggleStar(full, starOf(coin(0))).length, MAX_STARS - 1, 'but can still lose one');

assert.equal(sinceStar({ cap: 100 }, 150), 50);
assert.equal(sinceStar({ cap: 100 }, 50), -50);
assert.equal(sinceStar({ cap: 0 }, 50), null, 'no cap when starred: no change to show');
assert.equal(sinceStar({ cap: 100 }, 0), null);
console.log('PASS watchlist: toggling, order, the cap, and the change since the star');

import { lookAtStar } from '../extension/src/lib/guard.js';
const s = { symbol: 'X', liq: 10_000 };
const lc = (verdict) => ({ checked: true, verdict });
let look = lookAtStar(s, { lc: lc('LIKELY LARP') });
assert.deepEqual(look.events, [], 'the first verdict only notes where it stands');
look = lookAtStar(s, { lc: lc('LIKELY REAL') }, {});
assert.equal(look.state.word, 'LIKELY REAL');
look = lookAtStar(s, { lc: lc('LARP') }, look.state);
assert.deepEqual(look.events, [{ reason: 'verdict', word: 'LARP' }], 'turning bad speaks');
assert.deepEqual(lookAtStar(s, { lc: lc('SCAM') }, look.state).events, [], 'bad to worse has already been said');
assert.deepEqual(lookAtStar(s, { lc: { checked: false } }, { word: 'REAL' }).state, { word: 'REAL' }, 'no answer changes nothing');

look = lookAtStar(s, { gone: true });
assert.equal(look.events[0].text, 'The post behind $X is gone');
assert.deepEqual(lookAtStar(s, { gone: true }, look.state).events, [], 'said once');
assert.deepEqual(lookAtStar(s, { gone: false }).events, []);
assert.deepEqual(lookAtStar(s, { gone: null }).events, [], "a busy lookup says nothing about the post");

assert.deepEqual(lookAtStar(s, { live: { liquidity: 7100 } }).events, [], 'a 29% drop is quiet');
look = lookAtStar(s, { live: { liquidity: 7000 } });
assert.equal(look.events[0].text, '$X liquidity is down 30% since you starred it');
assert.deepEqual(lookAtStar(s, { live: { liquidity: 1000 } }, look.state).events, [], 'said once');
assert.deepEqual(lookAtStar({ ...s, liq: 900 }, { live: { liquidity: 100 } }).events, [], 'a tiny pool means nothing');
assert.deepEqual(lookAtStar(s, { live: { liquidity: 10, onCurve: true } }).events, [], 'a curve has no pool');
const curve = { symbol: 'C', liq: 0 };
look = lookAtStar(curve, { live: { liquidity: 50_000 } });
assert.deepEqual(look.events, [], 'a coin starred on its curve starts from its first pool');
assert.equal(look.state.liq, 50_000);
assert.equal(lookAtStar(curve, { live: { liquidity: 30_000 } }, look.state).events[0].reason, 'liquidity');
console.log('PASS guard: each alert fires once, only on real news, and an unknown says nothing');
