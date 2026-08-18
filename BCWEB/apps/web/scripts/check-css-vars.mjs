// Every `var(--x)` the app uses, against every `--x` the themes define.
//
// The bug that bought this check: nine places read `var(--surface-1)`, a token that has never
// existed — the scale is `--surface`, `--surface-2`, `--surface-3`. Nothing complained.
//
// In most CSS a missing variable is harmless: the declaration is dropped and the element
// keeps its inherited value. Inside `color-mix()` it is not. An undefined argument makes the
// whole function invalid, an invalid `fill` on an SVG rect falls back to the INITIAL value,
// and the initial value of `fill` is black. So the code map drew every file as a solid black
// bar with black text on it — unreadable on the light theme, invisible on the dark one where
// a black box looks deliberate. It shipped, and it took a screenshot from the person using it
// to find.
//
// This is deliberately dumb: it does not parse CSS, it collects names. A name that is used
// and never defined is the entire class of bug, and one greps for it in a second.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');

/** Names that are defined somewhere no scan can see, or supplied at runtime. */
const EXTERNAL = new Set([
    // Written onto the element by the theme editor / the admin's theme preview.
    '--glass-alpha',
    // Tailwind's own, and the browser's.
    '--tw-ring-color', '--tw-ring-offset-color',
]);

const files = [];
(function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(jsx?|css)$/.test(e.name)) files.push(p);
    }
})(SRC);

const defined = new Set(EXTERNAL);
const used = new Map();   // name -> [file:line]

for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    // A definition is `--x:` at the start of a declaration. Written in a JS string (the theme
    // editor builds CSS text) it counts too — it really does define the token.
    for (const m of text.matchAll(/(^|[;{\s'"`])(--[a-zA-Z0-9-]+)\s*:/g)) defined.add(m[2]);
    text.split('\n').forEach((line, i) => {
        for (const m of line.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)\s*(,|\))/g)) {
            // `var(--x, fallback)` is safe by construction: the fallback is what it uses.
            if (m[2] === ',') continue;
            const at = `${path.relative(ROOT, f).replace(/\\/g, '/')}:${i + 1}`;
            if (!used.has(m[1])) used.set(m[1], []);
            used.get(m[1]).push(at);
        }
    });
}

const missing = [...used.entries()].filter(([name]) => !defined.has(name));

if (missing.length) {
    console.error(`${missing.length} CSS variable(s) are used and never defined:\n`);
    for (const [name, where] of missing) {
        console.error(`  ${name}`);
        for (const w of where.slice(0, 6)) console.error(`      ${w}`);
        if (where.length > 6) console.error(`      …and ${where.length - 6} more`);
    }
    console.error('\nInside color-mix() this is not harmless: the function becomes invalid, and an');
    console.error('invalid fill falls back to BLACK. Define it, or give the var() a fallback.');
    process.exit(1);
}

console.log(`✓ ${used.size} CSS variable(s) used, all defined`);
