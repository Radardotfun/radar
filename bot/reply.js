// The Radar bot's reply to a tag: first the coin the post itself names (📌) or pictures (🖼, its logo is the post's
// picture; both from bot/coins.js), then the story's three
// picks, as the panel picks them (market.js pickThree): the highest market cap, the OG (first launched) and the mover
// (trading hardest right now). Each carries the number that earned the pick, its chain when that isn't Solana, and its
// full contract address, so a copycat with the same ticker can't pass for it. No checks.
// With three addresses a reply runs past 280 characters, which @radardotfunn's Premium allows.
import { quiet, tradesLine } from '../extension/src/ui/holdercheck.js';
import { parentOf } from '../extension/src/lib/family.js';
import { totalScore } from './coinscore.js';

const SITE = 'https://tryradar.fun';
const ROLES = [
  ['top', '🏆 Highest MC'],
  ['og', '🥇 OG'],
  ['mover', '🔥 Mover'],
];
const ALSO = { top: 'alsoTop', og: 'alsoOg', mover: 'alsoMover' };
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
// Emoji stay: a coin can be just one, and it printed as "$?". Nothing here can become a mention or a link.
// Block and shape characters too: a coin's ticker can be "███".
// Currency signs and other symbols stay too: the Pokémon Dollar's ticker is "₽" and printed as "?".
export const ticker = (s) => [...String(s || '').replace(/^\$+/, '').replace(/[^\p{L}\p{N}_\p{Extended_Pictographic}\p{Sc}\p{So}▀-◿‍️]/gu, '')].slice(0, 14).join('') || '?';
export const shortCa = (a) => (a && a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a || '');
// A contract address as printed: base58 (or 0x hex) characters only, nothing that could become a mention or a link.
export const contract = (a) => String(a || '').replace(/[^1-9A-HJ-NP-Za-km-z0x]/g, '').slice(0, 64);
export const scanUrl = (postUrl) => `${SITE}/scan?url=${encodeURIComponent(postUrl)}`;

