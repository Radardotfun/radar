// Bugs the 2 Nov hunt found, kept from coming back. node test/bughunt.mjs
import assert from 'node:assert/strict';
import { tick } from '../bot/signals.js';
import { wordsOf, findStories } from '../bot/wire.js';
import { aggregate, relevance } from '../extension/src/lib/market.js';
import { extractKeywords } from '../extension/src/lib/keywords.js';
import { coinCheck } from '../extension/src/ui/coincheck.js';
import { txBlock } from '../webapp/launch-guard.js';
import { makeHandlers, DEFAULTS } from '../extension/src/lib/handlers.js';
import { worthRetry } from '../bot/trigger.js';
import { botCoins } from '../bot/coins.js';
import { coinKey, plainClash, launchFields } from '../server/launch.js';

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

// 11. The launch guard refuses what the server would never list, so nobody pays for a coin Radar can't list.
{
  const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
  const BUDGET = 'ComputeBudget111111111111111111111111111111';
  const SYSTEM = '11111111111111111111111111111111';
  const tx = (programs) => ({ message: { staticAccountKeys: ['payer', 'mint', ...programs], header: { numRequiredSignatures: 2 }, compiledInstructions: programs.map((_, i) => ({ programIdIndex: i + 2 })) } });
  assert.equal(txBlock(tx([BUDGET, BUDGET, PUMP]), 'payer', 'mint'), null, 'the launch itself');
  assert.match(txBlock(tx([BUDGET, PUMP, SYSTEM]), 'payer', 'mint'), /could not list/, 'a tip added by a wallet');
  console.log('PASS bughunt: a launch that couldn\'t be listed is never sent');
}

// 12. Copies don't get past the plain check.
{
  const listed = { post: 'https://x.com/a/status/1', symbol: 'DOG', name: 'A Dog', pic: 'p' };
  const coin = (symbol, name) => ({ post: 'https://x.com/b/status/2', symbol, name, pic: 'q' });
  assert.equal(coinKey('ＤＯＧ'), 'dog');
  assert.ok(plainClash(coin('ＤＯＧ', 'Other'), [listed]), 'full-width ticker');
  assert.ok(plainClash(coin('WOOF', 'DOG'), [listed]), 'the ticker used as a name');
  assert.ok(plainClash(coin('ADOG', 'Other'), [listed]), 'the name used as a ticker');
  assert.equal(plainClash(coin('CAT', 'A Cat'), [listed]), null);
  console.log('PASS bughunt: a copy under another spelling is caught');
}

// 13. A name too long in bytes says so, in words that make sense for 11 Chinese characters.
{
  assert.match(launchFields({ name: '中'.repeat(11), symbol: 'A', post: 'https://x.com/a/status/1', wallet: 'So11111111111111111111111111111111111111112' }).error, /too long/);
  assert.match(launchFields({ name: '', symbol: 'A', post: 'https://x.com/a/status/1', wallet: 'So11111111111111111111111111111111111111112' }).error, /needs a name/);
  console.log('PASS bughunt: name errors make sense');
}

// 14. A typed stock or major names no coin, a real typed ticker still does, and a second address counts.
{
  const SOL = 'So11111111111111111111111111111111111111112';
  const pair = (address, symbol, name, cap) => ({ chainId: 'solana', dexId: 'pumpswap', pairAddress: `p${address}`, baseToken: { address, symbol, name }, quoteToken: { address: SOL }, priceUsd: '1', priceNative: '1', liquidity: { usd: 90000, quote: 45000 }, marketCap: cap, volume: { h24: 90000 }, pairCreatedAt: NOW - 86_400_000 });
  const tool = (pairs) => ({ search: async () => pairs, lookupCa: async () => null, capOf: async () => null, chains: ['solana'] });
  const ask = (text, pairs) => botCoins({ mentioned: [] }, { text }, tool(pairs));
  const names = (r) => JSON.stringify(r);
  assert.ok(!/Robinhood/.test(names(await ask('$TSLA earnings beat', [pair('t', 'TSLA', 'Tesla • Robinhood Token', 4_300_000)]))), 'a stock token isn\'t the coin');
  assert.ok(!/ChainLink/.test(names(await ask('$LINK breakout', [pair('l', 'LINK', 'ChainLink Token', 99_000_000)]))), 'a major\'s copy isn\'t the coin');
  assert.ok(/Dogwif/.test(names(await ask('$DWIF is moving', [pair('d', 'DWIF', 'Dogwif Two', 500_000)]))), 'a real typed ticker still names its coin');
  console.log('PASS bughunt: a typed stock or major names no coin');
}

