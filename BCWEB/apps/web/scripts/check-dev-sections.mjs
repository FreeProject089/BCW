// Every block the /dev page can hide must have a switch, and every switch must hide a block.
//
// The editor's Blocks section is headed "Turn a whole block of the page off" and offered
// exactly one switch, for the jobs pair. The page renders four blocks. So the showcase — the
// home page's, embedded on a page about REST endpoints, pulling in rrweb the moment a replay
// panel appears — could not be turned off, and neither could the OIDC discovery URL, which a
// site that does not run OIDC was publishing anyway.
//
// Nothing reports this. Both files are valid, both render, and the two lists are in different
// directories written months apart. It is the same drift the /dev hub already had once, when
// 'developers' was added to the admin's project rail and not to the API's KEYS.
//
// The reverse matters just as much: a switch for a block the page no longer draws is a
// control that does nothing, which is worse than no control — somebody unticks it, the thing
// stays on screen, and the conclusion they reach is that the admin panel is broken.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = join(ROOT, 'src/pages/dev.jsx');
const EDITOR = join(ROOT, 'src/editor/project-config-editor.jsx');

for (const f of [PAGE, EDITOR]) {
  if (!existsSync(f)) {
    console.error(`✗ ${f} is missing — refusing to report success`);
    process.exit(2);
  }
}

// `show.x !== false` — the page's own idiom for "on unless an admin said otherwise".
const page = readFileSync(PAGE, 'utf8');
const rendered = new Set([...page.matchAll(/\bshow\.([a-zA-Z][\w]*)\s*!==\s*false/g)].map((m) => m[1]));

// The editor's switches for the developers slug. Read from the `sections[k] !== false` list
// it maps over, plus any that are still written out one at a time.
const editor = readFileSync(EDITOR, 'utf8');
const devBlock = editor.slice(editor.indexOf("if (slug === 'developers')"));
const end = devBlock.indexOf('\n  }\n');
const scoped = end > 0 ? devBlock.slice(0, end) : devBlock;
const offered = new Set([
  // `setIn('sections', { jobs: … })` — the one-at-a-time spelling.
  ...[...scoped.matchAll(/setIn\('sections',\s*\{\s*([a-zA-Z][\w]*)\s*:/g)].map((m) => m[1]),
  // `['jobs', '…']` inside the list the switches are generated from.
  ...[...scoped.matchAll(/^\s*\['([a-zA-Z][\w]*)',\s*'/gm)].map((m) => m[1]),
]);

if (!rendered.size || !offered.size) {
  // The regexes ARE the check. If either stops matching — the idiom changes, the editor moves
  // — this has to fail loudly rather than report that the two empty sets agree.
  console.error(`✗ read ${rendered.size} block(s) from dev.jsx and ${offered.size} switch(es) from the editor — too few to be right`);
  process.exit(2);
}

const problems = [];
for (const k of rendered) if (!offered.has(k)) problems.push(`dev.jsx can hide "${k}" and the editor has no switch for it`);
for (const k of offered) if (!rendered.has(k)) problems.push(`the editor offers a switch for "${k}" and dev.jsx never reads it — the control does nothing`);

if (problems.length) {
  console.error('✗ /dev blocks:');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`✓ /dev blocks OK — ${rendered.size} block(s), each with a switch: ${[...rendered].sort().join(', ')}`);
