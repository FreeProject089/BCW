#!/usr/bin/env node
// Tailwind cannot put an alpha on a CSS variable, and it does not say so.
//
// `bg-[var(--surface-2)]/40` looks like every other Tailwind utility and compiles to NOTHING
// in Tailwind 3: the class ends up in the markup, no rule is emitted for it, and the element
// is drawn with no background whatsoever. The same goes for `border-[var(--primary)]/40`,
// `text-…`, `ring-…`, `from-…`. It is invisible in review (the class is right there), invisible
// in the diff, and invisible in a screenshot taken on a dark page, where a panel with no
// background looks like a panel that was meant to be see-through. Three hundred of them had
// accumulated, and they are the reason the "Translucent surfaces" setting appeared to be
// ignored: those surfaces were never painted, so no setting could change them.
//
// The replacements live in index.css: `.panel` / `.panel-quiet` for an inner surface (solid by
// default, frosted with the setting, like .card), and `.tint-*` / `.b-*` for the accent washes,
// which are painted with color-mix — the one function that does take a variable.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'src';
const RE = /\b(?:bg|text|border|ring|from|via|to|shadow|outline|divide|accent|caret|fill|stroke)-\[var\(--[a-z0-9-]+\)\]\/[0-9]+/g;

const files = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : /\.(jsx?|tsx?)$/.test(f) ? [p] : [];
});

let bad = 0;
for (const f of files(SRC)) {
  const lines = readFileSync(f, 'utf8').split('\n');
  lines.forEach((l, i) => {
    for (const m of l.match(RE) || []) {
      console.error(`✗ ${f}:${i + 1}  ${m}`);
      bad += 1;
    }
  });
}
if (bad) {
  console.error(`\n${bad} utilit${bad === 1 ? 'y' : 'ies'} put an alpha on a CSS variable. Tailwind emits no rule for these,`);
  console.error('so the element is painted with nothing. Use .panel / .panel-quiet for a surface,');
  console.error('.tint-primary / .tint-success / .tint-warning / .tint-error for a wash, .b-* for a border,');
  console.error('or an inline style with color-mix() when you need an exact percentage.');
  process.exit(1);
}
console.log('✓ no alpha on a CSS variable — every tinted surface is painted by a rule that exists');
