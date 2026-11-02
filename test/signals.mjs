// The account watcher, offline, on a real SQLite standing in for D1. node test/signals.mjs
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { signalItem } from '../extension/src/lib/alerts.js';
import { signalFeed } from '../server/signals.js';
import { ACCOUNTS, READS_PER_DAY, AI_READS_PER_RUN, queries, searchUrl, postFrom, readable, isSignal, tick, recent, status } from '../bot/signals.js';

const fakeD1 = () => {
  const sql = new DatabaseSync(':memory:');
  return { prepare: (q) => {
    const make = (args) => ({
      bind: (...a) => make(a),
      run: async () => sql.prepare(q).run(...args),
      first: async () => sql.prepare(q).get(...args) ?? null,
      all: async () => ({ results: sql.prepare(q).all(...args) }),
    });
    return make([]);
  } };
};

// Queries fit X's limit and leave nobody out.
const list = queries();
assert.ok(list.every((q) => q.length <= 480), 'each query fits');
assert.ok(list.every((q) => q.endsWith('-is:retweet')), 'no reposts');
for (const a of ACCOUNTS) assert.ok(list.some((q) => q.includes(`from:${a} `) || q.includes(`from:${a})`)), `${a} is asked for`);
assert.equal(new Set(ACCOUNTS).size, ACCOUNTS.length, 'nobody twice');
assert.ok(!ACCOUNTS.includes('grok'), 'a bot that answers everyone would spend the day in minutes');
const signed = searchUrl({ query: list[0], start_time: '2026-11-02T10:00:00Z' });
assert.doesNotMatch(signed.split('?')[1], /[():,]/, 'X refuses a signed URL with these bare');
assert.equal(new URL(signed).searchParams.get('query'), list[0], 'and it still says the same');
console.log(`PASS signals: ${ACCOUNTS.length} accounts in ${list.length} queries`);

// A reply brings the post it answers, and a quote brings the post it quotes.
const includes = {
  users: [{ id: '1', username: 'elonmusk', name: 'Elon Musk' }, { id: '2', username: 'someone', name: 'Someone' }],
  tweets: [{ id: '50', author_id: '2', text: 'A dog just became mayor of a small town' }],
  media: [{ media_key: 'm1', type: 'photo', url: 'https://pbs.twimg.com/a.jpg' }, { media_key: 'm2', type: 'video' }],
};
const reply = postFrom({ id: '100', author_id: '1', text: '@someone @other True', created_at: '2026-11-02T00:00:00.000Z', referenced_tweets: [{ type: 'replied_to', id: '50' }] }, includes);
assert.equal(reply.kind, 'reply');
assert.equal(reply.post.text, 'True', 'the handles it answers are not its words');
assert.equal(reply.post.parent, 'A dog just became mayor of a small town');
assert.equal(reply.post.parentAuthor, 'someone');
assert.equal(reply.post.url, 'https://x.com/elonmusk/status/100');
assert.equal(reply.at, Date.parse('2026-11-02T00:00:00.000Z'));
const quote = postFrom({ id: '101', author_id: '1', text: 'wow', referenced_tweets: [{ type: 'quoted', id: '50' }] }, includes);
assert.equal(quote.kind, 'quote');
assert.equal(quote.post.quoted, 'A dog just became mayor of a small town');
const pic = postFrom({ id: '102', author_id: '1', text: 'lol', attachments: { media_keys: ['m1', 'm2'] } }, includes);
assert.equal(pic.kind, 'post');
assert.deepEqual(pic.post.images, ['https://pbs.twimg.com/a.jpg']);
assert.equal(pic.post.hasVideo, true);
const long = postFrom({ id: '103', author_id: '1', text: 'short…', note_tweet: { text: 'the whole long post' } }, includes);
assert.equal(long.post.text, 'the whole long post', 'a long post is read whole');
const gone = postFrom({ id: '104', author_id: '1', text: 'yes', referenced_tweets: [{ type: 'replied_to', id: '999' }] }, includes);
assert.equal(gone.kind, 'reply', 'a parent X did not send is still a reply');
assert.equal(gone.post.parent, '');
console.log('PASS signals: replies, quotes, pictures and long posts');

// What's worth a read, and what counts.
assert.equal(readable(reply), true, 'a short reply is read with its parent');
assert.equal(readable(pic), true, 'a picture says something');
assert.equal(readable(gone), false, '"yes" to nothing we can see');
assert.equal(readable({ post: { text: 'https://t.co/abc', parent: '', quoted: '', images: [] } }), false, 'a bare link');
assert.equal(isSignal({ score: 95, name: 'Regretamine' }), true);
assert.equal(isSignal({ score: 70 }), true);
assert.equal(isSignal({ score: 69, name: 'Bee Movie' }), false, 'a name alone is not enough');
assert.equal(isSignal(null), false, 'no read is no signal');
console.log('PASS signals: what gets read and what counts');

