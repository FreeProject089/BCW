// The studio's first-run tour: six steps, once, skippable.
//
// WHY it exists. The studio is a three-pane editor behind the admin, behind 2FA, behind a
// per-page switch — so the first person to open it is somebody who has never seen it and has
// nobody to ask. The empty board already explains the three panes (EmptyBoard in
// canvas-studio.jsx), but only while the page is empty: open a page that already has blocks
// on it and every one of those sentences is gone.
//
// WHY it is built here rather than reused. There is no tour or spotlight mechanism anywhere
// in this app — `grep -rn "spotlight\|guidedTour"` over src/ matches one i18n string and
// nothing else. So this is deliberately the small version: no overlay that swallows the
// pointer, no scroll locking, no step graph. A card, a ring around the thing being named,
// and a way out on every step.
//
// WHAT IT MUST NOT DO. It must not be in the way. The page underneath stays live — the card
// is `pointer-events` only on itself and the ring is `pointer-events: none` — so an author
// who ignores it can work straight through it, and Escape or Skip ends it for good.
//
// Remembered per VIEWER, in localStorage, inside try/catch: a private window, blocked site
// data or a full quota throws on read AND on write, and a tour that crashes the editor it is
// introducing would be worse than no tour at all. When the store is unreadable the tour
// simply does not auto-start; it stays available from the button.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { GraduationCap, X, ArrowRight, ArrowLeft } from 'lucide-react';
import { Button } from '../ui/ui.jsx';

const KEY = 'bcw.studio.tour.v1';

const readSeen = () => {
  try { return localStorage.getItem(KEY) === '1'; }
  catch { return true; }   // unreadable store: never auto-start, never throw
};
const writeSeen = () => {
  try { localStorage.setItem(KEY, '1'); }
  catch { /* private window, quota: the tour just offers itself again next time */ }
};

/**
 * The steps. `anchor` is a `[data-tour="…"]` value somewhere in the studio; a step whose
 * anchor is not on screen (its panel is closed, or the board is in list mode) still shows —
 * centred, with no ring — rather than being skipped, because a panel you cannot see is
 * exactly the one worth being told about.
 */
export function tourSteps(t) {
  return [
    { id: 'welcome', anchor: null,
      title: t('cst.tour.1.t', 'This is the studio'),
      body: t('cst.tour.1.b', 'A page is built by placing blocks on a 1200px board. Six short steps, and you can leave at any point.') },
    { id: 'blocks', anchor: 'blocks',
      title: t('cst.tour.2.t', 'Add something'),
      body: t('cst.tour.2.b', 'Text, images, video, buttons, shapes and SVG. Pick one and it lands on the board, where you drag it and pull its handles.') },
    { id: 'board', anchor: 'board',
      title: t('cst.tour.3.t', 'The board'),
      body: t('cst.tour.3.b', 'Drag to move, pull a handle to resize, drag on empty space to pick several at once. Blocks snap to the grid and to each other.') },
    { id: 'props', anchor: 'props',
      title: t('cst.tour.4.t', 'Everything about one block'),
      body: t('cst.tour.4.b', 'Content, size, link, shadow, hover and the animation: its kind, when it starts, how long it takes and its curve.') },
    { id: 'components', anchor: 'components',
      title: t('cst.tour.5.t', 'Keep a group and use it again'),
      body: t('cst.tour.5.b', 'Pick several blocks, save them as a component, and insert copies on any page you edit. Copies stay linked until you detach them.') },
    { id: 'preview', anchor: 'preview',
      title: t('cst.tour.6.t', 'See what a reader gets'),
      body: t('cst.tour.6.b', 'Desktop, tablet and phone, and the whole page with this one in place. Then save: nothing is published until you do.') },
  ];
}

/**
 * Whether the tour should be up, and how to start it again.
 *
 * `enabled` is false in the modal form: the tour names three panes and a top bar that only
 * the full-page studio has, so running it inside somebody's settings column would describe a
 * screen that is not there.
 */
export function useStudioTour(enabled) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    if (!readSeen()) setOpen(true);
  }, [enabled]);
  const close = useCallback(() => { setOpen(false); writeSeen(); }, []);
  const start = useCallback(() => setOpen(true), []);
  return { open: open && enabled, start, close };
}

