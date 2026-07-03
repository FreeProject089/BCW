import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import {
  Newspaper, PenSquare, ImagePlus, Youtube, Link2, Video, Bold, Heading, List, Eye,
  Trash2, Pencil, ArrowLeft, CalendarDays, User as UserIcon, Plus, X, Tag as TagIcon, HelpCircle, Languages, Sparkles,
} from 'lucide-react';
import { api, uploadBlogImage } from './api.js';
import { useAuth } from './auth.jsx';
import { useI18n } from './i18n.jsx';
import Markdown from './md.jsx';
import { useToast, useDialog, Button, Card, Badge, Input, Textarea, Select, Field, PageHeader, EmptyState, Spinner, Modal } from './ui.jsx';

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
      <Sparkles size={14} className="text-[var(--primary-2)]" /> {post.showcaseProject.name}
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
export function BlogList() {
  const { user } = useAuth(); const { lang, t } = useI18n();
  const { data, loading, reload } = useFetch(() => api.get('/blog'), []);
  const { data: scopeData } = useFetch(() => (user ? api.get('/blog/my-scopes') : Promise.resolve(null)), [user?.id]);
  const [editing, setEditing] = useState(null); // null = closed, {} = new, post = edit
  const isStaff = user && (user.role === 'ADMIN' || user.role === 'MOD' || user.role === 'SUPERADMIN');
  // A granted regular user can write, but can only edit THEIR OWN posts — never
  // staff's or another grantee's.
  const canWrite = isStaff || !!scopeData;
  const canEdit = (p) => isStaff || p.authorId === user?.id;
  const posts = data?.posts || [];
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
                  {p.cover ? <img src={p.cover} alt="" className="w-full h-44 object-cover" />
                    : <div className="w-full h-44 bg-gradient-to-br from-orange-500/25 to-amber-500/10 grid place-items-center">{p.showcaseProject ? <Sparkles size={40} className="text-[var(--primary-2)] opacity-90" /> : <img src={(TYPE_TAG[p.project?.key] || TYPE_TAG.community).img} alt="" className="w-12 h-12 rounded-xl object-contain opacity-90" />}</div>}
                  <div className="p-5 flex-1 flex flex-col">
                    <div className="text-xs text-[var(--faint)] flex items-center gap-2">{fmtDate(p.publishedAt)}{!v.translated && <span className="inline-flex items-center gap-1 text-[var(--faint)]"><Languages size={11} /> {t('blog.untranslated', 'not translated')}</span>}</div>
                    <div className="font-bold mt-1.5 text-lg leading-snug">{v.title}</div>
                    {v.excerpt && <div className="text-sm text-[var(--muted)] mt-1.5 line-clamp-2 flex-1">{v.excerpt}</div>}
                    <div className="mt-4 pt-3 border-t border-[var(--line)] flex items-center justify-between">
                      <TypeTag post={p} />
                      <span className="text-xs text-[var(--faint)] truncate max-w-[45%]">{p.author?.displayName}</span>
                    </div>
                  </div>
                </Card></Link>
                {canWrite && canEdit(p) && <button onClick={() => setEditing(p)} className="absolute top-3 right-3 btn btn-sm opacity-0 group-hover:opacity-100 transition"><Pencil size={13} /></button>}
              </div>
            ); })}
          </div>
        ) : <EmptyState icon={Newspaper} title={t('blog.empty', 'No posts yet')} sub={canWrite ? t('blog.writefirst', 'Write the first one.') : undefined}>{canWrite && <Button variant="primary" onClick={() => setEditing({})}><Plus size={16} /> {t('blog.newpost', 'New post')}</Button>}</EmptyState>}
      {editing !== null && <BlogEditor post={editing.id ? editing : null} scopes={scopeData} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </div>
  );
}

