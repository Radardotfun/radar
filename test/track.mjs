// Track record: the bot records Breaking now and Diamond Hand flags and follows their caps (bot/track.js); the server reads them
// back, live for holders and 30 minutes behind for everyone else (server/track.js). Real SQLite stands in for D1. node test/track.mjs
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { recordFlag, recordStories, refreshTrack, capsFrom, MIN_FLAG_CAP } from '../bot/track.js';
import { trackRecord, TRACK_DELAY_MS, ROWS_NEWEST, ROWS_BEST } from '../server/track.js';
import { makeToken } from '../server/holder.js';

const sql = new DatabaseSync(':memory:');
sql.exec('CREATE TABLE wire_rows (at INTEGER PRIMARY KEY, coins TEXT NOT NULL)');
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
const now = Date.parse('2026-11-07T12:00:00Z');
const M = (i) => `Mint${String(i).replace(/0/g, 'z')}${'x'.repeat(40)}`.slice(0, 44);

// ---- a flag: the first one of a coin wins; nonsense is ignored
assert.equal(await recordFlag(db, { mint: M(1), source: 'diamond', at: now - 3600_000, symbol: '$ONE', name: 'One', mc0: 8000 }), true);
assert.equal(await recordFlag(db, { mint: M(1), source: 'breaking', at: now, symbol: 'ONE', name: 'One', mc0: 90000 }), false, 'flagged again: keeps its first time and cap');
assert.equal(await recordFlag(db, { mint: 'not a mint', source: 'diamond', at: now, mc0: 5000 }), false);
assert.equal(await recordFlag(db, { mint: M(2), source: 'diamond', at: now, mc0: 0 }), false, 'no cap when flagged: nothing to measure against');
let row = sql.prepare('SELECT * FROM track WHERE mint = ?').get(M(1));
assert.equal(row.symbol, 'ONE', 'the $ comes off');
assert.equal(row.mc0, 8000);
assert.equal(row.peak, 8000);

// ---- Breaking now: a story's first coin and its biggest are flagged
const story = Array.from({ length: 7 }, (_, i) => ({ a: M(10 + i), s: `CAT${i}`, n: `Space cat ${i}`, m: i === 3 ? 40000 : 4500 + i * 100, d: `dev${i % 5}`, t: now - (20 - i) * 60_000 }));
sql.prepare('INSERT INTO wire_rows (at, coins) VALUES (?, ?)').run(now - 60_000, JSON.stringify(story));
assert.equal(await recordStories(db, now), 2);
const flagged = sql.prepare("SELECT mint, story, mc0 FROM track WHERE source = 'breaking' ORDER BY mc0").all();
assert.deepEqual(flagged.map((r) => r.mint), [M(10), M(13)], 'the first coin (earliest) and the biggest');
assert.equal(flagged[1].mc0, 40000);
assert.match(flagged[0].story, /space|cat/);
assert.equal(await recordStories(db, now + 60_000), 0, 'the same story next minute adds nothing');
// A story of fresh copies at pump.fun's launch cap is flagged only once a coin trades past the floor.
const copies = Array.from({ length: 8 }, (_, i) => ({ a: M(40 + i), s: 'DOPA', n: `Dopameme ${i}`, m: 2510 + i, d: `cp${i}`, t: now - (25 - i) * 60_000 }));
sql.prepare('INSERT INTO wire_rows (at, coins) VALUES (?, ?)').run(now - 30_000, JSON.stringify([...story, ...copies, { ...copies[0], a: M(49), m: 16000, t: now - 2 * 60_000 }]));
assert.equal(MIN_FLAG_CAP, 4000);
assert.equal(await recordStories(db, now + 90_000), 1, 'only the one copy that traded up');
assert.deepEqual(sql.prepare("SELECT mint FROM track WHERE story LIKE '%dopameme%'").all().map((r) => r.mint), [M(49)]);
sql.prepare('DELETE FROM track WHERE mint = ?').run(M(49));

// ---- refresh: current cap, and the peak only when it's a new high
assert.deepEqual([...capsFrom([{ baseToken: { address: 'A' }, marketCap: 10 }, { baseToken: { address: 'A' }, marketCap: 30 }, { baseToken: { address: 'B' }, fdv: 7 }])], [['A', 30], ['B', 7]]);
let caps = { [M(1)]: 50000, [M(10)]: 6000, [M(13)]: 20000 };
const fetcher = async (url) => {
  const mints = decodeURIComponent(url.split('/').pop()).split(',');
  return new Response(JSON.stringify(mints.filter((m) => caps[m]).map((m) => ({ baseToken: { address: m }, marketCap: caps[m] }))));
};
assert.equal(await refreshTrack(db, fetcher, now + 120_000), 3);
row = sql.prepare('SELECT * FROM track WHERE mint = ?').get(M(1));
assert.equal(row.mc, 50000); assert.equal(row.peak, 50000); assert.equal(row.peak_at, now + 120_000);
caps = { [M(1)]: 20000, [M(10)]: 9000 };
await refreshTrack(db, fetcher, now + 240_000);
row = sql.prepare('SELECT * FROM track WHERE mint = ?').get(M(1));
assert.equal(row.mc, 20000, 'now falls'); assert.equal(row.peak, 50000, 'the peak stays');
row = sql.prepare('SELECT * FROM track WHERE mint = ?').get(M(13));
assert.equal(row.mc, 20000, 'a coin DexScreener no longer lists keeps its last numbers');

