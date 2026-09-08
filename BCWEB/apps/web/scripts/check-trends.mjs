#!/usr/bin/env node
// The Trends charts are RENDERED, and the SVG they produce is read.
//
// Same reason as check-studio.mjs: this lives behind /admin, behind 2FA, behind the
// manage_analytics capability. The tests do not mount it, the browser harness cannot (the dev
// server hands admin components a different i18n module instance than a test provider), and
// the first person to find it broken is whoever opened the dashboard to find out why traffic
// collapsed — which is the worst possible moment for a chart to be blank.
//
// trend.test.mjs already covers the maths. What it cannot cover is the step from numbers to
// geometry, and that step has exactly one interesting failure: **NaN in a path**. `M NaN 12`
// is not an error in SVG. The browser silently drops the path, so the chart renders — axes,
// grid, legend, tooltip, all of it — with no line in it. Nothing logs, nothing throws, and it
// looks like "no data" rather than a bug. A null baseline, an empty series, a single point,
// or a series shorter than its own baseline window all reach that code.
import { existsSync, statSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Resolve `@bettercommunity/bmd…` to the package sources, the way vite.config.js does.
 *
 * A plugin rather than esbuild's `alias`, which the sibling checks use: alias matches on a
 * path PREFIX, so aliasing `@bettercommunity/bmd` to `…/src/index.jsx` turns a real import of
 * `@bettercommunity/bmd/icons` into `…/src/index.jsx/icons` and the build dies complaining it
 * cannot read a directory. Those checks get away with it because they pull in one or two
 * subpaths; admin.jsx reaches most of the kit.
 */
const bmdSources = {
  name: 'bmd-sources',
  setup(build) {
    build.onResolve({ filter: /^@bettercommunity\/bmd(-editor)?(\/|$)/ }, (args) => {
      const m = /^@bettercommunity\/(bmd-editor|bmd)(?:\/(.*))?$/.exec(args.path);
      if (!m) return null;
      const dir = join(process.cwd(), '../../packages', m[1], 'src');
      for (const ext of ['', '.jsx', '.js']) {
        const p = join(dir, (m[2] || 'index') + ext);
        if (existsSync(p) && statSync(p).isFile()) return { path: p };
      }
      return null;
    });
    // Vite's `?raw` — a file imported as a string. esbuild has no idea what it means, and
    // admin.jsx reaches code that uses it (kit-pack pulls the kit's own README and .d.ts in
    // as text). Without this the build dies trying to PARSE a README as JavaScript.
    build.onResolve({ filter: /\?raw$/ }, (args) => ({
      path: join(args.resolveDir, args.path.replace(/\?raw$/, '')), namespace: 'raw-text',
    }));
    build.onLoad({ filter: /.*/, namespace: 'raw-text' }, (args) => ({
      contents: existsSync(args.path) ? readFileSync(args.path, 'utf8') : '', loader: 'text',
    }));
  },
};

const REL = 'src/pages/admin.jsx';
const MATHS = 'src/lib/trend.js';
for (const f of [REL, MATHS]) {
  if (!existsSync(f)) { console.error(`✗ ${f} is missing — refusing to report success`); process.exit(2); }
}

const entry = join(process.cwd(), 'node_modules', '.trends-entry.jsx');
const bundle = join(process.cwd(), 'node_modules', '.trends-bundle.mjs');
const cleanup = () => { for (const f of [entry, bundle]) { try { rmSync(f, { force: true }); } catch { /* gone already */ } } };

try {
  const esbuild = await import('esbuild');
  writeFileSync(entry, [
    "import { renderToStaticMarkup } from 'react-dom/server';",
    "import { I18nProvider } from '../src/i18n.jsx';",
    "import { BaselineChart, DistanceChart } from '../src/pages/admin.jsx';",
    "export { analyseTrend } from '../src/lib/trend.js';",
    'export const render = (a) => renderToStaticMarkup(',
    '  <I18nProvider><BaselineChart a={a} unit="Views" /><DistanceChart a={a} /></I18nProvider>);',
  ].join('\n'));
  await esbuild.build({
    nodePaths: [join(process.cwd(), 'node_modules')],
    entryPoints: [entry], outfile: bundle, bundle: true, format: 'esm', platform: 'node',
    jsx: 'automatic', logLevel: 'silent', loader: { '.css': 'empty' },
    // Only React stays external, so the components and renderToStaticMarkup share one copy of
    // it. NOT `packages: 'external'` (what the sibling checks use): admin.jsx reaches a deep
    // CJS import — prismjs/components/prism-json — that a bundler resolves and node's ESM
    // loader refuses, so leaving every package to node means the bundle builds and then will
    // not load.
    external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime'],
    // Bundled CJS dependencies call `require`, which an ESM bundle does not have. Hand them
    // node's own, rather than shipping a CJS build that could not import react-dom/server.
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    plugins: [bmdSources],
  });
} catch (e) {
  console.error(`✗ could not build the Trends charts for node: ${e?.message || e}`);
  cleanup(); process.exit(2);
}

let render, analyseTrend;
try { ({ render, analyseTrend } = await import(pathToFileURL(bundle).href)); }
catch (e) { console.error(`✗ the Trends charts would not load: ${e?.message || e}`); cleanup(); process.exit(1); }

const problems = [];
const must = (cond, why) => { if (!cond) problems.push(why); };

const rows = (values) => values.map((v, i) => ({
  day: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), views: v, visitors: Math.round(v / 3),
}));
const draw = (values, opts) => {
  try { return render(analyseTrend(rows(values), opts)); }
  catch (e) { problems.push(`the charts threw on a ${values.length}-day series: ${e?.message || e}`); return ''; }
};

