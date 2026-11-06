// Wallets that have ever held a $RADAR token (the relaunch or the original). After the relaunch on 6 Nov 2026, anyone
// who held either one keeps holder perks, whatever they hold now.
// Kept in D1 (ever_held), filled three ways: a one-off backfill of each mint's history (scripts/everheld-backfill.mjs),
// a cron that reads each mint's new transactions (syncEverHeld), and the holder check itself (a wallet that has a token
// account for either mint right now has held it).
// RADAR_MINT is the current coin; RADAR_OLD_MINTS (comma separated) the ones before it. An old coin only counts for
// holdings from before RADAR_OLD_CUTOFF (the relaunch): it is dead and cheap now, so buying a cent of it today must
// not unlock anything. The current coin counts for any holding, at any time.

const SOL_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const clean = (list) => [...new Set(list.map((s) => String(s || '').trim()).filter((s) => SOL_ADDRESS.test(s)))];
export const oldMints = (env) => clean(String(env.RADAR_OLD_MINTS || '').split(',')).filter((m) => m !== env.RADAR_MINT);
export const radarMints = (env) => clean([env.RADAR_MINT, ...oldMints(env)]);
export const oldCutoff = (env) => { const t = Date.parse(env.RADAR_OLD_CUTOFF || ''); return Number.isFinite(t) ? t : 0; };

let ready = null;
export function ensureTables(db) {
  ready ??= db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS ever_held (wallet TEXT NOT NULL, mint TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (wallet, mint))'),
    db.prepare('CREATE TABLE IF NOT EXISTS ever_cursor (mint TEXT PRIMARY KEY, sig TEXT NOT NULL, at INTEGER NOT NULL)'),
  ]).catch((e) => { ready = null; throw e; });
  return ready;
}

/** The first $RADAR mint this wallet is on record as having held, counting old coins only before the relaunch:
 *  { mint, at } or null. */
export async function everHeld(env, wallet) {
  if (!env.DB || !SOL_ADDRESS.test(wallet || '') || !SOL_ADDRESS.test(env.RADAR_MINT || '')) return null;
  await ensureTables(env.DB);
  const old = oldMints(env), cutoff = oldCutoff(env);
  const oldPart = old.length && cutoff ? ` OR (mint IN (${old.map(() => '?').join(',')}) AND at < ?)` : '';
  return env.DB.prepare(`SELECT mint, at FROM ever_held WHERE wallet = ? AND (mint = ?${oldPart}) ORDER BY at LIMIT 1`)
    .bind(wallet, env.RADAR_MINT, ...(oldPart ? [...old, cutoff] : [])).first();
}

export async function markHeld(env, rows) {
  const list = rows.filter(([w, m]) => SOL_ADDRESS.test(w) && SOL_ADDRESS.test(m));
  if (!env.DB || !list.length) return 0;
  await ensureTables(env.DB);
  // one statement per call keeps it inside a Worker's query budget
  for (let i = 0; i < list.length; i += 30) {
    const part = list.slice(i, i + 30);
    await env.DB.prepare(`INSERT OR IGNORE INTO ever_held (wallet, mint, at) VALUES ${part.map(() => '(?, ?, ?)').join(', ')}`).bind(...part.flat()).run();
  }
  return list.length;
}

/** [owner, mint] pairs of everyone a transaction shows holding one of `mints` (balance above 0 before or after it). */
export function ownersIn(tx, mints) {
  const want = new Set(mints), out = new Map();
  for (const b of [...(tx?.meta?.preTokenBalances || []), ...(tx?.meta?.postTokenBalances || [])]) {
    if (!want.has(b?.mint) || !SOL_ADDRESS.test(b?.owner || '')) continue;
    if (BigInt(b?.uiTokenAmount?.amount || '0') > 0n) out.set(`${b.owner} ${b.mint}`, [b.owner, b.mint]);
  }
  return [...out.values()];
}

async function rpc(rpcUrl, method, params) {
  const r = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(10_000), body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const d = await r.json().catch(() => null);
  if (!r.ok || !d || d.error) throw new Error(`rpc ${method}`);
  return d.result;
}

/** Reads the current coin's transactions since the last run, oldest first, and records who held it (old coins are
 *  settled by the backfill: nothing after the relaunch counts for them). A Worker run has a small budget of outside
 *  calls, so it takes at most `perMint` transactions and picks up from there next time. */
export async function syncEverHeld(env, rpcUrl, { perMint = 30, now = Date.now() } = {}) {
  if (!env.DB || !rpcUrl || !SOL_ADDRESS.test(env.RADAR_MINT || '')) return {};
  await ensureTables(env.DB);
  const report = {};
  for (const mint of [env.RADAR_MINT]) {
    const cur = await env.DB.prepare('SELECT sig FROM ever_cursor WHERE mint = ?').bind(mint).first();
    // Newest first from the chain, 1000 a page: page back to the cursor (at most 3 pages a run) so a backlog is never skipped.
    const fresh = []; let before;
    for (let page = 0; page < 3; page++) {
      const got = await rpc(rpcUrl, 'getSignaturesForAddress', [mint, { limit: 1000, ...(cur?.sig ? { until: cur.sig } : {}), ...(before ? { before } : {}) }]) || [];
      fresh.push(...got);
      if (got.length < 1000) break;
      before = got[got.length - 1].signature;
    }
    // Oldest first. Failed transactions (bots, mostly) cost nothing to skip; only real reads count against the budget.
    const todo = fresh.reverse();
    const rows = []; let last = null, reads = 0, seen = 0;
    for (const s of todo) {
      if (!s.err) {
        if (reads >= perMint) break;
        reads++;
        const tx = await rpc(rpcUrl, 'getTransaction', [s.signature, { maxSupportedTransactionVersion: 1, encoding: 'json', commitment: 'confirmed' }]).catch(() => undefined);
        if (tx === undefined) break; // try this one again next run
        const at = ((tx?.blockTime || s.blockTime) * 1000) || now;
        for (const [w, m] of ownersIn(tx, [mint])) rows.push([w, m, at]);
      }
      last = s; seen++;
    }
    await markHeld(env, rows);
    if (last) await env.DB.prepare('INSERT OR REPLACE INTO ever_cursor (mint, sig, at) VALUES (?, ?, ?)').bind(mint, last.signature, (last.blockTime || 0) * 1000).run();
    report[mint] = { read: seen, wallets: rows.length, left: todo.length - seen };
  }
  return report;
}
