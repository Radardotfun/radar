// A coin's family on pump.fun custom pairs: coins launched priced in another coin are its children, so every buy of a
// child goes through the parent ($RADAR is paired under $LARPCHECK). Asked for in the Radar Discord after @Sporemap, which
// maps these families ("4,400+ coins paired directly under $HYPE").
// Read from the chain: a pump.fun curve keeps its quote coin at byte 83 (every launch under the coin, graduated or not),
// and a PumpSwap pool keeps its base at 43 and its quote at 75 (the graduated ones, with their mints). GeckoTerminal has
// the same data but refuses Cloudflare's addresses.
import { isBaseQuote, fullTokens } from './market.js';

export const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
export const PUMP_AMM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
const CURVE_SIZE = 166;
// Three DexScreener calls of 30 for the volume and the biggest; HYPE has 92 graduated children.
const MINTS_MAX = 90;

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes) {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let s = '';
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b) break; s = `1${s}`; }
  return s;
}
const bytesOf = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

// A filtered read of a program's accounts. Helius refuses getProgramAccounts on programs this size ("Too many accounts
// requested ... Please use getProgramAccountsV2 with pagination"), so on that answer the paged call is used instead.
async function programAccounts(rpc, program, opts) {
  try {
    return await rpc('getProgramAccounts', [program, opts]);
  } catch (e) {
    if (!/getProgramAccountsV2/.test(String(e?.message))) throw e;
  }
  const out = [];
  let paginationKey;
  for (let page = 0; page < 5; page++) {
    const r = await rpc('getProgramAccountsV2', [program, { ...opts, limit: 10_000, ...(paginationKey ? { paginationKey } : {}) }]);
    out.push(...(r?.accounts || []));
    paginationKey = r?.paginationKey;
    if (!paginationKey) break;
  }
  return out;
}

/** On the server: how many coins launched under `mint`, and the mints of the graduated ones. rpc(method, params) -> result. */
export async function familyCounts(mint, rpc) {
  const [curves, pools] = await Promise.all([
    programAccounts(rpc, PUMP, { encoding: 'base64', dataSlice: { offset: 0, length: 0 }, filters: [{ dataSize: CURVE_SIZE }, { memcmp: { offset: 83, bytes: mint } }] }),
    programAccounts(rpc, PUMP_AMM, { encoding: 'base64', dataSlice: { offset: 43, length: 32 }, filters: [{ memcmp: { offset: 75, bytes: mint } }] }),
  ]);
  const mints = [...new Set((pools || []).map((a) => base58(bytesOf(a.account.data[0]))).filter((m) => m !== mint))];
  // A coin launched straight on PumpSwap has a pool and no curve, so the count is whichever is larger.
  return { children: Math.max((curves || []).length, mints.length), graduated: mints.length, mints: mints.slice(0, MINTS_MAX), more: mints.length > MINTS_MAX };
}

/** In the bot and the panel: the graduated children's 24h volume and the biggest of them, from DexScreener. */
export async function familyDetails(counts, { tokens = fullTokens } = {}) {
  if (!counts?.mints?.length) return { ...counts, volume: 0, biggest: null };
  const full = await tokens(counts.mints.map((address) => ({ chain: 'solana', address }))).catch(() => []);
  const biggest = full.filter((t) => t?.mcapBacked).sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0))[0] || null;
  return { ...counts, volume: full.reduce((s, t) => s + (t?.volume?.h24 || 0), 0), biggest };
}

/** The coin a token was launched under: its pool's quote, when that's a coin and not SOL or a dollar. */
export const parentOf = (t) => (t?.quote?.address && !isBaseQuote(t.quote.address) && t.quote.address !== t.address ? { address: t.quote.address, symbol: String(t.quote.symbol || '').trim() } : null);
