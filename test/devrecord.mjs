// Dev record (extension/src/lib/devrecord.js): a pump.fun coin's curve address, its creator, and the creator's launches.
// The two curve addresses were read on chain on 7 Nov 2026 (owner pump.fun, 166 bytes). node test/devrecord.mjs
import assert from 'node:assert/strict';
import { curveOf, base58, unbase58, readCurve, devRecord, onCurve } from '../extension/src/lib/devrecord.js';
import { devSummary, SERIAL } from '../extension/src/ui/devrecord.js';
import { PUMP } from '../extension/src/lib/family.js';

// The curve address is derived the way Solana does it.
assert.equal(await curveOf('DFq4aBnZkNd4PcKaSb37wRpaUGKAFUXenGbd78pTpump'), '9b5V1rbhdF8VPYHbTcVF4yhcFzyY51kGYeRXkvQjqDW8');
assert.equal(await curveOf('EQYGG65LyN5qFLXiUGWPqL9AZp6hiDacC2jJr7jMpump'), '55YNkRChkiLfBfttiABYCEPTS4eKkfWT3QLQkENhK69G');
assert.equal(base58(unbase58(PUMP)), PUMP);
assert.equal(base58(unbase58('1111111111111111111111111111111')), '1111111111111111111111111111111');
assert.throws(() => unbase58('0OIl'), /Not a Solana address/);
// A real public key is on the curve (pump.fun's program id is an ordinary key).
assert.equal(onCurve(unbase58(PUMP)), true);

// A curve's data: bonded at byte 48, creator at 49.
const CREATOR = 'AXRZB7qUJKKH6Xmw8xkM9iBg1iZafqV1z1UB7RvijrYF';
const curveData = (bonded, creator = CREATOR, size = 166) => {
  const d = new Uint8Array(size);
  d.set([23, 183, 248, 55, 96, 216, 172, 96]);
  d[48] = bonded ? 1 : 0;
  d.set(unbase58(creator), 49);
  return Buffer.from(d).toString('base64');
};
assert.deepEqual(readCurve(curveData(true)), { creator: CREATOR, bonded: true });
assert.deepEqual(readCurve(curveData(false)), { creator: CREATOR, bonded: false });
assert.equal(readCurve(Buffer.alloc(49).toString('base64')), null, 'an old curve too short to hold a creator');
assert.equal(readCurve(Buffer.alloc(166).toString('base64')), null, 'a curve with no creator set');

// The record, with a fake RPC.
const MINT = 'EQYGG65LyN5qFLXiUGWPqL9AZp6hiDacC2jJr7jMpump';
const OWN = '55YNkRChkiLfBfttiABYCEPTS4eKkfWT3QLQkENhK69G';
const flag = (b) => Buffer.from([b ? 1 : 0]).toString('base64');
function fakeRpc({ owner = PUMP, account = curveData(false), list = null } = {}) {
  const calls = [];
  const rpc = async (method, params) => {
    calls.push([method, params]);
    if (method === 'getAccountInfo') return account === null ? { value: null } : { value: { owner, data: [account, 'base64'] } };
    if (method === 'getProgramAccounts') return list ?? [{ pubkey: OWN, account: { data: [flag(false), 'base64'] } }, ...Array.from({ length: 32 }, (_, i) => ({ pubkey: `c${i}`, account: { data: [flag(i < 6), 'base64'] } }))];
    throw new Error(method);
  };
  return { rpc, calls };
}
{
  const { rpc, calls } = fakeRpc();
  assert.deepEqual(await devRecord(MINT, rpc), { creator: CREATOR, launches: 33, bonded: 6, thisBonded: false });
  assert.equal(calls[0][1][0], OWN, 'reads the coin\'s own curve');
  const [program, opts] = calls[1][1];
  assert.equal(program, PUMP);
  assert.deepEqual(opts.dataSlice, { offset: 48, length: 1 });
  assert.deepEqual(opts.filters, [{ memcmp: { offset: 0, bytes: '4y6pru6YvC7' } }, { memcmp: { offset: 49, bytes: CREATOR } }]);
}
// Not a pump.fun coin: no curve, or an account some other program owns.
assert.equal(await devRecord(MINT, fakeRpc({ account: null }).rpc), null);
assert.equal(await devRecord(MINT, fakeRpc({ owner: '11111111111111111111111111111111' }).rpc), null);
// The coin's own curve missing from the list still counts, bonded or not.
assert.deepEqual(await devRecord(MINT, fakeRpc({ account: curveData(true), list: [] }).rpc), { creator: CREATOR, launches: 1, bonded: 1, thisBonded: true });

// The panel's words.
assert.equal(devSummary(null), null);
assert.equal(devSummary({ creator: CREATOR, launches: 0 }), null);
assert.deepEqual(devSummary({ creator: CREATOR, launches: 1, bonded: 1, thisBonded: true }), { head: 'Its only coin on pump.fun', sub: 'It bonded', level: 'neutral' });
assert.deepEqual(devSummary({ creator: CREATOR, launches: 1, bonded: 0, thisBonded: false }), { head: 'Its only coin on pump.fun', sub: 'Not bonded yet', level: 'neutral' });
assert.deepEqual(devSummary({ creator: CREATOR, launches: 4, bonded: 1, thisBonded: false }), { head: '4 coins from this wallet', sub: '1 bonded · 3 not bonded', level: 'neutral' });
assert.deepEqual(devSummary({ creator: CREATOR, launches: 1240, bonded: 6, thisBonded: false }), { head: '1,240 coins from this wallet', sub: '6 bonded · 1,234 not bonded', level: 'warn' });
assert.equal(devSummary({ creator: CREATOR, launches: SERIAL, bonded: 9 }).level, 'warn');
assert.equal(devSummary({ creator: CREATOR, launches: SERIAL - 1, bonded: 0 }).level, 'neutral');

console.log('PASS devrecord: curve address, creator, launches and bonded counted, words for the panel');
