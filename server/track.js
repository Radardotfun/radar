// Track record, read side (the bot writes it: bot/track.js). Every coin Radar flagged in the last few days with its cap when
// flagged, now and at its peak, losers included. Holders see it live; everyone else sees flags from 30 minutes ago and older,
// decided here since the code is public. A summary says how many flags there were and how many did 2x and 10x at their peak.
import { readToken } from './holder.js';

export const TRACK_DELAY_MS = 30 * 60_000;
export const TRACK_WINDOW_MS = 3 * 86_400_000;
const SOURCES = new Set(['breaking', 'diamond']);
// The list carries the newest flags and the best ones, so every sort is right; the summary always counts every flag in range.
export const ROWS_NEWEST = 600;
export const ROWS_BEST = 100;

/** { token?, hours? } -> { live, asOf, summary: { flags, x2, x10, best }, rows: [...] } */
export async function trackRecord(body, env, { now = Date.now() } = {}) {
  const live = !!(body?.token && env.HOLDER_SECRET && await readToken(env, body.token, now));
  const until = live ? now : now - TRACK_DELAY_MS;
  const hours = Math.min(72, Math.max(1, Number(body?.hours) || 24));
  const since = now - hours * 3_600_000;
  const table = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'track'").first();
  if (!table) return { live, asOf: until, summary: { flags: 0, x2: 0, x10: 0, best: null }, rows: [] };
  // Diamond Hand is a holder perk: its coins are on the record for holders only, like its alerts (server/signals.js).
  const where = `at >= ? AND at <= ? AND mc0 > 0 AND source IN ('breaking'${live ? ", 'diamond'" : ''})`;
  const multiple = 'ROUND(MAX(COALESCE(peak, 0), mc0) * 1.0 / mc0, 1)';
  const cols = 'mint, source, at, symbol, name, story, mc0, mc, peak, peak_at, checked';
  const [count, newest, top] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS flags, SUM(CASE WHEN ${multiple} >= 2 THEN 1 ELSE 0 END) AS x2, SUM(CASE WHEN ${multiple} >= 10 THEN 1 ELSE 0 END) AS x10 FROM track WHERE ${where}`).bind(since, until).first(),
    env.DB.prepare(`SELECT ${cols} FROM track WHERE ${where} ORDER BY at DESC LIMIT ${ROWS_NEWEST}`).bind(since, until).all(),
    env.DB.prepare(`SELECT ${cols} FROM track WHERE ${where} ORDER BY ${multiple} DESC, at DESC LIMIT ${ROWS_BEST}`).bind(since, until).all(),
  ]);
  const seen = new Set();
  const results = [...(newest?.results || []), ...(top?.results || [])].filter((r) => !seen.has(r.mint) && seen.add(r.mint)).sort((a, b) => b.at - a.at);
  const rows = results.filter((r) => SOURCES.has(r.source) && r.mc0 > 0 && (live || r.source !== 'diamond')).map((r) => ({
    mint: r.mint, source: r.source, at: r.at, symbol: r.symbol, name: r.name, story: r.story,
    mc0: Math.round(r.mc0), mc: Math.round(r.mc || r.mc0), peak: Math.round(Math.max(r.peak || 0, r.mc0)), peakAt: r.peak_at || r.at, checked: r.checked || null,
    peakX: Math.round((Math.max(r.peak || 0, r.mc0) / r.mc0) * 10) / 10, nowX: Math.round(((r.mc || r.mc0) / r.mc0) * 10) / 10,
  }));
  const best = rows.reduce((b, r) => (!b || r.peakX > b.peakX ? r : b), null);
  return {
    live, asOf: until, hours,
    summary: { flags: count?.flags || 0, x2: count?.x2 || 0, x10: count?.x10 || 0, shown: rows.length, best: best ? { symbol: best.symbol, peakX: best.peakX, mint: best.mint } : null },
    rows,
  };
}
