#!/usr/bin/env node
// The site theme has three copies of the same truth, and nothing made them agree.
//
//   1. index.css writes `var(--grad-x, <the shipped gradient>)`. That fallback IS the look a
//      site gets when it has never configured anything.
//   2. theme-gradients.js holds the same gradient as data — what the editor starts from and
//      what "reset" gives back.
//   3. theme-tokens.js lists the tokens the editor offers, and config-schemas.mjs holds the
//      allowlist the API validates against. A token in one and not the other is either a
//      control that saves nothing (400 on every Apply) or a value the API accepts that no
//      one can ever set.
//
// Each of those pairs drifts silently. A changed CSS fallback makes "reset" alter the site;
// a token added to the editor alone makes the whole Apply fail with `invalid_input`, which
// reads as the theme editor being broken rather than as one missing string.
//
// It also RENDERS both cards through react-dom/server, for the reason check-block-canvas.mjs
// exists: eslint proves nothing about a name used only in a render path, and a component in
// no test is a component whose first run is a superadmin's white screen.
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const problems = [];
const must = (cond, why) => { if (!cond) problems.push(why); };

const CSS = 'src/index.css';
const CARDS = 'src/editor/site-theme-cards.jsx';
for (const f of [CSS, CARDS]) {
  if (!existsSync(f)) { console.error(`✗ ${f} is missing — refusing to report success`); process.exit(2); }
}

// ── 1. the stylesheet fallbacks vs the stored defaults ───────────────────────────────
const css = readFileSync(CSS, 'utf8');
const { GRADIENTS, gradientCss, defaultSpec } = await import(pathToFileURL(join(process.cwd(), 'src/ui/theme-gradients.js')).href);

const norm = (s) => s.replace(/\s+/g, ' ').trim();
for (const g of GRADIENTS) {
  // `var(--grad-x, linear-gradient(…))` — the fallback runs to the matching close paren, and
  // a gradient contains parens of its own, so it is counted rather than matched.
  const at = css.indexOf(`var(${g.name},`);
  if (at === -1) { problems.push(`${g.name} is never read by index.css — the editor would offer a control that paints nothing`); continue; }
  let i = at + `var(${g.name},`.length, depth = 1, out = '';
  while (i < css.length && depth > 0) {
    const c = css[i];
    if (c === '(') depth += 1;
    else if (c === ')') { depth -= 1; if (depth === 0) break; }
    out += c; i += 1;
  }
  const want = gradientCss(defaultSpec(g.name));
  must(norm(out) === norm(want),
    `${g.name}: index.css falls back to "${norm(out)}" but the stored default builds "${norm(want)}" — "reset to the shipped gradient" would change the site`);
}

// --page-top is the same contract in the other direction: the token has to be READ by the
// stylesheet, or deriving it does nothing.
must(css.includes('var(--page-top,'), '--page-top is derived and offered in the editor but index.css never reads it');

// ── 2. the two token allowlists ──────────────────────────────────────────────────────
const { TOKENS } = await import(pathToFileURL(join(process.cwd(), 'src/ui/theme-tokens.js')).href);
const api = readFileSync('../api/src/lib/config-schemas.mjs', 'utf8');
const block = api.slice(api.indexOf('const TOKEN_NAMES'), api.indexOf(']);', api.indexOf('const TOKEN_NAMES')));
const apiNames = new Set(block.match(/'(--[a-z0-9-]+)'/g)?.map((s) => s.slice(1, -1)) || []);
must(apiNames.size > 0, 'could not read the API token allowlist — this check would pass vacuously');
for (const tk of TOKENS) {
  must(apiNames.has(tk.name), `${tk.name} is offered by the editor but the API refuses it — every Apply would 400`);
}
for (const n of apiNames) {
  must(TOKENS.some((tk) => tk.name === n), `${n} is accepted by the API but no editor control sets it`);
}

// Same for the gradient names, which the API allowlists separately.
const gBlock = api.slice(api.indexOf('const GRADIENT_NAMES'), api.indexOf(']);', api.indexOf('const GRADIENT_NAMES')));
const apiGrads = new Set(gBlock.match(/'(--grad-[a-z0-9-]+)'/g)?.map((s) => s.slice(1, -1)) || []);
for (const g of GRADIENTS) must(apiGrads.has(g.name), `${g.name} is offered by the editor but the API refuses it`);
for (const n of apiGrads) must(GRADIENTS.some((g) => g.name === n), `${n} is accepted by the API but the editor never offers it`);

