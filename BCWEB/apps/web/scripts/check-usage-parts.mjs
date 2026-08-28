// A usage panel must account for every part of the total it draws.
//
// `/server/backups/usage` returns filesBytes, dbBytes, snapshotBytes, snapshotCount and a
// totalBytes that is the sum of the first three. The panel showed two of them above a bar
// measuring the total, so the parts read one number and the whole read a much larger one, and
// nothing on the screen said where the difference went.
//
// The API takes care to include snapshots — there is a comment there saying a usage figure
// that ignores half of what it wrote is why a box runs out of space — and then the only screen
// that displays it ignored exactly that half.
//
// Nothing could see it: the field was in the payload, the panel simply never read it. No error,
// no warning, and a bar that looks right because a bar always looks right.
//
// So: every numeric `*Bytes` field the usage route returns has to appear somewhere in the
// component that draws it. Not a check that the arithmetic is right — a check that no part is
// invisible.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = join(ROOT, '../api/src/routes/server-control.mjs');
const PANEL = join(ROOT, 'src/pages/admin.jsx');

for (const f of [API, PANEL]) {
  if (!existsSync(f)) { console.error(`✗ ${f} is missing — refusing to report success`); process.exit(2); }
}
const api = readFileSync(API, 'utf8');
const panel = readFileSync(PANEL, 'utf8');

// The object literal the usage route returns.
const at = api.indexOf("app.get('/server/backups/usage'");
if (at < 0) { console.error('✗ the usage route is not where this check looks — it cannot be trusted'); process.exit(2); }
const body = api.slice(at, at + 1600);
const ret = body.indexOf('return {');
if (ret < 0) { console.error('✗ could not find what the usage route returns — it cannot be trusted'); process.exit(2); }
const shape = body.slice(ret, body.indexOf('\n  });', ret));

// `filesBytes,` (shorthand) and `snapshotBytes: x` both count.
const fields = [...new Set([...shape.matchAll(/\b(\w*(?:Bytes|Count))\b\s*[,:]/g)].map((m) => m[1]))]
  .filter((f) => f !== 'totalBytes');

if (fields.length < 3) {
  console.error(`✗ read ${fields.length} part field(s) from the usage route — too few to be right`);
  process.exit(2);
}

// The component that draws it, bounded so a mention somewhere else in a 10k-line file does
// not count as "shown here".
const cAt = panel.indexOf("t('bkp.title'");
if (cAt < 0) { console.error('✗ the backup panel is not where this check looks — it cannot be trusted'); process.exit(2); }
const comp = panel.slice(Math.max(0, cAt - 4000), cAt + 4000);

const missing = fields.filter((f) => !comp.includes(`d.${f}`));
if (missing.length) {
  console.error('✗ backup usage panel:');
  for (const f of missing) console.error(`  the usage route returns "${f}" and the panel never reads it`);
  console.error('\ntotalBytes is the sum of these. A part that is not drawn is a slice of disk');
  console.error('the panel cannot explain, on the one screen somebody opens to explain it.');
  process.exit(1);
}
console.log(`✓ backup usage OK — every part is shown: ${fields.join(', ')}`);
