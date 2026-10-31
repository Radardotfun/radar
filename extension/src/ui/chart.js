// The chart's frame on X. X's own rules stop a page frame showing a chart, but this extension page may, so the panel frames
// this page and this page frames the chart. It only ever opens a GeckoTerminal embed.
const src = new URLSearchParams(location.search).get('u') || '';
if (/^https:\/\/www\.geckoterminal\.com\/[a-z]+\/pools\/[A-Za-z0-9]{20,70}\?embed=1&[\w=&]*$/.test(src)) {
  const frame = document.createElement('iframe');
  frame.title = 'Chart';
  frame.referrerPolicy = 'no-referrer';
  frame.src = src;
  document.body.append(frame);
}
