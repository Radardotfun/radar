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
