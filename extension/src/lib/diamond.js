// Diamond Hand's shared parts: what a buy is, and a look at a list of wallets for buys of coins launched in the last 6 hours.
// The bot runs it on Radar's wallets (bot/diamond.js); the extension runs it on the wallets a holder types in (background.js).
export const NEW_MS = 6 * 3_600_000;
export const MAX_MY_WALLETS = 5;
const MIN_SOL = 0.01;
const TX_PER_WALLET = 4;
// Not a new coin: SOL, the dollars, and what pools hold.
const SKIP = new Set(['So11111111111111111111111111111111111111112', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', 'USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB']);
export const isWalletAddress = (s) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(s || '').trim());
export const agoText = (ms) => (ms < 3_600_000 ? `${Math.max(1, Math.round(ms / 60_000))}m` : `${Math.round(ms / 3_600_000)}h`);

/** The coins a transaction bought for this wallet: its balance of them went up and it paid SOL. */
export function boughtMints(tx, wallet) {
  const meta = tx?.meta;
  if (!meta || meta.err) return [];
  const keys = (tx.transaction?.message?.accountKeys || []).map((k) => k.pubkey || k);
  const at = keys.indexOf(wallet);
  if (at < 0 || (meta.preBalances[at] - meta.postBalances[at]) / 1e9 < MIN_SOL) return [];
  const amount = (list, mint) => list.filter((b) => b.owner === wallet && b.mint === mint).reduce((s, b) => s + Number(b.uiTokenAmount?.amount || 0), 0);
  const mints = [...new Set((meta.postTokenBalances || []).filter((b) => b.owner === wallet).map((b) => b.mint))];
  return mints.filter((m) => !SKIP.has(m) && amount(meta.postTokenBalances, m) > amount(meta.preTokenBalances || [], m));
}

/**
 * One look at one wallet. last: the newest signature seen before (null on the first look, which only notes it).
 * -> { last, buys: [{ sig, at, mint, symbol, launched }] } where each buy is of a coin launched in the last 6 hours.
 */
export async function lookAt(wallet, last, { rpc, launchOf, now = Date.now() }) {
  const sigs = await rpc('getSignaturesForAddress', [wallet, { limit: 10 }]);
  const top = sigs[0]?.signature || last || null;
  if (!last) return { last: top, buys: [] };
  const i = sigs.findIndex((s) => s.signature === last);
  const news = (i < 0 ? sigs : sigs.slice(0, i)).filter((s) => !s.err).slice(0, TX_PER_WALLET);
  const buys = [];
  for (const s of news) {
    const tx = await rpc('getTransaction', [s.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 1 }]).catch(() => null);
    for (const mint of boughtMints(tx, wallet)) {
      const coin = await launchOf(mint).catch(() => null);
      if (coin && now - coin.launched <= NEW_MS) buys.push({ sig: s.signature, at: (s.blockTime || now / 1000) * 1000, mint, symbol: String(coin.symbol || '').replace(/^\$/, '').slice(0, 20) || 'NEW', launched: coin.launched, marketCap: coin.marketCap || 0 });
    }
  }
  return { last: top, buys };
}

// When a coin launched: its first pair on DexScreener.
export const launchFromPairs = (pairs) => {
  const times = (pairs || []).map((p) => p.pairCreatedAt).filter(Boolean);
  return times.length ? { launched: Math.min(...times), symbol: pairs[0]?.baseToken?.symbol, marketCap: pairs[0]?.marketCap || pairs[0]?.fdv || 0 } : null;
};
