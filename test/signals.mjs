// The account watcher, offline, on a real SQLite standing in for D1. node test/signals.mjs
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { signalItem, signalCoins } from '../extension/src/lib/alerts.js';
import { signalFeed } from '../server/signals.js';
import { makeToken } from '../server/holder.js';
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

// One story is one alert: Elon's "space lasers" joke alerted three times on 4 Nov (his post, then @unusual_whales and
// @Kalshi repeating it), and @PopCrave's post twice (posted again with a typo fixed). A different story still alerts.
{
  const dbd = fakeD1();
  const hot = async () => ({ score: 80, name: 'Space Lasers', why: 'quotable' });
  const at = (t, id, text) => ({ ...tweet(id, text), created_at: new Date(t - 30_000).toISOString() });
  batch = [at(now, '500', 'Guess my election-interfering space lasers didn’t work this time 🤷‍♂️')];
  assert.equal((await tick({ db: dbd, x, read: hot, now, accounts })).signals, 1);
  batch = [at(now + 9 * 60_000, '501', 'BREAKING: Elon Musk has said: Guess my election-interfering space lasers didn’t work this time')];
  assert.equal((await tick({ db: dbd, x, read: hot, now: now + 9 * 60_000, accounts })).signals, 0, 'the same story told again');
  batch = [at(now + 150 * 60_000, '502', 'JUST IN: Elon Musk says his "election-interfering space lasers" didn’t work this time https://t.co/x')];
  assert.equal((await tick({ db: dbd, x, read: hot, now: now + 150 * 60_000, accounts })).signals, 0, 'two hours later still');
  batch = [at(now + 160 * 60_000, '503', 'JUST IN: Sam Altman changes X name to "Ram Altman"')];
  assert.equal((await tick({ db: dbd, x, read: hot, now: now + 160 * 60_000, accounts })).signals, 1, 'another story');
  batch = [at(now + 8 * 3600e3, '504', 'Guess my election-interfering space lasers didn’t work this time, says Elon')];
  assert.equal((await tick({ db: dbd, x, read: hot, now: now + 8 * 3600e3, accounts })).signals, 1, 'after 6 hours it can alert again');
  const dup = (await recent(dbd)).find((r) => r.id === '501');
  assert.match(dup.narrative, /same story as 500/);
  // An account replying to its own alerted post is the same story: Dexerto posted a hawk "too fat to fly" and replied a
  // minute later ("The Wildlife Center couldn't figure out what was wrong with the bird"), and both alerted.
  const { sameStory } = await import('../bot/signals.js');
  const tNow = now + 9 * 3600e3;
  await dbd.prepare("INSERT INTO signals (id, author, at, kind, post, state, signal) VALUES ('600', 'Dexerto', ?, 'post', ?, 'read', 1)").bind(tNow - 60_000, JSON.stringify({ text: 'A hawk has been diagnosed as too fat to fly after eating too many free-range chickens' })).run();
  const reply = { id: '601', post: JSON.stringify({ text: "The Wildlife Center couldn't figure out what was wrong with the bird", parent: 'A hawk has been diagnosed as too fat to fly after eating too many free-range chickens' }) };
  assert.equal(await sameStory(dbd, reply, tNow), '600', 'a reply to an alerted post');
  const other = { id: '602', post: JSON.stringify({ text: 'Four other robots have been made full-time employees at the store', parent: 'A grocery chain hires a robot' }) };
  assert.equal(await sameStory(dbd, other, tNow), null, 'another story');
  console.log('PASS signals: one story is one alert');
}

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
assert.equal(READS_PER_DAY, 2000, '$10 a day at $0.005 a post');

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
// The top 3: a coin the post names first, then the picks, no repeats, never more than 3, and nothing when the scan found nothing.
const tok = (address, symbol) => ({ address, symbol, chain: 'solana', marketCap: 1000 });
const three = signalCoins({ mentioned: [tok('a1', 'NAMED')], picks: [{ role: 'top', token: tok('a2', 'TOP') }, null, { role: 'og', token: tok('a1', 'NAMED') }, { role: 'mover', token: tok('a3', 'MOVE') }, { role: 'x', token: tok('a4', 'FOUR') }] });
assert.deepEqual(three.map((c) => c.address), ['a1', 'a2', 'a3']);
assert.deepEqual(three.map((c) => c.label), ['In the post', 'Top', 'Mover']);
assert.deepEqual(signalCoins(null), []);
assert.deepEqual(signalCoins({ picks: [] }), []);
assert.deepEqual(item.coins, [], 'the alert starts with none');
// Holders only, and a bad token gets nothing out of the table.
const shut = await signalFeed({}, { DB: { prepare() { throw new Error('should not reach the table'); } }, HOLDER_SECRET: 'x' });
assert.equal(shut.status, 401);
const forged = await signalFeed({ token: 'made.up' }, { DB: { prepare() { throw new Error('should not reach the table'); } }, HOLDER_SECRET: 'x' });
assert.equal(forged.status, 401);
// A real signed token on the real query: flagged posts only, newest first, nothing older than asked, none too old.
const db6 = fakeD1();
let fed = [tweet('600', 'I have this great idea for a drug called Regretamine'), tweet('601', 'Tesla deliveries were up this quarter')];
const hand = async () => { const a = answer(fed); fed = []; return a; };
await tick({ db: db6, x: hand, read, now, accounts, clock: () => now });
const env6 = { DB: db6, HOLDER_SECRET: 'test-secret' };
const { token } = await makeToken(env6, 'So11111111111111111111111111111111111111112', now);
const fedOut = await signalFeed({ token, since: now - 600_000 }, env6, { now });
assert.equal(fedOut.status, 200);
assert.deepEqual(fedOut.body.items.map((i) => i.id), ['600'], 'only the flagged post');
const one = fedOut.body.items[0];
assert.equal(one.author, 'elonmusk');
assert.equal(one.name, 'Regretamine');
assert.equal(one.why, 'A made up drug', 'the score is taken off the reason');
assert.equal(one.url, 'https://x.com/elonmusk/status/600');
assert.equal(one.post.author, 'elonmusk');
assert.match(one.post.text, /Regretamine/, 'the post comes along, for the scan');
assert.equal(one.at, now, 'the cursor is when it was judged');
// An older post flagged after a newer one was delivered is still picked up.
const db7 = fakeD1();
const env7 = { DB: db7, HOLDER_SECRET: 'test-secret' };
const { token: t7 } = await makeToken(env7, 'So11111111111111111111111111111111111111112', now);
let fed7 = [{ ...tweet('701', 'a drug called Newer'), created_at: new Date(now - 1000).toISOString() }];
const hand7 = async () => { const a = answer(fed7); fed7 = []; return a; };
await tick({ db: db7, x: hand7, read, now, accounts, clock: () => now });
const first7 = await signalFeed({ token: t7, since: now - 1000 }, env7, { now: now + 1000 });
assert.deepEqual(first7.body.items.map((i) => i.id), ['701']);
fed7 = [{ ...tweet('700', 'a drug called Older'), created_at: new Date(now - 60_000).toISOString() }];
await tick({ db: db7, x: hand7, read, now: now + 60_000, accounts, clock: () => now + 60_000 });
const next7 = await signalFeed({ token: t7, since: first7.body.items[0].at }, env7, { now: now + 61_000 });
assert.deepEqual(next7.body.items.map((i) => i.id), ['700'], 'older, judged later, not lost');
assert.equal((await signalFeed({ token, since: now }, env6, { now })).body.items.length, 0, 'nothing since the last look');
assert.equal((await signalFeed({ token, since: 1 }, env6, { now: now + 7_200_000 })).status, 200);
assert.equal((await signalFeed({ token, since: 1 }, env6, { now: now + 7_200_000 })).body.items.length, 0, 'an hour old is too old, whatever the since');
assert.equal((await signalFeed({ token }, env6, { now: now + 90 * 86_400_000 })).status, 401, 'an expired token is refused');
const alertFrom = signalItem(one);
assert.equal(alertFrom.watch.author, 'elonmusk');
assert.equal(alertFrom.text, 'A made up drug');
// The alerts page. No token and asking for the public list: the same posts 10 minutes late, with nothing to scan.
const db8 = fakeD1();
const env8 = { DB: db8, HOLDER_SECRET: 'test-secret' };
let fed8 = [tweet('800', 'a drug called Delayed')];
const hand8 = async () => { const a = answer(fed8); fed8 = []; return a; };
await tick({ db: db8, x: hand8, read, now, accounts, clock: () => now });
const noCache = { cache: null };
assert.equal((await signalFeed({ public: true }, env8, { now: now + 60_000, ...noCache })).body.items.length, 0, 'not yet, for 10 minutes');
const late = await signalFeed({ public: true }, env8, { now: now + 660_000, ...noCache });
assert.equal(late.status, 200);
assert.equal(late.body.live, false);
assert.deepEqual(late.body.items.map((i) => i.id), ['800'], 'then it shows');
assert.equal(late.body.items[0].post, undefined, 'the public list has nothing to scan for coins');
assert.equal((await signalFeed({ public: true }, env8, { now: now + 25 * 3_600_000, ...noCache })).body.items.length, 0, 'gone after a day');
assert.equal((await signalFeed({}, env8, { now, ...noCache })).status, 401, 'asking for nothing gets nothing');
assert.equal((await signalFeed({ token: 'made.up', public: true }, env8, { now, ...noCache })).status, 401, 'a bad token is refused, not handed the public list');
// A holder asking for history sees the day's list straight away, ready to scan.
const { token: t8 } = await makeToken(env8, 'So11111111111111111111111111111111111111112', now);
const hist = await signalFeed({ token: t8, history: true }, env8, { now: now + 2 * 3_600_000, ...noCache });
assert.equal(hist.body.live, true);
assert.deepEqual(hist.body.items.map((i) => i.id), ['800']);
assert.match(hist.body.items[0].post.text, /Delayed/);
assert.equal((await signalFeed({ token: t8, since: 1 }, env8, { now: now + 2 * 3_600_000, ...noCache })).body.items.length, 0, 'the extension still only looks back an hour');
console.log('PASS signals: the public list is late, the holder list is live');
console.log('PASS signals: a signed token on the real query');
console.log('PASS signals: the alert, and holders only');
