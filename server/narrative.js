// Narrative engine: reads a post and names the coin narrative (interpret), then decides
// which on-chain tokens are really about it (judge). Token lookups happen in the
// extension, from each user's own connection; this side only does the reasoning.
//
// Free by default (Cloudflare Workers AI through the Worker's binding, no key). Free-tier keys for
// Groq, Cerebras, Google Gemini, OpenRouter and Mistral are tried first when set as secrets; each
// secret can hold several keys separated by commas, and a key that hits its limit hands over to the
// next. If an ANTHROPIC_API_KEY secret is set, Claude is used instead.
import Anthropic from '@anthropic-ai/sdk';
import { STORY_SCHEMA, STORY_SYSTEM, gatherEvidence, normaliseStory } from './story.js';

// Haiku by default: ~1s answers at a fraction of a cent. Set a CLAUDE_MODEL secret to switch.
const CLAUDE_MODEL = 'claude-haiku-5-5';
// Tried in order; the next one takes over if a model errors or is at capacity.
// Text: Llama 3.3 70B answers in ~2s with the sharpest coin names. Images need a vision model.
const FREE_TEXT = ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-4-scout-17b-16e-instruct', '@cf/google/gemma-4-26b-a4b-it'];
const FREE_VISION = ['@cf/meta/llama-4-scout-17b-16e-instruct', '@cf/google/gemma-4-26b-a4b-it', '@cf/mistralai/mistral-small-3.1-24b-instruct'];

const INTERPRET_SYSTEM = `You map posts on X to the memecoins people trade about them (mostly Solana: pump.fun, bonk.fun, Raydium, Meteora).

Given a post (author, who it replies to, text, quoted post, link preview, images, video frames and the video's transcript), identify the narrative a memecoin trader would trade and list the names coins for it are actually launched under. Deployers name coins after:
- the specific subject: the person, their nickname, the animal and its name, the object, the place, the event
- the exact meme phrase, quote or catchphrase from the post or image
- the character, animal, person or thing shown in an image or in the video frames
- what is said in the video (quotes and catchphrases from the transcript)
- ticker forms: initials, abbreviations, the obvious ticker for the subject
- established coins for the same subject that already trade
- the author or the account being replied to, when they are notable (a famous person, brand or meme account posting is itself the narrative)

Prefer specific, distinctive names. Never list generic words (news, breaking, today, market, crypto, price, people, update). Trader slang is never the narrative: aped, based, dev, degen, ser, moon, send it, gem, early, LFG, wagmi. A general topic word is fine only when the post is about that topic itself.

When the post names a specific coin (shown as "Coin in this post"), that coin is the narrative: list its name, ticker and what it refers to. Each term is 1-3 words with no $ or # prefix, ordered by how likely a traded coin with that name exists. Give at most 5 terms, best first.

Also give anchors: 1 to 5 lowercase words or tickers, at least one of which a coin's name or ticker must contain to be about this narrative. Anchors are specific names only: the person, project, brand, character, animal, place or the distinctive catchphrase word (e.g. "bach", "spacex", "spcx", "biscuit", "opensea"). Never a generic word like mobile, chain, revenue, ai, app, safety, market.

Also give the coin the post itself names, when it names one: tickers lists up to 3 coin tickers written as $TICKER in the post or shown in an image (without the $; never BTC, ETH, SOL or a stablecoin), and cas lists every token contract address shown in an image, copied character for character (Solana: 32-44 letters and digits; EVM: 0x and 40 hex). Leave either empty when there is none; never guess one.

Set coinable to false when the post carries no tradeable narrative (pure chatter, replies, ads). The narrative field is one short plain sentence of at most 12 words saying what the coin trade is about. Keep the whole answer brief.`;

const INTERPRET_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['narrative', 'coinable', 'terms', 'anchors', 'tickers', 'cas'],
  properties: {
    narrative: { type: 'string' },
    coinable: { type: 'boolean' },
    terms: { type: 'array', items: { type: 'string' } },
    anchors: { type: 'array', items: { type: 'string' } },
    tickers: { type: 'array', items: { type: 'string' } },
    cas: { type: 'array', items: { type: 'string' } },
  },
};

