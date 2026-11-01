// Launching a coin from a post: the checks before a wallet is asked, and what the server accepts. Offline, except with
// --simulate, which asks mainnet to simulate a launch. A simulation signs and sends nothing; the payer is any funded
// public address. node test/launch.mjs [--simulate <funded address>]
import assert from 'node:assert/strict';
import { Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } from '@solana/web3.js';
import { PUMP_SDK } from '@pump-fun/pump-sdk';
import { txBlock, spendBlock, simulationWhy, suggestTicker, suggestName, tickerFromName, samePost } from '../webapp/launch-guard.js';
import { launchFields, metadataJson, imageType, launchProblem, base58Bytes, launchState, MAX_IMAGE_BYTES, plainClash, postId, storyProblem, launchMeta } from '../server/launch.js';

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
const withBuy = { ...onChain, transaction: { message: { ...onChain.transaction.message, instructions: [...onChain.transaction.message.instructions, onChain.transaction.message.instructions.at(-1)] } } };
assert.equal(launchProblem(withBuy, claim), 'it did more than launch the coin', 'a buy in the launch transaction is not listed');
// A guard some wallets add (Lighthouse) is not a buy: the launch still lists, or its story would never be locked.
const guard = { programId: new PublicKey('L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95'), keys: [], data: Buffer.from([1]) };
const guarded = build([budget, create, guard]);
const guardedKeys = guarded.message.staticAccountKeys.map((k) => k.toBase58());
assert.equal(launchProblem({ meta: { err: null }, transaction: { message: { accountKeys: guardedKeys, header: guarded.message.header, instructions: guarded.message.compiledInstructions.map((ix) => ({ programIdIndex: ix.programIdIndex, data: encode(ix.data) })) } } }, claim), null);
console.log('PASS launch: a listing needs the launch itself on-chain');

// One coin per story.
assert.equal(postId('https://x.com/a/status/123'), '123');
const dog = { post: 'https://x.com/a/status/1', symbol: 'DOG', name: 'A Dog', pic: 'p1' };
assert.equal(plainClash({ post: 'https://x.com/b/status/1', symbol: 'X', name: 'Y', pic: 'p9' }, [dog]), dog, 'the same post under another handle');
assert.equal(plainClash({ post: 'https://x.com/b/status/2', symbol: '$dog', name: 'Y', pic: 'p9' }, [dog]), dog, 'the same ticker');
assert.equal(plainClash({ post: 'https://x.com/b/status/2', symbol: 'X', name: 'a-dog', pic: 'p9' }, [dog]), dog, 'the same name, spelled differently');
assert.equal(plainClash({ post: 'https://x.com/b/status/2', symbol: 'X', name: 'Y', pic: 'p1' }, [dog]), dog, 'the same picture');
assert.equal(plainClash({ post: 'https://x.com/b/status/2', symbol: 'CAT', name: 'A Cat', pic: 'p2' }, [dog]), null, 'a different coin');
const dogEmoji = { post: 'https://x.com/a/status/3', symbol: '🐕', name: '🐕🐕', pic: 'e1' };
assert.equal(plainClash({ post: 'https://x.com/b/status/4', symbol: '🔥', name: '🔥🔥', pic: 'e2' }, [dogEmoji]), null, 'two different emoji names are different coins');
assert.equal(plainClash({ post: 'https://x.com/b/status/4', symbol: '🐕', name: 'Other', pic: 'e2' }, [dogEmoji]), dogEmoji, 'the same emoji ticker is the same');

