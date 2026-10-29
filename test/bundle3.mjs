// Three launch scans at once over one public-RPC connection, like a panel with three cards.
import { makeRpc, analyzeLaunch } from '../extension/src/lib/solana.js';
import { searchPairs, aggregate } from '../extension/src/lib/market.js';
const rpc = makeRpc(undefined, { concurrency: 3 });
const queries = process.argv.slice(2);
const t0 = Date.now();
const tokens = (await Promise.all(queries.map((q) => searchPairs(q)))).map((ps) => aggregate(ps).filter((t) => t.chain === 'solana').sort((a, b) => b.volume.h24 - a.volume.h24)[0]).filter(Boolean);
await Promise.all(tokens.map(async (t) => {
  const s = Date.now();
  const rc = await fetch(`https://api.rugcheck.xyz/v1/tokens/${t.address}/report`).then((r) => r.json()).catch(() => ({}));
  const hint = Math.min(t.createdAt || Infinity, Date.parse(rc.detectedAt || '') || Infinity);
  const r = await analyzeLaunch(rpc, t.address, t.createdAt, t.pairAddresses, { hintMs: Number.isFinite(hint) ? hint : null, launchPair: t.launchPair, maxPages: 10 }).catch((e) => ({ ok: false, reason: e.message }));
  console.log(`${((Date.now() - s) / 1000).toFixed(1).padStart(5)}s  $${t.symbol.padEnd(10)} age ${Math.round((Date.now() - t.createdAt) / 864e5)}d  ${r.ok ? `bundled ${r.bundledPct}% (${r.bundleWallets}w) DB ${r.devBoughtPct}%` : r.reason}`);
}));
console.log('all done', ((Date.now() - t0) / 1000).toFixed(1), 's');
