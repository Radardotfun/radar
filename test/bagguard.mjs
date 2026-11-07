// Bag Guard (extension/src/lib/bagguard.js), offline: what a wallet holds, which holdings are bags, and when a look at a bag
// becomes an alert. node test/bagguard.mjs
import assert from 'node:assert/strict';
import { walletHoldings, pickBags, lookAtBag, provedWallet, terminalUrl, setMuted, TOKEN_PROGRAMS, BAG_MIN_USD, MAX_BAGS, MAX_MUTED } from '../extension/src/lib/bagguard.js';

const W1 = 'WaLLet1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const COIN = 'Coin111111111111111111111111111111111111pump';
const C2 = 'Coin222222222222222222222222222222222222pump';
const SOL = 'So11111111111111111111111111111111111111112';
const acct = (mint, uiAmount) => ({ account: { data: { parsed: { info: { mint, tokenAmount: { uiAmount } } } } } });

// ---- holdings: both token programs, SOL and empty accounts left out, a failed read throws
{
  const asked = [];
  const rpc = async (method, params) => {
    asked.push(params[1].programId);
    return params[1].programId === TOKEN_PROGRAMS[0]
      ? { value: [acct(COIN, 1000), acct(SOL, 3), acct(C2, 0)] }
      : { value: [acct(COIN, 500)] };
  };
  const h = await walletHoldings(W1, rpc);
  assert.deepEqual(asked, TOKEN_PROGRAMS, 'both token programs (Token-2022 too: newer pump coins use it)');
  assert.deepEqual([...h], [[COIN, 1500]], 'amounts add up across accounts; SOL and empty accounts are not bags');
  await assert.rejects(walletHoldings(W1, async () => { throw new Error('rpc'); }), 'no answer is not "holds nothing"');
}

// ---- bags: priced, $5 and up, biggest first, capped
{
  const holdings = new Map([[COIN, { amount: 1000, wallets: new Set([W1]) }], [C2, { amount: 10, wallets: new Set([W1]) }]]);
  const tokens = { [COIN]: { chain: 'solana', symbol: 'COIN', priceUsd: 0.05, liquidity: 20000, pair: 'PairA', marketCap: 50000 }, [C2]: { chain: 'solana', symbol: 'TWO', priceUsd: 0.1 } };
  const bags = pickBags(holdings, tokens);
  assert.equal(bags.length, 1, '$1 of TWO is dust');
  assert.equal(bags[0].value, 50);
  assert.deepEqual(bags[0].wallets, [W1]);
  const many = new Map(Array.from({ length: 20 }, (_, i) => [`M${i}`, { amount: 100 + i, wallets: new Set([W1]) }]));
  const priced = Object.fromEntries([...many.keys()].map((m) => [m, { chain: 'solana', symbol: m, priceUsd: 1 }]));
  const top = pickBags(many, priced);
  assert.equal(top.length, MAX_BAGS);
  assert.equal(top[0].symbol, 'M19', 'biggest first');
  assert.ok(BAG_MIN_USD === 5);
}

const bag = (o = {}) => ({ mint: COIN, symbol: 'COIN', value: 50, priceUsd: 0.05, liquidity: 20000, onCurve: false, pair: 'PairA', ...o });
const rep = (o = {}) => ({ source: 'rugcheck', rugged: false, freezeAuthority: null, mintAuthority: null, risks: [], score: 10, holders: 900, topHolder: { pct: 4 }, top10Pct: 30, insiderPct: 10, creatorPct: 4, top: Array.from({ length: 12 }, (_, i) => ({ owner: `Owner${i}`, pct: i === 0 ? 6 : 2 - i * 0.1 })), ...o });

// ---- the first look says nothing, whatever it finds
{
  const r = lookAtBag(bag(), { report: rep({ freezeAuthority: 'Freeze111' }), lc: { checked: true, verdict: 'LARP' } });
  assert.deepEqual(r.events, [], 'a coin bought like that is not news');
  assert.equal(r.state.serious, 'freeze authority is on');
  assert.equal(r.status, 'Watch: freeze authority is on', 'but the panel shows it');
}

// ---- the dev sells half or more of their peak: one alert
{
  let s = lookAtBag(bag(), { report: rep() }).state;
  let r = lookAtBag(bag(), { report: rep({ creatorPct: 3 }) }, s);
  assert.deepEqual(r.events, [], '4% -> 3% is not half');
  r = lookAtBag(bag(), { report: rep({ creatorPct: 1.5 }) }, r.state);
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].reason, 'dev');
  assert.match(r.events[0].text, /dev of \$COIN sold 2\.5% of supply \(held 4\.0%, now 1\.5%\)/);
  r = lookAtBag(bag(), { report: rep({ creatorPct: 0 }) }, r.state);
  assert.deepEqual(r.events, [], 'once');
  // a dev with almost nothing selling it is not news
  s = lookAtBag(bag(), { report: rep({ creatorPct: 0.2 }) }).state;
  assert.deepEqual(lookAtBag(bag(), { report: rep({ creatorPct: 0 }) }, s).events, []);
}

// ---- insiders dumping
{
  const s = lookAtBag(bag(), { report: rep({ insiderPct: 20 }) }).state;
  const r = lookAtBag(bag(), { report: rep({ insiderPct: 8 }) }, s);
  assert.deepEqual(r.events.map((e) => e.reason), ['insiders']);
  assert.match(r.events[0].text, /Insiders in \$COIN sold 12% of supply/);
}

