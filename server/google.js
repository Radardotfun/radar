// Sign in with Google for holders. Google can't say what a wallet holds, so a Google account is linked once to a wallet already proven
// by a signature (a holder token), and after that signing in reads that wallet's balance again. Radar keeps only a keyed hash of Google's
// account id and the wallet: no email, no name. A token unlocks holder perks only: Google sign in can never move funds or sign anything.
// Off until GOOGLE_CLIENT_ID is set.
import { readToken, holderForWallet } from './holder.js';

const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const CERTS = 'https://www.googleapis.com/oauth2/v3/certs';
const fromB64Url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function googleKeys() {
  const key = new Request(CERTS);
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const hit = cache && await cache.match(key);
  const res = hit || await fetch(CERTS, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`Google keys ${res.status}`);
  if (cache && !hit) await cache.put(key, new Response(res.clone().body, { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' } }));
  return (await res.json()).keys || [];
}

/** The account id in a Google sign in, or null unless Google signed it, for this site, and it's still good. */
export async function googleAccount(credential, env, { now = Date.now(), keys = googleKeys } = {}) {
  const parts = String(credential || '').split('.');
  if (parts.length !== 3 || !env.GOOGLE_CLIENT_ID) return null;
  try {
    const head = JSON.parse(new TextDecoder().decode(fromB64Url(parts[0])));
    const claims = JSON.parse(new TextDecoder().decode(fromB64Url(parts[1])));
    if (head.alg !== 'RS256') return null;
    const jwk = (await keys()).find((k) => k.kid === head.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const good = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromB64Url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!good || claims.aud !== env.GOOGLE_CLIENT_ID || !ISSUERS.has(claims.iss) || !(claims.exp * 1000 > now) || !claims.sub) return null;
    return String(claims.sub);
  } catch { return null; }
}

// The id Google gives an account, kept only as a hash nobody can reverse without the server's secret.
async function accountKey(sub, env) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.HOLDER_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`google:${sub}`));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** { credential, token? }: with a holder token, links this Google account to that token's wallet. Then checks the linked wallet, if there is one. */
export async function holderGoogle(body, env, rpcUrl, { now = Date.now(), keys, check = holderForWallet } = {}) {
  if (!env.GOOGLE_CLIENT_ID) return { status: 200, body: { off: true } };
  const sub = await googleAccount(body?.credential, env, { now, ...(keys ? { keys } : {}) });
  if (!sub) return { status: 401, body: { error: "Couldn't confirm that Google sign in. Try again." } };
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS google_links (account TEXT PRIMARY KEY, wallet TEXT, at INTEGER)').run();
  const account = await accountKey(sub, env);
  if (body.token) {
    // Only a wallet that signed for itself can be linked, and the newest link replaces an older one.
    const wallet = await readToken(env, body.token, now);
    if (!wallet) return { status: 401, body: { error: 'That wallet check has run out. Check your wallet again.' } };
    await env.DB.prepare('INSERT OR REPLACE INTO google_links (account, wallet, at) VALUES (?, ?, ?)').bind(account, wallet, now).run();
  }
  const row = await env.DB.prepare('SELECT wallet FROM google_links WHERE account = ?').bind(account).first();
  if (!row?.wallet) return { status: 200, body: { linked: false } };
  const r = await check(row.wallet, env, rpcUrl, now);
  return { status: r.status, body: { linked: true, ...r.body } };
}
