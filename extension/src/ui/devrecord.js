// Dev record in the panel: the words for a record from lib/devrecord.js. Numbers only; it never calls the dev anything.

// From this many launches, a wallet reads as a serial launcher.
export const SERIAL = 10;

/** { head, sub, level } for a record, or null when there is nothing to show. */
export function devSummary(r) {
  if (!r?.creator || !r.launches) return null;
  const n = r.launches;
  const fmt = (x) => x.toLocaleString('en-US');
  if (n === 1) return { head: 'Its only coin on pump.fun', sub: r.thisBonded ? 'It bonded' : 'Not bonded yet', level: 'neutral' };
  return {
    head: `${fmt(n)} coins from this wallet`,
    sub: `${fmt(r.bonded)} bonded · ${fmt(n - r.bonded)} not bonded`,
    level: n >= SERIAL ? 'warn' : 'neutral',
  };
}
