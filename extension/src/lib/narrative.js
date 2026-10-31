// Narrative scan, client side: the hosted engine reads the post and judges candidates;
// coin lookups run from this browser so they use the user's own DexScreener allowance.
// Two stages so the panel can show the narrative as soon as it's read:
//   readPost()  -> narrative + search terms (+ coins written in the post, video speech)
//   findCoins() -> candidates from DexScreener, judged, picked
import { searchPairs, aggregate, relevance, pickThree, fullTokens, mentionedTokens, isMemecoin, SOL_CA, EVM_CA } from './market.js';
import { extractKeywords, norm } from './keywords.js';

const passthrough = (_k, _ttl, fn) => fn();

// Every engine call is bounded: a stalled model must never hang the panel.
async function engine(apiBase, path, body, timeoutMs = 15_000) {
  const res = await fetch(`${apiBase}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Narrative engine ${res.status}`);
  return data;
}

// DexScreener throttles bursts: a few lookups at a time is faster than all at once.
async function inBatches(items, size, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

const fmtUsd = (n) => (n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}K` : `$${Math.round(n)}`);
const fmtAge = (ms) => {
  if (!ms) return '?';
  const h = (Date.now() - ms) / 3.6e6;
  return h < 1 ? `${Math.round(h * 60)}m` : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`;
};

/** Stage 1: what is this post's coin narrative? */
export async function readPost(post, chains, { apiBase, cached = passthrough }) {
  const fullText = [post.text, post.quoted, post.card, post.parent].filter(Boolean).join('\n');
  // Warm the coin searches while the engine reads: names written in the post are usually among
  // its terms. Nothing here is shown; it only fills the search cache.
  for (const k of extractKeywords(fullText.replace(SOL_CA, ' ').replace(EVM_CA, ' '), 3, { strongOnly: true })) {
    cached(`q:${k.toLowerCase()}`, 300_000, () => searchPairs(k)).catch(() => {});
  }
  // Speech in the video (transcribed by the engine) and coins written in the post, in parallel.
  const [mentioned, transcript, videoNotes] = await Promise.all([
    mentionedTokens(fullText, chains, (q) => cached(`q:${q}`, 20_000, () => searchPairs(q))),
    post.videoUrl && !post.gif
      ? cached(`tr:${post.videoUrl}`, 3_600_000, () => engine(apiBase, 'transcribe', { videoUrl: post.videoUrl })).then((r) => r.text).catch(() => '')
      : '',
    // The bot can't draw frames as the panel does, so the engine watches the video or GIF for it.
    post.videoUrl && post.watchVideo
      ? cached(`wv:${post.videoUrl}`, 3_600_000, () => engine(apiBase, 'watch', { videoUrl: post.videoUrl }, 50_000)).then((r) => r.text || '').catch(() => '')
      : '',
  ]);
  const full = { ...post, ...(transcript ? { transcript } : {}), ...(videoNotes ? { videoNotes } : {}) };
  // A coin written in the post is the strongest narrative signal: tell the engine what it is.
  const named = mentioned.map((t) => `${t.name} ($${t.symbol})`).join(', ');
  let read;
  try {
    // The engine may walk several free providers before one answers; give it room.
    read = await engine(apiBase, 'interpret', { post: named ? { ...full, text: `${full.text || ''}\n[Coin in this post: ${named}]` } : full }, 35_000);
  } catch (e) {
    // No AI right now: a coin whose CA is written in the post still shows, it needs no reading.
    if (!mentioned.length) throw e;
    return { narrative: '', engineError: e.message, coinable: true, terms: [], anchors: [], judge: false, mentioned, tickers: [], post: full };
  }
  // A contract address shown only in an image (the engine reads it off) counts as written in the post, once
  // DexScreener confirms it is a real token: a misread address matches nothing and is dropped.
  const seen = new Set(mentioned.map((t) => t.address.toLowerCase()));
  const fromImages = (read.cas || []).filter((a) => !seen.has(a.toLowerCase()));
  if (fromImages.length) {
    mentioned.push(...await mentionedTokens(fromImages.join(' '), chains, (q) => cached(`q:${q}`, 20_000, () => searchPairs(q))).catch(() => []));
  }
  return { narrative: read.narrative, coinable: read.coinable, terms: read.terms || [], anchors: read.anchors || [], judge: read.judge !== false && !read.anchors?.length, mentioned, tickers: read.tickers || [], post: full };
}

