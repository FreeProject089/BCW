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
  Undo2, Redo2, AlertTriangle, Upload,
  AlignStartVertical, AlignCenterVertical, AlignEndVertical,
  AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
  AlignHorizontalSpaceAround, AlignVerticalSpaceAround,
} from 'lucide-react';
import { Button, Field, Input, Textarea, useToast } from '../ui/ui.jsx';
import { useI18n } from '../i18n.jsx';
import { uploadMedia } from '../lib/api.js';
import CanvasView, { CanvasBlock } from '../ui/canvas-view.jsx';
import {
  normalizeCanvas, paintOrder, dragTo, resizeTo, alignmentGuides, bringTo,
  emptyHistory, pushHistory, undo as undoHist, redo as redoHist,
  boundsOf, blocksInRect, moveMany, alignMany, distributeMany, readingOrder,
  DESIGN_WIDTH, GRID, HANDLES,
} from '../lib/canvas.js';

const uid = () => `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

const NEW_BLOCK = {
  text: { kind: 'text', w: 400, h: 160, props: { md: '## Titre\n\nÉcris ici.' } },
  image: { kind: 'image', w: 400, h: 260, props: { src: '', alt: '', fit: 'cover' } },
  box: { kind: 'box', w: 400, h: 200, props: { bg: 'rgba(99,102,241,0.10)', radius: 16 } },
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
  const scale = Math.min(1, Math.max(0.3, vw / DESIGN_WIDTH));
  const sel = canvas.blocks.find((b) => b.id === selId) || null;

  // Every change goes through here, and every change records an undo point FIRST — the state
  // as it was, keyed by the gesture, so a sixty-frame drag collapses into one entry.
  const emit = useCallback((blocks, extra = {}, key = null) => {
    setHist((h) => pushHistory(h, canvas, key));
    onChange({ ...canvas, ...extra, blocks });
  }, [canvas, onChange]);

  const patch = useCallback((id, next, key = null) => {
    emit(canvas.blocks.map((b) => (b.id === id ? { ...b, ...next } : b)), {}, key);
  }, [canvas.blocks, emit]);

  const doUndo = useCallback(() => {
    const r = undoHist(hist, canvas);
    if (r) { setHist(r.hist); onChange(r.value); }
  }, [hist, canvas, onChange]);
  const doRedo = useCallback(() => {
    const r = redoHist(hist, canvas);
    if (r) { setHist(r.hist); onChange(r.value); }
  }, [hist, canvas, onChange]);

  const add = (kind) => {
    const spec = NEW_BLOCK[kind];
    // Dropped below everything already there, so a new block never lands hidden under one.
    const y = canvas.blocks.reduce((m, b) => Math.max(m, b.y + b.h), 0) + 24;
    const b = { id: uid(), x: 64, y, z: canvas.blocks.length, ...spec };
    emit([...canvas.blocks, b]);
    setSelId(b.id);
  };

  const chosen = canvas.blocks.filter((b) => selIds.includes(b.id));
  const duplicate = () => {
    if (!chosen.length) return;
    const copies = chosen.map((b) => ({ ...b, id: uid(), x: Math.min(b.x + GRID * 3, DESIGN_WIDTH - b.w), y: b.y + GRID * 3 }));
    emit([...canvas.blocks, ...copies]);
    setSelIds(copies.map((b) => b.id));
  };
  const remove = () => { if (!chosen.length) return; emit(canvas.blocks.filter((b) => !selIds.includes(b.id))); setSelIds([]); };
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
    const startBB = boundsOf(canvas.blocks.filter((x) => ids.includes(x.id)));
    drag.current = { id: b.id, ids, handle, sx: e.clientX, sy: e.clientY, start: { ...b }, startBB };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => {
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.sx; const dy = e.clientY - d.sy;
    const others = canvas.blocks.filter((b) => b.id !== d.id);
    if (d.handle) {
      patch(d.id, resizeTo(d.start, d.handle, dx, dy, scale, { snap: snapOn }), `resize:${d.id}:${d.handle}`);
      return;
    }
    if (d.ids && d.ids.length > 1) {
      // Resize is deliberately single-block; a group drag is the whole selection at once,
      // clamped as one box so the arrangement cannot collapse against an edge.
      emit(moveMany(canvas.blocks, d.ids, dx, dy, scale, { snap: snapOn, startX: d.startBB?.x, startY: d.startBB?.y }), {}, `drag:${d.ids.join(',')}`);
      return;
    }
    let next = dragTo(d.start, dx, dy, scale, { snap: snapOn });
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
      if (!selIds.length) return;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;   // typing, not nudging
      const step = e.shiftKey ? GRID * 4 : GRID;
      const map = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (map[e.key]) {
        e.preventDefault();
        // The whole selection, at scale 1 because a nudge is in DESIGN pixels — it is the
        // gesture for "exactly one grid step", which is the point of having it.
        emit(moveMany(canvas.blocks, selIds, map[e.key][0], map[e.key][1], 1, { snap: false }), {}, `nudge:${selIds.join(',')}`);
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
        <Toolbar {...{ t, preview, setPreview, snapOn, setSnapOn, add, sel, duplicate, remove, doUndo, doRedo, hist, selCount: selIds.length, doAlign, doDistribute }} />
        <div className={preview === 'phone' ? 'mx-auto border border-[var(--line)] rounded-2xl p-3' : ''} style={preview === 'phone' ? { width: 390 } : undefined}>
          <CanvasView canvas={canvas} stackPreview={preview === 'phone'} />
        </div>
      </div>
    );
  }

  if (stacked) {
    const order = readingOrder(canvas.blocks);
    const swap = (i, dir) => {
      const j = i + dir;
      if (j < 0 || j >= order.length) return;
      // Reading order is DERIVED from position, so "move up" is a swap of the two blocks'
      // coordinates — the list has no order of its own to reorder, and pretending otherwise
      // is how a phone edit fails to survive a reload. Two blocks of different sizes can end
      // up overlapping on the board afterwards; the board is where that is visible and
      // fixable, and the reader on a phone is unaffected either way.
      const a = order[i], b = order[j];
      emit(canvas.blocks.map((x) => (
        x.id === a.id ? { ...x, x: b.x, y: b.y } : x.id === b.id ? { ...x, x: a.x, y: a.y } : x
      )));
    };
    return (
      <div>
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <span className="text-[11px] text-[var(--muted)] flex-1 min-w-0">{t('cst.stack.h', 'Reading order — what a phone shows. Placement is a desktop thing.')}</span>
          <Button size="sm" variant="ghost" onClick={() => setPhoneMode('canvas')} title={t('cst.stack.board.h', 'Place the blocks freely — easier on a big screen')}><Monitor size={14} /> {t('cst.stack.board', 'Board')}</Button>
          <Button size="sm" variant="ghost" onClick={() => setPreview('phone')} title={t('cst.phone', 'Phone preview')}><Eye size={14} /></Button>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap mb-2">
          {[['text', Type], ['image', ImageIcon], ['box', Square]].map(([k, Icon]) => (
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
        {/* The inspector, pinned to the bottom of the viewport and only while something is
            selected — an empty panel over a list is just a shorter list. */}
        {sel && (
          <div className="sticky bottom-0 z-20 mt-2 max-h-[46vh] overflow-auto rounded-t-2xl border-t border-[var(--line-strong)] shadow-[0_-10px_30px_-12px_rgba(0,0,0,0.35)]" style={{ background: 'var(--bg-solid)' }}>
            <Inspector {...{ t, sel, patch, canvas, emit, setSelId }} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <Toolbar {...{ t, preview, setPreview, snapOn, setSnapOn, add, sel, duplicate, remove, doUndo, doRedo, hist, selCount: selIds.length, doAlign, doDistribute }} />
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
        <div ref={hostRef} className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface-2)]"
          style={{ touchAction: 'none' }}
          onPointerMove={(e) => { onMarqueeMove(e); onMove(e); }}
          onPointerUp={(e) => { onMarqueeUp(); onUp(e); }}
          onPointerCancel={(e) => { onMarqueeUp(); onUp(e); }}
          onPointerDown={onCanvasDown}>
          <div style={{ height: canvas.height * scale, position: 'relative' }}>
            <div style={{ width: DESIGN_WIDTH, height: canvas.height, transform: `scale(${scale})`, transformOrigin: 'top left', position: 'absolute', top: 0, left: 0 }}>
              {/* The grid, drawn so placement is legible rather than guessed at. */}
              <div aria-hidden style={{
                position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.5,
                backgroundImage: 'linear-gradient(to right, var(--line) 1px, transparent 1px), linear-gradient(to bottom, var(--line) 1px, transparent 1px)',
                backgroundSize: `${GRID * 8}px ${GRID * 8}px`,
              }} />
              {paintOrder(canvas.blocks).map((b) => {
                const on = selIds.includes(b.id);
                const only = selIds.length === 1 && on;
                return (
                  <div key={b.id}
                    onPointerDown={(e) => onDown(e, b, null)}
                    style={{ position: 'absolute', left: b.x, top: b.y, width: b.w, height: b.h, zIndex: (b.z || 0) + (on ? 1000 : 0), cursor: 'move', touchAction: 'none' }}>
                    <BlockBody b={b} />
                    <div style={{ position: 'absolute', inset: 0, outline: on ? '2px solid var(--primary)' : '1px dashed var(--line-strong)', outlineOffset: 0, pointerEvents: 'none' }} />
                    {only && Object.keys(HANDLES).map((hk) => (
                      <span key={hk} onPointerDown={(e) => onDown(e, b, hk)}
                        className="cst-handle"
                        style={{ position: 'absolute', width: 12, height: 12, background: 'var(--primary)', borderRadius: 3, ...handlePos(hk), cursor: `${hk}-resize`, touchAction: 'none' }} />
                    ))}
                  </div>
                );
              })}
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
          <Inspector {...{ t, sel, patch, canvas, emit, setSelId }} />
        </div>
      </div>
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

function Toolbar({ t, preview, setPreview, snapOn, setSnapOn, add, sel, duplicate, remove, doUndo, doRedo, hist, selCount, doAlign, doDistribute }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 mb-3">
      <Button size="sm" variant="ghost" onClick={() => add('text')}><Type size={14} /> {t('cst.text', 'Text')}</Button>
      <Button size="sm" variant="ghost" onClick={() => add('image')}><ImageIcon size={14} /> {t('cst.image', 'Image')}</Button>
      <Button size="sm" variant="ghost" onClick={() => add('box')}><Square size={14} /> {t('cst.box', 'Box')}</Button>
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
      {/* A desktop author cannot otherwise ever see the stacked version, and the stacked
          version is what most visitors get. */}
      <Button size="sm" variant={preview === 'desktop' ? 'primary' : 'ghost'} onClick={() => setPreview((v) => (v === 'desktop' ? '' : 'desktop'))}><Eye size={14} /> {t('cst.preview', 'Preview')}</Button>
      <Button size="sm" variant={preview === 'phone' ? 'primary' : 'ghost'} onClick={() => setPreview((v) => (v === 'phone' ? '' : 'phone'))} title={t('cst.phone.h', 'What a phone gets: the canvas stacks')}><Smartphone size={14} /></Button>
      {preview && <span className="text-[11px] text-[var(--faint)] inline-flex items-center gap-1"><Monitor size={12} /> {t('cst.previewing', 'Preview — editing is paused')}</span>}
    </div>
  );
}

function Inspector({ t, sel, patch, canvas, emit, setSelId }) {
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
        <div className="ms-auto flex gap-1">
          <button title={t('cst.front', 'Bring to front')} className="p-1 rounded hover:bg-[var(--surface-2)]" onClick={() => emit(bringTo(canvas.blocks, sel.id, 'front'))}><ArrowUp size={14} /></button>
          <button title={t('cst.back', 'Send to back')} className="p-1 rounded hover:bg-[var(--surface-2)]" onClick={() => emit(bringTo(canvas.blocks, sel.id, 'back'))}><ArrowDown size={14} /></button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {numField('X', 'x')}{numField('Y', 'y')}{numField(t('cst.w', 'Width'), 'w')}{numField(t('cst.h', 'Height'), 'h')}
      </div>
      {sel.kind === 'text' && (
        <Field label={t('cst.md', 'Content (B.MD)')}>
          <Textarea rows={8} value={p.md || ''} onChange={(e) => setProp('md', e.target.value)} />
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
      <Field label={t('cst.bg', 'Background')}><Input value={p.bg || ''} onChange={(e) => setProp('bg', e.target.value)} placeholder="rgba(99,102,241,0.1)" /></Field>
      <Field label={t('cst.radius', 'Corner radius')}><Input type="number" value={p.radius ?? ''} onChange={(e) => setProp('radius', e.target.value === '' ? undefined : Number(e.target.value))} /></Field>
      <button className="text-[11px] text-[var(--faint)] hover:text-[var(--text)]" onClick={() => setSelId(null)}>{t('cst.deselect', 'Deselect')}</button>
    </div>
  );
}
