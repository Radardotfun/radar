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
const { makeHandlers, DEFAULTS } = await import('../extension/src/lib/handlers.js');

// 1. Market caps that round up to the next unit say the next unit.
{
  const { usd } = ui;
  assert.equal(usd(999_600), '$1.00M');
  assert.equal(usd(99_960), '$100K');
  assert.equal(usd(9_996), '$10.0K');
  assert.equal(usd(9_994), '$9.99K');
  assert.equal(usd(999_499), '$999K');
  assert.equal(usd(999_600_000), '$1.00B');
  assert.equal(usd(1_234), '$1.23K');
  console.log('PASS panel: $999.6K reads $1.00M, not $1000K');
}

// 2. Copy summary waits for the new post's coins, and 3. only the newest larp check shows.
const tok = (sym) => ({ chain: 'solana', address: `${sym}1111111111111111111111111111111111`.slice(0, 40), name: sym, symbol: sym, marketCap: 500000, liquidity: 50000, mcapBacked: true,
  priceUsd: 0.0005, volume: { m5: 1, h1: 1000, h6: 1, h24: 5000 }, txns: { h1: { buys: 5, sells: 5 }, h24: { buys: 50, sells: 50 } }, priceChange: { h1: 1 }, createdAt: Date.now() - 3600e3, links: [], pairAddresses: [] });