/** Stage 2: which on-chain coins are really about it? */
// Does a token's name or ticker contain one of the narrative's anchor words?
// Short anchors (<= 3 chars, e.g. "doj") must be a whole word or the exact ticker.
function anchorHits(t, anchors) {
  const name = norm(t.name || '');
  const sym = norm(t.symbol || '');
  const words = new Set(`${t.name} ${t.symbol}`.split(/[^A-Za-z0-9À-ɏ]+/).map(norm).filter(Boolean));
  return anchors.filter((a) => {
    const k = norm(a);
    if (!k) return false;
    return k.length <= 3 ? words.has(k) || sym === k : name.includes(k) || sym.includes(k);
  }).length;
}

// Tech stories get a separate exact-entity highlight. Generic terms alone never pick a coin:
// the token still has to match one of the narrative engine's specific anchors.
const TECH_CUES = /\b(?:technology|tech|software|hardware|application|app|platform|tool|open[- ]?source|github|repository|repo|developer|coding|code|artificial intelligence|ai|large language model|llm|model|agent|robot(?:ics)?|gpu|chip|semiconductor|compute|computing|protocol|framework|library|browser|operating system|cloud|saas|api)\b/i;

function findTechMatch(tokens, mentioned, anchors, scores, narrative, post) {
  const context = [narrative, post?.text, post?.quoted, post?.card, post?.parent, post?.transcript, post?.videoNotes].filter(Boolean).join(' ');
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
  const best = matches.filter((m) => m.anchorIndex === firstAnchor).sort((a, b) =>
    b.score - a.score
    || Number(Boolean(b.token.mcapBacked)) - Number(Boolean(a.token.mcapBacked))
    || (b.token.marketCap || 0) - (a.token.marketCap || 0))[0];
  return { ...best.token, techAnchor: anchors[firstAnchor] };
}

