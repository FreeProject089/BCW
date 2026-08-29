#!/usr/bin/env node
// A "start from the real home page" preset that is not the real home page.
//
// The page builder offers "Start from: the long landing page", and its own comment explains
// why: "nobody wants to rebuild their own home page from an empty box, and the fastest way
// to understand the palette is to see a page you recognise made out of it".
//
// It offered hero, showcase, products, stats, news, reviews, myo. The real v1 draws poll,
// products, why, steps, dev, myo, reviews, news. Four sections missing, one present that the
// real page has never had — so the page you recognised was not the page you got, and the
// only way to notice was to know both lists by heart.
//
// Nothing compared them. `HOME_VARIANTS` lives in the API and declares what each landing
// page HAS; `STARTERS` lives in the editor and declares what each preset BUILDS. Two lists
// of the same thing, in two languages, in two packages.
//
// This joins them: every section a variant declares must appear in that variant's starter,
// as a dynamic block of the same name or as blocks that stand in for it.
import { readFileSync, existsSync } from 'node:fs';

const API = '../api/src/routes/misc.mjs';
const ED = 'src/editor/page-builder.jsx';
for (const f of [API, ED]) {
  if (!existsSync(f)) { console.error(`✗ ${f} is missing — refusing to report success`); process.exit(2); }
}
const api = readFileSync(API, 'utf8');
const ed = readFileSync(ED, 'utf8');

// ── what each landing page HAS ──
const varAt = api.indexOf('export const HOME_VARIANTS');
if (varAt < 0) { console.error('✗ HOME_VARIANTS moved — this check cannot be trusted'); process.exit(2); }
const varBlock = api.slice(varAt, api.indexOf('\n};', varAt));

const sectionsAt = api.indexOf('export const HOME_SECTIONS');
const allSections = [...api.slice(sectionsAt, api.indexOf('\n', sectionsAt)).matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
if (allSections.length < 5) {
  console.error(`✗ read ${allSections.length} section(s) from HOME_SECTIONS — too few to be right`);
  process.exit(2);
}

const variants = {};
for (const m of varBlock.matchAll(/(\w+):\s*\{\s*sections:\s*([^}]+)\}/g)) {
  const raw = m[2];
  // `sections: HOME_SECTIONS` means all of them; anything else is a literal list.
  variants[m[1]] = raw.includes('HOME_SECTIONS')
    ? allSections
    : [...raw.matchAll(/'([a-z]+)'/g)].map((x) => x[1]);
}
if (Object.keys(variants).length < 2) {
  console.error('✗ parsed fewer than two variants — the shape changed, so this cannot be trusted');
  process.exit(2);
}

// ── what each preset BUILDS ──
const stAt = ed.indexOf('export const STARTERS');
if (stAt < 0) { console.error('✗ STARTERS moved — this check cannot be trusted'); process.exit(2); }
const stBlock = ed.slice(stAt);

/** One starter's source, from its key to the next top-level key. */
function starterSource(key) {
  const start = stBlock.indexOf(`\n  ${key}: (t) => [`);
  if (start < 0) return null;
  const rest = stBlock.slice(start + 1);
  const next = rest.search(/\n  \w+: \(t\) => \[/);
  return next < 0 ? rest : rest.slice(0, next);
}

// A section is satisfied by its own dynamic block, or by the stand-ins named here. `why` and
// `steps` have no block and should not: they are CONTENT, and rebuilding them out of a
// heading and cards is the thing this builder is for. What must not happen is them being
// absent, so each names the heading key the real page uses.
const STANDIN = {
  why: ["t('home.k.why'"],
  steps: ["t('home.steps.title')"],
  dev: ["B('devtools'"],
  products: ["B('products'"],
  news: ["B('news'"],
  poll: ["B('poll'"],
  reviews: ["B('reviews'"],
  myo: ["B('myo'"],
};

const problems = [];
for (const [key, sections] of Object.entries(variants)) {
  const src = starterSource(key);
  if (src === null) {
    // Not every variant needs a preset, but a MISSING one should be a decision, not a
    // surprise. Reported as information rather than failure.
    console.log(`  · ${key}: no starter preset (the builder offers none for this variant)`);
    continue;
  }
  for (const sec of sections) {
    const needles = STANDIN[sec] || [`B('${sec}'`];
    if (!needles.some((n) => src.includes(n))) {
      problems.push(`${key}: the real page draws "${sec}" and the preset never builds it`);
    }
  }
}

if (problems.length) {
  console.error('✗ home starters:');
  for (const p of problems) console.error(`    ${p}`);
  console.error('\n  The preset is offered as "the page you recognise, made out of blocks". One that');
  console.error('  leaves sections out is a different page wearing that promise, and the only way to');
  console.error('  notice is to know both lists by heart.');
  process.exit(1);
}
const total = Object.values(variants).reduce((n, v) => n + v.length, 0);
console.log(`✓ home starters OK — ${Object.keys(variants).length} variant(s), ${total} section(s), each built by its preset`);
