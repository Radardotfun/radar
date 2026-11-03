// Big account alerts: the posts the account watcher (bot/signals.js) scored as something people launch coins off. Holders get them
// live: what's here costs real money to find, so the server checks the holder token, since the code is public. The alerts page
// (tryradar.fun/alerts) can also ask for the public list, which is the same posts 10 minutes later, with nothing to scan for coins.
import { readToken } from './holder.js';

const MAX_AGE_MS = 3_600_000;
const HISTORY_MS = 24 * 3_600_000;
const MAX_ROWS = 10;
const HISTORY_ROWS = 20;
export const SIGNAL_DELAY_MS = 10 * 60_000;

// Diamond Hand rows (bot/diamond.js) are for holders only, so the public list leaves them out.
const read = async (env, since, until, limit, live = true) => (await env.DB.prepare(`SELECT id, author, read_at, kind, post, narrative, terms FROM signals WHERE signal = 1 AND read_at > ? AND read_at <= ?${live ? '' : " AND kind != 'diamond'"} ORDER BY read_at DESC LIMIT ?`).bind(since, until, limit).all()).results || [];

const view = (r, live) => {
  const post = JSON.parse(r.post || '{}');
  return {
    id: r.id,
    author: r.author,
    // When it was judged, which the extension sends back as since. Posts are judged newest first, so going by when one was
    // posted would lose an older post flagged after a newer one.
    at: r.read_at,
    kind: r.kind,
    name: JSON.parse(r.terms || '[]')[0] || '',
    // Kept as "<score>: <why>".
    why: String(r.narrative || '').replace(/^\d+:\s*/, ''),
    text: String(post.text || '').slice(0, 200),
    parent: String(post.parent || post.quoted || '').slice(0, 200),
    url: post.url || '',
    // What a holder's browser scans for the top 3 coins.
    ...(live ? { post: { text: String(post.text || '').slice(0, 1500), quoted: String(post.quoted || '').slice(0, 800), parent: String(post.parent || '').slice(0, 800), parentAuthor: post.parentAuthor || '', author: post.author || r.author, authorName: post.authorName || '', url: post.url || '', images: post.images || [], hasVideo: !!post.hasVideo } } : {}),
  };
};

/** { token, since, history } -> live, newest first. { public: true } -> the same list 10 minutes late. A bad token is refused, so it never gets the public list by mistake. */
export async function signalFeed(body, env, { now = Date.now(), cache = typeof caches !== 'undefined' ? caches.default : null } = {}) {
  const holder = !!(body?.token && env.HOLDER_SECRET && await readToken(env, body.token, now));
  if (holder) {
    const since = body.history ? now - HISTORY_MS : Math.max(Number(body.since) || 0, now - MAX_AGE_MS);
    return { status: 200, body: { live: true, items: (await read(env, since, now, body.history ? HISTORY_ROWS : MAX_ROWS)).map((r) => view(r, true)) } };
  }
  if (body?.token || body?.public !== true) return { status: 401, body: { error: 'For $RADAR and $LARPCHECK holders' } };
  // One database read a minute, however many people have the page open.
  const minute = now - (now % 60_000);
  const key = new Request(`https://cache.narrative-radar/signals1/${minute}`);
  const hit = cache && await cache.match(key);
  if (hit) return { status: 200, body: await hit.json() };
  const out = { live: false, delay: SIGNAL_DELAY_MS, items: (await read(env, now - HISTORY_MS, minute - SIGNAL_DELAY_MS, HISTORY_ROWS, false)).map((r) => view(r, false)) };
  if (cache) await cache.put(key, new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=70' } }));
  return { status: 200, body: out };
}
