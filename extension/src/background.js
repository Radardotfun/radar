import { makeHandlers, API_BASE, DEFAULTS } from './lib/handlers.js';
import { listWallets, buy, KEY_RE, FRONTRUN_ORIGIN } from './lib/frontrun.js';
import { newWatch, newFollow, verdictTurned, checkWatch, buyUrl, chartUrl, MAX_WATCHES, coinOf, statusOf, signalItem, signalCoins } from './lib/alerts.js';
import { GUARD_KEY, GUARD_MINUTES, lookAtStar } from './lib/guard.js';
import { lookAt, launchFromPairs, isWalletAddress, agoText, MAX_MY_WALLETS } from './lib/diamond.js';
import { reportBlock } from './ui/holdercheck.js';

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

// ---------- Alerts: a ping when a watched post spawns a coin ----------
// The user watches a post from the panel. A one-minute alarm checks every watch (lib/alerts.js); a new coin gets
// the larp check (Larpcheck's verdict when they have one, else Radar's) and, on Solana, the holder check, then shows
// as the toolbar badge, as a card on any open X tab (content.js) and, if the user turned them on in the toolbar popup,
// as a desktop notification with a buy button.
const ALERTS = 'alerts'; // { watches, feed, unread }
const ALARM = 'radar-alerts';
const loadAlerts = async () => ({ watches: [], feed: [], unread: 0, ...((await ext.storage.local.get(ALERTS))[ALERTS] || {}) });
const saveAlerts = (a) => ext.storage.local.set({ [ALERTS]: a });
// Reads and writes of the alert state go one at a time, so a check and a click never overwrite each other.
let alertQueue = Promise.resolve();
const withAlerts = (fn) => {
  const run = alertQueue.catch(() => {}).then(async () => {
    const a = await loadAlerts();
    const out = await fn(a);
    await saveAlerts(a);
    return out;
  });
  alertQueue = run;
  return run;
};
const publicWatch = (w) => ({ id: w.id, word: w.word || null, url: w.url, author: w.author, label: w.label, narrative: w.narrative, since: w.since, until: w.until });
const canNotify = () => ext.permissions.contains({ permissions: ['notifications'] }).catch(() => false);
const showBadge = (n) => {
  ext.action.setBadgeText({ text: n ? String(Math.min(n, 99)) : '' }).catch(() => {});
  if (n) ext.action.setBadgeBackgroundColor({ color: '#7c5cff' }).catch(() => {});
};
const FRESH_KEY = 'freshBadges'; // content.js reads it: new-pair badges under posts, on unless turned off
const BIG_KEY = 'bigAccountAlerts'; // on unless turned off
const DH_KEY = 'diamondAlerts'; // on unless turned off
const MY_WALLETS = 'diamondWallets'; // [{ address, last }]: the holder's own wallets to watch
const MY_WALLETS_AT = 'diamondWalletsAt';
const alertList = async (a) => ({ watches: a.watches.filter((w) => w.until > Date.now()).map(publicWatch), feed: a.feed.slice(0, 20), unread: a.unread, notifications: await canNotify(), freshBadges: (await ext.storage.local.get(FRESH_KEY))[FRESH_KEY] !== false, bigAccounts: (await ext.storage.local.get(BIG_KEY))[BIG_KEY] !== false, ...(await diamondState()) });

