// Which coins the bot replies with. The panel's scan finds and judges the story's coins; on top of that the bot:
// - leads with the coin the post itself names: a contract address in the text or in an image (the scan's
//   `mentioned`), else a $TICKER written in the post or shown in an image, resolved to the biggest live coin with that
//   exact ticker (its name written in the post wins over size);
// - leaves out copycats of that coin (same ticker or same name), so a shilled $PURR isn't followed by three fake PURRs;
// - leaves out coins trading under a major's ticker (a "$HYPE" on Solana is not Hyperliquid), which otherwise win
//   Highest MC on posts about the majors themselves.
import { aggregate, pickThree, alive } from '../extension/src/lib/market.js';

const MAJORS = new Set('BTC ETH SOL HYPE XRP BNB USDC USDT WBTC WETH WSOL'.split(' '));
const sym = (t) => String(t?.symbol || '').replace(/^\$+/, '').toUpperCase();
const lower = (s) => String(s || '').toLowerCase().trim();
// Not dust: what the reply would show at all.
const live = (t) => (t.marketCap || 0) >= 1000 || (t.volume?.h24 || 0) >= 1000;

// $TICKERs written in the text, in order: letters first ("$104K" is a price, not a coin), majors left out.
export function cashtags(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/(?:^|[^\w$])\$([A-Za-z][A-Za-z0-9]{0,11})\b/g)) {
    const t = m[1].toUpperCase();
    if (!MAJORS.has(t) && !out.includes(t)) out.push(t);
  }
  return out.slice(0, 3);
}

