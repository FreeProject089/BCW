// A studio page drawn small: the thumbnails of the preset gallery (PLAN-STUDIO-2026 2.6,
// phase 6), which replace the grey rectangles of `thumbnailSvg`.
//
// A REAL render, through the renderer's own pieces (normalizeDoc, frameBlocks, CanvasBlock,
// BlockShell, ScopedCss, CanvasBackground), so a thumbnail cannot drift from the page it
// stands for. What it deliberately does NOT do, because a gallery shows a dozen of these at once:
//   · no live 3D scene: the background is drawn `still` (the CSS drawing of the shape, phase 4),
//     so a thumbnail never creates a WebGL context nor fetches three.js;
//   · no video, no iframe, no recording player: those blocks are a labelled placeholder, so a
//     gallery never loads a third-party frame or starts a download;
//   · no action, no animation: the thumbnail is inert (`inert`, aria-hidden, no pointer), and a
//     block that animates in is drawn where it lands.
import { normalizeDoc, frameBlocks, DESIGN_WIDTH } from '../lib/canvas.js';
import { CanvasBlock, BlockShell, ScopedCss } from './canvas-view.jsx';
import CanvasBackground from './canvas-background.jsx';

/** Kinds that load something heavy or third-party: a placeholder in a thumbnail. */
const HEAVY = new Set(['video', 'embed', 'replay']);

/**
 * @param {object} props
 * @param {object} props.doc    a stored or normalised studio document
 * @param {number} [props.width]  the thumbnail's width in px (the page is scaled to it)
 * @param {number} [props.maxHeight]  the page is cut at this height (in page px) so a very long
 *        page reads as its top, not as a thin strip
 */
export default function CanvasThumb({ doc, width = 180, maxHeight = 900, theme = 'light', className = '' }) {
  const canvas = normalizeDoc(doc);
  const s = width / DESIGN_WIDTH;
  const h = Math.max(120, Math.min(canvas.frames.desktop.h, maxHeight));
  const blocks = frameBlocks(canvas, 'scale', theme).filter((b) => !b.hidden && b.y < h);
  return (
    <div className={`cst-thumb ${className}`} data-cv-thumb={canvas.id} aria-hidden inert=""
      style={{ position: 'relative', width, height: Math.round(h * s), overflow: 'hidden', pointerEvents: 'none', isolation: 'isolate' }}>
      <div data-cv={canvas.id} style={{ position: 'absolute', inset: 0, contain: 'layout paint', transform: 'translateZ(0)' }}>
        <ScopedCss canvas={canvas} />
        <CanvasBackground bg={canvas.background} still style={{ inset: 'auto', left: 0, top: 0, width, height: Math.round(h * s) }} />
        <div style={{ position: 'absolute', left: 0, top: 0, width: DESIGN_WIDTH, height: h, transform: `scale(${s})`, transformOrigin: 'top left' }}>
          {blocks.map((b) => (
            <div key={b.id} data-thumb-block={b.kind}
              style={{ position: 'absolute', left: b.x, top: b.y, width: b.w, height: b.h, zIndex: b.z, opacity: b.opacity < 1 ? b.opacity : undefined, overflow: 'hidden' }}>
              {HEAVY.has(b.kind)
                ? <div style={{ width: '100%', height: '100%', background: 'var(--surface-3)', borderRadius: 8 }} data-thumb-placeholder={b.kind} />
                : <BlockShell b={b}><CanvasBlock b={b} /></BlockShell>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
