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
 * One look at one wallet. last: the newest signature already looked at; null before the first look, which only notes the
 * wallet's place ('' for a wallet with no history yet). -> { last, buys: [{ sig, at, mint, symbol, launched }] }, each buy
 * of a coin launched in the last 6 hours. New transactions are taken oldest first, at most 4 a look, and `last` only moves
 * past one that was fully read: a failed read throws, so the caller keeps the old place and the next look tries again.
 */
export async function lookAt(wallet, last, { rpc, launchOf, now = Date.now() }) {
  const sigs = await rpc('getSignaturesForAddress', [wallet, { limit: 10 }]);
  if (last == null) return { last: sigs[0]?.signature || '', buys: [] };
  const i = last ? sigs.findIndex((s) => s.signature === last) : -1;
  const news = (i < 0 ? sigs : sigs.slice(0, i)).reverse().slice(0, TX_PER_WALLET);
  const buys = [];
  let done = last;
  for (const s of news) {
    if (!s.err) {
      const tx = await rpc('getTransaction', [s.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 1 }]);
      for (const mint of boughtMints(tx, wallet)) {
        const coin = await launchOf(mint);
        if (coin && now - coin.launched <= NEW_MS) buys.push({ sig: s.signature, at: (s.blockTime || now / 1000) * 1000, mint, symbol: String(coin.symbol || '').replace(/^\$/, '').slice(0, 20) || 'NEW', launched: coin.launched, marketCap: coin.marketCap || 0 });
      }
    }
    done = s.signature;
  }
  return { last: done, buys };
}

// When a coin launched: its first pair on DexScreener.
export const launchFromPairs = (pairs) => {
  if (!Array.isArray(pairs)) throw new Error('DexScreener gave no pairs');
  const times = pairs.map((p) => p.pairCreatedAt).filter(Boolean);
  return times.length ? { launched: Math.min(...times), symbol: pairs[0]?.baseToken?.symbol, marketCap: pairs[0]?.marketCap || pairs[0]?.fdv || 0 } : null;
};
