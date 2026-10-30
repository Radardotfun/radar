// Radar's own record of which X accounts posted which coins: built from the public posts people scan, and from nothing
// about who scanned them. Holders see it in the panel (server/holder.js). It costs nothing and grows with every scan.
// A client could send any author and text, so a post only counts once its real text, read back from FxTwitter, shows
// that author writing that contract address. Otherwise anyone could pin a scam coin on someone else's name.

const CA = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b|\b0x[a-fA-F0-9]{40}\b/g;
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const RECHECK = 6 * 3600_000;
const RECHECKS_PER_LOOKUP = 5;

// A real Solana address decodes to exactly 32 bytes; long words and hashes usually don't.
export function isAddress(text) {
  if (/^0x[a-fA-F0-9]{40}$/.test(text)) return true;
  let n = 0n;
  for (const ch of text) { const d = B58.indexOf(ch); if (d < 0) return false; n = n * 58n + BigInt(d); }
  const bytes = n === 0n ? 0 : Math.ceil(n.toString(16).length / 2);
  const zeros = text.match(/^1*/)[0].length;
  return bytes + zeros === 32;
}

// X links a typed $TICKER to a token it picks ("solana:…", "ethereum:0x…" in the text): the poster never wrote that address.
const LINKED = /\b(?:solana|ethereum|base|bsc|arbitrum|polygon|optimism|avalanche|robinhood):(?:0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})\b/gi;
export const writtenBy = (text) => String(text || '').replace(LINKED, ' ');

export const addressesIn = (text) => [...new Set(String(text || '').match(CA) || [])].filter(isAddress).slice(0, 3);

// 'gone' only on a real 404: a busy FxTwitter says nothing about the post.
async function readStatus(id) {
  const r = await fetch(`https://api.fxtwitter.com/status/${id}`, { headers: { 'user-agent': 'NarrativeRadar/1.0' }, signal: AbortSignal.timeout(8000) });
  if (r.status === 404) return 'gone';
  if (!r.ok) return null;
  return (await r.json().catch(() => null))?.tweet || null;
}

const seen = new Set();
/** post: as the client sent it. Runs after the answer has gone back, so a scan never waits on it. */
export async function recordPost(env, post) {
  if (!env.DB) return;
  const id = String(post?.url || '').match(/\/status\/(\d{5,25})/)?.[1];
  const claimed = addressesIn(post?.text);
  if (!id || !claimed.length || seen.has(id)) return;
  seen.add(id);
  if (seen.size > 5000) seen.delete(seen.values().next().value);
  const known = await env.DB.prepare('SELECT 1 FROM posts WHERE id = ? LIMIT 1').bind(id).first();
  if (known) return;
  const real = await readStatus(id);
  const author = String(real?.author?.screen_name || '').toLowerCase();
  if (!real || real === 'gone' || !author) return;
  const now = Date.now();
  const at = Number(real.created_timestamp) * 1000 || now;
  const cas = addressesIn(writtenBy(real.text)).filter((ca) => claimed.includes(ca));
  for (const ca of cas) {
    await env.DB.prepare('INSERT OR IGNORE INTO posts (id, author, ca, at, gone, checked) VALUES (?, ?, ?, ?, 0, ?)').bind(id, author, ca, at, now).run();
  }
}

/** -> { coins: { live, deleted, deletedPosts }, recent: [{ ca, id, at, gone }] } for an account, newest first. */
export async function ledgerWho(env, handle, now = Date.now()) {
  const author = String(handle).toLowerCase();
  const { results } = await env.DB.prepare('SELECT id, ca, at, gone, checked FROM posts WHERE author = ? ORDER BY at DESC LIMIT 200').bind(author).all();
  const rows = results || [];
  // Whether its posts are still up: the newest few that haven't been looked at lately, on each lookup.
  const stale = [...new Set(rows.filter((r) => now - r.checked > RECHECK).map((r) => r.id))].slice(0, RECHECKS_PER_LOOKUP);
  await Promise.all(stale.map(async (id) => {
    const state = await readStatus(id).catch(() => null);
    if (!state) return;
    const gone = state === 'gone' ? 1 : 0;
    await env.DB.prepare('UPDATE posts SET gone = ?, checked = ? WHERE id = ?').bind(gone, now, id).run();
    for (const r of rows) if (r.id === id) r.gone = gone;
  }));
  const byCoin = new Map();
  for (const r of rows) {
    const c = byCoin.get(r.ca);
    if (!c) byCoin.set(r.ca, { ca: r.ca, id: r.id, at: r.at, gone: !!r.gone, up: !r.gone });
    else c.up ||= !r.gone;
  }
  const coins = [...byCoin.values()];
  const deleted = coins.filter((c) => !c.up).length;
  return {
    coins: { live: coins.length - deleted, deleted, deletedPosts: new Set(rows.filter((r) => r.gone).map((r) => r.id)).size },
    recent: coins.slice(0, 6).map(({ ca, id, at, gone }) => ({ ca, id, at, gone })),
  };
}
