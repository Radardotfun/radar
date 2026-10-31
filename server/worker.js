// Cloudflare Worker: the hosted narrative engine. Runs 24/7, independent of anyone's laptop.
//   POST /interpret { post }                         -> { narrative, coinable, terms }
//   POST /judge     { narrative, post, candidates }  -> { matches: [{ i, score, reason }] }
//   POST /match     { post, logos }                  -> { same: [i] }: coin logos showing the post's own picture
//   GET  /larpcheck?address=<CA>                     -> Larpcheck's verdict on the coin (see below)
import { launchState, launchMeta, launchMetaFile, launchRecord, launchList } from './launch.js';
import { engine, interpret, judge, storyCheck, transcribe, sameImage, LOGO_HOST } from './narrative.js';
import { holderOn, holderConfig, holderVerify, holderWho } from './holder.js';
import { recordPost } from './ledger.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
};
const json = (status, body, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS, ...extra } });

// Best-effort per-isolate limiter; the edge cache below absorbs repeat scans of the same post.
const hits = new Map();
function limited(ip, limit = 80, windowMs = 10 * 60_000) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.delete(hits.keys().next().value);
  return list.length > limit;
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const clip = (s, n) => (typeof s === 'string' ? s.slice(0, n) : '');
const cleanPost = (p = {}) => ({
  text: clip(p.text, 4000),
  quoted: clip(p.quoted, 2000),
  card: clip(p.card, 600),
  author: clip(p.author, 40).replace(/[^\w]/g, ''),
  authorName: clip(p.authorName, 60),
  replyTo: Array.isArray(p.replyTo) ? p.replyTo.map((h) => clip(String(h), 40).replace(/[^\w]/g, '')).filter(Boolean).slice(0, 4) : [],
  parent: clip(p.parent, 1500),
  parentAuthor: clip(p.parentAuthor, 40).replace(/[^\w]/g, ''),
  url: /^https:\/\/(x|twitter)\.com\/\w+\/status\/\d+/.test(p.url || '') ? p.url : '',
  images: Array.isArray(p.images)
    ? p.images.filter((u) => typeof u === 'string' && (u.startsWith('https://pbs.twimg.com/') || (u.startsWith('data:image/jpeg;base64,') && u.length < 1_500_000))).slice(0, 3)
    : [],
  hasVideo: !!p.hasVideo,
  transcript: clip(p.transcript, 3000),
});
const cleanCoin = (c) => (c && typeof c === 'object' && c.address ? {
  name: clip(c.name, 60),
  symbol: clip(c.symbol, 20),
  address: clip(c.address, 64),
  createdAt: Number.isFinite(c.createdAt) ? c.createdAt : null,
  socials: Array.isArray(c.socials) ? c.socials.filter((x) => x && typeof x.url === 'string').slice(0, 4).map((x) => ({ type: clip(x.type, 20), url: clip(x.url, 200) })) : [],
  websites: Array.isArray(c.websites) ? c.websites.filter((u) => typeof u === 'string' && /^https?:\/\//.test(u)).slice(0, 2).map((u) => clip(u, 200)) : [],
  fromPost: !!c.fromPost,
  mentioned: !!c.mentioned,
} : null);
const cleanCandidate = (c = {}) => ({
  name: clip(c.name, 60),
  symbol: clip(c.symbol, 20),
  age: clip(c.age, 10),
  mc: clip(c.mc, 12),
  vol: clip(c.vol, 12),
  fromPost: !!c.fromPost,
  links: Array.isArray(c.links) ? c.links.filter((l) => typeof l === 'string').slice(0, 3).map((l) => clip(l, 120)) : [],
});

async function cachedJson(ctx, key, ttl, fn, debug) {
  const cacheKey = new Request(`https://cache.narrative-radar/${key}`);
  if (!debug) {
    const hit = await caches.default.match(cacheKey);
    if (hit) return new Response(hit.body, { headers: { 'content-type': 'application/json', ...CORS, 'x-cache': 'hit' } });
  }
  const t = Date.now();
  const result = await fn();
  const res = json(200, debug ? { ...result, ms: Date.now() - t } : result, { 'cache-control': `public, max-age=${ttl}` });
  if (!debug) ctx.waitUntil(caches.default.put(cacheKey, res.clone()));
  return res;
}

async function route(kind, request, env, ctx) {
  if (limited(request.headers.get('cf-connecting-ip') || 'anon')) return json(429, { error: 'Too many scans, slow down a little' });
  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'Bad JSON' }); }
  const debug = !!env.DEBUG_TOKEN && body.debug === env.DEBUG_TOKEN;
  const freeModels = debug && Array.isArray(body.models) ? body.models.filter((m) => /^@cf\//.test(m)) : undefined;
  // Debug-only: try other keyed models / thinking levels without redeploying.
  const over = debug && body.envOverride && typeof body.envOverride === 'object' ? body.envOverride : {};
  const allowed = ['GEMINI_MODEL', 'GEMINI_EFFORT', 'OPENROUTER_MODEL', 'OPENROUTER_REASONING', 'CLAUDE_MODEL'];
  const env2 = { ...env, ...Object.fromEntries(Object.entries(over).filter(([k]) => allowed.includes(k)).map(([k, v]) => [k, String(v)])) };
  if (over.ONLY) for (const k of ['GROQ', 'CEREBRAS', 'GEMINI', 'OPENROUTER', 'MISTRAL']) if (k !== over.ONLY) delete env2[`${k}_API_KEY`];
  const ai = engine({ apiKey: env.ANTHROPIC_API_KEY, binding: over.ONLY ? null : env.AI, freeModels, env: env2 });
  const post = cleanPost(body.post);

  if (kind === 'transcribe') {
    const url = String(body.videoUrl || '');
    if (!/^https:\/\/video\.twimg\.com\/[\w/.-]+\.mp4(\?[\w=&]*)?$/.test(url)) return json(400, { error: 'Not an X video' });
    if (!env.AI) return json(503, { error: 'Transcription unavailable' });
    return cachedJson(ctx, `t/${await sha256(url)}`, 86400, () => transcribe(env.AI, url), debug);
  }
  if (kind === 'interpret') {
    if (!post.text && !post.quoted && !post.card && !post.images.length) return json(400, { error: 'Empty post' });
    ctx.waitUntil(recordPost(env, post).catch((e) => console.error('ledger', e?.message)));
    const key = await sha256(JSON.stringify(['i', post]));
    return cachedJson(ctx, `i/${key}`, 300, () => interpret(ai, post), debug);
  }
  if (kind === 'story') {
    if (!post.text && !post.quoted && !post.images.length) return json(400, { error: 'Empty post' });
    const coin = cleanCoin(body.coin);
    const narrative = clip(body.narrative, 200);
    // Re-checked every few hours at most: a story's evidence doesn't change by the minute.
    const key = await sha256(JSON.stringify(['s', post.url || post.text, post.author, coin?.address || null]));
    return cachedJson(ctx, `s/${key}`, 3 * 3600, () => storyCheck(ai, { post, narrative, coin }), debug);
  }
  if (kind === 'match') {
    const logos = (Array.isArray(body.logos) ? body.logos : []).filter((u) => typeof u === 'string' && LOGO_HOST.test(u)).slice(0, 16);
    if (!post.images.length || !logos.length) return json(400, { error: 'Nothing to compare' });
    const key = await sha256(JSON.stringify(['m2', post.images, logos]));
    return cachedJson(ctx, `m/${key}`, 3600, () => sameImage(ai, { images: post.images, logos }), debug);
  }
  const candidates = (Array.isArray(body.candidates) ? body.candidates : []).slice(0, 30).map(cleanCandidate);
  const narrative = clip(body.narrative, 200);
  if (!candidates.length || !narrative) return json(400, { error: 'Nothing to judge' });
  const key = await sha256(JSON.stringify(['j', narrative, post, candidates]));
  return cachedJson(ctx, `j/${key}`, 180, () => judge(ai, { narrative, post, candidates }), debug);
}

