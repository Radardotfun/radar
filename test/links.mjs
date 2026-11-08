// Wallet links and snipers (extension/src/lib/links.js) and how the coin check shows them. node test/links.mjs
import assert from 'node:assert/strict';
import { funderOf, isWallet, tokensFrom, linkHolders, walletLinks } from '../extension/src/lib/links.js';
import { curveOf } from '../extension/src/lib/devrecord.js';
import { coinCheck, linksSub, linksKnown } from '../extension/src/ui/coincheck.js';

// Real-looking addresses: mints and wallets are keys (on the curve), a bonding curve is a program address (off it).
const W = (n) => ['BTmeAebSh8MaYsTDiBiix79htKckjYQP5fvucFoFpump', 't9bnCGiZVUYsRKvx4d5dPcoDCSyuBM9C33ZNGNULARP', '2j5SaS7xy776qCBpyPQbZjyQSAtKiFgrwjfErthnW2ZM', 'GKTeJV8dKUpp2wKYfjSbMrF1BhAiC3nSn3bHMa3zjSet', 'HGE5K8mQtD7zYGfTCimkPRQ7HLKuefS26Z58XNxzuWuf', '9GpJDZrgXvGXxGjffCZhhYfyLyZ94QTezQoipn74pump', 'Fwu1Fwpxi3zuk6BwYdJoD6HpjUkjjHgKJ5EPhbTopump', '8MHHRJvpbXwCYKKdHRitEMpTVejFgtJGeUD8r8DPpump', 'ctMpaPiXjiUN86BoYbdE1G5QtjvTjkdyBbGkZHepump', 'AFfoew4h79qV3HSdCA19LQM6CimNpznBaY7jjpuXpump'][n];
const MINT = '75VDY6P9kJyAp7QGYRzq7o85oKBSXpR9XmaWVHcspump';
const curve = await curveOf(MINT);

// ---- who funded a wallet
const transfer = (source, destination) => ({ program: 'system', parsed: { type: 'transfer', info: { source, destination, lamports: 5e7 } } });
assert.equal(funderOf({ transaction: { message: { accountKeys: [{ pubkey: 'F' }], instructions: [transfer('F', 'A')] } } }, 'A'), 'F', 'the SOL sent to it');
assert.equal(funderOf({ transaction: { message: { accountKeys: ['P'], instructions: [] } }, meta: { innerInstructions: [{ instructions: [{ program: 'system', parsed: { type: 'createAccount', info: { source: 'G', newAccount: 'A' } } }] }] } }, 'A'), 'G', 'or the account that created it, inside another program');
assert.equal(funderOf({ transaction: { message: { accountKeys: [{ pubkey: 'P' }], instructions: [{ program: 'spl-token', parsed: { type: 'transfer', info: {} } }] } } }, 'A'), 'P', 'with no SOL in, whoever paid the fee');
assert.equal(funderOf({ transaction: { message: { accountKeys: [{ pubkey: 'A' }], instructions: [] } } }, 'A'), null, 'a wallet that paid for itself has no funder');

// ---- pools and curves are no holders
assert.equal(isWallet(W(0)), true, 'a key is a wallet');
assert.equal(isWallet(curve), false, 'a bonding curve is a program account');
assert.equal(isWallet('1nc1nerator11111111111111111111111111111111'), false, 'the burn address never counts');
assert.equal(isWallet('not an address'), false);

// ---- where a holder's first coins came from
const bal = (i, owner, amount) => ({ accountIndex: i, mint: MINT, owner, uiTokenAmount: { amount: String(amount) } });
const moved = (pre, post) => ({ meta: { preTokenBalances: pre, postTokenBalances: post } });
assert.equal(tokensFrom(moved([bal(1, curve, 900)], [bal(1, curve, 800), bal(2, W(0), 100)]), MINT, W(0)), 'buy', 'paid out of the curve: a buy');
assert.equal(tokensFrom(moved([bal(1, W(1), 500)], [bal(1, W(1), 400), bal(2, W(0), 100)]), MINT, W(0)), W(1), "another wallet's balance went down: sent");
assert.equal(tokensFrom(moved([bal(1, W(1), 500)], [bal(2, W(0), 500)]), MINT, W(0)), W(1), 'a sender whose account closed in the same move');
assert.equal(tokensFrom(moved([bal(1, W(1), 500), bal(3, W(2), 50)], [bal(1, W(1), 400), bal(3, W(2), 0), bal(2, W(0), 150)]), MINT, W(0)), null, 'two senders: no single one to name');
assert.equal(tokensFrom(moved([], [bal(2, W(0), 100)]), MINT, W(0)), null, 'minted to it: no sender at all');

