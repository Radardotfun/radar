// Buying a coin that's paired to another token, not SOL, like $RADAR to $LARPCHECK. PumpPortal can't build those, so this uses
// pump's own SDK: one multi_hop_swap from SOL through the quote coin to the coin. Loaded by web/trade.js only for such a coin.
// It returns an unsigned transaction, which goes through the page's usual checks. Built into web/pump-route.js.
import { Connection, PublicKey, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import BN from 'bn.js';
import { OnlinePumpSdk, PUMP_SDK } from '@pump-fun/pump-sdk';

export const ROUTE_COMPUTE = 500_000;
export const PRIORITY_MICRO_LAMPORTS = 200_000;

// The least the buy may pay out, from a quote and a slippage in percent.
export function minOut(quoted, slippagePct) {
  const bps = Math.round(slippagePct * 100);
  if (!(bps > 0 && bps < 10_000)) throw new Error('Set slippage between 0.1% and 50%.');
  return new BN(quoted).muln(10_000 - bps).divn(10_000);
}

/** { rpcUrl, wallet, mint, quoteMint, sol, slippagePct } -> { bytes (unsigned transaction), quoted (raw token amount) } */
export async function buildRouteBuy({ rpcUrl, wallet, mint, quoteMint, sol, slippagePct }) {
  // web3.js adds its own header, which the relay's browser rules don't allow, so it goes out without it.
  const connection = new Connection(rpcUrl, {
    commitment: 'confirmed',
    fetch: (url, options) => {
      const headers = { ...options.headers };
      delete headers['solana-client'];
      return fetch(url, { ...options, headers });
    },
  });
  const online = new OnlinePumpSdk(connection);
  const user = new PublicKey(wallet);
  const hops = await online.resolveMultiHopRoute([NATIVE_MINT, new PublicKey(quoteMint), new PublicKey(mint)], 'buy');
  const amountIn = new BN(Math.round(sol * 1e9));
  const quoted = await online.simulateMultiHopSwap({ user, hops, side: 'buy', amountIn });
  const instructions = await PUMP_SDK.multiHopSwapInstructions({ user, hops, side: 'buy', amountIn, minAmountOut: minOut(quoted, slippagePct) });
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  const tx = new VersionedTransaction(new TransactionMessage({
    payerKey: user,
    recentBlockhash: blockhash,
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: ROUTE_COMPUTE }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_MICRO_LAMPORTS }), ...instructions],
  }).compileToV0Message());
  return { bytes: tx.serialize(), quoted: quoted.toString() };
}

if (typeof window !== 'undefined') window.RadarPumpRoute = { buildRouteBuy };
