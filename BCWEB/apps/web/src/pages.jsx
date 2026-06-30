import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { api } from './api.js';
import { useAuth } from './auth.jsx';

// ── small helpers ──
function useAsync(fn, deps = []) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const reload = () => { setLoading(true); fn().then((d) => { setData(d); setErr(null); }).catch(setErr).finally(() => setLoading(false)); };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, deps);
  return { data, err, loading, reload };
}
const Card = ({ children, className = '' }) => <div className={`card p-5 ${className}`}>{children}</div>;
const H = ({ children }) => <h1 className="text-2xl font-extrabold mb-4">{children}</h1>;

// ── Home ──
export function Home() {
  const { data } = useAsync(() => api.get('/blog'), []);
  return (
    <div className="space-y-8">
      <div className="card p-10 text-center">
        <h1 className="text-4xl font-extrabold mb-2"><span className="accent-text">BetterCommunity</span></h1>
        <p className="text-slate-400">The hub for BMM, BSM and friends — catalogs, presets, accounts and hosted Server-Repos.</p>
        <div className="flex gap-3 justify-center mt-5">
          <Link to="/catalog?project=bmm" className="btn btn-primary">Browse BMM catalog</Link>
          <Link to="/catalog?project=bsm&kind=PRESET" className="btn">BSM presets</Link>
        </div>
      </div>
      <div>
        <h2 className="text-xl font-bold mb-3">Latest news</h2>
        <div className="grid md:grid-cols-2 gap-4">
          {(data?.posts || []).slice(0, 6).map((p) => (
            <Card key={p.id}>
              <div className="text-xs text-accent uppercase">{p.project?.name}</div>
              <Link to="/blog" className="font-semibold">{p.title}</Link>
            </Card>
          ))}
          {!data?.posts?.length && <div className="text-slate-500">No posts yet.</div>}
        </div>
      </div>
    </div>
  );
}

// ── Catalog browse ──
export function Catalog() {
  const [sp, setSp] = useSearchParams();
  const project = sp.get('project') || '';
  const kind = sp.get('kind') || '';
  const q = sp.get('q') || '';
  const { data, loading } = useAsync(() => api.get(`/catalog?${new URLSearchParams({ project, kind, q })}`), [project, kind, q]);
  const set = (k, v) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); setSp(n); };
  return (
    <div>
      <H>Catalog {project && `· ${project.toUpperCase()}`}</H>
      <div className="flex flex-wrap gap-2 mb-5">
        <input className="input max-w-xs" placeholder="Search…" defaultValue={q} onKeyDown={(e) => e.key === 'Enter' && set('q', e.target.value)} />
        {['', 'APP', 'PLUGIN', 'THEME', 'PRESET'].map((k) => (
          <button key={k} className={'btn ' + (kind === k ? 'btn-primary' : '')} onClick={() => set('kind', k)}>{k || 'All'}</button>
        ))}
      </div>
      {loading ? <div className="text-slate-400">Loading…</div> : (
        <div className="grid md:grid-cols-3 gap-4">
          {(data?.items || []).map((it) => (
            <Link key={it.id} to={`/item/${it.slug}`}><Card className="hover:border-accent">
              <div className="flex justify-between text-xs text-slate-400"><span>{it.kind}</span><span>v{it.version}</span></div>
              <div className="font-semibold mt-1">{it.name}</div>
              <div className="text-sm text-slate-400 line-clamp-2">{it.description}</div>
              <div className="text-xs text-slate-500 mt-2">by {it.owner?.displayName}</div>
            </Card></Link>
          ))}
          {!data?.items?.length && <div className="text-slate-500">Nothing here yet.</div>}
        </div>
      )}
    </div>
  );
}

export function ItemDetail() {
  const { slug } = useParams();
  const { data, loading, err } = useAsync(() => api.get(`/catalog/${slug}`), [slug]);
  if (loading) return <div className="text-slate-400">Loading…</div>;
  if (err) return <div className="text-slate-500">Not found.</div>;
  const it = data.item;
  return (
    <div className="max-w-2xl">
      <div className="text-xs text-accent uppercase">{it.kind} · v{it.version}</div>
      <H>{it.name}</H>
      <p className="text-slate-300 whitespace-pre-wrap">{it.description}</p>
      <div className="flex gap-2 mt-3">{(it.tags || []).map((t) => <span key={t} className="text-xs px-2 py-1 rounded bg-white/5">#{t}</span>)}</div>
      <Card className="mt-5"><div className="text-xs text-slate-400 mb-1">metadata</div>
        <pre className="text-xs overflow-auto">{JSON.stringify(it.meta, null, 2)}</pre></Card>
    </div>
  );
}

export function Blog() {
  const { data } = useAsync(() => api.get('/blog'), []);
  return (
    <div><H>Blog</H>
      <div className="space-y-4">{(data?.posts || []).map((p) => (
        <Card key={p.id}>
          <div className="text-xs text-accent uppercase">{p.project?.name} · {p.author?.displayName}</div>
          <div className="font-semibold text-lg">{p.title}</div>
          <p className="text-slate-300 whitespace-pre-wrap mt-1">{p.body}</p>
        </Card>
      ))}{!data?.posts?.length && <div className="text-slate-500">No posts yet.</div>}</div>
    </div>
  );
}

export function Repos() {
  const { data } = useAsync(() => api.get('/repos'), []);
  const gb = (n) => (n / 1024 / 1024 / 1024).toFixed(1);
  return (
    <div><H>Server Repos</H>
      <div className="grid md:grid-cols-2 gap-4">{(data?.repos || []).map((r) => (
        <Card key={r.id}>
          <div className="flex justify-between"><span className="font-semibold">{r.name}</span><span className="text-xs text-green-400">{r.status}</span></div>
          <div className="text-sm text-slate-400">by {r.owner?.displayName}</div>
          <div className="text-xs text-slate-500 mt-2">{gb(r.storageUsedBytes)} / {gb(r.storageQuotaBytes)} GB</div>
        </Card>
      ))}{!data?.repos?.length && <div className="text-slate-500">No hosted repos online.</div>}</div>
    </div>
  );
}

// ── Auth ──
export function Auth() {
  const { login, register } = useAuth();
  const nav = useNavigate();
  const [mode, setMode] = useState('login');
  const [f, setF] = useState({ email: '', password: '', displayName: '' });
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    try { mode === 'login' ? await login(f.email, f.password) : await register(f.email, f.password, f.displayName); nav('/dashboard'); }
    catch (x) { setErr(x.data?.error || 'failed'); }
  };
  return (
    <div className="max-w-sm mx-auto">
      <H>{mode === 'login' ? 'Sign in' : 'Create account'}</H>
      <form onSubmit={submit} className="space-y-3">
        {mode === 'register' && <input className="input" placeholder="Display name" value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} />}
        <input className="input" type="email" placeholder="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <input className="input" type="password" placeholder="Password (8+ chars)" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        {err && <div className="text-red-400 text-sm">{err}</div>}
        <button className="btn btn-primary w-full justify-center">{mode === 'login' ? 'Sign in' : 'Register'}</button>
      </form>
      <button className="text-sm text-slate-400 mt-3" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
        {mode === 'login' ? 'Need an account? Register' : 'Have an account? Sign in'}
      </button>
    </div>
  );
}

