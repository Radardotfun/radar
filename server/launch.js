// Launching a coin from a post (tryradar.fun/launch). The launcher's own wallet signs and pays on pump.fun; this file
// only hosts the coin's picture and metadata, and keeps the list of coins launched with Radar. It never holds keys or
// funds, and a coin is listed only after its transaction is read back from Solana.
//
// LAUNCH_STATE: "off" refuses launches, "hidden" (the default) lets the page work with no button in the panel, "on"
// shows the button. It lets launching be switched off without a store update.

const PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const X_POST = /^https:\/\/(?:x|twitter)\.com\/\w{1,15}\/status\/\d{1,25}$/;
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
export const MAX_IMAGE_BYTES = 256 * 1024;
const MAX_METADATA_PER_DAY = 1000;
const SITE = 'https://tryradar.fun/launched';
const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111';
// One coin per story: a story stays taken for 30 days, its exact post for good. A launch in progress holds its story for
// 3 minutes, long enough to approve it in a wallet, so two people can't pay for the same one at once.
const STORY_LOCK_MS = 30 * 86_400_000;
const CLAIM_MS = 180_000;

const bytesOf = (s) => new TextEncoder().encode(s).length;
const clean = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim();

export const launchState = (env) => (['off', 'on'].includes(env.LAUNCH_STATE) ? env.LAUNCH_STATE : 'hidden');

// The picture's real type, from its first bytes.
export function imageType(b) {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b.length > 12 && String.fromCharCode(...b.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...b.subarray(8, 12)) === 'WEBP') return 'webp';
  return null;
}
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

// What the launcher typed, cleaned, or the reason it can't be used. Name and ticker limits are the token's own: a
// longer one fails on-chain.
export function launchFields(body) {
  const name = clean(body?.name);
  const symbol = clean(body?.symbol).replace(/^\$+/, '').replace(/\s+/g, '');
  const description = clean(body?.description).slice(0, 280);
  const post = String(body?.post ?? '').trim().replace(/\?.*$/, '').replace('//www.', '//').replace('//mobile.', '//');
  const wallet = String(body?.wallet ?? '').trim();
  if (!name || bytesOf(name) > 32) return { error: 'The name needs 1 to 32 characters.' };
  if (!symbol || bytesOf(symbol) > 10) return { error: 'The ticker needs 1 to 10 characters.' };
  if (!X_POST.test(post)) return { error: 'A launch needs a link to a post on X.' };
  if (!ADDRESS.test(wallet)) return { error: 'Connect a wallet first.' };
  return { name, symbol, description, post, wallet };
}

// Every coin says it where people read about it: who launched it, and that it isn't the poster or Radar.
export function metadataJson(row, origin) {
  const note = `Launched with Radar by one of its users, from this post: ${row.post}. Radar did not issue this coin, and the poster may have nothing to do with it.`;
  return {
    name: row.name,
    symbol: row.symbol,
    description: row.description ? `${row.description}\n\n${note}` : note,
    image: `${origin}/launch/meta/${row.id}.${row.type}`,
    twitter: row.post,
    website: SITE,
    showName: true,
    createdOn: SITE,
  };
}

const b64Bytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const postId = (post) => String(post || '').match(/status\/(\d+)/)?.[1] || '';
const coinKey = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const shortHash = async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');

// The first coin that is plainly the same as this one: its post, ticker, name or exact picture.
export function plainClash(coin, rows) {
  const id = postId(coin.post), symbol = coinKey(coin.symbol), name = coinKey(coin.name);
  return rows.find((r) => postId(r.post) === id || coinKey(r.symbol) === symbol || coinKey(r.name) === name || (coin.pic && r.pic === coin.pic)) || null;
}

