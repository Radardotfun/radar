// A backlog of tags (7 Nov: X's credits ran out, and 11 tags came at once when they were back) is answered in full,
// a few a minute, and a round that never saved gives its tags back without ever answering one twice.
// node test/bot-backlog.mjs. Nothing leaves this machine: every fetch is stubbed.
import assert from 'node:assert/strict';

const ok = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const posts = [];
let mentionPages = [];
let nextId = 9000;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  const method = (init.method || input.method || 'GET').toUpperCase();
  if (url.startsWith('https://api.x.com/2/users/me')) return ok({ data: { id: '1', username: 'radardotfunn' } });
  if (url.includes('/mentions')) return ok(mentionPages.shift() || { meta: {} });
  if (url === 'https://api.x.com/2/tweets' && method === 'POST') { posts.push(JSON.parse(init.body)); return ok({ data: { id: String(nextId++) } }, 201); }
  return new Response('{}', { status: 404 });
};
const { default: bot, PER_ROUND } = await import('../bot/worker.js');

const RADAR = { fetch: async (req) => {
  const u = new URL(req.url);
  if (u.pathname === '/tweet') return ok({ post: { text: 'my dog biscuit', author: 'someone', url: 'https://x.com/someone/status/150', images: [] }, source: { label: 'x' } });
  if (u.pathname === '/interpret') return ok({ narrative: 'nothing', coinable: false, terms: [], anchors: [], tickers: [], cas: [] });
  if (u.pathname === '/story') return ok({ word: 'UNCLEAR', score: 30, call: 'Nothing checkable in this post', findings: [] });
  return ok({});
} };
const setup = (state, extra = []) => {
  const kv = new Map([['state', JSON.stringify({ since: '100', me: { id: '1', username: 'radardotfunn' }, ...state })], ...extra]);
  const BOT_KV = { get: async (k, t) => (kv.has(k) ? (t === 'json' ? JSON.parse(kv.get(k)) : kv.get(k)) : null), put: async (k, v) => { kv.set(k, v); } };
  const ctx = { waitUntil() {} };
  const env = { X_API_KEY: 'a', X_API_SECRET: 'b', X_ACCESS_TOKEN: '1-c', X_ACCESS_SECRET: 'd', BOT_TOKEN: 't', BOT_LIVE: '1', RADAR, BOT_KV };
  env.SELF = { fetch: (url, init) => bot.fetch(new Request(url, init), env, ctx) };
  const call = async (path, body) => (await bot.fetch(new Request(`https://radar-bot${path}`, { method: 'POST', headers: { 'x-bot-token': 't', 'content-type': 'application/json' }, body: body && JSON.stringify(body) }), env, ctx)).json();
  return { kv, state: () => JSON.parse(kv.get('state')), poll: () => call('/poll'), handle: (b) => call('/handle', b) };
};
const tag = (id, under) => ({ id, author_id: `u${id}`, text: '@radardotfunn', display_text_range: [0, 13], entities: { mentions: [{ username: 'radardotfunn', start: 0, end: 13 }] }, referenced_tweets: [{ type: 'replied_to', id: under }] });
const answered = (id) => posts.filter((p) => p.reply?.in_reply_to_tweet_id === id).length;

// 1. Eight tags at once: PER_ROUND this minute, the rest the next, every one answered once, no try used up waiting.
{
  const b = setup({});
  const ids = Array.from({ length: 8 }, (_, i) => String(201 + i));
  mentionPages = [{ data: ids.map((id, i) => tag(id, String(150 + i))).reverse(), meta: { newest_id: '208' } }];
  await b.poll();
  assert.equal(PER_ROUND, 5);
  assert.equal(posts.length, 5, 'five this minute');
  assert.deepEqual(ids.slice(0, 5).map(answered), [1, 1, 1, 1, 1], 'oldest first');
  assert.deepEqual(b.state().pending.map((p) => [p.mention, p.tries]), [['206', 0], ['207', 0], ['208', 0]], 'the rest wait, no try used');
  assert.deepEqual(b.state().inflight, [], 'nothing left in flight once the round saved');
  mentionPages = [{ meta: { result_count: 0 } }];
  await b.poll();
  assert.deepEqual(ids.map(answered), [1, 1, 1, 1, 1, 1, 1, 1], 'all eight answered, each once');
  assert.deepEqual(b.state().pending, []);
  console.log('PASS bot backlog: a burst of tags is answered five a minute, oldest first, every one once');
}

// 2. A round that claimed its tags and never saved: after 5 minutes they're tried again, unless one was answered.
{
  posts.length = 0;
  const old = Date.now() - 6 * 60_000;
  const b = setup({ inflight: [{ mention: '300', by: 'u300', target: '150', tries: 0, at: old }, { mention: '301', by: 'u301', target: '151', tries: 0, at: old }, { mention: '302', by: 'u302', target: '152', tries: 0, at: Date.now() }] }, [['r:301', '8888']]);
  mentionPages = [{ meta: { result_count: 0 } }];
  await b.poll();
  assert.equal(answered('300'), 1, 'the lost tag is answered');
  assert.equal(answered('301'), 0, 'the one that had its reply is not answered again');
  assert.equal(answered('302'), 0, 'a round still within its 5 minutes is left alone');
  assert.deepEqual(b.state().inflight.map((x) => x.mention), ['302']);
  assert.equal(b.kv.get('r:300'), String(nextId - 1), 'the reply is kept against its tag');
  console.log('PASS bot backlog: a lost round gives its tags back after 5 minutes, never one that was answered');
}

// 3. A tag already answered gets no second reply, however it comes back.
{
  posts.length = 0;
  const b = setup({}, [['r:400', '7777']]);
  const r = await b.handle({ mention: '400', target: '150', live: true, tries: 0 });
  assert.equal(r.reply, '7777');
  assert.equal(r.already, true);
  assert.equal(posts.length, 0);
  const dry = await b.handle({ mention: '0', target: '150', live: false, tries: 0 });
  assert.equal(dry.dry, true, 'dry runs and previews are untouched');
  console.log('PASS bot backlog: one answer per tag');
}
