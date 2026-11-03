// Breaking now: words many new coins are launching under, a sign a story is spawning coins. It reads the launches the bot already
// saves each minute (wire_rows, bot/chat.js), so it costs one database read a minute. Names only: it says what launched, never why.
// Holders see it live. Everyone else sees the same list as it stood 10 minutes ago, which the server decides, since the code is public.
import { findStories, KEEP_MS } from '../bot/wire.js';
import { readToken } from './holder.js';

export const FEED_DELAY_MS = 10 * 60_000;

async function readStories(env, asOf) {
  const { results } = await env.DB.prepare('SELECT coins FROM wire_rows WHERE at >= ? AND at <= ?').bind(asOf - KEEP_MS, asOf).all();
  return findStories((results || []).flatMap((row) => JSON.parse(row.coins)), asOf);
}

/** { token? } -> { live, asOf, stories }. A bad or missing token gets the delayed list, not an error. */
export async function feed(body, env, { cache = caches.default, now = Date.now() } = {}) {
  const live = !!(body?.token && env.HOLDER_SECRET && await readToken(env, body.token, now));
  const minute = now - (now % 60_000);
  const asOf = live ? minute : minute - FEED_DELAY_MS;
  const key = new Request(`https://cache.narrative-radar/feed1/${asOf}`);
  const hit = await cache.match(key);
  if (hit) return { live, asOf, stories: await hit.json() };
  const stories = await readStories(env, asOf);
  await cache.put(key, new Response(JSON.stringify(stories), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=120' } }));
  return { live, asOf, stories };
}
