// The tag bot's larp check (bot/reply.js larpMode, larpReply; bot/coinscore.js): a post that names its coin gets the
// story and the coin scored, a narrative post gets the coins. node test/larp-reply.mjs
import assert from 'node:assert/strict';
import { larpMode, larpReply, larpcheckReply, larpcheckOk, botReply, varied, xLength, LARP_WORDS, postLarpReply, tradeLink, hasTradeLine, withoutTradeLine } from '../bot/reply.js';
import { coinScore, totalScore, COIN_WORDS, tokenFromJupiter } from '../bot/coinscore.js';
import { wantsCoins, climbFrom, hasCa } from '../bot/trigger.js';
import { nameHistory, coinHandle, historyLines, HISTORY_MS } from '../bot/history.js';

const CA = 'Dacity1111111111111111111111111111111111pump';
const named = { address: CA, symbol: 'DACITY', name: 'Dacity Coin', chain: 'solana', marketCap: 48_200, volume: { h24: 90_000 }, createdAt: Date.now() - 3600e3 };
const now = Date.parse('2026-11-07T15:20:00Z');

// ---- which posts get the larp check: the coin's CA or $TICKER is in the post itself
assert.equal(larpMode({ named, how: 'post' }), true);
for (const how of ['picture', 'bio', 'linked']) assert.equal(larpMode({ named, how }), true, `${how}: the coin tied to the post gets the larp check too`);
assert.equal(larpMode({ named: null, how: null, picks: [{ role: 'top', token: named }] }), false, 'no coin tied to the post: the post alone is checked');
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
  `📈 Trade on Jupiter (best price across its pools): https://jup.ag/tokens/${CA}`,
  '',
  "Story: do the post's claims hold up. Coin: holders, dev, liquidity. A high score is no promise against a rug. Not advice.",
  'Full scan + Insta Buy: link in bio',
].join('\n'));
assert.equal((text.match(/\$[A-Za-z]/g) || []).length, 1, 'one cashtag: X refuses more');
assert.ok(!/@\w/.test(text), 'nothing from the AI can mention anyone');
assert.deepEqual(text.match(/https?:\/\/\S+/g), [`https://jup.ag/tokens/${CA}`], "the one link is Radar's trade link: nothing from the AI posts one");
assert.ok(xLength(text) < 900, `length ${xLength(text)}`);
assert.match(varied(text, new Date(now + 7000)), /^Larp check on \$DACITY \(15:20:07 UTC\):/);
// Short form: the contract shortened on the coin's line.
const short = larpReply({ named, how: 'post' }, check, now, { full: false, coin });
assert.match(short, /📌 In the post: DACITY · \$48\.2K · Daci…pump\n📈 Trade on Jupiter \(best price across its pools\): https:\/\/jup\.ag\/tokens\/\S+\n\nStory:/);
assert.ok(!short.replace(/https:\/\/\S+/g, '').includes(CA), 'the short form never writes the address out (only inside its trade link)');

// ---- where the coin trades best: its deepest pool picks the place, and each link opens on that coin
{
  const s = (o) => tradeLink({ address: CA, chain: 'solana', ...o });
  assert.deepEqual(s({ dexId: 'pumpfun' }), { url: `https://pump.fun/coin/${CA}`, venue: 'pump.fun', note: 'still on its curve' });
  assert.deepEqual(s({ dexId: 'pumpswap' }), { url: `https://pump.fun/coin/${CA}`, venue: 'pump.fun', note: 'its deepest pool is on PumpSwap' });
  for (const dexId of ['raydium', 'meteora', 'orca', 'launchlab', undefined]) assert.equal(s({ dexId }).url, `https://jup.ag/tokens/${CA}`, String(dexId));
  const hood = '0x' + 'ab'.repeat(20);
  assert.equal(tradeLink({ address: hood, chain: 'robinhood' }).url, `https://app.uniswap.org/swap?chain=robinhood&outputCurrency=${hood}`);
  assert.equal(tradeLink({ address: hood, chain: 'bsc', url: `https://dexscreener.com/bsc/${hood}` }).url, `https://dexscreener.com/bsc/${hood}`);
  assert.equal(tradeLink({ address: hood, chain: 'bsc', url: 'https://evil.example/x' }), null, 'only a DexScreener page, never a link from elsewhere');
  assert.equal(tradeLink({ address: 'not a mint!', chain: 'solana' }), null);
  assert.equal(tradeLink(null), null);
  const pump = larpReply({ named: { ...named, dexId: 'pumpfun' }, how: 'post' }, check, now, { coin });
  assert.ok(pump.includes(`\n${CA}\n📈 Trade on pump.fun (still on its curve): https://pump.fun/coin/${CA}\n\n`), pump);
  assert.ok(xLength(pump) < 900, `length ${xLength(pump)}`);
  // When X turns a reply with a link down, the bot sends it once more without the trade line, and nothing else changes.
  assert.equal(hasTradeLine(pump), true);
  const bare = withoutTradeLine(pump);
  assert.equal(hasTradeLine(bare), false);
  assert.ok(bare.includes(`\n${CA}\n\nStory:`), bare);
  assert.equal(bare, pump.replace(`\n📈 Trade on pump.fun (still on its curve): https://pump.fun/coin/${CA}`, ''));
  assert.equal(withoutTradeLine(varied(pump, new Date(now + 3000))).includes('📈'), false, 'after the time is varied too');
  assert.equal(hasTradeLine(postLarpReply({ word: 'LARP', score: 10, call: 'x', findings: [] }, now)), false, 'no coin, no trade link');
}

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

