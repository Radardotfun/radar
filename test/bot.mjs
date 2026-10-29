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