// ── User dashboard ──
export function Dashboard() {
  const items = useAsync(() => api.get('/me/items'), []);
  const notes = useAsync(() => api.get('/me/notifications'), []);
  const [form, setForm] = useState({ projectKey: 'bmm', kind: 'PLUGIN', name: '', description: '', version: '1.0.0', meta: '{}' });
  const [msg, setMsg] = useState('');
  const submit = async (e) => {
    e.preventDefault(); setMsg('');
    try {
      let meta = {}; try { meta = JSON.parse(form.meta || '{}'); } catch { setMsg('meta must be valid JSON'); return; }
      await api.post('/catalog', { ...form, tags: [], meta });
      setMsg('Submitted — pending moderation.'); items.reload();
    } catch (x) { setMsg(x.data?.error || 'failed'); }
  };
  return (
    <div className="space-y-8">
      <div><H>Submit to a catalog</H>
        <Card><form onSubmit={submit} className="grid md:grid-cols-2 gap-3">
          <select className="input" value={form.projectKey} onChange={(e) => setForm({ ...form, projectKey: e.target.value })}>
            <option value="bmm">BMM</option><option value="bsm">BSM</option></select>
          <select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            {['APP', 'PLUGIN', 'THEME', 'PRESET'].map((k) => <option key={k}>{k}</option>)}</select>
          <input className="input" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="input" placeholder="Version" value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} />
          <textarea className="input md:col-span-2" placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <textarea className="input md:col-span-2 font-mono text-xs" placeholder='meta JSON (e.g. a BSM preset)' value={form.meta} onChange={(e) => setForm({ ...form, meta: e.target.value })} />
          <div className="md:col-span-2 flex items-center gap-3"><button className="btn btn-primary">Submit</button><span className="text-sm text-slate-400">{msg}</span></div>
        </form></Card>
      </div>
      <div><h2 className="text-xl font-bold mb-3">My items</h2>
        <div className="grid md:grid-cols-3 gap-4">{(items.data?.items || []).map((it) => (
          <Card key={it.id}><div className="flex justify-between text-xs"><span>{it.kind}</span><span className={it.status === 'PUBLISHED' ? 'text-green-400' : it.status === 'REJECTED' ? 'text-red-400' : 'text-yellow-400'}>{it.status}</span></div>
            <div className="font-semibold">{it.name}</div></Card>
        ))}{!items.data?.items?.length && <div className="text-slate-500">No items yet.</div>}</div>
      </div>
      <div><h2 className="text-xl font-bold mb-3">Notifications</h2>
        <div className="space-y-2">{(notes.data?.notifications || []).map((n) => (
          <Card key={n.id} className="py-3"><div className="text-sm">{n.body}</div></Card>
        ))}{!notes.data?.notifications?.length && <div className="text-slate-500">Nothing new.</div>}</div>
      </div>
    </div>
  );
}

// ── Admin / moderation ──
export function Admin() {
  const subs = useAsync(() => api.get('/mod/submissions'), []);
  const act = async (id, action) => {
    try {
      if (action === 'reject') { const reason = prompt('Rejection reason?'); if (!reason) return; await api.post(`/mod/submissions/${id}/reject`, { reason }); }
      else await api.post(`/mod/submissions/${id}/approve`);
      subs.reload();
    } catch (x) { alert(x.data?.error || 'failed'); }
  };
  return (
    <div><H>Moderation queue</H>
      <div className="space-y-3">{(subs.data?.submissions || []).map((s) => (
        <Card key={s.id} className="flex items-center gap-4">
          <div className="flex-1"><div className="text-xs text-slate-400">{s.type} · {s.item?.kind}</div><div className="font-semibold">{s.item?.name}</div></div>
          <button className="btn btn-primary" onClick={() => act(s.id, 'approve')}>Approve</button>
          <button className="btn" onClick={() => act(s.id, 'reject')}>Reject</button>
        </Card>
      ))}{!subs.data?.submissions?.length && <div className="text-slate-500">Queue is empty 🎉</div>}</div>
    </div>
  );
}
