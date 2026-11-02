// For a page that needs a wallet, in a browser without one. On a phone: links that open this page in a wallet app's own browser. On a
// computer: a QR code that opens it on the phone. Built into web/wallet-open.js. The links are the wallets' documented browse links:
// https://docs.phantom.com/phantom-deeplinks/other-methods/browse and https://docs.solflare.com/solflare/technical/deeplinks/other-methods/browse
// Backpack's docs don't say where the page goes in its link, so it isn't here until one's been tried on a phone.
import qrcode from 'qrcode-generator';

const SITE = 'https://tryradar.fun';
const APPS = [
  ['Phantom', (url) => `https://phantom.com/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(SITE)}`],
  ['Solflare', (url) => `https://solflare.com/ul/v1/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(SITE)}`],
];

const CSS = `
.wo { display:grid; gap:12px; margin:14px 0 4px; padding:16px; border:1px solid var(--line,rgba(255,255,255,.12)); border-radius:14px; font-size:14px; line-height:1.45; }
.wo[hidden] { display:none; }
.wo b { display:block; font-weight:700; color:var(--text,#fff); }
.wo p { margin:0; color:var(--muted,#a3a0ad); }
.wo-apps { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.wo-app { display:flex; align-items:center; justify-content:center; min-height:46px; padding:0 10px; border-radius:12px; background:#5621ac; color:#fff; font-weight:700; font-size:14px; text-decoration:none; text-align:center; }
.wo-app:hover { background:#6a30c9; }
.wo-qr { width:184px; height:184px; padding:10px; box-sizing:border-box; border-radius:12px; background:#fff; justify-self:center; }
.wo-qr svg { display:block; width:100%; height:100%; }
.wo-note { font-size:12.5px; }
.wo-note a { color:inherit; text-underline-offset:3px; }
`;
const addStyle = () => {
  if (document.getElementById('wo-style')) return;
  const s = document.createElement('style');
  s.id = 'wo-style';
  s.textContent = CSS;
  document.head.append(s);
};

const isPhone = () => /Android|iPhone|iPod|iPad/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
const links = (url) => APPS.map(([name, make]) => ({ name, href: make(url) }));
const qrSvg = (text) => {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
};
const line = (tag, text, cls) => { const e = document.createElement(tag); e.textContent = text; if (cls) e.className = cls; return e; };
const getOne = () => {
  const p = document.createElement('p');
  p.className = 'wo-note';
  p.append('No wallet yet? Get ');
  APPS.forEach(([name], i) => {
    if (i) p.append(' or ');
    const a = document.createElement('a');
    a.href = name === 'Phantom' ? 'https://phantom.com/download' : 'https://solflare.com/download';
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = name;
    p.append(a);
  });
  p.append(' on your phone.');
  return p;
};

/** el: an empty element. phoneUrl: the page to open in the wallet's browser. qrUrl: the page the QR opens on a phone. The words come from the page. */
function mount(el, { phoneUrl = location.href, qrUrl = location.href, phoneTitle, phoneText, qrTitle, qrText }) {
  addStyle();
  el.classList.add('wo');
  el.hidden = false;
  el.replaceChildren();
  if (isPhone()) {
    el.append(line('b', phoneTitle), line('p', phoneText));
    const apps = document.createElement('div');
    apps.className = 'wo-apps';
    for (const { name, href } of links(phoneUrl)) {
      const a = line('a', `Open in ${name}`, 'wo-app');
      a.href = href;
      apps.append(a);
    }
    el.append(apps, getOne());
    return;
  }
  el.append(line('b', qrTitle), line('p', qrText));
  const box = document.createElement('div');
  box.className = 'wo-qr';
  box.innerHTML = qrSvg(qrUrl);
  el.append(box, getOne());
}

/** For pages that only need the wallet to be in the browser: shown once wallets have had time to add themselves, if none did. */
function watch({ el, hasWallet, ...words }) {
  // Some wallets add themselves to the page a moment after it loads.
  setTimeout(() => {
    if (el && !hasWallet()) mount(el, words);
  }, 900);
}

window.RadarWalletOpen = { isPhone, links, mount, watch };
