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

// A wallet that already holds the coin, or WETH, is checked on what this buy changes, on a fake v3 pool
// (1e6 raw tokens per raw wei, 1% fee, taxes set per test).
{
  const POOL = '0x9999999999999999999999999999999999999999';
  const RATE = 1_000_000n;
  const word = (v) => BigInt(v).toString(16).padStart(64, '0');
  const args = (h) => h.replace(/^0x/, '').slice(8).match(/.{64}/g) || [];
  const chain = ({ sellTax = 0, tokens0 = 0n, weth0 = 0n }) => ({ fetchImpl: async (_url, init) => {
    const { method, params } = JSON.parse(init.body);
    let result;
    if (method === 'eth_call') {
      const { to, data } = params[0];
      if (to === POOL && data === '0xddca3f43') result = `0x${word(10000)}`;
      else if (to === POOL && data === '0x0dfe1681') result = `0x${G.WETH.slice(2).toLowerCase().padStart(64, '0')}`;
      else if (to === POOL && data === '0x3850c7bd') result = `0x${word((1n << 96n) * 1000n)}`;
      else throw new Error(`unexpected eth_call ${to} ${data.slice(0, 10)}`);
    } else if (method === 'eth_simulateV1') {
      const st = { token: tokens0, weth: weth0 };
      result = [{ calls: params[0].blockStateCalls[0].calls.map((c) => {
        const to = c.to.toLowerCase();
        const d = c.data.toLowerCase();
        if (to === G.SWAP_ROUTER && c.value) {
          const out = BigInt(c.value) * RATE * 99n / 100n;
          if (out < BigInt(`0x${args(d)[5]}`)) return { status: '0x0', returnData: '0x' };
          st.token += out; return { status: '0x1', returnData: '0x' };
        }
        if (to === G.SWAP_ROUTER) {
          const amt = BigInt(`0x${args(d)[4]}`);
          if (amt > st.token) return { status: '0x0', returnData: '0x' };
          st.token -= amt; st.weth += amt / RATE * 99n / 100n * BigInt(Math.round((1 - sellTax) * 1000)) / 1000n;
          return { status: '0x1', returnData: '0x' };
        }
        if (to === COIN && d.startsWith('0x70a08231')) return { status: '0x1', returnData: `0x${word(st.token)}` };
        if (to === G.WETH.toLowerCase() && d.startsWith('0x70a08231')) return { status: '0x1', returnData: `0x${word(st.weth)}` };
        return { status: '0x1', returnData: `0x${word(0)}` };
      }) }];
    } else throw new Error(`unexpected ${method}`);
    return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, result }) };
  } });
  const pools = [{ chainId: 'robinhood', dexId: 'uniswap', labels: ['v3'], liquidity: { usd: 50000 }, baseToken: { address: COIN }, quoteToken: { address: G.WETH }, pairAddress: POOL }];
  const amountWei = G.toWei(0.01);
  const plan = (opts) => G.planBuy({ token: COIN, pairs: pools, amountWei, wallet: ME, slippagePct: 10, lookupPairs: async () => [], opts });
  for (const weth0 of [0n, 5n * 10n ** 18n]) {
    const p = await plan(chain({ sellTax: 0.9, weth0 }));
    assert.match(String(p.block), /heavy tax/, `a 90% sell tax is stopped with ${weth0} WETH already held`);
  }
  const gets = amountWei * RATE * 99n / 100n;
  const p = await plan(chain({ tokens0: gets * 10n }));
  assert.ok(!p.block, p.block);
  assert.equal(p.tokens, gets, 'what this buy gets, not the whole balance');
  assert.ok(Math.abs(p.cost - 0.01) < 0.001, `cost ${p.cost}`);
  assert.equal(BigInt(`0x${args(p.tx.data)[5]}`), gets * 9000n / 10000n, 'the minimum out is 10% under what the buy gets');
  console.log('PASS robinhood: coins and WETH already in the wallet don\'t count as bought or sold');
}

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
