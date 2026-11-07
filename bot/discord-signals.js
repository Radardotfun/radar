// Radar signals for Discord: coins Breaking now flagged (the track record, bot/track.js) that then pass every one of
// Radar's checks, read from Jupiter's audit of each coin (mint and freeze, holders, bots, snipers, the dev's record and
// bag, organic trading, cap, liquidity, the last hour's buying). One message per coin, the checks listed in it.
// A flag is looked at once it is DELAY_MS old, the same lag the public feed has (holders see Breaking now live in the
// extension), and for up to WINDOW_MS after. Diamond Hand stays a holder perk and is never posted here.
// It says what passed, never that a coin will go up.
import { ticker } from './reply.js';

export const JUP_ASSETS = 'https://datapi.jup.ag/v1/assets/search?query=';
export const DELAY_MS = 10 * 60_000;
export const WINDOW_MS = 60 * 60_000;
export const MAX_PER_DAY = 24;
export const STORY_COOLDOWN_MS = 6 * 3_600_000;
const MAX_LOOKUP = 50;

// Every line has to pass. Percentages are of the supply, as Jupiter gives them.
export const GATE = {
  mcap: 15_000, // enough real buying to be a coin
  liquidity: 5_000,
  holders: 75,
  topHolders: 30, // the top holders together, pools left out
  bots: 20,
  snipers: 20,
  devHolds: 10,
  devLaunches: 10, // from 10 launches a wallet reads as a serial launcher (the extension's Dev record tag too)
};
const ORGANIC = new Set(['medium', 'high']);

