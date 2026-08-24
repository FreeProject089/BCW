// Bring stored project configs up to the shape the project page actually reads.
//
// The page and the stored config had drifted. `project.<key>` in AdminSetting is a free-form
// `z.record(z.any())` — the route validates that it is an object and nothing more — so when
// project.jsx was rewritten to read `overview`, `community`, `stack` and `legal[]`, the rows
// written under the old flat shape kept validating, kept saving, and stopped rendering. The
// pages went blank with nothing logged anywhere, which reads as "the data is gone".
//
// It is not gone. This moves it:
//
//   replayUrl                        → overview.replayUrl
//   progress                         → overview.progress
//   contributors / messages /
//   contributorsUrl                  → community.*
//   legal { tos, license, readme, … }→ legal[] cards, one per non-empty link
//
// `stack` has no old equivalent to migrate — but a row with NO stack at all now receives the
// same default graph a fresh seed writes (DEFAULT_STACKS, one shared copy), because that is
// the case this script exists for: a live database whose rows predate the tab. A stack an
// admin already built, even a one-node one, is never touched.
//
// Idempotent: a row already carrying the new shape is left alone, so running this twice is a
// no-op rather than a second migration on top of the first.
//
//   node src/fix-project-config.mjs          # report only
//   node src/fix-project-config.mjs --write  # apply

import { db } from './lib/lib.mjs';

const WRITE = process.argv.includes('--write');

import { toCurrentShape, DEFAULT_STACKS } from './lib/project-config.mjs';

const p = await db();
const rows = await p.adminSetting.findMany({ where: { key: { startsWith: 'project.' } } });
if (!rows.length) {
  console.log('Aucune configuration de projet en base.');
  process.exit(0);
}

let changed = 0;
for (const row of rows) {
  const cfg = row.value && typeof row.value === 'object' ? row.value : {};
  const { out, moved } = toCurrentShape(cfg);
  // The default "How it runs" graph, for rows that have none. Checked on `out` so a row that
  // is BOTH old-shaped and stackless gets one pass, not two runs.
  const projKey = row.key.replace(/^project\./, '');
  if (!out.stack?.nodes?.length && DEFAULT_STACKS[projKey]) {
    out.stack = DEFAULT_STACKS[projKey].stack;
    out.tabs = { ...(out.tabs || {}), stack: true };
    moved.push('stack (default "How it runs" graph)');
  }
  // The code map shipped OFF: `showCodeMap` was in no default, so /projects/:key/codemap
  // answered 404 for every project. A row that PREDATES the flag has no opinion about it,
  // and adopting the default is the point of this script.
  //
  // Only when the key is ABSENT. An admin who set it to false meant false, and a repair
  // script that argues with a decision is a script nobody runs twice.
  const dflt = DEFAULT_STACKS[projKey]?.stack;
  if (out.stack && dflt && out.stack.showCodeMap === undefined && dflt.showCodeMap !== undefined) {
    out.stack.showCodeMap = dflt.showCodeMap;
    if (dflt.codeMapNote && !out.stack.codeMapNote) out.stack.codeMapNote = dflt.codeMapNote;
    moved.push(`showCodeMap=${dflt.showCodeMap}`);
  }
  if (!moved.length) {
    console.log(`${row.key.padEnd(20)} déjà à jour`);
    continue;
  }
  changed += 1;
  console.log(`${row.key.padEnd(20)} ${moved.join(', ')}`);
  if (WRITE) await p.adminSetting.update({ where: { key: row.key }, data: { value: out } });
}

console.log('');
if (!changed) console.log('Rien à faire.');
else if (WRITE) console.log(`${changed} configuration(s) migrée(s). Rechargez la page projet.`);
else console.log(`${changed} configuration(s) à migrer. Relancez avec --write pour appliquer.`);
process.exit(0);
