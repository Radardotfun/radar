// Offline: a video's speech and a poster's bio don't hold the panel's read back, and the bot still waits for speech. node test/quickread.mjs
import assert from 'node:assert/strict';
import { readPost, postCoins } from '../extension/src/lib/narrative.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CA = '8RNUw4N655VSrZKuhGdywhbSMDTrheguFPfxbpE2NZHQ';
let t0 = 0;
const log = {};
let speechMs = 3500;
globalThis.fetch = async (url) => {
  const u = String(url);
  const json = (v) => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
  if (u.includes('/transcribe')) { await sleep(speechMs); return json({ text: 'the speech' }); }
  if (u.includes('/interpret')) { log.interpret = Date.now() - t0; await sleep(100); return json({ narrative: 'story', coinable: true, terms: ['story'], anchors: [], cas: [], tickers: [] }); }
  if (u.includes('dex/search')) { log.search ??= Date.now() - t0; await sleep(400); return json({ pairs: [] }); }
  return json({ pairs: [] });
};
const opts = { apiBase: 'https://engine.test' };
const video = { text: 'look at this', url: 'https://x.com/a/status/1', videoUrl: 'https://video.twimg.com/a.mp4' };

t0 = Date.now();
const quick = await readPost({ ...video, quickRead: true }, ['solana'], opts);
assert.equal(quick.speechPending, true, 'says the speech is still coming');
assert.ok(Date.now() - t0 < 3000, `the quick read waited ${Date.now() - t0} ms`);
assert.equal(quick.post.transcript, undefined);

speechMs = 200;
t0 = Date.now();
const soon = await readPost({ ...video, quickRead: true, url: 'https://x.com/a/status/2', videoUrl: 'https://video.twimg.com/b.mp4' }, ['solana'], opts);
assert.equal(soon.speechPending, false, 'speech in time is used right away');
assert.equal(soon.post.transcript, 'the speech');

speechMs = 2500;
t0 = Date.now();
const full = await readPost({ ...video, skipBio: true }, ['solana'], opts);
assert.ok(Date.now() - t0 >= 2500, 'without a quick read, it waits (the bot, alerts)');
assert.equal(full.post.transcript, 'the speech');
assert.equal(full.speechPending, false);
console.log('PASS quick read: speech never holds the panel back, and the bot still waits for it');

// The bio lookup runs beside the engine, not before it.
Object.keys(log).forEach((k) => delete log[k]);
t0 = Date.now();
await readPost({ text: 'hello there', bio: `my coin ${CA}`, url: 'https://x.com/a/status/3' }, ['solana'], opts);
assert.ok(log.interpret !== undefined && log.interpret < 300, `the engine started at ${log.interpret} ms, after a 400 ms lookup`);
console.log('PASS quick read: a bio lookup does not delay the engine');

// The panel's first cards and the read share one lookup, and the read's additions don't leak into it.
let calls = 0;
const memo = new Map();
const cached = (k, _ttl, fn) => { if (!memo.has(k)) { calls++; memo.set(k, fn()); } return memo.get(k); };
const post = { text: 'no address here', url: 'https://x.com/a/status/4' };
const first = await postCoins(post, ['solana'], cached);
const before = calls;
await postCoins(post, ['solana'], cached);
assert.equal(calls, before, 'a second call is served from the cache');
assert.deepEqual(first, []);
console.log('PASS quick read: first cards are shared with the read');

// A long video's speech can take more than 15 s to transcribe: the bot waited 15 s, read the post without its speech and
// answered "No coins" (@Teezy_Cop on MarioNawfal's AI-teacher clip, whose speech named the coin). It now waits longer,
// and a read whose speech never came says so (speechLost), so the bot tries the tag again instead of answering.
{
  const { findCoins } = await import('../extension/src/lib/narrative.js');
  speechMs = 16_000;
  t0 = Date.now();
  const slow = await readPost({ ...video, skipBio: true, url: 'https://x.com/a/status/5', videoUrl: 'https://video.twimg.com/c.mp4' }, ['solana'], opts);
  assert.equal(slow.post.transcript, 'the speech', `a 16 s transcription is waited for (${Date.now() - t0} ms)`);
  assert.equal(slow.speechLost, false);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, o) => (String(url).includes('/transcribe') ? new Response('{"error":"down"}', { status: 502 }) : realFetch(url, o));
  const lost = await readPost({ ...video, skipBio: true, url: 'https://x.com/a/status/6', videoUrl: 'https://video.twimg.com/d.mp4' }, ['solana'], opts);
  assert.equal(lost.speechLost, true, 'a failed transcription is reported');
  const found = await findCoins({ ...lost, terms: [] }, ['solana'], opts);
  assert.equal(found.speechLost, true, 'and carried to the coins result');
  globalThis.fetch = async (url, o) => (String(url).includes('/transcribe') ? new Response('{"error":"video too long to transcribe"}', { status: 400 }) : realFetch(url, o));
  const long = await readPost({ ...video, skipBio: true, url: 'https://x.com/a/status/7', videoUrl: 'https://video.twimg.com/e.mp4' }, ['solana'], opts);
  assert.equal(long.speechLost, false, 'a video too long to transcribe is no reason to wait');
  globalThis.fetch = realFetch;
  console.log('PASS quick read: the bot waits for long speech, and says when it never came');
}
