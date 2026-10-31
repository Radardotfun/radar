// Launch a coin from a post (tryradar.fun/launch), with the launcher's own wallet. Pump's SDK builds the transaction;
// Radar checks it, simulates it, and only then asks the wallet. The new coin's key is made here, signs once and is
// dropped. Radar never sees the wallet's key or holds funds. Built into web/launch.js by scripts/build-webapp.mjs.
import { Keypair, PublicKey, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } from '@solana/web3.js';
import { PUMP_SDK } from '@pump-fun/pump-sdk';
import { txBlock, spendBlock, simulationWhy, suggestTicker, samePost } from './launch-guard.js';

const API = 'https://narrative-radar.millenia-portfolio.workers.dev';
const RELAY = `${API}/rpc`;
const PRIORITY_MICRO_LAMPORTS = 200_000;
const COMPUTE_UNITS = 180_000; // a launch used about 111,000 in a mainnet simulation

const $ = (id) => document.getElementById(id);
const post = (new URLSearchParams(location.search).get('post') || '').trim();
const ui = {
  message: $('page-message'), connect: $('connect-wallet'), choice: $('wallet-choice'), status: $('wallet-status'), launch: $('launch-button'),
  name: $('coin-name-input'), symbol: $('coin-symbol-input'), description: $('coin-description'), agree: $('agree'),
  preview: $('coin-picture'), file: $('picture-file'), twins: $('ticker-twins'), done: $('after-launch'),
};
let providers = [];
let provider = null;
let wallet = '';
let picture = null; // the picture as a JPEG, base64
let busy = false;

const say = (text, kind) => {
  ui.message.textContent = text;
  ui.message.classList.toggle('error', kind === 'error');
  ui.message.classList.toggle('success', kind === 'success');
};
const refresh = () => {
  ui.connect.disabled = busy;
  ui.launch.disabled = busy || !provider || !picture || !ui.agree.checked || !ui.name.value.trim() || !ui.symbol.value.trim() || !samePost(post);
  ui.launch.textContent = !provider ? 'Connect a wallet to launch' : busy ? 'Working…' : !picture ? 'Choose a picture to launch' : 'Check and launch in wallet';
};

// Any picture becomes a 512px square JPEG here, so what's stored is small and the same shape for every coin.
async function usePicture(blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const side = Math.min(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 512, 512);
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 512, 512);
  const url = canvas.toDataURL('image/jpeg', 0.85);
  picture = url.split(',')[1];
  ui.preview.src = url;
  ui.preview.hidden = false;
  refresh();
}

ui.file.addEventListener('change', async () => {
  const f = ui.file.files?.[0];
  if (!f) return;
  try { await usePicture(f); say('Picture set.'); } catch { say('That picture could not be read. Try a JPG or PNG.', 'error'); }
});

