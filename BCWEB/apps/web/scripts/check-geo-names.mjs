// The analytics choropleth can only shade a country whose ISO code resolves to a name that
// exists in public/world.json. This proves that every code does — or is on the explicit
// "not in this map file" list.
//
// It exists because the mapping it checks used to be a hand-kept table with no check at
// all, and two of its 29 entries named countries that are not in world.json: `LA: 'Laos'`
// (the file says "Lao PDR") and `TW: 'Taiwan'` (absent entirely). Laos and Taiwan simply
// never shaded, and nothing anywhere said so — the map just had a hole in it.
//
// Run: npm run --prefix apps/web geo:check
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, '..');

const world = JSON.parse(readFileSync(join(WEB, 'public', 'world.json'), 'utf8'));
const features = new Set(world.features.map((f) => f.properties?.name).filter(Boolean));

const { FEATURE_NAME, ABSENT_FROM_MAP, featureNameFor } =
    await import(new URL('../src/lib/geo-names.js', import.meta.url));

const errors = [];
const warnings = [];

// 1. Every override must name a feature that is really in the file.
for (const [cc, name] of Object.entries(FEATURE_NAME)) {
    if (!features.has(name)) errors.push(`${cc} → ${JSON.stringify(name)} is not a country in world.json`);
}

// 2. No override may be redundant: if Intl already returns the file's name, the entry is a
//    second place to keep the same truth, and the two drift.
const display = new Intl.DisplayNames(['en'], { type: 'region' });
for (const [cc, name] of Object.entries(FEATURE_NAME)) {
    let intl;
    try { intl = display.of(cc); } catch { intl = null; }
    if (intl === name) warnings.push(`${cc} → ${name} is redundant (Intl already returns it)`);
}

// 3. Every code must be in exactly one of: resolvable, or explicitly absent.
const codes = [];
for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
        const cc = String.fromCharCode(a, b);
        let n;
        try { n = display.of(cc); } catch { continue; }
        if (n && n !== cc) codes.push(cc);
    }
}
const unresolved = [];
for (const cc of codes) {
    if (ABSENT_FROM_MAP.has(cc) && FEATURE_NAME[cc]) {
        errors.push(`${cc} is both mapped and listed as absent`);
        continue;
    }
    const name = featureNameFor(cc);
    if (name === null) {
        if (!ABSENT_FROM_MAP.has(cc)) unresolved.push(`${cc} (${display.of(cc)})`);
        continue;
    }
    if (!features.has(name)) unresolved.push(`${cc} (${display.of(cc)}) → ${JSON.stringify(name)}`);
}
if (unresolved.length) {
    errors.push(`${unresolved.length} code(s) resolve to nothing on the map and are not listed as absent:`);
    for (const u of unresolved) errors.push(`    ${u}`);
}

// 4. An entry in ABSENT_FROM_MAP that CAN be resolved is stale — the map file changed.
for (const cc of ABSENT_FROM_MAP) {
    let intl;
    try { intl = display.of(cc); } catch { continue; }
    if (intl && features.has(intl)) {
        errors.push(`${cc} is listed as absent but world.json now has "${intl}" — remove it from ABSENT_FROM_MAP`);
    }
}

for (const w of warnings) console.log(`\x1b[33m!  ${w}\x1b[0m`);
if (errors.length) {
    console.error(`\n\x1b[31m✗ check-geo-names: ${errors.length} problem(s)\x1b[0m`);
    for (const e of errors) console.error(`  ${e}`);
    process.exit(1);
}
const mapped = codes.filter((cc) => featureNameFor(cc)).length;
console.log(`\x1b[32m✓ check-geo-names: ${mapped}/${codes.length} country codes shade a real feature; `
    + `${ABSENT_FROM_MAP.size} are documented as absent from this map\x1b[0m`);
