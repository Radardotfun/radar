// The Radar bot's reply to a tag: first the coin the post itself names (📌) or pictures (🖼, its logo is the post's
// picture; both from bot/coins.js), then the story's three
// picks, as the panel picks them (market.js pickThree): the highest market cap, the OG (first launched) and the mover
// (trading hardest right now). Each carries the number that earned the pick, its chain when that isn't Solana, and its
// full contract address, so a copycat with the same ticker can't pass for it. No checks.
// With three addresses a reply runs past 280 characters, which @radardotfunn's Premium allows.

const SITE = 'https://tryradar.fun';
const ROLES = [
  ['top', '🏆 Highest MC'],
  ['og', '🥇 OG'],
  ['mover', '🔥 Mover'],
];
// A 0x contract doesn't say which chain it's on, so coins off Solana name theirs.
const CHAIN_TAG = { robinhood: 'Robinhood', base: 'Base', bsc: 'BNB' };

const usd = (n) => (!Number.isFinite(n) || n <= 0 ? '' : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${Math.round(n)}`);

function ago(ms, now) {
  if (!ms) return '';
  const m = (now - ms) / 60_000;
  return m < 60 ? `${Math.max(1, Math.round(m))}m` : m < 1440 ? `${Math.round(m / 60)}h` : m < 43_200 ? `${Math.round(m / 1440)}d` : m < 525_600 ? `${Math.round(m / 43_200)}mo` : `${(m / 525_600).toFixed(1)}y`;
}

// A ticker as the bot may print it: letters and digits only, so a coin named "@someone" or "site.com" can't make the
// bot tag people or post links.
export const ticker = (s) => String(s || '').replace(/^\$+/, '').replace(/[^\p{L}\p{N}_]/gu, '').slice(0, 14) || '?';
export const shortCa = (a) => (a && a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a || '');
// A contract address as printed: base58 (or 0x hex) characters only, nothing that could become a mention or a link.
export const contract = (a) => String(a || '').replace(/[^1-9A-HJ-NP-Za-km-z0x]/g, '').slice(0, 64);
export const scanUrl = (postUrl) => `${SITE}/scan?url=${encodeURIComponent(postUrl)}`;

// The reply text, or null when the post has no coins (the bot then says so, briefly). `full: false` gives the short
// form (first 4 and last 4 characters of each contract) for when X won't take crypto addresses: it refuses them for
// an app's first 7 days ("Crypto addresses are prohibited for the first 7 days after authentication").
// `links: true` puts each coin's DexScreener page on its own line instead (the address travels inside the link). A
// post with a link costs $0.20 instead of $0.01, so this is only for the week X refuses addresses as text.
export function botReply(result, postUrl, now = Date.now(), { full = true, links = false } = {}) {
  // Not a check, just no dust: a pick under $1K market cap that isn't trading at least $1K a day is left out.
  const picks = (result?.picks || []).filter((p) => p?.token?.address && ((p.token.marketCap || 0) >= 1000 || (p.token.volume?.h24 || 0) >= 1000));
  // The coin the post names shows whatever its size: it's the one the tagger is asking about.
  const named = result?.named?.address ? result.named : null;
  if (!picks.length && !named) return null;
  const lines = [];
  const add = (label, t, stat) => {
    // X refuses a post with more than one cashtag ("Posts are limited to a maximum of one cashtag"), so only the
    // first coin gets its $.
    // The full contract on its own line, so it copies with one long-press.
    const head = `${label}: ${lines.length ? '' : '$'}${ticker(t.symbol)}${stat ? ` · ${stat}` : ''}${CHAIN_TAG[t.chain] ? ` · ${CHAIN_TAG[t.chain]}` : ''}`;
    if (links) lines.push(head, `https://dexscreener.com/${String(t.chain || 'solana').replace(/[^a-z]/g, '')}/${contract(t.address)}`, '');
    else if (full) lines.push(head, contract(t.address), '');
    else lines.push(`${head} · ${shortCa(t.address)}`);
  };
  // The roles the named coin won itself ("📌 In the post (Highest MC, OG)") instead of lines repeating it.
  if (named) {
    const won = ROLES.filter(([role]) => picks.find((p) => p.role === role)?.token.address === named.address).map(([, label]) => label.replace(/^\S+ /, ''));
    add(`${result.how === 'picture' ? '🖼 Same picture as the post' : '📌 In the post'}${won.length ? ` (${won.join(', ')})` : ''}`, named, usd(named.marketCap));
  }
  for (const [role, label] of ROLES) {
    const t = picks.find((p) => p.role === role)?.token;
    if (!t || t.address === named?.address) continue;
    add(label, t, role === 'top' ? usd(t.marketCap)
      : role === 'og' ? (ago(t.createdAt, now) ? `launched ${ago(t.createdAt, now)} ago` : usd(t.marketCap))
        : usd(t.volume?.h24) ? `${usd(t.volume.h24)} vol 24h` : usd(t.marketCap));
  }
  if (!full) lines.push('');
  // X bills a post with a URL at $0.20 against $0.01 for a reply to a tag (docs.x.com pricing, 29 Oct 2026). A reply
  // that already has links also gets its scan, ahead of them: with the scan last, X previewed DexScreener's card
  // (31 Oct 2026). The others point at the bot's bio. from=bot lets the page count the visit (webapp/main.js).
  // The time keeps two replies about the same post from being identical, which X refuses as duplicates.
  const at = new Date(now).toISOString().slice(11, 16);
  const head = `Coins on this post (${at} UTC):`;
  if (links) return [head, `Full scan + Insta Buy: ${scanUrl(postUrl)}&from=bot`, '', ...lines].join('\n').trimEnd();
  return [head, '', ...lines, 'Full scan + Insta Buy: link in bio'].join('\n');
}

export const NO_COINS = 'No coins on this one yet.';

// X's length: links count as 23 characters whatever their length.
export const xLength = (text) => [...text.replace(/https?:\/\/\S+/g, 'x'.repeat(23))].length;
