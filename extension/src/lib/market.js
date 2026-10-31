// Live market data from DexScreener + picking the three narrative coins.
import { norm } from './keywords.js';

const DS = 'https://api.dexscreener.com';
// EVM addresses come back checksummed or not, so they're compared in lowercase; Solana's base58 is case-sensitive.
const quoteKey = (a) => (/^0x/i.test(a || '') ? a.toLowerCase() : a);
const QUOTES = new Set([
  'So11111111111111111111111111111111111111112', // wSOL
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  // Robinhood Chain: WETH, native ETH (Uniswap v4 pools) and USDG, the dollar its pools trade against. Its stock tokens
  // (SPY, NVDA…) also pair memecoins, but copies of them exist, so they don't count as real liquidity.
  '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
  '0x0000000000000000000000000000000000000000',
  '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
  // Base: WETH and USDC (native ETH is the zero address above). BNB Chain: WBNB, USDT, USDC, BUSD.
  '0x4200000000000000000000000000000000000006',
  '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  '0x55d398326f99059fF775485246999027B3197955',
  '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
  '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
].map(quoteKey));
// Launchpad curves: the pair opens in the same tx the token is born (flapsh: flap.sh on Robinhood Chain and BNB
// Chain; fourmeme: four.meme on BNB Chain).
export const LAUNCHPADS = new Set(['pumpfun', 'launchlab', 'meteoradbc', 'moonshot', 'boop', 'heaven', 'believe', 'bags', 'moonit', 'jupstudio', 'flapsh', 'fourmeme']);

async function getJson(url) {
  for (let i = 0; i < 4; i++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 1500 * 2 ** i)); continue; }
    if (!res.ok) throw new Error(`DexScreener ${res.status}`);
    return res.json();
  }
  throw new Error('DexScreener rate limited');
}

export async function searchPairs(query) {
  const j = await getJson(`${DS}/latest/dex/search?q=${encodeURIComponent(query)}`);
  return j.pairs || [];
}

// All pairs for up to 30 token addresses on one chain.
export async function pairsForTokens(chain, addresses) {
  const out = [];
  for (let i = 0; i < addresses.length; i += 30) {
    const chunk = addresses.slice(i, i + 30);
    const j = await getJson(`${DS}/tokens/v1/${chain}/${chunk.join(',')}`);
    if (Array.isArray(j)) out.push(...j);
  }
  return out;
}

// Every pool of one token (tokens/v1 only returns a single pool per token).
export async function allPairs(chain, address) {
  const j = await getJson(`${DS}/token-pairs/v1/${chain}/${address}`);
  return Array.isArray(j) ? j : [];
}

export async function allPairsMany(refs, concurrency = 6) {
  const out = [];
  let i = 0;
  const worker = async () => {
    while (i < refs.length) {
      const { chain, address } = refs[i++];
      out.push(...(await allPairs(chain, address).catch(() => [])));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, refs.length) }, worker));
  return out;
}

const n = (x) => (Number.isFinite(+x) ? +x : 0);

// Liquidity you could actually sell into: 2x the SOL/USDC/USDT side of each pool.
// One-sided / self-paired pools report huge "liquidity" with almost nothing behind it.
function realLiquidity(p) {
  if (!QUOTES.has(quoteKey(p.quoteToken?.address))) return 0;
  const quoteUsd = n(p.liquidity?.quote) * (n(p.priceNative) ? n(p.priceUsd) / n(p.priceNative) : 0);
  return Math.min(n(p.liquidity?.usd), 2 * quoteUsd);
}