// ---- linking
const h = (owner, pct, more = {}) => ({ owner, pct, read: true, ...more });
let g = linkHolders([h('a', 5, { funder: 'F' }), h('b', 3, { funder: 'F' }), h('c', 2, { funder: 'G' })]);
assert.equal(g.length, 1);
assert.deepEqual([g[0].kinds, g[0].owners, g[0].pct, g[0].by], [['same funder'], ['a', 'b'], 8, 'F'], 'two wallets paid by one wallet are linked');
assert.equal(linkHolders([h('a', 5, { funder: 'F' }), h('b', 3, { funder: 'F' })], { busy: new Set(['F']) }).length, 0, 'an exchange paying two strangers is no link');
g = linkHolders([h('a', 5, { funder: 'b' }), h('b', 4, { funder: 'Z' })]);
assert.deepEqual([g[0].kinds, g[0].owners.sort()], [['funded each other'], ['a', 'b']], 'a top wallet paying another');
g = linkHolders([h('a', 9, { sentBy: 'b' }), h('b', 3)]);
assert.deepEqual([g[0].kinds, g[0].pct], [['tokens sent'], 12], 'a top wallet handing coins to another');
g = linkHolders([h('a', 2, { sentBy: 'S' }), h('b', 2, { sentBy: 'S' }), h('c', 2, { sentBy: 'T' })]);
assert.deepEqual([g.length, g[0].kinds, g[0].owners], [1, ['tokens sent'], ['a', 'b']], 'one outside wallet sending to two');
g = linkHolders([h('a', 2, { firstTx: 'tx1' }), h('b', 2, { firstTx: 'tx1' }), h('c', 2, { firstTx: 'tx2' })]);
assert.deepEqual([g[0].kinds, g[0].owners], [['one transaction'], ['a', 'b']], 'first coins in one transaction');
g = linkHolders([h('a', 5, { funder: 'DEV' }), h('b', 1, { sentBy: 'DEV' }), h('c', 1, { funder: 'X' })], { creator: 'DEV' });
assert.deepEqual([g.length, g[0].dev, g[0].kinds, g[0].owners], [1, true, ['coins from the dev', 'funded by the dev'], ['a', 'b']], 'the dev paying one, or handing it coins, is enough');
g = linkHolders([h('a', 4, { funder: 'F', sentBy: 'c' }), h('b', 3, { funder: 'F' }), h('c', 2)]);
assert.deepEqual([g.length, g[0].kinds, g[0].owners.sort()], [1, ['same funder', 'tokens sent'], ['a', 'b', 'c']], 'ties of different kinds join one group');
assert.equal(linkHolders([h('a', 5, { read: false }), h('b', 4, { read: false })]).length, 0, 'unread wallets are never linked');

