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
    setMessage('Radar did not receive a valid Solana token address. Close this tab and use Buy on Radar from a coin card.', 'error');
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
  (async () => {
    try {
      const r = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${encodeURIComponent(mint)}`, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      const coin = guard.coinFromPairs(await r.json(), mint);
      if (!coin) throw new Error('not listed');
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
    buyButton.disabled = false;
    buyButton.textContent = 'Review buy in wallet';
    setMessage('Connected. Your wallet stays in control and must approve every transaction.');
  };

  connectButton.addEventListener('click', async () => {
    if (busy) return;
    if (connectedProvider) {
      try { await connectedProvider.disconnect?.(); } catch {}
      connectedProvider = null;
      connectedAddress = '';
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
    } catch (error) {
      setMessage(error?.message === 'User rejected the request.' ? 'Wallet connection was cancelled.' : 'Could not connect wallet. Unlock it and try again.', 'error');
    } finally {
      connectButton.disabled = false;
    }
  });

  const setBusy = (value) => {
    busy = value;
    buyButton.disabled = value || !connectedProvider || awaitingConfirmation;
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
  amountInput.addEventListener('input', () => {
    document.querySelectorAll('.amount-presets button').forEach((item) => item.setAttribute('aria-pressed', String(Number(item.dataset.amount) === Number(amountInput.value))));
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

  buyButton.addEventListener('click', async () => {
    if (busy || !connectedProvider || !connectedAddress) return;
    const solAmount = Number(amountInput.value);
    const slippage = Number(slippageInput.value);
    if (!Number.isFinite(solAmount) || solAmount < 0.001) { setMessage('Enter a buy amount of at least 0.001 SOL.', 'error'); amountInput.focus(); return; }
    if (solAmount > 25) { setMessage('Radar caps one buy at 25 SOL.', 'error'); amountInput.focus(); return; }
    if (!Number.isFinite(slippage) || slippage < 0.1 || slippage > 50) { setMessage('Set slippage between 0.1% and 50%.', 'error'); slippageInput.focus(); return; }

    setBusy(true);
    afterBuy.hidden = true;
    setMessage('Building the buy…');
    try {
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
      if (!response.ok) {
        const detail = (await response.text()).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 160);
        throw new Error((detail || 'PumpPortal returned HTTP ' + response.status) + '. Nothing was signed.');
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
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
      setMessage('Review the token, amount and fees in your wallet. Approve only if it looks right.');
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
  });

  discoverWallets();
})();
