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

cleanup();

if (problems.length) {
  console.error('✗ directives that do not render:');
  for (const p of problems) console.error(`    ${p}`);
  console.error('\n  Being documented is not being rendered. `:time` was named in five documents and');
  console.error('  three checks while producing a gap in the middle of a sentence.');
  process.exit(1);
}
console.log(`✓ every directive renders — ${checked} of them, through the real component`);
