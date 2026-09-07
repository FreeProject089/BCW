#!/usr/bin/env node
// The visual block canvas is RENDERED, not just imported.
//
// Written after three identifiers — `parseDirectiveHead`, `setDirectiveHead` and `pickIcon` —
// were used inside BmdBlockCanvas's per-block field row while none of them was imported or
// declared. Free identifiers, so the row threw ReferenceError; and the row runs for every
// block, so the visual editor died on any document at all.
//
// Nothing caught it, and the reasons are worth writing down:
//   · eslint runs `eslint src` from apps/web and never reaches packages/, where the component
//     lives, so no-undef never looked at the file.
//   · the tests that cover that row call parseDirectiveHead/setDirectiveHead directly. They
//     are pure functions and they were correct. The component that calls them appeared in no
//     test, so "the round trip is proven" was true and meaningless.
//   · vite builds it fine: an undeclared identifier is valid JavaScript until it runs.
//
// So this mounts the real component through react-dom/server — the same esbuild path
// check-md-renders.mjs uses — and asserts the field row exists with its controls. Any
// undeclared name in the render path is now a build failure here rather than a white screen
// for whoever opens the editor.
import { existsSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SRC = '../../packages/bmd-editor/src/block-canvas.jsx';
if (!existsSync(SRC)) { console.error(`✗ ${SRC} is missing — refusing to report success`); process.exit(2); }

const entry = join(process.cwd(), 'node_modules', '.canvas-entry.jsx');
const bundle = join(process.cwd(), 'node_modules', '.canvas-bundle.mjs');
const cleanup = () => { for (const f of [entry, bundle]) { try { rmSync(f, { force: true }); } catch { /* gone already */ } } };

try {
  const esbuild = await import('esbuild');
  writeFileSync(entry, [
    "import { renderToStaticMarkup } from 'react-dom/server';",
    "import BmdBlockCanvas from '../../../packages/bmd-editor/src/block-canvas.jsx';",
    // `pickIcon` is passed exactly as the app passes it, because the app passing a prop the
    // component never read is the whole bug this file exists for.
    'export const render = (value, props = {}) => renderToStaticMarkup(',
    '  <BmdBlockCanvas value={value} onChange={() => {}} pickIcon={async () => "star"} {...props} />);',
  ].join('\n'));
  await esbuild.build({
    nodePaths: [join(process.cwd(), 'node_modules')],
    entryPoints: [entry], outfile: bundle, bundle: true, format: 'esm', platform: 'node',
    jsx: 'automatic', logLevel: 'silent', packages: 'external',
    // `packages: 'external'` leaves react-dom to node — which is what we want — but it would
    // leave the workspace package to node too, and there is no link for node to follow. It is
    // the same mapping vite.config.js declares for the app; pointed at the SOURCE, so this
    // check reads the file being edited and not a stale build.
    alias: { '@bettercommunity/bmd/editor-blocks': join(process.cwd(), '../../packages/bmd/src/editor-blocks.js') },
    loader: { '.css': 'empty' },
  });
} catch (e) {
  console.error(`✗ could not build the block canvas for node: ${e?.message || e}`);
  cleanup();
  process.exit(2);
}

let render;
try {
  ({ render } = await import(pathToFileURL(bundle).href));
} catch (e) {
  // A module-level throw lands here, not in the render try/catch below, and leaving the
  // temp files behind makes the next run report a stale bundle's result.
  console.error(`✗ the block canvas module would not load: ${e?.message || e}`);
  cleanup();
  process.exit(1);
}

const problems = [];
const must = (cond, why) => { if (!cond) problems.push(why); };

// A document with a directive block and a plain one. The field row only appears on the
// directive, and the plain block must survive beside it.
const DOC = ':::tip[Careful]{icon=star}\nMind the gap.\n:::\n\nJust a paragraph.\n';
let html = '';
try {
  html = render(DOC);
} catch (e) {
  console.error(`✗ the block canvas threw while rendering: ${e?.message || e}`);
  console.error('  This is the failure mode the file was written for: a name used in the');
  console.error('  render path that is never imported or declared.');
  cleanup();
  process.exit(1);
}

must(html.includes('bmdc-body'), 'no block was drawn at all');
must(html.includes('bmdc-fields'), 'the directive block has no field row');
must(html.includes('value="Careful"') || html.includes('Careful'), 'the directive label never reached its input');
// The two controls this row is supposed to offer. Counted, because one select rendering
// twice and the other not at all still contains the class name.
const selects = (html.match(/bmdc-field-sel/g) || []).length;
must(selects === 2, `expected 2 style/space selects, found ${selects}`);
must(html.includes('Style B'), 'the second style is not offered');
must(/Space|Espace/.test(html), 'the spacing control is not offered');
must(html.includes('bmdc-field-btn'), 'the icon button did not render, so pickIcon never reached the component');

// An empty document must still render its empty state rather than throwing.
try { must(render('').length > 0, 'an empty document rendered nothing'); }
catch (e) { problems.push(`an empty document threw: ${e?.message || e}`); }

cleanup();

if (problems.length) {
  console.error('✗ the block canvas did not render as it must:');
  for (const p of problems) console.error(`    ${p}`);
  process.exit(1);
}
console.log(`✓ block canvas OK — rendered through the real component, field row with ${selects} control(s)`);
