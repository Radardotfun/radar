// Panel bugs from the 3 Nov hunt, kept from coming back. node test/panel-fixes.mjs
// The real panel (extension/src/ui/radar.js) runs on a small DOM stand-in; the backend (handlers.js) runs with fetch stubbed.
import assert from 'node:assert/strict';

class El {
  constructor() { this.dataset = {}; this.style = {}; this._html = ''; this.value = ''; this.scrollTop = 0;
    this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false }; }
  set innerHTML(v) { this._html = v; } get innerHTML() { return this._html; }
  querySelector() { return new El(); } querySelectorAll() { return []; }
  addEventListener() {} append() {} appendChild(c) { return c; } setAttribute() {} removeAttribute() {}
  getRootNode() { return { activeElement: null }; } matches() { return false; } closest() { return null; }
  focus() {} blur() {} getClientRects() { return []; } scrollIntoView() {}
}
globalThis.document = { createElement: () => new El(), addEventListener() {}, hidden: false, body: new El() };
globalThis.window = globalThis; globalThis.addEventListener = () => {};
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.location = { hostname: 'tryradar.fun' };
globalThis.getComputedStyle = () => ({ backgroundColor: 'rgb(0,0,0)' });
globalThis.MutationObserver = class { observe() {} };


const ui = await import('../extension/src/ui/radar.js');
const tok = (sym, name, address, mc, vol = 5000, backed = true) => ({ chain: 'solana', address, name, symbol: sym, marketCap: mc, liquidity: 30000, mcapBacked: backed,
  priceUsd: 0.0005, volume: { m5: 1, h1: 100, h6: 1, h24: vol }, txns: { h1: { buys: 5, sells: 5 }, h24: { buys: 50, sells: 50 } }, priceChange: { h1: 1 }, createdAt: Date.now() - 50 * 864e5, links: [], pairAddresses: [] });
const METH = tok('METH', 'Wethamphetamine', 'Meth111111111111111111111111111111111111', 78_000, 2371);
const PEPE = tok('PEPE', 'Pepe', 'Pepe111111111111111111111111111111111111', 724_000, 1_230_000);
const DUST = tok('METH', 'meth copy', 'Dust111111111111111111111111111111111111', 2_000, 20, false);
const fail = () => Promise.reject(new Error('n/a'));
let speech = 'so I named my new coin Julia, the teacher who cannot spell, and the whole class is buying it today';
const handlers = {
  starList: async () => [], settings: async () => ({ refreshSec: 10 }), 'frontrun:status': fail, 'alerts:list': fail, lcSettings: async () => ({}),
  holderStatus: async () => ({ on: false }), launchState: async () => ({ state: 'off' }), postCoins: async () => [],
  story: fail, larpcheck: async () => null, recentAdd: async () => {}, safety: fail, bundle: fail, refresh: async () => ({ tokens: {} }),
  read: async ({ post }) => ({ narrative: 'A story', post: { ...post, ...(post.videoUrl ? { transcript: speech } : {}) } }),
  coins: async ({ post }) => ({ mode: 'ai', ts: Date.now(), mentioned: [],
    picks: [{ role: 'top', token: PEPE }, { role: 'mover', token: METH }], others: /\$meth/i.test(post.text) ? [DUST] : [] }),
};
ui.useBackend(handlers, { cssText: '/* css */' });
const radar = await ui.mountInline(new El(), 'dark');

// 1. Heard in the video: what's said in a video post shows under the story, shortened with a button for all of it.
{
  await radar.scan({ post: { text: 'watch this', author: 'mario', url: 'https://x.com/mario/status/1850000000000000010', videoUrl: 'https://video.twimg.com/a.mp4', hasVideo: true } });
  const lead = radar.leadEl.innerHTML;
  assert.match(lead, /Heard in the video/);
  assert.match(lead, /named my new coin Julia/);
  speech = 'word '.repeat(80);
  await radar.scan({ post: { text: 'watch this again', author: 'mario', url: 'https://x.com/mario/status/1850000000000000011', videoUrl: 'https://video.twimg.com/b.mp4', hasVideo: true } });
  assert.match(radar.leadEl.innerHTML, /word…”/, 'a long one is shortened on a whole word');
  assert.match(radar.leadEl.innerHTML, /data-act="heard-more"/);
  await radar.scan({ post: { text: 'no video here', author: 'mario', url: 'https://x.com/mario/status/1850000000000000012' } });
  assert.doesNotMatch(radar.leadEl.innerHTML, /Heard in the video/, 'a post without speech shows none');
  console.log('PASS panel: what a video says shows under the story');
}

// 2. Ticker in the post: "Sharing some $meth" pins the $78K Wethamphetamine first, not as the Mover under Pepe; a thin
// copy under the same ticker doesn't count, and the coin isn't shown twice.
{
  await radar.scan({ post: { text: 'Are we back. Sharing some $meth to stay happy forever', author: 'Bundle_buyer', url: 'https://x.com/Bundle_buyer/status/2117994561494515874' } });
  const body = radar.bodyEl.innerHTML;
  assert.match(body, /TICKER IN THE POST/);
  const cards = [...body.matchAll(/<article class="card (\w+)[^"]*" data-addr="(\w+)"/g)].map((m) => `${m[1]}:${m[2].slice(0, 4)}`);
  assert.equal(cards[0], 'typed:Meth', `cards ${cards}`);
  assert.equal(cards.filter((c) => c.endsWith('Meth')).length, 1, 'shown once');
  assert.ok(!cards.some((c) => c.endsWith('Dust')), 'the thin copy is not pinned');
  await radar.scan({ post: { text: 'Stonk memes looking bullish', author: 'Bundle_buyer', url: 'https://x.com/Bundle_buyer/status/2117994561494515875' } });
  assert.doesNotMatch(radar.bodyEl.innerHTML, /TICKER IN THE POST/, 'no ticker typed, nothing pinned');
  console.log('PASS panel: the ticker a post types is pinned first');
}
process.exit(0);
