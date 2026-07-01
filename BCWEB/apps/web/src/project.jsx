import { useEffect, useState, useRef } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import {
  Download, Github, MessageCircle, Heart, Globe, BookOpen, Users, ScrollText, ShieldCheck,
  FileText, ListTodo, Boxes, ExternalLink, FolderGit2, ChevronRight, ChevronDown,
  CheckCircle2, Clock, Circle, CalendarDays,
} from 'lucide-react';

// BMM-style badges: [NEW] [FIXED] [IMPROVED]… → styled chips, plus GitHub-style alerts.
const BADGES = {
  NEW: 'new', NOUVEAU: 'new', FIXED: 'fixed', 'FIXÉ': 'fixed', IMPROVED: 'improved', 'AMÉLIORÉ': 'improved',
  REFINE: 'refine', RAFFINEMENT: 'refine', VISUAL: 'visual', VISUEL: 'visual', MAJOR: 'major', MAJEUR: 'major',
};
function preprocessMd(md) {
  let s = md || '';
  s = s.replace(/\[([A-ZÀ-Ÿ]+)\]/g, (m, w) => BADGES[w] ? `<span class="md-badge md-badge-${BADGES[w]}">${w}</span>` : m);
  return s;
}
import { api } from './api.js';
import { useI18n } from './i18n.jsx';
import RrwebPreview from './RrwebPreview.jsx';
import { MessageSquare } from 'lucide-react';
import { Button, Card, Badge, PageHeader, EmptyState, Spinner } from './ui.jsx';

const LINK_META = {
  github: { icon: Github, label: 'GitHub' }, discord: { icon: MessageCircle, label: 'Discord' },
  kofi: { icon: Heart, label: 'Ko-fi' }, reddit: { icon: MessageCircle, label: 'Reddit' },
  forum: { icon: Globe, label: 'Forum' }, website: { icon: Globe, label: 'Website' },
  docs: { icon: BookOpen, label: 'Docs' },
};

function useFetch(fn, deps) {
  const [data, setData] = useState(null); const [loading, setLoading] = useState(true); const [err, setErr] = useState(null);
  useEffect(() => { let on = true; setLoading(true); fn().then((d) => on && setData(d)).catch((e) => on && setErr(e)).finally(() => on && setLoading(false)); return () => { on = false; }; /* eslint-disable-next-line */ }, deps);
  return { data, loading, err };
}

