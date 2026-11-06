// Holder perks for anyone who has ever held $RADAR (server/everheld.js and holderForWallet), offline: a fake chain,
// fake prices and a small fake D1. node test/everheld.mjs
import assert from 'node:assert/strict';
import { ownersIn, everHeld, markHeld, radarMints, oldMints, oldCutoff, syncEverHeld } from '../server/everheld.js';
import { holderForWallet, holderConfig, readToken } from '../server/holder.js';

const NEW = 'BTmeAebSh8MaYsTDiBiix79htKckjYQP5fvucFoFpump';
const OLD = 'HyDSdtgiSa5mHqkTVoz8cTFTeVLFKdZ8amPvtNYfpump';
const LARP = 't9bnCGiZVUYsRKvx4d5dPcoDCSyuBM9C33ZNGNULARP';
// valid base58 (no 0, O, I or l), 44 characters
const W = (n) => `Wa11et${String(n).replace(/0/g, 'Z')}${'x'.repeat(44)}`.slice(0, 44);
const CUT = Date.parse('2026-11-06T19:52:30Z');
const now = CUT + 3 * 3600_000;

// D1, as far as everheld.js uses it.
function fakeDb() {
  const held = new Map(), cursor = new Map();
  const run = (sql, a) => {
    if (/^CREATE/.test(sql)) return null;
    if (/^INSERT OR IGNORE INTO ever_held/.test(sql)) { for (let i = 0; i < a.length; i += 3) { const k = `${a[i]} ${a[i + 1]}`; if (!held.has(k)) held.set(k, { wallet: a[i], mint: a[i + 1], at: a[i + 2] }); } return null; }
    if (/^INSERT OR REPLACE INTO ever_cursor/.test(sql)) { cursor.set(a[0], { sig: a[1], at: a[2] }); return null; }
    if (/^SELECT sig FROM ever_cursor/.test(sql)) return cursor.get(a[0]) || null;
    if (/^SELECT mint, at FROM ever_held/.test(sql)) {
      const [wallet, cur, ...rest] = a; const cut = rest.length ? rest[rest.length - 1] : null; const old = rest.slice(0, -1);
      const rows = [...held.values()].filter((r) => r.wallet === wallet && (r.mint === cur || (cut !== null && old.includes(r.mint) && r.at < cut)));
      return rows.sort((x, y) => x.at - y.at)[0] || null;
    }
    throw new Error('unexpected sql ' + sql);
  };
  return {
    held, cursor,
    prepare(sql) { const st = { sql, args: [], bind: (...a) => { st.args = a; return st; }, first: async () => run(sql, st.args), run: async () => { run(sql, st.args); return {}; } }; return st; },
    batch: async (list) => list.map((st) => run(st.sql, st.args)),
  };
}
const env = (db = fakeDb()) => ({ DB: db, HOLDER_SECRET: 'test-secret', RADAR_MINT: NEW, RADAR_OLD_MINTS: OLD, RADAR_OLD_CUTOFF: '2026-11-06T19:52:30Z', LARPCHECK_MINT: LARP, HOLDER_MIN_USD: '10' });

// ---- settings
const e0 = env();
assert.deepEqual(radarMints(e0), [NEW, OLD]);
assert.deepEqual(oldMints(e0), [OLD]);
assert.equal(oldCutoff(e0), CUT);
assert.deepEqual(oldMints({ ...e0, RADAR_OLD_MINTS: `${OLD}, ${NEW}, junk` }), [OLD], 'the current coin and junk are never "old"');

// ---- who a transaction shows holding
const tx = { blockTime: CUT / 1000 - 60, meta: {
  preTokenBalances: [{ mint: OLD, owner: W(1), uiTokenAmount: { amount: '5000' } }, { mint: OLD, owner: W(2), uiTokenAmount: { amount: '0' } }],
  postTokenBalances: [{ mint: OLD, owner: W(1), uiTokenAmount: { amount: '0' } }, { mint: OLD, owner: W(2), uiTokenAmount: { amount: '77' } }, { mint: LARP, owner: W(3), uiTokenAmount: { amount: '9' } }],
} };
assert.deepEqual(ownersIn(tx, [OLD]).sort(), [[W(1), OLD], [W(2), OLD]], 'a seller (held before) and a buyer (holds after); other coins ignored');
assert.deepEqual(ownersIn({ meta: { postTokenBalances: [{ mint: OLD, owner: W(4), uiTokenAmount: { amount: '0' } }] } }, [OLD]), [], 'a zero balance is not holding');
assert.deepEqual(ownersIn(null, [OLD]), []);

// ---- the record, with the cutoff for the old coin
{
  const e = env();
  await markHeld(e, [[W(10), OLD, CUT - 1000], [W(11), OLD, CUT + 1000], [W(12), NEW, CUT + 5000], ['not-an-address', NEW, 1]]);
  assert.equal(e.DB.held.size, 3, 'bad addresses are not stored');
  assert.equal((await everHeld(e, W(10)))?.mint, OLD, 'held the old coin before the relaunch: in');
  assert.equal(await everHeld(e, W(11)), null, 'bought the old coin after the relaunch: not in');
  assert.equal((await everHeld(e, W(12)))?.mint, NEW, 'held the new coin: in');
  assert.equal(await everHeld(e, W(13)), null);
  assert.equal(await everHeld({ ...e, RADAR_OLD_CUTOFF: '' }, W(10)), null, 'no cutoff set: old coins count for nothing');
}

