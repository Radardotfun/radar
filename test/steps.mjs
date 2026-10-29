// Step timing of one narrative scan (same code the extension runs), with per-call wrappers.
import * as market from '../extension/src/lib/market.js';
const origFetch = globalThis.fetch;
const log = [];
const t0 = Date.now();
globalThis.fetch = async (url, opts) => {
  const s = Date.now();
  try { return await origFetch(url, opts); } finally {
    const u = String(url).replace(/https:\/\/([^/]+)\/([^?]*).*/, '$1/$2').slice(0, 70);
    log.push([s - t0, Date.now() - t0, u]);
  }
};
const { aiScan } = await import('../extension/src/lib/narrative.js');
const r = await aiScan({ text: process.argv[2] }, ['solana'], { apiBase: 'https://narrative-radar.millenia-portfolio.workers.dev' });
console.log('total', Date.now() - t0, 'ms', '| picks', r.picks.map((p) => p.token.symbol).join(', '));
for (const [s, e, u] of log) console.log(String(s).padStart(6), String(e).padStart(6), String(e - s).padStart(5), u);
