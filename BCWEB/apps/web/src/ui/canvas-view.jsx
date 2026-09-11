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
import { normalizeCanvas, layoutFor, phoneOrder, paintOrder, resolveBlock, keepsHeightStacked, phoneBoardBlocks, DESIGN_WIDTH, PHONE_WIDTH } from '../lib/canvas.js';
import { api } from '../lib/api.js';
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

/** A keyframe body, reduced to what a keyframe body is made of. Admin-authored, but a `</style>`
 *  or a `url(` in the wrong place is still not something a page should carry. */
function keyframeBody(src) {
  return String(src || '').replace(/[^\w\s%.,:;()#\-]/g, '').slice(0, 4000);
}

/**
 * The animation wrapper. `anim` is the block's normalised animation (lib/canvas.js) or null.
 *
 * "in" is what starts it: on load, immediately; after a delay, then; on scroll, when at least a
 * fifth of the block is on screen; on hover, never — the CSS `:hover` rule carries that one.
 * Reduced motion is honoured in the stylesheet, so a reader who asked for stillness gets the
 * block, already in place, with nothing moving.
 */
function Animated({ anim, id, style, className, children }) {
  const ref = useRef(null);
  const trigger = anim?.trigger || 'show';
  const [on, setOn] = useState(!anim || trigger === 'hover' || trigger === 'load');
  useEffect(() => {
    if (!anim || trigger === 'hover' || trigger === 'load') return undefined;
    if (trigger === 'delay') { const t = setTimeout(() => setOn(true), anim.delay || 0); return () => clearTimeout(t); }
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setOn(true); return undefined; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setOn(true); io.disconnect(); } }, { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, [anim, trigger]);
  if (!anim) return <div style={style} className={className}>{children}</div>;
  const vars = { '--cv-dur': `${anim.duration || 700}ms`, '--cv-delay': trigger === 'show' || trigger === 'load' ? `${anim.delay || 0}ms` : '0ms' };
  const cls = `${className || ''} cv-anim cv-anim-${anim.kind}${on ? ' in' : ''}${anim.loop ? ' cv-loop' : ''}${trigger === 'hover' ? ' cv-hover' : ''}`;
  const custom = anim.kind === 'custom' && anim.custom
    ? `@keyframes cv-${id}{${keyframeBody(anim.custom)}}[data-anim="${id}"].in,[data-anim="${id}"].cv-hover:hover{animation-name:cv-${id}}`
    : null;
  return (
    <div ref={ref} style={{ ...style, ...vars }} className={cls} data-anim={id}>
      {custom ? <style>{custom}</style> : null}
      {children}
    </div>
  );
}

/** What a button does when pressed. */
function useButtonAction(p) {
  const [state, setState] = useState('');
  const act = p.action || {};
  const type = act.type || 'link';
  const href = String(act.href || '').trim();
  const external = /^https?:\/\//i.test(href);
  const run = async (e) => {
    if (type === 'link' || type === 'download') return;   // the anchor does it
    e.preventDefault();
    try {
      if (type === 'copy') { await navigator.clipboard.writeText(String(act.text || '')); setState('done'); }
      else if (type === 'scroll') { const target = document.querySelector(String(act.target || '').trim() || '#top'); target?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      else if (type === 'api') {
        setState('busy');
        const path = String(act.path || '').trim();
        if (!path.startsWith('/')) throw new Error('path');
        const method = String(act.method || 'GET').toUpperCase() === 'POST' ? 'post' : 'get';
        const res = await api[method](path, method === 'post' ? {} : undefined);
        const open = String(act.open || '').trim();
        const url = open && res && typeof res === 'object' ? open.split('.').reduce((o, k) => (o == null ? o : o[k]), res) : null;
        if (url && typeof url === 'string') window.open(url, '_blank', 'noopener');
        setState('done');
      }
    } catch { setState('err'); }
    setTimeout(() => setState(''), 1800);
  };
  const anchorProps = type === 'link' && href ? { href, ...(external ? { target: '_blank', rel: 'noreferrer' } : {}) }
    : type === 'download' && href ? { href, download: true }
    : { href: '#', role: 'button' };
  return { run, state, anchorProps };
}

function CanvasButton({ p }) {
  const variant = p.variant || 'button';
  const size = ['sm', 'md', 'lg'].includes(p.size) ? p.size : 'md';
  const style = p.color ? { '--btn': p.color } : undefined;
  const { run, state, anchorProps } = useButtonAction(p);
  const [open, setOpen] = useState(false);
  const face = state === 'done' ? (p.doneLabel || '✓') : state === 'err' ? '✕' : (p.label || 'Button');
  if (variant === 'card') {
    return (
      <a {...anchorProps} onClick={run} className="cv-btn-card" style={style}>
        <span className="cv-btn-card-t">{face}</span>
        {p.desc ? <span className="cv-btn-card-d">{p.desc}</span> : null}
        <span className="cv-btn-card-arrow" aria-hidden>→</span>
      </a>
    );
  }
  if (variant === 'dropdown-down' || variant === 'dropdown-up') {
    const items = Array.isArray(p.items) ? p.items.filter((it) => it && it.label) : [];
    return (
      <div className={`cv-dd ${variant === 'dropdown-up' ? 'cv-dd-up' : ''}`} onMouseLeave={() => setOpen(false)}>
        <button type="button" className={`doc-btn doc-btn-${size}${p.outline ? ' doc-btn-outline' : ''}`} style={style} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {face} <span aria-hidden>{variant === 'dropdown-up' ? '▴' : '▾'}</span>
        </button>
        {open && (
          <div className="cv-dd-menu" role="menu">
            {items.length ? items.map((it, i) => {
              const h = String(it.href || '').trim();
              const ext = /^https?:\/\//i.test(h);
              return <a key={i} role="menuitem" className="cv-dd-item" href={h || '#'} {...(ext ? { target: '_blank', rel: 'noreferrer' } : {})} onClick={() => setOpen(false)}>{it.label}</a>;
            }) : <span className="cv-dd-item cv-dd-empty">—</span>}
          </div>
        )}
      </div>
    );
  }
  return (
    <a {...anchorProps} onClick={run} className={`doc-btn doc-btn-${size}${p.outline ? ' doc-btn-outline' : ''}`} style={style}>{face}</a>
  );
}

export function CanvasBlock({ b, stacked }) {
  const p = b.props || {};
  if (b.kind === 'button') {
    // Centred in its box on the board; a natural inline element in a stack.
    return <div className="cv-btn-wrap" style={stacked ? undefined : { display: 'flex', alignItems: 'center', justifyContent: p.align === 'left' ? 'flex-start' : p.align === 'right' ? 'flex-end' : 'center', height: '100%' }}><CanvasButton p={p} /></div>;
  }
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
          <Animated key={b.id} id={b.id} anim={b.anim} className="min-w-0" style={b.opacity < 1 ? { opacity: b.opacity } : undefined}>
            <CanvasBlock b={b} stacked />
          </Animated>
        ))}
      </div>
    );
  }

  // Scaled: one transform on the whole plane, so every coordinate inside stays exactly as the
  // author placed it. transform-origin at the top-left keeps the design's left edge on the
  // container's left edge; the wrapper's height is the SCALED height, because a transform
  // does not affect layout and the page below would otherwise overlap the canvas.
  //
  // The PHONE BOARD is this same painting on a 390px plane with the phone coordinates —
  // hand-placed blocks where the author put them, the rest laid underneath in reading order.
  const phone = L.mode === 'phone';
  const planeW = phone ? PHONE_WIDTH : DESIGN_WIDTH;
  const planeH = phone ? canvas.phoneHeight : canvas.height;
  const blocks = phone
    ? phoneBoardBlocks(canvas.blocks.map((raw2) => resolveBlock(raw2, mode)).filter((b) => !b.hidden))
    : paintOrder(canvas.blocks).map((raw2) => resolveBlock(raw2, mode)).filter((b) => !b.hidden);
  return (
    <div ref={hostRef} className="w-full overflow-hidden" style={{ background: canvas.bg || undefined }}>
      <div style={{ height: planeH * L.scale, position: 'relative', ...(phone ? { width: planeW * L.scale, margin: '0 auto' } : {}) }}>
        <div
          style={{
            width: planeW,
            height: planeH,
            transform: `scale(${L.scale})`,
            transformOrigin: 'top left',
            position: 'absolute',
            top: 0,
            left: 0,
          }}
        >
          {blocks.map((b) => (
            <Animated
              key={b.id} id={b.id} anim={b.anim}
              // CLIPPED, on purpose. A block has the size the author gave it, and content
              // that spills would land on top of whatever is placed below it — a canvas
              // where one paragraph silently pushes into its neighbour is not a layout.
              // The cost is that overrunning text disappears for the reader, so the EDITOR
              // flags a block whose content is taller than its box; this is the wrong place
              // to discover it. A dropdown's menu is the one thing allowed out of the box.
              style={{ position: 'absolute', left: b.x, top: b.y, width: b.w, height: b.h, zIndex: b.z, overflow: b.kind === 'button' ? 'visible' : 'hidden', opacity: b.opacity < 1 ? b.opacity : undefined }}
            >
              <CanvasBlock b={b} />
            </Animated>
          ))}
        </div>
      </div>
    </div>
  );
}
