// Builds dist/web: the download page (served by the Worker) with the extension as a .zip (desktop
// Chrome/Edge, "Load unpacked") and a signed .crx (Android browsers that import local extensions).
// node scripts/build-web.mjs
// Public site: npx wrangler pages deploy dist/web --project-name getradar --branch main (https://getradar.pages.dev)
// The .crx signing key lives outside the repo (~/.narrative-radar/extension.pem): keep it, or the
// extension's ID changes and testers have to reinstall.
import { cpSync, rmSync, mkdirSync, existsSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';

// The userscript is built into web/ first, so the site serves the current version.
execFileSync(process.execPath, ['scripts/build-userscript.mjs'], { stdio: 'inherit' });

const out = resolve('dist/web');
rmSync('dist', { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync('web', out, { recursive: true });
cpSync('extension/icons', join(out, 'icons'), { recursive: true });

// bsdtar (Windows' own tar.exe, macOS tar) writes real zips with -a; GNU tar would write a tarball.
const bsdtar = process.platform === 'win32' ? join(process.env.SystemRoot || 'C:/Windows', 'System32', 'tar.exe') : 'tar';
execFileSync(bsdtar, ['-a', '-c', '-f', join(out, 'radar-extension.zip'), 'manifest.json', 'icons', 'src'], { cwd: 'extension', stdio: 'inherit' });

// Firefox build (desktop and Android): same code; Firefox runs the background as a module script
// instead of a service worker and needs its own ID plus a data-collection declaration.
const ff = resolve('dist/firefox');
cpSync('extension', ff, { recursive: true });
const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
manifest.background = { scripts: ['src/background.js'], type: 'module' };
manifest.browser_specific_settings = {
  gecko: {
    id: 'narrative-radar@getradar.pages.dev',
    strict_min_version: '140.0',
    // The post the user scans (and anything typed into the search) goes to our server.
    data_collection_permissions: { required: ['websiteContent', 'searchTerms'] },
  },
  gecko_android: { strict_min_version: '142.0' },
};
writeFileSync(join(ff, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
execFileSync(bsdtar, ['-a', '-c', '-f', join(out, 'narrative-radar-firefox.zip'), 'manifest.json', 'icons', 'src'], { cwd: ff, stdio: 'inherit' });

const chrome = process.env.CHROME || join(homedir(), 'AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe');
const key = join(homedir(), '.narrative-radar', 'extension.pem');
if (existsSync(chrome) && existsSync(key)) {
  const stage = join(tmpdir(), 'nr-pack');
  rmSync(stage, { recursive: true, force: true });
  cpSync('extension', join(stage, 'narrative-radar'), { recursive: true });
  execFileSync(chrome, ['--headless=new', '--no-sandbox', `--pack-extension=${join(stage, 'narrative-radar')}`, `--pack-extension-key=${key}`], { stdio: 'ignore' });
  copyFileSync(join(stage, 'narrative-radar.crx'), join(out, 'radar.crx'));
} else {
  console.warn('skipped .crx: needs Chromium and the signing key');
}
console.log('built', out);