// The coins to show for a scan, in order: { label, t (the token), stat }. Empty when the post has none.
export function replyEntries(result, now = Date.now()) {
  // Launched long before the post, it wasn't made for this story, whatever its name (a BNB mascot called Max, on a robot called Max).
  const older = (t) => result?.postAt && t.createdAt && result.postAt - t.createdAt > 7 * 86_400_000;
  // Not a check, just no dust: a pick under $1K market cap that isn't trading at least $1K a day is left out, and so is an
  // old namesake that barely trades (a 7-month-old "DEMOCRATS" at 11 trades a day on a House result).
  const picks = (result?.picks || []).filter((p) => p?.token?.address && ((p.token.marketCap || 0) >= 1000 || (p.token.volume?.h24 || 0) >= 1000) && !(older(p.token) && quiet(p.token, now)));
  // The coin the post names shows whatever its size: it's the one the tagger is asking about.
  const named = result?.named?.address ? result.named : null;
  // Alone means one coin in the reply: the story can count one coin while the picks hold two, and both read "🎯 On this
  // story" on a Zelda post.
  const alone = !!result?.alone && new Set([named?.address, ...picks.map((p) => p.token.address)].filter(Boolean)).size < 2;
  const entries = [];
  // Every role a coin holds ("📌 In the post (Highest MC, OG)") instead of lines repeating it. A role another line holds
  // isn't claimed too. A coin alone on the story beat nothing, so the post's own coin claims no title then.
  const won = (address) => {
    const p = alone ? null : picks.find((x) => x.token.address === address);
    return ROLES.filter(([role]) => p && !(role === 'top' && noTop) && (p.role === role || (p[ALSO[role]] && !picks.some((x) => x.role === role && x.token.address !== address))) && !(role === 'og' && older(p.token))).map(([, label]) => label.replace(/^\S+ /, ''));
  };
  // A coin past its first day that barely trades says so, beside the number that earned its place.
  const stat = (t, s) => [s, quiet(t, now) && tradesLine(t)].filter(Boolean).join(' · ');
  // How soon after the post a coin tied to it launched, as the panel shows it ("4m after the post"); only within 3 days.
  const sincePost = (t) => {
    const d = result?.postAt && t?.createdAt ? t.createdAt - result.postAt : null;
    if (d == null || d < -60_000 || d > 3 * 86_400_000) return '';
    if (d < 0) return 'the same minute as the post';
    if (d < 60_000) return `${Math.max(1, Math.round(d / 1000))}s after the post`;
    return `${ago(result.postAt, t.createdAt)} after the post`;
  };
  // Highest MC means it beat something: alone on the story, or with a bigger namesake left out, the title isn't claimed.
  const noTop = alone || result?.outranked;
  if (named) {
    const roles = won(named.address);
    entries.push({ label: `${result.how === 'picture' ? '🖼 Same picture as the post' : result.how === 'bio' ? '👤 In the poster\'s bio' : result.how === 'linked' ? '🔗 Launched from this post' : '📌 In the post'}${roles.length ? ` (${roles.join(', ')})` : ''}`, t: named, stat: [stat(named, usd(named.marketCap)), sincePost(named)].filter(Boolean).join(' · ') });
  }
  // A coin launched from this very post, beside the coin the reply leads with.
  const linkedToo = result?.alsoLinked?.address && result.alsoLinked.address !== named?.address ? result.alsoLinked : null;
  if (linkedToo) entries.push({ label: '🔗 Launched from this post', t: linkedToo, stat: [stat(linkedToo, usd(linkedToo.marketCap)), sincePost(linkedToo)].filter(Boolean).join(' · ') });
  for (const [role, label] of ROLES) {
    const t = picks.find((p) => p.role === role)?.token;
    if (!t || t.address === named?.address) continue;
    const also = won(t.address).filter((r) => !label.endsWith(r));
    // A coin alone holds whichever role it landed on (OG or Mover too, when its market cap isn't backed) and beat nobody for it.
    // OG means the first coin on this story: one launched over a week before the post just shares the name (a 24-day-old raccoon
    // "Pepper" was the OG on a dog called Pepper).
    entries.push({ label: [alone || (role === 'top' && noTop) ? (older(t) ? '🔁 Same name, older coin' : '🎯 On this story') : role === 'og' && older(t) ? '🔁 Same name, older coin' : label, ...also].join(', '), t, stat: stat(t, role === 'top' ? usd(t.marketCap)
      : role === 'og' ? (ago(t.createdAt, now) ? `launched ${ago(t.createdAt, now)} ago` : usd(t.marketCap))
        : usd(t.volume?.h24) ? `${usd(t.volume.h24)} vol 24h` : usd(t.marketCap)) });
  }
  // The newest coin on the story, when the titles left it out. One that barely trades isn't news (a 22-day-old $RSI copy
  // at 4 trades a day).
  const nw = result?.newest;
  if (nw?.address && entries.length && !entries.some((e) => e.t.address === nw.address) && ((nw.marketCap || 0) >= 1000 || (nw.volume?.h24 || 0) >= 1000) && !quiet(nw, now)) {
    entries.push({ label: '🆕 Newest', t: nw, stat: stat(nw, ago(nw.createdAt, now) ? `launched ${ago(nw.createdAt, now)} ago` : usd(nw.marketCap)) });
  }
  return entries;
}

