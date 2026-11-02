// Radar holder check: the wallet signs a message (never a transaction), the server checks the signature and the wallet's
// $RADAR and $LARPCHECK balances on-chain (server/holder.js), and a token good for a day goes back to the Radar panel that opened this.
(() => {
  // Opened from a panel it's a small window. Opened directly, it's a normal page with the site's header.
  if (!window.opener) document.body.classList.remove('insta');
  const API = 'https://narrative-radar.millenia-portfolio.workers.dev';
  // Only these get the token. Radar's panel on X and on this site; the store builds of the extension's own pages.
  const PANELS = ['https://x.com', 'https://twitter.com', 'https://pro.x.com', 'https://tryradar.fun', 'chrome-extension://kmdcebkjjddnokaalamdlcigpmccheff', 'chrome-extension://lchjfepnoaglhmnbbjffhbmfbchnojml'];
  const $ = (id) => document.getElementById(id);
  const button = $('check-button');
  const choice = $('wallet-choice');
  const status = $('wallet-status');
  const message = $('page-message');
  const say = (text, kind) => {
    message.textContent = text;
    message.classList.toggle('error', kind === 'error');
    message.classList.toggle('success', kind === 'success');
  };
  // server/holder.js checks these exact words.
  const params = new URLSearchParams(location.search);
  // Set when a computer's QR code opened this page: the computer collects the answer.
  const pair = /^[a-f0-9]{32}$/.test(params.get('pair') || '') ? params.get('pair') : null;
  const words = (address, issued) => `Radar holder check\n\nThis only proves you own this wallet. It can't move funds.\n\nWallet: ${address}\nIssued: ${issued}`;

  const find = () => {
    const list = [['Phantom', window.phantom?.solana], ['Solflare', window.solflare], ['Backpack', window.backpack?.solana], ['Solana wallet', window.solana]];
    const seen = new Set();
    const found = list.filter(([, p]) => p && typeof p.connect === 'function' && typeof p.signMessage === 'function' && !seen.has(p) && seen.add(p));
    // Rebuilding the list must not lose the wallet someone picked.
    const picked = choice.selectedOptions[0]?.textContent;
    choice.replaceChildren();
    found.forEach(([label], i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = label; choice.append(o); });
    const keep = found.findIndex(([label]) => label === picked);
    if (keep >= 0) choice.value = String(keep);
    choice.hidden = found.length < 2;
    return found;
  };

  const usd = (n) => `$${Number(n).toFixed(2)}`;
  const fmt = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  const holdings = (d) => `This wallet holds ${(d.coins || []).map((c) => `${fmt(c.balance)} $${c.symbol}, worth ${usd(c.value)}`).join(', and ') || 'neither coin'}. Holder features start at ${usd(d.minUsd || 10)}.`;

  // Google can't say what a wallet holds, so a Google account is linked once to a wallet that signed. Off until the server has a client id.
  // Not offered inside a wallet's browser, where Google refuses to sign anyone in.
  let googleCredential = null;
  const google = (extra) => fetch(`${API}/holder/google`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential: googleCredential, ...extra }), signal: AbortSignal.timeout(15000) }).then(async (r) => ({ ok: r.ok, d: await r.json().catch(() => ({})) }));
  // Kept for this tab, so reloading after adding a wallet doesn't ask for Google again. Google's answer is good for about an hour.
  const CREDENTIAL = 'nr:googleCredential';
  const remember = (credential) => { try { if (credential) sessionStorage.setItem(CREDENTIAL, credential); else sessionStorage.removeItem(CREDENTIAL); } catch {} };
  const remembered = () => {
    try {
      const credential = sessionStorage.getItem(CREDENTIAL);
      const { exp } = JSON.parse(atob(credential.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (exp * 1000 > Date.now() + 60_000) return credential;
    } catch {}
    remember(null);
    return null;
  };
  async function googleSignedIn(credential) {
    googleCredential = credential;
    say('Checking your Google account…');
    try {
      const { ok, d } = await google();
      if (!ok || d.error) { googleCredential = null; remember(null); showGoogle(); say(d.error || "Couldn't check that. Try again.", 'error'); return; }
      // Already linked and passing, so there's nothing to link when it finishes.
      if (d.linked && d.holder) { googleCredential = null; remember(null); await finish(d); return; }
      // Linked to a wallet that's now under the line: the answer is kept, so signing with another wallet moves the link there.
      if (d.linked) { $('google-button').hidden = true; say(`${holdings(d)} Sign with a wallet that holds enough and this Google account moves to it.`, 'error'); return; }
      remember(credential);
      // Signed in: the button's job is done, so nothing invites a second go.
      $('google-button').hidden = true;
      $('google-note').textContent = 'Signed in with Google.';
      // A wallet is right here: carry straight on to it.
      if (find().length) { button.click(); return; }
      if (window.RadarWalletOpen?.available()) say('One step left. Prove your wallet once using the options above, and this Google account remembers it.');
      // A computer with no wallet has nothing to sign with, so the link has to be made where the wallet is.
      else say('One step left. Link a wallet once: open tryradar.fun/holder on your phone or in a browser with your wallet, and sign in with Google there. After that, Google works here too.');
      if (window.RadarWalletOpen?.isPhone()) { offered = false; offerNoWallet(); }
    } catch { showGoogle(); say("Couldn't check that. Try again.", 'error'); }
  }
  // Coming back from linking on another device, on a computer with no wallet: the check runs again by itself.
  addEventListener('focus', () => {
    const back = remembered();
    if (back && !find().length && !window.RadarWalletOpen?.available()) googleSignedIn(back);
  });
  let googleId = null;
  // The button, loaded the first time it's needed: a page that came back still signed in hasn't loaded it yet.
  function showGoogle() {
    const box = $('google-button');
    box.hidden = false;
    if (!googleId || googleId.loaded) return;
    googleId.loaded = true;
    box.style.visibility = 'hidden';
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => {
      const target = $('google-signin');
      window.google.accounts.id.initialize({ client_id: googleId.client, callback: (r) => googleSignedIn(r.credential) });
      // Google's button stops at 400 wide and 40 high, so it's stretched to cover all of ours.
      const width = Math.min(400, box.clientWidth);
      window.google.accounts.id.renderButton(target, { theme: 'outline', size: 'large', text: 'continue_with', width });
      target.style.width = `${width}px`;
      const fit = () => { target.style.transform = `scale(${box.clientWidth / width},${(box.clientHeight / 40) * 1.2})`; };
      fit();
      addEventListener('resize', fit);
      box.style.visibility = '';
    };
    s.onerror = () => { $('google-box').hidden = true; };
    document.head.append(s);
  }
  async function offerGoogle() {
    if (pair || (window.RadarWalletOpen?.isPhone() && find().length)) return;
    const cfg = await fetch(`${API}/holder/settings`, { signal: AbortSignal.timeout(6000) }).then((r) => r.json()).catch(() => null);
    if (!cfg?.googleClientId || (!cfg.googleLive && params.get('google') !== '1')) return;
    $('google-box').hidden = false;
    // Back from adding a wallet, still signed in: no second Google step.
    const back = remembered();
    googleId = { client: cfg.googleClientId, loaded: false };
    if (back) { $('google-button').hidden = true; googleSignedIn(back); return; }
    showGoogle();
  }

  // A passing check, wherever it was signed.
  async function finish(d) {
    // Signed in with Google and just proved a wallet: remember it. A failed link doesn't undo the check.
    if (googleCredential && d.token) await google({ token: d.token }).catch(() => {});
    googleCredential = null;
    remember(null);
    // Signed on this phone for a computer: the token is the computer's to collect.
    if (pair) { say(`You hold ${usd(d.value)} of $${d.symbol}. You're in. Go back to the page that sent you here. It picks this up by itself.`, 'success'); return; }
    // The site's own pages read it from here. A wallet's browser on a phone may have no opener to hand it to.
    try { localStorage.setItem('nr:radarHolder', JSON.stringify({ token: d.token, exp: d.exp })); } catch {}
    if (params.get('next') === 'alerts') {
      say(`You hold ${usd(d.value)} of $${d.symbol}. You're in.`, 'success');
      setTimeout(() => location.replace('/alerts'), 900);
      return;
    }
    if (window.opener) for (const origin of PANELS) { try { window.opener.postMessage({ type: 'radar:holder', token: d.token, exp: d.exp }, origin); } catch {} }
    say(`You hold ${usd(d.value)} of $${d.symbol}. You're in.${window.opener ? ' This window closes in a moment.' : ''}`, 'success');
    if (window.opener) setTimeout(() => window.close(), 2500);
  }

  // No wallet in this browser. A phone opens this page in its wallet app. A computer says so, or with ?qr=1 shows a QR code and waits for the phone.
  let offered = false;
  const POLL_MS = 4000;
  const CODE_LIFE_MS = 5 * 60_000;
  function offerNoWallet() {
    if (offered) return;
    offered = true;
    button.hidden = true;
    const el = $('wallet-open');
    const opener = window.RadarWalletOpen;
    if (!opener || !el) { say('Open this page in a Solana wallet such as Phantom or Solflare.', 'error'); return; }
    if (!opener.available()) { say('No wallet in this browser. Add Phantom or Solflare to it and reload this page.'); return; }
    const copy = {
      phoneTitle: 'No wallet in this browser',
      phoneText: 'Open this page in your wallet app. You sign the same message there, and it costs nothing.',
      qrTitle: 'No wallet in this browser? Use your phone',
      qrText: 'Scan this with your phone, open the page in your wallet app and sign. This page picks it up by itself.',
    };
    // On a phone the wallet's browser can't hand a Google link back unless this page is waiting for it, so only then does it use a code.
    if (opener.isPhone() && !googleCredential) { opener.mount(el, copy); return; }
    let rounds = 0;
    const round = () => {
      rounds += 1;
      const id = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
      const target = `https://tryradar.fun/holder?pair=${id}`;
      opener.mount(el, { ...copy, qrUrl: target, phoneUrl: target });
      const until = Date.now() + CODE_LIFE_MS;
      const poll = async () => {
        const r = await fetch(`${API}/holder/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }), signal: AbortSignal.timeout(8000) }).catch(() => null);
        const d = r?.ok ? await r.json().catch(() => null) : null;
        if (d?.ready) {
          if (d.holder) { el.hidden = true; await finish(d); return; }
          // Under the line: say so, and keep a fresh code up so the phone can try another wallet.
          say(holdings(d), 'error');
          rounds = 0;
          round();
          return;
        }
        if (Date.now() < until) { setTimeout(poll, POLL_MS); return; }
        if (rounds < 3) round(); else { el.hidden = true; say('That code ran out. Reload this page to get a new one.', 'error'); }
      };
      setTimeout(poll, POLL_MS);
    };
    round();
  }

  button.addEventListener('click', async () => {
    const wallets = find();
    if (!wallets.length) { offerNoWallet(); return; }
    const [label, provider] = wallets[Math.min(Number(choice.value || 0), wallets.length - 1)];
    button.disabled = true;
    try {
      say(`Approve the connection in ${label}.`);
      const result = await provider.connect();
      const address = String((provider.publicKey || result?.publicKey)?.toString?.() || '');
      if (!address) throw new Error('The wallet did not return an address.');
      status.textContent = `${address.slice(0, 5)}…${address.slice(-5)}`;
      status.classList.add('connected');
      say('Sign the message in your wallet. It can\'t move funds.');
      const issued = new Date().toISOString();
      const signedResult = await provider.signMessage(new TextEncoder().encode(words(address, issued)), 'utf8');
      const signature = signedResult?.signature || signedResult;
      const hex = [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('');
      say('Checking your balance…');
      const res = await fetch(`${API}/holder/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address, issued, signature: hex, ...(pair ? { pair } : {}) }), signal: AbortSignal.timeout(20000) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'The check failed. Try again.');
      if (d.off) { say('Holder features are not on yet.', 'error'); return; }
      if (!d.holder) { if (pair) { say(`${holdings(d)} Your computer will show this too.`, 'error'); return; } say(`This wallet holds ${(d.coins || []).map((c) => `${fmt(c.balance)} $${c.symbol}, worth ${usd(c.value)}`).join(', and ')}. Holder features start at ${usd(d.minUsd)} of either.`, 'error'); return; }
      await finish(d);
    } catch (e) {
      say(e?.code === 4001 || /reject|cancel|denied/i.test(e?.message || '') ? 'Cancelled in your wallet. Nothing was signed.' : e?.message || 'The check failed. Try again.', 'error');
    } finally {
      button.disabled = false;
    }
  });

  find();
  // Some wallets add themselves to the page a moment after it loads.
  setTimeout(() => { if (!find().length) offerNoWallet(); offerGoogle().catch(() => {}); }, 900);
})();
