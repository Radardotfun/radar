// Sign in with Google for holders, offline: real RS256 signatures from a key made here, a real SQLite standing in for D1. node test/google.mjs
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { googleAccount, holderGoogle } from '../server/google.js';
import { makeToken } from '../server/holder.js';

const sql = new DatabaseSync(':memory:');
const db = { prepare: (q) => {
  const make = (args) => ({
    bind: (...a) => make(a),
    run: async () => sql.prepare(q).run(...args),
    first: async () => sql.prepare(q).get(...args) ?? null,
  });
  return make([]);
} };
const b64 = (x) => Buffer.from(x).toString('base64url');
const gen = () => webcrypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const pair = await gen();
const other = await gen();
const jwk = { ...(await webcrypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1' };
const keys = async () => [jwk];
const now = 1_800_000_000_000;
const CLIENT = 'radar-test.apps.googleusercontent.com';
const sign = async (claims, { key = pair.privateKey, kid = 'k1', alg = 'RS256' } = {}) => {
  const head = b64(JSON.stringify({ alg, kid, typ: 'JWT' }));
  const body = b64(JSON.stringify({ iss: 'https://accounts.google.com', aud: CLIENT, sub: 'google-123', exp: now / 1000 + 3600, email: 'someone@example.com', ...claims }));
  const sig = await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64(new Uint8Array(sig))}`;
};
const env = { DB: db, HOLDER_SECRET: 'test-secret', GOOGLE_CLIENT_ID: CLIENT };
const account = (cred, e = env) => googleAccount(cred, e, { now, keys });

// Only Google's signature, for this site, still good.
assert.equal(await account(await sign({})), 'google-123');
assert.equal(await account(await sign({ iss: 'accounts.google.com' })), 'google-123', 'Google uses both spellings');
assert.equal(await account(await sign({}, { key: other.privateKey })), null, 'signed by someone else');
assert.equal(await account(await sign({ aud: 'another-site' })), null, 'made for another site');
assert.equal(await account(await sign({ iss: 'https://evil.example' })), null, 'not from Google');
assert.equal(await account(await sign({ exp: now / 1000 - 1 })), null, 'run out');
assert.equal(await account(await sign({ sub: '' })), null, 'no account');
assert.equal(await account(await sign({}, { kid: 'unknown' })), null, 'a key Google does not list');
assert.equal(await account(await sign({}, { alg: 'none' })), null, 'alg none');
const good = await sign({});
const [h, , s] = good.split('.');
assert.equal(await account(`${h}.${b64(JSON.stringify({ iss: 'https://accounts.google.com', aud: CLIENT, sub: 'someone-else', exp: now / 1000 + 3600 }))}.${s}`), null, 'a changed body fails the signature');
for (const bad of ['', 'abc', 'a.b.c', null]) assert.equal(await account(bad), null);
console.log('PASS google: only a real Google sign in for this site counts');

// Off without a client id.
assert.deepEqual((await holderGoogle({ credential: good }, { DB: db, HOLDER_SECRET: 'x' }, null, { now, keys })).body, { off: true });

const WALLET = 'So11111111111111111111111111111111111111112';
let checked = [];
const passes = async (w) => { checked.push(w); return { status: 200, body: { holder: true, token: 'fresh', exp: now + 1000, value: 12, symbol: 'RADAR', coins: [] } }; };
const run = (body, check = passes) => holderGoogle(body, env, null, { now, keys, check });

assert.equal((await run({ credential: 'nope' })).status, 401, 'no sign in, nothing');
const first = await run({ credential: good });
assert.deepEqual(first.body, { linked: false }, 'a new account is not a holder yet');
assert.equal(checked.length, 0, 'and no balance read for it');

// Linking needs a wallet that signed for itself.
assert.equal((await run({ credential: good, token: 'made.up' })).status, 401, 'a made up token links nothing');
assert.deepEqual((await run({ credential: good })).body, { linked: false }, 'still not linked');
const { token } = await makeToken(env, WALLET, now);
const linked = await run({ credential: good, token });
assert.equal(linked.body.linked, true);
assert.equal(linked.body.holder, true);
assert.equal(linked.body.token, 'fresh');
assert.deepEqual(checked, [WALLET], 'its balance is read');

// From then on Google alone is enough, and the balance is read each time.
checked = [];
const again = await run({ credential: await sign({}) });
assert.equal(again.body.holder, true);
assert.deepEqual(checked, [WALLET], 'read again, not remembered');
const sold = await run({ credential: good }, async () => ({ status: 200, body: { holder: false, value: 1, symbol: 'RADAR', coins: [], minUsd: 10 } }));
assert.equal(sold.body.linked, true);
assert.equal(sold.body.holder, false, 'selling ends it');
assert.equal(sold.body.token, undefined);
assert.equal((await run({ credential: good }, async () => ({ status: 502, body: { error: 'busy' } }))).status, 502, 'a failed read says so, it is never a yes');

// Another account is its own, and nothing personal is kept.
assert.deepEqual((await run({ credential: await sign({ sub: 'google-456' }) })).body, { linked: false }, 'a different account is not linked');
const rows = sql.prepare('SELECT * FROM google_links').all();
assert.equal(rows.length, 1);
assert.equal(rows[0].wallet, WALLET);
assert.doesNotMatch(JSON.stringify(rows), /google-123|example\.com|someone/, 'no account id or email is stored');
assert.match(rows[0].account, /^[a-f0-9]{64}$/);
console.log('PASS google: linking needs a signed wallet, the balance is read each time, nothing personal is kept');