// The first coin's family on pump.fun custom pairs (extension/src/lib/family.js): coins launched priced in it, or the coin
// it was itself launched under. Plain tickers: X allows one cashtag a post.
export function familyLine(fam, t) {
  if (!t) return '';
  if (fam?.children > 0) {
    const big = fam.biggest?.address && fam.biggest.address !== t.address && usd(fam.biggest.marketCap) ? ` · biggest ${ticker(fam.biggest.symbol)} ${usd(fam.biggest.marketCap)}` : '';
    return `🌱 Family: ${fam.children} coin${fam.children === 1 ? '' : 's'} launched under ${ticker(t.symbol)}${fam.graduated ? ` (${fam.graduated} graduated)` : ''}${usd(fam.volume) ? ` · ${usd(fam.volume)} vol 24h` : ''}${big}`;
  }
  const parent = parentOf(t);
  return parent?.symbol ? `🌳 Launched under ${ticker(parent.symbol)}: priced in it, so every buy goes through it` : '';
}

// "12 coins on this story": said when there are more than the reply shows; the full scan lists them all.
const moreLine = (result, shown) => ((result?.related || 0) > shown ? `${result.related} coins on this story, all of them in the full scan.` : '');

// The reply text, or null when the post has no coins (the bot then says so, briefly). `full: false` gives the short
// form (first 4 and last 4 characters of each contract) for when X won't take crypto addresses: it refuses them for
// an app's first 7 days ("Crypto addresses are prohibited for the first 7 days after authentication").
// `links: true` puts each coin's DexScreener page on its own line instead (the address travels inside the link). A
// post with a link costs $0.20 instead of $0.01, so this is only for the week X refuses addresses as text.
export function botReply(result, postUrl, now = Date.now(), { full = true, links = false, larp = null, family = null } = {}) {
  const entries = replyEntries(result, now);
  if (!entries.length) return null;
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
  for (const { label, t, stat } of entries) add(label, t, stat);
  if (!full) lines.push('');
  // X bills a post with a URL at $0.20 against $0.01 for a reply to a tag (docs.x.com pricing, 29 Oct 2026). A reply
  // that already has links also gets its scan, ahead of them: with the scan last, X previewed DexScreener's card
  // (31 Oct 2026). The others point at the bot's bio. from=bot lets the page count the visit (webapp/main.js).
  // The time keeps two replies about the same post from being identical, which X refuses as duplicates.
  const at = new Date(now).toISOString().slice(11, 16);
  const head = `Coins on this post (${at} UTC):`;
  // Larpcheck's verdict on the first coin, only in a reply with links: their terms need a link wherever it's shown. Plain
  // ticker, as X allows one cashtag a post.
  const verdict = links && larp?.checked && /^[A-Z ]{2,20}$/.test(larp.verdict || '') && /^https:\/\/larpcheck\.app\//.test(larp.url || '')
    ? [`Larpcheck on ${ticker(entries[0].t.symbol)}: ${larp.verdict}${(larp.total ?? larp.score) == null ? '' : ` ${larp.total ?? larp.score}`}`, larp.url] : [];
  const more = [familyLine(family, entries[0].t), moreLine(result, entries.length)].filter(Boolean).join('\n');
  if (links) return [head, `Full scan + Insta Buy: ${scanUrl(postUrl)}&from=bot`, '', ...lines, ...(more ? [more, ''] : []), ...verdict].join('\n').trimEnd();
  return [head, '', ...lines, ...(more ? [more] : []), 'Full scan + Insta Buy: link in bio'].join('\n');
}

// The larp check reply, for a post that names its coin: its CA or $TICKER is in the post itself (coins.js how 'post').
// A coin found by its picture, the poster's bio or a link back to the post sits under a narrative post, which gets the coins.
export const larpMode = (result) => !!(result?.named?.address && result.how === 'post');

