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

// Phantom's Auto-Confirm: with no popup, a link must not be able to start a buy.
{
  const g = G;
  assert.match(g.simulationWhy({ InstructionError: [3, { Custom: 6063 }] }, []), /route this coin through its paired token/, 'when a route through the paired token fails');
  const opener = {};
  const go = (over = {}) => ({ source: opener, origin: 'https://x.com', data: { type: 'radar:insta-go', mint: 'MINT', sol: 0.1 }, ...over });
  assert.equal(g.autoIsOn({ enabled: true, chains: ['solana:101'] }), true);
  assert.equal(g.autoIsOn({ enabled: true, chains: ['eip155:1'] }), false, 'on for another chain is not on for Solana');
  assert.equal(g.autoIsOn({ enabled: false, chains: ['solana:101'] }), false);
  assert.equal(g.autoIsOn(null), false);
  assert.equal(g.mayAutoStart({ auto: false, vouched: false, sol: 25 }), true, "without Auto-Confirm the wallet's popup still asks");
  assert.equal(g.mayAutoStart({ auto: true, vouched: false, sol: 0.1 }), false, 'a bare link waits for a tap');
  assert.equal(g.mayAutoStart({ auto: true, vouched: true, sol: 0.1 }), true, "the panel's own buy goes");
  assert.equal(g.mayAutoStart({ auto: true, vouched: true, sol: 1 }), true);
  assert.equal(g.mayAutoStart({ auto: true, vouched: true, sol: 1.01 }), false, 'over the cap waits');
  assert.equal(g.mayAutoStart({ auto: true, vouched: true, sol: NaN }), false);
  assert.equal(g.vouches(go(), opener, 'MINT', 0.1), true);
  assert.equal(g.vouches(go({ origin: 'https://evil.example' }), opener, 'MINT', 0.1), false, 'another site cannot vouch');
  assert.equal(g.vouches(go({ source: {} }), opener, 'MINT', 0.1), false, 'only the window that opened this one');
  assert.equal(g.vouches(go(), null, 'MINT', 0.1), false, 'a window with no opener');
  assert.equal(g.vouches(go(), opener, 'OTHER', 0.1), false, 'another coin');
  assert.equal(g.vouches(go(), opener, 'MINT', 0.2), false, 'another amount');
  assert.equal(g.vouches(go({ data: { type: 'x', mint: 'MINT', sol: 0.1 } }), opener, 'MINT', 0.1), false);
  const tx = { message: { staticAccountKeys: ['AAA', 'MINT'] } };
  assert.equal(g.mintBlock(tx, 'MINT'), null);
  assert.match(g.mintBlock(tx, 'OTHER'), /does not name the coin/);
  console.log('PASS quickbuy: with Auto-Confirm on, only the panel can start a buy, up to the cap');
}

// A coin paired to another token goes through pump's own SDK.
{
  const RADAR = 'HyDSdtgiSa5mHqkTVoz8cTFTeVLFKdZ8amPvtNYfpump';
  const LARP = 't9bnCGiZVUYsRKvx4d5dPcoDCSyuBM9C33ZNGNULARP';
  const WSOL = 'So11111111111111111111111111111111111111112';
  const pair = (dexId, quote, liq = 1) => ({ chainId: 'solana', dexId, baseToken: { address: RADAR }, quoteToken: { address: quote }, liquidity: { usd: liq } });
  assert.equal(G.quoteRoute([pair('pumpfun', LARP)], RADAR), LARP);
  assert.equal(G.quoteRoute([pair('pumpswap', LARP)], RADAR), LARP, 'still paired to it once it bonds');
  assert.equal(G.quoteRoute([pair('pumpfun', WSOL)], RADAR), null, 'a SOL pair stays with PumpPortal');
  assert.equal(G.quoteRoute([pair('raydium', LARP)], RADAR), null, 'only pump markets');
  assert.equal(G.quoteRoute([pair('pumpswap', WSOL, 900), pair('pumpswap', LARP, 5)], RADAR), null, 'the deepest market decides');
  assert.equal(G.quoteRoute([], RADAR), null);
  assert.equal(G.quoteRoute([pair('pumpfun', 'not an address')], RADAR), null);
  const { minOut } = await import('../webapp/pump-route.js');
  assert.equal(minOut('1000', 10).toString(), '900');
  assert.equal(minOut('1000000', 0.5).toString(), '995000');
  assert.throws(() => minOut('1000', 0));
  assert.throws(() => minOut('1000', 100));
  console.log('PASS quickbuy: a coin paired to another token takes the route, and slippage sets the floor');
}
