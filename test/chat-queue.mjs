// Discord and Telegram scans wait in the queue and the minute's run starts them (bot/chat.js). node test/chat-queue.mjs
// A webhook only adds a row: work it starts itself gets about 30 seconds, and a slow post was cut off with no answer.
// D1 is stood in for by Node's own SQLite with the real schema (server/ledger.sql); nothing leaves this machine.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createChat } from '../bot/chat.js';

const sql = new DatabaseSync(':memory:');
sql.exec(fs.readFileSync(new URL('../server/ledger.sql', import.meta.url), 'utf8'));
const DB = {
  prepare(q) {
    let args = [];
    const api = {
      bind(...a) { args = a; return api; },
      async first() { return sql.prepare(q).get(...args) ?? null; },
      async run() { sql.prepare(q).run(...args); return {}; },
      async all() { return { results: sql.prepare(q).all(...args) }; },
    };
    return api;
  },
};
const queued = () => sql.prepare("SELECT v FROM bot_kv WHERE k >= 'job:' AND k < 'job;' ORDER BY k").all().map((r) => JSON.parse(r.v));

// SELF: each /chat-job run, recorded. Answers come from `answer` (a retry, or done).
const runs = [];
let answer = () => ({ ok: true });
const self = { fetch: async (_url, init) => { const job = JSON.parse(init.body); runs.push(job); return new Response(JSON.stringify(answer(job))); } };
const chat = createChat({ fetch: async () => new Response(JSON.stringify({ pools: [] })), self, scan: async () => { throw new Error('the scan runs in /chat-job, not here'); } });

const hex = (u) => Buffer.from(u).toString('hex');
const pair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
const env = {
  DB, BOT_TOKEN: 't', DISCORD_APP_ID: 'app', TELEGRAM_BOT_TOKEN: 'tg', TELEGRAM_SECRET: 'sek',
  DISCORD_PUBLIC_KEY: hex(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))),
};
const later = [];
const ctx = { waitUntil: (p) => later.push(p) };

// 1. Discord /scan: answered "thinking" at once, with the scan queued and not started.
{
  const body = JSON.stringify({ type: 2, id: 'i1', token: 'tok1', guild_id: 'g1', channel_id: 'c1', data: { name: 'scan', options: [{ value: 'look https://x.com/someone/status/111' }] } });
  const sig = hex(new Uint8Array(await crypto.subtle.sign('Ed25519', pair.privateKey, new TextEncoder().encode(`1700${body}`))));
  const res = await chat.interaction(new Request('https://radar-bot/discord', { method: 'POST', body, headers: { 'x-signature-ed25519': sig, 'x-signature-timestamp': '1700' } }), env, ctx);
  assert.equal((await res.json()).type, 5, 'deferred: Discord shows "thinking"');
  assert.equal(runs.length, 0, 'the webhook starts no scan');
  assert.equal(later.length, 0, 'and leaves nothing running after its answer');
  assert.deepEqual(queued(), [{ via: 'discord-interaction', token: 'tok1', url: 'https://x.com/i/status/111', tries: 0 }]);
  console.log('PASS chat: a Discord scan is queued, never run inside the webhook');
}

// 2. Telegram, two links in one message: both queued before the webhook answers.
{
  const update = { message: { message_id: 7, chat: { id: -100 }, from: { is_bot: false }, text: 'https://x.com/a/status/222 and https://fxtwitter.com/b/status/333' } };
  const res = await chat.telegramUpdate(new Request('https://radar-bot/telegram', { method: 'POST', body: JSON.stringify(update), headers: { 'x-telegram-bot-api-secret-token': 'sek' } }), env, ctx);
  assert.equal(await res.text(), 'ok');
  assert.equal(runs.length, 0);
  assert.equal(later.length, 0);
  assert.deepEqual(queued().slice(1).map((j) => [j.via, j.chat, j.message, j.url, j.tries]), [
    ['telegram', -100, 7, 'https://x.com/i/status/222', 0],
    ['telegram', -100, 7, 'https://x.com/i/status/333', 0],
  ]);
  const wrong = await chat.telegramUpdate(new Request('https://radar-bot/telegram', { method: 'POST', body: JSON.stringify(update), headers: { 'x-telegram-bot-api-secret-token': 'nope' } }), env, ctx);
  assert.equal(wrong.status, 403);
  assert.equal(queued().length, 3, 'a wrong secret queues nothing');
  console.log('PASS chat: both links in a Telegram message are queued before it answers');
}

// 3. The minute's run starts them, oldest first, each in its own /chat-job run.
{
  await chat.tick(env);
  assert.deepEqual(runs.map((j) => j.url), ['https://x.com/i/status/111', 'https://x.com/i/status/222', 'https://x.com/i/status/333']);
  assert.equal(queued().length, 0, 'started jobs leave the queue');
  assert.equal((await chat.status(env)).pending, 0);
  console.log('PASS chat: the next run starts the queued scans');
}

// 4. A scan DexScreener left short is queued again with one more try, and runs the minute after.
{
  runs.length = 0;
  await sql.prepare("INSERT INTO bot_kv (k, v) VALUES ('job:000000000000001:a', ?)").run(JSON.stringify({ via: 'telegram', chat: 1, message: 1, url: 'https://x.com/i/status/444', tries: 0 }));
  answer = () => ({ retry: true });
  await chat.tick(env);
  assert.equal(runs.length, 1);
  assert.deepEqual(queued().map((j) => [j.url, j.tries]), [['https://x.com/i/status/444', 1]]);
  answer = () => ({ ok: true });
  await chat.tick(env);
  assert.deepEqual(runs.map((j) => j.tries), [0, 1]);
  assert.equal(queued().length, 0);
  console.log('PASS chat: a short scan comes back with one more try');
}

// 5. Five a minute; two runs that overlap never start the same job twice.
{
  runs.length = 0;
  for (let i = 0; i < 7; i++) await sql.prepare('INSERT INTO bot_kv (k, v) VALUES (?, ?)').run(`job:00000000000000${i}:x`, JSON.stringify({ via: 'telegram', chat: 1, message: i, url: `https://x.com/i/status/${500 + i}`, tries: 0 }));
  await Promise.all([chat.tick(env), chat.tick(env)]);
  const urls = runs.map((j) => j.url);
  assert.equal(new Set(urls).size, urls.length, 'no job started twice');
  assert.equal(urls.length + queued().length, 7, 'and none lost');
  console.log('PASS chat: overlapping runs share the queue without doubling a scan');
}

// 6. Retries saved as one list by the version before go back in line and run.
{
  runs.length = 0;
  while (queued().length) await chat.tick(env);
  runs.length = 0;
  await sql.prepare("INSERT INTO bot_kv (k, v) VALUES ('pending', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v").run(JSON.stringify([{ via: 'telegram', chat: 2, message: 2, url: 'https://x.com/i/status/900', tries: 2 }]));
  await chat.tick(env);
  assert.deepEqual(runs.map((j) => [j.url, j.tries]), [['https://x.com/i/status/900', 2]]);
  assert.deepEqual(JSON.parse(sql.prepare("SELECT v FROM bot_kv WHERE k = 'pending'").get().v), []);
  console.log('PASS chat: the old retry list is drained into the queue');
}
process.exit(0);
