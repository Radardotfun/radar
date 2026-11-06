// Bag Guard, a holder perk (extension only): Radar watches the coins in the holder's own wallets and speaks up the moment one
// turns: the dev sells, insiders dump, a top holder exits, the holder check turns serious (freeze or mint authority, a rug
// flag), Larpcheck's verdict turns bad, or liquidity is pulled from the pool. Like Radar Guard it says what happened and
// tells nobody to sell; the alert opens the coin on the holder's trading terminal.
// The wallets are the ones the holder gave Diamond Hand plus the one proved in the holder check. They never leave this browser.
import { verdictTurned } from './alerts.js';
import { reportBlock, seriousWarning } from '../ui/holdercheck.js';

export const BAG_KEY = 'bag-guard';        // per-coin state from the last look
export const BAG_ON = 'bagGuard';          // on unless turned off
export const BAG_LIST = 'bag-guard-bags';  // what the panel shows: the bags and where each stands
export const BAG_MINUTES = 5;
export const BAG_MIN_USD = 5;              // smaller holdings are dust, not a bag
export const MAX_BAGS = 12;
export const REPORTS_PER_RUN = 4;          // holder reports are the slow, rate-limited part: a few bags a run, oldest first
export const TOKEN_PROGRAMS = ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'];
// Not a bag: SOL and the dollars.
const SKIP = new Set(['So11111111111111111111111111111111111111112', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', 'USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB']);

// Thresholds. A dev or insider group has to have held a real share to begin with, and to have let go of at least half of it.
export const T = { devMin: 0.5, insiderMin: 3, whaleMin: 3, dropShare: 0.5, whaleKeeps: 0.3, liqBase: 3000, liqMin: 500 };

const name = (b) => `$${String(b.symbol || '').trim() || '?'}`;
const pct = (v) => `${v < 10 ? Number(v).toFixed(1) : Math.round(v)}%`;
const short = (a) => `${a.slice(0, 4)}…${a.slice(-4)}`;

/** What a wallet holds: mint -> amount (UI units), over both token programs. A failed read throws: no answer is not "empty". */
export async function walletHoldings(wallet, rpc) {
  const out = new Map();
  for (const programId of TOKEN_PROGRAMS) {
    const r = await rpc('getTokenAccountsByOwner', [wallet, { programId }, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
    for (const a of r?.value || []) {
      const info = a.account?.data?.parsed?.info;
      const amount = Number(info?.tokenAmount?.uiAmount || 0);
      if (info?.mint && amount > 0 && !SKIP.has(info.mint)) out.set(info.mint, (out.get(info.mint) || 0) + amount);
    }
  }
  return out;
}

/** The bags worth watching: holdings (mint -> { amount, wallets }) priced with fresh tokens (address -> token), $5 and up, biggest first. */
export function pickBags(holdings, tokens, { min = BAG_MIN_USD, max = MAX_BAGS } = {}) {
  const bags = [];
  for (const [mint, h] of holdings) {
    const t = tokens[mint];
    if (!t || t.chain !== 'solana') continue;
    const value = h.amount * (t.priceUsd || 0);
    if (value < min) continue;
    bags.push({ mint, symbol: t.symbol, name: t.name, amount: h.amount, wallets: [...h.wallets], value, priceUsd: t.priceUsd, liquidity: t.liquidity || 0, onCurve: !!t.onCurve, marketCap: t.marketCap || 0, pair: t.pair || null });
  }
  return bags.sort((a, b) => b.value - a.value).slice(0, max);
}

/**
 * One look at one bag. seen: { report: Radar's holder report (RugCheck, or Larpcheck's stand-in), lc: Larpcheck's answer },
 * each null when its source couldn't answer or wasn't asked this run. was: what the last look kept.
 * -> { state, events: [{ reason, text, word? }], status: a short line for the panel }.
 * The first look only notes where things stand: the coin was already like that when it was bought, so it isn't news.
 */
export function lookAtBag(bag, { report = null, lc = null } = {}, was = {}) {
  const state = { ...was, top: { ...(was.top || {}) } };
  const events = [];
  const first = !was.seen;
  state.seen = true;

  if (lc?.checked) {
    if (was.word && verdictTurned(was.word, lc.verdict)) events.push({ reason: 'verdict', word: lc.verdict, text: `Larpcheck now says ${lc.verdict} on ${name(bag)}` });
    state.word = lc.verdict;
  }

  if (report) {
    state.reportAt = Date.now();
    // The holder check turning serious: a freeze or mint authority, a rug flag, liquidity pulled.
    const block = reportBlock(report);
    const serious = seriousWarning(block) ? block : null;
    if (serious && !first && serious !== was.serious) events.push({ reason: 'holders', text: `${name(bag)}: ${serious}` });
    state.serious = serious;

    // The dev letting go of half or more of what they held at the most.
    if (report.source !== 'larpcheck' && Number.isFinite(report.creatorPct)) {
      const peak = Math.max(was.devPeak || 0, report.creatorPct);
      if (!first && !was.devSent && peak >= T.devMin && report.creatorPct <= peak * (1 - T.dropShare)) {
        state.devSent = true;
        events.push({ reason: 'dev', text: `The dev of ${name(bag)} sold ${pct(peak - report.creatorPct)} of supply (held ${pct(peak)}, now ${pct(report.creatorPct)})` });
      }
      state.devPeak = peak;
    }

    // Insiders (wallets RugCheck links together) dumping half or more of their share.
    if (Number.isFinite(report.insiderPct)) {
      const peak = Math.max(was.insiderPeak || 0, report.insiderPct);
      if (!first && !was.insiderSent && peak >= T.insiderMin && report.insiderPct <= peak * (1 - T.dropShare)) {
        state.insiderSent = true;
        events.push({ reason: 'insiders', text: `Insiders in ${name(bag)} sold ${pct(peak - report.insiderPct)} of supply (held ${pct(peak)}, now ${pct(report.insiderPct)})` });
      }
      state.insiderPeak = peak;
    }

    // A top holder exiting: a wallet that held 3% or more now holds under 30% of its most. Out of the list counts as sold
    // only when the list's smallest holding is already under that, so "dropped off the list" can't be a guess.
    // state.top: owner -> { peak, sent }, for wallets that have held 3% or more.
    if (Array.isArray(report.top) && report.top.length) {
      const now = new Map(report.top.map((h) => [h.owner, h.pct]));
      const floor = Math.min(...report.top.map((h) => h.pct));
      for (const [owner, w] of Object.entries(state.top)) {
        if (w.sent) continue;
        const held = now.has(owner) ? now.get(owner) : (report.top.length >= 10 && floor < w.peak * T.whaleKeeps ? 0 : null);
        if (held == null || first || held > w.peak * T.whaleKeeps) continue;
        state.top[owner] = { ...w, sent: true };
        events.push({ reason: 'whale', text: `A top holder of ${name(bag)} (${short(owner)}, ${pct(w.peak)}) sold ${held ? `down to ${pct(held)}` : 'out'}` });
      }
      for (const [owner, p] of now) {
        const w = state.top[owner];
        if (w) state.top[owner] = { ...w, peak: Math.max(w.peak, p) };
        else if (p >= T.whaleMin) state.top[owner] = { peak: p, sent: false };
      }
    }
  }

  // Liquidity pulled. A pool's dollar depth falls with the price on its own (about with the square root of it), so only a
  // fall far beyond that reads as liquidity taken out. Coins on their launch curve have no pool to pull.
  if (!bag.onCurve && bag.liquidity >= 0) {
    if (!was.liqBase) { state.liqBase = bag.liquidity; state.priceBase = bag.priceUsd; }
    else if (!was.liqSent && was.liqBase >= T.liqBase && was.priceBase > 0) {
      const liqLeft = bag.liquidity / was.liqBase;
      const expected = Math.sqrt(Math.max(0, bag.priceUsd / was.priceBase));
      if (bag.liquidity < T.liqMin || (liqLeft <= 0.4 && liqLeft < expected * 0.6)) {
        state.liqSent = true;
        events.push({ reason: 'liquidity', text: `Liquidity in ${name(bag)}'s pool is down ${Math.round((1 - liqLeft) * 100)}%, far more than its price: it looks pulled` });
      }
    }
  } else if (bag.onCurve) { state.liqBase = 0; state.priceBase = 0; }

  const status = events[0]?.text || (state.serious ? `Watch: ${state.serious}` : state.devSent ? 'The dev sold' : state.insiderSent ? 'Insiders sold' : state.liqSent ? 'Liquidity looks pulled' : 'Quiet');
  return { state, events, status };
}

// The holder wallet the holder check proved, from the token's payload (it is signed by the server; reading it here only
// tells which wallet it is). Null when there's no token or it can't be read.
export function provedWallet(token) {
  try {
    const body = String(token || '').split('.')[0];
    const json = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')));
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(json?.a || '') ? json.a : null;
  } catch { return null; }
}

// The trading-terminal link for a bag: Axiom's pair page, which opens sell as well as buy.
export const terminalUrl = (bag) => (bag.pair ? `https://axiom.trade/meme/${bag.pair}?chain=sol` : `https://dexscreener.com/solana/${bag.mint}`);
