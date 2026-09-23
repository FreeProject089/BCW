#!/usr/bin/env node
// Non-regression harness for studio documents v1 -> v2 (PLAN-STUDIO-2026, 2.3 and phase 3).
//
// READ-ONLY. Renders every studio page it is given twice, through the renderer as it was
// before phase 3 (taken from git, `--ref`, default the phase 2 commit) and through the current
// one, and compares the markup. Not in the lint chain: it needs git history and, for the real
// pages, a dump of the database. Run from apps/web:
//
//   node scripts/studio-v2-harness.mjs [--ref 4429aaf4] [--docs dump.json]
//
// `--docs` is a JSON array of `{ src, c }` (a canvas and where it was found); the fixtures in
// test/fixtures/studio-v1-docs.json are always included. Three renderings per page: the
// desktop plane (light), the same in the dark theme, and the stacked phone column.
//
// Two changes are INTENDED and taken out before comparing, so that what is left is a real
// difference: the frame's plane now carries `data-cv-frame` and clips to the frame
// (`overflow: clip; contain: layout paint`). Everything else must be byte-identical, or it is
// printed with the first place the two differ.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
const REF = arg('--ref', '4429aaf4');
const DOCS = arg('--docs', '');
const cwd = process.cwd();
if (!existsSync('src/ui/canvas-view.jsx')) { console.error('run from apps/web'); process.exit(2); }

const dir = join(cwd, 'node_modules', '.studio-harness');
rmSync(dir, { recursive: true, force: true });
mkdirSync(join(dir, 'v1', 'ui'), { recursive: true });
mkdirSync(join(dir, 'v1', 'lib'), { recursive: true });
const show = (p) => execFileSync('git', ['show', `${REF}:BCWEB/apps/web/${p}`], { encoding: 'utf8', maxBuffer: 1 << 26 });
writeFileSync(join(dir, 'v1', 'ui', 'canvas-view.jsx'), show('src/ui/canvas-view.jsx'));
writeFileSync(join(dir, 'v1', 'lib', 'canvas.js'), show('src/lib/canvas.js'));

const entry = join(dir, 'entry.jsx');
writeFileSync(entry, [
  "import { renderToStaticMarkup } from 'react-dom/server';",
  `import { I18nProvider } from ${JSON.stringify(join(cwd, 'src/i18n.jsx').replace(/\\/g, '/'))};`,
  `import V1 from ${JSON.stringify(join(dir, 'v1/ui/canvas-view.jsx').replace(/\\/g, '/'))};`,
  `import V2 from ${JSON.stringify(join(cwd, 'src/ui/canvas-view.jsx').replace(/\\/g, '/'))};`,
  'const r = (C, c, o) => renderToStaticMarkup(<I18nProvider><C canvas={c} {...o} /></I18nProvider>);',
  'export const render = (which, c, o = {}) => r(which === 1 ? V1 : V2, c, o);',
].join('\n'));

// The old view's relative imports resolve to the CURRENT files next to the real canvas-view,
// except its own lib/canvas.js, which is the old one written above.
const srcUi = join(cwd, 'src', 'ui');
const plugin = {
  name: 'v1-paths',
  setup(build) {
    build.onResolve({ filter: /^\.\.?\// }, (a) => {
      if (!a.importer.includes(`${join('.studio-harness', 'v1')}`)) return undefined;
      if (/canvas\.js$/.test(a.path) && a.importer.endsWith('canvas-view.jsx')) return { path: join(dir, 'v1', 'lib', 'canvas.js') };
      if (a.importer.endsWith(join('v1', 'ui', 'canvas-view.jsx'))) return { path: resolve(srcUi, a.path) };
      return undefined;
    });
  },
};
const bundle = join(dir, 'bundle.mjs');
const esbuild = await import('esbuild');
await esbuild.build({
  nodePaths: [join(cwd, 'node_modules')], entryPoints: [entry], outfile: bundle, bundle: true, format: 'esm',
  platform: 'node', jsx: 'automatic', logLevel: 'silent', packages: 'external', loader: { '.css': 'empty' },
  plugins: [plugin],
  alias: {
    '@bettercommunity/bmd': join(cwd, '../../packages/bmd/src/index.jsx'),
    '@bettercommunity/bmd/config': join(cwd, '../../packages/bmd/src/config.js'),
    '@bettercommunity/bmd/links': join(cwd, '../../packages/bmd/src/links.js'),
    '@bettercommunity/bmd/ast': join(cwd, '../../packages/bmd/src/ast.js'),
    '@bettercommunity/bmd/export': join(cwd, '../../packages/bmd/src/export.jsx'),
    '@bettercommunity/bmd/editor-blocks': join(cwd, '../../packages/bmd/src/editor-blocks.js'),
  },
});
const { render } = await import(pathToFileURL(bundle).href);

const docs = [];
for (const f of JSON.parse(readFileSync('test/fixtures/studio-v1-docs.json', 'utf8'))) docs.push({ src: `fixture: ${f.name}`, c: f.doc });
if (DOCS) for (const d of JSON.parse(readFileSync(DOCS, 'utf8'))) docs.push(d);

// The intended changes, taken out of the NEW markup.
const intended = (html) => html
  .replace(/ data-cv-frame="(?:desktop|phone)"/g, '')
  .replace(/;overflow:clip;contain:layout paint/g, '');
const firstDiff = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i; };

let same = 0; const diffs = [];
for (const { src, c } of docs) {
  for (const [label, opts] of [['desktop light', { themePreview: 'light' }], ['desktop dark', { themePreview: 'dark' }], ['phone stack', { stackPreview: true }]]) {
    let a = ''; let b = '';
    try { a = render(1, c, opts); } catch (e) { a = `THREW ${e?.message}`; }
    try { b = intended(render(2, c, opts)); } catch (e) { b = `THREW ${e?.message}`; }
    if (a === b) { same += 1; continue; }
    const i = firstDiff(a, b);
    diffs.push({ src, label, v1: a.slice(Math.max(0, i - 80), i + 120), v2: b.slice(Math.max(0, i - 80), i + 120) });
  }
}
rmSync(dir, { recursive: true, force: true });
console.log(`${docs.length} page(s), ${docs.length * 3} rendering(s): ${same} identical, ${diffs.length} different (ref ${REF}).`);
for (const d of diffs) console.log(`\n✗ ${d.src} · ${d.label}\n  v1: …${d.v1}…\n  v2: …${d.v2}…`);
process.exit(diffs.length ? 1 : 0);
