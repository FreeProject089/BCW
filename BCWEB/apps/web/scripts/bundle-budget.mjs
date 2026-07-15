#!/usr/bin/env node
// Bundle-size budget for the entry chunk — the JS EVERY visitor downloads on first load.
// Run after `vite build`. Fails if the gzipped entry chunk exceeds the budget, so a
// regression like accidentally eager-importing the admin back-office (which is what
// bloated this to 2.3MB raw before the route-split) can't slip back in unnoticed.
// Lazy route chunks don't count — only the entry. Same "make it structural" idea as the
// ESLint no-undef and i18n-parity gates.
import { readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENTRY_BUDGET_KB = 430; // gzip; current ~372 KB, so ~15% headroom for normal growth
const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'assets');

let files;
try { files = readdirSync(ASSETS).filter((f) => f.endsWith('.js')); }
catch { console.error(`bundle-budget: no build found at ${ASSETS} — run \`vite build\` first.`); process.exit(1); }

// The entry chunk is Vite's `index-<hash>.js` (the app entry); take the largest match.
let entry = null, entryKB = 0, totalKB = 0;
for (const f of files) {
  const gz = gzipSync(readFileSync(join(ASSETS, f))).length / 1024;
  totalKB += gz;
  if (/^index-.*\.js$/.test(f) && gz > entryKB) { entry = f; entryKB = gz; }
}
if (!entry) { console.error('bundle-budget: could not find the entry chunk (index-*.js).'); process.exit(1); }

const r = (n) => Math.round(n);
console.log(`bundle-budget: entry ${entry} = ${r(entryKB)} KB gzip (budget ${ENTRY_BUDGET_KB}) · total JS ${r(totalKB)} KB gzip (${files.length} chunks)`);
if (entryKB > ENTRY_BUDGET_KB) {
  console.error(`\n✖ entry chunk ${r(entryKB)} KB exceeds the ${ENTRY_BUDGET_KB} KB budget by ${r(entryKB - ENTRY_BUDGET_KB)} KB.`);
  console.error('  Something heavy is loading eagerly — route-split it (React.lazy) or defer it. See guides/PERF_AUDIT_EN.md §1.');
  process.exit(1);
}
console.log('bundle-budget OK');
