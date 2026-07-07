import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bold, Italic, Strikethrough, Code, Link2, Hash, MessageSquarePlus, Palette, X } from 'lucide-react';

// Floating "select-to-format" toolbar for the markdown textarea. On a non-empty
// selection it appears above the selected text and can wrap it with markdown
// (bold/italic/strike/code), a colour <span>, a link, an **anchor** to a heading,
// or an inline **comment** (text + optional link/image, shown on hover — rendered
// by the DocComment component in md.jsx).

const COLORS = ['#e11d48', '#ea580c', '#d97706', '#16a34a', '#0891b2', '#2563eb', '#7c3aed', '#db2777'];

function slugify(s) { return String(s).toLowerCase().trim().replace(/[^\wÀ-ɏ]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'section'; }
function esc(s) { return String(s).replace(/"/g, '&quot;'); }

// Pixel position of a character index inside a textarea (mirror-div technique).
function caretXY(ta, pos) {
  const style = getComputedStyle(ta);
  const div = document.createElement('div');
  const props = ['boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize', 'fontFamily', 'lineHeight', 'letterSpacing', 'textAlign', 'wordSpacing', 'tabSize'];
  props.forEach((p) => { div.style[p] = style[p]; });
  div.style.position = 'absolute'; div.style.visibility = 'hidden'; div.style.whiteSpace = 'pre-wrap'; div.style.wordWrap = 'break-word'; div.style.overflow = 'hidden'; div.style.width = ta.clientWidth + 'px';
  div.textContent = ta.value.substring(0, pos);
  const span = document.createElement('span'); span.textContent = ta.value.substring(pos) || '.';
  div.appendChild(span); document.body.appendChild(div);
  const top = span.offsetTop; const left = span.offsetLeft;
  document.body.removeChild(div);
  const rect = ta.getBoundingClientRect();
  return { top: rect.top + top - ta.scrollTop, left: Math.min(rect.right - 20, rect.left + left - ta.scrollLeft) };
}

export default function SelectionToolbar({ taRef, value, onChange }) {
  const [pos, setPos] = useState(null); // { top, left } or null
  const [sub, setSub] = useState(null); // 'color' | 'comment' | null
  const selRef = useRef({ s: 0, e: 0 });
  const cmt = useRef({ text: '', link: '', img: '' });
  const [, force] = useState(0);

  useEffect(() => {
    const ta = taRef.current; if (!ta) return;
    const update = () => {
      const s = ta.selectionStart, e = ta.selectionEnd;
      if (s === e) { setPos(null); setSub(null); return; }
      selRef.current = { s, e };
      const xy = caretXY(ta, s);
      setPos({ top: Math.max(8, xy.top - 46), left: xy.left });
    };
    const onSel = () => { if (document.activeElement === ta) update(); };
    ta.addEventListener('select', update);
    ta.addEventListener('mouseup', update);
    ta.addEventListener('keyup', (ev) => { if (ev.shiftKey || ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(ev.key)) update(); });
    document.addEventListener('selectionchange', onSel);
    const onScroll = () => setPos(null);
    window.addEventListener('scroll', onScroll, true);
    return () => { ta.removeEventListener('select', update); ta.removeEventListener('mouseup', update); document.removeEventListener('selectionchange', onSel); window.removeEventListener('scroll', onScroll, true); };
  }, [taRef, value]);

  const apply = (fn) => {
    const ta = taRef.current; const { s, e } = selRef.current;
    const sel = value.slice(s, e);
    const { text, caret } = fn(sel);
    onChange(value.slice(0, s) + text + value.slice(e));
    setPos(null); setSub(null);
    requestAnimationFrame(() => { if (ta) { ta.focus(); const c = caret ?? (s + text.length); ta.selectionStart = ta.selectionEnd = c; } });
  };
  const wrap = (b, a = b) => apply((sel) => ({ text: `${b}${sel}${a}` }));
  const color = (c) => apply((sel) => ({ text: `<span style="color:${c}">${sel}</span>` }));
  const link = async () => { const url = window.prompt('Link URL'); if (url) apply((sel) => ({ text: `[${sel}](${url})` })); };
  const anchor = (h) => apply((sel) => ({ text: `[${sel}](#${h})` }));
  const addComment = () => {
    const { text, link: lk, img, video } = cmt.current;
    if (!text.trim() && !lk && !img && !video) { setSub(null); return; }
    const attrs = [`data-comment="${esc(text)}"`, lk ? `data-link="${esc(lk)}"` : '', img ? `data-img="${esc(img)}"` : '', video ? `data-video="${esc(video)}"` : ''].filter(Boolean).join(' ');
    apply((sel) => ({ text: `<doc-comment ${attrs}>${sel}</doc-comment>` }));
    cmt.current = { text: '', link: '', img: '', video: '' };
  };

  const headings = (value.match(/^#{1,6}\s+.+$/gm) || []).map((h) => { const txt = h.replace(/^#{1,6}\s+/, '').trim(); return { txt, slug: slugify(txt) }; });

  if (!pos) return null;
  const btn = (Icon, fn, title) => <button type="button" title={title} onMouseDown={(e) => e.preventDefault()} onClick={fn} className="w-7 h-7 grid place-items-center rounded-md hover:bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--text)]"><Icon size={15} /></button>;

  return createPortal(
    <div style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 80 }} onMouseDown={(e) => e.preventDefault()}
      className="flex items-center gap-0.5 rounded-lg border border-[var(--line-strong)] p-1 shadow-xl" >
      <div className="flex items-center gap-0.5 rounded-lg" style={{ background: 'var(--bg-solid)' }}>
        {btn(Bold, () => wrap('**'), 'Bold')}
        {btn(Italic, () => wrap('*'), 'Italic')}
        {btn(Strikethrough, () => wrap('~~'), 'Strikethrough')}
        {btn(Code, () => wrap('`'), 'Inline code')}
        <span className="w-px h-5 bg-[var(--line)] mx-0.5" />
        {btn(Palette, () => setSub((v) => v === 'color' ? null : 'color'), 'Colour')}
        {btn(Link2, link, 'Link')}
        {headings.length > 0 && btn(Hash, () => setSub((v) => v === 'anchor' ? null : 'anchor'), 'Anchor to a heading')}
        {btn(MessageSquarePlus, () => { cmt.current = { text: '', link: '', img: '' }; setSub((v) => v === 'comment' ? null : 'comment'); }, 'Comment')}
      </div>
      {sub === 'color' && (
        <div className="absolute top-full mt-1 left-0 flex items-center gap-1 p-1.5 rounded-lg border border-[var(--line-strong)] shadow-xl" style={{ background: 'var(--bg-solid)' }}>
          {COLORS.map((c) => <button key={c} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => color(c)} className="w-5 h-5 rounded-full border border-black/20" style={{ background: c }} />)}
          {/* full colour picker — applies when the native dialog closes */}
          <input type="color" defaultValue="#7c3aed" title="Custom colour"
            onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}
            onChange={(e) => color(e.target.value)}
            className="w-6 h-6 rounded-full border border-[var(--line)] bg-transparent p-0 cursor-pointer" />
        </div>
      )}
      {sub === 'anchor' && (
        <div className="absolute top-full mt-1 left-0 w-56 max-h-52 overflow-auto py-1 rounded-lg border border-[var(--line-strong)] shadow-xl" style={{ background: 'var(--bg-solid)' }}>
          {headings.map((h, i) => <button key={i} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => anchor(h.slug)} className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--surface-2)] truncate">{h.txt}</button>)}
        </div>
      )}
      {sub === 'comment' && (
        <div className="absolute top-full mt-1 left-0 w-64 p-2 rounded-lg border border-[var(--line-strong)] shadow-xl space-y-1.5" style={{ background: 'var(--bg-solid)' }}>
          <div className="flex items-center justify-between text-xs font-semibold text-[var(--muted)]">Comment <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setSub(null)}><X size={13} /></button></div>
          <textarea autoFocus rows={2} placeholder="Comment text…" onMouseDown={(e) => e.stopPropagation()} defaultValue="" onChange={(e) => { cmt.current.text = e.target.value; }} className="w-full text-sm rounded-md border border-[var(--line)] bg-transparent p-1.5 outline-none" />
          <input placeholder="Link (optional)" onMouseDown={(e) => e.stopPropagation()} onChange={(e) => { cmt.current.link = e.target.value; }} className="w-full text-xs rounded-md border border-[var(--line)] bg-transparent px-2 py-1 outline-none" />
          <input placeholder="Image URL (optional)" onMouseDown={(e) => e.stopPropagation()} onChange={(e) => { cmt.current.img = e.target.value; }} className="w-full text-xs rounded-md border border-[var(--line)] bg-transparent px-2 py-1 outline-none" />
          <input placeholder="Video URL (optional)" onMouseDown={(e) => e.stopPropagation()} onChange={(e) => { cmt.current.video = e.target.value; }} className="w-full text-xs rounded-md border border-[var(--line)] bg-transparent px-2 py-1 outline-none" />
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={addComment} className="w-full text-sm rounded-md bg-[var(--primary)] text-white py-1 font-medium">Add comment</button>
        </div>
      )}
    </div>, document.body);
}
