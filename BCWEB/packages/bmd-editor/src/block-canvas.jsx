// B.MD block canvas — the drag-drop half of the editor.
//
// BmdEditor is a text editor with a block-insertion menu; this is its complement: the document
// as a stack of cards you reorder by dragging (or the up/down buttons on a phone), each editable
// in place, with an insert palette between rows. It sits on the lossless block model
// (@bettercommunity/bmd/editor-blocks), so reordering and editing round-trip the source with no
// drift. Dependency-free (native HTML5 drag + touch-friendly buttons), so it drops into the
// package without pulling a DnD library.
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { splitBlocks, joinBlocks, newBlock } from '@bettercommunity/bmd/editor-blocks';

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
 */
export default function BmdBlockCanvas({ value = '', onChange, snippetGroups = [], renderer: Markdown = null, lang = 'en' }) {
  const [blocks, setBlocks] = useState(() => splitBlocks(value));
  const [preview, setPreview] = useState(true);
  const [addAt, setAddAt] = useState(null);   // index where the palette is open
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
    const n = [...blocks]; n.splice(i, 0, newBlock('paragraph', md)); commit(n); setAddAt(null); setQ('');
  };

  // A flat, searchable list of palette items from the snippet groups (block-level ones).
  const palette = useMemo(() => {
    const out = [];
    for (const g of snippetGroups || []) for (const it of (g.items || [])) {
      // Turn a snippet's placeholder template into concrete starter text.
      const md = String(it.md || '').replace(/\$\{sel\|([^}]*)\}/g, '$1').replace(/\$\{sel\}/g, '').replace(/\$\{cursor\}/g, '').replace(/\$\{[^}]*\}/g, '');
      out.push({ id: `${g.id || g.label}:${it.id}`, group: g.label, label: it.label, md: md.trim() });
    }
    return out;
  }, [snippetGroups]);
  const shown = q.trim() ? palette.filter((p) => `${p.label} ${p.group}`.toLowerCase().includes(q.trim().toLowerCase())) : palette;

  const AddBar = ({ i }) => (
    <div className="bmdc-add">
      <button type="button" className="bmdc-add-btn" onClick={() => { setAddAt(addAt === i ? null : i); setQ(''); }} title="Insert a block">
        <Ico d={PLUS} />
      </button>
      {addAt === i && (
        <div className="bmdc-palette" role="menu">
          <input autoFocus className="bmdc-palette-search" placeholder="Search blocks…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="bmdc-palette-list">
            {shown.map((p) => (
              <button key={p.id} type="button" className="bmdc-palette-item" onClick={() => insertAt(i, p.md)}>
                <span className="bmdc-palette-label">{p.label}</span><span className="bmdc-palette-group">{p.group}</span>
              </button>
            ))}
            {!shown.length && <div className="bmdc-palette-empty">No block matches.</div>}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="bmdc">
      <div className="bmdc-bar">
        <span className="bmdc-count">{blocks.filter((b) => b.kind !== 'blank').length} block(s)</span>
        <button type="button" className={`bmdc-toggle ${preview ? 'is-on' : ''}`} onClick={() => setPreview((v) => !v)} title="Toggle per-block preview">
          <Ico d={EYE} /> Preview
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
              title="Drag to reorder">
              <DragIcon />
            </div>
            <div className="bmdc-body">
              <div className="bmdc-head">
                <span className="bmdc-kind">{kindLabel(b.kind)}</span>
                <div className="bmdc-actions">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} title="Move up"><Ico d={UP} /></button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === blocks.length - 1} title="Move down"><Ico d={DOWN} /></button>
                  <button type="button" onClick={() => removeBlock(b.id)} title="Delete" className="bmdc-del"><Ico d={X} /></button>
                </div>
              </div>
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
      {!blocks.length && <div className="bmdc-empty">Empty document — insert a block above.</div>}
    </div>
  );
}
