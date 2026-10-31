// tryradar.fun/launched: the coins launched with Radar, with live market caps from DexScreener.
(async () => {
  const API = 'https://narrative-radar.millenia-portfolio.workers.dev';
  const box = document.getElementById('launched-list');
  const money = (n) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : n ? `$${Math.round(n)}` : 'no market yet');
  const ago = (ms) => {
    const m = (Date.now() - ms) / 60000;
    if (m < 60) return `${Math.max(1, Math.round(m))}m ago`;
    if (m < 1440) return `${Math.round(m / 60)}h ago`;
    return `${Math.round(m / 1440)}d ago`;
  };
  const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
  const say = (text) => box.replaceChildren(el('p', { className: 'field-help', textContent: text }));
  let coins;
  try {
    coins = (await (await fetch(`${API}/launch/list`, { signal: AbortSignal.timeout(10000) })).json()).coins || [];
  } catch { return say('Could not load the list. Try again in a moment.'); }
  if (!coins.length) return say('No coins have been launched with Radar yet.');
  const caps = new Map();
  for (let i = 0; i < coins.length; i += 30) {
    try {
      const addrs = coins.slice(i, i + 30).map((c) => c.mint).join(',');
      const pairs = await (await fetch(`https://api.dexscreener.com/tokens/v1/solana/${addrs}`, { signal: AbortSignal.timeout(10000) })).json();
      for (const p of pairs) caps.set(p.baseToken?.address, Math.max(caps.get(p.baseToken?.address) || 0, p.marketCap || 0));
    } catch {}
  }
  box.replaceChildren(...coins.map((c) => el('article', { className: 'launched-row' },
    el('img', { src: `${API}/launch/meta/${encodeURIComponent(c.id)}.jpg`, width: 44, height: 44, alt: '', loading: 'lazy' }),
    el('div', { className: 'launched-name' }, el('b', { textContent: c.name }), el('span', { textContent: `$${c.symbol} · ${money(caps.get(c.mint))} · ${ago(c.at)}` })),
    el('div', { className: 'launched-actions' },
      el('a', { href: `/scan?url=${encodeURIComponent(c.post)}`, textContent: 'Scan the post' }),
      el('a', { href: `https://pump.fun/coin/${encodeURIComponent(c.mint)}`, target: '_blank', rel: 'noopener noreferrer', textContent: 'pump.fun' })))));
})();
