import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { BookOpen, Plus, Pencil, Trash2, Search, PanelLeftClose, Menu, Save, Languages, Smile, Meh, Frown, CornerDownLeft, X, ChevronRight, Hash, History, MessageSquare, Globe, FolderTree, Eye } from 'lucide-react';
import { api } from '../lib/api.js';
import { merge3, hasConflictMarkers } from '../lib/merge3.js';
import HistoryModal from '../editor/history-modal.jsx';
import DiffMergeModal from '../editor/diff-merge-modal.jsx';
import CommentsModal from '../editor/comments-modal.jsx';
import { useAuth } from './auth.jsx';
import { useI18n } from '../i18n.jsx';
import Markdown, { IconGlyph, anchorEl, ANCHOR_PREFIX } from '../ui/md.jsx';
import { useSectionComments, useSectionCommentPills, AuthorsRow } from '../ui/post-bits.jsx';
import { MarkdownEditor } from '../editor/markdown-editor.jsx';
import { useToast, useDialog, Button, Spinner, Input, EmptyState, Explain } from '../ui/ui.jsx';
import { EntryModal, EntryActions, EntrySection, EntryField, FieldError, LangTabs, MergeBanner, useDirtyForm } from '../ui/entry-modal.jsx';

// BCWEB documentation — a docs space rendered with the B.MD block markdown
// system. Public read; ADMIN/SUPERADMIN (the "special role") get an inline editor.
export default function Docs() {
  const { slug } = useParams();
  const nav = useNavigate();
  const { lang, t } = useI18n();
  const [tree, setTree] = useState([]);
  const [canEdit, setCanEdit] = useState(false);
  const [page, setPage] = useState(null);
  const [contributors, setContributors] = useState([]); // everyone who edited this page
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [sidebar, setSidebar] = useState(() => typeof window === 'undefined' || window.innerWidth >= 768);
  const [search, setSearch] = useState(false); // ⌘K palette
  const [editing, setEditing] = useState(null); // page object being edited, or {} for new
  const [readerComments, setReaderComments] = useState(false); // public/editor comments viewer
  const [readerHistory, setReaderHistory] = useState(false); // read-only edit history (click the date)
  const articleRef = useRef(null);
  const [collapsed, setCollapsed] = useState(() => new Set()); // collapsed sidebar categories
  const toggleCat = (c) => setCollapsed((s) => { const n = new Set(s); n.has(c) ? n.delete(c) : n.add(c); return n; });

  const loadTree = () => api.get('/docs').then((r) => { setTree(r.tree || []); setCanEdit(!!r.canEdit); return r; });
  useEffect(() => { loadTree().catch(() => {}); }, []);

  // Resolve which page to show: the :slug, else the first page in the tree.
  const firstSlug = tree[0]?.pages?.[0]?.slug;
  useEffect(() => {
    const target = slug || firstSlug;
    if (!target) { setPage(null); setLoading(false); return; }
    setLoading(true);
    api.get(`/docs/${target}`).then((r) => { setPage(r.page); setContributors(r.contributors || []); }).catch(() => { setPage(null); setContributors([]); }).finally(() => setLoading(false));
  }, [slug, firstSlug]);

  // ⌘K / Ctrl-K is now the site-wide command palette (ui/command-palette.jsx, mounted in App),
  // which searches the docs too — so the docs page no longer binds its own global key (that would
  // double-fire). The docs full-text palette here stays reachable via the search button.

  // Swipe from the left edge opens the sidebar drawer on touch devices.
  useEffect(() => {
    let sx = null, sy = null;
    const ts = (e) => { const t = e.touches[0]; if (t && t.clientX <= 28 && window.innerWidth < 768) { sx = t.clientX; sy = t.clientY; } else sx = null; };
    const te = (e) => { if (sx == null) return; const t = e.changedTouches[0]; if (t && t.clientX - sx > 55 && Math.abs(t.clientY - sy) < 45) setSidebar(true); sx = null; };
    window.addEventListener('touchstart', ts, { passive: true });
    window.addEventListener('touchend', te, { passive: true });
    return () => { window.removeEventListener('touchstart', ts); window.removeEventListener('touchend', te); };
  }, []);
  // When the mobile drawer is open, lock body scroll — otherwise the page scrolls
  // behind the fixed drawer and the footer ends up overlapping the sidebar.
  useEffect(() => {
    if (sidebar && typeof window !== 'undefined' && window.innerWidth < 768) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prev; };
    }
  }, [sidebar]);

  const filtered = useMemo(() => {
    if (!q.trim()) return tree;
    const n = q.toLowerCase();
    // Search both languages: someone reading in French may still search an English term.
    return tree.map((c) => ({ ...c, pages: c.pages.filter((p) => [p.title, p.titleFr, c.category, c.categoryFr].filter(Boolean).join(' ').toLowerCase().includes(n)) }))
      .filter((c) => c.pages.length);
  }, [tree, q]);
  // Nested sidebar of ARBITRARY depth: a category written "Top / Sub / Sub-sub" (slash-
  // separated) becomes nested groups, no schema change and no fixed level cap — the old code
  // stopped at one sub-level. Each node keeps a full `path` (used as the collapse key, so two
  // groups that share a leaf name under different parents don't collapse together) and a
  // recursive `count` of every page beneath it. Order follows the pages' order within a group.
  const nested = useMemo(() => {
    const root = { name: '', path: '', pages: [], children: new Map(), count: 0 };
    for (const cat of filtered) {
      const parts = cat.category.split('/').map((s) => s.trim()).filter(Boolean);
      let node = root, path = '';
      for (const part of (parts.length ? parts : ['General'])) {
        path = path ? `${path}/${part}` : part;
        if (!node.children.has(part)) node.children.set(part, { name: part, path, pages: [], children: new Map(), count: 0 });
        node = node.children.get(part);
      }
      node.pages.push(...cat.pages);
    }
    const finalize = (n) => {
      const kids = [...n.children.values()].map(finalize);
      n.children = kids;
      n.count = n.pages.length + kids.reduce((s, k) => s + k.count, 0);
      return n;
    };
    return finalize(root).children;
  }, [filtered]);

  // One fallback rule for body AND titles: the French when there is one, the English
  // otherwise. The body already had this; the title did not, so a fully translated page
  // still appeared under an English name in the sidebar and the breadcrumb.
  const frOr = (v, base) => (lang === 'fr' && v && String(v).trim()) ? v : base;
  const body = page ? frOr(page.bodyFr, page.body) : '';
  const titleOf = (p) => frOr(p?.titleFr, p?.title);
  const catOf = (c) => frOr(c?.categoryFr, c?.category);
  // Comment pins on headings → hover a section to open its comments.
  const sectionComments = useSectionComments(page ? `/docs/${page.id}` : '', !!page);
  useSectionCommentPills(articleRef, sectionComments, () => setReaderComments(true), [sectionComments, page?.body, lang]);
  // Map of /docs/<slug> → { title, category } for link hover-previews.
  // Title, category, icon and a summary — the card has had a slot for the last one since it
  // was written and nothing ever filled it, so every preview was a title over a category.
  const pageMap = useMemo(() => {
    const m = {};
    tree.forEach((c) => c.pages.forEach((p) => {
      m[`/docs/${p.slug}`] = {
        title: titleOf(p), category: catOf(c), icon: p.icon || null,
        desc: (lang === 'fr' && p.summaryFr) || p.summary || null,
      };
    }));
    return m;
  }, [tree, lang]);
  const onSaved = async (savedSlug) => { setEditing(null); await loadTree(); if (savedSlug) nav(`/docs/${savedSlug}`); else if (slug) { const r = await api.get(`/docs/${slug}`).catch(() => null); if (r) { setPage(r.page); setContributors(r.contributors || []); } } };
  const activeSlug = slug || firstSlug;
  const goTo = (r) => {
    setSearch(false);
    if (window.innerWidth < 768) setSidebar(false);
    const slug = typeof r === 'object' ? r.slug : r;
    const anchor = typeof r === 'object' ? r.anchor : null;
    nav(`/docs/${slug}${anchor ? '#' + anchor : ''}`);
    if (anchor) setTimeout(() => anchorEl(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 350);
  };

  // Shared sidebar content — rendered in the desktop rail AND the mobile drawer.
  const sideInner = (
    <>
      <div className="flex items-center gap-2 mb-3">
        <BookOpen size={18} className="text-[var(--accent-ink)]" />
        <span className="font-bold">{t('docs.title')}</span>
      </div>
      <button onClick={() => setSearch(true)}
        className="w-full flex items-center gap-2 px-3 py-2 mb-2.5 rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] text-sm text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--line-strong)] transition">
        <Search size={14} /> <span className="flex-1 text-start">{t('docs.search')}</span>
        <kbd className="text-[10px] font-semibold px-1.5 py-0.5 rounded-lg border border-[var(--line)] bg-[var(--bg)]">⌘K</kbd>
      </button>
      <div className="relative mb-4">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('docs.filter')} className="!py-2 !text-sm !rounded-2xl" />
      </div>
      {(() => {
        const PageLink = (p) => (
          <Link key={p.slug} to={`/docs/${p.slug}`} onClick={() => { if (window.innerWidth < 768) setSidebar(false); }}
            className={`group relative flex items-center gap-2.5 ps-3 pe-2.5 py-1.5 rounded-lg text-sm transition ${activeSlug === p.slug ? 'tint-primary text-[var(--accent-ink)] font-medium' : 'text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]'}`}>
            {activeSlug === p.slug && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-full bg-[var(--primary)]" />}
            <IconGlyph name={p.icon || 'file'} size={14} className={activeSlug === p.slug ? 'text-[var(--accent-ink)]' : 'text-[var(--faint)] group-hover:text-[var(--muted)]'} />
            <span className="truncate flex-1">{titleOf(p)}</span>
            {!p.published && <span className="text-[10px] text-[var(--warning)] shrink-0">draft</span>}
          </Link>
        );
        // Recursive group renderer — one function, any depth. The search filter (q) force-
        // expands everything so a match is never hidden inside a collapsed sub-group.
        const renderNode = (node, depth) => {
          const isCollapsed = collapsed.has(node.path) && !q.trim();
          const head = depth === 0 ? 'text-[11px] text-[var(--faint)]' : 'text-[10px] text-[var(--faint)]';
          return (
            <div key={node.path} className={depth === 0 ? 'mb-3' : 'mt-1.5'}>
              <button onClick={() => toggleCat(node.path)} className={`w-full flex items-center gap-1 px-1 mb-1 font-bold uppercase tracking-wide hover:text-[var(--muted)] ${head}`}>
                <ChevronRight size={12} className={`transition-transform shrink-0 ${isCollapsed ? '' : 'rotate-90'}`} /> <span className="flex-1 text-start truncate" title={node.name}>{node.name}</span>
                <span className="text-[10px] font-semibold tabular-nums text-[var(--faint)] bg-[var(--surface-2)] rounded-full px-1.5 py-px">{node.count}</span>
              </button>
              {!isCollapsed && (
                <div className={depth === 0 ? 'space-y-0.5' : 'ms-2 border-s border-[var(--line)] ps-1.5 space-y-0.5'}>
                  {node.pages.map(PageLink)}
                  {node.children.map((c) => renderNode(c, depth + 1))}
                </div>
              )}
            </div>
          );
        };
        return nested.map((n) => renderNode(n, 0));
      })()}
      {canEdit && <Button size="sm" variant="ghost" className="w-full mt-1" onClick={() => setEditing({})}><Plus size={14} /> {t('docs.newpage')}</Button>}
    </>
  );

  return (
    <div className="flex flex-col md:flex-row gap-4 md:gap-6 items-start min-h-[60vh] pb-6">
      {/* Desktop rail (in-flow, sticky). */}
      {sidebar && (
        <aside className="hidden md:block md:sticky md:top-20 w-64 shrink-0 md:max-h-[calc(100vh-6rem)] overflow-auto no-scrollbar p-3.5 rounded-2xl border border-[var(--line)] bg-[var(--surface-2)]" style={{ boxShadow: 'var(--shadow, none)' }}>
          {sideInner}
        </aside>
      )}
      {/* Mobile drawer — PORTALED to <body>. The page's <main> has `animation:…both`
          (anim-fade) which makes it a permanent stacking context, so a fixed drawer
          rendered inside it paints BELOW the footer no matter its z-index. */}
      {sidebar && typeof document !== 'undefined' && createPortal(
        <div className="md:hidden fixed inset-0 z-[95]">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setSidebar(false)} />
          <aside className="absolute inset-y-0 left-0 w-[82%] max-w-xs overflow-auto no-scrollbar p-4" style={{ background: 'var(--bg-solid)', boxShadow: '8px 0 30px rgba(0,0,0,.35)' }}>
            <div className="flex justify-end -mt-1 mb-1"><button onClick={() => setSidebar(false)} className="text-[var(--faint)] hover:text-[var(--text)]"><X size={18} /></button></div>
            {sideInner}
          </aside>
        </div>, document.body)}

      {/* Content */}
      <main className="flex-1 min-w-0 w-full max-w-3xl xl:max-w-4xl 2xl:max-w-5xl">
        <div className="flex items-center gap-2 mb-2">
          <button className="btn btn-sm" onClick={() => setSidebar((v) => !v)} title={t('dcs.togglesidebar', "Toggle sidebar")}><PanelLeftClose size={15} className="hidden md:block" /><Menu size={15} className="md:hidden" /></button>
          {page && (canEdit || page.commentsPublic) && <div className="ms-auto flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setReaderComments(true)}><MessageSquare size={14} /> {t('docs.comments', 'Comments')}</Button>
            {canEdit && <Button size="sm" onClick={() => setEditing(page)}><Pencil size={14} /> {t('docs.edit')}</Button>}
          </div>}
          {canEdit && !page && <Button size="sm" className="ms-auto" onClick={() => setEditing({})}><Plus size={14} /> {t('docs.newpage')}</Button>}
        </div>

        {loading ? <div className="py-20 grid place-items-center"><Spinner /></div>
          : page ? (
            // Card surface behind the article so the text is legible over the page/orb
            // background — and it responds to Settings → Translucent surfaces
            // automatically ([data-surface-glass] .card).
            <article ref={articleRef} className="card p-5 sm:p-7">
              {/* Breadcrumb: Docs › Category › Subcategory › page title. */}
              <nav className="flex items-center gap-1.5 text-xs text-[var(--faint)] mb-3 flex-wrap">
                <Link to="/docs" className="hover:text-[var(--accent-ink)] transition">{t('docs.title', 'Docs')}</Link>
                {(catOf(page) || '').split('/').map((s) => s.trim()).filter(Boolean).map((c, i) => <span key={i} className="inline-flex items-center gap-1.5"><ChevronRight size={11} className="opacity-60" /> {c}</span>)}
                <ChevronRight size={11} className="opacity-60" /> <span className="text-[var(--muted)] font-medium truncate max-w-[220px]">{titleOf(page)}</span>
              </nav>
              <h1 className="text-2xl md:text-3xl font-extrabold mb-1">{titleOf(page)}</h1>
              <div className="flex items-center flex-wrap gap-x-3 gap-y-1.5 text-xs text-[var(--faint)] mb-6">
                <button onClick={() => setReaderHistory(true)} title={t('docs.history.hint', 'View edit history')} className="inline-flex items-center gap-1 hover:text-[var(--accent-ink)] transition">{t('docs.updated')} {new Date(page.updatedAt).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-US')} <History size={11} className="opacity-60" /></button>
                {contributors.length > 0 && <span className="inline-flex items-center gap-1.5">·
                  <AuthorsRow authors={contributors} size={20} />
                  {contributors.length > 1 && <span>{t('docs.contributors', '{n} contributors').replace('{n}', contributors.length)}</span>}
                </span>}
              </div>
              <PageTocMobile body={body} />
              {lang === 'fr' && !page.bodyFr && <div className="mb-5 p-3 rounded-lg border border-[var(--line)] bg-orange-500/5 text-sm text-[var(--muted)] flex items-center gap-2"><Languages size={15} className="text-[var(--accent-ink)]" /> {t('docs.notfr')}</div>}
              <Markdown pageMap={pageMap}>{body || t('docs.empty')}</Markdown>
              <HelpfulWidget page={page} canEdit={canEdit} />
            </article>
          ) : (
            <EmptyState icon={BookOpen} title={t('docs.none.title')}
              sub={canEdit ? t('docs.none.sub.admin2', 'Guides and reference for the apps live here, and no page has been written yet.') : t('docs.none.sub2', 'Guides and reference for the apps will live here, and nothing has been published yet.')}
              action={canEdit
                ? { label: t('docs.newpage'), onClick: () => setEditing({}), icon: Plus }
                : { label: t('docs.none.a', 'Read the blog'), to: '/blog', icon: BookOpen }} />
          )}
      </main>

      {page && <PageToc body={body} />}

      {search && <SearchPalette onClose={() => setSearch(false)} onPick={goTo} />}
      {readerComments && page && <CommentsModal base={`/docs/${page.id}`} body={body} onClose={() => setReaderComments(false)} onJump={(slug) => anchorEl(slug)?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />}
      {readerHistory && page && <HistoryModal base={`/docs/${page.id}`} onClose={() => setReaderHistory(false)} />}
      {editing && <DocEditor page={editing.id ? editing : null} draft={editing._draft || null} draftBase={editing._base || null} conflictReopen={!!editing._conflict}
        reopenDraft={(d, opts = {}) => setEditing(opts.page ? { ...opts.page, _draft: d, _base: opts.base || null, _conflict: !!opts.conflict } : { _draft: d })}
        tree={tree} onClose={() => setEditing(null)} onSaved={onSaved} />}
    </div>
  );
}

const tocSlug = (s) => String(s).toLowerCase().trim().replace(/[^\wÀ-ɏ]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'section';

// The renderer slugs a heading from its TEXT — the markdown having been parsed away. Reading
// the raw line here instead meant `## [Setup](/x)` produced `setup-x` against the renderer's
// `setup`, and the entry pointed at nothing. Also what stops backticks showing up in the rail.
const stripInline = (s) => String(s)
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, '$1$2')
    .replace(/\*([^*]+)\*|_([^_]+)_/g, '$1$2')
    .replace(/~~([^~]+)~~/g, '$1')
    .trim();
const tocHeads = (body) => {
  // A `## heading` inside a fenced code block is a line of sample code, not a section: it gets
  // no id from the renderer, so an entry for it can only ever point at nothing.
  const src = String(body || '').replace(/^```[^]*?^```/gm, '');
  return (src.match(/^#{2,3}\s+.+$/gm) || []).map((h) => {
    const depth = (h.match(/^#+/) || ['##'])[0].length;
    const text = stripInline(h.replace(/^#+\s+/, ''));
    return { depth, text, id: tocSlug(text) };
  });
};

/* Collapsible "On this page" shown above the article on phones/tablets (< xl). */
function PageTocMobile({ body }) {
  const { t } = useI18n();
  const heads = useMemo(() => tocHeads(body), [body]);
  if (heads.length < 2) return null;
  // The URL keeps the bare id — that is what a shared link should look like, and anchorEl
  // resolves both forms on arrival.
  const go = (e, id) => { e.preventDefault(); anchorEl(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); history.replaceState(null, '', `#${id}`); };
  return (
    <details className="xl:hidden mb-6 rounded-xl border border-[var(--line)] bg-[var(--surface-2)]">
      <summary className="doc-toc-m-summary cursor-pointer list-none px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide text-[var(--faint)] flex items-center gap-2">
        <ChevronRight size={13} className="doc-toc-m-chevron transition-transform" /> {t('docs.onthispage')}
      </summary>
      <nav className="px-3 pb-3 space-y-0.5">
        {heads.map((h) => <a key={h.id} href={`#${h.id}`} onClick={(e) => go(e, h.id)} className={`block py-1 text-sm text-[var(--muted)] hover:text-[var(--accent-ink)] ${h.depth === 3 ? 'ps-4 text-[13px]' : ''}`}>{h.text}</a>)}
      </nav>
    </details>
  );
}

/* Right rail: the current page's headings, with the section in view
   highlighted (IntersectionObserver against the anchor ids the renderer emits). */
function PageToc({ body }) {
  const { t } = useI18n();
  // The same reader the mobile contents uses. It was a second copy, and a copy of a rule is
  // wrong the first time the rule changes.
  const heads = useMemo(() => tocHeads(body), [body]);
  const [active, setActive] = useState(null);
  useEffect(() => {
    if (heads.length < 2) return;
    const obs = new IntersectionObserver((entries) => {
      const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      // The element carries the PREFIXED id and the list holds the bare one — compared raw,
      // nothing ever highlighted.
      if (vis[0]) setActive(vis[0].target.id.replace(ANCHOR_PREFIX, ''));
    }, { rootMargin: '-80px 0px -70% 0px' });
    // The article is rendered by a child, so on the first pass the headings do not exist yet
    // and this observed nothing — for the whole life of the page, because the effect only
    // re-runs when the headings change. That is why nothing was ever highlighted.
    let tries = 0; let timer = null;
    const attach = () => {
      const els = heads.map((h) => anchorEl(h.id)).filter(Boolean);
      if (els.length) { els.forEach((el) => obs.observe(el)); return; }
      if (tries++ < 20) timer = setTimeout(attach, 150);
    };
    attach();
    return () => { clearTimeout(timer); obs.disconnect(); };
  }, [heads]);
  if (heads.length < 2) return null;
  return (
    <aside className="hidden xl:block w-52 shrink-0 sticky top-20 self-start max-h-[calc(100vh-6rem)] overflow-auto no-scrollbar">
      <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--faint)] mb-2">{t('docs.onthispage')}</div>
      <nav className="border-s border-[var(--line)]">
        {heads.map((h) => (
          <a key={h.id} href={`#${h.id}`} onClick={(e) => { e.preventDefault(); anchorEl(h.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); history.replaceState(null, '', `#${h.id}`); }}
            className={`block -ms-px border-s-2 py-1 text-sm leading-snug ${h.depth === 3 ? 'ps-6 text-[13px]' : 'ps-3'} ${active === h.id ? 'border-[var(--primary)] text-[var(--accent-ink)] font-medium' : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'}`}>
            {h.text}
          </a>
        ))}
      </nav>
    </aside>
  );
}

/* ⌘K command-palette search over doc titles + bodies (server-side ranked). */
// Wrap every case-insensitive occurrence of `q` in <mark> for result highlighting.
// Highlight EACH query term, not just the whole string — so a multi-word search ("plugin
// permission") marks both words wherever they land, matching the multi-term backend ranking.
function highlight(text, q) {
  const s = String(text || '');
  const terms = [...new Set(String(q || '').toLowerCase().split(/\s+/).filter((w) => w.length >= 2))];
  if (!terms.length) return s;
  const low = s.toLowerCase();
  const parts = []; let i = 0;
  while (i < s.length) {
    // Nearest occurrence of any term from position i.
    let best = -1, bestLen = 0;
    for (const tm of terms) { const idx = low.indexOf(tm, i); if (idx >= 0 && (best < 0 || idx < best)) { best = idx; bestLen = tm.length; } }
    if (best < 0) { parts.push(s.slice(i)); break; }
    if (best > i) parts.push(s.slice(i, best));
    parts.push(<mark key={best} className="doc-hl">{s.slice(best, best + bestLen)}</mark>);
    i = best + bestLen;
  }
  return parts;
}
const RECENT_KEY = 'doc-search-recent';
const readRecent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; } };

function SearchPalette({ onClose, onPick }) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [recent, setRecent] = useState(readRecent);
  const clearRecent = () => { try { localStorage.removeItem(RECENT_KEY); } catch {} setRecent([]); };
  const inputRef = useRef(null);
  const listRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); setLoading(false); return; }
    setLoading(true);
    const id = setTimeout(() => {
      api.get(`/docs/search?q=${encodeURIComponent(q.trim())}`)
        .then((r) => { setResults(r.results || []); setActive(0); })
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 140);
    return () => clearTimeout(id);
  }, [q]);
  // Keep the active row in view when navigating with the keyboard.
  useEffect(() => { listRef.current?.querySelector('[data-active="1"]')?.scrollIntoView({ block: 'nearest' }); }, [active]);

  const showRecent = q.trim().length < 2 && recent.length > 0;
  // DocSearch-style grouping: one page row, its matching sections nested under it
  // with tree connectors (└) instead of a flat list of noisy rows.
  const rows = useMemo(() => {
    if (showRecent) return recent;
    const byPage = new Map();
    for (const r of results) {
      if (!byPage.has(r.slug)) byPage.set(r.slug, { page: null, sections: [] });
      const g = byPage.get(r.slug);
      if (r.section) g.sections.push(r); else g.page = r;
    }
    const out = [];
    for (const [slug, g] of byPage) {
      const head = g.sections[0] || {};
      out.push(g.page || { slug, title: head.title, category: head.category, icon: head.icon });
      for (const s of g.sections) out.push({ ...s, sub: true });
    }
    return out;
  }, [results, recent, showRecent]);
  const pick = (r) => {
    try {
      const next = [r, ...readRecent().filter((x) => !(x.slug === r.slug && x.anchor === r.anchor))].slice(0, 6);
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {}
    onPick(r);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') return onClose();
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, rows.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    if (e.key === 'Enter' && rows[active]) { e.preventDefault(); pick(rows[active]); }
  };
  const Row = (r, i) => r.sub ? (
    // Nested section hit: tree connector + # tile, page context muted below.
    <button key={`${r.slug}-${r.anchor || i}`} data-active={i === active ? '1' : '0'} onMouseEnter={() => setActive(i)} onClick={() => pick(r)}
      className={`w-full text-start pe-3.5 py-2 flex items-stretch gap-0 rounded-xl transition ${i === active ? 'tint-primary' : 'hover:bg-[var(--surface-2)]'}`}>
      <span className="relative w-9 shrink-0" aria-hidden>
        <span className="absolute left-[22px] -top-1 bottom-1/2 w-px bg-[var(--line-strong)]" />
        <span className="absolute left-[22px] top-1/2 w-2.5 h-px bg-[var(--line-strong)]" style={{ transform: 'translateY(-0.5px)' }} />
      </span>
      <span className={`self-center grid place-items-center w-7 h-7 rounded-lg shrink-0 ${i === active ? 'text-[var(--accent-ink)] tint-primary' : 'text-[var(--muted)] bg-[var(--surface-2)]'}`}><Hash size={13} /></span>
      <div className="min-w-0 flex-1 self-center ps-3">
        <div className="text-sm font-medium truncate">{highlight(r.section, q)}</div>
        <div className="text-[11px] text-[var(--faint)] truncate" title={r.title}>{r.title}</div>
      </div>
      {i === active && <CornerDownLeft size={14} className="self-center text-[var(--faint)] shrink-0" />}
    </button>
  ) : (
    <button key={`${r.slug}-page-${i}`} data-active={i === active ? '1' : '0'} onMouseEnter={() => setActive(i)} onClick={() => pick(r)}
      className={`w-full text-start px-3 py-2.5 flex items-center gap-3 rounded-xl transition ${i > 0 ? 'mt-1' : ''} ${i === active ? 'tint-primary' : 'hover:bg-[var(--surface-2)]'}`}>
      <span className={`grid place-items-center w-8 h-8 rounded-lg shrink-0 ${i === active ? 'text-[var(--accent-ink)] tint-primary' : 'text-[var(--muted)] bg-[var(--surface-2)]'}`}>
        <IconGlyph name={r.icon || 'file'} size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold truncate">{highlight(r.title, q)} <span className="text-[var(--faint)] font-normal text-xs">· {r.category}</span></div>
        {r.snippet && <div className="text-xs text-[var(--muted)] truncate">{highlight(r.snippet, q)}</div>}
      </div>
      {i === active && <CornerDownLeft size={14} className="text-[var(--faint)] shrink-0" />}
    </button>
  );
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[10vh] px-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="card modal-card w-full max-w-xl !rounded-2xl shadow-2xl overflow-hidden !p-0" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 px-4 border-b border-[var(--line)]">
          <Search size={17} className="text-[var(--muted)] shrink-0" />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
            placeholder={t('docs.search.ph')} className="flex-1 bg-transparent border-0 outline-none py-3.5 text-[15px] text-[var(--text)]" />
          {loading && <Spinner className="!w-4 !h-4 text-[var(--faint)]" />}
          <button onClick={onClose} className="text-[var(--faint)] hover:text-[var(--text)] shrink-0"><X size={16} /></button>
        </div>
        <div ref={listRef} className="max-h-[54vh] overflow-auto p-1.5">
          {showRecent && <div className="px-2.5 pt-1 pb-1.5 flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--faint)]">{t('docs.search.recent')}</span>
            <button onClick={clearRecent} className="text-[11px] text-[var(--faint)] hover:text-[var(--text)] flex items-center gap-1"><X size={11} /> {t('docs.search.clearrecent', 'Clear')}</button>
          </div>}
          {q.trim().length < 2 && !showRecent ? <div className="px-4 py-10 text-center text-sm text-[var(--faint)]">{t('docs.search.hint')}</div>
            : q.trim().length >= 2 && loading && !results.length ? <div className="px-4 py-10 grid place-items-center"><Spinner /></div>
            : q.trim().length >= 2 && !results.length ? <div className="px-4 py-10 text-center text-sm text-[var(--faint)]">{t('docs.search.none')} “{q}”.</div>
            : rows.length ? rows.map(Row)
            : <div className="px-4 py-10 text-center text-sm text-[var(--faint)]">{t('docs.search.hint')}</div>}
        </div>
        <div className="flex items-center gap-3 px-4 py-2 border-t border-[var(--line)] text-[11px] text-[var(--faint)]">
          <span className="flex items-center gap-1"><kbd className="doc-kbd-hint">↑</kbd><kbd className="doc-kbd-hint">↓</kbd> {t('docs.kb.nav')}</span>
          <span className="flex items-center gap-1"><kbd className="doc-kbd-hint">↵</kbd> {t('docs.kb.open')}</span>
          <span className="flex items-center gap-1"><kbd className="doc-kbd-hint">esc</kbd> {t('docs.kb.close')}</span>
        </div>
      </div>
    </div>
  );
}

