// Radar on the web (tryradar.fun/scan): the toolbar popup's panel on a page, for anyone without the extension.
// The radar backend runs in the page with the site's own fetch: DexScreener, RugCheck, our server and X's video
// CDN all allow tryradar.fun. Solana goes through our relay, since the public RPC refuses requests from websites.
// Built into web/scan.js by scripts/build-webapp.mjs.
import { makeHandlers, API_BASE, DEFAULTS } from '../extension/src/lib/handlers.js';
import { isPostLink, mountInline, useBackend } from '../extension/src/ui/radar.js';
import css from '../extension/src/ui/radar.css';

const PUBLIC_NODE = 'https://solana-rpc.publicnode.com';

const store = {
  async get(key) {
    try {
      const raw = localStorage.getItem(`nr:${key}`);
      return raw == null ? null : JSON.parse(raw);
    } catch { return null; }
  },
  async set(key, value) {
    try { localStorage.setItem(`nr:${key}`, JSON.stringify(value)); } catch {}
  },
};

// The relay when the server has one; PublicNode otherwise (it allows websites but keeps only ~2 days of blocks).
let rpcPick = null;
const pickRpc = () => (rpcPick ||= fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(4000) })
  .then((r) => r.json()).then((h) => (h.rpc ? `${API_BASE}/rpc` : PUBLIC_NODE)).catch(() => PUBLIC_NODE));

// Instant Reroute picks its coin after the click, and browsers block tabs opened that late. So a tab opens on
// the click itself and is pointed at the coin once it's picked (or closed if nothing passes).
let pending = null;
document.addEventListener('click', (e) => {
  if (!e.target.closest?.('[data-reroute]')) return;
  pending?.close();
  pending = window.open('', '_blank');
  if (!pending) return;
  pending.opener = null;
  pending.document.title = 'Radar';
  pending.document.body.style.cssText = 'margin:0;height:100vh;display:grid;place-items:center;background:#07050f;color:#a89fc2;font:15px system-ui,sans-serif';
  pending.document.body.textContent = 'Radar is checking the coins…';
}, true);

const openWindow = (url) => {
  if (pending && !pending.closed) pending.location.href = url;
  else window.open(url, '_blank', 'noopener');
  pending = null;
};

const handlers = makeHandlers({
  settings: async () => ({ ...DEFAULTS, ...((await store.get('settings')) || {}) }),
  store,
  openWindow,
  rpcUrl: async (s) => s.rpcUrl || pickRpc(),
  ready: Promise.resolve(),
  inlineImages: false,
  prunedNote: 'Radar is reading a Solana node that keeps only recent blocks right now, so older launches can’t be checked.',
});

const reroute = handlers.reroute;
handlers.reroute = async (msg) => {
  try { return await reroute(msg); } catch (e) { pending?.close(); pending = null; throw e; }
};

// A post read from a pasted link becomes the page's address, so the scan can be shared.
const tweet = handlers.tweet;
handlers.tweet = async (msg) => {
  const r = await tweet(msg);
  history.replaceState(null, '', `/scan?url=${encodeURIComponent(msg.url.trim())}`);
  showShare();
  return r;
};

// The buttons under the panel, once there's a scan to pass on.
function showShare() {
  const box = document.getElementById('scan-share');
  if (!box) return;
  box.querySelector('[data-share-post]').href = `https://x.com/intent/post?text=${encodeURIComponent("Radar's read on this post:")}&url=${encodeURIComponent(location.href)}`;
  box.hidden = false;
}
document.querySelector('[data-share-copy]')?.addEventListener('click', async (e) => {
  const button = e.currentTarget;
  const label = button.dataset.label ||= button.textContent;
  try {
    await navigator.clipboard.writeText(location.href);
    button.textContent = 'Copied';
  } catch {
    button.textContent = 'Could not copy';
  }
  setTimeout(() => { button.textContent = label; }, 1800);
});

useBackend(handlers, { cssText: css });

const url = new URLSearchParams(location.search).get('url');
mountInline(document.getElementById('radar'), 'dark', { hint: 'Paste a link to a post on X above. Or search a narrative, a ticker or a CA.' })
  .then((radar) => radar.open(url && isPostLink(url) ? { text: url } : {}));
