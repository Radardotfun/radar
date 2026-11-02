// Which mentions are a request for coins. The bot runs on @radardotfunn, the main account, so its mentions also
// include every reply under its own posts: X puts "@radardotfunn" in front of those by itself, outside the part of
// the text people see (display_text_range). The bot answers only a tag someone typed, with little else or with an
// ask like "coins?" or "scan", and leaves conversation alone.

const ASK = /\b(scan|coins?|ca|cas|contract|ticker|tickers|token|radar|what('|’)?s? (the )?(coin|ticker|ca)|which coin)\b/i;

// m: a post from the mentions timeline with tweet.fields text, display_text_range and entities.
export function wantsCoins(m, username) {
  const text = String(m?.text || '');
  const [from, to] = Array.isArray(m?.display_text_range) ? m.display_text_range : [0, [...text].length];
  const name = String(username || '').toLowerCase();
  // Mention offsets are in characters (code points), like display_text_range.
  const typed = (m?.entities?.mentions || []).some((x) => String(x.username || '').toLowerCase() === name && x.start >= from && x.end <= to);
  if (!typed) return { ok: false, why: 'not typed (a reply under one of our posts)' };
  const shown = [...text].slice(from, to).join('');
  const rest = shown.replace(/@\w{1,15}/g, ' ').replace(/https?:\/\/\S+/g, ' ').replace(/\s+/g, ' ').trim();
  // A real ask is short. A long post that says "radar", "scan" or "token" is talking about Radar, not asking it anything.
  if (rest.length <= 25 || (rest.length <= 100 && ASK.test(rest))) return { ok: true };
  return { ok: false, why: 'conversation, not a coin request' };
}

// A busy DexScreener, AI, post reader or X is worth another try next minute; anything else is not.
export const worthRetry = (message) => /rate.?limit|at its limit|ai limit|duplicate|\b429\b|\b50\d\b|timed out|timeout|could not read|too many|busy|overload|engine failed|fetch failed|network/i.test(String(message || ''));

const newerId = (a, b) => { try { return BigInt(a || 0) >= BigInt(b || 0) ? a : b; } catch { return a || b; } };

// Runs a minute apart can overlap when a post is slow to read, and whichever saves last would undo the other. So a run merges
// with what's saved now: a rewound "since" would answer a tag twice, and lost retries would never be answered.
export function mergeState(s, saved) {
  if (!saved) return s;
  const pending = [...(s.pending || [])];
  for (const p of saved.pending || []) if (!pending.some((q) => q.mention === p.mention)) pending.push(p);
  const seen = new Set();
  const log = [...(s.log || []), ...(saved.log || [])].filter((e) => { const k = `${e.mention}|${e.at}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 60);
  return {
    ...s,
    since: newerId(s.since, saved.since),
    sent: s.day === saved.day ? Math.max(s.sent || 0, saved.sent || 0) : s.sent,
    pending,
    mine: [...new Set([...(s.mine || []), ...(saved.mine || [])])].slice(0, 200),
    judged: { ...(saved.judged || {}), ...(s.judged || {}) },
    log,
  };
}
