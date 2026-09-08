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

/**
 * Text that was read as cp1252 and written back as UTF-8.
 *
 * The other half of the same PowerShell mistake, and the worse half. `Get-Content -Raw` on a
 * BOM-less file decodes with the system ANSI codepage, so piping a file through it re-encodes
 * every non-ASCII character as the cp1252 rendering of its own UTF-8 bytes: an em dash comes
 * back as three characters, a middot as two, an accented letter as two. It happened here to
 * admin.jsx (2097 runs), so every dash and separator in the admin dashboard rendered as
 * garbage -- and it passed everything: eslint, all 21 checks, 149 tests, the production
 * build, and the BOM check right above this, because the file is still perfectly valid
 * UTF-8. It is only wrong to a reader.
 *
 * The patterns are written as \u escapes, never as the characters themselves. Spelled
 * literally this checker flags its own source -- it did, on the first run -- and a check that
 * cannot describe what it looks for without failing is a check somebody deletes.
 *
 *   U+00C3 + a continuation character  -> an accented letter (e-acute, a-grave, c-cedilla)
 *   U+00E2 U+20AC + one more           -> a dash, an ellipsis or a curly quote
 *   U+00C2 + punctuation               -> a middot, a guillemet, a degree sign, a nbsp
 *
 * None of these occurs in real French, English or code.
 */
const MOJIBAKE = [
    /\u00C3[\u0080-\u00BF]/,
    /\u00E2\u20AC[\u2122\u201C\u201D\u0153\u009D\u00A6\u00A2]/,
    /\u00C2[\u00A0-\u00BF]/,
    /\u00E2\u201A\u00AC/,
];

const offenders = [];
const mangled = [];
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
  const buf = readFileSync(p);
  const rel = relative(process.cwd(), p).replace(/\\/g, '/');
  if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) offenders.push(rel);
  // Only files that HAVE non-ASCII can carry mojibake, and most do not — checking the byte
  // range first keeps this a scan rather than a regex pass over a few megabytes.
  if (!buf.some((b) => b > 0x7F)) return;
  const text = buf.toString('utf8');
  for (const re of MOJIBAKE) {
    const m = re.exec(text);
    if (!m) continue;
    const at = text.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, ' ');
    const count = (text.match(new RegExp(re.source, 'g')) || []).length;
    mangled.push({ rel, count, sample: at });
    break;
  }
};

for (const r of [...ROOTS, ...FILES]) visit(join(process.cwd(), r));

if (mangled.length) {
  console.error(`✗ ${mangled.length} file(s) contain text that was decoded with the wrong codepage:`);
  for (const m of mangled) {
    console.error(`    ${m.rel} — ${m.count} occurrence(s)`);
    console.error(`      …${m.sample}…`);
  }
  console.error('  The file is still valid UTF-8, so eslint, the tests and the build all pass');
  console.error('  over it — it is only wrong to a reader. Usually PowerShell: `Get-Content -Raw`');
  console.error('  decodes a BOM-less file with the ANSI codepage.');
  console.error('  Repair: encode the text back to cp1252 and decode it as UTF-8.');
  process.exit(1);
}

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
console.log(`✓ encoding OK — ${seen.length} text file(s), no BOM and no mis-decoded text`);
