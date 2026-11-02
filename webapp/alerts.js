// Big account alerts on the web (tryradar.fun/alerts): any device, no extension. Holders see flagged posts live with the top 3 coins
// Radar finds on each, scanned in this browser. Everyone else sees the same posts 10 minutes late. Built into web/alerts.js.
import { makeHandlers, API_BASE, DEFAULTS } from '../extension/src/lib/handlers.js';
import { signalCoins } from '../extension/src/lib/alerts.js';

const KEY = 'nr:radarHolder'; // the same check the scan panel uses, and holder.js writes
const POLL_MS = 30_000;
const SCAN_NEWEST = 5;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isPost = (u) => /^https:\/\/x\.com\/\w+\/status\/\d+$/.test(String(u || ''));

const store = {
  async get(key) { try { const raw = localStorage.getItem(`nr:${key}`); return raw == null ? null : JSON.parse(raw); } catch { return null; } },
  async set(key, value) { try { localStorage.setItem(`nr:${key}`, JSON.stringify(value)); } catch {} },
};
const handlers = makeHandlers({ settings: async () => DEFAULTS, store, openWindow() {}, rpcUrl: async () => `${API_BASE}/rpc`, ready: Promise.resolve(), inlineImages: false });

const tokenOf = () => {
  try {
    const h = JSON.parse(localStorage.getItem(KEY) || 'null');
    return h?.token && h.exp > Date.now() ? h.token : null;
  } catch { return null; }
};
const dropToken = () => { try { localStorage.removeItem(KEY); } catch {} };

const ago = (at) => {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
};
const usd = (n) => (!(n > 0) ? '' : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${Math.round(n)}`);
const KIND = { reply: 'replied', quote: 'quoted', post: 'posted' };

let live = false;
let items = [];
let seen = null; // the ids already shown, so only new ones notify
let unread = 0;
const coins = new Map(); // id -> the top 3, or 'scanning' / 'none'

const coinsHtml = (it) => {
  if (!live) return '<a class="al-lock" href="/holder?next=alerts" data-unlock>Holders get these live, with the top 3 coins. <b>Check your wallet</b></a>';
  const c = coins.get(it.id);
  if (c === 'scanning' || (c === undefined && items.indexOf(it) < SCAN_NEWEST)) return '<p class="al-note">Finding the top coins…</p>';
  if (c === undefined) return '';
  if (c === 'none' || !c.length) return '<p class="al-note">No coins found on this yet. Scan it again in a minute.</p>';
  return `<div class="al-coins">${c.map((k) => `<button type="button" class="al-coin" data-ca="${esc(k.address)}" title="Copy ${esc(k.address)}">
      ${k.label ? `<i>${esc(k.label)}</i>` : ''}<b>$${esc(k.symbol)}</b><span>${esc(k.address.slice(0, 6))}…${esc(k.address.slice(-4))}</span>${usd(k.marketCap) ? `<u>${usd(k.marketCap)}</u>` : ''}<em>Copy</em></button>`).join('')}</div>
    <p class="al-note">Found by name and not checked yet. Scan it for the checks.</p>`;
};

const render = () => {
  const list = $('al-list');
  $('al-empty').hidden = items.length > 0;
  $('al-status').textContent = live ? 'Live. You hold enough to get these as they land.' : 'You\'re seeing these 10 minutes late.';
  $('al-status').classList.toggle('on', live);
  $('al-unlock').hidden = live;
  $('al-notify').hidden = !live || !('Notification' in window) || Notification.permission === 'denied';
  $('al-notify').textContent = 'Notification' in window && Notification.permission === 'granted' ? 'Alerts on while this page is open' : 'Alert me while this page is open';
  $('al-notify').disabled = 'Notification' in window && Notification.permission === 'granted';
  list.innerHTML = items.map((it) => `<article class="al-card">
    <div class="al-top"><span class="al-who">@${esc(it.author)} ${KIND[it.kind] || 'posted'}</span><time>${ago(it.at)}</time></div>
    ${it.name ? `<h2>${esc(it.name)}</h2>` : ''}
    <p class="al-why">${esc(it.why)}</p>
    ${it.text ? `<blockquote>${esc(it.text)}</blockquote>` : ''}
    ${it.parent ? `<blockquote class="al-parent">${esc(it.parent)}</blockquote>` : ''}
    ${coinsHtml(it)}
    ${isPost(it.url) ? `<div class="al-acts"><a class="btn btn-solid" href="/scan?url=${encodeURIComponent(it.url)}">Scan it</a><a class="btn btn-ghost" href="${esc(it.url)}" target="_blank" rel="noopener">Open the post</a></div>` : ''}
  </article>`).join('');
};

// One at a time, newest first: a scan is about 15 lookups, and they're for the coins people are about to look at.
let scanning = false;
async function scanNext() {
  if (!live || scanning) return;
  const it = items.slice(0, SCAN_NEWEST).find((x) => !coins.has(x.id) && x.post);
  if (!it) return;
  scanning = true;
  coins.set(it.id, 'scanning');
  try {
    const found = await Promise.race([handlers.coins({ post: it.post }), new Promise((r) => setTimeout(r, 20_000, null))]);
    const top = signalCoins(found);
    coins.set(it.id, top.length ? top : 'none');
  } catch {
    coins.set(it.id, 'none');
  }
  scanning = false;
  render();
  scanNext();
}

async function load() {
  const token = tokenOf();
  let res = await fetch(`${API_BASE}/signals`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(token ? { token, history: true } : { public: true }), signal: AbortSignal.timeout(10_000) });
  // The server says the check has run out or isn't real: back to the public list.
  if (res.status === 401 && token) {
    dropToken();
    res = await fetch(`${API_BASE}/signals`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ public: true }), signal: AbortSignal.timeout(10_000) });
  }
  if (!res.ok) throw new Error(`signals ${res.status}`);
  const d = await res.json();
  live = !!d.live;
  items = (d.items || []).filter((x) => x?.id);
  $('al-error').hidden = true;
  const fresh = seen ? items.filter((x) => !seen.has(x.id)) : [];
  seen = new Set([...(seen || []), ...items.map((x) => x.id)]);
  if (fresh.length && document.hidden) {
    unread += fresh.length;
    document.title = `(${unread}) Big account alerts · Radar`;
    if (live && 'Notification' in window && Notification.permission === 'granted') {
      for (const it of fresh.slice(0, 3)) {
        const n = new Notification(`@${it.author}${it.name ? `: ${it.name}` : ' posted something'}`, { body: it.why, icon: '/icons/icon128.png', tag: `signal:${it.id}` });
        n.onclick = () => { window.focus(); n.close(); };
      }
    }
  }
  render();
  scanNext();
}
const tick = () => load().catch(() => { $('al-error').hidden = false; });

document.addEventListener('click', async (e) => {
  const b = e.target.closest?.('[data-ca]');
  if (!b) return;
  try {
    await navigator.clipboard.writeText(b.dataset.ca);
    const em = b.querySelector('em');
    if (em) { em.textContent = 'Copied'; setTimeout(() => { em.textContent = 'Copy'; }, 1500); }
  } catch {}
});
$('al-notify').addEventListener('click', async () => {
  if ('Notification' in window) await Notification.requestPermission().catch(() => {});
  render();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  unread = 0;
  document.title = 'Big account alerts · Radar';
  tick();
});

tick();
setInterval(tick, POLL_MS);
setInterval(() => { if (items.length) render(); }, 60_000);
