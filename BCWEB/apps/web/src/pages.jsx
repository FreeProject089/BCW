import { useEffect, useState, useRef } from 'react';
import { Link, useParams, useSearchParams, useNavigate } from 'react-router-dom';
import {
  Boxes, Music2, Puzzle, Palette, Server, Rocket, Download, ArrowRight, Search, Upload,
  Bell, CheckCircle2, XCircle, Clock, Package, ShieldCheck, Inbox, Tag, FileJson, HardDrive,
  Cpu, Gauge, TrendingUp, Eye, Sparkles, Lock, Zap, Users, GitBranch, Settings2,
  Newspaper, LayoutDashboard, Cookie, Sliders, Heart,
} from 'lucide-react';
import { api, uploadPayload } from './api.js';
import { useAuth } from './auth.jsx';
import { useI18n } from './i18n.jsx';
import { MyRepos, AdminRepos, Billing } from './repos.jsx';
import { Button, Card, Badge, Input, Textarea, Select, Field, PageHeader, EmptyState, Spinner, Modal, useDialog, useToast } from './ui.jsx';

/* ── helpers ── */
function useAsync(fn, deps = []) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const reload = () => { setLoading(true); fn().then((d) => { setData(d); setErr(null); }).catch(setErr).finally(() => setLoading(false)); };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, deps);
  return { data, err, loading, reload };
}
const KIND_ICON = { APP: Boxes, PLUGIN: Puzzle, THEME: Palette, PRESET: FileJson };
const statusTone = (s) => s === 'PUBLISHED' ? 'green' : s === 'REJECTED' ? 'red' : 'amber';
const Loading = () => <div className="flex items-center gap-2 text-[var(--muted)] py-10"><Spinner /> Loading…</div>;

/* ─────────────────────────  Home  ───────────────────────── */
export function Home() {
  const { data } = useAsync(() => api.get('/blog'), []);
  const { t } = useI18n();
  const products = [
    { icon: Boxes, name: 'BMM', desc: t('prod.bmm.d'), to: '/p/bmm', tint: 'from-orange-500/20' },
    { icon: Music2, name: 'BSM', desc: t('prod.bsm.d'), to: '/p/bsm', tint: 'from-amber-500/20' },
    { icon: Download, name: 'BetterInstaller', desc: t('prod.installer.d'), to: '/p/installer', tint: 'from-orange-500/20' },
    { icon: Rocket, name: 'Hosting', desc: t('prod.hosting.d'), to: '/hosting', tint: 'from-amber-500/20' },
  ];
  return (
    <div className="space-y-24">
      {/* hero */}
      <section className="relative text-center pt-20 pb-14">
        <div className="relative z-10">
          <div className="anim-slide inline-flex items-center gap-2 badge mb-5"><Sparkles size={13} className="text-[var(--primary-2)]" /> <span className="text-[var(--text)]">{t('home.badge')}</span></div>
          <h1 className="anim-slide text-5xl md:text-7xl font-extrabold leading-[1.03]">
            {t('home.hero1')}<br /><span className="gradient-text">{t('home.brand')}</span> {t('home.hero2')}
          </h1>
          <p className="anim-slide text-[var(--muted)] text-lg max-w-xl mx-auto mt-6">{t('home.sub')}</p>
          <div className="anim-slide flex flex-wrap gap-3 justify-center mt-9">
            <Link to="/catalog?project=bmm"><Button variant="primary">{t('home.cta.explore')} <ArrowRight size={16} /></Button></Link>
            <Link to="/hosting"><Button>{t('home.cta.host')}</Button></Link>
          </div>
        </div>
      </section>

      {/* products */}
      <section className="grid md:grid-cols-4 gap-4">
        {products.map((p) => (
          <Link key={p.name} to={p.to}><Card hover className={`p-5 h-full bg-gradient-to-b ${p.tint} to-transparent`}>
            <p.icon size={22} className="text-[var(--primary-2)]" />
            <div className="font-semibold mt-3">{p.name}</div>
            <div className="text-sm text-[var(--muted)] mt-1">{p.desc}</div>
            <div className="text-xs text-[var(--primary-2)] mt-3 flex items-center gap-1">{t('prod.open')} <ArrowRight size={12} /></div>
          </Card></Link>
        ))}
      </section>

      {/* features */}
      <section className="grid md:grid-cols-3 gap-4">
        {[[ShieldCheck, t('home.feat.moderated'), t('home.feat.moderated.d')],
          [Lock, t('home.feat.accounts'), t('home.feat.accounts.d')],
          [Zap, t('home.feat.hosting'), t('home.feat.hosting.d')]].map(([I, title, d]) => (
          <Card key={title} className="p-6"><I size={20} className="text-[var(--primary-2)]" /><div className="font-semibold mt-3">{title}</div><div className="text-sm text-[var(--muted)] mt-1">{d}</div></Card>
        ))}
      </section>

      {/* how it works */}
      <section className="anim-fade">
        <div className="text-center mb-8"><h2 className="text-3xl font-extrabold">{t('home.steps.title')}</h2><p className="text-[var(--muted)] mt-2">{t('home.steps.sub')}</p></div>
        <div className="grid md:grid-cols-3 gap-4">
          {[[Users, t('home.step1'), t('home.step1.d')],
            [Upload, t('home.step2'), t('home.step2.d')],
            [Rocket, t('home.step3'), t('home.step3.d')]].map(([I, title, d], i) => (
            <Card key={title} className="p-6 relative">
              <span className="absolute top-5 right-5 text-5xl font-extrabold text-[var(--surface-2)] leading-none">{i + 1}</span>
              <div className="grid place-items-center w-11 h-11 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500"><I size={20} className="text-white" /></div>
              <div className="font-semibold mt-4">{title}</div><div className="text-sm text-[var(--muted)] mt-1">{d}</div>
            </Card>
          ))}
        </div>
      </section>

      {/* latest posts */}
      <section className="anim-fade">
        <div className="flex items-center justify-between mb-4"><h2 className="text-xl font-bold">{t('home.news')}</h2><Link to="/blog" className="text-sm text-[var(--primary-2)] flex items-center gap-1">{t('home.news.all')} <ArrowRight size={13} /></Link></div>
        <div className="grid md:grid-cols-3 gap-5">
          {(data?.posts || []).slice(0, 3).map((p) => (
            <Link key={p.id} to={`/blog/${p.slug}`}><Card hover className="overflow-hidden h-full flex flex-col">
              {p.cover ? <img src={p.cover} alt="" className="w-full h-40 object-cover" />
                : <div className="w-full h-40 bg-gradient-to-br from-orange-500/25 to-amber-500/10 grid place-items-center"><Newspaper size={26} className="text-[var(--primary-2)]" /></div>}
              <div className="p-5 flex flex-col flex-1">
                <Badge tone="primary" className="self-start">{p.project?.name}</Badge>
                <div className="font-semibold mt-2 leading-snug">{p.title}</div>
                <div className="text-sm text-[var(--muted)] mt-1 line-clamp-2 flex-1">{p.excerpt}</div>
                <div className="text-xs text-[var(--primary-2)] mt-3 flex items-center gap-1">Read <ArrowRight size={12} /></div>
              </div>
            </Card></Link>
          ))}
          {!data?.posts?.length && <Card className="p-6 text-[var(--muted)] text-sm md:col-span-3">{t('home.news.none')}</Card>}
        </div>
      </section>

      {/* CTA / support */}
      <section className="anim-fade">
        <Card className="p-10 text-center relative overflow-hidden bg-gradient-to-br from-orange-500/15 via-amber-500/5 to-transparent">
          <h2 className="text-3xl font-extrabold">{t('home.cta2.title')}</h2>
          <p className="text-[var(--muted)] mt-2 max-w-lg mx-auto">{t('home.cta2.sub')}</p>
          <div className="flex flex-wrap gap-3 justify-center mt-6">
            <Link to="/auth"><Button variant="primary">{t('home.cta2.start')} <ArrowRight size={16} /></Button></Link>
            <a href="https://ko-fi.com/bettercommunity" target="_blank" rel="noreferrer"><Button><Heart size={16} className="text-orange-400" /> {t('home.cta2.kofi')}</Button></a>
          </div>
        </Card>
      </section>
    </div>
  );
}

