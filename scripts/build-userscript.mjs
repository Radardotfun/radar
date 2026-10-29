// Builds the userscript: one readable (non-minified) file that runs Radar in Tampermonkey,
// Violentmonkey, ScriptCat, Userscripts (Safari, iPhone) and Stay. Output: web/radar.user.js plus
// web/radar.meta.js (header only, what managers poll for updates).
// node scripts/build-userscript.mjs
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';

const { version, description } = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
const SITE = 'https://tryradar.fun';

// Every host the radar calls. Managers only allow GM requests to hosts listed here.
const CONNECT = [
  'api.dexscreener.com', 'cdn.dexscreener.com', 'dd.dexscreener.com',
  'api.rugcheck.xyz',
  'api.mainnet-beta.solana.com', 'solana-rpc.publicnode.com',
  'narrative-radar.millenia-portfolio.workers.dev',
  'cdn.syndication.twimg.com', 'video.twimg.com',
];

const meta = [
  '// ==UserScript==',
  '// @name         Radar',
  '// @namespace    https://tryradar.fun',
  `// @version      ${version}`,
  `// @description  ${description}`,
  `// @homepageURL  ${SITE}`,
  `// @supportURL   ${SITE}`,
  `// @icon         ${SITE}/icons/icon128.png`,
  '// @match        https://x.com/*',
  '// @match        https://twitter.com/*',
  '// @match        https://pro.x.com/*',
  '// @match        https://mobile.x.com/*',
  '// @grant        GM.xmlHttpRequest',
  '// @grant        GM_xmlhttpRequest',
  '// @grant        GM.getValue',
  '// @grant        GM.setValue',
  '// @grant        GM.openInTab',
  ...CONNECT.map((h) => `// @connect      ${h}`),
  '// @inject-into  content',
  '// @run-at       document-idle',
  '// @noframes',
  `// @updateURL    ${SITE}/radar.meta.js`,
  `// @downloadURL  ${SITE}/radar.user.js`,
  '// ==/UserScript==',
].join('\n');

const result = await build({
  entryPoints: ['userscript/main.js'],
  bundle: true,
  format: 'iife',
  target: ['chrome110', 'firefox115', 'safari16'],
  minify: false, // userscript hosts (Greasy Fork) require readable code
  inject: ['userscript/inject.js'],
  loader: { '.css': 'text' },
  legalComments: 'none',
  write: false,
  logLevel: 'warning',
});

const code = `${meta}\n\n// Radar ${version}: built from the extension source at ${SITE}. Not financial advice.\n${result.outputFiles[0].text}`;
writeFileSync('web/radar.user.js', code);
writeFileSync('web/radar.meta.js', `${meta}\n`);
console.log(`radar.user.js ${version}: ${(code.length / 1024).toFixed(0)} KB`);