// A realistic year: a busy site, a real ten-day collapse, and one viral spike.
const year = Array.from({ length: 200 }, (_, i) => 800 + Math.round(Math.sin(i / 3) * 90));
for (let i = 120; i < 130; i++) year[i] = 90;
year[60] = 14000;

const html = draw(year, { baselineWindow: 30, sensitivity: 'medium' });
must(/<svg/.test(html), 'the Trends charts rendered no SVG at all');
must(/stroke-dasharray="4 3"/.test(html), 'the baseline is not drawn dashed — nothing distinguishes it from the metric line');
must(/var\(--error\)/.test(html), 'the collapse in this series produced no flagged-drop marker');
// A legend is required for two series, and it must not be colour-only.
must(/baseline/i.test(html) && /Above normal|normal/i.test(html), 'the charts lost their legend, so the two lines are told apart by colour alone');
// A flagged drop must be findable without seeing colour: the badge carries the number, and
// the metric line's own hue is whatever the site theme sets — it could BE red.
must(/▼/.test(html), 'the flagged drops lost their labelled badge, leaving hue as the only marker');
// This series contains a 20x day. Its smoothed plateau must not own the y-axis: the chart is
// there to show the ordinary range, and an axis set by the spike squashes the year into a
// smear along the bottom. Shipped that way once — the "cap" landed 1% under the plain max.
must(/Scale capped|plafonn/.test(html), 'a 20x spike no longer trips the capped-axis notice, so it is setting the y-axis again');

// ── The failure this file exists for. ────────────────────────────────────────────────
// Checked on EVERY shape, not just the happy one: a null baseline is normal for the first
// `baselineWindow` points of every chart the dashboard will ever draw.
const shapes = [
  ['a full year', year, { baselineWindow: 30 }],
  ['an empty site', [], {}],
  ['one single day', [42], {}],
  ['fewer days than the baseline window', [10, 20, 30, 40, 50], { baselineWindow: 30 }],
  ['a site that has never had a visitor', new Array(90).fill(0), { baselineWindow: 30 }],
  ['a site that went dark and stayed dark', [...new Array(60).fill(500), ...new Array(40).fill(0)], { baselineWindow: 30 }],
  ['a 7-day window on 8 days', [1, 2, 3, 4, 5, 6, 7, 8], { baselineWindow: 7 }],
];
for (const [name, values, opts] of shapes) {
  const out = draw(values, opts);
  must(!/NaN|Infinity|undefined/.test(out),
    `${name}: the SVG contains NaN/Infinity/undefined — the browser drops such a path silently, so the chart renders complete and empty`);
  must(out.length > 0, `${name}: rendered nothing at all`);
}

// An empty site must say so rather than draw an axis over nothing.
must(/No traffic recorded|Aucun trafic/.test(draw([], {})), 'an empty site draws a chart instead of saying there is no data');
// Too little history is a different message from no data — one is "wait", the other is "none".
must(/Not enough history|assez d.historique/.test(draw([10, 20, 30], { baselineWindow: 30 })),
  'a series shorter than its baseline window does not say so — it would draw an empty distance chart that looks like "nothing unusual"');

cleanup();

// The maths module has to stay importable from plain node (no JSX, no React), or the unit
// tests that cover it silently stop being able to run.
const maths = readFileSync(MATHS, 'utf8');
must(!/^import /m.test(maths), 'src/lib/trend.js grew an import — it is kept dependency-free so node --test can load it');

if (problems.length) {
  console.error('✗ the Trends charts are not safe to ship:');
  for (const p of problems) console.error(`    ${p}`);
  process.exit(1);
}
console.log(`✓ Trends OK — both charts rendered through the real components over ${shapes.length} data shapes (empty, one point, all-zero, gone dark, baseline not yet warm), no NaN in any path, baseline dashed, collapse flagged, legend present`);
