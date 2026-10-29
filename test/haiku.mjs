// Live speed/quality check of the deployed engine: node test/haiku.mjs
import { readPost, findCoins } from '../extension/src/lib/narrative.js';
const apiBase = 'https://narrative-radar.millenia-portfolio.workers.dev';
const posts = [
  { text: 'JUST IN: SpaceX files for IPO, targeting a $2 trillion valuation', author: 'WatcherGuru' },
  { text: 'Elon: Grok 5 will be the smartest AI in the world by far', author: 'elonmusk' },
  { text: 'this little penguin keeps walking away from the colony toward the mountains', author: 'someone' },
  { text: 'Kanye just dropped a new coin announcement on his story lol', author: 'cryptodegen' },
  { text: 'Fed cuts rates by 50bps, Powell says more cuts coming', author: 'DeItaone' },
];
const ms = [];
for (const post of posts) {
  const t = Date.now();
  try {
    const read = await readPost(post, ['solana'], { apiBase });
    const tr = Date.now() - t;
    const res = await findCoins(read, ['solana'], { apiBase });
    const total = Date.now() - t; ms.push(total);
    console.log(`\n=== ${post.text.slice(0, 55)}  read ${(tr / 1000).toFixed(1)}s, total ${(total / 1000).toFixed(1)}s  [${read.model || ''}]`);
    console.log('narrative:', read.narrative, '| judge:', read.judge);
    for (const p of res.picks || []) console.log(`  ${p.role.padEnd(6)} $${p.token.symbol.padEnd(10)} ${p.token.name.slice(0, 24).padEnd(24)} mc=$${Math.round(p.token.marketCap).toLocaleString()}`);
    if (res.error) console.log('ERR', res.error);
  } catch (e) { console.log('\nFAIL', post.text.slice(0, 40), e.message); }
}
ms.sort((a, b) => a - b);
console.log('\nmedian', (ms[ms.length >> 1] / 1000).toFixed(1), 's');
