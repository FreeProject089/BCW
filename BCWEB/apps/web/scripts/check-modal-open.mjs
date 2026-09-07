#!/usr/bin/env node
// `<Modal>` renders NOTHING unless it is given `open`.
//
// Written after "the New product button does nothing". It did do something: it set the draft
// state, React re-rendered, and `{draft && <Modal onClose=… title=…>}` returned a component
// whose first line is `if (!open) return null`. No error, no warning, no console message — the
// button just silently had no effect, and so did "Add keys" beside it.
//
// Nothing could have caught it. eslint has no idea the prop is required; the tests do not mount
// the admin page; the build is happy because a missing prop is `undefined`, which is valid
// JavaScript. And it reads fine: every other call site writes the bare shorthand `<Modal open
// onClose=…>`, which is easy to lose while editing a long JSX line and impossible to notice
// afterwards, because the two forms look almost identical.
//
// So: every `<Modal>` must pass `open`, in one of its two spellings. The parse is deliberately
// dumb — find the tag, scan to the matching `>` while ignoring anything inside braces, and look
// for the prop — because a JSX parser here would be a dependency for one rule.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src';
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(jsx|js)$/.test(name)) out.push(p);
  }
  return out;
}

const problems = [];
let checked = 0;

for (const file of walk(ROOT)) {
  const src = readFileSync(file, 'utf8');
  // The component itself declares the prop; skip its definition so the rule does not flag it.
  for (const m of src.matchAll(/<Modal\b/g)) {
    const i = m.index;
    let depth = 0, j = i;
    while (j < src.length) {
      const c = src[j];
      if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      else if (c === '>' && depth === 0) break;
      j += 1;
    }
    const tag = src.slice(i, j + 1);
    checked += 1;
    // `open` as a bare shorthand, or `open={…}`. `open` must be its own attribute — `onClose`
    // and `openLabel` must not satisfy it, which is what the boundary assertions are for.
    if (!/(^|\s)open(\s|=|>|\/)/.test(tag)) {
      const line = src.slice(0, i).split('\n').length;
      problems.push(`${file.replace(/\\/g, '/')}:${line} — <Modal> with no \`open\` prop; it will render nothing, silently\n      ${tag.replace(/\s+/g, ' ').slice(0, 110)}`);
    }
  }
}

// The matcher has to be right about the two spellings AND about the near-misses, or the rule is
// either noise or a rule that passes over the bug it was written for.
const probe = (tag) => /(^|\s)open(\s|=|>|\/)/.test(tag);
const selfTest = [
  ['<Modal open onClose={x}>', true],
  ['<Modal open={a} onClose={x}>', true],
  ['<Modal\n  open\n  onClose={x}>', true],
  ['<Modal onClose={x}>', false],
  ['<Modal onOpen={x}>', false],          // not the prop
  ['<Modal openLabel="x">', false],       // not the prop either
  ['<Modal reopen onClose={x}>', false],
];
for (const [tag, want] of selfTest) {
  if (probe(tag) !== want) {
    console.error(`✗ check-modal-open's own matcher is wrong about ${JSON.stringify(tag)} — refusing to report on the codebase`);
    process.exit(2);
  }
}

if (problems.length) {
  console.error('✗ a modal that is never given `open` never appears, and says nothing about it:');
  for (const p of problems) console.error(`    ${p}`);
  process.exit(1);
}
console.log(`✓ modals OK — ${checked} <Modal> use(s), every one passes \`open\``);
