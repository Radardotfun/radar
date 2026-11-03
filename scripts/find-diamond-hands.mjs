// Diamond Hand's wallets, found on the chain: for recent Solana runners (GeckoTerminal's trending pools, $1M+ market cap,
// launched in the last 60 days), the top 20 holders that bought in the coin's first hour, after its first 10 seconds (so
// not the dev, a launch bundle or a sniper), paid SOL for it (a transfer from someone else doesn't count) and still hold it.
// node scripts/find-diamond-hands.mjs > bot/diamond-wallets.json   (ONLY=FLOAT,OTC to look at some runners only)
import { PublicKey } from '@solana/web3.js';
const RPC = 'https://narrative-radar.millenia-portfolio.workers.dev/rpc';
const MPL = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
// A coin's launch: its metadata account is made in the launch transaction and is rarely touched again.
async function launchedAt(mint) {
  const [meta] = PublicKey.findProgramAddressSync([Buffer.from('metadata'), MPL.toBuffer(), new PublicKey(mint).toBuffer()], MPL);
  const sigs = await rpc('getSignaturesForAddress', [meta.toBase58(), { limit: 1000 }]);
  return sigs.length && sigs.length < 1000 ? sigs[sigs.length - 1].blockTime * 1000 : NaN;
}
const RELAY = 'https://narrative-radar.millenia-portfolio.workers.dev/rpc';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIN_CAP = 1_000_000;
const MAX_AGE_MS = Number(process.env.MAX_AGE_DAYS || 120) * 86_400_000;
const FIRST_HOUR_S = 3600;
const NOT_BEFORE_S = 10;
const SYSTEM = '11111111111111111111111111111111';

async function rpc(method, params, url = RELAY, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://tryradar.fun' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).catch(() => null);
    const j = r && await r.json().catch(() => null);
    if (j && !j.error) return j.result;
    await sleep(800 * (i + 1));
  }
  throw new Error(`${method} failed`);
}

const runners = [];
for (const [duration, page] of ['24h', '6h', '1h'].flatMap((d) => [1, 2, 3, 4, 5].map((n) => [d, n]))) {
  const g = await (await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/trending_pools?duration=${duration}&page=${page}`, { headers: { accept: 'application/json' } })).json();
  for (const p of g.data || []) {
    const a = p.attributes;
    const mint = p.relationships?.base_token?.data?.id?.replace(/^solana_/, '');
    const cap = Number(a.market_cap_usd || a.fdv_usd || 0);
    if (mint && cap >= MIN_CAP && !runners.some((r) => r.mint === mint)) runners.push({ mint, name: a.name.split(' / ')[0], cap });
  }
  await sleep(1200);
}

const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const out = [];
for (const run of runners.filter((r) => !only || only.has(r.name))) {
  const pairs = await (await fetch(`https://api.dexscreener.com/tokens/v1/solana/${run.mint}`)).json().catch(() => []);
  const symbol = pairs?.[0]?.baseToken?.symbol || run.name;
  const top = (await rpc('getTokenLargestAccounts', [run.mint], RPC).catch(() => null))?.value || [];
  const accounts = top.map((t) => t.address);
  if (!accounts.length) continue;
  const parsed = (await rpc('getMultipleAccounts', [accounts, { encoding: 'jsonParsed' }])).value;
  const owners = parsed.map((a) => a?.data?.parsed?.info?.owner || null);
  // A wallet is owned by the System program; pools, locks and exchanges' vaults are owned by programs.
  const ownerInfo = (await rpc('getMultipleAccounts', [owners.filter(Boolean), { encoding: 'base64', dataSlice: { offset: 0, length: 0 } }])).value;
  const isWallet = new Map(owners.filter(Boolean).map((o, i) => [o, ownerInfo[i]?.owner === SYSTEM]));
  // Each holder's first transaction with the coin. A coin can't launch after its earliest holder got it, and the metadata
  // account's first signature is its launch unless that account was written again later: the launch is the earliest of these.
  const firsts = [];
  for (let i = 0; i < accounts.length; i++) {
    const sigs = await rpc('getSignaturesForAddress', [accounts[i], { limit: 1000 }]).catch(() => []);
    firsts.push(sigs.length && sigs.length < 1000 ? sigs[sigs.length - 1] : null);
  }
  const launched = Math.min(await launchedAt(run.mint).catch(() => Infinity), ...firsts.filter(Boolean).map((f) => f.blockTime * 1000));
  console.error(`${symbol}: launched ${Number.isFinite(launched) ? new Date(launched).toISOString() : '?'}`);
  if (!Number.isFinite(launched) || Date.now() - launched > MAX_AGE_MS) continue;
  for (let i = 0; i < accounts.length; i++) {
    const owner = owners[i];
    if (!owner || !isWallet.get(owner)) continue;
    const first = firsts[i];
    if (!first) continue; // no history, or so much that it's a bot's
    const after = first.blockTime - launched / 1000;
    if (after < NOT_BEFORE_S || after > FIRST_HOUR_S) continue;
    const tx = await rpc('getTransaction', [first.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 1 }]).catch(() => null);
    const keys = tx?.transaction?.message?.accountKeys?.map((k) => k.pubkey || k) || [];
    const at = keys.indexOf(owner);
    const spent = at >= 0 ? (tx.meta.preBalances[at] - tx.meta.postBalances[at]) / 1e9 : 0;
    if (spent < 0.05) continue;
    if (!out.some((w) => w.wallet === owner)) out.push({ wallet: owner, symbol, mint: run.mint, boughtAfterS: Math.round(after), solIn: Math.round(spent * 100) / 100, capNow: Math.round(run.cap) });
  }
  console.error(`${symbol}: ${out.length} wallets so far`);
}
console.log(JSON.stringify({ found: new Date().toISOString(), rule: 'top-20 holder of a $1M+ Solana runner launched in the last 120 days, bought with SOL in its first hour after its first 10 seconds, still holding', wallets: out }, null, 1));
