import { useEffect, useState, useRef } from 'react';
import { Link, useParams, useSearchParams, useNavigate } from 'react-router-dom';
import {
  Boxes, Music2, Puzzle, Palette, Server, Rocket, Download, ArrowRight, Search, Upload,
  Bell, CheckCircle2, XCircle, Clock, Package, ShieldCheck, Inbox, Tag, FileJson, HardDrive,
  Cpu, Gauge, TrendingUp, Eye, Sparkles, Lock, Zap, Users, GitBranch, Settings2,
  Newspaper, LayoutDashboard, Cookie, Sliders, Heart, Trash2, PenSquare, Star, Bell as BellIcon, CheckCheck, ArrowUpRight,
  Receipt, Wand2, Plus, Link2, Copy, Globe, BadgeCheck, Mail, Send, MessageSquare, Files, RefreshCw, X, ChevronDown, Monitor, MonitorOff, AlertTriangle, Ticket,
  CreditCard, Gift, Archive, Shield, Ban, FolderGit2, FileText, History, Target, Megaphone, EyeOff, Rss,
  Info, Orbit, Fingerprint,
} from 'lucide-react';
import { api, uploadPayload } from './api.js';
import { useAuth } from './auth.jsx';
import { useI18n } from './i18n.jsx';
import { useTheme } from './theme.jsx';
import { getConsent, setConsent } from './analytics.js';
import { SKIP_KEY } from './IntroContext.jsx';
import { getGlassPrefs, setGlassPrefs, getOrbTransitionPref, setOrbTransitionPref } from './prefs.js';
import { MyRepos, AdminRepos, Billing } from './repos.jsx';
import Avatar from './Avatar.jsx';
import { AppLogo, KofiIcon, GithubIcon, DiscordIcon, RedditIcon } from './brand.jsx';
import { Button, Card, Badge, Input, Textarea, Select, Field, PageHeader, EmptyState, Spinner, Modal, useDialog, useToast } from './ui.jsx';
import Markdown from './md.jsx';

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
// Coarse "time left" for a scheduled deletion.
function fmtRemaining(deleteAt) {
  const ms = new Date(deleteAt).getTime() - Date.now();
  if (ms <= 0) return 'soon';
  const h = Math.floor(ms / 3600000);
  return h >= 1 ? `${h}h` : `${Math.max(1, Math.floor(ms / 60000))}m`;
}

// A friendlier JSON editor: framed panel with a live valid/invalid indicator, a
// one-click Format button, and tab-to-indent — replaces the raw ugly <textarea>.
function JsonEditor({ value, onChange, placeholder, minH = 170 }) {
  const [err, setErr] = useState(null);
  useEffect(() => { try { if ((value || '').trim()) JSON.parse(value); setErr(null); } catch (e) { setErr(String(e.message || e)); } }, [value]);
  const format = () => { try { onChange(JSON.stringify(JSON.parse(value || '{}'), null, 2)); } catch {} };
  const onKey = (e) => {
    if (e.key === 'Tab') { // indent instead of leaving the field
      e.preventDefault(); const el = e.target; const s = el.selectionStart, en = el.selectionEnd;
      onChange(value.slice(0, s) + '  ' + value.slice(en));
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 2; });
    }
  };
  return (
    <div className={`rounded-xl border overflow-hidden transition-colors ${err ? 'border-red-500/40' : 'border-[var(--line)]'}`} style={{ background: 'var(--surface-2)' }}>
      <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-[var(--line)]">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)]"><FileJson size={12} /> JSON</span>
        <div className="flex items-center gap-2.5 text-[10px]">
          <span className={`flex items-center gap-1 ${err ? 'text-red-400' : 'text-emerald-400'}`}><span className={`w-1.5 h-1.5 rounded-full ${err ? 'bg-red-400' : 'bg-emerald-400'}`} />{err ? 'invalid' : 'valid'}</span>
          <button type="button" onClick={format} className="flex items-center gap-1 text-[var(--muted)] hover:text-[var(--text)]"><Wand2 size={11} /> Format</button>
        </div>
      </div>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={onKey} placeholder={placeholder} spellCheck={false}
        className="w-full bg-transparent px-3 py-2.5 font-mono text-xs leading-relaxed outline-none resize-y text-[var(--text)]" style={{ minHeight: minH }} />
      {err && <div className="px-3 py-1.5 text-[10px] text-red-400 border-t border-red-500/20 truncate" title={err}>{err}</div>}
    </div>
  );
}

// Pro dashboard shell: a sticky left sidebar of sections + a content pane.
// `tabs`: [{ id, label, icon, badge? }] — or a `{ heading }` entry (no id) to group
// tabs under a small non-clickable section label (e.g. long admin sidebars).
// Persists the active tab in the URL (?s=).
function SideDash({ title, subtitle, icon, tabs, headerActions, children }) {
  const [sp, setSp] = useSearchParams();
  const realTabs = tabs.filter((t) => t.id);
  const active = sp.get('s') || realTabs[0]?.id;
  const set = (id) => setSp((p) => { const n = new URLSearchParams(p); n.set('s', id); return n; }, { replace: true });
  const current = realTabs.find((t) => t.id === active) || realTabs[0];
  return (
    <div>
      <PageHeader icon={icon} title={title} subtitle={subtitle} actions={headerActions} />
      <div className="grid md:grid-cols-[220px_1fr] gap-6">
        {/* A real card panel behind the whole nav (not just the active pill) — it
            used to float directly on the page background, which looked ungrounded
            next to the content cards beside it. */}
        <nav className="card p-2 flex md:flex-col gap-1 overflow-x-auto md:overflow-visible md:sticky md:top-20 self-start pb-2 md:pb-2">
          {tabs.map((tb, i) => tb.heading ? (
            <div key={`h-${i}`} className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)] shrink-0 first:pt-1">{tb.heading}</div>
          ) : (
            <button key={tb.id} onClick={() => set(tb.id)}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-left whitespace-nowrap transition shrink-0 ${active === tb.id ? 'bg-[var(--surface-2)] text-[var(--text)] border border-[var(--line)] font-medium' : 'text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] border border-transparent'}`}>
              <tb.icon size={16} className={active === tb.id ? 'text-[var(--primary-2)]' : ''} /> {tb.label}
              {tb.badge ? <Badge tone="primary" className="ml-auto">{tb.badge}</Badge> : null}
            </button>
          ))}
        </nav>
        <div className="min-w-0">{typeof children === 'function' ? children(current.id) : children}</div>
      </div>
    </div>
  );
}

/* ─────────────────────────  Home  ───────────────────────── */
function useScrollReveal() {
  const root = useRef(null);
  useEffect(() => {
    document.documentElement.classList.add('js-anim');
    if (!root.current) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const el = e.target;
        // If, by the time this fires, the element is already well inside (or above)
        // the viewport — i.e. the user fast-scrolled or jumped past the trigger —
        // snap it in with a short fade instead of playing the long rise+blur while
        // it's on screen (which reads as a glitchy late "spawn"). Fresh-measure
        // rather than trusting the possibly-stale entry rect on a fast scroll.
        if (el.getBoundingClientRect().top < window.innerHeight * 0.55) el.classList.add('reveal-instant');
        el.classList.add('in');
        io.unobserve(el);
      });
      // A small rootMargin so a reveal fires slightly BEFORE its top edge reaches
      // the viewport bottom — enough to feel scroll-driven, but never so deep that
      // a short section (or the very last one) can't cross the threshold at all.
    }, { threshold: 0.05, rootMargin: '0px 0px -8% 0px' });
    // Observe an element (assigning stagger indexes to a grid's children first).
    const observe = (el) => {
      if (el.dataset.revealBound) return;
      el.dataset.revealBound = '1';
      if (el.classList.contains('reveal-stagger')) [...el.children].forEach((c, i) => c.style.setProperty('--i', i));
      io.observe(el);
    };
    const scan = () => root.current?.querySelectorAll('.reveal-on-scroll, .reveal-stagger').forEach(observe);
    scan();
    // CRITICAL: async content (e.g. the Latest-news grid, which renders only after
    // its blog fetch resolves) is added to the DOM AFTER the initial scan — a
    // MutationObserver catches those late elements so they're revealed too. Before
    // this, the whole news section silently stayed at opacity:0 forever.
    const mo = new MutationObserver(scan);
    mo.observe(root.current, { childList: true, subtree: true });
    // Safety net: anything already in view on load (or that a browser restored
    // scroll position onto) is revealed on the next frame regardless.
    requestAnimationFrame(scan);
    return () => { io.disconnect(); mo.disconnect(); };
  }, []);
  return root;
}

// Editorial numbered section label with a fading rule — the small premium touch
// that gives the page rhythm (like high-end brand microsites).
function SectionKicker({ n, label }) {
  return (
    <div className="reveal-on-scroll flex items-center gap-3 mb-6">
      <span className="text-[11px] font-mono font-bold text-[var(--primary-2)] tracking-widest">{n}</span>
      <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--faint)]">{label}</span>
      <span className="flex-1 h-px bg-gradient-to-r from-[var(--line-strong)] to-transparent" />
    </div>
  );
}

// Animated integer counter that plays once when scrolled into view — used by the
// hero stats. Values are real DB counts (zero stats are hidden by the caller).
function CountUp({ value }) {
  const ref = useRef(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    let raf;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return; io.disconnect();
      const t0 = performance.now(), dur = 1300;
      const step = (t) => {
        const p = Math.min(1, (t - t0) / dur);
        setN(Math.round(value * (1 - Math.pow(1 - p, 3)))); // ease-out cubic
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, { threshold: 0.4 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [value]);
  return <span ref={ref}>{n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : n}</span>;
}

export function Home() {
  const { data } = useAsync(() => api.get('/blog?home=1'), []);
  const { data: stats } = useAsync(() => api.get('/stats').catch(() => null), []);
  const { user } = useAuth();
  const { t } = useI18n();
  const root = useScrollReveal();
  const products = [
    { icon: Boxes, logo: 'bmm', name: 'BMM', desc: t('prod.bmm.d'), to: '/p/bmm', tint: 'from-orange-500/20' },
    { icon: Music2, logo: 'bsm', name: 'BSM', desc: t('prod.bsm.d'), to: '/p/bsm', tint: 'from-amber-500/20' },
    { icon: Download, logo: 'installer', name: 'BetterInstaller', desc: t('prod.installer.d'), to: '/p/installer', tint: 'from-orange-500/20' },
    { icon: Rocket, name: 'Hosting', desc: t('prod.hosting.d'), to: '/hosting', tint: 'from-amber-500/20' },
  ];
  return (
    // Generous vertical rhythm on purpose: the scroll is long, so sections (and
    // their staggered children) surface one at a time while the orb spirals
    // down alongside — the page IS the choreography, not a wall of content.
    <div ref={root} className="space-y-44 md:space-y-64">
      {/* hero */}
      <section className="relative text-center pt-24 md:pt-32 pb-24 md:pb-32">
        <div className="relative z-10">
          <div className="anim-slide inline-flex items-center gap-2 badge mb-6" style={{ animationDelay: '0ms' }}><img src="/logo.png" alt="" className="w-4 h-4 rounded-md" /> <span className="text-[var(--text)]">{t('home.badge')}</span></div>
          <h1 className="anim-slide text-6xl md:text-8xl font-extrabold leading-[0.98] tracking-[-0.035em]" style={{ animationDelay: '80ms' }}>
            {t('home.hero1')}<br /><span className="gradient-text">{t('home.brand')}</span> {t('home.hero2')}
          </h1>
          <p className="anim-slide text-[var(--muted)] text-lg md:text-xl max-w-xl mx-auto mt-7 leading-relaxed" style={{ animationDelay: '160ms' }}>{t('home.sub')}</p>
          <div className="anim-slide flex flex-wrap gap-3 justify-center mt-10" style={{ animationDelay: '240ms' }}>
            <Link to="/catalog?project=bmm"><Button variant="primary" className="!px-6 !py-3">{t('home.cta.explore')} <ArrowRight size={16} /></Button></Link>
            <Link to="/hosting"><Button className="!px-6 !py-3">{t('home.cta.host')}</Button></Link>
          </div>
          {(() => {
            const s = stats || {};
            // Only counts that stay meaningful at any point in the site's life —
            // "members"/"hosted repos" read as hollow vanity numbers early on, so
            // they were dropped; items & downloads are the ones worth bragging about.
            const rows = [
              [Package, s.items, t('home.stat.items', 'Mods & presets')],
              [Download, s.downloads, t('home.stat.downloads', 'Downloads')],
            ].filter(([, v]) => v > 0); // real counts only — zeros are hidden, never faked
            if (rows.length < 2) return null; // a lone stat looks odd — wait until the site has some life
            return (
              <div className="anim-slide mt-12 flex flex-wrap justify-center gap-x-12 gap-y-4" style={{ animationDelay: '320ms' }}>
                {rows.map(([I, v, label]) => (
                  <div key={label} className="flex items-center gap-3">
                    <span className="grid place-items-center w-9 h-9 rounded-xl bg-[var(--surface-2)] border border-[var(--line)]"><I size={16} className="text-[var(--primary-2)]" /></span>
                    <div className="text-left">
                      <div className="text-xl font-extrabold leading-none tabular-nums"><CountUp value={v} /></div>
                      <div className="text-[10px] text-[var(--faint)] mt-1 font-semibold uppercase tracking-wider">{label}</div>
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      </section>

      {/* products */}
      <section>
        <SectionKicker n="01" label={t('home.k.products', 'The suite')} />
        <div className="reveal-stagger grid md:grid-cols-4 gap-4">
          {products.map((p) => (
            <Link key={p.name} to={p.to} className="group"><Card hover className={`relative overflow-hidden p-5 h-full bg-gradient-to-b ${p.tint} to-transparent transition-transform duration-300 group-hover:-translate-y-1`}>
              <div className="absolute -top-12 -right-12 w-36 h-36 rounded-full pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500" style={{ background: 'radial-gradient(circle, var(--primary-glow), transparent 65%)' }} />
              <div className="relative">
                <span className="inline-block transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-3">
                  {p.logo ? <AppLogo pkey={p.logo} size={30} fallback={p.icon} /> : <p.icon size={22} className="text-[var(--primary-2)]" />}
                </span>
                <div className="font-semibold mt-3">{p.name}</div>
                <div className="text-sm text-[var(--muted)] mt-1">{p.desc}</div>
                <div className="text-xs text-[var(--primary-2)] mt-3 flex items-center gap-1">{t('prod.open')} <ArrowRight size={12} className="transition-transform group-hover:translate-x-0.5" /></div>
              </div>
            </Card></Link>
          ))}
        </div>
      </section>

      {/* features */}
      <section>
        <SectionKicker n="02" label={t('home.k.why', 'Why BetterCommunity')} />
        <div className="reveal-stagger grid md:grid-cols-3 gap-4">
          {/* featured tile: the moderation promise, illustrated by the real review pipeline */}
          <Card hover className="p-6 md:col-span-2 group relative overflow-hidden">
            <div className="absolute -bottom-16 -right-16 w-48 h-48 rounded-full pointer-events-none opacity-40 group-hover:opacity-70 transition-opacity duration-500" style={{ background: 'radial-gradient(circle, var(--primary-glow), transparent 65%)' }} />
            <div className="relative flex items-start justify-between gap-6 flex-wrap">
              <div className="max-w-sm">
                <span className="grid place-items-center w-11 h-11 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] transition-colors group-hover:border-[var(--primary)]/40"><ShieldCheck size={20} className="text-[var(--primary-2)]" /></span>
                <div className="font-semibold mt-4">{t('home.feat.moderated')}</div>
                <div className="text-sm text-[var(--muted)] mt-1.5 leading-relaxed">{t('home.feat.moderated.d')}</div>
              </div>
              <div className="flex items-center gap-2 mt-2 md:mt-9 flex-wrap">
                <span className="badge !gap-1.5 text-[var(--muted)]"><Inbox size={12} /> {t('home.pipe.sub', 'Submitted')}</span>
                <ArrowRight size={12} className="text-[var(--faint)] shrink-0" />
                <span className="badge badge-amber !gap-1.5"><Eye size={12} /> {t('home.pipe.review', 'In review')}</span>
                <ArrowRight size={12} className="text-[var(--faint)] shrink-0" />
                <span className="badge badge-green !gap-1.5"><CheckCircle2 size={12} /> {t('home.pipe.live', 'Published')}</span>
              </div>
            </div>
          </Card>
          {[[LayoutDashboard, t('home.feat.accounts'), t('home.feat.accounts.d')],
            [Zap, t('home.feat.hosting'), t('home.feat.hosting.d')],
            [Link2, t('home.feat.install', 'One-click install'), t('home.feat.install.d', 'Catalog entries install straight into BMM through bmm:// deeplinks — no manual downloads.')],
            [Lock, t('home.feat.privacy', 'Privacy-first'), t('home.feat.privacy.d', 'No third-party trackers — anonymous first-party analytics, and only with your consent.')]].map(([I, title, d]) => (
            <Card key={title} hover className="p-6 group"><span className="grid place-items-center w-11 h-11 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] transition-colors group-hover:border-[var(--primary)]/40"><I size={20} className="text-[var(--primary-2)]" /></span><div className="font-semibold mt-4">{title}</div><div className="text-sm text-[var(--muted)] mt-1.5 leading-relaxed">{d}</div></Card>
          ))}
        </div>
      </section>

      {/* how it works */}
      <section>
        <SectionKicker n="03" label={t('home.k.start', 'Get started')} />
        <div className="reveal-on-scroll text-center mb-9"><h2 className="text-3xl md:text-4xl font-extrabold tracking-tight">{t('home.steps.title')}</h2><p className="text-[var(--muted)] mt-2.5">{t('home.steps.sub')}</p></div>
        <div className="reveal-stagger relative grid md:grid-cols-3 gap-5">
          {/* connecting dotted line — desktop only, threaded through the icon row (56px
              badge + 24px card padding ⇒ center ≈ 52px down). Lives OUTSIDE the cards so
              it isn't clipped, and sits behind them (z-0) so the icon badges read on top. */}
          <div className="hidden md:block absolute top-[52px] left-[16.5%] right-[16.5%] h-0 border-t-2 border-dotted border-[var(--line-strong)] z-0" />
          {[[Users, t('home.step1'), t('home.step1.d'), user ? '/profile' : '/auth', user ? t('home.step1.done', "You're set — view profile") : t('home.step1.cta', 'Sign up free')],
            [Upload, t('home.step2'), t('home.step2.d'), '/catalog', t('home.step2.cta', 'Browse the catalog')],
            [Rocket, t('home.step3'), t('home.step3.d'), '/hosting', t('home.step3.cta', 'See hosting plans')]].map(([I, title, d, to, cta], i) => (
            <Link key={title} to={to} className="group relative z-[1]">
              <Card hover className="p-6 h-full flex flex-col border-t-2" style={{ background: 'var(--bg-solid)', borderTopColor: 'var(--primary)' }}>
                <div className="relative grid place-items-center w-14 h-14 rounded-2xl bg-gradient-to-br from-orange-500 to-amber-500 shadow-lg shadow-orange-500/25 shrink-0">
                  <I size={22} className="text-white" />
                  <span className="absolute -bottom-2 -right-2 grid place-items-center w-6 h-6 rounded-full bg-[var(--bg-solid)] border-2 border-[var(--primary)] text-[11px] font-bold text-[var(--primary-2)]">{i + 1}</span>
                </div>
                <div className="font-semibold mt-4 text-[15px]">{title}</div><div className="text-sm text-[var(--muted)] mt-1.5 leading-relaxed flex-1">{d}</div>
                <div className="text-xs text-[var(--primary-2)] mt-4 flex items-center gap-1 font-medium">{cta} <ArrowRight size={12} className="transition-transform group-hover:translate-x-0.5" /></div>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      {/* latest posts */}
      <section>
        <SectionKicker n="04" label={t('home.k.news', 'From the blog')} />
        <div className="reveal-on-scroll flex items-center justify-between mb-5"><h2 className="text-2xl md:text-3xl font-extrabold tracking-tight">{t('home.news')}</h2><Link to="/blog" className="text-sm text-[var(--primary-2)] flex items-center gap-1 hover:gap-2 transition-all">{t('home.news.all')} <ArrowRight size={13} /></Link></div>
        {!data?.posts?.length ? <Card className="p-6 text-[var(--muted)] text-sm">{t('home.news.none')}</Card> : (() => {
          const posts = data.posts; const featured = posts[0]; const rest = posts.slice(1, 4);
          const fdate = (d) => d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
          return (
            <div className="reveal-stagger grid lg:grid-cols-2 gap-5">
              {/* large featured latest post */}
              <Link to={`/blog/${featured.slug}`} className="group">
                <Card hover className="overflow-hidden h-full flex flex-col" style={{ background: 'var(--bg-solid)' }}>
                  <div className="relative overflow-hidden">
                    {featured.cover ? <img src={featured.cover} alt="" className="w-full h-56 object-cover transition-transform duration-300 group-hover:scale-105" />
                      : <div className="w-full h-56 bg-gradient-to-br from-orange-500/25 to-amber-500/10 grid place-items-center"><Newspaper size={34} className="text-[var(--primary-2)]" /></div>}
                    <span className="absolute top-3 left-3 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-[var(--bg-solid)]/85 backdrop-blur text-[var(--primary-2)] border border-[var(--line)]">Latest</span>
                  </div>
                  <div className="p-6 flex flex-col flex-1">
                    <Badge tone="primary" className="self-start">{featured.project?.name}</Badge>
                    <div className="font-bold text-xl mt-2 leading-snug group-hover:text-[var(--primary-2)] transition-colors">{featured.title}</div>
                    <div className="text-sm text-[var(--muted)] mt-2 line-clamp-3 flex-1">{featured.excerpt}</div>
                    <div className="flex items-center justify-between mt-4">
                      <span className="text-xs text-[var(--faint)]">{featured.author?.displayName} · {fdate(featured.publishedAt)}</span>
                      <span className="text-xs text-[var(--primary-2)] flex items-center gap-1 font-medium">Read <ArrowRight size={12} /></span>
                    </div>
                  </div>
                </Card>
              </Link>
              {/* smaller recent posts — nested stagger so the featured (latest)
                  surfaces first, then these cascade in one after another */}
              <div className="flex flex-col gap-4 reveal-stagger">
                {rest.map((p) => (
                  <Link key={p.id} to={`/blog/${p.slug}`} className="group">
                    <Card hover className="p-4 flex gap-4 h-full" style={{ background: 'var(--bg-solid)' }}>
                      {p.cover ? <img src={p.cover} alt="" className="w-24 h-24 rounded-lg object-cover shrink-0" />
                        : <div className="w-24 h-24 rounded-lg bg-gradient-to-br from-orange-500/20 to-amber-500/10 grid place-items-center shrink-0"><Newspaper size={20} className="text-[var(--primary-2)]" /></div>}
                      <div className="min-w-0 flex flex-col flex-1">
                        <Badge tone="primary" className="self-start">{p.project?.name}</Badge>
                        <div className="font-semibold mt-1 leading-snug line-clamp-2 group-hover:text-[var(--primary-2)] transition-colors">{p.title}</div>
                        <div className="text-xs text-[var(--muted)] mt-1 line-clamp-2">{p.excerpt}</div>
                        <div className="text-[11px] text-[var(--faint)] mt-auto pt-1">{fdate(p.publishedAt)}</div>
                      </div>
                    </Card>
                  </Link>
                ))}
                {rest.length === 0 && <Card className="p-6 text-sm text-[var(--muted)] grid place-items-center h-full">More posts coming soon.</Card>}
              </div>
            </div>
          );
        })()}
      </section>

      {/* CTA / support */}
      <section className="reveal-on-scroll pb-4">
        <Card className="p-10 md:p-14 text-center relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-orange-500/15 via-amber-500/5 to-transparent" />
          <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-[36rem] h-[36rem] rounded-full opacity-40 pointer-events-none" style={{ background: 'radial-gradient(circle, var(--primary-glow), transparent 62%)' }} />
          <div className="relative reveal-stagger">
            <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight">{t('home.cta2.title')}</h2>
            <p className="text-[var(--muted)] mt-3 max-w-lg mx-auto leading-relaxed">{t('home.cta2.sub')}</p>
            <div className="flex flex-wrap gap-3 justify-center mt-7">
              <Link to="/auth"><Button variant="primary" className="!px-6 !py-3">{t('home.cta2.start')} <ArrowRight size={16} /></Button></Link>
              <a href="https://discord.com/invite/CTaaEF9R75" target="_blank" rel="noreferrer"><Button className="!px-6 !py-3"><DiscordIcon size={16} className="text-[#5865F2]" /> {t('home.cta2.discord', 'Join the Discord')}</Button></a>
              <a href="https://ko-fi.com/bettercommunity" target="_blank" rel="noreferrer"><Button className="!px-6 !py-3"><KofiIcon size={16} className="text-orange-400" /> {t('home.cta2.kofi')}</Button></a>
            </div>
          </div>
        </Card>
      </section>

      {/* Ko-fi funding goal — its own section, pinned at the very bottom of the
          page (only renders when an admin has set a goal). */}
      <KofiGoalWidget />
    </div>
  );
}

// Public funding-goal progress bar — only renders once an admin has set a
// target via the admin dashboard (see AdminKofiGoal); shows the running total
// + tip count sourced from logged Ko-fi webhook events.
function KofiGoalWidget() {
  const { t } = useI18n();
  const { data } = useAsync(() => api.get('/kofi/stats').catch(() => null), []);
  // Always render a support section at the bottom of the page — the progress bar
  // appears only once an admin has set a goal (data.goal); otherwise it's a
  // simple "support us on Ko-fi" card so the section is never empty.
  const goal = data?.goal;
  const pct = goal ? Math.min(100, Math.round((data.totalAmount / goal.targetAmount) * 100)) : 0;
  return (
    <section className="reveal-on-scroll">
      <Card className="p-6 md:p-8 max-w-xl mx-auto text-center relative overflow-hidden">
        <div className="absolute -bottom-16 left-1/2 -translate-x-1/2 w-96 h-96 rounded-full opacity-30 pointer-events-none" style={{ background: 'radial-gradient(circle, var(--primary-glow), transparent 62%)' }} />
        <div className="relative reveal-stagger">
          <div className="inline-flex items-center gap-2 text-base font-bold mb-1"><KofiIcon size={18} className="text-orange-400" /> {goal?.title || t('home.kofi.goal.title', 'Support BetterCommunity')}</div>
          <p className="text-xs text-[var(--muted)] mb-4">{t('home.kofi.goal.help', 'Help keep the servers running — every tip counts.')}</p>
          {goal && (<>
            <div className="h-3 rounded-full bg-[var(--surface-2)] overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-400 transition-all duration-700" style={{ width: `${pct}%` }} />
            </div>
            <div className="flex items-center justify-between mt-2.5 mb-4 text-sm">
              <span className="font-semibold tabular-nums">{data.totalAmount.toFixed(0)} / {goal.targetAmount} {goal.currency}</span>
              <span className="text-[var(--muted)]">{pct}% · {t('home.kofi.goal.tips', '{n} tips').replace('{n}', data.tipCount)}</span>
            </div>
          </>)}
          <a href="https://ko-fi.com/bettercommunity" target="_blank" rel="noreferrer">
            <Button variant="primary" className="!px-6"><KofiIcon size={16} className="text-white" /> {t('home.cta2.kofi', 'Support on Ko-fi')}</Button>
          </a>
        </div>
      </Card>
    </section>
  );
}

/* ─────────────────────────  Catalog  ───────────────────────── */
const SORTS = [['recent', 'Newest'], ['popular', 'Most popular'], ['month', 'Popular this month'], ['views', 'Most viewed']];
export function Catalog() {
  const toast = useToast(); const { t } = useI18n();
  const [sp, setSp] = useSearchParams();
  const project = sp.get('project') || '', kind = sp.get('kind') || '', q = sp.get('q') || '', sort = sp.get('sort') || 'recent';
  const { data, loading } = useAsync(() => api.get(`/catalog?${new URLSearchParams({ project, kind, q, sort })}`), [project, kind, q, sort]);
  const set = (k, v) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); setSp(n); };
  const [sel, setSel] = useState(new Set());
  const items = data?.items || [];
  // Multi-select download makes sense for presets (small JSON files).
  const multi = project === 'bsm' || kind === 'PRESET';
  const toggle = (slug) => setSel((s) => { const n = new Set(s); n.has(slug) ? n.delete(slug) : n.add(slug); return n; });
  const downloadSelected = async () => {
    try {
      const { files } = await api.post('/catalog/downloads', { slugs: [...sel] });
      files.forEach((f, i) => setTimeout(() => { const a = document.createElement('a'); a.href = f.url; a.download = `${f.name || f.slug}.json`; document.body.appendChild(a); a.click(); a.remove(); }, i * 350));
      toast.success(t('cat.downloading', 'Downloading {n} preset(s)…').replace('{n}', files.length)); setSel(new Set());
    } catch { toast.error(t('cat.dlfail', 'Download failed.')); }
  };
  return (
    <div>
      <PageHeader icon={Package} title={`${t('cat.title', 'Catalog')}${project ? ` · ${project.toUpperCase()}` : ''}`} subtitle={t('cat.sub', 'Community apps, plugins, themes and presets.')} />
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
          <Input className="!pl-9" placeholder={t('cat.search', 'Search mods, plugins, themes & presets…')} defaultValue={q} onKeyDown={(e) => e.key === 'Enter' && set('q', e.target.value)} />
        </div>
        {/* Kinds are project-scoped: presets are a BSM thing; BMM has apps/plugins/themes. */}
        {(project === 'bsm' ? ['', 'PRESET'] : project === 'bmm' ? ['', 'APP', 'PLUGIN', 'THEME'] : ['', 'APP', 'PLUGIN', 'THEME', 'PRESET']).map((k) => <Button key={k} size="sm" variant={kind === k ? 'primary' : 'default'} onClick={() => set('kind', k)}>{k || t('cat.all', 'All')}</Button>)}
        <Select className="!w-auto ml-auto" value={sort} onChange={(e) => set('sort', e.target.value)}>{SORTS.map(([v, l]) => <option key={v} value={v}>{t(`cat.sort.${v}`, l)}</option>)}</Select>
      </div>
      {multi && sel.size > 0 && (
        <div className="flex items-center gap-3 mb-4 p-3 rounded-xl border border-[var(--primary)] bg-orange-500/5">
          <span className="text-sm font-medium">{t('cat.selected', '{n} selected').replace('{n}', sel.size)}</span>
          <Button size="sm" variant="primary" onClick={downloadSelected}><Download size={14} /> {t('cat.dlsel', 'Download selected')}</Button>
          <Button size="sm" variant="ghost" onClick={() => setSel(new Set())}>{t('cat.clear', 'Clear')}</Button>
        </div>
      )}
      {loading ? <Loading /> : (items.length ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((it) => { const I = KIND_ICON[it.kind] || Package; const checked = sel.has(it.slug); return (
            <div key={it.id} className="relative">
              {multi && it.payloadKey !== null && (
                <label className="absolute top-3 left-3 z-10" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={checked} onChange={() => toggle(it.slug)} className="w-4 h-4 accent-[var(--primary)] cursor-pointer" />
                </label>
              )}
              <Link to={`/item/${it.slug}`}><Card hover className={`p-5 h-full ${checked ? 'border-[var(--primary)]' : ''}`}>
                <div className="flex items-center justify-between"><div className={`grid place-items-center w-9 h-9 rounded-lg bg-[var(--surface-2)] border border-[var(--line)] ${multi ? 'ml-6' : ''}`}><I size={17} className="text-[var(--primary-2)]" /></div><Badge>v{it.version}</Badge></div>
                <div className="font-semibold mt-3">{it.name}</div>
                <div className="text-sm text-[var(--muted)] mt-1 line-clamp-2">{it.description || t('cat.nodesc', 'No description.')}</div>
                <div className="text-xs text-[var(--faint)] mt-3 flex items-center gap-3 flex-wrap">
                  <span className="flex items-center gap-1"><Users size={12} /> {it.owner?.displayName}</span>
                  <span className="flex items-center gap-1"><Eye size={12} /> {it.views ?? 0}</span>
                  <span className="flex items-center gap-1"><Download size={12} /> {it.downloads ?? 0}{it.monthDownloads != null ? ` (${it.monthDownloads}/mo)` : ''}</span>
                </div>
              </Card></Link>
            </div>); })}
        </div>
      ) : <EmptyState icon={Inbox} title={t('cat.empty.t', 'Nothing here yet')} sub={t('cat.empty.s', 'Be the first to publish to this catalog.')} />)}
    </div>
  );
}

export function ItemDetail() {
  const { slug } = useParams();
  const toast = useToast(); const { t } = useI18n();
  const { data, loading, err } = useAsync(() => api.get(`/catalog/${slug}`), [slug]);
  const [warn, setWarn] = useState(false);
  if (loading) return <Loading />;
  if (err) return <EmptyState icon={XCircle} title={t('item.notfound', 'Not found')} />;
  const it = data.item; const I = KIND_ICON[it.kind] || Package;
  const v = it.kind === 'PLUGIN' ? it.meta?.validation : null; // { valid, reason, sha256, files }
  const doDownload = async () => { try { const { url } = await api.get(`/catalog/${slug}/download`); window.open(url, '_blank'); } catch { toast.error(t('cat.dlfail', 'Download failed.')); } };
  // Invalid plugins pop a warning first; the user must confirm to proceed.
  const download = () => { if (v && v.valid === false) return setWarn(true); doDownload(); };
  // BMM installs APP/PLUGIN/THEME via a bmm://catalog/<kind>/install deeplink (handled
  // in BMM's deep_link_manager). Resolve a real download URL, then fire the deeplink.
  const bmmInstallable = ['APP', 'PLUGIN', 'THEME'].includes(it.kind) && (it.payloadKey || it.meta?.download_url || it.meta?.download?.url);
  const openInBmm = async () => {
    let url = it.meta?.download_url || it.meta?.download?.url;
    if (!url && it.payloadKey) { try { const r = await api.get(`/catalog/${slug}/download`); url = r.url; } catch {} }
    if (!url) return toast.error(t('item.nourl', 'No download URL for this item.'));
    const type = it.kind === 'APP' ? (it.meta?.download?.file_type || 'exe') : '';
    const dl = `bmm://catalog/${it.kind.toLowerCase()}/install?name=${encodeURIComponent(it.name)}&url=${encodeURIComponent(url)}${type ? `&type=${type}` : ''}`;
    window.location.href = dl;
  };
  return (
    <div className="max-w-3xl">
      {v && (
        <Card className={`p-3.5 mb-5 flex items-center gap-2.5 ${v.valid ? 'bg-emerald-500/8' : 'bg-red-500/8 border-red-500/30'}`}>
          {v.valid ? <BadgeCheck size={18} className="text-emerald-400 shrink-0" /> : <XCircle size={18} className="text-red-400 shrink-0" />}
          <div className="flex-1 text-sm">
            {v.valid ? <><b className="text-emerald-400">{t('item.verified', 'Verified plugin')}</b> {t('item.verified.d', '— package and file checksums match.')}</>
              : <><b className="text-red-400">{t('item.invalid', 'Invalid checksum')}</b> {t('item.invalid.d', '— this .bmmplug failed integrity checks ({reason}). Installing is not recommended.').replace('{reason}', v.reason)}</>}
          </div>
          {v.sha256 && <code className="text-[10px] text-[var(--faint)] hidden sm:block">{v.sha256.slice(0, 12)}…</code>}
        </Card>
      )}
      <div className="flex items-start gap-4">
        <div className="grid place-items-center w-14 h-14 rounded-2xl bg-gradient-to-br from-orange-500/25 to-amber-500/15 border border-[var(--line)]"><I size={26} className="text-[var(--primary-2)]" /></div>
        <div className="flex-1">
          <div className="flex items-center gap-2"><Badge tone="primary">{it.kind}</Badge><Badge>v{it.version}</Badge></div>
          <h1 className="text-2xl font-bold mt-2">{it.name}</h1>
          <div className="text-sm text-[var(--faint)] mt-1 flex items-center gap-4 flex-wrap">
            <span className="flex items-center gap-1"><Users size={13} /> {it.owner?.displayName}</span>
            <span className="flex items-center gap-1"><Eye size={13} /> {it.views ?? 0} {t('item.views', 'views')}</span>
            <span className="flex items-center gap-1"><Download size={13} /> {it.downloads ?? 0} {t('item.downloads', 'downloads')}</span>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 shrink-0">
          {bmmInstallable && <Button variant="primary" onClick={openInBmm}><Boxes size={16} /> {t('repos.openbmm', 'Open in BMM')}</Button>}
          {(it.payloadKey || it.meta?.download_url) && <Button variant={bmmInstallable ? 'default' : 'primary'} onClick={download}><Download size={16} /> {t('item.download', 'Download')}</Button>}
        </div>
      </div>
      {/* Per-item catalog.json — import THIS item individually as a BMM source. */}
      {bmmInstallable && (() => {
        const jsonUrl = `${location.origin}/api/catalog/${it.slug}/catalog.json`;
        return (
          <Card className="p-3 mt-5 flex items-center gap-2.5 flex-wrap">
            <FileJson size={16} className="text-[var(--primary-2)] shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-xs text-[var(--faint)]">{t('item.json.label', 'catalog.json — import this {k} individually in BMM').replace('{k}', it.kind.toLowerCase())}</div>
              <code className="text-xs text-[var(--muted)] break-all">{jsonUrl}</code>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button size="sm" onClick={() => { navigator.clipboard?.writeText(jsonUrl); toast.success(t('item.json.copied', 'catalog.json link copied.')); }}><Copy size={13} /> {t('cat.copylink', 'Copy link')}</Button>
              <a href={`bmm://catalog/${it.kind.toLowerCase()}/add-source?url=${encodeURIComponent(jsonUrl)}`}><Button size="sm"><Boxes size={13} /> {t('item.json.addbmm', 'Add as BMM source')}</Button></a>
            </div>
          </Card>
        );
      })()}
      <p className="text-[var(--muted)] leading-relaxed mt-6 whitespace-pre-wrap">{it.description || t('cat.nodesc', 'No description.')}</p>
      {it.tags?.length > 0 && <div className="flex flex-wrap gap-2 mt-4">{it.tags.map((tg) => <Badge key={tg}><Tag size={11} /> {tg}</Badge>)}</div>}
      <Card className="mt-6 p-5"><div className="text-xs font-semibold text-[var(--faint)] uppercase tracking-wider mb-2 flex items-center gap-1.5"><FileJson size={13} /> {t('item.metadata', 'Metadata')}</div>
        <pre className="text-xs text-[var(--muted)] overflow-auto max-h-80">{JSON.stringify(it.meta, null, 2)}</pre></Card>

      {warn && (
        <Modal open onClose={() => setWarn(false)} title={t('item.warn.title', 'Integrity check failed')} icon={XCircle} width="max-w-md"
          footer={<><Button variant="ghost" onClick={() => setWarn(false)}>{t('common.cancel', 'Cancel')}</Button><Button className="!bg-red-500/15 !text-red-400 !border-red-500/30" onClick={() => { setWarn(false); doDownload(); }}>{t('item.dlanyway', 'Download anyway')}</Button></>}>
          <div className="flex items-start gap-3">
            <XCircle size={22} className="text-red-400 shrink-0 mt-0.5" />
            <div className="text-sm text-[var(--muted)]">
              {t('item.warn.body1', 'This')} <code>.bmmplug</code> {t('item.warn.body2', 'did not pass validation')} (<b className="text-red-400">{v?.reason}</b>). {t('item.warn.body3', "Its checksums don't match, which means the package may have been altered or corrupted.")}
              <div className="mt-2 text-[var(--text)] font-medium">{t('item.warn.rec', 'We strongly recommend not installing it.')}</div>
            </div>
          </div>
        </Modal>
      )}
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
// Custom, themeable dropdown for the prepaid billing term (replaces the segmented
// cards). Shows the picked term + its discount, and flags the best-value option.
function TermSelect({ months, setMonths, termDisc, t }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc); return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  const opts = [1, 3, 6, 12, 24];
  const disc = (m) => Math.round((termDisc[m] || 0) * 100);
  const label = (m) => `${m} ${t('hosting.mo', 'mo')}${m === 12 ? ` · ${t('hosting.1yr', '1 yr')}` : m === 24 ? ` · ${t('hosting.2yr', '2 yr')}` : ''}`;
  const BestTag = () => <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-orange-500/15 text-[var(--primary-2)] border border-[var(--primary)]/40 whitespace-nowrap">{t('hosting.best2', 'Best value')}</span>;
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}
        className={`w-full flex items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left transition ${open ? 'border-[var(--primary)]' : 'border-[var(--line)] hover:border-[var(--line-strong)]'}`}
        style={open ? { boxShadow: '0 0 0 1px var(--primary)' } : undefined}>
        <span className="grid place-items-center w-9 h-9 rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 text-white shrink-0"><Receipt size={16} /></span>
        <span className="flex-1 min-w-0">
          <span className="font-semibold flex items-center gap-2">{label(months)}{months === 12 && <BestTag />}</span>
          <span className="block text-xs text-[var(--muted)] mt-0.5">{disc(months) > 0 ? t('hosting.savepct', 'Save {n}% vs monthly').replace('{n}', disc(months)) : t('hosting.term.note', '· prepaid, min 1 month')}</span>
        </span>
        <ChevronDown size={18} className={`text-[var(--muted)] shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div role="listbox" className="absolute z-30 mt-2 w-full rounded-xl border border-[var(--line-strong)] overflow-hidden anim-fade" style={{ background: 'var(--bg-solid)', boxShadow: '0 20px 60px -12px rgba(0,0,0,0.55)' }}>
          {opts.map((m) => { const active = m === months; const d = disc(m); return (
            <button key={m} type="button" role="option" aria-selected={active} onClick={() => { setMonths(m); setOpen(false); }}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-left text-sm transition ${active ? 'bg-orange-500/10' : 'hover:bg-[var(--surface-2)]'}`}>
              <span className={`w-2 h-2 rounded-full shrink-0 ${active ? 'bg-[var(--primary)]' : 'bg-[var(--line-strong)]'}`} />
              <span className="flex-1 font-medium">{label(m)}</span>
              {m === 12 && <BestTag />}
              {d > 0 ? <span className="text-xs font-bold text-emerald-400">−{d}%</span> : <span className="text-[11px] text-[var(--faint)]">{t('hosting.standard', 'standard')}</span>}
              {active && <CheckCircle2 size={14} className="text-[var(--primary-2)] shrink-0" />}
            </button>
          ); })}
        </div>
      )}
    </div>
  );
}

// Self-contained promo-code field: debounced live validation against
// /me/promo/validate, shown inline (no separate "apply" round-trip to
// checkout needed just to find out a code is wrong). Reports the validated
// promo (or null) up via onChange so the checkout call can include the code.
function PromoCodeField({ months, onChange }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const [code, setCode] = useState('');
  const [state, setState] = useState(null); // { promo } | { error } | null
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    if (!code.trim() || !user) { setState(null); onChange(null); return; }
    setChecking(true);
    const id = setTimeout(() => {
      api.get(`/me/promo/validate?code=${encodeURIComponent(code.trim())}`)
        .then((r) => { setState({ promo: r.promo }); onChange(r.promo.minMonths && months < r.promo.minMonths ? null : r.promo); })
        .catch((x) => { setState({ error: x.data?.error || 'invalid' }); onChange(null); })
        .finally(() => setChecking(false));
    }, 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, user]);
  const termTooShort = state?.promo?.minMonths && months < state.promo.minMonths;
  return (
    <div>
      <div className="relative">
        <Ticket size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
        <Input className="!pl-8" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder={t('hosting.promo.ph', 'Promo code (optional)')} />
        {checking && <Spinner className="absolute right-3 top-1/2 -translate-y-1/2" />}
      </div>
      {state?.error && <div className="text-xs text-red-400 mt-1 flex items-center gap-1"><XCircle size={12} /> {t('hosting.promo.invalid', 'Invalid or expired code.')}</div>}
      {state?.promo && !termTooShort && (
        <div className="text-xs text-emerald-400 mt-1 flex items-center gap-1"><CheckCircle2 size={12} /> {state.promo.percentOff ? t('hosting.promo.pct', '{pct}% off applied').replace('{pct}', state.promo.percentOff) : state.promo.freeMonths ? t('hosting.promo.free', 'First {n} months free').replace('{n}', state.promo.freeMonths) : t('hosting.promo.ok', 'Code applied.')}</div>
      )}
      {termTooShort && <div className="text-xs text-amber-400 mt-1 flex items-center gap-1"><AlertTriangle size={12} /> {t('hosting.promo.minmonths', 'This code needs a {n}+ month term.').replace('{n}', state.promo.minMonths)}</div>}
    </div>
  );
}

export function Hosting() {
  const { user } = useAuth(); const nav = useNavigate(); const dialog = useDialog(); const toast = useToast(); const { t } = useI18n();
  const plans = useAsync(() => api.get('/hosting/plans'), []);
  const cap = useAsync(() => api.get('/hosting/capacity'), []);
  const [customOpen, setCustomOpen] = useState(false);
  const [mode, setMode] = useState('single'); // single = one repo; multi = a shared storage pool
  const [months, setMonths] = useState(12); // prepaid term (1yr recommended)
  const [promo, setPromo] = useState(null); // validated promo code for the simple plan-card checkout
  const TERM_DISC = { 1: 0, 3: 0.05, 6: 0.10, 12: 0.20, 24: 0.35 };
  const termTotal = (monthlyCents) => {
    let total = Math.round(monthlyCents * months * (1 - (TERM_DISC[months] || 0)));
    if (promo?.percentOff) total = Math.round(total * (1 - promo.percentOff / 100));
    return total;
  };
  const checkout = async (body) => {
    if (!user) return nav('/auth');
    const repoName = await dialog.prompt({ title: mode === 'multi' ? t('hosting.pool.title', 'New storage pool') : t('hosting.repo.title', 'Host a repo'), label: mode === 'multi' ? t('hosting.pool.label', 'Pool name') : t('hosting.repo.label', 'Repository name'), placeholder: mode === 'multi' ? t('hosting.pool.ph', 'my-pool') : t('hosting.repo.ph', 'my-awesome-repo'), okLabel: t('hosting.continue', 'Continue to payment') });
    if (!repoName) return;
    try {
      const res = await api.post('/hosting/checkout', { promoCode: promo?.code, ...body, repoName, mode, months });
      // A $0 plan (the free tier, or a discount that zeroes it out) is provisioned
      // directly — there's no Stripe session/url to redirect to.
      if (res?.free) { toast.success(t('hosting.freeplan.provisioned', 'Your repo "{name}" is provisioning — free tier, no charge.').replace('{name}', repoName)); return nav('/dashboard'); }
      window.location = res.url;
    } catch (x) {
      if (x.data?.error === 'creator_link_required') { toast.error(t('hosting.err.link', 'Link a BMM creator id first (Profile → Creator IDs) to host a repo.')); return nav('/profile'); }
      const e = x.data?.error;
      toast.error(e === 'capacity_full' ? t('hosting.err.capacity', 'No capacity available right now.')
        : e === 'free_tier_full' ? t('hosting.err.freetierfull', 'The free plan is sold out right now — every free slot is taken. Try a paid plan, or check back later.')
        : e === 'free_tier_already_used' ? t('hosting.err.freeused', "You've already used your one free repo (per account and per linked creator id) — pick a paid plan instead.")
        : e === 'stripe_not_configured' ? t('hosting.err.stripe', 'Payments not configured yet.') : t('hosting.err.checkout', 'Checkout failed.'));
    }
  };
  const c = cap.data?.capacity;
  // Fully sold out — the whole pool is spoken for (or hosting is disabled by an
  // admin). Nothing at all can be bought until an existing repo shrinks/expires.
  const soldOut = !!c && (c.enabled === false || c.freeGB <= 0.01);
  return (
    <div>
      <PageHeader icon={Rocket} title={t('hosting.title', 'Host a Server-Repo')} subtitle={t('hosting.sub', 'We run it, you manage it. Pay for the size you need.')} />

      {soldOut && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/8 p-4 mb-6 flex items-start gap-3">
          <AlertTriangle size={20} className="text-red-400 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-red-400">{t('hosting.soldout', 'No hosting space available right now')}</div>
            <div className="text-sm text-[var(--muted)] mt-0.5">{t('hosting.soldout.d', 'Every plan is sold out until an existing repo frees up space or an admin raises the total capacity. Try again later.')}</div>
          </div>
        </div>
      )}

      {/* single vs multi repo */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        {[['single', HardDrive, t('hosting.single', 'Single repo'), t('hosting.single.d', 'One repository with the whole quota.')], ['multi', Boxes, t('hosting.multi', 'Multiple repos'), t('hosting.multi.d', 'Split the storage across several repos, managed by you.')]].map(([m, I, title, sub]) => (
          <button key={m} onClick={() => setMode(m)} className={`flex-1 text-left card p-4 flex items-start gap-3 transition ${mode === m ? 'border-[var(--primary)] ring-1 ring-[var(--primary)]' : 'hover:border-[var(--line-strong)]'}`}>
            <span className={`grid place-items-center w-9 h-9 rounded-lg shrink-0 ${mode === m ? 'bg-gradient-to-br from-orange-500 to-amber-500 text-white' : 'bg-[var(--surface-2)] text-[var(--muted)]'}`}><I size={16} /></span>
            <span><span className="font-semibold flex items-center gap-2">{title}{mode === m && <CheckCircle2 size={14} className="text-[var(--primary-2)]" />}</span><span className="block text-xs text-[var(--muted)] mt-0.5">{sub}</span></span>
          </button>
        ))}
      </div>

      {/* prepaid billing term — custom dropdown */}
      <div className="mb-4 max-w-md">
        <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-2">{t('hosting.term', 'Billing term')} <span className="normal-case font-normal">{t('hosting.term.note', '· prepaid, min 1 month')}</span></div>
        <TermSelect months={months} setMonths={setMonths} termDisc={TERM_DISC} t={t} />
      </div>
      <div className="mb-6 max-w-md">
        <PromoCodeField months={months} onChange={setPromo} />
      </div>

      {c && <Card className="p-4 mb-6 flex items-center gap-4 text-sm"><Gauge size={18} className="text-[var(--primary-2)]" />
        <div className="flex-1"><div className="h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className="h-full bg-gradient-to-r from-orange-500 to-amber-500" style={{ width: `${c.usableGB ? 100 - (c.freeGB / c.usableGB) * 100 : 0}%` }} /></div></div>
        <span className="text-[var(--muted)] whitespace-nowrap">{c.freeGB.toFixed(0)} / {c.usableGB.toFixed(0)} GB {t('hosting.free', 'free')}</span></Card>}
      {/* Free tier — a real $0 plan, called out on its own instead of blending into
          the paid grid below (it isn't really "one of the four tiers", it's the
          answer to "can I try this for free?"). Paid plans never draw from this
          pool — it's tracked completely separately from Total capacity above —
          and a free repo can always be upgraded to a bigger paid size later (the
          free floor keeps applying, so you're only ever billed for the excess). */}
      {!plans.loading && (() => {
        const free = (plans.data?.plans || []).find((pl) => pl.priceMonthlyCents === 0);
        if (!free) return null;
        const freeTierSoldOut = !!c && c.freeTierCapEnabled && c.freeTierFreeGB <= 0.01;
        const freeDisabled = soldOut || freeTierSoldOut || (!!c && free.storageGB > c.freeGB);
        const freeTierPct = c?.freeTierCapEnabled && c.freeTierCapGB ? Math.min(100, (c.freeTierUsedGB / c.freeTierCapGB) * 100) : null;
        return (
          <Card className="p-5 mb-4 border-emerald-500/30 bg-emerald-500/[0.06] overflow-hidden relative">
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <span className="grid place-items-center w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 text-white shrink-0 shadow-lg shadow-emerald-500/25"><Gift size={22} /></span>
              <div className="flex-1 text-center sm:text-left min-w-0">
                <div className="font-semibold text-lg flex items-center justify-center sm:justify-start gap-2 flex-wrap">{t('hosting.freeplan.title', 'Just want to try it out?')} <Badge tone="green">{t('hosting.freeplan.badge', 'FREE')}</Badge></div>
                <div className="text-sm text-[var(--muted)]">{t('hosting.freeplan.sub', 'Host a small repo at no cost — {gb} GB storage, {mbps} Mbps upload, forever free.').replace('{gb}', free.storageGB).replace('{mbps}', (free.uploadLimitKbps / 1024).toFixed(1))}</div>
                <div className="text-xs text-[var(--faint)] mt-1">{t('hosting.freeplan.note', 'One free repo per account. You can always upgrade the size later — the free floor still applies, so you only ever pay for what\'s above it.')}</div>
              </div>
              <Button variant="primary" className="!bg-emerald-600 hover:!bg-emerald-500 !border-emerald-600 shrink-0" disabled={freeDisabled} onClick={() => checkout({ planId: free.id })}>
                <Gift size={16} /> {freeTierSoldOut ? t('hosting.freeplan.soldout', 'Free plan sold out') : freeDisabled ? t('hosting.nospace', 'Not enough space') : t('hosting.freeplan.cta', 'Get it free')}</Button>
            </div>
            {freeTierPct != null && (
              <div className="mt-4 pt-3 border-t border-emerald-500/15">
                <div className="flex items-center justify-between text-xs text-[var(--muted)] mb-1">
                  <span>{t('hosting.freeplan.pool', 'Free-tier pool remaining')}</span>
                  <span className="font-medium tabular-nums">{c.freeTierFreeGB.toFixed(1)} / {c.freeTierCapGB} GB</span>
                </div>
                <div className="h-1.5 rounded-full bg-emerald-500/15 overflow-hidden"><div className={`h-full ${freeTierPct > 90 ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${freeTierPct}%` }} /></div>
              </div>
            )}
          </Card>
        );
      })()}

      {plans.loading ? <Loading /> : <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {(plans.data?.plans || []).filter((pl) => pl.priceMonthlyCents > 0).map((pl) => {
          // A plan can be individually unavailable (not enough free space for ITS
          // size) even while the pool isn't fully soldOut — disable just that card.
          const planDisabled = soldOut || (!!c && pl.storageGB > c.freeGB);
          const recommended = pl.storageGB === 25;
          return (
          <div key={pl.id} role="button" tabIndex={0} aria-disabled={planDisabled} onClick={() => !planDisabled && checkout({ planId: pl.id })}
            onKeyDown={(e) => { if (e.key === 'Enter' && !planDisabled) checkout({ planId: pl.id }); }}
            className={`group card p-6 text-center relative transition-all duration-200 ${planDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:-translate-y-1.5'} ${recommended && !planDisabled ? 'md:scale-105 md:-my-1' : ''}`}
            style={recommended && !planDisabled ? { borderColor: 'var(--primary)', boxShadow: '0 0 0 1px var(--primary), 0 18px 50px -18px var(--primary-glow)' } : undefined}
            onMouseEnter={(e) => { if (!recommended && !planDisabled) e.currentTarget.style.boxShadow = '0 0 0 1px var(--primary), 0 22px 55px -22px var(--primary-glow)'; }}
            onMouseLeave={(e) => { if (!recommended) e.currentTarget.style.boxShadow = ''; }}>
            {recommended && !planDisabled && <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide text-white flex items-center gap-1.5 bg-gradient-to-r from-orange-500 to-amber-500 whitespace-nowrap" style={{ boxShadow: '0 6px 18px -4px var(--primary-glow), 0 0 0 3px var(--bg-solid)' }}><Star size={11} className="fill-white" /> {t('hosting.popular', 'RECOMMENDED')}</div>}
            <HardDrive size={22} className="mx-auto text-[var(--primary-2)] transition-transform group-hover:scale-110" />
            <div className="text-4xl font-extrabold mt-3">{pl.storageGB}<span className="text-base font-medium text-[var(--muted)]"> GB</span></div>
            <div className="text-xs text-[var(--faint)] mt-2 flex items-center justify-center gap-3"><span className="flex items-center gap-1"><Zap size={12} />{(pl.uploadLimitKbps / 1024).toFixed(0)}Mbps</span><span className="flex items-center gap-1"><Cpu size={12} />{pl.cpuShare}</span></div>
            <div className="text-2xl font-bold gradient-text mt-4">${(termTotal(pl.priceMonthlyCents) / 100 / months).toFixed(2)}<span className="text-sm text-[var(--muted)] font-medium">{t('hosting.permo', '/mo')}</span></div>
            <div className="text-[11px] text-[var(--muted)] mb-4">{months > 1 ? <>${(termTotal(pl.priceMonthlyCents) / 100).toFixed(2)} {t('hosting.billedfor', 'billed for')} {months} {t('hosting.mo', 'mo')}</> : t('hosting.billedmonthly', 'billed monthly')}</div>
            <Button variant={recommended && !planDisabled ? 'primary' : 'default'} disabled={planDisabled} className="w-full group-hover:opacity-95" onClick={(e) => { e.stopPropagation(); checkout({ planId: pl.id }); }}>
              {planDisabled ? t('hosting.nospace', 'Not enough space') : t('hosting.gethosted', 'Get hosted')}</Button>
          </div>
          ); })}
      </div>}

      {/* Custom plan */}
      <Card className="p-6 mt-4 flex flex-col sm:flex-row items-center gap-4 bg-gradient-to-r from-orange-500/10 to-transparent">
        <Sliders size={26} className="text-[var(--primary-2)]" />
        <div className="flex-1 text-center sm:text-left"><div className="font-semibold text-lg">{t('hosting.custom.title', 'Need a different size?')}</div>
          <div className="text-sm text-[var(--muted)]">{t('hosting.custom.sub', 'Build a custom plan — pick your storage, upload speed and CPU. Price adapts instantly.')}</div></div>
        <Button variant="primary" disabled={soldOut} onClick={() => setCustomOpen(true)}><Sliders size={16} /> {soldOut ? t('hosting.soldout.short', 'Sold out') : t('hosting.custom.cta', 'Build custom plan')}</Button>
      </Card>

      <p className="text-xs text-[var(--faint)] mt-5 flex items-center gap-1.5"><ShieldCheck size={13} /> {t('hosting.note', 'Updates only require a valid SHA. We set the upload limit per repo.')}</p>
      <CustomPlanModal open={customOpen} onClose={() => setCustomOpen(false)} months={months} setMonths={setMonths} termDisc={TERM_DISC} onCheckout={(custom, promoCode) => { setCustomOpen(false); checkout({ custom, promoCode }); }} />
    </div>
  );
}

function CustomPlanModal({ open, onClose, onCheckout, months = 12, setMonths, termDisc = { 1: 0, 3: 0.05, 6: 0.10, 12: 0.20, 24: 0.35 } }) {
  const { t } = useI18n();
  const [spec, setSpec] = useState({ storageGB: 20, uploadMbps: 8, cpuShare: 0.5 });
  const [price, setPrice] = useState(null);
  const [promo, setPromo] = useState(null);
  const disc = termDisc[months] || 0;
  const afterTerm = price == null ? null : Math.round(price * months * (1 - disc));
  const termTotal = afterTerm == null ? null : promo?.percentOff ? Math.round(afterTerm * (1 - promo.percentOff / 100)) : afterTerm;
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => {
      api.get(`/hosting/price?${new URLSearchParams({ storageGB: spec.storageGB, uploadMbps: spec.uploadMbps, cpuShare: spec.cpuShare })}`)
        .then((r) => setPrice(r.priceMonthlyCents)).catch(() => setPrice(null));
    }, 200);
    return () => clearTimeout(id);
  }, [open, spec]);
  const sliders = [
    { key: 'storageGB', label: t('hosting.s.storage', 'Storage'), min: 1, max: 200, step: 1, fmt: (v) => `${v} GB`, icon: HardDrive },
    { key: 'uploadMbps', label: t('hosting.s.upload', 'Upload speed'), min: 1, max: 200, step: 1, fmt: (v) => `${v} Mbps`, icon: Zap },
    { key: 'cpuShare', label: t('hosting.s.cpu', 'CPU share'), min: 0.1, max: 4, step: 0.1, fmt: (v) => `${v} vCPU`, icon: Cpu },
  ];
  return (
    <Modal open={open} onClose={onClose} title={t('hosting.custom.modaltitle', 'Build a custom plan')} icon={Sliders} width="max-w-lg"
      footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button><Button variant="primary" onClick={() => onCheckout(spec, promo?.code)}>{t('hosting.continue', 'Continue to payment')}</Button></>}>
      <div className="space-y-5">
        {/* Live spec summary chips — see the whole plan at a glance while dragging */}
        <div className="flex flex-wrap gap-2">
          {sliders.map((s) => <Badge key={s.key} tone="primary"><s.icon size={11} /> {s.fmt(spec[s.key])}</Badge>)}
        </div>
        {sliders.map((s) => (
          <div key={s.key}>
            <div className="flex items-center justify-between mb-1.5 text-sm"><span className="flex items-center gap-1.5 text-[var(--muted)]"><s.icon size={14} /> {s.label}</span><span className="font-semibold">{s.fmt(spec[s.key])}</span></div>
            <input type="range" min={s.min} max={s.max} step={s.step} value={spec[s.key]} className="bcw-range"
              onChange={(e) => setSpec({ ...spec, [s.key]: Number(e.target.value) })} />
          </div>
        ))}

        {/* prepaid term — same discounts, as a dropdown */}
        <div>
          <div className="text-sm text-[var(--muted)] mb-1.5 flex items-center gap-1.5"><Receipt size={14} /> {t('hosting.term', 'Billing term')}</div>
          <TermSelect months={months} setMonths={setMonths} termDisc={termDisc} t={t} />
        </div>

        <div>
          <div className="text-sm text-[var(--muted)] mb-1.5 flex items-center gap-1.5"><Ticket size={14} /> {t('hosting.promo.label', 'Promo code')}</div>
          <PromoCodeField months={months} onChange={setPromo} />
        </div>

        <div className="pt-3 border-t border-[var(--line)] space-y-1.5">
          {price != null && (
            <div className="flex items-center justify-between text-xs text-[var(--faint)]">
              <span>{t('hosting.baseprice', 'Base price')}</span>
              <span className={disc > 0 || promo?.percentOff ? 'line-through' : ''}>${(price * months / 100).toFixed(2)}</span>
            </div>
          )}
          {disc > 0 && <div className="flex items-center justify-between text-xs text-emerald-400"><span>{t('hosting.termdiscount', 'Term discount')}</span><span>−{Math.round(disc * 100)}%</span></div>}
          {promo?.percentOff && <div className="flex items-center justify-between text-xs text-emerald-400"><span>{t('hosting.promo.label', 'Promo code')} ({promo.code})</span><span>−{promo.percentOff}%</span></div>}
          <div className="flex items-end justify-between pt-1.5">
            <div>
              <span className="text-sm text-[var(--muted)]">{t('hosting.estprice', 'Estimated price')}</span>
              {termTotal != null && months > 1 && <div className="text-xs text-[var(--faint)] mt-0.5">${(termTotal / 100).toFixed(2)} {t('hosting.billedfor', 'billed for')} {months} {t('hosting.mo', 'mo')}</div>}
            </div>
            <span className="text-3xl font-bold gradient-text">{termTotal == null ? '—' : `$${(termTotal / 100 / months).toFixed(2)}`}<span className="text-sm text-[var(--muted)] font-medium">{t('hosting.permo', '/mo')}</span></span>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ─────────────────────────  Installer  ───────────────────────── */
export function Installer() {
  const { t } = useI18n();
  const feats = [[Zap, t('inst.feat1', 'Fast & lightweight'), t('inst.feat1.d', 'A native installer that gets out of your way.')],
    [ShieldCheck, t('inst.feat2', 'Signed & verified'), t('inst.feat2.d', 'Integrity-checked payloads, every release.')],
    [GitBranch, t('inst.feat3', 'Smart updates'), t('inst.feat3.d', 'Delta updates keep downloads tiny.')],
    [Settings2, t('inst.feat4', 'Full control'), t('inst.feat4.d', 'Pick components, paths and channels.')]];
  return (
    <div>
      <section className="text-center py-10">
        <div className="inline-flex items-center gap-2 badge badge-primary mb-5"><Download size={13} /> BetterInstaller</div>
        <h1 className="text-4xl md:text-5xl font-extrabold">{t('inst.hero1', 'The modern installer')}<br />{t('inst.hero2', 'for the')} <span className="gradient-text">Better*</span>{t('inst.hero3', ' suite.')}</h1>
        <p className="text-[var(--muted)] text-lg max-w-xl mx-auto mt-5">{t('inst.sub', 'A fast, secure NSIS/MSI replacement with a clean UI, delta updates and a handoff contract with the app.')}</p>
        <div className="flex gap-3 justify-center mt-8">
          <Button variant="primary"><Download size={16} /> {t('inst.download', 'Download for Windows')}</Button>
          <Button>{t('inst.releases', 'Release notes')}</Button>
        </div>
        <div className="text-xs text-[var(--faint)] mt-3">{t('inst.platform', 'Windows 10/11 · 64-bit')}</div>
      </section>
      <section className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {feats.map(([I, title, d]) => <Card key={title} className="p-5"><I size={20} className="text-[var(--primary-2)]" /><div className="font-semibold mt-3">{title}</div><div className="text-sm text-[var(--muted)] mt-1">{d}</div></Card>)}
      </section>
      <Card className="p-8 mt-6 text-center bg-gradient-to-b from-orange-500/10 to-transparent">
        <Sparkles size={22} className="mx-auto text-[var(--primary-2)]" />
        <div className="font-semibold text-lg mt-2">{t('inst.dev', 'In active development')}</div>
        <p className="text-sm text-[var(--muted)] mt-1 max-w-md mx-auto">{t('inst.dev.d', 'BetterInstaller is being built as a separate Slint-based app. Follow progress on the blog.')}</p>
      </Card>
    </div>
  );
}

/* ─────────────────────────  Auth  ───────────────────────── */
const OAUTH_ERRORS = {
  bad_state: 'That sign-in link expired — please try again.',
  no_code: 'Sign-in was cancelled.',
  no_email: "We couldn't get a verified email from that account. Try a different sign-in method.",
  token_exchange_failed: 'Sign-in failed — please try again.',
  not_configured: 'That sign-in method isn\'t available right now.',
  unexpected: 'Something went wrong — please try again.',
};

export function Auth() {
  const { user, loading: authLoading, login, loginWith2fa, register } = useAuth(); const nav = useNavigate(); const toast = useToast(); const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const [mode, setMode] = useState('login'); // login | register | forgot | reset
  const [f, setF] = useState({ email: '', password: '', confirm: '', displayName: '', token: '' });
  const [busy, setBusy] = useState(false); const [step, setStep] = useState('');
  const [twoFa, setTwoFa] = useState(null); // { tempToken } once password is verified and a TOTP code is needed
  const [code, setCode] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const { data: oauthProviders } = useAsync(() => api.get('/auth/oauth/providers').catch(() => ({})), []);

  // Already signed in? There's nothing to do on the auth page — send them to
  // their profile (respecting a ?next= target if one was passed, e.g. from a
  // "sign in to continue" link).
  const justRegistered = useRef(false);
  useEffect(() => {
    if (!user) return;
    // A brand-new account is sent straight to the (optional) 2FA setup; an
    // already-logged-in visitor who just hit /auth goes to their profile / ?next.
    if (justRegistered.current) { nav('/profile?setup2fa=1', { replace: true }); return; }
    const next = params.get('next');
    nav(next && next.startsWith('/') ? next : '/profile', { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    const err = params.get('oauth_error');
    if (!err) return;
    toast.error(OAUTH_ERRORS[err] || 'Sign-in failed — please try again.');
    setParams((p) => { p.delete('oauth_error'); return p; }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const submitCode = async () => {
    setBusy(true);
    try { await loginWith2fa(twoFa.tempToken, code.trim()); toast.success(t('auth.welcome.toast')); nav('/dashboard'); }
    catch (x) { toast.error(x.data?.error === '2fa_invalid' ? (t('auth.2fa.bad') || 'Invalid code.') : t('auth.err.fail')); }
    finally { setBusy(false); }
  };

  const submit = async (e) => {
    e.preventDefault();
    if ((mode === 'register' || mode === 'reset') && f.password !== f.confirm) return toast.error(t('auth.err.match'));
    if ((mode === 'register' || mode === 'reset') && f.password.length < 8) return toast.error(t('auth.err.short'));
    setBusy(true);
    try {
      if (mode === 'login') {
        const res = await login(f.email, f.password);
        if (res?.twoFactorRequired) { setTwoFa({ tempToken: res.tempToken }); return; }
        toast.success(t('auth.welcome.toast')); nav('/dashboard');
      }
      else if (mode === 'register') {
        setStep('Solving proof-of-work…');
        const { solvePow } = await import('./pow.js');
        const pow = await solvePow(() => api.get('/auth/pow'));
        setStep('Creating account…');
        justRegistered.current = true; // the auth-redirect effect routes new accounts to the 2FA setup
        await register(f.email, f.password, f.displayName, pow);
        toast.success(t('auth.welcome.toast'));
        // no nav here — the [user] effect above handles it (→ /profile?setup2fa=1)
      } else if (mode === 'forgot') {
        const res = await api.post('/auth/reset/request', { email: f.email });
        if (res.devToken) { setF((s) => ({ ...s, token: res.devToken })); setMode('reset'); toast.info('Reset token issued (dev). Set a new password.'); }
        else toast.success(t('auth.toast.sent'));
      } else if (mode === 'reset') {
        await api.post('/auth/reset/confirm', { token: f.token, password: f.password });
        toast.success(t('auth.toast.updated')); setMode('login'); setF((s) => ({ ...s, password: '', confirm: '', token: '' }));
      }
    } catch (x) {
      toast.error(x.data?.error === 'invalid_credentials' ? t('auth.err.creds')
        : x.data?.error === 'oauth_only_account' ? t('auth.err.oauthOnly', 'This account was created with GitHub or Discord — use that to sign in, or set a password from your profile once signed in.')
        : x.data?.error === 'email_taken' ? t('auth.err.taken')
        : x.data?.error === 'invalid_token' ? t('auth.err.token')
        : x.data?.error === 'pow_required' ? t('auth.err.pow') : t('auth.err.fail'));
    } finally { setBusy(false); setStep(''); }
  };

  const titles = { login: [t('auth.welcome'), t('auth.subin')], register: [t('auth.create'), t('auth.subup')], forgot: [t('auth.reset.title'), t('auth.reset.sub')], reset: [t('auth.newpw.title'), t('auth.newpw.sub')] };
  const cta = { login: t('nav.signin'), register: t('auth.create'), forgot: t('auth.sendreset'), reset: t('auth.updatepw') };
  const pw2 = mode === 'register' || mode === 'reset';

  // Don't flash the login form before we know the auth state. While the session
  // is still resolving (hard load / bookmark), show a neutral spinner; once we
  // know the visitor is signed in, the [user] effect above redirects them to
  // their profile / ?next target, so show a "redirecting" placeholder instead
  // of the full form for a frame.
  if (authLoading) {
    return <div className="max-w-sm mx-auto mt-20 flex justify-center text-[var(--muted)]"><Spinner /></div>;
  }
  if (user) {
    return (
      <div className="max-w-sm mx-auto mt-20 flex flex-col items-center gap-3 text-[var(--muted)]">
        <Spinner />
        <p className="text-sm">{t('auth.redirecting', 'Already signed in — taking you to your profile…')}</p>
      </div>
    );
  }

  if (twoFa) {
    return (
      <div className="max-w-sm mx-auto mt-8">
        <Card className="p-7">
          <div className="text-center mb-6"><ShieldCheck size={32} className="mx-auto text-[var(--primary-2)] mb-3" />
            <h1 className="text-xl font-bold">{t('auth.2fa.title') || 'Two-factor code'}</h1>
            <p className="text-sm text-[var(--muted)] mt-1">{t('auth.2fa.sub') || 'Enter the 6-digit code from your authenticator app.'}</p></div>
          <form onSubmit={(e) => { e.preventDefault(); submitCode(); }} className="space-y-3">
            <Field label={t('auth.2fa.code') || 'Code'}><Input value={code} onChange={(e) => setCode(e.target.value.replace(/[^0-9A-Za-z-]/g, '').slice(0, 9))} placeholder="123456" autoFocus /></Field>
            <Button variant="primary" className="w-full" disabled={busy || code.trim().length < 4}>{busy ? <Spinner /> : (t('auth.2fa.verify') || 'Verify')}</Button>
          </form>
          <div className="mt-4 text-center text-sm"><button className="text-[var(--muted)] hover:text-[var(--text)]" onClick={() => { setTwoFa(null); setCode(''); }}>{t('auth.2fa.back') || 'Back to login'}</button></div>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-sm mx-auto mt-8">
      <Card className="p-7">
        <div className="text-center mb-6"><img src="/logo.png" alt="BC" className="w-12 h-12 rounded-xl mb-3 mx-auto" />
          <h1 className="text-xl font-bold">{titles[mode][0]}</h1>
          <p className="text-sm text-[var(--muted)] mt-1">{titles[mode][1]}</p></div>
        <form onSubmit={submit} className="space-y-3">
          {mode === 'register' && <Field label={t('auth.name')}><Input value={f.displayName} onChange={set('displayName')} /></Field>}
          {mode !== 'reset' && <Field label={t('auth.email')}><Input type="email" value={f.email} onChange={set('email')} placeholder="you@example.com" /></Field>}
          {mode === 'reset' && <Field label={t('auth.token')}><Input value={f.token} onChange={set('token')} placeholder={t('auth.token.ph')} /></Field>}
          {mode !== 'forgot' && <Field label={pw2 ? t('auth.newpw') : t('auth.password')}><Input type="password" value={f.password} onChange={set('password')} placeholder="••••••••" /></Field>}
          {pw2 && <Field label={t('auth.confirmpw')}><Input type="password" value={f.confirm} onChange={set('confirm')} placeholder="••••••••" /></Field>}
          <Button variant="primary" className="w-full" disabled={busy}>{busy ? <><Spinner /> {step || '…'}</> : cta[mode]}</Button>
        </form>
        {(mode === 'login' || mode === 'register') && (oauthProviders?.github || oauthProviders?.discord) && (
          <>
            <div className="flex items-center gap-3 my-4 text-xs text-[var(--faint)]"><div className="flex-1 h-px bg-[var(--line)]" /> {t('auth.or', 'or')} <div className="flex-1 h-px bg-[var(--line)]" /></div>
            <div className="flex flex-col gap-2">
              {oauthProviders.github && <a href="/api/auth/oauth/github/start"><Button className="w-full"><GithubIcon size={16} /> {t('auth.oauth.github', 'Continue with GitHub')}</Button></a>}
              {oauthProviders.discord && <a href="/api/auth/oauth/discord/start"><Button className="w-full"><DiscordIcon size={16} className="text-[#5865F2]" /> {t('auth.oauth.discord', 'Continue with Discord')}</Button></a>}
            </div>
          </>
        )}
        <div className="mt-4 flex flex-col items-center gap-1.5 text-sm">
          {mode === 'login' && <button className="text-[var(--muted)] hover:text-[var(--text)]" onClick={() => setMode('forgot')}>{t('auth.forgot')}</button>}
          <button className="text-[var(--muted)] hover:text-[var(--text)]" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
            {mode === 'login' ? t('auth.toRegister') : t('auth.toLogin')}
          </button>
        </div>
      </Card>
    </div>
  );
}

/* ─────────────────────────  Dashboard  ───────────────────────── */
const SUBMIT_INIT = { projectKey: 'bmm', kind: 'PLUGIN', name: '', description: '', version: '1.0.0', meta: '{}' };

// icon + accent + human "type" label per notification kind. Exported so the
// nav bell menu (App.jsx) and the dashboard panel render them identically.
// `tint` is the soft background of the icon chip; `label` is the small type badge.
export const NOTIF = {
  submission_approved: { icon: CheckCircle2, tone: 'text-emerald-400', tint: 'bg-emerald-500/12', label: 'Approved' },
  submission_rejected: { icon: XCircle, tone: 'text-red-400', tint: 'bg-red-500/12', label: 'Rejected' },
  repo_verified: { icon: ShieldCheck, tone: 'text-emerald-400', tint: 'bg-emerald-500/12', label: 'Verified' },
  repo_published: { icon: CheckCircle2, tone: 'text-emerald-400', tint: 'bg-emerald-500/12', label: 'Published' },
  repo_rejected: { icon: XCircle, tone: 'text-red-400', tint: 'bg-red-500/12', label: 'Rejected' },
  repo_access_granted: { icon: ShieldCheck, tone: 'text-emerald-400', tint: 'bg-emerald-500/12', label: 'Access' },
  repo_renew: { icon: RefreshCw, tone: 'text-[var(--primary-2)]', tint: 'bg-orange-500/12', label: 'Renewal' },
  repo_upgrade: { icon: TrendingUp, tone: 'text-[var(--primary-2)]', tint: 'bg-orange-500/12', label: 'Upgrade' },
  hosting_started: { icon: Rocket, tone: 'text-[var(--primary-2)]', tint: 'bg-orange-500/12', label: 'Hosting' },
  hosting_online: { icon: Server, tone: 'text-emerald-400', tint: 'bg-emerald-500/12', label: 'Online' },
  hosting_stopped: { icon: XCircle, tone: 'text-red-400', tint: 'bg-red-500/12', label: 'Stopped' },
  hosting_expiring: { icon: Clock, tone: 'text-amber-400', tint: 'bg-amber-500/12', label: 'Expiring' },
  announcement: { icon: BellIcon, tone: 'text-[var(--primary-2)]', tint: 'bg-orange-500/12', label: 'Announcement' },
  admin_broadcast: { icon: Send, tone: 'text-[var(--primary-2)]', tint: 'bg-orange-500/12', label: 'Broadcast' },
  feature_active: { icon: Star, tone: 'text-amber-400', tint: 'bg-amber-500/12', label: 'Featured' },
  server_alert: { icon: AlertTriangle, tone: 'text-red-400', tint: 'bg-red-500/12', label: 'Alert' },
  creator_linked: { icon: BadgeCheck, tone: 'text-emerald-400', tint: 'bg-emerald-500/12', label: 'Linked' },
  discord_linked: { icon: BadgeCheck, tone: 'text-[#5865F2]', tint: 'bg-indigo-500/12', label: 'Discord' },
  kofi_reward: { icon: KofiIcon, tone: 'text-orange-400', tint: 'bg-orange-500/12', label: 'Ko-fi' },
  promo_redeemed: { icon: Ticket, tone: 'text-[var(--primary-2)]', tint: 'bg-orange-500/12', label: 'Promo' },
  discount: { icon: Ticket, tone: 'text-[var(--primary-2)]', tint: 'bg-orange-500/12', label: 'Discount' },
  free_hosting: { icon: Gift, tone: 'text-emerald-400', tint: 'bg-emerald-500/12', label: 'Gift' },
  free_boost: { icon: Gift, tone: 'text-amber-400', tint: 'bg-amber-500/12', label: 'Boost' },
};
export const NOTIF_FALLBACK = { icon: Bell, tone: 'text-[var(--primary-2)]', tint: 'bg-orange-500/12', label: 'Update' };
function NotificationsPanel() {
  const dialog = useDialog();
  const { data, loading, reload } = useAsync(() => api.get('/me/notifications'), []);
  const list = data?.notifications || [];
  const unread = list.filter((n) => !n.readAt).length;
  const markAll = async () => { try { await api.post('/me/notifications/read-all'); reload(); } catch {} };
  const markOne = async (n) => { if (!n.readAt) { try { await api.post(`/me/notifications/${n.id}/read`); reload(); } catch {} } };
  const del = async (n) => { try { await api.del(`/me/notifications/${n.id}`); reload(); } catch {} };
  const clearAll = async () => {
    if (!(await dialog.confirm({ title: 'Clear all notifications', message: 'This permanently deletes all of your notifications. Continue?', okLabel: 'Clear all', danger: true }))) return;
    try { await api.del('/me/notifications'); reload(); } catch {}
  };
  const ago = (d) => { const s = (Date.now() - new Date(d)) / 1000; if (s < 60) return 'now'; if (s < 3600) return `${Math.floor(s / 60)}m`; if (s < 86400) return `${Math.floor(s / 3600)}h`; return `${Math.floor(s / 86400)}d`; };
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold flex items-center gap-2"><Bell size={16} /> Notifications {unread > 0 && <Badge tone="primary">{unread}</Badge>}</h2>
        <div className="flex items-center gap-3">
          {unread > 0 && <button className="text-xs text-[var(--primary-2)] flex items-center gap-1" onClick={markAll}><CheckCheck size={13} /> Mark all read</button>}
          {list.length > 0 && <button className="text-xs text-red-400 flex items-center gap-1" onClick={clearAll}><Trash2 size={13} /> Clear all</button>}
        </div>
      </div>
      {loading ? <Loading /> : (list.length ? <div className="space-y-2 max-h-[460px] overflow-auto pr-1">
        {list.map((n) => { const m = NOTIF[n.kind] || NOTIF_FALLBACK; return (
          <Card key={n.id} className={`p-3.5 flex gap-3 group ${!n.readAt ? 'border-[var(--ring)]' : ''}`} onClick={() => markOne(n)} style={{ cursor: n.readAt ? 'default' : 'pointer' }}>
            <span className={`grid place-items-center w-9 h-9 rounded-xl shrink-0 ${m.tint}`}><m.icon size={16} className={m.tone} /></span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className={`text-[10px] font-semibold uppercase tracking-wider ${m.tone}`}>{m.label}</span>
                <span className="text-[11px] text-[var(--faint)]">· {ago(n.createdAt)} ago</span>
              </div>
              <div className={`text-sm break-words [overflow-wrap:anywhere] ${n.readAt ? 'text-[var(--muted)]' : 'text-[var(--text)]'}`}>{n.body}</div>
            </div>
            {!n.readAt && <span className="w-2 h-2 rounded-full bg-[var(--primary)] mt-1.5 shrink-0" />}
            <button className="text-[var(--faint)] hover:text-red-400 opacity-0 group-hover:opacity-100" onClick={(e) => { e.stopPropagation(); del(n); }}><Trash2 size={13} /></button>
          </Card>); })}
      </div> : <EmptyState icon={Bell} title="All caught up" sub="You have no notifications." />)}
    </div>
  );
}

// Gentle, dismissible prompt shown to any signed-in account WITHOUT 2FA — covers
// every path in: a password signup, a GitHub/Discord OAuth signup (they land
// here with no 2FA), and a normal login of an account that never enrolled. One
// tap goes to the 2FA setup; dismissal is per-device so it's never naggy.
const TWOFA_NUDGE_KEY = 'bcw_2fa_nudge_dismissed';
function TwoFactorNudge() {
  const { user } = useAuth(); const { t } = useI18n();
  const [dismissed, setDismissed] = useState(() => { try { return localStorage.getItem(TWOFA_NUDGE_KEY) === '1'; } catch { return false; } });
  if (!user || user.totpEnabled || dismissed) return null;
  const hide = () => { setDismissed(true); try { localStorage.setItem(TWOFA_NUDGE_KEY, '1'); } catch {} };
  return (
    <Card className="p-4 mb-6 flex items-start gap-3 bg-gradient-to-r from-orange-500/12 to-transparent border-[var(--ring)]">
      <span className="grid place-items-center w-10 h-10 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] shrink-0"><ShieldCheck size={18} className="text-[var(--primary-2)]" /></span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold">{t('twofa.nudge.title', 'Secure your account with 2FA')}</div>
        <div className="text-xs text-[var(--muted)] mt-0.5">{t('twofa.nudge.d', 'Add a second factor so a leaked password alone can’t get in. Takes about a minute — it’s optional.')}</div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <Link to="/profile?setup2fa=1"><Button size="sm" variant="primary"><ShieldCheck size={14} /> {t('twofa.nudge.setup', 'Set up')}</Button></Link>
        <button onClick={hide} className="text-[var(--faint)] hover:text-[var(--text)] p-1" title={t('twofa.nudge.later', 'Maybe later')}><X size={16} /></button>
      </div>
    </Card>
  );
}

export function Dashboard() {
  const { user } = useAuth(); const toast = useToast(); const nav = useNavigate(); const { t } = useI18n();
  const items = useAsync(() => api.get('/me/items'), []);
  const repos = useAsync(() => api.get('/me/repos'), []);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null); // the item opened in the view/edit modal
  const cancelDelete = async (it) => { try { await api.post(`/catalog/${it.id}/delete/cancel`); toast.success(t('dash.delcancelled', 'Deletion cancelled.')); items.reload(); } catch { toast.error(t('dash.cancelfail', 'Failed to cancel.')); } };

  // Handle the return trip from a Stripe Checkout redirect (?hosting=ok/cancel, ?feature=ok/cancel).
  const [sp, setSp] = useSearchParams();
  useEffect(() => {
    const hosting = sp.get('hosting'); const feature = sp.get('feature'); const oauth = sp.get('oauth');
    if (!hosting && !feature && !oauth) return;
    if (hosting === 'ok') { toast.success(t('dash.stripe.hostingok', 'Payment received — your repo is being provisioned.')); repos.reload(); items.reload(); }
    else if (hosting === 'cancel') { toast.info(t('dash.stripe.hostingcancel', 'Checkout cancelled — no charge was made.')); }
    if (feature === 'ok') { toast.success(t('dash.stripe.featureok', 'Payment received — your repo is now featured.')); repos.reload(); }
    else if (feature === 'cancel') { toast.info(t('dash.stripe.featurecancel', 'Checkout cancelled — no charge was made.')); }
    if (oauth === 'success') toast.success(t('auth.welcome.toast', 'Welcome!'));
    setSp((p) => { const n = new URLSearchParams(p); n.delete('hosting'); n.delete('feature'); n.delete('oauth'); return n; }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const list = items.data?.items || [];
  const rlist = repos.data?.repos || [];
  const stats = [
    { icon: Package, label: t('dash.items', 'Items'), value: list.length },
    { icon: CheckCircle2, label: t('dash.published', 'Published'), value: list.filter((i) => i.status === 'PUBLISHED').length, tone: 'text-emerald-400' },
    { icon: Clock, label: t('dash.pending', 'Pending'), value: list.filter((i) => i.status === 'PENDING').length, tone: 'text-amber-400' },
    { icon: Server, label: t('dash.repos', 'Repos'), value: rlist.length },
    { icon: Star, label: t('dash.featured', 'Featured'), value: rlist.filter((r) => r.featuredUntil && new Date(r.featuredUntil) > new Date()).length, tone: 'text-amber-400' },
  ];
  // Quick actions — no "Write a post" here (that lives in the Blog for staff).
  const actions = [
    { icon: Upload, label: t('sub.title', 'Submit content'), onClick: () => setOpen(true) },
    { icon: Rocket, label: t('dash.hostrepo', 'Host a repo'), to: '/hosting' },
    { icon: Package, label: t('dash.browse', 'Browse catalog'), to: '/catalog?project=bmm' },
    { icon: LayoutDashboard, label: t('dash.editprofile', 'Edit profile'), to: '/profile' },
  ];
  const tabs = [
    { id: 'overview', label: t('dash.overview', 'Overview'), icon: LayoutDashboard },
    { id: 'items', label: t('dash.myitems', 'My items'), icon: Package, badge: list.length || undefined },
    { id: 'repos', label: t('dash.myrepos', 'My repos'), icon: Server, badge: rlist.length || undefined },
    { id: 'billing', label: t('dash.billing', 'Billing'), icon: Receipt },
  ];
  return (
    <>
      <SideDash icon={LayoutDashboard} title={t('dash.hi', 'Hi, {name}').replace('{name}', user?.displayName || 'there')} subtitle={t('dash.sub', 'Manage your content, repos and billing.')} tabs={tabs}
        headerActions={<Button variant="primary" onClick={() => setOpen(true)}><Upload size={16} /> {t('sub.title', 'Submit content')}</Button>}>
        {(s) => (<>
          {s === 'overview' && <>
            <TwoFactorNudge />
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
              {actions.map((a) => (
                <button key={a.label} onClick={() => a.onClick ? a.onClick() : nav(a.to)} className="card card-hover p-4 text-left flex items-center gap-2.5">
                  <span className="grid place-items-center w-9 h-9 rounded-lg bg-gradient-to-br from-orange-500 to-amber-500"><a.icon size={16} className="text-white" /></span>
                  <span className="text-sm font-medium">{a.label}</span>
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
              {stats.map((st) => <Card key={st.label} className="p-5"><st.icon size={18} className={st.tone || 'text-[var(--primary-2)]'} />
                <div className="text-3xl font-bold mt-3">{st.value}</div><div className="text-xs text-[var(--muted)] mt-0.5">{st.label}</div></Card>)}
            </div>
            <NotificationsPanel />
          </>}

          {s === 'items' && <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold flex items-center gap-2"><Package size={16} /> {t('dash.myitems', 'My items')}</h2>
              <Button size="sm" onClick={() => setOpen(true)}><Upload size={14} /> {t('dash.new', 'New')}</Button>
            </div>
            {items.loading ? <Loading /> : (list.length ? <div className="space-y-2">
              {list.map((it) => { const I = KIND_ICON[it.kind] || Package; const v = it.kind === 'PLUGIN' ? it.meta?.validation : null; return (
                <Card key={it.id} className="p-4 flex items-center gap-3">
                  <I size={18} className="text-[var(--primary-2)] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{it.name}</div>
                    <div className="text-xs text-[var(--faint)] flex items-center gap-2 flex-wrap">
                      <span>{it.kind} · v{it.version}</span>
                      {it.payloadKey && !it.meta?.download_url && <span className="text-[var(--primary-2)]">· {t('dash.hostedhere', 'hosted here')}</span>}
                      {v && (v.valid ? <span className="text-emerald-400 flex items-center gap-1"><BadgeCheck size={12} /> {t('dash.verified', 'verified')}</span> : <span className="text-red-400 flex items-center gap-1"><XCircle size={12} /> {t('dash.invalid', 'invalid')}</span>)}
                    </div>
                  </div>
                  {it.deleteAt
                    ? <><Badge tone="red"><Trash2 size={11} /> {t('dash.deletingin', 'Deleting in')} {fmtRemaining(it.deleteAt)}</Badge>
                        <Button size="sm" variant="ghost" onClick={() => cancelDelete(it)}>{t('common.cancel', 'Cancel')}</Button></>
                    : <><Badge tone={statusTone(it.status)}>{it.status}</Badge>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(it)}><PenSquare size={14} /> <span className="hidden sm:inline">{t('dash.viewedit', 'View / edit')}</span></Button></>}
                </Card>); })}
            </div> : <EmptyState icon={Inbox} title={t('dash.noitems', 'No items yet')} sub={t('dash.noitems.s', 'Submit your first app, plugin, theme or preset.')}>
              <Button variant="primary" onClick={() => setOpen(true)}><Upload size={15} /> {t('sub.title', 'Submit content')}</Button></EmptyState>)}
          </div>}

          {s === 'repos' && <MyRepos />}
          {s === 'billing' && <Billing />}
        </>)}
      </SideDash>

      <SubmitModal open={open} onClose={() => setOpen(false)} onDone={() => { items.reload(); toast.success(t('dash.submitted', 'Submitted — pending moderation.')); }} />
      <ItemEditModal open={!!editing} item={editing} onClose={() => setEditing(null)} onDone={() => items.reload()} />
    </>
  );
}

// View + edit one of your own items. Saving proposes an UPDATE (admin re-validation
// still required) — the item flips back to PENDING until a moderator re-approves it.
// For our-hosted plugins the .bmmplug can be replaced; the new package is re-verified
// (checksums recomputed) before the change can go live again.
function ItemEditModal({ open, item, onClose, onDone }) {
  const toast = useToast(); const { t } = useI18n();
  const [form, setForm] = useState(null);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [confirmCancelHost, setConfirmCancelHost] = useState(false);
  const isPlugin = item?.kind === 'PLUGIN';
  // Any kind we host the payload for ourselves (not just PLUGIN) can be replaced —
  // app/theme/preset submissions are billed by size past the free tier exactly
  // like plugins, so they deserve the same self-service re-upload.
  const ourHosted = !!item?.payloadKey && !item?.meta?.download_url;
  const v = isPlugin ? item?.meta?.validation : null;
  const [quote, setQuote] = useState(null);
  const [cap, setCap] = useState(null); // hosting capacity — re-uploads also draw from the temp margin
  const noSubmitSpace = !!cap && (cap.tempMarginGB - cap.tempUsedGB) <= 0.01;
  useEffect(() => {
    if (file) {
      api.get(`/catalog/hosting-quote?bytes=${file.size}`).then(setQuote).catch(() => setQuote(null));
      api.get('/hosting/capacity').then((r) => setCap(r.capacity)).catch(() => setCap(null));
    } else setQuote(null);
  }, [file]);

  useEffect(() => {
    if (item) {
      const { validation, _prevStatus, ...cleanMeta } = item.meta || {}; // hide server-computed fields
      setForm({ description: item.description || '', version: item.version || '', tags: (item.tags || []).join(', '), meta: JSON.stringify(cleanMeta, null, 2) });
      setFile(null); setConfirmDel(false);
    }
  }, [item]);
  if (!item || !form) return null;
  const I = KIND_ICON[item.kind] || Package;

  const viewPayload = async () => {
    try { const { url } = await api.get(`/me/items/${item.id}/payload`); window.open(url, '_blank'); }
    catch { toast.error(t('ie.nopayload', 'No downloadable payload.')); }
  };
  const save = async () => {
    if (file && noSubmitSpace) return toast.error(t('sub.tempfull', 'Submission storage is full right now — try again once moderation clears space.'));
    let meta; try { meta = JSON.parse(form.meta || '{}'); } catch { return toast.error(t('ie.metajson', 'Metadata must be valid JSON.')); }
    setBusy(true);
    try {
      const patch = { description: form.description, version: form.version, tags: form.tags.split(',').map((s) => s.trim()).filter(Boolean), meta };
      if (file) { patch.payloadKey = await uploadPayload(item.kind, file); patch.payloadSize = file.size; }
      const res = await api.post(`/catalog/${item.id}/update`, patch);
      // A re-upload past the free tier is billed by size → finish payment first;
      // the new file only takes effect once the webhook confirms it's paid.
      if (res?.checkoutUrl) { window.location.href = res.checkoutUrl; return; }
      if (res?.validation && res.validation.valid === false) toast.error(t('ie.savefail', 'Saved, but the new .bmmplug failed validation ({reason}). A moderator will review.').replace('{reason}', res.validation.reason));
      else if (res?.validation?.valid) toast.success(t('ie.saveverified', 'Saved — plugin re-verified. Pending admin re-approval.'));
      else toast.success(t('ie.savepending', 'Saved — changes are pending admin re-approval.'));
      onClose(); onDone();
    } catch (x) { toast.error(x.data?.error || x.message || t('ie.savefail2', 'Failed to save.')); } finally { setBusy(false); }
  };
  const doDelete = async () => {
    setBusy(true);
    try { await api.post(`/catalog/${item.id}/delete`); toast.success(t('ie.scheduled', 'Scheduled for deletion in 72h. Files are kept until then — you can cancel any time.')); onClose(); onDone(); }
    catch (x) { toast.error(x.data?.error || t('ie.delfail', 'Failed to delete.')); } finally { setBusy(false); }
  };
  const cancelDeletion = async () => {
    setBusy(true);
    try { await api.post(`/catalog/${item.id}/delete/cancel`); toast.success(t('dash.delcancelled', 'Deletion cancelled.')); onClose(); onDone(); }
    catch (x) { toast.error(x.data?.error || t('dash.cancelfail', 'Failed to cancel.')); } finally { setBusy(false); }
  };
  const cancelHosting = async () => {
    setBusy(true);
    try { await api.post(`/catalog/${item.id}/hosting/cancel`); toast.success(t('ie.hostcancelled', 'Hosting subscription cancelled — the item is now hidden.')); onClose(); onDone(); }
    catch (x) { toast.error(x.data?.error || t('ie.hostcancelfail', 'Failed to cancel.')); } finally { setBusy(false); }
  };

  const footer = item.deleteAt
    ? <><Button variant="ghost" onClick={onClose}>{t('bill.close', 'Close')}</Button><Button variant="primary" disabled={busy} onClick={cancelDeletion}>{busy ? <Spinner /> : t('ie.canceldel', 'Cancel deletion')}</Button></>
    : <>
        {confirmDel
          ? <span className="flex items-center gap-2 mr-auto text-sm text-[var(--muted)]">{t('ie.delthis', 'Delete this item?')}<Button size="sm" className="!bg-red-500/15 !text-red-400 !border-red-500/30" disabled={busy} onClick={doDelete}>{busy ? <Spinner /> : t('ie.yesdelete', 'Yes, delete')}</Button><Button size="sm" variant="ghost" onClick={() => setConfirmDel(false)}>{t('ie.no', 'No')}</Button></span>
          : <button className="mr-auto text-sm text-red-400/80 hover:text-red-400 flex items-center gap-1.5" onClick={() => setConfirmDel(true)}><Trash2 size={14} /> {t('repos.del.ok', 'Delete')}</button>}
        <Button variant="ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
        <Button variant="primary" disabled={busy || (!!file && noSubmitSpace)} onClick={save}>{busy ? <Spinner /> : t('ie.savereview', 'Save (send for re-review)')}</Button>
      </>;

  return (
    <Modal open={open} onClose={onClose} title={t('ie.title', 'View / edit item')} icon={PenSquare} width="max-w-lg" footer={footer}>
      <div className="flex items-center gap-3 mb-4">
        <div className="grid place-items-center w-11 h-11 rounded-xl bg-gradient-to-br from-orange-500/25 to-amber-500/15 border border-[var(--line)]"><I size={20} className="text-[var(--primary-2)]" /></div>
        <div className="min-w-0"><div className="font-semibold truncate">{item.name}</div>
          <div className="text-xs text-[var(--faint)] flex items-center gap-2"><Badge tone={statusTone(item.status)}>{item.status}</Badge>{item.kind}
            {(item.payloadKey || item.meta?.download_url) && <button onClick={viewPayload} className="text-[var(--primary-2)] hover:underline flex items-center gap-1"><Download size={11} /> payload</button>}</div></div>
      </div>

      {item.deleteAt
        ? <div className="rounded-lg border border-red-500/30 bg-red-500/8 p-2.5 text-xs text-red-400 flex items-start gap-2 mb-4">
            <Trash2 size={13} className="shrink-0 mt-0.5" />
            <span>{t('ie.notice.del1', 'Scheduled for deletion in')} <b>{fmtRemaining(item.deleteAt)}</b>. {t('ie.notice.del2', 'The files are kept until then — cancel below to keep this item.')}</span>
          </div>
        : <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-2.5 text-xs text-[var(--muted)] flex items-start gap-2 mb-4">
            <Lock size={13} className="text-[var(--primary-2)] shrink-0 mt-0.5" />
            <span>{t('ie.notice.edit', 'Editing sends the item back for moderation. The live version stays unchanged until an admin re-approves your changes.')}</span>
          </div>}

      {isPlugin && v && (
        <div className={`rounded-lg p-2.5 text-xs mb-4 flex items-center gap-2 border ${v.valid ? 'bg-emerald-500/8 border-emerald-500/25 text-emerald-400' : 'bg-red-500/8 border-red-500/25 text-red-400'}`}>
          {v.valid ? <BadgeCheck size={14} /> : <XCircle size={14} />}
          <span className="flex-1">{v.valid ? t('ie.pkgok', 'Current package verified — checksums match.') : t('ie.pkgbad', 'Current package invalid: {reason}').replace('{reason}', v.reason)}</span>
          {v.sha256 && <code className="text-[10px] text-[var(--faint)]">{v.sha256.slice(0, 12)}…</code>}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label={t('sub.name', 'Name')} hint={t('ie.noedit', 'Not editable')}><Input value={item.name} disabled /></Field>
        <Field label={t('sub.version', 'Version')}><Input value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} /></Field>
      </div>
      <div className="mt-3"><Field label={t('sub.desc', 'Description')}><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field></div>
      <div className="mt-3"><Field label={t('repos.f.tags', 'Tags')} hint={t('repos.f.tags.hint', 'Comma-separated.')}><Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="backup, utility" /></Field></div>

      {ourHosted && (
        <div className="mt-3">
          <Field label={t('ie.replace', 'Replace file')} hint={t('ie.replace.hint2', 'Optional — uploads a new file, re-verified before it can go live. Billed by size past the free tier.')}>
            <Input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </Field>
          {file && <div className="mt-1.5 text-xs text-[var(--primary-2)] flex items-center gap-1.5"><Upload size={12} /> {file.name} {t('ie.replaces', '— replaces the current file and is re-validated on save.')}</div>}
          {file && noSubmitSpace && (
            <div className="mt-1.5 text-xs text-red-400 flex items-center gap-1.5"><AlertTriangle size={12} /> {t('sub.nospace', 'Submission storage is full right now — every upload is held for moderation and there is no room left. Try again later, or self-host and paste a URL above instead.')}</div>
          )}
          {file && quote && !quote.free && quote.monthlyCents > 0 && (
            <div className="mt-1.5 text-xs text-amber-400/90 flex items-center gap-1.5"><Receipt size={12} /> {t('ie.replacecost', 'This size is billed: {price}/mo — you\'ll be sent to checkout after saving.').replace('{price}', `$${(quote.monthlyCents / 100).toFixed(2)}`)}</div>
          )}
        </div>
      )}
      {ourHosted && item.meta?._hostingSubId && (
        <div className="mt-3 rounded-lg border border-red-500/25 bg-red-500/8 p-2.5 text-xs text-[var(--muted)] flex items-center gap-2 flex-wrap">
          <Receipt size={13} className="text-red-400 shrink-0" />
          <span className="flex-1">{t('ie.hostactive', 'This file is on a recurring monthly hosting subscription.')}</span>
          {confirmCancelHost
            ? <span className="flex items-center gap-2"><span className="text-red-400">{t('ie.hostcancelq', 'Cancel and hide this item?')}</span>
                <Button size="sm" className="!bg-red-500/15 !text-red-400 !border-red-500/30" disabled={busy} onClick={cancelHosting}>{busy ? <Spinner /> : t('ie.yescancel', 'Yes, cancel')}</Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmCancelHost(false)}>{t('ie.no', 'No')}</Button></span>
            : <Button size="sm" variant="ghost" className="!text-red-400" onClick={() => setConfirmCancelHost(true)}>{t('ie.cancelhosting', 'Cancel hosting')}</Button>}
        </div>
      )}
      {isPlugin && !ourHosted && item.meta?.download_url && (
        <div className="mt-3 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-2.5 text-xs text-[var(--muted)]">{t('ie.selfhosted1', 'This plugin is self-hosted. Point')} <code>download_url</code> {t('ie.selfhosted2', '(below) at a new')} <code>.bmmplug</code>{t('ie.selfhosted3', '; it is re-validated on save.')}</div>
      )}

      <div className="mt-3"><div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">{t('sub.metadata', 'Metadata (JSON)')}</div>
        <JsonEditor value={form.meta} onChange={(meta) => setForm({ ...form, meta })} /></div>
    </Modal>
  );
}

// Per-type copy + generator templates so the form adapts to what's being submitted.
const KIND_COPY = {
  APP: { name: 'My companion app', desc: 'A tool that works alongside BMM.', file: 'Payload file (zip / exe)', tmpl: { id: 'my-app', title: 'My App', category: 'utility', price: 'free', tags: [], download: { url: 'https://…/app.exe', file_type: 'exe', sha256: '' } } },
  PLUGIN: { name: 'Auto Backup', desc: 'What does this plugin do?', file: 'Plugin file (.bmmplug)', tmpl: { id: 'auto-backup', download_url: 'https://…/auto-backup.bmmplug', sha256: '', permissions: [] } },
  THEME: { name: 'Midnight Orange', desc: 'A dark, warm UI theme.', file: 'Theme file (.bmmtheme)', tmpl: { author: '', url: 'https://…' } },
  PRESET: { name: 'Afterburner Boom', desc: 'A punchy engine sound preset.', file: 'Preset .json file', tmpl: { name: '', version: '1.0.0', assetPaths: [] } },
};

function SubmitModal({ open, onClose, onDone }) {
  const toast = useToast(); const { t } = useI18n();
  const [form, setForm] = useState(SUBMIT_INIT);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState(null); // { monthlyCents, free } for an our-hosted file
  const [cap, setCap] = useState(null); // hosting capacity — used to pre-empt temp_storage_full
  useEffect(() => { if (open) { setForm(SUBMIT_INIT); setFile(null); setQuote(null); api.get('/hosting/capacity').then((r) => setCap(r.capacity)).catch(() => setCap(null)); } }, [open]);
  // Submission payloads draw from the dedicated temp margin (separate from hosted-
  // repo capacity) — pre-empt the server's temp_storage_full error with a clear banner.
  const noSubmitSpace = !!cap && (cap.tempMarginGB - cap.tempUsedGB) <= 0.01;
  // Our-hosted files of ANY kind (app/plugin/theme/preset) are billed by size once
  // past the free tier — fetch a live quote so the price is never a surprise.
  useEffect(() => {
    if (file && !form.url) {
      api.get(`/catalog/hosting-quote?bytes=${file.size}`).then(setQuote).catch(() => setQuote(null));
    } else setQuote(null);
  }, [file, form.url]);

  const kinds = PROJECT_KINDS[form.projectKey] || ['APP'];
  const copy = KIND_COPY[form.kind] || KIND_COPY.APP;
  const setProject = (projectKey) => setForm((s) => ({ ...s, projectKey, kind: (PROJECT_KINDS[projectKey] || ['APP'])[0] }));
  const deeplink = form.projectKey === 'bmm' ? `bmm://catalog/${form.kind.toLowerCase()}/install?name=${encodeURIComponent(form.name || 'name')}` : '';

  const onFile = async (f) => {
    setFile(f);
    if (f && form.kind === 'PRESET' && /json$/i.test(f.name)) {
      try { const j = JSON.parse(await f.text()); setForm((s) => ({ ...s, meta: JSON.stringify(j, null, 2), name: j.name || s.name, version: j.version || s.version })); }
      catch { toast.error(t('sub.presetjson', 'Preset is not valid JSON.')); }
    }
  };
  // Generator: fill the metadata with a ready-to-edit template for this type.
  const generate = () => {
    const base = { ...copy.tmpl };
    if (form.kind === 'PRESET') base.name = form.name || base.name;
    if (deeplink) base.deeplink = deeplink;
    setForm((s) => ({ ...s, meta: JSON.stringify(base, null, 2) }));
    toast.success(t('sub.tmplgen', 'Template generated — edit the values.'));
  };
  const submit = async () => {
    if (form.name.length < 2) return toast.error(t('sub.namereq', 'Name is required.'));
    if (file && noSubmitSpace) return toast.error(t('sub.tempfull', 'Submission storage is full right now — try again once moderation clears space.'));
    let meta = {}; try { meta = JSON.parse(form.meta || '{}'); } catch { return toast.error(t('sub.metajson', 'Meta must be valid JSON.')); }
    setBusy(true);
    try {
      const { solvePow } = await import('./pow.js');
      const pow = await solvePow(() => api.get('/auth/pow')); // anti-spam proof-of-work
      let payloadKey; if (file) payloadKey = await uploadPayload(form.kind, file);
      const res = await api.post('/catalog', { ...form, tags: [], meta, payloadKey, payloadSize: file?.size, pow });
      // Our-hosted files may require a hosting payment first → redirect to Stripe.
      if (res?.checkoutUrl) { window.location.href = res.checkoutUrl; return; }
      onClose();
      // Plugins are SHA-verified on submit; warn the user if the checksum failed.
      if (res?.validation && res.validation.valid === false) toast.error(t('sub.checksum.fail', 'Submitted, but the plugin failed checksum verification ({reason}). A moderator will review it.').replace('{reason}', res.validation.reason));
      else if (res?.validation?.valid) toast.success(t('sub.checksum.ok', 'Checksum verified — sent to moderators.'));
      onDone();
    } catch (x) {
      const e = x.data?.error;
      toast.error(e === 'stripe_not_configured' ? t('sub.hostunavail', 'Hosting payment is unavailable right now.')
        : e === 'temp_storage_full' ? t('sub.tempfull', 'Submission storage is full right now — try again once moderation clears space.')
        : e === 'too_many_pending' ? t('sub.toomanypending', 'You already have {n} submissions awaiting review — wait for moderation before submitting more.').replace('{n}', String(x.data?.max ?? 5))
        : e === 'free_tier_full' ? t('sub.freetierfull', 'Free hosting for catalog files is full right now — try again later, or self-host and paste a URL instead.')
        : e === 'free_tier_already_used' ? t('sub.freeused', "You've already used your one free hosted upload (per account and per linked creator id) — self-host and paste a URL instead, or pay for hosting.")
        : e || x.message || t('repos.failed', 'Failed.'));
    } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={t('sub.title', 'Submit content')} icon={Upload} width="max-w-lg"
      footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button><Button variant="primary" disabled={busy || (!!file && noSubmitSpace)} onClick={submit}>{busy ? <Spinner /> : t('sub.forreview', 'Submit for review')}</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('sub.project', 'Project')}><Select value={form.projectKey} onChange={(e) => setProject(e.target.value)}><option value="bmm">BMM</option><option value="bsm">BSM</option></Select></Field>
        <Field label={t('sub.type', 'Type')}><Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>{kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</Select></Field>
        <Field label={t('sub.name', 'Name')}><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={copy.name} /></Field>
        <Field label={t('sub.version', 'Version')}><Input value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} /></Field>
      </div>
      <div className="mt-3"><Field label={t('sub.desc', 'Description')}><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder={copy.desc} /></Field></div>
      <div className="mt-3"><Field label={copy.file} hint={t('sub.filehint', 'Uploaded directly to storage — the download link is auto-configured.')}>
        <Input type="file" accept={form.kind === 'PRESET' ? '.json,application/json' : undefined} onChange={(e) => onFile(e.target.files?.[0] || null)} /></Field></div>
      {file && noSubmitSpace && (
        <div className="mt-2 rounded-lg border border-red-500/30 bg-red-500/8 p-2.5 text-xs text-red-400 flex items-start gap-2">
          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
          <span>{t('sub.nospace', 'Submission storage is full right now — every upload is held for moderation and there is no room left. Try again later, or self-host and paste a URL above instead.')}</span>
        </div>
      )}
      {quote && !quote.free && quote.monthlyCents > 0 && (
        <div className="mt-2 rounded-lg border border-[var(--line)] bg-orange-500/[0.06] p-2.5 text-xs text-[var(--muted)] flex items-start gap-2">
          <Receipt size={13} className="text-[var(--primary-2)] shrink-0 mt-0.5" />
          <span>{t('sub.quote', 'Hosting this {size} MB file with us is billed by size: {price}. You will be sent to checkout; it then enters moderation. Prefer to self-host? Paste a URL above instead.').replace('{size}', (file.size / 1e6).toFixed(1)).replace('{price}', `$${(quote.monthlyCents / 100).toFixed(2)}/mo`)}</span>
        </div>
      )}
      {form.projectKey === 'bmm' && <div className="mt-3 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-2.5 text-xs flex items-center gap-2"><Link2 size={13} className="text-[var(--primary-2)] shrink-0" /><code className="truncate text-[var(--muted)]">{deeplink}</code></div>}
      <div className="mt-3">
        <div className="flex items-center justify-between mb-1.5"><label className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)]">{t('sub.metadata', 'Metadata (JSON)')}</label>
          <button type="button" onClick={generate} className="btn btn-sm"><Wand2 size={13} /> {t('sub.gentmpl', 'Generate template')}</button></div>
        <JsonEditor value={form.meta} onChange={(meta) => setForm({ ...form, meta })} />
      </div>
    </Modal>
  );
}

/* ─────────────────────────  Admin  ───────────────────────── */
export function Admin() {
  const { user } = useAuth(); const dialog = useDialog(); const toast = useToast();
  const [modQ, setModQ] = useState(''); const [modQApplied, setModQApplied] = useState('');
  const [modSort, setModSort] = useState('oldest'); const [modKind, setModKind] = useState(''); const [modType, setModType] = useState('');
  const subs = useAsync(() => api.get(`/mod/submissions?q=${encodeURIComponent(modQApplied)}&sort=${modSort}&kind=${modKind}&type=${modType}`), [modQApplied, modSort, modKind, modType]);
  const approve = async (s) => { try { await api.post(`/mod/submissions/${s.id}/approve`); toast.success(`Approved "${s.item?.name}".`); subs.reload(); } catch { toast.error('Failed.'); } };
  const reject = async (s) => {
    const reason = await dialog.prompt({ title: 'Reject submission', label: 'Reason (sent to the author)', placeholder: 'Why is this rejected?', okLabel: 'Reject', danger: true });
    if (!reason) return;
    try { await api.post(`/mod/submissions/${s.id}/reject`, { reason }); toast.success('Rejected and author notified.'); subs.reload(); } catch { toast.error('Failed.'); }
  };
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPERADMIN';
  const isSuperAdmin = user?.role === 'SUPERADMIN';
  const queue = subs.data?.submissions || [];
  const [review, setReview] = useState(null);
  const tabs = [
    { heading: 'Moderation' },
    { id: 'moderation', label: 'Moderation', icon: Inbox, badge: queue.length || undefined },
    { id: 'messages', label: 'Messages', icon: Mail },

    { heading: 'Users & access' },
    { id: 'users', label: 'Users', icon: Users },
    { id: 'planusers', label: 'Free vs paid', icon: Receipt },
    isSuperAdmin && { id: 'roles', label: 'Roles & access', icon: Shield },
    isAdmin && { id: 'blogaccess', label: 'Blog access', icon: PenSquare },
    isAdmin && { id: 'security', label: 'Security log', icon: Lock },

    { heading: 'Repos & hosting' },
    { id: 'repos', label: 'Server repos', icon: Server },
    isAdmin && { id: 'hosting', label: 'Free hosting', icon: Rocket },
    isAdmin && { id: 'promo', label: 'Promo codes', icon: Ticket },
    isAdmin && { id: 'storage', label: 'Storage', icon: HardDrive },

    isAdmin && { heading: 'Content' },
    isAdmin && { id: 'catalogs', label: 'Catalogs', icon: Boxes },
    isAdmin && { id: 'projects', label: 'Projects', icon: Settings2 },
    isAdmin && { id: 'showcase', label: 'Other projects', icon: Sparkles },
    isAdmin && { id: 'announcements', label: 'Announcements', icon: BellIcon },

    isAdmin && { heading: 'Server' },
    isAdmin && { id: 'serverperf', label: 'Server perf', icon: Cpu },
    isAdmin && { id: 'serveradv', label: 'Advanced server', icon: AlertTriangle },

    isAdmin && { heading: 'Bot & analytics' },
    isAdmin && { id: 'bot', label: 'Discord bot', icon: MessageSquare },
    isAdmin && { id: 'analytics', label: 'Analytics', icon: TrendingUp },

    isAdmin && { heading: 'Settings' },
    isAdmin && { id: 'settings', label: 'Settings', icon: Sliders },
  ].filter(Boolean);
  return (
    <SideDash icon={ShieldCheck} title="Admin" subtitle="Moderation, catalogs, hosting, analytics and settings." tabs={tabs}>
      {(s) => (<>
        {s === 'moderation' && <div>
          <h2 className="font-semibold mb-3 flex items-center gap-2"><Inbox size={16} /> Moderation queue</h2>
          <div className="flex flex-wrap gap-2 mb-3">
            <div className="relative flex-1 min-w-[200px]"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
              <Input className="!pl-9" placeholder="Search by item name, author or email…" value={modQ} onChange={(e) => setModQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setModQApplied(modQ)} /></div>
            <Button variant="primary" onClick={() => setModQApplied(modQ)}><Search size={15} /> Search</Button>
            <Select className="!w-auto" value={modKind} onChange={(e) => setModKind(e.target.value)}>
              <option value="">All kinds</option><option value="APP">App</option><option value="PLUGIN">Plugin</option><option value="THEME">Theme</option><option value="PRESET">Preset</option>
            </Select>
            <Select className="!w-auto" value={modType} onChange={(e) => setModType(e.target.value)}>
              <option value="">All types</option><option value="NEW">New</option><option value="UPDATE">Update</option>
            </Select>
            <Select className="!w-auto" value={modSort} onChange={(e) => setModSort(e.target.value)}>
              <option value="oldest">Oldest first</option><option value="newest">Newest first</option>
            </Select>
          </div>
          {subs.loading ? <Loading /> : (queue.length ? <div className="space-y-2">
            {queue.map((sub) => { const I = KIND_ICON[sub.item?.kind] || Package; return (
              <Card key={sub.id} className="p-4 flex items-center gap-3"><I size={18} className="text-[var(--primary-2)]" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{sub.item?.name} {sub.item?.version && <span className="text-xs text-[var(--faint)] font-normal">v{sub.item.version}</span>}</div>
                  <div className="text-xs text-[var(--faint)] flex items-center gap-1.5 flex-wrap">
                    <Badge>{sub.type}</Badge> <Badge tone="primary">{sub.item?.kind}</Badge> {sub.item?.project?.key && <span className="uppercase">{sub.item.project.key}</span>} · {sub.item?.owner?.displayName || '—'}
                    {sub.tags?.map((tg) => <Badge key={tg} tone="amber"><Tag size={9} /> {tg}</Badge>)}
                    {sub.comments?.length > 0 && <span className="flex items-center gap-1 text-[var(--faint)]"><MessageSquare size={11} /> {sub.comments.length}</span>}
                  </div>
                </div>
                <Button size="sm" onClick={() => setReview(sub)}><Eye size={15} /> Review</Button>
                <Button size="sm" variant="primary" onClick={() => approve(sub)}><CheckCircle2 size={15} /> Approve</Button>
                <Button size="sm" onClick={() => reject(sub)}><XCircle size={15} /> Reject</Button></Card>); })}
          </div> : <EmptyState icon={CheckCircle2} title="Queue is empty" sub="Nothing waiting for review." />)}
          {review && <SubmissionReview sub={review} onClose={() => setReview(null)} onApprove={() => { approve(review); setReview(null); }} onReject={() => { reject(review); setReview(null); }} reload={subs.reload} />}
        </div>}
        {s === 'messages' && <AdminMessages />}
        {s === 'users' && <AdminUsers />}
        {s === 'planusers' && <AdminPlanUsers />}
        {s === 'roles' && <AdminRoles />}
        {s === 'blogaccess' && <AdminBlogAccess />}
        {s === 'security' && <AdminSecurity />}
        {s === 'serverperf' && <AdminServerPerf />}
        {s === 'serveradv' && <AdminServerAdvanced />}
        {s === 'announcements' && <AdminAnnouncements />}
        {s === 'repos' && <AdminRepos />}
        {s === 'catalogs' && <><AdminCatalogCreator /><PluginVerifier /><ThemeVerifier /></>}
        {s === 'hosting' && <AdminFreeHost />}
        {s === 'promo' && <AdminPromo />}
        {s === 'storage' && <AdminStorage />}
        {s === 'bot' && <AdminBot />}
        {s === 'analytics' && <AdminAnalytics />}
        {s === 'projects' && <AdminProjects />}
        {s === 'showcase' && <AdminShowcase />}
        {s === 'settings' && <AdminSettings />}
      </>)}
    </SideDash>
  );
}

// Kinds available per project. BSM = presets only; everything else is BMM.
const PROJECT_KINDS = { bmm: ['APP', 'PLUGIN', 'THEME'], bsm: ['PRESET'] };
const KIND_LABEL = { APP: 'App', PLUGIN: 'Plugin', THEME: 'Theme', PRESET: 'Preset' };

// Admin: quickly publish an OFFICIAL catalog entry for BMM or BSM.
function AdminCatalogCreator() {
  const toast = useToast();
  const [f, setF] = useState({ projectKey: 'bmm', kind: 'APP', name: '', version: '1.0.0', description: '', tags: '', url: '' });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const kinds = PROJECT_KINDS[f.projectKey] || ['APP'];
  const setProject = (projectKey) => setF((s) => ({ ...s, projectKey, kind: (PROJECT_KINDS[projectKey] || ['APP'])[0] }));
  const deeplink = f.projectKey === 'bmm'
    ? `bmm://catalog/${f.kind.toLowerCase()}/install?name=${encodeURIComponent(f.name || 'name')}${f.url ? `&url=${encodeURIComponent(f.url)}` : ''}`
    : '';

  const onFile = async (uploaded) => {
    setFile(uploaded);
    if (uploaded && f.kind === 'PRESET' && /json$/i.test(uploaded.name)) {
      try { const j = JSON.parse(await uploaded.text()); setF((s) => ({ ...s, name: j.name || s.name, version: j.version || s.version, meta: j })); }
      catch { toast.error('Preset is not valid JSON.'); }
    }
  };
  const submit = async () => {
    if (f.name.length < 2) return toast.error('Name is required.');
    setBusy(true);
    try {
      let payloadKey; if (file) payloadKey = await uploadPayload(f.kind, file);
      // Plugins use download_url; apps use the BMM App-Catalog shape (download.{url,file_type}).
      const ftype = /\.(zip|msi|exe)(\?|$)/i.exec(f.url || '')?.[1]?.toLowerCase() || 'exe';
      const meta = f.kind === 'PRESET' ? (f.meta || {})
        : f.kind === 'PLUGIN' ? { ...(f.url ? { download_url: f.url } : {}), ...(deeplink ? { deeplink } : {}) }
        : f.kind === 'APP' ? { id: f.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), title: f.name, category: 'utility', price: 'free', tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 3), ...(f.url ? { download: { url: f.url, file_type: ftype } } : {}), ...(deeplink ? { deeplink } : {}) }
        : { ...(f.url ? { url: f.url } : {}), ...(deeplink ? { deeplink } : {}) };
      const body = { projectKey: f.projectKey, kind: f.kind, name: f.name, version: f.version, description: f.description,
        tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean), payloadKey, meta };
      const res = await api.post('/admin/catalog', body);
      if (f.kind === 'PLUGIN' && res.validation) toast[res.validation.valid ? 'success' : 'error'](res.validation.valid ? `Plugin "${f.name}" published & validated.` : `Published but INVALID: ${res.validation.reason} — fix before users install.`);
      else toast.success(`Official ${KIND_LABEL[f.kind]} "${f.name}" published.`);
      setF({ projectKey: f.projectKey, kind: f.kind, name: '', version: '1.0.0', description: '', tags: '', url: '' }); setFile(null);
    } catch (x) { toast.error(x.data?.error === 'invalid_preset' ? 'Preset JSON is invalid.' : x.data?.error || 'Failed.'); } finally { setBusy(false); }
  };
  const copy = () => { navigator.clipboard?.writeText(deeplink); toast.success('Deeplink copied.'); };

  return (
    <div>
      <h2 className="font-semibold mb-1 flex items-center gap-2"><BadgeCheck size={16} className="text-[var(--primary-2)]" /> Create an official catalog entry</h2>
      <p className="text-sm text-[var(--muted)] mb-4">Publishes instantly (no moderation) and is flagged <b>Official</b>. BSM offers presets; BMM offers apps, plugins and themes with a <code>bmm://</code> deeplink.</p>
      <Card className="p-5 space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Project"><Select value={f.projectKey} onChange={(e) => setProject(e.target.value)}><option value="bmm">BMM</option><option value="bsm">BSM</option></Select></Field>
          <Field label="Type"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</Select></Field>
          <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={f.kind === 'PRESET' ? 'Afterburner Boom' : f.kind === 'THEME' ? 'Midnight Orange' : 'Auto Backup'} /></Field>
          <Field label="Version"><Input value={f.version} onChange={(e) => setF({ ...f, version: e.target.value })} /></Field>
        </div>
        <Field label="Description"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="What it does, in a sentence or two…" /></Field>
        <Field label="Tags (comma-separated)"><Input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} placeholder="audio, utility, dark-theme" /></Field>
        {f.kind === 'PLUGIN' && <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-2.5 text-xs text-[var(--muted)]">Host the <code>.bmmplug</code> yourself (URL below) or with us (upload it — priced by size). Either way it's checksum-validated on publish.</div>}
        {f.kind !== 'PRESET' && <Field label={f.kind === 'PLUGIN' ? '.bmmplug URL (self-hosted)' : 'Download URL'} hint={f.kind === 'PLUGIN' ? 'GitHub raw / personal server. Leave empty to host with us via upload.' : 'Where the app/theme is fetched from.'}><Input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder={f.kind === 'PLUGIN' ? 'https://raw.githubusercontent.com/you/repo/main/plugin.bmmplug' : 'https://github.com/you/repo/releases/latest/download/app.zip'} /></Field>}
        <Field label={f.kind === 'PRESET' ? 'Preset .json (metadata is read from the file)' : f.kind === 'PLUGIN' ? '.bmmplug file (our-hosted — priced by size)' : 'Payload file (optional — zip / wasm)'}>
          <Input type="file" accept={f.kind === 'PRESET' ? '.json,application/json' : f.kind === 'PLUGIN' ? '.bmmplug,.zip' : undefined} onChange={(e) => onFile(e.target.files?.[0] || null)} /></Field>
        {deeplink && (
          <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)] mb-1 flex items-center gap-1"><Link2 size={11} /> BMM deeplink</div>
            <div className="flex items-center gap-2"><code className="text-xs text-[var(--muted)] truncate flex-1">{deeplink}</code><Button size="sm" onClick={copy}><Copy size={13} /></Button></div>
          </div>
        )}
        <div className="flex justify-end"><Button variant="primary" disabled={busy} onClick={submit}>{busy ? <Spinner /> : <><BadgeCheck size={15} /> Publish official</>}</Button></div>
      </Card>
    </div>
  );
}

// Admin: verify plugin integrity — validate (download+unzip+checksum), inspect content.
function PluginVerifier() {
  const toast = useToast();
  const { data, loading, reload } = useAsync(() => api.get('/admin/catalog?kind=PLUGIN'), []);
  const [content, setContent] = useState(null);
  const items = data?.items || [];
  const validate = async (it) => { try { const r = await api.post(`/admin/catalog/${it.id}/validate`); toast[r.valid ? 'success' : 'error'](r.valid ? `"${it.name}" is valid.` : `"${it.name}" INVALID: ${r.reason}`); reload(); } catch (x) { toast.error(x.data?.detail || 'Validation failed.'); } };
  const dl = async (it) => { try { const { url } = await api.get(`/admin/catalog/${it.id}/file`); window.open(url, '_blank'); } catch { toast.error('This plugin has no downloadable file.'); } };
  return (
    <div className="mt-10">
      <h2 className="font-semibold mb-1 flex items-center gap-2"><ShieldCheck size={16} className="text-[var(--primary-2)]" /> Plugin verification</h2>
      <p className="text-sm text-[var(--muted)] mb-4">Download the <code>.bmmplug</code>, unzip it, and verify the package + per-file checksums. Invalid plugins warn users not to install.</p>
      {loading ? <Loading /> : items.length ? <div className="space-y-2">
        {items.map((it) => { const v = it.meta?.validation; return (
          <Card key={it.id} className="p-4 flex items-center gap-3 flex-wrap">
            <Puzzle size={17} className="text-[var(--primary-2)]" />
            <div className="flex-1 min-w-0"><div className="font-medium truncate">{it.name} <span className="text-xs text-[var(--faint)] font-normal">v{it.version} · {it.owner?.displayName}</span></div>
              <div className="text-xs text-[var(--faint)] mt-0.5">{it.meta?.download_url ? 'self-hosted' : it.payloadKey ? 'our-hosted' : 'no source'}{v?.sha256 ? ` · ${v.sha256.slice(0, 12)}…` : ''}</div></div>
            {v ? (v.valid ? <Badge tone="green"><CheckCircle2 size={11} /> Valid</Badge> : <Badge tone="red"><XCircle size={11} /> {v.reason}</Badge>) : <Badge>Unchecked</Badge>}
            <Button size="sm" onClick={() => validate(it)}><ShieldCheck size={14} /> Validate</Button>
            {(it.payloadKey || it.meta?.download_url) && <Button size="sm" onClick={() => dl(it)}><Download size={14} /> Download</Button>}
            <Button size="sm" onClick={() => setContent(it)}><Files size={14} /> Content</Button>
          </Card>); })}
      </div> : <EmptyState icon={Puzzle} title="No plugins yet" />}
      {content && <PluginContentModal item={content} onClose={() => setContent(null)} />}
    </div>
  );
}

// Admin: theme verification — download & inspect a theme's JSON before it goes live.
function ThemeVerifier() {
  const toast = useToast();
  const { data, loading } = useAsync(() => api.get('/admin/catalog?kind=THEME'), []);
  const items = data?.items || [];
  const dl = async (it) => { try { const { url } = await api.get(`/admin/catalog/${it.id}/file`); window.open(url, '_blank'); } catch { toast.error('This theme has no downloadable file.'); } };
  return (
    <div className="mt-10">
      <h2 className="font-semibold mb-1 flex items-center gap-2"><Palette size={16} className="text-[var(--primary-2)]" /> Theme verification</h2>
      <p className="text-sm text-[var(--muted)] mb-4">Download and inspect a theme's JSON before it goes live. Themes are served as data, never executed.</p>
      {loading ? <Loading /> : items.length ? <div className="space-y-2">
        {items.map((it) => (
          <Card key={it.id} className="p-4 flex items-center gap-3 flex-wrap">
            <Palette size={17} className="text-[var(--primary-2)]" />
            <div className="flex-1 min-w-0"><div className="font-medium truncate">{it.name} <span className="text-xs text-[var(--faint)] font-normal">v{it.version} · {it.owner?.displayName}</span></div>
              <div className="text-xs text-[var(--faint)] mt-0.5">{it.meta?.url || it.meta?.download_url ? 'self-hosted' : it.payloadKey ? 'our-hosted' : 'no source'}</div></div>
            <Badge tone={statusTone(it.status)}>{it.status}</Badge>
            {(it.payloadKey || it.meta?.url || it.meta?.download_url) && <Button size="sm" onClick={() => dl(it)}><Download size={14} /> Download</Button>}
          </Card>
        ))}
      </div> : <EmptyState icon={Palette} title="No themes yet" />}
    </div>
  );
}

// Admin: find a user by id / display name / email / linked creator id, then inspect them.
function AdminUsers() {
  const [sp] = useSearchParams();
  const [q, setQ] = useState(sp.get('q') || '');
  const [results, setResults] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState(null);
  // Load users; `append` pages more (Load more), else replaces. Empty term = all users.
  const load = async (term, append = false) => {
    term = (term || '').trim();
    setBusy(true);
    try {
      const skip = append ? (results?.length || 0) : 0;
      const { users, hasMore: more } = await api.get(`/admin/users?q=${encodeURIComponent(term)}&skip=${skip}&take=30`);
      setResults(append ? [...(results || []), ...users] : users); setHasMore(more);
    } catch { if (!append) setResults([]); } finally { setBusy(false); }
  };
  const search = () => load(q, false);
  useEffect(() => { load(sp.get('q') || '', false); /* eslint-disable-next-line */ }, []);
  const since = (d) => new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  return (
    <div>
      <h2 className="font-semibold mb-1 flex items-center gap-2"><Users size={16} className="text-[var(--primary-2)]" /> User search</h2>
      <p className="text-sm text-[var(--muted)] mb-4">Search by user id, <b>Unique BC id</b> (BC-XXXX-XXXX), display name, email, a linked <b>creator id</b>, or a linked <b>Discord</b> (username / id). Click a user to see full details.</p>
      <div className="flex gap-2 mb-5">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
          <Input className="!pl-9" placeholder="id / display name / email / creator id / Discord…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
        </div>
        <Button variant="primary" disabled={busy} onClick={search}>{busy ? <Spinner /> : <><Search size={15} /> Search</>}</Button>
      </div>
      {results === null ? <EmptyState icon={Users} title="Find a user" sub="Enter a term above to search." />
        : results.length ? <div className="space-y-2">
          {results.map((u) => (
            <button key={u.id} onClick={() => setDetail(u.id)} className="w-full text-left card card-hover p-4 flex items-center gap-3">
              <Avatar user={u} size={40} />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate flex items-center gap-2">{u.displayName} <Badge tone={u.role === 'SUPERADMIN' ? 'red' : u.role === 'ADMIN' ? 'amber' : u.role === 'MOD' ? 'primary' : ''}>{u.role}</Badge></div>
                <div className="text-xs text-[var(--faint)] truncate">{u.email} · since {since(u.createdAt)}</div>
                <div className="text-xs text-[var(--faint)] mt-0.5 font-mono truncate flex items-center gap-2">
                  {u.bcId && <span className="inline-flex items-center gap-1 text-[var(--primary-2)]"><Fingerprint size={11} /> {u.bcId}</span>}
                  <span className="truncate">{u.id}</span>
                </div>
                {u.discord && (
                  <div className="text-xs mt-0.5 flex items-center gap-1.5 truncate text-[#5865F2]">
                    <DiscordIcon size={12} /> <span className="font-medium">{u.discord.username || 'linked'}</span>
                    <span className="text-[var(--faint)] font-mono">· {u.discord.id}</span>
                  </div>
                )}
              </div>
              <div className="text-xs text-[var(--muted)] flex flex-col items-end gap-0.5 shrink-0">
                <span className="flex items-center gap-1"><Server size={11} /> {u.repoCount}</span>
                <span className="flex items-center gap-1"><Package size={11} /> {u.itemCount}</span>
                {u.creatorIds.length > 0 && <Badge tone="green">{u.creatorIds.length} creator id{u.creatorIds.length > 1 ? 's' : ''}</Badge>}
                {u.discord && <Badge tone="primary"><DiscordIcon size={10} /> Discord</Badge>}
              </div>
            </button>
          ))}
          {hasMore && <div className="text-center pt-1"><Button variant="ghost" disabled={busy} onClick={() => load(q, true)}>{busy ? <Spinner /> : 'Load more'}</Button></div>}
        </div> : <EmptyState icon={XCircle} title="No users found" sub="Try a different id, name, email or creator id." />}
      {detail && <UserDetailModal id={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

// Admin: who's on a free plan vs. who has actually paid us. "Paying" is driven by
// real Payment rows (never by plan name), so it stays correct as pricing/thresholds
// change — a user who was billed once and then stays under the free tier forever
// after still counts as a paying customer (they have Payment history).
const PLANUSERS_TABS = [
  ['paying', CreditCard, 'Paying customers'],
  ['free', Gift, 'Free plan'],
  ['archived', Archive, 'Archived'],
];
// Classified by CURRENT state (see the endpoint): a user can appear in more than one
// tab — e.g. one free repo + one paid boost — since the tabs aren't a strict partition.
function AdminPlanUsers() {
  const [tab, setTab] = useState('paying');
  const [results, setResults] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const load = async (append = false) => {
    setBusy(true);
    try {
      const skip = append ? (results?.length || 0) : 0;
      const { users, hasMore: more } = await api.get(`/admin/billing/users?tab=${tab}&skip=${skip}&take=30`);
      setResults(append ? [...(results || []), ...users] : users); setHasMore(more);
    } catch { if (!append) setResults([]); } finally { setBusy(false); }
  };
  useEffect(() => { load(false); setExpanded(null); /* eslint-disable-next-line */ }, [tab]);
  const since = (d) => new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const emptyCopy = { paying: ['No paying customers yet', 'Nobody has made a payment yet.'], free: ['No free-plan users', 'Nobody is hosting content for free right now.'], archived: ['Nothing archived', 'No expired terms or ended boosts right now.'] }[tab];
  return (
    <div>
      <h2 className="font-semibold mb-1 flex items-center gap-2"><Receipt size={16} className="text-[var(--primary-2)]" /> Free vs paid</h2>
      <p className="text-sm text-[var(--muted)] mb-4">What every customer currently has active: free-tier hosting, paid hosting/boosts, or expired/ended terms. Click a row to see the detail; click the user's name for their full profile.</p>
      <div className="flex gap-2 mb-4">
        {PLANUSERS_TABS.map(([id, I, label]) => (
          <button key={id} onClick={() => setTab(id)} className={`flex-1 px-3 py-2 rounded-xl text-sm font-medium border transition ${tab === id ? 'bg-[var(--surface-2)] border-[var(--line)] text-[var(--text)]' : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'}`}>
            <I size={14} className="inline mr-1.5 -mt-0.5" /> {label}</button>
        ))}
      </div>
      {busy && !results ? <Loading /> : results && results.length ? <div className="space-y-2">
        {results.map((u) => {
          const isOpen = expanded === u.id;
          return (
          <Card key={u.id} className="p-0 overflow-hidden">
            <button onClick={() => setExpanded(isOpen ? null : u.id)} className="w-full text-left p-4 flex items-center gap-3 hover:bg-[var(--surface-2)] transition">
              <Avatar user={u} size={40} />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate flex items-center gap-2"><span onClick={(e) => { e.stopPropagation(); setDetail(u.id); }} className="hover:underline hover:text-[var(--primary-2)]">{u.displayName}</span> <Badge tone={u.role === 'SUPERADMIN' ? 'red' : u.role === 'ADMIN' ? 'amber' : u.role === 'MOD' ? 'primary' : ''}>{u.role}</Badge></div>
                <div className="text-xs text-[var(--faint)] truncate">{u.email}</div>
              </div>
              {tab === 'paying' && u.totalSpentCents != null && (
                <div className="text-xs text-right shrink-0">
                  <div className="text-sm font-semibold text-emerald-400">${(u.totalSpentCents / 100).toFixed(2)}</div>
                  <div className="text-[var(--faint)]">{u.paymentCount} payment{u.paymentCount !== 1 ? 's' : ''} · last {since(u.lastPaymentAt)}</div>
                </div>
              )}
              <Badge className="shrink-0">{u.active.length} active</Badge>
              <ChevronDown size={15} className={`shrink-0 text-[var(--faint)] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            {isOpen && (
              <div className="px-4 pb-4 pt-1 space-y-1 border-t border-[var(--line)]">
                {u.active.map((label, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-[var(--surface-2)]">
                    {tab === 'paying' ? <CreditCard size={13} className="text-emerald-400 shrink-0" /> : tab === 'free' ? <Gift size={13} className="text-[var(--primary-2)] shrink-0" /> : <Archive size={13} className="text-[var(--faint)] shrink-0" />}
                    <span className="truncate">{label}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
          ); })}
        {hasMore && <div className="text-center pt-1"><Button variant="ghost" disabled={busy} onClick={() => load(true)}>{busy ? <Spinner /> : 'Load more'}</Button></div>}
      </div> : <EmptyState icon={tab === 'paying' ? CreditCard : tab === 'free' ? Gift : Archive} title={emptyCopy[0]} sub={emptyCopy[1]} />}
      {detail && <UserDetailModal id={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function PolicyChipList({ label, items, onAdd, onRemove, placeholder }) {
  const [v, setV] = useState('');
  const add = () => { const x = v.trim(); if (x) { onAdd(x); setV(''); } };
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] mb-1">{label}</div>
      <div className="flex gap-1.5"><Input value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} onKeyDown={(e) => e.key === 'Enter' && add()} /><Button size="sm" onClick={add}><Plus size={13} /></Button></div>
      <div className="flex flex-wrap gap-1 mt-1.5">
        {items.length ? items.map((x) => (
          <span key={x} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[var(--surface-2)] border border-[var(--line)] text-[11px]">{x}<button onClick={() => onRemove(x)} className="text-[var(--faint)] hover:text-red-400"><X size={10} /></button></span>
        )) : <span className="text-[11px] text-[var(--faint)]">{'—'}</span>}
      </div>
    </div>
  );
}

// Account entries ({type:"bcweb"|"discord", id, label}) — searches the same
// creator-id/Discord-id/username/display-name index as the "Find a user" box below.
function PolicyAccountChips({ label, items, onAdd, onRemove }) {
  const [q, setQ] = useState(''); const [results, setResults] = useState(null); const [busy, setBusy] = useState(false);
  const search = async () => {
    if (!q.trim()) return setResults(null);
    setBusy(true);
    try { const { users } = await api.get(`/admin/users?q=${encodeURIComponent(q)}&take=8`); setResults(users); } catch { setResults([]); } finally { setBusy(false); }
  };
  const has = (type, id) => items.some((a) => a.type === type && a.id === id);
  const add = (entry) => { if (!has(entry.type, entry.id)) onAdd(entry); };
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] mb-1">{label}</div>
      <div className="flex gap-1.5">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="id / display name / creator id / Discord…" onKeyDown={(e) => e.key === 'Enter' && search()} />
        <Button size="sm" onClick={search}>{busy ? <Spinner /> : <Search size={13} />}</Button>
      </div>
      {results && (
        <div className="mt-1.5 space-y-1">
          {results.length ? results.map((u) => (
            <div key={u.id} className="flex items-center justify-between gap-2 px-2 py-1 rounded-md bg-[var(--surface-2)] border border-[var(--line)] text-[11px]">
              <span className="truncate">{u.displayName}{u.discord && <span className="text-[var(--faint)]"> · Discord: {u.discord.username || u.discord.id}</span>}</span>
              <span className="flex gap-1 shrink-0">
                <button onClick={() => add({ type: 'bcweb', id: u.id, label: u.displayName })} className="px-1.5 py-0.5 rounded border border-[var(--line)] hover:text-[var(--primary-2)] hover:border-[var(--primary-2)]">+ BC</button>
                {u.discord && <button onClick={() => add({ type: 'discord', id: u.discord.id, label: u.discord.username || u.discord.id })} className="px-1.5 py-0.5 rounded border border-[var(--line)] hover:text-[var(--primary-2)] hover:border-[var(--primary-2)]">+ Discord</button>}
              </span>
            </div>
          )) : <div className="text-[11px] text-[var(--faint)] px-1">No accounts found.</div>}
        </div>
      )}
      <div className="flex flex-wrap gap-1 mt-1.5">
        {items.length ? items.map((a) => (
          <span key={`${a.type}:${a.id}`} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[var(--surface-2)] border border-[var(--line)] text-[11px]">
            <Users size={9} className="text-[var(--faint)]" /> {a.type === 'discord' ? 'Discord: ' : ''}{a.label || a.id}
            <button onClick={() => onRemove(a)} className="text-[var(--faint)] hover:text-red-400"><X size={10} /></button>
          </span>
        )) : <span className="text-[11px] text-[var(--faint)]">{'—'}</span>}
      </div>
    </div>
  );
}

// Site-wide whitelist/blacklist applied identically to every hosted repo (see
// GlobalAccessPolicy in schema.prisma + hosting-content.mjs's sandboxGate). MOD can
// see it (GET is MOD+); only ADMIN+ can change it (PUT enforces that server-side).
function GlobalAccessPolicyCard() {
  const toast = useToast();
  const { data, loading, reload } = useAsync(() => api.get('/admin/access-policy'), []);
  const [policy, setPolicy] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data?.policy && !policy) setPolicy(data.policy); /* eslint-disable-next-line */ }, [data]);

  if (!policy) return <Card className="p-5">{loading ? <Loading /> : null}</Card>;

  const addTo = (field, val) => setPolicy((s) => ({ ...s, [field]: [...new Set([...(s[field] || []), val])] }));
  const rm = (field, val) => setPolicy((s) => ({ ...s, [field]: (s[field] || []).filter((x) => x !== val) }));
  const addAccount = (field, entry) => setPolicy((s) => {
    const list = s[field] || [];
    if (list.some((a) => a.type === entry.type && a.id === entry.id)) return s;
    return { ...s, [field]: [...list, entry] };
  });
  const rmAccount = (field, entry) => setPolicy((s) => ({ ...s, [field]: (s[field] || []).filter((a) => !(a.type === entry.type && a.id === entry.id)) }));

  const save = async () => {
    setBusy(true);
    try { await api.put('/admin/access-policy', policy); toast.success('Global access policy saved.'); reload(); }
    catch { toast.error('Failed to save.'); } finally { setBusy(false); }
  };

  return (
    <Card className="p-5 space-y-4">
      <div>
        <h2 className="font-semibold mb-1 flex items-center gap-2"><Globe size={16} className="text-[var(--primary-2)]" /> Global access policy</h2>
        <p className="text-sm text-[var(--muted)]">Applied identically to every hosted repo, on top of each owner's own settings — a ban here blocks a client everywhere; the whitelist here is added to whichever repos require one.</p>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={policy.whitelistOnly} onChange={(e) => setPolicy({ ...policy, whitelistOnly: e.target.checked })} /> Whitelist-only for ALL repos (forces every hosted repo into whitelist mode, site-wide)</label>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] flex items-center gap-1.5"><Shield size={12} className="text-emerald-400" /> Whitelist</div>
          <PolicyChipList label="IPs" items={policy.whitelistIps || []} onAdd={(v) => addTo('whitelistIps', v)} onRemove={(v) => rm('whitelistIps', v)} placeholder="203.0.113.4" />
          <PolicyChipList label="Creator ID" items={policy.whitelistKeys || []} onAdd={(v) => addTo('whitelistKeys', v)} onRemove={(v) => rm('whitelistKeys', v)} placeholder="BMM creator id…" />
          <PolicyAccountChips label="Accounts" items={policy.whitelistAccounts || []} onAdd={(e) => addAccount('whitelistAccounts', e)} onRemove={(e) => rmAccount('whitelistAccounts', e)} />
        </div>
        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] flex items-center gap-1.5"><Ban size={12} className="text-red-400" /> Blacklist</div>
          <PolicyChipList label="IPs" items={policy.bannedIps || []} onAdd={(v) => addTo('bannedIps', v)} onRemove={(v) => rm('bannedIps', v)} placeholder="198.51.100.7" />
          <PolicyChipList label="Creator ID" items={policy.bannedKeys || []} onAdd={(v) => addTo('bannedKeys', v)} onRemove={(v) => rm('bannedKeys', v)} placeholder="BMM creator id…" />
          <PolicyAccountChips label="Accounts" items={policy.bannedAccounts || []} onAdd={(e) => addAccount('bannedAccounts', e)} onRemove={(e) => rmAccount('bannedAccounts', e)} />
        </div>
      </div>
      <div className="flex justify-end"><Button variant="primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : 'Save global policy'}</Button></div>
    </Card>
  );
}

// Admin (+SuperAdmin): grant/revoke blog-post permissions (any ADMIN+), and — only
// for a SUPERADMIN — reassign a user's role. Kept in one screen since both are
// "who can do what" access-control actions.
// Login attempts (success/fail, IP, which account) + the admin/staff audit trail
// (role changes, access-policy edits, server-control grants/elevations).
const SECURITY_RANGES = [['24', '24h'], ['168', '7d'], ['720', '30d'], ['8760', '1y']];
// A failed-login IP is flagged once it's tried 5+ times in the loaded window —
// a cheap, no-config heuristic to surface likely brute-force/credential-stuffing
// activity without needing a real rate-limiting/ban system here.
const BRUTE_FORCE_THRESHOLD = 5;

function AdminSecurity() {
  const [tab, setTab] = useState('logins');
  const [q, setQ] = useState('');
  const [loginFilter, setLoginFilter] = useState('all'); // all | success | failed | suspicious
  const [hours, setHours] = useState('168');
  const logins = useAsync(() => api.get(`/admin/security/logins?hours=${hours}`), [hours]);
  const audit = useAsync(() => api.get(`/admin/security/audit?hours=${hours}`), [hours]);
  const attempts = logins.data?.attempts || [];
  const entries = audit.data?.entries || [];

  const failsByIp = {};
  for (const a of attempts) if (!a.success) failsByIp[a.ip] = (failsByIp[a.ip] || 0) + 1;
  const suspiciousIps = new Set(Object.entries(failsByIp).filter(([, n]) => n >= BRUTE_FORCE_THRESHOLD).map(([ip]) => ip));

  const qLower = q.trim().toLowerCase();
  const filteredAttempts = attempts.filter((a) => {
    if (loginFilter === 'success' && !a.success) return false;
    if (loginFilter === 'failed' && a.success) return false;
    if (loginFilter === 'suspicious' && !suspiciousIps.has(a.ip)) return false;
    if (!qLower) return true;
    return a.email.toLowerCase().includes(qLower) || a.ip.includes(qLower) || a.user?.displayName?.toLowerCase().includes(qLower);
  });
  const filteredEntries = entries.filter((e) => {
    if (!qLower) return true;
    return e.actor?.displayName?.toLowerCase().includes(qLower) || e.action.toLowerCase().includes(qLower) || e.detail?.toLowerCase().includes(qLower) || e.ip.includes(qLower);
  });

  const failedCount = attempts.filter((a) => !a.success).length;
  const uniqueIps = new Set(attempts.map((a) => a.ip)).size;

  const exportCsv = (rowsArr, cols, name) => {
    if (!rowsArr.length) return;
    const esc = (s) => /[",\n]/.test(String(s ?? '')) ? `"${String(s ?? '').replace(/"/g, '""')}"` : String(s ?? '');
    const csv = [cols.map((c) => esc(c[0])).join(','), ...rowsArr.map((r) => cols.map((c) => esc(c[1](r))).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${name}.csv`; document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <h2 className="font-semibold mb-1 flex items-center gap-2"><Lock size={16} className="text-[var(--primary-2)]" /> Security log</h2>
      <p className="text-sm text-[var(--muted)] mb-3">Login attempts (success/fail, IP) and the admin action audit trail.</p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <Card className="p-3"><div className="text-[var(--faint)] text-xs mb-1">Attempts</div><div className="text-xl font-bold tabular-nums">{attempts.length}</div></Card>
        <Card className="p-3"><div className="text-[var(--faint)] text-xs mb-1">Failed</div><div className="text-xl font-bold tabular-nums text-red-400">{failedCount}</div></Card>
        <Card className="p-3"><div className="text-[var(--faint)] text-xs mb-1">Unique IPs</div><div className="text-xl font-bold tabular-nums">{uniqueIps}</div></Card>
        <Card className="p-3"><div className="text-[var(--faint)] text-xs mb-1 flex items-center gap-1"><AlertTriangle size={11} className={suspiciousIps.size ? 'text-red-400' : ''} /> Suspicious IPs</div><div className={`text-xl font-bold tabular-nums ${suspiciousIps.size ? 'text-red-400' : ''}`}>{suspiciousIps.size}</div></Card>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div className="flex gap-2">
          <button onClick={() => setTab('logins')} className={`px-3 py-1.5 rounded-lg border text-sm ${tab === 'logins' ? 'border-[var(--primary)] bg-orange-500/10' : 'border-[var(--line)] text-[var(--muted)]'}`}>Login attempts</button>
          <button onClick={() => setTab('audit')} className={`px-3 py-1.5 rounded-lg border text-sm ${tab === 'audit' ? 'border-[var(--primary)] bg-orange-500/10' : 'border-[var(--line)] text-[var(--muted)]'}`}>Admin audit trail</button>
        </div>
        <div className="flex gap-1">
          {SECURITY_RANGES.map(([h, label]) => (
            <button key={h} onClick={() => setHours(h)} className={`px-2.5 py-1 rounded-lg border text-xs ${hours === h ? 'border-[var(--primary)] text-[var(--primary-2)]' : 'border-[var(--line)] text-[var(--faint)] hover:text-[var(--text)]'}`}>{label}</button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <div className="relative flex-1 min-w-[200px]"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
          <Input className="!pl-9" placeholder={tab === 'logins' ? 'Search email, IP or account…' : 'Search actor, action, detail or IP…'} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {tab === 'logins' && (
          <Select className="!w-auto" value={loginFilter} onChange={(e) => setLoginFilter(e.target.value)}>
            <option value="all">All outcomes</option><option value="success">Success only</option><option value="failed">Failed only</option><option value="suspicious">Suspicious IPs only</option>
          </Select>
        )}
        <Button size="sm" onClick={() => tab === 'logins'
          ? exportCsv(filteredAttempts, [['email', (a) => a.email], ['success', (a) => a.success], ['ip', (a) => a.ip], ['reason', (a) => a.reason], ['createdAt', (a) => a.createdAt]], 'login_attempts')
          : exportCsv(filteredEntries, [['actor', (e) => e.actor?.displayName], ['action', (e) => e.action], ['detail', (e) => e.detail], ['ip', (e) => e.ip], ['createdAt', (e) => e.createdAt]], 'audit_trail')}>
          <Download size={13} /> CSV
        </Button>
      </div>

      {tab === 'logins' && (logins.loading ? <Loading /> : filteredAttempts.length ? <Card className="p-0 overflow-hidden">
        <div className="max-h-[65vh] overflow-auto divide-y divide-[var(--line)]">
          {filteredAttempts.map((a) => (
            <div key={a.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              {a.success ? <CheckCircle2 size={15} className="text-emerald-400 shrink-0" /> : <XCircle size={15} className="text-red-400 shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="truncate"><button onClick={() => setQ(a.email)} className="font-medium hover:text-[var(--primary-2)]">{a.email}</button> {a.user && <span className="text-xs text-[var(--faint)]">· {a.user.displayName} ({a.user.role})</span>} {suspiciousIps.has(a.ip) && <Badge tone="red" className="ml-1">Brute-force?</Badge>}</div>
                <div className="text-[11px] text-[var(--faint)] font-mono"><button onClick={() => setQ(a.ip)} className="hover:text-[var(--primary-2)]">{a.ip}</button> {a.reason ? `· ${a.reason}` : ''}</div>
              </div>
              <span className="text-[11px] text-[var(--faint)] shrink-0">{new Date(a.createdAt).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </Card> : <EmptyState icon={Lock} title={attempts.length ? 'No matches' : 'No login attempts in this range'} />)}
      {tab === 'audit' && (audit.loading ? <Loading /> : filteredEntries.length ? <Card className="p-0 overflow-hidden">
        <div className="max-h-[65vh] overflow-auto divide-y divide-[var(--line)]">
          {filteredEntries.map((e) => (
            <div key={e.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <Shield size={15} className="text-[var(--primary-2)] shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="truncate"><span className="font-medium">{e.actor?.displayName || '—'}</span> <span className="text-[var(--muted)]">{e.action}</span>{e.detail && <span className="text-[var(--faint)]"> · {e.detail}</span>}</div>
                <div className="text-[11px] text-[var(--faint)] font-mono"><button onClick={() => setQ(e.ip)} className="hover:text-[var(--primary-2)]">{e.ip}</button></div>
              </div>
              <span className="text-[11px] text-[var(--faint)] shrink-0">{new Date(e.createdAt).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </Card> : <EmptyState icon={Shield} title={entries.length ? 'No matches' : 'No audit entries in this range'} />)}
    </div>
  );
}

// A compact multi-line SVG chart for cpu/mem/disk % history — same hand-rolled
// approach as the repo dashboard's traffic chart (no charting library dependency).
function MetricChart({ history }) {
  const W = 760; const H = 200; const padL = 32; const padR = 8; const padY = 16;
  const [hoverIdx, setHoverIdx] = useState(null);
  if (!history.length) return <div className="text-sm text-[var(--faint)] py-10 text-center">No samples yet — click "Sample now" or wait for the next ~10 min tick.</div>;
  const n = history.length;
  const x = (i) => n === 1 ? (padL + W - padR) / 2 : padL + (i / Math.max(1, n - 1)) * (W - padL - padR);
  const y = (pct) => H - padY - (Math.max(0, Math.min(100, pct)) / 100) * (H - padY * 2);
  // A lone point (or two) has no meaningful line yet — draw dots too, so the chart
  // is never blank while history is still building up (a single "M ..." path with
  // no "L" segment renders invisibly, which looked like a broken/empty graph).
  const series = (key, color) => (
    <g key={key}>
      {n > 1 && <path d={history.map((h, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(h[key]).toFixed(1)}`).join(' ')} fill="none" stroke={color} strokeWidth={2} />}
      {history.map((h, i) => <circle key={i} cx={x(i)} cy={y(h[key])} r={hoverIdx === i ? (n > 12 ? 3 : 4) : (n > 12 ? 1.5 : 2.5)} fill={color} />)}
    </g>
  );
  // Map mouse position -> nearest sample by comparing against the SVG's own
  // viewBox coordinate space (via its rendered bounding box), so this stays
  // correct regardless of how wide the chart is actually drawn on screen.
  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0; let bestDist = Infinity;
    for (let i = 0; i < n; i++) { const d = Math.abs(x(i) - svgX); if (d < bestDist) { bestDist = d; best = i; } }
    setHoverIdx(best);
  };
  const hv = hoverIdx != null ? history[hoverIdx] : null;
  const ttW = 132; const ttH = 62;
  const ttX = hoverIdx != null ? Math.min(Math.max(x(hoverIdx) - ttW / 2, padL), W - padR - ttW) : 0;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-48 cursor-crosshair" onMouseMove={onMove} onMouseLeave={() => setHoverIdx(null)}>
      {[0, 25, 50, 75, 100].map((g) => (
        <g key={g}>
          <line x1={padL} x2={W - padR} y1={y(g)} y2={y(g)} stroke="var(--line)" strokeWidth={1} />
          <text x={2} y={y(g) + 3} fontSize="9" fill="var(--faint)">{g}%</text>
        </g>
      ))}
      {series('diskPct', '#a78bfa')}
      {series('memPct', '#38bdf8')}
      {series('cpuPct', '#f97316')}
      {hv && (
        <g pointerEvents="none">
          <line x1={x(hoverIdx)} x2={x(hoverIdx)} y1={padY} y2={H - padY} stroke="var(--faint)" strokeWidth={1} strokeDasharray="3 3" />
          <rect x={ttX} y={4} width={ttW} height={ttH} rx={6} fill="var(--surface-2)" stroke="var(--line)" />
          <text x={ttX + 8} y={18} fontSize="9" fill="var(--faint)">{new Date(hv.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</text>
          <text x={ttX + 8} y={32} fontSize="10" fontWeight="600" fill="#f97316">CPU {hv.cpuPct.toFixed(1)}%</text>
          <text x={ttX + 8} y={45} fontSize="10" fontWeight="600" fill="#38bdf8">RAM {hv.memPct.toFixed(1)}%</text>
          <text x={ttX + 8} y={58} fontSize="10" fontWeight="600" fill="#a78bfa">Disk {hv.diskPct.toFixed(1)}%</text>
        </g>
      )}
    </svg>
  );
}

// Server performance dashboard — read-only (no dangerous action lives here, so no
// step-up 2FA required). CPU/RAM/disk/latency/uptime are sampled from INSIDE this
// container every ~10 min by the sweeper (monitor.mjs); a per-container/per-service
// breakdown with restart controls would need Docker-socket access, which is a
// separate, bigger ask (see the "Advanced server management" tab).
function AdminServerPerf() {
  const toast = useToast();
  const { data, loading, reload } = useAsync(() => api.get('/admin/server/metrics'), []);
  const alerts = useAsync(() => api.get('/admin/server/alerts'), []);
  const depsCfg = useAsync(() => api.get('/admin/server/deps-config'), []);
  const [busy, setBusy] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const [depsBusy, setDepsBusy] = useState(false);
  const sampleNow = async () => {
    setBusy(true);
    try { await api.post('/admin/server/sample-now'); toast.success('Sampled.'); reload(); alerts.reload(); } catch { toast.error('Failed.'); } finally { setBusy(false); }
  };
  const toggleDep = async (key, on) => {
    setDepsBusy(true);
    try { await api.put('/admin/server/deps-config', { [key]: on }); depsCfg.reload(); reload(); } catch { toast.error('Failed.'); } finally { setDepsBusy(false); }
  };
  if (loading) return <Loading />;
  const latest = data?.latest;
  const deps = data?.deps || {};
  const ssl = data?.ssl;
  const history = data?.history || [];
  const downtime = data?.downtime || [];
  const cg = data?.cgroupMemory;
  const totals = data?.totals || {};
  const labels = depsCfg.data?.labels || {};
  const allKeys = depsCfg.data?.keys || Object.keys(deps);
  const enabledCfg = depsCfg.data?.enabled || {};
  const depBadge = (ok, label) => <Badge key={label} tone={ok === null ? '' : ok ? 'green' : 'red'}>{ok === null ? <Clock size={10} /> : ok ? <CheckCircle2 size={10} /> : <XCircle size={10} />} {label}</Badge>;
  const gb = (b) => b == null ? null : b / 1024 ** 3;
  const memUsedGB = totals.memTotalBytes != null && totals.memFreeBytes != null ? gb(totals.memTotalBytes - totals.memFreeBytes) : null;
  const diskUsedGB = totals.diskTotalBytes != null && totals.diskFreeBytes != null ? gb(totals.diskTotalBytes - totals.diskFreeBytes) : null;
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold flex items-center gap-2"><Cpu size={16} className="text-[var(--primary-2)]" /> Server performance</h2>
        <Button size="sm" variant="ghost" disabled={busy} onClick={sampleNow}>{busy ? <Spinner /> : <><RefreshCw size={14} /> Sample now</>}</Button>
      </div>
      <p className="text-xs text-[var(--muted)] mb-3">Metrics reflect this API container's own view (os/cgroup) — sampled every ~10 min. A full per-service breakdown with restart controls needs Docker-socket access (see "Advanced server management").</p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        {[['CPU', latest ? `${latest.cpuPct.toFixed(0)}%` : '—', Cpu], ['Memory', latest ? `${latest.memPct.toFixed(0)}%` : '—', Gauge], ['Disk', latest ? `${latest.diskPct.toFixed(0)}%` : '—', HardDrive], ['Load (1m)', latest ? latest.loadAvg1.toFixed(2) : '—', TrendingUp],
          ['Uptime', latest ? `${(latest.uptimeSec / 3600).toFixed(1)}h` : '—', Clock], ['Avg latency', latest?.latencyMs != null ? `${latest.latencyMs}ms` : '—', Zap]].map(([l, v, I]) => (
          <Card key={l} className="p-3"><div className="flex items-center gap-2 text-[var(--faint)] text-xs mb-1"><I size={13} /> {l}</div><div className="text-xl font-bold tabular-nums">{v}</div></Card>
        ))}
      </div>

      {/* Absolute totals alongside the percentages above — "11% used" only means
          something once you know it's 11% of how much. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Card className="p-3"><div className="flex items-center gap-2 text-[var(--faint)] text-xs mb-1"><Cpu size={13} /> CPU cores</div><div className="text-xl font-bold tabular-nums">{totals.cpuCores ?? '—'}</div></Card>
        <Card className="p-3"><div className="flex items-center gap-2 text-[var(--faint)] text-xs mb-1"><Gauge size={13} /> RAM total</div><div className="text-xl font-bold tabular-nums">{memUsedGB != null ? `${memUsedGB.toFixed(1)} / ${gb(totals.memTotalBytes).toFixed(1)} GB` : '—'}</div></Card>
        <Card className="p-3"><div className="flex items-center gap-2 text-[var(--faint)] text-xs mb-1"><HardDrive size={13} /> Disk total</div><div className="text-xl font-bold tabular-nums">{diskUsedGB != null ? `${diskUsedGB.toFixed(0)} / ${gb(totals.diskTotalBytes).toFixed(0)} GB` : '—'}</div></Card>
        <Card className="p-3"><div className="flex items-center gap-2 text-[var(--faint)] text-xs mb-1"><ShieldCheck size={13} /> Availability</div><div className="text-xl font-bold tabular-nums">{totals.uptimePct != null ? `${totals.uptimePct.toFixed(2)}%` : '—'}</div></Card>
      </div>

      <Card className="p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)]">CPU / Memory / Disk — history</span>
          <span className="flex items-center gap-3 text-[11px] text-[var(--muted)]"><span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#f97316' }} /> CPU</span><span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#38bdf8' }} /> Mem</span><span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#a78bfa' }} /> Disk</span></span>
        </div>
        <MetricChart history={history} />
        {cg?.usedBytes != null && <div className="text-[11px] text-[var(--faint)] mt-2">This process's own cgroup memory: {(cg.usedBytes / 1024 / 1024).toFixed(0)} MB{cg.limitBytes ? ` / ${(cg.limitBytes / 1024 / 1024).toFixed(0)} MB allocated` : ' (no cgroup limit set — showing real usage only)'}.</div>}
      </Card>

      <div className="grid sm:grid-cols-2 gap-4 mb-4">
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)]">Dependencies</span>
            <button className="text-[11px] text-[var(--muted)] hover:text-[var(--text)] hover:underline" onClick={() => setConfiguring((c) => !c)}>{configuring ? 'Done' : 'Configure'}</button>
          </div>
          {configuring ? (
            <div className="space-y-1.5">
              {allKeys.map((k) => (
                <label key={k} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" disabled={depsBusy} checked={enabledCfg[k] !== false} onChange={(e) => toggleDep(k, e.target.checked)} /> {labels[k] || k}
                </label>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {Object.keys(deps).length ? Object.entries(deps).map(([k, ok]) => depBadge(ok, labels[k] || k)) : <span className="text-xs text-[var(--faint)]">All dependency checks are disabled.</span>}
            </div>
          )}
        </Card>
        <Card className="p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-2 flex items-center gap-1.5"><Lock size={11} /> SSL certificate</div>
          {ssl ? <div className="text-sm">{ssl.daysLeft <= 14 ? <Badge tone="red">{ssl.daysLeft}d left</Badge> : ssl.daysLeft <= 30 ? <Badge tone="amber">{ssl.daysLeft}d left</Badge> : <Badge tone="green">{ssl.daysLeft}d left</Badge>} <span className="text-[var(--faint)] text-xs">expires {new Date(ssl.expiresAt).toLocaleDateString()}</span></div> : <div className="text-xs text-[var(--faint)]">Couldn't probe SITE_URL's certificate.</div>}
        </Card>
      </div>

      {downtime.length > 0 && (
        <Card className="p-4 mb-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-2">Downtime history (gaps &gt; 25 min between samples)</div>
          <div className="space-y-1 text-xs text-[var(--muted)]">
            {downtime.map((d, i) => <div key={i}>{new Date(d.from).toLocaleString()} → {new Date(d.to).toLocaleString()} · ~{d.minutes} min</div>)}
          </div>
        </Card>
      )}

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-2">Recent alerts</h3>
        {alerts.loading ? <Loading /> : (alerts.data?.alerts || []).length ? <div className="space-y-1.5">
          {alerts.data.alerts.map((a) => (
            <Card key={a.id} className="p-3 flex items-center gap-3">
              <AlertTriangle size={15} className="text-red-400 shrink-0" />
              <div className="flex-1 min-w-0"><span className="font-medium">{a.kind}</span> <span className="text-[var(--muted)]">{a.message}</span></div>
              <span className="text-[11px] text-[var(--faint)] shrink-0">{new Date(a.createdAt).toLocaleString()}</span>
            </Card>
          ))}
        </div> : <EmptyState icon={CheckCircle2} title="No alerts" sub="Nothing has crossed a threshold yet." />}
      </div>
    </div>
  );
}

// A tiny in-container file browser, confined server-side to FILES_ROOT — good for
// inspecting the deployed code/config, not a general host filesystem browser.
// Two-step confirmation for actions that touch live server files/DB rows: a
// normal confirm dialog, then a second dialog that requires literally typing
// CONFIRM — the same token the backend independently re-checks (server-
// control.mjs's requireConfirm()), so this isn't just a UI speed bump.
async function doubleConfirm(dialog, { title, message, okLabel = 'Continue' }) {
  if (!(await dialog.confirm({ title, message, okLabel, danger: true }))) return false;
  const typed = await dialog.prompt({ title: 'Confirm again', label: `Type CONFIRM to ${okLabel.toLowerCase()}.`, placeholder: 'CONFIRM', okLabel });
  return typed === 'CONFIRM';
}

function FileManager() {
  const toast = useToast(); const dialog = useDialog();
  const [dir, setDir] = useState('.');
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [history, setHistory] = useState(null); // { path, items } for the backup-history modal

  const load = (d) => api.get(`/server/files?path=${encodeURIComponent(d)}`).then((r) => { setData(r); setDir(r.path); setQ(''); }).catch(() => toast.error('Failed to list.'));
  useEffect(() => { load('.'); /* eslint-disable-next-line */ }, []);

  const openEntry = async (e) => {
    const full = dir === '.' ? e.name : `${dir}/${e.name}`;
    if (e.isDir) return load(full);
    try { const r = await api.get(`/server/files/read?path=${encodeURIComponent(full)}`); setEditing({ path: r.path, content: r.content }); }
    catch (x) { toast.error(x.data?.error === 'too_large' ? 'File too large to view here — use download instead.' : 'Failed to read (probably binary — use download instead).'); }
  };
  const up = () => { const parts = dir.split('/').filter((x) => x !== '.'); parts.pop(); load(parts.length ? parts.join('/') : '.'); };
  const saveFile = async () => {
    if (!(await doubleConfirm(dialog, { title: 'Save changes', message: `Overwrite "${editing.path}" on the live server? A backup of the current content is kept automatically.`, okLabel: 'Save' }))) return;
    setBusy(true);
    try { await api.put('/server/files/write', { path: editing.path, content: editing.content, confirmToken: 'CONFIRM' }); toast.success('Saved — a backup of the previous version was kept.'); setEditing(null); }
    catch { toast.error('Failed to save.'); } finally { setBusy(false); }
  };
  const delEntry = async (e) => {
    const full = dir === '.' ? e.name : `${dir}/${e.name}`;
    if (!(await doubleConfirm(dialog, { title: 'Delete', message: `Delete "${full}"? A backup is kept, but it won't reappear in the file manager until restored.`, okLabel: 'Delete' }))) return;
    try { await api.del(`/server/files?path=${encodeURIComponent(full)}&confirmToken=CONFIRM`); toast.success('Deleted.'); load(dir); } catch { toast.error('Failed.'); }
  };
  const viewHistory = async (full) => {
    try { const r = await api.get(`/server/files/backups?path=${encodeURIComponent(full)}`); setHistory({ path: full, items: r.history }); }
    catch { toast.error('Failed to load history.'); }
  };
  const restoreVersion = async (hash) => {
    if (!(await doubleConfirm(dialog, { title: 'Restore this version', message: `Overwrite "${history.path}" with the version from this backup? The current content is backed up first.`, okLabel: 'Restore' }))) return;
    try { await api.post(`/server/files/backups/${hash}/restore`, { path: history.path, confirmToken: 'CONFIRM' }); toast.success('Restored.'); setHistory(null); load(dir); }
    catch { toast.error('Failed to restore.'); }
  };
  const newFolder = async () => {
    const name = await dialog.prompt({ title: 'New folder', label: 'Folder name', placeholder: 'assets' });
    if (!name) return;
    const full = dir === '.' ? name : `${dir}/${name}`;
    try { await api.post('/server/files/mkdir', { path: full }); toast.success('Created.'); load(dir); }
    catch (x) { toast.error(x.data?.error === 'already_exists' ? 'Already exists.' : 'Failed.'); }
  };
  const newFile = async () => {
    const name = await dialog.prompt({ title: 'New file', label: 'File name', placeholder: 'notes.txt' });
    if (!name) return;
    const full = dir === '.' ? name : `${dir}/${name}`;
    try { await api.put('/server/files/write', { path: full, content: '' }); toast.success('Created.'); load(dir); }
    catch { toast.error('Failed.'); }
  };
  const rename = async (e) => {
    const newName = await dialog.prompt({ title: `Rename "${e.name}"`, label: 'New name', placeholder: e.name });
    if (!newName || newName === e.name) return;
    const full = dir === '.' ? e.name : `${dir}/${e.name}`;
    try { await api.put('/server/files/rename', { path: full, newName }); toast.success('Renamed.'); load(dir); }
    catch (x) { toast.error(x.data?.error === 'bad_name' ? 'Invalid name.' : 'Failed.'); }
  };
  const downloadEntry = (e) => {
    const full = dir === '.' ? e.name : `${dir}/${e.name}`;
    window.open(`/api/server/files/download?path=${encodeURIComponent(full)}`, '_blank');
  };

  const crumbs = dir === '.' ? [] : dir.split('/').filter(Boolean);
  const entries = (data?.entries || []).filter((e) => !q.trim() || e.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-2 text-sm flex-wrap">
        <FileText size={14} className="text-[var(--primary-2)] shrink-0" /> <span className="font-semibold shrink-0">File manager</span>
        <div className="flex items-center gap-1 text-xs font-mono text-[var(--faint)] min-w-0 overflow-x-auto">
          <button onClick={() => load('.')} className="hover:text-[var(--primary-2)] shrink-0">/</button>
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1 shrink-0">
              <button onClick={() => load(crumbs.slice(0, i + 1).join('/'))} className="hover:text-[var(--primary-2)]">{c}</button>
              {i < crumbs.length - 1 && <span>/</span>}
            </span>
          ))}
        </div>
        <div className="flex-1" />
        <Button size="sm" onClick={newFolder}><Plus size={12} /> Folder</Button>
        <Button size="sm" onClick={newFile}><Plus size={12} /> File</Button>
        {dir !== '.' && <Button size="sm" onClick={up}>Up</Button>}
      </div>
      {editing ? (
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="text-xs text-[var(--faint)] font-mono">{editing.path}</div>
            <button onClick={() => viewHistory(editing.path)} className="text-xs text-[var(--faint)] hover:text-[var(--primary-2)] flex items-center gap-1"><History size={12} /> History</button>
          </div>
          <textarea value={editing.content} onChange={(e) => setEditing({ ...editing, content: e.target.value })} className="w-full h-64 font-mono text-xs bg-[var(--surface-2)] rounded-lg p-3 outline-none" spellCheck={false} />
          <div className="flex gap-2 mt-2"><Button variant="primary" disabled={busy} onClick={saveFile}>{busy ? <Spinner /> : 'Save'}</Button><Button onClick={() => setEditing(null)}>Cancel</Button></div>
        </div>
      ) : (
        <>
          <div className="relative mb-2"><Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
            <Input className="!pl-8 !py-1.5 !text-xs" placeholder="Filter this folder…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="divide-y divide-[var(--line)] max-h-80 overflow-auto scroll-thin">
            {entries.length ? entries.map((e) => (
              <div key={e.name} className="flex items-center gap-2 py-1.5 text-sm group">
                <button onClick={() => openEntry(e)} className="flex-1 min-w-0 text-left flex items-center gap-2 hover:text-[var(--primary-2)]">
                  {e.isDir ? <FolderGit2 size={13} className="text-[var(--primary-2)] shrink-0" /> : <FileText size={13} className="text-[var(--faint)] shrink-0" />} <span className="truncate">{e.name}</span>
                </button>
                {!e.isDir && <span className="text-[11px] text-[var(--faint)] shrink-0">{(e.size / 1024).toFixed(1)} KB</span>}
                <span className="hidden group-hover:flex items-center gap-2 shrink-0">
                  {!e.isDir && <button onClick={() => downloadEntry(e)} className="text-[var(--faint)] hover:text-[var(--primary-2)]" title="Download"><Download size={12} /></button>}
                  {!e.isDir && <button onClick={() => viewHistory(dir === '.' ? e.name : `${dir}/${e.name}`)} className="text-[var(--faint)] hover:text-[var(--primary-2)]" title="Backup history"><History size={12} /></button>}
                  <button onClick={() => rename(e)} className="text-[var(--faint)] hover:text-[var(--primary-2)]" title="Rename"><PenSquare size={12} /></button>
                  <button onClick={() => delEntry(e)} className="text-[var(--faint)] hover:text-red-400" title="Delete"><Trash2 size={12} /></button>
                </span>
              </div>
            )) : <div className="text-xs text-[var(--faint)] py-4 text-center">{data?.entries?.length ? 'No matches.' : 'Empty directory.'}</div>}
          </div>
        </>
      )}
      {history && (
        <Modal open onClose={() => setHistory(null)} title={`Backup history — ${history.path}`} icon={History} width="max-w-lg">
          {history.items.length ? (
            <div className="divide-y divide-[var(--line)] max-h-96 overflow-auto scroll-thin">
              {history.items.map((h) => (
                <div key={h.hash} className="flex items-center gap-2.5 py-2 text-sm">
                  <div className="flex-1 min-w-0"><div className="truncate">{h.message}</div><div className="text-[11px] text-[var(--faint)]">{new Date(h.at).toLocaleString()} · <code className="font-mono">{h.hash.slice(0, 8)}</code></div></div>
                  <Button size="sm" onClick={() => restoreVersion(h.hash)}>Restore</Button>
                </div>
              ))}
            </div>
          ) : <div className="text-xs text-[var(--faint)] py-6 text-center">No backups yet for this file.</div>}
        </Modal>
      )}
    </Card>
  );
}

// Read-only database browser — table list + paginated rows, no free-form SQL
// input anywhere (that's exactly the surface the web terminal risked). Table
// names are validated server-side against the real Postgres catalog.
const DB_SENSITIVE_COL = /hash|secret|token|password|totp/i;

function DbViewer() {
  const toast = useToast(); const dialog = useDialog();
  const [tables, setTables] = useState(null);
  const [tableQ, setTableQ] = useState('');
  const [active, setActive] = useState(null);
  const [rows, setRows] = useState(null);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState({ col: null, dir: 'asc' });
  const [cell, setCell] = useState(null); // { col, value, pk } for the expand/edit modal
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [rowHistory, setRowHistory] = useState(null); // { table, pk, items }
  const pageSize = 25;

  useEffect(() => { api.get('/server/db/tables').then((r) => setTables(r.tables)).catch(() => toast.error('Failed to list tables.')); /* eslint-disable-next-line */ }, []);
  const openTable = async (name, p = 0, s = sort) => {
    setActive(name); setPage(p); setRows(null); setSort(s);
    try {
      const qs = new URLSearchParams({ page: p, pageSize }); if (s.col) { qs.set('sort', s.col); qs.set('dir', s.dir); }
      const r = await api.get(`/server/db/table/${encodeURIComponent(name)}?${qs}`); setRows(r);
    } catch { toast.error('Failed to load table.'); }
  };
  const toggleSort = (c) => openTable(active, 0, sort.col === c ? { col: c, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { col: c, dir: 'asc' });
  const cols = rows?.rows?.[0] ? Object.keys(rows.rows[0]) : [];
  const cellText = (v) => v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  const exportCsv = () => {
    if (!rows?.rows?.length) return;
    const esc = (s) => /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    const csv = [cols.map(esc).join(','), ...rows.rows.map((r) => cols.map((c) => esc(cellText(r[c]))).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${active}_page${page + 1}.csv`; document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };
  const visibleTables = tables?.filter((t) => !tableQ.trim() || t.name.toLowerCase().includes(tableQ.trim().toLowerCase())) || [];

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-2 text-sm"><HardDrive size={14} className="text-[var(--primary-2)]" /><span className="font-semibold">Database viewer</span><span className="text-xs text-[var(--faint)]">(read-only)</span></div>
      {!tables ? <Loading /> : (
        <div className="grid sm:grid-cols-[180px_1fr] gap-3">
          <div>
            <div className="relative mb-1.5"><Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
              <Input className="!pl-7 !py-1 !text-xs" placeholder="Filter tables…" value={tableQ} onChange={(e) => setTableQ(e.target.value)} /></div>
            <div className="max-h-80 overflow-auto scroll-thin space-y-0.5">
              {visibleTables.map((t) => (
                <button key={t.name} onClick={() => openTable(t.name)} className={`w-full text-left px-2 py-1.5 rounded-lg text-xs flex items-center justify-between gap-2 ${active === t.name ? 'bg-[var(--surface-2)] text-[var(--text)] font-medium' : 'text-[var(--muted)] hover:bg-[var(--surface-2)]'}`}>
                  <span className="truncate">{t.name}</span><span className="text-[var(--faint)] shrink-0">{t.approxRows}</span>
                </button>
              ))}
              {!visibleTables.length && <div className="text-xs text-[var(--faint)] py-3 text-center">No matches.</div>}
            </div>
          </div>
          <div className="min-w-0">
            {!active ? <div className="text-xs text-[var(--faint)] py-6 text-center">Pick a table.</div>
              : !rows ? <Loading />
              : (
                <>
                  <div className="overflow-auto max-h-96 scroll-thin border border-[var(--line)] rounded-lg">
                    <table className="text-xs w-full">
                      <thead><tr className="border-b border-[var(--line)]">{cols.map((c) => (
                        <th key={c} className="text-left px-2 py-1.5 font-semibold text-[var(--faint)] whitespace-nowrap">
                          <button onClick={() => toggleSort(c)} className="flex items-center gap-1 hover:text-[var(--text)]">
                            {c} {sort.col === c && <ChevronDown size={11} className={sort.dir === 'asc' ? 'rotate-180' : ''} />}
                          </button>
                        </th>
                      ))}</tr></thead>
                      <tbody>
                        {rows.rows.map((r, i) => (
                          <tr key={i} className="border-b border-[var(--line)] last:border-0">
                            {cols.map((c) => (
                              <td key={c} onClick={() => { setCell({ col: c, value: r[c], pk: rows.pkColumn ? r[rows.pkColumn] : null }); setDraft(r[c] === null ? '' : cellText(r[c])); }} className="px-2 py-1.5 whitespace-nowrap max-w-[220px] truncate font-mono cursor-pointer hover:bg-[var(--surface-2)]" title="Click to view / edit">
                                {r[c] === null ? <span className="text-[var(--faint)]">null</span> : cellText(r[c])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center justify-between mt-2 text-xs text-[var(--muted)]">
                    <span>{rows.total} row{rows.total !== 1 ? 's' : ''}</span>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={exportCsv}><Download size={12} /> CSV (page)</Button>
                      <Button size="sm" disabled={page === 0} onClick={() => openTable(active, page - 1)}>Prev</Button>
                      <Button size="sm" disabled={(page + 1) * pageSize >= rows.total} onClick={() => openTable(active, page + 1)}>Next</Button>
                    </div>
                  </div>
                </>
              )}
          </div>
          {cell && (() => {
            const isPk = rows?.pkColumn === cell.col;
            const protected_ = DB_SENSITIVE_COL.test(cell.col);
            const editable = !!rows?.pkColumn && cell.pk != null && !isPk && !protected_;
            const save = async () => {
              if (!(await doubleConfirm(dialog, { title: 'Save row edit', message: `Overwrite ${active}.${cell.col} (row ${cell.pk}) on the live database? The current row is backed up automatically.`, okLabel: 'Save' }))) return;
              setSaving(true);
              try {
                await api.put(`/server/db/table/${encodeURIComponent(active)}/cell`, { pk: cell.pk, column: cell.col, value: draft, confirmToken: 'CONFIRM' });
                toast.success('Saved — the previous row value was backed up.');
                setCell(null);
                openTable(active, page, sort);
              } catch (x) {
                toast.error(x.data?.error === 'table_protected' ? 'Audit/log tables are read-only — they can\'t be edited here.' : x.data?.error === 'column_protected' ? 'This column can\'t be edited here.' : x.data?.error === 'update_failed' ? `Failed: ${x.data?.detail || 'invalid value'}` : 'Failed.');
              } finally { setSaving(false); }
            };
            const viewRowHistory = async () => {
              try { const r = await api.get(`/server/db/backups?table=${encodeURIComponent(active)}&pk=${encodeURIComponent(cell.pk)}`); setRowHistory({ table: active, pk: cell.pk, items: r.history }); }
              catch { toast.error('Failed to load history.'); }
            };
            return (
              <Modal open onClose={() => setCell(null)} title={cell.col} icon={HardDrive} width="max-w-lg"
                footer={editable ? <><Button onClick={() => setCell(null)}>Cancel</Button><Button onClick={viewRowHistory}><History size={13} /> History</Button><Button variant="primary" disabled={saving} onClick={save}>{saving ? <Spinner /> : 'Save'}</Button></> : undefined}>
                {editable ? (
                  <textarea value={draft} onChange={(e) => setDraft(e.target.value)} className="w-full h-40 font-mono text-xs bg-[var(--surface-2)] rounded-lg p-3 outline-none" spellCheck={false} />
                ) : (
                  <>
                    <pre className="text-xs font-mono bg-[var(--surface-2)] rounded-lg p-3 max-h-80 overflow-auto scroll-thin whitespace-pre-wrap break-all">{cell.value === null ? 'null' : cellText(cell.value)}</pre>
                    <p className="text-xs text-[var(--faint)] mt-2">{protected_ ? "This column can't be edited here (sensitive)." : isPk ? "The primary key can't be edited." : 'This table has no single-column primary key, so it can only be viewed.'}</p>
                  </>
                )}
              </Modal>
            );
          })()}
          {rowHistory && (
            <Modal open onClose={() => setRowHistory(null)} title={`Row backup history — ${rowHistory.table} (pk=${rowHistory.pk})`} icon={History} width="max-w-lg">
              {rowHistory.items.length ? (
                <div className="divide-y divide-[var(--line)] max-h-96 overflow-auto scroll-thin">
                  {rowHistory.items.map((h) => (
                    <div key={h.hash} className="flex items-center gap-2.5 py-2 text-sm">
                      <div className="flex-1 min-w-0"><div className="truncate">{h.message}</div><div className="text-[11px] text-[var(--faint)]">{new Date(h.at).toLocaleString()} · <code className="font-mono">{h.hash.slice(0, 8)}</code></div></div>
                      <Button size="sm" onClick={async () => {
                        if (!(await doubleConfirm(dialog, { title: 'Restore this row', message: `Overwrite ${rowHistory.table} (pk=${rowHistory.pk}) with this backed-up version? Sensitive columns are never restored. The current row is backed up first.`, okLabel: 'Restore' }))) return;
                        try { const r = await api.post(`/server/db/backups/${h.hash}/restore`, { table: rowHistory.table, pk: rowHistory.pk, confirmToken: 'CONFIRM' }); toast.success(`Restored ${r.restored.length} column(s)${r.skipped.length ? `, skipped ${r.skipped.length}` : ''}.`); setRowHistory(null); setCell(null); openTable(active, page, sort); }
                        catch { toast.error('Failed to restore.'); }
                      }}>Restore</Button>
                    </div>
                  ))}
                </div>
              ) : <div className="text-xs text-[var(--faint)] py-6 text-center">No backups yet for this row.</div>}
            </Modal>
          )}
        </div>
      )}
    </Card>
  );
}

// The step-up-gated "danger zone": file manager, read-only DB viewer, and a
// server restart — all confined to this container/process. Docker management
// and host power control are NOT wired up — they'd require mounting the Docker
// socket (and, for power, a privileged agent), a docker-compose change with real
// security implications that hasn't been made.
function AdminServerAdvanced() {
  const toast = useToast(); const dialog = useDialog();
  const me2fa = useAsync(() => api.get('/me/2fa'), []);
  const elevateStatus = useAsync(() => api.get('/server/elevate/status').catch(() => ({ elevated: false })), []);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [restarting, setRestarting] = useState(false);

  const elevate = async () => {
    setBusy(true);
    try { await api.post('/server/elevate', { code: code.trim() }); toast.success('Elevated for 15 minutes.'); setCode(''); elevateStatus.reload(); }
    catch (x) { toast.error(x.data?.error === 'invalid_code' ? 'Invalid code.' : x.data?.error === '2fa_not_enabled' ? 'Enable 2FA in your profile first.' : x.data?.error === 'forbidden' ? "You don't have server-control access." : 'Failed.'); }
    finally { setBusy(false); }
  };
  const restart = async () => {
    if (!(await dialog.confirm({ title: 'Restart the API server', message: 'This restarts the api container. Everyone will briefly lose connection (usually a few seconds). Continue?', okLabel: 'Restart', danger: true }))) return;
    setRestarting(true);
    try { await api.post('/server/restart'); toast.success('Restarting — back in a few seconds.'); } catch { toast.error('Failed.'); setRestarting(false); }
  };

  if (me2fa.loading || elevateStatus.loading) return <Loading />;
  if (!me2fa.data?.canControlServer) return <EmptyState icon={AlertTriangle} title="Not authorized" sub="A SUPERADMIN must grant you server-control access from the Roles & access tab first." />;

  return (
    <div>
      <h2 className="font-semibold mb-1 flex items-center gap-2"><AlertTriangle size={16} className="text-red-400" /> Advanced server management</h2>
      <p className="text-sm text-[var(--muted)] mb-3">Confined to this API container's own filesystem/process — no host or Docker access today. A fuller per-service view (Docker start/stop/restart/logs, host power) needs a docker-compose change (mounting the Docker socket, or a separate privileged power agent) that hasn't been made yet.</p>

      {!elevateStatus.data?.elevated ? (
        <Card className="p-5 max-w-sm">
          <div className="text-sm font-semibold mb-2 flex items-center gap-2"><ShieldCheck size={15} className="text-[var(--primary-2)]" /> Step-up verification required</div>
          <p className="text-xs text-[var(--muted)] mb-3">Enter a fresh code from your authenticator app to unlock these tools for 15 minutes.</p>
          <div className="flex gap-2">
            <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="123456" />
            <Button variant="primary" disabled={busy || code.length !== 6} onClick={elevate}>{busy ? <Spinner /> : 'Elevate'}</Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          <FileManager />
          <DbViewer />
          <BackupManager />
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-2 text-sm"><RefreshCw size={14} className="text-red-400" /><span className="font-semibold">Restart server</span></div>
            <p className="text-xs text-[var(--muted)] mb-3">Restarts the api container (Docker's own `restart: unless-stopped` policy brings it right back — no Docker-socket access needed for this).</p>
            <Button className="!text-red-400" disabled={restarting} onClick={restart}>{restarting ? <Spinner /> : 'Restart now'}</Button>
          </Card>
        </div>
      )}
    </div>
  );
}

// Backups here are git-based history for edits made through the File manager
// and DB viewer above (see gitbackup.mjs) — NOT a full disaster-recovery
// backup of the whole app. Size shown here is also mirrored in the admin
// Storage tab's ledger.
function BackupManager() {
  const toast = useToast();
  const { data, loading, reload } = useAsync(() => api.get('/server/backups/usage'), []);
  const [limitGB, setLimitGB] = useState('');
  const [busy, setBusy] = useState(false);
  const [gcBusy, setGcBusy] = useState(false);
  const saveLimit = async () => {
    setBusy(true);
    try { await api.put('/server/backups/limit', { maxBytes: limitGB.trim() ? Math.round(Number(limitGB) * 1024 ** 3) : null }); toast.success('Saved.'); setLimitGB(''); reload(); }
    catch { toast.error('Failed.'); } finally { setBusy(false); }
  };
  const runGc = async () => {
    setGcBusy(true);
    try { await api.post('/server/backups/gc'); toast.success('Compacted.'); reload(); } catch { toast.error('Failed.'); } finally { setGcBusy(false); }
  };
  if (loading) return <Loading />;
  const d = data || {};
  const pct = d.maxBytes ? Math.min(100, (d.totalBytes / d.maxBytes) * 100) : 0;
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-2 text-sm"><History size={14} className="text-[var(--primary-2)]" /><span className="font-semibold">Backup storage</span></div>
      <p className="text-xs text-[var(--muted)] mb-3">Every file edit/delete and DB row edit is git-committed first, so it can always be rolled back — plus a full daily snapshot of the file tree. This is separate from the app's own storage (see the Storage tab).</p>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div><div className="text-xs text-[var(--faint)] mb-0.5">File history</div><div className="text-lg font-bold tabular-nums">{fmtBytes(d.filesBytes || 0)}</div></div>
        <div><div className="text-xs text-[var(--faint)] mb-0.5">DB row history</div><div className="text-lg font-bold tabular-nums">{fmtBytes(d.dbBytes || 0)}</div></div>
      </div>
      {d.maxBytes != null && (
        <div className="mb-3">
          <div className="h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className={`h-full ${pct >= 90 ? 'bg-red-500' : 'bg-gradient-to-r from-orange-500 to-amber-400'}`} style={{ width: `${pct}%` }} /></div>
          <div className="text-[11px] text-[var(--faint)] mt-1">{fmtBytes(d.totalBytes)} / {fmtBytes(d.maxBytes)} ({Math.round(pct)}%)</div>
        </div>
      )}
      <div className="grid sm:grid-cols-[1fr_auto_auto] gap-2">
        <Input type="number" value={limitGB} onChange={(e) => setLimitGB(e.target.value)} placeholder={d.maxBytes ? `Currently ${(d.maxBytes / 1024 ** 3).toFixed(1)} GB — blank = unlimited` : 'Size limit in GB (blank = unlimited)'} />
        <Button variant="primary" disabled={busy} onClick={saveLimit}>{busy ? <Spinner /> : 'Save limit'}</Button>
        <Button disabled={gcBusy} onClick={runGc} title="Runs git gc on the backup repos to reclaim space from old/loose objects. Non-destructive: NO history is deleted — every version can still be restored.">{gcBusy ? <Spinner /> : 'Compact backups'}</Button>
      </div>
      <p className="text-[11px] text-[var(--faint)] mt-2"><b>Compact backups</b> reclaims disk space by garbage-collecting the backup git repos (loose/duplicate objects). It never deletes history — every past version stays restorable.</p>
    </Card>
  );
}

// SUPERADMIN-only: the site-wide access policy, role reassignment, and the
// server-control permission grant. Blog-post access grants moved to their own
// tab (AdminBlogAccess, below) since that stays ADMIN-accessible.
function AdminRoles() {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState(null); // the user currently being managed
  const [roleSel, setRoleSel] = useState('USER');

  const search = async () => {
    if (!q.trim()) return setResults(null);
    setBusy(true);
    try { const { users } = await api.get(`/admin/users?q=${encodeURIComponent(q)}&take=10`); setResults(users); } catch { setResults([]); } finally { setBusy(false); }
  };
  const pick = (u) => { setPicked(u); setRoleSel(u.role); };

  const saveRole = async () => {
    setBusy(true);
    try { await api.put(`/admin/users/${picked.id}/role`, { role: roleSel }); toast.success(`${picked.displayName} is now ${roleSel}.`); setPicked((p) => ({ ...p, role: roleSel })); }
    catch (x) { toast.error(x.data?.error === 'cannot_change_own_role' ? "You can't change your own role." : x.data?.error || 'Failed.'); }
    finally { setBusy(false); }
  };
  const toggleServerControl = async () => {
    setBusy(true);
    try { await api.put(`/admin/server-control/${picked.id}`, { granted: !picked.canControlServer }); toast.success(`Server-control ${!picked.canControlServer ? 'granted to' : 'revoked from'} ${picked.displayName}.`); setPicked((p) => ({ ...p, canControlServer: !p.canControlServer })); }
    catch { toast.error('Failed.'); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-6">
      <GlobalAccessPolicyCard />
      <div>
        <h2 className="font-semibold mb-1 flex items-center gap-2"><Shield size={16} className="text-[var(--primary-2)]" /> Find a user</h2>
        <p className="text-sm text-[var(--muted)] mb-3">Reassign a role and/or grant server-control access. Search by user id, display name, email, a linked <b>creator id</b>, or a linked <b>Discord</b> (username / id).</p>
        <div className="flex gap-2 mb-3">
          <div className="relative flex-1"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
            <Input className="!pl-9" placeholder="id / display name / email / creator id / Discord…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} /></div>
          <Button variant="primary" disabled={busy} onClick={search}>{busy ? <Spinner /> : <><Search size={15} /> Search</>}</Button>
        </div>
        {results && (results.length ? <div className="space-y-1.5">
          {results.map((u) => (
            <button key={u.id} onClick={() => pick(u)} className={`w-full text-left card p-3 flex items-center gap-3 ${picked?.id === u.id ? 'border-[var(--primary)]' : ''}`}>
              <Avatar user={u} size={32} />
              <div className="flex-1 min-w-0"><div className="font-medium truncate flex items-center gap-2">{u.displayName} <Badge tone={u.role === 'SUPERADMIN' ? 'red' : u.role === 'ADMIN' ? 'amber' : u.role === 'MOD' ? 'primary' : ''}>{u.role}</Badge></div><div className="text-xs text-[var(--faint)] truncate">{u.email}</div></div>
            </button>
          ))}
        </div> : <div className="text-sm text-[var(--faint)]">No users found.</div>)}
      </div>

      {picked && (
        <Card className="p-5">
          <div className="flex items-center gap-3 mb-4"><Avatar user={picked} size={40} /><div><div className="font-semibold">{picked.displayName}</div><div className="text-xs text-[var(--faint)]">{picked.email}</div></div></div>

          <div className="mb-5 pb-5 border-b border-[var(--line)]">
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">Role</div>
            <div className="flex items-center gap-2">
              <Select className="!w-auto" value={roleSel} onChange={(e) => setRoleSel(e.target.value)}>
                <option value="USER">USER</option><option value="MOD">MOD</option><option value="ADMIN">ADMIN</option><option value="SUPERADMIN">SUPERADMIN</option>
              </Select>
              <Button size="sm" variant="primary" disabled={busy || roleSel === picked.role} onClick={saveRole}>{busy ? <Spinner /> : 'Save role'}</Button>
            </div>
          </div>

          {(picked.role === 'ADMIN' || picked.role === 'SUPERADMIN' || picked.canControlServer) && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">Server-control tools</div>
              <p className="text-xs text-[var(--muted)] mb-2">Grants access to the server performance dashboard's dangerous actions (DB viewer, restart) — still gated by that user's own 2FA step-up on top of this. {!picked.totpEnabled && <span className="text-amber-400">This user hasn't enabled 2FA yet, so the tools stay locked either way.</span>}</p>
              <Button size="sm" variant={picked.canControlServer ? 'default' : 'primary'} disabled={busy} onClick={toggleServerControl}>{busy ? <Spinner /> : (picked.canControlServer ? 'Revoke server-control' : 'Grant server-control')}</Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// ADMIN+: grant/revoke blog-post permissions — moved out of Roles & access (now
// SUPERADMIN-only) since this stays a regular ADMIN capability.
function AdminBlogAccess() {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState(null);
  const [scopeSel, setScopeSel] = useState('global');
  const scopes = useAsync(() => api.get('/blog/my-scopes'), []);
  const grants = useAsync(() => api.get('/admin/blog-permissions'), []);

  const search = async () => {
    if (!q.trim()) return setResults(null);
    setBusy(true);
    try { const { users } = await api.get(`/admin/users?q=${encodeURIComponent(q)}&take=10`); setResults(users); } catch { setResults([]); } finally { setBusy(false); }
  };
  const pick = (u) => { setPicked(u); setScopeSel('global'); };
  const grantBlog = async () => {
    setBusy(true);
    try {
      const [kind, val] = scopeSel.split(':');
      await api.post('/admin/blog-permissions', { userId: picked.id, projectKey: kind === 'project' ? val : null, showcaseSlug: kind === 'showcase' ? val : null });
      toast.success(`Granted blog access to ${picked.displayName}.`); grants.reload();
    } catch (x) { toast.error(x.data?.error || 'Failed.'); } finally { setBusy(false); }
  };
  const revoke = async (g) => {
    try { await api.del(`/admin/blog-permissions/${g.id}`); toast.success('Revoked.'); grants.reload(); } catch { toast.error('Failed.'); }
  };
  const scopeLabel = (g) => g.showcase ? `Custom · ${g.showcase.name}` : g.projectKey ? `Project · ${g.projectKey.toUpperCase()}` : 'Global (all blogs)';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-semibold mb-1 flex items-center gap-2"><PenSquare size={16} className="text-[var(--primary-2)]" /> Find a user</h2>
        <p className="text-sm text-[var(--muted)] mb-3">Grant blog-post access to a regular user. Search by user id, display name, email, a linked <b>creator id</b>, or a linked <b>Discord</b> (username / id).</p>
        <div className="flex gap-2 mb-3">
          <div className="relative flex-1"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
            <Input className="!pl-9" placeholder="id / display name / email / creator id / Discord…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} /></div>
          <Button variant="primary" disabled={busy} onClick={search}>{busy ? <Spinner /> : <><Search size={15} /> Search</>}</Button>
        </div>
        {results && (results.length ? <div className="space-y-1.5">
          {results.map((u) => (
            <button key={u.id} onClick={() => pick(u)} className={`w-full text-left card p-3 flex items-center gap-3 ${picked?.id === u.id ? 'border-[var(--primary)]' : ''}`}>
              <Avatar user={u} size={32} />
              <div className="flex-1 min-w-0"><div className="font-medium truncate flex items-center gap-2">{u.displayName} <Badge tone={u.role === 'SUPERADMIN' ? 'red' : u.role === 'ADMIN' ? 'amber' : u.role === 'MOD' ? 'primary' : ''}>{u.role}</Badge></div><div className="text-xs text-[var(--faint)] truncate">{u.email}</div></div>
            </button>
          ))}
        </div> : <div className="text-sm text-[var(--faint)]">No users found.</div>)}
      </div>

      {picked && (
        <Card className="p-5">
          <div className="flex items-center gap-3 mb-4"><Avatar user={picked} size={40} /><div><div className="font-semibold">{picked.displayName}</div><div className="text-xs text-[var(--faint)]">{picked.email}</div></div></div>
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">Grant blog-post access</div>
          <div className="flex flex-wrap items-center gap-2">
            <Select className="!w-auto" value={scopeSel} onChange={(e) => setScopeSel(e.target.value)}>
              <option value="global">Global (all blogs)</option>
              {(scopes.data?.projects || []).map((pr) => <option key={pr.key} value={`project:${pr.key}`}>Project · {pr.name}</option>)}
              {(scopes.data?.showcases || []).map((s) => <option key={s.slug} value={`showcase:${s.slug}`}>Custom · {s.name}</option>)}
            </Select>
            <Button size="sm" variant="primary" disabled={busy} onClick={grantBlog}>{busy ? <Spinner /> : <><Plus size={14} /> Grant</>}</Button>
          </div>
        </Card>
      )}

      <div>
        <h2 className="font-semibold mb-1 flex items-center gap-2"><PenSquare size={16} className="text-[var(--primary-2)]" /> Blog-post grants</h2>
        <p className="text-sm text-[var(--muted)] mb-3">Regular users who can write blog posts, and where.</p>
        {grants.loading ? <Loading /> : (grants.data?.grants || []).length ? <div className="space-y-1.5">
          {grants.data.grants.map((g) => (
            <Card key={g.id} className="p-3 flex items-center gap-3">
              <Avatar user={g.user} size={32} />
              <div className="flex-1 min-w-0"><div className="font-medium truncate">{g.user?.displayName || '(deleted)'}</div><div className="text-xs text-[var(--faint)] truncate">{g.user?.email}</div></div>
              <Badge tone="primary">{scopeLabel(g)}</Badge>
              <Button size="sm" variant="ghost" className="!text-red-400" onClick={() => revoke(g)}><Trash2 size={13} /></Button>
            </Card>
          ))}
        </div> : <EmptyState icon={PenSquare} title="No grants yet" sub="Regular users can't write blog posts until you grant access above." />}
      </div>
    </div>
  );
}

const ANN_TONE = { info: 'primary', warning: 'amber', success: 'green' };
// Icon + accent per announcement tone — shared shape used by the admin list, the
// site banner (App.jsx has its own copy) and the notification bell.
export const ANN_TONE_ICON = { info: Info, warning: AlertTriangle, success: CheckCircle2 };
const ANN_BODY_MAX = 500; // banner bodies stay short/scannable; hard-capped server-side too
// Admin: site-wide banner announcements (auto-notifies every user on publish) plus
// a standalone "notify everyone" action for a one-off ping with no persistent banner.
function AdminAnnouncements() {
  const toast = useToast(); const dialog = useDialog();
  const { data, loading, reload } = useAsync(() => api.get('/admin/announcements'), []);
  const [f, setF] = useState({ title: '', body: '', tone: 'info', showBanner: true, linkUrl: '' });
  const [busy, setBusy] = useState(false);
  const [broadcastMsg, setBroadcastMsg] = useState('');
  const [broadcastBusy, setBroadcastBusy] = useState(false);
  const announcements = data?.announcements || [];

  const create = async () => {
    if (f.title.length < 2) return toast.error('Title is required.');
    setBusy(true);
    try { const r = await api.post('/admin/announcements', { ...f, linkUrl: f.linkUrl.trim() || null }); toast.success(`Published — notified ${r.notified} user${r.notified !== 1 ? 's' : ''}.`); setF({ title: '', body: '', tone: 'info', showBanner: true, linkUrl: '' }); reload(); }
    catch (x) { toast.error(x.data?.error || 'Failed.'); } finally { setBusy(false); }
  };
  const toggleActive = async (a) => { try { await api.put(`/admin/announcements/${a.id}`, { active: !a.active }); reload(); } catch { toast.error('Failed.'); } };
  const toggleBanner = async (a) => { try { await api.put(`/admin/announcements/${a.id}`, { showBanner: !a.showBanner }); reload(); } catch { toast.error('Failed.'); } };
  const del = async (a) => {
    if (!(await dialog.confirm({ title: 'Delete announcement', message: `Delete "${a.title}"?`, okLabel: 'Delete', danger: true }))) return;
    try { await api.del(`/admin/announcements/${a.id}`); toast.success('Deleted.'); reload(); } catch { toast.error('Failed.'); }
  };
  const notifyAll = async () => {
    if (broadcastMsg.length < 2) return toast.error('Message is required.');
    if (!(await dialog.confirm({ title: 'Notify every user', message: 'This pushes a notification to every registered user immediately. Continue?', okLabel: 'Send' }))) return;
    setBroadcastBusy(true);
    try { const r = await api.post('/admin/notify-all', { body: broadcastMsg }); toast.success(`Sent to ${r.notified} user${r.notified !== 1 ? 's' : ''}.`); setBroadcastMsg(''); }
    catch (x) { toast.error(x.data?.error || 'Failed.'); } finally { setBroadcastBusy(false); }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-semibold mb-1 flex items-center gap-2"><BellIcon size={16} className="text-[var(--primary-2)]" /> New announcement</h2>
        <p className="text-sm text-[var(--muted)] mb-3">Shows as a dismissible banner on every page and immediately notifies every user.</p>
        <Card className="p-4 space-y-3">
          <div className="grid sm:grid-cols-[1fr_auto] gap-3">
            <Field label="Title"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Scheduled maintenance tonight" /></Field>
            <Field label="Tone"><Select value={f.tone} onChange={(e) => setF({ ...f, tone: e.target.value })}><option value="info">Info</option><option value="warning">Warning</option><option value="success">Success</option></Select></Field>
          </div>
          <Field label={<span className="flex items-center justify-between w-full">Body (optional) <span className={`text-[10px] tabular-nums ${f.body.length > ANN_BODY_MAX ? 'text-red-400' : 'text-[var(--faint)]'}`}>{f.body.length}/{ANN_BODY_MAX}</span></span>}>
            <Textarea value={f.body} maxLength={ANN_BODY_MAX} onChange={(e) => setF({ ...f, body: e.target.value.slice(0, ANN_BODY_MAX) })} placeholder="More detail shown after the title…" />
          </Field>
          <Field label="Link (optional)"><Input value={f.linkUrl} onChange={(e) => setF({ ...f, linkUrl: e.target.value })} placeholder="/blog/my-post or https://example.com" /></Field>
          <label className="flex items-center gap-2 text-sm text-[var(--muted)]"><input type="checkbox" checked={f.showBanner} onChange={(e) => setF({ ...f, showBanner: e.target.checked })} /> Also show as a dismissible site-wide banner (always notifies everyone either way)</label>
          <div className="flex justify-end"><Button variant="primary" disabled={busy} onClick={create}>{busy ? <Spinner /> : <><Bell size={15} /> Publish & notify everyone</>}</Button></div>
        </Card>
      </div>

      <div>
        <h2 className="font-semibold mb-1 flex items-center gap-2"><Send size={16} className="text-[var(--primary-2)]" /> Notify everyone (no banner)</h2>
        <p className="text-sm text-[var(--muted)] mb-3">A one-off notification pushed to every user's bell menu, with no site-wide banner.</p>
        <Card className="p-4 flex flex-col sm:flex-row gap-2">
          <Input className="flex-1" value={broadcastMsg} onChange={(e) => setBroadcastMsg(e.target.value)} placeholder="A quick message to every user…" />
          <Button variant="primary" disabled={broadcastBusy} onClick={notifyAll}>{broadcastBusy ? <Spinner /> : <><Send size={15} /> Send to everyone</>}</Button>
        </Card>
      </div>

      <div>
        <h2 className="font-semibold mb-1 flex items-center gap-2"><Bell size={16} className="text-[var(--primary-2)]" /> Announcements</h2>
        {loading ? <Loading /> : announcements.length ? <div className="space-y-2">
          {announcements.map((a) => {
            const TIcon = ANN_TONE_ICON[a.tone] || Info;
            return (
            <Card key={a.id} className="p-4 flex items-center gap-3">
              <Badge tone={ANN_TONE[a.tone] || 'primary'}><TIcon size={11} /> {a.tone}</Badge>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{a.title}</div>
                {a.body && <div className="text-xs text-[var(--muted)] truncate">{a.body}</div>}
                {a.linkUrl && <div className="text-xs text-[var(--primary-2)] truncate flex items-center gap-1"><Link2 size={11} /> {a.linkUrl}</div>}
              </div>
              <Badge tone={a.active ? 'green' : ''}>{a.active ? 'active' : 'inactive'}</Badge>
              <Button size="sm" variant="ghost" onClick={() => toggleBanner(a)} title="Toggle the site-wide banner for this announcement">{a.showBanner ? <Monitor size={13} /> : <MonitorOff size={13} />} {a.showBanner ? 'Banner on' : 'No banner'}</Button>
              <Button size="sm" variant="ghost" onClick={() => toggleActive(a)}>{a.active ? 'Deactivate' : 'Activate'}</Button>
              <Button size="sm" variant="ghost" className="!text-red-400" onClick={() => del(a)}><Trash2 size={13} /></Button>
            </Card>
            );
          })}
        </div> : <EmptyState icon={BellIcon} title="No announcements yet" />}
      </div>
    </div>
  );
}

function UserDetailModal({ id, onClose }) {
  const { data, loading } = useAsync(() => api.get(`/admin/users/${id}`), [id]);
  const toast = useToast();
  const u = data?.user;
  const hosted = (u?.serverRepos || []).filter((r) => r.hosted);
  const listed = (u?.serverRepos || []).filter((r) => !r.hosted);
  const fdate = (d) => new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  // Per-element unique BC id chip (copyable) — shown on each repo / catalog item.
  const BcChip = ({ code }) => code ? (
    <button onClick={() => { navigator.clipboard?.writeText(code); toast.success('Element BC id copied.'); }}
      className="shrink-0 inline-flex items-center gap-1 text-[10px] font-mono text-[var(--faint)] hover:text-[var(--primary-2)] transition" title={`Unique element id · ${code}`}>
      <Fingerprint size={10} /> {code}
    </button>
  ) : null;
  return (
    <Modal open onClose={onClose} title="User details" icon={Users} width="max-w-lg"
      footer={<Button variant="ghost" onClick={onClose}>Close</Button>}>
      {loading ? <Loading /> : !u ? <EmptyState icon={XCircle} title="Not found" /> : (
        <div className="space-y-5">
          <div className="flex items-center gap-4">
            <Avatar user={u} size={64} />
            <div className="min-w-0">
              <div className="text-lg font-bold flex items-center gap-2">{u.displayName} <Badge tone={u.role === 'SUPERADMIN' ? 'red' : u.role === 'ADMIN' ? 'amber' : u.role === 'MOD' ? 'primary' : ''}>{u.role}</Badge></div>
              <div className="text-sm text-[var(--muted)] flex items-center gap-1.5"><Mail size={13} /> {u.email}</div>
              <div className="text-xs text-[var(--faint)] mt-0.5 flex items-center gap-1.5"><Cookie size={12} /> Member since {fdate(u.createdAt)}</div>
              <div className="text-[11px] text-[var(--faint)] font-mono mt-0.5">{u.id}</div>
              {u.bcId && (
                <button onClick={() => { navigator.clipboard?.writeText(u.bcId); toast.success('Unique BC id copied.'); }}
                  className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-mono font-semibold text-[var(--primary-2)] px-2 py-1 rounded-md bg-[var(--surface-2)] border border-[var(--line)] hover:border-[var(--primary)]/40 transition"
                  title="Unique BC id — searchable in User search">
                  <Fingerprint size={12} /> {u.bcId} <Copy size={11} className="opacity-60" />
                </button>
              )}
            </div>
          </div>
          {u.bio && <p className="text-sm text-[var(--muted)]">{u.bio}</p>}

          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5 flex items-center gap-1.5"><BadgeCheck size={12} /> Linked creator ids</div>
            {u.creatorLinks.length ? <div className="flex flex-wrap gap-1.5">{u.creatorLinks.map((c) => <Badge key={c.creatorId} tone="green"><code>{c.creatorId}</code>{c.displayName ? ` · ${c.displayName}` : ''}</Badge>)}</div>
              : <div className="text-sm text-[var(--faint)]">No creator id linked.</div>}
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5 flex items-center gap-1.5"><DiscordIcon size={12} /> Discord</div>
            {u.discordLinks?.length ? <div className="space-y-1">{u.discordLinks.map((d) => (
              <div key={d.discordId} className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-[var(--surface-2)]">
                <DiscordIcon size={13} className="text-[#5865F2] shrink-0" />
                <span className="font-medium">{d.username || '—'}</span>
                <code className="text-xs text-[var(--faint)]">{d.discordId}</code>
                <span className="text-[11px] text-[var(--faint)] ml-auto shrink-0">linked {fdate(d.linkedAt)}</span>
              </div>
            ))}</div> : <div className="text-sm text-[var(--faint)]">No Discord linked.</div>}
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5 flex items-center gap-1.5"><Receipt size={12} /> Payments ({u.payments?.length || 0})</div>
            {u.payments?.length ? <div className="space-y-1 max-h-40 overflow-auto pr-1">{u.payments.map((pay) => (
              <div key={pay.id} className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-[var(--surface-2)]">
                <Receipt size={13} className="text-emerald-400 shrink-0" />
                <span className="flex-1 truncate">{pay.description}</span>
                <span className="text-emerald-400 font-medium shrink-0">${(pay.amountCents / 100).toFixed(2)}</span>
                <span className="text-[11px] text-[var(--faint)] shrink-0">{fdate(pay.createdAt)}</span>
              </div>
            ))}</div> : <div className="text-sm text-[var(--faint)]">No payments — free plan only.</div>}
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5 flex items-center gap-1.5"><Rocket size={12} /> Hosted repos ({hosted.length})</div>
            {hosted.length ? <div className="space-y-1 max-h-40 overflow-auto pr-1">{hosted.map((r) => <div key={r.id} className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-[var(--surface-2)]"><Server size={13} className="text-[var(--primary-2)] shrink-0" /><span className="flex-1 truncate">{r.name}</span><BcChip code={r.fingerprint} /><Badge tone={r.status === 'ONLINE' ? 'green' : ''}>{r.status}</Badge></div>)}</div>
              : <div className="text-sm text-[var(--faint)]">None.</div>}
          </div>

          {listed.length > 0 && <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5 flex items-center gap-1.5"><GitBranch size={12} /> Listed repos ({listed.length})</div>
            <div className="space-y-1 max-h-40 overflow-auto pr-1">{listed.map((r) => <div key={r.id} className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-[var(--surface-2)]"><GitBranch size={13} className="text-[var(--primary-2)] shrink-0" /><span className="flex-1 truncate">{r.name}</span><BcChip code={r.fingerprint} />{r.verified && <Badge tone="green">verified</Badge>}</div>)}</div>
          </div>}

          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5 flex items-center gap-1.5"><Package size={12} /> Catalog items ({u.items.length})</div>
            {u.items.length ? <div className="space-y-1 max-h-40 overflow-auto pr-1">{u.items.map((it) => { const I = KIND_ICON[it.kind] || Package; return <div key={it.id} className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-[var(--surface-2)]"><I size={13} className="text-[var(--primary-2)] shrink-0" /><span className="flex-1 truncate">{it.name}</span><BcChip code={it.fingerprint} /><Badge tone={statusTone(it.status)}>{it.status}</Badge></div>; })}</div>
              : <div className="text-sm text-[var(--faint)]">None.</div>}
          </div>
        </div>
      )}
    </Modal>
  );
}

function PluginContentModal({ item, onClose }) {
  const { data, loading, err } = useAsync(() => api.get(`/admin/catalog/${item.id}/plugin-content`), [item.id]);
  const kb = (n) => (Number(n) / 1024).toFixed(1);
  // Download a single extracted file (same-origin → session cookie is sent).
  const dlFile = (path) => { const a = document.createElement('a'); a.href = `/api/admin/catalog/${item.id}/plugin-file?path=${encodeURIComponent(path)}`; a.download = path.split('/').pop() || 'file'; document.body.appendChild(a); a.click(); a.remove(); };
  // The endpoint 502s when a plugin has no source (no payload / URL) — surface that
  // gracefully instead of crashing on data.valid.
  const errMsg = data?.error ? (data.detail || data.error) : err ? (err.data?.detail || err.data?.error || 'This plugin has no downloadable source.') : null;
  return (
    <Modal open onClose={onClose} title={`Plugin content — ${item.name}`} icon={Files} width="max-w-2xl"
      footer={<><Button variant="ghost" onClick={onClose}>Close</Button>{data?.downloadUrl && <a href={data.downloadUrl} target="_blank" rel="noreferrer"><Button variant="primary"><Download size={15} /> Download .bmmplug</Button></a>}</>}>
      {loading ? <Loading /> : errMsg ? (
        <div className="flex items-start gap-2.5 text-sm text-[var(--muted)] py-2">
          <XCircle size={18} className="text-amber-400 shrink-0 mt-0.5" />
          <div>Could not inspect this plugin: <b className="text-[var(--text)]">{errMsg}</b>
            <div className="text-xs text-[var(--faint)] mt-1">A plugin with no uploaded file or download URL can't be unzipped. Add a source, then re-validate.</div></div>
        </div>
      ) : data ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            {data.valid ? <Badge tone="green"><CheckCircle2 size={11} /> Valid</Badge> : <Badge tone="red"><XCircle size={11} /> {data.reason}</Badge>}
            <span className="text-[var(--faint)] text-xs">{kb(data.size)} KB · sha {String(data.sha256).slice(0, 16)}…</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)]">Files ({(data.files || []).length})</span>
            {data.downloadUrl && <a href={data.downloadUrl} target="_blank" rel="noreferrer" className="text-xs text-[var(--primary-2)] hover:underline flex items-center gap-1"><Download size={12} /> Download all (.bmmplug)</a>}
          </div>
          <div className="space-y-1 max-h-[38vh] overflow-auto">
            {(data.files || []).map((fl) => (
              <div key={fl.path} className="group flex items-center gap-2.5 px-3 py-2 rounded-lg bg-[var(--surface-2)] text-sm">
                {fl.ok ? <CheckCircle2 size={14} className="text-emerald-400 shrink-0" /> : <XCircle size={14} className="text-red-400 shrink-0" />}
                <span className="flex-1 truncate font-mono text-xs">{fl.path}</span>
                <span className="text-xs text-[var(--faint)]">{kb(fl.size)} KB</span>
                <button onClick={() => dlFile(fl.path)} title="Download this file" className="text-[var(--faint)] hover:text-[var(--primary-2)] shrink-0"><Download size={13} /></button>
              </div>
            ))}
          </div>
          {data.manifest && <div><div className="text-xs font-semibold text-[var(--faint)] uppercase mb-1.5">plugin.json (never executed)</div>
            <pre className="text-xs bg-[var(--surface-2)] rounded-lg p-3 max-h-48 overflow-auto">{JSON.stringify(data.manifest, null, 2)}</pre></div>}
        </div>
      ) : null}
    </Modal>
  );
}

// Admin: provision a hosted repo for free (no Stripe), optionally for another user.
function AdminFreeHost() {
  const toast = useToast();
  const plans = useAsync(() => api.get('/hosting/plans'), []);
  const [f, setF] = useState({ name: '', ownerEmail: '', planId: '', storageGB: 10, uploadMbps: 8, cpuShare: 0.5, listed: false, mode: 'single' });
  const [custom, setCustom] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (f.name.length < 2) return toast.error('Repo name is required.');
    setBusy(true);
    try {
      const body = { name: f.name, listed: f.listed, mode: f.mode };
      if (f.ownerEmail) body.ownerEmail = f.ownerEmail;
      if (custom) { body.storageGB = Number(f.storageGB); body.uploadMbps = Number(f.uploadMbps); body.cpuShare = Number(f.cpuShare); }
      else if (f.planId) body.planId = f.planId;
      await api.post('/admin/repos/host', body);
      toast.success(f.mode === 'multi' ? `Multi-repo pool "${f.name}" provisioned.` : `Hosted repo "${f.name}" provisioned. See it under Server repos.`);
      setF({ name: '', ownerEmail: '', planId: '', storageGB: 10, uploadMbps: 8, cpuShare: 0.5, listed: false, mode: 'single' });
    } catch (x) { toast.error(x.data?.error === 'user_not_found' ? 'No user with that email.' : x.data?.error || 'Failed.'); } finally { setBusy(false); }
  };
  return (
    <div>
      <h2 className="font-semibold mb-1 flex items-center gap-2"><Rocket size={16} className="text-[var(--primary-2)]" /> Host a Server-Repo (free)</h2>
      <p className="text-sm text-[var(--muted)] mb-4">Provisions a hosted, sandboxed repo directly — no payment. Leave the email blank to host it under your own account.</p>
      <Card className="p-5 space-y-3">
        <div className="flex items-center gap-2 text-sm">
          {[['single', 'Single repo'], ['multi', 'Multi-repo pool']].map(([m, l]) => (
            <button key={m} onClick={() => setF({ ...f, mode: m })} className={`px-3 py-1.5 rounded-lg border ${f.mode === m ? 'border-[var(--primary)] bg-orange-500/10' : 'border-[var(--line)] text-[var(--muted)]'}`}>{l}</button>
          ))}
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label={f.mode === 'multi' ? 'Pool name' : 'Repo name'}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="official-server-repo" /></Field>
          <Field label="Owner email (optional)"><Input value={f.ownerEmail} onChange={(e) => setF({ ...f, ownerEmail: e.target.value })} placeholder="you@…" /></Field>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <button onClick={() => setCustom(false)} className={`px-3 py-1.5 rounded-lg border ${!custom ? 'border-[var(--primary)] bg-orange-500/10' : 'border-[var(--line)] text-[var(--muted)]'}`}>Use a plan</button>
          <button onClick={() => setCustom(true)} className={`px-3 py-1.5 rounded-lg border ${custom ? 'border-[var(--primary)] bg-orange-500/10' : 'border-[var(--line)] text-[var(--muted)]'}`}>Custom size</button>
        </div>
        {custom ? (
          <div className="grid sm:grid-cols-3 gap-3">
            <Field label="Storage (GB)"><Input type="number" value={f.storageGB} onChange={(e) => setF({ ...f, storageGB: e.target.value })} /></Field>
            <Field label="Upload (Mbps)"><Input type="number" value={f.uploadMbps} onChange={(e) => setF({ ...f, uploadMbps: e.target.value })} /></Field>
            <Field label="CPU share"><Input type="number" step="0.1" value={f.cpuShare} onChange={(e) => setF({ ...f, cpuShare: e.target.value })} /></Field>
          </div>
        ) : (
          <Field label="Plan"><Select value={f.planId} onChange={(e) => setF({ ...f, planId: e.target.value })}>
            <option value="">Select a plan…</option>
            {(plans.data?.plans || []).map((pl) => <option key={pl.id} value={pl.id}>{pl.name} — {pl.storageGB}GB</option>)}
          </Select></Field>
        )}
        <label className="flex items-center gap-2 text-sm text-[var(--muted)]"><input type="checkbox" checked={f.listed} onChange={(e) => setF({ ...f, listed: e.target.checked })} /> List publicly once verified</label>
        <div className="flex justify-end"><Button variant="primary" disabled={busy} onClick={submit}>{busy ? <Spinner /> : <><Rocket size={15} /> Provision (free)</>}</Button></div>
      </Card>
    </div>
  );
}

const PROJ_META = { community: { icon: Package, name: 'Community' }, bmm: { icon: Boxes, name: 'BMM' }, bsm: { icon: Music2, name: 'BSM' }, installer: { icon: Download, name: 'Installer' } };
function AdminProjects() {
  const toast = useToast();
  const { data, reload } = useAsync(() => api.get('/projects'), []);
  // Showcase ("Other projects") are configurable here too — added automatically.
  const show = useAsync(() => api.get('/admin/showcase'), []);
  const adminMeta = useAsync(() => api.get('/admin/projects'), []);
  const [scheduling, setScheduling] = useState(false);
  const [active, setActive] = useState('bmm');
  const [text, setText] = useState('');
  const [progUrl, setProgUrl] = useState('');
  const projects = data?.projects || {};
  const showcase = show.data?.projects || [];
  const keys = ['community', 'bmm', 'bsm', 'installer'];
  const isShowcase = active.startsWith('sc:');
  const activeShow = isShowcase ? showcase.find((s) => s.id === active.slice(3)) : null;
  const activeMeta = !isShowcase ? adminMeta.data?.projects.find((p) => p.key === active) : null;
  useEffect(() => {
    if (isShowcase) { if (activeShow) { setText(JSON.stringify(activeShow.config || {}, null, 2)); setProgUrl(activeShow.config?.progressSource || ''); } return; }
    if (projects[active]) { setText(JSON.stringify(projects[active], null, 2)); setProgUrl(projects[active].progressSource || ''); }
  }, [data, show.data, active]);
  const putConfig = async (cfg) => {
    if (isShowcase) await api.put(`/admin/showcase/${activeShow.id}`, { config: cfg });
    else await api.put(`/projects/${active}`, { config: cfg });
  };
  const saveSource = async () => {
    try {
      const cfg = JSON.parse(text || '{}');
      if (progUrl.trim()) cfg.progressSource = progUrl.trim(); else delete cfg.progressSource;
      await putConfig(cfg);
      setText(JSON.stringify(cfg, null, 2)); toast.success('Progress source saved.'); reload(); show.reload?.();
    } catch (x) { toast.error(x.data?.error || 'Save failed.'); }
  };
  // A change on GitHub (progress.json, release notes…) can sit in the server's
  // 5-min proxy cache — this makes it visible on the site immediately.
  const flushCache = async () => {
    try { const r = await api.post('/admin/projects/flush-cache'); toast.success(`Site caches refreshed (${r.flushed} entries) — repo changes are live now.`); }
    catch { toast.error('Failed.'); }
  };
  const previewSource = async () => {
    try { const r = await api.get(`/projects/${active}/progress`); const n = (r.progress?.categories || []).reduce((a, c) => a + (c.items?.length || 0), 0); toast.success(`Fetched progress.json (${n} items).`); }
    catch (x) { toast.error(x.data?.error || x.data?.detail || 'Fetch failed.'); }
  };
  let valid = true; try { JSON.parse(text || '{}'); } catch { valid = false; }
  const format = () => { try { setText(JSON.stringify(JSON.parse(text), null, 2)); } catch { toast.error('Invalid JSON.'); } };
  const save = async () => {
    if (!valid) return toast.error('Invalid JSON.');
    try { await putConfig(JSON.parse(text)); toast.success(`${isShowcase ? activeShow?.name : PROJ_META[active].name} saved.`); reload(); show.reload?.(); }
    catch (x) { toast.error(x.data?.error || 'Save failed.'); }
  };
  const hint = (label, val) => <div><div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)]">{label}</div><code className="text-[11px] text-[var(--muted)]">{val}</code></div>;
  const taRef = useRef(null); const gutRef = useRef(null);
  const lineCount = (text.match(/\n/g) || []).length + 1;
  const M = isShowcase ? { icon: Sparkles, name: activeShow?.name || 'Project' } : PROJ_META[active];
  // Per-blog toggle: this project/page's posts always show on /blog, but only
  // surface in the home page's unified "Latest news" when this is on.
  const showOnHomeNews = isShowcase ? (activeShow?.showOnHomeNews !== false) : (data?.homeNews?.[active] !== false);
  const toggleHomeNews = async () => {
    try {
      if (isShowcase) await api.put(`/admin/showcase/${activeShow.id}`, { showOnHomeNews: !showOnHomeNews });
      else await api.put(`/admin/projects/${active}/home-news`, { show: !showOnHomeNews });
      toast.success(`${M.name} ${!showOnHomeNews ? 'will now show' : 'no longer shows'} in home Latest news.`);
      reload(); show.reload?.();
    } catch { toast.error('Failed.'); }
  };
  // Opt-in "Blog" tab on the project's own page, showing only this project's posts.
  const showBlogTab = isShowcase ? (activeShow?.showBlogTab === true) : (data?.blogTab?.[active] === true);
  const toggleBlogTab = async () => {
    try {
      if (isShowcase) await api.put(`/admin/showcase/${activeShow.id}`, { showBlogTab: !showBlogTab });
      else await api.put(`/admin/projects/${active}/blog-tab`, { show: !showBlogTab });
      toast.success(`${M.name} ${!showBlogTab ? 'now shows' : 'no longer shows'} a Blog tab.`);
      reload(); show.reload?.();
    } catch { toast.error('Failed.'); }
  };
  // Visibility gate — every fixed project except 'community' (which is always public).
  const saveVisibility = async (visibility, whitelist) => {
    try { await api.put(`/admin/projects/${active}/visibility`, { visibility, whitelist }); toast.success('Visibility saved.'); adminMeta.reload?.(); }
    catch { toast.error('Failed.'); }
  };
  return (
    <div className="mt-10">
      <h2 className="font-semibold mb-1 flex items-center gap-2"><Settings2 size={16} className="text-[var(--primary-2)]" /> Projects config</h2>
      <p className="text-sm text-[var(--muted)] mb-4">Configure downloads, links, contributors & messages, the progress tracker, legal docs, and the GitHub release-notes source — per project.</p>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {keys.map((k) => { const Pm = PROJ_META[k]; return (
          <button key={k} onClick={() => setActive(k)}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl border text-sm transition ${active === k ? 'border-[var(--primary)] bg-[var(--surface-2)] text-[var(--text)]' : 'border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]'}`}>
            <AppLogo pkey={k} size={16} fallback={Pm.icon} /> {Pm.name}
          </button>); })}
        {/* Other projects (showcase) — added automatically, same editor. */}
        {showcase.length > 0 && <span className="w-px h-6 bg-[var(--line)] mx-1" />}
        {showcase.map((s) => (
          <button key={s.id} onClick={() => setActive(`sc:${s.id}`)}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl border text-sm transition ${active === `sc:${s.id}` ? 'border-[var(--primary)] bg-[var(--surface-2)] text-[var(--text)]' : 'border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]'}`}>
            <Sparkles size={14} /> {s.name}
          </button>
        ))}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={flushCache} title="Repo changes (progress.json, release notes, links) can sit in a 5-min cache — this applies them now.">
          <RefreshCw size={13} /> Refresh site caches
        </Button>
      </div>
      {/* Progress tracker source: pull the project's progress.json from a URL. */}
      <Card className="p-4 mb-4">
        <div className="flex items-center gap-2 mb-2"><TrendingUp size={15} className="text-[var(--primary-2)]" /><span className="font-medium text-sm">Progress tracker source</span></div>
        <p className="text-xs text-[var(--muted)] mb-3">A raw URL to a <code>progress.json</code> ({'{ lastUpdate, art, code, categories:[{ name, items:[{ label, status, percent }] }] }'}). Rendered live on the project page; leave empty to use the inline <code>progress</code> in the config below.</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input className="flex-1" value={progUrl} onChange={(e) => setProgUrl(e.target.value)} placeholder="https://raw.githubusercontent.com/…/progress.json" />
          <div className="flex gap-2">
            <Button variant="ghost" onClick={previewSource} disabled={!progUrl.trim()}><Globe size={14} /> Test</Button>
            <Button variant="primary" onClick={saveSource}><CheckCircle2 size={14} /> Save source</Button>
          </div>
        </div>
      </Card>
      <Card className="p-4 mb-4 flex items-center gap-3">
        <Newspaper size={15} className="text-[var(--primary-2)] shrink-0" />
        <div className="flex-1"><span className="font-medium text-sm">Show in home "Latest news"</span><p className="text-xs text-[var(--muted)]">{M.name}'s posts always appear on /blog regardless of this — this only controls the home page feed.</p></div>
        <button onClick={toggleHomeNews} className={`relative w-10 h-6 rounded-full transition shrink-0 ${showOnHomeNews ? 'bg-[var(--primary)]' : 'bg-[var(--surface-2)] border border-[var(--line)]'}`}>
          <span className={`absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${showOnHomeNews ? 'translate-x-[18px]' : 'translate-x-0'}`} />
        </button>
      </Card>
      <Card className="p-4 mb-4 flex items-center gap-3">
        <PenSquare size={15} className="text-[var(--primary-2)] shrink-0" />
        <div className="flex-1"><span className="font-medium text-sm">Show "Blog" tab on the project page</span><p className="text-xs text-[var(--muted)]">Adds a Blog tab to {M.name}'s own page, showing only {M.name}'s posts.</p></div>
        <button onClick={toggleBlogTab} className={`relative w-10 h-6 rounded-full transition shrink-0 ${showBlogTab ? 'bg-[var(--primary)]' : 'bg-[var(--surface-2)] border border-[var(--line)]'}`}>
          <span className={`absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${showBlogTab ? 'translate-x-[18px]' : 'translate-x-0'}`} />
        </button>
      </Card>
      {/* Visibility: every fixed project except 'community', which is always public. */}
      {!isShowcase && active !== 'community' && activeMeta && (
        <Card className="p-4 mb-4">
          <VisibilitySection visibility={activeMeta.visibility} whitelist={activeMeta.visibilityWhitelist}
            onVisibility={(v) => saveVisibility(v, activeMeta.visibilityWhitelist)}
            onAddWhitelist={(e) => saveVisibility('whitelist', [...(activeMeta.visibilityWhitelist || []), e])}
            onRemoveWhitelist={(e) => saveVisibility('whitelist', (activeMeta.visibilityWhitelist || []).filter((a) => !(a.type === e.type && a.id === e.id)))} />
        </Card>
      )}
      <div className="flex justify-end mb-4">
        <Button size="sm" variant="ghost" onClick={() => setScheduling(true)} title="Stage a future content swap for this page"><Clock size={13} /> Schedule an update</Button>
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
      {scheduling && (() => {
        let cfg = {}; try { cfg = JSON.parse(text || '{}'); } catch { /* editor currently has invalid JSON — schedule form starts from {} */ }
        const existing = isShowcase ? activeShow : activeMeta;
        return (
          <ScheduleUpdateModal title={`Schedule an update — ${M.name}`} includeNameShort={isShowcase} existing={existing}
            current={isShowcase ? { name: activeShow?.name, short: activeShow?.short, config: cfg } : { config: cfg }}
            onClose={() => setScheduling(false)}
            onSave={async (at, next) => {
              if (isShowcase) await api.put(`/admin/showcase/${activeShow.id}/schedule`, { at, next });
              else await api.put(`/admin/projects/${active}/schedule`, { at, next });
              reload(); show.reload?.(); adminMeta.reload?.();
            }} />
        );
      })()}
    </div>
  );
}

// Real brand icons from simpleicons.org CDN (browsers/OS) or the site favicon
// (referrers), with a Lucide fallback if the image fails.
function BrandImg({ slug, favicon, size = 15, fallback: Fb = Globe }) {
  const [ok, setOk] = useState(true);
  const src = slug ? `https://cdn.simpleicons.org/${slug}` : favicon;
  if (src && ok) return <img src={src} width={size} height={size} onError={() => setOk(false)} className="inline-block object-contain rounded-[3px] shrink-0" alt="" style={{ width: size, height: size }} />;
  return <Fb size={size} className="text-[var(--faint)] shrink-0" />;
}
const BROWSER_SLUG = { Chrome: 'googlechrome/4285F4', Firefox: 'firefoxbrowser/FF7139', Safari: 'safari/1B88CA', Edge: 'microsoftedge/0078D7', Opera: 'opera/FF1B2D' };
// NOTE: SimpleIcons removed the Windows/Microsoft brand marks, so there's no valid CDN
// slug for Windows — it's rendered with a Lucide Monitor glyph instead (see OS iconOf).
const OS_SLUG = { Windows: null, macOS: 'apple/A2AAAD', iOS: 'apple/A2AAAD', Linux: 'linux/FCC624', Android: 'android/3DDC84' };

function Breakdown({ title, rows, iconOf }) {
  const max = Math.max(1, ...rows.map((r) => r.count)); const tot = rows.reduce((a, r) => a + r.count, 0) || 1;
  return (
    <Card className="p-5">
      <div className="text-xs font-semibold text-[var(--faint)] uppercase mb-3">{title}</div>
      <div className="space-y-2.5">
        {rows.length ? rows.map((r) => (
          <div key={r.label} className="flex items-center gap-3 text-sm">
            <span className="text-[var(--muted)] w-28 shrink-0 flex items-center gap-2 capitalize truncate">{iconOf ? iconOf(r.label) : null}{r.label}</span>
            <div className="flex-1 h-2 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className="h-full bg-gradient-to-r from-orange-500 to-amber-500" style={{ width: `${(r.count / max) * 100}%` }} /></div>
            <span className="w-12 text-right font-medium">{Math.round((r.count / tot) * 100)}%</span>
          </div>
        )) : <div className="text-sm text-[var(--faint)]">No data yet.</div>}
      </div>
    </Card>
  );
}

const refHost = (r) => { try { return new URL(r).hostname.replace(/^www\./, ''); } catch { return r || 'direct'; } };

const fmtBytes = (n) => {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let v = n, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
};

// Admin: contact-form inbox. Messages are stored server-side (and forwarded to
// Discord if a webhook is configured).
function AdminMessages() {
  const toast = useToast();
  const { data, loading, reload } = useAsync(() => api.get('/admin/contact'), []);
  const msgs = data?.messages || [];
  const markRead = async (m) => { if (m.readAt) return; try { await api.post(`/admin/contact/${m.id}/read`); reload(); } catch {} };
  const del = async (m) => { try { await api.del(`/admin/contact/${m.id}`); toast.success('Deleted.'); reload(); } catch { toast.error('Failed.'); } };
  if (loading) return <Loading />;
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold flex items-center gap-2"><Mail size={16} className="text-[var(--primary-2)]" /> Contact messages {data?.unread > 0 && <Badge tone="amber">{data.unread} new</Badge>}</h2>
        <Button size="sm" variant="ghost" onClick={reload}><RefreshCw size={14} /> Refresh</Button>
      </div>
      {msgs.length ? <div className="space-y-2">
        {msgs.map((m) => (
          <Card key={m.id} className={`p-4 ${m.readAt ? '' : 'border-[var(--ring)] bg-orange-500/[0.03]'}`} onMouseEnter={() => markRead(m)}>
            <div className="flex items-start gap-3">
              <span className="grid place-items-center w-9 h-9 rounded-lg bg-[var(--surface-2)] shrink-0"><MessageSquare size={15} className="text-[var(--primary-2)]" /></span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{m.name}</span>
                  <a href={`mailto:${m.email}`} className="text-xs text-[var(--primary-2)] hover:underline">{m.email}</a>
                  {m.user && <Badge tone="primary"><Users size={9} /> {m.user.displayName}</Badge>}
                  {!m.readAt && <Badge tone="amber">new</Badge>}
                  <span className="text-xs text-[var(--faint)] ml-auto">{new Date(m.createdAt).toLocaleString()}</span>
                </div>
                <div className="text-sm text-[var(--muted)] mt-1.5 break-words prose-sm"><Markdown>{m.body}</Markdown></div>
                <div className="flex items-center gap-2 mt-2.5">
                  <a href={`mailto:${m.email}?subject=${encodeURIComponent('Re: your message to BetterCommunity')}`}><Button size="sm"><Send size={13} /> Reply</Button></a>
                  <Button size="sm" variant="ghost" onClick={() => del(m)}><Trash2 size={13} /> Delete</Button>
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div> : <EmptyState icon={Mail} title="No messages" sub="Contact-form submissions will appear here." />}
    </div>
  );
}

// Admin: configure the Discord bot + see its live status (heartbeat).
// A tidy add/remove list of Discord channel IDs (replaces a raw textarea).
function ChannelIdList({ ids, onChange, placeholder }) {
  const [draft, setDraft] = useState('');
  const list = Array.isArray(ids) ? ids : [];
  const add = () => { const v = draft.trim(); if (!v) return; if (!list.includes(v)) onChange([...list, v]); setDraft(''); };
  return (
    <div className="space-y-1.5">
      {list.length > 0 && <div className="flex flex-wrap gap-1.5">
        {list.map((id) => (
          <span key={id} className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-lg bg-[var(--surface-2)] border border-[var(--line)] text-xs font-mono">
            {id}<button onClick={() => onChange(list.filter((x) => x !== id))} className="text-[var(--faint)] hover:text-red-400"><X size={12} /></button>
          </span>
        ))}
      </div>}
      <div className="flex gap-2">
        <Input className="font-mono text-xs" value={draft} onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))} placeholder={placeholder} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <Button size="sm" onClick={add}><Plus size={14} /></Button>
      </div>
    </div>
  );
}

// Moderation: full submission review (details, metadata, download, plugin validation,
// plus mod-only internal tags & a short comment thread for other moderators).
function SubmissionReview({ sub, onClose, onApprove, onReject, reload }) {
  const toast = useToast();
  const it = sub.item || {}; const meta = it.meta || {};
  const dl = meta.download_url || meta.downloadUrl || null;
  const [tags, setTags] = useState(sub.tags || []);
  const [tagInput, setTagInput] = useState('');
  const [comments, setComments] = useState(sub.comments || []);
  const [commentInput, setCommentInput] = useState('');
  const [busy, setBusy] = useState(false);
  const rows = [
    ['Kind', it.kind], ['Version', it.version && `v${it.version}`], ['Project', it.project?.key?.toUpperCase()],
    ['Author', `${it.owner?.displayName || '—'}${it.owner?.email ? ` · ${it.owner.email}` : ''}`], ['Slug', it.slug], ['Submission type', sub.type],
  ].filter(([, v]) => v);

  const saveTags = async (next) => {
    setTags(next);
    try { await api.put(`/mod/submissions/${sub.id}/tags`, { tags: next }); reload?.(); } catch { toast.error('Failed.'); }
  };
  const addTag = () => { const x = tagInput.trim(); if (x && !tags.includes(x)) saveTags([...tags, x]); setTagInput(''); };
  const removeTag = (x) => saveTags(tags.filter((t) => t !== x));

  const addComment = async () => {
    const body = commentInput.trim();
    if (!body) return;
    setBusy(true);
    try { const r = await api.post(`/mod/submissions/${sub.id}/comments`, { body }); setComments((c) => [...c, r.comment]); setCommentInput(''); reload?.(); }
    catch { toast.error('Failed.'); } finally { setBusy(false); }
  };
  const removeComment = async (cid) => {
    try { await api.del(`/mod/submissions/${sub.id}/comments/${cid}`); setComments((c) => c.filter((x) => x.id !== cid)); reload?.(); } catch { toast.error('Failed.'); }
  };

  return (
    <Modal open onClose={onClose} title={`Review — ${it.name}`} icon={Eye} width="max-w-2xl"
      footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button onClick={onReject}><XCircle size={15} /> Reject</Button><Button variant="primary" onClick={onApprove}><CheckCircle2 size={15} /> Approve</Button></>}>
      <div className="grid sm:grid-cols-2 gap-x-4 gap-y-2.5 text-sm mb-4">
        {rows.map(([k, v]) => <div key={k} className="min-w-0"><span className="text-[var(--faint)] text-xs">{k}</span><div className="font-medium truncate">{v}</div></div>)}
      </div>
      {it.description && <div className="mb-4"><div className="text-xs text-[var(--faint)] uppercase font-semibold mb-1">Description</div><p className="text-sm text-[var(--muted)] whitespace-pre-wrap">{it.description}</p></div>}
      {it.tags?.length > 0 && <div className="flex flex-wrap gap-1.5 mb-4">{it.tags.map((tg) => <Badge key={tg}><Tag size={10} /> {tg}</Badge>)}</div>}

      <div className="mb-4 p-3 rounded-lg bg-[var(--surface-2)] border border-[var(--line)]">
        <div className="text-xs font-semibold text-[var(--faint)] uppercase mb-1.5 flex items-center gap-1.5"><Tag size={11} /> Internal mod tags <span className="normal-case font-normal">(never shown to the author)</span></div>
        <div className="flex gap-1.5 mb-2">
          <Input value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder="e.g. priority, needs-rework…" onKeyDown={(e) => e.key === 'Enter' && addTag()} />
          <Button size="sm" onClick={addTag}><Plus size={13} /></Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {tags.length ? tags.map((tg) => <span key={tg} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-500">{tg}<button onClick={() => removeTag(tg)} className="hover:text-red-400"><X size={10} /></button></span>) : <span className="text-xs text-[var(--faint)]">None</span>}
        </div>
      </div>

      <div className="mb-4">
        <div className="text-xs font-semibold text-[var(--faint)] uppercase mb-1.5 flex items-center gap-1.5"><MessageSquare size={11} /> Mod comments <span className="normal-case font-normal">(internal, 200 char max)</span></div>
        <div className="space-y-1.5 mb-2 max-h-40 overflow-auto">
          {comments.length ? comments.map((c) => (
            <div key={c.id} className="flex items-start gap-2 text-sm bg-[var(--surface-2)] rounded-lg px-3 py-2">
              <div className="flex-1 min-w-0"><span className="font-medium">{c.author?.displayName || '—'}</span> <span className="text-[var(--muted)]">{c.body}</span></div>
              <button onClick={() => removeComment(c.id)} className="text-[var(--faint)] hover:text-red-400 shrink-0"><X size={12} /></button>
            </div>
          )) : <div className="text-xs text-[var(--faint)]">No comments yet.</div>}
        </div>
        <div className="flex gap-1.5">
          <Input value={commentInput} onChange={(e) => setCommentInput(e.target.value.slice(0, 200))} placeholder="Leave a note for other moderators…" onKeyDown={(e) => e.key === 'Enter' && addComment()} />
          <Button size="sm" disabled={busy} onClick={addComment}>{busy ? <Spinner /> : <Send size={13} />}</Button>
        </div>
        <div className="text-[10px] text-[var(--faint)] mt-1 text-right">{commentInput.length}/200</div>
      </div>

      {dl && <div className="mb-4 flex items-center gap-2 rounded-lg bg-[var(--surface-2)] border border-[var(--line)] px-3 py-2"><Download size={14} className="text-[var(--primary-2)] shrink-0" /><a href={dl} target="_blank" rel="noreferrer" className="text-xs text-[var(--primary-2)] break-all flex-1 hover:underline">{dl}</a></div>}
      {meta.validation && <div className="mb-4"><div className="text-xs font-semibold text-[var(--faint)] uppercase mb-1.5 flex items-center gap-2">Plugin validation {meta.validation.valid ? <Badge tone="green"><CheckCircle2 size={10} /> valid</Badge> : <Badge tone="red"><XCircle size={10} /> invalid</Badge>}</div><pre className="text-xs bg-[var(--surface-2)] rounded-lg p-3 max-h-40 overflow-auto">{JSON.stringify(meta.validation, null, 2)}</pre></div>}
      {Object.keys(meta).length > 0 && <div><div className="text-xs font-semibold text-[var(--faint)] uppercase mb-1.5">Full metadata (review before approving)</div><pre className="text-xs bg-[var(--surface-2)] rounded-lg p-3 max-h-56 overflow-auto">{JSON.stringify(meta, null, 2)}</pre></div>}
    </Modal>
  );
}

// Admin: generate + manage promo codes (discount / free hosting / free boost).
function AdminKofi() {
  const toast = useToast();
  const { data, loading, reload } = useAsync(() => api.get('/admin/kofi/settings'), []);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [grantBusy, setGrantBusy] = useState(false);
  const save = async () => {
    if (!token.trim()) return;
    setBusy(true);
    try { await api.put('/admin/kofi/settings', { token: token.trim() }); toast.success('Saved.'); setToken(''); reload(); }
    catch { toast.error('Failed.'); } finally { setBusy(false); }
  };
  const grant = async () => {
    if (!email.trim()) return;
    setGrantBusy(true);
    try { const r = await api.post('/admin/kofi/grant', { email: email.trim() }); toast.success(`Granted — code ${r.code}.`); setEmail(''); }
    catch (x) { toast.error(x.data?.error === 'no_matching_account' ? 'No account with that email.' : x.data?.error === 'already_granted' ? 'Already granted for this account.' : 'Failed.'); }
    finally { setGrantBusy(false); }
  };
  if (loading) return <Loading />;
  return (
    <>
      <Card className="p-4 mb-4">
        <div className="flex items-center gap-2 mb-1 text-sm font-semibold"><KofiIcon size={16} className="text-[var(--primary-2)]" /> Ko-fi donor rewards</div>
        <p className="text-xs text-[var(--muted)] mb-3">A donor whose Ko-fi email matches their BetterCommunity account automatically gets a one-time {data?.percentOff ?? 25}% hosting discount code (valid on {data?.minMonths ?? 12}+ month plans). Paste this webhook URL + a secret token into Ko-fi's <b>Settings → Webhooks</b>, using the same token below.</p>
        <div className="flex items-center gap-2 mb-3 text-xs">
          <code className="flex-1 bg-[var(--surface-2)] rounded-lg px-2.5 py-1.5 truncate">{data?.webhookUrl}</code>
          <Button size="sm" onClick={() => { navigator.clipboard?.writeText(data?.webhookUrl || ''); toast.success('Copied.'); }}><Copy size={12} /></Button>
        </div>
        <div className="grid sm:grid-cols-[1fr_auto] gap-2 mb-4">
          <Input value={token} onChange={(e) => setToken(e.target.value)} placeholder={data?.configured ? 'Token configured — enter a new one to replace it' : 'Ko-fi verification token'} />
          <Button variant="primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : 'Save token'}</Button>
        </div>
        {data?.configured && <Badge tone="green" className="mb-3"><CheckCircle2 size={11} /> Webhook configured</Badge>}
        <div className="pt-3 border-t border-[var(--line)]">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">Manual grant</div>
          <p className="text-xs text-[var(--muted)] mb-2">For a donation you verified by hand (e.g. before the webhook was set up).</p>
          <div className="grid sm:grid-cols-[1fr_auto] gap-2">
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="donor@email.com" />
            <Button disabled={grantBusy} onClick={grant}>{grantBusy ? <Spinner /> : 'Grant 25% code'}</Button>
          </div>
        </div>
      </Card>
      <AdminKofiGoal />
    </>
  );
}

// Admin: set/clear the public funding-goal target shown on the homepage widget.
// The running total + tip count are read-only here (derived from logged webhook
// events) — only the target amount/currency/title are editable.
function AdminKofiGoal() {
  const toast = useToast(); const dialog = useDialog();
  const { data, loading, reload } = useAsync(() => api.get('/admin/kofi/goal'), []);
  const [f, setF] = useState({ title: '', targetAmount: '', currency: 'USD' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data?.goal) setF({ title: data.goal.title || '', targetAmount: String(data.goal.targetAmount ?? ''), currency: data.goal.currency || 'USD' }); }, [data]);
  const save = async () => {
    const amt = Number(f.targetAmount);
    if (!(amt > 0)) return toast.error('Target amount must be greater than 0.');
    setBusy(true);
    try { await api.put('/admin/kofi/goal', { title: f.title.trim(), targetAmount: amt, currency: f.currency.trim() || 'USD' }); toast.success('Goal saved — now visible on the homepage.'); reload(); }
    catch { toast.error('Failed.'); } finally { setBusy(false); }
  };
  const clear = async () => {
    if (!(await dialog.confirm({ title: 'Remove funding goal', message: 'The public widget will disappear from the homepage. The running total/tip count keep accumulating in the background.', okLabel: 'Remove' }))) return;
    try { await api.del('/admin/kofi/goal'); toast.success('Removed.'); setF({ title: '', targetAmount: '', currency: 'USD' }); reload(); }
    catch { toast.error('Failed.'); }
  };
  if (loading) return <Loading />;
  const pct = data?.goal ? Math.min(100, Math.round((data.totalAmount / data.goal.targetAmount) * 100)) : 0;
  return (
    <Card className="p-4 mb-4">
      <div className="flex items-center gap-2 mb-1 text-sm font-semibold"><Target size={16} className="text-[var(--primary-2)]" /> Funding goal (public widget)</div>
      <p className="text-xs text-[var(--muted)] mb-3">Shown on the homepage with the running total raised + number of tips, sourced from Ko-fi webhook events. Set a target to turn it on.</p>
      <div className="rounded-xl bg-[var(--surface-2)] p-3 mb-3 flex items-center gap-4 text-sm">
        <div><span className="text-[var(--faint)]">Raised so far:</span> <b>{(data?.totalAmount || 0).toFixed(2)} {f.currency || 'USD'}</b></div>
        <div><span className="text-[var(--faint)]">Tips:</span> <b>{data?.tipCount ?? 0}</b></div>
      </div>
      <div className="grid sm:grid-cols-[1fr_auto_auto] gap-2 mb-2">
        <Field label="Title (optional)"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Help us cover server costs" /></Field>
        <Field label="Target"><Input type="number" min="1" value={f.targetAmount} onChange={(e) => setF({ ...f, targetAmount: e.target.value })} placeholder="500" className="w-28" /></Field>
        <Field label="Currency"><Input value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} placeholder="USD" className="w-20" /></Field>
      </div>
      {data?.goal && (
        <div className="mb-3">
          <div className="h-2 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-400" style={{ width: `${pct}%` }} /></div>
          <div className="text-xs text-[var(--faint)] mt-1">{pct}% of {data.goal.targetAmount} {data.goal.currency} goal — live on the homepage</div>
        </div>
      )}
      <div className="flex gap-2">
        <Button variant="primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : data?.goal ? 'Update goal' : 'Publish goal'}</Button>
        {data?.goal && <Button variant="ghost" className="!text-red-400" onClick={clear}>Remove</Button>}
      </div>
    </Card>
  );
}

// Admin: generate + manage promo codes (discount / free hosting / free boost).
function AdminPromo() {
  const toast = useToast();
  const { data, loading, reload } = useAsync(() => api.get('/admin/promo'), []);
  const [f, setF] = useState({ kind: 'discount', code: '', percentOff: 20, freeMonths: 0, minMonths: 0, storageGB: 10, uploadMbps: 8, hostMonths: 0, boostDays: 7, maxRedemptions: '', perUserLimit: 1, note: '' });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const codes = data?.codes || [];
  const create = async () => {
    const body = { kind: f.kind, code: f.code.trim() || undefined, perUserLimit: Number(f.perUserLimit) || 1, note: f.note || undefined, maxRedemptions: f.maxRedemptions ? Number(f.maxRedemptions) : null };
    if (f.kind === 'discount') { if (Number(f.percentOff)) body.percentOff = Number(f.percentOff); if (Number(f.freeMonths)) body.freeMonths = Number(f.freeMonths); if (Number(f.minMonths)) body.minMonths = Number(f.minMonths); }
    if (f.kind === 'free_hosting') { body.storageGB = Number(f.storageGB); if (Number(f.uploadMbps)) body.uploadMbps = Number(f.uploadMbps); if (Number(f.hostMonths)) body.hostMonths = Number(f.hostMonths); }
    if (f.kind === 'free_boost') body.boostDays = Number(f.boostDays);
    try { const r = await api.post('/admin/promo', body); toast.success(`Code ${r.code.code} created.`); setF((s) => ({ ...s, code: '' })); reload(); }
    catch (x) { toast.error(x.data?.error === 'discount_needs_value' ? 'Set a % off or free months.' : x.data?.error === 'code_exists' ? 'That code already exists.' : x.data?.error === 'hosting_needs_storage' ? 'Set the storage GB.' : x.data?.error === 'boost_needs_days' ? 'Set the boost days.' : 'Failed.'); }
  };
  const toggle = async (c) => { try { await api.patch(`/admin/promo/${c.id}`, { active: !c.active }); reload(); } catch { toast.error('Failed.'); } };
  const del = async (c) => { try { await api.del(`/admin/promo/${c.id}`); reload(); } catch { toast.error('Failed.'); } };
  const [openId, setOpenId] = useState(null);
  const [reds, setReds] = useState({});
  const viewReds = async (c) => {
    if (openId === c.id) { setOpenId(null); return; }
    setOpenId(c.id);
    if (!reds[c.id]) { try { const r = await api.get(`/admin/promo/${c.id}/redemptions`); setReds((s) => ({ ...s, [c.id]: r.redemptions })); } catch { toast.error('Failed to load.'); } }
  };
  const desc = (c) => c.kind === 'discount' ? [c.percentOff && `${c.percentOff}% off`, c.freeMonths && `${c.freeMonths} mo free`, c.minMonths && `${c.minMonths}mo+ term only`].filter(Boolean).join(' + ')
    : c.kind === 'free_hosting' ? `${c.storageGB}GB${c.uploadMbps ? ` · ${c.uploadMbps}Mbps` : ''}${c.hostMonths ? ` · ${c.hostMonths}mo` : ' · forever'}`
    : `boost ${c.boostDays} days`;
  return (
    <div>
      <h2 className="font-semibold mb-3 flex items-center gap-2"><Ticket size={16} className="text-[var(--primary-2)]" /> Promo codes</h2>
      <AdminKofi />
      <Card className="p-4 mb-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Type"><Select value={f.kind} onChange={(e) => set('kind', e.target.value)}><option value="discount">Discount (% off / months free)</option><option value="free_hosting">Free hosting</option><option value="free_boost">Free boost</option></Select></Field>
          <Field label="Code (blank = auto-generate)"><Input value={f.code} onChange={(e) => set('code', e.target.value)} placeholder="AUTO" /></Field>
          {f.kind === 'discount' && <><Field label="% off"><Input type="number" value={f.percentOff} onChange={(e) => set('percentOff', e.target.value)} /></Field><Field label="First months free"><Input type="number" value={f.freeMonths} onChange={(e) => set('freeMonths', e.target.value)} /></Field><Field label="Min. term months (0 = any)"><Input type="number" value={f.minMonths} onChange={(e) => set('minMonths', e.target.value)} /></Field></>}
          {f.kind === 'free_hosting' && <><Field label="Storage GB"><Input type="number" value={f.storageGB} onChange={(e) => set('storageGB', e.target.value)} /></Field><Field label="Upload Mbps"><Input type="number" value={f.uploadMbps} onChange={(e) => set('uploadMbps', e.target.value)} /></Field><Field label="Duration (months, 0 = forever)"><Input type="number" value={f.hostMonths} onChange={(e) => set('hostMonths', e.target.value)} /></Field></>}
          {f.kind === 'free_boost' && <Field label="Boost days"><Input type="number" value={f.boostDays} onChange={(e) => set('boostDays', e.target.value)} /></Field>}
          <Field label="Max redemptions (blank = ∞)"><Input type="number" value={f.maxRedemptions} onChange={(e) => set('maxRedemptions', e.target.value)} placeholder="∞" /></Field>
          <Field label="Per-user limit"><Input type="number" value={f.perUserLimit} onChange={(e) => set('perUserLimit', e.target.value)} /></Field>
          <Field label="Note (internal)"><Input value={f.note} onChange={(e) => set('note', e.target.value)} placeholder="e.g. launch promo" /></Field>
        </div>
        <div className="flex justify-end mt-3"><Button variant="primary" onClick={create}><Plus size={15} /> Create code</Button></div>
      </Card>
      {loading ? <Loading /> : codes.length ? <div className="space-y-2">
        {codes.map((c) => (
          <Card key={c.id} className="p-4">
            <div className="flex items-center gap-3">
              <Ticket size={18} className={c.active ? 'text-[var(--primary-2)]' : 'text-[var(--faint)]'} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2"><code className="font-mono font-semibold">{c.code}</code><button onClick={() => { navigator.clipboard?.writeText(c.code); toast.success('Copied.'); }} className="text-[var(--faint)] hover:text-[var(--primary-2)]"><Copy size={13} /></button>{!c.active && <Badge>Disabled</Badge>}</div>
                <div className="text-xs text-[var(--muted)] mt-0.5"><Badge tone="primary">{c.kind.replace('_', ' ')}</Badge> {desc(c)}{c.expiresAt ? ` · exp ${new Date(c.expiresAt).toLocaleDateString()}` : ''}{c.note ? ` · ${c.note}` : ''}</div>
              </div>
              <button onClick={() => viewReds(c)} className={`text-xs px-2.5 py-1.5 rounded-lg border ${openId === c.id ? 'border-[var(--primary)] text-[var(--text)]' : 'border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]'}`}><Users size={12} className="inline mr-1" />{c.redeemedCount}{c.maxRedemptions ? `/${c.maxRedemptions}` : ''} used</button>
              <Button size="sm" onClick={() => toggle(c)}>{c.active ? 'Disable' : 'Enable'}</Button>
              <Button size="sm" className="!text-red-400" onClick={() => del(c)}><Trash2 size={14} /></Button>
            </div>
            {openId === c.id && (
              <div className="mt-3 pt-3 border-t border-[var(--line)]">
                {!reds[c.id] ? <div className="text-xs text-[var(--muted)] flex items-center gap-2"><Spinner /> Loading…</div>
                  : reds[c.id].length ? <div className="space-y-1.5">
                    {reds[c.id].map((r) => (
                      <div key={r.id} className="flex items-center gap-2.5 text-sm">
                        <Users size={13} className="text-[var(--faint)] shrink-0" />
                        <span className="font-medium">{r.user?.displayName}</span>
                        <span className="text-xs text-[var(--faint)] truncate">{r.user?.email}</span>
                        <span className="text-xs text-[var(--muted)] flex-1 truncate">· {r.detail}</span>
                        <span className="text-[11px] text-[var(--faint)] shrink-0">{new Date(r.createdAt).toLocaleString()}</span>
                      </div>
                    ))}
                  </div> : <div className="text-xs text-[var(--faint)]">No redemptions yet.</div>}
              </div>
            )}
          </Card>
        ))}
      </div> : <EmptyState icon={Ticket} title="No promo codes yet" sub="Create one above — discount, free hosting, or a free boost." />}
    </div>
  );
}

// Editor for the bot's gated-role rules. Each rule = one Discord role granted to
// members meeting its own requirements (Discord link / BCWEB account / BMM
// creator id). Add as many as you like.
function GatingRules({ rules, onChange }) {
  const upd = (i, patch) => onChange(rules.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const add = () => onChange([...rules, { roleId: '', label: '', requireDiscord: true, requireBcweb: true, requireBmm: false }]);
  const rm = (i) => onChange(rules.filter((_, k) => k !== i));
  const Chk = ({ on, onToggle, children }) => (
    <label className="flex items-center gap-1.5 text-xs cursor-pointer"><input type="checkbox" checked={!!on} onChange={(e) => onToggle(e.target.checked)} /> {children}</label>
  );
  return (
    <div className="space-y-2">
      {rules.length === 0 && <div className="text-xs text-[var(--faint)] py-1">No role rules yet — add one to start gating.</div>}
      {rules.map((r, i) => (
        <div key={i} className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-2.5 space-y-2">
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
            <Field label="Role ID"><Input value={r.roleId || ''} onChange={(e) => upd(i, { roleId: e.target.value.trim() })} placeholder="123456789012345678" /></Field>
            <Field label="Label (for messages)"><Input value={r.label || ''} onChange={(e) => upd(i, { label: e.target.value })} placeholder="Verified / Creator…" /></Field>
            <Button size="sm" variant="ghost" className="!text-red-400 mb-0.5" onClick={() => rm(i)} title="Remove rule"><Trash2 size={14} /></Button>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <Chk on={r.requireDiscord} onToggle={(v) => upd(i, { requireDiscord: v })}>Requires linked Discord</Chk>
            <Chk on={r.requireBcweb} onToggle={(v) => upd(i, { requireBcweb: v })}>Requires BCWEB account</Chk>
            <Chk on={r.requireBmm} onToggle={(v) => upd(i, { requireBmm: v })}>Requires BMM creator id</Chk>
          </div>
        </div>
      ))}
      <Button size="sm" variant="ghost" onClick={add}><Plus size={13} /> Add role rule</Button>
    </div>
  );
}

function AdminBot() {
  const toast = useToast();
  const { data, loading, reload } = useAsync(() => api.get('/admin/bot/config'), []);
  const [cfg, setCfg] = useState(null);
  const [previewNonce, setPreviewNonce] = useState(0);
  const [tokenInput, setTokenInput] = useState('');
  useEffect(() => { if (data?.config) setCfg(data.config); }, [data]);
  if (loading || !cfg) return <Loading />;
  const status = data?.status;
  const online = status?.online && status?.at && (Date.now() - new Date(status.at).getTime() < 180000);
  // set a nested field: set('welcome.channelId', v)
  const set = (path, val) => setCfg((c) => {
    const next = structuredClone(c); const keys = path.split('.'); let o = next;
    for (let i = 0; i < keys.length - 1; i++) o = (o[keys[i]] ??= {});
    o[keys[keys.length - 1]] = val; return next;
  });
  const save = async () => { try { await api.put('/admin/bot/config', { config: cfg }); toast.success('Bot config saved.'); reload(); } catch { toast.error('Save failed.'); } };
  const botDisabled = cfg.enabled === false;
  const saveToken = async () => {
    if (!tokenInput.trim()) return toast.error('Enter a token.');
    try { await api.put('/admin/bot/token', { token: tokenInput.trim() }); toast.success('Token saved — the bot will connect within ~20s.'); setTokenInput(''); reload(); }
    catch (x) { toast.error(x.data?.error === 'bot_enabled' ? 'Disable the bot first to change its token.' : x.data?.error === 'token_from_env' ? 'Token is set via env — can’t change it here.' : 'Failed.'); }
  };
  const clearToken = async () => {
    try { await api.put('/admin/bot/token', { token: null }); toast.success('Token cleared.'); reload(); }
    catch (x) { toast.error(x.data?.error === 'bot_enabled' ? 'Disable the bot first.' : 'Failed.'); }
  };
  const Toggle = ({ path, label }) => (
    <label className="flex items-center gap-2 text-sm cursor-pointer">
      <input type="checkbox" checked={!!path.split('.').reduce((o, k) => o?.[k], cfg)} onChange={(e) => set(path, e.target.checked)} /> {label}
    </label>
  );
  const g = (path) => path.split('.').reduce((o, k) => o?.[k], cfg) ?? '';
  const jtcLobbies = cfg.joinToCreate?.lobbies || (cfg.joinToCreate?.lobbyChannelId ? [{ lobbyChannelId: cfg.joinToCreate.lobbyChannelId, categoryId: cfg.joinToCreate.categoryId, tempCategoryName: cfg.joinToCreate.tempCategoryName }] : []);
  // Welcome preview: substitute the message variables with sample values.
  const previewMsg = (tpl) => (tpl || '').replace(/\{user\}/g, '@NewMember').replace(/\{username\}/g, 'NewMember').replace(/\{servername\}/g, 'BetterCommunity').replace(/\{joinnumber\}/g, '1,024').replace(/\{joindate\}/g, new Date().toDateString());
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold flex items-center gap-2"><DiscordIcon size={16} className="text-[var(--primary-2)]" /> Discord bot</h2>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 text-xs ${online ? 'text-emerald-400' : 'text-[var(--faint)]'}`}><span className={`w-2 h-2 rounded-full ${online ? 'bg-emerald-400 animate-pulse' : 'bg-[var(--line-strong)]'}`} /> {online ? 'Online' : 'Offline'}</span>
          <Button size="sm" variant="primary" onClick={save}><CheckCircle2 size={14} /> Save</Button>
        </div>
      </div>

      {/* connection error (e.g. privileged intents disabled) — actionable message */}
      {data?.error && (
        <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/[0.07] p-3 flex items-start gap-2.5">
          <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
          <div className="min-w-0"><div className="text-sm font-medium text-red-300">Bot can’t connect</div><div className="text-xs text-red-300/90 mt-0.5 break-words">{data.error}</div></div>
        </div>
      )}

      {/* live status */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {[['Guilds', status?.guilds], ['Users', status?.users], ['Temp channels', status?.tempChannels],
          ['Ping', status?.ping != null ? `${status.ping}ms` : '—'],
          ['Uptime', status?.uptimeSec != null ? `${Math.floor(status.uptimeSec / 3600)}h ${Math.floor((status.uptimeSec % 3600) / 60)}m` : '—'],
          ['Kicked (session)', status?.mod?.kicks ?? 0], ['Timed out (session)', status?.mod?.timeouts ?? 0], ['Messages purged (session)', status?.mod?.purged ?? 0]].map(([l, v]) => (
          <Card key={l} className="p-4"><div className="text-xl font-bold">{v ?? '—'}</div><div className="text-xs text-[var(--muted)] mt-0.5">{l}</div></Card>
        ))}
      </div>

      {/* the bot's own "database" — DiscordActivity, capped by limits.storageMB below */}
      {data?.storage && (
        <Card className="p-4 mb-4">
          <div className="flex items-center justify-between mb-1.5"><span className="font-medium text-sm flex items-center gap-2"><HardDrive size={14} className="text-[var(--primary-2)]" /> Member database usage</span>
            <span className="text-xs text-[var(--muted)]">{data.storage.memberCount} members tracked</span></div>
          {(() => { const capMB = cfg.limits?.storageMB || 0; const usedMB = data.storage.usedBytes / (1024 * 1024); const pct = capMB ? Math.min(100, (usedMB / capMB) * 100) : 0; return (
            <>
              <div className="h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className={`h-full ${pct > 90 ? 'bg-red-500' : 'bg-gradient-to-r from-orange-500 to-amber-500'}`} style={{ width: `${pct}%` }} /></div>
              <div className="text-xs text-[var(--faint)] mt-1.5">{usedMB.toFixed(1)} MB {capMB ? `/ ${capMB} MB cap` : '(no cap set)'} — oldest inactive members are pruned automatically once over the cap.</div>
            </>
          ); })()}
        </Card>
      )}
      {/* Bot token — set/rotate from here (unless provided via the DISCORD_TOKEN env). */}
      <Card className="p-4 mb-4">
        <div className="flex items-center gap-2 mb-1.5">
          <Lock size={15} className="text-[var(--primary-2)]" /><span className="font-medium text-sm">Bot token</span>
          {data?.hasToken ? <Badge tone="green"><CheckCircle2 size={10} /> Set</Badge> : <Badge tone="amber">Not set</Badge>}
        </div>
        {data?.tokenFromEnv ? (
          <p className="text-xs text-[var(--muted)]">The token is provided via the <code>DISCORD_TOKEN</code> environment variable and is managed outside the dashboard.</p>
        ) : botDisabled ? (
          <>
            <p className="text-xs text-[var(--muted)] mb-2">Paste your Discord bot token — it’s stored server-side and the bot connects automatically within ~20s. The token is never shown again.</p>
            <div className="flex gap-2">
              <Input type="password" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} placeholder={data?.hasToken ? 'New token…' : 'Bot token…'} onKeyDown={(e) => e.key === 'Enter' && saveToken()} />
              <Button variant="primary" onClick={saveToken}>{data?.hasToken ? 'Change' : 'Set token'}</Button>
              {data?.hasToken && <Button className="!text-red-400" onClick={clearToken}>Clear</Button>}
            </div>
          </>
        ) : (
          <p className="text-xs text-amber-400/90 flex items-center gap-1.5"><Bell size={12} /> Turn “Bot enabled” off and Save to change the token.</p>
        )}
      </Card>
      {!online && !data?.hasToken && <div className="text-xs text-[var(--muted)] mb-4 flex items-center gap-1.5"><Bell size={12} /> No token set — add one above (or set <code>DISCORD_TOKEN</code> in the compose <code>.env</code>) to bring the bot online.</div>}

      <div className="grid md:grid-cols-2 gap-4">
        <Card className="p-4 space-y-2.5">
          <div className="font-medium text-sm mb-1">General</div>
          <Toggle path="enabled" label="Bot enabled" />
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] pt-2">Moderation</div>
          <Toggle path="moderation.enabled" label="Moderation enabled" />
          <Toggle path="moderation.antiSelfbot" label="Anti-selfbot filter" />
          <Field label="No-post channels" hint="Posting here kicks the user + purges their messages.">
            <ChannelIdList
              ids={g('moderation.purgeChannelIds') || (g('moderation.purgeChannelId') ? [g('moderation.purgeChannelId')] : [])}
              onChange={(v) => set('moderation.purgeChannelIds', v)}
              placeholder="Channel ID — press Enter" />
          </Field>
        </Card>

        <Card className="p-4 space-y-2.5">
          <div className="flex items-center justify-between mb-1"><div className="font-medium text-sm">Join-to-create voice</div>
            <Button size="sm" variant="ghost" onClick={() => set('joinToCreate.lobbies', [...jtcLobbies, { lobbyChannelId: '', categoryId: '', tempCategoryName: 'Temp Voice' }])}><Plus size={13} /> Lobby</Button></div>
          <Toggle path="joinToCreate.enabled" label="Enabled" />
          {jtcLobbies.length === 0 && <div className="text-xs text-[var(--faint)]">No lobbies — add one. Joining that voice channel spawns a temp room in its category.</div>}
          {jtcLobbies.map((lb, i) => (
            <div key={i} className="rounded-lg border border-[var(--line)] p-2.5 space-y-2 relative">
              <button onClick={() => set('joinToCreate.lobbies', jtcLobbies.filter((_, k) => k !== i))} className="absolute top-2 right-2 text-[var(--faint)] hover:text-red-400"><Trash2 size={13} /></button>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)]">Lobby {i + 1}</div>
              <Input value={lb.lobbyChannelId || ''} onChange={(e) => set('joinToCreate.lobbies', jtcLobbies.map((x, k) => k === i ? { ...x, lobbyChannelId: e.target.value } : x))} placeholder="Lobby voice channel ID" />
              <div className="grid grid-cols-2 gap-2">
                <Input value={lb.categoryId || ''} onChange={(e) => set('joinToCreate.lobbies', jtcLobbies.map((x, k) => k === i ? { ...x, categoryId: e.target.value } : x))} placeholder="Category id (auto if empty)" />
                <Input value={lb.tempCategoryName || ''} onChange={(e) => set('joinToCreate.lobbies', jtcLobbies.map((x, k) => k === i ? { ...x, tempCategoryName: e.target.value } : x))} placeholder="Temp category name" />
              </div>
            </div>
          ))}
        </Card>

        <Card className="p-4 space-y-2.5">
          <div className="font-medium text-sm mb-1">Blog announcements</div>
          <Toggle path="blog.enabled" label="Announce new blog posts" />
          <Field label="Announcement channel id" hint="New published posts are sent there (title + excerpt + link). History is never re-posted.">
            <Input value={g('blog.channelId')} onChange={(e) => set('blog.channelId', e.target.value)} placeholder="Channel ID" />
          </Field>
          <div className="font-medium text-sm mb-1" style={{ marginTop: 14 }}>Server-perf alerts</div>
          <Toggle path="alerts.enabled" label="Post CPU/RAM/disk/service-down alerts" />
          <Field label="Alerts channel id" hint="Fired thresholds (see the Server perf tab) are posted here as soon as the bot polls.">
            <Input value={g('alerts.channelId')} onChange={(e) => set('alerts.channelId', e.target.value)} placeholder="Channel ID" />
          </Field>
          <div className="font-medium text-sm mb-1" style={{ marginTop: 14 }}>Ko-fi tips</div>
          <Toggle path="kofi.enabled" label="Announce new Ko-fi tips" />
          <Field label="Tips channel id" hint="Each new tip (recorded by the Ko-fi webhook) is posted as a thank-you embed with the running total. Old tips are never re-posted.">
            <Input value={g('kofi.channelId')} onChange={(e) => set('kofi.channelId', e.target.value)} placeholder="Channel ID" />
          </Field>
          <div className="font-medium text-sm mb-1" style={{ marginTop: 14 }}>Welcome / bye</div>
          <Toggle path="welcome.enabled" label="Enabled" />
          <Field label="Welcome channel id"><Input value={g('welcome.channelId')} onChange={(e) => set('welcome.channelId', e.target.value)} placeholder="Channel ID" /></Field>
          <Field label="Join message" hint="{user} {username} {servername} {joinnumber} {joindate}"><Input value={g('welcome.joinMessage')} onChange={(e) => set('welcome.joinMessage', e.target.value)} /></Field>
          <Field label="Leave message"><Input value={g('welcome.leaveMessage')} onChange={(e) => set('welcome.leaveMessage', e.target.value)} /></Field>
          {/* Live preview — the REAL banner the bot renders (same canvas), plus the message */}
          <div className="rounded-lg border border-[var(--line)] overflow-hidden" style={{ background: '#0e0c09' }}>
            <div className="flex items-center justify-between px-3 pt-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)]">Preview · real banner</div>
              <button onClick={() => setPreviewNonce((n) => n + 1)} className="text-[10px] text-[var(--primary-2)] hover:underline flex items-center gap-1"><RefreshCw size={10} /> Refresh</button>
            </div>
            <div className="p-2">
              <img alt="Welcome banner preview" className="w-full rounded-md block"
                src={`/api/admin/bot/welcome-preview.png?server=${encodeURIComponent('BetterCommunity')}&members=${status?.users || 1024}&username=NewMember&_=${previewNonce}`}
                onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            </div>
            <div className="px-3 py-2 text-xs text-gray-300 border-t border-white/5">{previewMsg(g('welcome.joinMessage')) || '—'}</div>
          </div>
        </Card>

        <Card className="p-4 space-y-2.5">
          <div className="font-medium text-sm mb-1">Gated access & limits</div>
          <Toggle path="gating.enabled" label="Gate roles behind account links" />
          <p className="text-xs text-[var(--muted)]">Each rule grants ONE Discord role to members who meet its requirements. The bot re-checks everyone every ~5 min (granting AND removing), and members can run <code>/refreshroles</code> to sync instantly after linking on the site.</p>
          <GatingRules rules={Array.isArray(cfg.gating?.rules) ? cfg.gating.rules : []} onChange={(rules) => set('gating.rules', rules)} />
          <div className="grid grid-cols-2 gap-2 pt-2">
            <Field label="Max temp channels"><Input type="number" value={g('limits.maxTempChannels')} onChange={(e) => set('limits.maxTempChannels', Number(e.target.value))} /></Field>
            <Field label="Storage cap (MB)" hint="Caps the member database below — oldest inactive members are pruned once over."><Input type="number" value={g('limits.storageMB')} onChange={(e) => set('limits.storageMB', Number(e.target.value))} /></Field>
          </div>
        </Card>
      </div>

      <AdminBotMembers />
    </div>
  );
}

// The bot's "member database" — DiscordActivity rows, paginated + searchable —
// with the linked BCWEB account shown when there is one.
function AdminBotMembers() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const load = async (append = false) => {
    setBusy(true);
    try {
      const skip = append ? (rows?.length || 0) : 0;
      const { members, hasMore: more } = await api.get(`/admin/bot/members?q=${encodeURIComponent(q)}&skip=${skip}&take=30`);
      setRows(append ? [...(rows || []), ...members] : members); setHasMore(more);
    } catch { if (!append) setRows([]); } finally { setBusy(false); }
  };
  useEffect(() => { load(false); /* eslint-disable-next-line */ }, []);
  const since = (d) => d ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
  return (
    <div className="mt-6">
      <button onClick={() => setCollapsed((x) => !x)} className="w-full flex items-center gap-2 mb-1 text-left">
        <Users size={16} className="text-[var(--primary-2)]" />
        <h2 className="font-semibold flex-1">Members{rows?.length ? <span className="text-sm font-normal text-[var(--faint)]"> · {rows.length}{hasMore ? '+' : ''}</span> : null}</h2>
        <ChevronDown size={16} className={`text-[var(--faint)] transition-transform ${collapsed ? '-rotate-90' : ''}`} />
      </button>
      <p className="text-sm text-[var(--muted)] mb-3">Everyone the bot has seen — join date, last message/voice activity, and the linked BCWEB account when there is one.</p>
      {!collapsed && <>
        <div className="flex gap-2 mb-3">
          <div className="relative flex-1"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
            <Input className="!pl-9" placeholder="Search by Discord id or username…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load(false)} /></div>
          <Button variant="primary" disabled={busy} onClick={() => load(false)}>{busy ? <Spinner /> : <><Search size={15} /> Search</>}</Button>
        </div>
        {rows === null ? <Loading /> : rows.length ? <div className="space-y-1.5">
          {rows.map((m) => (
            <Card key={m.discordId} className="p-3 flex items-center gap-3">
              {m.avatar ? <img src={m.avatar} alt="" className="w-9 h-9 rounded-full shrink-0" /> : <div className="w-9 h-9 rounded-full bg-[var(--surface-2)] grid place-items-center shrink-0"><DiscordIcon size={16} className="text-[#5865F2]" /></div>}
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate flex items-center gap-2">{m.username || m.discordId}{m.linkedUser && <Badge tone="green">{m.linkedUser.displayName}</Badge>}</div>
                <div className="text-xs text-[var(--faint)] truncate">joined {since(m.guildJoinedAt)} · last message {since(m.lastMessageAt)} · last voice {since(m.lastVoiceJoinAt)} · id {m.discordId}</div>
              </div>
            </Card>
          ))}
          {hasMore && <div className="text-center pt-1"><Button variant="ghost" disabled={busy} onClick={() => load(true)}>{busy ? <Spinner /> : 'Load more'}</Button></div>}
        </div> : <EmptyState icon={Users} title="No members tracked yet" sub="They'll appear here once the bot sees activity in the server." />}
      </>}
    </div>
  );
}

// Admin: real object-storage usage broken down by area + hosting allocation +
// pending 72h deletions. All figures are live (listed from object storage / DB).
const LEDGER_ICON = {
  hosting: Server, submissionsPending: Upload, submissionsPublished: CheckCircle2,
  blog: Newspaper, otherProjects: Sparkles, database: TrendingUp, other: AlertTriangle,
  promoCodes: Ticket, messages: Mail, margin: Lock, backups: History,
};
// One row of the capacity ledger: a bar when we know a real allocation/cap to
// measure against, otherwise just the count/bytes we do have — every category
// that can occupy real disk space gets a place here, never invented numbers.
function LedgerRow({ row }) {
  const I = LEDGER_ICON[row.key] || HardDrive;
  const hasBar = row.allocatedBytes != null && row.allocatedBytes > 0;
  const pct = hasBar ? Math.min(100, ((row.usedBytes || 0) / row.allocatedBytes) * 100) : 0;
  return (
    <div className="py-2.5 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between gap-2 text-sm mb-1">
        <span className="flex items-center gap-2 text-[var(--muted)] min-w-0"><I size={14} className="text-[var(--primary-2)] shrink-0" /> <span className="truncate">{row.label}</span></span>
        <span className="text-xs font-medium tabular-nums shrink-0">
          {row.usedBytes != null ? fmtBytes(row.usedBytes) : (row.count != null ? `${row.count}` : '—')}
          {hasBar && <span className="text-[var(--faint)]"> / {fmtBytes(row.allocatedBytes)}</span>}
          {row.count != null && row.usedBytes != null && <span className="text-[var(--faint)]"> · {row.count}</span>}
        </span>
      </div>
      {hasBar && <div className="h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className={`h-full ${pct >= 90 ? 'bg-red-500' : 'bg-gradient-to-r from-orange-500 to-amber-400'}`} style={{ width: `${pct}%` }} /></div>}
      {row.note && <div className="text-[10px] text-[var(--faint)] mt-0.5">{row.note}</div>}
    </div>
  );
}

function AdminStorage() {
  const toast = useToast();
  const { data, loading, reload } = useAsync(() => api.get('/admin/storage'), []);
  const cancelRepoDeletion = async (r) => { try { await api.post(`/admin/repos/${r.id}/delete/cancel`); toast.success(`"${r.name}" is back online.`); reload(); } catch { toast.error('Failed.'); } };
  if (loading) return <Loading />;
  const d = data || {};
  const areas = d.areas || [];
  const total = d.totals?.bytes || 0;
  const colors = ['bg-orange-500', 'bg-amber-400', 'bg-sky-400', 'bg-red-400'];
  const AREA_ICON = { repos: Server, catalog: Package, blog: Newspaper, other: AlertTriangle };
  const pending = (d.pending?.items?.length || 0) + (d.pending?.repos?.length || 0);
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold flex items-center gap-2"><HardDrive size={16} className="text-[var(--primary-2)]" /> Storage</h2>
        <Button size="sm" variant="ghost" onClick={reload}><RefreshCw size={14} /> Refresh</Button>
      </div>

      <div className="grid sm:grid-cols-[2fr_1fr] gap-3 mb-4">
        <Card className="p-5">
          <div className="text-3xl font-bold">{fmtBytes(total)}</div>
          <div className="text-xs text-[var(--muted)] mb-3">across {d.totals?.count || 0} objects in object storage</div>
          <div className="h-3 rounded-full overflow-hidden flex bg-[var(--surface-2)]">
            {areas.map((a, i) => <div key={a.key} className={colors[i % colors.length]} style={{ width: `${total ? (a.bytes / total * 100) : 0}%` }} title={`${a.label}: ${fmtBytes(a.bytes)}`} />)}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3 text-xs">
            {areas.map((a, i) => <span key={a.key} className="flex items-center gap-1.5"><span className={`w-2.5 h-2.5 rounded-sm ${colors[i % colors.length]}`} />{a.label} · <b>{fmtBytes(a.bytes)}</b> ({a.count})</span>)}
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2 text-xs text-[var(--faint)] mb-1"><HardDrive size={13} /> Database (all tables)</div>
          <div className="text-2xl font-bold">{d.dbSizeBytes != null ? fmtBytes(d.dbSizeBytes) : '—'}</div>
          <div className="text-[11px] text-[var(--faint)] mt-1">Users, content, logs, metrics &amp; analytics — everything besides object storage.</div>
        </Card>
      </div>

      {/* Hosting capacity vs the Total capacity configured in Hosting settings */}
      {d.capacity && (() => {
        const cap = d.capacity;
        const pct = cap.usableGB ? Math.min(100, (cap.allocatedGB / cap.usableGB) * 100) : 0;
        const near = pct >= 80;
        return (
          <Card className={`p-5 mb-4 ${near ? 'border-red-500/40' : ''}`}>
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <div className="text-sm font-medium flex items-center gap-2"><HardDrive size={15} className="text-[var(--primary-2)]" /> Total capacity</div>
              <div className="text-xs text-[var(--muted)]"><b className="text-[var(--text)]">{cap.allocatedGB.toFixed(1)}</b> / {cap.usableGB.toFixed(0)} GB allocated <span className="text-[var(--faint)]">· total {cap.totalGB} GB, {cap.reservedGB} reserved</span></div>
            </div>
            <div className="h-3 rounded-full bg-[var(--surface-2)] overflow-hidden">
              <div className={`h-full transition-all ${near ? 'bg-gradient-to-r from-red-500 to-orange-500' : 'bg-gradient-to-r from-orange-500 to-amber-400'}`} style={{ width: `${pct}%` }} />
            </div>
            <div className={`text-xs mt-2 ${near ? 'text-red-400' : 'text-[var(--muted)]'}`}>{Math.round(pct)}% of usable capacity allocated · {cap.freeGB.toFixed(1)} GB free{near ? ' — prices rise near the limit.' : ''}</div>
            <div className="text-[11px] text-[var(--faint)] mt-1.5">{cap.hostingAllocatedGB?.toFixed(1)} GB hosting quotas + {cap.submissionsPublishedGB?.toFixed(2)} GB approved submissions{cap.diskFreeGB != null && <> · real disk free: <b className="text-[var(--text)]">{cap.diskFreeGB.toFixed(0)} GB</b> / {cap.diskTotalGB.toFixed(0)} GB total</>}</div>
          </Card>
        );
      })()}

      {/* Full per-purpose ledger — every category that draws real disk space,
          each with its own allocation/usage, so "where did the space go" is
          always answerable instead of one opaque "Total capacity" number. */}
      {d.ledger && (
        <Card className="p-5 mb-4">
          <div className="text-sm font-medium mb-1 flex items-center gap-2"><Sliders size={15} className="text-[var(--primary-2)]" /> Capacity by purpose</div>
          <div className="text-[11px] text-[var(--faint)] mb-2">Real usage per category — approved submissions move out of the temp margin and into their own permanent bucket once approved.</div>
          <div className="divide-y divide-[var(--line)]">
            {d.ledger.map((row) => <LedgerRow key={row.key} row={row} />)}
          </div>
        </Card>
      )}

      <div className="grid sm:grid-cols-3 gap-3 mb-4">
        {areas.map((a) => { const I = AREA_ICON[a.key] || HardDrive; return (
          <Card key={a.key} className="p-4">
            <div className="flex items-center gap-2 text-sm text-[var(--muted)]"><I size={15} className="text-[var(--primary-2)]" /> {a.label}</div>
            <div className="text-2xl font-bold mt-2">{fmtBytes(a.bytes)}</div>
            <div className="text-xs text-[var(--faint)] mt-0.5">{a.count} objects · <code>{a.prefix}</code></div>
          </Card>); })}
      </div>

      <Card className="p-4 mb-4">
        <div className="text-sm font-medium mb-3">Hosted repos</div>
        <div className="grid grid-cols-3 gap-3 text-center mb-3">
          <div><div className="text-xl font-bold">{d.db?.hostedRepos || 0}</div><div className="text-xs text-[var(--muted)]">repos</div></div>
          <div><div className="text-xl font-bold">{fmtBytes(d.db?.repoUsedBytes || 0)}</div><div className="text-xs text-[var(--muted)]">used</div></div>
          <div><div className="text-xl font-bold">{fmtBytes(d.db?.repoAllocatedBytes || 0)}</div><div className="text-xs text-[var(--muted)]">allocated (quota)</div></div>
        </div>
        {(d.topRepos || []).length > 0 && <div className="space-y-1.5 border-t border-[var(--line)] pt-3">
          {d.topRepos.map((r) => <div key={r.id} className="flex items-center gap-2 text-sm"><Server size={13} className="text-[var(--faint)] shrink-0" /><span className="flex-1 truncate">{r.name} <span className="text-[var(--faint)]">· {r.owner}</span></span><span className="text-xs text-[var(--muted)] tabular-nums">{fmtBytes(r.used)} / {fmtBytes(r.quota)}</span></div>)}
        </div>}
      </Card>

      <Card className="p-4">
        <div className="text-sm font-medium mb-3 flex items-center gap-2"><Trash2 size={14} className="text-red-400" /> Pending deletions (72h grace){pending > 0 && <Badge tone="red">{pending}</Badge>}</div>
        {pending ? <div className="space-y-1.5">
          {(d.pending.items || []).map((i) => { const I = KIND_ICON[i.kind] || Package; return <div key={i.id} className="flex items-center gap-2 text-sm"><I size={14} className="text-[var(--faint)] shrink-0" /><Badge>{i.kind}</Badge><span className="flex-1 truncate">{i.name}</span><span className="text-xs text-red-400">in {fmtRemaining(i.deleteAt)}</span></div>; })}
          {(d.pending.repos || []).map((r) => <div key={r.id} className="flex items-center gap-2 text-sm"><Server size={14} className="text-[var(--faint)] shrink-0" /><Badge>repo</Badge><span className="flex-1 truncate">{r.name} <span className="text-[var(--faint)]">· {r.owner}</span></span><span className="text-xs text-red-400">in {fmtRemaining(r.deleteAt)}</span><Button size="sm" variant="ghost" onClick={() => cancelRepoDeletion(r)}>Cancel</Button></div>)}
        </div> : <div className="text-sm text-[var(--muted)]">Nothing scheduled for deletion.</div>}
      </Card>

      {d.telemetryExternal && <p className="text-xs text-[var(--faint)] mt-3">Telemetry replays (rrweb) are stored by the separate BMM telemetry service and are not counted here.</p>}
    </div>
  );
}

// Page-journey funnel: readable HTML rows (from → to, bar ∝ count) instead of the
// old scaled SVG sankey whose labels shrank to unreadable in narrow columns.
function Sankey({ flows }) {
  if (!flows.length) return <div className="text-sm text-[var(--faint)] py-6 text-center">No journeys yet — needs visitors viewing multiple pages.</div>;
  const top = flows.slice(0, 10);
  const max = Math.max(1, ...top.map((f) => f.count));
  const chip = (v) => <span className="font-mono text-xs px-2 py-1 rounded-md bg-[var(--surface-2)] border border-[var(--line)] truncate max-w-[38%]" title={v}>{v}</span>;
  return (
    <div className="space-y-1.5">
      {top.map((f, i) => (
        <div key={i} className="relative flex items-center gap-2 px-2.5 py-2 rounded-lg overflow-hidden">
          <div className="absolute inset-y-0 left-0 bg-orange-500/10 rounded-lg" style={{ width: `${Math.max(6, (f.count / max) * 100)}%` }} />
          <div className="relative flex items-center gap-2 flex-1 min-w-0">
            {chip(f.from)}
            <ArrowRight size={13} className="text-[var(--primary-2)] shrink-0" />
            {chip(f.to)}
          </div>
          <span className="relative text-sm font-semibold tabular-nums shrink-0">{f.count}</span>
        </div>
      ))}
    </div>
  );
}

// A clean SVG area + line traffic chart (views area, visitors dashed line) — Rybbit-style.
// `compare` (hourly view only): same-hour-yesterday counts + %, from the API.
function TrafficChart({ series, gran = 'day', onZoom, compare }) {
  const [hover, setHover] = useState(null);
  const wrapRef = useRef(null);
  // Ctrl + wheel zooms between daily and hourly. A native non-passive listener is
  // used so preventDefault() actually stops the page from scrolling while zooming.
  useEffect(() => {
    const el = wrapRef.current; if (!el || !onZoom) return;
    const onWheel = (e) => { if (!e.ctrlKey) return; e.preventDefault(); onZoom(e.deltaY < 0 ? 'in' : 'out'); };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onZoom]);
  const fmt = (d) => gran === 'hour'
    ? new Date(d).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const fmtFull = (d) => gran === 'hour'
    ? new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : new Date(d).toLocaleDateString();
  if (!series.length) return <div ref={wrapRef} className="text-sm text-[var(--faint)] py-8 text-center">No data yet — visits appear once visitors accept analytics cookies.</div>;
  const W = 800, H = 170, padL = 30, padR = 6, padY = 6, n = series.length;
  const max = Math.max(1, ...series.map((s) => Math.max(s.count, s.visitors || 0)));
  const x = (i) => padL + (n <= 1 ? (W - padL - padR) / 2 : (i / (n - 1)) * (W - padL - padR));
  const y = (v) => H - padY - (v / max) * (H - padY * 2);
  const path = (key) => series.map((s, i) => `${i ? 'L' : 'M'} ${x(i).toFixed(1)} ${y(s[key] || 0).toFixed(1)}`).join(' ');
  const area = `${path('count')} L ${x(n - 1).toFixed(1)} ${H - padY} L ${x(0).toFixed(1)} ${H - padY} Z`;
  const labelEvery = Math.ceil(n / 8);
  // Y-axis gridlines at 0 / half / max — without them the chart was just a
  // shape with no sense of scale (couldn't tell 40 views from 4,000 apart).
  const yTicks = [0, 0.5, 1].map((f) => ({ v: Math.round(max * f), py: y(max * f) }));
  const last = series[n - 1];
  return (
    <div className="relative" ref={wrapRef}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 170 }} preserveAspectRatio="none"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const i = Math.round(((e.clientX - r.left) / r.width) * (n - 1)); if (series[i]) setHover({ i, s: series[i], px: e.clientX - r.left }); }}>
        <defs><linearGradient id="viewsGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--primary)" stopOpacity="0.32" /><stop offset="100%" stopColor="var(--primary)" stopOpacity="0" /></linearGradient></defs>
        {yTicks.map((tk) => (
          <g key={tk.v}>
            <line x1={padL} y1={tk.py} x2={W - padR} y2={tk.py} stroke="var(--line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            <text x={padL - 6} y={tk.py} textAnchor="end" dominantBaseline="middle" fontSize="9" fill="var(--faint)">{tk.v}</text>
          </g>
        ))}
        <path d={area} fill="url(#viewsGrad)" />
        <path d={path('count')} fill="none" stroke="var(--primary)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        <path d={path('visitors')} fill="none" stroke="#38bdf8" strokeWidth="1.5" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {/* the latest point stays marked even without hovering, so the line doesn't just trail off */}
        {!hover && <circle cx={x(n - 1)} cy={y(last.count)} r="3" fill="var(--primary)" />}
        {hover && <line x1={x(hover.i)} y1={padY} x2={x(hover.i)} y2={H - padY} stroke="var(--line-strong)" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
        {hover && <circle cx={x(hover.i)} cy={y(hover.s.count)} r="3.5" fill="var(--primary)" />}
        {hover && <circle cx={x(hover.i)} cy={y(hover.s.visitors || 0)} r="3" fill="#38bdf8" />}
      </svg>
      <div className="flex justify-between text-[10px] text-[var(--faint)] mt-1" style={{ paddingLeft: `${(padL / W) * 100}%`, paddingRight: `${(padR / W) * 100}%` }}>
        {series.filter((_, i) => i % labelEvery === 0).map((s) => <span key={s.day}>{fmt(s.day)}</span>)}
      </div>
      {/* tooltip follows the cursor horizontally instead of sitting fixed at top-center */}
      {hover && (() => {
        const cmp = compare?.[hover.i];
        return (
          <div className="absolute top-1 text-[11px] px-2.5 py-1.5 rounded-md bg-[var(--bg-solid)] border border-[var(--line)] shadow pointer-events-none whitespace-nowrap"
            style={{ left: `${Math.min(Math.max(hover.px, 90), (wrapRef.current?.clientWidth || W) - 90)}px`, transform: 'translateX(-50%)' }}>
            {cmp && (
              <div className={`font-semibold flex items-center gap-1 mb-1 pb-1 border-b border-[var(--line)] ${cmp.pct > 0 ? 'text-emerald-400' : cmp.pct < 0 ? 'text-red-400' : 'text-[var(--faint)]'}`}>
                {cmp.pct > 0 ? <ArrowUpRight size={11} /> : cmp.pct < 0 ? <ArrowUpRight size={11} className="rotate-90" /> : null}
                {cmp.pct > 0 ? '+' : ''}{cmp.pct}% <span className="font-normal text-[var(--faint)]">vs same hour yesterday</span>
              </div>
            )}
            <div>{fmtFull(hover.s.day)} <b>{hover.s.count}</b> views · <b className="text-sky-400">{hover.s.visitors || 0}</b> visitors</div>
            {cmp && <div className="text-[var(--faint)]">{fmtFull(cmp.prevHour)} <b>{cmp.prevCount}</b> views</div>}
          </div>
        );
      })()}
    </div>
  );
}

function AdminAnalytics() {
  const [days, setDays] = useState(30);
  const [hours, setHours] = useState(null); // when set → hourly view (zoom-in)
  const { data, loading } = useAsync(() => api.get(`/admin/analytics?${hours ? `hours=${hours}` : `days=${days}`}`), [days, hours]);
  const gran = data?.granularity || (hours ? 'hour' : 'day');
  // Ctrl+wheel on the chart: zoom in → hourly (24h); zoom out → back to daily.
  const onZoom = (dir) => { if (dir === 'in') setHours(24); else setHours(null); };
  const top = data?.top || [], refs = data?.refs || [], series = data?.series || [];
  const devices = data?.devices || [], browsers = data?.browsers || [], oses = data?.oses || [], flows = data?.flows || [], countries = data?.countries || [];
  const maxTop = Math.max(1, ...top.map((t) => t.count));
  const maxRef = Math.max(1, ...refs.map((r) => r.count));
  const maxSeries = Math.max(1, ...series.map((s) => s.count));
  const maxFlow = Math.max(1, ...flows.map((f) => f.count));
  const ranges = [['24h', '24h'], [7, '7 days'], [30, '30 days'], [90, '90 days']];
  const activeRange = hours ? '24h' : days;
  const pickRange = (v) => { if (v === '24h') setHours(24); else { setHours(null); setDays(v); } };
  const kpi = (Icon, val, label, accent) => <Card className="p-4"><Icon size={16} className={accent || 'text-[var(--primary-2)]'} /><div className="text-2xl font-bold mt-2">{val}</div><div className="text-[11px] text-[var(--muted)]">{label}</div></Card>;
  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="font-semibold flex items-center gap-2"><TrendingUp size={16} /> Site analytics
          {data?.live > 0 && <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400 ml-1"><span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> {data.live} live</span>}</h2>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-[var(--line)] overflow-hidden">
            {ranges.map(([d, l]) => <button key={d} onClick={() => pickRange(d)} className={`px-3 py-1.5 text-xs ${activeRange === d ? 'bg-[var(--surface-2)] text-[var(--text)] font-medium' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>{l}</button>)}
          </div>
          <a href="http://telemetry.localhost" target="_blank" rel="noreferrer"><Button size="sm"><Gauge size={14} /> BMM telemetry</Button></a>
        </div>
      </div>

      {/* KPI row (Rybbit-style) */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
        {kpi(Users, data?.uniqueVisitors ?? '—', 'Unique visitors')}
        {kpi(Package, data?.sessions ?? '—', 'Sessions')}
        {kpi(Eye, data?.windowed ?? '—', 'Pageviews')}
        {kpi(TrendingUp, data?.viewsPerVisitor ?? '—', 'Pages / session')}
        {kpi(ArrowUpRight, data?.bounceRate != null ? `${data.bounceRate}%` : '—', 'Bounce rate')}
        {kpi(Zap, data?.live ?? '—', 'Live (30 min)', 'text-emerald-400')}
      </div>

      <Card className="p-5 mb-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="text-xs font-semibold text-[var(--faint)] uppercase">{gran === 'hour' ? 'Traffic per hour · last 24h' : 'Traffic per day'}</div>
          <div className="flex items-center gap-3 text-[11px] text-[var(--muted)]">
            <span className="hidden sm:flex items-center gap-1 text-[var(--faint)]"><Search size={11} /> Ctrl + scroll to zoom</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-gradient-to-t from-orange-500 to-amber-400" /> Views</span><span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-sky-400" /> Visitors</span></div>
        </div>
        {loading ? <div className="h-40 grid place-items-center text-[var(--faint)] text-sm"><Spinner /></div> : <TrafficChart series={series} gran={gran} onZoom={onZoom} compare={data?.compare} />}
      </Card>

      {/* devices · browsers · OS with real icons */}
      <div className="grid md:grid-cols-3 gap-4 mb-4">
        <Breakdown title="Devices" rows={devices} iconOf={(l) => { const I = { mobile: Zap, tablet: Package, desktop: Server }[l] || Server; return <I size={13} className="text-[var(--faint)]" />; }} />
        <Breakdown title="Browsers" rows={browsers} iconOf={(l) => <BrandImg slug={BROWSER_SLUG[l]} />} />
        <Breakdown title="Operating systems" rows={oses} iconOf={(l) => (OS_SLUG[l] ? <BrandImg slug={OS_SLUG[l]} fallback={Monitor} /> : <Monitor size={13} className="text-[var(--faint)] shrink-0" />)} />
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <Card className="p-5">
          <div className="text-xs font-semibold text-[var(--faint)] uppercase mb-3">Top pages</div>
          <div className="space-y-2.5">
            {top.length ? top.map((t) => (
              <div key={t.path} className="flex items-center gap-3 text-sm">
                <span className="text-[var(--muted)] truncate w-40 shrink-0">{t.path}</span>
                <div className="flex-1 h-2 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className="h-full bg-gradient-to-r from-orange-500 to-amber-500" style={{ width: `${(t.count / maxTop) * 100}%` }} /></div>
                <span className="w-10 text-right font-medium">{t.count}</span>
              </div>
            )) : <div className="text-sm text-[var(--faint)]">No page data yet.</div>}
          </div>
        </Card>
        <Card className="p-5">
          <div className="text-xs font-semibold text-[var(--faint)] uppercase mb-3">Top referrers</div>
          <div className="space-y-2.5">
            {refs.length ? refs.map((r) => { const host = refHost(r.ref); return (
              <div key={r.ref} className="flex items-center gap-3 text-sm">
                <span className="text-[var(--muted)] truncate w-40 shrink-0 flex items-center gap-2"><BrandImg favicon={/\.[a-z]{2,}$/i.test(host) ? `https://icons.duckduckgo.com/ip3/${host}.ico` : null} /> {host}</span>
                <div className="flex-1 h-2 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className="h-full bg-gradient-to-r from-sky-500 to-cyan-400" style={{ width: `${(r.count / maxRef) * 100}%` }} /></div>
                <span className="w-10 text-right font-medium">{r.count}</span>
              </div>); })
              : <div className="text-sm text-[var(--faint)]">No referrers yet — most visits are direct.</div>}
          </div>
        </Card>
      </div>

      {/* countries (real geo from the CDN header) + funnel */}
      <div className="grid md:grid-cols-[1fr_1.6fr] gap-4 mb-4">
        <Breakdown title="Countries" rows={countries} iconOf={(cc) => <img src={`https://flagcdn.com/24x18/${String(cc).toLowerCase()}.png`} alt="" className="w-4 h-3 rounded-[2px] object-cover" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />} />
        <Card className="p-5">
          <div className="text-xs font-semibold text-[var(--faint)] uppercase mb-3 flex items-center gap-1.5"><ArrowRight size={13} /> Funnel · page journeys</div>
          <Sankey flows={flows} />
        </Card>
      </div>

      <p className="text-[11px] text-[var(--faint)]">Geo comes from the CDN country header when present, otherwise from a local offline GeoIP lookup on the visitor IP — private/loopback IPs (local dev) have no country. Retention cohorts aren't shown — the privacy-friendly daily-rotating visitor hash intentionally can't track people across days.</p>
    </div>
  );
}

// ── Shared: page visibility + scheduled-update controls, used by both the
// fixed-project editor (AdminProjects) and the showcase editor (ShowcaseEditModal). ──

// Whitelist entries ({type:"bcweb"|"discord"|"creator", id, label}) — same BC/
// Discord account search as PolicyAccountChips, plus a raw creator-id add (no
// search index for that one, it's an opaque BMM-generated id).
function PageWhitelistEditor({ items, onAdd, onRemove }) {
  const [q, setQ] = useState(''); const [results, setResults] = useState(null); const [busy, setBusy] = useState(false);
  const [creatorId, setCreatorId] = useState('');
  const search = async () => {
    if (!q.trim()) return setResults(null);
    setBusy(true);
    try { const { users } = await api.get(`/admin/users?q=${encodeURIComponent(q)}&take=8`); setResults(users); } catch { setResults([]); } finally { setBusy(false); }
  };
  const has = (type, id) => items.some((a) => a.type === type && a.id === id);
  const add = (entry) => { if (!has(entry.type, entry.id)) onAdd(entry); };
  const addCreator = () => { const id = creatorId.trim(); if (id && !has('creator', id)) { onAdd({ type: 'creator', id, label: id }); setCreatorId(''); } };
  return (
    <div>
      <div className="flex gap-1.5">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search BC account / Discord…" onKeyDown={(e) => e.key === 'Enter' && search()} />
        <Button size="sm" onClick={search}>{busy ? <Spinner /> : <Search size={13} />}</Button>
      </div>
      {results && (
        <div className="mt-1.5 space-y-1">
          {results.length ? results.map((u) => (
            <div key={u.id} className="flex items-center justify-between gap-2 px-2 py-1 rounded-md bg-[var(--surface-2)] border border-[var(--line)] text-[11px]">
              <span className="truncate">{u.displayName}{u.discord && <span className="text-[var(--faint)]"> · Discord: {u.discord.username || u.discord.id}</span>}</span>
              <span className="flex gap-1 shrink-0">
                <button onClick={() => add({ type: 'bcweb', id: u.id, label: u.displayName })} className="px-1.5 py-0.5 rounded border border-[var(--line)] hover:text-[var(--primary-2)] hover:border-[var(--primary-2)]">+ BC</button>
                {u.discord && <button onClick={() => add({ type: 'discord', id: u.discord.id, label: u.discord.username || u.discord.id })} className="px-1.5 py-0.5 rounded border border-[var(--line)] hover:text-[var(--primary-2)] hover:border-[var(--primary-2)]">+ Discord</button>}
              </span>
            </div>
          )) : <div className="text-[11px] text-[var(--faint)] px-1">No accounts found.</div>}
        </div>
      )}
      <div className="flex gap-1.5 mt-1.5">
        <Input value={creatorId} onChange={(e) => setCreatorId(e.target.value)} placeholder="Add by BMM creator id…" onKeyDown={(e) => e.key === 'Enter' && addCreator()} />
        <Button size="sm" onClick={addCreator}><Plus size={13} /></Button>
      </div>
      <div className="flex flex-wrap gap-1 mt-1.5">
        {items.length ? items.map((a) => (
          <span key={`${a.type}:${a.id}`} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[var(--surface-2)] border border-[var(--line)] text-[11px]">
            <Users size={9} className="text-[var(--faint)]" /> {a.type === 'discord' ? 'Discord: ' : a.type === 'creator' ? 'Creator: ' : ''}{a.label || a.id}
            <button onClick={() => onRemove(a)} className="text-[var(--faint)] hover:text-red-400"><X size={10} /></button>
          </span>
        )) : <span className="text-[11px] text-[var(--faint)]">No entries — nobody can view.</span>}
      </div>
    </div>
  );
}

const VISIBILITY_OPTS = [
  { v: 'public', label: 'Public', desc: 'Anyone can view this page.' },
  { v: 'unlisted', label: 'Unlisted', desc: "Hidden from the topbar/projects grid, but viewable by anyone with the direct link." },
  { v: 'private', label: 'Private', desc: 'Nobody can view it (admin preview only, via the edit form).' },
  { v: 'whitelist', label: 'Whitelist', desc: 'Only the accounts listed below can view it.' },
];

function VisibilitySection({ visibility, whitelist, onVisibility, onAddWhitelist, onRemoveWhitelist }) {
  return (
    <div className="p-3 rounded-lg bg-[var(--surface-2)] border border-[var(--line)] space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] flex items-center gap-1.5">{visibility === 'public' ? <Eye size={12} /> : <EyeOff size={12} />} Visibility</div>
      <Select value={visibility} onChange={(e) => onVisibility(e.target.value)}>
        {VISIBILITY_OPTS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
      </Select>
      <div className="text-[11px] text-[var(--faint)]">{VISIBILITY_OPTS.find((o) => o.v === visibility)?.desc}</div>
      {visibility === 'whitelist' && <PageWhitelistEditor items={whitelist} onAdd={onAddWhitelist} onRemove={onRemoveWhitelist} />}
    </div>
  );
}

// A "project announcement": a countdown teaser (logo + markdown) shown instead
// of the real page until announceRevealAt — used to build hype for a not-yet-
// public project. Fully optional; the section collapses to just the checkbox
// when off.
function AnnouncementSection({ value, onChange }) {
  const set = (k) => (v) => onChange({ ...value, [k]: v });
  return (
    <div className="p-3 rounded-lg bg-[var(--surface-2)] border border-[var(--line)] space-y-2">
      <label className="flex items-center gap-2 text-sm cursor-pointer font-semibold"><input type="checkbox" checked={value.announceEnabled} onChange={(e) => set('announceEnabled')(e.target.checked)} /> <Megaphone size={13} className="text-[var(--primary-2)]" /> Project announcement (countdown teaser)</label>
      {value.announceEnabled && (
        <div className="space-y-2 pl-1">
          <p className="text-[11px] text-[var(--faint)]">Shown to everyone in place of the real page until the countdown ends — great for building hype before a soft-launch. Visibility above only takes effect once the countdown is over.</p>
          <Field label="Title"><Input value={value.announceTitle} onChange={(e) => set('announceTitle')(e.target.value)} placeholder="Something big is coming…" /></Field>
          <Field label="Logo URL (optional)"><Input value={value.announceLogo || ''} onChange={(e) => set('announceLogo')(e.target.value)} placeholder="https://example.com/logo.png" /></Field>
          <Field label="Markdown description"><Textarea rows={5} value={value.announceMarkdown} onChange={(e) => set('announceMarkdown')(e.target.value)} placeholder="Tell people what's coming — markdown supported." /></Field>
          <Field label="Reveal at"><Input type="datetime-local" value={value.announceRevealAt || ''} onChange={(e) => set('announceRevealAt')(e.target.value)} /></Field>
        </div>
      )}
    </div>
  );
}

// Stage a future content swap: pick a date/time, edit the "next" JSON (+ name/
// short for showcase pages), and it swaps in automatically once due — no admin
// action needed at reveal time. `putSchedule` is the save callback (varies by
// fixed-vs-showcase endpoint); `current` seeds the editor with today's live values.
function ScheduleUpdateModal({ title, current, includeNameShort, existing, onClose, onSave }) {
  const toast = useToast();
  const [at, setAt] = useState(existing?.scheduledAt ? new Date(existing.scheduledAt).toISOString().slice(0, 16) : '');
  const [name, setName] = useState(existing?.scheduledNext?.name ?? current.name ?? '');
  const [short, setShort] = useState(existing?.scheduledNext?.short ?? current.short ?? '');
  const [configText, setConfigText] = useState(JSON.stringify(existing?.scheduledNext?.config ?? current.config ?? {}, null, 2));
  const [busy, setBusy] = useState(false);
  const hasExisting = !!existing?.scheduledAt;
  const save = async () => {
    if (!at) return toast.error('Pick a date/time.');
    let config; try { config = JSON.parse(configText || '{}'); } catch { return toast.error('Config JSON is invalid.'); }
    const next = includeNameShort ? { name: name.trim(), short: short.trim(), config } : { config };
    setBusy(true);
    try { await onSave(new Date(at).toISOString(), next); toast.success('Update scheduled.'); onClose(); }
    catch { toast.error('Failed.'); } finally { setBusy(false); }
  };
  const cancelSchedule = async () => {
    setBusy(true);
    try { await onSave(null, null); toast.success('Schedule cancelled.'); onClose(); }
    catch { toast.error('Failed.'); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={title} icon={Clock} width="max-w-lg"
      footer={<>
        {hasExisting && <Button variant="ghost" className="!text-red-400" disabled={busy} onClick={cancelSchedule}>Cancel schedule</Button>}
        <Button variant="ghost" onClick={onClose}>Close</Button>
        <Button variant="primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : 'Schedule'}</Button>
      </>}>
      <p className="text-sm text-[var(--muted)] mb-3">Stage new content below — it automatically replaces the current version at the date/time you pick. Nothing changes until then.</p>
      <Field label="Switch at"><Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></Field>
      {includeNameShort && (
        <div className="grid grid-cols-[1fr_110px] gap-3 mt-3">
          <Field label="New name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="New short (≤5)"><Input value={short} maxLength={5} onChange={(e) => setShort(e.target.value)} /></Field>
        </div>
      )}
      <div className="mt-3">
        <label className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5 block">New config (JSON)</label>
        <JsonEditor value={configText} onChange={setConfigText} minH={220} />
      </div>
    </Modal>
  );
}

// ── Admin: "Other projects" showcase (CRUD) ──
const SHOWCASE_TEMPLATE = {
  tagline: '',
  downloads: [{ label: 'Download', url: '', primary: true }],
  links: { github: '', source: '', discord: '', kofi: '', website: '', customLabel: '', customUrl: '' },
  overview: { image: '', video: '', replayUrl: '', rrwebUrl: '' },
  progressSource: '',
  releaseNotes: { owner: '', repo: '', branch: 'main', path: '' },
  community: { url: '', messages: [], contributors: [] },
  legal: [{ icon: 'shield', title: 'License', text: '', url: '' }],
};

function AdminShowcase() {
  const toast = useToast(); const dialog = useDialog();
  const { data, loading, reload } = useAsync(() => api.get('/admin/showcase'), []);
  const [editing, setEditing] = useState(null); // project object or 'new'
  const [scheduling, setScheduling] = useState(null); // project object
  const projects = data?.projects || [];
  const del = async (pr) => { if (!(await dialog.confirm({ title: 'Delete project', message: `Delete "${pr.name}"?`, okLabel: 'Delete', danger: true }))) return; try { await api.del(`/admin/showcase/${pr.id}`); toast.success('Deleted.'); reload(); } catch { toast.error('Failed.'); } };
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold flex items-center gap-2"><Sparkles size={16} className="text-[var(--primary-2)]" /> Other projects</h2>
        <Button size="sm" variant="primary" onClick={() => setEditing('new')}><Plus size={14} /> New project</Button>
      </div>
      <p className="text-sm text-[var(--muted)] mb-4">Feature any project on the public <code>/projects</code> page. Overview is always shown; enable Release notes, Community and Legal per project.</p>
      {loading ? <Loading /> : projects.length ? <div className="space-y-2">
        {projects.map((pr) => {
          const announcing = pr.announceEnabled && pr.announceRevealAt && new Date(pr.announceRevealAt) > new Date();
          return (
          <Card key={pr.id} className="p-4 flex items-center gap-3 flex-wrap">
            <div className="grid place-items-center w-10 h-10 rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 text-white font-extrabold text-xs shrink-0">{pr.short}</div>
            <div className="flex-1 min-w-0"><div className="font-medium truncate">{pr.name} <span className="text-xs text-[var(--faint)] font-normal">/project/{pr.slug}</span></div>
              <div className="text-xs text-[var(--faint)] flex items-center gap-1.5 flex-wrap">
                {[pr.config?.tabs?.releases && 'releases', pr.config?.tabs?.community && 'community', pr.config?.tabs?.legal && 'legal'].filter(Boolean).join(' · ') || 'overview only'}
                {pr.pinTopbar && <span className="inline-flex items-center gap-0.5 text-[var(--primary-2)]"><Rss size={10} /> topbar</span>}
                {pr.visibility && pr.visibility !== 'public' && <span className="inline-flex items-center gap-0.5"><EyeOff size={10} /> {pr.visibility}</span>}
              </div></div>
            <Badge tone={pr.published ? 'green' : ''}>{pr.published ? 'published' : 'hidden'}</Badge>
            {announcing && <Badge tone="primary"><Megaphone size={10} /> counting down</Badge>}
            {pr.scheduledAt && <Badge tone="primary"><Clock size={10} /> update {new Date(pr.scheduledAt).toLocaleDateString()}</Badge>}
            <Button size="sm" variant="ghost" onClick={() => setScheduling(pr)} title="Schedule an update"><Clock size={14} /></Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(pr)}><PenSquare size={14} /> Edit</Button>
            <a href={`/project/${pr.slug}`} target="_blank" rel="noreferrer"><Button size="sm" variant="ghost"><ArrowUpRight size={14} /></Button></a>
            <Button size="sm" variant="ghost" onClick={() => del(pr)}><Trash2 size={14} /></Button>
          </Card>
          );
        })}
      </div> : <EmptyState icon={Sparkles} title="No projects yet" sub="Add your first featured project." />}
      {editing && <ShowcaseEditModal project={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={reload} />}
      {scheduling && (
        <ScheduleUpdateModal title={`Schedule an update — ${scheduling.name}`} includeNameShort existing={scheduling}
          current={{ name: scheduling.name, short: scheduling.short, config: scheduling.config }}
          onClose={() => setScheduling(null)}
          onSave={async (at, next) => { await api.put(`/admin/showcase/${scheduling.id}/schedule`, { at, next }); reload(); }} />
      )}
    </div>
  );
}

function ShowcaseEditModal({ project, onClose, onDone }) {
  const toast = useToast();
  const isNew = !project;
  const cfg0 = project?.config || {};
  const [name, setName] = useState(project?.name || '');
  const [short, setShort] = useState(project?.short || '');
  const [published, setPublished] = useState(project?.published ?? true);
  const [tabs, setTabs] = useState({ releases: !!cfg0.tabs?.releases, community: !!cfg0.tabs?.community, legal: !!cfg0.tabs?.legal });
  const [tagline, setTagline] = useState(cfg0.tagline || '');
  const { tabs: _t, tagline: _tl, ...rest } = cfg0;
  const [details, setDetails] = useState(JSON.stringify(Object.keys(rest).length ? rest : SHOWCASE_TEMPLATE, null, 2));
  const [pinTopbar, setPinTopbar] = useState(project?.pinTopbar ?? false);
  const [visibility, setVisibility] = useState(project?.visibility ?? 'public');
  const [whitelist, setWhitelist] = useState(project?.visibilityWhitelist ?? []);
  const [announce, setAnnounce] = useState({
    announceEnabled: project?.announceEnabled ?? false,
    announceTitle: project?.announceTitle ?? '',
    announceLogo: project?.announceLogo ?? '',
    announceMarkdown: project?.announceMarkdown ?? '',
    announceRevealAt: project?.announceRevealAt ? new Date(project.announceRevealAt).toISOString().slice(0, 16) : '',
  });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (name.trim().length < 2) return toast.error('Name is required.');
    if (!short.trim()) return toast.error('Short name is required.');
    let extra = {}; try { extra = JSON.parse(details || '{}'); } catch { return toast.error('Details JSON is invalid.'); }
    if (announce.announceEnabled && !announce.announceRevealAt) return toast.error('Set a reveal date/time for the announcement.');
    const config = { ...extra, tabs, tagline };
    const payload = {
      name: name.trim(), short: short.trim(), published, config, pinTopbar, visibility, visibilityWhitelist: whitelist,
      ...announce, announceRevealAt: announce.announceEnabled && announce.announceRevealAt ? new Date(announce.announceRevealAt).toISOString() : null,
    };
    setBusy(true);
    try {
      if (isNew) await api.post('/admin/showcase', payload);
      else await api.put(`/admin/showcase/${project.id}`, payload);
      toast.success('Saved.'); onClose(); onDone();
    } catch (x) { toast.error(x.data?.error || 'Save failed.'); } finally { setBusy(false); }
  };
  const Toggle = ({ k, label }) => <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={tabs[k]} onChange={(e) => setTabs({ ...tabs, [k]: e.target.checked })} /> {label}</label>;
  return (
    <Modal open onClose={onClose} title={isNew ? 'New project' : `Edit ${project.name}`} icon={Sparkles} width="max-w-lg"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : 'Save'}</Button></>}>
      <div className="grid grid-cols-[1fr_110px] gap-3">
        <Field label="Project name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Better Something" /></Field>
        <Field label="Short (≤5)"><Input value={short} maxLength={5} onChange={(e) => setShort(e.target.value)} placeholder="BS" /></Field>
      </div>
      <div className="mt-3"><Field label="Tagline"><Input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="One-line description" /></Field></div>
      <div className="mt-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">Sub-tabs</div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 p-3 rounded-lg bg-[var(--surface-2)] border border-[var(--line)]">
          <label className="flex items-center gap-2 text-sm text-[var(--muted)]"><input type="checkbox" checked disabled /> Overview (always)</label>
          <Toggle k="releases" label="Release notes" />
          <Toggle k="community" label="Community" />
          <Toggle k="legal" label="Legal" />
        </div>
      </div>
      <div className="mt-3">
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)]">Details (JSON)</label>
          <button type="button" onClick={() => setDetails(JSON.stringify(SHOWCASE_TEMPLATE, null, 2))} className="btn btn-sm"><Wand2 size={13} /> Template</button>
        </div>
        <p className="text-[11px] text-[var(--faint)] mb-1.5">links (github/source/discord/kofi/website/custom), downloads[], overview media (image/video/replayUrl/rrwebUrl), progressSource, releaseNotes, community, legal cards.</p>
        <JsonEditor value={details} onChange={setDetails} minH={220} />
      </div>
      <label className="flex items-center gap-2 text-sm mt-3 cursor-pointer"><input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} /> Published (visible on /projects)</label>
      <label className="flex items-center gap-2 text-sm mt-2 cursor-pointer"><input type="checkbox" checked={pinTopbar} onChange={(e) => setPinTopbar(e.target.checked)} /> <Rss size={13} className="text-[var(--primary-2)]" /> Pin as its own topbar pill (not just the /projects grid)</label>
      <div className="mt-3">
        <VisibilitySection visibility={visibility} whitelist={whitelist} onVisibility={setVisibility}
          onAddWhitelist={(e) => setWhitelist((w) => [...w, e])} onRemoveWhitelist={(e) => setWhitelist((w) => w.filter((a) => !(a.type === e.type && a.id === e.id)))} />
      </div>
      <div className="mt-3"><AnnouncementSection value={announce} onChange={setAnnounce} /></div>
    </Modal>
  );
}

// Hosting settings, grouped by what they actually govern (capacity ceilings vs.
// pricing knobs vs. feature flags) instead of one flat undifferentiated grid —
// each field gets a real description of its effect, not just a bare label.
const SETTINGS_GROUPS = [
  { title: 'Capacity', icon: HardDrive, keys: [
    ['hosting.totalCapacityGB', 'Total capacity (GB)', 'The overall ceiling for everything hosting draws against — checked against the real disk on save.', 'number'],
    ['hosting.reservedFreeGB', 'Reserved free margin (GB)', 'Always kept free below Total capacity, as a safety buffer.', 'number'],
    ['hosting.tempMarginGB', 'Temp margin for submissions (GB)', 'Separate pool for catalog submissions awaiting moderation — full = new uploads refused until reviewed.', 'number'],
    ['hosting.freeTierCapEnabled', 'Cap the free hosting-plan pool', 'When on, the Free hosting plan goes "sold out" once free repos together reach the cap below — paid plans never count against this.', 'bool'],
    ['hosting.freeTierCapGB', 'Free hosting-plan pool cap (GB)', 'Total storage the Free plan can ever occupy across every user, once the toggle above is on.', 'number'],
    ['catalog.freeTierCapEnabled', 'Cap the free catalog-upload pool', 'When on, free catalog file hosting goes "sold out" once free uploads together reach the cap below — paid uploads never count against this.', 'bool'],
    ['catalog.freeTierCapMB', 'Free catalog-upload pool cap (MB)', 'Total payload bytes the free catalog tier can ever occupy across every user, once the toggle above is on.', 'number'],
  ] },
  { title: 'Pricing', icon: Receipt, keys: [
    ['pricing.perGBCents', 'Price per GB (¢ / month)', 'Base hosting cost, before the scarcity multiplier. Only applies above the free floor below.', 'number'],
    ['pricing.hostingFreeGB', 'Free hosting floor', 'Every repo\'s first N of storage cost nothing — small personal repos are free. Only the excess is billed.', 'gbmb', 'GB'],
    ['pricing.perUploadMbpsCents', 'Price per Mbps (¢ / month)', 'Cost per Mbps of upload bandwidth allotted to a repo.', 'number'],
    ['pricing.perCpuShareCents', 'Price per CPU share (¢ / month)', 'Cost per vCPU share allotted to a repo.', 'number'],
    ['pricing.featurePerDayCents', 'Feature (boost) price / day (¢)', 'Cost to keep a repo featured on the public listing.', 'number'],
    ['pricing.catalogHostPerMBCents', 'Catalog file hosting (¢ / MB / month)', 'Charged to non-staff submitters for our-hosted payloads above the free floor below.', 'number'],
    ['pricing.catalogFreeMB', 'Free catalog upload floor', 'Every submission\'s (app/plugin/theme/preset) first N are free — only the excess is billed.', 'gbmb', 'MB'],
  ] },
  { title: 'Feature flags', icon: Sliders, keys: [
    ['features.hostingEnabled', 'Hosting enabled', 'Turns the whole Server-Repo hosting feature off site-wide when unchecked.', 'bool'],
  ] },
];

// GB<->MB conversion for the free-floor unit toggle — the stored setting value
// always stays in its native unit (GB for hostingFreeGB, MB for catalogFreeMB);
// only the on-screen number changes when the admin picks a different unit.
const convertUnit = (value, fromUnit, toUnit) => fromUnit === toUnit ? Number(value) : (fromUnit === 'GB' ? Number(value) * 1024 : Number(value) / 1024);

function AdminSettings() {
  const toast = useToast();
  const { data, reload } = useAsync(() => api.get('/admin/settings'), []);
  const cap = useAsync(() => api.get('/hosting/capacity'), []);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(null);
  const [unit, setUnit] = useState({}); // settingKey -> 'MB' | 'GB' (display unit only)
  useEffect(() => { if (data?.settings) setDraft(data.settings); }, [data]);
  const coerce = (v, kind) => kind === 'bool' ? !!v : (v !== '' && !isNaN(Number(v)) ? Number(v) : v);
  const save = async (key, kind) => {
    setBusy(key);
    try { await api.put(`/admin/settings/${key}`, { value: coerce(draft[key], kind) }); toast.success('Saved.'); reload(); cap.reload?.(); }
    catch (x) { toast.error(x.data?.error === 'exceeds_disk' ? `Exceeds the real disk capacity (${x.data.diskGB} GB max).` : 'Save failed.'); }
    finally { setBusy(null); }
  };
  const c = cap.data?.capacity;
  const tempPct = c?.tempMarginGB ? Math.min(100, (c.tempUsedGB / c.tempMarginGB) * 100) : 0;
  return (
    <div className="mt-10"><h2 className="font-semibold mb-3 flex items-center gap-2"><Settings2 size={16} /> Hosting settings</h2>
      {/* Temp submissions margin — live usage. Uploads (.bmmplugin / .bmmtheme / app
          payloads) are refused once this is full, until moderation clears space. */}
      {c && (
        <Card className="p-4 mb-3">
          <div className="flex items-center justify-between text-sm mb-1.5">
            <span className="flex items-center gap-2 text-[var(--muted)]"><Upload size={14} className="text-[var(--primary-2)]" /> Temp storage (submissions)</span>
            <span className="font-semibold tabular-nums">{(c.tempUsedGB ?? 0).toFixed(2)} / {c.tempMarginGB ?? 0} GB</span>
          </div>
          <div className="h-2 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className={`h-full ${tempPct > 90 ? 'bg-red-500' : 'bg-gradient-to-r from-orange-500 to-amber-400'}`} style={{ width: `${tempPct}%` }} /></div>
          <div className="text-[11px] text-[var(--faint)] mt-1.5">Submitted files (.bmmplugin, .bmmtheme, app payloads) live here until moderation. When full, new submission uploads are refused.</div>
        </Card>
      )}
      <div className="space-y-5">
        {SETTINGS_GROUPS.map((g) => (
          <div key={g.title}>
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-2 flex items-center gap-1.5"><g.icon size={13} className="text-[var(--primary-2)]" /> {g.title}</div>
            <div className="grid md:grid-cols-2 gap-3">
              {g.keys.map(([k, label, desc, kind, nativeUnit]) => (
                <Card key={k} className="p-4">
                  {kind === 'bool' ? (
                    <div className="flex items-center justify-between gap-3">
                      <label className="flex items-center gap-2.5 text-sm cursor-pointer flex-1"><input type="checkbox" checked={draft[k] !== false && draft[k] !== 'false' && !!draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.checked })} /> <span className="font-medium">{label}</span></label>
                      <Button size="sm" disabled={busy === k} onClick={() => save(k, kind)}>{busy === k ? <Spinner /> : 'Save'}</Button>
                    </div>
                  ) : kind === 'gbmb' ? (() => {
                    const curUnit = unit[k] || nativeUnit;
                    const displayValue = draft[k] !== '' && draft[k] != null ? convertUnit(Number(draft[k]), nativeUnit, curUnit) : '';
                    return (
                      <div className="flex items-end gap-2">
                        <div className="flex-1"><Field label={label}><Input type="number" value={displayValue} onChange={(e) => setDraft({ ...draft, [k]: e.target.value === '' ? '' : convertUnit(Number(e.target.value), curUnit, nativeUnit) })} /></Field></div>
                        <Select className="!w-auto !py-2.5" value={curUnit} onChange={(e) => setUnit({ ...unit, [k]: e.target.value })}><option value="MB">MB</option><option value="GB">GB</option></Select>
                        <Button size="sm" disabled={busy === k} onClick={() => save(k, 'number')}>{busy === k ? <Spinner /> : 'Save'}</Button>
                      </div>
                    );
                  })() : (
                    <div className="flex items-end gap-3">
                      <div className="flex-1"><Field label={label}><Input type="number" value={draft[k] ?? ''} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} /></Field></div>
                      <Button size="sm" disabled={busy === k} onClick={() => save(k, kind)}>{busy === k ? <Spinner /> : 'Save'}</Button>
                    </div>
                  )}
                  <div className="text-[11px] text-[var(--faint)] mt-1.5">{desc}</div>
                  {k === 'hosting.totalCapacityGB' && c?.diskTotalGB != null && <div className="text-[11px] text-amber-400/90 mt-1">Real disk: {c.diskFreeGB.toFixed(0)} GB free / {c.diskTotalGB.toFixed(0)} GB total — can't be set above this.</div>}
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────  Settings  ───────────────────────── */
// Device-local preferences (nothing account-bound): appearance, language, the
// intro animation, modal transparency, and the cookie/privacy choice. Everything
// here is a localStorage-backed client preference applied live.
export function Settings() {
  const { t } = useI18n();
  const { theme, toggle: toggleTheme } = useTheme();
  const { lang, setLang } = useI18n();
  const toast = useToast();
  const [skipIntro, setSkipIntro] = useState(() => { try { return localStorage.getItem(SKIP_KEY) === '1'; } catch { return false; } });
  const [consent, setConsentState] = useState(() => getConsent() || 'essential');
  const [glass, setGlass] = useState(() => getGlassPrefs());
  const [orbTransition, setOrbTransition] = useState(() => getOrbTransitionPref());

  const setIntro = (skip) => { setSkipIntro(skip); try { skip ? localStorage.setItem(SKIP_KEY, '1') : localStorage.removeItem(SKIP_KEY); } catch {} };
  const setOrbTr = (on) => { setOrbTransition(on); setOrbTransitionPref(on); };
  const setCookie = (v) => { setConsentState(v); setConsent(v); toast.success(t('set.saved', 'Saved.')); };
  const applyGlass = (next) => { setGlass(next); setGlassPrefs(next); };

  const Row = ({ icon: Icon, title, desc, children }) => (
    <div className="flex items-center gap-3 py-3.5 border-b border-[var(--line)] last:border-0">
      <span className="grid place-items-center w-9 h-9 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] shrink-0"><Icon size={16} className="text-[var(--primary-2)]" /></span>
      <div className="flex-1 min-w-0"><div className="text-sm font-medium">{title}</div>{desc && <div className="text-xs text-[var(--muted)] mt-0.5">{desc}</div>}</div>
      <div className="shrink-0">{children}</div>
    </div>
  );
  const Switch = ({ on, onChange }) => (
    <button onClick={() => onChange(!on)} className={`relative w-10 h-6 rounded-full transition shrink-0 ${on ? 'bg-[var(--primary)]' : 'bg-[var(--surface-2)] border border-[var(--line)]'}`} role="switch" aria-checked={on}>
      <span className={`absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[16px]' : 'translate-x-0'}`} />
    </button>
  );

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader icon={Sliders} title={t('set.title', 'Settings')} subtitle={t('set.sub', 'Your device preferences — saved on this browser only.')} />

      <Card className="p-4 sm:p-5 mb-4">
        <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1 flex items-center gap-1.5"><Palette size={13} /> {t('set.appearance', 'Appearance')}</div>
        <Row icon={theme === 'dark' ? Sparkles : Palette} title={t('set.theme', 'Theme')} desc={t('set.theme.d', 'Light or dark — applies instantly.')}>
          <Select value={theme} onChange={(e) => { if (e.target.value !== theme) toggleTheme(); }} className="!w-auto"><option value="light">{t('set.light', 'Light')}</option><option value="dark">{t('set.dark', 'Dark')}</option></Select>
        </Row>
        <Row icon={Globe} title={t('set.lang', 'Language')} desc={t('set.lang.d', 'Interface language.')}>
          <Select value={lang} onChange={(e) => setLang(e.target.value)} className="!w-auto"><option value="en">English</option><option value="fr">Français</option></Select>
        </Row>
        <Row icon={Sparkles} title={t('set.intro', 'Intro animation')} desc={t('set.intro.d', 'Play the orb intro on each page load.')}>
          <Switch on={!skipIntro} onChange={(v) => setIntro(!v)} />
        </Row>
        <Row icon={Orbit} title={t('set.orbtr', 'Orb page transitions')} desc={t('set.orbtr.d', 'On each navigation, the hero orb shatters and dives into a random shard, then rebuilds. Off by default.')}>
          <Switch on={orbTransition} onChange={setOrbTr} />
        </Row>
        <Row icon={Eye} title={t('set.glass', 'Translucent surfaces')} desc={t('set.glass.d', 'Frosted-glass cards & dialogs instead of solid ones.')}>
          <Switch on={glass.on} onChange={(v) => applyGlass({ ...glass, on: v })} />
        </Row>
        {glass.on && (
          <div className="flex items-center gap-3 py-3 pl-12">
            <span className="text-xs text-[var(--muted)] shrink-0">{t('set.glass.opacity', 'Opacity')}</span>
            <input type="range" min="40" max="100" step="5" value={glass.pct} onChange={(e) => applyGlass({ ...glass, pct: Number(e.target.value) })} className="flex-1 accent-[var(--primary)]" />
            <span className="text-xs font-medium tabular-nums w-10 text-right">{glass.pct}%</span>
          </div>
        )}
      </Card>

      <Card className="p-4 sm:p-5">
        <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1 flex items-center gap-1.5"><Cookie size={13} /> {t('set.privacy', 'Cookies & privacy')}</div>
        <Row icon={Cookie} title={t('set.cookies', 'Analytics cookies')} desc={t('set.cookies.d', 'Essential keeps you signed in; All also enables privacy-friendly, first-party page analytics.')}>
          <Select value={consent} onChange={(e) => setCookie(e.target.value)} className="!w-auto"><option value="essential">{t('set.essential', 'Essential only')}</option><option value="all">{t('set.all', 'Accept all')}</option></Select>
        </Row>
        <div className="pt-3 text-xs text-[var(--muted)]">
          {t('set.privacy.more', 'Read more in the')} <Link to="/cookies" className="text-[var(--primary-2)] hover:underline">{t('nav.cookies', 'Cookie Policy')}</Link> {t('set.and', 'and')} <Link to="/privacy" className="text-[var(--primary-2)] hover:underline">{t('nav.privacy', 'Privacy Policy')}</Link>.
        </div>
      </Card>
    </div>
  );
}

/* ─────────────────────────  Contact  ───────────────────────── */
export function Contact() {
  const { lang } = useI18n();
  const { user } = useAuth();
  const toast = useToast();
  const fr = lang === 'fr';
  const [msg, setMsg] = useState({ name: '', email: '', body: '' });
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  // Prefill from the account when logged in — the message is linked to the
  // account server-side regardless, this is just a convenience.
  useEffect(() => { if (user) setMsg((m) => ({ ...m, name: m.name || user.displayName || '', email: m.email || user.email || '' })); }, [user]);
  const channels = [
    { icon: DiscordIcon, label: 'Discord', sub: fr ? 'Support & communauté, en direct' : 'Fastest support & community', href: 'https://discord.com/invite/CTaaEF9R75' },
    { icon: GithubIcon, label: 'GitHub', sub: fr ? 'Signaler un bug / une issue' : 'Report bugs & issues', href: 'https://github.com/FreeProject089' },
    { icon: KofiIcon, label: 'Ko-fi', sub: fr ? 'Soutenir le projet' : 'Support the project', href: 'https://ko-fi.com/bettercommunity', kofi: true },
    { icon: RedditIcon, label: 'Reddit', sub: fr ? 'Discussions' : 'Discussions', href: 'https://www.reddit.com/r/BetterModManager/' },
  ];
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(msg.email);
  const valid = msg.name.trim().length >= 1 && emailOk && msg.body.trim().length >= 5;
  const send = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const { solvePow } = await import('./pow.js');
      const pow = await solvePow(() => api.get('/auth/pow')); // anti-spam proof-of-work
      await api.post('/contact', { name: msg.name.trim(), email: msg.email.trim(), body: msg.body.trim(), pow });
      setSent(true);
    } catch (x) {
      const err = x.data?.error;
      toast.error(err === 'daily_limit' ? (fr ? (user ? 'Limite quotidienne atteinte (5/jour).' : 'Limite quotidienne atteinte (3/jour). Connecte-toi pour 5/jour.') : (user ? 'Daily limit reached (5/day).' : 'Daily limit reached (3/day). Log in for 5/day.'))
        : err === 'invalid_input' ? (fr ? 'Vérifie les champs.' : 'Check the fields.') : (fr ? 'Échec de l’envoi.' : 'Failed to send.'));
    } finally { setBusy(false); }
  };
  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader icon={Mail} title="Contact" subtitle={fr ? 'Questions, bugs, partenariats — écris-nous.' : 'Questions, bug reports, partnerships — reach the team.'} />
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        {channels.map((c) => (
          <a key={c.label} href={c.href} target="_blank" rel="noreferrer">
            <Card hover className="p-5 h-full"><c.icon size={22} className={c.kofi ? 'text-orange-400' : 'text-[var(--primary-2)]'} />
              <div className="font-semibold mt-3">{c.label}</div><div className="text-xs text-[var(--muted)] mt-0.5">{c.sub}</div></Card>
          </a>
        ))}
      </div>

      <Card className="overflow-hidden">
        {/* gradient header strip */}
        <div className="px-6 py-4 border-b border-[var(--line)] bg-gradient-to-r from-orange-500/12 via-amber-500/6 to-transparent flex items-center gap-2.5">
          <span className="grid place-items-center w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500"><MessageSquare size={16} className="text-white" /></span>
          <div><div className="font-semibold leading-tight">{fr ? 'Envoyer un message' : 'Send a message'}</div>
            <div className="text-xs text-[var(--muted)]">{fr ? 'Reçu directement par l’équipe — réponse par email.' : 'Goes straight to the team — we reply by email.'}</div></div>
        </div>

        {sent ? (
          <div className="p-10 text-center">
            <span className="inline-grid place-items-center w-14 h-14 rounded-2xl bg-emerald-500/15 mb-4"><BadgeCheck size={28} className="text-emerald-400" /></span>
            <div className="text-lg font-semibold">{fr ? 'Message envoyé !' : 'Message sent!'}</div>
            <p className="text-sm text-[var(--muted)] mt-1.5 max-w-sm mx-auto">{fr ? 'Merci — on te répond dès que possible. Pour du temps réel, rejoins le Discord ci-dessus.' : 'Thanks — we’ll get back to you soon. Prefer real-time? Join the Discord above.'}</p>
            <Button className="mt-5" onClick={() => { setSent(false); setMsg({ name: '', email: '', body: '' }); }}>{fr ? 'Envoyer un autre' : 'Send another'}</Button>
          </div>
        ) : (
          <div className="p-6">
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label={fr ? 'Ton nom' : 'Your name'}><Input value={msg.name} onChange={(e) => setMsg({ ...msg, name: e.target.value })} maxLength={100} placeholder={fr ? 'Ton nom ou pseudo' : 'Your name or handle'} /></Field>
              <Field label={fr ? 'Ton email' : 'Your email'} hint={msg.email && !emailOk ? (fr ? 'Email invalide' : 'Invalid email') : undefined}>
                <Input type="email" value={msg.email} onChange={(e) => setMsg({ ...msg, email: e.target.value })} maxLength={254} placeholder="you@example.com" className={msg.email && !emailOk ? '!border-red-500/40' : ''} /></Field>
            </div>
            <div className="mt-4">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] flex items-center gap-1.5">Message <span className="normal-case font-normal text-[var(--faint)]">({fr ? 'markdown supporté' : 'markdown supported'})</span></label>
                <span className={`text-[11px] ${msg.body.length > 2000 ? 'text-red-400' : 'text-[var(--faint)]'}`}>{msg.body.length}/2000</span>
              </div>
              <div className="rounded-xl border border-[var(--line)] overflow-hidden focus-within:border-[var(--line-strong)] transition-colors" style={{ background: 'var(--surface-2)' }}>
                <textarea value={msg.body} onChange={(e) => setMsg({ ...msg, body: e.target.value })} maxLength={2000} rows={6}
                  placeholder={fr ? 'Décris ta question, ton bug ou ta proposition…' : 'Describe your question, bug, or proposal…'}
                  className="w-full bg-transparent px-3.5 py-3 text-sm outline-none resize-y leading-relaxed text-[var(--text)]" style={{ minHeight: 150 }} />
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 mt-4 flex-wrap">
              <p className="text-xs text-[var(--faint)] flex items-center gap-1.5"><ShieldCheck size={13} className="text-[var(--primary-2)]" /> {fr ? 'Ton email sert uniquement à te répondre.' : 'Your email is only used to reply to you.'}</p>
              <Button variant="primary" disabled={!valid || busy} onClick={send}>{busy ? <Spinner /> : <><Send size={15} /> {fr ? 'Envoyer' : 'Send message'}</>}</Button>
            </div>
          </div>
        )}
      </Card>
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
      ['Security', 'We use reasonable technical and organisational measures to protect your data — passwords are hashed (argon2id), transport is encrypted, and access is restricted. No system is perfectly secure; if a breach materially affects you, we will notify you as required by law.'],
      ['Age', 'BetterCommunity is not directed at children. You must be at least 13 years old (or the minimum digital-consent age in your country) to create an account.'],
      ['Data processors', 'We rely on a small number of processors to run the service — Stripe (payments), our hosting/object-storage provider, and, if you opt in, Discord (account linking) and, in future, an analytics/Google tag. Each only receives the data needed for its function and is bound by a data-processing agreement.'],
      ['Legal bases (GDPR Art. 6)', 'We process your data on these bases: performance of our contract with you (account, hosting, payments); your consent (optional analytics, Discord linking); our legitimate interests (security, abuse prevention, service improvement) balanced against your rights; and compliance with legal obligations. You can withdraw consent at any time without affecting prior processing.'],
      ['International transfers', 'Some processors (e.g. Stripe, or an analytics / Google tag if you enable it) may process data outside your country, including outside the EEA/UK. Where they do, transfers rely on appropriate safeguards such as the EU Standard Contractual Clauses or an adequacy decision.'],
      ['Your rights & how to exercise them', 'Under the GDPR/UK-GDPR you may access, rectify, erase, restrict or object to processing, withdraw consent, and request portability of your data. Reach us via the Contact page; we respond within one month. You also have the right to lodge a complaint with your local data-protection supervisory authority.'],
      ['No automated decisions', 'We do not carry out automated decision-making or profiling that produces legal or similarly significant effects on you.'],
      ['Data controller & contact', 'The data controller is the operator of BetterCommunity. For any privacy request or question — access, deletion, portability, or to withdraw consent — reach us through the Contact page.'],
    ] },
    terms: { icon: ShieldCheck, title: 'Terms of Service', body: [
      ['Accounts', 'You are responsible for activity under your account and for the content you submit. Keep your credentials safe.'],
      ['Content & moderation', 'Submissions are reviewed before publication. We may reject or remove content that is illegal, malicious, infringing, or violates these terms. You retain ownership of what you upload and grant us a licence to host and distribute it within the platform.'],
      ['Review & validation times', 'Every submission and update is queued for manual review and stays hidden (PENDING) until an admin approves it. We aim to review within 72 hours, but provide no guaranteed turnaround and may take longer during high volume. Plugin/theme files and hosted-repo content are automatically re-checked (SHA / per-file checksums) on every change and must pass before they can go live. We may re-review, re-validate, or unpublish previously approved content at any time.'],
      ['Copyright & hosted content rules', 'You may only upload or host content you own or are licensed to distribute. The following are strictly prohibited: copyrighted material without permission, paid/leaked third-party assets, malware or obfuscated payloads, illegal content, and anything infringing a trademark or another creator’s rights. Hosted Server-Repos must respect the original creators’ licences. We comply with takedown requests: rights holders can report infringing content and we will remove it promptly. Repeat infringers are banned and may have their repos and account terminated without refund.'],
      ['Hosting', 'Hosted Server-Repos are subject to the storage, upload and capacity limits we set. Updates require a valid SHA. Abuse, illegal content, or excessive resource use may lead to suspension.'],
      ['Payments', 'Hosting and listing features are billed via Stripe. Prices may change with notice. No refunds for partial periods unless required by law.'],
      ['Payment failure & data retention', 'If a hosting subscription payment fails, you have 72 hours to renew it. After that window, the data stored for that subscription (hosted Server-Repo files and related content) is deleted without further notice and without backup.'],
      ['Acceptable use', 'You agree not to abuse the service: no scraping or automated bulk access beyond our documented APIs, no attempts to reverse-engineer, overload, probe, or circumvent quotas, sandboxing or integrity checks, and no uploading of malware, obfuscated payloads, or illegal content. We may rate-limit, throttle, suspend, or block abusive activity at any time.'],
      ['Enforcement', 'We enforce these terms strictly and at our sole discretion. Any violation may result in the immediate removal of content, suspension or permanent termination of your account and hosted repos — without prior notice and without refund — and, where the law requires, reporting to the competent authorities. Attempting to bypass moderation, integrity checks, quotas, or the sandbox is itself a violation. These measures are cumulative and in addition to any other remedy available to us.'],
      ['Governing law & changes', 'These terms are governed by the laws of our place of establishment, without regard to conflict-of-law rules. We may update these terms; material changes are announced and continued use after they take effect constitutes acceptance. If any provision is held unenforceable, the remainder stays in full force.'],
      ['Disclaimer & liability', 'The service is provided “as is” and “as available”, without warranties of any kind. To the maximum extent permitted by law, we are not liable for indirect, incidental, or consequential damages, and our total liability is limited to the amount you paid us in the 12 months preceding the claim.'],
    ] },
    cookies: { icon: Cookie, title: 'Cookie Policy', body: [
      ['What cookies are', 'Cookies and similar technologies (such as local storage) are small pieces of data stored in your browser. We group them by purpose below. You control the optional categories from the cookie banner and can change your choice at any time.'],
      ['1 · Strictly necessary', 'A single session cookie keeps you signed in and secures your form submissions. It is required for the site to work and cannot be switched off. Under the GDPR/ePrivacy rules no consent is needed for this category because it is essential to a service you asked for.'],
      ['2 · Analytics / statistics (optional — off by default)', 'Only if you click “Accept all” do we enable privacy-friendly, first-party page analytics (page path, referrer, coarse device/browser). Your choice is remembered in local storage, not in a tracking cookie, and you can decline with no loss of functionality.'],
      ['Third-party tags (Google Tag Manager)', 'When configured, we load Google Tag Manager as a third-party measurement tag. Its scripts and cookies load ONLY after you opt in to the Analytics category above — never before. Declining, or simply ignoring the banner, keeps it disabled. Google acts as our processor; some data may be transferred outside the EEA under appropriate safeguards (see the Privacy Policy). You can withdraw consent at any time, and we treat a Global Privacy Control / Do-Not-Track signal as an automatic decline.'],
      ['Managing your consent', 'Your preference is stored per browser. To review or change it, clear this site’s storage (or use your browser’s site-data controls) and reload — the banner reappears. Withdrawing consent stops any further analytics collection immediately.'],
      ['No advertising', 'We never use advertising, cross-site, or social-media tracking cookies, and we never sell your data.'],
    ] },
    about: { icon: Sparkles, title: 'About us', body: [
      ['What BetterCommunity is', 'BetterCommunity is the shared home for the Better* ecosystem — a hub where the community discovers, shares, and hosts content for tools like Better Mods Manager (BMM), Better Sound Maker (BSM), and BetterInstaller. One account, one place: browse the catalogs, publish your own mods, plugins, themes and presets, and spin up a hosted Server-Repo.'],
      ['Our mission', 'To give creators a clean, honest, no-nonsense platform: no ads, no dark patterns, no selling your data. Every submission is human-reviewed before it goes live, integrity-checked on every change, and the whole thing is built to stay fast and lightweight.'],
      ['The projects', 'BMM manages mods for supported games with a full plugin/theme system. BSM is a sound-preset catalog. BetterInstaller is a fast, modern installer for the suite. Server-Repos let creators host their own repositories with us, billed only for what they use. Every catalog is filled by the community and curated by a small moderation team, and contributors are credited on each project page.'],
      ['Open & transparent', 'Our moderation rules, pricing, and privacy practices are all documented in these legal pages — no surprises. Found a problem or have an idea? The Contact page and our Discord are the fastest ways to reach us.'],
      ['Support the project', 'BetterCommunity is community-funded. Hosting costs are covered by the paid Server-Repo plans and by donations on Ko-fi. Every tip goes straight to keeping the servers running — thank you.'],
    ] },
    refunds: { icon: Receipt, title: 'Payments & Refunds', body: [
      ['How billing works', 'Two things are paid: (1) hosted Server-Repos and storage pools, billed by the capacity, bandwidth and features you choose; and (2) our-hosted catalog file storage above the free floor, and optional "featured" boosts. Everything is processed by Stripe — we never see or store your card details.'],
      ['Prices & currency', 'Prices are shown before you confirm, in the currency your payment method supports. Recurring plans renew automatically until you cancel. We may change prices with advance notice; a change never affects a period you have already paid for.'],
      ['Free tier', 'Every account gets a free storage floor for hosting and a free catalog-upload floor — you only pay for what exceeds it. The free tier is genuinely free: no card required, no trial that silently converts.'],
      ['Cancelling', 'You can cancel a hosting subscription at any time from your dashboard. Cancellation stops the next renewal; your repo stays online until the end of the period you already paid for, then is taken offline.'],
      ['Refund policy', 'Because hosting is a consumable, capacity-reserving service, we do not refund partial or unused periods unless the law requires it or we are clearly at fault (e.g. a billing error or an extended outage caused by us). If you think you were charged in error, contact us within 14 days and we will investigate and make it right.'],
      ['Failed payments & data deletion', 'If a renewal payment fails, you have 72 hours to update your payment method and renew. After that window the data stored for that subscription (hosted Server-Repo files and related content) is deleted without further notice and without backup — so keep your own copy.'],
      ['Statutory withdrawal (EU/UK)', 'Where a legal right of withdrawal applies to a purchase of digital services, you may request cancellation within the statutory period. Note that by starting a hosting subscription you ask us to begin the service immediately, which can reduce or end that withdrawal right for the portion already provided — as permitted by consumer law.'],
      ['How to request a refund', 'Reach us through the Contact page with your account email and the approximate date/amount of the charge. We respond within a few business days. Approved refunds are returned to the original payment method via Stripe.'],
      ['Chargebacks', 'If something looks wrong, please contact us first — we can almost always resolve it faster than a bank dispute. Opening a chargeback without contacting us may result in suspension of the associated account and repos pending resolution.'],
    ] },
  },
  fr: {
    privacy: { icon: Lock, title: 'Politique de confidentialité', body: [
      ['Ce que nous collectons', 'Un compte requiert ton e-mail et un nom affiché. Nous stockons le contenu que tu soumets (apps, plugins, thèmes, presets) et des données de modération. Les mots de passe sont hachés avec argon2id — jamais en clair.'],
      ['Statistiques', 'Avec ton accord cookies, nous collectons des statistiques de pages internes et respectueuses de la vie privée (chemin de page et référent). Aucun pisteur tiers, aucune publicité, aucun profilage. Tu peux refuser à tout moment.'],
      ['Hébergement & paiements', 'Si tu paies un hébergement de Server-Repo, le paiement est traité par Stripe ; nous ne voyons jamais ta carte. Nous stockons l’état de ton abonnement et les métadonnées du dépôt.'],
      ['Tes droits (RGPD)', 'Tu peux demander l’accès, la rectification ou la suppression de tes données à tout moment en nous contactant. Supprimer ton compte efface tes données personnelles et dépublie ton contenu.'],
      ['Conservation', 'Nous conservons les données tant que ton compte est actif et aussi longtemps que nécessaire au service ou à nos obligations légales.'],
      ['Sécurité', 'Nous utilisons des mesures techniques et organisationnelles raisonnables pour protéger tes données — mots de passe hachés (argon2id), transport chiffré, accès restreint. Aucun système n’est parfaitement sûr ; en cas de violation te concernant significativement, nous te préviendrons conformément à la loi.'],
      ['Âge', 'BetterCommunity ne s’adresse pas aux enfants. Tu dois avoir au moins 13 ans (ou l’âge minimum de consentement numérique dans ton pays) pour créer un compte.'],
      ['Sous-traitants', 'Nous nous appuyons sur quelques sous-traitants — Stripe (paiements), notre hébergeur/stockage objet, et, si tu y consens, Discord (liaison de compte) et, à l’avenir, un tag analytics/Google. Chacun ne reçoit que les données nécessaires à sa fonction et est lié par un accord de traitement.'],
      ['Bases légales (RGPD Art. 6)', 'Nous traitons tes données sur ces bases : l’exécution de notre contrat (compte, hébergement, paiements) ; ton consentement (statistiques optionnelles, liaison Discord) ; nos intérêts légitimes (sécurité, prévention des abus, amélioration du service) mis en balance avec tes droits ; et le respect de nos obligations légales. Tu peux retirer ton consentement à tout moment sans affecter les traitements antérieurs.'],
      ['Transferts internationaux', 'Certains sous-traitants (ex. Stripe, ou un tag analytics/Google si tu l’actives) peuvent traiter des données hors de ton pays, y compris hors EEE/Royaume-Uni. Le cas échéant, les transferts reposent sur des garanties appropriées comme les Clauses Contractuelles Types de l’UE ou une décision d’adéquation.'],
      ['Tes droits & comment les exercer', 'Au titre du RGPD, tu peux accéder à tes données, les rectifier, les effacer, en limiter ou t’opposer au traitement, retirer ton consentement et demander leur portabilité. Contacte-nous via la page Contact ; nous répondons sous un mois. Tu as aussi le droit d’introduire une réclamation auprès de ton autorité de protection des données (en France, la CNIL).'],
      ['Pas de décision automatisée', 'Nous ne procédons à aucune décision automatisée ni profilage produisant des effets juridiques ou significatifs à ton égard.'],
      ['Responsable de traitement & contact', 'Le responsable de traitement est l’opérateur de BetterCommunity. Pour toute demande — accès, suppression, portabilité, ou retrait de consentement — contacte-nous via la page Contact.'],
    ] },
    terms: { icon: ShieldCheck, title: 'Conditions d’utilisation', body: [
      ['Comptes', 'Tu es responsable de l’activité de ton compte et du contenu que tu soumets. Garde tes identifiants en sécurité.'],
      ['Contenu & modération', 'Les soumissions sont vérifiées avant publication. Nous pouvons refuser ou retirer tout contenu illégal, malveillant, contrefaisant ou contraire aux présentes conditions. Tu restes propriétaire de ce que tu envoies et nous accordes une licence pour l’héberger et le distribuer sur la plateforme.'],
      ['Délais de vérification & validation', 'Chaque soumission et mise à jour passe en revue manuelle et reste masquée (EN ATTENTE) jusqu’à approbation par un administrateur. Nous visons une revue sous 72 heures, sans délai garanti, et cela peut être plus long en cas de forte affluence. Les fichiers de plugins/thèmes et le contenu des dépôts hébergés sont re-vérifiés automatiquement (SHA / checksums par fichier) à chaque changement et doivent être valides avant mise en ligne. Nous pouvons re-vérifier, re-valider ou dépublier un contenu déjà approuvé à tout moment.'],
      ['Droits d’auteur & règles de contenu hébergé', 'Tu ne peux héberger ou envoyer que du contenu que tu possèdes ou que tu es autorisé à distribuer. Sont strictement interdits : tout contenu protégé par le droit d’auteur sans autorisation, les assets tiers payants ou leakés, les malwares ou charges obfusquées, les contenus illégaux, et tout ce qui enfreint une marque ou les droits d’un autre créateur. Les Server-Repos hébergés doivent respecter les licences des créateurs originaux. Nous traitons les demandes de retrait : les ayants droit peuvent signaler un contenu contrefaisant, que nous retirerons rapidement. Les récidivistes sont bannis et peuvent voir leurs dépôts et leur compte résiliés sans remboursement.'],
      ['Hébergement', 'Les Server-Repos hébergés sont soumis aux limites de stockage, d’upload et de capacité que nous fixons. Les mises à jour exigent un SHA valide. Tout abus, contenu illégal ou usage excessif peut entraîner une suspension.'],
      ['Paiements', 'L’hébergement et la mise en avant sont facturés via Stripe. Les prix peuvent changer avec préavis. Pas de remboursement des périodes partielles, sauf obligation légale.'],
      ['Échec de paiement & conservation des données', 'Si le paiement d’un abonnement d’hébergement échoue, vous disposez de 72 heures pour le renouveler. Passé ce délai, les données stockées pour cet abonnement (fichiers de Server-Repo hébergés et contenu associé) sont supprimées sans préavis ni sauvegarde.'],
      ['Usage acceptable', 'Tu t’engages à ne pas abuser du service : pas de scraping ni d’accès automatisé massif au-delà de nos API documentées, aucune tentative de rétro-ingénierie, de surcharge, de sondage ou de contournement des quotas, du bac à sable ou des contrôles d’intégrité, et aucun envoi de malware, de charge obfusquée ou de contenu illégal. Nous pouvons limiter, brider, suspendre ou bloquer toute activité abusive à tout moment.'],
      ['Application des règles', 'Nous appliquons ces conditions de manière stricte et à notre entière discrétion. Toute violation peut entraîner le retrait immédiat du contenu, la suspension ou la résiliation définitive de votre compte et de vos dépôts hébergés — sans préavis ni remboursement — et, lorsque la loi l’exige, un signalement aux autorités compétentes. Tenter de contourner la modération, les contrôles d’intégrité, les quotas ou le bac à sable constitue en soi une violation. Ces mesures sont cumulatives et s’ajoutent à tout autre recours dont nous disposons.'],
      ['Droit applicable & modifications', 'Ces conditions sont régies par le droit de notre lieu d’établissement, sans égard aux règles de conflit de lois. Nous pouvons les mettre à jour ; les changements importants sont annoncés et la poursuite de l’utilisation vaut acceptation. Si une clause est jugée inapplicable, le reste demeure pleinement en vigueur.'],
      ['Avertissement & responsabilité', 'Le service est fourni « tel quel » et « selon disponibilité », sans garantie d’aucune sorte. Dans la limite permise par la loi, nous ne sommes pas responsables des dommages indirects ou accessoires, et notre responsabilité totale est limitée aux sommes que vous nous avez versées durant les 12 mois précédant la réclamation.'],
    ] },
    cookies: { icon: Cookie, title: 'Politique de cookies', body: [
      ['Ce que sont les cookies', 'Les cookies et technologies similaires (comme le stockage local) sont de petites données conservées dans ton navigateur. Nous les regroupons ci-dessous par finalité. Tu contrôles les catégories optionnelles depuis la bannière cookies et peux changer ton choix à tout moment.'],
      ['1 · Strictement nécessaires', 'Un seul cookie de session te garde connecté et sécurise l’envoi des formulaires. Il est indispensable au fonctionnement du site et ne peut être désactivé. Selon le RGPD/ePrivacy, aucun consentement n’est requis pour cette catégorie car elle est essentielle à un service que tu as demandé.'],
      ['2 · Statistiques (optionnel — désactivé par défaut)', 'Uniquement si tu cliques sur « Tout accepter », nous activons des statistiques de pages internes et respectueuses de la vie privée (chemin de page, référent, appareil/navigateur approximatif). Ton choix est mémorisé dans le stockage local, pas dans un cookie de pistage, et tu peux refuser sans perte de fonctionnalité.'],
      ['Tags tiers (Google Tag Manager)', 'Quand il est configuré, nous chargeons Google Tag Manager comme tag de mesure tiers. Ses scripts et cookies ne se chargent QU’APRÈS ton opt-in à la catégorie Statistiques ci-dessus — jamais avant. Refuser, ou simplement ignorer la bannière, le garde désactivé. Google agit comme notre sous-traitant ; certaines données peuvent être transférées hors EEE sous garanties appropriées (voir la Politique de confidentialité). Tu peux retirer ton consentement à tout moment, et nous traitons un signal Global Privacy Control / Do-Not-Track comme un refus automatique.'],
      ['Gérer ton consentement', 'Ta préférence est stockée par navigateur. Pour la revoir ou la changer, vide le stockage de ce site (ou utilise les réglages de données de site de ton navigateur) et recharge — la bannière réapparaît. Retirer le consentement arrête immédiatement toute collecte de statistiques.'],
      ['Aucune publicité', 'Nous n’utilisons jamais de cookies publicitaires, inter-sites ou de pistage social, et nous ne vendons jamais tes données.'],
    ] },
    about: { icon: Sparkles, title: 'À propos', body: [
      ['Ce qu’est BetterCommunity', 'BetterCommunity est la maison commune de l’écosystème Better* — un hub où la communauté découvre, partage et héberge du contenu pour des outils comme Better Mods Manager (BMM), Better Sound Maker (BSM) et BetterInstaller. Un seul compte, un seul endroit : parcours les catalogues, publie tes mods, plugins, thèmes et presets, et lance un Server-Repo hébergé.'],
      ['Notre mission', 'Offrir aux créateurs une plateforme claire et honnête : pas de pub, pas de dark patterns, jamais de revente de tes données. Chaque soumission est vérifiée par un humain avant mise en ligne, re-contrôlée à chaque changement, et l’ensemble est conçu pour rester rapide et léger.'],
      ['Les projets', 'BMM gère les mods des jeux pris en charge avec un vrai système de plugins/thèmes. BSM est un catalogue de presets sonores. BetterInstaller est un installeur moderne et rapide pour la suite. Les Server-Repos permettent aux créateurs d’héberger leurs propres dépôts chez nous, facturés uniquement selon l’usage. Chaque catalogue est rempli par la communauté et curé par une petite équipe de modération, et les contributeurs sont crédités sur chaque page de projet.'],
      ['Ouvert & transparent', 'Nos règles de modération, nos tarifs et nos pratiques de confidentialité sont tous documentés dans ces pages légales — aucune surprise. Un problème ou une idée ? La page Contact et notre Discord sont les moyens les plus rapides de nous joindre.'],
      ['Soutenir le projet', 'BetterCommunity est financé par la communauté. Les coûts d’hébergement sont couverts par les offres Server-Repo payantes et par les dons sur Ko-fi. Chaque don sert directement à faire tourner les serveurs — merci.'],
    ] },
    refunds: { icon: Receipt, title: 'Paiements & Remboursements', body: [
      ['Fonctionnement de la facturation', 'Deux choses sont payantes : (1) les Server-Repos et pools de stockage hébergés, facturés selon la capacité, la bande passante et les options choisies ; et (2) le stockage de fichiers de catalogue chez nous au-delà du seuil gratuit, ainsi que les mises en avant « featured » optionnelles. Tout est traité par Stripe — nous ne voyons ni ne stockons jamais ta carte.'],
      ['Prix & devise', 'Les prix sont affichés avant confirmation, dans la devise prise en charge par ton moyen de paiement. Les offres récurrentes se renouvellent automatiquement jusqu’à résiliation. Nous pouvons modifier les prix avec préavis ; un changement n’affecte jamais une période déjà payée.'],
      ['Offre gratuite', 'Chaque compte reçoit un seuil de stockage gratuit pour l’hébergement et un seuil gratuit d’upload de catalogue — tu ne paies que ce qui dépasse. L’offre gratuite est réellement gratuite : aucune carte requise, aucun essai qui se transforme silencieusement en abonnement.'],
      ['Résiliation', 'Tu peux résilier un abonnement d’hébergement à tout moment depuis ton tableau de bord. La résiliation stoppe le prochain renouvellement ; ton dépôt reste en ligne jusqu’à la fin de la période déjà payée, puis est mis hors ligne.'],
      ['Politique de remboursement', 'L’hébergement étant un service consommable qui réserve de la capacité, nous ne remboursons pas les périodes partielles ou inutilisées, sauf si la loi l’exige ou si nous sommes clairement en faute (ex. erreur de facturation ou panne prolongée de notre fait). Si tu penses avoir été débité par erreur, contacte-nous sous 14 jours et nous rectifierons.'],
      ['Échec de paiement & suppression des données', 'Si un renouvellement échoue, tu disposes de 72 heures pour mettre à jour ton moyen de paiement et renouveler. Passé ce délai, les données stockées pour cet abonnement (fichiers de Server-Repo hébergés et contenu associé) sont supprimées sans préavis ni sauvegarde — garde donc ta propre copie.'],
      ['Droit de rétractation (UE/RU)', 'Lorsqu’un droit légal de rétractation s’applique à un achat de services numériques, tu peux demander l’annulation dans le délai légal. En démarrant un abonnement d’hébergement, tu nous demandes de commencer le service immédiatement, ce qui peut réduire ou supprimer ce droit de rétractation pour la part déjà fournie — comme le permet le droit de la consommation.'],
      ['Comment demander un remboursement', 'Contacte-nous via la page Contact avec l’e-mail de ton compte et la date/le montant approximatif du débit. Nous répondons sous quelques jours ouvrés. Les remboursements approuvés sont renvoyés sur le moyen de paiement d’origine via Stripe.'],
      ['Oppositions bancaires (chargebacks)', 'Si quelque chose semble anormal, contacte-nous d’abord — nous résolvons presque toujours plus vite qu’un litige bancaire. Ouvrir un chargeback sans nous contacter peut entraîner la suspension du compte et des dépôts associés en attendant résolution.'],
    ] },
  },
};

const LEGAL_SUMMARY = {
  en: {
    privacy: 'What data we collect, why we keep it, and the GDPR rights you can exercise at any time.',
    terms: 'The rules for using BetterCommunity, moderation, and the strict copyright rules for hosted content.',
    cookies: 'One essential sign-in cookie, plus optional privacy-friendly first-party analytics — no third parties.',
    about: 'Who we are, the Better* projects, and what BetterCommunity is here to do.',
    refunds: 'How billing works, the free tier, cancellation, and exactly when a refund applies.',
  },
  fr: {
    privacy: 'Les données que nous collectons, pourquoi, et les droits RGPD que tu peux exercer à tout moment.',
    terms: "Les règles d'utilisation de BetterCommunity, la modération, et les règles strictes de droits d'auteur pour le contenu hébergé.",
    cookies: 'Un seul cookie de session essentiel, plus des statistiques internes optionnelles et respectueuses — aucun tiers.',
    about: 'Qui nous sommes, les projets Better*, et la raison d’être de BetterCommunity.',
    refunds: 'Le fonctionnement de la facturation, l’offre gratuite, la résiliation, et quand un remboursement s’applique.',
  },
};

export function Legal({ page }) {
  const { lang, t } = useI18n();
  const d = (LEGAL[lang] || LEGAL.en)[page];
  const summary = (LEGAL_SUMMARY[lang] || LEGAL_SUMMARY.en)[page];
  const tabs = [['about', t('foot.about', 'About'), Sparkles], ['privacy', t('foot.privacy'), Lock], ['terms', t('foot.terms'), ShieldCheck], ['cookies', t('foot.cookies'), Cookie], ['refunds', t('foot.refunds', 'Payments'), Receipt]];
  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader icon={d.icon} title={d.title} subtitle={`${lang === 'fr' ? 'Mis à jour le' : 'Last updated'} ${new Date().toLocaleDateString()}`} />
      <div className="flex flex-wrap gap-2 mb-5">{tabs.map(([k, l, I]) => <Link key={k} to={`/${k}`}><Button size="sm" variant={k === page ? 'primary' : 'default'}><I size={14} /> {l}</Button></Link>)}</div>
      {/* plain-language summary */}
      <Card className="p-4 mb-6 flex items-start gap-3 bg-gradient-to-r from-orange-500/10 to-transparent">
        <d.icon size={18} className="text-[var(--primary-2)] mt-0.5 shrink-0" />
        <div className="text-sm text-[var(--muted)]">{summary}</div>
      </Card>
      <div className="grid md:grid-cols-[180px_1fr] gap-8">
        <nav className="hidden md:block sticky top-20 self-start space-y-0.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">{lang === 'fr' ? 'Sur cette page' : 'On this page'}</div>
          {d.body.map(([h], i) => <a key={h} href={`#s${i}`} className="block text-sm text-[var(--muted)] hover:text-[var(--primary-2)] py-1 border-l border-transparent hover:border-[var(--primary)] pl-2 -ml-px transition-colors">{h}</a>)}
        </nav>
        <Card className="p-6 md:p-8 space-y-7">
          {d.body.map(([h, p], i) => (
            <section id={`s${i}`} key={h} className="scroll-mt-24">
              <h2 className="text-lg font-semibold mb-2 flex items-center gap-2"><span className="text-[var(--primary-2)] font-mono text-sm">{String(i + 1).padStart(2, '0')}</span>{h}</h2>
              <p className="text-[var(--muted)] leading-relaxed">{p}</p>
            </section>
          ))}
          <div className="pt-4 border-t border-[var(--line)] text-sm text-[var(--muted)]">{lang === 'fr' ? 'Des questions sur cette politique ? Contacte-nous via les liens du pied de page.' : 'Questions about this policy? Reach us via the links in the footer.'}</div>
        </Card>
      </div>
    </div>
  );
}
