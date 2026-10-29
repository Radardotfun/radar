// Per-step timing of a launch scan on the public RPC.
import { makeRpc, analyzeLaunch } from '../extension/src/lib/solana.js';
const mint = process.argv[2];
const t0 = Date.now();
const base = makeRpc();
const counts = {};
const rpc = async (m, p) => { const t = Date.now(); try { return await base(m, p); } finally { (counts[m] ||= []).push(Date.now() - t); } };
const pairs = await (await fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${mint}`)).json();
const dated = pairs.filter((p) => p.pairCreatedAt).sort((a, b) => a.pairCreatedAt - b.pairCreatedAt);
const launchMs = dated[0]?.pairCreatedAt || null;
const rc = await (await fetch(`https://api.rugcheck.xyz/v1/tokens/${mint}/report`)).json().catch(() => ({}));
console.log('prefetch', Date.now() - t0, 'ms');
const t1 = Date.now();
const r = await analyzeLaunch(rpc, mint, launchMs, pairs.map((p) => p.pairAddress), { hintMs: Math.min(launchMs || Infinity, Date.parse(rc.detectedAt || '') || Infinity), maxPages: 10, launchPair: dated[0]?.pairAddress });
console.log('scan', Date.now() - t1, 'ms', r.ok ? `bundled ${r.bundledPct}% (${r.bundleWallets})` : r.reason);
for (const [m, l] of Object.entries(counts)) console.log(' ', m.padEnd(24), l.length, 'calls', l.reduce((a, b) => a + b, 0), 'ms total', Math.max(...l), 'max');
