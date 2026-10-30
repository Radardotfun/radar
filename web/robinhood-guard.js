// Radar Quick Buy on Robinhood Chain: finds a Uniswap route for a coin and checks it before the wallet is asked to sign.
// Some Robinhood Chain coins take heavy fees or taxes on a buy, or can't be sold at all, and a price quote doesn't show
// that. So the buy and a sell right after it are simulated on the chain's own node (eth_simulateV1, nothing is sent),
// and the page compares the tokens that actually arrive with the pool's price.
// A classic script (no imports) so the page can load it with a plain <script>; it sets window.RadarRobinhoodGuard.
// Shared by trade-robinhood.js and test/robinhood-buy.mjs.
(function (root) {
  const CHAIN_ID = 4663;
  const RPC = 'https://rpc.mainnet.chain.robinhood.com';
  const EXPLORER = 'https://robinhoodchain.blockscout.com';
  // developers.uniswap.org deployments, Robinhood Chain.
  const WETH = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73';
  const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
  // The deepest hook-free ETH/USDG pool found on 30 Oct 2026 (0.0087%).
  const USDG_POOL = { id: '0x3b0cbf0603ecc67b5fc9bb4fbb6ac9e08d3b2f406b63d1662a36063a7fe5e866', fee: 87, tickSpacing: 1 };
  const SWAP_ROUTER = '0xcaf681a66d020601342297493863e78c959e5cb2';
  const UNIVERSAL_ROUTER = '0x8876789976decbfcbbbe364623c63652db8c0904';
  const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
  const POOL_MANAGER = '0x8366a39cc670b4001a1121b8f6a443a643e40951';
  const INITIALIZE = '0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438';
  const POSITION_MANAGER = '0x58daec3116aae6d93017baaea7749052e8a04fa7';
  const STATE_VIEW = '0xf3334192d15450cdd385c8b70e03f9a6bd9e673b';
  const MULTICALL = '0x282a3c4d320cc7f0d5eaf56b8029e4b88338f0a3';
  const ETH = '0x0000000000000000000000000000000000000000';
  // Who the page's checks simulate as before a wallet is connected. It only ever exists inside a simulation.
  const STAND_IN = '0x00000000000000000000000000000000000abc01';

  // The buy is refused above these. A normal Uniswap buy costs its pool fee (usually 1% here) plus price impact.
  const MAX_BUY_COST = 0.1;
  const MIN_ROUND_TRIP = 0.8;
  const LIMITS = { minEth: 0.0001, maxEth: 2, minSlippage: 0.1, maxSlippage: 50 };

  const low = (a) => String(a || '').toLowerCase();
  const isAddress = (a) => /^0x[0-9a-fA-F]{40}$/.test(a || '');

  // ---------- ABI encoding: words, and dynamic parts as { dyn: hex } ----------
  const hex = (v) => BigInt(v).toString(16);
  const uint = (v) => hex(v).padStart(64, '0');
  // int24 tick spacing is always positive here, so it encodes like a uint.
  const addr = (a) => low(a).replace(/^0x/, '').padStart(64, '0');
  const bytes = (h) => { const b = String(h || '').replace(/^0x/, ''); return uint(b.length / 2) + b.padEnd(Math.ceil(b.length / 64) * 64, '0'); };
  const tuple = (parts) => {
    const headSize = parts.length * 32;
    let tail = '';
    const head = parts.map((p) => {
      if (typeof p === 'string') return p;
      const at = headSize + tail.length / 2;
      tail += p.dyn;
      return uint(at);
    });
    return head.join('') + tail;
  };
  const dyn = (h) => ({ dyn: h });
  const array = (items) => uint(items.length) + tuple(items);

  // ---------- Calls ----------
  const SEL = {
    exactInputSingle: '0x04e45aaf', execute: '0x3593564c', approve: '0x095ea7b3', balanceOf: '0x70a08231', permit2Approve: '0x87517c45',
    getEthBalance: '0x4d2301cc', fee: '0xddca3f43', token0: '0x0dfe1681', slot0: '0x3850c7bd', poolKeys: '0x86b6be7d', v4Slot0: '0xc815641c',
  };
  const V4_SWAP = '10';
  const ACTION = { swapExactIn: '07', settleAll: '0c', takeAll: '0f' };
  const MAX_UINT = (1n << 256n) - 1n;
  const v3Swap = (from, to, fee, recipient, amount, min) => `${SEL.exactInputSingle}${addr(from)}${addr(to)}${uint(fee)}${addr(recipient)}${uint(amount)}${uint(min)}${uint(0)}`;
  const balanceOf = (who) => `${SEL.balanceOf}${addr(who)}`;

  // A swap through Uniswap v4 pools. hops: [{ currency (the one coming out of this pool), fee, tickSpacing, hooks }].
  function v4Swap(currencyIn, hops, amount, min, deadline) {
    const last = hops[hops.length - 1].currency;
    const path = array(hops.map((h) => dyn(tuple([addr(h.currency), uint(h.fee), uint(h.tickSpacing), addr(h.hooks), dyn(bytes(''))]))));
    // This router's ExactInputParams carries a per-hop price floor after the path; 0 means none (`min` covers the whole swap).
    const floors = array(hops.map(() => uint(0)));
    const swap = uint(32) + tuple([addr(currencyIn), dyn(path), dyn(floors), uint(amount), uint(min)]);
    const params = array([dyn(bytes(swap)), dyn(bytes(addr(currencyIn) + uint(amount))), dyn(bytes(addr(last) + uint(min)))]);
    const input = tuple([dyn(bytes(ACTION.swapExactIn + ACTION.settleAll + ACTION.takeAll)), dyn(params)]);
    const data = tuple([dyn(bytes(V4_SWAP)), dyn(array([dyn(bytes(input))])), uint(deadline)]);
    return `${SEL.execute}${data}`;
  }

  // ---------- Which pools ----------
  // DexScreener's pools for the coin, deepest first. Radar can route from ETH through Uniswap v3 against WETH, Uniswap v4
  // against ETH, or Uniswap v4 against another coin that itself has a v4 pool against ETH or USDG.
  const version = (p) => (p.labels || []).find((l) => /^v[34]$/.test(l));
  const liquidity = (p) => Number(p.liquidity?.usd || 0);
  function poolsOf(pairs, token) {
    return (Array.isArray(pairs) ? pairs : [])
      .filter((p) => p?.chainId === 'robinhood' && p.dexId === 'uniswap' && low(p.baseToken?.address) === low(token) && version(p))
      .sort((a, b) => liquidity(b) - liquidity(a));
  }

  // The coin as DexScreener lists it, from the contract alone (a link's own name is never trusted).
  function coinFromPairs(pairs, token) {
    const list = (Array.isArray(pairs) ? pairs : []).filter((p) => p?.chainId === 'robinhood' && low(p.baseToken?.address) === low(token))
      .sort((a, b) => liquidity(b) - liquidity(a));
    if (!list.length) return null;
    const clean = (s, max) => String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);
    return { name: clean(list[0].baseToken.name, 40) || 'Unnamed coin', symbol: clean(list[0].baseToken.symbol, 20).replace(/^\$+/, '') || '?', marketCap: Number(list[0].marketCap || list[0].fdv || 0) };
  }

  // ---------- Reading the chain ----------
  async function rpcCall(method, params, { rpcUrl = RPC, fetchImpl = fetch } = {}) {
    const res = await fetchImpl(rpcUrl, {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'omit', cache: 'no-store',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.error) throw new Error(data?.error?.message || `Robinhood Chain RPC ${res.status}`);
    return data.result;
  }
  const words = (h) => (String(h || '').replace(/^0x/, '').match(/.{64}/g) || []);
  const wordAddr = (w) => `0x${w.slice(24)}`;

  // Raw tokens out per raw token in, at the pool's current price, from its sqrt price.
  const spot = (sqrtPriceX96, zeroForOne) => { const p = (Number(sqrtPriceX96) / 2 ** 96) ** 2; return zeroForOne ? p : 1 / p; };

  async function v3Hop(pool, token, opts) {
    const call = (data) => rpcCall('eth_call', [{ to: pool, data }, 'latest'], opts);
    const [fee, token0, slot0] = await Promise.all([call(SEL.fee), call(SEL.token0), call(SEL.slot0)]);
    const zeroForOne = low(wordAddr(words(token0)[0])) === low(WETH);
    return { fee: Number(BigInt(`0x${words(fee)[0]}`)), rate: spot(BigInt(`0x${words(slot0)[0]}`), zeroForOne) };
  }

  // A v4 pool's key from its id, and its price. Null when the position manager doesn't know the pool.
  async function v4Hop(poolId, currencyIn, opts) {
    const call = (to, data) => rpcCall('eth_call', [{ to, data }, 'latest'], opts);
    const id = low(poolId).replace(/^0x/, '');
    const [key, slot0] = await Promise.all([call(POSITION_MANAGER, `${SEL.poolKeys}${id.slice(0, 50).padEnd(64, '0')}`), call(STATE_VIEW, `${SEL.v4Slot0}${id}`)]);
    let w = words(key);
    // A pool whose liquidity didn't come through the position manager: the key is in the event that created the pool.
    // The node searches at most 10M blocks (about a month) at a time, so this only finds pools made in the last month.
    if (w.length < 5 || !/[1-9a-f]/.test(w[1])) {
      const head = BigInt(await rpcCall('eth_blockNumber', [], opts));
      const logs = await rpcCall('eth_getLogs', [{ address: POOL_MANAGER, fromBlock: `0x${hex(head > 9900000n ? head - 9900000n : 0n)}`, toBlock: 'latest', topics: [INITIALIZE, `0x${id}`] }], opts);
      if (!logs?.length) return null;
      const body = words(logs[0].data);
      w = [logs[0].topics[2].slice(2), logs[0].topics[3].slice(2), body[0], body[1], body[2]];
    }
    const c0 = wordAddr(w[0]);
    const c1 = wordAddr(w[1]);
    const zeroForOne = low(c0) === low(currencyIn);
    if (!zeroForOne && low(c1) !== low(currencyIn)) return null;
    return { currency: zeroForOne ? c1 : c0, fee: Number(BigInt(`0x${w[2]}`)), tickSpacing: Number(BigInt(`0x${w[3]}`)), hooks: wordAddr(w[4]), rate: spot(BigInt(`0x${words(slot0)[0]}`), zeroForOne) };
  }

  // Routes from ETH to the coin, deepest pool first, up to `max`. lookupPairs(address) -> DexScreener's pools for a coin.
  async function findRoutes(token, pairs, lookupPairs, opts = {}, max = 3) {
    const routes = [];
    for (const p of poolsOf(pairs, token)) {
      if (routes.length >= max) break;
      const quote = low(p.quoteToken?.address);
      try {
        if (version(p) === 'v3' && quote === low(WETH)) {
          const hop = await v3Hop(p.pairAddress, token, opts);
          routes.push({ kind: 'v3', fee: hop.fee, rate: hop.rate, label: `Uniswap v3 · ${hop.fee / 1e4}% pool` });
        } else if (version(p) === 'v4' && quote === ETH) {
          const hop = await v4Hop(p.pairAddress, ETH, opts);
          // A pool with a hook sets its own fee, so its listed fee says nothing; the check below measures the real cost.
          const fixed = hop && low(hop.hooks) === ETH && hop.fee < 0x800000;
          if (hop && low(hop.currency) === low(token)) routes.push({ kind: 'v4', hops: [hop], rate: hop.rate, label: fixed ? `Uniswap v4 · ${hop.fee / 1e4}% pool` : 'Uniswap v4 · pool with its own fee' });
        } else if (version(p) === 'v4') {
          // Through what it trades against: find that coin's own deepest pool from ETH, directly or by way of USDG.
          const middle = await pathTo(quote, lookupPairs, opts);
          const hop = middle && await v4Hop(p.pairAddress, quote, opts);
          if (hop && low(hop.currency) === low(token)) {
            const hops = [...middle.hops, hop];
            routes.push({ kind: 'v4', hops, rate: hops.reduce((r, h) => r * h.rate, 1), label: `Uniswap v4 · ${hops.length} pools` });
          }
        }
      } catch { /* a pool that can't be read isn't a route */ }
    }
    return routes;
  }

  // v4 hops from ETH to a coin: its pool against ETH, or against USDG with USDG's pool against ETH in front. Null if none.
  async function pathTo(currency, lookupPairs, opts) {
    const c = low(currency);
    // DexScreener doesn't list USDG's own v4 pools, so its main one against ETH is written down here.
    if (c === low(USDG)) {
      const slot0 = await rpcCall('eth_call', [{ to: STATE_VIEW, data: `${SEL.v4Slot0}${USDG_POOL.id.slice(2)}` }, 'latest'], opts);
      return { hops: [{ currency: USDG, fee: USDG_POOL.fee, tickSpacing: USDG_POOL.tickSpacing, hooks: ETH, rate: spot(BigInt(`0x${words(slot0)[0]}`), true) }] };
    }
    const against = (p) => (low(p.baseToken?.address) === c ? low(p.quoteToken?.address) : low(p.quoteToken?.address) === c ? low(p.baseToken?.address) : null);
    const pools = (await lookupPairs(currency) || []).filter((p) => p?.chainId === 'robinhood' && p.dexId === 'uniswap' && version(p) === 'v4' && against(p)).sort((a, b) => liquidity(b) - liquidity(a));
    const direct = pools.find((p) => against(p) === ETH);
    if (direct) {
      const hop = await v4Hop(direct.pairAddress, ETH, opts);
      return hop && low(hop.currency) === low(currency) ? { hops: [hop] } : null;
    }
    const viaUsdg = pools.find((p) => against(p) === low(USDG));
    if (!viaUsdg) return null;
    const first = await pathTo(USDG, lookupPairs, opts);
    const hop = first && await v4Hop(viaUsdg.pairAddress, USDG, opts);
    return hop && low(hop.currency) === low(currency) ? { hops: [...first.hops, hop] } : null;
  }

  // ---------- The simulation ----------
  const buyCall = (route, token, who, amount, min, deadline) => (route.kind === 'v3'
    ? { to: SWAP_ROUTER, data: v3Swap(WETH, token, route.fee, who, amount, min), value: amount }
    : { to: UNIVERSAL_ROUTER, data: v4Swap(ETH, route.hops, amount, min, deadline), value: amount });

  // The way back, for the sell half of the check: the same pools in reverse.
  function sellCalls(route, token, who, tokens, deadline) {
    if (route.kind === 'v3') return [{ to: token, data: `${SEL.approve}${addr(SWAP_ROUTER)}${uint(MAX_UINT)}` }, { to: SWAP_ROUTER, data: v3Swap(token, WETH, route.fee, who, tokens, 0n) }];
    const back = [...route.hops].reverse().map((h, i, list) => ({ ...h, currency: i + 1 < list.length ? list[i + 1].currency : ETH }));
    return [
      { to: token, data: `${SEL.approve}${addr(PERMIT2)}${uint(MAX_UINT)}` },
      { to: PERMIT2, data: `${SEL.permit2Approve}${addr(token)}${addr(UNIVERSAL_ROUTER)}${uint((1n << 160n) - 1n)}${uint(deadline)}` },
      { to: UNIVERSAL_ROUTER, data: v4Swap(token, back, tokens, 0n, deadline) },
    ];
  }

  const FUNDS = '0x3635c9adc5dea00000'; // 1,000 ETH, inside the simulation only: the check must not depend on the wallet's balance.
  async function simulate(calls, who, opts) {
    const res = await rpcCall('eth_simulateV1', [{ validation: false, blockStateCalls: [{ stateOverrides: { [who]: { balance: FUNDS } }, calls: calls.map((c) => ({ from: who, to: c.to, data: c.data, ...(c.value ? { value: `0x${hex(c.value)}` } : {}) })) }] }, 'latest'], opts);
    return res[0].calls;
  }
  const ok = (c) => c && String(c.status) === '0x1';
  const num = (h) => BigInt(h && h !== '0x' ? h : 0);

  // Buys, then sells it all straight back. -> { tokens, cost, roundTrip, sellOk } for the route, or null if the buy fails.
  async function checkRoute(route, token, who, amount, deadline, opts) {
    const before = { to: MULTICALL, data: `${SEL.getEthBalance}${addr(who)}` };
    const buy = buyCall(route, token, who, amount, 0n, deadline);
    const held = { to: token, data: balanceOf(who) };
    const bought = await simulate([buy, held], who, opts);
    if (!ok(bought[0])) return null;
    const tokens = num(bought[1].returnData);
    if (tokens <= 0n) return null;
    const cost = 1 - Number(tokens) / (Number(amount) * route.rate);
    const sell = sellCalls(route, token, who, tokens, deadline);
    const back = route.kind === 'v3' ? { to: WETH, data: balanceOf(who) } : before;
    const trip = await simulate([before, buy, ...sell, back], who, opts);
    const sold = ok(trip[trip.length - 2]);
    const start = route.kind === 'v3' ? 0n : num(trip[0].returnData);
    const returned = route.kind === 'v3' ? num(trip[trip.length - 1].returnData) : num(trip[trip.length - 1].returnData) - start + amount;
    return { tokens, cost, sellOk: sold, roundTrip: sold ? Number(returned) / Number(amount) : 0 };
  }

  // Why this buy must not go to the wallet, or null. checked: what checkRoute found.
  function verdict(checked) {
    if (!checked) return 'This buy would fail on-chain right now, so nothing was signed.';
    if (!checked.sellOk) return 'Radar simulated selling this coin right after buying it, and the sale failed. It may not be sellable. Nothing was signed.';
    if (checked.cost > MAX_BUY_COST) return `This buy would lose about ${Math.round(checked.cost * 100)}% to fees, taxes and price impact, so Radar stopped it. Nothing was signed.`;
    if (checked.roundTrip < MIN_ROUND_TRIP) return `Buying and selling right back would lose about ${Math.round((1 - checked.roundTrip) * 100)}%, so Radar stopped it. This coin likely has a heavy tax. Nothing was signed.`;
    return null;
  }

  // The fewest tokens the buy may return: what the simulation got, less the slippage.
  const minimumOut = (tokens, slippagePct) => (tokens * BigInt(Math.round((100 - slippagePct) * 100))) / 10000n;

  /**
   * The best route for this buy, checked. -> { block } when none passes, else { route, tx, tokens, cost, roundTrip }.
   * block: why, in words. unsupported: Radar has no route, so the page points to Uniswap instead.
   */
  async function planBuy({ token, pairs, amountWei, wallet, slippagePct, lookupPairs, now = Date.now(), opts = {} }) {
    const who = wallet || STAND_IN;
    const deadline = BigInt(Math.floor(now / 1000) + 600);
    const routes = await findRoutes(token, pairs, lookupPairs, opts);
    if (!routes.length) return { unsupported: true, block: "Radar can't route this coin yet: it has no Uniswap pool Radar can reach from ETH. Open it on Uniswap below. Nothing was signed." };
    const checked = [];
    for (const route of routes) {
      const c = await checkRoute(route, token, who, amountWei, deadline, opts).catch(() => null);
      checked.push({ route, c });
    }
    const passing = checked.filter((x) => x.c && !verdict(x.c)).sort((a, b) => (b.c.tokens > a.c.tokens ? 1 : b.c.tokens < a.c.tokens ? -1 : 0));
    if (!passing.length) {
      const any = checked.find((x) => x.c);
      return any ? { block: verdict(any.c), cost: any.c.cost, roundTrip: any.c.roundTrip } : { unsupported: true, block: "Radar's check of this buy failed on every route, so it won't send it. Open it on Uniswap below if you still want it. Nothing was signed." };
    }
    const { route, c } = passing[0];
    const tx = buyCall(route, token, who, amountWei, minimumOut(c.tokens, slippagePct), deadline);
    return { route, tx: { to: tx.to, data: tx.data, value: `0x${hex(tx.value)}` }, tokens: c.tokens, cost: c.cost, roundTrip: c.roundTrip };
  }

  // Only these contracts, only with this amount: re-checked right before the wallet is asked.
  function txBlock(tx, token, wallet, amountWei) {
    const to = low(tx?.to);
    if (to !== low(SWAP_ROUTER) && to !== low(UNIVERSAL_ROUTER)) return 'This buy goes to a contract Radar does not recognise. Nothing was signed.';
    if (BigInt(tx.value || 0) !== BigInt(amountWei)) return 'This buy would spend a different amount than you picked. Nothing was signed.';
    const data = low(tx.data);
    if (!data.includes(low(token).slice(2))) return 'This buy is for a different coin than the one on this page. Nothing was signed.';
    if (to === low(SWAP_ROUTER) && !data.includes(low(wallet).slice(2))) return 'This buy would send the coins to another wallet. Nothing was signed.';
    return null;
  }

  // The contract may list several pools under one coin; a typed amount is checked here.
  function amountBlock(eth) {
    if (!Number.isFinite(eth) || eth < LIMITS.minEth) return `Enter a buy amount of at least ${LIMITS.minEth} ETH.`;
    if (eth > LIMITS.maxEth) return `Radar caps one buy at ${LIMITS.maxEth} ETH.`;
    return null;
  }
  const toWei = (eth) => BigInt(Math.round(eth * 1e9)) * 1000000000n;

  root.RadarRobinhoodGuard = {
    CHAIN_ID, RPC, EXPLORER, WETH, USDG, SWAP_ROUTER, UNIVERSAL_ROUTER, ETH, LIMITS, MAX_BUY_COST, MIN_ROUND_TRIP,
    isAddress, rpcCall, poolsOf, coinFromPairs, findRoutes, checkRoute, planBuy, verdict, minimumOut, txBlock, amountBlock, toWei, v4Swap, v3Swap,
  };
})(typeof window !== 'undefined' ? window : globalThis);
