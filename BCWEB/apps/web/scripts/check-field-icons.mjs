#!/usr/bin/env node
// An icon drawn over a field must not eat the click meant for the field.
//
// The house pattern for a search box is a relative wrapper, an `absolute … top-1/2
// -translate-y-1/2` icon, and an input padded to clear it. Without `pointer-events-none` the
// icon is a 14px dead zone on top of the control: clicking the magnifier does not focus the
// field, and a click just beside the caret lands on the icon instead of placing the caret.
// 34 of the site's 39 search boxes were like that, which is what "the magnifier bugs when you
// type" was.
//
// Narrow on purpose: only icons that are BOTH pinned to an edge and vertically centred, which
// is the shape of an icon inside a field. A decorative absolute icon elsewhere is not flagged,
// and neither is one that is meant to be clicked (give it a handler and it stops matching,
// because a clickable affordance is a <button>, not a bare icon).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ICON = /<([A-Z]\w*) size=\{(\d+)\} className="(absolute [^"]*)"/g;
const files = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : f.endsWith('.jsx') ? [p] : [];
});

let bad = 0;
for (const f of files('src')) {
  const s = readFileSync(f, 'utf8');
  for (const m of s.matchAll(ICON)) {
    const cls = m[3];
    if (cls.includes('pointer-events')) continue;
    if (!/\b(left|right|start|end|ms|me)-/.test(cls) || !cls.includes('top-1/2')) continue;
    const line = s.slice(0, m.index).split('\n').length;
    console.error(`✗ ${f}:${line}  <${m[1]}> sits in a field and swallows its clicks. Add pointer-events-none.`);
    bad += 1;
  }
}
if (bad) {
  console.error(`\n${bad} icon(s) over a field will eat the click that should focus it.`);
  process.exit(1);
}
console.log('✓ no icon steals a click from the field it decorates');
