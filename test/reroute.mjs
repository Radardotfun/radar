// Offline: the instant-reroute rules and pick order (no network). node test/reroute.mjs
import assert from 'node:assert/strict';
import { pickReroute, reportBlock, marketBlock, rejectionLine } from '../extension/src/lib/reroute.js';

const coin = (symbol, marketCap, extra = {}) => ({
  symbol, address: `${symbol}mint`, chain: 'solana', marketCap, liquidity: 50_000, onCurve: false,
  mcapBacked: true, volume: { h24: 20_000 }, ...extra,
});
const clean = { score: 1, rugged: false, risks: [], mintAuthority: null, freezeAuthority: null, holders: 2_400, top10Pct: 22, topHolder: { pct: 3 }, insiderPct: 2 };
const rep = (over = {}) => ({ ...clean, ...over });

// Report rules, one failure each.
assert.equal(reportBlock(clean), null);
assert.equal(reportBlock(null), 'no RugCheck report');
assert.equal(reportBlock(rep({ rugged: true })), 'liquidity pulled');
assert.equal(reportBlock(rep({ freezeAuthority: 'x' })), 'freeze authority is on');
assert.equal(reportBlock(rep({ mintAuthority: 'x' })), 'mint authority is on');
assert.equal(reportBlock(rep({ risks: [{ name: 'Creator history of rugged tokens', level: 'danger' }] })), 'RugCheck flags creator history of rugged tokens');
assert.equal(reportBlock(rep({ risks: [{ name: 'Low Liquidity', level: 'warn' }] })), null, 'warnings alone do not block');
assert.equal(reportBlock(rep({ score: 79 })), 'RugCheck score 79');
assert.equal(reportBlock(rep({ score: null })), 'no RugCheck score');
assert.equal(reportBlock(rep({ holders: 97 })), 'only 97 holders');
assert.equal(reportBlock(rep({ holders: null })), 'holder count unknown');
assert.equal(reportBlock(rep({ topHolder: { pct: 40 } })), 'one wallet holds 40%');
assert.equal(reportBlock(rep({ top10Pct: 62 })), 'top 10 hold 62%');
assert.equal(reportBlock(rep({ insiderPct: 48.5 })), 'insiders hold 49%');
assert.equal(reportBlock(rep({ insiderPct: null })), null, 'unknown insiders do not block');

// Market rules: curve coins count when they trade; dead or other-chain coins don't.
assert.equal(marketBlock(coin('A', 1)), null);
assert.equal(marketBlock(coin('CURVE', 1, { onCurve: true, liquidity: 0, volume: { h24: 900 } })), null);
assert.equal(marketBlock(coin('DEAD', 1, { onCurve: true, liquidity: 0, volume: { h24: 10 } })), 'not trading');
assert.equal(marketBlock(coin('THIN', 1, { liquidity: 800 })), 'not trading');
assert.equal(marketBlock(coin('ETH', 1, { chain: 'ethereum' })), 'not on Solana');
// A thin cap counts only while the pool is shallow; a deep pool under a huge cap is fine (large coins).
assert.equal(marketBlock(coin('BIGCAP', 272e6, { liquidity: 744_000, mcapBacked: false })), null);
assert.equal(marketBlock(coin('THINCAP', 2e6, { liquidity: 6_000, mcapBacked: false })), 'thin liquidity for its market cap');

// Pick order: the biggest passing coin wins, even when it sits in a later batch.
const reports = {
  BIGRUG: rep({ insiderPct: 70 }), BIG2: rep({ holders: 40 }), MID: clean, SMALL: clean,
  B5: rep({ mintAuthority: 'x' }), B6: clean,
};
const calls = [];
const get = async (t) => { calls.push(t.symbol); return reports[t.symbol] ?? null; };
let r = await pickReroute([coin('SMALL', 10_000), coin('MID', 500_000), coin('BIGRUG', 9_000_000), coin('BIG2', 2_000_000)], get);
assert.equal(r.token.symbol, 'MID');
assert.deepEqual(r.rejected.map((x) => x.why), ['insiders hold 70%', 'only 40 holders']);

calls.length = 0;
r = await pickReroute(['BIGRUG', 'BIG2', 'B5', 'NOREPORT', 'B6', 'MID'].map((s, i) => coin(s, 1e7 - i * 1e6)), get, { batch: 4 });
assert.equal(r.token.symbol, 'B6', 'first passing coin in market-cap order, from the second batch');
assert.deepEqual(calls.slice(0, 4), ['BIGRUG', 'BIG2', 'B5', 'NOREPORT'], 'first batch is the four biggest');
assert.ok(!calls.includes('MID') || calls.indexOf('MID') > calls.indexOf('B6'));

// Dead coins are skipped before any report is read; duplicates are read once.
calls.length = 0;
r = await pickReroute([coin('DEAD', 9e9, { liquidity: 0, volume: { h24: 0 } }), coin('MID', 1), coin('MID', 1)], get);
assert.equal(r.token.symbol, 'MID');
assert.deepEqual(calls, ['MID']);

// Nothing passes: say which checked coin failed and why. A report that throws counts as unknown.
r = await pickReroute([coin('BIG2', 5), coin('DEAD', 9, { liquidity: 0, volume: { h24: 0 } })], get);
assert.equal(r.token, null);
assert.equal(rejectionLine(r.rejected), '$BIG2 only 40 holders');
r = await pickReroute([coin('X', 1)], async () => { throw new Error('429'); });
assert.equal(r.token, null);
assert.equal(rejectionLine(r.rejected), '$X no RugCheck report');

console.log('PASS reroute rules, pick order, batching and messages');
