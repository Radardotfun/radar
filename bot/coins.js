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
import { aggregate, pickThree, alive, olderTwinOf, isMemecoin, MAJOR_TICKERS, STOCK_TICKERS } from '../extension/src/lib/market.js';
import { sym, lower, key, telling, tiedToPost, bioCas, tiedToBio, chainInPost } from '../extension/src/lib/bio.js';

export { tiedToPost, bioCas, tiedToBio };

// PEPE, DOGE and SHIB live on chains the bot doesn't scan, so what it finds under those tickers are copies (a $2M "PEPE"
// on Base as Highest MC on a Pepe meme). A typed $LINK or $ADA is the real one, not a BSC "ChainLink Token".
const MAJORS = new Set([...'BTC ETH SOL HYPE XRP BNB USDC USDT WBTC WETH WSOL PEPE DOGE SHIB USD'.split(' '), ...MAJOR_TICKERS]);
// The real $RADAR (RADAR_MINT in the server's wrangler.toml). An $84K "Radar" on BNB Chain was Highest MC on a post
// that mentions Radar, which sent people to a copy of our own coin.
const RADAR_MINT = 'BTmeAebSh8MaYsTDiBiix79htKckjYQP5fvucFoFpump';
// Big stocks' tickers. Typed on a markets post ($META, $SHOP) they mean the share, so a coin under the ticker has to be a
// runner to count: Kobeissi's Big Tech post had named a $2.7K launchpad "META", a different dead one each scan.
const STOCKS = STOCK_TICKERS;
// Not dust: what the reply would show at all.
const live = (t) => (t.marketCap || 0) >= 1000 || (t.volume?.h24 || 0) >= 1000;

// $TICKERs written in the text, in order: letters first ("$104K" is a price, not a coin), majors left out.
export function cashtags(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/(?:^|[^\w$])\$([A-Za-z][A-Za-z0-9]{0,11})\b/g)) {
    const t = m[1].toUpperCase();
    if (!MAJORS.has(t) && !out.includes(t)) out.push(t);
  }
  // A ticker of symbols, not letters: $███ (a $1.1M coin, quoted as "$███ has pumped 224% today!") read as no ticker at all.
  for (const m of String(text || '').matchAll(/(?:^|[^\w$])\$([▀-◿☀-➿\p{Extended_Pictographic}]{1,8})(?![\w$])/gu)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  // A ticker with the $ at the end ("GTA$"): the coin's own symbol keeps it.
  for (const m of String(text || '').matchAll(/(?:^|[^\w$])([A-Za-z][A-Za-z0-9]{1,11}\$)(?![\w$])/g)) {
    const t = m[1].toUpperCase();
    if (!MAJORS.has(t.slice(0, -1)) && !out.includes(t)) out.push(t);
  }
  return out.slice(0, 3);
}

