import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useParams, useNavigate } from 'react-router-dom';
import {
  Newspaper, PenSquare, ImagePlus, Youtube, Link2, Video, Bold, Heading, List, Eye,
  Trash2, Pencil, ArrowLeft, CalendarDays, User as UserIcon, Plus, X, Tag as TagIcon, HelpCircle, Languages, Sparkles,
  Blocks as BlocksIcon, LayoutGrid, ChevronDown, ListOrdered, Milestone, Columns2, Code2, Keyboard, Smile, ListTree, FileDown, AlignCenter, GitMerge, History, MessageSquare, Globe,
  Table, Quote, Minus, AlignLeft, AlignRight, Mail, PlayCircle,
} from 'lucide-react';
import { api, uploadBlogImage, uploadReplay } from '../lib/api.js';
import { thumb } from '../lib/img.js';
import { useAuth } from './auth.jsx';
import { useI18n } from '../i18n.jsx';
import Markdown, { anchorEl } from '../ui/md.jsx';
import Avatar from '../ui/Avatar.jsx';
import { REACTION_OPTIONS, ReactionIcon } from '../ui/reactions.jsx';
import VisualEditor from '../editor/visual-editor.jsx';
import IconPicker from '../editor/icon-picker.jsx';
import SelectionToolbar from '../editor/selection-toolbar.jsx';
import KbdPicker from '../editor/kbd-picker.jsx';
import { merge3, hasConflictMarkers } from '../lib/merge3.js';
import HistoryModal from '../editor/history-modal.jsx';
import DiffMergeModal from '../editor/diff-merge-modal.jsx';
import CommentsModal from '../editor/comments-modal.jsx';
import { useToast, useDialog, Button, Card, Badge, Input, Textarea, Select, Field, PageHeader, EmptyState, Spinner, Modal } from '../ui/ui.jsx';

// Pick the reader's language version of a post. EN is the base (always present);
// FR is optional — when it's missing the reader sees the base marked "not translated".
function pickLang(p, lang) {
  if (lang === 'fr') {
    const translated = !!(p.bodyFr && p.bodyFr.trim());
    return { title: (p.titleFr || p.title), excerpt: (p.excerptFr || p.excerpt), body: (p.bodyFr || p.body), translated };
  }
  return { title: p.title, excerpt: p.excerpt, body: p.body, translated: true };
}

function useFetch(fn, deps) {
  const [data, setData] = useState(null); const [loading, setLoading] = useState(true);
  const reload = () => { setLoading(true); fn().then(setData).catch(() => setData(null)).finally(() => setLoading(false)); };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, deps);
  return { data, loading, reload };
}
const fmtDate = (d) => d ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';

// Author + collaborators avatar row. Solo → avatar + name; 2+ → avatars only.
export function AuthorsRow({ authors, size = 22 }) {
  const list = (authors || []).filter(Boolean);
  if (!list.length) return null;
  return (
    <span className="flex items-center gap-1.5 min-w-0">
      {/* Overlapping (stacked) avatars, NO ring — a background-coloured ring left a visible
          crescent ("demi-cercle") on any surface it didn't exactly match. Each avatar's own
          round edge is the separator; stacking right-to-left keeps the first one on top. */}
      <span className="flex -space-x-1.5 shrink-0">
        {list.slice(0, 4).map((a, i) => <span key={a.id || i} className="rounded-full" style={{ zIndex: 10 - i }} title={a.displayName}><Avatar user={a} size={size} /></span>)}
      </span>
      {list.length === 1 && <span className="text-xs text-[var(--faint)] truncate">{list[0].displayName}</span>}
    </span>
  );
}

// Per-project tag: real logo + label (community uses the BetterCommunity logo).
const TYPE_TAG = {
  community: { label: 'Community', img: '/logo.png' },
  bmm: { label: 'BMM', img: '/icons/bmm.png' },
  bsm: { label: 'BSM', img: '/icons/bsm.png' },
  installer: { label: 'BetterInstaller', img: '/icons/bi.png' },
};
function TypeTag({ post, className = '' }) {
  if (post?.showcaseProject) return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium text-[var(--muted)] ${className}`}>
      {post.showcaseProject.icon ? <img src={post.showcaseProject.icon} alt="" className="w-4 h-4 rounded object-contain" /> : <Sparkles size={14} className="text-[var(--primary-2)]" />} {post.showcaseProject.name}
    </span>
  );
  const m = TYPE_TAG[post?.project?.key] || TYPE_TAG.community;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium text-[var(--muted)] ${className}`}>
      <img src={m.img} alt="" className="w-4 h-4 rounded-[3px] object-contain" /> {m.label}
    </span>
  );
}

/* ── Blog list ── */
const BLOG_PAGE = 12; // posts fetched per "load more"
export function BlogList() {
  const { user } = useAuth(); const { lang, t } = useI18n();
  // Paginated load: keep a growing list of posts + a "load more" button rather than
  // fetching the whole blog up front.
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const loadPage = async (offset) => {
    const r = await api.get(`/blog?limit=${BLOG_PAGE}&offset=${offset}`);
    setHasMore(!!r.hasMore);
    setPosts((prev) => offset === 0 ? (r.posts || []) : [...prev, ...(r.posts || [])]);
    return r;
  };
  const reload = () => { setLoading(true); loadPage(0).catch(() => setPosts([])).finally(() => setLoading(false)); };
  const loadMore = () => { setLoadingMore(true); loadPage(posts.length).catch(() => {}).finally(() => setLoadingMore(false)); };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, []);
  const { data: scopeData } = useFetch(() => (user ? api.get('/blog/my-scopes') : Promise.resolve(null)), [user?.id]);
  const [editing, setEditing] = useState(null); // null = closed, {} = new, post = edit
  const isStaff = user && (user.role === 'ADMIN' || user.role === 'MOD' || user.role === 'SUPERADMIN');
  // A granted regular user can write, but can only edit THEIR OWN posts — never
  // staff's or another grantee's.
  const canWrite = isStaff || !!scopeData;
  const canEdit = (p) => isStaff || p.authorId === user?.id || (p.coAuthorIds || []).includes(user?.id);
  return (
    <div>
      <PageHeader icon={Newspaper} title={t('blog.title', 'Blog')} subtitle={t('blog.sub', 'News and updates across every project.')}
        actions={canWrite && <Button variant="primary" onClick={() => setEditing({})}><PenSquare size={16} /> {t('blog.write', 'Write a post')}</Button>} />
      {loading ? <div className="flex items-center gap-2 text-[var(--muted)] py-10"><Spinner /> {t('common.loading', 'Loading…')}</div>
        : posts.length ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {posts.map((p) => { const v = pickLang(p, lang); return (
              <div key={p.id} className="group relative">
                <Link to={`/blog/${p.slug}`}><Card hover className="overflow-hidden h-full flex flex-col">
                  {p.cover ? <img src={thumb(p.cover, 512)} alt="" className="w-full h-44 object-cover" />
                    : <div className="w-full h-44 bg-[var(--surface-2)] border-b border-[var(--line)] grid place-items-center">{p.showcaseProject?.icon ? <img src={p.showcaseProject.icon} alt="" className="w-14 h-14 rounded-xl object-contain opacity-90" /> : p.showcaseProject ? <Sparkles size={40} className="text-[var(--primary-2)] opacity-90" /> : <img src={(TYPE_TAG[p.project?.key] || TYPE_TAG.community).img} alt="" className="w-12 h-12 rounded-xl object-contain opacity-90" />}</div>}
                  <div className="p-5 flex-1 flex flex-col">
                    <div className="text-xs text-[var(--faint)] flex items-center gap-2">{fmtDate(p.publishedAt)}{!v.translated && <span className="inline-flex items-center gap-1 text-[var(--faint)]"><Languages size={11} /> {t('blog.untranslated', 'not translated')}</span>}</div>
                    <div className="font-bold mt-1.5 text-lg leading-snug">{v.title}</div>
                    {v.excerpt && <div className="text-sm text-[var(--muted)] mt-1.5 line-clamp-2 flex-1">{v.excerpt}</div>}
                    <div className="mt-4 pt-3 border-t border-[var(--line)] flex items-center justify-between">
                      <TypeTag post={p} />
                      <AuthorsRow authors={p.authors} />
                    </div>
                  </div>
                </Card></Link>
                {canWrite && canEdit(p) && <button onClick={() => setEditing(p)} className="absolute top-3 right-3 btn btn-sm opacity-0 group-hover:opacity-100 transition"><Pencil size={13} /></button>}
              </div>
            ); })}
          </div>
        ) : <EmptyState icon={Newspaper} title={t('blog.empty', 'No posts yet')} sub={canWrite ? t('blog.writefirst', 'Write the first one.') : undefined}>{canWrite && <Button variant="primary" onClick={() => setEditing({})}><Plus size={16} /> {t('blog.newpost', 'New post')}</Button>}</EmptyState>}
      {!loading && hasMore && <div className="flex justify-center mt-8">
        <Button onClick={loadMore} disabled={loadingMore}>{loadingMore ? <><Spinner /> {t('common.loading', 'Loading…')}</> : <><ChevronDown size={16} /> {t('blog.loadmore', 'Load more')}</>}</Button>
      </div>}
      <NewsletterSignup />
      {editing !== null && <BlogEditor post={editing.id ? editing : null} draft={editing._draft || null} draftBase={editing._base || null} conflictReopen={!!editing._conflict}
        reopenDraft={(d, opts = {}) => setEditing(opts.post ? { ...opts.post, _draft: d, _base: opts.base || null, _conflict: !!opts.conflict } : { _draft: d })}
        scopes={scopeData} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </div>
  );
}

