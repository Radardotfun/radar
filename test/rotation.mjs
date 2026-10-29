// Key rotation with a stubbed network: limited keys hand over to the next key, then the next provider.
import { engine, interpret } from '../server/narrative.js';
const calls = [];
const reply = { narrative: 'Elon calls his dog Floki the CEO', coinable: true, terms: ['Floki', 'Floki CEO'], anchors: ['floki'] };
globalThis.fetch = async (url, opts) => {
  const key = opts?.headers?.authorization?.slice(7);
  const host = new URL(url).host;
  calls.push(`${host}:${key}`);
  const limited = key.startsWith('dead');
  if (limited) return new Response('{"error":"rate limited"}', { status: 429 });
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] }), { status: 200 });
};
const post = { text: 'Floki is the real CEO of X', author: 'elonmusk' };
for (const [label, env] of [
  ['groq key1 limited, key2 ok', { GROQ_API_KEY: 'dead-1, live-2' }],
  ['all groq limited -> gemini', { GROQ_API_KEY: 'dead-1,dead-2', GEMINI_API_KEY: 'live-g' }],
  ['everything limited', { GROQ_API_KEY: 'dead-1', OPENROUTER_API_KEY: 'dead-o' }],
]) {
  calls.length = 0;
  const ai = engine({ env });
  const r = await interpret(ai, post).catch((e) => ({ error: e.message }));
  console.log(label.padEnd(30), '|', r.error ? `ERROR ${r.error}` : `${r.model} -> ${r.narrative} [${r.anchors}]`, '| calls:', calls.join(' '));
}
