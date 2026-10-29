// Userscript stand-ins for what the extension's service worker provides: the radar backend runs in
// the page, requests go through the script manager (gm-fetch.js), storage through GM.getValue.
import { makeHandlers, API_BASE, DEFAULTS } from '../extension/src/lib/handlers.js';
import * as radarModule from '../extension/src/ui/radar.js';
import css from '../extension/src/ui/radar.css';
import { gmFetch } from './gm-fetch.js';

const MAINNET = 'https://api.mainnet-beta.solana.com';
const PUBLIC_NODE = 'https://solana-rpc.publicnode.com';

const gm = typeof GM !== 'undefined' ? GM : {};
const store = {
  async get(key) {
    try {
      const raw = gm.getValue ? await gm.getValue(key) : localStorage.getItem(`nr:${key}`);
      return raw == null ? null : JSON.parse(raw);
    } catch { return null; }
  },
  async set(key, value) {
    try {
      const raw = JSON.stringify(value);
      if (gm.setValue) await gm.setValue(key, raw);
      else localStorage.setItem(`nr:${key}`, raw);
    } catch {}
  },
};

const rpcCall = (url) => gmFetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSlot', params: [] }),
  signal: AbortSignal.timeout(6000),
}).then((r) => r.ok && r.json()).then((j) => typeof j?.result === 'number').catch(() => false);

// Which Solana RPC answers here. The project relay (if configured) is best; the public mainnet RPC
// works when the manager sends no Origin header; PublicNode always works but keeps only ~2 days.
let rpcPick = null;
function pickRpc() {
  rpcPick ||= (async () => {
    const health = await gmFetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(4000) }).then((r) => r.json()).catch(() => ({}));
    if (health.rpc) return `${API_BASE}/rpc`;
    if (await rpcCall(MAINNET)) return null; // null = the public mainnet RPC
    return PUBLIC_NODE;
  })();
  return rpcPick;
}

const handlers = makeHandlers({
  settings: async () => ({ ...DEFAULTS, ...((await store.get('settings')) || {}) }),
  store,
  openWindow: (url) => (gm.openInTab ? gm.openInTab(url, { active: true }) : window.open(url, '_blank', 'noopener')),
  rpcUrl: async (s) => s.rpcUrl || pickRpc(),
  ready: Promise.resolve(),
  // x.com's page security blocks DexScreener's image hosts; data: URLs are allowed.
  inlineImages: true,
  prunedNote: 'This browser reads a Solana node that keeps only recent blocks, so older launches can’t be checked here.',
});

radarModule.useBackend(handlers, { cssText: css });

globalThis.__nrHost = {
  send: async (msg) => {
    const fn = handlers[msg?.type];
    if (!fn) return { ok: false, error: `Unknown request ${msg?.type}` };
    try { return { ok: true, data: await fn(msg) }; } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  },
  get: (key) => store.get(key),
  set: (key, value) => store.set(key, value),
  radar: async () => radarModule,
};
