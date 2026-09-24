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
    "import CanvasView from '../src/ui/canvas-view.jsx';",
    "export const page = (value, theme) => renderToStaticMarkup(",
    '  <I18nProvider><CanvasView canvas={value} themePreview={theme} /></I18nProvider>);',
    // The stacked phone column: the layout where a fixed box had nothing to confine it (S5).
    // Studio phase 5: the link policy an external step is drawn under, set by the check itself.
    "export { setStudioLinks } from '../src/lib/studio-links.js';",
    "export const stack = (value) => renderToStaticMarkup(",
    '  <I18nProvider><CanvasView canvas={value} stackPreview /></I18nProvider>);',
    // Rendered inside the real provider, the way the app mounts it. Its network fetch lives in
    // an effect, which renderToStaticMarkup never runs.
    'export const render = (value) => renderToStaticMarkup(',
    '  <I18nProvider><CanvasStudio value={value} onChange={() => {}} /></I18nProvider>);',
    // The full-viewport form (/studio/:kind/:id/:index — pages/studio.jsx), with the top bar
    // the page hands it and a page renderer, so the "page preview" button exists.
    'export const renderPage = (value) => renderToStaticMarkup(',
    '  <I18nProvider><CanvasStudio layout="page" value={value} onChange={() => {}} renderPage={() => null}',
    '    chrome={{ title: "Doc", state: "dirty", canSave: true, onSave() {}, onBack() {} }} /></I18nProvider>);',
    // The SAME surface with no page renderer: a document being edited on its own. What is
    // asserted on it is that the page preview is still OFFERED and says why it cannot run.
    'export const renderLoose = (value) => renderToStaticMarkup(',
    '  <I18nProvider><CanvasStudio layout="page" value={value} onChange={() => {}}',
    '    chrome={{ title: "Doc", state: "dirty", canSave: true, onSave() {}, onBack() {} }} /></I18nProvider>);',
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
      '@bettercommunity/bmd/icons': join(process.cwd(), '../../packages/bmd/src/icons.jsx'), // M18: ui/md-lite.js
      // The studio now lazy-loads the B.MD editor for text blocks; esbuild bundles that dynamic
      // import too, and the editor package reaches these subpaths of the kit.
      '@bettercommunity/bmd/links': join(process.cwd(), '../../packages/bmd/src/links.js'),
      '@bettercommunity/bmd/ast': join(process.cwd(), '../../packages/bmd/src/ast.js'),
      '@bettercommunity/bmd/export': join(process.cwd(), '../../packages/bmd/src/export.jsx'),
      '@bettercommunity/bmd-editor': join(process.cwd(), '../../packages/bmd-editor/src/index.jsx'),
    },
  });
} catch (e) {
  console.error(`✗ could not build the studio for node: ${e?.message || e}`);
  cleanup(); process.exit(2);
}

let render; let page; let renderPage; let renderLoose; let stack; let setStudioLinks;
try { ({ render, page, renderPage, renderLoose, stack, setStudioLinks } = await import(pathToFileURL(bundle).href)); }
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

// ── The studio as a PAGE. ────────────────────────────────────────────────────────────
// Same component, layout="page": the top bar, the three panes and — below the three-pane
// width — the Blocks · Canvas · Properties tab row. The width is decided by matchMedia at the
// first render, which is what lets both shapes be checked here: nothing else mounts this
// surface without an admin session.
const mq = (wideMatches, phoneMatches) => ({
  matchMedia: (q) => ({ matches: /min-width/.test(q) ? wideMatches : phoneMatches, addEventListener() {}, removeEventListener() {} }),
});
const withWindow = (w, fn) => {
  const prior = globalThis.window;
  globalThis.window = w;
  try { return fn(); } finally { if (prior === undefined) delete globalThis.window; else globalThis.window = prior; }
};
let wideHtml = '';
try { wideHtml = withWindow(mq(true, false), () => renderPage(CANVAS)); }
catch (e) { problems.push(`the studio page threw at desktop width: ${e?.message || e}`); }
if (wideHtml) {
  must(/class="cst-page"/.test(wideHtml), 'the page form did not render its .cst-page root');
  must(/class="cst-topbar"/.test(wideHtml), 'the page form has no top bar');
  must(/data-save-state="dirty"/.test(wideHtml), 'the top bar does not show the save state it was handed');
  must(/class="cst-left/.test(wideHtml) && /class="cst-right/.test(wideHtml), 'at desktop width the left and right panes are not both rendered');
  must(!/class="cst-tabs"/.test(wideHtml), 'at desktop width the mobile tab row is drawn beside three panes');
  must(!/cst-sheet/.test(wideHtml), 'at desktop width a pane is rendered as a sheet');
  const t2 = (wideHtml.match(/touch-action:none/g) || []).length;
  must(t2 >= CANVAS.blocks.length + 1, `the page form has touch-action:none ${t2} time(s); the board and each block need it`);
  must((wideHtml.match(/cursor:move/g) || []).length === CANVAS.blocks.length, 'the page form did not draw every block as draggable');
  must(/aria-label="(?:Zoom in|Zoom avant)"/.test(wideHtml) && /aria-label="(?:Zoom out|Zoom arrière)"/.test(wideHtml), 'the page toolbar has no zoom +/- pair');
  must(/aria-label="(?:Show the grid|Afficher la grille)"/.test(wideHtml), 'the page toolbar has no grid toggle');
  must(/(?:Save as component|Enregistrer comme composant)/.test(wideHtml), 'the page toolbar cannot save the selection as a component');
  must(/(?:Components|Composants)/.test(wideHtml), 'the left pane has no Components tab');
  must(/title="(?:The whole project page, with this block in place|La page projet entière, avec ce bloc en place)"/.test(wideHtml), 'the page preview button is missing although a page renderer was given');
  // The tour is OFFERED but never auto-runs here: under node there is no localStorage, and
  // `readSeen` answers "seen" on any store it cannot read rather than starting itself over an
  // editor. Both halves matter: a tour that opened on every render would be a card over the
  // studio for everyone, and one with no way back would be unreachable after one dismissal.
  must(/aria-label="(?:Take the tour of the studio|Suivre la visite du studio)"/.test(wideHtml),
    'the studio offers no way to (re)start its guided tour');
  must(!/class="cst-tour-card"/.test(wideHtml),
    'the tour opened itself although nothing could say whether this viewer had seen it');
}

