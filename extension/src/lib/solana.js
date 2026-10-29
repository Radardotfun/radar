// On-chain launch-block ("bundle") analysis straight from Solana RPC.
//
// Definition (same idea GMGN / trench tools use): wallets that bought the token
// inside the very first block it traded in. Those buys can only land there if
// they were submitted together with the launch (Jito bundle / sniper bots).
// Everything here is computed from raw chain data, nothing is estimated.

import { SLOT_CALENDAR } from './slot-calendar.js';

export const PUBLIC_RPC = 'https://api.mainnet-beta.solana.com';

// Read from the mint account itself: some free RPCs gate getTokenSupply behind a key.
async function tokenSupply(rpc, mint) {
  const info = await rpc('getAccountInfo', [mint, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
  const amount = info?.value?.data?.parsed?.info?.supply;
  if (amount == null) throw new Error('Not a token mint');
  return BigInt(amount);
}

const SKIPPED = new Set([-32007, -32009, -32004, -32001]);
const OUT_OF_RANGE = -32602;
const SLOT_SECONDS = 0.4; // fallback only
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function makeRpc(url = PUBLIC_RPC, { concurrency = 2 } = {}) {
  let id = 0;
  let active = 0;
  const queue = [];
  const pump = () => {
    while (active < concurrency && queue.length) {
      // Newest first: the cards on screen now beat leftovers from panels already closed.
      const job = queue.pop();
      active++;
      job().finally(() => { active--; pump(); });
    }
  };
  const schedule = (fn) => new Promise((resolve, reject) => {
    queue.push(() => fn().then(resolve, reject));
    pump();
  });

  async function call(method, params, retries = 5) {
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
        });
      } catch (e) {
        if (attempt >= retries) throw e;
        await sleep(600 * 2 ** attempt);
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        if (attempt >= retries) throw new Error(`RPC HTTP ${res.status} (rate limited — add your own RPC in settings)`);
        await sleep(900 * 2 ** attempt);
        continue;
      }
      const json = await res.json();
      if (json.error) {
        const err = new Error(json.error.message);
        err.code = json.error.code;
        throw err;
      }
      return json.result;
    }
  }
  return (method, params) => schedule(() => call(method, params));
}

async function blockTimeNear(rpc, slot, dir = 1) {
  for (let i = 0; i < 8; i++) {
    const s = slot + i * dir;
    try {
      const t = await rpc('getBlockTime', [s]);
      if (t != null) return { slot: s, t };
    } catch (e) {
      if (!SKIPPED.has(e.code) && e.code !== OUT_OF_RANGE) throw e;
    }
  }
  throw new Error(`No block time near slot ${slot}`);
}

// Live end of the calendar: the current tip, measured once and reused for a few minutes.
let tipMark = null;
async function tipPoint(rpc) {
  if (tipMark && Date.now() - tipMark.at < 300_000) return tipMark;
  // Finalized blocks trail the clock by ~13s; close enough to anchor an estimate.
  const tip = await rpc('getSlot', [{ commitment: 'finalized' }]);
  tipMark = { slot: tip, t: Math.floor(Date.now() / 1000) - 13, at: Date.now() };
  return tipMark;
}

// Timestamp -> slot by interpolating the bundled calendar (no RPC calls inside its range).
async function estimateSlot(rpc, T) {
  const cal = SLOT_CALENDAR;
  if (cal.length >= 2 && T >= cal[0][1] && T <= cal[cal.length - 1][1]) {
    let i = cal.findIndex(([, t]) => t >= T);
    if (i <= 0) i = 1;
    const [s0, t0] = cal[i - 1];
    const [s1, t1] = cal[i];
    return Math.round(s0 + ((T - t0) / Math.max(1, t1 - t0)) * (s1 - s0));
  }
  const tip = await tipPoint(rpc);
  const [s0, t0] = cal.length ? cal[cal.length - 1] : [tip.slot - 3000, tip.t - 3000 * SLOT_SECONDS];
  const rate = (tip.t - t0) / Math.max(1, tip.slot - s0) || SLOT_SECONDS;
  return Math.min(tip.slot, Math.round(tip.slot - (tip.t - T) / rate));
}

