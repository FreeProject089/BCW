// Turning the selected LINES into a heading, a list or a quote.
//
// The selection toolbar could only wrap a selection in markers — bold, italic, code, a link.
// Everything structural (a heading, a bullet list, a quote) still meant leaving the mouse,
// finding the start of the line and typing the prefix by hand, which is the half of formatting
// people reach for most.
//
// These are TOGGLES, and toggling is the part that goes wrong. Pressing "bullet" twice must
// give the text back, not `- - item`; pressing H2 on an H1 must REPLACE the level rather than
// prepend to it; and a mixed selection (some lines already bulleted, some not) has to pick one
// answer instead of inverting each line and leaving a mess. The rule throughout: if EVERY
// non-blank line already has the mark, remove it; otherwise give it to all of them.
//
// Pure, over an array of lines, so all of that can be pinned.

const HEADING = /^(\s*)(#{1,6})\s+/;
const BULLET = /^(\s*)[-*+]\s+/;
const ORDERED = /^(\s*)\d+\.\s+/;
const QUOTE = /^(\s*)>\s?/;

const nonBlank = (lines) => lines.filter((l) => l.trim() !== '');
/** True when every line that matters already carries the mark — the signal to remove it. */
const allHave = (lines, re) => { const l = nonBlank(lines); return l.length > 0 && l.every((x) => re.test(x)); };

/** Strip every list/quote/heading marker, so one prefix never lands on top of another. */
function bare(line) {
  return line.replace(HEADING, '$1').replace(BULLET, '$1').replace(ORDERED, '$1').replace(QUOTE, '$1');
}

/**
 * `# `…`###### `. Applying the level a line already has removes it (a second press on H2
 * gives you the paragraph back); applying a different level replaces it rather than stacking.
 */
export function toggleHeading(lines, level = 2) {
  const mark = '#'.repeat(Math.max(1, Math.min(6, level)));
  const already = allHave(lines, new RegExp(`^\\s*${mark}\\s+`));
  return lines.map((l) => {
    if (l.trim() === '') return l;
    const indent = (l.match(/^\s*/) || [''])[0];
    return already ? bare(l) : `${indent}${mark} ${bare(l).trimStart()}`;
  });
}

/** `- ` on every selected line, or off it. */
export function toggleBullet(lines) {
  const already = allHave(lines, BULLET);
  return lines.map((l) => {
    if (l.trim() === '') return l;
    const indent = (l.match(/^\s*/) || [''])[0];
    return already ? bare(l) : `${indent}- ${bare(l).trimStart()}`;
  });
}

/** `1. `, `2. `… renumbered from one so a re-ordered selection is not left counting wrong. */
export function toggleOrdered(lines) {
  const already = allHave(lines, ORDERED);
  let n = 0;
  return lines.map((l) => {
    if (l.trim() === '') return l;
    const indent = (l.match(/^\s*/) || [''])[0];
    if (already) return bare(l);
    n += 1;
    return `${indent}${n}. ${bare(l).trimStart()}`;
  });
}

/**
 * `> ` on every selected line, INCLUDING the blank ones between paragraphs — a blockquote that
 * skips its blank lines is two blockquotes with a gap, which is not what was selected.
 */
export function toggleQuote(lines) {
  const already = allHave(lines, QUOTE);
  return lines.map((l) => {
    if (already) return l.replace(QUOTE, '$1');
    return l.trim() === '' ? '>' : `> ${l}`;
  });
}

/**
 * Grow a selection to whole lines.
 *
 * A line transform applied to "the selected characters" would put `- ` in the middle of a
 * word — the user selected some text, not some line-starts, and meant the lines it sits on.
 * @returns {{ start: number, end: number, lines: string[] }}
 */
export function expandToLines(value, selStart, selEnd) {
  const v = String(value ?? '');
  let start = v.lastIndexOf('\n', Math.max(0, selStart - 1)) + 1;
  let end = v.indexOf('\n', selEnd);
  if (end === -1) end = v.length;
  // A selection that ends exactly at a line start took the newline of the line before it;
  // without this, pressing "bullet" marks one line more than is highlighted.
  if (selEnd > selStart && selEnd === start) { start = v.lastIndexOf('\n', Math.max(0, selStart - 1)) + 1; }
  return { start, end, lines: v.slice(start, end).split('\n') };
}
