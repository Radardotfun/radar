// A coin's family on pump.fun custom pairs: coins launched priced in another coin are its children, so every buy of a
// child goes through the parent ($RADAR is paired under $LARPCHECK). Asked for in the Radar Discord after @Sporemap, which
// maps these families ("4,400+ coins paired directly under $HYPE").
// GeckoTerminal lists every pool a coin is in, children included; its prices on those pools are the asked coin's, so the
// children's own market caps come from DexScreener (fullTokens), for the busiest few.
import { isBaseQuote, fullTokens } from './market.js';

const GT = 'https://api.geckoterminal.com/api/v2/networks/solana/tokens';
const PAGE = 20;
const n = (x) => (Number.isFinite(+x) ? +x : 0);
const idOf = (rel) => String(rel?.data?.id || '').replace(/^solana_/, '');
const DAY = 86_400_000;

async function poolsOf(address, { fetchJson, pages }) {
  const all = [];
  for (let page = 1; page <= pages; page++) {
    const j = await fetchJson(`${GT}/${address}/pools?page=${page}&sort=h24_volume_usd_desc`);
    const data = Array.isArray(j?.data) ? j.data : [];
    all.push(...data);
    if (data.length < PAGE) return { pools: all, more: false };
  }
  return { pools: all, more: true };
}

// GeckoTerminal allows about 30 calls a minute and can be slow: one retry after a 429 or a timeout.
const getJson = async (url) => {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(12_000) });
      if (r.status === 429 && i < 1) { await new Promise((ok) => setTimeout(ok, 2_000)); continue; }
      if (!r.ok) throw new Error(`GeckoTerminal ${r.status}`);
      return r.json();
    } catch (e) {
      if (i >= 1 || !/timeout|abort/i.test(String(e?.name || e?.message))) throw e;
    }
  }
};

/**
 * familyOf(address) -> { parent: { address, symbol } | null, children, more, fresh, volume, biggest: token | null }
 * children: distinct coins paired under this one (more: there are more pages than were read); fresh: launched in the
 * last 24 hours; volume: their pools' 24h volume; biggest: the child with the biggest backed market cap.
 */
export async function familyOf(address, { fetchJson = getJson, tokens = fullTokens, pages = 2, now = Date.now() } = {}) {
  const { pools, more } = await poolsOf(address, { fetchJson, pages });
  const parents = new Map();
  const kids = new Map();
  for (const p of pools) {
    const a = p?.attributes || {};
    const base = idOf(p?.relationships?.base_token);
    const quote = idOf(p?.relationships?.quote_token);
    const [baseSym, quoteSym] = String(a.name || '').split(' / ').map((s) => s.trim());
    const vol = n(a.volume_usd?.h24);
    if (base === address && quote && !isBaseQuote(quote)) {
      const was = parents.get(quote);
      parents.set(quote, { address: quote, symbol: quoteSym || '', reserve: n(a.reserve_in_usd) + (was?.reserve || 0) });
    } else if (quote === address && base && base !== address) {
      const was = kids.get(base) || { address: base, symbol: baseSym || '', volume: 0, reserve: 0, createdAt: Infinity };
      was.volume += vol;
      was.reserve += n(a.reserve_in_usd);
      was.createdAt = Math.min(was.createdAt, Date.parse(a.pool_created_at) || Infinity);
      kids.set(base, was);
    }
  }
  const parent = [...parents.values()].sort((a, b) => b.reserve - a.reserve)[0] || null;
  const list = [...kids.values()];
  // The busiest few by 24h volume, then by pool size (GeckoTerminal often reports no volume on small child pools).
  const busiest = list.filter((k) => k.volume > 0 || k.reserve >= 1000).sort((a, b) => b.volume - a.volume || b.reserve - a.reserve).slice(0, 5);
  const full = busiest.length ? await tokens(busiest.map((k) => ({ chain: 'solana', address: k.address }))).catch(() => []) : [];
  const biggest = full.filter((t) => t?.mcapBacked).sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0))[0] || null;
  return {
    parent: parent && { address: parent.address, symbol: parent.symbol },
    children: list.length,
    more,
    fresh: list.filter((k) => now - k.createdAt < DAY).length,
    volume: list.reduce((s, k) => s + k.volume, 0),
    biggest,
  };
}
