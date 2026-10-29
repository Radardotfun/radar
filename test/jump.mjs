import { makeRpc } from '../extension/src/lib/solana.js';
const rpc = makeRpc(process.env.RPC);
const mint = process.argv[2], T = Math.floor(Date.parse(process.argv[3]) / 1000) + 120;
const tip = await rpc('getSlot', [{ commitment: 'finalized' }]);
const tt = await rpc('getBlockTime', [tip - 40]);
const a1 = await rpc('getBlockTime', [tip - 40 - 100000]);
let rate = (tt - a1) / 100000, s = tip - 40 - Math.round((tt - T) / rate);
for (let i = 0; i < 8; i++) { let t; try { t = await rpc('getBlockTime', [s]); } catch { s++; continue; } if (Math.abs(T - t) <= 2) break; s += Math.round((T - t) / 0.4); }
console.log('slot near T', s);
const blk = await rpc('getBlock', [s, { transactionDetails: 'signatures', rewards: false, maxSupportedTransactionVersion: 1 }]);
const anchor = blk.signatures[0];
const sigs = await rpc('getSignaturesForAddress', [mint, { before: anchor, limit: 1000 }]);
console.log('returned', sigs.length, 'newest slot', sigs[0]?.slot, 'oldest slot', sigs.at(-1)?.slot, 'anchor slot', s);
let cursor = sigs.at(-1).signature, pages = 1, last = sigs.at(-1);
while (pages < 15) { const p = await rpc('getSignaturesForAddress', [mint, { before: cursor, limit: 1000 }]); pages++; if (!p.length) break; last = p.at(-1); cursor = last.signature; if (p.length < 1000) break; }
console.log('pages', pages, 'oldest', last.slot, new Date((await rpc('getBlockTime', [last.slot])) * 1000).toISOString());
