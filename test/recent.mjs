// Offline: the panel's Recent list. node test/recent.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addRecent, recentItem, MAX_RECENT } from '../extension/src/ui/recent.js';

const res = { mentioned: [], picks: [{ token: { symbol: 'WIF' } }] };
const row = (q, t = 1) => recentItem({ asked: q, narrative: 'A dog in a hat', res, now: t });

assert.deepEqual(row('https://x.com/a/status/1', 5), { q: 'https://x.com/a/status/1', k: 'Search', l: 'A dog in a hat', c: 'WIF', t: 5 });
assert.equal(recentItem({ asked: 'x', res: { mentioned: [{ symbol: 'BONK' }], picks: [{ token: { symbol: 'WIF' } }] } }).c, 'BONK', 'a coin in the post comes first');
assert.equal(recentItem({ asked: 'x', source: { kind: 'Trend', label: 'Halloween' }, res }).l, 'Halloween', 'the source names it when no narrative was read');
assert.equal(recentItem({ asked: 'x', source: { kind: 'Trend', label: 'Halloween' }, res }).k, 'Trend');
assert.equal(recentItem({ asked: 'x', res: { mentioned: [], picks: [] } }), null, 'a scan with no coin is not kept');
assert.equal(recentItem({ asked: '  ', res }), null, 'nothing to scan again');
assert.equal(recentItem({ asked: 'q'.repeat(900), res }).q.length, 300);
console.log('PASS recent: a row names the coin and what to scan again');

let list = [];
list = addRecent(list, row('a', 1));
list = addRecent(list, row('b', 2));
assert.deepEqual(list.map((r) => r.q), ['b', 'a'], 'newest first');
list = addRecent(list, row('a', 3));
assert.deepEqual(list.map((r) => [r.q, r.t]), [['a', 3], ['b', 2]], 'scanning again moves the row up, with no second row');
assert.equal(addRecent(list, null), list, 'no row, no change');
for (let i = 0; i < 20; i++) list = addRecent(list, row(`q${i}`));
assert.equal(list.length, MAX_RECENT);
assert.equal(list[0].q, 'q19');
console.log('PASS recent: the list stays short and has no repeats');

// On X the panel loads as a module from src/ui only (manifest web_accessible_resources): a lib/ import would stop it opening.
const panel = readFileSync(new URL('../extension/src/ui/radar.js', import.meta.url), 'utf8');
const outside = [...panel.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]).filter((p) => !p.startsWith('./'));
assert.deepEqual(outside, [], 'the panel imports from ui/ only');
console.log('PASS recent: the panel only imports what it can load on X');

const { scansOnPaste } = await import('../extension/src/ui/radar.js');
for (const yes of ['https://x.com/a/status/123', ' https://twitter.com/a/status/123?s=20 ', 'HyDSdtgiSa5mHqkTVoz8cTFTeVLFKdZ8amPvtNYfpump', '0x21CFCFc3d8F98fC728f48341D10Ad8283F6EB7AB']) assert.ok(scansOnPaste(yes), yes);
for (const no of ['', null, 'halloween', 'a dog in a hat', 'https://x.com/a', '0x21CF', 'https://example.com/a/status/123', 'check HyDSdtgiSa5mHqkTVoz8cTFTeVLFKdZ8amPvtNYfpump']) assert.ok(!scansOnPaste(no), String(no));
console.log('PASS paste: a post link or a CA scans by itself, other words wait for Enter');

const { launchedVsPost } = await import('../extension/src/ui/radar.js');
const LUMI_POST = 'https://x.com/lightberry/status/2116326790033781021';
const posted = Number((2116326790033781021n >> 22n) + 1288834974657n);
assert.equal(new Date(posted).toISOString().slice(0, 10), '2026-10-31', "a post id gives the post's time");
assert.equal(launchedVsPost(posted + 8 * 60_000, LUMI_POST), '8m after the post');
assert.equal(launchedVsPost(posted - 3 * 3_600_000, LUMI_POST), '3h before the post');
assert.equal(launchedVsPost(posted + 5_000, LUMI_POST), '1m after the post', 'under a minute reads as 1m');
assert.equal(launchedVsPost(posted, null), null, 'a search has no post');
assert.equal(launchedVsPost(null, LUMI_POST), null, 'no launch time, no line');
console.log('PASS launched vs post: reads the time from the post id');

const { postTimeOf } = await import('../extension/src/ui/radar.js');
assert.equal(postTimeOf(LUMI_POST), posted);
assert.equal(postTimeOf('halloween'), null, 'no post, no time');
assert.equal(postTimeOf(undefined), null);
console.log('PASS post time: read from the post link, none on a search');