// ---- the whole read, against a stand-in chain
const LAUNCH = 1_794_000_000;
const DEV = W(7);
// owner, share, how it got its first coins, its first funder (fresh wallets), when it got them, a busy wallet's history.
const holders = [
  { owner: W(0), amount: 60_000_000, got: 'buy', tx: 'bundle', funder: 'F1', at: LAUNCH + 1 }, // 6%, bundle buy
  { owner: W(1), amount: 40_000_000, got: 'buy', tx: 'bundle', at: LAUNCH + 1, old: true }, // 4%, same bundle, an old wallet
  { owner: W(2), amount: 30_000_000, got: 'buy', funder: 'EXCH', at: LAUNCH + 600 }, // 3%, paid by an exchange
  { owner: W(3), amount: 20_000_000, got: 'buy', funder: 'EXCH', at: LAUNCH + 9 }, // 2%, paid by the same exchange, a sniper
  { owner: W(4), amount: 15_000_000, got: W(2), at: LAUNCH + 3000, old: true }, // 1.5%, coins handed over by W(2)
  { owner: W(5), amount: 9_000_000, got: DEV, at: LAUNCH + 4000, old: true }, // 0.9%, coins from the dev
  { owner: W(6), amount: 8_000_000, got: 'buy', at: LAUNCH + 50, coinOld: true, old: true }, // 0.8%, history too long to read
  { owner: DEV, amount: 50_000_000, got: 'buy', at: LAUNCH }, // the dev itself
];
function chain({ busy = {}, failing = new Set() } = {}) {
  const calls = [];
  const accounts = holders.map((x, i) => ({ address: `TA${i}`, amount: String(x.amount) }));
  const full = (n, t0) => Array.from({ length: n }, (_, i) => ({ signature: `old${i}`, blockTime: t0 - i * 900, err: null }));
  const rpc = async (method, params) => {
    calls.push(method);
    if (method === 'getTokenLargestAccounts') return { value: [{ address: 'TAcurve', amount: '500000000' }, ...accounts] };
    if (method === 'getAccountInfo') return { value: { data: { parsed: { info: { supply: '1000000000' } } } } };
    if (method === 'getMultipleAccounts') return { value: params[0].map((a) => ({ data: { parsed: { info: { owner: a === 'TAcurve' ? curve : holders[Number(a.slice(2))].owner } } } })) };
    if (method === 'getSignaturesForAddress') {
      const [addr, { limit }] = params;
      if (failing.has(addr)) throw new Error('429');
      if (busy[addr]) return Array.from({ length: limit }, (_, i) => ({ signature: `b${i}`, blockTime: LAUNCH - i * 5, err: null })); // 1,000 in under 2 hours
      if (addr.startsWith('TA')) {
        const x = holders[Number(addr.slice(2))];
        if (x.coinOld) return full(limit, LAUNCH + 9e5);
        return [{ signature: `sell-${addr}`, blockTime: x.at + 99, err: null }, { signature: x.tx || `coin-${addr}`, blockTime: x.at, err: null }];
      }
      const x = holders.find((y) => y.owner === addr);
      if (!x) return [];
      if (x.old) return full(limit, LAUNCH);
      return [{ signature: `later-${addr}`, blockTime: LAUNCH + 50, err: null }, { signature: `failed-${addr}`, blockTime: LAUNCH - 90, err: { x: 1 } }, { signature: `first-${addr}`, blockTime: LAUNCH - 100, err: null }];
    }
    if (method === 'getTransaction') {
      const sig = params[0];
      if (sig.startsWith('first-')) {
        const owner = sig.slice(6);
        const f = holders.find((y) => y.owner === owner).funder;
        return { transaction: { message: { accountKeys: [{ pubkey: f }], instructions: [transfer(f, owner)] } } };
      }
      // The coin's first move into a holder: bought from the curve (the bundle buys for two), or handed over by a wallet.
      const takers = sig === 'bundle' ? holders.filter((y) => y.tx === 'bundle') : [holders[Number(sig.replace('coin-TA', ''))]];
      const from = takers[0].got === 'buy' ? curve : takers[0].got;
      return moved([bal(0, from, 1e9)], [bal(0, from, 5e8), ...takers.map((y, i) => bal(i + 1, y.owner, y.amount))]);
    }
    throw new Error(`unexpected ${method}`);
  };
  return { rpc, calls };
}

