// The .env wizard's spec, checked against reality.
//
// infra/env-spec.txt is read by BOTH configure-env.sh and configure-env.ps1 — that is the
// whole point of it, and it only holds if nothing quietly grows a second list. This checks
// three things that would each be invisible until an operator hit them:
//
//   1. every KEY the spec asks about is either a real variable in .env.example or a
//      wizard-only key the scripts handle deliberately. A typo'd key writes a line nothing
//      reads, and the wizard reports success;
//   2. both scripts still read the spec rather than a list of their own;
//   3. the spec parses — six fields, a known KIND, and a `when:` that names a key the spec
//      actually asks EARLIER. A condition on a later key is never true and silently skips
//      its question for ever.
//
// Run: node infra/check-env-spec.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const spec = fs.readFileSync(path.join(HERE, 'env-spec.txt'), 'utf8');
const example = fs.readFileSync(path.join(HERE, 'compose', '.env.example'), 'utf8');
const sh = fs.readFileSync(path.join(HERE, 'configure-env.sh'), 'utf8');
const ps = fs.readFileSync(path.join(HERE, 'configure-env.ps1'), 'utf8');

const problems = [];
const KINDS = new Set(['text', 'secret', 'bool', 'choice', 'url', 'info']);
// Keys the wizard owns rather than passes through: they steer the compose file and the
// questions, and are appended to the .env under their own heading.
const WIZARD_ONLY = new Set(['DB_MODE', 'REDIS_ENABLED', 'EMAIL_ENABLED']);

const declared = new Set(
  [...example.matchAll(/^#?([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]),
);

const asked = [];
let n = 0;
for (const raw of spec.split('\n')) {
  const line = raw.replace(/\r$/, '');
  if (!line || line.startsWith('#')) continue;
  const f = line.split('|');
  if (f.length < 5) { problems.push(`spec line has ${f.length} fields, needs at least 5: ${line.slice(0, 60)}`); continue; }
  const [key, , kind, , , help = ''] = f;
  n += 1;
  if (!KINDS.has(kind)) problems.push(`${key}: unknown KIND "${kind}" — the scripts fall through to plain text and the operator never learns why`);
  if (kind === 'info') continue;

  if (!declared.has(key) && !WIZARD_ONLY.has(key)) {
    problems.push(`${key}: asked by the wizard but not in .env.example — it writes a line nothing reads`);
  }
  const when = /^when:([^ ]+)/.exec(help);
  if (when) {
    const dep = when[1].split('=')[0];
    if (!asked.includes(dep)) {
      problems.push(`${key}: gated on ${dep}, which is not asked BEFORE it — the condition is never true and the question never appears`);
    }
  }
  asked.push(key);
}

if (asked.length < 10) problems.push(`only ${asked.length} questions parsed — the spec or this parser is broken, not the config`);
if (!/env-spec\.txt/.test(sh)) problems.push('configure-env.sh no longer reads env-spec.txt');
if (!/env-spec\.txt/.test(ps)) problems.push('configure-env.ps1 no longer reads env-spec.txt');

if (problems.length) {
  console.error(`✗ ${problems.length} problem(s) in the .env wizard spec:\n`);
  for (const p of problems) console.error(`  • ${p}`);
  console.error('\n  The spec is the single list both wizards ask from. A key that is wrong here is');
  console.error('  wrong on Linux and on Windows at the same time, and neither reports it.');
  process.exit(1);
}
console.log(`✓ .env wizard spec OK — ${asked.length} questions, every key real, both scripts read it`);