let releaseB;
const coinsB = new Promise((r) => { releaseB = r; });
let releaseStory;
const fail = () => Promise.reject(new Error('n/a'));
const handlers = {
  starList: async () => [], settings: async () => ({ refreshSec: 10 }), 'frontrun:status': fail, 'alerts:list': fail, lcSettings: async () => ({}),
  holderStatus: async () => ({ on: false }), launchState: async () => ({ state: 'off' }), postCoins: async () => [],
  story: ({ coin }) => (coin.symbol === 'SLOW' ? new Promise((r) => { releaseStory = () => r({ word: 'LARP', score: 20 }); }) : fail()),
  larpcheck: async ({ address }) => (address.startsWith('FAST') ? { checked: true, verdict: 'REAL', score: 90 } : null),
  recentAdd: async () => {}, safety: fail, bundle: fail, refresh: async () => ({ tokens: {} }),
  read: async ({ post }) => ({ narrative: post.author === 'alice' ? 'Story A: a frog' : 'Story B: a cat' }),
  coins: async ({ post }) => (post.author === 'alice'
    ? { mode: 'ai', picks: [{ role: 'top', token: tok('AAA') }], others: [], mentioned: [], ts: Date.now() }
    : coinsB),
};
ui.useBackend(handlers, { cssText: '/* css */' });
const radar = await ui.mountInline(new El(), 'dark');
{
  await radar.scan({ post: { text: 'post A', author: 'alice', url: 'https://x.com/alice/status/1850000000000000000' } });
  assert.ok(radar.headEl.innerHTML.includes('data-act="share"'), 'post A can be shared');
  const b = radar.scan({ post: { text: 'post B', author: 'bob', url: 'https://x.com/bob/status/1850000000000000001' } });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(radar.state.loading, true);
  assert.equal(radar.headEl.innerHTML.includes('data-act="share"'), false, 'no share button while post B loads');
  assert.equal(radar.shareable(), false);
  releaseB({ mode: 'ai', picks: [{ role: 'top', token: tok('BBB') }], others: [], mentioned: [], ts: Date.now() });
  await b;
  assert.ok(radar.shareable());
  assert.match(radar.shareText(), /@bob's post[\s\S]*\$BBB/);
  assert.doesNotMatch(radar.shareText(), /\$AAA/);
  assert.match(radar.shareText(), /Full scan with Radar: https:\/\/tryradar\.fun\/scan\?url=https%3A%2F%2Fx\.com%2Fbob%2Fstatus%2F1850000000000000001$/, 'the summary links to the same scan');
  console.log("PASS panel: the copied summary never pairs a post with the last post's coins");
}
{
  const id = radar.scanId;
  const post = { text: 'a video post', url: 'https://x.com/bob/status/1850000000000000001' };
  const res = (t) => ({ mentioned: [], picks: [{ role: 'top', token: t }], others: [] });
  const first = radar.loadStory(post, 'Story B', res(tok('SLOW')), id);
  await new Promise((r) => setTimeout(r, 10));
  await radar.loadStory(post, 'Story B', res(tok('FAST')), id);
  assert.equal(radar.state.story?.coin, 'FAST');
  releaseStory();
  await first;
  assert.equal(radar.state.story?.coin, 'FAST', 'the slower check for the old coin does not take over');
  assert.equal(radar.state.story?.larpcheck?.verdict, 'REAL');
  await radar.loadStory(post, 'Story B', { mentioned: [], picks: [], others: [] }, id);
  assert.equal(radar.state.story, null, 'no main coin: no check left up');
  console.log('PASS panel: the larp check shows the coin on the cards, not an earlier one');
}
radar.stopTimers(); clearInterval(radar.agoTimer);

// 4. Rescan on a video post searches again for the speech read as well as the quick read.
{
  let onChain = ['OLDFROG'];
  const pair = (sym) => ({ chainId: 'solana', dexId: 'raydium', pairAddress: `${sym}pool111111111111111111111111111111`.slice(0, 40), url: 'x',
    baseToken: { address: `${sym}mint111111111111111111111111111111`.slice(0, 40), name: sym === 'OLDFROG' ? 'Old Frog' : 'New Frog', symbol: sym }, quoteToken: { address: 'So11111111111111111111111111111111111111112' },
    priceUsd: '0.001', priceNative: '0.00001', liquidity: { usd: 40000, quote: 200 }, marketCap: 900000, volume: { h24: 50000, h1: 5000, m5: 10, h6: 100 },
    txns: { h1: { buys: 30, sells: 20 }, h24: { buys: 300, sells: 200 } }, priceChange: { h1: 3 }, pairCreatedAt: Date.now() - 86400e3 });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    const json = (d, ms = 0) => new Promise((r) => setTimeout(() => r({ ok: true, status: 200, json: async () => d, headers: new Map() }), ms));
    if (u.endsWith('/transcribe')) return json({ text: 'frog frog frog' }, 2300);
    if (u.endsWith('/interpret')) return json({ narrative: 'frogs', coinable: true, terms: ['frog'], anchors: ['Frog'] });
    if (u.includes('/latest/dex/search')) return json({ pairs: onChain.map(pair) });
    if (u.includes('/token-pairs/v1/') || u.includes('/tokens/v1/')) { const a = u.split('/').pop(); return json(onChain.map(pair).filter((p) => a.includes(p.baseToken.address))); }
    throw new Error(`unmocked ${u}`);
  };
  const mem = new Map();
  const h = makeHandlers({ settings: async () => DEFAULTS, store: { get: async (k) => mem.get(k), set: async (k, v) => mem.set(k, v) }, openWindow() {}, rpcUrl: async () => null, ready: Promise.resolve() });
  const quick = { text: 'look at this', url: 'https://x.com/a/status/1850000000000000000', videoUrl: 'https://video.twimg.com/x.mp4', quickRead: true, images: [], skipBio: true };
  const { quickRead, ...withSpeech } = quick;
  const names = (r) => [...r.picks.map((p) => p.token.symbol), ...r.others.map((t) => t.symbol)].sort().join(',');
  await h.read({ post: quick });
  assert.equal(names(await h.coins({ post: withSpeech })), 'OLDFROG');
  onChain = ['OLDFROG', 'NEWFROG'];
  await h.forgetCoins({ post: quick });
  await h.read({ post: quick });
  assert.equal(names(await h.coins({ post: quick })), 'NEWFROG,OLDFROG');
  assert.equal(names(await h.coins({ post: withSpeech })), 'NEWFROG,OLDFROG', 'the speech read finds the new coin too');
  globalThis.fetch = realFetch;
  console.log('PASS panel: Rescan on a video post finds a coin launched since');
}
process.exit(0);
