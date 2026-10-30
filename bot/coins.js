// Which coins the bot replies with. The panel's scan finds and judges the story's coins; on top of that the bot:
// - leads with the coin the post itself names: a contract address in the text or in an image (the scan's
//   `mentioned`), else a $TICKER written in the post or shown in an image, resolved to the biggest live coin with that
//   exact ticker (its name written in the post wins over size);
// - leaves out copycats of that coin (same ticker or same name), so a shilled $PURR isn't followed by three fake PURRs;
// - leaves out coins trading under a major's ticker (a "$HYPE" on Solana is not Hyperliquid), which otherwise win
//   Highest MC on posts about the majors themselves;
// - leaves out copies of our own coin, anything else called Radar, unless the post gives its contract;
// - keeps the story's main runner (its biggest real coin, carrying a name the post uses) even when the judge rates it
//   low, so a pile of small copies can't take Highest MC from it.
import { aggregate, pickThree, alive } from '../extension/src/lib/market.js';

// PEPE, DOGE and SHIB live on chains the bot doesn't scan, so what it finds under those tickers are copies (a $2M "PEPE"
// on Base as Highest MC on a Pepe meme).
const MAJORS = new Set('BTC ETH SOL HYPE XRP BNB USDC USDT WBTC WETH WSOL PEPE DOGE SHIB'.split(' '));
// The real $RADAR (RADAR_MINT in the server's wrangler.toml). An $84K "Radar" on BNB Chain was Highest MC on a post
// that mentions Radar, which sent people to a copy of our own coin.
const RADAR_MINT = 'HyDSdtgiSa5mHqkTVoz8cTFTeVLFKdZ8amPvtNYfpump';
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
// "DacityCoin" beat the $7.6M Dacity Coin. The ticker RADAR only ever means the real mint.
const plain = (s) => ` ${lower(s).replace(/\$[\p{L}\p{N}_]+/gu, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
export function pickNamed(tk, tokens, text) {
  const words = plain(text);
  const named = (t) => { const n = plain(t.name).trim(); return n.length >= 3 && n !== lower(tk) && words.includes(` ${n} `); };
  return tokens.filter((t) => t?.address && sym(t) === tk && (tk !== 'RADAR' || t.address === RADAR_MINT) && live(t) && (t.mcapBacked || alive(t)))
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
const EVM_CAS = /\b0x[a-fA-F0-9]{40}\b/g;

// The story's main runner: the biggest liquidity-backed coin the judge kept at all (60+) whose ticker or name is a name
// the post itself uses. The judge sometimes rates it only "the same subject": a $9.7M GTA VI trading $24M a day got 62
// next to 85 for an $836K "GTA memes", and the reply's Highest MC went to a coin a tenth its size.
const key = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const MAJOR_NAME = new Set('bitcoin ethereum solana hyperliquid ripple binance pepe dogecoin shibainu'.split(' '));
const isMajor = (t) => MAJORS.has(sym(t)) || MAJOR_NAME.has(key(t.name));
const isRadarCopy = (t) => (sym(t) === 'RADAR' || key(t.name) === 'radar') && t.address !== RADAR_MINT;
// Big enough to really be the runner: a $2.8K "ICE" was Highest MC on a post about Intercontinental Exchange.
const RUNNER_MIN = 100_000;
export function runnerOf(tokens, words) {
  const names = new Set(words.map(key).filter((k) => k.length >= 3 && !MAJOR_NAME.has(k)));
  return tokens.filter((t) => t?.address && (t.relevance || 0) >= 60 && (t.marketCap || 0) >= RUNNER_MIN && t.mcapBacked && alive(t) && !isMajor(t) && !isRadarCopy(t)
    && (names.has(key(t.symbol)) || names.has(key(t.name))))
    .sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0))[0] || null;
}

// The judge's 90+ means made for this exact story. Its 80-89 is looser and varies between runs ("Burn" on an account
// update, "Pussy Cat Club" on a Cash Cat post), so there a coin also needs a name the post's story uses: its whole ticker
// or name, or a telling word of it. Kinds of animal and words like "coin" say nothing.
const VAGUE = new Set('the and for with coin coins token tokens meme memes crypto official new baby cat cats kitten kitty dog dogs puppy frog bird'.split(' '));
const telling = (s) => lower(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !VAGUE.has(w));
export function tiedToPost(t, words) {
  const whole = new Set(words.map(key).filter((k) => k.length >= 2));
  if (whole.has(key(t.symbol)) || whole.has(key(t.name))) return true;
  const used = new Set(words.flatMap(telling));
  return [...telling(t.symbol), ...telling(t.name)].some((w) => used.has(w));
}

// The story's words, without the poster's own name unless the post itself uses it. The read lists the author among its
// names, so "$Elon" counted as on the story when Elon Musk posted about California. A word that is most of the handle
// stays: that's a project's own account (@Juggernautrh on $JUGGERNAUT), not a person with a name.
const posterWord = (post, text) => {
  // A project's handle often wraps its name: @usepurpsfun, @cashcat_token.
  const handle = key(post?.author);
  const core = handle.replace(/^(use|get|try|the|join|official)|(fun|app|xyz|hq|labs|token|coin|sol|official)$/g, '');
  const who = [handle, key(post?.authorName)];
  const said = plain(text);
  return (w) => key(w).length >= 3 && !/^(use|get|try|the|join|official|fun|app|xyz|labs|token|coin|sol)$/.test(key(w)) && who.some((x) => x.includes(key(w))) && key(w).length / (core.length || 1) < 0.7 && !said.includes(` ${lower(w)} `);
};
export function storyWords(words, post, text) {
  const byAuthor = posterWord(post, text);
  return words.map((w) => String(w).split(/\s+/).filter((p) => !byAuthor(p)).join(' ')).filter(Boolean);
}

// A coin named after the poster, on a post that doesn't use that name, whatever the judge scored it (it gave a $291K
// "Official Elon Coin" enough on one run and not on the next).
export function namedAfterPoster(t, post, text) {
  const byAuthor = posterWord(post, text);
  return [sym(t).toLowerCase(), ...telling(t.name)].some(byAuthor);
}

// The judge is a sampled model call (no temperature control on the judge's model), and DexScreener's search results
// shift between scans, so two tags of the same post could get different coins. The bot keeps each post's verdicts:
// a coin judged before keeps its first score, a coin judged before but missing from this scan's verdicts comes back
// from the candidate pool, and only coins never seen get a fresh verdict.
// -> { scan: the scan with remembered scores applied, scores: { address: score } to keep for next time }
export function withMemory(scan, known = null) {
  const memo = known && typeof known === 'object' ? known : {};
  const seen = new Map();
  for (const t of [...(scan?.roleCandidates || []), ...(scan?.picks || []).map((p) => p.token), ...(scan?.others || []), scan?.techMatch, ...(scan?.pool || [])]) {
    if (t?.address && !seen.has(t.address)) seen.set(t.address, t);
  }
  const judged = new Set([...(scan?.roleCandidates || []), ...(scan?.picks || []).map((p) => p.token), ...(scan?.others || []), scan?.techMatch].filter((t) => t?.address).map((t) => t.address));
  const scored = [...seen.values()]
    .map((t) => (Number.isFinite(memo[t.address]) ? { ...t, relevance: memo[t.address] } : judged.has(t.address) ? t : null))
    .filter((t) => t && (t.relevance || 0) >= 60);
  const scores = { ...memo };
  for (const t of scored) if (!Number.isFinite(scores[t.address])) scores[t.address] = t.relevance;
  // The 40 best are plenty for one post.
  const kept = Object.fromEntries(Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, 40));
  const techMatch = scan?.techMatch?.address && Number.isFinite(memo[scan.techMatch.address]) ? { ...scan.techMatch, relevance: memo[scan.techMatch.address] } : scan?.techMatch || null;
  return { scan: { ...scan, roleCandidates: scored, picks: [], others: [], techMatch }, scores: kept };
}

// A post that is a picture with at most a short caption (links and @handles don't count).
export const picturePost = (post) => (post?.images?.length || 0) > 0 && String(post.text || '').replace(/https?:\/\/\S+|@\w+/g, '').trim().length <= 80;

// The coin to lead with among those launched with the post's own picture as their logo: the biggest market cap that
// real liquidity backs, else the one trading most.
const leadOf = (tokens) => [...tokens].sort((a, b) => Number(!!b.mcapBacked) - Number(!!a.mcapBacked) || (b.marketCap || 0) - (a.marketCap || 0) || (b.volume?.h24 || 0) - (a.volume?.h24 || 0))[0] || null;

/**
 * res: the scan (findCoins), post: the tagged post. search(q) -> DexScreener pairs. lookupCa(address) -> the token
 * at that address (or the token of the pool at it), null when it is no token, and throws when DexScreener can't say.
 * matchImages(postImages, logoUrls) -> indexes of the logos that show the post's picture.
 * capOf(token) -> a market cap for a coin DexScreener gives none for (still on its launch curve), or 0.
 * -> { named, how, picks }: the coin the post names or pictures (or null), how it was found ('post': its CA or ticker;
 * 'picture': its logo is the post's picture) and the three story picks, as pickThree gives them. That coin competes for
 * the roles too, so Highest MC is never a smaller coin than the post's own.
 */
export async function botCoins(res, post, { search, lookupCa, matchImages, capOf, chains = ['solana'] }) {
  const scanned = [...(res?.roleCandidates || []), ...(res?.picks || []).map((p) => p.token), ...(res?.others || []), res?.techMatch].filter((t) => t?.address);
  const text = [post?.text, post?.quoted, post?.parent].filter(Boolean).join('\n');
  let named = res?.mentioned?.[0] || null;
  // The scan's CA lookup gives up when DexScreener is busy, and a guess from the ticker then names a copycat. An
  // address in the post is looked up again here; if DexScreener still can't answer, the tag is retried later.
  if (!named && lookupCa) {
    for (const ca of [...new Set([...(text.match(SOL_CA) || []), ...(text.match(EVM_CAS) || [])])].slice(0, 3)) {
      named = await lookupCa(ca);
      if (named && !chains.includes(named.chain)) named = null;
      if (named) break;
    }
  }
  // A 0x address that isn't on a chain the bot scans (Ethereum, Arbitrum…): its ticker must not be matched to a coin
  // here ($INU with a 0x address had named a Solana "inu"); coins under that ticker on the scanned chains are copies.
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
    const logos = [...scanned, ...(res?.pool || [])].filter((t) => t?.image && live(t) && !MAJORS.has(sym(t)) && !isRadarCopy(t) && !have.has(t.address) && have.add(t.address)).slice(0, 16);
    if (logos.length) pictured = (await matchImages(post.images, logos.map((t) => t.image)).catch(() => [])).map((i) => logos[i]).filter(Boolean);
    named = leadOf(pictured);
    if (named) how = 'picture';
  }
  if (named && !named.marketCap && capOf) {
    const cap = await capOf(named).catch(() => 0);
    if (cap) named = { ...named, marketCap: cap };
  }
  const postWords = [...storyWords([...(res?.anchors || []), ...(res?.terms || [])], post, text), ...typed];
  const runner = runnerOf(scanned.filter((t) => !namedAfterPoster(t, post, text)), postWords);
  // Under $10K a coin needs the judge's 90+: a name in common is no reason to call dust the post's coin.
  const onStory = (t) => (t.relevance || 0) >= 90 || ((t.relevance || 0) >= ON_STORY && (t.marketCap || 0) >= 10_000 && tiedToPost(t, postWords));
  const seen = new Set();
  let story = scanned.filter((t) => {
    if (seen.has(t.address)) return false;
    seen.add(t.address);
    return (onStory(t) || t.address === runner?.address) && !isMajor(t) && !isRadarCopy(t) && !namedAfterPoster(t, post, text) && !elsewhere.has(sym(t)) && !(named && sameCoin(t, named));
  }).map((t) => (t.address === runner?.address ? { ...t, relevance: Math.max(t.relevance || 0, 90) } : t));
  // With no coin named in the post, newer coins copying the biggest one's ticker or name are its copies, not the OG or
  // the mover (a launch post got two "PURPS" beside the real one). An older one stays: it may be the original.
  const lead = named ? null : leadOf(story.filter((t) => t.mcapBacked && alive(t)));
  if (lead) story = story.filter((t) => t.address === lead.address || !sameCoin(t, lead) || (t.createdAt || 0) < (lead.createdAt || 0));
  // Other coins with the same picture under another name were made for this post too.
  for (const t of pictured) if (!seen.has(t.address) && !sameCoin(t, named)) { seen.add(t.address); story.push({ ...t, relevance: 99 }); }
  if (named) story.push({ ...named, relevance: Math.max(100, ...story.map((t) => t.relevance || 0)) });
  // The panel's tiers (narrative.js findCoins) without its last fallback to every judged coin, so Highest MC is the
  // biggest coin on the story itself.
  const { picks } = story.length ? pickThree(story, { cuts: [0.85, 0.7], allowFallback: false }) : { picks: [] };
  return { named, how, picks };
}