// Exact slot for time T (unix seconds): calendar estimate, then a short secant refine.
async function slotNearTime(rpc, T) {
  let a = await blockTimeNear(rpc, await estimateSlot(rpc, T));
  if (Math.abs(T - a.t) <= 1) return a.slot;
  let rate = SLOT_SECONDS;
  let s = a.slot + Math.round((T - a.t) / rate);
  for (let i = 0; i < 6; i++) {
    const b = await blockTimeNear(rpc, s);
    const d = T - b.t;
    if (Math.abs(d) <= 1) return b.slot;
    if (b.t !== a.t && b.slot !== a.slot) {
      const r = (b.t - a.t) / (b.slot - a.slot);
      if (r > 0.05 && r < 1) rate = r;
    }
    a = b;
    s = b.slot + Math.round(d / rate);
  }
  return a.slot;
}

async function getBlock(rpc, slot) {
  try {
    return await rpc('getBlock', [slot, {
      encoding: 'jsonParsed',
      transactionDetails: 'accounts',
      rewards: false,
      maxSupportedTransactionVersion: 1,
      commitment: 'finalized',
    }]);
  } catch (e) {
    if (SKIPPED.has(e.code)) return null;
    throw e;
  }
}

const touchesMint = (tx, mint) =>
  !tx.meta?.err && (tx.meta?.postTokenBalances || []).some((b) => b.mint === mint);

// Locate the first block (around time T) in which the mint trades.
async function findLaunchBlockByTime(rpc, mint, T) {
  const center = await slotNearTime(rpc, T);
  const slots = await rpc('getBlocks', [center - 14, center + 14, { commitment: 'finalized' }]);
  const hits = [];
  // Nearest-first; stop once we have a hit and have checked the slots just before it.
  const order = [...slots].sort((x, y) => Math.abs(x - center) - Math.abs(y - center));
  for (const s of order.slice(0, 16)) {
    const block = await getBlock(rpc, s);
    if (!block || block.blockTime < T - 1 || block.blockTime > T + 1) continue;
    if (block.transactions.some((tx) => touchesMint(tx, mint))) {
      hits.push({ slot: s, block });
      const earlier = slots.filter((x) => x < s && x >= s - 10);
      for (const e of earlier) {
        const eb = await getBlock(rpc, e);
        if (eb && eb.transactions.some((tx) => touchesMint(tx, mint))) hits.push({ slot: e, block: eb });
      }
      break;
    }
  }
  hits.sort((x, y) => x.slot - y.slot);
  return hits[0] || null;
}

// Any signature works as a `before` cursor, so a signature from a block just after
// the token's birth lets us read its first transactions without walking the
// whole history back from today.
async function oldestFromTime(rpc, address, T, maxPages) {
  for (const offset of [60, 600, 3600, 12 * 3600]) {
    // Approximate is fine here: the anchor only has to land after the token's birth.
    const slot = await estimateSlot(rpc, T + offset);
    let anchor = null;
    for (let i = 0; i < 6 && !anchor; i++) {
      const b = await rpc('getBlock', [slot + i, { transactionDetails: 'signatures', rewards: false, maxSupportedTransactionVersion: 1, commitment: 'finalized' }])
        .catch((e) => { if (SKIPPED.has(e.code)) return null; throw e; });
      anchor = b?.signatures?.at(-1) || null;
    }
    if (!anchor) continue;
    const hist = await oldestSignature(rpc, address, anchor, maxPages);
    if (hist.oldest) return hist; // something older than the anchor exists: walked to the start (or ran out of pages)
  }
  return null;
}

// Walk signature history backward from `before` to the oldest tx. Capped.
async function oldestSignature(rpc, mint, before, maxPages) {
  let cursor = before;
  let oldest = null;
  let count = 0;
  for (let page = 0; page < maxPages; page++) {
    const opts = { limit: 1000, commitment: 'finalized' };
    if (cursor) opts.before = cursor;
    const sigs = await rpc('getSignaturesForAddress', [mint, opts]);
    if (!sigs.length) return { oldest, count, complete: true };
    count += sigs.length;
    oldest = sigs[sigs.length - 1];
    cursor = oldest.signature;
    if (sigs.length < 1000) return { oldest, count, complete: true };
  }
  return { oldest, count, complete: false };
}

