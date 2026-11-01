// Which coins can hold a title on a scan, offline. node test/picks.mjs
import assert from 'node:assert/strict';
import { isDust, pickThree } from '../extension/src/lib/market.js';

const now = Date.now();
const hour = 3_600_000;
const coin = (symbol, cap, { age = 48 * hour, h1 = 40, liq = 20_000, vol = 50_000, rel = 90, onCurve = false } = {}) => ({
  address: `${symbol}${cap}`.padEnd(40, '1'), chain: 'solana', symbol, name: symbol, marketCap: cap, mcapBacked: true, liquidity: liq, onCurve, relevance: rel, createdAt: now - age,
  priceChange: { h1: 5, h6: 5 }, volume: { h1: 5000, h6: 8000, h24: vol }, txns: { h1: { buys: h1 / 2, sells: h1 / 2 }, h24: { buys: h1, sells: h1 } },
});

// Dust: small and old, or small and barely trading. A brand-new busy coin isn't.
assert.equal(isDust(coin('OLD', 3000, { age: 5 * hour })), true);
assert.equal(isDust(coin('QUIET', 3000, { age: 10 * 60_000, h1: 2 })), true);
assert.equal(isDust(coin('NEW', 3000, { age: 10 * 60_000, h1: 200 })), false, 'minutes old and busy is what people come for');
assert.equal(isDust(coin('BIG', 80_000, { age: 500 * hour, h1: 0 })), false, 'a big coin is not dust');
assert.equal(isDust({ marketCap: 3000 }), true, 'no age and no trades');
console.log('PASS picks: dust is told from a new coin');

// Dust gets no title beside a real coin, and a new one can still win.
const real = coin('REAL', 90_000);
const dust = coin('DUST', 3400, { age: 40 * hour, rel: 99, onCurve: true, liq: 0 });
const roles = (r) => r.picks.filter(Boolean).map((p) => `${p.role}:${p.token.symbol}`);
const withDust = pickThree([real, dust], { cuts: [0], allowFallback: false });
assert.ok(!roles(withDust).some((r) => /:DUST$/.test(r) && !r.startsWith('og')), roles(withDust).join());
assert.ok(roles(withDust).includes('top:REAL'));
const fresh = coin('FRESH', 3100, { age: 8 * 60_000, h1: 300, onCurve: true, liq: 0, vol: 9000 });
assert.ok(pickThree([fresh], { cuts: [0], allowFallback: false }).picks.some((p) => p?.token.symbol === 'FRESH'), 'a busy new coin holds a title');
// With only a dead coin, nothing gets a title when the caller asks for no fallback.
const dead = coin('DEAD', 40_000, { vol: 45, h1: 0 });
assert.equal(pickThree([dead], { cuts: [0], allowFallback: false }).picks.filter((p) => p && p.role !== 'og').length, 0);
console.log('PASS picks: dust and dead coins get no Top or Mover title');
