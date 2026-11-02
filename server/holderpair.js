// Signing in on a computer with a wallet on a phone. The computer picks a long random id and shows it in a QR code. The phone signs the
// usual holder check with that id, the answer waits here, and the computer collects it once. It carries no more than a token a day
// long, for that wallet, and a token only unlocks holder perks: it can't move funds.
export const PAIR_ID = /^[a-f0-9]{32}$/;
const LIFE_MS = 10 * 60_000;

const ready = (db) => db.prepare('CREATE TABLE IF NOT EXISTS holder_pairs (id TEXT PRIMARY KEY, body TEXT, at INTEGER)').run();

/** After a holder check. Keeps only what the computer needs. */
export async function savePair(db, id, r, now = Date.now()) {
  if (!PAIR_ID.test(String(id || ''))) return false;
  await ready(db);
  await db.prepare('DELETE FROM holder_pairs WHERE at < ?').bind(now - LIFE_MS).run();
  const body = { holder: !!r.holder, token: r.token, exp: r.exp, value: r.value, symbol: r.symbol, coins: r.coins, minUsd: r.minUsd };
  await db.prepare('INSERT OR REPLACE INTO holder_pairs (id, body, at) VALUES (?, ?, ?)').bind(id, JSON.stringify(body), now).run();
  return true;
}

/** The answer for this id, once. */
export async function takePair(db, id, now = Date.now()) {
  if (!PAIR_ID.test(String(id || ''))) return { status: 400, body: { error: 'Bad id' } };
  await ready(db);
  const row = await db.prepare('SELECT body, at FROM holder_pairs WHERE id = ?').bind(id).first();
  if (!row || row.at < now - LIFE_MS) return { status: 200, body: { ready: false } };
  await db.prepare('DELETE FROM holder_pairs WHERE id = ?').bind(id).run();
  return { status: 200, body: { ready: true, ...JSON.parse(row.body) } };
}
