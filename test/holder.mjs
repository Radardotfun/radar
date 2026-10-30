// The holder gate (server/holder.js), offline: real Ed25519 signatures, a fake chain and a fake Frontrun. node test/holder.mjs
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { holderMessage, holderVerify, holderWho, holderOn, holderMinUsd, holderConfig, readToken, makeToken, whoView, fromBase58 } from '../server/holder.js';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function toBase58(bytes) {
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) { carry += digits[i] << 8; digits[i] = carry % 58; carry = Math.floor(carry / 58); }
    while (carry) { digits.push(carry % 58); carry = Math.floor(carry / 58); }
  }
  let out = '';
  for (const byte of bytes) { if (byte) break; out += '1'; }
  return out + digits.reverse().map((d) => B58[d]).join('');
}
const pair = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const address = toBase58(new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey)));
assert.equal(toBase58(fromBase58(address)), address, 'base58 both ways');
const sign = async (text, key = pair.privateKey) => [...new Uint8Array(await webcrypto.subtle.sign('Ed25519', key, new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, '0')).join('');
const now = Date.parse('2026-10-30T12:00:00Z');
const issued = new Date(now - 5000).toISOString();
const env = { FRONTRUN_DATA_KEY: 'k', HOLDER_SECRET: 'test-secret', RADAR_MINT: 'RadarMint11111111111111111111111111111111111', HOLDER_MIN_USD: '1' };

// Off until every piece is set.
assert.equal(holderOn({}), false);
assert.equal(holderOn({ ...env, FRONTRUN_DATA_KEY: '' }), false);
assert.equal(holderOn(env), true);
assert.equal(holderMinUsd({}), 1);
assert.equal(holderMinUsd({ HOLDER_MIN_USD: '5' }), 5);

// $1 at $0.00001 is 100,000 tokens.
let balance = 250000;
let price = 0.00001;
let frontrunCalls = 0;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://lite-api.jup.ag')) {
    if (!price) return new Response('{}');
    return new Response(JSON.stringify({ [env.RADAR_MINT]: { usdPrice: price } }));
  }
  if (String(url).startsWith('https://rpc.test')) {
    const body = JSON.parse(init.body);
    assert.equal(body.params[1].mint, env.RADAR_MINT, 'the balance asked for is $RADAR');
    return new Response(JSON.stringify({ result: { value: [{ account: { data: { parsed: { info: { tokenAmount: { uiAmount: balance } } } } } }] } }));
  }
  frontrunCalls += 1;
  assert.equal(init.headers.authorization, 'Bearer k');
  const path = String(url).split('/').slice(-1)[0];
  const data = path === 'smart-followers' ? { totalCount: 12, meta: { resolved: true }, smartFollowers: [{ twitter: 'alice' }, { twitter: 'bad<handle>' }] }
    : path === 'tweets-with-ca-cache' ? { cacheHit: true, data: { undeletedCACount: 3, deletedCACount: 2, deletedTweetCount: 5, topUndeletedTweets: [{ ca: 'So11111111111111111111111111111111111111112', chain: 'SOLANA', isDeleted: false, tweetId: '123456', tweetTime: '2026-01-01' }], topDeletedTweets: [{ ca: 'not a ca', chain: 'SOLANA' }] } }
      : { compactLabel: 'Founder <b>', followersCount: 900 };
  return new Response(JSON.stringify({ data, code: 200, status: true }));
};

// A good signature with enough tokens gets a token; the token proves the wallet.
const good = { address, issued, signature: await sign(holderMessage(address, issued)) };
const ok = await holderVerify(good, env, 'https://rpc.test', now);
assert.equal(ok.body.holder, true);
assert.equal(await readToken(env, ok.body.token, now), address);
console.log('PASS holder: a signed wallet with enough $RADAR gets a day\'s token');

// Under $1: told what it's worth, no token. The line follows the price.
balance = 99999;
const short = await holderVerify(good, env, 'https://rpc.test', now);
assert.equal(short.body.holder, false);
assert.equal(short.body.token, undefined);
assert.equal(short.body.minUsd, 1);
assert.ok(short.body.value < 1);
price = 0.00002;
assert.equal((await holderVerify(good, env, 'https://rpc.test', now)).body.holder, true, 'the same tokens pass once they are worth $1');
price = 0;
assert.equal((await holderVerify(good, env, 'https://rpc.test', now)).status, 502, 'no price, no pass');
assert.equal((await holderConfig(env)).on, false, 'no price: off, since nobody could be checked');
price = 0.0000117;
assert.deepEqual(await holderConfig(env), { on: true, minUsd: 1, min: 86000 });
price = 0.00001;
balance = 250000;
console.log('PASS holder: the line is $1 of $RADAR at the current price');

