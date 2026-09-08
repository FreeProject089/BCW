#!/usr/bin/env node
// No file in this repo may start with a UTF-8 byte-order mark.
//
// Written the day one got in and took the whole stack down. `package.json` was rewritten by a
// PowerShell one-liner; `Set-Content -Encoding utf8` on Windows PowerShell 5.1 prepends
// EF BB BF, and the result is a file that is valid to almost everything:
//
//   - git shows NO diff for the first line, so it does not appear in review;
//   - npm reads the manifest fine, so `npm run lint` ran the entire 21-check chain, the test
//     suite, eslint — all green, over a package.json that was already broken;
//   - vite's PostCSS config loader does `JSON.parse` on it and dies with
//     `Unexpected token 'ï»¿'`, which names no file and no key.
//
// So `npm run build` failed, and therefore `docker compose up --build` failed, on a change
// whose own gate had just reported success. Three bytes, invisible in every place anyone
// would have looked.
//
// The check is deliberately whole-tree rather than manifests-only: a BOM in a .mjs script
// executed by node is a syntax error, in a .css file it is a stray character before the first
// rule, and in a .json fixture it breaks whatever reads it.
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOTS = ['src', 'scripts', 'test', 'public'];
const FILES = ['package.json', 'vite.config.js', 'eslint.config.js', 'index.html'];
const SKIP = new Set(['node_modules', 'dist', '.vite', 'coverage']);
const TEXT = /\.(m?[jt]sx?|json|css|html|md|svg|txt)$/i;

const offenders = [];
const seen = [];

const visit = (p) => {
  let st;
  try { st = statSync(p); } catch { return; }
  if (st.isDirectory()) {
    if (SKIP.has(relative(process.cwd(), p).split(/[\\/]/).pop())) return;
    for (const e of readdirSync(p)) visit(join(p, e));
    return;
  }
  if (!TEXT.test(p)) return;
  seen.push(p);
  // Read three bytes, not the file: this walks a few thousand files.
  const head = readFileSync(p).subarray(0, 3);
  if (head[0] === 0xEF && head[1] === 0xBB && head[2] === 0xBF) {
    offenders.push(relative(process.cwd(), p).replace(/\\/g, '/'));
  }
};

for (const r of [...ROOTS, ...FILES]) visit(join(process.cwd(), r));

if (offenders.length) {
  console.error(`✗ ${offenders.length} file(s) start with a UTF-8 BOM:`);
  for (const f of offenders) console.error(`    ${f}`);
  console.error('  A BOM is invisible in git and to npm, and fatal to JSON.parse — a BOM in');
  console.error('  package.json fails `npm run build` (and so `docker compose up --build`)');
  console.error('  while every check in this chain still reports success.');
  console.error('  Usually PowerShell: `Set-Content -Encoding utf8` adds one in 5.1.');
  console.error('  Rewrite without it, e.g. [System.IO.File]::WriteAllText(path, text, (New-Object System.Text.UTF8Encoding $false))');
  process.exit(1);
}
console.log(`✓ encoding OK — ${seen.length} text file(s), none carrying a BOM`);