// Collapse every pair of a token into one live token summary.
export function aggregate(pairs) {
  const byToken = new Map();
  for (const p of pairs) {
    if (!p?.baseToken?.address || QUOTES.has(quoteKey(p.baseToken.address))) continue;
    const key = `${p.chainId}:${p.baseToken.address}`;
    if (!byToken.has(key)) byToken.set(key, []);
    const list = byToken.get(key);
    if (!list.some((q) => q.pairAddress === p.pairAddress)) list.push(p);
  }
  const tokens = [];
  for (const list of byToken.values()) {
    const primary = [...list].sort((a, b) =>
      n(b.liquidity?.usd) - n(a.liquidity?.usd) || n(b.volume?.h24) - n(a.volume?.h24))[0];
    const dated = list.filter((p) => p.pairCreatedAt).sort((a, b) => a.pairCreatedAt - b.pairCreatedAt);
    const first = dated[0];
    const info = list.find((p) => p.info?.imageUrl)?.info || primary.info || {};
    const sum = (f) => list.reduce((s, p) => s + n(f(p)), 0);
    const liquidity = sum(realLiquidity);
    const reportedLiquidity = sum((p) => p.liquidity?.usd);
    const marketCap = n(primary.marketCap) || n(primary.fdv);
    const onCurve = LAUNCHPADS.has(primary.dexId);
    tokens.push({
      chain: primary.chainId,
      address: primary.baseToken.address,
      name: primary.baseToken.name,
      // Some tickers carry their own "$" ($WIF); everything that shows one adds it, so it's dropped here.
      symbol: String(primary.baseToken.symbol || '').trim().replace(/^\$+/, ''),
      image: info.imageUrl || null,
      websites: (info.websites || []).map((w) => w.url).slice(0, 3),
      socials: (info.socials || []).map((s) => ({ type: s.type, url: s.url })).slice(0, 4),
      priceUsd: n(primary.priceUsd),
      marketCap,
      fdv: n(primary.fdv),
      liquidity,
      reportedLiquidity,
      volume: { m5: sum((p) => p.volume?.m5), h1: sum((p) => p.volume?.h1), h6: sum((p) => p.volume?.h6), h24: sum((p) => p.volume?.h24) },
      txns: {
        h1: { buys: sum((p) => p.txns?.h1?.buys), sells: sum((p) => p.txns?.h1?.sells) },
        h24: { buys: sum((p) => p.txns?.h24?.buys), sells: sum((p) => p.txns?.h24?.sells) },
      },
      priceChange: primary.priceChange || {},
      createdAt: first?.pairCreatedAt || null,
      launchDex: first?.dexId || primary.dexId,
      launchPair: first?.pairAddress || null,
      pair: primary.pairAddress,
      dexId: primary.dexId,
      onCurve,
      pairAddresses: list.map((p) => p.pairAddress),
      url: primary.url,
      links: [...new Set(list.flatMap((p) => [...(p.info?.websites || []), ...(p.info?.socials || [])].map((x) => x.url)).filter(Boolean))],
      boosts: n(primary.boosts?.active),
      // MC with almost nothing behind it (or a curve with zero trades) is not a real cap.
      mcapBacked: onCurve ? n(primary.volume?.h24) > 0 : liquidity >= 1000 && marketCap / Math.max(liquidity, 1) < 150,
      updatedAt: Date.now(),
    });
  }
  return tokens;
}

// How strongly a token's name/symbol ties to the narrative keywords.
export function relevance(token, keywords) {
  const sym = norm(token.symbol || '');
  const name = norm(token.name || '');
  const words = new Set(`${token.name} ${token.symbol}`.split(/[^A-Za-z0-9À-ɏ]+/).map(norm).filter(Boolean));
  let score = 0;
  const matched = [];
  keywords.forEach((kw, i) => {
    const k = norm(kw);
    if (k.length < 2) return;
    const w = 1 / (1 + i * 0.25); // earlier keywords matter more
    let hit = 0;
    if (sym === k || name === k) hit = 4;
    else if (words.has(k)) hit = 2.5;
    // Short words ("pop", "ai") only match whole words, never inside other names.
    else if (k.length >= 5 && (sym.includes(k) || name.includes(k))) hit = 2;
    else if (kw.includes(' ')) {
      const parts = kw.split(/\s+/).map(norm).filter((p) => p.length >= 3);
      if (parts.length && parts.every((p) => name.includes(p) || sym.includes(p))) hit = 3;
    }
    if (hit) { score += hit * w; matched.push(kw); }
  });
  return { score, matched };
}

// Not memecoins: tokenized stocks (Robinhood Chain's are named "Tesla • Robinhood Token", and so are their copies),
// wrapped/bridged assets, stables. Also caught: a big "market cap" with almost no real liquidity behind it, which is
// what bridged majors look like on Solana.
const NON_MEME = /\b(prestocks?|xstocks?|tokenized|securities|backed|wrapped|wormhole|bridged|binance-peg|portal|ondo|stablecoin|usd coin|tether|robinhood token|global dollar)\b/i;
const MAJOR_NAMES = new Set('bitcoin ethereum zcash solana hyperliquid xrp ripple bnb cardano chainlink sui aptos near tron litecoin monero avalanche polkadot toncoin dogecoin stellar cosmos arbitrum optimism polygon'.split(' '));
const MAJOR_TICKERS = new Set('BTC ETH ZEC SOL HYPE XRP BNB ADA LINK SUI APT NEAR TRX LTC XMR AVAX DOT TON XLM ATOM ARB OP POL'.split(' '));
export function isMemecoin(t) {
  if (NON_MEME.test(`${t.name} ${t.symbol}`)) return false;
  if (/^(usdc|usdt|usds|usdg|pyusd|dai|weth|wbtc|cbbtc|wsol|msol|jitosol)$/i.test(t.symbol)) return false;
  if (!t.mcapBacked && !t.onCurve && t.marketCap > 50_000_000) return false;
  // Bridged majors (e.g. "Zcash $ZEC" on Solana) aren't memecoins about anything.
  const majorName = MAJOR_NAMES.has(String(t.name).toLowerCase().trim());
  const majorTicker = MAJOR_TICKERS.has(String(t.symbol).toUpperCase());
  if ((majorName && majorTicker) || (t.marketCap > 10_000_000 && (majorName || majorTicker))) return false;
  return true;
}

