// New pairs on a story: coins launched recently, named after words in the post, that people are really trading. This matches
// on names only, with no AI, so it's quick and costs nothing, and it says nothing about whether a coin is any good. The panel
// runs the checks.
import { isMemecoin } from './market.js';
import { extractKeywords, norm } from './keywords.js';
import { tieOf } from './alerts.js';

export const BADGE_MS = 6 * 3_600_000;
export const NEW_TAB_MS = 24 * 3_600_000;
const MIN_TRADES = 3; // fewer trades this hour than this, and a coin is nobody's yet
const MIN_CAP = 1000; // under this it's dust, however many buys it shows ($19 coins with 300 buys are bots)
const COPY_WINDOW_MS = 7 * 86_400_000;
const BIG_CAP = 100_000;
const BIG_LIQUIDITY = 20_000;

/** The words of a post worth searching for: names and cashtags, never generic words. */
export const postWords = (text) => extractKeywords(String(text || ''), 3, { strongOnly: true }).filter((w) => norm(w).length >= 3);

// Trading now, for the badge. The tab also keeps a coin that traded through the day and is quiet this hour.
const tradesIn = (t, w) => (t.txns?.[w]?.buys || 0) + (t.txns?.[w]?.sells || 0);
const trading = (t, hot) => {
  if (t.marketCap > 0 && t.marketCap < MIN_CAP) return false;
  if (!t.onCurve && (t.liquidity || 0) < 1000) return false;
  return tradesIn(t, 'h1') >= MIN_TRADES || (!hot && tradesIn(t, 'h24') >= 20);
};
const sameName = (a, b) => {
  const sym = norm(a.symbol || ''), name = norm(a.name || '');
  return (sym && sym === norm(b.symbol || '')) || (name && name === norm(b.name || ''));
};

// Elon posting about a drug isn't a story about Elon: "elon" and "musk" there pull in every new coin with his name. The author's
// name still counts when the post says it, or when there's nothing else to go on.
export function storyWords(words, author, text = '') {
  const who = norm(author || '');
  const said = norm(text);
  if (who.length < 3) return words;
  const kept = words.filter((w) => { const k = norm(w); return k.length < 3 || !who.includes(k) || said.includes(k); });
  return kept.length ? kept : words;
}

/**
 * tokens: live tokens from a search (older ones too, so a copy can be told from a first). words: what the story is called.
 * hot: only coins trading this hour. -> the new ones, each with copyOf when it's a copy, first-of-their-name first, then newest.
 * A copy has an older coin of its name on its chain that's big, or launched this past week. Tickers get reused all the time, so a
 * small old coin that's been dead for months doesn't make a new one a copy.
 */
export function freshPairs(tokens, words, { chains = null, now = Date.now(), maxAge = NEW_TAB_MS, hot = false } = {}) {
  const list = [...new Map((tokens || []).filter((t) => t?.address).map((t) => [t.address, t])).values()];
  return list
    .filter((t) => t.createdAt && now - t.createdAt <= maxAge && (!chains || chains.includes(t.chain)) && isMemecoin(t) && trading(t, hot) && tieOf(t, { anchors: words }))
    .map((t) => {
      const older = list.filter((o) => o.address !== t.address && o.chain === t.chain && o.createdAt && o.createdAt < t.createdAt && sameName(o, t)
        && (now - o.createdAt <= COPY_WINDOW_MS || (o.marketCap || 0) >= BIG_CAP || (o.liquidity || 0) >= BIG_LIQUIDITY)).sort((a, b) => a.createdAt - b.createdAt)[0];
      return { ...t, copyOf: older ? { symbol: older.symbol, createdAt: older.createdAt } : null };
    })
    .sort((a, b) => Number(!!a.copyOf) - Number(!!b.copyOf) || b.createdAt - a.createdAt);
}