// ── The free board (PLAN-STUDIO-2026, phase 3). ─────────────────────────────────────
// The board is an infinite plane seen through ONE transform, the page is a FRAME drawn on it,
// and a block outside the frame is still a block: drawn, grabbable, marked. And the board
// paints the page's own background and stylesheet, which it never did before.
try {
  const FREE = {
    v: 2, id: 'fb1', title: 'Free', bg: '#123456', css: '.hero{letter-spacing:.1em}',
    frames: { desktop: { w: 1200, h: 400, fit: 'fixed' }, phone: { w: 390, fit: 'content', mode: 'stack' } },
    blocks: [
      { id: 'in1', kind: 'box', x: 40, y: 40, w: 300, h: 100, z: 0 },
      { id: 'park', kind: 'image', x: -700, y: 40, w: 300, h: 200, z: 1, props: { src: '/parked-offframe.png' } },
      { id: 'edge', kind: 'box', x: 1100, y: 40, w: 300, h: 100, z: 2 },
    ],
  };
  const free = withWindow(mq(true, false), () => renderPage(FREE));
  const world = /<div[^>]*data-cst-world[^>]*>/.exec(free)?.[0] || '';
  must(/transform:\s*translate\([^)]*\)\s*scale\(/.test(world), `the board is not drawn through one translate+scale camera: ${world.slice(0, 200)}`);
  must(/data-cv="fb1"/.test(world), 'the board world does not carry the page scope, so the page stylesheet cannot reach its blocks');
  const frameEl = /<div[^>]*data-cst-frame="desktop"[^>]*>/.exec(free)?.[0] || '';
  must(!!frameEl, 'the page frame is not drawn on the board');
  must(/width:\s*1200px/.test(frameEl) && /height:\s*400px/.test(frameEl), `the frame is not the page's 1200 x 400: ${frameEl.slice(0, 200)}`);
  // The page background (here the legacy `bg: '#123456'`, read as a closed `color`) is the
  // reader's own layer, drawn INSIDE the frame (ui/canvas-background.jsx, phase 4).
  const frameAt = free.indexOf(frameEl);
  const frameLayer = /<div[^>]*data-cv-bg="color"[^>]*>/.exec(free.slice(frameAt, frameAt + 4000))?.[0] || '';
  must(/background-color:\s*#123456/.test(frameLayer), `the board does not paint the page background inside the frame: ${frameLayer.slice(0, 200) || 'no layer'}`);
  must(/<style>[^<]*\[data-cv=(?:"|&quot;)fb1(?:"|&quot;)\] \.hero/.test(free), 'the board does not apply the page stylesheet, scoped');
  const parked = /<div[^>]*data-cst-block="park"[^>]*>/.exec(free)?.[0] || '';
  must(/data-off-frame="1"/.test(parked), 'a block left of the page is not marked as off the frame');
  must(/cursor:\s*move/.test(parked) && /touch-action:\s*none/.test(parked), 'a block off the frame cannot be grabbed again');
  must(/left:\s*-700px/.test(parked), 'the parked block was clamped back onto the page');
  must(!/data-off-frame/.test(/<div[^>]*data-cst-block="edge"[^>]*>/.exec(free)?.[0] || ''), 'a block crossing the frame edge is marked off the frame, but a reader sees half of it');
  must(/data-fit-content/.test(free), 'a frame with a pinned height offers no way back to "fit to content"');
  must(/class="cst-board-hedge"/.test(free), 'the frame has no height handle');
  must(/data-off-frame(?:="")?[^>]*>[^<]*(?:Off frame|Hors cadre)/.test(free) || /(?:Off frame|Hors cadre)/.test(free), 'the off-frame block carries no badge');
  // What a READER gets from the same document: the frame, clipped, and the parked block NOT
  // MOUNTED (its image is never requested).
  const served2 = page(FREE, 'light');
  must(!/parked-offframe\.png/.test(served2), 'the public page mounts a block that is entirely outside the frame');
  must(/left:40px;top:40px/.test(served2) && /left:1100px;top:40px/.test(served2), 'a block inside or crossing the frame is missing from the public page');
  must(!/left:-700px/.test(served2), 'the parked block is on the public page');
  const plane = /<div[^>]*data-cv-frame="desktop"[^>]*>/.exec(served2)?.[0] || '';
  must(/overflow:\s*clip/.test(plane) && /contain:\s*layout paint/.test(plane), `the public page is not clipped to the frame: ${plane.slice(0, 200)}`);
  must(!/parked-offframe\.png/.test(stack(FREE)), 'the stacked phone column mounts a block that is off the desktop page');
} catch (e) { problems.push(`the free board threw: ${e?.message || e}`); }

// -- A document that belongs to NO page. ----------------------------------------------
// The page preview used to be dropped from the group entirely when there was no page to show,
// which left an author looking at a preview group with one fewer control than the one their
// colleague describes, and nothing to read about why.
let looseHtml = '';
try { looseHtml = withWindow(mq(true, false), () => renderLoose(CANVAS)); }
catch (e) { problems.push(`the studio page threw with no page renderer: ${e?.message || e}`); }
if (looseHtml) {
  must(/(?:This document is not part of a page yet|Ce document ne fait pas encore partie)/.test(looseHtml),
    'with no page to preview, the page button is silently missing instead of saying why');
  // Scoped to THAT button. A bare /disabled=""/ over the whole page passes on undo and redo,
  // which are disabled on a fresh document anyway: it was green with the page button fully
  // enabled, which is the failure this file exists to refuse.
  const pageBtn = /<button[^>]*title="(?:This document is not part of a page yet|Ce document ne fait pas encore partie)[^"]*"[^>]*>/.exec(looseHtml);
  must(!!pageBtn, 'the page preview button carries no explanation of why it cannot run');
  must(!!pageBtn && /disabled=""/.test(pageBtn[0]),
    'the page preview button is offered as though it worked although there is no page to show');
}
let narrowHtml = '';
try { narrowHtml = withWindow(mq(false, false), () => renderPage(CANVAS)); }
catch (e) { problems.push(`the studio page threw at tablet width: ${e?.message || e}`); }
if (narrowHtml) {
  must(/class="cst-tabs"/.test(narrowHtml), 'below the three-pane width there is no Blocks · Canvas · Properties tab row');
  must(!/class="cst-left/.test(narrowHtml) && !/class="cst-right/.test(narrowHtml), 'below the three-pane width both panels are drawn at once — the canvas has no width left');
  must(/cursor:move/.test(narrowHtml), 'below the three-pane width the board itself is gone');
}
// A new page opens on nothing: the empty state names the three panes.
try {
  const empty = withWindow(mq(true, false), () => renderPage({ id: 'c9', title: '', height: 400, blocks: [] }));
  must(/data-empty-board/.test(empty), 'an empty page in the page form does not explain the panes');
} catch (e) { problems.push(`an empty canvas threw in the page form: ${e?.message || e}`); }