const pct = (n) => `${n >= 10 ? Math.round(n) : Number(n).toFixed(1)}%`;
export const money = (n) => (!Number.isFinite(n) ? '$0' : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${Math.round(n || 0)}`);

/** Jupiter's asset -> { pass, lines, failed }: each check as a short line, and the names of the ones that failed. */
export function checkCoin(a) {
  const au = a?.audit || {};
  const s1 = a?.stats1h || {};
  const checks = [
    ['market', Number.isFinite(a?.mcap) && a.mcap >= GATE.mcap && Number.isFinite(a?.liquidity) && a.liquidity >= GATE.liquidity, `${money(a?.mcap)} cap, ${money(a?.liquidity)} liquidity`],
    ['authority', au.mintAuthorityDisabled === true && au.freezeAuthorityDisabled === true, 'mint and freeze off'],
    ['holders', (a?.holderCount || 0) >= GATE.holders, `${(a?.holderCount || 0).toLocaleString('en-US')} holders`],
    ['top', au.topHoldersPercentage != null && au.topHoldersPercentage <= GATE.topHolders, `top holders ${pct(au.topHoldersPercentage ?? 100)}`],
    ['bots', (au.botHoldersPercentage ?? 0) <= GATE.bots, `bots ${pct(au.botHoldersPercentage ?? 0)}`],
    ['snipers', (au.sniperPct ?? 0) <= GATE.snipers, `snipers ${pct(au.sniperPct ?? 0)}`],
    ['dev bag', (au.devBalancePercentage ?? 0) <= GATE.devHolds, `dev holds ${pct(au.devBalancePercentage ?? 0)}`],
    ['dev record', au.devMints != null && au.devMints < GATE.devLaunches, au.devMints != null ? `dev: ${au.devMints} coin${au.devMints === 1 ? '' : 's'}, ${au.devMigrations ?? 0} bonded` : 'dev record unknown'],
    ['organic', ORGANIC.has(a?.organicScoreLabel), `organic trading ${a?.organicScoreLabel || 'unknown'}`],
    ['buying', (s1.buyVolume || 0) > 0 && (s1.buyVolume || 0) >= (s1.sellVolume || 0), `1h: ${money(s1.buyVolume)} bought, ${money(s1.sellVolume)} sold`],
  ];
  const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
  return { pass: !failed.length, lines: checks.map(([, , line]) => line), failed };
}

const dex = (a) => `https://dexscreener.com/solana/${String(a).replace(/[^1-9A-HJ-NP-Za-km-z]/g, '')}`;
const scan = (a) => `https://tryradar.fun/scan?q=${String(a).replace(/[^1-9A-HJ-NP-Za-km-z]/g, '')}&from=discord`;
const ago = (ms) => { const m = Math.max(1, Math.round(ms / 60_000)); return m < 60 ? `${m} min` : `${Math.round(m / 60)} h`; };
const clean = (s, n) => String(s || '').replace(/[`*_~|<>@#[\]()\\]/g, '').replace(/https?:\S*/gi, '').trim().slice(0, n);

/** A Discord message for one signal: the flag (row from the track table), Jupiter's asset now, and its checks. */
export function signalMessage(row, a, check, now = Date.now()) {
  const sym = ticker(a?.symbol || row.symbol);
  const story = clean(row.story, 60);
  const rows = [
    `**Breaking now:** ${story ? `"${story}" · ` : ''}flagged ${ago(now - row.at)} ago at ${money(row.mc0)}`,
    `**Now:** ${check.lines[0]} · ${check.lines[2]}`,
    `**Checks passed:** ${check.lines.slice(1).filter((_, i) => i !== 1).join(' · ')}`,
    '',
    `[Chart](${dex(row.mint)}) · [Full scan on Radar](${scan(row.mint)})`,
    `\`${String(row.mint).replace(/[^1-9A-HJ-NP-Za-km-z]/g, '')}\``,
  ];
  return {
    embeds: [{
      title: `Radar signal · $${sym}${clean(a?.name || row.name, 40) && clean(a?.name || row.name, 40) !== sym ? ` (${clean(a?.name || row.name, 40)})` : ''}`,
      url: dex(row.mint),
      description: rows.join('\n'),
      color: 0x5621AC,
      footer: { text: "Passed every Radar check when posted. That's not a prediction: most new coins go to zero. Not financial advice." },
    }],
    allowed_mentions: { parse: [] },
  };
}

/** Jupiter's assets for up to MAX_LOOKUP mints, keyed by mint. One request. */
export async function lookup(fetcher, mints) {
  const list = [...new Set(mints)].slice(0, MAX_LOOKUP);
  if (!list.length) return new Map();
  const r = await fetcher(JUP_ASSETS + list.join(','), { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`Jupiter ${r.status}`);
  const d = await r.json();
  return new Map((Array.isArray(d) ? d : []).filter((a) => a?.id).map((a) => [a.id, a]));
}

/** The flags old enough to look at and not yet posted, newest first. state: { posted: {mint: at}, stories: {story: at} }. */
export async function candidates(db, state, now = Date.now()) {
  const { results } = await db.prepare("SELECT mint, symbol, name, story, at, mc0 FROM track WHERE source = 'breaking' AND at <= ? AND at >= ? ORDER BY at DESC LIMIT 80")
    .bind(now - DELAY_MS, now - WINDOW_MS).all();
  return (results || []).filter((r) => !state.posted?.[r.mint] && !(r.story && now - (state.stories?.[r.story] || 0) < STORY_COOLDOWN_MS));
}

/** The coin to post this minute: the biggest that passes, or null. */
export function pick(rows, assets) {
  return rows.map((row) => ({ row, a: assets.get(row.mint) })).filter((x) => x.a)
    .map((x) => ({ ...x, check: checkCoin(x.a) })).filter((x) => x.check.pass)
    .sort((x, y) => (y.a.mcap || 0) - (x.a.mcap || 0))[0] || null;
}

/** state after posting `row`: counts the day, remembers the coin and its story, forgets what's a day old. */
export function after(state, row, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  const keep = (o, ms) => Object.fromEntries(Object.entries(o || {}).filter(([, at]) => now - at < ms));
  return {
    ...state,
    day,
    sent: (state.day === day ? state.sent || 0 : 0) + 1,
    posted: { ...keep(state.posted, 86_400_000), [row.mint]: now },
    stories: { ...keep(state.stories, STORY_COOLDOWN_MS), ...(row.story ? { [row.story]: now } : {}) },
    last: { mint: row.mint, symbol: row.symbol, at: now },
  };
}

export const sentToday = (state, now = Date.now()) => (state.day === new Date(now).toISOString().slice(0, 10) ? state.sent || 0 : 0);

/** A channel webhook URL from Discord, or null. */
export const webhookOf = (u) => (/^https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(String(u || '').trim()) ? String(u).trim() : null);
