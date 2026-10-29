// Smoke test of the shared backend with an in-memory host: node test/handlers.mjs [rpcUrl]
import { makeHandlers, DEFAULTS } from '../extension/src/lib/handlers.js';
const mem = new Map();
const h = makeHandlers({
  settings: async () => DEFAULTS,
  store: { get: async (k) => mem.get(k), set: async (k, v) => mem.set(k, v) },
  openWindow: () => {},
  rpcUrl: async () => process.argv[2] || null,
  ready: Promise.resolve(),
  inlineImages: false,
});
const t = Date.now();
const tw = await h.tweet({ url: 'https://x.com/cb_doge/status/2112923907644928395' });
console.log('tweet', tw.source.kind, tw.post.text.slice(0, 50));
const res = await h.coins({ post: tw.post });
console.log('coins', Date.now() - t, 'ms', res.picks.map((p) => `${p.role}:${p.token.symbol}`).join(' '));
const young = res.others.concat(res.picks.map((p) => p.token)).filter((x) => x.createdAt > Date.now() - 864e5 && x.chain === 'solana')[0];
if (young) {
  const b = await h.bundle({ mint: young.address, launchMs: young.createdAt, pairs: young.pairAddresses, launchPair: young.launchPair, launchDex: young.launchDex }).catch((e) => ({ err: e.message }));
  console.log('bundle', young.symbol, b.ok ? `${b.bundledPct}% (${b.bundleWallets} wallets)` : b.err || b.reason);
}
const old = res.picks[0]?.token;
const b2 = await h.bundle({ mint: old.address, launchMs: old.createdAt, pairs: old.pairAddresses, launchPair: old.launchPair, launchDex: old.launchDex }).catch((e) => ({ err: e.message }));
console.log('bundle old', old.symbol, b2.ok ? `${b2.bundledPct}%` : b2.err || b2.reason);
