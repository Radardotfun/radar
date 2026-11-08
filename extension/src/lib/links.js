// Wallet links and snipers: Radar's own read of who stands behind a coin's top holders, straight from the chain.
//
// Two top holders are linked when the chain ties them, in any of these ways:
//   same funder      an outside wallet sent SOL to both in their very first transaction (fresh wallets only: a wallet with
//                    1,000+ transactions has its first one out of reach)
//   funded each other one top holder paid the other
//   tokens sent      a holder's first coins came from another wallet's hand, not a buy: from a top holder, from the dev,
//                    or from one outside wallet that sent to two or more of them
//   one transaction  two or more first got the coin in the same transaction (one buyer, many wallets)
//   the dev          the dev's wallet paid them or sent them the coin
// Exchanges and other busy wallets (1,000+ transactions inside a day) pay thousands of strangers, so they never link anyone.
// Pools, curves and locks never count as holders: they are program accounts, which can't sign.
// Snipers: top holders whose first coins landed within 10 seconds of the launch.
//
// Every figure is read from the chain. Nothing is estimated, and a wallet Radar couldn't read is never called linked.
import { onCurve, unbase58 } from './devrecord.js';

export const TOP = 12; // top holders read
export const SNIPE_S = 10; // seconds after launch
const PAGE = 1000; // the most one history read returns; fewer means it's the whole history
const BUSY = 1000; // a wallet doing this many transactions inside a day is an exchange or a service
const BURN = new Set(['1nc1nerator11111111111111111111111111111111']);

const keyOf = (k) => (typeof k === 'string' ? k : k?.pubkey || null);

// Whoever paid for a wallet's first transaction: the SOL sent to it, else the fee payer when that isn't the wallet itself.
export function funderOf(tx, owner) {
  const msg = tx?.transaction?.message;
  const ins = [...(msg?.instructions || []), ...(tx?.meta?.innerInstructions || []).flatMap((x) => x?.instructions || [])];
  for (const i of ins) {
    if (i?.program !== 'system' || !i.parsed) continue;
    const { type, info = {} } = i.parsed;
    if ((type === 'transfer' || type === 'transferWithSeed') && info.destination === owner && info.source && info.source !== owner) return info.source;
    if ((type === 'createAccount' || type === 'createAccountWithSeed') && info.newAccount === owner && info.source && info.source !== owner) return info.source;
  }
  const payer = keyOf(msg?.accountKeys?.[0]);
  return payer && payer !== owner ? payer : null;
}

// A program account (pool, curve, lock) has an address off the ed25519 curve.
export function isWallet(address) {
  try { return !BURN.has(address) && onCurve(unbase58(address)); } catch { return false; }
}

// Where a holder's first coins came from, in the transaction that first gave it some: 'buy' when a pool or curve paid them
// out, the sending wallet when another wallet's balance went down instead, null when it can't be told.
export function tokensFrom(tx, mint, owner) {
  const pre = new Map((tx?.meta?.preTokenBalances || []).filter((b) => b.mint === mint).map((b) => [b.accountIndex, b]));
  const post = (tx?.meta?.postTokenBalances || []).filter((b) => b.mint === mint);
  const amt = (b) => Number(b?.uiTokenAmount?.amount || 0);
  const indexes = new Set([...pre.keys(), ...post.map((b) => b.accountIndex)]);
  const senders = [];
  for (const i of indexes) {
    const before = pre.get(i);
    const after = post.find((b) => b.accountIndex === i);
    const who = after?.owner || before?.owner;
    if (!who || who === owner) continue;
    if (amt(after) < amt(before)) senders.push(who);
  }
  if (!senders.length) return null;
  if (senders.some((w) => !isWallet(w))) return 'buy';
  return senders.length === 1 ? senders[0] : null;
}

