// Coin side of a free-mode scan (anchor matching, no AI calls), on narratives from real CT posts.
import { findCoins } from '../extension/src/lib/narrative.js';
const cases = [
  { post: 'OpenSea mobile open to everyone', narrative: 'OpenSea mobile app opens to everyone', terms: ['OpenSea', 'OpenSea Mobile', 'OS'], anchors: ['opensea'] },
  { post: 'Elon: Bach is the Shakespeare of music', narrative: 'Elon praises Bach', terms: ['Bach', 'Johann Sebastian Bach', 'Shakespeare of Music'], anchors: ['bach', 'sebastian'] },
  { post: 'Elon calls SpaceXSI sexy', narrative: 'Elon calls SpaceX superintelligence sexy', terms: ['SpaceXSI', 'SpaceX SI', 'Sexy'], anchors: ['spacexsi', 'sexi'] },
  { post: 'SpaceX $SPCX could make $1T revenue', narrative: 'SpaceX could reach $1T revenue', terms: ['SpaceX', 'SPCX', 'Elon Musk', 'Starship'], anchors: ['spacex', 'spcx', 'elon'] },
  { post: 'Robinhood chain flips Hyperliquid in TVL', narrative: 'Robinhood Chain flips Hyperliquid in DeFi TVL', terms: ['Robinhood', 'Hood', 'Robinhood Chain'], anchors: ['robinhood', 'hood'] },
  { post: 'Japan adds Bitcoin to national reserve', narrative: 'Japan adds Bitcoin to its national reserve', terms: ['Japan Bitcoin', 'Japan', 'Bitcoin Reserve'], anchors: ['japan', 'nippon'] },
  { post: 'Kanye launches Yeezyland', narrative: 'Kanye West launches his own country Yeezyland', terms: ['Yeezyland', 'Kanye', 'Yeezy', 'YZY'], anchors: ['yeezy', 'kanye', 'yzy', 'ye'] },
  { post: 'Pudgy Penguins theme park in Dubai', narrative: 'Pudgy Penguins to open a theme park in Dubai', terms: ['Pudgy Penguins', 'PENGU', 'Pudgy'], anchors: ['pudgy', 'pengu'] },
];
for (const c of cases) {
  const t = Date.now();
  const r = await findCoins({ narrative: c.narrative, coinable: true, terms: c.terms, anchors: c.anchors, judge: false, mentioned: [], post: { text: c.post } }, ['solana'], { apiBase: 'https://narrative-radar.millenia-portfolio.workers.dev' }).catch((e) => ({ error: e.message }));
  console.log(`\n=== ${c.post}  (${((Date.now() - t) / 1000).toFixed(1)}s) ${r.timing ? JSON.stringify(r.timing) : ''}`);
  if (r.error) { console.log('ERR', r.error); continue; }
  for (const p of r.picks) console.log(`  ${p.role.padEnd(5)} $${p.token.symbol.slice(0, 12).padEnd(12)} ${p.token.name.slice(0, 26).padEnd(26)} mc=$${Math.round(p.token.marketCap).toLocaleString().padEnd(13)} liq=$${Math.round(p.token.liquidity).toLocaleString().padEnd(10)} vol=$${Math.round(p.token.volume.h24).toLocaleString()} rel=${p.token.relevance}`);
  console.log('  others:', r.others.slice(0, 6).map((o) => `$${o.symbol}`).join(' '));
}