/** The button that brings it back, for the author who skipped it and then wanted it. */
export function TourButton({ t, onClick }) {
  return (
    <Button size="sm" variant="ghost" className="!px-2" onClick={onClick}
      title={t('cst.tour.again', 'Take the tour of the studio')} aria-label={t('cst.tour.again', 'Take the tour of the studio')}>
      <GraduationCap size={14} />
    </Button>
  );
}

/** Where the card goes: beside its anchor if there is room under it, above it otherwise, and
 *  in the middle of the screen when there is no anchor to sit beside. */
function place(rect, vw, vh) {
  const W = 320;
  if (!rect) return { left: Math.max(8, vw / 2 - W / 2), top: Math.max(8, vh / 2 - 110), width: W };
  const below = rect.bottom + 12;
  const fitsBelow = below + 190 < vh;
  const top = fitsBelow ? below : Math.max(8, rect.top - 202);
  const left = Math.min(Math.max(8, rect.left), Math.max(8, vw - W - 8));
  return { left, top, width: W };
}

export default function StudioTour({ t, onClose }) {
  const steps = useMemo(() => tourSteps(t), [t]);
  const [i, setI] = useState(0);
  const step = steps[i];
  const [rect, setRect] = useState(null);

  // Measured on every step, and again on resize/scroll: a ring drawn at a stale rect points
  // at nothing, which is worse than pointing at nothing on purpose.
  useEffect(() => {
    const read = () => {
      if (!step?.anchor || typeof document === 'undefined') { setRect(null); return; }
      const el = document.querySelector(`[data-tour="${step.anchor}"]`);
      if (!el) { setRect(null); return; }
      const r = el.getBoundingClientRect();
      setRect(r.width && r.height ? { top: r.top, left: r.left, width: r.width, height: r.height, bottom: r.bottom } : null);
    };
    read();
    if (typeof window === 'undefined') return undefined;
    window.addEventListener('resize', read);
    window.addEventListener('scroll', read, true);
    return () => { window.removeEventListener('resize', read); window.removeEventListener('scroll', read, true); };
  }, [step]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const key = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      else if (e.key === 'ArrowRight') setI((n) => Math.min(steps.length - 1, n + 1));
      else if (e.key === 'ArrowLeft') setI((n) => Math.max(0, n - 1));
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onClose, steps.length]);

  if (typeof document === 'undefined' || !step) return null;
  const vw = window.innerWidth || 1280;
  const vh = window.innerHeight || 800;
  const pos = place(rect, vw, vh);
  const last = i === steps.length - 1;
  return createPortal(
    <>
      {rect && (
        <div className="cst-tour-ring" aria-hidden
          style={{ top: rect.top - 4, left: rect.left - 4, width: rect.width + 8, height: rect.height + 8 }} />
      )}
      <div className="cst-tour-card" role="dialog" aria-modal="false" aria-label={step.title} style={pos}>
        <div className="flex items-center gap-2">
          <GraduationCap size={14} className="text-[var(--accent-ink)]" aria-hidden />
          <span className="text-[13px] font-semibold flex-1 min-w-0">{step.title}</span>
          <span className="text-[10px] text-[var(--faint)] tabular-nums">{`${i + 1}/${steps.length}`}</span>
          <button type="button" className="p-1 rounded hover:bg-[var(--surface-2)] text-[var(--muted)]"
            onClick={onClose} title={t('cst.tour.skip', 'Skip the tour')} aria-label={t('cst.tour.skip', 'Skip the tour')}><X size={14} /></button>
        </div>
        <p className="text-xs text-[var(--muted)] mt-1.5 leading-relaxed">{step.body}</p>
        <div className="flex items-center gap-1.5 mt-3">
          <button type="button" className="text-[11px] text-[var(--muted)] hover:underline" onClick={onClose}>{t('cst.tour.skip', 'Skip the tour')}</button>
          <span className="flex-1" />
          {i > 0 && (
            <Button size="sm" variant="ghost" className="!px-2" onClick={() => setI(i - 1)}
              title={t('common.back', 'Back')} aria-label={t('common.back', 'Back')}><ArrowLeft size={13} /></Button>
          )}
          <Button size="sm" variant="primary" onClick={() => (last ? onClose() : setI(i + 1))}>
            {last ? t('cst.tour.done', 'Start building') : <>{t('cst.tour.next', 'Next')} <ArrowRight size={13} /></>}
          </Button>
        </div>
      </div>
    </>,
    document.body,
  );
}
