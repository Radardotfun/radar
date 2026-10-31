// ==UserScript==
// @name         Radar
// @namespace    https://tryradar.fun
// @version      1.7.27
// @description  See the coins behind any post on X and instantly reroute to the biggest match that passes available on-chain safety checks.
// @homepageURL  https://tryradar.fun
// @supportURL   https://tryradar.fun
// @icon         https://tryradar.fun/icons/icon128.png
// @match        https://x.com/*
// @match        https://twitter.com/*
// @match        https://pro.x.com/*
// @match        https://mobile.x.com/*
// @grant        GM.xmlHttpRequest
// @grant        GM_xmlhttpRequest
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.openInTab
// @connect      api.dexscreener.com
// @connect      cdn.dexscreener.com
// @connect      dd.dexscreener.com
// @connect      api.rugcheck.xyz
// @connect      api.mainnet-beta.solana.com
// @connect      solana-rpc.publicnode.com
// @connect      narrative-radar.millenia-portfolio.workers.dev
// @connect      cdn.syndication.twimg.com
// @connect      video.twimg.com
// @inject-into  content
// @run-at       document-idle
// @noframes
// @updateURL    https://tryradar.fun/radar.meta.js
// @downloadURL  https://tryradar.fun/radar.user.js
// ==/UserScript==

