// The radar's backend: everything the panel asks for. The extension runs it in its service worker;
// the web app runs it in the page. Each host supplies its own storage, window opening and RPC.
import { fullTokens, mentionedTokens, LAUNCHPADS, pickThree } from './market.js';
import { rugReport } from './rugcheck.js';
import { readPost, findCoins } from './narrative.js';
import { makeRpc, analyzeLaunch, PUBLIC_RPC } from './solana.js';
import { pickReroute, marketBlock, reportBlock, rejectionLine } from './reroute.js';

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
    if (hit && Date.now() - hit.t < ttl) return hit.p;
    const p = fn();
    memo.set(key, { t: Date.now(), p });
    p.catch(() => memo.delete(key));
    if (memo.size > 500) memo.delete(memo.keys().next().value);
    return p;
  }

  // Two stages so the panel can show the narrative while the coins are still being found.
  const postKey = (p, chains) => JSON.stringify([p, chains]);

  // A failed read is not an answer: it is dropped from the cache so the next tap tries again
  // instead of showing "no coins" for minutes.
  async function forgetIfFailed(key, p) {
    const res = await p;
    if (res?.engineError) memo.delete(key);
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
      return findCoins(judge ? { ...r, judge: true } : r, s.chains, { apiBase: API_BASE, cached });
    }));
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

  // Coins whose CA is written in a post: shown under it right away, no AI involved.
  async function mentioned({ text }) {
    const s = await host.settings();
    return cached(`mn:${text}`, 60_000, async () => (await mentionedTokens(String(text || '').slice(0, 2000), s.chains))
      .map((t) => ({ address: t.address, chain: t.chain, symbol: t.symbol, name: t.name, marketCap: t.marketCap, createdAt: t.createdAt })));
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

  async function safety({ mint, pairs }) {
    return cached(`rc:${mint}`, 60_000, () => rugReport(mint, pairs));
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
      const res = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en&token=${embedToken(id)}`);
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
  async function reroute({ post, candidates = null }) {
    const s = await host.settings();
    const report = (t) => safety({ mint: t.address, pairs: t.pairAddresses || [] });
    const body = [post?.text, post?.quoted, post?.card, post?.parent].filter(Boolean).join('\n').slice(0, 2000);
    const inPost = body ? await mentionedTokens(body, s.chains).catch(() => []) : [];

    let token;
    let checked;
    let reason;
    if (inPost.length) {
      token = inPost[0];
      checked = await report(token).catch(() => null);
      const why = marketBlock(token) || reportBlock(checked);
      if (why) throw new Error(`$${String(token.symbol || "").trim()} in the post didn't pass: ${why}`);
      reason = 'the coin in the post';
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
    const config = await cached('holder:config', 600_000, async () => (await fetch(`${API_BASE}/holder/config`, { signal: AbortSignal.timeout(6000) })).json()).catch(() => ({ on: false }));
    if (!config.on) return { on: false };
    const h = await holderStored();
    return { on: true, min: config.min, holder: !!h, exp: h?.exp || null };
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
    if (!r.ok) throw new Error(d.error || 'Frontrun is not answering right now.');
    return d;
  }

  const handlers = { videoInfo, tweet, read, coins, mentioned, story, larpcheck, refresh, safety, bundle, image, openWindow, reroute, holderStatus, holderSave, holderWho, settings: () => host.settings() };
  // Changing the RPC drops cached bundle results so they're re-read through the new one.
  handlers.resetBundles = () => memo.forEach((_, k) => k.startsWith('bd:') && memo.delete(k));
  return handlers;
}
