// The coin half of the bot's larp check: how fair a Solana coin is to hold, read from Jupiter's audit of it (the same
// one-request lookup Radar signals use, bot/discord-signals.js): mint and freeze, holders, how much the top holders,
// bots, snipers and the dev hold, the dev's other launches, organic trading and liquidity. The story half is Radar's
// read of the post (server/story.js). It describes the coin's numbers, never the people behind it.

export const COIN_WORDS = [[75, 'HEALTHY'], [55, 'FAIR'], [35, 'MIXED'], [0, 'RISKY']];

const pct = (n) => `${n >= 10 ? Math.round(n) : Number(n).toFixed(1)}%`;
const num = (n) => Number(n).toLocaleString('en-US');

/**
 * Jupiter's asset -> { score, word, flags: [text], line } or null when there is no audit to read.
 * flags: what costs the coin points, worst first. line: the holder numbers, one line.
 */
export function coinScore(a) {
  const au = a?.audit;
  if (!a?.id || !au) return null;
  const hits = [];
  const hit = (points, text) => hits.push([points, text]);
  if (au.mintAuthorityDisabled !== true || au.freezeAuthorityDisabled !== true) {
    hit(40, au.mintAuthorityDisabled !== true && au.freezeAuthorityDisabled !== true ? 'Mint and freeze are still on' : au.mintAuthorityDisabled !== true ? 'Mint is still on: more can be made' : 'Freeze is still on: wallets can be frozen');
  }
  const top = au.topHoldersPercentage;
  if (Number.isFinite(top) && top > 30) hit(top > 50 ? 25 : 12, `Top holders hold ${pct(top)}`);
  const bots = au.botHoldersPercentage;
  if (Number.isFinite(bots) && bots > 10) hit(bots > 20 ? 18 : 8, `Bots hold ${pct(bots)}`);
  const snipers = au.sniperPct;
  if (Number.isFinite(snipers) && snipers > 10) hit(snipers > 20 ? 18 : 8, `Snipers hold ${pct(snipers)}`);
  const dev = au.devBalancePercentage;
  if (Number.isFinite(dev) && dev > 10) hit(dev > 20 ? 22 : 12, `The dev holds ${pct(dev)}`);
  const mints = au.devMints;
  // A serial launcher weighs heavily: a clean coin from a wallet of 10+ launches is FAIR at best, of 100+ MIXED at best.
  if (Number.isFinite(mints) && mints >= 10) hit(mints >= 100 ? 40 : 26, `The dev wallet has launched ${num(mints)} coins`);
  const holders = a.holderCount || 0;
  if (holders < 50) hit(10, `Only ${num(holders)} holders`);
  if (a.organicScoreLabel === 'low') hit(8, 'Little organic trading');
  // A coin still on its launch curve has no pool to pull, so its liquidity says little.
  const onCurve = a.launchpad === 'pump.fun' && !a.graduatedAt && !a.graduatedPool;
  if (!onCurve && Number.isFinite(a.liquidity) && a.liquidity < 5000) hit(15, `Thin liquidity: ${a.liquidity >= 1000 ? `$${(a.liquidity / 1000).toFixed(1)}K` : `$${Math.round(a.liquidity)}`}`);
  hits.sort((x, y) => y[0] - x[0]);
  const score = Math.max(0, Math.min(100, 100 - hits.reduce((s, [p]) => s + p, 0)));
  const word = COIN_WORDS.find(([min]) => score >= min)[1];
  const parts = [`${num(holders)} holders`];
  if (Number.isFinite(top)) parts.push(`top holders ${pct(top)}`);
  if (Number.isFinite(snipers)) parts.push(`snipers ${pct(snipers)}`);
  if (Number.isFinite(bots)) parts.push(`bots ${pct(bots)}`);
  if (Number.isFinite(dev)) parts.push(`dev holds ${pct(dev)}`);
  if (Number.isFinite(mints)) parts.push(mints === 1 ? 'the dev\'s first coin' : `dev made ${num(mints)} coins, ${num(au.devMigrations ?? 0)} bonded`);
  return { score, word, flags: hits.map(([, text]) => text), line: parts.join(' · ') };
}

/**
 * Jupiter's asset as a token in the shape the bot's replies read (market.js aggregate's), for a coin DexScreener doesn't
 * list: on 7 Nov, Raydium LaunchLab coins still on their curve ($GREY, $BRRR, contracts typed in their own launch posts)
 * had no DexScreener pairs at all, so the post's own coin was missed.
 */
export function tokenFromJupiter(a) {
  if (!a?.id) return null;
  const s = (k) => a[k] || {};
  const vol = (k) => (s(k).buyVolume || 0) + (s(k).sellVolume || 0);
  const onCurve = !a.graduatedPool && Number.isFinite(a.bondingCurve) && a.bondingCurve < 100;
  return {
    chain: 'solana', address: a.id, name: String(a.name || ''), symbol: String(a.symbol || '').trim().replace(/^\$+/, ''), image: a.icon || null,
    websites: [], socials: [], links: [],
    priceUsd: a.usdPrice || 0, marketCap: a.mcap || 0, fdv: a.fdv || 0, liquidity: a.liquidity || 0,
    volume: { m5: vol('stats5m'), h1: vol('stats1h'), h6: vol('stats6h'), h24: vol('stats24h') },
    txns: { h1: { buys: s('stats1h').numBuys || 0, sells: s('stats1h').numSells || 0 }, h24: { buys: s('stats24h').numBuys || 0, sells: s('stats24h').numSells || 0 } },
    priceChange: { m5: s('stats5m').priceChange, h1: s('stats1h').priceChange, h6: s('stats6h').priceChange, h24: s('stats24h').priceChange },
    createdAt: Date.parse(a.firstPool?.createdAt || a.createdAt) || null,
    launchDex: a.launchpad || null, launchPair: a.firstPool?.id || null, onCurve,
    pairAddresses: [a.firstPool?.id, a.graduatedPool].filter(Boolean),
    mcapBacked: onCurve ? vol('stats24h') > 0 : (a.liquidity || 0) >= 1000 && (a.mcap || 0) / Math.max(a.liquidity || 1, 1) < 150,
    source: 'jupiter',
  };
}

/** The total: the story and the coin weigh the same. With no coin read, the story alone. */
export const totalScore = (story, coin) => (coin ? Math.round((story + coin.score) / 2) : story);
