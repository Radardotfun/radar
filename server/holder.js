// Holder-only data: people holding $RADAR see who is behind a post: Radar's own record of the coins an account has posted
// (server/ledger.js) and, once a key is set, Frontrun's paid data (frontrun.pro).
// A wallet proves itself by signing a message (a signature, not a transaction: it can't move funds). The server checks
// the signature and the wallet's balance on-chain, and hands back a token good for a day, so someone who sells loses
// access within a day. The code is public, so this check can only live here, and so does the Frontrun key: its docs
// say never to put a key in a browser.
//
// On when HOLDER_SECRET (secret), RADAR_MINT and HOLDER_MIN_USD (vars) and the DB binding are set. FRONTRUN_DATA_KEY
// (secret) adds Frontrun. One fresh Frontrun lookup costs 40 credits (10 smart followers, 20 past coins, 10 profile), kept
// 6 hours per account. With a $1 entry, one wallet could otherwise spend the whole plan, so a wallet gets 30 a day and
// everyone together HOLDER_DAILY_LOOKUPS (default 250: API Basic's 300,000 credits over a month).
import { ledgerWho } from './ledger.js';

const ISSUED_WINDOW = 10 * 60_000;
const TOKEN_LIFE = 24 * 3600_000;
const FRONTRUN = 'https://api.frontrun.pro/api/v1/pro/twitter';
const HANDLE = /^\w{1,15}$/;
const SOL_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const holderMinUsd = (env) => { const n = Number(env.HOLDER_MIN_USD); return Number.isFinite(n) && n > 0 ? n : 1; };
export const holderOn = (env) => !!(env.HOLDER_SECRET && env.RADAR_MINT && env.DB);
const money = (n) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
// What the panel tells someone who hasn't checked their wallet. From here, so it stays true when Frontrun is added.
const pitch = (env) => `Hold ${money(holderMinUsd(env))} of $RADAR to see the coins this account has posted before, and which of those posts are gone${env.FRONTRUN_DATA_KEY ? ', plus its smart followers' : ''}.`;

// $RADAR's price in USD, from Jupiter: DexScreener often has none for a coin on its launch curve. Throws if there is none.
async function radarPrice(env) {
  const r = await fetch(`https://lite-api.jup.ag/price/v3?ids=${env.RADAR_MINT}`, { signal: AbortSignal.timeout(8000) });
  const p = r.ok ? Number((await r.json())[env.RADAR_MINT]?.usdPrice) : NaN;
  if (!Number.isFinite(p) || p <= 0) throw new Error('no price');
  return p;
}
/** -> { on, minUsd, pitch }. Off if the price can't be read, since nobody could be checked. */
export async function holderConfig(env) {
  const minUsd = holderMinUsd(env);
  if (!holderOn(env)) return { on: false, minUsd };
  try { await radarPrice(env); return { on: true, minUsd, pitch: pitch(env) }; } catch { return { on: false, minUsd }; }
}

// What the wallet signs. web/holder.js writes the same words.
export const holderMessage = (address, issued) => `Radar holder check\n\nThis only proves you own this wallet. It can't move funds.\n\nWallet: ${address}\nIssued: ${issued}`;

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function fromBase58(text) {
  const out = [];
  for (const ch of String(text)) {
    let carry = B58.indexOf(ch);
    if (carry < 0) return null;
    for (let i = 0; i < out.length; i += 1) { carry += out[i] * 58; out[i] = carry & 255; carry >>= 8; }
    while (carry) { out.push(carry & 255); carry >>= 8; }
  }
  for (const ch of String(text)) { if (ch !== '1') break; out.push(0); }
  return new Uint8Array(out.reverse());
}
const fromHex = (h) => new Uint8Array((String(h).match(/../g) || []).map((b) => parseInt(b, 16)));
const toB64Url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64Url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function signed(env, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.HOLDER_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toB64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text))));
}
export async function makeToken(env, address, now = Date.now()) {
  const body = toB64Url(new TextEncoder().encode(JSON.stringify({ a: address, exp: now + TOKEN_LIFE })));
  return { token: `${body}.${await signed(env, body)}`, exp: now + TOKEN_LIFE };
}
// The wallet in a valid, unexpired token, or null.
export async function readToken(env, token, now = Date.now()) {
  const [body, mac] = String(token || '').split('.');
  if (!body || !mac) return null;
  if (await signed(env, body) !== mac) return null;
  try {
    const { a, exp } = JSON.parse(new TextDecoder().decode(fromB64Url(body)));
    return exp > now && SOL_ADDRESS.test(a) ? a : null;
  } catch { return null; }
}