const JUDGE_SYSTEM = `You decide which on-chain tokens are actually about a given narrative from an X post.

Keep a token when its name or ticker clearly refers to:
- the narrative itself: its event, phrase, image or meme
- the people, animals or things at the center of the post. The established coin of the person behind the news counts (a post about Trump's tariffs makes the main TRUMP coin relevant)

Sharing a common word is not enough: a coin named "Mars Bar" is not about a SpaceX Mars launch, and "Helium Mobile" is not about OpenSea's mobile app. Another animal, person or thing of the same kind is a different subject: for a tiger sitting in a box marked "free kitten", "Red Kitten Crew" and "Sand Kitten" are other cats, not this meme. A token that only copies a famous project's name (a "Hyperliquid" or "HyperEVM" token on Solana) is an imitation of that project, not a memecoin about the post. A generic word on its own (mobile, chain, revenue, AI, app, earnings, safety) never ties a token to the story; the token must name the specific person, project, thing or meme. Leave out anything that is not a memecoin: exchange tokens, stablecoins, wrapped assets, protocol or chain tokens, tokenized stocks. A token marked LINKS THIS POST was launched off this exact post and is definitely related.

Keep at most 8 tokens, the most relevant first. For each, give only its index number from the list and a score from 60 to 100 (90+ made for this exact narrative, 75-89 the central subject's own coin, 60-74 clearly the same subject).`;

const JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['matches'],
  properties: {
    matches: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['i', 'score'],
        properties: { i: { type: 'integer' }, score: { type: 'integer' } },
      },
    },
  },
};

// OpenAI-compatible free tiers, tried in this order before Workers AI when their keys are set.
// Each lists models best-first; an overloaded model hands over to the next. Override the list with a
// comma-separated <PROVIDER>_MODEL / <PROVIDER>_VISION_MODEL secret.
const PROVIDERS = [
  { id: 'groq', url: 'https://api.groq.com/openai/v1/chat/completions', text: ['llama-3.3-70b-versatile'], vision: ['meta-llama/llama-4-scout-17b-16e-instruct'] },
  { id: 'cerebras', url: 'https://api.cerebras.ai/v1/chat/completions', text: ['gpt-oss-120b', 'qwen-3.8-27b'], vision: [] },
  { id: 'openrouter', url: 'https://openrouter.ai/api/v1/chat/completions',
    text: ['nvidia/nemotron-3.5-lightning:free', 'minimax/minimax-m3.1-flash:free', 'google/gemma-4-31b-it:free'],
    vision: ['google/gemma-4-31b-it:free', 'nvidia/nemotron-3.5-super-vl:free'], extra: { reasoning: { enabled: false } } },
  { id: 'gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    text: ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-flash-latest'], vision: ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-flash-latest'],
    extra: { reasoning_effort: 'low' }, effortEnv: 'GEMINI_EFFORT' },
  { id: 'mistral', url: 'https://api.mistral.ai/v1/chat/completions', text: ['mistral-small-latest'], vision: ['mistral-small-latest'] },
];

const list = (v) => String(v || '').split(/[\s,]+/).filter(Boolean);

// Models that just failed (overloaded, rate-limited, spent) are skipped for a while instead of
// being retried on every scan. Lives per Worker isolate, which is enough to stop the waste.
const cooldown = new Map();
const cooling = (k) => (cooldown.get(k) || 0) > Date.now();
const coolFor = (k, ms) => cooldown.set(k, Date.now() + ms);
const untilUtcMidnight = () => { const d = new Date(); d.setUTCHours(24, 0, 30, 0); return d - Date.now(); };

function keyedProviders(env) {
  return PROVIDERS.map((p) => {
    const up = p.id.toUpperCase();
    return {
      ...p,
      keys: list(env[`${up}_API_KEY`]),
      text: list(env[`${up}_MODEL`]).length ? list(env[`${up}_MODEL`]) : p.text,
      vision: list(env[`${up}_VISION_MODEL`]).length ? list(env[`${up}_VISION_MODEL`]) : p.vision,
      extra: p.id === 'openrouter' && env.OPENROUTER_REASONING
        ? { reasoning: env.OPENROUTER_REASONING === 'off' ? { enabled: false } : { effort: env.OPENROUTER_REASONING } }
        : p.effortEnv && env[p.effortEnv] ? { ...p.extra, reasoning_effort: env[p.effortEnv] } : p.extra,
    };
  }).filter((p) => p.keys.length);
}

export function engine({ apiKey, binding, freeModels = null, env = {} }) {
  const keyed = keyedProviders(env);
  const free = binding || keyed.length ? { kind: 'free', binding, models: freeModels, keyed } : null;
  // Claude first; the free chain stays behind it in case Claude errors or the credit runs out.
  if (apiKey) return { kind: 'claude', client: new Anthropic({ apiKey, maxRetries: 1 }), model: env.CLAUDE_MODEL || CLAUDE_MODEL, free };
  if (free) return free;
  throw new Error('No narrative model configured');
}

