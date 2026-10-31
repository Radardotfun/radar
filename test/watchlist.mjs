// Offline: the watchlist's rules. node test/watchlist.mjs
import assert from 'node:assert/strict';
import { MAX_STARS, starOf, toggleStar, sinceStar } from '../extension/src/ui/watchlist.js';

const coin = (n, marketCap = 1000) => ({ address: `a${n}`, chain: 'solana', symbol: `C${n}`, name: `Coin ${n}`, image: null, marketCap, secret: 'x' });
const star = starOf(coin(1, 50_000), 123);
assert.deepEqual(star, { address: 'a1', chain: 'solana', symbol: 'C1', name: 'Coin 1', image: null, cap: 50_000, t: 123 }, 'keeps only what the list needs');

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
