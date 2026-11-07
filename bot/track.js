// Track record: every coin Radar flags, with its market cap when flagged, now, and at its highest since. The flags are the
// coins Breaking now puts first in a story (the story's first coin and its biggest at that moment) and each Diamond Hand coin.
// Every one is kept, losers too: the record is only worth something if it isn't picked after the fact.
// The bot records flags as they happen (wire tick, Diamond Hand tick) and refreshes caps a batch a minute from DexScreener
// (the bot runs where DexScreener answers); server/track.js reads the table for the panel and the site.
import { findStories, WINDOW_MS } from './wire.js';

export const KEEP_MS = 7 * 86_400_000;      // rows older than a week go
export const REFRESH_MS = 3 * 86_400_000;   // caps are followed for 3 days after the flag
export const PER_TICK = 60;                 // two DexScreener asks a minute
const SOL_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

let ready = null;
export function ensureTrack(db) {
  ready ??= db.prepare('CREATE TABLE IF NOT EXISTS track (mint TEXT PRIMARY KEY, source TEXT NOT NULL, at INTEGER NOT NULL, symbol TEXT, name TEXT, story TEXT, mc0 REAL NOT NULL, mc REAL, peak REAL, peak_at INTEGER, checked INTEGER NOT NULL DEFAULT 0)').run()
    .catch((e) => { ready = null; throw e; });
  return ready;
}

const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);

/** One flag. The first flag of a coin wins: a coin flagged again later keeps its first time and cap. */
export async function recordFlag(db, { mint, source, at, symbol, name, story = '', mc0 }) {
  if (!SOL_ADDRESS.test(mint || '') || !(mc0 > 0)) return false;
  await ensureTrack(db);
  const r = await db.prepare('INSERT OR IGNORE INTO track (mint, source, at, symbol, name, story, mc0, mc, peak, peak_at, checked) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)')
    .bind(mint, source, at, clean(symbol, 20).replace(/^\$+/, ''), clean(name, 60), clean(story, 60), mc0, mc0, mc0, at).run();
  return !!r?.meta?.changes;
}

// A coin is flagged once it has traded past this. Under it, the coin is a fresh copy at pump.fun's launch cap (about $2.5K on
// 7 Nov): of the 145 flags under $3K on 7 Nov none did 2x, and copies at the launch cap took turns as a story's biggest, one
// a minute (32 DOPA flags in 30 minutes). Every 2x of that day was flagged at $4K or more.
export const MIN_FLAG_CAP = 4_000;

/** Breaking now's stories from the last half hour of launches: each story's first coin and its biggest, flagged once. */
export async function recordStories(db, now = Date.now()) {
  const { results } = await db.prepare('SELECT coins FROM wire_rows WHERE at >= ?').bind(now - WINDOW_MS).all();
  const coins = (results || []).flatMap((row) => JSON.parse(row.coins));
  let added = 0;
  for (const s of findStories(coins, now)) {
    const story = s.words.join(' · ');
    const picks = [s.first, ...(s.big[0] ? [s.big[0]] : [])];
    for (const c of picks) {
      // The cap Radar saw for the coin when it flagged it: its latest in this window.
      const mc0 = coins.filter((x) => x.a === c.a).reduce((m, x) => Math.max(m, x.m || 0), 0) || c.m;
      if (mc0 < MIN_FLAG_CAP) continue;
      if (await recordFlag(db, { mint: c.a, source: 'breaking', at: now, symbol: c.s, name: c.n, story, mc0 })) added++;
    }
  }
  return added;
}

/** Caps from DexScreener pairs: the biggest pair's market cap per coin. */
export function capsFrom(pairs) {
  const out = new Map();
  for (const p of Array.isArray(pairs) ? pairs : []) {
    const m = p?.baseToken?.address, cap = Number(p?.marketCap || p?.fdv || 0);
    if (m && cap > (out.get(m) || 0)) out.set(m, cap);
  }
  return out;
}

/** Follows the coins flagged in the last 3 days: the last 6 hours' flags first (that's when peaks happen), then the longest
 *  unchecked. Current cap, and the peak if it's a new high. A coin DexScreener no longer lists keeps its last numbers. Runs every
 *  other minute, so a week of rows stays well inside the database's daily write budget. Old rows are dropped now and then. */
export const YOUNG_MS = 6 * 3_600_000;
export async function refreshTrack(db, fetcher, now = Date.now()) {
  await ensureTrack(db);
  const { results } = await db.prepare('SELECT mint, peak FROM track WHERE at >= ? ORDER BY (at >= ?) DESC, checked ASC LIMIT ?').bind(now - REFRESH_MS, now - YOUNG_MS, PER_TICK).all();
  const rows = results || [];
  let updated = 0;
  for (let i = 0; i < rows.length; i += 30) {
    const part = rows.slice(i, i + 30);
    const r = await fetcher(`https://api.dexscreener.com/tokens/v1/solana/${part.map((x) => x.mint).join(',')}`, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) continue;
    const caps = capsFrom(await r.json().catch(() => []));
    for (const row of part) {
      const cap = caps.get(row.mint);
      if (cap > 0) {
        const high = cap > (row.peak || 0);
        await db.prepare(`UPDATE track SET mc = ?, checked = ?${high ? ', peak = ?, peak_at = ?' : ''} WHERE mint = ?`).bind(...(high ? [cap, now, cap, now, row.mint] : [cap, now, row.mint])).run();
        updated++;
      } else await db.prepare('UPDATE track SET checked = ? WHERE mint = ?').bind(now, row.mint).run();
    }
  }
  if (now % 3_600_000 < 60_000) await db.prepare('DELETE FROM track WHERE at < ?').bind(now - KEEP_MS).run();
  return updated;
}
