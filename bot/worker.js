// The Radar bot (Cloudflare Worker "radar-bot"): people tag it under a post on X and it replies with the post's
// three picks (bot/reply.js). Every minute it reads its new mentions, scans the post each one is about with Radar's
// own backend (the same code the web version runs; requests to the Radar server go through the RADAR service
// binding), and replies. Until BOT_LIVE is "1" it only logs the reply it would post.
//
// Costs (docs.x.com pricing, 29 Oct 2026): $0.005 per post read, $0.01 per reply to a tag ("summoned"), $0.20 for a
// post with a link, so replies carry none. No reply caps (the user's call, 29 Oct 2026): spending is bounded by the
// limit set in X's developer console. A post tagged many times is still scanned once per 10 minutes.
// Each tag is handled in its own run of this Worker (through the SELF binding), so a busy minute never hits the
// per-run request limit; the batch is saved before any reply, so a tag can't be answered twice.
//
// Secrets: X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET (the bot account's keys), BOT_TOKEN (for the
// pages below). Pages (BOT_TOKEN as ?token= or x-bot-token): GET /health, GET /log, GET /preview?url=<post>,
// POST /poll (run one round now).
import { makeHandlers, API_BASE, DEFAULTS } from '../extension/src/lib/handlers.js';
import { searchPairs, allPairs, aggregate } from '../extension/src/lib/market.js';
import { botReply, NO_COINS, xLength } from './reply.js';
import { botCoins, withMemory } from './coins.js';
import { oauthHeader } from './oauth.js';
import { wantsCoins } from './trigger.js';

const X = 'https://api.x.com/2';

// Radar's backend calls the Radar server by its public address; inside Cloudflare that goes through the binding.
const realFetch = globalThis.fetch.bind(globalThis);
let radar = null;
// Requests made and failed since the last reset, by host (the /preview page reports them).
const calls = { n: 0, failed: 0, hosts: {}, errors: [] };
globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  calls.n += 1;
  const host = new URL(url).host;
  calls.hosts[host] = (calls.hosts[host] || 0) + 1;
  const p = radar && url.startsWith(API_BASE) ? radar.fetch(new Request(input, init)) : host === 'api.dexscreener.com' ? dexFetch(input, init) : realFetch(input, init);
  return p.catch((e) => { calls.failed += 1; if (calls.errors.length < 5) calls.errors.push(`${host}: ${String(e.message || e).slice(0, 120)}`); throw e; });
};

