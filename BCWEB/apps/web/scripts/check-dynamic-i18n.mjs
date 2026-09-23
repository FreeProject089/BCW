// Keys built from a template are invisible to i18n-check, and that is where the French runs out.
//
// The admin settings screen renders every row through `t(`hs.l.${k}`, label)` — the mechanism
// was there from the start. What was missing was the ENTRIES, and nothing could see it:
// i18n-check collects literal `t('x', …)` calls, so a template key never appears in its list
// of keys used, and its absence from the French dictionary is not a failure anybody can
// observe. Seven rows shipped in English, five of them the Feature-flags group, and every
// check in the repo was green the whole time.
//
// So this checker works from the DATA rather than from the call: it reads the tables that
// drive those screens, builds the keys the renderer will build, and asks whether French has
// them. Add a row to a table and forget the translation, and this says so by name.
//
// Adding a family: give it an entry in FAMILIES — where the table is, how to pull the ids
// out of it, and which key shapes the renderer derives. Nothing else changes.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/** Every single-quoted literal on a line, honouring backslash escapes.
 *  A hand scan, not a regex: these descriptions contain apostrophes, brackets and quotes,
 *  and every pattern tried against them mis-parsed at least one row. */
function stringsIn(line) {
  const out = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== "'") continue;
    i++;
    let buf = '';
    while (i < line.length && line[i] !== "'") {
      if (line[i] === '\\' && i + 1 < line.length) { buf += line.slice(i, i + 2); i += 2; continue; }
      buf += line[i++];
    }
    out.push(buf);
  }
  return out;
}

/** The bracketed literal that follows `const NAME =`, by bracket depth. */
function arrayAfter(src, name) {
  const at = src.indexOf(`const ${name}`);
  if (at < 0) return null;
  const open = src.indexOf('[', at);
  let depth = 1;
  let i = open + 1;
  while (depth > 0 && i < src.length) {
    if (src[i] === '[') depth++;
    else if (src[i] === ']') depth--;
    i++;
  }
  return src.slice(open, i);
}

const FAMILIES = [
  {
    what: 'admin settings rows',
    // The catalog moved to a shared module so the live screen and the Admin guide render from
    // one source; the rows (and their hs.l./hs.d. keys) live here now.
    file: 'src/lib/hosting-settings.js',
    array: 'HOSTING_SETTINGS_GROUPS',
    // A row is `['group.key', 'Label', 'Description', 'kind']`.
    ids: (block) => block
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('['))
      .map(stringsIn)
      .filter((s) => s.length >= 3 && s[0].includes('.'))
      .map((s) => s[0]),
    keys: (id) => [`hs.l.${id}`, `hs.d.${id}`],
  },
];

// M18: the French dictionary is its own module now (loaded on demand by i18n.jsx).
const i18n = read('src/i18n-fr.js');

// The French block, by brace depth from `fr: {`.
const frAt = i18n.indexOf('fr: {');
if (frAt < 0) {
  console.error('✗ could not find the fr dictionary — this checker cannot report success on a comparison it did not make');
  process.exit(2);
}
let depth = 0;
let i = i18n.indexOf('{', frAt);
const start = i;
do {
  if (i18n[i] === '{') depth++;
  else if (i18n[i] === '}') depth--;
  i++;
} while (depth > 0 && i < i18n.length);
const frBlock = i18n.slice(start, i);

const problems = [];
let checked = 0;

for (const fam of FAMILIES) {
  const src = read(fam.file);
  const block = arrayAfter(src, fam.array);
  if (!block) {
    console.error(`✗ ${fam.array} not found in ${fam.file} — refusing to report success`);
    process.exit(2);
  }
  const ids = fam.ids(block);
  if (!ids.length) {
    console.error(`✗ ${fam.array} parsed to zero rows — the shape changed, and a checker that finds nothing is worse than none`);
    process.exit(2);
  }
  for (const id of ids) {
    for (const key of fam.keys(id)) {
      checked++;
      if (!frBlock.includes(`'${key}'`)) problems.push(`${fam.what}: ${key} has no French entry — the row renders in English`);
    }
  }
}

if (!problems.length) {
  console.log(`✓ every template-built i18n key has a French entry (${checked} checked)`);
  process.exit(0);
}
for (const p of problems) console.error(`✗ ${p}`);
console.error('\n  These keys are built with a template, so i18n-check cannot see them.');
console.error('  Add them to the fr dictionary in src/i18n-fr.js.');
process.exit(1);
