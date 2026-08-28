// Every directive the renderer handles is named in the markdown guide — in BOTH languages.
//
// The guide is the only page that says what this vocabulary can do — it is seeded into every
// install as a blog post, and both the blog editor and the docs editor link to it from a
// "Guide" button. It documented TEN directives out of thirty-two: no file cards, no columns,
// no steps, no tabs, no buttons, no progress, no collapse, no alignment, not even badges by
// name.
//
// A reference that covers a third of what exists is worse than none, because the third it
// covers is the part people already knew, and the rest is invisible — nobody writes
// `:::steps` if nothing ever told them it exists.
//
// Nothing could see it: the renderer is a chain of `name === '…'` branches in one repo file
// and the guide is a template literal in another. Adding a directive and forgetting the page
// is the default outcome, not the unlucky one.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MD = join(ROOT, '../web/src/ui/md.jsx');
const SEED = join(ROOT, 'src/seed.mjs');
// The French page. It was NOT checked, and the gap this file exists to prevent reappeared in
// it the day the English page was rewritten: 32 directives on one side, ten on the other, and
// a French reader told the block system has ten blocks. One page checked is half a check.
const SEED_FR = join(ROOT, 'src/seed-blog-fr.mjs');
for (const f of [MD, SEED, SEED_FR]) {
  if (!existsSync(f)) { console.error(`✗ ${f} is missing — refusing to report success`); process.exit(2); }
}
const md = readFileSync(MD, 'utf8');
const seed = readFileSync(SEED, 'utf8');
const seedFr = readFileSync(SEED_FR, 'utf8');

const at = md.indexOf("if (CALLOUTS[name]");
if (at < 0) { console.error('✗ the directive chain is not where this check looks — it cannot be trusted'); process.exit(2); }
const chain = md.slice(at, md.indexOf('\n    });', at));
const supported = new Set([...chain.matchAll(/name === '([a-z][a-z0-9-]*)'/g)].map((m) => m[1]));
// `custom` is the callout escape hatch and is documented as part of :::callout; `card` and
// `cards` are one section. Both are named in the page anyway — nothing is exempt here.

const gStart = seed.indexOf('const guideBody');
if (gStart < 0) { console.error('✗ guideBody is not where this check looks — it cannot be trusted'); process.exit(2); }
const pages = [['English', seed.slice(gStart, seed.indexOf('const guideFr', gStart))]];

// The French guide is one value in the BLOG_FR map, not a standalone constant, so its slice
// ends at the next entry rather than at a named marker.
const frStart = seedFr.indexOf("'markdown-guide':");
if (frStart < 0) { console.error("✗ BLOG_FR['markdown-guide'] is not where this check looks — it cannot be trusted"); process.exit(2); }
const nextKey = seedFr.indexOf("':", frStart + 20);
pages.push(['French', seedFr.slice(frStart, nextKey > 0 ? seedFr.lastIndexOf('\n', nextKey) : seedFr.length)]);

if (supported.size < 20) {
  console.error(`✗ read ${supported.size} directive(s) — too few to be right`);
  process.exit(2);
}
for (const [lang, body] of pages) {
  if (body.length < 800) {
    console.error(`✗ the ${lang} guide read as ${body.length} chars — too little to be right`);
    process.exit(2);
  }
}

// Named anywhere in the page: as a live example, or inside an inline-code sample.
let bad = false;
for (const [lang, body] of pages) {
  const missing = [...supported].filter((d) => !new RegExp(`:{1,3}${d}\\b`).test(body)).sort();
  if (!missing.length) continue;
  bad = true;
  console.error(`✗ markdown guide (${lang}):`);
  console.error(`  ${missing.length} directive(s) the renderer handles and this page never names:`);
  for (const d of missing) console.error(`    :${d}`);
}
if (bad) {
  console.error('\nThis page is seeded into every install and both editors link to it. A block');
  console.error('nobody is told about is a block nobody uses — and a reader gets the page in');
  console.error('their own language, not the one that happens to be complete.');
  process.exit(1);
}
console.log(`✓ markdown guide OK — all ${supported.size} directive(s) documented in ${pages.length} language(s)`);
