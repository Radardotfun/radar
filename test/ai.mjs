// End-to-end AI scan against the live engine, same code the extension runs.
// node test/ai.mjs "post text" ["post text" ...]
import { aiScan } from '../extension/src/lib/narrative.js';
const apiBase = 'https://narrative-radar.millenia-portfolio.workers.dev';
for (const text of process.argv.slice(2)) {
  const t = Date.now();
  const r = await aiScan({ text }, ['solana'], { apiBase }).catch((e) => ({ error: e.message }));
  console.log(`\n=== ${text.slice(0, 70)}  (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  if (r.error) { console.log('ERR', r.error); continue; }
  console.log('narrative:', r.narrative, r.judgeOffline ? `[judge offline: ${r.judgeOffline}]` : '');
  console.log('terms:', r.keywords.join(', '));
  for (const p of r.picks) console.log(`  ${p.role.padEnd(5)} $${p.token.symbol.slice(0, 10).padEnd(10)} ${p.token.name.slice(0, 24).padEnd(24)} mc=$${Math.round(p.token.marketCap).toLocaleString().padEnd(12)} ${p.token.relevance} | ${p.token.reason}`);
  console.log('  others:', r.others.slice(0, 8).map((o) => `$${o.symbol}(${o.relevance})`).join(' '));
}
