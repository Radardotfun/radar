// Dry run of the Radar bot: scans real posts the way a tag would (Radar's own backend, the same one the web version
// runs) and prints the reply it would post. Nothing is posted. node bot/dry-run.mjs <post url> [post url...]
import { makeHandlers, DEFAULTS } from '../extension/src/lib/handlers.js';
import { botReply, NO_COINS, xLength } from './reply.js';

const mem = new Map();
const h = makeHandlers({
  settings: async () => DEFAULTS,
  store: { get: async (k) => mem.get(k), set: async (k, v) => mem.set(k, v) },
  openWindow: () => {},
  rpcUrl: async () => null,
  ready: Promise.resolve(),
  inlineImages: false,
});

for (const url of process.argv.slice(2)) {
  const t0 = Date.now();
  try {
    const { post } = await h.tweet({ url });
    const res = await h.coins({ post });
    const reply = botReply(res, url) || NO_COINS;
    console.log(`\n=== ${url}\n(${((Date.now() - t0) / 1000).toFixed(1)}s · ${xLength(reply)} chars · story: ${res.narrative || '—'})\n`);
    console.log(reply);
  } catch (e) {
    console.log(`\n=== ${url}\nFAILED: ${e.message}`);
  }
}
