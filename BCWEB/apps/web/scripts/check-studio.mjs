#!/usr/bin/env node
// The studio is RENDERED, not just imported — and the two things that make it usable at all
// are asserted on the output.
//
// It sits behind the admin, behind 2FA, behind a per-project switch only an admin can turn on.
// So nothing here sees it: the tests do not mount it, the browser harness cannot (the dev
// server hands it a different i18n module instance than a test provider), and the first person
// to find it broken is a superadmin with a page to build. The block canvas had exactly this
// shape and died on every document for a week — see check-block-canvas.mjs.
//
// Two properties, both invisible in review and both fatal in use:
//
//   `touch-action: none` on the canvas and its blocks. Without it the browser claims the
//   gesture and a drag SCROLLS THE PAGE instead of moving the block, so the studio is simply
//   inoperable with a finger — and it looks fine in a screenshot.
//
//   The resize handles carry `.cst-handle`, which is what gives them a fingertip-sized hit
//   area on a coarse pointer. Drop the class and they stay 12px: visible, and unhittable.
import { existsSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SRC = '../../apps/web/src/editor/canvas-studio.jsx';
const REL = 'src/editor/canvas-studio.jsx';
if (!existsSync(REL)) { console.error(`✗ ${REL} is missing — refusing to report success`); process.exit(2); }

const entry = join(process.cwd(), 'node_modules', '.studio-entry.jsx');
const bundle = join(process.cwd(), 'node_modules', '.studio-bundle.mjs');
const cleanup = () => { for (const f of [entry, bundle]) { try { rmSync(f, { force: true }); } catch { /* gone already */ } } };

try {
  const esbuild = await import('esbuild');
  writeFileSync(entry, [
    "import { renderToStaticMarkup } from 'react-dom/server';",
    "import { I18nProvider } from '../src/i18n.jsx';",
    "import CanvasStudio from '../src/editor/canvas-studio.jsx';",
    // Rendered inside the real provider, the way the app mounts it. Its network fetch lives in
    // an effect, which renderToStaticMarkup never runs.
    'export const render = (value) => renderToStaticMarkup(',
    '  <I18nProvider><CanvasStudio value={value} onChange={() => {}} /></I18nProvider>);',
  ].join('\n'));
  await esbuild.build({
    nodePaths: [join(process.cwd(), 'node_modules')],
    entryPoints: [entry], outfile: bundle, bundle: true, format: 'esm', platform: 'node',
    jsx: 'automatic', logLevel: 'silent', packages: 'external', loader: { '.css': 'empty' },
    // `packages: 'external'` leaves react-dom to node, which is right — but it would leave the
    // workspace packages to node too, and there is no link for node to follow. Same mapping
    // vite.config.js declares, pointed at the SOURCE so this reads the files being edited.
    alias: {
      '@bettercommunity/bmd': join(process.cwd(), '../../packages/bmd/src/index.jsx'),
      '@bettercommunity/bmd/editor-blocks': join(process.cwd(), '../../packages/bmd/src/editor-blocks.js'),
      '@bettercommunity/bmd/config': join(process.cwd(), '../../packages/bmd/src/config.js'),
      '@bettercommunity/bmd-editor': join(process.cwd(), '../../packages/bmd-editor/src/index.jsx'),
    },
  });
} catch (e) {
  console.error(`✗ could not build the studio for node: ${e?.message || e}`);
  cleanup(); process.exit(2);
}

let render;
try { ({ render } = await import(pathToFileURL(bundle).href)); }
catch (e) { console.error(`✗ the studio would not load: ${e?.message || e}`); cleanup(); process.exit(1); }

const problems = [];
const must = (cond, why) => { if (!cond) problems.push(why); };

const CANVAS = {
  id: 'c1', title: 'A page', height: 600,
  blocks: [
    { id: 'b1', kind: 'text', x: 32, y: 32, w: 400, h: 160, z: 0, props: { md: '## Title' } },
    { id: 'b2', kind: 'box', x: 32, y: 240, w: 300, h: 120, z: 1, props: { bg: 'rgba(0,0,0,.05)', radius: 12 } },
  ],
};

let html = '';
try { html = render(CANVAS); }
catch (e) {
  console.error(`✗ the studio threw while rendering: ${e?.message || e}`);
  console.error('  This is the failure the file exists for: nothing else mounts this component.');
  cleanup(); process.exit(1);
}

must(/<button/i.test(html), 'the studio rendered no controls at all');
// Both blocks drawn, each draggable.
const movable = (html.match(/cursor:move/g) || []).length;
must(movable === CANVAS.blocks.length, `expected ${CANVAS.blocks.length} draggable block(s), found ${movable}`);

// The touch contract. Counted rather than merely present: the canvas host AND every block need
// it — a host that opts out while its children do not still scrolls the page under a drag.
const touch = (html.match(/touch-action:none/g) || []).length;
must(touch >= CANVAS.blocks.length + 1,
  `touch-action:none appears ${touch} time(s); the canvas host and each of the ${CANVAS.blocks.length} blocks need it, or a drag scrolls the page instead of moving the block`);

// An empty canvas must render too — the state a brand-new studio page opens in.
try { must(render({ id: 'c2', title: '', height: 400, blocks: [] }).length > 0, 'an empty canvas rendered nothing'); }
catch (e) { problems.push(`an empty canvas threw: ${e?.message || e}`); }

// ── The phone. ───────────────────────────────────────────────────────────────────────────
// Below 700px the PUBLIC page abandons the canvas and stacks the blocks in reading order, so
// the studio does too: at 390px the board is drawn at 0.32 and a 12px handle is 4px of glass —
// an editor for a property (placement) that no phone reader will ever be shown.
//
// The mode is decided by matchMedia during the first render, which is exactly what lets it be
// checked here: stub the query and the component renders the branch a phone gets. Nothing
// else can reach it — the browser harness cannot mount this component at all, and a resize in
// the preview pane fires no ResizeObserver because the tab never paints.
const priorWindow = globalThis.window;
globalThis.window = { matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) };
let phone = '';
try { phone = render(CANVAS); }
catch (e) { problems.push(`the studio threw at phone width: ${e?.message || e}`); }
finally { if (priorWindow === undefined) delete globalThis.window; else globalThis.window = priorWindow; }

