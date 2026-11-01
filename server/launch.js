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
// Beside the launch itself, a transaction may set its compute budget and carry a guard some wallets add (webapp/launch-guard.js).
const NOT_THE_LAUNCH = new Set(['ComputeBudget111111111111111111111111111111', 'L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95']);
const MAX_STORIES_COMPARED = 80;
const MAX_PICTURES_COMPARED = 16; // the newest coins: one AI call handles about this many pictures well
// One coin per story: a story stays taken for 30 days, its exact post for good. A launch in progress holds its story for
// 3 minutes, long enough to approve it in a wallet, so two people can't pay for the same one at once.
const STORY_LOCK_MS = 30 * 86_400_000;
const CLAIM_MS = 180_000;
const LAND_GRACE_MS = 120_000; // a transaction signed at the end of its claim can still land this long after
const CREATE_V2 = [0xd6, 0x90, 0x4c, 0xec, 0x5f, 0x8b, 0x31, 0xb4]; // pump.fun's create_v2 instruction

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
  const post = String(body?.post ?? '').trim().replace(/\?.*$/, '').replace('//www.', '//').replace('//mobile.', '//').replace(/\/status\/0+(?=\d)/, '/status/');
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

export const postId = (post) => String(post || '').match(/status\/0*(\d+)/)?.[1] || '';
// Letters and digits decide, so "A-Dog" is "a dog". A name of only emoji keeps them: two different ones aren't the same coin.
export const coinKey = (s) => { const low = String(s || '').toLowerCase(); return low.replace(/[^\p{L}\p{N}]/gu, '') || low.replace(/\s/g, ''); };
const shortHash = async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');

// What plainly makes this coin the same as another: its post, ticker, name or exact picture.
export function clashKind(coin, r) {
  if (postId(r.post) === postId(coin.post)) return 'post';
  if (coinKey(r.symbol) === coinKey(coin.symbol)) return 'ticker';
  if (coinKey(r.name) === coinKey(coin.name)) return 'name';
  return coin.pic && r.pic === coin.pic ? 'picture' : null;
}
export const plainClash = (coin, rows) => rows.find((r) => clashKind(coin, r)) || null;

const takenBy = (kind, r) => {
  const error = kind === 'ticker' ? `$${r.symbol} is already the ticker of a coin launched with Radar. Pick another one.`
    : kind === 'name' ? `That name is already used by a coin launched with Radar: $${r.symbol}. Pick another one.`
      : kind === 'picture' ? `That picture is already used by a coin launched with Radar: $${r.symbol}. One coin per story.`
        : `This story already has a coin launched with Radar: $${r.symbol}. One coin per story.`;
  return { status: 409, data: { error, mint: r.mint } };
};
const heldBy = (kind) => ({ status: 409, data: { error: `Someone is launching with this ${kind} right now. Try again in 3 minutes.` } });

// The listed coin this one plainly clashes with: its exact post for good, its ticker, name or picture for 30 days.
async function listedClash(coin, env, now, mint = '') {
  const exact = await env.DB.prepare('SELECT mint, symbol, name, post, pic FROM launches WHERE post LIKE ? AND mint != ? LIMIT 1').bind(`%/status/${postId(coin.post)}`, mint).first();
  if (exact) return exact;
  return env.DB.prepare("SELECT mint, symbol, name, post, pic FROM launches WHERE at > ? AND mint != ? AND (symbol_key = ? OR name_key = ? OR (pic != '' AND pic = ?)) LIMIT 1")
    .bind(now - STORY_LOCK_MS, mint, coinKey(coin.symbol), coinKey(coin.name), coin.pic || '').first();
}

