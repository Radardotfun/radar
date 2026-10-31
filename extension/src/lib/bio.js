// Whether a contract address in the poster's bio is this post's coin, and the name matching behind it. The panel and the bot
// (bot/coins.js) share these, so both name the same coin.
const SOL_CA = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;
const EVM_CAS = /\b0x[a-fA-F0-9]{40}\b/g;

export const sym = (t) => String(t?.symbol || '').replace(/^\$+/, '').toUpperCase();
export const lower = (s) => String(s || '').toLowerCase().trim();
export const key = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

// $TICKERs written in a text, in capitals. "$104K" is a price, not a coin.
export const tickersIn = (text) => [...String(text || '').matchAll(/(?:^|[^\w$])\$([A-Za-z][A-Za-z0-9]{0,11})\b/g)].map((m) => m[1].toUpperCase());

// The judge's 90+ means made for this exact story. Its 80-89 is looser and varies between runs ("Burn" on an account
// update, "Pussy Cat Club" on a Cash Cat post), so there a coin also needs a name the post's story uses: its whole ticker
// or name, or a telling word of it. Kinds of animal and words like "coin" say nothing.
const VAGUE = new Set('the and for with coin coins token tokens meme memes crypto official new baby cat cats kitten kitty dog dogs puppy frog bird'.split(' '));
export const telling = (s) => lower(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !VAGUE.has(w));
export function tiedToPost(t, words) {
  const whole = new Set(words.map(key).filter((k) => k.length >= 2));
  if (whole.has(key(t.symbol)) || whole.has(key(t.name))) return true;
  const used = new Set(words.flatMap(telling));
  return [...telling(t.symbol), ...telling(t.name)].some((w) => used.has(w));
}

// A contract address in the poster's bio counts only when it's tied to this post: the post uses its ticker or name, the coin's
// own links name this account, or the account is plainly the coin's (@cashcat_token with $CASHCAT). A bio often pins a coin
// the post has nothing to do with, and a news account's post isn't about the coin in its bio.
export function bioCas(post) {
  return [...new Set([...(String(post?.bio || '').match(SOL_CA) || []), ...(String(post?.bio || '').match(EVM_CAS) || [])])].slice(0, 2);
}
export function tiedToBio(t, post, words, typed = []) {
  if (!t?.address) return false;
  if (typed.length && !typed.includes(sym(t))) return false; // the post names a different coin
  if (typed.includes(sym(t)) || tiedToPost(t, words)) return true;
  const handle = key(post?.author);
  if (!handle) return false;
  const links = [...(t.socials || []).map((s) => s?.url || s), ...(t.links || [])].map((u) => String(u || '').toLowerCase());
  if (links.some((u) => new RegExp(`(^|//)(www\\.)?(x|twitter)\\.com/${handle}([/?#]|$)`, 'i').test(u))) return true;
  const own = key(t.symbol).length >= 3 && handle.includes(key(t.symbol));
  return own || (key(t.name).length >= 4 && handle.includes(key(t.name)));
}
