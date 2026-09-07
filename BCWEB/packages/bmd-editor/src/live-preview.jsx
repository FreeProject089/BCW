// Editing the document you are looking at.
//
// The preview was read-only: to change a word you saw was wrong, you switched back to the
// source, found the line among the fences, changed it, and switched back to check. This makes
// the rendered page itself the editing surface — click a block, it opens where it sits, close
// it and the page is a page again.
//
// It is LOCKED by default and that is deliberate. A preview is also the thing you show
// somebody, and a preview whose paragraphs open when you click them is not a preview. The
// padlock is the whole interaction: locked, this is exactly what the reader gets; unlocked,
// every block grows an edit affordance and a place to insert after it.
//
// The document is never re-serialised as a whole. splitBlocks/joinBlocks is the same lossless
// block model the visual canvas uses: one block's text is replaced and the rest come back
// byte-identical, so opening a block you do not change cannot rewrite the document around it.
import { useMemo, useState } from 'react';
import { splitBlocks, joinBlocks, newBlock } from '@bettercommunity/bmd/editor-blocks';

const EN = {
  lock: 'Locked — this is what a reader sees',
  unlock: 'Edit on the page',
  edit: 'Edit this block',
  done: 'Done',
  insert: 'Insert here',
  remove: 'Remove this block',
  empty: 'Nothing yet. Unlock to write something.',
  search: 'Search blocks…',
  noMatch: 'No block matches.',
};

export default function BmdLivePreview({
  value = '', onChange, renderer: Markdown = null, lang = 'en',
  snippetGroups = [], labels = null, unlocked: unlockedProp, onUnlockedChange,
}) {
  const T = { ...EN, ...(labels || {}) };
  // Controlled when the host wants the padlock in its own toolbar, uncontrolled otherwise.
  const [ownUnlocked, setOwnUnlocked] = useState(false);
  const unlocked = unlockedProp == null ? ownUnlocked : unlockedProp;
  const setUnlocked = (v) => { if (unlockedProp == null) setOwnUnlocked(v); onUnlockedChange?.(v); };

  const [editing, setEditing] = useState(null);   // block index open for editing
  const [addAt, setAddAt] = useState(null);       // index the palette is open at
  const [q, setQ] = useState('');

  const blocks = useMemo(() => splitBlocks(value || ''), [value]);
  const emit = (next) => onChange?.(joinBlocks(next));

  // Keep the block's own trailing newline(s) when replacing its text.
  //
  // A block's src carries the blank line that separates it from the next one — a paragraph
  // block is stored as "First paragraph.\n". The textarea shows only the text, so writing its
  // value straight back drops that separator; and between two PARAGRAPHS, which have no fence
  // to delimit them, the two then merge into ONE block. Fixing a typo in the first paragraph
  // of a page silently swallowed the second one into it. Verified: naive replace → 1 block,
  // this → 2.
  const setBlock = (i, src) => emit(blocks.map((b, n) => {
    if (n !== i) return b;
    const tail = (b.src.match(/\n*$/) || [''])[0];
    return { ...b, src: String(src).replace(/\n*$/, '') + tail };
  }));
  const removeBlock = (i) => { emit(blocks.filter((_, n) => n !== i)); setEditing(null); };
  const insertAt = (i, src) => {
    const next = [...blocks];
    // …and a blank block after it. joinBlocks joins with a single newline and the blank lines
    // between blocks ARE blocks, so a block inserted on its own merges with the one below it.
    next.splice(i, 0, newBlock('paragraph', src), newBlock('blank', ''));
    emit(next);
    setAddAt(null); setQ('');
    // Open what was just inserted: a snippet is a skeleton with placeholder words in it, and
    // dropping it in and walking away is how a page ends up saying "Title".
    setEditing(i);
  };

  const ql = q.trim().toLowerCase();
  const groups = (snippetGroups || [])
    .map((g) => ({ ...g, items: (g.items || []).filter((it) => !ql || String(it.label || '').toLowerCase().includes(ql)) }))
    .filter((g) => g.items.length);

  const Palette = ({ i }) => (
    <div className="bmdlp-palette">
      <input autoFocus className="bmdlp-search" placeholder={T.search} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="bmdlp-palette-list">
        {groups.map((g) => (
          <div key={g.label} className="bmdlp-group">
            <div className="bmdlp-group-label">{g.label}</div>
            {g.items.map((it) => (
              <button key={it.id} type="button" className="bmdlp-snippet"
                onClick={() => insertAt(i, String(it.md || '').replace(/\$\{cursor\}/g, '').replace(/\$\{sel\|([^}]*)\}/g, '$1'))}>
                {it.label}
              </button>
            ))}
          </div>
        ))}
        {!groups.length && <div className="bmdlp-empty">{T.noMatch}</div>}
      </div>
    </div>
  );

  const Divider = ({ i }) => (
    <div className="bmdlp-divider">
      <button type="button" className="bmdlp-insert" onClick={() => { setAddAt(addAt === i ? null : i); setQ(''); }} title={T.insert}>+</button>
      {addAt === i && <Palette i={i} />}
    </div>
  );

  return (
    <div className={`bmdlp${unlocked ? ' is-unlocked' : ''}`}>
      {unlockedProp == null && (
        <div className="bmdlp-bar">
          <button type="button" className={`bmdlp-lock${unlocked ? ' is-on' : ''}`} onClick={() => { setUnlocked(!unlocked); setEditing(null); setAddAt(null); }}>
            {unlocked ? T.unlock : T.lock}
          </button>
        </div>
      )}

      {unlocked && <Divider i={0} />}

      {blocks.map((b, i) => (
        <div key={b.id} className="bmdlp-block">
          {editing === i ? (
            <div className="bmdlp-edit">
              <textarea
                className="bmdlp-ta"
                autoFocus
                value={b.src}
                rows={Math.min(20, Math.max(3, b.src.split('\n').length + 1))}
                onChange={(e) => setBlock(i, e.target.value)}
                // Escape closes without touching the text — the change is already applied on
                // every keystroke, so there is nothing to cancel and pretending otherwise
                // would be a lie about what the button does.
                onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setEditing(null); } }}
              />
              <div className="bmdlp-edit-bar">
                <button type="button" className="bmdlp-btn" onClick={() => setEditing(null)}>{T.done}</button>
                <button type="button" className="bmdlp-btn bmdlp-btn-del" onClick={() => removeBlock(i)}>{T.remove}</button>
              </div>
            </div>
          ) : (
            <>
              <div className="bmdlp-rendered" onDoubleClick={() => unlocked && setEditing(i)}>
                {Markdown ? <Markdown lang={lang}>{b.src}</Markdown> : <pre>{b.src}</pre>}
              </div>
              {unlocked && (
                <button type="button" className="bmdlp-edit-btn" onClick={() => setEditing(i)} title={T.edit}>✎</button>
              )}
            </>
          )}
          {unlocked && <Divider i={i + 1} />}
        </div>
      ))}

      {!blocks.length && <div className="bmdlp-none">{T.empty}</div>}
    </div>
  );
}
