// Radar in Discord and Telegram: someone drops a link to a post on X and the bot answers with its coins, the same scan
// as the bot on X. Both arrive as webhooks to this Worker, and neither service charges per message.
//   Discord: /scan, the "Scan with Radar" message command, and channels switched on with /watch (read once a minute).
//   Telegram: any link in a group the bot is in (needs group privacy off in BotFather), or in a private chat.
// Secrets: DISCORD_APP_ID, DISCORD_PUBLIC_KEY, DISCORD_BOT_TOKEN, TELEGRAM_BOT_TOKEN, TELEGRAM_SECRET. Without them that
// side stays off. Limits protect the AI credit: DAY_CAP scans a day in all, CHAT_CAP an hour per chat.
import { scanUrl, ticker, contract } from './reply.js';
import { readLaunches, findBursts, wireMessage, KEEP_MS, WINDOW_MS, COOLDOWN_MS, MAX_PER_DAY } from './wire.js';
import { recordStories, refreshTrack } from './track.js';
import { lookup, candidates, pick, after, sentToday, signalMessage, webhookOf, MAX_PER_DAY as SIGNALS_PER_DAY } from './discord-signals.js';

const DISCORD = 'https://discord.com/api/v10';
const TELEGRAM = 'https://api.telegram.org';
const DAY_CAP = 200;
const CHAT_CAP = 30;
const MAX_TRIES = 4;
const JOBS_PER_TICK = 5;
const MAX_WATCHED = 10;
export const DISCORD_PERMISSIONS = 84992; // View Channels, Send Messages, Embed Links, Read Message History

// Links to posts on X in a message, including the fix-embed sites people paste, as one form. Two at most.
export function postLinks(text) {
  const ids = [...String(text || '').matchAll(/https?:\/\/(?:www\.|mobile\.)?(?:x|twitter|fxtwitter|vxtwitter|fixupx|fixvx)\.com\/(?:\w+|i(?:\/web)?)\/status\/(\d+)/gi)].map((m) => m[1]);
  return [...new Set(ids)].slice(0, 2).map((id) => `https://x.com/i/status/${id}`);
}

const dexLink = (t) => `https://dexscreener.com/${String(t.chain || 'solana').replace(/[^a-z]/g, '')}/${contract(t.address)}`;
const chainNote = { robinhood: 'Robinhood', base: 'Base', bsc: 'BNB' };
const scanLink = (url, from) => `${scanUrl(url)}&from=${from}`;
const OWN = "That's Radar's own post. Send a link to any post about a coin or a story.";
const NONE = 'No coins on this one yet.';
const BUSY = 'Too busy to read this post right now. Try again in a few minutes.';

