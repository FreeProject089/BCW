import { useEffect, useRef, useState } from 'react';
import {
  GripVertical, Trash2, Plus, Heading as HeadingIcon, Type, TagIcon, LayoutGrid, ImagePlus,
  Code2, Quote, Minus, ChevronDown, ChevronUp, Table as TableIcon, X, FileDown, ListOrdered,
  AlignLeft, AlignCenter, AlignRight, Tags as TagsIcon, Milestone, Columns2,
  Eye, MousePointerClick, Sigma, PlayCircle, Clock, Search,
} from 'lucide-react';
import { Input, Select } from '../ui/ui.jsx';
import { useI18n } from '../i18n.jsx';
import IconPicker from './icon-picker.jsx';
import Markdown, { IconGlyph } from '../ui/md.jsx';
import SelectionToolbar from './selection-toolbar.jsx';
import { uid, blank, parse, serialize, blockMd, CALLOUT_KINDS } from './md-blocks.js';
import { SNIPPET_GROUPS, expandSnippet } from '@bettercommunity/bmd-editor';

// Small "pick an icon" field: shows the chosen glyph + name, opens the picker.
function IconField({ value, onChange, placeholder = 'Pick icon' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-sm text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--line-strong)]">
        {value ? <IconGlyph name={value} size={15} /> : null}
        <span>{value || placeholder}</span>
      </button>
      {open && <IconPicker onPick={(n) => onChange(n)} onClose={() => setOpen(false)} />}
    </>
  );
}

// ── Visual (drag-and-drop) post/doc composer ──────────────────────────────────
// A "simple but complete" block editor that is the second authoring mode next to
// raw Markdown. It parses the markdown into blocks, lets you add/edit/reorder
// (drag handle) / delete them, and serialises straight back to the same
// markdown + doc-directive syntax the renderer understands — so the two modes are
// interchangeable at any time.

const BLOCK_TYPES = [
  { type: 'text', label: 'Text', icon: Type },
  { type: 'heading', label: 'Heading', icon: HeadingIcon },
  { type: 'callout', label: 'Callout', icon: TagIcon },
  { type: 'card', label: 'Card', icon: LayoutGrid },
  { type: 'cards', label: 'Card grid', icon: LayoutGrid },
  { type: 'tabs', label: 'Tabs', icon: Columns2 },
  { type: 'buttons', label: 'Buttons', icon: MousePointerClick },
  { type: 'image', label: 'Image', icon: ImagePlus },
  { type: 'code', label: 'Code', icon: Code2 },
  { type: 'quote', label: 'Quote', icon: Quote },
  { type: 'table', label: 'Table', icon: TableIcon },
  { type: 'tags', label: 'Tags', icon: TagsIcon },
  { type: 'file', label: 'File', icon: FileDown },
  { type: 'collapsible', label: 'Collapsible', icon: ChevronDown },
  { type: 'steps', label: 'Steps', icon: ListOrdered },
  { type: 'roadmap', label: 'Roadmap', icon: Milestone },
  { type: 'columns', label: 'Columns', icon: Columns2 },
  { type: 'align', label: 'Align', icon: AlignCenter },
  { type: 'math', label: 'Maths', icon: Sigma },
  { type: 'schedule', label: 'Opening hours', icon: Clock },
  { type: 'replay', label: 'Session replay', icon: PlayCircle },
  { type: 'divider', label: 'Divider', icon: Minus },
];

