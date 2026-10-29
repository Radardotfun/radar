// Frontrun Trading API (frontrun.pro, beta): buy a Solana coin from the user's own Frontrun wallet.
// The user brings their own API key (made at frontrun.pro/api); Frontrun holds the wallets and signs, Radar only sends
// the order. The key stays in the extension's local storage and only ever goes to solana.frontrun.pro.
// Reference: https://www.frontrun.pro/api/llm.txt (REST, Authorization: Bearer fr_sk_...).

export const FRONTRUN_API = 'https://solana.frontrun.pro/api/v1/trading-api';
export const FRONTRUN_ORIGIN = 'https://solana.frontrun.pro/*';
export const KEY_RE = /^fr_sk_[A-Za-z0-9]{64}$/;
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const LAMPORTS = 1e9;

// Guard rails on what the panel can send: a typo'd 10 for 0.1 should not go through.
export const LIMITS = { maxSol: 25, minSol: 0.001, maxSlippageBps: 5000 };

export class FrontrunError extends Error {
  constructor(message, code = 0) { super(message); this.code = code; }
}

// Frontrun's error codes, in words a trader can act on.
const WHY = {
  400: 'Frontrun rejected the order',
  401: 'Frontrun did not accept this API key',
  403: 'This API key was revoked or does not own that wallet',
  404: 'That Frontrun wallet was not found',
  409: 'That wallet already has a trade in flight. Wait a few seconds',
  422: 'Not enough SOL, or the price moved past your slippage',
  503: 'Frontrun is not ready yet. Try again in a moment',
  504: 'Sent, but no confirmation within 10 seconds. Check Solscan before buying again',
};

async function call(key, path, { method = 'GET', body, fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  if (!KEY_RE.test(key || '')) throw new FrontrunError('No Frontrun API key connected', 401);
  let res;
  try {
    res = await fetchImpl(`${FRONTRUN_API}${path}`, {
      method,
      headers: { authorization: `Bearer ${key}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch (e) {
    throw new FrontrunError(e?.name === 'TimeoutError' ? 'Frontrun did not answer in time' : 'Could not reach Frontrun', 0);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.status === false) {
    const code = res.ok ? data?.code || 500 : res.status;
    const detail = typeof data?.message === 'string' ? data.message.replace(/[\u0000-\u001f]/g, ' ').slice(0, 140) : '';
    throw new FrontrunError(`${WHY[code] || 'Frontrun error'}${detail && code !== 504 ? `: ${detail}` : ''}`, code);
  }
  return data?.data ?? data;
}

// The user's Frontrun wallets, with SOL balances (Frontrun caches balances; they are not live).
export async function listWallets(key, opts) {
  const rows = await call(key, '/wallets', opts);
  return (Array.isArray(rows) ? rows : []).filter((w) => w?.address && (w.chain || 'SOLANA') === 'SOLANA' && (w.status || 'ACTIVE') === 'ACTIVE')
    .map((w) => ({ address: w.address, name: w.name || '', sol: Number(w.balance || 0) / LAMPORTS }));
}

// Validates the order before anything is sent. Returns the exact body Frontrun receives.
export function buyBody({ mint, sol, slippageBps, wallet }) {
  if (!MINT_RE.test(mint || '')) throw new FrontrunError('Not a Solana token address', 400);
  const amount = Number(sol);
  if (!Number.isFinite(amount) || amount < LIMITS.minSol) throw new FrontrunError(`Buy at least ${LIMITS.minSol} SOL`, 400);
  if (amount > LIMITS.maxSol) throw new FrontrunError(`Radar caps one buy at ${LIMITS.maxSol} SOL`, 400);
  const bps = Math.round(Number(slippageBps));
  if (!Number.isInteger(bps) || bps < 1 || bps > LIMITS.maxSlippageBps) throw new FrontrunError('Slippage must be between 0.01% and 50%', 400);
  if (wallet && !MINT_RE.test(wallet)) throw new FrontrunError('Not a Solana wallet address', 400);
  return {
    tokenMint: mint,
    side: 'BUY',
    uiInputAmount: String(Number(amount.toFixed(9))),
    slippageBasisPoint: bps,
    ...(wallet ? { walletAddress: wallet } : {}),
    confirmationMode: 'SYNC',
    commitment: 'confirmed',
  };
}

// One buy. SYNC mode: Frontrun answers once the trade is confirmed (up to 10 s); a 504 is "unknown", not "failed".
export async function buy(key, order, opts) {
  const body = buyBody(order);
  const r = await call(key, '/trade', { ...opts, method: 'POST', body, timeoutMs: 25000 });
  const signature = typeof r?.signature === 'string' && /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(r.signature) ? r.signature : null;
  return { signature, confirmed: !!r?.confirmed, status: r?.status || null, wallet: r?.walletAddress || order.wallet || null };
}
