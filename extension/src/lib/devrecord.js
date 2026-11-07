// Dev record: for a pump.fun coin, the wallet it pays its creator fees to (its dev, as pump.fun records it) and every
// coin that wallet has launched on pump.fun, with how many bonded. Read from the chain alone, two calls:
//   1) the coin's bonding curve, an address derived from the mint (["bonding-curve", mint] under pump.fun's program);
//      the curve keeps its creator at byte 49 and whether it bonded at byte 48.
//   2) every bonding curve with that creator (pump.fun's own API refuses scripts; the chain doesn't).
// A coin that didn't launch on pump.fun has no curve, and then there is no record to show.
import { PUMP } from './family.js';

// The first 8 bytes of every BondingCurve account (sha256("account:BondingCurve")), so only curves are counted.
const CURVE_TAG = '4y6pru6YvC7';
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58(bytes) {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let s = '';
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b) break; s = `1${s}`; }
  return s;
}
export function unbase58(s) {
  let n = 0n;
  for (const c of String(s)) {
    const i = B58.indexOf(c);
    if (i < 0) throw new Error('Not a Solana address');
    n = n * 58n + BigInt(i);
  }
  const out = [];
  while (n > 0n) { out.unshift(Number(n & 255n)); n >>= 8n; }
  for (const c of String(s)) { if (c !== '1') break; out.unshift(0); }
  return Uint8Array.from(out);
}
const bytesOf = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

// An address derived from seeds must not be a point on the ed25519 curve (no key can sign for it).
const P = 2n ** 255n - 19n;
const mod = (a) => ((a % P) + P) % P;
function pow(b, e) {
  let r = 1n;
  b = mod(b);
  while (e > 0n) { if (e & 1n) r = (r * b) % P; b = (b * b) % P; e >>= 1n; }
  return r;
}
const D = mod(-121665n * pow(121666n, P - 2n));
export function onCurve(bytes) {
  let y = 0n;
  for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(bytes[i]);
  y &= (1n << 255n) - 1n;
  if (y >= P) return false;
  const y2 = (y * y) % P;
  const x2 = (mod(y2 - 1n) * pow(mod(D * y2 + 1n), P - 2n)) % P;
  return x2 === 0n || pow(x2, (P - 1n) / 2n) === 1n;
}

/** Solana's findProgramAddress: the first bump, from 255 down, whose hash is off the curve. */
export async function programAddress(seeds, program) {
  const tail = [...unbase58(program), ...new TextEncoder().encode('ProgramDerivedAddress')];
  const head = seeds.flatMap((s) => [...s]);
  for (let bump = 255; bump >= 0; bump--) {
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from([...head, bump, ...tail])));
    if (!onCurve(hash)) return base58(hash);
  }
  throw new Error('No program address');
}

export const curveOf = (mint) => programAddress([new TextEncoder().encode('bonding-curve'), unbase58(mint)], PUMP);

/** A curve account's data (base64) -> { creator, bonded }, or null when it's too short to hold a creator. */
export function readCurve(b64) {
  const d = bytesOf(b64);
  if (d.length < 81) return null;
  const creator = d.subarray(49, 81);
  if (creator.every((b) => b === 0)) return null;
  return { creator: base58(creator), bonded: d[48] === 1 };
}

/** rpc(method, params) -> result. { creator, launches, bonded, thisBonded } for a pump.fun coin, else null. */
export async function devRecord(mint, rpc) {
  const curve = await curveOf(mint);
  const info = await rpc('getAccountInfo', [curve, { encoding: 'base64' }]);
  const v = info?.value;
  if (!v || v.owner !== PUMP) return null;
  const own = readCurve(v.data?.[0] || '');
  if (!own) return null;
  // Only the bonded flag of each of the creator's curves (byte 48).
  const curves = await rpc('getProgramAccounts', [PUMP, { encoding: 'base64', dataSlice: { offset: 48, length: 1 },
    filters: [{ memcmp: { offset: 0, bytes: CURVE_TAG } }, { memcmp: { offset: 49, bytes: own.creator } }] }]);
  const list = Array.isArray(curves) ? curves : [];
  const bonded = list.filter((c) => bytesOf(c.account?.data?.[0] || '')[0] === 1).length;
  // The coin's own curve is one of them; if the read somehow missed it, count it anyway.
  const seen = list.some((c) => c.pubkey === curve);
  return { creator: own.creator, launches: list.length + (seen ? 0 : 1), bonded: bonded + (seen || !own.bonded ? 0 : 1), thisBonded: own.bonded };
}
