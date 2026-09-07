// The markdown a table is made of.
//
// Its own module, with no imports, because it is the part worth pinning and node cannot import
// a .jsx file to do that. A markdown table has three things that must stay in step — the header
// row, the separator row and every body row — and getting any of them wrong produces no error
// at all: it renders as a paragraph full of pipes, which reads as the editor being broken.

export const MAX_C = 8;
export const MAX_R = 10;
const SEP = { left: ':---', center: ':---:', right: '---:', none: '---' };

/**
 * Build the markdown for a table.
 *
 * Pure and exported: the shape maths is the part worth pinning, and it is the part that has to
 * agree with `parseTable` in the block editor — a builder that emits something the structural
 * editor cannot read back would give you a table you can create and not edit.
 */
export function buildTable({ cols = 2, rows = 2, header = true, align = 'none', filled = true } = {}) {
  const c = Math.max(1, Math.min(MAX_C, Math.round(cols) || 1));
  const r = Math.max(0, Math.min(MAX_R, Math.round(rows) || 0));
  const head = Array.from({ length: c }, (_, i) => (header ? `Column ${String.fromCharCode(65 + i)}` : ' '));
  const sep = Array.from({ length: c }, () => SEP[align] || SEP.none);
  const body = Array.from({ length: r }, (_, y) =>
    Array.from({ length: c }, (_, x) => (filled ? `Cell ${y + 1}.${x + 1}` : ' ')));
  const line = (cells) => `| ${cells.join(' | ')} |`;
  // A separator row is not optional — without it the whole thing is a paragraph, which is the
  // failure this component exists to prevent.
  return ['', line(head), line(sep), ...body.map(line), ''].join('\n');
}
