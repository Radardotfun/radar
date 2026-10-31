// Launching a coin from a post: the checks before a wallet is asked, and what the server accepts. Offline, except with
// --simulate, which asks mainnet to simulate a launch. A simulation signs and sends nothing; the payer is any funded
// public address. node test/launch.mjs [--simulate <funded address>]
import assert from 'node:assert/strict';
import { Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } from '@solana/web3.js';
import { PUMP_SDK } from '@pump-fun/pump-sdk';
import { txBlock, spendBlock, simulationWhy, suggestTicker, samePost } from '../webapp/launch-guard.js';
import { launchFields, metadataJson, imageType, launchProblem, base58Bytes, launchState, MAX_IMAGE_BYTES } from '../server/launch.js';

const payer = Keypair.generate().publicKey;
const mintKey = Keypair.generate();
const mint = mintKey.publicKey;
const URI = 'https://narrative-radar.millenia-portfolio.workers.dev/launch/meta/0123456789abcdef01234567.json';

const build = (ixs, feePayer = payer) => new VersionedTransaction(new TransactionMessage({ payerKey: feePayer, recentBlockhash: '11111111111111111111111111111111', instructions: ixs }).compileToV0Message());
const create = await PUMP_SDK.createV2Instruction({ mint, name: 'Test', symbol: 'TEST', uri: URI, creator: payer, user: payer, mayhemMode: false });
const budget = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });

// The builder's own output passes, signed by exactly the wallet and the new coin.
assert.equal(txBlock(build([budget, create]), payer.toBase58(), mint.toBase58()), null);
assert.match(txBlock(build([budget, create]), Keypair.generate().publicKey.toBase58(), mint.toBase58()), /not paid by your wallet/);
assert.match(txBlock(build([budget, create]), payer.toBase58(), Keypair.generate().publicKey.toBase58()), /signatures Radar did not expect/);
const stranger = { programId: Keypair.generate().publicKey, keys: [], data: Buffer.alloc(0) };
assert.match(txBlock(build([create, stranger]), payer.toBase58(), mint.toBase58()), /program Radar does not recognise/);
assert.match(txBlock({}, payer.toBase58(), mint.toBase58()), /not paid/);
console.log('PASS launch: only a pump.fun launch paid by this wallet reaches it');

assert.equal(spendBlock(1e9, 1e9 - 0.006e9), null, 'rent and fees pass');
assert.match(spendBlock(1e9, 0), /would take 1\.0000 SOL/, 'a drained wallet is refused');
assert.match(spendBlock(1e9, 1e9 - 0.06e9), /more than/);
assert.match(spendBlock(NaN, 0), /could not check/);
assert.match(simulationWhy({ InstructionError: [1, { Custom: 1 }] }, ['insufficient lamports']), /Not enough SOL/);
assert.match(simulationWhy('other', []), /would fail on-chain/);
console.log('PASS launch: spending is capped and failures read plainly');

assert.equal(suggestTicker('the new $wif is here'), 'WIF');
assert.equal(suggestTicker('no ticker'), '');
assert.ok(samePost('https://x.com/a/status/123?s=20'));
assert.ok(!samePost('https://evil.example/a/status/123'));
const good = { name: ' A dog <b> ', symbol: '$dog', description: 'hi', post: 'https://www.x.com/a/status/123?s=20', wallet: payer.toBase58() };
const fields = launchFields(good);
assert.equal(fields.name, 'A dog b');
assert.equal(fields.symbol, 'dog');
assert.equal(fields.post, 'https://x.com/a/status/123');
assert.ok(launchFields({ ...good, name: 'n'.repeat(33) }).error, 'name limit');
assert.ok(launchFields({ ...good, name: '🐕'.repeat(9) }).error, 'the limit is bytes, not characters');
assert.ok(launchFields({ ...good, symbol: 'S'.repeat(11) }).error, 'ticker limit');
assert.ok(launchFields({ ...good, post: 'https://example.com/a/status/1' }).error, 'needs a post on X');
assert.ok(launchFields({ ...good, wallet: 'nope' }).error, 'needs a wallet');
const meta = metadataJson({ ...fields, id: 'abc', type: 'jpg' }, 'https://api.test');
assert.match(meta.description, /^hi\n\nLaunched with Radar/);
assert.match(meta.description, /poster may have nothing to do with it/);
assert.equal(meta.website, 'https://tryradar.fun/launched');
assert.equal(meta.twitter, fields.post);
assert.equal(meta.image, 'https://api.test/launch/meta/abc.jpg');
assert.equal(imageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'jpg');
assert.equal(imageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0])), 'png');
assert.equal(imageType(new TextEncoder().encode('<svg onload=alert(1)>')), null, 'anything else is refused');
assert.ok(MAX_IMAGE_BYTES <= 256 * 1024);
assert.equal(launchState({}), 'hidden', 'no button until it is switched on');
assert.equal(launchState({ LAUNCH_STATE: 'on' }), 'on');
assert.equal(launchState({ LAUNCH_STATE: 'off' }), 'off');
console.log('PASS launch: what the server stores says who launched it');

