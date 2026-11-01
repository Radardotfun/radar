// Which warnings count as serious on a card, and how the larp check's line is shortened, offline. node test/panel-rules.mjs
import assert from 'node:assert/strict';
import { seriousWarning, reportBlock } from '../extension/src/ui/holdercheck.js';
import { shortCall, normaliseStory } from '../server/story.js';

for (const line of ['liquidity pulled', 'freeze authority is on', 'mint authority is on', 'RugCheck flags large amount of lp unlocked', "The pool's money was taken out: holders can't sell for anything", 'Larpcheck: this one rugged']) assert.equal(seriousWarning(line), true, line);
for (const line of ['only 14 holders', 'not trading', 'RugCheck score 40', 'top 10 hold 60%', 'Insiders hold 15%', 'no RugCheck score', 'thin liquidity for its market cap', '', null]) assert.equal(seriousWarning(line), false, String(line));
// The rules' own words stay serious, so a change of wording there can't quietly turn the red off.
assert.equal(seriousWarning(reportBlock({ rugged: true })), true);
assert.equal(seriousWarning(reportBlock({ freezeAuthority: 'x' })), true);
assert.equal(seriousWarning(reportBlock({ risks: [{ name: 'Large Amount of LP Unlocked', level: 'danger' }] })), true);
console.log('PASS panel: serious warnings are told from cautions');

const short = 'Meta robot news is plausible but unverified here.';
assert.equal(shortCall(short), short);
assert.equal(shortCall(null), '');
const real = 'Meta robot news is plausible but unverified here; MAX coin has no official links, so treat its tie to the story as unofficial.';
assert.equal(shortCall(real), real, 'the line that used to be cut mid-word now fits');
const long = `${'The first sentence is here and it runs on for a good while longer. '}${'and then this goes on and on without stopping '.repeat(6)}`;
assert.equal(shortCall(long), 'The first sentence is here and it runs on for a good while longer.');
const words = 'word '.repeat(80);
const cut = shortCall(words);
assert.ok(cut.endsWith('word…') && cut.length <= 181, cut);
assert.equal(normaliseStory({ word: 'PARTLY REAL', score: 40, call: real }).call, real);
console.log('PASS panel: the larp check line ends on a whole word');