export const LARP_WORDS = new Set(['REAL', 'LIKELY REAL', 'PARTLY REAL', 'UNCLEAR', 'LIKELY LARP', 'LARP']);
const FINDING = { works: '✅', risk: '⚠️', missing: '❔', info: 'ℹ️' };
// What the AI wrote is data: it can't mention anyone, post a link, or add a second cashtag (X allows one a post).
const plain = (s, n) => {
  const t = String(s || '').replace(/https?:\/\/\S+|www\.\S+/gi, '').replace(/@(?=\w)/g, '').replace(/\$(?=[\p{L}\p{N}])/gu, '').replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), n / 2))}…`;
};

/**
 * The larp check on the coin the post names, in two halves that weigh the same: the story (Radar's read of the post,
 * server/story.js: word, score, call, findings) and, for a Solana coin, the coin itself (bot/coinscore.js: holders, dev,
 * liquidity from Jupiter's audit). Then the holder numbers and the coin with its contract. null when there is no named
 * coin or no usable story read (the bot then sends the coins). full: false gives the short contract, as botReply does.
 */
export function larpReply(result, check, now = Date.now(), { full = true, coin = null } = {}) {
  const t = result?.named;
  if (!t?.address || !check || !LARP_WORDS.has(check.word)) return null;
  const at = new Date(now).toISOString().slice(11, 16);
  const story = Number.isFinite(check.score) ? check.score : null;
  const total = story != null ? totalScore(story, coin) : null;
  const scores = [total != null ? `${total}/100` : '', `story ${check.word}${story != null ? ` ${story}` : ''}`, coin ? `coin ${coin.word} ${coin.score}` : ''].filter(Boolean).join(' · ');
  // A public reply under someone's post says what the evidence shows, not what to do: an order at the start of the call
  // ("Avoid: 0-day-old author…" on 7 Nov) comes off, and the evidence after it stays.
  const said = plain(String(check.call || '').replace(/^\s*(avoid|skip|pass|ape|buy|sell|fade|dump|run)\b\s*(it|this)?\s*[:,.;—–-]*\s*/i, ''), 140);
  const call = said ? said[0].toUpperCase() + said.slice(1) : '';
  const of = (kind) => (Array.isArray(check.findings) ? check.findings : []).filter((f) => f?.kind === kind).map((f) => plain(f.text, 110)).filter(Boolean);
  // Worst first: the story's risks, then what costs the coin points; then one thing not confirmed and one that holds up.
  const red = [...of('risk'), ...(coin?.flags || [])].slice(0, 3);
  const lines = [...red.map((x) => `⚠️ ${x}`), ...of('missing').slice(0, 1).map((x) => `❔ ${x}`), ...of('works').slice(0, 1).map((x) => `✅ ${x}`)];
  const pin = `📌 In the post: ${ticker(t.symbol)}${usd(t.marketCap) ? ` · ${usd(t.marketCap)}` : ''}${CHAIN_TAG[t.chain] ? ` · ${CHAIN_TAG[t.chain]}` : ''}`;
  return [
    `Larp check on $${ticker(t.symbol)} (${at} UTC):`,
    `🧪 ${scores}`,
    ...(call ? [call] : []),
    '',
    ...lines,
    ...(lines.length ? [''] : []),
    ...(coin?.line ? [`👥 ${coin.line}`, ''] : []),
    full ? pin : `${pin} · ${shortCa(t.address)}`,
    ...(full ? [contract(t.address)] : []),
    '',
    coin ? 'Story: do the post\'s claims hold up. Coin: holders, dev, liquidity. A high score is no promise against a rug. Not advice.' : "Radar's read of the evidence, not advice.",
    'Full scan + Insta Buy: link in bio',
  ].join('\n');
}

export const NO_COINS = 'No coins on this one yet.';

// X refuses a reply identical to an earlier one. This makes one different: seconds in its time, or a time when it has none.
export function varied(text, now = new Date()) {
  const clock = now.toISOString().slice(11, 19);
  return text.includes(' UTC):') ? text.replace(/\d\d:\d\d(:\d\d)? UTC\):/, `${clock} UTC):`) : `${text} (${clock} UTC)`;
}

// X's length: links count as 23 characters whatever their length.
export const xLength = (text) => [...text.replace(/https?:\/\/\S+/g, 'x'.repeat(23))].length;