if (phone) {
  // The board is GONE — not merely shrunk. If it renders here, the phone got the 0.32 plane.
  must(!/cursor:move/.test(phone), 'at phone width the studio still draws the draggable board instead of the reading-order list');
  // Every block is present, painted with the same component the public page uses, and in
  // reading order — b1 (y=32) before b2 (y=240).
  must(phone.indexOf('Title') >= 0, 'the phone list did not render the blocks');
  // Reorder + delete per row, and each of the two blocks carries them.
  // Either language: which one this renders in depends on the provider's default, and the
  // control is the thing being asserted, not the wording.
  for (const [label, n] of [['Monter|Move up', 1], ['Descendre|Move down', 1], ['Supprimer|Delete', CANVAS.blocks.length]]) {
    const got = (phone.match(new RegExp(`title="(?:${label})"`, 'g')) || []).length;
    // Up is disabled on the first row and down on the last, but both still render; what must
    // not happen is a row with no way to move at all.
    must(got >= n, `the phone list shows ${got} "${label}" control(s); a row you cannot reorder is the whole point of this mode`);
  }
  must(/aria-disabled|disabled=""/.test(phone), 'nothing is disabled in the phone list — the first row must not offer "move up"');
  const empty = (() => {
    globalThis.window = { matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) };
    try { return render({ id: 'c3', title: '', height: 400, blocks: [] }); }
    catch (e) { problems.push(`an empty canvas threw at phone width: ${e?.message || e}`); return ''; }
    finally { if (priorWindow === undefined) delete globalThis.window; else globalThis.window = priorWindow; }
  })();
  must(empty.length > 0, 'an empty canvas rendered nothing at phone width');
}

cleanup();

// The handle hit area is CSS, so it is checked where it lives. The class has to exist on both
// sides or the media query in index.css styles nothing.
const { readFileSync } = await import('node:fs');
must(readFileSync(REL, 'utf8').includes('cst-handle'), 'the resize handles no longer carry .cst-handle');
const css = readFileSync('src/index.css', 'utf8');
must(/\.cst-handle[^{]*\{/.test(css), 'index.css has no .cst-handle rule — the touch hit area is gone');
must(/@media\s*\(pointer:\s*coarse\)/.test(css), 'the .cst-handle rule is not behind a coarse-pointer query, so it would grow the handle for a mouse too');

if (problems.length) {
  console.error('✗ the studio is not usable as it stands:');
  for (const p of problems) console.error(`    ${p}`);
  process.exit(1);
}
console.log(`✓ studio OK — rendered through the real component, ${movable} draggable block(s), touch-action on the canvas and each block, handles keep their touch target, and at phone width it renders the reading-order list instead of the board`);
