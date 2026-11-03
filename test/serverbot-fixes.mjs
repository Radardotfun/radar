// Engine and bot bugs from the 3 Nov hunt, kept from coming back. node test/serverbot-fixes.mjs
// Nothing leaves this machine: every fetch is stubbed.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ok = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const xPosts = [];
let tweetAnswers = [];
let mentionPages = [];
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  const method = (init.method || input.method || 'GET').toUpperCase();
  if (url.startsWith('https://api.x.com/2/users/me')) return ok({ data: { id: '1', username: 'radardotfunn' } });
  if (url.includes('/mentions')) return ok(mentionPages.shift() || { meta: {} });
  if (url === 'https://api.x.com/2/tweets' && method === 'POST') { xPosts.push(JSON.parse(init.body)); return tweetAnswers.shift()(); }
  return new Response('{}', { status: 404 });
};
const { default: bot, mayHavePosted } = await import('../bot/worker.js');
const { default: engine, ipOf, INSIDE } = await import('../server/worker.js');

// 1. X failing on its side, or the connection dropping, may still have posted: the tag is not answered again.
{
  assert.equal(mayHavePosted(Object.assign(new Error('timed out'), { name: 'TimeoutError' })), true);
  assert.equal(mayHavePosted(Object.assign(new Error('X 503: Service Unavailable'), { status: 503 })), true);
  assert.equal(mayHavePosted(new Error('Network connection lost.')), true);
  assert.equal(mayHavePosted(Object.assign(new Error('X 429: Too Many Requests'), { status: 429 })), false, 'a 429 did not post: retried');
  assert.equal(mayHavePosted(Object.assign(new Error('X 403: Forbidden'), { status: 403 })), false);

  const RADAR = { fetch: async (req) => {
    const u = new URL(req.url);
    if (u.pathname === '/tweet') return ok({ post: { text: 'my dog biscuit', author: 'someone', url: 'https://x.com/someone/status/150', images: [] }, source: { label: 'x' } });
    if (u.pathname === '/interpret') return ok({ narrative: 'nothing', coinable: false, terms: [], anchors: [], tickers: [], cas: [] });
    return ok({});
  } };
  const kv = new Map([['state', JSON.stringify({ since: '100', me: { id: '1', username: 'radardotfunn' } })]]);
  const BOT_KV = { get: async (k, t) => (kv.has(k) ? (t === 'json' ? JSON.parse(kv.get(k)) : kv.get(k)) : null), put: async (k, v) => { kv.set(k, v); } };
  const ctx = { waitUntil() {} };
  const env = { X_API_KEY: 'a', X_API_SECRET: 'b', X_ACCESS_TOKEN: '1-c', X_ACCESS_SECRET: 'd', BOT_TOKEN: 't', BOT_LIVE: '1', RADAR, BOT_KV };
  env.SELF = { fetch: (url, init) => bot.fetch(new Request(url, init), env, ctx) };
  const poll = async () => (await bot.fetch(new Request('https://radar-bot/poll', { method: 'POST', headers: { 'x-bot-token': 't' } }), env, ctx)).json();
  mentionPages = [
    { data: [{ id: '200', author_id: '9', text: '@radardotfunn coins?', display_text_range: [0, 20], entities: { mentions: [{ username: 'radardotfunn', start: 0, end: 13 }] }, referenced_tweets: [{ type: 'replied_to', id: '150' }] }], meta: { newest_id: '200' } },
    { meta: { result_count: 0 } },
  ];
  tweetAnswers = [() => ok({ title: 'Service Unavailable', detail: 'Service Unavailable' }, 503), () => ok({ data: { id: '300' } }, 201)];
  await poll();
  assert.deepEqual(JSON.parse(kv.get('state')).pending, [], 'not put back on the retry list');
  await poll();
  assert.equal(xPosts.filter((p) => p.reply?.in_reply_to_tweet_id === '200').length, 1, 'one reply to the tag');
  console.log('PASS bot: X answering 5xx never makes the bot reply twice');
}

