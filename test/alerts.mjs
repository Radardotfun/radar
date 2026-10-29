// Alerts (extension/src/lib/alerts.js), offline: which coins ping for a watched post. node test/alerts.mjs
import assert from 'node:assert/strict';
import { newWatch, tieOf, checkWatch, postTime, statusOf, buyUrl, WATCH_MS } from '../extension/src/lib/alerts.js';

const STATUS = '2115884304966263178'; // 29 Oct 2026 19:11:44 UTC
const POSTED = postTime(STATUS);
assert.equal(new Date(POSTED).toISOString(), '2026-10-29T19:11:44.190Z');
assert.equal(statusOf(`https://x.com/CryptoKaleo/status/${STATUS}?s=20`), STATUS);

const post = { text: 'Does Robinhood celebrate National Cat Day?', author: 'CryptoKaleo', url: `https://x.com/CryptoKaleo/status/${STATUS}`, images: [] };
const read = { narrative: 'Cats with green gems for National Cat Day', terms: ['national cat day', 'robinhood cat', 'cat day'], anchors: ['catday', 'robinhood cat', 'cat'] };
const now = POSTED + 5 * 60_000;
const w = newWatch(post, read, now);
assert.equal(w.id, STATUS);
assert.equal(w.until - w.since, WATCH_MS);
assert.throws(() => newWatch({ text: 'no link' }, read), /Only a post on X/);

// A DexScreener pair, the way searchPairs returns it.
let n = 0;
const pair = ({ symbol, name, chain = 'solana', created, liq = 5000, quote = 'So11111111111111111111111111111111111111112', dexId = 'pumpswap', links = [] }) => ({
  chainId: chain, dexId, pairAddress: `Pair${++n}`.padEnd(40, 'x'), url: `https://dexscreener.com/${chain}/pair${n}`,
  baseToken: { address: `${symbol}Mint${n}`.padEnd(40, '1'), name, symbol },
  quoteToken: { address: quote, symbol: 'SOL' },
  priceNative: '0.0001', priceUsd: '0.02', liquidity: { usd: liq * 2, quote: liq / 200 }, fdv: 20_000, marketCap: 20_000,
  volume: { h24: 3000, h1: 500 }, txns: { h1: { buys: 5, sells: 2 }, h24: { buys: 50, sells: 20 } }, priceChange: { h1: 3 },
  pairCreatedAt: created, info: { socials: links.map((url) => ({ type: 'twitter', url })) },
});

const old = pair({ symbol: 'CATDAY', name: 'Cat Day', created: Date.parse('2026-09-01') });
const beforeWatch = pair({ symbol: 'CATS', name: 'Robinhood Cats', created: POSTED + 60_000 });
let results = [old, beforeWatch];
const search = async () => results;
const noProfiles = async () => [];
const chains = ['solana', 'robinhood'];

// First check: what's there is only noted.
const first = await checkWatch(w, { chains, search, profiles: noProfiles });
assert.deepEqual(first.hits, []);
assert.equal(first.primed, true);
assert.ok(first.seen.includes(old.baseToken.address) && first.seen.includes(beforeWatch.baseToken.address));
Object.assign(w, { seen: first.seen, primed: true });

// Then: a new coin named after the post pings; an old one, an unrelated one, another chain's and a stock token don't.
const fresh = pair({ symbol: 'GEMCAT', name: 'National Cat Day', created: now + 60_000 });
const unrelated = pair({ symbol: 'DOGE2', name: 'Doge Two', created: now + 60_000 });
const otherChain = pair({ symbol: 'CATDAY', name: 'Cat Day', chain: 'base', created: now + 60_000 });
const stock = pair({ symbol: 'CAT', name: 'Caterpillar • Robinhood Token', chain: 'robinhood', quote: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168', created: now + 60_000 });
const olderThanPost = pair({ symbol: 'ROBINCAT', name: 'Robinhood Cat', created: POSTED - 3 * 3_600_000 });
const noPool = pair({ symbol: 'CATDAY', name: 'Cat Day', dexId: 'raydium', liq: 0, created: now + 90_000 });
results = [old, beforeWatch, fresh, unrelated, otherChain, stock, olderThanPost, noPool];
const second = await checkWatch(w, { chains, search, profiles: noProfiles });
assert.deepEqual(second.hits.map((h) => h.coin.symbol), ['GEMCAT'], 'only the new coin named after the post');
assert.equal(second.hits[0].tie, 'name');
assert.ok(second.seen.includes(olderThanPost.baseToken.address), 'a coin older than the post is noted and never pings');
assert.ok(!second.seen.includes(noPool.baseToken.address), 'a coin with nothing to trade yet gets another look');
Object.assign(w, { seen: second.seen });

// A coin launched off this exact post, found through DexScreener's latest profiles, pings first even with any name.
const launched = pair({ symbol: 'GEMS', name: 'Green Gems', created: now + 120_000, links: [`https://x.com/CryptoKaleo/status/${STATUS}`] });
const profiles = async () => [{ chainId: 'solana', tokenAddress: launched.baseToken.address, links: [{ type: 'twitter', url: `https://x.com/CryptoKaleo/status/${STATUS}` }] }];
const { aggregate } = await import('../extension/src/lib/market.js');
const tokens = async () => aggregate([launched]);
const third = await checkWatch(w, { chains, search, profiles, tokens });
assert.equal(third.hits[0].coin.symbol, 'GEMS');
assert.equal(third.hits[0].tie, 'post');
assert.equal(tieOf({ name: 'Green Gems', symbol: 'GEMS', links: [] }, w), null);

// Where the buy button goes.
assert.match(buyUrl({ chain: 'solana', address: 'Mint1', dexId: 'pumpfun' }), /^https:\/\/tryradar\.fun\/trade\?mint=Mint1$/);
assert.equal(buyUrl({ chain: 'solana', address: 'Mint1', dexId: 'orca' }), null, 'Quick Buy cannot build Orca buys');
assert.match(buyUrl({ chain: 'robinhood', address: '0xabc' }), /app\.uniswap\.org\/swap\?chain=robinhood&outputCurrency=0xabc/);

console.log('PASS alerts: first check notes, new coins on the story ping, launched-off-the-post first, old and other-chain coins stay quiet');
