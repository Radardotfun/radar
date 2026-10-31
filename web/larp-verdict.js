// Larpcheck's verdict on the coin, shown on the buy pages. Display only: it never blocks or changes a buy. Their terms: name
// Larpcheck, link the verdict to its check, never reword it.
(async () => {
  const box = document.getElementById('lc-verdict');
  const params = new URLSearchParams(location.search);
  const address = (params.get('mint') || params.get('token') || '').trim();
  if (!box || !/^([1-9A-HJ-NP-Za-km-z]{32,44}|0x[0-9a-fA-F]{40})$/.test(address)) return;
  const onSite = (u) => /^https:\/\/larpcheck\.app\//.test(u || '');
  const risk = new Set(['LIKELY LARP', 'LARP', 'SCAM']);
  const good = new Set(['REAL', 'LIKELY REAL']);
  let lc;
  try {
    const r = await fetch(`https://narrative-radar.millenia-portfolio.workers.dev/larpcheck?address=${encodeURIComponent(address)}`, { signal: AbortSignal.timeout(10000) });
    lc = await r.json();
  } catch { return; }
  if (!lc || lc.off) return;
  const title = box.querySelector('b');
  const text = box.querySelector('p');
  const link = box.querySelector('a');
  if (lc.checked && onSite(lc.url)) {
    const n = lc.total ?? lc.score;
    title.textContent = `Larpcheck: ${lc.verdict}${n == null ? '' : ` ${n}`}`;
    text.textContent = lc.call || lc.headline || '';
    link.href = lc.url;
    link.textContent = 'Full report ↗';
    box.classList.toggle('bad', risk.has(lc.verdict));
    box.classList.toggle('good', good.has(lc.verdict));
  } else if (onSite(lc.page)) {
    title.textContent = 'Not on Larpcheck yet';
    text.textContent = '';
    link.href = lc.page;
    link.textContent = 'Check it on Larpcheck ↗';
  } else return;
  box.hidden = false;
})();