export default function ProjectPage() {
  const { key } = useParams();
  const { t } = useI18n();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') || 'overview';
  const { data, loading, err } = useFetch(() => api.get(`/projects/${key}`), [key]);
  if (loading) return <div className="flex items-center gap-2 text-[var(--muted)] py-10"><Spinner /> {t('common.loading')}</div>;
  if (err) return <EmptyState icon={Boxes} title="Project not found" />;
  const c = data.config;
  const hasCatalog = key === 'bmm' || key === 'bsm';
  const tabs = [
    ['overview', t('proj.overview'), ListTodo],
    c.releaseNotes && ['releases', t('proj.releases'), ScrollText],
    ['community', t('proj.community'), Users],
    ['legal', t('proj.legal'), ShieldCheck],
  ].filter(Boolean);

  return (
    <div>
      {/* header */}
      <div className="flex flex-col md:flex-row md:items-center gap-5 mb-8">
        <div className="grid place-items-center w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-500 to-amber-500 shrink-0"><span className="text-2xl font-extrabold text-white">{c.name?.[0] || 'B'}</span></div>
        <div className="flex-1">
          <h1 className="text-3xl font-extrabold">{c.name}</h1>
          <p className="text-[var(--muted)] mt-1">{c.tagline}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(c.downloads || []).filter((d) => d.url).map((d) => (
            <a key={d.label} href={d.url} download rel="noreferrer"><Button variant={d.primary ? 'primary' : 'default'}><Download size={16} /> {d.label}</Button></a>
          ))}
          {hasCatalog && <Link to={`/catalog?project=${key}`}><Button><Boxes size={16} /> {t('proj.browse')}</Button></Link>}
        </div>
      </div>

      {/* links row */}
      {c.links && Object.values(c.links).some(Boolean) && (
        <div className="flex flex-wrap gap-2 mb-8">
          {Object.entries(c.links).filter(([, v]) => v).map(([k, v]) => { const m = LINK_META[k] || { icon: ExternalLink, label: k }; return (
            <a key={k} href={v} target="_blank" rel="noreferrer"><Button size="sm"><m.icon size={14} className={k === 'kofi' ? 'text-orange-400' : ''} /> {m.label}</Button></a>); })}
        </div>
      )}

      {/* tabs */}
      <div className="flex gap-2 mb-6 border-b border-[var(--line)] overflow-x-auto">
        {tabs.map(([id, label, Icon]) => (
          <button key={id} onClick={() => setSp((p) => { const n = new URLSearchParams(p); n.set('tab', id); return n; })}
            className={`flex items-center gap-1.5 px-3 py-2.5 text-sm border-b-2 -mb-px whitespace-nowrap ${tab === id ? 'border-[var(--primary)] text-[var(--text)]' : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'}`}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview c={c} pkey={key} />}
      {tab === 'releases' && <Releases pkey={key} />}
      {tab === 'community' && <Community c={c} />}
      {tab === 'legal' && <Legal c={c} />}
    </div>
  );
}

// Solid (non-glass) app preview for the project, tilted like a product shot.
// Hover-to-flatten (no scroll coupling → no Firefox scroll-linked warning).
function AppPreview({ pkey, replayUrl }) {
  const ref = useRef(null);
  const [failed, setFailed] = useState(false);
  const useReplay = replayUrl && !failed;
  const onMove = (e) => { if (!ref.current) return; const r = ref.current.getBoundingClientRect(); const dx = (e.clientX - r.left) / r.width - 0.5; ref.current.style.transform = `perspective(1400px) rotateX(8deg) rotateY(${dx * 6}deg)`; };
  const reset = () => { if (ref.current) ref.current.style.transform = 'perspective(1400px) rotateX(10deg)'; };
  const mods = [['F/A-18C Sound Overhaul', 'Sound', true], ['Cockpit Glass HD', 'Cockpit', true], ['VFA-103 Liveries', 'Liveries', false], ['AB Afterburner FX', 'Effects', true], ['Carrier Ops Pack', 'Mission', false]];
  return (
    <div className="mb-8 -mt-2" style={{ perspective: 1400 }} onMouseMove={onMove} onMouseLeave={reset}>
      <div ref={ref} className="rounded-2xl overflow-hidden border border-[var(--line)] mx-auto max-w-3xl transition-transform duration-300"
        style={{ transform: 'perspective(1400px) rotateX(10deg)', transformOrigin: 'center top', background: 'var(--bg-solid)', boxShadow: '0 40px 90px -34px rgba(0,0,0,0.55)' }}>
        <div className="flex items-center gap-2 px-4 py-2.5" style={{ background: '#15171e', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <span className="w-3 h-3 rounded-full bg-red-400/70" /><span className="w-3 h-3 rounded-full bg-amber-400/70" /><span className="w-3 h-3 rounded-full bg-emerald-400/70" />
          <div className="flex-1 mx-3 h-6 rounded-md flex items-center px-3 text-[11px] text-slate-400" style={{ background: '#0d0f15', border: '1px solid rgba(255,255,255,0.06)' }}>{pkey.toUpperCase()} — {useReplay ? 'live session' : pkey === 'bmm' ? 'Mods' : pkey === 'bsm' ? 'Presets' : 'Library'}</div>
        </div>
        {useReplay ? (
          <div style={{ background: '#0d0f15' }}><RrwebPreview url={replayUrl} onFail={() => setFailed(true)} /></div>
        ) : (
        <div className="grid grid-cols-[130px_1fr]" style={{ background: '#0d0f15', color: '#e2e6ee', minHeight: 270 }}>
          <aside className="p-3" style={{ borderRight: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="flex items-center gap-1.5 font-bold text-sm mb-3"><img src="/logo.png" alt="" className="w-5 h-5 rounded" /><span style={{ color: '#f59e0b' }}>{pkey.toUpperCase()}</span></div>
            {['Installed', 'Catalog', 'Plugins', 'Themes', 'Server Repos', 'Settings'].map((s, i) => (
              <div key={s} className="px-2 py-1.5 rounded-lg text-xs mb-0.5" style={i === 0 ? { background: 'rgba(249,115,22,0.15)', color: '#fdba74' } : { color: '#9aa0ac' }}>{s}</div>
            ))}
          </aside>
          <main className="p-4">
            <div className="flex items-center justify-between mb-3"><div className="text-sm font-semibold">Installed mods</div><div className="text-[11px] px-2 py-1 rounded-md" style={{ background: 'rgba(249,115,22,0.15)', color: '#fdba74' }}>+ Add mod</div></div>
            <div className="space-y-2">
              {mods.map(([name, cat, on]) => (
                <div key={name} className="flex items-center gap-3 px-3 py-2 rounded-lg" style={{ background: '#15171e', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div className="w-7 h-7 rounded-md grid place-items-center text-xs font-bold" style={{ background: 'linear-gradient(135deg,#f97316,#f59e0b)', color: '#fff' }}>{name[0]}</div>
                  <div className="flex-1 min-w-0"><div className="text-xs font-medium truncate">{name}</div><div className="text-[10px]" style={{ color: '#6f685d' }}>{cat}</div></div>
                  <div className="w-8 h-4 rounded-full relative" style={{ background: on ? '#f59e0b' : '#2a2d36' }}><div className="w-3 h-3 rounded-full bg-white absolute top-0.5" style={{ left: on ? 18 : 3 }} /></div>
                </div>
              ))}
            </div>
          </main>
        </div>
        )}
      </div>
    </div>
  );
}

const PROG_STATUS = {
  done: { tone: 'green', icon: CheckCircle2, label: 'Done', color: 'text-emerald-400' },
  'in-progress': { tone: 'amber', icon: Clock, label: 'In progress', color: 'text-amber-400' },
  planned: { tone: '', icon: Circle, label: 'Planned', color: 'text-[var(--faint)]' },
};
function ProgressTracker({ items, title }) {
  const overall = Math.round(items.reduce((a, it) => a + (it.status === 'done' ? 100 : (it.percent || 0)), 0) / items.length);
  const counts = { done: items.filter((i) => i.status === 'done').length, prog: items.filter((i) => i.status === 'in-progress').length, plan: items.filter((i) => !i.status || i.status === 'planned').length };
  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold flex items-center gap-2"><ListTodo size={16} className="text-[var(--primary-2)]" /> {title}</h2>
        <span className="text-sm text-[var(--muted)]"><b className="text-[var(--text)]">{overall}%</b> overall · {counts.done} done · {counts.prog} active · {counts.plan} planned</span>
      </div>
      <div className="h-2.5 rounded-full bg-[var(--surface-2)] overflow-hidden mb-5"><div className="h-full bg-gradient-to-r from-orange-500 to-amber-400 transition-all" style={{ width: `${overall}%` }} /></div>
      <div className="space-y-3">
        {items.map((it, i) => {
          const m = PROG_STATUS[it.status] || PROG_STATUS.planned;
          const pct = it.status === 'done' ? 100 : (it.percent || 0);
          return (
            <Card key={i} className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <m.icon size={16} className={m.color} />
                <div className="font-medium flex-1">{it.title}</div>
                {it.eta && <span className="text-xs text-[var(--faint)] flex items-center gap-1"><CalendarDays size={12} /> {it.eta}</span>}
                <Badge tone={m.tone}>{m.label}</Badge>
              </div>
              <div className="flex items-center gap-2"><div className="flex-1 h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className="h-full bg-gradient-to-r from-orange-500 to-amber-500" style={{ width: `${pct}%` }} /></div><span className="text-xs text-[var(--muted)] w-9 text-right">{pct}%</span></div>
              {it.note && <div className="text-sm text-[var(--muted)] mt-2">{it.note}</div>}
              {it.items?.length > 0 && (
                <div className="mt-3 grid sm:grid-cols-2 gap-x-5 gap-y-1.5">
                  {it.items.map((s, k) => { const done = s.done ?? false; const label = s.label ?? s; return (
                    <div key={k} className="flex items-center gap-1.5 text-sm">
                      {done ? <CheckCircle2 size={14} className="text-emerald-400 shrink-0" /> : <Circle size={14} className="text-[var(--faint)] shrink-0" />}
                      <span className={done ? 'text-[var(--faint)] line-through' : 'text-[var(--muted)]'}>{label}</span>
                    </div>); })}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </section>
  );
}

function Overview({ c, pkey }) {
  const { t } = useI18n();
  return (
    <div className="space-y-8">
      {c.replayUrl && <AppPreview pkey={pkey} replayUrl={c.replayUrl} />}
      {c.progress?.length > 0 ? <ProgressTracker items={c.progress} title={t('proj.progress')} /> : <EmptyState icon={ListTodo} title={t('proj.noprogress')} sub="The progress tracker will appear here once configured." />}
    </div>
  );
}

function Releases({ pkey }) {
  const { t } = useI18n();
  const { data, loading, err } = useFetch(() => api.get(`/projects/${pkey}/releases`), [pkey]);
  const [active, setActive] = useState(null);
  const [md, setMd] = useState(''); const [mdLoading, setMdLoading] = useState(false);
  const [closed, setClosed] = useState({}); // collapsed folders
  useEffect(() => { const first = data?.files?.[0]; if (first && !active) setActive(first); }, [data]); // eslint-disable-line
  useEffect(() => {
    if (!active) return; setMdLoading(true);
    fetch(active.rawUrl).then((r) => r.text()).then(setMd).catch(() => setMd('*Failed to load.*')).finally(() => setMdLoading(false));
  }, [active]);

  if (loading) return <div className="flex items-center gap-2 text-[var(--muted)] py-8"><Spinner /> {t('common.loading')}</div>;
  if (err || !data?.files?.length) return <EmptyState icon={ScrollText} title={t('proj.releases')} sub="Configure a GitHub source in the admin dashboard." />;

  const groups = {};
  for (const f of data.files) { (groups[f.dir || 'Latest'] ||= []).push(f); }
  const toggle = (dir) => setClosed((s) => ({ ...s, [dir]: !s[dir] }));
  return (
    <div className="grid md:grid-cols-[260px_1fr] gap-6">
      <nav className="space-y-2 md:max-h-[72vh] md:overflow-auto md:pr-2">
        {Object.entries(groups).map(([dir, files]) => (
          <div key={dir} className="card p-1.5">
            <button onClick={() => toggle(dir)} className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs font-semibold text-[var(--faint)] uppercase tracking-wider hover:text-[var(--text)]">
              {closed[dir] ? <ChevronRight size={13} /> : <ChevronDown size={13} />} <FolderGit2 size={12} /> {dir} <span className="ml-auto text-[var(--faint)] normal-case font-normal">{files.length}</span>
            </button>
            {!closed[dir] && files.map((f) => (
              <button key={f.path} onClick={() => setActive(f)}
                className={`w-full text-left px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5 ${active?.path === f.path ? 'bg-[var(--surface-2)] text-[var(--text)]' : 'text-[var(--muted)] hover:bg-[var(--surface-2)]'}`}>
                <FileText size={14} /> <span className="truncate">{f.name}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>
      <Card className="p-6 min-w-0">
        {mdLoading ? <div className="flex items-center gap-2 text-[var(--muted)]"><Spinner /> {t('common.loading')}</div>
          : <div className="md-body"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>{preprocessMd(md)}</ReactMarkdown></div>}
      </Card>
    </div>
  );
}

function MessageTicker({ messages }) {
  const { t } = useI18n();
  const [i, setI] = useState(0);
  useEffect(() => { if (messages.length < 2) return; const id = setInterval(() => setI((x) => (x + 1) % messages.length), 4500); return () => clearInterval(id); }, [messages.length]);
  if (!messages.length) return null;
  return (
    <section>
      <h2 className="font-semibold mb-3 flex items-center gap-2"><MessageSquare size={16} className="text-[var(--primary-2)]" /> {t('proj.messages')}</h2>
      <Card className="p-8 text-center relative overflow-hidden bg-gradient-to-br from-orange-500/10 to-transparent min-h-[120px] grid place-items-center">
        <p key={i} className="anim-fade text-lg md:text-xl text-[var(--text)] max-w-2xl mx-auto leading-relaxed">“{messages[i].message}”</p>
        {messages.length > 1 && <div className="flex gap-1.5 justify-center mt-5">{messages.map((_, k) => <span key={k} className={`w-1.5 h-1.5 rounded-full ${k === i ? 'bg-[var(--primary)]' : 'bg-[var(--line-strong)]'}`} />)}</div>}
      </Card>
    </section>
  );
}

function Community({ c }) {
  const { t } = useI18n();
  const [people, setPeople] = useState(c.contributors || []);
  const messages = c.messages || [];
  useEffect(() => {
    if (!c.contributorsUrl) { setPeople(c.contributors || []); return; }
    let on = true;
    fetch(c.contributorsUrl).then((r) => r.json()).then((d) => {
      if (!on) return;
      const base = c.pfpBase || '';
      setPeople((d.contributors || []).map((p) => ({
        name: p.username || p.name, role: p.role, description: p.description,
        category: p.subcategory || p.category || 'contributors',
        pfp: p.pfp ? (/^https?:/.test(p.pfp) ? p.pfp : base + p.pfp.split('/').pop()) : '',
        links: { github: p.github, website: p.website },
      })));
    }).catch(() => {});
    return () => { on = false; };
  }, [c.contributorsUrl]);
  const cats = {};
  for (const p of people) { (cats[p.category || 'contributors'] ||= []).push(p); }
  if (!people.length && !messages.length) return <EmptyState icon={Users} title={t('proj.nocontrib')} sub="Configure contributorsUrl & messages in the admin dashboard." />;
  return (
    <div className="space-y-10">
      <MessageTicker messages={messages} />
      {Object.entries(cats).map(([cat, list]) => (
        <section key={cat}>
          <h2 className="font-semibold mb-3 capitalize flex items-center gap-2"><Users size={16} className="text-[var(--primary-2)]" /> {cat}</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {list.map((p, i) => (
              <Card key={i} className="p-5">
                <div className="flex items-center gap-3">
                  {p.pfp ? <img src={p.pfp} alt="" loading="lazy" className="w-12 h-12 rounded-full object-cover border border-[var(--line)]" />
                    : <div className="w-12 h-12 rounded-full bg-gradient-to-br from-orange-500 to-amber-500 grid place-items-center text-white font-bold">{(p.name || '?')[0]}</div>}
                  <div className="min-w-0"><div className="font-semibold truncate">{p.name}</div><div className="text-xs text-[var(--primary-2)]">{p.role}</div></div>
                </div>
                {p.description && <p className="text-sm text-[var(--muted)] mt-3 line-clamp-3">{p.description}</p>}
                {p.links && <div className="flex gap-2 mt-3">{Object.entries(p.links).filter(([, v]) => v).map(([k, v]) => { const m = LINK_META[k] || { icon: ExternalLink }; return <a key={k} href={v} target="_blank" rel="noreferrer" className="text-[var(--muted)] hover:text-[var(--primary-2)]"><m.icon size={16} /></a>; })}</div>}
              </Card>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Legal({ c }) {
  const { lang } = useI18n();
  const l = c.legal || {};
  const pick = (en, fr) => (lang === 'fr' && fr) ? fr : en;
  const docs = [
    l.licenseUrl && { icon: ScrollText, title: l.license || 'License', sub: 'Open-source license', url: l.licenseUrl },
    (l.tos || l.tosFr) && { icon: ShieldCheck, title: 'Terms of Use', sub: 'How you may use the app', url: pick(l.tos, l.tosFr) },
    (l.privacy || l.privacyFr) && { icon: FileText, title: 'Privacy Policy', sub: 'How your data is handled', url: pick(l.privacy, l.privacyFr) },
    l.readme && { icon: BookOpen, title: 'README', sub: 'Project documentation', url: l.readme },
  ].filter(Boolean);
  if (!docs.length) return <EmptyState icon={ShieldCheck} title="No legal documents" sub="License / ToS / Privacy / README are set in the admin dashboard." />;
  return (
    <div className="max-w-2xl">
      {l.license && <Card className="p-5 mb-4 flex items-center gap-3 bg-gradient-to-r from-orange-500/10 to-transparent">
        <ShieldCheck size={20} className="text-[var(--primary-2)]" />
        <div className="flex-1"><div className="font-semibold">Licensed under {l.license}</div><div className="text-xs text-[var(--muted)]">This project is open source.</div></div>
      </Card>}
      <div className="grid sm:grid-cols-2 gap-3">
        {docs.map((d) => (
          <a key={d.title} href={d.url} target="_blank" rel="noreferrer">
            <Card hover className="p-4 flex items-center gap-3 h-full"><d.icon size={18} className="text-[var(--primary-2)]" />
              <div className="flex-1 min-w-0"><div className="font-medium">{d.title}</div><div className="text-xs text-[var(--muted)]">{d.sub}</div></div>
              <ExternalLink size={15} className="text-[var(--faint)]" /></Card>
          </a>
        ))}
      </div>
    </div>
  );
}
