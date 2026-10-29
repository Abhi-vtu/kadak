// Validate a runtime frontend config file (config.js) with the same rules the
// app applies in the browser (frontend/src/runtimeConfig.js).
//   node scripts/ci/check-runtime-config.mjs <path/to/config.js> [--allow-placeholder]
// --allow-placeholder: for templates that are meant to contain YOUR_... values.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { validateConfig } from '../../frontend/src/runtimeConfig.js';

const file = process.argv[2];
const allowPlaceholder = process.argv.includes('--allow-placeholder');
if (!file) { console.error('usage: check-runtime-config.mjs <config.js> [--allow-placeholder]'); process.exit(2); }

const fail = (msg) => { console.error(`::error file=${file}::${msg}`); process.exit(1); };

const src = readFileSync(file, 'utf8');
if (/(password|secret|token|private[_ -]?key|DATABASE_URL|postgres(ql)?:\/\/)\s*[:=]/i.test(src)) {
  fail('config.js looks like it contains a secret or database setting. It is a public file — remove it.');
}

const sandbox = { window: {} };
try { vm.runInNewContext(src, sandbox, { filename: file, timeout: 1000 }); }
catch (e) { fail(`config.js does not run: ${e.message}`); }

const cfg = sandbox.window.APP_CONFIG;
const { baseUrl, error } = validateConfig(cfg, null);
if (error) {
  if (allowPlaceholder && /placeholder/.test(error)) {
    console.log(`✓ ${file}: template with placeholder API_BASE_URL (${cfg.API_BASE_URL})`);
    process.exit(0);
  }
  fail(error);
}
const extra = Object.keys(cfg).filter((k) => k !== 'API_BASE_URL');
if (extra.length) console.log(`  note: extra keys ignored by the app: ${extra.join(', ')}`);
console.log(`✓ ${file}: API_BASE_URL = ${baseUrl === '' ? '"" (same origin)' : baseUrl}`);
