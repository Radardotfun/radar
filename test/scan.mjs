import { extractKeywords } from '../extension/src/lib/keywords.js';
import { searchPairs, pairsForTokens, aggregate, relevance, pickThree } from '../extension/src/lib/market.js';
import { rugReport } from '../extension/src/lib/rugcheck.js';
const texts = process.argv.slice(2);
for (const text of texts) {
  const kws = extractKeywords(text);
  console.log('\n### ', text.slice(0, 80), '\n kws:', kws);
  const pairs = (await Promise.all(kws.map(k => searchPairs(k).catch(() => [])))).flat().filter(p => p.chainId === 'solana');
  const scored = aggregate(pairs).map(t => ({ t, r: relevance(t, kws).score })).filter(x => x.r >= 1).sort((a,b)=>b.r-a.r).slice(0,60);
  const rel = new Map(scored.map(x => [x.t.address, x.r]));
  const tokens = aggregate(await pairsForTokens('solana', scored.map(x => x.t.address))).filter(t => rel.has(t.address)).map(t => ({...t, relevance: rel.get(t.address)}));
  const { picks, others } = pickThree(tokens);
  const age = ms => ms ? Math.round((Date.now()-ms)/864e5)+'d' : '?';
  for (const p of picks) { const t=p.token; console.log(` ${p.role.padEnd(5)} ${t.symbol.padEnd(10)} ${t.name.slice(0,22).padEnd(22)} mc=$${Math.round(t.marketCap).toLocaleString()} liq=$${Math.round(t.liquidity).toLocaleString()} vol24=$${Math.round(t.volume.h24).toLocaleString()} age=${age(t.createdAt)} h1=${t.priceChange.h1} ${t.address} ${p.alsoTop?'+top':''}${p.alsoOg?'+og':''}`); }
  console.log(' others:', others.slice(0,6).map(t=>t.symbol+'($'+Math.round(t.marketCap/1000)+'k)').join(', '));
  if (picks[0]) { const r = await rugReport(picks[0].token.address, picks[0].token.pairAddresses); console.log(' rug:', JSON.stringify(r).slice(0, 600)); }
}
