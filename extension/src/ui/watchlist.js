// The watchlist: coins starred from a card, kept in this browser only, with the market cap each had when starred. Newest first.
// Lives in ui/ because the panel can only load files from here; the service worker imports it too.
export const WATCHLIST_KEY = 'radar-watchlist';
export const MAX_STARS = 20;

// post: the post it was found on, when there was one. liq: its pool's liquidity then, none on a launch curve (Radar Guard reads these).
export const starOf = (t, post = null, now = Date.now()) => ({
  address: t.address, chain: t.chain, symbol: String(t.symbol || '').slice(0, 20), name: String(t.name || '').slice(0, 60),
  image: t.image || null, cap: t.marketCap || 0, liq: t.onCurve ? 0 : t.liquidity || 0, post: post || null, t: now,
});

// Starred already: taken off. A full list stays as it is.
export function toggleStar(list, star) {
  if (!star?.address) return list;
  if (list.some((s) => s.address === star.address)) return list.filter((s) => s.address !== star.address);
  return list.length >= MAX_STARS ? list : [star, ...list];
}

// The market cap's change since the star, in percent. Null when either side is unknown.
export const sinceStar = (star, cap) => (star?.cap > 0 && cap > 0 ? (cap / star.cap - 1) * 100 : null);
