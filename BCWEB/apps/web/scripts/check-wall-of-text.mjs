#!/usr/bin/env node
// A paragraph nobody can skip.
//
// The complaint this comes from was "trop de texte un peu partout qui explique, ça rend moche
// et pas pro", and the fix is not to delete the explanations: they are usually right, and the
// screens that carry them are complicated. The fix is that a long one must not be ALWAYS ON,
// because the cost is paid on every visit by everybody, including the hundred visits where
// the reader already knows.
//
// `Explain` (ui/ui.jsx) is the house answer: a native <details>, one line visible, the rest a
// click away, keyboard and find-in-page included.
//
// So the rule here is deliberately narrow, because a machine cannot judge prose:
//   · only a <p> (or a <div> that is only text) whose ENTIRE content is one t() call,
//   · only when that call's English fallback is longer than LIMIT characters,
//   · and not when it is already inside an <Explain>, a <details>, or a FAQ-style accordion.
// Anything mixed, nested or conditional is left alone: there the right fix is a judgement
// call, and a gate that nags about those gets switched off.
//
// LIMIT is 300 characters, which is about four lines on a phone. It is not a style opinion:
// below it a paragraph is a sentence or two, above it the reader is being asked to read.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const LIMIT = 300;
const SRC = 'src';

// <p …>{t('key', 'fallback')}</p> and nothing else between the tags.
const PARA = /<p\b([^>]*)>\s*\{t\(\s*'([^']+)'\s*,\s*'((?:[^'\\]|\\.)*)'\s*\)\}\s*<\/p>/g;

const files = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : f.endsWith('.jsx') ? [p] : [];
});

// Is this position inside an <Explain …> … </Explain> or a <details> … </details>?
const folded = (src, at) => {
  for (const [open, close] of [[/<Explain\b/g, '</Explain>'], [/<details\b/g, '</details>']]) {
    for (const m of src.matchAll(open)) {
      if (m.index > at) break;
      const end = src.indexOf(close, m.index);
      if (end === -1 || end > at) return true;
    }
  }
  return false;
};

let bad = 0;
let exempt = 0;
for (const f of files(SRC)) {
  const s = readFileSync(f, 'utf8');
  for (const m of s.matchAll(PARA)) {
    const [, , key, fallback] = m;
    // The fallback is the English, and it is what the reader gets when a string has no
    // translation, so it is the honest length to measure.
    if (fallback.length <= LIMIT) continue;
    if (folded(s, m.index)) continue;
    // The stated exemption. A page whose whole PURPOSE is to explain (the B.MD page, a
    // developer lede) is a paragraph doing its job, and the reader chose to be there. It
    // has to be written at the site rather than inferred from a filename, because "this
    // file is documentation" is exactly the judgement that rots silently.
    const before = s.slice(Math.max(0, m.index - 400), m.index);
    if (/wall-of-text:\s*\S/.test(before)) { exempt += 1; continue; }
    const line = s.slice(0, m.index).split('\n').length;
    console.error(`✗ ${f}:${line}  ${fallback.length} characters, always on — ${key}`);
    bad += 1;
  }
}
if (bad) {
  console.error(`\n${bad} paragraph(s) of over ${LIMIT} characters that a reader cannot skip.`);
  console.error('Keep the sentence that changes what they do, and fold the rest in <Explain>.');
  process.exit(1);
}
console.log(`✓ no always-on paragraph over ${LIMIT} characters${exempt ? `, ${exempt} exempt with a stated reason` : ''}`);