// Blog newsletter signup — double opt-in (the API sends a confirm email; nothing is
// active until the visitor clicks it). One-click unsubscribe lives in every email.
export function NewsletterSignup() {
  const { t, lang } = useI18n();
  const [email, setEmail] = useState('');
  const [state, setState] = useState('idle'); // idle | sending | done | error
  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim() || state === 'sending') return;
    setState('sending');
    try { await api.post('/newsletter/subscribe', { email: email.trim(), locale: lang === 'fr' ? 'fr' : 'en' }); setState('done'); }
    catch { setState('error'); }
  };
  return (
    <div className="mt-12 rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-6 sm:p-8 text-center">
      <h3 className="text-lg font-bold">{t('news.title', 'Get blog updates by email')}</h3>
      <p className="text-sm text-[var(--muted)] mt-1.5 max-w-md mx-auto">{t('news.sub', 'New posts, straight to your inbox. Double opt-in, and one-click unsubscribe in every email.')}</p>
      {state === 'done'
        ? <p className="mt-4 text-sm text-[var(--primary-2)] font-semibold">{t('news.check', 'Almost there — check your inbox to confirm your subscription.')}</p>
        : (
          <form onSubmit={submit} className="mt-4 flex flex-col sm:flex-row gap-2 max-w-md mx-auto">
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('news.ph', 'you@example.com')}
              className="flex-1 rounded-full border border-[var(--line)] bg-[var(--bg-solid)] px-4 py-2.5 text-sm outline-none focus:border-[var(--primary)]" />
            <Button type="submit" variant="primary" disabled={state === 'sending'}>{state === 'sending' ? t('news.sending', 'Subscribing…') : t('news.cta', 'Subscribe')}</Button>
          </form>
        )}
      {state === 'error' && <p className="mt-3 text-sm text-error">{t('news.err', 'Could not subscribe — check the address and try again.')}</p>}
    </div>
  );
}