const { rpc, calls } = chain({ busy: { EXCH: true } });
const l = await walletLinks(rpc, MINT, { creator: DEV, launchS: LAUNCH });
const row = (n) => l.holders.find((x) => x.owner === W(n));
assert.equal(l.ok, true);
assert.equal(l.launch, LAUNCH);
assert.equal(l.holders.length, 7, 'the curve and the dev are left out of the top wallets');
assert.ok(!l.holders.some((x) => x.owner === curve || x.owner === DEV));
assert.equal(l.devPct, 5, "the dev's own share is kept apart");
assert.equal(l.read, 6, 'every wallet but the one with a history too long');
assert.equal(row(6).read, false);
assert.equal(row(0).funder, 'F1', 'the first transaction that went through, not a failed one');
assert.equal(row(1).traced, false, 'an old wallet has no funder read');
assert.equal(row(4).sentBy, W(2));
assert.equal(row(0).bought, true);
assert.deepEqual(l.groups.map((x) => [x.kinds.join('+'), x.owners.length]), [['one transaction', 2], ['tokens sent', 2], ['coins from the dev', 1]]);
assert.ok(!row(3).linked, 'the exchange-paid pair is not linked by that');
assert.equal(row(2).linked, true, 'but W(2) handed coins to W(4)');
assert.equal(Math.round(l.linked.pct * 10) / 10, 15.4, 'bundle 10% + hand-over 4.5% + the dev-sent 0.9%');
assert.equal(l.linked.wallets, 5);
assert.deepEqual(l.holders.filter((x) => x.sniper).map((x) => x.owner).sort(), [W(0), W(1), W(3)].sort(), 'first coins within 10 seconds');
assert.equal(Math.round(l.snipers.pct * 10) / 10, 12);
assert.ok(calls.filter((m) => m === 'getSignaturesForAddress').length <= 7 * 2 + 2, 'two history reads a wallet, one a shared wallet');

// A shared wallet Radar couldn't read is never a link.
const shaky = await walletLinks(chain({ failing: new Set(['EXCH']) }).rpc, MINT, { creator: DEV, launchS: LAUNCH });
assert.ok(!shaky.holders.find((x) => x.owner === W(3)).linked);

// Without a launch time there is no sniper read at all.
const noLaunch = await walletLinks(chain({ busy: { EXCH: true } }).rpc, MINT, { creator: DEV });
assert.equal(noLaunch.launch, null);
assert.equal(noLaunch.snipers.wallets, 0);

// ---- in the coin check
const rug = { insiderPct: 0, insiderWallets: 0, top10Pct: 20, freezeAuthority: null, mintAuthority: null, poolTokens: 2e8, supplyTokens: 1e9 };
const bundle = { ok: true, bundledPct: 3, bundleHeldPct: 0.5, devBoughtPct: 0, devHeldPct: 0 };
const token = { onCurve: true };
const base = coinCheck(token, rug, bundle);
const c = coinCheck(token, rug, bundle, l);
const fact = (cc, k) => cc.facts.find((f) => f.k === k);
assert.equal(fact(c, 'Insiders hold').v, l.linked.pct, 'linked top wallets raise the insider share');
assert.equal(fact(c, 'Insiders hold').sub, '5 linked top wallets');
assert.equal(fact(c, 'Linked top wallets hold').lvl, 'risk');
assert.equal(fact(c, 'Linked top wallets hold').sub, '5 wallets · one transaction, tokens sent, coins from the dev');
assert.equal(fact(c, 'Snipers hold').sub, '3 bought in the first 10 s');
assert.ok(c.score < base.score, 'and cost the score');
assert.match(c.call, /hold 15%/i);
assert.equal(coinCheck(token, rug, bundle, { ok: false }).facts.length, base.facts.length, 'a failed trace changes nothing');
assert.equal(fact(coinCheck(token, rug, bundle, noLaunch), 'Snipers hold'), undefined, 'no launch time, no sniper line');

const clean = { ...l, groups: [], holders: l.holders.map((x) => ({ ...x, linked: false })), linked: { wallets: 0, pct: 0 }, snipers: { wallets: 0, pct: 0 } };
assert.equal(linksSub(clean), 'none of the top 7 · 6 read');
assert.equal(coinCheck(token, rug, bundle, clean).score, base.score, 'a clean trace costs nothing');
// Mostly unread: "none linked" would be a claim Radar can't back, so the card says what it couldn't read instead.
const blind = { ...clean, read: 2 };
assert.equal(linksKnown(blind), false);
const cb = coinCheck(token, rug, bundle, blind);
assert.equal(fact(cb, 'Linked top wallets hold'), undefined);
assert.equal(fact(cb, 'Linked top wallets').text, "5 of the top 7 couldn't be read");
assert.equal(fact(cb, 'Insiders hold').v, base.facts.find((f) => f.k === 'Insiders hold').v, 'and it adds nothing to insiders');
assert.doesNotMatch(cb.call, /couldn't be read/, 'a line with no level never becomes the one-line call');
assert.equal(linksKnown({ ...l, read: 1 }), true, 'a link found always counts, however little was read');

console.log('links ok');