// ---- a top holder exits; dropping off a long list counts only when the list's floor is already low
{
  const s = lookAtBag(bag(), { report: rep() }).state;
  assert.deepEqual(Object.keys(s.top), ['Owner0'], 'only wallets with 3%+ are tracked');
  const gone = rep({ top: Array.from({ length: 12 }, (_, i) => ({ owner: `Other${i}`, pct: 1.5 - i * 0.1 })) });
  const r = lookAtBag(bag(), { report: gone }, s);
  assert.deepEqual(r.events.map((e) => e.reason), ['whale'], 'off a list whose smallest is 0.4%: sold out');
  assert.match(r.events[0].text, /A top holder of \$COIN \(Owne…ner0, 6\.0%\) sold out/);
  assert.deepEqual(lookAtBag(bag(), { report: gone }, r.state).events, [], 'once');
  const short = rep({ top: [{ owner: 'X1', pct: 5 }, { owner: 'X2', pct: 4 }] });
  assert.deepEqual(lookAtBag(bag(), { report: short }, s).events, [], 'a short list says nothing about who left it');
  const trimmed = lookAtBag(bag(), { report: rep({ top: [{ owner: 'Owner0', pct: 1.5 }, ...rep().top.slice(1)] }) }, s);
  assert.match(trimmed.events[0].text, /sold down to 1\.5%/);
}

// ---- the holder check turning serious, and Larpcheck's verdict turning
{
  let s = lookAtBag(bag(), { report: rep(), lc: { checked: true, verdict: 'REAL' } }).state;
  let r = lookAtBag(bag(), { report: rep({ mintAuthority: 'Mint1111' }), lc: { checked: true, verdict: 'LARP' } }, s);
  assert.deepEqual(r.events.map((e) => e.reason).sort(), ['holders', 'verdict']);
  assert.ok(r.events.some((e) => e.text === '$COIN: mint authority is on'));
  assert.ok(r.events.some((e) => e.text === 'Larpcheck now says LARP on $COIN'));
  assert.deepEqual(lookAtBag(bag(), { report: rep({ mintAuthority: 'Mint1111' }), lc: { checked: true, verdict: 'LARP' } }, r.state).events, [], 'the same flag again is not news');
  // a caution (few holders) is not serious
  s = lookAtBag(bag(), { report: rep() }).state;
  assert.deepEqual(lookAtBag(bag(), { report: rep({ holders: 40 }) }, s).events, []);
  // no report this run: nothing changes
  r = lookAtBag(bag(), {}, s);
  assert.deepEqual(r.events, []);
  assert.equal(r.state.serious, s.serious);
}

// ---- liquidity pulled, as opposed to a price fall
{
  const s = lookAtBag(bag({ liquidity: 20000, priceUsd: 1 }), {}).state;
  assert.equal(s.liqBase, 20000);
  // price -75%: a pool's depth falls to about half on its own
  assert.deepEqual(lookAtBag(bag({ liquidity: 10500, priceUsd: 0.25 }), {}, s).events, [], 'a dump is not a pull');
  // depth -80% with price -10%: pulled
  const r = lookAtBag(bag({ liquidity: 4000, priceUsd: 0.9 }), {}, s);
  assert.deepEqual(r.events.map((e) => e.reason), ['liquidity']);
  assert.match(r.events[0].text, /down 80%, far more than its price/);
  assert.deepEqual(lookAtBag(bag({ liquidity: 3000, priceUsd: 0.9 }), {}, r.state).events, [], 'once');
  // a tiny pool is too noisy to judge; a coin on its curve has no pool
  const tiny = lookAtBag(bag({ liquidity: 1500, priceUsd: 1 }), {}).state;
  assert.deepEqual(lookAtBag(bag({ liquidity: 100, priceUsd: 1 }), {}, tiny).events, []);
  const curve = lookAtBag(bag({ onCurve: true, liquidity: 0 }), {}).state;
  assert.deepEqual(lookAtBag(bag({ onCurve: true, liquidity: 0 }), {}, curve).events, []);
  // graduating from the curve to a pool starts the pool's watch from its first look
  const grad = lookAtBag(bag({ liquidity: 30000, priceUsd: 1 }), {}, curve).state;
  assert.equal(grad.liqBase, 30000);
}

// ---- the wallet in a holder token, and the terminal link
{
  const body = Buffer.from(JSON.stringify({ a: W1, exp: 1 })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.equal(provedWallet(`${body}.signature`), W1);
  assert.equal(provedWallet(''), null);
  assert.equal(provedWallet('garbage.x'), null);
  assert.equal(terminalUrl(bag()), 'https://axiom.trade/meme/PairA?chain=sol');
  assert.equal(terminalUrl(bag({ pair: null })), `https://dexscreener.com/solana/${COIN}`);
}

// ---- muting a bag: newest first, no repeats, capped, and unmuting only removes that coin
{
  assert.deepEqual(setMuted(null, 'A', true), ['A']);
  assert.deepEqual(setMuted(['A'], 'B', true), ['B', 'A']);
  assert.deepEqual(setMuted(['B', 'A'], 'A', true), ['A', 'B'], 'muting again moves it to the front, once');
  assert.deepEqual(setMuted(['A', 'B'], 'A', false), ['B']);
  assert.deepEqual(setMuted(['B'], 'Z', false), ['B'], 'unmuting a coin that was never muted changes nothing');
  assert.deepEqual(setMuted([1, '', 'B'], 'C', true), ['C', 'B'], 'junk in storage is dropped');
  const many = Array.from({ length: MAX_MUTED }, (_, i) => 'M' + i);
  assert.equal(setMuted(many, 'new', true).length, MAX_MUTED);
  assert.equal(setMuted(many, 'new', true)[0], 'new');
}

console.log('PASS bagguard: holdings, bags, and each alert once, never on the first look');
