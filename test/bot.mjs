// The Radar bot, offline: OAuth signing against X's published example, and the reply's safety (tickers can't tag
// people or post links, full contracts on their own lines, no URL, one cashtag). node test/bot.mjs
import assert from 'node:assert/strict';
import { oauthHeader } from '../bot/oauth.js';
import { botReply, ticker, shortCa, contract, xLength } from '../bot/reply.js';

// X's documented signing example ("Creating a signature"): the signature must come out exactly.
const header = await oauthHeader('POST', 'https://api.twitter.com/1.1/statuses/update.json?include_entities=true', {
  apiKey: 'xvz1evFS4wEEPTGEFPHBog',
  apiSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
  accessToken: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
  accessSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE',
}, { extra: { status: 'Hello Ladies + Gentlemen, a signed OAuth request!' }, fixed: { nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg', timestamp: '1318622958' } });
assert.match(header, /oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"/, header);

// Tickers: letters and digits only.
assert.equal(ticker('$WIF'), 'WIF');
assert.equal(ticker('@elonmusk'), 'elonmusk', 'no mentions');
assert.equal(ticker('go.to/scam'), 'gotoscam', 'no links');
assert.equal(ticker('e/acc'), 'eacc');
assert.equal(ticker(''), '?');
assert.equal(shortCa('ARiZfq6dK19uNqxWyRudhbM2MswLyYhVUHdndGkffdGc'), 'ARiZ…fdGc');

const now = Date.parse('2026-10-29T12:00:00Z');
const coin = (role, symbol, address, extra) => ({ role, token: { symbol, address, marketCap: 12_200, createdAt: now - 3 * 864e5, volume: { h24: 48_000 }, ...extra } });
const reply = botReply({ picks: [
  coin('top', 'NOWHEEL', '86QepwFpKzt5fS9BugCwt3nwmL67EdkEtpoZ8ZRpump'),
  coin('og', '@Robotaxi', 'F6fwq8zq2c4m5Yf3qzR8Lw1mWk9t7Xb2vNnPpQg9Q2', { createdAt: now - 2.6 * 365 * 864e5 }),
  coin('mover', 'ROBO.TAXI', 'Ey6dZr4q1KxV8nB2mC7wTq9sLpU3fRjHkG5aYpump'),
] }, 'https://x.com/elonmusk/status/2115501119296463056', now);
assert.match(reply, /🏆 Highest MC: \$NOWHEEL · \$12\.2K\n86QepwFpKzt5fS9BugCwt3nwmL67EdkEtpoZ8ZRpump\n/);
assert.match(reply, /🥇 OG: Robotaxi · launched 2\.6y ago\nF6fwq8zq2c4m5Yf3qzR8Lw1mWk9t7Xb2vNnPpQg9Q2\n/);
assert.match(reply, /🔥 Mover: ROBOTAXI · \$48\.0K vol 24h\nEy6dZr4q1KxV8nB2mC7wTq9sLpU3fRjHkG5aYpump\n/);
assert.ok((reply.match(/\$[A-Za-z]/g) || []).length <= 1, 'X allows one cashtag per post');
assert.ok(!/@|https?:|tryradar\.fun/.test(reply), 'no mentions or links in the reply');
assert.equal(contract('ARiZ@fq6.dK19:/'), 'ARiZfq6dK19', 'an address prints as address characters only');
assert.ok(xLength(reply) <= 1000, `a Premium post (${xLength(reply)} characters)`);
assert.equal(botReply({ picks: [] }, 'x'), null);
// Dust is left out: an $18 coin with no volume isn't a pick worth posting.
assert.equal(botReply({ picks: [coin('top', 'SHA', 'AEzZq4b9xYk2mN7pR1sT3uV5wX8yZ0aBcDeFgHftDj', { marketCap: 18, volume: { h24: 0 } })] }, 'x', now), null);
console.log('PASS bot: OAuth signing (X example), tickers, reply format');

// Which mentions get an answer (the bot runs on @radardotfunn). Offsets as X gives them.
import { wantsCoins } from '../bot/trigger.js';
const me = 'radardotfunn';
const post = (text, range, mentions) => ({ text, display_text_range: range, entities: { mentions: mentions.map(([username, start]) => ({ username, start, end: start + username.length + 1 })) } });
// A tag typed under someone's post: "@Bob @radardotfunn" where @Bob is the automatic reply prefix.
assert.equal(wantsCoins(post('@Bob @radardotfunn', [5, 18], [['Bob', 0], ['radardotfunn', 5]]), me).ok, true);
assert.equal(wantsCoins(post('@Bob @radardotfunn coins?', [5, 25], [['Bob', 0], ['radardotfunn', 5]]), me).ok, true);
assert.equal(wantsCoins(post('@radardotfunn what is the ticker on this one, I need to know before it runs', [0, 74], [['radardotfunn', 0]]), me).ok, true);
// A reply under one of our posts: X's automatic "@radardotfunn " prefix sits before the visible text.
assert.equal(wantsCoins(post('@radardotfunn when is the next update coming out guys', [14, 53], [['radardotfunn', 0]]), me).ok, false);
assert.equal(wantsCoins(post('@radardotfunn gm', [14, 16], [['radardotfunn', 0]]), me).ok, false);
// Typed, but a conversation rather than a request.
assert.equal(wantsCoins(post('@Bob honestly @radardotfunn has been my favourite tool this week, great work all', [5, 81], [['Bob', 0], ['radardotfunn', 14]]), me).ok, false);
console.log('PASS bot: answers typed tags, ignores replies under our posts and conversation');

// The coin the post names leads the reply; its copycats and major-ticker coins are left out of the picks.
import { cashtags, pickNamed, botCoins } from '../bot/coins.js';
assert.deepEqual(cashtags('Just aped $PURR - $HYPE rewards, up to $104K, $purr again'), ['PURR']);
assert.deepEqual(cashtags('$VI — Welcome to Vice City'), ['VI']);
const tok = (symbol, name, address, marketCap, extra = {}) => ({ symbol, name, address, chain: 'solana', marketCap, liquidity: marketCap / 10, mcapBacked: true, createdAt: Date.parse('2026-10-01'), volume: { h1: 5000, h24: 50_000 }, txns: { h1: { buys: 10, sells: 5 }, h24: { buys: 100, sells: 50 } }, priceChange: { h1: 5 }, relevance: 95, ...extra });
const superInu = tok('SI', 'Super Inu', 'DEW9dSN6QpWyNthphCpMmAbZP1Q4cEKR9xQXAri98WDP', 12_500_000);
const superAi = tok('SI', 'Super Intelligence', '9aqmJjCnnMQv42TXLk921ceUkN35nea2QP969n1caqjj', 470_000);
assert.equal(pickNamed('SI', [superAi, superInu], 'whales are buying $SI'), superInu, 'the biggest coin with the ticker');
assert.equal(pickNamed('SI', [superAi, superInu], '$SI, Super Intelligence is back'), superAi, 'its name in the post wins');
const dacity = tok('Dacity', 'Dacity Coin', 'nxPqDacity1111111111111111111111111111pump', 7_660_000);
const dacityTiny = tok('Dacity', 'DacityCoin', '2GjQDacity2222222222222222222222222222pump', 4_500);
assert.equal(pickNamed('DACITY', [dacityTiny, dacity], 'Top GTA 6 memes: $DACITY $VICE $JASON $DACITYCOIN $GTA'), dacity, 'another cashtag is not the name written in the post');
assert.equal(pickNamed('DACITY', [dacity, dacityTiny], '$DACITY, the DacityCoin of Vice City'), dacityTiny, 'the name as a word still wins');
const purr = tok('PURR', 'Hypurr', '8RNUw4N655VSrZKuhGdywhbSMDTrheguFPfxbpE2NZHQ', 3_800_000);
const fakes = [tok('PURR', 'Hypurr', 'FakePurr1111111111111111111111111111111pump', 26_000), tok('Hypurr', 'Hypurr', 'FakePurr2222222222222222222222222222222pump', 197_000), tok('HYPE', 'Hype', '98sMhvDwXj1RQi5c5Mndm3vPe9cBqPrbLaufMXFNMh5g', 105_000), tok('HCAT', 'Hyperliquid Cat', 'HCat33333333333333333333333333333333333pump', 90_000, { createdAt: Date.parse('2026-09-01') }), tok('KITTY', 'Red Kitten Crew', 'Kitty4444444444444444444444444444444444pump', 900_000, { relevance: 70 })];
const scan = { mentioned: [purr], picks: [], roleCandidates: fakes };
const coins = await botCoins(scan, { text: 'Just aped $PURR' }, { search: async () => [] });
assert.equal(coins.named, purr);
assert.deepEqual(coins.picks.map((p) => `${p.role}=${p.token.symbol}`), ['top=PURR', 'og=HCAT'], "no fake PURRs, no $HYPE, nothing under the on-story bar; the post's own coin is the Highest MC");
const named = botReply({ ...coins, picks: coins.picks }, 'x', now);
assert.match(named, /^Coins on this post \(\d\d:\d\d UTC\):\n\n📌 In the post \(Highest MC\): \$PURR · \$3\.80M\n8RNUw4N655VSrZKuhGdywhbSMDTrheguFPfxbpE2NZHQ\n\n🥇 OG: HCAT · launched/);
assert.ok((named.match(/\$[A-Za-z]/g) || []).length <= 1, 'still one cashtag');
// A ticker the scan didn't judge is looked up on DexScreener.
const pair = (t) => ({ chainId: 'solana', dexId: 'raydium', pairAddress: `${t.address.slice(0, 20)}pool`, baseToken: { address: t.address, name: t.name, symbol: t.symbol }, quoteToken: { address: 'So11111111111111111111111111111111111111112' }, priceUsd: '1', priceNative: '0.005', liquidity: { usd: t.marketCap / 10, quote: t.marketCap / 2000 }, marketCap: t.marketCap, fdv: t.marketCap, volume: { h24: 50_000 } });
const looked = await botCoins({ mentioned: [], picks: [], roleCandidates: [] }, { text: 'whales accumulated $SI' }, { search: async (q) => (q === 'SI' ? [superAi, superInu].map(pair) : []) });
assert.equal(looked.named?.address, superInu.address);
console.log('PASS bot: the coin a post names (CA or $ticker) leads, copycats and major tickers left out');
// The scan's CA lookup came back empty (DexScreener busy): the address is looked up again, never guessed from the ticker.
const again = await botCoins({ mentioned: [], picks: [], roleCandidates: fakes }, { text: 'Just aped $PURR - 8RNUw4N655VSrZKuhGdywhbSMDTrheguFPfxbpE2NZHQ' }, { search: async () => fakes.map(pair), lookupCa: async (ca) => (ca === purr.address ? purr : null) });
assert.equal(again.named, purr);
await assert.rejects(botCoins({ mentioned: [], picks: [] }, { text: 'CA 8RNUw4N655VSrZKuhGdywhbSMDTrheguFPfxbpE2NZHQ' }, { search: async () => [], lookupCa: async () => { throw new Error('DexScreener rate limited'); } }), /rate limited/, 'a busy lookup retries the tag');
console.log('PASS bot: a CA in the post is looked up again when the scan missed it');

// A picture post that names no coin: the coin whose logo is that very picture leads (🖼).
import { picturePost } from '../bot/coins.js';
assert.equal(picturePost({ text: 'https://t.co/x @someone', images: ['https://pbs.twimg.com/media/a.jpg'] }), true);
assert.equal(picturePost({ text: 'a long caption '.repeat(8), images: ['https://pbs.twimg.com/media/a.jpg'] }), false);
assert.equal(picturePost({ text: '', images: [] }), false);
const owl = tok('OWLO', 'Owlo', '5h6eVq4SCz7zF9FTQj7t8bvzrHwEntcJLU2WoGmTpump', 41_000, { image: 'https://cdn.dexscreener.com/cms/images/owl', relevance: 0 });
const owlCopy = tok('OWLO', 'Owlo', '6h6eVq4SCz7zF9FTQj7t8bvzrHwEntcJLU2WoGmTpump', 4_000, { image: 'https://cdn.dexscreener.com/cms/images/owl2', relevance: 0 });
const otherOwl = tok('HOOT', 'Hoot', '7h6eVq4SCz7zF9FTQj7t8bvzrHwEntcJLU2WoGmTpump', 300_000, { image: 'https://cdn.dexscreener.com/cms/images/hoot', relevance: 0 });
let asked = null;
const pic = await botCoins({ mentioned: [], picks: [], roleCandidates: [], pool: [otherOwl, owlCopy, owl] }, { text: '', images: ['https://pbs.twimg.com/media/owl.jpg'] }, {
  search: async () => [], matchImages: async (images, logos) => { asked = logos; return [1, 2]; },
});
assert.deepEqual(asked, [otherOwl.image, owlCopy.image, owl.image], 'every searched coin with a logo is compared');
assert.equal(pic.named, owl, 'the bigger coin with the same picture leads; a different owl does not count');
assert.equal(pic.how, 'picture');
assert.match(botReply(pic, 'x', now), /🖼 Same picture as the post \(Highest MC\): \$OWLO · \$41\.0K\n5h6eVq4SCz7zF9FTQj7t8bvzrHwEntcJLU2WoGmTpump\n/);
// A post that names its coin needs no picture check.
const skip = await botCoins({ mentioned: [purr], picks: [] }, { text: '', images: ['https://pbs.twimg.com/media/owl.jpg'] }, { search: async () => [], matchImages: async () => { throw new Error('not called'); } });
assert.equal(skip.how, 'post');
console.log('PASS bot: a picture post leads with the coin whose logo is that picture');
const si276 = tok('SI276', 'Super Inu 276', 'HMYd9tosnUXuNHmq7pXmoePRVBLBBjA3JBfydq6upump', 20_000, { createdAt: Date.parse('2026-01-01') });
assert.deepEqual((await botCoins({ mentioned: [superInu], picks: [], roleCandidates: [si276] }, { text: '' }, { search: async () => [] })).picks.map((p) => p.token.symbol), ['SI'], 'SI276 is a copy of SI');
console.log('PASS bot: a ticker with a number added is a copy');
// A post giving an EVM (0x) contract: its coin isn't on Solana, so no Solana coin is named after its ticker.
const solInu = tok('INU', 'inu', 'E28eQFoCPndfLUPnxYgEWHhbnEVqSpyNPgAacoAEpump', 59_000);
const evm = await botCoins({ mentioned: [], picks: [], roleCandidates: [solInu] }, { text: 'vote for $INU 0x63ee32ac3077d1fbd8a77ebba2a6ed4b8e96f0a1' }, { search: async () => [pair(solInu)], lookupCa: async () => null });
assert.equal(evm.named, null);
assert.deepEqual(evm.picks, [], 'Solana coins under an EVM coin\'s ticker are copies');
console.log('PASS bot: an EVM contract in the post is never matched to a Solana coin by ticker');
// A 0x contract on a chain the bot scans (BNB Chain here) names its coin, and the reply says which chain.
const bscInu = tok('INU', 'Inu Coin', '0x63ee32ac3077d1fbd8a77ebba2a6ed4b8e96f0a1', 1_200_000, { chain: 'bsc' });
const evmChains = ['solana', 'robinhood', 'base', 'bsc'];
const onBsc = await botCoins({ mentioned: [], picks: [], roleCandidates: [solInu] }, { text: 'vote for $INU 0x63ee32ac3077d1fbd8a77ebba2a6ed4b8e96f0a1' },
  { search: async () => [pair(solInu)], lookupCa: async () => bscInu, chains: evmChains });
assert.equal(onBsc.named?.chain, 'bsc');
assert.ok(!onBsc.picks.some((p) => p.token.address === solInu.address), 'the Solana INU is a copy of the BNB one');
const bscReply = botReply({ ...onBsc }, 'https://x.com/a/status/1', Date.parse('2026-10-29T22:00:00Z'), { links: true });
assert.match(bscReply, /📌 In the post \(Highest MC\): \$INU · \$1\.20M · BNB\n/);
assert.match(bscReply, /https:\/\/dexscreener\.com\/bsc\/0x63ee32ac3077d1fbd8a77ebba2a6ed4b8e96f0a1/);
// On a chain the bot doesn't scan (Ethereum), the coin isn't named and copies of its ticker stay out.
const onEth = await botCoins({ mentioned: [], picks: [], roleCandidates: [solInu] }, { text: 'vote for $INU 0x63ee32ac3077d1fbd8a77ebba2a6ed4b8e96f0a1' },
  { search: async () => [pair(solInu)], lookupCa: async () => ({ ...bscInu, chain: 'ethereum' }), chains: evmChains });
assert.equal(onEth.named, null);
assert.deepEqual(onEth.picks, []);
console.log('PASS bot: a 0x contract on Base, BNB or Robinhood names its coin with the chain; on other chains nothing is named');

// The story's main runner counts even when the judge rates it low: a $9.7M GTA VI at 62 beside an $836K "GTA memes" at 85.
const gtaMemes = tok('GTA', 'GTA memes', 'GtaMemes111111111111111111111111111111pump', 836_000, { relevance: 85 });
const gta6 = tok('GTA6', 'GTA VI', 'Gta6Runner2222222222222222222222222222zDnz', 9_700_000, { relevance: 62 });
const otherCat = tok('PODCAT', 'Podcast Cat', 'PodCat33333333333333333333333333333333pump', 20_000_000, { relevance: 70 });
const gtaScan = { mentioned: [], picks: [], roleCandidates: [gtaMemes, gta6, otherCat], anchors: ['gta', 'gta6'], terms: ['GTA 6'] };
const gtaCoins = await botCoins(gtaScan, { text: 'TOP 10 GTA 6 MEME COINS' }, { search: async () => [] });
assert.equal(gtaCoins.picks.find((p) => p.role === 'top')?.token.address, gta6.address, 'the runner is Highest MC');
assert.ok(!gtaCoins.picks.some((p) => p.token.address === otherCat.address), 'a big coin without a name from the post stays out');
const noName = await botCoins({ ...gtaScan, anchors: ['vice'], terms: ['Vice City'] }, { text: 'Vice City memes' }, { search: async () => [] });
assert.ok(!noName.picks.some((p) => p.token.address === gta6.address), 'no runner when its name is not in the post');
console.log('PASS bot: the story\'s main runner takes Highest MC even when the judge rates it low');
// The same post gets the same verdicts on every tag: remembered scores win, a coin the judge dropped this time comes
// back from the candidate pool with its old score, and only new coins take the fresh verdict.
const { withMemory } = await import('../bot/coins.js');
const memA = tok('CATS', 'Robinhood Cats', 'MemA1111111111111111111111111111111pump', 30_000, { relevance: 85 });
const memB = tok('KITTY', 'Robinhood Kitty', 'MemB2222222222222222222222222222222pump', 12_000, { relevance: 62 });
const memC = tok('GEMCAT', 'Gem Cat', 'MemC3333333333333333333333333333333pump', 9_000, { relevance: 90 });
const first = withMemory({ roleCandidates: [memA, memB], picks: [], others: [], pool: [memA, memB, memC] }, null);
assert.deepEqual(first.scores, { [memA.address]: 85, [memB.address]: 62 });
const second = withMemory({ roleCandidates: [{ ...memA, relevance: 70 }, memC], picks: [], others: [], pool: [memA, { ...memB, relevance: 0 }, memC] }, first.scores);
const rel = Object.fromEntries(second.scan.roleCandidates.map((t) => [t.symbol, t.relevance]));
assert.deepEqual(rel, { CATS: 85, KITTY: 62, GEMCAT: 90 });
assert.equal(second.scores[memC.address], 90);
console.log('PASS bot: a post keeps its first verdicts across tags; only new coins get a fresh one');

// A judge score of 80-89 also needs a name from the post's story; 90+ stands on its own.
const { tiedToPost } = await import('../bot/coins.js');
const cashWords = ['cash', 'cashcat', 'Cash Cat', 'Matrix Cat', 'Two Cats', 'Cash Cat Token'];
assert.equal(tiedToPost(tok('CASHCAT', 'Cash Cat', 'a'.repeat(32), 1), cashWords), true, 'its whole name');
assert.equal(tiedToPost(tok('MAVU', 'Matrix Cat Deja Vu', 'a'.repeat(32), 1), cashWords), true, 'a telling word of its name');
assert.equal(tiedToPost(tok('PCC', 'Pussy Cat Club', 'a'.repeat(32), 1), cashWords), false, '"cat" alone says nothing');
assert.equal(tiedToPost(tok('RKC', 'Red Kitten Crew', 'a'.repeat(32), 1), ['kitten', 'hacker kitten']), false, 'nor does "kitten"');
assert.equal(tiedToPost(tok('Burn', 'Burn', 'a'.repeat(32), 1), ['ownerless', 'Ownerless coin']), false);
const cashcat = tok('CASHCAT', 'Cash Cat', 'CashCat111111111111111111111111111111pump', 90_000_000, { relevance: 92 });
const pussy = tok('PCC', 'Pussy Cat Club', 'PussyCat22222222222222222222222222222pump', 950_000, { relevance: 82 });
const sandKitten = tok('SNDK', 'Sand Kitten', 'SandKit33333333333333333333333333333pump', 1_380_000, { relevance: 85 });
const unrelated = tok('LUCK', 'Lucky Thing', 'Lucky44444444444444444444444444444pump', 2_000_000, { relevance: 93 });
const tied = await botCoins({ mentioned: [], picks: [], roleCandidates: [cashcat, pussy, sandKitten, unrelated], anchors: ['cash', 'cashcat'], terms: ['Cash Cat', 'Matrix Cat'] }, { text: '😸😸' }, { search: async () => [] });
assert.ok(!tied.picks.some((p) => ['PCC', 'SNDK'].includes(p.token.symbol)), '80-89 without a name from the post stays out');
assert.ok(tied.picks.some((p) => p.token.symbol === 'LUCK'), '90+ stays in');
console.log('PASS bot: a coin the judge rates 80-89 also needs a name from the post');
// Copies of coins that live on chains the bot doesn't scan are treated like majors.
const pepeCopy = tok('PEPE', 'Pepe', '0x52b492a33e447cdb854c7fc19f1e57e8bfa1777d', 2_190_000, { chain: 'base', relevance: 95 });
const pepeName = tok('PEPE2', 'Pepe', 'PepeTwo5555555555555555555555555555pump', 100_000, { relevance: 95 });
const pepeCoins = await botCoins({ mentioned: [], picks: [], roleCandidates: [pepeCopy, pepeName], anchors: ['pepe'], terms: ['Pepe'] }, { text: 'gm' }, { search: async () => [], chains: evmChains });
assert.deepEqual(pepeCoins.picks, [], 'no PEPE copy as Highest MC');
assert.deepEqual(cashtags('$PEPE and $DOGE and $SHIB'), []);
const pepeByCa = await botCoins({ mentioned: [pepeCopy], picks: [], roleCandidates: [] }, { text: '' }, { search: async () => [], chains: evmChains });
assert.equal(pepeByCa.named?.address, pepeCopy.address, 'a contract written in the post still names it');
console.log('PASS bot: PEPE, DOGE and SHIB copies stay out unless the post gives their contract');
// A coin still on its launch curve gets a market cap from elsewhere, when DexScreener has none.
const curve = tok('RADAR', 'Radar', 'Radar666666666666666666666666666666pump', 0, { volume: { h1: 0, h24: 0 }, mcapBacked: false });
const curved = await botCoins({ mentioned: [curve], picks: [], roleCandidates: [] }, { text: '' }, { search: async () => [], capOf: async () => 11_677 });
assert.equal(curved.named.marketCap, 11_677);
assert.match(botReply(curved, 'x', now), /📌 In the post[^\n]*: \$RADAR · \$11\.7K\n/);
const uncurved = await botCoins({ mentioned: [curve], picks: [], roleCandidates: [] }, { text: '' }, { search: async () => [], capOf: async () => { throw new Error('Jupiter down'); } });
assert.equal(uncurved.named.address, curve.address, 'no price from elsewhere is no reason to fail');
console.log('PASS bot: a coin on its launch curve still shows a market cap');
// Anything else called Radar is a copy of our own coin: an $84K "Radar" on BNB Chain was Highest MC on a post that mentions Radar.
const radarMint = 'HyDSdtgiSa5mHqkTVoz8cTFTeVLFKdZ8amPvtNYfpump';
const realRadar = tok('RADAR', 'Radar', radarMint, 40_000);
const radarBnb = tok('RADAR', 'Radar', '0x1111111111111111111111111111111111111111', 84_000, { chain: 'bsc' });
const radarName = tok('RDR', 'Radar', 'RadarName777777777777777777777777777pump', 300_000);
const radarTicker = tok('RADAR', 'Radar Finance', 'RadarTick888888888888888888888888888pump', 500_000);
const radarCopies = [radarBnb, radarName, radarTicker];
const radarWords = { anchors: ['radar'], terms: ['Radar', 'Radar Finance'] };
const copyPicks = await botCoins({ mentioned: [], picks: [], roleCandidates: radarCopies, ...radarWords }, { text: 'this radar picks up everything' }, { search: async () => [], chains: evmChains });
assert.deepEqual(copyPicks.picks, [], 'a copy named Radar is no story pick and no runner');
const lowCopy = await botCoins({ mentioned: [], picks: [], roleCandidates: [{ ...radarBnb, relevance: 62 }], ...radarWords }, { text: 'this radar picks up everything' }, { search: async () => [], chains: evmChains });
assert.deepEqual(lowCopy.picks, [], 'a copy the judge rates low is not kept as the runner');
const realPick = await botCoins({ mentioned: [], picks: [], roleCandidates: [...radarCopies, realRadar], ...radarWords }, { text: 'this radar picks up everything' }, { search: async () => [], chains: evmChains });
assert.deepEqual(realPick.picks.map((p) => p.token.address), [radarMint], 'the real coin can still be picked');
assert.equal(pickNamed('RADAR', [radarBnb, radarTicker, realRadar], 'just aped $RADAR'), realRadar, 'a typed $RADAR names the real mint');
assert.equal(pickNamed('RADAR', [radarBnb, radarTicker], 'just aped $RADAR'), null, 'a typed $RADAR never names a copy');
const typedRadar = await botCoins({ mentioned: [], picks: [], roleCandidates: [] }, { text: 'just aped $RADAR' }, { search: async () => [radarTicker].map(pair) });
assert.equal(typedRadar.named, null);
assert.deepEqual(typedRadar.picks, []);
const radarByCa = await botCoins({ mentioned: [], picks: [], roleCandidates: [radarTicker] }, { text: `$RADAR ${radarBnb.address}` }, { search: async () => [], lookupCa: async () => radarBnb, chains: evmChains });
assert.equal(radarByCa.named?.address, radarBnb.address, 'a contract written in the post still names its coin');
assert.deepEqual(radarByCa.picks.map((p) => p.token.address), [radarBnb.address]);
const radarPic = await botCoins({ mentioned: [], picks: [], roleCandidates: [], pool: [{ ...radarTicker, image: 'https://cdn.dexscreener.com/cms/images/radar' }] }, { text: '', images: ['https://pbs.twimg.com/media/radar.jpg'] }, { search: async () => [], matchImages: async (images, logos) => logos.map((_, i) => i) });
assert.equal(radarPic.named, null, 'nor does a copy win with our picture as its logo');
console.log('PASS bot: copies of $RADAR stay out unless the post gives their contract; a typed $RADAR is the real mint');

// What today's real replies got wrong. The poster's own name isn't the story, unless the post says it.
const { storyWords, runnerOf } = await import('../bot/coins.js');
assert.deepEqual(storyWords(['california', 'elon', 'musk', 'Elon California'], { author: 'elonmusk', authorName: 'Elon Musk' }, 'California became a one-party state'), ['california', 'California']);
assert.deepEqual(storyWords(['elon', 'mars'], { author: 'elonmusk' }, 'elon is going to mars'), ['elon', 'mars'], 'the post says it');
assert.deepEqual(storyWords(['ansem', 'ice'], { author: 'blknoiz06', authorName: 'Ansem' }, 'a partnership with ICE'), ['ice']);
const elonCoin = tok('Elon', 'Elon Coin', 'ElonCoin1111111111111111111111111111pump', 275_000, { relevance: 75 });
const elonReply = await botCoins({ mentioned: [], picks: [], roleCandidates: [elonCoin], anchors: ['california', 'elon', 'musk'], terms: ['Elon California'] }, { text: 'California became a one-party state', author: 'elonmusk', authorName: 'Elon Musk' }, { search: async () => [] });
assert.deepEqual(elonReply.picks, [], "a coin named after the poster isn't the story of an unrelated post");
// Dust that only shares a name isn't the runner, or an 80-89 pick; a real one still is.
const iceCoin = tok('ICE', 'Intercontinental Exchange', 'IceCoin22222222222222222222222222222pump', 2_800, { relevance: 70 });
assert.equal(runnerOf([iceCoin], ['ice']), null);
const iceTied = tok('ICEY', 'ICE', 'IceCoin33333333333333333333333333333pump', 2_800, { relevance: 85 });
assert.deepEqual((await botCoins({ mentioned: [], picks: [], roleCandidates: [iceCoin, iceTied], anchors: ['ice'], terms: ['ICE'] }, { text: 'a partnership with ICE', author: 'x' }, { search: async () => [] })).picks, []);
assert.equal(runnerOf([{ ...gta6, marketCap: 150_000 }], ['gta6'])?.address, gta6.address);
console.log("PASS bot: the poster's name and dust that shares a name aren't the story");
// Newer copies of the biggest coin don't take OG or Mover; an older one can.
const purpsReal = tok('PURPS', 'usepurps.fun', 'PurpsReal1111111111111111111111111111pump', 149_000, { createdAt: now - 3 * 3600_000 });
const purpsNew = tok('PURPS', 'usepurps.fun', 'PurpsNew22222222222222222222222222222pump', 7_000, { createdAt: now - 3600_000, volume: { h1: 90_000, h24: 900_000 } });
const purpsOld = tok('PURPS', 'Purps', 'PurpsOld33333333333333333333333333333pump', 20_000, { createdAt: now - 30 * 864e5 });
const purpsPicks = (await botCoins({ mentioned: [], picks: [], roleCandidates: [purpsReal, purpsNew, purpsOld], anchors: ['purps'], terms: ['Purps'] }, { text: 'launch post', author: 'usepurpsfun' }, { search: async () => [] })).picks;
assert.ok(!purpsPicks.some((p) => p.token.address === purpsNew.address), 'the newer copy is out');
assert.equal(purpsPicks.find((p) => p.role === 'top')?.token.address, purpsReal.address);
assert.equal(purpsPicks.find((p) => p.role === 'og')?.token.address, purpsOld.address, 'the older one can be the OG');
console.log('PASS bot: newer copies of the biggest coin are left out');
assert.deepEqual(storyWords(['juggernaut', 'robinhood'], { author: 'Juggernautrh' }, 'Robinhood Chain btw'), ['juggernaut', 'robinhood'], "a project's own account keeps its name");
console.log("PASS bot: a project's own name still counts on its own account");
const officialElon = tok('ELON', 'Official Elon Coin', 'ElonOfficial3333333333333333333333pump', 291_000, { relevance: 95 });
assert.deepEqual((await botCoins({ mentioned: [], picks: [], roleCandidates: [officialElon], anchors: ['california'], terms: [] }, { text: 'California became a one-party state', author: 'elonmusk', authorName: 'Elon Musk' }, { search: async () => [] })).picks, [], 'even at 95');
assert.equal((await botCoins({ mentioned: [], picks: [], roleCandidates: [officialElon], anchors: ['elon'], terms: [] }, { text: 'Elon coin is running', author: 'someone' }, { search: async () => [] })).picks.length, 1, 'someone else posting about it still counts');
console.log('PASS bot: a coin named after the poster stays out, at any score, unless the post uses the name');
assert.deepEqual((await botCoins({ mentioned: [], picks: [], roleCandidates: [officialElon], anchors: ['california'], terms: [] }, { text: 'California became a one-party state', quoted: 'What Elon said about it', author: 'elonmusk', authorName: 'Elon Musk' }, { search: async () => [] })).picks, [], 'a quote using the name is not the poster using it');
console.log("PASS bot: only the poster's own words count");
