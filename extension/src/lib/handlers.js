// The radar's backend: everything the panel asks for. The extension runs it in its service worker;
// the web app runs it in the page. Each host supplies its own storage, window opening and RPC.
import { familyCounts, familyDetails, parentOf } from './family.js';
import { devRecord as readDevRecord } from './devrecord.js';
import { fullTokens, mentionedTokens, typedCashtags, linkedSymbol, LAUNCHPADS, pickThree, searchPairs, aggregate, isMemecoin, alive, MAJOR_TICKERS, STOCK_TICKERS } from './market.js';
import { rugReport, standInReport } from './rugcheck.js';
import { readPost, findCoins, postCoins as coinsInPost } from './narrative.js';
import { freshPairs, keepBest, postWords, storyWords, BADGE_MS } from './fresh.js';
import { norm } from './keywords.js';
import { makeRpc, analyzeLaunch, PUBLIC_RPC } from './solana.js';
import { walletLinks } from './links.js';
import { pickReroute, marketBlock, reportBlock, rejectionLine } from './reroute.js';
import { RECENT_KEY, addRecent } from '../ui/recent.js';
import { WATCHLIST_KEY, toggleStar } from '../ui/watchlist.js';

// Hosted narrative engine (Cloudflare Worker). Runs 24/7; nobody needs a key.
export const API_BASE = 'https://narrative-radar.millenia-portfolio.workers.dev';
// Chains the scan looks on. Robinhood Chain (an Ethereum L2 with its own memecoins, DexScreener id "robinhood") is
// scanned next to Solana; the on-chain checks and Quick Buy stay Solana only.
export const DEFAULTS = { rpcUrl: '', chains: ['solana', 'robinhood'], refreshSec: 10 };

/**
 * host: {
 *   settings(): Promise<settings>,
 *   store: { get(key), set(key, value) },   // launch-scan cache
 *   openWindow(url),
 *   rpcUrl(settings): Promise<string|null>, // preferred RPC, null = public
 *   ready?: Promise,                        // resolves once the RPC can be called
 *   inlineImages?: boolean,                 // return logos as data: URLs (X's CSP blocks others)
 *   prunedNote?: string,                    // shown when the RPC no longer has the launch block
 * }
 */
