// GET /family?mint=: how many coins launched under a coin on pump.fun custom pairs, and the graduated ones' mints
// (extension/src/lib/family.js), read from the chain. Each answer is kept for 10 minutes.
import { familyCounts } from '../extension/src/lib/family.js';

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const KEEP_S = 600;

export async function family(mint, { rpc, cache = caches.default, now = Date.now(), counts = familyCounts } = {}) {
  if (!MINT.test(String(mint || ''))) return { status: 400, body: { error: 'mint= must be a Solana address' } };
  const key = new Request(`https://cache.narrative-radar/family2/${mint}`);
  const hit = await cache.match(key);
  if (hit) return { status: 200, body: await hit.json() };
  const body = { ...await counts(mint, rpc), at: now };
  await cache.put(key, new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${KEEP_S}` } }));
  return { status: 200, body };
}

// A Solana RPC call from the server: the relay's own endpoint when one is set, else the public one.
export const serverRpc = (url) => async (method, params) => {
  const res = await fetch(url || 'https://api.mainnet-beta.solana.com', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(20_000) });
  const j = await res.json().catch(() => null);
  if (!j || j.error) throw new Error(`${method} ${j?.error?.code || res.status}`);
  return j.result;
};
