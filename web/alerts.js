// Radar 1.7.92 alerts page, built from webapp/alerts.js: https://github.com/Radardotfun/radar
(() => {
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
  var norm = (s) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]/gu, "");
  function extractKeywords(text, max = 6, { strongOnly = false } = {}) {
    if (!text) return [];
    const scores = /* @__PURE__ */ new Map();
    const add = (term, w, strong2 = true) => {
      const key2 = norm(term);
      if (key2.length < 2 || STOP.has(key2) || FILLER.has(key2)) return;
      const prev = scores.get(key2);
      scores.set(key2, { term: prev?.term || term, w: (prev?.w || 0) + w, strong: strong2 || !!prev?.strong });
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
        const lower2 = w.toLowerCase();
        if (!w || STOP.has(lower2) || FILLER.has(lower2) || /^\d+%?$/.test(w)) {
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
        if (lower2.length >= 5) add(lower2, 0.8, false);
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
    if (!report) return "no holder report";
    if (report.source === "larpcheck") {
      if (!report.authorityKnown) return "mint and freeze authority unknown";
      if (report.freezeAuthority) return "freeze authority is on";
      if (report.mintAuthority) return "mint authority is on";
      if (!report.ok) return report.line ? `Larpcheck: ${report.line}` : "Larpcheck's holder check didn't pass";
      if (report.holders == null) return "holder count unknown";
      if (report.holders < rules.minHolders) return `only ${report.holders} holders`;
      if ((report.top10Pct || 0) > rules.maxTop10) return `top 10 hold ${pct(report.top10Pct)}`;
      return null;
    }
    if (report.rugged) return "liquidity pulled";
    if (report.freezeAuthority) return "freeze authority is on";
    if (report.mintAuthority) return "mint authority is on";
    const danger = (report.risks || []).find((r) => /danger|critical|high/i.test(r.level || ""));
    if (danger) return `RugCheck flags ${String(danger.name || "a danger").toLowerCase().replace(/\blp\b/g, "LP")}`;
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
    "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB",
    // USD1
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
  var REAL_QUOTES = /* @__PURE__ */ new Set([...QUOTES, "t9bnCGiZVUYsRKvx4d5dPcoDCSyuBM9C33ZNGNULARP"]);
  var LAUNCHPADS = /* @__PURE__ */ new Set(["pumpfun", "launchlab", "meteoradbc", "moonshot", "boop", "heaven", "believe", "bags", "moonit", "jupstudio", "flapsh", "fourmeme"]);
  async function getJson(url) {
    for (let i = 0; i < 4; i++) {
      const res = await fetch(url, { signal: AbortSignal.timeout(8e3) });
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
    if (!REAL_QUOTES.has(quoteKey(p.quoteToken?.address))) return 0;
    const quoteUsd = n(p.liquidity?.quote) * (n(p.priceNative) ? n(p.priceUsd) / n(p.priceNative) : 0);
    return Math.min(n(p.liquidity?.usd), 2 * quoteUsd);
  }
  function aggregate(pairs) {
    const byToken = /* @__PURE__ */ new Map();
    for (const p of pairs) {
      if (!p?.baseToken?.address || QUOTES.has(quoteKey(p.baseToken.address))) continue;
      const key2 = `${p.chainId}:${p.baseToken.address}`;
      if (!byToken.has(key2)) byToken.set(key2, []);
      const list = byToken.get(key2);
      if (!list.some((q) => q.pairAddress === p.pairAddress)) list.push(p);
    }
    const tokens = [];
    for (const list of byToken.values()) {
      let primary = [...list].sort((a, b) => n(b.liquidity?.usd) - n(a.liquidity?.usd) || n(b.volume?.h24) - n(a.volume?.h24))[0];
      const curve = list.filter((p) => LAUNCHPADS.has(p.dexId) && n(p.marketCap) > 0 && n(p.txns?.h1?.buys) + n(p.txns?.h1?.sells) > 0).sort((a, b) => n(b.volume?.h24) - n(a.volume?.h24))[0];
      if (curve && !LAUNCHPADS.has(primary.dexId) && realLiquidity(primary) < 1e3) primary = curve;
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
    const sym2 = norm(token.symbol || "");
    const name = norm(token.name || "");
    const words = new Set(`${token.name} ${token.symbol}`.split(/[^\p{L}\p{N}]+/u).map(norm).filter(Boolean));
    let score = 0;
    const matched = [];
    keywords.forEach((kw, i) => {
      const k = norm(kw);
      if (k.length < 2) return;
      const w = 1 / (1 + i * 0.25);
      let hit = 0;
      if (sym2 === k || name === k) hit = 4;
      else if (words.has(k)) hit = 2.5;
      else if (k.length >= 5 && (sym2.includes(k) || name.includes(k))) hit = 2;
      else if (kw.includes(" ")) {
        const parts = kw.split(/\s+/).map(norm).filter((p) => p.length >= 3);
        if (parts.length && parts.every((p) => name.includes(p) || sym2.includes(p))) hit = 3;
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
  var ogExists = (t) => alive(t) || t.liquidity >= 3e3 && Date.now() - t.createdAt > 30 * 864e5;
  var sameName = (a, b) => String(a.symbol).toLowerCase() === String(b.symbol).toLowerCase() || String(a.name).length >= 3 && String(a.name).toLowerCase() === String(b.name).toLowerCase();
  var olderTwinOf = (t, pool = []) => t?.createdAt ? pool.filter((x) => x?.createdAt && x.chain === t.chain && x.address !== t.address && x.createdAt < t.createdAt && sameName(x, t) && ogExists(x)).sort((a, b) => a.createdAt - b.createdAt)[0] || null : null;
  var DUST_CAP = 5e3;
  function isDust(t, now = Date.now()) {
    if (t.keepSmall || (t.marketCap || 0) >= DUST_CAP) return false;
    const trades = (t.txns?.h1?.buys || 0) + (t.txns?.h1?.sells || 0);
    return trades < 5 || !t.createdAt || now - t.createdAt > 36e5;
  }
  function pickThree(tokens, { cuts = [0.3, 0.15, 0], allowFallback = true } = {}) {
    const maxRel = Math.max(0, ...tokens.map((t) => t.relevance || 0));
    let live2 = [];
    let cutUsed = 0;
    for (const cut of cuts) {
      cutUsed = cut;
      live2 = tokens.filter((t) => (t.relevance || 0) >= maxRel * cut && alive(t) && !isDust(t));
      if (live2.length >= 3) break;
    }
    if (!live2.length && allowFallback) live2 = tokens.filter((t) => t.volume.h24 > 0 && !isDust(t));
    const used = /* @__PURE__ */ new Set();
    const take = (t, role) => {
      if (t) used.add(t.address);
      return t ? { role, token: t } : null;
    };
    const top = [...live2].filter((t) => t.mcapBacked).sort((a, b) => b.marketCap - a.marketCap)[0];
    const picks = [take(top, "top")];
    const oldest = tokens.filter((t) => t.createdAt && (t.relevance || 0) >= maxRel * cutUsed && ogExists(t)).sort((a, b) => a.createdAt - b.createdAt)[0];
    const og = oldest?.olderTwin === true ? null : oldest?.olderTwin ? { ...oldest.olderTwin, relevance: oldest.relevance } : oldest;
    picks.push(og && !used.has(og.address) ? take(og, "og") : null);
    const momentum = (t) => {
      const ch = n(t.priceChange.h1 ?? t.priceChange.h6);
      const flow = Math.log10(10 + t.volume.h1);
      const buyRatio = (t.txns.h1.buys + 1) / (t.txns.h1.sells + 1);
      return ch * flow * Math.min(buyRatio, 3);
    };
    const movers = live2.filter((t) => !used.has(t.address) && t.volume.h1 >= 1e3);
    const mover = (movers.length ? movers : live2.filter((t) => !used.has(t.address) && t.volume.h24 >= 250 && t.volume.h1 > 0)).sort((a, b) => momentum(b) - momentum(a) || b.volume.h24 - a.volume.h24)[0];
    picks.push(take(mover, "mover"));
    const best = {
      top: [...live2].filter((t) => t.mcapBacked).sort((a, b) => b.marketCap - a.marketCap)[0]?.address,
      og: og?.address,
      mover: live2.filter((t) => t.volume.h1 >= 1e3).sort((a, b) => momentum(b) - momentum(a))[0]?.address
    };
    const contest = tokens.length > 1;
    for (const p of picks) {
      if (!p) continue;
      p.alsoTop = contest && p.role !== "top" && best.top === p.token.address;
      p.alsoOg = contest && p.role !== "og" && best.og === p.token.address;
      p.alsoMover = contest && p.role !== "mover" && !picks.some((x) => x?.role === "mover") && best.mover === p.token.address && momentum(p.token) > 0;
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
    const links = [...new Set(String(text || "").match(LINKED_ELSEWHERE) || [])].slice(0, 3);
    let out = String(text || "");
    for (const link of links) {
      const [chain, address] = link.split(":");
      const symbol = await symbolOf(chain.toLowerCase(), address).catch(() => null);
      if (/^[A-Za-z][A-Za-z0-9]{0,11}$/.test(symbol || "")) out = out.split(link).join(`$${symbol}`);
    }
    return out;
  }
  async function linkedSymbol(chain, address) {
    const r = await fetch(`https://api.dexscreener.com/tokens/v1/${chain}/${address}`, { signal: AbortSignal.timeout(8e3) });
    const pairs = r.ok ? await r.json() : [];
    const key2 = address.toLowerCase();
    const pair = (Array.isArray(pairs) ? pairs : []).find((p) => [p.baseToken?.address, p.quoteToken?.address].some((a) => a?.toLowerCase() === key2));
    return pair ? (pair.baseToken.address.toLowerCase() === key2 ? pair.baseToken : pair.quoteToken).symbol : null;
  }
  async function mentionedTokens(text, chains, search = searchPairs) {
    const cas = [.../* @__PURE__ */ new Set([...text.match(SOL_CA) || [], ...text.match(EVM_CA) || []])].slice(0, 3);
    const found = await Promise.all(cas.map(async (ca) => {
      const key2 = ca.toLowerCase();
      const hit = aggregate(await search(ca).catch(() => [])).find((t) => t.address.toLowerCase() === key2 || t.pairAddresses?.some((p) => p.toLowerCase() === key2));
      if (!hit) return null;
      return aggregate(await allPairsMany([hit]).catch(() => [])).find((t) => t.address === hit.address && chains.includes(t.chain)) || null;
    }));
    return [...new Map(found.filter(Boolean).map((t) => [t.address, t])).values()];
  }

  // extension/src/lib/rugcheck.js
  var RC = "https://api.rugcheck.xyz/v1";
  async function standInReport(mint, holders, rpc) {
    const [lc, info] = await Promise.all([
      holders().catch(() => null),
      rpc("getAccountInfo", [mint, { encoding: "jsonParsed", commitment: "confirmed" }]).catch(() => null)
    ]);
    if (!lc?.ready) return null;
    const parsed = info?.value?.data?.parsed?.info;
    return {
      source: "larpcheck",
      page: lc.page,
      line: lc.line,
      ok: !!lc.ok,
      holdersAt: lc.at || null,
      authorityKnown: !!parsed,
      mintAuthority: parsed?.mintAuthority || null,
      freezeAuthority: parsed?.freezeAuthority || null,
      holders: lc.holders ?? null,
      top10Pct: lc.top10 ?? null,
      score: null,
      rugged: false,
      risks: [],
      topHolder: null,
      insiderWallets: 0,
      insiderPct: null,
      creator: null,
      creatorPct: null,
      lpLockedPct: null,
      poolTokens: null,
      supplyTokens: null,
      copycat: false,
      launchpad: null,
      tokenProgram: null,
      detectedAt: null
    };
  }
  async function rugReport(mint, pairAddresses = []) {
    const res = await fetch(`${RC}/tokens/${mint}/report`, { signal: AbortSignal.timeout(8e3) });
    if (res.status === 429) throw new Error("RugCheck rate limited");
    if (!res.ok) throw new Error(`RugCheck ${res.status}`);
    const r = await res.json();
    const supply = Number(r.token?.supply || 0);
    const pct2 = (raw) => supply ? Number(raw) / supply * 100 : 0;
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
      insiderPct: pct2(insiderHeld) <= 100 ? pct2(insiderHeld) : null,
      creator: r.creator || null,
      creatorPct: pct2(r.creatorBalance || 0),
      lpLockedPct: lpLocked,
      poolTokens: poolTokens || null,
      supplyTokens: supply ? supply / 10 ** decimals : null,
      copycat: (r.risks || []).some((x) => /copycat/i.test(x.name || "")),
      launchpad: r.launchpad?.name || null,
      tokenProgram: r.tokenProgram,
      detectedAt: r.detectedAt || null
    };
  }

  // extension/src/lib/bio.js
  var SOL_CA2 = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;
  var EVM_CAS = /\b0x[a-fA-F0-9]{40}\b/g;
  var sym = (t) => String(t?.symbol || "").replace(/^\$+/, "").toUpperCase();
  var lower = (s) => String(s || "").toLowerCase().trim();
  var key = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  var tickersIn = (text) => [...String(text || "").matchAll(/(?:^|[^\w$])\$([A-Za-z][A-Za-z0-9]{0,11})\b/g)].map((m) => m[1].toUpperCase());
  var VAGUE = new Set("the and for with coin coins token tokens meme memes crypto official new baby cat cats kitten kitty dog dogs puppy frog bird".split(" "));
  var telling = (s) => lower(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !VAGUE.has(w));
  function tiedToPost(t, words) {
    const whole = new Set(words.map(key).filter((k) => k.length >= 2));
    if (whole.has(key(t.symbol)) || whole.has(key(t.name))) return true;
    const used = new Set(words.flatMap(telling));
    return [...telling(t.symbol), ...telling(t.name)].some((w) => used.has(w));
  }
  var CHAIN_WORDS = [["robinhood", /\brobinhood\s*chain\b/i], ["base", /\bbase\s+chain\b/i], ["bsc", /\bbnb\s+chain\b|\bbsc\b/i], ["solana", /\bsolana\s+chain\b/i]];
  function chainInPost(text) {
    const said = CHAIN_WORDS.filter(([, re]) => re.test(String(text || ""))).map(([c]) => c);
    return said.length === 1 && said[0] !== "solana" ? said[0] : null;
  }
  function bioCas(post) {
    return [.../* @__PURE__ */ new Set([...String(post?.bio || "").match(SOL_CA2) || [], ...String(post?.bio || "").match(EVM_CAS) || []])].slice(0, 2);
  }
  function tiedToBio(t, post, words, typed = []) {
    if (!t?.address) return false;
    if (typed.length && !typed.includes(sym(t))) return false;
    if (typed.includes(sym(t)) || tiedToPost(t, words)) return true;
    const handle = key(post?.author);
    if (!handle) return false;
    const links = [...(t.socials || []).map((s) => s?.url || s), ...t.links || []].map((u) => String(u || "").toLowerCase());
    if (links.some((u) => new RegExp(`(^|//)(www\\.)?(x|twitter)\\.com/${handle}([/?#]|$)`, "i").test(u))) return true;
    const own = key(t.symbol).length >= 3 && handle.includes(key(t.symbol));
    return own || key(t.name).length >= 4 && handle.includes(key(t.name));
  }

  // extension/src/lib/narrative.js
  var passthrough = (_k, _ttl, fn) => fn();
  async function engine(apiBase, path, body, timeoutMs = 15e3) {
    const res = await fetch(`${apiBase}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Narrative engine ${res.status}`);
    return data;
  }
  async function inBatches(items2, size, fn) {
    const out = new Array(items2.length);
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(size, items2.length) }, async () => {
      while (i < items2.length) {
        const k = i++;
        out[k] = await fn(items2[k]);
      }
    }));
    return out;
  }
  var fmtUsd = (n2) => n2 >= 99995e4 ? `$${(n2 / 1e9).toFixed(1)}B` : n2 >= 999500 ? `$${(n2 / 1e6).toFixed(1)}M` : n2 >= 1e3 ? `$${(n2 / 1e3).toFixed(0)}K` : `$${Math.round(n2)}`;
  var fmtAge = (ms) => {
    if (!ms) return "?";
    const h = (Date.now() - ms) / 36e5;
    return h < 1 ? `${Math.round(h * 60)}m` : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`;
  };
  var postText = (post) => [post.text, post.quoted, post.card, post.parent].filter(Boolean).join("\n");
  function postCoins(post, chains, cached = passthrough) {
    const text = postText(post);
    return cached(`pc:${chains}:${text}`, 6e4, () => mentionedTokens(text, chains, (q) => cached(`q:${q}`, 2e4, () => searchPairs(q))));
  }
  async function bioTokens(post, chains, apiBase, cached) {
    if (post.skipBio) return [];
    const bio = post.bio ?? await (post.url ? cached(`bio:${post.url}`, 36e5, async () => {
      const res = await fetch(`${apiBase}/tweet?url=${encodeURIComponent(post.url)}`, { signal: AbortSignal.timeout(8e3) });
      return res.ok ? (await res.json()).post?.bio || "" : "";
    }).catch(() => "") : "");
    const found = await Promise.all(bioCas({ bio }).map((ca) => mentionedTokens(ca, chains, (q) => cached(`q:${q}`, 2e4, () => searchPairs(q))).then(([t]) => t).catch(() => null)));
    return found.filter(Boolean);
  }
  function tiedBioCoin(tokens, post, read, fullText) {
    const typed = tickersIn(fullText);
    const words = [...read.anchors || [], ...read.terms || [], ...fullText.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3)];
    return tokens.filter((t) => ((t.marketCap || 0) >= 1e3 || typed.includes(sym(t))) && tiedToBio(t, post, words, typed)).slice(0, 1);
  }
  var SPEECH_WAIT_MS = 2e3;
  async function readPost(post, chains, { apiBase, cached = passthrough }) {
    const fullText = postText(post);
    for (const k of extractKeywords(fullText.replace(SOL_CA, " ").replace(EVM_CA, " "), 3, { strongOnly: true })) {
      cached(`q:${k.toLowerCase()}`, 3e5, () => searchPairs(k)).catch(() => {
      });
    }
    const speech = post.videoUrl && !post.gif ? cached(`tr:${post.videoUrl}`, 36e5, () => engine(apiBase, "transcribe", { videoUrl: post.videoUrl })).then((r) => r.text).catch(() => "") : "";
    const bioLookup = bioTokens(post, chains, apiBase, cached);
    const [inPost, transcript, videoNotes] = await Promise.all([
      postCoins(post, chains, cached),
      post.quickRead ? Promise.race([speech, new Promise((resolve) => setTimeout(() => resolve(null), SPEECH_WAIT_MS))]) : speech,
      // The bot can't draw frames as the panel does, so the engine watches the video or GIF for it.
      post.videoUrl && post.watchVideo ? cached(`wv:${post.videoUrl}`, 36e5, () => engine(apiBase, "watch", { videoUrl: post.videoUrl }, 5e4)).then((r) => r.text || "").catch(() => "") : ""
    ]);
    const mentioned = [...inPost];
    const full = { ...post, ...transcript ? { transcript } : {}, ...videoNotes ? { videoNotes } : {} };
    const named = mentioned.map((t) => `${t.name} ($${t.symbol})`).join(", ");
    let read;
    try {
      read = await engine(apiBase, "interpret", { post: named ? { ...full, text: `${full.text || ""}
[Coin in this post: ${named}]` } : full }, 35e3);
    } catch (e) {
      if (!mentioned.length) throw e;
      return { narrative: "", engineError: e.message, coinable: true, terms: [], anchors: [], judge: false, mentioned, tickers: [], post: full };
    }
    const seen2 = new Set(mentioned.map((t) => t.address.toLowerCase()));
    const fromImages = (read.cas || []).filter((a) => !seen2.has(a.toLowerCase()));
    if (fromImages.length) {
      mentioned.push(...await mentionedTokens(fromImages.join(" "), chains, (q) => cached(`q:${q}`, 2e4, () => searchPairs(q))).catch(() => []));
    }
    const fromBio = mentioned.length ? [] : tiedBioCoin(await bioLookup, post, read, fullText);
    return { speechPending: transcript === null, narrative: read.narrative, coinable: read.coinable, terms: read.terms || [], anchors: read.anchors || [], judge: read.judge !== false && !read.anchors?.length, mentioned, bioCoins: fromBio, tickers: read.tickers || [], post: full };
  }
  function anchorHits(t, anchors) {
    const name = norm(t.name || "");
    const sym2 = norm(t.symbol || "");
    const words = new Set(`${t.name} ${t.symbol}`.split(/[^\p{L}\p{N}]+/u).map(norm).filter(Boolean));
    return anchors.filter((a) => {
      const k = norm(a);
      if (!k) return false;
      return k.length <= 4 ? words.has(k) || sym2 === k : name.includes(k) || sym2.includes(k);
    }).length;
  }
  var TECH_CUES = /\b(?:technology|tech|software|hardware|application|app|platform|tool|open[- ]?source|github|repository|repo|developer|coding|code|artificial intelligence|ai|large language model|llm|model|agent|robot(?:ics)?|gpu|chip|semiconductor|compute|computing|protocol|framework|library|browser|operating system|cloud|saas|api)\b/i;
  function findTechMatch(tokens, mentioned, anchors, scores, narrative, post) {
    const context = [narrative, post?.text, post?.quoted, post?.card, post?.parent, post?.transcript, post?.videoNotes].filter(Boolean).join(" ");
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
  async function findCoins({ narrative, coinable, terms, anchors = [], judge = true, mentioned, bioCoins: fromBio = [], tickers = [], post, engineError }, chains, { apiBase, cached = passthrough }) {
    const t0 = Date.now();
    const timing = {};
    const lap = (k) => {
      timing[k] = Date.now() - t0;
    };
    const base = { mode: "ai", narrative, coinable, mentioned, bioCoins: fromBio, tickers, anchors, terms, engineError, ts: Date.now(), timing, techMatch: null };
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
      const verdicts = await Promise.all(halves.map((part) => engine(apiBase, "judge", { narrative, post, candidates: part.map(brief) }, 9e3).then((v) => v.matches.map((m) => ({ ...m, t: part[m.i]?.t }))).catch(() => {
        base.judgeFailed = true;
        return part.filter((c) => c.r >= 3).slice(0, 5).map((c) => ({ t: c.t, score: Math.min(85, 55 + c.r * 4), guessed: true }));
      })));
      lap("judge");
      scores = new Map(verdicts.flat().filter((m) => m.t).map((m) => [m.t.address, { score: m.score, reason: "", guessed: !!m.guessed }]));
    }
    for (const { t } of candidates) if (t.fromPost) scores.set(t.address, { score: 99, reason: "Launched with this post as its link" });
    const pool = candidates.map((c) => c.t);
    if (!scores.size) return { ...base, picks: [], others: [], pool, techMatch: findTechMatch([], mentioned, anchors, scores, narrative, post) };
    const refs = candidates.map((c) => c.t).filter((t) => scores.has(t.address));
    const fromPost = new Set(refs.filter((t) => t.fromPost).map((t) => t.address));
    let tokens = await Promise.race([
      fullTokens(refs, new Set(refs.slice(0, 6).map((t) => t.address))),
      new Promise((resolve) => setTimeout(() => resolve(refs), 5e3))
      // keep search data if pool lookups stall
    ]).catch(() => refs);
    const gotPools = new Set(tokens.map((t) => t.address));
    tokens = [...tokens, ...refs.filter((t) => !gotPools.has(t.address))];
    lap("pools");
    tokens = tokens.filter((t) => scores.has(t.address)).map((t) => ({
      ...t,
      relevance: scores.get(t.address).score,
      reason: scores.get(t.address).reason,
      fromPost: fromPost.has(t.address),
      guessed: !!scores.get(t.address).guessed
    }));
    const onlyChain = chainInPost(post?.text);
    if (onlyChain && chains.includes(onlyChain)) tokens = tokens.filter((t) => t.chain === onlyChain || t.fromPost);
    const twins = onlyChain && chains.includes(onlyChain) ? pool.filter((t) => t.chain === onlyChain) : pool;
    tokens = tokens.map((t) => ({ ...t, olderTwin: olderTwinOf(t, twins) || mentioned.some((m) => m.createdAt && t.createdAt && m.createdAt < t.createdAt) }));
    const namedSyms = new Set(mentioned.map((m) => norm(m.symbol || "")).filter(Boolean));
    const namedCap = Math.max(0, ...mentioned.map((m) => m.marketCap || 0));
    const isCopy = (t) => namedSyms.has(norm(t.symbol || "")) && (t.marketCap || 0) < namedCap;
    const contenders = tokens.filter((t) => !isCopy(t));
    const ranked = pickThree(contenders, { cuts: [0.85, 0.7, 0], allowFallback: false });
    const { roleCandidates, roleCut } = ranked;
    const picks = ranked.picks.filter((p) => !(p?.role === "top" && (p.token.marketCap || 0) < namedCap));
    const dropped = ranked.picks.filter((p) => p && !picks.includes(p)).map((p) => p.token);
    const others = [...ranked.others, ...dropped, ...tokens.filter(isCopy)];
    const techMatch = findTechMatch(tokens, mentioned, anchors, scores, narrative, post);
    const remaining = techMatch ? others.filter((t) => t.address !== techMatch.address) : others;
    return { ...base, picks, others: remaining, roleCandidates, roleCut, techMatch, pool };
  }

  // extension/src/lib/alerts.js
  var WATCH_MS = 24 * 36e5;
  var EARLY_MS = 10 * 6e4;
  var FOLLOW_MS = 3 * 24 * 36e5;
  var shortest = (k) => /^[\x00-\x7f]*$/.test(k) ? 3 : 2;
  function tieOf(t, watch) {
    if (watch.id && (t.links || []).some((l) => String(l).includes(`/status/${watch.id}`))) return "post";
    const name = norm(t.name || "");
    const sym2 = norm(t.symbol || "");
    const words = new Set(`${t.name} ${t.symbol}`.split(/[^\p{L}\p{N}]+/u).map(norm).filter(Boolean));
    for (const a of watch.anchors || []) {
      const k = norm(String(a));
      if (k.length < shortest(k)) continue;
      if (sym2 === k || name === k || words.has(k) || k.length >= 5 && (name.includes(k) || sym2.includes(k))) return "name";
    }
    return null;
  }
  var ROLE_LABEL = { top: "Top", og: "OG", mover: "Mover" };
  function signalCoins(found) {
    const list = [...(found?.mentioned || []).map((token) => ({ token, label: "In the post" })), ...(found?.picks || []).filter(Boolean).map((p) => ({ token: p.token, label: ROLE_LABEL[p.role] || "" }))];
    const seen2 = /* @__PURE__ */ new Set();
    return list.filter(({ token }) => token?.address && !seen2.has(token.address) && seen2.add(token.address)).slice(0, 3).map(({ token, label }) => ({ address: token.address, symbol: String(token.symbol || "").trim(), chain: token.chain, marketCap: token.marketCap || 0, label }));
  }

  // extension/src/lib/fresh.js
  var BADGE_MS = 6 * 36e5;
  var NEW_TAB_MS = 24 * 36e5;
  var MIN_TRADES = 3;
  var MIN_CAP = 1e3;
  var COPY_WINDOW_MS = 7 * 864e5;
  var BIG_CAP = 1e5;
  var BIG_LIQUIDITY = 2e4;
  function keepBest(list, n2 = 12) {
    if (list.length <= n2) return list;
    const cap = (t) => t.mcapBacked === false ? 0 : t.marketCap || 0;
    const firsts = list.filter((t) => !t.copyOf);
    const copies = list.filter((t) => t.copyOf).sort((a, b) => cap(b) - cap(a)).slice(0, Math.max(0, n2 - firsts.length));
    const keep = /* @__PURE__ */ new Set([...firsts.slice(0, n2), ...copies]);
    return list.filter((t) => keep.has(t));
  }
  var postWords = (text) => extractKeywords(String(text || ""), 3, { strongOnly: true }).filter((w) => norm(w).length >= shortest(norm(w)));
  var tradesIn = (t, w) => (t.txns?.[w]?.buys || 0) + (t.txns?.[w]?.sells || 0);
  var trading = (t, hot) => {
    if (t.marketCap > 0 && t.marketCap < MIN_CAP) return false;
    if (!t.onCurve && (t.liquidity || 0) < 1e3) return false;
    return tradesIn(t, "h1") >= MIN_TRADES || !hot && tradesIn(t, "h24") >= 20;
  };
  var sameName2 = (a, b) => {
    const sym2 = norm(a.symbol || ""), name = norm(a.name || "");
    return sym2 && sym2 === norm(b.symbol || "") || name && name === norm(b.name || "");
  };
  function storyWords(words, author, text = "") {
    const who = norm(author || "");
    const said = norm(text);
    if (who.length < 3) return words;
    const kept = words.filter((w) => {
      const k = norm(w);
      return k.length < 3 || !who.includes(k) || said.includes(k);
    });
    return kept.length ? kept : words;
  }
  function freshPairs(tokens, words, { chains = null, now = Date.now(), maxAge = NEW_TAB_MS, hot = false } = {}) {
    const list = [...new Map((tokens || []).filter((t) => t?.address).map((t) => [t.address, t])).values()];
    return list.filter((t) => t.createdAt && now - t.createdAt <= maxAge && (!chains || chains.includes(t.chain)) && isMemecoin(t) && trading(t, hot) && tieOf(t, { anchors: words })).map((t) => {
      const older = list.filter((o) => o.address !== t.address && o.chain === t.chain && o.createdAt && o.createdAt < t.createdAt && sameName2(o, t) && (now - o.createdAt <= COPY_WINDOW_MS || (o.marketCap || 0) >= BIG_CAP || (o.liquidity || 0) >= BIG_LIQUIDITY)).sort((a, b) => a.createdAt - b.createdAt)[0];
      return { ...t, copyOf: older ? { symbol: older.symbol, createdAt: older.createdAt } : null };
    }).sort((a, b) => Number(!!a.copyOf) - Number(!!b.copyOf) || b.createdAt - a.createdAt);
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
          res = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
            // A call that never answers would hold its place in the queue, and the launch scan would never end.
            signal: AbortSignal.timeout(15e3)
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
          const err = new Error(json.error.message || String(json.error));
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
  async function estimateSlot(rpc, T) {
    const cal = SLOT_CALENDAR;
    if (cal.length >= 2 && T >= cal[0][1] && T <= cal[cal.length - 1][1]) {
      let i = cal.findIndex(([, t]) => t >= T);
      if (i <= 0) i = 1;
      const [s02, t02] = cal[i - 1];
      const [s1, t1] = cal[i];
      return Math.round(s02 + (T - t02) / Math.max(1, t1 - t02) * (s1 - s02));
    }
    const tip = await tipPoint(rpc);
    const [s0, t0] = cal.length ? cal[cal.length - 1] : [tip.slot - 3e3, tip.t - 3e3 * SLOT_SECONDS];
    const rate = (tip.t - t0) / Math.max(1, tip.slot - s0) || SLOT_SECONDS;
    return Math.min(tip.slot, Math.round(tip.slot - (tip.t - T) / rate));
  }
  async function slotNearTime(rpc, T) {
    let a = await blockTimeNear(rpc, await estimateSlot(rpc, T));
    if (Math.abs(T - a.t) <= 1) return a.slot;
    let rate = SLOT_SECONDS;
    let s = a.slot + Math.round((T - a.t) / rate);
    for (let i = 0; i < 6; i++) {
      const b = await blockTimeNear(rpc, s);
      const d = T - b.t;
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
  async function findLaunchBlockByTime(rpc, mint, T) {
    const center = await slotNearTime(rpc, T);
    const slots = await rpc("getBlocks", [center - 14, center + 14, { commitment: "finalized" }]);
    const hits = [];
    const order = [...slots].sort((x, y) => Math.abs(x - center) - Math.abs(y - center));
    for (const s of order.slice(0, 16)) {
      const block = await getBlock(rpc, s);
      if (!block || block.blockTime < T - 1 || block.blockTime > T + 1) continue;
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
  async function oldestFromTime(rpc, address, T, maxPages) {
    for (const offset of [60, 600, 3600, 12 * 3600]) {
      const slot = await estimateSlot(rpc, T + offset);
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
    const pct2 = (x) => supply > 0n ? Number(x * 1000000n / supply) / 1e4 : 0;
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
      return { owner: w.owner, isDev, boughtPct: pct2(amount), heldPct: pct2(now) };
    }).sort((a, b) => b.boughtPct - a.boughtPct);
    return {
      ok: true,
      launchSlot: launch.slot,
      launchTime: launch.time,
      creator: launch.creator,
      note: launch.note,
      bundleWallets: wallets.filter((w) => !w.isDev).length,
      bundledPct: pct2(bundled),
      bundleHeldPct: pct2(held),
      devBoughtPct: pct2(devBought),
      devHeldPct: pct2(devHeld),
      wallets: wallets.slice(0, 12),
      cache: launch
    };
  }

  // extension/src/lib/reroute.js
  async function pickReroute(tokens, getReport, { limit = 8, batch = 4, rules = RULES } = {}) {
    const seen2 = /* @__PURE__ */ new Set();
    const list = (tokens || []).filter((t) => t?.address && !seen2.has(t.address) && seen2.add(t.address)).sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0));
    const rejected = [];
    const live2 = [];
    for (const t of list) {
      const why = marketBlock(t);
      if (why) rejected.push({ token: t, why });
      else live2.push(t);
    }
    const pool = live2.slice(0, limit);
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
  function addRecent(list, item) {
    if (!item) return list;
    return [item, ...list.filter((r) => r.q !== item.q)].slice(0, MAX_RECENT);
  }

  // extension/src/ui/watchlist.js
  var WATCHLIST_KEY = "radar-watchlist";
  var MAX_STARS = 20;
  function toggleStar(list, star) {
    if (!star?.address) return list;
    if (list.some((s) => s.address === star.address)) return list.filter((s) => s.address !== star.address);
    return list.length >= MAX_STARS ? list : [star, ...list];
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
    function cached(key2, ttl, fn) {
      const hit = memo.get(key2);
      if (hit && Date.now() - hit.t < (hit.ttl ?? ttl)) return hit.p;
      const p = fn();
      memo.set(key2, { t: Date.now(), p });
      p.catch(() => memo.delete(key2));
      if (memo.size > 500) memo.delete(memo.keys().next().value);
      return p;
    }
    const postKey = (p, chains) => JSON.stringify([p, chains]);
    async function forgetIfFailed(key2, p) {
      const res = await p;
      const hit = memo.get(key2);
      if (res?.engineError && hit) {
        hit.t = Date.now();
        hit.ttl = 1e4;
      }
      return res;
    }
    async function read({ post }) {
      const s = await host.settings();
      const key2 = `rd:${postKey(post, s.chains)}`;
      return forgetIfFailed(key2, cached(key2, 3e5, () => readPost(post, s.chains, { apiBase: API_BASE, cached })));
    }
    async function coins2({ post, judge = false }) {
      const s = await host.settings();
      const key2 = `co:${judge ? "j:" : ""}${postKey(post, s.chains)}`;
      return forgetIfFailed(key2, cached(key2, 12e4, async () => {
        const r = await read({ post });
        const found = await findCoins(judge ? { ...r, judge: true } : r, s.chains, { apiBase: API_BASE, cached });
        const words = [.../* @__PURE__ */ new Set([...found.anchors || [], ...found.terms || [], ...postWords(post?.text)])];
        const newPairs = keepBest(freshPairs([...found.pool || [], ...found.roleCandidates || [], ...found.others || [], ...found.mentioned || []], storyWords(words, post?.author, post?.text), { chains: s.chains }));
        return { ...found, newPairs, words };
      }));
    }
    async function fresh({ text }) {
      const words = postWords(text);
      if (!words.length) return { coins: [] };
      const s = await host.settings();
      const pairs = (await Promise.all(words.slice(0, 2).map((w) => cached(`fr:${norm(w)}`, 18e4, () => searchPairs(w)).catch(() => [])))).flat();
      const coins3 = freshPairs(aggregate(pairs), words, { chains: s.chains, maxAge: BADGE_MS, hot: true }).filter((t) => !t.copyOf).slice(0, 5);
      return { coins: coins3.map((t) => ({ address: t.address, symbol: t.symbol, createdAt: t.createdAt })) };
    }
    async function forgetCoins({ post }) {
      const s = await host.settings();
      const { quickRead, ...withSpeech } = post || {};
      for (const p of quickRead ? [post, withSpeech] : [post]) {
        const k = postKey(p, s.chains);
        const r = await memo.get(`rd:${k}`)?.p.catch(() => null);
        if (r?.engineError) memo.delete(`rd:${k}`);
        for (const t of r?.terms || []) memo.delete(`q:${t.toLowerCase()}`);
        memo.delete(`co:${k}`);
        memo.delete(`co:j:${k}`);
      }
    }
    async function story({ post, narrative, coin }) {
      return cached(`st:${post.url || post.text}:${coin?.address || ""}`, 6e5, async () => {
        const res = await fetch(`${API_BASE}/story`, {
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
        const res = await fetch(`${API_BASE}/larpcheck?address=${encodeURIComponent(address)}`, { signal: AbortSignal.timeout(1e4) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Larpcheck ${res.status}`);
        return data;
      });
    }
    const lcGet = async (path, ttl) => cached(`lc:${path}`, ttl, async () => {
      const res = await fetch(`${API_BASE}${path}`, { signal: AbortSignal.timeout(12e3) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Larpcheck ${res.status}`);
      return data;
    });
    const lcHolders = ({ address, chain }) => lcGet(`/lc/holders?address=${encodeURIComponent(address)}&chain=${encodeURIComponent(chain)}`, 3e5);
    const lcBoard = ({ sort }) => lcGet(`/lc/board?sort=${encodeURIComponent(sort)}`, 3e5);
    const lcSettings = () => lcGet("/lc/settings", 6e5);
    async function lcHolderPost(path, body) {
      const h = await holderStored();
      if (!h) throw new Error("This is for $RADAR and $LARPCHECK holders. Check your wallet first.");
      const res = await fetch(`${API_BASE}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: h.token, ...body }), signal: AbortSignal.timeout(5e4) });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) await host.store.set(HOLDER_KEY, null);
      if (!res.ok) throw new Error(data.error || `Larpcheck ${res.status}`);
      return data;
    }
    const lcStart = ({ input }) => lcHolderPost("/lc/check", { input });
    const lcAsk = ({ id, question }) => lcHolderPost("/lc/ask", { id, question });
    async function lcPoll({ id }) {
      const res = await fetch(`${API_BASE}/lc/check?id=${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(15e3) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Larpcheck ${res.status}`);
      return data;
    }
    async function postCoins2({ post }) {
      const s = await host.settings();
      return postCoins(post, s.chains, cached);
    }
    async function mentioned({ text }) {
      const s = await host.settings();
      return cached(`mn:${text}`, 6e4, async () => (await mentionedTokens(String(text || "").slice(0, 2e3), s.chains)).map((t) => ({ address: t.address, chain: t.chain, symbol: t.symbol, name: t.name, marketCap: t.marketCap, createdAt: t.createdAt })));
    }
    async function refresh({ tokens, deep = [], roleCandidates = [], roleCut = 0 }) {
      const fresh2 = await fullTokens(tokens, new Set(deep));
      const updated = Object.fromEntries(fresh2.map((t) => [t.address, t]));
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
    let rugFails = 0;
    let rugOffUntil = 0;
    async function holderReport(mint, pairs) {
      if (Date.now() >= rugOffUntil) {
        try {
          const report2 = await rugReport(mint, pairs);
          rugFails = 0;
          return { ...report2, readAt: Date.now() };
        } catch (e) {
          if (!/rate limited/i.test(String(e?.message)) && ++rugFails >= 3) {
            rugFails = 0;
            rugOffUntil = Date.now() + 3e5;
          }
        }
      }
      const s = await host.settings();
      const report = await standInReport(mint, () => lcHolders({ address: mint, chain: "solana" }), rpcFor(await host.rpcUrl(s)));
      if (!report) throw new Error("Holder data isn't available right now");
      return { ...report, readAt: Date.now() };
    }
    async function safety({ mint, pairs }) {
      return cached(`rc:${mint}`, 6e4, () => holderReport(mint, pairs));
    }
    async function bundle({ mint, launchMs, pairs, launchPair, launchDex }) {
      const s = await host.settings();
      await host.ready;
      return cached(`bd:${mint}`, 45e3, async () => {
        const key2 = `launch:${mint}`;
        const stored = await host.store.get(key2) || null;
        const birthKnown = LAUNCHPADS.has(launchDex) && launchMs && Date.now() - launchMs < 3 * 864e5;
        const rc = stored || birthKnown ? null : await safety({ mint, pairs }).catch(() => null);
        const seen2 = rc?.detectedAt ? Date.parse(rc.detectedAt) : Infinity;
        const hintMs = Math.min(launchMs || Infinity, seen2);
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
        if (result.ok && !stored) await host.store.set(key2, result.cache);
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
        const res = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en&token=${embedToken(id)}`, { signal: AbortSignal.timeout(8e3) });
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
        const res = await fetch(`${API_BASE}/tweet?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(1e4) });
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
    async function reroute({ post, candidates = null, named = [], where = "post" }) {
      const s = await host.settings();
      const report = (t) => safety({ mint: t.address, pairs: t.pairAddresses || [] });
      const body = [post?.text, post?.quoted, post?.card, post?.parent].filter(Boolean).join("\n").slice(0, 2e3);
      let inPost = named.length ? named : body ? await mentionedTokens(body, s.chains).catch(() => []) : [];
      if (!inPost.length && !candidates?.length) inPost = (await coins2({ post }).catch(() => null))?.mentioned || [];
      let token;
      let checked;
      let reason;
      if (inPost.length) {
        token = inPost[0];
        checked = await report(token).catch(() => null);
        const why = marketBlock(token) || reportBlock(checked);
        const place = where === "bio" ? "the poster's bio" : "the post";
        if (why) throw new Error(`$${String(token.symbol || "").trim()} in ${place} didn't pass: ${why}`);
        reason = `the coin in ${place}`;
      } else {
        let list = candidates;
        if (!list?.length) {
          const found = await coins2({ post });
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
        let res = await fetch(small);
        if (!res.ok) res = await fetch(url);
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
      const config = await cached("holder:config", 6e5, async () => (await fetch(`${API_BASE}/holder/settings`, { signal: AbortSignal.timeout(6e3) })).json()).catch(() => ({ on: false }));
      const h = await holderStored();
      if (!config.on && !h) return { on: false };
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
        const r = await fetch(`https://api.dexscreener.com/tokens/v1/${chain}/${list.join(",")}`, { signal: AbortSignal.timeout(8e3) });
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
      const r = await fetch(`${API_BASE}/holder/who`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: h.token, handle }), signal: AbortSignal.timeout(25e3) });
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
    const starList = async () => await host.store.get(WATCHLIST_KEY) || [];
    const starToggle = async ({ star }) => {
      const list = toggleStar(await starList(), star);
      await host.store.set(WATCHLIST_KEY, list);
      return list;
    };
    const FEED_DUST = 5e3;
    async function breaking() {
      const h = await holderStored().catch(() => null);
      return cached(`fd:${h?.token ? "h" : "p"}`, 5e4, async () => {
        const res = await fetch(`${API_BASE}/narratives`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: h?.token }), signal: AbortSignal.timeout(12e3) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Feed ${res.status}`);
        const stories = data.stories || [];
        const refs = [...new Set(stories.flatMap((s) => [s.first, ...s.big]).map((c) => c.a))].map((address) => ({ chain: "solana", address }));
        const tokens = refs.length ? await fullTokens(refs).catch(() => []) : [];
        const live2 = new Map(tokens.map((t) => [t.address, t]));
        const coin = (c) => {
          const t = live2.get(c.a);
          return { address: c.a, symbol: t?.symbol || c.s, name: t?.name || c.n, cap: t ? t.mcapBacked === false && !t.onCurve ? 0 : t.marketCap || 0 : null };
        };
        return {
          live: !!data.live,
          asOf: data.asOf,
          stories: stories.map((s) => {
            const list = [s.first, ...s.big].map(coin);
            const known = list.filter((c) => c.cap != null);
            return { words: s.words, coins: s.coins, wallets: s.wallets, recent: s.recent, startedAt: s.startedAt, first: list[0], biggest: [...known].sort((a, b) => b.cap - a.cap)[0] || null, faded: known.length === list.length && known.every((c) => c.cap < FEED_DUST) };
          }).filter((s) => !s.faded)
        };
      });
    }
    const launchState = () => cached("launch:state", 6e5, async () => (await fetch(`${API_BASE}/launch/settings`, { signal: AbortSignal.timeout(6e3) })).json());
    const handlers2 = { forgetCoins, breaking, starList, starToggle, videoInfo, tweet, read, coins: coins2, fresh, postCoins: postCoins2, mentioned, story, larpcheck, refresh, safety, bundle, image, openWindow, reroute, holderStatus, holderSave, holderWho, holderActive, recentList, recentAdd, recentClear, launchState, lcHolders, lcBoard, lcSettings, lcStart, lcAsk, lcPoll, settings: () => host.settings() };
    handlers2.resetBundles = () => memo.forEach((_, k) => k.startsWith("bd:") && memo.delete(k));
    return handlers2;
  }

  // webapp/alerts.js
  var KEY = "nr:radarHolder";
  var POLL_MS = 3e4;
  var SCAN_NEWEST = 5;
  var $ = (id) => document.getElementById(id);
  var esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  var isPost = (u) => /^https:\/\/x\.com\/\w+\/status\/\d+$/.test(String(u || ""));
  var store = {
    async get(key2) {
      try {
        const raw = localStorage.getItem(`nr:${key2}`);
        return raw == null ? null : JSON.parse(raw);
      } catch {
        return null;
      }
    },
    async set(key2, value) {
      try {
        localStorage.setItem(`nr:${key2}`, JSON.stringify(value));
      } catch {
      }
    }
  };
  var handlers = makeHandlers({ settings: async () => DEFAULTS, store, openWindow() {
  }, rpcUrl: async () => `${API_BASE}/rpc`, ready: Promise.resolve(), inlineImages: false });
  var tokenOf = () => {
    try {
      const h = JSON.parse(localStorage.getItem(KEY) || "null");
      return h?.token && h.exp > Date.now() ? h.token : null;
    } catch {
      return null;
    }
  };
  var dropToken = () => {
    try {
      localStorage.removeItem(KEY);
    } catch {
    }
  };
  var ago = (at) => {
    const s = Math.max(0, Math.round((Date.now() - at) / 1e3));
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    return `${Math.floor(s / 3600)}h ago`;
  };
  var usd = (n2) => !(n2 > 0) ? "" : n2 >= 999950 ? `$${(n2 / 1e6).toFixed(2)}M` : n2 >= 1e3 ? `$${(n2 / 1e3).toFixed(1)}K` : `$${Math.round(n2)}`;
  var KIND = { reply: "replied", quote: "quoted", post: "posted" };
  var live = false;
  var items = [];
  var seen = null;
  var unread = 0;
  var coins = /* @__PURE__ */ new Map();
  var coinsHtml = (it) => {
    if (!live) return '<a class="al-lock" href="/holder?next=alerts" data-unlock>Holders get these live, with the top 3 coins. <b>Check your wallet</b></a>';
    const c = coins.get(it.id);
    if (c === "scanning" || c === void 0 && items.indexOf(it) < SCAN_NEWEST) return '<p class="al-note">Finding the top coins\u2026</p>';
    if (c === void 0) return "";
    if (c === "none" || !c.length) return '<p class="al-note">No coins found on this yet. Scan it again in a minute.</p>';
    return `<div class="al-coins">${c.map((k) => `<button type="button" class="al-coin" data-ca="${esc(k.address)}" title="Copy ${esc(k.address)}">
      ${k.label ? `<i>${esc(k.label)}</i>` : ""}<b>$${esc(k.symbol)}</b><span>${esc(k.address.slice(0, 6))}\u2026${esc(k.address.slice(-4))}</span>${usd(k.marketCap) ? `<u>${usd(k.marketCap)}</u>` : ""}<em>Copy</em></button>`).join("")}</div>
    <p class="al-note">Found by name and not checked yet. Scan it for the checks.</p>`;
  };
  var render = () => {
    const list = $("al-list");
    $("al-empty").hidden = items.length > 0;
    $("al-status").textContent = live ? "Live. You hold enough to get these as they land." : "You're seeing these 10 minutes late.";
    $("al-status").classList.toggle("on", live);
    $("al-unlock").hidden = live;
    $("al-notify").hidden = !live || !("Notification" in window) || /Android/i.test(navigator.userAgent) || Notification.permission === "denied";
    $("al-notify").textContent = "Notification" in window && Notification.permission === "granted" ? "Alerts on while this page is open" : "Alert me while this page is open";
    $("al-notify").disabled = "Notification" in window && Notification.permission === "granted";
    list.innerHTML = items.map((it) => `<article class="al-card">
    <div class="al-top"><span class="al-who">@${esc(it.author)} ${KIND[it.kind] || "posted"}</span><time>${ago(it.at)}</time></div>
    ${it.name ? `<h2>${esc(it.name)}</h2>` : ""}
    <p class="al-why">${esc(it.why)}</p>
    ${it.text ? `<blockquote>${esc(it.text)}</blockquote>` : ""}
    ${it.parent ? `<blockquote class="al-parent">${esc(it.parent)}</blockquote>` : ""}
    ${coinsHtml(it)}
    ${isPost(it.url) ? `<div class="al-acts"><a class="btn btn-solid" href="/scan?url=${encodeURIComponent(it.url)}">Scan it</a><a class="btn btn-ghost" href="${esc(it.url)}" target="_blank" rel="noopener">Open the post</a></div>` : ""}
  </article>`).join("");
  };
  var scanning = false;
  async function scanNext() {
    if (!live || scanning) return;
    const it = items.slice(0, SCAN_NEWEST).find((x) => !coins.has(x.id) && x.post);
    if (!it) return;
    scanning = true;
    coins.set(it.id, "scanning");
    try {
      const found = await Promise.race([handlers.coins({ post: it.post }), new Promise((r) => setTimeout(r, 2e4, null))]);
      const top = signalCoins(found);
      coins.set(it.id, top.length ? top : "none");
    } catch {
      coins.set(it.id, "none");
    }
    scanning = false;
    render();
    scanNext();
  }
  async function load() {
    const token = tokenOf();
    let res = await fetch(`${API_BASE}/signals`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(token ? { token, history: true } : { public: true }), signal: AbortSignal.timeout(1e4) });
    if (res.status === 401 && token) {
      dropToken();
      res = await fetch(`${API_BASE}/signals`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ public: true }), signal: AbortSignal.timeout(1e4) });
    }
    if (!res.ok) throw new Error(`signals ${res.status}`);
    const d = await res.json();
    live = !!d.live;
    items = (d.items || []).filter((x) => x?.id);
    $("al-error").hidden = true;
    const fresh = seen ? items.filter((x) => !seen.has(x.id)) : [];
    seen = /* @__PURE__ */ new Set([...seen || [], ...items.map((x) => x.id)]);
    if (fresh.length && document.hidden) {
      unread += fresh.length;
      document.title = `(${unread}) Big account alerts \xB7 Radar`;
      if (live && "Notification" in window && Notification.permission === "granted") {
        for (const it of fresh.slice(0, 3)) {
          try {
            const n2 = new Notification(`@${it.author}${it.name ? `: ${it.name}` : " posted something"}`, { body: it.why, icon: "/icons/icon128.png", tag: `signal:${it.id}` });
            n2.onclick = () => {
              window.focus();
              n2.close();
            };
          } catch {
          }
        }
      }
    }
    render();
    scanNext();
  }
  var tick = () => load().catch(() => {
    $("al-error").hidden = false;
    if ($("al-status").textContent === "Loading\u2026") {
      $("al-status").textContent = "Couldn't load";
      $("al-unlock").hidden = false;
    }
  });
  document.addEventListener("click", async (e) => {
    const b = e.target.closest?.("[data-ca]");
    if (!b) return;
    try {
      await navigator.clipboard.writeText(b.dataset.ca);
      const em = b.querySelector("em");
      if (em) {
        em.textContent = "Copied";
        setTimeout(() => {
          em.textContent = "Copy";
        }, 1500);
      }
    } catch {
    }
  });
  $("al-notify").addEventListener("click", async () => {
    if ("Notification" in window) await Notification.requestPermission().catch(() => {
    });
    render();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    unread = 0;
    document.title = "Big account alerts \xB7 Radar";
    tick();
  });
  tick();
  setInterval(tick, POLL_MS);
  setInterval(() => {
    if (items.length) render();
  }, 6e4);
})();
