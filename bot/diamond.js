// Diamond Hand: wallets that bought a recent runner in its first hour and held through the run (found on the chain by
// scripts/find-diamond-hands.mjs, kept in diamond-wallets.json), watched once a minute, 10 at a time. When one buys a
// coin launched in the last 6 hours, a row goes into the signals table that big account alerts already use, so holders'
// extensions show it as a live alert card (kind 'diamond'). The public, delayed list leaves these rows out.
// What a buy is, and the look at a wallet, are shared with the extension (extension/src/lib/diamond.js).
import list from './diamond-wallets.json' with { type: 'json' };
import { lookAt, agoText } from '../extension/src/lib/diamond.js';

export { boughtMints, NEW_MS } from '../extension/src/lib/diamond.js';
export const WALLETS_PER_RUN = 10;
const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS diamond_wallets (wallet TEXT PRIMARY KEY, symbol TEXT, mint TEXT, last_sig TEXT, checked INTEGER DEFAULT 0)',
];

// A run may make 50 requests; RPC and DexScreener calls stop well short of that, and the rest wait for the next minute.
const CALLS_PER_RUN = 40;

async function seed(db) {
  for (const sql of SCHEMA) await db.prepare(sql).run();
  const seen = (await db.prepare("SELECT v FROM signal_meta WHERE k = 'diamond_list'").first().catch(() => null))?.v;
  if (seen === list.found) return;
  // A new list replaces the old one: a wallet that sold and dropped off is no longer watched under its old wording.
  const keep = list.wallets.map((w) => w.wallet);
  await db.prepare(`DELETE FROM diamond_wallets WHERE wallet NOT IN (${keep.map(() => '?').join(',') || "''"})`).bind(...keep).run();
  for (const w of list.wallets) await db.prepare('INSERT INTO diamond_wallets (wallet, symbol, mint) VALUES (?, ?, ?) ON CONFLICT(wallet) DO UPDATE SET symbol = excluded.symbol, mint = excluded.mint').bind(w.wallet, w.symbol, w.mint).run();
  await db.prepare("INSERT INTO signal_meta (k, v) VALUES ('diamond_list', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(list.found).run();
}

/** One minute's look. rpc(method, params) -> result; launchOf(mint) -> { launched (ms), symbol } or null. */
export async function tick({ db, rpc: rpc0, launchOf: launchOf0, now = Date.now() }) {
  await seed(db);
  const out = { checked: 0, buys: 0, alerts: 0, calls: 0, errors: [] };
  const rpc = (...a) => { out.calls += 1; return rpc0(...a); };
  const launchOf = (...a) => { out.calls += 1; return launchOf0(...a); };
  const all = (await db.prepare('SELECT wallet, symbol, mint, last_sig FROM diamond_wallets ORDER BY checked ASC LIMIT ?').bind(WALLETS_PER_RUN).all()).results || [];
  const rotate = (await db.prepare('SELECT COUNT(*) AS n FROM diamond_wallets').first())?.n > WALLETS_PER_RUN;
  let seq = 0;
  for (const w of all) {
    // A wallet's look takes at most 1 + 4 transactions + their coins; stop before the run's limit.
    if (out.calls > CALLS_PER_RUN - 9) break;
    try {
      const look = await lookAt(w.wallet, w.last_sig, { rpc, launchOf, now });
      out.checked += 1;
      for (const b of look.buys) {
        out.buys += 1;
        const why = `Diamond Hand: a wallet that bought $${w.symbol} in its first hour and still holds it just bought $${b.symbol}, launched ${agoText(now - b.launched)} ago.`;
        const post = { text: `${why}\n${b.mint}`, author: 'diamondhand', authorName: 'Diamond Hand', url: `https://dexscreener.com/solana/${b.mint}`, images: [] };
        const r = await db.prepare('INSERT OR IGNORE INTO signals (id, author, at, kind, post, state, signal, narrative, terms, read_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)')
          .bind(`dh-${b.sig.slice(0, 40)}-${b.mint.slice(0, 8)}`, 'Diamond Hand', b.at, 'diamond', JSON.stringify(post), 'read', `100: ${why}`, JSON.stringify([`$${b.symbol}`]), now + seq++).run();
        if (r?.meta?.changes) out.alerts += 1;
      }
      // Written only when it changed, or when there are more wallets than one run looks at and the turn order matters.
      if (look.last !== w.last_sig || rotate) await db.prepare('UPDATE diamond_wallets SET last_sig = ?, checked = ? WHERE wallet = ?').bind(look.last, now, w.wallet).run();
    } catch (e) {
      out.errors.push(`${w.wallet.slice(0, 6)}: ${String(e.message || e).slice(0, 80)}`);
      if (rotate) await db.prepare('UPDATE diamond_wallets SET checked = ? WHERE wallet = ?').bind(now, w.wallet).run().catch(() => {});
    }
  }
  return out;
}