// Heading-anchor slug — matches the md.jsx renderer's heading ids + comment anchors.
const headingSlug = (s) => String(s).toLowerCase().trim().replace(/[^\wÀ-ɏ]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'section';
// Inject a clickable "💬 N" pill onto each heading that has comments pinned to it, so
// hovering the section reveals a way to open those comments. Imperative because the
// headings are rendered by <Markdown> (outside React's tree).
export function useSectionCommentPills(rootRef, sectionComments, onOpen, deps) {
  useEffect(() => {
    const root = rootRef.current; if (!root) return;
    root.querySelectorAll('.section-comment-pill').forEach((e) => e.remove()); // clear stale (count/slug change)
    // Add a pill only to headings that don't already have one — so the MutationObserver
    // (which re-injects after <Markdown> re-renders, e.g. on a reaction) never loops.
    const inject = () => {
      for (const [slug, n] of Object.entries(sectionComments || {})) {
        let h; try { h = root.querySelector(`#${CSS.escape(slug)}`); } catch { continue; }
        if (!h || h.querySelector('.section-comment-pill')) continue;
        const btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'section-comment-pill'; btn.innerHTML = `💬 ${n}`;
        btn.title = `${n} comment${n > 1 ? 's' : ''} pinned here — open`;
        btn.style.cssText = 'margin-left:8px;font-size:11px;font-weight:600;vertical-align:middle;padding:1px 8px;border-radius:999px;border:1px solid var(--line);background:var(--surface-2);color:var(--primary-2);cursor:pointer;opacity:.5;transition:opacity .15s,border-color .15s';
        btn.addEventListener('mouseenter', () => { btn.style.opacity = '1'; btn.style.borderColor = 'var(--primary)'; });
        btn.addEventListener('mouseleave', () => { btn.style.opacity = '.5'; btn.style.borderColor = 'var(--line)'; });
        btn.addEventListener('click', (e) => { e.preventDefault(); onOpen(); });
        h.appendChild(btn);
      }
    };
    inject();
    const obs = new MutationObserver(() => inject());
    obs.observe(root, { childList: true, subtree: true });
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
// Build slug→count of comments pinned to a section (silent on permission errors).
export function useSectionComments(base, enabled) {
  const [map, setMap] = useState({});
  useEffect(() => {
    if (!enabled) return;
    api.get(`${base}/comments`).then((r) => {
      const m = {}; (r.comments || []).forEach((c) => { if (c.anchor) { const s = headingSlug(c.anchor); m[s] = (m[s] || 0) + 1; } });
      setMap(m);
    }).catch(() => setMap({}));
  }, [base, enabled]);
  return map;
}

/* ── Single post ── */
export function BlogPostPage() {
  const { slug } = useParams();
  const { lang, t } = useI18n();
  const { user } = useAuth(); const toast = useToast(); const nav = useNavigate();
  const { data, loading } = useFetch(() => api.get(`/blog/${slug}`), [slug]);
  const articleRef = useRef(null);
  const [rx, setRx] = useState(null); // { counts, mine } — local so a click updates instantly
  const [showComments, setShowComments] = useState(false);
  const [showHistory, setShowHistory] = useState(false); // read-only edit history (click the date)
  useEffect(() => { if (data?.post) setRx({ counts: data.post.reactionCounts || {}, mine: data.post.myReaction || null }); }, [data]);
  const postId = data?.post?.id;
  const sectionComments = useSectionComments(postId ? `/blog/${postId}` : '', !!postId);
  useSectionCommentPills(articleRef, sectionComments, () => setShowComments(true), [sectionComments, data?.post?.body, lang]);
  if (loading) return <div className="flex items-center gap-2 text-[var(--muted)] py-10"><Spinner /> {t('common.loading', 'Loading…')}</div>;
  if (!data?.post) return <EmptyState icon={Newspaper} title={t('blog.notfound', 'Post not found')} />;
  const p = data.post; const v = pickLang(p, lang);
  const authors = [p.author, ...(p.coAuthors || [])].filter(Boolean);
  const react = async (type) => {
    if (!user) { toast.info(t('blog.rx.signin', 'Sign in to react.')); nav('/auth?next=' + encodeURIComponent(`/blog/${slug}`)); return; }
    try { const r = await api.post(`/blog/${p.id}/react`, { type }); setRx({ counts: r.reactionCounts, mine: r.myReaction }); }
    catch { toast.error(t('blog.rx.failed', 'Could not react.')); }
  };
  return (
    <div className="max-w-3xl mx-auto">
      <Link to="/blog" className="text-sm text-[var(--muted)] hover:text-[var(--text)] flex items-center gap-1 mb-4"><ArrowLeft size={14} /> {t('blog.title', 'Blog')}</Link>
      <article ref={articleRef} className="card p-6 md:p-9">
        <TypeTag post={p} />
        <h1 className="text-3xl md:text-4xl font-extrabold mt-3 leading-tight">{v.title}</h1>
        <div className="text-sm text-[var(--faint)] mt-3 flex items-center gap-3"><span className="flex items-center gap-1"><UserIcon size={13} /> {p.author?.displayName}{authors.length > 1 && ` +${authors.length - 1}`}</span>
          <button onClick={() => setShowHistory(true)} title={t('blog.history.hint', 'View edit history')} className="flex items-center gap-1 hover:text-[var(--primary-2)] transition"><CalendarDays size={13} /> {fmtDate(p.publishedAt)} <History size={11} className="opacity-60" /></button></div>
        {!v.translated && <div className="mt-5 p-3 rounded-lg border border-[var(--line)] bg-orange-500/5 text-sm text-[var(--muted)] flex items-center gap-2"><Languages size={15} className="text-[var(--primary-2)]" /> Cet article n'est pas encore traduit en français — version anglaise affichée.</div>}
        {p.cover && p.coverInBody !== false && <img src={thumb(p.cover, 768)} alt="" className="w-full rounded-2xl mt-6 border border-[var(--line)]" />}
        <Markdown className="mt-7">{p.showToc && !/(^|\n)::toc\b/.test(v.body || '') ? `::toc[${p.tocTitle || 'On this page'}]\n\n${v.body}` : v.body}</Markdown>

        {/* reactions */}
        {p.reactionsEnabled && p.reactionTypes?.length > 0 && (
          <div className="mt-8 pt-5 border-t border-[var(--line)] flex flex-wrap items-center gap-2">
            <span className="text-xs text-[var(--faint)] mr-1">{t('blog.rx.label', 'Reactions')}</span>
            {p.reactionTypes.map((type) => {
              const count = rx?.counts?.[type] || 0; const mine = rx?.mine === type;
              return (
                <button key={type} onClick={() => react(type)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition ${mine ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary-2)]' : 'border-[var(--line)] hover:border-[var(--line-strong)]'}`}>
                  <ReactionIcon name={type} size={16} />{count > 0 && <span className="text-xs tabular-nums">{count}</span>}
                </button>
              );
            })}
          </div>
        )}

        {/* Public comment thread — only when the author made it reader-visible. Editors
            can also post from here (the API gates writes by canComment). */}
        {p.commentsPublic && (
          <div className="mt-6">
            <button onClick={() => setShowComments(true)} className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--text)] rounded-lg border border-[var(--line)] hover:border-[var(--line-strong)] px-3 py-1.5">
              <MessageSquare size={14} /> {t('blog.comments', 'View comments')}
            </button>
          </div>
        )}
        {showComments && <CommentsModal base={`/blog/${p.id}`} body={v.body || p.body} onClose={() => setShowComments(false)} onJump={(slug) => anchorEl(slug)?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />}
        {showHistory && <HistoryModal base={`/blog/${p.id}`} onClose={() => setShowHistory(false)} />}

        {/* author + collaborators */}
        {authors.length > 0 && (
          <div className="mt-6 pt-5 border-t border-[var(--line)] flex items-center gap-3">
            <div className="flex -space-x-1.5">
              {authors.map((a, i) => <div key={a.id} className="rounded-full" style={{ zIndex: 10 - i }}><Avatar user={a} size={30} /></div>)}
            </div>
            <div className="text-xs text-[var(--muted)]">
              {authors.length > 1 ? t('blog.by.multi', 'Written by {names}').replace('{names}', authors.map((a) => a.displayName).join(', ')) : t('blog.by.one', 'Written by {name}').replace('{name}', p.author?.displayName || '')}
            </div>
          </div>
        )}
      </article>
    </div>
  );
}

const BADGE_PRESETS = [
  ['New', '#16a34a'], ['Beta', '#2563eb'], ['Updated', '#7c3aed'], ['Fixed', '#0891b2'],
  ['Important', '#d97706'], ['Deprecated', '#dc2626'], ['WIP', '#db2777'], ['Pro', '#ea580c'],
];
const CLASSIC_BADGES = ['NEW', 'FIXED', 'IMPROVED', 'REFINE', 'VISUAL', 'MAJOR'];
const CLASSIC_CLASS = { NEW: 'new', FIXED: 'fixed', IMPROVED: 'improved', REFINE: 'refine', VISUAL: 'visual', MAJOR: 'major' };
const chipStyle = (c) => ({ color: c, background: `color-mix(in srgb, ${c} 15%, transparent)`, borderColor: `color-mix(in srgb, ${c} 42%, transparent)` });
const SAVED_BADGES_KEY = 'bcw-custom-badges';
const readSavedBadges = () => { try { return JSON.parse(localStorage.getItem(SAVED_BADGES_KEY) || '[]'); } catch { return []; } };

/* Badge picker: classic [NEW]-style chips, coloured presets, your saved customs, and
   a colour-picker builder (customs persist in localStorage). Mobile-friendly modal. */
function BadgePicker({ onPick, onPickRaw, onClose }) {
  const [label, setLabel] = useState('Custom');
  const [color, setColor] = useState('#7c3aed');
  const [saved, setSaved] = useState(readSavedBadges);
  const persist = (next) => { setSaved(next); try { localStorage.setItem(SAVED_BADGES_KEY, JSON.stringify(next)); } catch {} };
  const add = (save) => {
    if (!label.trim()) return;
    if (save && !saved.some((s) => s[0] === label.trim())) persist([[label.trim(), color], ...saved].slice(0, 20));
    onPick(label.trim(), color); onClose();
  };
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center p-4" style={{ background: 'rgba(4,5,8,0.55)', backdropFilter: 'blur(3px)' }} onMouseDown={onClose}>
      <div className="card modal-card w-full max-w-md p-0 overflow-hidden anim-pop max-h-[80vh] flex flex-col" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--line)] shrink-0"><span className="font-semibold">Insert a badge</span><button onClick={onClose} className="text-[var(--faint)] hover:text-[var(--text)]"><X size={16} /></button></div>
        <div className="p-3 overflow-auto">
          <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--faint)] mb-2">Classic</div>
          <div className="flex flex-wrap gap-2">
            {CLASSIC_BADGES.map((b) => (
              <button key={b} type="button" onClick={() => { onPickRaw?.(`[${b}] `); onClose(); }} className="!p-0 bg-transparent border-0 cursor-pointer">
                <span className={`md-badge md-badge-${CLASSIC_CLASS[b]} !mr-0`}>{b}</span>
              </button>
            ))}
          </div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--faint)] mt-4 mb-2">Presets</div>
          <div className="flex flex-wrap gap-2">
            {BADGE_PRESETS.map(([l, c]) => (
              <button key={l} type="button" onClick={() => { onPick(l, c); onClose(); }}
                className="text-xs font-bold px-2.5 py-1 rounded-full border" style={chipStyle(c)}>{l}</button>
            ))}
          </div>
          {saved.length > 0 && <>
            <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--faint)] mt-4 mb-2">My badges</div>
            <div className="flex flex-wrap gap-2">
              {saved.map(([l, c]) => (
                <span key={l} className="inline-flex items-center gap-1 text-xs font-bold pl-2.5 pr-1 py-1 rounded-full border" style={chipStyle(c)}>
                  <button type="button" onClick={() => { onPick(l, c); onClose(); }} className="bg-transparent border-0 cursor-pointer font-bold" style={{ color: 'inherit' }}>{l}</button>
                  <button type="button" title="Remove" onClick={() => persist(saved.filter((s) => s[0] !== l))} className="opacity-60 hover:opacity-100"><X size={11} /></button>
                </span>
              ))}
            </div>
          </>}
          <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--faint)] mt-4 mb-2">Custom</div>
          <div className="flex items-center gap-2 flex-wrap">
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="w-9 h-9 rounded-lg border border-[var(--line)] bg-transparent p-0.5 cursor-pointer shrink-0" />
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" className="input !py-1.5 !text-sm flex-1 min-w-[100px]" onKeyDown={(e) => e.key === 'Enter' && add(true)} />
            <span className="text-xs font-bold px-2.5 py-1 rounded-full border" style={chipStyle(color)}>{label || 'Label'}</span>
          </div>
          <div className="flex gap-2 mt-2">
            <Button size="sm" variant="primary" onClick={() => add(true)}>Add & save</Button>
            <Button size="sm" variant="ghost" onClick={() => add(false)}>Add once</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Reusable rich Markdown editor (toolbar + preview). `full` adds media/badges. ── */
