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
} from 'lucide-react';
import { Button, Field, Input, Textarea, useToast } from '../ui/ui.jsx';
import { useI18n } from '../i18n.jsx';
import { uploadMedia } from '../lib/api.js';
import CanvasView, { CanvasBlock } from '../ui/canvas-view.jsx';
import {
  normalizeCanvas, paintOrder, dragTo, resizeTo, alignmentGuides, bringTo,
  emptyHistory, pushHistory, undo as undoHist, redo as redoHist,
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
  const [selId, setSelId] = useState(null);
  const [snapOn, setSnapOn] = useState(true);
  const [preview, setPreview] = useState('');         // '' | 'desktop' | 'phone'
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

  const duplicate = () => {
    if (!sel) return;
    const b = { ...sel, id: uid(), x: Math.min(sel.x + GRID * 3, DESIGN_WIDTH - sel.w), y: sel.y + GRID * 3 };
    emit([...canvas.blocks, b]);
    setSelId(b.id);
  };
  const remove = () => { if (!sel) return; emit(canvas.blocks.filter((b) => b.id !== sel.id)); setSelId(null); };

  // ── Pointer ────────────────────────────────────────────────────────────────
  // Pointer events, not mouse: one code path covers a trackpad, a mouse and a stylus, and
  // setPointerCapture means a fast drag that leaves the block (or the window) still tracks
  // instead of dropping it wherever the pointer left.
  const onDown = (e, b, handle) => {
    e.preventDefault(); e.stopPropagation();
    setSelId(b.id);
    drag.current = { id: b.id, handle, sx: e.clientX, sy: e.clientY, start: { ...b } };
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
      if (!sel) return;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;   // typing, not nudging
      const step = e.shiftKey ? GRID * 4 : GRID;
      const map = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (map[e.key]) {
        e.preventDefault();
        patch(sel.id, dragTo(sel, map[e.key][0], map[e.key][1], 1, { snap: false }), `nudge:${sel.id}`);
      } else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(); }
      else if (e.key === 'Escape') setSelId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, patch, doUndo, doRedo]);

  if (preview) {
    return (
      <div>
        <Toolbar {...{ t, preview, setPreview, snapOn, setSnapOn, add, sel, duplicate, remove, doUndo, doRedo, hist }} />
        <div className={preview === 'phone' ? 'mx-auto border border-[var(--line)] rounded-2xl p-3' : ''} style={preview === 'phone' ? { width: 390 } : undefined}>
          <CanvasView canvas={canvas} stackPreview={preview === 'phone'} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <Toolbar {...{ t, preview, setPreview, snapOn, setSnapOn, add, sel, duplicate, remove, doUndo, doRedo, hist }} />
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-4 lg:items-start">
        <div ref={hostRef} className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface-2)]"
          onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
          onPointerDown={() => setSelId(null)}>
          <div style={{ height: canvas.height * scale, position: 'relative' }}>
            <div style={{ width: DESIGN_WIDTH, height: canvas.height, transform: `scale(${scale})`, transformOrigin: 'top left', position: 'absolute', top: 0, left: 0 }}>
              {/* The grid, drawn so placement is legible rather than guessed at. */}
              <div aria-hidden style={{
                position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.5,
                backgroundImage: 'linear-gradient(to right, var(--line) 1px, transparent 1px), linear-gradient(to bottom, var(--line) 1px, transparent 1px)',
                backgroundSize: `${GRID * 8}px ${GRID * 8}px`,
              }} />
              {paintOrder(canvas.blocks).map((b) => {
                const on = b.id === selId;
                return (
                  <div key={b.id}
                    onPointerDown={(e) => onDown(e, b, null)}
                    style={{ position: 'absolute', left: b.x, top: b.y, width: b.w, height: b.h, zIndex: (b.z || 0) + (on ? 1000 : 0), cursor: 'move' }}>
                    <BlockBody b={b} />
                    <div style={{ position: 'absolute', inset: 0, outline: on ? '2px solid var(--primary)' : '1px dashed var(--line-strong)', outlineOffset: 0, pointerEvents: 'none' }} />
                    {on && Object.keys(HANDLES).map((hk) => (
                      <span key={hk} onPointerDown={(e) => onDown(e, b, hk)}
                        style={{ position: 'absolute', width: 12, height: 12, background: 'var(--primary)', borderRadius: 3, ...handlePos(hk), cursor: `${hk}-resize`, touchAction: 'none' }} />
                    ))}
                  </div>
                );
              })}
              {/* Guides, drawn only while a drag is snapping to something. */}
              {guides.v && <div aria-hidden style={{ position: 'absolute', left: guides.v.at, top: 0, bottom: 0, width: 1, background: 'var(--primary)', pointerEvents: 'none' }} />}
              {guides.h && <div aria-hidden style={{ position: 'absolute', top: guides.h.at, left: 0, right: 0, height: 1, background: 'var(--primary)', pointerEvents: 'none' }} />}
            </div>
          </div>
        </div>
        <Inspector {...{ t, sel, patch, canvas, emit, setSelId }} />
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

function Toolbar({ t, preview, setPreview, snapOn, setSnapOn, add, sel, duplicate, remove, doUndo, doRedo, hist }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 mb-3">
      <Button size="sm" variant="ghost" onClick={() => add('text')}><Type size={14} /> {t('cst.text', 'Text')}</Button>
      <Button size="sm" variant="ghost" onClick={() => add('image')}><ImageIcon size={14} /> {t('cst.image', 'Image')}</Button>
      <Button size="sm" variant="ghost" onClick={() => add('box')}><Square size={14} /> {t('cst.box', 'Box')}</Button>
      <span className="w-px h-5 bg-[var(--line)] mx-1" />
      <Button size="sm" variant="ghost" disabled={!hist.past.length} onClick={doUndo} data-undo-steps={hist.past.length} data-undo-key={String(hist.key)} title={`Ctrl+Z · ${hist.past.length}`}><Undo2 size={14} /></Button>
      <Button size="sm" variant="ghost" disabled={!hist.future.length} onClick={doRedo} title="Ctrl+Shift+Z"><Redo2 size={14} /></Button>
      <span className="w-px h-5 bg-[var(--line)] mx-1" />
      <Button size="sm" variant="ghost" disabled={!sel} onClick={duplicate}><Copy size={14} /> {t('cst.dup', 'Duplicate')}</Button>
      <Button size="sm" variant="ghost" disabled={!sel} className="!text-error" onClick={remove}><Trash2 size={14} /></Button>
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
