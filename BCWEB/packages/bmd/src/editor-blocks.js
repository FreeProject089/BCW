// B.MD editor foundation — a LOSSLESS source-block model + the `.bmd` file type.
//
// The visual editor needs to treat a document as an ordered list of blocks it can reorder,
// insert and delete — while never corrupting the source. So this splits the raw B.MD text into
// contiguous top-level blocks whose concatenation is byte-for-byte the original
// (`joinBlocks(splitBlocks(md)) === md`), and never cuts inside a fenced code block or a `:::`
// directive fence. Each block carries its exact `src`, an inferred `kind` (for the palette /
// per-block UI) and a stable `id`. Editing a block edits its `src`; the round-trip guarantee
// means a save can round-trip untouched blocks with zero drift.

let _seq = 0;
const nextId = () => `blk_${(_seq++).toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

const CODE_FENCE = /^(\s*)(`{3,}|~{3,})/;
const DIRECTIVE_OPEN = /^:{2,}[A-Za-z]/;      // ::name / :::name / ::::name … (a container/leaf open)
const DIRECTIVE_CLOSE = /^(:{2,})\s*$/;        // a bare fence line closes the matching directive
const HEADING = /^#{1,6}\s/;
const HR = /^\s*([-*_])(\s*\1){2,}\s*$/;
const LIST = /^\s*([-*+]\s|\d+[.)]\s)/;
const BLOCKQUOTE = /^\s*>/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}/;

/** The kind of a block, inferred from its first meaningful line — drives the editor's UI. */
function inferKind(src) {
  const first = src.split('\n').find((l) => l.trim() !== '') || '';
  if (CODE_FENCE.test(first)) return 'code';
  if (DIRECTIVE_OPEN.test(first)) {
    const m = first.match(/^:{2,}([A-Za-z][\w-]*)/);
    return m ? `directive:${m[1].toLowerCase()}` : 'directive';
  }
  if (HEADING.test(first)) return 'heading';
  if (HR.test(first)) return 'hr';
  if (BLOCKQUOTE.test(first)) return 'quote';
  if (LIST.test(first)) return 'list';
  if (first.includes('|') && src.split('\n').some((l) => TABLE_SEP.test(l))) return 'table';
  if (first.trim() === '') return 'blank';
  return 'paragraph';
}

/**
 * Split a B.MD document into ordered, lossless top-level blocks.
 * Invariant: `joinBlocks(splitBlocks(md)) === md`.
 * @param {string} md
 * @returns {{id:string, kind:string, src:string}[]}
 */
export function splitBlocks(md) {
  const text = String(md ?? '');
  if (text === '') return [];
  // Keep the exact bytes: split on \n but remember whether a trailing newline existed.
  const lines = text.split('\n');
  const blocks = [];
  let cur = [];              // lines of the block being built
  const push = () => { if (cur.length) { const src = cur.join('\n'); blocks.push({ id: nextId(), kind: inferKind(src), src }); cur = []; } };

  let i = 0;
  const dirStack = [];       // colon-counts of open directive fences (for nesting)
  let codeFence = null;      // the opening fence marker string while inside a code block

  while (i < lines.length) {
    const line = lines[i];
    const inFence = codeFence != null || dirStack.length > 0;

    if (codeFence != null) {
      cur.push(line);
      // Close on a line that is only the fence marker (same char, at least as long as the open).
      const [openLen, openChar] = codeFence;
      const m = line.match(/^\s*(`{3,}|~{3,})\s*$/);
      if (m && m[1][0] === openChar && m[1].length >= openLen) { codeFence = null; push(); }
      i++; continue;
    }
    if (dirStack.length > 0) {
      cur.push(line);
      const open = line.match(DIRECTIVE_OPEN) && line.match(/^(:{2,})/);
      const close = line.match(DIRECTIVE_CLOSE);
      if (open && DIRECTIVE_OPEN.test(line)) dirStack.push(open[1].length);
      else if (close) dirStack.pop();
      if (dirStack.length === 0) push();       // directive block ends here
      i++; continue;
    }

    // Not in any fence.
    const cf = line.match(CODE_FENCE);
    if (cf) { push(); cur.push(line); codeFence = [cf[2].length, cf[2][0]]; i++; continue; }
    const dOpen = line.match(/^(:{2,})[A-Za-z]/);
    if (dOpen) { push(); cur.push(line); dirStack.push(dOpen[1].length); i++; continue; }

    if (line.trim() === '') {
      // Blank line: attach to the current block (keeps join lossless), then break the block.
      cur.push(line); push(); i++; continue;
    }
    // A heading or hr is its own single-line block.
    if (HEADING.test(line) || HR.test(line)) { push(); cur.push(line); push(); i++; continue; }
    cur.push(line); i++;
  }
  push();
  return blocks;
}

/** Reassemble blocks into a B.MD document — the exact inverse of splitBlocks. */
export function joinBlocks(blocks) {
  return (blocks || []).map((b) => b.src).join('\n');
}

/** A fresh block of a kind, with sensible starter source for the editor's "insert" palette. */
export function newBlock(kind = 'paragraph', src = '') {
  return { id: nextId(), kind, src };
}

// ── The `.bmd` file type ────────────────────────────────────────────────────
// A .bmd file is B.MD text with an OPTIONAL leading metadata block:
//   ---
//   bmd: 1
//   title: My page
//   ---
//   <B.MD body…>
// Everything after the closing `---` is the document body. No frontmatter → the whole file is
// the body and meta is `{}`. Import → { meta, body }; the editor edits `body` as blocks.

export function parseBmdFile(text) {
  const s = String(text ?? '');
  const m = s.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: s };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return { meta, body: m[2] };
}

export function serializeBmdFile({ meta = {}, body = '' } = {}) {
  const keys = Object.keys(meta).filter((k) => meta[k] != null && meta[k] !== '');
  const withVer = keys.includes('bmd') ? meta : { bmd: '1', ...meta };
  const front = Object.entries(withVer).map(([k, v]) => `${k}: ${v}`).join('\n');
  return `---\n${front}\n---\n${String(body ?? '')}`;
}

/** Convenience: a .bmd file's body straight to editable blocks, and back. */
export const bmdFileToBlocks = (text) => splitBlocks(parseBmdFile(text).body);
export const blocksToBmdFile = (blocks, meta = {}) => serializeBmdFile({ meta, body: joinBlocks(blocks) });
