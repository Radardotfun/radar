// The tag bot's larp check (bot/reply.js larpMode, larpReply; bot/coinscore.js): a post that names its coin gets the
// story and the coin scored, a narrative post gets the coins. node test/larp-reply.mjs
import assert from 'node:assert/strict';
import { larpMode, larpReply, botReply, varied, xLength, LARP_WORDS } from '../bot/reply.js';
import { coinScore, totalScore, COIN_WORDS, tokenFromJupiter } from '../bot/coinscore.js';
import { wantsCoins } from '../bot/trigger.js';

const CA = 'Dacity1111111111111111111111111111111111pump';
const named = { address: CA, symbol: 'DACITY', name: 'Dacity Coin', chain: 'solana', marketCap: 48_200, volume: { h24: 90_000 }, createdAt: Date.now() - 3600e3 };
const now = Date.parse('2026-11-07T15:20:00Z');

// ---- which posts get the larp check: the coin's CA or $TICKER is in the post itself
assert.equal(larpMode({ named, how: 'post' }), true);
for (const how of ['picture', 'bio', 'linked']) assert.equal(larpMode({ named, how }), false, `${how}: a narrative post, the coins`);
assert.equal(larpMode({ named: null, how: null, picks: [{ role: 'top', token: named }] }), false, 'no named coin: the coins');
assert.equal(larpMode(null), false);

// ---- the coin half, from Jupiter's audit
const asset = (o = {}, audit = {}) => ({ id: CA, launchpad: 'pump.fun', graduatedPool: 'Pool1', holderCount: 420, liquidity: 14_000, organicScoreLabel: 'medium',
  audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true, topHoldersPercentage: 18, botHoldersPercentage: 4, sniperPct: 2, devBalancePercentage: 0, devMints: 2, devMigrations: 1, ...audit }, ...o });
let c = coinScore(asset());
assert.deepEqual(c, { score: 100, word: 'HEALTHY', flags: [], line: '420 holders · top holders 18% · snipers 2.0% · bots 4.0% · dev holds 0.0% · dev made 2 coins, 1 bonded' });
c = coinScore(asset({ holderCount: 30, liquidity: 800 }, { freezeAuthorityDisabled: false, topHoldersPercentage: 62, sniperPct: 24, devMints: 140, devMigrations: 3 }));
assert.equal(c.word, 'RISKY');
assert.equal(c.score, 0);
assert.deepEqual(c.flags.slice(0, 3), ['Freeze is still on: wallets can be frozen', 'The dev wallet has launched 140 coins', 'Top holders hold 62%'], 'worst first');
assert.ok(c.flags.includes('Thin liquidity: $800') && c.flags.includes('Only 30 holders') && c.flags.includes('Snipers hold 24%'));
// A coin still on its launch curve has no pool to pull: low liquidity costs nothing there.
assert.deepEqual(coinScore(asset({ graduatedPool: undefined, liquidity: 900 })).flags, []);
assert.equal(coinScore(asset({}, { devMints: 1 })).line.endsWith("the dev's first coin"), true);
assert.equal(coinScore(asset({}, { devMints: 12, devMigrations: 0 })).word, 'FAIR', 'a serial launcher costs points');
assert.equal(coinScore(asset({ organicScoreLabel: 'low' }, { botHoldersPercentage: 15 })).score, 84);
assert.equal(coinScore(null), null);
assert.equal(coinScore({ id: CA }), null, 'no audit, no coin half');
assert.deepEqual(COIN_WORDS.map(([, w]) => w), ['HEALTHY', 'FAIR', 'MIXED', 'RISKY']);
assert.equal(totalScore(24, { score: 52 }), 38);
assert.equal(totalScore(40, { score: 45 }), 43);
assert.equal(totalScore(66, null), 66, 'no coin half: the story alone');