// Radar 1.7.27: built from the extension source at https://tryradar.fun. Not financial advice.
(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // userscript/gm-fetch.js
  var xhr = typeof GM !== "undefined" && GM.xmlHttpRequest || typeof GM_xmlhttpRequest !== "undefined" && GM_xmlhttpRequest;
  function headerMap(raw) {
    const map = /* @__PURE__ */ new Map();
    for (const line of String(raw || "").split(/\r?\n/)) {
      const i = line.indexOf(":");
      if (i > 0) map.set(line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim());
    }
    return map;
  }
  function toResponse(r) {
    const headers = headerMap(r.responseHeaders);
    const buf = r.response instanceof ArrayBuffer ? r.response : null;
    const text = () => Promise.resolve(buf ? new TextDecoder().decode(buf) : String(r.responseText ?? r.response ?? ""));
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: { get: (name) => headers.get(String(name).toLowerCase()) ?? null },
      text,
      json: () => text().then(JSON.parse),
      arrayBuffer: () => Promise.resolve(buf || new TextEncoder().encode(String(r.responseText ?? "")).buffer)
    };
  }
  function gmFetch(input, init = {}) {
    const url = typeof input === "string" ? input : input.url;
    const abortError = () => new DOMException("The operation was aborted.", "AbortError");
    return new Promise((resolve, reject) => {
      if (init.signal?.aborted) return reject(abortError());
      const req = xhr({
        method: init.method || "GET",
        url,
        headers: init.headers || {},
        data: init.body,
        responseType: "arraybuffer",
        anonymous: true,
        onload: (r) => resolve(toResponse(r)),
        onerror: () => reject(new TypeError(`Network request failed: ${url}`)),
        ontimeout: () => reject(new TypeError(`Request timed out: ${url}`)),
        onabort: () => reject(abortError())
      });
      init.signal?.addEventListener("abort", () => {
        try {
          req?.abort?.();
        } catch {
        }
        reject(abortError());
      }, { once: true });
    });
  }

  // extension/src/lib/keywords.js
  var STOP = new Set(`a about above after again against all almost also am an and any are aren as at be because been before
being below between both but by can cannot could did do does doing down during each even ever every few for from further
get gets got had has have having he her here hers herself him himself his how i if in into is it its itself just let like
made make many may me might more most much must my myself no nor not now of off on once only or other ought our ours
ourselves out over own per really same say says said see seen she should so some still such than that the their theirs them
themselves then there these they this those through to too under until up upon us very via was we were what when where which
while who whom why will with within without would yet you your yours yourself yourselves one two three four five six seven
eight nine ten first last next new old big small good bad best worst top today tonight tomorrow yesterday week weeks month
months year years day days time times people thing things way ways back still ago soon already anyone everyone someone
nothing something everything here's there's it's that's what's who's let's don't doesn't didn't won't can't isn't wasn't
aren't weren't i'm you're we're they're i've you've we've they've i'll you'll we'll they'll`.split(/\s+/));
  var FILLER = new Set(`breaking just in news update updates report reports reported reporting according sources source
official officially confirms confirmed confirm announces announced announcement statement live watch video photo photos
thread follow retweet repost reply replies link bio here via exclusive developing alert urgent happening now latest
says said tells told claims claimed per amid after hours minutes earlier later reportedly allegedly sir guys lol lmao
wow omg damn yes yeah okay ok please thanks thank everyone`.split(/\s+/));
  var MAJORS = new Set("btc eth sol usdc usdt bnb xrp ada doge trx usd eur".split(" "));
  var norm = (s) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
  function extractKeywords(text, max = 6, { strongOnly = false } = {}) {
    if (!text) return [];
    const scores = /* @__PURE__ */ new Map();
    const add = (term, w, strong2 = true) => {
      const key = norm(term);
      if (key.length < 2 || STOP.has(key) || FILLER.has(key)) return;
      const prev = scores.get(key);
      scores.set(key, { term: prev?.term || term, w: (prev?.w || 0) + w, strong: strong2 || !!prev?.strong });
    };
    let t = text.replace(/https?:\/\/\S+/g, " ").replace(/@\w+/g, " ").replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}]/gu, " ");
    for (const [, tag] of t.matchAll(/\$([A-Za-z][A-Za-z0-9]{1,14})\b/g)) {
      if (!MAJORS.has(tag.toLowerCase())) add(tag.toUpperCase(), 12);
    }
    for (const [, tag] of t.matchAll(/#([A-Za-z][A-Za-z0-9_]{2,30})/g)) add(tag, 7);
    t = t.replace(/[$#][A-Za-z0-9_]+/g, " ");
    for (const sentence of t.split(/[.!?:;\n|•—–"“”]+/)) {
      const words = sentence.split(/[^A-Za-z0-9'À-ɏ-]+/).filter(Boolean);
      let run = [];
      const flush = () => {
        if (run.length >= 2 && run.length <= 3) add(run.join(" "), 4);
        run = [];
      };
      words.forEach((raw, i) => {
        const w = raw.replace(/^['-]+|['-]+$/g, "").replace(/'s$/i, "");
        const lower = w.toLowerCase();
        if (!w || STOP.has(lower) || FILLER.has(lower) || /^\d+%?$/.test(w)) {
          flush();
          return;
        }
        const isCaps = /^[A-Z0-9]{2,12}$/.test(w) && /[A-Z]{2}/.test(w);
        const isProper = /^[A-Z][a-zÀ-ɏ]+/.test(w);
        if (isCaps || isProper) {
          if (isCaps) add(w, 3);
          else add(w, w.length <= 3 ? 1.2 : i === 0 ? 2.5 : 3);
          run.push(w);
          return;
        }
        flush();
        if (lower.length >= 5) add(lower, 0.8, false);
      });
      flush();
    }
    const ranked = [...scores.values()].sort((a, b) => b.w - a.w || b.term.length - a.term.length);
    const strong = ranked.filter((k) => k.strong);
    const pool = strong.length >= 2 || strongOnly ? strong : [...strong, ...ranked.filter((k) => !k.strong).slice(0, 3 - strong.length)];
    return pool.slice(0, max).map((k) => k.term);
  }

  // extension/src/ui/holdercheck.js
  var RULES = {
    maxScore: 30,
    // RugCheck normalised score, lower is safer
    minHolders: 150,
    maxTopHolder: 15,
    // % of supply in one wallet, pools excluded
    maxTop10: 50,
    maxInsiders: 25
    // % held by wallets RugCheck links together
  };
  var alive = (t) => t.onCurve ? t.volume?.h24 >= 500 : t.liquidity >= 2e3 && t.volume?.h24 >= 250;
  var pct = (v) => `${v < 10 ? v.toFixed(1) : Math.round(v)}%`;
  function marketBlock(token) {
    if (token?.chain !== "solana") return "not on Solana";
    if (!alive(token)) return "not trading";
    if (!token.mcapBacked && !token.onCurve && (token.liquidity || 0) < 5e4) return "thin liquidity for its market cap";
    return null;
  }
  function reportBlock(report, rules = RULES) {
    if (!report) return "no RugCheck report";
    if (report.rugged) return "liquidity pulled";
    if (report.freezeAuthority) return "freeze authority is on";
    if (report.mintAuthority) return "mint authority is on";
    const danger = (report.risks || []).find((r) => /danger|critical|high/i.test(r.level || ""));
    if (danger) return `RugCheck flags ${String(danger.name || "a danger").toLowerCase()}`;
    if (report.score == null) return "no RugCheck score";
    if (report.score > rules.maxScore) return `RugCheck score ${report.score}`;
    if (report.holders == null) return "holder count unknown";
    if (report.holders < rules.minHolders) return `only ${report.holders} holders`;
    if ((report.topHolder?.pct || 0) > rules.maxTopHolder) return `one wallet holds ${pct(report.topHolder.pct)}`;
    if ((report.top10Pct || 0) > rules.maxTop10) return `top 10 hold ${pct(report.top10Pct)}`;
    if ((report.insiderPct || 0) >= rules.maxInsiders) return `insiders hold ${pct(report.insiderPct)}`;
    return null;
  }

  // extension/src/lib/market.js
  var DS = "https://api.dexscreener.com";
  var quoteKey = (a) => /^0x/i.test(a || "") ? a.toLowerCase() : a;
  var QUOTES = new Set([
    "So11111111111111111111111111111111111111112",
    // wSOL
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    // USDC
    "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    // USDT
    // Robinhood Chain: WETH, native ETH (Uniswap v4 pools) and USDG, the dollar its pools trade against. Its stock tokens
    // (SPY, NVDA…) also pair memecoins, but copies of them exist, so they don't count as real liquidity.
    "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
    "0x0000000000000000000000000000000000000000",
    "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
    // Base: WETH and USDC (native ETH is the zero address above). BNB Chain: WBNB, USDT, USDC, BUSD.
    "0x4200000000000000000000000000000000000006",
    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    "0x55d398326f99059fF775485246999027B3197955",
    "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56"
  ].map(quoteKey));
  var LAUNCHPADS = /* @__PURE__ */ new Set(["pumpfun", "launchlab", "meteoradbc", "moonshot", "boop", "heaven", "believe", "bags", "moonit", "jupstudio", "flapsh", "fourmeme"]);
  async function getJson(url) {
    for (let i = 0; i < 4; i++) {
      const res = await gmFetch(url, { signal: AbortSignal.timeout(8e3) });
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 1500 * 2 ** i));
        continue;
      }
      if (!res.ok) throw new Error(`DexScreener ${res.status}`);
      return res.json();
    }
    throw new Error("DexScreener rate limited");
  }
  async function searchPairs(query) {
    const j = await getJson(`${DS}/latest/dex/search?q=${encodeURIComponent(query)}`);
    return j.pairs || [];
  }
  async function pairsForTokens(chain, addresses) {
    const out = [];
    for (let i = 0; i < addresses.length; i += 30) {
      const chunk = addresses.slice(i, i + 30);
      const j = await getJson(`${DS}/tokens/v1/${chain}/${chunk.join(",")}`);
      if (Array.isArray(j)) out.push(...j);
    }
    return out;
  }
  async function allPairs(chain, address) {
    const j = await getJson(`${DS}/token-pairs/v1/${chain}/${address}`);
    return Array.isArray(j) ? j : [];
  }
  async function allPairsMany(refs, concurrency = 6) {
    const out = [];
    let i = 0;
    const worker = async () => {
      while (i < refs.length) {
        const { chain, address } = refs[i++];
        out.push(...await allPairs(chain, address).catch(() => []));
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, refs.length) }, worker));
    return out;
  }
  var n = (x) => Number.isFinite(+x) ? +x : 0;
  function realLiquidity(p) {
    if (!QUOTES.has(quoteKey(p.quoteToken?.address))) return 0;
    const quoteUsd = n(p.liquidity?.quote) * (n(p.priceNative) ? n(p.priceUsd) / n(p.priceNative) : 0);
    return Math.min(n(p.liquidity?.usd), 2 * quoteUsd);
  }
  function aggregate(pairs) {
    const byToken = /* @__PURE__ */ new Map();
    for (const p of pairs) {
      if (!p?.baseToken?.address || QUOTES.has(quoteKey(p.baseToken.address))) continue;
      const key = `${p.chainId}:${p.baseToken.address}`;
      if (!byToken.has(key)) byToken.set(key, []);
      const list = byToken.get(key);
      if (!list.some((q) => q.pairAddress === p.pairAddress)) list.push(p);
    }
    const tokens = [];
    for (const list of byToken.values()) {
      const primary = [...list].sort((a, b) => n(b.liquidity?.usd) - n(a.liquidity?.usd) || n(b.volume?.h24) - n(a.volume?.h24))[0];
      const dated = list.filter((p) => p.pairCreatedAt).sort((a, b) => a.pairCreatedAt - b.pairCreatedAt);
      const first = dated[0];
      const info = list.find((p) => p.info?.imageUrl)?.info || primary.info || {};
      const sum = (f) => list.reduce((s, p) => s + n(f(p)), 0);
      const liquidity = sum(realLiquidity);
      const reportedLiquidity = sum((p) => p.liquidity?.usd);
      const marketCap = n(primary.marketCap) || n(primary.fdv);
      const onCurve = LAUNCHPADS.has(primary.dexId);
      tokens.push({
        chain: primary.chainId,
        address: primary.baseToken.address,
        name: primary.baseToken.name,
        // Some tickers carry their own "$" ($WIF); everything that shows one adds it, so it's dropped here.
        symbol: String(primary.baseToken.symbol || "").trim().replace(/^\$+/, ""),
        image: info.imageUrl || null,
        websites: (info.websites || []).map((w) => w.url).slice(0, 3),
        socials: (info.socials || []).map((s) => ({ type: s.type, url: s.url })).slice(0, 4),
        priceUsd: n(primary.priceUsd),
        marketCap,
        fdv: n(primary.fdv),
        liquidity,
        reportedLiquidity,
        volume: { m5: sum((p) => p.volume?.m5), h1: sum((p) => p.volume?.h1), h6: sum((p) => p.volume?.h6), h24: sum((p) => p.volume?.h24) },
        txns: {
          h1: { buys: sum((p) => p.txns?.h1?.buys), sells: sum((p) => p.txns?.h1?.sells) },
          h24: { buys: sum((p) => p.txns?.h24?.buys), sells: sum((p) => p.txns?.h24?.sells) }
        },
        priceChange: primary.priceChange || {},
        createdAt: first?.pairCreatedAt || null,
        launchDex: first?.dexId || primary.dexId,
        launchPair: first?.pairAddress || null,
        pair: primary.pairAddress,
        dexId: primary.dexId,
        onCurve,
        pairAddresses: list.map((p) => p.pairAddress),
        url: primary.url,
        links: [...new Set(list.flatMap((p) => [...p.info?.websites || [], ...p.info?.socials || []].map((x) => x.url)).filter(Boolean))],
        boosts: n(primary.boosts?.active),
        // MC with almost nothing behind it (or a curve with zero trades) is not a real cap.
        mcapBacked: onCurve ? n(primary.volume?.h24) > 0 : liquidity >= 1e3 && marketCap / Math.max(liquidity, 1) < 150,
        updatedAt: Date.now()
      });
    }
    return tokens;
  }
  function relevance(token, keywords) {
    const sym = norm(token.symbol || "");
    const name = norm(token.name || "");
    const words = new Set(`${token.name} ${token.symbol}`.split(/[^A-Za-z0-9À-ɏ]+/).map(norm).filter(Boolean));
    let score = 0;
    const matched = [];
    keywords.forEach((kw, i) => {
      const k = norm(kw);
      if (k.length < 2) return;
      const w = 1 / (1 + i * 0.25);
      let hit = 0;
      if (sym === k || name === k) hit = 4;
      else if (words.has(k)) hit = 2.5;
      else if (k.length >= 5 && (sym.includes(k) || name.includes(k))) hit = 2;
      else if (kw.includes(" ")) {
        const parts = kw.split(/\s+/).map(norm).filter((p) => p.length >= 3);
        if (parts.length && parts.every((p) => name.includes(p) || sym.includes(p))) hit = 3;
      }
      if (hit) {
        score += hit * w;
        matched.push(kw);
      }
    });
    return { score, matched };
  }
  var NON_MEME = /\b(prestocks?|xstocks?|tokenized|securities|backed|wrapped|wormhole|bridged|binance-peg|portal|ondo|stablecoin|usd coin|tether|robinhood token|global dollar)\b/i;
  var MAJOR_NAMES = new Set("bitcoin ethereum zcash solana hyperliquid xrp ripple bnb cardano chainlink sui aptos near tron litecoin monero avalanche polkadot toncoin dogecoin stellar cosmos arbitrum optimism polygon".split(" "));
  var MAJOR_TICKERS = new Set("BTC ETH ZEC SOL HYPE XRP BNB ADA LINK SUI APT NEAR TRX LTC XMR AVAX DOT TON XLM ATOM ARB OP POL".split(" "));
  function isMemecoin(t) {
    if (NON_MEME.test(`${t.name} ${t.symbol}`)) return false;
    if (/^(usdc|usdt|usds|usdg|pyusd|dai|weth|wbtc|cbbtc|wsol|msol|jitosol)$/i.test(t.symbol)) return false;
    if (!t.mcapBacked && !t.onCurve && t.marketCap > 5e7) return false;
    const majorName = MAJOR_NAMES.has(String(t.name).toLowerCase().trim());
    const majorTicker = MAJOR_TICKERS.has(String(t.symbol).toUpperCase());
    if (majorName && majorTicker || t.marketCap > 1e7 && (majorName || majorTicker)) return false;
    return true;
  }
  function pickThree(tokens, { cuts = [0.3, 0.15, 0], allowFallback = true } = {}) {
    const maxRel = Math.max(0, ...tokens.map((t) => t.relevance || 0));
    let live = [];
    let cutUsed = 0;
    for (const cut of cuts) {
      cutUsed = cut;
      live = tokens.filter((t) => (t.relevance || 0) >= maxRel * cut && alive(t));
      if (live.length >= 3) break;
    }
    if (!live.length && allowFallback) live = tokens.filter((t) => t.volume.h24 > 0);
    const used = /* @__PURE__ */ new Set();
    const take = (t, role) => {
      if (t) used.add(t.address);
      return t ? { role, token: t } : null;
    };
    const top = [...live].filter((t) => t.mcapBacked).sort((a, b) => b.marketCap - a.marketCap)[0];
    const picks = [take(top, "top")];
    const exists = (t) => alive(t) || t.liquidity >= 3e3;
    const og = tokens.filter((t) => t.createdAt && !used.has(t.address) && (t.relevance || 0) >= maxRel * cutUsed && exists(t)).sort((a, b) => a.createdAt - b.createdAt)[0];
    picks.push(take(og, "og"));
    const momentum = (t) => {
      const ch = n(t.priceChange.h1 ?? t.priceChange.h6);
      const flow = Math.log10(10 + t.volume.h1);
      const buyRatio = (t.txns.h1.buys + 1) / (t.txns.h1.sells + 1);
      return ch * flow * Math.min(buyRatio, 3);
    };
    const movers = live.filter((t) => !used.has(t.address) && t.volume.h1 >= 1e3);
    const mover = (movers.length ? movers : live.filter((t) => !used.has(t.address) && t.volume.h24 >= 250)).sort((a, b) => momentum(b) - momentum(a) || b.volume.h24 - a.volume.h24)[0];
    picks.push(take(mover, "mover"));
    const best = {
      top: [...live].filter((t) => t.mcapBacked).sort((a, b) => b.marketCap - a.marketCap)[0]?.address,
      og: tokens.filter((t) => t.createdAt && (t.relevance || 0) >= maxRel * cutUsed && exists(t)).sort((a, b) => a.createdAt - b.createdAt)[0]?.address,
      mover: live.filter((t) => t.volume.h1 >= 1e3).sort((a, b) => momentum(b) - momentum(a))[0]?.address
    };
    for (const p of picks) {
      if (!p) continue;
      p.alsoTop = p.role !== "top" && best.top === p.token.address;
      p.alsoOg = p.role !== "og" && best.og === p.token.address;
      p.alsoMover = p.role !== "mover" && best.mover === p.token.address && momentum(p.token) > 0;
    }
    const others = tokens.filter((t) => !used.has(t.address)).sort((a, b) => b.mcapBacked - a.mcapBacked || b.marketCap - a.marketCap).slice(0, 12);
    return { picks: picks.filter(Boolean), others, roleCandidates: tokens, roleCut: cutUsed };
  }
  async function fullTokens(refs, deep = /* @__PURE__ */ new Set()) {
    const deepRefs = refs.filter((r) => deep.has(r.address));
    const byChain = /* @__PURE__ */ new Map();
    for (const { chain, address } of refs) {
      if (deep.has(address)) continue;
      if (!byChain.has(chain)) byChain.set(chain, []);
      byChain.get(chain).push(address);
    }
    const [deepPairs, ...rest] = await Promise.all([
      allPairsMany(deepRefs),
      ...[...byChain].map(([c, a]) => pairsForTokens(c, a).catch(() => []))
    ]);
    return aggregate([...deepPairs, ...rest.flat()]);
  }
  var SOL_CA = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;
  var EVM_CA = /\b0x[a-fA-F0-9]{40}\b/g;
  var LINKED_ELSEWHERE = /\b(ethereum|base|bsc|arbitrum|polygon|optimism|avalanche):(0x[a-fA-F0-9]{40})\b/gi;
  async function typedCashtags(text, symbolOf) {
    const links2 = [...new Set(String(text || "").match(LINKED_ELSEWHERE) || [])].slice(0, 3);
    let out = String(text || "");
    for (const link of links2) {
      const [chain, address] = link.split(":");
      const symbol = await symbolOf(chain.toLowerCase(), address).catch(() => null);
      if (/^[A-Za-z][A-Za-z0-9]{0,11}$/.test(symbol || "")) out = out.split(link).join(`$${symbol}`);
    }
    return out;
  }
  async function linkedSymbol(chain, address) {
    const r = await gmFetch(`https://api.dexscreener.com/tokens/v1/${chain}/${address}`, { signal: AbortSignal.timeout(8e3) });
    const pairs = r.ok ? await r.json() : [];
    const key = address.toLowerCase();
    const pair = (Array.isArray(pairs) ? pairs : []).find((p) => [p.baseToken?.address, p.quoteToken?.address].some((a) => a?.toLowerCase() === key));
    return pair ? (pair.baseToken.address.toLowerCase() === key ? pair.baseToken : pair.quoteToken).symbol : null;
  }
  async function mentionedTokens(text, chains, search = searchPairs) {
    const cas = [.../* @__PURE__ */ new Set([...text.match(SOL_CA) || [], ...text.match(EVM_CA) || []])].slice(0, 3);
    const found = await Promise.all(cas.map(async (ca) => {
      const key = ca.toLowerCase();
      const hit = aggregate(await search(ca).catch(() => [])).find((t) => t.address.toLowerCase() === key || t.pairAddresses?.some((p) => p.toLowerCase() === key));
      if (!hit) return null;
      return aggregate(await allPairsMany([hit]).catch(() => [])).find((t) => t.address === hit.address && chains.includes(t.chain)) || null;
    }));
    return [...new Map(found.filter(Boolean).map((t) => [t.address, t])).values()];
  }

  // extension/src/lib/rugcheck.js
  var RC = "https://api.rugcheck.xyz/v1";
  async function rugReport(mint, pairAddresses = []) {
    const res = await gmFetch(`${RC}/tokens/${mint}/report`);
    if (res.status === 429) throw new Error("RugCheck rate limited");
    if (!res.ok) throw new Error(`RugCheck ${res.status}`);
    const r = await res.json();
    const supply = Number(r.token?.supply || 0);
    const pct3 = (raw) => supply ? Number(raw) / supply * 100 : 0;
    const known = r.knownAccounts || {};
    const pools = new Set(pairAddresses);
    for (const m of r.markets || []) {
      if (m.pubkey) pools.add(m.pubkey);
      if (m.liquidityA) pools.add(m.liquidityA);
      if (m.liquidityB) pools.add(m.liquidityB);
    }
    const isPool = (h) => pools.has(h.owner) || pools.has(h.address) || ["AMM", "LOCKER"].includes(known[h.owner]?.type) || ["AMM", "LOCKER"].includes(known[h.address]?.type);
    const holders = (r.topHolders || []).filter((h) => !isPool(h));
    const top10 = holders.slice(0, 10).reduce((s, h) => s + (h.pct || 0), 0);
    const insiderHeld = (r.insiderNetworks || []).reduce((s, n2) => s + Number(n2.currentHolding || 0), 0);
    const lpLocked = Math.max(0, ...(r.markets || []).map((m) => m.lp?.lpLockedPct || 0));
    const inPool = (m) => Number(m.lp?.baseMint === mint ? m.lp?.base : m.lp?.quoteMint === mint ? m.lp?.quote : 0) || 0;
    const poolTokens = (r.markets || []).reduce((s, m) => s + inPool(m), 0);
    const decimals = Number(r.token?.decimals ?? 0);
    return {
      score: r.score_normalised ?? null,
      rugged: !!r.rugged,
      risks: (r.risks || []).map((x) => ({ name: x.name, level: x.level, value: x.value })).slice(0, 6),
      mintAuthority: r.mintAuthority || null,
      freezeAuthority: r.freezeAuthority || null,
      holders: r.totalHolders ?? null,
      top10Pct: top10,
      topHolder: holders[0] ? { pct: holders[0].pct, insider: !!holders[0].insider } : null,
      insiderWallets: r.graphInsidersDetected ?? 0,
      // RugCheck tallies cluster transfers cumulatively; above 100% it isn't a holding figure.
      insiderPct: pct3(insiderHeld) <= 100 ? pct3(insiderHeld) : null,
      creator: r.creator || null,
      creatorPct: pct3(r.creatorBalance || 0),
      lpLockedPct: lpLocked,
      poolTokens: poolTokens || null,
      supplyTokens: supply ? supply / 10 ** decimals : null,
      copycat: (r.risks || []).some((x) => /copycat/i.test(x.name || "")),
      launchpad: r.launchpad?.name || null,
      tokenProgram: r.tokenProgram,
      detectedAt: r.detectedAt || null
    };
  }

  // extension/src/lib/narrative.js
  var passthrough = (_k, _ttl, fn) => fn();
  async function engine(apiBase, path, body, timeoutMs = 15e3) {
    const res = await gmFetch(`${apiBase}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Narrative engine ${res.status}`);
    return data;
  }
  async function inBatches(items, size, fn) {
    const out = new Array(items.length);
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }));
    return out;
  }
  var fmtUsd = (n2) => n2 >= 1e9 ? `$${(n2 / 1e9).toFixed(1)}B` : n2 >= 1e6 ? `$${(n2 / 1e6).toFixed(1)}M` : n2 >= 1e3 ? `$${(n2 / 1e3).toFixed(0)}K` : `$${Math.round(n2)}`;
  var fmtAge = (ms) => {
    if (!ms) return "?";
    const h = (Date.now() - ms) / 36e5;
    return h < 1 ? `${Math.round(h * 60)}m` : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`;
  };
  async function readPost(post, chains, { apiBase, cached = passthrough }) {
    const fullText = [post.text, post.quoted, post.card, post.parent].filter(Boolean).join("\n");
    for (const k of extractKeywords(fullText.replace(SOL_CA, " ").replace(EVM_CA, " "), 3, { strongOnly: true })) {
      cached(`q:${k.toLowerCase()}`, 3e5, () => searchPairs(k)).catch(() => {
      });
    }
    const [mentioned, transcript] = await Promise.all([
      mentionedTokens(fullText, chains, (q) => cached(`q:${q}`, 2e4, () => searchPairs(q))),
      post.videoUrl && !post.gif ? cached(`tr:${post.videoUrl}`, 36e5, () => engine(apiBase, "transcribe", { videoUrl: post.videoUrl })).then((r) => r.text).catch(() => "") : ""
    ]);
    const full = transcript ? { ...post, transcript } : post;
    const named = mentioned.map((t) => `${t.name} ($${t.symbol})`).join(", ");
    let read;
    try {
      read = await engine(apiBase, "interpret", { post: named ? { ...full, text: `${full.text || ""}
[Coin in this post: ${named}]` } : full }, 35e3);
    } catch (e) {
      if (!mentioned.length) throw e;
      return { narrative: "", engineError: e.message, coinable: true, terms: [], anchors: [], judge: false, mentioned, tickers: [], post: full };
    }
    const seen = new Set(mentioned.map((t) => t.address.toLowerCase()));
    const fromImages = (read.cas || []).filter((a) => !seen.has(a.toLowerCase()));
    if (fromImages.length) {
      mentioned.push(...await mentionedTokens(fromImages.join(" "), chains, (q) => cached(`q:${q}`, 2e4, () => searchPairs(q))).catch(() => []));
    }
    return { narrative: read.narrative, coinable: read.coinable, terms: read.terms || [], anchors: read.anchors || [], judge: read.judge !== false && !read.anchors?.length, mentioned, tickers: read.tickers || [], post: full };
  }
  function anchorHits(t, anchors) {
    const name = norm(t.name || "");
    const sym = norm(t.symbol || "");
    const words = new Set(`${t.name} ${t.symbol}`.split(/[^A-Za-z0-9À-ɏ]+/).map(norm).filter(Boolean));
    return anchors.filter((a) => {
      const k = norm(a);
      if (!k) return false;
      return k.length <= 3 ? words.has(k) || sym === k : name.includes(k) || sym.includes(k);
    }).length;
  }
  var TECH_CUES = /\b(?:technology|tech|software|hardware|application|app|platform|tool|open[- ]?source|github|repository|repo|developer|coding|code|artificial intelligence|ai|large language model|llm|model|agent|robot(?:ics)?|gpu|chip|semiconductor|compute|computing|protocol|framework|library|browser|operating system|cloud|saas|api)\b/i;
  function findTechMatch(tokens, mentioned, anchors, scores, narrative, post) {
    const context = [narrative, post?.text, post?.quoted, post?.card, post?.parent, post?.transcript].filter(Boolean).join(" ");
    if (!TECH_CUES.test(context) || !anchors.length) return null;
    const matches = [];
    for (const token of mentioned || []) {
      const anchorIndex = anchors.findIndex((a) => anchorHits(token, [a]) > 0);
      if (anchorIndex >= 0) matches.push({ token, anchorIndex, score: 100 });
    }
    for (const token of tokens) {
      if (!scores.has(token.address)) continue;
      const anchorIndex = anchors.findIndex((a) => anchorHits(token, [a]) > 0);
      if (anchorIndex >= 0) matches.push({ token, anchorIndex, score: scores.get(token.address).score || 0 });
    }
    if (!matches.length) return null;
    const firstAnchor = Math.min(...matches.map((m) => m.anchorIndex));
    const best = matches.filter((m) => m.anchorIndex === firstAnchor).sort((a, b) => b.score - a.score || Number(Boolean(b.token.mcapBacked)) - Number(Boolean(a.token.mcapBacked)) || (b.token.marketCap || 0) - (a.token.marketCap || 0))[0];
    return { ...best.token, techAnchor: anchors[firstAnchor] };
  }
  async function findCoins({ narrative, coinable, terms, anchors = [], judge = true, mentioned, tickers = [], post, engineError }, chains, { apiBase, cached = passthrough }) {
    const t0 = Date.now();
    const timing = {};
    const lap = (k) => {
      timing[k] = Date.now() - t0;
    };
    const base = { mode: "ai", narrative, coinable, mentioned, tickers, anchors, terms, engineError, ts: Date.now(), timing, techMatch: null };
    if (!terms.length) return { ...base, picks: [], others: [], techMatch: findTechMatch([], mentioned, anchors, /* @__PURE__ */ new Map(), narrative, post) };
    const statusId = post.url?.match(/status\/(\d+)/)?.[1] || null;
    let failed = 0;
    const hits = await inBatches(terms.slice(0, 5), 3, (t) => cached(`q:${t.toLowerCase()}`, 3e5, () => searchPairs(t)).catch(() => {
      failed++;
      return [];
    }));
    if (failed === hits.length) throw new Error("DexScreener is rate-limiting right now, try again in a few seconds");
    lap("search");
    const skip = new Set(mentioned.map((t) => t.address));
    const candidates = aggregate(hits.flat().filter((p) => chains.includes(p.chainId) && !skip.has(p.baseToken?.address))).filter((t) => (t.volume.h24 > 0 || t.liquidity > 0) && isMemecoin(t)).map((t) => ({ ...t, fromPost: !!statusId && t.links.some((l) => l.includes(statusId)) })).map((t) => ({ t, r: relevance(t, terms).score + (t.fromPost ? 50 : 0) })).sort((a, b) => b.r - a.r || b.t.marketCap - a.t.marketCap).slice(0, judge ? 30 : 60);
    if (!candidates.length) return { ...base, picks: [], others: [], techMatch: findTechMatch([], mentioned, anchors, /* @__PURE__ */ new Map(), narrative, post) };
    let scores;
    if (!judge && anchors.length) {
      scores = /* @__PURE__ */ new Map();
      const main = anchors.slice(0, 2);
      for (const c of candidates) {
        const hits2 = anchorHits(c.t, anchors);
        const mainHit = anchorHits(c.t, main) > 0;
        if (c.t.fromPost || mainHit || hits2 >= 2) {
          scores.set(c.t.address, { score: c.t.fromPost ? 99 : Math.min(95, 62 + hits2 * 10 + (mainHit ? 8 : 0) + Math.min(c.r, 8) * 2), reason: "" });
        }
      }
      lap("anchors");
    } else {
      const brief = ({ t }) => ({
        name: t.name,
        symbol: t.symbol,
        age: fmtAge(t.createdAt),
        mc: fmtUsd(t.marketCap),
        vol: fmtUsd(t.volume.h24),
        fromPost: t.fromPost,
        links: t.links.slice(0, 2)
      });
      const halves = candidates.length > 12 ? [candidates.slice(0, Math.ceil(candidates.length / 2)), candidates.slice(Math.ceil(candidates.length / 2))] : [candidates];
      const verdicts = await Promise.all(halves.map((part) => engine(apiBase, "judge", { narrative, post, candidates: part.map(brief) }, 9e3).then((v) => v.matches.map((m) => ({ ...m, t: part[m.i]?.t }))).catch(() => part.filter((c) => c.r >= 3).slice(0, 5).map((c) => ({ t: c.t, score: Math.min(85, 55 + c.r * 4) })))));
      lap("judge");
      scores = new Map(verdicts.flat().filter((m) => m.t).map((m) => [m.t.address, { score: m.score, reason: "" }]));
    }
    for (const { t } of candidates) if (t.fromPost) scores.set(t.address, { score: 99, reason: "Launched with this post as its link" });
    const pool = candidates.map((c) => c.t);
    if (!scores.size) return { ...base, picks: [], others: [], pool, techMatch: findTechMatch([], mentioned, anchors, scores, narrative, post) };
    const refs = candidates.map((c) => c.t).filter((t) => scores.has(t.address));
    const fromPost = new Set(refs.filter((t) => t.fromPost).map((t) => t.address));
    let tokens = await Promise.race([
      fullTokens(refs, new Set(refs.slice(0, 10).map((t) => t.address))),
      new Promise((resolve) => setTimeout(() => resolve(refs), 5e3))
      // keep search data if pool lookups stall
    ]).catch(() => refs);
    lap("pools");
    tokens = tokens.filter((t) => scores.has(t.address)).map((t) => ({
      ...t,
      relevance: scores.get(t.address).score,
      reason: scores.get(t.address).reason,
      fromPost: fromPost.has(t.address)
    }));
    const { picks, others, roleCandidates, roleCut } = pickThree(tokens, { cuts: [0.85, 0.7, 0] });
    const techMatch = findTechMatch(tokens, mentioned, anchors, scores, narrative, post);
    const remaining = techMatch ? others.filter((t) => t.address !== techMatch.address) : others;
    return { ...base, picks, others: remaining, roleCandidates, roleCut, techMatch, pool };
  }

  // extension/src/lib/slot-calendar.js
  var SLOT_CALENDAR = [[15e7, 1662797255], [152e6, 1663944353], [154000004, 1665076966], [156e6, 1666093102], [158e6, 1667007032], [16e7, 1667926448], [162000008, 1668890635], [164e6, 1669778031], [166e6, 1670657155], [168e6, 1671546496], [17e7, 1672459520], [172e6, 1673474555], [174e6, 1674489177], [176e6, 1675518695], [178e6, 1676516267], [18e7, 1677596860], [182e6, 1678543697], [184e6, 1679473919], [186e6, 1680387936], [188e6, 1681302264], [190000004, 1682237445], [192e6, 1683171950], [194e6, 1684129925], [196e6, 1685075075], [198e6, 1686012205], [2e8, 1686964563], [202e6, 1687867231], [204e6, 1688759973], [206e6, 1689652171], [208e6, 1690541557], [21e7, 1691414422], [212e6, 1692289656], [214e6, 1693165847], [216e6, 1694034974], [218e6, 1694908030], [22e7, 1695776956], [222e6, 1696629027], [224e6, 1697447910], [226e6, 1698284119], [228e6, 1699125487], [23e7, 1699980689], [232e6, 1700847975], [234e6, 1701717557], [236e6, 1702627471], [238e6, 1703535576], [24e7, 1704448793], [242e6, 1705338139], [244e6, 1706177244], [246e6, 1707012984], [248e6, 1707865481], [25e7, 1708711006], [252e6, 1709542560], [254e6, 1710369140], [256e6, 1711218964], [258e6, 1712091604], [260000001, 1713060778], [262e6, 1713972615], [264e6, 1714906625], [266e6, 1715808913], [268e6, 1716699818], [270000004, 1717579083], [272e6, 1718458817], [274e6, 1719353353], [276e6, 1720265429], [278e6, 1721190245], [28e7, 1722098996], [282e6, 1722986003], [284e6, 1723832279], [286e6, 1724699660], [288e6, 1725561974], [29e7, 1726428607], [292000004, 1727302965], [294e6, 1728199583], [296e6, 1729107554], [298e6, 1730035922], [3e8, 1730981797], [302e6, 1731873734], [304e6, 1732740416], [306e6, 1733585764], [308000001, 1734418305], [31e7, 1735247256], [312e6, 1736067304], [314e6, 1736882790], [316e6, 1737696989], [318e6, 1738503815], [32e7, 1739299195], [322e6, 1740091911], [324e6, 1740883460], [326e6, 1741677027], [328e6, 1742473441], [33e7, 1743272074], [332e6, 1744073062], [334e6, 1744869448], [336e6, 1745661130], [338e6, 1746451136], [34e7, 1747241593], [342e6, 1748032283], [344e6, 1748819779], [346e6, 1749608331], [348e6, 1750409570], [35e7, 1751210681], [352e6, 1752003616], [354e6, 1752794914], [356e6, 1753587992], [358e6, 1754384135], [36e7, 1755175119], [362e6, 1755961857], [364e6, 1756750694], [366e6, 1757549394], [368e6, 1758340659], [37e7, 1759132548], [372e6, 1759923564], [374e6, 1760717592], [376e6, 1761513103], [378e6, 1762312930], [38e7, 1763114049], [382e6, 1763907970], [384e6, 1764687370], [386e6, 1765466673], [388e6, 1766247217], [39e7, 1767032013], [392e6, 1767823349], [394e6, 1768613592], [396e6, 1769410269], [398e6, 1770207278], [4e8, 1770991680], [402e6, 1771775802], [404e6, 1772565475], [406e6, 1773351789], [408e6, 1774140455], [41e7, 1774924856], [412e6, 1775710212], [414e6, 1776500451], [416e6, 1777292227], [418e6, 1778084423], [42e7, 1778886814], [422e6, 1779684999], [424e6, 1780479071], [426e6, 1781274748], [428e6, 1782068334], [43e7, 1782871687], [432e6, 1783681917], [434e6, 1784508165], [436e6, 1785350442], [438e6, 1786195117], [44e7, 1787032201], [442e6, 1787796056], [444e6, 1788447562], [446e6, 1789080019], [448e6, 1789712262], [45e7, 1790245257], [452e6, 1790780786], [454e6, 1791316189], [456e6, 1791797896], [458e6, 1792232162]];

  // extension/src/lib/solana.js
  var PUBLIC_RPC = "https://api.mainnet-beta.solana.com";
  async function tokenSupply(rpc, mint) {
    const info = await rpc("getAccountInfo", [mint, { encoding: "jsonParsed", commitment: "confirmed" }]);
    const amount = info?.value?.data?.parsed?.info?.supply;
    if (amount == null) throw new Error("Not a token mint");
    return BigInt(amount);
  }
  var SKIPPED = /* @__PURE__ */ new Set([-32007, -32009, -32004, -32001]);
  var OUT_OF_RANGE = -32602;
  var SLOT_SECONDS = 0.4;
  var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function makeRpc(url = PUBLIC_RPC, { concurrency = 2 } = {}) {
    let id = 0;
    let active = 0;
    const queue = [];
    const pump = () => {
      while (active < concurrency && queue.length) {
        const job = queue.pop();
        active++;
        job().finally(() => {
          active--;
          pump();
        });
      }
    };
    const schedule = (fn) => new Promise((resolve, reject) => {
      queue.push(() => fn().then(resolve, reject));
      pump();
    });
    async function call(method, params, retries = 5) {
      for (let attempt = 0; ; attempt++) {
        let res;
        try {
          res = await gmFetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params })
          });
        } catch (e) {
          if (attempt >= retries) throw e;
          await sleep(600 * 2 ** attempt);
          continue;
        }
        if (res.status === 429 || res.status >= 500) {
          if (attempt >= retries) throw new Error(`RPC HTTP ${res.status} (rate limited \u2014 add your own RPC in settings)`);
          await sleep(900 * 2 ** attempt);
          continue;
        }
        const json = await res.json();
        if (json.error) {
          const err = new Error(json.error.message);
          err.code = json.error.code;
          throw err;
        }
        return json.result;
      }
    }
    return (method, params) => schedule(() => call(method, params));
  }
  async function blockTimeNear(rpc, slot, dir = 1) {
    for (let i = 0; i < 8; i++) {
      const s = slot + i * dir;
      try {
        const t = await rpc("getBlockTime", [s]);
        if (t != null) return { slot: s, t };
      } catch (e) {
        if (!SKIPPED.has(e.code) && e.code !== OUT_OF_RANGE) throw e;
      }
    }
    throw new Error(`No block time near slot ${slot}`);
  }
  var tipMark = null;
  async function tipPoint(rpc) {
    if (tipMark && Date.now() - tipMark.at < 3e5) return tipMark;
    const tip = await rpc("getSlot", [{ commitment: "finalized" }]);
    tipMark = { slot: tip, t: Math.floor(Date.now() / 1e3) - 13, at: Date.now() };
    return tipMark;
  }
  async function estimateSlot(rpc, T2) {
    const cal = SLOT_CALENDAR;
    if (cal.length >= 2 && T2 >= cal[0][1] && T2 <= cal[cal.length - 1][1]) {
      let i = cal.findIndex(([, t]) => t >= T2);
      if (i <= 0) i = 1;
      const [s02, t02] = cal[i - 1];
      const [s1, t1] = cal[i];
      return Math.round(s02 + (T2 - t02) / Math.max(1, t1 - t02) * (s1 - s02));
    }
    const tip = await tipPoint(rpc);
    const [s0, t0] = cal.length ? cal[cal.length - 1] : [tip.slot - 3e3, tip.t - 3e3 * SLOT_SECONDS];
    const rate = (tip.t - t0) / Math.max(1, tip.slot - s0) || SLOT_SECONDS;
    return Math.min(tip.slot, Math.round(tip.slot - (tip.t - T2) / rate));
  }
  async function slotNearTime(rpc, T2) {
    let a = await blockTimeNear(rpc, await estimateSlot(rpc, T2));
    if (Math.abs(T2 - a.t) <= 1) return a.slot;
    let rate = SLOT_SECONDS;
    let s = a.slot + Math.round((T2 - a.t) / rate);
    for (let i = 0; i < 6; i++) {
      const b = await blockTimeNear(rpc, s);
      const d = T2 - b.t;
      if (Math.abs(d) <= 1) return b.slot;
      if (b.t !== a.t && b.slot !== a.slot) {
        const r = (b.t - a.t) / (b.slot - a.slot);
        if (r > 0.05 && r < 1) rate = r;
      }
      a = b;
      s = b.slot + Math.round(d / rate);
    }
    return a.slot;
  }
  async function getBlock(rpc, slot) {
    try {
      return await rpc("getBlock", [slot, {
        encoding: "jsonParsed",
        transactionDetails: "accounts",
        rewards: false,
        maxSupportedTransactionVersion: 1,
        commitment: "finalized"
      }]);
    } catch (e) {
      if (SKIPPED.has(e.code)) return null;
      throw e;
    }
  }
  var touchesMint = (tx, mint) => !tx.meta?.err && (tx.meta?.postTokenBalances || []).some((b) => b.mint === mint);
  async function findLaunchBlockByTime(rpc, mint, T2) {
    const center = await slotNearTime(rpc, T2);
    const slots = await rpc("getBlocks", [center - 14, center + 14, { commitment: "finalized" }]);
    const hits = [];
    const order = [...slots].sort((x, y) => Math.abs(x - center) - Math.abs(y - center));
    for (const s of order.slice(0, 16)) {
      const block = await getBlock(rpc, s);
      if (!block || block.blockTime < T2 - 1 || block.blockTime > T2 + 1) continue;
      if (block.transactions.some((tx) => touchesMint(tx, mint))) {
        hits.push({ slot: s, block });
        const earlier = slots.filter((x) => x < s && x >= s - 10);
        for (const e of earlier) {
          const eb = await getBlock(rpc, e);
          if (eb && eb.transactions.some((tx) => touchesMint(tx, mint))) hits.push({ slot: e, block: eb });
        }
        break;
      }
    }
    hits.sort((x, y) => x.slot - y.slot);
    return hits[0] || null;
  }
  async function oldestFromTime(rpc, address, T2, maxPages) {
    for (const offset of [60, 600, 3600, 12 * 3600]) {
      const slot = await estimateSlot(rpc, T2 + offset);
      let anchor = null;
      for (let i = 0; i < 6 && !anchor; i++) {
        const b = await rpc("getBlock", [slot + i, { transactionDetails: "signatures", rewards: false, maxSupportedTransactionVersion: 1, commitment: "finalized" }]).catch((e) => {
          if (SKIPPED.has(e.code)) return null;
          throw e;
        });
        anchor = b?.signatures?.at(-1) || null;
      }
      if (!anchor) continue;
      const hist = await oldestSignature(rpc, address, anchor, maxPages);
      if (hist.oldest) return hist;
    }
    return null;
  }
  async function oldestSignature(rpc, mint, before, maxPages) {
    let cursor = before;
    let oldest = null;
    let count = 0;
    for (let page = 0; page < maxPages; page++) {
      const opts = { limit: 1e3, commitment: "finalized" };
      if (cursor) opts.before = cursor;
      const sigs = await rpc("getSignaturesForAddress", [mint, opts]);
      if (!sigs.length) return { oldest, count, complete: true };
      count += sigs.length;
      oldest = sigs[sigs.length - 1];
      cursor = oldest.signature;
      if (sigs.length < 1e3) return { oldest, count, complete: true };
    }
    return { oldest, count, complete: false };
  }
  function analyzeBlock(block, mint, excludeOwners) {
    const buys = [];
    let firstSig = null;
    let creator = null;
    for (const tx of block.transactions) {
      if (!touchesMint(tx, mint)) continue;
      const keys = tx.transaction.accountKeys;
      const sig = tx.transaction.signatures[0];
      const feePayer = keys[0]?.pubkey;
      const pre = /* @__PURE__ */ new Map();
      for (const b of tx.meta.preTokenBalances || []) {
        if (b.mint === mint) pre.set(b.accountIndex, BigInt(b.uiTokenAmount.amount));
      }
      const isCreate = pre.size === 0 && !firstSig;
      if (!firstSig) {
        firstSig = sig;
        if (isCreate) creator = feePayer;
      }
      for (const b of tx.meta.postTokenBalances || []) {
        if (b.mint !== mint || !b.owner) continue;
        const delta = BigInt(b.uiTokenAmount.amount) - (pre.get(b.accountIndex) ?? 0n);
        if (delta <= 0n || excludeOwners.has(b.owner)) continue;
        const signer = keys.some((k) => k.pubkey === b.owner && k.signer);
        buys.push({
          owner: b.owner,
          tokenAccount: keys[b.accountIndex]?.pubkey,
          amount: delta,
          decimals: b.uiTokenAmount.decimals,
          signer,
          sig
        });
      }
    }
    return { buys, firstSig, creator };
  }
  async function currentBalances(rpc, tokenAccounts) {
    const out = /* @__PURE__ */ new Map();
    for (let i = 0; i < tokenAccounts.length; i += 100) {
      const chunk = tokenAccounts.slice(i, i + 100);
      const res = await rpc("getMultipleAccounts", [chunk, { encoding: "jsonParsed", commitment: "confirmed" }]);
      res.value.forEach((acc, j) => {
        const amt = acc?.data?.parsed?.info?.tokenAmount?.amount;
        out.set(chunk[j], amt ? BigInt(amt) : 0n);
      });
    }
    return out;
  }
  async function analyzeLaunch(rpc, mint, launchMs, pairAddrs = [], { maxPages = 8, cached = null, launchIsCreation = true, hintMs = null, launchPair = null } = {}) {
    const exclude = new Set(pairAddrs);
    let launch = cached;
    if (!launch) {
      let found = null;
      let note = null;
      let hist = null;
      if (Number.isFinite(hintMs)) hist = await oldestFromTime(rpc, mint, Math.floor(hintMs / 1e3), maxPages).catch(() => null);
      const young = !Number.isFinite(hintMs) || Date.now() - hintMs < 3 * 864e5;
      if (!hist?.complete && (young || !hist)) {
        const recent = await oldestSignature(rpc, mint, null, young ? maxPages : 2);
        if (recent.complete || !hist) hist = recent;
      }
      if (hist.complete && hist.oldest) {
        const block = await getBlock(rpc, hist.oldest.slot);
        if (block) {
          const signerBuys = analyzeBlock(block, mint, exclude).buys.filter((b) => b.signer);
          const supply2 = await tokenSupply(rpc, mint);
          const minted = signerBuys.some((b) => supply2 > 0n && b.amount * 10n >= supply2 * 9n);
          if (signerBuys.length && !minted) found = { slot: hist.oldest.slot, block };
        }
      }
      if (!found) {
        if (!Number.isFinite(launchMs) || !launchMs) return { ok: false, reason: "No launch time available" };
        if (!hist.complete && !launchIsCreation) {
          return { ok: false, deep: true, reason: `History too deep (>${hist.count.toLocaleString()} txs) to reach launch` };
        }
        if (launchPair) {
          const poolHist = await oldestFromTime(rpc, launchPair, Math.floor(launchMs / 1e3), 3).catch(() => null);
          if (poolHist?.complete && poolHist.oldest) {
            const block = await getBlock(rpc, poolHist.oldest.slot);
            if (block?.transactions.some((tx) => touchesMint(tx, mint))) found = { slot: poolHist.oldest.slot, block };
          }
        }
        if (!found && !hist.complete && !launchPair) found = await findLaunchBlockByTime(rpc, mint, Math.floor(launchMs / 1e3));
        if (!found && hist.complete) found = await findLaunchBlockByTime(rpc, mint, Math.floor(launchMs / 1e3));
        if (!found) return { ok: false, deep: !hist.complete, reason: hist.complete ? "Launch block not found" : "Launched long before its listed pool; launch not reachable" };
        let settled = false;
        for (let pass = 0; pass < 4 && !settled; pass++) {
          const firstSig = analyzeBlock(found.block, mint, exclude).firstSig;
          const prior = (await rpc("getSignaturesForAddress", [mint, { before: firstSig, limit: 50, commitment: "finalized" }]).catch((e) => {
            if (/not found/i.test(String(e?.message))) return [];
            throw e;
          })).filter((x) => !x.err);
          const nearby = prior.filter((x) => x.slot >= found.slot - 30);
          const older = prior.length - nearby.length;
          if (nearby.length) {
            const slot = Math.min(...nearby.map((x) => x.slot));
            const block = await getBlock(rpc, slot);
            if (!block) break;
            found = { slot, block };
            continue;
          }
          if (older > 5) {
            return { ok: false, deep: true, reason: "Traded before its listed pool; launch not reachable" };
          }
          settled = true;
        }
        if (!settled) return { ok: false, deep: true, reason: "Launch is older than the listed pool; not reachable" };
        note = hist.complete ? "pool launch" : "located by launch time";
      }
      const { buys, creator } = analyzeBlock(found.block, mint, exclude);
      const wallets2 = /* @__PURE__ */ new Map();
      for (const b of buys.filter((x) => x.signer)) {
        const w = wallets2.get(b.owner) || { owner: b.owner, tokenAccounts: /* @__PURE__ */ new Set(), amount: 0n, decimals: b.decimals };
        w.amount += b.amount;
        w.tokenAccounts.add(b.tokenAccount);
        wallets2.set(b.owner, w);
      }
      launch = {
        slot: found.slot,
        time: found.block.blockTime,
        creator,
        note,
        wallets: [...wallets2.values()].map((w) => ({
          owner: w.owner,
          tokenAccounts: [...w.tokenAccounts],
          amount: w.amount.toString(),
          decimals: w.decimals
        }))
      };
    }
    const supply = await tokenSupply(rpc, mint);
    const accounts = launch.wallets.flatMap((w) => w.tokenAccounts);
    const balances = accounts.length ? await currentBalances(rpc, accounts) : /* @__PURE__ */ new Map();
    const pct3 = (x) => supply > 0n ? Number(x * 1000000n / supply) / 1e4 : 0;
    let bundled = 0n, held = 0n, devBought = 0n, devHeld = 0n;
    const wallets = launch.wallets.map((w) => {
      const amount = BigInt(w.amount);
      const now = w.tokenAccounts.reduce((s, a) => s + (balances.get(a) ?? 0n), 0n);
      const isDev = w.owner === launch.creator;
      if (isDev) {
        devBought += amount;
        devHeld += now;
      } else {
        bundled += amount;
        held += now;
      }
      return { owner: w.owner, isDev, boughtPct: pct3(amount), heldPct: pct3(now) };
    }).sort((a, b) => b.boughtPct - a.boughtPct);
    return {
      ok: true,
      launchSlot: launch.slot,
      launchTime: launch.time,
      creator: launch.creator,
      note: launch.note,
      bundleWallets: wallets.filter((w) => !w.isDev).length,
      bundledPct: pct3(bundled),
      bundleHeldPct: pct3(held),
      devBoughtPct: pct3(devBought),
      devHeldPct: pct3(devHeld),
      wallets: wallets.slice(0, 12),
      cache: launch
    };
  }

  // extension/src/lib/reroute.js
  async function pickReroute(tokens, getReport, { limit = 8, batch = 4, rules = RULES } = {}) {
    const seen = /* @__PURE__ */ new Set();
    const list = (tokens || []).filter((t) => t?.address && !seen.has(t.address) && seen.add(t.address)).sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0));
    const rejected = [];
    const live = [];
    for (const t of list) {
      const why = marketBlock(t);
      if (why) rejected.push({ token: t, why });
      else live.push(t);
    }
    const pool = live.slice(0, limit);
    for (let i = 0; i < pool.length; i += batch) {
      const slice = pool.slice(i, i + batch);
      const reports = await Promise.all(slice.map((t) => Promise.resolve().then(() => getReport(t)).catch(() => null)));
      for (let j = 0; j < slice.length; j++) {
        const why = reportBlock(reports[j], rules);
        if (!why) return { token: slice[j], report: reports[j], rejected };
        rejected.push({ token: slice[j], why });
      }
    }
    return { token: null, report: null, rejected };
  }
  function rejectionLine(rejected) {
    const r = rejected.find((x) => x.why !== "not trading" && x.why !== "not on Solana") || rejected[0];
    return r ? `$${String(r.token.symbol || "").trim()} ${r.why}` : "";
  }

  // extension/src/ui/recent.js
  var RECENT_KEY = "radar-recent";
  var MAX_RECENT = 8;
  function recentItem({ asked, source, narrative, res, now = Date.now() }) {
    const q = String(asked || "").trim().slice(0, 300);
    const coin = res?.mentioned?.[0] || res?.picks?.[0]?.token;
    if (!q || !coin?.symbol) return null;
    return { q, k: source?.kind || "Search", l: String(narrative || source?.label || q).slice(0, 120), c: String(coin.symbol).slice(0, 14), t: now };
  }
  function addRecent(list, item) {
    if (!item) return list;
    return [item, ...list.filter((r) => r.q !== item.q)].slice(0, MAX_RECENT);
  }

  // extension/src/lib/handlers.js
  var API_BASE = "https://narrative-radar.millenia-portfolio.workers.dev";
  var DEFAULTS = { rpcUrl: "", chains: ["solana", "robinhood"], refreshSec: 10 };
  function makeHandlers(host) {
    let rpcState = { url: null, rpc: null };
    function rpcFor(url) {
      const u = url || PUBLIC_RPC;
      if (rpcState.url !== u) rpcState = { url: u, rpc: makeRpc(u, { concurrency: u === PUBLIC_RPC ? 3 : 8 }) };
      return rpcState.rpc;
    }
    const memo = /* @__PURE__ */ new Map();
    function cached(key, ttl, fn) {
      const hit = memo.get(key);
      if (hit && Date.now() - hit.t < ttl) return hit.p;
      const p = fn();
      memo.set(key, { t: Date.now(), p });
      p.catch(() => memo.delete(key));
      if (memo.size > 500) memo.delete(memo.keys().next().value);
      return p;
    }
    const postKey = (p, chains) => JSON.stringify([p, chains]);
    async function forgetIfFailed(key, p) {
      const res = await p;
      if (res?.engineError) memo.delete(key);
      return res;
    }
    async function read({ post }) {
      const s = await host.settings();
      const key = `rd:${postKey(post, s.chains)}`;
      return forgetIfFailed(key, cached(key, 3e5, () => readPost(post, s.chains, { apiBase: API_BASE, cached })));
    }
    async function coins({ post, judge = false }) {
      const s = await host.settings();
      const key = `co:${judge ? "j:" : ""}${postKey(post, s.chains)}`;
      return forgetIfFailed(key, cached(key, 12e4, async () => {
        const r = await read({ post });
        return findCoins(judge ? { ...r, judge: true } : r, s.chains, { apiBase: API_BASE, cached });
      }));
    }
    async function story({ post, narrative, coin }) {
      return cached(`st:${post.url || post.text}:${coin?.address || ""}`, 6e5, async () => {
        const res = await gmFetch(`${API_BASE}/story`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ post, narrative, coin }),
          signal: AbortSignal.timeout(25e3)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Larp check ${res.status}`);
        return data;
      });
    }
    async function larpcheck({ address }) {
      return cached(`lc:${address}`, 3e5, async () => {
        const res = await gmFetch(`${API_BASE}/larpcheck?address=${encodeURIComponent(address)}`, { signal: AbortSignal.timeout(1e4) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Larpcheck ${res.status}`);
        return data;
      });
    }
    const lcGet = async (path, ttl) => cached(`lc:${path}`, ttl, async () => {
      const res = await gmFetch(`${API_BASE}${path}`, { signal: AbortSignal.timeout(12e3) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Larpcheck ${res.status}`);
      return data;
    });
    const lcHolders = ({ address, chain }) => lcGet(`/lc/holders?address=${encodeURIComponent(address)}&chain=${encodeURIComponent(chain)}`, 3e5);
    const lcBoard = ({ sort }) => lcGet(`/lc/board?sort=${encodeURIComponent(sort)}`, 3e5);
    const lcSettings = () => lcGet("/lc/settings", 6e5);
    async function lcHolderPost(path, body) {
      const h = await holderStored();
      if (!h) throw new Error("This is for $RADAR holders. Check your wallet first.");
      const res = await gmFetch(`${API_BASE}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: h.token, ...body }), signal: AbortSignal.timeout(5e4) });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) await host.store.set(HOLDER_KEY, null);
      if (!res.ok) throw new Error(data.error || `Larpcheck ${res.status}`);
      return data;
    }
    const lcStart = ({ input }) => lcHolderPost("/lc/check", { input });
    const lcAsk = ({ id, question }) => lcHolderPost("/lc/ask", { id, question });
    async function lcPoll({ id }) {
      const res = await gmFetch(`${API_BASE}/lc/check?id=${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(15e3) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Larpcheck ${res.status}`);
      return data;
    }
    async function mentioned({ text }) {
      const s = await host.settings();
      return cached(`mn:${text}`, 6e4, async () => (await mentionedTokens(String(text || "").slice(0, 2e3), s.chains)).map((t) => ({ address: t.address, chain: t.chain, symbol: t.symbol, name: t.name, marketCap: t.marketCap, createdAt: t.createdAt })));
    }
    async function refresh({ tokens, deep = [], roleCandidates = [], roleCut = 0 }) {
      const fresh = await fullTokens(tokens, new Set(deep));
      const updated = Object.fromEntries(fresh.map((t) => [t.address, t]));
      let ranking = null;
      if (roleCandidates.length) {
        const candidates = roleCandidates.map((old) => {
          const current = updated[old.address];
          return current ? { ...old, ...current, relevance: old.relevance, reason: old.reason, fromPost: old.fromPost } : old;
        });
        ranking = pickThree(candidates, { cuts: [roleCut], allowFallback: false });
        ranking.roleCandidates = candidates;
        ranking.roleCut = roleCut;
      }
      return { tokens: updated, ranking };
    }
    async function safety({ mint, pairs }) {
      return cached(`rc:${mint}`, 6e4, () => rugReport(mint, pairs));
    }
    async function bundle({ mint, launchMs, pairs, launchPair, launchDex }) {
      const s = await host.settings();
      await host.ready;
      return cached(`bd:${mint}`, 45e3, async () => {
        const key = `launch:${mint}`;
        const stored = await host.store.get(key) || null;
        const birthKnown = LAUNCHPADS.has(launchDex) && launchMs && Date.now() - launchMs < 3 * 864e5;
        const rc = stored || birthKnown ? null : await safety({ mint, pairs }).catch(() => null);
        const seen = rc?.detectedAt ? Date.parse(rc.detectedAt) : Infinity;
        const hintMs = Math.min(launchMs || Infinity, seen);
        const url = await host.rpcUrl(s);
        const result = await analyzeLaunch(rpcFor(url), mint, launchMs, pairs, {
          maxPages: url ? 40 : 10,
          cached: stored,
          hintMs: Number.isFinite(hintMs) ? hintMs : null,
          launchPair
        }).catch((e) => {
          if (/No block time near slot|cleaned up|does not exist on node/i.test(String(e?.message))) throw new Error(host.prunedNote || "Launch block is too old for this RPC");
          throw e;
        });
        if (result.ok && !stored) await host.store.set(key, result.cache);
        delete result.cache;
        return result;
      });
    }
    function embedToken(id) {
      return (Number(id) / 1e15 * Math.PI).toString(36).replace(/(0+|\.)/g, "");
    }
    async function videoInfo({ url }) {
      const id = String(url || "").match(/status\/(\d+)/)?.[1];
      if (!id) return null;
      return cached(`vid:${id}`, 36e5, async () => {
        const res = await gmFetch(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en&token=${embedToken(id)}`);
        if (!res.ok) return null;
        const data = await res.json().catch(() => null);
        const media = (data?.mediaDetails || []).find((m) => m.type === "video" || m.type === "animated_gif");
        const mp4s = (media?.video_info?.variants || []).filter((v) => v.content_type === "video/mp4").sort((a, b) => (a.bitrate || 0) - (b.bitrate || 0));
        if (!mp4s.length) return null;
        return {
          mp4: mp4s[0].url,
          durationMs: media.video_info.duration_millis || 0,
          poster: media.media_url_https || null,
          gif: media.type === "animated_gif"
        };
      });
    }
    async function tweet({ url }) {
      return cached(`tw:${url}`, 6e5, async () => {
        const res = await gmFetch(`${API_BASE}/tweet?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(1e4) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Couldn't open that post");
        if (data.post) {
          for (const k of ["text", "quoted", "parent"]) if (data.post[k]) data.post[k] = await typedCashtags(data.post[k], linkedSymbol);
        }
        if (data.post?.text && data.source?.label) data.source.label = data.post.text.replace(/\s+/g, " ").slice(0, 90);
        return data;
      });
    }
    async function openWindow({ url }) {
      if (!/^https:\/\/(v2\.)?bubblemaps\.io\//.test(url)) throw new Error("Blocked URL");
      await host.openWindow(url);
      return true;
    }
    async function reroute({ post, candidates = null }) {
      const s = await host.settings();
      const report = (t) => safety({ mint: t.address, pairs: t.pairAddresses || [] });
      const body = [post?.text, post?.quoted, post?.card, post?.parent].filter(Boolean).join("\n").slice(0, 2e3);
      const inPost = body ? await mentionedTokens(body, s.chains).catch(() => []) : [];
      let token;
      let checked;
      let reason;
      if (inPost.length) {
        token = inPost[0];
        checked = await report(token).catch(() => null);
        const why = marketBlock(token) || reportBlock(checked);
        if (why) throw new Error(`$${String(token.symbol || "").trim()} in the post didn't pass: ${why}`);
        reason = "the coin in the post";
      } else {
        let list = candidates;
        if (!list?.length) {
          const found = await coins({ post });
          list = [...found.techMatch ? [found.techMatch] : [], ...(found.picks || []).map((p) => p.token), ...found.others || []];
          if (!list.length && found.engineError) throw new Error("Radar couldn't read this post right now");
        }
        if (!list.length) throw new Error("No coins found for this post");
        const picked = await pickReroute(list, report);
        if (!picked.token) throw new Error(`No coin passed the checks (${rejectionLine(picked.rejected)})`);
        ({ token, report: checked } = picked);
        reason = "biggest match that passed";
      }
      const parsed = new URL(`https://axiom.trade/meme/${encodeURIComponent(token.pair || token.address)}?chain=sol`);
      if (parsed.protocol !== "https:" || parsed.hostname !== "axiom.trade") throw new Error("Could not build a trusted link");
      await host.openWindow(parsed.href);
      return { name: token.name, symbol: String(token.symbol || "").trim(), address: token.address, reason, holders: checked?.holders ?? null };
    }
    async function image({ url }) {
      if (!host.inlineImages) return url;
      return cached(`img:${url}`, 36e5, async () => {
        const small = url.replace(/width=\d+/, "width=128").replace(/height=\d+/, "height=128").replace(/quality=\d+/, "quality=90");
        let res = await gmFetch(small);
        if (!res.ok) res = await gmFetch(url);
        if (!res.ok) throw new Error(`img ${res.status}`);
        const buf = new Uint8Array(await res.arrayBuffer());
        let bin = "";
        for (let i = 0; i < buf.length; i += 32768) bin += String.fromCharCode(...buf.subarray(i, i + 32768));
        return `data:${res.headers.get("content-type") || "image/png"};base64,${btoa(bin)}`;
      });
    }
    const HOLDER_KEY = "radarHolder";
    const holderStored = async () => {
      const h = await host.store.get(HOLDER_KEY);
      return h?.token && h.exp > Date.now() ? h : null;
    };
    async function holderStatus() {
      const config = await cached("holder:config", 6e5, async () => (await gmFetch(`${API_BASE}/holder/settings`, { signal: AbortSignal.timeout(6e3) })).json()).catch(() => ({ on: false }));
      if (!config.on) return { on: false };
      const h = await holderStored();
      return { on: true, pitch: config.pitch, holder: !!h, exp: h?.exp || null };
    }
    const holderActive = async () => !!await holderStored();
    async function holderCoinFacts(rows) {
      const facts = /* @__PURE__ */ new Map();
      const cas = rows.map((r) => r.ca);
      const sol = cas.filter((a) => !a.startsWith("0x"));
      const evm = cas.filter((a) => a.startsWith("0x"));
      const asks = [...sol.length ? [["solana", sol]] : [], ...evm.length ? ["robinhood", "base", "bsc"].map((c) => [c, evm]) : []];
      await Promise.all(asks.map(async ([chain, list]) => {
        const r = await gmFetch(`https://api.dexscreener.com/tokens/v1/${chain}/${list.join(",")}`, { signal: AbortSignal.timeout(8e3) });
        for (const p of r.ok ? await r.json() : []) {
          const a = p.baseToken?.address;
          const best = facts.get(String(a).toLowerCase());
          if (a && (!best || (p.liquidity?.usd || 0) > best.liq)) facts.set(String(a).toLowerCase(), { symbol: String(p.baseToken.symbol || "").replace(/^\$+/, "").slice(0, 20), mc: Number(p.marketCap || p.fdv || 0), liq: p.liquidity?.usd || 0 });
        }
      }).map((p) => p.catch(() => {
      })));
      return rows.map((r) => ({ ...r, ...facts.get(r.ca.toLowerCase()) || {} }));
    }
    async function holderSave({ token, exp }) {
      if (typeof token !== "string" || token.length > 400 || !Number.isFinite(exp)) throw new Error("Bad holder token");
      await host.store.set(HOLDER_KEY, { token, exp });
      return holderStatus();
    }
    async function holderWho({ handle }) {
      const h = await holderStored();
      if (!h) return { locked: true };
      const r = await gmFetch(`${API_BASE}/holder/who`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: h.token, handle }), signal: AbortSignal.timeout(25e3) });
      const d = await r.json().catch(() => ({}));
      if (r.status === 401) {
        await host.store.set(HOLDER_KEY, null);
        return { locked: true };
      }
      if (!r.ok) throw new Error(d.error || "Radar could not look this account up right now.");
      if (d.own?.recent?.length) d.own.recent = await holderCoinFacts(d.own.recent);
      return d;
    }
    const recentList = async () => await host.store.get(RECENT_KEY) || [];
    const recentAdd = async ({ item }) => {
      await host.store.set(RECENT_KEY, addRecent(await recentList(), item));
    };
    const recentClear = () => host.store.set(RECENT_KEY, []);
    const launchState = () => cached("launch:state", 6e5, async () => (await gmFetch(`${API_BASE}/launch/settings`, { signal: AbortSignal.timeout(6e3) })).json());
    const handlers2 = { videoInfo, tweet, read, coins, mentioned, story, larpcheck, refresh, safety, bundle, image, openWindow, reroute, holderStatus, holderSave, holderWho, holderActive, recentList, recentAdd, recentClear, launchState, lcHolders, lcBoard, lcSettings, lcStart, lcAsk, lcPoll, settings: () => host.settings() };
    handlers2.resetBundles = () => memo.forEach((_, k) => k.startsWith("bd:") && memo.delete(k));
    return handlers2;
  }

  // extension/src/ui/radar.js
  var radar_exports = {};
  __export(radar_exports, {
    MARK: () => MARK,
    age: () => age,
    detectTheme: () => detectTheme,
    isPostLink: () => isPostLink,
    launchedVsPost: () => launchedVsPost,
    launchedWithRadar: () => launchedWithRadar,
    mountFloating: () => mountFloating,
    mountInline: () => mountInline,
    postTimeOf: () => postTimeOf,
    price: () => price,
    scansOnPaste: () => scansOnPaste,
    usd: () => usd,
    useBackend: () => useBackend
  });

  // extension/src/ui/terminal-icons.js
  var TERMINAL_ICONS = {
    axiom: "data:image/png;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBwgHBgkIBwgKCgkLDRYPDQwMDRsUFRAWIB0iIiAdHx8kKDQsJCYxJx8fLT0tMTU3Ojo6Iys/RD84QzQ5OjcBCgoKDQwNGg8PGjclHyU3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3N//AABEIAEAAQAMBIgACEQEDEQH/xAAcAAABBQEBAQAAAAAAAAAAAAAEAAEDBQcGAgj/xAA1EAABAwMBAgsIAgMAAAAAAAABAAIDBAUREiExBgcVMlFSVXGRlNETQVRhgZKhohcjFBYi/8QAFwEBAQEBAAAAAAAAAAAAAAAAAAIBA//EABkRAQEBAAMAAAAAAAAAAAAAAAARAQISIf/aAAwDAQACEQMRAD8AzfUnDkPrT61bBIelrQ+tWXB21z32801ugyDK7L39Rg5zvoPzhawLrS1onhDbJ7HeKm3VG0xO/wCHddh5rvqPzlV2tBNqTZUOtLWsag1J9SjBXoIPeVtXFXwbNrshuVUzFZcGhzQRtjh3tHeecfp0LIbO6gjudLJd45ZaFjw6aKEAukA26dpAwTgH5ZWvfy3YDutt1HyDItn7quOzaPPGrwbNzsoulKzNXb2kvAG2SHe4d7ed3aulYvlbV/LVgG+23Qj3gsi2/usgu5oX3OpfaY5oqF8hdBHMAHRtO3TsJGAcgfLCctu0B6k2pMV4JUiIPUjXkkBoLnE4AAySegIASFd1xXWT/PuL7tUR66ehP9bcZ1ze77d/eQme7B2Nn4vrRHbKcXeOWSuLNU2idzQ1x26Rjo3ZRw4B8GvhqjzLlbGSUnJY/PcUvaS9R/gV264mqn/Q+DXw1R5lyBvXF9aX2yo5HimZXNZqh1zFwcRt04PTuXR+0l6j/ApxLKCCGP8AAp1wr5/c/aQQQRvBGCFGXrreNGycn3Jt1poyymrnH2jcY0Tbz92/xXDmRcN82KQZRdNdbjSxCKlr6qGMHIZFM5o8AUGkpaseXrx2tX+Zf6pcvXjtav8AMv8AVVySUWPL147Wr/Mv9UuXrx2tX+Zf6quSSgyputwq4vZVVfVTR5zolmc4eBKEymSQf//Z",
    padre: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAANQElEQVR4nOVbB3SUVRb+/n9mMsmkTnqvpBcIkYSOlCUgClgWBaTICshZRUE5spbjHg+KEtDFBSyABwgKK6ALCAGzoYQqQUijJ4SSQgpJSJ0kM/Pveff/JwtnESYzkwRP7smcSf7y3r333fvd8l44AAJ6MPHo4cSjhxOPHk48ejjx6OEkx6NEHMDxPDiOAwQBgiCIMYpdZ9c4DoJegKDXW3JKdH8Y5DjwPAe9Tt85zz/KCuBkPARJEF4ug99joQgcEAmv2EA4ejlDZqVAa1MLaq9XoCTnKoqOn8etc9ellzn2Q1bxh1QAL+NpFa1srZH0l2T0n5UM/95hsII1NGiGprEROq0WCqUVbKxtYQUlGoV6XMnIxtEvf0buj8fuGecPpQBOWvnwP/XFhBVzEBIbg5r6CuTvOolLv/yG0txrqC+vgV6rg9zaCo4+LmQdMU8mITK5H+RQIGfvUfy04GtUXi4xSwlCV394GU/fjy98Rvhc2Cd8rk8TJn4+V3AJ9jLq/V7DewvzM5cLq4UDwpLyrUL46L73jNvBD7pWeLmMvke987ywRjgsvF+0QQgb2af9Pifj6RmO5wWO5wSO48Tv9uscPefk6ypMXDFbWK7ZJSxv2iVEJCeYqgR0ufAJ00YIq4QM4Z1L6wXXUO/2ewbhHvjhRCHZ825hPsKIt54TUhp3Ckurtgkekf6iEvkOKQFdI7xMFD5ocLSQ0rBb+Lhyu+DdO4iuyRTiPaM/nKgoR19XwadPsDDm7y+SQl89tIzGIkVyRvKFLiCW3Oh1OrgEe2L6d4uhUCqw+aVlKM0potCna9N1bECWIAGoL6uGwkZJwJm9OxPRw5LQd8pwCou8TGbUUDw6mThezOqsHVSY9t1iePj7Y8eba3D+51MkPEN5k8blxESoqboeCmsFsjZmoKGhFsPemAiZldzoiMCbNLvxXIopLIBJa19HZP9+SF+5BUe+2GWW8HdTc20DWUFVYSkuHTyLwD4RCEiKIKWz0NitCuCl2PzExzMwaNI4ZO1Ox8631t6T/ZlKgohfaGtulWoDDlcz8yCDnHILIkn5D+QRnUSGFU56ORlPLJ6BguxcbHnpM3HVDYWOBYiNx5QsV8pRWVCGxpY6+CX0onvGFE28Rbj4HeFDR/bBpH/OR/WtcmyashSNt+vE1Tcjd78vCczaZOQODZV1UPu5EfDSPFwXK4BnZq/VwT3cF9NTFxMIbp6xDOUXbpJizDX9/5tPLmsvinRtWrQ2aWBlZ0MWIRLXdQrgWImq10Oltsf0LX+D2ssd299YjUu/nLEY6LXPJQmmsLGi0ph5FANcnkKuHnqdcVbGW4whCfGZKU7esBBB8VE4sHo7jn+5B3KlwqLC300svIqNEj0UKiVs1LZoqq6DrrVNfOAhWMNbihHm20zzEz+bg7jxg9GoqUP4qHjCAW1Lm2SqlpqNySWQn9uo7Uh4nVYHBw817NROVB0y6rIwyEvmPWT+eIx8bRKKc68ge9tRuIX6YM6eD5H00mi6b7ASs0kaw9bVHlYqa1pkfZsO3r2DoeRtcPXouXue69SeIC8JH/VkIp5eMQ+3b91CVmoGqgpK0VBeQ42Oqd8ugkuIF/a+t1HkixDaPDBkilT7ubf3CFlTJXx0X9Q1VuPiL2e6JgzyEuJ7xwVh6oZF0La04sT6fai9WQk7Nydcz7qMA8u2oaKoBOPenYlp3y+G0s6GGDPGPO9Hhoap2t8NSnsbWuSW+maEDItFYGwE8nYeR3XRLaPDLW8W4uv0sHd3wvSt78DW2QGnUtNRmnOVhGQhydreBtXXK3AgZTsKT+eh/+RkvLL/IzgHetC7hAsdk558X6W2gzrAg0Iqwxd7DycMnD0WzU2NyPh0m/iskakGb/IqgKOiY2rqIvhGhiD7x0xcOZgLpb2qvRBh3yxPb6lvQuaqXcjZfwy9Bsbh1UPLEDQomqzHaCVQ806g8Twi/cVkWBBojscXPgPvoGCkp2xFaW4RWZexLsabpABpgme+mIfY0YNwIfM0cn88DiuVEoJw78TsOaYoRlkb0nFy8344+bmRJSRMHS6Co0zaC3hotsfDM8ofvEJUWktDMwa+8gR6Jw/GmbTDSP9oq+iWHcg0eVNBb/ii5zBs7tO4ce4iTm/KAC83bGjch3e9GLIMtfvhlf+m/sD0zYsx+v0pZMqGsHZfkpTjHuFHfs/maL7ThN7PDsagWeNw/dwlfD9zBbmduJnSSQrgJdCLe3YQJnw6G1UlZTixdh/aNK1imvugiaUCiLnItZMXCReqb5ZjwoezMXnDm5TR3Q8cDaDnEuQJOzdHUiZzqeBBURix8DnUV9Zg4wtL0VBRa1KdwXesq6OHT3wIJq97E5qGJpxYl4a68hpqWxs7MROSgWNlQSkylm1HUc55DJ7xFOamLYGTr+s94MiEZ0qz91BDHcBCnp5yfdcQLyS/NxUyhQKpM1NQln/N5DqDN0p4MkGBYu0L6xfAxtEWpzam0w6N0ta6wxMbNkOaahpweOVO5GecQPiwBPz14DL4J4aTlckUokWxVNc9zEfM9lq1NPeYD16Es5cndixYgwt7s8yqM3ijFMCKDb2Aoa9PQEh8LPL3nkThkTwyZ/JvE7I7pjRWsbHvk+v349TWdLj28sa89I/R589DqE/IMMMrJoAwgBU3zMNGvfMCAmOikP6PLTi6erfZRRZvbO/N1tUBQ14dj9vlZTi/JwtypRVZhbZVS10ZU/J8sXnJkwvl/nQcR1btor9n/vAuRr49CU6+LpDJ5YSBrY0aDHntKcSOGICsnRnY9dY6MdyZWV7zD3uAAQuj2IkD4eblgyuHctBYdYcqPLZpyVYo+qlEaDVtplmChNoseSrMzMOB5TtQU1KFiZ/MwfiU2dALetRX1CJhynD0n5qMq2fzxc4SS4Et0FmSP5RBCdyixiVCo21G8dlCiusGxI6fNBQ3Tl8WzVBCbFOIwNFBRbhyct0+9HtxBOInDIHKyRZXDuZg6PzxqLlVhY2Tl6Kppt6svUCjFcBJdTYDLJ8+IagpqaANS7Zl3cZWPzaILOH83iyqxc0qcDiQOzl6u4DnOGRvO0LNTQaK1OUFh9Rpn6LiUrFFmyv8w5hi5ODpDHtPNepKbkumDrKCO6W3KcU1JDomEzMcFhlUSor1bGyGKwWHctFc20h4s+O1Nbj8n7MW7yzJH8yYGP6sHVVQWFtBU9dELS9qSPE8paKaO41iamqGLzIFyhRyWn0WcXRSGGQW4Ozlgf0p3+PE2jSLC9/BPOB/vXjpIsVlOr9jZquHve/AToMoGLYI1Nzo9XgcAuLC8duOg/j57W8t5vMdU4AgCqypb4a2tQ1KOxWtENMHq/39EkLhGuxFJakx3Zf7TqHXw97TiXCGzafVtMI/MQy9BsehMCsfW2Z9JrHSsRzfQgoAUf2tajRW3oGDl5pAj/Gha2mDZ3QAIsf2E2sBtgfYEeLEjFDl4gAbJzsSjvm9e6QfIkYloKa4gnJ85naG02GdQfyDbooVGkdMlOVdg9rXHXauDtRxZVkaO6vDsjfW4GA5gdFAyEBPK4Y9e1dHaeXb6BhM9NhEUsymqZ/g9tUy6jJb8lhcxxMhXnzk4r7TUCnt4BUTRCbPqrfq6+UoOnYOQ+dPIP9l1x+aDEmIL7exgoOnmv5mWMKUET0uEbZqB/wwbyUKM/NF0NN1TjvdaAUIkvZzdhzDnZoqhA6PI2YZ0yx7O/uvTNwprsK4JdNh46hq7/7+rtlrWQ1gBScf13ZgY4JGjn0Mbn4+SPswFVnUX7A84puoAIEYrS2uxMlv98MrIABho+LR0qgh32Qrf/SrPbiUfpYSJEpP74kW0qqz9pVk9qyhSdWehPhhI3rDLyoUJ77bh7QPUrtk5e9mTzDukAPrwztg4a8rKV4f+2Yvrv16URSa1emNLeI2FavlJbS+G7kZeKqcHchKDDMy3AgeHIWYMUkoOJaHL5PfRVtzC9231O7xQ2WDkf1Tw55+xOi+mLtnCTVEsrcfRWleEa0ka0cxtyCXMWyTyXkyd+YqSjtrsXpjFqLTo62lDQH9whD9ZBJ1jlcNW4Sam5UW2TPotIOSvOSzSbOSMXn9AsoEWXpaklsk+j4Bpjgc+509Ty0uqaZg7zIlya0VCOofidARfVB3qxpfj30PJdlXOy3ZsehJUV4Cp/jnh2LSV/Nh6+SA4twC3Mi6jLqyarKEu4/G3H26m4VO5yBPBA2IgEegP27kX8amKZ9QiO0O4U0+Kmtg1ismEONTXkb0mETooae4XVVYRvU7a2Aw0GN1go2DilJdt1Bvyu01rc3UTGVbZexQQ3cJb9ZZ4buZjhnfHwNeHoPgITGwd3KiYfXQUTTgwEMGHjroUF1cjgtpp3H8m724efqKyEAX+7xFD0tz0sEEA9KzjJDVB+4Rvu3FDbMEBm7MzIvPFNCxNnqXYYPU1elO4sxRgIHa0d2YzUh61rid264gzhIKaB+MKkXxX1uIxHMr7b8Lj8CKP3L/MdLdxKOHE48eTjx6OPHo4cR3NwPdTf8FOAIkgwfuCVkAAAAASUVORK5CYII=",
    fomo: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAclBMVEULCR/q7f8AAADv8v/x9P/s7/+bnaygobAAAA4AABgAABYAAAcAAAsAAAQAABIEABuVl6eHiJldXm3R0+USESelp7jh5PdjZHTCxNZ2d4geHTBwcYC7vc9HR1g5OUmNjp9PUF8uLj9+f4+xs8T2+f8nJjmcbNgjAAACIklEQVRYhe1W3XqCMAyVJAXkx6pAAUVgyN7/FSfCSgqV3e/jXIbkNCdNEw6HHTt2/GccI3jBl6b1FL6M4enPaBlDXZ6z7FzeYPYOAK4XN/MuVwC5EX04QNokRIRIJKp2cj7C46kG48uq3DT6HB6EjSLhjBCIWTgwwFeFqK2kcvgUH9eJDh+dC5ASOoGOYe0+MEAuePgAegJk/cIq+qtVBZS0jHecvqxoZRROaqkk5JZ4x0GbkbK1iODxLvMIHSSQYzardQqnznM1iskVC5fhnGgGuvurFHyYccZJ6w04Kk2Az49X+S7HdBQ13E2mataQbBHIG01KJVd6us73IVS8QRB1oyeatYYnMoKNftaeWAc2YSNBuEXgiNHJqHRQs4berEHQ9rZKhxfWkqLYIIDz6EmdkSZULAO0tOJKK12N8RPxl7b4ZkB+TyfRg9fQz7kCSyvPnneyEYDHFWw1otZKLU8TFFdgcC8U6IY1Hsyx7lkC1SoB9pIev1rR5Q+pY31MX8dlfOf9wtX9JpTrzWAKzDf2RnTp11PDnCazGS1NJKWyTC5hHWeYSMsVhmW/jqeywHW8ullvAJ7L4StEDt/Oas4nqf0GpV8YDIKSOj74D3NTCPKi5QVoBsiM/dVEw0kh21UCKWm3Viu0lRjXKiZNOlU6CC/JtFadKoft7X6C23uxdzXE80EhtMNib+7HP8LHSgxNt5QZDL8W8fKHY8eOHf8MP1gLHMr/NURSAAAAAElFTkSuQmCC",
    larpcheck: "data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%2064%2064%22%3E%3Crect%20width=%2264%22%20height=%2264%22%20rx=%2213%22%20fill=%22%23f5c518%22/%3E%3Cg%20transform=%22rotate(-8%2032%2032)%22%20fill=%22%2315171a%22%3E%3Cpath%20fill-rule=%22evenodd%22%20d=%22M14.5%2014h35a4.5%204.5%200%200%201%204.5%204.5v27a4.5%204.5%200%200%201-4.5%204.5h-35a4.5%204.5%200%200%201-4.5-4.5v-27a4.5%204.5%200%200%201%204.5-4.5zm1%205.5v25h33v-25z%22/%3E%3Cpath%20d=%22M20.5%2022.5h7.5v12.5h13v7.5H20.5z%22/%3E%3C/g%3E%3C/svg%3E",
    uniswap: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAUdklEQVR42t2beXRedZnHP8/vLu/7JnmzNS0t3VvbslRoaaEsBUQHUUGPMuA6wigHFMXBZdAZBwScw7gvg8IICggynSM4OIiOG1iECkX2tkPL0pbSfUnSJG+S926/Z/743TRpSZqktkf0npPTJL3vzf19f8/yfb7P8xMAVRURUYC4U0/1Aj5iYLFNmSSCx1/wpUpGwEYDy5KYm8N6eXjgmqXvG1Ut0Ms3MVxCAZ8INOWv4pIACMFGpFi+b0p8UkRiVRWfuzGqGtgefm5qeJOtoCRkeBgRhEzByF80ADZGibGAZ+q41PYwW1XPARIB0C69kToutRViIBQfdEeM1PtQY6BXwZe/eEtQRYHE1BFS4UYpy8dFu/VEKzwCWLJ81w1oV4L93+14bxkHY0PoUgj+SkAwWOMhRCw2VvmEKSFkIIJbYapIc4BZ1ER81Wp0fQ80CMR2FI4HKJAppOq+fy3EA0GwQAFjPT5hDJxKDIDZc5cR6FbMkbX4F0whfv+T2Cc7ock4EIZbjAWqOVj1gjQI+EBiXytAGGJAOVWyiiYG/EHfK1akScju2Ub00WcIf7QQ76wWaLcQGBjUI9yO2xWd2Oc6oT2GsQW8M8YiM4rQ45570NxJ+v/saD9mIRVb0f1/NLZIkyG5+RXijz1NeOsC/AsmORB82TtDKCCK7k5BQMYE2NUVsvu2Yn+7HZlbT3DlkciEAHbvD8SRODPgAbsTKHpQMAdkXWbYO0KDtln8S6YQ/ttc4gsfI/3yWqg3ztSzAX81s1ArZPdspnrCAyRXrELKPuFVswjvOB52J1RP+B3ZvduQJgOpdc8YzaJ1b1eza7rcJuiB+sJIrtBAu8X/7EyCK+cS//NTJJ9eBUH+hHSfv1616OYeku+8RPW035M92I4cXiBcsoDgitlE5y0n+epapME40DLt/0oHfGUKVvsX7gGFPiAUOhLs2m4Ixd13AJc/YocJBNoygmvmQEdCcv1z2G1VCjfOhxrPLdqAKNAUIMaDlgJs6SX5/CoKvzgF7VD8y6cjYwtEH3gU7U4JvjAHehQK4hY40KctkAKJQ0DbEuhKkYklpNFg2yy6rrs/4xwyAPoygxH0+W6Cb8yF2JLc9DzR9ojwtgWYiUXozCABM7MWCh5UM2gMsY+3ky1rxXvLWNiR4r3/cMK2BcSfeAKpD/DeMwl9sYK2J2glBVWkxkeaQ+TwIjK+6KzFC7Ebe8h+thUaAmRWHbqq0wHUZyVyqACwQK2BDPS5CuGNx6AK6c3PE70jpvCjhcjRZei0mCPKyNQadH031PpoarFLd+CdPRYNDNJu8S+bhq6pEP/js5jvrEV3Ri519sVkyV2vMcBMrsEsaMKcdRjemeMwxzWR3vEKyWXPoFt60FWdyIkNLrCGZnTZYNgssA+Nwofsvu14i8dAs098+UrSm17ETCoT3r4Qc0ozWEg+s5LkP9YiYwrQHmNOH0vh3pMGmKqCQPSO5dgHd0BT6EAe6AKax4LYoqlFfIMcVY//4Wn4l0/DrqgQ/c1DSGNI4deLkSlFqIyOto8OLhXwBXNkmez+HeAJ4TeOIfj0kdhNFaJzl5PduxVK4L1vMlIOnHkWPewLFXRbBJ7kPivgG8Ib5yGTa6A3c7/P9gl+vkCtjzSFzppWd5J88hmq8x9ESgb/g9NgTEBy3fPoC91QO7qAaEadM3oUM7cW7c6wj+2GAIIvHUVwzVy0Iya+4AnSG17GnNqIf8FUtDOCWh+2VbErOlwUt/kuVS0yu4bwxvl5Gh2k8tT8/jQHpcaHlgL2mV2kt2xAjiwTfOx1BFfOJr1rM7ql6gK2HgoA8mCoVcV722Fk/7MFrVqoZARXzib87jzIlOSyZ0m/upbgK0fjnToO3VkFD7L/fGXvlYXGxYyzxxJ87RjoSvZmd4PGohwME6DbIyga6M0w00r4F09H1/e6/5dDBYAAEciUAjKnTHbnJmj2oDXFv3Qa4Z3HQ71P/LlnSa5fS3jXCXhnT4DYkv50E9mSzVDngikAgUF3W/xLp+J/4Si0I+43fYYBIrJI0YNxBbKlbUg5wCxo7H/2IQEA93JaUfy/PRz70E705QhKxqW4cycQ3rIAaSiQXv0cuqGHwj2LCG46Dm9xC9nvdrrcLv2Aii/QZZ0Vff0YSCy6O3H39NFt2fszoNASOk5weIn4widI/2ujiwGqhxgAcnLS5IEvJF9cA2WD1npgwBzX6AKgb9x9FoKLplD47amE/36sK4YG+roR8AxULP6nZhD+ajHeG8c6INpj5xqx7c8SClIf4p0zATO3jL5YwW7sJf3ianRNjyNVmR5kHjBYEZaA7k7IfrEB8/p6zCnNZE93kP1wA3ZTBXN8C2ZuGWJFq/mi/SEClAChoNsSzJwyhftPJru/Ffvr7dgndqMbup1V9GYQOdZJlGHXdZP80yqHy+Zekq+8QPiDeRBZl3EOKg/ou1ILNQb7UBvRecudP8YWfINWYsBiJpcJlxyPWdgEPZmzhr7dliEKHR90W0R0/mMEH5+B975JLmukoNsSdGsv2hpDZ4q2xUjRQzsT7JPt6Lpu7BO7IbUUHnkD5th6qOqwIIwegL6Sty0hOnOZY3uSF0Q1HjKphHd6C/4/vA6ZXuNcoCzOfC3QPQRRyWmsdiREi5aim3owJ43BnD4Wc3wTckQZM6EIDQYxAyQAiwt6HRl2ZQfx5c9gFo0h/P6x/SX3QXWB1EKDIf3WBuzznUjJx5w8Bv+S6cjkEmZqDTI+QHtcXtddEdmPtiMlD5lVhzmp0YGw785IHtnrfJhWAzsi7JO7yR5tRXwDTSEyoehqg2k1mOm1yJwyMrMWM7EE9R7mjGYK9y0mufY5dGuCNAYOHDmYAIhAj2J/t9NF8IlFwlsXIFNCqLrd0N3W+fOOiPiSp/E/Nxszr0z69bXYNV0EF01GOwexhEyRBoN3+liSZTuRliKSem6ru1N0dSe6sgPNjVYCA2MKmKPLeG8ah3nreMy8OoJ/OcLVFXLQqbB7ad0Roxt6QBUzvxE5LER3ZS66a/7UOiH9wQbsIzthR4RuidAXu0mvXo1tTQcPhp5Ar+J/eCpmSh10pv2W4YtjgQ0B0hgijaH7uTPBLt1F/PlVRG9ZRnL5KmdtkwvQOzwIZtT+74PuiFxERmBcwdmRL/08XwRR0Fe60Z6U+MIniBYuJb1nvZPYhxLxjECiyJQiwXePdc/szvqprdW9xZM+YMp5rVBJSa5/ieoZD2EfaYeycULsQQPAOlVGX+mBSoogyNgCePsALaAZeGdPQFpK0Bwik2rw3zuD8PaFSJ0/tG/6jg94bx1H+JNFyIQi2ha7e70hgmcfPfYEaS6g67qJzl2OXdbmSvhED1IMsC6X28fb87QnmBm1OUGRV5my984JFBc2QVcKLSFMCB0LjIdJT0EOwpljMfcvJrl2Ndndm11ur/edpdhBeg2aS+9l5xrRRU9RvH8xMq6w590P3AI0X1hrSvab7c70mkPM/EaIB3mSESerTywiR9chY0Kk2yKJjoig9IHAhCLhHcdRuPckvHPG5zQ53rPjg/YtU4VygK6rkHzrJSgNzQxHDkBiXWC7d6uToSx4p7Ygs2sd4RjsRTxxph45OoxvRtdoLRjoTLEPt2PObCH88SIKD5yG/+Hp0BA4ILrTnErLq9K11PhkP9mEvtTrnjWITmBGbPq+oFtj0q+94IKSL3gXTnVPkGE481Dsb1jO4Vp02U+3oCsrLiDW+YS3HEvxodMIv/p6zHFNDoSOZO84obmkvy3CLmvt1yEOCIBEoUZIrl2DvlgBq5iTm/HOaBmc1BysK1Ok4ADMfrMDbY2JTl5KctlK8A3BFTMp/PJkwiV5yV210Jn0Z6M8dduVHUMqx8MDEFtoMmQ/3ER2y3qn3cWK9/4pUJOXnoewaawKFA12VYerBSop6Q3riE77PfF1L6HVDP/88YRLjif86YmYN45z3aIB+qLuThxBG3UMSCzUGuyju4mvWAElzwEyroA5eQz0cuh2f2B9sLnqMoBVxAiMCdFdEcmVq4je/AfSWzehCt6bx1K4axHBV+bmnekBsUgGd1WzX78PBN0eEV/8NFRSJ2GlFqn1kDrvgLsxI407akA7rFONmwOYWOPYX+Tkb2kK0RcrRBc9SXzB49g13RAa/E/PJLxxnqtbBKQ5dFxlxC6goJkLfMnn/g/7XIfLrak6CWtXjG6tulRoD8Gup+oYYYMhvXE9dkMX3hvHYaaVkNl1ruGCuPtKHtIYkN27hfity8iW7nQc5L0T8S6aBpoic8pDNk3MkMGnzpD9Yjvpjzc6mmn7zUm7UtLbNkCJfkp6gLu8px+YWLdjuIBLgyH93iskn38G76yJeGeOAx/890xCU9v/5vkzpClEd8bE73nMSfYh+OdPRMbW4p3UnHMVGbkFoJAt2ejMpjfX6PI/KPU+2W0vk35lLTSa/jJ5pHQ6yRceCNTmAxSNBkrGye0PthKd/zjxpX/EzBtDeMM8Z209iveBKZhZZSeyDFxQbg1kSnzZM+iLvcjEEsFHZyAzahwXGQSAVwsieUdGIyU662H0mXbMiS3I9BrXk+ur9vIS1fvQNILrjnK1d+8wgw8WKLqxNY1AN1adnvdCBbumC32uM2+gdCO+j/ehqQRXH4mMCd0CVKHekN6+ifjDT+b1vr6qltD2CP9D0xxwXanrSwzhAv6g228EohR6M5eGWkLCO44j/vgK0u+tc6WodXQzvWU99vF2wluPw7y+fv8TZQWwqyvYe7eSPbgTfcWlNQRXwjYFeIvHYE6ejfemccjRtU5jiPqe6dRj//2TsL/YRvrfm5x7pnvPKEitT/bL7ejGXmRyKe8jyCiKoT7e7+d5vjt1KSXV/qIntxRpLqArO4jPe8z15yYXXcGzr3OpxS5tI3u8HWkM8D8zCzOp5JSeokFDDykIhCDGWQhdtv89BgoyVgmuO4pseSu0JXt3gjTvNWyvkv2xDX/mREhGowiJi65S7yOHFZFVgq7tJjr7UezyNqTW39vsEgvNIfblCumSjQTXzHZanDH97S51tYDMayQ8q6UfkyoupeEWTaxQdcN8eDK4nuflLbVZNQRXH0X8kaeQwj6uILkbv9TtZg7s0GzVDEm/SmBOakYVtDXGPrBj6LaVVbfgtrh/J9I8qpcEKRv3At0p2fIOsj/sJnu2gu5KXGur1vQvIDDuywxTLnda/Asm4719gqsDBltgogfYF/AEYvDOmUD67Zfc7+qDoZsNRsBaZEIxn+rImya9YH/fSvbL7djH2rDru130xk2cSGOImd+A9+5JeG8bn9fzI2hv9xVYCsEXjiR6eJf7nNmH7xfkADVB4wQNM78e79yJaFcyNN8PDNoWY2aWMe863Pl/0ZD9eAvROX8gevsjJN98Abu8DdqT/i5v1aIbe0jv2kx0/mPE7/kjuq3qXjodAa/wBHosZn4Z70PT0EqydyUILnvoPmLNiKmwcQ2J4HOzkcNLe6uspj8waVsVM6dMeOfxmCNqsE93ugX93ePYh3ftoazU+a4mN7juTm8GgXFCSWNAet9monctdx1fn5GRK18gAv/vpyJjiy6G5CKqlHzM3Ia9+5CjAqAv2BxRQ/DZOWg16w9KvZnr2Qn4H5lJ4VenYOY3kH5rPdHblmF/m0981Af91Bac+ccWmdeIOWmMs57WyDG5liJ2RTvJtWtG3tszApHFzKrFnNgMPakTXXoz5Oh6zLENLi3vJ574w8pSXYp/4RTSW17GrmxF6orInDr8tx6Gd94k14ISyO7cRPKlNf1zPp2J23XJnbaaITNrCb97LBQ8tCNBDiuS3bGB9IZ1exqe2T2bsR+fsaenuN9g2PdfIZi59WT3bUE8QRNL8MEp0OCC5f5cwB/RGGqNIbjqCHRdBXNKCzKnjGnx0BjosWAE7+0TKJ11GPblbuzyNrK7Nzu/r/P3jL+F35kHNR52ZSdkGdnPthJcNQeZVUfyqRVQH6BtEXbpTsyC8rC715ewBJCGADEG2mO8xS34F05xE+7en9oa8wSqivfO8W4wMnHMTDvcwgnyEdWSBzUeZkEj5sRG/Iumkd68nuSLq6EnQ6bXIjNqsSs68D84GYqQ3b6Z5JrnKXz/GGzeVRbPYJ/a7Xx3FK1q7UhQm2AmlAmuP9al10gPUmMkB4EO6/4lX3hf1JUBXD9SZ3YK/hUzCW9bCEUP3dYLrRFmURO6NXKK8RFl2FVFEyX4zCxkfMERmA090G1HNAIrvkAvZD/fikytI7z7BOc+vSNrj5tRDUr2qbqyH5fpY3C+QGuGf954CnceD0lG9NGnoS1GJhZAhOTLzyNTaxFPkNfVuIFJa9FtVdcG94YZAbWudLaPtGHmNVJ86A2YhY0OvMAcgjnBA7ki1022D+wivvgpdEsVc0ITuj1CDitQ+MkiqAvAE+yaCtGbHoLEUvjlYswJjc6iPBnW/KUl6JfgRzEneOgB2NNTMLDLNVXsqk5kVh3+uyc6mS3JyVGdIb70WdIfvED4zYUEn5yOtmaOP/QRnH0tsG+IOs1dc5RDP6IVTRjqwMTBvNJ8Z2oH1CuVAYWKdVOourGX6qm/R8oBxeVnIC2emzXwQcK8Skz4k5XoPQcmtEs3EjLJxuieM0OHUuXNtF+c8PbZzdxS7P27iM5/FDminvBfj0Jm1EFisS/3ICUPc0LTfnP7SA5OmRCxCRslq+gSU8v7bIXsNXFKNFGoE3RlF8mXnseu6ECaQmRKDd6Z41x/sBwc0GT4wNOkpg7PdrNEtENPosAym6HY/Njcn/tK1ZXRIdi2zFHypgApgfYy7NjLsMfmPCxgjHKykQZ5lITvmRo8IMkPF/55L19ysqVI6GRvUvfzn7h4gMSU8EzG96RWlouqesDeR2cdpXltWMOe8wPyp54Ydbteh9geHjA1nMPdJAMPT4e2l29juNgU8IlBE/4qLvHzs0bu8PTNlPi0iESq6mDd9/h8EHKJhcUkTP5rOD5vfDZZWJYl3LTv8fn/By2g2HIxGFLlAAAAAElFTkSuQmCC"
  };

  // extension/src/ui/coincheck.js
  var T = {
    insiders: [2, 10],
    dev: [1, 5],
    top10: [30, 50],
    launchHeld: [1, 5],
    drop: [20, 50]
  };
  var level = (v, [watch, risk]) => v == null ? null : v >= risk ? "risk" : v >= watch ? "watch" : "ok";
  function dropIfSold(soldPct2, poolTokens, supplyTokens) {
    if (!soldPct2 || !poolTokens || !supplyTokens) return null;
    const x = soldPct2 / 100 * supplyTokens;
    return (1 - (poolTokens / (poolTokens + x)) ** 2) * 100;
  }
  function coinCheck(token, rug, bundle) {
    if (!rug && !bundle?.ok) return null;
    const b = bundle?.ok ? bundle : null;
    const facts = [];
    let score = 100;
    let worst = "ok";
    const note = (lvl, penaltyWatch, penaltyRisk) => {
      if (lvl === "risk") {
        score -= penaltyRisk;
        worst = "risk";
      } else if (lvl === "watch") {
        score -= penaltyWatch;
        if (worst === "ok") worst = "watch";
      }
    };
    const launchHeld = b ? b.bundleHeldPct + b.devHeldPct : null;
    const linked = rug?.insiderPct ?? null;
    const insiders = Math.max(launchHeld ?? 0, linked ?? 0);
    const lvIns = level(insiders, T.insiders);
    note(lvIns, 10, 30);
    if (launchHeld != null || linked != null) {
      facts.push({ k: "Insiders hold", v: insiders, lvl: lvIns, sub: !insiders ? "" : linked != null && linked >= (launchHeld ?? 0) ? `${rug.insiderWallets} linked wallets` : "launch wallets" });
    }
    const dev = b ? b.devHeldPct : rug?.creatorPct ?? null;
    const lvDev = level(dev, T.dev);
    note(lvDev, 6, 18);
    if (dev != null) facts.push({ k: "Dev holds", v: dev, lvl: lvDev });
    if (b) {
      const lvLaunch = level(b.bundleHeldPct, T.launchHeld);
      note(lvLaunch, 5, 12);
      facts.push({ k: "Launch buyers still hold", v: b.bundleHeldPct, lvl: lvLaunch });
    }
    const top10 = rug?.top10Pct ?? null;
    const lvTop = level(top10, T.top10);
    note(lvTop, 8, 18);
    if (top10 != null) facts.push({ k: "Top 10 hold", v: top10, lvl: lvTop });
    const drop = dropIfSold(insiders, rug?.poolTokens, rug?.supplyTokens);
    const lvDrop = level(drop, T.drop);
    note(lvDrop, 8, 18);
    if (drop != null && insiders > 0) facts.push({ k: "If insiders sold all", v: -drop, lvl: lvDrop, unit: "price" });
    if (rug?.freezeAuthority) {
      score -= 45;
      worst = "risk";
      facts.push({ k: "Freeze authority", text: "Active: holders can be frozen", lvl: "risk" });
    }
    if (rug?.mintAuthority) {
      score -= 30;
      worst = "risk";
      facts.push({ k: "Mint authority", text: "Active: supply can grow", lvl: "risk" });
    }
    if (rug && !token?.onCurve && rug.lpLockedPct < 50) {
      score -= 15;
      if (worst === "ok") worst = "watch";
      facts.push({ k: "Liquidity", text: `${Math.round(rug.lpLockedPct)}% locked or burned`, lvl: "watch" });
    }
    if (rug?.copycat) {
      score -= 10;
      if (worst === "ok") worst = "watch";
      facts.push({ k: "Copycat", text: "Same name as an older coin", lvl: "watch" });
    }
    if (!token?.onCurve && token?.liquidity != null && token.liquidity < 5e3) {
      score -= 8;
      if (worst === "ok") worst = "watch";
    }
    if (rug?.rugged) {
      score = Math.min(score, 5);
      worst = "risk";
      facts.unshift({ k: "Status", text: "Liquidity pulled", lvl: "risk" });
    }
    if (worst === "risk") score = Math.min(score, 64);
    score = Math.max(0, Math.min(100, Math.round(score)));
    const word = score < 35 ? "CONTROLLED" : worst === "risk" ? "SKETCHY" : score >= 60 ? "OK" : "NEUTRAL";
    return { score, word, call: callLine(word, facts), facts };
  }
  var pctText = (v) => `${Math.abs(v) < 10 ? Math.abs(v).toFixed(1) : Math.round(Math.abs(v))}%`;
  function callLine(word, facts) {
    const ranked = facts.filter((f) => f.lvl === "risk").concat(facts.filter((f) => f.lvl === "watch"));
    const pick = (ranked.length ? ranked : facts).slice(0, 2).map((f) => f.text ? `${f.k.toLowerCase()}: ${f.text.toLowerCase()}` : f.unit === "price" ? `insiders selling would drop price ~${pctText(f.v)}` : `${f.k.toLowerCase()} ${pctText(f.v)}`);
    if (!pick.length) return word === "OK" ? "Spread-out holders, no live controls." : "";
    const s = pick.join(" \xB7 ");
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // extension/src/ui/larpcheck.js
  var esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  var ext = (href, body, cls, title = "") => `<a class="${cls}" href="${esc(href)}" target="_blank" rel="noopener noreferrer"${title ? ` title="${esc(title)}"` : ""}>${body}</a>`;
  var lcTone = (word) => ["LIKELY LARP", "LARP", "SCAM"].includes(word) ? "risk" : ["REAL", "LIKELY REAL"].includes(word) ? "ok" : "mid";
  var lcScore = (lc) => lc.total ?? lc.score;
  function lcStamp(lc) {
    const n2 = lcScore(lc);
    return `<span class="verdict ${lcTone(lc.verdict)}">${esc(lc.verdict)}${n2 == null ? "" : ` <b>${n2}</b>`}</span>`;
  }
  function lcButtonHtml(lc) {
    if (!lc?.checked) return "";
    const n2 = lcScore(lc);
    return ext(lc.url, `<span class="lc-k">Larpcheck</span><b>${esc(lc.verdict)}${n2 == null ? "" : ` ${n2}`}</b><span class="lc-go">\u2197</span>`, "lc-btn", lc.headline || lc.call || "");
  }
  function lcStoryHtml(lc, { open, symbol, chevron, ask = "" }) {
    const stamps = (lc.stamps || []).filter((s) => s.word);
    return `<div class="story ${lcTone(lc.verdict)}">
      <button class="story-top" data-story aria-expanded="${open}">
        <span class="story-k">Larp check</span>${lcStamp(lc)}${chevron}
      </button>
      <div class="story-call">${esc(lc.call || lc.headline || "")}</div>
      ${open ? `${lc.call && lc.headline ? `<p class="lc-headline">${esc(lc.headline)}</p>` : ""}
        ${stamps.length ? `<ul class="findings">${stamps.map((s) => `<li><span>${esc(s.id)}</span>${esc(s.word)}${s.score == null ? "" : ` \xB7 ${s.score}`}</li>`).join("")}</ul>` : ""}` : ""}
      ${ask}
      <div class="lc-foot"><span>Verdict by <b>Larpcheck</b>${symbol ? ` on $${esc(symbol)}` : ""}</span>${ext(lc.url, "Full report \u2197", "lc-btn")}</div>
    </div>`;
  }
  function lcCheckItHtml(page, symbol) {
    return page ? `<div class="lc-foot"><span>Radar's own read. Not on Larpcheck yet.</span>${ext(page, `Check ${symbol ? `$${esc(symbol)}` : "it"} on Larpcheck \u2197`, "lc-btn")}</div>` : "";
  }

  // extension/src/ui/radar.js
  var backend = null;
  var cssUrl = null;
  var cssInline = null;
  function useBackend(handlers2, { css, cssText } = {}) {
    backend = handlers2;
    cssUrl = css;
    cssInline = cssText;
  }
  var send = (type, payload = {}) => backend ? Promise.resolve().then(() => {
    const fn = backend[type];
    if (!fn) throw new Error(`Unknown request ${type}`);
    return fn({ type, ...payload });
  }) : new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage({ type, ...payload }, (res) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!res) return reject(new Error("No response"));
        res.ok ? resolve(res.data) : reject(new Error(res.error));
      });
    } catch (e) {
      reject(new Error("Extension was reloaded \u2014 refresh this tab"));
    }
  });
  var X_POST = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/\w+\/status\/\d+\S*$/i;
  var isPostLink = (s) => X_POST.test(String(s || "").trim());
  var CA = /^(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/;
  var scansOnPaste = (s) => isPostLink(s) || CA.test(String(s || "").trim());
  var esc2 = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  function usd(n2, { compact = true } = {}) {
    if (n2 == null || !Number.isFinite(n2)) return "\u2014";
    const a = Math.abs(n2);
    if (!compact || a < 1e3) return `$${a < 10 ? n2.toFixed(2) : Math.round(n2).toLocaleString("en-US")}`;
    const [d, s] = a >= 1e9 ? [1e9, "B"] : a >= 1e6 ? [1e6, "M"] : [1e3, "K"];
    const v = n2 / d;
    return `$${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)}${s}`;
  }
  function price(p) {
    if (!p) return "\u2014";
    if (p >= 1) return `$${p.toLocaleString("en-US", { maximumFractionDigits: p >= 1e3 ? 0 : 4 })}`;
    const str = p.toFixed(20);
    const m = str.match(/^0\.(0*)(\d{1,4})/);
    if (!m) return `$${p}`;
    const zeros = m[1].length;
    return zeros >= 4 ? `$0.0<sub>${zeros}</sub>${m[2]}` : `$${p.toPrecision(4)}`;
  }
  var pct2 = (n2, digits = 1) => n2 == null || !Number.isFinite(+n2) ? "\u2014" : `${+n2 > 0 ? "+" : ""}${(+n2).toFixed(Math.abs(n2) >= 1e3 ? 0 : digits)}%`;
  var soldPct = (bought, held) => bought > 0 ? Math.max(0, Math.min(100, (1 - held / bought) * 100)) : 0;
  var pctPlain = (n2, d = 1) => n2 == null || !Number.isFinite(+n2) ? "\u2014" : `${(+n2).toFixed(d)}%`;
  var num = (n2) => n2 == null ? "\u2014" : n2 >= 1e6 ? `${(n2 / 1e6).toFixed(2)}M` : n2 >= 1e4 ? `${(n2 / 1e3).toFixed(1)}K` : Math.round(n2).toLocaleString("en-US");
  var launchUrl = (post) => `https://tryradar.fun/launch?post=${encodeURIComponent(post)}`;
  var launchedWithRadar = (t) => (t.websites || []).some((w) => /^https:\/\/tryradar\.fun\/launched/.test(w?.url || w));
  function postTimeOf(postUrl) {
    const id = String(postUrl || "").match(/\/status\/(\d+)/)?.[1];
    return id ? Number((BigInt(id) >> 22n) + 1288834974657n) : null;
  }
  function launchedVsPost(createdAt, postUrl) {
    const posted = postTimeOf(postUrl);
    if (!posted || !createdAt) return null;
    const gap = createdAt - posted;
    return `${age(Date.now() - Math.abs(gap))} ${gap < 0 ? "before" : "after"} the post`;
  }
  function age(ms) {
    if (!ms) return "\u2014";
    const m = (Date.now() - ms) / 6e4;
    if (m < 60) return `${Math.max(1, Math.round(m))}m`;
    const h = m / 60;
    if (h < 24) return `${Math.round(h)}h`;
    const d = h / 24;
    if (d < 60) return `${Math.round(d)}d`;
    const mo = d / 30.44;
    if (mo < 24) return `${Math.round(mo)}mo`;
    return `${(d / 365.25).toFixed(1)}y`;
  }
  var short = (a) => a ? `${a.slice(0, 4)}\u2026${a.slice(-4)}` : "";
  var hue = (s) => [...s || "x"].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  var I = {
    crown: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M3 7l4.5 4L12 4l4.5 7L21 7l-2 12H5L3 7z"/></svg>',
    og: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 3h12M6 21h12M7 3c0 5 10 6 10 9s-10 4-10 9M17 3c0 5-10 6-10 9"/></svg>',
    gear: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/></svg>',
    bolt: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/></svg>',
    bell: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 1112 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 003.4 0"/></svg>',
    pin: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 21s-7-6.2-7-11a7 7 0 1114 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
    copy: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15V5a2 2 0 012-2h10"/></svg>',
    check: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>',
    x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    xs: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
    spark: '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9L12 2zm7 13l.9 2.6 2.6.9-2.6.9L19 22l-.9-2.6-2.6-.9 2.6-.9L19 15z"/></svg>',
    bubble: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="8" cy="9" r="5"/><circle cx="17" cy="15" r="4"/><circle cx="16" cy="5" r="2"/></svg>',
    chevron: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
    share: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v13M7 8l5-5 5 5M5 14v5a2 2 0 002 2h10a2 2 0 002-2v-5"/></svg>',
    refresh: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7"/></svg>'
  };
  var MARK = `<svg class="mark" viewBox="0 0 26 26" width="26" height="26" shape-rendering="crispEdges" aria-hidden="true">
  <rect width="26" height="26" rx="7" fill="#5621AC"/><path transform="translate(5 5)" fill="#fff" d="M7 0h5v1h-5zM7 1h5v1h-5zM7 2h5v1h-5zM3 3h10v1h-10zM2 4h12v1h-12zM1 5h4v1h-4zM11 5h4v1h-4zM1 6h3v1h-3zM5 6h1v1h-1zM11 6h4v1h-4zM1 7h2v1h-2zM10 7h2v1h-2zM13 7h2v1h-2zM1 8h2v1h-2zM9 8h2v1h-2zM13 8h2v1h-2zM1 9h2v1h-2zM7 9h3v1h-3zM13 9h2v1h-2zM1 10h2v1h-2zM7 10h2v1h-2zM13 10h2v1h-2zM1 11h2v1h-2zM5 11h1v1h-1zM11 11h1v1h-1zM13 11h2v1h-2zM1 12h3v1h-3zM12 12h3v1h-3zM2 13h12v1h-12zM3 14h10v1h-10z"/></svg>`;
  var ROLE = {
    top: { label: "TOP MARKET CAP", icon: I.crown },
    og: { label: "THE OG", icon: I.og },
    mover: { label: "THE MOVER", icon: I.bolt },
    tech: { label: "TECH MATCH", icon: I.spark },
    ca: { label: "MENTIONED CA", icon: I.pin },
    more: { label: "MATCH", icon: I.pin }
  };
  var CHAIN_LABEL = { solana: "SOL", robinhood: "Robinhood" };
  var BUBBLE_CHAIN = { solana: "solana", base: "base", bsc: "bsc", ethereum: "eth" };
  function links(t) {
    const a = t.address;
    if (t.chain === "solana") return [["Chart", t.url || `https://dexscreener.com/solana/${a}`], ["GMGN", `https://gmgn.ai/sol/token/${a}`]];
    const g = { base: "base", bsc: "bsc", ethereum: "eth" }[t.chain];
    const scan = { base: "https://basescan.org/token/", bsc: "https://bscscan.com/token/", ethereum: "https://etherscan.io/token/", robinhood: "https://robinhoodchain.blockscout.com/token/" }[t.chain];
    return [["Chart", t.url], g ? ["GMGN", `https://gmgn.ai/${g}/token/${a}`] : ["Explorer", scan ? scan + a : t.url]];
  }
  var TERM_KEY = "nr:terminal";
  var prefTerm = () => {
    try {
      return localStorage.getItem(TERM_KEY) || "axiom";
    } catch {
      return "axiom";
    }
  };
  var setPrefTerm = (id) => {
    try {
      localStorage.setItem(TERM_KEY, id);
    } catch {
    }
  };
  var quickBuyUrl = (t) => `https://tryradar.fun/trade?mint=${encodeURIComponent(t.address)}`;
  var INSTA_SOL = ["0.05", "0.1", "0.25", "0.5", "1"];
  var INSTA_KEY = "nr:insta-sol";
  var instaSol = () => {
    try {
      const v = localStorage.getItem(INSTA_KEY);
      return INSTA_SOL.includes(v) ? v : "0.1";
    } catch {
      return "0.1";
    }
  };
  var setInstaSol = (v) => {
    try {
      localStorage.setItem(INSTA_KEY, v);
    } catch {
    }
  };
  var instaUrl = (addr, sol) => `https://tryradar.fun/trade?mint=${encodeURIComponent(addr)}&sol=${sol}&insta=1`;
  var INSTA_ETH = ["0.005", "0.01", "0.025", "0.05", "0.1"];
  var INSTA_ETH_KEY = "nr:insta-eth";
  var instaEth = () => {
    try {
      const v = localStorage.getItem(INSTA_ETH_KEY);
      return INSTA_ETH.includes(v) ? v : "0.01";
    } catch {
      return "0.01";
    }
  };
  var setInstaEth = (v) => {
    try {
      localStorage.setItem(INSTA_ETH_KEY, v);
    } catch {
    }
  };
  var isHood = (t) => t?.chain === "robinhood";
  var hoodBuyUrl = (addr, eth) => `https://tryradar.fun/trade-robinhood?token=${encodeURIComponent(addr)}${eth ? `&eth=${eth}&insta=1` : ""}`;
  var QUICK_MARKETS = /* @__PURE__ */ new Set(["pumpfun", "pumpswap", "raydium"]);
  var quickBuyable = (t) => t.chain === "solana" && (!t.dexId || QUICK_MARKETS.has(t.dexId));
  function terminals(t) {
    const a = t.address;
    if (t.chain === "robinhood") return [{ id: "uniswap", name: "Uniswap", url: `https://app.uniswap.org/swap?chain=robinhood&outputCurrency=${a}` }];
    if (t.chain !== "solana") return [];
    return [
      { id: "axiom", name: "Axiom", url: `https://axiom.trade/meme/${t.pair || a}?chain=sol` },
      { id: "padre", name: "Padre", url: `https://trade.padre.gg/trade/solana/${a}` },
      { id: "fomo", name: "Fomo", url: `https://fomo.family/tokens/solana/${a}` },
      { id: "larpcheck", name: "LarpCheck", url: `https://larpcheck.app/${a}` }
    ];
  }
  async function frameGrid(src, { cols = 3, rows = 2, cellW = 320, timeoutMs = 15e3 } = {}) {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = "auto";
    video.src = src;
    const once = (ev) => new Promise((resolve, reject) => {
      const ok = () => {
        cleanup();
        resolve();
      };
      const bad = () => {
        cleanup();
        reject(new Error("video failed to load"));
      };
      const cleanup = () => {
        video.removeEventListener(ev, ok);
        video.removeEventListener("error", bad);
      };
      video.addEventListener(ev, ok, { once: true });
      video.addEventListener("error", bad, { once: true });
    });
    const work = (async () => {
      await once("loadedmetadata");
      const n2 = cols * rows;
      const ratio = video.videoHeight / video.videoWidth || 9 / 16;
      const cellH = Math.round(cellW * ratio);
      const canvas = document.createElement("canvas");
      canvas.width = cellW * cols;
      canvas.height = cellH * rows;
      const ctx = canvas.getContext("2d");
      const dur = Number.isFinite(video.duration) ? video.duration : 0;
      for (let i = 0; i < n2; i++) {
        video.currentTime = dur ? Math.min(dur - 0.05, dur * ((i + 0.5) / n2)) : 0;
        await once("seeked");
        ctx.drawImage(video, i % cols * cellW, Math.floor(i / cols) * cellH, cellW, cellH);
      }
      return canvas.toDataURL("image/jpeg", 0.72);
    })();
    try {
      return await Promise.race([work, new Promise((_, rej) => setTimeout(() => rej(new Error("video timed out")), timeoutMs))]);
    } finally {
      video.removeAttribute("src");
      video.load();
    }
  }
  var canSettings = () => !!(globalThis.browser ?? globalThis.chrome)?.permissions?.request;
  var Radar = class {
    constructor(root, { inline = false, onClose, hint } = {}) {
      this.root = root;
      this.inline = inline;
      this.hint = hint;
      this.onClose = onClose;
      this.state = { picks: [], others: [], mentioned: [], source: null, loading: false, error: null, narrative: null, ts: 0 };
      this.prepared = /* @__PURE__ */ new Map();
      this.tokens = /* @__PURE__ */ new Map();
      this.audits = /* @__PURE__ */ new Map();
      this.larp = /* @__PURE__ */ new Map();
      this.expanded = /* @__PURE__ */ new Set();
      this.openCards = /* @__PURE__ */ new Set();
      this.refreshSec = 10;
      this.timers = [];
      this.scanId = 0;
      this.view = "scan";
      this.frontrun = null;
      this.frSel = /* @__PURE__ */ new Map();
      this.frBusy = /* @__PURE__ */ new Set();
      this.frMsg = /* @__PURE__ */ new Map();
      this.alerts = null;
      this.watchBusy = false;
      this.holder = null;
      this.who = /* @__PURE__ */ new Map();
      this.whoBusy = /* @__PURE__ */ new Set();
      this.render();
      this.loadFrontrun();
      this.loadAlerts();
      this.loadHolder();
      this.listenForBuys();
      send("settings").then((s) => {
        this.refreshSec = s.refreshSec || 10;
      }).catch(() => {
      });
      document.addEventListener("visibilitychange", () => this.updateLive());
    }
    /* ----- public ----- */
    open({ post = null, text = "", source = null, trends = null } = {}) {
      if (trends) this.trends = trends;
      this.shell.classList.add("open");
      const p = post || (text ? { text } : null);
      if (p) this.scan({ post: p, source });
      else if (!this.state.ts) this.renderBody();
      if (!p) setTimeout(() => this.input?.focus(), 250);
      if (!p && this.inline) {
        this.loadRecent();
        this.loadBoard();
      }
    }
    // Hovering the radar button starts the work early; the click then picks up the same result.
    prefetch(post) {
      if (!post) return;
      this.preparePost(post).then((p) => send("coins", { post: p })).catch(() => {
      });
    }
    close() {
      this.shell.classList.remove("open");
      this.stopTimers();
      this.onClose?.();
    }
    get isOpen() {
      return this.shell.classList.contains("open");
    }
    /* ----- scanning ----- */
    // Larpcheck's lists, on the panel before a scan.
    loadBoard(sort = this.boardSort || "asks") {
      this.boardSort = sort;
      send("lcBoard", { sort }).then((d) => {
        if (this.boardSort !== sort) return;
        this.board = d?.rows || [];
        if (!this.state.ts && !this.state.loading && this.view !== "settings") this.renderBody();
      }).catch(() => {
      });
    }
    boardHtml() {
      const rows = this.board || [];
      const tabs = [["asks", "Most asked"], ["real", "Most real"], ["larp", "Most larp"]];
      if (!rows.length && !this.boardSort) return "";
      return `<div class="lc-board"><div class="recent-top"><span>Larpcheck today</span><a href="https://larpcheck.app/" target="_blank" rel="noopener noreferrer">larpcheck.app \u2197</a></div>
      <div class="lc-tabs" role="tablist">${tabs.map(([id, label]) => `<button type="button" role="tab" aria-selected="${this.boardSort === id}" data-board="${id}">${label}</button>`).join("")}</div>
      ${rows.length ? rows.map((r) => `<div class="lc-row"><button type="button" data-board-coin="${esc2(r.coin)}" data-board-title="${esc2(r.title || "")}"><b>${esc2(r.title || `${r.coin.slice(0, 4)}\u2026${r.coin.slice(-4)}`)}</b></button><a href="${esc2(r.url)}" target="_blank" rel="noopener noreferrer" title="Open this check on Larpcheck">${lcStamp(r)}</a></div>`).join("") : '<p class="lc-none">Nothing on this list yet today.</p>'}
    </div>`;
    }
    loadRecent() {
      send("recentList").then((list) => {
        this.recent = list;
        if (!this.state.ts && !this.state.loading && this.view !== "settings") this.renderBody();
      }).catch(() => {
      });
    }
    async scan({ post, source = null }) {
      send("launchState").then((s) => {
        this.launchOn = s?.state === "on";
      }).catch(() => {
      });
      const id = ++this.scanId;
      const stale = () => id !== this.scanId;
      const asked = post?.url || post?.text;
      this.stopTimers();
      this.lastPost = post;
      this.state = { ...this.state, loading: true, error: null, narrative: null, engineError: null, source: source ?? this.state.source };
      this.renderHead();
      this.renderBody();
      try {
        if (post && Object.keys(post).length === 1 && isPostLink(post.text)) {
          this.state = { ...this.state, source: { kind: "Post", label: "Opening the post\u2026" } };
          this.renderHead();
          const full = await send("tweet", { url: post.text.trim() });
          if (stale()) return;
          post = full.post;
          this.lastPost = post;
          this.state = { ...this.state, source: full.source };
          this.renderHead();
        }
        const p = await this.preparePost(post, id);
        if (stale()) return;
        const read = await send("read", { post: p });
        if (stale()) return;
        this.state = { ...this.state, narrative: read.narrative };
        this.renderHead();
        const res = await send("coins", { post: p });
        if (stale()) return;
        this.bodyEl.dataset.timing = JSON.stringify(res.timing || {});
        this.state = { ...this.state, ...res, loading: false };
        this.tokens.clear();
        for (const t of [...res.mentioned, ...res.techMatch ? [res.techMatch] : [], ...res.roleCandidates || [], ...res.picks.map((x) => x.token), ...res.others]) this.tokens.set(t.address, t);
        this.renderHead();
        this.renderBody();
        this.renderFoot();
        this.loadAudits();
        this.startTimers();
        this.loadStory(p, read.narrative, res, id);
        send("recentAdd", { item: recentItem({ asked, source, narrative: read.narrative, res }) }).catch(() => {
        });
      } catch (e) {
        if (stale()) return;
        this.state = { ...this.state, loading: false, error: e.message };
        this.renderHead();
        this.renderBody();
      }
    }
    // Video posts: pull the MP4, grid its frames for the vision model, keep the MP4 for transcription.
    preparePost(post, id = null) {
      if (!post?.hasVideo || !post.url) return Promise.resolve(post);
      if (!this.prepared.has(post.url)) {
        this.prepared.set(post.url, (async () => {
          const info = post.videoUrl ? { mp4: post.videoUrl, gif: post.gif } : await send("videoInfo", { url: post.url }).catch(() => null);
          if (!info?.mp4) return post;
          const grid = await frameGrid(info.mp4).catch(() => null);
          return { ...post, videoUrl: info.mp4, gif: info.gif, images: [grid, ...post.images || []].filter(Boolean).slice(0, 3) };
        })());
      }
      if (id === this.scanId) {
        this.watching = true;
        this.renderHead();
        this.prepared.get(post.url).finally(() => {
          this.watching = false;
        });
      }
      return this.prepared.get(post.url);
    }
    rescan() {
      if (this.lastPost) this.scan({ post: this.lastPost });
    }
    cardTokens() {
      const tokens = [...this.state.mentioned, ...this.state.techMatch ? [this.state.techMatch] : [], ...this.state.picks.map((p) => p.token), ...this.state.others.filter((t) => this.expanded.has(t.address))];
      return [...new Map(tokens.map((t) => [t.address, t])).values()].map((t) => this.tokens.get(t.address) || t);
    }
    loadAudits() {
      for (const t of this.cardTokens()) {
        this.loadAudit(t);
        this.loadLarp(t);
      }
    }
    // Larpcheck's verdict on a coin, kept 10 minutes. null when it can't be read or no key is set.
    async larpFor(t) {
      const hit = this.larp.get(t.address);
      if (hit && Date.now() - hit.at < 6e5) return hit.lc;
      const lc = await send("larpcheck", { address: t.address }).catch(() => null);
      if (!lc || lc.off) return null;
      this.larp.set(t.address, { lc, at: Date.now() });
      return lc;
    }
    async loadLarp(t) {
      if (await this.larpFor(t)) this.renderLarp(t.address);
    }
    renderActions(addr) {
      const el = this.bodyEl.querySelector(`[data-actions="${addr}"]`);
      const t = this.tokens.get(addr);
      if (el && t) el.innerHTML = this.actionsHtml(t);
    }
    renderLarp(addr) {
      const lc = this.larp.get(addr)?.lc;
      const card = this.bodyEl.querySelector(`.card[data-addr="${addr}"]`);
      if (!lc || !card) return;
      const slot = card.querySelector("[data-lc]");
      if (slot) slot.innerHTML = lcButtonHtml(lc);
    }
    // Radar's holder check is Solana only. Elsewhere the card uses Larpcheck's holder panel, credited and linked.
    async loadLcHolders(t) {
      const v = await send("lcHolders", { address: t.address, chain: t.chain }).catch(() => null);
      if (!v?.ready) return;
      (this.lcHolderData ||= /* @__PURE__ */ new Map()).set(t.address, v);
      this.renderLcHolders(t.address);
    }
    renderLcHolders(addr) {
      const v = this.lcHolderData?.get(addr);
      const card = v && this.bodyEl.querySelector(`[data-addr="${addr}"]`);
      if (!card) return;
      const h = card.querySelector('[data-k="holders"]');
      if (h && v.holders != null) h.textContent = num(v.holders);
      const el = card.querySelector(`[data-lch="${addr}"]`);
      if (!el || !v.line) return;
      el.hidden = false;
      el.className = `hc ${v.ok ? "ok" : "no"}`;
      el.innerHTML = `<span class="hc-mark">${v.ok ? "\u2713" : "\u2715"}</span><span>${esc2(v.line)}</span><a class="hc-by" href="${esc2(v.page)}" target="_blank" rel="noopener noreferrer">Larpcheck \u2197</a>`;
    }
    async loadAudit(t, { force = false } = {}) {
      if (t.chain !== "solana") return this.loadLcHolders(t);
      const a = this.audits.get(t.address) || {};
      if (a.loading && !force) return;
      a.loading = true;
      this.audits.set(t.address, a);
      const rug = send("safety", { mint: t.address, pairs: t.pairAddresses }).then((r) => {
        a.rug = r;
        a.rugErr = null;
      }).catch((e) => {
        a.rugErr = e.message;
      }).finally(() => this.renderAudit(t.address));
      const bundle = send("bundle", { mint: t.address, launchMs: t.createdAt, pairs: t.pairAddresses, launchPair: t.launchPair, launchDex: t.launchDex }).then((b) => {
        a.bundle = b;
        a.bundleErr = null;
      }).catch((e) => {
        a.bundleErr = e.message;
      }).finally(() => this.renderAudit(t.address));
      await Promise.allSettled([rug, bundle]);
      a.loading = false;
    }
    /* ----- live updates ----- */
    startTimers() {
      this.stopTimers();
      this.timers.push(setInterval(() => this.tick(), this.refreshSec * 1e3));
      this.timers.push(setInterval(() => {
        if (!document.hidden) this.cardTokens().forEach((t) => this.loadAudit(t));
      }, 6e4));
      this.updateLive();
    }
    stopTimers() {
      this.timers.forEach(clearInterval);
      this.timers = [];
      this.updateLive();
    }
    updateLive() {
      const live = this.root.querySelector(".live");
      if (!live) return;
      const on = this.timers.length && !document.hidden;
      live.classList.toggle("paused", !on);
      live.querySelector("span").textContent = on ? `LIVE \xB7 ${this.refreshSec}s` : this.state.ts ? "PAUSED" : "READY";
    }
    async tick() {
      if (document.hidden || !this.inline && !this.isOpen) return;
      const list = [...this.tokens.values()].map((t) => ({ chain: t.chain, address: t.address }));
      if (!list.length) return;
      try {
        const deep = this.cardTokens().map((t) => t.address);
        const fresh = await send("refresh", {
          tokens: list,
          deep,
          roleCandidates: this.state.roleCandidates || [],
          roleCut: this.state.roleCut ?? 0
        });
        for (const [addr, t] of Object.entries(fresh.tokens || {})) {
          const prev = this.tokens.get(addr);
          if (!prev) continue;
          const next = { ...prev, ...t, relevance: prev.relevance, matched: prev.matched };
          this.tokens.set(addr, next);
          this.patchCard(prev, next);
        }
        const ranked = fresh.ranking;
        if (ranked?.picks?.length && !this.bodyEl.matches(":hover")) {
          const signature = (items) => items.map(
            (p) => [p.role, p.token.address, Number(p.alsoTop), Number(p.alsoOg), Number(p.alsoMover)].join(":")
          ).join("|");
          const rolesChanged = signature(this.state.picks) !== signature(ranked.picks);
          this.state.picks = ranked.picks;
          this.state.others = ranked.others;
          this.state.roleCandidates = ranked.roleCandidates;
          this.state.roleCut = ranked.roleCut;
          if (rolesChanged) {
            const scrollTop = this.bodyEl.scrollTop;
            this.renderBody();
            this.bodyEl.scrollTop = scrollTop;
            this.loadAudits();
          }
        }
        this.state.ts = Date.now();
        this.renderFoot();
      } catch {
      }
    }
    /* ----- rendering ----- */
    render() {
      this.root.innerHTML = `
      <div class="shell">
        <div class="head"></div>
        <div class="body"></div>
        <div class="foot"></div>
        <div class="toast"></div>
      </div>`;
      this.shell = this.root.querySelector(".shell");
      this.headEl = this.root.querySelector(".head");
      this.bodyEl = this.root.querySelector(".body");
      this.footEl = this.root.querySelector(".foot");
      this.toastEl = this.root.querySelector(".toast");
      this.renderHead();
      this.renderBody();
      this.renderFoot();
      this.bodyEl.addEventListener("click", (e) => this.onBodyClick(e));
      this.bodyEl.addEventListener("input", (e) => {
        const a = e.target.closest("[data-fr-amt]");
        if (!a) return;
        this.frSelFor(a.dataset.frAmt).sol = a.value.trim();
        this.updateFrGo(a.dataset.frAmt);
      });
      this.bodyEl.addEventListener("change", (e) => {
        const sl = e.target.closest("[data-fr-slip]");
        if (sl) this.frSelFor(sl.dataset.frSlip).bps = Number(sl.value);
        const w = e.target.closest("[data-fr-wallet]");
        if (w) this.frSelFor(w.dataset.frWallet).wallet = w.value;
      });
      this.headEl.addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (!b) return;
        if (b.dataset.act === "close") this.close();
        else if (b.dataset.act === "rescan") this.rescan();
        else if (b.dataset.act === "share") this.share();
        else if (b.dataset.act === "settings") {
          this.view = this.view === "settings" ? "scan" : "settings";
          this.renderBody();
        } else if (b.dataset.act === "watch") this.watch();
        else if (b.dataset.lcCheck) this.runLcCheck(b.dataset.lcCheck);
        else if (b.dataset.act === "unwatch") this.unwatch(b.dataset.id);
        else if ("story" in b.dataset) {
          this.expanded.has("story") ? this.expanded.delete("story") : this.expanded.add("story");
          this.renderHead();
        }
      });
      this.headEl.addEventListener("submit", (e) => {
        const form = e.target.closest("[data-lc-ask]");
        if (!form) return;
        e.preventDefault();
        const q = form.querySelector("input").value.trim();
        if (q) this.runLcAsk(form.dataset.lcAsk, q);
      });
      this.root.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !this.inline) this.close();
      });
    }
    renderHead() {
      const { source } = this.state;
      const postUrl = this.lastPost?.url;
      const typed = this.input?.value;
      const typing = this.input && this.input.getRootNode().activeElement === this.input;
      this.headEl.innerHTML = `
      <div class="brand">
        ${MARK}
        <div class="title">Radar</div>
        <div class="live paused"><i></i><span>READY</span></div>
        ${this.inline && canSettings() ? `<button class="icon-btn" data-act="settings" title="Settings">${I.gear}</button>` : ""}
        ${this.state.ts && this.state.picks?.length ? `<button class="icon-btn" data-act="share" title="Copy a summary to share">${I.share}</button>` : ""}
        ${this.state.ts ? `<button class="icon-btn" data-act="rescan" title="Rescan">${I.refresh}</button>` : ""}
        ${this.inline ? "" : `<button class="icon-btn" data-act="close" title="Close (Esc)">${I.x}</button>`}
      </div>
      ${this.inline ? `<form class="search">
        ${I.search}
        <input type="text" placeholder="Search a narrative, paste a post or a CA" spellcheck="false" autocomplete="off" />
        <span class="kbd">\u21B5</span>
      </form>` : ""}
      ${source ? `<div class="source"><b>${esc2(source.kind)}</b><span>${esc2(source.label)}</span>${isPostLink(postUrl) && postTimeOf(postUrl) ? `<a href="${esc2(postUrl)}" target="_blank" rel="noopener noreferrer" title="Open the post">${age(postTimeOf(postUrl))} ago \u2197</a>` : ""}</div>` : ""}
      ${this.watchHtml()}
      ${this.narrativeHtml()}`;
      this.input = this.headEl.querySelector("input");
      if (this.input && typed) this.input.value = typed;
      if (typing) this.input?.focus();
      this.headEl.querySelector("form")?.addEventListener("submit", (e) => {
        e.preventDefault();
        const v = this.input.value.trim();
        if (!v) return;
        this.input.value = "";
        this.input.blur();
        this.scan({ post: { text: v }, source: isPostLink(v) ? null : { kind: "Search", label: v.slice(0, 80) } });
      });
      this.input?.addEventListener("paste", (e) => {
        if (this.input.value.trim() || !scansOnPaste(e.clipboardData?.getData("text"))) return;
        setTimeout(() => this.headEl.querySelector("form")?.requestSubmit());
      });
      this.updateLive();
    }
    // Larp check under the narrative (is the post's story real?): one word + score, a trader's one-liner, findings on tap.
    // When Larpcheck has a verdict on the coin, the larp check is theirs, credited and linked to their report.
    // ---------- Who posted this (holders of $RADAR, data from Frontrun; server/holder.js) ----------
    loadHolder() {
      send("lcSettings").then((s) => {
        this.lcPlan = !!s?.plan;
        this.renderHead();
      }).catch(() => {
      });
      return send("holderStatus").then((h) => {
        this.holder = h;
        this.renderHead();
      }).catch(() => {
        this.holder = { on: false };
      });
    }
    whoHtml() {
      const handle = this.lastPost?.author;
      if (!this.holder?.on || !handle) return "";
      const head = '<div class="story-top who-top"><span class="story-k">Who posted this</span></div>';
      if (!this.holder.holder) {
        return `<div class="story who">${head}
        <div class="story-call">${esc2(this.holder.pitch || "")}</div>
        <button type="button" class="who-connect" data-holder-connect>Check my wallet</button></div>`;
      }
      const w = this.who.get(handle);
      if (!w) {
        this.loadWho(handle);
        return `<div class="story who loading">${head}<div class="story-call"><span class="spinner"></span>Looking up @${esc2(handle)}\u2026</div></div>`;
      }
      if (w.error) return `<div class="story who">${head}<div class="story-call">${esc2(w.error)}</div></div>`;
      if (w.off) return "";
      const lines = [];
      const own = w.own?.coins;
      const total = own ? own.live + own.deleted : 0;
      if (own) lines.push(total ? `Radar has seen <b>${total}</b> coin${total === 1 ? "" : "s"} from this account${own.deletedPosts ? `, and <b class="who-gone">${own.deletedPosts}</b> of its coin post${own.deletedPosts === 1 ? " is" : "s are"} gone` : ""}` : "Radar hasn't seen this account post a coin yet.");
      if (w.lc?.checked) lines.push(`Larpcheck has checked <b>${w.lc.checked}</b> post${w.lc.checked === 1 ? "" : "s"} from this account${w.lc.risky ? `, and <b class="who-gone">${w.lc.risky}</b> came back as likely larp, larp or scam` : ""}`);
      const lcRows = (w.lc?.rows || []).map((r) => `<a class="who-row" href="${esc2(r.url)}" target="_blank" rel="noopener noreferrer"><b>${esc2(r.verdict)}${r.total == null ? "" : ` ${r.total}`}</b><span>${esc2(r.title || "Post")}</span><span>Larpcheck \u2197</span><span></span></a>`).join("");
      const rows = (w.own?.recent || []).map((r) => `<a class="who-row" href="https://x.com/${esc2(handle)}/status/${esc2(r.id)}" target="_blank" rel="noopener noreferrer">
        <b>${r.symbol ? `$${esc2(r.symbol)}` : esc2(`${r.ca.slice(0, 4)}\u2026${r.ca.slice(-4)}`)}</b><span>${r.mc ? usd(r.mc) : "no market"}</span><span>${age(r.at)} ago</span><span class="who-gone">${r.gone ? "post gone" : ""}</span></a>`).join("");
      if (w.smartCount != null) lines.push(`<b>${w.smartCount}</b> smart follower${w.smartCount === 1 ? "" : "s"}${w.smartFinal ? "" : " so far"}${w.smart?.length ? `: ${w.smart.map((s) => `@${esc2(s)}`).join(", ")}` : ""}`);
      if (w.coins) lines.push(`Frontrun: posted <b>${w.coins.live + w.coins.deleted}</b> coin${w.coins.live + w.coins.deleted === 1 ? "" : "s"}${w.coins.deleted ? `, <b>${w.coins.deleted}</b> in deleted posts` : ""}`);
      return `<div class="story who">${head}
      ${w.label ? `<div class="who-label">${esc2(w.label)}</div>` : ""}
      ${lines.map((l) => `<div class="story-call">${l}</div>`).join("")}
      ${rows ? `<div class="who-rows">${rows}</div>` : ""}
      ${lcRows ? `<div class="who-rows">${lcRows}</div>` : ""}
      <div class="story-note">Radar's own record, from posts scanned since 30 Oct 2026, so it won't show everything${w.smartCount != null || w.coins ? ". Smart followers from Frontrun" : ""}.</div></div>`;
    }
    async loadWho(handle) {
      this.who.set(handle, { loading: true });
      this.who.delete(handle);
      if (this.whoBusy.has(handle)) return;
      this.whoBusy.add(handle);
      try {
        const w = await send("holderWho", { handle });
        if (w.locked) await this.loadHolder();
        else this.who.set(handle, w);
      } catch (err) {
        this.who.set(handle, { error: err.message });
      }
      this.whoBusy.delete(handle);
      this.renderHead();
    }
    // The wallet check runs on tryradar.fun, where the wallet lives, and reports back here (see listenForBuys).
    holderConnect() {
      const w = 440;
      const left = Math.max(0, (window.screenX || 0) + (window.outerWidth || w) - w - 32);
      const win = window.open("https://tryradar.fun/holder", "radar-holder", `popup=yes,width=${w},height=640,left=${left},top=${Math.max(0, (window.screenY || 0) + 72)}`);
      if (!win) this.toast("Pop-ups are blocked here. Allow them to check your wallet", 3200);
    }
    storyHtml() {
      const s = this.state.story;
      if (!s || s.error) return "";
      if (s.loading) return `<div class="story loading"><div class="story-top"><span class="story-k">Larp check</span></div><div class="story-call"><span class="spinner"></span>Checking the author, links and coin\u2026</div></div>`;
      const open = this.expanded.has("story");
      if (s.larpcheck) return lcStoryHtml(s.larpcheck, { open, symbol: s.coin, chevron: I.chevron, ask: open ? this.lcAskHtml(s.larpcheck) : "" });
      const tone = ["LIKELY LARP", "LARP"].includes(s.word) ? "risk" : ["REAL", "LIKELY REAL"].includes(s.word) ? "ok" : "mid";
      return `<div class="story ${tone}">
      <button class="story-top" data-story aria-expanded="${open}">
        <span class="story-k">Larp check</span><span class="verdict ${tone}">${esc2(s.word)} <b>${s.score}</b></span>${I.chevron}
      </button>
      <div class="story-call">${esc2(s.call)}</div>
      ${open ? `<ul class="findings">${(s.findings || []).map((f) => `<li class="${esc2(f.kind)}"><span>${esc2(f.kind)}</span>${esc2(f.text)}</li>`).join("")}</ul>
        <div class="story-note">Checks evidence, not people. ${s.coin ? `Read with $${esc2(s.coin)}.` : "No coin was checked."}</div>` : ""}
      ${this.lcRunHtml(s)}
      ${lcCheckItHtml(s.lcPage, s.coin)}
    </div>`;
    }
    // Paid Larpcheck features, for $RADAR holders, only when the server's key has a plan (/lc/settings).
    get lcPerks() {
      return !!(this.lcPlan && this.holder?.holder);
    }
    lcRunHtml(s) {
      if (!s.lcPage || !s.lcAddress) return "";
      const run = this.lcRun?.address === s.lcAddress ? this.lcRun : null;
      if (run?.error) return `<div class="story-note">${esc2(run.error)}</div>`;
      if (run) return `<div class="story-call"><span class="spinner"></span>Larpcheck is checking it${run.step ? `: ${esc2(run.step)}` : "\u2026"}</div>`;
      return this.lcPerks ? `<button type="button" class="who-connect" data-lc-check="${esc2(s.lcAddress)}">Check ${s.coin ? `$${esc2(s.coin)}` : "it"} on Larpcheck now</button>` : "";
    }
    lcAskHtml(lc) {
      if (!this.lcPerks || !lc.id) return "";
      const a = this.lcAnswer?.id === lc.id ? this.lcAnswer : null;
      return `<form class="lc-ask" data-lc-ask="${esc2(lc.id)}"><input type="text" maxlength="499" placeholder="Ask Larpcheck about this coin" autocomplete="off" spellcheck="false" /><button type="submit"${a?.busy ? " disabled" : ""}>${a?.busy ? "\u2026" : "Ask"}</button></form>
      ${a?.error ? `<div class="story-note">${esc2(a.error)}</div>` : ""}
      ${a?.answer ? `<div class="lc-answer"><p>${esc2(a.answer)}</p><span>Answer by <b>Larpcheck</b></span></div>` : ""}`;
    }
    async runLcCheck(address) {
      this.lcRun = { address };
      this.renderHead();
      const scanAtStart = this.scanId;
      try {
        const { id } = await send("lcStart", { input: address });
        for (let i = 0; i < 60; i++) {
          const c = await send("lcPoll", { id });
          if (c.error) throw new Error(c.error);
          if (c.lc) {
            this.larp.set(address, { lc: c.lc, at: Date.now() });
            this.lcRun = null;
            if (scanAtStart === this.scanId && this.state.story?.lcAddress === address) this.state = { ...this.state, story: { larpcheck: c.lc, coin: this.state.story.coin } };
            this.renderHead();
            return;
          }
          this.lcRun = { address, step: c.step };
          this.renderHead();
          await new Promise((r) => setTimeout(r, 5e3));
        }
        throw new Error("Larpcheck is still working on this. Look again in a few minutes.");
      } catch (e) {
        this.lcRun = { address, error: e.message };
        this.renderHead();
      }
    }
    async runLcAsk(id, question) {
      this.lcAnswer = { id, busy: true };
      this.renderHead();
      try {
        const { answer } = await send("lcAsk", { id, question });
        this.lcAnswer = { id, answer };
      } catch (e) {
        this.lcAnswer = { id, error: e.message };
      }
      this.renderHead();
    }
    async loadStory(post, narrative, res, id) {
      if (this.state.source?.kind === "Search" || !post?.text && !post?.images?.length) return;
      const t = res.mentioned[0] || res.picks[0]?.token || null;
      if (!t) return;
      const coin = t ? { name: t.name, symbol: t.symbol, address: t.address, createdAt: t.createdAt, socials: t.socials, websites: t.websites, fromPost: !!t.fromPost, mentioned: res.mentioned.includes(t) } : null;
      this.state = { ...this.state, story: { loading: true } };
      this.renderHead();
      const lc = t ? await this.larpFor(t) : null;
      if (id !== this.scanId) return;
      if (lc?.checked) {
        this.state = { ...this.state, story: { larpcheck: lc, coin: t.symbol } };
        this.renderHead();
        return;
      }
      try {
        const s = await send("story", { post, narrative, coin });
        if (id !== this.scanId) return;
        this.state = { ...this.state, story: { ...s, coin: t?.symbol || null, lcPage: lc?.page || null, lcAddress: t?.address || null } };
      } catch (e) {
        if (id !== this.scanId) return;
        this.state = { ...this.state, story: { error: e.message } };
      }
      this.renderHead();
    }
    narrativeHtml() {
      const { loading, narrative, engineError } = this.state;
      if (!loading && engineError) return `<div class="narrative"><span>Coin from the post only</span><em>${esc2(engineError)}</em></div>`;
      if (narrative) return `<div class="narrative"><span>${esc2(narrative)}</span>${loading ? "<em>finding coins\u2026</em>" : ""}</div>${this.storyHtml()}${this.whoHtml()}`;
      if (!loading || !this.lastPost) return "";
      const doing = this.watching ? "Watching the video\u2026" : this.lastPost.hasVideo ? "Listening to the video\u2026" : this.lastPost.images?.length ? "Looking at the image\u2026" : "Reading the post\u2026";
      return `<div class="narrative thinking"><span>${doing}</span></div>`;
    }
    // The way to launch a coin from the post being read, while the server has launching on.
    launchHtml() {
      return this.launchOn && isPostLink(this.lastPost?.url) ? '<button type="button" class="launch-btn" data-launch>Launch a coin from this post</button>' : "";
    }
    renderBody() {
      if (this.view === "settings") {
        this.bodyEl.innerHTML = this.settingsHtml();
        return;
      }
      const { loading, error, picks, others, mentioned, techMatch, ts } = this.state;
      if (loading) {
        this.bodyEl.innerHTML = [0, 1, 2].map(() => `
        <div class="loading-card"><div class="skel" style="width:30%"></div><div class="skel" style="width:55%"></div><div class="skel" style="height:34px"></div></div>`).join("");
        return;
      }
      if (error) {
        this.bodyEl.innerHTML = `<div class="empty"><div class="big">Couldn't finish the scan</div><p class="error">${esc2(error)}</p><button class="retry" data-retry>Try again</button></div>`;
        return;
      }
      if (!ts) {
        const trends = (this.trends || []).slice(0, 6);
        const recent = this.inline ? this.recent || [] : [];
        this.bodyEl.innerHTML = `<div class="empty"><div class="big">Scan any post on X</div>
        <p>${esc2(this.hint || (this.inline ? "Search a narrative, a ticker or a CA above." : "Tap the radar under any post or trend."))}</p>
        ${recent.length ? `<div class="recent-list"><div class="recent-top"><span>Recent</span><button data-recent-clear>Clear</button></div>${recent.map((r, i) => `<button class="recent-row" data-recent="${i}"><b>$${esc2(r.c)}</b><span>${esc2(r.l)}</span><em>${age(r.t)}</em></button>`).join("")}</div>` : ""}
        ${this.inline ? this.boardHtml() : ""}
        ${trends.length ? `<div class="trend-list"><span>Trending</span>${trends.map((t) => `<button data-trend="${esc2(t)}">${esc2(t)}</button>`).join("")}</div>` : ""}</div>
        ${this.inline && (this.alerts?.watches.length || this.alerts?.feed.length) ? this.alertsHtml() : ""}`;
        return;
      }
      if (!picks.length && !mentioned.length && !techMatch && this.state.mode === "ai" && this.state.coinable === false) {
        this.bodyEl.innerHTML = `<div class="empty"><div class="big">No coin narrative here</div>
        <p>This post doesn't carry anything people trade. Try a news post, a trend, or a meme.</p>${this.launchHtml()}</div>`;
        return;
      }
      if (!picks.length && !mentioned.length && !techMatch) {
        this.bodyEl.innerHTML = `<div class="empty"><div class="big">No live coins for this narrative</div>
        <p>Nothing trading on-chain is about this yet.</p>${this.watchHtml({ cta: true })}${this.launchHtml()}</div>`;
        return;
      }
      let html = "";
      html += `<div class="reroute-bar"><span>Instant reroute</span><button type="button" data-reroute>Open best match</button></div>`;
      if (mentioned.length) html += `<div class="section-label"><span>In the post</span></div>` + mentioned.map((t) => this.cardHtml(t, { role: "ca" })).join("");
      const techIsAlreadyShown = techMatch && (mentioned.some((t) => t.address === techMatch.address) || picks.some((p) => p.token.address === techMatch.address));
      if (techMatch && !techIsAlreadyShown) {
        const t = this.tokens.get(techMatch.address) || techMatch;
        html += '<div class="section-label"><span>Tech match</span><span>' + esc2(techMatch.techAnchor || "") + "</span></div>" + this.cardHtml(t, { role: "tech" });
      }
      if (picks.length) {
        const SHORT = { top: "TOP MC", og: "OG", mover: "MOVER" };
        html += `<div class="section-label"><span>Narrative picks</span><span>${picks.length} of 3</span></div>
        <div class="overview">${picks.map((p) => {
          const t = this.tokens.get(p.token.address) || p.token;
          const ch = t.priceChange?.h1 ?? t.priceChange?.h24;
          return `<button class="tile ${p.role}" data-jump="${t.address}">
            <span class="tile-role">${ROLE[p.role].icon}${SHORT[p.role]}</span>
            <span class="tile-sym">$${esc2(t.symbol)}${t.mcapBacked ? "" : ' <i title="Market cap not backed by real liquidity">\xB7 thin</i>'}</span>
            <b data-tile-mc="${t.address}">${usd(t.marketCap)}</b>
            <span class="tile-chg ${ch == null ? "" : ch >= 0 ? "up" : "down"}" data-tile-chg="${t.address}">${pct2(ch)}</span>
            ${t.chain === "solana" ? `<span class="tile-b" data-tile-b="${t.address}">bundled \u2026</span>` : ""}</button>`;
        }).join("")}</div>` + picks.map((p) => this.cardHtml(this.tokens.get(p.token.address) || p.token, p)).join("");
      }
      if (others.length) {
        const shown = this.expanded.has("all-matches") ? others : others.slice(0, 5);
        html += `<div class="section-label"><span>More matches</span><span>${others.length}</span></div><div class="list">`;
        for (const o of shown) {
          const t = this.tokens.get(o.address) || o;
          if (this.expanded.has(t.address)) {
            html += `</div>${this.cardHtml(t, { role: "more" })}<div class="list">`;
            continue;
          }
          const ch = +t.priceChange.h1 || +t.priceChange.h24 || 0;
          html += `<button class="li" data-expand="${t.address}">${this.avatarHtml(t)}
          <div class="nm"><b>${esc2(t.name)}</b><span>$${esc2(t.symbol)} \xB7 ${age(t.createdAt)}</span></div>
          <div class="r" data-k="li-mc">${t.mcapBacked ? usd(t.marketCap) : '<span title="Market cap not backed by real liquidity">thin</span>'}<span class="${ch >= 0 ? "up" : "down"}">${pct2(ch)}</span></div></button>`;
        }
        html += "</div>";
        html = html.replace(/<div class="list"><\/div>/g, "");
        if (shown.length < others.length) html += `<button class="show-more" data-more-matches>Show ${others.length - shown.length} more</button>`;
      }
      html += this.launchHtml();
      this.bodyEl.innerHTML = html;
      this.hydrateImages();
      for (const t of this.cardTokens()) {
        this.renderAudit(t.address);
        this.renderLarp(t.address);
      }
    }
    avatarHtml(t) {
      const h = hue(t.address);
      return `<div class="ava" style="--h1:hsl(${h} 70% 45%);--h2:hsl(${(h + 50) % 360} 70% 30%)" data-img="${esc2(t.image || "")}">${esc2((t.symbol || "?").replace(/^\$/, "").slice(0, 2).toUpperCase())}</div>`;
    }
    hydrateImages() {
      this.bodyEl.querySelectorAll(".ava[data-img]").forEach((el) => {
        const url = el.dataset.img;
        if (!url) return;
        el.removeAttribute("data-img");
        send("image", { url }).then((src) => {
          el.innerHTML = `<img alt="" src="${src}">`;
        }).catch(() => {
        });
      });
    }
    changeCells(t) {
      return ["m5", "h1", "h6", "h24"].map((k) => {
        const v = t.priceChange?.[k];
        const cls = v == null ? "" : v >= 0 ? "up" : "down";
        const hot = k === "h1" && v >= 25 ? " hot" : "";
        return `<div class="chg ${cls}${hot}" data-k="chg-${k}"><span>${k.replace("m5", "5m").replace("h1", "1h").replace("h6", "6h").replace("h24", "24h")}</span><b>${pct2(v)}</b></div>`;
      }).join("");
    }
    // A card's actions: one Trade button (▾ for the other terminals) and Larpcheck's verdict as a yellow button.
    actionsHtml(t) {
      const terms = terminals(t);
      const pick = terms.find((x) => x.id === prefTerm()) || terms[0];
      const menu = pick && this.expanded.has(`tm:${t.address}`);
      const trade = pick ? `<div class="trade">
        <a class="term" href="${esc2(pick.url)}" target="_blank" rel="noopener noreferrer" data-term="${pick.name}" data-ca="${t.address}" title="Copy CA and open on ${pick.name}">
          <img alt="" src="${TERMINAL_ICONS[pick.id]}"><span>Trade on ${pick.name}</span></a>
        ${terms.length > 1 ? `<button class="term-more" data-term-menu="${t.address}" aria-expanded="${menu}" title="Other terminals">${I.chevron}</button>` : ""}
        ${menu ? `<div class="term-menu">${terms.filter((x) => x !== pick).map((x) => `
          <a href="${esc2(x.url)}" target="_blank" rel="noopener noreferrer" data-term="${x.name}" data-term-pick="${x.id}" data-ca="${t.address}">
            <img alt="" src="${TERMINAL_ICONS[x.id]}">${x.name}</a>`).join("")}</div>` : ""}
      </div>` : "";
      const fr = this.frontrun?.connected && t.chain === "solana";
      const frOpen = fr && this.expanded.has(`fr:${t.address}`);
      const buyBtn = fr ? `<button class="fr-buy${frOpen ? " on" : ""}" data-fr-buy="${t.address}" aria-expanded="${frOpen}" title="Buy with your Frontrun wallet">${I.bolt}Frontrun</button>` : "";
      const hood = isHood(t);
      const sol = hood ? instaEth() : instaSol();
      const unit = hood ? "ETH" : "SOL";
      const instaOpen = this.expanded.has(`ib:${t.address}`);
      const quick = quickBuyable(t) || hood ? `<div class="insta">
        <button type="button" class="radar-buy" data-insta="${t.address}" title="Buy ${sol} ${unit} with your own wallet, in a small window over this page">Insta buy \xB7 ${sol} ${unit}</button>
        <button type="button" class="insta-more" data-insta-menu="${t.address}" aria-expanded="${instaOpen}" title="Change the amount">${I.chevron}</button>
        ${instaOpen ? `<div class="insta-menu">${(hood ? INSTA_ETH : INSTA_SOL).map((v) => `<button type="button" data-insta-sol="${v}" data-unit="${unit}" data-addr="${t.address}"${v === sol ? ' class="on"' : ""}>${v}</button>`).join("")}
          <a href="${esc2(hood ? hoodBuyUrl(t.address) : quickBuyUrl(t))}" target="_blank" rel="noopener noreferrer">Full buy page: any amount, slippage \u2197</a></div>` : ""}
      </div>` : "";
      return `${quick}${buyBtn}${trade}<span class="lc-slot" data-lc="${t.address}">${lcButtonHtml(this.larp.get(t.address)?.lc)}</span>${frOpen ? this.frSheetHtml(t) : ""}`;
    }
    cardHtml(t, pick) {
      const role = pick.role;
      const r = ROLE[role];
      const buys = t.txns.h1.buys, sells = t.txns.h1.sells;
      const buyShare = buys + sells ? buys / (buys + sells) * 100 : 50;
      const tags = [pick.alsoOg && "also the OG", pick.alsoTop && "also top MC", pick.alsoMover && "also the mover"].filter(Boolean);
      if (this.state.techMatch?.address === t.address && role !== "tech") tags.push("TECH MATCH");
      const vsPost = launchedVsPost(t.createdAt, this.lastPost?.url);
      if (t.fromPost) tags.unshift(vsPost?.includes("after") ? `launched ${vsPost}` : "launched off this post");
      else if (vsPost) tags.push(vsPost);
      const twins = this.nameTwins(t);
      if (launchedWithRadar(t)) tags.unshift("launched with Radar, not by the poster");
      if (twins) tags.push(twins.oldest ? `oldest of ${twins.n}` : `${twins.n} named $${String(t.symbol).trim()}`);
      const matched = t.reason ? esc2(t.reason) : t.matched?.length ? `matches \u201C${esc2(t.matched.slice(0, 2).join("\u201D, \u201C"))}\u201D` : "";
      const open = this.openCards.has(t.address);
      const tx24 = t.txns.h24.buys + t.txns.h24.sells;
      return `
      <article class="card ${role}${open ? " open" : ""}${this.state.techMatch?.address === t.address ? " tech-match" : ""}" data-addr="${t.address}">
        <header class="card-top">
          <span class="badge">${r.icon}${r.label}</span>
          ${tags.map((x) => `<span class="tag${x.startsWith("launched") ? " hot" : x.startsWith("looks") ? " rug" : /^oldest of|named \$/.test(x) ? " twins" : ""}">${esc2(x)}</span>`).join("")}
          ${t.chain === "solana" ? `<span class="cc" data-cc="${t.address}"></span>` : ""}
          <button class="toggle-card" data-toggle="${t.address}" aria-expanded="${open}" title="${open ? "Show less" : "Show everything"}">${I.chevron}</button>
        </header>
        <div class="ident">
          ${this.avatarHtml(t)}
          <div class="names">
            <div class="name" title="${esc2(t.name)}">${esc2(t.name)}</div>
            <div class="sub">
              <span class="sym">$${esc2(t.symbol)}</span>
              <button class="ca-btn" data-copy="${t.address}" title="Copy contract address">${short(t.address)} ${I.copy}</button>
              <span class="chain">${esc2(CHAIN_LABEL[t.chain] || t.chain)}</span>
            </div>
          </div>
        </div>
        <div class="compact" data-toggle="${t.address}">
          <div><span>Market cap${t.mcapBacked ? "" : " \xB7 thin"}</span><b class="mc" data-k="mc">${usd(t.marketCap)}</b></div>
          <div><span>Age</span><b data-k="age" title="${t.createdAt ? new Date(t.createdAt).toLocaleString() : ""}">${age(t.createdAt)}</b></div>
          <div><span>Vol 24h</span><b data-k="vol">${usd(t.volume.h24)}</b></div>
        </div>
        ${t.chain === "solana" ? `<div class="hc" data-hc="${t.address}"><span class="hc-mark wait"></span><span>Checking holders\u2026</span></div>` : `<div class="hc" data-lch="${t.address}" hidden></div>`}
        <div class="actions" data-actions="${t.address}">${this.actionsHtml(t)}</div>
        <div class="card-body" aria-hidden="${!open}">
          <div class="card-inner">
            ${matched ? `<div class="reason">${t.reason ? I.spark : ""}<span>${matched}</span></div>` : ""}
            <div class="price-line"><span class="label">Price</span><span class="px" data-k="price">${price(t.priceUsd)}</span></div>
            <div class="changes">${this.changeCells(t)}</div>
            <div class="stats">
              <div class="stat"><span>${t.onCurve ? "Curve" : "Liquidity"}</span><b data-k="liq" class="${!t.onCurve && t.liquidity < 5e3 ? "bad" : ""}">${t.onCurve ? "Bonding" : usd(t.liquidity)}</b></div>
              <div class="stat"><span>Holders</span><b data-k="holders">${t.chain === "solana" ? '<span class="skel" style="display:block;width:70%;margin-top:4px"></span>' : "\u2014"}</b></div>
              <div class="stat"><span>Txns 24h</span><b data-k="tx24">${num(tx24)}</b></div>
            </div>
            <div class="flow">
              <div class="flow-bar"><i data-k="flow" style="width:${buyShare.toFixed(1)}%"></i></div>
              <div class="flow-legend"><span class="b" data-k="buys">${num(buys)} buys</span><span>1h \xB7 ${usd(t.volume.h1)}</span><span class="s" data-k="sells">${num(sells)} sells</span></div>
            </div>
            ${t.chain === "solana" ? `<div class="supply" data-k="supply">${this.supplyHtml(null)}</div>` : ""}
            ${t.chain === "solana" ? '<section class="coin-check" data-k="check"></section>' : ""}
            <section class="audit">
              <h4>Launch audit <em data-k="audit-src">${t.chain === "solana" ? "on-chain" : ""}</em></h4>
              <div class="rows" data-k="audit"></div>
            </section>
            <div class="links">${links(t).map(([l, u]) => `<a href="${esc2(u)}" target="_blank" rel="noopener noreferrer">${l}</a>`).join("")}${BUBBLE_CHAIN[t.chain] ? `<button data-bubble="${t.address}" data-chain="${t.chain}">Bubblemaps</button>` : ""}</div>
          </div>
        </div>
      </article>`;
    }
    // How much of the supply went to the launch block, and how much of it is still sitting there.
    supplyHtml(b) {
      if (!b) {
        return `<div class="supply-head"><span>Bundled supply</span><b class="skel" style="width:54px;height:18px"></b></div>
        <div class="supply-bar"></div><div class="supply-legend"><span class="scanning"><span class="spinner"></span>Scanning the launch block\u2026</span></div>`;
      }
      if (!b.ok) {
        return `<div class="supply-head"><span>Bundled supply</span><b class="na">n/a</b></div><div class="supply-legend"><span>${esc2(b.reason || "Unavailable")}</span></div>`;
      }
      const tone = b.bundledPct >= 50 || b.bundledPct >= 20 && b.bundleHeldPct >= 5 ? "bad" : b.bundledPct >= 5 ? "warn" : "good";
      const w = (x) => Math.max(0, Math.min(100, x)).toFixed(2);
      return `<div class="supply-head"><span>Bundled supply</span><b class="${tone}">${pctPlain(b.bundledPct)}</b></div>
      <div class="supply-bar" title="Share of total supply bought in the launch block">
        <i class="seg bundle" style="width:${w(b.bundledPct)}%"></i><i class="seg dev" style="width:${w(b.devBoughtPct)}%"></i>
        <i class="held" style="width:${w(b.bundleHeldPct + b.devHeldPct)}%"></i>
      </div>
      <div class="supply-legend">
        <span>${b.bundleWallets} wallet${b.bundleWallets === 1 ? "" : "s"} \xB7 sold ${pctPlain(soldPct(b.bundledPct, b.bundleHeldPct), 0)}</span>
        <span>DB ${pctPlain(b.devBoughtPct)} \xB7 DS ${pctPlain(soldPct(b.devBoughtPct, b.devHeldPct), 0)}</span>
      </div>`;
    }
    renderAudit(addr) {
      this.renderLcHolders(addr);
      const card = this.bodyEl.querySelector(`.card[data-addr="${addr}"]`);
      if (!card) return;
      const t = this.tokens.get(addr);
      const rowsEl = card.querySelector('[data-k="audit"]');
      if (t?.chain !== "solana") {
        rowsEl.innerHTML = `<div class="row note"><span class="dot"></span><span class="k">Bundle & holder checks</span><span class="v">Solana only for now</span></div>`;
        return;
      }
      const a = this.audits.get(addr) || {};
      const supplyEl = card.querySelector('[data-k="supply"]');
      if (supplyEl && (a.bundle || a.bundleErr)) supplyEl.innerHTML = this.supplyHtml(a.bundle || { ok: false, reason: a.bundleErr });
      const tileB = this.bodyEl.querySelector(`[data-tile-b="${addr}"]`);
      if (tileB && a.bundle?.ok) {
        tileB.textContent = `bundled ${pctPlain(a.bundle.bundledPct, 0)}`;
        tileB.className = `tile-b ${a.bundle.bundledPct >= 20 ? "bad" : a.bundle.bundledPct >= 5 ? "warn" : "good"}`;
      } else if (tileB && (a.bundleErr || a.bundle?.ok === false)) {
        tileB.textContent = "bundle n/a";
      }
      this.renderCoinCheck(card, t, a);
      this.renderHolderCheck(card, t, a);
      const row = (cls, k, v, sub = "") => `<div class="row ${cls}"><span class="dot"></span><span class="k">${k}</span><span class="v">${v}${sub ? `<small>${sub}</small>` : ""}</span></div>`;
      const level2 = (v, warn, bad) => v == null ? "" : v >= bad ? "bad" : v >= warn ? "warn" : "good";
      let html = "";
      const b = a.bundle;
      if (b?.ok) {
        if (b.wallets?.length) {
          html += `<button class="toggle" data-wallets="${addr}">${this.expanded.has(`w:${addr}`) ? "Hide" : "Show"} launch wallets \u2193</button>
          <div class="wallets ${this.expanded.has(`w:${addr}`) ? "show" : ""}">${b.wallets.map((w) => `
            <div class="wallet"><a href="https://gmgn.ai/sol/address/${w.owner}" target="_blank" rel="noopener noreferrer">${short(w.owner)}${w.isDev ? ' <span class="dev">dev</span>' : ""}</a>
            <span>${pctPlain(w.boughtPct, 2)} \u2192 ${pctPlain(w.heldPct, 2)}</span></div>`).join("")}
            <div class="wallet" style="color:var(--faint)"><span>Slot ${b.launchSlot.toLocaleString("en-US")}</span><span>${b.note || "first block"}</span></div></div>`;
        }
      }
      const r = a.rug;
      if (r?.detectedAt && !t.createdAt) {
        const ageEl = card.querySelector('[data-k="age"]');
        if (ageEl) ageEl.textContent = `~${age(Date.parse(r.detectedAt))}`;
      }
      if (r) {
        if (!coinCheck(t, a.rug, a.bundle)) {
          html += row(level2(r.top10Pct, 30, 50), "Top 10 holders", pctPlain(r.top10Pct), r.topHolder ? `largest ${pctPlain(r.topHolder.pct)}` : "");
          if (r.insiderWallets) html += row(level2(r.insiderPct ?? 0, 8, 20), "Insider wallets", `${r.insiderWallets}`, r.insiderPct != null ? `hold ${pctPlain(r.insiderPct)}` : "linked by transfers");
        }
        const auth = !r.mintAuthority && !r.freezeAuthority;
        html += row(auth ? "good" : "bad", "Mint / freeze", `${r.mintAuthority ? "Mintable" : "Renounced"} / ${r.freezeAuthority ? "Freezable" : "Renounced"}`);
        if (!t.onCurve) html += row(r.lpLockedPct >= 90 ? "good" : r.lpLockedPct >= 50 ? "warn" : "bad", "LP locked / burned", pctPlain(r.lpLockedPct, 0));
        const danger = r.risks.filter((x) => x.level === "danger");
        html += row(r.rugged ? "bad" : level2(r.score, 20, 50), "RugCheck", r.rugged ? "RUGGED" : `${r.score ?? "\u2014"}/100 risk`, danger[0]?.name || (r.risks[0]?.name ?? "no flags"));
        const h = card.querySelector('[data-k="holders"]');
        if (h) h.textContent = num(r.holders);
      } else if (a.rugErr) {
        html += `<div class="row note"><span class="dot"></span><span class="k">Holder data</span><span class="v">${esc2(a.rugErr)}</span></div>`;
        const h = card.querySelector('[data-k="holders"]');
        if (h) h.textContent = "\u2014";
      } else {
        html += '<div class="skel" style="margin:8px 0;width:80%"></div><div class="skel" style="margin:8px 0;width:60%"></div>';
      }
      rowsEl.innerHTML = html;
    }
    // ---------- Frontrun: buy with the user's own Frontrun wallet (extension only) ----------
    // The background holds the key; the panel only learns whether it is connected and which wallets exist.
    loadFrontrun() {
      return send("frontrun:status").then((s) => {
        this.frontrun = s || { connected: false };
      }).catch(() => {
        this.frontrun = { connected: false, unsupported: true };
      }).then(() => {
        if (this.view === "settings") this.renderBody();
        else for (const t of this.cardTokens()) this.renderActions(t.address);
      });
    }
    frSelFor(addr) {
      if (!this.frSel.has(addr)) this.frSel.set(addr, { sol: "0.1", bps: 1e3, wallet: this.frontrun?.wallets?.[0]?.address || "" });
      return this.frSel.get(addr);
    }
    updateFrGo(addr) {
      const b = this.bodyEl.querySelector(`[data-fr-go="${addr}"]`);
      const t = this.tokens.get(addr);
      if (b && t && !this.frBusy.has(addr)) b.textContent = `Buy $${String(t.symbol).trim()} \xB7 ${this.frSelFor(addr).sol || "0"} SOL`;
    }
    frSheetHtml(t) {
      const s = this.frSelFor(t.address);
      const wallets = this.frontrun?.wallets || [];
      const a = this.audits.get(t.address) || {};
      const why = a.rug || a.rugErr ? marketBlock(t) || reportBlock(a.rug) : null;
      const busy = this.frBusy.has(t.address);
      const sym = esc2(String(t.symbol).trim());
      const wl = (w) => `${esc2(w.name || "Frontrun wallet")} \xB7 ${short(w.address)} \xB7 ~${w.sol.toFixed(3)} SOL`;
      return `<div class="fr-sheet">
      <div class="fr-presets">${["0.1", "0.25", "0.5", "1"].map((v) => `<button data-fr-sol="${t.address}" data-v="${v}" class="${String(s.sol) === v ? "on" : ""}">${v} SOL</button>`).join("")}</div>
      <div class="fr-fields">
        <label><span>Amount</span><input data-fr-amt="${t.address}" value="${esc2(s.sol)}" inputmode="decimal" autocomplete="off"><em>SOL</em></label>
        <label><span>Slippage</span><select data-fr-slip="${t.address}">${[500, 1e3, 1500, 2500].map((b) => `<option value="${b}"${b === s.bps ? " selected" : ""}>${b / 100}%</option>`).join("")}</select></label>
      </div>
      ${wallets.length > 1 ? `<label class="fr-wsel"><span>Wallet</span><select data-fr-wallet="${t.address}">${wallets.map((w) => `<option value="${w.address}"${w.address === s.wallet ? " selected" : ""}>${wl(w)}</option>`).join("")}</select></label>` : `<div class="fr-wone">${wallets.length ? wl(wallets[0]) : "No Frontrun wallet yet. Create one on frontrun.pro."}</div>`}
      ${why ? `<div class="fr-warn"><span>\u2715</span>${esc2(why.charAt(0).toUpperCase() + why.slice(1))}</div>` : ""}
      <button class="fr-go" data-fr-go="${t.address}"${busy || !wallets.length ? " disabled" : ""}>${busy ? "Buying\u2026" : `Buy $${sym} \xB7 ${esc2(s.sol)} SOL`}</button>
      ${this.frMsg.has(t.address) ? `<div class="fr-msg">${this.frMsg.get(t.address)}</div>` : ""}
      <div class="fr-fine">Bought with your Frontrun wallet. Frontrun's fees apply. Not financial advice.</div>
    </div>`;
    }
    async frBuy(addr) {
      const t = this.tokens.get(addr);
      if (!t || this.frBusy.has(addr)) return;
      const s = this.frSelFor(addr);
      this.frBusy.add(addr);
      this.frMsg.delete(addr);
      this.renderActions(addr);
      try {
        const r = await send("frontrun:buy", { mint: addr, sol: s.sol, slippageBps: s.bps, wallet: s.wallet || void 0 });
        this.frMsg.set(addr, r.signature ? `${r.confirmed ? "Bought" : "Sent"} \xB7 <a href="https://solscan.io/tx/${r.signature}" target="_blank" rel="noopener noreferrer">View on Solscan \u2197</a>` : "Sent to Frontrun. Check your Frontrun wallet.");
        this.toast(`${r.confirmed ? "Bought" : "Sent"} $${String(t.symbol).trim()} with Frontrun`, 2400);
        this.loadFrontrun();
      } catch (err) {
        this.frMsg.set(addr, esc2(err.message));
      } finally {
        this.frBusy.delete(addr);
        this.renderActions(addr);
      }
    }
    /* ----- alerts (extension only) ----- */
    // The background answers alerts:list only in the extension; on the web and in the userscript it's an unknown request,
    // and every alert control stays hidden.
    loadAlerts() {
      return send("alerts:list").then((a) => {
        this.alerts = a;
        if (this.inline && a.unread) send("alerts:read").then((b) => {
          this.alerts = b;
        }).catch(() => {
        });
        this.renderHead();
        if (this.view === "settings" || !this.state.ts) this.renderBody();
      }).catch(() => {
        this.alerts = null;
      });
    }
    watchedPost() {
      const id = String(this.lastPost?.url || "").match(/\/status\/(\d{5,25})/)?.[1];
      if (!id || !this.alerts || this.state.source?.kind === "Search") return null;
      return { id, watch: this.alerts.watches.find((w) => w.id === id) || null };
    }
    watchHtml({ cta = false } = {}) {
      const w = this.watchedPost();
      if (!w) return "";
      if (w.watch) {
        const h = Math.max(1, Math.round((w.watch.until - Date.now()) / 36e5));
        return `<div class="watch on${cta ? " cta" : ""}">${I.bell}<span>Watching this post \xB7 ${h}h left</span><button type="button" data-act="unwatch" data-id="${esc2(w.id)}">Stop</button></div>`;
      }
      if (this.holder && !this.holder.holder) {
        return `<div class="watch on${cta ? " cta" : ""}">${I.bell}<span>Launch alerts are for $RADAR holders</span>${this.holder.on ? '<button type="button" data-holder-connect>Check my wallet</button>' : ""}</div>`;
      }
      return `<button type="button" class="watch${cta ? " cta" : ""}" data-act="watch"${this.watchBusy ? " disabled" : ""}>${I.bell}<span>${this.watchBusy ? "Setting up the alert\u2026" : "Alert me when a coin launches off this post"}</span></button>`;
    }
    async watch() {
      if (this.watchBusy || !this.lastPost) return;
      this.watchBusy = true;
      this.renderHead();
      if (!this.state.picks?.length) this.renderBody();
      try {
        this.alerts = await send("alerts:watch", { post: this.lastPost });
        this.toast(`Watching for 24h. Radar pings you when a coin launches off it${this.alerts.notifications ? "" : ". Turn on desktop alerts in the toolbar popup"}`, 3600);
      } catch (err) {
        this.toast(err.message, 3600);
      }
      this.watchBusy = false;
      this.renderHead();
      if (!this.state.picks?.length || this.view === "settings") this.renderBody();
    }
    async unwatch(id) {
      try {
        this.alerts = await send("alerts:stop", { id });
      } catch (err) {
        this.toast(err.message, 3e3);
      }
      this.renderHead();
      if (!this.state.picks?.length || this.view === "settings") this.renderBody();
    }
    // Desktop notifications need the optional permission, which only the toolbar popup can ask for (inside the click).
    async allowNotifications() {
      const api = globalThis.browser ?? globalThis.chrome;
      let granted = false;
      try {
        granted = await api.permissions.request({ permissions: ["notifications"] });
      } catch {
      }
      this.toast(granted ? "Desktop alerts on" : "Desktop alerts stay off. Alerts still show on X and on the toolbar icon", 3e3);
      await this.loadAlerts();
    }
    alertsHtml() {
      const a = this.alerts;
      if (!a) return "";
      const left = (w) => `${Math.max(1, Math.round((w.until - Date.now()) / 36e5))}h left`;
      const watches = a.watches.map((w) => `<div class="al-w"><div><b>${w.author ? `@${esc2(w.author)}` : "Post"}</b><span>${esc2(w.label)}</span></div>
      <em>${left(w)}</em><button type="button" data-act="unwatch" data-id="${esc2(w.id)}">Stop</button></div>`).join("");
      const hits = a.feed.slice(0, 5).map((f) => {
        const c = f.coin;
        const larp = f.larp ? `${f.larp.by === "Larpcheck" ? "Larpcheck" : "Larp check"} ${esc2(f.larp.word)}${f.larp.score != null ? ` ${esc2(f.larp.score)}` : ""}` : "";
        const link = f.buy || f.chart;
        return `<a class="al-hit" href="${esc2(link)}" target="_blank" rel="noopener noreferrer"><b>$${esc2(String(c.symbol || "").trim())}</b>
        <span>${esc2([CHAIN_LABEL[c.chain] || c.chain, usd(c.marketCap), age(f.at)].filter(Boolean).join(" \xB7 "))}</span>${larp ? `<em>${larp}</em>` : ""}</a>`;
      }).join("");
      return `<section class="settings">
      <div class="set-head"><h3>Alerts</h3>${a.watches.length ? `<span class="verdict ok">${a.watches.length} WATCHING</span>` : ""}</div>
      <p>Tap the bell under a post in the Radar panel. For the next 24 hours Radar checks every minute for a coin launched off it, runs the larp check, and pings you with a buy button.</p>
      ${watches ? `<div class="al-list">${watches}</div>` : ""}
      ${hits ? `<div class="section-label"><span>Latest alerts</span></div><div class="al-list">${hits}</div>` : ""}
      ${a.notifications ? '<p class="fine">Desktop alerts are on.</p>' : '<button class="fr-btn" data-alerts-notify>Turn on desktop alerts</button><p class="fine">Without them, alerts show on any open X tab and as a number on the Radar icon.</p>'}
    </section>`;
    }
    settingsHtml() {
      const f = this.frontrun || {};
      const wallets = (f.wallets || []).map((w) => `<div class="fr-w"><b>${esc2(w.name || "Wallet")}</b><span>${short(w.address)}</span><em>~${w.sol.toFixed(3)} SOL</em></div>`).join("");
      return `${this.alertsHtml()}<section class="settings">
      <div class="set-head"><h3>Frontrun</h3>${f.connected ? '<span class="verdict ok">CONNECTED</span>' : ""}</div>
      <p>Buy the coins Radar finds with your Frontrun wallet. Frontrun holds the wallet and signs. Radar sends an order only after you press Buy on a coin card.</p>
      ${f.connected ? `<div class="fr-wallets">${wallets || '<div class="fr-w"><span>No Frontrun wallets yet. Create one on frontrun.pro.</span></div>'}</div>
        <button class="fr-btn ghost" data-fr-disconnect>Disconnect</button>` : `<div class="fr-connect"><input type="password" data-fr-key placeholder="fr_sk_\u2026" autocomplete="off" spellcheck="false"><button class="fr-btn" data-fr-connect>Connect</button></div>
        <a class="fr-link" href="https://frontrun.pro/api" target="_blank" rel="noopener noreferrer">Make an API key on frontrun.pro \u2197</a>`}
      ${f.error ? `<p class="fr-err">${esc2(f.error)}</p>` : ""}
      <p class="fine">Your key stays on this device and only goes to solana.frontrun.pro. Frontrun's Trading API is in beta, so keep only what you'd trade in that wallet. Not financial advice.</p>
      <button class="fr-btn ghost" data-act-back>Back to Radar</button>
    </section>`;
    }
    async frConnect() {
      const input = this.bodyEl.querySelector("[data-fr-key]");
      const key = input?.value.trim() || "";
      if (!/^fr_sk_[A-Za-z0-9]{64}$/.test(key)) {
        this.toast("A Frontrun key starts with fr_sk_ and has 70 characters", 3e3);
        return;
      }
      const api = globalThis.browser ?? globalThis.chrome;
      let granted = false;
      try {
        granted = await api.permissions.request({ origins: ["https://solana.frontrun.pro/*"] });
      } catch {
      }
      if (!granted) {
        this.toast("Radar needs permission to reach Frontrun", 3e3);
        return;
      }
      input.value = "";
      try {
        this.frontrun = await send("frontrun:connect", { key });
        this.toast("Frontrun connected", 2e3);
      } catch (err) {
        this.frontrun = { connected: false, error: err.message };
      }
      this.renderBody();
    }
    async frDisconnect() {
      try {
        this.frontrun = await send("frontrun:disconnect");
      } catch (err) {
        this.toast(err.message, 3e3);
      }
      this.frSel.clear();
      this.renderBody();
    }
    // Holder check (ui/holdercheck.js): real holders and no rug flags, the same test Instant Reroute uses.
    renderHolderCheck(card, t, a) {
      const el = card.querySelector(`[data-hc="${t.address}"]`);
      if (!el) return;
      if (!a.rug && !a.rugErr) return;
      const why = marketBlock(t) || reportBlock(a.rug);
      el.className = `hc ${why ? "no" : "ok"}`;
      el.innerHTML = why ? `<span class="hc-mark">\u2715</span><span>${esc2(why.charAt(0).toUpperCase() + why.slice(1))}</span><em>Reroute skips it</em>` : `<span class="hc-mark">\u2713</span><span>Real holders \xB7 ${num(a.rug.holders)}</span><em>Passes the check</em>`;
    }
    // Coins on the post that share this one's ticker: copycats are the usual trap on a hot narrative.
    nameTwins(t) {
      const key = (x) => String(x.symbol || "").trim().replace(/^\$/, "").toLowerCase();
      const k = key(t);
      if (!k) return null;
      const group = [...this.tokens.values()].filter((x) => key(x) === k);
      if (group.length < 3) return null;
      const oldest = group.filter((x) => x.createdAt).sort((a, b) => a.createdAt - b.createdAt)[0];
      return { n: group.length, oldest: oldest?.address === t.address };
    }
    // A clean summary of what Radar found, copied for posting. No contract addresses.
    shareText() {
      const s = this.state;
      const who = this.lastPost?.author ? `@${this.lastPost.author}'s post` : "this post";
      const lines = [`Radar on ${who}`];
      if (s.narrative) lines.push(`Story: ${s.narrative}`);
      const ROLE_NAME = { top: "Top", og: "OG", mover: "Mover" };
      for (const p of s.picks || []) {
        const t = this.tokens.get(p.token.address) || p.token;
        const a = this.audits.get(t.address) || {};
        const c = coinCheck(t, a.rug, a.bundle);
        lines.push(`${ROLE_NAME[p.role] || "Pick"}: $${String(t.symbol).trim()} ${usd(t.marketCap)}${c ? ` \xB7 coin check ${c.word} ${c.score}` : ""}`);
      }
      const st = s.story;
      if (st?.larpcheck?.checked) lines.push(`Larpcheck: ${st.larpcheck.verdict}${st.larpcheck.score != null ? ` ${st.larpcheck.score}` : ""} ${st.larpcheck.url || ""}`.trim());
      else if (st?.word) lines.push(`Larp check: ${st.word} ${st.score}`);
      lines.push("Found with Radar \xB7 tryradar.fun");
      return lines.join("\n");
    }
    async share() {
      try {
        await this.copyText(this.shareText());
        this.toast("Summary copied \xB7 paste it anywhere", 2200);
      } catch {
        this.toast("Could not copy the summary");
      }
    }
    // Coin check: who could move the price, as one word + score and the facts behind it.
    renderCoinCheck(card, t, a) {
      const c = coinCheck(t, a.rug, a.bundle);
      const chip = card.querySelector(`[data-cc="${t.address}"]`);
      const box = card.querySelector('[data-k="check"]');
      if (!c) {
        if (chip) chip.innerHTML = "";
        if (box) box.innerHTML = "";
        return;
      }
      const tone = c.word === "OK" ? "ok" : c.word === "NEUTRAL" ? "mid" : "risk";
      if (chip) chip.innerHTML = `<span class="verdict ${tone}" title="Coin check: ${esc2(c.call)}">${c.word} <b>${c.score}</b></span>`;
      if (!box) return;
      const lvl = { ok: "good", watch: "warn", risk: "bad" };
      const val = (f) => f.text ? esc2(f.text) : f.unit === "price" ? pctPlain(f.v, 0) : pctPlain(f.v);
      box.innerHTML = `<h4>Coin check <span class="verdict ${tone}">${c.word} <b>${c.score}</b></span></h4>
      ${c.call ? `<p class="cc-call">${esc2(c.call)}</p>` : ""}
      <div class="rows">${c.facts.map((f) => `<div class="row ${lvl[f.lvl] || ""}"><span class="dot"></span><span class="k">${esc2(f.k)}</span><span class="v">${val(f)}${f.sub ? `<small>${esc2(f.sub)}</small>` : ""}</span></div>`).join("")}</div>`;
    }
    patchCard(prev, t) {
      const card = this.bodyEl.querySelector(`.card[data-addr="${t.address}"]`);
      const set = (k, html, dir2 = 0) => {
        const el = card?.querySelector(`[data-k="${k}"]`);
        if (!el || el.innerHTML === html) return;
        el.innerHTML = html;
        if (dir2) {
          el.classList.remove("flash-up", "flash-down");
          void el.offsetWidth;
          el.classList.add(dir2 > 0 ? "flash-up" : "flash-down");
        }
      };
      const dir = Math.sign(t.marketCap - prev.marketCap);
      if (card) {
        if (t.chain === "solana") this.renderHolderCheck(card, t, this.audits.get(t.address) || {});
        set("mc", usd(t.marketCap), dir);
        set("price", price(t.priceUsd), Math.sign(t.priceUsd - prev.priceUsd));
        if (!t.onCurve) set("liq", usd(t.liquidity));
        set("vol", usd(t.volume.h24));
        set("tx24", num(t.txns.h24.buys + t.txns.h24.sells));
        set("buys", `${num(t.txns.h1.buys)} buys`);
        set("sells", `${num(t.txns.h1.sells)} sells`);
        const tot = t.txns.h1.buys + t.txns.h1.sells;
        const flow = card.querySelector('[data-k="flow"]');
        if (flow) flow.style.width = `${tot ? t.txns.h1.buys / tot * 100 : 50}%`;
        for (const k of ["m5", "h1", "h6", "h24"]) {
          const el = card.querySelector(`[data-k="chg-${k}"]`);
          if (!el) continue;
          const v = t.priceChange?.[k];
          el.className = `chg ${v == null ? "" : v >= 0 ? "up" : "down"}${k === "h1" && v >= 25 ? " hot" : ""}`;
          el.querySelector("b").textContent = pct2(v);
        }
      }
      const tileMc = this.bodyEl.querySelector(`[data-tile-mc="${t.address}"]`);
      if (tileMc) tileMc.textContent = usd(t.marketCap);
      const tileChg = this.bodyEl.querySelector(`[data-tile-chg="${t.address}"]`);
      if (tileChg) {
        const ch = t.priceChange?.h1 ?? t.priceChange?.h24;
        tileChg.className = `tile-chg ${ch == null ? "" : ch >= 0 ? "up" : "down"}`;
        tileChg.textContent = pct2(ch);
      }
      const li = this.bodyEl.querySelector(`.li[data-expand="${t.address}"] [data-k="li-mc"]`);
      if (li && t.mcapBacked) {
        const ch = +t.priceChange.h1 || +t.priceChange.h24 || 0;
        li.innerHTML = `${usd(t.marketCap)}<span class="${ch >= 0 ? "up" : "down"}">${pct2(ch)}</span>`;
      }
    }
    renderFoot() {
      const ts = this.state.ts;
      this.footEl.innerHTML = `<span>DexScreener \xB7 RugCheck \xB7 Solana RPC</span><span data-ago>${ts ? "updated just now" : "not scanned"}</span>`;
      clearInterval(this.agoTimer);
      if (ts) this.agoTimer = setInterval(() => {
        const s = Math.round((Date.now() - this.state.ts) / 1e3);
        const el = this.footEl.querySelector("[data-ago]");
        if (el) el.textContent = s < 3 ? "updated just now" : `updated ${s}s ago`;
      }, 1e3);
    }
    async copyText(text) {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
    }
    toast(msg, ms = 1400) {
      this.toastEl.textContent = msg;
      this.toastEl.classList.add("show");
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => this.toastEl.classList.remove("show"), ms);
    }
    async onBodyClick(e) {
      if (e.target.closest("[data-act-back]")) {
        this.view = "scan";
        this.renderBody();
        return;
      }
      if (e.target.closest('[data-act="watch"]')) {
        await this.watch();
        return;
      }
      const stop = e.target.closest('[data-act="unwatch"]');
      if (stop) {
        await this.unwatch(stop.dataset.id);
        return;
      }
      if (e.target.closest("[data-alerts-notify]")) {
        await this.allowNotifications();
        return;
      }
      if (e.target.closest("[data-fr-connect]")) {
        await this.frConnect();
        return;
      }
      if (e.target.closest("[data-fr-disconnect]")) {
        await this.frDisconnect();
        return;
      }
      const frb = e.target.closest("[data-fr-buy]");
      if (frb) {
        const k = `fr:${frb.dataset.frBuy}`;
        this.expanded.has(k) ? this.expanded.delete(k) : this.expanded.add(k);
        this.renderActions(frb.dataset.frBuy);
        return;
      }
      const frs = e.target.closest("[data-fr-sol]");
      if (frs) {
        this.frSelFor(frs.dataset.frSol).sol = frs.dataset.v;
        this.renderActions(frs.dataset.frSol);
        return;
      }
      const frg = e.target.closest("[data-fr-go]");
      if (frg) {
        await this.frBuy(frg.dataset.frGo);
        return;
      }
      const ib = e.target.closest("[data-insta]");
      if (ib) {
        this.instaBuy(ib.dataset.insta);
        return;
      }
      if (e.target.closest("[data-holder-connect]")) {
        this.holderConnect();
        return;
      }
      const ibm = e.target.closest("[data-insta-menu]");
      if (ibm) {
        const k = `ib:${ibm.dataset.instaMenu}`;
        this.expanded.has(k) ? this.expanded.delete(k) : this.expanded.add(k);
        this.renderActions(ibm.dataset.instaMenu);
        return;
      }
      const ibs = e.target.closest("[data-insta-sol]");
      if (ibs) {
        (ibs.dataset.unit === "ETH" ? setInstaEth : setInstaSol)(ibs.dataset.instaSol);
        this.expanded.delete(`ib:${ibs.dataset.addr}`);
        for (const t of this.cardTokens()) this.renderActions(t.address);
        return;
      }
      const reroute = e.target.closest("[data-reroute]");
      if (reroute) {
        await this.rerouteFromPanel(reroute);
        return;
      }
      const copy = e.target.closest("[data-copy]");
      if (copy) {
        e.preventDefault();
        const ca = copy.dataset.copy;
        await this.copyText(ca);
        copy.classList.add("copied");
        copy.innerHTML = `Copied ${I.check}`;
        this.toast("Contract address copied");
        setTimeout(() => {
          copy.classList.remove("copied");
          copy.innerHTML = `${short(ca)} ${I.copy}`;
        }, 1400);
        return;
      }
      const trend = e.target.closest("[data-trend]");
      if (trend) {
        this.scan({ post: { text: `Trending on X: ${trend.dataset.trend}` }, source: { kind: "Trend", label: trend.dataset.trend } });
        return;
      }
      const tab = e.target.closest("[data-board]");
      if (tab) {
        this.board = [];
        this.loadBoard(tab.dataset.board);
        this.renderBody();
        return;
      }
      const listed = e.target.closest("[data-board-coin]");
      if (listed) {
        this.scan({ post: { text: listed.dataset.boardCoin }, source: { kind: "Larpcheck", label: listed.dataset.boardTitle || listed.dataset.boardCoin } });
        return;
      }
      const again = this.recent?.[e.target.closest("[data-recent]")?.dataset.recent];
      if (again) {
        this.scan({ post: { text: again.q }, source: isPostLink(again.q) ? null : { kind: again.k, label: again.l } });
        return;
      }
      if (e.target.closest("[data-launch]")) {
        const w2 = 480;
        const left = Math.max(0, (window.screenX || 0) + (window.outerWidth || w2) - w2 - 32);
        if (!window.open(launchUrl(this.lastPost.url), "radar-launch", `popup=yes,width=${w2},height=820,left=${left},top=${Math.max(0, (window.screenY || 0) + 48)}`)) window.open(launchUrl(this.lastPost.url), "_blank", "noopener");
        return;
      }
      if (e.target.closest("[data-recent-clear]")) {
        this.recent = [];
        this.renderBody();
        send("recentClear").catch(() => {
        });
        return;
      }
      if (e.target.closest("[data-retry]")) {
        this.rescan();
        return;
      }
      const term = e.target.closest("[data-term]");
      if (term) {
        this.copyText(term.dataset.ca).then(() => this.toast(`CA copied \xB7 opening ${term.dataset.term}`));
        if (term.dataset.termPick) {
          setPrefTerm(term.dataset.termPick);
          this.expanded.delete(`tm:${term.dataset.ca}`);
          for (const t of this.cardTokens()) this.renderActions(t.address);
        }
        return;
      }
      const tm = e.target.closest("[data-term-menu]");
      if (tm) {
        const key = `tm:${tm.dataset.termMenu}`;
        this.expanded.has(key) ? this.expanded.delete(key) : this.expanded.add(key);
        this.renderActions(tm.dataset.termMenu);
        return;
      }
      if (e.target.closest("[data-more-matches]")) {
        this.expanded.add("all-matches");
        this.renderBody();
        return;
      }
      const tog = e.target.closest("[data-toggle]");
      if (tog && !e.target.closest("[data-copy]")) {
        const addr = tog.dataset.toggle;
        const card = this.bodyEl.querySelector(`.card[data-addr="${addr}"]`);
        const open = !this.openCards.has(addr);
        open ? this.openCards.add(addr) : this.openCards.delete(addr);
        card?.classList.toggle("open", open);
        card?.querySelector(".card-body")?.setAttribute("aria-hidden", String(!open));
        const btn = card?.querySelector(".toggle-card");
        if (btn) {
          btn.setAttribute("aria-expanded", String(open));
          btn.title = open ? "Show less" : "Show everything";
        }
        return;
      }
      const bub = e.target.closest("[data-bubble]");
      if (bub) {
        const chain = BUBBLE_CHAIN[bub.dataset.chain] || "solana";
        send("openWindow", { url: `https://v2.bubblemaps.io/map?address=${bub.dataset.bubble}&chain=${chain}` }).catch((err) => this.toast(err.message));
        return;
      }
      const jump = e.target.closest("[data-jump]");
      if (jump) {
        const card = this.bodyEl.querySelector(`.card[data-addr="${jump.dataset.jump}"]`);
        if (card && !card.classList.contains("open")) card.querySelector(".toggle-card")?.click();
        card?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      const exp = e.target.closest("[data-expand]");
      if (exp) {
        this.expanded.add(exp.dataset.expand);
        this.renderBody();
        const t = this.tokens.get(exp.dataset.expand);
        if (t) {
          this.loadAudit(t);
          this.loadLarp(t);
        }
        this.bodyEl.querySelector(`.card[data-addr="${exp.dataset.expand}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        return;
      }
      const w = e.target.closest("[data-wallets]");
      if (w) {
        const key = `w:${w.dataset.wallets}`;
        this.expanded.has(key) ? this.expanded.delete(key) : this.expanded.add(key);
        this.renderAudit(w.dataset.wallets);
      }
    }
    // Instant reroute through the one shared check (lib/reroute.js, run by the backend).
    // The post button calls this without candidates; the panel passes the coins it already shows.
    // The post goes through preparePost so the button and the panel share one cached search.
    // Insta Buy: tryradar.fun/trade as a small window at the right of this one, amount picked. The user's own wallet
    // still approves the buy there; the window reports back (see listenForBuys) and closes when Solana confirms it.
    instaBuy(addr) {
      const t = this.tokens.get(addr);
      const hood = isHood(t);
      const w = 440;
      const h = 780;
      const left = Math.max(0, (window.screenX || 0) + (window.outerWidth || w) - w - 32);
      const top = Math.max(0, (window.screenY || 0) + 72);
      const win = window.open(hood ? hoodBuyUrl(addr, instaEth()) : instaUrl(addr, instaSol()), "radar-insta", `popup=yes,width=${w},height=${h},left=${left},top=${top}`);
      if (!win) {
        window.open(hood ? hoodBuyUrl(addr) : quickBuyUrl({ address: addr }), "_blank", "noopener");
        this.toast("Pop-ups are blocked here, so the buy page opened in a tab", 3200);
        return;
      }
      win.focus?.();
      this.toast(hood ? "Radar checks the real cost first, then your wallet asks you to approve" : `Approve the ${instaSol()} SOL buy${t?.symbol ? ` of $${String(t.symbol).trim()}` : ""} in your wallet`, 3200);
    }
    listenForBuys() {
      window.addEventListener("message", (e) => {
        if (e.origin === "https://tryradar.fun" && e.data?.type === "radar:holder") {
          send("holderSave", { token: e.data.token, exp: e.data.exp }).then((h) => {
            this.holder = h;
            this.renderHead();
            this.renderBody();
            this.toast("Holder check passed", 2400);
          }).catch(() => {
          });
          return;
        }
        if (e.origin !== "https://tryradar.fun" || e.data?.type !== "radar:bought") return;
        const symbol = String(e.data.symbol || "").replace(/[^\w$./-]/g, "").slice(0, 20);
        this.toast(`Bought ${symbol ? `$${symbol}` : "it"} \xB7 confirmed on ${/^0x/.test(e.data.mint || "") ? "Robinhood Chain" : "Solana"}`, 4200);
      });
    }
    async route(post, candidates = null) {
      const p = await this.preparePost(post);
      return send("reroute", { post: p, candidates });
    }
    async rerouteFromPanel(button) {
      const fresh = (t) => this.tokens.get(t.address) || t;
      const candidates = [
        ...this.state.techMatch ? [this.state.techMatch] : [],
        ...this.state.picks.map((p) => p.token),
        ...this.state.others
      ].map(fresh);
      button.disabled = true;
      button.textContent = "Checking\u2026";
      try {
        const r = await this.route(this.lastPost || {}, candidates);
        this.toast(`Opening $${r.symbol} \xB7 ${r.reason}${r.holders ? ` \xB7 ${r.holders.toLocaleString("en-US")} holders` : ""}`, 3200);
      } catch (err) {
        this.toast(err.message, 4200);
      } finally {
        button.disabled = false;
        button.textContent = "Open best match";
      }
    }
  };
  async function loadCss() {
    if (cssInline) return cssInline;
    const res = await gmFetch(cssUrl || chrome.runtime.getURL("src/ui/radar.css"));
    return res.text();
  }
  function detectTheme() {
    const bg = getComputedStyle(document.body).backgroundColor;
    const m = bg.match(/\d+/g)?.map(Number) || [0, 0, 0];
    const lum = (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255;
    if (lum > 0.6) return "light";
    if (m[2] > 30 && lum > 0.05) return "dim";
    return "dark";
  }
  async function mountFloating() {
    const host = document.createElement("div");
    host.id = "narrative-radar-host";
    document.documentElement.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = await loadCss();
    const root = document.createElement("div");
    root.className = "nr-root";
    root.dataset.theme = detectTheme();
    shadow.append(style, root);
    const radar = new Radar(root, {});
    new MutationObserver(() => {
      root.dataset.theme = detectTheme();
    }).observe(document.body, { attributes: true, attributeFilter: ["style", "class"] });
    return radar;
  }
  async function mountInline(el, theme, opts = {}) {
    const style = document.createElement("style");
    style.textContent = await loadCss();
    const root = document.createElement("div");
    root.className = "nr-root inline";
    root.dataset.theme = theme;
    root.style.cssText = "display:block;height:100%";
    el.append(style, root);
    return new Radar(root, { inline: true, ...opts });
  }

  // extension/src/ui/radar.css
  var radar_default = `:host, .nr-root {
  --bg: #0b0d10;
  --panel: rgba(13, 15, 19, 0.92);
  --card: #12151a;
  --card-2: #171b21;
  --line: rgba(255, 255, 255, 0.07);
  --line-2: rgba(255, 255, 255, 0.12);
  --text: #eef1f4;
  --muted: #8b939e;
  --faint: #5b636e;
  --accent: #c8f560;
  --accent-ink: #0b0d10;
  --up: #3ddc84;
  --down: #ff5c6c;
  --warn: #ffb547;
  --gold: #f5c451;
  --violet: #a78bfa;
  --mint: #3ddc84;
  --shadow: 0 24px 80px rgba(0, 0, 0, 0.55), 0 2px 0 rgba(255, 255, 255, 0.03) inset;
  --radius: 18px;
  --font: "TwitterChirp", -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, Helvetica, Arial, sans-serif;
  --mono: ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Mono", Consolas, monospace;
  all: initial;
}

.nr-root[data-theme="light"] {
  --bg: #ffffff;
  --panel: rgba(255, 255, 255, 0.94);
  --card: #ffffff;
  --card-2: #f6f7f9;
  --line: rgba(15, 20, 25, 0.08);
  --line-2: rgba(15, 20, 25, 0.14);
  --text: #0f1419;
  --muted: #536471;
  --faint: #8b98a5;
  --accent: #0f1419;
  --accent-ink: #ffffff;
  --up: #00a35c;
  --down: #e5323f;
  --warn: #c77700;
  --gold: #b7860b;
  --violet: #7c5ce0;
  --mint: #00a35c;
  --shadow: 0 24px 80px rgba(15, 20, 25, 0.18), 0 0 0 1px rgba(15, 20, 25, 0.06);
}
.nr-root[data-theme="dim"] {
  --bg: #15202b;
  --panel: rgba(21, 32, 43, 0.94);
  --card: #1a2734;
  --card-2: #1e2d3b;
  --line: rgba(255, 255, 255, 0.08);
  --line-2: rgba(255, 255, 255, 0.14);
  --muted: #8b98a5;
  --faint: #66727f;
}

* { box-sizing: border-box; }
button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; padding: 0; }
a { color: inherit; text-decoration: none; }
svg { display: block; }

.nr-root {
  font-family: var(--font);
  color: var(--text);
  font-size: 13px;
  line-height: 1.35;
  -webkit-font-smoothing: antialiased;
}

/* ---------- floating shell ---------- */
.shell {
  position: fixed;
  top: 12px;
  right: 12px;
  bottom: 12px;
  width: min(400px, calc(100vw - 24px));
  z-index: 2147483000;
  display: flex;
  flex-direction: column;
  background: var(--panel);
  backdrop-filter: blur(24px) saturate(1.4);
  -webkit-backdrop-filter: blur(24px) saturate(1.4);
  border: 1px solid var(--line-2);
  border-radius: 22px;
  box-shadow: var(--shadow);
  overflow: hidden;
  transform: translateX(calc(100% + 24px));
  opacity: 0;
  transition: transform 0.45s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.3s ease;
  pointer-events: none;
}
.shell.open { transform: none; opacity: 1; pointer-events: auto; }
.inline .shell {
  position: static;
  width: 100%;
  height: 100%;
  transform: none;
  opacity: 1;
  pointer-events: auto;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  background: var(--bg);
}

/* ---------- header ---------- */
.head { padding: 14px 14px 10px; border-bottom: 1px solid var(--line); }
.brand { display: flex; align-items: center; gap: 10px; }
.mark { width: 26px; height: 26px; position: relative; flex: none; }
@keyframes sweep { to { transform: rotate(360deg); } }
.title { font-weight: 700; font-size: 15px; letter-spacing: -0.01em; white-space: nowrap; }
.live {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: 600 10.5px/1 var(--mono);
  letter-spacing: 0.08em;
  white-space: nowrap;
  color: var(--muted);
  padding: 6px 9px;
  border: 1px solid var(--line);
  border-radius: 999px;
}
.live i { width: 6px; height: 6px; border-radius: 50%; background: var(--up); box-shadow: 0 0 0 0 var(--up); animation: ping 1.8s ease-out infinite; }
.live.paused i { background: var(--faint); animation: none; }
@keyframes ping { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--up) 60%, transparent); } 100% { box-shadow: 0 0 0 7px transparent; } }
.icon-btn { width: 30px; height: 30px; display: grid; place-items: center; border-radius: 10px; color: var(--muted); transition: background 0.15s, color 0.15s; }
.icon-btn:hover { background: var(--card-2); color: var(--text); }

