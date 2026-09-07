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

// ── Directive heads, for editing a block as fields instead of as text ──────────────────
//
// A block editor that shows `:::tip[Careful]{icon=alert-triangle}` in a textarea is a text
// editor with extra steps. These two turn that first line into named values and back, so a
// host can offer a title box and an icon picker over the same source — without a second
// parser, and without touching the body, which stays exactly as typed.

const HEAD_RE = /^(\s*)(:{2,})([A-Za-z][\w-]*)(?:\[([^\]]*)\])?(?:\{([^}]*)\})?[ \t]*$/;

/** Attributes of a directive head: `a=1 b="two words" c` → { a:'1', b:'two words', c:'' }. */
function parseAttrs(raw) {
  const out = {};
  const re = /([A-Za-z_][\w-]*)(?:=(?:"([^"]*)"|'([^']*)'|([^\s]+)))?/g;
  let m;
  while ((m = re.exec(String(raw || '')))) {
    if (!m[1]) continue;
    out[m[1]] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return out;
}
/** Back to a head string. A value with whitespace, or any of `}"'`, is quoted. */
function formatAttrs(attrs) {
  return Object.entries(attrs || {})
    .filter(([, v]) => v !== undefined && v !== null && String(v) !== '')
    .map(([k, v]) => (/[\s}"']/.test(String(v)) ? `${k}="${String(v).replace(/"/g, '')}"` : `${k}=${v}`))
    .join(' ');
}

/**
 * Read a block's directive head.
 * @returns {{name:string, label:string, attrs:Object, indent:string, colons:string}|null}
 *          null when the block does not open with one — a paragraph has no fields to edit.
 */
export function parseDirectiveHead(src) {
  const first = String(src ?? '').split('\n')[0] ?? '';
  const m = first.match(HEAD_RE);
  if (!m) return null;
  return { indent: m[1], colons: m[2], name: m[3], label: m[4] ?? '', attrs: parseAttrs(m[5]) };
}

/**
 * Rewrite a block's head with new label/attrs, leaving every other line byte-identical.
 * A patch value of '' removes the attribute; the label is set as given.
 */
export function setDirectiveHead(src, patch = {}) {
  const head = parseDirectiveHead(src);
  if (!head) return src;
  const lines = String(src ?? '').split('\n');
  const label = patch.label !== undefined ? patch.label : head.label;
  const attrs = { ...head.attrs, ...(patch.attrs || {}) };
  const a = formatAttrs(attrs);
  lines[0] = `${head.indent}${head.colons}${head.name}${label ? `[${label}]` : ''}${a ? `{${a}}` : ''}`;
  return lines.join('\n');
}

// ── Tables, as a structure ───────────────────────────────────────────────────
// A markdown table is text, and editing it as text is why people give up on them: adding a
// column means retyping every row and the separator, and one cell out of step silently stops
// it being a table at all. These parse it into rows and put it back, so the editor can offer
// "add a column" instead of "good luck".
//
// Deliberately forgiving on input and strict on output: a hand-written table with ragged pipes
// and no trailing bar still parses, and what comes back is padded and aligned so the source
// stays readable for whoever opens it next.

const cellsOf = (line) => {
  let s = String(line).trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  // Split on unescaped pipes only: `\|` is a literal pipe inside a cell, and splitting on it
  // would tear one cell into two and shift every column after it.
  return s.split(/(?<!\\)\|/).map((c) => c.trim());
};
const isSeparator = (line) => /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(line) && line.includes('-');
const alignOf = (c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : '');

/**
 * Read a markdown table. Returns null when `src` is not one — the caller uses that to decide
 * whether to offer table controls at all.
 * @returns {{ header: string[], align: string[], rows: string[][], before: string, after: string }|null}
 */
export function parseTable(src) {
  const lines = String(src ?? '').split('\n');
  const sep = lines.findIndex((l, i) => i > 0 && isSeparator(l) && lines[i - 1].includes('|'));
  if (sep < 1) return null;
  const header = cellsOf(lines[sep - 1]);
  const align = cellsOf(lines[sep]).map(alignOf);
  const rows = [];
  let end = sep + 1;
  for (; end < lines.length; end++) {
    if (!lines[end].includes('|')) break;
    rows.push(cellsOf(lines[end]));
  }
  return {
    header, align, rows,
    before: lines.slice(0, sep - 1).join('\n'),
    after: lines.slice(end).join('\n'),
  };
}

/** Put a table back together, padded so the source is readable by hand. */
export function serializeTable(t) {
  const cols = t.header.length;
  const rows = t.rows.map((r) => Array.from({ length: cols }, (_, i) => r[i] ?? ''));
  const w = Array.from({ length: cols }, (_, i) =>
    Math.max(3, t.header[i]?.length || 0, ...rows.map((r) => r[i].length)));
  const pad = (s, i) => String(s ?? '').padEnd(w[i]);
  const sep = t.align.map((a, i) => {
    const bar = '-'.repeat(Math.max(3, w[i] - (a === 'center' ? 2 : a ? 1 : 0)));
    return a === 'center' ? `:${bar}:` : a === 'right' ? `${bar}:` : a === 'left' ? `:${bar}` : bar;
  });
  const line = (cs) => `| ${cs.join(' | ')} |`;
  const body = [line(t.header.map(pad)), line(sep.map((s, i) => s.padEnd(w[i]))), ...rows.map((r) => line(r.map(pad)))];
  return [t.before, ...body, t.after].filter((x, i) => !(i === 0 && !x) && !(x === '' && i === 3 + rows.length)).join('\n');
}

const clampIdx = (i, len) => Math.max(0, Math.min(len, Number.isFinite(i) ? i : len));

/** Add a column. `at` defaults to the end. */
export function tableAddColumn(src, at) {
  const t = parseTable(src); if (!t) return src;
  const i = clampIdx(at, t.header.length);
  t.header.splice(i, 0, '');
  t.align.splice(i, 0, '');
  for (const r of t.rows) r.splice(i, 0, '');
  return serializeTable(t);
}

/** Remove a column. A table needs one, so the last one is never removed. */
export function tableRemoveColumn(src, at) {
  const t = parseTable(src); if (!t || t.header.length <= 1) return src;
  const i = clampIdx(at, t.header.length - 1);
  t.header.splice(i, 1); t.align.splice(i, 1);
  for (const r of t.rows) r.splice(i, 1);
  return serializeTable(t);
}

/** Add a row. `at` defaults to the end. */
export function tableAddRow(src, at) {
  const t = parseTable(src); if (!t) return src;
  const i = clampIdx(at, t.rows.length);
  t.rows.splice(i, 0, Array.from({ length: t.header.length }, () => ''));
  return serializeTable(t);
}

/** Remove a row. The header is not a row and cannot be removed this way. */
export function tableRemoveRow(src, at) {
  const t = parseTable(src); if (!t || !t.rows.length) return src;
  const i = clampIdx(at, t.rows.length - 1);
  t.rows.splice(i, 1);
  return serializeTable(t);
}

/** Set a column's alignment: '' | 'left' | 'center' | 'right'. */
export function tableSetAlign(src, at, how) {
  const t = parseTable(src); if (!t) return src;
  const i = clampIdx(at, t.header.length - 1);
  t.align[i] = ['left', 'center', 'right'].includes(how) ? how : '';
  return serializeTable(t);
}

// ── Container directives, as a structure ─────────────────────────────────────
// `:::tabs` holds `:::tab`s, `::::steps` holds `:::step`s, `:::cards` holds `:::card`s. Adding
// one by hand means matching the parent's colon count, which is the single most common way to
// break one of these blocks.

/** How many direct children of `child` a container block has. */
export function countChildren(src, child) {
  const re = new RegExp(`^\\s*:{3,}${child}\\b`, 'gm');
  return (String(src ?? '').match(re) || []).length;
}

/**
 * Append a child to a container, using ONE FEWER colon than the parent — which is the rule
 * that makes these nest, and the one a person typing it out gets wrong.
 */
export function addChild(src, child, label = '', body = '') {
  const head = parseDirectiveHead(src);
  if (!head) return src;
  const inner = ':'.repeat(Math.max(3, head.colons.length - 1));
  const lines = String(src ?? '').split('\n');
  // The parent's closing fence is the last line that is only colons.
  let close = lines.length - 1;
  while (close > 0 && !/^\s*:{3,}\s*$/.test(lines[close])) close--;
  const block = [`${inner}${child}${label ? `[${label}]` : ''}`, body, inner];
  if (close <= 0) return [...lines, ...block].join('\n');
  return [...lines.slice(0, close), ...block, ...lines.slice(close)].join('\n');
}
