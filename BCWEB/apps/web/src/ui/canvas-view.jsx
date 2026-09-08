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
import { normalizeCanvas, layoutFor, phoneOrder, paintOrder, resolveBlock, keepsHeightStacked, DESIGN_WIDTH } from '../lib/canvas.js';
import { markdownConfig } from '@bettercommunity/bmd/config';

/** One block's own painting, shared by both modes so they cannot look different.
 *  Exported because the editor draws single blocks too, and a second implementation of
 *  "what a block looks like" is exactly how an editor starts lying about the page. */
/**
 * Is this URL one we are willing to put in an iframe on a public page?
 *
 * B.MD already answers this — `configureMarkdown({ allowIframes })`, YouTube and Spotify's
 * embed host by default — and this asks IT rather than keeping a second list. Two allowlists
 * for one question is two things to remember when a host is added, and the one nobody
 * remembers is the one that silently keeps allowing something.
 *
 * A block whose URL does not pass is drawn as a link, not as nothing: the author put it there
 * on purpose and needs to see that it was refused.
 */
export function embedAllowed(url) {
  const u = String(url || '').trim();
  if (!u) return false;
  const allow = markdownConfig().allowIframes;
  if (!allow) return false;
  return allow instanceof RegExp ? allow.test(u) : !!allow;
}

export function CanvasBlock({ b, stacked }) {
  const p = b.props || {};
  const style = {
    background: p.bg || undefined,
    border: p.border ? `1px solid ${p.border}` : undefined,
    borderRadius: p.radius != null ? `${p.radius}px` : undefined,
    padding: p.pad != null ? `${p.pad}px` : undefined,
    color: p.color || undefined,
  };
  // The size a media block takes in a column: its own, because none of these has an intrinsic
  // height and `100%` of an auto-height parent is zero — the way `box` used to vanish.
  const boxed = { ...style, width: '100%', height: stacked ? (b.phone?.h ?? b.h) : '100%', display: 'block' };

  if (b.kind === 'video') {
    return (
      <video
        src={p.src || ''} poster={p.poster || undefined}
        controls={p.controls !== false} muted={!!p.muted} loop={!!p.loop} playsInline
        // autoPlay only with muted: a page that makes noise by itself is a page people close,
        // and every browser blocks it anyway — so it would be a setting that does nothing.
        autoPlay={!!p.autoplay && !!p.muted}
        preload={p.autoplay ? 'auto' : 'metadata'}
        style={{ ...boxed, objectFit: p.fit || 'contain', background: p.bg || '#000' }}
      />
    );
  }

  if (b.kind === 'embed') {
    const url = String(p.url || '');
    if (!embedAllowed(url)) {
      // Refused, and said so where the author will see it. Rendering nothing would look like
      // a bug in the canvas rather than a decision about what may be framed.
      return (
        <div style={{ ...boxed, display: 'grid', placeItems: 'center', padding: 12, textAlign: 'center' }}
          className="text-[12px] text-[var(--muted)] border border-dashed border-[var(--line)] rounded-xl">
          {url ? <a href={url} target="_blank" rel="noreferrer noopener" className="underline break-all">{url}</a> : null}
        </div>
      );
    }
    return (
      <iframe
        src={url} title={p.title || 'embed'} loading="lazy"
        // No allow-same-origin: a framed page must not reach back into this one. The same
        // sandbox B.MD applies, for the same reason.
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-presentation"
        referrerPolicy="strict-origin-when-cross-origin"
        allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture; fullscreen"
        style={{ ...boxed, border: 0 }}
      />
    );
  }

  if (b.kind === 'replay') {
    // A .bmmreplay is played by the same component the docs and the blog use — it is a real
    // recording of the app, and a second player would drift from the format.
    return <div style={boxed} className="bcw-canvas-replay" data-replay={p.src || ''} />;
  }

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
  if (b.kind === 'box') return <div style={boxed} />;
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
export default function CanvasView({ canvas: raw, stackPreview = false, themePreview = null }) {
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

  // Which theme the reader is in, watched rather than read once: the site's theme toggle
  // rewrites <html data-theme> without remounting anything, so a canvas that read it at mount
  // would keep the other theme's layout until the next navigation.
  const [theme, setTheme] = useState(() => (typeof document !== 'undefined' ? document.documentElement.getAttribute('data-theme') || 'light' : 'light'));
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return undefined;
    const el = document.documentElement;
    const mo = new MutationObserver(() => setTheme(el.getAttribute('data-theme') || 'light'));
    mo.observe(el, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);
  // `themePreview` lets the editor show the other theme without changing the whole site's.
  const mode = themePreview || theme;

  const L = stackPreview ? { mode: 'stack' } : layoutFor(vw, canvas);

  // Stacked: the canvas is abandoned and the blocks become a column — in the order the author
  // set for phones where they set one, and in reading order everywhere else.
  // Sizes go with it: a width measured in design pixels means nothing in a column.
  if (L.mode === 'stack') {
    return (
      <div ref={hostRef} className="space-y-4" style={{ background: canvas.bg || undefined }}>
        {phoneOrder(canvas.blocks).map((raw2) => resolveBlock(raw2, mode)).filter((b) => !b.hidden).map((b) => (
          <div key={b.id} className="min-w-0" style={b.opacity < 1 ? { opacity: b.opacity } : undefined}>
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
          {paintOrder(canvas.blocks).map((raw2) => resolveBlock(raw2, mode)).filter((b) => !b.hidden).map((b) => (
            <div
              key={b.id}
              // CLIPPED, on purpose. A block has the size the author gave it, and content
              // that spills would land on top of whatever is placed below it — a canvas
              // where one paragraph silently pushes into its neighbour is not a layout.
              // The cost is that overrunning text disappears for the reader, so the EDITOR
              // flags a block whose content is taller than its box; this is the wrong place
              // to discover it.
              style={{ position: 'absolute', left: b.x, top: b.y, width: b.w, height: b.h, zIndex: b.z, overflow: 'hidden', opacity: b.opacity < 1 ? b.opacity : undefined }}
            >
              <CanvasBlock b={b} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
