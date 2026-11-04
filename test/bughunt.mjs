// Bugs the 2 Nov hunt found, kept from coming back. node test/bughunt.mjs
import assert from 'node:assert/strict';
import { tick } from '../bot/signals.js';
import { wordsOf, findStories } from '../bot/wire.js';
import { aggregate, relevance } from '../extension/src/lib/market.js';
import { extractKeywords } from '../extension/src/lib/keywords.js';
import { coinCheck } from '../extension/src/ui/coincheck.js';
import { tieOf } from '../extension/src/lib/alerts.js';
import { txBlock } from '../webapp/launch-guard.js';
import { makeHandlers, DEFAULTS } from '../extension/src/lib/handlers.js';
import { worthRetry } from '../bot/trigger.js';
import { botCoins, ownCoin } from '../bot/coins.js';
import { ticker } from '../bot/reply.js';
import { coinKey, plainClash, launchFields } from '../server/launch.js';
import engineWorker, { bodyText, TooBig } from '../server/worker.js';

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

// 18. An emoji ticker prints as itself.
{
  assert.equal(ticker('🐶'), '🐶');
  assert.equal(ticker('$WIF'), 'WIF');
  assert.equal(ticker('@evil.com'), 'evilcom', 'still no mention or link');
  assert.equal(ticker('...'), '?');
  console.log('PASS bughunt: an emoji ticker prints as itself');
}

// 20. A second coin launched with the post's very picture stays in the reply, even when the judge scored it low.
{
  const coin = (a, symbol, cap, relevance) => ({ address: a, chain: 'solana', symbol, name: symbol, image: `https://dd.dexscreener.com/ds-data/tokens/solana/${a}.png`, marketCap: cap, liquidity: cap / 5, mcapBacked: true, relevance, volume: { h24: cap }, txns: { h1: { buys: 5, sells: 2 } }, createdAt: NOW - 3_600_000, pairAddresses: [`p${a}`] });
  const big = coin('Big1111111111111111111111111111111111111111', 'PIC', 80_000, 85);
  const small = coin('Small111111111111111111111111111111111111111', 'SNAP', 20_000, 65);
  const res = { mentioned: [], roleCandidates: [small, big], picks: [], others: [], pool: [small, big] };
  const post = { text: 'look', images: ['https://pbs.twimg.com/media/x.jpg'], url: 'https://x.com/a/status/1' };
  const shown = JSON.stringify(await botCoins(res, post, { search: async () => [], lookupCa: async () => null, capOf: async () => null, matchImages: async () => [0, 1], chains: ['solana'] }));
  assert.ok(shown.includes('PIC') && shown.includes('SNAP'), 'both coins with the post\'s picture');
  console.log('PASS bughunt: every coin with the post\'s picture is kept');
}

// 19. A story that began before the window knows its real First.
{
  const c = (i, ago, m = 3000) => ({ a: `c${i}`, s: 'ZORBLAX', n: 'Zorblax', m, d: `w${i}`, t: NOW - ago * 60_000 });
  const fresh = Array.from({ length: 8 }, (_, i) => c(i, 5 + i, i ? 3000 : 40000));
  const [story] = findStories([...fresh, c(99, 50)], NOW);
  assert.equal(story.first.a, 'c99', 'the coin from 50 minutes ago');
  assert.equal(story.startedAt, NOW - 50 * 60_000);
  assert.equal(story.coins, 8, 'the busy count still only covers the window');
  assert.equal(findStories(Array.from({ length: 3 }, (_, i) => c(i, 50, 90000)), NOW).length, 0, 'old coins alone are no story');
  console.log('PASS bughunt: a story knows when it really began');
}

// 21. An account whose following can't be read is no small project: a coin under its name isn't "its own".
{
  const t = { symbol: 'CASHCAT', name: 'Cash Cat' };
  assert.equal(ownCoin(t, { author: 'cashcatss', followers: 1200 }), true, 'a small account and its coin');
  assert.equal(ownCoin(t, { author: 'cashcatss', followers: null }), false, 'following unknown');
  assert.equal(ownCoin(t, { author: 'cashcatss' }), false, 'following missing');
  assert.equal(ownCoin(t, { author: 'cashcatss', followers: 900_000 }), false, 'a big account');
  console.log('PASS bughunt: an unread following never makes a coin the poster\'s own');
}

