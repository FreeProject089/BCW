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
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import Markdown from '@bettercommunity/bmd';
import { validateLinks } from '@bettercommunity/bmd/links';
import { parseMarkdown, extractHeadings } from '@bettercommunity/bmd/ast';
import { documentHtml, cssUrl } from '@bettercommunity/bmd/export';
import { SNIPPET_GROUPS, expandSnippet } from './snippets.js';
import './editor.css';

export { SNIPPET_GROUPS, SNIPPETS, expandSnippet } from './snippets.js';

const STR = {
  en: { write: 'Write', preview: 'Preview', insert: 'Insert', links: 'Links', outline: 'Outline', ast: 'AST', export: 'Export HTML', words: 'words', chars: 'chars', noIssues: 'Every link goes somewhere.', issues: 'link issue(s)', empty: 'Start writing — or insert a block.', line: 'line', search: 'Search blocks…', close: 'Close', split: 'Side by side', tabs: 'Tabs', wrap: 'Wrap' },
  fr: { write: 'Écrire', preview: 'Aperçu', insert: 'Insérer', links: 'Liens', outline: 'Plan', ast: 'AST', export: 'Exporter en HTML', words: 'mots', chars: 'caractères', noIssues: 'Chaque lien mène quelque part.', issues: 'problème(s) de lien', empty: 'Commence à écrire — ou insère un bloc.', line: 'ligne', search: 'Chercher un bloc…', close: 'Fermer', split: 'Côte à côte', tabs: 'Onglets', wrap: 'Retour à la ligne' },
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
 * @param {Array} [props.snippetGroups]      replace the block menu
 * @param {string} [props.placeholder]
 * @param {string} [props.exportTitle]       the <title> of an exported page
 * @param {(md: string) => void} [props.onSave]   Ctrl+S
 * @param {object} [props.markdownProps]     anything else for <Markdown> (roadmap, replay, radius…)
 */
export default function BmdEditor({
  value = '', onChange, lang = 'en', pageMap = null, layout = 'auto', breakpoint = 900, height = '60vh',
  toolbar = true, status = true, snippetGroups = SNIPPET_GROUPS, placeholder, exportTitle = 'Document', onSave, markdownProps = {}, className = '',
}) {
  const L = STR[lang] || STR.en;
  const narrow = useNarrow(breakpoint);
  const [mode, setMode] = useState(layout);
  const tabs = mode === 'tabs' || (mode === 'auto' && narrow);
  const [tab, setTab] = useState('write');
  const [panel, setPanel] = useState(null); // links | outline | ast | null
  const [menu, setMenu] = useState(false);
  const [query, setQuery] = useState('');
  const [wrap, setWrap] = useState(true);
  const ta = useRef(null);
  const debounced = useDebounced(value, 350);

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
    requestAnimationFrame(() => { if (el) { el.focus(); el.setSelectionRange(at, at); } });
    setMenu(false); setQuery('');
  }, [value, onChange]);

  const onKey = (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === 'b') { e.preventDefault(); insert('**${sel|bold}**'); }
    else if (k === 'i') { e.preventDefault(); insert('*${sel|italic}*'); }
    else if (k === 'k') { e.preventDefault(); insert('[${sel|text}](https://${cursor})'); }
    else if (k === 'e') { e.preventDefault(); insert('`${sel|code}`'); }
    else if (k === 's' && onSave) { e.preventDefault(); onSave(value); }
    else if (k === '/' ) { e.preventDefault(); setMenu(true); }
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
    const html = documentHtml(value, { title: exportTitle, css, lang, render: { pageMap, ...markdownProps } });
    const blob = new Blob([html], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${String(exportTitle || 'document').replace(/[^\w.-]+/g, '-').toLowerCase() || 'document'}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const jump = (line) => {
    const el = ta.current; if (!el || !line) return;
    const idx = value.split('\n').slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0);
    el.focus(); el.setSelectionRange(idx, idx);
    if (tabs) setTab('write');
  };

  // The heading's own line: the first `#…` line whose text matches, so two identical
  // headings jump to the first — which is also the one the anchor resolves to.
  const jumpToHeading = (h) => {
    const lines = value.split('\n');
    const i = lines.findIndex((l) => new RegExp(`^#{${h.depth}}\\s+`).test(l) && l.replace(/^#+\s+/, '').trim().replace(/\s+#+$/, '') === h.text);
    if (i >= 0) jump(i + 1);
  };

  const q = query.trim().toLowerCase();
  const groups = snippetGroups.map((g) => ({ ...g, items: g.items.filter((it) => !q || it.label.toLowerCase().includes(q) || it.id.includes(q)) })).filter((g) => g.items.length);

  const editor = (
    <textarea ref={ta} className={`bmde-ta${wrap ? '' : ' bmde-nowrap'}`} value={value} spellCheck={false}
      placeholder={placeholder || L.empty} onChange={(e) => onChange?.(e.target.value)} onKeyDown={(e) => { onKey(e); onTab(e); }}
      style={{ minHeight: typeof height === 'number' ? `${height}px` : height }} aria-label={L.write} />
  );
  const preview = (
    <div className="bmde-preview" style={{ minHeight: typeof height === 'number' ? `${height}px` : height }}>
      <Markdown lang={lang} pageMap={pageMap} {...markdownProps}>{debounced}</Markdown>
    </div>
  );

  return (
    <div className={`bmde${tabs ? ' bmde-tabs' : ' bmde-split'} ${className}`}>
      {toolbar && (
        <div className="bmde-bar" role="toolbar">
          <div className="bmde-menu-wrap">
            <button type="button" className="bmde-btn bmde-btn-primary" onClick={() => setMenu((v) => !v)} aria-expanded={menu} aria-haspopup="menu">＋ {L.insert}</button>
            {menu && (
              <div className="bmde-menu" role="menu">
                <input className="bmde-search" placeholder={L.search} value={query} onChange={(e) => setQuery(e.target.value)} autoFocus
                  onKeyDown={(e) => { if (e.key === 'Escape') setMenu(false); if (e.key === 'Enter') { const first = groups[0]?.items?.[0]; if (first) insert(first.md); } }} />
                <div className="bmde-menu-groups">
                  {groups.map((g) => (
                    <div key={g.id} className="bmde-menu-group">
                      <div className="bmde-menu-title">{g.label}</div>
                      {g.items.map((it) => <button key={it.id} type="button" role="menuitem" className="bmde-menu-item" onClick={() => insert(it.md)}>{it.label}</button>)}
                    </div>
                  ))}
                  {!groups.length && <div className="bmde-menu-empty">—</div>}
                </div>
              </div>
            )}
          </div>
          <div className="bmde-quick">
            <button type="button" className="bmde-btn" title="Ctrl+B" onClick={() => insert('**${sel|bold}**')}><b>B</b></button>
            <button type="button" className="bmde-btn" title="Ctrl+I" onClick={() => insert('*${sel|italic}*')}><i>I</i></button>
            <button type="button" className="bmde-btn" title="Ctrl+E" onClick={() => insert('`${sel|code}`')}><code>{'<>'}</code></button>
            <button type="button" className="bmde-btn" title="Ctrl+K" onClick={() => insert('[${sel|text}](https://${cursor})')}>🔗</button>
            <button type="button" className="bmde-btn" onClick={() => insert('## ${sel|Heading}')}>H</button>
            <button type="button" className="bmde-btn" onClick={() => insert('- ${sel|item}')}>•</button>
            <button type="button" className="bmde-btn" onClick={() => insert(':::tip[${cursor}Title]\n${sel|Body}\n:::')}>💡</button>
          </div>
          <div className="bmde-spacer" />
          {tabs
            ? <div className="bmde-tabbar" role="tablist">
              <button type="button" role="tab" aria-selected={tab === 'write'} className={`bmde-tab${tab === 'write' ? ' is-on' : ''}`} onClick={() => setTab('write')}>{L.write}</button>
              <button type="button" role="tab" aria-selected={tab === 'preview'} className={`bmde-tab${tab === 'preview' ? ' is-on' : ''}`} onClick={() => setTab('preview')}>{L.preview}</button>
            </div>
            : null}
          {!narrow && layout === 'auto' && (
            <button type="button" className="bmde-btn bmde-btn-ghost" title={mode === 'tabs' ? L.split : L.tabs} onClick={() => setMode(mode === 'tabs' ? 'split' : 'tabs')}>{mode === 'tabs' ? '◫' : '▭'}</button>
          )}
          <button type="button" className={`bmde-btn bmde-btn-ghost${panel === 'links' ? ' is-on' : ''}${links.issues.length ? ' bmde-warn' : ''}`} onClick={() => setPanel(panel === 'links' ? null : 'links')}>
            {L.links}{links.issues.length ? ` · ${links.issues.length}` : ''}
          </button>
          <button type="button" className={`bmde-btn bmde-btn-ghost${panel === 'outline' ? ' is-on' : ''}`} onClick={() => setPanel(panel === 'outline' ? null : 'outline')}>{L.outline}</button>
          <button type="button" className={`bmde-btn bmde-btn-ghost${panel === 'ast' ? ' is-on' : ''}`} onClick={() => setPanel(panel === 'ast' ? null : 'ast')}>{L.ast}</button>
          <button type="button" className="bmde-btn bmde-btn-ghost" onClick={doExport}>{L.export}</button>
        </div>
      )}

      <div className="bmde-body">
        {tabs ? (tab === 'write' ? editor : preview) : <>{editor}{preview}</>}
      </div>

      {panel && (
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
            <ul className="bmde-outline">{outline.map((h, n) => <li key={n} className={`bmde-outline-l${h.depth}`}><button type="button" onClick={() => jumpToHeading(h)}>{h.text}</button> <span className="bmde-faint">#{h.id}</span></li>)}</ul>
          )}
          {panel === 'ast' && <pre className="bmde-ast">{ast}</pre>}
        </div>
      )}

      {status && (
        <div className="bmde-status">
          <span>{stats.words} {L.words} · {stats.chars} {L.chars}</span>
          <span className={links.issues.length ? 'bmde-warn' : ''}>{links.issues.length ? `${links.issues.length} ${L.issues}` : `✓ ${L.links}`}</span>
          <label className="bmde-wrap"><input type="checkbox" checked={wrap} onChange={(e) => setWrap(e.target.checked)} /> {L.wrap}</label>
        </div>
      )}
    </div>
  );
}