/* ─────────────────────────  Catalog  ───────────────────────── */
export function Catalog() {
  const [sp, setSp] = useSearchParams();
  const project = sp.get('project') || '', kind = sp.get('kind') || '', q = sp.get('q') || '';
  const { data, loading } = useAsync(() => api.get(`/catalog?${new URLSearchParams({ project, kind, q })}`), [project, kind, q]);
  const set = (k, v) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); setSp(n); };
  return (
    <div>
      <PageHeader icon={Package} title={`Catalog${project ? ` · ${project.toUpperCase()}` : ''}`} subtitle="Community apps, plugins, themes and presets." />
      <div className="flex flex-wrap gap-2 mb-6 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
          <Input className="!pl-9" placeholder="Search…" defaultValue={q} onKeyDown={(e) => e.key === 'Enter' && set('q', e.target.value)} />
        </div>
        {['', 'APP', 'PLUGIN', 'THEME', 'PRESET'].map((k) => <Button key={k} size="sm" variant={kind === k ? 'primary' : 'default'} onClick={() => set('kind', k)}>{k || 'All'}</Button>)}
      </div>
      {loading ? <Loading /> : (data?.items?.length ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.items.map((it) => { const I = KIND_ICON[it.kind] || Package; return (
            <Link key={it.id} to={`/item/${it.slug}`}><Card hover className="p-5 h-full">
              <div className="flex items-center justify-between"><div className="grid place-items-center w-9 h-9 rounded-lg bg-[var(--surface-2)] border border-[var(--line)]"><I size={17} className="text-[var(--primary-2)]" /></div><Badge>v{it.version}</Badge></div>
              <div className="font-semibold mt-3">{it.name}</div>
              <div className="text-sm text-[var(--muted)] mt-1 line-clamp-2">{it.description || 'No description.'}</div>
              <div className="text-xs text-[var(--faint)] mt-3 flex items-center gap-1"><Users size={12} /> {it.owner?.displayName}</div>
            </Card></Link>); })}
        </div>
      ) : <EmptyState icon={Inbox} title="Nothing here yet" sub="Be the first to publish to this catalog." />)}
    </div>
  );
}

export function ItemDetail() {
  const { slug } = useParams();
  const toast = useToast();
  const { data, loading, err } = useAsync(() => api.get(`/catalog/${slug}`), [slug]);
  if (loading) return <Loading />;
  if (err) return <EmptyState icon={XCircle} title="Not found" />;
  const it = data.item; const I = KIND_ICON[it.kind] || Package;
  const download = async () => { try { const { url } = await api.get(`/catalog/${slug}/download`); window.open(url, '_blank'); } catch { toast.error('Download failed'); } };
  return (
    <div className="max-w-3xl">
      <div className="flex items-start gap-4">
        <div className="grid place-items-center w-14 h-14 rounded-2xl bg-gradient-to-br from-orange-500/25 to-amber-500/15 border border-[var(--line)]"><I size={26} className="text-[var(--primary-2)]" /></div>
        <div className="flex-1">
          <div className="flex items-center gap-2"><Badge tone="primary">{it.kind}</Badge><Badge>v{it.version}</Badge></div>
          <h1 className="text-2xl font-bold mt-2">{it.name}</h1>
          <div className="text-sm text-[var(--faint)] mt-1 flex items-center gap-1"><Users size={13} /> {it.owner?.displayName}</div>
        </div>
        {it.payloadKey && <Button variant="primary" onClick={download}><Download size={16} /> Download</Button>}
      </div>
      <p className="text-[var(--muted)] leading-relaxed mt-6 whitespace-pre-wrap">{it.description || 'No description.'}</p>
      {it.tags?.length > 0 && <div className="flex flex-wrap gap-2 mt-4">{it.tags.map((t) => <Badge key={t}><Tag size={11} /> {t}</Badge>)}</div>}
      <Card className="mt-6 p-5"><div className="text-xs font-semibold text-[var(--faint)] uppercase tracking-wider mb-2 flex items-center gap-1.5"><FileJson size={13} /> Metadata</div>
        <pre className="text-xs text-[var(--muted)] overflow-auto max-h-80">{JSON.stringify(it.meta, null, 2)}</pre></Card>
    </div>
  );
}

