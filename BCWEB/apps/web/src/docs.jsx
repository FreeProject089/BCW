import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { BookOpen, Plus, Pencil, Trash2, Search, PanelLeftClose, Menu, Save, Languages, Smile, Meh, Frown, CornerDownLeft, X, ChevronRight, Hash } from 'lucide-react';
import { api } from './api.js';
import { useAuth } from './auth.jsx';
import { useI18n } from './i18n.jsx';
import Markdown, { IconGlyph } from './md.jsx';
import { MarkdownEditor } from './blog.jsx';
import { useToast, useDialog, Button, Spinner, Modal, Input, Select, Field, EmptyState } from './ui.jsx';

// BCWEB documentation — a GitBook-style space rendered with the doc-block markdown
// system. Public read; ADMIN/SUPERADMIN (the "special role") get an inline editor.
export default function Docs() {
  const { slug } = useParams();
  const nav = useNavigate();
  const { lang } = useI18n();
  const [tree, setTree] = useState([]);
  const [canEdit, setCanEdit] = useState(false);
  const [page, setPage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [sidebar, setSidebar] = useState(() => typeof window === 'undefined' || window.innerWidth >= 768);
  const [search, setSearch] = useState(false); // ⌘K palette
  const [editing, setEditing] = useState(null); // page object being edited, or {} for new
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
    api.get(`/docs/${target}`).then((r) => setPage(r.page)).catch(() => setPage(null)).finally(() => setLoading(false));
  }, [slug, firstSlug]);

  // Global ⌘K / Ctrl-K opens the search palette.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearch(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Swipe from the left edge opens the sidebar drawer on touch devices.
  useEffect(() => {
    let sx = null, sy = null;
    const ts = (e) => { const t = e.touches[0]; if (t && t.clientX <= 28 && window.innerWidth < 768) { sx = t.clientX; sy = t.clientY; } else sx = null; };
    const te = (e) => { if (sx == null) return; const t = e.changedTouches[0]; if (t && t.clientX - sx > 55 && Math.abs(t.clientY - sy) < 45) setSidebar(true); sx = null; };
    window.addEventListener('touchstart', ts, { passive: true });
    window.addEventListener('touchend', te, { passive: true });
    return () => { window.removeEventListener('touchstart', ts); window.removeEventListener('touchend', te); };
  }, []);

  const filtered = useMemo(() => {
    if (!q.trim()) return tree;
    const n = q.toLowerCase();
    return tree.map((c) => ({ ...c, pages: c.pages.filter((p) => p.title.toLowerCase().includes(n) || c.category.toLowerCase().includes(n)) }))
      .filter((c) => c.pages.length);
  }, [tree, q]);

  const body = page ? (lang === 'fr' && page.bodyFr ? page.bodyFr : page.body) : '';
  // Map of /docs/<slug> → { title, category } for link hover-previews.
  const pageMap = useMemo(() => { const m = {}; tree.forEach((c) => c.pages.forEach((p) => { m[`/docs/${p.slug}`] = { title: p.title, category: c.category }; })); return m; }, [tree]);
  const onSaved = async (savedSlug) => { setEditing(null); await loadTree(); if (savedSlug) nav(`/docs/${savedSlug}`); else if (slug) { const r = await api.get(`/docs/${slug}`).catch(() => null); if (r) setPage(r.page); } };
  const activeSlug = slug || firstSlug;
  const goTo = (r) => {
    setSearch(false);
    if (window.innerWidth < 768) setSidebar(false);
    const slug = typeof r === 'object' ? r.slug : r;
    const anchor = typeof r === 'object' ? r.anchor : null;
    nav(`/docs/${slug}${anchor ? '#' + anchor : ''}`);
    if (anchor) setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 350);
  };

  return (
    <div className="flex flex-col md:flex-row gap-4 md:gap-6 items-start">
      {/* Mobile drawer backdrop */}
      {sidebar && <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden" onClick={() => setSidebar(false)} />}
      {/* Sidebar — slide-in drawer on phone (swipe from the left edge or tap the
          button), sticky rail on desktop. */}
      <aside className={`fixed md:sticky inset-y-0 md:inset-auto left-0 md:top-20 z-50 md:z-auto w-[82%] max-w-xs md:w-64 md:max-w-none md:shrink-0 md:max-h-[calc(100vh-6rem)] overflow-auto no-scrollbar p-4 md:p-3.5 md:rounded-2xl md:border md:border-[var(--line)] bg-[var(--bg-solid)] md:bg-[var(--surface-2)] transition-transform md:transition-none ${sidebar ? 'translate-x-0 md:block' : '-translate-x-full md:hidden'}`}
        style={{ boxShadow: 'var(--shadow, none)' }}>
        <div className="md:hidden flex justify-end -mt-1 mb-1"><button onClick={() => setSidebar(false)} className="text-[var(--faint)] hover:text-[var(--text)]"><X size={18} /></button></div>
        <div className="flex items-center gap-2 mb-3">
          <BookOpen size={18} className="text-[var(--primary)]" />
          <span className="font-bold">Documentation</span>
        </div>
          <button onClick={() => setSearch(true)}
            className="w-full flex items-center gap-2 px-3 py-2 mb-2.5 rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] text-sm text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--line-strong)] transition">
            <Search size={14} /> <span className="flex-1 text-left">Search…</span>
            <kbd className="text-[10px] font-semibold px-1.5 py-0.5 rounded-lg border border-[var(--line)] bg-[var(--bg)]">⌘K</kbd>
          </button>
          <div className="relative mb-4">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter pages…" className="!py-2 !text-sm !rounded-2xl" />
          </div>
          {filtered.map((cat) => { const isCollapsed = collapsed.has(cat.category) && !q.trim(); return (
            <div key={cat.category} className="mb-3">
              <button onClick={() => toggleCat(cat.category)} className="w-full flex items-center gap-1 px-1.5 mb-1 text-[11px] font-bold uppercase tracking-wide text-[var(--faint)] hover:text-[var(--muted)]">
                <ChevronRight size={12} className={`transition-transform ${isCollapsed ? '' : 'rotate-90'}`} /> {cat.category}
              </button>
              {!isCollapsed && cat.pages.map((p) => (
                <Link key={p.slug} to={`/docs/${p.slug}`} onClick={() => { if (window.innerWidth < 768) setSidebar(false); }}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition ${activeSlug === p.slug ? 'bg-[var(--primary)]/10 text-[var(--primary)] font-medium' : 'text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]'}`}>
                  <IconGlyph name={p.icon || 'file'} size={14} className={activeSlug === p.slug ? 'text-[var(--primary)]' : 'text-[var(--faint)]'} />
                  <span className="truncate flex-1">{p.title}</span>
                  {!p.published && <span className="text-[10px] text-orange-400 shrink-0">draft</span>}
                </Link>
              ))}
            </div>
          ); })}
        {canEdit && <Button size="sm" variant="ghost" className="w-full mt-1" onClick={() => setEditing({})}><Plus size={14} /> New page</Button>}
      </aside>

      {/* Content */}
      <main className="flex-1 min-w-0 w-full max-w-3xl">
        <div className="flex items-center gap-2 mb-2">
          <button className="btn btn-sm" onClick={() => setSidebar((v) => !v)} title="Toggle sidebar"><PanelLeftClose size={15} className="hidden md:block" /><Menu size={15} className="md:hidden" /></button>
          {canEdit && page && <div className="ml-auto flex gap-2">
            <Button size="sm" onClick={() => setEditing(page)}><Pencil size={14} /> Edit</Button>
          </div>}
          {canEdit && !page && <Button size="sm" className="ml-auto" onClick={() => setEditing({})}><Plus size={14} /> New page</Button>}
        </div>

        {loading ? <div className="py-20 grid place-items-center"><Spinner /></div>
          : page ? (
            <article>
              <h1 className="text-2xl md:text-3xl font-extrabold mb-1">{page.title}</h1>
              <div className="text-xs text-[var(--faint)] mb-6">Updated {new Date(page.updatedAt).toLocaleDateString()}</div>
              <PageTocMobile body={body} />
              {lang === 'fr' && !page.bodyFr && <div className="mb-5 p-3 rounded-lg border border-[var(--line)] bg-orange-500/5 text-sm text-[var(--muted)] flex items-center gap-2"><Languages size={15} className="text-[var(--primary-2)]" /> Cette page n'est pas encore traduite en français — version anglaise affichée.</div>}
              <Markdown pageMap={pageMap}>{body || '*This page is empty.*'}</Markdown>
              <HelpfulWidget page={page} canEdit={canEdit} />
            </article>
          ) : (
            <EmptyState icon={BookOpen} title="No documentation yet" sub={canEdit ? 'Create the first page to get started.' : 'Check back soon.'}>
              {canEdit && <Button variant="primary" onClick={() => setEditing({})}><Plus size={15} /> New page</Button>}
            </EmptyState>
          )}
      </main>

      {page && <PageToc body={body} />}

      {search && <SearchPalette onClose={() => setSearch(false)} onPick={goTo} />}
      {editing && <DocEditor page={editing.id ? editing : null} tree={tree} onClose={() => setEditing(null)} onSaved={onSaved} />}
    </div>
  );
}

const tocSlug = (s) => String(s).toLowerCase().trim().replace(/[^\wÀ-ɏ]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'section';
const tocHeads = (body) => (String(body || '').match(/^#{2,3}\s+.+$/gm) || []).map((h) => {
  const depth = (h.match(/^#+/) || ['##'])[0].length; const text = h.replace(/^#+\s+/, '').trim();
  return { depth, text, id: tocSlug(text) };
});

/* Collapsible "On this page" shown above the article on phones/tablets (< xl). */
function PageTocMobile({ body }) {
  const heads = useMemo(() => tocHeads(body), [body]);
  if (heads.length < 2) return null;
  const go = (e, id) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); history.replaceState(null, '', `#${id}`); };
  return (
    <details className="xl:hidden mb-6 rounded-xl border border-[var(--line)] bg-[var(--surface-2)]">
      <summary className="doc-toc-m-summary cursor-pointer list-none px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide text-[var(--faint)] flex items-center gap-2">
        <ChevronRight size={13} className="doc-toc-m-chevron transition-transform" /> On this page
      </summary>
      <nav className="px-3 pb-3 space-y-0.5">
        {heads.map((h) => <a key={h.id} href={`#${h.id}`} onClick={(e) => go(e, h.id)} className={`block py-1 text-sm text-[var(--muted)] hover:text-[var(--primary)] ${h.depth === 3 ? 'pl-4 text-[13px]' : ''}`}>{h.text}</a>)}
      </nav>
    </details>
  );
}

/* GitBook-style right rail: the current page's headings, with the section in view
   highlighted (IntersectionObserver against the anchor ids the renderer emits). */
function PageToc({ body }) {
  const heads = useMemo(() => (String(body || '').match(/^#{2,3}\s+.+$/gm) || []).map((h) => {
    const depth = (h.match(/^#+/) || ['##'])[0].length; const text = h.replace(/^#+\s+/, '').trim();
    return { depth, text, id: tocSlug(text) };
  }), [body]);
  const [active, setActive] = useState(null);
  useEffect(() => {
    if (heads.length < 2) return;
    const obs = new IntersectionObserver((entries) => {
      const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (vis[0]) setActive(vis[0].target.id);
    }, { rootMargin: '-80px 0px -70% 0px' });
    const els = heads.map((h) => document.getElementById(h.id)).filter(Boolean);
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [heads]);
  if (heads.length < 2) return null;
  return (
    <aside className="hidden xl:block w-52 shrink-0 sticky top-20 self-start max-h-[calc(100vh-6rem)] overflow-auto no-scrollbar">
      <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--faint)] mb-2">On this page</div>
      <nav className="border-l border-[var(--line)]">
        {heads.map((h) => (
          <a key={h.id} href={`#${h.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(h.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); history.replaceState(null, '', `#${h.id}`); }}
            className={`block -ml-px border-l-2 py-1 text-sm leading-snug ${h.depth === 3 ? 'pl-6 text-[13px]' : 'pl-3'} ${active === h.id ? 'border-[var(--primary)] text-[var(--primary)] font-medium' : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'}`}>
            {h.text}
          </a>
        ))}
      </nav>
    </aside>
  );
}

/* ⌘K command-palette search over doc titles + bodies (server-side ranked). */
// Wrap every case-insensitive occurrence of `q` in <mark> for result highlighting.
function highlight(text, q) {
  const s = String(text || ''); const needle = String(q || '').trim();
  if (!needle) return s;
  const parts = []; let i = 0; const low = s.toLowerCase(); const nl = needle.toLowerCase();
  while (i < s.length) {
    const idx = low.indexOf(nl, i);
    if (idx < 0) { parts.push(s.slice(i)); break; }
    if (idx > i) parts.push(s.slice(i, idx));
    parts.push(<mark key={idx} className="doc-hl">{s.slice(idx, idx + needle.length)}</mark>);
    i = idx + needle.length;
  }
  return parts;
}
const RECENT_KEY = 'doc-search-recent';
const readRecent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; } };

function SearchPalette({ onClose, onPick }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [recent] = useState(readRecent);
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
  const rows = showRecent ? recent : results;
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
  const Row = (r, i) => (
    <button key={`${r.slug}-${r.anchor || 'page'}-${i}`} data-active={i === active ? '1' : '0'} onMouseEnter={() => setActive(i)} onClick={() => pick(r)}
      className={`w-full text-left px-3.5 py-2.5 flex items-center gap-3 rounded-xl transition ${i === active ? 'bg-[var(--primary)]/12' : 'hover:bg-[var(--surface-2)]'}`}>
      <span className={`grid place-items-center w-8 h-8 rounded-lg shrink-0 ${i === active ? 'text-[var(--primary)] bg-[var(--primary)]/15' : 'text-[var(--muted)] bg-[var(--surface-2)]'}`}>
        {r.section ? <Hash size={15} /> : <IconGlyph name={r.icon || 'file'} size={15} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{r.section ? <>{highlight(r.section, q)} <span className="text-[var(--faint)] font-normal">· {r.title}</span></> : highlight(r.title, q)}</div>
        {r.section ? <div className="text-xs text-[var(--faint)] truncate">{r.title}</div>
          : r.snippet ? <div className="text-xs text-[var(--muted)] truncate">{highlight(r.snippet, q)}</div>
          : <div className="text-xs text-[var(--faint)] truncate">{r.category}</div>}
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
            placeholder="Search the documentation…" className="flex-1 bg-transparent border-0 outline-none py-3.5 text-[15px] text-[var(--text)]" />
          {loading && <Spinner className="!w-4 !h-4 text-[var(--faint)]" />}
          <button onClick={onClose} className="text-[var(--faint)] hover:text-[var(--text)] shrink-0"><X size={16} /></button>
        </div>
        <div ref={listRef} className="max-h-[54vh] overflow-auto p-1.5">
          {showRecent && <div className="px-2.5 pt-1 pb-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--faint)]">Recent</div>}
          {q.trim().length >= 2 && loading && !results.length ? <div className="px-4 py-10 grid place-items-center"><Spinner /></div>
            : q.trim().length >= 2 && !results.length ? <div className="px-4 py-10 text-center text-sm text-[var(--faint)]">No results for “{q}”.</div>
            : rows.length ? rows.map(Row)
            : <div className="px-4 py-10 text-center text-sm text-[var(--faint)]">Search titles and section headings across the docs.</div>}
        </div>
        <div className="flex items-center gap-3 px-4 py-2 border-t border-[var(--line)] text-[11px] text-[var(--faint)]">
          <span className="flex items-center gap-1"><kbd className="doc-kbd-hint">↑</kbd><kbd className="doc-kbd-hint">↓</kbd> navigate</span>
          <span className="flex items-center gap-1"><kbd className="doc-kbd-hint">↵</kbd> open</span>
          <span className="flex items-center gap-1"><kbd className="doc-kbd-hint">esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}

/* "Was this helpful?" — 3-face rating (good/ok/bad), one vote per browser. */
function HelpfulWidget({ page, canEdit }) {
  const key = `doc-fb-${page.id}`;
  const read = () => { try { return localStorage.getItem(key); } catch { return null; } };
  const [voted, setVoted] = useState(read);
  const [counts, setCounts] = useState({ good: page.helpfulYes || 0, ok: page.helpfulOk || 0, bad: page.helpfulNo || 0 });
  useEffect(() => { setCounts({ good: page.helpfulYes || 0, ok: page.helpfulOk || 0, bad: page.helpfulNo || 0 }); setVoted(read()); /* eslint-disable-next-line */ }, [page.id]);
  const vote = async (rating) => {
    if (voted) return;
    setVoted(rating); try { localStorage.setItem(key, rating); } catch {}
    setCounts((c) => ({ ...c, [rating]: c[rating] + 1 }));
    try { const r = await api.post(`/docs/${page.id}/feedback`, { rating }); setCounts({ good: r.helpfulYes, ok: r.helpfulOk, bad: r.helpfulNo }); } catch {}
  };
  const FACES = [['good', Smile, 'text-emerald-500', 'hover:border-emerald-500 hover:text-emerald-500'], ['ok', Meh, 'text-amber-500', 'hover:border-amber-500 hover:text-amber-500'], ['bad', Frown, 'text-red-500', 'hover:border-red-500 hover:text-red-500']];
  return (
    <div className="mt-12 pt-6 border-t border-[var(--line)] flex flex-col items-center gap-2.5">
      <span className="text-sm text-[var(--muted)]">{voted ? 'Thanks for your feedback!' : 'Was this page helpful?'}</span>
      <div className="flex items-center gap-2">
        {FACES.map(([r, Ico, on, hov]) => (
          <button key={r} disabled={!!voted} onClick={() => vote(r)} title={r}
            className={`w-11 h-11 grid place-items-center rounded-full border transition ${voted === r ? `border-current ${on}` : `border-[var(--line)] text-[var(--muted)] ${voted ? '' : hov}`} ${voted ? 'cursor-default' : ''}`}>
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

/* Role-gated page editor (title, category, icon, order, publish, EN + FR body). */
function DocEditor({ page, tree, onClose, onSaved }) {
  const toast = useToast(); const dialog = useDialog();
  const categories = [...new Set(tree.map((c) => c.category))];
  const [f, setF] = useState({ title: '', category: 'General', icon: '', order: 0, published: true, body: '', bodyFr: '' });
  const [tab, setTab] = useState('en');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (page) setF({ title: page.title || '', category: page.category || 'General', icon: page.icon || '', order: page.order || 0, published: page.published !== false, body: '', bodyFr: '' });
    // full bodies aren't in the sidebar tree — fetch the page.
    if (page?.slug) api.get(`/docs/${page.slug}`).then((r) => setF((s) => ({ ...s, body: r.page.body || '', bodyFr: r.page.bodyFr || '' }))).catch(() => {});
    // eslint-disable-next-line
  }, [page?.id]);

  const save = async () => {
    if (f.title.trim().length < 1) return toast.error('A title is required.');
    setBusy(true);
    try {
      const b = { title: f.title, category: f.category || 'General', icon: f.icon || null, order: Number(f.order) || 0, published: f.published, body: f.body, bodyFr: f.bodyFr || null };
      const r = page ? await api.patch(`/docs/${page.id}`, b) : await api.post('/docs', b);
      toast.success(page ? 'Page saved.' : 'Page created.');
      onSaved(r.page?.slug);
    } catch (x) { toast.error(x.data?.error === 'forbidden' ? 'You don’t have permission.' : x.data?.error || 'Failed.'); }
    finally { setBusy(false); }
  };
  const del = async () => {
    if (!page) return;
    if (!(await dialog.confirm({ title: 'Delete page', message: `Delete “${page.title}”? This cannot be undone.`, okLabel: 'Delete', danger: true }))) return;
    try { await api.del(`/docs/${page.id}`); toast.success('Deleted.'); onSaved(); } catch { toast.error('Failed.'); }
  };
  const fr = tab === 'fr';

  return (
    <Modal open onClose={onClose} title={page ? 'Edit page' : 'New page'} icon={BookOpen} width="max-w-3xl"
      footer={<>
        {page && <Button variant="ghost" className="!text-red-400 mr-auto" onClick={del}><Trash2 size={15} /> Delete</Button>}
        <label className="flex items-center gap-1.5 text-sm text-[var(--muted)] mr-2"><input type="checkbox" checked={f.published} onChange={(e) => setF({ ...f, published: e.target.checked })} /> Published</label>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : <><Save size={15} /> Save</>}</Button>
      </>}>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto_auto] gap-2 mb-3">
        <Field label="Title"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Page title" /></Field>
        <Field label="Category"><Input list="doc-cats" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="General" />
          <datalist id="doc-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist></Field>
        <Field label="Icon"><Input value={f.icon} onChange={(e) => setF({ ...f, icon: e.target.value })} placeholder="book" className="!w-24" /></Field>
        <Field label="Order"><Input type="number" value={f.order} onChange={(e) => setF({ ...f, order: e.target.value })} className="!w-20" /></Field>
      </div>
      <div className="flex items-center gap-1 mb-2">
        {[['en', 'English (base)'], ['fr', 'Français']].map(([l, label]) => (
          <button key={l} type="button" onClick={() => setTab(l)} className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5 border ${tab === l ? 'bg-[var(--surface-2)] border-[var(--line)] font-medium' : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'}`}>
            <Languages size={13} /> {label}{l === 'fr' && f.bodyFr && <span className="text-[10px] text-emerald-400">✓</span>}
          </button>
        ))}
      </div>
      <MarkdownEditor full minHeight={300}
        value={fr ? f.bodyFr : f.body}
        onChange={(v) => setF((s) => (fr ? { ...s, bodyFr: v } : { ...s, body: v }))}
        placeholder={fr ? 'Traduction française (optionnelle)…' : 'Write with GitBook-style blocks — use the Blocks button.'} />
    </Modal>
  );
}
