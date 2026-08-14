import { useEffect, useRef, useState } from 'react';
import {
  GripVertical, Trash2, Plus, Heading as HeadingIcon, Type, TagIcon, LayoutGrid, ImagePlus,
  Code2, Quote, Minus, ChevronDown, ChevronUp, Table as TableIcon, X, FileDown, ListOrdered,
  AlignLeft, AlignCenter, AlignRight, Tags as TagsIcon, Milestone, Columns2,
} from 'lucide-react';
import { Input, Select } from '../ui/ui.jsx';
import IconPicker from './icon-picker.jsx';
import { IconGlyph } from '../ui/md.jsx';

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

let _uid = 0;
const uid = () => `b${Date.now().toString(36)}${_uid++}`;

const BLOCK_TYPES = [
  { type: 'text', label: 'Text', icon: Type },
  { type: 'heading', label: 'Heading', icon: HeadingIcon },
  { type: 'callout', label: 'Callout', icon: TagIcon },
  { type: 'card', label: 'Card', icon: LayoutGrid },
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
  { type: 'divider', label: 'Divider', icon: Minus },
];
const CALLOUT_KINDS = ['note', 'tip', 'success', 'warning', 'danger', 'callout'];

function blank(type) {
  switch (type) {
    case 'heading': return { id: uid(), type, level: 2, text: 'Heading' };
    case 'callout': return { id: uid(), type, kind: 'tip', icon: '', color: '', title: 'Good to know', text: 'Something worth highlighting.' };
    case 'card': return { id: uid(), type, title: 'Card', icon: '', href: '', image: '', text: 'Card description.' };
    case 'image': return { id: uid(), type, url: '', alt: '' };
    case 'code': return { id: uid(), type, lang: 'js', code: 'console.log("hello");' };
    case 'quote': return { id: uid(), type, text: 'Quote' };
    case 'collapsible': return { id: uid(), type, summary: 'Click to expand', text: 'Hidden content.' };
    case 'table': return { id: uid(), type, rows: [['Column 1', 'Column 2'], ['', '']] };
    case 'tags': return { id: uid(), type, tags: [{ text: 'New', color: '#16a34a' }, { text: 'Beta', color: '#2563eb' }] };
    case 'file': return { id: uid(), type, name: 'example.zip', href: '', size: '' };
    case 'steps': return { id: uid(), type, title: 'How it works', marker: '1', color: '', orientation: 'vertical', steps: [{ title: 'First', text: 'What to do.' }, { title: 'Second', text: 'And then this.' }] };
    case 'roadmap': return { id: uid(), type, title: 'Roadmap', orientation: 'vertical', json: '{\n  "categories": [\n    { "name": "v1.0", "items": [\n      { "label": "Core", "status": "done" },\n      { "label": "Docs", "status": "progress", "percent": 40 }\n    ] }\n  ]\n}' };
    case 'columns': return { id: uid(), type, left: 'Left column.', right: 'Right column.' };
    case 'align': return { id: uid(), type, align: 'center', text: 'Centered content.' };
    case 'divider': return { id: uid(), type };
    default: return { id: uid(), type: 'text', text: '' };
  }
}

