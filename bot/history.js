// An X account's past usernames, for the bot's larp check: memory.lol (free, public) keeps the screen names it has seen
// for each account, with the first and last day it saw each. One request, about 1 s on 7 Nov; it runs while the larp check
// does, and gives up after HISTORY_MS, so it never makes the reply slower. It only knows accounts in its archives: a new
// account comes back empty, and then the reply says nothing about it.

export const HISTORY_MS = 2500;
const API = 'https://api.memory.lol/v1/tw/';

/** handle -> { handle, names: [oldest first], changes } or null when unknown, unreadable or slower than HISTORY_MS. */
export async function nameHistory(handle, fetcher = fetch, ms = HISTORY_MS) {
  const h = String(handle || '').trim().replace(/^@/, '');
  if (!/^\w{1,15}$/.test(h)) return null;
  const r = await fetcher(`${API}${h}`, { signal: AbortSignal.timeout(ms) }).catch(() => null);
  if (!r?.ok) return null;
  const d = await r.json().catch(() => null);
  const acc = Array.isArray(d?.accounts) ? d.accounts[0] : null;
  const seen = acc?.screen_names && typeof acc.screen_names === 'object' ? acc.screen_names : null;
  if (!seen) return null;
  const names = Object.entries(seen).filter(([n]) => /^\w{1,15}$/.test(n))
    .sort((a, b) => String(a[1]?.[0] || '').localeCompare(String(b[1]?.[0] || ''))).map(([n]) => n);
  if (!names.length) return null;
  return { handle: h, names, changes: names.length - 1 };
}

/** The coin's own X account, from its DexScreener socials or links, or null. */
export function coinHandle(t) {
  const urls = [...(t?.socials || []).filter((s) => s?.type === 'twitter').map((s) => s.url), ...(t?.links || [])];
  for (const u of urls) {
    const m = String(u || '').match(/^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/(\w{1,15})(?:[/?#]|$)/i);
    if (m && !/^(i|home|search|intent|share|hashtag)$/i.test(m[1])) return m[1];
  }
  return null;
}

/**
 * One line per account that has changed its username, for the reply: "the poster" or "the coin's X account".
 * Names are written without @, so nobody is tagged. Three or more names is a warning; two is a note.
 */
export function historyLines(found) {
  const out = [];
  const done = new Set();
  for (const { who, hist } of found || []) {
    if (!hist?.changes || done.has(hist.handle.toLowerCase())) continue;
    done.add(hist.handle.toLowerCase());
    const list = hist.names.length > 4 ? [...hist.names.slice(0, 2), '…', ...hist.names.slice(-2)] : hist.names;
    out.push(`${hist.changes >= 2 ? '⚠️' : 'ℹ️'} ${who} has gone by ${hist.names.length} usernames: ${list.join(' → ')}`);
  }
  return out;
}
