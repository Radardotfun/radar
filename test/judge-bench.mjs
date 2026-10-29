// Time /judge per free model on a realistic 30-candidate list.
const token = process.argv[2];
const U = 'https://narrative-radar.millenia-portfolio.workers.dev/judge';
const names = ['OFFICIAL TRUMP|TRUMP', 'Golden Eagle|EAGLE', 'Bald Eagle|BALD', 'Trump Eagle|TEAGLE', 'MAGA|MAGA', 'Statue|STATUE', 'Gold|GOLD', 'Washington|WASH', 'DC Coin|DC', 'Eagle Coin|EGL',
  'Golden Statue|GSTATUE', 'American Eagle|AEAGLE', 'Freedom|FREEDOM', 'Pepe|PEPE', 'Trump Statue|TSTATUE', 'Gold Trump|GTRUMP', 'Eagle Inu|EINU', 'Bonk|BONK', 'Baby Trump|BTRUMP', 'Melania|MELANIA',
  'USA|USA', 'Patriot|PATRIOT', 'Golden Age|GOLDAGE', 'Liberty|LIBERTY', 'Statue of Liberty|LIBERTY', 'Bird|BIRD', 'Hawk Tuah|HAWK', 'Make America|MAGA2', 'DJT|DJT', 'Golden|GLD'];
const candidates = names.map((n, i) => { const [name, symbol] = n.split('|'); return { name, symbol, age: `${i + 1}d`, mc: '$120K', vol: '$40K', fromPost: false, links: [] }; });
const models = ['@cf/meta/llama-3.3-70b-instruct-fp8-fast'];
for (const m of models) {
  for (let rep = 0; rep < 2; rep++) {
    const t = Date.now();
    const r = await fetch(U, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ narrative: `Trump plans a giant golden bald eagle statue in DC (${rep}${m})`, post: { text: 'JUST IN: Donald Trump says the US will build a giant golden statue of a bald eagle in Washington DC' }, candidates, debug: token, models: [m] }) });
    const d = await r.json().catch(() => ({}));
    console.log(m.split('/').pop().padEnd(34), String(Date.now() - t).padStart(6), 'ms', d.error || `kept ${d.matches?.length}: ${d.matches?.slice(0, 6).map((x) => candidates[x.i]?.symbol + ':' + x.score).join(' ')}`);
  }
}
