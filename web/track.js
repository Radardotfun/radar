// tryradar.fun/track: Radar's public track record (server/track.js), 30 minutes behind. Refreshes every 2 minutes.
(() => {
  const API = 'https://narrative-radar.millenia-portfolio.workers.dev';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const usd = (n) => (!n ? '$0' : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}K` : `$${Math.round(n)}`);
  const x = (n) => `${n >= 10 ? Math.round(n) : Number(n).toFixed(1)}x`;
  const ago = (t) => { const m = Math.max(1, Math.round((Date.now() - t) / 60000)); return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
  let hours = 24, timer = null;

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
      $('tr-note').textContent = `Sorted by peak. Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`;
      $('tr-error').hidden = true;
      const rows = [...(d.rows || [])].sort((a, b) => b.peakX - a.peakX || b.at - a.at);
      $('tr-empty').hidden = rows.length > 0;
      $('tr-list').innerHTML = rows.map((r) => `<a class="tr-row" href="https://dexscreener.com/solana/${encodeURIComponent(r.mint)}" target="_blank" rel="noopener">
          <b>$${esc(r.symbol)}${r.name && r.name !== r.symbol ? ` <small style="display:inline;font-weight:500">${esc(r.name)}</small>` : ''}</b><em class="${r.peakX >= 2 ? 'up' : ''}">${esc(x(r.peakX))}</em>
          <span>Flagged at ${esc(usd(r.mc0))} · peak ${esc(usd(r.peak))} · now ${esc(usd(r.mc))} (${esc(x(r.nowX))})</span>
          <small>${r.story ? `Breaking now: ${esc(r.story)} · ` : ''}flagged ${esc(ago(r.at))}</small></a>`).join('');
    } catch {
      $('tr-error').hidden = false;
      $('tr-note').textContent = '';
    }
    timer = setTimeout(load, 120_000);
  }
  document.querySelectorAll('[data-hours]').forEach((b) => b.addEventListener('click', () => {
    hours = Number(b.dataset.hours);
    document.querySelectorAll('[data-hours]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
    load();
  }));
  load();
})();
