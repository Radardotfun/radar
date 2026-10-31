// The panel's Recent list: the last scans that found a coin, kept in this browser only. Newest first, one row per post or search.
// Lives in ui/ because the panel can only load files from here; the service worker imports it too.
export const RECENT_KEY = 'radar-recent';
export const MAX_RECENT = 8;

// One row: q is what to scan again (a post's link or the words searched), k and l are the search's source.
export function recentItem({ asked, source, narrative, res, now = Date.now() }) {
  const q = String(asked || '').trim().slice(0, 300);
  const coin = res?.mentioned?.[0] || res?.picks?.[0]?.token;
  if (!q || !coin?.symbol) return null;
  return { q, k: source?.kind || 'Search', l: String(narrative || source?.label || q).slice(0, 120), c: String(coin.symbol).slice(0, 14), t: now };
}

export function addRecent(list, item) {
  if (!item) return list;
  return [item, ...list.filter((r) => r.q !== item.q)].slice(0, MAX_RECENT);
}