// ---- Larpcheck first: their verdict when their API has one, credited and linked; otherwise Radar's own check
{
  // The shape Radar's /larpcheck route returned for $GREY on 7 Nov.
  const lc = { checked: true, url: 'https://larpcheck.app/c/CQ2HTrific', verdict: 'LIKELY LARP', score: 24, total: 38,
    headline: 'A long headline that is not shown', call: 'Brand tie unconfirmed, nothing behind the coin; 75 holders, dev holds 0%. See $OTHER @someone https://x.co',
    stamps: [{ id: 'story', word: 'LIKELY LARP', score: 24 }, { id: 'coin', word: 'NEUTRAL', score: 52 }] };
  const r = larpcheckReply({ named, how: 'post' }, lc, now);
  assert.equal(r, [
    'Larpcheck on $DACITY (15:20 UTC):',
    '🧪 38/100 · story LIKELY LARP 24 · coin NEUTRAL 52',
    'Brand tie unconfirmed, nothing behind the coin; 75 holders, dev holds 0%. See OTHER someone',
    '',
    '📌 In the post: DACITY · $48.2K',
    CA,
    `📈 Trade on Jupiter (best price across its pools): https://jup.ag/tokens/${CA}`,
    '',
    "Larpcheck's full report: https://larpcheck.app/c/CQ2HTrific",
    'Full scan + Insta Buy: link in bio',
  ].join('\n'));
  assert.equal((r.match(/\$[A-Za-z]/g) || []).length, 1, 'one cashtag');
  assert.deepEqual(r.match(/https?:\/\/\S+/g), [`https://jup.ag/tokens/${CA}`, 'https://larpcheck.app/c/CQ2HTrific'], 'the trade link and their report link, nothing from their text');
  assert.match(varied(r, new Date(now + 4000)), /^Larpcheck on \$DACITY \(15:20:04 UTC\):/);
  assert.match(larpcheckReply({ named, how: 'post' }, lc, now, { full: false }), /DACITY · \$48\.2K · Daci…pump\n📈 Trade on Jupiter[^\n]+\n\nLarpcheck's full report/);
  // Older answers without stamps: their verdict and score.
  assert.match(larpcheckReply({ named, how: 'post' }, { checked: true, url: 'https://larpcheck.app/c/x1', verdict: 'REAL', score: 81 }, now), /\n🧪 story REAL 81\n/);
  // Anything else is not their verdict, and Radar's check answers instead.
  assert.equal(larpcheckOk({ checked: false, page: 'https://larpcheck.app/abc', running: false }), false, 'nobody has checked it');
  assert.equal(larpcheckOk(null), false, 'no answer in time');
  assert.equal(larpcheckOk({ ...lc, url: 'https://evil.example/c/x' }), false, 'a link that is not theirs');
  assert.equal(larpcheckOk({ ...lc, verdict: '<b>rigged</b>' }), false);
  assert.equal(larpcheckReply({ named: null }, lc, now), null);
  assert.equal(larpcheckReply({ named, how: 'post' }, { checked: false }, now), null);
}

// ---- a tag with a contract is a request to check that coin, like a larp check bot
assert.equal(hasCa(`look ${CA} now`), true);
assert.equal(hasCa('0x8231fdc77207Ede2455259e2d391Eb4f026581f4'), true);
assert.equal(hasCa('no address here, just words and a $TICKER'), false);
{
  const tag = (text) => ({ text, display_text_range: [0, [...text].length], entities: { mentions: [{ username: 'radardotfunn', start: text.indexOf('@radardotfunn'), end: text.indexOf('@radardotfunn') + 13 }] } });
  assert.deepEqual(wantsCoins(tag(`@radardotfunn ${CA}`), 'radardotfunn'), { ok: true, ca: true });
  assert.deepEqual(wantsCoins(tag(`${CA} @radardotfunn what do you think of this one, the dev says it is a game studio`), 'radardotfunn'), { ok: true, ca: true }, 'longer than a bare tag, still a request');
  assert.equal(wantsCoins(tag('@radardotfunn'), 'radardotfunn').ca, undefined, 'a bare tag still checks the post above');
}

// ---- past usernames (memory.lol), never slowing the reply
{
  let asked = '', opts = null;
  const fake = (body, ok = true) => async (u, o) => { asked = u; opts = o; return { ok, json: async () => body }; };
  const h = await nameHistory('@Cl0ne_dev', fake({ accounts: [{ id: 1, screen_names: { newname: ['2026-10-30', '2026-11-07'], oldbrand: ['2024-02-01', '2025-05-01'], first: ['2023-01-01', '2024-01-01'] } }] }));
  assert.equal(asked, 'https://api.memory.lol/v1/tw/Cl0ne_dev');
  assert.ok(opts.signal, 'the lookup can be cut off');
  assert.equal(HISTORY_MS, 2500);
  assert.deepEqual(h, { handle: 'Cl0ne_dev', names: ['first', 'oldbrand', 'newname'], changes: 2 }, 'oldest first');
  assert.equal(await nameHistory('x', fake({ accounts: [] })), null, 'an account memory.lol never saw');
  assert.equal(await nameHistory('x', fake({}, false)), null);
  assert.equal(await nameHistory('x', async () => { throw new Error('timeout'); }), null, 'too slow: nothing, not an error');
  assert.equal(await nameHistory('not a handle!', fake({})), null);
  assert.deepEqual(historyLines([{ who: 'The poster', hist: h }, { who: "The coin's X account", hist: { handle: 'cl0ne_DEV', names: ['a', 'b', 'c'], changes: 2 } }, { who: 'x', hist: { handle: 'one', names: ['one'], changes: 0 } }]),
    ['⚠️ The poster has gone by 3 usernames: first → oldbrand → newname'], 'the same account once; one name says nothing');
  assert.deepEqual(historyLines([{ who: 'The poster', hist: { handle: 'z', names: ['old', 'z'], changes: 1 } }]), ['ℹ️ The poster has gone by 2 usernames: old → z']);
  assert.match(historyLines([{ who: 'The poster', hist: { handle: 'z', names: ['a', 'b', 'c', 'd', 'e', 'z'], changes: 5 } }])[0], /6 usernames: a → b → … → e → z$/);
  assert.equal(coinHandle({ socials: [{ type: 'twitter', url: 'https://x.com/NeonStudio' }] }), 'NeonStudio');
  assert.equal(coinHandle({ socials: [], links: ['https://t.me/x', 'https://twitter.com/i/communities/123', 'https://twitter.com/neon_x/status/1'] }), 'neon_x');
  assert.equal(coinHandle({}), null);
}

// ---- both replies carry the account history; no coin list anywhere (larp checks only for now)
{
  const extra = { history: ['⚠️ The poster has gone by 3 usernames: first → oldbrand → newname'] };
  const r1 = larpReply({ named, how: 'post' }, check, now, { coin, ...extra });
  assert.ok(r1.includes('\n\n⚠️ The poster has gone by 3 usernames: first → oldbrand → newname\n\n👥 '), r1);
  assert.equal((r1.match(/\$[A-Za-z]/g) || []).length, 1, 'still one cashtag');
  assert.ok(!/Also on this story/.test(r1));
  const lcv = { checked: true, url: 'https://larpcheck.app/c/x1', verdict: 'REAL', score: 81, total: 70 };
  const r2 = larpcheckReply({ named, how: 'post' }, lcv, now, extra);
  assert.ok(r2.includes('\n\n⚠️ The poster has gone by 3 usernames ') || r2.includes('\n\n⚠️ The poster has gone by 3 usernames:'));
  assert.equal(larpReply({ named, how: 'post' }, check, now, { coin }), larpReply({ named, how: 'post' }, check, now, { coin, history: [] }), 'nothing found, nothing added');
  // A post with no coin tied to it: the larp check of its story alone. No coin list, no contract.
  const pr = postLarpReply({ ...check, call: 'Avoid: the account is 3 days old' }, now, extra);
  assert.ok(pr.startsWith('Larp check on this post (15:20 UTC):\n🧪 story PARTLY REAL 40/100\nThe account is 3 days old\n\n⚠️ Account created 3 days ago'), pr);
  assert.ok(pr.includes('⚠️ The poster has gone by 3 usernames') && pr.endsWith("No coin is tied to this post. Radar's read of the story, not advice."));
  assert.ok(!/\$[A-Za-z]|https?:|@\w/.test(pr) && !/\n\n\n/.test(pr), 'no cashtag, link or mention, no empty gaps');
  assert.equal(postLarpReply(null, now), null);
  assert.equal(postLarpReply({ word: 'SCAM', score: 1 }, now), null);
  assert.ok(xLength(pr) < 700);

}

// ---- a tag under a checker bot's reply or a bare tag climbs to the coin post above
assert.equal(climbFrom({ author: 'Larpcheckbot', text: 'Get Pro to check this one: …', parentId: '2119094080030572768' }), true, "Larpcheckbot's paywall reply");
assert.equal(climbFrom({ author: 'larpcheckbot', text: '$SUNPEAK · TOTAL 50/100 …', parentId: '1' }), true, 'any reply of theirs: the coin is above');
assert.equal(climbFrom({ author: 'mendiyyy', text: '@Larpcheckbot', parentId: '2' }), true, 'a bare tag');
assert.equal(climbFrom({ author: 'a1zenxs', text: '@Larpcheckbot ?', parentId: '3' }), true);
assert.equal(climbFrom({ author: 'DMX7227', text: '@tetrascoreio @SiftscanBot @Larpcheckbot', parentId: '4' }), true, 'several tags, nothing else');
assert.equal(climbFrom({ author: 'x', text: '@Larpcheckbot $GREY', parentId: '5' }), false, 'a tag that names its coin is the post');
assert.equal(climbFrom({ author: 'x', text: `@Larpcheckbot ${CA}`, parentId: '6' }), false);
assert.equal(climbFrom({ author: 'x', text: '@Larpcheckbot', parentId: '7', images: ['https://pbs.twimg.com/a.jpg'] }), false, 'a picture can be the story');
assert.equal(climbFrom({ author: 'x', text: '@Larpcheckbot is this the dev that rugged the cat coin last week', parentId: '8' }), false, 'a real reply is a post of its own');
assert.equal(climbFrom({ author: 'Larpcheckbot', text: 'a post of theirs, not a reply' }), false, 'nothing above it');
assert.equal(climbFrom({ author: 'radardotfunn', text: 'Larp check on $GREY …', parentId: '9' }), false, 'our own posts keep their tip');
assert.equal(climbFrom(null), false);

// ---- asking for it counts as a request
const mention = (text) => ({ text: `@radardotfunn ${text}`, display_text_range: [0, [...`@radardotfunn ${text}`].length], entities: { mentions: [{ username: 'radardotfunn', start: 0, end: 13 }] } });
assert.equal(wantsCoins(mention('larp check this one please, the dev says it is a real game studio'), 'radardotfunn').ok, true);
assert.equal(wantsCoins(mention('hey is this legit? my friend keeps shilling it in the group chat all day'), 'radardotfunn').ok, true);
assert.equal(wantsCoins(mention('is it real or not, they say the team is doxxed and the game ships friday'), 'radardotfunn').ok, true);
assert.equal(wantsCoins(mention('i really like what you guys are building over there, keep going and good luck'), 'radardotfunn').ok, true, 'every typed tag gets a larp check');

console.log('PASS larp-reply: every tag is a larp check (Larpcheck first, Radar backup, the post alone when no coin), CA tags, past usernames, nothing from the AI can mention or link');
