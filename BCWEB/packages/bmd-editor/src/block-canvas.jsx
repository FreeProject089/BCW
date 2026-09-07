// B.MD block canvas — the drag-drop half of the editor.
//
// BmdEditor is a text editor with a block-insertion menu; this is its complement: the document
// as a stack of cards you reorder by dragging (or the up/down buttons on a phone), each editable
// in place, with an insert palette between rows. It sits on the lossless block model
// (@bettercommunity/bmd/editor-blocks), so reordering and editing round-trip the source with no
// drift. Dependency-free (native HTML5 drag + touch-friendly buttons), so it drops into the
// package without pulling a DnD library.
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
// parseDirectiveHead/setDirectiveHead were USED below and never imported, and `pickIcon` was
// read off nothing at all — a free identifier the caller passed as a prop that was never
// destructured. Both threw ReferenceError from inside the field row, which runs for every
// block, so the visual editor died on any document that had one. It went unnoticed because
// the tests covering that row exercise the two pure functions directly and the component
// never appears in them, and because eslint runs from apps/web and does not reach packages/.
import {
  splitBlocks, joinBlocks, newBlock, parseDirectiveHead, setDirectiveHead,
  parseTable, tableAddColumn, tableRemoveColumn, tableAddRow, tableRemoveRow,
  countChildren, addChild,
} from '@bettercommunity/bmd/editor-blocks';

// A short, human label + a glyph hint per block kind (directive:foo → "foo").
function kindLabel(kind) {
  if (kind.startsWith('directive:')) return kind.slice(10);
  return kind;
}

const DragIcon = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>);
const Ico = ({ d }) => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d}/></svg>);
const UP = 'M18 15l-6-6-6 6', DOWN = 'M6 9l6 6 6-6', X = 'M18 6 6 18M6 6l12 12', PLUS = 'M12 5v14M5 12h14', EYE = 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z';

/**
 * @param {string} value            the B.MD document
 * @param {(v:string)=>void} onChange
 * @param {Array} [snippetGroups]   the insert palette (SNIPPET_GROUPS shape: [{label, items:[{id,label,md}]}])
 * @param {React.ComponentType} [renderer]  the <Markdown> component, for the per-block preview
 * @param {string} [lang]
 * @param {object} [labels]        UI strings, so a localised host is not stuck with English.
 *                                 Every key falls back to the English below.
 */
// Containers whose children can be added from a button. The value is the child directive:
// adding one by hand means matching the parent's colon count, which is the most common way
// to break one of these blocks.
const CHILD_OF = { tabs: 'tab', steps: 'step', cards: 'card', columns: 'column', row: 'col', roadmap: 'stage', grid: 'card' };

