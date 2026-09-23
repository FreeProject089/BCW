// Hand-drawn marks for the landing pages: a highlighter stroke under a word, a hand-drawn
// underline, and a handwritten note with an arrow.
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

// A brush stroke, drawn as a filled shape in a 200 x 24 box and stretched to the word
// (`preserveAspectRatio="none"`). Filled rather than stroked because a stroke width would be
// stretched unevenly by that same scaling. The ragged ends and the uneven top edge are what
// make it read as a marker rather than as a pill.
const SWASH = 'M4.6 11.2C24 7.4 61 5.3 104 4.6c34-.5 64 .4 90.6 2.1 2.5.2 3.1 2.7.9 3.6-6.9 1.9-4.7 3.5 1.6 4.9 2.3.5 2 3.7-.4 4-35 2.8-83 3.6-128.6 2.9-20.2-.3-42.3-.9-63.4-2.2-2.5-.2-3.2-3-.9-3.9 4.6-1.6-2.5-2.3-.1-4.8z';
// A single hand line with a small overshoot, for the underline variant (stroked, in a box
// whose height is small enough that the stretch does not show).
const LINE = 'M3 14c38-5.5 92-8.4 150-6.6 16 .5 31 1.6 44 3.1';

/**
 * `<Marker>` wraps a word or a short title.
 *
 *   variant  'swash' (default): the highlighter stroke. 'line': a thin hand-drawn underline.
 *   delay    ms before the draw-in starts, to follow a title's own entrance animation.
 */
export function Marker({ children, variant = 'swash', delay, className = '' }) {
  return (
    <span className={`mk ${variant === 'line' ? 'mk--line' : ''} ${className}`}
      style={delay != null ? { '--mk-delay': `${delay}ms` } : undefined}>
      <svg className="mk-swash" viewBox="0 0 200 24" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        {variant === 'line' ? <path d={LINE} /> : <path d={SWASH} fill="currentColor" />}
      </svg>
      {children}
    </span>
  );
}

// An arrow as somebody would draw it in a margin: a curve with a two-stroke head. `up` points
// up and to the start side (at the button above the note), `down` down and to the start side.
const ARROWS = {
  up: 'M31 27C24 23 13 19 8 5M8 5l-3.4 7.3M8 5l6.6 4.2',
  down: 'M31 3C24 8 14 12 8 25M8 25l-3.6-7.2M8 25l6.8-3.8',
};

/** A handwritten aside, with an arrow pointing at what it is about. Text is a normal string. */
export function HandNote({ children, arrow = 'up', className = '' }) {
  return (
    <span className={`hand-note ${className}`}>
      {arrow && (
        <svg className="hand-note-arrow" viewBox="0 0 34 30" aria-hidden="true" focusable="false">
          <path d={ARROWS[arrow] || ARROWS.up} />
        </svg>
      )}
      <span className="hand-note-text">{children}</span>
    </span>
  );
}
