// Radar Guard, a $RADAR holder perk (extension only): alerts on the coins in the watchlist. It speaks up when the post behind a
// coin is gone, when Larpcheck's verdict turns bad, or when liquidity falls hard. It says what happened and tells nobody to sell.
import { verdictTurned } from './alerts.js';

export const GUARD_KEY = 'radar-guard';
export const GUARD_MINUTES = 5;
// Liquidity down this far from where it was when the coin was starred, or first seen in a pool. Pools under $1,000 swing too much to mean anything.
export const LIQUIDITY_DROP = 0.3;
const MIN_LIQUIDITY = 1000;

const name = (star) => `$${String(star.symbol || '').trim()}`;

/**
 * One look at one starred coin. seen: { live: its token now, lc: Larpcheck's answer, gone: the post no longer opens }, each
 * unknown when its source couldn't answer. was: what the last look kept. -> { state: what to keep, events: what to say }.
 * The first verdict only notes where it stands: it was on the card when the coin was starred.
 */
export function lookAtStar(star, { live = null, lc = null, gone = null }, was = {}) {
  const state = { ...was };
  const events = [];
  if (lc?.checked) {
    if (was.word && verdictTurned(was.word, lc.verdict)) events.push({ reason: 'verdict', word: lc.verdict });
    state.word = lc.verdict;
  }
  if (gone === true && !was.postGone) {
    state.postGone = true;
    events.push({ reason: 'post', text: `The post behind ${name(star)} is gone` });
  }
  if (live && !live.onCurve) {
    const base = was.liq || star.liq || 0;
    if (!base) state.liq = live.liquidity || 0; // on its launch curve when starred: its first pool is the starting point
    else {
      state.liq = base;
      if (!was.liqSent && base >= MIN_LIQUIDITY && live.liquidity <= base * (1 - LIQUIDITY_DROP)) {
        state.liqSent = true;
        events.push({ reason: 'liquidity', text: `${name(star)} liquidity is down ${Math.round((1 - live.liquidity / base) * 100)}% since you starred it` });
      }
    }
  }
  return { state, events };
}
