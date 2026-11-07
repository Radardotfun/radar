// tryradar.fun/track: Radar's public track record (server/track.js), 30 minutes behind. Refreshes every 2 minutes.
(() => {
  const API = 'https://narrative-radar.millenia-portfolio.workers.dev';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const usd = (n) => (!n ? '$0' : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}K` : `$${Math.round(n)}`);
  const x = (n) => `${n >= 10 ? Math.round(n) : Number(n).toFixed(1)}x`;
  const ago = (t) => { const m = Math.max(1, Math.round((Date.now() - t) / 60000)); return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };

  // Sorts: best peak first (the default), newest flag first, or best now vs flagged first. The choice stays in the link, so a sorted view can be shared.
  const SORTS = {
    peak: { note: 'Sorted by peak', by: (a, b) => b.peakX - a.peakX || b.at - a.at },
    new: { note: 'Newest first', by: (a, b) => b.at - a.at },
    now: { note: 'Sorted by now vs flagged', by: (a, b) => b.nowX - a.nowX || b.peakX - a.peakX },
  };
  const q = new URLSearchParams(location.search);
  let hours = q.get('hours') === '72' ? 72 : 24;
  let sort = Object.hasOwn(SORTS, q.get('sort') || '') ? q.get('sort') : 'peak';
  let timer = null, last = null, updated = '';

  const press = (attr, value) => document.querySelectorAll(`[${attr}]`).forEach((o) => o.setAttribute('aria-pressed', String(o.getAttribute(attr) === String(value))));
  function keepInLink() {
    const u = new URL(location.href);
    if (sort === 'peak') u.searchParams.delete('sort'); else u.searchParams.set('sort', sort);
    if (hours === 24) u.searchParams.delete('hours'); else u.searchParams.set('hours', String(hours));
    history.replaceState(null, '', u.pathname + u.search + u.hash);
  }

  function render() {
    if (!last) return;
    const flags = last.summary?.flags || 0;
    const cut = flags > (last.rows || []).length ? ` Showing ${(last.rows || []).length} of ${flags}: the newest and the best.` : '';
    $('tr-note').textContent = `${SORTS[sort].note}. Updated ${updated}.${cut}`;
    const rows = [...(last.rows || [])].sort(SORTS[sort].by);
    const big = (r) => (sort === 'now' ? r.nowX : r.peakX);
    $('tr-empty').hidden = rows.length > 0;
    $('tr-list').innerHTML = rows.map((r) => `<a class="tr-row" href="https://dexscreener.com/solana/${encodeURIComponent(r.mint)}" target="_blank" rel="noopener">
          <b>$${esc(r.symbol)}${r.name && r.name !== r.symbol ? ` <small style="display:inline;font-weight:500">${esc(r.name)}</small>` : ''}</b><em class="${big(r) >= 2 ? 'up' : ''}">${esc(x(big(r)))}${sort === 'now' ? ' now' : ''}</em>
          <span>Flagged at ${esc(usd(r.mc0))} · peak ${esc(usd(r.peak))} (${esc(x(r.peakX))}) · now ${esc(usd(r.mc))} (${esc(x(r.nowX))})</span>
          <small>${r.story ? `Breaking now: ${esc(r.story)} · ` : ''}flagged ${esc(ago(r.at))}</small></a>`).join('');
  }

  async function load() {
    clearTimeout(timer);
    try {
      const r = await fetch(`${API}/track-record?hours=${hours}`, { signal: AbortSignal.timeout(12000) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || r.status);
      const s = d.summary || {};
      $('tr-flags').textContent = s.flags ?? 0;
      $('tr-x2').textContent = s.flags ? `${s.x2} · ${Math.round((s.x2 / s.flags) * 100)}%` : '0';
      $('tr-x10').textContent = s.flags ? `${s.x10} · ${Math.round((s.x10 / s.flags) * 100)}%` : '0';
      $('tr-error').hidden = true;
      last = d;
      updated = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      render();
    } catch {
      $('tr-error').hidden = false;
      $('tr-note').textContent = '';
    }
    timer = setTimeout(load, 120_000);
  }

  document.querySelectorAll('[data-hours]').forEach((b) => b.addEventListener('click', () => {
    hours = Number(b.dataset.hours);
    press('data-hours', hours);
    keepInLink();
    load();
  }));
  document.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => {
    sort = b.dataset.sort;
    press('data-sort', sort);
    keepInLink();
    render();
  }));
  press('data-hours', hours);
  press('data-sort', sort);
  load();
})();
