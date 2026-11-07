// The tag bot's larp check (bot/reply.js larpMode, larpReply): a post that names its coin gets Radar's read of the story
// on that coin; a narrative post gets the coins. node test/larp-reply.mjs
import assert from 'node:assert/strict';
import { larpMode, larpReply, botReply, varied, xLength, LARP_WORDS } from '../bot/reply.js';
import { wantsCoins } from '../bot/trigger.js';

const CA = 'Dacity1111111111111111111111111111111111pump';
const named = { address: CA, symbol: 'DACITY', name: 'Dacity Coin', chain: 'solana', marketCap: 48_200, volume: { h24: 90_000 }, createdAt: Date.now() - 3600e3 };
const now = Date.parse('2026-11-07T15:20:00Z');

// ---- which posts get the larp check: the coin's CA or $TICKER is in the post itself
assert.equal(larpMode({ named, how: 'post' }), true);
for (const how of ['picture', 'bio', 'linked']) assert.equal(larpMode({ named, how }), false, `${how}: a narrative post, the coins`);
assert.equal(larpMode({ named: null, how: null, picks: [{ role: 'top', token: named }] }), false, 'no named coin: the coins');
assert.equal(larpMode(null), false);

// ---- the reply
const check = {
  word: 'LIKELY LARP', score: 28, call: 'The "official launch" site was registered this week and the coin links to @someoneelse, not the author.',
  findings: [
    { kind: 'risk', text: 'Account created 3 days ago, presented as an established studio' },
    { kind: 'missing', text: 'No product behind the site: see https://dacity.example and $OTHER' },
    { kind: 'works', text: 'Contract posted by the author' },
    { kind: 'info', text: 'A fourth finding that does not fit' },
  ],
};
const text = larpReply({ named, how: 'post' }, check, now);
assert.equal(text, [
  'Larp check on $DACITY (15:20 UTC):',
  '🧪 LIKELY LARP · 28/100',
  'The "official launch" site was registered this week and the coin links to someoneelse, not the author.',
  '',
  '⚠️ Account created 3 days ago, presented as an established studio',
  '❔ No product behind the site: see and OTHER',
  '✅ Contract posted by the author',
  '',
  '📌 In the post: DACITY · $48.2K',
  CA,
  '',
  "Radar's read of the evidence, not advice. Full scan + Insta Buy: link in bio",
].join('\n'));
assert.equal((text.match(/\$[A-Za-z]/g) || []).length, 1, 'one cashtag: X refuses more');
assert.ok(!/@\w|https?:\/\//.test(text), 'nothing from the AI can mention anyone or post a link');
assert.ok(xLength(text) < 700);
// Duplicates get seconds, like the coins reply.
assert.match(varied(text, new Date(now + 7000)), /^Larp check on \$DACITY \(15:20:07 UTC\):/);
// Short form: the contract shortened on the coin's line.
const short = larpReply({ named, how: 'post' }, check, now, { full: false });
assert.match(short, /📌 In the post: DACITY · \$48\.2K · Daci…pump\n\nRadar's read/);
assert.ok(!short.includes(CA));
// A long call ends on a whole word; no findings, no gap; every verdict word is Radar's own scale.
const long = larpReply({ named: { ...named, chain: 'bsc' }, how: 'post' }, { word: 'REAL', score: 90, call: 'word '.repeat(60), findings: [] }, now);
assert.match(long.split('\n')[2], /^(word ){20,}word…$/);
assert.match(long, /\n\n📌 In the post: DACITY · \$48\.2K · BNB\n/);
assert.ok(!/\n\n\n/.test(long));
assert.deepEqual([...LARP_WORDS], ['REAL', 'LIKELY REAL', 'PARTLY REAL', 'UNCLEAR', 'LIKELY LARP', 'LARP']);
// No usable read: null, and the bot sends the coins.
assert.equal(larpReply({ named, how: 'post' }, null, now), null);
assert.equal(larpReply({ named, how: 'post' }, { word: 'SCAM', score: 1 }, now), null, 'a word off the scale is not used');
assert.equal(larpReply({ named: null }, check, now), null);
assert.ok(botReply({ named, how: 'post', picks: [] }, 'https://x.com/a/status/1', now).startsWith('Coins on this post'), 'the coins reply is unchanged');

// ---- asking for it counts as a request
const mention = (text) => ({ text: `@radardotfunn ${text}`, display_text_range: [0, [...`@radardotfunn ${text}`].length], entities: { mentions: [{ username: 'radardotfunn', start: 0, end: 13 }] } });
assert.equal(wantsCoins(mention('larp check this one please, the dev says it is a real game studio'), 'radardotfunn').ok, true);
assert.equal(wantsCoins(mention('hey is this legit? my friend keeps shilling it in the group chat all day'), 'radardotfunn').ok, true);
assert.equal(wantsCoins(mention('is it real or not, they say the team is doxxed and the game ships friday'), 'radardotfunn').ok, true);
assert.equal(wantsCoins(mention('i really like what you guys are building over there, keep going and good luck'), 'radardotfunn').ok, false, 'conversation stays conversation');

console.log('PASS larp-reply: larp check for posts naming their coin, coins for narrative posts, nothing from the AI can mention or link');