function parseJson(raw) {
  if (raw && typeof raw === 'object') return raw;
  const text = String(raw || '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Model returned no JSON');
  return JSON.parse(text.slice(start, end + 1));
}

// Spread load across a provider's keys (random start). A bad or limited key moves to the next key;
// an overloaded or missing model moves to the next model on the same key.
async function askKeyed(p, system, parts, schema, hasImage) {
  const models = hasImage ? p.vision : p.text;
  const start = Math.floor(Math.random() * p.keys.length);
  let lastErr;
  for (let n = 0; n < p.keys.length; n++) {
    const key = p.keys[(start + n) % p.keys.length];
    for (const model of models) {
      const ck = `${p.id}:${model}:${(start + n) % p.keys.length}`;
      if (cooling(ck)) { lastErr = new Error(`${p.id} 429`); continue; }
      const res = await fetch(p.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: `${system}\n\nReply with only a JSON object with these keys: ${Object.keys(schema.properties).join(', ')}.` },
            { role: 'user', content: parts },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.2,
          max_tokens: 1500,
          ...(p.extra || {}),
        }),
        signal: AbortSignal.timeout(15_000),
      }).catch((e) => ({ ok: false, status: 0, err: e }));
      if (res.ok) {
        const j = await res.json().catch(() => null);
        const content = j?.choices?.[0]?.message?.content;
        if (content) return { ...parseJson(content), model: `${p.id}:${model}` };
        lastErr = new Error(`${p.id} empty reply`);
        coolFor(ck, 30_000);
        continue;
      }
      lastErr = new Error(`${p.id} ${res.status || res.err?.message}`);
      if (res.status === 429 || res.status >= 500 || !res.status) coolFor(ck, res.status === 429 ? 60_000 : 45_000);
      if (res.status === 401 || res.status === 403) break; // this key is no good: next key
    }
  }
  throw lastErr;
}

// Fastest first: Groq/Cerebras keys (~1-2s), then Workers AI (~2s, fails instantly once its daily
// allowance is spent), then the slower keyed tiers (Gemini, OpenRouter, Mistral) as overflow.
const FAST = new Set(['groq', 'cerebras']);

async function askWorkersAi(ai, system, parts, schema, hasImage) {
  if (cooling('workers-ai')) throw new Error('4006: daily free allocation used');
  let lastErr;
  for (const model of ai.models?.length ? ai.models : hasImage ? FREE_VISION : FREE_TEXT) {
    try {
      const r = await ai.binding.run(model, {
        messages: [{ role: 'system', content: system }, { role: 'user', content: parts }],
        response_format: { type: 'json_schema', json_schema: { name: 'result', schema, strict: true } },
        ...(/gemma-4|glm-5/.test(model) ? { reasoning_effort: 'low' } : {}),
        max_completion_tokens: 4000,
        temperature: 0.2,
      });
      return { ...parseJson(r?.choices?.[0]?.message?.content ?? r?.response), model };
    } catch (e) {
      lastErr = e;
      console.warn('free model failed', model, e?.message);
      if (/daily free allocation|4006/.test(String(e?.message))) { coolFor('workers-ai', untilUtcMidnight()); break; } // spent for today
    }
  }
  throw lastErr || new Error('No free model available');
}

async function askFree(ai, system, content, schema) {
  const hasImage = content.some((b) => b.type === 'image');
  const textOnly = () => askFreeOnce(ai, system, content.filter((b) => b.type !== 'image'), schema);
  // If no image-capable model answered a moment ago, don't wait on them again: read the text.
  if (hasImage && cooling('vision')) return textOnly();
  try {
    return await askFreeOnce(ai, system, content, schema);
  } catch (e) {
    if (!hasImage) throw e;
    console.warn('vision unavailable, retrying text-only', e?.message);
    coolFor('vision', 60_000);
    return textOnly();
  }
}

async function askFreeOnce(ai, system, content, schema) {
  // OpenAI-style message parts: images go in as data URLs.
  const parts = content.map((b) => (b.type === 'image'
    ? { type: 'image_url', image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } }
    : { type: 'text', text: b.text }));
  const hasImage = parts.some((p) => p.type === 'image_url');
  const keyed = (ai.keyed || []).filter((p) => !hasImage || p.vision.length);
  const steps = [
    ...keyed.filter((p) => FAST.has(p.id)).map((p) => () => askKeyed(p, system, parts, schema, hasImage)),
    ...(ai.binding ? [() => askWorkersAi(ai, system, parts, schema, hasImage)] : []),
    ...keyed.filter((p) => !FAST.has(p.id)).map((p) => () => askKeyed(p, system, parts, schema, hasImage)),
  ];
  const errors = [];
  for (const step of steps) {
    try {
      return await step();
    } catch (e) {
      errors.push(e);
      console.warn('engine step failed', e?.message);
    }
  }
  // "Limit reached" only when every provider is actually limited; otherwise they're just busy.
  const limited = (e) => /429|daily free allocation|4006/.test(String(e?.message));
  if (errors.length && errors.every(limited)) throw errors.find((e) => / 429$/.test(e.message)) || errors[0];
  throw new Error('AI providers are busy right now');
}

