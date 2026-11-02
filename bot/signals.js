// Watches big accounts for posts, replies and quotes that coins get made from. Each minute it asks X for what's new, has
// Radar's AI read each one, and keeps the answer in D1. It tells nobody by itself: the alerts read what's kept here.
export const ACCOUNTS = [
  'elonmusk', 'realDonaldTrump', 'WhiteHouse', 'JDVance', 'DOGE', 'cb_doge',
  'Polymarket', 'Kalshi',
  'cz_binance', 'heyibinance', 'binance', 'VitalikButerin', 'saylor', 'brian_armstrong', 'jessepollak', 'solana', 'Pumpfun', 'a1lon9', 'blknoiz06', 'MustStopMurad', 'zachxbt',
  // Not @grok: it answers everyone, about 2 posts a second, and would spend the day's reads in minutes.
  'sama', 'OpenAI', 'xai', 'Tesla', 'SpaceX', 'NASA', 'pmarca',
  'MrBeast', 'kanyewest', 'SnoopDogg', 'Cobratate', 'TuckerCarlson', 'Pontifex',
  'PopBase', 'PopCrave', 'DramaAlert', 'TMZ', 'Dexerto', 'nypost', 'BBCBreaking', 'DeItaone', 'WatcherGuru', 'unusual_whales', 'spectatorindex', 'disclosetv',
];

// X charges $0.005 for each post it hands back, so this is $5 a day. Past it the watcher waits for the next UTC day.
export const READS_PER_DAY = 2000;
// A run may make only 50 requests, and the rest wait for the next minute.
export const AI_READS_PER_RUN = 12;
const QUERY_MAX = 480;
const SEARCH = 'https://api.x.com/2/tweets/search/recent';
const FIELDS = {
  'tweet.fields': 'created_at,author_id,referenced_tweets,note_tweet,attachments,entities',
  expansions: 'author_id,referenced_tweets.id,referenced_tweets.id.author_id,attachments.media_keys',
  'user.fields': 'username,name',
  'media.fields': 'url,type',
  max_results: '100',
};
// X answers 401 to a signed URL with a bare ":", "(" or ",", so every value is fully escaped.
const pct = (s) => encodeURIComponent(String(s)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
export const searchUrl = (params) => `${SEARCH}?${Object.entries({ ...params, ...FIELDS }).map(([k, v]) => `${k}=${pct(v)}`).join('&')}`;

/** X's search takes a limited query, so the accounts are split across several. */
export function queries(accounts = ACCOUNTS, max = QUERY_MAX) {
  const out = [];
  const tail = ' -is:retweet';
  let now = [];
  for (const a of accounts) {
    const next = [...now, `from:${a}`];
    if (`(${next.join(' OR ')})${tail}`.length > max && now.length) {
      out.push(`(${now.join(' OR ')})${tail}`);
      now = [`from:${a}`];
    } else now = next;
  }
  if (now.length) out.push(`(${now.join(' OR ')})${tail}`);
  return out;
}

const textOf = (t) => t?.note_tweet?.text || t?.text || '';

/** One post from X's answer, in the shape Radar's AI read takes. */
export function postFrom(t, includes = {}) {
  const users = new Map((includes.users || []).map((u) => [u.id, u]));
  const tweets = new Map((includes.tweets || []).map((x) => [x.id, x]));
  const media = new Map((includes.media || []).map((m) => [m.media_key, m]));
  const author = users.get(t.author_id);
  const ref = (type) => {
    const id = (t.referenced_tweets || []).find((r) => r.type === type)?.id;
    return id ? tweets.get(id) || { id } : null;
  };
  const parent = ref('replied_to');
  const quoted = ref('quoted');
  const files = (t.attachments?.media_keys || []).map((k) => media.get(k)).filter(Boolean);
  const username = author?.username || '';
  return {
    id: t.id,
    at: Date.parse(t.created_at) || null,
    kind: parent ? 'reply' : quoted ? 'quote' : 'post',
    post: {
      // A reply's text starts with the handles it answers, which say nothing about the post.
      text: textOf(t).replace(/^(@\w+\s+)+/, ''),
      quoted: textOf(quoted),
      parent: textOf(parent),
      parentAuthor: users.get(parent?.author_id)?.username || '',
      author: username,
      authorName: author?.name || '',
      url: username ? `https://x.com/${username}/status/${t.id}` : '',
      images: files.filter((m) => m.type === 'photo' && m.url).map((m) => m.url).slice(0, 2),
      hasVideo: files.some((m) => m.type !== 'photo'),
    },
  };
}

// "True", "!!", "Interesting" on nothing we can see can't be read. A short reply can still count: the post it answers is read too.
export function readable(p) {
  const own = p.post.text.replace(/https?:\/\/\S+/g, '').trim();
  return own.length >= 12 || !!p.post.parent || !!p.post.quoted || p.post.images.length > 0;
}

/** The AI's score for a post: would people launch coins off it? Strict, because people turn off noisy alerts. */
export const SIGNAL_SCORE = 70;
export const isSignal = (read) => (read?.score || 0) >= SIGNAL_SCORE;

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS signals (id TEXT PRIMARY KEY, author TEXT, at INTEGER, kind TEXT, post TEXT, state TEXT, signal INTEGER, narrative TEXT, terms TEXT, read_at INTEGER)',
  'CREATE INDEX IF NOT EXISTS signals_state ON signals (state, at)',
  'CREATE INDEX IF NOT EXISTS signals_signal ON signals (signal, at)',
  'CREATE TABLE IF NOT EXISTS signal_meta (k TEXT PRIMARY KEY, v TEXT)',
];
const dayOf = (now) => new Date(now).toISOString().slice(0, 10);
const getMeta = async (db, k) => (await db.prepare('SELECT v FROM signal_meta WHERE k = ?').bind(k).first())?.v ?? null;
const setMeta = (db, k, v) => db.prepare('INSERT INTO signal_meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').bind(k, String(v)).run();

