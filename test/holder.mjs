// The holder gate (server/holder.js), offline: real Ed25519 signatures, a fake chain and a fake Frontrun. node test/holder.mjs
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { recordPost, ledgerWho, isAddress, addressesIn } from '../server/ledger.js';
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
// D1, as far as the record uses it.
function fakeDb() {
  const rows = [];
  return {
    rows,
    prepare(sql) {
      return { bind: (...a) => ({
        first: async () => (rows.some((r) => r.id === a[0]) ? { 1: 1 } : null),
        all: async () => ({ results: rows.filter((r) => r.author === a[0]).sort((x, y) => y.at - x.at).map((r) => ({ ...r })) }),
        run: async () => {
          if (/^INSERT/.test(sql)) { if (!rows.some((r) => r.id === a[0] && r.ca === a[2])) rows.push({ id: a[0], author: a[1], ca: a[2], at: a[3], gone: 0, checked: a[4] }); }
          else for (const r of rows) if (r.id === a[2]) { r.gone = a[0]; r.checked = a[1]; }
        },
      }) };
    },
  };
}
const env = { DB: fakeDb(), FRONTRUN_DATA_KEY: 'k', HOLDER_SECRET: 'test-secret', RADAR_MINT: 'RadarMint11111111111111111111111111111111111', HOLDER_MIN_USD: '1' };

// Off until every piece is set.
assert.equal(holderOn({}), false);
assert.equal(holderOn({ ...env, DB: null }), false);
assert.equal(holderOn({ ...env, FRONTRUN_DATA_KEY: '' }), true, 'Frontrun is an add-on');
assert.equal(holderOn(env), true);
assert.equal(holderMinUsd({}), 1);
assert.equal(holderMinUsd({ HOLDER_MIN_USD: '5' }), 5);

// $1 at $0.00001 is 100,000 tokens.
let balance = 250000;
let price = 0.00001;
let frontrunCalls = 0;
const statuses = new Map();
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://api.fxtwitter.com/status/')) {
    const st = statuses.get(String(url).split('/').pop());
    if (st === 'busy') return new Response('{}', { status: 500 });
    return st ? new Response(JSON.stringify({ tweet: st })) : new Response('{}', { status: 404 });
  }
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
const config = await holderConfig(env);
assert.equal(config.on, true);
assert.ok(config.pitch.startsWith('Hold $1 of $RADAR'));
assert.match(config.pitch, /smart followers/, 'with a Frontrun key');
assert.doesNotMatch((await holderConfig({ ...env, FRONTRUN_DATA_KEY: '' })).pitch, /smart followers/, 'without one, no such promise');
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
assert.deepEqual((await holderWho({ token: t.token, handle: 'someone' }, { ...env, DB: null }, opts)).body, { off: true });
const free = await holderWho({ token: t.token, handle: 'someone' }, { ...env, FRONTRUN_DATA_KEY: '' }, opts);
assert.deepEqual(free.body.own.coins, { live: 0, deleted: 0, deletedPosts: 0 }, 'works with no Frontrun key');
assert.equal(free.body.smartCount, undefined);
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
assert.equal(capped.status, 200, "Radar's own record still answers");
assert.equal(capped.body.smartCount, undefined);
assert.equal(frontrunCalls, 3, 'over the cap, nothing is spent');
assert.equal((await holderWho({ token: t.token, handle: 'someone' }, { ...env, HOLDER_DAILY_LOOKUPS: '1' }, opts)).body.smartCount, 12, 'a cached account still answers');
console.log('PASS holder: the daily cap stops new lookups, not cached ones');

// Frontrun still looking: coins is null, not zero.
assert.equal(whoView('x', { totalCount: 0 }, { cacheHit: false, data: null }, null).coins, null);
assert.equal(whoView('x', undefined, undefined, undefined).smartCount, null);
console.log('PASS holder: an account Frontrun is still looking up shows as that, not as zero');

// Radar's own record. A post only counts once its real text shows that author writing that contract.
const SOL = 'So11111111111111111111111111111111111111112';
const SOL2 = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const EVM = '0x7fe995a80075df3dc8ae11a9b82c7fe4202cd87f';
assert.equal(isAddress(SOL), true);
assert.equal(isAddress(EVM), true);
assert.equal(isAddress('1111111111111111111111111111111111'), false, 'not 32 bytes');
assert.equal(isAddress('abcdefghijkmnopqrstuvwxyzabcdefghijkmn'), false, 'a long word');
assert.deepEqual(addressesIn(`buy ${SOL} and ${EVM} and notanaddress`), [SOL, EVM]);
const db = fakeDb();
const benv = { DB: db };
const tweet = (id, author, text, at) => statuses.set(id, { author: { screen_name: author }, text, created_timestamp: at });
tweet('100001', 'RealGuy', `aped ${SOL}`, 1000);
await recordPost(benv, { url: 'https://x.com/RealGuy/status/100001', author: 'RealGuy', text: `aped ${SOL}` });
assert.equal(db.rows.length, 1);
assert.deepEqual([db.rows[0].author, db.rows[0].ca, db.rows[0].at], ['realguy', SOL, 1000000], 'as the real post has it, not as the client said');
// Lies from a client: another author's name, a contract the post doesn't have, a post that isn't there.
tweet('100002', 'Victim', 'gm everyone', 2000);
await recordPost(benv, { url: 'https://x.com/Victim/status/100002', author: 'Victim', text: `gm everyone ${SOL2}` });
await recordPost(benv, { url: 'https://x.com/Nobody/status/100003', author: 'Nobody', text: `${SOL2}` });
tweet('100004', 'Honest', `${SOL2}`, 3000);
await recordPost(benv, { url: 'https://x.com/Victim/status/100004', author: 'Victim', text: `${SOL2}` });
assert.deepEqual(db.rows.map((r) => r.author), ['realguy', 'honest'], 'nothing pinned on the wrong account');
statuses.set('100005', 'busy');
await recordPost(benv, { url: 'https://x.com/x/status/100005', author: 'x', text: SOL });
assert.equal(db.rows.length, 2, 'a busy FxTwitter records nothing');
console.log('PASS ledger: only what the real post says is recorded');
// Lookups: posts still up, posts gone, and a busy FxTwitter proves nothing.
const later = 1000000 + 7 * 3600_000 + Date.now();
tweet('100006', 'RealGuy', `${EVM}`, 4000);
await recordPost(benv, { url: 'https://x.com/RealGuy/status/100006', text: EVM });
tweet('100007', 'RealGuy', `again ${SOL}`, 5000);
await recordPost(benv, { url: 'https://x.com/RealGuy/status/100007', text: `again ${SOL}` });
statuses.delete('100006');
statuses.set('100001', 'busy');
const seen = await ledgerWho(benv, 'REALGUY', later);
assert.deepEqual(seen.coins, { live: 1, deleted: 1, deletedPosts: 1 }, 'one coin only in a gone post; the other still up in another post');
assert.deepEqual(seen.recent.map((r) => r.ca), [SOL, EVM], 'newest first, once per coin');
assert.equal(seen.recent[1].gone, true);
assert.equal(db.rows.find((r) => r.id === '100001').gone, 0, 'busy is not gone');
assert.deepEqual((await ledgerWho(benv, 'nobody', later)).coins, { live: 0, deleted: 0, deletedPosts: 0 });
console.log('PASS ledger: lookups count coins and posts that are gone');
process.exit(0);