/* ── Single post ── */
export function BlogPostPage() {
  const { slug } = useParams();
  const { lang, t } = useI18n();
  const { data, loading } = useFetch(() => api.get(`/blog/${slug}`), [slug]);
  if (loading) return <div className="flex items-center gap-2 text-[var(--muted)] py-10"><Spinner /> {t('common.loading', 'Loading…')}</div>;
  if (!data?.post) return <EmptyState icon={Newspaper} title={t('blog.notfound', 'Post not found')} />;
  const p = data.post; const v = pickLang(p, lang);
  return (
    <div className="max-w-3xl mx-auto">
      <Link to="/blog" className="text-sm text-[var(--muted)] hover:text-[var(--text)] flex items-center gap-1 mb-4"><ArrowLeft size={14} /> {t('blog.title', 'Blog')}</Link>
      <article className="card p-6 md:p-9">
        <TypeTag post={p} />
        <h1 className="text-3xl md:text-4xl font-extrabold mt-3 leading-tight">{v.title}</h1>
        <div className="text-sm text-[var(--faint)] mt-3 flex items-center gap-3"><span className="flex items-center gap-1"><UserIcon size={13} /> {p.author?.displayName}</span><span className="flex items-center gap-1"><CalendarDays size={13} /> {fmtDate(p.publishedAt)}</span></div>
        {!v.translated && <div className="mt-5 p-3 rounded-lg border border-[var(--line)] bg-orange-500/5 text-sm text-[var(--muted)] flex items-center gap-2"><Languages size={15} className="text-[var(--primary-2)]" /> Cet article n'est pas encore traduit en français — version anglaise affichée.</div>}
        {p.cover && <img src={p.cover} alt="" className="w-full rounded-2xl mt-6 border border-[var(--line)]" />}
        <Markdown className="mt-7">{v.body}</Markdown>
      </article>
    </div>
  );
}

/* ── Reusable rich Markdown editor (toolbar + preview). `full` adds media/badges. ── */
function MarkdownEditor({ value, onChange, placeholder, minHeight = 220, full = false }) {
  const toast = useToast(); const dialog = useDialog();
  const ref = useRef(null); const [preview, setPreview] = useState(false);
  const insert = (text) => {
    const ta = ref.current; const v = value || ''; const at = ta ? ta.selectionStart : v.length;
    const next = v.slice(0, at) + text + v.slice(at); onChange(next);
    setTimeout(() => { if (ta) { ta.focus(); ta.selectionStart = ta.selectionEnd = at + text.length; } }, 0);
  };
  const pickImage = (cb) => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.onchange = async () => { const file = i.files?.[0]; if (!file) return; try { toast.info('Uploading…'); cb(await uploadBlogImage(file)); } catch { toast.error('Upload failed.'); } }; i.click(); };
  const ytEmbed = async () => { const url = await dialog.prompt({ title: 'YouTube', label: 'Video URL or ID', placeholder: 'https://youtu.be/…' }); if (!url) return; const m = url.match(/(?:v=|youtu\.be\/|embed\/)([\w-]{11})/) || [null, url.trim()]; insert(`\n<div class="yt-embed"><iframe src="https://www.youtube-nocookie.com/embed/${m[1]}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>\n`); };
  const linkEmbed = async () => { const url = await dialog.prompt({ title: 'Link', label: 'URL', placeholder: 'https://…' }); if (!url) return; const txt = await dialog.prompt({ title: 'Link', label: 'Text', defaultValue: url }); insert(`[${txt || url}](${url})`); };
  const videoEmbed = async () => { const url = await dialog.prompt({ title: 'Video', label: 'Video file URL (mp4/webm)', placeholder: 'https://…' }); if (!url) return; insert(`\n<video controls src="${url}" style="width:100%;border-radius:12px"></video>\n`); };
  const tool = (Icon, fn, title) => <button type="button" title={title} onClick={fn} className="btn btn-sm"><Icon size={14} /></button>;
  return (
    <div className="rounded-xl border border-[var(--line)] overflow-hidden bg-[var(--surface-2)]">
      <div className="flex flex-wrap items-center gap-1 px-2 py-1.5 border-b border-[var(--line)]">
        {tool(Bold, () => insert('**bold**'), 'Bold')}{tool(Heading, () => insert('\n## Heading\n'), 'Heading')}{tool(List, () => insert('\n- item\n'), 'List')}{tool(Link2, linkEmbed, 'Link')}
        {full && <>
          <span className="w-px h-5 bg-[var(--line)] mx-1 self-center" />
          {tool(ImagePlus, () => pickImage((u) => insert(`\n![image](${u})\n`)), 'Image')}{tool(Youtube, ytEmbed, 'YouTube')}{tool(Video, videoEmbed, 'Video')}
          <span className="w-px h-5 bg-[var(--line)] mx-1 self-center" />
          {['NEW', 'FIXED', 'IMPROVED'].map((b) => <button key={b} type="button" onClick={() => insert(`[${b}] `)} className="btn btn-sm !py-1"><span className={`md-badge md-badge-${b === 'NEW' ? 'new' : b === 'FIXED' ? 'fixed' : 'improved'} !mr-0`}>{b}</span></button>)}
          {tool(TagIcon, () => insert('\n> [!NOTE]\n> Something worth highlighting.\n'), 'Callout / alert')}
        </>}
        <button type="button" onClick={() => setPreview((v) => !v)} className="btn btn-sm ml-auto"><Eye size={14} /> {preview ? 'Edit' : 'Preview'}</button>
        {full && <a href="/blog/markdown-guide" target="_blank" rel="noreferrer" className="btn btn-sm" title="Markdown guide"><HelpCircle size={14} /> Guide</a>}
      </div>
      {preview
        ? <div className="p-4 max-h-[38vh] overflow-auto"><Markdown>{value || '*Nothing yet.*'}</Markdown></div>
        : <textarea ref={ref} className="w-full bg-transparent border-0 outline-none resize-none p-4 text-sm leading-relaxed text-[var(--text)]" style={{ minHeight }} value={value || ''} spellCheck={false} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />}
    </div>
  );
}