// Cloudflare's outgoing addresses are shared by many Workers, so DexScreener answers 429 here when a scan fires its
// 15 or so lookups at once, which a browser gets away with. So the bot paces them (two at a time, 300 ms apart) and,
// after a 429, holds every lookup back 2.5 s. The retrying itself is market.js's (four tries with backoff).
// A run may make only 50 requests, so each scan gets DEX_BUDGET real DexScreener requests; past that a lookup
// fails at once without going out (a 503, which market.js doesn't retry), the scan fails, and the tag goes on the retry
// list for the next minute.
const DEX_BUDGET = 34;
// Of those, kept for looking up the coin the post names once the scan is done (up to 3 CAs, 2 tickers, a retry).
const NAMED_RESERVE = 6;
let dexBudget = DEX_BUDGET;
let dexActive = 0;
let dexLast = 0;
let dexCoolUntil = 0;
const dexWaiting = [];
// Each DexScreener URL's last answer this run: one still at 429 or 503 at the end is a lookup the scan went without.
const dexLastStatus = new Map();
const dexLost = () => [...dexLastStatus.values()].filter((st) => st === 429 || st === 503).length;
async function dexSlot() {
  if (dexActive >= 2) await new Promise((r) => dexWaiting.push(r));
  dexActive += 1;
  const start = Math.max(Date.now(), dexLast + 300, dexCoolUntil);
  dexLast = start;
  if (start > Date.now()) await new Promise((r) => setTimeout(r, start - Date.now()));
}
function dexDone() {
  dexActive -= 1;
  dexWaiting.shift()?.();
}
// DexScreener answers Cloudflare's shared addresses 429 (error 1015) for minutes at a time, which left tags with
// nothing but "too busy". So lookups go through a small proxy off Cloudflare (proxy/api/dex.js), set by DEX_PROXY_URL and
// DEX_PROXY_SECRET. If the proxy itself is down, a lookup goes direct.
let dexProxy = null;
const useDexProxy = (env) => { dexProxy = env.DEX_PROXY_URL && env.DEX_PROXY_SECRET ? { url: env.DEX_PROXY_URL, secret: env.DEX_PROXY_SECRET } : null; };
async function dexRequest(url, init = {}) {
  if (!dexProxy) return realFetch(url, init);
  const via = `${dexProxy.url}?path=${encodeURIComponent(url.replace('https://api.dexscreener.com/', ''))}`;
  const res = await realFetch(via, { ...init, headers: { ...(init.headers || {}), 'x-radar-proxy': dexProxy.secret } }).catch(() => null);
  return res && res.status !== 401 && res.status < 500 ? res : realFetch(url, init);
}
async function dexFetch(input, init = {}) {
  const url = String(input?.url || input);
  if (dexBudget <= 0) { dexLastStatus.set(url, 503); return new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } }); }
  dexBudget -= 1;
  // The caller's 8 s timeout would also count the time waiting for a slot here and cancel the lookup; the request
  // itself gets its own 10 s instead.
  const { signal, ...rest } = init;
  await dexSlot();
  try {
    const res = await dexRequest(url, { ...rest, signal: AbortSignal.timeout(10_000) });
    if (res.status === 429) { dexCoolUntil = Date.now() + 2500; calls.retries = (calls.retries || 0) + 1; }
    dexLastStatus.set(url, res.status);
    return res;
  } finally {
    dexDone();
  }
}

const mem = new Map();
// The bot answers for Solana, Robinhood Chain, Base and BNB Chain (what people asked for), whatever the panel scans.
const SETTINGS = { ...DEFAULTS, chains: ['solana', 'robinhood', 'base', 'bsc'] };
const HOST = {
  settings: async () => SETTINGS,
  store: { get: async (k) => mem.get(k), set: async (k, v) => mem.set(k, v) },
  openWindow: () => {},
  rpcUrl: async () => null,
  ready: Promise.resolve(),
  inlineImages: false,
};
const handlers = makeHandlers(HOST);

const json = (status, body) => new Response(JSON.stringify(body, null, 1), { status, headers: { 'content-type': 'application/json' } });
// Trimmed: a pasted key often carries a space or a line break, and X then refuses the signature (401).
const keys = (env) => ({ apiKey: String(env.X_API_KEY || '').trim(), apiSecret: String(env.X_API_SECRET || '').trim(), accessToken: String(env.X_ACCESS_TOKEN || '').trim(), accessSecret: String(env.X_ACCESS_SECRET || '').trim() });
// How long each key is, never what it is: an API Key is about 25 characters, its secret about 50, an Access Token
// about 50 and starts with the account's number, its secret about 45. Shows whether two were pasted in swapped.
const keyShape = (env) => {
  const k = keys(env);
  return { apiKey: k.apiKey.length, apiSecret: k.apiSecret.length, accessToken: k.accessToken.length, accessTokenHasAccountId: /^\d+-/.test(k.accessToken), accessSecret: k.accessSecret.length, rawHadSpaces: [env.X_API_KEY, env.X_API_SECRET, env.X_ACCESS_TOKEN, env.X_ACCESS_SECRET].some((v) => v && v !== v.trim()) };
};
const hasKeys = (env) => !!(env.X_API_KEY && env.X_API_SECRET && env.X_ACCESS_TOKEN && env.X_ACCESS_SECRET);