// ---- the reply, both halves
const check = {
  word: 'PARTLY REAL', score: 40, call: 'The studio is real, but its own site never names this coin; the tie is @someoneelse\'s claim, not the studio\'s.',
  findings: [
    { kind: 'risk', text: 'Account created 3 days ago, presented as an established studio' },
    { kind: 'missing', text: 'Studio never names the coin: see https://dacity.example and $OTHER' },
    { kind: 'works', text: 'Contract posted by the author' },
    { kind: 'info', text: 'Not shown' },
  ],
};
const coin = coinScore(asset({ holderCount: 40 }, { topHoldersPercentage: 41, sniperPct: 5.5, devBalancePercentage: 5 }));
assert.deepEqual([coin.score, coin.word], [78, 'HEALTHY']);
const text = larpReply({ named, how: 'post' }, check, now, { coin });
assert.equal(text, [
  'Larp check on $DACITY (15:20 UTC):',
  '🧪 59/100 · story PARTLY REAL 40 · coin HEALTHY 78',
  "The studio is real, but its own site never names this coin; the tie is someoneelse's claim, not the studio's.",
  '',
  '⚠️ Account created 3 days ago, presented as an established studio',
  '⚠️ Top holders hold 41%',
  '⚠️ Only 40 holders',
  '❔ Studio never names the coin: see and OTHER',
  '✅ Contract posted by the author',
  '',
  '👥 40 holders · top holders 41% · snipers 5.5% · bots 4.0% · dev holds 5.0% · dev made 2 coins, 1 bonded',
  '',
  '📌 In the post: DACITY · $48.2K',
  CA,
  '',
  "Story: do the post's claims hold up. Coin: holders, dev, liquidity. A high score is no promise against a rug. Not advice.",
  'Full scan + Insta Buy: link in bio',
].join('\n'));
assert.equal((text.match(/\$[A-Za-z]/g) || []).length, 1, 'one cashtag: X refuses more');
assert.ok(!/@\w|https?:\/\//.test(text), 'nothing from the AI can mention anyone or post a link');
assert.ok(xLength(text) < 900, `length ${xLength(text)}`);
assert.match(varied(text, new Date(now + 7000)), /^Larp check on \$DACITY \(15:20:07 UTC\):/);
// Short form: the contract shortened on the coin's line.
const short = larpReply({ named, how: 'post' }, check, now, { full: false, coin });
assert.match(short, /📌 In the post: DACITY · \$48\.2K · Daci…pump\n\nStory:/);
assert.ok(!short.includes(CA));

// ---- the story alone (a coin on another chain, or no audit)
const alone = larpReply({ named: { ...named, chain: 'bsc' }, how: 'post' }, { word: 'REAL', score: 90, call: 'word '.repeat(60), findings: [] }, now);
assert.match(alone, /^Larp check on \$DACITY \(15:20 UTC\):\n🧪 90\/100 · story REAL 90\nWord (word ){20,}word…\n\n📌 In the post: DACITY · \$48\.2K · BNB\n/);
assert.ok(alone.endsWith("Radar's read of the evidence, not advice.\nFull scan + Insta Buy: link in bio"));
assert.ok(!/\n\n\n/.test(alone) && !alone.includes('👥'));
assert.deepEqual([...LARP_WORDS], ['REAL', 'LIKELY REAL', 'PARTLY REAL', 'UNCLEAR', 'LIKELY LARP', 'LARP']);
// No usable story read: null, and the bot sends the coins.
assert.equal(larpReply({ named, how: 'post' }, null, now, { coin }), null);
assert.equal(larpReply({ named, how: 'post' }, { word: 'SCAM', score: 1 }, now), null, 'a word off the scale is not used');
assert.equal(larpReply({ named: null }, check, now), null);
assert.ok(botReply({ named, how: 'post', picks: [] }, 'https://x.com/a/status/1', now).startsWith('Coins on this post'), 'the coins reply is unchanged');

// ---- a coin DexScreener doesn't list (a Raydium LaunchLab coin on its curve): Jupiter's record, in the shape replies read
{
  const a = { id: 'Grey1111111111111111111111111111111111grey', symbol: '$GREY', name: 'Greymarket', launchpad: 'raydium-launchlab', bondingCurve: 41, mcap: 13_830, liquidity: 9000, usdPrice: 0.0000138,
    firstPool: { id: 'Pool1', createdAt: '2026-11-07T14:40:00Z' }, stats24h: { buyVolume: 30_000, sellVolume: 12_000, numBuys: 400, numSells: 150 }, stats1h: { buyVolume: 9000, sellVolume: 4000, numBuys: 90, numSells: 40, priceChange: 12 } };
  const tk = tokenFromJupiter(a);
  assert.equal(tk.symbol, 'GREY');
  assert.equal(tk.chain, 'solana');
  assert.equal(tk.onCurve, true);
  assert.equal(tk.marketCap, 13_830);
  assert.deepEqual(tk.volume, { m5: 0, h1: 13_000, h6: 0, h24: 42_000 });
  assert.deepEqual(tk.txns.h24, { buys: 400, sells: 150 });
  assert.equal(tk.createdAt, Date.parse('2026-11-07T14:40:00Z'));
  assert.equal(tk.mcapBacked, true, 'on its curve and trading');
  assert.equal(tokenFromJupiter({ ...a, graduatedPool: 'Amm1', bondingCurve: 100, liquidity: 50 }).mcapBacked, false, 'graduated with a thin pool');
  assert.equal(tokenFromJupiter(null), null);
  // It reads as the post's coin in a larp check.
  const greyReply = larpReply({ named: tk, how: 'post' }, check, now);
  assert.ok(greyReply.startsWith('Larp check on $GREY (15:20 UTC):'));
  assert.ok(greyReply.includes('\n📌 In the post: GREY · $13.8K\n'));
}

// ---- the call says what the evidence shows, never what to do
for (const [said, shown] of [
  ["Avoid: 0-day-old unverified author, no coin website or X link.", '0-day-old unverified author, no coin website or X link.'],
  ['avoid this, the account is 4 days old', 'The account is 4 days old'],
  ['Ape: the dev is the official account', 'The dev is the official account'],
  ['Skip - nothing checkable', 'Nothing checkable'],
  ['Available on the official site, author is the brand', 'Available on the official site, author is the brand'],
]) assert.equal(larpReply({ named, how: 'post' }, { ...check, call: said }, now).split('\n')[2], shown, said);

// ---- asking for it counts as a request
const mention = (text) => ({ text: `@radardotfunn ${text}`, display_text_range: [0, [...`@radardotfunn ${text}`].length], entities: { mentions: [{ username: 'radardotfunn', start: 0, end: 13 }] } });
assert.equal(wantsCoins(mention('larp check this one please, the dev says it is a real game studio'), 'radardotfunn').ok, true);
assert.equal(wantsCoins(mention('hey is this legit? my friend keeps shilling it in the group chat all day'), 'radardotfunn').ok, true);
assert.equal(wantsCoins(mention('is it real or not, they say the team is doxxed and the game ships friday'), 'radardotfunn').ok, true);
assert.equal(wantsCoins(mention('i really like what you guys are building over there, keep going and good luck'), 'radardotfunn').ok, false, 'conversation stays conversation');

console.log('PASS larp-reply: story and coin scored for posts naming their coin, coins for narrative posts, nothing from the AI can mention or link');
