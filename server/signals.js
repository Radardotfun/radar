// Big account alerts: the posts the account watcher (bot/signals.js) scored as something people launch coins off. For holders:
// what's here costs real money to find, so the server checks the holder token, since the code is public.
import { readToken } from './holder.js';

const MAX_AGE_MS = 3_600_000;
const MAX_ROWS = 10;

/** { token, since } -> newest first. */
export async function signalFeed(body, env, { now = Date.now() } = {}) {
  const holder = !!(body?.token && env.HOLDER_SECRET && await readToken(env, body.token, now));
  if (!holder) return { status: 401, body: { error: 'For $RADAR and $LARPCHECK holders' } };
  const since = Math.max(Number(body.since) || 0, now - MAX_AGE_MS);
  const { results } = await env.DB.prepare('SELECT id, author, read_at, kind, post, narrative, terms FROM signals WHERE signal = 1 AND read_at > ? ORDER BY read_at DESC LIMIT ?').bind(since, MAX_ROWS).all();
  return {
    status: 200,
    body: { items: (results || []).map((r) => {
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
        url: post.url || '',
      };
    }) },
  };
}
