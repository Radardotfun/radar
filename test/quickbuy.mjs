// The Quick Buy guard (web/quickbuy-guard.js) with the page's own Solana library (web/solana-web3.min.js).
// node test/quickbuy.mjs          offline: synthetic transactions, spend limits, messages, coin lookup
// node test/quickbuy.mjs --live   also asks PumpPortal to BUILD real buys for a throwaway, unfunded keypair and checks
//                                 they pass (nothing is signed or sent)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

const ctx = { console, crypto: crypto.webcrypto, TextEncoder, TextDecoder, Buffer, setTimeout, clearTimeout, URL, URLSearchParams };
ctx.globalThis = ctx;
ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL('../web/solana-web3.min.js', import.meta.url), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(new URL('../web/quickbuy-guard.js', import.meta.url), 'utf8'), ctx);
const web3 = ctx.solanaWeb3;
const G = ctx.RadarQuickBuyGuard;

const payer = web3.Keypair.generate().publicKey;
const other = web3.Keypair.generate().publicKey;
const blockhash = '11111111111111111111111111111111';
const tx = (ixs, feePayer = payer) => new web3.VersionedTransaction(new web3.TransactionMessage({ payerKey: feePayer, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
const price = web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 });
const send = web3.SystemProgram.transfer({ fromPubkey: payer, toPubkey: other, lamports: 1000 });

// Allowed: compute budget + system.
assert.equal(G.txBlock(tx([price, send]), payer.toBase58()), null);
// A program nobody vetted.
const rogue = new web3.TransactionInstruction({ programId: web3.Keypair.generate().publicKey, keys: [{ pubkey: payer, isSigner: true, isWritable: true }], data: Buffer.from([1]) });
assert.match(G.txBlock(tx([price, rogue]), payer.toBase58()), /does not recognise/);
// Paid by someone else.
const theirs = web3.SystemProgram.transfer({ fromPubkey: other, toPubkey: payer, lamports: 1 });
assert.match(G.txBlock(tx([theirs], other), payer.toBase58()), /not paid by your wallet/);
// Needs a second signature.
const two = web3.SystemProgram.transfer({ fromPubkey: other, toPubkey: payer, lamports: 1 });
assert.match(G.txBlock(tx([price, two]), payer.toBase58()), /more than your signature/);
// Empty.
assert.match(G.txBlock(tx([]), payer.toBase58()), /empty/);
assert.match(G.txBlock(null, payer.toBase58()), /not paid by your wallet/);

// Spend limit: amount + 2% + 0.02 SOL.
const L = 1e9;
assert.equal(G.spendBlock(5 * L, 5 * L - 0.105 * L, 0.1), null, 'a 0.1 SOL buy with fees and rent is fine');
assert.match(G.spendBlock(5 * L, 5 * L - 0.5 * L, 0.1), /would take 0\.5000 SOL/);
assert.match(G.spendBlock(NaN, 1, 0.1), /could not check/);
// Simulation messages.
assert.match(G.simulationWhy({ InstructionError: [2, { Custom: 1 }] }, ['Program log: Error: insufficient lamports 100, need 200']), /Not enough SOL/);
assert.match(G.simulationWhy({ InstructionError: [3, { Custom: 6002 }] }, ['Program log: AnchorError: TooMuchSolRequired']), /slippage/);
assert.match(G.simulationWhy('AccountNotFound', []), /Not enough SOL/, 'an empty wallet');
assert.match(G.simulationWhy({ InstructionError: [1, 'Whatever'] }, []), /would fail on-chain/);

// The coin from its contract: the deepest Solana pair for exactly that mint, cleaned.
const MINT = 'ARiZfq6dK19uNqxWyRudhbM2MswLyYhVUHdndGkffdGc';
const coin = G.coinFromPairs([
  { chainId: 'solana', baseToken: { address: MINT, name: 'Gemini', symbol: 'GEMINI' }, liquidity: { usd: 100 }, marketCap: 1, pairAddress: 'small' },
  { chainId: 'solana', baseToken: { address: MINT, name: 'Gemini<script>', symbol: 'GEMINI' }, liquidity: { usd: 9000 }, marketCap: 160000, pairAddress: 'deep' },
  { chainId: 'solana', baseToken: { address: 'other', name: 'Fake', symbol: 'FAKE' }, liquidity: { usd: 1e9 } },
  { chainId: 'base', baseToken: { address: MINT, name: 'Wrong chain', symbol: 'X' }, liquidity: { usd: 1e9 } },
], MINT);
assert.deepEqual({ ...coin }, { name: 'Geminiscript', symbol: 'GEMINI', marketCap: 160000, pair: 'deep' });
assert.equal(G.coinFromPairs([], MINT), null);
assert.equal(G.coinFromPairs(null, MINT), null);
// A ticker that carries its own "$" isn't shown as "$$WIF".
assert.equal(G.coinFromPairs([{ chainId: 'solana', baseToken: { address: MINT, name: 'dogwifhat', symbol: '$WIF' }, liquidity: { usd: 1 } }], MINT).symbol, 'WIF');

// Markets PumpPortal builds on.
const on = (dexId, usd = 1) => ({ chainId: 'solana', dexId, baseToken: { address: MINT, name: 'x', symbol: 'X' }, liquidity: { usd } });
assert.equal(G.quickBuyable([on('raydium')], MINT), true);
assert.equal(G.quickBuyable([on('orca', 9), on('pumpswap')], MINT), true, 'one covered market is enough');
assert.equal(G.quickBuyable([on('orca')], MINT), false);
assert.equal(G.quickBuyable([on('meteoradbc')], MINT), false);
assert.equal(G.quickBuyable([], MINT), null);
assert.match(G.marketWhy([on('orca')], MINT), /trades on Orca.*pump\.fun, PumpSwap and Raydium.*Nothing was signed/);
console.log('PASS quick buy guard: programs, payer, signers, spend limit, messages, coin lookup, markets');

if (process.argv.includes('--live')) {
  const wallet = web3.Keypair.generate().publicKey.toBase58();
  const coins = { 'pump.fun curve ($CARBON)': 'FkkdjuiwUoKNdF8EGPJX2ZpFudjkXQduefMQX1Ynpump', 'Raydium CPMM ($GEMINI)': MINT };
  for (const [label, mint] of Object.entries(coins)) {
    const r = await fetch('https://pumpportal.fun/api/trade-local', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicKey: wallet, action: 'buy', mint, amount: 0.01, denominatedInSol: 'true', slippage: 10, priorityFee: 0.0001, pool: 'auto' }),
    });
    assert.ok(r.ok, `${label}: PumpPortal ${r.status}`);
    const built = web3.VersionedTransaction.deserialize(new Uint8Array(await r.arrayBuffer()));
    assert.equal(G.txBlock(built, wallet), null, `${label} should pass`);
    console.log(`PASS live: ${label} unsigned PumpPortal buy passes the guard`);
  }
  // Orca isn't covered: if PumpPortal starts building these, QUICK_MARKETS (guard and radar.js) can grow.
  const wif = 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm';
  const r = await fetch('https://pumpportal.fun/api/trade-local', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publicKey: wallet, action: 'buy', mint: wif, amount: 0.01, denominatedInSol: 'true', slippage: 10, priorityFee: 0.0001, pool: 'auto' }),
  });
  const pairs = await (await fetch(`https://api.dexscreener.com/tokens/v1/solana/${wif}`)).json();
  assert.equal(r.status, 400, 'PumpPortal now builds Orca buys: widen QUICK_MARKETS');
  assert.equal(G.quickBuyable(pairs, wif), false, '$WIF should read as not covered');
  console.log('PASS live: Orca ($WIF) is refused by PumpPortal and read as not covered');
}
