// Holder / authority / insider data from RugCheck (Solana).
const RC = 'https://api.rugcheck.xyz/v1';

export async function rugReport(mint, pairAddresses = []) {
  const res = await fetch(`${RC}/tokens/${mint}/report`);
  if (res.status === 429) throw new Error('RugCheck rate limited');
  if (!res.ok) throw new Error(`RugCheck ${res.status}`);
  const r = await res.json();

  const supply = Number(r.token?.supply || 0);
  const pct = (raw) => (supply ? (Number(raw) / supply) * 100 : 0);
  const known = r.knownAccounts || {};
  const pools = new Set(pairAddresses);
  for (const m of r.markets || []) {
    if (m.pubkey) pools.add(m.pubkey);
    if (m.liquidityA) pools.add(m.liquidityA);
    if (m.liquidityB) pools.add(m.liquidityB);
  }
  const isPool = (h) =>
    pools.has(h.owner) || pools.has(h.address) ||
    ['AMM', 'LOCKER'].includes(known[h.owner]?.type) || ['AMM', 'LOCKER'].includes(known[h.address]?.type);

  const holders = (r.topHolders || []).filter((h) => !isPool(h));
  const top10 = holders.slice(0, 10).reduce((s, h) => s + (h.pct || 0), 0);
  const insiderHeld = (r.insiderNetworks || []).reduce((s, n) => s + Number(n.currentHolding || 0), 0);
  const lpLocked = Math.max(0, ...(r.markets || []).map((m) => m.lp?.lpLockedPct || 0));
  // Tokens sitting in pools (UI units), for "how far would the price fall if insiders sold".
  const inPool = (m) => Number(m.lp?.baseMint === mint ? m.lp?.base : m.lp?.quoteMint === mint ? m.lp?.quote : 0) || 0;
  const poolTokens = (r.markets || []).reduce((s, m) => s + inPool(m), 0);
  const decimals = Number(r.token?.decimals ?? 0);

  return {
    score: r.score_normalised ?? null,
    rugged: !!r.rugged,
    risks: (r.risks || []).map((x) => ({ name: x.name, level: x.level, value: x.value })).slice(0, 6),
    mintAuthority: r.mintAuthority || null,
    freezeAuthority: r.freezeAuthority || null,
    holders: r.totalHolders ?? null,
    top10Pct: top10,
    topHolder: holders[0] ? { pct: holders[0].pct, insider: !!holders[0].insider } : null,
    insiderWallets: r.graphInsidersDetected ?? 0,
    // RugCheck tallies cluster transfers cumulatively; above 100% it isn't a holding figure.
    insiderPct: pct(insiderHeld) <= 100 ? pct(insiderHeld) : null,
    creator: r.creator || null,
    creatorPct: pct(r.creatorBalance || 0),
    lpLockedPct: lpLocked,
    poolTokens: poolTokens || null,
    supplyTokens: supply ? supply / 10 ** decimals : null,
    copycat: (r.risks || []).some((x) => /copycat/i.test(x.name || '')),
    launchpad: r.launchpad?.name || null,
    tokenProgram: r.tokenProgram,
    detectedAt: r.detectedAt || null,
  };
}
