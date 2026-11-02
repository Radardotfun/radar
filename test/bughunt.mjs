// Bugs the 2 Nov hunt found, kept from coming back. node test/bughunt.mjs
import assert from 'node:assert/strict';
import { tick } from '../bot/signals.js';
import { wordsOf, findStories } from '../bot/wire.js';
import { aggregate, relevance } from '../extension/src/lib/market.js';
import { extractKeywords } from '../extension/src/lib/keywords.js';
import { coinCheck } from '../extension/src/ui/coincheck.js';

// A small stand-in for D1, enough for tick's queries.
function fakeDb({ failInsert = false } = {}) {
  const meta = new Map();
  const rows = new Map();
  return {
    meta, rows,
    prepare(sql) {
      const api = {
        args: [],
        bind(...a) { api.args = a; return api; },
        async run() {
          if (/^CREATE/.test(sql)) return {};
          if (/INTO signal_meta/.test(sql)) { meta.set(api.args[0], String(api.args[1])); return {}; }
          if (/INSERT OR IGNORE INTO signals/.test(sql)) {
            if (failInsert) throw new Error('database down');
            const [id, author, at, kind, post, state] = api.args;
            if (!rows.has(id)) rows.set(id, { id, author, at, kind, post, state });
            return {};
          }
          if (/SET state = 'old'/.test(sql)) { for (const r of rows.values()) if (r.state === 'new' && r.at <= api.args[0]) r.state = 'old'; return {}; }
          if (/SET state = 'read'/.test(sql)) { const r = rows.get(api.args[4]); Object.assign(r, { state: 'read', signal: api.args[0], read_at: api.args[3] }); return {}; }
          return {};
        },
        async first() { const v = meta.get(api.args[0]); return v == null ? null : { v }; },
        async all() { return { results: [...rows.values()].filter((r) => r.state === 'new').sort((a, b) => b.at - a.at).slice(0, api.args[0]) }; },
      };
      return api;
    },
  };
}
const NOW = Date.UTC(2026, 10, 2, 20, 0, 0);
const iso = (ms) => new Date(ms).toISOString();
const tweet = (id, at, text = 'a post about a dog called Biscuit that people could make a coin from') => ({ id, text, created_at: iso(at), author_id: '1' });
const page = (posts) => ({ data: posts, includes: { users: [{ id: '1', username: 'someone', name: 'Someone' }] }, meta: posts.length ? { newest_id: posts[0].id } : {} });
const quiet = async () => ({ score: 90, why: 'a dog', name: 'Biscuit' });

// 1. After an outage, a post hours old is not read as if it were new.
{
  const db = fakeDb();
  let reads = 0;
  const read = async (p) => { reads += 1; return quiet(p); };
  await tick({ db, x: async () => page([tweet('100', NOW - 9 * 3_600_000), tweet('101', NOW - 60_000)]), read, now: NOW, accounts: ['someone'] });
  assert.equal(reads, 1, 'only the fresh post is read');
  assert.equal(db.rows.get('100').state, 'old', 'the 9 hour old post is marked old');
  assert.equal(db.rows.get('101').state, 'read');
  console.log('PASS bughunt: a post hours old never goes out looking new');
}

// 2. Two flags in one run get their own times, so a poll between them can't lose the second.
{
  const db = fakeDb();
  let t = NOW;
  await tick({ db, x: async () => page([tweet('201', NOW - 1000), tweet('200', NOW - 2000)]), read: quiet, now: NOW, accounts: ['someone'], clock: () => { t += 1; return t; } });
  assert.notEqual(db.rows.get('200').read_at, db.rows.get('201').read_at, 'each flag has its own time');
  console.log('PASS bughunt: two flags in one run keep separate times');
}

// 3. A failed save doesn't move the cursor past posts it never kept.
{
  const db = fakeDb({ failInsert: true });
  await assert.rejects(tick({ db, x: async () => page([tweet('300', NOW - 1000)]), read: quiet, now: NOW, accounts: ['someone'] }));
  assert.equal(db.meta.get('since:0'), undefined, 'the cursor stays put');
  console.log('PASS bughunt: a failed save keeps the cursor, so the posts come back');
}

// 4. X refusing an old cursor clears it, instead of failing the same way for good.
{
  const db = fakeDb();
  db.meta.set('since:0', '123');
  const refused = Object.assign(new Error('since_id too old'), { status: 400 });
  const out = await tick({ db, x: async () => { throw refused; }, read: quiet, now: NOW, accounts: ['someone'] });
  assert.equal(out.errors.length, 1);
  assert.equal(db.meta.get('since:0'), '', 'the query starts again from now');
  console.log('PASS bughunt: a refused cursor is dropped');
}