function analyzeBlock(block, mint, excludeOwners) {
  const buys = [];
  let firstSig = null;
  let creator = null;
  for (const tx of block.transactions) {
    if (!touchesMint(tx, mint)) continue;
    const keys = tx.transaction.accountKeys;
    const sig = tx.transaction.signatures[0];
    const feePayer = keys[0]?.pubkey;
    const pre = new Map();
    for (const b of tx.meta.preTokenBalances || []) {
      if (b.mint === mint) pre.set(b.accountIndex, BigInt(b.uiTokenAmount.amount));
    }
    const isCreate = pre.size === 0 && !firstSig;
    if (!firstSig) { firstSig = sig; if (isCreate) creator = feePayer; }
    for (const b of tx.meta.postTokenBalances || []) {
      if (b.mint !== mint || !b.owner) continue;
      const delta = BigInt(b.uiTokenAmount.amount) - (pre.get(b.accountIndex) ?? 0n);
      if (delta <= 0n || excludeOwners.has(b.owner)) continue;
      const signer = keys.some((k) => k.pubkey === b.owner && k.signer);
      buys.push({
        owner: b.owner,
        tokenAccount: keys[b.accountIndex]?.pubkey,
        amount: delta,
        decimals: b.uiTokenAmount.decimals,
        signer,
        sig,
      });
    }
  }
  return { buys, firstSig, creator };
}

