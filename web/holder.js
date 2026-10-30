// Radar holder check: the wallet signs a message (never a transaction), the server checks the signature and the wallet's
// $RADAR balance on-chain (server/holder.js), and a token good for a day goes back to the Radar panel that opened this.
(() => {
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
  const words = (address, issued) => `Radar holder check\n\nThis only proves you own this wallet. It can't move funds.\n\nWallet: ${address}\nIssued: ${issued}`;

  const find = () => {
    const list = [['Phantom', window.phantom?.solana], ['Solflare', window.solflare], ['Backpack', window.backpack?.solana], ['Solana wallet', window.solana]];
    const seen = new Set();
    const found = list.filter(([, p]) => p && typeof p.connect === 'function' && typeof p.signMessage === 'function' && !seen.has(p) && seen.add(p));
    choice.replaceChildren();
    found.forEach(([label], i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = label; choice.append(o); });
    choice.hidden = found.length < 2;
    return found;
  };

  button.addEventListener('click', async () => {
    const wallets = find();
    if (!wallets.length) { say('Install a Solana browser wallet such as Phantom, Solflare or Backpack, then reload this page.', 'error'); return; }
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
      const res = await fetch(`${API}/holder/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address, issued, signature: hex }), signal: AbortSignal.timeout(20000) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'The check failed. Try again.');
      if (d.off) { say('Holder features are not on yet.', 'error'); return; }
      const fmt = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
      if (!d.holder) { say(`This wallet holds ${fmt(d.balance)} $RADAR. Holder features start at ${fmt(d.min)}.`, 'error'); return; }
      if (window.opener) for (const origin of PANELS) { try { window.opener.postMessage({ type: 'radar:holder', token: d.token, exp: d.exp }, origin); } catch {} }
      say(`You hold ${fmt(d.balance)} $RADAR. You're in. This window closes in a moment.`, 'success');
      setTimeout(() => window.close(), 2500);
    } catch (e) {
      say(e?.code === 4001 || /reject|cancel|denied/i.test(e?.message || '') ? 'Cancelled in your wallet. Nothing was signed.' : e?.message || 'The check failed. Try again.', 'error');
    } finally {
      button.disabled = false;
    }
  });

  find();
  // Some wallets add themselves to the page a moment after it loads.
  setTimeout(find, 700);
})();