// ── markdown → blocks (line-based, best-effort) ───────────────────────────────
function parse(md) {
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  const flushText = (buf) => { const t = buf.join('\n').trim(); if (t) blocks.push({ id: uid(), type: 'text', text: t }); };
  let textBuf = [];
  while (i < lines.length) {
    const line = lines[i];
    // fenced code
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      flushText(textBuf); textBuf = [];
      const code = []; i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { code.push(lines[i]); i++; }
      i++; blocks.push({ id: uid(), type: 'code', lang: fence[1] || '', code: code.join('\n') });
      continue;
    }
    // container directive (callout / card / details) — capture to its closing fence.
    // Canonical order is `:::name[label]{attrs}`.
    const dir = line.match(/^(:{3,})([\w-]+)(\[[^\]]*\])?(\{[^}]*\})?\s*$/);
    if (dir) {
      const colons = dir[1]; const name = dir[2].toLowerCase();
      const label = dir[3] ? dir[3].slice(1, -1) : ''; const attrs = parseAttrs(dir[4]);
      const inner = []; i++;
      const close = new RegExp(`^:{${colons.length},}\\s*$`);
      let depth = 1;
      while (i < lines.length) {
        if (new RegExp(`^:{3,}[\\w-]`).test(lines[i])) depth++;
        else if (close.test(lines[i]) || /^:{3,}\s*$/.test(lines[i])) { depth--; if (depth === 0) { i++; break; } }
        inner.push(lines[i]); i++;
      }
      const innerText = inner.join('\n').trim();
      flushText(textBuf); textBuf = [];
      if (name === 'card' || name === 'ref') {
        blocks.push({ id: uid(), type: 'card', title: label || attrs.title || '', icon: attrs.icon || '', href: attrs.href || attrs.link || '', image: attrs.image || '', text: innerText });
      } else if (name === 'details' || name === 'collapse') {
        blocks.push({ id: uid(), type: 'collapsible', summary: label || attrs.title || 'Details', text: innerText });
      } else if (name === 'file') {
        blocks.push({ id: uid(), type: 'file', name: label || attrs.name || 'file', href: attrs.href || attrs.url || '', size: attrs.size || '' });
      } else if (name === 'center' || name === 'left' || name === 'right') {
        // alignment wrapper — apply to the inner block(s)
        const inner = parse(innerText); inner.forEach((bl) => { bl.align = name; blocks.push(bl); });
      } else if (CALLOUT_KINDS.includes(name) || name === 'callout' || ['info', 'hint', 'caution', 'important', 'error', 'check'].includes(name)) {
        blocks.push({ id: uid(), type: 'callout', kind: name, icon: attrs.icon || '', color: attrs.color || '', title: label || attrs.title || '', text: innerText });
      } else {
        // unknown container — keep as raw text so nothing is lost
        blocks.push({ id: uid(), type: 'text', text: innerText });
      }
      continue;
    }
    // GFM table: a `| … |` row followed by a `|---|---|` separator.
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      flushText(textBuf); textBuf = [];
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim().replace(/\\\|/g, '|'));
      const rows = [cells(line)]; i += 2; // skip header + separator
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(cells(lines[i])); i++; }
      blocks.push({ id: uid(), type: 'table', rows });
      continue;
    }
    const h = line.match(/^(#{2,3})\s+(.*)$/);
    if (h) { flushText(textBuf); textBuf = []; blocks.push({ id: uid(), type: 'heading', level: h[1].length, text: h[2].trim() }); i++; continue; }
    if (/^(---|\*\*\*|___)\s*$/.test(line)) { flushText(textBuf); textBuf = []; blocks.push({ id: uid(), type: 'divider' }); i++; continue; }
    const img = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (img) { flushText(textBuf); textBuf = []; blocks.push({ id: uid(), type: 'image', alt: img[1], url: img[2] }); i++; continue; }
    // A line made only of :badge[...] chips → a Tags block.
    if (line.trim() && /^(?::badge\[[^\]]*\](?:\{[^}]*\})?\s*)+$/.test(line.trim())) {
      flushText(textBuf); textBuf = [];
      const tags = []; const re = /:badge\[([^\]]*)\](?:\{([^}]*)\})?/g; let mm;
      while ((mm = re.exec(line))) tags.push({ text: mm[1], color: parseAttrs(mm[2] ? `{${mm[2]}}` : '').color || '' });
      blocks.push({ id: uid(), type: 'tags', tags }); i++; continue;
    }
    if (/^>\s?/.test(line)) {
      flushText(textBuf); textBuf = [];
      const quote = []; while (i < lines.length && /^>\s?/.test(lines[i])) { quote.push(lines[i].replace(/^>\s?/, '')); i++; }
      blocks.push({ id: uid(), type: 'quote', text: quote.join('\n').trim() }); continue;
    }
    if (line.trim() === '') { flushText(textBuf); textBuf = []; i++; continue; }
    textBuf.push(line); i++;
  }
  flushText(textBuf);
  return blocks.length ? blocks : [{ id: uid(), type: 'text', text: '' }];
}

function parseAttrs(s) {
  const out = {};
  if (!s) return out;
  const body = s.slice(1, -1);
  const re = /([\w-]+)=("[^"]*"|'[^']*'|[^\s]+)/g; let m;
  while ((m = re.exec(body))) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  return out;
}