// A minute's work.
const now = Date.parse('2026-11-02T10:00:00.000Z');
const tweet = (id, text) => ({ id, author_id: '1', text, created_at: new Date(now - 30_000).toISOString() });
const answer = (posts) => ({ data: posts, includes, meta: posts.length ? { newest_id: posts[0].id } : { result_count: 0 } });
const accounts = ['elonmusk'];
const db = fakeD1();
const asked = [];
const reads = [];
const read = async (p) => { reads.push(p.text); return /drug/.test(p.text) ? { score: 95, name: 'Regretamine', why: 'A made up drug' } : { score: 10, name: '', why: 'A company update' }; };
let batch = [tweet('200', 'I have this great idea for a drug called Regretamine'), tweet('199', 'Tesla deliveries were up this quarter')];
const x = async (u) => { asked.push(u); const a = answer(batch); batch = []; return a; };
const r1 = await tick({ db, x, read, now, accounts });
assert.match(asked[0], /start_time=2026-11-02T09%3A58/, 'the first ask starts from now, not from old posts');
assert.doesNotMatch(asked[0], /since_id/);
assert.equal(r1.fetched, 2);
assert.equal(r1.read, 2);
assert.equal(r1.signals, 1);
assert.equal(r1.spent, 3, 'the two posts and the referenced one in includes');
const seen = await recent(db, { only: true });
assert.equal(seen.length, 1);
assert.equal(seen[0].id, '200');
assert.equal(seen[0].narrative, '95: A made up drug');
assert.deepEqual(seen[0].terms, ['Regretamine']);
assert.equal(seen[0].url, 'https://x.com/elonmusk/status/200');
assert.equal((await recent(db)).length, 2, 'the rest are kept to tune against');

// The next minute picks up where it stopped and reads nothing twice.
const before = reads.length;
await tick({ db, x, read, now: now + 60_000, accounts });
assert.match(asked[1], /since_id=200/);
assert.equal(reads.length, before);
// The same post handed back isn't kept or read twice.
batch = [tweet('200', 'I have this great idea for a drug called Regretamine')];
await tick({ db, x, read, now: now + 120_000, accounts });
assert.equal(reads.length, before);
assert.equal((await recent(db)).length, 2);
console.log('PASS signals: picks up where it stopped, reads nothing twice');

// A failed AI read is tried again, and a backlog waits its turn, newest first.
const db2 = fakeD1();
let down = true;
const flaky = async () => { if (down) throw new Error('busy'); return { score: 80, name: 'X1', why: 'x' }; };
batch = [tweet('300', 'something happened in the news today')];
const failed = await tick({ db: db2, x, read: flaky, now, accounts });
assert.equal(failed.read, 0);
assert.match(failed.errors[0], /busy/);
down = false;
assert.equal((await tick({ db: db2, x, read: flaky, now: now + 60_000, accounts })).read, 1);
const db3 = fakeD1();
batch = Array.from({ length: AI_READS_PER_RUN + 5 }, (_, i) => ({ ...tweet(String(400 + i), `post number ${i} about something`), created_at: new Date(now - 1000 * i).toISOString() }));
const order = [];
const log = async (p) => { order.push(p.text); return { score: 5 }; };
assert.equal((await tick({ db: db3, x, read: log, now, accounts })).read, AI_READS_PER_RUN);
assert.equal(order[0], 'post number 0 about something', 'the newest is read first');
assert.equal((await tick({ db: db3, x, read: log, now: now + 60_000, accounts })).read, 5);
console.log('PASS signals: retries and backlog');

// The spending cap holds, and a new day starts again.
const db4 = fakeD1();
let calls = 0;
const costly = async () => { calls += 1; return answer([tweet(String(500 + calls), `a post about something ${calls}`)]); };
const quiet = async () => ({ score: 5 });
const r2 = await tick({ db: db4, x: costly, read: quiet, now, accounts, cap: 3 });
assert.equal(r2.spent, 2);
await tick({ db: db4, x: costly, read: quiet, now: now + 60_000, accounts, cap: 3 });
const capped = await tick({ db: db4, x: costly, read: quiet, now: now + 120_000, accounts, cap: 3 });
assert.equal(capped.capped, true);
assert.equal(calls, 2, 'at the cap X is not asked at all');
await tick({ db: db4, x: costly, read: quiet, now: now + 86_400_000, accounts, cap: 3 });
assert.equal(calls, 3, 'a new day starts again');
assert.equal(READS_PER_DAY, 1000, '$5 a day at $0.005 a post');

// X slowing us down or refusing stops that minute's asking, and loses nothing.
const db5 = fakeD1();
let tries = 0;
const limited = async () => { tries += 1; throw Object.assign(new Error('X 429: slow down'), { status: 429 }); };
const r3 = await tick({ db: db5, x: limited, read: quiet, now, accounts: ACCOUNTS });
assert.equal(tries, 1, 'one refusal is enough for this minute');
assert.match(r3.errors[0], /429/);
assert.equal(r3.fetched, 0);
const st = await status(db4, now + 86_400_000);
assert.equal(st.readsYesterday > 0 && st.readsToday > 0, true);
assert.equal(st.accounts, ACCOUNTS.length);
console.log('PASS signals: the spending cap and X refusing');

// The alert: says a post may set off coins, offers no buy.
const item = signalItem({ id: '200', author: 'elonmusk', name: 'Regretamine', why: 'A made up drug', url: 'https://x.com/elonmusk/status/200', at: now });
assert.equal(item.id, 'signal:200');
assert.equal(item.buy, null, 'an alert about a post never offers a buy');
assert.equal(item.coin.name, 'Regretamine');
assert.equal(item.chart, 'https://tryradar.fun/scan?url=https%3A%2F%2Fx.com%2Felonmusk%2Fstatus%2F200');
// Holders only, and a bad token gets nothing out of the table.
const shut = await signalFeed({}, { DB: { prepare() { throw new Error('should not reach the table'); } }, HOLDER_SECRET: 'x' });
assert.equal(shut.status, 401);
const forged = await signalFeed({ token: 'made.up' }, { DB: { prepare() { throw new Error('should not reach the table'); } }, HOLDER_SECRET: 'x' });
assert.equal(forged.status, 401);
console.log('PASS signals: the alert, and holders only');
