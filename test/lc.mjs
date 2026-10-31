// Offline: what Radar keeps from Larpcheck's API, and when a verdict alert fires. node test/lc.mjs
import assert from 'node:assert/strict';
import { rowView, boardFrom, handleView, holdersView, checkView, hasPlan } from '../server/lc.js';
import { verdictTurned, RISK_WORDS } from '../extension/src/lib/alerts.js';
import { botReply } from '../bot/reply.js';

const A = 'HyDSdtgiSa5mHqkTVoz8cTFTeVLFKdZ8amPvtNYfpump';
const row = (over = {}) => ({ id: 'abc123', url: 'https://larpcheck.app/c/abc123', status: 'done', verdict: 'LIKELY LARP', score: 22, total: 30, title: 'A coin', call: 'One line', coin: A, kind: 'coin', input: A, ...over });

assert.equal(rowView(row()).verdict, 'LIKELY LARP');
assert.equal(rowView(row({ status: 'running' })), null, 'an unfinished check is not shown');
assert.equal(rowView(row({ verdict: 'MAYBE' })), null, 'only their own verdict words');
assert.equal(rowView(row({ url: 'https://evil.example/c/1' })), null, 'a verdict must link to its check on their site');
assert.ok(!/[<>]/.test(rowView(row({ title: '<script>x' })).title), 'no markup');
assert.equal(boardFrom([row(), row({ coin: 'nope' }), row({ status: 'error' })]).length, 1, 'the board only lists finished coin checks');
assert.equal(boardFrom(Array.from({ length: 20 }, () => row())).length, 6);
console.log('PASS lc: only finished verdicts linked to their check are shown');

const post = (handle, n, verdict) => row({ kind: 'post', input: `https://x.com/${handle}/status/${n}`, verdict });
const who = handleView([post('Lightberry', 1, 'LARP'), post('lightberry', 2, 'REAL'), post('other', 3, 'SCAM'), post('lightberry', 4, 'LIKELY LARP')], 'lightberry');
assert.equal(who.checked, 3, "only the account's own posts count, whatever the case");
assert.equal(who.risky, 2);
assert.equal(who.rows.length, 3);
assert.equal(handleView(null, 'x').checked, 0);
console.log('PASS lc: an account has only its own posts counted');

const panel = { holders: { status: 'ready', summary: { holders: 32, top10Pct: 37.7 }, reading: { verdict: 'organic', line: 'No insiders or cabal; top 10 hold 20%' } } };
const seen = holdersView(panel, '0xabc');
assert.equal(seen.holders, 32);
assert.equal(seen.ok, true);
assert.equal(seen.page, 'https://larpcheck.app/0xabc');
assert.equal(holdersView({ holders: { ...panel.holders, reading: { verdict: 'rug', line: 'x' } } }, '0xabc').ok, false);
assert.deepEqual(holdersView({ holders: { status: 'scanning' } }, '0xabc'), { ready: false }, 'nothing until the panel is ready');
assert.deepEqual(holdersView(null, '0xabc'), { ready: false });
console.log('PASS lc: holder data keeps their reading and links to their page');

assert.equal(hasPlan({ apiPlan: null }), false, "today's free key offers no paid features");
assert.equal(hasPlan({ apiPlan: { name: 'starter' } }), true);
assert.equal(checkView({ id: 'a1b2', status: 'running', progress: { last: 'Reading the site' } }).step, 'Reading the site');
assert.equal(checkView({ id: 'a1b2', status: 'running' }).lc, null);
assert.ok(checkView({ id: 'a1b2', status: 'error' }).error);
const finished = checkView({ id: 'a1b2', status: 'done', url: 'https://larpcheck.app/c/a1b2', verdict: { verdict: 'REAL', score: 90, total: 88, call: 'c', headline: 'h', stamps: [{ id: 'story', word: 'REAL', score: 90 }] } });
assert.equal(finished.lc.verdict, 'REAL');
assert.equal(finished.lc.url, 'https://larpcheck.app/c/a1b2');
assert.equal(finished.lc.total, 88);
console.log('PASS lc: paid features stay off without a plan, and a finished check reads as a verdict');

assert.equal(verdictTurned('UNCLEAR', 'LARP'), true, 'a coin turning larp pings');
assert.equal(verdictTurned(null, 'SCAM'), true, 'so does a first verdict that is bad');
assert.equal(verdictTurned('LIKELY LARP', 'LARP'), false, 'already flagged: no second ping');
assert.equal(verdictTurned('LARP', 'REAL'), false, 'only turning bad pings');
assert.equal(verdictTurned('REAL', null), false);
assert.ok(RISK_WORDS.has('SCAM'));
console.log('PASS lc: an alert fires only when a coin turns bad');

