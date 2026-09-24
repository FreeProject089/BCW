// The studio: place blocks on a page by hand.
//
// All the arithmetic lives in lib/canvas.js and is tested there — drag at any zoom, resize
// from any of the eight handles, snapping, alignment guides, z-order. This file is the
// pointer plumbing and the panel, and deliberately owns no rules of its own: the preview is
// the SAME CanvasView the public page uses, so "what the author sees" and "what a reader
// gets" cannot become two answers.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Type, Image as ImageIcon, Square, Trash2, ArrowUp, ArrowDown, Eye, Smartphone, Monitor, Magnet, Copy,
  Film, Globe, PlayCircle, EyeOff, Sun, Moon, Layers, MousePointerClick, Sparkles,
  Undo2, Redo2, AlertTriangle, Upload, Lock, LockOpen, LayoutList, ChevronUp, ChevronDown, Grid2x2,
  AlignStartVertical, AlignCenterVertical, AlignEndVertical,
  AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
  AlignHorizontalSpaceAround, AlignVerticalSpaceAround,
  ArrowLeft, Save, Tablet, FileText, RotateCcw, Blocks, Puzzle, SlidersHorizontal, LayoutTemplate,
  Plus, RefreshCw, Unlink, ZoomIn, ZoomOut, Maximize,
  BringToFront, SendToBack, StretchHorizontal, StretchVertical, MoreHorizontal, Keyboard, PanelsTopLeft, X,
  Hand, MonitorSmartphone, GraduationCap, Expand, FoldVertical,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { Button, Field, Input, Textarea, Select, Modal, useToast } from '../ui/ui.jsx';
import { useI18n } from '../i18n.jsx';
import { api, uploadMedia } from '../lib/api.js';
import { stepZoom } from '../lib/studio-page.js';
import { PAGE_DEVICES } from '../lib/studio-preview.js';
import {
  componentFromBlocks, instantiateComponent, detachBlocks, updateInstances, componentIdsIn,
  thumbnailSvg, normalizeComponents, COMPONENT_LIMITS,
} from '../lib/studio-components.js';
import { lazy, Suspense, memo } from 'react';
import { PATTERNS } from '../lib/patterns.js';
import { BackgroundThumb } from '../ui/canvas-background.jsx';
import { sanitizeSvg, svgRefusals } from '../lib/svg-safe.js';
import { scopeCss } from '../lib/css-scope.js';
// The full B.MD editor is heavy and most sessions never open it: loaded on first use.
const LazyMarkdownEditor = lazy(() => import('./markdown-editor.jsx').then((m) => ({ default: m.MarkdownEditor })));
import CanvasView, { CanvasBlock } from '../ui/canvas-view.jsx';
import {
  DOCK_ZONES, DockZone, DockResizer, DockGhost, PanelsMenu, useDockLayout, useDockDrag, zoneOf, movePanel,
  BoardEdge,
} from './studio-dock.jsx';
import ShortcutsModal from './studio-shortcuts.jsx';
import {
  normalizeCanvas, serializeDoc, paintOrder, dragTo, resizeTo, alignmentGuides, bringTo,
  inFrame, boardBlocks, boardFrame, offFrameIds, toBoard, zoomAt, wheelZoom, pinchView, fitFrameView, showAllView, revealView,
  emptyHistory, pushHistory, undo as undoHist, redo as redoHist,
  boundsOf, blocksInRect, moveMany, alignMany, distributeMany, phoneOrder, resolveBlock,
  reorder, DESIGN_WIDTH, GRID, HANDLES,
  alignOnBoard, distributeOnBoard, matchSizeOnBoard, duplicateOnBoard, placeOnBoard, dragPatch,
  ANIM_KINDS, ANIM_TRIGGERS, ANIM_EASINGS, STAGGER_STEPS, BUTTON_VARIANTS, BUTTON_ACTIONS, LEGACY_ACTIONS, buttonTarget, menuItemHref, SHADOWS, HOVER_EFFECTS, GRID_SIZES, TEXT_ALIGNS, SHAPES,
  BACKGROUND_TYPES, BG_TOKENS, BG_IMAGE_FITS, BG_POSITIONS, SCENE3D_POSITIONS, BOARD_GRIDS, GRADIENT_STOPS, bgColor, patternColor, bgImagePath,
  SCENE_SHAPES, SCENE_SURFACES, SCENE_BOUNDS, detailMaxFor,
} from '../lib/canvas.js';
import CanvasBackground from '../ui/canvas-background.jsx';
import StudioTour, { TourButton, useStudioTour } from './studio-tour.jsx';

