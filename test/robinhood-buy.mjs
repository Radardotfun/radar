// The Robinhood Chain Quick Buy guard (web/robinhood-guard.js).
// node test/robinhood-buy.mjs          offline: verdicts, limits, the checks right before the wallet, the v4 encoding
// node test/robinhood-buy.mjs --live   also plans real buys against the chain with simulations only (nothing is signed or sent)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const ctx = { console, fetch, AbortSignal, BigInt, Number, setTimeout };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL('../web/robinhood-guard.js', import.meta.url), 'utf8'), ctx);
const G = ctx.RadarRobinhoodGuard;

const COIN = '0x7fe995a80075df3dc8ae11a9b82c7fe4202cd87f';
const ME = '0x1111111111111111111111111111111111111111';
const THEM = '0x2222222222222222222222222222222222222222';

// What stops a buy.
assert.match(G.verdict(null), /would fail/);
assert.match(G.verdict({ sellOk: false, cost: 0.01, roundTrip: 0 }), /sale failed/, 'a coin that can\'t be sold');
assert.match(G.verdict({ sellOk: true, cost: 0.35, roundTrip: 0.6 }), /lose about 35%/, 'a heavy buy tax');
assert.match(G.verdict({ sellOk: true, cost: 0.02, roundTrip: 0.7 }), /lose about 30%.*heavy tax/, 'a heavy sell tax');
assert.equal(G.verdict({ sellOk: true, cost: 0.0101, roundTrip: 0.9801 }), null, 'a normal 1% pool passes');
assert.equal(G.verdict({ sellOk: true, cost: G.MAX_BUY_COST, roundTrip: G.MIN_ROUND_TRIP }), null, 'the limits themselves pass');
console.log('PASS robinhood: heavy taxes and coins that can\'t be sold are stopped');

// Amounts and slippage.
assert.match(G.amountBlock(0), /at least/);
assert.match(G.amountBlock(NaN), /at least/);
assert.match(G.amountBlock(3), /caps one buy/);
assert.equal(G.amountBlock(0.01), null);
assert.equal(G.toWei(0.01), 10000000000000000n);
assert.equal(G.minimumOut(1000n, 10), 900n);
assert.equal(G.minimumOut(1000n, 0.5), 995n);
console.log('PASS robinhood: amounts and slippage');

// Right before the wallet is asked.
const amount = G.toWei(0.01);
const v3 = { to: G.SWAP_ROUTER, data: G.v3Swap(G.WETH, COIN, 10000, ME, amount, 1n), value: `0x${amount.toString(16)}` };
assert.equal(G.txBlock(v3, COIN, ME, amount), null);
assert.match(G.txBlock({ ...v3, to: THEM }, COIN, ME, amount), /does not recognise/);
assert.match(G.txBlock({ ...v3, value: `0x${(amount * 2n).toString(16)}` }, COIN, ME, amount), /different amount/);
assert.match(G.txBlock(v3, THEM, ME, amount), /different coin/);
assert.match(G.txBlock({ ...v3, data: G.v3Swap(G.WETH, COIN, 10000, THEM, amount, 1n) }, COIN, ME, amount), /another wallet/);
console.log('PASS robinhood: the buy is checked against the page right before signing');

// The v4 swap's encoding: execute(commands, inputs, deadline), one V4_SWAP command, the coin and amount inside.
const data = G.v4Swap(G.ETH, [{ currency: COIN, fee: 75, tickSpacing: 1, hooks: G.ETH }], amount, 5n, 1800000000n);
assert.ok(data.startsWith('0x3593564c'));
assert.equal((data.length - 10) % 64, 0, 'whole words');
assert.ok(data.includes(COIN.slice(2)));
assert.ok(data.includes(amount.toString(16).padStart(64, '0')));
console.log('PASS robinhood: v4 swap encoding');

// Only Uniswap pools on this chain, deepest first; the name comes from the data, cleaned.
const pair = (labels, liq, extra = {}) => ({ chainId: 'robinhood', dexId: 'uniswap', labels, liquidity: { usd: liq }, baseToken: { address: COIN, name: 'Hmm<b>', symbol: '$HMM' }, quoteToken: { address: G.WETH }, ...extra });
const pools = G.poolsOf([pair(['v3'], 10), pair(['v4'], 99), pair(['v2'], 500), pair(['v3'], 50, { dexId: 'ramses' }), pair(['v3'], 70, { chainId: 'base' })], COIN);
assert.deepEqual([...pools].map((p) => p.liquidity.usd), [99, 10]);
const coin = G.coinFromPairs([pair(['v3'], 10)], COIN);
assert.equal(coin.symbol, 'HMM');
assert.equal(coin.name, 'Hmmb');
assert.equal(G.coinFromPairs([], COIN), null);
console.log('PASS robinhood: pools and the coin\'s name');

if (process.argv.includes('--live')) {
  const lookupPairs = async (a) => (await fetch(`https://api.dexscreener.com/tokens/v1/robinhood/${a}`)).json();
  const plan = await G.planBuy({ token: COIN, pairs: await lookupPairs(COIN), amountWei: amount, slippagePct: 10, lookupPairs });
  assert.ok(!plan.block, plan.block);
  assert.ok(plan.cost < 0.05, `HMM cost ${plan.cost}`);
  assert.ok(plan.roundTrip > 0.9, `HMM round trip ${plan.roundTrip}`);
  assert.equal(G.txBlock(plan.tx, COIN, '0x00000000000000000000000000000000000abc01', amount), null);
  console.log(`PASS robinhood live: $HMM costs ${(plan.cost * 100).toFixed(2)}%, round trip keeps ${(plan.roundTrip * 100).toFixed(2)}% (simulation only)`);
}
process.exit(0);