export function Blog() {
  const { data, loading } = useAsync(() => api.get('/blog'), []);
  return (
    <div>
      <PageHeader icon={Newspaper} title="Blog" subtitle="News and updates across every project." />
      {loading ? <Loading /> : (data?.posts?.length ? <div className="space-y-4 max-w-3xl">
        {data.posts.map((p) => <Card key={p.id} className="p-6"><div className="flex items-center gap-2"><Badge tone="primary">{p.project?.name}</Badge><span className="text-xs text-[var(--faint)]">{p.author?.displayName}</span></div>
          <h2 className="text-lg font-semibold mt-2">{p.title}</h2><p className="text-[var(--muted)] mt-2 whitespace-pre-wrap leading-relaxed">{p.body}</p></Card>)}
      </div> : <EmptyState icon={Inbox} title="No posts yet" />)}
    </div>
  );
}

export function Repos() {
  const { data, loading } = useAsync(() => api.get('/repos'), []);
  const gb = (n) => (n / 1024 / 1024 / 1024).toFixed(1);
  return (
    <div>
      <PageHeader icon={Server} title="Server Repos" subtitle="Public repos we host for the community." />
      {loading ? <Loading /> : (data?.repos?.length ? <div className="grid md:grid-cols-2 gap-4">
        {data.repos.map((r) => { const pct = r.storageQuotaBytes ? Math.min(100, (r.storageUsedBytes / r.storageQuotaBytes) * 100) : 0; return (
          <Card key={r.id} className="p-5"><div className="flex items-center justify-between"><div className="font-semibold flex items-center gap-2"><GitBranch size={15} className="text-[var(--primary-2)]" /> {r.name}</div><Badge tone="green">{r.status}</Badge></div>
            <div className="text-xs text-[var(--faint)] mt-1">by {r.owner?.displayName}</div>
            <div className="mt-3 h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className="h-full bg-gradient-to-r from-orange-500 to-amber-500" style={{ width: `${pct}%` }} /></div>
            <div className="text-xs text-[var(--muted)] mt-1.5">{gb(r.storageUsedBytes)} / {gb(r.storageQuotaBytes)} GB</div></Card>); })}
      </div> : <EmptyState icon={Server} title="No hosted repos online" />)}
    </div>
  );
}

/* ─────────────────────────  Hosting  ───────────────────────── */
export function Hosting() {
  const { user } = useAuth(); const nav = useNavigate(); const dialog = useDialog(); const toast = useToast();
  const plans = useAsync(() => api.get('/hosting/plans'), []);
  const cap = useAsync(() => api.get('/hosting/capacity'), []);
  const [customOpen, setCustomOpen] = useState(false);
  const checkout = async (body) => {
    if (!user) return nav('/auth');
    const repoName = await dialog.prompt({ title: 'Host a repo', label: 'Repository name', placeholder: 'my-awesome-repo', okLabel: 'Continue to payment' });
    if (!repoName) return;
    try { const { url } = await api.post('/hosting/checkout', { ...body, repoName }); window.location = url; }
    catch (x) { toast.error(x.data?.error === 'capacity_full' ? 'No capacity available right now.' : x.data?.error === 'stripe_not_configured' ? 'Payments not configured yet.' : 'Checkout failed.'); }
  };
  const c = cap.data?.capacity;
  return (
    <div>
      <PageHeader icon={Rocket} title="Host a Server-Repo" subtitle="We run it, you manage it. Pay for the size you need." />
      {c && <Card className="p-4 mb-6 flex items-center gap-4 text-sm"><Gauge size={18} className="text-[var(--primary-2)]" />
        <div className="flex-1"><div className="h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className="h-full bg-gradient-to-r from-orange-500 to-amber-500" style={{ width: `${c.usableGB ? 100 - (c.freeGB / c.usableGB) * 100 : 0}%` }} /></div></div>
        <span className="text-[var(--muted)] whitespace-nowrap">{c.freeGB.toFixed(0)} / {c.usableGB.toFixed(0)} GB free</span></Card>}
      {plans.loading ? <Loading /> : <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {(plans.data?.plans || []).map((pl, i) => (
          <Card key={pl.id} className={`p-6 text-center relative ${i === 2 ? 'md:scale-105 md:-my-1' : ''}`}
            style={i === 2 ? { borderColor: 'var(--primary)', boxShadow: '0 0 0 1px var(--primary), 0 18px 50px -18px var(--primary-glow)' } : undefined}>
            {i === 2 && <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[11px] font-bold text-white flex items-center gap-1 bg-gradient-to-r from-orange-500 to-amber-500 shadow-lg"><Sparkles size={11} /> POPULAR</div>}
            <HardDrive size={22} className="mx-auto text-[var(--primary-2)]" />
            <div className="text-4xl font-extrabold mt-3">{pl.storageGB}<span className="text-base font-medium text-[var(--muted)]"> GB</span></div>
            <div className="text-xs text-[var(--faint)] mt-2 flex items-center justify-center gap-3"><span className="flex items-center gap-1"><Zap size={12} />{(pl.uploadLimitKbps / 1024).toFixed(0)}Mbps</span><span className="flex items-center gap-1"><Cpu size={12} />{pl.cpuShare}</span></div>
            <div className="text-2xl font-bold gradient-text my-4">${(pl.priceMonthlyCents / 100).toFixed(2)}<span className="text-sm text-[var(--muted)] font-medium">/mo</span></div>
            <Button variant={i === 2 ? 'primary' : 'default'} className="w-full" onClick={() => checkout({ planId: pl.id })}>Get hosted</Button>
          </Card>
        ))}
      </div>}

      {/* Custom plan */}
      <Card className="p-6 mt-4 flex flex-col sm:flex-row items-center gap-4 bg-gradient-to-r from-orange-500/10 to-transparent">
        <Sliders size={26} className="text-[var(--primary-2)]" />
        <div className="flex-1 text-center sm:text-left"><div className="font-semibold text-lg">Need a different size?</div>
          <div className="text-sm text-[var(--muted)]">Build a custom plan — pick your storage, upload speed and CPU. Price adapts instantly.</div></div>
        <Button variant="primary" onClick={() => setCustomOpen(true)}><Sliders size={16} /> Build custom plan</Button>
      </Card>

      <p className="text-xs text-[var(--faint)] mt-5 flex items-center gap-1.5"><ShieldCheck size={13} /> Updates only require a valid SHA. We set the upload limit per repo.</p>
      <CustomPlanModal open={customOpen} onClose={() => setCustomOpen(false)} onCheckout={(custom) => { setCustomOpen(false); checkout({ custom }); }} />
    </div>
  );
}

function CustomPlanModal({ open, onClose, onCheckout }) {
  const [spec, setSpec] = useState({ storageGB: 20, uploadMbps: 8, cpuShare: 0.5 });
  const [price, setPrice] = useState(null);
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => {
      api.get(`/hosting/price?${new URLSearchParams({ storageGB: spec.storageGB, uploadMbps: spec.uploadMbps, cpuShare: spec.cpuShare })}`)
        .then((r) => setPrice(r.priceMonthlyCents)).catch(() => setPrice(null));
    }, 200);
    return () => clearTimeout(id);
  }, [open, spec]);
  const sliders = [
    { key: 'storageGB', label: 'Storage', min: 1, max: 200, step: 1, fmt: (v) => `${v} GB`, icon: HardDrive },
    { key: 'uploadMbps', label: 'Upload speed', min: 1, max: 200, step: 1, fmt: (v) => `${v} Mbps`, icon: Zap },
    { key: 'cpuShare', label: 'CPU share', min: 0.1, max: 4, step: 0.1, fmt: (v) => `${v} vCPU`, icon: Cpu },
  ];
  return (
    <Modal open={open} onClose={onClose} title="Build a custom plan" icon={Sliders} width="max-w-lg"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => onCheckout(spec)}>Continue to payment</Button></>}>
      <div className="space-y-5">
        {sliders.map((s) => (
          <div key={s.key}>
            <div className="flex items-center justify-between mb-1.5 text-sm"><span className="flex items-center gap-1.5 text-[var(--muted)]"><s.icon size={14} /> {s.label}</span><span className="font-semibold">{s.fmt(spec[s.key])}</span></div>
            <input type="range" min={s.min} max={s.max} step={s.step} value={spec[s.key]} className="bcw-range"
              onChange={(e) => setSpec({ ...spec, [s.key]: Number(e.target.value) })} />
          </div>
        ))}
        <div className="flex items-end justify-between pt-3 border-t border-[var(--line)]">
          <span className="text-sm text-[var(--muted)]">Estimated price</span>
          <span className="text-3xl font-bold gradient-text">{price == null ? '—' : `$${(price / 100).toFixed(2)}`}<span className="text-sm text-[var(--muted)] font-medium">/mo</span></span>
        </div>
      </div>
    </Modal>
  );
}