const uid = () => `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/**
 * The panels the dock knows about, in the order every menu and the phone's tab row lists them.
 *
 * Module scope, and a plain array, because the dock's stored layout is checked against it: a
 * panel that is dropped from this list disappears from a layout saved by an older build
 * instead of leaving an id nothing can render.
 */
const PANEL_IDS = ['blocks', 'layers', 'components', 'props', 'page'];

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
  button: { kind: 'button', w: 240, h: 56, props: { label: 'Discover', variant: 'button', size: 'md', action: { type: 'link', href: '/' } } },
  shape: { kind: 'shape', w: 200, h: 200, props: { shape: 'rounded', fill: 'var(--primary)', corner: 16 } },
  svg: { kind: 'svg', w: 240, h: 240, props: { svg: '' } },
};

/**
 * @param {object} props
 * @param {object} props.value       the canvas being edited (raw; normalised here)
 * @param {Function} props.onChange  receives the whole next canvas on every change
 * @param {'modal'|'page'} [props.layout]  'modal' is the compact form the config editor
 *        embeds; 'page' is the full-viewport studio at /studio/:kind/:id/:index — three panes
 *        on a wide screen, bottom sheets on a narrow one, with the top bar `chrome` describes.
 * @param {object} [props.chrome]    page mode only: { title, state, onBack, onSave, canSave,
 *        draftRestored, onDiscardDraft } — the document and its save path, owned by the page.
 * @param {Function} [props.renderPage]  page mode only: (canvas) => the WHOLE public page with
 *        this canvas in place, for the "page preview".
 */
export default function CanvasStudio({ value, onChange, layout = 'modal', chrome = null, renderPage = null }) {
  const { t } = useI18n();
  const toast = useToast();
  const pageMode = layout === 'page';
  const canvas = useMemo(() => normalizeCanvas(value), [value]);
  // A SET of ids. Everything that was written for one block still works — `sel` is the single
  // selection when there is exactly one — and the group operations read the whole set.
  const [selIds, setSelIds] = useState([]);
  const selId = selIds.length === 1 ? selIds[0] : null;
  const setSelId = (id) => setSelIds(id == null ? [] : [id]);
  // A marquee in flight, in DESIGN coordinates. In state because it has to draw.
  const [marquee, setMarquee] = useState(null);
  const [snapOn, setSnapOn] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [layersOpen, setLayersOpen] = useState(false);
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
  const [pageOpen, setPageOpen] = useState(false);
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
    if (!pageMode || tooSmall || typeof document === 'undefined') return undefined;
    const el = document.documentElement;
    el.setAttribute('data-studio-open', '1');
    return () => el.removeAttribute('data-studio-open');
  }, [pageMode, tooSmall]);
  /**
   * The dock: which panel sits where, how wide each zone is, what is folded or closed.
   *
   * The author's arrangement, not the page's — it lives in this browser (localStorage), so two
   * people editing the same document each keep their own desk and neither can rearrange the
   * other's. See studio-dock.jsx for what is and is not built.
   */
  const { layout: dock, apply: applyDock, reset: resetDock } = useDockLayout(PANEL_IDS);
  /**
   * The board's own size, from the same stored layout the panels use. 0 = fill the middle.
   * Page mode only: the modal form is a column in somebody else's settings screen and has no
   * business being handed a width somebody chose for a full-screen editor.
   */
  const boardSize = pageMode ? (dock.board || { w: 0, h: 0 }) : { w: 0, h: 0 };
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
   * The first-run tour. Page form only, and not on a window that is refusing to draw the
   * studio at all — a tour of three panes that are not on screen names nothing.
   */
  const tour = useStudioTour(pageMode && !tooSmall);
  const persistComponents = useCallback(async (next) => {
    setComponents(next);
    try { await api.put('/me/studio/components', { components: next }); }
    catch { toast.error(t('cst.cmp.savefail', 'The component list could not be saved.')); }
  }, [t, toast]);
  /**
   * On a phone, edit the STACK — not a 1200px board shrunk to a third of its size.
   *
   * The public page already abandons the canvas below ~700px and renders the blocks as a
   * column in reading order (`layoutFor` → mode 'stack'). Placement is therefore a
   * desktop-only property, and a phone editor offering precise placement is offering the one
   * thing that will not reach the reader it is being placed for — at a scale (390/1200 ≈ 0.32)
   * where a 12px resize handle is under 4px of glass.
   *
   * What does reach that reader is the ORDER and the CONTENT, and those are exactly what a
   * list edits. The board stays one tap away for anyone who wants it.
   */
  // matchMedia, not a width read: this pane lives inside a modal, and it is the VIEWPORT that
  // decides whether the public page stacks, not the pane's own box. Read during the FIRST
  // render, not in the effect afterwards — otherwise a phone opens on the board and swaps to
  // the list a frame later, which reads as a glitch and loses whatever was tapped meanwhile.
  const [narrow, setNarrow] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(max-width: 700px)').matches : false));
  const [phoneMode, setPhoneMode] = useState('stack');   // 'stack' | 'canvas'
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(max-width: 700px)');
    const read = () => setNarrow(mq.matches);
    read();
    mq.addEventListener?.('change', read);
    return () => mq.removeEventListener?.('change', read);
  }, []);
  const stacked = narrow && phoneMode === 'stack' && !preview;
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
    // the stacked list is shown, and the ref would otherwise be read once, on nothing.
  }, [preview, stacked, pane]);

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
  const patch = useCallback((id, next, key = null) => {
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
  }, [canvas.blocks, emit, editTheme]);

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
    if (editTheme === 'light') { emit(nextBlocks, {}, key); return; }
    const by = new Map(nextBlocks.map((b) => [b.id, b]));
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
      const cur = resolveBlock(b, 'dark');
      if (!n || (n.x === cur.x && n.y === cur.y)) return b;
      return { ...b, themes: { ...(b.themes || {}), dark: { ...(b.themes?.dark || {}), x: n.x, y: n.y } } };
    }), {}, key);
  }, [canvas.blocks, emit, editTheme]);

  const doUndo = useCallback(() => {
    const r = undoHist(hist, canvas);
    if (r) { setHist(r.hist); onChange(r.value); }
  }, [hist, canvas, onChange]);
  const doRedo = useCallback(() => {
    const r = redoHist(hist, canvas);
    if (r) { setHist(r.hist); onChange(r.value); }
  }, [hist, canvas, onChange]);

  // Where a new thing lands: below everything already there, so it never arrives hidden
  // under a block.
  const nextY = () => canvas.blocks.filter((b) => inFrame(b, { w: DESIGN_WIDTH, h: Infinity })).reduce((m, b) => Math.max(m, b.y + b.h), 0) + 24;
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
  const addBlocks = (fresh) => {
    if (!fresh.length) return;
    const out = placeOnBoard(canvas, fresh, editTheme);
    emit(out.blocks, out.extra);
    setSelIds(fresh.map((b) => b.id));
    setRevealId(fresh[0].id);
    if (!wide) setPane('canvas');
  };
  const add = (kind, over = {}) => {
    const base = NEW_BLOCK[kind];
    const spec = { ...base, ...over, props: { ...(base.props || {}), ...(over.props || {}) } };
    addBlocks([{ id: uid(), x: 64, y: nextY(), z: canvas.blocks.length, ...spec }]);
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
    emit(canvas.blocks.filter((b) => !ids.includes(b.id) || b.locked));
    setSelIds((cur) => cur.filter((x) => !ids.includes(x)));
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
  const saveComponent = (name) => {
    const comp = componentFromBlocks(name, chosen, uid);
    if (!comp) return;
    if (components.length >= COMPONENT_LIMITS.count) { toast.error(t('cst.cmp.full', 'You have reached the limit of saved components, delete one first.')); return; }
    persistComponents([comp, ...components]);
    setCompOpen(false);
    showPanel('components');
    toast.success(t('cst.cmp.saved', 'Component saved.'));
  };
  // Instantiated on the DESKTOP plane (it used to be squeezed into 390px when inserted on the
  // phone board), then placed on the board being edited.
  const insertComponent = (comp) => {
    addBlocks(instantiateComponent(comp, { x: 64, y: nextY() }, canvas.blocks.length, uid, DESIGN_WIDTH));
  };
  const deleteComponent = (id) => persistComponents(components.filter((c) => c.id !== id));
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
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    let ids;
    if (additive) ids = selIds.includes(b.id) ? selIds.filter((x) => x !== b.id) : [...selIds, b.id];
    // A plain press on a block that is ALREADY part of the selection keeps the group. Without
    // this, grabbing a selected block to drag the group instead collapses the selection to
    // that one block and only it moves — which is the single most annoying way to get
    // multi-select wrong.
    else ids = selIds.includes(b.id) ? selIds : [b.id];
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
  const onUp = () => { drag.current = null; setGuides({ v: null, h: null }); };
  // The handler the memoised blocks hold never changes; it reads the current one through a
  // ref. Without this every block re-rendered on every pointer move, because the closure
  // over `selIds` and `canvas` was new each time.
  const onDownRef = useRef(onDown); onDownRef.current = onDown;
  const stableDown = useCallback((e, b, h) => onDownRef.current(e, b, h), []);

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
    // The rubber band tests the blocks as DRAWN on this board (bug A.2).
    const hit = blocksInRect(view.blocks, rect).map((b) => b.id);
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
  // In the MODAL form the board sits in a scrolling settings screen, so there only a pinch on
  // a trackpad (which arrives as Ctrl+wheel) or Ctrl/Cmd+wheel zooms and the wheel still
  // scrolls the form; the full-page studio owns the wheel.
  useEffect(() => {
    const host = hostRef.current; if (!host) return undefined;
    const onWheel = (e) => {
      if (!pageMode && !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const r = host.getBoundingClientRect();
      const x = e.clientX - r.left - (host.clientLeft || 0); const y = e.clientY - r.top - (host.clientTop || 0);
      const w = host.clientWidth; const h = host.clientHeight;
      setCam((c) => ({ ...wheelZoom(c.fit ? fitFrameView(frameRef.current, w, h) : c, x, y, e.deltaY, e.deltaMode), fit: false }));
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => host.removeEventListener('wheel', onWheel);
    // Re-bound when the board (un)mounts, like the size observer above.
  }, [pageMode, preview, stacked, pane]);

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
      // Save, in page mode, where there is a save path to call. In the modal the parent's
      // form owns saving and this key is left to it.
      if (mod && e.key.toLowerCase() === 's' && pageMode && chrome?.onSave) {
        e.preventDefault(); if (chrome.canSave !== false) chrome.onSave(); return;
      }
      if (mod && e.key.toLowerCase() === 'a' && !typing) {
        e.preventDefault(); setSelIds(canvas.blocks.map((b) => b.id)); return;
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
        const picked = canvas.blocks.filter((b) => selIds.includes(b.id));
        clip.current = picked;
        try { navigator.clipboard?.writeText(JSON.stringify({ bcwBlocks: picked })); } catch { /* no clipboard: the ref still works */ }
        return;
      }
      if (mod && e.key.toLowerCase() === 'v' && !typing) {
        const paste = (list) => {
          if (!Array.isArray(list) || !list.length) return;
          // Through the normaliser first: the clipboard is outside input, and a pasted block
          // used to keep every field it came with until the next save (S8). Offset on the
          // desktop plane, then placed on the board being edited.
          const clean = normalizeCanvas({ blocks: list.slice(0, 200) }).blocks;
          // Offset, not clamped (v2): a block copied from beside the page lands beside it.
          addBlocks(clean.map((b) => ({ ...b, id: uid(), x: b.x + GRID * 3, y: b.y + GRID * 3, component: null })));
        };
        e.preventDefault();
        navigator.clipboard?.readText?.().then((txt) => { try { const j = JSON.parse(txt); if (Array.isArray(j?.bcwBlocks)) return paste(j.bcwBlocks); } catch { /* not ours */ } paste(clip.current); }).catch(() => paste(clip.current));
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
  }, [selIds, canvas.blocks, emit, patch, doUndo, doRedo, chrome, pageMode, zoom, fitScale, cam, vw, vh]);

  // ── The pieces, assembled differently by the two layouts ─────────────────
  const toolbarProps = {
    t, preview, setPreview, snapOn, setSnapOn, add, addShape, sel, duplicate, remove, doUndo, doRedo, hist,
    selCount: selIds.length, doAlign, doDistribute, grid, setGrid, layersOpen, setLayersOpen, zoom, setZoom,
    // The page form has the Page PANEL; the compact form keeps the modal it always had.
    pageOpen: pageMode ? !!zoneOf(dock, 'page') : pageOpen, setPageOpen: pageMode ? () => showPanel('page') : setPageOpen,
    pageMode, showGrid, setShowGrid, zoomBy, fitScale, onSaveComponent: () => setCompOpen(true),
    doZ, matchSize, toggleFlag, stagger, selBlocks: chosen, onKeys: () => setKeysOpen(true),
    panMode, setPanMode, onShowAll: showAll, frameFit: frame.fit, onFitContent: fitFrameToContent,
  };
  const modals = (<>
    {keysOpen && <ShortcutsModal t={t} onClose={() => setKeysOpen(false)} />}
    {pageOpen && !pageMode && (
      <Modal open onClose={() => setPageOpen(false)} title={t('cst.page', 'Page')} icon={Layers} width="max-w-2xl">
        <PagePanel t={t} canvas={canvas} emit={emit} add={add} onClose={() => setPageOpen(false)} />
        <div className="flex justify-end mt-3"><Button variant="primary" onClick={() => setPageOpen(false)}>{t('common.done', 'Done')}</Button></div>
      </Modal>
    )}
    {mdFor && (
      <Modal open onClose={() => setMdFor(null)} title={t('cst.md.editor', 'B.MD editor')} icon={Type} width="max-w-4xl">
        <Suspense fallback={<div className="py-10 text-center text-sm text-[var(--muted)]">{t('common.loading', 'Loading…')}</div>}>
          <LazyMarkdownEditor full minHeight={360} value={String(canvas.blocks.find((b) => b.id === mdFor)?.props?.md || '')}
            onChange={(v) => patch(mdFor, { props: { ...(canvas.blocks.find((b) => b.id === mdFor)?.props || {}), md: v } }, `md-${mdFor}`)} />
        </Suspense>
        <div className="flex justify-end mt-3"><Button variant="primary" onClick={() => setMdFor(null)}>{t('common.done', 'Done')}</Button></div>
      </Modal>
    )}
    {compOpen && <SaveComponentModal t={t} blocks={chosen} onSave={saveComponent} onClose={() => setCompOpen(false)} />}
  </>);
  const inspector = (<>
    <Inspector {...{ t, sel, patch, canvas, emit, setSelId, hasDark, onOpenMd: setMdFor }} />
    {selComponentIds.length > 0 && (
      <ComponentSection t={t} ids={selComponentIds} components={components} onDetach={detach} onRefresh={refreshInstances} onRedefine={redefine} />
    )}
  </>);
  const themeSwitch = (
    <div className="inline-flex rounded-lg border border-[var(--line)] overflow-hidden">
      {[['light', Sun, t('cst.theme.light', 'Light')], ['dark', Moon, t('cst.theme.dark', 'Dark')], ['phone', Smartphone, t('cst.board.phone', 'Phone')]].map(([k, Icon, label]) => (
        <button key={k} type="button" onClick={() => setEditTheme(k)}
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
       and a design surface you cannot drag on is not a design surface. The modal body
       around it still scrolls, so nothing is trapped.
       The host does not scroll any more: the board is an infinite plane seen through a
       camera (translate + scale on ONE element), so blocks may sit left of the page, above
       it or far beyond it and stay reachable by panning. */
    <div ref={hostRef} className={`cst-board overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface-2)] ${panMode ? 'is-panning' : ''}`}
      data-cst-host
      style={{ touchAction: 'none', position: 'relative', ...(boardSize.h ? {} : { height: pageMode ? 'max(360px, calc(100dvh - 210px))' : 'min(70vh, 720px)' }) }}
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
        {paintOrder(view.blocks).map((b) => (
          <BoardBlock key={b.id} b={b} on={selIds.includes(b.id)} only={selIds.length === 1 && selIds[0] === b.id} down={stableDown}
            off={offIds.has(b.id)} offLabel={t('cst.frame.off', 'Off frame')} />
        ))}
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
      {pageMode && (<>
        <BoardEdge t={t} axis="w" measured={vw} apply={applyDock} />
        <BoardEdge t={t} axis="h" measured={vh} apply={applyDock} />
      </>)}
    </div>
  );
  const stackList = <StackList {...{ t, canvas, emit, selIds, setSelId, setSelIds, removeIds, add }} />;
  const previewEl = preview ? (
    <PreviewSurface key={previewKey} t={t} preview={preview} canvas={canvas} renderPage={renderPage}
      pageNote={t('cst.preview.page.none2', 'This document is not part of a page yet: it is being edited on its own, so there is no surrounding page to show it in. Add it to a page from the page settings and the page preview appears here.')}
      onReplay={() => setPreviewKey((k) => k + 1)} />
  ) : null;

  // ── Page mode: the full-viewport studio ──────────────────────────────────
  if (pageMode && tooSmall) {
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
  if (pageMode) {
    // What the dock can hold. The title is what every menu, tab and title bar shows, so it is
    // written once here rather than at each of the four places that name a panel.
    const panels = {
      blocks: { title: t('cst.pane.blocks', 'Blocks'), icon: Blocks, render: () => <BlocksPanel {...{ t, add, addShape }} /> },
      layers: { title: t('cst.layers', 'Layers'), icon: LayoutList, render: () => <LayersPanel {...{ t, canvas, view, selIds, setSelIds, patch, emit, add, offIds }} bare /> },
      components: { title: t('cst.cmp', 'Components'), icon: Puzzle, render: () => <ComponentsPanel {...{ t, components, insertComponent, deleteComponent }} /> },
      props: { title: t('cst.pane.props', 'Properties'), icon: SlidersHorizontal, render: () => inspector },
      // The page's own settings (background, stylesheet, imports): a panel like the others since
      // phase 4, so a background is tried on the board instead of behind a modal's Save.
      page: { title: t('cst.page', 'Page'), icon: Layers, render: () => <PagePanel {...{ t, canvas, emit, add }} /> },
    };
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
        <Toolbar {...toolbarProps} narrow={!wide} />
        <div className="flex items-center gap-2 mb-2 flex-wrap">{themeHints}</div>
        {narrow && (
          <div className="text-[11px] text-[var(--muted)] mb-2 flex items-center gap-2">
            <span className="flex-1 min-w-0">{stacked
              ? t('cst.stack.h', 'Reading order, what a phone shows. Placement is a desktop thing.')
              : t('cst.board.h', 'The board is 1200px wide, scaled to fit. A phone reader gets the list order instead.')}</span>
            {stacked
              ? <Button size="sm" variant="ghost" onClick={() => setPhoneMode('canvas')} title={t('cst.stack.board.h', 'Place the blocks freely, easier on a big screen')}><Monitor size={14} /> {t('cst.stack.board', 'Board')}</Button>
              : <Button size="sm" variant="ghost" onClick={() => setPhoneMode('stack')}>{t('cst.board.list', 'List')}</Button>}
          </div>
        )}
        {!canvas.blocks.length && <EmptyBoard t={t} onAdd={() => add('text')} onOpenBlocks={() => showPanel('blocks')} />}
        {stacked ? stackList : board}
      </section>
    );
    const tree = (
      <div className="cst-page" data-pane={pane} data-wide={wide ? '1' : '0'}
        // Every pointer move during a panel drag has to reach the dock even once the pointer
        // has left the handle, and capture keeps them all on the handle's element — so they
        // are caught here, at the one ancestor both ends of the gesture are inside.
        onPointerMove={dockDrag.drag ? dockDrag.move : undefined}
        onPointerUp={dockDrag.drag ? dockDrag.end : undefined}
        onPointerCancel={dockDrag.drag ? dockDrag.end : undefined}>
        <PageTopBar {...{ t, chrome, hist, doUndo, doRedo, preview, setPreview, themeSwitch, hasPage: !!renderPage,
          wide, onKeys: () => setKeysOpen(true), onTour: tour.start, panelsMenu, setPanelsMenu, dock, panels, applyDock, resetDock,
          board: editTheme, title: canvas.title || '', onTitle: (v) => emit(canvas.blocks, { title: v }, 'title') }} />
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
            {PANEL_IDS.map((id) => {
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

  // ── Modal mode: the compact form the config editor embeds ────────────────
  if (preview) {
    return (
      <div>
        <Toolbar {...toolbarProps} />
        {modals}
        {previewEl}
      </div>
    );
  }

  if (stacked) {
    return (
      <div>
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <span className="text-[11px] text-[var(--muted)] flex-1 min-w-0">{t('cst.stack.h', 'Reading order, what a phone shows. Placement is a desktop thing.')}</span>
          <Button size="sm" variant="ghost" onClick={() => setPhoneMode('canvas')} title={t('cst.stack.board.h', 'Place the blocks freely, easier on a big screen')}><Monitor size={14} /> {t('cst.stack.board', 'Board')}</Button>
          <Button size="sm" variant="ghost" onClick={() => setPreview('phone')} title={t('cst.phone', 'Phone preview')}><Eye size={14} /></Button>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap mb-2">
          {[['text', Type], ['image', ImageIcon], ['box', Square], ['button', MousePointerClick], ['video', Film], ['embed', Globe], ['replay', PlayCircle]].map(([k, Icon]) => (
            <Button key={k} size="sm" onClick={() => add(k)}><Icon size={14} /> {t(`cst.add.${k}`, k)}</Button>
          ))}
          <div className="flex-1" />
          <Button size="sm" variant="ghost" disabled={!hist.past.length} onClick={doUndo} title={t('cst.undo', 'Undo')}><Undo2 size={14} /></Button>
        </div>
        {stackList}
        {/* The inspector, pinned to the bottom of the viewport and only while something is
            selected — an empty panel over a list is just a shorter list. */}
        {sel && (
          <div className="sticky bottom-0 z-20 mt-2 max-h-[46vh] overflow-auto rounded-t-2xl border-t border-[var(--line-strong)] shadow-[0_-10px_30px_-12px_rgba(0,0,0,0.35)]" style={{ background: 'var(--bg-solid)' }}>
            {inspector}
          </div>
        )}
        {modals}
      </div>
    );
  }

  return (
    <div>
      <Toolbar {...toolbarProps} />
      {modals}
      {/* Which theme is being authored. A page is read on both backgrounds and a hero built
          for one is not the same picture on the other; the alternative to this switch was
          authoring the page twice. Dark writes a partial OVERLAY, so anything not touched here
          keeps following the light layout. */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        {themeSwitch}
        {themeHints}
      </div>
      {narrow && !preview && (
        <div className="text-[11px] text-[var(--muted)] mb-2 flex items-center gap-2">
          <span className="flex-1 min-w-0">{t('cst.board.h', 'The board is 1200px wide, scaled to fit. A phone reader gets the list order instead.')}</span>
          <Button size="sm" variant="ghost" onClick={() => setPhoneMode('stack')}>{t('cst.board.list', 'List')}</Button>
        </div>
      )}
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-4 lg:items-start">
        {board}
        {/* The inspector.
            On a wide screen it is the right-hand column of the grid above. Below `lg` the grid
            collapses and it lands UNDER the canvas — which on a phone means scrolling past the
            whole page you are editing to change the block you just tapped, then scrolling back
            to see what happened. So on narrow screens it sticks to the bottom of the viewport
            instead, and only while something is selected: an empty panel pinned over the
            canvas would just be a smaller canvas. */}
        <div className={`lg:static lg:mt-0 ${sel ? 'sticky bottom-0 z-20 mt-2 max-h-[46vh] overflow-auto rounded-t-2xl border-t lg:border-t-0 border-[var(--line-strong)] lg:rounded-t-none lg:max-h-none lg:overflow-visible lg:shadow-none shadow-[0_-10px_30px_-12px_rgba(0,0,0,0.35)]' : 'mt-2'}`}
          style={sel ? { background: 'var(--bg-solid)' } : undefined}>
          {layersOpen && <LayersPanel {...{ t, canvas, view, selIds, setSelIds, patch, emit, add, offIds }} />}
          {inspector}
        </div>
      </div>
    </div>
  );
}

/**
 * The reading-order list a phone edits — the blocks as a column, each row painted by the same
 * component the public page uses, with move / hide / delete controls sized for a thumb.
 */
function StackList({ t, canvas, emit, selIds, setSelId, setSelIds, removeIds, add }) {
  const order = phoneOrder(canvas.blocks);
  /**
   * Reorder the PHONE stack, and nothing else.
   *
   * The first version of this swapped the two blocks' x/y, because reading order is derived
   * from position and there was no other order to change. It worked, and it was wrong: a
   * phone edit silently rearranged the desktop layout, and two blocks of different sizes
   * came back overlapping on the board.
   *
   * `block.phone.order` exists now, so the list has an order of its own. The whole visible
   * list is renumbered on each move rather than only the pair — sequential integers are
   * predictable, and leaving gaps means the next move has to reason about fractions.
   */
  const swap = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    const rank = new Map(next.map((b, k) => [b.id, k]));
    emit(canvas.blocks.map((x) => (
      rank.has(x.id) ? { ...x, phone: { ...(x.phone || {}), order: rank.get(x.id) } } : x
    )));
  };
  /** Out of the phone stack, still on the desktop board. */
  const togglePhoneHidden = (b) => emit(canvas.blocks.map((x) => (
    x.id === b.id ? { ...x, phone: { ...(x.phone || {}), hidden: !x.phone?.hidden } } : x
  )));
  const hiddenOnes = canvas.blocks.filter((b) => b.phone?.hidden);
  return (
    <div>
      <div className="space-y-2">
        {order.map((b, i) => (
          <div key={b.id}
            className={`rounded-xl border p-2 ${selIds.includes(b.id) ? 'border-[var(--primary)]' : 'border-[var(--line)]'}`}
            onClick={() => setSelId(b.id)}>
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="text-[10px] uppercase tracking-wider text-[var(--faint)] flex-1 min-w-0 truncate">{i + 1} · {t(`cst.kind.${b.kind}`, b.kind)}</span>
              {/* 32px targets, not the 12px handles the board uses: this is the one surface
                  that has to work with a thumb. */}
              <Button size="sm" variant="ghost" className="!px-2" disabled={i === 0} onClick={(e) => { e.stopPropagation(); swap(i, -1); }} title={t('cst.up', 'Move up')}><ArrowUp size={14} /></Button>
              <Button size="sm" variant="ghost" className="!px-2" disabled={i === order.length - 1} onClick={(e) => { e.stopPropagation(); swap(i, 1); }} title={t('cst.down', 'Move down')}><ArrowDown size={14} /></Button>
              <Button size="sm" variant="ghost" className="!px-2" onClick={(e) => { e.stopPropagation(); togglePhoneHidden(b); }} title={t('cst.phone.hide', 'Leave this out of the phone version')}><EyeOff size={14} /></Button>
              <Button size="sm" variant="ghost" className="!px-2 !text-[var(--error)]" onClick={(e) => { e.stopPropagation(); removeIds([b.id]); }} title={t('cst.del', 'Delete')}><Trash2 size={14} /></Button>
            </div>
            {/* The block exactly as the reader gets it, stacked — the same component the
                public page paints with, so this is not a second opinion about how it looks.
                Not interactive: a tap anywhere on the row selects it. */}
            <div className="rounded-lg overflow-hidden pointer-events-none"><CanvasBlock b={b} stacked /></div>
          </div>
        ))}
        {/* "add a block above" pointed at a toolbar that is not always on screen in this
            mode. The button is the instruction. */}
        {!order.length && (
          <div className="text-center py-8 px-4 rounded-xl border border-dashed border-[var(--line)]">
            <div className="text-[13px] font-semibold">{t('cst.stack.empty', 'No blocks on this page')}</div>
            <div className="text-xs text-[var(--muted)] mt-1">{t('cst.stack.empty.s', 'This is the order a phone reads the page in, so it fills up as you add blocks.')}</div>
            <div className="mt-3 flex justify-center">
              <Button size="sm" variant="primary" onClick={() => add('text')}><Type size={14} /> {t('cst.empty.add', 'Add a text block')}</Button>
            </div>
          </div>
        )}
      </div>
      {/* A block left out of the phone version is still on the board, and the only place
          that fact can be seen is here — on the board it looks exactly like every other
          block. Without this row it is hidden from the one screen that hid it. */}
      {hiddenOnes.length > 0 && (
        <div className="mt-3 rounded-xl border border-dashed border-[var(--line)] p-2">
          <div className="text-[10px] uppercase tracking-wider text-[var(--faint)] mb-1.5">{t('cst.phone.hidden', 'Not shown on phones')}</div>
          <div className="flex flex-wrap gap-1.5">
            {hiddenOnes.map((b) => (
              <Button key={b.id} size="sm" variant="ghost" className="!px-2" onClick={() => togglePhoneHidden(b)}>
                <Eye size={13} /> {t(`cst.kind.${b.kind}`, b.kind)}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * What a reader gets, framed as the device they would read it on. The SAME CanvasView the
 * public page renders — a preview drawn by anything else would be a second opinion.
 * `renderPage` (page mode) shows the whole project page with this canvas in its tab.
 */
const DEVICE_WIDTHS = { desktop: 1280, tablet: 820, phone: 390 };

function PreviewSurface({ t, preview, canvas, renderPage, onReplay, pageNote = null }) {
  /**
   * Every mode is a device at a real width, including `desktop`.
   *
   * It used to be the odd one out: phone got 390 and tablet 820, and `desktop` got no frame
   * at all — so what it showed was the pane it happened to be in. In the config editor's
   * modal that pane is a settings column, which made "desktop preview" a 1200px page drawn
   * inside about 600px of it. A named width, shown next to the name, is the only way the
   * author can tell what they are being shown.
   */
  const frame = DEVICE_WIDTHS[preview] || null;
  const onPage = preview === 'page';
  // The page preview is the REAL route in a frame (editor/studio-page-frame.jsx), at the width
  // of a device, so its own header, footer, backdrop and media queries are the ones a visitor
  // on that device gets. The width is the frame's, not this pane's: wider than the pane, the
  // preview scrolls sideways rather than lying about the width.
  const [pageDevice, setPageDevice] = useState('desktop');
  const label = onPage
    ? t('cst.preview.page', 'The whole project page, with this block in place')
    : { desktop: t('cst.preview.desktop', 'Desktop preview'), tablet: t('cst.preview.tablet', 'Tablet preview'), phone: t('cst.phone.h', 'What a phone gets: the canvas stacks') }[preview] || '';
  return (
    <div className="cst-preview" data-preview-mode={preview}>
      <div className="flex items-center gap-2 flex-wrap mb-3 text-[11px] text-[var(--faint)]">
        <span className="inline-flex items-center gap-1"><Monitor size={12} /> {t('cst.previewing', 'Preview, editing is paused')}</span>
        <span className="inline-flex items-center gap-1 text-[var(--muted)]">
          {label}{frame ? ` · ${frame}px` : ''}
        </span>
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={onReplay} title={t('cst.replay.anim.h', 'Mount the page again so every entrance animation plays from the start')}><RotateCcw size={13} /> {t('cst.replay.anim', 'Replay animations')}</Button>
      </div>
      {/* Nothing is silently missing: when this document belongs to no page, the reason is
          said here rather than leaving the author to notice a button that is not there. */}
      {onPage && !renderPage && (
        <p className="mb-3 text-xs text-[var(--muted)] rounded-xl border border-dashed border-[var(--line)] p-3">{pageNote}</p>
      )}
      {onPage && renderPage ? (
        <>
          <div className="flex items-center gap-1 flex-wrap mb-2" role="group" aria-label={t('cst.preview.devices', 'Device width')}>
            {Object.entries(PAGE_DEVICES).map(([k, w]) => (
              <Button key={k} size="sm" variant={pageDevice === k ? 'primary' : 'ghost'} aria-pressed={pageDevice === k} onClick={() => setPageDevice(k)}>
                {t(`cst.preview.dev.${k}`, k)} · {w}px
              </Button>
            ))}
          </div>
          <div className="overflow-x-auto">
            <div className="mx-auto" style={{ width: PAGE_DEVICES[pageDevice] }} data-page-device={pageDevice}>
              {renderPage(canvas, PAGE_DEVICES[pageDevice])}
            </div>
          </div>
        </>
      ) : (
        <div className={frame ? 'cst-device mx-auto max-w-full' : ''} style={frame ? { width: frame } : undefined}>
          <CanvasView canvas={canvas} stackPreview={preview === 'phone'} />
        </div>
      )}
    </div>
  );
}

/**
 * Page mode's top bar: the document, its save state, undo/redo, the board, the previews.
 *
 * This bar used to be a single wrapping flex row whose left-hand group was `flex-1 min-w-0`
 * — flex-basis 0 — and that combination is the bug the studio was reported for. A flex-basis
 * of 0 contributes NOTHING to where a wrapping container breaks its lines, so the browser
 * packed every button onto the first line and then handed the document group whatever was
 * left. Measured at a 700px pane the document's name was 5px wide out of the 306px it needed;
 * at 480–560px it was 0px, and the "Unsaved changes" label — `whitespace-nowrap` in a box that
 * had been squeezed to 39px — spilled out of that box and ran underneath the undo and redo
 * icons. Below ~570px the controls finally did wrap and the bar grew from 42px to 108px,
 * taking that much off the board on the smallest screen in the house.
 *
 * So: the bar no longer wraps. The document group has a real basis and clips its own overflow
 * (with the full title one hover away, because a clipped value must stay readable), and below
 * the three-pane width the secondary clusters move into one menu instead of onto a second
 * line. One row at every width, and nothing falls off the screen.
 */
function PageTopBar({ t, chrome, hist, doUndo, doRedo, preview, setPreview, themeSwitch, hasPage,
  wide = true, onKeys, onTour, panelsMenu, setPanelsMenu, dock, panels, applyDock, resetDock,
  board = 'light', title = '', onTitle }) {
  const [more, setMore] = useState(false);
  const state = chrome?.state || 'saved';
  const stateLabel = {
    saved: t('cst.save.saved', 'Saved'),
    dirty: t('cst.save.dirty', 'Unsaved changes'),
    saving: t('cst.save.saving', 'Saving…'),
    error: t('cst.save.error', 'Save failed'),
  }[state] || '';
  const tog = (v) => setPreview((cur) => (cur === v ? '' : v));
  /**
   * The preview group, with ONE phone in the bar.
   *
   * Measured before this change: `lucide-smartphone` appeared twice in `.cst-topbar`, three
   * buttons apart — once in the board switch ("author the 390px phone board") and once here
   * ("preview what a phone gets"). Two controls owning the same idea and the same glyph is
   * the duplication, so it is removed where it starts rather than hidden: the preview now
   * previews the board being AUTHORED. On the phone board the first entry IS the phone, and
   * on the light or dark board it is the desktop. The phone preview is therefore one click
   * from the phone board, which is where somebody thinking about phones already is.
   */
  const phoneTarget = board === 'phone';
  const previewGroup = (
    <div className="inline-flex rounded-lg border border-[var(--line)] overflow-hidden" data-tour="preview" role="group" aria-label={t('cst.preview', 'Preview')}>
      {[phoneTarget
        ? ['phone', Smartphone, t('cst.phone.h', 'What a phone gets: the canvas stacks')]
        : ['desktop', Monitor, t('cst.preview.desktop', 'Desktop preview')],
      ['tablet', Tablet, t('cst.preview.tablet', 'Tablet preview')],
      /* The page button is ALWAYS here. It used to be dropped when the document belonged to
         no page, which left the author with a preview group that quietly had one fewer
         control than it does elsewhere and no way to find out why. Disabled, with the reason
         on it, is the version that can be read. */
      ['page', FileText,
        hasPage
          ? t('cst.preview.page', 'The whole project page, with this block in place')
          : t('cst.preview.page.none', 'This document is not part of a page yet, so there is no page to show it in.'),
        !hasPage]].map(([k, Icon, label, off]) => (
        <button key={k} type="button" onClick={() => tog(k)} title={label} aria-label={label} aria-pressed={preview === k}
          disabled={!!off} aria-disabled={off ? 'true' : undefined}
          className={`inline-flex items-center px-2 py-1 text-xs ${off ? 'text-[var(--faint)] cursor-not-allowed' : preview === k ? 'tint-primary text-[var(--text)]' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>
          <Icon size={13} />
        </button>
      ))}
    </div>
  );
  const keysButton = (
    <Button size="sm" variant="ghost" className="!px-2" onClick={onKeys} title={t('cst.keys.h2', 'Keyboard shortcuts (?)')} aria-label={t('cst.keys', 'Keyboard shortcuts')}><Keyboard size={14} /></Button>
  );
  // The way back into the tour. It runs itself once and is then never seen again, so without
  // this the author who dismissed it on the first afternoon has no way to ask for it.
  const tourButton = onTour ? <TourButton t={t} onClick={onTour} /> : null;
  return (
    <header className="cst-topbar">
      {/* The document. A real basis, so it takes part in the layout instead of being handed
          whatever is left, and `overflow:hidden` on the group so the save-state label cannot
          run out of it and over the buttons after it. */}
      <div className="cst-topbar-id">
        <Button size="sm" variant="ghost" className="!px-2" onClick={chrome?.onBack} title={t('cst.back.h', 'Back to the page settings')} aria-label={t('common.back', 'Back')}><ArrowLeft size={15} /></Button>
        {/* The page's name, edited where it is shown. It was read-only here and editable only
            back in the config editor, which meant leaving the studio to rename the thing you
            are looking at. It looks like the label it replaces until it is focused. */}
        {onTitle ? (
          <input className="cst-title" value={title}
            onChange={(e) => onTitle(e.target.value.slice(0, 120))}
            placeholder={t('pce.canvases.untitled', 'Untitled page')}
            aria-label={t('cst.title', 'Name of this page')}
            title={title || t('cst.title', 'Name of this page')} />
        ) : (
          <span className="font-medium text-sm truncate" title={chrome?.title || t('pce.canvases.untitled', 'Untitled page')}>{chrome?.title || t('pce.canvases.untitled', 'Untitled page')}</span>
        )}
        <span className={`text-[11px] whitespace-nowrap ${state === 'error' ? 'text-error' : state === 'dirty' ? 'text-warning' : 'text-[var(--faint)]'}`} data-save-state={state}>{stateLabel}</span>
        {chrome?.draftRestored && (
          <button type="button" className="text-[11px] text-[var(--accent-ink)] hover:underline whitespace-nowrap" onClick={chrome.onDiscardDraft} title={t('cst.draft.h', 'A draft from this tab was restored. Discard it to go back to what is saved.')}>{t('cst.draft.discard', 'Discard draft')}</button>
        )}
      </div>
      <div className="cst-topbar-tools">
        <Button size="sm" variant="ghost" className="!px-2" disabled={!hist.past.length} onClick={doUndo} data-undo-steps={hist.past.length} title={`Ctrl+Z · ${hist.past.length}`} aria-label={t('cst.undo', 'Undo')}><Undo2 size={14} /></Button>
        <Button size="sm" variant="ghost" className="!px-2" disabled={!hist.future.length} onClick={doRedo} title="Ctrl+Shift+Z" aria-label={t('cst.redo', 'Redo')}><Redo2 size={14} /></Button>
        {wide ? (<>
          <span className="cst-topbar-sep" />
          {!preview && themeSwitch}
          <span className="cst-topbar-sep" />
          {previewGroup}
          {keysButton}
          {tourButton}
          <span className="cst-topbar-pop">
            <Button size="sm" variant={panelsMenu ? 'primary' : 'ghost'} className="!px-2" onClick={() => setPanelsMenu((v) => !v)}
              title={t('cst.dock.panels.h', 'Which panels are open, and where they sit')} aria-label={t('cst.dock.panels', 'Panels')} aria-expanded={!!panelsMenu}><PanelsTopLeft size={14} /></Button>
            {panelsMenu && (
              <PanelsMenu t={t} layout={dock} panels={panels} apply={applyDock} reset={resetDock} onClose={() => setPanelsMenu(false)} />
            )}
          </span>
        </>) : (
          /* Below the three-pane width the secondary clusters go into ONE opaque menu rather
             than onto a second line: a bar that grows to 108px takes an eighth of a phone
             away from the thing being edited. */
          <span className="cst-topbar-pop">
            <Button size="sm" variant={more ? 'primary' : 'ghost'} className="!px-2" onClick={() => setMore((v) => !v)}
              title={t('cst.more', 'More')} aria-label={t('cst.more', 'More')} aria-expanded={more}><MoreHorizontal size={14} /></Button>
            {more && (
              <div className="cst-menu" role="menu">
                <div className="cst-menu-h">{t('cst.theme.board', 'Board')}</div>
                <div className="px-2 pb-1.5">{themeSwitch}</div>
                <div className="cst-menu-sep" />
                <div className="cst-menu-h">{t('cst.preview', 'Preview')}</div>
                <div className="px-2 pb-1.5">{previewGroup}</div>
                <div className="cst-menu-sep" />
                <button type="button" className="cst-menu-item" onClick={() => { setMore(false); onKeys?.(); }}>
                  <Keyboard size={12} /> {t('cst.keys', 'Keyboard shortcuts')}
                </button>
                {onTour && (
                  <button type="button" className="cst-menu-item" onClick={() => { setMore(false); onTour(); }}>
                    <GraduationCap size={12} /> {t('cst.tour.again', 'Take the tour of the studio')}
                  </button>
                )}
              </div>
            )}
          </span>
        )}
        {preview && <Button size="sm" variant="ghost" className="!px-2" onClick={() => setPreview('')} title={t('cst.preview.close', 'Close preview')} aria-label={t('cst.preview.close', 'Close preview')}><X size={14} /></Button>}
        <Button size="sm" variant="primary" disabled={chrome?.canSave === false || state === 'saving'} onClick={chrome?.onSave} title="Ctrl+S"><Save size={14} /> <span className="cst-hide-narrow">{t('common.save', 'Save')}</span></Button>
      </div>
    </header>
  );
}