// ── What a READER gets, for every kind and for the dark variant. ─────────────────────
// The studio is where blocks are made; this is where they are served, and the two failures
// worth catching live here.
//
// The first is an iframe. An `embed` block frames an author-supplied URL on a PUBLIC page, so
// the allow-list (B.MD's — one list, not a second) is a security boundary and not a nicety. A
// refused URL must produce a LINK, never a frame, and "never" is the kind of claim that has to
// be executed rather than reviewed.
//
// The second is the theme overlay: a partial that silently returns a whole block freezes every
// coordinate the author never touched, and the only way to see it is to render both themes and
// compare.
const ALL_KINDS = {
  id: 'c4', title: '', height: 900,
  blocks: [
    { id: 'k1', kind: 'text', x: 0, y: 0, w: 400, h: 120, props: { md: 'hello' } },
    { id: 'k2', kind: 'image', x: 0, y: 160, w: 400, h: 120, props: { src: '/a.png', alt: 'a' } },
    { id: 'k3', kind: 'box', x: 0, y: 320, w: 400, h: 120, props: { bg: '#eee' } },
    { id: 'k4', kind: 'video', x: 0, y: 480, w: 400, h: 120, props: { src: '/clip.mp4' } },
    { id: 'k5', kind: 'embed', x: 0, y: 640, w: 400, h: 120, props: { url: 'https://www.youtube.com/embed/abc' } },
    { id: 'k6', kind: 'embed', x: 440, y: 640, w: 400, h: 120, props: { url: 'https://evil.example/steal' } },
    { id: 'k7', kind: 'replay', x: 0, y: 800, w: 400, h: 120, props: { src: '/demo.bmmreplay' } },
  ],
};
let served = '';
try { served = page(ALL_KINDS, 'light'); }
catch (e) { problems.push(`the public canvas threw on the full set of kinds: ${e?.message || e}`); }

if (served) {
  must(/<video/.test(served), 'a video block rendered no <video>');
  must(/<img/.test(served), 'an image block rendered no <img>');
  must(/bcw-canvas-replay/.test(served), 'a replay block rendered nothing the player can find');
  const frames = (served.match(/<iframe/g) || []).length;
  must(frames === 1, `${frames} iframe(s) for one allowed and one refused embed — the allow-list is not deciding`);
  must(served.includes('https://www.youtube.com/embed/abc'), 'the allowed embed is missing');
  must(!/iframe[^>]*evil\.example/.test(served), 'a URL outside the allow-list was framed');
  must(/evil\.example/.test(served), 'the refused embed vanished instead of being shown as a link — an author cannot see it was refused');
  must(/sandbox=/.test(served), 'the allowed iframe carries no sandbox');
  must(!/allow-same-origin/.test(served), 'the iframe sandbox allows same-origin, so a framed page can reach back into this one');
}