// ---- read side: holders live, others 30 minutes behind and without Diamond Hand
const env = { DB: db, HOLDER_SECRET: 'test-secret' };
const t = now + 300_000;
const { token } = await makeToken(env, 'WaLLet1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', t);
const live = await trackRecord({ token }, env, { now: t });
assert.equal(live.live, true);
assert.deepEqual(live.rows.map((r) => r.symbol).sort(), ['CAT0', 'CAT3', 'ONE']);
const one = live.rows.find((r) => r.symbol === 'ONE');
assert.equal(one.peakX, 6.3); assert.equal(one.nowX, 2.5); assert.equal(one.source, 'diamond');
assert.deepEqual(live.summary, { flags: 3, x2: 2, x10: 0, shown: 3, best: { symbol: 'ONE', peakX: 6.3, mint: M(1) } });
const pub = await trackRecord({}, env, { now: t });
assert.equal(pub.live, false);
assert.deepEqual(pub.rows, [], 'the Breaking now flags are 5 minutes old: not public yet; Diamond Hand never');
const later = await trackRecord({}, env, { now: now + TRACK_DELAY_MS + 60_000 });
assert.deepEqual(later.rows.map((r) => r.symbol).sort(), ['CAT0', 'CAT3'], 'public after 30 minutes, still without Diamond Hand');
assert.equal((await trackRecord({ token: 'forged.token' }, env, { now: t })).live, false);
// before the bot has made the table: an empty record, not an error
const empty = { DB: { prepare: () => ({ bind() { return this; }, first: async () => null, all: async () => ({ results: [] }) }) }, HOLDER_SECRET: 'x' };
assert.deepEqual((await trackRecord({}, empty, { now })).rows, []);

// ---- more flags than the list carries: the summary counts them all, and the list keeps the best as well as the newest
{
  const big = new DatabaseSync(':memory:');
  const bdb = { prepare(q) { let args = []; const api = { bind(...a) { args = a; return api; }, async first() { return big.prepare(q).get(...args) ?? null; }, async run() { const r = big.prepare(q).run(...args); return { meta: { changes: r.changes } }; }, async all() { return { results: big.prepare(q).all(...args) }; } }; return api; } };
  const n = ROWS_NEWEST + ROWS_BEST + 50;
  big.exec('CREATE TABLE track (mint TEXT PRIMARY KEY, source TEXT NOT NULL, at INTEGER NOT NULL, symbol TEXT, name TEXT, story TEXT, mc0 REAL NOT NULL, mc REAL, peak REAL, peak_at INTEGER, checked INTEGER NOT NULL DEFAULT 0)');
  const ins = big.prepare('INSERT INTO track (mint, source, at, symbol, name, story, mc0, mc, peak, peak_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const T0 = now + 86_400_000;
  // The oldest flag is the day's best (12x); the newest ones are flat; one in the middle is a diamond.
  for (let i = 0; i < n; i++) ins.run(`B${i}`, i === 300 ? 'diamond' : 'breaking', T0 - (n - i) * 60_000, `S${i}`, '', '', 5000, 5000, i === 0 ? 60000 : i % 50 === 0 ? 12000 : 5000, null);
  const env2 = { DB: bdb, HOLDER_SECRET: 'test-secret' };
  const { token: tk } = await makeToken(env2, 'WaLLet1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', T0);
  const all = await trackRecord({ token: tk, hours: 72 }, env2, { now: T0 });
  assert.equal(all.summary.flags, n, 'every flag in range is counted, not just the ones listed');
  assert.equal(all.summary.x2, Math.floor((n - 1) / 50) + 1, 'the 2.4x flags and the 12x one');
  assert.equal(all.summary.x10, 1);
  assert.equal(all.summary.best.symbol, 'S0', 'the best is the oldest flag, past the newest rows');
  assert.ok(all.rows.some((r) => r.symbol === 'S0'), 'and it is in the list');
  assert.ok(all.rows.length <= ROWS_NEWEST + ROWS_BEST && all.summary.shown === all.rows.length);
  assert.equal(new Set(all.rows.map((r) => r.mint)).size, all.rows.length, 'no coin twice');
  assert.ok(all.rows.every((r, i, a) => !i || a[i - 1].at >= r.at), 'newest first');
  const pub2 = await trackRecord({ hours: 72 }, env2, { now: T0 + TRACK_DELAY_MS });
  assert.equal(pub2.summary.flags, n - 1, 'the public count leaves out Diamond Hand too');
}

console.log('PASS track: flags recorded once and only past $4K, caps followed, every flag counted, read live for holders and late for everyone else');