// The post: who posted it, what it says, and its picture if it has one.
async function loadPost() {
  if (!samePost(post)) {
    say('Open this page from a post in Radar, or add ?post= with a link to a post on X.', 'error');
    return;
  }
  $('post-link').href = post;
  try {
    const r = await fetch(`${API}/tweet?url=${encodeURIComponent(post)}`, { signal: AbortSignal.timeout(15000) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    $('post-author').textContent = d.source?.kind || 'The post';
    $('post-text').textContent = d.post?.text || d.source?.label || '';
    ui.symbol.value ||= suggestTicker(d.post?.text);
    checkTwins();
    const photo = (d.post?.images || []).find((u) => /^https:\/\/pbs\.twimg\.com\//.test(u));
    if (photo) {
      const res = await fetch(photo, { signal: AbortSignal.timeout(15000) });
      if (res.ok) await usePicture(await res.blob());
    }
    if (!picture) say('This post has no picture to use. Choose one for the coin.');
  } catch (e) {
    say(e.message || 'Could not read that post. You can still launch from it.', 'error');
  }
  refresh();
}

// How many coins already use this ticker, shown before anyone signs.
let twinsFor = '';
async function checkTwins() {
  const symbol = ui.symbol.value.trim().replace(/^\$+/, '');
  if (!symbol || symbol === twinsFor) { if (!symbol) ui.twins.textContent = ''; return; }
  twinsFor = symbol;
  try {
    const d = await (await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(symbol)}`, { signal: AbortSignal.timeout(8000) })).json();
    if (twinsFor !== symbol) return;
    const n = new Set((d.pairs || []).filter((p) => p.chainId === 'solana' && p.baseToken?.symbol?.toUpperCase() === symbol.toUpperCase()).map((p) => p.baseToken.address)).size;
    ui.twins.textContent = n ? `${n}${n >= 30 ? '+' : ''} Solana coin${n === 1 ? ' already uses' : 's already use'} $${symbol.toUpperCase()}. Yours would be another one.` : '';
  } catch { ui.twins.textContent = ''; }
}
ui.symbol.addEventListener('blur', checkTwins);
for (const el of [ui.name, ui.symbol, ui.agree]) el.addEventListener('input', refresh);
ui.agree.addEventListener('change', refresh);

function findWallets() {
  const list = [['Phantom', window.phantom?.solana], ['Solflare', window.solflare], ['Backpack', window.backpack?.solana], ['Solana wallet', window.solana]];
  const seen = new Set();
  providers = list.filter(([, p]) => {
    if (!p || typeof p.connect !== 'function' || typeof p.signTransaction !== 'function' || seen.has(p)) return false;
    seen.add(p);
    return true;
  });
  ui.choice.replaceChildren(...providers.map(([label], i) => Object.assign(document.createElement('option'), { value: String(i), textContent: label })));
  ui.choice.hidden = providers.length < 2;
}

ui.connect.addEventListener('click', async () => {
  if (provider) {
    try { await provider.disconnect?.(); } catch {}
    provider = null;
    wallet = '';
    ui.status.textContent = 'Not connected';
    ui.status.classList.remove('connected');
    ui.connect.textContent = 'Connect wallet';
    refresh();
    return;
  }
  findWallets();
  if (!providers.length) {
    say('Install a Solana browser wallet such as Phantom, Solflare or Backpack, then reload this page.', 'error');
    return;
  }
  const [label, p] = providers[Math.min(Number(ui.choice.value || 0), providers.length - 1)];
  say(`Approve the connection in ${label}.`);
  try {
    const res = await p.connect();
    const key = p.publicKey || res?.publicKey;
    wallet = new PublicKey(key.toBase58 ? key.toBase58() : String(key)).toBase58();
    provider = p;
    ui.status.textContent = `${wallet.slice(0, 5)}…${wallet.slice(-5)}`;
    ui.status.classList.add('connected');
    ui.connect.textContent = 'Disconnect';
    say('Connected. Your wallet shows the launch and must approve it.');
  } catch {
    say('Wallet connection was cancelled.', 'error');
  }
  refresh();
});

const rpc = async (method, params) => {
  const res = await fetch(RELAY, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(20000),
  });
  const d = await res.json().catch(() => null);
  if (!res.ok || !d || d.error) throw new Error(d?.error?.message || `Solana RPC ${res.status}`);
  return d.result;
};
const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };

// The launcher's wallet is the coin's creator, so pump.fun's creator fee goes to them. A first buy in the same
// transaction doesn't fit Solana's size limit without a lookup table, so this launch has none.
async function buildLaunch({ mintKey, uri, name, symbol }) {
  const user = new PublicKey(wallet);
  const ixs = [await PUMP_SDK.createV2Instruction({ mint: mintKey.publicKey, name, symbol, uri, creator: user, user, mayhemMode: false })];
  const { value } = await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }]);
  const message = new TransactionMessage({
    payerKey: user,
    recentBlockhash: value.blockhash,
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNITS }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_MICRO_LAMPORTS }), ...ixs],
  }).compileToV0Message();
  return new VersionedTransaction(message);
}

// What the launch would do to the wallet, from a simulation. Sends nothing.
async function simulate(tx) {
  const pre = await rpc('getBalance', [wallet, { commitment: 'confirmed' }]);
  const sim = await rpc('simulateTransaction', [b64(tx.serialize()), {
    encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed', accounts: { encoding: 'base64', addresses: [wallet] },
  }]);
  const result = sim.value;
  if (result.err) return simulationWhy(result.err, result.logs);
  const post = result.accounts?.[0]?.lamports;
  return spendBlock(pre.value, Number(post));
}

const shown = (mint, signature) => {
  ui.done.hidden = false;
  $('launched-mint').textContent = mint;
  $('link-pump').href = `https://pump.fun/coin/${mint}`;
  $('link-tx').href = `https://solscan.io/tx/${signature}`;
  $('link-larpcheck').href = `https://larpcheck.app/${mint}`;
  $('link-scan').href = `/scan?url=${encodeURIComponent(post)}`;
};

async function waitFor(signature) {
  for (let i = 0; i < 40; i++) {
    const { value } = await rpc('getSignatureStatuses', [[signature]]);
    const st = value?.[0];
    if (st?.err) throw new Error('The launch failed on-chain. Your wallet only paid the network fee.');
    if (st && ['confirmed', 'finalized'].includes(st.confirmationStatus)) return;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('Solana has not confirmed it yet. Check your wallet before trying again.');
}

async function runLaunch() {
  busy = true;
  refresh();
  try {
    say('Saving the picture and details…');
    const metaRes = await fetch(`${API}/launch/meta`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: ui.name.value, symbol: ui.symbol.value, description: ui.description.value, post, wallet, image: picture }),
    });
    const meta = await metaRes.json();
    if (!metaRes.ok) throw new Error(meta.error || 'Could not save the details.');
    const mintKey = Keypair.generate();
    const mint = mintKey.publicKey.toBase58();
    say('Building and checking the launch…');
    const tx = await buildLaunch({ mintKey, uri: meta.uri, name: meta.name, symbol: meta.symbol });
    const blocked = txBlock(tx, wallet, mint) || await simulate(tx);
    if (blocked) throw new Error(blocked);
    say('Check the launch in your wallet and approve it.');
    // A wallet returns its own copy of the transaction, from its own copy of web3.js, and may have added a guard to it.
    // So it's rebuilt from bytes and checked again. The new coin's key signs last, over what the wallet approved.
    const signed = VersionedTransaction.deserialize((await provider.signTransaction(tx)).serialize());
    const again = txBlock(signed, wallet, mint);
    if (again) throw new Error(again);
    signed.sign([mintKey]);
    say('Sending to Solana…');
    const signature = await rpc('sendTransaction', [b64(signed.serialize()), { encoding: 'base64', skipPreflight: false, maxRetries: 3 }]);
    await waitFor(signature);
    shown(mint, signature);
    say('Launched. It is live on pump.fun.', 'success');
    // A node can miss a new transaction for a while, so a "not found" is tried again for about a minute. The coin is live
    // either way; this only decides when it shows on the list.
    for (let i = 0; i < 12; i++) {
      const r = await fetch(`${API}/launch/record`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: meta.id, mint, signature }) }).catch(() => null);
      if (r?.ok || r?.status === 400) break;
      await new Promise((res) => setTimeout(res, 5000));
    }
  } catch (e) {
    const m = String(e?.message || e);
    say(/reject|cancel|denied/i.test(m) ? 'You cancelled it in your wallet. Nothing was launched.' : m, 'error');
  } finally {
    busy = false;
    refresh();
  }
}
ui.launch.addEventListener('click', runLaunch);

$('copy-launched')?.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('launched-mint').textContent); say('Contract address copied.', 'success'); } catch { say('Could not copy. Select it above.', 'error'); }
});

fetch(`${API}/launch/settings`).then((r) => r.json()).then((s) => {
  if (s.state === 'off') { say('Launching is switched off right now.', 'error'); ui.launch.hidden = true; }
}).catch(() => {});
findWallets();
loadPost();
refresh();