// ── blocks → markdown ─────────────────────────────────────────────────────────
function serialize(blocks) {
  return blocks.map((b) => {
    const md = blockMd(b);
    return (b.align === 'center' || b.align === 'left' || b.align === 'right') ? `:::${b.align}\n${md}\n:::` : md;
  }).join('\n\n');
}
function blockMd(b) {
    switch (b.type) {
      case 'heading': return `${'#'.repeat(b.level || 2)} ${b.text || ''}`;
      case 'callout': {
        const a = [];
        if (b.icon) a.push(`icon=${b.icon}`);
        if (b.color) a.push(`color="${b.color}"`);
        const attr = a.length ? `{${a.join(' ')}}` : '';
        const label = b.title ? `[${b.title}]` : '';
        return `:::${b.kind || 'tip'}${label}${attr}\n${b.text || ''}\n:::`;
      }
      case 'card': {
        const a = [];
        if (b.title) a.push(`title="${b.title}"`);
        if (b.icon) a.push(`icon=${b.icon}`);
        if (b.href) a.push(`href="${b.href}"`);
        if (b.image) a.push(`image="${b.image}"`);
        return `:::card${a.length ? `{${a.join(' ')}}` : ''}\n${b.text || ''}\n:::`;
      }
      case 'image': return `![${b.alt || ''}](${b.url || ''})`;
      case 'code': return `\`\`\`${b.lang || ''}\n${b.code || ''}\n\`\`\``;
      case 'quote': return (b.text || '').split('\n').map((l) => `> ${l}`).join('\n');
      case 'collapsible': return `:::details[${b.summary || 'Details'}]\n${b.text || ''}\n:::`;
      case 'steps': {
        // Four colons outside, three inside — remark-directive matches by colon count, so a
        // `:::` within a `:::` closes the parent. Writing it correctly here is what stops the
        // visual editor producing markdown its own preview cannot render.
        const a = [];
        if (b.marker && b.marker !== '1') a.push(`type=${b.marker}`);
        if (b.color) a.push(`color="${b.color}"`);
        if (b.orientation === 'horizontal') a.push('orientation=horizontal');
        const inner = (b.steps || []).map((st) => `:::step[${st.title || ''}]\n${st.text || ''}\n:::`).join('\n');
        return `::::steps${b.title ? `[${b.title}]` : ''}${a.length ? `{${a.join(' ')}}` : ''}\n${inner}\n::::`;
      }
      case 'roadmap': {
        const a = b.orientation === 'horizontal' ? '{orientation=horizontal}' : '';
        return `:::roadmap${b.title ? `[${b.title}]` : ''}${a}\n\`\`\`json\n${b.json || '{}'}\n\`\`\`\n:::`;
      }
      case 'columns': return `::::columns\n:::column\n${b.left || ''}\n:::\n:::column\n${b.right || ''}\n:::\n::::`;
      case 'align': return `:::${b.align || 'center'}\n${b.text || ''}\n:::`;
      case 'file': {
        const a = [];
        if (b.href) a.push(`href="${b.href}"`);
        if (b.size) a.push(`size="${b.size}"`);
        return `:::file[${b.name || 'file'}]${a.length ? `{${a.join(' ')}}` : ''}\n:::`;
      }
      case 'table': {
        const rows = (b.rows && b.rows.length ? b.rows : [['', '']]).map((r) => r.map((c) => String(c || '').replace(/\|/g, '\\|')));
        const cols = Math.max(1, ...rows.map((r) => r.length));
        const pad = (r) => { const c = [...r]; while (c.length < cols) c.push(''); return c; };
        const head = pad(rows[0]);
        const sep = new Array(cols).fill('---');
        const bodyRows = rows.slice(1).map(pad);
        return [head, sep, ...bodyRows].map((r) => `| ${r.join(' | ')} |`).join('\n');
      }
      case 'tags': return (b.tags && b.tags.length ? b.tags : [{ text: 'Tag', color: '' }])
        .map((tg) => `:badge[${(tg.text || 'Tag').replace(/[[\]]/g, '')}]${tg.color ? `{color="${tg.color}"}` : ''}`).join(' ');
      case 'divider': return '---';
      default: return b.text || '';
    }
}