.search {
  margin-top: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  height: 40px;
  border-radius: 12px;
  background: var(--card-2);
  border: 1px solid var(--line);
  transition: border-color 0.15s, box-shadow 0.15s;
}
.search:focus-within { border-color: var(--line-2); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent); }
.search svg { color: var(--faint); flex: none; }
.search input {
  all: unset;
  flex: 1;
  min-width: 0;
  font: 500 13.5px var(--font);
  color: var(--text);
}
.search input::placeholder { color: var(--faint); }
.kbd { font: 600 10px var(--mono); color: var(--faint); border: 1px solid var(--line-2); border-radius: 6px; padding: 3px 5px; }

.source { margin-top: 10px; color: var(--muted); font-size: 12px; display: flex; gap: 6px; align-items: baseline; min-width: 0; }
.source b { color: var(--text); font-weight: 600; white-space: nowrap; }
.source span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.source a { flex: none; margin-left: auto; color: var(--muted); font: 500 11px var(--mono); text-decoration: none; white-space: nowrap; }
.source a:hover { color: var(--text); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 6px 0 10px;
  border-radius: 999px;
  background: var(--card-2);
  border: 1px solid var(--line);
  font-weight: 600;
  font-size: 12px;
  animation: pop 0.3s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}
.chip button { width: 16px; height: 16px; border-radius: 50%; display: grid; place-items: center; color: var(--faint); }
.chip button:hover { background: var(--line-2); color: var(--text); }
.chip.trend { padding-right: 10px; color: var(--muted); cursor: pointer; }
.chip.trend:hover { color: var(--text); border-color: var(--line-2); }
@keyframes pop { from { opacity: 0; transform: scale(0.9); } }

