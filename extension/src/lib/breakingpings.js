// Breaking now pings, a holder perk (off until turned on): an alert when a new story starts breaking, from the same live
// feed the panel shows holders (handlers.breaking). A story pings once in COOLDOWN_MS, and only once it is a real burst:
// MIN_COINS coins from MIN_WALLETS wallets, with one coin past MIN_CAP. The first look only notes what is already breaking.
// It says what launched, not why, and never that a coin is worth buying.

export const BREAK_KEY = 'breakingPings';
export const BREAK_SEEN = 'breakingSeen';
export const MIN_COINS = 8;
export const MIN_WALLETS = 5;
export const MIN_CAP = 15_000;
export const COOLDOWN_MS = 6 * 3_600_000;
export const MAX_PER_LOOK = 3;

const keyOf = (s) => String(s?.words?.[0] || '').toLowerCase();
const topOf = (s) => [s?.biggest, s?.first].filter((c) => c?.address).sort((a, b) => (b.cap || 0) - (a.cap || 0))[0] || null;

/** Whether a story is a big enough burst to ping about. */
export const pingWorthy = (s) => !!keyOf(s) && (s.coins || 0) >= MIN_COINS && (s.wallets || 0) >= MIN_WALLETS && (topOf(s)?.cap || 0) >= MIN_CAP;

/**
 * stories from the live feed, seen ({ word: at } from the last look, or null on the first) -> { seen, pings }.
 * seen keeps every story word in the feed (so one that grows later doesn't ping as new) and forgets them after COOLDOWN_MS.
 */
export function breakingPings(stories, seen, now = Date.now()) {
  const first = !seen || typeof seen !== 'object';
  const next = Object.fromEntries(Object.entries(first ? {} : seen).filter(([, at]) => now - at < COOLDOWN_MS));
  const pings = [];
  for (const s of Array.isArray(stories) ? stories : []) {
    const k = keyOf(s);
    if (!k) continue;
    const known = k in next;
    if (!first && !known && pingWorthy(s) && pings.length < MAX_PER_LOOK) pings.push(s);
    // A story that isn't a burst yet stays unseen, so it can still ping once it becomes one.
    if (first || known || pingWorthy(s)) next[k] = known ? next[k] : now;
  }
  return { seen: next, pings };
}

const usd = (n) => (!(n > 0) ? '' : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${Math.round(n)}`);

/** The alert item for a story, in the shape the feed, the notification and the X card read. */
export function breakingItem(s, now = Date.now()) {
  const top = topOf(s);
  const word = String(s.words[0]);
  const words = s.words.map((w) => String(w)).join(' · ');
  return {
    id: `breaking:${keyOf(s)}:${s.startedAt || now}`,
    at: now,
    kind: 'breaking',
    text: `${s.coins} coins from ${s.wallets} wallets${top?.cap ? ` · biggest ${usd(top.cap)}` : ''}`,
    // watch.word opens the panel on the story's word (its new pairs); watch.url is the story on X.
    watch: { word, author: 'Breaking now', label: words, url: `https://x.com/search?q=${encodeURIComponent(word)}&f=live` },
    coin: { chain: 'solana', address: top.address, symbol: String(top.symbol || '').trim(), name: top.name || '', marketCap: top.cap || 0 },
    story: { words: s.words.slice(0, 2), coins: s.coins, wallets: s.wallets },
    chart: `https://dexscreener.com/solana/${top.address}`,
    larp: null,
    holders: null,
    buy: null,
  };
}