// Forgeries.
const other = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
assert.equal((await holderVerify({ ...good, signature: await sign(holderMessage(address, issued), other.privateKey) }, env, 'https://rpc.test', now)).status, 400, 'someone else\'s key');
assert.equal((await holderVerify({ ...good, signature: await sign('something else') }, env, 'https://rpc.test', now)).status, 400, 'other words');
const old = new Date(now - 11 * 60_000).toISOString();
assert.equal((await holderVerify({ address, issued: old, signature: await sign(holderMessage(address, old)) }, env, 'https://rpc.test', now)).status, 400, 'a stale signature');
assert.equal((await holderVerify({ ...good, address: 'nope' }, env, 'https://rpc.test', now)).status, 400);
assert.equal((await holderVerify({ ...good, signature: 'zz' }, env, 'https://rpc.test', now)).status, 400);
console.log('PASS holder: forged, reworded and stale signatures are refused');

// Tokens: tampered, expired, signed with another secret.
const t = await makeToken(env, address, now);
assert.equal(await readToken(env, t.token, now + 3600_000), address);
assert.equal(await readToken(env, t.token, now + 25 * 3600_000), null, 'expired after a day');
assert.equal(await readToken({ ...env, HOLDER_SECRET: 'other' }, t.token, now), null);
const [body, mac] = t.token.split('.');
assert.equal(await readToken(env, `${body}x.${mac}`, now), null);
assert.equal(await readToken(env, 'nonsense', now), null);
console.log('PASS holder: tampered and expired tokens are refused');

// Lookups: only with a token, kept in the cache, cleaned for the panel, and limited per wallet.
const store = new Map();
const cache = { match: async (k) => store.get(k.url)?.clone(), put: async (k, v) => { store.set(k.url, v); } };
const opts = { limited: () => false, cache, now };
assert.equal((await holderWho({ token: 'bad', handle: 'someone' }, env, opts)).status, 401);
assert.deepEqual((await holderWho({ token: t.token, handle: 'someone' }, { ...env, FRONTRUN_DATA_KEY: '' }, opts)).body, { off: true });
assert.equal((await holderWho({ token: t.token, handle: 'not a handle!' }, env, opts)).status, 400);
assert.equal((await holderWho({ token: t.token, handle: 'someone' }, env, { ...opts, limited: () => true })).status, 429);
assert.equal(frontrunCalls, 0, 'nothing spent so far');
const who = await holderWho({ token: t.token, handle: '@Someone' }, env, opts);
assert.equal(who.status, 200);
assert.equal(frontrunCalls, 3);
assert.equal(who.body.smartCount, 12);
assert.deepEqual(who.body.smart, ['alice'], 'odd handles dropped');
assert.deepEqual(who.body.coins, { live: 3, deleted: 2, deletedPosts: 5 });
assert.equal(who.body.label, 'Founder  b', 'no markup');
assert.equal(who.body.recent.length, 1, 'only real contracts');
await holderWho({ token: t.token, handle: 'someone' }, env, opts);
assert.equal(frontrunCalls, 3, 'the second lookup costs no credits');
console.log('PASS holder: lookups need a token, are cached and are cleaned');
// The daily cap protects the paid credits, whoever is asking.
const capped = await holderWho({ token: t.token, handle: 'someoneelse' }, { ...env, HOLDER_DAILY_LOOKUPS: '1' }, opts);
assert.equal(capped.status, 429);
assert.equal(frontrunCalls, 3, 'over the cap, nothing is spent');
assert.equal((await holderWho({ token: t.token, handle: 'someone' }, { ...env, HOLDER_DAILY_LOOKUPS: '1' }, opts)).status, 200, 'a cached account still answers');
console.log('PASS holder: the daily cap stops new lookups, not cached ones');

// Frontrun still looking: coins is null, not zero.
assert.equal(whoView('x', { totalCount: 0 }, { cacheHit: false, data: null }, null).coins, null);
assert.equal(whoView('x', undefined, undefined, undefined).smartCount, null);
console.log('PASS holder: an account Frontrun is still looking up shows as that, not as zero');
process.exit(0);
