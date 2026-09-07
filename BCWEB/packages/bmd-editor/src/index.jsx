// @bettercommunity/bmd-editor — an editor for B.MD documents.
//
// Separate from the renderer on purpose: a site that only READS documents should not ship a
// toolbar, a snippet menu and a link checker to every visitor. This package imports the
// renderer; the renderer knows nothing about this package.
//
// One component, two layouts. Side by side when there is room, Write / Preview tabs when there
// is not — decided by measuring, not by guessing the device, so a narrow desktop window gets
// the tabs and a tablet in landscape gets the split. Everything is plain markdown underneath:
// the toolbar inserts text, the preview renders it, and what the host receives is the string.
//
// The block menu is PORTALLED to <body> and positioned in viewport coordinates. Two reasons,
// both learnt the hard way: the editor's own box is overflow-hidden for its rounded corners,
// which clipped an absolute menu to the toolbar's height; and `position: fixed` resolves
// against the nearest transformed ancestor, so inside an animated modal a fixed menu landed
// in the modal's coordinate space and was invisible. A portal escapes both.
import { useState, useRef, useEffect, useMemo, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import Markdown from '@bettercommunity/bmd';
import { validateLinks } from '@bettercommunity/bmd/links';
import { parseMarkdown, extractHeadings } from '@bettercommunity/bmd/ast';
import { documentHtml, cssUrl } from '@bettercommunity/bmd/export';
import { SNIPPET_GROUPS, expandSnippet, localizeSnippetGroups } from './snippets.js';
import './editor.css';

export { SNIPPET_GROUPS, SNIPPETS, expandSnippet, localizeSnippetGroups } from './snippets.js';

// A handful of inline glyphs, so the package brings no icon library of its own.
const svg = (d) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>;
export const ICO = {
  plus: svg(<><path d="M5 12h14" /><path d="M12 5v14" /></>),
  bold: svg(<path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8" />),
  italic: svg(<><line x1="19" x2="10" y1="4" y2="4" /><line x1="14" x2="5" y1="20" y2="20" /><line x1="15" x2="9" y1="4" y2="20" /></>),
  code: svg(<><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></>),
  link: svg(<><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></>),
  heading: svg(<><path d="M6 12h12" /><path d="M6 20V4" /><path d="M18 20V4" /></>),
  list: svg(<><line x1="8" x2="21" y1="6" y2="6" /><line x1="8" x2="21" y1="12" y2="12" /><line x1="8" x2="21" y1="18" y2="18" /><line x1="3" x2="3.01" y1="6" y2="6" /><line x1="3" x2="3.01" y1="12" y2="12" /><line x1="3" x2="3.01" y1="18" y2="18" /></>),
  quote: svg(<><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z" /><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z" /></>),
  tip: svg(<><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" /><path d="M9 18h6" /><path d="M10 22h4" /></>),
  image: svg(<><rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" /></>),
  table: svg(<><path d="M12 3v18" /><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 9h18" /><path d="M3 15h18" /></>),
  links: svg(<><path d="M9 17H7A5 5 0 0 1 7 7h2" /><path d="M15 7h2a5 5 0 1 1 0 10h-2" /><line x1="8" x2="16" y1="12" y2="12" /></>),
  outline: svg(<><path d="M21 12h-8" /><path d="M21 6H8" /><path d="M21 18h-8" /><path d="M3 6v4c0 1.1.9 2 2 2h3" /><path d="M3 10v6c0 1.1.9 2 2 2h3" /></>),
  tree: svg(<><path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M21 8V5a2 2 0 0 0-2-2h-3" /><path d="M3 16v3a2 2 0 0 0 2 2h3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" /><path d="M8 12h8" /><path d="M12 8v8" /></>),
  download: svg(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" /></>),
  layout: svg(<><rect width="18" height="7" x="3" y="3" rx="1" /><rect width="9" height="7" x="3" y="14" rx="1" /><rect width="5" height="7" x="16" y="14" rx="1" /></>),
  eye: svg(<><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></>),
  pen: svg(<><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></>),
  more: svg(<><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" /></>),
  close: svg(<><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>),
  upload: svg(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" x2="12" y1="3" y2="15" /></>),
  play: svg(<><circle cx="12" cy="12" r="10" /><polygon points="10 8 16 12 10 16 10 8" /></>),
  smile: svg(<><circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" x2="9.01" y1="9" y2="9" /><line x1="15" x2="15.01" y1="9" y2="9" /></>),
  tag: svg(<><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" /><circle cx="7.5" cy="7.5" r=".5" fill="currentColor" /></>),
  keyboard: svg(<><rect width="20" height="16" x="2" y="4" rx="2" /><path d="M6 8h.01" /><path d="M10 8h.01" /><path d="M14 8h.01" /><path d="M18 8h.01" /><path d="M8 12h.01" /><path d="M12 12h.01" /><path d="M16 12h.01" /><path d="M7 16h10" /></>),
  video: svg(<><path d="m22 8-6 4 6 4V8Z" /><rect width="14" height="12" x="2" y="6" rx="2" ry="2" /></>),
  'text-cursor': svg(<><path d="M17 22h-1a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4h1" /><path d="M7 22h1a4 4 0 0 0 4-4v-1" /><path d="M7 2h1a4 4 0 0 1 4 4v1" /></>),
  info: svg(<><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></>),
  'layout-grid': svg(<><rect width="7" height="7" x="3" y="3" rx="1" /><rect width="7" height="7" x="14" y="3" rx="1" /><rect width="7" height="7" x="14" y="14" rx="1" /><rect width="7" height="7" x="3" y="14" rx="1" /></>),
  'list-checks': svg(<><path d="m3 17 2 2 4-4" /><path d="m3 7 2 2 4-4" /><path d="M13 6h8" /><path d="M13 12h8" /><path d="M13 18h8" /></>),
  plug: svg(<><path d="M12 22v-5" /><path d="M9 8V2" /><path d="M15 8V2" /><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" /></>),
  activity: svg(<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />),
};

const STR = {
  en: { write: 'Write', preview: 'Preview', insert: 'Insert', links: 'Links', outline: 'Outline', ast: 'AST', export: 'Export HTML', words: 'words', chars: 'chars', noIssues: 'Every link goes somewhere.', issues: 'link issue(s)', empty: 'Start writing — or insert a block.', line: 'line', search: 'Search blocks…', close: 'Close', split: 'Side by side', tabs: 'Tabs', wrap: 'Wrap', more: 'More', hint: 'Type / at a line start for blocks · Ctrl+B · Ctrl+I · Ctrl+K' },
  fr: { write: 'Écrire', preview: 'Aperçu', insert: 'Insérer', links: 'Liens', outline: 'Plan', ast: 'AST', export: 'Exporter en HTML', words: 'mots', chars: 'caractères', noIssues: 'Chaque lien mène quelque part.', issues: 'problème(s) de lien', empty: 'Commence à écrire — ou insère un bloc.', line: 'ligne', search: 'Chercher un bloc…', close: 'Fermer', split: 'Côte à côte', tabs: 'Onglets', wrap: 'Retour à la ligne', more: 'Plus', hint: 'Tape / en début de ligne pour les blocs · Ctrl+B · Ctrl+I · Ctrl+K' },
};

function useNarrow(breakpoint) {
  const [narrow, setNarrow] = useState(() => (typeof window !== 'undefined' ? window.innerWidth < breakpoint : false));
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, [breakpoint]);
  return narrow;
}

function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => { const id = setTimeout(() => setV(value), ms); return () => clearTimeout(id); }, [value, ms]);
  return v;
}

/**
 * A menu anchored to a button, drawn in a portal at viewport coordinates. Below the button
 * when there is room, above it otherwise; on a phone it becomes a sheet from the bottom.
 */
function Popover({ anchor, onClose, sheet, className = '', children, width = 560 }) {
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    if (sheet) { setPos({ sheet: true }); return undefined; }
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const vw = window.innerWidth; const vh = window.innerHeight;
      const w = Math.min(width, vw - 16);
      const below = vh - r.bottom - 12; const above = r.top - 12;
      const flip = below < 240 && above > below;
      const maxH = Math.max(180, Math.min(Math.round(vh * 0.6), flip ? above : below));
      setPos({ top: flip ? Math.max(8, r.top - 6 - maxH) : r.bottom + 6, left: Math.max(8, Math.min(r.left, vw - w - 8)), width: w, maxH, flip });
    };
    place();
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [anchor, sheet, width]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (!pos || typeof document === 'undefined') return null;
  return createPortal(
    <div className={`bmde-layer${pos.sheet ? ' bmde-layer-sheet' : ''}`}>
      <div className="bmde-backdrop" onMouseDown={onClose} />
      <div className={`bmde-pop ${className}`} role="menu"
        style={pos.sheet ? undefined : { top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxH }}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/**
 * @param {object} props
 * @param {string} props.value
 * @param {(next: string) => void} props.onChange
 * @param {'en'|'fr'|string} [props.lang]
 * @param {object} [props.pageMap]           the renderer's page map — hover cards, wiki links, link checks
 * @param {'auto'|'split'|'tabs'} [props.layout]
 * @param {number} [props.breakpoint]        below this width `auto` means tabs (default 900)
 * @param {number|string} [props.height]     the editing area's height (default '60vh')
 * @param {boolean} [props.toolbar]          show the toolbar (default true)
 * @param {boolean} [props.status]           show the status bar (default true)
 * @param {boolean} [props.compact]          a small field: tabs, a short quick row, no panels, no export, no status
 * @param {Array} [props.snippetGroups]      replace the block menu
 * @param {Array} [props.extraGroups]        groups appended to the block menu; an item may carry `onPick({ insert })` instead of `md`
 * @param {string} [props.placeholder]
 * @param {string} [props.exportTitle]       the <title> of an exported page
 * @param {(md: string) => void} [props.onSave]   Ctrl+S
 * @param {object} [props.markdownProps]     anything else for <Markdown> (roadmap, replay, radius…)
 * @param {React.ReactNode} [props.extraTools]  host buttons drawn at the end of the toolbar
 * @param {React.RefObject<HTMLTextAreaElement>} [props.textareaRef]  the host's ref on the
 *        textarea, so it can attach a floating select-to-format toolbar or measure a selection.
 *        Omitted, the editor keeps its own.
 */
export default function BmdEditor({
  value = '', onChange, lang = 'en', pageMap = null, layout = 'auto', breakpoint = 900, height = '60vh',
  toolbar = true, status = true, compact = false, snippetGroups = SNIPPET_GROUPS, extraGroups = [], placeholder, exportTitle = 'Document', onSave, markdownProps = {}, className = '', extraTools = null,
  textareaRef = null,
}) {
  const L = STR[lang] || STR.en;
  const narrow = useNarrow(breakpoint);
  const phone = useNarrow(640);
  const [mode, setMode] = useState(compact ? 'tabs' : layout);
  const tabs = mode === 'tabs' || (mode === 'auto' && narrow);
  const [tab, setTab] = useState('write');
  const [panel, setPanel] = useState(null); // links | outline | ast | null
  const [menu, setMenu] = useState(false);
  const [more, setMore] = useState(false);
  const [query, setQuery] = useState('');
  const [wrap, setWrap] = useState(true);
  // The host may want to hang something off the textarea — the floating
  // select-to-format toolbar does, and it can only find a selection if it has the
  // element. Without this the toolbar existed but only in the RAW markdown mode,
  // which is not the mode the blog and docs editors open in.
  const ownTa = useRef(null);
  const ta = textareaRef || ownTa;
  const root = useRef(null);
  const insertBtn = useRef(null);
  const moreBtn = useRef(null);
  const debounced = useDebounced(value, 350);
  const showStatus = status && !compact;

  const insert = useCallback((md) => {
    const el = ta.current;
    const start = el ? el.selectionStart : value.length;
    const end = el ? el.selectionEnd : value.length;
    const sel = value.slice(start, end);
    const { text, cursor } = expandSnippet(md, sel);
    // A block on its own lines; an inline one where the caret is.
    const block = /\n/.test(text) && !/^[^\n]*\$\{/.test(md);
    const before = value.slice(0, start);
    const after = value.slice(end);
    const lead = block && before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
    const trail = block && after && !after.startsWith('\n') ? '\n' : '';
    const next = `${before}${lead}${text}${trail}${after}`;
    onChange?.(next);
    const at = before.length + lead.length + cursor;
    if (tabs) setTab('write');
    requestAnimationFrame(() => { if (el) { el.focus(); el.setSelectionRange(at, at); } });
    setMenu(false); setQuery('');
  }, [value, onChange, tabs]);

  const pick = (it) => {
    if (typeof it.onPick === 'function') { setMenu(false); setQuery(''); it.onPick({ insert, value }); return; }
    insert(it.md);
  };

  const onKey = (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === 'b') { e.preventDefault(); insert('**${sel|bold}**'); }
    else if (k === 'i') { e.preventDefault(); insert('*${sel|italic}*'); }
    else if (k === 'k') { e.preventDefault(); insert('[${sel|text}](https://${cursor})'); }
    else if (k === 'e') { e.preventDefault(); insert('`${sel|code}`'); }
    else if (k === 's' && onSave) { e.preventDefault(); onSave(value); }
    else if (k === '/') { e.preventDefault(); setMenu(true); }
  };

  // Tab inserts two spaces rather than leaving the field: an editor whose Tab key walks off to
  // the next button is not an editor, and a nested list needs the indent.
  const onTab = (e) => {
    if (e.key !== 'Tab' || e.shiftKey) return;
    e.preventDefault();
    const el = e.currentTarget; const s = el.selectionStart; const en = el.selectionEnd;
    const next = `${value.slice(0, s)}  ${value.slice(en)}`;
    onChange?.(next);
    requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
  };

  // `/` at the start of a line opens the block menu, the way every block editor does.
  const onSlash = (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey) return;
    const el = e.currentTarget; const s = el.selectionStart;
    if (s === 0 || value[s - 1] === '\n') { e.preventDefault(); setMenu(true); }
  };

  const stats = useMemo(() => {
    const words = (debounced.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
    return { words, chars: debounced.length };
  }, [debounced]);
  const links = useMemo(() => { try { return validateLinks(debounced, { pageMap }); } catch { return { ok: true, issues: [], count: 0 }; } }, [debounced, pageMap]);
  const outline = useMemo(() => { try { return extractHeadings(debounced, { pageMap }); } catch { return []; } }, [debounced, pageMap]);
  const ast = useMemo(() => {
    if (panel !== 'ast') return '';
    try { return JSON.stringify(parseMarkdown(debounced, { pageMap }), (k, v) => (k === 'position' ? undefined : v), 2); } catch (e) { return String(e); }
  }, [panel, debounced, pageMap]);

  const doExport = async () => {
    let css = '';
    try { css = await fetch(cssUrl).then((r) => (r.ok ? r.text() : '')); } catch { css = ''; }
    let html = documentHtml(value, { title: exportTitle, css, lang, render: { pageMap, ...markdownProps } });
    // Diagrams: the static render carries each as its source in a <pre>; the live preview has
    // drawn them. Substituted in order, so the exported page shows the picture.
    const svgs = Array.from(root.current?.querySelectorAll('.bmde-preview .doc-mermaid-svg') || []).map((el) => el.innerHTML);
    if (svgs.length) { let n = 0; html = html.replace(/<pre class="doc-mermaid-src">[\s\S]*?<\/pre>/g, (m) => (svgs[n] ? `<div class="doc-mermaid-svg">${svgs[n++]}</div>` : m)); }
    const blob = new Blob([html], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${String(exportTitle || 'document').replace(/[^\w.-]+/g, '-').toLowerCase() || 'document'}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setMore(false);
  };

  const jump = (line) => {
    const el = ta.current; if (!el || !line) return;
    const idx = value.split('\n').slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0);
    el.focus(); el.setSelectionRange(idx, idx);
    if (tabs) setTab('write');
  };

  // The heading's own line: the first `#…` line whose text matches, so two identical
  // headings jump to the first — which is also the one the anchor resolves to.
  const jumpToHeading = (hd) => {
    const lines = value.split('\n');
    const i = lines.findIndex((l) => new RegExp(`^#{${hd.depth}}\\s+`).test(l) && l.replace(/^#+\s+/, '').trim().replace(/\s+#+$/, '') === hd.text);
    if (i >= 0) jump(i + 1);
  };

  const q = query.trim().toLowerCase();
  // Localise the block-menu labels (fr → French) before filtering, so search matches what is shown.
  const allGroups = localizeSnippetGroups([...snippetGroups, ...(Array.isArray(extraGroups) ? extraGroups : [])], lang);
  const groups = allGroups.map((g) => ({ ...g, items: (g.items || []).filter((it) => !q || String(it.label).toLowerCase().includes(q) || String(it.id || '').includes(q) || String(it.keywords || '').toLowerCase().includes(q)) })).filter((g) => g.items.length);

  const h = typeof height === 'number' ? `${height}px` : height;
  const editor = (
    <textarea ref={ta} className={`bmde-ta${wrap ? '' : ' bmde-nowrap'}`} value={value} spellCheck={false}
      placeholder={placeholder || L.empty} onChange={(e) => onChange?.(e.target.value)} onKeyDown={(e) => { onKey(e); onTab(e); onSlash(e); }}
      style={{ minHeight: h }} aria-label={L.write} />
  );
  const preview = (
    <div className="bmde-preview" style={{ minHeight: h }}>
      <Markdown lang={lang} pageMap={pageMap} {...markdownProps}>{debounced}</Markdown>
    </div>
  );

  const quick = compact
    ? [['bold', 'Ctrl+B', '**${sel|bold}**'], ['italic', 'Ctrl+I', '*${sel|italic}*'], ['link', 'Ctrl+K', '[${sel|text}](https://${cursor})'], ['heading', '', '## ${sel|Heading}'], ['list', '', '- ${sel|item}'], ['tip', '', ':::tip[${cursor}Title]\n${sel|Body}\n:::']]
    : [['bold', 'Ctrl+B', '**${sel|bold}**'], ['italic', 'Ctrl+I', '*${sel|italic}*'], ['code', 'Ctrl+E', '`${sel|code}`'], ['link', 'Ctrl+K', '[${sel|text}](https://${cursor})'], ['heading', '', '## ${sel|Heading}'], ['list', '', '- ${sel|item}'], ['quote', '', '> ${sel|Quoted text}'], ['tip', '', ':::tip[${cursor}Title]\n${sel|Body}\n:::'], ['table', '', ':::table[${cursor}Caption]{style="striped bordered"}\n| Column | Column |\n|---|---|\n| ${sel|cell} | cell |\n:::'], ['image', '', ':img[${sel|Alt text}]{src=https://${cursor} width=480 align=center caption="Caption"}']];

  const panelButtons = (
    <>
      <button type="button" className={`bmde-btn bmde-btn-ghost${panel === 'links' ? ' is-on' : ''}${links.issues.length ? ' bmde-warn' : ''}`} onClick={() => { setPanel(panel === 'links' ? null : 'links'); setMore(false); }}>
        {ICO.links} <span className="bmde-lbl">{L.links}{links.issues.length ? ` · ${links.issues.length}` : ''}</span>
      </button>
      <button type="button" className={`bmde-btn bmde-btn-ghost${panel === 'outline' ? ' is-on' : ''}`} onClick={() => { setPanel(panel === 'outline' ? null : 'outline'); setMore(false); }}>{ICO.outline} <span className="bmde-lbl">{L.outline}</span></button>
      <button type="button" className={`bmde-btn bmde-btn-ghost${panel === 'ast' ? ' is-on' : ''}`} onClick={() => { setPanel(panel === 'ast' ? null : 'ast'); setMore(false); }}>{ICO.tree} <span className="bmde-lbl">{L.ast}</span></button>
      <button type="button" className="bmde-btn bmde-btn-ghost" onClick={doExport}>{ICO.download} <span className="bmde-lbl">{L.export}</span></button>
    </>
  );

  return (
    <div ref={root} className={`bmde${tabs ? ' bmde-tabs' : ' bmde-split'}${compact ? ' bmde-compact' : ''} ${className}`}>
      {toolbar && (
        <div className="bmde-bar" role="toolbar">
          <button ref={insertBtn} type="button" className="bmde-btn bmde-btn-primary" onClick={() => setMenu((v) => !v)} aria-expanded={menu} aria-haspopup="menu">{ICO.plus} <span className="bmde-lbl">{L.insert}</span></button>
          <div className="bmde-quick">
            {quick.map(([ico, title, md]) => <button key={ico} type="button" className="bmde-btn" title={title || undefined} onClick={() => insert(md)}>{ICO[ico]}</button>)}
          </div>
          <div className="bmde-spacer" />
          {tabs
            ? <div className="bmde-tabbar" role="tablist">
              <button type="button" role="tab" aria-selected={tab === 'write'} className={`bmde-tab${tab === 'write' ? ' is-on' : ''}`} onClick={() => setTab('write')}>{ICO.pen} <span className="bmde-lbl">{L.write}</span></button>
              <button type="button" role="tab" aria-selected={tab === 'preview'} className={`bmde-tab${tab === 'preview' ? ' is-on' : ''}`} onClick={() => setTab('preview')}>{ICO.eye} <span className="bmde-lbl">{L.preview}</span></button>
            </div>
            : null}
          {!compact && !narrow && layout === 'auto' && (
            <button type="button" className="bmde-btn bmde-btn-ghost" title={mode === 'tabs' ? L.split : L.tabs} onClick={() => setMode(mode === 'tabs' ? 'split' : 'tabs')}>{ICO.layout}</button>
          )}
          {!compact && (phone
            ? <button ref={moreBtn} type="button" className={`bmde-btn bmde-btn-ghost${panel ? ' is-on' : ''}`} onClick={() => setMore((v) => !v)} aria-label={L.more}>{ICO.more}</button>
            : panelButtons)}
          {extraTools}
        </div>
      )}

      {menu && (
        <Popover anchor={insertBtn} onClose={() => { setMenu(false); setQuery(''); }} sheet={phone} className="bmde-menu">
          <div className="bmde-menu-head">
            <input className="bmde-search" placeholder={L.search} value={query} onChange={(e) => setQuery(e.target.value)} autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') { const first = groups[0]?.items?.[0]; if (first) pick(first); } }} />
            <button type="button" className="bmde-btn bmde-btn-ghost" onClick={() => { setMenu(false); setQuery(''); }} aria-label={L.close}>{ICO.close}</button>
          </div>
          <div className="bmde-menu-groups">
            {groups.map((g) => (
              <div key={g.id} className="bmde-menu-group">
                <div className="bmde-menu-title">{ICO[g.icon] || null} {g.label}</div>
                {g.items.map((it) => (
                  <button key={it.id} type="button" role="menuitem" className="bmde-menu-item" onClick={() => pick(it)} title={it.hint || undefined}>
                    {it.icon && ICO[it.icon] ? <span className="bmde-menu-ico">{ICO[it.icon]}</span> : null}{it.label}
                  </button>
                ))}
              </div>
            ))}
            {!groups.length && <div className="bmde-menu-empty">—</div>}
          </div>
        </Popover>
      )}

      {more && (
        <Popover anchor={moreBtn} onClose={() => setMore(false)} sheet={phone} className="bmde-more" width={260}>
          <div className="bmde-more-list">{panelButtons}</div>
        </Popover>
      )}

      <div className="bmde-body">
        {tabs ? (tab === 'write' ? editor : preview) : <>{editor}{preview}</>}
      </div>

      {panel && !compact && (
        <div className="bmde-panel">
          <div className="bmde-panel-head">
            <span>{panel === 'links' ? L.links : panel === 'outline' ? L.outline : L.ast}</span>
            <button type="button" className="bmde-btn bmde-btn-ghost" onClick={() => setPanel(null)}>{L.close}</button>
          </div>
          {panel === 'links' && (
            links.issues.length
              ? <ul className="bmde-issues">{links.issues.map((i, n) => (
                <li key={n} className={`bmde-issue bmde-issue-${i.level}`}>
                  <button type="button" onClick={() => jump(i.line)}>
                    <code>{i.href || '(empty)'}</code> — {i.hint}{i.line ? <span className="bmde-faint"> · {L.line} {i.line}</span> : null}
                  </button>
                </li>))}</ul>
              : <div className="bmde-ok">✓ {L.noIssues} ({links.count})</div>
          )}
          {panel === 'outline' && (
            <ul className="bmde-outline">{outline.map((hd, n) => <li key={n} className={`bmde-outline-l${hd.depth}`}><button type="button" onClick={() => jumpToHeading(hd)}>{hd.text}</button> <span className="bmde-faint">#{hd.id}</span></li>)}</ul>
          )}
          {panel === 'ast' && <pre className="bmde-ast">{ast}</pre>}
        </div>
      )}

      {showStatus && (
        <div className="bmde-status">
          <span>{stats.words} {L.words} · {stats.chars} {L.chars}</span>
          <span className={links.issues.length ? 'bmde-warn' : ''}>{links.issues.length ? `${links.issues.length} ${L.issues}` : `✓ ${L.links}`}</span>
          {!phone && <span className="bmde-faint">{L.hint}</span>}
          <label className="bmde-wrap"><input type="checkbox" checked={wrap} onChange={(e) => setWrap(e.target.checked)} /> {L.wrap}</label>
        </div>
      )}
    </div>
  );
}

export { default as BmdBlockCanvas } from './block-canvas.jsx';
