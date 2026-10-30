// The Radar bot's way to DexScreener. Cloudflare Workers share their outgoing addresses, and DexScreener answers them
// 429 (error 1015) for minutes at a time, so tags ended in "too busy". This runs on Vercel, which has other addresses.
// It only reads DexScreener's public market data, and only for callers holding PROXY_SECRET (the bot's DEX_PROXY_SECRET).
// GET /api/dex?path=latest/dex/search%3Fq%3Dgemini  Deploy from this folder: vercel --prod
const PATHS = /^(latest\/dex|tokens\/v1|token-pairs\/v1|token-profiles|token-boosts|orders\/v1)\//;

export default async function handler(req, res) {
  if (!process.env.PROXY_SECRET || req.headers['x-radar-proxy'] !== process.env.PROXY_SECRET) return res.status(401).json({ error: 'token required' });
  const path = String(req.query.path || '');
  if (req.method !== 'GET' || !PATHS.test(path)) return res.status(400).json({ error: 'not a DexScreener market path' });
  try {
    const r = await fetch(`https://api.dexscreener.com/${path}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(9000) });
    res.status(r.status).setHeader('content-type', r.headers.get('content-type') || 'application/json');
    return res.send(await r.text());
  } catch {
    return res.status(502).json({ error: 'DexScreener did not answer' });
  }
}
