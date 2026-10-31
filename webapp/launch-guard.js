// Launch safety checks, shared by webapp/launch.js and test/launch.mjs. A transaction that fails any of them is never
// shown to the wallet.

export const PROGRAMS = {
  ComputeBudget111111111111111111111111111111: 'Compute budget',
  '11111111111111111111111111111111': 'System',
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: 'Token-2022',
  ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: 'Associated token account',
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P': 'pump.fun',
  L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95: 'Lighthouse', // some wallets add it as a guard
};

const short = (a) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : 'unknown');

// Why a built or wallet-signed launch must not be signed or sent, or null when it passes. It must be paid by this
// wallet, signed only by the wallet and the new coin's address, and call only the programs above.
export function txBlock(tx, payer, mint) {
  const msg = tx?.message;
  const keys = (msg?.staticAccountKeys || []).map((k) => (typeof k === 'string' ? k : k.toBase58()));
  if (!keys.length || keys[0] !== payer) return 'This transaction is not paid by your wallet. Nothing was signed.';
  if (msg.header?.numRequiredSignatures !== 2 || keys[1] !== mint) return 'This transaction asks for signatures Radar did not expect. Nothing was signed.';
  const ixs = msg.compiledInstructions || [];
  if (!ixs.length) return 'This transaction is empty. Nothing was signed.';
  for (const ix of ixs) {
    const program = keys[ix.programIdIndex];
    if (!program || !PROGRAMS[program]) return `This transaction calls a program Radar does not recognise (${short(program)}). Nothing was signed.`;
  }
  if (!ixs.some((ix) => keys[ix.programIdIndex] === '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P')) return 'This transaction does not launch on pump.fun. Nothing was signed.';
  return null;
}

// A launch spends rent for the coin's accounts and the network fee: about 0.006 SOL in a mainnet simulation on
// 31 Oct 2026. A simulation that shows the wallet losing much more than that is refused.
export function spendBlock(preLamports, postLamports) {
  if (!Number.isFinite(preLamports) || !Number.isFinite(postLamports)) return 'Radar could not check what this launch spends. Nothing was signed.';
  const spent = (preLamports - postLamports) / 1e9;
  const allowed = 0.05;
  if (spent > allowed) return `This launch would take ${spent.toFixed(4)} SOL from your wallet, more than ${allowed.toFixed(3)} SOL. Nothing was signed.`;
  return null;
}

export function simulationWhy(err, logs) {
  const text = `${JSON.stringify(err || '')} ${(logs || []).join(' ')}`;
  if (/insufficient (lamports|funds)|InsufficientFunds|AccountNotFound|0x1\b/i.test(text)) return 'Not enough SOL in this wallet for the launch and fees.';
  return 'This launch would fail on-chain right now, so nothing was signed.';
}

// A ticker the poster typed, to start the form from. A guess the launcher can change.
export function suggestTicker(text) {
  const m = String(text || '').match(/\$([A-Za-z][A-Za-z0-9]{0,9})\b/);
  return m ? m[1].toUpperCase() : '';
}

export const samePost = (url) => /^https:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/\w{1,15}\/status\/\d{1,25}(?:\?\S*)?$/.test(String(url || '').trim());
