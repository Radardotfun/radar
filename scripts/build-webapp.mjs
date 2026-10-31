// Builds Radar on the web: webapp/main.js plus the extension's panel and backend, bundled into web/scan.js for
// tryradar.fun/scan. Readable (not minified), like the userscript, so the site's code can be checked.
// node scripts/build-webapp.mjs
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));

const result = await build({
  entryPoints: ['webapp/main.js'],
  bundle: true,
  format: 'iife',
  target: ['chrome110', 'firefox115', 'safari16'],
  minify: false,
  loader: { '.css': 'text' },
  legalComments: 'none',
  write: false,
  logLevel: 'warning',
});

const code = `// Radar ${version} on the web: built from the extension source at https://tryradar.fun. Not financial advice.\n${result.outputFiles[0].text}`;
writeFileSync('web/scan.js', code);
console.log(`scan.js ${version}: ${(code.length / 1024).toFixed(0)} KB`);

// The launch page, with pump's SDK and Solana's web3.js. Minified for size; its source is webapp/launch.js.
const launch = await build({
  entryPoints: ['webapp/launch.js'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome110', 'firefox115', 'safari16'],
  minify: true,
  inject: ['scripts/node-shim.js'],
  define: { global: 'globalThis' },
  legalComments: 'none',
  write: false,
  logLevel: 'warning',
});
const route = await build({
  entryPoints: ['webapp/pump-route.js'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome110', 'firefox115', 'safari16'],
  minify: true,
  inject: ['scripts/node-shim.js'],
  define: { global: 'globalThis' },
  legalComments: 'none',
  write: false,
  logLevel: 'warning',
});
writeFileSync('web/pump-route.js', `// Radar ${version} buy route, built from webapp/pump-route.js: https://github.com/Radardotfun/radar\n${route.outputFiles[0].text}`);
console.log(`pump-route.js ${version}: ${(route.outputFiles[0].text.length / 1024).toFixed(0)} KB`);
writeFileSync('web/launch.js', `// Radar ${version} launch page, built from webapp/launch.js: https://github.com/Radardotfun/radar\n${launch.outputFiles[0].text}`);
console.log(`launch.js ${version}: ${(launch.outputFiles[0].text.length / 1024).toFixed(0)} KB`);
