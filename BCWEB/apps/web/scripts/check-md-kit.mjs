// The markdown kit has to stay copy-and-go.
//
// It is documented as "copy the folder into your project", and that claim is one careless
// import away from being false: a `../ui/ui.jsx` added inside src/markdown/ leaves this repo
// building perfectly and the folder unusable anywhere else. The failure is invisible from
// here — nothing in BetterCommunity notices, because in BetterCommunity that file exists.
//
// So the rule is mechanical: nothing under src/markdown/ may import from outside src/markdown/.
// Bare package specifiers are fine (they are the documented dependency list); relative paths
// that climb out are not.
//
// The dependency list is checked too, for the same reason in reverse: a package the kit
// imports and the README does not name is a project that installs the kit and gets a resolve
// error on first render.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KIT = join(ROOT, 'src/markdown');
const README = join(KIT, 'README.md');

if (!existsSync(KIT) || !existsSync(README)) {
  console.error(`✗ ${KIT} is not where this check looks — it cannot be trusted`);
  process.exit(2);
}

const files = readdirSync(KIT).filter((f) => /\.(jsx?|css)$/.test(f));
if (files.length < 4) {
  console.error(`✗ read ${files.length} file(s) in the kit — too few to be right`);
  process.exit(2);
}

const readme = readFileSync(README, 'utf8');
const escapes = [];
const packages = new Set();

for (const f of files) {
  const src = readFileSync(join(KIT, f), 'utf8');
  // `import … from 'x'`, `import 'x'`, and dynamic `import('x')` — the three forms this
  // folder actually uses. A check that only knew the first would have missed the lazy
  // katex/highlight loads, which are the imports most likely to reach outside.
  for (const m of src.matchAll(/(?:from\s*|import\s*\(?\s*)['"]([^'"]+)['"]/g)) {
    const spec = m[1];
    if (spec.startsWith('.')) {
      // Relative and staying inside the folder is fine; climbing out is not.
      if (spec.startsWith('../')) escapes.push(`${f} → ${spec}`);
      continue;
    }
    // A bare specifier. `katex/dist/katex.min.css` is the `katex` package.
    packages.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);
  }
}

let bad = false;
if (escapes.length) {
  bad = true;
  console.error('✗ the markdown kit reaches outside itself:');
  for (const e of escapes) console.error(`    ${e}`);
  console.error('\nThe folder is documented as copy-and-go. An import that climbs out of it');
  console.error('resolves here and nowhere else, and nothing in this repo would ever notice.');
}

// `react` and `react-dom` are named in the install line; everything else has to be too.
const undocumented = [...packages].filter((p) => !readme.includes(p)).sort();
if (undocumented.length) {
  bad = true;
  console.error('✗ the kit imports package(s) its README never names:');
  for (const p of undocumented) console.error(`    ${p}`);
  console.error('\nSomebody follows the install line, copies the folder, and gets a resolve');
  console.error('error on the first document they render.');
}

// The same rule for the VOCABULARY, which fails more quietly than a missing package does.
//
// The kit ships the real renderer — `?raw`, so what you download is the code this site runs —
// and this README is its only documentation. A directive it does not name is one the
// downloader never uses: no resolve error, no console line, nothing. They simply ship a
// renderer with capabilities they were never told about.
//
// Aliases count. Somebody reading a document that uses `:::hours` looks it up here, finds
// nothing, and concludes their copy is out of date.
// The parser, not the assembly: index.jsx names no directives now.
const index = readFileSync(join(KIT, 'directives.js'), 'utf8');
const directives = new Set();
for (const m of index.matchAll(/name === '([a-z0-9-]+)'/g)) directives.add(m[1]);
const callouts = index.match(/^const CALLOUTS = \{([\s\S]*?)^\};/m);
if (callouts) for (const m of callouts[1].matchAll(/([a-z0-9-]+):/g)) directives.add(m[1]);

if (directives.size < 30) {
  // Without this, a rename of the branch style empties the left-hand side and the comparison
  // below passes by comparing nothing.
  console.error(`\u2717 read ${directives.size} directive(s) from index.jsx — the extractor is stale`);
  process.exit(2);
}
const named = new Set();
for (const m of readme.matchAll(/:{1,3}([a-z][a-z0-9-]*)/g)) named.add(m[1]);
const unnamed = [...directives].filter((d) => !named.has(d)).sort();
if (unnamed.length) {
  bad = true;
  console.error('\u2717 the kit renders directive(s) its README never names:');
  for (const d of unnamed) console.error(`    :::${d}`);
  console.error('\nThe README is the kit\'s only documentation. A block nobody is told about is');
  console.error('a block nobody uses \u2014 and unlike a missing package, nothing errors to say so.');
}

if (bad) process.exit(1);
console.log(`✓ markdown kit OK — ${files.length} file(s), self-contained, ${packages.size} documented dependenc(ies), ${directives.size} directive(s) named`);