const result = { picks: [{ role: 'top', token: { address: A, symbol: 'RADAR', chain: 'solana', marketCap: 12000 } }] };
const url = 'https://x.com/a/status/1';
const larp = { checked: true, verdict: 'LIKELY LARP', total: 30, score: 22, url: 'https://larpcheck.app/c/abc123' };
const withLarp = botReply(result, url, 0, { links: true, larp });
assert.match(withLarp, /Larpcheck on RADAR: LIKELY LARP 30\nhttps:\/\/larpcheck\.app\/c\/abc123$/);
assert.equal((withLarp.match(/\$[A-Za-z]/g) || []).length, 1, 'X allows one cashtag a post');
assert.ok(withLarp.indexOf('tryradar.fun/scan') < withLarp.indexOf('larpcheck.app'), 'the scan stays first, so X previews its card');
assert.ok(!botReply(result, url, 0, { links: true }).includes('Larpcheck'), 'no verdict, no line');
assert.ok(!botReply(result, url, 0, { links: true, larp: { checked: false, page: 'https://larpcheck.app/x' } }).includes('Larpcheck'));
assert.ok(!botReply(result, url, 0, { links: true, larp: { ...larp, url: 'https://evil.example/x' } }).includes('Larpcheck'), 'it must link to their check');
assert.ok(!botReply(result, url, 0, { larp }).includes('Larpcheck'), 'a reply with no links can show no verdict: their terms need the link');
console.log('PASS lc: a bot reply names the verdict only with its link');

const { bioCas, tiedToBio } = await import('../bot/coins.js');
const CA = 'HyDSdtgiSa5mHqkTVoz8cTFTeVLFKdZ8amPvtNYfpump';
assert.deepEqual(bioCas({ bio: `building. CA: ${CA}` }), [CA]);
assert.deepEqual(bioCas({ bio: 'no address, just vibes 0x12' }), []);
assert.deepEqual(bioCas({}), []);
const coin = (over = {}) => ({ address: CA, symbol: 'CASHCAT', name: 'Cash Cat', socials: [], ...over });
assert.equal(tiedToBio(coin(), { author: 'someguy' }, ['news', 'markets']), false, "a coin in a bio, on an unrelated post, isn't this post's coin");
assert.equal(tiedToBio(coin(), { author: 'someguy' }, ['cashcat', 'memes']), true, 'the post uses its name');
assert.equal(tiedToBio(coin(), { author: 'someguy' }, [], ['CASHCAT']), true, 'the post types its ticker');
assert.equal(tiedToBio(coin(), { author: 'someguy' }, ['cashcat'], ['OTHER']), false, 'the post types a different ticker');
assert.equal(tiedToBio(coin(), { author: 'cashcat_token' }, []), true, "the account is the coin's own");
assert.equal(tiedToBio(coin({ socials: [{ type: 'twitter', url: 'https://x.com/someguy' }] }), { author: 'someguy' }, []), true, "the coin's links name this account");
assert.equal(tiedToBio(coin({ socials: [{ type: 'twitter', url: 'https://x.com/someguy2' }] }), { author: 'someguy' }, []), false, 'a longer handle is another account');
assert.equal(tiedToBio(null, { author: 'x' }, []), false);
console.log("PASS bot: a CA in a bio counts only when it's tied to the post");

const { botReply: reply } = await import('../bot/reply.js');
const bioReply = reply({ named: { address: CA, symbol: 'CASHCAT', chain: 'solana', marketCap: 50000 }, how: 'bio', picks: [] }, 'https://x.com/a/status/1', 0);
assert.match(bioReply, /In the poster's bio/);
console.log('PASS bot: the reply says the coin came from the bio');

{
  const { botCoins } = await import('../bot/coins.js');
  const BIO = '8HpiWGZXcWGNBFrXHR56UcYiUp99BeqZkfXe4iQppump';
  const OTHER = 'ch7rTovcUK7C1zNFM7F93kXU2CByYUsJT4pwYx7pump';
  const big = { address: OTHER, symbol: 'PP', name: 'Official PPshow', chain: 'solana', marketCap: 1_330_000, mcapBacked: true, liquidity: 90000, volume: { h24: 90000 }, createdAt: 1, relevance: 95 };
  const small = { address: BIO, symbol: 'PP', name: 'Pump Pump', chain: 'solana', marketCap: 400, mcapBacked: false, volume: { h24: 0 } };
  const post = { author: 'pumppumpuranus', text: 'Two tokens: Pump Pump ($PP) and King Cheddar ($KCD).', bio: `Official token: Pump Pump ($PP). CA: ${BIO}` };
  const run = (p, lookupBio) => botCoins({ roleCandidates: [big], anchors: [], terms: [] }, p, { search: async () => [], lookupCa: async () => null, lookupBio, chains: ['solana'] });
  const r1 = await run(post, async (ca) => (ca === BIO ? small : null));
  assert.equal(r1.named?.address, BIO, "the poster's own coin beats a bigger coin with the same ticker");
  assert.equal(r1.how, 'bio');
  const r2 = await run({ ...post, bio: 'no address here' }, async () => null);
  assert.notEqual(r2.how, 'bio', 'with no CA in the bio, nothing changes');
  const r3 = await run({ author: 'newsdesk', text: 'A big day for markets and the Fed.', bio: `my coin ${BIO}` }, async () => small);
  assert.equal(r3.named, null, "an unrelated post doesn't name the coin in its poster's bio");
  console.log("PASS bot: the poster's own coin wins over a bigger one with the same ticker");
}