import { alive } from '../ui/holdercheck.js';

export { alive };

// The OG may trade quietly if it's really old: a real pool behind a coin past 30 days is enough. A coin days old with a pool
// and no trades is just dead ($RAYPAD: 5 days, 4 trades, the OG on a $FOBO post).
const ogExists = (t) => alive(t) || (t.liquidity >= 3000 && Date.now() - t.createdAt > 30 * 864e5);

// The oldest live coin with this one's ticker or name on its chain, among the coins searched, judged or not, if it's older
// than this one. Another chain's namesake is another coin (a 5.5-year-old "GOAT" on BNB was the OG beside Solana's $GOAT).
const sameName = (a, b) => String(a.symbol).toLowerCase() === String(b.symbol).toLowerCase() || (String(a.name).length >= 3 && String(a.name).toLowerCase() === String(b.name).toLowerCase());
export const olderTwinOf = (t, pool = []) => (t?.createdAt ? pool.filter((x) => x?.createdAt && x.chain === t.chain && x.address !== t.address && x.createdAt < t.createdAt && sameName(x, t) && ogExists(x)).sort((a, b) => a.createdAt - b.createdAt)[0] || null : null);

/**
 * Pick the three narrative coins:
 *   top   — highest real (liquidity-backed) market cap
 *   og    — earliest launched that's still trading
 *   mover — strongest live momentum right now
 */
export function pickThree(tokens, { cuts = [0.3, 0.15, 0], allowFallback = true } = {}) {
  // Prefer the coins most tied to the story; widen only if too few are trading.
  const maxRel = Math.max(0, ...tokens.map((t) => t.relevance || 0));
  let live = [];
  let cutUsed = 0;
  for (const cut of cuts) {
    cutUsed = cut;
    live = tokens.filter((t) => (t.relevance || 0) >= maxRel * cut && alive(t));
    if (live.length >= 3) break;
  }
  if (!live.length && allowFallback) live = tokens.filter((t) => t.volume.h24 > 0);
  const used = new Set();
  const take = (t, role) => { if (t) used.add(t.address); return t ? { role, token: t } : null; };

  const top = [...live].filter((t) => t.mcapBacked).sort((a, b) => b.marketCap - a.marketCap)[0];
  const picks = [take(top, 'top')];

  // The oldest of them all, or nobody: when Highest MC is the oldest, it's "also the OG" and a newer coin doesn't get the
  // title (a 1-day-old $LC was the OG beside the 21-day-old $LARPCHECK). An older twin the judge left out is the real one
  // (a 2-month-old $LUMI beside the 1-day-old one); olderTwin: true means there is one, but it's not to be shown.
  const oldest = tokens.filter((t) => t.createdAt && (t.relevance || 0) >= maxRel * cutUsed && ogExists(t))
    .sort((a, b) => a.createdAt - b.createdAt)[0];
  const og = oldest?.olderTwin === true ? null : oldest?.olderTwin ? { ...oldest.olderTwin, relevance: oldest.relevance } : oldest;
  picks.push(og && !used.has(og.address) ? take(og, 'og') : null);

  const momentum = (t) => {
    const ch = n(t.priceChange.h1 ?? t.priceChange.h6);
    const flow = Math.log10(10 + t.volume.h1);
    const buyRatio = (t.txns.h1.buys + 1) / (t.txns.h1.sells + 1);
    return ch * flow * Math.min(buyRatio, 3);
  };
  // The mover has to actually be trading; no pick beats a dead one.
  const movers = live.filter((t) => !used.has(t.address) && t.volume.h1 >= 1000);
  const mover = (movers.length ? movers : live.filter((t) => !used.has(t.address) && t.volume.h24 >= 250 && t.volume.h1 > 0))
    .sort((a, b) => momentum(b) - momentum(a) || b.volume.h24 - a.volume.h24)[0];
  picks.push(take(mover, 'mover'));

  // Tag every role a token would have won so the UI can show "also the OG", etc.
  const best = {
    top: [...live].filter((t) => t.mcapBacked).sort((a, b) => b.marketCap - a.marketCap)[0]?.address,
    og: og?.address,
    mover: live.filter((t) => t.volume.h1 >= 1000).sort((a, b) => momentum(b) - momentum(a))[0]?.address,
  };
  // The only coin holds every title by default, which says nothing.
  const contest = tokens.length > 1;
  for (const p of picks) {
    if (!p) continue;
    p.alsoTop = contest && p.role !== 'top' && best.top === p.token.address;
    p.alsoOg = contest && p.role !== 'og' && best.og === p.token.address;
    p.alsoMover = contest && p.role !== 'mover' && best.mover === p.token.address && momentum(p.token) > 0;
  }

  const others = tokens
    .filter((t) => !used.has(t.address))
    .sort((a, b) => (b.mcapBacked - a.mcapBacked) || b.marketCap - a.marketCap)
    .slice(0, 12);
  return { picks: picks.filter(Boolean), others, roleCandidates: tokens, roleCut: cutUsed };
}