export function discordReply(found, url) {
  if (found.story === 'our own post') return { content: OWN, allowed_mentions: { parse: [] } };
  if (!found.entries?.length) return { content: NONE, allowed_mentions: { parse: [] } };
  const rows = found.entries.map(({ label, t, stat }) => `**${label}:** [$${ticker(t.symbol)}](${dexLink(t)})${stat ? ` · ${stat}` : ''}${chainNote[t.chain] ? ` · ${chainNote[t.chain]}` : ''}\n\`${contract(t.address)}\``);
  return {
    embeds: [{ title: 'Coins on this post', url, description: rows.join('\n\n'), color: 0x5621AC }],
    components: [{ type: 1, components: [{ type: 2, style: 5, label: 'Full scan + Insta Buy', url: scanLink(url, 'discord') }] }],
    allowed_mentions: { parse: [] },
  };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function telegramReply(found, url) {
  if (found.story === 'our own post') return OWN;
  if (!found.entries?.length) return NONE;
  const rows = found.entries.map(({ label, t, stat }) => `<b>${esc(label)}:</b> <a href="${esc(dexLink(t))}">$${esc(ticker(t.symbol))}</a>${stat ? ` · ${esc(stat)}` : ''}${chainNote[t.chain] ? ` · ${chainNote[t.chain]}` : ''}\n<code>${contract(t.address)}</code>`);
  return `${rows.join('\n\n')}\n\n<a href="${esc(scanLink(url, 'telegram'))}">Full scan + Insta Buy</a>`;
}

export const COMMANDS = [
  { name: 'scan', description: 'Find the coins behind a post on X', type: 1, options: [{ name: 'post', description: 'Link to the post', type: 3, required: true }] },
  { name: 'Scan with Radar', type: 3 },
  { name: 'watch', description: 'Turn automatic scans on or off in this channel', type: 1, default_member_permissions: '16' },
  { name: 'wire', description: 'Make this channel the narrative wire, or turn it off', type: 1, default_member_permissions: '16' },
  { name: 'signals', description: 'Post Radar signals (coins that pass every Radar check) in this channel, or stop', type: 1, default_member_permissions: '16' },
];

const hexBytes = (h) => Uint8Array.from(String(h).match(/../g) || [], (b) => parseInt(b, 16));
export async function verifyDiscord(publicKey, signature, timestamp, body) {
  if (!publicKey || !signature || !timestamp) return false;
  try {
    const key = await crypto.subtle.importKey('raw', hexBytes(publicKey.trim()), { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify('Ed25519', key, hexBytes(signature), new TextEncoder().encode(timestamp + body));
  } catch {
    return false;
  }
}

const reply = (data) => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
const note = (content) => reply({ type: 4, data: { content, flags: 64, allowed_mentions: { parse: [] } } });

// deps: fetch (not the paced one), self (this Worker's SELF binding), scan(url, tries) -> { found, lost }
export function createChat(deps) {
  const discord = (env, method, path, body) => deps.fetch(`${DISCORD}${path}`, {
    method,
    headers: { authorization: `Bot ${String(env.DISCORD_BOT_TOKEN).trim()}`, 'content-type': 'application/json', 'user-agent': 'RadarBot (https://tryradar.fun, 1)' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(12_000),
  });
  const telegram = (env, method, body) => deps.fetch(`${TELEGRAM}/bot${String(env.TELEGRAM_BOT_TOKEN).trim()}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12_000),
  });

  const getKv = async (env, k, fallback) => {
    const row = await env.DB.prepare('SELECT v FROM bot_kv WHERE k = ?').bind(k).first();
    return row ? JSON.parse(row.v) : fallback;
  };
  const setKv = (env, k, v) => env.DB.prepare('INSERT INTO bot_kv (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v').bind(k, JSON.stringify(v)).run();
  const bump = async (env, k) => (await env.DB.prepare('INSERT INTO bot_usage (k, n) VALUES (?, 1) ON CONFLICT (k) DO UPDATE SET n = n + 1 RETURNING n').bind(k).first()).n;
  // Whether this chat may have another scan.
  const allowed = async (env, chat) => {
    const now = new Date().toISOString();
    if (await bump(env, `chat:${chat}:${now.slice(0, 13)}`) > CHAT_CAP) return false;
    return await bump(env, `day:${now.slice(0, 10)}`) <= DAY_CAP;
  };

  async function deliver(env, job, found, busy = false) {
    if (job.via === 'telegram') {
      const r = await telegram(env, 'sendMessage', {
        chat_id: job.chat,
        text: busy ? BUSY : telegramReply(found, job.url),
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        reply_parameters: { message_id: job.message, allow_sending_without_reply: true },
      });
      if (!r.ok) throw new Error(`Telegram ${r.status}`);
      return;
    }
    const body = busy ? { content: BUSY, allowed_mentions: { parse: [] } } : discordReply(found, job.url);
    const r = job.via === 'discord-interaction'
      ? await deps.fetch(`${DISCORD}/webhooks/${String(env.DISCORD_APP_ID).trim()}/${job.token}/messages/@original`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(12_000) })
      : await discord(env, 'POST', `/channels/${job.channel}/messages`, { ...body, message_reference: { message_id: job.message, fail_if_not_exists: false } });
    if (!r.ok) throw new Error(`Discord ${r.status}`);
  }

  // One scan, in a run of this Worker of its own (a scan makes up to about 40 requests, and a run may make 50). A scan
  // DexScreener left short goes on the pending list for the next minute; the last try answers with what it has.
  async function runJob(env, job) {
    const tries = job.tries || 0;
    try {
      const { found, lost } = await deps.scan(job.url, tries);
      if (lost && tries < MAX_TRIES - 1) return { retry: true };
      await deliver(env, job, found);
      return { ok: true };
    } catch (e) {
      if (tries < MAX_TRIES - 1) return { retry: true, error: String(e.message || e).slice(0, 160) };
      await deliver(env, job, null, true).catch(() => {});
      return { gaveUp: String(e.message || e).slice(0, 160) };
    }
  }
  // Scans wait in the queue, one row each, and the minute's cron run starts them. A webhook only adds the row: work started
  // from a webhook gets about 30 seconds after its answer, and a slow post (a busy DexScreener, a video) was cut off with
  // no reply and no retry. A row of its own can't be lost to another write, as one shared list could.
  // The key sorts by time, then by order within this run (two links in one message, the same millisecond).
  let seq = 0;
  const queue = (env, job) => env.DB.prepare('INSERT INTO bot_kv (k, v) VALUES (?, ?)')
    .bind(`job:${String(Date.now()).padStart(15, '0')}:${String(seq++ % 1e6).padStart(6, '0')}:${Math.random().toString(36).slice(2, 10)}`, JSON.stringify({ ...job, tries: job.tries || 0 })).run();
  // The next jobs, oldest first. Deleting is the claim: two runs that overlap can't start the same one.
  async function takeJobs(env, n) {
    const { results } = await env.DB.prepare("SELECT k FROM bot_kv WHERE k >= 'job:' AND k < 'job;' ORDER BY k LIMIT ?").bind(n).all();
    const jobs = [];
    for (const { k } of results || []) {
      const row = await env.DB.prepare('DELETE FROM bot_kv WHERE k = ? RETURNING v').bind(k).first();
      if (row) jobs.push(JSON.parse(row.v));
    }
    return jobs;
  }
  async function dispatch(env, job) {
    const res = await deps.self.fetch('https://radar-bot/chat-job', { method: 'POST', headers: { 'content-type': 'application/json', 'x-bot-token': env.BOT_TOKEN }, body: JSON.stringify(job) })
      .then((r) => r.json()).catch((e) => ({ retry: true, error: String(e.message || e) }));
    if (res.retry) await queue(env, { ...job, tries: (job.tries || 0) + 1 });
    return res;
  }

  async function interaction(request, env, ctx) {
    const body = await request.text();
    const good = await verifyDiscord(env.DISCORD_PUBLIC_KEY, request.headers.get('x-signature-ed25519'), request.headers.get('x-signature-timestamp'), body);
    if (!good) return new Response('bad signature', { status: 401 });
    const i = JSON.parse(body);
    if (i.type === 1) return reply({ type: 1 });
    if (i.type !== 2) return reply({ type: 4, data: { content: 'Not supported.', flags: 64 } });
    const name = i.data?.name;
    if (name === 'watch') {
      const watch = await getKv(env, 'watch', {});
      if (watch[i.channel_id]) {
        delete watch[i.channel_id];
        await setKv(env, 'watch', watch);
        return note('Automatic scans are off in this channel.');
      }
      if (Object.keys(watch).length >= MAX_WATCHED) return note(`Radar can watch ${MAX_WATCHED} channels at most for now.`);
      watch[i.channel_id] = i.id;
      await setKv(env, 'watch', watch);
      return note('Automatic scans are on. Radar now answers any link to a post on X in this channel. It needs to see the channel and post here.');
    }
    if (name === 'wire') {
      const wire = await getKv(env, 'wire', { seen: {} });
      const off = wire.channel === i.channel_id;
      wire.channel = off ? null : i.channel_id;
      await setKv(env, 'wire', wire);
      return note(off ? 'The narrative wire is off.' : 'The narrative wire now posts in this channel.');
    }
    if (name === 'signals') {
      const sig = await getKv(env, 'signals', {});
      const off = sig.channel === i.channel_id;
      sig.channel = off ? null : i.channel_id;
      await setKv(env, 'signals', sig);
      return note(off ? 'Radar signals are off in this channel.' : 'Radar signals now post in this channel: coins Breaking now flagged that pass every Radar check, at most ' + SIGNALS_PER_DAY + ' a day.');
    }
    const text = name === 'scan' ? i.data.options?.[0]?.value : Object.values(i.data.resolved?.messages || {})[0]?.content;
    const url = postLinks(text)[0];
    if (!url) return note('That has no link to a post on X.');
    if (!await allowed(env, i.guild_id || i.channel_id)) return note('Radar has hit its limit for now. Try again later.');
    // "Radar is thinking…" shows until the next minute's run answers; the token is good for 15 minutes.
    try {
      await queue(env, { via: 'discord-interaction', token: i.token, url });
    } catch (e) {
      console.log('discord queue failed', e.message);
      return note(BUSY);
    }
    return reply({ type: 5 });
  }

  const HELP = 'Send me a link to a post on X and I\'ll reply with the coins behind it. Add me to a group and I\'ll do the same for any link posted there.\n\nFull scans at tryradar.fun';
  async function telegramUpdate(request, env, ctx) {
    const secret = String(env.TELEGRAM_SECRET || '').trim();
    if (!secret || request.headers.get('x-telegram-bot-api-secret-token') !== secret) return new Response('forbidden', { status: 403 });
    const u = await request.json().catch(() => ({}));
    const m = u.message;
    if (!m || m.from?.is_bot) return new Response('ok');
    const text = [m.text, m.caption, ...(m.entities || []).concat(m.caption_entities || []).map((e) => e.url)].filter(Boolean).join(' ');
    const urls = postLinks(text);
    if (!urls.length) {
      if (/^\/(start|help|scan)\b/i.test(m.text || '')) ctx.waitUntil(telegram(env, 'sendMessage', { chat_id: m.chat.id, text: HELP, link_preview_options: { is_disabled: true } }).catch(() => {}));
      return new Response('ok');
    }
    // Queued before answering, and answered ok even if that failed: Telegram sends an update again after an error.
    try {
      for (const url of urls) {
        if (!await allowed(env, `tg${m.chat.id}`)) break;
        await queue(env, { via: 'telegram', chat: m.chat.id, message: m.message_id, url });
      }
    } catch (e) {
      console.log('telegram failed', e.message);
    }
    return new Response('ok');
  }

  // The watched channels: what's new in each since the last message seen.
  async function readChannels(env) {
    const watch = await getKv(env, 'watch', {});
    let changed = false;
    const jobs = [];
    for (const [channel, last] of Object.entries(watch)) {
      const r = await discord(env, 'GET', `/channels/${channel}/messages?limit=20&after=${last}`).catch(() => null);
      if (!r?.ok) continue;
      const messages = await r.json();
      if (!messages.length) continue;
      watch[channel] = messages[0].id;
      changed = true;
      for (const m of [...messages].reverse()) {
        if (m.author?.bot) continue;
        for (const url of postLinks(m.content)) jobs.push({ via: 'discord-channel', channel, message: m.id, url, guild: m.guild_id || channel });
      }
    }
    if (changed) await setKv(env, 'watch', watch);
    for (const job of jobs.slice(0, 5)) if (await allowed(env, job.guild)) await queue(env, job);
  }

  // A minute of launches goes in one row, so the wire costs one database write a minute.
  async function wireTick(env, now = Date.now()) {
    const coins = await readLaunches(deps.fetch);
    await env.DB.prepare('INSERT OR REPLACE INTO wire_rows (at, coins) VALUES (?, ?)').bind(now - (now % 60_000), JSON.stringify(coins)).run();
    if (now % 600_000 < 60_000) await env.DB.prepare('DELETE FROM wire_rows WHERE at < ?').bind(now - KEEP_MS).run();
    // Track record (bot/track.js): Breaking now's flags as they happen, and every other minute the caps of the coins flagged.
    await recordStories(env.DB, now).catch((e) => console.log('track record failed', e.message));
    if (Math.floor(now / 60_000) % 2 === 0) await refreshTrack(env.DB, deps.fetch, now).catch((e) => console.log('track refresh failed', e.message));
    const wire = await getKv(env, 'wire', { seen: {} });
    if (!wire.channel) return;
    const bursts = await wireBursts(env, now);
    const today = new Date(now).toISOString().slice(0, 10);
    if (wire.day !== today) { wire.day = today; wire.sent = 0; }
    const burst = bursts.find((b) => now - (wire.seen[b.word] || 0) > COOLDOWN_MS);
    if (!burst || wire.sent >= MAX_PER_DAY) return;
    wire.seen[burst.word] = now;
    wire.seen = Object.fromEntries(Object.entries(wire.seen).filter(([, at]) => now - at < COOLDOWN_MS * 2));
    wire.sent += 1;
    await setKv(env, 'wire', wire);
    const r = await discord(env, 'POST', `/channels/${wire.channel}/messages`, wireMessage(burst));
    if (!r.ok) console.log('wire post failed', r.status);
  }
  async function wireBursts(env, now = Date.now()) {
    const { results } = await env.DB.prepare('SELECT coins FROM wire_rows WHERE at >= ?').bind(now - WINDOW_MS).all();
    return findBursts(results.flatMap((row) => JSON.parse(row.coins)), now);
  }

  // Radar signals (bot/discord-signals.js): Breaking now's flags that pass every check, one a minute at most, to a channel
  // webhook (DISCORD_SIGNALS_WEBHOOK) or the channel chosen with /signals. One Jupiter request a minute, and none at all
  // until there is somewhere to post.
  async function signalsTick(env, now = Date.now()) {
    const hook = webhookOf(env.DISCORD_SIGNALS_WEBHOOK);
    const state = await getKv(env, 'signals', {});
    if (!hook && !(state.channel && env.DISCORD_BOT_TOKEN)) return null;
    if (sentToday(state, now) >= SIGNALS_PER_DAY) return null;
    const rows = await candidates(env.DB, state, now);
    if (!rows.length) return null;
    const best = pick(rows, await lookup(deps.fetch, rows.map((r) => r.mint)));
    if (!best) return null;
    // Saved first: a failed save means no post, never the same coin twice.
    await setKv(env, 'signals', after(state, best.row, now));
    const msg = signalMessage(best.row, best.a, best.check, now);
    const r = hook
      ? await deps.fetch(`${hook}?wait=true`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(msg) })
      : await discord(env, 'POST', `/channels/${state.channel}/messages`, msg);
    if (!r.ok) console.log('signal post failed', r.status);
    return { mint: best.row.mint, ok: r.ok };
  }

  async function tick(env) {
    const steps = [wireTick(env).catch((e) => console.log('wire failed', e.message)), signalsTick(env).catch((e) => console.log('signals failed', e.message))];
    // Watched channels first, so a link posted there this minute starts this minute.
    if (env.DISCORD_BOT_TOKEN) await readChannels(env).catch((e) => console.log('channels failed', e.message));
    // Retries saved as one list before the queue had rows of their own go back in line.
    const pending = await getKv(env, 'pending', []);
    if (pending.length) {
      await setKv(env, 'pending', []);
      for (const job of pending) await queue(env, job);
    }
    for (const job of await takeJobs(env, JOBS_PER_TICK)) steps.push(dispatch(env, job).catch(() => {}));
    await Promise.all(steps);
  }

  async function setup(env, origin) {
    const out = {};
    if (env.DISCORD_BOT_TOKEN && env.DISCORD_APP_ID) {
      const r = await discord(env, 'PUT', `/applications/${String(env.DISCORD_APP_ID).trim()}/commands`, COMMANDS);
      out.discordCommands = r.status;
      out.discordInvite = `https://discord.com/oauth2/authorize?client_id=${String(env.DISCORD_APP_ID).trim()}&scope=bot+applications.commands&permissions=${DISCORD_PERMISSIONS}`;
      out.discordInteractionsUrl = `${origin}/discord`;
    }
    if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_SECRET) {
      const r = await telegram(env, 'setWebhook', { url: `${origin}/telegram`, secret_token: String(env.TELEGRAM_SECRET).trim(), allowed_updates: ['message'] });
      out.telegramWebhook = r.status;
      const me = await telegram(env, 'getMe', {}).then((x) => x.json()).catch(() => ({}));
      out.telegramBot = me.result?.username || null;
      out.telegramSeesGroups = me.result?.can_read_all_group_messages ?? null;
    }
    return out;
  }

  const status = async (env) => ({ discord: !!(env.DISCORD_BOT_TOKEN && env.DISCORD_PUBLIC_KEY && env.DISCORD_APP_ID), telegram: !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_SECRET), watching: Object.keys(await getKv(env, 'watch', {})).length, wire: !!(await getKv(env, 'wire', {})).channel, signals: await (async () => { const sg = await getKv(env, 'signals', {}); return { to: webhookOf(env.DISCORD_SIGNALS_WEBHOOK) ? 'webhook' : sg.channel ? 'channel' : null, today: sentToday(sg), last: sg.last || null }; })(), pending: (await env.DB.prepare("SELECT COUNT(*) AS n FROM bot_kv WHERE k >= 'job:' AND k < 'job;'").first())?.n ?? 0 });

  return { interaction, telegramUpdate, runJob, tick, setup, status, wireBursts, signalsTick };
}