// A coin is listed only when the transaction read back from Solana shows this launch.
const sent = build([budget, create]);
const encode = (bytes) => {
  const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = BigInt(`0x${Buffer.from(bytes).toString('hex') || '0'}`);
  let s = '';
  while (n > 0n) { s = A[Number(n % 58n)] + s; n /= 58n; }
  return s;
};
const keys = sent.message.staticAccountKeys.map((k) => k.toBase58());
const onChain = {
  meta: { err: null },
  transaction: { message: { accountKeys: keys, header: sent.message.header, instructions: sent.message.compiledInstructions.map((ix) => ({ programIdIndex: ix.programIdIndex, data: encode(ix.data) })) } },
};
const claim = { mint: mint.toBase58(), wallet: payer.toBase58(), uri: URI };
assert.deepEqual([...base58Bytes('2g')], [97], 'base58');
assert.equal(launchProblem(onChain, claim), null);
assert.equal(launchProblem(null, claim), 'not found yet');
assert.equal(launchProblem({ ...onChain, meta: { err: 'x' } }, claim), 'it failed on-chain');
assert.equal(launchProblem(onChain, { ...claim, wallet: mint.toBase58() }), 'another wallet paid for it');
assert.equal(launchProblem(onChain, { ...claim, mint: Keypair.generate().publicKey.toBase58() }), 'it did not create this coin');
assert.equal(launchProblem(onChain, { ...claim, uri: `${URI}x` }), 'it did not use this metadata');
console.log('PASS launch: a listing needs the launch itself on-chain');

const simulateAt = process.argv.indexOf('--simulate');
if (simulateAt > 0) {
  const wallet = new PublicKey(process.argv[simulateAt + 1]);
  const conn = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
  const key = Keypair.generate();
  const ix = await PUMP_SDK.createV2Instruction({ mint: key.publicKey, name: 'N'.repeat(32), symbol: 'S'.repeat(10), uri: URI, creator: wallet, user: wallet, mayhemMode: false });
  const { blockhash } = await conn.getLatestBlockhash();
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: wallet, recentBlockhash: blockhash, instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 180_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200_000 }), ix] }).compileToV0Message());
  assert.equal(txBlock(tx, wallet.toBase58(), key.publicKey.toBase58()), null);
  const pre = await conn.getBalance(wallet);
  const sim = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, accounts: { encoding: 'base64', addresses: [wallet.toBase58()] } });
  console.log(`simulated at the longest name and ticker: err ${JSON.stringify(sim.value.err)}, ${sim.value.unitsConsumed} units, ${tx.serialize().length} bytes, about ${((pre - sim.value.accounts?.[0]?.lamports) / 1e9).toFixed(5)} SOL`);
  if (sim.value.err) console.log(sim.value.logs?.slice(-8).join('\n'));
  assert.equal(sim.value.err, null);
  assert.equal(spendBlock(pre, sim.value.accounts[0].lamports), null);
  console.log('PASS launch: mainnet accepts it in simulation');
}
