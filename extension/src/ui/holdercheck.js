// Holder check: is a coin something people really trade and hold, with no rug flags?
// One rule set for Instant Reroute (lib/reroute.js) and the line on every coin card, so they always agree.
// It lives in ui/ because the panel can only load files from here; the service worker imports it too.
//
// Thresholds were set against live RugCheck reports (28 Oct 2026): a RugCheck score alone passes
// coins where insiders hold 45-78% of supply, and dead coins show up as 9-97 holders.

export const RULES = {
  maxScore: 30, // RugCheck normalised score, lower is safer
  minHolders: 150,
  maxTopHolder: 15, // % of supply in one wallet, pools excluded
  maxTop10: 50,
  maxInsiders: 25, // % held by wallets RugCheck links together
};

// Still trading: a curve with real volume, or a pool with liquidity and volume.
export const alive = (t) => (t.onCurve ? t.volume?.h24 >= 500 : t.liquidity >= 2000 && t.volume?.h24 >= 250);

// Past its first day and barely trading: a cap like this is a number on a page more than a market. Cards and the bot's
// replies show the trade count beside it ($ELON at $285K had 17 trades that day).
const tradesDay = (t) => (t?.txns?.h24?.buys || 0) + (t?.txns?.h24?.sells || 0);
export const tradesLine = (t) => `${tradesDay(t)} trade${tradesDay(t) === 1 ? '' : 's'} 24h`;
export const quiet =(t, now = Date.now()) => !!t?.txns?.h24 && tradesDay(t) < 50 && (t.volume?.h24 || 0) < 2500 && !!t.createdAt && now - t.createdAt > 864e5;

const pct = (v) => `${v < 10 ? v.toFixed(1) : Math.round(v)}%`;

// Market side: is the coin something Axiom can open and people are actually trading?
export function marketBlock(token) {
  if (token?.chain !== 'solana') return 'not on Solana';
  if (!alive(token)) return 'not trading';
  // A cap with little behind it is easy to move. A deep pool is fine even when the cap dwarfs it ($BONK: $272M cap
  // over $744K in its main pool), so the thin-cap flag only counts while the pool is shallow.
  if (!token.mcapBacked && !token.onCurve && (token.liquidity || 0) < 50_000) return 'thin liquidity for its market cap';
  return null;
}

// Holder side, from rugReport(). Returns why the coin fails, or null when it passes. An unknown report never passes.
export function reportBlock(report, rules = RULES) {
  if (!report) return 'no holder report';
  // Larpcheck's read, while RugCheck is down: it has no score, so its own verdict stands in for one.
  if (report.source === 'larpcheck') {
    if (!report.authorityKnown) return 'mint and freeze authority unknown';
    if (report.freezeAuthority) return 'freeze authority is on';
    if (report.mintAuthority) return 'mint authority is on';
    if (!report.ok) return report.line ? `Larpcheck: ${report.line}` : "Larpcheck's holder check didn't pass";
    if (report.holders == null) return 'holder count unknown';
    if (report.holders < rules.minHolders) return `only ${report.holders} holders`;
    if ((report.top10Pct || 0) > rules.maxTop10) return `top 10 hold ${pct(report.top10Pct)}`;
    return null;
  }
  if (report.rugged) return 'liquidity pulled';
  if (report.freezeAuthority) return 'freeze authority is on';
  if (report.mintAuthority) return 'mint authority is on';
  const danger = (report.risks || []).find((r) => /danger|critical|high/i.test(r.level || ''));
  if (danger) return `RugCheck flags ${String(danger.name || 'a danger').toLowerCase()}`;
  if (report.score == null) return 'no RugCheck score';
  if (report.score > rules.maxScore) return `RugCheck score ${report.score}`;
  if (report.holders == null) return 'holder count unknown';
  if (report.holders < rules.minHolders) return `only ${report.holders} holders`;
  if ((report.topHolder?.pct || 0) > rules.maxTopHolder) return `one wallet holds ${pct(report.topHolder.pct)}`;
  if ((report.top10Pct || 0) > rules.maxTop10) return `top 10 hold ${pct(report.top10Pct)}`;
  if ((report.insiderPct || 0) >= rules.maxInsiders) return `insiders hold ${pct(report.insiderPct)}`;
  return null;
}