// Groups holders the chain ties together (see the top). Returns [{ kinds, owners, pct, by }], biggest first.
export function linkHolders(holders, { creator = null, busy = new Set() } = {}) {
  const owners = new Set(holders.map((h) => h.owner));
  const parent = new Map(holders.map((h) => [h.owner, h.owner]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const kinds = new Map(); // root -> Set of kinds, merged on join
  const join = (a, b, kind) => {
    const ra = find(a); const rb = find(b);
    const ks = new Set([...(kinds.get(ra) || []), ...(kinds.get(rb) || []), kind]);
    if (ra !== rb) parent.set(ra, rb);
    kinds.set(rb, ks);
  };
  const dev = new Map(); // owner -> kind
  const shared = (field, kind) => {
    const first = new Map();
    for (const h of holders) {
      const v = h[field];
      if (!v || v === 'buy') continue;
      if (creator && v === creator) { dev.set(h.owner, kind === 'same funder' ? 'funded by the dev' : 'coins from the dev'); continue; }
      if (owners.has(v)) { join(h.owner, v, kind === 'same funder' ? 'funded each other' : 'tokens sent'); continue; }
      if (busy.has(v)) continue;
      if (first.has(v)) join(h.owner, first.get(v), kind); else first.set(v, h.owner);
    }
  };
  shared('funder', 'same funder');
  shared('sentBy', 'tokens sent');
  const byTx = new Map();
  for (const h of holders) {
    if (!h.firstTx) continue;
    if (byTx.has(h.firstTx)) join(h.owner, byTx.get(h.firstTx), 'one transaction'); else byTx.set(h.firstTx, h.owner);
  }

  const groups = new Map();
  for (const h of holders) {
    const r = find(h.owner);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(h);
  }
  const out = [];
  for (const [root, members] of groups) {
    if (members.length < 2) continue;
    const tally = new Map();
    for (const m of members) if (m.funder && !owners.has(m.funder)) tally.set(m.funder, (tally.get(m.funder) || 0) + 1);
    const by = [...tally].sort((a, b) => b[1] - a[1]).find(([, n]) => n >= 2)?.[0] || null;
    out.push({ kinds: [...(kinds.get(root) || [])].sort(), owners: members.map((m) => m.owner), pct: members.reduce((s, m) => s + m.pct, 0), by });
  }
  // Tied to the dev on their own: shown apart, even when they also sit in a group above.
  const devRows = holders.filter((h) => dev.has(h.owner));
  if (devRows.length) out.push({ kinds: [...new Set(devRows.map((h) => dev.get(h.owner)))].sort(), owners: devRows.map((h) => h.owner), pct: devRows.reduce((s, h) => s + h.pct, 0), by: creator, dev: true });
  return out.sort((a, b) => b.pct - a.pct);
}

// The oldest transaction that went through, from a full history page. null when the page isn't the whole history.
function oldestOk(sigs) {
  if (!Array.isArray(sigs) || sigs.length >= PAGE) return null;
  for (let i = sigs.length - 1; i >= 0; i--) if (!sigs[i].err) return sigs[i];
  return null;
}
const getTx = (rpc, sig) => rpc('getTransaction', [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 1, commitment: 'confirmed' }]).catch(() => null);
const history = (rpc, address) => rpc('getSignaturesForAddress', [address, { limit: PAGE, commitment: 'confirmed' }]).catch(() => null);

/**
 * rpc(method, params) from makeRpc(). mint: the coin. creator: the dev wallet when known. launchS: launch time in
 * seconds (the launch block's time). exclude: pool / curve addresses.
 */
export async function walletLinks(rpc, mint, { creator = null, launchS = null, exclude = [], top = TOP } = {}) {
  const skip = new Set([...exclude, ...BURN]);
  const [largest, mintInfo] = await Promise.all([
    rpc('getTokenLargestAccounts', [mint, { commitment: 'confirmed' }]),
    rpc('getAccountInfo', [mint, { encoding: 'jsonParsed', commitment: 'confirmed' }]),
  ]);
  const supply = Number(mintInfo?.value?.data?.parsed?.info?.supply || 0);
  if (!supply) throw new Error('Not a token mint');
  const accounts = (largest?.value || []).filter((a) => a?.address && !skip.has(a.address));
  const empty = { ok: true, at: Date.now(), read: 0, traced: 0, devPct: null, holders: [], groups: [], linked: { wallets: 0, pct: 0 }, snipers: { wallets: 0, pct: 0 } };
  if (!accounts.length) return empty;
  const infos = await rpc('getMultipleAccounts', [accounts.map((a) => a.address), { encoding: 'jsonParsed', commitment: 'confirmed' }]);

  // One row per wallet, its biggest token account kept for where its coins came from.
  const byOwner = new Map();
  accounts.forEach((a, i) => {
    const owner = infos?.value?.[i]?.data?.parsed?.info?.owner;
    if (!owner || skip.has(owner) || !isWallet(owner)) return;
    const amount = Number(a.amount || 0);
    const row = byOwner.get(owner) || { owner, amount: 0, account: a.address, biggest: 0 };
    row.amount += amount;
    if (amount > row.biggest) { row.biggest = amount; row.account = a.address; }
    byOwner.set(owner, row);
  });
  const devRow = creator ? byOwner.get(creator) : null;
  const rows = [...byOwner.values()].filter((r) => r.owner !== creator).sort((a, b) => b.amount - a.amount).slice(0, top);
  if (!rows.length) return { ...empty, devPct: devRow ? (devRow.amount / supply) * 100 : null };

  const read = await Promise.all(rows.map(async (r) => {
    const pct = (r.amount / supply) * 100;
    const [own, coin] = await Promise.all([history(rpc, r.owner), history(rpc, r.account)]);
    const firstOwn = oldestOk(own);
    const firstCoin = oldestOk(coin);
    const [ownTx, coinTx] = await Promise.all([firstOwn ? getTx(rpc, firstOwn.signature) : null, firstCoin ? getTx(rpc, firstCoin.signature) : null]);
    const from = coinTx ? tokensFrom(coinTx, mint, r.owner) : null;
    const firstBuy = firstCoin?.blockTime ?? null;
    return {
      owner: r.owner,
      pct,
      read: !!coinTx,
      traced: !!ownTx,
      funder: ownTx ? funderOf(ownTx, r.owner) : null,
      sentBy: from && from !== 'buy' ? from : null,
      bought: from === 'buy',
      firstTx: coinTx ? firstCoin.signature : null,
      firstBuy,
      sniper: !!(launchS && firstBuy != null && firstBuy >= launchS - 1 && firstBuy - launchS <= SNIPE_S),
    };
  }));

  // An outside wallet shared by two holders only links them if it isn't an exchange or another busy service.
  const owners = new Set(read.map((h) => h.owner));
  const counts = new Map();
  for (const h of read) for (const v of [h.funder, h.sentBy]) if (v && v !== creator && !owners.has(v)) counts.set(v, (counts.get(v) || 0) + 1);
  const shared = [...counts].filter(([, n]) => n >= 2).map(([v]) => v);
  const busy = new Set();
  await Promise.all(shared.map(async (v) => {
    const sigs = await history(rpc, v);
    // A wallet Radar couldn't read counts as busy: no link is claimed on a read that failed.
    if (!Array.isArray(sigs)) { busy.add(v); return; }
    if (sigs.length >= BUSY && (sigs[0].blockTime || 0) - (sigs[sigs.length - 1].blockTime || 0) < 86_400) busy.add(v);
  }));

  const groups = linkHolders(read, { creator, busy });
  const linkedOwners = new Set(groups.flatMap((g) => g.owners));
  const linked = read.filter((h) => linkedOwners.has(h.owner));
  const snipers = read.filter((h) => h.sniper);
  const sum = (list) => list.reduce((s, h) => s + h.pct, 0);
  return {
    ok: true,
    at: Date.now(),
    launch: launchS || null,
    read: read.filter((h) => h.read).length,
    traced: read.filter((h) => h.traced).length,
    devPct: devRow ? (devRow.amount / supply) * 100 : null,
    holders: read.map((h) => ({ ...h, linked: linkedOwners.has(h.owner) })),
    groups,
    linked: { wallets: linked.length, pct: sum(linked) },
    snipers: { wallets: snipers.length, pct: sum(snipers) },
  };
}
