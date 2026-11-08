// POST /ask { token, coin, question, evidence }: Ask Radar. A holder's question about a coin card, answered by the AI only
// from what Radar found on that card (narrative.js askCoin). Holders only (server/holder.js), with daily limits, because each
// answer costs an AI call. Larpcheck's verdicts never go in: their terms say a verdict is never reworded.
import { readToken } from './holder.js';
import { spend } from './lc.js';

export const ASKS_PER_WALLET = 20;
export const ASKS_PER_DAY = 400;
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const clip = (s, n) => (typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : '');

export async function askRoute(body, env, { ai, answer }) {
  const wallet = await readToken(env, body?.token);
  if (!wallet) return { status: 401, data: { error: 'Your holder check ran out. Connect your wallet again.' } };
  const question = clip(body?.question, 300);
  if (!question) return { status: 400, data: { error: 'Ask a question first.' } };
  const evidence = (Array.isArray(body?.evidence) ? body.evidence : []).map((e) => clip(e, 300)).filter(Boolean).slice(0, 30);
  if (evidence.length < 2) return { status: 400, data: { error: 'Open the coin card first, so Radar has something to go on.' } };
  const coin = { symbol: clip(body?.coin?.symbol, 20), address: ADDRESS.test(body?.coin?.address || '') ? body.coin.address : '' };
  if (!await spend(env, `ask:${wallet}`, ASKS_PER_WALLET)) return { status: 429, data: { error: `You've asked ${ASKS_PER_WALLET} questions today. Try again tomorrow.` } };
  if (!await spend(env, 'ask', ASKS_PER_DAY)) return { status: 429, data: { error: 'Radar has answered all it can today. Try again tomorrow.' } };
  try {
    const r = await answer(ai(), { coin, question, evidence });
    if (!r.answer) throw new Error('empty answer');
    return { status: 200, data: { answer: clip(r.answer, 700) } };
  } catch (e) {
    console.error('ask', e?.message);
    return { status: 502, data: { error: "Radar couldn't answer just now. Try again in a minute." } };
  }
}