/* ─────────────────────────  Installer  ───────────────────────── */
export function Installer() {
  const feats = [[Zap, 'Fast & lightweight', 'A native installer that gets out of your way.'],
    [ShieldCheck, 'Signed & verified', 'Integrity-checked payloads, every release.'],
    [GitBranch, 'Smart updates', 'Delta updates keep downloads tiny.'],
    [Settings2, 'Full control', 'Pick components, paths and channels.']];
  return (
    <div>
      <section className="text-center py-10">
        <div className="inline-flex items-center gap-2 badge badge-primary mb-5"><Download size={13} /> BetterInstaller</div>
        <h1 className="text-4xl md:text-5xl font-extrabold">The modern installer<br />for the <span className="gradient-text">Better*</span> suite.</h1>
        <p className="text-[var(--muted)] text-lg max-w-xl mx-auto mt-5">A fast, secure NSIS/MSI replacement with a clean UI, delta updates and a handoff contract with the app.</p>
        <div className="flex gap-3 justify-center mt-8">
          <Button variant="primary"><Download size={16} /> Download for Windows</Button>
          <Button>Release notes</Button>
        </div>
        <div className="text-xs text-[var(--faint)] mt-3">Windows 10/11 · 64-bit</div>
      </section>
      <section className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {feats.map(([I, t, d]) => <Card key={t} className="p-5"><I size={20} className="text-[var(--primary-2)]" /><div className="font-semibold mt-3">{t}</div><div className="text-sm text-[var(--muted)] mt-1">{d}</div></Card>)}
      </section>
      <Card className="p-8 mt-6 text-center bg-gradient-to-b from-orange-500/10 to-transparent">
        <Sparkles size={22} className="mx-auto text-[var(--primary-2)]" />
        <div className="font-semibold text-lg mt-2">In active development</div>
        <p className="text-sm text-[var(--muted)] mt-1 max-w-md mx-auto">BetterInstaller is being built as a separate Slint-based app. Follow progress on the blog.</p>
      </Card>
    </div>
  );
}

/* ─────────────────────────  Auth  ───────────────────────── */
export function Auth() {
  const { login, register } = useAuth(); const nav = useNavigate(); const toast = useToast(); const { t } = useI18n();
  const [mode, setMode] = useState('login');
  const [f, setF] = useState({ email: '', password: '', displayName: '' });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try { mode === 'login' ? await login(f.email, f.password) : await register(f.email, f.password, f.displayName); toast.success(t('auth.welcome.toast')); nav('/dashboard'); }
    catch (x) { toast.error(x.data?.error === 'invalid_credentials' ? 'Wrong email or password.' : x.data?.error === 'email_taken' ? 'Email already registered.' : 'Failed.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="max-w-sm mx-auto mt-8">
      <Card className="p-7">
        <div className="text-center mb-6"><img src="/logo.png" alt="BC" className="w-12 h-12 rounded-xl mb-3 mx-auto" />
          <h1 className="text-xl font-bold">{mode === 'login' ? t('auth.welcome') : t('auth.create')}</h1>
          <p className="text-sm text-[var(--muted)] mt-1">{mode === 'login' ? t('auth.subin') : t('auth.subup')}</p></div>
        <form onSubmit={submit} className="space-y-3">
          {mode === 'register' && <Field label={t('auth.name')}><Input value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} /></Field>}
          <Field label={t('auth.email')}><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="you@example.com" /></Field>
          <Field label={t('auth.password')}><Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder="••••••••" /></Field>
          <Button variant="primary" className="w-full" disabled={busy}>{busy ? <Spinner /> : (mode === 'login' ? t('nav.signin') : t('auth.create'))}</Button>
        </form>
        <button className="text-sm text-[var(--muted)] hover:text-[var(--text)] mt-4 w-full text-center" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? t('auth.toRegister') : t('auth.toLogin')}
        </button>
      </Card>
    </div>
  );
}