export default function VisualEditor({ value, onChange, minHeight = 300 }) {
  const { t } = useI18n();
  const [blocks, setBlocks] = useState(() => parse(value));
  const lastOut = useRef(serialize(blocks));
  const [addOpen, setAddOpen] = useState(false); // false | true (append) | index (insert after)
  const [addQ, setAddQ] = useState('');
  // Which blocks are showing their preview, by id. Per block rather than one switch for
  // the page: you check the callout you are writing, not all twenty at once.
  const [peek, setPeek] = useState({});
  const dragId = useRef(null);

  // Re-parse only when the incoming value was changed *externally* (not by us).
  useEffect(() => {
    if ((value || '') !== lastOut.current) { const b = parse(value); setBlocks(b); lastOut.current = serialize(b); }
    // eslint-disable-next-line
  }, [value]);

  const push = (next) => { setBlocks(next); const md = serialize(next); lastOut.current = md; onChange(md); };
  const update = (id, patch) => push(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const remove = (id) => push(blocks.filter((b) => b.id !== id));
  // Where a new block lands: after the block whose "+" was pressed, else at the end.
  const place = (b) => { const at = typeof addOpen === 'number' ? addOpen + 1 : blocks.length; const n = [...blocks]; n.splice(at, 0, b); push(n); setAddOpen(false); setAddQ(''); };
  const add = (type) => place(blank(type));
  // Any B.MD block the package's menu knows — inserted as its markdown, so the whole 3.0
  // vocabulary is one click away here too. It lands as a text block with its preview open,
  // which is what "raw directive, editable, visible" looks like in this editor.
  const addSnippet = (it) => { const { text } = expandSnippet(it.md, ''); const b = { id: uid(), type: 'text', text }; place(b); setPeek((pk) => ({ ...pk, [b.id]: true })); };
  const aq = addQ.trim().toLowerCase();
  const typeMatches = BLOCK_TYPES.filter((bt) => !aq || bt.label.toLowerCase().includes(aq) || bt.type.includes(aq));
  const snippetGroups = SNIPPET_GROUPS.map((g) => ({ ...g, items: g.items.filter((it) => it.md && !it.inline && (!aq || it.label.toLowerCase().includes(aq) || it.id.includes(aq))) })).filter((g) => g.items.length);
  const typeLabel = (b) => { if (b.type === 'text' && /^\s*:{2,4}[a-z]/.test(b.text || '')) { const m = (b.text || '').match(/:{2,4}([a-z0-9-]+)/); return `B.MD · ${m ? m[1] : 'block'}`; } return (BLOCK_TYPES.find((x) => x.type === b.type) || {}).label || b.type; };
  const move = (from, to) => { if (to < 0 || to >= blocks.length || from === to) return; const n = [...blocks]; const [x] = n.splice(from, 1); n.splice(to, 0, x); push(n); };
  const onDrop = (id) => { const from = blocks.findIndex((b) => b.id === dragId.current); const to = blocks.findIndex((b) => b.id === id); if (from >= 0 && to >= 0) move(from, to); dragId.current = null; };

  return (
    <div className="p-3 space-y-2.5" style={{ minHeight }}>
      {blocks.map((b, idx) => (
        <div key={b.id} draggable onDragStart={() => { dragId.current = b.id; }} onDragOver={(e) => e.preventDefault()} onDrop={() => onDrop(b.id)}
          className="group rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-2.5 flex gap-2">
          <div className="flex flex-col items-center gap-1 pt-1 text-[var(--faint)]">
            <span className="cursor-grab active:cursor-grabbing" title={t('ve.dragReorder', 'Drag to reorder')}><GripVertical size={15} /></span>
            <button type="button" className="hover:text-[var(--text)] disabled:opacity-30" disabled={idx === 0} onClick={() => move(idx, idx - 1)}><ChevronUp size={13} /></button>
            <button type="button" className="hover:text-[var(--text)] disabled:opacity-30" disabled={idx === blocks.length - 1} onClick={() => move(idx, idx + 1)}><ChevronDown size={13} /></button>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--faint)]">{typeLabel(b)}</span>
              <button type="button" onClick={() => { setAddOpen(idx); setAddQ(''); }} className="ms-auto text-[11px] text-[var(--faint)] hover:text-[var(--primary-2)] inline-flex items-center gap-1" title={t('ve.addHere', 'Add a block after this one')}><Plus size={11} /> {t('ve.here', 'here')}</button>
            </div>
            <BlockFields block={b} onChange={(patch) => update(b.id, patch)} />
            {/* What this block will look like, from the SAME serialiser that writes the
                document. A preview built any other way is a second renderer, and the day the
                two disagree the wrong one is the one on screen.

                Off by default and remembered per block: a page of twenty blocks all rendering
                live is a lot of work for a document somebody is halfway through typing. */}
            {peek[b.id] && (
              <div className="mt-2 rounded-lg border border-dashed border-[var(--line)] p-2 bg-[var(--surface)]">
                <Markdown>{blockMd(b) || ''}</Markdown>
              </div>
            )}
          </div>
          <div className="flex flex-col items-center gap-1 self-start pt-1">
            <button type="button" className={`hover:text-[var(--text)] ${peek[b.id] ? 'text-[var(--primary)]' : 'text-[var(--faint)]'}`}
              title={t('ve.peek', 'Show what this block looks like')}
              onClick={() => setPeek((p) => ({ ...p, [b.id]: !p[b.id] }))}><Eye size={15} /></button>
            <button type="button" className="text-[var(--faint)] hover:text-error" title={t('ve.delete', "Delete")} onClick={() => remove(b.id)}><Trash2 size={15} /></button>
            <div className="flex flex-col gap-0.5 mt-1">
              {[['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight]].map(([a, Ico]) => (
                <button key={a} type="button" title={`Align ${a}`} onClick={() => update(b.id, { align: b.align === a ? undefined : a })}
                  className={`p-0.5 rounded ${b.align === a ? 'text-[var(--primary)] bg-[var(--surface)]' : 'text-[var(--faint)] hover:text-[var(--text)]'}`}><Ico size={12} /></button>
              ))}
            </div>
          </div>
        </div>
      ))}
      <button type="button" onClick={() => { setAddOpen(true); setAddQ(''); }} className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border border-dashed border-[var(--line)] text-sm text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--line-strong)]">
        <Plus size={15} /> Add block
      </button>
      {addOpen !== false && (
        <div className="fixed inset-0 z-[70] grid place-items-center p-4" style={{ background: 'rgba(4,5,8,0.55)', backdropFilter: 'blur(3px)' }} onClick={() => setAddOpen(false)}>
          <div className="card modal-card w-full max-w-2xl p-0 overflow-hidden anim-pop max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 px-5 py-3.5 border-b border-[var(--line)]">
              <span className="font-semibold text-[15px]">{t('ve.addBlock', 'Add a block')}</span>
              <div className="relative ms-auto w-44 sm:w-60">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--faint)] pointer-events-none" />
                <input autoFocus value={addQ} onChange={(e) => setAddQ(e.target.value)} placeholder={t('ve.search', 'Search a block…')} className="w-full text-sm ps-8 pe-2.5 py-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] outline-none focus:border-[var(--primary)]" />
              </div>
              <button onClick={() => setAddOpen(false)} className="text-[var(--faint)] hover:text-[var(--text)] shrink-0"><X size={16} /></button></div>
            <div className="p-4 overflow-auto">
              {typeMatches.length > 0 && <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--faint)] px-0.5 mb-2">{t('ve.grp.forms', 'With a form')}</div>}
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-4">
                {typeMatches.map((bt) => (
                  <button key={bt.type} type="button" onClick={() => add(bt.type)} className="group flex flex-col items-center gap-2 px-2 py-3 rounded-xl border border-[var(--line)] hover:border-[var(--primary)] hover:bg-[var(--surface-2)] hover:-translate-y-0.5 transition-all text-xs text-center">
                    <span className="grid place-items-center w-9 h-9 rounded-lg bg-[var(--surface-2)] group-hover:bg-[var(--primary)]/10 transition-colors"><bt.icon size={17} className="text-[var(--muted)] group-hover:text-[var(--primary-2)] transition-colors" /></span>
                    <span className="leading-tight">{bt.label}</span>
                  </button>
                ))}
              </div>
              {snippetGroups.map((g) => (
                <div key={g.id} className="mb-3">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--faint)] px-0.5 mb-1.5">{g.label} <span className="normal-case font-normal">· B.MD</span></div>
                  <div className="flex flex-wrap gap-1.5">
                    {g.items.map((it) => <button key={it.id} type="button" onClick={() => addSnippet(it)} className="text-xs px-2.5 py-1 rounded-lg border border-[var(--line)] hover:border-[var(--primary)] hover:bg-[var(--surface-2)] transition-colors">{it.label}</button>)}
                  </div>
                </div>
              ))}
              {!typeMatches.length && !snippetGroups.length && <div className="text-sm text-[var(--faint)] p-3">—</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * A markdown field with the select-to-format toolbar on it.
 *
 * The toolbar has existed the whole time — bold, italic, strike, code, a colour span, a link,
 * an anchor, an inline comment — and was mounted on ONE textarea: the raw Markdown tab. So the
 * tab called "Visual" was the one where you had to type `**bold**` and `[text](url)` by hand,
 * which is the wrong way round and is why it reads as half-finished.
 *
 * A ref per field, because the toolbar positions itself against a specific textarea's caret.
 * One component so every markdown-bearing block gets it by construction rather than by
 * somebody remembering to add it to the next one.
 */
function MdField({ value, onChange, rows = 3, placeholder, className }) {
  const ref = useRef(null);
  return (
    <div className="relative">
      <textarea ref={ref} className={className} rows={rows} value={value || ''}
        onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      <SelectionToolbar taRef={ref} value={value || ''} onChange={onChange} />
    </div>
  );
}

function BlockFields({ block: b, onChange }) {
  const { t } = useI18n();
  const ta = 'w-full bg-transparent border border-[var(--line)] rounded-lg p-2 text-sm outline-none focus:border-[var(--line-strong)] resize-y';
  const tag = (label) => <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--faint)] mb-1">{label}</div>;
  switch (b.type) {
    case 'heading': return (
      <div className="flex gap-2 items-center">
        <Select className="!w-auto !py-1.5 !text-sm" value={b.level} onChange={(e) => onChange({ level: Number(e.target.value) })}>
          <option value={2}>H2</option><option value={3}>H3</option>
        </Select>
        <Input value={b.text} onChange={(e) => onChange({ text: e.target.value })} placeholder={t('ve.ph.heading', "Heading")} className="!py-1.5 !text-base !font-semibold" />
      </div>
    );
    case 'text': return <MdField className={ta} rows={3} value={b.text} onChange={(v) => onChange({ text: v })} placeholder={t('ve.ph.md', "Select any words to format them \u2014 or write markdown")} />;
    case 'quote': return <MdField className={ta} rows={2} value={b.text} onChange={(v) => onChange({ text: v })} placeholder={t('ve.ph.quote', "Quote\u2026")} />;
    case 'callout': return (
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <div><Select className="!w-auto !py-1.5 !text-sm" value={b.kind} onChange={(e) => onChange({ kind: e.target.value })}>{CALLOUT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</Select></div>
          <Input value={b.title} onChange={(e) => onChange({ title: e.target.value })} placeholder={t('ve.ph.title', "Title")} className="!py-1.5 !text-sm flex-1 min-w-[120px]" />
          <IconField value={b.icon} onChange={(v) => onChange({ icon: v })} />
          <input type="color" value={b.color || '#7c3aed'} onChange={(e) => onChange({ color: e.target.value })} title={t('ve.customcolour', "Custom colour")} className="w-9 h-9 rounded-lg border border-[var(--line)] bg-transparent p-0.5" />
        </div>
        <MdField className={ta} rows={2} value={b.text} onChange={(v) => onChange({ text: v })} placeholder={t('ve.ph.callout', "Callout body \u2014 select to format")} />
      </div>
    );
    case 'card': return (
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <Input value={b.title} onChange={(e) => onChange({ title: e.target.value })} placeholder={t('ve.ph.cardtitle', "Card title")} className="!py-1.5 !text-sm flex-1 min-w-[120px]" />
          <IconField value={b.icon} onChange={(v) => onChange({ icon: v })} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Input value={b.href} onChange={(e) => onChange({ href: e.target.value })} placeholder={t('ve.ph.linkurl', "Link URL (optional)")} className="!py-1.5 !text-sm flex-1 min-w-[120px]" />
          <Input value={b.image} onChange={(e) => onChange({ image: e.target.value })} placeholder={t('ve.ph.imgurlopt', "Image URL (optional)")} className="!py-1.5 !text-sm flex-1 min-w-[120px]" />
        </div>
        <MdField className={ta} rows={2} value={b.text} onChange={(v) => onChange({ text: v })} placeholder={t('ve.ph.carddesc', "Card description \u2014 select to format")} />
      </div>
    );
    case 'image': return (
      <div className="flex flex-wrap gap-2">
        <Input value={b.url} onChange={(e) => onChange({ url: e.target.value })} placeholder={t('ve.ph.imgurl', "Image URL")} className="!py-1.5 !text-sm flex-1 min-w-[140px]" />
        <Input value={b.alt} onChange={(e) => onChange({ alt: e.target.value })} placeholder={t('ve.ph.alt', "Alt text")} className="!py-1.5 !text-sm !w-40" />
      </div>
    );
    case 'code': return (
      <div className="space-y-2">
        <Input value={b.lang} onChange={(e) => onChange({ lang: e.target.value })} placeholder="language (js, ts, bash…)" className="!py-1.5 !text-sm !w-48" />
        <textarea className={`${ta} font-mono`} rows={4} value={b.code} onChange={(e) => onChange({ code: e.target.value })} placeholder="code…" spellCheck={false} />
      </div>
    );
    case 'collapsible': return (
      <div className="space-y-2">
        <Input value={b.summary} onChange={(e) => onChange({ summary: e.target.value })} placeholder={t('ve.ph.summary', "Summary (click-to-expand label)")} className="!py-1.5 !text-sm" />
        <MdField className={ta} rows={2} value={b.text} onChange={(v) => onChange({ text: v })} placeholder={t('ve.ph.hidden', "Hidden content (markdown)\u2026")} />
      </div>
    );
    case 'tabs': {
      const tabs = b.tabs?.length ? b.tabs : [{ title: '', text: '' }];
      const setTab = (i, patch) => onChange({ tabs: tabs.map((tb, j) => (i === j ? { ...tb, ...patch } : tb)) });
      return (
        <div className="space-y-2">
          {tabs.map((tb, i) => (
            <div key={i} className="rounded-lg border border-[var(--line)] p-2 space-y-1.5">
              <div className="flex gap-2">
                <Input value={tb.title} onChange={(e) => setTab(i, { title: e.target.value })} placeholder={`${t('ve.tabtitle', 'Tab title')} ${i + 1}`} className="!py-1.5 !text-sm" />
                <button type="button" className="btn btn-sm" title={t('ve.remove', 'Remove')} onClick={() => onChange({ tabs: tabs.filter((_, j) => j !== i) })}><Minus size={13} /></button>
              </div>
              {/* A tab panel holds whatever a document holds \u2014 that is the point of tabs. */}
              <MdField className={ta} rows={3} value={tb.text} onChange={(v) => setTab(i, { text: v })} placeholder={t('ve.ph.tabbody', 'Panel content \u2014 markdown, code, callouts\u2026')} />
            </div>
          ))}
          <button type="button" className="btn btn-sm" onClick={() => onChange({ tabs: [...tabs, { title: '', text: '' }] })}>+ {t('ve.tab', 'Tab')}</button>
        </div>
      );
    }
    case 'cards': {
      const cards = b.cards?.length ? b.cards : [{ title: '', text: '' }];
      const setCard = (i, patch) => onChange({ cards: cards.map((cd, j) => (i === j ? { ...cd, ...patch } : cd)) });
      return (
        <div className="space-y-2">
          {cards.map((cd, i) => (
            <div key={i} className="rounded-lg border border-[var(--line)] p-2 space-y-1.5">
              <div className="flex flex-wrap gap-2">
                <Input value={cd.title} onChange={(e) => setCard(i, { title: e.target.value })} placeholder={t('ve.cardtitle', 'Card title')} className="!py-1.5 !text-sm flex-1 min-w-[120px]" />
                <IconField value={cd.icon} onChange={(v) => setCard(i, { icon: v })} />
                <input type="color" value={cd.color || '#f97316'} onChange={(e) => setCard(i, { color: e.target.value })} title={t('ve.cardaccent', 'Accent')} className="w-9 h-9 rounded-lg border border-[var(--line)] bg-transparent p-0.5 shrink-0" />
                <button type="button" className="btn btn-sm" title={t('ve.remove', 'Remove')} onClick={() => onChange({ cards: cards.filter((_, j) => j !== i) })}><Minus size={13} /></button>
              </div>
              <div className="flex flex-wrap gap-2">
                <Input value={cd.href} onChange={(e) => setCard(i, { href: e.target.value })} placeholder={t('ve.cardhref', 'Link (optional)')} className="!py-1.5 !text-sm flex-1 min-w-[120px]" />
                <Input value={cd.image} onChange={(e) => setCard(i, { image: e.target.value })} placeholder={t('ve.cardimage', 'Image URL (optional)')} className="!py-1.5 !text-sm flex-1 min-w-[120px]" />
              </div>
              <MdField className={ta} rows={2} value={cd.text} onChange={(v) => setCard(i, { text: v })} placeholder={t('ve.ph.carddesc', 'Card description \u2014 select to format')} />
            </div>
          ))}
          <button type="button" className="btn btn-sm" onClick={() => onChange({ cards: [...cards, { title: '', text: '' }] })}>+ {t('ve.card', 'Card')}</button>
        </div>
      );
    }
    case 'buttons': {
      const items = b.items?.length ? b.items : [{ label: '', href: '' }];
      const setItem = (i, patch) => onChange({ items: items.map((it, j) => (i === j ? { ...it, ...patch } : it)) });
      return (
        <div className="space-y-2">
          {items.map((it, i) => (
            <div key={i} className="flex flex-wrap gap-2 items-center">
              <Input value={it.label} onChange={(e) => setItem(i, { label: e.target.value })} placeholder={t('ve.btnlabel', 'Label')} className="!py-1.5 !text-sm flex-1 min-w-[110px]" />
              <Input value={it.href} onChange={(e) => setItem(i, { href: e.target.value })} placeholder={t('ve.btnhref', 'Link')} className="!py-1.5 !text-sm flex-1 min-w-[110px]" />
              {/* A brand sets the colour AND the logo together \u2014 a YouTube-red button with a
                  Discord glyph is a mistake nobody makes on purpose. Picking one greys out the
                  colour field for the same reason. */}
              <select value={it.brand || ''} onChange={(e) => setItem(i, { brand: e.target.value })} className="!py-1.5 !text-sm rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2">
                <option value="">{t('ve.btnnobrand', 'No brand')}</option>
                {['youtube', 'discord', 'kofi', 'github', 'twitch', 'x', 'reddit', 'telegram'].map((br) => <option key={br} value={br}>{br}</option>)}
              </select>
              <input type="color" value={it.color || '#f97316'} disabled={!!it.brand} onChange={(e) => setItem(i, { color: e.target.value })} title={t('ve.btncolour', 'Colour')} className="w-9 h-9 rounded-lg border border-[var(--line)] bg-transparent p-0.5 shrink-0 disabled:opacity-40" />
              <select value={it.size || 'md'} onChange={(e) => setItem(i, { size: e.target.value })} className="!py-1.5 !text-sm rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2">
                <option value="sm">S</option><option value="md">M</option><option value="lg">L</option>
              </select>
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={!!it.outline} onChange={(e) => setItem(i, { outline: e.target.checked })} />{t('ve.btnoutline', 'Outline')}</label>
              <button type="button" className="btn btn-sm" title={t('ve.remove', 'Remove')} onClick={() => onChange({ items: items.filter((_, j) => j !== i) })}><Minus size={13} /></button>
            </div>
          ))}
          <button type="button" className="btn btn-sm" onClick={() => onChange({ items: [...items, { label: '', href: '', size: 'md' }] })}>+ {t('ve.button', 'Button')}</button>
        </div>
      );
    }
    case 'math': return (
      <Input value={b.tex} onChange={(e) => onChange({ tex: e.target.value })} placeholder="E = mc^2" className="!py-1.5 !text-sm !font-mono" />
    );
    case 'replay': return (
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <Input value={b.src} onChange={(e) => onChange({ src: e.target.value })} placeholder="/api/assets/demo.bmmreplay" className="!py-1.5 !text-sm flex-1 min-w-[160px]" />
          <Input value={b.title} onChange={(e) => onChange({ title: e.target.value })} placeholder={t('ve.replaytitle', 'Title (optional)')} className="!py-1.5 !text-sm flex-1 min-w-[120px]" />
        </div>
        <div className="flex gap-3 text-xs">
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!b.autoplay} onChange={(e) => onChange({ autoplay: e.target.checked })} />{t('ve.autoplay', 'Autoplay')}</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!b.loop} onChange={(e) => onChange({ loop: e.target.checked })} />{t('ve.loop', 'Loop')}</label>
        </div>
      </div>
    );
    case 'steps': {
      const steps = b.steps?.length ? b.steps : [{ title: '', text: '' }];
      const setStep = (i, patch) => onChange({ steps: steps.map((st, j) => (i === j ? { ...st, ...patch } : st)) });
      return (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Input value={b.title} onChange={(e) => onChange({ title: e.target.value })} placeholder={t('ve.ph.blocktitle', "Block title (optional)")} className="!py-1.5 !text-sm flex-1 min-w-[140px]" />
            <select value={b.marker || '1'} onChange={(e) => onChange({ marker: e.target.value })} className="!py-1.5 !text-sm rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2">
              <option value="1">1, 2, 3</option><option value="a">A, B, C</option><option value="i">i, ii, iii</option><option value="dot">•</option>
            </select>
            <select value={b.orientation || 'vertical'} onChange={(e) => onChange({ orientation: e.target.value })} className="!py-1.5 !text-sm rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2">
              <option value="vertical">Vertical</option><option value="horizontal">Horizontal</option>
            </select>
            <input type="color" value={b.color || '#f97316'} onChange={(e) => onChange({ color: e.target.value })} title={t('ve.markercolour', "Marker colour")} className="w-9 h-9 rounded-lg border border-[var(--line)] bg-transparent p-0.5" />
          </div>
          {steps.map((st, i) => (
            <div key={i} className="rounded-lg border border-[var(--line)] p-2 space-y-1.5">
              <div className="flex gap-2">
                <Input value={st.title} onChange={(e) => setStep(i, { title: e.target.value })} placeholder={`Step ${i + 1} title`} className="!py-1.5 !text-sm" />
                {/* Per step, not just per list. The renderer has read `status`, `icon` and
                    `color` off a single step all along; a procedure where one step is the
                    destructive one wants to say so on that step. */}
                <select
                  value={st.status || ''} onChange={(e) => setStep(i, { status: e.target.value })}
                  title={t('ve.stepstatus', 'Status')}
                  className="!py-1.5 !text-sm rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2"
                >
                  <option value="">{t('ve.status.none', '\u2014')}</option>
                  <option value="done">{t('ve.status.done', 'Done')}</option>
                </select>
                <input
                  type="color" value={st.color || b.color || '#f97316'}
                  onChange={(e) => setStep(i, { color: e.target.value })}
                  title={t('ve.stepcolour', 'This step\u2019s colour')}
                  className="w-9 h-9 rounded-lg border border-[var(--line)] bg-transparent p-0.5 shrink-0"
                />
                <button type="button" className="btn btn-sm" title={t('ve.remove', "Remove")} onClick={() => onChange({ steps: steps.filter((_, j) => j !== i) })}><Minus size={13} /></button>
              </div>
              <MdField className={ta} rows={2} value={st.text} onChange={(v) => setStep(i, { text: v })} placeholder={t('ve.ph.stepbody', "Step body (markdown, callouts, code\u2026)")} />
            </div>
          ))}
          <button type="button" className="btn btn-sm" onClick={() => onChange({ steps: [...steps, { title: '', text: '' }] })}>+ Step</button>
        </div>
      );
    }
    case 'roadmap': return (
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <Input value={b.title} onChange={(e) => onChange({ title: e.target.value })} placeholder={t('ve.ph.roadmap', "Roadmap title")} className="!py-1.5 !text-sm flex-1 min-w-[140px]" />
          <select value={b.orientation || 'vertical'} onChange={(e) => onChange({ orientation: e.target.value })} className="!py-1.5 !text-sm rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2">
            <option value="vertical">Vertical</option><option value="horizontal">Horizontal</option>
          </select>
        </div>
        <textarea className={`${ta} font-mono`} rows={7} value={b.json} onChange={(e) => onChange({ json: e.target.value })} placeholder='{"categories":[…]}' spellCheck={false} />
        <div className="text-[11px] text-[var(--muted)]">Statuses: <code>done</code> · <code>progress</code> · <code>planned</code>. Optional <code>percent</code>, <code>eta</code>.</div>
      </div>
    );
    case 'columns': return (
      <div className="grid sm:grid-cols-2 gap-2">
        <MdField className={ta} rows={3} value={b.left} onChange={(v) => onChange({ left: v })} placeholder={t('ve.ph.left', "Left column (markdown)\u2026")} />
        <MdField className={ta} rows={3} value={b.right} onChange={(v) => onChange({ right: v })} placeholder={t('ve.ph.right', "Right column (markdown)\u2026")} />
      </div>
    );
    case 'align': return (
      <div className="space-y-2">
        <select value={b.align || 'center'} onChange={(e) => onChange({ align: e.target.value })} className="!py-1.5 !text-sm rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2">
          <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
        </select>
        <MdField className={ta} rows={2} value={b.text} onChange={(v) => onChange({ text: v })} placeholder={t('ve.ph.content', "Content (markdown)\u2026")} />
      </div>
    );
    case 'table': {
      const rows = b.rows && b.rows.length ? b.rows : [['', '']];
      const cols = Math.max(1, ...rows.map((r) => r.length));
      const setCell = (ri, ci, val) => { const nr = rows.map((r) => { const c = [...r]; while (c.length < cols) c.push(''); return c; }); nr[ri][ci] = val; onChange({ rows: nr }); };
      const addRow = () => onChange({ rows: [...rows, new Array(cols).fill('')] });
      const addCol = () => onChange({ rows: rows.map((r) => [...r, '']) });
      const delRow = (ri) => rows.length > 1 && onChange({ rows: rows.filter((_, i) => i !== ri) });
      const delCol = () => cols > 1 && onChange({ rows: rows.map((r) => r.slice(0, cols - 1)) });
      return (
        <div className="space-y-2">
          {tag('Table')}
          <div className="overflow-x-auto"><table className="border-separate" style={{ borderSpacing: 2 }}><tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>
                {Array.from({ length: cols }).map((_, ci) => (
                  <td key={ci}><input value={r[ci] ?? ''} onChange={(e) => setCell(ri, ci, e.target.value)} placeholder={ri === 0 ? 'Header' : ''}
                    className={`w-24 rounded-md border border-[var(--line)] bg-transparent px-1.5 py-1 text-sm outline-none focus:border-[var(--line-strong)] ${ri === 0 ? 'font-semibold' : ''}`} /></td>
                ))}
                <td><button type="button" onClick={() => delRow(ri)} title={t('ve.delrow', "Delete row")} className="text-[var(--faint)] hover:text-error px-0.5"><Minus size={13} /></button></td>
              </tr>
            ))}
          </tbody></table></div>
          <div className="flex flex-wrap gap-3 text-xs">
            <button type="button" onClick={addRow} className="inline-flex items-center gap-1 text-[var(--muted)] hover:text-[var(--text)]"><Plus size={12} /> Row</button>
            <button type="button" onClick={addCol} className="inline-flex items-center gap-1 text-[var(--muted)] hover:text-[var(--text)]"><Plus size={12} /> Column</button>
            <button type="button" onClick={delCol} className="inline-flex items-center gap-1 text-[var(--muted)] hover:text-error"><Minus size={12} /> Column</button>
          </div>
        </div>
      );
    }
    case 'file': return (
      <div className="space-y-2">
        {tag('File')}
        <Input value={b.name} onChange={(e) => onChange({ name: e.target.value })} placeholder={t('ve.ph.filename', "File name (e.g. pack.zip)")} className="!py-1.5 !text-sm" />
        <div className="flex flex-wrap gap-2">
          <Input value={b.href} onChange={(e) => onChange({ href: e.target.value })} placeholder={t('ve.ph.dlurl', "Download URL")} className="!py-1.5 !text-sm flex-1 min-w-[140px]" />
          <Input value={b.size} onChange={(e) => onChange({ size: e.target.value })} placeholder={t('ve.ph.size', "Size (e.g. 10 KB)")} className="!py-1.5 !text-sm !w-32" />
        </div>
      </div>
    );
    case 'tags': {
      const tags = b.tags && b.tags.length ? b.tags : [{ text: '', color: '' }];
      const setTag = (idx, patch) => onChange({ tags: tags.map((tg, i) => (i === idx ? { ...tg, ...patch } : tg)) });
      const addTag = () => onChange({ tags: [...tags, { text: 'Tag', color: '#7c3aed' }] });
      const delTag = (idx) => onChange({ tags: tags.length > 1 ? tags.filter((_, i) => i !== idx) : tags });
      return (
        <div className="space-y-2">
          {tag('Tags')}
          <div className="flex flex-wrap gap-2">
            {tags.map((tg, idx) => (
              <span key={idx} className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] ps-1 pe-1.5 py-0.5"
                style={{ color: tg.color || 'var(--primary)', background: tg.color ? `color-mix(in srgb, ${tg.color} 14%, transparent)` : undefined }}>
                <input type="color" value={tg.color || '#7c3aed'} onChange={(e) => setTag(idx, { color: e.target.value })} title={t('ve.colour', "Colour")} className="w-4 h-4 rounded-full border-0 bg-transparent p-0 cursor-pointer" />
                <input value={tg.text} onChange={(e) => setTag(idx, { text: e.target.value })} placeholder="Tag" className="bg-transparent border-0 outline-none text-xs font-semibold w-16" style={{ color: 'inherit' }} />
                <button type="button" onClick={() => delTag(idx)} className="opacity-60 hover:opacity-100"><X size={11} /></button>
              </span>
            ))}
            <button type="button" onClick={addTag} className="inline-flex items-center gap-1 text-xs text-[var(--muted)] hover:text-[var(--text)] rounded-full border border-dashed border-[var(--line)] px-2 py-0.5"><Plus size={12} /> Tag</button>
          </div>
        </div>
      );
    }
    case 'schedule': {
      // The timezone is the whole point of this block, so it is a real chooser rather than a
      // free-text box that silently accepts "Paris" — a zone the renderer cannot resolve
      // means an offset of zero, which is a wrong number rather than a visible error.
      //
      // A datalist, not a <select>: there are ~420 zones, the list comes from the platform
      // (no bundled table to go stale when a country changes its rules), and typing "Par"
      // gets you there faster than scrolling ever could. Free text still works for anything
      // the browser does not enumerate.
      let zones = [];
      try { zones = Intl.supportedValuesOf('timeZone'); } catch { zones = []; }
      const here = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ''; } })();
      return (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input value={b.title || ''} onChange={(e) => onChange({ title: e.target.value })}
              placeholder={t('ve.ph.schedTitle', 'Card title — Support, Opening hours…')} className="!py-1.5 !text-sm" />
            <Input list="ve-tz-list" value={b.tz || ''} onChange={(e) => onChange({ tz: e.target.value })}
              placeholder={here || 'Europe/Paris'} className="!py-1.5 !text-sm" />
            <datalist id="ve-tz-list">{zones.map((z) => <option key={z} value={z} />)}</datalist>
          </div>
          {/* Said here because it is the one thing about this block that surprises people, and
              the alternative is finding out in March. */}
          <p className="text-[11px] text-[var(--faint)]">
            {t('ve.schedNote', 'Rows are shown exactly as written, in this zone — readers are told how far they are from it. Only :time[…] converts.')}
          </p>
          <MdField className={ta} rows={4} value={b.text} onChange={(v) => onChange({ text: v })}
            placeholder={t('ve.ph.schedRows', 'A table, a list, or a line per day — markdown.')} />
        </div>
      );
    }
    case 'divider': return <div className="text-xs text-[var(--faint)] py-1">— Divider —</div>;
    default: return null;
  }
}
