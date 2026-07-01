import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import {
  Newspaper, PenSquare, ImagePlus, Youtube, Link2, Video, Bold, Heading, List, Eye,
  Trash2, Pencil, ArrowLeft, CalendarDays, User as UserIcon, Plus, X,
} from 'lucide-react';
import { api, uploadBlogImage } from './api.js';
import { useAuth } from './auth.jsx';
import { useToast, useDialog, Button, Card, Badge, Input, Textarea, Select, Field, PageHeader, EmptyState, Spinner, Modal } from './ui.jsx';

function useFetch(fn, deps) {
  const [data, setData] = useState(null); const [loading, setLoading] = useState(true);
  const reload = () => { setLoading(true); fn().then(setData).catch(() => setData(null)).finally(() => setLoading(false)); };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, deps);
  return { data, loading, reload };
}
const fmtDate = (d) => d ? new Date(d).toLocaleDateString() : '';

/* ── Blog list ── */
export function BlogList() {
  const { user } = useAuth();
  const { data, loading, reload } = useFetch(() => api.get('/blog'), []);
  const [editing, setEditing] = useState(null); // null = closed, {} = new, post = edit
  const isStaff = user && (user.role === 'ADMIN' || user.role === 'MOD');
  const posts = data?.posts || [];
  return (
    <div>
      <PageHeader icon={Newspaper} title="Blog" subtitle="News and updates across every project."
        actions={isStaff && <Button variant="primary" onClick={() => setEditing({})}><PenSquare size={16} /> Write a post</Button>} />
      {loading ? <div className="flex items-center gap-2 text-[var(--muted)] py-10"><Spinner /> Loading…</div>
        : posts.length ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {posts.map((p) => (
              <div key={p.id} className="group relative">
                <Link to={`/blog/${p.slug}`}><Card hover className="overflow-hidden h-full flex flex-col">
                  {p.cover ? <img src={p.cover} alt="" className="w-full h-44 object-cover" />
                    : <div className="w-full h-44 bg-gradient-to-br from-orange-500/25 to-amber-500/10 grid place-items-center"><Newspaper size={28} className="text-[var(--primary-2)]" /></div>}
                  <div className="p-5 flex-1 flex flex-col">
                    <Badge tone="primary" className="self-start">{p.project?.name}</Badge>
                    <div className="font-semibold mt-2 text-lg leading-snug">{p.title}</div>
                    <div className="text-sm text-[var(--muted)] mt-1 line-clamp-2 flex-1">{p.excerpt}</div>
                    <div className="text-xs text-[var(--faint)] mt-3 flex items-center gap-2"><UserIcon size={12} /> {p.author?.displayName} · {fmtDate(p.publishedAt)}</div>
                  </div>
                </Card></Link>
                {isStaff && <button onClick={() => setEditing(p)} className="absolute top-3 right-3 btn btn-sm opacity-0 group-hover:opacity-100 transition"><Pencil size={13} /></button>}
              </div>
            ))}
          </div>
        ) : <EmptyState icon={Newspaper} title="No posts yet" sub={isStaff ? 'Write the first one.' : undefined}>{isStaff && <Button variant="primary" onClick={() => setEditing({})}><Plus size={16} /> New post</Button>}</EmptyState>}
      {editing !== null && <BlogEditor post={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </div>
  );
}

/* ── Single post ── */
export function BlogPostPage() {
  const { slug } = useParams();
  const { data, loading } = useFetch(() => api.get(`/blog/${slug}`), [slug]);
  if (loading) return <div className="flex items-center gap-2 text-[var(--muted)] py-10"><Spinner /> Loading…</div>;
  if (!data?.post) return <EmptyState icon={Newspaper} title="Post not found" />;
  const p = data.post;
  return (
    <article className="max-w-3xl mx-auto">
      <Link to="/blog" className="text-sm text-[var(--muted)] hover:text-[var(--text)] flex items-center gap-1 mb-5"><ArrowLeft size={14} /> Blog</Link>
      <Badge tone="primary">{p.project?.name}</Badge>
      <h1 className="text-4xl font-extrabold mt-3 leading-tight">{p.title}</h1>
      <div className="text-sm text-[var(--faint)] mt-3 flex items-center gap-3"><span className="flex items-center gap-1"><UserIcon size={13} /> {p.author?.displayName}</span><span className="flex items-center gap-1"><CalendarDays size={13} /> {fmtDate(p.publishedAt)}</span></div>
      {p.cover && <img src={p.cover} alt="" className="w-full rounded-2xl mt-6 border border-[var(--line)]" />}
      <div className="md-body mt-8"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>{p.body}</ReactMarkdown></div>
    </article>
  );
}

/* ── Editor ── */
function BlogEditor({ post, onClose, onSaved }) {
  const toast = useToast(); const dialog = useDialog();
  const [f, setF] = useState({ projectKey: 'community', title: '', excerpt: '', cover: '', body: '', publish: true });
  const [busy, setBusy] = useState(false); const [preview, setPreview] = useState(false);
  const bodyRef = useRef(null);
  useEffect(() => {
    if (post) setF({ projectKey: post.project?.key || 'community', title: post.title, excerpt: post.excerpt || '', cover: post.cover || '', body: post.body, publish: post.status === 'PUBLISHED' });
  }, [post]);

  const insert = (text) => {
    const ta = bodyRef.current; const at = ta ? ta.selectionStart : f.body.length;
    const next = f.body.slice(0, at) + text + f.body.slice(at);
    setF((s) => ({ ...s, body: next }));
    setTimeout(() => { if (ta) { ta.focus(); ta.selectionStart = ta.selectionEnd = at + text.length; } }, 0);
  };
  const pickImage = (cb) => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.onchange = async () => { const file = i.files?.[0]; if (!file) return; try { toast.info('Uploading…'); cb(await uploadBlogImage(file)); } catch { toast.error('Upload failed.'); } }; i.click(); };
  const ytEmbed = async () => {
    const url = await dialog.prompt({ title: 'YouTube', label: 'Video URL or ID', placeholder: 'https://youtu.be/…' }); if (!url) return;
    const m = url.match(/(?:v=|youtu\.be\/|embed\/)([\w-]{11})/) || [null, url.trim()];
    insert(`\n<div class="yt-embed"><iframe src="https://www.youtube-nocookie.com/embed/${m[1]}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>\n`);
  };
  const linkEmbed = async () => { const url = await dialog.prompt({ title: 'Link', label: 'URL', placeholder: 'https://…' }); if (!url) return; const txt = await dialog.prompt({ title: 'Link', label: 'Text', defaultValue: url }); insert(`[${txt || url}](${url})`); };
  const videoEmbed = async () => { const url = await dialog.prompt({ title: 'Video', label: 'Video file URL (mp4/webm)', placeholder: 'https://…' }); if (!url) return; insert(`\n<video controls src="${url}" style="width:100%;border-radius:12px"></video>\n`); };

  const save = async () => {
    if (f.title.length < 2 || !f.body) return toast.error('Title and body are required.');
    setBusy(true);
    try {
      if (post) await api.patch(`/blog/${post.id}`, f); else await api.post('/blog', f);
      toast.success(post ? 'Post updated.' : 'Post published.'); onSaved();
    } catch (x) { toast.error(x.data?.error || 'Failed.'); } finally { setBusy(false); }
  };
  const del = async () => {
    if (!post) return;
    const ok = await dialog.confirm({ title: 'Delete post', message: 'This cannot be undone.', okLabel: 'Delete', danger: true });
    if (!ok) return;
    try { await api.del(`/blog/${post.id}`); toast.success('Deleted.'); onSaved(); } catch { toast.error('Failed.'); }
  };

  const tool = (Icon, fn, title) => <button type="button" title={title} onClick={fn} className="btn btn-sm"><Icon size={14} /></button>;
  return (
    <Modal open onClose={onClose} title={post ? 'Edit post' : 'Write a post'} icon={PenSquare} width="max-w-3xl"
      footer={<>
        {post && <Button variant="ghost" className="!text-red-400 mr-auto" onClick={del}><Trash2 size={15} /> Delete</Button>}
        <label className="flex items-center gap-1.5 text-sm text-[var(--muted)] mr-2"><input type="checkbox" checked={f.publish} onChange={(e) => setF({ ...f, publish: e.target.checked })} /> Published</label>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : (post ? 'Save' : 'Publish')}</Button>
      </>}>
      {/* cover with live preview */}
      <div className="rounded-xl overflow-hidden border border-[var(--line)] mb-4">
        <div className="relative h-32 bg-[var(--surface-2)] grid place-items-center"
          style={f.cover ? { backgroundImage: `url(${f.cover})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}>
          {!f.cover && <div className="text-sm text-[var(--faint)] flex items-center gap-2"><ImagePlus size={16} /> Add a cover image</div>}
          <div className="absolute bottom-2 right-2 flex gap-2">
            <Button type="button" size="sm" onClick={() => pickImage((u) => setF((s) => ({ ...s, cover: u })))}><ImagePlus size={14} /> Upload</Button>
            {f.cover && <Button type="button" size="sm" onClick={() => setF((s) => ({ ...s, cover: '' }))}><X size={14} /></Button>}
          </div>
        </div>
      </div>
      <div className="grid sm:grid-cols-[1fr_180px] gap-3">
        <Field label="Title"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="A great title" /></Field>
        <Field label="Project"><Select value={f.projectKey} onChange={(e) => setF({ ...f, projectKey: e.target.value })}><option value="community">Community</option><option value="bmm">BMM</option><option value="bsm">BSM</option></Select></Field>
      </div>
      <div className="mt-3"><Field label="Excerpt"><Textarea className="!min-h-[48px]" value={f.excerpt} onChange={(e) => setF({ ...f, excerpt: e.target.value })} placeholder="Short summary shown on cards." /></Field></div>
      <div className="mt-3 rounded-xl border border-[var(--line)] overflow-hidden">
        <div className="flex items-center justify-between px-2 py-1.5 code-chrome">
          <div className="flex gap-1">
            {tool(Bold, () => insert('**bold**'), 'Bold')}{tool(Heading, () => insert('\n## Heading\n'), 'Heading')}{tool(List, () => insert('\n- item\n'), 'List')}
            <span className="w-px h-5 bg-[var(--line)] mx-1 self-center" />
            {tool(ImagePlus, () => pickImage((u) => insert(`\n![image](${u})\n`)), 'Image')}{tool(Youtube, ytEmbed, 'YouTube')}{tool(Video, videoEmbed, 'Video')}{tool(Link2, linkEmbed, 'Link')}
          </div>
          <button type="button" onClick={() => setPreview((v) => !v)} className="btn btn-sm"><Eye size={14} /> {preview ? 'Edit' : 'Preview'}</button>
        </div>
        {preview
          ? <div className="p-5 max-h-[42vh] overflow-auto" style={{ background: 'var(--bg-solid)' }}><div className="md-body"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>{f.body || '*Nothing yet.*'}</ReactMarkdown></div></div>
          : <textarea ref={bodyRef} className="code-area w-full" style={{ minHeight: 260 }} value={f.body} spellCheck={false} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder="Write in Markdown. Use the toolbar for images, YouTube, video and links." />}
      </div>
    </Modal>
  );
}