export default function VisualEditor({ value, onChange, minHeight = 300 }) {
  const [blocks, setBlocks] = useState(() => parse(value));
  const lastOut = useRef(serialize(blocks));
  const [addOpen, setAddOpen] = useState(false);
  const dragId = useRef(null);

  // Re-parse only when the incoming value was changed *externally* (not by us).
  useEffect(() => {
    if ((value || '') !== lastOut.current) { const b = parse(value); setBlocks(b); lastOut.current = serialize(b); }
    // eslint-disable-next-line
  }, [value]);

  const push = (next) => { setBlocks(next); const md = serialize(next); lastOut.current = md; onChange(md); };
  const update = (id, patch) => push(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const remove = (id) => push(blocks.filter((b) => b.id !== id));
  const add = (type) => { push([...blocks, blank(type)]); setAddOpen(false); };
  const move = (from, to) => { if (to < 0 || to >= blocks.length || from === to) return; const n = [...blocks]; const [x] = n.splice(from, 1); n.splice(to, 0, x); push(n); };
  const onDrop = (id) => { const from = blocks.findIndex((b) => b.id === dragId.current); const to = blocks.findIndex((b) => b.id === id); if (from >= 0 && to >= 0) move(from, to); dragId.current = null; };

  return (
    <div className="p-3 space-y-2.5" style={{ minHeight }}>
      {blocks.map((b, idx) => (
        <div key={b.id} draggable onDragStart={() => { dragId.current = b.id; }} onDragOver={(e) => e.preventDefault()} onDrop={() => onDrop(b.id)}
          className="group rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-2.5 flex gap-2">
          <div className="flex flex-col items-center gap-1 pt-1 text-[var(--faint)]">
            <span className="cursor-grab active:cursor-grabbing" title="Drag to reorder"><GripVertical size={15} /></span>
            <button type="button" className="hover:text-[var(--text)] disabled:opacity-30" disabled={idx === 0} onClick={() => move(idx, idx - 1)}><ChevronUp size={13} /></button>
            <button type="button" className="hover:text-[var(--text)] disabled:opacity-30" disabled={idx === blocks.length - 1} onClick={() => move(idx, idx + 1)}><ChevronDown size={13} /></button>
          </div>
          <div className="flex-1 min-w-0"><BlockFields block={b} onChange={(patch) => update(b.id, patch)} /></div>
          <div className="flex flex-col items-center gap-1 self-start pt-1">
            <button type="button" className="text-[var(--faint)] hover:text-error" title="Delete" onClick={() => remove(b.id)}><Trash2 size={15} /></button>
            <div className="flex flex-col gap-0.5 mt-1">
              {[['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight]].map(([a, Ico]) => (
                <button key={a} type="button" title={`Align ${a}`} onClick={() => update(b.id, { align: b.align === a ? undefined : a })}
                  className={`p-0.5 rounded ${b.align === a ? 'text-[var(--primary)] bg-[var(--surface)]' : 'text-[var(--faint)] hover:text-[var(--text)]'}`}><Ico size={12} /></button>
              ))}
            </div>
          </div>
        </div>
      ))}
      <button type="button" onClick={() => setAddOpen(true)} className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border border-dashed border-[var(--line)] text-sm text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--line-strong)]">
        <Plus size={15} /> Add block
      </button>
      {addOpen && (
        <div className="fixed inset-0 z-[70] grid place-items-center p-4" style={{ background: 'rgba(4,5,8,0.55)', backdropFilter: 'blur(3px)' }} onClick={() => setAddOpen(false)}>
          <div className="card modal-card w-full max-w-sm p-0 overflow-hidden anim-pop" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--line)]"><span className="font-semibold">Add a block</span><button onClick={() => setAddOpen(false)} className="text-[var(--faint)] hover:text-[var(--text)]"><X size={16} /></button></div>
            <div className="p-2 grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {BLOCK_TYPES.map((bt) => (
                <button key={bt.type} type="button" onClick={() => add(bt.type)} className="flex flex-col items-center gap-1.5 px-2 py-3 rounded-lg border border-[var(--line)] hover:border-[var(--primary)] hover:bg-[var(--surface-2)] text-sm">
                  <bt.icon size={18} className="text-[var(--muted)]" /> {bt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BlockFields({ block: b, onChange }) {
  const ta = 'w-full bg-transparent border border-[var(--line)] rounded-lg p-2 text-sm outline-none focus:border-[var(--line-strong)] resize-y';
  const tag = (label) => <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--faint)] mb-1">{label}</div>;
  switch (b.type) {
    case 'heading': return (
      <div className="flex gap-2 items-center">
        <Select className="!w-auto !py-1.5 !text-sm" value={b.level} onChange={(e) => onChange({ level: Number(e.target.value) })}>
          <option value={2}>H2</option><option value={3}>H3</option>
        </Select>
        <Input value={b.text} onChange={(e) => onChange({ text: e.target.value })} placeholder="Heading" className="!py-1.5 !text-base !font-semibold" />
      </div>
    );
    case 'text': return <textarea className={ta} rows={3} value={b.text} onChange={(e) => onChange({ text: e.target.value })} placeholder="Write in markdown — **bold**, [links](url), `code`…" />;
    case 'quote': return <><textarea className={ta} rows={2} value={b.text} onChange={(e) => onChange({ text: e.target.value })} placeholder="Quote…" /></>;
    case 'callout': return (
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <div><Select className="!w-auto !py-1.5 !text-sm" value={b.kind} onChange={(e) => onChange({ kind: e.target.value })}>{CALLOUT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</Select></div>
          <Input value={b.title} onChange={(e) => onChange({ title: e.target.value })} placeholder="Title" className="!py-1.5 !text-sm flex-1 min-w-[120px]" />
          <IconField value={b.icon} onChange={(v) => onChange({ icon: v })} />
          <input type="color" value={b.color || '#7c3aed'} onChange={(e) => onChange({ color: e.target.value })} title="Custom colour" className="w-9 h-9 rounded-lg border border-[var(--line)] bg-transparent p-0.5" />
        </div>
        <textarea className={ta} rows={2} value={b.text} onChange={(e) => onChange({ text: e.target.value })} placeholder="Callout body (markdown)…" />
      </div>
    );
    case 'card': return (
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <Input value={b.title} onChange={(e) => onChange({ title: e.target.value })} placeholder="Card title" className="!py-1.5 !text-sm flex-1 min-w-[120px]" />
          <IconField value={b.icon} onChange={(v) => onChange({ icon: v })} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Input value={b.href} onChange={(e) => onChange({ href: e.target.value })} placeholder="Link URL (optional)" className="!py-1.5 !text-sm flex-1 min-w-[120px]" />
          <Input value={b.image} onChange={(e) => onChange({ image: e.target.value })} placeholder="Image URL (optional)" className="!py-1.5 !text-sm flex-1 min-w-[120px]" />
        </div>
        <textarea className={ta} rows={2} value={b.text} onChange={(e) => onChange({ text: e.target.value })} placeholder="Card description…" />
      </div>
    );
    case 'image': return (
      <div className="flex flex-wrap gap-2">
        <Input value={b.url} onChange={(e) => onChange({ url: e.target.value })} placeholder="Image URL" className="!py-1.5 !text-sm flex-1 min-w-[140px]" />
        <Input value={b.alt} onChange={(e) => onChange({ alt: e.target.value })} placeholder="Alt text" className="!py-1.5 !text-sm !w-40" />
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
        <Input value={b.summary} onChange={(e) => onChange({ summary: e.target.value })} placeholder="Summary (click-to-expand label)" className="!py-1.5 !text-sm" />
        <textarea className={ta} rows={2} value={b.text} onChange={(e) => onChange({ text: e.target.value })} placeholder="Hidden content (markdown)…" />
      </div>
    );
    case 'steps': {
      const steps = b.steps?.length ? b.steps : [{ title: '', text: '' }];
      const setStep = (i, patch) => onChange({ steps: steps.map((st, j) => (i === j ? { ...st, ...patch } : st)) });
      return (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Input value={b.title} onChange={(e) => onChange({ title: e.target.value })} placeholder="Block title (optional)" className="!py-1.5 !text-sm flex-1 min-w-[140px]" />
            <select value={b.marker || '1'} onChange={(e) => onChange({ marker: e.target.value })} className="!py-1.5 !text-sm rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2">
              <option value="1">1, 2, 3</option><option value="a">A, B, C</option><option value="i">i, ii, iii</option><option value="dot">•</option>
            </select>
            <select value={b.orientation || 'vertical'} onChange={(e) => onChange({ orientation: e.target.value })} className="!py-1.5 !text-sm rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2">
              <option value="vertical">Vertical</option><option value="horizontal">Horizontal</option>
            </select>
            <input type="color" value={b.color || '#f97316'} onChange={(e) => onChange({ color: e.target.value })} title="Marker colour" className="w-9 h-9 rounded-lg border border-[var(--line)] bg-transparent p-0.5" />
          </div>
          {steps.map((st, i) => (
            <div key={i} className="rounded-lg border border-[var(--line)] p-2 space-y-1.5">
              <div className="flex gap-2">
                <Input value={st.title} onChange={(e) => setStep(i, { title: e.target.value })} placeholder={`Step ${i + 1} title`} className="!py-1.5 !text-sm" />
                <button type="button" className="btn btn-sm" title="Remove" onClick={() => onChange({ steps: steps.filter((_, j) => j !== i) })}><Minus size={13} /></button>
              </div>
              <textarea className={ta} rows={2} value={st.text} onChange={(e) => setStep(i, { text: e.target.value })} placeholder="Step body (markdown, callouts, code…)" />
            </div>
          ))}
          <button type="button" className="btn btn-sm" onClick={() => onChange({ steps: [...steps, { title: '', text: '' }] })}>+ Step</button>
        </div>
      );
    }
    case 'roadmap': return (
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <Input value={b.title} onChange={(e) => onChange({ title: e.target.value })} placeholder="Roadmap title" className="!py-1.5 !text-sm flex-1 min-w-[140px]" />
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
        <textarea className={ta} rows={3} value={b.left} onChange={(e) => onChange({ left: e.target.value })} placeholder="Left column (markdown)…" />
        <textarea className={ta} rows={3} value={b.right} onChange={(e) => onChange({ right: e.target.value })} placeholder="Right column (markdown)…" />
      </div>
    );
    case 'align': return (
      <div className="space-y-2">
        <select value={b.align || 'center'} onChange={(e) => onChange({ align: e.target.value })} className="!py-1.5 !text-sm rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2">
          <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
        </select>
        <textarea className={ta} rows={2} value={b.text} onChange={(e) => onChange({ text: e.target.value })} placeholder="Content (markdown)…" />
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
                <td><button type="button" onClick={() => delRow(ri)} title="Delete row" className="text-[var(--faint)] hover:text-error px-0.5"><Minus size={13} /></button></td>
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
        <Input value={b.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="File name (e.g. pack.zip)" className="!py-1.5 !text-sm" />
        <div className="flex flex-wrap gap-2">
          <Input value={b.href} onChange={(e) => onChange({ href: e.target.value })} placeholder="Download URL" className="!py-1.5 !text-sm flex-1 min-w-[140px]" />
          <Input value={b.size} onChange={(e) => onChange({ size: e.target.value })} placeholder="Size (e.g. 10 KB)" className="!py-1.5 !text-sm !w-32" />
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
              <span key={idx} className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] pl-1 pr-1.5 py-0.5"
                style={{ color: tg.color || 'var(--primary)', background: tg.color ? `color-mix(in srgb, ${tg.color} 14%, transparent)` : undefined }}>
                <input type="color" value={tg.color || '#7c3aed'} onChange={(e) => setTag(idx, { color: e.target.value })} title="Colour" className="w-4 h-4 rounded-full border-0 bg-transparent p-0 cursor-pointer" />
                <input value={tg.text} onChange={(e) => setTag(idx, { text: e.target.value })} placeholder="Tag" className="bg-transparent border-0 outline-none text-xs font-semibold w-16" style={{ color: 'inherit' }} />
                <button type="button" onClick={() => delTag(idx)} className="opacity-60 hover:opacity-100"><X size={11} /></button>
              </span>
            ))}
            <button type="button" onClick={addTag} className="inline-flex items-center gap-1 text-xs text-[var(--muted)] hover:text-[var(--text)] rounded-full border border-dashed border-[var(--line)] px-2 py-0.5"><Plus size={12} /> Tag</button>
          </div>
        </div>
      );
    }
    case 'divider': return <div className="text-xs text-[var(--faint)] py-1">— Divider —</div>;
    default: return null;
  }
}
