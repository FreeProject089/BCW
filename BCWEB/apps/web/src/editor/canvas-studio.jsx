// The studio: place blocks on a page by hand.
//
// All the arithmetic lives in lib/canvas.js and is tested there — drag at any zoom, resize
// from any of the eight handles, snapping, alignment guides, z-order. This file is the
// pointer plumbing and the panel, and deliberately owns no rules of its own: the preview is
// the SAME CanvasView the public page uses, so "what the author sees" and "what a reader
// gets" cannot become two answers.
import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import {
  Type, Smartphone, Sun, Moon, Layers, LayoutList, FileText, Blocks, Puzzle, SlidersHorizontal, LayoutTemplate,
  ArrowLeft, X, MonitorSmartphone,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { Button, Modal, useToast, useDialog } from '../ui/ui.jsx';
import { useI18n } from '../i18n.jsx';
import { api } from '../lib/api.js';
import { stepZoom } from '../lib/studio-page.js';
import {
  componentFromBlocks, instantiateComponent, detachBlocks, updateInstances, componentIdsIn,
  normalizeComponents, COMPONENT_LIMITS, blocksFromPreset, presetEntry, instanceFromEntry, PRESET_SORTS,
} from '../lib/studio-components.js';
// Components (phase 7b): instances, the page's components, component mode.
import {
  SaveComponentDialog, PageComponents, LibraryComponents, ExposedFields,
} from './studio-component-editor.jsx';
// Studio phase 6: the page list and the preset gallery (dock panels).
import { PagesPanel, PresetsPanel } from './studio-pages.jsx';
import { scopeCss } from '../lib/css-scope.js';
// The full B.MD editor is heavy and most sessions never open it: loaded on first use.
const LazyMarkdownEditor = lazy(() => import('./markdown-editor.jsx').then((m) => ({ default: m.MarkdownEditor })));
import { CanvasTree, InstanceMap } from '../ui/canvas-view.jsx';
// Containers (studio phase 7a): the Layers tree, the scope bar, the inspector's section.
import { LayersTree, ScopeBar, ContainerFields } from './studio-containers.jsx';
import {
  DOCK_ZONES, DockZone, DockResizer, DockGhost, useDockLayout, useDockDrag, zoneOf, movePanel,
  BoardEdge,
} from './studio-dock.jsx';
import ShortcutsModal from './studio-shortcuts.jsx';
import {
  normalizeCanvas, serializeDoc, paintOrder, dragTo, resizeTo, alignmentGuides, bringTo,
  inFrame, boardBlocks, boardFrame, offFrameIds, toBoard, zoomAt, wheelZoom, pinchView, fitFrameView, showAllView, revealView,
  emptyHistory, pushHistory, undo as undoHist, redo as redoHist,
  boundsOf, blocksInRect, moveMany, DESIGN_WIDTH, GRID,
  alignOnBoard, distributeOnBoard, matchSizeOnBoard, duplicateOnBoard, placeOnBoard, dragPatch,
  isContainer, isPageRoot, toStored, dropTarget, reparentBlocks, groupBlocks, ungroupBlocks, pullChildrenInside,
  descendantIds, subtreeHeight, treeIndex, innerBox, MAX_DEPTH, TAB_STRIP_H,
  definitionFromBlocks, definitionTreeProblems, replaceWithInstance, updateCopies, setOverride, detachInstance,
  snapshotOf, snapshotDiffers, withSnapshot, instancesOfComponent,
} from '../lib/canvas.js';
import CanvasBackground from '../ui/canvas-background.jsx';
import StudioTour, { useStudioTour } from './studio-tour.jsx';
// Studio phase 8: the panels, each in a file of its own.
import { PreviewSurface } from './studio-preview.jsx';
import { PageTopBar } from './studio-topbar.jsx';
import { BlocksPanel, ComponentsPanel, EmptyBoard } from './studio-panels.jsx';
import { BoardBlock } from './studio-board.jsx';
import { PagePanel } from './studio-page-panel.jsx';
import { Toolbar } from './studio-toolbar.jsx';
import { Inspector, ComponentSection } from './studio-inspector.jsx';
// Studio phase 7c: export and import (.bcwstudio.json), a dropped file, and the paste, one reader.
import { useStudioIO } from './studio-io.js';
import { StudioIODialog, DropOverlay, ImportButton } from './studio-io-panel.jsx';

const uid = () => `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/**
 * The panels the dock knows about, in the order every menu and the phone's tab row lists them.
 *
 * Module scope, and a plain array, because the dock's stored layout is checked against it: a
 * panel that is dropped from this list disappears from a layout saved by an older build
 * instead of leaving an id nothing can render.
 */
const PANEL_IDS = ['pages', 'blocks', 'layers', 'components', 'presets', 'props', 'page'];

/**
 * The panels THIS document has (PLAN-STUDIO-2026, phase 8: the panels adapt to what is edited).
 *
 * A component's definition (component mode) has no sibling pages, no page presets and no page
 * background or stylesheet: a copy is drawn from its blocks alone, so a Page panel there would
 * edit something no reader ever gets. A document edited outside any page list (no `pages`) has
 * no Pages or Presets to show. Everything else (project, other project, home) gets them all;
 * what differs between those is inside the panels (the home page lists its sections without
 * page operations, and offers no page preset, since it cannot make a page).
 *
 * The dock keeps a stored layout per browser; an id missing here is simply not drawn, and
 * comes back where the author left it on a document that has it (studio-dock.jsx).
 */
export function panelIdsFor({ componentMode = false, pages = false } = {}) {
  if (componentMode) return ['blocks', 'layers', 'components', 'props'];
  return PANEL_IDS.filter((id) => pages || (id !== 'pages' && id !== 'presets'));
}

/** How far the snapping guides are drawn, in board px: past the ±20 000 guard rail both ways. */
const BOARD_REACH = 40_000;

const NEW_BLOCK = {
  text: { kind: 'text', w: 400, h: 160, props: { md: '## Titre\n\nÉcris ici.' } },
  image: { kind: 'image', w: 400, h: 260, props: { src: '', alt: '', fit: 'cover' } },
  box: { kind: 'box', w: 400, h: 200, props: { bg: 'rgba(99,102,241,0.10)', radius: 16 } },
  // 16:9 by default for the three that carry moving pictures — a video box that starts square
  // is a box every author resizes before doing anything else.
  video: { kind: 'video', w: 560, h: 315, props: { src: '', controls: true, muted: false, loop: false, fit: 'contain' } },
  embed: { kind: 'embed', w: 560, h: 315, props: { url: '', title: '' } },
  replay: { kind: 'replay', w: 640, h: 400, props: { src: '' } },
  button: { kind: 'button', w: 240, h: 56, props: { label: 'Discover', variant: 'button', size: 'md' }, action: [{ type: 'navigate', to: '/' }] },
  shape: { kind: 'shape', w: 200, h: 200, props: { shape: 'rounded', fill: 'var(--primary)', corner: 16 } },
  svg: { kind: 'svg', w: 240, h: 240, props: { svg: '' } },
  // Containers (phase 7a). A group is made from a selection (Ctrl+G); these two are added whole.
  tabs: { kind: 'tabs', w: 640, h: 360, props: { bg: 'var(--surface)', border: 'var(--line)', radius: 16 } },
  modal: { kind: 'modal', w: 520, h: 320, props: { bg: 'var(--bg-solid)' } },
};

/**
 * @param {object} props
 * @param {object} props.value       the canvas being edited (raw; normalised here)
 * @param {Function} props.onChange  receives the whole next canvas on every change
 *
 * ONE surface (PLAN-STUDIO-2026, decision D1, phase 8): the full-viewport studio at
 * /studio/:kind/:id/:page, three panes on a wide screen, bottom sheets below 1024px, refused
 * below 768px. The compact "modal" form the config editor used to embed is gone; the config
 * editor links here instead, so there is one set of commands to learn and to test.
 *
 * @param {object} [props.chrome]    { title, state, onBack, onSave, canSave, draftRestored,
 *        onDiscardDraft }: the document and its save path, owned by the page.
 * @param {Function} [props.renderPage]  (canvas) => the WHOLE public page with this canvas in
 *        place, for the "page preview".
 * @param {object} [props.pages]  (phase 6): the target's page list, its operations and its
 *        preset libraries, owned by pages/studio.jsx (see studio-pages.jsx).
 * @param {object} [props.componentMode]  phase 7b: the document is a COMPONENT's definition
 *        (pages/studio-component.jsx): `{ exposed, onExposed }`, the fields its copies may change.
 */
export default function CanvasStudio({ value, onChange, chrome = null, renderPage = null, pages = null, componentMode = null }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const dialog = useDialog();
  const canvas = useMemo(() => normalizeCanvas(value), [value]);
  // A SET of ids. Everything that was written for one block still works — `sel` is the single
  // selection when there is exactly one — and the group operations read the whole set.
  const [selIds, setSelIds] = useState([]);
  const selId = selIds.length === 1 ? selIds[0] : null;
  // Containers (phase 7a). `scope` is the container being edited ('' = the page): a press
  // selects the block at that level, a double-click on a container goes into it, Escape comes
  // back out. `editSlots` is the tab each tab card shows on the board (visitors open the first).
  const [scope, setScope] = useState('');
  const [editSlots, setEditSlots] = useState({});
  const setSelId = (id) => setSelIds(id == null ? [] : [id]);
  // A marquee in flight, in DESIGN coordinates. In state because it has to draw.
  const [marquee, setMarquee] = useState(null);
  const [snapOn, setSnapOn] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  /**
   * The camera over the board: `{ x, y, s, fit }` (PLAN-STUDIO-2026, phase 3).
   *
   * The board used to be a scrolled box as wide as the page, so nothing could exist left of
   * it or above it, and "zoom" was the scale of that box. It is now an infinite plane drawn
   * through ONE transform, and this is where the plane is looked at from. `fit: true` means
   * "fit the frame to the pane", recomputed from the pane's size on every render, so a pane
   * that is resized or a board switched to the phone stays fitted without an effect.
   */
  const [cam, setCam] = useState(() => ({ ...fitFrameView({ w: DESIGN_WIDTH }, DESIGN_WIDTH, 0), fit: true }));
  const [mdFor, setMdFor] = useState(null);           // block id whose text is in the B.MD editor
  const clip = useRef([]);                           // copied blocks (also written to the clipboard)
  const [preview, setPreview] = useState('');         // '' | 'desktop' | 'tablet' | 'phone' | 'page'
  // Bumped to remount the preview, which is how "play the animations again" works: an
  // entrance animation runs when its element appears, and a fresh mount is an appearance.
  const [previewKey, setPreviewKey] = useState(0);
  // Page mode, on a phone: which single panel is up over the canvas, or the canvas alone.
  // A dock is the wrong shape below the three-pane width — three zones on a 375px screen is
  // three slivers — so there the panels take turns instead of sharing the width.
  const [pane, setPane] = useState('canvas');         // 'canvas' | a panel id
  // The Hand tool: a press on the board pans it instead of starting a rubber band. The tool
  // exists because space-drag is a keyboard gesture and a touch author has no space bar.
  const [panMode, setPanMode] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  // "Update the copies" can be undone from its toast (phase 7b): the function it calls reads the
  // page as it is THEN, so a later change is not thrown away with it.
  const revertCopiesRef = useRef(null);
  const [wide, setWide] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(min-width: 1024px)').matches : true));
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(min-width: 1024px)');
    const read = () => setWide(mq.matches);
    read();
    mq.addEventListener?.('change', read);
    return () => mq.removeEventListener?.('change', read);
  }, []);
  /**
   * Too small to be a studio at all.
   *
   * 768px is not a guess: it is the width at which the SITE changes shape — below it the
   * fixed bottom tab bar appears, and that bar sat exactly on top of the studio's own tab row
   * (measured at 375×812: the site bar occupied y 746–802, the studio's five tabs y 763–812,
   * and elementFromPoint returned the site bar for every one of them). It is also where the
   * board itself was already being given up for a list. An editor whose every control is
   * under someone else's furniture is not degraded, it is broken, so below this the page mode
   * says so and offers the way back instead of drawing a layout that cannot be used.
   *
   * Written as a max-width query on purpose: this component's width branches are read through
   * matchMedia during the first render, and check-studio.mjs drives them by stubbing it.
   */
  const [tooSmall, setTooSmall] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(max-width: 767.98px)').matches : false));
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(max-width: 767.98px)');
    const read = () => setTooSmall(mq.matches);
    read();
    mq.addEventListener?.('change', read);
    return () => mq.removeEventListener?.('change', read);
  }, []);
  /**
   * The studio takes the viewport over while it is open, and gives it back on the way out.
   *
   * The attribute is what stops the PAGE behind scrolling under a full-screen editor; the
   * stacking is fixed by the portal further down rather than here, because a rule that hid the
   * site's header by name would be a rule that breaks the day that header is renamed.
   */
  useEffect(() => {
    if (tooSmall || typeof document === 'undefined') return undefined;
    const el = document.documentElement;
    el.setAttribute('data-studio-open', '1');
    return () => el.removeAttribute('data-studio-open');
  }, [tooSmall]);
  /**
   * The dock: which panel sits where, how wide each zone is, what is folded or closed.
   *
   * The author's arrangement, not the page's — it lives in this browser (localStorage), so two
   * people editing the same document each keep their own desk and neither can rearrange the
   * other's. See studio-dock.jsx for what is and is not built.
   */
  const panelIds = useMemo(() => panelIdsFor({ componentMode: !!componentMode, pages: !!pages }), [componentMode, pages]);
  const { layout: dock, apply: applyDock, reset: resetDock } = useDockLayout(panelIds);
  /**
   * The board's own size, from the same stored layout the panels use. 0 = fill the middle.
   */
  const boardSize = dock.board || { w: 0, h: 0 };
  const dockDrag = useDockDrag(applyDock);
  const [panelsMenu, setPanelsMenu] = useState(false);
  /** Bring a panel into view wherever it currently lives — the zone on a desktop, the sheet on
   *  a phone — and reopen it if it had been closed. Every "go and look at X" goes through it. */
  const showPanel = useCallback((id) => {
    applyDock((l) => (zoneOf(l, id) ? l : movePanel(l, id, 'left')));
    setPane(id);
  }, [applyDock]);
  /** The phone's tab row: pressing the panel you are already on puts the canvas back. */
  const togglePane = useCallback((id) => setPane((cur) => (cur === id ? 'canvas' : id)), []);
  // Saved components: the author's own, per account, read once and written on every change.
  const [components, setComponents] = useState([]);
  const [compOpen, setCompOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    api.get('/me/studio/components')
      .then((r) => { if (alive) setComponents(normalizeComponents(r?.components)); })
      .catch(() => { /* signed out, or offline: the panel simply starts empty */ });
    return () => { alive = false; };
  }, []);
  /**
   * The first-run tour. Not on a window that is refusing to draw the studio at all: a tour of
   * three panes that are not on screen names nothing.
   */
  const tour = useStudioTour(!tooSmall);
  const persistComponents = useCallback(async (next) => {
    setComponents(next);
    try { await api.put('/me/studio/components', { components: next }); }
    catch { toast.error(t('cst.cmp.savefail', 'The component list could not be saved.')); }
  }, [t, toast]);
  /**
   * Which theme this canvas is being AUTHORED for.
   *
   * A page is read on a light background and a dark one, and a hero built for one is not the
   * same picture on the other. Editing "dark" writes a partial overlay onto the selected
   * blocks — only the fields actually changed — instead of a second copy of the page, so a
   * later edit to the base still reaches both unless it was deliberately overridden.
   *
   * `base` is the light layout AND the fallback for anything dark does not override; the two
   * are the same thing on purpose, because a canvas with no dark overlay at all must render
   * identically in both, not empty in one.
   */
  const [editTheme, setEditTheme] = useState('light');
  // The preview follows the board being authored, which is what lets the bar carry one phone
  // instead of two. Only while a preview is actually open: switching boards must not open one.
  useEffect(() => {
    setPreview((p) => (!p ? p : (editTheme === 'phone' ? 'phone' : (p === 'phone' ? 'desktop' : p))));
  }, [editTheme]);
  const [guides, setGuides] = useState({ v: null, h: null });
  const hostRef = useRef(null);
  const [vw, setVw] = useState(DESIGN_WIDTH);
  // A drag in flight. In a ref, not state: it is written on every pointermove and re-rendering
  // the whole canvas to store a mouse position would make dragging stutter on a big page.
  const drag = useRef(null);
  // Undo lives here rather than in the parent: the parent owns the value, but only this
  // component knows where one GESTURE starts and ends, and that is what an undo step is.
  //
  // In a REF, so frame N+1 reads exactly what frame N wrote, with no dependence on when a
  // state update commits. Coalescing is the reason it matters: a drag pushes on every
  // pointermove and the decision "same gesture?" is made against the previous push.
  //
  // Note the rule it relies on — a gesture ends after COALESCE_MS of IDLENESS. If a frame
  // ever took longer than that, each one would start its own undo entry. Pointer devices
  // deliver frames every ~16ms so there is a wide margin; the only place it has been seen is
  // a test harness re-rendering an entire app per frame, at ~1s each.
  const histRef = useRef(emptyHistory());
  // A counter purely to re-render the toolbar, whose buttons enable on the depth. The history
  // itself is never read from state.
  const [, bumpHist] = useState(0);
  const hist = histRef.current;
  const setHist = useCallback((next) => {
    histRef.current = typeof next === 'function' ? next(histRef.current) : next;
    bumpHist((n) => n + 1);
  }, []);

  const [vh, setVh] = useState(0);
  useEffect(() => {
    const el = hostRef.current; if (!el) return undefined;
    const read = () => { setVw(el.clientWidth || DESIGN_WIDTH); setVh(el.clientHeight || 0); };
    read();
    if (typeof ResizeObserver === 'undefined') { window.addEventListener('resize', read); return () => window.removeEventListener('resize', read); }
    const ro = new ResizeObserver(read); ro.observe(el); return () => ro.disconnect();
    // Re-run when the board (un)mounts: in page mode the host is not there while a preview or
    // a sheet is up, and the ref would otherwise be read once, on nothing.
  }, [preview, pane]);

  // The editor always works on the SCALED plane, never stacked: you cannot place things on a
  // layout that has given up on placement. `layoutFor` is asked for the scale so the editor
  // and the page agree, but the stacking decision is the page's alone.
  // Which board: the 1200px desktop plane, or the 390px phone board. Everything that clamps
  // or scales reads this rather than DESIGN_WIDTH.
  const phoneBoard = editTheme === 'phone';
  // The FRAME being edited: the 1200px page (light and dark share it) or the 390px phone. The
  // board around it is infinite; the frame is what a reader gets.
  const frame = boardFrame(canvas, editTheme);
  const boardW = frame.w;
  const boardH = frame.h;
  const frameRef = useRef(frame); frameRef.current = frame;
  const fitView = fitFrameView(frame, vw, vh);
  const fitScale = fitView.s;
  // The camera in use: the fitted one while "fit" is on, the author's own once they zoomed or
  // panned. Every pointer is converted to the board through THIS (toBoard), never through a
  // scroll offset: there is no scrolling left.
  const camView = cam.fit ? fitView : cam;
  const scale = camView.s;
  const zoom = cam.fit ? 'fit' : cam.s;
  /** Zoom to a level, about the centre of the pane; 'fit' fits the frame again. */
  const setZoom = (z) => {
    if (z === 'fit') { setCam({ ...fitView, fit: true }); return; }
    setCam({ ...zoomAt(camView, (vw || DESIGN_WIDTH) / 2, (vh || 0) / 2, Number(z)), fit: false });
  };
  /** Everything: the frame and every block, parked ones included, whole in the pane. */
  const showAll = () => setCam({ ...showAllView(frame, view.blocks, vw || DESIGN_WIDTH, vh || 480), fit: false });
  // The author's grid step. Snapping, the drawn grid and the keyboard nudge all read it.
  const grid = canvas.grid || GRID;
  // The board and the panel both show the target being authored — resolveBlock and
  // phoneBoardBlocks are the SAME functions the public page uses, so "what the author sees"
  // cannot drift from what is served. On the phone board every block has a place, hand-placed
  // or laid in reading order under the placed ones.
  const view = useMemo(() => ({ ...canvas, blocks: boardBlocks(canvas, editTheme) }), [canvas, editTheme]);
  // Containers (phase 7a). The board's blocks by id (children in board coordinates, tree.js).
  const viewById = useMemo(() => new Map(view.blocks.map((b) => [b.id, b])), [view]);
  /** The container a drawn block is in ('' = the page; a broken link counts as the page). */
  const parentIdOf = (b) => (b && b.parent && !b.treeError ? b.parent : '');
  /** A block and the containers above it, nearest first. */
  const chainOf = (id) => {
    const out = []; let cur = viewById.get(id); let guard = 0;
    while (cur && guard++ <= MAX_DEPTH + 1) { out.push(cur); const p = parentIdOf(cur); cur = p ? viewById.get(p) : null; }
    return out;
  };
  /** What a press on block `id` selects: the block on its chain at the level being edited, or
   *  (outside the container being edited) its top-level block, back on the page. */
  const pickAt = (id) => {
    const chain = chainOf(id);
    const at = chain.find((x) => parentIdOf(x) === scope);
    return at ? { id: at.id, scope } : { id: chain[chain.length - 1]?.id || id, scope: '' };
  };
  // What the board draws: everything except the blocks in a tab the board is not showing. And
  // in which order: a container's blocks right after it, over it, whatever their own z says.
  const { drawn, stackAt } = useMemo(() => {
    const byId = viewById;
    const off = new Set();
    for (const b of view.blocks) {
      const p = b.parent && !b.treeError ? byId.get(b.parent) : null;
      if (p?.kind === 'tabs' && (b.slot || 0) !== (editSlots[p.id] || 0)) off.add(b.id);
    }
    const kids = new Map();
    const roots = [];
    for (const b of view.blocks) {
      const p = b.parent && !b.treeError && byId.has(b.parent) ? b.parent : '';
      if (!p) roots.push(b); else { if (!kids.has(p)) kids.set(p, []); kids.get(p).push(b); }
    }
    const order = [];
    const walk = (list, guard) => {
      for (const b of paintOrder(list)) {
        if (off.has(b.id)) continue;
        order.push(b);
        if (guard <= MAX_DEPTH) walk(kids.get(b.id) || [], guard + 1);
      }
    };
    walk(roots, 0);
    return { drawn: order, stackAt: new Map(order.map((b, i) => [b.id, i])) };
  }, [view, viewById, editSlots]);
  /** Blocks a reader would not see on this board: entirely outside its frame. */
  const offIds = useMemo(() => offFrameIds(canvas, editTheme), [canvas, editTheme]);
  const sel = view.blocks.find((b) => b.id === selId) || null;
  /** Does this block say anything of its own on the dark theme? Drives the badge and Reset. */
  const rawSel = canvas.blocks.find((b) => b.id === selId) || null;
  const hasDark = !!(rawSel?.themes?.dark && Object.keys(rawSel.themes.dark).length);

  // Every change goes through here, and every change records an undo point FIRST — the state
  // as it was, keyed by the gesture, so a sixty-frame drag collapses into one entry.
  // What goes out is serializeDoc(), never the normalised canvas itself: normalisation
  // COMPUTES a frame's height when it follows its content, and writing that back pinned it,
  // so every block added afterwards was cut (PLAN-STUDIO-2026 bug A.1). A v2 document goes
  // out, whatever came in. Undo points are serialised the same way.
  const emit = useCallback((blocks, extra = {}, key = null) => {
    setHist((h) => pushHistory(h, serializeDoc(canvas), key));
    onChange(serializeDoc(canvas, { ...extra, blocks }));
  }, [canvas, onChange]);

  /**
   * Change one block — into the base, or into the theme overlay.
   *
   * On 'light' this writes the block itself, which is also the fallback for dark. On 'dark' it
   * writes ONLY the changed fields into `themes.dark`, which is what makes an overlay an
   * overlay: an author who nudged the hero on dark has not frozen its width there, and a later
   * change to the base width still reaches the dark version.
   *
   * `props` merge rather than replace for the same reason — a dark overlay that set the
   * background must not take the alt text and the fit mode with it.
   */
  const patch = useCallback((id, drawnNext, key = null) => {
    // The board works in board coordinates; a block in a container stores its place relative
    // to it (phase 7a, tree.js). The phone board has no children of its own to convert.
    const next = editTheme === 'phone' ? drawnNext : toStored(viewById, id, drawnNext);
    if (editTheme === 'light') {
      emit(canvas.blocks.map((b) => (b.id === id ? { ...b, ...next } : b)), {}, key);
      return;
    }
    if (editTheme === 'phone') {
      // Geometry goes to the phone overlay; everything else (content, an animation, a
      // button's action) is the block's own and has one copy, whichever board it was typed on.
      const { x, y, w, h, ...rest } = next;
      const geo = {};
      if (x != null) geo.x = x; if (y != null) geo.y = y; if (w != null) geo.w = w; if (h != null) geo.h = h;
      emit(canvas.blocks.map((b) => (b.id === id ? { ...b, ...rest, phone: { ...(b.phone || {}), ...geo } } : b)), Object.keys(geo).length ? { phoneBoard: true } : {}, key);
      return;
    }
    emit(canvas.blocks.map((b) => {
      if (b.id !== id) return b;
      const cur = b.themes?.dark || {};
      const { props: nextProps, ...rest } = next;
      return {
        ...b,
        themes: {
          ...(b.themes || {}),
          dark: { ...cur, ...rest, ...(nextProps ? { props: { ...(cur.props || {}), ...nextProps } } : {}) },
        },
      };
    }), {}, key);
  }, [canvas.blocks, emit, editTheme, viewById]);

  /**
   * Commit a whole-canvas move (group drag, keyboard nudge) under the theme being authored.
   *
   * moveMany() works on positions and returns a full block list, so it cannot know about the
   * overlay — and used directly it wrote a DARK drag into the base layout, moving the light
   * version too. Single-block drag and resize never had the bug because they already went
   * through patch(); these two were the paths that did not.
   *
   * On dark, only the blocks whose position actually changed get an overlay: a group drag of
   * five blocks where two were clamped against the edge must not pin the other three.
   */
  const commitMoved = useCallback((nextBlocks, key) => {
    const by = new Map(nextBlocks.map((b) => [b.id, b]));
    if (editTheme === 'light') {
      // `nextBlocks` are the board's blocks (a child in board coordinates): only what moved is
      // written, back in its container's coordinates (phase 7a).
      emit(canvas.blocks.map((b) => {
        const n = by.get(b.id); const v = viewById.get(b.id);
        if (!n || !v || (n.x === v.x && n.y === v.y)) return b;
        return { ...b, ...toStored(viewById, b.id, { x: n.x, y: n.y }) };
      }), {}, key);
      return;
    }
    if (editTheme === 'phone') {
      // A group drag on the phone board pins every moved block's phone place — including one
      // that was only laid there by reading order, which is now a decision of the author's.
      emit(canvas.blocks.map((b) => {
        const nb = by.get(b.id);
        if (!nb) return b;
        return { ...b, phone: { ...(b.phone || {}), x: nb.x, y: nb.y, w: nb.w, h: nb.h } };
      }), { phoneBoard: true }, key);
      return;
    }
    emit(canvas.blocks.map((b) => {
      const n = by.get(b.id);
      const v = viewById.get(b.id);
      if (!n || !v || (n.x === v.x && n.y === v.y)) return b;
      const st = toStored(viewById, b.id, { x: n.x, y: n.y });
      return { ...b, themes: { ...(b.themes || {}), dark: { ...(b.themes?.dark || {}), x: st.x, y: st.y } } };
    }), {}, key);
  }, [canvas.blocks, emit, editTheme, viewById]);

  const doUndo = useCallback(() => {
    // What goes into the redo list is the STORED document (serializeDoc), like every undo
    // point: the normalised one carries derived fields (height, bgNote...) that a save refuses,
    // so an undo followed by a redo used to leave a page the server would not take (phase 7b).
    const r = undoHist(hist, serializeDoc(canvas));
    if (r) { setHist(r.hist); onChange(r.value); }
  }, [hist, canvas, onChange]);
  const doRedo = useCallback(() => {
    const r = redoHist(hist, serializeDoc(canvas));
    if (r) { setHist(r.hist); onChange(r.value); }
  }, [hist, canvas, onChange]);

  // Where a new thing lands: below everything already there, so it never arrives hidden
  // under a block.
  const nextY = () => canvas.blocks.filter((b) => isPageRoot(b) && inFrame(b, { w: DESIGN_WIDTH, h: Infinity })).reduce((m, b) => Math.max(m, b.y + b.h), 0) + 24;
  // A block that was just added, to bring into view once it is drawn.
  const [revealId, setRevealId] = useState(null);
  // Brought into view once drawn: a block added at the bottom of a long page used to arrive
  // out of sight, which reads as "nothing happened".
  // The board does not scroll, so "into view" is a camera move, and only when the block is
  // not already on screen (revealView hands back the same view then, and fit stays on).
  useEffect(() => {
    if (!revealId) return;
    const b = view.blocks.find((x) => x.id === revealId);
    const host = hostRef.current;
    if (b && host && host.clientWidth && host.clientHeight) {
      const w = host.clientWidth; const h = host.clientHeight;
      setCam((c) => {
        const base = c.fit ? fitFrameView(frameRef.current, w, h) : c;
        const next = revealView(base, b, w, h);
        return next === base ? c : { ...next, fit: false };
      });
    }
    setRevealId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealId, canvas]);
  /** New blocks (add, paste, component): placed on the board being EDITED (placeOnBoard), so
   *  on the phone board they get a phone place instead of landing at the bottom of the desktop
   *  page and out of view (bug A.2). */
  const addBlocks = (fresh, extra = {}) => {
    if (!fresh.length) return;
    const out = placeOnBoard(canvas, fresh, editTheme);
    emit(out.blocks, { ...out.extra, ...extra });
    // What was added at the top of what was added (a container's own blocks come with it).
    const freshIds = new Set(fresh.map((b) => b.id));
    const tops = fresh.filter((b) => !b.parent || !freshIds.has(b.parent));
    setScope(tops[0]?.parent || '');
    setSelIds(tops.map((b) => b.id));
    setRevealId(tops[0].id);
    if (!wide) setPane('canvas');
  };
  // Phase 7c: export, import and paste (studio-io.js); every rule is the package's (io.js).
  const io = useStudioIO({ t, toast, dialog, canvas, emit, addBlocks, pages, componentMode, uid });
  /**
   * Add a block. Inside a container being edited (phase 7a) it lands in that container (in the
   * tab the board shows), when the container can take one more level; otherwise on the page. A
   * tab card arrives with a text block in each of its tabs, a dialog with one text block, placed
   * beside the page: a dialog is never part of the page's flow.
   */
  const add = (kind, over = {}) => {
    const base = NEW_BLOCK[kind];
    const spec = { ...base, ...over, props: { ...(base.props || {}), ...(over.props || {}) } };
    const host = scope && !phoneBoard ? canvas.blocks.find((b) => b.id === scope) : null;
    const hostBox = host ? innerBox(host) : null;
    const levels = isContainer(kind) ? 1 : 0;
    const inside = host && kind !== 'modal' && treeIndex(canvas.blocks).depthOf(host.id) + 1 + levels <= MAX_DEPTH;
    const id = uid();
    let block;
    if (inside) {
      const w = Math.min(spec.w, hostBox.w); const h = Math.min(spec.h, hostBox.h);
      block = { id, x: Math.min(16, hostBox.w - w), y: Math.min(16, hostBox.h - h), z: canvas.blocks.length, ...spec, w, h, parent: host.id,
        ...(host.kind === 'tabs' && (editSlots[host.id] || 0) > 0 ? { slot: editSlots[host.id] } : {}) };
    } else if (kind === 'modal') {
      const n = canvas.blocks.filter((b) => b.kind === 'modal').length;
      block = { id, x: DESIGN_WIDTH + 80, y: 40 + n * (spec.h + 40), z: canvas.blocks.length, ...spec };
    } else {
      block = { id, x: 64, y: nextY(), z: canvas.blocks.length, ...spec };
    }
    const kids = [];
    if (kind === 'tabs') {
      const labels = [t('cst.tabs.label', 'Tab {n}').replace('{n}', '1'), t('cst.tabs.label', 'Tab {n}').replace('{n}', '2')];
      block.props = { ...block.props, tabs: labels };
      labels.forEach((l, i) => kids.push({ id: uid(), kind: 'text', x: 16, y: 16, w: Math.max(40, block.w - 32), h: Math.max(40, Math.min(120, block.h - TAB_STRIP_H - 32)), z: i,
        parent: id, ...(i > 0 ? { slot: i } : {}), props: { md: `## ${l}` } }));
    } else if (kind === 'modal') {
      block.props = { ...block.props, title: t('cst.modal.new', 'A dialog') };
      kids.push({ id: uid(), kind: 'text', x: 24, y: 24, w: Math.max(40, block.w - 48), h: Math.max(40, block.h - 48), z: 0, parent: id,
        props: { md: t('cst.modal.body', 'What the dialog says. Open it from a button, with the step “Open a dialog”.') } });
    }
    addBlocks([block, ...kids]);
  };
  const addShape = (shape) => add('shape', { props: { shape, fill: 'var(--primary)', corner: 16 } });

  const chosen = canvas.blocks.filter((b) => selIds.includes(b.id));
  // Offset on the board being edited: on the phone the copy no longer lands exactly on its
  // original, and its desktop copy is no longer squeezed into 390px (bug A.2).
  const duplicate = () => {
    if (!chosen.length) return;
    const out = duplicateOnBoard(canvas, selIds, editTheme, uid);
    emit(out.blocks, out.extra);
    setSelIds(out.ids);
  };
  // A locked block survives Delete — the lock is there so a finished background cannot be
  // taken out by a keypress meant for whatever sits on it.
  // By EXPLICIT ids: the phone list's trash used to set the selection and call remove() in the
  // same handler, and remove() read the OLD selection from its closure, so it deleted nothing
  // or the wrong block (bug A.4).
  const removeIds = (ids) => {
    if (!ids.length) return;
    // A container goes with everything in it (phase 7a): a block left pointing at a container
    // that is gone would be a broken link, invisible to every visitor.
    const gone = new Set();
    for (const id of ids) {
      if (canvas.blocks.find((b) => b.id === id)?.locked) continue;
      gone.add(id);
      for (const d of descendantIds(canvas.blocks, id)) gone.add(d);
    }
    emit(canvas.blocks.filter((b) => !gone.has(b.id)));
    setSelIds((cur) => cur.filter((x) => !gone.has(x)));
    if (gone.has(scope)) setScope('');
  };
  const remove = () => removeIds(chosen.map((b) => b.id));
  const setGrid = (n) => emit(canvas.blocks, { grid: n });
  // On the board being EDITED: aligning on the phone moved the desktop page (bug A.2).
  const doAlign = (how) => { const out = alignOnBoard(canvas, selIds, how, editTheme); emit(out.blocks, out.extra); };
  const doDistribute = (axis) => { const out = distributeOnBoard(canvas, selIds, axis, editTheme); emit(out.blocks, out.extra); };
  const zoomBy = (dir) => setZoom(stepZoom(zoom, dir, fitScale));
  /**
   * Front and back for the WHOLE selection.
   *
   * The two buttons existed, in the inspector, and only ever moved one block — the inspector
   * has a single `sel`, so with four blocks picked they silently did nothing to three of them.
   * `bringTo` is applied per id in selection order, which is what keeps a group's own stacking
   * intact instead of collapsing it to whatever the last call decided.
   */
  const doZ = (where) => {
    if (!selIds.length) return;
    const ordered = paintOrder(canvas.blocks).filter((b) => selIds.includes(b.id)).map((b) => b.id);
    emit(ordered.reduce((list, id) => bringTo(list, id, where), canvas.blocks));
  };
  /**
   * Give every selected block the width (or height) of the first one picked.
   *
   * The alignment row could line four cards up on their left edge and there was no way to make
   * them the same size, so "aligned" still looked wrong — and typing the number into the
   * inspector four times is the gesture this replaces. The FIRST of the selection is the model
   * because that is the one the author clicked deliberately; the rest were shift-clicked onto it.
   */
  const matchSize = (axis) => {
    if (selIds.length < 2) return;
    const out = matchSizeOnBoard(canvas, selIds, axis, editTheme);
    emit(out.blocks, out.extra);
  };
  /** Lock or hide the whole selection. The state flipped is the FIRST block's, so a mixed
   *  selection lands on one answer instead of inverting each block against itself. */
  const toggleFlag = (flag) => {
    if (!selIds.length) return;
    const next = !canvas.blocks.find((b) => b.id === selIds[0])?.[flag];
    emit(canvas.blocks.map((b) => (selIds.includes(b.id) ? { ...b, [flag]: next } : b)));
  };

  /**
   * Stagger the selection: the same animation, arriving one after the other.
   *
   * Six cards that all rise at once read as one slab moving; the same six 80ms apart read as
   * a list being dealt. Doing it by hand was six visits to the inspector to type 0, 80, 160,
   * 240, 320, 400 — which is why nobody did it.
   *
   * The order is the one a reader's eye takes (top to bottom, then left to right within a
   * band), NOT the paint order, because the paint order is z and has nothing to do with where
   * a block sits. A block with no animation yet gets the default entrance so the step has
   * something to space out; one that already has an animation keeps its kind, curve and
   * duration and only its delay is rewritten. Step 0 puts them all back together.
   */
  const stagger = (step) => {
    if (selIds.length < 2) return;
    const chosenNow = canvas.blocks.filter((b) => selIds.includes(b.id));
    const band = 40;
    const ordered = chosenNow.slice().sort((p, q) => (
      (Math.floor(p.y / band) - Math.floor(q.y / band)) || (p.x - q.x) || (p.y - q.y)
    ));
    const delays = new Map(ordered.map((b, i) => [b.id, i * step]));
    emit(canvas.blocks.map((b) => (delays.has(b.id)
      ? { ...b, anim: { kind: 'rise', trigger: 'show', duration: 700, ...(b.anim || {}), delay: delays.get(b.id) } }
      : b)));
  };

  // ── Components ────────────────────────────────────────────────────────────
  // The selection, kept under a name; a copy of a kept one; the link forgotten; every copy
  // rebuilt from the definition. The arithmetic is lib/studio-components.js, tested there.
  // A component or a section preset is a set of PAGE blocks (phase 7b brings containers to
  // them): a block picked inside a container is kept where it is drawn, as a page block, and
  // a selection holding a container is refused with the reason rather than saved half.
  const chosenFlat = chosen.map((b) => {
    const v = viewById.get(b.id) || b;
    const { parent: _p, slot: _s, treeError: _e, ...rest } = b;
    return { ...rest, x: v.x, y: v.y };
  });
  // Phase 7b: a container comes WITH what it holds (the 7a refusal is gone); the tree inside is
  // the package's to check (definitionTreeProblems, and the API's validateDoc at save).
  const chosenInner = (() => {
    const under = new Set(selIds.flatMap((id) => descendantIds(canvas.blocks, id)));
    return canvas.blocks.filter((b) => under.has(b.id) && !selIds.includes(b.id));
  })();
  const lib = pages?.library || null;
  /** Where "Save as component" may keep the selection: a library (linked copies), or the
   *  author's own list (plain copies, rebuilt by "Update all copies", as before phase 7b). */
  const componentDestinations = [
    ...(lib?.canWrite?.project ? [{ id: 'project', label: t('cst.cmp7.dest.page', 'This page’s library'), hint: t('cst.cmp7.dest.page.h', 'Linked copies. Every studio holder of this page can place and edit it.') }] : []),
    ...(lib?.canWrite?.site ? [{ id: 'site', label: t('cst.cmp7.dest.site', 'Site library'), hint: t('cst.cmp7.dest.site.h', 'Linked copies, for every studio page of the site.') }] : []),
    { id: 'user', label: t('cst.cmp7.dest.user', 'My components'), hint: t('cst.cmp7.dest.user.h', 'Your own list. Its copies are plain blocks, rebuilt by “Update all copies”.') },
  ];
  const saveComponent = async (name, dest = 'user') => {
    if (dest === 'user') {
      if ([...chosen, ...chosenInner].some((b) => b.kind === 'instance')) { toast.error(t('cst.cmp7.nouser', 'A linked copy cannot go into your own list: keep this in a library instead.')); return; }
      const comp = componentFromBlocks(name, [...chosenFlat, ...chosenInner], uid);
      if (!comp) return;
      if (components.length >= COMPONENT_LIMITS.count) { toast.error(t('cst.cmp.full', 'You have reached the limit of saved components, delete one first.')); return; }
      persistComponents([comp, ...components]);
      setCompOpen(false);
      showPanel('components');
      toast.success(t('cst.cmp.saved', 'Component saved.'));
      return;
    }
    if (!lib) return;
    const def = definitionFromBlocks(canvas.blocks, selIds, canvas.components || {});
    if (!def) { toast.error(t('cst.cmp7.bad', 'Select blocks of one container (or of the page), at most 40 blocks with what they hold.')); return; }
    if (definitionTreeProblems(def.doc).length) { toast.error(t('cst.cmp7.deep', 'This selection holds containers too deep to be a component: three levels at most, with the copy’s own.')); return; }
    const entry = { id: `cp${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, sort: 'component', doc: def.doc, exposed: def.exposed, createdAt: new Date().toISOString() };
    const ok = await lib.save(entry, dest === 'site' ? 'site' : 'project', { quiet: true });
    if (!ok) return;
    const snap = snapshotOf(entry, dest === 'site' ? 'site' : (lib.targetScope || 'project'), dest === 'site' ? '' : (lib.targetRef || ''));
    const r = replaceWithInstance(canvas.blocks, selIds, canvas.components || {}, entry.id, snap, def, uid);
    emit(r.blocks, { components: r.components });
    setScope(def.parent || '');
    setSelIds([r.id]);
    setCompOpen(false);
    showPanel('components');
    toast.success(t('cst.cmp7.saved', 'Component saved. The selection is now a linked copy of it.'));
  };
  /** The library's version of a component this page uses, when this studio reads its library. */
  const sourceOf = (snap, cid) => {
    if (!lib || !snap) return null;
    if (snap.scope === 'site') return lib.entries.find((e) => e.scope === 'site' && e.sort === 'component' && e.id === cid) || null;
    if (snap.scope !== (lib.targetScope || 'project') || String(snap.ref || '') !== String(lib.targetRef || '')) return null;
    return lib.entries.find((e) => e.scope === 'project' && e.sort === 'component' && e.id === cid) || null;
  };
  /** A linked copy of a library component, placed below the page's content. */
  const insertLinked = (entry) => {
    const site = entry.scope === 'site';
    const r = instanceFromEntry(entry, { x: 64, y: nextY() }, canvas.blocks.length, uid, site ? 'site' : (lib?.targetScope || 'project'), site ? '' : (lib?.targetRef || ''));
    if (!r) return;
    // The page already holds this component: the new copy is one more of the SAME version as
    // the others ("Update the copies" is the one way a new version arrives).
    const has = canvas.components && canvas.components[entry.id];
    addBlocks([r.block], { components: has ? canvas.components : withSnapshot(canvas.components, entry.id, r.snap, r.deps) });
  };
  /** "Update the copies": the library's version of `cid` put on this page, overrides kept. */
  const updateCopiesOf = (cid) => {
    const snap = canvas.components?.[cid];
    const src = sourceOf(snap, cid);
    if (!snap || !src) return;
    const prevTags = new Map(instancesOfComponent(canvas.blocks, cid).map((b) => [b.id, b.component]));
    const r = updateCopies(canvas.blocks, canvas.components, cid, snapshotOf(src, snap.scope, snap.ref), src.doc?.components || null);
    emit(r.blocks, { components: r.components });
    const n = prevTags.size;
    toast.action({
      tone: 'success', cancelLabel: t('common.undo', 'Undo'),
      msg: `${t('cst.cmp7.updated', '{n} copy(ies) updated; the fields each one changed are kept.').replace('{n}', String(n))}${r.dropped ? ` ${t('cst.cmp7.dropped', '{n} change(s) to fields the component no longer offers were dropped.').replace('{n}', String(r.dropped))}` : ''}`,
      onCommit: () => {},
      onCancel: () => revertCopiesRef.current?.(cid, snap, prevTags),
    });
  };
  // The undo of "Update the copies": that component's version and its copies' overrides as they
  // were, on the page as it is now (anything else changed since stays).
  revertCopiesRef.current = (cid, snap, tags) => {
    emit(canvas.blocks.map((b) => (tags.has(b.id) && b.kind === 'instance' ? { ...b, component: tags.get(b.id) } : b)),
      { components: { ...(canvas.components || {}), [cid]: snap } });
  };
  const openComponent = (cid, snap) => {
    if (!pages?.openComponent || !snap || snap.scope === 'user') return;
    pages.openComponent(snap.scope, snap.ref || '', cid);
  };
  const instanceTools = {
    snapOf: (b) => (b?.component ? canvas.components?.[b.component.id] || null : null),
    stale: (b) => { const s = b?.component ? canvas.components?.[b.component.id] : null; const src = sourceOf(s, b?.component?.id); return !!src && snapshotDiffers(s, src); },
    onOverride: (id, key, value) => emit(setOverride(canvas.blocks, id, key, value), {}, value === undefined ? null : `ov-${id}-${key}`),
    onResetAll: (id) => emit(canvas.blocks.map((b) => (b.id === id && b.kind === 'instance' && b.component ? { ...b, component: { id: b.component.id } } : b))),
    onDetach: (id) => { emit(detachInstance(canvas.blocks, canvas.components || {}, id, uid)); setSelIds([]); },
    onUpdate: (b) => updateCopiesOf(b.component.id),
    onOpen: pages?.openComponent ? (b) => openComponent(b.component.id, canvas.components?.[b.component.id]) : null,
  };
  // Instantiated on the DESKTOP plane (it used to be squeezed into 390px when inserted on the
  // phone board), then placed on the board being edited.
  const insertComponent = (comp) => {
    addBlocks(instantiateComponent(comp, { x: 64, y: nextY() }, canvas.blocks.length, uid, DESIGN_WIDTH));
  };
  const deleteComponent = (id) => persistComponents(components.filter((c) => c.id !== id));

  // ── Presets (phase 6) ─────────────────────────────────────────────────────
  // A page preset makes a NEW page (the page list's create); the others land on this page: a
  // section as plain blocks, a component as a linked copy, a background on the page itself.
  const applyPreset = (entry) => {
    if (!entry) return;
    if (entry.sort === 'page') { pages?.create(entry); return; }
    if (entry.sort === 'background') {
      emit(canvas.blocks, { background: normalizeCanvas(entry.doc).background }, 'page-bg');
      toast.success(t('cst.pr.applied.bg', 'Background applied to this page.'));
      return;
    }
    // A component preset is a LINKED copy (phase 7b): one instance, the definition on the page.
    if (entry.sort === 'component') { insertLinked(entry); return; }
    addBlocks(blocksFromPreset(entry, { x: 64, y: nextY() }, canvas.blocks.length, uid));
  };
  const saveAsPreset = async (name, sort, scope) => {
    // Phase 7b: containers with what they hold, and the definitions of the copies it holds.
    const entry = presetEntry({ name, sort, canvas: serializeDoc(canvas), blocks: [...chosenFlat, ...chosenInner], background: canvas.background,
      components: canvas.components ? Object.fromEntries(Object.entries(canvas.components)) : null });
    if (!entry || !pages?.library) return false;
    return pages.library.save(entry, scope);
  };
  const detach = () => { if (!chosen.length) return; emit(detachBlocks(canvas.blocks, selIds)); };
  const refreshInstances = (compId) => {
    const comp = components.find((c) => c.id === compId);
    if (!comp) return;
    emit(updateInstances(canvas.blocks, comp, uid));
    setSelIds([]);
  };
  const redefine = (compId) => {
    const cur = components.find((c) => c.id === compId);
    const fresh = componentFromBlocks(cur?.name, chosen, uid);
    if (!cur || !fresh) return;
    const next = { ...cur, w: fresh.w, h: fresh.h, blocks: fresh.blocks };
    persistComponents(components.map((c) => (c.id === compId ? next : c)));
    emit(updateInstances(canvas.blocks, next, uid));
    setSelIds([]);
    toast.success(t('cst.cmp.redefined', 'Component updated, and every copy with it.'));
  };
  const selComponentIds = componentIdsIn(canvas.blocks, selIds);

  // ── Pointer ────────────────────────────────────────────────────────────────
  // Pointer events, not mouse: one code path covers a trackpad, a mouse and a stylus, and
  // setPointerCapture means a fast drag that leaves the block (or the window) still tracks
  // instead of dropping it wherever the pointer left.
  const onDown = (e, b, handle) => {
    // A pan gesture that starts ON a block is still a pan: the middle button, space held or
    // the Hand tool. Left to bubble to the board, which starts it.
    if (e.button === 1 || spaceRef.current || panMode || pinchRef.current) return;
    e.preventDefault(); e.stopPropagation();
    // The block at the level being edited (phase 7a): a press on a block inside a container
    // takes the container, until the author goes into it (double-click). A press outside the
    // container being edited comes back out to the page. A resize handle is on the selection
    // itself, which is always at the level being edited.
    // A press on the empty area of the container being edited is a press on the board inside
    // it: left to bubble to the board, which starts a rubber band there.
    if (!handle && b.id === scope) return;
    if (!handle) {
      const picked = pickAt(b.id);
      if (picked.scope !== scope) { setScope(picked.scope); setSelIds([picked.id]); }
      b = viewById.get(picked.id) || b;
    }
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const sameLevel = pickAt(b.id).scope === scope;
    let ids;
    if (additive && sameLevel) ids = selIds.includes(b.id) ? selIds.filter((x) => x !== b.id) : [...selIds, b.id];
    // A plain press on a block that is ALREADY part of the selection keeps the group. Without
    // this, grabbing a selected block to drag the group instead collapses the selection to
    // that one block and only it moves — which is the single most annoying way to get
    // multi-select wrong.
    else ids = selIds.includes(b.id) && sameLevel ? selIds : [b.id];
    setSelIds(ids);
    // Locked: selectable (the panel still edits it), never dragged or resized.
    if (b.locked) return;
    const startBB = boundsOf(view.blocks.filter((x) => ids.includes(x.id)));
    drag.current = { id: b.id, ids, handle, sx: e.clientX, sy: e.clientY, start: { ...b }, startBB };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => {
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.sx; const dy = e.clientY - d.sy;
    d.moved = true;
    // The guides compare with the blocks AS DRAWN on this board, not the desktop base.
    const others = view.blocks.filter((b) => b.id !== d.id);
    if (d.handle) {
      patch(d.id, resizeTo(d.start, d.handle, dx, dy, scale, { snap: snapOn, grid, width: boardW }), `resize:${d.id}:${d.handle}`);
      return;
    }
    if (d.ids && d.ids.length > 1) {
      // Resize is deliberately single-block; a group drag is the whole selection at once,
      // clamped as one box so the arrangement cannot collapse against an edge.
      commitMoved(moveMany(view.blocks, d.ids.filter((id) => !view.blocks.find((b) => b.id === id)?.locked), dx, dy, scale, { snap: snapOn, grid, startX: d.startBB?.x, startY: d.startBB?.y, width: boardW }), `drag:${d.ids.join(',')}`);
      return;
    }
    let next = dragTo(d.start, dx, dy, scale, { snap: snapOn, grid, width: boardW });
    // Alignment to the other blocks, on top of the grid. This is what makes a hand-placed
    // page look composed rather than approximately aligned.
    if (snapOn) {
      const g = alignmentGuides({ ...d.start, ...next }, others);
      if (g.v) next = { ...next, x: next.x + g.v.delta };
      if (g.h) next = { ...next, y: next.y + g.h.delta };
      setGuides(g);
    }
    // On the phone the size goes with the first move, so an unplaced block keeps the width it
    // is drawn at (bug A.3).
    patch(d.id, dragPatch(d.start, next, editTheme), `drag:${d.id}`);
  };
  const onUp = (e) => {
    const d = drag.current;
    drag.current = null; setGuides({ v: null, h: null });
    if (!d || !d.moved || !e) return;
    // Containers (phase 7a), once the gesture is over. Same undo key as the gesture, so one
    // Ctrl+Z takes back the drag and what the drop did.
    if (d.handle) {
      // A container resized over its own blocks: the ones now entirely outside come back in
      // (the save would refuse them, tree.js `outside_parent`).
      if (editTheme === 'light' && isContainer(viewById.get(d.id)?.kind)) {
        const next = pullChildrenInside(canvas.blocks, d.id);
        if (next.some((b, i) => b !== canvas.blocks[i])) emit(next, {}, `resize:${d.id}:${d.handle}`);
      }
      return;
    }
    // A drop: into the deepest container under the pointer that can take the blocks, or out of
    // the one they were in, onto the page. On the light board only: the dark board moves the
    // dark variant, which has no container of its own, and the phone board has no children.
    if (editTheme !== 'light') return;
    const ids = (d.ids && d.ids.length ? d.ids : [d.id]).filter((id) => viewById.has(id) && !viewById.get(id).locked);
    if (!ids.length) return;
    const pt = toBoard(camView, hostPoint(e).x, hostPoint(e).y);
    const exclude = new Set(ids.flatMap((id) => [id, ...descendantIds(canvas.blocks, id)]));
    const extra = Math.max(0, ...ids.map((id) => subtreeHeight(canvas.blocks, id)));
    const moving = ids.map((id) => viewById.get(id));
    const target = dropTarget(drawn, pt, { exclude, extra, movingModal: moving.some((b) => b.kind === 'modal'), visible: new Set(drawn.map((b) => b.id)) });
    if (target === parentIdOf(moving[0])) return;
    const tb = target ? viewById.get(target) : null;
    emit(reparentBlocks(canvas.blocks, view.blocks, ids, target, tb?.kind === 'tabs' ? (editSlots[target] || 0) : 0), {},
      ids.length > 1 ? `drag:${d.ids.join(',')}` : `drag:${d.id}`);
    setScope(target);
  };
  // The handler the memoised blocks hold never changes; it reads the current one through a
  // ref. Without this every block re-rendered on every pointer move, because the closure
  // over `selIds` and `canvas` was new each time.
  const onDownRef = useRef(onDown); onDownRef.current = onDown;
  const stableDown = useCallback((e, b, h) => onDownRef.current(e, b, h), []);

  // ── Containers (phase 7a) ─────────────────────────────────────────────────────────
  /** Double-click: into the container at the level being edited, selecting what is under the
   *  pointer inside it. Escape comes back out (the keyboard handler below). */
  const enterAt = (e, b) => {
    if (phoneBoard || b.id === scope) return;
    const chain = chainOf(b.id);
    const i = chain.findIndex((x) => parentIdOf(x) === scope);
    const at = i >= 0 ? chain[i] : null;
    if (!at || !isContainer(at.kind) || at.treeError) return;
    e.stopPropagation();
    setScope(at.id);
    setSelIds(i > 0 ? [chain[i - 1].id] : []);
  };
  const enterRef = useRef(enterAt); enterRef.current = enterAt;
  const stableEnter = useCallback((e, b) => enterRef.current(e, b), []);
  /** Which tab of a tab card the board shows (and where added or dropped blocks go). */
  const setSlot = useCallback((id, i) => setEditSlots((cur) => ({ ...cur, [id]: i })), []);
  /** Ctrl+G: the selection (blocks of one container) into a new group drawn around them. */
  const groupSel = () => {
    if (!selIds.length || phoneBoard) return;
    const gid = uid();
    const next = groupBlocks(canvas.blocks, selIds, gid);
    if (!next) { toast.error(t('cst.group.no', 'These blocks cannot be grouped: pick blocks of the same container, no dialog, at most three containers deep.')); return; }
    emit(next);
    setSelIds([gid]);
  };
  /** Ctrl+Shift+G: a group's blocks go up to its container, where they are; the group goes. */
  const ungroupSel = () => {
    const g = selIds.length === 1 ? canvas.blocks.find((b) => b.id === selIds[0]) : null;
    if (!g || g.kind !== 'group') return;
    const kidsIds = canvas.blocks.filter((b) => b.parent === g.id && !b.treeError).map((b) => b.id);
    const next = ungroupBlocks(canvas.blocks, g.id);
    if (!next) return;
    emit(next);
    setSelIds(kidsIds);
  };
  /** The inspector's "container" field: block `id` into `target` ('' = the page), where it is. */
  const moveTo = (id, target, slot = 0) => {
    emit(reparentBlocks(canvas.blocks, boardBlocks(canvas, 'light'), [id], target, slot));
    setScope(target);
    setSelIds([id]);
    if (target && canvas.blocks.find((b) => b.id === target)?.kind === 'tabs') setSlot(target, slot);
  };
  /** A block chosen in the Layers tree: selected where it lives, its tab shown. */
  const selectFromTree = (id, additive) => {
    const b = canvas.blocks.find((x) => x.id === id);
    if (!b) return;
    const p = b.parent && !b.treeError ? b.parent : '';
    if (additive && p === scope) setSelIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
    else { setScope(p); setSelIds([id]); }
    if (p && canvas.blocks.find((x) => x.id === p)?.kind === 'tabs') setSlot(p, b.slot || 0);
  };
  const canGroup = !phoneBoard && selIds.length > 0 && !!groupBlocks(canvas.blocks, selIds, 'probe');
  const canUngroup = selIds.length === 1 && canvas.blocks.find((b) => b.id === selIds[0])?.kind === 'group';

  // ── Marquee ────────────────────────────────────────────────────────────────
  // Pressing empty canvas starts a rubber band; releasing selects everything it TOUCHED.
  // Without a threshold every plain click on the background would end as a zero-size marquee
  // and clear the selection twice, which is harmless but makes the deselect feel twitchy.
  const marqueeRef = useRef(null);
  // A pan in flight, and whether space is held. Both refs: a pan writes on every pointermove,
  // and re-rendering the board to remember a scroll offset would make it stutter.
  const panRef = useRef(null);
  const spaceRef = useRef(false);
  // Every pointer is read in the HOST's box and converted to the board through the camera
  // (toBoard). The border is part of getBoundingClientRect but not of the camera's space, so
  // it is taken off (clientLeft/Top) or the rubber band sits one pixel off the pointer.
  const hostPoint = (e) => {
    const host = hostRef.current; if (!host) return { x: 0, y: 0 };
    const r = host.getBoundingClientRect();
    return { x: e.clientX - r.left - (host.clientLeft || 0), y: e.clientY - r.top - (host.clientTop || 0) };
  };
  const onCanvasDown = (e) => {
    const host = hostRef.current; if (!host) return;
    if (pinchRef.current) return;
    // Panning, before anything else claims the press. Middle button, space held, or the Hand
    // tool: three ways in, one gesture. Two fingers are the fourth (the pinch, below).
    if (e.button === 1 || spaceRef.current || panMode) {
      e.preventDefault();
      panRef.current = { x: e.clientX, y: e.clientY, cam: camView };
      e.currentTarget.setPointerCapture?.(e.pointerId);
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;   // a right click selects nothing
    const p = toBoard(camView, hostPoint(e).x, hostPoint(e).y);
    marqueeRef.current = { x: p.x, y: p.y, additive: e.shiftKey || e.ctrlKey || e.metaKey, base: selIds };
    if (!marqueeRef.current.additive) setSelIds([]);
    // A press on the empty board, outside the container being edited, comes back to the page.
    const sc = scope ? viewById.get(scope) : null;
    if (sc && !(p.x >= sc.x && p.x <= sc.x + sc.w && p.y >= sc.y && p.y <= sc.y + sc.h)) { setScope(''); marqueeRef.current.base = []; }
  };
  const onMarqueeMove = (e) => {
    const p = panRef.current;
    if (p) {
      // From where the pan STARTED, like a drag: no accumulated rounding, no drift.
      setCam({ ...p.cam, x: p.cam.x + (e.clientX - p.x), y: p.cam.y + (e.clientY - p.y), fit: false });
      return;
    }
    const m = marqueeRef.current; if (!m) return;
    const q = toBoard(camView, hostPoint(e).x, hostPoint(e).y);
    const rect = { x: m.x, y: m.y, w: q.x - m.x, h: q.y - m.y };
    if (Math.abs(rect.w) * scale < 4 && Math.abs(rect.h) * scale < 4) return;   // a click, not a drag
    setMarquee(rect);
    // The rubber band tests the blocks as DRAWN on this board (bug A.2), at the level being
    // edited: the blocks of the container the author is in, or the page's own (phase 7a).
    const hit = blocksInRect(drawn.filter((b) => parentIdOf(b) === scope), rect).map((b) => b.id);
    setSelIds(m.additive ? [...new Set([...m.base, ...hit])] : hit);
  };
  const onMarqueeUp = () => { marqueeRef.current = null; panRef.current = null; setMarquee(null); };

  // ── Two fingers: pan and pinch as one gesture ─────────────────────────────────────
  // Touch pointers are tracked in the CAPTURE phase, before a block's own handler sees them:
  // the second finger may land on a block, and it must not start dragging it. From two
  // fingers on, the gesture belongs to the camera (pinchView, from where it started) and the
  // events stop at the board.
  const touches = useRef(new Map());
  const pinchRef = useRef(null);
  const onTouchDown = (e) => {
    if (e.pointerType !== 'touch') return;
    touches.current.set(e.pointerId, hostPoint(e));
    if (touches.current.size === 2) {
      const [a, b] = [...touches.current.values()];
      pinchRef.current = { cam: camView, a, b };
      drag.current = null; marqueeRef.current = null; panRef.current = null;
      setMarquee(null); setGuides({ v: null, h: null });
      e.stopPropagation();
    }
  };
  const onTouchMove = (e) => {
    if (e.pointerType !== 'touch' || !touches.current.has(e.pointerId)) return;
    touches.current.set(e.pointerId, hostPoint(e));
    const p = pinchRef.current;
    if (!p || touches.current.size < 2) return;
    e.stopPropagation();
    const [a, b] = [...touches.current.values()];
    setCam({ ...pinchView(p.cam, p.a, p.b, a, b), fit: false });
  };
  const onTouchEnd = (e) => {
    if (e.pointerType !== 'touch') return;
    touches.current.delete(e.pointerId);
    if (touches.current.size < 2) pinchRef.current = null;
  };

  // The wheel zooms about the pointer (wheelZoom keeps the board point under it still). A
  // native listener, because React's is passive and could not stop the page from scrolling.
  // The studio is a full page, so it owns the wheel.
  useEffect(() => {
    const host = hostRef.current; if (!host) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const r = host.getBoundingClientRect();
      const x = e.clientX - r.left - (host.clientLeft || 0); const y = e.clientY - r.top - (host.clientTop || 0);
      const w = host.clientWidth; const h = host.clientHeight;
      setCam((c) => ({ ...wheelZoom(c.fit ? fitFrameView(frameRef.current, w, h) : c, x, y, e.deltaY, e.deltaMode), fit: false }));
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => host.removeEventListener('wheel', onWheel);
    // Re-bound when the board (un)mounts, like the size observer above.
  }, [preview, pane]);

  // ── The page's own height ──────────────────────────────────────────────────
  // One key for the whole gesture, so a drag from 600 to 1400 is one undo step and not eight
  // hundred — the same rule every other drag in this file follows.
  const heightRef = useRef(null);
  const setBoardHeight = (n) => emit(canvas.blocks, phoneBoard
    ? { phoneHeight: Math.max(40, Math.round(n)) } : { height: Math.max(40, Math.round(n)) }, 'canvas-height');
  /** Give the frame's height back to its content (`fit: 'content'`): the opposite of the handle. */
  const fitFrameToContent = () => emit(canvas.blocks, { frames: { [phoneBoard ? 'phone' : 'desktop']: { fit: 'content' } } });
  const onHeightDown = (e) => {
    e.preventDefault(); e.stopPropagation();
    heightRef.current = { y: e.clientY, h: boardH };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onHeightMove = (e) => {
    const f = heightRef.current; if (!f) return;
    setBoardHeight(f.h + (e.clientY - f.y) / scale);
  };
  const onHeightUp = () => { heightRef.current = null; };
  const onHeightKey = (e) => {
    const by = { ArrowUp: -grid, ArrowDown: grid };
    if (by[e.key] == null) return;
    e.preventDefault(); e.stopPropagation();
    setBoardHeight(boardH + by[e.key]);
  };

  // Keyboard nudging. A mouse cannot reliably move a block by exactly one grid step, and
  // "almost aligned" is the thing this whole file exists to avoid.
  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;
      // Undo is checked BEFORE the selection guard and before the input guard: it must work
      // with nothing selected, and Ctrl+Z inside a textarea is the browser's own undo — which
      // is the right one for text, so it is left alone.
      if (mod && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault();
        if (e.shiftKey) doRedo(); else doUndo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y' && !typing) {
        e.preventDefault(); doRedo(); return;
      }
      // Save, where there is a save path to call.
      if (mod && e.key.toLowerCase() === 's' && chrome?.onSave) {
        e.preventDefault(); if (chrome.canSave !== false) chrome.onSave(); return;
      }
      if (mod && e.key.toLowerCase() === 'a' && !typing) {
        // Everything at the level being edited: the page's blocks, or the container's (phase 7a).
        e.preventDefault(); setSelIds(drawn.filter((b) => parentIdOf(b) === scope).map((b) => b.id)); return;
      }
      if (mod && e.key.toLowerCase() === 'g' && !typing) {
        e.preventDefault(); if (e.shiftKey) ungroupSel(); else groupSel(); return;
      }
      // Out of the container being edited, one level at a time (phase 7a); its container is
      // then the selection, so a second Escape goes up again or clears it.
      if (e.key === 'Escape' && !typing && scope) {
        e.preventDefault();
        const sc = canvas.blocks.find((b) => b.id === scope);
        setSelIds([scope]);
        setScope(sc && sc.parent && !sc.treeError ? sc.parent : '');
        return;
      }
      // Enter on a selected container goes into it, the keyboard's double-click. Only while the
      // focus is on the board or nowhere: Enter on a focused control is that control's.
      if (e.key === 'Enter' && !typing && !mod && selIds.length === 1) {
        const ae = document.activeElement;
        const onBoard = !ae || ae === document.body || !!hostRef.current?.contains(ae);
        const b = viewById.get(selIds[0]);
        if (onBoard && b && isContainer(b.kind) && !b.treeError && !phoneBoard) { e.preventDefault(); setScope(b.id); setSelIds([]); return; }
      }
      if (mod && e.key.toLowerCase() === 'd' && !typing) {
        e.preventDefault(); duplicate(); return;
      }
      // The paint order, for the whole selection. Ctrl+] / Ctrl+[ are the pair every other
      // design tool uses, and unlike Ctrl+L or Ctrl+T the browser leaves them to the page.
      if (mod && (e.key === ']' || e.key === '[') && !typing) {
        e.preventDefault(); doZ(e.key === ']' ? 'front' : 'back'); return;
      }
      // The view, on bare keys. Deliberately NOT Ctrl+= / Ctrl+- / Ctrl+0: those are the
      // browser's own zoom, which a page cannot take back, so binding them would have given
      // the author a shortcut that silently zooms the wrong thing.
      if (!typing && !mod) {
        // Space held = pan, the gesture every design tool has. Swallowed here so the page
        // does not scroll under the board while it is held.
        if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); spaceRef.current = true; return; }
        if (e.key === '?' || (e.shiftKey && e.key === '/')) { e.preventDefault(); setKeysOpen(true); return; }
        if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(1); return; }
        if (e.key === '-') { e.preventDefault(); zoomBy(-1); return; }
        if (e.key === '0') { e.preventDefault(); setZoom('fit'); return; }
        // Shift+1 (the design-tool convention): the whole board, parked blocks included.
        if (e.shiftKey && e.code === 'Digit1') { e.preventDefault(); showAll(); return; }
        if (e.key === '1') { e.preventDefault(); setZoom(1); return; }
        if (e.key.toLowerCase() === 'g') { e.preventDefault(); setShowGrid((v) => !v); return; }
        if (e.key.toLowerCase() === 'l' && selIds.length) { e.preventDefault(); toggleFlag('locked'); return; }
        if (e.key.toLowerCase() === 'h' && selIds.length) { e.preventDefault(); toggleFlag('hidden'); return; }
      }
      // Copy / paste: the selection as JSON, kept in a ref and offered to the clipboard so a
      // page can be assembled from another one open in a second tab.
      if (mod && e.key.toLowerCase() === 'c' && !typing && selIds.length) {
        // The selection at the board place it is drawn at, with everything inside a container
        // (phase 7a): pasted, the copies are page blocks, their own blocks inside them.
        const under = new Set(selIds.flatMap((id) => descendantIds(canvas.blocks, id)));
        const picked = canvas.blocks.filter((b) => selIds.includes(b.id) || under.has(b.id)).map((b) => {
          if (!selIds.includes(b.id)) return b;
          const v = viewById.get(b.id) || b;
          const { parent: _p, slot: _s, treeError: _e, ...rest } = b;
          return { ...rest, x: v.x, y: v.y };
        });
        // As STORED (serializeDoc): what the paste reads back is checked like a saved page, and a
        // normalised block carries fields no stored one has.
        clip.current = serializeDoc(canvas, { blocks: picked }).blocks;
        // A refusal (an unfocused document, no permission) is a REJECTED promise, not a throw.
        try { navigator.clipboard?.writeText(JSON.stringify({ bcwBlocks: clip.current }))?.catch?.(() => {}); } catch { /* no clipboard: the ref still works */ }
        return;
      }
      if (mod && e.key.toLowerCase() === 'v' && !typing) {
        // The clipboard is outside input (S8): it goes through the SAME reader as an imported
        // file (phase 7c, io.js parseBlocksPaste: size, reserved keys, validateDoc, off-site
        // pictures), then gets fresh ids, a copied container's blocks inside the copy of it. A
        // text that is not a paste of blocks falls back to what this tab copied.
        e.preventDefault();
        const fromTab = () => { if (clip.current.length) io.pasteBlocks(clip.current); };
        const read = navigator.clipboard?.readText?.();
        if (!read) { fromTab(); return; }
        read.then(async (txt) => { if (!(await io.pasteBlocks(txt))) fromTab(); }).catch(fromTab);
        return;
      }
      if (!selIds.length) return;
      if (typing) return;   // typing, not nudging
      // One grid step, or ten with Shift: the second gesture is for crossing the page, and
      // the multiplier is a round number so the destination is predictable.
      const step = e.shiftKey ? grid * 10 : grid;
      const map = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (map[e.key]) {
        e.preventDefault();
        // The whole selection, at scale 1 because a nudge is in DESIGN pixels — it is the
        // gesture for "exactly one grid step", which is the point of having it.
        commitMoved(moveMany(view.blocks, selIds.filter((id) => !view.blocks.find((b) => b.id === id)?.locked), map[e.key][0], map[e.key][1], 1, { snap: false, width: boardW }), `nudge:${selIds.join(',')}`);
      } else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(); }
      else if (e.key === 'Escape') setSelIds([]);
    };
    // Let go of space and the press goes back to being a selection. Listened for separately
    // because the keydown handler returns early on almost every branch.
    const onKeyUp = (e) => { if (e.key === ' ' || e.code === 'Space') spaceRef.current = false; };
    // A window that loses focus mid-pan never gets the keyup, and the board would stay stuck
    // in the hand tool until space was pressed and released again.
    const blur = () => { spaceRef.current = false; };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', blur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // `zoom` and `fitScale` are here because the bare +/- keys step FROM the current zoom:
    // without them the handler kept the zoom it was created with and every press walked from
    // the same place.
  }, [selIds, canvas.blocks, emit, patch, doUndo, doRedo, chrome, zoom, fitScale, cam, vw, vh, scope, viewById, drawn, phoneBoard]);

  // ── The pieces ─────────────────────────────────────────────────────────────
  // The tool bar is contextual (phase 8, studio-toolbar.jsx): a command that cannot run is not
  // drawn. The page's own settings are the Page panel, beside the inspector, not a button here.
  const toolbarProps = {
    t, zoom, setZoom, zoomBy, fitScale, onShowAll: showAll, frameFit: frame.fit, onFitContent: fitFrameToContent,
    panMode, setPanMode, snapOn, setSnapOn, showGrid, setShowGrid, grid, setGrid,
    selCount: selIds.length, selBlocks: chosen, duplicate, remove, onSaveComponent: () => setCompOpen(true),
    onGroup: canGroup ? groupSel : null, onUngroup: canUngroup ? ungroupSel : null,
    doZ, toggleFlag, doAlign, doDistribute, matchSize, stagger,
  };
  const modals = (<>
    {keysOpen && <ShortcutsModal t={t} onClose={() => setKeysOpen(false)} />}
    {mdFor && (
      <Modal open onClose={() => setMdFor(null)} title={t('cst.md.editor', 'B.MD editor')} icon={Type} width="max-w-4xl">
        <Suspense fallback={<div className="py-10 text-center text-sm text-[var(--muted)]">{t('common.loading', 'Loading…')}</div>}>
          <LazyMarkdownEditor full minHeight={360} value={String(canvas.blocks.find((b) => b.id === mdFor)?.props?.md || '')}
            onChange={(v) => patch(mdFor, { props: { ...(canvas.blocks.find((b) => b.id === mdFor)?.props || {}), md: v } }, `md-${mdFor}`)} />
        </Suspense>
        <div className="flex justify-end mt-3"><Button variant="primary" onClick={() => setMdFor(null)}>{t('common.done', 'Done')}</Button></div>
      </Modal>
    )}
    {compOpen && <SaveComponentDialog t={t} count={chosen.length} destinations={componentDestinations} onSave={saveComponent} onClose={() => setCompOpen(false)} />}
    <StudioIODialog t={t} refusal={io.refusal} onClose={io.closeRefusal} />
  </>);
  const inspector = (<>
    <Inspector {...{ t, sel, patch, canvas, emit, setSelId, hasDark, onOpenMd: setMdFor, pageList: pages ? pages.list.filter((x) => x.id !== pages.currentId) : null, instanceTools }}
      containerFields={sel ? (
        <ContainerFields t={t} sel={sel} canvas={canvas} patch={patch} emit={emit}
          editSlot={editSlots[sel.id] || 0} setEditSlot={(i) => setSlot(sel.id, i)}
          onMoveTo={(target, slot) => moveTo(sel.id, target, slot)} onUngroup={canUngroup ? ungroupSel : null} />
      ) : null} />
    {selComponentIds.length > 0 && sel?.kind !== 'instance' && (
      <ComponentSection t={t} ids={selComponentIds} components={components} onDetach={detach} onRefresh={refreshInstances} onRedefine={redefine} />
    )}
    {componentMode && (
      <div className="mt-3"><ExposedFields t={t} sel={rawSel && rawSel.kind !== 'instance' ? rawSel : null} exposed={componentMode.exposed} onChange={componentMode.onExposed} blocks={canvas.blocks} /></div>
    )}
  </>);
  const themeSwitch = (
    <div className="inline-flex rounded-lg border border-[var(--line)] overflow-hidden">
      {[['light', Sun, t('cst.theme.light', 'Light')], ['dark', Moon, t('cst.theme.dark', 'Dark')], ['phone', Smartphone, t('cst.board.phone', 'Phone')]].map(([k, Icon, label]) => (
        <button key={k} type="button" onClick={() => setEditTheme(k)} data-board={k} aria-pressed={editTheme === k}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs transition-colors ${editTheme === k ? 'tint-primary text-[var(--text)] font-medium' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>
          <Icon size={12} /> {label}
        </button>
      ))}
    </div>
  );
  const themeHints = (<>
    {editTheme === 'dark' && (
      <span className="text-[11px] text-[var(--muted)]">{t('cst.theme.h', 'Editing the dark version. Anything you do not change here keeps following the light layout.')}</span>
    )}
    {phoneBoard && (
      <span className="text-[11px] text-[var(--muted)]">{canvas.phoneBoard
        ? t('cst.board.phone.h', 'The 390px phone board. Blocks you place stay where you put them; the rest are laid underneath in reading order.')
        : t('cst.board.phone.h0', 'Phones get the reading-order stack until you place something here. Move or resize a block and the board takes over.')}</span>
    )}
  </>);
  // The page's own stylesheet, scoped to the page as the public renderer scopes it, so the
  // board finally shows what a reader gets (PLAN-STUDIO-2026 1.6: the board painted neither
  // the background nor the CSS, and an author only saw either in a preview).
  const pageCss = canvas.css ? scopeCss(canvas.css, `[data-cv="${String(canvas.id).replace(/[^\w-]/g, '')}"]`).css : '';
  const boardHost = (
    /* `touchAction: none` is what makes this usable with a finger at all: without it the
       browser claims the gesture and drags scroll the page instead of moving the block —
       and a design surface you cannot drag on is not a design surface.
       The host does not scroll any more: the board is an infinite plane seen through a
       camera (translate + scale on ONE element), so blocks may sit left of the page, above
       it or far beyond it and stay reachable by panning. */
    <div ref={hostRef} className={`cst-board overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface-2)] ${panMode ? 'is-panning' : ''}`}
      data-cst-host
      style={{ touchAction: 'none', position: 'relative', ...(boardSize.h ? {} : { height: 'max(360px, calc(100dvh - 210px))' }) }}
      onPointerDownCapture={onTouchDown}
      onPointerMoveCapture={onTouchMove}
      onPointerUpCapture={onTouchEnd}
      onPointerCancelCapture={onTouchEnd}
      onPointerMove={(e) => { onMarqueeMove(e); onMove(e); }}
      onPointerUp={(e) => { onMarqueeUp(); onUp(e); }}
      onPointerCancel={(e) => { onMarqueeUp(); onUp(e); }}
      onPointerDown={onCanvasDown}>
      {/* The world: board coordinates, one transform. `data-cv` is the page's scope, so the
          author's stylesheet reaches the blocks here exactly as on the page. */}
      <div data-cst-world data-cv={canvas.id}
        style={{ position: 'absolute', left: 0, top: 0, width: 0, height: 0, transformOrigin: '0 0',
          transform: `translate(${camView.x}px, ${camView.y}px) scale(${scale})` }}>
        {pageCss ? <style>{pageCss}</style> : null}
        {/* The FRAME: the page a reader gets. Painted with the page's own background (the
            site's when there is none); everything around it is the grey of the desk, and a
            block out there is drawn dimmed with an "off frame" badge. The background is the
            reader's own layer (ui/canvas-background.jsx) in its STILL form: a 3D background is
            drawn here as its CSS drawing, so the editor never opens a WebGL context and never
            loads three.js; the preview shows the live scene. */}
        <div aria-hidden data-cst-frame={phoneBoard ? 'phone' : 'desktop'} data-fit={frame.fit} data-bg={canvas.background?.type || 'site'}
          style={{ position: 'absolute', left: 0, top: 0, width: boardW, height: boardH, pointerEvents: 'none', overflow: 'hidden',
            background: 'var(--bg)', boxShadow: '0 0 0 1px var(--line-strong), 0 10px 40px -18px rgba(0,0,0,.45)' }}>
          <CanvasBackground bg={canvas.background} still />
          {/* The grid, drawn so placement is legible rather than guessed at. On the page only:
              the desk around it is for parking, not for composing. */}
          {showGrid && <div aria-hidden style={{
            position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.5,
            backgroundImage: 'linear-gradient(to right, var(--line) 1px, transparent 1px), linear-gradient(to bottom, var(--line) 1px, transparent 1px)',
            backgroundSize: `${Math.max(32, grid * 4)}px ${Math.max(32, grid * 4)}px`,
          }} />}
        </div>
        {/* In the tree's order (phase 7a): a container, then its blocks over it. On the phone
            board a container draws its own blocks (they are placed on the desktop board), so
            the board gets the page's tree, as the public page does. */}
        {(() => {
          const els = drawn.map((b) => (
            <BoardBlock key={b.id} b={b} on={selIds.includes(b.id)} only={selIds.length === 1 && selIds[0] === b.id} down={stableDown}
              off={offIds.has(b.id)} offLabel={t('cst.frame.off', 'Off frame')} z={stackAt.get(b.id)} dbl={stableEnter}
              slot={editSlots[b.id] || 0} onSlot={b.kind === 'tabs' && !phoneBoard ? setSlot : null} scopeOn={scope === b.id}
              tag={b.kind === 'modal' ? `${t('cst.kind.modal', 'Dialog')}${b.props?.title ? ` · ${String(b.props.title).slice(0, 40)}` : ''}` : ''}
              brokenLabel={b.treeError ? t('cst.tree.broken', 'Broken link') : ''} />
          ));
          // Instances (phase 7b) draw their component from the page's map.
          return <InstanceMap components={canvas.components}>{phoneBoard ? <CanvasTree doc={canvas} theme="light">{els}</CanvasTree> : els}</InstanceMap>;
        })()}
        {/* Guides, drawn only while a drag is snapping to something. Long, because the board
            has no edges for them to stop at. */}
        {guides.v && <div aria-hidden style={{ position: 'absolute', left: guides.v.at, top: -BOARD_REACH, height: BOARD_REACH * 2, width: 1 / scale, background: 'var(--primary)', pointerEvents: 'none' }} />}
        {guides.h && <div aria-hidden style={{ position: 'absolute', top: guides.h.at, left: -BOARD_REACH, width: BOARD_REACH * 2, height: 1 / scale, background: 'var(--primary)', pointerEvents: 'none' }} />}
        {marquee && (
          <div aria-hidden style={{ position: 'absolute', pointerEvents: 'none',
            left: Math.min(marquee.x, marquee.x + marquee.w), top: Math.min(marquee.y, marquee.y + marquee.h),
            width: Math.abs(marquee.w), height: Math.abs(marquee.h),
            border: `${1 / scale}px solid var(--primary)`, background: 'color-mix(in srgb, var(--primary) 12%, transparent)' }} />
        )}
      </div>
      {/* The frame's bottom edge: its height, dragged in BOARD pixels so it means the same at
          every zoom. Outside the transform, in pane pixels, so the handle keeps a fingertip's
          size however far the board is zoomed out. Dragging it makes the height FIXED; "fit
          the frame to its content" hands it back to the blocks. */}
      <div className="cst-board-hedge" role="separator" aria-orientation="horizontal" tabIndex={0}
        data-fit={frame.fit}
        style={{ top: camView.y + boardH * scale, left: camView.x, width: boardW * scale }}
        aria-label={t('cst.page.h2', 'Drag to set how tall this page is')}
        title={`${t('cst.page.h2', 'Drag to set how tall this page is')} · ${boardH}px`}
        onPointerDown={onHeightDown} onPointerMove={onHeightMove}
        onPointerUp={onHeightUp} onPointerCancel={onHeightUp} onKeyDown={onHeightKey} />
    </div>
  );
  /**
   * The board as a REGION, not as whatever was left between the panels.
   *
   * Every panel could already be moved, folded, closed and dragged wider; the board — the one
   * thing the author actually came here for — was the single fixed cell of the grid. It now
   * carries its own width and height in the same stored layout the panels use, with an edge
   * on each axis, and 0 still means "fill the middle" so nobody who never touches them sees
   * any change.
   */
  const board = (
    <div className="cst-board-region" data-tour="board" data-sized={boardSize.w || boardSize.h ? '1' : '0'}
      style={{
        '--cst-board-w': boardSize.w ? `${boardSize.w}px` : '100%',
        '--cst-board-h': boardSize.h ? `${boardSize.h}px` : 'auto',
      }}>
      {boardHost}
      <BoardEdge t={t} axis="w" measured={vw} apply={applyDock} />
      <BoardEdge t={t} axis="h" measured={vh} apply={applyDock} />
    </div>
  );
  const previewEl = preview ? (
    <PreviewSurface key={previewKey} t={t} preview={preview} canvas={canvas} renderPage={renderPage}
      pageNote={t('cst.preview.page.none2', 'This document is not part of a page yet: it is being edited on its own, so there is no surrounding page to show it in. Add it to a page from the page settings and the page preview appears here.')}
      onReplay={() => setPreviewKey((k) => k + 1)} />
  ) : null;

  // ── The full-viewport studio ─────────────────────────────────────────────
  if (tooSmall) {
    /**
     * Refused, not degraded.
     *
     * This is NOT the site's own chrome being worked around: it renders as ordinary page
     * content, inside the shell, so the header and the bottom bar are where they always are
     * and the way out is the site's as well as this button. Nothing below is drawn — no top
     * bar under the site's header, no tab row under the site's tab bar, no 0.3-scale board.
     */
    return (
      <div className="cst-refuse" data-studio-too-small>
        <MonitorSmartphone size={30} className="text-[var(--accent-ink)]" aria-hidden />
        <h1 className="text-base font-semibold mt-2">{t('cst.small.title', 'The studio needs a bigger window')}</h1>
        <p className="text-sm text-[var(--muted)] mt-1.5">
          {t('cst.small.msg', 'This page is drawn on a 1200px board, and a phone is not wide enough to place anything on it. Open this address on a computer, or turn the phone and widen the window to at least 768px.')}
        </p>
        <p className="text-xs text-[var(--faint)] mt-2">
          {t('cst.small.safe', 'Nothing was lost. Anything you had not saved is still kept as a draft in this tab.')}
        </p>
        {chrome?.onBack && (
          <div className="mt-4"><Button size="sm" variant="primary" onClick={chrome.onBack}><ArrowLeft size={14} /> {t('common.back', 'Back')}</Button></div>
        )}
      </div>
    );
  }
  // What the dock can hold. The title is what every menu, tab and title bar shows, so it is
  // written once here rather than at each of the four places that name a panel.
  const allPanels = {
    blocks: { title: t('cst.pane.blocks', 'Blocks'), icon: Blocks, render: () => <BlocksPanel {...{ t, add, addShape }} /> },
    layers: { title: t('cst.layers', 'Layers'), icon: LayoutList, render: () => <LayersTree {...{ t, canvas, selIds, patch, emit, add, offIds, editSlots }} onSelect={selectFromTree} bare /> },
    components: {
      title: t('cst.cmp', 'Components'), icon: Puzzle,
      render: () => (
        <div className="space-y-3">
          <PageComponents t={t} canvas={canvas} sourceOf={sourceOf} onUpdate={updateCopiesOf} onSelect={(id) => { const b = canvas.blocks.find((x) => x.id === id); setScope(b?.parent || ''); setSelIds([id]); }} />
          <LibraryComponents t={t} entries={(lib?.entries || []).filter((e) => e.sort === 'component' && e.scope !== 'coded')} onInsert={insertLinked}
            onOpen={pages?.openComponent ? (e) => pages.openComponent(e.scope === 'site' ? 'site' : (lib?.targetScope || 'project'), e.scope === 'site' ? '' : (lib?.targetRef || ''), e.id) : null}
            onExport={(e) => io.exportEntry(e)} />
          <ComponentsPanel {...{ t, components, insertComponent, deleteComponent }} />
          {lib && (lib.canWrite?.project || lib.canWrite?.site) && <ImportButton t={t} onImport={io.pick} label={t('cst.io.import.cmp', 'Import a component from a file')} />}
        </div>
      ),
    },
    // Phase 6: the target's pages, and the preset gallery.
    pages: { title: t('cst.pages', 'Pages'), icon: FileText, render: () => <PagesPanel t={t} lang={lang} pages={pages} onImport={io.pick} onExport={io.exportPage} /> },
    presets: {
      title: t('cst.presets', 'Presets'), icon: LayoutTemplate,
      render: () => <PresetsPanel t={t} lang={lang} library={pages?.library || null} onApply={applyPreset} onSaveAs={saveAsPreset}
        onImport={io.pick} onExport={(e) => io.exportEntry(e, true)}
        canSection={chosen.length > 0} canComponent={chosen.length > 0 && chosen.length <= COMPONENT_LIMITS.blocks}
        // The home page cannot make a page, so it is offered no page preset (phase 8).
        sorts={pages?.canEditList === false ? PRESET_SORTS.filter((x) => x !== 'page') : PRESET_SORTS} />,
    },
    props: { title: t('cst.pane.props', 'Properties'), icon: SlidersHorizontal, render: () => inspector },
    // The page's own settings (background, stylesheet, imports): a panel like the others since
    // phase 4, so a background is tried on the board instead of behind a modal's Save.
    page: { title: t('cst.page', 'Page'), icon: Layers, render: () => <PagePanel {...{ t, canvas, emit, add }} /> },
  };
  const panels = Object.fromEntries(panelIds.map((id) => [id, allPanels[id]]));
  // The grid's own columns and rows, so a drag of a resizer is one number changing rather
  // than a re-layout. A zone with nothing in it takes no width at all — EXCEPT while a panel
  // is being dragged, where a 0px track is a drop target with no surface: the "drop a panel
  // here" strip rendered inside it, was clipped to nothing, and the drop silently failed.
  const zoneSize = (z) => {
    if (!dock.zones[z].panels.length) return dockDrag.drag ? 140 : 0;
    return dock.zones[z].collapsed ? 28 : dock.zones[z].size;
  };
  const dockVars = wide ? {
    '--cst-left': `${zoneSize('left')}px`,
    '--cst-right': `${zoneSize('right')}px`,
    '--cst-bottom': `${zoneSize('bottom')}px`,
  } : undefined;
  const openPane = pane !== 'canvas' && panels[pane] ? panels[pane] : null;
  /**
   * Out of <main>, onto the body.
   *
   * <main> is `relative z-10`, which is a stacking context — so NO z-index inside it could
   * ever beat the site's header and bottom bar at z-40, and `.cst-page`'s z-45 was being
   * read against its siblings inside main rather than against them. Measured before this
   * change: at every one of 1280 / 1024 / 768 / 375 px, elementFromPoint at the centre of
   * the studio's Save button returned the site header, and at 375 all five of the studio's
   * bottom tabs returned the site's tab bar. A portal puts the editor next to #root, where
   * 45 really is above 40 and below the modal layer at 50, and it needs to know nothing
   * about what the shell's elements happen to be called.
   */
  const host = typeof document !== 'undefined' ? document.body : null;
  const centre = (
    <section className="cst-center">
      <Toolbar {...toolbarProps} />
      <div className="flex items-center gap-2 mb-2 flex-wrap">{themeHints}</div>
      <ScopeBar t={t} canvas={canvas} scope={scope} onScope={(id) => { setScope(id); setSelIds(id ? [] : selIds.filter((x) => !canvas.blocks.find((b) => b.id === x)?.parent)); }} />
      {!canvas.blocks.length && <EmptyBoard t={t} onAdd={() => add('text')} onOpenBlocks={() => showPanel('blocks')} />}
      {board}
    </section>
  );
  const tree = (
    <div className="cst-page" data-pane={pane} data-wide={wide ? '1' : '0'}
      // Every pointer move during a panel drag has to reach the dock even once the pointer
      // has left the handle, and capture keeps them all on the handle's element — so they
      // are caught here, at the one ancestor both ends of the gesture are inside.
      onPointerMove={dockDrag.drag ? dockDrag.move : undefined}
      onPointerUp={dockDrag.drag ? dockDrag.end : undefined}
      onPointerCancel={dockDrag.drag ? dockDrag.end : undefined}
      // A studio file dropped anywhere on the studio is imported (phase 7c, studio-io.js).
      {...io.dropProps}>
      <DropOverlay t={t} on={io.dragging} />
      <PageTopBar {...{ t, chrome, hist, doUndo, doRedo, preview, setPreview, themeSwitch, hasPage: !!renderPage,
        wide, onKeys: () => setKeysOpen(true), onTour: tour.start, panelsMenu, setPanelsMenu, dock, panels, applyDock, resetDock,
        board: editTheme, title: canvas.title || '', offerPage: !componentMode,
        // Component mode (phase 7b): the top bar names the component; a definition has no page title.
        onTitle: componentMode ? null : (v) => emit(canvas.blocks, { title: v }, 'title') }} />
      {preview ? (
        <div className="cst-page-body cst-preview-body">{previewEl}</div>
      ) : wide ? (
        <div className="cst-page-body" style={dockVars} data-dock="1">
          <DockZone {...{ t, zone: 'left', layout: dock, panels, apply: applyDock, drag: dockDrag.drag }}
            onDragStart={dockDrag.start} className="cst-left" />
          {centre}
          <DockZone {...{ t, zone: 'bottom', layout: dock, panels, apply: applyDock, drag: dockDrag.drag }}
            onDragStart={dockDrag.start} className="cst-bottom" />
          <DockZone {...{ t, zone: 'right', layout: dock, panels, apply: applyDock, drag: dockDrag.drag }}
            onDragStart={dockDrag.start} className="cst-right" />
          {DOCK_ZONES.filter((z) => dock.zones[z].panels.length && !dock.zones[z].collapsed).map((z) => (
            <DockResizer key={z} t={t} zone={z} layout={dock} apply={applyDock} />
          ))}
          <DockGhost drag={dockDrag.drag} panels={panels} />
        </div>
      ) : (
        /* A phone gets ONE thing at a time. The canvas keeps the whole width whatever is
           open, and the panel arrives over its lower half rather than beside it — three
           zones on a 375px screen would be three slivers and no board. */
        <div className="cst-page-body">
          {centre}
          {openPane && (
            <aside className="cst-mobile-pane" aria-label={openPane.title}>
              <header className="cst-mobile-head">
                <span className="flex-1 min-w-0 truncate" title={openPane.title}>{openPane.title}</span>
                <Button size="sm" variant="ghost" className="!px-2" onClick={() => setPane('canvas')}
                  title={t('cst.pane.close', 'Back to the canvas')} aria-label={t('cst.pane.close', 'Back to the canvas')}><X size={15} /></Button>
              </header>
              <div className="cst-mobile-body">{openPane.render()}</div>
            </aside>
          )}
        </div>
      )}
      {!wide && !preview && (
        /* Scrolls sideways rather than squeezing: five 48px targets do not fit across a
           375px screen, and a tab squeezed to 40px is a tab nobody hits. Nothing is dropped
           from the row, so no control is unreachable. */
        <nav className="cst-tabs" aria-label={t('cst.panes', 'Studio panes')}>
          <button type="button" aria-pressed={pane === 'canvas'} className={pane === 'canvas' ? 'is-on' : ''} onClick={() => setPane('canvas')}>
            <LayoutTemplate size={16} /> <span>{t('cst.pane.canvas', 'Canvas')}</span>
          </button>
          {panelIds.map((id) => {
            const Icon = panels[id].icon;
            return (
              <button key={id} type="button" aria-pressed={pane === id} className={pane === id ? 'is-on' : ''} onClick={() => togglePane(id)}>
                <Icon size={16} /> <span>{panels[id].title}</span>
              </button>
            );
          })}
        </nav>
      )}
      {modals}
      {tour.open && <StudioTour t={t} onClose={tour.close} />}
    </div>
  );
  // No document (check-studio.mjs renders this to a string under node): render in place, so
  // the markup that file asserts on is exactly the markup the browser gets.
  return host ? createPortal(tree, host) : tree;
}
