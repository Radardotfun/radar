// Pull searchable narrative keywords out of a post / headline.
// Priority: $cashtags > #hashtags > Proper Noun phrases > CAPS words > long nouns.

const STOP = new Set(`a about above after again against all almost also am an and any are aren as at be because been before
being below between both but by can cannot could did do does doing down during each even ever every few for from further
get gets got had has have having he her here hers herself him himself his how i if in into is it its itself just let like
made make many may me might more most much must my myself no nor not now of off on once only or other ought our ours
ourselves out over own per really same say says said see seen she should so some still such than that the their theirs them
themselves then there these they this those through to too under until up upon us very via was we were what when where which
while who whom why will with within without would yet you your yours yourself yourselves one two three four five six seven
eight nine ten first last next new old big small good bad best worst top today tonight tomorrow yesterday week weeks month
months year years day days time times people thing things way ways back still ago soon already anyone everyone someone
nothing something everything here's there's it's that's what's who's let's don't doesn't didn't won't can't isn't wasn't
aren't weren't i'm you're we're they're i've you've we've they've i'll you'll we'll they'll`.split(/\s+/));

// News / social filler that never names a narrative.
const FILLER = new Set(`breaking just in news update updates report reports reported reporting according sources source
official officially confirms confirmed confirm announces announced announcement statement live watch video photo photos
thread follow retweet repost reply replies link bio here via exclusive developing alert urgent happening now latest
says said tells told claims claimed per amid after hours minutes earlier later reportedly allegedly sir guys lol lmao
wow omg damn yes yeah okay ok please thanks thank everyone`.split(/\s+/));

// Majors: a $BTC cashtag says "crypto", not a memecoin narrative.
const MAJORS = new Set('btc eth sol usdc usdt bnb xrp ada doge trx usd eur'.split(' '));

const norm = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

export function extractKeywords(text, max = 6, { strongOnly = false } = {}) {
  if (!text) return [];
  const scores = new Map();
  const add = (term, w, strong = true) => {
    const key = norm(term);
    if (key.length < 2 || STOP.has(key) || FILLER.has(key)) return;
    const prev = scores.get(key);
    scores.set(key, { term: prev?.term || term, w: (prev?.w || 0) + w, strong: strong || !!prev?.strong });
  };

  let t = text
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/@\w+/g, ' ')
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}]/gu, ' ');

  for (const [, tag] of t.matchAll(/\$([A-Za-z][A-Za-z0-9]{1,14})\b/g)) {
    if (!MAJORS.has(tag.toLowerCase())) add(tag.toUpperCase(), 12);
  }
  for (const [, tag] of t.matchAll(/#([A-Za-z][A-Za-z0-9_]{2,30})/g)) add(tag, 7);
  t = t.replace(/[$#][A-Za-z0-9_]+/g, ' ');

  // Sentence-split so a capitalised first word isn't mistaken for a name.
  for (const sentence of t.split(/[.!?:;\n|•—–"“”]+/)) {
    const words = sentence.split(/[^A-Za-z0-9'À-ɏ-]+/).filter(Boolean);
    let run = [];
    const flush = () => {
      if (run.length >= 2 && run.length <= 3) add(run.join(' '), 4);
      run = [];
    };
    words.forEach((raw, i) => {
      const w = raw.replace(/^['-]+|['-]+$/g, '').replace(/'s$/i, '');
      const lower = w.toLowerCase();
      if (!w || STOP.has(lower) || FILLER.has(lower) || /^\d+%?$/.test(w)) { flush(); return; }
      const isCaps = /^[A-Z0-9]{2,12}$/.test(w) && /[A-Z]{2}/.test(w);
      const isProper = /^[A-Z][a-zÀ-ɏ]+/.test(w);
      if (isCaps || isProper) {
        // Short Proper words ("Pop") only count inside a phrase; sentence-initial ones are weaker.
        if (isCaps) add(w, 3);
        else add(w, w.length <= 3 ? 1.2 : i === 0 ? 2.5 : 3);
        run.push(w);
        return;
      }
      flush();
      if (lower.length >= 5) add(lower, 0.8, false);
    });
    flush();
  }

  const ranked = [...scores.values()].sort((a, b) => b.w - a.w || b.term.length - a.term.length);
  const strong = ranked.filter((k) => k.strong);
  // Generic lowercase words only help when the post names almost nothing.
  const pool = strong.length >= 2 || strongOnly ? strong : [...strong, ...ranked.filter((k) => !k.strong).slice(0, 3 - strong.length)];
  return pool.slice(0, max).map((k) => k.term);
}

export { norm };