handlers['alerts:list'] = async () => alertList(await loadAlerts());
handlers['alerts:watch'] = async ({ post }, sender) => {
  if (!fromPopup(sender) && !fromX(sender)) throw new Error('Watch posts from the Radar panel');
  // A holder perk. Alerts run on this device, so unlike the server's holder data this can only be a check here.
  if (!(await handlers.holderActive())) throw new Error('Launch alerts are for $RADAR and $LARPCHECK holders. Check your wallet first.');
  const read = await handlers.read({ post });
  if (read.engineError) throw new Error(`Radar couldn't read this post right now (${read.engineError})`);
  const w = newWatch(post, read);
  // The first check notes the coins already there, so only new ones ping.
  const first = await checkWatch(w, { chains: (await settings()).chains }).catch(() => null);
  if (first) Object.assign(w, { seen: first.seen, primed: true });
  const list = await withAlerts(async (a) => {
    a.watches = a.watches.filter((x) => x.until > Date.now() && x.id !== w.id);
    if (a.watches.length >= MAX_WATCHES) throw new Error(`Radar watches up to ${MAX_WATCHES} posts or words at once. Stop one in the toolbar popup first.`);
    a.watches.push(w);
    return alertList(a);
  });
  await ext.alarms.create(ALARM, { periodInMinutes: 1 });
  return list;
};
// Following a word: an alert when a new pair appears for it, on any post or none. The same holder perk as watching a post.
handlers['alerts:follow'] = async ({ word }, sender) => {
  if (!fromPopup(sender) && !fromX(sender)) throw new Error('Follow words from the Radar panel');
  if (!(await handlers.holderActive())) throw new Error('Launch alerts are for $RADAR and $LARPCHECK holders. Check your wallet first.');
  const w = newFollow(word);
  const first = await checkWatch(w, { chains: (await settings()).chains }).catch(() => null);
  if (first) Object.assign(w, { seen: first.seen, primed: true });
  const list = await withAlerts(async (a) => {
    a.watches = a.watches.filter((x) => x.until > Date.now() && x.id !== w.id);
    if (a.watches.length >= MAX_WATCHES) throw new Error(`Radar watches up to ${MAX_WATCHES} posts or words at once. Stop one in the toolbar popup first.`);
    a.watches.push(w);
    return alertList(a);
  });
  await ext.alarms.create(ALARM, { periodInMinutes: 1 });
  return list;
};
handlers['alerts:fresh'] = async ({ on }) => {
  await ext.storage.local.set({ [FRESH_KEY]: !!on });
  return alertList(await loadAlerts());
};
// Diamond Hand's part of the alerts view: its switch, the holder's own wallets, and whether this browser holds.
async function diamondState() {
  const got = await ext.storage.local.get([DH_KEY, MY_WALLETS, 'radarHolder']);
  return { diamond: got[DH_KEY] !== false, myWallets: (got[MY_WALLETS] || []).map((w) => w.address), holder: !!(got.radarHolder?.token && got.radarHolder.exp > Date.now()) };
}
handlers['alerts:diamond'] = async ({ on }) => {
  await ext.storage.local.set({ [DH_KEY]: !!on });
  return alertList(await loadAlerts());
};
handlers['diamond:add'] = async ({ address }) => {
  const a = String(address || '').trim();
  if (!isWalletAddress(a)) throw new Error('That is not a Solana wallet address');
  const mine = (await ext.storage.local.get(MY_WALLETS))[MY_WALLETS] || [];
  if (mine.some((w) => w.address === a)) throw new Error('Radar already watches that wallet');
  if (mine.length >= MAX_MY_WALLETS) throw new Error(`Radar watches up to ${MAX_MY_WALLETS} of your wallets. Remove one first`);
  await ext.storage.local.set({ [MY_WALLETS]: [...mine, { address: a, last: null }] });
  return alertList(await loadAlerts());
};
handlers['diamond:remove'] = async ({ address }) => {
  const mine = (await ext.storage.local.get(MY_WALLETS))[MY_WALLETS] || [];
  await ext.storage.local.set({ [MY_WALLETS]: mine.filter((w) => w.address !== address) });
  return alertList(await loadAlerts());
};
handlers['alerts:bigAccounts'] = async ({ on }) => {
  await ext.storage.local.set({ [BIG_KEY]: !!on });
  return alertList(await loadAlerts());
};
handlers['alerts:stop'] = async ({ id }) => withAlerts(async (a) => {
  a.watches = a.watches.filter((w) => w.id !== String(id) && w.until > Date.now());
  if (!a.watches.length) await ext.alarms.clear(ALARM);
  return alertList(a);
});
handlers['alerts:read'] = async () => withAlerts(async (a) => { a.unread = 0; showBadge(0); return alertList(a); });

// The larp check for a new coin: Larpcheck's verdict when they've checked it (credited, never reworded), else Radar's.
async function alertLarp(w, coin, tie) {
  const lc = await handlers.larpcheck({ address: coin.address }).catch(() => null);
  if (lc?.checked) return { by: 'Larpcheck', word: lc.verdict, score: lc.score ?? null, url: lc.url || lc.page || null };
  if (w.word) return null; // a followed word has no post, so there's no story to check the coin against
  const s = await handlers.story({
    post: w.post,
    narrative: w.narrative,
    coin: { name: coin.name, symbol: coin.symbol, address: coin.address, createdAt: coin.createdAt, socials: coin.socials, websites: coin.websites, fromPost: tie === 'post', mentioned: false },
  }).catch(() => null);
  return s?.word ? { by: 'Radar', word: s.word, score: s.score ?? null, call: s.call || '' } : null;
}
// The holder check (Solana only): RugCheck's holders and flags, as one line.
async function alertHolders(coin) {
  if (coin.chain !== 'solana') return null;
  const report = await handlers.safety({ mint: coin.address, pairs: coin.pairAddresses || [] }).catch(() => null);
  if (!report) return null;
  const why = reportBlock(report);
  return { ok: !why, holders: report.holders ?? null, text: why ? `Holder check: ${why}` : `Real holders · ${Number(report.holders).toLocaleString('en-US')}` };
}

