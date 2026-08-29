#!/usr/bin/env node
// A block the Visual editor can hold, and nobody can add.
//
// Three lists make a block work in Visual mode, and `check-md-roundtrip.mjs` already holds
// two of them together: `parse` reads it out of markdown, `serialize` writes it back. A block
// missing either is destroyed on the first save, which is loud.
//
// The third is quiet. `blank(type)` builds a fresh one, and `BLOCK_TYPES` in
// visual-editor.jsx is the menu somebody picks from. `schedule` shipped with a parser, a
// serialiser and a blank — and no row in the menu. It round-tripped perfectly, the gate went
// green, and the only way to create one was to type the directive by hand in the other mode:
// the exact thing Visual mode exists to avoid.
//
// So the two are joined, in both directions:
//   · a menu row with no `blank` builds an empty text block instead — the button appears to
//     do nothing;
//   · a `blank` with no menu row is a block nobody can reach.
import { readFileSync, existsSync } from 'node:fs';

const ED = 'src/editor/visual-editor.jsx';
const BL = 'src/editor/md-blocks.js';
for (const f of [ED, BL]) {
  if (!existsSync(f)) { console.error(`✗ ${f} is missing — refusing to report success`); process.exit(2); }
}
const ed = readFileSync(ED, 'utf8');
const bl = readFileSync(BL, 'utf8');

const at = ed.indexOf('const BLOCK_TYPES = [');
if (at < 0) { console.error('✗ BLOCK_TYPES moved — this check cannot be trusted'); process.exit(2); }
const menu = [...ed.slice(at, ed.indexOf('\n];', at)).matchAll(/type:\s*'([a-z0-9-]+)'/g)].map((m) => m[1]);

const fn = bl.indexOf('export function blank(');
if (fn < 0) { console.error('✗ blank() moved — this check cannot be trusted'); process.exit(2); }
const blank = [...bl.slice(fn, bl.indexOf('\n}', fn)).matchAll(/case '([a-z0-9-]+)':/g)].map((m) => m[1]);

if (menu.length < 10 || blank.length < 10) {
  console.error(`✗ read ${menu.length} menu row(s) and ${blank.length} blank(s) — too few to be right`);
  process.exit(2);
}

// `text` is the DEFAULT of blank(), which is the correct shape: an unknown type becoming an
// empty paragraph is what a block editor should do with something it does not recognise.
const DEFAULTED = new Set(['text']);

// The THIRD list, and the one that bit. `blockEditor` switches on the type to draw the form
// somebody types into; its `default` returns null. So a menu row with no case here adds a
// block that appears, cannot be edited, and serialises to whatever its blank happened to
// hold — which for `schedule` would have been a card nobody could put a zone on.
// Indented four spaces: that is the switch inside blockEditor, and it is what keeps the
// `case` labels of nested switches elsewhere in the file out of this list.
const editor = [...ed.matchAll(/^ {4}case '([a-z0-9-]+)':/gm)].map((m) => m[1]);
if (editor.length < 10) {
  console.error(`✗ read ${editor.length} editor case(s) — the extractor is stale, so this cannot be trusted`);
  process.exit(2);
}

const problems = [];
for (const t of menu) {
  if (!editor.includes(t)) problems.push(`the menu offers "${t}" and blockEditor draws no form for it — the block is added and cannot be edited`);
}
for (const t of menu) {
  if (!blank.includes(t) && !DEFAULTED.has(t)) problems.push(`the menu offers "${t}" and blank() does not build one — the button adds an empty paragraph`);
}
for (const t of blank) {
  if (!menu.includes(t)) problems.push(`blank() builds "${t}" and no menu row reaches it — the block works and cannot be created`);
}

if (problems.length) {
  console.error('✗ visual palette:');
  for (const p of problems) console.error(`    ${p}`);
  console.error('\n  Round-tripping proves a block SURVIVES Visual mode. It says nothing about whether');
  console.error('  anybody can make one, which is what Visual mode is for.');
  process.exit(1);
}
console.log(`✓ visual palette OK — ${menu.length} block(s) offered, each with a blank to build it`);
