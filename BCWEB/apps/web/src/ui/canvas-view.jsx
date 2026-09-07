// Drawing a hand-placed canvas on a public page.
//
// The rules it obeys all live in lib/canvas.js — this only paints. That split is deliberate:
// the editor renders the very same component for its preview, so "what the author sees" and
// "what a reader gets" cannot drift into two answers.
//
// Content is B.MD, not a private format. A text block is a document, so it already has
// callouts, cards, tabs, buttons, the icon set and the spacing scale, and anything added to
// B.MD later shows up here without this file changing.
import { useEffect, useRef, useState } from 'react';
import Markdown from './md.jsx';
import { normalizeCanvas, layoutFor, readingOrder, paintOrder, DESIGN_WIDTH } from '../lib/canvas.js';

/** One block's own painting, shared by both modes so they cannot look different.
 *  Exported because the editor draws single blocks too, and a second implementation of
 *  "what a block looks like" is exactly how an editor starts lying about the page. */
export function CanvasBlock({ b, stacked }) {
  const p = b.props || {};
  const style = {
    background: p.bg || undefined,
    border: p.border ? `1px solid ${p.border}` : undefined,
    borderRadius: p.radius != null ? `${p.radius}px` : undefined,
    padding: p.pad != null ? `${p.pad}px` : undefined,
    color: p.color || undefined,
  };
  if (b.kind === 'image') {
    return (
      <img
        src={p.src || ''}
        alt={p.alt || ''}
        loading="lazy"
        style={{ ...style, width: '100%', height: stacked ? 'auto' : '100%', objectFit: p.fit || 'cover', display: 'block' }}
      />
    );
  }
  // A box has no content of its own, so `height: 100%` inside a stacked column — whose parent
  // is auto-height — resolves to zero and the block silently disappears on phones. Stacked, it
  // keeps the height it was drawn at, so a band stays a band.
  if (b.kind === 'box') return <div style={{ ...style, width: '100%', height: stacked ? b.h : '100%' }} />;
  return (
    <div style={style} className="bcw-canvas-text">
      <Markdown>{String(p.md || '')}</Markdown>
    </div>
  );
}

/**
 * @param {object} props
 * @param {object} props.canvas  the stored canvas (raw; normalised here)
 * @param {boolean} [props.stackPreview]  force the stacked rendering, for the editor's
 *        "what does this look like on a phone" toggle — the reason it is a prop and not
 *        purely a measurement is that an author on a desktop cannot otherwise ever see it.
 */
export default function CanvasView({ canvas: raw, stackPreview = false }) {
  const canvas = normalizeCanvas(raw);
  const hostRef = useRef(null);
  const [vw, setVw] = useState(DESIGN_WIDTH);

  // Measure the CONTAINER, not the window. The canvas sits inside a tab inside a page with
  // its own padding and max-width, so the window's width is not the width it gets — and a
  // sidebar opening would never be noticed.
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return undefined;
    const read = () => setVw(el.clientWidth || DESIGN_WIDTH);
    read();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', read);
      return () => window.removeEventListener('resize', read);
    }
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const L = stackPreview ? { mode: 'stack' } : layoutFor(vw, canvas);

  // Stacked: the canvas is abandoned and the blocks become a column, in reading order.
  // Sizes go with it — a width measured in design pixels means nothing in a column.
  if (L.mode === 'stack') {
    return (
      <div ref={hostRef} className="space-y-4" style={{ background: canvas.bg || undefined }}>
        {readingOrder(canvas.blocks).map((b) => (
          <div key={b.id} className="min-w-0">
            <CanvasBlock b={b} stacked />
          </div>
        ))}
      </div>
    );
  }

  // Scaled: one transform on the whole plane, so every coordinate inside stays exactly as the
  // author placed it. transform-origin at the top-left keeps the design's left edge on the
  // container's left edge; the wrapper's height is the SCALED height, because a transform
  // does not affect layout and the page below would otherwise overlap the canvas.
  return (
    <div ref={hostRef} className="w-full overflow-hidden" style={{ background: canvas.bg || undefined }}>
      <div style={{ height: canvas.height * L.scale, position: 'relative' }}>
        <div
          style={{
            width: DESIGN_WIDTH,
            height: canvas.height,
            transform: `scale(${L.scale})`,
            transformOrigin: 'top left',
            position: 'absolute',
            top: 0,
            left: 0,
          }}
        >
          {paintOrder(canvas.blocks).map((b) => (
            <div
              key={b.id}
              // CLIPPED, on purpose. A block has the size the author gave it, and content
              // that spills would land on top of whatever is placed below it — a canvas
              // where one paragraph silently pushes into its neighbour is not a layout.
              // The cost is that overrunning text disappears for the reader, so the EDITOR
              // flags a block whose content is taller than its box; this is the wrong place
              // to discover it.
              style={{ position: 'absolute', left: b.x, top: b.y, width: b.w, height: b.h, zIndex: b.z, overflow: 'hidden' }}
            >
              <CanvasBlock b={b} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