/** db: D1. x(url): X's JSON answer. read(post): the AI's read. One minute's work: fetch what's new, then read what's waiting. */
export async function tick({ db, x, read, now = Date.now(), accounts = ACCOUNTS, cap = READS_PER_DAY }) {
  for (const sql of SCHEMA) await db.prepare(sql).run();
  const day = dayOf(now);
  const spentKey = `reads:${day}`;
  let spent = Number(await getMeta(db, spentKey)) || 0;
  const out = { spent, fetched: 0, read: 0, signals: 0, capped: false, errors: [] };
  const list = queries(accounts);
  for (let i = 0; i < list.length; i++) {
    if (spent >= cap) { out.capped = true; break; }
    const key = `since:${i}`;
    const since = await getMeta(db, key);
    // The first ask starts from now: old posts are nobody's news, and they'd cost money.
    const from = since ? { since_id: since } : { start_time: new Date(now - 90_000).toISOString().replace(/\.\d+Z$/, 'Z') };
    let page;
    try {
      page = await x(searchUrl({ query: list[i], ...from }));
    } catch (e) {
      out.errors.push(String(e.message || e).slice(0, 160));
      // X asked us to slow down or the money ran out: asking again this minute only makes it worse.
      if (e.status === 429 || e.status === 402 || e.status === 403) break;
      continue;
    }
    // Referenced posts come back too, and may be billed, so they count.
    const posts = page.data || [];
    spent += posts.length + (page.includes?.tweets?.length || 0);
    await setMeta(db, spentKey, spent);
    if (page.meta?.newest_id) await setMeta(db, key, page.meta.newest_id);
    for (const t of posts) {
      const p = postFrom(t, page.includes);
      await db.prepare('INSERT OR IGNORE INTO signals (id, author, at, kind, post, state) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(p.id, p.post.author, p.at, p.kind, JSON.stringify(p.post), readable(p) ? 'new' : 'skipped').run();
      out.fetched += 1;
    }
  }
  out.spent = spent;
  // Newest first: if posts pile up, the fresh ones are the ones worth knowing about.
  const waiting = (await db.prepare("SELECT id, post FROM signals WHERE state = 'new' ORDER BY at DESC LIMIT ?").bind(AI_READS_PER_RUN).all()).results || [];
  for (const row of waiting) {
    let r;
    try {
      r = await read(JSON.parse(row.post));
    } catch (e) {
      out.errors.push(`read: ${String(e.message || e).slice(0, 120)}`);
      continue; // still 'new', so it's tried again next minute
    }
    const hit = isSignal(r);
    await db.prepare("UPDATE signals SET state = 'read', signal = ?, narrative = ?, terms = ?, read_at = ? WHERE id = ?")
      .bind(hit ? 1 : 0, `${Math.round(r?.score || 0)}: ${String(r?.why || '').slice(0, 180)}`, JSON.stringify(r?.name ? [r.name] : []), now, row.id).run();
    out.read += 1;
    if (hit) out.signals += 1;
  }
  return out;
}

/** What the watcher has seen lately, newest first. only: just the ones it would alert on. */
export async function recent(db, { limit = 50, only = false } = {}) {
  for (const sql of SCHEMA) await db.prepare(sql).run();
  const rows = (await db.prepare(`SELECT id, author, at, kind, post, state, signal, narrative, terms, read_at FROM signals ${only ? 'WHERE signal = 1' : ''} ORDER BY at DESC LIMIT ?`).bind(limit).all()).results || [];
  return rows.map((r) => {
    const post = JSON.parse(r.post || '{}');
    return { id: r.id, author: r.author, at: r.at, kind: r.kind, state: r.state, signal: !!r.signal, narrative: r.narrative, terms: JSON.parse(r.terms || '[]'), url: post.url, text: String(post.text || '').slice(0, 200), parent: String(post.parent || post.quoted || '').slice(0, 140), lag: r.read_at && r.at ? Math.round((r.read_at - r.at) / 1000) : null };
  });
}

/** Today's reads and yesterday's, and how many posts it has seen. */
export async function status(db, now = Date.now()) {
  for (const sql of SCHEMA) await db.prepare(sql).run();
  const reads = (d) => getMeta(db, `reads:${dayOf(d)}`);
  const counts = (await db.prepare("SELECT state, signal, COUNT(*) n FROM signals WHERE at > ? GROUP BY state, signal").bind(now - 86_400_000).all()).results || [];
  return { readsToday: Number(await reads(now)) || 0, readsYesterday: Number(await reads(now - 86_400_000)) || 0, cap: READS_PER_DAY, last24h: counts, accounts: ACCOUNTS.length, queries: queries().length };
}