async function ask(ai, system, content, schema) {
  if (ai.kind === 'free') return askFree(ai, system, content, schema);
  try {
    return await askClaude(ai, system, content, schema);
  } catch (e) {
    if (!ai.free || /declined this post/.test(String(e?.message))) throw e;
    console.warn('claude failed, using free chain', e?.message);
    return askFree(ai.free, system, content, schema);
  }
}

async function askClaude(ai, system, content, schema) {
  // Haiku: thinking off for speed (no server-side fallback on Haiku). Bigger models keep fallbacks.
  const haiku = /haiku/.test(ai.model);
  const res = haiku
    ? await ai.client.messages.create({
      model: ai.model,
      max_tokens: 4000,
      system,
      thinking: { type: 'disabled' },
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content }],
    })
    : await ai.client.beta.messages.create({
      model: ai.model,
      max_tokens: 12000,
      system,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content }],
    });
  if (res.stop_reason === 'refusal') throw new Error('Narrative model declined this post');
  if (res.stop_reason === 'max_tokens') throw new Error('Narrative model ran out of room');
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { ...JSON.parse(text), model: res.model };
}

// Images: X media CDN URLs, or video frame grids the extension rendered (JPEG data URLs).
async function imageBlocks(urls = []) {
  const ok = urls.filter((u) => /^https:\/\/pbs\.twimg\.com\//.test(u) || /^data:image\/jpeg;base64,/.test(u)).slice(0, 3);
  const blocks = await Promise.all(ok.map(async (u) => {
    if (u.startsWith('data:')) return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: u.slice(u.indexOf(',') + 1) } };
    const url = u.replace(/([?&]name=)\w+/, '$1small');
    const res = await fetch(url).catch(() => null);
    if (!res?.ok) return null;
    const type = (res.headers.get('content-type') || 'image/jpeg').split(';')[0];
    if (!/^image\/(jpeg|png|gif|webp)$/.test(type)) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { type: 'image', source: { type: 'base64', media_type: type, data: btoa(bin) } };
  }));
  return blocks.filter(Boolean);
}

function postText(post) {
  const who = post.author ? `${post.authorName ? `${post.authorName} ` : ''}@${post.author}` : '';
  return [
    who && `Author: ${who}`,
    post.replyTo?.length && `Replying to: ${post.replyTo.map((h) => `@${h}`).join(', ')}`,
    post.parent && `The post being replied to${post.parentAuthor ? ` (by @${post.parentAuthor})` : ''}: ${post.parent}`,
    post.url && `URL: ${post.url}`,
    post.text && `Post: ${post.text}`,
    post.quoted && `Quoted post: ${post.quoted}`,
    post.card && `Link preview: ${post.card}`,
    post.hasVideo && 'The post has a video; one image is a grid of frames sampled across it, in order.',
    post.transcript && `Video transcript: ${post.transcript}`,
  ].filter(Boolean).join('\n');
}

const GENERIC = new Set('mobile chain revenue ai app safety market crypto token coin news earnings price trading defi meme memes art cards perps the and ceo dog cat x usa us new official target classical music theme park west east north south world global'.split(' '));
const CA = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b|\b0x[a-fA-F0-9]{40}\b/g;
const ONE_CA = /^(?:[1-9A-HJ-NP-Za-km-z]{32,44}|0x[a-fA-F0-9]{40})$/;
const MAJORS = new Set('BTC ETH SOL USDC USDT BNB XRP WBTC WETH WSOL'.split(' '));

