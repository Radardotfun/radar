// More of Larpcheck's API (larpcheck.app/api/v1) for Radar. The key stays here on the server. Their terms: name Larpcheck,
// link every verdict to its check, never reword one. Reads are free at 30 calls a minute, so answers are cached. New checks
// and questions need an API plan, and they cost money, so they're for $RADAR holders with daily limits. Without a plan
// /lc/settings says so and the panel doesn't offer them.
import { readToken } from './holder.js';

const BASE = 'https://larpcheck.app/api/v1';
const ADDRESS = /^([1-9A-HJ-NP-Za-km-z]{32,44}|0x[0-9a-fA-F]{40})$/;
const HANDLE = /^\w{1,15}$/;
const CHECK_ID = /^[\w-]{4,64}$/;
const POST_LINK = /^https:\/\/(?:x|twitter)\.com\/\w{1,15}\/status\/\d{1,25}$/;
const WORDS = new Set(['REAL', 'LIKELY REAL', 'PARTLY REAL', 'UNCLEAR', 'LIKELY LARP', 'LARP', 'SCAM']);
const RISK = new Set(['LIKELY LARP', 'LARP', 'SCAM']);
const OUR_SITE = /^https:\/\/larpcheck\.app\//;
const EVM_CHAINS = new Set(['base', 'bsc', 'ethereum', 'robinhood']);
export const CHECKS_PER_WALLET = 5;
export const QUESTIONS_PER_WALLET = 20;
const CHECKS_PER_DAY = 100;

const clip = (s, n) => (typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f<>]/g, ' ').trim().slice(0, n) : null);
const num = (v) => (Number.isFinite(v) ? v : null);