// ── 3. both cards actually render ────────────────────────────────────────────────────
const entry = join(process.cwd(), 'node_modules', '.sitetheme-entry.jsx');
const bundle = join(process.cwd(), 'node_modules', '.sitetheme-bundle.mjs');
const cleanup = () => { for (const f of [entry, bundle]) { try { rmSync(f, { force: true }); } catch { /* gone already */ } } };

try {
  const esbuild = await import('esbuild');
  writeFileSync(entry, [
    "import { renderToStaticMarkup } from 'react-dom/server';",
    "import { I18nProvider } from '../src/i18n.jsx';",
    "import { BrandMarksCard, GradientsCard } from '../src/editor/site-theme-cards.jsx';",
    // The cards read t() from context, so they render inside the real provider — the same one
    // the app mounts. Its network fetch lives in an effect, which renderToStaticMarkup never
    // runs, so this needs nothing but the dictionary.
    'export const render = (f) => renderToStaticMarkup(',
    '  <I18nProvider>',
    '    <BrandMarksCard f={f} setF={() => {}} />',
    '    <GradientsCard f={f} setF={() => {}} lang="en" />',
    '  </I18nProvider>);',
  ].join('\n'));
  await esbuild.build({
    nodePaths: [join(process.cwd(), 'node_modules')],
    entryPoints: [entry], outfile: bundle, bundle: true, format: 'esm', platform: 'node',
    jsx: 'automatic', logLevel: 'silent', packages: 'external', loader: { '.css': 'empty' },
  });
} catch (e) {
  console.error(`✗ could not build the site-theme cards for node: ${e?.message || e}`);
  cleanup(); process.exit(2);
}

let render;
try { ({ render } = await import(pathToFileURL(bundle).href)); }
catch (e) { console.error(`✗ the site-theme cards would not load: ${e?.message || e}`); cleanup(); process.exit(1); }

// A theme with nothing configured — the state every install starts in, and the one where an
// undefined bag would throw.
const EMPTY = { accent: '#f97316', accent2: '#f59e0b', mode: 'light', preset: '', light: null, dark: null, shared: null, gradients: null, logoLight: '', logoDark: '' };
let html = '';
try { html = render(EMPTY); }
catch (e) {
  console.error(`✗ the site-theme cards threw on an unconfigured theme: ${e?.message || e}`);
  cleanup(); process.exit(1);
}

// One angle slider and one live swatch per gradient — counted, because one gradient rendering
// twice and another not at all still contains the markup.
const ranges = (html.match(/type="range"/g) || []).length;
must(ranges === GRADIENTS.length, `expected ${GRADIENTS.length} angle sliders, found ${ranges}`);
for (const g of GRADIENTS) {
  must(html.includes(g.name), `${g.name} is not named in the editor, so nobody can tell which gradient they are editing`);
  must(html.includes(gradientCss(defaultSpec(g.name)).replace(/&/g, '&amp;')),
    `${g.name}'s swatch does not paint its own gradient`);
}
// Both logo slots, and the bundled mark standing in for an unset one.
must((html.match(/type="file"/g) || []).length >= 2, 'the two site-mark upload slots did not both render');
must(html.includes('/logo.png'), 'an unset site mark does not fall back to the bundled one');

// A fully configured theme must render too — the branch where every bag is populated is the
// one the empty case never exercises.
try {
  render({ ...EMPTY, logoLight: '/a.png', logoDark: '/b.png',
    gradients: { '--grad-text': { angle: 33, stops: [{ color: 'var(--primary)' }, { color: '#123456', at: 40 }, { color: 'var(--bg)' }] } } });
} catch (e) { problems.push(`a fully configured theme threw: ${e?.message || e}`); }

cleanup();

if (problems.length) {
  console.error('✗ the site theme is not consistent:');
  for (const p of problems) console.error(`    ${p}`);
  process.exit(1);
}
console.log(`✓ site theme OK — ${GRADIENTS.length} gradient(s) match their CSS fallback, ${TOKENS.length} token(s) agree with the API, both cards render`);
