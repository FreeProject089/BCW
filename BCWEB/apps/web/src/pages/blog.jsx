import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useParams, useNavigate } from 'react-router-dom';
import {
  Newspaper, PenSquare, ImagePlus, Youtube, Link2, Video, Bold, Heading, List, Eye,
  Trash2, Pencil, ArrowLeft, CalendarDays, User as UserIcon, Plus, X, Tag as TagIcon, HelpCircle, Languages, Sparkles,
  Blocks as BlocksIcon, LayoutGrid, ChevronDown, ListOrdered, Milestone, Columns2, Code2, Keyboard, Smile, ListTree, FileDown, AlignCenter, GitMerge, History, MessageSquare, Globe,
  Table, Quote, Minus, AlignLeft, AlignRight, Mail, PlayCircle, Upload, Download, Lock, Unlock,
} from 'lucide-react';
import { api, uploadBlogImage, uploadReplay } from '../lib/api.js';
import { thumb } from '../lib/img.js';
import { useAuth } from './auth.jsx';
import { useI18n } from '../i18n.jsx';
import Markdown, { anchorEl } from '../ui/md.jsx';
import Avatar from '../ui/Avatar.jsx';
import { REACTION_OPTIONS, ReactionIcon } from '../ui/reactions.jsx';
// The drag-and-drop composer now comes from the B.MD package rather than from a copy living
// in this app: BmdBlockCanvas sits on the package's lossless block model, so reordering and
// editing round-trip the source byte-for-byte, where the local one re-serialised through a
// block model that only knew the shapes it had forms for — anything else drifted on save.
import { BmdBlockCanvas, BmdLivePreview, SNIPPET_GROUPS, localizeSnippetGroups } from '@bettercommunity/bmd-editor';
import TableBuilder from '../editor/table-builder.jsx';
import { parseBmdFile, serializeBmdFile } from '@bettercommunity/bmd/editor-blocks';
import IconPicker from '../editor/icon-picker.jsx';
import SelectionToolbar from '../editor/selection-toolbar.jsx';
import KbdPicker from '../editor/kbd-picker.jsx';
import { merge3, hasConflictMarkers } from '../lib/merge3.js';
import HistoryModal from '../editor/history-modal.jsx';
import DiffMergeModal from '../editor/diff-merge-modal.jsx';
import CommentsModal from '../editor/comments-modal.jsx';
import { useToast, useDialog, Button, Card, Badge, Input, Textarea, Select, Field, PageHeader, EmptyState, Spinner, Modal, SkeletonGrid, ColorInput } from '../ui/ui.jsx';
import BmdEditor from '@bettercommunity/bmd-editor';

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
      <img src={m.img} alt="" className="logo-plate w-4 h-4 rounded-[3px] object-contain" /> {m.label}
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
      {loading ? <SkeletonGrid count={6} className="grid md:grid-cols-2 lg:grid-cols-3 gap-5" />
        : posts.length ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {posts.map((p) => { const v = pickLang(p, lang); return (
              <div key={p.id} className="group relative">
                <Link to={`/blog/${p.slug}`}><Card hover className="overflow-hidden h-full flex flex-col">
                  {p.cover ? <img src={thumb(p.cover, 512)} alt="" className="w-full h-44 object-cover" />
                    : <div className="w-full h-44 bg-[var(--surface-2)] border-b border-[var(--line)] grid place-items-center">{p.showcaseProject?.icon ? <img src={p.showcaseProject.icon} alt="" className="w-14 h-14 rounded-xl object-contain opacity-90" /> : p.showcaseProject ? <Sparkles size={40} className="text-[var(--primary-2)] opacity-90" /> : <img src={(TYPE_TAG[p.project?.key] || TYPE_TAG.community).img} alt="" className="logo-plate w-12 h-12 rounded-xl object-contain opacity-90" />}</div>}
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
        ) : <EmptyState icon={Newspaper} title={t('blog.empty', 'No posts yet')}
          sub={canWrite
            ? t('blog.empty.s.w', 'This is where the team writes about releases and what changed, and nothing has been published yet.')
            : t('blog.empty.s.r', 'Release notes and announcements are published here, and there is nothing yet.')}
          action={canWrite
            ? { label: t('blog.newpost', 'New post'), onClick: () => setEditing({}), icon: Plus }
            : { label: t('blog.empty.a', 'Read the docs'), to: '/docs', icon: Newspaper }} />}
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
        ? <p className="mt-4 text-sm text-[var(--primary-2)] font-semibold">{t('news.check', 'Almost there, check your inbox to confirm your subscription.')}</p>
        : (
          <form onSubmit={submit} className="mt-4 flex flex-col sm:flex-row gap-2 max-w-md mx-auto">
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('news.ph', 'you@example.com')}
              className="flex-1 rounded-full border border-[var(--line)] bg-[var(--bg-solid)] px-4 py-2.5 text-sm outline-none focus:border-[var(--primary)]" />
            <Button type="submit" variant="primary" disabled={state === 'sending'}>{state === 'sending' ? t('news.sending', 'Subscribing…') : t('news.cta', 'Subscribe')}</Button>
          </form>
        )}
      {state === 'error' && <p className="mt-3 text-sm text-error">{t('news.err', 'Could not subscribe, check the address and try again.')}</p>}
    </div>
  );
}
/* AuthorsRow and the section-comment hooks moved to ui/post-bits.jsx: docs, pages and
   home needed them and were importing this whole page to get them, which is what kept
   blog.jsx from ever being split off. Imported AND re-exported — this page uses all
   three, and `export … from` would forward the names without binding them here. */