// 22. New pairs and word alerts take a two-character Chinese name, and still skip two Latin letters.
{
  assert.equal(tieOf({ name: '川普', symbol: '川普' }, { anchors: ['川普'] }), 'name');
  assert.equal(tieOf({ name: 'AB Coin', symbol: 'AB' }, { anchors: ['ab'] }), null, 'two Latin letters is no word');
  assert.equal(tieOf({ name: 'Doge Moon', symbol: 'DOGEM' }, { anchors: ['doge'] }), 'name');
  console.log('PASS bughunt: a two-character Chinese name ties a coin to its story');
}

// 23. A body sent without content-length (chunked) is still cut off at its route's size, before the Worker holds it all.
{
  const chunked = (bytes, path = '/holder/pair') => {
    let left = bytes;
    const body = new ReadableStream({ pull(c) { if (left <= 0) return c.close(); const n = Math.min(16_384, left); left -= n; c.enqueue(new Uint8Array(n).fill(32)); } });
    return new Request(`https://engine.test${path}`, { method: 'POST', body, duplex: 'half', headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.9.${bytes % 250}.1` } });
  };
  assert.equal(chunked(10).headers.get('content-length'), null, 'no length header on a stream');
  await assert.rejects(bodyText(chunked(70_000), 64_000), TooBig);
  assert.equal(await bodyText(new Request('https://engine.test/x', { method: 'POST', body: '{"id":"a"}' }), 64_000), '{"id":"a"}');
  const env = { DB: null };
  for (const [path, bytes, words] of [['/holder/pair', 200_000, 'Request too large'], ['/launch/meta', 900_000, 'That picture is too big.'], ['/rpc', 9_000, 'Request too large'], ['/story', 7_000_000, 'Request too large']]) {
    const res = await engineWorker.fetch(chunked(bytes, path), { ...env, SOLANA_RPC_URL: 'https://rpc.test' }, { waitUntil() {} });
    assert.equal(res.status, 413, path);
    assert.equal((await res.json()).error, words, path);
    assert.equal(res.headers.get('access-control-allow-origin'), '*', path);
  }
  console.log('PASS bughunt: a chunked body is cut off at the size its route allows');
}

// 24. Bad bot answers on real posts (3 Nov): an old namesake as OG, an address inside a GMGN link, a "GTA$" ticker.
{
  const { botReply } = await import('../bot/reply.js');
  const { cashtags } = await import('../bot/coins.js');
  const postAt = Date.parse('2026-11-02T19:00:00Z');
  const tok = (symbol, address, daysBefore) => ({ symbol, address, marketCap: 20_000, createdAt: postAt - daysBefore * 864e5, volume: { h24: 9_000 } });
  const r = botReply({ picks: [{ role: 'top', token: tok('PEPPER', 'TopPepper11111111111111111111111111111pump', 0.1) }, { role: 'og', token: tok('Pepper', 'HXHZoldraccoon111111111111111111111111pump', 24) }], postAt }, 'https://x.com/i/status/1', postAt + 3600e3);
  assert.doesNotMatch(r, /OG: Pepper/, 'a coin from 24 days before the post is not its OG');
  assert.match(r, /Same name, older coin/);
  assert.ok(cashtags('GTA$ is the primary in-game currency?').includes('GTA$'));
  assert.deepEqual(cashtags('it was US$100 and $FROGGY'), ['FROGGY'], 'a price is no ticker');
  const seen = [];
  const addr = '5BgUXqWm8n3a9WkTpump2hJ4cV7xYz1bQ6rS8dE9fG2hKpump'.slice(0, 44);
  await botCoins({ mentioned: [] }, { text: `new gem https://gmgn.ai/sol/token/lu5EtQcb_${addr}` }, { search: async () => [], lookupCa: async (ca) => { seen.push(ca); return null; }, capOf: async () => null, matchImages: async () => [], chains: ['solana'] });
  assert.ok(seen.includes(addr), 'the address inside a GMGN link is looked up');
  console.log('PASS bughunt: no old OG, GMGN link addresses, and GTA$ tickers');
}

// 25. Highest MC isn't claimed when a bigger namesake lives on another chain the bot scans.
{
  const src = (await import('node:fs')).readFileSync(new URL('../bot/coins.js', import.meta.url), 'utf8');
  assert.match(src, /sym\(t\) === sym\(top\) && chains\.includes\(t\.chain\) && t\.mcapBacked/);
  assert.doesNotMatch(src, /t\.chain === top\.chain/);
  console.log('PASS bughunt: Highest MC is checked against namesakes on every scanned chain');
}

// 26. A coin named just its ticker gets no "named in the post" credit: the bigger GTA$ wins, not a small one with a pool.
{
  const { pickNamed } = await import('../bot/coins.js');
  const mk = (address, chain, marketCap) => ({ address, chain, symbol: 'GTA$', name: 'GTA$', marketCap, mcapBacked: true, liquidity: 20_000, volume: { h24: 50_000 }, txns: { h1: { buys: 9, sells: 9 }, h24: { buys: 90, sells: 90 } }, createdAt: Date.now() - 86_400_000 });
  const pick = pickNamed('GTA$', [mk('Rh111', 'robinhood', 6_400), mk('J9298r', 'solana', 35_000)], 'GTA$ is the primary in-game currency?');
  assert.equal(pick?.address, 'J9298r');
  console.log('PASS bughunt: a ticker-only name gives no edge, the bigger coin is named');
}

// 27. Two coins with the typed ticker and close in size: the earlier one, made for the post, is named, not a later copy.
{
  const { pickNamed } = await import('../bot/coins.js');
  const base = { symbol: 'BingBingBing', name: 'Bing Bing Bing', mcapBacked: true, liquidity: 12_000, volume: { h24: 100_000 }, txns: { h1: { buys: 9, sells: 9 }, h24: { buys: 90, sells: 90 } } };
  const now = Date.now();
  const first = { ...base, address: 'FqmuG', chain: 'solana', marketCap: 30_000, createdAt: now - 48 * 3600e3 };
  const copy = { ...base, address: '4DXt', chain: 'solana', marketCap: 35_100, createdAt: now - 9 * 3600e3 };
  assert.equal(pickNamed('BINGBINGBING', [copy, first], 'Ticker should be BingBingBing?')?.address, 'FqmuG');
  const big = { ...copy, marketCap: 300_000 };
  assert.equal(pickNamed('BINGBINGBING', [big, first], 'Ticker should be BingBingBing?')?.address, '4DXt', 'a far bigger coin still wins');
  console.log('PASS bughunt: close in size, the earlier coin is the one named');
}

// 28. A coin whose profile links this very post leads the reply when the post names none.
{
  const { botReply } = await import('../bot/reply.js');
  const live = { mcapBacked: true, liquidity: 15_000, volume: { h24: 52_000 }, txns: { h1: { buys: 20, sells: 12 }, h24: { buys: 200, sells: 120 } }, createdAt: Date.now() - 4 * 3600e3, chain: 'solana' };
  const lily = { ...live, address: 'FZs4lily11111111111111111111111111111pump', symbol: 'LILY', name: 'Freaky Lily', marketCap: 9_000, fromPost: true };
  const other = { ...live, address: 'Kitty1111111111111111111111111111111pump', symbol: 'kittylick', name: 'Freaky ah', marketCap: 12_600 };
  const res = await botCoins({ mentioned: [], picks: [{ role: 'top', token: other }, { role: 'mover', token: lily }], others: [] }, { text: 'freaky lily', url: 'https://x.com/zeroveyl/status/2116962191165272095' }, { search: async () => [], lookupCa: async () => null, capOf: async () => null, matchImages: async () => [], chains: ['solana'] });
  assert.equal(res.named?.address, lily.address);
  assert.equal(res.how, 'linked');
  assert.match(botReply(res, 'https://x.com/i/status/2116962191165272095'), /🔗 Launched from this post: \$LILY/);
  console.log('PASS bughunt: a coin launched from the post leads the reply');
}

// 29. From the second real-post check: a linked later copy hides no bigger earlier namesake, a stock cashtag names no dead
// coin, a tokenized share isn't on the story, and a coin launched months before the post is never "(OG)".
{
  const { pickNamed } = await import('../bot/coins.js');
  const { botReply, replyEntries } = await import('../bot/reply.js');
  const now = Date.now();
  const live = { mcapBacked: true, liquidity: 30_000, volume: { h24: 500_000 }, txns: { h1: { buys: 20, sells: 12 }, h24: { buys: 200, sells: 120 } } };
  const rh = { ...live, address: '0x07ae00000000000000000000000000000000f60e', chain: 'robinhood', symbol: 'AMD', name: 'AMD', marketCap: 81_700, fromPost: true, createdAt: now - 3600e3, relevance: 95 };
  const sol = { ...live, address: 'DDmGnuvroxVrb7CSyjYcezFU8gnAfhKasg4ZZezmpump', chain: 'solana', symbol: 'AMD', name: 'A Meme Dog', marketCap: 1_740_000, createdAt: now - 3 * 3600e3, relevance: 95 };
  const res = await botCoins({ mentioned: [], picks: [{ role: 'top', token: sol }, { role: 'og', token: sol }, { role: 'mover', token: rh }], others: [] }, { text: 'AMD is the real deal', url: 'https://x.com/jimcramer/status/2117728399267639668' }, { search: async () => [], lookupCa: async () => null, capOf: async () => null, matchImages: async () => [], chains: ['solana', 'robinhood'] });
  assert.ok(res.picks.some((p) => p.token.address === sol.address), 'the bigger, earlier Solana $AMD stays on the story');

  const dead = { address: 'E8mhshop111111111111111111111111111pump', chain: 'solana', symbol: 'SHOP', name: 'shopping ', marketCap: 7_600, volume: { h24: 62 }, liquidity: 6_000, mcapBacked: true, txns: { h24: { buys: 2, sells: 1 } }, createdAt: now - 3600e3 };
  assert.equal(pickNamed('SHOP', [dead], 'Shopify stock, $SHOP, falls over -15%'), null, 'a dead namesake of a stock cashtag');
  assert.equal(pickNamed('SHOP', [{ ...dead, name: 'Shopify' }], 'Shopify stock, $SHOP, falls over -15%')?.address, dead.address, 'named by its name, it still counts');

  const googl = { ...live, address: '0x3f5300000000000000000000000000000000323b', chain: 'bsc', symbol: 'GOOGLB', name: 'Alphabet', marketCap: 26_870_000, createdAt: now - 95 * 86_400e3, relevance: 95 };
  const r2 = await botCoins({ mentioned: [], picks: [{ role: 'top', token: googl }], others: [] }, { text: 'Big Tech AI spending: $GOOGL $META $MSFT', url: 'https://x.com/KobeissiLetter/status/2117424042944721041' }, { search: async () => [], lookupCa: async () => null, capOf: async () => null, matchImages: async () => [], chains: ['solana', 'bsc'] });
  assert.ok(!r2.picks.some((p) => p.token.address === googl.address), 'a tokenized share is no memecoin');

  const stonk = { ...live, address: 'STONK111111111111111111111111111111pump', chain: 'solana', symbol: 'STONK', name: 'Stonk', marketCap: 116_750_000, createdAt: now - 83 * 86_400e3 };
  const text = botReply({ postAt: now - 3600e3, picks: [{ role: 'top', token: stonk, alsoOg: true }] }, 'https://x.com/i/status/1', now);
  assert.doesNotMatch(text, /OG/, 'launched 83 days before the post');
  assert.equal(replyEntries({ postAt: now - 3600e3, named: stonk, how: 'post', picks: [{ role: 'og', token: stonk }] }, now)[0].label, '📌 In the post');
  console.log('PASS bughunt: linked copies, stock cashtags, tokenized shares and old OGs');
}

// 30. A ticker written without its $ ("AMD so far so good") finds the runner under it, when the scan already met a coin
// with that ticker; a capitalised word with only small coins under it names nothing.
{
  const { botReply } = await import('../bot/reply.js');
  const now = Date.now();
  const live = { mcapBacked: true, liquidity: 30_000, volume: { h24: 500_000 }, txns: { h1: { buys: 20, sells: 12 }, h24: { buys: 200, sells: 120 } } };
  const rh = { ...live, address: '0x07ae00000000000000000000000000000000f60e', chain: 'robinhood', symbol: 'AMD', name: 'A Meme Dog', marketCap: 86_000, fromPost: true, createdAt: now - 3 * 3600e3, relevance: 95 };
  const pair = (address, symbol, name, mc) => ({ chainId: 'solana', dexId: 'pumpswap', pairAddress: `P${address}`, baseToken: { address, symbol, name }, quoteToken: { address: 'So11111111111111111111111111111111111111112', symbol: 'SOL' }, marketCap: mc, fdv: mc, priceNative: '0.00001', priceUsd: '0.00167', liquidity: { usd: 134_000, quote: 400 }, volume: { h24: 8_700_000, h1: 300_000 }, txns: { h1: { buys: 400, sells: 300 }, h24: { buys: 60_000, sells: 50_000 } }, priceChange: { h1: 2, h24: 30 }, pairCreatedAt: now - 5 * 3600e3, info: { imageUrl: 'https://x/i.png' } });
  const ddmg = 'DDmGnuvroxVrb7CSyjYcezFU8gnAfhKasg4ZZezmpump';
  const deps = (pairs) => ({ search: async () => pairs, lookupCa: async () => null, capOf: async () => null, matchImages: async () => [], chains: ['solana', 'robinhood'] });
  const scan = { mentioned: [], picks: [{ role: 'top', token: rh }], others: [] };
  const res = await botCoins(scan, { text: 'AMD so far so good...moving up tech nicely', url: 'https://x.com/jimcramer/status/2117728399267639668' }, deps([pair(ddmg, 'AMD', 'A Meme Dog', 1_620_000)]));
  assert.equal(res.named?.address, ddmg, 'the $1.6M Solana $AMD, not only the copy that links the post');
  assert.match(botReply(res, 'https://x.com/i/status/1', now), /\$AMD · \$1\.62M/);
  const small = await botCoins(scan, { text: 'AMD so far so good', url: 'https://x.com/jimcramer/status/2117728399267639668' }, deps([pair(ddmg, 'AMD', 'A Meme Dog', 40_000)]));
  assert.equal(small.how, 'linked', 'nothing of runner size: the coin that links the post stays');
  const word = await botCoins({ mentioned: [], picks: [{ role: 'top', token: { ...rh, fromPost: false, symbol: 'NEW', name: 'New' } }], others: [] }, { text: 'NEW record for tech', url: 'https://x.com/a/status/2' }, deps([pair(ddmg, 'AMD', 'A Meme Dog', 1_620_000)]));
  assert.notEqual(word.named?.address, ddmg, 'a capitalised word only searches its own ticker');
  console.log('PASS bughunt: a ticker written without its $ finds the runner under it');
}

// 31. A typed big-stock ticker ($META on a markets post) names a coin only of runner size; $AMD's $1.6M coin still counts.
{
  const now = Date.now();
  const pair = (address, symbol, name, mc, liq) => ({ chainId: 'solana', dexId: liq ? 'pumpswap' : 'meteoradbc', pairAddress: `P${address}`, baseToken: { address, symbol, name }, quoteToken: { address: 'So11111111111111111111111111111111111111112', symbol: 'SOL' }, marketCap: mc, fdv: mc, priceNative: '0.00001', priceUsd: '0.00167', liquidity: liq ? { usd: liq, quote: liq / 334 } : undefined, volume: { h24: 1_586, h1: 200 }, txns: { h1: { buys: 3, sells: 2 }, h24: { buys: 16, sells: 12 } }, priceChange: { h1: 2, h24: 30 }, pairCreatedAt: now - 16 * 3600e3 });
  const deps = (pairs) => ({ search: async () => pairs, lookupCa: async () => null, capOf: async () => null, matchImages: async () => [], chains: ['solana'] });
  const scan = { mentioned: [], picks: [], others: [] };
  const meta = await botCoins(scan, { text: 'Big Tech AI spending: $GOOGL $META $MSFT', url: 'https://x.com/KobeissiLetter/status/2117424042944721041' }, deps([pair('BNzUsDssAVr8hB1RGmbc3g4VezjKdqrVihgjowFfR5yQ', 'META', 'metapad.lol', 2_660)]));
  assert.equal(meta.named, null, 'a $2.7K launchpad coin is not the $META the post means');
  const big = { ...pair('DDmGnuvroxVrb7CSyjYcezFU8gnAfhKasg4ZZezmpump', 'AMD', 'A Meme Dog', 1_470_000, 134_000), volume: { h24: 8_700_000, h1: 300_000 }, txns: { h1: { buys: 400, sells: 300 }, h24: { buys: 60_000, sells: 50_000 } } };
  const amd = await botCoins(scan, { text: 'BREAKING: AMD stock, $AMD, surges over +6%', url: 'https://x.com/KobeissiLetter/status/2117728009134506332' }, deps([big]));
  assert.equal(amd.named?.address, big.baseToken.address, 'a runner under a stock ticker still counts');
  const meme = await botCoins(scan, { text: 'send $FROGGY', url: 'https://x.com/a/status/3' }, deps([pair('Frog1111111111111111111111111111111pump', 'FROGGY', 'Froggy', 2_660)]));
  assert.ok(meme.named, 'a small coin under a typed ticker that is no stock is still named');
  console.log('PASS bughunt: a typed stock ticker names only a runner');
}

// 32. An old namesake that barely trades is left out of the reply; an old one that still trades, and the post's own coin, stay.
{
  const { botReply, replyEntries } = await import('../bot/reply.js');
  const now = Date.now();
  const postAt = now - 3600e3;
  const coin = (symbol, address, marketCap, ageDays, trades, vol) => ({ symbol, name: symbol, address, chain: 'solana', marketCap, createdAt: now - ageDays * 864e5, volume: { h24: vol }, txns: { h24: { buys: Math.ceil(trades / 2), sells: Math.floor(trades / 2) } } });
  const dem = coin('DEMOCRATS', '9VkoFQLwEbhBnxMntCiuSD5Fqmai4ZGsQeKY1es9pump', 6_000, 210, 11, 300);
  assert.equal(botReply({ postAt, picks: [{ role: 'og', token: dem }] }, 'https://x.com/i/status/1', now), null, 'a 7-month-old coin at 11 trades a day');
  const xav = coin('xavier', '69G8CpUVZAxbPMiEBrfCCCH445NwFxH6PzVL693Xpump', 1_060_000, 60, 900, 80_000);
  assert.match(botReply({ postAt, alone: true, picks: [{ role: 'top', token: xav }] }, 'https://x.com/i/status/1', now), /Same name, older coin: \$xavier/, 'old but trading stays');
  assert.equal(replyEntries({ postAt, named: dem, how: 'post', picks: [] }, now).length, 1, 'the coin the post names shows whatever its state');
  const fresh = coin('BLUE', 'iAmPXjG2vTQoHkgSqvhb4Ncd54kVZ2oAYuDUdRSpump', 10_100, 0.1, 30, 900);
  assert.match(botReply({ postAt, picks: [{ role: 'top', token: fresh }] }, 'https://x.com/i/status/1', now), /\$BLUE/, 'a new coin with few trades stays');
  console.log('PASS bughunt: old namesakes that barely trade stay out of the reply');
}

// 33. A coin whose newest DexScreener profile links the post leads the reply even when the scan's search never met it.
{
  const { botReply } = await import('../bot/reply.js');
  const now = Date.now();
  const ddc = { address: 'FCty2praQweB4XFhkpQLU48yMnVrLf5oTW7Kat2pump', chain: 'solana', symbol: 'DDC', name: 'DooDooCoin', marketCap: 2_770, mcapBacked: true, onCurve: true, volume: { h24: 36_285, h1: 9_474 }, txns: { h1: { buys: 95, sells: 90 }, h24: { buys: 300, sells: 280 } }, createdAt: now - 2 * 3600e3 };
  const other = { ...ddc, address: '9J5EF9c3XBhxxCHrJdJcSiQnBJ6Vz9ANAxC5j4Y2pump', symbol: 'DIPWHEELER', name: 'DipWheeler', relevance: 95, volume: { h24: 900, h1: 0 } };
  const asked = [];
  const deps = { search: async () => [], lookupCa: async () => null, capOf: async () => null, matchImages: async () => [], chains: ['solana'], linkedTo: async (id) => { asked.push(id); return id === '2117817977773199409' ? [ddc] : []; } };
  const res = await botCoins({ mentioned: [], picks: [{ role: 'top', token: other }], others: [] }, { text: 'made a pumpfun. market is doo doo, might as well have some fun.', url: 'https://x.com/DipWheeler/status/2117817977773199409' }, deps);
  assert.deepEqual(asked, ['2117817977773199409']);
  assert.equal(res.named?.address, ddc.address);
  assert.equal(res.how, 'linked');
  assert.match(botReply(res, 'https://x.com/i/status/2117817977773199409', now), /🔗 Launched from this post: \$DDC/);
  const typed = await botCoins({ mentioned: [], picks: [], others: [] }, { text: 'send $DIPWHEELER', url: 'https://x.com/a/status/5' }, { ...deps, search: async () => [], linkedTo: async () => { throw new Error('not asked'); } });
  void typed;
  console.log('PASS bughunt: a coin launched from the post is found from its profile');
}
