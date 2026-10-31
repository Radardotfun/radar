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

// POST /launch/meta: stores the picture and metadata, and returns the address that goes on-chain.
export async function launchMeta(body, env, origin) {
  if (launchState(env) === 'off') return { status: 503, data: { error: 'Launching is switched off right now.' } };
  const fields = launchFields(body);
  if (fields.error) return { status: 400, data: fields };
  let image;
  try { image = b64Bytes(String(body.image || '')); } catch { return { status: 400, data: { error: 'That picture could not be read.' } }; }
  if (!image.length || image.length > MAX_IMAGE_BYTES) return { status: 400, data: { error: 'The picture must be under 256 KB.' } };
  const type = imageType(image);
  if (!type) return { status: 400, data: { error: 'The picture must be a JPG, PNG or WEBP.' } };
  const done = await env.DB.prepare('SELECT mint FROM launches WHERE post = ? AND wallet = ?').bind(fields.post, fields.wallet).first();
  if (done) return { status: 409, data: { error: 'This wallet already launched a coin from this post.', mint: done.mint } };
  const day = new Date().toISOString().slice(0, 10);
  const used = await env.DB.prepare("SELECT n FROM counts WHERE day = ? AND name = 'launch-meta'").bind(day).first();
  if ((used?.n || 0) >= MAX_METADATA_PER_DAY) return { status: 429, data: { error: 'Too many launches today. Try again tomorrow.' } };
  const stored = JSON.stringify([fields.name, fields.symbol, fields.description, fields.post, fields.wallet]);
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array([...new TextEncoder().encode(stored), ...image]));
  const id = [...new Uint8Array(hash)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO launch_meta (id, name, symbol, description, post, wallet, image, type, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, fields.name, fields.symbol, fields.description, fields.post, fields.wallet, image, type, Date.now()),
    env.DB.prepare("INSERT INTO counts (day, name, n) VALUES (?, 'launch-meta', 1) ON CONFLICT (day, name) DO UPDATE SET n = n + 1").bind(day),
  ]);
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
  const meta = await env.DB.prepare('SELECT id, name, symbol, post, wallet FROM launch_meta WHERE id = ?').bind(id).first();
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
  await env.DB.prepare('INSERT OR IGNORE INTO launches (mint, id, post, wallet, name, symbol, signature, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(mint, id, meta.post, meta.wallet, meta.name, meta.symbol, signature, (tx.blockTime || Math.floor(Date.now() / 1000)) * 1000).run();
  return { status: 200, data: { listed: true } };
}

// GET /launch/list: the newest coins launched with Radar.
export async function launchList(env) {
  const { results } = await env.DB.prepare('SELECT mint, post, name, symbol, at, id FROM launches ORDER BY at DESC LIMIT 60').all();
  return { coins: results || [] };
}