/* ─────────────────────────  Dashboard  ───────────────────────── */
const SUBMIT_INIT = { projectKey: 'bmm', kind: 'PLUGIN', name: '', description: '', version: '1.0.0', meta: '{}' };
export function Dashboard() {
  const { user } = useAuth(); const toast = useToast();
  const items = useAsync(() => api.get('/me/items'), []);
  const notes = useAsync(() => api.get('/me/notifications'), []);
  const repos = useAsync(() => api.get('/me/repos'), []);
  const [open, setOpen] = useState(false);

  const list = items.data?.items || [];
  const stats = [
    { icon: Package, label: 'Items', value: list.length },
    { icon: CheckCircle2, label: 'Published', value: list.filter((i) => i.status === 'PUBLISHED').length, tone: 'text-emerald-400' },
    { icon: Clock, label: 'Pending', value: list.filter((i) => i.status === 'PENDING').length, tone: 'text-amber-400' },
    { icon: Server, label: 'Hosted repos', value: (repos.data?.repos || []).length },
  ];
  return (
    <div>
      <PageHeader icon={LayoutDashboard} title={`Hi, ${user?.displayName || 'there'}`} subtitle="Manage your content and hosting."
        actions={<Button variant="primary" onClick={() => setOpen(true)}><Upload size={16} /> Submit content</Button>} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((s) => <Card key={s.label} className="p-5"><div className="flex items-center justify-between"><s.icon size={18} className={s.tone || 'text-[var(--primary-2)]'} /></div>
          <div className="text-3xl font-bold mt-3">{s.value}</div><div className="text-xs text-[var(--muted)] mt-0.5">{s.label}</div></Card>)}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <h2 className="font-semibold mb-3 flex items-center gap-2"><Package size={16} /> My items</h2>
          {items.loading ? <Loading /> : (list.length ? <div className="space-y-2">
            {list.map((it) => { const I = KIND_ICON[it.kind] || Package; return (
              <Card key={it.id} className="p-4 flex items-center gap-3"><I size={18} className="text-[var(--primary-2)]" />
                <div className="flex-1 min-w-0"><div className="font-medium truncate">{it.name}</div><div className="text-xs text-[var(--faint)]">{it.kind} · v{it.version}</div></div>
                <Badge tone={statusTone(it.status)}>{it.status}</Badge></Card>); })}
          </div> : <EmptyState icon={Inbox} title="No items yet" sub="Submit your first app, plugin, theme or preset." />)}
        </div>
        <div>
          <h2 className="font-semibold mb-3 flex items-center gap-2"><Bell size={16} /> Notifications</h2>
          {notes.loading ? <Loading /> : ((notes.data?.notifications || []).length ? <div className="space-y-2">
            {notes.data.notifications.slice(0, 8).map((n) => <Card key={n.id} className="p-3.5 text-sm flex gap-2.5">
              <CheckCircle2 size={15} className="text-[var(--primary-2)] shrink-0 mt-0.5" /><span className="text-[var(--muted)]">{n.body}</span></Card>)}
          </div> : <EmptyState icon={Bell} title="All caught up" />)}
        </div>
      </div>

      <div className="mt-10"><MyRepos /></div>
      <Billing />

      <SubmitModal open={open} onClose={() => setOpen(false)} onDone={() => { items.reload(); toast.success('Submitted — pending moderation.'); }} />
    </div>
  );
}

function SubmitModal({ open, onClose, onDone }) {
  const toast = useToast();
  const [form, setForm] = useState(SUBMIT_INIT);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setForm(SUBMIT_INIT); setFile(null); } }, [open]);

  const onFile = async (f) => {
    setFile(f);
    if (f && form.kind === 'PRESET' && /json$/i.test(f.name)) {
      try { const j = JSON.parse(await f.text()); setForm((s) => ({ ...s, meta: JSON.stringify(j, null, 2), name: j.name || s.name, version: j.version || s.version })); }
      catch { toast.error('Preset is not valid JSON.'); }
    }
  };
  const submit = async () => {
    let meta = {}; try { meta = JSON.parse(form.meta || '{}'); } catch { return toast.error('Meta must be valid JSON.'); }
    setBusy(true);
    try {
      let payloadKey; if (file) payloadKey = await uploadPayload(form.kind, file);
      await api.post('/catalog', { ...form, tags: [], meta, payloadKey });
      onClose(); onDone();
    } catch (x) { toast.error(x.data?.error || x.message || 'Failed.'); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Submit content" icon={Upload} width="max-w-lg"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy} onClick={submit}>{busy ? <Spinner /> : 'Submit for review'}</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Project"><Select value={form.projectKey} onChange={(e) => setForm({ ...form, projectKey: e.target.value })}><option value="bmm">BMM</option><option value="bsm">BSM</option></Select></Field>
        <Field label="Type"><Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>{['APP', 'PLUGIN', 'THEME', 'PRESET'].map((k) => <option key={k}>{k}</option>)}</Select></Field>
        <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="My plugin" /></Field>
        <Field label="Version"><Input value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} /></Field>
      </div>
      <div className="mt-3"><Field label="Description"><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What does it do?" /></Field></div>
      <div className="mt-3"><Field label={form.kind === 'PRESET' ? 'Preset .json file' : 'Payload file (zip / wasm)'} hint="Uploaded directly to storage.">
        <Input type="file" onChange={(e) => onFile(e.target.files?.[0] || null)} /></Field></div>
      <div className="mt-3"><Field label="Metadata (JSON)"><Textarea className="font-mono text-xs" value={form.meta} onChange={(e) => setForm({ ...form, meta: e.target.value })} /></Field></div>
    </Modal>
  );
}

