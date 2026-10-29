// Run posts through the deployed engine with diagnostics: node test/engine.mjs <debugToken> [model,...]
const [token, models] = process.argv.slice(2);
const U = 'https://narrative-radar.millenia-portfolio.workers.dev/narrative';
const posts = [
  { text: 'BREAKING: Trump announces 100% tariffs on all Chinese imports starting November 1st', author: 'WatcherGuru' },
  { text: 'JUST IN: Elon Musk says SpaceX Starship will carry the first humans to Mars by 2028', author: 'WatcherGuru' },
  { text: 'this little guy has been showing up at our office every day for a week. we named him biscuit', author: 'someone' },
];
for (const post of posts) {
  const t = Date.now();
  const r = await fetch(U, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...post, debug: token, models: models?.split(',') }) });
  const d = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  console.log(`\n=== ${post.text.slice(0, 60)}  (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  if (d.error) { console.log('ERR', d.error); continue; }
  console.log('narrative:', d.narrative, '\nterms:', d.keywords.join(', '));
  console.log('debug:', JSON.stringify({ ...d.debug, verdict: (d.debug.verdict || []).length }));
  for (const p of d.picks) console.log(`  ${p.role.padEnd(5)} $${p.token.symbol.padEnd(10)} ${p.token.name.slice(0, 22).padEnd(22)} mc=$${Math.round(p.token.marketCap).toLocaleString()} rel=${p.token.relevance} | ${p.token.reason}`);
  console.log('  others:', d.others.slice(0, 6).map((o) => `$${o.symbol}(${o.relevance})`).join(' '));
}
