import { useEffect, useState, useRef } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import {
  Download, Github, MessageCircle, Heart, Globe, BookOpen, Users, ScrollText, ShieldCheck,
  FileText, ListTodo, Boxes, ExternalLink, FolderGit2, ChevronRight, ChevronDown,
  CheckCircle2, Clock, Circle, CalendarDays, Rocket, Wrench, Sparkles, FlaskConical, Newspaper,
} from 'lucide-react';
import Markdown, { matchesLang } from './md.jsx';
import { api } from './api.js';
import { useI18n } from './i18n.jsx';
import RrwebPreview from './RrwebPreview.jsx';
import { GithubIcon, KofiIcon, DiscordIcon, RedditIcon, AppLogo, APP_LOGO } from './brand.jsx';
import { MessageSquare } from 'lucide-react';
import { Button, Card, Badge, PageHeader, EmptyState, Spinner, Modal } from './ui.jsx';

// Pick an icon that suits the release note from its filename.
function noteIcon(name = '') {
  const n = name.toLowerCase();
  if (/hotfix|patch|fix|bug/.test(n)) return Wrench;
  if (/secur|vuln|cve/.test(n)) return ShieldCheck;
  if (/beta|ptb|rc\b|preview|test|nightly/.test(n)) return FlaskConical;
  if (/feature|new|added|highlight/.test(n)) return Sparkles;
  if (/release|stable|update|changelog|v?\d+\.\d+/.test(n)) return Rocket;
  return FileText;
}

const LINK_META = {
  github: { icon: GithubIcon, label: 'GitHub' }, discord: { icon: DiscordIcon, label: 'Discord' },
  kofi: { icon: KofiIcon, label: 'Ko-fi' }, reddit: { icon: RedditIcon, label: 'Reddit' },
  forum: { icon: Globe, label: 'Forum' }, website: { icon: Globe, label: 'Website' },
  docs: { icon: BookOpen, label: 'Docs' }, source: { icon: GithubIcon, label: 'Source code' },
};
// Order of the generic link buttons on a showcase project page.
const LINK_ORDER = ['github', 'source', 'discord', 'kofi', 'reddit', 'website', 'docs'];
const LEGAL_ICONS = { shield: ShieldCheck, lock: ScrollText, book: BookOpen, file: FileText, scroll: ScrollText, globe: Globe, docs: BookOpen };

// A framed, tilt-on-hover media slot for the overview: image, video, or an rrweb replay.
function MediaFrame({ media, pkey }) {
  const ref = useRef(null);
  const replay = media?.replayUrl || media?.rrwebUrl;
  if (replay) return <AppPreview pkey={pkey || 'app'} replayUrl={replay} />;
  if (!media?.image && !media?.video) return null;
  const move = (e) => { if (!ref.current) return; const r = ref.current.getBoundingClientRect(); const dx = (e.clientX - r.left) / r.width - 0.5; const dy = (e.clientY - r.top) / r.height - 0.5; ref.current.style.transform = `perspective(1200px) rotateY(${dx * 10}deg) rotateX(${-dy * 8}deg) scale(1.01)`; };
  const rest = () => { if (ref.current) ref.current.style.transform = 'perspective(1200px) rotateY(0) rotateX(0) scale(1)'; };
  return (
    <div className="mb-8" style={{ perspective: 1200 }} onMouseMove={move} onMouseLeave={rest}>
      <div ref={ref} className="mx-auto max-w-3xl rounded-2xl overflow-hidden border border-[var(--line-strong)] transition-transform duration-100 ease-out will-change-transform" style={{ background: '#0a0b0f', boxShadow: '0 34px 80px -32px rgba(0,0,0,0.55)' }}>
        {media.video ? <video src={media.video} controls className="w-full block" /> : <img src={media.image} alt="" className="w-full block" />}
      </div>
    </div>
  );
}

function useFetch(fn, deps) {
  const [data, setData] = useState(null); const [loading, setLoading] = useState(true); const [err, setErr] = useState(null);
  const [gen, setGen] = useState(0);
  useEffect(() => { let on = true; setLoading(true); fn().then((d) => on && setData(d)).catch((e) => on && setErr(e)).finally(() => on && setLoading(false)); return () => { on = false; }; /* eslint-disable-next-line */ }, [...deps, gen]);
  return { data, loading, err, refetch: () => setGen((g) => g + 1) };
}

