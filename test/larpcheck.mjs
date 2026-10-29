// GET /larpcheck with a stubbed network and edge cache: the key stays on the server, answers are
// trimmed to what the panel shows, cached, and a busy Larpcheck falls back to the day-old copy.
// Then the panel's markup: every verdict names Larpcheck and links to its check.
import assert from 'node:assert/strict';
import worker from '../server/worker.js';
import { lcButtonHtml, lcStoryHtml, lcCheckItHtml, lcTone } from '../extension/src/ui/larpcheck.js';

const store = new Map();
globalThis.caches = { default: {
  match: async (req) => store.get(req.url)?.clone(),
  put: async (req, res) => { store.set(req.url, res); },
} };
const CA = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
// Larpcheck's own example answer (larpcheck.app/developers), with a real-looking mint.
const SAMPLE = {
  address: CA, chain: 'solana', symbol: 'EXMPL', checked: true, page: `https://larpcheck.app/coin/${CA}`,
  latest: {
    id: 'aB3dE5gH7j', url: 'https://larpcheck.app/c/aB3dE5gH7j', kind: 'coin', input: CA, coin: CA, status: 'done', created: '2026-10-18T09:12:40.000Z',
    verdict: 'LIKELY LARP', score: 22, total: 31, headline: "The team's 'live product' is a landing page with no app behind it.",
    stamps: [{ id: 'story', word: 'LIKELY LARP', score: 22 }, { id: 'coin', word: 'RIGGED', score: 40 }],
    call: 'No product yet; insiders hold 31%.', freshUntil: '2026-10-18T12:12:40.000Z',
  },
  running: [], checks: [],
};
let upstream = () => new Response(JSON.stringify(SAMPLE), { status: 200 });
const calls = [];
globalThis.fetch = async (url, opts) => { calls.push({ url: String(url), auth: opts?.headers?.authorization }); return upstream(); };
const waits = [];
const ctx = { waitUntil: (p) => waits.push(p) };
const get = async (addr, env) => {
  const res = await worker.fetch(new Request(`https://w.dev/larpcheck?address=${addr}`), env, ctx);
  await Promise.all(waits.splice(0));
  return { status: res.status, cache: res.headers.get('x-cache'), body: await res.json() };
};

// 1. No key set: the route answers "off" and never calls Larpcheck.
let r = await get(CA, {});
assert.deepEqual(r.body, { off: true });
assert.equal(calls.length, 0);

// 2. Bad input is refused.
assert.equal((await get('not-a-ca', { LARPCHECK_KEY: 'lc_test' })).status, 400);

// 3. A checked coin: the key goes in the header, the answer is trimmed, then served from cache.
r = await get(CA, { LARPCHECK_KEY: 'lc_test' });
assert.equal(r.status, 200);
assert.equal(calls[0].url, `https://larpcheck.app/api/v1/coins/${CA}`);
assert.equal(calls[0].auth, 'Bearer lc_test');
assert.equal(r.body.checked, true);
assert.equal(r.body.verdict, 'LIKELY LARP');
assert.equal(r.body.total, 31);
assert.equal(r.body.url, 'https://larpcheck.app/c/aB3dE5gH7j');
assert.ok(!JSON.stringify(r.body).includes('lc_test'), 'key never reaches the client');
r = await get(CA, { LARPCHECK_KEY: 'lc_test' });
assert.equal(r.cache, 'hit');
assert.equal(calls.length, 1);

// 4. Larpcheck rate-limits us after the fresh copy expired: the day-old copy answers.
store.delete(`https://cache.narrative-radar/lc2/${CA}`);
upstream = () => new Response('{"error":"rate","code":"rate"}', { status: 429 });
r = await get(CA, { LARPCHECK_KEY: 'lc_test' });
assert.equal(r.cache, 'stale');
assert.equal(r.body.verdict, 'LIKELY LARP');