/* ─────────────────────────  Admin  ───────────────────────── */
export function Admin() {
  const { user } = useAuth(); const dialog = useDialog(); const toast = useToast();
  const subs = useAsync(() => api.get('/mod/submissions'), []);
  const approve = async (s) => { try { await api.post(`/mod/submissions/${s.id}/approve`); toast.success(`Approved "${s.item?.name}".`); subs.reload(); } catch { toast.error('Failed.'); } };
  const reject = async (s) => {
    const reason = await dialog.prompt({ title: 'Reject submission', label: 'Reason (sent to the author)', placeholder: 'Why is this rejected?', okLabel: 'Reject', danger: true });
    if (!reason) return;
    try { await api.post(`/mod/submissions/${s.id}/reject`, { reason }); toast.success('Rejected and author notified.'); subs.reload(); } catch { toast.error('Failed.'); }
  };
  return (
    <div>
      <PageHeader icon={ShieldCheck} title="Admin" subtitle="Moderation, settings and analytics." />
      <h2 className="font-semibold mb-3 flex items-center gap-2"><Inbox size={16} /> Moderation queue</h2>
      {subs.loading ? <Loading /> : ((subs.data?.submissions || []).length ? <div className="space-y-2">
        {subs.data.submissions.map((s) => { const I = KIND_ICON[s.item?.kind] || Package; return (
          <Card key={s.id} className="p-4 flex items-center gap-3"><I size={18} className="text-[var(--primary-2)]" />
            <div className="flex-1 min-w-0"><div className="font-medium truncate">{s.item?.name}</div><div className="text-xs text-[var(--faint)]"><Badge>{s.type}</Badge> {s.item?.kind}</div></div>
            <Button size="sm" variant="primary" onClick={() => approve(s)}><CheckCircle2 size={15} /> Approve</Button>
            <Button size="sm" onClick={() => reject(s)}><XCircle size={15} /> Reject</Button></Card>); })}
      </div> : <EmptyState icon={CheckCircle2} title="Queue is empty" sub="Nothing waiting for review." />)}

      <AdminRepos />
      {user?.role === 'ADMIN' && <><AdminAnalytics /><AdminProjects /><AdminSettings /></>}
    </div>
  );
}

