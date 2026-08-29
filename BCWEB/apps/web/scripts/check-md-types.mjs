#!/usr/bin/env node
// Every export of the markdown kit has a type declaration, and every declaration has an export.
//
// The kit ships as JSX with no annotations, and `markdown.d.ts` is what makes it usable from
// a TypeScript project. A declaration file is exactly the kind of thing that rots quietly: a
// function added to the kit and missing here is not an error anywhere — the import simply
// becomes `any`, on somebody else's build, and TypeScript stops checking the one boundary
// the file exists to check.
//
// The reverse matters too. A declaration for something that no longer exists is worse than a
// missing one: it type-checks an import that fails at runtime.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'src/markdown';
const DTS = join(DIR, 'markdown.d.ts');
if (!existsSync(DTS)) { console.error(`✗ ${DTS} is missing — refusing to report success`); process.exit(2); }

// The source files the kit ships. Read from the folder rather than listed here, so a new one
// is covered the day it appears instead of the day somebody remembers this file.
const SRC = readdirSync(DIR).filter((f) => /\.(jsx?|tsx?)$/.test(f) && !f.endsWith('.d.ts'));
if (SRC.length < 4) {
  console.error(`✗ found ${SRC.length} kit source file(s) — too few to be right, so this check cannot be trusted`);
  process.exit(2);
}

/** Named exports of one module, plus `default` when it has one. */
function exportsOf(text) {
  const out = new Set();
  for (const m of text.matchAll(/^export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z_$][\w$]*)/gm)) out.add(m[1]);
  // `export { a, b as c }` — the EXPORTED name is what a consumer imports, so `as` wins.
  for (const m of text.matchAll(/^export\s*\{([^}]+)\}/gm)) {
    for (const part of m[1].split(',')) {
      const bits = part.trim().split(/\s+as\s+/);
      const name = (bits[1] || bits[0] || '').trim();
      if (name && name !== 'default') out.add(name);
    }
  }
  if (/^export\s+default\s/m.test(text)) out.add('default');
  return out;
}

const real = new Set();
for (const f of SRC) for (const n of exportsOf(readFileSync(join(DIR, f), 'utf8'))) real.add(n);

const dts = readFileSync(DTS, 'utf8');
const declared = exportsOf(dts);
// A declaration file spells `export default function X(...)` too, and `export type`/`interface`
// are declarations of shapes rather than of values — they have no counterpart in the JS and
// must not be demanded of it.
for (const m of dts.matchAll(/^export\s+(?:type|interface)\s+([A-Za-z_$][\w$]*)/gm)) declared.delete(m[1]);
const typeOnly = new Set([...dts.matchAll(/^export\s+(?:type|interface)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]));

if (!real.size || !declared.size) {
  console.error('✗ parsed no exports from one side — the pattern moved, so this cannot be trusted');
  process.exit(2);
}

const undeclared = [...real].filter((n) => !declared.has(n)).sort();
const phantom = [...declared].filter((n) => !real.has(n) && !typeOnly.has(n)).sort();

if (undeclared.length || phantom.length) {
  console.error('✗ markdown kit types:');
  for (const n of undeclared) console.error(`    ${n} — exported by the kit and not declared (imports it as \`any\`)`);
  for (const n of phantom) console.error(`    ${n} — declared and not exported (type-checks an import that fails at runtime)`);
  console.error('\n  markdown.d.ts is what makes the kit usable from TypeScript. A missing line is not');
  console.error('  an error anywhere — it just stops checking the boundary it exists to check.');
  process.exit(1);
}
console.log(`✓ markdown kit types OK — ${real.size} export(s) declared, ${typeOnly.size} type(s) beside them`);
