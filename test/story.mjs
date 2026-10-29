// Story check against real posts, run locally (needs ANTHROPIC_API_KEY in the environment).
// node test/story.mjs <x post url> [coin address]
import { engine, storyCheck } from '../server/narrative.js';
import { aggregate, allPairsMany, searchPairs } from '../extension/src/lib/market.js';

const [url, ca] = process.argv.slice(2);
const id = url.match(/status\/(\d+)/)[1];
const t = (await (await fetch(`https://api.fxtwitter.com/status/${id}`)).json()).tweet;
const post = {
  text: t.text || '', quoted: t.quote?.text || '', card: '', author: t.author?.screen_name || '', authorName: t.author?.name || '',
  replyTo: t.replying_to ? [t.replying_to] : [], parent: '', url, hasVideo: !!t.media?.videos?.length,
  images: [...(t.media?.photos || []).map((p) => p.url)].filter((u) => /^https:\/\/pbs\.twimg\.com\//.test(u)).slice(0, 2),
};
let coin = null;
if (ca) {
  const hit = aggregate(await searchPairs(ca)).find((x) => x.address === ca);
  const full = hit ? aggregate(await allPairsMany([hit])).find((x) => x.address === ca) : null;
  if (full) coin = { name: full.name, symbol: full.symbol, address: ca, createdAt: full.createdAt, socials: full.socials, websites: full.websites, fromPost: full.links.some((l) => l.includes(id)), mentioned: post.text.includes(ca) };
}
const ai = engine({ apiKey: process.env.ANTHROPIC_API_KEY });
const t0 = Date.now();
const r = await storyCheck(ai, { post, narrative: '', coin });
console.log(`@${post.author}: ${post.text.slice(0, 90).replace(/\n/g, ' ')}`);
console.log(coin ? `coin ${coin.symbol} socials=${JSON.stringify(coin.socials)} sites=${coin.websites}` : 'no coin');
console.log(`${r.word} ${r.score} | ${r.call}  (${Date.now() - t0}ms, ${r.model})`);
for (const f of r.findings) console.log(`  [${f.kind}] ${f.text}`);