export function makeHandlers(host) {
  let rpcState = { url: null, rpc: null };
  function rpcFor(url) {
    const u = url || PUBLIC_RPC;
    if (rpcState.url !== u) rpcState = { url: u, rpc: makeRpc(u, { concurrency: u === PUBLIC_RPC ? 3 : 8 }) };
    return rpcState.rpc;
  }

  // Promise memo with TTL; also dedupes concurrent identical requests.
  const memo = new Map();
  function cached(key, ttl, fn) {
    const hit = memo.get(key);
    if (hit && Date.now() - hit.t < (hit.ttl ?? ttl)) return hit.p;
    const p = fn();
    memo.set(key, { t: Date.now(), p });
    p.catch(() => memo.delete(key));
    if (memo.size > 500) memo.delete(memo.keys().next().value);
    return p;
  }

  // Two stages so the panel can show the narrative while the coins are still being found.
  const postKey = (p, chains) => JSON.stringify([p, chains]);

  // A failed read is not an answer: it leaves the cache in a few seconds, so the next tap tries again instead of showing
  // "no coins" for minutes. Not at once: one tap reads and then finds coins, and that would ask the AI twice while it's down.
  async function forgetIfFailed(key, p) {
    const res = await p;
    const hit = memo.get(key);
    if (res?.engineError && hit) { hit.t = Date.now(); hit.ttl = 10_000; }
    return res;
  }

  async function read({ post }) {
    const s = await host.settings();
    const key = `rd:${postKey(post, s.chains)}`;
    return forgetIfFailed(key, cached(key, 300_000, () => readPost(post, s.chains, { apiBase: API_BASE, cached })));
  }

  // `judge: true` has the AI judge every candidate even when the read gave anchor words (the X bot posts in public).
  async function coins({ post, judge = false }) {
    const s = await host.settings();
    const key = `co:${judge ? 'j:' : ''}${postKey(post, s.chains)}`;
    return forgetIfFailed(key, cached(key, 120_000, async () => {
      const r = await read({ post });
      const found = await findCoins(judge ? { ...r, judge: true } : r, s.chains, { apiBase: API_BASE, cached });
      // The panel's New tab: everything the scan searched, newest first.
      const words = [...new Set([...(found.anchors || []), ...(found.terms || []), ...postWords(post?.text)])];
      const newPairs = keepBest(freshPairs([...(found.pool || []), ...(found.roleCandidates || []), ...(found.others || []), ...(found.mentioned || [])], storyWords(words, post?.author, post?.text), { chains: s.chains }));
      return { ...found, newPairs, words };
    }));
  }

  // The new-pair line under a post (content.js): a search for the post's names, no AI. A word already looked up in the last
  // few minutes isn't looked up again, so a story all over the timeline costs one search.
  async function fresh({ text }) {
    const words = postWords(text);
    if (!words.length) return { coins: [] };
    const s = await host.settings();
    const pairs = (await Promise.all(words.slice(0, 2).map((w) => cached(`fr:${norm(w)}`, 180_000, () => searchPairs(w)).catch(() => [])))).flat();
    // A newer copy of an older coin isn't news about a story.
    const coins = freshPairs(aggregate(pairs), words, { chains: s.chains, maxAge: BADGE_MS, hot: true }).filter((t) => !t.copyOf).slice(0, 5);
    return { coins: coins.map((t) => ({ address: t.address, symbol: t.symbol, createdAt: t.createdAt })) };
  }

  // Rescan: look for coins again, keeping the AI's read of the post.
  async function forgetCoins({ post }) {
    const s = await host.settings();
    // A video post is read twice: from its frames first, then with its speech (the same post without quickRead).
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

  // Story check: is the post's story real, and is the coin tied to it? Read on our server (it looks
  // up the author's account, the coin's links and domain ages); results are kept for 10 minutes.
  async function story({ post, narrative, coin }) {
    return cached(`st:${post.url || post.text}:${coin?.address || ''}`, 600_000, async () => {
      const res = await fetch(`${API_BASE}/story`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ post, narrative, coin }),
        signal: AbortSignal.timeout(25_000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Larp check ${res.status}`);
      return data;
    });
  }

  // Larpcheck's verdict on a coin (larpcheck.app), read through our server, which holds the API key.
  // { off } when no key is set, { checked: false, page } when nobody has checked the coin yet.
  async function larpcheck({ address }) {
    return cached(`lc:${address}`, 300_000, async () => {
      const res = await fetch(`${API_BASE}/larpcheck?address=${encodeURIComponent(address)}`, { signal: AbortSignal.timeout(10_000) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Larpcheck ${res.status}`);
      return data;
    });
  }

  // A coin's family on pump.fun custom pairs (lib/family.js): the launches under it read from the public RPC, the only
  // one that answers these reads (Helius refuses them on programs this size, and the public RPC refuses Cloudflare, so
  // the bot gets the parent only), the graduated children's volume and biggest from DexScreener, kept 10 minutes. The
  // parent comes from the coin's own pool (quote), which the caller already has.
  const famRpc = makeRpc(PUBLIC_RPC, { concurrency: 2 });
  async function family({ mint, quote = null }) {
    const parent = parentOf({ address: mint, quote });
    return cached(`fam:${mint}`, 600_000, async () => familyDetails(await familyCounts(mint, famRpc)))
      .then((f) => ({ ...f, parent }), () => (parent ? { children: 0, parent } : Promise.reject(new Error('Family unavailable'))));
  }

  // Dev record (lib/devrecord.js): a pump.fun coin's dev wallet and how many coins it has launched there, read from the
  // same public RPC as Family (a filtered read of pump.fun's curves), kept 10 minutes. null for a coin not from pump.fun.
  async function devRecord({ mint }) {
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(mint || ''))) throw new Error('Not a coin address');
    return cached(`dev:${mint}`, 600_000, () => readDevRecord(mint, famRpc));
  }

  // Wallet links and snipers (lib/links.js): who funded a coin's top holders and who bought in its first 10 seconds, from
  // the same RPC as the launch scan. Read when a card is opened, kept 10 minutes. Funders never change, holders do.
  async function links({ mint, creator = null, launchS = null, pairs = [] }) {
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(mint || ''))) throw new Error('Not a coin address');
    const s = await host.settings();
    await host.ready;
    const rpc = rpcFor(await host.rpcUrl(s));
    return cached(`wl:${mint}`, 600_000, () => walletLinks(rpc, mint, { creator, launchS, exclude: pairs }));
  }

  // Ask Radar about a coin card: answered on our server from what the card shows (holders only, a daily limit).
  async function askCoin({ coin, question, evidence }) {
    const h = await holderStored();
    if (!h) throw new Error('This is for $RADAR and $LARPCHECK holders. Check your wallet first.');
    const res = await fetch(`${API_BASE}/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: h.token, coin, question, evidence }), signal: AbortSignal.timeout(30_000) });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) await host.store.set(HOLDER_KEY, null);
    if (!res.ok) throw new Error(data.error || `Ask ${res.status}`);
    return data;
  }

  // More of Larpcheck through our server: holder data for chains Radar's own check doesn't cover, its lists, and for
  // holders with a plan on the server, new checks and questions.
  const lcGet = async (path, ttl) => cached(`lc:${path}`, ttl, async () => {
    const res = await fetch(`${API_BASE}${path}`, { signal: AbortSignal.timeout(12_000) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Larpcheck ${res.status}`);
    return data;
  });
  const lcHolders = ({ address, chain }) => lcGet(`/lc/holders?address=${encodeURIComponent(address)}&chain=${encodeURIComponent(chain)}`, 300_000);
  const lcBoard = ({ sort }) => lcGet(`/lc/board?sort=${encodeURIComponent(sort)}`, 300_000);
  const lcSettings = () => lcGet('/lc/settings', 600_000);
  async function lcHolderPost(path, body) {
    const h = await holderStored();
    if (!h) throw new Error('This is for $RADAR and $LARPCHECK holders. Check your wallet first.');
    const res = await fetch(`${API_BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: h.token, ...body }), signal: AbortSignal.timeout(50_000) });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) await host.store.set(HOLDER_KEY, null);
    if (!res.ok) throw new Error(data.error || `Larpcheck ${res.status}`);
    return data;
  }
  const lcStart = ({ input }) => lcHolderPost('/lc/check', { input });
  const lcAsk = ({ id, question }) => lcHolderPost('/lc/ask', { id, question });
  async function lcPoll({ id }) {
    const res = await fetch(`${API_BASE}/lc/check?id=${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(15_000) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Larpcheck ${res.status}`);
    return data;
  }

  // The panel's first cards, while the engine reads the post.
  async function postCoins({ post }) {
    const s = await host.settings();
    return coinsInPost(post, s.chains, cached);
  }

  // Coins whose CA is written in a post: shown under it right away, no AI involved.
  // The coin under a ticker the post types, when the scan didn't meet it: a backed coin trading $1K+ a day, the biggest;
  // for a big stock's ticker ($AMD, $META) only a runner of $100K+, since the post most likely means the share.
  async function typedTicker({ tickers = [] }) {
    const s = await host.settings();
    for (const raw of tickers.slice(0, 2)) {
      const tk = String(raw || '').toUpperCase();
      if (!/^[A-Z][A-Z0-9]{1,11}$/.test(tk) || MAJOR_TICKERS.has(tk)) continue;
      const found = await cached(`tt:${tk}:${s.chains}`, 60_000, async () => aggregate(await searchPairs(tk).catch(() => []))
        .filter((t) => s.chains.includes(t.chain) && isMemecoin(t) && String(t.symbol || '').toUpperCase() === tk && t.mcapBacked && alive(t) && (t.volume?.h24 || 0) >= 1000
          && (!STOCK_TICKERS.has(tk) || (t.marketCap || 0) >= 100_000)
          // $RADAR only ever means the real mint, never a copy.
          && (tk !== 'RADAR' || t.address === 'BTmeAebSh8MaYsTDiBiix79htKckjYQP5fvucFoFpump'))
        .sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0))[0] || null);
      if (found) return found;
    }
    return null;
  }

  async function mentioned({ text }) {
    const s = await host.settings();
    return cached(`mn:${text}`, 60_000, async () => (await mentionedTokens(String(text || '').slice(0, 2000), s.chains))
      .map((t) => ({ address: t.address, chain: t.chain, symbol: t.symbol, name: t.name, marketCap: t.marketCap, createdAt: t.createdAt, dexId: t.dexId || null })));
  }

  async function refresh({ tokens, deep = [], roleCandidates = [], roleCut = 0 }) {
    const fresh = await fullTokens(tokens, new Set(deep));
    const updated = Object.fromEntries(fresh.map((t) => [t.address, t]));
    let ranking = null;
    if (roleCandidates.length) {
      const candidates = roleCandidates.map((old) => {
        const current = updated[old.address];
        return current
          ? { ...old, ...current, relevance: old.relevance, reason: old.reason, fromPost: old.fromPost }
          : old;
      });
      ranking = pickThree(candidates, { cuts: [roleCut], allowFallback: false });
      ranking.roleCandidates = candidates;
      ranking.roleCut = roleCut;
    }
    return { tokens: updated, ranking };
  }

  // RugCheck first, Larpcheck's holder read when it can't answer. RugCheck failed for every coin on 31 Oct 2026, so after three
  // failures in a row it's left alone for 5 minutes and cards don't wait on it.
  let rugFails = 0;
  let rugOffUntil = 0;
  async function holderReport(mint, pairs) {
    if (Date.now() >= rugOffUntil) {
      try {
        const report = await rugReport(mint, pairs);
        rugFails = 0;
        return { ...report, readAt: Date.now() };
      } catch (e) {
        // A rate limit only says this browser asked too fast, not that RugCheck is down.
        if (!/rate limited/i.test(String(e?.message)) && ++rugFails >= 3) { rugFails = 0; rugOffUntil = Date.now() + 300_000; }
      }
    }
    const s = await host.settings();
    const report = await standInReport(mint, () => lcHolders({ address: mint, chain: 'solana' }), rpcFor(await host.rpcUrl(s)));
    if (!report) throw new Error("Holder data isn't available right now");
    return { ...report, readAt: Date.now() };
  }
  async function safety({ mint, pairs }) {
    return cached(`rc:${mint}`, 60_000, () => holderReport(mint, pairs));
  }

  async function bundle({ mint, launchMs, pairs, launchPair, launchDex }) {
    const s = await host.settings();
    await host.ready;
    return cached(`bd:${mint}`, 45_000, async () => {
      const key = `launch:${mint}`;
      const stored = (await host.store.get(key)) || null;
      // RugCheck's first-seen time lets the scan jump straight to the token's birth. Skip it only when
      // the launchpad listing is still there (its open time IS the birth) and the token is young.
      const birthKnown = LAUNCHPADS.has(launchDex) && launchMs && Date.now() - launchMs < 3 * 86_400_000;
      const rc = stored || birthKnown ? null : await safety({ mint, pairs }).catch(() => null);
      const seen = rc?.detectedAt ? Date.parse(rc.detectedAt) : Infinity;
      const hintMs = Math.min(launchMs || Infinity, seen);
      const url = await host.rpcUrl(s);
      const result = await analyzeLaunch(rpcFor(url), mint, launchMs, pairs, {
        maxPages: url ? 40 : 10,
        cached: stored,
        hintMs: Number.isFinite(hintMs) ? hintMs : null,
        launchPair,
      }).catch((e) => {
        // Free RPCs that prune old blocks can't see an older launch; say that plainly.
        if (/No block time near slot|cleaned up|does not exist on node/i.test(String(e?.message))) throw new Error(host.prunedNote || 'Launch block is too old for this RPC');
        throw e;
      });
      if (result.ok && !stored) await host.store.set(key, result.cache);
      delete result.cache;
      return result;
    });
  }

  // X's public embed endpoint lists a post's media, including MP4 variants of its video.
  function embedToken(id) {
    return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
  }
  async function videoInfo({ url }) {
    const id = String(url || '').match(/status\/(\d+)/)?.[1];
    if (!id) return null;
    return cached(`vid:${id}`, 3_600_000, async () => {
      const res = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en&token=${embedToken(id)}`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      const data = await res.json().catch(() => null);
      const media = (data?.mediaDetails || []).find((m) => m.type === 'video' || m.type === 'animated_gif');
      const mp4s = (media?.video_info?.variants || []).filter((v) => v.content_type === 'video/mp4').sort((a, b) => (a.bitrate || 0) - (b.bitrate || 0));
      if (!mp4s.length) return null;
      return {
        mp4: mp4s[0].url,
        durationMs: media.video_info.duration_millis || 0,
        poster: media.media_url_https || null,
        gif: media.type === 'animated_gif',
      };
    });
  }

  // A pasted X link becomes the full post (text, author, reply, quote, media), read by the Worker.
  async function tweet({ url }) {
    return cached(`tw:${url}`, 600_000, async () => {
      const res = await fetch(`${API_BASE}/tweet?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(10_000) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't open that post");
      if (data.post) for (const k of ['text', 'quoted', 'parent']) if (data.post[k]) data.post[k] = await typedCashtags(data.post[k], linkedSymbol);
      if (data.post?.text && data.source?.label) data.source.label = data.post.text.replace(/\s+/g, ' ').slice(0, 90);
      return data;
    });
  }

  async function openWindow({ url }) {
    if (!/^https:\/\/(v2\.)?bubblemaps\.io\//.test(url)) throw new Error('Blocked URL');
    await host.openWindow(url);
    return true;
  }

  // Instant reroute, shared by the post button, the CA line and the panel (rules in reroute.js):
  // open the biggest coin on the post that isn't an obvious rug and has real holders.
  // A CA written in the post goes through the same checks and is never swapped for another coin.
  // `candidates`: the panel passes the coins it already found, so nothing is searched twice.
  async function reroute({ post, candidates = null, named = [], where = 'post' }) {
    const s = await host.settings();
    const report = (t) => safety({ mint: t.address, pairs: t.pairAddresses || [] });
    const body = [post?.text, post?.quoted, post?.card, post?.parent].filter(Boolean).join('\n').slice(0, 2000);
    let inPost = named.length ? named : body ? await mentionedTokens(body, s.chains).catch(() => []) : [];
    // The post button has no panel behind it: the read knows the CAs shown in images.
    if (!inPost.length && !candidates?.length) inPost = (await coins({ post }).catch(() => null))?.mentioned || [];

    let token;
    let checked;
    let reason;
    if (inPost.length) {
      token = inPost[0];
      checked = await report(token).catch(() => null);
      const why = marketBlock(token) || reportBlock(checked);
      const place = where === 'bio' ? "the poster's bio" : 'the post';
      if (why) throw new Error(`$${String(token.symbol || "").trim()} in ${place} didn't pass: ${why}`);
      reason = `the coin in ${place}`;
    } else {
      let list = candidates;
      if (!list?.length) {
        const found = await coins({ post });
        list = [...(found.techMatch ? [found.techMatch] : []), ...(found.picks || []).map((p) => p.token), ...(found.others || [])];
        if (!list.length && found.engineError) throw new Error("Radar couldn't read this post right now");
      }
      if (!list.length) throw new Error('No coins found for this post');
      const picked = await pickReroute(list, report);
      if (!picked.token) throw new Error(`No coin passed the checks (${rejectionLine(picked.rejected)})`);
      ({ token, report: checked } = picked);
      reason = 'biggest match that passed';
    }

    const parsed = new URL(`https://axiom.trade/meme/${encodeURIComponent(token.pair || token.address)}?chain=sol`);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'axiom.trade') throw new Error('Could not build a trusted link');
    await host.openWindow(parsed.href);
    return { name: token.name, symbol: String(token.symbol || "").trim(), address: token.address, reason, holders: checked?.holders ?? null };
  }

  async function image({ url }) {
    if (!host.inlineImages) return url;
    return cached(`img:${url}`, 3_600_000, async () => {
      // The CDN only serves whitelisted sizes; 128/q90 is one of them.
      const small = url.replace(/width=\d+/, 'width=128').replace(/height=\d+/, 'height=128').replace(/quality=\d+/, 'quality=90');
      let res = await fetch(small);
      if (!res.ok) res = await fetch(url);
      if (!res.ok) throw new Error(`img ${res.status}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return `data:${res.headers.get('content-type') || 'image/png'};base64,${btoa(bin)}`;
    });
  }

  // Holder-only data (server/holder.js). The token stays in this host's storage; the panel only ever sees the status.
  const HOLDER_KEY = 'radarHolder';
  const holderStored = async () => {
    const h = await host.store.get(HOLDER_KEY);
    return h?.token && h.exp > Date.now() ? h : null;
  };
  async function holderStatus() {
    const config = await cached('holder:config', 600_000, async () => (await fetch(`${API_BASE}/holder/settings`, { signal: AbortSignal.timeout(6000) })).json()).catch(() => ({ on: false }));
    const h = await holderStored();
    // Someone who has already passed keeps their perks through a failed settings read.
    if (!config.on && !h) return { on: false };
    return { on: true, pitch: config.pitch, holder: !!h, exp: h?.exp || null };
  }
  // Whether this browser holds a current holder check, for perks that run here (launch alerts).
  const holderActive = async () => !!(await holderStored());
  // The coins in Radar's record, with their ticker and market cap now, read from DexScreener by this browser.
  async function holderCoinFacts(rows) {
    const facts = new Map();
    const cas = rows.map((r) => r.ca);
    const sol = cas.filter((a) => !a.startsWith('0x'));
    const evm = cas.filter((a) => a.startsWith('0x'));
    const asks = [...(sol.length ? [['solana', sol]] : []), ...(evm.length ? ['robinhood', 'base', 'bsc'].map((c) => [c, evm]) : [])];
    await Promise.all(asks.map(async ([chain, list]) => {
      const r = await fetch(`https://api.dexscreener.com/tokens/v1/${chain}/${list.join(',')}`, { signal: AbortSignal.timeout(8000) });
      for (const p of r.ok ? await r.json() : []) {
        const a = p.baseToken?.address;
        const best = facts.get(String(a).toLowerCase());
        if (a && (!best || (p.liquidity?.usd || 0) > best.liq)) facts.set(String(a).toLowerCase(), { symbol: String(p.baseToken.symbol || '').replace(/^\$+/, '').slice(0, 20), mc: Number(p.marketCap || p.fdv || 0), liq: p.liquidity?.usd || 0 });
      }
    }).map((p) => p.catch(() => {})));
    return rows.map((r) => ({ ...r, ...(facts.get(r.ca.toLowerCase()) || {}) }));
  }
  async function holderSave({ token, exp }) {
    if (typeof token !== 'string' || token.length > 400 || !Number.isFinite(exp)) throw new Error('Bad holder token');
    await host.store.set(HOLDER_KEY, { token, exp });
    return holderStatus();
  }
  async function holderWho({ handle }) {
    const h = await holderStored();
    if (!h) return { locked: true };
    const r = await fetch(`${API_BASE}/holder/who`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: h.token, handle }), signal: AbortSignal.timeout(25_000) });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) { await host.store.set(HOLDER_KEY, null); return { locked: true }; }
    if (!r.ok) throw new Error(d.error || 'Radar could not look this account up right now.');
    if (d.own?.recent?.length) d.own.recent = await holderCoinFacts(d.own.recent);
    return d;
  }

  const recentList = async () => (await host.store.get(RECENT_KEY)) || [];
  const recentAdd = async ({ item }) => { await host.store.set(RECENT_KEY, addRecent(await recentList(), item)); };
  const recentClear = () => host.store.set(RECENT_KEY, []);
  const starList = async () => (await host.store.get(WATCHLIST_KEY)) || [];
  const starToggle = async ({ star }) => {
    const list = toggleStar(await starList(), star);
    await host.store.set(WATCHLIST_KEY, list);
    return list;
  };
  // Breaking now (server/feed.js): the stories come from our server, live for holders and 10 minutes behind for everyone else.
  // Their launch-time caps go stale fast, so the numbers shown are read live here, and a story whose coins have all died drops out.
  // Track record (server/track.js): every coin Radar flagged, then and now. Live for holders, 30 minutes behind otherwise.
  async function track() {
    const h = await holderStored().catch(() => null);
    return cached(`tr:${h?.token ? 'h' : 'p'}`, 60_000, async () => {
      const res = await fetch(`${API_BASE}/track-record`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: h?.token, hours: 24 }), signal: AbortSignal.timeout(12_000) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Track record ${res.status}`);
      return data;
    });
  }
  const FEED_DUST = 5000; // a pump.fun coin starts near $2.7K, so under this nothing much has traded
  async function breaking() {
    const h = await holderStored().catch(() => null);
    return cached(`fd:${h?.token ? 'h' : 'p'}`, 50_000, async () => {
      const res = await fetch(`${API_BASE}/narratives`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: h?.token }), signal: AbortSignal.timeout(12_000) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Feed ${res.status}`);
      const stories = data.stories || [];
      const refs = [...new Set(stories.flatMap((s) => [s.first, ...s.big]).map((c) => c.a))].map((address) => ({ chain: 'solana', address }));
      const tokens = refs.length ? await fullTokens(refs).catch(() => []) : [];
      const live = new Map(tokens.map((t) => [t.address, t]));
      const coin = (c) => {
        const t = live.get(c.a);
        return { address: c.a, symbol: t?.symbol || c.s, name: t?.name || c.n, cap: t ? (t.mcapBacked === false && !t.onCurve ? 0 : t.marketCap || 0) : null };
      };
      return {
        live: !!data.live,
        asOf: data.asOf,
        stories: stories.map((s) => {
          const list = [s.first, ...s.big].map(coin);
          const known = list.filter((c) => c.cap != null);
          return { words: s.words, coins: s.coins, wallets: s.wallets, recent: s.recent, startedAt: s.startedAt, first: list[0], biggest: [...known].sort((a, b) => b.cap - a.cap)[0] || null, faded: known.length === list.length && known.every((c) => c.cap < FEED_DUST) };
        }).filter((s) => !s.faded),
      };
    });
  }

  const launchState = () => cached('launch:state', 600_000, async () => (await fetch(`${API_BASE}/launch/settings`, { signal: AbortSignal.timeout(6000) })).json());

  const handlers = { typedTicker, forgetCoins, breaking, track, starList, starToggle, videoInfo, tweet, read, coins, fresh, postCoins, mentioned, story, larpcheck, family, devRecord, links, askCoin, refresh, safety, bundle, image, openWindow, reroute, holderStatus, holderSave, holderWho, holderActive, recentList, recentAdd, recentClear, launchState, lcHolders, lcBoard, lcSettings, lcStart, lcAsk, lcPoll, settings: () => host.settings() };
  // Changing the RPC drops cached bundle results so they're re-read through the new one.
  handlers.resetBundles = () => memo.forEach((_, k) => k.startsWith('bd:') && memo.delete(k));
  return handlers;
}