// ---- the holder check
let prices = { [NEW]: 0.00001, [LARP]: 0.0001 };
let chain = {};   // `${wallet} ${mint}` -> { balance, accounts } ; 'down' to fail
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith('https://lite-api.jup.ag/price/v3')) {
    if (prices === 'down') return new Response('{}', { status: 500 });
    return Response.json(Object.fromEntries(Object.entries(prices).map(([m, p]) => [m, { usdPrice: p }])));
  }
  if (u === 'https://rpc.test/') {
    const { method, params } = JSON.parse(init.body);
    if (method === 'getTokenAccountsByOwner') {
      const h = chain[`${params[0]} ${params[1].mint}`];
      if (h === 'down') return new Response('{}', { status: 500 });
      const accounts = h?.accounts ?? (h ? 1 : 0);
      return Response.json({ result: { value: Array.from({ length: accounts }, (_, i) => ({ account: { data: { parsed: { info: { tokenAmount: { uiAmount: i === 0 ? h.balance : 0 } } } } } })) } });
    }
    if (method === 'getSignaturesForAddress') return Response.json({ result: sigs.slice().reverse() });
    if (method === 'getTransaction') return Response.json({ result: txs[params[0]] ?? null });
  }
  throw new Error('unexpected fetch ' + u);
};
const RPC = 'https://rpc.test/';
let sigs = [], txs = {};

{
  const e = env();
  // A holder over the line, as before.
  chain = { [`${W(20)} ${NEW}`]: { balance: 2_000_000 } };   // $20
  let r = await holderForWallet(W(20), e, RPC, now);
  assert.equal(r.body.holder, true); assert.ok(!r.body.ever, 'a plain holder is not an "ever" pass');
  assert.equal(await readToken(e, r.body.token, now), W(20));

  // Under the line with nothing on record and no account: out, as before.
  chain = {};
  r = await holderForWallet(W(21), e, RPC, now);
  assert.equal(r.body.holder, false);
  assert.equal(r.body.token, undefined);

  // Held the old coin before the relaunch, holds nothing now: in, with a token.
  await markHeld(e, [[W(22), OLD, CUT - 3600_000]]);
  r = await holderForWallet(W(22), e, RPC, now);
  assert.equal(r.body.holder, true); assert.equal(r.body.ever, true); assert.equal(r.body.held, OLD); assert.equal(r.body.value, 0);
  assert.equal(await readToken(e, r.body.token, now), W(22));

  // Bought the old coin after the relaunch only: out.
  await markHeld(e, [[W(23), OLD, CUT + 60_000]]);
  r = await holderForWallet(W(23), e, RPC, now);
  assert.equal(r.body.holder, false, 'the dead coin bought today unlocks nothing');

  // Holds a little of the new coin (under the line): its token account is proof it has held it. In, and now on record.
  chain = { [`${W(24)} ${NEW}`]: { balance: 50 } };
  r = await holderForWallet(W(24), e, RPC, now);
  assert.equal(r.body.holder, true); assert.equal(r.body.ever, true);
  assert.equal((await everHeld(e, W(24)))?.mint, NEW, 'recorded, so selling everything later keeps the perks');
  chain = {};
  r = await holderForWallet(W(24), e, RPC, now + 86400_000);
  assert.equal(r.body.holder, true, 'still in after selling and closing the account');

  // An empty token account for the new coin (sold, account kept open): in.
  chain = { [`${W(25)} ${NEW}`]: { balance: 0, accounts: 1 } };
  assert.equal((await holderForWallet(W(25), e, RPC, now)).body.holder, true);

  // Prices down: someone on record still gets in; anyone else is told to try again.
  prices = 'down';
  assert.equal((await holderForWallet(W(22), e, RPC, now)).body.holder, true);
  assert.equal((await holderForWallet(W(26), e, RPC, now)).status, 502);
  prices = { [NEW]: 0.00001, [LARP]: 0.0001 };

  // A chain read that fails for someone not on record: busy, not a "no".
  chain = { [`${W(27)} ${NEW}`]: 'down' };
  assert.equal((await holderForWallet(W(27), e, RPC, now)).status, 502);

  // $LARPCHECK holders still need the amount: a dust bag of it is not enough.
  chain = { [`${W(28)} ${LARP}`]: { balance: 10 } };
  assert.equal((await holderForWallet(W(28), e, RPC, now)).body.holder, false);
}

// ---- the cron: picks up new transactions of the current coin, oldest first, a few per run, and remembers where it got to
{
  const e = env();
  sigs = Array.from({ length: 5 }, (_, i) => ({ signature: `sig${i}`, blockTime: (CUT + i * 60_000) / 1000, err: i === 2 ? { x: 1 } : null }));
  txs = Object.fromEntries(sigs.map((s, i) => [s.signature, { blockTime: s.blockTime, meta: { postTokenBalances: [{ mint: NEW, owner: W(40 + i), uiTokenAmount: { amount: '100' } }] } }]));
  let r = await syncEverHeld(e, RPC, { perMint: 3 });
  assert.deepEqual(r[NEW], { read: 4, wallets: 3, left: 1 }, 'a failed transaction is skipped and does not use up the budget');
  assert.equal(e.DB.cursor.get(NEW).sig, 'sig3');
  assert.equal((await everHeld(e, W(40)))?.mint, NEW);
  assert.equal(await everHeld(e, W(42)), null, 'nobody from the failed one');
  // The fake chain ignores `until`, so hand it only what's newer than the cursor, as the real one does.
  sigs = sigs.slice(4);
  r = await syncEverHeld(e, RPC, { perMint: 3 });
  assert.deepEqual(r[NEW], { read: 1, wallets: 1, left: 0 });
  assert.equal(e.DB.cursor.get(NEW).sig, 'sig4');
  assert.equal((await everHeld(e, W(44)))?.mint, NEW);
}

// ---- the panel's pitch says so
assert.match((await holderConfig(env())).pitch, /have held \$RADAR at any point/);

console.log('everheld: all checks passed');
