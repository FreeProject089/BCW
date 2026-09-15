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
} from 'lucide-react';
import { Button, Field, Input, Textarea, Select, Modal, useToast } from '../ui/ui.jsx';
import { useI18n } from '../i18n.jsx';
import { uploadMedia } from '../lib/api.js';
import { lazy, Suspense, memo } from 'react';
import { PATTERNS } from '../lib/patterns.js';
import { sanitizeSvg, svgRefusals } from '../lib/svg-safe.js';
import { scopeCss } from '../lib/css-scope.js';
// The full B.MD editor is heavy and most sessions never open it: loaded on first use.
const LazyMarkdownEditor = lazy(() => import('./markdown-editor.jsx').then((m) => ({ default: m.MarkdownEditor })));
import CanvasView, { CanvasBlock } from '../ui/canvas-view.jsx';
import {
  normalizeCanvas, paintOrder, dragTo, resizeTo, alignmentGuides, bringTo,
  emptyHistory, pushHistory, undo as undoHist, redo as redoHist,
  boundsOf, blocksInRect, moveMany, alignMany, distributeMany, phoneOrder, resolveBlock,
  phoneBoardBlocks, reorder, DESIGN_WIDTH, PHONE_WIDTH, GRID, HANDLES,
  ANIM_KINDS, ANIM_TRIGGERS, BUTTON_VARIANTS, BUTTON_ACTIONS, SHADOWS, HOVER_EFFECTS, GRID_SIZES, TEXT_ALIGNS, SHAPES,
} from '../lib/canvas.js';

