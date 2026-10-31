// Offline: Larpcheck's holder read standing in for RugCheck, and an account's own coin in the bot's reply. node test/standin.mjs
import assert from 'node:assert/strict';
import { standInReport } from '../extension/src/lib/rugcheck.js';
import { reportBlock } from '../extension/src/ui/holdercheck.js';
import { coinCheck } from '../extension/src/ui/coincheck.js';
import { botCoins, ownCoin } from '../bot/coins.js';

const organic = { ready: true, holders: 2067, top10: 20.2, verdict: 'organic', line: 'No insiders or cabal; top 10 hold 20%', ok: true, page: 'https://larpcheck.app/x' };
const rpc = (info) => async () => ({ value: { data: { parsed: { info } } } });
const clean = { mintAuthority: null, freezeAuthority: null, supply: '1000' };

const good = await standInReport('m', async () => organic, rpc(clean));
assert.equal(good.source, 'larpcheck');
assert.equal(good.holders, 2067);
assert.equal(good.top10Pct, 20.2);
assert.equal(reportBlock(good), null, 'a clean coin passes without a RugCheck score');
assert.equal(await standInReport('m', async () => ({ ready: false }), rpc(clean)), null, 'no read yet is no report');
assert.equal(await standInReport('m', async () => { throw new Error('down'); }, rpc(clean)), null);

assert.equal(reportBlock(await standInReport('m', async () => organic, rpc({ ...clean, freezeAuthority: 'abc' }))), 'freeze authority is on');
assert.equal(reportBlock(await standInReport('m', async () => organic, rpc({ ...clean, mintAuthority: 'abc' }))), 'mint authority is on');
assert.equal(reportBlock(await standInReport('m', async () => organic, async () => { throw new Error('rpc down'); })), 'mint and freeze authority unknown', "unknown authorities never pass");
assert.equal(reportBlock(await standInReport('m', async () => ({ ...organic, ok: false, line: 'Cabal holds 40%' }), rpc(clean))), 'Larpcheck: Cabal holds 40%', "Larpcheck's words, unchanged");
assert.equal(reportBlock(await standInReport('m', async () => ({ ...organic, holders: 40 }), rpc(clean))), 'only 40 holders');
assert.equal(reportBlock(await standInReport('m', async () => ({ ...organic, top10: 71 }), rpc(clean))), 'top 10 hold 71%');
const checked = coinCheck({ onCurve: false, liquidity: 80_000 }, good, null);
assert.equal(checked.score, 100, 'an LP lock nobody reported costs nothing');
assert.ok(!checked.facts.some((f) => f.k === 'Liquidity'), 'and is not shown as 0%');
assert.ok(coinCheck({ onCurve: false, liquidity: 80_000 }, { ...good, lpLockedPct: 10 }, null).facts.some((f) => f.k === 'Liquidity'), 'a real low lock still shows');
console.log('PASS holder data: Larpcheck stands in for RugCheck, and an unknown still never passes');

const coin = (symbol, name, marketCap, extra = {}) => ({ symbol, name, address: `${symbol}${marketCap}mint`, chain: 'solana', marketCap, mcapBacked: true, liquidity: 9000, volume: { h24: 5000 }, relevance: 0, ...extra });
const hackinu = coin('Hackinu', 'Hack Inu', 3900);
const cashcat = coin('CASHCAT', 'Cash Cat', 92_000_000, { relevance: 70 });
const dust = coin('Inkyy', 'Inkyy', 3100, { relevance: 95 });
const elon = coin('ELONMUSK', 'Elon Musk', 300_000, { relevance: 85 });
const small = { followers: 900 };

assert.ok(ownCoin(hackinu, { author: 'HackInu4meme', ...small }));
assert.ok(ownCoin(cashcat, { author: 'cashcatss', ...small }));
assert.ok(!ownCoin(elon, { author: 'elonmusk', followers: 200_000_000 }), 'a famous name is not its own coin');
assert.ok(!ownCoin(hackinu, { author: 'HackInu4meme' }), 'an unknown following does not count');
assert.ok(!ownCoin(coin('ANSEM', 'Ansem', 5000), { author: 'blknoiz06', ...small }));
assert.ok(!ownCoin(coin('CAT', 'Cat', 5000), { author: 'cat', ...small }), 'three letters are too common');

const none = { search: async () => [] };
const own = await botCoins({ mentioned: [], picks: [], roleCandidates: [], pool: [hackinu] }, { text: 'The job is never done', author: 'HackInu4meme', ...small }, none);
assert.deepEqual(own.picks.map((p) => p.token.symbol), ['Hackinu'], "a project's own coin leads, even small and unjudged");
const noise = await botCoins({ mentioned: [], picks: [], roleCandidates: [cashcat, dust] }, { text: 'we rejected Binance', author: 'cashcatss', ...small }, none);
assert.deepEqual(noise.picks.map((p) => p.token.symbol), ['CASHCAT'], 'dust beside the own coin stays out');
console.log('PASS bot: an account\'s own coin is named, a famous name is not treated as one');