// `deep` tokens get every pool (accurate liquidity / age); the rest use one batched call.
export async function fullTokens(refs, deep = new Set()) {
  const deepRefs = refs.filter((r) => deep.has(r.address));
  const byChain = new Map();
  for (const { chain, address } of refs) {
    if (deep.has(address)) continue;
    if (!byChain.has(chain)) byChain.set(chain, []);
    byChain.get(chain).push(address);
  }
  const [deepPairs, ...rest] = await Promise.all([
    allPairsMany(deepRefs),
    ...[...byChain].map(([c, a]) => pairsForTokens(c, a).catch(() => [])),
  ]);
  return aggregate([...deepPairs, ...rest.flat()]);
}

export const SOL_CA = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;
export const EVM_CA = /\b0x[a-fA-F0-9]{40}\b/g;

// X links a typed $TICKER to a token it picks, and the post's text then holds "ethereum:0x…" where the reader sees $RADAR.
// A link to a chain the scan doesn't cover is X's guess, not what the poster wrote (their $RADAR read as DappRadar's
// Ethereum token, so the Solana coin never got looked for). It's read back as the ticker; "solana:" stays an address.
const LINKED_ELSEWHERE = /\b(ethereum|base|bsc|arbitrum|polygon|optimism|avalanche):(0x[a-fA-F0-9]{40})\b/gi;
export async function typedCashtags(text, symbolOf) {
  const links = [...new Set(String(text || '').match(LINKED_ELSEWHERE) || [])].slice(0, 3);
  let out = String(text || '');
  for (const link of links) {
    const [chain, address] = link.split(':');
    const symbol = await symbolOf(chain.toLowerCase(), address).catch(() => null);
    if (/^[A-Za-z][A-Za-z0-9]{0,11}$/.test(symbol || '')) out = out.split(link).join(`$${symbol}`);
  }
  return out;
}
export async function linkedSymbol(chain, address) {
  const r = await fetch(`https://api.dexscreener.com/tokens/v1/${chain}/${address}`, { signal: AbortSignal.timeout(8000) });
  const pairs = r.ok ? await r.json() : [];
  const key = address.toLowerCase();
  const pair = (Array.isArray(pairs) ? pairs : []).find((p) => [p.baseToken?.address, p.quoteToken?.address].some((a) => a?.toLowerCase() === key));
  return pair ? (pair.baseToken.address.toLowerCase() === key ? pair.baseToken : pair.quoteToken).symbol : null;
}

// Contract addresses written in the post itself. A chart link (dexscreener.com/solana/<pool>) carries the pool's
// address, not the token's: it counts as that pool's token.
export async function mentionedTokens(text, chains, search = searchPairs) {
  const cas = [...new Set([...(text.match(SOL_CA) || []), ...(text.match(EVM_CA) || [])])].slice(0, 3);
  const found = await Promise.all(cas.map(async (ca) => {
    const key = ca.toLowerCase();
    const hit = aggregate(await search(ca).catch(() => []))
      .find((t) => t.address.toLowerCase() === key || t.pairAddresses?.some((p) => p.toLowerCase() === key));
    if (!hit) return null;
    return aggregate(await allPairsMany([hit]).catch(() => []))
      .find((t) => t.address === hit.address && chains.includes(t.chain)) || null;
  }));
  return [...new Map(found.filter(Boolean).map((t) => [t.address, t])).values()];
}
