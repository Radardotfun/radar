// A coin's family on pump.fun custom pairs (extension/src/lib/family.js), read from the chain, and the lines the bot
// prints for it. The RPC and DexScreener are stubbed. node test/family.mjs
import assert from 'node:assert/strict';
import { familyCounts, familyDetails, parentOf, PUMP, PUMP_AMM } from '../extension/src/lib/family.js';
import { aggregate } from '../extension/src/lib/market.js';
import { botReply, familyLine } from '../bot/reply.js';

const LARP = 't9bnCGiZVUYsRKvx4d5dPcoDCSyuBM9C33ZNGNULARP';
const RADAR = 'BTmeAebSh8MaYsTDiBiix79htKckjYQP5fvucFoFpump';
const GALT = 'FomZeGyfkxa36RARLtBZyrfDRL6hqosjohPiX5E4pump';
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const raw = (s) => { let n = 0n; for (const c of s) n = n * 58n + BigInt(B58.indexOf(c)); const out = []; while (n > 0n) { out.unshift(Number(n % 256n)); n /= 256n; } for (const c of s) { if (c !== '1') break; out.unshift(0); } while (out.length < 32) out.unshift(0); return Buffer.from(out).toString('base64'); };

// 15 curves under LARPCHECK, two of them graduated to PumpSwap pools (RADAR and Galt).
const asked = [];
const rpc = async (method, [program, opts]) => {
  asked.push({ program, opts });
  const quote = opts.filters.find((f) => f.memcmp).memcmp;
  if (program === PUMP) return quote.offset === 83 && quote.bytes === LARP ? Array.from({ length: 15 }, () => ({ account: { data: ['', 'base64'] } })) : [];
  if (program === PUMP_AMM) return quote.offset === 75 && quote.bytes === LARP ? [RADAR, GALT].map((m) => ({ account: { data: [raw(m), 'base64'] } })) : [];
  return [];
};
const counts = await familyCounts(LARP, rpc);
assert.deepEqual(counts, { children: 15, graduated: 2, mints: [RADAR, GALT], more: false });
assert.ok(asked.every((a) => a.opts.dataSlice), 'only the bytes needed come back');
assert.deepEqual(asked.find((a) => a.program === PUMP).opts.filters[0], { dataSize: 166 });
console.log('PASS family: launches under a coin, and the graduated ones\' mints, from the chain');

const tokens = async (refs) => refs.map((r) => (r.address === RADAR ? { address: RADAR, symbol: 'RADAR', marketCap: 7_400, mcapBacked: true, volume: { h24: 2_700 } } : { address: GALT, symbol: 'Galt', marketCap: 800, mcapBacked: false, volume: { h24: 690 } }));
const fam = await familyDetails(counts, { tokens });
assert.equal(fam.biggest?.symbol, 'RADAR', 'the biggest backed one');
assert.equal(fam.volume, 3_390);
assert.equal(familyLine(fam, { address: LARP, symbol: 'LARPCHECK' }), '🌱 Family: 15 coins launched under LARPCHECK (2 graduated) · $3.4K vol 24h · biggest RADAR $7.4K');
console.log('PASS family: the graduated children\'s volume and the biggest');

// The parent is the coin's own pool's quote, when it's a coin.
const pair = (quote) => ({ chainId: 'solana', dexId: 'pumpswap', pairAddress: 'P', baseToken: { address: RADAR, symbol: 'RADAR', name: 'Radar' }, quoteToken: quote, marketCap: 7_400, liquidity: { usd: 8_000 }, volume: { h24: 2_700 }, pairCreatedAt: 1 });
const [radar] = aggregate([pair({ address: LARP, symbol: 'LARPCHECK' })]);
assert.deepEqual(parentOf(radar), { address: LARP, symbol: 'LARPCHECK' });
assert.equal(familyLine({ children: 0 }, radar), '🌳 Launched under LARPCHECK: priced in it, so every buy goes through it');
const [onSol] = aggregate([pair({ address: 'So11111111111111111111111111111111111111112', symbol: 'SOL' })]);
assert.equal(parentOf(onSol), null, 'priced in SOL: no parent');
assert.equal(familyLine(null, onSol), '');
console.log('PASS family: a coin priced in another coin names its parent');

// In the reply: after the coins, plain tickers only (one cashtag a post).
const text = botReply({ named: { address: LARP, symbol: 'LARPCHECK', chain: 'solana', marketCap: 260_000 }, how: 'post', picks: [] }, 'https://x.com/i/status/1', Date.now(), { family: fam });
assert.match(text, /🌱 Family: 15 coins launched under LARPCHECK/);
assert.equal((text.match(/\$[A-Z]/g) || []).length, 1, 'one cashtag');
console.log('PASS family: the reply carries the family line');
process.exit(0);