// A stand-in database: what launchMeta and storyProblem ask of D1.
const db = (listed = [], pendingRows = []) => {
  const claims = [...pendingRows];
  const stmt = (sql) => ({
    bind: (...a) => ({
      first: async () => (/FROM counts/.test(sql) ? null : /FROM launch_meta/.test(sql) ? claims.find((r) => r.id === a[0]) || null : /post LIKE/.test(sql) ? listed.find((r) => postId(r.post) === String(a[0]).split('/status/')[1]) || null : null),
      all: async () => ({ results: /SELECT id, image/.test(sql) ? [...listed, ...claims].filter((r) => a.includes(r.id) && r.image) : /FROM launches/.test(sql) ? listed : claims.filter((r) => r.at > a[0] && r.wallet !== a[1]) }),
      run: async () => {
        if (/^DELETE/.test(sql)) { const i = claims.findIndex((r) => r.id === a[0]); if (i >= 0) claims.splice(i, 1); }
        if (/INSERT INTO launch_meta/.test(sql)) {
          const had = claims.find((r) => r.id === a[0]);
          if (had) had.at = a[8]; else claims.push({ id: a[0], name: a[1], symbol: a[2], post: a[4], wallet: a[5], at: a[8], story: a[9], pic: a[10] });
        }
        return {};
      },
    }),
  });
  return { claims, prepare: stmt };
};
const t0 = 1_800_000_000_000;
const coin = { post: 'https://x.com/z/status/9', symbol: 'NEW', name: 'New Coin', pic: 'pz', wallet: 'w1', id: 'bbb', at: t0, story: 'New Coin ($NEW): a story' };
const never = async () => { throw new Error('the AI should not run'); };
const only = (sameStory) => ({ sameStory, samePicture: never });
assert.equal(await storyProblem(coin, { DB: db() }, only(never), t0), null, 'the first coin of a story needs no AI, so it is quick');
assert.match((await storyProblem(coin, { DB: db([{ ...dog, post: coin.post, mint: 'm1', story: 's' }]) }, only(never), t0)).data.error, /already has a coin launched with Radar: \$DOG/);
const told = { ...dog, mint: 'm2', story: 'A Dog ($DOG): the dog story' };
let asked2 = null;
const yes = await storyProblem(coin, { DB: db([told]) }, only(async (story, others) => { asked2 = [story, others]; return 0; }), t0);
assert.deepEqual(asked2, [coin.story, [told.story]]);
assert.equal(yes.status, 409, 'the AI calls it the same story');
assert.match(yes.data.error, /\$DOG/);
assert.equal(await storyProblem(coin, { DB: db([told]) }, only(async () => -1), t0), null, 'a different story goes through');
const down = await storyProblem(coin, { DB: db([told]) }, only(async () => { throw new Error('no ai'); }), t0);
assert.equal(down.status, 503, 'with no answer from the AI, nothing launches');
const rival = { id: 'aaa', symbol: 'NEW', name: 'Z', post: 'https://x.com/q/status/5', story: 's', pic: 'q', wallet: 'w2', at: t0 - 1000 };
assert.match((await storyProblem(coin, { DB: db([], [rival]) }, only(never), t0)).data.error, /launching this story right now/, 'a launch in progress holds its story');
assert.equal(await storyProblem(coin, { DB: db([], [{ ...rival, at: t0 - 200_000 }]) }, only(never), t0), null, 'a claim runs out after 3 minutes');
assert.equal(await storyProblem(coin, { DB: db([], [{ ...rival, wallet: 'w1' }]) }, only(never), t0), null, 'your own retry is not a rival');
assert.equal(await storyProblem(coin, { DB: db([], [{ ...rival, id: 'zzz', at: t0 + 1 }]) }, only(never), t0), null, 'the earlier of two launches wins');

