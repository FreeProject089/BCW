#!/usr/bin/env node
// Every directive is put in, and something has to come out.
//
// This exists because `:time[2026-09-01T20:00]{tz=Europe/Paris}` rendered NOTHING for as long
// as it existed. Not a wrong time — no element, no fallback, no console line: a gap in the
// middle of a sentence. It was documented in five places, named by three checks, and shipped
// inside the downloadable kit. Every one of those checks confirmed the directive was
// DOCUMENTED; not one of them rendered it.
//
// So this renders it. `renderToStaticMarkup` through the real pipeline — the same
// index.jsx the site imports, transformed by the esbuild that vite already carries, so there
// is no second copy of the renderer to keep in step and no browser to drive.
//
// The assertion is deliberately weak and therefore honest: each directive must produce markup
// that is not simply its own source text back. Checking WHAT each one draws would be this
// file re-implementing the renderer, and it would agree with the renderer by construction.
// "It produced something" is exactly the claim that was false.
import { readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// The PARSER, which is where the directive names live. index.jsx is the assembly and
// names none of them — a gate pointed at it reads zero and says so.
const SRC = '../../packages/bmd/src/directives.js';
if (!existsSync(SRC)) { console.error(`✗ ${SRC} is missing — refusing to report success`); process.exit(2); }

// Every name the renderer answers to, read from it rather than listed here: a directive added
// without a line in this file would otherwise never be rendered by it.
const src = readFileSync(SRC, 'utf8');
const names = new Set([...src.matchAll(/name === '([a-z0-9-]+)'/g)].map((m) => m[1]));
const callouts = src.match(/^const CALLOUTS = \{([\s\S]*?)^\};/m);
if (callouts) for (const m of callouts[1].matchAll(/([a-z0-9-]+):/g)) names.add(m[1]);
if (names.size < 30) {
  console.error(`✗ read ${names.size} directive(s) — the extractor is stale, so this check cannot be trusted`);
  process.exit(2);
}

// How each one is WRITTEN. A container needs a body, a text directive needs its brackets, and
// several only make sense inside a parent — `:::step` outside `:::steps` is a different test.
// Anything not named here gets the plain container form.
const FORM = {
  badge: 'x :badge[NEW]{color="#0a7"}', tag: 'x :tag[OLD]', icon: 'x :icon[rocket]',
  kbd: 'x :kbd[Ctrl+K]', button: 'x :button[Go]{href=/x}', btn: 'x :btn[Go]{href=/x}',
  link: 'x :link[Go]{href=/x color=#0a7}', file: 'x :file[r.pdf]{href=/x size="1 MB"}',
  time: 'x :time[2026-09-01T20:00]{tz=Europe/Paris}', at: 'x :at[2026-09-01T20:00]{tz=Europe/Paris}',
  toc: '## A heading\n\n::toc[On this page]',
  card: ':::card[C]{icon=rocket}\nx\n:::', ref: ':::ref[C]{href=/x}\nx\n:::',
  cards: ':::cards\n:::card[C]\nx\n:::\n:::',
  columns: ':::columns\n:::column\nL\n:::\n:::', column: ':::columns\n:::column\nL\n:::\n:::',
  row: ':::row\n:::col\nL\n:::\n:::', col: ':::row\n:::col\nL\n:::\n:::',
  steps: ':::steps\n:::step[One]\nx\n:::\n:::', step: ':::steps\n:::step[One]\nx\n:::\n:::',
  tabs: ':::tabs\n:::tab{title="W"}\nx\n:::\n:::', tab: ':::tabs\n:::tab{title="W"}\nx\n:::\n:::',
  roadmap: ':::roadmap[R]\n:::stage[Done]{state=done}\n- a\n:::\n:::',
  progress: ':::progress[R]\n:::stage[Done]{state=done}\n- a\n:::\n:::',
  stage: ':::roadmap[R]\n:::stage[Done]{state=done}\n- a\n:::\n:::',
  phase: ':::roadmap[R]\n:::phase[Done]{state=done}\n- a\n:::\n:::',
  replay: ':::replay[T]{src=/x.bmmreplay}\n:::', bmmreplay: ':::bmmreplay[T]{src=/x.bmmreplay}\n:::',
  schedule: ':::schedule[S]{tz=Europe/Paris}\n| a | b |\n|---|---|\n| c | d |\n:::',
  hours: ':::hours[S]{tz=Europe/Paris}\n| a | b |\n|---|---|\n| c | d |\n:::',
  callout: ':::callout[T]{icon=rocket}\nx\n:::',
  meter: 'x :meter[60]{label=Done}',
  event: ':::timeline\n:::event[E]{date=2026-09-01 state=done}\nx\n:::\n:::', moment: ':::timeline\n:::moment[E]{date=2026-09-01}\nx\n:::\n:::',
  before: ':::compare\n:::before\na\n:::\n:::after\nb\n:::\n:::', after: ':::compare\n:::before\na\n:::\n:::after\nb\n:::\n:::',
  stat: ':::stats\n:::stat[Users]{value=12 delta=+3%}\n:::\n:::', kpi: ':::stats\n:::kpi[Users]{value=12}\n:::\n:::',
  version: ':::changelog\n:::version[1.0.0]{date=2026-09-01}\n- [NEW] x\n:::\n:::', release: ':::changelog\n:::release[1.0.0]\nx\n:::\n:::',
  q: ':::faq\n:::q[Why?]\nx\n:::\n:::', question: ':::faq\n:::question[Why?]{open}\nx\n:::\n:::',
  checklist: ':::checklist[Launch]\n- [x] a\n- [ ] b\n:::',
  // 3.0
  table: ':::table[Cap]{style="striped bordered"}\n| a | b |\n|---|---|\n| c | d |\n:::',
  audio: 'x :audio[Ep]{src=/a.mp3}', spotify: '::spotify{src=https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC}',
  youtube: '::youtube{src=https://youtu.be/dQw4w9WgXcQ}', yt: '::yt{id=dQw4w9WgXcQ}',
  img: 'x :img[Alt]{src=/a.png width=120}', image: '::image{src=/a.png caption="c"}',
  api: ':::api[GET /api/x]{auth=key summary="s"}\nx\n:::', endpoint: ':::endpoint[POST /api/y]\nx\n:::',
  request: ':::api[POST /api/y]\n:::request\nx\n:::\n:::', response: ':::api[GET /api/y]\n:::response{status=200}\nx\n:::\n:::', params: ':::api[GET /api/y]\n:::params\n| a | b |\n|---|---|\n| c | d |\n:::\n:::',
  openapi: '::openapi{src=/api/openapi.json}', swagger: '::swagger{src=/api/openapi.json}',
  counter: 'x :counter[Downloads]{src=/api/stats.json path=n}', fetch: 'x :fetch[Status]{src=/api/s.json path=m}', live: '::live{src=/api/s.json path=m}',
  action: 'x :action[Vote]{href=/api/vote}', include: '::include{src=/docs/x.md}', 'embed-md': '::embed-md{src=/docs/x.md}',
  mermaid: ':::mermaid[Flow]\n```\ngraph TD; A-->B\n```\n:::', diagram: ':::diagram\n```\ngraph TD; A-->B\n```\n:::',
};
const formOf = (n) => FORM[n] || `:::${n}[T]\nx\n:::`;

// ── build the renderer for node ──
//
// The entry has to live INSIDE the project. Written to a temp directory, esbuild resolves
// `react-dom/server` from THERE and finds nothing — a build failure that looks like a broken
// check rather than a missing dependency.
const entry = join(process.cwd(), 'node_modules', '.md-render-entry.jsx');
const bundle = join(process.cwd(), 'node_modules', '.md-render-bundle.mjs');
const cleanup = () => { for (const f of [entry, bundle]) { try { rmSync(f, { force: true }); } catch { /* gone already */ } } };
try {
  const esbuild = await import('esbuild');
  // No stubs any more. `:::roadmap` and `:::replay` used to need a component passed in, so
  // this had to supply two — which meant the check exercised a path with two fakes in it. The
  // kit draws both itself now, and rendering with no props is what a reader of the README
  // actually gets.
  writeFileSync(entry, [
    "import { renderToStaticMarkup } from 'react-dom/server';",
    "import Markdown from '../../../packages/bmd/src/index.jsx';",
    'export const render = (md) => renderToStaticMarkup(<Markdown>{md}</Markdown>);',
  ].join('\n'));
  await esbuild.build({
    // The kit sits in packages/bmd, outside this app: its bare imports resolve from here.
    nodePaths: [join(process.cwd(), 'node_modules')],
    entryPoints: [entry], outfile: bundle, bundle: true, format: 'esm', platform: 'node',
    jsx: 'automatic', logLevel: 'silent',
    // Only OUR files are bundled; every package stays external and node resolves it at
    // runtime. Inlining them pulls react-dom's CJS build in, and its `require('stream')`
    // cannot survive being rewritten into an ES module.
    packages: 'external',
    // The stylesheet the renderer imports says nothing about markup and node cannot parse it.
    loader: { '.css': 'empty' },
  });
} catch (e) {
  console.error(`✗ could not build the renderer for node: ${e?.message || e}`);
  console.error('  This check renders the REAL component; a build failure is not something to');
  console.error('  skip past, because skipping it is how the bug it exists for shipped.');
  cleanup();
  process.exit(2);
}

const { render } = await import(pathToFileURL(bundle).href);

const problems = [];
let checked = 0;
for (const name of [...names].sort()) {
  const md = formOf(name);
  let html;
  try { html = render(md); } catch (e) { problems.push(`:${name} threw while rendering — ${e?.message || e}`); continue; }
  checked++;
  const text = html.replace(/<[^>]*>/g, ' ');
  // The two ways a directive fails silently: it produces nothing at all, or it produces its
  // own source back as literal text.
  if (!/<[a-z]/i.test(html)) problems.push(`:${name} rendered no elements at all`);
  else if (new RegExp(`:{1,3}${name}\\b`).test(text)) problems.push(`:${name} came back as literal text — the parser did not recognise it`);
  else if (FORM[name]?.startsWith('x :') && !/<(time|span|a|img|kbd|svg|doc-)/i.test(html)) {
    // An inline leaf that produced only its paragraph is the `:time` shape exactly: the
    // sentence renders, the directive inside it does not.
    problems.push(`:${name} produced a paragraph and nothing inside it`);
  }
}

// ── step marker shapes ───────────────────────────────────────────────────────────────
//
// `shape=` becomes a class name, so it is an allowlist. The failure it guards is quiet in both
// directions: an unknown value emitting a class nobody styles renders as a plain square
// (indistinguishable from "the feature is broken"), and a block-level shape that fails to
// reach its children means `:::steps{shape=…}` silently does nothing at all.
const NL = String.fromCharCode(10);
const stepsDoc = (blockAttrs, stepAttrs = '') =>
  ['::::steps' + blockAttrs, ':::step[One]' + stepAttrs, 'Body.', ':::', '::::', ''].join(NL);
const shapeHtml = (md) => {
  try { return render(md); } catch (e) { problems.push(`step shapes: ${e?.message || e}`); return ''; }
};

for (const sh of ['square', 'rounded', 'diamond', 'triangle', 'hexagon', 'none']) {
  const html = shapeHtml(stepsDoc(`{shape=${sh}}`));
  if (!html.includes(`doc-steps-sh-${sh}`)) problems.push(`shape=${sh} did not reach the steps block`);
  if (!html.includes(`doc-step-sh-${sh}`)) problems.push(`shape=${sh} did not reach the step inside it`);
}
// The default draws no class, so the base rule stays the only place a circle is defined.
if (/doc-steps?-sh-/.test(shapeHtml(stepsDoc('')))) problems.push('an unshaped steps block emitted a shape class');
if (/doc-steps?-sh-/.test(shapeHtml(stepsDoc('{shape=circle}')))) problems.push('shape=circle emitted a class; the default must emit none');
// Anything unknown is dropped rather than concatenated into a class name.
for (const bad of ['evil', 'doc-step-done', 'sh-square']) {
  if (/doc-steps?-sh-/.test(shapeHtml(stepsDoc(`{shape=${bad}}`)))) problems.push(`shape=${bad} emitted a shape class`);
}
// A single step overrides its block — otherwise `shape=` on a step does nothing, silently.
if (!shapeHtml(stepsDoc('{shape=square}', '{shape=triangle}')).includes('doc-step-sh-triangle')) {
  problems.push('a step could not override the shape its block set');
}

// ── inline icons with a family prefix ───────────────────────────────────────────────
//
// G5. Inside `:icon[ph:rocket]` the parser reads `:rocket` as a text directive of its own, so
// the name the renderer received was `ph` and it drew a lucide mask called "ph". Every prefixed
// family written inline came out that way (`ph:`, `simple:`, `app:`, and the isometric `iso:`),
// while `:icon[rocket]` above kept passing. Each case names what it must draw.
for (const [md, must, mustNot] of [
  ['x :icon[ph:rocket] y', 'regular/rocket.svg', '/icons/ph.svg'],
  ['x :icon[ph-bold:rocket] y', 'bold/rocket-bold.svg', '/icons/ph-bold.svg'],
  ['x :icon[simple:discord] y', '<svg', '/icons/simple.svg'],
  ['x :icon[app:bmm] y', '/icons/bmm.png', 'lucide-hash'],
  ['x :icon[iso:server] y', '/iso/server.svg', '/icons/iso.svg'],
  ['x :icon[iso:truck-2] y', '/iso/truck-2.svg', '/icons/iso.svg'],
  ['x :icon[isometric:solid-chart-2] y', '/iso/solid-chart-2.svg', '/icons/isometric.svg'],
  ['x :icon[iso:not-an-icon] y', 'lucide-hash', '<img'],   // outside the closed list: the neutral glyph
]) {
  const html = shapeHtml(md);
  if (!html.includes(must)) problems.push(`${md}: expected ${must} in ${html.replace(/\s+/g, ' ').slice(0, 160)}`);
  if (html.includes(mustNot)) problems.push(`${md}: drew ${mustNot}`);
}

// ── mermaid theme / look ─────────────────────────────────────────────────────────────
//
// These values are written into the diagram's own `%%{init}%%` front-matter, so a free string
// there is a config injection into the renderer rather than a style. They must also SURVIVE
// the sanitiser: a data attribute the sanitiser does not know is dropped between the parser
// and the component, which looks exactly like the attribute doing nothing.
const mmdDoc = (attrs) => [`:::mermaid${attrs}`, '```', 'graph TD; A-->B', '```', ':::', ''].join(NL);
for (const [attrs, wantTheme, wantLook] of [
  ['{theme=forest}', 'forest', ''],
  ['{theme=neutral look=handdrawn}', 'neutral', 'handdrawn'],
  ['{style=dark}', 'dark', ''],          // `style=` is the same knob under a friendlier name
  ['', 'auto', ''],                      // unset means "follow the page"
  ['{theme=nonsense}', 'auto', ''],      // and so does anything unknown
  ['{theme=dark-evil}', 'auto', ''],     // …including one that merely looks close
  ['{look=handDrawn}', 'auto', 'handdrawn'],  // casing and camelCase both land
  ['{look=classic}', 'auto', ''],        // the default look emits nothing
]) {
  const html = shapeHtml(mmdDoc(attrs));
  const gotTheme = /data-theme="([^"]*)"/.exec(html)?.[1] ?? '';
  const gotLook = /data-look="([^"]*)"/.exec(html)?.[1] ?? '';
  if (gotTheme !== wantTheme) problems.push(`mermaid ${attrs || '(none)'}: data-theme is ${JSON.stringify(gotTheme)}, expected ${JSON.stringify(wantTheme)}`);
  if (gotLook !== wantLook) problems.push(`mermaid ${attrs || '(none)'}: data-look is ${JSON.stringify(gotLook)}, expected ${JSON.stringify(wantLook)}`);
}