async function xApi(env, method, url, body) {
  const res = await realFetch(url, {
    method,
    headers: { authorization: await oauthHeader(method, url, keys(env)), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`X ${res.status}: ${data.detail || data.title || JSON.stringify(data).slice(0, 160)}`), { status: res.status, data });
  return data;
}

// A Solana address written in a post: the token at it, or the token of the pool at it (a dexscreener.com/solana/<pool>
// link), or null when it is neither (a wallet). A busy DexScreener throws, and the tag is retried.
async function lookupCa(ca) {
  // A 0x address: DexScreener's search finds it on whichever chain it lives (the token, or one of its pools).
  if (/^0x/i.test(ca)) {
    const key = ca.toLowerCase();
    const hit = aggregate(await searchPairs(ca)).find((t) => SETTINGS.chains.includes(t.chain)
      && (t.address.toLowerCase() === key || t.pairAddresses.some((p) => p.toLowerCase() === key)));
    if (!hit) return null;
    return aggregate(await allPairs(hit.chain, hit.address)).find((t) => t.address === hit.address) || hit;
  }
  let address = ca;
  let pairs = await allPairs('solana', ca);
  if (!pairs.length) {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/pairs/solana/${ca}`, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`DexScreener ${r.status} looking up the coin in the post`);
    address = (await r.json().catch(() => ({}))).pairs?.[0]?.baseToken?.address;
    if (!address) return null;
    pairs = await allPairs('solana', address);
  }
  return aggregate(pairs).find((t) => t.address === address) || null;
}

// Which coin logos show the post's own picture (the engine's /match: one AI call comparing up to 16 logos).
async function matchImages(images, logos) {
  const r = await fetch(`${API_BASE}/match`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ post: { images }, logos }), signal: AbortSignal.timeout(30_000) });
  return r.ok ? (await r.json()).same || [] : [];
}

// A coin still on pump.fun's launch curve: DexScreener often gives it no price (so a reply about $RADAR showed no
// market cap), Jupiter does, and a pump.fun coin has 1B tokens.
async function curveCap(t) {
  if (t.chain !== 'solana') return 0;
  const r = await fetch(`https://lite-api.jup.ag/price/v3?ids=${t.address}`, { signal: AbortSignal.timeout(6000) });
  const p = r.ok ? (await r.json())[t.address] : null;
  return p?.launchpad === 'pump.fun' && p.usdPrice > 0 ? p.usdPrice * 1e9 : 0;
}

// One post, as the bot would answer it. Kept 10 minutes, so a post tagged many times is scanned once.
const scans = new Map();
// known: the verdicts this post got on earlier tags ({ address: score }), which win over a new judge call.
// fresh: a retry, after DexScreener left lookups unanswered: nothing cached in this run is reused (the server's own
// caches of the AI's answers still are).
async function replyFor(postUrl, known = null, fresh = false) {
  const hit = !fresh && scans.get(postUrl);
  if (hit && Date.now() - hit.at < 600_000) return hit.p;
  const h = fresh ? makeHandlers(HOST) : handlers;
  const p = (async () => {
    const { post } = await h.tweet({ url: postUrl });
    // A tag under one of @radardotfunn's own posts (people trying the bot under its announcement): no scan of our
    // own words, just how to use it.
    if (String(post.author || '').toLowerCase() === 'radardotfunn') {
      const tip = `Tag me under a news post, a meme or any post with a story, and I'll reply with the coins behind it (${new Date().toISOString().slice(11, 16)} UTC).`;
      return { text: tip, short: tip, links: tip, story: 'our own post' };
    }
    // The panel skips the AI judge when the read gives anchor words (any coin naming one counts); the bot posts in
    // public, so every candidate is judged.
    // The coin the post names (its CA or $TICKER) is looked up after the scan; a scan that ran into DexScreener's
    // limits used to spend the whole budget first, so the reply lost the very coin the post names (Dacity Coin on a
    // GTA 6 post). Some lookups are held back for it.
    const reserve = Math.min(NAMED_RESERVE, dexBudget);
    dexBudget -= reserve;
    const found = await h.coins({ post, judge: true }).finally(() => { dexBudget += reserve; });
    if (found.engineError) throw new Error('Radar could not read this post right now');
    const { scan, scores } = withMemory(found, known);
    const res = { ...scan, ...await botCoins(scan, post, { search: searchPairs, lookupCa, matchImages, capOf: curveCap, chains: SETTINGS.chains }) };
    return { text: botReply(res, postUrl) || NO_COINS, short: botReply(res, postUrl, Date.now(), { full: false }) || NO_COINS, links: botReply(res, postUrl, Date.now(), { links: true }) || NO_COINS, story: res.narrative || '', scores };
  })();
  scans.set(postUrl, { at: Date.now(), p });
  p.catch(() => scans.delete(postUrl));
  if (scans.size > 300) scans.delete(scans.keys().next().value);
  return p;
}

// Bot state in one KV key, written once per round that had mentions (KV's free plan allows 1,000 writes a day).
async function loadState(env) {
  return { since: null, me: null, day: '', sent: 0, mine: [], log: [], pending: [], ...((await env.BOT_KV.get('state', 'json')) || {}) };
}

async function poll(env) {
  if (!hasKeys(env)) return { skipped: 'no X keys yet' };
  const s = await loadState(env);
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  if (s.day !== day) { s.day = day; s.sent = 0; }
  if (!s.me) s.me = (await xApi(env, 'GET', `${X}/users/me`)).data;

  // Every new mention, newest first, 100 a page (X's maximum), up to 10 pages a round.
  const mentions = [];
  let newest = null;
  let next = null;
  for (let pages = 0; pages < 10; pages++) {
    const url = new URL(`${X}/users/${s.me.id}/mentions`);
    url.searchParams.set('max_results', '100');
    url.searchParams.set('tweet.fields', 'author_id,created_at,referenced_tweets,display_text_range,entities');
    if (s.since) url.searchParams.set('since_id', s.since);
    if (next) url.searchParams.set('pagination_token', next);
    const page = await xApi(env, 'GET', url.href);
    newest ||= page.meta?.newest_id || null;
    mentions.push(...(page.data || []));
    next = page.meta?.next_token;
    if (!next || !s.since) break;
  }
  // First run: start from now, without answering old tags.
  if (!s.since) {
    s.since = newest || '0';
    await env.BOT_KV.put('state', JSON.stringify(s));
    return { started: true, since: s.since };
  }
  // Tags that failed for a passing reason (DexScreener or the AI busy) come back for another try.
  const retry = (s.pending || []).filter((p) => p.tries < 5);
  if (!mentions.length && !retry.length) return { mentions: 0 };

  // Claim the batch before replying: the new mentions, and the retries (taken off the list now and put back below
  // only if they fail again). If the state can't be saved, nothing is posted this round: a tag may then wait, but it
  // can never get two replies.
  s.since = newest || s.since;
  s.pending = [];
  try {
    await env.BOT_KV.put('state', JSON.stringify(s));
  } catch (e) {
    return { error: `could not save the bot's state, so nothing was posted: ${String(e.message || e).slice(0, 120)}` };
  }

  const live = env.BOT_LIVE === '1';
  const done = [...mentions].reverse().map((m) => {
    const entry = { at: new Date().toISOString(), mention: m.id, by: m.author_id, tries: 0 };
    const ref = (m.referenced_tweets || []).find((r) => r.type === 'replied_to') || (m.referenced_tweets || []).find((r) => r.type === 'quoted');
    entry.target = ref?.id || m.id;
    const ask = wantsCoins(m, s.me.username);
    if (m.author_id === s.me.id || s.mine.includes(entry.target)) entry.skip = 'own post';
    else if (!ask.ok) entry.skip = ask.why;
    return entry;
  }).concat(retry.map((p) => ({ at: new Date().toISOString(), mention: p.mention, by: p.by, target: p.target, tries: p.tries, retry: true })));
  // Each tag in its own run of this Worker, all at once.
  await Promise.all(done.filter((e) => !e.skip).map((entry) => env.SELF.fetch('https://radar-bot/handle', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-bot-token': env.BOT_TOKEN },
    body: JSON.stringify({ mention: entry.mention, target: entry.target, live, tries: entry.tries || 0, scores: s.judged?.[entry.target]?.s || null }),
  }).then((r) => r.json()).then((r) => Object.assign(entry, r)).catch((e) => { entry.error = String(e.message || e).slice(0, 200); })));

  for (const e of done) if (e.reply || e.dry) s.sent += 1;
  // Each post's verdicts, for its next tags: kept a day, for the 50 posts tagged last.
  s.judged = s.judged || {};
  for (const e of done) {
    if (e.scores) s.judged[e.target] = { at: Date.now(), s: e.scores };
    delete e.scores;
  }
  s.judged = Object.fromEntries(Object.entries(s.judged).filter(([, v]) => Date.now() - v.at < 86_400_000).sort((a, b) => b[1].at - a[1].at).slice(0, 50));
  // A busy DexScreener, AI or X (429, timeouts) is worth another try next minute; anything else is not.
  s.pending = done.filter((e) => e.error && /rate-limit|429|timed out|timeout|could not read|Too Many/i.test(e.error) && !e.reply)
    .map((e) => ({ mention: e.mention, by: e.by, target: e.target, tries: (e.tries || 0) + 1 }));
  s.mine = [...done.map((e) => e.reply).filter(Boolean), ...s.mine].slice(0, 200);
  s.log = [...done.reverse(), ...s.log].slice(0, 60);
  await env.BOT_KV.put('state', JSON.stringify(s)).catch(() => {});
  return { mentions: mentions.length, live, handled: done.map(({ text, ...rest }) => rest) };
}

// One tag: scan the post it's about, then reply (or, in dry mode, only say what the reply would be).
async function handle(env, { mention, target, live, scores: known = null, tries = 0 }) {
  dexBudget = DEX_BUDGET;
  dexLastStatus.clear();
  const postUrl = `https://x.com/i/status/${target}`;
  const post = (t) => xApi(env, 'POST', `${X}/tweets`, { text: t, reply: { in_reply_to_tweet_id: mention } });
  let found;
  try {
    found = await replyFor(postUrl, known, tries > 0);
  } catch (e) {
    // The fifth try failed too (a busy DexScreener can last that long): say so rather than leave the tag unanswered.
    if (tries < 4) throw e;
    const busy = `Too busy to read this post right now (${new Date().toISOString().slice(11, 16)} UTC). Tag me again in a few minutes.`;
    if (!live) return { busy: String(e.message || e).slice(0, 200), chars: xLength(busy), text: busy, dry: true };
    const sent = await post(busy);
    return { busy: String(e.message || e).slice(0, 200), chars: xLength(busy), text: busy, reply: sent.data?.id };
  }
  const { text, short, links, story, scores } = found;
  // DexScreener left lookups unanswered: the coins may be missing the big one. Try again next minute (a new run,
  // a fresh budget), with this scan dropped from the cache. The retry list allows five tries in all (one a minute);
  // the last one posts what there is.
  const lost = dexLost();
  if (lost && tries < 4) {
    scans.delete(postUrl);
    throw new Error(`DexScreener rate-limited ${lost} lookup${lost === 1 ? '' : 's'}, trying again next minute`);
  }
  const out = { story, chars: xLength(text), text, scores, ...(lost ? { lost } : {}) };
  if (!live) return { ...out, dry: true };
  // The keys were authorised on 29 Oct 2026 around 17:05 UTC, and X refuses crypto addresses as text for a week:
  // until then each coin gets its DexScreener link (the user's call, at $0.20 a reply), then the full address.
  let sent = Date.now() < Date.parse('2026-11-05T18:00:00Z') ? links : text;
  let posted;
  try {
    posted = await post(sent);
  } catch (e) {
    // X won't take crypto addresses in an app's first 7 days: send the short form instead. And it refuses a reply
    // identical to an earlier one: the seconds make it different.
    if (/crypto address/i.test(e.message)) sent = short;
    else if (!/duplicate/i.test(e.message)) throw e;
    posted = await post(sent.replace(' UTC):', `:${String(new Date().getUTCSeconds()).padStart(2, '0')} UTC):`));
  }
  return { ...out, text: sent, chars: xLength(sent), form: sent === short ? 'short' : sent === links ? 'links' : 'full', reply: posted.data?.id };
}

const authorized = (req, env) => {
  const u = new URL(req.url);
  const t = req.headers.get('x-bot-token') || u.searchParams.get('token');
  return !!env.BOT_TOKEN && t === env.BOT_TOKEN;
};

export default {
  async fetch(request, env) {
    radar = env.RADAR;
    useDexProxy(env);
    const u = new URL(request.url);
    if (!authorized(request, env)) return json(401, { error: 'token required' });
    if (u.pathname === '/health') {
      const s = await loadState(env);
      return json(200, { live: env.BOT_LIVE === '1', keys: hasKeys(env), keyShape: keyShape(env), account: s.me?.username || null, today: { day: s.day, replies: s.sent }, since: s.since });
    }
    if (u.pathname === '/log') return json(200, (await loadState(env)).log);
    // X's full answer to "who am I" with these keys (status, its body and the headers that explain a refusal).
    if (u.pathname === '/debug-me') {
      const host = u.searchParams.get('host') === 'twitter' ? 'https://api.twitter.com/2' : X;
      const url = `${host}/users/me`;
      const r = await realFetch(url, { headers: { authorization: await oauthHeader('GET', url, keys(env)) } });
      const pick = ['www-authenticate', 'x-access-level', 'x-rate-limit-remaining', 'x-transaction-id'];
      return json(200, { status: r.status, headers: Object.fromEntries(pick.map((h) => [h, r.headers.get(h)]).filter(([, v]) => v)), body: (await r.text()).slice(0, 600) });
    }
    // How DexScreener answers this Worker (the coin search runs from here, not from a browser).
    if (u.pathname === '/debug-search') {
      const q = u.searchParams.get('q') || 'gemini';
      const t0 = Date.now();
      const r = await dexRequest(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`).catch((e) => ({ status: 0, text: async () => String(e) }));
      const body = await r.text();
      let pairs = null;
      try { pairs = JSON.parse(body).pairs?.length ?? null; } catch {}
      return json(200, { q, proxy: !!dexProxy, status: r.status, ms: Date.now() - t0, pairs, head: pairs == null ? body.slice(0, 200) : undefined });
    }
    if (u.pathname === '/preview') {
      const url = u.searchParams.get('url') || '';
      if (!/^https:\/\/(x|twitter)\.com\/\w+\/status\/\d+/.test(url)) return json(400, { error: 'url= must be a post on X' });
      const t0 = Date.now();
      Object.assign(calls, { n: 0, failed: 0, hosts: {}, errors: [] });
      dexBudget = DEX_BUDGET;
      try {
        const r = await replyFor(url);
        return json(200, { ms: Date.now() - t0, chars: xLength(r.text), story: r.story, reply: r.text, calls });
      } catch (e) {
        return json(502, { error: String(e.message || e) });
      }
    }
    // One tag, called by poll() through the SELF binding (a run of its own).
    if (u.pathname === '/handle' && request.method === 'POST') {
      try { return json(200, await handle(env, await request.json())); } catch (e) { return json(200, { error: String(e.message || e).slice(0, 200) }); }
    }
    if (u.pathname === '/poll' && request.method === 'POST') {
      try { return json(200, await poll(env)); } catch (e) { return json(502, { error: String(e.message || e) }); }
    }
    return json(404, { error: 'not found' });
  },
  async scheduled(event, env, ctx) {
    radar = env.RADAR;
    useDexProxy(env);
    ctx.waitUntil(poll(env).catch((e) => console.log('poll failed', e.message)));
  },
};
