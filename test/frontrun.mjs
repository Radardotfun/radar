// Offline: the Frontrun Trading API client, against a mocked fetch (no network, no real key, no trade).
// node test/frontrun.mjs
import assert from 'node:assert/strict';
import { listWallets, buy, buyBody, FRONTRUN_API, KEY_RE, LIMITS } from '../extension/src/lib/frontrun.js';

const KEY = `fr_sk_${'a'.repeat(64)}`; // a dummy, well-formed value; not a real key
const MINT = 'ARiZfq6dK19uNqxWyRudhbM2MswLyYhVUHdndGkffdGc';
const WALLET = '8tHRS3n2Aot1VBhLHenvoUrCycA7y5X7ZXHSgwcCAZyn';
const SIG = '5'.repeat(88);

const calls = [];
const mock = (status, body) => async (url, init) => {
  calls.push({ url, init });
  return { ok: status >= 200 && status < 300, status, json: async () => body };
};

assert.ok(KEY_RE.test(KEY));
assert.ok(!KEY_RE.test('fr_sk_short'));

// Wallets: lamports become SOL; non-Solana or inactive wallets are left out; the key goes in a Bearer header.
let w = await listWallets(KEY, { fetchImpl: mock(200, { status: true, data: [
  { address: WALLET, chain: 'SOLANA', name: 'main', status: 'ACTIVE', balance: 1_500_000_000 },
  { address: 'x', chain: 'BASE', status: 'ACTIVE', balance: 1 },
  { address: '9'.repeat(44), chain: 'SOLANA', status: 'DISABLED', balance: 5 },
] }) });
assert.deepEqual(w, [{ address: WALLET, name: 'main', sol: 1.5 }]);
assert.equal(calls[0].url, `${FRONTRUN_API}/wallets`);
assert.equal(calls[0].init.headers.authorization, `Bearer ${KEY}`);
assert.equal(calls[0].init.credentials, 'omit');

// The order body is exactly what the API expects.
assert.deepEqual(buyBody({ mint: MINT, sol: '0.25', slippageBps: 1000, wallet: WALLET }), {
  tokenMint: MINT, side: 'BUY', uiInputAmount: '0.25', slippageBasisPoint: 1000, walletAddress: WALLET, confirmationMode: 'SYNC', commitment: 'confirmed',
});
assert.equal(buyBody({ mint: MINT, sol: 1, slippageBps: 500 }).walletAddress, undefined, 'no wallet means Frontrun picks the first one');

// Guards: bad mint, too small, over the cap, bad slippage, bad wallet. Nothing is sent for any of them.
calls.length = 0;
const bad = [
  [{ mint: 'nope', sol: 0.1, slippageBps: 1000 }, /Not a Solana token/],
  [{ mint: MINT, sol: 0, slippageBps: 1000 }, /at least/],
  [{ mint: MINT, sol: 'abc', slippageBps: 1000 }, /at least/],
  [{ mint: MINT, sol: LIMITS.maxSol + 1, slippageBps: 1000 }, /caps one buy/],
  [{ mint: MINT, sol: 0.1, slippageBps: 0 }, /Slippage/],
  [{ mint: MINT, sol: 0.1, slippageBps: 9000 }, /Slippage/],
  [{ mint: MINT, sol: 0.1, slippageBps: 1000, wallet: 'zz' }, /wallet address/],
];
for (const [order, re] of bad) await assert.rejects(buy(KEY, order, { fetchImpl: mock(200, {}) }), re);
assert.equal(calls.length, 0, 'invalid orders never reach Frontrun');
await assert.rejects(buy('not-a-key', { mint: MINT, sol: 0.1, slippageBps: 1000 }, { fetchImpl: mock(200, {}) }), /No Frontrun API key/);

// A confirmed buy: POST /trade, signature passed through only when it is base58.
calls.length = 0;
let r = await buy(KEY, { mint: MINT, sol: '0.1', slippageBps: 1000, wallet: WALLET }, { fetchImpl: mock(200, { status: true, data: { signature: SIG, status: 'SUCCESS', confirmed: true } }) });
assert.deepEqual(r, { signature: SIG, confirmed: true, status: 'SUCCESS', wallet: WALLET });
assert.equal(calls[0].url, `${FRONTRUN_API}/trade`);
assert.equal(calls[0].init.method, 'POST');
assert.equal(JSON.parse(calls[0].init.body).side, 'BUY');
r = await buy(KEY, { mint: MINT, sol: '0.1', slippageBps: 1000 }, { fetchImpl: mock(200, { status: true, data: { signature: '<script>', confirmed: true } }) });
assert.equal(r.signature, null, 'a malformed signature is dropped');

// Errors read as actions; a 504 says to check before buying again.
const err = async (status, body) => buy(KEY, { mint: MINT, sol: 0.1, slippageBps: 1000 }, { fetchImpl: mock(status, body) }).then(() => null, (e) => e);
assert.match((await err(422, { status: false, code: 422, message: 'slippage exceeded' })).message, /Not enough SOL, or the price moved past your slippage: slippage exceeded/);
assert.match((await err(409, { status: false, code: 409, message: 'locked' })).message, /trade in flight/);
assert.match((await err(504, { status: false, code: 504, message: 'timeout' })).message, /Check Solscan before buying again$/);
assert.equal((await err(403, { status: false, code: 403 })).code, 403);
assert.match((await err(200, { status: false, code: 400, message: 'bad mint' })).message, /rejected the order: bad mint/);
const offline = await buy(KEY, { mint: MINT, sol: 0.1, slippageBps: 1000 }, { fetchImpl: async () => { throw new TypeError('fetch failed'); } }).catch((e) => e);
assert.match(offline.message, /Could not reach Frontrun/);

console.log('PASS frontrun client: wallets, order body, guards, buy, errors');
