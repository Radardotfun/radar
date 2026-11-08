// Radar 1.7.149 on the web: built from the extension source at https://tryradar.fun. Not financial advice.
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
  var tradesDay = (t) => (t?.txns?.h24?.buys || 0) + (t?.txns?.h24?.sells || 0);
  var tradesLine = (t) => `${tradesDay(t)} trade${tradesDay(t) === 1 ? "" : "s"} 24h`;
  var quiet = (t, now = Date.now()) => !!t?.txns?.h24 && tradesDay(t) < 50 && (t.volume?.h24 || 0) < 2500 && !!t.createdAt && now - t.createdAt > 864e5;
  var pct = (v) => `${v < 10 ? v.toFixed(1) : Math.round(v)}%`;
  function since(at, now = Date.now()) {
    if (!at) return "";
    const m = Math.floor((now - at) / 6e4);
    return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago`;
  }
  var from = (name, at, now) => [name, since(at, now)].filter(Boolean).join(" \xB7 ");
  function reportSource(r, now = Date.now()) {
    if (!r) return null;
    if (r.source !== "larpcheck") {
      const rug = from("RugCheck", r.readAt, now);
      return { fallback: false, holders: rug, authority: rug, line: rug };
    }
    const holders = from("Larpcheck", r.holdersAt, now);
    const authority = r.authorityKnown ? from("Solana chain", r.readAt, now) : "couldn't be read";
    const when = (name, at) => [name, since(at, now)].filter(Boolean).join(" ");
    return { fallback: true, holders, authority, line: `Fallback \xB7 ${when("Larpcheck", r.holdersAt)} \xB7 ${r.authorityKnown ? when("chain", r.readAt) : "mint/freeze unread"} \xB7 no LP or insider data` };
  }
  var seriousWarning = (line) => /^(liquidity pulled|freeze authority is on|mint authority is on|rugcheck flags)|can't sell|money was taken|honeypot|\brug(ged|s)?\b/i.test(String(line || ""));
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
    // Wormhole WETH on Solana: Wethamphetamine ($METH, $78K) has its only pool against it and read as having no liquidity.
    "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs",
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
  var isBaseQuote = (a) => QUOTES.has(quoteKey(a));
  var REAL_QUOTES = /* @__PURE__ */ new Set([...QUOTES, "t9bnCGiZVUYsRKvx4d5dPcoDCSyuBM9C33ZNGNULARP", "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn"]);
  var LAUNCHPADS = /* @__PURE__ */ new Set(["pumpfun", "launchlab", "meteoradbc", "moonshot", "boop", "heaven", "believe", "bags", "moonit", "jupstudio", "flapsh", "fourmeme"]);
  async function getJson(url2) {
    for (let i = 0; i < 4; i++) {
      const res = await fetch(url2, { signal: AbortSignal.timeout(8e3) });
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
  var XSTOCKS = /* @__PURE__ */ new Set([
    "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
    // NVDAx
    "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
    // TSLAx
    "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",
    // SPYx
    "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1",
    // CRCLx
    "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ",
    // QQQx
    "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu",
    // METAx
    "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN",
    // GOOGLx
    "XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ",
    // MSTRx
    "Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu",
    // COINx
    "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX",
    // MSFTx
    "XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg",
    // HOODx
    "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
    // AAPLx
    "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg",
    // AMZNx
    "Xsf9mBktVB9BSU5kf4nHxPq5hCBJ2j2ui3ecFGxPRGc",
    // GMEx
    "Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re",
    // GLDx
    "Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8",
    // SPCXx
    // Backpack Securities' tokenized shares, the real mints with $50K+ of their own liquidity (checked 5 Nov 2026); copies of
    // the names end in "pump" and hold nothing.
    "DJTu7vi8norVzdVAffgvb39VP7wjKeTsgaMBJrzfxvoF",
    // DJT
    "TSLAqBbv4CNCnzWFeB7LmydAyEiNMJtve7DYKLpdK4S",
    // TSLA
    "METAaH6MMZZgy2CTEJq3QdNi7AFVTV3NxHFBfFgLEDd",
    // META
    "NVDAVuiB7hwd3m5Wa1JuHNovPaPG6BH1QNztbKFxNjv",
    // NVDA
    "AMZNw7cwU9L9c7ewZXxTws2PwQYxBGm2Rxg3FLDBJz9B",
    // AMZN
    "AAPLEDt8RpzPgXyhvFzkMBofvFSQw9gpeMCoUdPdLnB8",
    // AAPL
    "MSFThX899B1DddH5jkyMpdArWXzP85VXLYDrbGGcRJM",
    // MSFT
    "GooGLMvZtJZXHdNZy95RUrAMCCKxV6ghK3qE5ddBgVm5",
    // GOOGL
    "TTWofwAge91oFhZs7kpQdyrVRkmevgM88xijGvQFbKo",
    // TTWO
    "AMD8XwJXgQ9WV45Wyj9yFLejxzf2J6VM1PJY8bJEjeES",
    // AMD
    "LULUmT9VMttkfAJE236LXJcYJ2tTP7nunrSWR5G1BdS",
    // LULU
    "DNUTsCvKbKwu2RM72cUuW3TD9YpzArzACcqYQssjPLSk",
    // DNUT
    "RUMsPfFZFnN1ZmGANwP7FNMJMjKH4m9RiMePrtVtLe7",
    // RUM
    "PTNzAfFAB4LvoUQEUUGrFMyUoRLExMYjH6CcfyQfsVP"
    // PTN
  ]);
  var stockQuote = (p) => p.chainId === "robinhood" && /•\s*Robinhood Token$/i.test(String(p.quoteToken?.name || "").trim()) || p.chainId === "solana" && XSTOCKS.has(p.quoteToken?.address);
  function realLiquidity(p) {
    if (!REAL_QUOTES.has(quoteKey(p.quoteToken?.address)) && !stockQuote(p)) return 0;
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
      const onCurve2 = LAUNCHPADS.has(primary.dexId);
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
        // What its main pool is priced in: SOL or a dollar usually, another coin when it was launched under one.
        quote: primary.quoteToken?.address ? { address: primary.quoteToken.address, symbol: String(primary.quoteToken.symbol || "").trim() } : null,
        dexId: primary.dexId,
        onCurve: onCurve2,
        pairAddresses: list.map((p) => p.pairAddress),
        url: primary.url,
        links: [...new Set(list.flatMap((p) => [...p.info?.websites || [], ...p.info?.socials || []].map((x) => x.url)).filter(Boolean))],
        boosts: n(primary.boosts?.active),
        // MC with almost nothing behind it (or a curve with zero trades) is not a real cap.
        mcapBacked: onCurve2 ? n(primary.volume?.h24) > 0 : liquidity >= 1e3 && marketCap / Math.max(liquidity, 1) < 150,
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
  var STOCK_TICKERS = new Set("AAPL MSFT GOOGL GOOG AMZN META NVDA TSLA AMD INTC NFLX AVGO ORCL CRM ADBE IBM QCOM MU ARM TSM ASML SHOP UBER ABNB PYPL SQ XYZ COIN HOOD MSTR PLTR SNOW NET DIS NKE WMT COST JPM GS BAC V MA BRK SPY QQQ DJT GME AMC BABA BIDU NIO RIVN LCID SMCI DELL HPQ SBUX MCD KO PEP".split(" "));
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
    let live = [];
    let cutUsed = 0;
    for (const cut of cuts) {
      cutUsed = cut;
      live = tokens.filter((t) => (t.relevance || 0) >= maxRel * cut && alive(t) && !isDust(t));
      if (live.length >= 3) break;
    }
    if (!live.length && allowFallback) live = tokens.filter((t) => t.volume.h24 > 0 && !isDust(t));
    const used = /* @__PURE__ */ new Set();
    const take = (t, role) => {
      if (t) used.add(t.address);
      return t ? { role, token: t } : null;
    };
    const top = [...live].filter((t) => t.mcapBacked).sort((a, b) => b.marketCap - a.marketCap)[0];
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
    const movers = live.filter((t) => !used.has(t.address) && t.volume.h1 >= 1e3);
    const mover = (movers.length ? movers : live.filter((t) => !used.has(t.address) && t.volume.h24 >= 250 && t.volume.h1 > 0)).sort((a, b) => momentum(b) - momentum(a) || b.volume.h24 - a.volume.h24)[0];
    picks.push(take(mover, "mover"));
    const best = {
      top: [...live].filter((t) => t.mcapBacked).sort((a, b) => b.marketCap - a.marketCap)[0]?.address,
      og: og?.address,
      mover: live.filter((t) => t.volume.h1 >= 1e3).sort((a, b) => momentum(b) - momentum(a))[0]?.address
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
    const r = await fetch(`https://api.dexscreener.com/tokens/v1/${chain}/${address}`, { signal: AbortSignal.timeout(8e3) });
    const pairs = r.ok ? await r.json() : [];
    const key2 = address.toLowerCase();
    const pair = (Array.isArray(pairs) ? pairs : []).find((p) => [p.baseToken?.address, p.quoteToken?.address].some((a) => a?.toLowerCase() === key2));
    return pair ? (pair.baseToken.address.toLowerCase() === key2 ? pair.baseToken : pair.quoteToken).symbol : null;
  }
  async function mentionedTokens(text, chains, search = searchPairs) {
    const cas = [.../* @__PURE__ */ new Set([...text.match(SOL_CA) || [], ...text.match(EVM_CA) || []])].slice(0, 3);
    const found = await Promise.all(cas.map(async (ca2) => {
      const key2 = ca2.toLowerCase();
      const hit = aggregate(await search(ca2).catch(() => [])).find((t) => t.address.toLowerCase() === key2 || t.pairAddresses?.some((p) => p.toLowerCase() === key2));
      if (!hit) return null;
      return aggregate(await allPairsMany([hit]).catch(() => [])).find((t) => t.address === hit.address && chains.includes(t.chain)) || null;
    }));
    return [...new Map(found.filter(Boolean).map((t) => [t.address, t])).values()];
  }

  // extension/src/lib/family.js
  var PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
  var PUMP_AMM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
  var CURVE_SIZE = 166;
  var MINTS_MAX = 90;
  var B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  function base58(bytes) {
    let n2 = 0n;
    for (const b of bytes) n2 = n2 * 256n + BigInt(b);
    let s = "";
    while (n2 > 0n) {
      s = B58[Number(n2 % 58n)] + s;
      n2 /= 58n;
    }
    for (const b of bytes) {
      if (b) break;
      s = `1${s}`;
    }
    return s;
  }
  var bytesOf = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  async function programAccounts(rpc, program, opts) {
    try {
      return await rpc("getProgramAccounts", [program, opts]);
    } catch (e) {
      if (!/getProgramAccountsV2/.test(String(e?.message))) throw e;
    }
    const out = [];
    let paginationKey;
    for (let page = 0; page < 5; page++) {
      const r = await rpc("getProgramAccountsV2", [program, { ...opts, limit: 1e4, ...paginationKey ? { paginationKey } : {} }]);
      out.push(...r?.accounts || []);
      paginationKey = r?.paginationKey;
      if (!paginationKey) break;
    }
    return out;
  }
  async function familyCounts(mint, rpc) {
    const [curves, pools] = await Promise.all([
      programAccounts(rpc, PUMP, { encoding: "base64", dataSlice: { offset: 0, length: 0 }, filters: [{ dataSize: CURVE_SIZE }, { memcmp: { offset: 83, bytes: mint } }] }),
      programAccounts(rpc, PUMP_AMM, { encoding: "base64", dataSlice: { offset: 43, length: 32 }, filters: [{ memcmp: { offset: 75, bytes: mint } }] })
    ]);
    const mints = [...new Set((pools || []).map((a) => base58(bytesOf(a.account.data[0]))).filter((m) => m !== mint))];
    return { children: Math.max((curves || []).length, mints.length), graduated: mints.length, mints: mints.slice(0, MINTS_MAX), more: mints.length > MINTS_MAX };
  }
  async function familyDetails(counts, { tokens = fullTokens } = {}) {
    if (!counts?.mints?.length) return { ...counts, volume: 0, biggest: null };
    const full = await tokens(counts.mints.map((address) => ({ chain: "solana", address }))).catch(() => []);
    const biggest = full.filter((t) => t?.mcapBacked).sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0))[0] || null;
    return { ...counts, volume: full.reduce((s, t) => s + (t?.volume?.h24 || 0), 0), biggest };
  }
  var parentOf = (t) => t?.quote?.address && !isBaseQuote(t.quote.address) && t.quote.address !== t.address ? { address: t.quote.address, symbol: String(t.quote.symbol || "").trim() } : null;

  // extension/src/lib/devrecord.js
  var CURVE_TAG = "4y6pru6YvC7";
  var B582 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  function base582(bytes) {
    let n2 = 0n;
    for (const b of bytes) n2 = n2 * 256n + BigInt(b);
    let s = "";
    while (n2 > 0n) {
      s = B582[Number(n2 % 58n)] + s;
      n2 /= 58n;
    }
    for (const b of bytes) {
      if (b) break;
      s = `1${s}`;
    }
    return s;
  }
  function unbase58(s) {
    let n2 = 0n;
    for (const c of String(s)) {
      const i = B582.indexOf(c);
      if (i < 0) throw new Error("Not a Solana address");
      n2 = n2 * 58n + BigInt(i);
    }
    const out = [];
    while (n2 > 0n) {
      out.unshift(Number(n2 & 255n));
      n2 >>= 8n;
    }
    for (const c of String(s)) {
      if (c !== "1") break;
      out.unshift(0);
    }
    return Uint8Array.from(out);
  }
  var bytesOf2 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  var P = 2n ** 255n - 19n;
  var mod = (a) => (a % P + P) % P;
  function pow(b, e) {
    let r = 1n;
    b = mod(b);
    while (e > 0n) {
      if (e & 1n) r = r * b % P;
      b = b * b % P;
      e >>= 1n;
    }
    return r;
  }
  var D = mod(-121665n * pow(121666n, P - 2n));
  function onCurve(bytes) {
    let y = 0n;
    for (let i = 31; i >= 0; i--) y = y << 8n | BigInt(bytes[i]);
    y &= (1n << 255n) - 1n;
    if (y >= P) return false;
    const y2 = y * y % P;
    const x2 = mod(y2 - 1n) * pow(mod(D * y2 + 1n), P - 2n) % P;
    return x2 === 0n || pow(x2, (P - 1n) / 2n) === 1n;
  }
  async function programAddress(seeds, program) {
    const tail = [...unbase58(program), ...new TextEncoder().encode("ProgramDerivedAddress")];
    const head = seeds.flatMap((s) => [...s]);
    for (let bump = 255; bump >= 0; bump--) {
      const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from([...head, bump, ...tail])));
      if (!onCurve(hash)) return base582(hash);
    }
    throw new Error("No program address");
  }
  var curveOf = (mint) => programAddress([new TextEncoder().encode("bonding-curve"), unbase58(mint)], PUMP);
  function readCurve(b64) {
    const d = bytesOf2(b64);
    if (d.length < 81) return null;
    const creator = d.subarray(49, 81);
    if (creator.every((b) => b === 0)) return null;
    return { creator: base582(creator), bonded: d[48] === 1 };
  }
  async function devRecord(mint, rpc) {
    const curve = await curveOf(mint);
    const info = await rpc("getAccountInfo", [curve, { encoding: "base64" }]);
    const v = info?.value;
    if (!v || v.owner !== PUMP) return null;
    const own = readCurve(v.data?.[0] || "");
    if (!own) return null;
    const curves = await rpc("getProgramAccounts", [PUMP, {
      encoding: "base64",
      dataSlice: { offset: 48, length: 1 },
      filters: [{ memcmp: { offset: 0, bytes: CURVE_TAG } }, { memcmp: { offset: 49, bytes: own.creator } }]
    }]);
    const list = Array.isArray(curves) ? curves : [];
    const bonded = list.filter((c) => bytesOf2(c.account?.data?.[0] || "")[0] === 1).length;
    const seen = list.some((c) => c.pubkey === curve);
    return { creator: own.creator, launches: list.length + (seen ? 0 : 1), bonded: bonded + (seen || !own.bonded ? 0 : 1), thisBonded: own.bonded };
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
      // The top wallets by owner (pools left out), for Bag Guard to notice one of them leaving.
      top: holders.slice(0, 20).filter((h) => h.owner).map((h) => ({ owner: h.owner, pct: Number(h.pct) || 0 })),
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
    const links2 = [...(t.socials || []).map((s) => s?.url || s), ...t.links || []].map((u) => String(u || "").toLowerCase());
    if (links2.some((u) => new RegExp(`(^|//)(www\\.)?(x|twitter)\\.com/${handle}([/?#]|$)`, "i").test(u))) return true;
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
    const found = await Promise.all(bioCas({ bio }).map((ca2) => mentionedTokens(ca2, chains, (q) => cached(`q:${q}`, 2e4, () => searchPairs(q))).then(([t]) => t).catch(() => null)));
    return found.filter(Boolean);
  }
  function tiedBioCoin(tokens, post, read2, fullText) {
    const typed = tickersIn(fullText);
    const words = [...read2.anchors || [], ...read2.terms || [], ...fullText.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3)];
    return tokens.filter((t) => ((t.marketCap || 0) >= 1e3 || typed.includes(sym(t))) && tiedToBio(t, post, words, typed)).slice(0, 1);
  }
  var SPEECH_WAIT_MS = 2e3;
  async function readPost(post, chains, { apiBase, cached = passthrough }) {
    const fullText = postText(post);
    for (const k of extractKeywords(fullText.replace(SOL_CA, " ").replace(EVM_CA, " "), 3, { strongOnly: true })) {
      cached(`q:${k.toLowerCase()}`, 3e5, () => searchPairs(k)).catch(() => {
      });
    }
    let speechLost = false;
    const speech = post.videoUrl && !post.gif ? cached(`tr:${post.videoUrl}`, 36e5, () => engine(apiBase, "transcribe", { videoUrl: post.videoUrl }, post.quickRead ? 15e3 : 45e3)).then((r) => r.text).catch((e) => {
      if (!/too long/i.test(e?.message || "")) speechLost = true;
      return "";
    }) : "";
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
    let read2;
    try {
      read2 = await engine(apiBase, "interpret", { post: named ? { ...full, text: `${full.text || ""}
[Coin in this post: ${named}]` } : full }, 35e3);
    } catch (e) {
      if (!mentioned.length) throw e;
      return { narrative: "", speechLost, engineError: e.message, coinable: true, terms: [], anchors: [], judge: false, mentioned, tickers: [], post: full };
    }
    const seen = new Set(mentioned.map((t) => t.address.toLowerCase()));
    const fromImages = (read2.cas || []).filter((a) => !seen.has(a.toLowerCase()));
    if (fromImages.length) {
      mentioned.push(...await mentionedTokens(fromImages.join(" "), chains, (q) => cached(`q:${q}`, 2e4, () => searchPairs(q))).catch(() => []));
    }
    const fromBio = mentioned.length ? [] : tiedBioCoin(await bioLookup, post, read2, fullText);
    return { speechPending: transcript === null, speechLost, narrative: read2.narrative, coinable: read2.coinable, terms: read2.terms || [], anchors: read2.anchors || [], judge: read2.judge !== false && !read2.anchors?.length, mentioned, bioCoins: fromBio, tickers: read2.tickers || [], post: full };
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
  async function findCoins({ narrative, coinable, terms, anchors = [], judge = true, mentioned, bioCoins: fromBio = [], tickers = [], post, engineError, speechLost = false }, chains, { apiBase, cached = passthrough }) {
    const t0 = Date.now();
    const timing = {};
    const lap = (k) => {
      timing[k] = Date.now() - t0;
    };
    const base = { mode: "ai", narrative, coinable, mentioned, bioCoins: fromBio, tickers, anchors, terms, engineError, speechLost, ts: Date.now(), timing, techMatch: null };
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
  function makeRpc(url2 = PUBLIC_RPC, { concurrency = 2 } = {}) {
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
    async function call(method, params2, retries = 5) {
      for (let attempt = 0; ; attempt++) {
        let res;
        try {
          res = await fetch(url2, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params: params2 }),
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
    return (method, params2) => schedule(() => call(method, params2));
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

  // extension/src/lib/links.js
  var TOP = 12;
  var SNIPE_S = 10;
  var PAGE = 1e3;
  var BUSY = 1e3;
  var BURN = /* @__PURE__ */ new Set(["1nc1nerator11111111111111111111111111111111"]);
  var keyOf = (k) => typeof k === "string" ? k : k?.pubkey || null;
  function funderOf(tx, owner) {
    const msg = tx?.transaction?.message;
    const ins = [...msg?.instructions || [], ...(tx?.meta?.innerInstructions || []).flatMap((x) => x?.instructions || [])];
    for (const i of ins) {
      if (i?.program !== "system" || !i.parsed) continue;
      const { type, info = {} } = i.parsed;
      if ((type === "transfer" || type === "transferWithSeed") && info.destination === owner && info.source && info.source !== owner) return info.source;
      if ((type === "createAccount" || type === "createAccountWithSeed") && info.newAccount === owner && info.source && info.source !== owner) return info.source;
    }
    const payer = keyOf(msg?.accountKeys?.[0]);
    return payer && payer !== owner ? payer : null;
  }
  function isWallet(address) {
    try {
      return !BURN.has(address) && onCurve(unbase58(address));
    } catch {
      return false;
    }
  }
  function tokensFrom(tx, mint, owner) {
    const pre = new Map((tx?.meta?.preTokenBalances || []).filter((b) => b.mint === mint).map((b) => [b.accountIndex, b]));
    const post = (tx?.meta?.postTokenBalances || []).filter((b) => b.mint === mint);
    const amt = (b) => Number(b?.uiTokenAmount?.amount || 0);
    const indexes = /* @__PURE__ */ new Set([...pre.keys(), ...post.map((b) => b.accountIndex)]);
    const senders = [];
    for (const i of indexes) {
      const before = pre.get(i);
      const after = post.find((b) => b.accountIndex === i);
      const who = after?.owner || before?.owner;
      if (!who || who === owner) continue;
      if (amt(after) < amt(before)) senders.push(who);
    }
    if (!senders.length) return null;
    if (senders.some((w) => !isWallet(w))) return "buy";
    return senders.length === 1 ? senders[0] : null;
  }
  function linkHolders(holders, { creator = null, busy = /* @__PURE__ */ new Set() } = {}) {
    const owners = new Set(holders.map((h) => h.owner));
    const parent = new Map(holders.map((h) => [h.owner, h.owner]));
    const find = (x) => {
      while (parent.get(x) !== x) {
        parent.set(x, parent.get(parent.get(x)));
        x = parent.get(x);
      }
      return x;
    };
    const kinds = /* @__PURE__ */ new Map();
    const join = (a, b, kind) => {
      const ra = find(a);
      const rb = find(b);
      const ks = /* @__PURE__ */ new Set([...kinds.get(ra) || [], ...kinds.get(rb) || [], kind]);
      if (ra !== rb) parent.set(ra, rb);
      kinds.set(rb, ks);
    };
    const dev = /* @__PURE__ */ new Map();
    const shared2 = (field, kind) => {
      const first = /* @__PURE__ */ new Map();
      for (const h of holders) {
        const v = h[field];
        if (!v || v === "buy") continue;
        if (creator && v === creator) {
          dev.set(h.owner, kind === "same funder" ? "funded by the dev" : "coins from the dev");
          continue;
        }
        if (owners.has(v)) {
          join(h.owner, v, kind === "same funder" ? "funded each other" : "tokens sent");
          continue;
        }
        if (busy.has(v)) continue;
        if (first.has(v)) join(h.owner, first.get(v), kind);
        else first.set(v, h.owner);
      }
    };
    shared2("funder", "same funder");
    shared2("sentBy", "tokens sent");
    const byTx = /* @__PURE__ */ new Map();
    for (const h of holders) {
      if (!h.firstTx) continue;
      if (byTx.has(h.firstTx)) join(h.owner, byTx.get(h.firstTx), "one transaction");
      else byTx.set(h.firstTx, h.owner);
    }
    const groups = /* @__PURE__ */ new Map();
    for (const h of holders) {
      const r = find(h.owner);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(h);
    }
    const out = [];
    for (const [root, members] of groups) {
      if (members.length < 2) continue;
      const tally = /* @__PURE__ */ new Map();
      for (const m of members) if (m.funder && !owners.has(m.funder)) tally.set(m.funder, (tally.get(m.funder) || 0) + 1);
      const by = [...tally].sort((a, b) => b[1] - a[1]).find(([, n2]) => n2 >= 2)?.[0] || null;
      out.push({ kinds: [...kinds.get(root) || []].sort(), owners: members.map((m) => m.owner), pct: members.reduce((s, m) => s + m.pct, 0), by });
    }
    const devRows = holders.filter((h) => dev.has(h.owner));
    if (devRows.length) out.push({ kinds: [...new Set(devRows.map((h) => dev.get(h.owner)))].sort(), owners: devRows.map((h) => h.owner), pct: devRows.reduce((s, h) => s + h.pct, 0), by: creator, dev: true });
    return out.sort((a, b) => b.pct - a.pct);
  }
  function oldestOk(sigs) {
    if (!Array.isArray(sigs) || sigs.length >= PAGE) return null;
    for (let i = sigs.length - 1; i >= 0; i--) if (!sigs[i].err) return sigs[i];
    return null;
  }
  var getTx = (rpc, sig) => rpc("getTransaction", [sig, { encoding: "jsonParsed", maxSupportedTransactionVersion: 1, commitment: "confirmed" }]).catch(() => null);
  var history2 = (rpc, address) => rpc("getSignaturesForAddress", [address, { limit: PAGE, commitment: "confirmed" }]).catch(() => null);
  async function walletLinks(rpc, mint, { creator = null, launchS = null, exclude = [], top = TOP } = {}) {
    const skip = /* @__PURE__ */ new Set([...exclude, ...BURN]);
    const [largest, mintInfo] = await Promise.all([
      rpc("getTokenLargestAccounts", [mint, { commitment: "confirmed" }]),
      rpc("getAccountInfo", [mint, { encoding: "jsonParsed", commitment: "confirmed" }])
    ]);
    const supply = Number(mintInfo?.value?.data?.parsed?.info?.supply || 0);
    if (!supply) throw new Error("Not a token mint");
    const accounts = (largest?.value || []).filter((a) => a?.address && !skip.has(a.address));
    const empty = { ok: true, at: Date.now(), read: 0, traced: 0, devPct: null, holders: [], groups: [], linked: { wallets: 0, pct: 0 }, snipers: { wallets: 0, pct: 0 } };
    if (!accounts.length) return empty;
    const infos = await rpc("getMultipleAccounts", [accounts.map((a) => a.address), { encoding: "jsonParsed", commitment: "confirmed" }]);
    const byOwner = /* @__PURE__ */ new Map();
    accounts.forEach((a, i) => {
      const owner = infos?.value?.[i]?.data?.parsed?.info?.owner;
      if (!owner || skip.has(owner) || !isWallet(owner)) return;
      const amount = Number(a.amount || 0);
      const row = byOwner.get(owner) || { owner, amount: 0, account: a.address, biggest: 0 };
      row.amount += amount;
      if (amount > row.biggest) {
        row.biggest = amount;
        row.account = a.address;
      }
      byOwner.set(owner, row);
    });
    const devRow = creator ? byOwner.get(creator) : null;
    const rows = [...byOwner.values()].filter((r) => r.owner !== creator).sort((a, b) => b.amount - a.amount).slice(0, top);
    if (!rows.length) return { ...empty, devPct: devRow ? devRow.amount / supply * 100 : null };
    const read2 = await Promise.all(rows.map(async (r) => {
      const pct3 = r.amount / supply * 100;
      const [own, coin] = await Promise.all([history2(rpc, r.owner), history2(rpc, r.account)]);
      const firstOwn = oldestOk(own);
      const firstCoin = oldestOk(coin);
      const [ownTx, coinTx] = await Promise.all([firstOwn ? getTx(rpc, firstOwn.signature) : null, firstCoin ? getTx(rpc, firstCoin.signature) : null]);
      const from2 = coinTx ? tokensFrom(coinTx, mint, r.owner) : null;
      const firstBuy = firstCoin?.blockTime ?? null;
      return {
        owner: r.owner,
        pct: pct3,
        read: !!coinTx,
        traced: !!ownTx,
        funder: ownTx ? funderOf(ownTx, r.owner) : null,
        sentBy: from2 && from2 !== "buy" ? from2 : null,
        bought: from2 === "buy",
        firstTx: coinTx ? firstCoin.signature : null,
        firstBuy,
        sniper: !!(launchS && firstBuy != null && firstBuy >= launchS - 1 && firstBuy - launchS <= SNIPE_S)
      };
    }));
    const owners = new Set(read2.map((h) => h.owner));
    const counts = /* @__PURE__ */ new Map();
    for (const h of read2) for (const v of [h.funder, h.sentBy]) if (v && v !== creator && !owners.has(v)) counts.set(v, (counts.get(v) || 0) + 1);
    const shared2 = [...counts].filter(([, n2]) => n2 >= 2).map(([v]) => v);
    const busy = /* @__PURE__ */ new Set();
    await Promise.all(shared2.map(async (v) => {
      const sigs = await history2(rpc, v);
      if (!Array.isArray(sigs)) {
        busy.add(v);
        return;
      }
      if (sigs.length >= BUSY && (sigs[0].blockTime || 0) - (sigs[sigs.length - 1].blockTime || 0) < 86400) busy.add(v);
    }));
    const groups = linkHolders(read2, { creator, busy });
    const linkedOwners = new Set(groups.flatMap((g) => g.owners));
    const linked = read2.filter((h) => linkedOwners.has(h.owner));
    const snipers = read2.filter((h) => h.sniper);
    const sum = (list) => list.reduce((s, h) => s + h.pct, 0);
    return {
      ok: true,
      at: Date.now(),
      launch: launchS || null,
      read: read2.filter((h) => h.read).length,
      traced: read2.filter((h) => h.traced).length,
      devPct: devRow ? devRow.amount / supply * 100 : null,
      holders: read2.map((h) => ({ ...h, linked: linkedOwners.has(h.owner) })),
      groups,
      linked: { wallets: linked.length, pct: sum(linked) },
      snipers: { wallets: snipers.length, pct: sum(snipers) }
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

  // extension/src/ui/watchlist.js
  var WATCHLIST_KEY = "radar-watchlist";
  var MAX_STARS = 20;
  var starOf = (t, post = null, now = Date.now()) => ({
    address: t.address,
    chain: t.chain,
    symbol: String(t.symbol || "").slice(0, 20),
    name: String(t.name || "").slice(0, 60),
    image: t.image || null,
    cap: t.marketCap || 0,
    liq: t.onCurve ? 0 : t.liquidity || 0,
    post: post || null,
    t: now
  });
  function toggleStar(list, star) {
    if (!star?.address) return list;
    if (list.some((s) => s.address === star.address)) return list.filter((s) => s.address !== star.address);
    return list.length >= MAX_STARS ? list : [star, ...list];
  }
  var sinceStar = (star, cap) => star?.cap > 0 && cap > 0 ? (cap / star.cap - 1) * 100 : null;

  // extension/src/lib/handlers.js
  var API_BASE = "https://narrative-radar.millenia-portfolio.workers.dev";
  var DEFAULTS = { rpcUrl: "", chains: ["solana", "robinhood"], refreshSec: 10 };
  function makeHandlers(host) {
    let rpcState = { url: null, rpc: null };
    function rpcFor(url2) {
      const u = url2 || PUBLIC_RPC;
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
    async function read2({ post }) {
      const s = await host.settings();
      const key2 = `rd:${postKey(post, s.chains)}`;
      return forgetIfFailed(key2, cached(key2, 3e5, () => readPost(post, s.chains, { apiBase: API_BASE, cached })));
    }
    async function coins2({ post, judge = false }) {
      const s = await host.settings();
      const key2 = `co:${judge ? "j:" : ""}${postKey(post, s.chains)}`;
      return forgetIfFailed(key2, cached(key2, 12e4, async () => {
        const r = await read2({ post });
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
    const famRpc = makeRpc(PUBLIC_RPC, { concurrency: 2 });
    async function family({ mint, quote = null }) {
      const parent = parentOf({ address: mint, quote });
      return cached(`fam:${mint}`, 6e5, async () => familyDetails(await familyCounts(mint, famRpc))).then((f) => ({ ...f, parent }), () => parent ? { children: 0, parent } : Promise.reject(new Error("Family unavailable")));
    }
    async function devRecord2({ mint }) {
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(mint || ""))) throw new Error("Not a coin address");
      return cached(`dev:${mint}`, 6e5, () => devRecord(mint, famRpc));
    }
    async function links2({ mint, creator = null, launchS = null, pairs = [] }) {
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(mint || ""))) throw new Error("Not a coin address");
      const s = await host.settings();
      await host.ready;
      const rpc = rpcFor(await host.rpcUrl(s));
      return cached(`wl:${mint}`, 6e5, () => walletLinks(rpc, mint, { creator, launchS, exclude: pairs }));
    }
    async function askCoin({ coin, question, evidence }) {
      const h = await holderStored();
      if (!h) throw new Error("This is for $RADAR and $LARPCHECK holders. Check your wallet first.");
      const res = await fetch(`${API_BASE}/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: h.token, coin, question, evidence }), signal: AbortSignal.timeout(3e4) });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) await host.store.set(HOLDER_KEY, null);
      if (!res.ok) throw new Error(data.error || `Ask ${res.status}`);
      return data;
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
    async function typedTicker({ tickers = [] }) {
      const s = await host.settings();
      for (const raw of tickers.slice(0, 2)) {
        const tk = String(raw || "").toUpperCase();
        if (!/^[A-Z][A-Z0-9]{1,11}$/.test(tk) || MAJOR_TICKERS.has(tk)) continue;
        const found = await cached(`tt:${tk}:${s.chains}`, 6e4, async () => aggregate(await searchPairs(tk).catch(() => [])).filter((t) => s.chains.includes(t.chain) && isMemecoin(t) && String(t.symbol || "").toUpperCase() === tk && t.mcapBacked && alive(t) && (t.volume?.h24 || 0) >= 1e3 && (!STOCK_TICKERS.has(tk) || (t.marketCap || 0) >= 1e5) && (tk !== "RADAR" || t.address === "BTmeAebSh8MaYsTDiBiix79htKckjYQP5fvucFoFpump")).sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0))[0] || null);
        if (found) return found;
      }
      return null;
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
        const seen = rc?.detectedAt ? Date.parse(rc.detectedAt) : Infinity;
        const hintMs = Math.min(launchMs || Infinity, seen);
        const url2 = await host.rpcUrl(s);
        const result = await analyzeLaunch(rpcFor(url2), mint, launchMs, pairs, {
          maxPages: url2 ? 40 : 10,
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
    async function videoInfo({ url: url2 }) {
      const id = String(url2 || "").match(/status\/(\d+)/)?.[1];
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
    async function tweet2({ url: url2 }) {
      return cached(`tw:${url2}`, 6e5, async () => {
        const res = await fetch(`${API_BASE}/tweet?url=${encodeURIComponent(url2)}`, { signal: AbortSignal.timeout(1e4) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Couldn't open that post");
        if (data.post) {
          for (const k of ["text", "quoted", "parent"]) if (data.post[k]) data.post[k] = await typedCashtags(data.post[k], linkedSymbol);
        }
        if (data.post?.text && data.source?.label) data.source.label = data.post.text.replace(/\s+/g, " ").slice(0, 90);
        return data;
      });
    }
    async function openWindow2({ url: url2 }) {
      if (!/^https:\/\/(v2\.)?bubblemaps\.io\//.test(url2)) throw new Error("Blocked URL");
      await host.openWindow(url2);
      return true;
    }
    async function reroute2({ post, candidates = null, named = [], where = "post" }) {
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
    async function image({ url: url2 }) {
      if (!host.inlineImages) return url2;
      return cached(`img:${url2}`, 36e5, async () => {
        const small = url2.replace(/width=\d+/, "width=128").replace(/height=\d+/, "height=128").replace(/quality=\d+/, "quality=90");
        let res = await fetch(small);
        if (!res.ok) res = await fetch(url2);
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
    async function track() {
      const h = await holderStored().catch(() => null);
      return cached(`tr:${h?.token ? "h" : "p"}`, 6e4, async () => {
        const res = await fetch(`${API_BASE}/track-record`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: h?.token, hours: 24 }), signal: AbortSignal.timeout(12e3) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Track record ${res.status}`);
        return data;
      });
    }
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
        const live = new Map(tokens.map((t) => [t.address, t]));
        const coin = (c) => {
          const t = live.get(c.a);
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
    const handlers2 = { typedTicker, forgetCoins, breaking, track, starList, starToggle, videoInfo, tweet: tweet2, read: read2, coins: coins2, fresh, postCoins: postCoins2, mentioned, story, larpcheck, family, devRecord: devRecord2, links: links2, askCoin, refresh, safety, bundle, image, openWindow: openWindow2, reroute: reroute2, holderStatus, holderSave, holderWho, holderActive, recentList, recentAdd, recentClear, launchState, lcHolders, lcBoard, lcSettings, lcStart, lcAsk, lcPoll, settings: () => host.settings() };
    handlers2.resetBundles = () => memo.forEach((_, k) => k.startsWith("bd:") && memo.delete(k));
    return handlers2;
  }

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
    launchBought: [5, 50],
    drop: [20, 50]
  };
  var LAUNCH_NOT_OK = 20;
  var NEUTRAL_MAX = 59;
  var level = (v, [watch, risk]) => v == null ? null : v >= risk ? "risk" : v >= watch ? "watch" : "ok";
  function dropIfSold(soldPct2, poolTokens, supplyTokens) {
    if (!soldPct2 || !poolTokens || !supplyTokens) return null;
    const x = soldPct2 / 100 * supplyTokens;
    return (1 - (poolTokens / (poolTokens + x)) ** 2) * 100;
  }
  function linksSub(l) {
    if (!l?.ok) return "";
    if (!l.linked.wallets) return `none of the top ${l.holders.length} \xB7 ${l.read} read`;
    const kinds = [...new Set(l.groups.flatMap((g) => g.kinds))];
    return `${l.linked.wallets} wallet${l.linked.wallets === 1 ? "" : "s"} \xB7 ${kinds.join(", ")}`;
  }
  var linksKnown = (l) => !!(l?.ok && l.holders?.length && (l.linked.wallets > 0 || l.read * 2 >= l.holders.length));
  function coinCheck(token, rug, bundle, links2 = null) {
    if (!rug && !bundle?.ok) return null;
    const b = bundle?.ok ? bundle : null;
    const l = links2?.ok && links2.holders?.length ? links2 : null;
    const known = linksKnown(l);
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
    const traced = known ? l.linked.pct : null;
    const insiders = Math.max(launchHeld ?? 0, linked ?? 0, traced ?? 0);
    const lvIns = level(insiders, T.insiders);
    note(lvIns, 10, 30);
    if (launchHeld != null || linked != null || traced != null) {
      const sub = !insiders ? "" : traced != null && traced >= insiders ? `${l.linked.wallets} linked top wallets` : linked != null && linked >= (launchHeld ?? 0) ? `${rug.insiderWallets} linked wallets` : "launch wallets";
      facts.push({ k: "Insiders hold", v: insiders, lvl: lvIns, sub });
    }
    if (known) facts.push({ k: "Linked top wallets hold", v: l.linked.pct, lvl: level(l.linked.pct, T.insiders), sub: linksSub(l) });
    else if (l) facts.push({ k: "Linked top wallets", text: `${l.holders.length - l.read} of the top ${l.holders.length} couldn't be read`, lvl: null });
    if (l?.launch) {
      const lvSnipe = level(l.snipers.pct, T.launchHeld);
      const rank = { ok: 0, watch: 1, risk: 2 };
      if (rank[lvSnipe] > rank[level(b?.bundleHeldPct ?? 0, T.launchHeld)]) note(lvSnipe, 5, 12);
      facts.push({ k: "Snipers hold", v: l.snipers.pct, lvl: lvSnipe, sub: l.snipers.wallets ? `${l.snipers.wallets} bought in the first 10 s` : "none in the top wallets" });
    }
    const dev = b || rug?.creatorPct != null ? Math.max(b?.devHeldPct ?? 0, rug?.creatorPct ?? 0) : null;
    const lvDev = level(dev, T.dev);
    note(lvDev, 6, 18);
    if (dev != null) facts.push({ k: "Dev holds", v: dev, lvl: lvDev });
    if (b) {
      const lvLaunch = level(b.bundleHeldPct, T.launchHeld);
      note(lvLaunch, 5, 12);
      facts.push({ k: "Launch buyers still hold", v: b.bundleHeldPct, lvl: lvLaunch });
      const lvBought = level(b.bundledPct, T.launchBought);
      note(lvBought, 5, 12);
      if (lvBought !== "ok") facts.push({ k: "Launch block bought", v: b.bundledPct, lvl: lvBought });
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
    if (rug && !token?.onCurve && rug.lpLockedPct != null && rug.lpLockedPct < 50) {
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
    if (b && b.bundledPct >= LAUNCH_NOT_OK) score = Math.min(score, NEUTRAL_MAX);
    score = Math.max(0, Math.min(100, Math.round(score)));
    const word = score < 35 ? "CONTROLLED" : worst === "risk" ? "SKETCHY" : score >= 60 ? "OK" : "NEUTRAL";
    return { score, word, call: callLine(word, facts), facts };
  }
  var pctText = (v) => `${Math.abs(v) < 10 ? Math.abs(v).toFixed(1) : Math.round(Math.abs(v))}%`;
  function callLine(word, facts) {
    const ranked = facts.filter((f) => f.lvl === "risk").concat(facts.filter((f) => f.lvl === "watch"));
    const pick = (ranked.length ? ranked : facts.filter((f) => f.lvl)).slice(0, 2).map((f) => f.text ? `${f.k.toLowerCase()}: ${f.text.toLowerCase()}` : f.unit === "price" ? `insiders selling would drop price ~${pctText(f.v)}` : `${f.k.toLowerCase()} ${pctText(f.v)}`);
    if (!pick.length) return "";
    const s = pick.join(" \xB7 ");
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // extension/src/ui/devrecord.js
  var SERIAL = 10;
  function devSummary(r) {
    if (!r?.creator || !r.launches) return null;
    const n2 = r.launches;
    const fmt = (x) => x.toLocaleString("en-US");
    if (n2 === 1) return { head: "Its only coin on pump.fun", sub: r.thisBonded ? "It bonded" : "Not bonded yet", level: "neutral" };
    return {
      head: `${fmt(n2)} coins from this wallet`,
      sub: `${fmt(r.bonded)} bonded \xB7 ${fmt(n2 - r.bonded)} not bonded`,
      level: n2 >= SERIAL ? "warn" : "neutral"
    };
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
    return `<div class="story ${lcTone(lc.verdict)}${open ? " open" : ""}">
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
    return page ? `<div class="lc-foot own"><span>Radar's own read. Not on Larpcheck yet.</span>${ext(page, `Check ${symbol ? `$${esc(symbol)}` : "it"} on Larpcheck \u2197`, "lc-btn")}</div>` : "";
  }

  // extension/src/ui/radar.js
  var GUARD_MINUTES = 5;
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
  var X_POST = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/(?:\w+|i\/web)\/status\/\d+\S*$/i;
  var isPostLink = (s) => X_POST.test(String(s || "").trim());
  var CA = /^(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/;
  var scansOnPaste = (s) => isPostLink(s) || CA.test(String(s || "").trim());
  var esc2 = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  function usd(n2, { compact = true } = {}) {
    if (n2 == null || !Number.isFinite(n2)) return "\u2014";
    const a = Math.abs(n2);
    if (!compact || a < 1e3) return `$${a < 10 ? n2.toFixed(2) : Math.round(n2).toLocaleString("en-US")}`;
    const [d, s] = a >= 9995e5 ? [1e9, "B"] : a >= 999500 ? [1e6, "M"] : [1e3, "K"];
    const v = n2 / d;
    return `$${Math.abs(v) >= 99.95 ? v.toFixed(0) : Math.abs(v) >= 9.995 ? v.toFixed(1) : v.toFixed(2)}${s}`;
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
  var num = (n2) => n2 == null ? "\u2014" : n2 >= 999950 ? `${(n2 / 1e6).toFixed(2)}M` : n2 >= 1e4 ? `${(n2 / 1e3).toFixed(1)}K` : Math.round(n2).toLocaleString("en-US");
  var GECKO_NETWORK = { solana: "solana", robinhood: "robinhood", base: "base", bsc: "bsc", ethereum: "eth" };
  function chartEmbed(t, theme = "dark") {
    const network = GECKO_NETWORK[t?.chain];
    if (!network || !/^[A-Za-z0-9]{20,70}$/.test(t?.pair || "")) return null;
    return `https://www.geckoterminal.com/${network}/pools/${t.pair}?embed=1&info=0&swaps=0&light_chart=${theme === "light" ? 1 : 0}`;
  }
  function chartFrameSrc(embed, { onX = /(^|\.)(x|twitter)\.com$/.test(location.hostname), getURL = globalThis.chrome?.runtime?.getURL } = {}) {
    if (!embed) return null;
    if (!onX) return embed;
    return getURL ? `${getURL("src/ui/chart.html")}?u=${encodeURIComponent(embed)}` : null;
  }
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
    star: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M12 3l2.7 5.8 6.3.8-4.6 4.3 1.2 6.2L12 17.1 6.4 20.1l1.2-6.2L3 9.6l6.3-.8z"/></svg>',
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
    typed: { label: "TICKER IN THE POST", icon: I.pin },
    bio: { label: "POSTER'S BIO", icon: I.pin },
    more: { label: "MATCH", icon: I.pin },
    new: { label: "NEW PAIR", icon: I.spark }
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
  var SORT_KEY = "nr:new-sort";
  var prefSort = () => {
    try {
      return localStorage.getItem(SORT_KEY) === "big" ? "big" : "new";
    } catch {
      return "new";
    }
  };
  var setPrefSort = (v) => {
    try {
      localStorage.setItem(SORT_KEY, v);
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
  function checkWord(c, rug) {
    const flagged = c.word === "OK" && !!rug && seriousWarning(reportBlock(rug));
    const partial = !flagged && c.word === "OK" && (!rug || !!reportSource(rug)?.fallback);
    return { flagged, partial, word: flagged ? "FLAGGED" : partial ? "PARTIAL" : c.word };
  }
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
  async function frameGrid(src, { cols = 3, rows = 2, cellW = 320, timeoutMs = 6e3 } = {}) {
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
      this.tab = "picks";
      this.newSort = prefSort();
      this.openCards = /* @__PURE__ */ new Set();
      this.refreshSec = 10;
      this.timers = [];
      this.scanId = 0;
      this.view = "scan";
      this.stars = [];
      send("starList").then((list) => {
        this.stars = list || [];
        this.renderHead();
        if (this.view === "scan" && this.state.ts) this.syncStarButtons();
      }).catch(() => {
      });
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
    open({ post = null, text = "", source = null, trends = null, tab = "picks" } = {}) {
      if (trends) this.trends = trends;
      this.shell.classList.add("open");
      const p = post || (text ? { text } : null);
      if (p) this.tab = tab === "new" ? "new" : "picks";
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
      if (this.scrollEl) this.scrollEl.scrollTop = 0;
      send("launchState").then((s) => {
        this.launchOn = s?.state === "on";
      }).catch(() => {
      });
      const id = ++this.scanId;
      const stale = () => id !== this.scanId;
      const asked = post?.url || post?.text;
      if (this.view === "stars" || this.view === "feed") this.view = "scan";
      this.stopTimers();
      this.lastPost = post;
      this.state = { ...this.state, loading: true, early: [], error: null, narrative: null, heard: "", typedExtra: null, engineError: null, story: null, source: source ?? this.state.source };
      this.updateLive();
      this.renderFoot();
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
        send("postCoins", { post }).then((early) => {
          if (stale() || !this.state.loading || !early?.length) return;
          this.state = { ...this.state, early };
          for (const t of early) this.tokens.set(t.address, t);
          this.renderBody();
          this.hydrateImages();
          for (const t of early) {
            this.loadAudit(t);
            this.loadLarp(t);
          }
        }).catch(() => {
        });
        const p = await this.preparePost(post, id);
        if (stale()) return;
        const read2 = await send("read", { post: p });
        if (stale()) return;
        this.state = { ...this.state, narrative: read2.narrative, heard: read2.post?.transcript || "" };
        this.renderHead();
        const res = await send("coins", { post: p });
        if (stale()) return;
        this.bodyEl.dataset.timing = JSON.stringify(res.timing || {});
        this.showCoins(res);
        this.loadStory(p, read2.narrative, res, id);
        send("recentAdd", { item: recentItem({ asked, source, narrative: read2.narrative, res }) }).catch(() => {
        });
        if (read2.speechPending) this.readSpeech(p, res, id);
      } catch (e) {
        if (stale()) return;
        this.state = { ...this.state, loading: false, error: e.message };
        this.updateLive();
        this.renderFoot();
        this.renderHead();
        this.renderBody();
      }
    }
    showCoins(res) {
      this.state = { ...this.state, roleCandidates: [], roleCut: 0, ...res, loading: false };
      this.tokens.clear();
      for (const t of [...res.mentioned, ...res.bioCoins || [], ...res.techMatch ? [res.techMatch] : [], ...res.roleCandidates || [], ...res.picks.map((x) => x.token), ...res.others, ...res.newPairs || []]) this.tokens.set(t.address, t);
      this.renderHead();
      this.renderBody();
      this.renderFoot();
      this.loadAudits();
      this.startTimers();
      this.lookUpTyped();
    }
    // The ticker a post types, when the scan's coins don't hold it: looked up on its own, then pinned first.
    async lookUpTyped() {
      const id = this.scanId;
      const tickers = this.typedTickers();
      if (!tickers.length || this.typedCoin() || this.state.mentioned?.length || this.bioCards().length) return;
      const t = await send("typedTicker", { tickers }).catch(() => null);
      if (id !== this.scanId || !t?.address) return;
      this.tokens.set(t.address, t);
      this.state = { ...this.state, typedExtra: t };
      this.renderBody();
      this.hydrateImages();
      this.loadAudit(t);
      this.loadLarp(t);
    }
    // A video's speech comes in after the first answer. When it changes which coins the post is about, the cards follow.
    async readSpeech({ quickRead, ...post }, shown, id) {
      const read2 = await send("read", { post }).catch(() => null);
      if (id !== this.scanId || !read2?.post?.transcript) return;
      const res = await send("coins", { post }).catch(() => null);
      if (id !== this.scanId || !res) return;
      const coinsOf = (r) => [...r.mentioned, ...(r.picks || []).map((p) => p.token)].map((t) => t.address).join();
      this.state = { ...this.state, narrative: read2.narrative, heard: read2.post.transcript };
      this.renderHead();
      if (coinsOf(res) === coinsOf(shown)) return;
      this.showCoins(res);
      this.loadStory(post, read2.narrative, res, id);
    }
    // Video posts: pull the MP4, grid its frames for the vision model, keep the MP4 for transcription.
    preparePost(post, id = null) {
      if (!post?.hasVideo || !post.url) return Promise.resolve(post);
      if (!this.prepared.has(post.url)) {
        this.prepared.set(post.url, (async () => {
          const info = post.videoUrl ? { mp4: post.videoUrl, gif: post.gif } : await send("videoInfo", { url: post.url }).catch(() => null);
          if (!info?.mp4) return post;
          const grid = await frameGrid(info.mp4).catch(() => null);
          return { ...post, videoUrl: info.mp4, gif: info.gif, quickRead: true, images: [grid, ...post.images || []].filter(Boolean).slice(0, 3) };
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
    async rescan() {
      if (!this.lastPost) return;
      await this.preparePost(this.lastPost).then((post) => send("forgetCoins", { post })).catch(() => {
      });
      this.scan({ post: this.lastPost });
    }
    cardTokens() {
      const tokens = [...this.state.mentioned, ...this.bioCards(), ...this.state.techMatch ? [this.state.techMatch] : [], ...this.state.picks.map((p) => p.token), ...this.state.others.filter((t) => this.expanded.has(t.address)), ...this.newCards()];
      return [...new Map(tokens.map((t) => [t.address, t])).values()].map((t) => this.tokens.get(t.address) || t);
    }
    // On the New tab the newest three get full cards and their checks; the rest wait until they're opened.
    newCards() {
      return this.tab === "new" ? this.sortedNew().filter((t, i) => i < 3 || this.expanded.has(t.address)) : [];
    }
    // By the numbers from the scan, not the live ones, so cards don't swap places on every refresh. A cap with no real liquidity behind it counts for nothing.
    sortedNew() {
      const list = this.state.newPairs || [];
      if (this.newSort !== "big") return list;
      const cap = (t) => t.mcapBacked === false ? 0 : t.marketCap || 0;
      return [...list].sort((a, b) => cap(b) - cap(a));
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
      const own = this.tokens.get(addr)?.chain === "solana";
      const h = card.querySelector('[data-k="holders"]');
      if (!own && h && v.holders != null) h.textContent = num(v.holders);
      const el = card.querySelector(`[data-lch="${addr}"]`);
      if (!el || !v.line) return;
      el.hidden = false;
      el.className = `hc ${v.ok ? "ok" : "no"}`;
      if (!own) card.classList.toggle("danger", !v.ok && seriousWarning(v.line));
      el.innerHTML = `<span class="hc-mark">${v.ok ? "\u2713" : "\u2715"}</span><span class="hc-text">${esc2(v.line)}<small>${esc2(["Larpcheck", since(v.at)].filter(Boolean).join(" \xB7 "))}</small></span><a class="hc-by" href="${esc2(v.page)}" target="_blank" rel="noopener noreferrer">Larpcheck \u2197</a>`;
    }
    async loadAudit(t, { force = false } = {}) {
      if (t.chain !== "solana") return this.loadLcHolders(t);
      this.loadLcHolders(t).catch(() => {
      });
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
        a.bundleAt = Date.now();
        a.bundleErr = null;
      }).catch((e) => {
        a.bundleErr = e.message || "Couldn't read the launch block";
      }).finally(() => this.renderAudit(t.address));
      const fam = send("family", { mint: t.address, quote: t.quote }).then((f) => {
        a.family = f;
      }).catch(() => {
      }).finally(() => this.renderFamily(t.address));
      const dev = send("devRecord", { mint: t.address }).then((d) => {
        a.dev = d;
      }).catch(() => {
      }).finally(() => this.renderDev(t.address));
      a.ready = Promise.allSettled([rug, bundle, fam, dev]);
      await a.ready;
      a.loading = false;
      if (this.openCards.has(t.address)) this.loadLinks(t);
    }
    // Wallet links and snipers (lib/links.js): read the first time a Solana card is opened, after the launch scan, which
    // gives the launch time and the dev. Kept 10 minutes by the handler.
    async loadLinks(t) {
      if (t?.chain !== "solana") return;
      const a = this.audits.get(t.address) || {};
      if (a.links || a.linksLoading) return;
      a.linksLoading = true;
      this.audits.set(t.address, a);
      this.renderAudit(t.address);
      await a.ready?.catch(() => {
      });
      const creator = a.dev?.creator || a.bundle?.creator || a.rug?.creator || null;
      const launchS = a.bundle?.ok && a.bundle.launchTime ? a.bundle.launchTime : null;
      try {
        a.links = await send("links", { mint: t.address, creator, launchS, pairs: t.pairAddresses || [] });
        a.linksErr = null;
      } catch (e) {
        a.linksErr = e.message || "Couldn't trace the wallets";
      }
      a.linksLoading = false;
      this.renderAudit(t.address);
    }
    // Ask Radar about a coin card (holders): the answer comes only from what this card shows.
    coinEvidence(t) {
      const a = this.audits.get(t.address) || {};
      const c = coinCheck(t, a.rug, a.bundle, a.links);
      const p = (v) => v == null ? "unknown" : `${Number(v) < 10 ? Number(v).toFixed(1) : Math.round(Number(v))}%`;
      const lines = [
        `$${String(t.symbol || "").trim()} (${t.name || "no name"}) on Solana, contract ${t.address}`,
        `Market cap ${usd(t.marketCap)}${t.onCurve ? ", still on its bonding curve" : `, liquidity ${usd(t.liquidity)}`}, 24h volume ${usd(t.volume?.h24)}, ${tradesLine(t)}, age ${age(t.createdAt)}`,
        `Price change: 5m ${pct2(t.priceChange?.m5)}, 1h ${pct2(t.priceChange?.h1)}, 24h ${pct2(t.priceChange?.h24)}`
      ];
      if (c) lines.push(`Radar's coin check: ${c.word} ${c.score}/100`, ...c.facts.map((f) => `${f.k}: ${f.text || (f.unit === "price" ? `price would fall about ${Math.abs(Math.round(f.v))}%` : p(f.v))}${f.sub ? ` (${f.sub})` : ""}`));
      const r = a.rug;
      if (r) {
        lines.push(`Holders: ${r.holders ?? "unknown"}; mint authority ${r.mintAuthority ? "on" : "off"}, freeze authority ${r.freezeAuthority ? "on" : "off"}${r.lpLockedPct != null && !t.onCurve && r.source !== "larpcheck" ? `; ${Math.round(r.lpLockedPct)}% of liquidity locked or burned` : ""}`);
        const block = reportBlock(r);
        lines.push(block ? `Radar's holder check fails: ${block}` : "Radar's holder check passes");
      }
      const b = a.bundle;
      if (b?.ok) lines.push(`Launch block: ${b.bundleWallets} wallets bought ${p(b.bundledPct)} and still hold ${p(b.bundleHeldPct)}; the dev bought ${p(b.devBoughtPct)} and holds ${p(b.devHeldPct)}`);
      const d = devSummary(a.dev);
      if (d) lines.push(`Dev wallet: ${d.head}, ${d.sub}`);
      const l = a.links?.ok ? a.links : null;
      if (l) {
        lines.push(...l.groups.slice(0, 4).map((g) => `${g.owners.length} top wallet${g.owners.length === 1 ? "" : "s"} linked (${g.kinds.join(", ")}) hold ${p(g.pct)}`));
        lines.push(`Radar read where ${l.read} of the top ${l.holders.length} wallets got their coins${l.launch ? `; ${l.snipers.wallets} got them in the first 10 seconds` : ""}`);
      }
      const s = this.state.story;
      if (s?.word && !s.larpcheck && s.coin && String(s.coin).toUpperCase() === String(t.symbol || "").trim().toUpperCase()) {
        lines.push(`Radar's larp check of the post: ${s.word} ${s.score}. ${s.call || ""}`, ...(s.findings || []).slice(0, 5).map((f) => `${f.kind}: ${f.text}`));
      }
      return lines.map((x) => String(x).slice(0, 300)).slice(0, 30);
    }
    askHtml(t) {
      if (!this.holder?.on) return "";
      if (!this.holder.holder) return '<div class="holder-line ask-line"><span>Holders can ask Radar about this coin</span><button type="button" data-holder-connect>Check my wallet</button></div>';
      const ans = this.coinAnswers?.get(t.address);
      return `<form class="lc-ask" data-ask-coin="${esc2(t.address)}"><input type="text" maxlength="300" placeholder="Ask Radar about this coin" autocomplete="off" spellcheck="false" /><button type="submit"${ans?.busy ? " disabled" : ""}>${ans?.busy ? "\u2026" : "Ask"}</button></form>
      ${ans?.error ? `<div class="story-note">${esc2(ans.error)}</div>` : ""}
      ${ans?.answer ? `<div class="lc-answer"><small>${esc2(ans.question)}</small><p>${esc2(ans.answer)}</p><span>Answer by <b>Radar</b>, from this card. Not financial advice.</span></div>` : ""}`;
    }
    async runAskCoin(addr, question) {
      const t = this.tokens.get(addr);
      if (!t || this.coinAnswers?.get(addr)?.busy) return;
      (this.coinAnswers ||= /* @__PURE__ */ new Map()).set(addr, { busy: true, question });
      this.renderAudit(addr);
      try {
        const { answer } = await send("askCoin", { coin: { symbol: String(t.symbol || "").trim(), address: t.address }, question, evidence: this.coinEvidence(t) });
        this.coinAnswers.set(addr, { answer, question });
        this.askAnswered = addr;
      } catch (e) {
        this.coinAnswers.set(addr, { error: e.message, question });
      }
      this.renderAudit(addr);
    }
    // Coins launched priced in this one (its children), or the coin it was itself launched under. Shown only when there is one.
    renderFamily(addr) {
      const el = this.bodyEl.querySelector(`.card[data-addr="${addr}"] [data-k="family"]`);
      const f = this.audits.get(addr)?.family;
      const t = this.tokens.get(addr);
      const parent = f?.parent;
      if (!el) return;
      if (!f?.children && !parent) {
        el.innerHTML = "";
        return;
      }
      const dex = (a) => `https://dexscreener.com/solana/${encodeURIComponent(a)}`;
      const rows = [];
      if (parent) {
        rows.push(`<div class="fam-row"><span>Launched under</span><a href="${dex(parent.address)}" target="_blank" rel="noopener noreferrer">$${esc2(parent.symbol || short(parent.address))}</a></div>
      <div class="fam-note">Priced in $${esc2(parent.symbol || "it")}, so every buy of this coin goes through it.</div>`);
      }
      if (f?.children) {
        rows.push(`<div class="fam-row"><span>Launched under $${esc2(String(t?.symbol || "").trim())}</span><b>${num(f.children)} coin${f.children === 1 ? "" : "s"}</b></div>`);
        const sub = [f.graduated ? `${num(f.graduated)} graduated` : "", f.volume ? `${usd(f.volume)} traded 24h` : ""].filter(Boolean).join(" \xB7 ");
        if (sub) rows.push(`<div class="fam-note">${sub}</div>`);
        if (f.biggest?.address) rows.push(`<div class="fam-row"><span>Biggest child</span><a href="${dex(f.biggest.address)}" target="_blank" rel="noopener noreferrer">$${esc2(String(f.biggest.symbol || "").trim())} \xB7 ${usd(f.biggest.marketCap)}</a></div>`);
      }
      el.innerHTML = `<h4>Family <em>pump.fun pairs</em></h4>${rows.join("")}`;
    }
    // The dev wallet pump.fun records for the coin, and how many coins it has launched there. Numbers only.
    renderDev(addr) {
      const el = this.bodyEl.querySelector(`.card[data-addr="${addr}"] [data-k="dev"]`);
      if (!el) return;
      const d = this.audits.get(addr)?.dev;
      const s = devSummary(d);
      const top = el.closest(".card")?.querySelector(".card-top");
      let tag = top?.querySelector("[data-devtag]");
      if (s?.level === "warn" && top) {
        if (!tag) {
          tag = document.createElement("span");
          tag.className = "tag";
          tag.dataset.devtag = "";
          top.insertBefore(tag, top.querySelector(".cc") || top.querySelector(".star-btn"));
        }
        tag.textContent = `dev made ${num(d.launches)} coins`;
      } else tag?.remove();
      if (!s) {
        el.innerHTML = "";
        return;
      }
      el.innerHTML = `<h4>Dev record <em>pump.fun</em></h4>
      <div class="fam-row"><span>Dev wallet</span><a href="https://gmgn.ai/sol/address/${esc2(d.creator)}" target="_blank" rel="noopener noreferrer" title="${esc2(d.creator)}">${esc2(short(d.creator))}</a></div>
      <div class="fam-row"><span>${esc2(s.head)}</span><b class="${s.level === "warn" ? "warn" : ""}">${esc2(s.sub)}</b></div>
      ${s.level === "warn" ? `<div class="fam-note">${num(d.launches)} launches from one wallet. Its other coins are on GMGN.</div>` : ""}`;
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
      live.querySelector("span").textContent = on ? `LIVE \xB7 ${this.refreshSec}s` : this.state.loading ? "SCANNING" : this.state.ts ? "PAUSED" : "READY";
    }
    async tick() {
      if (document.hidden || !this.inline && !this.isOpen) return;
      const list = [...this.tokens.values()].map((t) => ({ chain: t.chain, address: t.address }));
      if (!list.length) return;
      const scanAtStart = this.scanId;
      try {
        const deep = this.cardTokens().map((t) => t.address);
        const fresh = await send("refresh", {
          tokens: list,
          deep,
          roleCandidates: this.state.roleCandidates || [],
          roleCut: this.state.roleCut ?? 0
        });
        if (scanAtStart !== this.scanId) return;
        for (const [addr, t] of Object.entries(fresh.tokens || {})) {
          const prev = this.tokens.get(addr);
          if (!prev) continue;
          const next = { ...prev, ...t, relevance: prev.relevance, matched: prev.matched };
          this.tokens.set(addr, next);
          this.patchCard(prev, next);
        }
        const ranked = fresh.ranking;
        if (ranked?.picks?.length) {
          const namedCap = Math.max(0, ...this.state.mentioned.map((m) => (this.tokens.get(m.address) || m).marketCap || 0));
          const dropped = ranked.picks.filter((p) => p.role === "top" && (p.token.marketCap || 0) < namedCap);
          ranked.picks = ranked.picks.filter((p) => !dropped.includes(p));
          const ranks = new Set(ranked.roleCandidates.map((t) => t.address));
          ranked.others = [...ranked.others, ...dropped.map((p) => p.token), ...this.state.others.filter((t) => !ranks.has(t.address))].filter((t) => t.address !== this.state.techMatch?.address);
        }
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
            const scrollTop = this.scrollEl.scrollTop;
            this.renderBody();
            this.scrollEl.scrollTop = scrollTop;
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
        <div class="scroll">
          <div class="lead"></div>
          <div class="body"></div>
        </div>
        <div class="foot"></div>
        <div class="toast"></div>
      </div>`;
      this.shell = this.root.querySelector(".shell");
      this.headEl = this.root.querySelector(".head");
      this.scrollEl = this.root.querySelector(".scroll");
      this.leadEl = this.root.querySelector(".lead");
      this.bodyEl = this.root.querySelector(".body");
      this.footEl = this.root.querySelector(".foot");
      this.toastEl = this.root.querySelector(".toast");
      this.renderHead();
      this.renderBody();
      this.renderFoot();
      this.bodyEl.addEventListener("click", (e) => this.onBodyClick(e));
      this.bodyEl.addEventListener("submit", (e) => {
        const form = e.target.closest("[data-ask-coin]");
        if (!form) return;
        e.preventDefault();
        const q = form.querySelector("input").value.trim();
        if (q) this.runAskCoin(form.dataset.askCoin, q);
      });
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
      const onHeadClick = (e) => {
        const b = e.target.closest("button");
        if (!b) return;
        if ("holderConnect" in b.dataset) this.holderConnect();
        else if (b.dataset.act === "close") this.close();
        else if (b.dataset.act === "rescan") this.rescan();
        else if (b.dataset.act === "share") this.share();
        else if (b.dataset.act === "settings") {
          this.view = this.view === "settings" ? "scan" : "settings";
          this.renderBody();
          if (this.view === "settings" && !this.pings) send("alerts:breakingPings").then((p) => {
            this.pings = p;
            if (this.view === "settings") this.renderBody();
          }).catch(() => {
          });
        } else if (b.dataset.act === "stars") this.toggleStarsView();
        else if (b.dataset.act === "feed") this.toggleFeedView();
        else if (b.dataset.act === "watch") this.watch();
        else if (b.dataset.lcCheck) this.runLcCheck(b.dataset.lcCheck);
        else if (b.dataset.act === "unwatch") this.unwatch(b.dataset.id);
        else if ("story" in b.dataset) {
          this.expanded.has("story") ? this.expanded.delete("story") : this.expanded.add("story");
          this.renderHead();
        } else if (b.dataset.act === "heard-more") {
          this.expanded.has("heard") ? this.expanded.delete("heard") : this.expanded.add("heard");
          this.renderHead();
        }
      };
      this.headEl.addEventListener("click", onHeadClick);
      this.leadEl.addEventListener("click", onHeadClick);
      this.leadEl.addEventListener("submit", (e) => {
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
        <button class="icon-btn feed-head${this.view === "feed" ? " on" : ""}" data-act="feed" title="Breaking now">${I.bolt}</button>
        <button class="icon-btn star-head${this.stars?.length ? " has" : ""}${this.view === "stars" ? " on" : ""}" data-act="stars" title="Watchlist">${I.star}</button>
        ${this.inline && canSettings() ? `<button class="icon-btn" data-act="settings" title="Settings">${I.gear}</button>` : ""}
        ${this.shareable() ? `<button class="icon-btn" data-act="share" title="Copy a summary to share">${I.share}</button>` : ""}
        ${this.state.ts ? `<button class="icon-btn" data-act="rescan" title="Rescan">${I.refresh}</button>` : ""}
        ${this.inline ? "" : `<button class="icon-btn" data-act="close" title="Close (Esc)">${I.x}</button>`}
      </div>
      ${this.inline ? `<form class="search">
        ${I.search}
        <input type="text" placeholder="Search a narrative, paste a post or a CA" spellcheck="false" autocomplete="off" />
        <span class="kbd">\u21B5</span>
      </form>` : ""}
      ${source ? `<div class="source"><b>${esc2(source.kind)}</b><span>${esc2(source.label)}</span>${isPostLink(postUrl) && postTimeOf(postUrl) ? `<a href="${esc2(postUrl)}" target="_blank" rel="noopener noreferrer" title="Open the post">${age(postTimeOf(postUrl))} ago \u2197</a>` : ""}</div>` : ""}
      ${this.holderLineHtml()}`;
      this.leadEl.innerHTML = this.view === "feed" || this.view === "stars" ? "" : `${this.watchHtml()}${this.narrativeHtml()}`;
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
    // ---------- Who posted this (holders, data from Frontrun; server/holder.js) ----------
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
    // For anyone who hasn't checked a wallet: one line, on every tab.
    holderLineHtml() {
      if (!this.holder?.on || this.holder.holder || !this.lastPost || this.view !== "scan") return "";
      return '<div class="holder-line"><span>Alerts and account history for holders</span><button type="button" data-holder-connect>Check my wallet</button></div>';
    }
    whoHtml() {
      const handle = this.lastPost?.author;
      if (!this.holder?.on || !handle) return "";
      const head = '<div class="story-top who-top"><span class="story-k">Who posted this</span></div>';
      if (!this.holder.holder) return "";
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
      const names = (w.names?.names || []).filter((n2) => /^\w{1,15}$/.test(n2));
      if (names.length > 1) lines.push(`Has gone by <b class="${names.length > 2 ? "who-gone" : ""}">${names.length}</b> usernames: ${(names.length > 4 ? [...names.slice(0, 2), "\u2026", ...names.slice(-2)] : names).map((n2) => esc2(n2)).join(" \u2192 ")}`);
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
      return `<div class="story ${tone}${open ? " open" : ""}">
      <button class="story-top" data-story aria-expanded="${open}">
        <span class="story-k">Radar's larp check</span><span class="verdict ${tone}">${esc2(s.word)} <b>${s.score}</b></span>${I.chevron}
      </button>
      <div class="story-call">${esc2(s.call)}</div>
      ${open ? `<ul class="findings">${(s.findings || []).map((f) => `<li class="${esc2(f.kind)}"><span>${esc2(f.kind)}</span>${esc2(f.text)}</li>`).join("")}</ul>
        <div class="story-note">Checks evidence, not people. ${s.coin ? `Read with $${esc2(s.coin)}.` : "No coin was checked."}</div>` : ""}
      ${this.lcRunHtml(s)}
      ${lcCheckItHtml(s.lcPage, s.coin)}
    </div>`;
    }
    // Paid Larpcheck features, for holders, only when the server's key has a plan (/lc/settings).
    get lcPerks() {
      return !!(this.lcPlan && this.holder?.holder);
    }
    lcRunHtml(s) {
      if (!s.lcPage || !s.lcAddress) return "";
      const run = this.lcRun?.address === s.lcAddress ? this.lcRun : null;
      if (run?.error) return `<div class="story-note">${esc2(run.error)}</div>`;
      if (run) return `<div class="story-call keep"><span class="spinner"></span>Larpcheck is checking it${run.step ? `: ${esc2(run.step)}` : "\u2026"}</div>`;
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
      const run = this.storyRun = (this.storyRun || 0) + 1;
      const gone = () => id !== this.scanId || run !== this.storyRun;
      if (this.state.source?.kind === "Search" || !post?.text && !post?.images?.length) return;
      const t = res.mentioned[0] || res.bioCoins?.[0] || res.picks[0]?.token || null;
      if (!t) {
        if (this.state.story) {
          this.state = { ...this.state, story: null };
          this.renderHead();
        }
        return;
      }
      const coin = t ? { name: t.name, symbol: t.symbol, address: t.address, createdAt: t.createdAt, socials: t.socials, websites: t.websites, fromPost: !!t.fromPost, mentioned: res.mentioned.includes(t) } : null;
      this.state = { ...this.state, story: { loading: true } };
      this.renderHead();
      const lc = t ? await this.larpFor(t) : null;
      if (gone()) return;
      if (lc?.checked) {
        this.state = { ...this.state, story: { larpcheck: lc, coin: t.symbol } };
        this.renderHead();
        return;
      }
      try {
        const s = await send("story", { post, narrative, coin });
        if (gone()) return;
        this.state = { ...this.state, story: { ...s, coin: t?.symbol || null, lcPage: lc?.page || null, lcAddress: t?.address || null } };
      } catch (e) {
        if (gone()) return;
        this.state = { ...this.state, story: { error: e.message } };
      }
      this.renderHead();
    }
    // What's said in a video post, as Radar heard it: a coin is often only named out loud.
    heardHtml() {
      const heard = String(this.state.heard || "").replace(/\s+/g, " ").trim();
      if (!heard || heard.split(" ").length < 4 || /^(?:(?:thank you|thanks|thanks for watching|you|bye|okay|oh|[♪♫\s]+|\[(?:music|applause|silence)\])[\s.!,]*)+$/i.test(heard)) return "";
      const open = this.expanded.has("heard");
      const long = heard.length > 170;
      const shown = open || !long ? heard : `${heard.slice(0, 169).replace(/\s+\S*$/, "")}\u2026`;
      return `<div class="heard"><div class="heard-k">${I.spark}<span>Heard in the video</span></div><p>\u201C${esc2(shown)}\u201D</p>${long ? `<button type="button" data-act="heard-more">${open ? "Less" : "All of it"}</button>` : ""}</div>`;
    }
    // The coin a post types with its $ (no address in the post), from the coins the scan found: "Sharing some $meth"
    // showed $METH among the picks as the Mover, not as the post's own coin.
    typedTickers() {
      const text = [this.lastPost?.text, this.lastPost?.quoted].filter(Boolean).join(" ");
      return [...new Set([...text.matchAll(/(?:^|[^\w$])\$([A-Za-z][A-Za-z0-9]{1,11})\b/g)].map((m) => m[1].toUpperCase()))].slice(0, 3);
    }
    typedCoin() {
      const { mentioned = [], picks = [], others = [], roleCandidates = [], typedExtra = null } = this.state;
      if (mentioned.length || this.bioCards().length) return null;
      const typed = this.typedTickers();
      if (!typed.length) return null;
      if (typedExtra && typed.includes(String(typedExtra.symbol || "").toUpperCase())) return this.tokens.get(typedExtra.address) || typedExtra;
      const pool = [...picks.map((p) => p.token), ...others, ...roleCandidates].filter(Boolean).map((t) => this.tokens.get(t.address) || t);
      for (const tk of typed) {
        const hit = pool.filter((t) => String(t.symbol || "").toUpperCase() === tk && t.mcapBacked && (t.volume?.h24 || 0) >= 1e3).sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0))[0];
        if (hit) return hit;
      }
      return null;
    }
    narrativeHtml() {
      const { loading, narrative, engineError } = this.state;
      if (!loading && engineError) return `<div class="narrative"><span>Coin from the post only</span><em>${esc2(engineError)}</em></div>`;
      if (narrative) return `<div class="narrative"><span>${esc2(narrative)}</span>${loading ? "<em>finding coins\u2026</em>" : ""}</div>${this.heardHtml()}${this.storyHtml()}${this.whoHtml()}`;
      if (!loading || !this.lastPost) return "";
      const doing = this.watching ? "Watching the video\u2026" : this.lastPost.hasVideo ? "Listening to the video\u2026" : this.lastPost.images?.length ? "Looking at the image\u2026" : "Reading the post\u2026";
      return `<div class="narrative thinking"><span>${doing}</span></div>`;
    }
    // The way to launch a coin from the post being read, while the server has launching on.
    launchHtml() {
      return this.launchOn && isPostLink(this.lastPost?.url) ? '<button type="button" class="launch-btn" data-launch>Launch a coin from this post \xB7 Beta</button>' : "";
    }
    renderBody() {
      if (this.view === "settings") {
        this.bodyEl.innerHTML = this.settingsHtml();
        return;
      }
      if (this.view === "stars") {
        this.bodyEl.innerHTML = this.starsHtml();
        this.hydrateImages();
        return;
      }
      if (this.view === "feed") {
        this.bodyEl.innerHTML = this.feedHtml();
        return;
      }
      const { loading, error, picks, others, mentioned, techMatch, ts } = this.state;
      if (loading) {
        const early = this.state.early || [];
        this.bodyEl.innerHTML = (early.length ? `<div class="section-label"><span>In the post</span></div>${early.map((t) => this.cardHtml(this.tokens.get(t.address) || t, { role: "ca" })).join("")}` : "") + [0, 1, 2].slice(early.length ? 1 : 0).map(() => `
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
      const tabs = this.tabsHtml();
      if (this.tab === "new") {
        this.bodyEl.innerHTML = tabs + this.newHtml();
        this.hydrateImages();
        for (const t of this.newCards()) {
          this.renderAudit(t.address);
          this.renderLarp(t.address);
        }
        return;
      }
      const bio = this.bioCards();
      if (!picks.length && !mentioned.length && !bio.length && !techMatch && this.state.mode === "ai" && this.state.coinable === false) {
        this.bodyEl.innerHTML = `${this.state.newPairs?.length ? tabs : ""}<div class="empty"><div class="big">No coin narrative here</div>
        <p>This post doesn't carry anything people trade. Try a news post, a trend, or a meme.</p>${this.launchHtml()}</div>`;
        return;
      }
      if (!picks.length && !mentioned.length && !bio.length && !techMatch) {
        this.bodyEl.innerHTML = `${this.state.newPairs?.length ? tabs : ""}<div class="empty"><div class="big">No live coins for this narrative</div>
        <p>Nothing trading on-chain is about this yet.</p>${this.watchHtml({ cta: true })}${this.launchHtml()}</div>`;
        return;
      }
      let html = tabs;
      html += `<div class="reroute-bar"><span>Instant reroute</span><button type="button" data-reroute>Open best match</button></div>`;
      if (mentioned.length) html += mentioned.map((t) => this.cardHtml(t, { role: "ca" })).join("");
      if (bio.length) html += bio.map((t) => this.cardHtml(t, { role: "bio" })).join("");
      const typed = this.typedCoin();
      if (typed) html += this.cardHtml(typed, { role: "typed" });
      const techIsAlreadyShown = techMatch && (mentioned.some((t) => t.address === techMatch.address) || picks.some((p) => p.token.address === techMatch.address));
      if (techMatch && !techIsAlreadyShown) {
        const t = this.tokens.get(techMatch.address) || techMatch;
        html += this.cardHtml(t, { role: "tech" });
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
        }).join("")}</div>` + picks.filter((p) => p.token.address !== typed?.address).map((p) => this.cardHtml(this.tokens.get(p.token.address) || p.token, p)).join("");
      }
      if (others.length) {
        const shown = this.expanded.has("all-matches") ? others : others.slice(0, 5);
        html += `<div class="section-label"><span>More matches</span><span>${others.length}</span></div><div class="list">`;
        for (const o of shown) {
          if (o.address === typed?.address) continue;
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
    tabsHtml() {
      const n2 = this.state.newPairs?.length || 0;
      return `<div class="scan-tabs" role="tablist"><button type="button" role="tab" aria-selected="${this.tab !== "new"}" data-scan-tab="picks">Picks</button><button type="button" role="tab" aria-selected="${this.tab === "new"}" data-scan-tab="new">New${n2 ? ` \xB7 ${n2}` : ""}</button></div>`;
    }
    // The story's newest pairs. They're found by name, so the note says so, and new coins carry the most risk.
    newHtml() {
      const list = this.sortedNew();
      if (!list.length) return `<div class="empty"><div class="big">No new pairs on this story</div><p>Nothing named after it launched and traded in the last 24 hours.</p>${this.followHtml()}${this.launchHtml()}</div>`;
      const live = (t) => this.tokens.get(t.address) || t;
      const shown = this.newCards();
      const rest = list.filter((t) => !shown.includes(t)).map(live);
      const sortBtn = (v, label) => `<button type="button" data-new-sort="${v}" aria-pressed="${this.newSort === v}">${label}</button>`;
      return `<div class="section-label"><span>New pairs \xB7 last 24h</span><span class="new-sort">${sortBtn("new", "Newest")}${sortBtn("big", "Biggest")}</span></div>
      <p class="new-note">${this.newSort === "big" ? "Biggest market cap first" : "First of their name, then newest"}, matched by name to this story. New coins are the riskiest, so read the checks on each one.</p>
      ${shown.map((t) => this.cardHtml(live(t), { role: "new", fresh: t })).join("")}
      ${rest.length ? `<div class="list">${rest.map((t) => `<button class="li" data-expand="${t.address}">${this.avatarHtml(t)}
        <div class="nm"><b>${esc2(t.name)}</b><span>$${esc2(t.symbol)} \xB7 ${age(t.createdAt)}${list.find((x) => x.address === t.address)?.copyOf ? " \xB7 copy" : ""}</span></div>
        <div class="r" data-k="li-mc">${t.mcapBacked ? usd(t.marketCap) : '<span title="Market cap not backed by real liquidity">thin</span>'}<span>${num(t.txns.h1.buys)} buys 1h</span></div></button>`).join("")}</div>` : ""}
      ${this.followHtml()}${this.launchHtml()}`;
    }
    // An alert for a new pair on this story's words, on any post or none. Extension only, and the same holder perk as watching a post.
    followHtml() {
      if (!this.alerts) return "";
      const words = (this.state.words || []).filter((w) => String(w).replace(/[^\p{L}\p{N}]/gu, "").length >= 3).slice(0, 2);
      if (!words.length) return "";
      if (this.holder && !this.holder.holder && !this.alerts.watches.some((w) => w.word)) {
        return `<div class="watch on">${I.bell}<span>Alerts on new pairs are for $RADAR and $LARPCHECK holders</span>${this.holder.on ? '<button type="button" data-holder-connect>Check my wallet</button>' : ""}</div>`;
      }
      return words.map((word) => {
        const w = this.alerts.watches.find((x) => x.word && x.word.toLowerCase() === String(word).replace(/^\$+/, "").toLowerCase());
        if (w) return `<div class="watch on">${I.bell}<span>Following \u201C${esc2(w.word)}\u201D \xB7 ${Math.max(1, Math.round((w.until - Date.now()) / 36e5))}h left</span><button type="button" data-act="unwatch" data-id="${esc2(w.id)}">Stop</button></div>`;
        return `<button type="button" class="watch" data-act="follow" data-word="${esc2(word)}"${this.watchBusy ? " disabled" : ""}>${I.bell}<span>Alert me on new \u201C${esc2(word)}\u201D pairs</span></button>`;
      }).join("");
    }
    async follow(word) {
      if (this.watchBusy || !word) return;
      this.watchBusy = true;
      this.renderBody();
      try {
        this.alerts = await send("alerts:follow", { word });
        this.toast(`Following \u201C${word}\u201D for 3 days. Radar pings you when a new pair appears${this.alerts.notifications ? "" : ". Turn on desktop alerts in the toolbar popup"}`, 3600);
      } catch (err) {
        this.toast(err.message, 3600);
      }
      this.watchBusy = false;
      this.renderBody();
    }
    // The poster's bio coin gets its own card, unless a scan's own pick already shows it. A search has no poster.
    bioCards() {
      const { mode, bioCoins, picks } = this.state;
      return mode === "ai" ? (bioCoins || []).filter((t) => !(picks || []).some((p) => p.token.address === t.address)) : [];
    }
    // ---------- Watchlist ----------
    isStarred(addr) {
      return !!this.stars?.some((s) => s.address === addr);
    }
    syncStarButtons() {
      this.bodyEl.querySelectorAll("[data-star]").forEach((b) => {
        const on = this.isStarred(b.dataset.star);
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", String(on));
      });
    }
    toggleStar(addr) {
      const t = this.tokens.get(addr);
      if (!t) return;
      const was = this.isStarred(addr);
      if (!was && this.stars.length >= MAX_STARS) {
        this.toast(`Your watchlist is full (${MAX_STARS})`);
        return;
      }
      const star = starOf(t, isPostLink(this.lastPost?.url) ? this.lastPost.url : null);
      this.stars = toggleStar(this.stars, star);
      this.syncStarButtons();
      this.renderHead();
      this.toast(was ? "Off your watchlist" : "On your watchlist");
      send("starToggle", { star }).then((list) => {
        this.stars = list || [];
      }).catch(() => {
      });
    }
    removeStar(addr) {
      const star = this.stars.find((s) => s.address === addr);
      if (!star) return;
      this.stars = toggleStar(this.stars, star);
      this.renderHead();
      this.renderBody();
      send("starToggle", { star }).then((list) => {
        this.stars = list || [];
      }).catch(() => {
      });
    }
    // ---------- Breaking now (server/feed.js) ----------
    toggleFeedView() {
      this.view = this.view === "feed" ? "scan" : "feed";
      this.renderHead();
      this.renderBody();
      if (this.view === "feed") this.loadFeed();
    }
    async loadFeed() {
      clearTimeout(this.feedTimer);
      try {
        [this.feed, this.track, this.pings] = await Promise.all([send("breaking"), send("track").catch(() => this.track || null), send("alerts:breakingPings").catch(() => null)]);
      } catch (e) {
        if (!this.feed?.stories) this.feed = { error: e.message || "Could not load this" };
      }
      if (this.view !== "feed") return;
      const scrollTop = this.scrollEl.scrollTop;
      this.renderBody();
      this.scrollEl.scrollTop = scrollTop;
      this.feedTimer = setTimeout(() => {
        if (this.view === "feed") this.loadFeed();
      }, 6e4);
    }
    feedHtml() {
      const top = '<div class="recent-top"><span>Breaking now</span><button data-act-back>Back</button></div>';
      const fine = `<p class="new-note">Names only: words many new coins are launching under right now. It says what launched, not why, and it isn't a recommendation. Most of these go to zero, so read the checks.</p>`;
      const f = this.feed;
      if (!f) return `<div class="star-list">${top}<div class="empty"><span class="spinner"></span></div></div>`;
      if (f.error) return `<div class="star-list">${top}<div class="empty"><div class="big">Couldn't load this</div><p class="error">${esc2(f.error)}</p></div></div>`;
      const late = f.live ? "" : `<div class="holder-line feed-late"><span>Holders see this live. This list is 10 minutes behind.</span>${this.holder?.on ? '<button type="button" data-holder-connect>Check my wallet</button>' : ""}</div>`;
      const pings = !this.pings || !f.live ? "" : `<div class="holder-line feed-pings"><span>${this.pings.on ? "Radar pings you when a new story breaks: 8+ coins from 5+ wallets, one past $15K." : "Get an alert when a new story breaks: 8+ coins from 5+ wallets, one past $15K."}</span><button type="button" data-act="break-pings" aria-pressed="${this.pings.on}">${this.pings.on ? "Pings on" : "Turn on"}</button></div>`;
      if (!f.stories.length) return `<div class="star-list">${top}${late}${pings}<div class="empty"><div class="big">Nothing breaking right now</div><p>A story shows up here when many new coins launch under the same word, from different wallets.</p></div></div>`;
      const title = (w) => w.charAt(0).toUpperCase() + w.slice(1);
      const chip = (label, c, value) => `<button type="button" class="feed-coin" data-feed-coin="${esc2(c.address)}" data-feed-sym="${esc2(c.symbol)}" title="Scan ${esc2(c.name || c.symbol)}"><i>${label}</i><b>$${esc2(c.symbol)}</b>${value ? `<span>${esc2(value)}</span>` : ""}</button>`;
      return `<div class="star-list">${top}${late}${pings}${f.stories.map((s) => `<div class="feed-row">
        <button type="button" class="feed-open" data-feed-open="${esc2(s.words[0])}" title="Scan this story">
          <span class="feed-title"><b>${esc2(s.words.map(title).join(" \xB7 "))}</b><em>${s.coins} coins</em></span>
          <span class="feed-sub">${s.wallets} wallets \xB7 ${s.recent} in the last 10 min \xB7 began ${esc2(age(s.startedAt))} ago</span>
        </button>
        <div class="feed-coins">
          ${s.biggest && s.biggest.address !== s.first.address ? chip("Biggest", s.biggest, s.biggest.cap ? usd(s.biggest.cap) : "") : ""}
          ${chip("First", s.first, s.first.cap ? usd(s.first.cap) : "")}
        </div>
      </div>`).join("")}${fine}${this.trackHtml()}</div>`;
    }
    // Track record: every coin Radar flagged in the last day, cap when flagged, at its peak and now. Losers included.
    trackHtml() {
      const t = this.track;
      if (!t?.rows) return "";
      const s = t.summary || {};
      const x = (n2) => `${n2 >= 10 ? Math.round(n2) : n2.toFixed(1)}x`;
      const from2 = { breaking: "Breaking now", diamond: "Diamond Hand" };
      const rows = [...t.rows].sort((a, b) => b.peakX - a.peakX).slice(0, 8).map((r) => `<a class="al-hit track-row" href="https://dexscreener.com/solana/${esc2(r.mint)}" target="_blank" rel="noopener noreferrer">
        <b>$${esc2(r.symbol)}</b><span>${esc2(from2[r.source] || "")} \xB7 ${esc2(age(r.at))} ago \xB7 ${esc2(usd(r.mc0))} \u2192 peak ${esc2(usd(r.peak))} \xB7 now ${esc2(usd(r.mc))}</span><em class="${r.peakX >= 2 ? "up" : ""}">${esc2(x(r.peakX))}</em></a>`).join("");
      const late = t.live ? "" : '<p class="fine">Holders see every flag live. This list leaves out the last 30 minutes, and Diamond Hand.</p>';
      return `<div class="section-label track-label"><span>Track record \xB7 last 24h</span></div>
      <p class="new-note">${s.flags ? `${s.flags} coin${s.flags === 1 ? "" : "s"} flagged \xB7 ${s.x2} did 2x \xB7 ${s.x10} did 10x at their peak.` : "No flags in the last 24 hours yet."} Every coin Radar flagged, losers included, measured from its cap when flagged. Not advice.</p>
      ${rows ? `<div class="al-list">${rows}</div>` : ""}${late}
      <a class="fine track-all" href="https://tryradar.fun/track" target="_blank" rel="noopener noreferrer">See every flag on tryradar.fun/track</a>`;
    }
    toggleStarsView() {
      this.view = this.view === "stars" ? "scan" : "stars";
      if (this.view === "stars" && this.alerts === void 0) this.loadAlerts();
      this.renderHead();
      this.renderBody();
      this.refreshStars();
    }
    // Live numbers while the list is open, and each coin's Larpcheck verdict, a few at a time (they count against Radar's API key).
    async refreshStars() {
      clearTimeout(this.starTimer);
      if (this.view !== "stars" || !this.stars.length) return;
      if (!document.hidden) {
        const res = await send("refresh", { tokens: this.stars.map((s) => ({ chain: s.chain, address: s.address })) }).catch(() => null);
        if (this.view !== "stars") return;
        if (res?.tokens) this.starLive = res.tokens;
        this.renderBody();
        this.starLc ||= /* @__PURE__ */ new Map();
        const list = [...this.stars];
        for (let i = 0; i < list.length; i += 4) {
          await Promise.all(list.slice(i, i + 4).map((s) => send("larpcheck", { address: s.address }).then((lc) => this.starLc.set(s.address, lc)).catch(() => {
          })));
          if (this.view !== "stars") return;
          this.renderBody();
        }
      }
      this.starTimer = setTimeout(() => this.refreshStars(), 3e4);
    }
    // Radar Guard runs in the extension's background, so the web and the userscript (no alerts there) don't offer it.
    guardHtml() {
      if (!this.alerts || !this.holder?.on) return "";
      const what = "the post behind a starred coin is gone, Larpcheck's verdict turns bad, or liquidity falls 30%";
      return this.holder.holder ? `<div class="guard on">${I.bell}<div><b>Radar Guard is on</b><p>Radar checks every ${GUARD_MINUTES} minutes and alerts you if ${what}.</p></div></div>` : `<div class="guard">${I.bell}<div><b>Radar Guard is for $RADAR and $LARPCHECK holders</b><p>Hold $10 of either, or have held $RADAR at any point, and Radar alerts you if ${what}.</p><button type="button" data-holder-connect>Check my wallet</button></div></div>`;
    }
    starsHtml() {
      const top = `<div class="recent-top"><span>Watchlist${this.stars.length ? ` \xB7 ${this.stars.length}` : ""}</span><button data-act-back>Back</button></div>${this.guardHtml()}`;
      if (!this.stars.length) return `<div class="star-list">${top}<div class="empty"><div class="big">Nothing starred yet</div><p>Tap the star on a coin card to keep it here, with its change since you starred it.</p></div></div>`;
      return `<div class="star-list">${top}${this.stars.map((s) => {
        const live = this.starLive?.[s.address];
        const cap = live?.marketCap ?? s.cap;
        const since2 = live ? sinceStar(s, live.marketCap) : null;
        const lc = this.starLc?.get(s.address);
        return `<div class="star-row">
        <button class="star-open" data-star-open="${esc2(s.address)}" data-star-sym="${esc2(s.symbol)}" title="Scan $${esc2(s.symbol)}">
          ${this.avatarHtml({ address: s.address, symbol: s.symbol, image: live?.image || s.image })}
          <span class="star-names"><b>$${esc2(s.symbol)}</b><span>${esc2(s.name)}</span></span>
          <span class="star-nums"><b>${usd(cap)}${live && !live.mcapBacked && !live.onCurve ? ' <i title="Market cap not backed by real liquidity">\xB7 thin</i>' : ""}</b><em class="${since2 == null ? "" : since2 >= 0 ? "up" : "down"}">${since2 == null ? "\u2014" : `${pct2(since2, Math.abs(since2) >= 100 ? 0 : 1)} since star`}</em></span>
        </button>
        <button class="star-remove" data-star-remove="${esc2(s.address)}" title="Take off the watchlist">${I.xs}</button>
        ${lc?.checked ? `<div class="star-lc">${lcButtonHtml(lc)}</div>` : ""}
      </div>`;
      }).join("")}</div>`;
    }
    avatarHtml(t) {
      const h = hue(t.address);
      return `<div class="ava" style="--h1:hsl(${h} 70% 45%);--h2:hsl(${(h + 50) % 360} 70% 30%)" data-img="${esc2(t.image || "")}">${esc2((t.symbol || "?").replace(/^\$/, "").slice(0, 2).toUpperCase())}</div>`;
    }
    hydrateImages() {
      this.bodyEl.querySelectorAll(".ava[data-img]").forEach((el) => {
        if (!el.getClientRects().length) return;
        const url2 = el.dataset.img.replace(/^(https:\/\/cdn\.dexscreener\.com\/cms\/images\/[^?]+\?)width=800&height=800/, "$1width=128&height=128");
        if (!url2) return;
        el.removeAttribute("data-img");
        send("image", { url: url2 }).then((src) => {
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
    chartHtml(t) {
      if (!this.expanded.has(`ch:${t.address}`)) return "";
      const embed = chartEmbed(t, this.root.dataset.theme);
      const src = chartFrameSrc(embed);
      const full = esc2(t.url || `https://dexscreener.com/${t.chain}/${t.address}`);
      return `${src ? `<iframe class="chart-frame" title="Chart of $${esc2(t.symbol)}" src="${esc2(src)}" referrerpolicy="no-referrer"></iframe>` : ""}
      <a class="chart-full" href="${full}" target="_blank" rel="noopener noreferrer">${src ? "Open on DexScreener \u2197" : "Open the chart on DexScreener \u2197"}</a>`;
    }
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
      const chartOn = this.expanded.has(`ch:${t.address}`);
      const chart = chartEmbed(t) ? `<button type="button" class="chart-btn${chartOn ? " on" : ""}" data-chart="${t.address}" aria-expanded="${chartOn}">${chartOn ? "Hide chart" : "Chart"}</button>` : "";
      return `${quick}${buyBtn}${trade}${chart}<span class="lc-slot" data-lc="${t.address}">${lcButtonHtml(this.larp.get(t.address)?.lc)}</span>${frOpen ? this.frSheetHtml(t) : ""}`;
    }
    cardHtml(t, pick) {
      const role = pick.role;
      const r = ROLE[role];
      const buys = t.txns.h1.buys, sells = t.txns.h1.sells;
      const buyShare = buys + sells ? buys / (buys + sells) * 100 : 50;
      const tags = [pick.alsoOg && "also the OG", pick.alsoTop && "also top MC", pick.alsoMover && "also the mover"].filter(Boolean);
      if (this.state.techMatch?.address === t.address && role !== "tech") tags.push("TECH MATCH");
      if (pick.fresh) {
        tags.push(pick.fresh.copyOf ? `copy of older $${String(pick.fresh.copyOf.symbol || "").trim()}` : "first of this name");
        tags.push(`${num(buys)} buys 1h`);
      }
      const vsPost = launchedVsPost(t.createdAt, this.lastPost?.url);
      if (t.fromPost) tags.unshift(vsPost?.includes("after") ? `launched ${vsPost}` : "launched off this post");
      else if (vsPost) tags.push(vsPost);
      const twins = this.nameTwins(t);
      if (launchedWithRadar(t)) tags.unshift("launched with Radar, not by the poster");
      if (twins) tags.push(twins.oldest ? `oldest of ${twins.n}` : `${twins.n} named $${String(t.symbol).trim()}`);
      if (quiet(t)) tags.push(`quiet \xB7 ${tradesLine(t)}`);
      const matched = t.reason ? esc2(t.reason) : t.matched?.length ? `matches \u201C${esc2(t.matched.slice(0, 2).join("\u201D, \u201C"))}\u201D` : "";
      const open = this.openCards.has(t.address);
      const tx24 = t.txns.h24.buys + t.txns.h24.sells;
      return `
      <article class="card ${role}${open ? " open" : ""}${this.state.techMatch?.address === t.address ? " tech-match" : ""}" data-addr="${t.address}">
        <header class="card-top">
          <span class="badge">${r.icon}${r.label}</span>
          ${tags.map((x) => `<span class="tag${x.startsWith("launched") ? " hot" : x.startsWith("looks") ? " rug" : /^oldest of|named \$|^copy of/.test(x) ? " twins" : ""}">${esc2(x)}</span>`).join("")}
          ${t.chain === "solana" ? `<span class="cc" data-cc="${t.address}"></span>` : ""}
          <button class="star-btn${this.isStarred(t.address) ? " on" : ""}" data-star="${t.address}" aria-pressed="${this.isStarred(t.address)}" title="Watchlist">${I.star}</button>
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
        ${t.chain === "solana" ? `<div class="hc" data-hc="${t.address}"><span class="hc-mark wait"></span><span>Checking holders\u2026</span></div>` : ""}<div class="hc" data-lch="${t.address}" hidden></div>
        <div class="actions" data-actions="${t.address}">${this.actionsHtml(t)}</div>
        <div class="chart-box" data-chart-box="${t.address}">${this.chartHtml(t)}</div>
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
            ${t.chain === "solana" ? '<section class="family" data-k="family"></section>' : ""}
            ${t.chain === "solana" ? '<section class="family" data-k="dev"></section>' : ""}
            <section class="audit">
              <h4>Launch audit</h4>
              <div class="rows" data-k="audit"></div>
            </section>
            <div class="links">${links(t).filter(([l]) => !(l === "Chart" && chartEmbed(t))).map(([l, u]) => `<a href="${esc2(u)}" target="_blank" rel="noopener noreferrer">${l}</a>`).join("")}${BUBBLE_CHAIN[t.chain] ? `<button data-bubble="${t.address}" data-chain="${t.chain}">Bubblemaps</button>` : ""}</div>
          </div>
        </div>
      </article>`;
    }
    // How much of the supply went to the launch block, and how much of it is still sitting there.
    supplyHtml(b, at) {
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
      </div>
      <div class="src-line">${esc2(["Launch block, Solana chain", since(at)].filter(Boolean).join(" \xB7 "))}</div>`;
    }
    renderAudit(addr) {
      this.renderLcHolders(addr);
      const card = this.bodyEl.querySelector(`.card[data-addr="${addr}"]`);
      if (!card) return;
      this.renderFamily(addr);
      this.renderDev(addr);
      const t = this.tokens.get(addr);
      const rowsEl = card.querySelector('[data-k="audit"]');
      if (t?.chain !== "solana") {
        rowsEl.innerHTML = `<div class="row note"><span class="dot"></span><span class="k">Bundle & holder checks</span><span class="v">Solana only for now</span></div>`;
        return;
      }
      const a = this.audits.get(addr) || {};
      const supplyEl = card.querySelector('[data-k="supply"]');
      if (supplyEl && (a.bundle || a.bundleErr)) supplyEl.innerHTML = this.supplyHtml(a.bundle || { ok: false, reason: a.bundleErr }, a.bundleAt);
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
        const src = reportSource(r);
        const withSrc = (...bits) => bits.filter(Boolean).map(esc2).join(" \xB7 ");
        if (!coinCheck(t, a.rug, a.bundle, a.links)) {
          html += row(level2(r.top10Pct, 30, 50), "Top 10 holders", pctPlain(r.top10Pct), withSrc(r.topHolder ? `largest ${pctPlain(r.topHolder.pct)}` : "", src.holders));
          if (r.insiderWallets) html += row(level2(r.insiderPct ?? 0, 8, 20), "Insider wallets", `${r.insiderWallets}`, withSrc(r.insiderPct != null ? `hold ${pctPlain(r.insiderPct)}` : "linked by transfers", src.holders));
        }
        const auth = !r.mintAuthority && !r.freezeAuthority;
        if (r.authorityKnown !== false) html += row(auth ? "good" : "bad", "Mint / freeze", `${r.mintAuthority ? "Mintable" : "Renounced"} / ${r.freezeAuthority ? "Freezable" : "Renounced"}`, withSrc(src.authority));
        if (r.source === "larpcheck") {
          html += `<div class="row note"><span class="dot"></span><span class="k">Holder data</span><span class="v"><a href="${esc2(r.page)}" target="_blank" rel="noopener noreferrer">Larpcheck \u2197</a>${since(r.holdersAt) ? `<small>${esc2(since(r.holdersAt))}</small>` : ""}</span></div>`;
          html += `<div class="row note"><span class="dot"></span><span class="k">LP lock, insiders</span><span class="v">Not checked: RugCheck didn't answer</span></div>`;
        } else {
          if (!t.onCurve) html += row(r.lpLockedPct >= 90 ? "good" : r.lpLockedPct >= 50 ? "warn" : "bad", "LP locked / burned", pctPlain(r.lpLockedPct, 0), withSrc(src.holders));
          const danger = r.risks.filter((x) => x.level === "danger");
          html += row(r.rugged ? "bad" : level2(r.score, 20, 50), "RugCheck", r.rugged ? "RUGGED" : `${r.score ?? "\u2014"}/100 risk`, withSrc(danger[0]?.name || (r.risks[0]?.name ?? "no flags"), since(r.readAt)));
        }
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
      const sym2 = esc2(String(t.symbol).trim());
      const wl = (w) => `${esc2(w.name || "Frontrun wallet")} \xB7 ${short(w.address)} \xB7 ~${w.sol.toFixed(3)} SOL`;
      return `<div class="fr-sheet">
      <div class="fr-presets">${["0.1", "0.25", "0.5", "1"].map((v) => `<button data-fr-sol="${t.address}" data-v="${v}" class="${String(s.sol) === v ? "on" : ""}">${v} SOL</button>`).join("")}</div>
      <div class="fr-fields">
        <label><span>Amount</span><input data-fr-amt="${t.address}" value="${esc2(s.sol)}" inputmode="decimal" autocomplete="off"><em>SOL</em></label>
        <label><span>Slippage</span><select data-fr-slip="${t.address}">${[500, 1e3, 1500, 2500].map((b) => `<option value="${b}"${b === s.bps ? " selected" : ""}>${b / 100}%</option>`).join("")}</select></label>
      </div>
      ${wallets.length > 1 ? `<label class="fr-wsel"><span>Wallet</span><select data-fr-wallet="${t.address}">${wallets.map((w) => `<option value="${w.address}"${w.address === s.wallet ? " selected" : ""}>${wl(w)}</option>`).join("")}</select></label>` : `<div class="fr-wone">${wallets.length ? wl(wallets[0]) : "No Frontrun wallet yet. Create one on frontrun.pro."}</div>`}
      ${why ? `<div class="fr-warn"><span>\u2715</span>${esc2(why.charAt(0).toUpperCase() + why.slice(1))}</div>` : ""}
      <button class="fr-go" data-fr-go="${t.address}"${busy || !wallets.length ? " disabled" : ""}>${busy ? "Buying\u2026" : `Buy $${sym2} \xB7 ${esc2(s.sol)} SOL`}</button>
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
        if (!cta) return "";
        return `<div class="watch on${cta ? " cta" : ""}">${I.bell}<span>Launch alerts are for $RADAR and $LARPCHECK holders</span>${this.holder.on ? '<button type="button" data-holder-connect>Check my wallet</button>' : ""}</div>`;
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
      if (!this.state.picks?.length || this.view === "settings" || this.tab === "new") this.renderBody();
    }
    async toggleBig() {
      try {
        this.alerts = await send("alerts:bigAccounts", { on: this.alerts?.bigAccounts === false });
      } catch (err) {
        this.toast(err.message, 3e3);
      }
      this.renderBody();
    }
    async toggleFresh() {
      try {
        this.alerts = await send("alerts:fresh", { on: !this.alerts?.freshBadges });
      } catch (err) {
        this.toast(err.message, 3e3);
      }
      this.toast(this.alerts?.freshBadges ? "New-pair badges are on. Reload X to see them" : "New-pair badges are off. Reload X to hide them", 3e3);
      this.renderBody();
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
      const watches = a.watches.map((w) => `<div class="al-w"><div><b>${w.word ? `\u201C${esc2(w.word)}\u201D` : w.author ? `@${esc2(w.author)}` : "Post"}</b><span>${esc2(w.label)}</span></div>
      <em>${left(w)}</em><button type="button" data-act="unwatch" data-id="${esc2(w.id)}">Stop</button></div>`).join("");
      const hits = a.feed.slice(0, 5).map((f) => {
        if (f.kind === "signal") return `<a class="al-hit" href="${esc2(f.buy || f.watch.url)}" target="_blank" rel="noopener noreferrer"${f.buy ? ` title="${esc2(f.text)}"` : ""}><b>${f.watch.author === "Diamond Hand" ? "Diamond Hand" : `@${esc2(f.watch.author)}`}</b><span>${esc2([f.coin.name, age(f.at)].filter(Boolean).join(" \xB7 "))}</span>${f.buy ? '<em class="up">Buy on Radar</em>' : `<em>${esc2(f.text)}</em>`}</a>`;
        const c = f.coin;
        const larp = f.kind === "breaking" ? `Breaking now: ${esc2(f.watch.label)}` : f.kind === "guard" ? esc2(f.text) : f.larp ? `${f.larp.by === "Larpcheck" ? "Larpcheck" : "Larp check"} ${esc2(f.larp.word)}${f.larp.score != null ? ` ${esc2(f.larp.score)}` : ""}` : "";
        const link = f.buy || f.chart;
        return `<a class="al-hit" href="${esc2(link)}" target="_blank" rel="noopener noreferrer"><b>$${esc2(String(c.symbol || "").trim())}</b>
        <span>${esc2([CHAIN_LABEL[c.chain] || c.chain, usd(c.marketCap), age(f.at)].filter(Boolean).join(" \xB7 "))}</span>${larp ? `<em>${larp}</em>` : ""}</a>`;
      }).join("");
      return `<section class="settings">
      <div class="set-head"><h3>Alerts</h3>${a.watches.length ? `<span class="verdict ok">${a.watches.length} WATCHING</span>` : ""}</div>
      <p>Bell a post and Radar pings you when a coin launches off it.</p>
      <details class="more"><summary>How it works</summary><p>Tap the bell under a post in the Radar panel. For the next 24 hours Radar checks every minute for a coin launched off it, runs the larp check, and pings you with a buy button. On a scan's New tab you can follow a word for 3 days instead.</p></details>
      ${watches ? `<div class="al-list">${watches}</div>` : ""}
      ${hits ? `<div class="section-label"><span>Latest alerts</span></div><div class="al-list">${hits}</div>` : ""}
      ${a.notifications ? '<p class="fine">Desktop alerts are on.</p>' : '<button class="fr-btn" data-alerts-notify>Turn on desktop alerts</button><p class="fine">Without them, alerts show on any open X tab and as a number on the Radar icon.</p>'}
      <button class="fr-btn ghost" data-act="fresh-toggle">New-pair badges on X: ${a.freshBadges === false ? "Off" : "On"}</button>
      <p class="fine">Big accounts like Elon, Polymarket and Kalshi: a heads up when one posts something coins may launch off. For holders. Not a pick.</p>
      <button class="fr-btn ghost" data-act="big-toggle">Big account alerts: ${a.bigAccounts === false ? "Off" : "On"}</button>
    </section>${this.diamondHtml()}${this.bagGuardHtml()}`;
    }
    // Diamond Hand: Radar's proven early holders, the holder's own wallets, and the switch for both.
    diamondHtml() {
      const a = this.alerts;
      const mine = (a.myWallets || []).map((w) => `<div class="al-w"><div><b>${esc2(w.slice(0, 4))}\u2026${esc2(w.slice(-4))}</b><span>Your wallet</span></div><em></em><button type="button" data-act="dh-remove" data-address="${esc2(w)}">Remove</button></div>`).join("");
      return `<section class="settings">
      <div class="set-head"><h3>Diamond Hand</h3><span class="verdict ${a.holder ? "ok" : "neutral"}">${a.holder ? a.diamond === false ? "OFF" : "ON" : "HOLDERS"}</span></div>
      <p>Alerts when wallets that caught early runners buy a coin under 6 hours old.</p>
      <details class="more"><summary>How it works</summary><p>Radar watches wallets that bought recent runners in their first hour and still hold. When one buys a coin launched in the last 6 hours, you get an alert here and on X. For holders: $10 of $RADAR or $LARPCHECK, or anyone who has held $RADAR.</p></details>
      <button class="fr-btn ghost" data-act="diamond-toggle">Diamond Hand alerts: ${a.diamond === false ? "Off" : "On"}</button>
      <div class="section-label"><span>Your wallets</span></div>
      <p class="fine">Up to 5 Solana wallets, checked every 2 minutes. The list stays on this device.</p>
      ${mine ? `<div class="al-list">${mine}</div>` : ""}
      <div class="fr-connect"><input type="text" data-dh-wallet placeholder="Solana wallet address" autocomplete="off" spellcheck="false"><button class="fr-btn" data-act="dh-add">Track</button></div>
      ${a.holder ? "" : '<p class="fine">Check your wallet at the top of Radar to turn these on.</p>'}
    </section>`;
    }
    // Bag Guard: the coins in the holder's own wallets, and where each stands.
    bagGuardHtml() {
      const a = this.alerts;
      const on = a.bagGuard !== false;
      const g = a.bags;
      const rows = (g?.bags || []).map((b) => `<div class="bag-row${b.muted ? " muted" : ""}"><a class="al-hit" href="${esc2(b.url)}" target="_blank" rel="noopener noreferrer"><b>$${esc2(String(b.symbol || "").trim())}</b>
        <span>${esc2(usd(b.value))}</span><em class="${b.flagged ? "bad" : ""}">${esc2(b.status)}</em></a><button type="button" class="bag-mute" data-act="bag-mute" data-mint="${esc2(b.mint)}" data-on="${b.muted ? "0" : "1"}" aria-pressed="${b.muted ? "true" : "false"}" title="${b.muted ? "Alert me about this coin again" : "Keep watching this coin, without alerts"}">${b.muted ? "Unmute" : "Mute"}</button></div>`).join("");
      const wallets = [a.proved ? "the wallet you checked" : "", (a.myWallets || []).length ? `${a.myWallets.length} from Diamond Hand` : ""].filter(Boolean).join(" and ");
      const state = !a.holder || !on ? "" : !g ? '<p class="fine">First look in the next few minutes.</p>' : !g.wallets ? '<p class="fine">No wallets yet. Check your wallet at the top of Radar, or add one under Diamond Hand.</p>' : rows ? `<div class="section-label"><span>Your bags</span></div><div class="al-list">${rows}</div><p class="fine">Last look ${esc2(age(g.at))} ago. Mute a coin to keep it on the list without alerts.</p>` : '<p class="fine">No coins worth $5 or more in your wallets right now.</p>';
      return `<section class="settings">
      <div class="set-head"><h3>Bag Guard</h3><span class="verdict ${a.holder ? "ok" : "neutral"}">${a.holder ? on ? "ON" : "OFF" : "HOLDERS"}</span></div>
      <p>Alerts when a coin in your wallets turns, or doubles or halves.</p>
      <details class="more"><summary>How it works</summary><p>Radar watches the coins in your own wallets and alerts you the moment one turns: the dev sells, insiders dump, a top holder exits, the holder check turns serious, Larpcheck's verdict turns bad, or liquidity is pulled. It also tells you when a bag doubles or halves. Each alert opens the coin on your terminal. It says what happened; it never tells you to buy or sell.</p></details>
      <button class="fr-btn ghost" data-act="bag-toggle">Bag Guard: ${on ? "On" : "Off"}</button>
      ${a.holder && on && wallets ? `<p class="fine">Watching ${esc2(wallets)}, every 5 minutes. The wallets stay on this device.</p>` : ""}
      ${state}
      ${a.holder ? "" : '<p class="fine">For $RADAR holders. Check your wallet at the top of Radar to turn it on.</p>'}
    </section>`;
    }
    async toggleBreakingPings() {
      try {
        this.pings = await send("alerts:breakingPings", { on: !this.pings?.on });
      } catch (err) {
        this.toast(err.message, 3e3);
      }
      if (this.pings?.on) this.toast("Pings on. They show on X, on the toolbar icon, and on your desktop if desktop alerts are allowed", 3500);
      this.renderBody();
    }
    async muteBag(mint, on) {
      try {
        this.alerts = await send("alerts:bagMute", { mint, on });
      } catch (err) {
        this.toast(err.message, 3e3);
      }
      this.renderBody();
    }
    async toggleBagGuard() {
      try {
        this.alerts = await send("alerts:bagGuard", { on: this.alerts?.bagGuard === false });
      } catch (err) {
        this.toast(err.message, 3e3);
      }
      this.renderBody();
    }
    async toggleDiamond() {
      try {
        this.alerts = await send("alerts:diamond", { on: this.alerts?.diamond === false });
      } catch (err) {
        this.toast(err.message, 3e3);
      }
      this.renderBody();
    }
    async addMyWallet() {
      const input = this.bodyEl.querySelector("[data-dh-wallet]");
      try {
        this.alerts = await send("diamond:add", { address: input?.value.trim() || "" });
        this.toast("Radar is watching that wallet", 2200);
      } catch (err) {
        this.toast(err.message, 3e3);
        return;
      }
      this.renderBody();
    }
    async removeMyWallet(address) {
      try {
        this.alerts = await send("diamond:remove", { address });
      } catch (err) {
        this.toast(err.message, 3e3);
      }
      this.renderBody();
    }
    // Holder perks: everything a holder gets, in one list at the top of the alerts page, each with its state and, where
    // it has one, its switch (the same buttons as the sections below). Anyone else sees what they'd get and the check.
    perksHtml() {
      const a = this.alerts;
      if (!a || !this.holder?.on) return "";
      const holder = !!(this.holder.holder || a.holder);
      const sw = (act, on) => holder ? `<button type="button" class="perk-sw${on ? " on" : ""}" data-act="${act}" aria-pressed="${on}">${on ? "On" : "Off"}</button>` : "";
      const tag = (text) => holder ? `<em>${esc2(text)}</em>` : "";
      const watching = a.watches.length;
      const rows = [
        ["Launch alerts", "Bell a post or follow a word, and get pinged when a coin launches off it.", tag(watching ? `${watching} WATCHING` : "READY")],
        ["Big account alerts", "A heads up when Elon, Polymarket, Kalshi and more post something coins may launch off.", sw("big-toggle", a.bigAccounts !== false)],
        ["Diamond Hand", "When wallets that caught early runners buy a coin under 6 hours old.", sw("diamond-toggle", a.diamond !== false)],
        ["Bag Guard", "When a coin in your wallets turns, or doubles or halves.", sw("bag-toggle", a.bagGuard !== false)],
        ["Breaking now pings", "A ping the moment a new story starts breaking.", this.pings ? sw("break-pings", !!this.pings.on) : tag("")],
        ["Radar Guard", "When a watchlist coin's post is gone, Larpcheck's verdict turns bad, or liquidity falls 30%.", tag("ON")],
        ["Who posted this", "On any post: the account's past coins, its deleted posts and its past usernames.", tag("ON")],
        ["Ask Radar", "Ask about any coin card. Radar answers from what it found, never with a buy or sell call.", tag("ON")],
        ["Live feeds", "Breaking now and the track record as they happen. Everyone else sees them 10 and 30 minutes late.", tag("ON")]
      ].map(([name, line, end]) => `<div class="al-w perk"><div><b>${name}</b><span>${line}</span></div>${end}</div>`).join("");
      return `<section class="settings perks">
      <div class="set-head"><h3>Holder perks</h3><span class="verdict ${holder ? "ok" : "neutral"}">${holder ? "UNLOCKED" : "LOCKED"}</span></div>
      <p>${holder ? "Your wallet passed the check. Every perk below is yours." : "Hold $10 of $RADAR or $LARPCHECK, or have held $RADAR at any point, and all of this is yours."}</p>
      ${holder ? "" : '<button class="fr-btn" data-holder-connect>Check my wallet</button>'}
      <div class="al-list">${rows}</div>
    </section>`;
    }
    settingsHtml() {
      const f = this.frontrun || {};
      const wallets = (f.wallets || []).map((w) => `<div class="fr-w"><b>${esc2(w.name || "Wallet")}</b><span>${short(w.address)}</span><em>~${w.sol.toFixed(3)} SOL</em></div>`).join("");
      return `${this.perksHtml()}${this.alertsHtml()}<section class="settings">
      <div class="set-head"><h3>Frontrun</h3>${f.connected ? '<span class="verdict ok">CONNECTED</span>' : ""}</div>
      <p>Buy with your Frontrun wallet. Radar only sends an order when you press Buy.</p>
      <details class="more"><summary>How it works</summary><p>Buy the coins Radar finds with your Frontrun wallet. Frontrun holds the wallet and signs. Radar sends an order only after you press Buy on a coin card.</p></details>
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
      const key2 = input?.value.trim() || "";
      if (!/^fr_sk_[A-Za-z0-9]{64}$/.test(key2)) {
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
        this.frontrun = await send("frontrun:connect", { key: key2 });
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
      const market = marketBlock(t);
      const why = market || reportBlock(a.rug);
      el.className = `hc ${why ? "no" : "ok"}`;
      card.classList.toggle("danger", !!why && seriousWarning(why));
      card.classList.toggle("not-trading", market === "not trading");
      const by = a.rug?.source === "larpcheck" ? `<a class="hc-by" href="${esc2(a.rug.page)}" target="_blank" rel="noopener noreferrer">Larpcheck \u2197</a>` : "";
      const src = market ? ["DexScreener", since(t.updatedAt)].filter(Boolean).join(" \xB7 ") : a.rug ? reportSource(a.rug).line : "RugCheck and Larpcheck had no answer";
      const text = (s) => `<span class="hc-text">${esc2(s)}<small>${esc2(src)}</small></span>`;
      el.innerHTML = why ? `<span class="hc-mark">\u2715</span>${text(why.charAt(0).toUpperCase() + why.slice(1))}${by || "<em>Fails the check</em>"}` : by ? `<span class="hc-mark">\u2713</span>${text(a.rug.line || `Real holders \xB7 ${num(a.rug.holders)}`)}${by}` : `<span class="hc-mark">\u2713</span>${text(`Real holders \xB7 ${num(a.rug.holders)}`)}<em>Passes the check</em>`;
    }
    // Coins on the post that share this one's ticker: copycats are the usual trap on a hot narrative.
    nameTwins(t) {
      const key2 = (x) => String(x.symbol || "").trim().replace(/^\$/, "").toLowerCase();
      const k = key2(t);
      if (!k) return null;
      const group = [...this.tokens.values()].filter((x) => key2(x) === k);
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
        const c = coinCheck(t, a.rug, a.bundle, a.links);
        lines.push(`${ROLE_NAME[p.role] || "Pick"}: $${String(t.symbol).trim()} ${usd(t.marketCap)}${c ? ` \xB7 coin check ${checkWord(c, a.rug).word}${checkWord(c, a.rug).flagged ? "" : ` ${c.score}`}` : ""}`);
      }
      const st = s.story;
      if (st?.larpcheck?.checked) lines.push(`Larpcheck: ${st.larpcheck.verdict}${st.larpcheck.score != null ? ` ${st.larpcheck.score}` : ""} ${st.larpcheck.url || ""}`.trim());
      else if (st?.word) lines.push(`Larp check: ${st.word} ${st.score}`);
      const url2 = this.lastPost?.url;
      lines.push(url2 && isPostLink(url2) ? `Full scan with Radar: https://tryradar.fun/scan?url=${encodeURIComponent(url2)}` : "Found with Radar \xB7 tryradar.fun");
      return lines.join("\n");
    }
    // Only once this post's coins are in. While the next post loads, or after its scan failed, the picks are the last post's.
    shareable() {
      return !!(this.state.ts && this.state.picks?.length && !this.state.loading && !this.state.error);
    }
    async share() {
      if (!this.shareable()) return;
      try {
        await this.copyText(this.shareText());
        this.toast("Summary copied \xB7 paste it anywhere", 2200);
      } catch {
        this.toast("Could not copy the summary");
      }
    }
    // Coin check: who could move the price, as one word + score and the facts behind it.
    renderCoinCheck(card, t, a) {
      const c = coinCheck(t, a.rug, a.bundle, a.links);
      const chip = card.querySelector(`[data-cc="${t.address}"]`);
      const box = card.querySelector('[data-k="check"]');
      if (!c) {
        if (chip) chip.innerHTML = "";
        if (box) box.innerHTML = "";
        return;
      }
      const { flagged, partial, word } = checkWord(c, a.rug);
      const tone = flagged ? "risk" : partial ? "mid" : c.word === "OK" ? "ok" : c.word === "NEUTRAL" ? "mid" : "risk";
      const score = flagged ? "" : ` <b>${c.score}</b>`;
      if (chip) chip.innerHTML = `<span class="verdict ${tone}" title="Coin check: ${esc2(flagged ? reportBlock(a.rug) : c.call)}${partial ? a.rug ? ". Fallback read: no LP lock or insider data" : ". No holder report: mint and freeze unread" : ""}">${word}${score}</span>`;
      if (!box) return;
      const lvl = { ok: "good", watch: "warn", risk: "bad" };
      const val = (f) => f.text ? esc2(f.text) : f.unit === "price" ? pctPlain(f.v, 0) : pctPlain(f.v);
      const typing = box.querySelector("[data-ask-coin] input");
      const draft = typing?.value || "";
      const focused = !!typing && typing === (this.root.activeElement || document.activeElement);
      const wl = a.links?.ok ? a.links : null;
      const open = this.expanded.has(`tw:${t.address}`);
      const groupsOf = (wl?.groups || []).filter((g) => g.owners?.length);
      const letter = (i) => String.fromCharCode(65 + i % 26);
      const groupOf = (owner) => groupsOf.findIndex((g) => g.owners.includes(owner));
      const tags = (h) => `${h.linked ? ` <span class="dev">linked${groupOf(h.owner) >= 0 ? ` ${letter(groupOf(h.owner))}` : ""}</span>` : ""}${h.sniper ? ' <span class="dev">sniper</span>' : ""}${h.read ? "" : ' <span class="old">not read</span>'}`;
      const devWallet = wl?.groups.find((g) => g.dev)?.by;
      const who = (a2) => a2 === devWallet ? "the dev" : short(a2);
      const how = (h) => {
        if (!h.linked) return "";
        if (h.sentBy) return `coins from ${who(h.sentBy)}`;
        const to = wl.holders.find((o) => o.sentBy === h.owner);
        if (to) return `sent coins to ${short(to.owner)}`;
        if (h.funder && (h.funder === devWallet || wl.groups.some((g) => g.by === h.funder))) return `paid by ${who(h.funder)}`;
        const paid = wl.holders.find((o) => o.funder === h.owner);
        if (paid) return `paid ${short(paid.owner)}`;
        if (h.firstTx && wl.holders.some((o) => o !== h && o.firstTx === h.firstTx)) return "bought in one transaction";
        return "";
      };
      const wallets = wl?.holders.length ? `<button class="toggle" data-twallets="${esc2(t.address)}">${open ? "Hide" : "Show"} top wallets \u2193</button>
      <div class="wallets ${open ? "show" : ""}">${wl.holders.map((h) => `<div class="wallet"><a href="https://gmgn.ai/sol/address/${esc2(h.owner)}" target="_blank" rel="noopener noreferrer">${short(h.owner)}${tags(h)}</a><span>${pctPlain(h.pct, 2)}${how(h) ? `<small>${esc2(how(h))}</small>` : ""}</span></div>`).join("")}
        ${groupsOf.map((g, i) => `<div class="wallet group"><span>Group ${letter(i)} \xB7 ${g.owners.length} wallet${g.owners.length === 1 ? "" : "s"}${g.dev ? " \xB7 tied to the dev" : ""}</span><span>${pctPlain(g.pct, 2)}</span></div>`).join("")}
        <p class="fine">Linked: same letter, same group. Paid by the same wallet, sent their coins by another wallet, bought in one transaction, or tied to the dev. Exchanges and wallets doing 1,000+ transactions a day never link anyone. Sniper: first coins within 10 seconds of launch.</p></div>` : "";
      const tracing = a.linksLoading ? '<div class="src-line"><span class="spinner"></span> Tracing the top wallets\u2026</div>' : "";
      box.innerHTML = `<h4>Coin check <span class="verdict ${tone}">${word}${score}</span></h4>
      ${c.call && !c.facts.some((f) => f.text && c.call.toLowerCase().includes(String(f.text).toLowerCase())) ? `<p class="cc-call">${esc2(c.call)}</p>` : ""}
      <div class="rows">${c.facts.map((f) => `<div class="row ${lvl[f.lvl] || ""}"><span class="dot"></span><span class="k">${esc2(f.k)}</span><span class="v">${val(f)}${f.sub ? `<small>${esc2(f.sub)}</small>` : ""}</span></div>`).join("")}</div>
      ${tracing}${wallets}
      <div class="src-line">${esc2([a.rug && reportSource(a.rug).line, a.bundle?.ok && ["Launch block", since(a.bundleAt)].filter(Boolean).join(" \xB7 "), wl && ["Wallet trace", since(wl.at)].filter(Boolean).join(" \xB7 ")].filter(Boolean).join(" \xB7 "))}</div>
      ${this.askHtml(t)}`;
      const input = box.querySelector("[data-ask-coin] input");
      if (this.askAnswered === t.address) this.askAnswered = null;
      else if (input && draft) input.value = draft;
      if (input && focused) input.focus();
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
      const { ts, loading } = this.state;
      this.footEl.innerHTML = `<span>DexScreener \xB7 RugCheck \xB7 Larpcheck</span><span data-ago>${loading ? "scanning" : ts ? "updated just now" : "not scanned"}</span>`;
      clearInterval(this.agoTimer);
      if (ts && !loading) this.agoTimer = setInterval(() => {
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
      if (e.target.closest('[data-act="feed"]')) {
        this.toggleFeedView();
        return;
      }
      const feedOpen = e.target.closest("[data-feed-open]");
      if (feedOpen) {
        this.scan({ post: { text: feedOpen.dataset.feedOpen }, source: { kind: "Breaking now", label: feedOpen.dataset.feedOpen } });
        return;
      }
      const feedCoin = e.target.closest("[data-feed-coin]");
      if (feedCoin) {
        this.scan({ post: { text: feedCoin.dataset.feedCoin }, source: { kind: "Breaking now", label: `$${feedCoin.dataset.feedSym}` } });
        return;
      }
      if (e.target.closest("[data-act-back]")) {
        this.view = "scan";
        this.renderHead();
        this.renderBody();
        return;
      }
      const starBtn = e.target.closest("[data-star]");
      if (starBtn) {
        this.toggleStar(starBtn.dataset.star);
        return;
      }
      const starGone = e.target.closest("[data-star-remove]");
      if (starGone) {
        this.removeStar(starGone.dataset.starRemove);
        return;
      }
      const starOpen = e.target.closest("[data-star-open]");
      if (starOpen) {
        this.scan({ post: { text: starOpen.dataset.starOpen }, source: { kind: "Watchlist", label: `$${starOpen.dataset.starSym}` } });
        return;
      }
      if (e.target.closest('[data-act="watch"]')) {
        await this.watch();
        return;
      }
      const scanTab = e.target.closest("[data-scan-tab]");
      if (scanTab) {
        this.tab = scanTab.dataset.scanTab === "new" ? "new" : "picks";
        this.renderHead();
        this.renderBody();
        this.loadAudits();
        return;
      }
      const newSort = e.target.closest("[data-new-sort]");
      if (newSort) {
        this.newSort = newSort.dataset.newSort === "big" ? "big" : "new";
        setPrefSort(this.newSort);
        this.renderBody();
        this.loadAudits();
        return;
      }
      const follow = e.target.closest('[data-act="follow"]');
      if (follow) {
        await this.follow(follow.dataset.word);
        return;
      }
      if (e.target.closest('[data-act="fresh-toggle"]')) {
        await this.toggleFresh();
        return;
      }
      if (e.target.closest('[data-act="big-toggle"]')) {
        await this.toggleBig();
        return;
      }
      if (e.target.closest('[data-act="diamond-toggle"]')) {
        await this.toggleDiamond();
        return;
      }
      if (e.target.closest('[data-act="bag-toggle"]')) {
        await this.toggleBagGuard();
        return;
      }
      if (e.target.closest('[data-act="break-pings"]')) {
        await this.toggleBreakingPings();
        return;
      }
      const bagMute = e.target.closest('[data-act="bag-mute"]');
      if (bagMute) {
        await this.muteBag(bagMute.dataset.mint, bagMute.dataset.on === "1");
        return;
      }
      if (e.target.closest('[data-act="dh-add"]')) {
        await this.addMyWallet();
        return;
      }
      const dhRemove = e.target.closest('[data-act="dh-remove"]');
      if (dhRemove) {
        await this.removeMyWallet(dhRemove.dataset.address);
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
      const reroute2 = e.target.closest("[data-reroute]");
      if (reroute2) {
        await this.rerouteFromPanel(reroute2);
        return;
      }
      const copy = e.target.closest("[data-copy]");
      if (copy) {
        e.preventDefault();
        const ca2 = copy.dataset.copy;
        await this.copyText(ca2);
        copy.classList.add("copied");
        copy.innerHTML = `Copied ${I.check}`;
        this.toast("Contract address copied");
        setTimeout(() => {
          copy.classList.remove("copied");
          copy.innerHTML = `${short(ca2)} ${I.copy}`;
        }, 1400);
        return;
      }
      const trend = e.target.closest("[data-trend]");
      if (trend) {
        this.scan({ post: { text: `Trending on X: ${trend.dataset.trend}` }, source: { kind: "Trend", label: trend.dataset.trend } });
        return;
      }
      const chartBtn = e.target.closest("[data-chart]");
      if (chartBtn) {
        const addr = chartBtn.dataset.chart;
        const key2 = `ch:${addr}`;
        this.expanded.has(key2) ? this.expanded.delete(key2) : this.expanded.add(key2);
        const t = this.tokens.get(addr);
        const card = this.bodyEl.querySelector(`.card[data-addr="${addr}"]`);
        if (t && card) {
          card.querySelector(`[data-actions="${addr}"]`).innerHTML = this.actionsHtml(t);
          card.querySelector(`[data-chart-box="${addr}"]`).innerHTML = this.chartHtml(t);
          this.renderLarp(addr);
        }
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
        const key2 = `tm:${tm.dataset.termMenu}`;
        this.expanded.has(key2) ? this.expanded.delete(key2) : this.expanded.add(key2);
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
        if (open) this.loadLinks(this.tokens.get(addr));
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
        const key2 = `w:${w.dataset.wallets}`;
        this.expanded.has(key2) ? this.expanded.delete(key2) : this.expanded.add(key2);
        this.renderAudit(w.dataset.wallets);
        return;
      }
      const tw = e.target.closest("[data-twallets]");
      if (tw) {
        const key2 = `tw:${tw.dataset.twallets}`;
        this.expanded.has(key2) ? this.expanded.delete(key2) : this.expanded.add(key2);
        this.renderAudit(tw.dataset.twallets);
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
      this.instaAsk = hood ? null : { mint: addr, sol: Number(instaSol()), at: Date.now() };
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
        if (e.origin === "https://tryradar.fun" && e.data?.type === "radar:insta-ready") {
          const ask = this.instaAsk;
          if (!ask || Date.now() - ask.at > 3e4 || e.data.mint !== ask.mint || Number(e.data.sol) !== ask.sol) return;
          this.instaAsk = null;
          e.source?.postMessage({ type: "radar:insta-go", mint: ask.mint, sol: ask.sol }, "https://tryradar.fun");
          return;
        }
        if (e.origin !== "https://tryradar.fun" || e.data?.type !== "radar:bought") return;
        const symbol = String(e.data.symbol || "").replace(/[^\w$./-]/g, "").slice(0, 20);
        this.toast(`Bought ${symbol ? `$${symbol}` : "it"} \xB7 confirmed on ${/^0x/.test(e.data.mint || "") ? "Robinhood Chain" : "Solana"}`, 4200);
      });
    }
    async route(post, candidates = null, named = [], where = "post") {
      const p = await this.preparePost(post);
      return send("reroute", { post: p, candidates, named, where });
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
        const bio = this.state.mentioned.length ? [] : this.bioCards();
        const r = await this.route(this.lastPost || {}, candidates, bio.length ? bio : this.state.mentioned, bio.length ? "bio" : "post");
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
    const res = await fetch(cssUrl || chrome.runtime.getURL("src/ui/radar.css"));
    return res.text();
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
.scroll { flex: 1; min-height: 0; overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--line-2) transparent; }
.lead { padding: 12px 12px 0; }
.lead:empty { display: none; }
.lead > :first-child { margin-top: 0; }
.body { padding: 12px; display: flex; flex-direction: column; gap: 10px; }
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
.wallet .old { color: var(--faint); }
.wallet small { margin-left: 6px; color: var(--faint); }
.wallet.group { color: var(--text); }
.wallet:not(.group) + .wallet.group { margin-top: 4px; padding-top: 6px; border-top: 1px solid var(--line); }
.coin-check .fine { margin: 6px 0 2px; font: 500 10.5px/1.4 var(--font); color: var(--faint); white-space: normal; }
.coin-check .src-line .spinner { vertical-align: -2px; }
.holder-line.ask-line { margin-top: 10px; }
.toggle { font: 600 11px var(--mono); color: var(--muted); margin-top: 4px; }
.toggle:hover { color: var(--text); }

.links { display: flex; gap: 6px; margin-top: 14px; }
.links > * { flex: 1 1 0; min-width: 0; }
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
.hc-text { min-width: 0; }
.hc-text small, .src-line { display: block; font: 500 10.5px/1.35 var(--mono); color: var(--faint); }
.hc-text small { margin-top: 2px; }
.src-line { margin-top: 6px; }
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
/* Holder perks: each line reads in full, and a switch that's on stands out from one that's off. */
.al-w.perk { align-items: flex-start; }
.al-w.perk > div span { white-space: normal; line-height: 1.4; }
.al-w.perk em, .al-w.perk .perk-sw { margin-top: 1px; }
.al-w .perk-sw { min-width: 38px; }
.al-w .perk-sw.on { color: var(--text); border-color: var(--text); }
.al-hit:hover { border-color: var(--line-2); }
.al-hit span { flex: 1; }
.al-hit em { font: 700 10.5px var(--mono); font-style: normal; color: var(--muted); white-space: nowrap; }
/* Track record: a flag that did 2x or more at its peak, and the link to the full list */
.al-hit em.up { color: var(--text); }
.track-label { margin-top: 14px; }
.track-row span { white-space: normal; }
.track-all { display: block; margin-top: 8px; color: var(--muted); text-decoration: underline; }
/* Bag Guard: a bag whose last look found something */
.al-hit em.bad { color: var(--down); white-space: normal; text-align: right; max-width: 60%; }
/* Bag Guard: each bag with its Mute button; a muted bag is dimmed but still listed */
.bag-row { display: flex; gap: 6px; align-items: stretch; min-width: 0; }
.bag-row .al-hit { flex: 1; }
.bag-mute { flex: none; min-width: 72px; border: 1px solid var(--line-2); border-radius: 10px; padding: 0 10px; background: transparent; color: var(--muted); font: 600 11px var(--font); cursor: pointer; }
.bag-mute:hover { color: var(--text); background: var(--card-2); }
.bag-row.muted .al-hit { opacity: .55; }
.bag-row.muted .bag-mute { color: var(--text); border-color: var(--line-2); background: var(--card-2); }
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
/* what's said in a video post */
.heard { margin-top: 8px; padding: 9px 11px; border: 1px solid var(--line); border-radius: 12px; background: var(--card); }
.heard-k { display: flex; align-items: center; gap: 6px; font: 600 10px var(--mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.heard-k svg { width: 12px; height: 12px; color: var(--accent); }
.heard p { margin: 6px 0 0; font-size: 12.5px; line-height: 1.45; color: var(--text); font-style: italic; overflow-wrap: anywhere; }
.heard button { margin-top: 6px; padding: 0; border: 0; background: none; color: var(--muted); font: 600 11px var(--mono); cursor: pointer; text-decoration: underline; }
.heard button:hover { color: var(--text); }
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
.chart-btn { flex: 1 1 100%; height: 32px; border: 1px solid var(--line); border-radius: 10px; font: 700 12px var(--font); color: var(--text); background: var(--card-2); }
/* Beside the Trade button, so a card is one row shorter. */
.trade + .chart-btn { flex: 0 0 82px; }
.chart-btn:hover, .chart-btn.on { border-color: var(--line-2); }
.chart-box:empty { display: none; }
.chart-box { margin-top: 8px; }
.chart-frame { display: block; width: 100%; height: 360px; border: 1px solid var(--line); border-radius: 12px; background: var(--bg); }
.chart-full { display: block; margin-top: 6px; font-size: 11px; color: var(--faint); text-decoration: none; text-align: right; }
.chart-full:hover { color: var(--text); }
.hc-by { margin-left: auto; flex: none; font: 600 10px var(--mono); letter-spacing: 0.06em; color: var(--faint); text-decoration: none; white-space: nowrap; }
.hc-by:hover { color: var(--text); }
.hc > span:nth-child(2) { min-width: 0; }
.recent-top a { color: var(--faint); text-decoration: none; letter-spacing: 0; text-transform: none; }
.recent-top a:hover { color: var(--text); }
.lc-board { margin-top: 18px; display: flex; flex-direction: column; text-align: left; }
.lc-tabs { display: flex; gap: 6px; margin: 2px 0 6px; }
.lc-tabs button { padding: 8px 11px; border: 1px solid var(--line); border-radius: 999px; font: 600 11px var(--font); color: var(--muted); }
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
/* A coin's family on pump.fun custom pairs: its parent, or the coins launched priced in it. */
.family { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line); }
.family:empty { display: none; }
.family h4 { all: unset; display: flex; align-items: center; justify-content: space-between; font: 700 10.5px var(--mono); letter-spacing: 0.1em; text-transform: uppercase; color: var(--faint); }
.family h4 em { font-style: normal; font-weight: 600; letter-spacing: 0.04em; text-transform: none; }
.fam-row { display: flex; justify-content: space-between; gap: 10px; margin-top: 8px; font-size: 12px; color: var(--muted); }
.fam-row b, .fam-row a { color: var(--text); font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fam-row a:hover { text-decoration: underline; }
.fam-row b.warn { color: var(--warn); }
.fam-note { margin-top: 3px; font-size: 10.5px; color: var(--faint); line-height: 1.4; }
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

/* Watchlist */
.star-head.has { color: var(--text); }
.star-head.on { background: var(--card-2); color: var(--text); }
.star-head.has svg, .star-head.on svg { fill: currentColor; }
.star-btn { width: 28px; height: 28px; display: grid; place-items: center; border-radius: 9px; color: var(--muted); background: var(--card-2); border: 1px solid var(--line); transition: color 0.15s, border-color 0.15s; }
.star-btn + .toggle-card { margin-left: 0; }
.card-top .star-btn { margin-left: auto; order: 2; }
.card-top .cc ~ .star-btn { margin-left: 0; }
.card-top .toggle-card { order: 3; }
.star-btn:hover { color: var(--text); border-color: var(--line-2); }
.star-btn.on { color: var(--text); }
.star-btn.on svg { fill: currentColor; }
.star-list { padding: 4px 2px; }
.star-list .empty { padding: 28px 8px; }
.star-row { display: grid; grid-template-columns: minmax(0, 1fr) 32px; align-items: center; gap: 2px 4px; padding: 8px 0; border-bottom: 1px solid var(--line); }
.star-open { display: flex; align-items: center; gap: 10px; min-width: 0; width: 100%; min-height: 44px; text-align: left; border-radius: 10px; }
.star-open:hover .star-names b { text-decoration: underline; }
.star-open .ava { flex: none; }
.star-names { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.star-names b { font-weight: 700; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.star-names span { font-size: 12px; color: var(--muted); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.star-nums { flex: none; display: flex; flex-direction: column; align-items: flex-end; text-align: right; }
.star-nums b { font: 600 13px var(--mono); }
.star-nums b i { font-style: normal; font-weight: 500; font-size: 10px; color: var(--faint); }
.star-nums em { font: 500 11px var(--mono); font-style: normal; color: var(--faint); white-space: nowrap; }
.star-nums em.up { color: var(--up); }
.star-nums em.down { color: var(--down); }
.star-remove { width: 32px; height: 44px; display: grid; place-items: center; border-radius: 9px; color: var(--faint); }
.star-remove:hover { color: var(--text); background: var(--card-2); }
.star-lc { grid-column: 1 / -1; margin-top: 4px; }
.star-lc .lc-btn { min-height: 30px; padding-block: 5px; font-size: 11px; }
.guard { display: flex; gap: 8px; margin: 6px 0 10px; padding: 10px; border: 1px solid var(--line-2); border-radius: 10px; font-size: 12px; color: var(--muted); }
.guard svg { flex: none; margin-top: 1px; }
.guard b { display: block; color: var(--text); font-weight: 700; }
.guard p { margin: 3px 0 0; line-height: 1.4; }
.guard button { margin-top: 8px; padding: 6px 10px; min-height: 30px; border: 1px solid var(--line-2); border-radius: 8px; color: var(--text); font-weight: 600; }
.guard button:hover { background: var(--card-2); }
.guard.on { border-color: color-mix(in srgb, var(--violet) 55%, transparent); background: color-mix(in srgb, var(--violet) 8%, transparent); }

/* Picks and New, at the top of a scan */
.scan-tabs { display: flex; gap: 4px; padding: 3px; border: 1px solid var(--line); border-radius: 10px; }
.scan-tabs button { flex: 1; padding: 8px 10px; border: 0; border-radius: 7px; background: none; color: var(--muted); font: 600 12px var(--font); cursor: pointer; transition: background .15s, color .15s; }
.scan-tabs button:hover { color: var(--text); }
.scan-tabs button[aria-selected="true"] { background: var(--card-2); color: var(--text); }
.new-sort { display: inline-flex; gap: 2px; padding: 2px; border: 1px solid var(--line); border-radius: 8px; }
.new-sort button { padding: 3px 8px; border: 0; border-radius: 6px; background: none; color: var(--muted); font: 600 10.5px var(--font); letter-spacing: normal; text-transform: none; cursor: pointer; }
.new-sort button:hover { color: var(--text); }
.new-sort button[aria-pressed="true"] { background: var(--card-2); color: var(--text); }
.new-note { margin: 0; padding: 0 4px; color: var(--muted); font: 400 11.5px/1.45 var(--font); }
.card.new { --role: var(--violet); }

/* ---------- the panel, simplified ---------- */
.holder-line { display: flex; align-items: center; gap: 10px; margin-top: 8px; padding: 5px 5px 5px 11px; border: 1px solid var(--line); border-radius: 10px; font: 500 12px/1.3 var(--font); color: var(--muted); }
.holder-line button { margin-left: auto; flex: none; padding: 6px 10px; border: 1px solid var(--line-2); border-radius: 8px; background: none; color: var(--text); font: 600 11.5px var(--font); cursor: pointer; }
.holder-line button:hover { background: var(--card-2); }
/* The verdict first, its reasons a tap away. A risky verdict keeps its reason in view. */
.story:not(.open):not(.risk):not(.loading):not(.who) > .story-call:not(.keep) { display: none; }
.story:not(.open) .lc-foot.own > span { display: none; }
.story:not(.open) .lc-foot.own .lc-btn { flex: 1; }
/* Serious warnings: the one colour in the monochrome theme, which maps --down to plain ink. */
.card.danger { --danger: #ff5c61; border-color: var(--danger); }
.nr-root[data-theme="light"] .card.danger { --danger: #d92d3a; }
.card.danger .hc { background: color-mix(in srgb, var(--danger) 12%, transparent); border-color: color-mix(in srgb, var(--danger) 45%, transparent); color: var(--danger); }
.card.danger .hc-mark { border-color: var(--danger); color: var(--danger); }
.card.danger .radar-buy, .card.danger .insta-more, .card.not-trading .radar-buy, .card.not-trading .insta-more { background: none; color: var(--muted); border: 1px solid var(--line-2); }
/* Easier to read. */
.section-label, .story-k, .compact span, .chain, .hc-text small, .lc-foot { font-size: 11px; }
.tag, .badge { font-size: 11px; }
.hc { font-size: 12.5px; }
.story-call { font-size: 12.5px; }
.narrative { font-size: 13.5px; }

/* ---------- breaking now ---------- */
.feed-head.on { color: var(--text); background: var(--card-2); }
.feed-late { margin: 0; }
.feed-pings { margin: 0 0 8px; }
.feed-pings button[aria-pressed="true"] { background: var(--card-2); }
.feed-row { border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
.feed-open { all: unset; display: block; box-sizing: border-box; width: 100%; padding: 11px 12px 8px; cursor: pointer; }
.feed-open:hover { background: var(--card-2); }
.feed-title { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.feed-title b { font: 700 15px/1.25 var(--font); color: var(--text); min-width: 0; overflow-wrap: anywhere; }
.feed-title em { flex: none; font: 700 11.5px var(--mono); font-style: normal; color: var(--muted); }
.feed-sub { display: block; margin-top: 3px; font: 500 11.5px/1.35 var(--font); color: var(--muted); }
.feed-coins { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 12px 11px; }
.feed-coin { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; padding: 5px 9px; border: 1px solid var(--line-2); border-radius: 8px; background: none; color: var(--text); font: 600 11.5px var(--font); cursor: pointer; }
.feed-coin:hover { background: var(--card-2); }
.feed-coin i { font: 600 10px var(--mono); font-style: normal; letter-spacing: 0.06em; text-transform: uppercase; color: var(--faint); }
.feed-coin b { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 120px; }
.feed-coin span { color: var(--muted); font-variant-numeric: tabular-nums; }

/* Alerts page: the long text behind a small "How it works" toggle (7 Nov tidy). */
.settings details.more { margin: 2px 0 8px; }
.settings details.more summary { cursor: pointer; list-style: none; font: 600 11.5px var(--font); color: var(--faint); }
.settings details.more summary::-webkit-details-marker { display: none; }
.settings details.more summary::after { content: ' +'; }
.settings details.more[open] summary::after { content: ' \u2212'; }
.settings details.more p { margin-top: 6px; }
`;

  // webapp/share.js
  var clip = (text, max) => {
    const t = String(text || "").replace(/\s+/g, " ").trim();
    if (t.length <= max) return t;
    const cut = t.slice(0, max - 1);
    const at = cut.lastIndexOf(" ");
    return `${(at > max * 0.5 ? cut.slice(0, at) : cut).replace(/[\s,;:.\-–—]+$/, "")}\u2026`;
  };
  function leadCoin(res) {
    return res?.mentioned?.[0] || res?.bioCoins?.[0] || res?.picks?.find((p) => p.role === "top")?.token || res?.picks?.[0]?.token || null;
  }
  function shareText({ narrative = "", res = null } = {}) {
    const lines = ["Radar's read on this post:"];
    const story = clip(narrative, 140);
    if (story) lines.push(story);
    const t = leadCoin(res);
    const sym2 = String(t?.symbol || "").trim();
    if (sym2 && /^[\p{L}\p{N}]{1,12}$/u.test(sym2)) lines.push(`Top coin: $${sym2}${t.marketCap ? ` \xB7 ${usd(t.marketCap)}` : ""}`);
    return lines.join("\n\n");
  }

  // webapp/main.js
  var PUBLIC_NODE = "https://solana-rpc.publicnode.com";
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
  var rpcPick = null;
  var pickRpc = () => rpcPick ||= fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(4e3) }).then((r) => r.json()).then((h) => h.rpc ? `${API_BASE}/rpc` : PUBLIC_NODE).catch(() => PUBLIC_NODE);
  var pending = null;
  document.addEventListener("click", (e) => {
    if (!e.target.closest?.("[data-reroute]")) return;
    pending?.close();
    pending = window.open("", "_blank");
    if (!pending) return;
    pending.opener = null;
    pending.document.title = "Radar";
    pending.document.body.style.cssText = "margin:0;height:100vh;display:grid;place-items:center;background:#07050f;color:#a89fc2;font:15px system-ui,sans-serif";
    pending.document.body.textContent = "Radar is checking the coins\u2026";
  }, true);
  var openWindow = (url2) => {
    if (pending && !pending.closed) pending.location.href = url2;
    else window.open(url2, "_blank", "noopener");
    pending = null;
  };
  var handlers = makeHandlers({
    settings: async () => ({ ...DEFAULTS, ...await store.get("settings") || {} }),
    store,
    openWindow,
    rpcUrl: async (s) => s.rpcUrl || pickRpc(),
    ready: Promise.resolve(),
    inlineImages: false,
    prunedNote: "Radar is reading a Solana node that keeps only recent blocks right now, so older launches can\u2019t be checked."
  });
  var reroute = handlers.reroute;
  handlers.reroute = async (msg) => {
    try {
      return await reroute(msg);
    } catch (e) {
      pending?.close();
      pending = null;
      throw e;
    }
  };
  var shared = { narrative: "", res: null };
  var tweet = handlers.tweet;
  handlers.tweet = async (msg) => {
    const r = await tweet(msg);
    history.replaceState(null, "", `/scan?url=${encodeURIComponent(msg.url.trim())}`);
    shared.narrative = "";
    shared.res = null;
    showShare();
    return r;
  };
  var read = handlers.read;
  handlers.read = async (msg) => {
    const r = await read(msg);
    if (r?.narrative) {
      shared.narrative = r.narrative;
      showShare(false);
    }
    return r;
  };
  var coins = handlers.coins;
  handlers.coins = async (msg) => {
    const r = await coins(msg);
    if (r) {
      shared.res = r;
      showShare(false);
    }
    return r;
  };
  function showShare(open = true) {
    const box = document.getElementById("scan-share");
    if (!box || !open && box.hidden) return;
    box.querySelector("[data-share-post]").href = `https://x.com/intent/post?text=${encodeURIComponent(shareText(shared))}&url=${encodeURIComponent(location.href)}`;
    box.hidden = false;
  }
  document.querySelector("[data-share-copy]")?.addEventListener("click", async (e) => {
    const button = e.currentTarget;
    const label = button.dataset.label ||= button.textContent;
    try {
      await navigator.clipboard.writeText(location.href);
      button.textContent = "Copied";
    } catch {
      button.textContent = "Could not copy";
    }
    setTimeout(() => {
      button.textContent = label;
    }, 1800);
  });
  useBackend(handlers, { cssText: radar_default });
  var params = new URLSearchParams(location.search);
  var url = params.get("url");
  var ca = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(params.get("q") || "") ? params.get("q") : null;
  if (url && isPostLink(url) || ca) document.body.classList.add("scan-open");
  if (["bot", "discord", "telegram"].includes(params.get("from"))) {
    navigator.sendBeacon?.(`${API_BASE}/count/${params.get("from")}-scan`);
    params.delete("from");
    history.replaceState(null, "", `/scan?${params}`);
  }
  mountInline(document.getElementById("radar"), "dark", { hint: "Paste a link to a post on X above. Or search a narrative, a ticker or a CA." }).then((radar) => radar.open(url && isPostLink(url) ? { text: url } : ca ? { text: ca } : {}));
})();