// 5. Rate-limited with no copy at all: a 429 the panel ignores.
const OTHER = 'So11111111111111111111111111111111111111112';
r = await get(OTHER, { LARPCHECK_KEY: 'lc_test' });
assert.equal(r.status, 429);

// 6. Nobody has checked the coin: no verdict, but its Larpcheck page to check it there.
upstream = () => new Response(JSON.stringify({ address: OTHER, checked: false, latest: null, running: [], checks: [], page: `https://larpcheck.app/coin/${OTHER}` }), { status: 200 });
r = await get(OTHER, { LARPCHECK_KEY: 'lc_test' });
assert.deepEqual(r.body, { checked: false, page: `https://larpcheck.app/coin/${OTHER}`, running: false });

// 6b. A site that only mentions the coin (a token tool using it as an example) is not the coin's verdict;
//     a real coin check further down the list is.
const SITE = { id: 'ozpDQwKBMv', url: 'https://larpcheck.app/c/ozpDQwKBMv', kind: 'site', input: 'https://opendex.info', coin: null, status: 'done', verdict: 'PARTLY REAL', score: 42, total: null, headline: 'The token data lookup works, but…', stamps: [] };
const MINT = 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm';
upstream = () => new Response(JSON.stringify({ address: MINT, checked: true, latest: SITE, checks: [SITE], running: [], page: `https://larpcheck.app/${MINT}` }), { status: 200 });
r = await get(MINT, { LARPCHECK_KEY: 'lc_test' });
assert.equal(r.body.checked, false, 'a site check that mentions the coin is not its verdict');
const ROOT = 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn';
const COINCHECK = { ...SAMPLE.latest, id: 'Zz9', url: 'https://larpcheck.app/c/Zz9', input: ROOT, coin: ROOT, verdict: 'LIKELY REAL', total: 70 };
upstream = () => new Response(JSON.stringify({ address: ROOT, checked: true, latest: { ...SITE, coin: ROOT }, checks: [{ ...SITE, coin: ROOT }, COINCHECK], running: [] }), { status: 200 });
r = await get(ROOT, { LARPCHECK_KEY: 'lc_test' });
assert.equal(r.body.url, 'https://larpcheck.app/c/Zz9', 'the coin check further down is used');
assert.equal(r.body.verdict, 'LIKELY REAL');

// 7. Panel markup.
upstream = () => new Response(JSON.stringify(SAMPLE), { status: 200 });
const lc = (await get(CA, { LARPCHECK_KEY: 'lc_test' })).body;
const btn = lcButtonHtml(lc);
assert.match(btn, /class="lc-btn" href="https:\/\/larpcheck\.app\/c\/aB3dE5gH7j"/);
assert.match(btn, /<span class="lc-k">Larpcheck<\/span><b>LIKELY LARP 31<\/b>/);
assert.match(btn, /title="The team/, 'headline on hover');
assert.equal(lcButtonHtml({ checked: false, page: 'https://larpcheck.app/x' }), '', 'no button without a verdict');
const box = lcStoryHtml(lc, { open: true, symbol: 'EXMPL', chevron: '' });
assert.match(box, /Verdict by <b>Larpcheck<\/b> on \$EXMPL<\/span><a class="lc-btn" href="https:\/\/larpcheck\.app\/c\/aB3dE5gH7j"[^>]*>Full report ↗/);
assert.match(box, /<span>coin<\/span>RIGGED · 40/);
assert.match(lcCheckItHtml(`https://larpcheck.app/coin/${OTHER}`, 'SOL'), /class="lc-btn"[^>]*>Check \$SOL on Larpcheck ↗/);
assert.equal(lcCheckItHtml(null, 'SOL'), '');
assert.equal(lcTone('SCAM'), 'risk');
assert.equal(lcTone('PARTLY REAL'), 'mid');
assert.ok(!lcButtonHtml({ ...lc, headline: '"><img src=x onerror=alert(1)>' }).includes('<img'), 'headline is escaped');

console.log('larpcheck: all checks passed');
