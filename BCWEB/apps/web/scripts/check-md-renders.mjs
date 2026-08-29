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

const SRC = 'src/markdown/index.jsx';
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
  // The two INJECTED blocks get stubs. Without them `<Markdown>` renders its honest
  // placeholder — "no roadmap component was provided" — which quotes `:::roadmap` back and
  // reads to this check exactly like a directive the parser never recognised. Passing stubs
  // exercises the path the site actually takes.
  writeFileSync(entry, [
    "import { renderToStaticMarkup } from 'react-dom/server';",
    "import Markdown from '../src/markdown/index.jsx';",
    'const Stub = () => <div className="stub" />;',
    'export const render = (md) => renderToStaticMarkup(',
    '  <Markdown roadmap={Stub} replay={Stub}>{md}</Markdown>);',
  ].join('\n'));
  await esbuild.build({
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
