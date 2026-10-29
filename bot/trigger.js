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
  if (rest.length <= 25 || ASK.test(rest)) return { ok: true };
  return { ok: false, why: 'conversation, not a coin request' };
}