import { AuthorsRow, useSectionComments, useSectionCommentPills, headingSlug } from '../ui/post-bits.jsx';
export { AuthorsRow, useSectionComments, useSectionCommentPills };

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
            <span className="text-xs text-[var(--faint)] me-1">{t('blog.rx.label', 'Reactions')}</span>
            {p.reactionTypes.map((type) => {
              const count = rx?.counts?.[type] || 0; const mine = rx?.mine === type;
              return (
                <button key={type} onClick={() => react(type)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition ${mine ? 'border-[var(--primary)] tint-primary text-[var(--primary-2)]' : 'border-[var(--line)] hover:border-[var(--line-strong)]'}`}>
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
/* The rich Markdown editor moved to editor/markdown-editor.jsx so /dev/editor can have the
   SAME one — importing it from here would have pulled the whole blog page into that chunk.
   Imported AND re-exported: this page renders it too, and `export … from` forwards the name
   without binding it here, which is a ReferenceError at the first render rather than a build
   error. Several pages already import it from this module, so the re-export stays. */
import { MarkdownEditor } from '../editor/markdown-editor.jsx';
export { MarkdownEditor };

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
            if (post && x.status === 409 && x.data?.current) { toast.error(t('be.conflict.reopen', 'Someone else edited this, reopened so you can merge, then Save.')); reopenDraft(snapshot, { post, base: origBase, conflict: true }); }
            else { toast.error(x.data?.error === 'blog_limit' ? t('be.full', 'Blog is full, trim or delete an article, or raise the limit.') : (x.data?.error || t('be.failed', 'Failed.'))); reopenDraft(snapshot, { post, base: origBase }); }
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
        if (totalConflicts > 0) { setMergeUI({ queue }); toast.info(t('be.conflictvisual', 'Someone else edited this post, resolve the conflicts visually, then Save.')); }
        else toast.info(t('be.mergedreview', 'Merged with edits made by someone else, review the content, then Save again.'));
      } else if (x.status === 409 && x.data?.error === 'blog_limit') {
        const d = x.data;
        const where = d.scope === 'project' ? t('be.thispage', 'this page') : t('be.thesite', 'the site');
        toast.error(d.kind === 'count'
          ? t('be.fullcount', 'Blog is full: {where} allows at most {limit} article(s) (currently {current}). Delete one or raise the limit.').replace('{where}', where).replace('{limit}', d.limit).replace('{current}', d.current)
          : t('be.fullsize', "Blog is full: {where}'s size limit ({kb} KB) would be exceeded. Trim this article, delete an old one, or raise the limit.").replace('{where}', where).replace('{kb}', d.limitKB));
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
        {post && <Button variant="ghost" className="!text-error me-auto" onClick={del}><Trash2 size={15} /> Delete</Button>}
        {post && <Button variant="ghost" onClick={() => setShowHistory(true)}><History size={15} /> History</Button>}
        {post && <Button variant="ghost" onClick={() => setShowComments(true)}><MessageSquare size={15} /> Comments</Button>}
        <label className="flex items-center gap-1.5 text-sm text-[var(--muted)] me-2"><input type="checkbox" checked={f.publish} onChange={(e) => setF({ ...f, publish: e.target.checked })} /> Published</label>
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
                  {mergeUI?.queue?.length ? 'Resolve them in the panel, then Save.' : <>Then Save. {merge.pending && <button className="underline font-medium" onClick={() => setMergeUI({ queue: merge.pending })}>{t('blg.reopen', "Reopen resolver")}</button>}</>}</>
              : <><b>{t('blg.merged', "Merged cleanly with someone else's edits.")}</b> {t('blg.reviewsave', "Review the content and Save again.")}</>}
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
          <optgroup label={t('blg.projects', "Projects")}>
            {(scopes?.projects || [{ key: 'community', name: 'Community' }]).map((pr) => <option key={pr.key} value={`project:${pr.key}`}>{pr.name}</option>)}
          </optgroup>
          {(scopes?.showcases || []).length > 0 && <optgroup label={t('blg.otherprojects', "Other projects")}>
            {scopes.showcases.map((s) => <option key={s.slug} value={`showcase:${s.slug}`}>{s.name}</option>)}
          </optgroup>}
        </select>
        <Button type="button" size="sm" onClick={pickCover}><ImagePlus size={14} /> {f.cover ? t('blg.changecover', 'Change cover') : t('blg.addcover', 'Add cover')}</Button>
        {f.cover && <Button type="button" size="sm" onClick={() => setF((s) => ({ ...s, cover: '' }))}><X size={14} /> {t('blg.removecover', 'Remove')}</Button>}
        <span className="text-xs text-[var(--faint)] ms-auto">{t('blg.sharedlang', 'Cover & blog are shared across languages')}</span>
      </div>
      {f.cover && <div className="rounded-xl overflow-hidden border border-[var(--line)] mt-3"><img src={thumb(f.cover, 512)} alt="" className="w-full h-40 object-cover" /></div>}
      {f.cover && <label className="flex items-center gap-2 text-sm mt-2 cursor-pointer text-[var(--muted)]"><input type="checkbox" checked={f.coverInBody !== false} onChange={(e) => setF((s) => ({ ...s, coverInBody: e.target.checked }))} /> {t('be.coverInBody', 'Also show the cover at the top of the article')}</label>}

      {/* excerpt — rich editor (like content) */}
      <div className="mt-4">
        <label className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] block mb-1.5">Excerpt {fr && '· FR'}</label>
        <MarkdownEditor value={g('excerpt')} onChange={(v) => setField('excerpt', v)} minHeight={70} placeholder={fr ? 'Court résumé affiché sur les cartes…' : 'Short summary shown on the blog cards…'} />
      </div>

      {/* body — full editor */}
      <div className="mt-4">
        <label className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] block mb-1.5">Content {fr && '· FR'}</label>
        <MarkdownEditor full value={g('body')} onChange={(v) => setField('body', v)} minHeight={240} placeholder={fr ? 'Rédige en Markdown (même syntaxe que les notes BMM)…' : 'Write in Markdown, same syntax as the BMM update notes.'} />
      </div>

      {/* table of contents (sommaire) */}
      <div className="mt-4 rounded-xl border border-[var(--line)] p-3">
        <label className="flex items-center justify-between text-sm font-medium cursor-pointer">
          <span>{t('blg.toclong', "Table of contents (sommaire)")}</span>
          <input type="checkbox" checked={f.showToc} onChange={(e) => setF((s) => ({ ...s, showToc: e.target.checked }))} />
        </label>
        <p className="text-xs text-[var(--faint)] mt-1">Auto-built from your headings, shown at the top of the post. Leave off to place your own with the <b>{t('blg.toc', "Table of contents")}</b> block.</p>
        {f.showToc && <input className="input !py-1.5 !text-sm mt-2" value={f.tocTitle} onChange={(e) => setF((s) => ({ ...s, tocTitle: e.target.value }))} placeholder={t('be.toc.headingPh', 'Heading (default: On this page)')} />}
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
                  className={`w-9 h-9 rounded-lg border grid place-items-center transition ${on ? 'border-[var(--primary)] tint-primary text-[var(--primary-2)]' : disabled ? 'border-[var(--line)] opacity-30' : 'border-[var(--line)] hover:border-[var(--line-strong)]'}`}><ReactionIcon name={name} size={17} /></button>;
              })}
            </div>
          )}
        </div>
        <div className="rounded-xl border border-[var(--line)] p-3">
          <div className="text-sm font-medium">{t('blg.collaborators', 'Collaborators')}</div>
          <p className="text-xs text-[var(--faint)] mt-1">{t('blg.coauthorhint', 'Add co-authors by email, their avatars show on the post.')}</p>
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
              <span className="text-[var(--faint)]">{f.commentsPublic ? 'Readers can read the comment thread (they still can’t post, comments are an editor tool).' : 'Comments stay private to editors (author, co-authors, staff).'}</span></span>
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
                <div className="mt-2.5 ms-6 space-y-2">
                  <Input value={f.newsletterSubject} onChange={(e) => setF({ ...f, newsletterSubject: e.target.value })} placeholder={t('be.nl.subjectph', 'Subject (optional), default: “New on BetterCommunity: {title}”').replace('{title}', f.title || '…')} maxLength={200} className="!text-sm" />
                  <Textarea rows={2} value={f.newsletterIntro} onChange={(e) => setF({ ...f, newsletterIntro: e.target.value })} placeholder={t('be.nl.introph', 'Intro message (optional), defaults to the post excerpt.')} maxLength={2000} className="!text-sm" />
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
