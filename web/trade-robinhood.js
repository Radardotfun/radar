// Radar Quick Buy on Robinhood Chain: buy a coin with the user's own browser wallet (MetaMask, Rabby, Phantom…).
// robinhood-guard.js finds a Uniswap route and simulates the buy and a sale right after it; only a buy that passes goes
// to the wallet, which shows it, signs it and sends it. Radar never sees keys or holds funds. The coin's name comes from
// its contract, never from the link.
(() => {
  const params = new URLSearchParams(location.search);
  const token = (params.get('token') || '').trim();
  const G = window.RadarRobinhoodGuard;
  const message = document.getElementById('page-message');
  const $ = (id) => document.getElementById(id);
  const connectButton = $('connect-wallet');
  const walletChoice = $('wallet-choice');
  const walletStatus = $('wallet-status');
  const buyButton = $('buy-button');
  const afterBuy = $('after-buy');
  const amountInput = $('eth-amount');
  const slippageInput = $('slippage');
  const checkBox = $('check-box');
  const checkResult = $('check-result');
  let wallets = [];
  let provider = null;
  let address = '';
  let busy = false;
  let pairs = [];
  let plan = null;
  let checking = 0;
  let awaitingConfirmation = false;

  const insta = params.get('insta') === '1';
  const instaEth = Number(params.get('eth'));
  let instaPending = false;
  if (insta) {
    document.body.classList.add('insta');
    document.querySelector('.eyebrow').textContent = 'Radar Insta Buy · Robinhood Chain';
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
  const setCheck = (text, kind) => {
    checkResult.textContent = text;
    checkBox.classList.toggle('bad', kind === 'bad');
    checkBox.classList.toggle('good', kind === 'good');
  };

  $('coin-mint').textContent = G?.isAddress(token) ? token : 'Invalid token address';
  if (!G || !G.isAddress(token)) {
    setMessage('Radar did not receive a valid Robinhood Chain token address. Close this window and use Insta Buy from a coin card.', 'error');
    setCheck('Nothing to check.');
    connectButton.disabled = true;
    return;
  }
  $('link-uniswap').href = `https://app.uniswap.org/swap?chain=robinhood&outputCurrency=${encodeURIComponent(token)}`;
  $('link-chart').href = `https://dexscreener.com/robinhood/${encodeURIComponent(token)}`;

  const money = (n) => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${Math.round(n)}`);
  const lookupPairs = async (a) => {
    const r = await fetch(`https://api.dexscreener.com/tokens/v1/robinhood/${encodeURIComponent(a)}`, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`DexScreener ${r.status}`);
    return r.json();
  };
  const coinReady = (async () => {
    try {
      pairs = await lookupPairs(token);
      const coin = G.coinFromPairs(pairs, token);
      if (!coin) throw new Error('not listed');
      $('coin-name').textContent = coin.name;
      $('coin-symbol').textContent = '$' + coin.symbol;
      $('coin-market').textContent = coin.marketCap ? `${money(coin.marketCap)} market cap` : '';
      document.title = `Buy $${coin.symbol} · Radar`;
    } catch {
      $('coin-name').textContent = 'an unlisted coin';
      $('coin-symbol').textContent = 'Not on DexScreener';
      $('coin-market').textContent = 'Check the contract address before you buy.';
    }
  })();

  // ---------- The check ----------
  const readInputs = () => {
    const eth = Number(amountInput.value);
    const slippage = Number(slippageInput.value);
    const bad = G.amountBlock(eth);
    if (bad) return { error: bad, field: amountInput };
    if (!Number.isFinite(slippage) || slippage < G.LIMITS.minSlippage || slippage > G.LIMITS.maxSlippage) return { error: 'Set slippage between 0.1% and 50%.', field: slippageInput };
    return { eth, slippage, wei: G.toWei(eth) };
  };
  const refreshBuyButton = () => {
    const blocked = plan?.block || !plan;
    buyButton.disabled = busy || awaitingConfirmation || !provider || !!blocked;
    if (!provider) buyButton.textContent = 'Connect a wallet to buy';
    else if (plan?.block) buyButton.textContent = plan.unsupported ? 'Not on Quick Buy yet' : 'Stopped by Radar';
    else if (!plan) buyButton.textContent = 'Checking…';
    else buyButton.textContent = 'Review buy in wallet';
  };

  // Each change of amount or wallet checks again; an older answer that arrives late is dropped.
  const runCheck = async () => {
    const run = ++checking;
    plan = null;
    refreshBuyButton();
    const input = readInputs();
    if (input.error) { setCheck(input.error, 'bad'); return null; }
    setCheck('Checking what this buy really costs…');
    await coinReady;
    let found;
    try {
      found = await G.planBuy({ token, pairs, amountWei: input.wei, wallet: address || undefined, slippagePct: input.slippage, lookupPairs });
    } catch {
      found = { block: "Radar couldn't reach Robinhood Chain to check this buy, so it won't send it. Try again in a moment. Nothing was signed." };
    }
    if (run !== checking) return null;
    plan = found;
    if (found.block) {
      setCheck(found.block, 'bad');
      setMessage(found.unsupported ? 'Open it on Uniswap below.' : 'Stopped before your wallet was asked.', 'error');
    } else {
      setCheck(`Costs about ${(found.cost * 100).toFixed(1)}% to buy (${found.route.label}). Selling straight back would keep about ${(found.roundTrip * 100).toFixed(1)}%. No heavy tax found, and the simulated sale worked.`, 'good');
      if (!provider) setMessage('Connect your wallet to buy.');
      else setMessage('Checked. Your wallet stays in control and must approve the buy.');
    }
    refreshBuyButton();
    return found;
  };
  let timer = null;
  const checkSoon = () => { clearTimeout(timer); timer = setTimeout(runCheck, 400); };

  // ---------- Wallets: EIP-6963 announcements, then window.ethereum ----------
  const announced = [];
  window.addEventListener('eip6963:announceProvider', (e) => {
    const d = e.detail;
    if (d?.provider?.request && !announced.some((x) => x.provider === d.provider)) { announced.push({ name: String(d.info?.name || 'Wallet').slice(0, 30), provider: d.provider }); listWallets(); }
  });
  function listWallets() {
    wallets = [...announced];
    const injected = window.ethereum;
    if (injected?.request && !wallets.some((w) => w.provider === injected)) wallets.push({ name: injected.isMetaMask ? 'MetaMask' : 'Browser wallet', provider: injected });
    walletChoice.replaceChildren();
    wallets.forEach((w, i) => {
      const option = document.createElement('option');
      option.value = String(i);
      option.textContent = w.name;
      walletChoice.append(option);
    });
    walletChoice.hidden = wallets.length < 2;
    const last = wallets.findIndex((w) => w.name === saved.get('evm-wallet'));
    if (last >= 0) walletChoice.value = String(last);
    if (!wallets.length) walletStatus.textContent = 'No wallet found';
    else if (!provider) walletStatus.textContent = 'Not connected';
  }

  const CHAIN_HEX = `0x${G.CHAIN_ID.toString(16)}`;
  // The wallet must be on Robinhood Chain before it signs; most wallets need the network added once.
  const useChain = async (p) => {
    if (await p.request({ method: 'eth_chainId' }) === CHAIN_HEX) return;
    try {
      await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_HEX }] });
    } catch (e) {
      if (e?.code !== 4902 && !/unrecognized|not added|unknown chain/i.test(e?.message || '')) throw e;
      await p.request({ method: 'wallet_addEthereumChain', params: [{ chainId: CHAIN_HEX, chainName: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: [G.RPC], blockExplorerUrls: [G.EXPLORER] }] });
    }
    if (await p.request({ method: 'eth_chainId' }) !== CHAIN_HEX) throw new Error('Switch your wallet to Robinhood Chain to buy.');
  };

  const setConnected = (w, account) => {
    if (!G.isAddress(account)) throw new Error('The wallet returned an invalid address.');
    provider = w.provider;
    address = account;
    walletStatus.textContent = `${account.slice(0, 6)}…${account.slice(-4)}`;
    walletStatus.classList.add('connected');
    connectButton.textContent = 'Disconnect';
    saved.set('evm-wallet', w.name);
  };
  const disconnect = () => {
    provider = null;
    address = '';
    walletStatus.textContent = 'Not connected';
    walletStatus.classList.remove('connected');
    connectButton.textContent = 'Connect wallet';
    setMessage('Wallet disconnected.');
    runCheck();
  };

  connectButton.addEventListener('click', async () => {
    if (busy) return;
    if (provider) { disconnect(); return; }
    listWallets();
    if (!wallets.length) { setMessage('Install a browser wallet such as MetaMask or Rabby, then reload this page.', 'error'); return; }
    const w = wallets[Math.min(Number(walletChoice.value || 0), wallets.length - 1)];
    connectButton.disabled = true;
    setMessage(`Approve the connection request in ${w.name}.`);
    try {
      const accounts = await w.provider.request({ method: 'eth_requestAccounts' });
      setConnected(w, accounts?.[0]);
      const found = await runCheck();
      if (instaPending && found && !found.block) { instaPending = false; runBuy(); }
    } catch (error) {
      setMessage(error?.code === 4001 ? 'Wallet connection was cancelled.' : 'Could not connect wallet. Unlock it and try again.', 'error');
    } finally {
      connectButton.disabled = false;
    }
  });

  // ---------- Amount ----------
  const markPreset = () => document.querySelectorAll('.amount-presets button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.amount) === Number(amountInput.value))));
  document.querySelectorAll('.amount-presets button').forEach((b) => b.addEventListener('click', () => {
    amountInput.value = b.dataset.amount;
    markPreset();
    runCheck();
  }));
  amountInput.addEventListener('input', () => { markPreset(); checkSoon(); });
  if (insta && !G.amountBlock(instaEth)) { amountInput.value = String(instaEth); markPreset(); }
  const savedSlip = Number(saved.get('slippage'));
  if (Number.isFinite(savedSlip) && savedSlip >= G.LIMITS.minSlippage && savedSlip <= G.LIMITS.maxSlippage) slippageInput.value = String(savedSlip);
  slippageInput.addEventListener('change', () => {
    const v = Number(slippageInput.value);
    if (Number.isFinite(v) && v >= G.LIMITS.minSlippage && v <= G.LIMITS.maxSlippage) saved.set('slippage', v);
    checkSoon();
  });
  $('copy-mint').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(token); setMessage('Contract address copied.', 'success'); } catch { setMessage('Could not copy the contract address. Select and copy it above.', 'error'); }
  });

  // ---------- The buy ----------
  const setBusy = (value) => {
    busy = value;
    connectButton.disabled = value;
    amountInput.disabled = value;
    slippageInput.disabled = value;
    document.querySelectorAll('.amount-presets button').forEach((b) => { b.disabled = value; });
    refreshBuyButton();
  };
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  const receipt = async (hash) => {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      const r = await G.rpcCall('eth_getTransactionReceipt', [hash]).catch(() => null);
      if (r?.status === '0x1') return { confirmed: true };
      if (r?.status === '0x0') return { failed: true };
      await delay(1500);
    }
    return { pending: true };
  };
  const instaDone = (hash) => {
    const symbol = $('coin-symbol').textContent.replace(/^\$/, '');
    try { window.opener?.postMessage({ type: 'radar:bought', mint: token, symbol, signature: hash }, '*'); } catch {}
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

  async function runBuy() {
    if (busy || !provider || !address) return;
    setBusy(true);
    afterBuy.hidden = true;
    try {
      const input = readInputs();
      if (input.error) { setMessage(input.error, 'error'); input.field.focus(); return; }
      await useChain(provider);
      // Enough ETH? The check itself doesn't depend on the wallet's balance.
      const balance = BigInt(await G.rpcCall('eth_getBalance', [address, 'latest']));
      if (balance < input.wei) { setMessage('Not enough ETH in this wallet on Robinhood Chain for the buy and network fee.', 'error'); return; }
      // Checked again now, with this wallet and a fresh price, right before the wallet is asked.
      setMessage('Checking the buy before your wallet sees it…');
      const found = await runCheck();
      if (!found || found.block) return;
      const stop = G.txBlock(found.tx, token, address, input.wei);
      if (stop) throw new Error(stop);

      setMessage('Review the token, amount and fees in your wallet. Approve only if it looks right.');
      const hash = await provider.request({ method: 'eth_sendTransaction', params: [{ from: address, to: found.tx.to, data: found.tx.data, value: found.tx.value }] });
      if (!/^0x[0-9a-fA-F]{64}$/.test(hash || '')) throw new Error('The wallet did not return a transaction. Check your wallet before trying again.');
      const link = $('tx-link');
      link.href = `${G.EXPLORER}/tx/${encodeURIComponent(hash)}`;
      link.hidden = false;
      awaitingConfirmation = true;
      refreshBuyButton();
      showAfterBuy('Buy sent', 'Waiting for Robinhood Chain to confirm…', 'pending');
      setMessage('Sent. Do not buy again while this one is pending.', 'success');
      const done = await receipt(hash);
      if (done.confirmed) {
        awaitingConfirmation = false;
        showAfterBuy('Buy confirmed', 'Robinhood Chain confirmed it.', '');
        setMessage('Bought.', 'success');
        if (insta) instaDone(hash);
      } else if (done.failed) {
        awaitingConfirmation = false;
        showAfterBuy('Buy failed', 'The chain rejected it. Check Blockscout for the reason before trying again.', 'failed');
      } else {
        showAfterBuy('Still confirming', 'It was sent, but confirmation is slow. Check Blockscout before trying again.', 'pending');
      }
    } catch (error) {
      const cancelled = error?.code === 4001 || /reject|cancel|denied/i.test(error?.message || '');
      setMessage(cancelled ? 'You cancelled in your wallet. Nothing was sent.' : error?.message || 'The buy could not be sent. Check your wallet before trying again.', 'error');
    } finally {
      setBusy(false);
    }
  }
  buyButton.addEventListener('click', runBuy);

  // ---------- Start ----------
  listWallets();
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  runCheck();
  // Insta Buy: the wallet used last time, connected silently if it already trusts this site; otherwise one Connect tap.
  const instaStart = async () => {
    const found = await runCheck();
    if (!found || found.block || !wallets.length) return;
    const last = wallets.find((w) => w.name === saved.get('evm-wallet')) || wallets[0];
    try {
      const accounts = await last.provider.request({ method: 'eth_accounts' });
      if (!accounts?.[0]) throw new Error('not trusted yet');
      setConnected(last, accounts[0]);
      runBuy();
    } catch {
      instaPending = true;
      setMessage('Connect your wallet and the buy starts right after.');
    }
  };
  // Some wallets announce themselves a moment after the page loads.
  if (insta) setTimeout(instaStart, 700);
})();