async function validSignature({ address, issued, signature }, now) {
  const at = Date.parse(issued);
  if (!Number.isFinite(at) || Math.abs(now - at) > ISSUED_WINDOW) return false;
  const pub = fromBase58(address);
  const sig = fromHex(signature);
  if (pub?.length !== 32 || sig.length !== 64) return false;
  try {
    const key = await crypto.subtle.importKey('raw', pub, { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify('Ed25519', key, sig, new TextEncoder().encode(holderMessage(address, issued)));
  } catch { return false; }
}

// How much $RADAR the wallet holds, across its token accounts. Throws if the chain can't say.
async function balanceOf(rpcUrl, env, address) {
  const r = await fetch(rpcUrl, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTokenAccountsByOwner', params: [address, { mint: env.RADAR_MINT }, { encoding: 'jsonParsed' }] }),
  });
  const d = await r.json().catch(() => null);
  if (!r.ok || !d || d.error || !Array.isArray(d.result?.value)) throw new Error('rpc');
  return d.result.value.reduce((sum, a) => sum + Number(a.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0), 0);
}

/** { address, issued, signature (hex) } -> { holder, balance, value, minUsd, token?, exp? } */
export async function holderVerify(body, env, rpcUrl, now = Date.now()) {
  const address = String(body?.address || '');
  if (!SOL_ADDRESS.test(address) || !await validSignature({ address, issued: String(body?.issued || ''), signature: String(body?.signature || '') }, now)) return { status: 400, body: { error: 'That signature did not check out. Try again.' } };
  let balance;
  let price;
  try { [balance, price] = await Promise.all([balanceOf(rpcUrl, env, address), radarPrice(env)]); } catch { return { status: 502, body: { error: "Couldn't read your balance right now. Try again in a moment." } }; }
  const minUsd = holderMinUsd(env);
  const value = balance * price;
  if (value < minUsd) return { status: 200, body: { holder: false, balance, value, minUsd } };
  return { status: 200, body: { holder: true, balance, value, minUsd, ...await makeToken(env, address, now) } };
}

const text = (s, n) => (typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f<>]/g, ' ').trim().slice(0, n) : '');

// Only what the panel shows. Frontrun's field names are from its API docs (30 Oct 2026).
export function whoView(handle, smart, past, info) {
  // The cached route answers { cacheHit, data }, and data is null on a miss.
  const coins = past && 'cacheHit' in past ? past.data : past;
  const rows = [...(coins?.topUndeletedTweets || []), ...(coins?.topDeletedTweets || [])];
  return {
    handle,
    label: text(info?.compactLabel || info?.primaryLabel, 60),
    followers: Number.isFinite(info?.followersCount) ? info.followersCount : null,
    smartCount: Number.isFinite(smart?.totalCount) ? smart.totalCount : null,
    smartFinal: !!smart?.meta?.resolved,
    smart: (smart?.smartFollowers || []).slice(0, 5).map((s) => text(s?.twitter, 15)).filter((h) => HANDLE.test(h)),
    // Null until Frontrun has this account: its first answer can be empty while it looks.
    coins: coins ? { live: Number(coins.undeletedCACount) || 0, deleted: Number(coins.deletedCACount) || 0, deletedPosts: Number(coins.deletedTweetCount) || 0 } : null,
    recent: rows.slice(0, 4).map((r) => ({ ca: /^([1-9A-HJ-NP-Za-km-z]{32,44}|0x[0-9a-fA-F]{40})$/.test(r?.ca || '') ? r.ca : '', chain: text(r?.chain, 12), deleted: !!r?.isDeleted, at: text(r?.tweetTime, 30), id: /^\d{5,25}$/.test(r?.tweetId || '') ? r.tweetId : '' })).filter((r) => r.ca),
  };
}

/** { token, handle } -> who's behind the account, for holders: { handle, own, ...Frontrun's fields once there's a key }. */
export async function holderWho(body, env, { limited, cache = caches.default, now = Date.now() }) {
  if (!holderOn(env)) return { status: 200, body: { off: true } };
  const wallet = await readToken(env, body?.token, now);
  if (!wallet) return { status: 401, body: { error: 'Your holder check ran out. Connect your wallet again.' } };
  const handle = String(body?.handle || '').replace(/^@/, '');
  if (!HANDLE.test(handle)) return { status: 400, body: { error: 'Not an X account' } };
  if (limited(`own:${wallet}`, 300, 24 * 3600_000)) return { status: 429, body: { error: 'You reached 300 lookups for today. Try again tomorrow.' } };
  const id = handle.toLowerCase();
  const [own, paid] = await Promise.all([ledgerWho(env, id, now), frontrunWho(env, id, wallet, { limited, cache, now }).catch(() => null)]);
  return { status: 200, body: { handle: id, own, ...(paid || {}) } };
}

// Frontrun's data on an account, or null: no key, a limit reached or Frontrun down all leave Radar's own record standing.
async function frontrunWho(env, id, wallet, { limited, cache, now }) {
  if (!env.FRONTRUN_DATA_KEY) return null;
  const key = new Request(`https://cache.narrative-radar/fr1/${id}`);
  const hit = await cache.match(key);
  if (hit) return hit.json();
  // Only a fresh lookup spends credits, so only that counts.
  if (limited(`who:${wallet}`, 30, 24 * 3600_000)) return null;
  const spentKey = new Request(`https://cache.narrative-radar/fr-day/${new Date(now).toISOString().slice(0, 10)}`);
  const spent = Number(await (await cache.match(spentKey))?.text()) || 0;
  if (spent >= (Number(env.HOLDER_DAILY_LOOKUPS) || 250)) return null;
  await cache.put(spentKey, new Response(String(spent + 1), { headers: { 'cache-control': 'public, max-age=90000' } }));
  const get = async (path) => {
    const r = await fetch(`${FRONTRUN}/${id}/${path}`, { headers: { accept: 'application/json', authorization: `Bearer ${env.FRONTRUN_DATA_KEY}` }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`frontrun ${r.status}`);
    return (await r.json()).data;
  };
  const [smart, past, info] = await Promise.allSettled([get('smart-followers'), get('tweets-with-ca-cache'), get('info')]);
  if (smart.status === 'rejected' && past.status === 'rejected' && info.status === 'rejected') {
    console.error('frontrun', smart.reason?.message);
    return null;
  }
  const view = whoView(id, smart.value, past.value, info.value);
  // An account Frontrun is still looking up is asked again soon; each ask costs credits, so not sooner than it suggests.
  const ttl = view.coins ? 6 * 3600 : 120;
  await cache.put(key, new Response(JSON.stringify(view), { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${ttl}` } }));
  return view;
}
