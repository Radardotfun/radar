// Coin check: how fair a coin is to buy right now, from who holds it and who controls it.
// Built from the RugCheck report and our own launch-block scan. It describes control, not intent:
// the words say who could move the price, never that anyone will.
//
// Thresholds (watch / risk, % of supply) follow what traders already use on X:
// insiders 2 / 10, dev holds 1 / 5, top 10 holders 30 / 50, launch buyers still holding 1 / 5,
// price drop if insiders sold everything 20 / 50.

const T = {
  insiders: [2, 10],
  dev: [1, 5],
  top10: [30, 50],
  launchHeld: [1, 5],
  drop: [20, 50],
};
const level = (v, [watch, risk]) => (v == null ? null : v >= risk ? 'risk' : v >= watch ? 'watch' : 'ok');

// How far the price falls if `soldPct` of supply is sold into a constant-product pool holding
// `poolTokens` of a `supplyTokens` supply: the token reserve grows to R + X, price scales by (R/(R+X))².
export function dropIfSold(soldPct, poolTokens, supplyTokens) {
  if (!soldPct || !poolTokens || !supplyTokens) return null;
  const x = (soldPct / 100) * supplyTokens;
  return (1 - (poolTokens / (poolTokens + x)) ** 2) * 100;
}

/**
 * token: Radar token (liquidity, onCurve, createdAt), rug: rugReport(), bundle: analyzeLaunch() result.
 * Returns null until there is enough data to say anything.
 */
export function coinCheck(token, rug, bundle) {
  if (!rug && !bundle?.ok) return null;
  const b = bundle?.ok ? bundle : null;
  const facts = [];
  let score = 100;
  let worst = 'ok';
  const note = (lvl, penaltyWatch, penaltyRisk) => {
    if (lvl === 'risk') { score -= penaltyRisk; worst = 'risk'; }
    else if (lvl === 'watch') { score -= penaltyWatch; if (worst === 'ok') worst = 'watch'; }
  };

  // Insiders: wallets tied to the launch (launch block buyers + dev still holding) or linked by
  // transfers (RugCheck's networks). Take the larger view rather than adding overlapping sets.
  const launchHeld = b ? b.bundleHeldPct + b.devHeldPct : null;
  const linked = rug?.insiderPct ?? null;
  const insiders = Math.max(launchHeld ?? 0, linked ?? 0);
  const lvIns = level(insiders, T.insiders);
  note(lvIns, 10, 30);
  if (launchHeld != null || linked != null) {
    facts.push({ k: 'Insiders hold', v: insiders, lvl: lvIns, sub: !insiders ? '' : linked != null && linked >= (launchHeld ?? 0) ? `${rug.insiderWallets} linked wallets` : 'launch wallets' });
  }

  const dev = b ? b.devHeldPct : rug?.creatorPct ?? null;
  const lvDev = level(dev, T.dev);
  note(lvDev, 6, 18);
  if (dev != null) facts.push({ k: 'Dev holds', v: dev, lvl: lvDev });

  if (b) {
    const lvLaunch = level(b.bundleHeldPct, T.launchHeld);
    note(lvLaunch, 5, 12);
    facts.push({ k: 'Launch buyers still hold', v: b.bundleHeldPct, lvl: lvLaunch });
  }

  const top10 = rug?.top10Pct ?? null;
  const lvTop = level(top10, T.top10);
  note(lvTop, 8, 18);
  if (top10 != null) facts.push({ k: 'Top 10 hold', v: top10, lvl: lvTop });

  const drop = dropIfSold(insiders, rug?.poolTokens, rug?.supplyTokens);
  const lvDrop = level(drop, T.drop);
  note(lvDrop, 8, 18);
  if (drop != null && insiders > 0) facts.push({ k: 'If insiders sold all', v: -drop, lvl: lvDrop, unit: 'price' });

  // Hard controls: a live mint can print supply, a live freeze can stop holders from selling.
  if (rug?.freezeAuthority) { score -= 45; worst = 'risk'; facts.push({ k: 'Freeze authority', text: 'Active: holders can be frozen', lvl: 'risk' }); }
  if (rug?.mintAuthority) { score -= 30; worst = 'risk'; facts.push({ k: 'Mint authority', text: 'Active: supply can grow', lvl: 'risk' }); }
  if (rug && !token?.onCurve && rug.lpLockedPct < 50) { score -= 15; if (worst === 'ok') worst = 'watch'; facts.push({ k: 'Liquidity', text: `${Math.round(rug.lpLockedPct)}% locked or burned`, lvl: 'watch' }); }
  if (rug?.copycat) { score -= 10; if (worst === 'ok') worst = 'watch'; facts.push({ k: 'Copycat', text: 'Same name as an older coin', lvl: 'watch' }); }
  if (!token?.onCurve && token?.liquidity != null && token.liquidity < 5000) { score -= 8; if (worst === 'ok') worst = 'watch'; }
  if (rug?.rugged) { score = Math.min(score, 5); worst = 'risk'; facts.unshift({ k: 'Status', text: 'Liquidity pulled', lvl: 'risk' }); }

  if (worst === 'risk') score = Math.min(score, 64); // a serious flag outweighs a clean rest
  score = Math.max(0, Math.min(100, Math.round(score)));
  const word = score < 35 ? 'CONTROLLED' : worst === 'risk' ? 'SKETCHY' : score >= 60 ? 'OK' : 'NEUTRAL';
  return { score, word, call: callLine(word, facts), facts };
}

const pctText = (v) => `${Math.abs(v) < 10 ? Math.abs(v).toFixed(1) : Math.round(Math.abs(v))}%`;

// One line for traders: the two facts that matter most, in plain words.
function callLine(word, facts) {
  const ranked = facts.filter((f) => f.lvl === 'risk').concat(facts.filter((f) => f.lvl === 'watch'));
  const pick = (ranked.length ? ranked : facts).slice(0, 2).map((f) => (f.text ? `${f.k.toLowerCase()}: ${f.text.toLowerCase()}` : f.unit === 'price' ? `insiders selling would drop price ~${pctText(f.v)}` : `${f.k.toLowerCase()} ${pctText(f.v)}`));
  if (!pick.length) return word === 'OK' ? 'Spread-out holders, no live controls.' : '';
  const s = pick.join(' · ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
