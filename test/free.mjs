// Everything free (15 Nov 2026, server/holder.js freeForAll): every holder-only route answers everyone, the caps stay,
// counted against the caller's address when no holder wallet signs. FREE "0" brings the holder gate back.
// node test/free.mjs
import assert from 'node:assert/strict';
import { askRoute, ASKS_PER_WALLET } from '../server/ask.js';
import { askerOf, freeForAll, holderConfig, makeToken } from '../server/holder.js';
import { feed } from '../server/feed.js';
import { trackRecord } from '../server/track.js';
import { signalFeed } from '../server/signals.js';

// D1 stand-in: the counts table, and empty lists for everything else.
function db() {
  const rows = new Map();
  return {
    prepare(sql) {
      const stmt = {
        bind: (...args) => ({
          first: async () => (/SELECT n FROM counts/.test(sql) ? (rows.has(args.join('|')) ? { n: rows.get(args.join('|')) } : null) : null),
          run: async () => { const k = args.join('|'); rows.set(k, (rows.get(k) || 0) + 1); },
          all: async () => ({ results: [] }),
        }),
        all: async () => ({ results: [] }),
        first: async () => null,
      };
      return stmt;
    },
  };
}

// The switch: on unless FREE is "0".
assert.equal(freeForAll({}), true);
assert.equal(freeForAll({ FREE: '1' }), true);
assert.equal(freeForAll({ FREE: '0' }), false);

// Who a capped request counts against.
const env = { HOLDER_SECRET: 'test-secret', DB: db() };
const wallet = 'BTmeAebSh8MaYsTDiBiix79htKckjYQP5fvucFoFpump';
const { token } = await makeToken(env, wallet);
assert.equal(await askerOf(env, { token, __ip: '1.2.3.4' }), wallet, 'a holder still counts against their wallet');
assert.equal(await askerOf(env, { __ip: '1.2.3.4' }), 'ip:1.2.3.4', 'anyone else against their address');
assert.equal(await askerOf(env, { token: 'made.up', __ip: '1.2.3.4' }), 'ip:1.2.3.4', 'a bad token is just no token');
assert.equal(await askerOf(env, {}), null, 'no address (the worker always sets one): nothing');
assert.equal(await askerOf({ ...env, FREE: '0' }, { __ip: '1.2.3.4' }), null, 'gated again: an address is not enough');

// The settings the extension and the site read.
const cfg = await holderConfig({ ...env, RADAR_MINT: wallet });
assert.equal(cfg.free, true);
assert.equal((await holderConfig({ ...env, RADAR_MINT: wallet, FREE: '0' })).free, false);

// Ask Radar without a wallet: answered, with the daily cap per address.
const evidence = ['$TEST (Test) on Solana', "Radar's coin check: NEUTRAL 52/100"];
const answer = async () => ({ answer: 'From the card: 52/100.' });
const askEnv = { HOLDER_SECRET: 'test-secret', DB: db() };
const ask = (body, e = askEnv) => askRoute(body, e, { ai: () => ({}), answer });
let r = await ask({ question: 'safe?', evidence, __ip: '9.9.9.9' });
assert.equal(r.status, 200, JSON.stringify(r));
for (let i = 1; i < ASKS_PER_WALLET; i++) assert.equal((await ask({ question: `q${i}`, evidence, __ip: '9.9.9.9' })).status, 200);
r = await ask({ question: 'one more', evidence, __ip: '9.9.9.9' });
assert.equal(r.status, 429, 'the per-person cap holds, per address');
assert.equal((await ask({ question: 'safe?', evidence, __ip: '8.8.8.8' })).status, 200, 'another address has its own');
assert.equal((await ask({ question: 'safe?', evidence, __ip: '7.7.7.7' }, { ...askEnv, FREE: '0' })).status, 401, 'gated again: holders only');

// The feeds: live for everyone.
const now = Date.parse('2026-11-15T12:00:00Z');
const opts = { cache: { match: async () => null, put: async () => {} }, now };
assert.equal((await feed({}, { DB: db(), HOLDER_SECRET: 'x' }, opts)).live, true, 'Breaking now: live without a token');
assert.equal((await feed({}, { DB: db(), HOLDER_SECRET: 'x', FREE: '0' }, opts)).live, false, 'gated again: 10 minutes late');
assert.equal((await trackRecord({}, { DB: db(), HOLDER_SECRET: 'x' }, { now })).live, true, 'track record: live without a token');
assert.equal((await trackRecord({}, { DB: db(), HOLDER_SECRET: 'x', FREE: '0' }, { now })).live, false, 'gated again: 30 minutes late');
const sig = await signalFeed({ public: true }, { DB: db(), HOLDER_SECRET: 'x' }, { now, cache: null });
assert.equal(sig.status, 200);
assert.equal(sig.body.live, true, 'big account alerts: live for the site too');
assert.equal((await signalFeed({}, { DB: db(), HOLDER_SECRET: 'x' }, { now, cache: null })).body.live, true, 'and for the extension with no token');
assert.equal((await signalFeed({ public: true }, { DB: db(), HOLDER_SECRET: 'x', FREE: '0' }, { now, cache: null })).body.live, false, 'gated again: the public list');

// The worker sets the caller's address itself, whatever the request sends.
const src = (await import('node:fs')).readFileSync(new URL('../server/worker.js', import.meta.url), 'utf8');
assert.match(src, /const withIp = async \(request\) => \(\{ \.\.\.\(await jsonOf\(request\)\), __ip: ipOf\(request\) \}\);/, '__ip comes after the body, so it overwrites whatever was sent');
for (const route of ['lcStart(await withIp(request)', 'lcAsk(await withIp(request)', 'askRoute(await withIp(request)']) assert.ok(src.includes(route), route);

console.log('PASS free: every holder route answers everyone, caps per address, FREE "0" gates it again');
