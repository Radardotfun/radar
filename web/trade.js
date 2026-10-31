// Radar Quick Buy: buy a Solana coin with the user's own browser wallet (Phantom, Solflare, Backpack).
// PumpPortal builds the unsigned buy; Radar checks it (paid by your wallet, only known programs, and a simulation that
// it spends no more than the amount plus fees), the wallet shows it and signs it, and Radar sends it through its RPC
// relay. Radar never sees keys or holds funds. The coin's name comes from its contract, never from the link.
(() => {
  const params = new URLSearchParams(location.search);
  const mint = (params.get('mint') || '').trim();
  const web3 = window.solanaWeb3;
  const guard = window.RadarQuickBuyGuard;
  const RELAY = 'https://narrative-radar.millenia-portfolio.workers.dev/rpc';
  const PRIORITY_FEE = 0.0001; // SOL, so the buy lands
  const message = document.getElementById('page-message');
  const addressPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  const signaturePattern = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
  let validMint = addressPattern.test(mint);
  if (validMint && web3?.PublicKey) {
    try { validMint = new web3.PublicKey(mint).toBase58() === mint; } catch { validMint = false; }
  }

  const $ = (id) => document.getElementById(id);
  const connectButton = $('connect-wallet');
  const walletChoice = $('wallet-choice');
  const walletStatus = $('wallet-status');
  const walletAddressRow = $('wallet-address-row');
  const buyButton = $('buy-button');
  const afterBuy = $('after-buy');
  const amountInput = $('sol-amount');
  const slippageInput = $('slippage');
  let walletProviders = [];
  let connectedProvider = null;
  let connectedAddress = '';
  let busy = false;
  let awaitingConfirmation = false;
  let coinKnown = false;

  $('coin-mint').textContent = validMint ? mint : 'Invalid token address';

  // Never inside someone else's page: with Auto-Confirm on, a hidden frame could trick a tap into a buy.
  if (window.top !== window) {
    setTimeout(() => {
      message.textContent = 'This page has to be opened on its own, not inside another site.';
      connectButton.disabled = true;
    });
    return;
  }

  // Insta Buy: a coin card opened this page as a small window with the amount already picked. It connects the wallet
  // if it already trusts this site, starts the buy (the wallet still asks to approve it), tells the card when Solana
  // confirms it, and then closes itself.
  const insta = params.get('insta') === '1';
  const instaSol = Number(params.get('sol'));
  let instaPending = false;
  if (insta) {
    document.body.classList.add('insta');
    document.querySelector('.eyebrow').textContent = 'Radar Insta Buy · Solana';
  }
  const saved = {
    get: (key) => { try { return localStorage.getItem(`radar:${key}`); } catch { return null; } },
    set: (key, value) => { try { localStorage.setItem(`radar:${key}`, String(value)); } catch {} },
  };

  const setMessage = (text, kind) => {
    message.textContent = text;
    message.classList.toggle('error', kind === 'error');
    message.classList.toggle('success', kind === 'success');
  };
  const showAfterBuy = (status, text, kind) => {
    afterBuy.hidden = false;
    $('buy-status').textContent = status;
    $('confirmation-message').textContent = text;
    $('status-dot').className = 'success-dot' + (kind ? ' ' + kind : '');
  };

  if (!validMint) {
    setMessage('Radar did not receive a valid Solana token address. Close this window and use Insta Buy from a coin card.', 'error');
    connectButton.disabled = true;
    return;
  }
  if (!web3?.VersionedTransaction || !web3?.PublicKey || !guard) {
    setMessage('The page did not load fully. Refresh it before connecting a wallet.', 'error');
    connectButton.disabled = true;
    return;
  }

  const setLinks = (pair) => {
    const safePair = addressPattern.test(pair || '') ? pair : mint;
    const urls = {
      'link-axiom': 'https://axiom.trade/meme/' + encodeURIComponent(safePair) + '?chain=sol',
      'link-padre': 'https://trade.padre.gg/trade/solana/' + encodeURIComponent(mint),
      'link-fomo': 'https://fomo.family/tokens/solana/' + encodeURIComponent(mint),
      'link-larpcheck': 'https://larpcheck.app/' + encodeURIComponent(mint),
    };
    for (const [id, url] of Object.entries(urls)) $(id).href = url;
  };
  setLinks(null);

  // The coin, looked up from its contract. A link can name any coin; the page only shows what the chain data says.
  const money = (n) => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${Math.round(n)}`);
  // A coin on a market PumpPortal can't build buys on: say so, keep Buy off, and point to the terminals.
  let unbuyable = '';
  let routeQuote = null;
  const blockBuy = (why) => {
    unbuyable = why;
    buyButton.disabled = true;
    buyButton.textContent = 'Not on Quick Buy yet';
    setMessage(why, 'error');
    showAfterBuy('Buy it on a terminal', "Quick Buy can't buy this coin's market yet. Each terminal below opens this exact coin.", 'failed');
    afterBuy.classList.add('neutral');
    $('tx-link').hidden = true;
  };
  const coinReady = (async () => {
    try {
      const r = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${encodeURIComponent(mint)}`, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      const pairs = await r.json();
      const coin = guard.coinFromPairs(pairs, mint);
      if (!coin) throw new Error('not listed');
      if (guard.quickBuyable(pairs, mint) === false) blockBuy(guard.marketWhy(pairs, mint));
      routeQuote = guard.quoteRoute(pairs, mint);
      if (routeQuote) {
        $('fee-text').textContent = "This coin is paired to another token, so the buy goes through that token in one transaction, built with pump.fun's own SDK. No PumpPortal fee here. You pay pump.fun's fees, a 0.0001 SOL priority fee and Solana network fees. Before your wallet sees it, Radar checks that only your wallet pays, that it uses known swap programs, and that a simulation spends no more than your amount plus fees.";
      }
      coinKnown = true;
      $('coin-name').textContent = coin.name;
      $('coin-symbol').textContent = '$' + coin.symbol;
      $('coin-market').textContent = coin.marketCap ? `${money(coin.marketCap)} market cap` : '';
      document.title = `Buy $${coin.symbol} · Radar`;
      setLinks(coin.pair);
    } catch {
      $('coin-name').textContent = 'an unlisted coin';
      $('coin-symbol').textContent = 'Not on DexScreener';
      $('coin-market').textContent = 'Check the contract address before you buy.';
    }
  })();

  $('copy-mint').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(mint); setMessage('Contract address copied.', 'success'); } catch { setMessage('Could not copy the contract address. Select and copy it above.', 'error'); }
  });
  $('copy-wallet').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(connectedAddress); setMessage('Wallet address copied. Fund it only through your wallet or exchange.', 'success'); } catch { setMessage('Could not copy the wallet address. Select and copy it above.', 'error'); }
  });

  // Solana JSON-RPC through Radar's relay (Helius). Browsers can't use the public RPC from a website: it refuses
  // any request that carries an Origin header.
  const rpc = async (method, rpcParams) => {
    const res = await fetch(RELAY, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: rpcParams }),
      credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(20000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.error) throw new Error(data?.error?.message || `Solana RPC ${res.status}`);
    return data.result;
  };
  const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };

  const discoverWallets = () => {
    const candidates = [['Phantom', window.phantom?.solana], ['Solflare', window.solflare], ['Backpack', window.backpack?.solana], ['Solana wallet', window.solana]];
    const seen = new Set();
    walletProviders = candidates.filter(([, provider]) => {
      if (!provider || typeof provider.connect !== 'function' || typeof provider.signTransaction !== 'function' || seen.has(provider)) return false;
      seen.add(provider);
      return true;
    });
    walletChoice.replaceChildren();
    walletProviders.forEach(([label], index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = label;
      walletChoice.append(option);
    });
    walletChoice.hidden = walletProviders.length < 2;
    if (!walletProviders.length) {
      walletStatus.textContent = 'No compatible wallet found';
      setMessage('Install a Solana browser wallet such as Phantom, Solflare or Backpack, then reload this page.', 'error');
      buyButton.disabled = true;
      buyButton.textContent = 'Connect a wallet to buy';
    } else {
      setMessage('This buy is sent to Solana mainnet. Make sure the wallet has enough SOL for the buy and fees.');
    }
  };

  const updateConnected = (provider, publicKey) => {
    let address;
    try {
      address = new web3.PublicKey(typeof publicKey?.toBase58 === 'function' ? publicKey.toBase58() : String(publicKey || '')).toBase58();
    } catch { throw new Error('The wallet returned an invalid Solana address.'); }
    connectedProvider = provider;
    connectedAddress = address;
    walletStatus.textContent = address.slice(0, 5) + '…' + address.slice(-5);
    walletStatus.classList.add('connected');
    $('wallet-address').textContent = address;
    walletAddressRow.hidden = false;
    connectButton.textContent = 'Disconnect';
    readAuto();
    buyButton.disabled = false;
    buyButton.textContent = 'Review buy in wallet';
    setMessage('Connected. Your wallet stays in control and must approve every transaction.');
    if (unbuyable) blockBuy(unbuyable);
  };

  connectButton.addEventListener('click', async () => {
    if (busy) return;
    if (connectedProvider) {
      try { await connectedProvider.disconnect?.(); } catch {}
      connectedProvider = null;
      connectedAddress = '';
      autoOn = false;
      autoBox.hidden = true;
      walletStatus.textContent = 'Not connected';
      walletStatus.classList.remove('connected');
      walletAddressRow.hidden = true;
      connectButton.textContent = 'Connect wallet';
      buyButton.disabled = true;
      buyButton.textContent = 'Connect a wallet to buy';
      setMessage('Wallet disconnected.');
      return;
    }
    discoverWallets();
    if (!walletProviders.length) return;
    const [label, provider] = walletProviders[Math.min(Number(walletChoice.value || 0), walletProviders.length - 1)];
    connectButton.disabled = true;
    setMessage('Approve the connection request in ' + label + '.');
    try {
      const result = await provider.connect();
      const publicKey = provider.publicKey || result?.publicKey;
      if (!publicKey) throw new Error('The wallet did not return a public address.');
      updateConnected(provider, publicKey);
      saved.set('wallet', label);
      if (instaPending) { instaPending = false; startInsta(); }
    } catch (error) {
      setMessage(error?.message === 'User rejected the request.' ? 'Wallet connection was cancelled.' : 'Could not connect wallet. Unlock it and try again.', 'error');
    } finally {
      connectButton.disabled = false;
    }
  });

  const setBusy = (value) => {
    busy = value;
    buyButton.disabled = value || !connectedProvider || awaitingConfirmation || !!unbuyable;
    connectButton.disabled = value;
    document.querySelectorAll('.amount-presets button').forEach((button) => { button.disabled = value; });
    amountInput.disabled = value;
    slippageInput.disabled = value;
  };

  document.querySelectorAll('.amount-presets button').forEach((button) => {
    button.addEventListener('click', () => {
      amountInput.value = button.dataset.amount;
      document.querySelectorAll('.amount-presets button').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
      setMessage('Buy amount set to ' + button.dataset.amount + ' SOL. Check the final details in your wallet.');
    });
  });
  const markPreset = () => {
    document.querySelectorAll('.amount-presets button').forEach((item) => item.setAttribute('aria-pressed', String(Number(item.dataset.amount) === Number(amountInput.value))));
  };
  amountInput.addEventListener('input', markPreset);
  if (insta && Number.isFinite(instaSol) && instaSol >= 0.001 && instaSol <= 25) {
    amountInput.value = String(instaSol);
    markPreset();
  }
  // The last slippage you used, here and in Insta Buy.
  const savedSlip = Number(saved.get('slippage'));
  if (Number.isFinite(savedSlip) && savedSlip >= 0.1 && savedSlip <= 50) slippageInput.value = String(savedSlip);
  slippageInput.addEventListener('change', () => {
    const v = Number(slippageInput.value);
    if (Number.isFinite(v) && v >= 0.1 && v <= 50) saved.set('slippage', v);
  });

  const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const encodeBase58 = (bytes) => {
    const input = Array.from(bytes);
    let zeros = 0;
    while (zeros < input.length && input[zeros] === 0) zeros += 1;
    const digits = [];
    for (let i = zeros; i < input.length; i += 1) {
      let carry = input[i];
      for (let d = 0; d < digits.length; d += 1) { carry += digits[d] << 8; digits[d] = carry % 58; carry = Math.floor(carry / 58); }
      while (carry > 0) { digits.push(carry % 58); carry = Math.floor(carry / 58); }
    }
    return '1'.repeat(zeros) + digits.reverse().map((d) => BASE58[d]).join('');
  };
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const confirmTransaction = async (signature) => {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const result = await rpc('getSignatureStatuses', [[signature], { searchTransactionHistory: true }]).catch(() => null);
      const status = result?.value?.[0];
      if (status?.err) return { failed: true };
      if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return { confirmed: true };
      await delay(1500);
    }
    return { pending: true };
  };

  // ---------- Phantom's Auto-Confirm: the user's own opt-in, so buys go through with no popup (see the guard's rules) ----------
  const autoBox = $('auto-box');
  const autoAgree = $('auto-agree');
  const autoToggle = $('auto-toggle');
  let autoOn = false;
  const phantomApp = () => (window.phantom?.solana && connectedProvider === window.phantom.solana ? window.phantom.app : null);
  const showAuto = () => {
    const app = phantomApp();
    autoBox.hidden = !app;
    if (!app) return;
    autoBox.classList.toggle('on', autoOn);
    // What the page says about approving has to stay true while this is on.
    const note = document.querySelector('.wallet-note span');
    note.dataset.usual ||= note.textContent;
    note.textContent = autoOn ? "Radar never asks for your seed phrase or private key and never holds your SOL. With Auto-Confirm on, Phantom signs Radar's buys without asking you. Turn it off above to go back." : note.dataset.usual;
    if (autoOn && /must approve every transaction/.test(message.textContent)) setMessage('Connected, with Auto-Confirm on. Phantom signs buys here without asking.');
    $('auto-state').textContent = autoOn ? 'On for tryradar.fun' : 'Off';
    autoAgree.closest('label').hidden = autoOn;
    autoToggle.textContent = autoOn ? 'Turn off Auto-Confirm' : 'Turn on Auto-Confirm';
    autoToggle.disabled = !autoOn && !autoAgree.checked;
    if (!busy && connectedProvider && !unbuyable) buyButton.textContent = autoOn ? 'Buy now, no popup' : 'Review buy in wallet';
  };
  const readAuto = async () => {
    const app = phantomApp();
    autoOn = false;
    if (app) {
      try { autoOn = guard.autoIsOn(await app.request({ method: 'phantom_auto_confirm_status', params: {} })); } catch { autoOn = false; }
    }
    showAuto();
    return autoOn;
  };
  autoAgree.addEventListener('change', showAuto);
  autoToggle.addEventListener('click', async () => {
    const app = phantomApp();
    if (!app || busy) return;
    autoToggle.disabled = true;
    try {
      if (autoOn) {
        await app.request({ method: 'phantom_auto_confirm_disable', params: {} });
        autoAgree.checked = false;
        setMessage('Auto-Confirm is off. Your wallet asks before every buy again.');
      } else {
        setMessage('Approve Auto-Confirm in Phantom.');
        await app.request({ method: 'phantom_auto_confirm_enable', params: { chains: [guard.SOLANA_MAINNET] } });
        setMessage('Auto-Confirm is on. Check Phantom shows it too.', 'success');
      }
    } catch (e) {
      setMessage(/reject|cancel|denied/i.test(e?.message || '') ? 'Nothing changed. Auto-Confirm stays as it was.' : "Phantom couldn't change Auto-Confirm here. You can still set it in Phantom.", 'error');
    }
    await readAuto();
  });
  // Asks the window that opened this one to vouch for this exact buy. Only Radar's panel answers, and only for a buy it just
  // started. A link from anywhere else gets no answer.
  const askPanel = () => new Promise((resolve) => {
    const opener = window.opener;
    if (!opener) return resolve(false);
    const sol = Number(amountInput.value);
    const timer = setTimeout(() => { window.removeEventListener('message', hear); resolve(false); }, 1500);
    function hear(e) {
      if (!guard.vouches(e, opener, mint, sol)) return;
      clearTimeout(timer);
      window.removeEventListener('message', hear);
      resolve(true);
    }
    window.addEventListener('message', hear);
    try { opener.postMessage({ type: 'radar:insta-ready', mint, sol }, '*'); } catch { clearTimeout(timer); window.removeEventListener('message', hear); resolve(false); }
  });
  // Insta Buy's start: with Auto-Confirm on, a buy starts by itself only when the panel vouches for it, up to the cap.
  const startInsta = async () => {
    await readAuto();
    const vouched = autoOn ? await askPanel() : false;
    const sol = Number(amountInput.value);
    if (guard.mayAutoStart({ auto: autoOn, vouched, sol })) { runBuy(); return; }
    setMessage(sol > guard.AUTO_MAX_SOL && vouched
      ? `Auto-Confirm is on and this is over ${guard.AUTO_MAX_SOL} SOL, so it waits for you. Check it, then tap Buy.`
      : 'Auto-Confirm is on, and this buy did not come from your Radar panel. Check the coin and amount, then tap Buy.');
  };

  // Insta Buy, after Solana confirms: tell the card (only public facts: the coin and the signature), then close
  // in a few seconds unless the user starts using the window.
  const instaDone = (signature) => {
    const symbol = coinKnown ? $('coin-symbol').textContent.replace(/^\$/, '') : '';
    try { window.opener?.postMessage({ type: 'radar:bought', mint, symbol, signature }, '*'); } catch {}
    let keepOpen = false;
    document.addEventListener('pointerdown', () => { keepOpen = true; setMessage('Bought.', 'success'); }, { once: true, capture: true });
    let left = 5;
    const tick = () => {
      if (keepOpen) return;
      if (left <= 0) { window.close(); return; }
      setMessage(`Bought. This window closes in ${left}s. Tap anywhere to keep it open.`, 'success');
      left -= 1;
      setTimeout(tick, 1000);
    };
    tick();
  };

  // A coin paired to another token is built with pump's own SDK, loaded only when it's needed. Its code is large.
  const loadRoute = () => new Promise((resolve, reject) => {
    if (window.RadarPumpRoute) return resolve(window.RadarPumpRoute);
    const s = document.createElement('script');
    s.src = `/pump-route.js?v=${encodeURIComponent(document.querySelector('script[src*="trade.js"]')?.src.split('v=')[1] || '1')}`;
    s.onload = () => (window.RadarPumpRoute ? resolve(window.RadarPumpRoute) : reject(new Error('The route code did not load. Nothing was signed.')));
    s.onerror = () => reject(new Error('The route code did not load. Nothing was signed.'));
    document.head.append(s);
  });
  const buildRoute = async (solAmount, slippage) => {
    const route = await loadRoute();
    try {
      const { bytes } = await route.buildRouteBuy({ rpcUrl: RELAY, wallet: connectedAddress, mint, quoteMint: routeQuote, sol: solAmount, slippagePct: slippage });
      return bytes;
    } catch (e) {
      throw new Error(guard.simulationWhy(e?.message, []));
    }
  };
  const buildPortal = async (solAmount, slippage) => {
    let response;
    try {
      response = await fetch('https://pumpportal.fun/api/trade-local', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicKey: connectedAddress, action: 'buy', mint, amount: solAmount, denominatedInSol: 'true', slippage, priorityFee: PRIORITY_FEE, pool: 'auto' }),
        signal: AbortSignal.timeout(20000), credentials: 'omit', cache: 'no-store',
      });
    } catch (e) {
      throw new Error(e?.name === 'TimeoutError' ? 'The buy builder timed out. Nothing was signed.' : 'Could not reach PumpPortal. Nothing was signed.');
    }
    // PumpPortal answers a bare "Bad Request" for coins on markets it doesn't cover (DexScreener can miss some).
    if (response.status === 400) { blockBuy(guard.marketWhy([], mint)); return null; }
    if (!response.ok) {
      const detail = (await response.text()).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 160);
      throw new Error((detail || 'PumpPortal returned HTTP ' + response.status) + '. Nothing was signed.');
    }
    return new Uint8Array(await response.arrayBuffer());
  };

  const runBuy = async () => {
    if (busy || !connectedProvider || !connectedAddress) return;
    if (unbuyable) { setMessage(unbuyable, 'error'); return; }
    const solAmount = Number(amountInput.value);
    const slippage = Number(slippageInput.value);
    if (!Number.isFinite(solAmount) || solAmount < 0.001) { setMessage('Enter a buy amount of at least 0.001 SOL.', 'error'); amountInput.focus(); return; }
    if (solAmount > 25) { setMessage('Radar caps one buy at 25 SOL.', 'error'); amountInput.focus(); return; }
    if (!Number.isFinite(slippage) || slippage < 0.1 || slippage > 50) { setMessage('Set slippage between 0.1% and 50%.', 'error'); slippageInput.focus(); return; }

    setBusy(true);
    afterBuy.hidden = true;
    setMessage('Building the buy…');
    try {
      await coinReady;
      const bytes = routeQuote ? await buildRoute(solAmount, slippage) : await buildPortal(solAmount, slippage);
      if (!bytes) return;
      if (!bytes.length || bytes.length > 1232) throw new Error('The buy came back empty or too large. Nothing was signed.');
      const transaction = web3.VersionedTransaction.deserialize(bytes);

      // 1. Paid by this wallet, one signature, only known programs.
      const built = guard.txBlock(transaction, connectedAddress);
      if (built) throw new Error(built);
      // 2. Simulate it: it must succeed, and spend no more than the amount plus fees.
      setMessage('Checking the buy before your wallet sees it…');
      const pre = await rpc('getBalance', [connectedAddress, { commitment: 'processed' }]);
      const sim = await rpc('simulateTransaction', [b64(transaction.serialize()), {
        encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'processed',
        accounts: { encoding: 'base64', addresses: [connectedAddress] },
      }]);
      if (sim?.value?.err) throw new Error(guard.simulationWhy(sim.value.err, sim.value.logs));
      const spend = guard.spendBlock(Number(pre?.value), Number(sim?.value?.accounts?.[0]?.lamports), solAmount);
      if (spend) throw new Error(spend);

      // 3. The wallet shows it and signs it. If it adds its own guard, the signed one is checked again.
      const noPopup = await readAuto();
      if (noPopup) {
        const named = guard.mintBlock(transaction, mint);
        if (named) throw new Error(named);
      }
      setMessage(noPopup ? 'Auto-Confirm is on. Signing with no popup…' : 'Review the token, amount and fees in your wallet. Approve only if it looks right.');
      const signed = await connectedProvider.signTransaction(transaction);
      if (!signed || typeof signed.serialize !== 'function') throw new Error('The wallet did not return a signed transaction.');
      const after = guard.txBlock(signed, connectedAddress);
      if (after) throw new Error(after.replace('Nothing was signed.', 'Nothing was sent.'));
      const firstSignature = signed.signatures?.[0];
      if (!firstSignature || !firstSignature.some((byte) => byte !== 0)) throw new Error('The wallet did not sign the transaction.');
      const signature = encodeBase58(firstSignature);
      if (!signaturePattern.test(signature)) throw new Error('The wallet returned an invalid signature. Nothing was sent.');
      const txLink = $('tx-link');
      txLink.href = 'https://solscan.io/tx/' + encodeURIComponent(signature);
      txLink.hidden = false;
      awaitingConfirmation = true;
      showAfterBuy('Wallet signed · sending', 'Your wallet signed this buy. Do not buy again until its status is clear.', 'pending');
      setMessage('Sending to Solana…', 'success');

      // 4. Send it through the relay and wait for confirmation.
      let sent;
      try {
        sent = await rpc('sendTransaction', [b64(signed.serialize()), { encoding: 'base64', skipPreflight: false, preflightCommitment: 'processed', maxRetries: 3 }]);
      } catch (e) {
        showAfterBuy('Send uncertain', 'Your wallet signed the buy, but sending it gave no clear answer. Check Solscan before trying again.', 'pending');
        setMessage(/insufficient|slippage/i.test(e.message) ? guard.simulationWhy(e.message, []) : 'Sending was unclear. Check the Solscan link before trying again.', 'error');
        return;
      }
      if (sent !== signature) {
        showAfterBuy('Check Solscan', 'Solana returned a different signature than your wallet signed. Check Solscan before doing anything else.', 'pending');
        setMessage('Signature mismatch. Do not buy again until you check Solscan.', 'error');
        return;
      }
      showAfterBuy('Buy sent', 'Waiting for Solana to confirm…', 'pending');
      setMessage('Sent. Do not buy again while this one is pending.', 'success');
      const confirmation = await confirmTransaction(signature);
      if (confirmation.confirmed) {
        awaitingConfirmation = false;
        showAfterBuy('Buy confirmed', 'Solana confirmed it. Open the coin in a terminal below.', '');
        setMessage(coinKnown ? 'Bought.' : 'Bought. This coin is not on DexScreener yet, so check it in a terminal.', 'success');
        if (insta) instaDone(signature);
      } else if (confirmation.failed) {
        awaitingConfirmation = false;
        showAfterBuy('Buy failed', 'Solana rejected it. Check Solscan for the reason before trying again.', 'failed');
      } else {
        showAfterBuy('Still confirming', 'It was sent, but confirmation is slow. Check Solscan before trying again.', 'pending');
      }
    } catch (error) {
      const cancelled = afterBuy.hidden && /reject|cancel|denied/i.test(error?.message || '');
      setMessage(cancelled ? 'You cancelled the buy in your wallet. Nothing was sent.' : error?.message || 'The buy could not be built. Nothing was signed.', 'error');
      if (!afterBuy.hidden) showAfterBuy('Check the status', 'The buy may already have been sent. Use the Solscan link before trying again.', 'pending');
    } finally {
      setBusy(false);
    }
  };
  buyButton.addEventListener('click', runBuy);

  // Insta Buy start: the wallet used last time (or the first one found), connected silently if it already trusts
  // tryradar.fun. Otherwise one Connect tap, and the buy starts right after it.
  const instaStart = async () => {
    await coinReady;
    if (unbuyable || !walletProviders.length) return;
    const index = Math.max(0, walletProviders.findIndex(([label]) => label === saved.get('wallet')));
    walletChoice.value = String(index);
    const [, provider] = walletProviders[index];
    try {
      const result = await provider.connect({ onlyIfTrusted: true });
      const publicKey = provider.publicKey || result?.publicKey;
      if (!publicKey) throw new Error('not trusted yet');
      updateConnected(provider, publicKey);
      startInsta();
    } catch {
      instaPending = true;
      setMessage('Connect your wallet and the buy starts right after.');
    }
  };

  discoverWallets();
  if (insta) {
    // Some wallets add themselves to the page a moment after it loads.
    if (walletProviders.length) instaStart();
    else setTimeout(() => { discoverWallets(); instaStart(); }, 700);
  }
})();