// An attribute whose value breaks the directive syntax makes the whole thing not a directive:
// remark-directive stops recognising it and the block comes back as literal text. That is the
// safe outcome — nothing is rendered, so nothing can carry an injected value — but it is worth
// pinning, because "my diagram turned into text" has a cause an author cannot otherwise see.
for (const bad of ['{theme="dark\\", look: \\"evil"}', '{look="classic\\", theme: \\"x"}']) {
  const html = shapeHtml(mmdDoc(bad));
  if (/data-theme="(?!auto)/.test(html)) problems.push(`mermaid ${bad}: a malformed attribute reached the figure`);
  if (/<figure[^>]*doc-mermaid/.test(html)) problems.push(`mermaid ${bad}: expected the block to stop being a directive, but a figure rendered`);
}

// ── `variant=` offered only where it does something ──────────────────────────────────
//
// The editor showed "Style A / Style B" on every block. Ten directives have a
// `.doc-*.doc-variant-b` rule; on all the others the control wrote an attribute and nothing
// moved — and a control that does nothing is worse than a missing one, because the writer
// concludes the feature is broken rather than absent.
//
// VARIANT_BLOCKS is what the editor gates on, and markdown.css is what makes it true, so the
// two are asserted against each other in BOTH directions: a rule added without the name means
// a look nobody can reach from the editor, and a name without a rule puts the dead control
// back.
{
  const { VARIANT_BLOCKS } = await import(pathToFileURL(join(process.cwd(), '../../packages/bmd/src/editor-blocks.js')).href);
  const css = readFileSync('../../packages/bmd/src/markdown.css', 'utf8');
  const styled = new Set([...css.matchAll(/\.doc-([a-z0-9-]+)\.doc-variant-b\b/g)].map((m) => m[1]));
  // A directive maps to the class its renderer emits: every callout kind draws `.doc-callout`,
  // and `setting` draws `.doc-field`. Anything not named here uses its own name.
  const CLASS_OF = {
    note: 'callout', tip: 'callout', info: 'callout', hint: 'callout', success: 'callout',
    check: 'callout', warning: 'callout', caution: 'callout', important: 'callout',
    danger: 'callout', error: 'callout', callout: 'callout', setting: 'field',
  };
  const must = (cond, why) => { if (!cond) problems.push(why); };
  must(styled.size > 0, 'no .doc-*.doc-variant-b rules found — this check would pass vacuously');
  for (const name of VARIANT_BLOCKS) {
    const cls = CLASS_OF[name] || name;
    must(styled.has(cls), `VARIANT_BLOCKS lists "${name}" but markdown.css has no .doc-${cls}.doc-variant-b — the editor would offer a style that does nothing`);
  }
  const named = new Set(VARIANT_BLOCKS.map((n) => CLASS_OF[n] || n));
  for (const cls of styled) {
    must(named.has(cls), `markdown.css styles .doc-${cls}.doc-variant-b but no directive in VARIANT_BLOCKS maps to it — the look exists and the editor cannot reach it`);
  }
}

cleanup();

if (problems.length) {
  console.error('✗ directives that do not render:');
  for (const p of problems) console.error(`    ${p}`);
  console.error('\n  Being documented is not being rendered. `:time` was named in five documents and');
  console.error('  three checks while producing a gap in the middle of a sentence.');
  process.exit(1);
}
console.log(`✓ every directive renders — ${checked} of them, through the real component`);
