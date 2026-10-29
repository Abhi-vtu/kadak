// Validate the GitHub Actions workflow files: YAML parses, and each has a
// trigger and jobs whose steps are well-formed. (GitHub itself rejects
// semantically invalid workflows on push; this catches syntax mistakes early.)
//   node scripts/ci/check-workflows.mjs <path-to-yaml-module-dir> [files...]
// The first argument is a directory where the `yaml` npm package is installed.
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const [modDir, ...args] = process.argv.slice(2);
if (!modDir) { console.error('usage: check-workflows.mjs <yaml-module-dir> [files...]'); process.exit(2); }
const YAML = createRequire(join(modDir, 'noop.js'))('yaml');

const dir = '.github/workflows';
const files = args.length ? args : readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).map((f) => join(dir, f));
let failed = false;
const err = (file, msg) => { console.log(`::error file=${file}::${msg}`); failed = true; };

for (const file of files) {
  const doc = YAML.parseDocument(readFileSync(file, 'utf8'));
  if (doc.errors.length) { for (const e of doc.errors) err(file, `YAML: ${e.message}`); continue; }
  const wf = doc.toJS();
  if (!wf || typeof wf !== 'object') { err(file, 'empty workflow'); continue; }
  if (!wf.name) err(file, 'missing top-level "name"');
  if (!wf.on) err(file, 'missing "on" (triggers)');
  if (!wf.jobs || !Object.keys(wf.jobs).length) { err(file, 'missing "jobs"'); continue; }
  for (const [id, job] of Object.entries(wf.jobs)) {
    if (!job['runs-on'] && !job.uses) err(file, `job "${id}": missing "runs-on"`);
    for (const need of [].concat(job.needs || [])) if (!wf.jobs[need]) err(file, `job "${id}": needs unknown job "${need}"`);
    (job.steps || []).forEach((s, i) => {
      if (!s.uses && !s.run) err(file, `job "${id}" step ${i + 1}: needs "uses" or "run"`);
      if (s.uses && !/@./.test(s.uses) && !s.uses.startsWith('./') && !s.uses.startsWith('docker://')) err(file, `job "${id}" step ${i + 1}: "${s.uses}" has no version (@...)`);
    });
  }
  if (!failed) console.log(`✓ ${file}: ${Object.keys(wf.jobs).length} jobs, triggers: ${Object.keys(wf.on).join(', ')}`);
}
process.exit(failed ? 1 : 0);
