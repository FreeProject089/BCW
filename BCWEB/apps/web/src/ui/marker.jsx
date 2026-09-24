// Hand-drawn marks for the landing pages: a highlighter stroke under a word, a hand-drawn
// underline, a word circled by hand, and a handwritten note with an arrow.
//
// Why these exist: the owner asked for the landing to feel like odoo.com, whose signature is
// exactly this, a marker stroke under the big word and small handwritten asides pointing at
// the thing to click. They are decoration in the strict sense: `aria-hidden` SVG, no text of
// their own, and the words they sit on are ordinary text a screen reader reads as before.
//
// Sizing is all in `em`, so the stroke scales with whatever the title is (the home hero is
// clamp()ed from 36px to 112px) and follows it across every language: it is as wide as the
// word, whatever the word is. It draws in once, on mount; a re-render (a language switch)
// does not replay it, and prefers-reduced-motion shows it already drawn. See marker.css.
import './marker.css';

// The handwriting face (Caveat, SIL OFL 1.1, self-hosted in public/fonts with its OFL.txt; see
// marker.css for the @font-face). Preloaded from HERE, the first time a HandNote renders, so
// only the pages that draw a note ask for it (a page with only a highlighter stroke does not,
// which would be a "preloaded but not used" warning); index.html preloads nothing. The latin
// file only: the other subsets are fetched by unicode-range when a language needs them.
function preloadHand() {
  if (typeof document === 'undefined' || document.querySelector('link[data-hand-font]')) return;
  try {
    const l = document.createElement('link');
    l.rel = 'preload'; l.as = 'font'; l.type = 'font/woff2'; l.crossOrigin = 'anonymous';
    l.href = '/fonts/caveat-latin.woff2';
    l.setAttribute('data-hand-font', '');
    document.head.appendChild(l);
  } catch { /* a preload is a hint; without it the font still loads on first use */ }
}

// A brush stroke, drawn as a filled shape in a 200 x 24 box and stretched to the word
// (`preserveAspectRatio="none"`). Filled rather than stroked because a stroke width would be
// stretched unevenly by that same scaling. The ragged ends and the uneven top edge are what
// make it read as a marker rather than as a pill.
const SWASH = 'M4.6 11.2C24 7.4 61 5.3 104 4.6c34-.5 64 .4 90.6 2.1 2.5.2 3.1 2.7.9 3.6-6.9 1.9-4.7 3.5 1.6 4.9 2.3.5 2 3.7-.4 4-35 2.8-83 3.6-128.6 2.9-20.2-.3-42.3-.9-63.4-2.2-2.5-.2-3.2-3-.9-3.9 4.6-1.6-2.5-2.3-.1-4.8z';
// A single hand line with a small overshoot, for the underline variant (stroked, in a box
// whose height is small enough that the stretch does not show).
const LINE = 'M3 14c38-5.5 92-8.4 150-6.6 16 .5 31 1.6 44 3.1';
// A loop drawn round a word by hand: not closed, the pen overshoots where it started. Stroked
// with `vector-effect: non-scaling-stroke`, so the line keeps one width however the box is
// stretched to the word.
const CIRCLE = 'M118 7C78 1 26 6 10 24c-12 14 10 29 62 32 54 3 112-3 124-22 10-16-24-29-76-30C92 3 64 7 46 13';

/**
 * `<Marker>` wraps a word or a short title.
 *
 *   variant  'swash' (default): the highlighter stroke. 'line': a thin hand-drawn underline.
 *            'circle': a loop drawn round the word (a price, a badge, one key word).
 *            'highlight': a highlighter band BEHIND the words, wrapping with them.
 *   delay    ms before the draw-in starts, to follow a title's own entrance animation.
 */
export function Marker({ children, variant = 'swash', delay, className = '' }) {
  // N-hosting (agent-hosting-N): 'highlight', a highlighter pen run BEHIND the words (the
  // Odoo title look): a thick translucent accent band over the lower part of the letters,
  // tilted a little. A background on an INLINE span rather than the absolutely placed SVG the
  // other variants use, because it has to follow the words onto a second line on a phone,
  // and `box-decoration-break: clone` gives each line its own band. See .mk-hl in marker.css.
  if (variant === 'highlight') {
    return (
      <span className={`mk-hl ${className}`} style={delay != null ? { '--mk-delay': `${delay}ms` } : undefined}>
        {children}
      </span>
    );
  }
  // fin N-hosting (agent-hosting-N)
  const mod = variant === 'line' ? 'mk--line' : variant === 'circle' ? 'mk--circle' : '';
  return (
    <span className={`mk ${mod} ${className}`}
      style={delay != null ? { '--mk-delay': `${delay}ms` } : undefined}>
      <svg className="mk-swash" viewBox={variant === 'circle' ? '0 0 200 60' : '0 0 200 24'} preserveAspectRatio="none" aria-hidden="true" focusable="false">
        {variant === 'line' ? <path d={LINE} vectorEffect="non-scaling-stroke" />
          : variant === 'circle' ? <path d={CIRCLE} vectorEffect="non-scaling-stroke" />
            : <path d={SWASH} fill="currentColor" />}
      </svg>
      {children}
    </span>
  );
}

// An arrow as somebody would draw it in a margin: a curve with a two-stroke head. `up` points
// up and to the start side (at the button above the note), `down` down and to the start side.
// `right` is a curve that dips and rises from the note towards what follows it, reading left
// to right (mirrored in RTL like the others).
const ARROWS = {
  up: 'M31 27C24 23 13 19 8 5M8 5l-3.4 7.3M8 5l6.6 4.2',
  down: 'M31 3C24 8 14 12 8 25M8 25l-3.6-7.2M8 25l6.8-3.8',
  right: 'M3 9c5 11 15 16 28 11M31 20l-7.6-.2M31 20l-4.4-6.2',
};

/** A handwritten aside, with an arrow pointing at what it is about. Text is a normal string. */
export function HandNote({ children, arrow = 'up', className = '' }) {
  preloadHand();
  const svg = arrow && (
    <svg className="hand-note-arrow" viewBox="0 0 34 30" aria-hidden="true" focusable="false">
      <path d={ARROWS[arrow] || ARROWS.up} />
    </svg>
  );
  // A `right` arrow comes AFTER the words: it points from the note at what follows it.
  return (
    <span className={`hand-note ${arrow === 'right' ? 'hand-note--right' : ''} ${className}`}>
      {arrow !== 'right' && svg}
      <span className="hand-note-text">{children}</span>
      {arrow === 'right' && svg}
    </span>
  );
}
