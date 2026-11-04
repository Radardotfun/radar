// A coin's family on pump.fun custom pairs (extension/src/lib/family.js) and the line the bot prints for it.
// GeckoTerminal and DexScreener are stubbed. node test/family.mjs
import assert from 'node:assert/strict';
import { familyOf } from '../extension/src/lib/family.js';
import { botReply, familyLine } from '../bot/reply.js';

const SOL = 'So11111111111111111111111111111111111111112';
const LARP = 't9bnCGiZVUYsRKvx4d5dPcoDCSyuBM9C33ZNGNULARP';
const RADAR = 'HyDSdtgiSa5mHqkTVoz8cTFTeVLFKdZ8amPvtNYfpump';
const now = Date.parse('2026-11-04T13:00:00Z');
const pool = (base, quote, name, { vol = 0, reserve = 0, created = '2026-10-20T00:00:00Z' } = {}) => ({
  attributes: { name, volume_usd: { h24: String(vol) }, reserve_in_usd: String(reserve), pool_created_at: created },
  relationships: { base_token: { data: { id: `solana_${base}` } }, quote_token: { data: { id: `solana_${quote}` } } },
});
const pages = {
  [LARP]: [[
    pool(LARP, SOL, 'LARPCHECK / SOL', { vol: 56_000, reserve: 90_000 }),
    pool(RADAR, LARP, 'RADAR / LARPCHECK', { vol: 2_700, reserve: 8_000 }),
    pool('Kid2', LARP, 'Galt / LARPCHECK', { vol: 690, reserve: 1_500, created: '2026-11-04T05:00:00Z' }),
    pool('Kid3', LARP, 'LEGIT / LARPCHECK'),
  ]],
  [RADAR]: [[pool(RADAR, LARP, 'RADAR / LARPCHECK', { vol: 2_700, reserve: 8_000 }), pool(RADAR, SOL, 'RADAR / SOL', { reserve: 100 })]],
};
const fetchJson = async (url) => {
  const [, addr, page] = url.match(/tokens\/([^/]+)\/pools\?page=(\d+)/);
  return { data: (pages[addr] || [])[page - 1] || [] };
};
const asked = [];
const tokens = async (refs) => { asked.push(...refs.map((r) => r.address)); return refs.filter((r) => r.address === RADAR).map(() => ({ address: RADAR, symbol: 'RADAR', marketCap: 7_400, mcapBacked: true })); };

const larp = await familyOf(LARP, { fetchJson, tokens, now });
assert.equal(larp.parent, null, 'priced in SOL: no parent');
assert.equal(larp.children, 3);
assert.equal(larp.more, false);
assert.equal(larp.fresh, 1, 'Galt launched in the last 24 hours');
assert.equal(larp.volume, 3_390);
assert.equal(larp.biggest?.symbol, 'RADAR');
assert.deepEqual(asked, [RADAR, 'Kid2'], 'only children with volume or a real pool are looked up');
assert.equal(familyLine(larp, { address: LARP, symbol: 'LARPCHECK' }), '🌱 Family: 3 coins launched under LARPCHECK (1 in the last 24h) · $3.4K vol 24h · biggest RADAR $7.4K');
console.log('PASS family: children, the newest of them, their volume and the biggest');

const radar = await familyOf(RADAR, { fetchJson, tokens, now });
assert.deepEqual(radar.parent, { address: LARP, symbol: 'LARPCHECK' });
assert.equal(radar.children, 0);
assert.equal(familyLine(radar, { address: RADAR, symbol: 'RADAR' }), '🌳 Launched under LARPCHECK: priced in it, so every buy goes through it');
console.log('PASS family: a coin priced in another coin names its parent');

// A full page means there are more than were read.
const full = Array.from({ length: 20 }, (_, i) => pool(`K${i}`, LARP, `K${i} / LARPCHECK`));
const many = await familyOf(LARP, { fetchJson: async () => ({ data: full }), tokens: async () => [], pages: 1, now });
assert.equal(many.more, true);
assert.match(familyLine(many, { address: LARP, symbol: 'LARPCHECK' }), /^🌱 Family: 20\+ coins launched under LARPCHECK$/);
console.log('PASS family: a full page reads as "20+"');

// In the reply: after the coins, plain tickers only (one cashtag a post).
const text = botReply({ named: { address: LARP, symbol: 'LARPCHECK', chain: 'solana', marketCap: 260_000 }, how: 'post', picks: [] }, 'https://x.com/i/status/1', now, { family: larp });
assert.match(text, /\nLARPCHECK|t9bn/);
assert.match(text, /🌱 Family: 3 coins launched under LARPCHECK/);
assert.equal((text.match(/\$[A-Z]/g) || []).length, 1, 'one cashtag');
assert.equal(familyLine(null, { symbol: 'X' }), '');
console.log('PASS family: the reply carries the family line');
process.exit(0);
