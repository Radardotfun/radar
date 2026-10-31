import { TERMINAL_ICONS } from './terminal-icons.js';
import { coinCheck } from './coincheck.js';
import { marketBlock, reportBlock } from './holdercheck.js';
import { recentItem } from './recent.js';
import { MAX_STARS, starOf, toggleStar, sinceStar } from './watchlist.js';

import { lcButtonHtml, lcStoryHtml, lcCheckItHtml, lcStamp } from './larpcheck.js';

// Radar panel — shared by the X overlay (floating) and the toolbar popup (inline).

// The extension talks to its service worker; the userscript plugs its in-page backend in with
// useBackend() and hands over the stylesheet as text (css: a URL, cssText: the CSS itself).
let backend = null;
let cssUrl = null;
let cssInline = null;
export function useBackend(handlers, { css, cssText } = {}) {
  backend = handlers;
  cssUrl = css;
  cssInline = cssText;
}

const send = (type, payload = {}) => (backend
  ? Promise.resolve().then(() => {
    const fn = backend[type];
    if (!fn) throw new Error(`Unknown request ${type}`);
    return fn({ type, ...payload });
  })
  : new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage({ type, ...payload }, (res) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!res) return reject(new Error('No response'));
        res.ok ? resolve(res.data) : reject(new Error(res.error));
      });
    } catch (e) {
      reject(new Error('Extension was reloaded — refresh this tab'));
    }
  }));

