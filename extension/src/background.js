import { makeHandlers, API_BASE, DEFAULTS } from './lib/handlers.js';
import { listWallets, buy, KEY_RE, FRONTRUN_ORIGIN } from './lib/frontrun.js';

export { API_BASE, DEFAULTS };

// Firefox exposes promise-based APIs as `browser`; Chrome's `chrome` returns promises too.
const ext = globalThis.browser ?? chrome;

async function settings() {
  return { ...DEFAULTS, ...(await ext.storage.sync.get(DEFAULTS)) };
}

// Use the project's hosted RPC relay when it's configured (fast, shared); else the public RPC.
// Checked once when the worker starts, so no bundle scan waits on it.
let relayCheck = null;
function relayUrl() {
  relayCheck ||= fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(4000) })
    .then((r) => r.json()).then((h) => (h.rpc ? `${API_BASE}/rpc` : null)).catch(() => null);
  return relayCheck;
}

// api.mainnet-beta.solana.com rejects any request carrying an Origin header (403).
// Strip it — only for this extension's own requests to that host.
async function installRpcRule() {
  await ext.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [1],
    addRules: [{
      id: 1,
      priority: 1,
      action: { type: 'modifyHeaders', requestHeaders: [{ header: 'origin', operation: 'remove' }] },
      condition: {
        requestDomains: ['api.mainnet-beta.solana.com'],
        // The extension's own origin host: its ID in Chrome, an internal UUID in Firefox.
        initiatorDomains: [location.hostname],
        resourceTypes: ['xmlhttprequest', 'other'],
      },
    }],
  });
}
const rpcRuleReady = installRpcRule().catch((e) => console.warn('RPC rule', e));

const handlers = makeHandlers({
  settings,
  store: {
    get: async (key) => (await ext.storage.local.get(key))[key],
    set: (key, value) => ext.storage.local.set({ [key]: value }),
  },
  // Bubblemaps refuses to be framed inside x.com, so it opens in its own window.
  // Firefox for Android has no windows: open a tab there.
  openWindow: (url) => (ext.windows
    ? ext.windows.create({ url, type: 'popup', width: 1180, height: 860, focused: true })
    : ext.tabs.create({ url })),
  rpcUrl: async (s) => s.rpcUrl || (await relayUrl()),
  ready: rpcRuleReady,
  inlineImages: true,
});

// ---------- Frontrun (frontrun.pro Trading API): buy from the user's own Frontrun wallet ----------
// The user pastes their own API key in the toolbar popup. It is kept in local storage (never synced), sent only to
// solana.frontrun.pro, and never returned to any page. Connecting needs the optional solana.frontrun.pro permission,
// which the popup asks for on the user's click. Buys come from the panel and always follow a confirm click there.
const FR_KEY = 'frontrunKey';
// The popup page is not web-accessible, so only the extension itself can open it (as a popup, or a tab on Android).
const fromPopup = (sender) => sender?.id === ext.runtime.id && String(sender?.url || '').startsWith(ext.runtime.getURL('src/popup/'));
const fromX = (sender) => /^https:\/\/(x|twitter|pro\.x)\.com\//.test(String(sender?.tab?.url || sender?.url || ''));
const frKey = async () => (await ext.storage.local.get(FR_KEY))[FR_KEY] || null;
const frAllowed = () => ext.permissions.contains({ origins: [FRONTRUN_ORIGIN] }).catch(() => false);
let frWallets = { at: 0, list: null };

handlers['frontrun:status'] = async () => {
  const key = await frKey();
  if (!key) return { connected: false };
  if (!(await frAllowed())) return { connected: false, error: 'Allow Radar to reach Frontrun from the toolbar popup' };
  try {
    if (!frWallets.list || Date.now() - frWallets.at > 20_000) frWallets = { at: Date.now(), list: await listWallets(key) };
    return { connected: true, wallets: frWallets.list };
  } catch (e) {
    return { connected: e.code !== 401 && e.code !== 403, error: e.message, wallets: frWallets.list || [] };
  }
};
handlers['frontrun:connect'] = async ({ key }, sender) => {
  if (!fromPopup(sender)) throw new Error('Connect Frontrun from the Radar toolbar popup');
  const k = String(key || '').trim();
  if (!KEY_RE.test(k)) throw new Error('A Frontrun API key starts with fr_sk_ and has 70 characters');
  if (!(await frAllowed())) throw new Error('Radar needs permission to reach solana.frontrun.pro');
  const wallets = await listWallets(k); // proves the key works before it is kept
  await ext.storage.local.set({ [FR_KEY]: k });
  frWallets = { at: Date.now(), list: wallets };
  return { connected: true, wallets };
};
handlers['frontrun:disconnect'] = async (_msg, sender) => {
  if (!fromPopup(sender)) throw new Error('Disconnect Frontrun from the Radar toolbar popup');
  await ext.storage.local.remove(FR_KEY);
  frWallets = { at: 0, list: null };
  await ext.permissions.remove({ origins: [FRONTRUN_ORIGIN] }).catch(() => {});
  return { connected: false };
};
handlers['frontrun:buy'] = async ({ mint, sol, slippageBps, wallet }, sender) => {
  if (!fromPopup(sender) && !fromX(sender)) throw new Error('Buys only come from the Radar panel');
  const key = await frKey();
  if (!key || !(await frAllowed())) throw new Error('Connect Frontrun in the Radar toolbar popup first');
  const r = await buy(key, { mint, sol, slippageBps, wallet });
  frWallets.at = 0; // balances changed
  return r;
};

ext.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const fn = handlers[msg?.type];
  if (!fn) return false;
  Promise.resolve(fn(msg, sender))
    .then((data) => sendResponse({ ok: true, data }))
    .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
  return true;
});

ext.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.rpcUrl) handlers.resetBundles();
});

relayUrl(); // warm the relay check once