/** The palette: every kind of block, and the shapes. One of the dock's panels. */
function BlocksPanel({ t, add, addShape }) {
  const kinds = [['text', Type], ['image', ImageIcon], ['box', Square], ['button', MousePointerClick], ['video', Film], ['embed', Globe], ['replay', PlayCircle], ['svg', Sparkles]];
  return (
    // `data-tour` sits on the PANEL, not on the zone it happens to be docked in: the author
    // can drag any panel to any side, and an anchor that named a zone would point at whatever
    // they had moved there instead.
    <div className="space-y-2" data-tour="blocks">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)]">{t('cst.pane.blocks.h', 'Add to the page')}</div>
      <div className="grid grid-cols-2 gap-1.5">
        {kinds.map(([k, Icon]) => (
          <Button key={k} size="sm" variant="ghost" className="justify-start" onClick={() => add(k)}><Icon size={14} /> {t(`cst.add.${k}`, k)}</Button>
        ))}
      </div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] pt-1">{t('cst.shape', 'Shape')}</div>
      <div className="grid grid-cols-3 gap-1">
        {SHAPES.map((s) => (
          <button key={s} type="button" onClick={() => addShape(s)} className="text-[11px] px-1.5 py-1.5 rounded-lg border border-[var(--line)] hover:b-primary truncate" title={t(`cst.shape.${s}`, s)}>{t(`cst.shape.${s}`, s)}</button>
        ))}
      </div>
    </div>
  );
}

