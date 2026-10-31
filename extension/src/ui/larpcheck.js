// Larpcheck (larpcheck.app) verdicts in the panel. Their API terms: whenever a verdict is shown, say
// it's from Larpcheck and link it to its check, and never reword it or show it as Radar's own.
// `lc` is what our Worker's /larpcheck route returns: { checked, url, page, verdict, score, total,
// headline, call, stamps } or { checked: false, page }. Larpcheck gets the panel's one color: its yellow.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ext = (href, body, cls, title = '') => `<a class="${cls}" href="${esc(href)}" target="_blank" rel="noopener noreferrer"${title ? ` title="${esc(title)}"` : ''}>${body}</a>`;

export const lcTone = (word) => (['LIKELY LARP', 'LARP', 'SCAM'].includes(word) ? 'risk' : ['REAL', 'LIKELY REAL'].includes(word) ? 'ok' : 'mid');

const lcScore = (lc) => lc.total ?? lc.score;

// Verdict and the site's total score, as Larpcheck's own badge recipe shows them.
export function lcStamp(lc) {
  const n = lcScore(lc);
  return `<span class="verdict ${lcTone(lc.verdict)}">${esc(lc.verdict)}${n == null ? '' : ` <b>${n}</b>`}</span>`;
}

// The yellow button on a coin card, only when Larpcheck has a verdict on the coin; its headline on hover.
export function lcButtonHtml(lc) {
  if (!lc?.checked) return '';
  const n = lcScore(lc);
  return ext(lc.url, `<span class="lc-k">Larpcheck</span><b>${esc(lc.verdict)}${n == null ? '' : ` ${n}`}</b><span class="lc-go">↗</span>`, 'lc-btn', lc.headline || lc.call || '');
}

// The larp check box under the narrative, when the verdict is Larpcheck's.
export function lcStoryHtml(lc, { open, symbol, chevron, ask = '' }) {
  const stamps = (lc.stamps || []).filter((s) => s.word);
  return `<div class="story ${lcTone(lc.verdict)}">
      <button class="story-top" data-story aria-expanded="${open}">
        <span class="story-k">Larp check</span>${lcStamp(lc)}${chevron}
      </button>
      <div class="story-call">${esc(lc.call || lc.headline || '')}</div>
      ${open ? `${lc.call && lc.headline ? `<p class="lc-headline">${esc(lc.headline)}</p>` : ''}
        ${stamps.length ? `<ul class="findings">${stamps.map((s) => `<li><span>${esc(s.id)}</span>${esc(s.word)}${s.score == null ? '' : ` · ${s.score}`}</li>`).join('')}</ul>` : ''}` : ''}
      ${ask}
      <div class="lc-foot"><span>Verdict by <b>Larpcheck</b>${symbol ? ` on $${esc(symbol)}` : ''}</span>${ext(lc.url, 'Full report ↗', 'lc-btn')}</div>
    </div>`;
}

// Under Radar's own read, when Larpcheck hasn't checked the coin yet: send people to check it there.
export function lcCheckItHtml(page, symbol) {
  return page ? `<div class="lc-foot"><span>Radar's own read. Not on Larpcheck yet.</span>${ext(page, `Check ${symbol ? `$${esc(symbol)}` : 'it'} on Larpcheck ↗`, 'lc-btn')}</div>` : '';
}