// Download button(s) for a project header. One entry = a plain button. Several
// entries (installer + portable + source code…) = the primary option as the
// main button plus a chevron dropdown listing every choice with its label —
// instead of a cluttered row of look-alike buttons.
function DownloadMenu({ downloads = [], children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc); return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  const list = downloads.filter((d) => d.url);
  if (!list.length) return children || null;
  const primary = list.find((d) => d.primary) || list[0];
  if (list.length === 1) {
    return (<>
      <a href={primary.url} download rel="noreferrer"><Button variant="primary"><Download size={16} /> {primary.label}</Button></a>
      {children}
    </>);
  }
  return (
    <div className="relative flex" ref={ref}>
      <a href={primary.url} download rel="noreferrer"><Button variant="primary" className="!rounded-r-none"><Download size={16} /> {primary.label}</Button></a>
      <Button variant="primary" className="!rounded-l-none !px-2 border-l border-white/25" aria-label="More download options" onClick={() => setOpen((v) => !v)}><ChevronDown size={15} className={`transition-transform ${open ? 'rotate-180' : ''}`} /></Button>
      {children}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-64 rounded-xl border border-[var(--line-strong)] py-1 z-[60] anim-fade overflow-hidden"
          style={{ background: 'var(--bg-solid)', boxShadow: '0 18px 50px -12px rgba(0,0,0,0.5)' }}>
          {list.map((d) => (
            <a key={`${d.label}:${d.url}`} href={d.url} download rel="noreferrer" onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-[var(--text)] hover:bg-[var(--surface-2)] transition">
              {/^source|code|src/i.test(d.label) ? <FolderGit2 size={15} className="text-[var(--primary-2)] shrink-0" /> : <Download size={15} className="text-[var(--primary-2)] shrink-0" />}
              <span className="min-w-0 flex-1 truncate">{d.label}</span>
              {d.primary && <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)]">default</span>}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function useCountdown(target) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  const total = Math.max(0, new Date(target).getTime() - now);
  const s = Math.floor(total / 1000);
  return { days: Math.floor(s / 86400), hours: Math.floor((s % 86400) / 3600), minutes: Math.floor((s % 3600) / 60), seconds: s % 60, done: total <= 0 };
}

// A "coming soon" teaser served instead of the real page while a project
// announcement's countdown is still running (see GET /showcase/:slug in the
// API — this is what it returns when isAnnouncing(row) is true).
function AnnouncementTeaser({ announcement, onReveal }) {
  const cd = useCountdown(announcement.revealAt);
  useEffect(() => { if (cd.done) onReveal?.(); }, [cd.done]); // eslint-disable-line react-hooks/exhaustive-deps
  const unit = (v, label) => (
    <div className="flex flex-col items-center">
      <div className="text-3xl md:text-4xl font-extrabold tabular-nums bg-[var(--surface-2)] border border-[var(--line)] rounded-xl px-4 py-3 min-w-[4.5rem] text-center">{String(v).padStart(2, '0')}</div>
      <div className="text-[11px] text-[var(--faint)] uppercase tracking-wider mt-1.5">{label}</div>
    </div>
  );
  return (
    <div className="max-w-2xl mx-auto text-center py-10">
      {announcement.logo && <img src={announcement.logo} alt="" className="w-20 h-20 rounded-2xl object-cover mx-auto mb-5 shadow-lg" />}
      <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--primary-2)] mb-2"><Sparkles size={13} /> Coming soon</div>
      <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-4">{announcement.title || 'Something big is coming'}</h1>
      {!cd.done ? (
        <div className="flex items-center justify-center gap-2 md:gap-4 my-8">
          {unit(cd.days, 'days')}<div className="text-2xl text-[var(--faint)] pb-6">:</div>
          {unit(cd.hours, 'hours')}<div className="text-2xl text-[var(--faint)] pb-6">:</div>
          {unit(cd.minutes, 'min')}<div className="text-2xl text-[var(--faint)] pb-6">:</div>
          {unit(cd.seconds, 'sec')}
        </div>
      ) : <div className="my-8 text-[var(--muted)]">Revealing…</div>}
      {announcement.markdown && <div className="text-left"><Markdown>{announcement.markdown}</Markdown></div>}
    </div>
  );
}

export default function ProjectPage() {
  const { key } = useParams();
  const { t } = useI18n();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') || 'overview';
  const { data, loading, err } = useFetch(() => api.get(`/projects/${key}`), [key]);
  if (loading) return <div className="flex items-center gap-2 text-[var(--muted)] py-10"><Spinner /> {t('common.loading')}</div>;
  if (err?.status === 403) return <EmptyState icon={ShieldCheck} title="Not available" sub="You don't have access to this page." />;
  if (err) return <EmptyState icon={Boxes} title="Project not found" />;
  const c = data.config;
  const hasCatalog = key === 'bmm' || key === 'bsm';
  const tabs = [
    ['overview', t('proj.overview'), ListTodo],
    c.releaseNotes && ['releases', t('proj.releases'), ScrollText],
    ['community', t('proj.community'), Users],
    data.showBlogTab && ['blog', t('proj.blog'), Newspaper],
    ['legal', t('proj.legal'), ShieldCheck],
  ].filter(Boolean);

  return (
    <div>
      {/* header */}
      <div className="flex flex-col md:flex-row md:items-center gap-5 mb-8">
        {APP_LOGO[key]
          ? <img src={APP_LOGO[key]} alt="" className="w-16 h-16 rounded-2xl object-contain shrink-0 bg-[var(--surface-2)] border border-[var(--line)] p-1.5" />
          : <div className="grid place-items-center w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-500 to-amber-500 shrink-0"><span className="text-2xl font-extrabold text-white">{c.name?.[0] || 'B'}</span></div>}
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap"><h1 className="text-3xl font-extrabold">{c.name}</h1>{c.version && <Badge tone="primary">v{c.version}</Badge>}</div>
          <p className="text-[var(--muted)] mt-1">{c.tagline}</p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <DownloadMenu downloads={c.downloads} />
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
      <div className="flex gap-2 mb-6 border-b border-[var(--line)] overflow-x-auto no-scrollbar">
        {tabs.map(([id, label, Icon]) => (
          <button key={id} onClick={() => setSp((p) => { const n = new URLSearchParams(p); n.set('tab', id); return n; })}
            className={`flex items-center gap-1.5 px-3 py-2.5 text-sm border-b-2 -mb-px whitespace-nowrap ${tab === id ? 'border-[var(--primary)] text-[var(--text)]' : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'}`}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview c={c} pkey={key} />}
      {tab === 'releases' && <Releases pkey={key} />}
      {tab === 'community' && <Community c={c} communityUrl={c.contributorsUrl ? `/projects/${key}/community` : null} />}
      {tab === 'blog' && <ProjectBlogTab project={key} />}
      {tab === 'legal' && <Legal c={c} />}
    </div>
  );
}

// BMM live-session preview. The recording already contains the app window, so we
// show it FRAMELESS (no chrome, no background) — it just floats.
function AppPreview({ pkey, replayUrl }) {
  const ref = useRef(null);
  const [failed, setFailed] = useState(false);
  const useReplay = replayUrl && !failed;
  const mods = [['F/A-18C Sound Overhaul', 'Sound', true], ['Cockpit Glass HD', 'Cockpit', true], ['VFA-103 Liveries', 'Liveries', false], ['AB Afterburner FX', 'Effects', true], ['Carrier Ops Pack', 'Mission', false]];
  if (useReplay) {
    const move = (e) => { if (!ref.current) return; const r = ref.current.getBoundingClientRect(); const dx = (e.clientX - r.left) / r.width - 0.5; const dy = (e.clientY - r.top) / r.height - 0.5; ref.current.style.transform = `perspective(1200px) rotateY(${dx * 18}deg) rotateX(${-dy * 15}deg) scale(1.02)`; };
    const rest = () => { if (ref.current) ref.current.style.transform = 'perspective(1200px) rotateY(0deg) rotateX(0deg) scale(1)'; };
    return (
      <div className="mb-8" style={{ perspective: 1200 }} onMouseMove={move} onMouseLeave={rest}>
        {/* simple framed window (no monitor bezel/stand) */}
        <div ref={ref} className="mx-auto max-w-3xl rounded-2xl overflow-hidden border border-[var(--line-strong)] transition-transform duration-100 ease-out will-change-transform"
          style={{ transformOrigin: 'center', background: '#0a0b0f', boxShadow: '0 34px 80px -32px rgba(0,0,0,0.55)' }}>
          <RrwebPreview url={replayUrl} onFail={() => setFailed(true)} />
        </div>
      </div>
    );
  }
  const onMove = (e) => { if (!ref.current) return; const r = ref.current.getBoundingClientRect(); const dx = (e.clientX - r.left) / r.width - 0.5; ref.current.style.transform = `perspective(1400px) rotateX(8deg) rotateY(${dx * 6}deg)`; };
  const reset = () => { if (ref.current) ref.current.style.transform = 'perspective(1400px) rotateX(10deg)'; };
  return (
    <div className="mb-8 -mt-2" style={{ perspective: 1400 }} onMouseMove={onMove} onMouseLeave={reset}>
      <div ref={ref} className="rounded-2xl overflow-hidden border border-[var(--line)] mx-auto max-w-3xl transition-transform duration-300"
        style={{ transform: 'perspective(1400px) rotateX(10deg)', transformOrigin: 'center top', background: 'var(--bg-solid)', boxShadow: '0 40px 90px -34px rgba(0,0,0,0.55)' }}>
        <div className="flex items-center gap-2 px-4 py-2.5" style={{ background: '#15171e', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <span className="w-3 h-3 rounded-full bg-red-400/70" /><span className="w-3 h-3 rounded-full bg-amber-400/70" /><span className="w-3 h-3 rounded-full bg-emerald-400/70" />
          <div className="flex-1 mx-3 h-6 rounded-md flex items-center px-3 text-[11px] text-slate-400" style={{ background: '#0d0f15', border: '1px solid rgba(255,255,255,0.06)' }}>{pkey.toUpperCase()} — {pkey === 'bmm' ? 'Mods' : pkey === 'bsm' ? 'Presets' : 'Library'}</div>
        </div>
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
      </div>
    </div>
  );
}

const PROG_STATUS = {
  done: { tone: 'green', icon: CheckCircle2, label: 'Done', color: 'text-emerald-400' },
  'in-progress': { tone: 'amber', icon: Clock, label: 'In progress', color: 'text-amber-400' },
  progress: { tone: 'amber', icon: Clock, label: 'In progress', color: 'text-amber-400' },
  planned: { tone: '', icon: Circle, label: 'Planned', color: 'text-[var(--faint)]' },
};
// Bilingual value picker: { en, fr } → the active language (fallback en); plain → as-is.
const pickLang = (v, lang) => (v && typeof v === 'object' && !Array.isArray(v)) ? (v[lang] ?? v.en ?? Object.values(v)[0]) : v;

function Meter({ label, pct }) {
  return (
    <div className="flex-1 min-w-[140px]">
      <div className="flex items-center justify-between mb-1 text-sm"><span className="text-[var(--muted)]">{label}</span><b>{pct}%</b></div>
      <div className="h-2.5 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className="h-full bg-gradient-to-r from-orange-500 to-amber-400 transition-all" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></div>
    </div>
  );
}
function ProgressItem({ it, lang }) {
  const m = PROG_STATUS[it.status] || PROG_STATUS.planned;
  const pct = it.status === 'done' ? 100 : (it.percent || 0);
  return (
    <div className="flex items-center gap-3 py-2">
      <m.icon size={15} className={`${m.color} shrink-0`} />
      <div className="flex-1 min-w-0 text-sm truncate">{pickLang(it.label ?? it.title, lang)}</div>
      {it.eta && <span className="text-xs text-[var(--faint)] hidden sm:flex items-center gap-1"><CalendarDays size={11} /> {it.eta}</span>}
      <div className="w-24 sm:w-32 h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className="h-full bg-gradient-to-r from-orange-500 to-amber-500" style={{ width: `${pct}%` }} /></div>
      <span className="text-xs text-[var(--muted)] w-9 text-right tabular-nums">{pct}%</span>
    </div>
  );
}
// Renders the rich bilingual progress.json ({ lastUpdate, art, code, categories:
// [{ name, items:[{ label, status, percent }] }] }) and the legacy flat array.
function ProgressTracker({ data, title, lang }) {
  const legacy = Array.isArray(data?.legacy) ? data.legacy : (Array.isArray(data) ? data : null);
  const cats = legacy
    ? [{ name: title, items: legacy.map((it) => ({ label: it.title, status: it.status === 'in-progress' ? 'progress' : it.status, percent: it.percent, eta: it.eta })) }]
    : (data?.categories || []);
  const all = cats.flatMap((c) => c.items || []);
  const avg = (its) => its.length ? Math.round(its.reduce((a, it) => a + (it.status === 'done' ? 100 : (it.percent || 0)), 0) / its.length) : 0;
  const overall = avg(all);
  const counts = {
    done: all.filter((i) => i.status === 'done').length,
    prog: all.filter((i) => i.status === 'progress' || i.status === 'in-progress').length,
    plan: all.filter((i) => !i.status || i.status === 'planned').length,
  };
  return (
    <section>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="font-semibold flex items-center gap-2"><ListTodo size={16} className="text-[var(--primary-2)]" /> {title}</h2>
        <span className="text-sm text-[var(--muted)]"><b className="text-[var(--text)]">{overall}%</b> overall · {counts.done} done · {counts.prog} active · {counts.plan} planned</span>
      </div>
      {(data?.art != null || data?.code != null || data?.lastUpdate) && (
        <Card className="p-4 mb-5">
          <div className="flex flex-col sm:flex-row gap-4">
            {data?.code != null && <Meter label="Code" pct={data.code} />}
            {data?.art != null && <Meter label={lang === 'fr' ? 'Art / Visuel' : 'Art / Visual'} pct={data.art} />}
          </div>
          {data?.lastUpdate && <div className="text-xs text-[var(--faint)] mt-3 flex items-center gap-1.5"><CalendarDays size={12} /> {lang === 'fr' ? 'Dernière mise à jour' : 'Last update'} · {pickLang(data.lastUpdate, lang)}</div>}
        </Card>
      )}
      <div className="space-y-4">
        {cats.map((c, i) => (
          <Card key={i} className="p-4">
            <div className="flex items-center justify-between mb-1.5">
              <div className="font-medium">{pickLang(c.name, lang)}</div>
              <span className="text-xs text-[var(--muted)] tabular-nums">{avg(c.items || [])}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden mb-1"><div className="h-full bg-gradient-to-r from-orange-500 to-amber-400" style={{ width: `${avg(c.items || [])}%` }} /></div>
            <div className="divide-y divide-[var(--line)]">
              {(c.items || []).map((it, k) => <ProgressItem key={k} it={it} lang={lang} />)}
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}

function Overview({ c, pkey, progressUrl }) {
  const { t, lang } = useI18n();
  // Progress comes from a dedicated endpoint (remote source or inline config).
  const url = progressUrl || `/projects/${pkey}/progress`;
  const { data, loading } = useFetch(() => api.get(url).catch(() => null), [url]);
  const prog = data?.progress;
  return (
    <div className="space-y-8">
      {c.media && <MediaFrame media={c.media} pkey={pkey} />}
      {!c.media && c.replayUrl && <AppPreview pkey={pkey} replayUrl={c.replayUrl} />}
      {loading ? <div className="flex items-center gap-2 text-[var(--muted)] py-6"><Spinner /> {t('common.loading')}</div>
        : prog ? <ProgressTracker data={prog} title={t('proj.progress')} lang={lang} />
        : <EmptyState icon={ListTodo} title={t('proj.noprogress')} sub="The progress tracker will appear here once configured." />}
    </div>
  );
}

function Releases({ pkey, releasesUrl }) {
  const { t, lang } = useI18n();
  const url = releasesUrl || `/projects/${pkey}/releases`;
  const { data, loading, err } = useFetch(() => api.get(url), [url]);
  const [active, setActive] = useState(null); // the note open in the reader
  const [md, setMd] = useState(''); const [mdLoading, setMdLoading] = useState(false);
  const [closed, setClosed] = useState({}); // per-folder collapse overrides

  // Keep only notes for the active language (*_EN / *_FR + neutral).
  const allFiles = data?.files || [];
  let files = allFiles.filter((f) => matchesLang(f.name, lang));
  if (!files.length) files = allFiles;

  // Load the selected note's markdown into the reader modal.
  useEffect(() => {
    if (!active) { setMd(''); return; }
    setMdLoading(true); setMd('');
    fetch(active.rawUrl).then((r) => r.text()).then(setMd).catch(() => setMd('*Failed to load.*')).finally(() => setMdLoading(false));
  }, [active]);

  if (loading) return <div className="flex items-center gap-2 text-[var(--muted)] py-8"><Spinner /> {t('common.loading')}</div>;
  if (err || !allFiles.length) return <EmptyState icon={ScrollText} title={t('proj.releases')} sub="Configure a GitHub source in the admin dashboard." />;

  const groups = {};
  for (const f of files) (groups[f.dir || 'Latest'] ||= []).push(f);
  const dirs = Object.keys(groups);
  // Collapsed by default when there are several folders; a lone folder stays open.
  const defClosed = dirs.length > 1;
  const isClosed = (dir) => (dir in closed ? closed[dir] : defClosed);
  const toggle = (dir) => setClosed((s) => ({ ...s, [dir]: !isClosed(dir) }));

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold flex items-center gap-2"><ScrollText size={16} className="text-[var(--primary-2)]" /> {t('proj.releases')}</h2>
        <span className="text-xs text-[var(--muted)]">{files.length} {lang === 'fr' ? 'note(s)' : 'note(s)'}</span>
      </div>

      <div className="space-y-3">
        {dirs.map((dir) => {
          const gclosed = isClosed(dir);
          return (
            <Card key={dir} className="p-0 overflow-hidden">
              <button onClick={() => toggle(dir)} className="w-full flex items-center gap-2 px-4 py-3 hover:bg-[var(--surface-2)] transition text-left">
                <FolderGit2 size={14} className="text-[var(--primary-2)] shrink-0" />
                <span className="font-medium text-sm truncate">{dir}</span>
                <Badge>{groups[dir].length}</Badge>
                <ChevronDown size={16} className={`ml-auto shrink-0 text-[var(--faint)] transition-transform ${gclosed ? '-rotate-90' : ''}`} />
              </button>
              {!gclosed && (
                <div className="border-t border-[var(--line)] divide-y divide-[var(--line)]">
                  {groups[dir].map((f) => { const I = noteIcon(f.name); return (
                    <button key={f.path} onClick={() => setActive(f)} className="group w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[var(--surface-2)] transition">
                      <span className="grid place-items-center w-9 h-9 rounded-lg bg-[var(--surface-2)] group-hover:bg-[var(--bg-solid)] transition shrink-0"><I size={16} className="text-[var(--primary-2)]" /></span>
                      <span className="flex-1 min-w-0 text-sm font-medium truncate">{f.name}</span>
                      <span className="text-xs text-[var(--muted)] flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition">{lang === 'fr' ? 'Lire' : 'Read'} <ChevronRight size={13} /></span>
                    </button>
                  ); })}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/* Reader — a modal on every breakpoint, with a clear close affordance. */}
      {active && (
        <Modal open onClose={() => setActive(null)} title={active.name} icon={noteIcon(active.name)} width="max-w-3xl"
          footer={<Button variant="ghost" onClick={() => setActive(null)}>{lang === 'fr' ? 'Fermer' : 'Close'}</Button>}>
          {mdLoading ? <div className="flex items-center gap-2 text-[var(--muted)] py-6"><Spinner /> {t('common.loading')}</div>
            : <div className="max-h-[65vh] overflow-auto pr-1"><Markdown>{md}</Markdown></div>}
        </Modal>
      )}
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

// Contributor categories. Early-access and PTB testers keep their own per-person
// tag (their `role`) but live under ONE combined category.
const CAT_META = {
  staff: { label: 'Staff', order: 0 },
  kofi: { label: 'Ko-fi Supporters', order: 1 },
  testers: { label: 'Early Access Tester & PTB Tester', order: 2 },
  contributors: { label: 'Contributors', order: 3 },
};
function resolveCat(p) {
  const cat = (p.category || '').toLowerCase();
  const sub = (p.subcategory || '').toLowerCase();
  if (cat === 'staff') return 'staff';
  if (cat === 'tester' || sub === 'early_access' || sub === 'ptb' || sub === 'early-access') return 'testers';
  if (cat === 'kofi' || cat === 'ko-fi' || cat === 'supporter') return 'kofi';
  return 'contributors';
}
const toMessages = (arr) => (arr || []).map((m) => (typeof m === 'string' ? { message: m } : m)).filter((m) => m.message);

function Community({ c, communityUrl }) {
  const { t } = useI18n();
  const [people, setPeople] = useState(c.contributors || []);
  const [messages, setMessages] = useState(toMessages(c.messages));
  useEffect(() => {
    if (!communityUrl) { setPeople(c.contributors || []); setMessages(toMessages(c.messages)); return; }
    let on = true;
    // Proxied through the API (cached + covered by "Refresh site caches") instead
    // of a direct browser fetch to the raw GitHub URL, which no admin action
    // could ever force to refresh.
    api.get(communityUrl).then(({ data: d }) => {
      if (!on || !d) return;
      const base = c.pfpBase || '';
      setPeople((d.contributors || []).map((p) => ({
        name: p.display_name || p.username || p.name, role: p.role, description: p.description,
        category: resolveCat(p),
        pfp: p.pfp ? (/^https?:/.test(p.pfp) ? p.pfp : base + p.pfp.replace(/^\/+/, '')) : '',
        links: { github: p.github, website: p.website },
      })));
      // Prefer the real community messages shipped alongside the contributors.
      if (Array.isArray(d.messages) && d.messages.length) setMessages(toMessages(d.messages));
    }).catch(() => {});
    return () => { on = false; };
  }, [communityUrl]);
  const cats = {};
  for (const p of people) { (cats[p.category || 'contributors'] ||= []).push(p); }
  const ordered = Object.entries(cats).sort((a, b) => (CAT_META[a[0]]?.order ?? 9) - (CAT_META[b[0]]?.order ?? 9));
  if (!people.length && !messages.length) return <EmptyState icon={Users} title={t('proj.nocontrib')} sub="Configure contributorsUrl & messages in the admin dashboard." />;
  return (
    <div className="space-y-10">
      <MessageTicker messages={messages} />
      {ordered.map(([cat, list]) => (
        <section key={cat}>
          <h2 className="font-semibold mb-3 flex items-center gap-2"><Users size={16} className="text-[var(--primary-2)]" /> {CAT_META[cat]?.label || cat} <span className="text-sm font-normal text-[var(--faint)]">· {list.length}</span></h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {list.map((p, i) => (
              <Card key={i} hover className="p-5 group transition-all duration-200 hover:-translate-y-1">
                <div className="flex items-center gap-3">
                  {p.pfp ? <img src={p.pfp} alt="" loading="lazy" className="w-12 h-12 rounded-full object-cover border border-[var(--line)] transition-transform duration-200 group-hover:scale-110 group-hover:border-[var(--primary)]" />
                    : <div className="w-12 h-12 rounded-full bg-gradient-to-br from-orange-500 to-amber-500 grid place-items-center text-white font-bold transition-transform duration-200 group-hover:scale-110">{(p.name || '?')[0]}</div>}
                  <div className="min-w-0"><div className="font-semibold truncate group-hover:text-[var(--primary-2)] transition-colors">{p.name}</div><div className="text-xs text-[var(--primary-2)]">{p.role}</div></div>
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
    (l.readme || l.readmeFr) && { icon: BookOpen, title: 'README', sub: 'Project documentation', url: pick(l.readme, l.readmeFr) },
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

/* ─────────────────────────  Other projects (showcase)  ───────────────────────── */

// Public list of admin-curated "other projects".
export function OtherProjects() {
  const { t } = useI18n();
  const { data, loading } = useFetch(() => api.get('/showcase'), []);
  const projects = data?.projects || [];
  return (
    <div>
      <PageHeader icon={Boxes} title={t('nav.projects') || 'Projects'} subtitle={t('projects.sub') || 'More from the Better* ecosystem.'} />
      {loading ? <div className="flex items-center gap-2 text-[var(--muted)] py-8"><Spinner /> {t('common.loading')}</div>
        : projects.length ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((p) => (
              <Link key={p.slug} to={`/project/${p.slug}`}>
                <Card hover className="p-5 h-full">
                  <div className="flex items-center gap-3">
                    <div className="grid place-items-center w-11 h-11 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 text-white font-extrabold text-sm shrink-0">{p.short}</div>
                    <div className="font-semibold truncate">{p.name}</div>
                  </div>
                  {p.tagline && <p className="text-sm text-[var(--muted)] mt-3 line-clamp-3">{p.tagline}</p>}
                </Card>
              </Link>
            ))}
          </div>
        ) : <EmptyState icon={Boxes} title="No projects yet" sub="Featured projects will appear here." />}
    </div>
  );
}

function ShowcaseCommunity({ cfg, c, slug }) {
  if (cfg.community?.url) return (
    <Card className="p-8 text-center bg-gradient-to-br from-orange-500/8 to-transparent">
      <Users size={28} className="mx-auto text-[var(--primary-2)] mb-3" />
      <div className="font-semibold mb-1">Community</div>
      <p className="text-sm text-[var(--muted)] mb-4 max-w-md mx-auto">Join the community for this project.</p>
      <a href={cfg.community.url} target="_blank" rel="noreferrer"><Button variant="primary"><ExternalLink size={15} /> Open community</Button></a>
    </Card>
  );
  return <Community c={c} communityUrl={c.contributorsUrl ? `/showcase/${slug}/community` : null} />;
}

function ShowcaseLegal({ legal, lang }) {
  const pick = (v) => (v && typeof v === 'object' && !Array.isArray(v)) ? (v[lang] ?? v.en ?? Object.values(v)[0]) : v;
  if (!legal.length) return <EmptyState icon={ShieldCheck} title="Nothing here" sub="Legal cards are set in the admin dashboard." />;
  return (
    <div className="grid sm:grid-cols-2 gap-3 max-w-3xl">
      {legal.map((card, i) => {
        const Ic = LEGAL_ICONS[card.icon] || ShieldCheck;
        const inner = (
          <Card hover={!!card.url} className="p-4 flex items-start gap-3 h-full">
            <Ic size={18} className="text-[var(--primary-2)] shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0"><div className="font-medium">{pick(card.title)}</div>{card.text && <div className="text-xs text-[var(--muted)] mt-1 leading-relaxed">{pick(card.text)}</div>}</div>
            {card.url && <ExternalLink size={15} className="text-[var(--faint)] shrink-0" />}
          </Card>
        );
        return card.url ? <a key={i} href={card.url} target="_blank" rel="noreferrer">{inner}</a> : <div key={i}>{inner}</div>;
      })}
    </div>
  );
}

// A showcase project page — same tabs as BMM/BSM, driven entirely by admin config.
export function ShowcaseProjectPage() {
  const { slug } = useParams();
  const { t, lang } = useI18n();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') || 'overview';
  const { data, loading, err, refetch } = useFetch(() => api.get(`/showcase/${slug}`), [slug]);
  if (loading) return <div className="flex items-center gap-2 text-[var(--muted)] py-10"><Spinner /> {t('common.loading')}</div>;
  if (err?.status === 403) return <EmptyState icon={ShieldCheck} title="Not available" sub="You don't have access to this page." />;
  if (err) return <EmptyState icon={Boxes} title="Project not found" />;
  if (data.announcement) return <AnnouncementTeaser announcement={data.announcement} onReveal={refetch} />;
  const proj = data.project; const cfg = proj.config || {}; const T = cfg.tabs || {};
  const c = {
    name: proj.name, tagline: cfg.tagline, downloads: cfg.downloads || [], links: cfg.links || {},
    releaseNotes: cfg.releaseNotes, media: cfg.overview, replayUrl: cfg.overview?.replayUrl,
    contributors: cfg.community?.contributors || [], messages: cfg.community?.messages || [], contributorsUrl: cfg.community?.contributorsUrl,
  };
  const tabs = [
    ['overview', t('proj.overview'), ListTodo],
    (T.releases && cfg.releaseNotes?.owner) && ['releases', t('proj.releases'), ScrollText],
    T.community && ['community', t('proj.community'), Users],
    proj.showBlogTab && ['blog', t('proj.blog'), Newspaper],
    T.legal && ['legal', t('proj.legal'), ShieldCheck],
  ].filter(Boolean);
  return (
    <div>
      <div className="flex flex-col md:flex-row md:items-center gap-5 mb-8">
        <div className="grid place-items-center w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-500 to-amber-500 shrink-0"><span className="text-xl font-extrabold text-white">{proj.short}</span></div>
        <div className="flex-1"><h1 className="text-3xl font-extrabold">{proj.name}</h1>{cfg.tagline && <p className="text-[var(--muted)] mt-1">{cfg.tagline}</p>}</div>
        <div className="flex flex-wrap items-start gap-2">
          <DownloadMenu downloads={cfg.downloads} />
        </div>
      </div>

      {cfg.links && Object.values(cfg.links).some(Boolean) && (
        <div className="flex flex-wrap gap-2 mb-8">
          {LINK_ORDER.filter((k) => cfg.links[k]).map((k) => { const m = LINK_META[k] || { icon: ExternalLink, label: k }; return (
            <a key={k} href={cfg.links[k]} target="_blank" rel="noreferrer"><Button size="sm"><m.icon size={14} className={k === 'kofi' ? 'text-orange-400' : ''} /> {m.label}</Button></a>); })}
          {cfg.links.customUrl && <a href={cfg.links.customUrl} target="_blank" rel="noreferrer"><Button size="sm"><ExternalLink size={14} /> {cfg.links.customLabel || 'Link'}</Button></a>}
        </div>
      )}

      <div className="flex gap-2 mb-6 border-b border-[var(--line)] overflow-x-auto no-scrollbar">
        {tabs.map(([id, label, Icon]) => (
          <button key={id} onClick={() => setSp((p) => { const n = new URLSearchParams(p); n.set('tab', id); return n; })}
            className={`flex items-center gap-1.5 px-3 py-2.5 text-sm border-b-2 -mb-px whitespace-nowrap ${tab === id ? 'border-[var(--primary)] text-[var(--text)]' : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'}`}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview c={c} pkey={slug} progressUrl={`/showcase/${slug}/progress`} />}
      {tab === 'releases' && <Releases releasesUrl={`/showcase/${slug}/releases`} />}
      {tab === 'community' && <ShowcaseCommunity cfg={cfg} c={c} slug={slug} />}
      {tab === 'blog' && <ProjectBlogTab page={slug} />}
      {tab === 'legal' && <ShowcaseLegal legal={cfg.legal || []} lang={lang} />}
    </div>
  );
}

// A project page's own "Blog" tab — only this project's/page's posts (via the
// existing GET /blog?project=<key> or ?page=<slug> filter, opt-in per project).
function ProjectBlogTab({ project, page }) {
  const { t, lang } = useI18n();
  const qs = project ? `project=${project}` : `page=${page}`;
  const { data, loading } = useFetch(() => api.get(`/blog?${qs}`), [project, page]);
  const posts = data?.posts || [];
  const pick = (p) => (lang === 'fr' ? { title: p.titleFr || p.title, excerpt: p.excerptFr || p.excerpt } : { title: p.title, excerpt: p.excerpt });
  const fmt = (d) => (d ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');
  if (loading) return <div className="flex items-center gap-2 text-[var(--muted)] py-8"><Spinner /> {t('common.loading')}</div>;
  if (!posts.length) return <EmptyState icon={Newspaper} title={t('proj.noposts')} />;
  return (
    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
      {posts.map((p) => { const v = pick(p); return (
        <Link key={p.id} to={`/blog/${p.slug}`}>
          <Card hover className="overflow-hidden h-full flex flex-col">
            {p.cover ? <img src={p.cover} alt="" className="w-full h-40 object-cover" /> : <div className="w-full h-40 bg-gradient-to-br from-orange-500/25 to-amber-500/10 grid place-items-center"><Newspaper size={32} className="text-[var(--primary-2)] opacity-80" /></div>}
            <div className="p-4 flex-1 flex flex-col">
              <div className="text-xs text-[var(--faint)]">{fmt(p.publishedAt)}</div>
              <div className="font-bold mt-1 leading-snug">{v.title}</div>
              {v.excerpt && <div className="text-sm text-[var(--muted)] mt-1.5 line-clamp-2 flex-1">{v.excerpt}</div>}
            </div>
          </Card>
        </Link>
      ); })}
    </div>
  );
}
