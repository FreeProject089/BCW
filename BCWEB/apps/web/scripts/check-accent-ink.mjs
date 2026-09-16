#!/usr/bin/env node
// A fill is not an ink.
//
// `--primary` and `--primary-2` are chosen to be painted: a button, a bar, a glow, the orb.
// A fill only has to be VISIBLE. Ink has to be legible, and the shipped accent is not:
// #f59e0b on white measures 2.15:1 and #f97316 measures 2.80:1, against a 4.5:1 bar. They
// were used as text in 866 places, which is the real reason the light theme read as "pale
// text on white" however carefully the grey scale was tuned — the greys were fine, the
// orange was not.
//
// `--accent-ink` is the same accent walked toward the page's ink until it clears 4.5:1,
// derived per mode (dark on a white page, bright on a black one) and recomputed by the theme
// injector for a custom accent. So this rule is narrow: never `text-…` an accent FILL.
// Backgrounds, borders, gradients, fills and rings are untouched — that is what those tokens
// are for.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BAD = /\b(?:hover:|focus:|group-hover:|peer-focus:|dark:|sm:|md:|lg:)*text-\[var\(--primary(?:-2)?\)\]/g;
const files = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : /\.(jsx?|tsx?)$/.test(f) ? [p] : [];
});

let bad = 0;
for (const f of files('src')) {
  const s = readFileSync(f, 'utf8');
  for (const m of s.matchAll(BAD)) {
    const line = s.slice(0, m.index).split('\n').length;
    console.error(`✗ ${f}:${line}  ${m[0]} — the accent fill as ink (2.15:1 on white). Use text-[var(--accent-ink)].`);
    bad += 1;
  }
}
if (bad) {
  console.error(`\n${bad} place(s) paint text with an accent FILL. --accent-ink is the readable version of the same colour.`);
  process.exit(1);
}
console.log('✓ the accent is never used as ink');