/* ---------- body ---------- */
.body { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; scrollbar-width: thin; scrollbar-color: var(--line-2) transparent; }
.body > * { flex: none; }
.section-label { font: 600 10.5px var(--mono); letter-spacing: 0.1em; text-transform: uppercase; color: var(--faint); padding: 6px 4px 0; display: flex; justify-content: space-between; }
.reroute-bar { display: flex; align-items: center; justify-content: space-between; padding: 9px 10px; border: 1px solid var(--line-2); border-radius: 8px; background: var(--card); }
.reroute-bar span { color: var(--muted); font: 600 10px var(--mono); letter-spacing: .08em; text-transform: uppercase; }
.reroute-bar button { border: 0; border-radius: 6px; padding: 7px 10px; background: var(--accent); color: var(--accent-ink); font: 600 11px var(--font); cursor: pointer; }
.reroute-bar button:disabled { opacity: .65; cursor: wait; }

.card {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 14px;
  position: relative;
  overflow: hidden;
  animation: rise 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}
.card:nth-child(2) { animation-delay: 0.05s; }
.card:nth-child(3) { animation-delay: 0.1s; }
.card:nth-child(4) { animation-delay: 0.15s; }
@keyframes rise { from { opacity: 0; transform: translateY(10px); } }
.card::before {
  content: "";
  position: absolute;
  inset: 0 0 auto 0;
  height: 80px;
  background: radial-gradient(120% 80px at 0 0, color-mix(in srgb, var(--role) 14%, transparent), transparent 70%);
  pointer-events: none;
}
.card.top { --role: var(--gold); }
.card.og { --role: var(--violet); }
.card.mover { --role: var(--mint); }
.card.tech { --role: var(--violet); border-color: color-mix(in srgb, var(--violet) 45%, var(--line)); }
.card.tech-match { border-color: color-mix(in srgb, var(--violet) 55%, var(--line)); box-shadow: 0 0 0 1px color-mix(in srgb, var(--violet) 24%, transparent); }
.card.tech-match .tag { color: var(--violet); border-color: color-mix(in srgb, var(--violet) 55%, var(--line-2)); font-weight: 800; }
.card.ca { --role: var(--accent); display: block; }
.card.more { --role: var(--muted); }