async function currentBalances(rpc, tokenAccounts) {
  const out = new Map();
  for (let i = 0; i < tokenAccounts.length; i += 100) {
    const chunk = tokenAccounts.slice(i, i + 100);
    const res = await rpc('getMultipleAccounts', [chunk, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
    res.value.forEach((acc, j) => {
      const amt = acc?.data?.parsed?.info?.tokenAmount?.amount;
      out.set(chunk[j], amt ? BigInt(amt) : 0n);
    });
  }
  return out;
}

/**
 * Launch-block analysis for a Solana mint.
 * @param rpc        from makeRpc()
 * @param mint       token address
 * @param launchMs   earliest pairCreatedAt (ms) from DexScreener
 * @param pairAddrs  pool / bonding-curve addresses to exclude as "buyers"
 * @param opts.maxPages history pages (1000 sigs each) to walk looking for the first tx
 * @param opts.launchIsCreation earliest pool is a launchpad curve (its open = token birth)
 * @param opts.hintMs   best-known birth time (ms), e.g. RugCheck first-seen; enables the fast path
 * @param opts.launchPair address of the earliest listed pool (its first tx is the pool opening)
 * @param opts.cached previously computed launch data (launch is immutable; only holdings refresh)
 */
export async function analyzeLaunch(rpc, mint, launchMs, pairAddrs = [], { maxPages = 8, cached = null, launchIsCreation = true, hintMs = null, launchPair = null } = {}) {
  const exclude = new Set(pairAddrs);
  let launch = cached;

  if (!launch) {
    let found = null;
    let note = null;

    // 1) Find the very first tx: jump near the birth time when we know it
    //    (RugCheck first-seen / first pool), else walk back from today.
    let hist = null;
    if (Number.isFinite(hintMs)) hist = await oldestFromTime(rpc, mint, Math.floor(hintMs / 1000), maxPages).catch(() => null);
    // Walking back from today only pays off for young tokens; for old ones it's pages of dead ends.
    const young = !Number.isFinite(hintMs) || Date.now() - hintMs < 3 * 86_400_000;
    if (!hist?.complete && (young || !hist)) {
      const recent = await oldestSignature(rpc, mint, null, young ? maxPages : 2);
      if (recent.complete || !hist) hist = recent;
    }
    if (hist.complete && hist.oldest) {
      const block = await getBlock(rpc, hist.oldest.slot);
      // A bare mint (non-launchpad tokens: the creator receives the whole supply, or nothing
      // trades yet) isn't a launch; for those, trading begins when the first pool opens.
      if (block) {
        const signerBuys = analyzeBlock(block, mint, exclude).buys.filter((b) => b.signer);
        const supply = await tokenSupply(rpc, mint);
        const minted = signerBuys.some((b) => supply > 0n && b.amount * 10n >= supply * 9n);
        if (signerBuys.length && !minted) found = { slot: hist.oldest.slot, block };
      }
    }

    // 2) Deep history or launched later into a pool: jump straight to the first pool's launch time.
    if (!found) {
      if (!Number.isFinite(launchMs) || !launchMs) return { ok: false, reason: 'No launch time available' };
      if (!hist.complete && !launchIsCreation) {
        return { ok: false, deep: true, reason: `History too deep (>${hist.count.toLocaleString()} txs) to reach launch` };
      }
      // The first pool's own first transaction is its opening block: read it directly.
      if (launchPair) {
        const poolHist = await oldestFromTime(rpc, launchPair, Math.floor(launchMs / 1000), 3).catch(() => null);
        if (poolHist?.complete && poolHist.oldest) {
          const block = await getBlock(rpc, poolHist.oldest.slot);
          if (block?.transactions.some((tx) => touchesMint(tx, mint))) found = { slot: poolHist.oldest.slot, block };
        }
      }
      if (!found && !hist.complete && !launchPair) found = await findLaunchBlockByTime(rpc, mint, Math.floor(launchMs / 1000));
      if (!found && hist.complete) found = await findLaunchBlockByTime(rpc, mint, Math.floor(launchMs / 1000));
      if (!found) return { ok: false, deep: !hist.complete, reason: hist.complete ? 'Launch block not found' : 'Launched long before its listed pool; launch not reachable' };
      // Self-check against signature history:
      //  - nothing before us            -> this is the launch
      //  - a few txs just before us     -> we landed a block late, step back
      //  - a handful of old setup txs   -> mint init / metadata, pool open is the launch
      //  - lots of older trading        -> the listed pool isn't the launch (migration)
      let settled = false;
      for (let pass = 0; pass < 4 && !settled; pass++) {
        const firstSig = analyzeBlock(found.block, mint, exclude).firstSig;
        // Some RPCs only accept a cursor they've indexed; then there's nothing older to check against.
        const prior = (await rpc('getSignaturesForAddress', [mint, { before: firstSig, limit: 50, commitment: 'finalized' }])
          .catch((e) => { if (/not found/i.test(String(e?.message))) return []; throw e; }))
          .filter((x) => !x.err);
        const nearby = prior.filter((x) => x.slot >= found.slot - 30);
        const older = prior.length - nearby.length;
        if (nearby.length) {
          const slot = Math.min(...nearby.map((x) => x.slot));
          const block = await getBlock(rpc, slot);
          if (!block) break;
          found = { slot, block };
          continue;
        }
        if (older > 5) {
          return { ok: false, deep: true, reason: 'Traded before its listed pool; launch not reachable' };
        }
        settled = true;
      }
      if (!settled) return { ok: false, deep: true, reason: 'Launch is older than the listed pool; not reachable' };
      note = hist.complete ? 'pool launch' : 'located by launch time';
    }

    const { buys, creator } = analyzeBlock(found.block, mint, exclude);
    // Pools / curves never sign; unsigned receivers in the launch block are program accounts.
    const wallets = new Map();
    for (const b of buys.filter((x) => x.signer)) {
      const w = wallets.get(b.owner) || { owner: b.owner, tokenAccounts: new Set(), amount: 0n, decimals: b.decimals };
      w.amount += b.amount;
      w.tokenAccounts.add(b.tokenAccount);
      wallets.set(b.owner, w);
    }
    launch = {
      slot: found.slot,
      time: found.block.blockTime,
      creator,
      note,
      wallets: [...wallets.values()].map((w) => ({
        owner: w.owner,
        tokenAccounts: [...w.tokenAccounts],
        amount: w.amount.toString(),
        decimals: w.decimals,
      })),
    };
  }

  const supply = await tokenSupply(rpc, mint);
  const accounts = launch.wallets.flatMap((w) => w.tokenAccounts);
  const balances = accounts.length ? await currentBalances(rpc, accounts) : new Map();

  const pct = (x) => (supply > 0n ? Number((x * 1000000n) / supply) / 10000 : 0);
  let bundled = 0n, held = 0n, devBought = 0n, devHeld = 0n;
  const wallets = launch.wallets.map((w) => {
    const amount = BigInt(w.amount);
    const now = w.tokenAccounts.reduce((s, a) => s + (balances.get(a) ?? 0n), 0n);
    const isDev = w.owner === launch.creator;
    if (isDev) { devBought += amount; devHeld += now; } else { bundled += amount; held += now; }
    return { owner: w.owner, isDev, boughtPct: pct(amount), heldPct: pct(now) };
  }).sort((a, b) => b.boughtPct - a.boughtPct);

  return {
    ok: true,
    launchSlot: launch.slot,
    launchTime: launch.time,
    creator: launch.creator,
    note: launch.note,
    bundleWallets: wallets.filter((w) => !w.isDev).length,
    bundledPct: pct(bundled),
    bundleHeldPct: pct(held),
    devBoughtPct: pct(devBought),
    devHeldPct: pct(devHeld),
    wallets: wallets.slice(0, 12),
    cache: launch,
  };
}