// Why this coin can't launch from Radar, or null. sameStory(story, others) is the AI's reading of the rest, and only runs
// when there's something to compare it with. If it can't answer, the launch waits: a guess would break the promise.
export async function storyProblem(coin, env, sameStory, now = Date.now()) {
  const taken = (r) => ({ status: 409, data: { error: `This story already has a coin launched with Radar: $${r.symbol}. One coin per story.`, mint: r.mint } });
  const busy = { status: 409, data: { error: 'Someone is launching this story right now. Try again in 3 minutes.' } };
  const exact = await env.DB.prepare('SELECT mint, symbol FROM launches WHERE post LIKE ? LIMIT 1').bind(`%/status/${postId(coin.post)}`).first();
  if (exact) return taken(exact);
  const { results: listed } = await env.DB.prepare('SELECT mint, symbol, name, post, story, pic FROM launches WHERE at > ? ORDER BY at DESC LIMIT 200').bind(now - STORY_LOCK_MS).all();
  const clash = plainClash(coin, listed || []);
  if (clash) return taken(clash);
  // Launches in progress by other wallets that started first.
  const { results: active } = await env.DB.prepare('SELECT id, symbol, name, post, story, pic, at FROM launch_meta WHERE at > ? AND wallet != ? ORDER BY at DESC LIMIT 50').bind(now - CLAIM_MS, coin.wallet).all();
  const pending = (active || []).filter((r) => r.at < coin.at || (r.at === coin.at && r.id < coin.id));
  if (plainClash(coin, pending)) return busy;
  const others = [...(listed || []).map((r) => ({ r, done: true })), ...pending.map((r) => ({ r, done: false }))].filter((x) => x.r.story);
  if (!others.length) return null;
  let at;
  try { at = await sameStory(coin.story, others.map((x) => x.r.story)); } catch { return { status: 503, data: { error: "Could not check whether this story already has a coin. Nothing was launched. Try again." } }; }
  if (at < 0) return null;
  return others[at].done ? taken(others[at].r) : busy;
}

// GET /launch/taken: the coin an exact post already has, so the page can say so before anyone fills anything in.
export async function launchTaken(post, env) {
  const id = postId(post);
  if (!id) return { taken: null };
  const coin = await env.DB.prepare('SELECT mint, symbol FROM launches WHERE post LIKE ? LIMIT 1').bind(`%/status/${id}`).first();
  return { taken: coin || null };
}

// POST /launch/meta: stores the picture and metadata, and returns the address that goes on-chain.
export async function launchMeta(body, env, origin, { readPost, sameStory }, now = Date.now()) {
  if (launchState(env) === 'off') return { status: 503, data: { error: 'Launching is switched off right now.' } };
  const fields = launchFields(body);
  if (fields.error) return { status: 400, data: fields };
  let image;
  try { image = b64Bytes(String(body.image || '')); } catch { return { status: 400, data: { error: 'That picture could not be read.' } }; }
  if (!image.length || image.length > MAX_IMAGE_BYTES) return { status: 400, data: { error: 'The picture must be under 256 KB.' } };
  const type = imageType(image);
  if (!type) return { status: 400, data: { error: 'The picture must be a JPG, PNG or WEBP.' } };
  const day = new Date().toISOString().slice(0, 10);
  const used = await env.DB.prepare("SELECT n FROM counts WHERE day = ? AND name = 'launch-meta'").bind(day).first();
  if ((used?.n || 0) >= MAX_METADATA_PER_DAY) return { status: 429, data: { error: 'Too many launches today. Try again tomorrow.' } };
  // The story comes from the post itself, not from anything the page says about it.
  const read = await readPost(postId(fields.post)).catch(() => null);
  if (read === 'gone') return { status: 400, data: { error: 'That post is gone, so a coin can\'t launch from it.' } };
  if (!read) return { status: 503, data: { error: 'Could not read the post just now. Nothing was launched. Try again.' } };
  const story = `${fields.name} ($${fields.symbol}): ${clean([read.text, read.quote?.text].filter(Boolean).join(' / '))}`.slice(0, 500);
  const stored = JSON.stringify([fields.name, fields.symbol, fields.description, fields.post, fields.wallet]);
  const id = await shortHash(new Uint8Array([...new TextEncoder().encode(stored), ...image]));
  const pic = await shortHash(image);
  // The claim goes in before the check, so two launches at the same moment see each other and the earlier one wins.
  await env.DB.batch([
    env.DB.prepare('INSERT INTO launch_meta (id, name, symbol, description, post, wallet, image, type, at, story, pic) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET at = excluded.at')
      .bind(id, fields.name, fields.symbol, fields.description, fields.post, fields.wallet, image, type, now, story, pic),
    env.DB.prepare("INSERT INTO counts (day, name, n) VALUES (?, 'launch-meta', 1) ON CONFLICT (day, name) DO UPDATE SET n = n + 1").bind(day),
  ]);
  const problem = await storyProblem({ ...fields, id, at: now, story, pic }, env, sameStory, now);
  if (problem) {
    await env.DB.prepare('DELETE FROM launch_meta WHERE id = ?').bind(id).run();
    return problem;
  }
  return { status: 200, data: { id, uri: `${origin}/launch/meta/${id}.json`, name: fields.name, symbol: fields.symbol } };
}

