// One-off backfill for holder perks after the relaunch: every wallet that has ever held a $RADAR token, read from each
// mint's whole transaction history (a wallet counts when a transaction shows it with a balance above 0 before or after).
// Writes SQL for D1: the ever_held rows and each mint's cursor (its newest transaction), which the Worker's cron picks up from.
// node scripts/everheld-backfill.mjs <out.sql> <mint> [<mint> ...]      RPC=<url> to use another endpoint.
// Then: npx wrangler d1 execute radar-ledger --remote --file <out.sql>
import fs from 'node:fs';
import { ownersIn } from '../server/everheld.js';

const [OUT, ...MINTS] = process.argv.slice(2);
const RPC = process.env.RPC || 'https://api.mainnet-beta.solana.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(method, params) {
  for (let i = 0; i < 8; i++) {
    const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).catch(() => null);
    const j = r ? await r.json().catch(() => null) : null;
    if (j && 'result' in j && !j.error) return j.result;
    await sleep(1200 * (i + 1));
  }
  throw new Error(`${method} failed`);
}
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const sql = ['CREATE TABLE IF NOT EXISTS ever_held (wallet TEXT NOT NULL, mint TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (wallet, mint));',
  'CREATE TABLE IF NOT EXISTS ever_cursor (mint TEXT PRIMARY KEY, sig TEXT NOT NULL, at INTEGER NOT NULL);'];
for (const mint of MINTS) {
  const sigs = []; let before;
  for (;;) {
    const page = await call('getSignaturesForAddress', [mint, { limit: 1000, ...(before ? { before } : {}) }]);
    sigs.push(...page);
    if (page.length < 1000) break;
    before = page[page.length - 1].signature; await sleep(300);
  }
  const ok = sigs.filter((s) => !s.err);
  console.log(mint.slice(0, 6), 'transactions', sigs.length, 'successful', ok.length);
  const first = new Map(); // wallet -> earliest time seen holding
  let done = 0;
  const worker = async (list) => {
    for (const s of list) {
      const tx = await call('getTransaction', [s.signature, { maxSupportedTransactionVersion: 1, encoding: 'json', commitment: 'confirmed' }]).catch(() => null);
      done++;
      if (!tx) { console.log('  missing', s.signature); continue; }
      const at = (tx.blockTime || s.blockTime || 0) * 1000;
      for (const [owner] of ownersIn(tx, [mint])) if (!first.has(owner) || at < first.get(owner)) first.set(owner, at);
      if (done % 250 === 0) console.log(`  ${done}/${ok.length}, ${first.size} wallets`);
      await sleep(120);
    }
  };
  const lanes = 3, parts = Array.from({ length: lanes }, (_, i) => ok.filter((_, k) => k % lanes === i));
  await Promise.all(parts.map(worker));
  console.log(mint.slice(0, 6), 'wallets that held it:', first.size);
  for (const [w, at] of first) sql.push(`INSERT OR IGNORE INTO ever_held (wallet, mint, at) VALUES (${q(w)}, ${q(mint)}, ${at});`);
  if (sigs[0]) sql.push(`INSERT OR REPLACE INTO ever_cursor (mint, sig, at) VALUES (${q(mint)}, ${q(sigs[0].signature)}, ${(sigs[0].blockTime || 0) * 1000});`);
}
fs.writeFileSync(OUT, sql.join('\n') + '\n');
console.log('wrote', OUT, sql.length, 'statements');