// Why this coin can't launch from Radar, or null. sameStory(story, others) and samePicture(picture, others) are the AI's
// reading of the rest, and only run when there's something to compare with. The picture check catches a copy with new words
// and a re-saved image. If the AI can't answer, the launch waits: a guess would break the promise.
export async function storyProblem(coin, env, { sameStory, samePicture }, now = Date.now()) {
  const clash = await listedClash(coin, env, now);
  if (clash) return takenBy(clashKind(coin, clash) || 'story', clash);
  const { results: listed } = await env.DB.prepare('SELECT id, mint, symbol, post, story FROM launches WHERE at > ? ORDER BY at DESC LIMIT ?').bind(now - STORY_LOCK_MS, MAX_STORIES_COMPARED).all();
  // Launches in progress by other wallets. rowid is the order claims really went in, so of two at once exactly one goes
  // ahead. A retry of an old claim goes behind everyone active.
  const { results: active } = await env.DB.prepare('SELECT rowid AS seq, id, symbol, name, post, story, pic, at FROM launch_meta WHERE at > ? AND wallet != ? ORDER BY at DESC LIMIT 50').bind(now - CLAIM_MS, coin.wallet).all();
  const pending = (active || []).filter((r) => coin.existed || r.seq < coin.seq);
  const near = plainClash(coin, pending);
  if (near) return heldBy(clashKind(coin, near));
  const all = [...pending.map((r) => ({ r, done: false })), ...(listed || []).map((r) => ({ r, done: true }))];
  const others = all.filter((x) => x.r.story).slice(0, MAX_STORIES_COMPARED);
  const looks = coin.image ? all.filter((x) => x.r.id).slice(0, MAX_PICTURES_COMPARED) : [];
  const answer = (x, kind) => (x.done ? takenBy(kind, x.r) : heldBy(kind));
  try {
    const [story, picture] = await Promise.all([
      others.length ? sameStory(coin.story, others.map((x) => x.r.story)) : -1,
      looks.length ? pictureMatch(coin, looks, env, samePicture) : null,
    ]);
    if (story >= 0) return answer(others[story], 'story');
    return picture ? answer(picture, 'picture') : null;
  } catch {
    return { status: 503, data: { error: 'Could not check whether this story already has a coin. Nothing was launched. Try again.' } };
  }
}

// The coin among looks whose stored picture shows the same picture as this one, or null.
async function pictureMatch(coin, looks, env, samePicture) {
  const ids = looks.map((x) => x.r.id);
  const { results } = await env.DB.prepare(`SELECT id, image, type FROM launch_meta WHERE id IN (${ids.map(() => '?').join(', ')})`).bind(...ids).all();
  const stored = (results || []).map((row) => ({ row, x: looks.find((l) => l.r.id === row.id) })).filter((s) => s.x);
  if (!stored.length) return null;
  const at = await samePicture({ image: coin.image, type: coin.type }, stored.map((s) => s.row));
  return at >= 0 ? stored[at].x : null;
}

// GET /launch/taken: the coin an exact post already has, so the page can say so before anyone fills anything in.
export async function launchTaken(post, env) {
  const id = postId(post);
  if (!id) return { taken: null };
  const coin = await env.DB.prepare('SELECT mint, symbol FROM launches WHERE post LIKE ? LIMIT 1').bind(`%/status/${id}`).first();
  return { taken: coin || null };
}

