// Link checker for the guides tree — `node guides/check-links.mjs`.
//
// The guides cross-reference each other heavily (100+ relative links). Any reorganisation
// silently breaks them: markdown links fail at read time, not at build time, so a dead link
// ships and is only found by a reader. This walks every .md under guides/ (plus the files
// outside that link INTO it), resolves each relative link against its own directory, and
// exits non-zero on the first dead one.
//
// Checks relative .md targets and anchors within this repo. Skips http(s), mailto and bare
// #anchors (a heading check would need a markdown parser and gives little here).
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUIDES = dirname(fileURLToPath(import.meta.url));
const BCWEB = resolve(GUIDES, '..');

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

// Guides + the handful of files elsewhere that point into guides/.
const files = [...walk(GUIDES)];
for (const extra of ['README.md', 'native/README.md', 'loadtest/BENCHMARK.md', 'loadtest/BENCHMARK_FR.md']) {
  const p = join(BCWEB, extra);
  if (existsSync(p)) files.push(p);
}

const LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
let dead = 0, checked = 0;

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(LINK)) {
    const raw = m[1];
    if (/^(https?:|mailto:|#)/.test(raw)) continue;
    const target = raw.split('#')[0];
    if (!target) continue;
    checked++;
    const abs = resolve(dirname(file), target);
    if (!existsSync(abs)) {
      dead++;
      console.error(`DEAD  ${relative(BCWEB, file).split(sep).join('/')}  ->  ${raw}`);
    } else if (statSync(abs).isDirectory() && !existsSync(join(abs, 'README.md'))) {
      dead++;
      console.error(`DIR (no README)  ${relative(BCWEB, file).split(sep).join('/')}  ->  ${raw}`);
    }
  }
}

console.log(`\nchecked ${checked} relative links across ${files.length} files — ${dead ? `${dead} DEAD` : 'all resolve'}`);
process.exit(dead ? 1 : 0);