// A pasted link to a post on X (nothing else typed) is opened and read as that post.
const X_POST = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/\w+\/status\/\d+\S*$/i;
export const isPostLink = (s) => X_POST.test(String(s || '').trim());
const CA = /^(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/;
export const scansOnPaste = (s) => isPostLink(s) || CA.test(String(s || '').trim());

/* ---------------- formatting ---------------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function usd(n, { compact = true } = {}) {
  if (n == null || !Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (!compact || a < 1000) return `$${a < 10 ? n.toFixed(2) : Math.round(n).toLocaleString('en-US')}`;
  const [d, s] = a >= 1e9 ? [1e9, 'B'] : a >= 1e6 ? [1e6, 'M'] : [1e3, 'K'];
  const v = n / d;
  return `$${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)}${s}`;
}
// GMGN-style subscript zeros: $0.0₅1234
export function price(p) {
  if (!p) return '—';
  if (p >= 1) return `$${p.toLocaleString('en-US', { maximumFractionDigits: p >= 1000 ? 0 : 4 })}`;
  const str = p.toFixed(20);
  const m = str.match(/^0\.(0*)(\d{1,4})/);
  if (!m) return `$${p}`;
  const zeros = m[1].length;
  return zeros >= 4 ? `$0.0<sub>${zeros}</sub>${m[2]}` : `$${p.toPrecision(4)}`;
}
const pct = (n, digits = 1) => (n == null || !Number.isFinite(+n) ? '—' : `${+n > 0 ? '+' : ''}${(+n).toFixed(Math.abs(n) >= 1000 ? 0 : digits)}%`);
const soldPct = (bought, held) => (bought > 0 ? Math.max(0, Math.min(100, (1 - held / bought) * 100)) : 0);
const pctPlain = (n, d = 1) => (n == null || !Number.isFinite(+n) ? '—' : `${(+n).toFixed(d)}%`);
const num = (n) => (n == null ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}K` : Math.round(n).toLocaleString('en-US'));
// GeckoTerminal's embed of a coin's chart, with no trades list or info column. DexScreener's own embed sits behind a
// Cloudflare check that a frame can't pass (31 Oct 2026). It charts a pool, so a coin needs a known pair.
const GECKO_NETWORK = { solana: 'solana', robinhood: 'robinhood', base: 'base', bsc: 'bsc', ethereum: 'eth' };
export function chartEmbed(t, theme = 'dark') {
  const network = GECKO_NETWORK[t?.chain];
  if (!network || !/^[A-Za-z0-9]{20,70}$/.test(t?.pair || '')) return null;
  return `https://www.geckoterminal.com/${network}/pools/${t.pair}?embed=1&info=0&swaps=0&light_chart=${theme === 'light' ? 1 : 0}`;
}
// On X a page frame is refused, so the chart goes through an extension page (ui/chart.html). Without one, as in the
// userscript on X, there's no chart to show here, only the link.
export function chartFrameSrc(embed, { onX = /(^|\.)(x|twitter)\.com$/.test(location.hostname), getURL = globalThis.chrome?.runtime?.getURL } = {}) {
  if (!embed) return null;
  if (!onX) return embed;
  return getURL ? `${getURL('src/ui/chart.html')}?u=${encodeURIComponent(embed)}` : null;
}

const launchUrl = (post) => `https://tryradar.fun/launch?post=${encodeURIComponent(post)}`;
// A coin launched on tryradar.fun/launch carries this as its website, and says so on its card.
export const launchedWithRadar = (t) => (t.websites || []).some((w) => /^https:\/\/tryradar\.fun\/launched/.test(w?.url || w));

// X's post ids carry their time.
export function postTimeOf(postUrl) {
  const id = String(postUrl || '').match(/\/status\/(\d+)/)?.[1];
  return id ? Number((BigInt(id) >> 22n) + 1288834974657n) : null;
}

// When a coin launched against the post it's on.
export function launchedVsPost(createdAt, postUrl) {
  const posted = postTimeOf(postUrl);
  if (!posted || !createdAt) return null;
  const gap = createdAt - posted;
  return `${age(Date.now() - Math.abs(gap))} ${gap < 0 ? 'before' : 'after'} the post`;
}

export function age(ms) {
  if (!ms) return '—';
  const m = (Date.now() - ms) / 60000;
  if (m < 60) return `${Math.max(1, Math.round(m))}m`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)}h`;
  const d = h / 24;
  if (d < 60) return `${Math.round(d)}d`;
  const mo = d / 30.44;
  if (mo < 24) return `${Math.round(mo)}mo`;
  return `${(d / 365.25).toFixed(1)}y`;
}
const short = (a) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : '');
const hue = (s) => [...(s || 'x')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

/* ---------------- icons ---------------- */
const I = {
  crown: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M3 7l4.5 4L12 4l4.5 7L21 7l-2 12H5L3 7z"/></svg>',
  og: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 3h12M6 21h12M7 3c0 5 10 6 10 9s-10 4-10 9M17 3c0 5-10 6-10 9"/></svg>',
  gear: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/></svg>',
  bolt: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/></svg>',
  star: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M12 3l2.7 5.8 6.3.8-4.6 4.3 1.2 6.2L12 17.1 6.4 20.1l1.2-6.2L3 9.6l6.3-.8z"/></svg>',
  bell: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 1112 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 003.4 0"/></svg>',
  pin: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 21s-7-6.2-7-11a7 7 0 1114 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  copy: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15V5a2 2 0 012-2h10"/></svg>',
  check: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>',
  x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  xs: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  spark: '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9L12 2zm7 13l.9 2.6 2.6.9-2.6.9L19 22l-.9-2.6-2.6-.9 2.6-.9L19 15z"/></svg>',
  bubble: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="8" cy="9" r="5"/><circle cx="17" cy="15" r="4"/><circle cx="16" cy="5" r="2"/></svg>',
  chevron: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
  share: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v13M7 8l5-5 5 5M5 14v5a2 2 0 002 2h10a2 2 0 002-2v-5"/></svg>',
  refresh: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7"/></svg>',
};
export const MARK = `<svg class="mark" viewBox="0 0 26 26" width="26" height="26" shape-rendering="crispEdges" aria-hidden="true">
  <rect width="26" height="26" rx="7" fill="#5621AC"/><path transform="translate(5 5)" fill="#fff" d="M7 0h5v1h-5zM7 1h5v1h-5zM7 2h5v1h-5zM3 3h10v1h-10zM2 4h12v1h-12zM1 5h4v1h-4zM11 5h4v1h-4zM1 6h3v1h-3zM5 6h1v1h-1zM11 6h4v1h-4zM1 7h2v1h-2zM10 7h2v1h-2zM13 7h2v1h-2zM1 8h2v1h-2zM9 8h2v1h-2zM13 8h2v1h-2zM1 9h2v1h-2zM7 9h3v1h-3zM13 9h2v1h-2zM1 10h2v1h-2zM7 10h2v1h-2zM13 10h2v1h-2zM1 11h2v1h-2zM5 11h1v1h-1zM11 11h1v1h-1zM13 11h2v1h-2zM1 12h3v1h-3zM12 12h3v1h-3zM2 13h12v1h-12zM3 14h10v1h-10z"/></svg>`;
const BIG_RADAR = `<svg class="radar" viewBox="0 0 84 84" fill="none">
  <circle cx="42" cy="42" r="40" stroke="var(--line-2)"/><circle cx="42" cy="42" r="27" stroke="var(--line-2)"/><circle cx="42" cy="42" r="14" stroke="var(--line-2)"/>
  <g style="transform-origin:42px 42px;animation:sweep 2.6s linear infinite"><path d="M42 42L42 2A40 40 0 0 1 76.6 22Z" fill="url(#g)"/></g>
  <defs><linearGradient id="g" x1="42" y1="2" x2="70" y2="30"><stop stop-color="var(--accent)" stop-opacity="0"/><stop offset="1" stop-color="var(--accent)" stop-opacity=".45"/></linearGradient></defs>
  <circle cx="58" cy="28" r="3" fill="var(--accent)"/><circle cx="30" cy="54" r="2.2" fill="var(--muted)"/></svg>`;

const ROLE = {
  top: { label: 'TOP MARKET CAP', icon: I.crown },
  og: { label: 'THE OG', icon: I.og },
  mover: { label: 'THE MOVER', icon: I.bolt },
  tech: { label: 'TECH MATCH', icon: I.spark },
  ca: { label: 'MENTIONED CA', icon: I.pin },
  bio: { label: "POSTER'S BIO", icon: I.pin },
  more: { label: 'MATCH', icon: I.pin },
};

/* ---------------- links ---------------- */
const CHAIN_LABEL = { solana: 'SOL', robinhood: 'Robinhood' };
// Chains Bubblemaps maps (its own names for them); a coin on any other chain gets no Bubblemaps button.
const BUBBLE_CHAIN = { solana: 'solana', base: 'base', bsc: 'bsc', ethereum: 'eth' };
// Kept short: the chart and GMGN (Bubblemaps sits next to them). RugCheck's score is already in the audit.
function links(t) {
  const a = t.address;
  if (t.chain === 'solana') return [['Chart', t.url || `https://dexscreener.com/solana/${a}`], ['GMGN', `https://gmgn.ai/sol/token/${a}`]];
  const g = { base: 'base', bsc: 'bsc', ethereum: 'eth' }[t.chain];
  const scan = { base: 'https://basescan.org/token/', bsc: 'https://bscscan.com/token/', ethereum: 'https://etherscan.io/token/', robinhood: 'https://robinhoodchain.blockscout.com/token/' }[t.chain];
  return [['Chart', t.url], g ? ['GMGN', `https://gmgn.ai/${g}/token/${a}`] : ['Explorer', scan ? scan + a : t.url]];
}

// The terminal behind each card's one Trade button: the last one picked from its menu, Axiom at first.
const TERM_KEY = 'nr:terminal';
const prefTerm = () => { try { return localStorage.getItem(TERM_KEY) || 'axiom'; } catch { return 'axiom'; } };
const setPrefTerm = (id) => { try { localStorage.setItem(TERM_KEY, id); } catch {} };

// Trading terminals open on the user's own logged-in session; the CA is copied too,
// so it can be pasted if a terminal lands somewhere other than the token page.
// Radar Quick Buy (tryradar.fun/trade): only the contract goes in the link; the page looks the coin up itself.
const quickBuyUrl = (t) => `https://tryradar.fun/trade?mint=${encodeURIComponent(t.address)}`;
// Insta Buy: the same page as a small window over X, with the card's amount picked (the last one chosen, 0.1 at first).
const INSTA_SOL = ['0.05', '0.1', '0.25', '0.5', '1'];
const INSTA_KEY = 'nr:insta-sol';
const instaSol = () => { try { const v = localStorage.getItem(INSTA_KEY); return INSTA_SOL.includes(v) ? v : '0.1'; } catch { return '0.1'; } };
const setInstaSol = (v) => { try { localStorage.setItem(INSTA_KEY, v); } catch {} };
const instaUrl = (addr, sol) => `https://tryradar.fun/trade?mint=${encodeURIComponent(addr)}&sol=${sol}&insta=1`;
// Robinhood Chain's own buy page (tryradar.fun/trade-robinhood), which checks the real cost of the buy first, in ETH.
const INSTA_ETH = ['0.005', '0.01', '0.025', '0.05', '0.1'];
const INSTA_ETH_KEY = 'nr:insta-eth';
const instaEth = () => { try { const v = localStorage.getItem(INSTA_ETH_KEY); return INSTA_ETH.includes(v) ? v : '0.01'; } catch { return '0.01'; } };
const setInstaEth = (v) => { try { localStorage.setItem(INSTA_ETH_KEY, v); } catch {} };
const isHood = (t) => t?.chain === 'robinhood';
const hoodBuyUrl = (addr, eth) => `https://tryradar.fun/trade-robinhood?token=${encodeURIComponent(addr)}${eth ? `&eth=${eth}&insta=1` : ''}`;
// Markets PumpPortal builds buys on (same list as QUICK_MARKETS in web/quickbuy-guard.js). Coins only on Orca or
// Meteora get no Insta Buy; a coin whose market isn't known yet keeps it, and the buy page explains if it can't.
const QUICK_MARKETS = new Set(['pumpfun', 'pumpswap', 'raydium']);
const quickBuyable = (t) => t.chain === 'solana' && (!t.dexId || QUICK_MARKETS.has(t.dexId));

function terminals(t) {
  const a = t.address;
  // Robinhood Chain's memecoins trade on Uniswap (its URL name for the chain is "robinhood").
  if (t.chain === 'robinhood') return [{ id: 'uniswap', name: 'Uniswap', url: `https://app.uniswap.org/swap?chain=robinhood&outputCurrency=${a}` }];
  if (t.chain !== 'solana') return [];
  return [
    { id: 'axiom', name: 'Axiom', url: `https://axiom.trade/meme/${t.pair || a}?chain=sol` },
    { id: 'padre', name: 'Padre', url: `https://trade.padre.gg/trade/solana/${a}` },
    { id: 'fomo', name: 'Fomo', url: `https://fomo.family/tokens/solana/${a}` },
    { id: 'larpcheck', name: 'LarpCheck', url: `https://larpcheck.app/${a}` },
  ];
}

// Sample frames across a video into one grid image: vision models read one picture far
// more reliably than many. Runs in the page, so X's own CDN serves the file (CORS-enabled).
async function frameGrid(src, { cols = 3, rows = 2, cellW = 320, timeoutMs = 6000 } = {}) {
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.preload = 'auto';
  video.src = src;
  const once = (ev) => new Promise((resolve, reject) => {
    const ok = () => { cleanup(); resolve(); };
    const bad = () => { cleanup(); reject(new Error('video failed to load')); };
    const cleanup = () => { video.removeEventListener(ev, ok); video.removeEventListener('error', bad); };
    video.addEventListener(ev, ok, { once: true });
    video.addEventListener('error', bad, { once: true });
  });
  const work = (async () => {
    await once('loadedmetadata');
    const n = cols * rows;
    const ratio = video.videoHeight / video.videoWidth || 9 / 16;
    const cellH = Math.round(cellW * ratio);
    const canvas = document.createElement('canvas');
    canvas.width = cellW * cols;
    canvas.height = cellH * rows;
    const ctx = canvas.getContext('2d');
    const dur = Number.isFinite(video.duration) ? video.duration : 0;
    for (let i = 0; i < n; i++) {
      video.currentTime = dur ? Math.min(dur - 0.05, dur * ((i + 0.5) / n)) : 0;
      await once('seeked');
      ctx.drawImage(video, (i % cols) * cellW, Math.floor(i / cols) * cellH, cellW, cellH);
    }
    return canvas.toDataURL('image/jpeg', 0.72);
  })();
  try {
    return await Promise.race([work, new Promise((_, rej) => setTimeout(() => rej(new Error('video timed out')), timeoutMs))]);
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}

// Settings (Frontrun) live in the toolbar popup, the only place that can ask for the optional permission.
const canSettings = () => !!(globalThis.browser ?? globalThis.chrome)?.permissions?.request;

/* ---------------- panel ---------------- */
class Radar {
  constructor(root, { inline = false, onClose, hint } = {}) {
    this.root = root;
    this.inline = inline;
    this.hint = hint;
    this.onClose = onClose;
    this.state = { picks: [], others: [], mentioned: [], source: null, loading: false, error: null, narrative: null, ts: 0 };
    this.prepared = new Map(); // post url -> Promise<post with video frames/MP4>
    this.tokens = new Map(); // address -> token (live)
    this.audits = new Map(); // address -> { rug, bundle, rugErr, bundleErr }
    this.larp = new Map(); // address -> { lc: Larpcheck verdict, at }
    this.expanded = new Set();
    this.openCards = new Set(); // cards the user maximised
    this.refreshSec = 10;
    this.timers = [];
    this.scanId = 0;
    this.view = 'scan'; // or 'settings' (toolbar popup only), or 'stars' (the watchlist)
    this.stars = [];
    send('starList').then((list) => { this.stars = list || []; this.renderHead(); if (this.view === 'scan' && this.state.ts) this.syncStarButtons(); }).catch(() => {});
    this.frontrun = null; // { connected, wallets, error } from the background
    this.frSel = new Map(); // address -> { sol, bps, wallet } for the buy sheet
    this.frBusy = new Set();
    this.frMsg = new Map(); // address -> result line (HTML built from validated values)
    this.alerts = null; // { watches, feed, unread, notifications } from the background; null where alerts don't exist
    this.watchBusy = false;
    this.holder = null; // { on, min, holder } from the backend
    this.who = new Map(); // X handle -> what Frontrun knows
    this.whoBusy = new Set();
    this.render();
    this.loadFrontrun();
    this.loadAlerts();
    this.loadHolder();
    this.listenForBuys();
    send('settings').then((s) => { this.refreshSec = s.refreshSec || 10; }).catch(() => {});
    document.addEventListener('visibilitychange', () => this.updateLive());
  }

  /* ----- public ----- */
  open({ post = null, text = '', source = null, trends = null } = {}) {
    if (trends) this.trends = trends;
    this.shell.classList.add('open');
    const p = post || (text ? { text } : null);
    if (p) this.scan({ post: p, source });
    else if (!this.state.ts) this.renderBody();
    if (!p) setTimeout(() => this.input?.focus(), 250);
    if (!p && this.inline) { this.loadRecent(); this.loadBoard(); }
  }

  // Hovering the radar button starts the work early; the click then picks up the same result.
  prefetch(post) {
    if (!post) return;
    this.preparePost(post).then((p) => send('coins', { post: p })).catch(() => {});
  }
  close() {
    this.shell.classList.remove('open');
    this.stopTimers();
    this.onClose?.();
  }
  get isOpen() { return this.shell.classList.contains('open'); }

  /* ----- scanning ----- */
  // Larpcheck's lists, on the panel before a scan.
  loadBoard(sort = this.boardSort || 'asks') {
    this.boardSort = sort;
    send('lcBoard', { sort }).then((d) => {
      if (this.boardSort !== sort) return;
      this.board = d?.rows || [];
      if (!this.state.ts && !this.state.loading && this.view !== 'settings') this.renderBody();
    }).catch(() => {});
  }
  boardHtml() {
    const rows = this.board || [];
    const tabs = [['asks', 'Most asked'], ['real', 'Most real'], ['larp', 'Most larp']];
    if (!rows.length && !this.boardSort) return '';
    return `<div class="lc-board"><div class="recent-top"><span>Larpcheck today</span><a href="https://larpcheck.app/" target="_blank" rel="noopener noreferrer">larpcheck.app ↗</a></div>
      <div class="lc-tabs" role="tablist">${tabs.map(([id, label]) => `<button type="button" role="tab" aria-selected="${this.boardSort === id}" data-board="${id}">${label}</button>`).join('')}</div>
      ${rows.length ? rows.map((r) => `<div class="lc-row"><button type="button" data-board-coin="${esc(r.coin)}" data-board-title="${esc(r.title || '')}"><b>${esc(r.title || `${r.coin.slice(0, 4)}…${r.coin.slice(-4)}`)}</b></button><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer" title="Open this check on Larpcheck">${lcStamp(r)}</a></div>`).join('') : '<p class="lc-none">Nothing on this list yet today.</p>'}
    </div>`;
  }

  loadRecent() {
    send('recentList').then((list) => {
      this.recent = list;
      if (!this.state.ts && !this.state.loading && this.view !== 'settings') this.renderBody();
    }).catch(() => {});
  }

  async scan({ post, source = null }) {
    send('launchState').then((s) => { this.launchOn = s?.state === 'on'; }).catch(() => {});
    const id = ++this.scanId;
    const stale = () => id !== this.scanId;
    const asked = post?.url || post?.text;
    if (this.view === 'stars') this.view = 'scan';
    this.stopTimers();
    this.lastPost = post;
    this.state = { ...this.state, loading: true, early: [], error: null, narrative: null, engineError: null, source: source ?? this.state.source };
    this.updateLive();
    this.renderFoot();
    this.renderHead();
    this.renderBody();
    try {
      if (post && Object.keys(post).length === 1 && isPostLink(post.text)) {
        this.state = { ...this.state, source: { kind: 'Post', label: 'Opening the post…' } };
        this.renderHead();
        const full = await send('tweet', { url: post.text.trim() });
        if (stale()) return;
        post = full.post;
        this.lastPost = post;
        this.state = { ...this.state, source: full.source };
        this.renderHead();
      }
      // A coin written in the post needs no reading: it shows while the engine works.
      send('postCoins', { post }).then((early) => {
        if (stale() || !this.state.loading || !early?.length) return;
        this.state = { ...this.state, early };
        for (const t of early) this.tokens.set(t.address, t);
        this.renderBody();
        this.hydrateImages();
        for (const t of early) { this.loadAudit(t); this.loadLarp(t); }
      }).catch(() => {});
      const p = await this.preparePost(post, id);
      if (stale()) return;
      // Stage 1: show the narrative as soon as it's read.
      const read = await send('read', { post: p });
      if (stale()) return;
      this.state = { ...this.state, narrative: read.narrative };
      this.renderHead();
      // Stage 2: the coins.
      const res = await send('coins', { post: p });
      if (stale()) return;
      this.bodyEl.dataset.timing = JSON.stringify(res.timing || {});
      this.showCoins(res);
      this.loadStory(p, read.narrative, res, id);
      send('recentAdd', { item: recentItem({ asked, source, narrative: read.narrative, res }) }).catch(() => {});
      if (read.speechPending) this.readSpeech(p, res, id);
    } catch (e) {
      if (stale()) return;
      this.state = { ...this.state, loading: false, error: e.message };
      this.updateLive();
      this.renderFoot();
      this.renderHead();
      this.renderBody();
    }
  }

  showCoins(res) {
    this.state = { ...this.state, ...res, loading: false };
    this.tokens.clear();
    for (const t of [...res.mentioned, ...(res.bioCoins || []), ...(res.techMatch ? [res.techMatch] : []), ...(res.roleCandidates || []), ...res.picks.map((x) => x.token), ...res.others]) this.tokens.set(t.address, t);
    this.renderHead();
    this.renderBody();
    this.renderFoot();
    this.loadAudits();
    this.startTimers();
  }

  // A video's speech comes in after the first answer. When it changes which coins the post is about, the cards follow.
  async readSpeech({ quickRead, ...post }, shown, id) {
    const read = await send('read', { post }).catch(() => null);
    if (id !== this.scanId || !read?.post?.transcript) return;
    const res = await send('coins', { post }).catch(() => null);
    if (id !== this.scanId || !res) return;
    const coinsOf = (r) => [...r.mentioned, ...(r.picks || []).map((p) => p.token)].map((t) => t.address).join();
    this.state = { ...this.state, narrative: read.narrative };
    this.renderHead();
    if (coinsOf(res) === coinsOf(shown)) return;
    this.showCoins(res);
    this.loadStory(post, read.narrative, res, id);
  }

  // Video posts: pull the MP4, grid its frames for the vision model, keep the MP4 for transcription.
  preparePost(post, id = null) {
    if (!post?.hasVideo || !post.url) return Promise.resolve(post);
    if (!this.prepared.has(post.url)) {
      this.prepared.set(post.url, (async () => {
        // A post read from a pasted link already carries its MP4.
        const info = post.videoUrl ? { mp4: post.videoUrl, gif: post.gif } : await send('videoInfo', { url: post.url }).catch(() => null);
        if (!info?.mp4) return post;
        const grid = await frameGrid(info.mp4).catch(() => null);
        return { ...post, videoUrl: info.mp4, gif: info.gif, quickRead: true, images: [grid, ...(post.images || [])].filter(Boolean).slice(0, 3) };
      })());
    }
    if (id === this.scanId) {
      this.watching = true;
      this.renderHead();
      this.prepared.get(post.url).finally(() => { this.watching = false; });
    }
    return this.prepared.get(post.url);
  }

  rescan() {
    if (this.lastPost) this.scan({ post: this.lastPost });
  }

  cardTokens() {
    const tokens = [...this.state.mentioned, ...this.bioCards(), ...(this.state.techMatch ? [this.state.techMatch] : []), ...this.state.picks.map((p) => p.token), ...this.state.others.filter((t) => this.expanded.has(t.address))];
    return [...new Map(tokens.map((t) => [t.address, t])).values()]
      .map((t) => this.tokens.get(t.address) || t);
  }

  loadAudits() {
    for (const t of this.cardTokens()) {
      this.loadAudit(t);
      this.loadLarp(t);
    }
  }

  // Larpcheck's verdict on a coin, kept 10 minutes. null when it can't be read or no key is set.
  async larpFor(t) {
    const hit = this.larp.get(t.address);
    if (hit && Date.now() - hit.at < 600_000) return hit.lc;
    const lc = await send('larpcheck', { address: t.address }).catch(() => null);
    if (!lc || lc.off) return null;
    this.larp.set(t.address, { lc, at: Date.now() });
    return lc;
  }

  async loadLarp(t) {
    if (await this.larpFor(t)) this.renderLarp(t.address);
  }

  renderActions(addr) {
    const el = this.bodyEl.querySelector(`[data-actions="${addr}"]`);
    const t = this.tokens.get(addr);
    if (el && t) el.innerHTML = this.actionsHtml(t);
  }

  renderLarp(addr) {
    const lc = this.larp.get(addr)?.lc;
    const card = this.bodyEl.querySelector(`.card[data-addr="${addr}"]`);
    if (!lc || !card) return;
    const slot = card.querySelector('[data-lc]');
    if (slot) slot.innerHTML = lcButtonHtml(lc);
  }

  // Radar's holder check is Solana only. Elsewhere the card uses Larpcheck's holder panel, credited and linked.
  async loadLcHolders(t) {
    const v = await send('lcHolders', { address: t.address, chain: t.chain }).catch(() => null);
    if (!v?.ready) return;
    (this.lcHolderData ||= new Map()).set(t.address, v);
    this.renderLcHolders(t.address);
  }
  renderLcHolders(addr) {
    const v = this.lcHolderData?.get(addr);
    const card = v && this.bodyEl.querySelector(`[data-addr="${addr}"]`);
    if (!card) return;
    const h = card.querySelector('[data-k="holders"]');
    if (h && v.holders != null) h.textContent = num(v.holders);
    const el = card.querySelector(`[data-lch="${addr}"]`);
    if (!el || !v.line) return;
    el.hidden = false;
    el.className = `hc ${v.ok ? 'ok' : 'no'}`;
    el.innerHTML = `<span class="hc-mark">${v.ok ? '✓' : '✕'}</span><span>${esc(v.line)}</span><a class="hc-by" href="${esc(v.page)}" target="_blank" rel="noopener noreferrer">Larpcheck ↗</a>`;
  }

  async loadAudit(t, { force = false } = {}) {
    if (t.chain !== 'solana') return this.loadLcHolders(t);
    const a = this.audits.get(t.address) || {};
    if (a.loading && !force) return;
    a.loading = true;
    this.audits.set(t.address, a);
    const rug = send('safety', { mint: t.address, pairs: t.pairAddresses })
      .then((r) => { a.rug = r; a.rugErr = null; })
      .catch((e) => { a.rugErr = e.message; })
      .finally(() => this.renderAudit(t.address));
    const bundle = send('bundle', { mint: t.address, launchMs: t.createdAt, pairs: t.pairAddresses, launchPair: t.launchPair, launchDex: t.launchDex })
      .then((b) => { a.bundle = b; a.bundleErr = null; })
      .catch((e) => { a.bundleErr = e.message; })
      .finally(() => this.renderAudit(t.address));
    await Promise.allSettled([rug, bundle]);
    a.loading = false;
  }

  /* ----- live updates ----- */
  startTimers() {
    this.stopTimers();
    this.timers.push(setInterval(() => this.tick(), this.refreshSec * 1000));
    this.timers.push(setInterval(() => { if (!document.hidden) this.cardTokens().forEach((t) => this.loadAudit(t)); }, 60_000));
    this.updateLive();
  }
  stopTimers() { this.timers.forEach(clearInterval); this.timers = []; this.updateLive(); }
  updateLive() {
    const live = this.root.querySelector('.live');
    if (!live) return;
    const on = this.timers.length && !document.hidden;
    live.classList.toggle('paused', !on);
    live.querySelector('span').textContent = on ? `LIVE · ${this.refreshSec}s` : this.state.loading ? 'SCANNING' : this.state.ts ? 'PAUSED' : 'READY';
  }
  async tick() {
    if (document.hidden || (!this.inline && !this.isOpen)) return;
    const list = [...this.tokens.values()].map((t) => ({ chain: t.chain, address: t.address }));
    if (!list.length) return;
    try {
      const deep = this.cardTokens().map((t) => t.address);
      const fresh = await send('refresh', {
        tokens: list,
        deep,
        roleCandidates: this.state.roleCandidates || [],
        roleCut: this.state.roleCut ?? 0,
      });
      for (const [addr, t] of Object.entries(fresh.tokens || {})) {
        const prev = this.tokens.get(addr);
        if (!prev) continue;
        const next = { ...prev, ...t, relevance: prev.relevance, matched: prev.matched };
        this.tokens.set(addr, next);
        this.patchCard(prev, next);
      }
      const ranked = fresh.ranking;
      // Never move a card while the pointer is on the panel: a role swap under the cursor could send a
      // click to a different coin. The next tick re-ranks once the pointer has left.
      if (ranked?.picks?.length && !this.bodyEl.matches(':hover')) {
        const signature = (items) => items.map((p) =>
          [p.role, p.token.address, Number(p.alsoTop), Number(p.alsoOg), Number(p.alsoMover)].join(':')
        ).join('|');
        const rolesChanged = signature(this.state.picks) !== signature(ranked.picks);
        this.state.picks = ranked.picks;
        this.state.others = ranked.others;
        this.state.roleCandidates = ranked.roleCandidates;
        this.state.roleCut = ranked.roleCut;
        if (rolesChanged) {
          const scrollTop = this.bodyEl.scrollTop;
          this.renderBody();
          this.bodyEl.scrollTop = scrollTop;
          this.loadAudits();
        }
      }
      this.state.ts = Date.now();
      this.renderFoot();
    } catch { /* transient — next tick retries */ }
  }

  /* ----- rendering ----- */
  render() {
    this.root.innerHTML = `
      <div class="shell">
        <div class="head"></div>
        <div class="body"></div>
        <div class="foot"></div>
        <div class="toast"></div>
      </div>`;
    this.shell = this.root.querySelector('.shell');
    this.headEl = this.root.querySelector('.head');
    this.bodyEl = this.root.querySelector('.body');
    this.footEl = this.root.querySelector('.foot');
    this.toastEl = this.root.querySelector('.toast');
    this.renderHead();
    this.renderBody();
    this.renderFoot();
    this.bodyEl.addEventListener('click', (e) => this.onBodyClick(e));
    this.bodyEl.addEventListener('input', (e) => {
      const a = e.target.closest('[data-fr-amt]');
      if (!a) return;
      this.frSelFor(a.dataset.frAmt).sol = a.value.trim();
      this.updateFrGo(a.dataset.frAmt);
    });
    this.bodyEl.addEventListener('change', (e) => {
      const sl = e.target.closest('[data-fr-slip]');
      if (sl) this.frSelFor(sl.dataset.frSlip).bps = Number(sl.value);
      const w = e.target.closest('[data-fr-wallet]');
      if (w) this.frSelFor(w.dataset.frWallet).wallet = w.value;
    });
    this.headEl.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.act === 'close') this.close();
      else if (b.dataset.act === 'rescan') this.rescan();
      else if (b.dataset.act === 'share') this.share();
      else if (b.dataset.act === 'settings') { this.view = this.view === 'settings' ? 'scan' : 'settings'; this.renderBody(); }
      else if (b.dataset.act === 'stars') this.toggleStarsView();
      else if (b.dataset.act === 'watch') this.watch();
      else if (b.dataset.lcCheck) this.runLcCheck(b.dataset.lcCheck);
      else if (b.dataset.act === 'unwatch') this.unwatch(b.dataset.id);
      else if ('story' in b.dataset) {
        this.expanded.has('story') ? this.expanded.delete('story') : this.expanded.add('story');
        this.renderHead();
      }
    });
    this.headEl.addEventListener('submit', (e) => {
      const form = e.target.closest('[data-lc-ask]');
      if (!form) return;
      e.preventDefault();
      const q = form.querySelector('input').value.trim();
      if (q) this.runLcAsk(form.dataset.lcAsk, q);
    });
    this.root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !this.inline) this.close(); });
  }

  renderHead() {
    const { source } = this.state;
    const postUrl = this.lastPost?.url;
    // A redraw (the holder check answering, say) must not wipe what's being typed or pasted.
    const typed = this.input?.value;
    const typing = this.input && this.input.getRootNode().activeElement === this.input;
    this.headEl.innerHTML = `
      <div class="brand">
        ${MARK}
        <div class="title">Radar</div>
        <div class="live paused"><i></i><span>READY</span></div>
        <button class="icon-btn star-head${this.stars?.length ? ' has' : ''}${this.view === 'stars' ? ' on' : ''}" data-act="stars" title="Watchlist">${I.star}</button>
        ${this.inline && canSettings() ? `<button class="icon-btn" data-act="settings" title="Settings">${I.gear}</button>` : ''}
        ${this.state.ts && this.state.picks?.length ? `<button class="icon-btn" data-act="share" title="Copy a summary to share">${I.share}</button>` : ''}
        ${this.state.ts ? `<button class="icon-btn" data-act="rescan" title="Rescan">${I.refresh}</button>` : ''}
        ${this.inline ? '' : `<button class="icon-btn" data-act="close" title="Close (Esc)">${I.x}</button>`}
      </div>
      ${this.inline ? `<form class="search">
        ${I.search}
        <input type="text" placeholder="Search a narrative, paste a post or a CA" spellcheck="false" autocomplete="off" />
        <span class="kbd">↵</span>
      </form>` : ''}
      ${source ? `<div class="source"><b>${esc(source.kind)}</b><span>${esc(source.label)}</span>${isPostLink(postUrl) && postTimeOf(postUrl) ? `<a href="${esc(postUrl)}" target="_blank" rel="noopener noreferrer" title="Open the post">${age(postTimeOf(postUrl))} ago ↗</a>` : ''}</div>` : ''}
      ${this.watchHtml()}
      ${this.narrativeHtml()}`;
    // Search lives in the toolbar popup; on X the panel only shows what was scanned.
    this.input = this.headEl.querySelector('input');
    if (this.input && typed) this.input.value = typed;
    if (typing) this.input?.focus();
    this.headEl.querySelector('form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = this.input.value.trim();
      if (!v) return;
      this.input.value = '';
      this.input.blur();
      // Anything typed goes to the narrative engine: a topic, a headline, a pasted post or a CA.
      this.scan({ post: { text: v }, source: isPostLink(v) ? null : { kind: 'Search', label: v.slice(0, 80) } });
    });
    // A pasted post link or CA scans right away, so there's no Enter to press. Other words wait for Enter.
    this.input?.addEventListener('paste', (e) => {
      if (this.input.value.trim() || !scansOnPaste(e.clipboardData?.getData('text'))) return;
      setTimeout(() => this.headEl.querySelector('form')?.requestSubmit());
    });
    this.updateLive();
  }

  // Larp check under the narrative (is the post's story real?): one word + score, a trader's one-liner, findings on tap.
  // When Larpcheck has a verdict on the coin, the larp check is theirs, credited and linked to their report.
  // ---------- Who posted this (holders of $RADAR, data from Frontrun; server/holder.js) ----------
  loadHolder() {
    send('lcSettings').then((s) => { this.lcPlan = !!s?.plan; this.renderHead(); }).catch(() => {});
    return send('holderStatus').then((h) => { this.holder = h; this.renderHead(); }).catch(() => { this.holder = { on: false }; });
  }

  whoHtml() {
    const handle = this.lastPost?.author;
    if (!this.holder?.on || !handle) return '';
    const head = '<div class="story-top who-top"><span class="story-k">Who posted this</span></div>';
    if (!this.holder.holder) {
      return `<div class="story who">${head}
        <div class="story-call">${esc(this.holder.pitch || '')}</div>
        <button type="button" class="who-connect" data-holder-connect>Check my wallet</button></div>`;
    }
    const w = this.who.get(handle);
    if (!w) { this.loadWho(handle); return `<div class="story who loading">${head}<div class="story-call"><span class="spinner"></span>Looking up @${esc(handle)}…</div></div>`; }
    if (w.error) return `<div class="story who">${head}<div class="story-call">${esc(w.error)}</div></div>`;
    if (w.off) return '';
    const lines = [];
    const own = w.own?.coins;
    const total = own ? own.live + own.deleted : 0;
    if (own) lines.push(total ? `Radar has seen <b>${total}</b> coin${total === 1 ? '' : 's'} from this account${own.deletedPosts ? `, and <b class="who-gone">${own.deletedPosts}</b> of its coin post${own.deletedPosts === 1 ? ' is' : 's are'} gone` : ''}` : "Radar hasn't seen this account post a coin yet.");
    if (w.lc?.checked) lines.push(`Larpcheck has checked <b>${w.lc.checked}</b> post${w.lc.checked === 1 ? '' : 's'} from this account${w.lc.risky ? `, and <b class="who-gone">${w.lc.risky}</b> came back as likely larp, larp or scam` : ''}`);
    const lcRows = (w.lc?.rows || []).map((r) => `<a class="who-row" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer"><b>${esc(r.verdict)}${r.total == null ? '' : ` ${r.total}`}</b><span>${esc(r.title || 'Post')}</span><span>Larpcheck ↗</span><span></span></a>`).join('');
    const rows = (w.own?.recent || []).map((r) => `<a class="who-row" href="https://x.com/${esc(handle)}/status/${esc(r.id)}" target="_blank" rel="noopener noreferrer">
        <b>${r.symbol ? `$${esc(r.symbol)}` : esc(`${r.ca.slice(0, 4)}…${r.ca.slice(-4)}`)}</b><span>${r.mc ? usd(r.mc) : 'no market'}</span><span>${age(r.at)} ago</span><span class="who-gone">${r.gone ? 'post gone' : ''}</span></a>`).join('');
    if (w.smartCount != null) lines.push(`<b>${w.smartCount}</b> smart follower${w.smartCount === 1 ? '' : 's'}${w.smartFinal ? '' : ' so far'}${w.smart?.length ? `: ${w.smart.map((s) => `@${esc(s)}`).join(', ')}` : ''}`);
    if (w.coins) lines.push(`Frontrun: posted <b>${w.coins.live + w.coins.deleted}</b> coin${w.coins.live + w.coins.deleted === 1 ? '' : 's'}${w.coins.deleted ? `, <b>${w.coins.deleted}</b> in deleted posts` : ''}`);
    return `<div class="story who">${head}
      ${w.label ? `<div class="who-label">${esc(w.label)}</div>` : ''}
      ${lines.map((l) => `<div class="story-call">${l}</div>`).join('')}
      ${rows ? `<div class="who-rows">${rows}</div>` : ''}
      ${lcRows ? `<div class="who-rows">${lcRows}</div>` : ''}
      <div class="story-note">Radar's own record, from posts scanned since 30 Oct 2026, so it won't show everything${w.smartCount != null || w.coins ? '. Smart followers from Frontrun' : ''}.</div></div>`;
  }

  async loadWho(handle) {
    this.who.set(handle, { loading: true });
    this.who.delete(handle);
    if (this.whoBusy.has(handle)) return;
    this.whoBusy.add(handle);
    try {
      const w = await send('holderWho', { handle });
      if (w.locked) await this.loadHolder();
      else this.who.set(handle, w);
    } catch (err) {
      this.who.set(handle, { error: err.message });
    }
    this.whoBusy.delete(handle);
    this.renderHead();
  }

  // The wallet check runs on tryradar.fun, where the wallet lives, and reports back here (see listenForBuys).
  holderConnect() {
    const w = 440;
    const left = Math.max(0, (window.screenX || 0) + (window.outerWidth || w) - w - 32);
    const win = window.open('https://tryradar.fun/holder', 'radar-holder', `popup=yes,width=${w},height=640,left=${left},top=${Math.max(0, (window.screenY || 0) + 72)}`);
    if (!win) this.toast('Pop-ups are blocked here. Allow them to check your wallet', 3200);
  }

  storyHtml() {
    const s = this.state.story;
    if (!s || s.error) return '';
    if (s.loading) return `<div class="story loading"><div class="story-top"><span class="story-k">Larp check</span></div><div class="story-call"><span class="spinner"></span>Checking the author, links and coin…</div></div>`;
    const open = this.expanded.has('story');
    if (s.larpcheck) return lcStoryHtml(s.larpcheck, { open, symbol: s.coin, chevron: I.chevron, ask: open ? this.lcAskHtml(s.larpcheck) : '' });
    const tone = ['LIKELY LARP', 'LARP'].includes(s.word) ? 'risk' : ['REAL', 'LIKELY REAL'].includes(s.word) ? 'ok' : 'mid';
    return `<div class="story ${tone}">
      <button class="story-top" data-story aria-expanded="${open}">
        <span class="story-k">Larp check</span><span class="verdict ${tone}">${esc(s.word)} <b>${s.score}</b></span>${I.chevron}
      </button>
      <div class="story-call">${esc(s.call)}</div>
      ${open ? `<ul class="findings">${(s.findings || []).map((f) => `<li class="${esc(f.kind)}"><span>${esc(f.kind)}</span>${esc(f.text)}</li>`).join('')}</ul>
        <div class="story-note">Checks evidence, not people. ${s.coin ? `Read with $${esc(s.coin)}.` : 'No coin was checked.'}</div>` : ''}
      ${this.lcRunHtml(s)}
      ${lcCheckItHtml(s.lcPage, s.coin)}
    </div>`;
  }

  // Paid Larpcheck features, for $RADAR holders, only when the server's key has a plan (/lc/settings).
  get lcPerks() { return !!(this.lcPlan && this.holder?.holder); }
  lcRunHtml(s) {
    if (!s.lcPage || !s.lcAddress) return '';
    const run = this.lcRun?.address === s.lcAddress ? this.lcRun : null;
    if (run?.error) return `<div class="story-note">${esc(run.error)}</div>`;
    if (run) return `<div class="story-call"><span class="spinner"></span>Larpcheck is checking it${run.step ? `: ${esc(run.step)}` : '…'}</div>`;
    return this.lcPerks ? `<button type="button" class="who-connect" data-lc-check="${esc(s.lcAddress)}">Check ${s.coin ? `$${esc(s.coin)}` : 'it'} on Larpcheck now</button>` : '';
  }
  lcAskHtml(lc) {
    if (!this.lcPerks || !lc.id) return '';
    const a = this.lcAnswer?.id === lc.id ? this.lcAnswer : null;
    return `<form class="lc-ask" data-lc-ask="${esc(lc.id)}"><input type="text" maxlength="499" placeholder="Ask Larpcheck about this coin" autocomplete="off" spellcheck="false" /><button type="submit"${a?.busy ? ' disabled' : ''}>${a?.busy ? '…' : 'Ask'}</button></form>
      ${a?.error ? `<div class="story-note">${esc(a.error)}</div>` : ''}
      ${a?.answer ? `<div class="lc-answer"><p>${esc(a.answer)}</p><span>Answer by <b>Larpcheck</b></span></div>` : ''}`;
  }
  async runLcCheck(address) {
    this.lcRun = { address };
    this.renderHead();
    const scanAtStart = this.scanId;
    try {
      const { id } = await send('lcStart', { input: address });
      for (let i = 0; i < 60; i++) {
        const c = await send('lcPoll', { id });
        if (c.error) throw new Error(c.error);
        if (c.lc) {
          this.larp.set(address, { lc: c.lc, at: Date.now() });
          this.lcRun = null;
          if (scanAtStart === this.scanId && this.state.story?.lcAddress === address) this.state = { ...this.state, story: { larpcheck: c.lc, coin: this.state.story.coin } };
          this.renderHead();
          return;
        }
        this.lcRun = { address, step: c.step };
        this.renderHead();
        await new Promise((r) => setTimeout(r, 5000));
      }
      throw new Error('Larpcheck is still working on this. Look again in a few minutes.');
    } catch (e) {
      this.lcRun = { address, error: e.message };
      this.renderHead();
    }
  }
  async runLcAsk(id, question) {
    this.lcAnswer = { id, busy: true };
    this.renderHead();
    try {
      const { answer } = await send('lcAsk', { id, question });
      this.lcAnswer = { id, answer };
    } catch (e) {
      this.lcAnswer = { id, error: e.message };
    }
    this.renderHead();
  }

  async loadStory(post, narrative, res, id) {
    if (this.state.source?.kind === 'Search' || (!post?.text && !post?.images?.length)) return;
    const t = res.mentioned[0] || res.bioCoins?.[0] || res.picks[0]?.token || null;
    // No coin on the post's story: nothing to check, and no AI spent on it.
    if (!t) return;
    const coin = t ? { name: t.name, symbol: t.symbol, address: t.address, createdAt: t.createdAt, socials: t.socials, websites: t.websites, fromPost: !!t.fromPost, mentioned: res.mentioned.includes(t) } : null;
    this.state = { ...this.state, story: { loading: true } };
    this.renderHead();
    // Larpcheck first: when they've checked the coin, their verdict is the larp check and ours isn't run.
    const lc = t ? await this.larpFor(t) : null;
    if (id !== this.scanId) return;
    if (lc?.checked) {
      this.state = { ...this.state, story: { larpcheck: lc, coin: t.symbol } };
      this.renderHead();
      return;
    }
    try {
      const s = await send('story', { post, narrative, coin });
      if (id !== this.scanId) return;
      this.state = { ...this.state, story: { ...s, coin: t?.symbol || null, lcPage: lc?.page || null, lcAddress: t?.address || null } };
    } catch (e) {
      if (id !== this.scanId) return;
      this.state = { ...this.state, story: { error: e.message } };
    }
    this.renderHead();
  }

  narrativeHtml() {
    const { loading, narrative, engineError } = this.state;
    if (!loading && engineError) return `<div class="narrative"><span>Coin from the post only</span><em>${esc(engineError)}</em></div>`;
    if (narrative) return `<div class="narrative"><span>${esc(narrative)}</span>${loading ? '<em>finding coins…</em>' : ''}</div>${this.storyHtml()}${this.whoHtml()}`;
    if (!loading || !this.lastPost) return '';
    const doing = this.watching ? 'Watching the video…' : this.lastPost.hasVideo ? 'Listening to the video…' : this.lastPost.images?.length ? 'Looking at the image…' : 'Reading the post…';
    return `<div class="narrative thinking"><span>${doing}</span></div>`;
  }

  // The way to launch a coin from the post being read, while the server has launching on.
  launchHtml() {
    return this.launchOn && isPostLink(this.lastPost?.url) ? '<button type="button" class="launch-btn" data-launch>Launch a coin from this post</button>' : '';
  }

  renderBody() {
    if (this.view === 'settings') { this.bodyEl.innerHTML = this.settingsHtml(); return; }
    if (this.view === 'stars') { this.bodyEl.innerHTML = this.starsHtml(); this.hydrateImages(); return; }
    const { loading, error, picks, others, mentioned, techMatch, ts } = this.state;
    if (loading) {
      const early = this.state.early || [];
      this.bodyEl.innerHTML = (early.length ? `<div class="section-label"><span>In the post</span></div>${early.map((t) => this.cardHtml(this.tokens.get(t.address) || t, { role: 'ca' })).join('')}` : '')
        + [0, 1, 2].slice(early.length ? 1 : 0).map(() => `
        <div class="loading-card"><div class="skel" style="width:30%"></div><div class="skel" style="width:55%"></div><div class="skel" style="height:34px"></div></div>`).join('');
      return;
    }
    if (error) {
      this.bodyEl.innerHTML = `<div class="empty"><div class="big">Couldn't finish the scan</div><p class="error">${esc(error)}</p><button class="retry" data-retry>Try again</button></div>`;
      return;
    }
    if (!ts) {
      const trends = (this.trends || []).slice(0, 6);
      const recent = this.inline ? this.recent || [] : [];
      this.bodyEl.innerHTML = `<div class="empty"><div class="big">Scan any post on X</div>
        <p>${esc(this.hint || (this.inline ? 'Search a narrative, a ticker or a CA above.' : 'Tap the radar under any post or trend.'))}</p>
        ${recent.length ? `<div class="recent-list"><div class="recent-top"><span>Recent</span><button data-recent-clear>Clear</button></div>${recent.map((r, i) => `<button class="recent-row" data-recent="${i}"><b>$${esc(r.c)}</b><span>${esc(r.l)}</span><em>${age(r.t)}</em></button>`).join('')}</div>` : ''}
        ${this.inline ? this.boardHtml() : ''}
        ${trends.length ? `<div class="trend-list"><span>Trending</span>${trends.map((t) => `<button data-trend="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}</div>
        ${this.inline && (this.alerts?.watches.length || this.alerts?.feed.length) ? this.alertsHtml() : ''}`;
      return;
    }
    const bio = this.bioCards();
    if (!picks.length && !mentioned.length && !bio.length && !techMatch && this.state.mode === 'ai' && this.state.coinable === false) {
      this.bodyEl.innerHTML = `<div class="empty"><div class="big">No coin narrative here</div>
        <p>This post doesn't carry anything people trade. Try a news post, a trend, or a meme.</p>${this.launchHtml()}</div>`;
      return;
    }
    if (!picks.length && !mentioned.length && !bio.length && !techMatch) {
      this.bodyEl.innerHTML = `<div class="empty"><div class="big">No live coins for this narrative</div>
        <p>Nothing trading on-chain is about this yet.</p>${this.watchHtml({ cta: true })}${this.launchHtml()}</div>`;
      return;
    }
    let html = '';
    html += `<div class="reroute-bar"><span>Instant reroute</span><button type="button" data-reroute>Open best match</button></div>`;
    if (mentioned.length) html += `<div class="section-label"><span>In the post</span></div>` + mentioned.map((t) => this.cardHtml(t, { role: 'ca' })).join('');
    if (bio.length) html += `<div class="section-label"><span>In the poster's bio</span></div>` + bio.map((t) => this.cardHtml(t, { role: 'bio' })).join('');
    const techIsAlreadyShown = techMatch && (mentioned.some((t) => t.address === techMatch.address) || picks.some((p) => p.token.address === techMatch.address));
    if (techMatch && !techIsAlreadyShown) {
      const t = this.tokens.get(techMatch.address) || techMatch;
      html += '<div class="section-label"><span>Tech match</span><span>' + esc(techMatch.techAnchor || '') + '</span></div>' + this.cardHtml(t, { role: 'tech' });
    }
    if (picks.length) {
      const SHORT = { top: 'TOP MC', og: 'OG', mover: 'MOVER' };
      html += `<div class="section-label"><span>Narrative picks</span><span>${picks.length} of 3</span></div>
        <div class="overview">${picks.map((p) => {
          const t = this.tokens.get(p.token.address) || p.token;
          const ch = t.priceChange?.h1 ?? t.priceChange?.h24;
          return `<button class="tile ${p.role}" data-jump="${t.address}">
            <span class="tile-role">${ROLE[p.role].icon}${SHORT[p.role]}</span>
            <span class="tile-sym">$${esc(t.symbol)}${t.mcapBacked ? '' : ' <i title="Market cap not backed by real liquidity">· thin</i>'}</span>
            <b data-tile-mc="${t.address}">${usd(t.marketCap)}</b>
            <span class="tile-chg ${ch == null ? '' : ch >= 0 ? 'up' : 'down'}" data-tile-chg="${t.address}">${pct(ch)}</span>
            ${t.chain === 'solana' ? `<span class="tile-b" data-tile-b="${t.address}">bundled …</span>` : ''}</button>`;
        }).join('')}</div>`
        + picks.map((p) => this.cardHtml(this.tokens.get(p.token.address) || p.token, p)).join('');
    }
    if (others.length) {
      // The five closest matches; the rest on request.
      const shown = this.expanded.has('all-matches') ? others : others.slice(0, 5);
      html += `<div class="section-label"><span>More matches</span><span>${others.length}</span></div><div class="list">`;
      for (const o of shown) {
        const t = this.tokens.get(o.address) || o;
        if (this.expanded.has(t.address)) { html += `</div>${this.cardHtml(t, { role: 'more' })}<div class="list">`; continue; }
        const ch = +t.priceChange.h1 || +t.priceChange.h24 || 0;
        html += `<button class="li" data-expand="${t.address}">${this.avatarHtml(t)}
          <div class="nm"><b>${esc(t.name)}</b><span>$${esc(t.symbol)} · ${age(t.createdAt)}</span></div>
          <div class="r" data-k="li-mc">${t.mcapBacked ? usd(t.marketCap) : '<span title="Market cap not backed by real liquidity">thin</span>'}<span class="${ch >= 0 ? 'up' : 'down'}">${pct(ch)}</span></div></button>`;
      }
      html += '</div>';
      html = html.replace(/<div class="list"><\/div>/g, '');
      if (shown.length < others.length) html += `<button class="show-more" data-more-matches>Show ${others.length - shown.length} more</button>`;
    }
    html += this.launchHtml();
    this.bodyEl.innerHTML = html;
    this.hydrateImages();
    for (const t of this.cardTokens()) {
      this.renderAudit(t.address);
      this.renderLarp(t.address);
    }
  }

  // The poster's bio coin gets its own card, unless a scan's own pick already shows it. A search has no poster.
  bioCards() {
    const { mode, bioCoins, picks } = this.state;
    return mode === 'ai' ? (bioCoins || []).filter((t) => !(picks || []).some((p) => p.token.address === t.address)) : [];
  }

  // ---------- Watchlist ----------
  isStarred(addr) { return !!this.stars?.some((s) => s.address === addr); }

  syncStarButtons() {
    this.bodyEl.querySelectorAll('[data-star]').forEach((b) => {
      const on = this.isStarred(b.dataset.star);
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  toggleStar(addr) {
    const t = this.tokens.get(addr);
    if (!t) return;
    const was = this.isStarred(addr);
    if (!was && this.stars.length >= MAX_STARS) { this.toast(`Your watchlist is full (${MAX_STARS})`); return; }
    const star = starOf(t);
    this.stars = toggleStar(this.stars, star);
    this.syncStarButtons();
    this.renderHead();
    this.toast(was ? 'Off your watchlist' : 'On your watchlist');
    send('starToggle', { star }).then((list) => { this.stars = list || []; }).catch(() => {});
  }

  removeStar(addr) {
    const star = this.stars.find((s) => s.address === addr);
    if (!star) return;
    this.stars = toggleStar(this.stars, star);
    this.renderHead();
    this.renderBody();
    send('starToggle', { star }).then((list) => { this.stars = list || []; }).catch(() => {});
  }

  toggleStarsView() {
    this.view = this.view === 'stars' ? 'scan' : 'stars';
    this.renderHead();
    this.renderBody();
    this.refreshStars();
  }

  // Live numbers while the list is open, and each coin's Larpcheck verdict, a few at a time (they count against Radar's API key).
  async refreshStars() {
    clearTimeout(this.starTimer);
    if (this.view !== 'stars' || !this.stars.length) return;
    if (!document.hidden) {
      const res = await send('refresh', { tokens: this.stars.map((s) => ({ chain: s.chain, address: s.address })) }).catch(() => null);
      if (this.view !== 'stars') return;
      if (res?.tokens) this.starLive = res.tokens;
      this.renderBody();
      this.starLc ||= new Map();
      const list = [...this.stars];
      for (let i = 0; i < list.length; i += 4) {
        await Promise.all(list.slice(i, i + 4).map((s) => send('larpcheck', { address: s.address }).then((lc) => this.starLc.set(s.address, lc)).catch(() => {})));
        if (this.view !== 'stars') return;
        this.renderBody();
      }
    }
    this.starTimer = setTimeout(() => this.refreshStars(), 30_000);
  }

  starsHtml() {
    const top = `<div class="recent-top"><span>Watchlist${this.stars.length ? ` · ${this.stars.length}` : ''}</span><button data-act-back>Back</button></div>`;
    if (!this.stars.length) return `<div class="star-list">${top}<div class="empty"><div class="big">Nothing starred yet</div><p>Tap the star on a coin card to keep it here, with its change since you starred it.</p></div></div>`;
    return `<div class="star-list">${top}${this.stars.map((s) => {
      const live = this.starLive?.[s.address];
      const cap = live?.marketCap ?? s.cap;
      const since = live ? sinceStar(s, live.marketCap) : null;
      const lc = this.starLc?.get(s.address);
      return `<div class="star-row">
        <button class="star-open" data-star-open="${esc(s.address)}" data-star-sym="${esc(s.symbol)}" title="Scan $${esc(s.symbol)}">
          ${this.avatarHtml({ address: s.address, symbol: s.symbol, image: live?.image || s.image })}
          <span class="star-names"><b>$${esc(s.symbol)}</b><span>${esc(s.name)}</span></span>
          <span class="star-nums"><b>${usd(cap)}${live && !live.mcapBacked && !live.onCurve ? ' <i title="Market cap not backed by real liquidity">· thin</i>' : ''}</b><em class="${since == null ? '' : since >= 0 ? 'up' : 'down'}">${since == null ? '—' : `${pct(since, Math.abs(since) >= 100 ? 0 : 1)} since star`}</em></span>
        </button>
        <button class="star-remove" data-star-remove="${esc(s.address)}" title="Take off the watchlist">${I.xs}</button>
        ${lc?.checked ? `<div class="star-lc">${lcButtonHtml(lc)}</div>` : ''}
      </div>`;
    }).join('')}</div>`;
  }

  avatarHtml(t) {
    const h = hue(t.address);
    return `<div class="ava" style="--h1:hsl(${h} 70% 45%);--h2:hsl(${(h + 50) % 360} 70% 30%)" data-img="${esc(t.image || '')}">${esc((t.symbol || '?').replace(/^\$/, '').slice(0, 2).toUpperCase())}</div>`;
  }

  hydrateImages() {
    this.bodyEl.querySelectorAll('.ava[data-img]').forEach((el) => {
      // DexScreener serves logos at 800px, 166 KB for a 40px circle. Its CDN also has 128px, about 7 KB.
      const url = el.dataset.img.replace(/^(https:\/\/cdn\.dexscreener\.com\/cms\/images\/[^?]+\?)width=800&height=800/, '$1width=128&height=128');
      if (!url) return;
      el.removeAttribute('data-img');
      send('image', { url }).then((src) => { el.innerHTML = `<img alt="" src="${src}">`; }).catch(() => {});
    });
  }

  changeCells(t) {
    return ['m5', 'h1', 'h6', 'h24'].map((k) => {
      const v = t.priceChange?.[k];
      const cls = v == null ? '' : v >= 0 ? 'up' : 'down';
      const hot = k === 'h1' && v >= 25 ? ' hot' : '';
      return `<div class="chg ${cls}${hot}" data-k="chg-${k}"><span>${k.replace('m5', '5m').replace('h1', '1h').replace('h6', '6h').replace('h24', '24h')}</span><b>${pct(v)}</b></div>`;
    }).join('');
  }

  // A card's actions: one Trade button (▾ for the other terminals) and Larpcheck's verdict as a yellow button.
  chartHtml(t) {
    if (!this.expanded.has(`ch:${t.address}`)) return '';
    const embed = chartEmbed(t, this.root.dataset.theme);
    const src = chartFrameSrc(embed);
    const full = esc(t.url || `https://dexscreener.com/${t.chain}/${t.address}`);
    return `${src ? `<iframe class="chart-frame" title="Chart of $${esc(t.symbol)}" src="${esc(src)}" referrerpolicy="no-referrer"></iframe>` : ''}
      <a class="chart-full" href="${full}" target="_blank" rel="noopener noreferrer">${src ? 'Open on DexScreener ↗' : 'Open the chart on DexScreener ↗'}</a>`;
  }

  actionsHtml(t) {
    const terms = terminals(t);
    const pick = terms.find((x) => x.id === prefTerm()) || terms[0];
    const menu = pick && this.expanded.has(`tm:${t.address}`);
    const trade = pick ? `<div class="trade">
        <a class="term" href="${esc(pick.url)}" target="_blank" rel="noopener noreferrer" data-term="${pick.name}" data-ca="${t.address}" title="Copy CA and open on ${pick.name}">
          <img alt="" src="${TERMINAL_ICONS[pick.id]}"><span>Trade on ${pick.name}</span></a>
        ${terms.length > 1 ? `<button class="term-more" data-term-menu="${t.address}" aria-expanded="${menu}" title="Other terminals">${I.chevron}</button>` : ''}
        ${menu ? `<div class="term-menu">${terms.filter((x) => x !== pick).map((x) => `
          <a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer" data-term="${x.name}" data-term-pick="${x.id}" data-ca="${t.address}">
            <img alt="" src="${TERMINAL_ICONS[x.id]}">${x.name}</a>`).join('')}</div>` : ''}
      </div>` : '';
    const fr = this.frontrun?.connected && t.chain === 'solana';
    const frOpen = fr && this.expanded.has(`fr:${t.address}`);
    const buyBtn = fr ? `<button class="fr-buy${frOpen ? ' on' : ''}" data-fr-buy="${t.address}" aria-expanded="${frOpen}" title="Buy with your Frontrun wallet">${I.bolt}Frontrun</button>` : '';
    const hood = isHood(t);
    const sol = hood ? instaEth() : instaSol();
    const unit = hood ? 'ETH' : 'SOL';
    const instaOpen = this.expanded.has(`ib:${t.address}`);
    const quick = quickBuyable(t) || hood ? `<div class="insta">
        <button type="button" class="radar-buy" data-insta="${t.address}" title="Buy ${sol} ${unit} with your own wallet, in a small window over this page">Insta buy · ${sol} ${unit}</button>
        <button type="button" class="insta-more" data-insta-menu="${t.address}" aria-expanded="${instaOpen}" title="Change the amount">${I.chevron}</button>
        ${instaOpen ? `<div class="insta-menu">${(hood ? INSTA_ETH : INSTA_SOL).map((v) => `<button type="button" data-insta-sol="${v}" data-unit="${unit}" data-addr="${t.address}"${v === sol ? ' class="on"' : ''}>${v}</button>`).join('')}
          <a href="${esc(hood ? hoodBuyUrl(t.address) : quickBuyUrl(t))}" target="_blank" rel="noopener noreferrer">Full buy page: any amount, slippage ↗</a></div>` : ''}
      </div>` : '';
    const chartOn = this.expanded.has(`ch:${t.address}`);
    const chart = chartEmbed(t) ? `<button type="button" class="chart-btn${chartOn ? ' on' : ''}" data-chart="${t.address}" aria-expanded="${chartOn}">${chartOn ? 'Hide chart' : 'Chart'}</button>` : '';
    return `${quick}${buyBtn}${trade}${chart}<span class="lc-slot" data-lc="${t.address}">${lcButtonHtml(this.larp.get(t.address)?.lc)}</span>${frOpen ? this.frSheetHtml(t) : ''}`;
  }

  cardHtml(t, pick) {
    const role = pick.role;
    const r = ROLE[role];
    const buys = t.txns.h1.buys, sells = t.txns.h1.sells;
    const buyShare = buys + sells ? (buys / (buys + sells)) * 100 : 50;
    const tags = [pick.alsoOg && 'also the OG', pick.alsoTop && 'also top MC', pick.alsoMover && 'also the mover'].filter(Boolean);
    if (this.state.techMatch?.address === t.address && role !== 'tech') tags.push('TECH MATCH');
    const vsPost = launchedVsPost(t.createdAt, this.lastPost?.url);
    if (t.fromPost) tags.unshift(vsPost?.includes('after') ? `launched ${vsPost}` : 'launched off this post');
    else if (vsPost) tags.push(vsPost);
    const twins = this.nameTwins(t);
    if (launchedWithRadar(t)) tags.unshift('launched with Radar, not by the poster');
    if (twins) tags.push(twins.oldest ? `oldest of ${twins.n}` : `${twins.n} named $${String(t.symbol).trim()}`);
    const matched = t.reason ? esc(t.reason) : t.matched?.length ? `matches “${esc(t.matched.slice(0, 2).join('”, “'))}”` : '';
    const open = this.openCards.has(t.address);
    const tx24 = t.txns.h24.buys + t.txns.h24.sells;
    return `
      <article class="card ${role}${open ? ' open' : ''}${this.state.techMatch?.address === t.address ? ' tech-match' : ''}" data-addr="${t.address}">
        <header class="card-top">
          <span class="badge">${r.icon}${r.label}</span>
          ${tags.map((x) => `<span class="tag${x.startsWith('launched') ? ' hot' : x.startsWith('looks') ? ' rug' : /^oldest of|named \$/.test(x) ? ' twins' : ''}">${esc(x)}</span>`).join('')}
          ${t.chain === 'solana' ? `<span class="cc" data-cc="${t.address}"></span>` : ''}
          <button class="star-btn${this.isStarred(t.address) ? ' on' : ''}" data-star="${t.address}" aria-pressed="${this.isStarred(t.address)}" title="Watchlist">${I.star}</button>
          <button class="toggle-card" data-toggle="${t.address}" aria-expanded="${open}" title="${open ? 'Show less' : 'Show everything'}">${I.chevron}</button>
        </header>
        <div class="ident">
          ${this.avatarHtml(t)}
          <div class="names">
            <div class="name" title="${esc(t.name)}">${esc(t.name)}</div>
            <div class="sub">
              <span class="sym">$${esc(t.symbol)}</span>
              <button class="ca-btn" data-copy="${t.address}" title="Copy contract address">${short(t.address)} ${I.copy}</button>
              <span class="chain">${esc(CHAIN_LABEL[t.chain] || t.chain)}</span>
            </div>
          </div>
        </div>
        <div class="compact" data-toggle="${t.address}">
          <div><span>Market cap${t.mcapBacked ? '' : ' · thin'}</span><b class="mc" data-k="mc">${usd(t.marketCap)}</b></div>
          <div><span>Age</span><b data-k="age" title="${t.createdAt ? new Date(t.createdAt).toLocaleString() : ''}">${age(t.createdAt)}</b></div>
          <div><span>Vol 24h</span><b data-k="vol">${usd(t.volume.h24)}</b></div>
        </div>
        ${t.chain === 'solana' ? `<div class="hc" data-hc="${t.address}"><span class="hc-mark wait"></span><span>Checking holders…</span></div>` : `<div class="hc" data-lch="${t.address}" hidden></div>`}
        <div class="actions" data-actions="${t.address}">${this.actionsHtml(t)}</div>
        <div class="chart-box" data-chart-box="${t.address}">${this.chartHtml(t)}</div>
        <div class="card-body" aria-hidden="${!open}">
          <div class="card-inner">
            ${matched ? `<div class="reason">${t.reason ? I.spark : ''}<span>${matched}</span></div>` : ''}
            <div class="price-line"><span class="label">Price</span><span class="px" data-k="price">${price(t.priceUsd)}</span></div>
            <div class="changes">${this.changeCells(t)}</div>
            <div class="stats">
              <div class="stat"><span>${t.onCurve ? 'Curve' : 'Liquidity'}</span><b data-k="liq" class="${!t.onCurve && t.liquidity < 5000 ? 'bad' : ''}">${t.onCurve ? 'Bonding' : usd(t.liquidity)}</b></div>
              <div class="stat"><span>Holders</span><b data-k="holders">${t.chain === 'solana' ? '<span class="skel" style="display:block;width:70%;margin-top:4px"></span>' : '—'}</b></div>
              <div class="stat"><span>Txns 24h</span><b data-k="tx24">${num(tx24)}</b></div>
            </div>
            <div class="flow">
              <div class="flow-bar"><i data-k="flow" style="width:${buyShare.toFixed(1)}%"></i></div>
              <div class="flow-legend"><span class="b" data-k="buys">${num(buys)} buys</span><span>1h · ${usd(t.volume.h1)}</span><span class="s" data-k="sells">${num(sells)} sells</span></div>
            </div>
            ${t.chain === 'solana' ? `<div class="supply" data-k="supply">${this.supplyHtml(null)}</div>` : ''}
            ${t.chain === 'solana' ? '<section class="coin-check" data-k="check"></section>' : ''}
            <section class="audit">
              <h4>Launch audit <em data-k="audit-src">${t.chain === 'solana' ? 'on-chain' : ''}</em></h4>
              <div class="rows" data-k="audit"></div>
            </section>
            <div class="links">${links(t).map(([l, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${l}</a>`).join('')}${BUBBLE_CHAIN[t.chain] ? `<button data-bubble="${t.address}" data-chain="${t.chain}">Bubblemaps</button>` : ''}</div>
          </div>
        </div>
      </article>`;
  }

  // How much of the supply went to the launch block, and how much of it is still sitting there.
  supplyHtml(b) {
    if (!b) {
      return `<div class="supply-head"><span>Bundled supply</span><b class="skel" style="width:54px;height:18px"></b></div>
        <div class="supply-bar"></div><div class="supply-legend"><span class="scanning"><span class="spinner"></span>Scanning the launch block…</span></div>`;
    }
    if (!b.ok) {
      return `<div class="supply-head"><span>Bundled supply</span><b class="na">n/a</b></div><div class="supply-legend"><span>${esc(b.reason || 'Unavailable')}</span></div>`;
    }
    const tone = b.bundledPct >= 50 || (b.bundledPct >= 20 && b.bundleHeldPct >= 5) ? 'bad' : b.bundledPct >= 5 ? 'warn' : 'good';
    const w = (x) => Math.max(0, Math.min(100, x)).toFixed(2);
    return `<div class="supply-head"><span>Bundled supply</span><b class="${tone}">${pctPlain(b.bundledPct)}</b></div>
      <div class="supply-bar" title="Share of total supply bought in the launch block">
        <i class="seg bundle" style="width:${w(b.bundledPct)}%"></i><i class="seg dev" style="width:${w(b.devBoughtPct)}%"></i>
        <i class="held" style="width:${w(b.bundleHeldPct + b.devHeldPct)}%"></i>
      </div>
      <div class="supply-legend">
        <span>${b.bundleWallets} wallet${b.bundleWallets === 1 ? '' : 's'} · sold ${pctPlain(soldPct(b.bundledPct, b.bundleHeldPct), 0)}</span>
        <span>DB ${pctPlain(b.devBoughtPct)} · DS ${pctPlain(soldPct(b.devBoughtPct, b.devHeldPct), 0)}</span>
      </div>`;
  }

  renderAudit(addr) {
    this.renderLcHolders(addr);
    const card = this.bodyEl.querySelector(`.card[data-addr="${addr}"]`);
    if (!card) return;
    const t = this.tokens.get(addr);
    const rowsEl = card.querySelector('[data-k="audit"]');
    if (t?.chain !== 'solana') {
      rowsEl.innerHTML = `<div class="row note"><span class="dot"></span><span class="k">Bundle & holder checks</span><span class="v">Solana only for now</span></div>`;
      return;
    }
    const a = this.audits.get(addr) || {};
    const supplyEl = card.querySelector('[data-k="supply"]');
    if (supplyEl && (a.bundle || a.bundleErr)) supplyEl.innerHTML = this.supplyHtml(a.bundle || { ok: false, reason: a.bundleErr });
    const tileB = this.bodyEl.querySelector(`[data-tile-b="${addr}"]`);
    if (tileB && a.bundle?.ok) {
      tileB.textContent = `bundled ${pctPlain(a.bundle.bundledPct, 0)}`;
      tileB.className = `tile-b ${a.bundle.bundledPct >= 20 ? 'bad' : a.bundle.bundledPct >= 5 ? 'warn' : 'good'}`;
    } else if (tileB && (a.bundleErr || a.bundle?.ok === false)) {
      tileB.textContent = 'bundle n/a';
    }
    this.renderCoinCheck(card, t, a);
    this.renderHolderCheck(card, t, a);
    const row = (cls, k, v, sub = '') => `<div class="row ${cls}"><span class="dot"></span><span class="k">${k}</span><span class="v">${v}${sub ? `<small>${sub}</small>` : ''}</span></div>`;
    const level = (v, warn, bad) => (v == null ? '' : v >= bad ? 'bad' : v >= warn ? 'warn' : 'good');
    let html = '';

    // Bundle (computed from the launch block)
    const b = a.bundle;
    if (b?.ok) {
      if (b.wallets?.length) {
        html += `<button class="toggle" data-wallets="${addr}">${this.expanded.has(`w:${addr}`) ? 'Hide' : 'Show'} launch wallets ↓</button>
          <div class="wallets ${this.expanded.has(`w:${addr}`) ? 'show' : ''}">${b.wallets.map((w) => `
            <div class="wallet"><a href="https://gmgn.ai/sol/address/${w.owner}" target="_blank" rel="noopener noreferrer">${short(w.owner)}${w.isDev ? ' <span class="dev">dev</span>' : ''}</a>
            <span>${pctPlain(w.boughtPct, 2)} → ${pctPlain(w.heldPct, 2)}</span></div>`).join('')}
            <div class="wallet" style="color:var(--faint)"><span>Slot ${b.launchSlot.toLocaleString('en-US')}</span><span>${b.note || 'first block'}</span></div></div>`;
      }
    }

    // Holder / authority data
    const r = a.rug;
    // DexScreener sometimes lacks a creation time; RugCheck's first-seen date is a close stand-in.
    if (r?.detectedAt && !t.createdAt) {
      const ageEl = card.querySelector('[data-k="age"]');
      if (ageEl) ageEl.textContent = `~${age(Date.parse(r.detectedAt))}`;
    }
    if (r) {
      // Top 10 and insiders are in the coin check above once it has enough to say; listed here only until then.
      if (!coinCheck(t, a.rug, a.bundle)) {
        html += row(level(r.top10Pct, 30, 50), 'Top 10 holders', pctPlain(r.top10Pct), r.topHolder ? `largest ${pctPlain(r.topHolder.pct)}` : '');
        if (r.insiderWallets) html += row(level(r.insiderPct ?? 0, 8, 20), 'Insider wallets', `${r.insiderWallets}`, r.insiderPct != null ? `hold ${pctPlain(r.insiderPct)}` : 'linked by transfers');
      }
      const auth = !r.mintAuthority && !r.freezeAuthority;
      if (r.authorityKnown !== false) html += row(auth ? 'good' : 'bad', 'Mint / freeze', `${r.mintAuthority ? 'Mintable' : 'Renounced'} / ${r.freezeAuthority ? 'Freezable' : 'Renounced'}`);
      if (r.source === 'larpcheck') {
        html += `<div class="row note"><span class="dot"></span><span class="k">Holder data</span><span class="v"><a href="${esc(r.page)}" target="_blank" rel="noopener noreferrer">Larpcheck ↗</a></span></div>`;
      } else {
        if (!t.onCurve) html += row(r.lpLockedPct >= 90 ? 'good' : r.lpLockedPct >= 50 ? 'warn' : 'bad', 'LP locked / burned', pctPlain(r.lpLockedPct, 0));
        const danger = r.risks.filter((x) => x.level === 'danger');
        html += row(r.rugged ? 'bad' : level(r.score, 20, 50), 'RugCheck', r.rugged ? 'RUGGED' : `${r.score ?? '—'}/100 risk`, danger[0]?.name || (r.risks[0]?.name ?? 'no flags'));
      }
      const h = card.querySelector('[data-k="holders"]');
      if (h) h.textContent = num(r.holders);
    } else if (a.rugErr) {
      html += `<div class="row note"><span class="dot"></span><span class="k">Holder data</span><span class="v">${esc(a.rugErr)}</span></div>`;
      const h = card.querySelector('[data-k="holders"]');
      if (h) h.textContent = '—';
    } else {
      html += '<div class="skel" style="margin:8px 0;width:80%"></div><div class="skel" style="margin:8px 0;width:60%"></div>';
    }
    rowsEl.innerHTML = html;
  }

  // ---------- Frontrun: buy with the user's own Frontrun wallet (extension only) ----------
  // The background holds the key; the panel only learns whether it is connected and which wallets exist.
  loadFrontrun() {
    return send('frontrun:status')
      .then((s) => { this.frontrun = s || { connected: false }; })
      .catch(() => { this.frontrun = { connected: false, unsupported: true }; })
      .then(() => {
        if (this.view === 'settings') this.renderBody();
        else for (const t of this.cardTokens()) this.renderActions(t.address);
      });
  }

  frSelFor(addr) {
    if (!this.frSel.has(addr)) this.frSel.set(addr, { sol: '0.1', bps: 1000, wallet: this.frontrun?.wallets?.[0]?.address || '' });
    return this.frSel.get(addr);
  }

  updateFrGo(addr) {
    const b = this.bodyEl.querySelector(`[data-fr-go="${addr}"]`);
    const t = this.tokens.get(addr);
    if (b && t && !this.frBusy.has(addr)) b.textContent = `Buy $${String(t.symbol).trim()} · ${this.frSelFor(addr).sol || '0'} SOL`;
  }

  frSheetHtml(t) {
    const s = this.frSelFor(t.address);
    const wallets = this.frontrun?.wallets || [];
    const a = this.audits.get(t.address) || {};
    const why = a.rug || a.rugErr ? marketBlock(t) || reportBlock(a.rug) : null;
    const busy = this.frBusy.has(t.address);
    const sym = esc(String(t.symbol).trim());
    const wl = (w) => `${esc(w.name || 'Frontrun wallet')} · ${short(w.address)} · ~${w.sol.toFixed(3)} SOL`;
    return `<div class="fr-sheet">
      <div class="fr-presets">${['0.1', '0.25', '0.5', '1'].map((v) => `<button data-fr-sol="${t.address}" data-v="${v}" class="${String(s.sol) === v ? 'on' : ''}">${v} SOL</button>`).join('')}</div>
      <div class="fr-fields">
        <label><span>Amount</span><input data-fr-amt="${t.address}" value="${esc(s.sol)}" inputmode="decimal" autocomplete="off"><em>SOL</em></label>
        <label><span>Slippage</span><select data-fr-slip="${t.address}">${[500, 1000, 1500, 2500].map((b) => `<option value="${b}"${b === s.bps ? ' selected' : ''}>${b / 100}%</option>`).join('')}</select></label>
      </div>
      ${wallets.length > 1
    ? `<label class="fr-wsel"><span>Wallet</span><select data-fr-wallet="${t.address}">${wallets.map((w) => `<option value="${w.address}"${w.address === s.wallet ? ' selected' : ''}>${wl(w)}</option>`).join('')}</select></label>`
    : `<div class="fr-wone">${wallets.length ? wl(wallets[0]) : 'No Frontrun wallet yet. Create one on frontrun.pro.'}</div>`}
      ${why ? `<div class="fr-warn"><span>✕</span>${esc(why.charAt(0).toUpperCase() + why.slice(1))}</div>` : ''}
      <button class="fr-go" data-fr-go="${t.address}"${busy || !wallets.length ? ' disabled' : ''}>${busy ? 'Buying…' : `Buy $${sym} · ${esc(s.sol)} SOL`}</button>
      ${this.frMsg.has(t.address) ? `<div class="fr-msg">${this.frMsg.get(t.address)}</div>` : ''}
      <div class="fr-fine">Bought with your Frontrun wallet. Frontrun's fees apply. Not financial advice.</div>
    </div>`;
  }

  async frBuy(addr) {
    const t = this.tokens.get(addr);
    if (!t || this.frBusy.has(addr)) return;
    const s = this.frSelFor(addr);
    this.frBusy.add(addr);
    this.frMsg.delete(addr);
    this.renderActions(addr);
    try {
      const r = await send('frontrun:buy', { mint: addr, sol: s.sol, slippageBps: s.bps, wallet: s.wallet || undefined });
      // The signature is base58-checked in the background before it gets here.
      this.frMsg.set(addr, r.signature
        ? `${r.confirmed ? 'Bought' : 'Sent'} · <a href="https://solscan.io/tx/${r.signature}" target="_blank" rel="noopener noreferrer">View on Solscan ↗</a>`
        : 'Sent to Frontrun. Check your Frontrun wallet.');
      this.toast(`${r.confirmed ? 'Bought' : 'Sent'} $${String(t.symbol).trim()} with Frontrun`, 2400);
      this.loadFrontrun();
    } catch (err) {
      this.frMsg.set(addr, esc(err.message));
    } finally {
      this.frBusy.delete(addr);
      this.renderActions(addr);
    }
  }

  /* ----- alerts (extension only) ----- */
  // The background answers alerts:list only in the extension; on the web and in the userscript it's an unknown request,
  // and every alert control stays hidden.
  loadAlerts() {
    return send('alerts:list')
      .then((a) => {
        this.alerts = a;
        // Opening the toolbar popup counts as seeing the alerts: the badge clears.
        if (this.inline && a.unread) send('alerts:read').then((b) => { this.alerts = b; }).catch(() => {});
        this.renderHead();
        // The popup's home and the settings view both list the alerts.
        if (this.view === 'settings' || !this.state.ts) this.renderBody();
      })
      .catch(() => { this.alerts = null; });
  }

  watchedPost() {
    const id = String(this.lastPost?.url || '').match(/\/status\/(\d{5,25})/)?.[1];
    if (!id || !this.alerts || this.state.source?.kind === 'Search') return null;
    return { id, watch: this.alerts.watches.find((w) => w.id === id) || null };
  }

  watchHtml({ cta = false } = {}) {
    const w = this.watchedPost();
    if (!w) return '';
    if (w.watch) {
      const h = Math.max(1, Math.round((w.watch.until - Date.now()) / 3_600_000));
      return `<div class="watch on${cta ? ' cta' : ''}">${I.bell}<span>Watching this post · ${h}h left</span><button type="button" data-act="unwatch" data-id="${esc(w.id)}">Stop</button></div>`;
    }
    // A holder perk (the background checks it too). A watch already running keeps running.
    if (this.holder && !this.holder.holder) {
      return `<div class="watch on${cta ? ' cta' : ''}">${I.bell}<span>Launch alerts are for $RADAR holders</span>${this.holder.on ? '<button type="button" data-holder-connect>Check my wallet</button>' : ''}</div>`;
    }
    return `<button type="button" class="watch${cta ? ' cta' : ''}" data-act="watch"${this.watchBusy ? ' disabled' : ''}>${I.bell}<span>${this.watchBusy ? 'Setting up the alert…' : 'Alert me when a coin launches off this post'}</span></button>`;
  }

  async watch() {
    if (this.watchBusy || !this.lastPost) return;
    this.watchBusy = true;
    this.renderHead();
    if (!this.state.picks?.length) this.renderBody();
    try {
      this.alerts = await send('alerts:watch', { post: this.lastPost });
      this.toast(`Watching for 24h. Radar pings you when a coin launches off it${this.alerts.notifications ? '' : '. Turn on desktop alerts in the toolbar popup'}`, 3600);
    } catch (err) {
      this.toast(err.message, 3600);
    }
    this.watchBusy = false;
    this.renderHead();
    if (!this.state.picks?.length || this.view === 'settings') this.renderBody();
  }

  async unwatch(id) {
    try { this.alerts = await send('alerts:stop', { id }); } catch (err) { this.toast(err.message, 3000); }
    this.renderHead();
    if (!this.state.picks?.length || this.view === 'settings') this.renderBody();
  }

  // Desktop notifications need the optional permission, which only the toolbar popup can ask for (inside the click).
  async allowNotifications() {
    const api = globalThis.browser ?? globalThis.chrome;
    let granted = false;
    try { granted = await api.permissions.request({ permissions: ['notifications'] }); } catch { /* refused */ }
    this.toast(granted ? 'Desktop alerts on' : 'Desktop alerts stay off. Alerts still show on X and on the toolbar icon', 3000);
    await this.loadAlerts();
  }

  alertsHtml() {
    const a = this.alerts;
    if (!a) return '';
    const left = (w) => `${Math.max(1, Math.round((w.until - Date.now()) / 3_600_000))}h left`;
    const watches = a.watches.map((w) => `<div class="al-w"><div><b>${w.author ? `@${esc(w.author)}` : 'Post'}</b><span>${esc(w.label)}</span></div>
      <em>${left(w)}</em><button type="button" data-act="unwatch" data-id="${esc(w.id)}">Stop</button></div>`).join('');
    const hits = a.feed.slice(0, 5).map((f) => {
      const c = f.coin;
      const larp = f.larp ? `${f.larp.by === 'Larpcheck' ? 'Larpcheck' : 'Larp check'} ${esc(f.larp.word)}${f.larp.score != null ? ` ${esc(f.larp.score)}` : ''}` : '';
      const link = f.buy || f.chart;
      return `<a class="al-hit" href="${esc(link)}" target="_blank" rel="noopener noreferrer"><b>$${esc(String(c.symbol || '').trim())}</b>
        <span>${esc([CHAIN_LABEL[c.chain] || c.chain, usd(c.marketCap), age(f.at)].filter(Boolean).join(' · '))}</span>${larp ? `<em>${larp}</em>` : ''}</a>`;
    }).join('');
    return `<section class="settings">
      <div class="set-head"><h3>Alerts</h3>${a.watches.length ? `<span class="verdict ok">${a.watches.length} WATCHING</span>` : ''}</div>
      <p>Tap the bell under a post in the Radar panel. For the next 24 hours Radar checks every minute for a coin launched off it, runs the larp check, and pings you with a buy button.</p>
      ${watches ? `<div class="al-list">${watches}</div>` : ''}
      ${hits ? `<div class="section-label"><span>Latest alerts</span></div><div class="al-list">${hits}</div>` : ''}
      ${a.notifications ? '<p class="fine">Desktop alerts are on.</p>' : '<button class="fr-btn" data-alerts-notify>Turn on desktop alerts</button><p class="fine">Without them, alerts show on any open X tab and as a number on the Radar icon.</p>'}
    </section>`;
  }

  settingsHtml() {
    const f = this.frontrun || {};
    const wallets = (f.wallets || []).map((w) => `<div class="fr-w"><b>${esc(w.name || 'Wallet')}</b><span>${short(w.address)}</span><em>~${w.sol.toFixed(3)} SOL</em></div>`).join('');
    return `${this.alertsHtml()}<section class="settings">
      <div class="set-head"><h3>Frontrun</h3>${f.connected ? '<span class="verdict ok">CONNECTED</span>' : ''}</div>
      <p>Buy the coins Radar finds with your Frontrun wallet. Frontrun holds the wallet and signs. Radar sends an order only after you press Buy on a coin card.</p>
      ${f.connected
    ? `<div class="fr-wallets">${wallets || '<div class="fr-w"><span>No Frontrun wallets yet. Create one on frontrun.pro.</span></div>'}</div>
        <button class="fr-btn ghost" data-fr-disconnect>Disconnect</button>`
    : `<div class="fr-connect"><input type="password" data-fr-key placeholder="fr_sk_…" autocomplete="off" spellcheck="false"><button class="fr-btn" data-fr-connect>Connect</button></div>
        <a class="fr-link" href="https://frontrun.pro/api" target="_blank" rel="noopener noreferrer">Make an API key on frontrun.pro ↗</a>`}
      ${f.error ? `<p class="fr-err">${esc(f.error)}</p>` : ''}
      <p class="fine">Your key stays on this device and only goes to solana.frontrun.pro. Frontrun's Trading API is in beta, so keep only what you'd trade in that wallet. Not financial advice.</p>
      <button class="fr-btn ghost" data-act-back>Back to Radar</button>
    </section>`;
  }

  async frConnect() {
    const input = this.bodyEl.querySelector('[data-fr-key]');
    const key = input?.value.trim() || '';
    if (!/^fr_sk_[A-Za-z0-9]{64}$/.test(key)) { this.toast('A Frontrun key starts with fr_sk_ and has 70 characters', 3000); return; }
    // Asked inside the click, before anything is awaited: browsers only allow it from a user gesture.
    const api = globalThis.browser ?? globalThis.chrome;
    let granted = false;
    try { granted = await api.permissions.request({ origins: ['https://solana.frontrun.pro/*'] }); } catch { /* refused */ }
    if (!granted) { this.toast('Radar needs permission to reach Frontrun', 3000); return; }
    input.value = '';
    try {
      this.frontrun = await send('frontrun:connect', { key });
      this.toast('Frontrun connected', 2000);
    } catch (err) {
      this.frontrun = { connected: false, error: err.message };
    }
    this.renderBody();
  }

  async frDisconnect() {
    try { this.frontrun = await send('frontrun:disconnect'); } catch (err) { this.toast(err.message, 3000); }
    this.frSel.clear();
    this.renderBody();
  }

  // Holder check (ui/holdercheck.js): real holders and no rug flags, the same test Instant Reroute uses.
  renderHolderCheck(card, t, a) {
    const el = card.querySelector(`[data-hc="${t.address}"]`);
    if (!el) return;
    if (!a.rug && !a.rugErr) return;
    const why = marketBlock(t) || reportBlock(a.rug);
    el.className = `hc ${why ? 'no' : 'ok'}`;
    // Larpcheck's own line, credited and linked, when its read stands in for RugCheck's.
    const by = a.rug?.source === 'larpcheck' ? `<a class="hc-by" href="${esc(a.rug.page)}" target="_blank" rel="noopener noreferrer">Larpcheck ↗</a>` : '';
    el.innerHTML = why
      ? `<span class="hc-mark">✕</span><span>${esc(why.charAt(0).toUpperCase() + why.slice(1))}</span>${by || '<em>Reroute skips it</em>'}`
      : by
        ? `<span class="hc-mark">✓</span><span>${esc(a.rug.line || `Real holders · ${num(a.rug.holders)}`)}</span>${by}`
        : `<span class="hc-mark">✓</span><span>Real holders · ${num(a.rug.holders)}</span><em>Passes the check</em>`;
  }

  // Coins on the post that share this one's ticker: copycats are the usual trap on a hot narrative.
  nameTwins(t) {
    const key = (x) => String(x.symbol || '').trim().replace(/^\$/, '').toLowerCase();
    const k = key(t);
    if (!k) return null;
    const group = [...this.tokens.values()].filter((x) => key(x) === k);
    if (group.length < 3) return null;
    const oldest = group.filter((x) => x.createdAt).sort((a, b) => a.createdAt - b.createdAt)[0];
    return { n: group.length, oldest: oldest?.address === t.address };
  }

  // A clean summary of what Radar found, copied for posting. No contract addresses.
  shareText() {
    const s = this.state;
    const who = this.lastPost?.author ? `@${this.lastPost.author}'s post` : 'this post';
    const lines = [`Radar on ${who}`];
    if (s.narrative) lines.push(`Story: ${s.narrative}`);
    const ROLE_NAME = { top: 'Top', og: 'OG', mover: 'Mover' };
    for (const p of s.picks || []) {
      const t = this.tokens.get(p.token.address) || p.token;
      const a = this.audits.get(t.address) || {};
      const c = coinCheck(t, a.rug, a.bundle);
      lines.push(`${ROLE_NAME[p.role] || 'Pick'}: $${String(t.symbol).trim()} ${usd(t.marketCap)}${c ? ` · coin check ${c.word} ${c.score}` : ''}`);
    }
    const st = s.story;
    if (st?.larpcheck?.checked) lines.push(`Larpcheck: ${st.larpcheck.verdict}${st.larpcheck.score != null ? ` ${st.larpcheck.score}` : ''} ${st.larpcheck.url || ''}`.trim());
    else if (st?.word) lines.push(`Larp check: ${st.word} ${st.score}`);
    lines.push('Found with Radar · tryradar.fun');
    return lines.join('\n');
  }

  async share() {
    try {
      await this.copyText(this.shareText());
      this.toast('Summary copied · paste it anywhere', 2200);
    } catch {
      this.toast('Could not copy the summary');
    }
  }

  // Coin check: who could move the price, as one word + score and the facts behind it.
  renderCoinCheck(card, t, a) {
    const c = coinCheck(t, a.rug, a.bundle);
    const chip = card.querySelector(`[data-cc="${t.address}"]`);
    const box = card.querySelector('[data-k="check"]');
    if (!c) {
      if (chip) chip.innerHTML = '';
      if (box) box.innerHTML = '';
      return;
    }
    const tone = c.word === 'OK' ? 'ok' : c.word === 'NEUTRAL' ? 'mid' : 'risk';
    if (chip) chip.innerHTML = `<span class="verdict ${tone}" title="Coin check: ${esc(c.call)}">${c.word} <b>${c.score}</b></span>`;
    if (!box) return;
    const lvl = { ok: 'good', watch: 'warn', risk: 'bad' };
    const val = (f) => (f.text ? esc(f.text) : f.unit === 'price' ? pctPlain(f.v, 0) : pctPlain(f.v));
    box.innerHTML = `<h4>Coin check <span class="verdict ${tone}">${c.word} <b>${c.score}</b></span></h4>
      ${c.call ? `<p class="cc-call">${esc(c.call)}</p>` : ''}
      <div class="rows">${c.facts.map((f) => `<div class="row ${lvl[f.lvl] || ''}"><span class="dot"></span><span class="k">${esc(f.k)}</span><span class="v">${val(f)}${f.sub ? `<small>${esc(f.sub)}</small>` : ''}</span></div>`).join('')}</div>`;
  }

  patchCard(prev, t) {
    const card = this.bodyEl.querySelector(`.card[data-addr="${t.address}"]`);
    const set = (k, html, dir = 0) => {
      const el = card?.querySelector(`[data-k="${k}"]`);
      if (!el || el.innerHTML === html) return;
      el.innerHTML = html;
      if (dir) { el.classList.remove('flash-up', 'flash-down'); void el.offsetWidth; el.classList.add(dir > 0 ? 'flash-up' : 'flash-down'); }
    };
    const dir = Math.sign(t.marketCap - prev.marketCap);
    if (card) {
      // The holder line depends on volume and liquidity too, which a coin named in the post only gets on its first refresh.
      if (t.chain === 'solana') this.renderHolderCheck(card, t, this.audits.get(t.address) || {});
      set('mc', usd(t.marketCap), dir);
      set('price', price(t.priceUsd), Math.sign(t.priceUsd - prev.priceUsd));
      if (!t.onCurve) set('liq', usd(t.liquidity));
      set('vol', usd(t.volume.h24));
      set('tx24', num(t.txns.h24.buys + t.txns.h24.sells));
      set('buys', `${num(t.txns.h1.buys)} buys`);
      set('sells', `${num(t.txns.h1.sells)} sells`);
      const tot = t.txns.h1.buys + t.txns.h1.sells;
      const flow = card.querySelector('[data-k="flow"]');
      if (flow) flow.style.width = `${tot ? (t.txns.h1.buys / tot) * 100 : 50}%`;
      for (const k of ['m5', 'h1', 'h6', 'h24']) {
        const el = card.querySelector(`[data-k="chg-${k}"]`);
        if (!el) continue;
        const v = t.priceChange?.[k];
        el.className = `chg ${v == null ? '' : v >= 0 ? 'up' : 'down'}${k === 'h1' && v >= 25 ? ' hot' : ''}`;
        el.querySelector('b').textContent = pct(v);
      }
    }
    const tileMc = this.bodyEl.querySelector(`[data-tile-mc="${t.address}"]`);
    if (tileMc) tileMc.textContent = usd(t.marketCap);
    const tileChg = this.bodyEl.querySelector(`[data-tile-chg="${t.address}"]`);
    if (tileChg) {
      const ch = t.priceChange?.h1 ?? t.priceChange?.h24;
      tileChg.className = `tile-chg ${ch == null ? '' : ch >= 0 ? 'up' : 'down'}`;
      tileChg.textContent = pct(ch);
    }
    const li = this.bodyEl.querySelector(`.li[data-expand="${t.address}"] [data-k="li-mc"]`);
    if (li && t.mcapBacked) {
      const ch = +t.priceChange.h1 || +t.priceChange.h24 || 0;
      li.innerHTML = `${usd(t.marketCap)}<span class="${ch >= 0 ? 'up' : 'down'}">${pct(ch)}</span>`;
    }
  }

  renderFoot() {
    const { ts, loading } = this.state;
    this.footEl.innerHTML = `<span>DexScreener · RugCheck · Larpcheck</span><span data-ago>${loading ? 'scanning' : ts ? 'updated just now' : 'not scanned'}</span>`;
    clearInterval(this.agoTimer);
    if (ts && !loading) this.agoTimer = setInterval(() => {
      const s = Math.round((Date.now() - this.state.ts) / 1000);
      const el = this.footEl.querySelector('[data-ago]');
      if (el) el.textContent = s < 3 ? 'updated just now' : `updated ${s}s ago`;
    }, 1000);
  }

  async copyText(text) {
    try { await navigator.clipboard.writeText(text); } catch {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
  }

  toast(msg, ms = 1400) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  async onBodyClick(e) {
    if (e.target.closest('[data-act-back]')) { this.view = 'scan'; this.renderHead(); this.renderBody(); return; }
    const starBtn = e.target.closest('[data-star]');
    if (starBtn) { this.toggleStar(starBtn.dataset.star); return; }
    const starGone = e.target.closest('[data-star-remove]');
    if (starGone) { this.removeStar(starGone.dataset.starRemove); return; }
    const starOpen = e.target.closest('[data-star-open]');
    if (starOpen) { this.scan({ post: { text: starOpen.dataset.starOpen }, source: { kind: 'Watchlist', label: `$${starOpen.dataset.starSym}` } }); return; }
    if (e.target.closest('[data-act="watch"]')) { await this.watch(); return; }
    const stop = e.target.closest('[data-act="unwatch"]');
    if (stop) { await this.unwatch(stop.dataset.id); return; }
    if (e.target.closest('[data-alerts-notify]')) { await this.allowNotifications(); return; }
    if (e.target.closest('[data-fr-connect]')) { await this.frConnect(); return; }
    if (e.target.closest('[data-fr-disconnect]')) { await this.frDisconnect(); return; }
    const frb = e.target.closest('[data-fr-buy]');
    if (frb) {
      const k = `fr:${frb.dataset.frBuy}`;
      this.expanded.has(k) ? this.expanded.delete(k) : this.expanded.add(k);
      this.renderActions(frb.dataset.frBuy);
      return;
    }
    const frs = e.target.closest('[data-fr-sol]');
    if (frs) { this.frSelFor(frs.dataset.frSol).sol = frs.dataset.v; this.renderActions(frs.dataset.frSol); return; }
    const frg = e.target.closest('[data-fr-go]');
    if (frg) { await this.frBuy(frg.dataset.frGo); return; }
    // Insta Buy opens its window right here, inside the click, so the browser lets it through.
    const ib = e.target.closest('[data-insta]');
    if (ib) { this.instaBuy(ib.dataset.insta); return; }
    if (e.target.closest('[data-holder-connect]')) { this.holderConnect(); return; }
    const ibm = e.target.closest('[data-insta-menu]');
    if (ibm) {
      const k = `ib:${ibm.dataset.instaMenu}`;
      this.expanded.has(k) ? this.expanded.delete(k) : this.expanded.add(k);
      this.renderActions(ibm.dataset.instaMenu);
      return;
    }
    const ibs = e.target.closest('[data-insta-sol]');
    if (ibs) {
      (ibs.dataset.unit === 'ETH' ? setInstaEth : setInstaSol)(ibs.dataset.instaSol);
      this.expanded.delete(`ib:${ibs.dataset.addr}`);
      for (const t of this.cardTokens()) this.renderActions(t.address);
      return;
    }
    const reroute = e.target.closest('[data-reroute]');
    if (reroute) {
      await this.rerouteFromPanel(reroute);
      return;
    }
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      e.preventDefault();
      const ca = copy.dataset.copy;
      await this.copyText(ca);
      copy.classList.add('copied');
      copy.innerHTML = `Copied ${I.check}`;
      this.toast('Contract address copied');
      setTimeout(() => { copy.classList.remove('copied'); copy.innerHTML = `${short(ca)} ${I.copy}`; }, 1400);
      return;
    }
    const trend = e.target.closest('[data-trend]');
    if (trend) { this.scan({ post: { text: `Trending on X: ${trend.dataset.trend}` }, source: { kind: 'Trend', label: trend.dataset.trend } }); return; }
    const chartBtn = e.target.closest('[data-chart]');
    if (chartBtn) {
      const addr = chartBtn.dataset.chart;
      const key = `ch:${addr}`;
      this.expanded.has(key) ? this.expanded.delete(key) : this.expanded.add(key);
      const t = this.tokens.get(addr);
      const card = this.bodyEl.querySelector(`.card[data-addr="${addr}"]`);
      if (t && card) {
        card.querySelector(`[data-actions="${addr}"]`).innerHTML = this.actionsHtml(t);
        card.querySelector(`[data-chart-box="${addr}"]`).innerHTML = this.chartHtml(t);
        this.renderLarp(addr);
      }
      return;
    }
    const tab = e.target.closest('[data-board]');
    if (tab) { this.board = []; this.loadBoard(tab.dataset.board); this.renderBody(); return; }
    const listed = e.target.closest('[data-board-coin]');
    if (listed) { this.scan({ post: { text: listed.dataset.boardCoin }, source: { kind: 'Larpcheck', label: listed.dataset.boardTitle || listed.dataset.boardCoin } }); return; }
    const again = this.recent?.[e.target.closest('[data-recent]')?.dataset.recent];
    if (again) { this.scan({ post: { text: again.q }, source: isPostLink(again.q) ? null : { kind: again.k, label: again.l } }); return; }
    if (e.target.closest('[data-launch]')) {
      const w = 480;
      const left = Math.max(0, (window.screenX || 0) + (window.outerWidth || w) - w - 32);
      if (!window.open(launchUrl(this.lastPost.url), 'radar-launch', `popup=yes,width=${w},height=820,left=${left},top=${Math.max(0, (window.screenY || 0) + 48)}`)) window.open(launchUrl(this.lastPost.url), '_blank', 'noopener');
      return;
    }
    if (e.target.closest('[data-recent-clear]')) { this.recent = []; this.renderBody(); send('recentClear').catch(() => {}); return; }
    if (e.target.closest('[data-retry]')) { this.rescan(); return; }
    const term = e.target.closest('[data-term]');
    if (term) {
      // Let the link open normally; copy the CA alongside. A terminal picked from the menu becomes the Trade button.
      this.copyText(term.dataset.ca).then(() => this.toast(`CA copied · opening ${term.dataset.term}`));
      if (term.dataset.termPick) {
        setPrefTerm(term.dataset.termPick);
        this.expanded.delete(`tm:${term.dataset.ca}`);
        for (const t of this.cardTokens()) this.renderActions(t.address);
      }
      return;
    }
    const tm = e.target.closest('[data-term-menu]');
    if (tm) {
      const key = `tm:${tm.dataset.termMenu}`;
      this.expanded.has(key) ? this.expanded.delete(key) : this.expanded.add(key);
      this.renderActions(tm.dataset.termMenu);
      return;
    }
    if (e.target.closest('[data-more-matches]')) {
      this.expanded.add('all-matches');
      this.renderBody();
      return;
    }
    const tog = e.target.closest('[data-toggle]');
    if (tog && !e.target.closest('[data-copy]')) {
      const addr = tog.dataset.toggle;
      const card = this.bodyEl.querySelector(`.card[data-addr="${addr}"]`);
      const open = !this.openCards.has(addr);
      open ? this.openCards.add(addr) : this.openCards.delete(addr);
      card?.classList.toggle('open', open);
      card?.querySelector('.card-body')?.setAttribute('aria-hidden', String(!open));
      const btn = card?.querySelector('.toggle-card');
      if (btn) { btn.setAttribute('aria-expanded', String(open)); btn.title = open ? 'Show less' : 'Show everything'; }
      return;
    }
    const bub = e.target.closest('[data-bubble]');
    if (bub) {
      const chain = BUBBLE_CHAIN[bub.dataset.chain] || 'solana';
      send('openWindow', { url: `https://v2.bubblemaps.io/map?address=${bub.dataset.bubble}&chain=${chain}` })
        .catch((err) => this.toast(err.message));
      return;
    }
    const jump = e.target.closest('[data-jump]');
    if (jump) {
      const card = this.bodyEl.querySelector(`.card[data-addr="${jump.dataset.jump}"]`);
      if (card && !card.classList.contains('open')) card.querySelector('.toggle-card')?.click();
      card?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const exp = e.target.closest('[data-expand]');
    if (exp) {
      this.expanded.add(exp.dataset.expand);
      this.renderBody();
      const t = this.tokens.get(exp.dataset.expand);
      if (t) {
        this.loadAudit(t);
        this.loadLarp(t);
      }
      this.bodyEl.querySelector(`.card[data-addr="${exp.dataset.expand}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    const w = e.target.closest('[data-wallets]');
    if (w) {
      const key = `w:${w.dataset.wallets}`;
      this.expanded.has(key) ? this.expanded.delete(key) : this.expanded.add(key);
      this.renderAudit(w.dataset.wallets);
    }
  }

  // Instant reroute through the one shared check (lib/reroute.js, run by the backend).
  // The post button calls this without candidates; the panel passes the coins it already shows.
  // The post goes through preparePost so the button and the panel share one cached search.
  // Insta Buy: tryradar.fun/trade as a small window at the right of this one, amount picked. The user's own wallet
  // still approves the buy there; the window reports back (see listenForBuys) and closes when Solana confirms it.
  instaBuy(addr) {
    const t = this.tokens.get(addr);
    const hood = isHood(t);
    const w = 440;
    const h = 780;
    const left = Math.max(0, (window.screenX || 0) + (window.outerWidth || w) - w - 32);
    const top = Math.max(0, (window.screenY || 0) + 72);
    // What this click started, so the window can ask the panel to vouch for it (Auto-Confirm, see web/quickbuy-guard.js).
    this.instaAsk = hood ? null : { mint: addr, sol: Number(instaSol()), at: Date.now() };
    const win = window.open(hood ? hoodBuyUrl(addr, instaEth()) : instaUrl(addr, instaSol()), 'radar-insta', `popup=yes,width=${w},height=${h},left=${left},top=${top}`);
    if (!win) {
      window.open(hood ? hoodBuyUrl(addr) : quickBuyUrl({ address: addr }), '_blank', 'noopener');
      this.toast('Pop-ups are blocked here, so the buy page opened in a tab', 3200);
      return;
    }
    win.focus?.();
    this.toast(hood ? 'Radar checks the real cost first, then your wallet asks you to approve' : `Approve the ${instaSol()} SOL buy${t?.symbol ? ` of $${String(t.symbol).trim()}` : ''} in your wallet`, 3200);
  }

  listenForBuys() {
    window.addEventListener('message', (e) => {
      if (e.origin === 'https://tryradar.fun' && e.data?.type === 'radar:holder') {
        send('holderSave', { token: e.data.token, exp: e.data.exp }).then((h) => { this.holder = h; this.renderHead(); this.renderBody(); this.toast('Holder check passed', 2400); }).catch(() => {});
        return;
      }
      if (e.origin === 'https://tryradar.fun' && e.data?.type === 'radar:insta-ready') {
        const ask = this.instaAsk;
        // Once, for the coin and amount this panel's own click just opened.
        if (!ask || Date.now() - ask.at > 30_000 || e.data.mint !== ask.mint || Number(e.data.sol) !== ask.sol) return;
        this.instaAsk = null;
        e.source?.postMessage({ type: 'radar:insta-go', mint: ask.mint, sol: ask.sol }, 'https://tryradar.fun');
        return;
      }
      if (e.origin !== 'https://tryradar.fun' || e.data?.type !== 'radar:bought') return;
      const symbol = String(e.data.symbol || '').replace(/[^\w$./-]/g, '').slice(0, 20);
      this.toast(`Bought ${symbol ? `$${symbol}` : 'it'} · confirmed on ${/^0x/.test(e.data.mint || '') ? 'Robinhood Chain' : 'Solana'}`, 4200);
    });
  }

  async route(post, candidates = null) {
    const p = await this.preparePost(post);
    return send('reroute', { post: p, candidates });
  }

  async rerouteFromPanel(button) {
    const fresh = (t) => this.tokens.get(t.address) || t;
    const candidates = [
      ...(this.state.techMatch ? [this.state.techMatch] : []),
      ...this.state.picks.map((p) => p.token),
      ...this.state.others,
    ].map(fresh);
    button.disabled = true;
    button.textContent = 'Checking…';
    try {
      const r = await this.route(this.lastPost || {}, candidates);
      this.toast(`Opening $${r.symbol} · ${r.reason}${r.holders ? ` · ${r.holders.toLocaleString('en-US')} holders` : ''}`, 3200);
    } catch (err) {
      this.toast(err.message, 4200);
    } finally {
      button.disabled = false;
      button.textContent = 'Open best match';
    }
  }
}

async function loadCss() {
  if (cssInline) return cssInline;
  const res = await fetch(cssUrl || chrome.runtime.getURL('src/ui/radar.css'));
  return res.text();
}

export function detectTheme() {
  const bg = getComputedStyle(document.body).backgroundColor;
  const m = bg.match(/\d+/g)?.map(Number) || [0, 0, 0];
  const lum = (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255;
  if (lum > 0.6) return 'light';
  if (m[2] > 30 && lum > 0.05) return 'dim';
  return 'dark';
}

// Overlay on x.com — isolated in a shadow root so X's styles never leak in.
export async function mountFloating() {
  const host = document.createElement('div');
  host.id = 'narrative-radar-host';
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = await loadCss();
  const root = document.createElement('div');
  root.className = 'nr-root';
  root.dataset.theme = detectTheme();
  shadow.append(style, root);
  const radar = new Radar(root, {});
  new MutationObserver(() => { root.dataset.theme = detectTheme(); })
    .observe(document.body, { attributes: true, attributeFilter: ['style', 'class'] });
  return radar;
}

export async function mountInline(el, theme, opts = {}) {
  const style = document.createElement('style');
  style.textContent = await loadCss();
  const root = document.createElement('div');
  root.className = 'nr-root inline';
  root.dataset.theme = theme;
  root.style.cssText = 'display:block;height:100%';
  el.append(style, root);
  return new Radar(root, { inline: true, ...opts });
}
