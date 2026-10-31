// Alerts: watch a post and ping when a coin launches off it.
// A watch keeps the post's read (story, terms, anchors) from when it started. Each check (the background runs one a
// minute) searches DexScreener for those terms and reads its newest coin profiles. A coin is a hit when it is on a
// chain Radar scans, a memecoin, launched after the post, and either links this very post or carries one of the post's
// anchors in its name or ticker. The first check only records the coins that already exist, so only new ones ping.
import { searchPairs, aggregate, isMemecoin, fullTokens } from './market.js';
import { norm } from './keywords.js';

export const WATCH_MS = 24 * 3_600_000;
export const RISK_WORDS = new Set(['LIKELY LARP', 'LARP', 'SCAM']);
// A second ping for a coin already in the feed: only when its verdict turns bad.
export const verdictTurned = (before, now) => RISK_WORDS.has(now) && !RISK_WORDS.has(before);
export const MAX_WATCHES = 5;
// A coin launched a few minutes before the post's timestamp still counts (clocks and indexing lag).
const EARLY_MS = 10 * 60_000;

export const statusOf = (url) => String(url || '').match(/\/status\/(\d{5,25})/)?.[1] || null;
// X post ids carry their time (snowflake): milliseconds since 2010-11-04 in the high bits.
export const postTime = (id) => (id ? Number((BigInt(id) >> 22n) + 1288834974657n) : null);

// DexScreener's newest coin profiles: the ones a launcher filled in, with their links (often the post itself).
export async function latestProfiles() {
  const res = await fetch('https://api.dexscreener.com/token-profiles/latest/v1', { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`DexScreener ${res.status}`);
  const j = await res.json();
  return Array.isArray(j) ? j : [];
}

/** The watch saved for a post: what the check needs, nothing else. read: the narrative engine's read of the post. */
export function newWatch(post, read, now = Date.now()) {
  const status = statusOf(post?.url);
  if (!status) throw new Error('Only a post on X can be watched');
  const label = String(post.text || post.quoted || post.card || '').replace(/\s+/g, ' ').trim().slice(0, 90) || 'Post';
  return {
    id: status,
    url: `https://x.com/${post.author || 'i'}/status/${status}`,
    author: post.author || '',
    label,
    narrative: String(read?.narrative || '').slice(0, 200),
    terms: (read?.terms || []).slice(0, 3),
    anchors: (read?.anchors || []).slice(0, 4),
    // Kept for the larp check that runs when a coin turns up.
    post: { text: post.text || '', quoted: post.quoted || '', card: post.card || '', author: post.author || '', authorName: post.authorName || '', url: post.url, images: (post.images || []).slice(0, 2) },
    since: now,
    until: now + WATCH_MS,
    after: (postTime(status) || now) - EARLY_MS,
    seen: [],
    primed: false,
  };
}

// How a coin is tied to the watched post: it links the post, or its name or ticker carries one of the post's anchors.
export function tieOf(t, watch) {
  if (watch.id && (t.links || []).some((l) => String(l).includes(`/status/${watch.id}`))) return 'post';
  const name = norm(t.name || '');
  const sym = norm(t.symbol || '');
  const words = new Set(`${t.name} ${t.symbol}`.split(/[^\p{L}\p{N}]+/u).map(norm).filter(Boolean));
  for (const a of watch.anchors || []) {
    const k = norm(String(a));
    if (k.length < 3) continue;
    if (sym === k || name === k || words.has(k) || (k.length >= 5 && (name.includes(k) || sym.includes(k)))) return 'name';
  }
  return null;
}

// Enough to show and buy: a live curve, or a pool with real money in it.
const tradable = (t) => t.onCurve || (t.liquidity || 0) >= 1000;

export const coinOf = (t) => ({
  address: t.address, chain: t.chain, symbol: t.symbol, name: t.name, image: t.image || null,
  marketCap: t.marketCap || 0, liquidity: t.liquidity || 0, volume24: t.volume?.h24 || 0, createdAt: t.createdAt || null,
  dexId: t.dexId || null, pair: t.pair || null, url: t.url || null, onCurve: !!t.onCurve,
  pairAddresses: (t.pairAddresses || []).slice(0, 8), socials: (t.socials || []).slice(0, 4), websites: (t.websites || []).slice(0, 3),
});

/**
 * One check of one watch. -> { seen, primed: true, hits: [{ coin, tie }] } (at most 3 hits, links-this-post first).
 * search(q) -> DexScreener pairs; profiles() -> DexScreener's latest profiles; tokens(refs) -> full tokens.
 */
export async function checkWatch(watch, { chains, search = searchPairs, profiles = latestProfiles, tokens = fullTokens }) {
  const found = new Map();
  const results = await Promise.all((watch.terms || []).slice(0, 3).map((q) => search(q).catch(() => [])));
  for (const t of aggregate(results.flat())) found.set(t.address, t);
  if (watch.id) {
    const fromPost = (await profiles().catch(() => []))
      .filter((p) => chains.includes(p.chainId) && p.tokenAddress && !found.has(p.tokenAddress)
        && (p.links || []).some((l) => String(l?.url || '').includes(`/status/${watch.id}`)));
    if (fromPost.length) {
      for (const t of await tokens(fromPost.map((p) => ({ chain: p.chainId, address: p.tokenAddress }))).catch(() => [])) {
        found.set(t.address, { ...t, links: [...(t.links || []), `https://x.com/i/status/${watch.id}`] });
      }
    }
  }
  const seen = new Set(watch.seen || []);
  const hits = [];
  for (const t of found.values()) {
    if (seen.has(t.address) || !chains.includes(t.chain) || !isMemecoin(t)) continue;
    const tie = tieOf(t, watch);
    if (!tie) continue;
    // The first check records what's already there; it was in the scan the user just looked at.
    if (!watch.primed) { seen.add(t.address); continue; }
    // A coin from before the post isn't one it spawned; one with nothing to trade yet gets another look next time.
    if (!t.createdAt || t.createdAt < watch.after) { seen.add(t.address); continue; }
    if (!tradable(t)) continue;
    seen.add(t.address);
    hits.push({ coin: coinOf(t), tie });
  }
  hits.sort((a, b) => Number(b.tie === 'post') - Number(a.tie === 'post') || (b.coin.marketCap || 0) - (a.coin.marketCap || 0));
  return { seen: [...seen].slice(-400), primed: true, hits: hits.slice(0, 3) };
}

// Where an alert's buttons go: Radar's buy page for Solana coins it can buy, Uniswap on Robinhood Chain, else the chart.
const QUICK_MARKETS = new Set(['pumpfun', 'pumpswap', 'raydium']);
export function buyUrl(coin) {
  if (coin.chain === 'solana' && (!coin.dexId || QUICK_MARKETS.has(coin.dexId))) return `https://tryradar.fun/trade?mint=${encodeURIComponent(coin.address)}`;
  if (coin.chain === 'robinhood') return `https://app.uniswap.org/swap?chain=robinhood&outputCurrency=${encodeURIComponent(coin.address)}`;
  return null;
}
export const chartUrl = (coin) => coin.url || `https://dexscreener.com/${encodeURIComponent(coin.chain)}/${encodeURIComponent(coin.address)}`;
