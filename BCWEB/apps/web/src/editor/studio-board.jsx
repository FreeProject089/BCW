// One block on the studio's board, and what is drawn around it (handles, badges, overrun).
// Moved out of editor/canvas-studio.jsx (studio phase 8).
import { memo, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Lock, EyeOff, Puzzle } from 'lucide-react';
import { CanvasBlock } from '../ui/canvas-view.jsx';
import { HANDLES, isContainer, tabLabels, TAB_STRIP_H } from '../lib/canvas.js';

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
function BlockBody({ b, slot = 0 }) {
  const ref = useRef(null);
  const over = useOverflow(ref, [b.w, b.h, b.kind, JSON.stringify(b.props)]);
  return (
    <>
      <div ref={ref} style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        <CanvasBlock b={b} slot={slot} />
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

/** One block on the board. Memoised: only the block whose props changed re-renders.
 *  Phase 7a: `z` is its place in the board's tree order (a container's blocks over it), `dbl`
 *  goes into a container, `onSlot` picks the tab a tab card shows, `scopeOn` marks the
 *  container being edited, `tag` names a dialog, `brokenLabel` a block whose container link is
 *  broken. */
export const BoardBlock = memo(function BoardBlock({ b, on, only, down, off = false, offLabel = '', z = null, dbl = null, slot = 0, onSlot = null,
  scopeOn = false, tag = '', brokenLabel = '' }) {
  const box = isContainer(b.kind);
  // A selected block is lifted over its neighbours, except a container: lifted, it would cover
  // the very blocks it holds.
  const zIndex = z != null ? z + (on && !box ? 100000 : 0) : (b.z || 0) + (on ? 1000 : 0);
  return (
    <div
      data-cst-block={b.id}
      data-off-frame={off ? '1' : undefined}
      data-cst-container={box ? b.kind : undefined}
      data-cst-depth={b.depth || undefined}
      data-cst-scope={scopeOn ? '1' : undefined}
      onPointerDown={(e) => down(e, b, null)}
      onDoubleClick={dbl ? (e) => dbl(e, b) : undefined}
      // Off the frame: drawn and grabbable like any block (it is on the board), dimmed, because
      // a reader will never see it.
      style={{ position: 'absolute', left: b.x, top: b.y, width: b.w, height: b.h, zIndex, cursor: b.locked ? 'default' : 'move', touchAction: 'none', opacity: b.hidden ? 0.3 : off ? 0.55 : undefined, transform: b.rotate ? `rotate(${b.rotate}deg)` : undefined }}>
      <BlockBody b={b} slot={slot} />
      <div className="cst-sel-outline" style={{ position: 'absolute', inset: 0, outline: on ? '2px solid var(--primary)' : scopeOn ? '2px dashed var(--primary)' : off || brokenLabel ? '1px dashed var(--warning)' : '1px dashed var(--line-strong)', outlineOffset: 0, pointerEvents: 'none' }} />
      {off && <span aria-hidden className="cst-offframe cst-offframe-board">{offLabel}</span>}
      {(tag || brokenLabel) && <span aria-hidden className="cst-offframe cst-offframe-board" data-cst-tag>{brokenLabel || tag}</span>}
      {(b.locked || b.hidden || b.component) && (
        <span aria-hidden data-component={b.component ? b.component.id : undefined} style={{ position: 'absolute', left: 2, top: 2, display: 'inline-flex', gap: 2, background: 'var(--bg-solid)', borderRadius: 6, padding: '1px 4px', pointerEvents: 'none' }}>
          {b.locked && <Lock size={10} />}{b.hidden && <EyeOff size={10} />}{b.component && <Puzzle size={10} />}
        </span>
      )}
      {/* The tab card's tabs, pressable on the board once it is selected or being edited: which
          one the board shows, and so where added or dropped blocks go. */}
      {onSlot && (on || scopeOn) && (
        <div className="cv-tabs" data-cst-tabpick style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: TAB_STRIP_H }}
          onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          {tabLabels(b.props).map((label, i) => (
            <button key={i} type="button" className="cv-tab" data-on={i === slot ? '1' : undefined} aria-pressed={i === slot}
              onClick={() => onSlot(b.id, i)}>{label || `${i + 1}`}</button>
          ))}
        </div>
      )}
      {/* An instance's size is its component's (phase 7b): no resize handle. */}
      {only && !b.locked && b.kind !== 'instance' && Object.keys(HANDLES).map((hk) => (
        <span key={hk} onPointerDown={(e) => down(e, b, hk)}
          className="cst-handle"
          style={{ position: 'absolute', width: 12, height: 12, background: 'var(--primary)', borderRadius: 3, ...handlePos(hk), cursor: `${hk}-resize`, touchAction: 'none' }} />
      ))}
    </div>
  );
});
