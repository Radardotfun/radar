// Signing in on a computer with a wallet on a phone, offline, on a real SQLite standing in for D1. node test/holderpair.mjs
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { PAIR_ID, savePair, takePair } from '../server/holderpair.js';

const sql = new DatabaseSync(':memory:');
const db = { prepare: (q) => {
  const make = (args) => ({
    bind: (...a) => make(a),
    run: async () => sql.prepare(q).run(...args),
    first: async () => sql.prepare(q).get(...args) ?? null,
  });
  return make([]);
} };
const id = 'a'.repeat(32);
const now = 1_800_000_000_000;

assert.ok(PAIR_ID.test(id));
for (const bad of ['', 'short', `${'a'.repeat(31)}Z`, `${id}a`, "a' OR 1=1 --"]) assert.equal(PAIR_ID.test(bad), false, bad);
assert.equal((await takePair(db, 'nope', now)).status, 400, 'a bad id is refused');
assert.equal(await savePair(db, 'nope', { holder: true, token: 't' }, now), false, 'a bad id is never stored');

assert.deepEqual((await takePair(db, id, now)).body, { ready: false }, 'nothing yet');
assert.equal(await savePair(db, id, { holder: true, token: 'tok', exp: now + 1000, value: 12, symbol: 'RADAR', coins: [], minUsd: 10, address: 'secret-extra' }, now), true);
const got = await takePair(db, id, now + 1000);
assert.equal(got.body.ready, true);
assert.equal(got.body.token, 'tok');
assert.equal(got.body.address, undefined, 'only what the computer needs');
assert.deepEqual((await takePair(db, id, now + 2000)).body, { ready: false }, 'it can be collected once');

// Under the line: the computer can say so, with no token.
const low = 'b'.repeat(32);
await savePair(db, low, { holder: false, value: 2, symbol: 'RADAR', coins: [{ symbol: 'RADAR', balance: 5, value: 2 }], minUsd: 10 }, now);
const lowGot = await takePair(db, low, now);
assert.equal(lowGot.body.holder, false);
assert.equal(lowGot.body.token, undefined);

// An answer nobody collected goes stale, and old ones are cleared.
const old = 'c'.repeat(32);
await savePair(db, old, { holder: true, token: 'x' }, now);
assert.deepEqual((await takePair(db, old, now + 11 * 60_000)).body, { ready: false }, 'stale');
await savePair(db, 'd'.repeat(32), { holder: true, token: 'y' }, now + 20 * 60_000);
assert.equal(sql.prepare('SELECT COUNT(*) n FROM holder_pairs WHERE id = ?').get(old).n, 0, 'cleared on the next save');
console.log('PASS holderpair: one collection, nothing extra, goes stale, bad ids refused');
