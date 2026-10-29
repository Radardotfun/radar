// Quick Buy safety checks, shared by trade.js and test/quickbuy.mjs. A classic script (no imports) so the page can
// load it with a plain <script>; it sets window.RadarQuickBuyGuard.
(function (root) {
  // Programs a Radar Quick Buy may call. The first ones were read off PumpPortal-built buys on 29 Oct 2026 (pump.fun
  // curve coins route through PumpPortal's router; Raydium coins through Raydium CPMM); the rest are the standard
  // Solana programs, the main pump.fun / PumpSwap / Raydium venues, and Lighthouse, which some wallets add as a guard.
  // A transaction that calls anything else is refused before the wallet is asked to sign.
  const PROGRAMS = {
    ComputeBudget111111111111111111111111111111: 'Compute budget',
    '11111111111111111111111111111111': 'System',
    TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: 'Token',
    TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: 'Token-2022',
    ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: 'Associated token account',
    FAdo9NCw1ssek6Z6yeWzWjhLVsr8uiCwcWNUnKgzTnHe: 'PumpPortal router',
    '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P': 'pump.fun',
    pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA: 'PumpSwap',
    CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C: 'Raydium CPMM',
    '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': 'Raydium AMM',
    L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95: 'Lighthouse',
  };

  const short = (a) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : 'unknown');

  // Why a built (or wallet-signed) transaction must not be signed or sent, or null when it passes.
  function txBlock(tx, payer) {
    const msg = tx && tx.message;
    const keys = ((msg && msg.staticAccountKeys) || []).map((k) => (typeof k === 'string' ? k : k.toBase58()));
    if (!keys.length || keys[0] !== payer) return 'This transaction is not paid by your wallet. Nothing was signed.';
    if (!msg.header || msg.header.numRequiredSignatures !== 1) return 'This transaction asks for more than your signature. Nothing was signed.';
    const ixs = msg.compiledInstructions || [];
    if (!ixs.length) return 'This transaction is empty. Nothing was signed.';
    for (const ix of ixs) {
      const program = keys[ix.programIdIndex];
      if (!program || !PROGRAMS[program]) return `This transaction calls a program Radar does not recognise (${short(program)}). Nothing was signed.`;
    }
    return null;
  }

  // A buy may move the SOL amount plus fees: PumpPortal's 0.5%, priority and network fees, and the rent for a new
  // token account. If a simulation shows the wallet losing more than that, the buy is refused.
  function spendBlock(preLamports, postLamports, sol) {
    if (!Number.isFinite(preLamports) || !Number.isFinite(postLamports)) return 'Radar could not check what this buy spends. Nothing was signed.';
    const spent = (preLamports - postLamports) / 1e9;
    const allowed = sol * 1.02 + 0.02;
    if (spent > allowed) return `This buy would take ${spent.toFixed(4)} SOL from your wallet, more than ${sol} SOL plus fees. Nothing was signed.`;
    return null;
  }

  // Plain words for a failed simulation.
  function simulationWhy(err, logs) {
    const text = `${JSON.stringify(err || '')} ${(logs || []).join(' ')}`;
    // An empty wallet has no account on chain yet: AccountNotFound.
    if (/insufficient (lamports|funds)|InsufficientFunds|AccountNotFound|0x1\b/i.test(text)) return 'Not enough SOL in this wallet for the buy and fees.';
    if (/slippage|TooMuchSol|TooLittleSol|ExceededSlippage|0x1772|0x1773/i.test(text)) return 'The price moved past your slippage. Raise it or try again.';
    return 'The buy would fail on-chain right now, so nothing was signed.';
  }

  // The coin as DexScreener lists it, from the contract address alone (a link's own name is never trusted).
  function coinFromPairs(pairs, mint) {
    const list = (Array.isArray(pairs) ? pairs : []).filter((p) => p && p.chainId === 'solana' && p.baseToken && p.baseToken.address === mint);
    if (!list.length) return null;
    const top = list.sort((a, b) => ((b.liquidity && b.liquidity.usd) || 0) - ((a.liquidity && a.liquidity.usd) || 0))[0];
    const clean = (s, max) => String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);
    // A ticker that carries its own "$" ($WIF) loses it: the page adds one.
    return { name: clean(top.baseToken.name, 40) || 'Unnamed coin', symbol: clean(top.baseToken.symbol, 20).replace(/^\$+/, '') || '?', marketCap: Number(top.marketCap || top.fdv || 0), pair: top.pairAddress || '' };
  }

  // The markets PumpPortal builds buys on, by DexScreener dexId. Checked with live unsigned builds on 29 Oct 2026:
  // pump.fun curve, PumpSwap and Raydium work; Orca (where $WIF and $BONK trade) and Meteora come back "Bad Request".
  // extension/src/ui/radar.js keeps the same list for the cards' Insta Buy button.
  const QUICK_MARKETS = new Set(['pumpfun', 'pumpswap', 'raydium']);
  const MARKET_NAMES = { orca: 'Orca', meteora: 'Meteora', meteoradbc: 'Meteora', raydium: 'Raydium', pumpfun: 'pump.fun', pumpswap: 'PumpSwap' };

  // Whether Quick Buy can buy this coin: true, false, or null when DexScreener lists no market for it.
  function quickBuyable(pairs, mint) {
    const markets = (Array.isArray(pairs) ? pairs : []).filter((p) => p && p.chainId === 'solana' && p.baseToken && p.baseToken.address === mint).map((p) => p.dexId);
    if (!markets.length) return null;
    return markets.some((m) => QUICK_MARKETS.has(m));
  }

  // Plain words for a coin Quick Buy can't buy.
  function marketWhy(pairs, mint) {
    const top = (Array.isArray(pairs) ? pairs : []).filter((p) => p && p.chainId === 'solana' && p.baseToken && p.baseToken.address === mint)
      .sort((a, b) => ((b.liquidity && b.liquidity.usd) || 0) - ((a.liquidity && a.liquidity.usd) || 0))[0];
    const where = top ? MARKET_NAMES[top.dexId] || 'a market' : 'a market';
    return `Quick Buy can't buy this coin yet. It trades on ${where}, and PumpPortal, which builds Radar's buys, only covers pump.fun, PumpSwap and Raydium. Open it on a terminal below. Nothing was signed.`;
  }

  root.RadarQuickBuyGuard = { PROGRAMS, QUICK_MARKETS, txBlock, spendBlock, simulationWhy, coinFromPairs, quickBuyable, marketWhy };
})(typeof window !== 'undefined' ? window : globalThis);