// POST /launch/meta: stores the picture and metadata, and returns the address that goes on-chain.
export async function launchMeta(body, env, origin, { readPost, sameStory, samePicture }, now = Date.now()) {
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
  // The same details give the same id, and a wallet address proves nothing here. A row that was already there may be the
  // metadata of a live coin, so a refusal only ever removes the row this request added, and only a retry that passes
  // renews its claim.
  const existed = !!await env.DB.prepare('SELECT id FROM launch_meta WHERE id = ?').bind(id).first();
  // A new claim goes in before the check, so two launches at the same moment see each other and the earlier one wins.
  const added = existed ? null : await env.DB.prepare('INSERT INTO launch_meta (id, name, symbol, description, post, wallet, image, type, at, story, pic) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING rowid AS seq')
    .bind(id, fields.name, fields.symbol, fields.description, fields.post, fields.wallet, image, type, now, story, pic).first();
  const problem = await storyProblem({ ...fields, id, at: now, story, pic, image, type, seq: added?.seq, existed }, env, { sameStory, samePicture }, now);
  if (problem) {
    if (!existed) await env.DB.prepare('DELETE FROM launch_meta WHERE id = ?').bind(id).run();
    return problem;
  }
  if (existed) await env.DB.prepare('UPDATE launch_meta SET at = ? WHERE id = ?').bind(now, id).run();
  else await env.DB.prepare("INSERT INTO counts (day, name, n) VALUES (?, 'launch-meta', 1) ON CONFLICT (day, name) DO UPDATE SET n = n + 1").bind(day).run();
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

// The name, ticker and metadata address in a pump.fun create_v2 instruction, or null when it's something else.
export function createV2Args(data) {
  if (data.length < 8 || CREATE_V2.some((b, i) => data[i] !== b)) return null;
  let at = 8;
  const text = () => {
    if (at + 4 > data.length) return null;
    const n = data[at] + data[at + 1] * 2 ** 8 + data[at + 2] * 2 ** 16 + data[at + 3] * 2 ** 24;
    at += 4;
    if (at + n > data.length) return null;
    const s = new TextDecoder().decode(data.subarray(at, at + n));
    at += n;
    return s;
  };
  const name = text(), symbol = text(), uri = text();
  return name === null || symbol === null || uri === null ? null : { name, symbol, uri };
}

// Whether a transaction really launched this coin on pump.fun from this wallet, with exactly this stored name, ticker and
// metadata. Anything looser could list a coin under details that aren't the real ones.
export function launchProblem(tx, { mint, wallet, uri, name, symbol }) {
  if (!tx) return 'not found yet';
  if (tx.meta?.err) return 'it failed on-chain';
  const message = tx.transaction?.message;
  const keys = [...(message?.accountKeys || []), ...(tx.meta?.loadedAddresses?.writable || []), ...(tx.meta?.loadedAddresses?.readonly || [])];
  const signers = keys.slice(0, message?.header?.numRequiredSignatures || 0);
  if (signers[0] !== wallet) return 'another wallet paid for it';
  if (mint === wallet || !signers.includes(mint)) return 'it did not create this coin';
  // Only the launch itself, so a listed coin's creator starts with none of it.
  const main = (message.instructions || []).filter((ix) => !NOT_THE_LAUNCH.has(keys[ix.programIdIndex]));
  if (main.length !== 1) return 'it did more than launch the coin';
  const args = keys[main[0].programIdIndex] === PUMP_PROGRAM ? createV2Args(base58Bytes(main[0].data)) : null;
  if (!args) return 'it did not create this coin';
  if (keys[main[0].accounts?.[0]] !== mint) return 'it did not create this coin';
  if (args.uri !== uri) return 'it did not use this metadata';
  if (args.name !== name || args.symbol !== symbol) return 'its name or ticker are not the ones it claimed';
  return null;
}

// POST /launch/record: lists a coin once Solana shows the launch. Nothing the page says is taken on trust.
export async function launchRecord(body, env, rpcUrl, origin) {
  const { id, mint, signature } = body || {};
  if (!/^[0-9a-f]{24}$/.test(String(id)) || !ADDRESS.test(String(mint)) || !SIGNATURE.test(String(signature))) return { status: 400, data: { error: 'Bad request' } };
  const meta = await env.DB.prepare('SELECT id, name, symbol, post, wallet, story, pic, at FROM launch_meta WHERE id = ?').bind(id).first();
  if (!meta) return { status: 404, data: { error: 'Unknown launch' } };
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [signature, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }] }),
    signal: AbortSignal.timeout(15_000),
  });
  const tx = (await res.json().catch(() => null))?.result || null;
  const problem = launchProblem(tx, { mint, wallet: meta.wallet, uri: `${origin}/launch/meta/${id}.json`, name: meta.name, symbol: meta.symbol });
  if (problem) return { status: tx ? 400 : 404, data: { error: `Not listed: ${problem}.` } };
  const already = await env.DB.prepare('SELECT mint FROM launches WHERE mint = ?').bind(mint).first();
  if (already) return { status: 200, data: { listed: true } };
  // The story check held for this claim's 3 minutes. A transaction landing after that wasn't covered by it, so a claim can't
  // sit unused and land once someone else has the story.
  const landed = (tx.blockTime || Math.floor(Date.now() / 1000)) * 1000;
  if (landed > meta.at + CLAIM_MS + LAND_GRACE_MS) return { status: 409, data: { error: 'Not listed: it landed after its 3 minute hold on this story ended.' } };
  const first = await listedClash(meta, env, Date.now(), mint);
  if (first) return { status: 409, data: { error: `Not listed: this story already has a coin launched with Radar, $${first.symbol}.` } };
  await env.DB.prepare('INSERT OR IGNORE INTO launches (mint, id, post, wallet, name, symbol, signature, at, story, pic, symbol_key, name_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(mint, id, meta.post, meta.wallet, meta.name, meta.symbol, signature, landed, meta.story || '', meta.pic || '', coinKey(meta.symbol), coinKey(meta.name)).run();
  return { status: 200, data: { listed: true } };
}

// GET /launch/list: the newest coins launched with Radar.
export async function launchList(env) {
  const { results } = await env.DB.prepare('SELECT mint, post, name, symbol, at, id FROM launches ORDER BY at DESC LIMIT 60').all();
  return { coins: results || [] };
}
