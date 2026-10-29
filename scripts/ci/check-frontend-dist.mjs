// Check the built frontend (frontend/dist) is wired for runtime configuration:
//  - dist/config.js exists (copied from frontend/public, not bundled)
//  - index.html loads /config.js as a classic script before the module bundle
//  - the bundle does not inline a backend address
//   node scripts/ci/check-frontend-dist.mjs [frontend/dist]
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = process.argv[2] || 'frontend/dist';
const errors = [];
const err = (m) => errors.push(m);

if (!existsSync(join(dist, 'index.html'))) err(`${dist}/index.html missing — did the build run?`);
if (!existsSync(join(dist, 'config.js'))) err(`${dist}/config.js missing — frontend/public/config.js was not copied.`);

if (!errors.length) {
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
  const cfgIdx = scripts.findIndex((s) => /src="\/config\.js(\?[^"]*)?"/.test(s));
  const modIdx = scripts.findIndex((s) => /type="module"/.test(s));
  if (cfgIdx === -1) err('index.html does not load /config.js.');
  else {
    if (/type="module"|\b(async|defer)\b/.test(scripts[cfgIdx])) err('/config.js must be a plain blocking <script> (no type="module", async or defer).');
    if (modIdx !== -1 && cfgIdx > modIdx) err('/config.js must come before the module bundle in index.html.');
  }
  if (modIdx === -1) err('index.html has no module bundle script.');

  const assets = join(dist, 'assets');
  for (const f of existsSync(assets) ? readdirSync(assets).filter((f) => f.endsWith('.js')) : []) {
    const js = readFileSync(join(assets, f), 'utf8');
    const hit = js.match(/https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?|\bVITE_API_BASE\b/);
    if (hit) err(`bundle ${f} contains a hardcoded backend address: ${hit[0]}`);
  }
}

if (errors.length) {
  for (const e of errors) console.error(`::error::${e}`);
  process.exit(1);
}
console.log(`✓ ${dist}: config.js present, loaded before the bundle, no hardcoded backend address`);
