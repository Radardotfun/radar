// GET /family?mint=: a coin's family on pump.fun custom pairs (extension/src/lib/family.js), for the panel and the tag
// bot. GeckoTerminal allows about 30 calls a minute, so each coin's answer is kept for 10 minutes.
import { familyOf } from '../extension/src/lib/family.js';

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const KEEP_S = 600;

export async function family(mint, { cache = caches.default, now = Date.now(), lookup = familyOf } = {}) {
  if (!MINT.test(String(mint || ''))) return { status: 400, body: { error: 'mint= must be a Solana address' } };
  const key = new Request(`https://cache.narrative-radar/family1/${mint}`);
  const hit = await cache.match(key);
  if (hit) return { status: 200, body: await hit.json() };
  const f = await lookup(mint, { pages: 2, now });
  const b = f.biggest;
  const body = {
    parent: f.parent, children: f.children, more: f.more, fresh: f.fresh, volume: Math.round(f.volume),
    biggest: b ? { address: b.address, symbol: b.symbol, name: b.name, marketCap: b.marketCap, chain: b.chain || 'solana' } : null,
    at: now,
  };
  await cache.put(key, new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${KEEP_S}` } }));
  return { status: 200, body };
}
