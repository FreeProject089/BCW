// Every `lazyNamed(() => import('X'), 'Name')` must find `Name` exported from X.
//
// Nothing catches this. Vite bundles happily — the import is dynamic and the name is a string,
// so there is no reference to resolve at build time. At runtime React gets `undefined` and
// throws error #306, whose minified text is "element type is invalid" and names nothing: it
// reads like a broken component rather than a missing `export` keyword.
//
// It shipped: dashboard.jsx has reached OwnerCatalogs by name since it was written, and
// admin.jsx never exported it, so the whole Catalogues tab crashed on open. The file even
// carries a comment about the same mistake on a neighbouring component, which is the clearest
// possible sign that a person noticing it once is not a control.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(jsx?|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

// lazyNamed(() => import('./admin.jsx'), 'OwnerCatalogs')
//
// ALIASES COUNT. This matched the literal name only, and App.jsx — which owns every route in
// the app — does `const named = lazyNamed;` and then calls `named(...)`. So all 22 routes were
// invisible to this check, and /giveaways shipped asking for an export its page never had:
// error #306 on every visit, exactly the failure the file above says it exists to prevent.
// A guard that only sees the call site nobody uses is not a guard.
const ALIAS = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*lazyNamed\b/g;
// ONE literal, and the callee is checked afterwards. Building this per alias with `new RegExp`
// invites exactly one mistake — a doubled backslash, or a \b that became a real 0x08 byte,
// makes it look for something no source contains: it matches nothing, silently, while the
// script still prints its tick. Matching any identifier and filtering by name cannot fail
// that way.
const CALL = /\b([A-Za-z_$][\w$]*)\(\s*\(\)\s*=>\s*import\(\s*['"]([^'"]+)['"]\s*\)\s*,\s*['"]([^'"]+)['"]/g;

const problems = [];
for (const file of files(root)) {
  const src = readFileSync(file, 'utf8');
  const names = new Set(['lazyNamed']);
  for (const a of src.matchAll(ALIAS)) names.add(a[1]);
  const hits = [...src.matchAll(CALL)].filter((m) => names.has(m[1]));
  for (const m of hits) {
    const [, , spec, name] = m;
    const target = resolve(dirname(file), spec);
    let targetSrc;
    try {
      targetSrc = readFileSync(target, 'utf8');
    } catch {
      problems.push({ file, line: lineOf(src, m.index), msg: `cannot read ${spec}` });
      continue;
    }
    // `export function X`, `export const X`, `export class X`, or a named-export list.
    const named = new RegExp(`export\\s+(?:async\\s+)?(?:function|const|let|class)\\s+${name}\\b`);
    const listed = new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`);
    if (!named.test(targetSrc) && !listed.test(targetSrc)) {
      problems.push({ file, line: lineOf(src, m.index), msg: `${spec} does not export ${name}` });
    }
  }
}

function lineOf(src, index) {
  return src.slice(0, index).split('\n').length;
}

if (problems.length) {
  console.error(`✗ ${problems.length} lazyNamed target(s) do not resolve:`);
  for (const p of problems) {
    console.error(`    ${p.file.slice(root.length + 1).replace(/\\/g, '/')}:${p.line} — ${p.msg}`);
  }
  console.error('');
  console.error('  React throws error #306 at render: "element type is invalid", naming nothing.');
  console.error('  Add the missing `export`, or fix the name.');
  process.exit(1);
}

console.log('✓ every lazyNamed target resolves to a named export');