const uid = () => `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

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

export default function CanvasStudio({ value, onChange }) {
  const { t } = useI18n();
  const canvas = useMemo(() => normalizeCanvas(value), [value]);
  // A SET of ids. Everything that was written for one block still works — `sel` is the single
  // selection when there is exactly one — and the group operations read the whole set.
  const [selIds, setSelIds] = useState([]);
  const selId = selIds.length === 1 ? selIds[0] : null;
  const setSelId = (id) => setSelIds(id == null ? [] : [id]);
  // A marquee in flight, in DESIGN coordinates. In state because it has to draw.
  const [marquee, setMarquee] = useState(null);
  const [snapOn, setSnapOn] = useState(true);
  const [layersOpen, setLayersOpen] = useState(false);
  const [zoom, setZoom] = useState('fit');            // 'fit' | 0.5 | 0.75 | 1
  const [pageOpen, setPageOpen] = useState(false);
  const [mdFor, setMdFor] = useState(null);           // block id whose text is in the B.MD editor
  const clip = useRef([]);                           // copied blocks (also written to the clipboard)
  const [preview, setPreview] = useState('');         // '' | 'desktop' | 'phone'
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

  useEffect(() => {
    const el = hostRef.current; if (!el) return undefined;
    const read = () => setVw(el.clientWidth || DESIGN_WIDTH);
    read();
    if (typeof ResizeObserver === 'undefined') { window.addEventListener('resize', read); return () => window.removeEventListener('resize', read); }
    const ro = new ResizeObserver(read); ro.observe(el); return () => ro.disconnect();
  }, []);

  // The editor always works on the SCALED plane, never stacked: you cannot place things on a
  // layout that has given up on placement. `layoutFor` is asked for the scale so the editor
  // and the page agree, but the stacking decision is the page's alone.
  // Which board: the 1200px desktop plane, or the 390px phone board. Everything that clamps
  // or scales reads this rather than DESIGN_WIDTH.
  const phoneBoard = editTheme === 'phone';
  const boardW = phoneBoard ? PHONE_WIDTH : DESIGN_WIDTH;
  const boardH = phoneBoard ? canvas.phoneHeight : canvas.height;
  const fitScale = Math.min(1, Math.max(0.3, vw / boardW));
  const scale = zoom === 'fit' ? fitScale : Number(zoom);
  // The author's grid step. Snapping, the drawn grid and the keyboard nudge all read it.
  const grid = canvas.grid || GRID;
  // The board and the panel both show the target being authored — resolveBlock and
  // phoneBoardBlocks are the SAME functions the public page uses, so "what the author sees"
  // cannot drift from what is served. On the phone board every block has a place, hand-placed
  // or laid in reading order under the placed ones.
  const view = useMemo(() => (phoneBoard
    ? { ...canvas, blocks: phoneBoardBlocks(canvas.blocks.map((b) => resolveBlock(b, 'light'))) }
    : { ...canvas, blocks: canvas.blocks.map((b) => resolveBlock(b, editTheme)) }), [canvas, editTheme, phoneBoard]);
  const sel = view.blocks.find((b) => b.id === selId) || null;
  /** Does this block say anything of its own on the dark theme? Drives the badge and Reset. */
  const rawSel = canvas.blocks.find((b) => b.id === selId) || null;
  const hasDark = !!(rawSel?.themes?.dark && Object.keys(rawSel.themes.dark).length);

  // Every change goes through here, and every change records an undo point FIRST — the state
  // as it was, keyed by the gesture, so a sixty-frame drag collapses into one entry.
  const emit = useCallback((blocks, extra = {}, key = null) => {
    setHist((h) => pushHistory(h, canvas, key));
    onChange({ ...canvas, ...extra, blocks });
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

  const add = (kind, over = {}) => {
    const base = NEW_BLOCK[kind];
    const spec = { ...base, ...over, props: { ...(base.props || {}), ...(over.props || {}) } };
    // Dropped below everything already there, so a new block never lands hidden under one.
    const y = canvas.blocks.reduce((m, b) => Math.max(m, b.y + b.h), 0) + 24;
    const b = { id: uid(), x: 64, y, z: canvas.blocks.length, ...spec };
    emit([...canvas.blocks, b]);
    setSelId(b.id);
  };

  const chosen = canvas.blocks.filter((b) => selIds.includes(b.id));
  const duplicate = () => {
    if (!chosen.length) return;
    const copies = chosen.map((b) => ({ ...b, id: uid(), x: Math.min(b.x + GRID * 3, boardW - b.w), y: b.y + GRID * 3 }));
    emit([...canvas.blocks, ...copies]);
    setSelIds(copies.map((b) => b.id));
  };
  // A locked block survives Delete — the lock is there so a finished background cannot be
  // taken out by a keypress meant for whatever sits on it.
  const remove = () => { if (!chosen.length) return; emit(canvas.blocks.filter((b) => !selIds.includes(b.id) || b.locked)); setSelIds([]); };
  const setGrid = (n) => emit(canvas.blocks, { grid: n });
  const doAlign = (how) => emit(alignMany(canvas.blocks, selIds, how));
  const doDistribute = (axis) => emit(distributeMany(canvas.blocks, selIds, axis));

  // ── Pointer ────────────────────────────────────────────────────────────────
  // Pointer events, not mouse: one code path covers a trackpad, a mouse and a stylus, and
  // setPointerCapture means a fast drag that leaves the block (or the window) still tracks
  // instead of dropping it wherever the pointer left.
  const onDown = (e, b, handle) => {
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
    const startBB = boundsOf(canvas.blocks.filter((x) => ids.includes(x.id)));
    drag.current = { id: b.id, ids, handle, sx: e.clientX, sy: e.clientY, start: { ...b }, startBB };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => {
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.sx; const dy = e.clientY - d.sy;
    const others = canvas.blocks.filter((b) => b.id !== d.id);
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
    patch(d.id, next, `drag:${d.id}`);
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
  const onCanvasDown = (e) => {
    const host = hostRef.current; if (!host) return;
    const r = host.getBoundingClientRect();
    const x = (e.clientX - r.left) / scale, y = (e.clientY - r.top) / scale;
    marqueeRef.current = { x, y, additive: e.shiftKey || e.ctrlKey || e.metaKey, base: selIds };
    if (!marqueeRef.current.additive) setSelIds([]);
  };
  const onMarqueeMove = (e) => {
    const m = marqueeRef.current; if (!m) return;
    const host = hostRef.current; if (!host) return;
    const r = host.getBoundingClientRect();
    const rect = { x: m.x, y: m.y, w: (e.clientX - r.left) / scale - m.x, h: (e.clientY - r.top) / scale - m.y };
    if (Math.abs(rect.w) < 4 && Math.abs(rect.h) < 4) return;   // a click, not a drag
    setMarquee(rect);
    const hit = blocksInRect(canvas.blocks, rect).map((b) => b.id);
    setSelIds(m.additive ? [...new Set([...m.base, ...hit])] : hit);
  };
  const onMarqueeUp = () => { marqueeRef.current = null; setMarquee(null); };

  // Keyboard nudging. A mouse cannot reliably move a block by exactly one grid step, and
  // "almost aligned" is the thing this whole file exists to avoid.
  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName;
      // Undo is checked BEFORE the selection guard and before the input guard: it must work
      // with nothing selected, and Ctrl+Z inside a textarea is the browser's own undo — which
      // is the right one for text, so it is left alone.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault();
        if (e.shiftKey) doRedo(); else doUndo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault(); doRedo(); return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault(); setSelIds(canvas.blocks.map((b) => b.id)); return;
      }
      // Copy / paste: the selection as JSON, kept in a ref and offered to the clipboard so a
      // page can be assembled from another one open in a second tab.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && tag !== 'INPUT' && tag !== 'TEXTAREA' && selIds.length) {
        const picked = canvas.blocks.filter((b) => selIds.includes(b.id));
        clip.current = picked;
        try { navigator.clipboard?.writeText(JSON.stringify({ bcwBlocks: picked })); } catch { /* no clipboard: the ref still works */ }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        const paste = (list) => {
          if (!list?.length) return;
          const copies = list.map((b) => ({ ...b, id: uid(), x: Math.min(Math.max(0, (b.x || 0) + GRID * 3), boardW - (b.w || GRID)), y: (b.y || 0) + GRID * 3 }));
          emit([...canvas.blocks, ...copies]);
          setSelIds(copies.map((b) => b.id));
        };
        e.preventDefault();
        navigator.clipboard?.readText?.().then((txt) => { try { const j = JSON.parse(txt); if (Array.isArray(j?.bcwBlocks)) return paste(j.bcwBlocks); } catch { /* not ours */ } paste(clip.current); }).catch(() => paste(clip.current));
        return;
      }
      if (!selIds.length) return;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;   // typing, not nudging
      const step = e.shiftKey ? grid * 4 : grid;
      const map = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (map[e.key]) {
        e.preventDefault();
        // The whole selection, at scale 1 because a nudge is in DESIGN pixels — it is the
        // gesture for "exactly one grid step", which is the point of having it.
        commitMoved(moveMany(view.blocks, selIds.filter((id) => !view.blocks.find((b) => b.id === id)?.locked), map[e.key][0], map[e.key][1], 1, { snap: false, width: boardW }), `nudge:${selIds.join(',')}`);
      } else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(); }
      else if (e.key === 'Escape') setSelIds([]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selIds, canvas.blocks, emit, patch, doUndo, doRedo]);

  if (preview) {
    return (
      <div>
        <Toolbar {...{ t, preview, setPreview, snapOn, setSnapOn, add, addShape: (shape) => add('shape', { props: { shape, fill: 'var(--primary)', corner: 16 } }), sel, duplicate, remove, doUndo, doRedo, hist, selCount: selIds.length, doAlign, doDistribute, grid, setGrid, layersOpen, setLayersOpen, zoom, setZoom, pageOpen, setPageOpen }} />
      {pageOpen && <PagePanel t={t} canvas={canvas} emit={emit} add={add} onClose={() => setPageOpen(false)} />}
      {mdFor && (
        <Modal open onClose={() => setMdFor(null)} title={t('cst.md.editor', 'B.MD editor')} icon={Type} width="max-w-4xl">
          <Suspense fallback={<div className="py-10 text-center text-sm text-[var(--muted)]">{t('common.loading', 'Loading…')}</div>}>
            <LazyMarkdownEditor full minHeight={360} value={String(canvas.blocks.find((b) => b.id === mdFor)?.props?.md || '')}
              onChange={(v) => patch(mdFor, { props: { ...(canvas.blocks.find((b) => b.id === mdFor)?.props || {}), md: v } }, `md-${mdFor}`)} />
          </Suspense>
          <div className="flex justify-end mt-3"><Button variant="primary" onClick={() => setMdFor(null)}>{t('common.done', 'Done')}</Button></div>
        </Modal>
      )}
        <div className={preview === 'phone' ? 'mx-auto border border-[var(--line)] rounded-2xl p-3' : ''} style={preview === 'phone' ? { width: 390 } : undefined}>
          <CanvasView canvas={canvas} stackPreview={preview === 'phone'} />
        </div>
      </div>
    );
  }

  if (stacked) {
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
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <span className="text-[11px] text-[var(--muted)] flex-1 min-w-0">{t('cst.stack.h', 'Reading order — what a phone shows. Placement is a desktop thing.')}</span>
          <Button size="sm" variant="ghost" onClick={() => setPhoneMode('canvas')} title={t('cst.stack.board.h', 'Place the blocks freely — easier on a big screen')}><Monitor size={14} /> {t('cst.stack.board', 'Board')}</Button>
          <Button size="sm" variant="ghost" onClick={() => setPreview('phone')} title={t('cst.phone', 'Phone preview')}><Eye size={14} /></Button>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap mb-2">
          {[['text', Type], ['image', ImageIcon], ['box', Square], ['button', MousePointerClick], ['video', Film], ['embed', Globe], ['replay', PlayCircle]].map(([k, Icon]) => (
            <Button key={k} size="sm" onClick={() => add(k)}><Icon size={14} /> {t(`cst.add.${k}`, k)}</Button>
          ))}
          <div className="flex-1" />
          <Button size="sm" variant="ghost" disabled={!hist.past.length} onClick={doUndo} title={t('cst.undo', 'Undo')}><Undo2 size={14} /></Button>
        </div>
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
                <Button size="sm" variant="ghost" className="!px-2 !text-[var(--error)]" onClick={(e) => { e.stopPropagation(); setSelIds([b.id]); remove(); }} title={t('cst.del', 'Delete')}><Trash2 size={14} /></Button>
              </div>
              {/* The block exactly as the reader gets it, stacked — the same component the
                  public page paints with, so this is not a second opinion about how it looks.
                  Not interactive: a tap anywhere on the row selects it. */}
              <div className="rounded-lg overflow-hidden pointer-events-none"><CanvasBlock b={b} stacked /></div>
            </div>
          ))}
          {!order.length && <div className="text-xs text-[var(--faint)] text-center py-8 rounded-xl border border-dashed border-[var(--line)]">{t('cst.stack.empty', 'Nothing on this page yet — add a block above.')}</div>}
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
        {/* The inspector, pinned to the bottom of the viewport and only while something is
            selected — an empty panel over a list is just a shorter list. */}
        {sel && (
          <div className="sticky bottom-0 z-20 mt-2 max-h-[46vh] overflow-auto rounded-t-2xl border-t border-[var(--line-strong)] shadow-[0_-10px_30px_-12px_rgba(0,0,0,0.35)]" style={{ background: 'var(--bg-solid)' }}>
            <Inspector {...{ t, sel, patch, canvas, emit, setSelId, hasDark, onOpenMd: setMdFor }} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <Toolbar {...{ t, preview, setPreview, snapOn, setSnapOn, add, addShape: (shape) => add('shape', { props: { shape, fill: 'var(--primary)', corner: 16 } }), sel, duplicate, remove, doUndo, doRedo, hist, selCount: selIds.length, doAlign, doDistribute, grid, setGrid, layersOpen, setLayersOpen, zoom, setZoom, pageOpen, setPageOpen }} />
      {pageOpen && <PagePanel t={t} canvas={canvas} emit={emit} add={add} onClose={() => setPageOpen(false)} />}
      {mdFor && (
        <Modal open onClose={() => setMdFor(null)} title={t('cst.md.editor', 'B.MD editor')} icon={Type} width="max-w-4xl">
          <Suspense fallback={<div className="py-10 text-center text-sm text-[var(--muted)]">{t('common.loading', 'Loading…')}</div>}>
            <LazyMarkdownEditor full minHeight={360} value={String(canvas.blocks.find((b) => b.id === mdFor)?.props?.md || '')}
              onChange={(v) => patch(mdFor, { props: { ...(canvas.blocks.find((b) => b.id === mdFor)?.props || {}), md: v } }, `md-${mdFor}`)} />
          </Suspense>
          <div className="flex justify-end mt-3"><Button variant="primary" onClick={() => setMdFor(null)}>{t('common.done', 'Done')}</Button></div>
        </Modal>
      )}
      {/* Which theme is being authored. A page is read on both backgrounds and a hero built
          for one is not the same picture on the other; the alternative to this switch was
          authoring the page twice. Dark writes a partial OVERLAY, so anything not touched here
          keeps following the light layout. */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <div className="inline-flex rounded-lg border border-[var(--line)] overflow-hidden">
          {[['light', Sun, t('cst.theme.light', 'Light')], ['dark', Moon, t('cst.theme.dark', 'Dark')], ['phone', Smartphone, t('cst.board.phone', 'Phone')]].map(([k, Icon, label]) => (
            <button key={k} type="button" onClick={() => setEditTheme(k)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs transition-colors ${editTheme === k ? 'bg-[var(--primary)]/12 text-[var(--text)] font-medium' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>
              <Icon size={12} /> {label}
            </button>
          ))}
        </div>
        {editTheme === 'dark' && (
          <span className="text-[11px] text-[var(--muted)]">{t('cst.theme.h', 'Editing the dark version. Anything you do not change here keeps following the light layout.')}</span>
        )}
        {phoneBoard && (
          <span className="text-[11px] text-[var(--muted)]">{canvas.phoneBoard
            ? t('cst.board.phone.h', 'The 390px phone board. Blocks you place stay where you put them; the rest are laid underneath in reading order.')
            : t('cst.board.phone.h0', 'Phones get the reading-order stack until you place something here. Move or resize a block and the board takes over.')}</span>
        )}
      </div>
      {narrow && !preview && (
        <div className="text-[11px] text-[var(--muted)] mb-2 flex items-center gap-2">
          <span className="flex-1 min-w-0">{t('cst.board.h', 'The board is 1200px wide, scaled to fit. A phone reader gets the list order instead.')}</span>
          <Button size="sm" variant="ghost" onClick={() => setPhoneMode('stack')}>{t('cst.board.list', 'List')}</Button>
        </div>
      )}
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-4 lg:items-start">
        {/* `touchAction: none` is what makes this usable with a finger at all: without it the
            browser claims the gesture and drags scroll the page instead of moving the block —
            and a design surface you cannot drag on is not a design surface. The modal body
            around it still scrolls, so nothing is trapped. */}
        <div ref={hostRef} className={`${scale > fitScale ? 'overflow-auto' : 'overflow-hidden'} rounded-xl border border-[var(--line)] bg-[var(--surface-2)]`}
          style={{ touchAction: 'none' }}
          onPointerMove={(e) => { onMarqueeMove(e); onMove(e); }}
          onPointerUp={(e) => { onMarqueeUp(); onUp(e); }}
          onPointerCancel={(e) => { onMarqueeUp(); onUp(e); }}
          onPointerDown={onCanvasDown}>
          <div style={{ height: boardH * scale, position: 'relative', ...(phoneBoard ? { width: boardW * scale, margin: '0 auto' } : {}) }}>
            <div style={{ width: boardW, height: boardH, transform: `scale(${scale})`, transformOrigin: 'top left', position: 'absolute', top: 0, left: 0 }}>
              {/* The grid, drawn so placement is legible rather than guessed at. */}
              <div aria-hidden style={{
                position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.5,
                backgroundImage: 'linear-gradient(to right, var(--line) 1px, transparent 1px), linear-gradient(to bottom, var(--line) 1px, transparent 1px)',
                backgroundSize: `${Math.max(32, grid * 4)}px ${Math.max(32, grid * 4)}px`,
              }} />
              {paintOrder(view.blocks).map((b) => (
                <BoardBlock key={b.id} b={b} on={selIds.includes(b.id)} only={selIds.length === 1 && selIds[0] === b.id} down={stableDown} />
              ))}
              {/* Guides, drawn only while a drag is snapping to something. */}
              {guides.v && <div aria-hidden style={{ position: 'absolute', left: guides.v.at, top: 0, bottom: 0, width: 1, background: 'var(--primary)', pointerEvents: 'none' }} />}
              {guides.h && <div aria-hidden style={{ position: 'absolute', top: guides.h.at, left: 0, right: 0, height: 1, background: 'var(--primary)', pointerEvents: 'none' }} />}
              {marquee && (
                <div aria-hidden style={{ position: 'absolute', pointerEvents: 'none',
                  left: Math.min(marquee.x, marquee.x + marquee.w), top: Math.min(marquee.y, marquee.y + marquee.h),
                  width: Math.abs(marquee.w), height: Math.abs(marquee.h),
                  border: '1px solid var(--primary)', background: 'color-mix(in srgb, var(--primary) 12%, transparent)' }} />
              )}
            </div>
          </div>
        </div>
        {/* The inspector.
            On a wide screen it is the right-hand column of the grid above. Below `lg` the grid
            collapses and it lands UNDER the canvas — which on a phone means scrolling past the
            whole page you are editing to change the block you just tapped, then scrolling back
            to see what happened. So on narrow screens it sticks to the bottom of the viewport
            instead, and only while something is selected: an empty panel pinned over the
            canvas would just be a smaller canvas. */}
        <div className={`lg:static lg:mt-0 ${sel ? 'sticky bottom-0 z-20 mt-2 max-h-[46vh] overflow-auto rounded-t-2xl border-t lg:border-t-0 border-[var(--line-strong)] lg:rounded-t-none lg:max-h-none lg:overflow-visible lg:shadow-none shadow-[0_-10px_30px_-12px_rgba(0,0,0,0.35)]' : 'mt-2'}`}
          style={sel ? { background: 'var(--bg-solid)' } : undefined}>
          {layersOpen && <LayersPanel {...{ t, canvas, view, selIds, setSelIds, patch, emit }} />}
          <Inspector {...{ t, sel, patch, canvas, emit, setSelId, hasDark, onOpenMd: setMdFor }} />
        </div>
      </div>
    </div>
  );
}

/**
 * The Layers panel: every block, top of the paint order first, with its name, a lock, an eye
 * and the two arrows. The one place a hidden block can be found again, and the one place a
 * block under three others can be selected without moving them.
 */
function LayersPanel({ t, canvas, view, selIds, setSelIds, patch, emit }) {
  const rows = paintOrder(view.blocks).slice().reverse();
  return (
    <div className="mb-3 rounded-xl border border-[var(--line)] p-2">
      <div className="flex items-center gap-1.5 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)]">
        <LayoutList size={12} /> {t('cst.layers', 'Layers')}
        <span className="ms-auto tabular-nums font-normal">{rows.length}</span>
      </div>
      {!rows.length && <div className="text-xs text-[var(--faint)] py-2 text-center">{t('cst.layers.empty', 'Nothing on this page yet.')}</div>}
      <div className="max-h-56 overflow-auto space-y-0.5">
        {rows.map((b, i) => {
          const on = selIds.includes(b.id);
          return (
            <div key={b.id}
              className={`flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs cursor-pointer ${on ? 'bg-[var(--primary)]/12' : 'hover:bg-[var(--surface-2)]'}`}
              onClick={(e) => setSelIds(e.shiftKey || e.ctrlKey || e.metaKey ? (on ? selIds.filter((x) => x !== b.id) : [...selIds, b.id]) : [b.id])}>
              <span className={`flex-1 min-w-0 truncate ${b.hidden ? 'text-[var(--faint)] line-through' : ''}`}>
                {b.name || t(`cst.kind.${b.kind}`, b.kind)}
                {!b.name && <span className="text-[var(--faint)] ms-1">#{b.id.slice(-3)}</span>}
              </span>
              <button type="button" className="p-0.5 rounded hover:bg-[var(--surface-2)] disabled:opacity-30" disabled={i === 0} onClick={(e) => { e.stopPropagation(); emit(reorder(canvas.blocks, b.id, 'up')); }} title={t('cst.layer.up', 'Move up')} aria-label={t('cst.layer.up', 'Move up')}><ChevronUp size={12} /></button>
              <button type="button" className="p-0.5 rounded hover:bg-[var(--surface-2)] disabled:opacity-30" disabled={i === rows.length - 1} onClick={(e) => { e.stopPropagation(); emit(reorder(canvas.blocks, b.id, 'down')); }} title={t('cst.layer.down', 'Move down')} aria-label={t('cst.layer.down', 'Move down')}><ChevronDown size={12} /></button>
              <button type="button" className={`p-0.5 rounded hover:bg-[var(--surface-2)] ${b.locked ? 'text-[var(--primary-2)]' : 'text-[var(--faint)]'}`} onClick={(e) => { e.stopPropagation(); patch(b.id, { locked: !b.locked }); }} title={b.locked ? t('cst.layer.unlock', 'Unlock') : t('cst.layer.lock', 'Lock')} aria-label={b.locked ? t('cst.layer.unlock', 'Unlock') : t('cst.layer.lock', 'Lock')}>{b.locked ? <Lock size={12} /> : <LockOpen size={12} />}</button>
              <button type="button" className={`p-0.5 rounded hover:bg-[var(--surface-2)] ${b.hidden ? 'text-[var(--primary-2)]' : 'text-[var(--faint)]'}`} onClick={(e) => { e.stopPropagation(); patch(b.id, { hidden: !b.hidden }); }} title={b.hidden ? t('cst.layer.show', 'Show') : t('cst.layer.hide', 'Hide')} aria-label={b.hidden ? t('cst.layer.show', 'Show') : t('cst.layer.hide', 'Hide')}>{b.hidden ? <EyeOff size={12} /> : <Eye size={12} />}</button>
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
      <Field label={t('cst.btn.items', 'Menu items — one per line: label | link')}>
        <Textarea rows={4} value={itemsText} onChange={(e) => setProp('items', e.target.value.split('\n').map((l) => { const [label, href] = l.split('|'); return { label: (label || '').trim(), href: (href || '').trim() }; }).filter((it) => it.label))} />
      </Field>
    ) : (<>
      <Field label={t('cst.btn.action', 'On press')}>
        <Select value={act.type || 'link'} onChange={(e) => setAct('type', e.target.value)}>
          {BUTTON_ACTIONS.map((v) => <option key={v} value={v}>{t(`cst.btn.a.${v}`, v)}</option>)}
        </Select>
      </Field>
      {(act.type === 'link' || act.type === 'download' || !act.type) && <Field label={t('cst.btn.href', 'Link')}><Input value={act.href || ''} onChange={(e) => setAct('href', e.target.value)} placeholder="/hosting · https://…" /></Field>}
      {act.type === 'copy' && <Field label={t('cst.btn.copytext', 'Text to copy')}><Input value={act.text || ''} onChange={(e) => setAct('text', e.target.value)} /></Field>}
      {act.type === 'scroll' && <Field label={t('cst.btn.target', 'Scroll to (CSS selector)')}><Input value={act.target || ''} onChange={(e) => setAct('target', e.target.value)} placeholder="#plans" /></Field>}
      {act.type === 'api' && (<>
        <div className="grid grid-cols-[80px_1fr] gap-2">
          <Field label={t('cst.btn.method', 'Method')}>
            <Select value={act.method || 'GET'} onChange={(e) => setAct('method', e.target.value)}><option>GET</option><option>POST</option></Select>
          </Field>
          <Field label={t('cst.btn.path', 'API path')}><Input value={act.path || ''} onChange={(e) => setAct('path', e.target.value)} placeholder="/updates/bmm/latest" /></Field>
        </div>
        <Field label={t('cst.btn.open', 'Open the URL found at (optional, e.g. asset.url)')}><Input value={act.open || ''} onChange={(e) => setAct('open', e.target.value)} /></Field>
        <p className="text-[11px] text-[var(--muted)]">{t('cst.btn.api.h', 'Calls /api + path with the reader’s session. Only paths on this site.')}</p>
      </>)}
      <Field label={t('cst.btn.done', 'Label after (copy / API)')}><Input value={p.doneLabel || ''} onChange={(e) => setProp('doneLabel', e.target.value)} placeholder="✓" /></Field>
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
const BoardBlock = memo(function BoardBlock({ b, on, only, down }) {
  return (
    <div
      onPointerDown={(e) => down(e, b, null)}
      style={{ position: 'absolute', left: b.x, top: b.y, width: b.w, height: b.h, zIndex: (b.z || 0) + (on ? 1000 : 0), cursor: b.locked ? 'default' : 'move', touchAction: 'none', opacity: b.hidden ? 0.3 : undefined, transform: b.rotate ? `rotate(${b.rotate}deg)` : undefined }}>
      <BlockBody b={b} />
      <div style={{ position: 'absolute', inset: 0, outline: on ? '2px solid var(--primary)' : '1px dashed var(--line-strong)', outlineOffset: 0, pointerEvents: 'none' }} />
      {(b.locked || b.hidden) && (
        <span aria-hidden style={{ position: 'absolute', left: 2, top: 2, display: 'inline-flex', gap: 2, background: 'var(--bg-solid)', borderRadius: 6, padding: '1px 4px', pointerEvents: 'none' }}>
          {b.locked && <Lock size={10} />}{b.hidden && <EyeOff size={10} />}
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

/** The page itself: background, the author's stylesheet (scoped), and file imports. */
function PagePanel({ t, canvas, emit, add, onClose }) {
  const [css, setCss] = useState(canvas.css || '');
  const [bg, setBg] = useState(canvas.bg || '');
  const { refused } = scopeCss(css, '[data-cv="x"]');
  const save = () => { emit(canvas.blocks, { css, bg }); onClose(); };
  const importFile = async (file) => {
    if (!file) return;
    const text = await file.text();
    if (/\.svg$/i.test(file.name)) { add('svg', { props: { svg: sanitizeSvg(text) }, w: 320, h: 320 }); onClose(); }
    else setCss((c) => (c ? `${c}\n\n` : '') + `/* ${file.name} */\n${text}`);
  };
  return (
    <Modal open onClose={onClose} title={t('cst.page', 'Page')} icon={Layers} width="max-w-2xl">
      <div className="space-y-3">
        <Field label={t('cst.bg.page', 'Page background')} hint={t('cst.bg.page.h', 'A colour, a gradient, or nothing for the site background.')}><Input value={bg} onChange={(e) => setBg(e.target.value)} placeholder="linear-gradient(…) · #fafafa · var(--surface-2)" /></Field>
        <Field label={t('cst.css', 'Custom CSS (scoped to this page)')} hint={t('cst.css.h', 'Every selector is confined to this page. @import, external url(), expression() and behaviour are refused. Tailwind utilities work only if the site\u2019s build already contains them — prefer plain CSS here.')}>
          <Textarea rows={10} value={css} onChange={(e) => setCss(e.target.value)} className="font-mono text-[12px]" spellCheck={false} placeholder={'.hero { letter-spacing: .02em }\n@media (max-width: 640px) { .cv-shell { border-radius: 8px } }'} />
        </Field>
        {refused.length > 0 && <p className="text-[11.5px] text-warning">{t('cst.css.refused', 'Left out:')} {refused.join(' · ')}</p>}
        <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer text-[var(--primary-2)] hover:underline">
          <Upload size={13} /> {t('cst.import', 'Import a .css or .svg file')}
          <input type="file" accept=".css,.svg,text/css,image/svg+xml" className="hidden" onChange={(e) => { importFile(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button><Button variant="primary" onClick={save}>{t('common.save', 'Save')}</Button></div>
      </div>
    </Modal>
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

function Toolbar({ t, preview, setPreview, snapOn, setSnapOn, add, addShape, sel, duplicate, remove, doUndo, doRedo, hist, selCount, doAlign, doDistribute, grid, setGrid, layersOpen, setLayersOpen, zoom, setZoom, pageOpen, setPageOpen }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 mb-3">
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
      <Button size="sm" variant={pageOpen ? 'primary' : 'ghost'} onClick={() => setPageOpen((v) => !v)} title={t('cst.page.h', 'Page background, custom CSS, imports')}><Layers size={14} /> {t('cst.page', 'Page')}</Button>
      <select className="bg-transparent text-[var(--text)] text-xs" value={String(zoom)} onChange={(e) => setZoom(e.target.value === 'fit' ? 'fit' : Number(e.target.value))} aria-label={t('cst.zoom', 'Zoom')} title={t('cst.zoom', 'Zoom')}>
        <option value="fit">{t('cst.zoom.fit', 'Fit')}</option><option value="0.5">50%</option><option value="0.75">75%</option><option value="1">100%</option>
      </select>
      <span className="w-px h-5 bg-[var(--line)] mx-1" />
      <Button size="sm" variant="ghost" disabled={!hist.past.length} onClick={doUndo} data-undo-steps={hist.past.length} data-undo-key={String(hist.key)} title={`Ctrl+Z · ${hist.past.length}`}><Undo2 size={14} /></Button>
      <Button size="sm" variant="ghost" disabled={!hist.future.length} onClick={doRedo} title="Ctrl+Shift+Z"><Redo2 size={14} /></Button>
      <span className="w-px h-5 bg-[var(--line)] mx-1" />
      <Button size="sm" variant="ghost" disabled={!selCount} onClick={duplicate}><Copy size={14} /> {t('cst.dup', 'Duplicate')}</Button>
      <Button size="sm" variant="ghost" disabled={!selCount} className="!text-error" onClick={remove}><Trash2 size={14} /></Button>
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
        {selCount > 2 && (<>
          <Button size="sm" variant="ghost" onClick={() => doDistribute('x')} title={t('cst.dist.x', 'Even gaps across')}><AlignHorizontalSpaceAround size={14} /></Button>
          <Button size="sm" variant="ghost" onClick={() => doDistribute('y')} title={t('cst.dist.y', 'Even gaps down')}><AlignVerticalSpaceAround size={14} /></Button>
        </>)}
      </>)}
      <span className="w-px h-5 bg-[var(--line)] mx-1" />
      <Button size="sm" variant={snapOn ? 'primary' : 'ghost'} onClick={() => setSnapOn((v) => !v)} title={t('cst.snap.h', 'Snap to the grid and to other blocks')}><Magnet size={14} /></Button>
      <label className="inline-flex items-center gap-1 text-[11px] text-[var(--muted)]" title={t('cst.grid.h', 'The grid step blocks snap to')}>
        <Grid2x2 size={13} />
        <select className="bg-transparent text-[var(--text)] text-xs" value={grid} onChange={(e) => setGrid(Number(e.target.value))} aria-label={t('cst.grid', 'Grid')}>
          {GRID_SIZES.map((n) => <option key={n} value={n}>{n}px</option>)}
        </select>
      </label>
      <Button size="sm" variant={layersOpen ? 'primary' : 'ghost'} onClick={() => setLayersOpen((v) => !v)} title={t('cst.layers.h', 'Every block, top first — name, lock, hide, reorder')}><LayoutList size={14} /> {t('cst.layers', 'Layers')}</Button>
      {/* A desktop author cannot otherwise ever see the stacked version, and the stacked
          version is what most visitors get. */}
      <Button size="sm" variant={preview === 'desktop' ? 'primary' : 'ghost'} onClick={() => setPreview((v) => (v === 'desktop' ? '' : 'desktop'))}><Eye size={14} /> {t('cst.preview', 'Preview')}</Button>
      <Button size="sm" variant={preview === 'phone' ? 'primary' : 'ghost'} onClick={() => setPreview((v) => (v === 'phone' ? '' : 'phone'))} title={t('cst.phone.h', 'What a phone gets: the canvas stacks')}><Smartphone size={14} /></Button>
      {preview && <span className="text-[11px] text-[var(--faint)] inline-flex items-center gap-1"><Monitor size={12} /> {t('cst.previewing', 'Preview — editing is paused')}</span>}
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
    <div className="mt-4 lg:mt-0 rounded-xl border border-[var(--line)] p-3 space-y-3 lg:sticky lg:top-4">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)]">{sel.kind}</span>
        {/* Whether THIS block says anything of its own on dark. Without it, an author on the
            dark theme cannot tell an overridden block from one that is simply inheriting —
            they look identical, which is the point of inheriting and the problem with it. */}
        {hasDark && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--primary)]/12 text-[var(--primary-2)]">{t('cst.theme.has', 'dark variant')}</span>}
        <div className="ms-auto flex gap-1">
          <button title={t('cst.front', 'Bring to front')} className="p-1 rounded hover:bg-[var(--surface-2)]" onClick={() => emit(bringTo(canvas.blocks, sel.id, 'front'))}><ArrowUp size={14} /></button>
          <button title={t('cst.back', 'Send to back')} className="p-1 rounded hover:bg-[var(--surface-2)]" onClick={() => emit(bringTo(canvas.blocks, sel.id, 'back'))}><ArrowDown size={14} /></button>
          {hasDark && (
            <button title={t('cst.theme.reset', 'Drop the dark variant — this block follows the light layout again')}
              className="p-1 rounded hover:bg-[var(--surface-2)]"
              onClick={() => emit(canvas.blocks.map((b) => (b.id === sel.id ? { ...b, themes: { ...(b.themes || {}), dark: undefined } } : b)))}>
              <Layers size={14} />
            </button>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Input className="flex-1 min-w-0" value={sel.name || ''} placeholder={t('cst.name.ph', 'Name this block…')} aria-label={t('cst.name', 'Name')} onChange={(e) => patch(sel.id, { name: e.target.value.slice(0, 60) }, `name-${sel.id}`)} />
        <button type="button" className={`p-1.5 rounded border border-[var(--line)] ${sel.locked ? 'text-[var(--primary-2)] bg-[var(--primary)]/12' : 'text-[var(--faint)]'}`} onClick={() => patch(sel.id, { locked: !sel.locked })} title={t('cst.locked.h', 'Locked: the panel still edits it, the pointer cannot move, resize or delete it')} aria-label={t('cst.locked', 'Locked')}>{sel.locked ? <Lock size={13} /> : <LockOpen size={13} />}</button>
        <button type="button" className={`p-1.5 rounded border border-[var(--line)] ${sel.hidden ? 'text-[var(--primary-2)] bg-[var(--primary)]/12' : 'text-[var(--faint)]'}`} onClick={() => patch(sel.id, { hidden: !sel.hidden })} title={t('cst.hidden.h', 'Hidden: kept on the board, not shown to readers')} aria-label={t('cst.hidden', 'Hidden')}>{sel.hidden ? <EyeOff size={13} /> : <Eye size={13} />}</button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {numField('X', 'x')}{numField('Y', 'y')}{numField(t('cst.w', 'Width'), 'w')}{numField(t('cst.h', 'Height'), 'h')}
      </div>
      {sel.kind === 'text' && (
        <Field label={t('cst.md', 'Content (B.MD)')}>
          <Textarea rows={8} value={p.md || ''} onChange={(e) => setProp('md', e.target.value)} />
          <button type="button" className="mt-1 text-[11.5px] text-[var(--primary-2)] hover:underline inline-flex items-center gap-1" onClick={() => onOpenMd?.(sel.id)}><Type size={12} /> {t('cst.md.open', 'Open in the B.MD editor')}</button>
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
        <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer text-[var(--primary-2)] hover:underline">
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
          <p className="text-[11px] text-warning">{t('cst.video.automute', 'Autoplay only works on a muted video — every browser blocks the other kind. Tick Muted, or the video will simply wait to be played.')}</p>
        )}
      </>)}
      {sel.kind === 'embed' && (<>
        <Field label={t('cst.embed.url', 'Embed URL')}><Input value={p.url || ''} onChange={(e) => setProp('url', e.target.value)} placeholder="https://www.youtube.com/embed/…" /></Field>
        <Field label={t('cst.embed.title', 'Title (for screen readers)')}><Input value={p.title || ''} onChange={(e) => setProp('title', e.target.value)} /></Field>
        {/* The allow-list is B.MD's, shared with every embed in a blog post or a doc — not a
            second list. A refused URL still renders, as a link, so it is visible that it was
            refused rather than looking like a blank block. */}
        <p className="text-[11px] text-[var(--muted)]">{t('cst.embed.allow', 'Only YouTube and Spotify embed links can be framed — the same list the rest of the site uses. Anything else is shown as a link instead.')}</p>
      </>)}
      {sel.kind === 'replay' && (
        <Field label={t('cst.replay.src', '.bmmreplay URL')} hint={t('cst.replay.h', 'A recording of the app, played by the same player the docs and the blog use.')}>
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