/* "Was this helpful?" — 3-face rating (good/ok/bad), one vote per browser. */
function HelpfulWidget({ page, canEdit }) {
  const { t } = useI18n();
  const key = `doc-fb-${page.id}`;
  const read = () => { try { return localStorage.getItem(key); } catch { return null; } };
  const [voted, setVoted] = useState(read);
  const [counts, setCounts] = useState({ good: page.helpfulYes || 0, ok: page.helpfulOk || 0, bad: page.helpfulNo || 0 });
  useEffect(() => { setCounts({ good: page.helpfulYes || 0, ok: page.helpfulOk || 0, bad: page.helpfulNo || 0 }); setVoted(read()); /* eslint-disable-next-line */ }, [page.id]);
  // Clicking the face you already chose clears the vote locally; clicking another one changes
  // it. The old behaviour bailed on `if (voted) return`, so the first click was permanent — and
  // with the counts hidden from non-editors, a reader saw the buttons grey out and nothing else.
  // "It doesn't work" was a fair description of that.
  const vote = async (rating) => {
    const previous = voted;
    if (previous === rating) return;
    setVoted(rating); try { localStorage.setItem(key, rating); } catch {}
    setCounts((c) => ({ ...c, [rating]: c[rating] + 1, ...(previous ? { [previous]: Math.max(0, c[previous] - 1) } : {}) }));
    try {
      const r = await api.post(`/docs/${page.id}/feedback`, { rating, previous: previous || undefined });
      setCounts({ good: r.helpfulYes, ok: r.helpfulOk, bad: r.helpfulNo });
    } catch {
      // Put the optimistic change back rather than leaving a number the server never agreed to.
      setVoted(previous); try { previous ? localStorage.setItem(key, previous) : localStorage.removeItem(key); } catch {}
      setCounts({ good: page.helpfulYes || 0, ok: page.helpfulOk || 0, bad: page.helpfulNo || 0 });
    }
  };
  const FACES = [['good', Smile, 'text-success', 'hover:border-success hover:text-success'], ['ok', Meh, 'text-warning', 'hover:border-warning hover:text-warning'], ['bad', Frown, 'text-error', 'hover:border-error hover:text-error']];
  return (
    <div className="mt-12 pt-6 border-t border-[var(--line)] flex flex-col items-center gap-2.5">
      <span className="text-sm text-[var(--muted)]">{voted ? t('docs.helpful.thanks') : t('docs.helpful')}</span>
      <div className="flex items-center gap-2">
        {FACES.map(([r, Ico, on, hov]) => (
          <button key={r} onClick={() => vote(r)} title={r}
            className={`w-11 h-11 grid place-items-center rounded-full border transition ${voted === r ? `border-current ${on} cursor-default` : `border-[var(--line)] text-[var(--muted)] ${hov}`}`}>
            <Ico size={22} />
          </button>
        ))}
      </div>
      {canEdit && (counts.good + counts.ok + counts.bad > 0) && (
        <div className="flex items-center gap-3 text-xs text-[var(--faint)]">
          <span className="flex items-center gap-1"><Smile size={13} /> {counts.good}</span>
          <span className="flex items-center gap-1"><Meh size={13} /> {counts.ok}</span>
          <span className="flex items-center gap-1"><Frown size={13} /> {counts.bad}</span>
        </div>
      )}
    </div>
  );
}