// The animation curve reaches the reader as a CSS custom property, and ONLY as one of the
// named curves: the author picks a name, lib/canvas.js maps it to a bezier, and nothing they
// typed is ever written into `animation-timing-function` on a public page. A page saved before
// easing existed must carry no variable at all, so the stylesheet's own default still decides.
try {
  const eased = page({ id: 'c6', title: '', height: 400, blocks: [
    { id: 'e1', kind: 'box', x: 0, y: 0, w: 200, h: 100, props: { bg: '#eee' }, anim: { kind: 'rise', trigger: 'show', easing: 'spring' } },
    { id: 'e2', kind: 'box', x: 0, y: 120, w: 200, h: 100, props: { bg: '#eee' }, anim: { kind: 'rise', trigger: 'show' } },
    { id: 'e3', kind: 'box', x: 0, y: 240, w: 200, h: 100, props: { bg: '#eee' }, anim: { kind: 'rise', trigger: 'show', easing: 'steal(); --x' } },
  ] }, 'light');
  must(/--cv-ease:\s*cubic-bezier\(\.34,1\.56,\.64,1\)/.test(eased), 'a named easing did not reach the page as a curve');
  must((eased.match(/--cv-ease/g) || []).length === 1,
    'a block with no easing of its own was given one, so the stylesheet default no longer decides');
  must(!/steal/.test(eased), 'an easing that was not one of the names reached the page');
} catch (e) { problems.push(`the easing render threw: ${e?.message || e}`); }

// A dark overlay that touches ONE field must leave the others alone.
const OVERLAID = {
  id: 'c5', title: '', height: 400,
  blocks: [{ id: 'o1', kind: 'box', x: 96, y: 48, w: 400, h: 200, props: { bg: '#fff' },
    themes: { dark: { y: 200, props: { bg: '#000' } } } }],
};
try {
  const light = page(OVERLAID, 'light');
  const dark = page(OVERLAID, 'dark');
  must(/top:\s*48px/.test(light), 'the light layout lost its own position');
  must(/top:\s*200px/.test(dark), 'the dark overlay did not move the block');
  must(/left:\s*96px/.test(dark), 'the dark overlay dropped a coordinate the author never touched');
  must(/width:\s*400px/.test(dark), 'the dark overlay dropped the width');
} catch (e) { problems.push(`rendering both themes threw: ${e?.message || e}`); }