export function MarkdownEditor({ value, onChange, placeholder, minHeight = 220, full = false }) {
  const toast = useToast(); const dialog = useDialog(); const { t } = useI18n();
  const ref = useRef(null); const [preview, setPreview] = useState(false);
  const [mode, setMode] = useState('write'); // 'write' (markdown) | 'visual' (drag & drop)
  const insert = (text) => {
    const ta = ref.current; const v = value || ''; const at = ta ? ta.selectionStart : v.length;
    const next = v.slice(0, at) + text + v.slice(at); onChange(next);
    setTimeout(() => { if (ta) { ta.focus(); ta.selectionStart = ta.selectionEnd = at + text.length; } }, 0);
  };
  const pickImage = (cb) => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.onchange = async () => { const file = i.files?.[0]; if (!file) return; try { toast.info(t('be.uploading', 'Uploading…')); cb(await uploadBlogImage(file)); } catch { toast.error(t('be.uploadfail', 'Upload failed.')); } }; i.click(); };
  const ytEmbed = async () => { const url = await dialog.prompt({ title: 'YouTube', label: 'Video URL or ID', placeholder: 'https://youtu.be/…' }); if (!url) return; const m = url.match(/(?:v=|youtu\.be\/|embed\/)([\w-]{11})/) || [null, url.trim()]; insert(`\n<div class="yt-embed"><iframe src="https://www.youtube-nocookie.com/embed/${m[1]}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>\n`); };
  const linkEmbed = async () => { const url = await dialog.prompt({ title: 'Link', label: 'URL', placeholder: 'https://…' }); if (!url) return; const txt = await dialog.prompt({ title: 'Link', label: 'Text', defaultValue: url }); insert(`[${txt || url}](${url})`); };
  const videoEmbed = async () => { const url = await dialog.prompt({ title: 'Video', label: 'Video file URL (mp4/webm)', placeholder: 'https://…' }); if (!url) return; insert(`\n<video controls src="${url}" style="width:100%;border-radius:12px"></video>\n`); };
  const tool = (Icon, fn, title) => <button type="button" title={title} onClick={fn} className="btn btn-sm"><Icon size={14} /></button>;
  const [blocksOpen, setBlocksOpen] = useState(false);
  const blocksBtnRef = useRef(null); const [blocksPos, setBlocksPos] = useState({ top: 0, left: 0 });
  // Open the Blocks menu as a FIXED overlay anchored under the button — the editor wrapper
  // is overflow-hidden (for its rounded corners), which was clipping an absolute dropdown.
  const openBlocks = () => {
    if (blocksOpen) { setBlocksOpen(false); return; }
    const r = blocksBtnRef.current?.getBoundingClientRect();
    if (r) {
      // It was always placed BELOW the button. In a long editor the toolbar sits low on the
      // screen, so the menu opened past the bottom of the viewport — present, focusable,
      // and invisible. Flip above when there is not enough room below, and clamp the height
      // to whatever side it lands on so it scrolls instead of running off.
      const MENU = 288; // max-h-72
      const below = window.innerHeight - r.bottom - 12;
      const above = r.top - 12;
      const flip = below < 200 && above > below;
      setBlocksPos({
        top: flip ? Math.max(8, r.top - Math.min(MENU, above) - 4) : r.bottom + 4,
        left: Math.max(8, Math.min(r.left, window.innerWidth - 224)),
        maxH: Math.max(160, Math.min(MENU, flip ? above : below)),
      });
    }
    setBlocksOpen(true);
  };
  const [iconPick, setIconPick] = useState(false);
  const [badgePick, setBadgePick] = useState(false);
  const [kbdPick, setKbdPick] = useState(false);
  // GitBook-style block snippets (remark-directive). `insertBlock` closes the menu.
  const BLOCKS = [
    { icon: TagIcon, label: 'Callout', snip: '\n:::tip[Good to know]\nSomething worth highlighting.\n:::\n' },
    { icon: Sparkles, label: 'Custom callout', snip: '\n:::callout[Custom]{icon=rocket color="#7c3aed"}\nYour own icon and colour.\n:::\n' },
    { icon: ChevronDown, label: 'Collapsible', snip: '\n:::details[Click to expand]\nHidden content — supports **markdown**.\n:::\n' },
    { icon: LayoutGrid, label: 'Cards', snip: '\n::::cards\n:::card{title="First" icon=rocket}\nCard description.\n:::\n:::card{title="Link card" href="https://example.com" icon=link}\nGoes somewhere.\n:::\n::::\n' },
    { icon: ImagePlus, label: 'Image card', snip: '\n:::card{title="With image" image="https://picsum.photos/400/200"}\nCaption or description.\n:::\n' },
    { icon: Columns2, label: 'Columns', snip: '\n::::columns\n:::column\nLeft column.\n:::\n:::column\nRight column.\n:::\n::::\n' },
    { icon: FileDown, label: 'File download', snip: '\n:::file[example.zip]{href="https://example.com/file.zip" size="10 KB"}\n:::\n' },
    { icon: Table, label: 'Table', snip: '\n| Column A | Column B |\n| --- | --- |\n| Cell 1 | Cell 2 |\n| Cell 3 | Cell 4 |\n' },
    { icon: ImagePlus, label: 'Image', snip: '\n![alt text](https://picsum.photos/600/300)\n' },
    { icon: Video, label: 'Video (mp4/webm)', snip: '\n<video src="https://example.com/clip.mp4" controls></video>\n' },
    { icon: Youtube, label: 'YouTube embed', snip: '\n<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe>\n' },
    { icon: PlayCircle, label: t('be.replay.upload', 'Session replay (upload .bmmreplay)'), onPick: () => {
      setBlocksOpen(false);
      const i = document.createElement('input'); i.type = 'file'; i.accept = '.bmmreplay,application/json';
      i.onchange = async () => {
        const f = i.files?.[0]; if (!f) return;
        try {
          toast.info(t('be.uploading', 'Uploading…'));
          const url = await uploadReplay(f);
          const title = await dialog.prompt({ title: t('be.replay.title', 'Replay caption'), label: t('be.replay.titlelabel', 'Optional caption shown above the player'), placeholder: t('be.replay.titleph', 'e.g. Installing a plugin') });
          insertBlock(`\n:::replay{src="${url}"${title ? ` title="${title}"` : ''}}\n:::\n`);
        } catch (x) { toast.error(x?.status === 413 ? t('be.replay.toolarge', 'Replay too large (max 40 MB).') : t('be.uploadfail', 'Upload failed.')); }
      };
      i.click();
    } },
    { icon: PlayCircle, label: t('be.replay.url', 'Session replay (from URL)'), snip: '\n:::replay{src="https://example.com/session.bmmreplay" title="What happens here"}\n:::\n' },
    // Four colons on the outside, three inside: remark-directive matches by colon count, so
    // a `:::` inside a `:::` closes the parent. Anybody inserting this snippet gets the
    // nesting right without having to know that.
    { icon: ListOrdered, label: 'Steps', snip: '\n::::steps[How it works]{type=1}\n:::step[First]\nWhat to do. Supports **markdown**, callouts, code — anything.\n:::\n:::step[Second]\nAnd so on.\n:::\n::::\n' },
    { icon: ListOrdered, label: 'Steps (lettered)', snip: '\n::::steps[Options]{type=a color="#7c3aed"}\n:::step[Option A]\nOne way.\n:::\n:::step[Option B]\nAnother.\n:::\n::::\n' },
    { icon: Milestone, label: 'Roadmap', snip: '\n:::roadmap[Roadmap]{orientation=vertical}\n```json\n{"categories":[{"name":"v1.0","items":[{"label":"Core","status":"done"},{"label":"Docs","status":"progress","percent":40},{"label":"Polish","status":"planned"}]}]}\n```\n:::\n' },
    { icon: Quote, label: 'Quote', snip: '\n> A blockquote — supports **markdown**.\n' },
    { icon: Minus, label: 'Divider', snip: '\n---\n' },
    { icon: AlignCenter, label: 'Align (center)', snip: '\n:::center\nCentered content — text or an ![image](url).\n:::\n' },
    { icon: AlignLeft, label: 'Align (left)', snip: '\n:::left\nLeft-aligned content.\n:::\n' },
    { icon: AlignRight, label: 'Align (right)', snip: '\n:::right\nRight-aligned content.\n:::\n' },
    { icon: MessageSquare, label: 'Annotation (hover note)', snip: '<doc-comment data-comment="Your note here">annotated text</doc-comment>' },
    { icon: Code2, label: 'Code block', snip: '\n```js\nconsole.log("hello");\n```\n' },
    { icon: Keyboard, label: 'Shortcut', onPick: () => { setBlocksOpen(false); setKbdPick(true); } },
    { icon: TagIcon, label: 'Tags / badge', onPick: () => { setBlocksOpen(false); setBadgePick(true); } },
    { icon: Smile, label: 'Icon', onPick: () => { setBlocksOpen(false); setIconPick(true); } },
    { icon: ListTree, label: 'Table of contents', snip: '\n::toc[On this page]\n' },
  ];
  // Insert a block snippet as its OWN block: remark-directive only parses `:::name…`
  // when it's separated from surrounding text by BLANK lines. Inserting a snippet at a
  // mid-paragraph cursor with just single newlines left the directive glued to the text,
  // so it rendered as raw `:::tip[…]` in the content. Force a blank line before/after.
  const insertBlock = (snip) => {
    const ta = ref.current; const v = value || ''; const at = ta ? ta.selectionStart : v.length;
    const before = v.slice(0, at); const after = v.slice(at);
    const core = snip.replace(/^\n+/, '').replace(/\n+$/, '');
    const pre = !before || /\n[ \t]*\n$/.test(before) ? '' : (before.endsWith('\n') ? '\n' : '\n\n');
    const post = !after || /^\n[ \t]*\n/.test(after) ? '' : (after.startsWith('\n') ? '\n' : '\n\n');
    const chunk = pre + core + post;
    const next = before + chunk + after; onChange(next);
    setBlocksOpen(false);
    setTimeout(() => { if (ta) { ta.focus(); ta.selectionStart = ta.selectionEnd = before.length + chunk.length; } }, 0);
  };
  return (
    <div className="rounded-xl border border-[var(--line)] overflow-hidden bg-[var(--surface-2)]">
      <div className="flex flex-wrap items-center gap-1 px-2 py-1.5 border-b border-[var(--line)]">
        {full && (
          <div className="inline-flex rounded-lg border border-[var(--line)] p-0.5 mr-1">
            {[['write', 'Markdown'], ['visual', 'Visual']].map(([m, label]) => (
              <button key={m} type="button" onClick={() => { setMode(m); setPreview(false); }}
                className={`px-2.5 py-1 rounded-md text-xs font-medium ${mode === m ? 'bg-[var(--surface)] text-[var(--text)]' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>{label}</button>
            ))}
          </div>
        )}
        {mode === 'write' && <>
          {tool(Bold, () => insert('**bold**'), 'Bold')}{tool(Heading, () => insert('\n## Heading\n'), 'Heading')}{tool(List, () => insert('\n- item\n'), 'List')}{tool(Link2, linkEmbed, 'Link')}
          {full && <>
            <span className="w-px h-5 bg-[var(--line)] mx-1 self-center" />
            {tool(ImagePlus, () => pickImage((u) => insert(`\n![image](${u})\n`)), 'Image')}{tool(Youtube, ytEmbed, 'YouTube')}{tool(Video, videoEmbed, 'Video')}
            <span className="w-px h-5 bg-[var(--line)] mx-1 self-center" />
            <button type="button" onClick={() => setBadgePick(true)} className="btn btn-sm" title="Insert a badge (classic, preset or custom)"><TagIcon size={14} /> Badges</button>
            <div className="relative">
              <button ref={blocksBtnRef} type="button" onClick={openBlocks} className="btn btn-sm" title="Insert a content block (callout, tabs, cards…)"><BlocksIcon size={14} /> Blocks <ChevronDown size={12} /></button>
              {/* Portalled to <body>, and that is the whole fix.
                  `position: fixed` does NOT resolve against the viewport when an ancestor
                  carries a transform — and `.modal-card` has `.anim-pop`, whose
                  `animation-fill-mode: both` leaves `transform: scale(1)` applied forever
                  after the animation ends. So the modal became the containing block: the
                  viewport coordinates computed above landed inside it, and its
                  `overflow-hidden` (there for the rounded corners) clipped what was left —
                  which is why the menu was invisible at normal size and merely misplaced
                  once a smaller window moved the modal under the coordinates.
                  ActionBar's overflow menu portals for the same reason; this now matches. */}
              {blocksOpen && createPortal(<>
                <div className="fixed inset-0 z-[60]" onClick={() => setBlocksOpen(false)} />
                <div className="fixed z-[61] w-52 rounded-xl border border-[var(--line-strong)] shadow-xl py-1 overflow-auto" style={{ background: 'var(--bg-solid)', top: blocksPos.top, left: blocksPos.left, maxHeight: blocksPos.maxH || 288 }}>
                  {BLOCKS.map((bl) => <button key={bl.label} type="button" onClick={() => bl.onPick ? bl.onPick() : insertBlock(bl.snip)} className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-[var(--surface-2)]"><bl.icon size={14} className="text-[var(--muted)]" /> {bl.label}</button>)}
                </div>
              </>, document.body)}
            </div>
          </>}
        </>}
        <button type="button" onClick={() => setPreview((v) => !v)} className="btn btn-sm ml-auto"><Eye size={14} /> {preview ? 'Edit' : 'Preview'}</button>
        {full && <a href="/blog/markdown-guide" target="_blank" rel="noreferrer" className="btn btn-sm" title="Markdown guide"><HelpCircle size={14} /> <span className="hidden sm:inline">Guide</span></a>}
      </div>
      {preview
        ? <div className="p-4 max-h-[38vh] overflow-auto"><Markdown>{value || '*Nothing yet.*'}</Markdown></div>
        : mode === 'visual'
          ? <div className="max-h-[52vh] overflow-auto"><VisualEditor value={value} onChange={onChange} minHeight={minHeight} /></div>
          : <><textarea ref={ref} className="w-full bg-transparent border-0 outline-none resize-none p-4 text-sm leading-relaxed text-[var(--text)]" style={{ minHeight }} value={value || ''} spellCheck={false} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
            <SelectionToolbar taRef={ref} value={value || ''} onChange={onChange} /></>}
      {iconPick && <IconPicker onPick={(n) => insert(` :icon[${n}] `)} onClose={() => setIconPick(false)} />}
      {badgePick && <BadgePicker onPick={(label, color) => insert(` :badge[${label}]${color ? `{color="${color}"}` : ''} `)} onPickRaw={(txt) => insert(txt)} onClose={() => setBadgePick(false)} />}
      {kbdPick && <KbdPicker onPick={(combo) => insert(` :kbd[${combo}] `)} onClose={() => setKbdPick(false)} />}
    </div>
  );
}

/* ── Editor (bilingual EN base + optional FR) ── */
// `scopes` (from GET /blog/my-scopes): { projects, showcases, global } — staff gets
// `global: true` (every blog); a granted regular USER gets only the blogs listed.
// `scope` values are encoded "project:<key>" or "showcase:<slug>" to disambiguate
// the two blog "spaces" in one dropdown.
function BlogEditor({ post, scopes, onClose, onSaved, draft, draftBase, conflictReopen, reopenDraft }) {
  const toast = useToast(); const dialog = useDialog(); const { t } = useI18n(); const { user: me } = useAuth();
  // Broadcasting to every subscriber is a staff-only capability (see notifyNewsletterOfPost
  // on the server) — a granted regular writer doesn't get the announce toggle.
  const canNewsletter = me && ['ADMIN', 'MOD', 'SUPERADMIN'].includes(me.role);
  const defaultScope = scopes?.projects?.[0] ? `project:${scopes.projects[0].key}` : scopes?.showcases?.[0] ? `showcase:${scopes.showcases[0].slug}` : 'project:community';
  const [f, setF] = useState({ scope: defaultScope, cover: '', coverInBody: true, publish: true, title: '', excerpt: '', body: '', titleFr: '', excerptFr: '', bodyFr: '', reactionsEnabled: false, reactionTypes: [], coAuthorEmails: [], showToc: false, tocTitle: '', commentsPublic: false, notifyNewsletter: !post, newsletterSubject: '', newsletterIntro: '' });
  const [nlSent, setNlSent] = useState(null); // post.newsletterSentAt — already announced?
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('en'); // en (base) | fr (optional)
  const [collab, setCollab] = useState(''); // pending co-author email input
  // Concurrent-edit tracking: the version + body this editor loaded, so a colliding
  // save can 3-way merge against them (git-style). `merge` holds the banner state.
  const baseRef = useRef({ version: null, body: '', bodyFr: '' });
  const [merge, setMerge] = useState(null); // null | { conflicts, cleanCount }
  const [showHistory, setShowHistory] = useState(false);
  const [showComments, setShowComments] = useState(false);
  // Visual conflict resolver queue: one entry per field (body / bodyFr) that still has
  // real conflicts after the 3-way merge. Resolved one at a time in DiffMergeModal.
  const [mergeUI, setMergeUI] = useState(null); // null | { queue: [{ field, langLabel, base, mine, theirs }] }
  useEffect(() => {
    // Restored after an "undo" on the publish toast — re-seed the exact form state the
    // author had, so they land back in the editor exactly where they left off. When the
    // reopen was caused by a save conflict, restore the ORIGINAL base version too so the
    // next save can 3-way-merge correctly.
    if (draft) { setF(draft); if (draftBase) baseRef.current = draftBase; return; }
    if (post) {
      setF({ scope: post.showcaseProject ? `showcase:${post.showcaseProject.slug}` : `project:${post.project?.key || 'community'}`, cover: post.cover || '', coverInBody: post.coverInBody !== false, publish: post.status === 'PUBLISHED',
        title: post.title || '', excerpt: post.excerpt || '', body: post.body || '',
        titleFr: post.titleFr || '', excerptFr: post.excerptFr || '', bodyFr: post.bodyFr || '',
        reactionsEnabled: !!post.reactionsEnabled, reactionTypes: post.reactionTypes || [], coAuthorEmails: [], showToc: !!post.showToc, tocTitle: post.tocTitle || '', commentsPublic: post.commentsPublic === true,
        notifyNewsletter: false, newsletterSubject: '', newsletterIntro: '' });
      setNlSent(post.newsletterSentAt || null);
      // The list payload (POST_SELECT) has no body — fetch the full post so the
      // editor is pre-filled (otherwise saving trips the "content required" guard).
      if (post.slug) api.get(`/blog/${post.slug}`).then((r) => { const fp = r.post || {}; setF((s) => ({ ...s,
        title: fp.title ?? s.title, excerpt: fp.excerpt ?? s.excerpt, body: fp.body ?? s.body,
        titleFr: fp.titleFr ?? s.titleFr, excerptFr: fp.excerptFr ?? s.excerptFr, bodyFr: fp.bodyFr ?? s.bodyFr,
        reactionsEnabled: !!fp.reactionsEnabled, reactionTypes: fp.reactionTypes || s.reactionTypes }));
        setNlSent(fp.newsletterSentAt || null);
        baseRef.current = { version: fp.version ?? null, body: fp.body || '', bodyFr: fp.bodyFr || '' }; }).catch(() => {});
      // co-author emails aren't on the public post — fetch them for the editor.
      api.get(`/blog/${post.id}/collab`).then((r) => setF((s) => ({ ...s, coAuthorEmails: r.coAuthorEmails || [] }))).catch(() => {});
    } else setF((s) => ({ ...s, scope: defaultScope }));
    // eslint-disable-next-line
  }, [post]);
  const REACTION_PALETTE = REACTION_OPTIONS;
  const toggleReaction = (name) => setF((s) => {
    const has = s.reactionTypes.includes(name);
    if (has) return { ...s, reactionTypes: s.reactionTypes.filter((e) => e !== name) };
    if (s.reactionTypes.length >= 3) return s; // max 3
    return { ...s, reactionTypes: [...s.reactionTypes, name] };
  });
  const addCoAuthor = () => {
    const email = collab.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast.error(t('be.validemail', 'Enter a valid email.'));
    if (!f.coAuthorEmails.includes(email)) setF((s) => ({ ...s, coAuthorEmails: [...s.coAuthorEmails, email] }));
    setCollab('');
  };
  const removeCoAuthor = (email) => setF((s) => ({ ...s, coAuthorEmails: s.coAuthorEmails.filter((e) => e !== email) }));
  const suffix = tab === 'fr' ? 'Fr' : '';
  const g = (base) => f[base + suffix];
  const setField = (base, val) => setF((s) => ({ ...s, [base + suffix]: val }));
  const hasFr = !!(f.titleFr || f.bodyFr || f.excerptFr);

  const pickCover = () => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.onchange = async () => { const file = i.files?.[0]; if (!file) return; try { toast.info(t('be.uploading', 'Uploading…')); const url = await uploadBlogImage(file); setF((s) => ({ ...s, cover: url })); } catch { toast.error(t('be.uploadfail', 'Upload failed.')); } }; i.click(); };
  const save = async () => {
    if (f.title.length < 2 || !f.body) return toast.error(t('be.titlereq', 'English (base) title and content are required.'));
    // Don't let unresolved merge markers get saved.
    if (hasConflictMarkers(f.body) || hasConflictMarkers(f.bodyFr)) return toast.error(t('be.conflicts', 'Resolve the conflict markers (<<<<<<< … >>>>>>>) first, then save.'));
    const [scopeKind, scopeVal] = f.scope.split(':');
    const body = { projectKey: scopeKind === 'project' ? scopeVal : undefined, showcaseSlug: scopeKind === 'showcase' ? scopeVal : undefined,
      cover: f.cover || null, coverInBody: f.coverInBody, publish: f.publish,
      title: f.title, excerpt: f.excerpt, body: f.body,
      titleFr: f.titleFr || null, excerptFr: f.excerptFr || null, bodyFr: f.bodyFr || null,
      reactionsEnabled: f.reactionsEnabled, reactionTypes: f.reactionTypes, coAuthorEmails: f.coAuthorEmails,
      showToc: f.showToc, tocTitle: f.tocTitle || null, commentsPublic: f.commentsPublic,
      // Announce to the newsletter (once per post) — only when publishing and not yet sent.
      ...(f.notifyNewsletter && f.publish && !nlSent ? { notifyNewsletter: true, newsletterSubject: f.newsletterSubject.trim() || undefined, newsletterIntro: f.newsletterIntro.trim() || undefined } : {}),
      ...(post && baseRef.current.version != null ? { baseVersion: baseRef.current.version } : {}) };

    // Optimistic save with an undo window (BOTH new posts and edits). Close the editor
    // now and show a "done · Undo" toast that counts down; the write fires only when it
    // elapses. Undo (× or Cancel) reopens the editor in its exact state and nothing is
    // written. Skipped when a merge is in progress or we're re-saving after a conflict —
    // those must save immediately so the 3-way-merge resolver can engage.
    const canOptimistic = reopenDraft && !conflictReopen && merge == null && mergeUI == null;
    if (canOptimistic) {
      const snapshot = { ...f };
      const origBase = { ...baseRef.current };
      onClose();
      toast.action({
        tone: 'success', duration: 6000, cancelLabel: t('be.undo', 'Undo'),
        msg: post ? t('be.updated', 'Post updated.') : (f.publish ? t('be.published', 'Post published.') : t('be.draftsaved', 'Draft saved.')),
        onCommit: async () => {
          try { if (post) await api.patch(`/blog/${post.id}`, body); else await api.post('/blog', body); onSaved(); }
          catch (x) {
            if (post && x.status === 409 && x.data?.current) { toast.error(t('be.conflict.reopen', 'Someone else edited this — reopened so you can merge, then Save.')); reopenDraft(snapshot, { post, base: origBase, conflict: true }); }
            else { toast.error(x.data?.error === 'blog_limit' ? t('be.full', 'Blog is full — trim or delete an article, or raise the limit.') : (x.data?.error || t('be.failed', 'Failed.'))); reopenDraft(snapshot, { post, base: origBase }); }
          }
        },
        onCancel: () => reopenDraft(snapshot, { post, base: origBase }),
      });
      return;
    }

    await commitSave(body);
  };

  // Immediate save (no undo window) — runs while the editor is open so the 3-way-merge
  // resolver can engage on a 409 conflict. Used for the conflict-reopen re-save.
  const commitSave = async (body) => {
    setBusy(true);
    try {
      if (post) await api.patch(`/blog/${post.id}`, body); else await api.post('/blog', body);
      toast.success(post ? t('be.updated', 'Post updated.') : t('be.published', 'Post published.')); onSaved();
    } catch (x) {
      // Someone else saved since we loaded → 3-way merge their copy into ours (git-style).
      if (x.status === 409 && x.data?.current) {
        const cur = x.data.current;
        const lbl = { mine: 'Your version', theirs: 'Their version' };
        // Auto-merge each field; anything with real conflicts goes to the visual resolver.
        const fields = [
          { field: 'body', langLabel: 'EN', base: baseRef.current.body, mine: f.body, theirs: cur.body || '' },
          { field: 'bodyFr', langLabel: 'FR', base: baseRef.current.bodyFr, mine: f.bodyFr || '', theirs: cur.bodyFr || '' },
        ];
        const patch = {}; const queue = [];
        for (const fd of fields) {
          const m = merge3(fd.base, fd.mine, fd.theirs, lbl);
          if (m.conflicts > 0) queue.push(fd); else patch[fd.field] = m.text;
        }
        if (Object.keys(patch).length) setF((s) => ({ ...s, ...patch }));
        baseRef.current = { version: cur.version, body: cur.body || '', bodyFr: cur.bodyFr || '' };
        const totalConflicts = queue.length;
        setMerge({ conflicts: totalConflicts, pending: queue });
        if (totalConflicts > 0) { setMergeUI({ queue }); toast.info(t('be.conflictvisual', 'Someone else edited this post — resolve the conflicts visually, then Save.')); }
        else toast.info(t('be.mergedreview', 'Merged with edits made by someone else — review the content, then Save again.'));
      } else if (x.status === 409 && x.data?.error === 'blog_limit') {
        const d = x.data;
        const where = d.scope === 'project' ? t('be.thispage', 'this page') : t('be.thesite', 'the site');
        toast.error(d.kind === 'count'
          ? t('be.fullcount', 'Blog is full — {where} allows at most {limit} article(s) (currently {current}). Delete one or raise the limit.').replace('{where}', where).replace('{limit}', d.limit).replace('{current}', d.current)
          : t('be.fullsize', "Blog is full — {where}'s size limit ({kb} KB) would be exceeded. Trim this article, delete an old one, or raise the limit.").replace('{where}', where).replace('{kb}', d.limitKB));
      } else {
        toast.error(x.data?.error === 'forbidden' ? t('be.noperm', "You don't have permission to post in that blog.") : x.data?.error || t('be.failed', 'Failed.'));
      }
    } finally { setBusy(false); }
  };
  const del = async () => {
    if (!post) return;
    if (!(await dialog.confirm({ title: t('be.delpost', 'Delete post'), message: t('be.cannotundo', 'This cannot be undone.'), okLabel: t('be.delete', 'Delete'), danger: true }))) return;
    try { await api.del(`/blog/${post.id}`); toast.success(t('be.deleted', 'Deleted.')); onSaved(); } catch { toast.error(t('be.failed', 'Failed.')); }
  };
  const fr = tab === 'fr';
  return (
    <Modal open onClose={onClose} title={post ? t('be.editpost', 'Edit post') : t('be.writepost', 'Write a post')} icon={PenSquare} width="max-w-3xl"
      footer={<>
        {post && <Button variant="ghost" className="!text-error mr-auto" onClick={del}><Trash2 size={15} /> Delete</Button>}
        {post && <Button variant="ghost" onClick={() => setShowHistory(true)}><History size={15} /> History</Button>}
        {post && <Button variant="ghost" onClick={() => setShowComments(true)}><MessageSquare size={15} /> Comments</Button>}
        <label className="flex items-center gap-1.5 text-sm text-[var(--muted)] mr-2"><input type="checkbox" checked={f.publish} onChange={(e) => setF({ ...f, publish: e.target.checked })} /> Published</label>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : (post ? 'Save' : 'Publish')}</Button>
      </>}>
      {/* Concurrent-edit merge banner (git-style): shown after a colliding save. Clean
          merges just need a re-Save; conflicts open the visual resolver (GitMerge). */}
      {merge && (
        <div className={`mb-3 rounded-xl border px-3.5 py-2.5 text-sm flex items-start gap-2.5 ${merge.conflicts > 0 ? 'border-warning-border bg-warning-bg text-warning' : 'border-success-border bg-success-bg text-success'}`}>
          <GitMerge size={16} className="shrink-0 mt-0.5" />
          <div className="flex-1">
            {merge.conflicts > 0
              ? <><b>{merge.conflicts} conflict{merge.conflicts > 1 ? 's' : ''} to resolve.</b> Someone else saved while you were editing.{' '}
                  {mergeUI?.queue?.length ? 'Resolve them in the panel, then Save.' : <>Then Save. {merge.pending && <button className="underline font-medium" onClick={() => setMergeUI({ queue: merge.pending })}>Reopen resolver</button>}</>}</>
              : <><b>Merged cleanly with someone else's edits.</b> Review the content and Save again.</>}
          </div>
          <button onClick={() => setMerge(null)} className="opacity-70 hover:opacity-100"><X size={14} /></button>
        </div>
      )}
      {/* language tabs */}
      <div className="flex items-center gap-1 mb-3">
        {[['en', 'English (base)'], ['fr', 'Français']].map(([l, label]) => (
          <button key={l} type="button" onClick={() => setTab(l)} className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5 border ${tab === l ? 'bg-[var(--surface-2)] border-[var(--line)] font-medium' : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'}`}>
            <Languages size={13} /> {label}{l === 'fr' && <span className={`text-[10px] ${hasFr ? 'text-success' : 'text-[var(--faint)]'}`}>{hasFr ? '✓' : '(optionnel)'}</span>}
          </button>
        ))}
      </div>
      {fr && <div className="text-xs text-[var(--muted)] mb-3 p-2.5 rounded-lg bg-orange-500/5 border border-[var(--line)] flex items-center gap-2"><Languages size={13} className="text-[var(--primary-2)]" /> Traduction française optionnelle, publiée en même temps. Si vide, les lecteurs FR voient la version anglaise marquée « non traduit ».</div>}

      {/* title (per-language) */}
      <input className="input !text-xl !font-semibold !py-3" value={g('title')} onChange={(e) => setField('title', e.target.value)} placeholder={fr ? "Titre de l'article…" : 'Post title…'} />

      {/* meta row (shared: blog scope + cover) */}
      <div className="flex flex-wrap items-center gap-2 mt-3">
        <select className="input !w-auto !py-2" value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })}>
          <optgroup label="Projects">
            {(scopes?.projects || [{ key: 'community', name: 'Community' }]).map((pr) => <option key={pr.key} value={`project:${pr.key}`}>{pr.name}</option>)}
          </optgroup>
          {(scopes?.showcases || []).length > 0 && <optgroup label="Other projects">
            {scopes.showcases.map((s) => <option key={s.slug} value={`showcase:${s.slug}`}>{s.name}</option>)}
          </optgroup>}
        </select>
        <Button type="button" size="sm" onClick={pickCover}><ImagePlus size={14} /> {f.cover ? 'Change cover' : 'Add cover'}</Button>
        {f.cover && <Button type="button" size="sm" onClick={() => setF((s) => ({ ...s, cover: '' }))}><X size={14} /> Remove</Button>}
        <span className="text-xs text-[var(--faint)] ml-auto">Cover &amp; blog are shared across languages</span>
      </div>
      {f.cover && <div className="rounded-xl overflow-hidden border border-[var(--line)] mt-3"><img src={thumb(f.cover, 512)} alt="" className="w-full h-40 object-cover" /></div>}
      {f.cover && <label className="flex items-center gap-2 text-sm mt-2 cursor-pointer text-[var(--muted)]"><input type="checkbox" checked={f.coverInBody !== false} onChange={(e) => setF((s) => ({ ...s, coverInBody: e.target.checked }))} /> Also show the cover at the top of the article</label>}

      {/* excerpt — rich editor (like content) */}
      <div className="mt-4">
        <label className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] block mb-1.5">Excerpt {fr && '· FR'}</label>
        <MarkdownEditor value={g('excerpt')} onChange={(v) => setField('excerpt', v)} minHeight={70} placeholder={fr ? 'Court résumé affiché sur les cartes…' : 'Short summary shown on the blog cards…'} />
      </div>

      {/* body — full editor */}
      <div className="mt-4">
        <label className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] block mb-1.5">Content {fr && '· FR'}</label>
        <MarkdownEditor full value={g('body')} onChange={(v) => setField('body', v)} minHeight={240} placeholder={fr ? 'Rédige en Markdown (même syntaxe que les notes BMM)…' : 'Write in Markdown — same syntax as the BMM update notes.'} />
      </div>

      {/* table of contents (sommaire) */}
      <div className="mt-4 rounded-xl border border-[var(--line)] p-3">
        <label className="flex items-center justify-between text-sm font-medium cursor-pointer">
          <span>Table of contents (sommaire)</span>
          <input type="checkbox" checked={f.showToc} onChange={(e) => setF((s) => ({ ...s, showToc: e.target.checked }))} />
        </label>
        <p className="text-xs text-[var(--faint)] mt-1">Auto-built from your headings, shown at the top of the post. Leave off to place your own with the <b>Table of contents</b> block.</p>
        {f.showToc && <input className="input !py-1.5 !text-sm mt-2" value={f.tocTitle} onChange={(e) => setF((s) => ({ ...s, tocTitle: e.target.value }))} placeholder="Heading (default: On this page)" />}
      </div>

      {/* reactions + collaborators (shared across languages) */}
      <div className="mt-5 grid sm:grid-cols-2 gap-3">
        <div className="rounded-xl border border-[var(--line)] p-3">
          <label className="flex items-center justify-between text-sm font-medium cursor-pointer">
            <span>Reactions</span>
            <input type="checkbox" checked={f.reactionsEnabled} onChange={(e) => setF((s) => ({ ...s, reactionsEnabled: e.target.checked }))} />
          </label>
          <p className="text-xs text-[var(--faint)] mt-1">Let readers react — pick up to 3 ({f.reactionTypes.length}/3).</p>
          {f.reactionsEnabled && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {REACTION_PALETTE.map((name) => {
                const on = f.reactionTypes.includes(name); const disabled = !on && f.reactionTypes.length >= 3;
                return <button key={name} type="button" disabled={disabled} title={name} onClick={() => toggleReaction(name)}
                  className={`w-9 h-9 rounded-lg border grid place-items-center transition ${on ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary-2)]' : disabled ? 'border-[var(--line)] opacity-30' : 'border-[var(--line)] hover:border-[var(--line-strong)]'}`}><ReactionIcon name={name} size={17} /></button>;
              })}
            </div>
          )}
        </div>
        <div className="rounded-xl border border-[var(--line)] p-3">
          <div className="text-sm font-medium">Collaborators</div>
          <p className="text-xs text-[var(--faint)] mt-1">Add co-authors by email — their avatars show on the post.</p>
          <div className="flex gap-1.5 mt-2">
            <Input value={collab} onChange={(e) => setCollab(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCoAuthor(); } }} placeholder="collaborator@email.com" className="!py-1.5 !text-sm" />
            <Button type="button" size="sm" onClick={addCoAuthor}><Plus size={14} /></Button>
          </div>
          {f.coAuthorEmails.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {f.coAuthorEmails.map((email) => (
                <span key={email} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-[var(--surface-2)] border border-[var(--line)]">{email}<button type="button" onClick={() => removeCoAuthor(email)} className="text-[var(--faint)] hover:text-error"><X size={11} /></button></span>
              ))}
            </div>
          )}
          {/* Comments: an editor-collaboration tool. Off = only editors see them; on =
              readers see them (read-only) on the published article. */}
          <label className="flex items-start gap-2 mt-3 pt-3 border-t border-[var(--line)] cursor-pointer">
            <input type="checkbox" className="mt-0.5" checked={f.commentsPublic} onChange={(e) => setF({ ...f, commentsPublic: e.target.checked })} />
            <span className="text-xs"><span className="font-medium flex items-center gap-1">{f.commentsPublic ? <Globe size={12} className="text-success" /> : <MessageSquare size={12} />} Comments visible to readers</span>
              <span className="text-[var(--faint)]">{f.commentsPublic ? 'Readers can read the comment thread (they still can’t post — comments are an editor tool).' : 'Comments stay private to editors (author, co-authors, staff).'}</span></span>
          </label>
          {/* Newsletter announcement — send subscribers an email about this post (once).
              Uses the standard template; the subject/intro can be overridden. Staff only. */}
          {canNewsletter && <div className="mt-3 pt-3 border-t border-[var(--line)]">
            {nlSent ? (
              <div className="text-xs text-[var(--faint)] flex items-center gap-1.5"><Mail size={12} className="text-success" /> {t('be.nl.already', 'Newsletter already sent on {d}.').replace('{d}', new Date(nlSent).toLocaleDateString())}</div>
            ) : (<>
              <label className={`flex items-start gap-2 ${f.publish ? 'cursor-pointer' : 'opacity-50'}`}>
                <input type="checkbox" className="mt-0.5" disabled={!f.publish} checked={f.notifyNewsletter && f.publish} onChange={(e) => setF({ ...f, notifyNewsletter: e.target.checked })} />
                <span className="text-xs"><span className="font-medium flex items-center gap-1"><Mail size={12} className="text-[var(--primary-2)]" /> {t('be.nl.notify', 'Announce to newsletter subscribers')}</span>
                  <span className="text-[var(--faint)]">{f.publish ? t('be.nl.notifyhint', 'Emails active subscribers about this new article (with a link). Sent once.') : t('be.nl.draftnote', 'Publish the post to announce it.')}</span></span>
              </label>
              {f.notifyNewsletter && f.publish && (
                <div className="mt-2.5 ml-6 space-y-2">
                  <Input value={f.newsletterSubject} onChange={(e) => setF({ ...f, newsletterSubject: e.target.value })} placeholder={t('be.nl.subjectph', 'Subject (optional) — default: “New on BetterCommunity: {title}”').replace('{title}', f.title || '…')} maxLength={200} className="!text-sm" />
                  <Textarea rows={2} value={f.newsletterIntro} onChange={(e) => setF({ ...f, newsletterIntro: e.target.value })} placeholder={t('be.nl.introph', 'Intro message (optional) — defaults to the post excerpt.')} maxLength={2000} className="!text-sm" />
                </div>
              )}
            </>)}
          </div>}
        </div>
      </div>
      {showHistory && post && <HistoryModal base={`/blog/${post.id}`} onClose={() => setShowHistory(false)}
        onRestore={(rev) => { setF((s) => ({ ...s, title: rev.title || s.title, body: rev.body || '', bodyFr: rev.bodyFr ?? s.bodyFr })); setTab('en'); }} />}
      {showComments && post && <CommentsModal base={`/blog/${post.id}`} body={f.body} onClose={() => setShowComments(false)} />}
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
    </Modal>
  );
}