const usdShort = (n) => (!(n > 0) ? '' : n >= 999.95e3 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${Math.round(n)}`);
const CHAIN_NAME = { solana: 'Solana', robinhood: 'Robinhood Chain', base: 'Base', bsc: 'BNB Chain' };
async function notify(item) {
  if (!ext.notifications || !(await canNotify())) return;
  if (item.kind === 'signal') {
    const cas = (item.coins || []).map((k) => `$${k.symbol} ${k.address}`).join('\n');
    const big = { type: 'basic', iconUrl: ext.runtime.getURL('icons/icon128.png'), title: `@${item.watch.author}${item.coin.name ? `: ${item.coin.name}` : ' posted something'}`, message: [item.text, cas].filter(Boolean).join('\n'), priority: 2, buttons: [{ title: 'Scan it' }, { title: 'Open the post' }] };
    try { await ext.notifications.create(item.id, big); } catch { delete big.buttons; await ext.notifications.create(item.id, big).catch(() => {}); }
    return;
  }
  const c = item.coin;
  const line = [CHAIN_NAME[c.chain] || c.chain, usdShort(c.marketCap) && `${usdShort(c.marketCap)} MC`].filter(Boolean).join(' · ');
  const larp = item.larp && `${item.larp.by === 'Larpcheck' ? 'Larpcheck' : 'Larp check'}: ${item.larp.word}${item.larp.score != null ? ` ${item.larp.score}` : ''}`;
  const opts = {
    type: 'basic',
    iconUrl: ext.runtime.getURL('icons/icon128.png'),
    title: item.kind === 'guard' ? `Radar Guard: ${item.text}` : item.kind === 'verdict' ? `Larpcheck now says ${item.larp.word}: $${String(c.symbol || '').slice(0, 14)}` : item.watch.word ? `New pair on "${item.watch.word}": $${String(c.symbol || '').slice(0, 14)}` : `New coin off ${item.watch.author ? `@${item.watch.author}'s` : 'a watched'} post: $${String(c.symbol || '').slice(0, 14)}`,
    message: [line, [larp, item.holders?.text].filter(Boolean).join(' · ')].filter(Boolean).join('\n'),
    priority: 2,
    buttons: [{ title: item.buy ? (c.chain === 'solana' ? 'Buy on Radar' : 'Trade on Uniswap') : 'Open the chart' }, { title: 'Open the post' }],
  };
  // Firefox has no notification buttons: there a click opens the buy page.
  try { await ext.notifications.create(item.id, opts); } catch { delete opts.buttons; await ext.notifications.create(item.id, opts).catch(() => {}); }
}
// The notifications API exists only once the user has allowed it, so its listeners are added then too.
let notifyWired = false;
function wireNotifications() {
  if (notifyWired || !ext.notifications) return;
  notifyWired = true;
  const open = async (id, which) => {
    const item = (await loadAlerts()).feed.find((f) => f.id === id);
    if (!item) return;
    const url = which === 'post' ? item.watch.url : item.buy || item.chart;
    if (/^https:\/\/(tryradar\.fun|app\.uniswap\.org|dexscreener\.com|x\.com)\//.test(url)) ext.tabs.create({ url });
    ext.notifications.clear(id).catch(() => {});
  };
  ext.notifications.onClicked.addListener((id) => open(id, 'buy'));
  ext.notifications.onButtonClicked?.addListener((id, i) => open(id, i === 0 ? 'buy' : 'post'));
}
wireNotifications();
ext.permissions.onAdded?.addListener(() => wireNotifications());

// Coins already in the feed get another look at Larpcheck, three a minute. Radar pings when a verdict turns bad, using only
// Larpcheck's free reads, cached on the server.
let sweepAt = 0;
async function sweepVerdicts() {
  const coins = (await loadAlerts()).feed.filter((f) => !f.kind && Date.now() - f.at < 24 * 3_600_000);
  if (!coins.length) return [];
  const picks = Array.from({ length: Math.min(3, coins.length) }, (_, i) => coins[(sweepAt + i) % coins.length]);
  sweepAt += picks.length;
  const seen = await Promise.all(picks.map(async (f) => ({ id: f.id, lc: await handlers.larpcheck({ address: f.coin.address }).catch(() => null) })));
  return withAlerts(async (a) => {
    const added = [];
    for (const { id, lc } of seen) {
      const f = a.feed.find((x) => x.id === id);
      if (!f || !lc?.checked || f.larp?.word === lc.verdict) continue;
      const larp = { by: 'Larpcheck', word: lc.verdict, score: lc.score ?? null, url: lc.url || lc.page || null };
      if (verdictTurned(f.larp?.word, lc.verdict)) added.push({ ...f, id: `${f.id}:${lc.verdict}`, kind: 'verdict', at: Date.now(), larp });
      f.larp = larp;
    }
    const fresh = added.filter((n) => !a.feed.some((x) => x.id === n.id));
    a.feed = [...fresh, ...a.feed].slice(0, 30);
    a.unread += fresh.length;
    if (fresh.length) showBadge(a.unread);
    return fresh;
  });
}

// One pass over every watch. Searches and checks run outside the queue; only the bookkeeping waits in it.
let checking = false;
async function runAlertChecks() {
  if (checking) return;
  checking = true;
  try {
    const live = (await loadAlerts()).watches.filter((w) => w.until > Date.now());
    if (!live.length) {
      await withAlerts(async (a) => { a.watches = []; });
      await ext.alarms.clear(ALARM);
      return;
    }
    const { chains } = await settings();
    const results = [];
    for (const w of live) {
      const r = await checkWatch(w, { chains }).catch(() => null);
      if (!r) continue;
      const items = [];
      for (const h of r.hits) {
        const [larp, holders] = await Promise.all([alertLarp(w, h.coin, h.tie), alertHolders(h.coin)]);
        items.push({ id: `${w.id}:${h.coin.address}`, at: Date.now(), watch: publicWatch(w), coin: h.coin, tie: h.tie, larp, holders, buy: buyUrl(h.coin), chart: chartUrl(h.coin) });
      }
      results.push({ id: w.id, seen: r.seen, items });
    }
    const fresh = await withAlerts(async (a) => {
      const added = [];
      for (const r of results) {
        const w = a.watches.find((x) => x.id === r.id);
        if (!w) continue; // stopped while it was being checked
        w.seen = [...new Set([...(w.seen || []), ...r.seen])].slice(-400);
        w.primed = true;
        for (const item of r.items) if (!a.feed.some((f) => f.id === item.id)) added.push(item);
      }
      a.watches = a.watches.filter((w) => w.until > Date.now());
      a.feed = [...added, ...a.feed].slice(0, 30);
      a.unread += added.length;
      if (added.length) showBadge(a.unread);
      return added;
    });
    for (const item of fresh) await notify(item);
    for (const item of await sweepVerdicts()) await notify(item);
  } finally {
    checking = false;
  }
}
ext.alarms.onAlarm.addListener((alarm) => { if (alarm.name === ALARM) runAlertChecks(); });
// A browser update or restart can clear alarms, and only a new watch makes this one, so running watches would stop in silence.
ext.alarms.get(ALARM).then((a) => a || loadAlerts().then((x) => x.watches.length && ext.alarms.create(ALARM, { periodInMinutes: 1 }))).catch(() => {});

// Radar Guard: every few minutes, one look at each starred coin, for holders. Its alarm is left alone once set, because setting
// it again would restart the wait each time the worker wakes.
const GUARD_ALARM = 'radar-guard';
const GUARD_ON = 'radar-guard-on';
const HOLDER_PAGE = 'https://tryradar.fun/holder';
ext.alarms.get(GUARD_ALARM).then((a) => a || ext.alarms.create(GUARD_ALARM, { periodInMinutes: GUARD_MINUTES })).catch(() => {});
const postIsGone = async (url) => {
  const id = statusOf(url);
  if (!id) return null;
  const res = await fetch(`${API_BASE}/post-gone?id=${id}`, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
  return res?.ok ? (await res.json()).gone === true : null;
};
let guarding = false;
async function runGuard() {
  if (guarding) return;
  guarding = true;
  try {
    const stars = await handlers.starList();
    const wasOn = (await ext.storage.local.get(GUARD_ON))[GUARD_ON];
    if (!(await handlers.holderActive())) {
      // The holder check lasts a day. Guard stopping must never look like nothing happening, so it says so, once.
      if (!wasOn) return;
      await ext.storage.local.set({ [GUARD_ON]: false });
      if (!stars.length) return;
      const item = { id: `guard:paused:${Date.now()}`, at: Date.now(), kind: 'guard', text: 'Radar Guard has paused. Check your wallet again to keep it on.', watch: { url: HOLDER_PAGE, author: '', label: 'Radar Guard' }, coin: { symbol: 'RADAR', name: 'Holder check' }, larp: null, holders: null, buy: null, chart: HOLDER_PAGE };
      await withAlerts(async (a) => { a.feed = [item, ...a.feed].slice(0, 30); a.unread += 1; showBadge(a.unread); });
      await notify(item);
      return;
    }
    if (!wasOn) await ext.storage.local.set({ [GUARD_ON]: true });
    if (!stars.length) return;
    const was = (await ext.storage.local.get(GUARD_KEY))[GUARD_KEY] || {};
    const fresh = await handlers.refresh({ tokens: stars.map((s) => ({ chain: s.chain, address: s.address })) }).then((r) => r.tokens).catch(() => ({}));
    const state = {};
    const items = [];
    for (const star of stars) {
      const live = fresh[star.address] || null;
      const [lc, gone] = await Promise.all([
        handlers.larpcheck({ address: star.address }).catch(() => null),
        star.post ? postIsGone(star.post) : null,
      ]);
      const look = lookAtStar(star, { live, lc, gone }, was[star.address]);
      state[star.address] = look.state;
      for (const e of look.events) {
        const coin = live ? coinOf(live) : { address: star.address, chain: star.chain, symbol: star.symbol, name: star.name, marketCap: star.cap };
        const larp = lc?.checked ? { by: 'Larpcheck', word: lc.verdict, score: lc.score ?? null, url: lc.url || lc.page || null } : null;
        // No buy button here: an alert that something went wrong shouldn't offer one.
        items.push({ id: `guard:${star.address}:${e.reason}:${e.word || ''}`, at: Date.now(), kind: e.reason === 'verdict' ? 'verdict' : 'guard', text: e.text || '', watch: { url: star.post || chartUrl(coin), author: '', label: `$${star.symbol}` }, coin, larp, holders: null, buy: null, chart: chartUrl(coin) });
      }
    }
    await ext.storage.local.set({ [GUARD_KEY]: state });
    if (!items.length) return;
    const added = await withAlerts(async (a) => {
      const newOnes = items.filter((i) => !a.feed.some((f) => f.id === i.id));
      a.feed = [...newOnes, ...a.feed].slice(0, 30);
      a.unread += newOnes.length;
      if (newOnes.length) showBadge(a.unread);
      return newOnes;
    });
    for (const item of added) await notify(item);
  } finally {
    guarding = false;
  }
}
ext.alarms.onAlarm.addListener((alarm) => { if (alarm.name === GUARD_ALARM) runGuard().catch(() => {}); });

// Big account alerts: once a minute, for holders, what the account watcher has flagged since the last look.
const SIGNAL_ALARM = 'radar-signals';
const SIGNAL_SINCE = 'signalSince';
ext.alarms.get(SIGNAL_ALARM).then((a) => a || ext.alarms.create(SIGNAL_ALARM, { periodInMinutes: 1 })).catch(() => {});
async function runSignals() {
  const got = await ext.storage.local.get(['radarHolder', BIG_KEY, DH_KEY, SIGNAL_SINCE]);
  const holder = got.radarHolder;
  if (!(holder?.token && holder.exp > Date.now())) return;
  if (got[DH_KEY] !== false) await runMyWallets().catch(() => {});
  const big = got[BIG_KEY] !== false;
  const diamond = got[DH_KEY] !== false;
  if (!big && !diamond) return;
  // The first look starts from now, so turning it on doesn't bring up the last hour.
  if (!got[SIGNAL_SINCE]) { await ext.storage.local.set({ [SIGNAL_SINCE]: Date.now() }); return; }
  const res = await fetch(`${API_BASE}/signals`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: holder.token, since: got[SIGNAL_SINCE] }), signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!res?.ok) return;
  const all = (await res.json().catch(() => ({}))).items || [];
  if (!all.length) return;
  // Diamond Hand rows and big account posts each have their own switch.
  const items = all.filter((s) => (s.kind === 'diamond' ? diamond : big));
  if (!items.length) { await ext.storage.local.set({ [SIGNAL_SINCE]: Math.max(...all.map((s) => s.at)) }); return; }
  const known = (await loadAlerts()).feed;
  const waiting = items.filter((s) => s.url && !known.some((f) => f.id === `signal:${s.id}`));
  // The scan takes a few seconds. If it can't finish, the alert still goes out, without coins.
  const fresh = await Promise.all(waiting.map(async (s) => {
    const found = await Promise.race([handlers.coins({ post: s.post || { text: s.text, author: s.author, url: s.url, images: [] } }), new Promise((r) => setTimeout(r, 20_000, null))]).catch(() => null);
    return { ...signalItem(s), coins: signalCoins(found) };
  }));
  const added = await withAlerts(async (a) => {
    const newOnes = fresh.filter((i) => !a.feed.some((f) => f.id === i.id));
    a.feed = [...newOnes, ...a.feed].slice(0, 30);
    a.unread += newOnes.length;
    if (newOnes.length) showBadge(a.unread);
    return newOnes;
  });
  // Only once they're saved: the browser can close during the scan, and a repeat is caught by the id check above.
  await ext.storage.local.set({ [SIGNAL_SINCE]: Math.max(...all.map((s) => s.at)) });
  for (const item of added.slice(0, 3)) await notify(item);
}

// Diamond Hand on the holder's own wallets: every 2 minutes, through Radar's relay. A buy of a coin launched in the last
// 6 hours is an alert. The list never leaves this browser.
const relay = async (method, params) => {
  const r = await fetch(`${API_BASE}/rpc`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(15_000) });
  const j = await r.json().catch(() => null);
  if (!j || j.error) throw new Error(`${method} ${j?.error?.code || r.status}`);
  return j.result;
};
const launchOf = async (mint) => {
  const r = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${encodeURIComponent(mint)}`, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`DexScreener ${r.status}`);
  return launchFromPairs(await r.json());
};
const myWalletItem = (wallet, b, now = Date.now()) => ({
  // One alert per wallet and coin, not per transaction: buying more of the same coin isn't news.
  id: `mine:${wallet.slice(0, 8)}:${b.mint}`,
  at: now,
  kind: 'signal',
  text: `Your wallet ${wallet.slice(0, 4)}…${wallet.slice(-4)} just bought $${b.symbol}, launched ${agoText(now - b.launched)} ago.`,
  watch: { url: `https://dexscreener.com/solana/${b.mint}`, author: 'Diamond Hand', label: `$${b.symbol}` },
  coin: { symbol: b.symbol, name: `$${b.symbol}` },
  larp: null,
  holders: null,
  buy: null,
  coins: [{ address: b.mint, symbol: b.symbol, chain: 'solana', marketCap: b.marketCap || 0, label: 'Bought' }],
  chart: `https://dexscreener.com/solana/${b.mint}`,
});
async function runMyWallets(now = Date.now()) {
  const got = await ext.storage.local.get([MY_WALLETS, MY_WALLETS_AT]);
  const mine = got[MY_WALLETS] || [];
  if (!mine.length || now - (got[MY_WALLETS_AT] || 0) < 110_000) return;
  await ext.storage.local.set({ [MY_WALLETS_AT]: now });
  const items = [];
  const next = [];
  for (const w of mine) {
    const look = await lookAt(w.address, w.last, { rpc: relay, launchOf, now }).catch(() => ({ last: w.last, buys: [] }));
    next.push({ address: w.address, last: look.last });
    items.push(...look.buys.map((b) => myWalletItem(w.address, b, now)));
  }
  // Kept only for wallets still on the list: one removed meanwhile stays removed.
  const latest = (await ext.storage.local.get(MY_WALLETS))[MY_WALLETS] || [];
  await ext.storage.local.set({ [MY_WALLETS]: latest.map((w) => next.find((n) => n.address === w.address) || w) });
  if (!items.length) return;
  const added = await withAlerts(async (a) => {
    const newOnes = items.filter((i) => !a.feed.some((f) => f.id === i.id));
    a.feed = [...newOnes, ...a.feed].slice(0, 30);
    a.unread += newOnes.length;
    if (newOnes.length) showBadge(a.unread);
    return newOnes;
  });
  for (const item of added.slice(0, 3)) await notify(item);
}
ext.alarms.onAlarm.addListener((alarm) => { if (alarm.name === SIGNAL_ALARM) runSignals().catch(() => {}); });
// The badge lives in memory only: put it back when the worker starts again.
loadAlerts().then((a) => showBadge(a.unread)).catch(() => {});

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