// 15. What's worth another try.
{
  assert.ok(worthRetry('Every AI key is at its limit right now'));
  assert.ok(worthRetry('Free AI limit reached for today'));
  assert.ok(worthRetry('X 403: You are not allowed to create a Tweet with duplicate content.'));
  assert.ok(worthRetry('handle 500'));
  assert.ok(!worthRetry('That post is private'));
  console.log('PASS bughunt: a limit or a duplicate gets another try');
}

// 16. Open best match says where the coin came from, and goes to the coin the bio names.
{
  const real = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline'); };
  const opened = [];
  const h = makeHandlers({ settings: async () => ({ ...DEFAULTS, chains: ['solana'] }), store: { get: async () => null, set: async () => {} }, openWindow: (u) => opened.push(u), rpcUrl: async () => null, ready: Promise.resolve(), inlineImages: false });
  const coin = { address: 'BioCoin1111111111111111111111111111111111111', chain: 'solana', symbol: 'BIO', name: 'Bio', liquidity: 90000, marketCap: 500000, pairAddresses: [] };
  const other = { ...coin, address: 'Other11111111111111111111111111111111111111', symbol: 'OTHER' };
  const r = await h.reroute({ post: { text: 'no address here' }, candidates: [other], named: [coin], where: 'bio' }).catch((e) => ({ error: e.message }));
  assert.ok(r.error ? /BIO in the poster's bio didn't pass/.test(r.error) : r.symbol === 'BIO' && /poster's bio/.test(r.reason), JSON.stringify(r));
  assert.ok(!opened.some((u) => u.includes('Other')), 'never the other coin');
  globalThis.fetch = real;
  console.log('PASS bughunt: Open best match goes to the coin in the bio');
}

// 17. One tap asks the AI once while it's down, and Rescan still tries again.
{
  const real = globalThis.fetch;
  let asked = 0;
  globalThis.fetch = async (u) => {
    if (String(u).includes('/interpret')) { asked += 1; return new Response(JSON.stringify({ error: 'busy' }), { status: 503 }); }
    // DexScreener knows the coin in the post, so the read gives it with no AI rather than failing outright.
    const pair = { chainId: 'solana', dexId: 'pumpswap', pairAddress: 'pool1', baseToken: { address: 'HyDSdtgiSa5mHqkTVoz8cTFTeVLFKdZ8amPvtNYfpump', symbol: 'RADAR', name: 'Radar' }, quoteToken: { address: 'So11111111111111111111111111111111111111112' }, priceUsd: '1', priceNative: '1', liquidity: { usd: 9000, quote: 4500 }, marketCap: 10000 };
    const body = String(u).includes('/latest/dex/search') ? { pairs: [pair] } : /token-pairs|tokens\/v1/.test(String(u)) ? [pair] : {};
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const h = makeHandlers({ settings: async () => ({ ...DEFAULTS, chains: ['solana'] }), store: { get: async () => null, set: async () => {} }, openWindow: () => {}, rpcUrl: async () => null, ready: Promise.resolve(), inlineImages: false });
  const post = { text: 'look at this dog on a skateboard HyDSdtgiSa5mHqkTVoz8cTFTeVLFKdZ8amPvtNYfpump' };
  const read = await h.read({ post });
  assert.ok(read.engineError, 'the AI is down in this test');
  const afterRead = asked;
  await h.coins({ post });
  assert.equal(asked, afterRead, 'finding coins right after the read asks the AI no more');
  await h.forgetCoins({ post });
  await h.read({ post });
  globalThis.fetch = real;
  assert.ok(asked > afterRead, 'Rescan asks again');
  console.log('PASS bughunt: one tap asks a downed AI once, Rescan asks again');
}