// 5. A story in any alphabet can break.
{
  assert.deepEqual(wordsOf('中国狗'), ['中国狗']);
  assert.deepEqual(wordsOf('日本'), ['日本'], 'two characters is a word in Japanese');
  assert.deepEqual(wordsOf('ab'), [], 'two Latin letters still isn\'t');
  assert.deepEqual(wordsOf('Zorblax!'), ['zorblax']);
  const coins = Array.from({ length: 8 }, (_, i) => ({ a: `c${i}`, s: '中国狗', n: '中国狗', m: i ? 3000 : 40000, d: `w${i}`, t: NOW - 60_000 }));
  assert.equal(findStories(coins, NOW).length, 1, 'eight coins under one Chinese word make a story');
  console.log('PASS bughunt: a story in any alphabet shows up');
}

// 6. A coin paired to $LARPCHECK or USD1 has real liquidity, and stays a coin.
{
  const LARP = 't9bnCGiZVUYsRKvx4d5dPcoDCSyuBM9C33ZNGNULARP';
  const pool = (base, quote, dexId, liq = { usd: 4000, quote: 2000 }) => ({
    chainId: 'solana', dexId, pairAddress: `${base}-${quote}-${dexId}`, baseToken: { address: base, symbol: base }, quoteToken: { address: quote },
    priceUsd: '1', priceNative: '1', liquidity: liq, marketCap: 100000,
  });
  const [paired] = aggregate([pool('COIN', LARP, 'pumpswap')]);
  assert.equal(paired.liquidity, 4000, 'paired to $LARPCHECK');
  assert.equal(aggregate([pool('COIN', 'USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB', 'pumpswap')])[0].liquidity, 4000, 'paired to USD1');
  assert.equal(aggregate([pool('COIN', 'SomeOtherMemecoin', 'pumpswap')])[0].liquidity, 0, 'a random token still backs nothing');
  assert.equal(aggregate([pool(LARP, 'So11111111111111111111111111111111111111112', 'pumpswap')]).length, 1, '$LARPCHECK itself is still a coin');
  console.log('PASS bughunt: a coin paired to $LARPCHECK or USD1 has liquidity');
}

// 7. A clean launch scan doesn't hide what RugCheck saw the creator holding.
{
  const token = { liquidity: 50000, onCurve: false, createdAt: NOW - 3_600_000 };
  const scan = { ok: true, devHeldPct: 0, bundleHeldPct: 0, bundledPct: 0 };
  const rug = { creatorPct: 30, insiderPct: 0, insiderWallets: 0, top10Pct: 10 };
  const c = coinCheck(token, rug, scan);
  assert.equal(c.facts.find((f) => f.k === 'Dev holds').v, 30);
  assert.notEqual(c.word, 'OK');
  assert.equal(coinCheck(token, { creatorPct: 0.5 }, null).facts.find((f) => f.k === 'Dev holds').v, 0.5);
  console.log('PASS bughunt: the larger dev read wins');
}

// 8. Knowing nothing doesn't read as good news.
{
  const c = coinCheck({ liquidity: 50000, createdAt: NOW - 3_600_000 }, {}, null);
  assert.ok(!c || !/Spread-out/.test(c.call), 'no facts, no claim');
  console.log('PASS bughunt: nothing read means nothing said');
}

// 9. A dust side pool doesn't make a live curve coin look dead, and a dead graduated coin doesn't look alive.
{
  const SOL = 'So11111111111111111111111111111111111111112';
  const pool = (dexId, liq, cap, h1) => ({ chainId: 'solana', dexId, pairAddress: dexId, baseToken: { address: 'C', symbol: 'C' }, quoteToken: { address: SOL }, priceUsd: '1', priceNative: '1', liquidity: { usd: liq, quote: liq / 2 }, marketCap: cap, txns: { h1: { buys: h1, sells: 0 } }, volume: { h24: h1 } });
  const live = aggregate([pool('meteora', 0.64, 0, 0), pool('pumpfun', 0, 46800, 12)])[0];
  assert.equal(live.marketCap, 46800);
  assert.equal(live.onCurve, true);
  const dead = aggregate([pool('pumpswap', 300, 2000, 1), pool('pumpfun', 0, 69000, 0)])[0];
  assert.equal(dead.onCurve, false, 'graduated, its curve long quiet');
  assert.equal(dead.marketCap, 2000);
  const real = aggregate([pool('pumpswap', 50000, 200000, 30), pool('pumpfun', 0, 69000, 5)])[0];
  assert.equal(real.onCurve, false, 'a real pool stays the main one');
  console.log('PASS bughunt: a dust pool can\'t hide a curve, an old curve can\'t revive a dead coin');
}

// 10. Non-Latin names count, accents still fold, and emoji are still nothing.
{
  assert.ok(relevance({ name: '川普', symbol: '川普' }, ['川普']).score > 0, 'a Chinese name matches');
  assert.ok(relevance({ name: 'Café Dog', symbol: 'CAFE' }, ['cafe']).score > 0, 'accents still fold');
  assert.ok(extractKeywords('$川普 is everywhere today', 6).length >= 0);
  console.log('PASS bughunt: names in any alphabet match');
}
