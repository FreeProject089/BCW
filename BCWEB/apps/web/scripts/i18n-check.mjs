#!/usr/bin/env node
// i18n parity + integrity check (audit P3). The app resolves a label via
//   t(k, fb) => DICT[lang][k] ?? DICT.en[k] ?? fb ?? k
// so two silent failure modes exist: (1) a DUPLICATE key in a dict — the later one
// wins and the earlier translation is lost, and if two features reused the same key
// they clash (e.g. the OAuth-clients heading rendering "Mes catalogues"); (2) a key
// used in code with no FR entry — FR users silently get the English fallback.
//
// Duplicates are a hard error (they are real bugs). Missing-FR is reported but does
// NOT fail the build by default (dynamic `t(prefix + x)` keys can't be resolved
// statically), unless --strict is passed.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Recursively list files under dir matching one of the extensions (portable — no
// fs.globSync, which is Node 22+ only).
function walk(dir, exts, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, out);
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', 'src');
const I18N = join(SRC, 'i18n.jsx');
const strict = process.argv.includes('--strict');

// Brace-match a `name: {  … }` object section inside the DICT literal.
function section(text, name) {
  const m = new RegExp(`\\n\\s{2,4}${name}:\\s*\\{`).exec(text);
  if (!m) throw new Error(`could not find DICT.${name}`);
  let depth = 0; const start = m.index + m[0].length - 1;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error(`unbalanced DICT.${name}`);
}
function keysAndDups(sec) {
  const keys = new Set(); const dups = new Set();
  for (const m of sec.matchAll(/'([A-Za-z0-9_.]+)'\s*:/g)) {
    if (keys.has(m[1])) dups.add(m[1]);
    keys.add(m[1]);
  }
  return { keys, dups };
}

const i18n = readFileSync(I18N, 'utf8');
const en = keysAndDups(section(i18n, 'en'));
const fr = keysAndDups(section(i18n, 'fr'));

// t('key' / t("key") usages across the web source (excluding i18n.jsx itself).
const used = new Set();
for (const f of walk(SRC, ['.jsx', '.js'])) {
  if (f.endsWith('i18n.jsx')) continue;
  const txt = readFileSync(f, 'utf8');
  for (const m of txt.matchAll(/\bt\(\s*'([A-Za-z0-9_.]+)'/g)) used.add(m[1]);
  for (const m of txt.matchAll(/\bt\(\s*"([A-Za-z0-9_.]+)"/g)) used.add(m[1]);
}

// A key ending in '.' is a static prefix of a dynamic `t(prefix + x)` — not a real key.
const isDynamicPrefix = (k) => k.endsWith('.');
const missingFr = [...used].filter((k) => !isDynamicPrefix(k) && !fr.keys.has(k) && !en.keys.has(k)).sort();
const deadFr = [...fr.keys].filter((k) => !used.has(k) && !en.keys.has(k)).sort();
const allDups = [...new Set([...en.dups].map((k) => `en:${k}`).concat([...fr.dups].map((k) => `fr:${k}`)))].sort();

console.log(`i18n: ${used.size} keys used · DICT.en ${en.keys.size} · DICT.fr ${fr.keys.size}`);
console.log(`      ${missingFr.length} used-but-missing-FR · ${deadFr.length} dead-FR · ${allDups.length} duplicate keys`);

let fail = false;
if (allDups.length) {
  console.error(`\n✖ DUPLICATE keys (later definition silently wins — real bug):`);
  for (const d of allDups) console.error(`    ${d}`);
  fail = true;
}
if (missingFr.length) {
  console[strict ? 'error' : 'warn'](`\n${strict ? '✖' : '⚠'} used in code but missing from DICT.fr (FR falls back to English):`);
  for (const k of missingFr) console[strict ? 'error' : 'warn'](`    ${k}`);
  if (strict) fail = true;
}

if (fail) { console.error('\ni18n-check FAILED'); process.exit(1); }
console.log('\ni18n-check OK');