// GET /launch/meta/<id>.<json|jpg|png|webp>. What's stored never changes, so it can be cached for good.
export async function launchMetaFile(id, ext, env, origin, cors) {
  const row = await env.DB.prepare('SELECT * FROM launch_meta WHERE id = ?').bind(id).first();
  const immutable = { 'cache-control': 'public, max-age=31536000, immutable', ...cors };
  if (!row || (ext !== 'json' && ext !== row.type)) return new Response('Not found', { status: 404, headers: cors });
  if (ext === 'json') return new Response(JSON.stringify(metadataJson(row, origin)), { headers: { 'content-type': 'application/json', ...immutable } });
  return new Response(new Uint8Array(row.image), { headers: { 'content-type': MIME[row.type], ...immutable } });
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function base58Bytes(s) {
  let n = 0n;
  for (const c of s) {
    const v = B58.indexOf(c);
    if (v < 0) throw new Error('not base58');
    n = n * 58n + BigInt(v);
  }
  const out = [];
  while (n > 0n) { out.unshift(Number(n & 255n)); n >>= 8n; }
  for (const c of s) { if (c !== '1') break; out.unshift(0); }
  return new Uint8Array(out);
}

// Whether a transaction really launched this coin on pump.fun from this wallet, with this stored metadata.
export function launchProblem(tx, { mint, wallet, uri }) {
  if (!tx) return 'not found yet';
  if (tx.meta?.err) return 'it failed on-chain';
  const keys = tx.transaction?.message?.accountKeys || [];
  const signers = keys.slice(0, tx.transaction?.message?.header?.numRequiredSignatures || 0);
  if (signers[0] !== wallet) return 'another wallet paid for it';
  if (!signers.includes(mint)) return 'it did not create this coin';
  // Only the launch itself, so a listed coin's creator starts with none of it.
  if ((tx.transaction.message.instructions || []).filter((ix) => keys[ix.programIdIndex] !== COMPUTE_BUDGET).length !== 1) return 'it did more than launch the coin';
  const wanted = new TextEncoder().encode(uri);
  const hasUri = (tx.transaction.message.instructions || []).some((ix) => {
    if (keys[ix.programIdIndex] !== PUMP_PROGRAM) return false;
    const data = base58Bytes(ix.data);
    outer: for (let i = 0; i + wanted.length <= data.length; i++) {
      for (let j = 0; j < wanted.length; j++) if (data[i + j] !== wanted[j]) continue outer;
      return true;
    }
    return false;
  });
  return hasUri ? null : 'it did not use this metadata';
}

// POST /launch/record: lists a coin once Solana shows the launch. Nothing the page says is taken on trust.
export async function launchRecord(body, env, rpcUrl, origin) {
  const { id, mint, signature } = body || {};
  if (!/^[0-9a-f]{24}$/.test(String(id)) || !ADDRESS.test(String(mint)) || !SIGNATURE.test(String(signature))) return { status: 400, data: { error: 'Bad request' } };
  const meta = await env.DB.prepare('SELECT id, name, symbol, post, wallet, story, pic FROM launch_meta WHERE id = ?').bind(id).first();
  if (!meta) return { status: 404, data: { error: 'Unknown launch' } };
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [signature, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }] }),
    signal: AbortSignal.timeout(15_000),
  });
  const tx = (await res.json().catch(() => null))?.result || null;
  const problem = launchProblem(tx, { mint, wallet: meta.wallet, uri: `${origin}/launch/meta/${id}.json` });
  if (problem) return { status: tx ? 400 : 404, data: { error: `Not listed: ${problem}.` } };
  // A claim runs out after 3 minutes, so a late transaction can land after someone else's coin. The first one stays listed.
  const { results: listed } = await env.DB.prepare('SELECT mint, symbol, name, post, pic FROM launches WHERE at > ? AND mint != ? ORDER BY at DESC LIMIT 200').bind(Date.now() - STORY_LOCK_MS, mint).all();
  const first = plainClash(meta, listed || []);
  if (first) return { status: 409, data: { error: `Not listed: this story already has a coin launched with Radar, $${first.symbol}.` } };
  await env.DB.prepare('INSERT OR IGNORE INTO launches (mint, id, post, wallet, name, symbol, signature, at, story, pic) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(mint, id, meta.post, meta.wallet, meta.name, meta.symbol, signature, (tx.blockTime || Math.floor(Date.now() / 1000)) * 1000, meta.story || '', meta.pic || '').run();
  return { status: 200, data: { listed: true } };
}

// GET /launch/list: the newest coins launched with Radar.
export async function launchList(env) {
  const { results } = await env.DB.prepare('SELECT mint, post, name, symbol, at, id FROM launches ORDER BY at DESC LIMIT 60').all();
  return { coins: results || [] };
}
