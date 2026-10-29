// Instant reroute: the biggest coin on a post that isn't an obvious rug and has real holders.
// The rules are ui/holdercheck.js, shared with the holder line on every coin card.
import { RULES, marketBlock, reportBlock } from '../ui/holdercheck.js';

export { RULES, marketBlock, reportBlock };

/**
 * Highest market cap first. Reports are read `batch` at a time (RugCheck rate-limits bursts) and the
 * first passing coin in market-cap order wins, so a smaller coin never beats a bigger one that passes.
 * getReport(token) -> Promise<rugReport|null>.
 * Returns { token, report, rejected } where token is null when nothing passed.
 */
export async function pickReroute(tokens, getReport, { limit = 8, batch = 4, rules = RULES } = {}) {
  const seen = new Set();
  const list = (tokens || [])
    .filter((t) => t?.address && !seen.has(t.address) && seen.add(t.address))
    .sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0));
  const rejected = [];
  const live = [];
  for (const t of list) {
    const why = marketBlock(t);
    if (why) rejected.push({ token: t, why });
    else live.push(t);
  }
  const pool = live.slice(0, limit);
  for (let i = 0; i < pool.length; i += batch) {
    const slice = pool.slice(i, i + batch);
    const reports = await Promise.all(slice.map((t) => Promise.resolve().then(() => getReport(t)).catch(() => null)));
    for (let j = 0; j < slice.length; j++) {
      const why = reportBlock(reports[j], rules);
      if (!why) return { token: slice[j], report: reports[j], rejected };
      rejected.push({ token: slice[j], why });
    }
  }
  return { token: null, report: null, rejected };
}

// The one line shown when nothing passed: the biggest coin that was actually checked, and why it failed.
export function rejectionLine(rejected) {
  const r = rejected.find((x) => x.why !== 'not trading' && x.why !== 'not on Solana') || rejected[0];
  return r ? `$${String(r.token.symbol || '').trim()} ${r.why}` : '';
}