.card-top { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; position: relative; }
.badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 8px;
  border-radius: 7px;
  font: 700 10.5px var(--mono);
  letter-spacing: 0.06em;
  color: var(--role);
  background: color-mix(in srgb, var(--role) 13%, transparent);
}
.tag { font: 600 10.5px var(--mono); color: var(--muted); padding: 0 7px; height: 22px; display: inline-flex; align-items: center; border-radius: 7px; border: 1px dashed var(--line-2); }
.age { margin-left: auto; font: 600 11.5px var(--mono); color: var(--muted); }

.ident { display: flex; align-items: center; gap: 11px; margin-top: 12px; position: relative; }
.ava {
  width: 42px;
  height: 42px;
  border-radius: 13px;
  flex: none;
  overflow: hidden;
  display: grid;
  place-items: center;
  font: 800 14px var(--font);
  color: #fff;
  background: linear-gradient(135deg, var(--h1, #444), var(--h2, #222));
  box-shadow: 0 0 0 1px var(--line-2) inset;
}
.ava img { width: 100%; height: 100%; object-fit: cover; }
.names { min-width: 0; flex: 1; }
.name { font-weight: 700; font-size: 15px; letter-spacing: -0.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sub { display: flex; align-items: center; gap: 8px; margin-top: 3px; }
.sym { font: 600 12px var(--mono); color: var(--muted); }
.chain { font: 600 10px var(--mono); color: var(--faint); text-transform: uppercase; letter-spacing: 0.06em; }
.ca-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 22px;
  padding: 0 8px;
  border-radius: 7px;
  font: 600 11px var(--mono);
  color: var(--muted);
  background: var(--card-2);
  border: 1px solid var(--line);
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}
.ca-btn:hover { color: var(--text); border-color: var(--line-2); }
.ca-btn.copied { color: var(--up); border-color: color-mix(in srgb, var(--up) 40%, transparent); }

.price-row { display: flex; align-items: flex-end; justify-content: space-between; margin-top: 14px; }
.label { font: 600 10.5px var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--faint); }
.mc { font: 800 24px/1.1 var(--font); letter-spacing: -0.03em; margin-top: 4px; font-variant-numeric: tabular-nums; }
.px { font: 600 12.5px var(--mono); color: var(--muted); text-align: right; min-width: 0; max-width: 58%; }
.px .why { margin-top: 4px; font: 500 11px var(--font); color: var(--faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.px sub { font-size: 0.75em; vertical-align: -0.15em; }

.changes { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin-top: 12px; padding: 3px; background: var(--card-2); border-radius: 11px; }
.chg { text-align: center; padding: 6px 0; border-radius: 8px; }
.chg span { display: block; font: 600 10px var(--mono); color: var(--faint); }
.chg b { display: block; font: 700 12px var(--mono); margin-top: 2px; font-variant-numeric: tabular-nums; }
.chg.up b { color: var(--up); }
.chg.down b { color: var(--down); }
.chg.hot { background: color-mix(in srgb, var(--up) 12%, transparent); }

.stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 12px; }
.stat span { display: block; font: 600 10.5px var(--mono); color: var(--faint); letter-spacing: 0.04em; }
.stat b { display: block; font: 700 13.5px var(--font); margin-top: 3px; font-variant-numeric: tabular-nums; }
.stat b.bad { color: var(--down); }

.flow { margin-top: 12px; }
.flow-bar { height: 5px; border-radius: 99px; background: color-mix(in srgb, var(--down) 70%, transparent); overflow: hidden; }
.flow-bar i { display: block; height: 100%; background: var(--up); border-radius: 99px; transition: width 0.6s cubic-bezier(0.2, 0.8, 0.2, 1); }
.flow-legend { display: flex; justify-content: space-between; margin-top: 6px; font: 600 11px var(--mono); color: var(--muted); }
.flow-legend .b { color: var(--up); }
.flow-legend .s { color: var(--down); }

.audit { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line); }
.audit h4 { all: unset; display: flex; align-items: center; justify-content: space-between; font: 700 10.5px var(--mono); letter-spacing: 0.1em; text-transform: uppercase; color: var(--faint); }
.audit h4 em { font-style: normal; font-weight: 600; letter-spacing: 0.04em; text-transform: none; }
.rows { margin-top: 8px; display: flex; flex-direction: column; }
.row { display: flex; align-items: center; gap: 9px; padding: 7px 0; border-bottom: 1px dashed var(--line); }
.row:last-child { border-bottom: 0; }
.row .dot { width: 7px; height: 7px; border-radius: 50%; flex: none; background: var(--faint); }
.row.good .dot { background: var(--up); }
.row.warn .dot { background: var(--warn); }
.row.bad .dot { background: var(--down); box-shadow: 0 0 0 3px color-mix(in srgb, var(--down) 20%, transparent); }
.row .k { color: var(--muted); font-weight: 500; }
.row .v { margin-left: auto; font: 600 12px var(--mono); text-align: right; font-variant-numeric: tabular-nums; }
.row .v small { display: block; font-size: 10.5px; color: var(--faint); font-weight: 500; }
.row.bad .v { color: var(--down); }
.row.warn .v { color: var(--warn); }
.row.good .v { color: var(--text); }
.row.note { color: var(--faint); font-size: 11.5px; }
.row.note .v { color: var(--faint); font-weight: 500; font-family: var(--font); max-width: 70%; }

.wallets { margin-top: 6px; display: none; }
.wallets.show { display: block; }
.wallet { display: flex; justify-content: space-between; font: 500 11px var(--mono); color: var(--muted); padding: 3px 0; }
.wallet a:hover { color: var(--text); text-decoration: underline; }
.wallet .dev { color: var(--warn); }
.toggle { font: 600 11px var(--mono); color: var(--muted); margin-top: 4px; }
.toggle:hover { color: var(--text); }

.links { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 14px; }
.links a, .links button {
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  font: 700 11.5px var(--font);
  background: var(--card-2);
  border: 1px solid var(--line);
  color: var(--muted);
  transition: color 0.15s, border-color 0.15s, transform 0.15s;
}
.links a:hover, .links button:hover { color: var(--text); border-color: var(--line-2); transform: translateY(-1px); }
.links a.primary { background: var(--accent); color: var(--accent-ink); border-color: transparent; }
.links a.primary:hover { color: var(--accent-ink); filter: brightness(1.05); }

.skel { height: 12px; border-radius: 6px; background: linear-gradient(90deg, var(--card-2), var(--line-2), var(--card-2)); background-size: 200% 100%; animation: shimmer 1.3s linear infinite; }
@keyframes shimmer { to { background-position: -200% 0; } }
.scanning { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12px; padding: 6px 0; }
.spinner { width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--line-2); border-top-color: var(--accent); animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.flash-up { animation: flashUp 0.9s ease; }
.flash-down { animation: flashDown 0.9s ease; }
@keyframes flashUp { 0% { color: var(--up); text-shadow: 0 0 12px color-mix(in srgb, var(--up) 50%, transparent); } }
@keyframes flashDown { 0% { color: var(--down); text-shadow: 0 0 12px color-mix(in srgb, var(--down) 50%, transparent); } }

/* narrative line */
.narrative { margin-top: 10px; display: flex; gap: 8px; align-items: flex-start; padding: 10px 12px; border-radius: 12px; font-size: 12.5px; line-height: 1.45; font-weight: 600; color: var(--text);
  background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 12%, transparent), color-mix(in srgb, var(--violet) 10%, transparent)); border: 1px solid color-mix(in srgb, var(--accent) 22%, transparent); }
