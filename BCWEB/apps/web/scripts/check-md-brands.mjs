// A brand button must be able to draw its logo, and an anchor must keep its class.
//
// Two failures from one afternoon, both of which render something and are still wrong.
//
// 1. BUTTON_BRANDS names an icon per brand. `patreon` and `steam` had no local mark and are
//    not lucide names either, so the fallback resolved to a 404 and drew empty space: a
//    correctly coloured button with a hole where the logo goes. Every brand offered has to
//    resolve in ICONS.
//
// 2. rehype-sanitize's GitHub default schema lists `a`'s className as
//    ['className', 'data-footnote-backref'] — an allowlist of VALUES, not a permission — and a
//    per-tag entry overrides the blanket one in '*'. Spreading that default into our `a` entry
//    filtered every anchor class down to nothing, so React rendered `class=""`. A :button came
//    out with its href, its colour variable and its logo, and no styling at all, while a
//    :badge two characters away kept its class because `span` has no per-tag entry.
//
// The second is the nastier shape: it breaks EVERY anchor-based directive at once, silently,
// and only for anchors — so it looks like the new thing is broken rather than the schema.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Four claims across four files now — the brand table is a parser concern, the icon set a
// rendering one, the sanitiser schema its own file, and the math options live in the
// assembly. Reading the whole kit and slicing from that is the only version of this check
// that survives the next move, and it cannot report a false pass: every claim below still
// has to find its text somewhere.
const KIT = join(dirname(fileURLToPath(import.meta.url)), '../src/markdown');
const KIT_FILES = ['icons.jsx', 'directives.js', 'sanitize.js', 'index.jsx'];
const MD = join(KIT, 'icons.jsx');
const BRANDS = join(dirname(fileURLToPath(import.meta.url)), '../src/markdown/brands.jsx');
for (const f of [MD, BRANDS]) {
  if (!existsSync(f)) { console.error(`✗ ${f} is missing — refusing to report success`); process.exit(2); }
}
const src = KIT_FILES.map((f) => readFileSync(join(KIT, f), 'utf8')).join(String.fromCharCode(10));

const brandSrc = readFileSync(BRANDS, 'utf8');

const slice = (name) => {
  const at = src.indexOf(`const ${name} = {`);
  return at < 0 ? null : src.slice(at, src.indexOf('\n};', at));
};
const brands = slice('BUTTON_BRANDS');
const icons = slice('ICONS');
if (!brands || !icons) {
  console.error('✗ BUTTON_BRANDS or ICONS is not where this check looks — it cannot be trusted');
  process.exit(2);
}

const wanted = [...brands.matchAll(/icon:\s*'([a-z0-9-]+)'/g)].map((m) => m[1]);
// `\s*` after the anchor as well as after a comma: the entries are indented, and without it
// every key at the start of a line was missed — the check reported `github` as absent while
// the browser was drawing its logo. A checker that is wrong about the code is worse than
// none, because the first thing it does is send you to fix something that is not broken.
const known = new Set([...icons.matchAll(/(?:^|[{,])\s*'?([a-zA-Z][\w-]*)'?\s*:/gm)].map((m) => m[1]));
if (wanted.length < 3 || known.size < 20) {
  console.error(`✗ read ${wanted.length} brand(s) and ${known.size} icon(s) — too few to be right`);
  process.exit(2);
}

const problems = [];
for (const w of wanted) {
  if (!known.has(w)) problems.push(`BUTTON_BRANDS offers "${w}" and ICONS has no entry for it — the button draws a hole where the logo goes`);
}

// A mark that is fetched is a mark that can fail to arrive.
//
// Ko-fi's was a CSS mask over cdn.simpleicons.org — a reasonable-looking fix for an outdated
// inline path, and it put a third-party request on every page with a Ko-fi button. When that
// request does not arrive (offline, an ad-blocker, the CDN having a day) the button is a
// coloured rectangle with a hole in it: no error, no fallback, and it looks like the button is
// broken rather than like a network fetch failed.
//
// The whole point of these being local components is that they cannot do that. One URL in this
// file undoes it for one brand, invisibly, on the machines least able to tell you.
//
// Comments are stripped first: this check's own explanation names the CDN. Whole comment
// LINES, not a `//`-to-end-of-line rule — `//` appears inside `https://`, so that rule
// deletes the rest of any line containing a URL, which is every line this check exists to
// find. The first plant passed against broken code because of exactly that.
const brandCode = brandSrc
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
for (const m of brandCode.matchAll(/https?:\/\/[^\s'"()]+/g)) {
  problems.push(`a brand mark is fetched from ${m[0]} — marks are inline so they cannot fail to load`);
}

// The anchor className tuple must be filtered out of the schema, not merged in.
const aEntry = src.slice(src.indexOf('    a: ['), src.indexOf('\n', src.indexOf("'download'")));
if (!/filter\(\(x\) => !\(Array\.isArray\(x\) && x\[0\] === 'className'\)\)/.test(aEntry)) {
  problems.push("the sanitiser's `a` entry no longer drops the default className tuple — every anchor class will be emptied to \"\"");
}
if (!/'className'/.test(aEntry)) {
  problems.push("the sanitiser's `a` entry does not allow className plainly — anchor-based directives will render unstyled");
}

// Math must not eat money.
//
// remark-math's single-dollar inline rule reads `$5 and $10` as a formula and prints
// `5and10`. Measured on a live page, not guessed. This is a blog and documentation platform
// that sells hosting in dollars, so that sentence is not hypothetical — and the failure is
// silent: the price does not error, it becomes italic nonsense.
//
// So math is written `$$…$$`, inline or display, and `singleDollarTextMath: false` is what
// enforces it. Turning it back on would look like an improvement and would corrupt prose.
if (!/singleDollarTextMath:\s*false/.test(src)) {
  problems.push('remark-math is not configured with singleDollarTextMath: false — `$5 and $10` in any post will be typeset as a formula');
}
// And KaTeX must stay untrusting: `trust` is what gates \href, \url and the \html* commands,
// the only ones that can put author-controlled markup past the sanitiser this runs after.
if (/trust:\s*true/.test(src)) {
  problems.push('rehype-katex is configured with trust: true — that lets a formula emit markup, and it runs after the sanitiser');
}

if (problems.length) {
  console.error('✗ markdown brands / anchors:');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`✓ markdown OK — ${wanted.length} brand icon(s) resolve, anchors keep their class`);