// The coin a ticker means: exact ticker, live; its name written in the post first, then the biggest market cap that
// real liquidity backs (a "$GTA6" showing $21B with nothing in its pool is not the big one). The name counts as
// whole words outside cashtags: in "$DACITY $DACITYCOIN" the second is another ticker, and it made a $4.5K coin named
// "DacityCoin" beat the $7.6M Dacity Coin. The ticker RADAR only ever means the real mint.
const plain = (s) => ` ${lower(s).replace(/\$[\p{L}\p{N}_]+/gu, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
const closeEarlier = (a, b) => {
  const [x, y] = [a.marketCap || 0, b.marketCap || 0];
  if (!x || !y || Math.max(x, y) > 2 * Math.min(x, y) || !a.createdAt || !b.createdAt) return 0;
  return a.createdAt - b.createdAt;
};
export function pickNamed(tk, tokens, text, own = text) {
  // Only words the post writes, not its links: @wikifork's "https://forks.wiki" read as the words "forks wiki", and a
  // $2.5K copy named "forks wiki", launched four hours after the post with no links of its own, took $FORK (8 Nov).
  const noLinks = (s) => String(s || '').replace(/https?:\/\/\S+|\b[\w-]+(\.[\w-]+)*\.(com|io|xyz|fun|wiki|ai|app|org|net|gg|so|co|dev|me|tv|lol|meme)\b\S*/gi, ' ');
  const words = plain(noLinks(text));
  const ownWords = plain(noLinks(own));
  // A name that is only the ticker ("GTA$" for GTA$) earns nothing: every copy has it.
  const nameIn = (t, w) => { const n = plain(t.name).trim(); return n.length >= 3 && n !== lower(tk) && n !== plain(tk).trim() && w.includes(` ${n} `); };
  const named = (t) => nameIn(t, words);
  // The poster's own words before a quoted post's: "BAN ASI / Anti Super Inu" over a quote calling for "a ban on
  // artificial superintelligence" had named a $632K BNB "Artificial Superintelligence" doing $980 a day.
  const namedOwn = (t) => nameIn(t, ownWords);
  // A coin the post doesn't name by its name must be trading: a stock cashtag ($SHOP, $META) had named a dead coin that
  // only shares the ticker ("shopping " at $62 a day, a 2021 "MetaCash").
  return tokens.filter((t) => t?.address && sym(t) === tk && (tk !== 'RADAR' || t.address === RADAR_MINT) && live(t) && (t.mcapBacked || alive(t)) && (named(t) || (t.volume?.h24 || 0) >= 1000))
    // Close in size (within 2x), the earlier coin is the one made for the post: a copy launched 39 hours later at $35K on its
    // curve had beaten the $30K BingBingBing launched 34 seconds after the post.
    .sort((a, b) => Number(namedOwn(b)) - Number(namedOwn(a)) || Number(named(b)) - Number(named(a)) || Number(!!b.mcapBacked) - Number(!!a.mcapBacked) || closeEarlier(a, b) || (b.marketCap || 0) - (a.marketCap || 0))[0] || null;
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

// Not \b: a link like gmgn.ai/sol/token/lu5EtQcb_<address> joins the address to an underscore, a word character.
const SOL_CA = /(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{32,44}(?![1-9A-HJ-NP-Za-km-z])/g;
const EVM_CA = /\b0x[a-fA-F0-9]{40}\b/;
const EVM_CAS = /\b0x[a-fA-F0-9]{40}\b/g;

// The story's main runner: the biggest liquidity-backed coin the judge kept at all (60+) whose ticker or name is a name
// the post itself uses. The judge sometimes rates it only "the same subject": a $9.7M GTA VI trading $24M a day got 62
// next to 85 for an $836K "GTA memes", and the reply's Highest MC went to a coin a tenth its size.
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

// The story's words, without the poster's own name unless the post itself uses it. The read lists the author among its
// names, so "$Elon" counted as on the story when Elon Musk posted about California. A word that is most of the handle
// stays: that's a project's own account (@Juggernautrh on $JUGGERNAUT), not a person with a name.
// A project's handle often wraps its name: @usepurpsfun, @cashcat_token, @HackInu4meme.
const handleCore = (post) => key(post?.author).replace(/^(use|get|try|the|join|official)|(4meme|meme|onsol|onbase|onbsc|fun|app|xyz|hq|labs|token|coin|sol|official|cto|community)$/g, '');
const posterWord = (post, text) => {
  const handle = key(post?.author);
  const core = handleCore(post);
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

// The account's own coin: its handle is mostly the coin's name (@HackInu4meme on $Hackinu, @cashcatss on $CASHCAT). The judge
// can't tell a project's small coin from dust, and the post seldom types its own name, so these two were left out. A big
// account's handle is a person or a brand whose name anyone can launch a coin under, so an unknown or large following doesn't count.
const OWN_MAX_FOLLOWERS = 250_000;
export function ownCoin(t, post) {
  const handle = key(post?.author);
  const core = handleCore(post);
  // A null following reads as 0 to "<", so it must be a real number first.
  if (!core || !(Number.isFinite(post?.followers) && post.followers < OWN_MAX_FOLLOWERS)) return false;
  return [key(t?.symbol), key(t?.name)].some((k) => k.length >= 4 && handle.includes(k) && k.length / core.length >= 0.7);
}

// The judge is a sampled model call (no temperature control on the judge's model), and DexScreener's search results
// shift between scans, so two tags of the same post could get different coins. The bot keeps each post's verdicts:
// a coin judged before keeps its first score, a coin judged before but missing from this scan's verdicts comes back
// from the candidate pool, and only coins never seen get a fresh verdict.
// A score guessed from the name because the judge timed out is no verdict: the bot posts in public, so that coin is left out and
// nothing about it is remembered.
// -> { scan: the scan with remembered scores applied, scores: { address: score } to keep for next time, guessed: how many coins had no verdict }
export function withMemory(scan, known = null) {
  const memo = known && typeof known === 'object' ? known : {};
  const seen = new Map();
  for (const t of [...(scan?.roleCandidates || []), ...(scan?.picks || []).map((p) => p.token), ...(scan?.others || []), scan?.techMatch, ...(scan?.pool || [])]) {
    if (t?.address && !seen.has(t.address)) seen.set(t.address, t);
  }
  const judged = new Set([...(scan?.roleCandidates || []), ...(scan?.picks || []).map((p) => p.token), ...(scan?.others || []), scan?.techMatch].filter((t) => t?.address).map((t) => t.address));
  const noVerdict = (t) => t?.guessed && !Number.isFinite(memo[t.address]);
  const guessed = [...seen.values()].filter((t) => judged.has(t.address) && noVerdict(t)).length + (scan?.judgeFailed ? 1 : 0);
  const scored = [...seen.values()]
    .map((t) => (Number.isFinite(memo[t.address]) ? { ...t, relevance: memo[t.address] } : judged.has(t.address) && !noVerdict(t) ? t : null))
    .filter((t) => t && (t.relevance || 0) >= 60);
  const scores = { ...memo };
  for (const t of scored) if (!Number.isFinite(scores[t.address])) scores[t.address] = t.relevance;
  // The 40 best are plenty for one post.
  const kept = Object.fromEntries(Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, 40));
  const techMatch = noVerdict(scan?.techMatch) ? null : scan?.techMatch?.address && Number.isFinite(memo[scan.techMatch.address]) ? { ...scan.techMatch, relevance: memo[scan.techMatch.address] } : scan?.techMatch || null;
  return { scan: { ...scan, roleCandidates: scored, picks: [], others: [], techMatch }, scores: kept, guessed };
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
export async function botCoins(res, post, { search, lookupCa, lookupBio = lookupCa, matchImages, capOf, linkedTo, chains = ['solana'] }) {
  const scanned = [...(res?.roleCandidates || []), ...(res?.picks || []).map((p) => p.token), ...(res?.others || []), res?.techMatch].filter((t) => t?.address);
  const text = [post?.text, post?.quoted, post?.parent].filter(Boolean).join('\n');
  let named = res?.mentioned?.[0] || null;
  // An address written in the post is the surest tie a coin can have (the trade link below relies on it).
  let byCa = !!named;
  // The scan's CA lookup gives up when DexScreener is busy, and a guess from the ticker then names a copycat. An
  // address in the post is looked up again here; if DexScreener still can't answer, the tag is retried later.
  if (!named && lookupCa) {
    for (const ca of [...new Set([...(text.match(SOL_CA) || []), ...(text.match(EVM_CAS) || [])])].slice(0, 3)) {
      named = await lookupCa(ca);
      if (named && !chains.includes(named.chain)) named = null;
      if (named) { byCa = true; break; }
    }
  }
  // The poster's bio, when it holds this post's coin. Ahead of a guess from a ticker, which can land on a copy.
  let fromBio = false;
  if (!named && lookupBio) {
    const typedHere = cashtags(text);
    const words = [...(res?.anchors || []), ...(res?.terms || []), ...text.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3)];
    for (const ca of bioCas(post)) {
      const t = await lookupBio(ca).catch(() => null);
      // The ticker the post types and the coin in the poster's own bio: that's the coin, whatever its size. A coin the post
      // doesn't name has to at least be alive.
      if (t && chains.includes(t.chain) && !isRadarCopy(t) && !isMajor(t) && (live(t) || typedHere.includes(sym(t))) && tiedToBio(t, post, words, typedHere)) { named = t; fromBio = true; break; }
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
      const found = aggregate(await search(tk).catch(() => [])).filter((t) => chains.includes(t.chain) && isMemecoin(t));
      named = pickNamed(tk, [...scanned, ...found], text, post?.text || text);
      if (named && STOCKS.has(tk) && !(named.mcapBacked && alive(named) && (named.marketCap || 0) >= RUNNER_MIN)) named = null;
      if (named) break;
    }
  }
  // A ticker written without its $ ("AMD so far so good"), when the scan already holds a coin with that ticker: the
  // search under it finds the one that runs, not only the copies the scan met (a $86K Robinhood copy linking Jim
  // Cramer's post, beside a $1.6M Solana $AMD). A capitalised word is often just a word, so only a coin of runner size
  // counts, and never in a post written mostly in capitals ("TOP 10 GTA 6 MEME COINS" had named a $GTA).
  const letters = text.match(/\p{L}/gu) || [];
  const shouting = (text.match(/\p{Lu}/gu) || []).length > letters.length / 2;
  if (!named && !elsewhere.size && !typed.length && !shouting) {
    const caps = [...new Set(text.match(/(?<![\p{L}\p{N}$])[A-Z][A-Z0-9]{2,5}(?![\p{L}\p{N}])/gu) || [])].filter((w) => !MAJORS.has(w) && scanned.some((t) => sym(t) === w)).slice(0, 2);
    for (const tk of caps) {
      const found = aggregate(await search(tk).catch(() => [])).filter((t) => chains.includes(t.chain) && isMemecoin(t));
      const pick = pickNamed(tk, [...scanned, ...found], text, post?.text || text);
      // Only a runner the scan missed: one it already holds keeps its place among the picks, older twin and all.
      if (pick?.mcapBacked && alive(pick) && (pick.marketCap || 0) >= RUNNER_MIN && !scanned.some((t) => t.address === pick.address)) { named = pick; break; }
    }
  }
  // A post of a few words over a quoted story is usually the coin's name: Elon's "Recursive Self-Improvement" quoting a
  // NASA engineer read as a SpaceX story, and "Recursive Self Inu" ($RSI, $79K) never came up. The phrase is searched as a
  // name; a coin carrying it, or ticker'd with its initials, counts when it's a backed coin of some size.
  // In a longer post the same goes for a term it names: a hyphenated one with the word before it ("ie recursive
  // self-improvement" in Elon's 2023 reply about Q*, which read as an OpenAI story) or a quoted one.
  if (!named && !elsewhere.size && !typed.length) {
    const bare = String(post?.text || '').replace(/https?:\/\/\S+|@\w+/g, ' ');
    const own = plain(bare).trim();
    const phrases = [];
    if (own && own.split(' ').length >= 2 && own.split(' ').length <= 5) phrases.push(own);
    else {
      for (const m of bare.matchAll(/(?:^|[^\p{L}])((?:\p{L}+\s+)?\p{L}{3,}-\p{L}{3,})(?![\p{L}-])/gu)) phrases.push(plain(m[1]).trim());
      for (const m of bare.matchAll(/["“]([^"”]{6,40})["”]/gu)) phrases.push(plain(m[1]).trim());
    }
    for (const phrase of [...new Set(phrases)].filter((ph) => ph.split(' ').length >= 2 && ph.replace(/ /g, '').length >= 8).slice(0, 2)) {
      const words = phrase.split(' ');
      const initials = words.map((w) => w[0]).join('').toUpperCase();
      const carries = (t) => plain(t.name).includes(` ${phrase} `) || (initials.length >= 3 && sym(t) === initials && plain(t.name).trim().startsWith(words.slice(0, 2).join(' ')));
      const found = aggregate(await search(phrase).catch(() => [])).filter((t) => chains.includes(t.chain) && isMemecoin(t) && !isRadarCopy(t));
      named = leadOf([...scanned, ...found].filter((t) => carries(t) && t.mcapBacked && alive(t) && (t.marketCap || 0) >= 10_000)) || null;
      if (named) break;
    }
  }
  let how = named ? (fromBio ? 'bio' : 'post') : null;
  // A picture post that names no coin: the coins launched with that very picture as their logo, among every coin the
  // scan searched (judged or not; up to 16 logos).
  let pictured = [];
  if (!named && matchImages && picturePost(post)) {
    const have = new Set();
    const logos = [...scanned, ...(res?.pool || [])].filter((t) => t?.image && live(t) && !MAJORS.has(sym(t)) && !isRadarCopy(t) && !have.has(t.address) && have.add(t.address)).slice(0, 16);
    if (logos.length) pictured = (await matchImages(post.images, logos.map((t) => t.image))).map((i) => logos[i]).filter(Boolean);
    named = leadOf(pictured);
    if (named) how = 'picture';
  }
  // A coin launched with this very post as its link (its DexScreener profile points here) is the post's coin: "Freaky
  // Lily" linked the post but only showed as a Mover, under a bigger coin with another name.
  if (!named) {
    const linked = leadOf(scanned.filter((t) => t.fromPost && live(t) && !isRadarCopy(t) && !MAJORS.has(sym(t))));
    if (linked) { named = linked; how = 'linked'; }
  }
  // The scan only meets a coin linking the post when its search already found it: "DooDooCoin" linked @DipWheeler's
  // "made a pumpfun" post and never came up. DexScreener's newest profiles carry their links, so the post's id finds it.
  if (!named && linkedTo) {
    const id = String(post?.url || '').match(/\/status\/(\d+)/)?.[1];
    const fresh = id ? await linkedTo(id).catch(() => []) : [];
    const linked = leadOf(fresh.filter((t) => t?.address && chains.includes(t.chain) && live(t) && isMemecoin(t) && !isRadarCopy(t) && !MAJORS.has(sym(t))).map((t) => ({ ...t, fromPost: true })));
    if (linked) { named = linked; how = 'linked'; }
  }
  // A coin launched from this very post still shows when the reply leads with another one: "WE RAN BODEN, TREMP NOW
  // THEM" led with $boden, and the Dumocrat coin whose profile links that post was nowhere.
  let alsoLinked = null;
  if (named && how !== 'linked') {
    const okLinked = (t) => t?.address && t.address !== named.address && chains.includes(t.chain) && live(t) && isMemecoin(t) && !isRadarCopy(t) && !MAJORS.has(sym(t)) && !sameCoin(t, named);
    alsoLinked = leadOf(scanned.filter((t) => t.fromPost && okLinked(t)));
    if (!alsoLinked && linkedTo) {
      const id = String(post?.url || '').match(/\/status\/(\d+)/)?.[1];
      const fresh = id ? await linkedTo(id).catch(() => []) : [];
      alsoLinked = leadOf(fresh.filter(okLinked).map((t) => ({ ...t, fromPost: true })));
    }
  }
  if (named && !named.marketCap && capOf) {
    const cap = await capOf(named).catch(() => 0);
    if (cap) named = { ...named, marketCap: cap };
  }
  const postWords = [...storyWords([...(res?.anchors || []), ...(res?.terms || [])], post, post?.text), ...typed];
  const runner = runnerOf(scanned.filter((t) => !namedAfterPoster(t, post, post?.text)), postWords);
  // Under $10K a coin needs the judge's 90+: a name in common is no reason to call dust the post's coin.
  // One word in common isn't a tie for a coin whose name has more: "blind belief coin" ($BBC, $55K) was Highest MC and OG
  // on a "Blind Ape" post. Most of a longer name has to be in the post, unless its whole ticker or name is.
  const used = new Set(postWords.flatMap(telling));
  const whole = new Set(postWords.map(key).filter((k) => k.length >= 2));
  const tiedClose = (t) => {
    if (whole.has(key(t.symbol)) || whole.has(key(t.name))) return true;
    const mine = [...new Set(telling(t.name))];
    return mine.length < 2 ? tiedToPost(t, postWords) : mine.filter((w) => used.has(w)).length * 2 > mine.length;
  };
  const onStory = (t) => (t.relevance || 0) >= 90 || ((t.relevance || 0) >= ON_STORY && (t.marketCap || 0) >= 10_000 && tiedClose(t));
  const seen = new Set();
  const isOwn = (t) => ownCoin(t, post) && live(t);
  const onlyChain = chainInPost(post?.text);
  // A coin found only by its picture doesn't own the name: a bigger namesake with real liquidity is no copy of it, and it
  // keeps Highest MC ($goat at $3K had pushed out $GOAT at $14M and taken the title).
  // Nor does a coin whose profile only links the post: a bigger or earlier namesake stays ($AMD on Robinhood linked Jim
  // Cramer's post two hours after a $1.7M Solana $AMD launched on it).
  const copyOfNamed = (t) => named && sameCoin(t, named) && !((how === 'picture' || how === 'linked') && t.mcapBacked && ((t.marketCap || 0) > (named.marketCap || 0) || (t.createdAt && named.createdAt && t.createdAt < named.createdAt)));
  // A tokenized share of a typed stock ($GOOGL as GOOGLB, "Alphabet", on BNB) is no memecoin on the story.
  const stockTwin = (t) => typed.some((tk) => new RegExp(`^${tk.replace(/[^\p{L}\p{N}]/gu, '')}(B|X|ON)$`, 'iu').test(sym(t)) && !lower(t.name).includes(lower(tk)));
  let story = [...scanned, ...(res?.pool || []).filter((t) => t?.address && isOwn(t))].filter((t) => {
    if (seen.has(t.address)) return false;
    seen.add(t.address);
    if (onlyChain && chains.includes(onlyChain) && t.chain !== onlyChain && !isOwn(t) && !t.fromPost) return false;
    return (onStory(t) || isOwn(t) || t.address === runner?.address) && !isMajor(t) && !isRadarCopy(t) && (isOwn(t) || !namedAfterPoster(t, post, post?.text)) && !elsewhere.has(sym(t)) && !copyOfNamed(t) && !stockTwin(t);
  }).map((t) => (t.address === runner?.address || isOwn(t) ? { ...t, relevance: Math.max(t.relevance || 0, 90), keepSmall: isOwn(t) } : t));
  // With the account's own coin found, dust that only the judge tied to the story is noise beside it.
  if (story.some(isOwn)) story = story.filter((t) => isOwn(t) || (t.marketCap || 0) >= 10_000);
  // With no coin named in the post, newer coins copying the biggest one's ticker or name are its copies, not the OG or
  // the mover (a launch post got two "PURPS" beside the real one). An older one stays: it may be the original.
  const lead = named ? null : leadOf(story.filter((t) => t.mcapBacked && alive(t)));
  if (lead) story = story.filter((t) => t.address === lead.address || !sameCoin(t, lead) || (t.createdAt || 0) < (lead.createdAt || 0));
  // Other coins with the same picture under another name were made for this post too.
  // Not by `seen`: that also holds coins the story filter just turned down, and a judge's low score is no reason to drop a coin with this very picture.
  for (const t of pictured) if (!story.some((s) => s.address === t.address) && !sameCoin(t, named) && !(onlyChain && chains.includes(onlyChain) && t.chain !== onlyChain)) { seen.add(t.address); story.push({ ...t, relevance: 99 }); }
  // A second address in the post is a coin the post names too.
  for (const t of (res?.mentioned || []).slice(1)) if (chains.includes(t.chain) && !seen.has(t.address) && !sameCoin(t, named)) { seen.add(t.address); story.push({ ...t, relevance: 99 }); }
  // Small or not, it's the post's own coin and competes for the titles: under $5K and past its first hour it read as
  // dust, so a $2.6K namesake took Highest MC beside @DipWheeler's own $2.8K DooDooCoin.
  if (named) story.push({ ...named, keepSmall: true, relevance: Math.max(100, ...story.map((t) => t.relevance || 0)) });
  // The panel's tiers (narrative.js findCoins) without its last fallback to every judged coin, so Highest MC is the
  // biggest coin on the story itself.
  // Beside a coin the post names, or the account's own, an older namesake is no OG to send people to: the title just isn't
  // claimed (a 1.4-year-old "C" on BNB was the OG on @thecapytoken's own post).
  const twins = (res?.pool || []).filter((t) => !isRadarCopy(t) && !(onlyChain && chains.includes(onlyChain) && t.chain !== onlyChain));
  const postsOwn = named || story.some(isOwn);
  story = story.map((t) => { const twin = olderTwinOf(t, twins); return { ...t, olderTwin: postsOwn ? !!twin : twin }; });
  const { picks } = story.length ? pickThree(story, { cuts: [0.85, 0.7], allowFallback: false }) : { picks: [] };
  // A same-named coin the judge left out can be far bigger, on this chain or another the bot scans: the top pick doesn't
  // claim the title over it (a $664K Base Dacity was Highest MC beside a $6.8M Solana one).
  const top = picks.find((p) => p.role === 'top')?.token;
  const outranked = !!top && [...scanned, ...(res?.pool || [])].some((t) => t?.address !== top.address && sym(t) === sym(top) && chains.includes(t.chain) && t.mcapBacked && alive(t) && (t.marketCap || 0) > (top.marketCap || 0));
  // A post's id carries its time.
  const id = String(post?.url || '').match(/status\/(\d+)/)?.[1];
  const postAt = id ? Number((BigInt(id) >> 22n) + 1288834974657n) : null;
  // Beside the three titles, the newest live coin on the story, and how many there are in all (asked for in the Radar
  // Discord: "all related tokens, oldest, newest, highest market cap"). The full scan lists every one.
  // Related means the story's coins and every live coin under a shown ticker: Kobeissi's $AMD has 16 namesakes.
  const shownCoins = [named, ...picks.map((p) => p.token)].filter(Boolean);
  const shown = new Set(shownCoins.map((t) => t.address));
  const tickers = new Set(shownCoins.map(sym));
  const all = new Map(story.map((t) => [t.address, t]));
  for (const t of [...scanned, ...(res?.pool || [])]) if (t?.address && tickers.has(sym(t)) && chains.includes(t.chain) && live(t) && !isRadarCopy(t) && !all.has(t.address)) all.set(t.address, t);
  // Newest is the latest coin under a ticker the reply shows: other story coins were left out for a reason (a Robinhood TITO
  // came up as Newest on a $███ post).
  const newest = [...all.values()].filter((t) => !shown.has(t.address) && tickers.has(sym(t)) && t.createdAt && live(t) && (alive(t) || t.onCurve) && !isMajor(t))
    .sort((a, b) => b.createdAt - a.createdAt)[0] || null;
  return { named, how, alsoLinked, picks: alsoLinked ? picks.filter((p) => p.token.address !== alsoLinked.address) : picks, alone: story.length < 2, outranked, postAt, newest, related: all.size,
    trade: !!named && tradeOk(named, post, { byCa, how }) };
}

/**
 * Whether the reply may send people to trade the coin it names (bot/reply.js tradeLink). Only when something ties that coin
 * to the post: its address in the post, the poster's bio, its own profile linking the post or the poster, a name that is
 * the poster's own account, or a backed coin of real size. A coin guessed from a ticker or a picture alone, small and with
 * nothing pointing back, may be a copy: its larp check still runs, with no trade link (8 Nov, @wikifork's "forks wiki").
 */
export const TRADE_MIN = 100_000;
export function tradeOk(t, post, { byCa = false, how = null } = {}) {
  if (!t?.address) return false;
  if (byCa || how === 'bio' || how === 'linked' || t.fromPost || ownCoin(t, post)) return true;
  // The handle as written (underscores and all), only ever word characters: X handles are [A-Za-z0-9_].
  const author = String(post?.author || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
  const id = String(post?.url || '').match(/\/status\/(\d+)/)?.[1];
  const links = [...(t.socials || []).map((s) => s?.url), ...(t.websites || []), ...(t.links || [])].map((u) => String(u || '').toLowerCase());
  if (links.some((u) => (author.length >= 2 && new RegExp(`(?:x|twitter)\\.com/${author}(?:[/?#]|$)`).test(u)) || (id && u.includes(id)))) return true;
  return !!t.mcapBacked && alive(t) && (t.marketCap || 0) >= TRADE_MIN;
}