// 2. IPv6 limits count the /64 written out in full; the bot's own calls (no client address) don't share one bucket.
{
  const req = (ip) => new Request('https://engine.test/count/bot-scan', { method: 'POST', headers: ip ? { 'cf-connecting-ip': ip } : {} });
  assert.equal(ipOf(req('2001:db8::1')), '2001:db8:0:0');
  assert.equal(ipOf(req('2001:DB8:0000:0:ffff::9')), '2001:db8:0:0');
  assert.equal(ipOf(req('2001:db8:aaaa:bbbb:1:2:3:4')), '2001:db8:aaaa:bbbb');
  assert.equal(ipOf(req('::ffff:1.2.3.4')), '1.2.3.4');
  assert.equal(ipOf(req(null)), INSIDE);
  const env = { DB: { prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) } };
  const ctx = { waitUntil() {} };
  const statuses = async (ips) => Promise.all(ips.map(async (ip) => (await engine.fetch(req(ip), env, ctx)).status));
  const one64 = Array.from({ length: 31 }, (_, i) => (i % 2 ? `2001:db8:cccc:0::${i.toString(16)}` : `2001:db8:cccc::${i.toString(16)}`));
  const got = await statuses(one64);
  assert.equal(got.filter((s) => s === 429).length, 1, 'the 31st call from one /64 is refused, however it is written');
  const inside = await statuses(Array(40).fill(null));
  assert.equal(inside.filter((s) => s === 429).length, 0, "the bot's own calls are not rate limited together");
  console.log('PASS engine: limits count a /64 once, and the bot never shares one bucket');
}

// 3. Holders' alerts are read through an index on when they were judged.
{
  const src = fs.readFileSync(new URL('../bot/signals.js', import.meta.url), 'utf8');
  assert.match(src, /CREATE INDEX IF NOT EXISTS signals_read ON signals \(signal, read_at\)/);
  assert.match(fs.readFileSync(new URL('../server/signals.js', import.meta.url), 'utf8'), /WHERE signal = 1 AND read_at > \? AND read_at <= \?/);
  console.log('PASS engine: holder alerts have their index');
}
// 4. Videos are watched again: the 2.5 models answer 404 now, so the list is current models only, and when one fails the
// next one answers; a failure says which models were tried and how.
{
  const { watchVideo } = await import('../server/narrative.js');
  const src = fs.readFileSync(new URL('../server/narrative.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src.match(/const WATCH_MODELS = \[[^\]]*\]/)[0], /2\.5/, 'no retired model left');
  const realFetch = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.startsWith('https://video.test/')) return new Response(new Uint8Array(1000), { status: 200, headers: { 'content-length': '1000' } });
    const model = u.match(/models\/([^:]+):/)?.[1];
    asked.push(model);
    if (model === 'gemini-flash-lite-latest') return new Response('{}', { status: 503 });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'A man argues with an AI avatar named Julia.' }] } }] }), { status: 200 });
  };
  const out = await watchVideo({ GEMINI_API_KEY: 'k' }, 'https://video.test/a.mp4');
  assert.equal(out.model, 'gemini-flash-latest');
  assert.match(out.text, /Julia/);
  assert.deepEqual(asked, ['gemini-flash-lite-latest', 'gemini-flash-latest']);
  globalThis.fetch = async (url) => (String(url).startsWith('https://video.test/') ? new Response(new Uint8Array(10), { status: 200 }) : new Response('{}', { status: 404 }));
  await assert.rejects(watchVideo({ GEMINI_API_KEY: 'k' }, 'https://video.test/b.mp4'), /Could not watch the video \(gemini-flash-lite-latest 404, gemini-flash-latest 404\)/);
  globalThis.fetch = realFetch;
  console.log('PASS engine: videos are watched again, by a model that still answers');
}
process.exit(0);