async function call(env, path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${env.LARPCHECK_KEY}`, accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}) },
    signal: AbortSignal.timeout(init.timeout || 12_000),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

// Keeps an answer for `seconds` at the edge, so one coin or list costs one call however many people look.
async function cached(ctx, key, seconds, make) {
  const req = new Request(`https://cache.narrative-radar/lc3/${key}`);
  const hit = await caches.default.match(req);
  if (hit) return hit.json();
  const { value, keep = true } = await make();
  if (keep) ctx.waitUntil(caches.default.put(req, new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${seconds}` } })));
  return value;
}

// A check as a list row, only with what may be shown: a finished verdict linked to its own check.
export function rowView(r) {
  if (!r || r.status !== 'done' || !WORDS.has(r.verdict) || !OUR_SITE.test(r.url || '')) return null;
  return {
    id: clip(r.id, 64), url: r.url, kind: clip(r.kind, 8), coin: ADDRESS.test(r.coin || '') ? r.coin : null,
    title: clip(r.title, 60), verdict: r.verdict, score: num(r.score), total: num(r.total), call: clip(r.call, 160), input: clip(r.input, 200), created: clip(r.created, 40),
  };
}

// The site's lists of coins: most asked, most real, most larp today.
export const boardFrom = (rows) => (rows || []).map(rowView).filter((r) => r?.coin).slice(0, 6);
export async function lcBoard(sort, env, ctx) {
  if (!['asks', 'real', 'larp'].includes(sort)) return { status: 400, data: { error: 'Bad list' } };
  if (!env.LARPCHECK_KEY) return { status: 200, data: { off: true } };
  const data = await cached(ctx, `board/${sort}`, 300, async () => {
    const r = await call(env, `/checks?sort=${sort}&span=day&kind=coin&limit=20`);
    return r.ok ? { value: { rows: boardFrom(r.data?.checks) } } : { value: { rows: [] }, keep: false };
  });
  return { status: 200, data };
}

// What Larpcheck has checked from one X account. Its search also finds posts that only mention the account, so a row
// only counts when the post's own link names it.
export function handleView(rows, handle) {
  const own = new RegExp(`^https?://(?:www\\.|mobile\\.)?(?:x|twitter)\\.com/${handle}/status/\\d+`, 'i');
  const mine = (rows || []).map(rowView).filter((r) => r && own.test(r.input || ''));
  return {
    checked: mine.length,
    risky: mine.filter((r) => RISK.has(r.verdict)).length,
    rows: mine.slice(0, 3).map((r) => ({ url: r.url, verdict: r.verdict, total: r.total ?? r.score, title: r.title })),
  };
}
export async function lcHandle(handle, env, ctx) {
  if (!env.LARPCHECK_KEY || !HANDLE.test(handle || '')) return null;
  return cached(ctx, `handle/${handle.toLowerCase()}`, 1800, async () => {
    const r = await call(env, `/checks?q=${encodeURIComponent(handle)}&kind=post&limit=50`);
    return r.ok ? { value: handleView(r.data?.checks, handle) } : { value: null, keep: false };
  });
}

// Larpcheck's holder panel, for the chains Radar's own holder check doesn't cover. Their words, linked to their page.
export function holdersView(d, address) {
  const h = d?.holders;
  if (h?.status !== 'ready' || !h.summary) return { ready: false };
  const verdict = clip(h.reading?.verdict, 20);
  return {
    ready: true,
    holders: num(h.summary.holders),
    top10: num(h.summary.top10Pct),
    verdict,
    line: clip(h.reading?.line, 140),
    ok: verdict === 'organic',
    page: `https://larpcheck.app/${address}`,
  };
}
export async function lcHolders(address, chain, env, ctx) {
  if (!ADDRESS.test(address || '')) return { status: 400, data: { error: 'Not a contract address' } };
  const evm = address.startsWith('0x');
  if (evm && !EVM_CHAINS.has(chain)) return { status: 400, data: { error: 'Bad chain' } };
  if (!env.LARPCHECK_KEY) return { status: 200, data: { off: true } };
  const id = evm ? address.toLowerCase() : address;
  const data = await cached(ctx, `holders/${chain || 'solana'}/${id}`, 300, async () => {
    const r = await call(env, `/holders/${id}${evm ? `?chain=${chain}` : ''}`);
    const value = r.ok ? holdersView(r.data, id) : { ready: false };
    return { value, keep: !!value.ready };
  });
  return { status: 200, data };
}

// Whether this key can start checks and take questions.
export const hasPlan = (me) => !!me?.apiPlan;
export async function lcSettings(env, ctx) {
  if (!env.LARPCHECK_KEY) return { plan: false };
  return cached(ctx, 'settings', 600, async () => {
    const r = await call(env, '/me');
    return r.ok ? { value: { plan: hasPlan(r.data) } } : { value: { plan: false }, keep: false };
  });
}

// One more use of something limited per day, or false when it's used up. D1 keeps the count across the Worker's copies.
async function spend(env, name, cap) {
  const day = new Date().toISOString().slice(0, 10);
  const row = await env.DB.prepare('SELECT n FROM counts WHERE day = ? AND name = ?').bind(day, name).first();
  if ((row?.n || 0) >= cap) return false;
  await env.DB.prepare('INSERT INTO counts (day, name, n) VALUES (?, ?, 1) ON CONFLICT (day, name) DO UPDATE SET n = n + 1').bind(day, name).run();
  return true;
}
const refused = (r) => (r.status === 402 || r.status === 403
  ? { status: 402, data: { error: "Checks in Radar aren't switched on right now. You can check it on Larpcheck." } }
  : { status: r.status === 429 ? 429 : 502, data: { error: 'Larpcheck is busy. Try again in a minute.' } });

// POST /lc/check { token, input }: starts a check for a $RADAR holder, or finds a recent one (which costs nothing).
export async function lcStart(body, env) {
  const wallet = await readToken(env, body?.token);
  if (!wallet) return { status: 401, data: { error: 'Your holder check ran out. Connect your wallet again.' } };
  const input = String(body?.input || '').trim();
  if (!ADDRESS.test(input) && !POST_LINK.test(input)) return { status: 400, data: { error: 'That is not a coin or a post on X' } };
  if (!await spend(env, `lc-check:${wallet}`, CHECKS_PER_WALLET)) return { status: 429, data: { error: `You've used your ${CHECKS_PER_WALLET} checks for today. Try again tomorrow.` } };
  if (!await spend(env, 'lc-check', CHECKS_PER_DAY)) return { status: 429, data: { error: 'Radar has used its checks for today. Try again tomorrow.' } };
  const r = await call(env, '/checks', { method: 'POST', body: JSON.stringify({ input }), timeout: 20_000 });
  if (!r.ok) return refused(r);
  return { status: 200, data: { id: clip(r.data?.id, 64), url: OUR_SITE.test(r.data?.url || '') ? r.data.url : null, reused: !!r.data?.reused } };
}

// A check while it runs, then its verdict.
export function checkView(d) {
  const v = d?.verdict;
  const done = d?.status === 'done' && WORDS.has(v?.verdict) && OUR_SITE.test(d?.url || '');
  return {
    id: clip(d?.id, 64),
    status: clip(d?.status, 12),
    step: clip(d?.progress?.last, 80),
    error: d?.status === 'error' ? 'Larpcheck could not finish this check.' : null,
    lc: done ? {
      checked: true, id: clip(d.id, 64), url: d.url, verdict: v.verdict, score: num(v.score), total: num(v.total), headline: clip(v.headline, 300), call: clip(v.call, 200),
      stamps: (Array.isArray(v.stamps) ? v.stamps : []).slice(0, 3).map((s) => ({ id: clip(s?.id, 12), word: clip(s?.word, 20), score: num(s?.score) })),
    } : null,
  };
}
export async function lcPoll(id, env) {
  if (!CHECK_ID.test(id || '')) return { status: 400, data: { error: 'Bad check' } };
  const r = await call(env, `/checks/${id}`);
  return r.ok ? { status: 200, data: checkView(r.data) } : { status: r.status === 404 ? 404 : 502, data: { error: 'Could not read that check.' } };
}

// POST /lc/ask { token, id, question }: a question about a finished check, answered by Larpcheck from its evidence.
export async function lcAsk(body, env) {
  const wallet = await readToken(env, body?.token);
  if (!wallet) return { status: 401, data: { error: 'Your holder check ran out. Connect your wallet again.' } };
  const id = String(body?.id || '');
  const question = clip(String(body?.question || ''), 499);
  if (!CHECK_ID.test(id) || !question) return { status: 400, data: { error: 'Ask a question first.' } };
  if (!await spend(env, `lc-ask:${wallet}`, QUESTIONS_PER_WALLET)) return { status: 429, data: { error: `You've asked ${QUESTIONS_PER_WALLET} questions today. Try again tomorrow.` } };
  const r = await call(env, `/checks/${id}/ask`, { method: 'POST', body: JSON.stringify({ question }), timeout: 45_000 });
  if (!r.ok) return refused(r);
  return { status: 200, data: { answer: clip(r.data?.answer, 2000), url: OUR_SITE.test(r.data?.url || '') ? r.data.url : null } };
}