/* Role-gated page editor (title, category, icon, order, publish, EN + FR body).
   The shell, the language tabs, the merge banner and the "don't throw my draft away" guard
   come from ui/entry-modal.jsx: this and the blog editor are the same screen over a different
   table, and they had drifted into two layouts with two sets of bugs. */
function DocEditor({ page, tree, onClose, onSaved, draft, draftBase, conflictReopen, reopenDraft }) {
  const toast = useToast(); const dialog = useDialog(); const { t } = useI18n();
  const categories = [...new Set(tree.map((c) => c.category))];
  const [f, setF] = useState({ title: '', titleFr: '', category: 'General', categoryFr: '', icon: '', order: 0, published: true, body: '', bodyFr: '', commentsPublic: false });
  const [tab, setTab] = useState('en');
  const [busy, setBusy] = useState(false);
  const [showComments, setShowComments] = useState(false);
  // Per-field validation messages. They used to be toasts, which is the wrong place for
  // "this field is empty": the message is four seconds long, it appears at the other end of
  // the screen, and it does not say which of the two title fields it means.
  const [errors, setErrors] = useState({});
  // Bumped once this editor has finished seeding itself from the server, so the unsaved-work
  // guard compares against the loaded page rather than against the blank form it mounted with.
  const [seed, setSeed] = useState(0);
  const dirty = useDirtyForm(f, seed);
  // Concurrent-edit tracking (see blog editor / merge3.js) — two admins editing the
  // same page merge git-style instead of one silently overwriting the other.
  const baseRef = useRef({ version: null, body: '', bodyFr: '' });
  const [merge, setMerge] = useState(null);
  const [mergeUI, setMergeUI] = useState(null); // visual conflict resolver queue
  const [showHistory, setShowHistory] = useState(false);
  useEffect(() => {
    // Restored after an "undo" on the save toast — re-seed the exact editor state (and
    // the original base version, so a post-conflict re-save can still 3-way-merge). No seed
    // bump: a restored draft IS unsaved work, and closing it must ask.
    if (draft) { setF(draft); if (draftBase) baseRef.current = draftBase; return; }
    if (page) setF({ title: page.title || '', titleFr: page.titleFr || '', category: page.category || 'General', categoryFr: page.categoryFr || '', icon: page.icon || '', order: page.order || 0, published: page.published !== false, body: '', bodyFr: '', commentsPublic: page.commentsPublic === true });
    // full bodies aren't in the sidebar tree — fetch the page.
    if (page?.slug) api.get(`/docs/${page.slug}`).then((r) => { setF((s) => ({ ...s, body: r.page.body || '', bodyFr: r.page.bodyFr || '' })); baseRef.current = { version: r.page.version ?? null, body: r.page.body || '', bodyFr: r.page.bodyFr || '' }; setSeed((n) => n + 1); }).catch(() => setSeed((n) => n + 1));
    else setSeed((n) => n + 1);
    // eslint-disable-next-line
  }, [page?.id]);

  // Writing into a field answers its own complaint.
  const set = (patch, clear) => { setF((s) => ({ ...s, ...patch })); if (clear) setErrors((e) => (e[clear] ? { ...e, [clear]: null } : e)); };
  const suffix = tab === 'fr' ? 'Fr' : '';
  const g = (base) => f[base + suffix] || '';
  const setLangField = (base, v) => set({ [base + suffix]: v }, base);
  // Which language tab the reader should be looking at when a message is about a field that
  // exists twice. A validation error nobody can see is a save that silently does nothing.
  const validate = () => {
    const e = {};
    if (!f.title.trim()) e.title = t('de.err.title', 'The English title is required: it names the page in the sidebar, the breadcrumb and every link to it.');
    if (hasConflictMarkers(f.body) || hasConflictMarkers(f.bodyFr)) e.body = t('be.conflicts', 'Resolve the conflict markers (<<<<<<< … >>>>>>>) first, then save.');
    setErrors(e);
    if (e.title) setTab('en');
    else if (e.body && hasConflictMarkers(f.bodyFr) && !hasConflictMarkers(f.body)) setTab('fr');
    return !Object.keys(e).length;
  };

  const save = async () => {
    if (!validate()) return;
    // The French fields are sent even when empty so clearing a translation actually clears
    // it — omitting them would leave the old value with no way to remove it.
    const b = { title: f.title, titleFr: f.titleFr || null, category: f.category || 'General', categoryFr: f.categoryFr || null, icon: f.icon || null, order: Number(f.order) || 0, published: f.published, body: f.body, bodyFr: f.bodyFr || null, commentsPublic: f.commentsPublic,
      ...(page && baseRef.current.version != null ? { baseVersion: baseRef.current.version } : {}) };

    // Optimistic save with an undo window (see the blog editor). Skipped mid-merge or on a
    // conflict re-save, which must save immediately so the resolver can engage.
    const canOptimistic = reopenDraft && !conflictReopen && merge == null && mergeUI == null;
    if (canOptimistic) {
      const snapshot = { ...f };
      const origBase = { ...baseRef.current };
      onClose();
      toast.action({
        tone: 'success', duration: 6000, cancelLabel: t('be.undo', 'Undo'),
        msg: page ? t('de.pagesaved', 'Page saved.') : t('de.pagecreated', 'Page created.'),
        onCommit: async () => {
          try { const r = page ? await api.patch(`/docs/${page.id}`, b) : await api.post('/docs', b); onSaved(r.page?.slug); }
          catch (x) {
            if (page && x.status === 409 && x.data?.current) { toast.error(t('be.conflict.reopen', 'Someone else edited this, reopened so you can merge, then Save.')); reopenDraft(snapshot, { page, base: origBase, conflict: true }); }
            else { toast.error(x.data?.error || t('be.failed', 'Failed.')); reopenDraft(snapshot, { page, base: origBase }); }
          }
        },
        onCancel: () => reopenDraft(snapshot, { page, base: origBase }),
      });
      return;
    }

    await commitSave(b);
  };

  // Immediate save (no undo window) — runs while the editor is open so the 3-way-merge
  // resolver can engage on a 409 conflict.
  const commitSave = async (b) => {
    setBusy(true);
    try {
      const r = page ? await api.patch(`/docs/${page.id}`, b) : await api.post('/docs', b);
      toast.success(page ? t('de.pagesaved', 'Page saved.') : t('de.pagecreated', 'Page created.'));
      onSaved(r.page?.slug);
    } catch (x) {
      if (x.status === 409 && x.data?.current) {
        const cur = x.data.current; const lbl = { mine: 'Your version', theirs: 'Their version' };
        const fields = [
          { field: 'body', langLabel: 'EN', base: baseRef.current.body, mine: f.body, theirs: cur.body || '' },
          { field: 'bodyFr', langLabel: 'FR', base: baseRef.current.bodyFr, mine: f.bodyFr || '', theirs: cur.bodyFr || '' },
        ];
        const patch = {}; const queue = [];
        for (const fd of fields) { const m = merge3(fd.base, fd.mine, fd.theirs, lbl); if (m.conflicts > 0) queue.push(fd); else patch[fd.field] = m.text; }
        if (Object.keys(patch).length) setF((s) => ({ ...s, ...patch }));
        baseRef.current = { version: cur.version, body: cur.body || '', bodyFr: cur.bodyFr || '' };
        setMerge({ conflicts: queue.length, pending: queue });
        if (queue.length > 0) { setMergeUI({ queue }); toast.info(t('de.conflictvisual', 'Someone else edited this page, resolve the conflicts visually, then Save.')); }
        else toast.info(t('de.mergedreview', 'Merged with edits made by someone else, review, then Save again.'));
      } else if (x.status === 409 && x.data?.error === 'docs_limit') {
        const d = x.data;
        toast.error(d.kind === 'count'
          ? t('de.fullcount', 'Docs are full, at most {limit} pages allowed (currently {current}). Delete one or raise the limit in Hosting settings.').replace('{limit}', d.limit).replace('{current}', d.current)
          : t('de.fullsize', 'Docs size limit ({kb} KB) would be exceeded{cur}. Trim the page, delete an old one, or raise the limit.').replace('{kb}', d.limitKB).replace('{cur}', d.currentKB ? t('de.wouldbe', ' (this would be ~{c} KB)').replace('{c}', d.currentKB) : ''));
      } else { toast.error(x.data?.error === 'forbidden' ? t('de.noperm', 'You don’t have permission.') : x.data?.error || t('be.failed', 'Failed.')); }
    }
    finally { setBusy(false); }
  };
  const del = async () => {
    if (!page) return;
    // Was "This cannot be undone", which the undo window below makes untrue. What it says
    // now is the part that stays true: there is a moment to take it back, and after that
    // the text, its history and every link pointing at this slug are gone.
    if (!(await dialog.confirm({ title: t('de.delpage', 'Delete page'),
      message: t('de.del.m', 'Delete “{n}”? Its text, edit history and comments go with it, and any link to it stops working. You get a moment to take it back, and after that nothing can be restored.').replace('{n}', page.title),
      okLabel: t('be.delete', 'Delete'), danger: true }))) return;
    // Mirrors save() above, and the blog editor's delete: close now, write when the toast
    // expires, reopen the editor untouched on Undo. No 409 branch — a DELETE sends no
    // baseVersion, so there is no version conflict to resolve.
    const snapshot = { ...f };
    const origBase = { ...baseRef.current };
    // Same as the blog editor: where the host can reopen the draft, Undo puts it back
    // untouched; where it cannot, Undo still means nothing was sent and the page is intact.
    const back = () => reopenDraft?.(snapshot, { page, base: origBase });
    onClose();
    toast.action({
      tone: 'success', duration: 6000, cancelLabel: t('be.undo', 'Undo'),
      msg: t('be.deleted', 'Deleted.'),
      onCommit: async () => {
        try { await api.del(`/docs/${page.id}`); onSaved(); }
        catch { toast.error(t('be.failed', 'Failed.')); back(); }
      },
      onCancel: back,
    });
  };
  const fr = tab === 'fr';
  // What the FR tab is really being asked: is there a translation behind it, and is it whole.
  const frState = f.bodyFr && f.titleFr ? 'full' : (f.bodyFr || f.titleFr) ? 'partial' : 'empty';

  return (
    <EntryModal title={page ? t('de.editpage', 'Edit page') : t('de.newpage', 'New page')} icon={BookOpen} width="max-w-3xl"
      dirty={dirty} busy={busy} onClose={onClose} onSave={save}
      footer={<EntryActions busy={busy} onSave={save} saveLabel={<><Save size={15} /> {t('de.save', 'Save')}</>}
        toggles={<label className="flex items-center gap-2 text-sm text-[var(--muted)] cursor-pointer">
          <input type="checkbox" checked={f.published} onChange={(e) => set({ published: e.target.checked })} />
          <Eye size={14} className={f.published ? 'text-success' : 'text-[var(--faint)]'} />
          {f.published ? t('de.published', 'Published') : t('de.draft', 'Draft')}
        </label>} />}>
      {/* The page's own tools. They used to sit in the footer beside Save, where on a phone
          they pushed it into a fourth wrapped row. */}
      {page && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Button size="sm" variant="ghost" onClick={() => setShowHistory(true)}><History size={14} /> {t('de.history', 'History')}</Button>
          <Button size="sm" variant="ghost" onClick={() => setShowComments(true)}><MessageSquare size={14} /> {t('docs.comments', 'Comments')}</Button>
          <Button size="sm" variant="ghost" className="!text-error ms-auto" onClick={del}><Trash2 size={14} /> {t('be.delete', 'Delete')}</Button>
        </div>
      )}
      <MergeBanner merge={merge} resolving={!!mergeUI?.queue?.length} onDismiss={() => setMerge(null)} onReopen={() => setMergeUI({ queue: merge.pending })} />

      <LangTabs tab={tab} onTab={setTab} frState={frState} className="mb-3" />
      {fr && <div className="text-xs text-[var(--muted)] mb-3 p-2.5 rounded-lg panel border border-[var(--line)] flex items-start gap-2">
        <Languages size={13} className="text-[var(--accent-ink)] shrink-0 mt-0.5" /> {t('de.frnote', 'The French version is optional. Leave a field empty and French readers get the English one, marked as not translated.')}
      </div>}

      {/* The common path and nothing else: what the page is called and what is on it. */}
      <EntryField label={fr ? t('dcs.titlefr', 'Titre (FR)') : t('dcs.title', 'Title')} error={errors.title}>
        <Input className="!text-lg !font-semibold !py-2.5" value={g('title')} aria-invalid={errors.title ? true : undefined}
          onChange={(e) => setLangField('title', e.target.value)} placeholder={t('dcs.ph.pagetitle', 'Page title')} />
      </EntryField>
      <div className="mt-4">
        <div className="text-xs font-medium text-[var(--muted)] mb-1.5">{t('de.content', 'Content')}{fr ? ' · FR' : ''}</div>
        <MarkdownEditor full minHeight={300}
          value={fr ? f.bodyFr : f.body}
          onChange={(v) => setLangField('body', v)}
          placeholder={fr ? t('de.ph.bodyfr', 'French translation (optional)…') : t('de.ph.body', 'Write with content blocks, use the Blocks button.')} />
        <FieldError>{errors.body}</FieldError>
      </div>

      {/* Everything below is set once and then rarely touched, so it folds. The fields that
          matter on every edit stay above the fold; the ones that matter on the first save are
          one click away, with their current value written on the fold itself. */}
      <EntrySection icon={FolderTree} title={t('de.sec.place', 'Where it sits in the sidebar')} status={[f.category, f.icon].filter(Boolean).join(' · ')}>
        <Explain summary={t('de.place.sum', 'The category builds the sidebar tree.')}>
          {t('de.place.body', 'Write "Guides / Setup" to nest this page under a subcategory, as many levels deep as you need. Inside a group, pages are sorted by the order number, lowest first. The icon is a name from the icon set, such as book or terminal.')}
        </Explain>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <EntryField label={t('dcs.category', 'Category')}>
            <Input list="doc-cats" value={f.category} onChange={(e) => set({ category: e.target.value })} placeholder={t('dcs.ph.cat', 'Guides / Setup')} />
            <datalist id="doc-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          </EntryField>
          <EntryField label={t('dcs.catfr', 'Catégorie (FR)')} hint={t('de.frhint', 'Optional, falls back to the English.')}>
            <Input value={f.categoryFr || ''} onChange={(e) => set({ categoryFr: e.target.value })} placeholder={t('dcs.ph.catfr', 'Guides / Installation')} />
          </EntryField>
          <EntryField label={t('de.icon', 'Icon')}>
            <Input value={f.icon} onChange={(e) => set({ icon: e.target.value })} placeholder="book" />
          </EntryField>
          <EntryField label={t('dcs.order', 'Order')}>
            <Input type="number" value={f.order} onChange={(e) => set({ order: e.target.value })} />
          </EntryField>
        </div>
      </EntrySection>

      <EntrySection icon={MessageSquare} title={t('de.sec.comments', 'Comments')} status={f.commentsPublic ? t('de.comments.on', 'Visible to readers') : t('de.comments.off', 'Editors only')}>
        <label className="flex items-start gap-2 cursor-pointer">
          <input type="checkbox" className="mt-0.5" checked={f.commentsPublic} onChange={(e) => set({ commentsPublic: e.target.checked })} />
          <span className="text-sm flex items-center gap-1.5">
            {f.commentsPublic ? <Globe size={13} className="text-success" /> : <MessageSquare size={13} />}
            {t('docs.comments.showReaders', 'Show the comment thread to readers on the published page')}
          </span>
        </label>
        <Explain summary={t('de.comments.sum', 'Comments are an editing tool first.')}>
          {t('de.comments.body', 'Off, the thread is private to the people who can edit this page. On, readers can read it on the published page, but they still cannot post: writing a comment stays with the editors.')}
        </Explain>
      </EntrySection>
      {showHistory && page && <HistoryModal base={`/docs/${page.id}`} onClose={() => setShowHistory(false)}
        onRestore={(rev) => { setF((s) => ({ ...s, title: rev.title || s.title, body: rev.body || '', bodyFr: rev.bodyFr ?? s.bodyFr })); setTab('en'); }} />}
      {showComments && page && <CommentsModal base={`/docs/${page.id}`} body={f.body} onClose={() => setShowComments(false)} />}
      {mergeUI?.queue?.length > 0 && (() => { const cur = mergeUI.queue[0]; return (
        <DiffMergeModal open base={cur.base} mine={cur.mine} theirs={cur.theirs} langLabel={cur.langLabel}
          onClose={() => setMergeUI(null)}
          onResolve={(text) => {
            setF((s) => ({ ...s, [cur.field]: text }));
            setMergeUI((m) => { const q = m.queue.slice(1); return q.length ? { queue: q } : null; });
            setMerge((mm) => ({ conflicts: Math.max(0, (mm?.conflicts || 1) - 1) }));
            if (cur.field === 'bodyFr') setTab('fr');
          }} />
      ); })()}
    </EntryModal>
  );
}