// ── A HOSTILE document (PLAN-STUDIO-2026, S1 to S5). ─────────────────────────────────
// Everything a per-project editor can type into a studio page and a visitor then receives,
// rendered through the real component, in both the scaled and the stacked layout. Each rule
// below was checked by breaking the filter it guards and watching it go red.
const EVIL = 'https://evil.example/p.png';
const FORGED = 'x"]{}body{background:url(https://evil.example/id)}[data-anim="';
const HOSTILE = {
  id: 'h1', title: '', height: 900,
  bg: `url(${EVIL})`,
  css: '.a{position:fixed;inset:0;z-index:99}.b{position:\\66 ixed}.c{color:red}',
  blocks: [
    { id: 's1', kind: 'button', x: 0, y: 0, w: 200, h: 60, props: { label: 'Go', action: { type: 'link', href: 'javascript:alert(1)' } } },
    { id: 's2', kind: 'button', x: 0, y: 80, w: 200, h: 60, props: { label: 'Get', action: { type: 'download', href: ' JaVaScRiPt:alert(2)' } } },
    { id: 's3', kind: 'button', x: 0, y: 160, w: 200, h: 60, props: { label: 'Up', variant: 'dropdown-down', items: [{ label: 'x', href: 'java\nscript:alert(3)' }, { label: 'y', href: '/\\evil.example' }] } },
    { id: 's4', kind: 'button', x: 0, y: 240, w: 200, h: 60, props: { label: 'Api', action: { type: 'api', path: '/admin/users', method: 'POST', open: 'url' } } },
    { id: FORGED, kind: 'box', x: 0, y: 320, w: 200, h: 60, anim: { kind: 'custom', trigger: 'load', custom: 'from{opacity:0}to{opacity:1}' }, props: { bg: `url(${EVIL})` } },
    { id: 's6', kind: 'box', x: 0, y: 400, w: 200, h: 60, props: { bg: '\\75 rl(https://evil.example/esc)', border: `red url(${EVIL})`, color: `image-set("${EVIL}" 1x)`, style: 'position: fixed; inset: 0' } },
    { id: 's7', kind: 'button', x: 0, y: 480, w: 200, h: 60, props: { label: 'C', color: `url(${EVIL})` } },
    { id: 's8', kind: 'shape', x: 0, y: 560, w: 200, h: 60, props: { shape: 'rect', fill: `url(${EVIL})`, stroke: `url(${EVIL})` } },
    { id: 's9', kind: 'embed', x: 0, y: 640, w: 200, h: 60, props: { url: 'javascript:alert(9)' } },
    { id: 's10', kind: 'box', x: 0, y: 720, w: 200, h: 60, link: 'javascript:alert(10)', props: {} },
  ],
};
const decodeAttr = (v) => v.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const hrefOk = (h) => /^(\/(?![/\\])|#|https?:\/\/|mailto:)/i.test(h);
for (const [name, renderIt] of [['scaled', () => page(HOSTILE, 'light')], ['stacked', () => stack(HOSTILE)]]) {
  let out = '';
  try { out = renderIt(); } catch (e) { problems.push(`the hostile document threw in the ${name} layout: ${e?.message || e}`); continue; }
  const hrefs = [...out.matchAll(/\shref="([^"]*)"/g)].map((m) => decodeAttr(m[1]));
  const badHrefs = hrefs.filter((h) => !hrefOk(h));
  must(!badHrefs.length, `${name}: an author href reached the page outside the link policy: ${badHrefs.join(' | ')}`);
  must(!/javascript|vbscript/i.test(hrefs.join(' ')), `${name}: a script URL reached an href`);
  const styles = [...out.matchAll(/\sstyle="([^"]*)"/g)].map((m) => decodeAttr(m[1]));
  const offsite = styles.filter((st) => /evil\.example/.test(st) || /url\((?!\s*['"]?(?:\/(?!\/)|#|data:image\/))/i.test(st));
  must(!offsite.length, `${name}: a style attribute fetches from another host: ${offsite.join(' | ').slice(0, 200)}`);
  must(!/position:\s*fixed/i.test(styles.join(';')), `${name}: an author's position:fixed reached a style attribute`);
  const sheets = [...out.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => decodeAttr(m[1])).join('\n');
  must(!/evil\.example|"\]\{/.test(sheets), `${name}: a forged block id reached a <style> element: ${sheets.slice(0, 200)}`);
  must(!/position\s*:\s*(?:fixed|sticky)/i.test(sheets), `${name}: the page stylesheet kept position:fixed`);
  must(/color:red/.test(sheets), `${name}: the page stylesheet lost an ordinary rule while refusing the bad one`);
  must(/data-inert="api_removed"/.test(out), `${name}: the old api action is not rendered inert with its reason`);
  must(!/<a[^>]*href="[^"]*"[^>]*data-inert/.test(out), `${name}: an inert button still carries an href`);
  // The root is a containing block for fixed boxes, in EVERY layout.
  const root = /<div[^>]*data-cv="h1"[^>]*>/.exec(out)?.[0] || '';
  must(/contain:\s*layout paint/.test(root) && /transform:\s*translateZ\(0\)/.test(root),
    `${name}: the canvas root does not confine position:fixed (needs contain: layout paint and a transform): ${root.slice(0, 200)}`);
}

// ── Page backgrounds (PLAN-STUDIO-2026 2.4, phase 4). ────────────────────────────────
// A closed value: every kind is rebuilt from named fields, so nothing typed reaches a style
// attribute as text. Hostile values of every kind, through the real component in both layouts:
// not one url() to another host, not one script scheme, and no stray declaration. Then the 3D
// kind: the server render (and so the first paint) is the still CSS drawing, never a <canvas>,
// and the studio's board draws it still too, so the editor opens no WebGL context.
const BG_EVIL = [
  { type: 'color', color: `url(${EVIL})` },
  { type: 'color', color: 'red;background:url(https://evil.example/c)' },
  { type: 'color', color: 'var(--x);background-image:url(https://evil.example/v)' },
  { type: 'gradient', angle: 90, stops: [{ color: `url(${EVIL})`, at: 0 }, { color: '#fff', at: 100 }, { color: 'image-set("https://evil.example/s" 1x)' }] },
  { type: 'image', src: EVIL },
  { type: 'image', src: '//evil.example/p.png' },
  { type: 'image', src: '/api/media/../../x");background:url(https://evil.example/q' },
  { type: 'image', src: '/api/media/%2e%2e/%2fevil.example/p.png' },
  { type: 'pattern', id: 'dots', color: '"/><image href="https://evil.example/i"/>' },
  { type: 'pattern', id: 'x");background:url(https://evil.example/pid' },
  { type: 'board', color: `url(${EVIL})`, grid: 24 },
  { type: 'scene3d', shape: 'x");background:url(https://evil.example/sh', position: 'url(https://evil.example/pos)' },
  { type: 'nope', color: `url(${EVIL})` },
];
for (const [i, background] of BG_EVIL.entries()) {
  const doc = { v: 2, id: `bgx${i}`, frames: { desktop: { w: 1200, h: 400, fit: 'fixed' }, phone: { w: 390, fit: 'content', mode: 'stack' } }, background,
    blocks: [{ id: 't1', kind: 'text', x: 0, y: 0, w: 300, h: 100, props: { md: 'x' } }] };
  for (const [name, renderIt] of [['scaled', () => page(doc, 'light')], ['stacked', () => stack(doc)], ['board', () => withWindow(mq(true, false), () => renderPage(doc))]]) {
    let out = '';
    try { out = renderIt(); } catch (e) { problems.push(`background #${i} threw in the ${name} layout: ${e?.message || e}`); continue; }
    const styles = [...out.matchAll(/\sstyle="([^"]*)"/g)].map((m) => decodeAttr(m[1]));
    const offsite = styles.filter((st) => /evil\.example/.test(st) || /url\((?!\s*['"]?(?:\/(?!\/)|data:image\/))/i.test(st));
    must(!offsite.length, `${name}: hostile background #${i} (${background.type}) reached a style attribute: ${offsite.join(' | ').slice(0, 200)}`);
    must(!/evil\.example/.test(out), `${name}: hostile background #${i} (${background.type}) reached the markup at all`);
  }
}
const SCENE_DOC = { v: 2, id: 'sc1', frames: { desktop: { w: 1200, h: 500, fit: 'fixed' }, phone: { w: 390, fit: 'content', mode: 'stack' } },
  background: { type: 'scene3d', shape: 'gem', position: 'right', glow: 0.5 },
  blocks: [{ id: 't1', kind: 'text', x: 40, y: 40, w: 400, h: 120, props: { md: '# Hi' } }] };
try {
  for (const [name, out] of [['scaled', page(SCENE_DOC, 'light')], ['stacked', stack(SCENE_DOC)]]) {
    must(/data-cv-bg="scene3d"/.test(out), `${name}: a 3D background drew no layer`);
    must(/data-scene-mode="still"/.test(out), `${name}: the first paint of a 3D background is not the still drawing`);
    must(!/<canvas/i.test(out), `${name}: a 3D background put a <canvas> in the server render`);
    must(/clip-path:\s*polygon/.test(out), `${name}: the still drawing of the gem is not its outline`);
  }
  const ed = withWindow(mq(true, false), () => renderPage(SCENE_DOC));
  must(/data-cst-frame="desktop"[^>]*data-bg="scene3d"/.test(ed), 'the board does not know the page has a 3D background');
  must(/data-cv-bg="scene3d"[^>]*data-scene-mode="still"/.test(ed), 'the board does not draw a 3D background as its still drawing');
  must(!/<canvas/i.test(ed), 'the studio put a <canvas> on the page (the board must never open a WebGL context)');
  // The Page panel is a dock panel now, with a thumbnail per kind of background.
  must(/data-page-panel/.test(ed), 'the Page panel is not in the dock');
  const kinds = [...ed.matchAll(/data-bg-kind="([a-z0-9]+)"/g)].map((m) => m[1]);
  must(['site', 'color', 'gradient', 'image', 'pattern', 'scene3d', 'board'].every((k) => kinds.includes(k)), `the Page panel does not offer every kind of background: ${kinds.join(',')}`);
  must((ed.match(/data-bg-thumb=/g) || []).length >= 7, 'the kinds of background have no thumbnails');
} catch (e) { problems.push(`the 3D background threw: ${e?.message || e}`); }
// An old page whose free-text background cannot be kept says so in the studio, once.
try {
  const legacy = withWindow(mq(true, false), () => renderPage({ id: 'lg1', title: '', bg: 'color-mix(in srgb, var(--primary) 10%, transparent)', blocks: [] }));
  must(/data-bg-note/.test(legacy), 'an old background that was replaced is not reported in the Page panel');
} catch (e) { problems.push(`the legacy background note threw: ${e?.message || e}`); }

// ── Block actions (PLAN-STUDIO-2026 2.5, phase 5). ───────────────────────────────────
// Every element can be a button. What a reader gets, in both layouts: a navigation is a REAL
// <a href> (middle click, screen readers), an external one opens a new tab with
// rel="noopener noreferrer", anything else is a <button>; a text block's own links are never
// inside the block's link (anchors are never nested: the action is a cover beside them); a
// hidden block a reveal step names is mounted, out of sight. Then a hostile document: every
// refused step renders INERT with its reason, and no href leaves the admitted forms.
// Each assertion was checked by breaking what it guards (recorded in the phase 5 report).
const ACT = {
  v: 2, id: 'act1', frames: { desktop: { w: 1200, h: 900, fit: 'fixed' }, phone: { w: 390, fit: 'content', mode: 'stack' } },
  blocks: [
    { id: 'nav', kind: 'box', x: 0, y: 0, w: 200, h: 60, name: 'Docs band', action: [{ type: 'navigate', to: '/docs' }] },
    { id: 'ext', kind: 'image', x: 0, y: 80, w: 200, h: 60, props: { src: '/a.png', alt: 'Logo' }, action: [{ type: 'external', url: 'https://github.com/x' }] },
    { id: 'cpy', kind: 'button', x: 0, y: 160, w: 200, h: 60, props: { label: 'Copy' }, action: [{ type: 'copy', text: 'X' }] },
    { id: 'txt', kind: 'text', x: 0, y: 240, w: 300, h: 80, props: { md: 'Read [the docs](/docs/inner) now' }, action: [{ type: 'navigate', to: '/outer' }] },
    { id: 'more', kind: 'text', x: 0, y: 340, w: 300, h: 60, hidden: true, props: { md: 'More' } },
    { id: 'gone', kind: 'text', x: 0, y: 380, w: 300, h: 20, hidden: true, props: { md: 'Never mounted' } },
    { id: 'rev', kind: 'button', x: 0, y: 420, w: 200, h: 60, props: { label: 'Show' }, action: [{ type: 'reveal', target: 'more' }] },
    { id: 'dl', kind: 'box', x: 0, y: 500, w: 200, h: 60, action: [{ type: 'download', asset: 'setup.exe' }] },
    { id: 'pg', kind: 'box', x: 0, y: 580, w: 200, h: 60, action: [{ type: 'page', canvasId: 'pricing' }] },
    { id: 'sub', kind: 'button', x: 0, y: 660, w: 200, h: 60, props: { label: 'Join' }, action: [{ type: 'submit', endpoint: 'newsletter.subscribe' }] },
  ],
};
/** The deepest <a> nesting in a markup string. */
const anchorDepth = (html) => {
  let d = 0; let max = 0;
  for (const m of html.matchAll(/<a[\s>]|<\/a>/g)) { d += m[0] === '</a>' ? -1 : 1; max = Math.max(max, d); }
  return max;
};
const tagWith = (html, attr) => [...html.matchAll(/<[a-z]+\b[^>]*>/g)].map((m) => m[0]).filter((tag) => tag.includes(attr));
const hrefOk5 = (h) => hrefOk(h) || /^\?tab=c-[A-Za-z0-9_-]{1,60}$/.test(h);
try {
  for (const [name, out] of [['scaled', page(ACT, 'light')], ['stacked', stack(ACT)]]) {
    const acts = tagWith(out, 'data-act=');
    must(acts.length === 8, `${name}: ${acts.length} actionable element(s) for 8 blocks with an action`);
    for (const tag of acts) {
      const ok = /^<a\b/.test(tag) ? /\shref="[^"]+"/.test(tag) : /^<button\b[^>]*type="button"/.test(tag);
      must(ok, `${name}: an actionable element is neither a link with an href nor a <button>, so Tab and Enter cannot reach it: ${tag.slice(0, 160)}`);
    }
    const nav = tagWith(out, 'href="/docs"').find((tag) => /class="cv-act"/.test(tag)) || '';
    must(!!nav, `${name}: a navigate step did not make the block a real <a href>`);
    must(/aria-label="Docs band"/.test(nav), `${name}: the block's cover has no accessible name`);
    const ext = tagWith(out, 'href="https://github.com/x"')[0] || '';
    must(/target="_blank"/.test(ext) && /rel="noopener noreferrer"/.test(ext), `${name}: an external link does not open a new tab with rel="noopener noreferrer": ${ext.slice(0, 200)}`);
    must(/^<button\b/.test(tagWith(out, 'data-act="copy"')[0] || ''), `${name}: a copy button is not a <button>`);
    must(/download=""/.test(tagWith(out, 'href="/api/assets/setup.exe"')[0] || ''), `${name}: a download step lost its download attribute`);
    must(tagWith(out, 'href="?tab=c-pricing"').length === 1, `${name}: a page step does not link to the page's tab`);
    must(/^<button\b/.test(tagWith(out, 'data-act="submit"')[0] || ''), `${name}: a submit step is not a <button>`);
    // A text block's own links win: its link is there, and no anchor is ever inside another.
    must(/href="\/docs\/inner"/.test(out) && /href="\/outer"/.test(out), `${name}: the text block's own link or its action is missing`);
    must(anchorDepth(out) === 1, `${name}: an <a> is nested inside another (depth ${anchorDepth(out)}): the block action swallowed the text's own link`);
    const more = tagWith(out, 'data-cvb="more"')[0] || '';
    must(!!more && /display:\s*none/.test(more), `${name}: a hidden block named by a reveal step is not mounted out of sight: ${more.slice(0, 160) || 'absent'}`);
    must(!/Never mounted/.test(out), `${name}: a hidden block no reveal names was mounted`);
    const hrefs = [...out.matchAll(/\shref="([^"]*)"/g)].map((m) => decodeAttr(m[1]));
    must(hrefs.every(hrefOk5), `${name}: an href outside the admitted forms: ${hrefs.filter((h) => !hrefOk5(h)).join(' | ')}`);
  }
} catch (e) { problems.push(`the phase 5 action render threw: ${e?.message || e}`); }

// Hostile steps, stored anyway (the API refuses them; a page saved before, or written by hand
// into the database, still reaches the renderer). Each renders INERT, with its reason, no href.
const ACT_EVIL = [
  [{ type: 'navigate', to: 'javascript:alert(1)' }, 'unsafe_url'],
  [{ type: 'navigate', to: ' JaVaScRiPt:alert(1)' }, 'unsafe_url'],
  [{ type: 'navigate', to: 'data:text/html,x' }, 'unsafe_url'],
  [{ type: 'navigate', to: '//evil.example' }, 'unsafe_url'],
  [{ type: 'navigate', to: `/${String.fromCharCode(92)}evil.example` }, 'unsafe_url'],
  [{ type: 'navigate', to: '/%2F%2Fevil.example' }, 'unsafe_url'],
  [{ type: 'external', url: 'http://evil.example' }, 'https_only'],
  [{ type: 'external', url: 'javascript:alert(1)' }, 'unsafe_url'],
  [{ type: 'mailto', address: 'a@evil.example?bcc=x@y.z' }, 'bad_value'],
  [{ type: 'download', file: 'https://evil.example/x.exe' }, 'unsafe_url'],
  [{ type: 'scroll', target: 'body > div' }, 'bad_scroll_target'],
  [{ type: 'submit', endpoint: 'admin.users' }, 'unknown_endpoint'],
  [{ type: 'modal', target: 'e0' }, 'reserved_action'],
  [{ type: 'api', path: '/admin/users', method: 'POST' }, 'api_removed'],
];
const evilDoc = (withSixth) => ({
  v: 2, id: 'actx', frames: { desktop: { w: 1200, h: 2000, fit: 'fixed' }, phone: { w: 390, fit: 'content', mode: 'stack' } },
  blocks: [
    ...ACT_EVIL.map(([step], i) => ({ id: `e${i}`, kind: i % 2 ? 'button' : 'box', x: 0, y: i * 70, w: 200, h: 60, props: i % 2 ? { label: `E${i}` } : {}, action: [step] })),
    ...(withSixth ? [{ id: 'six', kind: 'box', x: 300, y: 0, w: 100, h: 60, action: [1, 2, 3, 4, 5, 6].map(() => ({ type: 'copy', text: 'x' })) }] : []),
  ],
});
try {
  for (const [name, out] of [['scaled', page(evilDoc(true), 'light')], ['stacked', stack(evilDoc(true))]]) {
    for (const [i, [step, reason]] of ACT_EVIL.entries()) {
      const inert = tagWith(out, `data-inert="${reason}"`);
      must(inert.length > 0, `${name}: hostile step #${i} (${step.type}) is not rendered inert with its reason "${reason}"`);
    }
    must(tagWith(out, 'data-inert="too_many"').length === 1, `${name}: a sixth step did not make the block inert`);
    must(!tagWith(out, 'data-inert=').some((tag) => /\shref=/.test(tag)), `${name}: an inert element carries an href`);
    const hrefs = [...out.matchAll(/\shref="([^"]*)"/g)].map((m) => decodeAttr(m[1]));
    must(!hrefs.some((h) => /evil\.example|javascript|vbscript|data:/i.test(h)), `${name}: a hostile step reached an href: ${hrefs.join(' | ')}`);
    must(!tagWith(out, 'data-act=').length, `${name}: a hostile step rendered a live link or button`);
  }
  // The site's link policy, when an admin set one: an off-list host is inert on the page too.
  setStudioLinks({ mode: 'allow', hosts: ['github.com'] });
  const pol = page({ id: 'pol', blocks: [
    { id: 'ok', kind: 'box', x: 0, y: 0, w: 100, h: 50, action: [{ type: 'external', url: 'https://docs.github.com/a' }] },
    { id: 'no', kind: 'box', x: 0, y: 60, w: 100, h: 50, action: [{ type: 'external', url: 'https://evil.example/a' }] },
  ] }, 'light');
  setStudioLinks({ mode: 'block', hosts: [] });
  must(/href="https:\/\/docs\.github\.com\/a"/.test(pol), 'an allowlisted host was not rendered as a link');
  must(!/evil\.example/.test(pol) && /data-inert="host_not_allowed"/.test(pol), 'an off-allowlist host reached the page, or was not marked inert');
} catch (e) { problems.push(`the hostile action render threw: ${e?.message || e}`); }
must(/\.cv-act:focus-visible\s*\{[^}]*outline:\s*2px/.test((await import('node:fs')).readFileSync('src/index.css', 'utf8')), 'a block action has no visible focus ring (.cv-act:focus-visible in index.css)');

cleanup();

// The handle hit area is CSS, so it is checked where it lives. The class has to exist on both
// sides or the media query in index.css styles nothing.
const { readFileSync } = await import('node:fs');
must(readFileSync(REL, 'utf8').includes('cst-handle'), 'the resize handles no longer carry .cst-handle');
const css = readFileSync('src/index.css', 'utf8');
must(/\.cst-handle[^{]*\{/.test(css), 'index.css has no .cst-handle rule — the touch hit area is gone');
must(/@media\s*\(pointer:\s*coarse\)/.test(css), 'the .cst-handle rule is not behind a coarse-pointer query, so it would grow the handle for a mouse too');
// The page preview must be a containing block for `position: fixed`, or the real page's own
// fixed furniture (the 3D hero backdrop at z-index -10, an event effect at z-45) resolves
// against the VIEWPORT: under an opaque .cst-page it disappears, over it it covers the whole
// editor. A transform on the frame is what makes those fixed children resolve against the
// preview instead. Asserted on the LAST .cst-page-frame rule, which is the one that wins.
const frameRules = [...css.matchAll(/\.cst-page-frame\s*\{([^}]*)\}/g)].map((m) => m[1]);
must(frameRules.length > 0, 'index.css has no .cst-page-frame rule, so the page preview has no frame');
// Read the VALUE and compare it, rather than writing a lookahead after `\s*`: `\s*` backtracks
// to zero width, the lookahead then reads a space instead of the value, and the assertion
// passes on `transform: none` -- a gate that is green whatever the file says.
const frameTransform = (/transform:\s*([^;}]*)/.exec(frameRules[frameRules.length - 1] || '') || [])[1];
must(!!frameTransform && frameTransform.trim() !== 'none',
  `the page preview frame's transform is "${frameTransform || 'absent'}", so the previewed page's fixed elements resolve against the viewport and cover the studio`);
must(/\.cst-tour-card[^{]*\{/.test(css) && /\.cst-tour-ring[^{]*\{/.test(css), 'the tour has no card or no ring rule in index.css');
must(/\.cst-tour-ring[^{]*\{[^}]*pointer-events:\s*none/.test(css),
  'the tour ring takes the pointer, so the editor it is describing cannot be used while it is up');

if (problems.length) {
  console.error('✗ the studio is not usable as it stands:');
  for (const p of problems) console.error(`    ${p}`);
  process.exit(1);
}
console.log(`✓ studio OK — rendered through the real component, ${movable} draggable block(s), touch-action on the canvas and each block, handles keep their touch target, at phone width it renders the reading-order list instead of the board, the page form draws three panes wide and a tab row narrow, every block kind is served, an off-list embed is a link and not a frame, and a dark overlay changes only what it names`);
