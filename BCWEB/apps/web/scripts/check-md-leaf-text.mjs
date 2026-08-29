#!/usr/bin/env node
// A directive that rendered NOTHING, and every other check went green.
//
// `:time[2026-09-01T20:00]{tz=Europe/Paris}` produced no element at all — not a wrong time, not
// a fallback, a gap in the middle of a sentence. It was documented in five places, named by
// three gates, and shipped in the downloadable kit.
//
// The cause is a distinction remark-directive makes and nothing here was checking:
// `data.directiveLabel` is set only on the `[label]` of a LEAF or CONTAINER directive. In a
// TEXT directive — `:name[…]` on one colon, inline — the brackets ARE the children and nothing
// is marked as a label. So `labelText` is empty, and the branch then did `node.children = []`,
// wiping the very content it had failed to read.
//
// The rule, which `:icon` and `:kbd` have always followed: **a branch that empties its children
// must have read them first, with `nodeText(node)`.** Anything else is reading a label that a
// text directive does not have, and then destroying the evidence.
//
// This cannot be caught by documentation checks — the directive WAS documented — nor by the
// round-trip check, which never renders. It is caught by reading what the branch does.
import { readFileSync, existsSync } from 'node:fs';

const SRC = 'src/markdown/index.jsx';
if (!existsSync(SRC)) { console.error(`✗ ${SRC} is missing — refusing to report success`); process.exit(2); }
const src = readFileSync(SRC, 'utf8');
const lines = src.split(/\r?\n/);

// Each `node.children = []` and the branch it sits in. A branch starts at the nearest
// `} else if (name === …` / `if (name === …` above it.
const wipes = [];
for (let i = 0; i < lines.length; i++) {
  if (!/^\s*node\.children = \[\];\s*$/.test(lines[i])) continue;
  let j = i;
  while (j >= 0 && !/(?:\}\s*else\s+)?if \(name === '/.test(lines[j])) j--;
  if (j < 0) { console.error(`✗ a children-wipe at line ${i + 1} sits in no directive branch — the extractor is stale`); process.exit(2); }
  const names = [...lines[j].matchAll(/name === '([a-z0-9-]+)'/g)].map((m) => m[1]);
  // The wipe line itself is excluded: it MENTIONS node.children, and counting it would let a
  // branch satisfy the rule by destroying the children and nothing else.
  //
  // COMMENTS STRIPPED, and that is not fussiness. The first version of this check went green
  // against the very bug it was written for: the comment explaining the fix said
  // "nodeText(node), NOT labelText", and the extractor matched the explanation instead of the
  // code. A gate that reads prose passes the moment somebody deletes the call and leaves the
  // sentence about it behind.
  const body = lines.slice(j, i).map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  wipes.push({ names, body, line: j + 1 });
}

if (!wipes.length) {
  // The pattern existing is the premise of this check. If it is gone, say so rather than
  // reporting that zero of zero branches are correct.
  console.error('✗ no `node.children = []` found — the renderer changed shape, so this check cannot be trusted');
  process.exit(2);
}

const problems = [];
for (const w of wipes) {
  // Two honest ways to have read them: the text of the node, or the children themselves
  // (`:::roadmap` takes its stages and its JSON block out of them — that is a read).
  if (w.body.includes('nodeText(node)') || w.body.includes('node.children')) continue;
  problems.push(`:${w.names.join(' / :')} (line ${w.line}) empties its children without reading them first`);
}

if (problems.length) {
  console.error('✗ leaf directives:');
  for (const p of problems) console.error(`    ${p}`);
  console.error('\n  `labelText` is empty for a TEXT directive — remark-directive marks a label only on');
  console.error('  leaf and container forms. Reading it and then wiping the children renders nothing');
  console.error('  at all: no error, no fallback, a gap in the sentence.');
  process.exit(1);
}
console.log(`✓ leaf directives OK — ${wipes.length} branch(es) read their content before emptying it`);