/** The saved components: a thumbnail, a name, insert and delete. */
function ComponentsPanel({ t, components, insertComponent, deleteComponent }) {
  return (
    <div className="space-y-2" data-tour="components">
      <p className="text-[11px] text-[var(--muted)]">{t('cst.cmp.h', 'Select blocks on the board and choose “Save as component” to keep them here. Inserting places a copy; copies stay linked until you detach them.')}</p>
      {/* The action is a selection on the board, not a button that can live here — so the
          sentence names it rather than pretending there is something to press. */}
      {!components.length && (
        <div className="text-center py-6 px-3 rounded-xl border border-dashed border-[var(--line)]">
          <div className="text-[13px] font-semibold">{t('cst.cmp.empty', 'No saved components')}</div>
          <div className="text-xs text-[var(--muted)] mt-1">{t('cst.cmp.empty.s', 'Select blocks on the board, then use “Save as component” to keep that group here for every page you edit.')}</div>
        </div>
      )}
      <div className="space-y-1.5">
        {components.map((c) => (
          <div key={c.id} className="flex items-center gap-2 rounded-lg border border-[var(--line)] p-1.5">
            <span className="w-10 h-10 shrink-0 rounded-md bg-[var(--surface-2)] overflow-hidden" aria-hidden dangerouslySetInnerHTML={{ __html: thumbnailSvg(c.blocks, 40) }} />
            <span className="flex-1 min-w-0">
              <span className="block text-xs font-medium truncate" title={c.name}>{c.name}</span>
              <span className="block text-[10px] text-[var(--faint)] tabular-nums">{t('pce.canvases.n', '{n} block(s)').replace('{n}', c.blocks.length)} · {c.w}×{c.h}</span>
            </span>
            <Button size="sm" variant="ghost" className="!px-2" onClick={() => insertComponent(c)} title={t('cst.cmp.insert', 'Insert a copy')} aria-label={t('cst.cmp.insert', 'Insert a copy')}><Plus size={14} /></Button>
            <Button size="sm" variant="ghost" className="!px-2 !text-[var(--error)]" onClick={() => deleteComponent(c.id)} title={t('cst.cmp.delete', 'Delete this component (copies on pages stay)')} aria-label={t('cst.cmp.delete', 'Delete this component (copies on pages stay)')}><Trash2 size={14} /></Button>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Name the selection and keep it. The thumbnail is the same one the list will show. */
function SaveComponentModal({ t, blocks, onSave, onClose }) {
  const [name, setName] = useState('');
  return (
    <Modal open onClose={onClose} title={t('cst.cmp.saveas', 'Save as component')} icon={Puzzle}
      footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button><Button variant="primary" disabled={!name.trim() || !blocks.length} onClick={() => onSave(name)}>{t('common.save', 'Save')}</Button></>}>
      <div className="flex items-start gap-3">
        <span className="w-24 h-24 shrink-0 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] overflow-hidden" aria-hidden dangerouslySetInnerHTML={{ __html: thumbnailSvg(blocks, 96) }} />
        <div className="flex-1 min-w-0 space-y-2">
          <Field label={t('cst.cmp.name', 'Name')}><Input autoFocus value={name} maxLength={COMPONENT_LIMITS.name} onChange={(e) => setName(e.target.value)} placeholder={t('cst.cmp.name.ph', 'Pricing card, hero, footer…')} onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) onSave(name); }} /></Field>
          <p className="text-[11px] text-[var(--muted)]">{t('cst.cmp.saveas.h', '{n} block(s), kept with their layout. Available on every page you edit, from the Components tab.').replace('{n}', blocks.length)}</p>
        </div>
      </div>
    </Modal>
  );
}

/** In the inspector when the selection came from a component: detach, refresh, redefine. */
function ComponentSection({ t, ids, components, onDetach, onRefresh, onRedefine }) {
  return (
    <div className="mt-3 rounded-xl border border-[var(--line)] p-3 space-y-2">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] flex items-center gap-1.5"><Puzzle size={12} /> {t('cst.cmp', 'Components')}</div>
      {ids.map((id) => {
        const c = components.find((x) => x.id === id);
        return (
          <div key={id} className="space-y-1.5">
            <div className="text-xs font-medium truncate">{c ? c.name : t('cst.cmp.gone', 'A component that was deleted')}</div>
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="ghost" onClick={onDetach} title={t('cst.cmp.detach.h', 'Keep the blocks, forget the link, updates to the component no longer reach them')}><Unlink size={13} /> {t('cst.cmp.detach', 'Detach')}</Button>
              {c && <Button size="sm" variant="ghost" onClick={() => onRefresh(id)} title={t('cst.cmp.refresh.h', 'Rebuild every copy on this page from the saved component')}><RefreshCw size={13} /> {t('cst.cmp.refresh', 'Update all copies')}</Button>}
              {c && <Button size="sm" variant="ghost" onClick={() => onRedefine(id)} title={t('cst.cmp.redefine.h', 'Make the selection the new definition, and rebuild every copy from it')}><Save size={13} /> {t('cst.cmp.redefine', 'Redefine from selection')}</Button>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** What a new page shows before it has anything on it: the three panes, in one sentence each. */
function EmptyBoard({ t, onAdd, onOpenBlocks }) {
  return (
    <div className="mb-3 rounded-xl border border-dashed border-[var(--line)] p-4 text-sm" data-empty-board>
      <div className="font-medium mb-1">{t('cst.empty.title', 'This page is empty')}</div>
      <ul className="text-xs text-[var(--muted)] space-y-1 mb-3">
        <li><span className="font-medium text-[var(--text)]">{t('cst.pane.blocks', 'Blocks')}</span> — {t('cst.empty.blocks', 'on the left: everything you can add, the layers, and your saved components.')}</li>
        <li><span className="font-medium text-[var(--text)]">{t('cst.pane.canvas', 'Canvas')}</span> — {t('cst.empty.canvas', 'in the middle: a 1200px board. Drag to move, pull a handle to resize, drag on empty space to select several.')}</li>
        <li><span className="font-medium text-[var(--text)]">{t('cst.pane.props', 'Properties')}</span> — {t('cst.empty.props', 'on the right: everything about the selected block, content, size, animation, link.')}</li>
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="primary" onClick={onAdd}><Type size={14} /> {t('cst.empty.add', 'Add a text block')}</Button>
        <Button size="sm" variant="ghost" onClick={onOpenBlocks}><Blocks size={14} /> {t('cst.empty.browse', 'Browse the blocks')}</Button>
      </div>
    </div>
  );
}


/**
 * The Layers panel: every block, top of the paint order first, with its name, a lock, an eye
 * and the two arrows. The one place a hidden block can be found again, and the one place a
 * block under three others can be selected without moving them.
 */
function LayersPanel({ t, canvas, view, selIds, setSelIds, patch, emit, add, bare = false, offIds = null }) {
  const rows = paintOrder(view.blocks).slice().reverse();
  return (
    // `bare` is the dock's form: the panel already has a title bar and a border of its own, and
    // a second one inside it reads as a box in a box.
    <div className={bare ? '' : 'mb-3 rounded-xl border border-[var(--line)] p-2'}>
      {!bare && (
        <div className="flex items-center gap-1.5 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)]">
          <LayoutList size={12} /> {t('cst.layers', 'Layers')}
          <span className="ms-auto tabular-nums font-normal">{rows.length}</span>
        </div>
      )}
      {!rows.length && (
        <div className="py-3 text-center">
          <div className="text-xs text-[var(--muted)]">{t('cst.layers.empty', 'No blocks yet, so there is no paint order to show.')}</div>
          {add && <div className="mt-2 flex justify-center">
            <Button size="sm" variant="primary" onClick={() => add('text')}><Type size={14} /> {t('cst.empty.add', 'Add a text block')}</Button>
          </div>}
        </div>
      )}
      <div className={`${bare ? '' : 'max-h-56 overflow-auto '}space-y-0.5`}>
        {rows.map((b, i) => {
          const on = selIds.includes(b.id);
          return (
            <div key={b.id}
              className={`flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs cursor-pointer ${on ? 'tint-primary' : 'hover:bg-[var(--surface-2)]'}`}
              onClick={(e) => setSelIds(e.shiftKey || e.ctrlKey || e.metaKey ? (on ? selIds.filter((x) => x !== b.id) : [...selIds, b.id]) : [b.id])}>
              <span className={`flex-1 min-w-0 truncate ${b.hidden ? 'text-[var(--faint)] line-through' : ''}`}>
                {b.name || t(`cst.kind.${b.kind}`, b.kind)}
                {!b.name && <span className="text-[var(--faint)] ms-1">#{b.id.slice(-3)}</span>}
              </span>
              {/* Outside the page frame: kept on the board, never shown to a reader. Said here
                  because the board itself may be zoomed so the block is nowhere on screen. */}
              {offIds?.has(b.id) && (
                <span className="cst-offframe" data-off-frame title={t('cst.frame.off.h', 'Outside the page frame: it stays on the board, and visitors never see it')}>
                  {t('cst.frame.off', 'Off frame')}
                </span>
              )}
              <button type="button" className="p-0.5 rounded hover:bg-[var(--surface-2)] disabled:opacity-30" disabled={i === 0} onClick={(e) => { e.stopPropagation(); emit(reorder(canvas.blocks, b.id, 'up')); }} title={t('cst.layer.up', 'Move up')} aria-label={t('cst.layer.up', 'Move up')}><ChevronUp size={12} /></button>
              <button type="button" className="p-0.5 rounded hover:bg-[var(--surface-2)] disabled:opacity-30" disabled={i === rows.length - 1} onClick={(e) => { e.stopPropagation(); emit(reorder(canvas.blocks, b.id, 'down')); }} title={t('cst.layer.down', 'Move down')} aria-label={t('cst.layer.down', 'Move down')}><ChevronDown size={12} /></button>
              <button type="button" className={`p-0.5 rounded hover:bg-[var(--surface-2)] ${b.locked ? 'text-[var(--accent-ink)]' : 'text-[var(--faint)]'}`} onClick={(e) => { e.stopPropagation(); patch(b.id, { locked: !b.locked }); }} title={b.locked ? t('cst.layer.unlock', 'Unlock') : t('cst.layer.lock', 'Lock')} aria-label={b.locked ? t('cst.layer.unlock', 'Unlock') : t('cst.layer.lock', 'Lock')}>{b.locked ? <Lock size={12} /> : <LockOpen size={12} />}</button>
              <button type="button" className={`p-0.5 rounded hover:bg-[var(--surface-2)] ${b.hidden ? 'text-[var(--accent-ink)]' : 'text-[var(--faint)]'}`} onClick={(e) => { e.stopPropagation(); patch(b.id, { hidden: !b.hidden }); }} title={b.hidden ? t('cst.layer.show', 'Show') : t('cst.layer.hide', 'Hide')} aria-label={b.hidden ? t('cst.layer.show', 'Show') : t('cst.layer.hide', 'Hide')}>{b.hidden ? <EyeOff size={12} /> : <Eye size={12} />}</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The button block's own fields: the look, the action, and the action's parameters. */
function ButtonFields({ t, p, setProp }) {
  const act = p.action || { type: 'link' };
  const setAct = (k, v) => setProp('action', { ...act, [k]: v });
  // The same decision the page makes (lib/canvas.js), so the editor's red is the page's inert.
  const target = buttonTarget(act);
  const items = Array.isArray(p.items) ? p.items : [];
  const itemsText = items.map((it) => `${it.label || ''} | ${it.href || ''}`).join('\n');
  const isDropdown = (p.variant || 'button').startsWith('dropdown');
  return (<>
    <Field label={t('cst.btn.label', 'Label')}><Input value={p.label || ''} onChange={(e) => setProp('label', e.target.value)} /></Field>
    <div className="grid grid-cols-2 gap-2">
      <Field label={t('cst.btn.variant', 'Look')}>
        <Select value={p.variant || 'button'} onChange={(e) => setProp('variant', e.target.value)}>
          {BUTTON_VARIANTS.map((v) => <option key={v} value={v}>{t(`cst.btn.v.${v}`, v)}</option>)}
        </Select>
      </Field>
      <Field label={t('cst.btn.size', 'Size')}>
        <Select value={p.size || 'md'} onChange={(e) => setProp('size', e.target.value)}>
          {['sm', 'md', 'lg'].map((v) => <option key={v} value={v}>{v}</option>)}
        </Select>
      </Field>
    </div>
    <div className="grid grid-cols-2 gap-2">
      <Field label={t('cst.btn.color', 'Colour')}><Input value={p.color || ''} onChange={(e) => setProp('color', e.target.value)} placeholder="#f97316" /></Field>
      <Field label={t('cst.btn.align', 'Align')}>
        <Select value={p.align || 'center'} onChange={(e) => setProp('align', e.target.value)}>
          {['left', 'center', 'right'].map((v) => <option key={v} value={v}>{t(`cst.btn.align.${v}`, v)}</option>)}
        </Select>
      </Field>
    </div>
    <label className="flex items-center gap-1.5 text-xs cursor-pointer"><input type="checkbox" checked={!!p.outline} onChange={(e) => setProp('outline', e.target.checked)} /> {t('cst.btn.outline', 'Outline')}</label>
    {p.variant === 'card' && <Field label={t('cst.btn.desc', 'Description (card)')}><Input value={p.desc || ''} onChange={(e) => setProp('desc', e.target.value)} /></Field>}
    {isDropdown ? (
      <Field label={t('cst.btn.items', 'Menu items, one per line: label | link')}>
        <Textarea rows={4} value={itemsText} onChange={(e) => setProp('items', e.target.value.split('\n').map((l) => { const [label, href] = l.split('|'); return { label: (label || '').trim(), href: (href || '').trim() }; }).filter((it) => it.label))} />
        {items.some((it) => it.href && !menuItemHref(it.href)) && (
          <p className="text-[11px] text-error mt-1" role="alert">
            {t('cst.btn.items.unsafe', 'Refused, these entries lead nowhere for visitors: {list}').replace('{list}', items.filter((it) => it.href && !menuItemHref(it.href)).map((it) => it.label).join(', '))}
          </p>
        )}
      </Field>
    ) : (<>
      {/* An action this page may no longer run is said, in red, with the reason (D5): the
          button renders inert for visitors, and an author must never discover that by a
          silent button. The select offers only the actions that still exist. */}
      {LEGACY_ACTIONS[act.type] && (
        <div className="rounded-lg border border-[var(--error-border)] p-2 text-[11px] text-error" data-legacy-action={act.type} role="alert">
          {t('cst.btn.legacy.api', 'This button called the site API with the visitor’s own session. That action was removed for security: the button does nothing for visitors now. Pick another action below.')}
        </div>
      )}
      <Field label={t('cst.btn.action', 'On press')}>
        <Select value={LEGACY_ACTIONS[act.type] ? '' : (act.type || 'link')} onChange={(e) => setProp('action', { type: e.target.value, ...(act.href ? { href: act.href } : {}), ...(act.text ? { text: act.text } : {}), ...(act.target ? { target: act.target } : {}) })}>
          {LEGACY_ACTIONS[act.type] && <option value="">{t('cst.btn.a.pick', 'Choose an action')}</option>}
          {BUTTON_ACTIONS.map((v) => <option key={v} value={v}>{t(`cst.btn.a.${v}`, v)}</option>)}
        </Select>
      </Field>
      {(act.type === 'link' || act.type === 'download' || !act.type) && <Field label={t('cst.btn.href', 'Link')}><Input value={act.href || ''} onChange={(e) => setAct('href', e.target.value)} placeholder="/hosting · https://…" /></Field>}
      {target.reason === 'unsafe_url' && <p className="text-[11px] text-error" role="alert">{t('cst.btn.unsafe', 'This link is refused: only a path on this site, an anchor (#), an http(s) address or a mailto. It does nothing for visitors.')}</p>}
      {act.type === 'copy' && <Field label={t('cst.btn.copytext', 'Text to copy')}><Input value={act.text || ''} onChange={(e) => setAct('text', e.target.value)} /></Field>}
      {act.type === 'scroll' && <Field label={t('cst.btn.target.id', 'Scroll to (an element id, e.g. #plans)')}><Input value={act.target || ''} onChange={(e) => setAct('target', e.target.value)} placeholder="#plans" /></Field>}
      {target.reason === 'bad_scroll_target' && <p className="text-[11px] text-error" role="alert">{t('cst.btn.badscroll', 'Only an element id is accepted here (# then letters, digits, - or _), not a CSS selector. The button does nothing for visitors until it is one.')}</p>}
      <Field label={t('cst.btn.done.copy', 'Label after copying')}><Input value={p.doneLabel || ''} onChange={(e) => setProp('doneLabel', e.target.value)} placeholder="✓" /></Field>
    </>)}
  </>);
}

/** How a block arrives, and whether it keeps moving. On every kind. */
function AnimFields({ t, sel, patch }) {
  const a = sel.anim || null;
  const set = (k, v) => patch(sel.id, { anim: { ...(a || { kind: 'fade' }), [k]: v } });
  return (
    <div className="rounded-lg border border-[var(--line)] p-2 space-y-2">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] flex items-center gap-1.5"><Sparkles size={12} /> {t('cst.anim', 'Animation')}</div>
      <Field label={t('cst.anim.kind', 'Kind')}>
        <Select value={a?.kind || ''} onChange={(e) => (e.target.value ? set('kind', e.target.value) : patch(sel.id, { anim: null }))}>
          <option value="">{t('cst.anim.none', 'None')}</option>
          {ANIM_KINDS.map((k) => <option key={k} value={k}>{t(`cst.anim.k.${k}`, k)}</option>)}
        </Select>
      </Field>
      {a && (<>
        <Field label={t('cst.anim.trigger', 'Starts')}>
          <Select value={a.trigger || 'show'} onChange={(e) => set('trigger', e.target.value)}>
            {ANIM_TRIGGERS.map((k) => <option key={k} value={k}>{t(`cst.anim.t.${k}`, k)}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('cst.anim.delay', 'Delay (ms)')}><Input type="number" min="0" step="50" value={a.delay ?? 0} onChange={(e) => set('delay', Number(e.target.value) || 0)} /></Field>
          <Field label={t('cst.anim.duration', 'Duration (ms)')}><Input type="number" min="50" step="50" value={a.duration ?? 700} onChange={(e) => set('duration', Number(e.target.value) || 700)} /></Field>
        </div>
        {/* The curve. A NAME, resolved to a bezier by lib/canvas.js at render time: the value
            reaches a style attribute on a public page, so the author picks from a list rather
            than typing CSS into it. */}
        <Field label={t('cst.anim.easing', 'Curve')} hint={t('cst.anim.easing.h', 'How it moves through its duration. Spring overshoots a little at the end.')}>
          <Select value={a.easing || 'smooth'} onChange={(e) => set('easing', e.target.value)}>
            {ANIM_EASINGS.map((k) => <option key={k} value={k}>{t(`cst.anim.e.${k}`, k)}</option>)}
          </Select>
        </Field>
        <label className="flex items-center gap-1.5 text-xs cursor-pointer"><input type="checkbox" checked={!!a.loop} onChange={(e) => set('loop', e.target.checked)} /> {t('cst.anim.loop', 'Loop')}</label>
        {a.kind === 'custom' && (
          <Field label={t('cst.anim.custom', 'Keyframes (the body of an @keyframes rule)')} hint={t('cst.anim.custom.h', 'e.g.  from { opacity: 0; transform: rotate(-6deg) }  to { opacity: 1; transform: none }')}>
            <Textarea rows={4} value={a.custom || ''} onChange={(e) => set('custom', e.target.value)} />
          </Field>
        )}
      </>)}
    </div>
  );
}

/**
 * Does this block's content overrun the box it was given?
 *
 * The public page CLIPS — a block has the size the author gave it, and content that spilled
 * would land on whatever is placed below. The cost is that overrunning text simply disappears
 * for the reader, silently: nothing errors, and on the author's own screen the box looks fine
 * because they wrote the text while it still fitted. So it is measured HERE, where it can be
 * fixed, rather than discovered by a visitor.
 *
 * Measured from the rendered content, not guessed from the character count: a `:::tip` inside
 * a text block is three times the height of the same words as a paragraph.
 */
function useOverflow(ref, deps) {
  const [over, setOver] = useState(0);
  useEffect(() => {
    const el = ref.current; if (!el) return undefined;
    const read = () => {
      const inner = el.firstElementChild;
      if (!inner) return;
      setOver(Math.max(0, Math.round(inner.scrollHeight - el.clientHeight)));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    // The content resizes when the block does AND when its text changes, so watch both.
    const ro = new ResizeObserver(read);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return over;
}

/** Handle placement, in the block's own box. */
function handlePos(hk) {
  const [ax, ay] = HANDLES[hk];
  const x = ax === -1 ? { left: -6 } : ax === 1 ? { right: -6 } : { left: 'calc(50% - 6px)' };
  const y = ay === -1 ? { top: -6 } : ay === 1 ? { bottom: -6 } : { top: 'calc(50% - 6px)' };
  return { ...x, ...y };
}

/** One block as the editor shows it: the public painting, plus a warning when it overruns. */
function BlockBody({ b }) {
  const ref = useRef(null);
  const over = useOverflow(ref, [b.w, b.h, b.kind, JSON.stringify(b.props)]);
  return (
    <>
      <div ref={ref} style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        <CanvasBlock b={b} />
      </div>
      {over > 2 && (
        <span title={`${over}px hidden — the public page clips this`}
          style={{ position: 'absolute', right: 2, bottom: 2, display: 'inline-flex', alignItems: 'center', gap: 3,
            background: 'var(--warning)', color: '#111', borderRadius: 6, padding: '1px 5px', fontSize: 10, fontWeight: 700, pointerEvents: 'none' }}>
          <AlertTriangle size={10} /> +{over}px
        </span>
      )}
    </>
  );
}

// (the block painter is imported from canvas-view.jsx — see CanvasBlock there)

/** One block on the board. Memoised: only the block whose props changed re-renders. */
const BoardBlock = memo(function BoardBlock({ b, on, only, down, off = false, offLabel = '' }) {
  return (
    <div
      data-cst-block={b.id}
      data-off-frame={off ? '1' : undefined}
      onPointerDown={(e) => down(e, b, null)}
      // Off the frame: drawn and grabbable like any block (it is on the board), dimmed, because
      // a reader will never see it.
      style={{ position: 'absolute', left: b.x, top: b.y, width: b.w, height: b.h, zIndex: (b.z || 0) + (on ? 1000 : 0), cursor: b.locked ? 'default' : 'move', touchAction: 'none', opacity: b.hidden ? 0.3 : off ? 0.55 : undefined, transform: b.rotate ? `rotate(${b.rotate}deg)` : undefined }}>
      <BlockBody b={b} />
      <div style={{ position: 'absolute', inset: 0, outline: on ? '2px solid var(--primary)' : off ? '1px dashed var(--warning)' : '1px dashed var(--line-strong)', outlineOffset: 0, pointerEvents: 'none' }} />
      {off && <span aria-hidden className="cst-offframe cst-offframe-board">{offLabel}</span>}
      {(b.locked || b.hidden || b.component) && (
        <span aria-hidden data-component={b.component ? b.component.id : undefined} style={{ position: 'absolute', left: 2, top: 2, display: 'inline-flex', gap: 2, background: 'var(--bg-solid)', borderRadius: 6, padding: '1px 4px', pointerEvents: 'none' }}>
          {b.locked && <Lock size={10} />}{b.hidden && <EyeOff size={10} />}{b.component && <Puzzle size={10} />}
        </span>
      )}
      {only && !b.locked && Object.keys(HANDLES).map((hk) => (
        <span key={hk} onPointerDown={(e) => down(e, b, hk)}
          className="cst-handle"
          style={{ position: 'absolute', width: 12, height: 12, background: 'var(--primary)', borderRadius: 3, ...handlePos(hk), cursor: `${hk}-resize`, touchAction: 'none' }} />
      ))}
    </div>
  );
});

/**
 * What each background kind starts as when it is picked. `image` has no picture yet, which
 * normalises to `site`: the panel holds the chosen kind itself until a picture is set.
 */
const BG_START = {
  site: { type: 'site' },
  color: { type: 'color', color: 'var(--surface-2)' },
  gradient: { type: 'gradient', angle: 135, stops: [{ color: 'var(--primary)', at: 0 }, { color: 'var(--primary-2)', at: 100 }] },
  image: { type: 'image', src: '', fit: 'cover', position: 'center' },
  pattern: { type: 'pattern', id: 'dots', color: '#000000', size: 24, opacity: 0.18 },
  scene3d: { type: 'scene3d', shape: 'orb' },
  board: { type: 'board', color: 'var(--surface-2)', grid: 24 },
};
/** A few ready-made values per kind, shown as thumbnails under the kind picker. */
const BG_PRESETS = {
  color: ['var(--bg)', 'var(--surface)', 'var(--surface-2)', 'var(--surface-3)', 'var(--primary)', '#0f172a', '#fafaf9', '#fef3c7']
    .map((color) => ({ type: 'color', color })),
  gradient: [
    [135, 'var(--primary)', 'var(--primary-2)'], [180, 'var(--surface-2)', 'var(--bg)'], [160, '#0f172a', '#334155'],
    [120, '#fdf2f8', '#ede9fe'], [90, '#ecfeff', '#f0fdf4'], [200, '#1e1b4b', '#4c1d95'],
  ].map(([angle, a, b]) => ({ type: 'gradient', angle, stops: [{ color: a, at: 0 }, { color: b, at: 100 }] })),
  pattern: PATTERNS.map((p) => ({ type: 'pattern', id: p.id, color: '#000000', size: 24, opacity: 0.18 })),
  scene3d: SCENE_SHAPES.map((shape) => ({ type: 'scene3d', shape })),
  board: [0, 16, 24, 32].map((grid) => ({ type: 'board', color: 'var(--surface-2)', grid })),
};

/** Every label the Page panel prints, as literal keys (i18n-check reads literals only). */
function bgNames(t) {
  return {
    type: {
      site: t('cst.bg.type.site', 'Site'), color: t('cst.bg.type.color', 'Colour'), gradient: t('cst.bg.type.gradient', 'Gradient'),
      image: t('cst.bg.type.image', 'Picture'), pattern: t('cst.bg.type.pattern', 'Pattern'), scene3d: t('cst.bg.type.scene3d', '3D scene'),
      board: t('cst.bg.type.board', 'Board'),
    },
    hint: {
      site: t('cst.bg.type.site.h', 'Nothing of its own: the site background, and the site\u2019s 3D backdrop, show through.'),
      color: t('cst.bg.type.color.h', 'One colour behind the page. A site colour follows the reader\u2019s light or dark theme; your own does not.'),
      gradient: t('cst.bg.type.gradient.h', 'A straight gradient, two to four colours at an angle.'),
      image: t('cst.bg.type.image.h', 'A picture uploaded to this site, stretched, fitted or tiled.'),
      pattern: t('cst.bg.type.pattern.h', 'A tiling pattern in one colour.'),
      scene3d: t('cst.bg.type.scene3d.h', 'The site\u2019s 3D scene, set for this page alone.'),
      board: t('cst.bg.type.board.h', 'A colour and a dot grid that go on past the edges of the page, like a drawing board. The page grows with its content.'),
    },
    token: {
      bg: t('cst.bg.token.bg', 'Page'), 'bg-solid': t('cst.bg.token.bg-solid', 'Page, opaque'), surface: t('cst.bg.token.surface', 'Surface'),
      'surface-2': t('cst.bg.token.surface-2', 'Surface 2'), 'surface-3': t('cst.bg.token.surface-3', 'Surface 3'),
      primary: t('cst.bg.token.primary', 'Accent'), 'primary-2': t('cst.bg.token.primary-2', 'Second accent'), text: t('cst.bg.token.text', 'Text'),
      muted: t('cst.bg.token.muted', 'Muted text'), line: t('cst.bg.token.line', 'Line'), success: t('cst.bg.token.success', 'Success'),
      warning: t('cst.bg.token.warning', 'Warning'), error: t('cst.bg.token.error', 'Error'), info: t('cst.bg.token.info', 'Information'),
    },
    fit: { cover: t('cst.bg.fit.cover', 'Cover the page'), contain: t('cst.bg.fit.contain', 'Whole picture'), tile: t('cst.bg.fit.tile', 'Tile') },
    pos: {
      center: t('cst.bg.pos.center', 'Centre'), top: t('cst.bg.pos.top', 'Top'), bottom: t('cst.bg.pos.bottom', 'Bottom'),
      left: t('cst.bg.pos.left', 'Left'), right: t('cst.bg.pos.right', 'Right'),
    },
    scene: {
      detail: t('scn.detail', 'Detail'), noise: t('scn.noise', 'Distortion'), speed: t('scn.speed', 'Speed'), opacity: t('scn.opacity', 'Presence'),
      scale: t('scn.scale', 'Size'), glow: t('scn.glow', 'Halo'), twinkles: t('scn.tw', 'Dust'), fps: t('scn.fps', 'Frame budget'),
    },
    shape: {
      orb: t('scn.orb', 'Orb'), prism: t('scn.prism', 'Prism'), crystal: t('scn.crystal', 'Crystal'), gem: t('scn.gem', 'Gem'),
      ring: t('scn.ring', 'Knot'), halo: t('scn.halo', 'Halo'), cube: t('scn.cube', 'Cube'), spire: t('scn.spire', 'Spire'),
      capsule: t('scn.capsule', 'Capsule'), spiral: t('scn.spiral', 'Spiral'), vase: t('scn.vase', 'Vase'),
    },
    surface: { solid: t('scn.sf.solid', 'Solid'), wire: t('scn.sf.wire', 'Wireframe'), both: t('scn.sf.both', 'Both') },
  };
}

/** One colour: a site token (follows the reader's theme) or a hex of the author's own. */
function BgColorField({ t, names, label, value, onChange, hexOnly = false }) {
  const token = /^var\(--([a-z0-9-]+)\)$/.exec(value || '')?.[1] || '';
  const hex = /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#000000';
  return (
    <Field label={label}>
      <div className="flex items-center gap-1.5">
        {!hexOnly && (
          <Select value={token || 'hex'} onChange={(e) => onChange(e.target.value === 'hex' ? hex : `var(--${e.target.value})`)} className="!w-auto min-w-0 flex-1"
            aria-label={t('cst.bg.color.kind', 'Site colour or your own')}>
            {BG_TOKENS.map((k) => <option key={k} value={k}>{names.token[k] || k}</option>)}
            <option value="hex">{t('cst.bg.token.hex', 'Your own colour')}</option>
          </Select>
        )}
        {(hexOnly || !token) && (<>
          <input type="color" value={hex} onChange={(e) => onChange(e.target.value)} aria-label={label}
            className="h-8 w-9 shrink-0 cursor-pointer rounded border border-[var(--line)] bg-transparent p-0.5" />
          <Input value={value || ''} onChange={(e) => onChange(e.target.value.trim())} placeholder="#1e293b" className="min-w-0 flex-1 font-mono text-[12px]" spellCheck={false} />
        </>)}
      </div>
      {value && !(hexOnly ? patternColor(value) : bgColor(value)) && (
        <p className="text-[11.5px] text-warning mt-1">{t('cst.bg.color.bad', 'Not a colour this page can use: a hex like #1e293b, or one of the site colours.')}</p>
      )}
    </Field>
  );
}

/** A slider for one number of the 3D scene, with its bounds from the shared vocabulary. */
function SceneSlider({ label, k, value, shape, onChange }) {
  const b = SCENE_BOUNDS[k];
  const max = k === 'detail' ? Math.min(b.max, detailMaxFor(shape)) : b.max;
  const shown = b.unit === 'pct' ? `${Math.round(value * 100)} %` : b.unit === 'x' ? `${Number(value).toFixed(2)}x` : b.unit === 'fps' ? `${value} fps` : String(value);
  return (
    <label className="block">
      <span className="flex items-center justify-between text-[11.5px] text-[var(--muted)]">
        <span>{label}</span><span className="tabular-nums">{shown}</span>
      </span>
      <input type="range" min={b.min} max={max} step={b.step} value={value} className="w-full"
        onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

/**
 * The page itself: its background, the author's stylesheet (scoped), and file imports.
 *
 * A dock panel since phase 4 (PLAN-STUDIO-2026): it used to be a modal with its own Save, so
 * trying a background meant open, type, save, look, reopen. Every change now goes straight to
 * the document through `emit`, with undo, like every other panel, and the board shows it.
 */
function PagePanel({ t, canvas, emit, add, onClose = null }) {
  const bg = canvas.background || { type: 'site' };
  const names = bgNames(t);
  // The kind being edited. Usually the document's own; different only while a kind that needs
  // something first (an image with no picture yet) has been picked and not filled in.
  const [kind, setKind] = useState(bg.type);
  useEffect(() => { setKind(bg.type); }, [bg.type]);
  const [upBusy, setUpBusy] = useState(false);
  const toast = useToast();
  const setBg = (next, extra = {}) => emit(canvas.blocks, { background: next, ...extra }, 'page-bg');
  const pick = (type) => {
    setKind(type);
    if (type === bg.type) return;
    // The board is the "infinite canvas" reading of a page: its frame follows its content.
    const extra = type === 'board' ? { frames: { desktop: { fit: 'content' }, phone: { fit: 'content' } } } : {};
    setBg(BG_START[type], extra);
  };
  const set = (k, v) => setBg({ ...bg, [k]: v });
  const { refused } = scopeCss(canvas.css || '', '[data-cv="x"]');
  const importFile = async (file) => {
    if (!file) return;
    const text = await file.text();
    if (/\.svg$/i.test(file.name)) { add('svg', { props: { svg: sanitizeSvg(text) }, w: 320, h: 320 }); onClose?.(); }
    else emit(canvas.blocks, { css: (canvas.css ? `${canvas.css}\n\n` : '') + `/* ${file.name} */\n${text}` }, 'page-css-import');
  };
  const upload = async (file) => {
    if (!file) return;
    setUpBusy(true);
    try {
      const url = await uploadMedia(file);
      if (bgImagePath(url)) setBg({ type: 'image', src: url, fit: bg.type === 'image' ? bg.fit : 'cover', position: bg.type === 'image' ? bg.position : 'center' });
      else toast.error(t('cst.bg.image.bad', 'That picture is not stored on this site, so it cannot be a background.'));
    } catch { toast.error(t('cst.bg.image.fail', 'The picture could not be uploaded.')); }
    finally { setUpBusy(false); }
  };
  const img = bg.type === 'image' ? bg : BG_START.image;
  const stops = bg.type === 'gradient' ? bg.stops : [];
  const setStop = (i, patchStop) => set('stops', stops.map((s, j) => (j === i ? { ...s, ...patchStop } : s)));
  const presets = BG_PRESETS[kind] || [];
  const presetName = (p) => (p.type === 'pattern' ? t(`cst.pattern.${p.id}`, PATTERNS.find((x) => x.id === p.id)?.name || p.id)
    : p.type === 'scene3d' ? names.shape[p.shape] : p.type === 'color' ? (names.token[/^var\(--([a-z0-9-]+)\)$/.exec(p.color)?.[1]] || p.color) : '');
  return (
    <div className="space-y-3 text-sm" data-page-panel>
      <section className="space-y-2" aria-label={t('cst.bg.page', 'Page background')}>
        <div className="text-[11px] uppercase tracking-wider text-[var(--faint)]">{t('cst.bg.page', 'Page background')}</div>
        {canvas.bgNote === 'replaced' && (
          <p className="text-[11.5px] text-warning" data-bg-note>
            {t('cst.bg.replaced', 'This page had a background the studio no longer accepts (free CSS). It is shown with the site background instead; pick one here and save to keep the change.')}
          </p>
        )}
        <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label={t('cst.bg.kind', 'Kind of background')}>
          {BACKGROUND_TYPES.map((type) => (
            <button key={type} type="button" role="radio" aria-checked={kind === type} onClick={() => pick(type)} data-bg-kind={type}
              className={`rounded-lg border p-1 text-[11px] text-left transition-colors ${kind === type ? 'border-[var(--primary)] text-[var(--text)]' : 'border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]'}`}>
              <BackgroundThumb bg={type === bg.type ? bg : BG_START[type]} className="h-9 w-full rounded-md border border-[var(--line)] bg-[var(--bg)]" />
              <span className="mt-1 block truncate" title={names.type[type]}>{names.type[type]}</span>
            </button>
          ))}
        </div>
        <p className="text-[11.5px] text-[var(--muted)]">{names.hint[kind]}</p>

        {presets.length > 0 && (
          <div className="flex flex-wrap gap-1.5" aria-label={t('cst.bg.presets', 'Ready-made')}>
            {presets.map((p, i) => (
              <button key={i} type="button" onClick={() => setBg(p, kind === 'board' ? { frames: { desktop: { fit: 'content' }, phone: { fit: 'content' } } } : {})}
                title={presetName(p) || undefined} aria-label={presetName(p) || t('cst.bg.preset', 'Ready-made background')}
                className="rounded-md border border-[var(--line)] p-0.5 hover:border-[var(--primary)]">
                <BackgroundThumb bg={p} className="h-8 w-12 rounded bg-[var(--bg)]" />
              </button>
            ))}
          </div>
        )}

        {bg.type === 'color' && <BgColorField t={t} names={names} label={t('cst.bg.color', 'Colour')} value={bg.color} onChange={(v) => set('color', v)} />}

        {bg.type === 'gradient' && (<>
          <label className="block">
            <span className="flex items-center justify-between text-[11.5px] text-[var(--muted)]"><span>{t('cst.bg.angle', 'Angle')}</span><span className="tabular-nums">{bg.angle}°</span></span>
            <input type="range" min={0} max={360} step={5} value={bg.angle} onChange={(e) => set('angle', Number(e.target.value))} className="w-full" />
          </label>
          {stops.map((s, i) => (
            <div key={i} className="grid grid-cols-[1fr_4.5rem_auto] items-end gap-1.5">
              <BgColorField t={t} names={names} label={`${t('cst.bg.stop', 'Stop')} ${i + 1}`} value={s.color} onChange={(v) => setStop(i, { color: v })} />
              <Field label={t('cst.bg.at', 'At (%)')}><Input type="number" min={0} max={100} value={s.at} onChange={(e) => setStop(i, { at: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} /></Field>
              <Button size="sm" variant="ghost" className="!px-2 mb-0.5" disabled={stops.length <= GRADIENT_STOPS.min}
                onClick={() => set('stops', stops.filter((_, j) => j !== i))} title={t('cst.bg.stop.rm', 'Remove this stop')} aria-label={t('cst.bg.stop.rm', 'Remove this stop')}><Trash2 size={13} /></Button>
            </div>
          ))}
          {stops.length < GRADIENT_STOPS.max && (
            <Button size="sm" variant="ghost" onClick={() => set('stops', [...stops, { color: stops[stops.length - 1]?.color || '#ffffff', at: 100 }])}><Plus size={13} /> {t('cst.bg.stop.add', 'Add a stop')}</Button>
          )}
        </>)}

        {kind === 'image' && (<>
          <div className="flex items-center gap-2">
            {bg.type === 'image' && <BackgroundThumb bg={bg} className="h-12 w-20 shrink-0 rounded-md border border-[var(--line)] bg-[var(--bg)]" />}
            <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer text-[var(--accent-ink)] hover:underline">
              <Upload size={13} /> {upBusy ? t('common.loading', 'Loading…') : t('cst.bg.image.up', 'Upload a picture')}
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" className="hidden" disabled={upBusy}
                onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
          </div>
          <Field label={t('cst.bg.image.src', 'Picture on this site')} hint={t('cst.bg.image.src.h', 'An upload from this site (/api/media/...). A picture from another site cannot be a background: every visitor would fetch it from there.')}>
            <Input value={bg.type === 'image' ? bg.src : ''} placeholder="/api/media/..." className="font-mono text-[12px]" spellCheck={false}
              onChange={(e) => { const src = e.target.value.trim(); if (bgImagePath(src)) setBg({ ...img, type: 'image', src }); }} />
          </Field>
          {bg.type === 'image' && (
            <div className="grid grid-cols-2 gap-2">
              <Field label={t('cst.bg.fit', 'Fit')}><Select value={bg.fit} onChange={(e) => set('fit', e.target.value)}>{BG_IMAGE_FITS.map((f) => <option key={f} value={f}>{names.fit[f]}</option>)}</Select></Field>
              <Field label={t('cst.bg.pos', 'Position')}><Select value={bg.position} onChange={(e) => set('position', e.target.value)}>{BG_POSITIONS.map((f) => <option key={f} value={f}>{names.pos[f]}</option>)}</Select></Field>
            </div>
          )}
        </>)}

        {bg.type === 'pattern' && (<>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('cst.pattern', 'Pattern')}><Select value={bg.id} onChange={(e) => set('id', e.target.value)}>{PATTERNS.map((x) => <option key={x.id} value={x.id}>{t(`cst.pattern.${x.id}`, x.name)}</option>)}</Select></Field>
            <BgColorField t={t} names={names} hexOnly label={t('cst.bg.color', 'Colour')} value={bg.color} onChange={(v) => set('color', v)} />
            <Field label={t('cst.pattern.size', 'Tile (px)')}><Input type="number" min={6} max={160} value={bg.size} onChange={(e) => set('size', Math.max(6, Math.min(160, Number(e.target.value) || 24)))} /></Field>
            <Field label={t('cst.pattern.opacity', 'Opacity')}><Input type="number" min={0} max={1} step={0.05} value={bg.opacity} onChange={(e) => set('opacity', Math.max(0, Math.min(1, Number(e.target.value))))} /></Field>
          </div>
        </>)}

        {bg.type === 'scene3d' && (<>
          <div className="grid grid-cols-3 gap-2">
            <Field label={t('cst.bg.scene.shape', 'Shape')}><Select value={bg.shape} onChange={(e) => set('shape', e.target.value)}>{SCENE_SHAPES.map((s) => <option key={s} value={s}>{names.shape[s] || s}</option>)}</Select></Field>
            <Field label={t('cst.bg.scene.surface', 'Surface')}><Select value={bg.surface} onChange={(e) => set('surface', e.target.value)}>{SCENE_SURFACES.map((s) => <option key={s} value={s}>{names.surface[s]}</option>)}</Select></Field>
            <Field label={t('cst.bg.pos', 'Position')}><Select value={bg.position} onChange={(e) => set('position', e.target.value)}>{SCENE3D_POSITIONS.map((s) => <option key={s} value={s}>{names.pos[s]}</option>)}</Select></Field>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {Object.keys(SCENE_BOUNDS).map((k) => <SceneSlider key={k} label={names.scene[k]} k={k} value={bg[k]} shape={bg.shape} onChange={(v) => set(k, v)} />)}
          </div>
          <p className="text-[11.5px] text-[var(--muted)]">{t('cst.bg.scene.h', 'One 3D scene per page: it takes the place of the site’s 3D backdrop on this page. A reader who asked for less motion gets a still frame, and one without WebGL (or who switched the 3D backdrop off) gets a drawing of the shape. The board shows that drawing; the preview shows the real scene.')}</p>
        </>)}

        {bg.type === 'board' && (
          <div className="grid grid-cols-2 gap-2">
            <BgColorField t={t} names={names} label={t('cst.bg.color', 'Colour')} value={bg.color} onChange={(v) => set('color', v)} />
            <Field label={t('cst.bg.grid', 'Dot grid')}><Select value={String(bg.grid)} onChange={(e) => set('grid', Number(e.target.value))}>{BOARD_GRIDS.map((g) => <option key={g} value={g}>{g ? `${g}px` : t('cst.bg.grid.none', 'None')}</option>)}</Select></Field>
          </div>
        )}
      </section>

      <Field label={t('cst.css', 'Custom CSS (scoped to this page)')} hint={t('cst.css.h', 'Every selector is confined to this page. @import, external url(), expression() and behaviour are refused. Tailwind utilities work only if the site’s build already contains them — prefer plain CSS here.')}>
        <Textarea rows={8} value={canvas.css || ''} onChange={(e) => emit(canvas.blocks, { css: e.target.value }, 'page-css')} className="font-mono text-[12px]" spellCheck={false} placeholder={'.hero { letter-spacing: .02em }\n@media (max-width: 640px) { .cv-shell { border-radius: 8px } }'} />
      </Field>
      {refused.length > 0 && <p className="text-[11.5px] text-warning">{t('cst.css.refused', 'Left out:')} {refused.join(' · ')}</p>}
      <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer text-[var(--accent-ink)] hover:underline">
        <Upload size={13} /> {t('cst.import', 'Import a .css or .svg file')}
        <input type="file" accept=".css,.svg,text/css,image/svg+xml" className="hidden" onChange={(e) => { importFile(e.target.files?.[0]); e.target.value = ''; }} />
      </label>
    </div>
  );
}

/** A shape block's own fields. */
function ShapeFields({ t, p, setProp }) {
  return (<>
    <div className="grid grid-cols-2 gap-2">
      <Field label={t('cst.shape', 'Shape')}><Select value={p.shape || 'rect'} onChange={(e) => setProp('shape', e.target.value)}>{SHAPES.map((s) => <option key={s} value={s}>{t(`cst.shape.${s}`, s)}</option>)}</Select></Field>
      <Field label={t('cst.shape.fill', 'Fill')}><Input value={p.fill || ''} onChange={(e) => setProp('fill', e.target.value)} placeholder="var(--primary) · #f97316 · none" /></Field>
      <Field label={t('cst.shape.fill2', 'Gradient to (optional)')}><Input value={p.fill2 || ''} onChange={(e) => setProp('fill2', e.target.value || undefined)} placeholder="#ec4899" /></Field>
      <Field label={t('cst.shape.stroke', 'Stroke')}><Input value={p.stroke || ''} onChange={(e) => setProp('stroke', e.target.value)} placeholder="none · #000" /></Field>
      <Field label={t('cst.shape.sw', 'Stroke width')}><Input type="number" min={0} max={40} value={p.strokeWidth ?? 0} onChange={(e) => setProp('strokeWidth', Number(e.target.value) || 0)} /></Field>
      <Field label={t('cst.shape.dash', 'Dash (e.g. 6 4)')}><Input value={p.dash || ''} onChange={(e) => setProp('dash', e.target.value.replace(/[^\d\s,.]/g, ''))} /></Field>
      {(p.shape || 'rect') === 'rounded' && <Field label={t('cst.shape.corner', 'Corner (0–50)')}><Input type="number" min={0} max={50} value={p.corner ?? 12} onChange={(e) => setProp('corner', Number(e.target.value) || 0)} /></Field>}
      <Field label={t('cst.shape.opacity', 'Opacity')}><Input type="number" min={0} max={1} step={0.05} value={p.opacity ?? 1} onChange={(e) => setProp('opacity', Math.max(0, Math.min(1, Number(e.target.value))))} /></Field>
    </div>
    <label className="flex items-center gap-1.5 text-xs cursor-pointer"><input type="checkbox" checked={!!p.keepRatio} onChange={(e) => setProp('keepRatio', e.target.checked)} /> {t('cst.shape.ratio', 'Keep the shape\u2019s proportions')}</label>
    <div className="grid grid-cols-[1fr_auto_auto] gap-2">
      <Field label={t('cst.shape.text', 'Text inside')}><Input value={p.text || ''} maxLength={80} onChange={(e) => setProp('text', e.target.value)} /></Field>
      <Field label={t('cst.shape.textColor', 'Colour')}><Input value={p.textColor || ''} onChange={(e) => setProp('textColor', e.target.value)} placeholder="#fff" className="w-24" /></Field>
      <Field label={t('cst.shape.textSize', 'Size')}><Input type="number" min={4} max={60} value={p.textSize ?? 14} onChange={(e) => setProp('textSize', Number(e.target.value) || 14)} className="w-20" /></Field>
    </div>
  </>);
}

/** A tiling pattern on a box or a shape. */
function PatternFields({ t, p, setProp }) {
  const pat = p.pattern || {};
  const set = (k, v) => setProp('pattern', { ...pat, [k]: v });
  return (
    <div className="rounded-lg border border-[var(--line)] p-2 space-y-2">
      <div className="text-[11px] uppercase tracking-wider text-[var(--faint)]">{t('cst.pattern', 'Pattern')}</div>
      <div className="grid grid-cols-2 gap-2">
        <Select value={pat.id || ''} onChange={(e) => (e.target.value ? set('id', e.target.value) : setProp('pattern', undefined))}>
          <option value="">{t('cst.pattern.none', 'None')}</option>
          {PATTERNS.map((x) => <option key={x.id} value={x.id}>{t(`cst.pattern.${x.id}`, x.name)}</option>)}
        </Select>
        {pat.id && <Input value={pat.color || '#000000'} onChange={(e) => set('color', e.target.value)} placeholder="#000000" />}
        {pat.id && <Field label={t('cst.pattern.size', 'Tile (px)')}><Input type="number" min={6} max={160} value={pat.size ?? 24} onChange={(e) => set('size', Number(e.target.value) || 24)} /></Field>}
        {pat.id && <Field label={t('cst.pattern.opacity', 'Opacity')}><Input type="number" min={0} max={1} step={0.05} value={pat.opacity ?? 0.35} onChange={(e) => set('opacity', Math.max(0, Math.min(1, Number(e.target.value))))} /></Field>}
      </div>
    </div>
  );
}

/** The raw-SVG block. What is stored is what is typed; what is drawn is what survives the sanitiser. */
function SvgFields({ t, p, setProp }) {
  const dropped = svgRefusals(p.svg);
  return (
    <Field label={t('cst.svg', 'SVG markup')} hint={t('cst.svg.h', 'Paste an <svg>. Scripts, event handlers, external references, images, styles and animation are removed when it is drawn.')}>
      <Textarea rows={8} value={p.svg || ''} onChange={(e) => setProp('svg', e.target.value.slice(0, 200_000))} className="font-mono text-[11.5px]" spellCheck={false} />
      {dropped.length > 0 && <p className="text-[11.5px] text-warning mt-1">{t('cst.svg.dropped', 'Removed when drawn:')} {dropped.join(' · ')}</p>}
    </Field>
  );
}

/** Classes and inline style, for any block. */
function CssFields({ t, p, setProp }) {
  return (
    <details className="rounded-lg border border-[var(--line)] p-2">
      <summary className="text-[11px] uppercase tracking-wider text-[var(--faint)] cursor-pointer">{t('cst.cssblock', 'Classes & style')}</summary>
      <div className="mt-2 space-y-2">
        <Field label={t('cst.cls', 'CSS classes')} hint={t('cst.cls.h', 'Your own classes from the page CSS, or utilities the site already ships (a class the build does not know does nothing).')}><Input value={p.cls || ''} onChange={(e) => setProp('cls', e.target.value)} placeholder="hero rounded-2xl backdrop-blur" /></Field>
        <Field label={t('cst.style', 'Inline style')} hint={t('cst.style.h', 'Declarations, semicolon-separated. External url() is refused.')}><Textarea rows={2} value={p.style || ''} onChange={(e) => setProp('style', e.target.value.slice(0, 4000))} className="font-mono text-[11.5px]" spellCheck={false} placeholder="letter-spacing: .04em; backdrop-filter: blur(6px)" /></Field>
      </div>
    </details>
  );
}

function Toolbar({ t, preview, setPreview, snapOn, setSnapOn, add, addShape, sel, duplicate, remove, doUndo, doRedo, hist, selCount, doAlign, doDistribute, stagger, grid, setGrid, layersOpen, setLayersOpen, zoom, setZoom, pageOpen, setPageOpen,
  pageMode = false, showGrid = true, setShowGrid, zoomBy, fitScale = 1, onSaveComponent,
  doZ, matchSize, toggleFlag, selBlocks = [], narrow = false, onKeys, panMode = false, setPanMode, onShowAll, frameFit = 'content', onFitContent }) {
  const zoomPct = Math.round((zoom === 'fit' ? fitScale : Number(zoom)) * 100);
  const anyLocked = selBlocks.some((b) => b.locked);
  const anyHidden = selBlocks.some((b) => b.hidden);
  return (
    // On a narrow screen this scrolls sideways instead of wrapping. Wrapping cost four rows of
    // the board on a phone, which is the same complaint as the top bar one line up.
    <div className={narrow ? 'cst-strip mb-3' : 'flex flex-wrap items-center gap-1.5 mb-3'}>
      {/* In page mode the palette is the left pane; here it would be the same buttons twice. */}
      {!pageMode && (<>
        <Button size="sm" variant="ghost" onClick={() => add('text')}><Type size={14} /> {t('cst.text', 'Text')}</Button>
        <Button size="sm" variant="ghost" onClick={() => add('image')}><ImageIcon size={14} /> {t('cst.image', 'Image')}</Button>
        <Button size="sm" variant="ghost" onClick={() => add('box')}><Square size={14} /> {t('cst.box', 'Box')}</Button>
        <Button size="sm" variant="ghost" onClick={() => add('button')}><MousePointerClick size={14} /> {t('cst.button', 'Button')}</Button>
        <Button size="sm" variant="ghost" onClick={() => add('video')} title={t('cst.add.video', 'video')}><Film size={14} /></Button>
        <Button size="sm" variant="ghost" onClick={() => add('embed')} title={t('cst.add.embed', 'embed')}><Globe size={14} /></Button>
        <Button size="sm" variant="ghost" onClick={() => add('replay')} title={t('cst.add.replay', 'replay')}><PlayCircle size={14} /></Button>
        <label className="inline-flex items-center gap-1 text-[11px]" title={t('cst.add.shape', 'Add a shape')}>
          <Sparkles size={13} className="text-[var(--muted)]" />
          <select className="bg-transparent text-[var(--text)] text-xs" value="" onChange={(e) => { if (e.target.value) addShape(e.target.value); }} aria-label={t('cst.add.shape', 'Add a shape')}>
            <option value="">{t('cst.shape', 'Shape')}…</option>
            {SHAPES.map((s) => <option key={s} value={s}>{t(`cst.shape.${s}`, s)}</option>)}
          </select>
        </label>
        <Button size="sm" variant="ghost" onClick={() => add('svg')} title={t('cst.add.svg', 'SVG')}>SVG</Button>
      </>)}
      <Button size="sm" variant={pageOpen ? 'primary' : 'ghost'} onClick={() => setPageOpen((v) => !v)} title={t('cst.page.h', 'Page background, custom CSS, imports')}><Layers size={14} /> {t('cst.page', 'Page')}</Button>
      {/* Zoom: a menu of fixed steps, and in page mode the +/- pair and "fit" beside it. */}
      {pageMode && zoomBy && <Button size="sm" variant="ghost" className="!px-2" onClick={() => zoomBy(-1)} title={t('cst.zoom.out', 'Zoom out')} aria-label={t('cst.zoom.out', 'Zoom out')}><ZoomOut size={14} /></Button>}
      <select className="bg-transparent text-[var(--text)] text-xs" value={zoom === 'fit' || [0.5, 0.75, 1].includes(Number(zoom)) ? String(zoom) : 'custom'} onChange={(e) => { if (e.target.value !== 'custom') setZoom(e.target.value === 'fit' ? 'fit' : Number(e.target.value)); }} aria-label={t('cst.zoom', 'Zoom')} title={t('cst.zoom', 'Zoom')} data-zoom-pct={zoomPct}>
        <option value="fit">{t('cst.zoom.fit', 'Fit')}</option><option value="0.5">50%</option><option value="0.75">75%</option><option value="1">100%</option>
        {zoom !== 'fit' && ![0.5, 0.75, 1].includes(Number(zoom)) && <option value="custom">{zoomPct}%</option>}
      </select>
      {pageMode && zoomBy && <Button size="sm" variant="ghost" className="!px-2" onClick={() => zoomBy(1)} title={t('cst.zoom.in', 'Zoom in')} aria-label={t('cst.zoom.in', 'Zoom in')}><ZoomIn size={14} /></Button>}
      {pageMode && zoom !== 'fit' && <Button size="sm" variant="ghost" className="!px-2" onClick={() => setZoom('fit')} title={t('cst.zoom.fitframe', 'Fit the frame to the pane (0)')} aria-label={t('cst.zoom.fitframe', 'Fit the frame to the pane (0)')}><Maximize size={14} /></Button>}
      {onShowAll && <Button size="sm" variant="ghost" className="!px-2" onClick={onShowAll} title={t('cst.zoom.all', 'Show everything, blocks off the frame included (Shift+1)')} aria-label={t('cst.zoom.all', 'Show everything, blocks off the frame included (Shift+1)')}><Expand size={14} /></Button>}
      {/* Only while the height is pinned: a frame that already follows its content has
          nothing to be handed back. */}
      {onFitContent && frameFit === 'fixed' && <Button size="sm" variant="ghost" className="!px-2" onClick={onFitContent} data-fit-content title={t('cst.frame.fit', 'Fit the frame to its content: the page grows and shrinks with its blocks again')} aria-label={t('cst.frame.fit', 'Fit the frame to its content: the page grows and shrinks with its blocks again')}><FoldVertical size={14} /></Button>}
      {/* The hand. Zoomed past the pane the board could only be moved by a scrollbar, which a
          touch author never gets; space-drag and the middle button do the same thing. */}
      {pageMode && setPanMode && (
        <Button size="sm" variant={panMode ? 'primary' : 'ghost'} className="!px-2" onClick={() => setPanMode((v) => !v)}
          title={t('cst.pan.h', 'Drag the board around instead of selecting (or hold space)')} aria-label={t('cst.pan', 'Move the board')} aria-pressed={panMode}><Hand size={14} /></Button>
      )}
      <span className="w-px h-5 bg-[var(--line)] mx-1" />
      {!pageMode && (<>
        <Button size="sm" variant="ghost" disabled={!hist.past.length} onClick={doUndo} data-undo-steps={hist.past.length} data-undo-key={String(hist.key)} title={`Ctrl+Z · ${hist.past.length}`}><Undo2 size={14} /></Button>
        <Button size="sm" variant="ghost" disabled={!hist.future.length} onClick={doRedo} title="Ctrl+Shift+Z"><Redo2 size={14} /></Button>
        <span className="w-px h-5 bg-[var(--line)] mx-1" />
      </>)}
      <Button size="sm" variant="ghost" disabled={!selCount} onClick={duplicate} title="Ctrl+D"><Copy size={14} /> {t('cst.dup', 'Duplicate')}</Button>
      <Button size="sm" variant="ghost" disabled={!selCount} className="!text-error" onClick={remove} title={t('cst.del', 'Delete')} aria-label={t('cst.del', 'Delete')}><Trash2 size={14} /></Button>
      {onSaveComponent && <Button size="sm" variant="ghost" disabled={!selCount} onClick={onSaveComponent} title={t('cst.cmp.saveas.h2', 'Keep the selection as a reusable component')}><Puzzle size={14} /> {t('cst.cmp.saveas', 'Save as component')}</Button>}
      {/* The paint order and the two flags, for the WHOLE selection. They existed only in the
          inspector, which has one block: with four picked they quietly moved, locked or hid
          exactly one of them. */}
      {doZ && (<>
        <Button size="sm" variant="ghost" className="!px-2" disabled={!selCount} onClick={() => doZ('front')} title={t('cst.front', 'Bring to front')} aria-label={t('cst.front', 'Bring to front')}><BringToFront size={14} /></Button>
        <Button size="sm" variant="ghost" className="!px-2" disabled={!selCount} onClick={() => doZ('back')} title={t('cst.back', 'Send to back')} aria-label={t('cst.back', 'Send to back')}><SendToBack size={14} /></Button>
      </>)}
      {toggleFlag && (<>
        <Button size="sm" variant={anyLocked ? 'primary' : 'ghost'} className="!px-2" disabled={!selCount} onClick={() => toggleFlag('locked')} title={t('cst.locked.h2', 'Lock or unlock the selection (L)')} aria-label={t('cst.locked', 'Locked')}>{anyLocked ? <Lock size={14} /> : <LockOpen size={14} />}</Button>
        <Button size="sm" variant={anyHidden ? 'primary' : 'ghost'} className="!px-2" disabled={!selCount} onClick={() => toggleFlag('hidden')} title={t('cst.hidden.h2', 'Hide or show the selection (H)')} aria-label={t('cst.hidden', 'Hidden')}>{anyHidden ? <EyeOff size={14} /> : <Eye size={14} />}</Button>
      </>)}
      {selCount > 1 && (<>
        <span className="w-px h-5 bg-[var(--line)] mx-1" />
        <span className="text-[11px] text-[var(--faint)] tabular-nums">{t('cst.nsel', '{n} selected').replace('{n}', selCount)}</span>
        {/* The English fallback is the real label, not the key. `t(k, fallback)` shows the
            fallback when there is no entry for the language, so a bare `how` here meant the
            tooltip on an icon-only button read "hcenter". */}
        {[['left', AlignStartVertical, 'Align left'], ['hcenter', AlignCenterVertical, 'Centre horizontally'], ['right', AlignEndVertical, 'Align right'],
          ['top', AlignStartHorizontal, 'Align top'], ['vmiddle', AlignCenterHorizontal, 'Centre vertically'], ['bottom', AlignEndHorizontal, 'Align bottom']].map(([how, I, label]) => (
          <Button key={how} size="sm" variant="ghost" onClick={() => doAlign(how)} title={t(`cst.al.${how}`, label)} aria-label={t(`cst.al.${how}`, label)}><I size={14} /></Button>
        ))}
        {/* Aligning four cards on their left edge still looks wrong while they are four
            different widths, and the only other way to fix that was typing the number into
            the inspector once per block. The first block picked is the model. */}
        {matchSize && (<>
          <Button size="sm" variant="ghost" className="!px-2" onClick={() => matchSize('w')} title={t('cst.same.w', 'Same width as the first block picked')} aria-label={t('cst.same.w', 'Same width as the first block picked')}><StretchHorizontal size={14} /></Button>
          <Button size="sm" variant="ghost" className="!px-2" onClick={() => matchSize('h')} title={t('cst.same.h', 'Same height as the first block picked')} aria-label={t('cst.same.h', 'Same height as the first block picked')}><StretchVertical size={14} /></Button>
        </>)}
        {selCount > 2 && (<>
          <Button size="sm" variant="ghost" onClick={() => doDistribute('x')} title={t('cst.dist.x', 'Even gaps across')}><AlignHorizontalSpaceAround size={14} /></Button>
          <Button size="sm" variant="ghost" onClick={() => doDistribute('y')} title={t('cst.dist.y', 'Even gaps down')}><AlignVerticalSpaceAround size={14} /></Button>
        </>)}
        {/* Stagger. A select rather than a button because the useful part IS the number, and
            the alternative was typing it into the inspector once per block. */}
        {stagger && (
          <span className="inline-flex items-center gap-1 rounded-lg border border-[var(--line)] px-1.5 py-0.5"
            title={t('cst.anim.stagger.h', 'Give the selection the same entrance, each one starting a little after the one before, in reading order.')}>
            <Sparkles size={13} className="text-[var(--muted)]" />
            <select className="bg-transparent text-[var(--text)] text-xs" value="" aria-label={t('cst.anim.stagger', 'Stagger')}
              onChange={(e) => { const v = e.target.value; e.target.value = ''; if (v !== '') stagger(Number(v)); }}>
              <option value="">{t('cst.anim.stagger', 'Stagger')}</option>
              {STAGGER_STEPS.map((n) => <option key={n} value={n}>{`${n} ms`}</option>)}
              <option value="0">{t('cst.anim.stagger.off', 'All at once')}</option>
            </select>
          </span>
        )}
      </>)}
      <span className="w-px h-5 bg-[var(--line)] mx-1" />
      <Button size="sm" variant={snapOn ? 'primary' : 'ghost'} onClick={() => setSnapOn((v) => !v)} title={t('cst.snap.h', 'Snap to the grid and to other blocks')}><Magnet size={14} /></Button>
      {/* ONE grid control, not two.
          The page-mode bar used to carry a Grid3x3 button ("show the grid") a few pixels from
          a Grid2x2 label ("the grid step") — two grid glyphs, side by side, for two settings
          of the same grid, which is the duplicate the studio was reported for. They are one
          group now: the glyph is the toggle, the number beside it is the step. */}
      <span className="inline-flex items-center gap-1 rounded-lg border border-[var(--line)] ps-0.5 pe-1.5 py-0.5" title={t('cst.grid.h', 'The grid step blocks snap to')}>
        {setShowGrid ? (
          <button type="button" onClick={() => setShowGrid((v) => !v)} aria-pressed={showGrid}
            className={`inline-flex p-1 rounded-md ${showGrid ? 'tint-primary text-[var(--text)]' : 'text-[var(--muted)]'}`}
            title={t('cst.grid.show', 'Show the grid')} aria-label={t('cst.grid.show', 'Show the grid')}><Grid2x2 size={13} /></button>
        ) : <Grid2x2 size={13} className="text-[var(--muted)]" />}
        <select className="bg-transparent text-[var(--text)] text-xs" value={grid} onChange={(e) => setGrid(Number(e.target.value))} aria-label={t('cst.grid', 'Grid')}>
          {GRID_SIZES.map((n) => <option key={n} value={n}>{n}px</option>)}
        </select>
      </span>
      {!pageMode && (<>
        <Button size="sm" variant={layersOpen ? 'primary' : 'ghost'} onClick={() => setLayersOpen((v) => !v)} title={t('cst.layers.h', 'Every block, top first, name, lock, hide, reorder')}><LayoutList size={14} /> {t('cst.layers', 'Layers')}</Button>
        {/* A desktop author cannot otherwise ever see the stacked version, and the stacked
            version is what most visitors get. */}
        <Button size="sm" variant={preview === 'desktop' ? 'primary' : 'ghost'} onClick={() => setPreview((v) => (v === 'desktop' ? '' : 'desktop'))} title={t('cst.preview.desktop', 'Desktop preview')}><Eye size={14} /> {t('cst.preview', 'Preview')}</Button>
        {/* The tablet was reachable in the page form and nowhere else, so the SAME document
            offered two device widths in the config editor and three in the studio. */}
        <Button size="sm" variant={preview === 'tablet' ? 'primary' : 'ghost'} className="!px-2" onClick={() => setPreview((v) => (v === 'tablet' ? '' : 'tablet'))} title={t('cst.preview.tablet', 'Tablet preview')} aria-label={t('cst.preview.tablet', 'Tablet preview')}><Tablet size={14} /></Button>
        <Button size="sm" variant={preview === 'phone' ? 'primary' : 'ghost'} className="!px-2" onClick={() => setPreview((v) => (v === 'phone' ? '' : 'phone'))} title={t('cst.phone.h', 'What a phone gets: the canvas stacks')} aria-label={t('cst.phone.h', 'What a phone gets: the canvas stacks')}><Smartphone size={14} /></Button>
        {/* Page mode has this in its top bar; in the modal it would otherwise have no home,
            and a shortcut nobody can find is a shortcut nobody has. */}
        {onKeys && <Button size="sm" variant="ghost" className="!px-2" onClick={onKeys} title={t('cst.keys.h2', 'Keyboard shortcuts (?)')} aria-label={t('cst.keys', 'Keyboard shortcuts')}><Keyboard size={14} /></Button>}
        {preview && <span className="text-[11px] text-[var(--faint)] inline-flex items-center gap-1"><Monitor size={12} /> {t('cst.previewing', 'Preview, editing is paused')}</span>}
      </>)}
    </div>
  );
}

function Inspector({ t, sel, patch, canvas, emit, setSelId, hasDark = false, onOpenMd }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!sel) {
    return (
      <div className="mt-4 lg:mt-0 rounded-xl border border-[var(--line)] p-3 text-xs text-[var(--muted)]">
        {t('cst.none', 'Select a block to edit it. Arrow keys nudge, Shift+arrow moves further, Delete removes.')}
      </div>
    );
  }
  const p = sel.props || {};
  const setProp = (k, v) => patch(sel.id, { props: { ...p, [k]: v } });
  const numField = (label, key) => (
    <Field label={label}><Input type="number" value={sel[key]} onChange={(e) => patch(sel.id, { [key]: Number(e.target.value) || 0 })} /></Field>
  );
  return (
    <div className="mt-4 lg:mt-0 rounded-xl border border-[var(--line)] p-3 space-y-3 lg:sticky lg:top-4" data-tour="props">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)]">{sel.kind}</span>
        {/* Whether THIS block says anything of its own on dark. Without it, an author on the
            dark theme cannot tell an overridden block from one that is simply inheriting —
            they look identical, which is the point of inheriting and the problem with it. */}
        {hasDark && <span className="text-[10px] px-1.5 py-0.5 rounded tint-primary text-[var(--accent-ink)]">{t('cst.theme.has', 'dark variant')}</span>}
        <div className="ms-auto flex gap-1">
          <button title={t('cst.front', 'Bring to front')} className="p-1 rounded hover:bg-[var(--surface-2)]" onClick={() => emit(bringTo(canvas.blocks, sel.id, 'front'))}><ArrowUp size={14} /></button>
          <button title={t('cst.back', 'Send to back')} className="p-1 rounded hover:bg-[var(--surface-2)]" onClick={() => emit(bringTo(canvas.blocks, sel.id, 'back'))}><ArrowDown size={14} /></button>
          {hasDark && (
            <button title={t('cst.theme.reset', 'Drop the dark variant, this block follows the light layout again')}
              className="p-1 rounded hover:bg-[var(--surface-2)]"
              onClick={() => emit(canvas.blocks.map((b) => (b.id === sel.id ? { ...b, themes: { ...(b.themes || {}), dark: undefined } } : b)))}>
              <Layers size={14} />
            </button>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Input className="flex-1 min-w-0" value={sel.name || ''} placeholder={t('cst.name.ph', 'Name this block…')} aria-label={t('cst.name', 'Name')} onChange={(e) => patch(sel.id, { name: e.target.value.slice(0, 60) }, `name-${sel.id}`)} />
        <button type="button" className={`p-1.5 rounded border border-[var(--line)] ${sel.locked ? 'text-[var(--accent-ink)] tint-primary' : 'text-[var(--faint)]'}`} onClick={() => patch(sel.id, { locked: !sel.locked })} title={t('cst.locked.h', 'Locked: the panel still edits it, the pointer cannot move, resize or delete it')} aria-label={t('cst.locked', 'Locked')}>{sel.locked ? <Lock size={13} /> : <LockOpen size={13} />}</button>
        <button type="button" className={`p-1.5 rounded border border-[var(--line)] ${sel.hidden ? 'text-[var(--accent-ink)] tint-primary' : 'text-[var(--faint)]'}`} onClick={() => patch(sel.id, { hidden: !sel.hidden })} title={t('cst.hidden.h', 'Hidden: kept on the board, not shown to readers')} aria-label={t('cst.hidden', 'Hidden')}>{sel.hidden ? <EyeOff size={13} /> : <Eye size={13} />}</button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {numField('X', 'x')}{numField('Y', 'y')}{numField(t('cst.w', 'Width'), 'w')}{numField(t('cst.h', 'Height'), 'h')}
      </div>
      {sel.kind === 'text' && (
        <Field label={t('cst.md', 'Content (B.MD)')}>
          <Textarea rows={8} value={p.md || ''} onChange={(e) => setProp('md', e.target.value)} />
          <button type="button" className="mt-1 text-[11.5px] text-[var(--accent-ink)] hover:underline inline-flex items-center gap-1" onClick={() => onOpenMd?.(sel.id)}><Type size={12} /> {t('cst.md.open', 'Open in the B.MD editor')}</button>
        </Field>
      )}
      {sel.kind === 'text' && (
        <Field label={t('cst.text.align', 'Text alignment')}>
          <Select value={p.align || 'left'} onChange={(e) => setProp('align', e.target.value === 'left' ? undefined : e.target.value)}>
            {TEXT_ALIGNS.map((v) => <option key={v} value={v}>{t(`cst.text.align.${v}`, v)}</option>)}
          </Select>
        </Field>
      )}
      {sel.kind === 'image' && (<>
        <Field label={t('cst.src', 'Image URL')}><Input value={p.src || ''} onChange={(e) => setProp('src', e.target.value)} placeholder="/uploads/…" /></Field>
        {/* Pasting a URL means the picture has to already be somewhere, which for most people
            it is not. Same uploader the rest of the editor uses, so the file lands in the
            same place with the same limits. */}
        <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer text-[var(--accent-ink)] hover:underline">
          <Upload size={13} /> {busy ? t('cst.uploading', 'Uploading…') : t('cst.upload', 'Upload an image')}
          <input type="file" accept="image/*" className="hidden" disabled={busy} onChange={async (e) => {
            const f = e.target.files?.[0]; e.target.value = '';
            if (!f) return;
            setBusy(true);
            try { setProp('src', await uploadMedia(f)); }
            catch { toast.error(t('common.failed', 'Failed.')); }
            finally { setBusy(false); }
          }} />
        </label>
        <Field label={t('cst.alt', 'Alt text')} hint={t('cst.alt.h', 'What the image says, for anyone who cannot see it.')}><Input value={p.alt || ''} onChange={(e) => setProp('alt', e.target.value)} /></Field>
      </>)}
      {sel.kind === 'video' && (<>
        <Field label={t('cst.video.src', 'Video URL (mp4/webm)')}><Input value={p.src || ''} onChange={(e) => setProp('src', e.target.value)} placeholder="/uploads/clip.mp4" /></Field>
        <Field label={t('cst.video.poster', 'Poster image (optional)')}><Input value={p.poster || ''} onChange={(e) => setProp('poster', e.target.value)} /></Field>
        <div className="flex flex-wrap gap-3 text-xs">
          {[['controls', t('cst.video.controls', 'Controls'), true], ['muted', t('cst.video.muted', 'Muted'), false],
            ['loop', t('cst.video.loop', 'Loop'), false], ['autoplay', t('cst.video.auto', 'Autoplay'), false]].map(([k, label, dflt]) => (
              <label key={k} className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={p[k] ?? dflt} onChange={(e) => setProp(k, e.target.checked)} />{label}
              </label>
          ))}
        </div>
        {/* Said rather than silently ignored. Every browser refuses to autoplay a video with
            sound, so the two boxes together are the only combination that does anything —
            a checkbox that does nothing is worse than no checkbox. */}
        {p.autoplay && !p.muted && (
          <p className="text-[11px] text-warning">{t('cst.video.automute', 'Autoplay only works on a muted video, every browser blocks the other kind. Tick Muted, or the video will simply wait to be played.')}</p>
        )}
      </>)}
      {sel.kind === 'embed' && (<>
        <Field label={t('cst.embed.url', 'Embed URL')}><Input value={p.url || ''} onChange={(e) => setProp('url', e.target.value)} placeholder="https://www.youtube.com/embed/…" /></Field>
        <Field label={t('cst.embed.title', 'Title (for screen readers)')}><Input value={p.title || ''} onChange={(e) => setProp('title', e.target.value)} /></Field>
        {/* The allow-list is B.MD's, shared with every embed in a blog post or a doc — not a
            second list. A refused URL still renders, as a link, so it is visible that it was
            refused rather than looking like a blank block. */}
        <p className="text-[11px] text-[var(--muted)]">{t('cst.embed.allow', 'Only YouTube and Spotify embed links can be framed, the same list the rest of the site uses. Anything else is shown as a link instead.')}</p>
      </>)}
      {sel.kind === 'replay' && (
        <Field label={t('cst.replay.src', '.bmmreplay URL')} hint={t('cst.replay.h', 'A recording of the app, played by the docs and blog player.')}>
          <Input value={p.src || ''} onChange={(e) => setProp('src', e.target.value)} placeholder="/uploads/demo.bmmreplay" />
        </Field>
      )}
      {sel.kind === 'button' && <ButtonFields t={t} p={p} setProp={setProp} />}
      {sel.kind === 'shape' && <ShapeFields t={t} p={p} setProp={setProp} />}
      {sel.kind === 'svg' && <SvgFields t={t} p={p} setProp={setProp} />}
      {(sel.kind === 'box' || sel.kind === 'shape' || sel.kind === 'text') && <PatternFields t={t} p={p} setProp={setProp} />}
      <CssFields t={t} p={p} setProp={setProp} />
      <AnimFields t={t} sel={sel} patch={patch} />
      {/* Opacity sits on the BLOCK, not in props: it applies to the wrapper, so it behaves the
          same for a picture, a video and a paragraph. Per-kind it would have been written five
          times and forgotten in two. */}
      <Field label={`${t('cst.opacity', 'Opacity')} · ${Math.round((sel.opacity ?? 1) * 100)}%`}>
        <input type="range" min="0" max="100" step="5" className="w-full"
          value={Math.round((sel.opacity ?? 1) * 100)}
          onChange={(e) => patch(sel.id, { opacity: Number(e.target.value) / 100 }, `op-${sel.id}`)} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('cst.rotate', 'Rotation (°)')}><Input type="number" min={-180} max={180} value={sel.rotate || 0} onChange={(e) => patch(sel.id, { rotate: Math.max(-180, Math.min(180, Number(e.target.value) || 0)) }, `rot-${sel.id}`)} /></Field>
        <Field label={t('cst.shadow', 'Shadow')}>
          <Select value={sel.shadow || ''} onChange={(e) => patch(sel.id, { shadow: e.target.value })}>
            <option value="">{t('cst.shadow.none', 'None')}</option>
            {SHADOWS.map((v) => <option key={v} value={v}>{t(`cst.shadow.${v}`, v)}</option>)}
          </Select>
        </Field>
      </div>
      <Field label={t('cst.hover', 'On hover')}>
        <Select value={sel.hover || ''} onChange={(e) => patch(sel.id, { hover: e.target.value })}>
          <option value="">{t('cst.hover.none', 'Nothing')}</option>
          {HOVER_EFFECTS.map((v) => <option key={v} value={v}>{t(`cst.hover.${v}`, v)}</option>)}
        </Select>
      </Field>
      {sel.kind !== 'button' && (
        <Field label={t('cst.link', 'Link (whole block)')} hint={t('cst.link.h', 'A path on this site, an anchor, or an https address. The block becomes clickable.')}>
          <Input value={sel.link || ''} onChange={(e) => patch(sel.id, { link: e.target.value }, `link-${sel.id}`)} placeholder="/docs · #plans · https://…" />
        </Field>
      )}
      <Field label={t('cst.bg', 'Background')}><Input value={p.bg || ''} onChange={(e) => setProp('bg', e.target.value)} placeholder="rgba(99,102,241,0.1)" /></Field>
      <Field label={t('cst.radius', 'Corner radius')}><Input type="number" value={p.radius ?? ''} onChange={(e) => setProp('radius', e.target.value === '' ? undefined : Number(e.target.value))} /></Field>
      <button className="text-[11px] text-[var(--faint)] hover:text-[var(--text)]" onClick={() => setSelId(null)}>{t('cst.deselect', 'Deselect')}</button>
    </div>
  );
}
