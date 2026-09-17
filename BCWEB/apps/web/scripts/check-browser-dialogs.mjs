#!/usr/bin/env node
// `window.confirm` / `window.prompt` / `window.alert` draw the BROWSER's box, not the site's.
//
// That box says "localhost:5176" (or the real domain) across the top, ignores the theme and
// the language, cannot be styled, is a system sheet on a phone, and — the part that actually
// breaks things — offers "Prevent this page from creating additional dialogs". Tick it once
// and every later confirmation on that page silently returns false for the rest of the
// session: the delete button stops deleting and nothing says why. One of the three this gate
// was written against was in the screen that hands out currency.
//
// The house components are `useDialog()` from `src/ui/ui.jsx`: `dialog.confirm({ title,
// message, okLabel, danger })` and `dialog.prompt({ title, label, defaultValue })`. Both are
// promises, so the call site becomes `if (!await dialog.confirm({...})) return;`.
//
// A file may opt out with a `// browser-dialog: reason` comment on the line above, for the
// one case where the native box is right: `beforeunload` is not one (the browser draws that
// itself), and neither is a debug-only path.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'src';
// `window.` is required. A bare `confirm(` is too close to ordinary words (a `confirm()`
// helper, `confirmDelete(`) to flag without false positives, and every real call in this
// codebase was written with the object.
const RE = /\bwindow\.(confirm|prompt|alert)\s*\(/g;

const files = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : /\.(jsx?|tsx?)$/.test(f) ? [p] : [];
});

let bad = 0;
let exempt = 0;
for (const f of files(SRC)) {
  const lines = readFileSync(f, 'utf8').split('\n');
  lines.forEach((l, i) => {
    // A line that only TALKS about one (the comment explaining why it was replaced) is not a
    // call: require something other than a comment marker before it on the line.
    if (/^\s*(\/\/|\*)/.test(l)) return;
    for (const m of l.match(RE) || []) {
      if (/\/\/\s*browser-dialog:/.test(lines[i - 1] || '')) { exempt += 1; continue; }
      console.error(`✗ ${f}:${i + 1}  ${m.trim()}`);
      bad += 1;
    }
  });
}
if (bad) {
  console.error(`\n${bad} browser dialog${bad === 1 ? '' : 's'}. Use useDialog() from src/ui/ui.jsx:`);
  console.error('  if (!await dialog.confirm({ title, message, danger: true })) return;');
  console.error('  const v = await dialog.prompt({ title, label, defaultValue });');
  console.error('or state the reason with a  // browser-dialog: …  comment on the line above.');
  process.exit(1);
}
console.log(`✓ no browser confirm/prompt/alert in ${SRC}${exempt ? `, ${exempt} exempt with a stated reason` : ''}`);