// The coin a ticker means: exact ticker, live; its name written in the post first, then the biggest market cap that
// real liquidity backs (a "$GTA6" showing $21B with nothing in its pool is not the big one). The name counts as
// whole words outside cashtags: in "$DACITY $DACITYCOIN" the second is another ticker, and it made a $4.5K coin named
// "DacityCoin" beat the $7.6M Dacity Coin.
const plain = (s) => ` ${lower(s).replace(/\$[\p{L}\p{N}_]+/gu, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
export function pickNamed(tk, tokens, text) {
  const words = plain(text);
  const named = (t) => { const n = plain(t.name).trim(); return n.length >= 3 && n !== lower(tk) && words.includes(` ${n} `); };
  return tokens.filter((t) => t?.address && sym(t) === tk && live(t) && (t.mcapBacked || alive(t)))
    .sort((a, b) => Number(named(b)) - Number(named(a)) || Number(!!b.mcapBacked) - Number(!!a.mcapBacked) || (b.marketCap || 0) - (a.marketCap || 0))[0] || null;
}

// A copycat of the named coin: its ticker (alone or with a number after it, "SI276" for SI) or its name, or a name or
// ticker built on its ticker ("Hypurr", "popurrcat" for PURR; only tickers of 3+ letters, "VI" is inside too many words).
function sameCoin(t, n) {
  const base = sym(n);
  if (t.address === n.address || (sym(t).startsWith(base) && /^\d*$/.test(sym(t).slice(base.length)))) return true;
  if (lower(t.name).length >= 3 && lower(t.name) === lower(n.name)) return true;
  const k = sym(n).toLowerCase();
  return k.length >= 3 && `${lower(t.name)} ${sym(t).toLowerCase()}`.includes(k);
}

// The judge's scale (server/narrative.js): 90+ made for this exact story, 75-89 the central subject's own coin,
// 60-74 only the same kind of subject. The bot posts in public, so it names only coins at 80 and up (78 let "Red Kitten
// Crew" through for a tiger in a box marked "free kitten").
export const ON_STORY = 80;

const SOL_CA = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;
const EVM_CA = /\b0x[a-fA-F0-9]{40}\b/;

// A post that is a picture with at most a short caption (links and @handles don't count).
export const picturePost = (post) => (post?.images?.length || 0) > 0 && String(post.text || '').replace(/https?:\/\/\S+|@\w+/g, '').trim().length <= 80;

// The coin to lead with among those launched with the post's own picture as their logo: the biggest market cap that
// real liquidity backs, else the one trading most.
const leadOf = (tokens) => [...tokens].sort((a, b) => Number(!!b.mcapBacked) - Number(!!a.mcapBacked) || (b.marketCap || 0) - (a.marketCap || 0) || (b.volume?.h24 || 0) - (a.volume?.h24 || 0))[0] || null;

/**
 * res: the scan (findCoins), post: the tagged post. search(q) -> DexScreener pairs. lookupCa(address) -> the token
 * at that address (or the token of the pool at it), null when it is no token, and throws when DexScreener can't say.
 * matchImages(postImages, logoUrls) -> indexes of the logos that show the post's picture.
 * -> { named, how, picks }: the coin the post names or pictures (or null), how it was found ('post': its CA or ticker;
 * 'picture': its logo is the post's picture) and the three story picks, as pickThree gives them. That coin competes for
 * the roles too, so Highest MC is never a smaller coin than the post's own.
 */
export async function botCoins(res, post, { search, lookupCa, matchImages, chains = ['solana'] }) {
  const scanned = [...(res?.roleCandidates || []), ...(res?.picks || []).map((p) => p.token), ...(res?.others || []), res?.techMatch].filter((t) => t?.address);
  const text = [post?.text, post?.quoted, post?.parent].filter(Boolean).join('\n');
  let named = res?.mentioned?.[0] || null;
  // The scan's CA lookup gives up when DexScreener is busy, and a guess from the ticker then names a copycat. An
  // address in the post is looked up again here; if DexScreener still can't answer, the tag is retried later.
  if (!named && lookupCa) {
    for (const ca of [...new Set(text.match(SOL_CA) || [])].slice(0, 3)) {
      named = await lookupCa(ca);
      if (named) break;
    }
  }
  // A 0x address in the post: its coin lives on an EVM chain the bot doesn't scan, so its ticker must not be matched to
  // a Solana coin ($INU with a BNB address named a Solana "inu"); Solana coins under that ticker are copies.
  const typed = cashtags(text);
  const elsewhere = !named && EVM_CA.test(text) ? new Set(typed) : new Set();
  if (!named && !elsewhere.size) {
    // Tickers typed in the post; else the one ticker an image shows. Several tickers in an image (a screenshot of a
    // token list) don't say which coin the post is about.
    const seenInImage = (res?.tickers || []).map((t) => String(t).toUpperCase()).filter((t) => !MAJORS.has(t));
    const wanted = (typed.length ? typed : seenInImage.length === 1 ? seenInImage : []).slice(0, 2);
    for (const tk of wanted) {
      const found = aggregate(await search(tk).catch(() => [])).filter((t) => chains.includes(t.chain));
      named = pickNamed(tk, [...scanned, ...found], text);
      if (named) break;
    }
  }
  let how = named ? 'post' : null;
  // A picture post that names no coin: the coins launched with that very picture as their logo, among every coin the
  // scan searched (judged or not; up to 16 logos).
  let pictured = [];
  if (!named && matchImages && picturePost(post)) {
    const have = new Set();
    const logos = [...scanned, ...(res?.pool || [])].filter((t) => t?.image && live(t) && !MAJORS.has(sym(t)) && !have.has(t.address) && have.add(t.address)).slice(0, 16);
    if (logos.length) pictured = (await matchImages(post.images, logos.map((t) => t.image)).catch(() => [])).map((i) => logos[i]).filter(Boolean);
    named = leadOf(pictured);
    if (named) how = 'picture';
  }
  const seen = new Set();
  const story = scanned.filter((t) => {
    if (seen.has(t.address)) return false;
    seen.add(t.address);
    return (t.relevance || 0) >= ON_STORY && !MAJORS.has(sym(t)) && !elsewhere.has(sym(t)) && !(named && sameCoin(t, named));
  });
  // Other coins with the same picture under another name were made for this post too.
  for (const t of pictured) if (!seen.has(t.address) && !sameCoin(t, named)) { seen.add(t.address); story.push({ ...t, relevance: 99 }); }
  if (named) story.push({ ...named, relevance: Math.max(100, ...story.map((t) => t.relevance || 0)) });
  // The panel's tiers (narrative.js findCoins) without its last fallback to every judged coin, so Highest MC is the
  // biggest coin on the story itself.
  const { picks } = story.length ? pickThree(story, { cuts: [0.85, 0.7], allowFallback: false }) : { picks: [] };
  return { named, how, picks };
}