const PROJ_META = { community: { icon: Package, name: 'Community' }, bmm: { icon: Boxes, name: 'BMM' }, bsm: { icon: Music2, name: 'BSM' }, installer: { icon: Download, name: 'Installer' } };
function AdminProjects() {
  const toast = useToast();
  const { data, reload } = useAsync(() => api.get('/projects'), []);
  const [active, setActive] = useState('bmm');
  const [text, setText] = useState('');
  const projects = data?.projects || {};
  const keys = ['community', 'bmm', 'bsm', 'installer'];
  useEffect(() => { if (projects[active]) setText(JSON.stringify(projects[active], null, 2)); }, [data, active]);
  let valid = true; try { JSON.parse(text || '{}'); } catch { valid = false; }
  const format = () => { try { setText(JSON.stringify(JSON.parse(text), null, 2)); } catch { toast.error('Invalid JSON.'); } };
  const save = async () => {
    if (!valid) return toast.error('Invalid JSON.');
    try { await api.put(`/projects/${active}`, { config: JSON.parse(text) }); toast.success(`${PROJ_META[active].name} saved.`); reload(); }
    catch (x) { toast.error(x.data?.error || 'Save failed.'); }
  };
  const hint = (label, val) => <div><div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)]">{label}</div><code className="text-[11px] text-[var(--muted)]">{val}</code></div>;
  const taRef = useRef(null); const gutRef = useRef(null);
  const lineCount = (text.match(/\n/g) || []).length + 1;
  const M = PROJ_META[active];
  return (
    <div className="mt-10">
      <h2 className="font-semibold mb-1 flex items-center gap-2"><Settings2 size={16} className="text-[var(--primary-2)]" /> Projects config</h2>
      <p className="text-sm text-[var(--muted)] mb-4">Configure downloads, links, contributors & messages, the progress tracker, legal docs, and the GitHub release-notes source — per project.</p>
      <div className="flex flex-wrap gap-2 mb-4">
        {keys.map((k) => { const Pm = PROJ_META[k]; return (
          <button key={k} onClick={() => setActive(k)}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl border text-sm transition ${active === k ? 'border-[var(--primary)] bg-[var(--surface-2)] text-[var(--text)]' : 'border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]'}`}>
            <Pm.icon size={16} className={active === k ? 'text-[var(--primary-2)]' : ''} /> {Pm.name}
          </button>); })}
      </div>
      <div className="rounded-2xl overflow-hidden border border-[var(--line)]" style={{ boxShadow: 'var(--shadow)' }}>
        <div className="flex items-center justify-between px-4 py-2.5 code-chrome">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-200"><M.icon size={15} className="text-orange-400" /> {M.name}.json</div>
          <div className="flex items-center gap-2">
            <Badge tone={valid ? 'green' : 'red'}>{valid ? 'valid JSON' : 'invalid JSON'}</Badge>
            <Button size="sm" variant="ghost" onClick={format}>Format</Button>
            <Button size="sm" variant="primary" disabled={!valid} onClick={save}>Save</Button>
          </div>
        </div>
        <div className="code-editor flex" style={{ height: 460 }}>
          <pre ref={gutRef} className="code-gutter" aria-hidden="true">{Array.from({ length: lineCount }, (_, i) => i + 1).join('\n')}</pre>
          <textarea ref={taRef} className="code-area" value={text} spellCheck={false}
            onChange={(e) => setText(e.target.value)}
            onScroll={() => { if (gutRef.current && taRef.current) gutRef.current.scrollTop = taRef.current.scrollTop; }} />
        </div>
        <div className="grid sm:grid-cols-3 gap-3 px-4 py-3 code-chrome">
          {hint('releaseNotes', '{ owner, repo, branch, path }')}
          {hint('contributors / messages', '[{ name, role, pfp, links }]')}
          {hint('progress / downloads', '[{ title, status, percent }] · [{ label, url, primary }]')}
        </div>
      </div>
    </div>
  );
}

function AdminAnalytics() {
  const { data } = useAsync(() => api.get('/admin/analytics'), []);
  const max = Math.max(1, ...(data?.top || []).map((t) => t.count));
  return (
    <div className="mt-10">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold flex items-center gap-2"><TrendingUp size={16} /> Site analytics</h2>
        <a href="http://telemetry.localhost" target="_blank" rel="noreferrer"><Button size="sm"><Gauge size={14} /> Open BMM telemetry</Button></a>
      </div>
      <div className="grid sm:grid-cols-3 gap-4 mb-4">
        <Card className="p-5"><Eye size={18} className="text-[var(--primary-2)]" /><div className="text-3xl font-bold mt-3">{data?.total ?? '—'}</div><div className="text-xs text-[var(--muted)]">Total pageviews</div></Card>
        <Card className="p-5"><TrendingUp size={18} className="text-[var(--primary-2)]" /><div className="text-3xl font-bold mt-3">{data?.last30 ?? '—'}</div><div className="text-xs text-[var(--muted)]">Last 30 days</div></Card>
        <Card className="p-5"><Newspaper size={18} className="text-[var(--primary-2)]" /><div className="text-3xl font-bold mt-3">{(data?.top || []).length}</div><div className="text-xs text-[var(--muted)]">Pages tracked</div></Card>
      </div>
      <Card className="p-5">
        <div className="text-xs font-semibold text-[var(--faint)] uppercase mb-3">Top pages (30 days)</div>
        <div className="space-y-2.5">
          {(data?.top || []).map((t) => (
            <div key={t.path} className="flex items-center gap-3 text-sm">
              <span className="text-[var(--muted)] truncate w-40 shrink-0">{t.path}</span>
              <div className="flex-1 h-2 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className="h-full bg-gradient-to-r from-orange-500 to-amber-500" style={{ width: `${(t.count / max) * 100}%` }} /></div>
              <span className="w-10 text-right font-medium">{t.count}</span>
            </div>
          ))}
          {!data?.top?.length && <div className="text-sm text-[var(--faint)]">No data yet — visits will appear once visitors accept analytics cookies.</div>}
        </div>
      </Card>
    </div>
  );
}

function AdminSettings() {
  const toast = useToast();
  const { data, reload } = useAsync(() => api.get('/admin/settings'), []);
  const [draft, setDraft] = useState({});
  useEffect(() => { if (data?.settings) setDraft(data.settings); }, [data]);
  const KEYS = [['hosting.totalCapacityGB', 'Total capacity (GB)'], ['hosting.reservedFreeGB', 'Reserved free margin (GB)'],
    ['pricing.perGBCents', 'Price per GB (¢)'], ['pricing.perUploadMbpsCents', 'Price per Mbps (¢)'],
    ['pricing.perCpuShareCents', 'Price per CPU share (¢)'], ['pricing.featurePerDayCents', 'Feature price / day (¢)'], ['features.hostingEnabled', 'Hosting enabled (true/false)']];
  const coerce = (v) => v === 'true' ? true : v === 'false' ? false : (v !== '' && !isNaN(Number(v)) ? Number(v) : v);
  const save = async (key) => { try { await api.put(`/admin/settings/${key}`, { value: coerce(draft[key]) }); toast.success('Saved.'); reload(); } catch { toast.error('Save failed.'); } };
  return (
    <div className="mt-10"><h2 className="font-semibold mb-3 flex items-center gap-2"><Settings2 size={16} /> Hosting settings</h2>
      <div className="grid md:grid-cols-2 gap-3">{KEYS.map(([k, label]) => (
        <Card key={k} className="p-4 flex items-end gap-3"><div className="flex-1"><Field label={label}><Input value={draft[k] ?? ''} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} /></Field></div>
          <Button size="sm" onClick={() => save(k)}>Save</Button></Card>))}</div>
    </div>
  );
}

/* ─────────────────────────  Legal  ───────────────────────── */
const LEGAL = {
  en: {
    privacy: { icon: Lock, title: 'Privacy Policy', body: [
      ['What we collect', 'An account requires your email and a display name. We store the content you submit (apps, plugins, themes, presets) and basic moderation records. Passwords are hashed with argon2id — never stored in plain text.'],
      ['Analytics', 'With your cookie consent we collect privacy-friendly, first-party page analytics (the page path and referrer). No third-party trackers, no advertising, no cross-site profiling. You can decline at any time.'],
      ['Hosting & payments', 'If you purchase Server-Repo hosting, payment is processed by Stripe; we never see your card details. We store your subscription status and repo metadata.'],
      ['Your rights (GDPR)', 'You can request access to, correction of, or deletion of your personal data at any time by contacting us. Deleting your account removes your personal data and unpublishes your content.'],
      ['Retention', 'We keep data while your account is active and for as long as needed to provide the service or meet legal obligations.'],
    ] },
    terms: { icon: ShieldCheck, title: 'Terms of Service', body: [
      ['Accounts', 'You are responsible for activity under your account and for the content you submit. Keep your credentials safe.'],
      ['Content & moderation', 'Submissions are reviewed before publication. We may reject or remove content that is illegal, malicious, infringing, or violates these terms. You retain ownership of what you upload and grant us a licence to host and distribute it within the platform.'],
      ['Copyright & hosted content rules', 'You may only upload or host content you own or are licensed to distribute. The following are strictly prohibited: copyrighted material without permission, paid/leaked third-party assets, malware or obfuscated payloads, illegal content, and anything infringing a trademark or another creator’s rights. Hosted Server-Repos must respect the original creators’ licences. We comply with takedown requests: rights holders can report infringing content and we will remove it promptly. Repeat infringers are banned and may have their repos and account terminated without refund.'],
      ['Hosting', 'Hosted Server-Repos are subject to the storage, upload and capacity limits we set. Updates require a valid SHA. Abuse, illegal content, or excessive resource use may lead to suspension.'],
      ['Payments', 'Hosting and listing features are billed via Stripe. Prices may change with notice. No refunds for partial periods unless required by law.'],
      ['Disclaimer', 'The service is provided “as is”, without warranties. We are not liable for indirect or consequential damages to the extent permitted by law.'],
    ] },
    cookies: { icon: Cookie, title: 'Cookie Policy', body: [
      ['Essential cookies', 'We use a single essential cookie to keep you signed in (your session). It is required for the site to function and cannot be disabled.'],
      ['Analytics (optional)', 'If you accept, we record privacy-friendly first-party pageviews. This uses no tracking cookie — your choice is simply remembered in your browser’s local storage.'],
      ['Managing consent', 'You chose your preference in the cookie banner. To change it, clear this site’s storage in your browser and reload; the banner will appear again.'],
      ['No third parties', 'We do not load third-party advertising or social tracking cookies.'],
    ] },
  },
  fr: {
    privacy: { icon: Lock, title: 'Politique de confidentialité', body: [
      ['Ce que nous collectons', 'Un compte requiert ton e-mail et un nom affiché. Nous stockons le contenu que tu soumets (apps, plugins, thèmes, presets) et des données de modération. Les mots de passe sont hachés avec argon2id — jamais en clair.'],
      ['Statistiques', 'Avec ton accord cookies, nous collectons des statistiques de pages internes et respectueuses de la vie privée (chemin de page et référent). Aucun pisteur tiers, aucune publicité, aucun profilage. Tu peux refuser à tout moment.'],
      ['Hébergement & paiements', 'Si tu paies un hébergement de Server-Repo, le paiement est traité par Stripe ; nous ne voyons jamais ta carte. Nous stockons l’état de ton abonnement et les métadonnées du dépôt.'],
      ['Tes droits (RGPD)', 'Tu peux demander l’accès, la rectification ou la suppression de tes données à tout moment en nous contactant. Supprimer ton compte efface tes données personnelles et dépublie ton contenu.'],
      ['Conservation', 'Nous conservons les données tant que ton compte est actif et aussi longtemps que nécessaire au service ou à nos obligations légales.'],
    ] },
    terms: { icon: ShieldCheck, title: 'Conditions d’utilisation', body: [
      ['Comptes', 'Tu es responsable de l’activité de ton compte et du contenu que tu soumets. Garde tes identifiants en sécurité.'],
      ['Contenu & modération', 'Les soumissions sont vérifiées avant publication. Nous pouvons refuser ou retirer tout contenu illégal, malveillant, contrefaisant ou contraire aux présentes conditions. Tu restes propriétaire de ce que tu envoies et nous accordes une licence pour l’héberger et le distribuer sur la plateforme.'],
      ['Droits d’auteur & règles de contenu hébergé', 'Tu ne peux héberger ou envoyer que du contenu que tu possèdes ou que tu es autorisé à distribuer. Sont strictement interdits : tout contenu protégé par le droit d’auteur sans autorisation, les assets tiers payants ou leakés, les malwares ou charges obfusquées, les contenus illégaux, et tout ce qui enfreint une marque ou les droits d’un autre créateur. Les Server-Repos hébergés doivent respecter les licences des créateurs originaux. Nous traitons les demandes de retrait : les ayants droit peuvent signaler un contenu contrefaisant, que nous retirerons rapidement. Les récidivistes sont bannis et peuvent voir leurs dépôts et leur compte résiliés sans remboursement.'],
      ['Hébergement', 'Les Server-Repos hébergés sont soumis aux limites de stockage, d’upload et de capacité que nous fixons. Les mises à jour exigent un SHA valide. Tout abus, contenu illégal ou usage excessif peut entraîner une suspension.'],
      ['Paiements', 'L’hébergement et la mise en avant sont facturés via Stripe. Les prix peuvent changer avec préavis. Pas de remboursement des périodes partielles, sauf obligation légale.'],
      ['Avertissement', 'Le service est fourni « tel quel », sans garantie. Nous ne sommes pas responsables des dommages indirects dans les limites permises par la loi.'],
    ] },
    cookies: { icon: Cookie, title: 'Politique de cookies', body: [
      ['Cookies essentiels', 'Nous utilisons un seul cookie essentiel pour te garder connecté (ta session). Il est nécessaire au fonctionnement du site et ne peut pas être désactivé.'],
      ['Statistiques (optionnel)', 'Si tu acceptes, nous enregistrons des vues de pages internes et respectueuses de la vie privée. Aucun cookie de pistage : ton choix est simplement mémorisé dans le stockage local de ton navigateur.'],
      ['Gérer le consentement', 'Tu as choisi ta préférence dans la bannière cookies. Pour la changer, vide le stockage de ce site dans ton navigateur et recharge ; la bannière réapparaîtra.'],
      ['Aucun tiers', 'Nous ne chargeons aucun cookie publicitaire ou de pistage social tiers.'],
    ] },
  },
};

export function Legal({ page }) {
  const { lang, t } = useI18n();
  const d = (LEGAL[lang] || LEGAL.en)[page];
  const tabs = [['privacy', t('foot.privacy')], ['terms', t('foot.terms')], ['cookies', t('foot.cookies')]];
  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader icon={d.icon} title={d.title} subtitle={`${lang === 'fr' ? 'Mis à jour le' : 'Last updated'} ${new Date().toLocaleDateString()}`} />
      <div className="flex gap-2 mb-8">{tabs.map(([k, l]) => <Link key={k} to={`/${k}`}><Button size="sm" variant={k === page ? 'primary' : 'default'}>{l}</Button></Link>)}</div>
      <div className="grid md:grid-cols-[180px_1fr] gap-8">
        <nav className="hidden md:block sticky top-20 self-start space-y-0.5">
          {d.body.map(([h], i) => <a key={h} href={`#s${i}`} className="block text-sm text-[var(--muted)] hover:text-[var(--primary-2)] py-1">{h}</a>)}
        </nav>
        <div className="space-y-8">
          {d.body.map(([h, p], i) => (
            <section id={`s${i}`} key={h} className="scroll-mt-20">
              <h2 className="text-lg font-semibold mb-2 flex items-center gap-2"><span className="text-[var(--primary-2)] font-mono text-sm">{String(i + 1).padStart(2, '0')}</span>{h}</h2>
              <p className="text-[var(--muted)] leading-relaxed">{p}</p>
            </section>
          ))}
          <Card className="p-5 mt-4 text-sm text-[var(--muted)]">Questions about this policy? Reach us via the links in the footer.</Card>
        </div>
      </div>
    </div>
  );
}