const EN = {
  insert: 'Insert a block', search: 'Search blocks…', noMatch: 'No block matches.',
  count: '{n} block(s)', preview: 'Preview', drag: 'Drag to reorder',
  up: 'Move up', down: 'Move down', del: 'Delete',
  empty: 'Empty document — insert a block above.',
  title: 'Title', icon: 'Icon', noIcon: 'Pick an icon',
  addCol: '+ column', delCol: '− column', addRow: '+ row', delRow: '− row',
  addChild: 'Add {child}', childCount: '{n} × {child}',
  style: 'Style', styleA: 'Style A', styleB: 'Style B',
  space: 'Space below', spaceAuto: 'Space: auto',
  space_none: 'None', space_xs: 'Tiny', space_sm: 'Small', space_md: 'Medium', space_lg: 'Large', space_xl: 'Huge',
};
export default function BmdBlockCanvas({ value = '', onChange, snippetGroups = [], renderer: Markdown = null, lang = 'en', labels = null, pickIcon = null }) {
  const T = { ...EN, ...(labels || {}) };
  const [blocks, setBlocks] = useState(() => splitBlocks(value));
  const [preview, setPreview] = useState(true);
  const [addAt, setAddAt] = useState(null);
  // Where the floating palette sits, measured from the button that opened it.
  const [menu, setMenu] = useState(null);
  const [q, setQ] = useState('');
  const emitted = useRef(value);
  const dragFrom = useRef(null);
  const [dragOver, setDragOver] = useState(null);

  // Re-split only when the value changed from OUTSIDE (not from our own emit) — so typing in a
  // block never re-segments the document under the caret.
  useEffect(() => {
    if (value !== emitted.current) { setBlocks(splitBlocks(value)); emitted.current = value; }
  }, [value]);

  const commit = useCallback((next) => {
    setBlocks(next);
    const md = joinBlocks(next);
    emitted.current = md;
    onChange?.(md);
  }, [onChange]);

  const editBlock = (id, src) => commit(blocks.map((b) => (b.id === id ? { ...b, src } : b)));
  const removeBlock = (id) => commit(blocks.filter((b) => b.id !== id));
  const move = (i, dir) => {
    const j = i + dir; if (j < 0 || j >= blocks.length) return;
    const n = [...blocks]; [n[i], n[j]] = [n[j], n[i]]; commit(n);
  };
  const reorder = (from, to) => {
    if (from === to || from == null) return;
    const n = [...blocks]; const [m] = n.splice(from, 1); n.splice(to > from ? to - 1 : to, 0, m); commit(n);
  };
  const insertAt = (i, md) => {
    // A BLANK block after it, and the document breaks without one. joinBlocks joins with a
    // single newline and the blank lines between blocks are themselves blocks — so a block
    // spliced in on its own is glued to whichever block follows it: insert a paragraph above
    // another and the two become one block, which then edits, moves and deletes as one.
    const n = [...blocks];
    n.splice(i, 0, newBlock('paragraph', md), newBlock('blank', ''));
    commit(n); setAddAt(null); setQ('');
  };

  // A flat, searchable list of palette items from the snippet groups (block-level ones).
  const palette = useMemo(() => {
    const out = [];
    for (const g of snippetGroups || []) for (const it of (g.items || [])) {
      // Inline snippets (bold, italic, a link, :kbd[…]) wrap a SELECTION; they are not blocks.
      // Offered here they inserted a lone `**bold**` as its own paragraph, which is never what
      // "insert a block" means — the text editor's menu is where those belong.
      if (it.inline || !it.md) continue;
      // Turn a snippet's placeholder template into concrete starter text.
      const md = String(it.md || '').replace(/\$\{sel\|([^}]*)\}/g, '$1').replace(/\$\{sel\}/g, '').replace(/\$\{cursor\}/g, '').replace(/\$\{[^}]*\}/g, '');
      out.push({ id: `${g.id || g.label}:${it.id}`, group: g.label, label: it.label, md: md.trim() });
    }
    return out;
  }, [snippetGroups]);
  const shown = q.trim() ? palette.filter((p) => `${p.label} ${p.group}`.toLowerCase().includes(q.trim().toLowerCase())) : palette;

  /**
   * The insert palette, in a PORTAL.
   *
   * It was `position: absolute` inside the add button's row, so every ancestor with an
   * `overflow` clipped it — and the canvas lives inside a scrolling editor panel inside a
   * modal, so there are three of them. The reported symptom is the menu cut off mid-item, with
   * the last entry sliced in half and nothing scrollable to reach it.
   *
   * The text editor's own block menu already learned this (see the note beside its
   * createPortal in blog.jsx: an ancestor `transform` also makes itself the containing block,
   * which moves a fixed element as well as clipping it). This is the same treatment: measured
   * against the viewport, rendered at the document root, flipped above the button when there
   * is no room below, and capped to the space actually available so it always scrolls rather
   * than overflowing.
   */
  const openPalette = (i, el) => {
    if (addAt === i) { setAddAt(null); return; }
    const r = el.getBoundingClientRect();
    // A hidden or background tab reports `innerWidth/innerHeight` as 0 in some browsers, and
    // measuring against 0 puts the menu at a negative height in a zero-wide column. Fall back
    // to the document element, then to a plausible window, so the menu is never positioned
    // from a viewport that does not exist.
    const vh = window.innerHeight || document.documentElement.clientHeight || 800;
    const vw = window.innerWidth || document.documentElement.clientWidth || 1200;
    const below = vh - r.bottom - 12;
    const above = r.top - 12;
    const flip = below < 220 && above > below;
    setMenu({
      left: Math.max(8, Math.min(r.left + r.width / 2 - 150, vw - 308)),
      top: flip ? undefined : r.bottom + 6,
      bottom: flip ? vh - r.top + 6 : undefined,
      maxH: Math.max(160, (flip ? above : below) - 8),
    });
    setAddAt(i); setQ('');
  };

  const AddBar = ({ i }) => (
    <div className="bmdc-add">
      <button type="button" className="bmdc-add-btn" onClick={(e) => openPalette(i, e.currentTarget)} title={T.insert}>
        <Ico d={PLUS} />
      </button>
    </div>
  );

  const Palette = () => (addAt == null || !menu ? null : createPortal(
    <>
      <div className="bmdc-palette-scrim" onMouseDown={() => setAddAt(null)} />
      <div className="bmdc-palette is-floating" role="menu"
        style={{ left: menu.left, top: menu.top, bottom: menu.bottom, maxHeight: menu.maxH }}>
        <input autoFocus className="bmdc-palette-search" placeholder={T.search} value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); setAddAt(null); }
            // Enter takes the first match, so a search can be finished without the mouse.
            if (e.key === 'Enter' && shown.length) { e.preventDefault(); insertAt(addAt, shown[0].md); }
          }} />
        <div className="bmdc-palette-list">
          {shown.map((p) => (
            <button key={p.id} type="button" className="bmdc-palette-item" onClick={() => insertAt(addAt, p.md)}>
              <span className="bmdc-palette-label">{p.label}</span><span className="bmdc-palette-group">{p.group}</span>
            </button>
          ))}
          {!shown.length && <div className="bmdc-palette-empty">{T.noMatch}</div>}
        </div>
      </div>
    </>, document.body));

  return (
    <div className="bmdc">
      <Palette />
      <div className="bmdc-bar">
        <span className="bmdc-count">{T.count.replace('{n}', blocks.filter((b) => b.kind !== 'blank').length)}</span>
        <button type="button" className={`bmdc-toggle ${preview ? 'is-on' : ''}`} onClick={() => setPreview((v) => !v)} title={T.preview}>
          <Ico d={EYE} /> {T.preview}
        </button>
      </div>

      <AddBar i={0} />
      {blocks.map((b, i) => (
        <div key={b.id}>
          <div
            className={`bmdc-block ${dragOver === i ? 'is-over' : ''} ${b.kind === 'blank' ? 'is-blank' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(i); }}
            onDrop={(e) => { e.preventDefault(); reorder(dragFrom.current, i); dragFrom.current = null; setDragOver(null); }}
          >
            <div className="bmdc-handle" draggable
              onDragStart={() => { dragFrom.current = i; }}
              onDragEnd={() => { dragFrom.current = null; setDragOver(null); }}
              title={T.drag}>
              <DragIcon />
            </div>
            <div className="bmdc-body">
              <div className="bmdc-head">
                <span className="bmdc-kind">{kindLabel(b.kind)}</span>
                <div className="bmdc-actions">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} title={T.up}><Ico d={UP} /></button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === blocks.length - 1} title={T.down}><Ico d={DOWN} /></button>
                  <button type="button" onClick={() => removeBlock(b.id)} title={T.del} className="bmdc-del"><Ico d={X} /></button>
                </div>
              </div>
              {/* Fields, where there are fields.
                  A block editor that shows `:::tip[Careful]{icon=star}` in a textarea is a text
                  editor with extra steps. When a block opens with a directive, its title and its
                  icon are edited as themselves — the body stays exactly as typed, because
                  setDirectiveHead only ever rewrites line 1. */}
              {(() => {
                const head = parseDirectiveHead(b.src);
                if (!head) return null;
                return (
                  <div className="bmdc-fields">
                    <input className="bmdc-field" value={head.label} placeholder={T.title}
                      onChange={(e) => editBlock(b.id, setDirectiveHead(b.src, { label: e.target.value }))} />
                    {pickIcon && (
                      <button type="button" className="bmdc-field-btn" title={T.icon}
                        onClick={async () => {
                          const picked = await pickIcon(head.attrs.icon || '');
                          if (picked == null) return;   // cancelled — '' is a real answer (clear it)
                          editBlock(b.id, setDirectiveHead(b.src, { attrs: { icon: picked } }));
                        }}>
                        {head.attrs.icon || T.noIcon}
                      </button>
                    )}
                    {/* The two looks and the gap underneath.
                        Both were already attributes the renderer understood, and both were
                        therefore reachable only by typing them into the fence by hand — which
                        means nobody used them. Two selects: the block keeps its meaning, the
                        writer sets its weight and its rhythm.
                        The default option writes an EMPTY value, which setDirectiveHead
                        removes from the fence — so an untouched block stays byte-identical
                        and a document does not fill up with `variant=a space=md`. */}
                    <select className="bmdc-field-sel" title={T.style} value={head.attrs.variant || ''}
                      onChange={(e) => editBlock(b.id, setDirectiveHead(b.src, { attrs: { variant: e.target.value } }))}>
                      <option value="">{T.styleA}</option>
                      <option value="b">{T.styleB}</option>
                    </select>
                    <select className="bmdc-field-sel" title={T.space} value={head.attrs.space || ''}
                      onChange={(e) => editBlock(b.id, setDirectiveHead(b.src, { attrs: { space: e.target.value } }))}>
                      <option value="">{T.spaceAuto}</option>
                      {['none', 'xs', 'sm', 'md', 'lg', 'xl'].map((s) => <option key={s} value={s}>{T[`space_${s}`] || s}</option>)}
                    </select>
                  </div>
                );
              })()}
              {/* Structure, where there is structure to edit.
                  A markdown table is text, and editing it as text is why people give up on
                  them: adding a column means retyping every row AND the separator, and one
                  cell out of step silently stops it being a table — it renders as a paragraph
                  full of pipes. Same for `:::tabs`: a new tab has to match the parent's colon
                  count or the whole block breaks. */}
              {(() => {
                const table = parseTable(b.src);
                if (table) {
                  return (
                    <div className="bmdc-struct">
                      <span className="bmdc-struct-n">{table.header.length}&times;{table.rows.length}</span>
                      <button type="button" onClick={() => editBlock(b.id, tableAddColumn(b.src))}>{T.addCol}</button>
                      <button type="button" disabled={table.header.length <= 1}
                        onClick={() => editBlock(b.id, tableRemoveColumn(b.src, table.header.length - 1))}>{T.delCol}</button>
                      <button type="button" onClick={() => editBlock(b.id, tableAddRow(b.src))}>{T.addRow}</button>
                      <button type="button" disabled={!table.rows.length}
                        onClick={() => editBlock(b.id, tableRemoveRow(b.src, table.rows.length - 1))}>{T.delRow}</button>
                    </div>
                  );
                }
                const h = parseDirectiveHead(b.src);
                const child = h && CHILD_OF[h.name];
                if (!child) return null;
                const n = countChildren(b.src, child);
                return (
                  <div className="bmdc-struct">
                    <span className="bmdc-struct-n">{T.childCount.replace('{n}', String(n)).replace('{child}', child)}</span>
                    <button type="button" onClick={() => editBlock(b.id, addChild(b.src, child, '', ''))}>
                      {T.addChild.replace('{child}', child)}
                    </button>
                  </div>
                );
              })()}
              <textarea
                className="bmdc-src"
                value={b.src}
                spellCheck={false}
                rows={Math.min(14, Math.max(1, b.src.split('\n').length))}
                onChange={(e) => editBlock(b.id, e.target.value)}
              />
              {preview && Markdown && b.kind !== 'blank' && b.src.trim() !== '' && (
                <div className="bmdc-preview"><Markdown lang={lang}>{b.src}</Markdown></div>
              )}
            </div>
          </div>
          <AddBar i={i + 1} />
        </div>
      ))}
      {!blocks.length && <div className="bmdc-empty">{T.empty}</div>}
    </div>
  );
}