// A copy with new words and a re-saved picture: the AI compares the pictures too.
const shot = { image: new Uint8Array([1, 2, 3]), type: 'jpg' };
const drawn = { ...coin, ...shot };
const pictured = { ...told, id: 'pic1', image: new Uint8Array([9]), type: 'jpg' };
let shown = null;
const copy = await storyProblem(drawn, { DB: db([pictured]) }, { sameStory: async () => -1, samePicture: async (p, rows) => { shown = [p, rows]; return 0; } }, t0);
assert.equal(copy.status, 409, 'the same picture is refused even when the words differ');
assert.equal(copy.data.mint, 'm2', 'and the page gets the coin to link to');
assert.deepEqual(shown[0], shot);
assert.deepEqual(shown[1].map((r) => r.id), ['pic1']);
assert.equal(await storyProblem(drawn, { DB: db([pictured]) }, { sameStory: async () => -1, samePicture: async () => -1 }, t0), null, 'a different picture and story go through');
const noAnswer = await storyProblem(drawn, { DB: db([pictured]) }, { sameStory: async () => -1, samePicture: async () => { throw new Error('no ai'); } }, t0);
assert.equal(noAnswer.status, 503, 'with no answer on the picture, nothing launches');
const inProgress = { ...rival, symbol: 'OTHER', name: 'Other', post: 'https://x.com/q/status/6', pic: 'other', story: '', image: new Uint8Array([7]), type: 'jpg' };
assert.match((await storyProblem(drawn, { DB: db([], [inProgress]) }, { sameStory: never, samePicture: async () => 0 }, t0)).data.error, /launching this story right now/, 'a picture in a launch in progress holds too');
assert.equal(await storyProblem(drawn, { DB: db() }, { sameStory: never, samePicture: never }, t0), null, 'the first coin still needs no AI');

// Through launchMeta: the story comes from the post, and a refused launch leaves no claim behind.
const jpeg = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 1, 2, 3));
const body = { name: 'New Coin', symbol: 'NEW', post: 'https://x.com/z/status/9', wallet: payer.toBase58(), image: jpeg };
const free = db();
const okMeta = await launchMeta(body, { DB: free }, 'https://api.test', { readPost: async () => ({ text: 'a story', quote: { text: 'more' } }), sameStory: never }, t0);
assert.equal(okMeta.status, 200);
assert.equal(free.claims[0].story, 'New Coin ($NEW): a story / more');
const full = db([told]);
const refused = await launchMeta(body, { DB: full }, 'https://api.test', { readPost: async () => ({ text: 'a story' }), sameStory: async () => 0, samePicture: async () => -1 }, t0);
assert.equal(refused.status, 409);
assert.equal(full.claims.length, 0, 'the refused claim is gone');
// Sending a live coin's exact details again is refused, and must not delete that coin's picture and metadata.
const live = db([{ ...told, post: body.post }]);
const first = await launchMeta(body, { DB: free }, 'https://api.test', { readPost: async () => ({ text: 'a story' }), sameStory: never }, t0);
live.claims.push({ id: first.data.id, wallet: body.wallet, post: body.post, symbol: 'NEW', name: 'New Coin', story: 's', pic: 'x', at: t0 - 86_400_000 });
const again = await launchMeta(body, { DB: live }, 'https://api.test', { readPost: async () => ({ text: 'a story' }), sameStory: never }, t0);
assert.equal(again.status, 409);
assert.equal(live.claims.length, 1, 'a live coin keeps its metadata');
assert.equal((await launchMeta(body, { DB: db() }, 'https://api.test', { readPost: async () => 'gone', sameStory: never }, t0)).status, 400);
assert.equal((await launchMeta(body, { DB: db() }, 'https://api.test', { readPost: async () => null, sameStory: never }, t0)).status, 503);
console.log('PASS launch: one coin per story');

assert.equal(suggestName('Elon Musk adopts a goat named Greg https://t.co/x\nsecond line'), 'Elon Musk adopts a goat named');
assert.equal(new TextEncoder().encode(suggestName('w'.repeat(40))).length, 0, 'a single long word is no name');
assert.equal(suggestName('JUST IN: Meta develops a humanoid robot'), 'Meta develops a humanoid robot');
assert.equal(suggestName('🚨 BREAKING: Meta develops'), 'Meta develops');
assert.equal(tickerFromName('Meta develops a humanoid robot'), 'META');
assert.equal(tickerFromName('the goat adopted greg'), 'ADOPTED');
assert.equal(tickerFromName(''), '');
console.log('PASS launch: the form starts filled in from the post');

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