export async function findCoins({ narrative, coinable, terms, anchors = [], judge = true, mentioned, tickers = [], post, engineError }, chains, { apiBase, cached = passthrough }) {
  const t0 = Date.now();
  const timing = {};
  const lap = (k) => { timing[k] = Date.now() - t0; };
  const base = { mode: 'ai', narrative, coinable, mentioned, tickers, anchors, terms, engineError, ts: Date.now(), timing, techMatch: null };
  if (!terms.length) return { ...base, picks: [], others: [], techMatch: findTechMatch([], mentioned, anchors, new Map(), narrative, post) };

  const statusId = post.url?.match(/status\/(\d+)/)?.[1] || null;
  let failed = 0;
  // Search results barely change in minutes; cache them so repeat and related scans cost nothing.
  const hits = await inBatches(terms.slice(0, 5), 3, (t) =>
    cached(`q:${t.toLowerCase()}`, 300_000, () => searchPairs(t)).catch(() => { failed++; return []; }));
  // Every lookup failing means DexScreener is throttling us, not that no coins exist.
  if (failed === hits.length) throw new Error('DexScreener is rate-limiting right now, try again in a few seconds');
  lap('search');
  const skip = new Set(mentioned.map((t) => t.address));
  const candidates = aggregate(hits.flat().filter((p) => chains.includes(p.chainId) && !skip.has(p.baseToken?.address)))
    .filter((t) => (t.volume.h24 > 0 || t.liquidity > 0) && isMemecoin(t))
    .map((t) => ({ ...t, fromPost: !!statusId && t.links.some((l) => l.includes(statusId)) }))
    .map((t) => ({ t, r: relevance(t, terms).score + (t.fromPost ? 50 : 0) }))
    .sort((a, b) => b.r - a.r || b.t.marketCap - a.t.marketCap)
    .slice(0, judge ? 30 : 60); // anchor matching is free, so it can look at more
  if (!candidates.length) return { ...base, picks: [], others: [], techMatch: findTechMatch([], mentioned, anchors, new Map(), narrative, post) };

  let scores;
  if (!judge && anchors.length) {
    // Free mode: one AI call total. A coin counts if it names one of the two main anchors (the real
    // subject), or two anchors at once; a lone side word ("dubai", "west") isn't enough.
    scores = new Map();
    const main = anchors.slice(0, 2);
    for (const c of candidates) {
      const hits = anchorHits(c.t, anchors);
      const mainHit = anchorHits(c.t, main) > 0;
      if (c.t.fromPost || mainHit || hits >= 2) {
        scores.set(c.t.address, { score: c.t.fromPost ? 99 : Math.min(95, 62 + hits * 10 + (mainHit ? 8 : 0) + Math.min(c.r, 8) * 2), reason: '' });
      }
    }
    lap('anchors');
  } else {
    // Judge in two halves at once: each call writes half the answer, so the pair finishes much sooner.
    const brief = ({ t }) => ({
      name: t.name, symbol: t.symbol, age: fmtAge(t.createdAt), mc: fmtUsd(t.marketCap), vol: fmtUsd(t.volume.h24), fromPost: t.fromPost, links: t.links.slice(0, 2),
    });
    const halves = candidates.length > 12 ? [candidates.slice(0, Math.ceil(candidates.length / 2)), candidates.slice(Math.ceil(candidates.length / 2))] : [candidates];
    // A half that's slow or fails falls back to name relevance for its coins, so the panel always answers.
    const verdicts = await Promise.all(halves.map((part) => engine(apiBase, 'judge', { narrative, post, candidates: part.map(brief) }, 9_000)
      .then((v) => v.matches.map((m) => ({ ...m, t: part[m.i]?.t })))
      .catch(() => part.filter((c) => c.r >= 3).slice(0, 5).map((c) => ({ t: c.t, score: Math.min(85, 55 + c.r * 4) })))));
    lap('judge');
    scores = new Map(verdicts.flat().filter((m) => m.t).map((m) => [m.t.address, { score: m.score, reason: '' }]));
  }
  for (const { t } of candidates) if (t.fromPost) scores.set(t.address, { score: 99, reason: 'Launched with this post as its link' });
  // `pool`: every candidate searched, judged or not (the X bot compares their logos with the post's picture).
  const pool = candidates.map((c) => c.t);
  if (!scores.size) return { ...base, picks: [], others: [], pool, techMatch: findTechMatch([], mentioned, anchors, scores, narrative, post) };

  // Accurate liquidity, age and volume across every pool of the (few) matched tokens.
  const refs = candidates.map((c) => c.t).filter((t) => scores.has(t.address));
  const fromPost = new Set(refs.filter((t) => t.fromPost).map((t) => t.address));
  let tokens = await Promise.race([
    fullTokens(refs, new Set(refs.slice(0, 10).map((t) => t.address))),
    new Promise((resolve) => setTimeout(() => resolve(refs), 5_000)), // keep search data if pool lookups stall
  ]).catch(() => refs);
  lap('pools');
  tokens = tokens.filter((t) => scores.has(t.address)).map((t) => ({
    ...t, relevance: scores.get(t.address).score, reason: scores.get(t.address).reason, fromPost: fromPost.has(t.address),
  }));
  // Judge scores are absolute: made-for-this-story coins first, the subject's own coin next.
  const { picks, others, roleCandidates, roleCut } = pickThree(tokens, { cuts: [0.85, 0.7, 0] });
  const techMatch = findTechMatch(tokens, mentioned, anchors, scores, narrative, post);
  const remaining = techMatch ? others.filter((t) => t.address !== techMatch.address) : others;
  return { ...base, picks, others: remaining, roleCandidates, roleCut, techMatch, pool };
}

export async function aiScan(post, chains, opts) {
  return findCoins(await readPost(post, chains, opts), chains, opts);
}