.narrative .spark { color: var(--accent); flex: none; margin-top: 2px; }
.nr-root[data-theme="light"] .narrative .spark { color: var(--violet); }
.narrative.thinking { color: var(--muted); font-weight: 500; }
.narrative.thinking .spark { animation: spin 2.4s linear infinite; }
.mode-note { margin-top: 10px; font-size: 11.5px; color: var(--warn); line-height: 1.4; }

.reason { display: flex; gap: 7px; align-items: flex-start; margin-top: 10px; font-size: 12px; line-height: 1.4; color: var(--muted); position: relative; }
.reason svg { color: var(--accent); flex: none; margin-top: 2px; }
.nr-root[data-theme="light"] .reason svg { color: var(--violet); }
.tag.hot { color: var(--accent-ink); background: var(--accent); border-color: transparent; font-weight: 700; }
.tag.twins { border-style: solid; color: var(--text); }
.hc { display: flex; align-items: center; gap: 8px; margin-top: 8px; padding: 7px 10px; border-radius: 10px; font: 600 11.5px var(--font); color: var(--muted); background: var(--card-2); border: 1px solid var(--line); }
.hc em { margin-left: auto; font: 600 10px var(--mono); letter-spacing: 0.06em; text-transform: uppercase; font-style: normal; color: var(--faint); }
.hc-mark { width: 18px; height: 18px; flex: none; border-radius: 50%; display: grid; place-items: center; font: 900 11px var(--font); }
.hc-mark.wait { border: 2px solid var(--line-2); border-top-color: var(--muted); animation: sweep 0.9s linear infinite; }
.hc.ok { color: var(--text); }
/* Ink, not colour: the panel's monochrome theme maps --up and --down to plain white or black. */
.hc.ok .hc-mark { background: var(--text); color: var(--bg); }
.hc.no .hc-mark { border: 1.5px solid var(--text); color: var(--text); }

