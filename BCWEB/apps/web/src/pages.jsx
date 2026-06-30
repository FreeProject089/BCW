import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { api, uploadPayload } from './api.js';
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
      {it.payloadKey && <button className="btn btn-primary mt-4" onClick={async () => {
        try { const { url } = await api.get(`/catalog/${slug}/download`); window.open(url, '_blank'); } catch { alert('download failed'); }
      }}>Download</button>}
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

// ── Hosting (buy a hosted Server-Repo) ──
export function Hosting() {
  const { user } = useAuth();
  const nav = useNavigate();
  const plans = useAsync(() => api.get('/hosting/plans'), []);
  const cap = useAsync(() => api.get('/hosting/capacity'), []);
  const buy = async (plan) => {
    if (!user) return nav('/auth');
    const repoName = prompt('Name for your hosted repo?'); if (!repoName) return;
    try { const { url } = await api.post('/hosting/checkout', { planId: plan.id, repoName }); window.location = url; }
    catch (x) { alert(x.data?.error === 'capacity_full' ? 'No capacity available right now.' : (x.data?.error || 'failed')); }
  };
  const c = cap.data?.capacity;
  return (
    <div><H>Host a Server-Repo</H>
      {c && <Card className="mb-5 text-sm text-slate-400">Capacity: {c.freeGB.toFixed(0)} GB free of {c.usableGB.toFixed(0)} GB usable {c.enabled ? '' : '· (hosting disabled)'}</Card>}
      <div className="grid md:grid-cols-4 gap-4">{(plans.data?.plans || []).map((pl) => (
        <Card key={pl.id} className="text-center">
          <div className="text-3xl font-extrabold">{pl.storageGB}<span className="text-base text-slate-400"> GB</span></div>
          <div className="text-sm text-slate-400 mt-1">{(pl.uploadLimitKbps / 1024).toFixed(0)} Mbps · {pl.cpuShare} CPU</div>
          <div className="text-accent font-bold my-3">${(pl.priceMonthlyCents / 100).toFixed(2)}/mo</div>
          <button className="btn btn-primary w-full justify-center" onClick={() => buy(pl)}>Get hosted</button>
        </Card>
      ))}</div>
      <p className="text-xs text-slate-500 mt-4">Updates to a hosted repo only require a valid SHA. We set the upload limit per repo.</p>
    </div>
  );
}

// ── Admin: capacity + pricing settings (ADMIN only) ──
function AdminSettings() {
  const { data, reload } = useAsync(() => api.get('/admin/settings'), []);
  const [draft, setDraft] = useState({});
  useEffect(() => { if (data?.settings) setDraft(data.settings); }, [data]);
  const KEYS = [
    ['hosting.totalCapacityGB', 'Total capacity (GB)'], ['hosting.reservedFreeGB', 'Reserved free margin (GB)'],
    ['pricing.perGBCents', 'Price per GB (¢)'], ['pricing.perUploadMbpsCents', 'Price per Mbps (¢)'],
    ['pricing.perCpuShareCents', 'Price per CPU share (¢)'], ['features.hostingEnabled', 'Hosting enabled (true/false)'],
  ];
  const save = async (key) => { try { await api.put(`/admin/settings/${key}`, { value: coerce(draft[key]) }); reload(); } catch { alert('save failed'); } };
  const coerce = (v) => v === 'true' ? true : v === 'false' ? false : (v !== '' && !isNaN(Number(v)) ? Number(v) : v);
  return (
    <div className="mt-10"><h2 className="text-xl font-bold mb-3">Hosting settings</h2>
      <div className="grid md:grid-cols-2 gap-3">{KEYS.map(([k, label]) => (
        <Card key={k} className="flex items-center gap-3">
          <div className="flex-1"><div className="text-xs text-slate-400">{label}</div>
            <input className="input mt-1" value={draft[k] ?? ''} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} /></div>
          <button className="btn" onClick={() => save(k)}>Save</button>
        </Card>
      ))}</div>
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
  const [file, setFile] = useState(null);
  const [msg, setMsg] = useState('');

  // For a BSM preset the .json IS the metadata: parse it to prefill name/version/meta.
  const onFile = async (f) => {
    setFile(f);
    if (f && form.kind === 'PRESET' && /json$/i.test(f.name)) {
      try { const j = JSON.parse(await f.text()); setForm((s) => ({ ...s, meta: JSON.stringify(j, null, 2), name: j.name || s.name, version: j.version || s.version })); }
      catch { setMsg('preset is not valid JSON'); }
    }
  };

  const submit = async (e) => {
    e.preventDefault(); setMsg('');
    try {
      let meta = {}; try { meta = JSON.parse(form.meta || '{}'); } catch { setMsg('meta must be valid JSON'); return; }
      let payloadKey;
      if (file) { setMsg('Uploading…'); payloadKey = await uploadPayload(form.kind, file); }
      await api.post('/catalog', { ...form, tags: [], meta, payloadKey });
      setMsg('Submitted — pending moderation.'); setFile(null); items.reload();
    } catch (x) { setMsg(x.data?.error || x.message || 'failed'); }
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
          <label className="md:col-span-2 text-sm text-slate-400">
            {form.kind === 'PRESET' ? 'Preset .json file' : 'Payload file (zip / wasm)'}
            <input className="input mt-1" type="file" onChange={(e) => onFile(e.target.files?.[0] || null)} />
          </label>
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
  const { user } = useAuth();
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
      {user?.role === 'ADMIN' && <AdminSettings />}
    </div>
  );
}
