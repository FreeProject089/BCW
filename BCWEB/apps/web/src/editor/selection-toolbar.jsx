import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n.jsx';
import { createPortal } from 'react-dom';
import { Bold, Italic, Strikethrough, Code, Link2, Hash, MessageSquarePlus, Palette, X,
  Heading1, Heading2, Heading3, List, ListOrdered, Quote } from 'lucide-react';
import { toggleHeading, toggleBullet, toggleOrdered, toggleQuote, expandToLines } from '../lib/md-lines.js';

// Floating "select-to-format" toolbar for the markdown textarea. On a non-empty
// selection it appears above the selected text and can wrap it with markdown
// (bold/italic/strike/code), a colour <span>, a link, an **anchor** to a heading,
// or an inline **comment** (text + optional link/image, shown on hover — rendered
// by the DocComment component in md.jsx).

// Text colours. The first four are THEME TOKENS (var(--…)) that re-map between light and dark,
// so text coloured with them stays legible in either theme — the previous fixed dark hues
// (#e11d48, #d97706 …) vanished on the dark theme. The rest are mid-tone (Tailwind-500) hues,
// chosen because they read on both a light and a dark background, unlike the darker 600/700
// shades used before. `safeColor` in the B.MD kit accepts both a var() token and a #hex.
const COLORS = [
  'var(--primary-2)', 'var(--success)', 'var(--warning)', 'var(--error)',
  '#ef4444', '#f97316', '#f59e0b', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#ec4899',
];

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
  const { t } = useI18n();
  const [pos, setPos] = useState(null); // { top, left } or null
  const [sub, setSub] = useState(null); // 'color' | 'comment' | null
  const selRef = useRef({ s: 0, e: 0 });
  const cmt = useRef({ text: '', link: '', img: '' });
  const lnk = useRef({ url: '', text: '' });
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

  /**
   * Line-level formatting: heading, list, quote.
   *
   * These operate on whole LINES, not on the selected characters — applying `- ` to a
   * character range would put the marker in the middle of a word. The selection is grown to
   * its lines first, and put back covering the transformed range so the same press can be
   * pressed again to toggle it off.
   */
  const applyLines = (fn) => {
    const ta = taRef.current; const { s, e } = selRef.current;
    const { start, end, lines } = expandToLines(value, s, e);
    const next = fn(lines).join('\n');
    onChange(value.slice(0, start) + next + value.slice(end));
    setPos(null); setSub(null);
    requestAnimationFrame(() => {
      if (!ta) return;
      ta.focus();
      ta.selectionStart = start; ta.selectionEnd = start + next.length;
    });
  };
  const color = (c) => apply((sel) => ({ text: `<span style="color:${c}">${sel}</span>` }));

  /**
   * The link panel, replacing `window.prompt`.
   *
   * The browser's prompt was the one piece of this toolbar that was not the toolbar: an
   * OS-chrome box captioned with the origin ("localhost:5176"), unthemed, unstyleable,
   * untranslated, and blocking. It also asked for exactly one thing — the URL — so the link
   * text was always the selection, with no way to change it, and no way to see what you were
   * about to write.
   *
   * An inline panel instead, the same shape as the colour, anchor and comment ones beside it.
   * It also does the two things a prompt cannot: it prefills the URL when the selection IS a
   * URL (paste-then-select is how most links get made), and it shows the markdown it is about
   * to insert.
   */
  const openLink = () => {
    const { s, e } = selRef.current;
    const sel = value.slice(s, e).trim();
    const looksLikeUrl = /^(https?:\/\/|mailto:|\/)\S+$/i.test(sel);
    lnk.current = { url: looksLikeUrl ? sel : '', text: looksLikeUrl ? '' : sel };
    setSub((v) => (v === 'link' ? null : 'link'));
  };
  const addLink = () => {
    const { url, text } = lnk.current;
    const href = String(url || '').trim();
    if (!href) { setSub(null); return; }
    apply((sel) => ({ text: `[${String(text || '').trim() || sel || href}](${href})` }));
    lnk.current = { url: '', text: '' };
  };
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
        {btn(Bold, () => wrap('**'), t('sel.bold', 'Bold'))}
        {btn(Italic, () => wrap('*'), t('sel.italic', 'Italic'))}
        {btn(Strikethrough, () => wrap('~~'), t('sel.strike', 'Strikethrough'))}
        {btn(Code, () => wrap('`'), t('sel.code', 'Inline code'))}
        <span className="w-px h-5 bg-[var(--line)] mx-0.5" />
        {/* The structural half. It was missing entirely: everything here meant leaving the
            mouse, finding the start of the line and typing the prefix by hand — and that is
            the formatting people reach for most. Each one toggles. */}
        {btn(Heading1, () => applyLines((l) => toggleHeading(l, 1)), t('sel.h1', 'Heading 1'))}
        {btn(Heading2, () => applyLines((l) => toggleHeading(l, 2)), t('sel.h2', 'Heading 2'))}
        {btn(Heading3, () => applyLines((l) => toggleHeading(l, 3)), t('sel.h3', 'Heading 3'))}
        {btn(List, () => applyLines(toggleBullet), t('sel.ul', 'Bullet list'))}
        {btn(ListOrdered, () => applyLines(toggleOrdered), t('sel.ol', 'Numbered list'))}
        {btn(Quote, () => applyLines(toggleQuote), t('sel.quote', 'Quote'))}
        <span className="w-px h-5 bg-[var(--line)] mx-0.5" />
        {btn(Palette, () => setSub((v) => v === 'color' ? null : 'color'), t('sel.colour', 'Colour'))}
        {btn(Link2, openLink, t('sel.link', 'Link'))}
        {headings.length > 0 && btn(Hash, () => setSub((v) => v === 'anchor' ? null : 'anchor'), t('sel.anchor', 'Anchor to a heading'))}
        {btn(MessageSquarePlus, () => { cmt.current = { text: '', link: '', img: '' }; setSub((v) => v === 'comment' ? null : 'comment'); }, t('sel.comment', 'Comment'))}
      </div>
      {sub === 'color' && (
        <div className="absolute top-full mt-1 left-0 flex flex-wrap items-center gap-1 p-1.5 w-[204px] rounded-lg border border-[var(--line-strong)] shadow-xl" style={{ background: 'var(--bg-solid)' }}>
          {COLORS.map((c) => <button key={c} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => color(c)} className="w-5 h-5 rounded-full border border-black/20" style={{ background: c }} />)}
          {/* full colour picker — applies when the native dialog closes */}
          <input type="color" defaultValue="#7c3aed" title={t('st.customcolour', "Custom colour")}
            onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}
            onChange={(e) => color(e.target.value)}
            className="w-6 h-6 rounded-full border border-[var(--line)] bg-transparent p-0 cursor-pointer" />
        </div>
      )}
      {sub === 'link' && (
        <div className="absolute top-full mt-1 left-0 w-72 p-2 rounded-lg border border-[var(--line-strong)] shadow-xl space-y-1.5" style={{ background: 'var(--bg-solid)' }}>
          <div className="flex items-center justify-between text-xs font-semibold text-[var(--muted)]">
            {t('sel.link', 'Link')}
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setSub(null)}><X size={13} /></button>
          </div>
          {/* Enter submits from either field — a two-field panel that needs the mouse to
              finish is slower than the prompt it replaced. */}
          <input autoFocus defaultValue={lnk.current.url} placeholder="https://…" inputMode="url"
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => { lnk.current.url = e.target.value; force((n) => n + 1); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLink(); } }}
            className="w-full text-sm rounded-md border border-[var(--line)] bg-transparent px-2 py-1.5 outline-none" />
          <input defaultValue={lnk.current.text} placeholder={t('sel.link.text', 'Text (defaults to the selection)')}
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => { lnk.current.text = e.target.value; force((n) => n + 1); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLink(); } }}
            className="w-full text-xs rounded-md border border-[var(--line)] bg-transparent px-2 py-1 outline-none" />
          {/* What is about to be written. A prompt could not show this, and "why did it insert
              that" is the question a link dialog gets asked most. */}
          <div className="text-[11px] font-mono text-[var(--faint)] truncate" dir="ltr">
            {lnk.current.url
              ? `[${(lnk.current.text || '').trim() || value.slice(selRef.current.s, selRef.current.e) || lnk.current.url}](${lnk.current.url})`
              : t('sel.link.hint', 'Paste a URL, or select one before opening this.')}
          </div>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={addLink} disabled={!lnk.current.url}
            className="w-full text-sm rounded-md py-1 font-medium disabled:opacity-40"
            style={{ background: 'var(--primary)', color: 'var(--on-primary)' }}>{t('sel.link.add', 'Insert link')}</button>
        </div>
      )}
      {sub === 'anchor' && (
        <div className="absolute top-full mt-1 left-0 w-56 max-h-52 overflow-auto py-1 rounded-lg border border-[var(--line-strong)] shadow-xl" style={{ background: 'var(--bg-solid)' }}>
          {headings.map((h, i) => <button key={i} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => anchor(h.slug)} className="w-full text-start px-3 py-1.5 text-sm hover:bg-[var(--surface-2)] truncate" title={h.txt}>{h.txt}</button>)}
        </div>
      )}
      {sub === 'comment' && (
        <div className="absolute top-full mt-1 left-0 w-64 p-2 rounded-lg border border-[var(--line-strong)] shadow-xl space-y-1.5" style={{ background: 'var(--bg-solid)' }}>
          <div className="flex items-center justify-between text-xs font-semibold text-[var(--muted)]">{t('sel.comment', 'Comment')} <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setSub(null)}><X size={13} /></button></div>
          <textarea autoFocus rows={2} placeholder={t('st.ph.text', "Comment text\u2026")} onMouseDown={(e) => e.stopPropagation()} defaultValue="" onChange={(e) => { cmt.current.text = e.target.value; }} className="w-full text-sm rounded-md border border-[var(--line)] bg-transparent p-1.5 outline-none" />
          <input placeholder={t('st.ph.link', "Link (optional)")} onMouseDown={(e) => e.stopPropagation()} onChange={(e) => { cmt.current.link = e.target.value; }} className="w-full text-xs rounded-md border border-[var(--line)] bg-transparent px-2 py-1 outline-none" />
          <input placeholder={t('st.ph.img', "Image URL (optional)")} onMouseDown={(e) => e.stopPropagation()} onChange={(e) => { cmt.current.img = e.target.value; }} className="w-full text-xs rounded-md border border-[var(--line)] bg-transparent px-2 py-1 outline-none" />
          <input placeholder={t('st.ph.video', "Video URL (optional)")} onMouseDown={(e) => e.stopPropagation()} onChange={(e) => { cmt.current.video = e.target.value; }} className="w-full text-xs rounded-md border border-[var(--line)] bg-transparent px-2 py-1 outline-none" />
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={addComment} className="w-full text-sm rounded-md bg-[var(--primary)] text-[var(--on-primary)] py-1 font-medium">{t('st.addcomment', "Add comment")}</button>
        </div>
      )}
    </div>, document.body);
}
