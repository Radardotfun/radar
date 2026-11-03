// Diamond Hand (bot/diamond.js): a watched wallet buying a coin launched in the last 6 hours becomes a holder alert, and
// nothing else does. Real SQLite stands in for D1; the chain and DexScreener are stubbed. node test/diamond.mjs
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { tick, boughtMints, NEW_MS } from '../bot/diamond.js';
import { signalFeed } from '../server/signals.js';
import list from '../bot/diamond-wallets.json' with { type: 'json' };

const sql = new DatabaseSync(':memory:');
sql.exec("CREATE TABLE signals (id TEXT PRIMARY KEY, author TEXT, at INTEGER, kind TEXT, post TEXT, state TEXT, signal INTEGER, narrative TEXT, terms TEXT, read_at INTEGER); CREATE TABLE signal_meta (k TEXT PRIMARY KEY, v TEXT)");
const db = {
  prepare(q) {
    let args = [];
    const api = {
      bind(...a) { args = a; return api; },
      async first() { return sql.prepare(q).get(...args) ?? null; },
      async run() { const r = sql.prepare(q).run(...args); return { meta: { changes: r.changes } }; },
      async all() { return { results: sql.prepare(q).all(...args) }; },
    };
    return api;
  },
};

const W = list.wallets[0].wallet;
const NEWC = 'NewCoin1111111111111111111111111111111pump';
const OLDC = 'OldCoin1111111111111111111111111111111pump';
const now = Date.parse('2026-11-03T19:00:00Z');
const buyTx = (mint, sol = 0.5) => ({
  meta: { err: null, preBalances: [10e9, 0], postBalances: [10e9 - sol * 1e9, 0],
    preTokenBalances: [], postTokenBalances: [{ owner: W, mint, uiTokenAmount: { amount: '1000' } }] },
  transaction: { message: { accountKeys: [{ pubkey: W }, { pubkey: 'Pool111' }] } },
});

// What a buy is.
assert.deepEqual(boughtMints(buyTx(NEWC), W), [NEWC]);
assert.deepEqual(boughtMints(buyTx(NEWC, 0.001), W), [], 'dust SOL is not a buy');
assert.deepEqual(boughtMints({ ...buyTx(NEWC), meta: { ...buyTx(NEWC).meta, err: { x: 1 } } }, W), [], 'a failed transaction');
const sell = buyTx(NEWC); sell.meta.preTokenBalances = [{ owner: W, mint: NEWC, uiTokenAmount: { amount: '5000' } }];
assert.deepEqual(boughtMints(sell, W), [], 'the balance went down: a sell');
assert.deepEqual(boughtMints(buyTx('So11111111111111111111111111111111111111112'), W), [], 'wrapped SOL is no coin');
console.log('PASS diamond: only a SOL-paid balance increase counts as a buy');

// The watch: the first look only notes the wallet's place; then a new-coin buy is an alert and an old-coin buy isn't.
let sigs = [{ signature: 'S1', blockTime: now / 1000 - 600 }];
const txs = { S2: buyTx(NEWC), S3: buyTx(OLDC) };
const rpc = async (method, params) => (method === 'getSignaturesForAddress' ? (params[0] === W ? sigs : []) : txs[params[0]]);
const launchOf = async (mint) => (mint === NEWC ? { launched: now - 12 * 60_000, symbol: 'NEWC' } : { launched: now - NEW_MS - 60_000, symbol: 'OLDC' });
let out = await tick({ db, rpc, launchOf, now });
assert.equal(out.alerts, 0, 'nothing old comes up on the first look');
assert.equal(sql.prepare('SELECT COUNT(*) n FROM diamond_wallets').get().n, list.wallets.length);
sigs = [{ signature: 'S3', blockTime: now / 1000 - 20 }, { signature: 'S2', blockTime: now / 1000 - 30 }, ...sigs];
// Every wallet gets its turn before this one comes round again.
for (let i = 0; i < Math.ceil(list.wallets.length / 10) && !out.alerts; i++) out = await tick({ db, rpc, launchOf, now: now + (i + 1) * 60_000 });
const rows = sql.prepare("SELECT * FROM signals WHERE kind = 'diamond'").all();
assert.equal(rows.length, 1, 'one alert: the coin launched 12 minutes ago, not the old one');
assert.match(rows[0].narrative, new RegExp(`^100: Diamond Hand: a wallet that bought \\$${list.wallets[0].symbol} in its first hour and still holds it just bought \\$NEWC, launched \\d+m ago\\.$`));
assert.match(JSON.parse(rows[0].post).text, new RegExp(NEWC));
out = await tick({ db, rpc, launchOf, now: now + 10 * 60_000 });
assert.equal(sql.prepare("SELECT COUNT(*) n FROM signals WHERE kind = 'diamond'").get().n, 1, 'never twice');
console.log('PASS diamond: a watched wallet buying a coin launched in the last 6 hours is an alert, once');

// Holders get it; the public, delayed list doesn't.
const env = { DB: db, HOLDER_SECRET: '' };
const pub = await signalFeed({ public: true }, env, { now: now + 30 * 60_000, cache: null });
assert.equal(pub.body.items.filter((i) => i.kind === 'diamond').length, 0, 'not on the public list');
console.log('PASS diamond: holders only');
// The wallets people type in: only Solana addresses, and the look the extension runs on them is the same one.
{
  const { isWalletAddress, lookAt } = await import('../extension/src/lib/diamond.js');
  assert.equal(isWalletAddress(W), true);
  assert.equal(isWalletAddress(' 0x1234567890abcdef1234567890abcdef12345678 '), false, 'an EVM address');
  assert.equal(isWalletAddress('hello'), false);
  let s2 = [{ signature: 'A1' }];
  const r2 = async (m) => (m === 'getSignaturesForAddress' ? s2 : buyTx(NEWC));
  const first = await lookAt(W, null, { rpc: r2, launchOf, now });
  assert.deepEqual(first, { last: 'A1', buys: [] }, 'the first look only notes the place');
  s2 = [{ signature: 'A2', blockTime: now / 1000 }, ...s2];
  const next = await lookAt(W, 'A1', { rpc: r2, launchOf, now });
  assert.equal(next.last, 'A2');
  assert.deepEqual(next.buys.map((b) => b.symbol), ['NEWC']);
  console.log('PASS diamond: your own wallets get the same look');
}
process.exit(0);
