// The narrative wire: spots a word many new coins share in a short time, a sign a story is spawning coins. It reads
// names only, so it says what launched, never why. Posts go to a Discord channel for now; X stays off until the user
// has seen the quality.

const API = 'https://datapi.jup.ag/v1/pools?sortBy=createdAt&sortDir=desc&limit=100';
export const WINDOW_MS = 30 * 60_000;
export const KEEP_MS = 60 * 60_000;
export const COOLDOWN_MS = 6 * 3_600_000;
export const MAX_PER_DAY = 12;
const MIN_COINS = 6;
const MIN_DEVS = 4;
const MIN_TOP_CAP = 15_000;

// Words on coins all day long, which say nothing about a story.
const GENERIC = new Set(('the and for with this that you your our are was his her its not but all one two big top new old '
  + 'coin coins token tokens meme memes sol solana pump fun bonk inu moon official real based community '
  + 'cat cats dog dogs frog pepe doge shib baby king queen lord god man men boy girl guy dad mom kid wife '
  + 'ape monkey bull bear pig rat fish bird duck wolf lion tiger bear '
  + 'money cash rich gold usd usdc btc eth bitcoin crypto stock stocks elon musk trump '
  + 'ai agent bot gpt web net app dao fi lol wtf gm gn yes no digital trench pumpfun open '
  + 'never life wif just like only time love good bad best last next first free get out now day night world work home').split(' '));

export const wordsOf = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/)
  .filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !GENERIC.has(w));

// One launch as kept: the feed's fields the wire reads.
export const compact = (pool) => {
  const t = pool.baseAsset || {};
  if (!t.id || !t.symbol) return null;
  return { a: t.id, s: String(t.symbol).slice(0, 20), n: String(t.name || '').slice(0, 40), m: Math.round(t.mcap || 0), d: t.dev || '', t: Date.parse(pool.createdAt || t.createdAt) || 0 };
};

export async function readLaunches(fetcher) {
  const r = await fetcher(API, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`Jupiter ${r.status}`);
  const d = await r.json();
  return (d.pools || []).map(compact).filter(Boolean);
}

// Words shared by enough coins from enough different wallets, with one coin that has traded up. A word whose coins all
// sit inside a longer word's ("weird" inside "weirdcat") gives way to the longer one.
export function findBursts(coins, now = Date.now()) {
  const latest = new Map();
  for (const c of coins) if (now - c.t <= WINDOW_MS && (!latest.has(c.a) || c.m > latest.get(c.a).m)) latest.set(c.a, c);
  const byWord = new Map();
  for (const c of latest.values()) {
    for (const w of new Set([...wordsOf(c.n), ...wordsOf(c.s)])) {
      if (!byWord.has(w)) byWord.set(w, []);
      byWord.get(w).push(c);
    }
  }
  const found = [...byWord].map(([word, list]) => ({
    word,
    list,
    devs: new Set(list.map((c) => c.d).filter(Boolean)).size,
    top: list.reduce((a, c) => (c.m > a.m ? c : a), list[0]),
    first: list.reduce((a, c) => (c.t < a.t ? c : a), list[0]),
  })).filter((b) => b.list.length >= MIN_COINS && b.devs >= MIN_DEVS && b.top.m >= MIN_TOP_CAP);
  const has = (b, c) => b.list.some((x) => x.a === c.a);
  return found
    .filter((b) => !found.some((o) => o !== b && o.word.length > b.word.length && b.list.every((c) => has(o, c))))
    .sort((a, b) => b.list.length - a.list.length || b.top.m - a.top.m);
}

const money = (n) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${Math.round(n)}`);
const safe = (s) => String(s || '').replace(/^\$+/, '').replace(/[^\p{L}\p{N}_]/gu, '').slice(0, 14) || '?';
const dex = (a) => `https://dexscreener.com/solana/${String(a).replace(/[^1-9A-HJ-NP-Za-km-z]/g, '')}`;

// A Discord message for one burst.
export function wireMessage(b) {
  const line = (label, c) => `**${label}:** [$${safe(c.s)}](${dex(c.a)}) · ${money(c.m)}`;
  const rows = [`At least **${b.list.length} coins** named "**${b.word}**" launched in the last 30 minutes, from ${b.devs} different wallets.`, '', line('Biggest', b.top)];
  if (b.first.a !== b.top.a) rows.push(line('First', b.first));
  return {
    embeds: [{ title: 'Narrative wire', description: rows.join('\n'), color: 0x5621AC, footer: { text: 'Names only, not a recommendation. Most coins like these go to zero.' } }],
    allowed_mentions: { parse: [] },
  };
}