/* ── Editor (bilingual EN base + optional FR) ── */
// `scopes` (from GET /blog/my-scopes): { projects, showcases, global } — staff gets
// `global: true` (every blog); a granted regular USER gets only the blogs listed.
// `scope` values are encoded "project:<key>" or "showcase:<slug>" to disambiguate
// the two blog "spaces" in one dropdown.
function BlogEditor({ post, scopes, onClose, onSaved }) {
  const toast = useToast(); const dialog = useDialog();
  const defaultScope = scopes?.projects?.[0] ? `project:${scopes.projects[0].key}` : scopes?.showcases?.[0] ? `showcase:${scopes.showcases[0].slug}` : 'project:community';
  const [f, setF] = useState({ scope: defaultScope, cover: '', publish: true, title: '', excerpt: '', body: '', titleFr: '', excerptFr: '', bodyFr: '' });
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('en'); // en (base) | fr (optional)
  useEffect(() => {
    if (post) setF({ scope: post.showcaseProject ? `showcase:${post.showcaseProject.slug}` : `project:${post.project?.key || 'community'}`, cover: post.cover || '', publish: post.status === 'PUBLISHED',
      title: post.title || '', excerpt: post.excerpt || '', body: post.body || '',
      titleFr: post.titleFr || '', excerptFr: post.excerptFr || '', bodyFr: post.bodyFr || '' });
    else setF((s) => ({ ...s, scope: defaultScope }));
    // eslint-disable-next-line
  }, [post]);
  const suffix = tab === 'fr' ? 'Fr' : '';
  const g = (base) => f[base + suffix];
  const setField = (base, val) => setF((s) => ({ ...s, [base + suffix]: val }));
  const hasFr = !!(f.titleFr || f.bodyFr || f.excerptFr);

  const pickCover = () => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.onchange = async () => { const file = i.files?.[0]; if (!file) return; try { toast.info('Uploading…'); const url = await uploadBlogImage(file); setF((s) => ({ ...s, cover: url })); } catch { toast.error('Upload failed.'); } }; i.click(); };
  const save = async () => {
    if (f.title.length < 2 || !f.body) return toast.error('English (base) title and content are required.');
    setBusy(true);
    try {
      const [scopeKind, scopeVal] = f.scope.split(':');
      const body = { projectKey: scopeKind === 'project' ? scopeVal : undefined, showcaseSlug: scopeKind === 'showcase' ? scopeVal : undefined,
        cover: f.cover || null, publish: f.publish,
        title: f.title, excerpt: f.excerpt, body: f.body,
        titleFr: f.titleFr || null, excerptFr: f.excerptFr || null, bodyFr: f.bodyFr || null };
      if (post) await api.patch(`/blog/${post.id}`, body); else await api.post('/blog', body);
      toast.success(post ? 'Post updated.' : 'Post published.'); onSaved();
    } catch (x) { toast.error(x.data?.error === 'forbidden' ? "You don't have permission to post in that blog." : x.data?.error || 'Failed.'); } finally { setBusy(false); }
  };
  const del = async () => {
    if (!post) return;
    if (!(await dialog.confirm({ title: 'Delete post', message: 'This cannot be undone.', okLabel: 'Delete', danger: true }))) return;
    try { await api.del(`/blog/${post.id}`); toast.success('Deleted.'); onSaved(); } catch { toast.error('Failed.'); }
  };
  const fr = tab === 'fr';
  return (
    <Modal open onClose={onClose} title={post ? 'Edit post' : 'Write a post'} icon={PenSquare} width="max-w-3xl"
      footer={<>
        {post && <Button variant="ghost" className="!text-red-400 mr-auto" onClick={del}><Trash2 size={15} /> Delete</Button>}
        <label className="flex items-center gap-1.5 text-sm text-[var(--muted)] mr-2"><input type="checkbox" checked={f.publish} onChange={(e) => setF({ ...f, publish: e.target.checked })} /> Published</label>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : (post ? 'Save' : 'Publish')}</Button>
      </>}>
      {/* language tabs */}
      <div className="flex items-center gap-1 mb-3">
        {[['en', 'English (base)'], ['fr', 'Français']].map(([l, label]) => (
          <button key={l} type="button" onClick={() => setTab(l)} className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5 border ${tab === l ? 'bg-[var(--surface-2)] border-[var(--line)] font-medium' : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'}`}>
            <Languages size={13} /> {label}{l === 'fr' && <span className={`text-[10px] ${hasFr ? 'text-emerald-400' : 'text-[var(--faint)]'}`}>{hasFr ? '✓' : '(optionnel)'}</span>}
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
      {f.cover && <div className="rounded-xl overflow-hidden border border-[var(--line)] mt-3"><img src={f.cover} alt="" className="w-full h-40 object-cover" /></div>}

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
    </Modal>
  );
}
