// A big launch block counts in the coin check, even once it has sold. node test/coincheck.mjs
import assert from 'node:assert/strict';
import { coinCheck } from '../extension/src/ui/coincheck.js';

const launch = (bundledPct, bundleHeldPct = 0) => ({ ok: true, bundledPct, bundleHeldPct, devBoughtPct: 0, devHeldPct: 0 });
const rug = { insiderPct: 0, insiderWallets: 0, top10Pct: 15, freezeAuthority: null, mintAuthority: null, poolTokens: 2e8, supplyTokens: 1e9 };
const token = { onCurve: true };
const check = (bundle) => coinCheck(token, rug, bundle);
const fact = (c) => c.facts.find((f) => f.k === 'Launch block bought');

let c = check(launch(0));
assert.deepEqual([c.word, c.score], ['OK', 100], 'a clean launch stays a clean 100');
assert.equal(fact(c), undefined, 'and has no extra line');

c = check(launch(4.9));
assert.deepEqual([c.word, c.score], ['OK', 100], 'under 5% changes nothing');

c = check(launch(5));
assert.deepEqual([c.word, c.score], ['OK', 95], 'from 5% it costs a little');
assert.equal(fact(c).lvl, 'watch');

// The case Larpcheck pointed at: 25.5% bought at launch, all of it sold.
c = check(launch(25.5, 0));
assert.equal(c.word, 'NEUTRAL', 'a 25.5% launch block can never read OK');
assert.equal(c.score, 59);
assert.equal(fact(c).v, 25.5, 'and the card says how much');
assert.match(c.call, /launch block bought 26%/i, 'and the one line names it');

c = check(launch(19.9));
assert.equal(c.word, 'OK', 'just under the line stays OK');

c = check(launch(50, 0));
assert.equal(c.word, 'SKETCHY', 'half the supply at launch is a serious flag, sold or not');
assert.equal(fact(c).lvl, 'risk');

c = check(launch(25.5, 10));
assert.equal(c.word, 'SKETCHY', 'still holding a big share stays worse than NEUTRAL');

c = coinCheck(token, rug, { ok: false, reason: 'no block' });
assert.equal(c.word, 'OK', 'with no launch data, it judges what it has');
assert.equal(fact(c), undefined);

assert.equal(check(launch(25.5)).facts.filter((f) => f.k === 'Launch block bought').length, 1);
console.log('PASS coincheck: a big launch block counts, sold or not');