// Solana RPC relay: when a SOLANA_RPC_URL secret (e.g. a free Helius URL) is set, every user's bundle
// scans go through it instead of the throttled public RPC. Responses are streamed straight through,
// so the Worker never parses multi-megabyte blocks. Only the read methods the scans use are allowed.
// Reads for the bundle scan, plus what Quick Buy (tryradar.fun/trade) needs: a balance, a simulation, sending the
// wallet-signed buy and its status. Browsers can't call the public RPC from a website (it refuses an Origin header).
const RPC_METHODS = new Set(['getSlot', 'getBlockTime', 'getBlock', 'getBlocks', 'getSignaturesForAddress', 'getTokenSupply', 'getAccountInfo', 'getMultipleAccounts', 'getTransaction',
  'getBalance', 'simulateTransaction', 'sendTransaction', 'getSignatureStatuses', 'getLatestBlockhash']);

// The secret as a usable https endpoint, or null. A pasted URL often carries a newline or stray quotes,
// and fetch() throws on those, which would take the whole Worker down with it. The value holds an API
// key, so it is never returned or logged.
function relayUrl(env) {
  let raw = (env.SOLANA_RPC_URL || '').trim().replace(/^['"]|['"]$/g, '');
  if (!raw) return null;
  // Helius shows the key and the URL side by side, so the secret is often just the key: build the URL.
  if (/^[0-9a-f-]{32,40}$/i.test(raw)) raw = `https://mainnet.helius-rpc.com/?api-key=${raw}`;
  else if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' ? u.href : null;
  } catch { return null; }
}
// GET /tweet?url=<x.com post> -> the post as the radar reads it, for the web app (a pasted link).
// X's own embed endpoint refuses servers, so posts are read through the public FxTwitter API.
async function fxStatus(id) {
  const res = await fetch(`https://api.fxtwitter.com/status/${id}`, { headers: { 'user-agent': 'NarrativeRadar/1.0' } });
  const d = res.ok ? await res.json().catch(() => null) : null;
  return d?.tweet || null;
}
async function readTweet(url, ctx) {
  const id = String(url || '').match(/^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/\w+\/status\/(\d+)/i)?.[1];
  if (!id) return json(400, { error: 'That is not a link to a post on X' });
  const key = new Request(`https://cache.narrative-radar/tw2/${id}`);
  const hit = await caches.default.match(key);
  if (hit) return new Response(hit.body, { headers: { 'content-type': 'application/json', ...CORS } });
  const t = await fxStatus(id);
  if (!t) return json(404, { error: "Couldn't open that post. It may be deleted, private or age-restricted." });
  const parent = t.replying_to_status ? await fxStatus(t.replying_to_status).catch(() => null) : null;
  // The pictures the AI looks at (it takes 3): the post's own (a video's thumbnail first), then the quoted post's,
  // then those of the post it replies to. The image is often the whole story, and it's often in the quote or a post
  // above: people tag under a reply ("this one") or quote a meme.
  const mediaOf = (x) => ({ video: x?.media?.videos?.[0] || null, photos: (x?.media?.photos || []).map((m) => m.url) });
  const own = mediaOf(t);
  const quote = mediaOf(t.quote);
  const above = mediaOf(parent);
  const video = own.video || quote.video || above.video;
  const images = [...new Set([own.video?.thumbnail_url, ...own.photos, quote.video?.thumbnail_url, ...quote.photos, above.video?.thumbnail_url, ...above.photos])]
    .filter((u) => /^https:\/\/pbs\.twimg\.com\//.test(u || ''));
  const author = t.author?.screen_name || '';
  const post = {
    text: t.text || '',
    quoted: t.quote ? `${t.quote.author?.screen_name ? `@${t.quote.author.screen_name}: ` : ''}${t.quote.text || ''}` : '',
    card: '',
    author,
    authorName: t.author?.name || '',
    replyTo: t.replying_to ? [t.replying_to] : [],
    parent: parent?.text || '',
    parentAuthor: parent?.author?.screen_name || '',
    url: `https://x.com/${author || 'i'}/status/${id}`,
    images: images.slice(0, 3),
    hasVideo: !!video,
    ...(video && /^https:\/\/video\.twimg\.com\//.test(video.url || '') ? { videoUrl: video.url, gif: video.type === 'gif' } : {}),
  };
  const label = (post.text || post.quoted || (video ? 'Video post' : images.length ? 'Image post' : '')).replace(/\s+/g, ' ').slice(0, 90);
  const out = json(200, { post, source: { kind: author ? `@${author}` : 'Post', label } }, { 'cache-control': 'public, max-age=600' });
  ctx.waitUntil(caches.default.put(key, out.clone()));
  return out;
}

// GET /larpcheck?address=<CA> -> Larpcheck's latest verdict on a coin (larpcheck.app, free API key).
// The key stays here (LARPCHECK_KEY secret), never in the extension. The free key allows 30 calls a
// minute for every user together, so answers are kept 10 minutes, and a day-old copy covers a busy minute.
// Larpcheck's terms: every verdict shown says it's from Larpcheck and links to its check (url).
const LC_WORDS = new Set(['REAL', 'LIKELY REAL', 'PARTLY REAL', 'UNCLEAR', 'LIKELY LARP', 'LARP', 'SCAM']);
// A coin's checks include sites and posts that only mention it (a token tool listing WIF as an example),
// so only a finished check of the coin itself counts: the newest of `latest` and the last 10 checks.
function larpcheckView(d, id) {
  const rows = [d?.latest, ...(Array.isArray(d?.checks) ? d.checks : [])].filter(Boolean);
  const l = rows.find((r) => r.status === 'done' && LC_WORDS.has(r.verdict) && /^https:\/\/larpcheck\.app\//.test(r.url || '')
    && (r.kind === 'coin' ? !r.coin || r.coin === id : r.kind == null && r.input === id));
  const page = /^https:\/\/larpcheck\.app\//.test(d?.page || '') ? d.page : null;
  if (!l) return { checked: false, page, running: Array.isArray(d?.running) && d.running.length > 0 };
  return {
    checked: true,
    page,
    url: l.url,
    verdict: l.verdict,
    score: Number.isFinite(l.score) ? l.score : null,
    total: Number.isFinite(l.total) ? l.total : null,
    headline: clip(l.headline, 300),
    call: clip(l.call, 200),
    created: clip(l.created, 40),
    stamps: (Array.isArray(l.stamps) ? l.stamps : []).slice(0, 3)
      .map((s) => ({ id: clip(s?.id, 12), word: clip(s?.word, 20), score: Number.isFinite(s?.score) ? s.score : null })),
  };
}
async function larpcheck(request, env, ctx) {
  const address = new URL(request.url).searchParams.get('address') || '';
  if (!/^([1-9A-HJ-NP-Za-km-z]{32,44}|0x[0-9a-fA-F]{40})$/.test(address)) return json(400, { error: 'Not a contract address' });
  if (!env.LARPCHECK_KEY) return json(200, { off: true });
  if (limited(`lc:${request.headers.get('cf-connecting-ip') || 'anon'}`, 300)) return json(429, { error: 'Too many lookups' });
  const id = address.startsWith('0x') ? address.toLowerCase() : address;
  const fresh = new Request(`https://cache.narrative-radar/lc2/${id}`);
  const stale = new Request(`https://cache.narrative-radar/lcs2/${id}`);
  const hit = await caches.default.match(fresh);
  if (hit) return new Response(hit.body, { headers: { 'content-type': 'application/json', ...CORS, 'x-cache': 'hit' } });
  const up = await fetch(`https://larpcheck.app/api/v1/coins/${id}`, {
    headers: { authorization: `Bearer ${env.LARPCHECK_KEY}`, 'user-agent': 'Radar/1.0 (+https://getradar.pages.dev)' },
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!up?.ok) {
    const old = await caches.default.match(stale);
    if (old) return new Response(old.body, { headers: { 'content-type': 'application/json', ...CORS, 'x-cache': 'stale' } });
    console.error('larpcheck', up?.status);
    return json(up?.status === 429 ? 429 : 502, { error: up?.status === 429 ? 'Larpcheck is busy, try again in a minute' : 'Larpcheck unavailable' });
  }
  const view = larpcheckView(await up.json().catch(() => null), id);
  const res = json(200, view, { 'cache-control': 'public, max-age=600' });
  ctx.waitUntil(Promise.all([
    caches.default.put(fresh, res.clone()),
    caches.default.put(stale, json(200, view, { 'cache-control': 'public, max-age=86400' })),
  ]));
  return res;
}

async function rpcRelay(request, env) {
  const target = relayUrl(env);
  if (!target) return json(503, { error: 'No relay configured' });
  if (limited(`rpc:${request.headers.get('cf-connecting-ip') || 'anon'}`, 1500)) return json(429, { error: 'Too many RPC calls' });
  const text = await request.text();
  if (text.length > 4000) return json(413, { error: 'Request too large' });
  let body;
  try { body = JSON.parse(text); } catch { return json(400, { error: 'Bad JSON' }); }
  if (Array.isArray(body) || !RPC_METHODS.has(body?.method)) return json(400, { error: 'Method not allowed' });
  // A relay that dies must not take the scan with it: on failure the caller falls back to the public RPC.
  let upstream;
  try {
    upstream = await fetch(target, { method: 'POST', headers: { 'content-type': 'application/json' }, body: text, signal: AbortSignal.timeout(20_000) });
  } catch {
    return json(502, { error: 'Relay unreachable' });
  }
  return new Response(upstream.body, { status: upstream.status, headers: { 'content-type': 'application/json', ...CORS } });
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (pathname === '/rpc' && request.method === 'POST') return rpcRelay(request, env);
    // Launching a coin from a post (server/launch.js).
    if (pathname === '/launch/settings' && request.method === 'GET') return json(200, { state: launchState(env) });
    if (pathname === '/launch/list' && request.method === 'GET') return json(200, await launchList(env));
    const launchFile = request.method === 'GET' && pathname.match(/^\/launch\/meta\/([0-9a-f]{24})\.(json|jpg|png|webp)$/);
    if (launchFile) return launchMetaFile(launchFile[1], launchFile[2], env, new URL(request.url).origin, CORS);
    if ((pathname === '/launch/meta' || pathname === '/launch/record') && request.method === 'POST') {
      if (limited(`launch:${request.headers.get('cf-connecting-ip') || 'anon'}`, pathname === '/launch/meta' ? 10 : 40)) return json(429, { error: 'Too many tries. Wait a few minutes.' });
      if (Number(request.headers.get('content-length') || 0) > 500_000) return json(413, { error: 'That picture is too big.' });
      const body = await request.json().catch(() => ({}));
      const origin = new URL(request.url).origin;
      const r = pathname === '/launch/meta' ? await launchMeta(body, env, origin) : await launchRecord(body, env, relayUrl(env) || 'https://api.mainnet-beta.solana.com', origin);
      return json(r.status, r.data);
    }
    // Scans opened from a bot reply: one number per day, nothing about who opened them.
    const counted = request.method === 'POST' && pathname.match(/^\/count\/(bot|discord|telegram)-scan$/);
    if (counted) {
      if (limited(`count:${request.headers.get('cf-connecting-ip') || 'anon'}`, 30)) return json(429, { error: 'Too many requests' });
      ctx.waitUntil(env.DB.prepare('INSERT INTO counts (day, name, n) VALUES (?, ?, 1) ON CONFLICT (day, name) DO UPDATE SET n = n + 1')
        .bind(new Date().toISOString().slice(0, 10), `${counted[1]}-scan`).run().catch(() => {}));
      return new Response(null, { status: 204, headers: CORS });
    }
    // Swap x.com for this site in any post link to scan it: /<user>/status/<id> opens the radar on it.
    const post = request.method === 'GET' && pathname.match(/^\/(\w{1,15})\/status\/(\d+)/);
    if (post) return Response.redirect(new URL(`/?url=${encodeURIComponent(`https://x.com/${post[1]}/status/${post[2]}`)}`, request.url), 302);
    if (pathname === '/tweet' && request.method === 'GET') return readTweet(new URL(request.url).searchParams.get('url'), ctx);
    if (pathname === '/larpcheck' && request.method === 'GET') return larpcheck(request, env, ctx);
    // Holder-only data (server/holder.js). 1.7.17 reads /holder/config and its panel promises Frontrun's data, so that
    // route stays off for it; 1.7.18 on reads /holder/settings, whose wording comes from here.
    if (pathname === '/holder/config' && request.method === 'GET') return json(200, { on: false });
    if (pathname === '/holder/settings' && request.method === 'GET') return json(200, await holderConfig(env));
    if ((pathname === '/holder/verify' || pathname === '/holder/who') && request.method === 'POST') {
      if (!holderOn(env)) return json(200, { off: true });
      if (limited(`holder:${request.headers.get('cf-connecting-ip') || 'anon'}`, 120)) return json(429, { error: 'Too many requests. Try again in a few minutes.' });
      const body = await request.json().catch(() => ({}));
      const r = pathname === '/holder/verify' ? await holderVerify(body, env, relayUrl(env)) : await holderWho(body, env, { limited });
      return json(r.status, r.body);
    }
    if (pathname === '/health') return json(200, {
      ok: true,
      rpc: !!relayUrl(env),
      larpcheck: !!env.LARPCHECK_KEY,
      engine: env.ANTHROPIC_API_KEY ? `claude:${env.CLAUDE_MODEL || 'claude-haiku-5-5'}` : [...['GROQ', 'CEREBRAS', 'GEMINI', 'OPENROUTER', 'MISTRAL']
        .map((k) => { const n = String(env[`${k}_API_KEY`] || '').split(/[\s,]+/).filter(Boolean).length; return n ? `${k.toLowerCase()} x${n}` : null; }),
      env.AI && 'workers-ai'].filter(Boolean).join(' > ') || 'none',
    });
    if (request.method === 'POST' && ['/interpret', '/judge', '/transcribe', '/story', '/match'].includes(pathname)) {
      try {
        return await route(pathname.slice(1), request, env, ctx);
      } catch (e) {
        console.error(pathname, e?.status, e?.message);
        if (/busy right now/.test(String(e?.message))) return json(503, { error: 'The AI is busy right now. Try again in a few seconds.' });
        if (/ 429$/.test(String(e?.message))) return json(429, { error: 'Every AI key is at its limit right now. Add more keys or try again later.', quota: true });
        if (/daily free allocation|4006/.test(String(e?.message))) {
          return json(429, { error: 'Free AI limit reached for today. It resets at 00:00 UTC.', quota: true });
        }
        return json(502, { error: e?.status === 429 ? 'Narrative engine is busy, retry shortly' : 'Narrative engine failed' });
      }
    }
    return json(404, { error: 'Not found' });
  },
};