/* Quick Buy: opens tryradar.fun/trade for the coin */
.radar-buy { flex: 1 1 100%; display: flex; align-items: center; justify-content: center; height: 34px; border-radius: 10px; background: var(--text); color: var(--bg); font: 800 11.5px var(--mono); letter-spacing: 0.08em; text-transform: uppercase; text-decoration: none; border: 1px solid var(--text); transition: transform 0.15s, opacity 0.15s; }
.radar-buy:hover { transform: translateY(-1px); opacity: 0.92; }
/* Insta Buy: the white buy button, \u25BE for the amount and the full buy page. */
.insta { flex: 1 1 100%; display: flex; flex-wrap: wrap; }
.insta .radar-buy { flex: 1; min-width: 0; border-radius: 10px 0 0 10px; }
.insta-more { flex: none; width: 34px; height: 34px; display: grid; place-items: center; border-radius: 0 10px 10px 0; background: var(--text); color: var(--bg); border: 1px solid var(--text); border-left-color: color-mix(in srgb, var(--bg) 25%, var(--text)); }
.insta-more svg { width: 12px; height: 12px; transition: transform 0.2s; }
.insta-more[aria-expanded="true"] svg { transform: rotate(180deg); }
.insta-menu { flex: 1 1 100%; margin-top: 4px; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 4px; padding: 4px; border-radius: 12px; background: var(--card-2); border: 1px solid var(--line); }
.insta-menu button { height: 30px; border-radius: 8px; border: 1px solid transparent; color: var(--muted); font: 700 11.5px var(--mono); }
.insta-menu button:hover { color: var(--text); border-color: var(--line-2); }
.insta-menu button.on { background: var(--text); color: var(--bg); }
.insta-menu a { grid-column: 1 / -1; height: 28px; display: flex; align-items: center; justify-content: center; font: 600 11.5px var(--font); color: var(--muted); text-decoration: none; }
.insta-menu a:hover { color: var(--text); }
/* Frontrun buy */
.fr-buy { height: 32px; display: inline-flex; align-items: center; gap: 6px; padding: 0 12px; border-radius: 10px; font: 800 12px var(--font); color: var(--text); background: var(--card-2); border: 1px solid var(--line-2); transition: transform 0.15s, opacity 0.15s; }
.fr-buy:hover { transform: translateY(-1px); }
.fr-buy.on { border-color: var(--text); }
.fr-sheet { flex: 1 1 100%; min-width: 0; max-width: 100%; box-sizing: border-box; display: grid; gap: 8px; margin-top: 2px; padding: 10px; border-radius: 12px; background: var(--card-2); border: 1px solid var(--line-2); }
.fr-presets { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
.fr-presets button { min-width: 0; padding: 0 2px; white-space: nowrap; overflow: hidden; height: 30px; border-radius: 8px; border: 1px solid var(--line); background: var(--card); color: var(--muted); font: 700 11px var(--mono); }
.fr-presets button.on, .fr-presets button:hover { color: var(--text); border-color: var(--text); }
.fr-fields { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 6px; }
.fr-fields label, .fr-wsel { min-width: 0; box-sizing: border-box; display: flex; align-items: center; gap: 6px; height: 34px; padding: 0 10px; border-radius: 8px; border: 1px solid var(--line); background: var(--card); }
.fr-fields span, .fr-wsel span { font: 600 10px var(--mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--faint); }
.fr-fields input { flex: 1; min-width: 0; border: 0; outline: 0; background: none; color: var(--text); font: 700 13px var(--mono); text-align: right; }
.fr-fields em { font: 600 10px var(--mono); color: var(--faint); font-style: normal; }
.fr-fields select, .fr-wsel select { flex: 1; min-width: 0; border: 0; outline: 0; background: none; color: var(--text); font: 700 12px var(--mono); }
.fr-wone { font: 600 11px var(--mono); color: var(--muted); }
.fr-warn { display: flex; align-items: center; gap: 8px; font: 600 11.5px var(--font); color: var(--text); }
.fr-warn span { width: 18px; height: 18px; flex: none; display: grid; place-items: center; border-radius: 50%; border: 1.5px solid var(--text); font: 900 10px var(--font); }
.fr-go { width: 100%; min-width: 0; height: 38px; border-radius: 10px; background: var(--text); color: var(--bg); font: 800 13px var(--font); border: 0; }
.fr-go:disabled { opacity: 0.5; cursor: default; }
.fr-msg { font: 600 12px var(--font); color: var(--text); }
.fr-msg a { text-decoration: underline; }
.fr-fine { font: 500 10.5px var(--font); color: var(--faint); }
/* settings (toolbar popup) */
.settings { display: grid; gap: 12px; padding: 6px 4px; }
/* Alerts: the bell under a post, the empty state's call to action, and the popup's list. */
.watch { margin-top: 10px; width: 100%; display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid var(--line-2); border-radius: 10px;
  background: transparent; color: var(--muted); font: 600 12px/1.2 var(--font); text-align: left; cursor: pointer; transition: color .15s, border-color .15s, background .15s; }
.watch:hover:not(:disabled) { color: var(--text); border-color: color-mix(in srgb, var(--text) 30%, transparent); background: var(--card-2); }
.watch:disabled { cursor: progress; opacity: .7; }
.watch svg { flex: none; }
.watch.on { color: var(--text); cursor: default; border-color: color-mix(in srgb, var(--violet) 55%, transparent); background: color-mix(in srgb, var(--violet) 8%, transparent); }
.watch.on svg { color: var(--violet); }
.watch.on span { flex: 1; min-width: 0; }
.watch.on button { border: 1px solid var(--line-2); border-radius: 7px; padding: 4px 9px; background: transparent; color: var(--muted); font: 600 11px var(--font); cursor: pointer; }
.watch.on button:hover { color: var(--text); background: var(--card-2); }
.watch.cta { width: auto; display: inline-flex; margin: 16px auto 0; padding: 10px 14px; border: 0; background: var(--accent); color: var(--accent-ink); }
.watch.cta:hover:not(:disabled) { background: var(--accent); color: var(--accent-ink); filter: brightness(1.06); }
.watch.on.cta { background: color-mix(in srgb, var(--violet) 8%, transparent); color: var(--text); border: 1px solid color-mix(in srgb, var(--violet) 55%, transparent); }
.al-list { display: grid; gap: 6px; }
.al-w, .al-hit { display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 10px; background: var(--card-2); border: 1px solid var(--line); font: 600 12px var(--font); color: var(--text); text-decoration: none; min-width: 0; }
.al-w > div { flex: 1; min-width: 0; display: grid; gap: 2px; }
.al-w > div span, .al-hit span { color: var(--muted); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.al-w em { font: 600 11px var(--mono); font-style: normal; color: var(--faint); white-space: nowrap; }
.al-w button { border: 1px solid var(--line-2); border-radius: 7px; padding: 4px 9px; background: transparent; color: var(--muted); font: 600 11px var(--font); cursor: pointer; }
.al-w button:hover { color: var(--text); }
.al-hit:hover { border-color: var(--line-2); }
.al-hit span { flex: 1; }
.al-hit em { font: 700 10.5px var(--mono); font-style: normal; color: var(--muted); white-space: nowrap; }
.empty + .settings { margin-top: 4px; }
.settings p { margin: 0; font: 500 12.5px/1.45 var(--font); color: var(--muted); }
.settings p.fine { font-size: 11px; color: var(--faint); }
.set-head { display: flex; align-items: center; justify-content: space-between; }
.set-head h3 { margin: 0; font: 800 16px var(--font); color: var(--text); }
.fr-connect { display: flex; gap: 6px; }
.fr-connect input { flex: 1; min-width: 0; height: 36px; padding: 0 10px; border-radius: 10px; border: 1px solid var(--line-2); background: var(--card-2); color: var(--text); font: 600 12px var(--mono); outline: 0; }
.fr-btn { height: 36px; padding: 0 14px; border-radius: 10px; background: var(--text); color: var(--bg); font: 800 12px var(--font); border: 1px solid var(--text); }
.fr-btn.ghost { background: none; color: var(--text); border-color: var(--line-2); }
.fr-link { font: 600 12px var(--font); color: var(--text); text-decoration: underline; }
.fr-err { color: var(--text) !important; font-weight: 700 !important; }
.fr-wallets { display: grid; gap: 6px; }
.fr-w { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 10px; background: var(--card-2); border: 1px solid var(--line); font: 600 12px var(--font); color: var(--text); }
.fr-w span { font-family: var(--mono); color: var(--muted); }
.fr-w em { margin-left: auto; font: 700 12px var(--mono); font-style: normal; }

/* bundled supply */
.supply { margin-top: 14px; padding: 12px; border-radius: 14px; background: var(--card-2); border: 1px solid var(--line); }
.supply-head { display: flex; align-items: baseline; justify-content: space-between; }
.supply-head span { font: 700 10.5px var(--mono); letter-spacing: 0.1em; text-transform: uppercase; color: var(--faint); }
.supply-head b { font: 800 22px/1 var(--font); letter-spacing: -0.02em; font-variant-numeric: tabular-nums; display: inline-block; }
.supply-head b.good { color: var(--up); }
.supply-head b.warn { color: var(--warn); }
.supply-head b.bad { color: var(--down); }
.supply-head b.na { color: var(--faint); font-size: 15px; }
.supply-bar { position: relative; display: flex; height: 8px; margin-top: 10px; border-radius: 99px; overflow: hidden; background: var(--line-2); }
.supply-bar .seg { height: 100%; transition: width 0.6s cubic-bezier(0.2, 0.8, 0.2, 1); }
.supply-bar .seg.bundle { background: color-mix(in srgb, var(--down) 60%, transparent); }
.supply-bar .seg.dev { background: color-mix(in srgb, var(--violet) 65%, transparent); }
.supply-bar .held { position: absolute; left: 0; top: 2.5px; height: 3px; border-radius: 99px; background: var(--text); opacity: 0.9; }
.supply-legend { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin-top: 8px; font: 600 11px var(--mono); color: var(--muted); }
.supply-legend .k { display: inline-block; width: 7px; height: 7px; border-radius: 2px; margin-right: 5px; }
.supply-legend .k.bundle { background: var(--down); }
.supply-legend .k.dev { background: var(--violet); }
.supply-legend .scanning { padding: 0; }

.tile-b { font: 700 10px var(--mono); color: var(--faint); }
.tile-b.good { color: var(--up); }
.tile-b.warn { color: var(--warn); }
.tile-b.bad { color: var(--down); }

/* collapsible card */
.toggle-card { margin-left: auto; width: 28px; height: 28px; display: grid; place-items: center; border-radius: 9px; color: var(--muted); background: var(--card-2); border: 1px solid var(--line); transition: color 0.15s, border-color 0.15s, transform 0.35s cubic-bezier(0.2, 0.8, 0.2, 1); flex: none; }
.toggle-card:hover { color: var(--text); border-color: var(--line-2); }
.card.open .toggle-card { transform: rotate(180deg); color: var(--text); }
.compact { display: grid; grid-template-columns: 1.4fr 1fr 1fr; gap: 8px; margin-top: 12px; padding: 10px 12px; border-radius: 12px; background: var(--card-2); border: 1px solid var(--line); cursor: pointer; position: relative; transition: border-color 0.15s; }
.compact:hover { border-color: var(--line-2); }
.compact span { display: block; font: 600 10px var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--faint); white-space: nowrap; }
.compact b { display: block; margin-top: 3px; font: 800 15px var(--font); letter-spacing: -0.01em; font-variant-numeric: tabular-nums; }
.compact b.mc { font-size: 18px; letter-spacing: -0.02em; }
.card-body { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 0.4s cubic-bezier(0.2, 0.8, 0.2, 1); }
.card.open .card-body { grid-template-rows: 1fr; }
.card-inner { min-height: 0; overflow: hidden; opacity: 0; transition: opacity 0.25s ease; }
.card.open .card-inner { opacity: 1; }
.price-line { display: flex; justify-content: space-between; align-items: baseline; margin-top: 12px; }
.price-line .px { max-width: none; }
.tag.rug { color: #fff; background: var(--down); border-color: transparent; font-weight: 700; }

/* trading terminals */
.terminals { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
.t-label { font: 700 10px var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--faint); margin-right: 2px; white-space: nowrap; }
.term { flex: 1; height: 32px; display: flex; align-items: center; justify-content: center; gap: 7px; border-radius: 10px; font: 700 12px var(--font); color: var(--text); background: var(--card-2); border: 1px solid var(--line); transition: transform 0.15s, border-color 0.15s, background 0.15s; }
.term:hover { transform: translateY(-1px); border-color: var(--line-2); background: color-mix(in srgb, var(--accent) 8%, var(--card-2)); }
.term img { width: 18px; height: 18px; border-radius: 5px; }

/* collapsible card end */
/* overview strip */
.overview { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.tile {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  padding: 10px 10px 9px;
  border-radius: 14px;
  background: var(--card);
  border: 1px solid var(--line);
  text-align: left;
  min-width: 0;
  position: relative;
  overflow: hidden;
  transition: border-color 0.15s, transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
  animation: rise 0.45s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}
.tile:nth-child(2) { animation-delay: 0.04s; }
.tile:nth-child(3) { animation-delay: 0.08s; }
.tile:hover { border-color: color-mix(in srgb, var(--role) 45%, transparent); transform: translateY(-1px); }
.tile::after { content: ""; position: absolute; inset: auto 0 0 0; height: 2px; background: var(--role); opacity: 0.7; }
.tile.top { --role: var(--gold); }
.tile.og { --role: var(--violet); }
.tile.mover { --role: var(--mint); }
.tile-role { display: inline-flex; align-items: center; gap: 4px; font: 700 9.5px var(--mono); letter-spacing: 0.06em; color: var(--role); }
.tile-sym { font: 600 11.5px var(--mono); color: var(--muted); max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tile-sym i { font-style: normal; color: var(--warn); }
.tile b { font: 800 16px var(--font); letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.tile-chg { font: 700 11px var(--mono); color: var(--faint); }
.tile-chg.up { color: var(--up); }
.tile-chg.down { color: var(--down); }

/* compact list */
.list { background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; }
.li { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-bottom: 1px solid var(--line); cursor: pointer; transition: background 0.15s; width: 100%; text-align: left; }
.li:last-child { border-bottom: 0; }
.li:hover { background: var(--card-2); }
.li .ava { width: 30px; height: 30px; border-radius: 9px; font-size: 11px; }
.li .nm { min-width: 0; flex: 1; }
.li .nm b { display: block; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.li .nm span { font: 500 11px var(--mono); color: var(--faint); }
.li .r { text-align: right; font: 600 12px var(--mono); }
.li .r span { display: block; font-size: 11px; }
.up { color: var(--up); }
.down { color: var(--down); }

/* states */
.empty { text-align: center; padding: 40px 20px; color: var(--muted); }
.empty .big { font: 700 16px var(--font); color: var(--text); margin: 14px 0 6px; letter-spacing: -0.01em; }
.empty p { margin: 0 auto; max-width: 280px; font-size: 13px; line-height: 1.5; }
.empty .radar { width: 84px; height: 84px; margin: 0 auto; }
.error { color: var(--down); }
.loading-card { background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); padding: 14px; display: flex; flex-direction: column; gap: 10px; }

.foot { padding: 10px 14px; border-top: 1px solid var(--line); display: flex; align-items: center; justify-content: space-between; font: 500 11px var(--mono); color: var(--faint); gap: 8px; }
.foot a:hover { color: var(--text); }

.toast {
  position: absolute;
  left: 50%;
  bottom: 52px;
  transform: translate(-50%, 12px);
  background: var(--text);
  color: var(--bg);
  font: 700 12px var(--font);
  padding: 9px 14px;
  border-radius: 999px;
  opacity: 0;
  transition: opacity 0.2s, transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
  pointer-events: none;
}
.toast.show { opacity: 1; transform: translate(-50%, 0); }

@media (prefers-reduced-motion: reduce) {
  *, *::before { animation: none !important; transition: none !important; }
}

/* ---- monochrome, minimal ---- */
.nr-root, .nr-root[data-theme="dim"] {
  --bg: #000; --panel: #000; --card: #0a0a0a; --card-2: #111;
  --line: rgba(255,255,255,.08); --line-2: rgba(255,255,255,.16);
  --text: #fff; --muted: #a3a3a3; --faint: #6b6b6b;
  --accent: #fff; --accent-ink: #000;
  --up: #fff; --down: #fff; --warn: #fff; --gold: #fff; --violet: #fff; --mint: #fff;
  --shadow: 0 0 0 1px rgba(255,255,255,.1);
}
.nr-root[data-theme="light"] {
  --bg: #fff; --panel: #fff; --card: #fff; --card-2: #f5f5f5;
  --line: rgba(0,0,0,.08); --line-2: rgba(0,0,0,.16);
  --text: #000; --muted: #555; --faint: #8a8a8a;
  --accent: #000; --accent-ink: #fff;
  --up: #000; --down: #000; --warn: #000; --gold: #000; --violet: #000; --mint: #000;
  --shadow: 0 0 0 1px rgba(0,0,0,.1);
}
.shell { backdrop-filter: none; -webkit-backdrop-filter: none; border-radius: 14px; }
.empty .radar, .badge svg, .reason svg, .narrative .spark, .ava, .overview,
.changes, .price-line, .flow, .supply-bar, .supply-legend .k, 
.row .dot, .live i { display: none !important; }
.card { border-radius: 12px; animation: none; }
.card::before { display: none; }
.badge { background: none; padding: 0; height: auto; color: var(--muted); letter-spacing: .1em; }
.tag, .tag.hot { background: none; border: 1px solid var(--line-2); color: var(--muted); }
.narrative { background: none; border: 0; border-left: 2px solid var(--text); border-radius: 0; padding: 2px 0 2px 10px; font-weight: 500; }
.supply { background: none; border: 0; border-top: 1px solid var(--line); border-radius: 0; padding: 12px 0 0; }
.supply-head b, .supply-head b.good, .supply-head b.warn, .row.bad .v, .row.warn .v, .row.good .v { color: var(--text); }
.tag.tech-match { color: var(--violet); border-color: color-mix(in srgb, var(--violet) 55%, var(--line-2)); font-weight: 800; }
.nr-root[data-theme="light"] .supply-head b.bad { color: #e5323f; }
.row.bad .v { font-weight: 800; }
.term img { filter: grayscale(1); }
.term:hover { background: var(--card-2); }
.links a.primary { background: var(--text); color: var(--bg); }
.chip { animation: none; }
.nr-btn:hover { background: rgba(255,255,255,.1) !important; color: #fff !important; }

.narrative em { display: block; margin-top: 4px; font-style: normal; font-weight: 500; font-size: 11.5px; color: var(--muted); }
.trend-list { margin-top: 18px; display: flex; flex-direction: column; gap: 2px; text-align: left; }
.trend-list span { font: 600 10px var(--mono); letter-spacing: .1em; text-transform: uppercase; color: var(--faint); margin-bottom: 6px; }
.trend-list button { text-align: left; padding: 8px 0; border-bottom: 1px solid var(--line); color: var(--text); font-weight: 600; }
.trend-list button:hover { color: var(--muted); }
.recent-list { margin-top: 18px; display: flex; flex-direction: column; text-align: left; }
.recent-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font: 600 10px var(--mono); letter-spacing: .1em; text-transform: uppercase; color: var(--faint); }
.recent-top button { font: inherit; letter-spacing: inherit; text-transform: inherit; color: var(--faint); }
.recent-top button:hover { color: var(--text); }
.recent-row { display: flex; align-items: baseline; gap: 8px; width: 100%; min-height: 36px; padding: 8px 0; border-bottom: 1px solid var(--line); text-align: left; color: var(--text); }
.recent-row b { flex: none; font-weight: 700; }
.recent-row span { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--muted); }
.recent-row em { flex: none; font: 500 11px var(--mono); font-style: normal; color: var(--faint); }
.recent-row:hover span { color: var(--text); }
.launch-btn { display: block; width: 100%; min-height: 40px; margin-top: 14px; border: 1px solid var(--line-2); border-radius: 10px; font-weight: 700; color: var(--text); text-align: center; }
.launch-btn:hover { background: var(--card-2); }
.hc-by { margin-left: auto; flex: none; font: 600 10px var(--mono); letter-spacing: 0.06em; color: var(--faint); text-decoration: none; white-space: nowrap; }
.hc-by:hover { color: var(--text); }
.hc > span:nth-child(2) { min-width: 0; }
.recent-top a { color: var(--faint); text-decoration: none; letter-spacing: 0; text-transform: none; }
.recent-top a:hover { color: var(--text); }
.lc-board { margin-top: 18px; display: flex; flex-direction: column; text-align: left; }
.lc-tabs { display: flex; gap: 6px; margin: 2px 0 6px; }
.lc-tabs button { padding: 5px 9px; border: 1px solid var(--line); border-radius: 999px; font: 600 11px var(--font); color: var(--muted); }
.lc-tabs button[aria-selected="true"] { color: var(--text); border-color: var(--line-2); background: var(--card-2); }
.lc-row { display: flex; align-items: center; gap: 8px; min-height: 38px; border-bottom: 1px solid var(--line); }
.lc-row button { flex: 1; min-width: 0; padding: 8px 0; text-align: left; color: var(--text); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.lc-row button:hover { color: var(--muted); }
.lc-row b { font-weight: 600; }
.lc-row a { flex: none; text-decoration: none; }
.lc-none { margin: 10px 0 0; font-size: 12px; color: var(--faint); }
.lc-ask { display: flex; gap: 6px; margin-top: 10px; }
.lc-ask input { flex: 1; min-width: 0; height: 32px; padding: 0 10px; border: 1px solid var(--line); border-radius: 9px; background: transparent; color: var(--text); font: 500 12px var(--font); outline: 0; }
.lc-ask input:focus { border-color: var(--line-2); }
.lc-ask button { height: 32px; padding: 0 12px; border: 1px solid var(--line-2); border-radius: 9px; font-weight: 700; color: var(--text); }
.lc-answer { margin-top: 8px; font-size: 12px; color: var(--text); }
.lc-answer p { margin: 0 0 4px; white-space: pre-wrap; }
.lc-answer span { font-size: 11px; color: var(--faint); }
.retry { margin-top: 14px; height: 34px; padding: 0 16px; border-radius: 10px; border: 1px solid var(--line-2); font-weight: 700; }
.retry:hover { background: var(--card-2); }

/* ---- story check + coin check ---- */
.verdict { display: inline-flex; align-items: center; gap: 5px; height: 20px; padding: 0 8px; border-radius: 999px; font: 700 10px var(--mono); letter-spacing: 0.06em; white-space: nowrap; border: 1px solid var(--line-2); color: var(--muted); }
.verdict b { font-weight: 800; color: var(--text); }
.verdict.ok { color: var(--text); border-color: var(--text); }
.verdict.risk { background: var(--text); color: var(--bg); border-color: var(--text); }
.verdict.risk b { color: var(--bg); }
.card-top .cc { margin-left: auto; display: inline-flex; }
/* Header stays one line (role, verdict, toggle); tags like "also the OG" get their own row. */
.card-top { flex-wrap: wrap; row-gap: 6px; }
.card-top .badge { order: 0; white-space: nowrap; }
.card-top .cc { order: 1; }
.card-top .toggle-card { order: 2; }
.card-top:has(.tag)::after { content: ""; order: 3; flex-basis: 100%; height: 0; }
.card-top .tag { order: 4; white-space: nowrap; }
.card-top .cc:empty { display: none; }
.card-top .cc + .toggle-card { margin-left: 6px; }
.story { margin-top: 8px; padding: 9px 10px 10px; border-radius: 12px; border: 1px solid var(--line); }
.story.risk { border-color: var(--line-2); }
.story-top { all: unset; cursor: pointer; display: flex; align-items: center; gap: 8px; width: 100%; }
.story-top svg { margin-left: auto; color: var(--faint); transition: transform 0.2s; }
.story-top[aria-expanded="true"] svg { transform: rotate(180deg); }
.story-k { font: 700 10px var(--mono); letter-spacing: 0.1em; text-transform: uppercase; color: var(--faint); }
.story-call { margin-top: 6px; font-size: 12px; line-height: 1.4; color: var(--muted); display: flex; align-items: center; gap: 6px; }
.story.loading .story-call { color: var(--faint); }
.who-top { cursor: default; }
.who-label { margin-top: 5px; font-size: 12px; font-weight: 600; color: var(--text); }
.who:not(.loading) .story-call { display: block; }
.who .story-call b { color: var(--text); }
.who-connect { all: unset; cursor: pointer; display: block; margin-top: 8px; padding: 7px 10px; border-radius: 8px; border: 1px solid var(--line); font-size: 12px; font-weight: 600; color: var(--text); text-align: center; }
.who-connect:hover { border-color: var(--text); }
.who-rows { margin-top: 7px; display: grid; gap: 2px; }
.who-row { display: grid; grid-template-columns: minmax(0, 1fr) 58px 46px 54px; gap: 8px; padding: 4px 0; font-size: 11px; color: var(--muted); text-decoration: none; border-top: 1px solid var(--line); }
.who-row b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); font-weight: 600; }
.who-row:hover b { text-decoration: underline; }
.who-row span { text-align: right; white-space: nowrap; }
.who .story-call b.who-gone, .who-row .who-gone { color: var(--warn); }
.findings { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 6px; }
.findings li { font-size: 11.5px; line-height: 1.4; color: var(--muted); display: grid; grid-template-columns: 58px 1fr; gap: 6px; }
.findings li span { font: 700 9.5px var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--faint); padding-top: 2px; }
.findings li.risk { color: var(--text); }
.findings li.risk span, .findings li.works span { color: var(--text); }
.story-note { margin-top: 8px; font-size: 10.5px; color: var(--faint); }
.coin-check { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line); }
.coin-check:empty { display: none; }
.coin-check h4 { all: unset; display: flex; align-items: center; justify-content: space-between; font: 700 10.5px var(--mono); letter-spacing: 0.1em; text-transform: uppercase; color: var(--faint); }
.cc-call { margin: 8px 0 2px; font-size: 12px; color: var(--muted); line-height: 1.4; }

/* ---- a card's actions: one Trade button (\u25BE for the other terminals) + Larpcheck ---- */
.actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.actions:empty { display: none; }
.trade { position: relative; flex: 1; min-width: 0; display: flex; flex-wrap: wrap; }
.trade .term { border-radius: 10px 0 0 10px; min-width: 0; }
.trade .term span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.term-more { flex: none; width: 30px; height: 32px; display: grid; place-items: center; border: 1px solid var(--line); border-left: 0; border-radius: 0 10px 10px 0; background: var(--card-2); color: var(--faint); }
.term-more:hover { color: var(--text); }
.term-more svg { width: 12px; height: 12px; transition: transform 0.2s; }
.term-more[aria-expanded="true"] svg { transform: rotate(180deg); }
/* Opens inside the card (a floating menu would be cut off by a collapsed card's edge). */
.term-menu { flex: 1 1 100%; margin-top: 4px; display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 4px; border-radius: 12px; background: var(--card-2); border: 1px solid var(--line); }
.term-menu a { height: 30px; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 0 10px; border-radius: 8px; font: 700 12px var(--font); color: var(--text); }
.term-menu a:hover { background: var(--card); }
.term-menu img { width: 16px; height: 16px; border-radius: 4px; filter: grayscale(1); }
.show-more { width: 100%; height: 34px; margin-top: 6px; border-radius: 10px; border: 1px solid var(--line); background: var(--card); font: 600 11px var(--mono); letter-spacing: 0.06em; color: var(--muted); }
.show-more:hover { color: var(--text); border-color: var(--line-2); }

/* ---- Larpcheck (larpcheck.app) verdicts: always named and linked to their report, in Larpcheck's yellow ---- */
/* On a card, Larpcheck's verdict is its own full-width bar above the Trade button. */
.lc-slot { flex: 1 1 100%; order: -1; display: flex; }
.lc-slot:empty { display: none; }
.lc-slot .lc-btn { flex: 1; justify-content: space-between; }
.lc-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 32px; padding: 0 11px; border-radius: 10px; background: #F7C518; color: #0B0B0C; font: 800 10.5px var(--mono); letter-spacing: 0.04em; text-transform: uppercase; white-space: nowrap; text-decoration: none; transition: transform 0.15s, filter 0.15s; }
.lc-btn:hover { transform: translateY(-1px); filter: brightness(1.06); color: #0B0B0C; }
.lc-btn b { font-weight: 800; }
.lc-btn .lc-k { font-weight: 700; opacity: 0.65; }
.lc-btn .lc-go { font-size: 12px; }
.lc-headline { margin: 8px 0 0; font-size: 11.5px; line-height: 1.4; color: var(--muted); }
.lc-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 10px; font-size: 10.5px; line-height: 1.35; color: var(--faint); }
.lc-foot b { font-weight: 700; color: var(--muted); }
.lc-foot .lc-btn { flex: none; height: 26px; padding: 0 10px; font-size: 10px; border-radius: 8px; }
`;

  // userscript/host.js
  var MAINNET = "https://api.mainnet-beta.solana.com";
  var PUBLIC_NODE = "https://solana-rpc.publicnode.com";
  var gm = typeof GM !== "undefined" ? GM : {};
  var store = {
    async get(key) {
      try {
        const raw = gm.getValue ? await gm.getValue(key) : localStorage.getItem(`nr:${key}`);
        return raw == null ? null : JSON.parse(raw);
      } catch {
        return null;
      }
    },
    async set(key, value) {
      try {
        const raw = JSON.stringify(value);
        if (gm.setValue) await gm.setValue(key, raw);
        else localStorage.setItem(`nr:${key}`, raw);
      } catch {
      }
    }
  };
  var rpcCall = (url) => gmFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSlot", params: [] }),
    signal: AbortSignal.timeout(6e3)
  }).then((r) => r.ok && r.json()).then((j) => typeof j?.result === "number").catch(() => false);
  var rpcPick = null;
  function pickRpc() {
    rpcPick ||= (async () => {
      const health = await gmFetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(4e3) }).then((r) => r.json()).catch(() => ({}));
      if (health.rpc) return `${API_BASE}/rpc`;
      if (await rpcCall(MAINNET)) return null;
      return PUBLIC_NODE;
    })();
    return rpcPick;
  }
  var handlers = makeHandlers({
    settings: async () => ({ ...DEFAULTS, ...await store.get("settings") || {} }),
    store,
    openWindow: (url) => gm.openInTab ? gm.openInTab(url, { active: true }) : window.open(url, "_blank", "noopener"),
    rpcUrl: async (s) => s.rpcUrl || pickRpc(),
    ready: Promise.resolve(),
    // x.com's page security blocks DexScreener's image hosts; data: URLs are allowed.
    inlineImages: true,
    prunedNote: "This browser reads a Solana node that keeps only recent blocks, so older launches can\u2019t be checked here."
  });
  useBackend(handlers, { cssText: radar_default });
  globalThis.__nrHost = {
    send: async (msg) => {
      const fn = handlers[msg?.type];
      if (!fn) return { ok: false, error: `Unknown request ${msg?.type}` };
      try {
        return { ok: true, data: await fn(msg) };
      } catch (e) {
        return { ok: false, error: String(e?.message || e) };
      }
    },
    get: (key) => store.get(key),
    set: (key, value) => store.set(key, value),
    radar: async () => radar_exports
  };

  // extension/src/content/content.js
  (() => {
    if (document.documentElement.hasAttribute("data-narrative-radar")) return;
    document.documentElement.setAttribute("data-narrative-radar", globalThis.__nrHost ? "userscript" : "extension");
    const ext2 = globalThis.browser ?? globalThis.chrome;
    const host = globalThis.__nrHost || {
      send: (msg) => ext2.runtime.sendMessage(msg),
      get: (key) => ext2.storage.local.get(key).then((r) => r[key]),
      set: (key, value) => ext2.storage.local.set({ [key]: value }),
      radar: () => import(ext2.runtime.getURL("src/ui/radar.js"))
    };
    let radar = null;
    const getRadar = () => radar ||= host.radar().then((m) => m.mountFloating());
    const ICON = `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true"><path d="M7 0h5v1h-5zM7 1h5v1h-5zM7 2h5v1h-5zM3 3h10v1h-10zM2 4h12v1h-12zM1 5h4v1h-4zM11 5h4v1h-4zM1 6h3v1h-3zM5 6h1v1h-1zM11 6h4v1h-4zM1 7h2v1h-2zM10 7h2v1h-2zM13 7h2v1h-2zM1 8h2v1h-2zM9 8h2v1h-2zM13 8h2v1h-2zM1 9h2v1h-2zM7 9h3v1h-3zM13 9h2v1h-2zM1 10h2v1h-2zM7 10h2v1h-2zM13 10h2v1h-2zM1 11h2v1h-2zM5 11h1v1h-1zM11 11h1v1h-1zM13 11h2v1h-2zM1 12h3v1h-3zM12 12h3v1h-3zM2 13h12v1h-12zM3 14h10v1h-10z"/></svg>`;
    const css = document.createElement("style");
    css.textContent = `
    .nr-btn{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;margin:0 2px;border-radius:999px;border:0;background:transparent;color:rgb(113,118,123);cursor:pointer;transition:background .2s,color .2s;flex:none}
    .nr-btn:hover{background:rgba(127,127,127,.15);color:inherit}
    .nr-btn.nr-trend{position:absolute;right:44px;top:50%;transform:translateY(-50%);width:30px;height:30px;opacity:0;transition:opacity .15s,background .2s,color .2s;z-index:2}
    [data-testid="trend"]{position:relative}
    [data-testid="trend"]:hover .nr-btn.nr-trend,.nr-btn.nr-trend:focus-visible{opacity:1}
    .nr-fab{position:fixed;right:24px;bottom:150px;z-index:2147482000;width:48px;height:48px;padding:0;display:flex;align-items:center;justify-content:center;border-radius:999px;border:1px solid rgba(255,255,255,.1);
      background:#000;color:#fff;box-shadow:0 10px 40px rgba(0,0,0,.35);cursor:pointer;transition:transform .2s cubic-bezier(.2,.8,.2,1),box-shadow .2s}
    .nr-fab:hover{transform:translateY(-2px);box-shadow:0 14px 48px rgba(0,0,0,.45)}
    .nr-fab svg{width:24px;height:24px}
    @media (max-width:700px){.nr-fab{bottom:calc(150px + env(safe-area-inset-bottom))}}
    .nr-ca{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0 2px}
    .nr-ca-btn{display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 12px 0 9px;border-radius:999px;border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;
      font:700 13px/1 TwitterChirp,-apple-system,"Segoe UI",system-ui,sans-serif;cursor:pointer;transition:background .15s,border-color .15s}
    .nr-ca-btn:hover{background:rgba(127,127,127,.12);border-color:rgba(127,127,127,.6)}
    .nr-ca-btn svg{width:16px;height:16px;opacity:.75}
    .nr-ca-btn span{font-weight:500;opacity:.65;font-variant-numeric:tabular-nums}
    .nr-action-wrap{display:flex;align-items:center;justify-content:flex-start;position:relative;flex:none;gap:2px}
    .nr-reroute-btn{display:inline-flex;align-items:center;justify-content:center;height:30px;margin:0 2px;padding:0 8px;border:1px solid rgba(127,127,127,.35);border-radius:999px;background:transparent;color:rgb(113,118,123);cursor:pointer;white-space:nowrap;font:600 11px/1 TwitterChirp,-apple-system,"Segoe UI",system-ui,sans-serif;transition:background .2s,color .2s,border-color .2s}
    .nr-reroute-btn:hover{background:rgba(127,127,127,.15);border-color:rgba(127,127,127,.6);color:inherit}
    .nr-hint{position:absolute;bottom:calc(100% + 10px);right:-6px;z-index:30;display:flex;align-items:center;gap:12px;padding:10px 10px 10px 14px;border-radius:14px;background:#000;color:#fff;
      border:1px solid rgba(255,255,255,.16);box-shadow:0 12px 40px rgba(0,0,0,.4);font:600 13px/1.2 TwitterChirp,-apple-system,"Segoe UI",system-ui,sans-serif;white-space:nowrap;animation:nr-in .35s cubic-bezier(.2,.8,.2,1)}
    .nr-hint::after{content:"";position:absolute;top:100%;right:17px;border:6px solid transparent;border-top-color:#000}
    .nr-hint button{all:unset;cursor:pointer;padding:6px 10px;border-radius:999px;background:#fff;color:#000;font-weight:700;font-size:12px}
    @keyframes nr-in{from{opacity:0;transform:translateY(6px)}}
    .nr-alerts{position:fixed;right:24px;bottom:210px;z-index:2147483647;display:flex;flex-direction:column;gap:10px;width:330px;max-width:calc(100vw - 32px)}
    @media (max-width:700px){.nr-alerts{right:16px;bottom:calc(210px + env(safe-area-inset-bottom))}}
    .nr-alert{position:relative;padding:14px 14px 12px;border-radius:16px;background:#000;color:#fff;border:1px solid rgba(167,139,250,.45);box-shadow:0 16px 48px rgba(0,0,0,.45);
      font:500 13px/1.4 TwitterChirp,-apple-system,"Segoe UI",system-ui,sans-serif;animation:nr-in .35s cubic-bezier(.2,.8,.2,1)}
    .nr-alert-top{display:flex;align-items:center;gap:8px;color:#a78bfa;font:700 11px/1 ui-monospace,"SF Mono",Consolas,monospace;letter-spacing:.08em;text-transform:uppercase}
    .nr-alert-top svg{width:14px;height:14px}
    .nr-alert-top span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .nr-alert-x{all:unset;cursor:pointer;width:24px;height:24px;display:grid;place-items:center;border-radius:999px;color:#8b939e;font-size:16px;line-height:1}
    .nr-alert-x:hover{background:rgba(255,255,255,.1);color:#fff}
    .nr-alert-coin{margin-top:10px;display:flex;align-items:baseline;gap:8px;min-width:0}
    .nr-alert-coin b{font-size:20px;font-weight:800;letter-spacing:-.01em}
    .nr-alert-coin span{color:#8b939e;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .nr-alert-meta{margin-top:2px;color:#c9ced6;font-variant-numeric:tabular-nums}
    .nr-alert-checks{margin-top:10px;display:grid;gap:4px;padding:8px 10px;border-radius:10px;background:#111418;border:1px solid rgba(255,255,255,.07);font-size:12px}
    .nr-alert-checks div{display:flex;gap:7px;align-items:center}
    .nr-alert-checks i{width:7px;height:7px;border-radius:50%;flex:none;background:#8b939e}
    .nr-alert-checks i.ok{background:#3ddc84}.nr-alert-checks i.risk{background:#ff5c6c}.nr-alert-checks i.mid{background:#ffb547}
    .nr-alert-acts{margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:6px}
    .nr-alert-acts button{all:unset;cursor:pointer;height:34px;padding:0 12px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;font:700 12.5px/1 TwitterChirp,-apple-system,"Segoe UI",system-ui,sans-serif;white-space:nowrap;
      border:1px solid rgba(255,255,255,.16);color:#fff;transition:background .15s}
    .nr-alert-acts button:hover{background:rgba(255,255,255,.1)}
    .nr-alert-acts button.buy{grid-column:1/-1;background:#fff;color:#000;border-color:#fff}
    .nr-alert-acts button.buy:hover{background:#e7e9ea}`;
    document.documentElement.appendChild(css);
    const textOf = (el) => (el?.innerText || "").trim();
    const send2 = (msg) => host.send(msg).then((r) => r?.ok ? r.data : Promise.reject(new Error(r?.error || "No response")));
    const usd2 = (n2) => !Number.isFinite(n2) ? "" : n2 >= 1e9 ? `$${(n2 / 1e9).toFixed(2)}B` : n2 >= 1e6 ? `$${(n2 / 1e6).toFixed(2)}M` : n2 >= 1e3 ? `$${(n2 / 1e3).toFixed(1)}K` : `$${Math.round(n2)}`;
    const ageOf = (ms) => {
      if (!ms) return "";
      const m = (Date.now() - ms) / 6e4;
      return m < 60 ? `${Math.max(1, Math.round(m))}m` : m < 1440 ? `${Math.round(m / 60)}h` : m < 43200 ? `${Math.round(m / 1440)}d` : m < 525600 ? `${Math.round(m / 43200)}mo` : `${(m / 525600).toFixed(1)}y`;
    };
    const esc3 = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    const handleOf = (article) => [...article.querySelectorAll('[data-testid="User-Name"] a[href^="/"]')].map((a) => a.getAttribute("href").slice(1)).find((h) => h && !h.includes("/")) || "";
    function replyHandles(article) {
      const block = [...article.querySelectorAll("div")].find((d) => d.childElementCount <= 12 && /^Replying to\b/.test(textOf(d)));
      if (!block) return [];
      return [...new Set([...block.querySelectorAll('a[href^="/"]')].map((a) => a.getAttribute("href").slice(1)).filter((h) => /^\w+$/.test(h)))].slice(0, 4);
    }
    function postPayload(article) {
      const texts = [...article.querySelectorAll('[data-testid="tweetText"]')].map(textOf);
      const card = article.querySelector('[data-testid="card.wrapper"]');
      const cardText = card ? textOf(card).split("\n").filter((l) => l.length > 12 && !/^\S+\.\S+$/.test(l)).join(". ") : "";
      const handle = handleOf(article);
      const nameEl = article.querySelector('[data-testid="User-Name"] a[href^="/"] span');
      const authorName = nameEl ? textOf(nameEl).slice(0, 60) : "";
      const replyTo = replyHandles(article);
      const all = [...document.querySelectorAll('article[data-testid="tweet"]')];
      const prev = all[all.indexOf(article) - 1];
      const prevHandle = prev ? handleOf(prev) : "";
      const parentEl = prev && replyTo.includes(prevHandle) ? prev.querySelector('[data-testid="tweetText"]') : null;
      const parent = parentEl ? textOf(parentEl) : "";
      const statusHref = article.querySelector('a[href*="/status/"] time')?.closest("a")?.getAttribute("href") || "";
      const url = /^\/\w+\/status\/\d+/.test(statusHref) ? `https://x.com${statusHref.match(/^\/\w+\/status\/\d+/)[0]}` : "";
      const images = [...article.querySelectorAll('[data-testid="tweetPhoto"] img, [data-testid="card.wrapper"] img')].map((img) => img.src).filter((src) => /^https:\/\/pbs\.twimg\.com\/(media|card_img|amplify_video_thumb|ext_tw_video_thumb)\//.test(src)).slice(0, 2);
      const hasVideo = !!article.querySelector('[data-testid="videoPlayer"], [data-testid="videoComponent"], video');
      const poster = article.querySelector("video[poster]")?.getAttribute("poster");
      if (hasVideo && poster && /^https:\/\/pbs\.twimg\.com\//.test(poster) && !images.includes(poster)) images.unshift(poster);
      const post = {
        text: texts[0] || "",
        quoted: texts.slice(1).join("\n"),
        card: cardText,
        author: handle,
        authorName,
        replyTo,
        parent: parent.slice(0, 1500),
        parentAuthor: parent ? prevHandle : "",
        url,
        images: images.slice(0, 2),
        hasVideo
      };
      const label = (post.text || post.quoted || post.card || (hasVideo ? "Video post" : images.length ? "Image post" : "")).replace(/\s+/g, " ").slice(0, 90);
      const kind = handle ? `@${handle}${replyTo.length ? ` \u2192 @${replyTo[0]}` : ""}` : "Post";
      return { post, source: { kind, label } };
    }
    function trendPayload(cell) {
      const lines = textOf(cell).split("\n").map((l) => l.trim()).filter(Boolean);
      const main = lines.filter((l) => !/(^\d[\d.,]*[KM]?\s+posts?$)|trending|^·$|^\d+$|only on x|^show more$/i.test(l)).sort((a, b) => b.length - a.length)[0] || lines[0] || "";
      return { post: { text: `Trending on X: ${main}` }, text: main, source: { kind: "Trend", label: main } };
    }
    function sidebarTrends() {
      return [...document.querySelectorAll('[data-testid="trend"]')].slice(0, 8).map((c) => trendPayload(c).text).filter((t) => t && t.length < 60);
    }
    async function launch(payload) {
      dismissHint();
      const r = await getRadar();
      r.open({ ...payload, trends: sidebarTrends() });
    }
    let routeToast = null;
    function toast(message) {
      if (!routeToast) {
        routeToast = document.createElement("div");
        routeToast.setAttribute("role", "status");
        routeToast.setAttribute("aria-live", "polite");
        routeToast.style.cssText = "position:fixed;right:24px;bottom:210px;z-index:2147483647;padding:12px 16px;border:1px solid rgba(255,255,255,.16);border-radius:12px;background:#171717;color:#fff;font:600 13px/1.4 system-ui,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,.35);max-width:300px";
        document.documentElement.appendChild(routeToast);
      }
      routeToast.textContent = message;
      routeToast.style.display = "block";
      clearTimeout(routeToast.hideTimer);
      routeToast.hideTimer = setTimeout(() => {
        if (routeToast) routeToast.style.display = "none";
      }, 4200);
    }
    let routing = false;
    async function reroute(payload) {
      dismissHint();
      if (routing) return;
      routing = true;
      toast("Checking the coins on this post\u2026");
      try {
        const r = await getRadar();
        const result = await r.route(payload.post);
        toast(`Opening $${result.symbol} \xB7 ${result.reason}${result.holders ? ` \xB7 ${result.holders.toLocaleString("en-US")} holders` : ""}`);
      } catch (error) {
        toast(`${error.message}. Opening Radar\u2026`);
        await launch(payload);
      } finally {
        routing = false;
      }
    }
    function makeBtn(cls, label, onClick, onHover) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `nr-btn ${cls}`;
      b.title = label;
      b.setAttribute("aria-label", label);
      b.innerHTML = ICON;
      b.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }, true);
      if (onHover) {
        let timer = null;
        b.addEventListener("pointerenter", () => {
          if (!b.dataset.pre) timer = setTimeout(() => {
            b.dataset.pre = "1";
            onHover();
          }, 300);
        });
        b.addEventListener("pointerleave", () => clearTimeout(timer));
      }
      return b;
    }
    function makeRerouteBtn(onClick, onHover) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "nr-reroute-btn";
      b.textContent = "Instant Reroute";
      b.title = "Open the biggest coin on this post with real holders and no rug flags";
      b.setAttribute("aria-label", "Instant Reroute");
      b.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }, true);
      if (onHover) {
        let timer = null;
        b.addEventListener("pointerenter", () => {
          if (!b.dataset.pre) timer = setTimeout(() => {
            b.dataset.pre = "1";
            onHover();
          }, 300);
        });
        b.addEventListener("pointerleave", () => clearTimeout(timer));
      }
      return b;
    }
    const CA_RE = /\b(?:[1-9A-HJ-NP-Za-km-z]{32,44}|0x[a-fA-F0-9]{40})\b/;
    const postText = (article) => [...article.querySelectorAll('[data-testid="tweetText"]')].map(textOf).join("\n");
    const caWatch = new IntersectionObserver((entries) => {
      for (const { target, isIntersecting } of entries) {
        if (!isIntersecting) continue;
        caWatch.unobserve(target);
        caLine(target);
      }
    }, { rootMargin: "300px 0px" });
    async function caLine(article) {
      const coins = await send2({ type: "mentioned", text: postText(article) }).catch(() => []);
      const groups = article.querySelectorAll('[role="group"]');
      const group = groups[groups.length - 1];
      if (!coins.length || !group || article.querySelector(".nr-ca")) return;
      const line = document.createElement("div");
      line.className = "nr-ca";
      line.style.color = getComputedStyle(article.querySelector('[data-testid="tweetText"]') || article).color;
      line.innerHTML = coins.slice(0, 2).map((t) => `<button type="button" class="nr-ca-btn" title="Open ${esc3(t.name)} in Radar">${ICON}$${esc3(t.symbol)}<span>${[usd2(t.marketCap), ageOf(t.createdAt)].filter(Boolean).join(" \xB7 ")}</span></button>`).join("");
      line.addEventListener("click", (e) => {
        if (!e.target.closest(".nr-ca-btn")) return;
        e.preventDefault();
        e.stopPropagation();
        reroute(postPayload(article));
      }, true);
      group.parentElement.insertBefore(line, group);
    }
    const hint = { state: "unknown", el: null };
    host.get("hintSeen").then((seen) => {
      hint.state = seen ? "seen" : "show";
      decorateSoon();
    }).catch(() => {
      hint.state = "seen";
    });
    function dismissHint() {
      if (hint.state === "seen") return;
      hint.state = "seen";
      hint.el?.remove();
      Promise.resolve(host.set("hintSeen", true)).catch(() => {
      });
    }
    function maybeHint(wrap) {
      if (hint.state !== "show" || hint.el?.isConnected) return;
      const r = wrap.getBoundingClientRect();
      if (r.top < 120 || r.bottom > innerHeight - 40) return;
      const el = document.createElement("div");
      el.className = "nr-hint";
      el.innerHTML = '<span>Tap to see the coins behind this post</span><button type="button">Got it</button>';
      el.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        dismissHint();
      }, true);
      wrap.appendChild(el);
      hint.el = el;
    }
    function decorate() {
      for (const article of document.querySelectorAll('article[data-testid="tweet"]:not([data-nr])')) {
        const groups = article.querySelectorAll('[role="group"]');
        const group = groups[groups.length - 1];
        if (!group) continue;
        article.dataset.nr = "1";
        const btn = makeBtn(
          "",
          "Open Radar for this post",
          () => launch(postPayload(article)),
          () => getRadar().then((r) => r.prefetch(postPayload(article).post)).catch(() => {
          })
        );
        const rerouteBtn = makeRerouteBtn(
          () => reroute(postPayload(article)),
          () => getRadar().then((r) => r.prefetch(postPayload(article).post)).catch(() => {
          })
        );
        const wrap = document.createElement("div");
        wrap.className = "nr-action-wrap";
        wrap.appendChild(rerouteBtn);
        wrap.appendChild(btn);
        const share = group.lastElementChild;
        group.insertBefore(wrap, share);
        if (CA_RE.test(postText(article))) caWatch.observe(article);
      }
      if (hint.state === "show" && !hint.el?.isConnected) {
        for (const b of document.querySelectorAll('article[data-testid="tweet"] .nr-btn')) {
          maybeHint(b.parentElement);
          if (hint.el?.isConnected) break;
        }
      }
      for (const cell of document.querySelectorAll('[data-testid="trend"]:not([data-nr])')) {
        cell.dataset.nr = "1";
        cell.appendChild(makeBtn("nr-trend", "Jump to the biggest verified coin for this trend", () => reroute(trendPayload(cell))));
      }
      if (/^\/i\/trending\/\d+/.test(location.pathname) && !document.querySelector(".nr-story")) {
        const h = document.querySelector('[data-testid="primaryColumn"] h2, [data-testid="primaryColumn"] [role="heading"]');
        if (h) fab.dataset.story = textOf(h);
      } else {
        delete fab.dataset.story;
      }
    }
    const fab = document.createElement("button");
    fab.className = "nr-fab";
    fab.innerHTML = ICON;
    fab.title = "Radar";
    fab.setAttribute("aria-label", "Radar");
    fab.addEventListener("click", () => toggle());
    document.documentElement.appendChild(fab);
    async function toggle() {
      const r = await getRadar();
      if (r.isOpen) return r.close();
      if (fab.dataset.story) return launch({ post: { text: `X news story: ${fab.dataset.story}` }, source: { kind: "Story", label: fab.dataset.story } });
      r.open({ trends: sidebarTrends() });
    }
    document.addEventListener("keydown", (e) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyR") {
        const t = e.target;
        if (t?.isContentEditable || /INPUT|TEXTAREA/.test(t?.tagName)) return;
        e.preventDefault();
        toggle();
      }
    });
    let queued = false;
    function decorateSoon() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        decorate();
      });
    }
    new MutationObserver(decorateSoon).observe(document.body, { childList: true, subtree: true });
    addEventListener("scroll", () => {
      if (hint.state === "show" && !hint.el?.isConnected) decorateSoon();
    }, { passive: true });
    decorate();
    if (!globalThis.__nrHost && ext2?.storage?.onChanged) {
      let showAlert = function(item) {
        const c = item.coin;
        if (!stack?.isConnected) {
          stack = document.createElement("div");
          stack.className = "nr-alerts";
        }
        document.documentElement.appendChild(stack);
        while (stack.childElementCount >= 3) stack.firstElementChild.remove();
        const quick = /^https:\/\/tryradar\.fun\/trade\?/.test(item.buy || "");
        const sol = instaSol2();
        const larp = item.larp ? `<div><i class="${toneOf(item.larp.word)}"></i>${item.larp.by === "Larpcheck" ? "Larpcheck" : "Larp check"}: <b>${esc3(item.larp.word)}${item.larp.score != null ? ` ${esc3(item.larp.score)}` : ""}</b></div>` : "<div><i></i>Larp check: not ready yet</div>";
        const holders = item.holders ? `<div><i class="${item.holders.ok ? "ok" : "risk"}"></i>${esc3(item.holders.text)}</div>` : "";
        const card = document.createElement("div");
        card.className = "nr-alert";
        card.setAttribute("role", "alert");
        card.innerHTML = `<div class="nr-alert-top">${BELL}<span>${item.kind === "verdict" ? `Larpcheck now says ${esc3(item.larp.word)}` : `New coin off ${item.watch.author ? `@${esc3(item.watch.author)}'s` : "a watched"} post`}</span><button type="button" class="nr-alert-x" data-x aria-label="Close">\xD7</button></div>
        <div class="nr-alert-coin"><b>$${esc3(String(c.symbol || "").trim())}</b><span>${esc3(c.name || "")}</span></div>
        <div class="nr-alert-meta">${esc3([CHAIN[c.chain] || c.chain, c.marketCap ? `${usd2(c.marketCap)} MC` : "", c.createdAt ? `launched ${ageOf(c.createdAt)} ago` : ""].filter(Boolean).join(" \xB7 "))}</div>
        <div class="nr-alert-checks">${larp}${holders}</div>
        <div class="nr-alert-acts">
          ${item.buy ? `<button type="button" class="buy" data-buy>${quick ? `Insta buy \xB7 ${sol} SOL` : "Trade on Uniswap"}</button>` : ""}
          <button type="button" data-open>Open in Radar</button><button type="button" data-chart>Chart</button>
        </div>`;
        card.addEventListener("click", (e) => {
          const b = e.target.closest("button");
          if (!b) return;
          e.preventDefault();
          e.stopPropagation();
          if ("x" in b.dataset) {
            card.remove();
            return;
          }
          if ("buy" in b.dataset) {
            if (quick) safeOpen(`${item.buy}&sol=${sol}&insta=1`, "radar-insta", "popup=yes,width=440,height=780");
            else safeOpen(item.buy, "_blank", "noopener");
          } else if ("chart" in b.dataset) safeOpen(item.chart, "_blank", "noopener");
          else if ("open" in b.dataset) {
            card.remove();
            launch({ post: { text: item.watch.url }, source: { kind: "Alert", label: `$${String(c.symbol || "").trim()} launched off this post` } });
          }
        }, true);
        stack.appendChild(card);
      };
      let shownAt = Date.now();
      let stack = null;
      const BELL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 1112 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 003.4 0"/></svg>';
      const CHAIN = { solana: "Solana", robinhood: "Robinhood Chain", base: "Base", bsc: "BNB Chain" };
      const toneOf = (w) => ["LIKELY LARP", "LARP"].includes(w) ? "risk" : ["REAL", "LIKELY REAL"].includes(w) ? "ok" : "mid";
      const instaSol2 = () => {
        try {
          const v = localStorage.getItem("nr:insta-sol");
          return ["0.05", "0.1", "0.25", "0.5", "1"].includes(v) ? v : "0.1";
        } catch {
          return "0.1";
        }
      };
      const safeOpen = (url, ...rest) => {
        if (/^https:\/\/(tryradar\.fun|app\.uniswap\.org|dexscreener\.com)\//.test(url)) window.open(url, ...rest);
      };
      ext2.storage.onChanged.addListener((changes, area) => {
        if (area !== "local" || !changes.alerts) return;
        const fresh = (changes.alerts.newValue?.feed || []).filter((f) => f.at > shownAt);
        if (!fresh.length) return;
        shownAt = Math.max(...fresh.map((f) => f.at));
        for (const item of fresh.slice(0, 3).reverse()) showAlert(item);
      });
    }
    if (!globalThis.__nrHost) ext2.runtime.onMessage.addListener((msg) => {
      if (msg?.type === "open-radar") launch({ post: { text: msg.text || "" }, keywords: msg.keywords, source: msg.source });
    });
  })();
})();
