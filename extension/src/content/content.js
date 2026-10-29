// Radar — X integration: Radar and an explicit Instant Reroute action on every post.
(() => {
  // Marked on the shared DOM, so the extension and the userscript never both run on one page.
  if (document.documentElement.hasAttribute('data-narrative-radar')) return;
  document.documentElement.setAttribute('data-narrative-radar', globalThis.__nrHost ? 'userscript' : 'extension');

  // The extension's messaging and storage, or the userscript's stand-ins (set before this runs).
  const ext = globalThis.browser ?? globalThis.chrome; // Firefox's promise-based API, else Chrome's
  const host = globalThis.__nrHost || {
    send: (msg) => ext.runtime.sendMessage(msg),
    get: (key) => ext.storage.local.get(key).then((r) => r[key]),
    set: (key, value) => ext.storage.local.set({ [key]: value }),
    radar: () => import(ext.runtime.getURL('src/ui/radar.js')),
  };
  let radar = null;
  const getRadar = () => (radar ||= host.radar().then((m) => m.mountFloating()));

  // The Radar mark: the "d" from the wordmark, redrawn on a 16px grid so it stays crisp (scripts/pixel-icon.py).
  const ICON = `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true"><path d="M7 0h5v1h-5zM7 1h5v1h-5zM7 2h5v1h-5zM3 3h10v1h-10zM2 4h12v1h-12zM1 5h4v1h-4zM11 5h4v1h-4zM1 6h3v1h-3zM5 6h1v1h-1zM11 6h4v1h-4zM1 7h2v1h-2zM10 7h2v1h-2zM13 7h2v1h-2zM1 8h2v1h-2zM9 8h2v1h-2zM13 8h2v1h-2zM1 9h2v1h-2zM7 9h3v1h-3zM13 9h2v1h-2zM1 10h2v1h-2zM7 10h2v1h-2zM13 10h2v1h-2zM1 11h2v1h-2zM5 11h1v1h-1zM11 11h1v1h-1zM13 11h2v1h-2zM1 12h3v1h-3zM12 12h3v1h-3zM2 13h12v1h-12zM3 14h10v1h-10z"/></svg>`;

  const css = document.createElement('style');
  css.textContent = `
    .nr-btn{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;margin:0 2px;border-radius:999px;border:0;background:transparent;color:rgb(113,118,123);cursor:pointer;transition:background .2s,color .2s;flex:none}
    .nr-btn:hover{background:rgba(127,127,127,.15);color:inherit}
    .nr-btn.nr-trend{position:absolute;right:44px;top:50%;transform:translateY(-50%);width:30px;height:30px;opacity:0;transition:opacity .15s,background .2s,color .2s;z-index:2}
    [data-testid="trend"]{position:relative}
    [data-testid="trend"]:hover .nr-btn.nr-trend,.nr-btn.nr-trend:focus-visible{opacity:1}
    .nr-fab{position:fixed;right:24px;bottom:150px;z-index:2147482000;width:48px;height:48px;padding:0;display:flex;align-items:center;justify-content:center;border-radius:999px;border:1px solid rgba(255,255,255,.1);
      background:#000;color:#fff;box-shadow:0 10px 40px rgba(0,0,0,.35);cursor:pointer;transition:transform .2s cubic-bezier(.2,.8,.2,1),box-shadow .2s}
    .nr-fab:hover{transform:translateY(-2px);box-shadow:0 14px 48px rgba(0,0,0,.45)}
    .nr-fab svg{width:24px;height:24px}
    @media (max-width:700px){.nr-fab{bottom:calc(150px + env(safe-area-inset-bottom))}}
    .nr-ca{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0 2px}
    .nr-ca-btn{display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 12px 0 9px;border-radius:999px;border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;
      font:700 13px/1 TwitterChirp,-apple-system,"Segoe UI",system-ui,sans-serif;cursor:pointer;transition:background .15s,border-color .15s}
    .nr-ca-btn:hover{background:rgba(127,127,127,.12);border-color:rgba(127,127,127,.6)}
    .nr-ca-btn svg{width:16px;height:16px;opacity:.75}
    .nr-ca-btn span{font-weight:500;opacity:.65;font-variant-numeric:tabular-nums}
    .nr-action-wrap{display:flex;align-items:center;justify-content:flex-start;position:relative;flex:none;gap:2px}
    .nr-reroute-btn{display:inline-flex;align-items:center;justify-content:center;height:30px;margin:0 2px;padding:0 8px;border:1px solid rgba(127,127,127,.35);border-radius:999px;background:transparent;color:rgb(113,118,123);cursor:pointer;white-space:nowrap;font:600 11px/1 TwitterChirp,-apple-system,"Segoe UI",system-ui,sans-serif;transition:background .2s,color .2s,border-color .2s}
    .nr-reroute-btn:hover{background:rgba(127,127,127,.15);border-color:rgba(127,127,127,.6);color:inherit}
    .nr-hint{position:absolute;bottom:calc(100% + 10px);right:-6px;z-index:30;display:flex;align-items:center;gap:12px;padding:10px 10px 10px 14px;border-radius:14px;background:#000;color:#fff;
      border:1px solid rgba(255,255,255,.16);box-shadow:0 12px 40px rgba(0,0,0,.4);font:600 13px/1.2 TwitterChirp,-apple-system,"Segoe UI",system-ui,sans-serif;white-space:nowrap;animation:nr-in .35s cubic-bezier(.2,.8,.2,1)}
    .nr-hint::after{content:"";position:absolute;top:100%;right:17px;border:6px solid transparent;border-top-color:#000}
    .nr-hint button{all:unset;cursor:pointer;padding:6px 10px;border-radius:999px;background:#fff;color:#000;font-weight:700;font-size:12px}
    @keyframes nr-in{from{opacity:0;transform:translateY(6px)}}`;
  document.documentElement.appendChild(css);

  const textOf = (el) => (el?.innerText || '').trim();
  const send = (msg) => host.send(msg).then((r) => (r?.ok ? r.data : Promise.reject(new Error(r?.error || 'No response'))));
  const usd = (n) => (!Number.isFinite(n) ? '' : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${Math.round(n)}`);
  const ageOf = (ms) => {
    if (!ms) return '';
    const m = (Date.now() - ms) / 60_000;
    return m < 60 ? `${Math.max(1, Math.round(m))}m` : m < 1440 ? `${Math.round(m / 60)}h` : m < 43_200 ? `${Math.round(m / 1440)}d` : m < 525_600 ? `${Math.round(m / 43_200)}mo` : `${(m / 525_600).toFixed(1)}y`;
  };
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Everything the narrative engine reads: text, quoted post, link-card headline, images, URL.
  const handleOf = (article) => [...article.querySelectorAll('[data-testid="User-Name"] a[href^="/"]')]
    .map((a) => a.getAttribute('href').slice(1)).find((h) => h && !h.includes('/')) || '';

  // "Replying to @a @b" under the author line.
  function replyHandles(article) {
    const block = [...article.querySelectorAll('div')].find((d) => d.childElementCount <= 12 && /^Replying to\b/.test(textOf(d)));
    if (!block) return [];
    return [...new Set([...block.querySelectorAll('a[href^="/"]')].map((a) => a.getAttribute('href').slice(1)).filter((h) => /^\w+$/.test(h)))].slice(0, 4);
  }

  function postPayload(article) {
    const texts = [...article.querySelectorAll('[data-testid="tweetText"]')].map(textOf);
    const card = article.querySelector('[data-testid="card.wrapper"]');
    const cardText = card ? textOf(card).split('\n').filter((l) => l.length > 12 && !/^\S+\.\S+$/.test(l)).join('. ') : '';
    const handle = handleOf(article);
    const nameEl = article.querySelector('[data-testid="User-Name"] a[href^="/"] span');
    const authorName = nameEl ? textOf(nameEl).slice(0, 60) : '';
    const replyTo = replyHandles(article);
    // In a thread the post being replied to is rendered as the article right above this one.
    const all = [...document.querySelectorAll('article[data-testid="tweet"]')];
    const prev = all[all.indexOf(article) - 1];
    const prevHandle = prev ? handleOf(prev) : '';
    const parentEl = prev && replyTo.includes(prevHandle) ? prev.querySelector('[data-testid="tweetText"]') : null;
    const parent = parentEl ? textOf(parentEl) : '';
    const statusHref = article.querySelector('a[href*="/status/"] time')?.closest('a')?.getAttribute('href') || '';
    const url = /^\/\w+\/status\/\d+/.test(statusHref) ? `https://x.com${statusHref.match(/^\/\w+\/status\/\d+/)[0]}` : '';
    const images = [...article.querySelectorAll('[data-testid="tweetPhoto"] img, [data-testid="card.wrapper"] img')]
      .map((img) => img.src).filter((src) => /^https:\/\/pbs\.twimg\.com\/(media|card_img|amplify_video_thumb|ext_tw_video_thumb)\//.test(src))
      .slice(0, 2);
    const hasVideo = !!article.querySelector('[data-testid="videoPlayer"], [data-testid="videoComponent"], video');
    const poster = article.querySelector('video[poster]')?.getAttribute('poster');
    if (hasVideo && poster && /^https:\/\/pbs\.twimg\.com\//.test(poster) && !images.includes(poster)) images.unshift(poster);
    const post = {
      text: texts[0] || '', quoted: texts.slice(1).join('\n'), card: cardText, author: handle, authorName, replyTo,
      parent: parent.slice(0, 1500), parentAuthor: parent ? prevHandle : '', url, images: images.slice(0, 2), hasVideo,
    };
    const label = (post.text || post.quoted || post.card || (hasVideo ? 'Video post' : images.length ? 'Image post' : '')).replace(/\s+/g, ' ').slice(0, 90);
    const kind = handle ? `@${handle}${replyTo.length ? ` → @${replyTo[0]}` : ''}` : 'Post';
    return { post, source: { kind, label } };
  }

  function trendPayload(cell) {
    const lines = textOf(cell).split('\n').map((l) => l.trim()).filter(Boolean);
    const main = lines.filter((l) => !/(^\d[\d.,]*[KM]?\s+posts?$)|trending|^·$|^\d+$|only on x|^show more$/i.test(l))
      .sort((a, b) => b.length - a.length)[0] || lines[0] || '';
    return { post: { text: `Trending on X: ${main}` }, text: main, source: { kind: 'Trend', label: main } };
  }

  function sidebarTrends() {
    return [...document.querySelectorAll('[data-testid="trend"]')].slice(0, 8)
      .map((c) => trendPayload(c).text).filter((t) => t && t.length < 60);
  }

  async function launch(payload) {
    dismissHint();
    const r = await getRadar();
    r.open({ ...payload, trends: sidebarTrends() });
  }

  let routeToast = null;
  function toast(message) {
    if (!routeToast) {
      routeToast = document.createElement('div');
      routeToast.setAttribute('role', 'status');
      routeToast.setAttribute('aria-live', 'polite');
      routeToast.style.cssText = 'position:fixed;right:24px;bottom:210px;z-index:2147483647;padding:12px 16px;border:1px solid rgba(255,255,255,.16);border-radius:12px;background:#171717;color:#fff;font:600 13px/1.4 system-ui,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,.35);max-width:300px';
      document.documentElement.appendChild(routeToast);
    }
    routeToast.textContent = message;
    routeToast.style.display = 'block';
    clearTimeout(routeToast.hideTimer);
    routeToast.hideTimer = setTimeout(() => { if (routeToast) routeToast.style.display = 'none'; }, 4200);
  }
  // One reroute at a time, so a double click never opens two coins.
  let routing = false;
  async function reroute(payload) {
    dismissHint();
    if (routing) return;
    routing = true;
    toast('Checking the coins on this post…');
    try {
      const r = await getRadar();
      const result = await r.route(payload.post);
      toast(`Opening $${result.symbol} · ${result.reason}${result.holders ? ` · ${result.holders.toLocaleString('en-US')} holders` : ''}`);
    } catch (error) {
      // Say why, then show the full results so the user can decide.
      toast(`${error.message}. Opening Radar…`);
      await launch(payload);
    } finally {
      routing = false;
    }
  }

  function makeBtn(cls, label, onClick, onHover) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `nr-btn ${cls}`;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.innerHTML = ICON;
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onClick(); }, true);
    // Hovering the button starts the scan early, so the click lands on a warm result.
    if (onHover) {
      let timer = null;
      // A short pause on the button signals intent; skimming past doesn't spend AI allowance.
      b.addEventListener('pointerenter', () => { if (!b.dataset.pre) timer = setTimeout(() => { b.dataset.pre = '1'; onHover(); }, 300); });
      b.addEventListener('pointerleave', () => clearTimeout(timer));
    }
    return b;
  }

  function makeRerouteBtn(onClick, onHover) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'nr-reroute-btn';
    b.textContent = 'Instant Reroute';
    b.title = 'Open the biggest coin on this post with real holders and no rug flags';
    b.setAttribute('aria-label', 'Instant Reroute');
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onClick(); }, true);
    if (onHover) {
      let timer = null;
      b.addEventListener('pointerenter', () => { if (!b.dataset.pre) timer = setTimeout(() => { b.dataset.pre = '1'; onHover(); }, 300); });
      b.addEventListener('pointerleave', () => clearTimeout(timer));
    }
    return b;
  }

  // A coin whose CA is written in the post gets a line under it straight away, no AI wait.
  const CA_RE = /\b(?:[1-9A-HJ-NP-Za-km-z]{32,44}|0x[a-fA-F0-9]{40})\b/;
  const postText = (article) => [...article.querySelectorAll('[data-testid="tweetText"]')].map(textOf).join('\n');
  const caWatch = new IntersectionObserver((entries) => {
    for (const { target, isIntersecting } of entries) {
      if (!isIntersecting) continue;
      caWatch.unobserve(target);
      caLine(target);
    }
  }, { rootMargin: '300px 0px' });

  async function caLine(article) {
    const coins = await send({ type: 'mentioned', text: postText(article) }).catch(() => []);
    const groups = article.querySelectorAll('[role="group"]');
    const group = groups[groups.length - 1];
    if (!coins.length || !group || article.querySelector('.nr-ca')) return;
    const line = document.createElement('div');
    line.className = 'nr-ca';
    line.style.color = getComputedStyle(article.querySelector('[data-testid="tweetText"]') || article).color;
    line.innerHTML = coins.slice(0, 2).map((t) => `<button type="button" class="nr-ca-btn" title="Open ${esc(t.name)} in Radar">${ICON}$${esc(t.symbol)}<span>${[usd(t.marketCap), ageOf(t.createdAt)].filter(Boolean).join(' · ')}</span></button>`).join('');
    line.addEventListener('click', (e) => {
      if (!e.target.closest('.nr-ca-btn')) return;
      e.preventDefault();
      e.stopPropagation();
      reroute(postPayload(article));
    }, true);
    group.parentElement.insertBefore(line, group);
  }

  // First run: one tip pointing at the radar button, until it's dismissed or the radar is used.
  const hint = { state: 'unknown', el: null };
  host.get('hintSeen')
    .then((seen) => { hint.state = seen ? 'seen' : 'show'; decorateSoon(); })
    .catch(() => { hint.state = 'seen'; });
  function dismissHint() {
    if (hint.state === 'seen') return;
    hint.state = 'seen';
    hint.el?.remove();
    Promise.resolve(host.set('hintSeen', true)).catch(() => {});
  }
  function maybeHint(wrap) {
    if (hint.state !== 'show' || hint.el?.isConnected) return;
    const r = wrap.getBoundingClientRect();
    if (r.top < 120 || r.bottom > innerHeight - 40) return; // only on a button that's on screen
    const el = document.createElement('div');
    el.className = 'nr-hint';
    el.innerHTML = '<span>Tap to see the coins behind this post</span><button type="button">Got it</button>';
    el.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); dismissHint(); }, true);
    wrap.appendChild(el);
    hint.el = el;
  }

  function decorate() {
    for (const article of document.querySelectorAll('article[data-testid="tweet"]:not([data-nr])')) {
      // The action bar is the last group in the post (quoted posts have none).
      const groups = article.querySelectorAll('[role="group"]');
      const group = groups[groups.length - 1];
      if (!group) continue;
      article.dataset.nr = '1';
      const btn = makeBtn('', 'Open Radar for this post', () => launch(postPayload(article)),
        () => getRadar().then((r) => r.prefetch(postPayload(article).post)).catch(() => {}));
      const rerouteBtn = makeRerouteBtn(() => reroute(postPayload(article)),
        () => getRadar().then((r) => r.prefetch(postPayload(article).post)).catch(() => {}));
      const wrap = document.createElement('div');
      wrap.className = 'nr-action-wrap';
      wrap.appendChild(rerouteBtn);
      wrap.appendChild(btn);
      const share = group.lastElementChild;
      group.insertBefore(wrap, share);
      if (CA_RE.test(postText(article))) caWatch.observe(article);
    }
    if (hint.state === 'show' && !hint.el?.isConnected) {
      for (const b of document.querySelectorAll('article[data-testid="tweet"] .nr-btn')) {
        maybeHint(b.parentElement);
        if (hint.el?.isConnected) break;
      }
    }
    for (const cell of document.querySelectorAll('[data-testid="trend"]:not([data-nr])')) {
      cell.dataset.nr = '1';
      cell.appendChild(makeBtn('nr-trend', 'Jump to the biggest verified coin for this trend', () => reroute(trendPayload(cell))));
    }
    // X News story pages: /i/trending/<id>
    if (/^\/i\/trending\/\d+/.test(location.pathname) && !document.querySelector('.nr-story')) {
      const h = document.querySelector('[data-testid="primaryColumn"] h2, [data-testid="primaryColumn"] [role="heading"]');
      if (h) fab.dataset.story = textOf(h);
    } else {
      delete fab.dataset.story;
    }
  }

  const fab = document.createElement('button');
  fab.className = 'nr-fab';
  fab.innerHTML = ICON;
  fab.title = 'Radar';
  fab.setAttribute('aria-label', 'Radar');
  fab.addEventListener('click', () => toggle());
  document.documentElement.appendChild(fab);

  async function toggle() {
    const r = await getRadar();
    if (r.isOpen) return r.close();
    if (fab.dataset.story) return launch({ post: { text: `X news story: ${fab.dataset.story}` }, source: { kind: 'Story', label: fab.dataset.story } });
    r.open({ trends: sidebarTrends() });
  }

  document.addEventListener('keydown', (e) => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyR') {
      const t = e.target;
      if (t?.isContentEditable || /INPUT|TEXTAREA/.test(t?.tagName)) return;
      e.preventDefault();
      toggle();
    }
  });

  let queued = false;
  function decorateSoon() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; decorate(); });
  }
  new MutationObserver(decorateSoon).observe(document.body, { childList: true, subtree: true });
  // The tip waits for a radar button that's actually on screen.
  addEventListener('scroll', () => { if (hint.state === 'show' && !hint.el?.isConnected) decorateSoon(); }, { passive: true });
  decorate();

  // Popup "open on page" requests.
  if (!globalThis.__nrHost) ext.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'open-radar') launch({ post: { text: msg.text || '' }, keywords: msg.keywords, source: msg.source });
  });
})();