/** post: { text, quoted, card, author, url, images[] } -> { narrative, coinable, terms[], anchors[], tickers[], cas[] } */
export async function interpret(ai, post) {
  const imgs = await imageBlocks(post.images);
  const read = await ask(ai, INTERPRET_SYSTEM, [
    ...imgs,
    { type: 'text', text: postText({ ...post, text: (post.text || '').replace(CA, '[CA]') }) },
  ], INTERPRET_SCHEMA);
  const terms = [...new Map((read.terms || []).slice(0, 8).map((t) => String(t).replace(/^[$#]/, '').trim())
    .filter((t) => t.length >= 2 && t.length <= 40 && !/^(ca|contract|token|coin|memecoin)$/i.test(t)).map((t) => [t.toLowerCase(), t])).values()].slice(0, 6);
  const anchors = [...new Set((read.anchors || []).map((a) => String(a).toLowerCase().replace(/^[$#]/, '').trim())
    // Single specific words only: no numbers, no phrases, no generic words.
    .filter((a) => a.length >= 2 && a.length <= 30 && !/\s/.test(a) && !/^\d+$/.test(a) && !GENERIC.has(a)))].slice(0, 6);
  // The coin the post names: its tickers ("SI", from "$SI") and any contract address read off an image. Only what
  // has an address's shape is kept; the client checks each one exists before showing it.
  const tickers = [...new Set((read.tickers || []).map((t) => String(t).replace(/^\$+/, '').trim().toUpperCase())
    .filter((t) => /^[A-Z0-9]{1,12}$/.test(t) && !MAJORS.has(t)))].slice(0, 3);
  const cas = [...new Set((read.cas || []).map((a) => String(a).trim()).filter((a) => ONE_CA.test(a)))].slice(0, 3);
  return {
    narrative: String(read.narrative || '').slice(0, 200),
    coinable: read.coinable !== false,
    terms,
    anchors,
    tickers,
    cas,
    // Claude is a reliable judge; the free models aren't, so free mode filters by anchors instead.
    judge: ai.kind === 'claude',
    model: read.model,
  };
}

/**
 * candidates: [{ name, symbol, age, mc, vol, fromPost, links[] }] (index = position)
 * -> { matches: [{ i, score, reason }] } with score >= 60
 */
export async function judge(ai, { narrative, post, candidates }) {
  const lines = candidates.map((c, i) =>
    `${i} | ${c.name} | $${c.symbol} | age ${c.age} | mc ${c.mc} | vol24 ${c.vol}${c.fromPost ? ' | LINKS THIS POST' : ''}${c.links?.length ? ` | ${c.links.slice(0, 3).join(' ')}` : ''}`);
  const verdict = await ask(ai, JUDGE_SYSTEM, [{
    type: 'text',
    text: `Narrative: ${narrative}\n\n${postText(post)}\n\nTokens (index | name | ticker | age | market cap | 24h volume | links):\n${lines.join('\n')}`,
  }], JUDGE_SCHEMA);
  const seen = new Set();
  const matches = (verdict.matches || [])
    .map((m) => ({ i: Number(m.i), score: Math.round(Number(m.score)) }))
    .filter((m) => Number.isInteger(m.i) && m.i >= 0 && m.i < candidates.length && m.score >= 60 && !seen.has(m.i) && seen.add(m.i));
  return { matches, model: verdict.model };
}

/**
 * Story check for one post and the coin tied to it.
 * coin: { name, symbol, address, createdAt, socials, websites, fromPost, mentioned } or null
 * -> { word, score, call, findings: [{ kind, text }], facts }
 */
export async function storyCheck(ai, { post, narrative, coin }) {
  const [imgs, ev] = await Promise.all([imageBlocks(post.images.slice(0, 2)), gatherEvidence(post, coin)]);
  const r = await ask(ai, STORY_SYSTEM, [
    ...imgs,
    { type: 'text', text: `${postText(post)}\n\nNarrative read: ${narrative || 'n/a'}\n\nEvidence:\n${ev.lines.map((l) => `- ${l}`).join('\n')}` },
  ], STORY_SCHEMA);
  return { ...normaliseStory(r), facts: { author: ev.author, coinX: ev.coinX, site: ev.site }, model: r.model };
}

// Speech in a post's video, via Whisper (free on Workers AI). The video streams straight
// from X's CDN into the model, so the Worker never buffers or re-encodes it.
export async function transcribe(binding, videoUrl) {
  const res = await fetch(videoUrl);
  if (!res.ok) throw new Error(`video ${res.status}`);
  const size = Number(res.headers.get('content-length') || 0);
  if (size > 6 * 1024 * 1024) throw new Error('video too long to transcribe');
  // Whisper takes base64 audio; MP4/AAC is decoded on Cloudflare's side.
  const bytes = new Uint8Array(await res.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const out = await binding.run('@cf/openai/whisper-large-v3-turbo', { audio: btoa(bin), task: 'transcribe', vad_filter: true });
  return { text: String(out?.text || '').trim().slice(0, 3000) };
}
