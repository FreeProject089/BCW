import { useEffect, useState, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Link, useParams, useSearchParams, useNavigate } from 'react-router-dom';
import {
  Boxes, Music2, Puzzle, Palette, Server, Rocket, Download, ArrowRight, Search, Upload,
  Bell, CheckCircle2, XCircle, Clock, Package, ShieldCheck, Inbox, Tag, FileJson, HardDrive,
  Cpu, Gauge, TrendingUp, Eye, Sparkles, Lock, Zap, Users, GitBranch, Settings2,
  Newspaper, LayoutDashboard, Cookie, Sliders, Heart, Trash2, PenSquare, Star, Bell as BellIcon, CheckCheck, ArrowUpRight,
  Receipt, Wand2, Plus, Link2, Copy, Globe, BadgeCheck, Mail, Send, MessageSquare, Files, RefreshCw, X, ChevronDown, Monitor, MonitorOff, AlertTriangle, Ticket,
  CreditCard, Gift, Archive, Shield, Ban, FolderGit2, FileText, History, Target, Megaphone, EyeOff, Rss,
  Info, Orbit, Fingerprint, Layers, MapPin, Globe2, Activity, Building2, Map as MapIcon, ShoppingCart,
  Mic, KeyRound,
} from 'lucide-react';
import { api, uploadPayload, uploadImage } from './api.js';
import { useAuth } from './auth.jsx';
import { useI18n } from './i18n.jsx';
import { useTheme } from './theme.jsx';
import { getConsent, setConsent } from './analytics.js';
import { SKIP_KEY, useIntro } from './IntroContext.jsx';
import { getGlassPrefs, setGlassPrefs, getOrbTransitionPref, setOrbTransitionPref } from './prefs.js';
import { MyRepos, AdminRepos, Billing, rawStatusLabel } from './repos.jsx';
import { TotpQuickFill } from './twofa-fill.jsx';
import { AuthorsRow } from './blog.jsx';
import Avatar from './Avatar.jsx';
import { createRoot } from 'react-dom/client';
import { AppLogo, KofiIcon, GithubIcon, DiscordIcon, RedditIcon, GoogleIcon } from './brand.jsx';
import { Button, Card, Badge, Input, Textarea, Select, Dropdown, Field, PageHeader, EmptyState, Spinner, Modal, useDialog, useToast, copyText } from './ui.jsx';
import Markdown, { ShowcaseIcon } from './md.jsx';
import IconPicker from './icon-picker.jsx';
import ProjectConfigEditor from './project-config-editor.jsx';

/* ── helpers ── */
function useAsync(fn, deps = []) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const reload = () => { setLoading(true); fn().then((d) => { setData(d); setErr(null); }).catch(setErr).finally(() => setLoading(false)); };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, deps);
  return { data, err, loading, reload };
}

// Measure an element's live pixel width (ResizeObserver). Used to size SVG charts so
// their viewBox matches real pixels 1:1 — keeps axis/label text legible on phones
// instead of shrinking with a fixed-width viewBox.
function useElementWidth(fallback = 760) {
  const ref = useRef(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => { const cw = e.contentRect.width; if (cw > 0) setW(Math.round(cw)); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
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
  const [navOpen, setNavOpen] = useState(false);
  const realTabs = tabs.filter((t) => t.id);
  const active = sp.get('s') || realTabs[0]?.id;
  const set = (id) => { setSp((p) => { const n = new URLSearchParams(p); n.set('s', id); return n; }, { replace: true }); setNavOpen(false); };
  const current = realTabs.find((t) => t.id === active) || realTabs[0];
  const idx = realTabs.findIndex((t) => t.id === active);
  // One row renderer, reused by the desktop sidebar and the mobile sheet.
  const renderTab = (tb, big) => (
    <button key={tb.id} onClick={() => set(tb.id)}
      className={`flex items-center gap-2.5 px-3 ${big ? 'py-2.5' : 'py-2'} rounded-xl text-sm text-left w-full whitespace-nowrap transition-colors press ${active === tb.id ? 'bg-[var(--surface-2)] text-[var(--text)] border border-[var(--line)] font-medium' : 'text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] border border-transparent'}`}>
      <tb.icon size={16} className={active === tb.id ? 'text-[var(--primary-2)]' : ''} /> {tb.label}
      {tb.badge ? <Badge tone="primary" className="ml-auto">{tb.badge}</Badge> : null}
    </button>
  );
  return (
    <div>
      <PageHeader icon={icon} title={title} subtitle={subtitle} actions={headerActions} />

      {/* Mobile (<md): the ~15-tab sidebar becomes a proper dropdown sheet — a
          cramped horizontal scroll strip of tabs + section headings is unusable on
          a phone. Shows the current section; tapping opens the grouped list. */}
      <div className="md:hidden mb-4 relative z-20">
        <button onClick={() => setNavOpen((o) => !o)} aria-expanded={navOpen}
          className="card w-full flex items-center gap-2.5 px-4 py-3 text-sm font-medium press">
          {current?.icon && <current.icon size={16} className="text-[var(--primary-2)]" />}
          <span className="flex-1 text-left truncate">{current?.label}</span>
          <span className="text-[11px] text-[var(--faint)] tabular-nums">{idx + 1}/{realTabs.length}</span>
          <ChevronDown size={16} className={`text-[var(--muted)] transition-transform duration-200 ${navOpen ? 'rotate-180' : ''}`} />
        </button>
        {navOpen && <>
          <div className="fixed inset-0 z-10" onClick={() => setNavOpen(false)} />
          <div className="card absolute left-0 right-0 mt-2 p-2 anim-pop z-20 max-h-[62vh] overflow-y-auto scroll-thin shadow-lg">
            {tabs.map((tb, i) => tb.heading
              ? <div key={`h-${i}`} className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)] first:pt-1">{tb.heading}</div>
              : renderTab(tb, true))}
          </div>
        </>}
      </div>

      <div className="grid md:grid-cols-[220px_1fr] gap-6">
        {/* Desktop sidebar — a real card panel behind the whole nav (not just the
            active pill) so it feels grounded next to the content cards. */}
        <nav className="hidden md:flex card p-2 flex-col gap-1 md:sticky md:top-20 self-start pb-2">
          {tabs.map((tb, i) => tb.heading ? (
            <div key={`h-${i}`} className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)] first:pt-1">{tb.heading}</div>
          ) : renderTab(tb))}
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
            <Link to="/repos"><Button variant="primary" className="!px-6 !py-3">{t('home.cta.repos', 'Browse Server Repos')} <ArrowRight size={16} /></Button></Link>
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
          {/* Animated flow connector — desktop only, threaded through the icon row (badge
              center ≈ 52px down). A dotted wave baseline with a glowing pulse that travels
              left→right through the three steps, so the journey reads as forward motion.
              Lives OUTSIDE the cards (not clipped) and behind them (z-0). */}
          <div className="hidden md:block absolute top-[52px] left-[16.5%] right-[16.5%] h-8 -translate-y-1/2 z-0 pointer-events-none">
            <svg className="w-full h-full" viewBox="0 0 300 24" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <linearGradient id="stepflowg" x1="0" y1="0" x2="300" y2="0" gradientUnits="userSpaceOnUse">
                  <stop offset="0" stopColor="var(--primary)" stopOpacity="0" />
                  <stop offset="0.5" stopColor="var(--primary-2)" />
                  <stop offset="1" stopColor="var(--primary)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d="M0 12 C 50 2, 100 22, 150 12 S 250 2, 300 12" fill="none" stroke="var(--line-strong)" strokeWidth="1.5" strokeDasharray="1 7" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              <path d="M0 12 C 50 2, 100 22, 150 12 S 250 2, 300 12" fill="none" stroke="url(#stepflowg)" strokeWidth="3" strokeLinecap="round" strokeDasharray="46 254" vectorEffect="non-scaling-stroke" className="step-flow" />
            </svg>
          </div>
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
                      <span className="flex items-center gap-2 min-w-0 text-xs text-[var(--faint)]"><AuthorsRow authors={featured.authors} size={20} /> · {fdate(featured.publishedAt)}</span>
                      <span className="text-xs text-[var(--primary-2)] flex items-center gap-1 font-medium shrink-0">Read <ArrowRight size={12} /></span>
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
                        <div className="flex items-center gap-2 mt-auto pt-1"><AuthorsRow authors={p.authors} size={18} /><span className="text-[11px] text-[var(--faint)]">{fdate(p.publishedAt)}</span></div>
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
  const [redeemOpen, setRedeemOpen] = useState(false);
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
      {state?.promo && state.promo.kind === 'discount' && !termTooShort && (
        <div className="text-xs text-emerald-400 mt-1 flex items-center gap-1"><CheckCircle2 size={12} /> {state.promo.percentOff ? t('hosting.promo.pct', '{pct}% off applied').replace('{pct}', state.promo.percentOff) : state.promo.freeMonths ? t('hosting.promo.free', 'First {n} months free').replace('{n}', state.promo.freeMonths) : t('hosting.promo.ok', 'Code applied.')}</div>
      )}
      {/* Free-hosting / free-boost codes aren't checkout discounts — they redeem
          directly. Surface that with a one-click "Use this code" modal flow. */}
      {state?.promo && state.promo.kind !== 'discount' && (
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          <span className="text-xs text-emerald-400 flex items-center gap-1"><Gift size={12} />
            {state.promo.kind === 'free_hosting'
              ? t('hosting.promo.hostcode', 'Free hosting code — {gb} GB repo at no cost.').replace('{gb}', state.promo.storageGB)
              : t('hosting.promo.boostcode', 'Boost code — {d} days featured.').replace('{d}', state.promo.boostDays)}
          </span>
          <Button size="sm" variant="primary" onClick={() => setRedeemOpen(true)}>{t('hosting.promo.use', 'Use this code')}</Button>
        </div>
      )}
      {termTooShort && <div className="text-xs text-amber-400 mt-1 flex items-center gap-1"><AlertTriangle size={12} /> {t('hosting.promo.minmonths', 'This code needs a {n}+ month term.').replace('{n}', state.promo.minMonths)}</div>}
      {redeemOpen && state?.promo && <RedeemPromoModal code={code.trim()} promo={state.promo} onClose={() => setRedeemOpen(false)} />}
    </div>
  );
}

/* Redeem a free-hosting / free-boost code from the hosting page: shows what the
   code grants; boost codes ask which of your repos to boost. Mobile-friendly. */
function RedeemPromoModal({ code, promo, onClose }) {
  const { t } = useI18n(); const toast = useToast(); const nav = useNavigate();
  const isBoost = promo.kind === 'free_boost';
  const [repos, setRepos] = useState(null);
  const [repoId, setRepoId] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (isBoost) api.get('/me/repos').then((r) => setRepos(r.repos || [])).catch(() => setRepos([])); }, [isBoost]);
  const apply = async () => {
    setBusy(true);
    try {
      const r = await api.post('/me/promo/redeem', { code, ...(isBoost ? { repoId } : {}) });
      toast.success(r.kind === 'free_hosting'
        ? t('promo.gotHosting', 'Redeemed! A free hosted repo was created — see "My repos".')
        : t('promo.gotBoost', 'Redeemed! Your repo is now boosted.'));
      onClose(); nav('/dashboard');
    } catch (x) {
      const e = x.data?.error;
      toast.error(e === 'already_used' ? t('promo.used', 'You already used this code.')
        : e === 'depleted' ? t('promo.depleted', 'This code is fully used.')
        : e === 'expired' ? t('promo.expired', 'This code has expired.')
        : e === 'busy' ? t('promo.busy', 'Busy — try again in a second.')
        : t('repos.failed', 'Failed.'));
    } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={t('hosting.promo.modal', 'Redeem code')} icon={Gift} width="max-w-md"
      footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
        <Button variant="primary" disabled={busy || (isBoost && !repoId)} onClick={apply}>{busy ? <Spinner /> : t('hosting.promo.apply', 'Apply code')}</Button></>}>
      <div className="flex items-center gap-3 p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] mb-4">
        <Gift size={20} className="text-emerald-400 shrink-0" />
        <div className="text-sm">
          <div className="font-semibold">{code}</div>
          <div className="text-[var(--muted)]">
            {isBoost ? t('hosting.promo.boostdesc', 'Boosts one of your repos to the featured spots for {d} days.').replace('{d}', promo.boostDays)
              : t('hosting.promo.hostdesc', 'Creates a free hosted repo — {gb} GB storage{months}.').replace('{gb}', promo.storageGB).replace('{months}', promo.hostMonths ? ` for ${promo.hostMonths} months` : ', no expiry')}
          </div>
        </div>
      </div>
      {isBoost && (
        repos === null ? <div className="py-4 grid place-items-center"><Spinner /></div>
        : !repos.length ? <div className="text-sm text-[var(--muted)]">{t('hosting.promo.norepos', "You don't have any repos yet — host one first, then redeem the boost.")}</div>
        : <div className="space-y-1.5 max-h-56 overflow-auto">
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1">{t('promo.pickrepo', 'Which repo should get the boost?')}</div>
            {repos.map((r) => (
              <button key={r.id} type="button" onClick={() => setRepoId(r.id)}
                className={`w-full text-left px-3 py-2 rounded-xl border text-sm flex items-center gap-2 transition ${repoId === r.id ? 'border-[var(--primary)] bg-[var(--primary)]/10' : 'border-[var(--line)] hover:border-[var(--line-strong)]'}`}>
                <HardDrive size={14} className={repoId === r.id ? 'text-[var(--primary)]' : 'text-[var(--faint)]'} />
                <span className="flex-1 truncate">{r.name}</span>
                {repoId === r.id && <CheckCircle2 size={14} className="text-[var(--primary)]" />}
              </button>
            ))}
          </div>
      )}
    </Modal>
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
  const [autoRenew, setAutoRenew] = useState(true); // recurring subscription vs one-time prepaid
  const TERM_DISC = { 1: 0, 3: 0.05, 6: 0.10, 12: 0.20, 24: 0.35 };
  // ── Shopping cart: buy several repos + boosts in one prepaid checkout ──
  // Persisted in localStorage so it survives a refresh / navigating away and back.
  const [cart, setCart] = useState(() => { try { return JSON.parse(localStorage.getItem('bcw_cart') || '[]'); } catch { return []; } });
  const [cartOpen, setCartOpen] = useState(false);
  useEffect(() => { try { localStorage.setItem('bcw_cart', JSON.stringify(cart)); } catch {} }, [cart]);
  const myRepos = useAsync(() => (user ? api.get('/me/repos') : Promise.resolve({ repos: [] })), [!!user]);
  const addHosting = async ({ planId, custom, label }) => {
    if (!user) return nav('/auth');
    const repoName = await dialog.prompt({ title: mode === 'multi' ? t('hosting.pool.title', 'New storage pool') : t('hosting.repo.title', 'Host a repo'), label: mode === 'multi' ? t('hosting.pool.label', 'Pool name') : t('hosting.repo.label', 'Repository name'), placeholder: mode === 'multi' ? t('hosting.pool.ph', 'my-pool') : t('hosting.repo.ph', 'my-awesome-repo'), okLabel: t('cart.add', 'Add to cart') });
    if (!repoName || String(repoName).trim().length < 2) return;
    setCart((c) => [...c, { uid: Math.random().toString(36).slice(2), kind: 'hosting', mode, months, repoName: String(repoName).trim(), planId, custom, label, autoRenew: true }]);
    setCartOpen(true);
  };
  const addBoost = ({ repoId, repoName, days }) => {
    if (!user) return nav('/auth');
    setCart((c) => [...c, { uid: Math.random().toString(36).slice(2), kind: 'boost', repoId, repoName, days, autoRenew: true }]);
    setCartOpen(true);
  };
  const removeItem = (uid) => setCart((c) => c.filter((x) => x.uid !== uid));
  const setItemAutoRenew = (uid, on) => setCart((c) => c.map((x) => (x.uid === uid ? { ...x, autoRenew: on } : x)));
  const clearCart = () => setCart([]);
  const cartCount = cart.length;
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
      const res = await api.post('/hosting/checkout', { promoCode: promo?.code, autoRenew, ...body, repoName, mode, months });
      // A $0 plan (the free tier, or a discount that zeroes it out) is provisioned
      // directly — there's no Stripe session/url to redirect to.
      if (res?.free) { toast.success(t('hosting.freeplan.provisioned', 'Your repo "{name}" is provisioning — free tier, no charge.').replace('{name}', repoName)); return nav('/dashboard'); }
      window.location = res.url;
    } catch (x) {
      if (x.data?.error === 'creator_link_required') { toast.error(t('hosting.err.link', 'Link a BMM creator id first (Profile → Creator IDs) to host a repo.')); return nav('/profile'); }
      const e = x.data?.error;
      toast.error(e === 'capacity_full' ? t('hosting.err.capacity', 'No capacity available right now.')
        : e === 'over_limit' ? t('hosting.err.overlimit2', 'That exceeds the current per-repo upload limit (max {u} Mbps). Lower it and retry.').replace('{u}', x.data.maxUploadMbps)
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

      {/* One tidy "configure your order" card: repo layout + billing term +
          capacity in a single block, instead of three stacked config panels
          before the user has even seen a price. */}
      <Card className="p-4 sm:p-5 mb-6 relative z-30">
        <div className="flex flex-col sm:flex-row sm:items-start gap-5">
          <div className="sm:flex-1 min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-2">{t('hosting.layout', 'Repo layout')}</div>
            <div className="inline-flex rounded-xl border border-[var(--line)] p-1 gap-1">
              {[['single', HardDrive, t('hosting.single', 'Single repo')], ['multi', Layers, t('hosting.multi', 'Multiple repos')]].map(([m, I, title]) => (
                <button key={m} type="button" onClick={() => setMode(m)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition ${mode === m ? 'bg-gradient-to-br from-orange-500 to-amber-500 text-white shadow' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>
                  <I size={14} /> {title}
                </button>
              ))}
            </div>
            <p className="text-xs text-[var(--muted)] mt-2">{mode === 'multi' ? t('hosting.multi.d', 'Split the storage across several repos, managed by you.') : t('hosting.single.d', 'One repository with the whole quota.')}</p>
          </div>
          <div className="sm:flex-1 min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-2">{t('hosting.term', 'Billing term')}</div>
            <TermSelect months={months} setMonths={setMonths} termDisc={TERM_DISC} t={t} />
          </div>
        </div>
        <p className="text-xs text-[var(--muted)] mt-4 flex items-center gap-1.5"><ShoppingCart size={13} className="text-[var(--primary-2)]" /> {t('hosting.cart.hint', 'Add repos and boosts to your cart, apply promo codes, then check out — all in one payment. Auto-renew is available per repo afterwards.')}</p>
        {c && (
          <div className="flex items-center gap-3 text-sm mt-4 pt-4 border-t border-[var(--line)]">
            <Gauge size={16} className="text-[var(--primary-2)] shrink-0" />
            <div className="flex-1"><div className="h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className="h-full bg-gradient-to-r from-orange-500 to-amber-500" style={{ width: `${c.usableGB ? 100 - (c.freeGB / c.usableGB) * 100 : 0}%` }} /></div></div>
            <span className="text-xs text-[var(--muted)] whitespace-nowrap tabular-nums">{c.freeGB.toFixed(0)} / {c.usableGB.toFixed(0)} GB {t('hosting.free', 'free')}</span>
          </div>
        )}
      </Card>
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
          <Card className="p-5 mb-4 bg-emerald-500/[0.05] overflow-hidden relative">
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <span className="grid place-items-center w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 text-white shrink-0 shadow-lg shadow-emerald-500/25"><Gift size={22} /></span>
              <div className="flex-1 text-center sm:text-left min-w-0">
                <div className="font-semibold text-lg">{t('hosting.freeplan.title', 'Just want to try it out?')}</div>
                <div className="text-sm text-[var(--muted)]">{t('hosting.freeplan.sub', 'Host a small repo at no cost — {gb} GB storage, {mbps} Mbps upload, forever free.').replace('{gb}', free.storageGB).replace('{mbps}', (free.uploadLimitKbps / 1024).toFixed(1))}</div>
                <div className="text-xs text-[var(--faint)] mt-1">{t('hosting.freeplan.note', 'One free repo per account. You can always upgrade the size later — the free floor still applies, so you only ever pay for what\'s above it.')}</div>
              </div>
              <Button variant="primary" className="!bg-emerald-600 hover:!bg-emerald-500 !border-transparent shrink-0" disabled={freeDisabled} onClick={() => checkout({ planId: free.id })}>
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

      {plans.loading ? <Loading /> : <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-5 items-stretch pt-2">
        {(plans.data?.plans || []).filter((pl) => pl.priceMonthlyCents > 0).map((pl) => {
          // A plan can be individually unavailable (not enough free space for ITS
          // size) even while the pool isn't fully soldOut — disable just that card.
          const planDisabled = soldOut || (!!c && pl.storageGB > c.freeGB);
          const recommended = pl.storageGB === 25;
          return (
          <div key={pl.id} role="button" tabIndex={0} aria-disabled={planDisabled} onClick={() => !planDisabled && addHosting({ planId: pl.id })}
            onKeyDown={(e) => { if (e.key === 'Enter' && !planDisabled) addHosting({ planId: pl.id }); }}
            className={`group card overflow-hidden text-center relative flex flex-col transition-all duration-200 ${planDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:-translate-y-1.5'} ${recommended && !planDisabled ? 'md:scale-[1.04] md:z-10 !border-[var(--primary)] shadow-lg shadow-orange-500/15' : ''}`}>
            {/* Diagonal corner ribbon on the recommended tier (image-2 style). */}
            {recommended && !planDisabled && (
              <span className="absolute top-0 right-0 w-[104px] h-[104px] overflow-hidden pointer-events-none z-20">
                <span className="absolute rotate-45 text-white text-[9px] font-extrabold tracking-wider text-center py-1 shadow-md" style={{ width: 150, top: 22, right: -40, background: 'linear-gradient(90deg,#f97316,#f59e0b)' }}>{t('hosting.popular2', 'RECOMMENDED')}</span>
              </span>
            )}
            {/* Uniform tier header — every card looks the same. */}
            <div className="px-5 pt-6 pb-5 border-b border-[var(--line)]">
              <HardDrive size={20} className="mx-auto transition-transform group-hover:scale-110 text-[var(--primary-2)]" />
              <div className="text-4xl font-extrabold mt-2 leading-none">{pl.storageGB}<span className="text-lg font-semibold text-[var(--muted)]"> GB</span></div>
              <div className="text-[11px] font-semibold uppercase tracking-wider mt-1 text-[var(--faint)]">{t('hosting.storage', 'Storage')}</div>
            </div>
            {/* body — speed, price, CTA */}
            <div className="p-5 flex-1 flex flex-col">
              <div className="text-xs text-[var(--faint)] flex items-center justify-center gap-1"><Zap size={12} />{(pl.uploadLimitKbps / 1024).toFixed(0)} Mbps {t('hosting.uploadword', 'upload')}</div>
              {(() => {
                // Price anchoring: show the un-discounted monthly rate struck through next
                // to the (lower) prepaid-term rate, plus a "−N%" pill — the saving reads
                // instantly instead of being buried in a "billed for 12 mo" line.
                const eff = termTotal(pl.priceMonthlyCents) / 100 / months;
                const base = pl.priceMonthlyCents / 100;
                const save = months > 1 ? Math.round((1 - eff / base) * 100) : 0;
                return (<>
                  <div className="mt-3 flex items-end justify-center gap-1.5">
                    {save > 0 && <span className="text-sm text-[var(--faint)] line-through mb-1">${base.toFixed(2)}</span>}
                    <span className="text-3xl font-bold gradient-text leading-none">${eff.toFixed(2)}</span>
                    <span className="text-sm text-[var(--muted)] font-medium mb-0.5">{t('hosting.permo', '/mo')}</span>
                  </div>
                  <div className="text-[11px] text-[var(--muted)] mb-4 mt-1 flex items-center justify-center gap-1.5 flex-wrap">
                    {months > 1 ? <><span>${(termTotal(pl.priceMonthlyCents) / 100).toFixed(2)} {t('hosting.billedfor', 'billed for')} {months} {t('hosting.mo', 'mo')}</span>{save > 0 && <span className="text-[10px] font-bold text-[var(--success)] bg-[var(--success-bg)] border border-[var(--success-border)] rounded-full px-1.5 py-0.5">−{save}%</span>}</> : t('hosting.billedmonthly', 'billed monthly')}
                  </div>
                </>);
              })()}
              <Button variant={recommended && !planDisabled ? 'primary' : 'default'} disabled={planDisabled} className="w-full mt-auto" onClick={(e) => { e.stopPropagation(); addHosting({ planId: pl.id }); }}>
                {planDisabled ? t('hosting.nospace', 'Not enough space') : <><ShoppingCart size={15} /> {t('cart.add', 'Add to cart')}</>}</Button>
            </div>
          </div>
          ); })}
      </div>}

      {/* Custom plan */}
      <Card className="p-6 mt-4 flex flex-col sm:flex-row items-center gap-4 bg-gradient-to-r from-orange-500/10 to-transparent">
        <Sliders size={26} className="text-[var(--primary-2)]" />
        <div className="flex-1 text-center sm:text-left"><div className="font-semibold text-lg">{t('hosting.custom.title', 'Need a different size?')}</div>
          <div className="text-sm text-[var(--muted)]">{t('hosting.custom.sub2', 'Build a custom plan — pick your storage and upload speed. Price adapts instantly.')}</div></div>
        <Button variant="default" disabled={soldOut} onClick={() => setCustomOpen(true)}><Sliders size={16} /> {soldOut ? t('hosting.soldout.short', 'Sold out') : t('hosting.custom.cta', 'Build custom plan')}</Button>
      </Card>

      {/* Enterprise / bespoke — no fixed price, contact us for a tailored quote. */}
      <Card className="p-6 mt-4 flex flex-col sm:flex-row items-center gap-4 bg-gradient-to-r from-[var(--primary)]/10 to-transparent" style={{ borderColor: 'var(--ring)' }}>
        <Building2 size={26} className="text-[var(--primary-2)] shrink-0" />
        <div className="flex-1 text-center sm:text-left">
          <div className="font-semibold text-lg">{t('hosting.enterprise.title', 'Enterprise / bespoke')}</div>
          <div className="text-sm text-[var(--muted)]">{t('hosting.enterprise.sub', "Bigger needs — high storage/bandwidth, dedicated resources, an SLA, custom terms. No fixed price: tell us what you need and we'll tailor a plan.")}</div>
        </div>
        <Button variant="default" onClick={() => nav('/contact?topic=enterprise-hosting')}><Mail size={16} /> {t('hosting.enterprise.cta', 'Contact us')}</Button>
      </Card>

      {/* Boost an existing repo — added to the same cart (one-time, priced per day). */}
      {user && (myRepos.data?.repos || []).some((r) => r.hosted || r.listed) && (
        <BoostAddCard repos={(myRepos.data?.repos || []).filter((r) => r.hosted || r.listed)} onAdd={addBoost} />
      )}

      <p className="text-xs text-[var(--faint)] mt-5 flex items-center gap-1.5"><ShieldCheck size={13} /> {t('hosting.note', 'Updates only require a valid SHA. We set the upload limit per repo.')}</p>
      <CustomPlanModal open={customOpen} onClose={() => setCustomOpen(false)} months={months} setMonths={setMonths} termDisc={TERM_DISC} onCheckout={(custom) => { setCustomOpen(false); addHosting({ custom, label: t('cart.custom', 'Custom {gb} GB').replace('{gb}', custom.storageGB) }); }} />
      <CartPanel open={cartOpen} setOpen={setCartOpen} cart={cart} count={cartCount} removeItem={removeItem} setItemAutoRenew={setItemAutoRenew} clearCart={clearCart} />
    </div>
  );
}

// A small "add a boost to the cart" card: pick one of your repos + a duration.
function BoostAddCard({ repos, onAdd }) {
  const { t } = useI18n();
  const [repoId, setRepoId] = useState(repos[0]?.id || '');
  const [days, setDays] = useState(7);
  const { data: fp } = useAsync(() => api.get(`/hosting/feature-price?days=${days}`).catch(() => null), [days]);
  const repo = repos.find((r) => r.id === repoId);
  return (
    <Card className="p-6 mt-4 flex flex-col sm:flex-row items-center gap-4 bg-gradient-to-r from-amber-500/10 to-transparent">
      <Rocket size={26} className="text-amber-400 shrink-0" />
      <div className="flex-1 w-full">
        <div className="font-semibold text-lg">{t('cart.boost.title', 'Boost a repo to the top')}</div>
        <div className="text-sm text-[var(--muted)] mb-2">{t('cart.boost.sub', 'Feature one of your repos at the top of the public listing for a set number of days.')}</div>
        <div className="grid sm:grid-cols-[1fr_auto_auto] gap-2 items-end">
          <Select value={repoId} onChange={(e) => setRepoId(e.target.value)}>{repos.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>
          <Select className="!w-auto" value={days} onChange={(e) => setDays(Number(e.target.value))}>{[3, 7, 14, 30, 90].map((d) => <option key={d} value={d}>{d} {t('cart.days', 'days')}</option>)}</Select>
          <Button variant="primary" disabled={!repoId} onClick={() => onAdd({ repoId, repoName: repo?.name, days })}><ShoppingCart size={15} /> {t('cart.add', 'Add to cart')}{fp?.priceCents != null ? ` · $${(fp.priceCents / 100).toFixed(2)}` : ''}</Button>
        </div>
      </div>
    </Card>
  );
}

// Floating shopping cart: line items + stacked promo codes + a live server quote,
// then one Stripe checkout for the whole bundle. Responsive (a bottom-right panel on
// desktop, near-fullscreen sheet on mobile) with a collapsed pill when closed.
function CartPanel({ open, setOpen, cart, count, removeItem, setItemAutoRenew }) {
  const { t } = useI18n(); const toast = useToast(); const { user } = useAuth(); const nav = useNavigate();
  // The cart is portaled to <body>, so it escapes AppReveal's intro fade — gate it
  // explicitly: NOTHING may show during the intro (only the intro's own controls).
  const { active: introActive } = useIntro();
  const [codes, setCodes] = useState([]);
  const [codeInput, setCodeInput] = useState('');
  const [quote, setQuote] = useState(null);
  const [quoteErr, setQuoteErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [agreed, setAgreed] = useState(false); // must accept Terms + Payments policy before paying
  const apiItems = useMemo(() => cart.map((it) => it.kind === 'hosting'
    ? { kind: 'hosting', mode: it.mode, repoName: it.repoName, months: it.months, autoRenew: !!it.autoRenew, ...(it.custom ? { custom: it.custom } : { planId: it.planId }) }
    : { kind: 'boost', repoId: it.repoId, days: it.days, autoRenew: !!it.autoRenew }), [cart]);
  // Live quote (debounced) whenever the cart or promo set changes.
  useEffect(() => {
    if (!cart.length) { setQuote(null); setQuoteErr(null); return; }
    const id = setTimeout(async () => {
      try { setQuote(await api.post('/hosting/cart/quote', { items: apiItems, promoCodes: codes })); setQuoteErr(null); }
      catch (x) { setQuote(null); setQuoteErr(x.data?.error || 'quote_failed'); }
    }, 350);
    return () => clearTimeout(id);
  }, [apiItems, codes, cart.length]);
  const money = (c) => `$${((c || 0) / 100).toFixed(2)}`;
  const addCode = () => { const v = codeInput.trim().toUpperCase(); if (v && !codes.includes(v)) setCodes((c) => [...c, v]); setCodeInput(''); };
  const promoErr = quoteErr && quoteErr.startsWith('promo_');
  const checkout = async () => {
    if (!user) return nav('/auth');
    if (!agreed) return toast.error(t('cart.mustagree', 'Please accept the Terms and Payments policy first.'));
    setBusy(true);
    try {
      const res = await api.post('/hosting/cart/checkout', { items: apiItems, promoCodes: codes, acceptedTerms: true });
      window.location = res.url;
    } catch (x) {
      const e = x.data?.error;
      if (e === 'creator_link_required') { toast.error(t('hosting.err.link', 'Link a BMM creator id first (Profile → Creator IDs) to host a repo.')); nav('/profile'); }
      else if (e === 'cart_makes_free') toast.error(t('cart.err.free', 'The total is free — remove a promo or use a free-hosting grant code instead.'));
      else if (e === 'promo_not_stackable') toast.error(t('cart.err.stack', 'Those codes can’t be combined — only stackable codes stack.'));
      else if (e === 'capacity_full') toast.error(t('hosting.err.capacity', 'No capacity available right now.'));
      else if (e === 'stripe_not_configured') toast.error(t('hosting.err.stripe', 'Payments not configured yet.'));
      else if (e === 'terms_not_accepted') toast.error(t('cart.mustagree', 'Please accept the Terms and Payments policy first.'));
      else if (e?.startsWith('promo_')) toast.error(t('cart.err.promo', 'A code is invalid or not eligible.'));
      else toast.error(t('hosting.err.checkout', 'Checkout failed — {e}').replace('{e}', e || (x.status ? `HTTP ${x.status}` : 'unknown')));
    } finally { setBusy(false); }
  };
  if (!count || introActive) return null;
  // Rendered through a portal to <body> so no page-level ancestor (opacity/anim
  // wrappers, reveal transforms) can turn `fixed` into a clipped absolute — that
  // was making the cart + its button hide under the footer and go un-clickable.
  if (!open) return createPortal((
    <button onClick={() => setOpen(true)} className="fixed bottom-20 md:bottom-4 right-3 md:right-4 z-[90] flex items-center gap-2 pl-3.5 pr-4 py-3 rounded-2xl text-white font-semibold shadow-xl bg-gradient-to-r from-orange-500 to-amber-500 hover:brightness-105 transition">
      <span className="relative"><ShoppingCart size={18} /><span className="absolute -top-2 -right-2 grid place-items-center w-4 h-4 rounded-full bg-white text-orange-600 text-[10px] font-bold">{count}</span></span>
      {t('cart.title', 'Cart')}
    </button>
  ), document.body);
  return createPortal((
    <div className="fixed z-[90] inset-x-2 bottom-[4.75rem] md:inset-x-auto md:right-4 md:bottom-4 md:w-[24rem] max-h-[70vh] md:max-h-[calc(100vh-2rem)] flex flex-col rounded-2xl border border-[var(--line-strong)] overflow-hidden" style={{ background: 'var(--bg-solid)', boxShadow: '0 24px 70px -18px rgba(0,0,0,0.6)' }}>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--line)]">
        <ShoppingCart size={16} className="text-[var(--primary-2)]" />
        <span className="font-semibold flex-1">{t('cart.your', 'Your cart')} <span className="text-[var(--faint)] font-normal">· {count}</span></span>
        <button onClick={() => setOpen(false)} className="text-[var(--faint)] hover:text-[var(--text)]"><ChevronDown size={18} /></button>
      </div>
      <div className="overflow-auto p-3 space-y-2 flex-1">
        {cart.map((it) => (
          <div key={it.uid} className="rounded-lg bg-[var(--surface-2)] px-3 py-2">
            <div className="flex items-center gap-2 text-sm">
              {it.kind === 'boost' ? <Rocket size={14} className="text-amber-400 shrink-0" /> : <HardDrive size={14} className="text-[var(--primary-2)] shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{it.kind === 'boost' ? t('cart.boostof', 'Boost "{n}"').replace('{n}', it.repoName || '') : (it.label || it.repoName)}</div>
                <div className="text-[11px] text-[var(--faint)]">{it.kind === 'boost' ? `${it.days} ${t('cart.days', 'days')} · ${it.autoRenew ? t('cart.recurring', 'recurring') : t('cart.onetime', 'one-time')}` : `${it.mode === 'multi' ? t('hosting.multi', 'Multiple repos') : t('hosting.single', 'Single repo')} · ${it.months} ${t('hosting.mo', 'mo')}`}</div>
              </div>
              <button onClick={() => removeItem(it.uid)} className="text-[var(--faint)] hover:text-red-400 shrink-0"><X size={14} /></button>
            </div>
            {/* Per-item auto-renew — hosting renews as a subscription after the prepaid
                term; a boost re-bills every N days. Both cancellable in Billing. */}
            <label className="flex items-center gap-1.5 mt-1.5 text-[11px] text-[var(--muted)] cursor-pointer" title={it.kind === 'boost' ? t('cart.autorenew.hb', 'Keep this repo featured automatically — re-bills every {n} days. Cancel anytime in Billing.').replace('{n}', it.days) : t('cart.autorenew.h', 'Keep this repo online automatically — after the prepaid term it renews as a subscription. Cancel anytime in Billing.')}>
              <input type="checkbox" checked={!!it.autoRenew} onChange={(e) => setItemAutoRenew(it.uid, e.target.checked)} />
              <RefreshCw size={11} className={it.autoRenew ? 'text-emerald-400' : 'text-[var(--faint)]'} /> {it.kind === 'boost' ? t('cart.autorenew.boost', 'Auto-renew every {n} days').replace('{n}', it.days) : t('cart.autorenew', 'Auto-renew after the prepaid term')}
            </label>
          </div>
        ))}
        {/* Promo codes (stack the stackable ones) */}
        <div className="pt-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">{t('cart.promos', 'Promo codes')}</div>
          <div className="flex gap-1.5">
            <Input className="!py-1.5 !text-sm" value={codeInput} onChange={(e) => setCodeInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCode()} placeholder={t('cart.promoph', 'Enter a code')} />
            <Button size="sm" onClick={addCode}><Plus size={13} /></Button>
          </div>
          {codes.length > 0 && <div className="flex flex-wrap gap-1.5 mt-2">{codes.map((c) => (
            <span key={c} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--surface-2)] border border-[var(--line)] text-xs font-mono">{c}<button onClick={() => setCodes((x) => x.filter((k) => k !== c))} className="text-[var(--faint)] hover:text-red-400"><X size={10} /></button></span>
          ))}</div>}
          {promoErr && <div className="text-[11px] text-red-400 mt-1.5">{quoteErr === 'promo_not_stackable' ? t('cart.err.stack', 'Those codes can’t be combined — only stackable codes stack.') : quoteErr === 'promo_not_discount' ? t('cart.err.notdiscount', 'Only discount codes apply in the cart.') : t('cart.err.promo', 'A code is invalid or not eligible.')}</div>}
        </div>
      </div>
      <div className="border-t border-[var(--line)] p-3 space-y-1.5">
        {quote && (<>
          <div className="flex justify-between text-sm text-[var(--muted)]"><span>{t('cart.subtotal', 'Subtotal')}</span><span className="tabular-nums">{money(quote.subtotalCents)}</span></div>
          {quote.discountCents > 0 && <div className="flex justify-between text-sm text-emerald-400"><span>{t('cart.discount', 'Discount')}{quote.combinedPct ? ` (−${quote.combinedPct}%)` : ''}</span><span className="tabular-nums">−{money(quote.discountCents)}</span></div>}
          <div className="flex justify-between font-bold text-base pt-1 border-t border-[var(--line)]"><span>{t('cart.total', 'Total')}</span><span className="tabular-nums">{money(quote.totalCents)}</span></div>
        </>)}
        {quoteErr && !promoErr && <div className="text-[11px] text-amber-400">{quoteErr === 'capacity_full' ? t('hosting.err.capacity', 'No capacity available right now.') : quoteErr === 'over_limit' ? t('cart.err.overlimit', 'A custom plan exceeds the per-repo upload limit.') : t('cart.err.quote', 'Could not price the cart.')}</div>}
        <label className="flex items-start gap-2 text-[11px] text-[var(--muted)] cursor-pointer">
          <input type="checkbox" className="mt-0.5" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span dangerouslySetInnerHTML={{ __html: t('cart.agree', 'I accept the <a href="/legal/terms" target="_blank" class="text-[var(--primary-2)] underline">Terms</a> and the <a href="/legal/refunds" target="_blank" class="text-[var(--primary-2)] underline">Payments & Refunds</a> policy, and I understand that content I host is my responsibility.') }} />
        </label>
        <Button variant="primary" className="w-full mt-1" disabled={busy || !count || !agreed} onClick={checkout}>{busy ? <Spinner /> : <><CreditCard size={15} /> {t('cart.checkout', 'Checkout')}{quote ? ` · ${money(quote.totalCents)}` : ''}</>}</Button>
        <p className="text-[10px] text-[var(--faint)] text-center">{t('cart.note2', 'Prepaid now for the whole cart. Items marked auto-renew continue as a subscription after their term.')}</p>
      </div>
    </div>
  ), document.body);
}

function CustomPlanModal({ open, onClose, onCheckout, months = 12, setMonths, termDisc = { 1: 0, 3: 0.05, 6: 0.10, 12: 0.20, 24: 0.35 } }) {
  const { t } = useI18n();
  const [spec, setSpec] = useState({ storageGB: 20, uploadMbps: 8 });
  const [price, setPrice] = useState(null);
  const [factors, setFactors] = useState(null); // { maxUploadMbps } — admin/scarcity caps
  const [promo, setPromo] = useState(null);
  const disc = termDisc[months] || 0;
  const afterTerm = price == null ? null : Math.round(price * months * (1 - disc));
  const termTotal = afterTerm == null ? null : promo?.percentOff ? Math.round(afterTerm * (1 - promo.percentOff / 100)) : afterTerm;
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => {
      api.get(`/hosting/price?${new URLSearchParams({ storageGB: spec.storageGB, uploadMbps: spec.uploadMbps })}`)
        .then((r) => { setPrice(r.priceMonthlyCents); setFactors(r.factors || null); }).catch(() => setPrice(null));
    }, 200);
    return () => clearTimeout(id);
  }, [open, spec]);
  // Clamp the upload slider to the current per-repo ceiling (admin + scarcity).
  const upMax = Math.min(200, factors?.maxUploadMbps ?? 200);
  useEffect(() => {
    setSpec((sp) => (sp.uploadMbps > upMax) ? { ...sp, uploadMbps: Math.min(sp.uploadMbps, upMax) } : sp);
  }, [upMax]);
  const sliders = [
    { key: 'storageGB', label: t('hosting.s.storage', 'Storage'), min: 1, max: 200, step: 1, fmt: (v) => `${v} GB`, icon: HardDrive },
    { key: 'uploadMbps', label: t('hosting.s.upload', 'Upload speed'), min: 1, max: upMax, step: 1, fmt: (v) => `${v} Mbps`, icon: Zap },
  ];
  return (
    <Modal open={open} onClose={onClose} title={t('hosting.custom.modaltitle', 'Build a custom plan')} icon={Sliders} width="max-w-lg"
      footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button><Button variant="primary" onClick={() => onCheckout(spec, promo?.code)}><ShoppingCart size={15} /> {t('cart.add', 'Add to cart')}</Button></>}>
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

// Password field with a show/hide toggle.
function PwInput({ value, onChange, placeholder = '••••••••' }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input type={show ? 'text' : 'password'} value={value} onChange={onChange} placeholder={placeholder} className="!pr-10" />
      <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--faint)] hover:text-[var(--text)] p-1">
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

export function Auth() {
  const { user, loading: authLoading, login, loginWith2fa, register } = useAuth(); const nav = useNavigate(); const toast = useToast(); const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const [mode, setMode] = useState('login'); // login | register | forgot | reset
  const [f, setF] = useState({ email: '', password: '', confirm: '', displayName: '', token: '' });
  const [busy, setBusy] = useState(false); const [step, setStep] = useState('');
  const [twoFa, setTwoFa] = useState(null); // { tempToken } once password is verified and a TOTP code is needed
  const [code, setCode] = useState('');
  const [emailTaken, setEmailTaken] = useState(false); // inline field-level error (register)
  const nameTouched = useRef(false); // did the user edit the display name themselves?
  // Smart default: derive a friendly display name from the email local-part until the
  // user types their own — one less field to think about at the highest-friction moment.
  const suggestName = (email) => (email.split('@')[0] || '').replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 40);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const { data: oauthProviders } = useAsync(() => api.get('/auth/oauth/providers').catch(() => ({})), []);

  // Arriving from a password-reset email link (/auth?reset=<token>) → jump straight to
  // the "set a new password" step with the token prefilled.
  useEffect(() => {
    const rtok = params.get('reset');
    if (rtok) { setF((s) => ({ ...s, token: rtok })); setMode('reset'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    // `/oauth2/*` is served by the API (OIDC authorize), not an SPA route — do a real
    // navigation so it hits the backend rather than the SPA's not-found.
    if (next && next.startsWith('/oauth2/')) { window.location.href = next; return; }
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
        if (res.devToken) { setF((s) => ({ ...s, token: res.devToken })); setMode('reset'); toast.info(t('auth.toast.devtoken', 'Reset token issued (dev). Set a new password.')); }
        else toast.success(t('auth.toast.sent'));
      } else if (mode === 'reset') {
        await api.post('/auth/reset/confirm', { token: f.token, password: f.password });
        toast.success(t('auth.toast.updated')); setMode('login'); setF((s) => ({ ...s, password: '', confirm: '', token: '' }));
      }
    } catch (x) {
      // "Email already exists" is best shown INLINE under the field (with a one-tap
      // path to login), not as a transient toast — the error is about that input.
      if (x.data?.error === 'email_taken') { setEmailTaken(true); }
      else toast.error(x.data?.error === 'invalid_credentials' ? t('auth.err.creds')
        : x.data?.error === 'oauth_only_account' ? t('auth.err.oauthOnly', 'This account was created with GitHub or Discord — use that to sign in, or set a password from your profile once signed in.')
        : x.data?.error === 'invalid_token' ? t('auth.err.token')
        : x.data?.error === 'pow_required' ? t('auth.err.pow') : t('auth.err.fail'));
    } finally { setBusy(false); setStep(''); }
  };

  const titles = { login: [t('auth.welcome'), t('auth.subin')], register: [t('auth.create'), t('auth.subup')], forgot: [t('auth.reset.title'), t('auth.reset.sub')], reset: [t('auth.newpw.title'), t('auth.newpw.sub')] };
  const cta = { login: t('nav.signin'), register: t('auth.create'), forgot: t('auth.sendreset'), reset: t('auth.updatepw') };
  const pw2 = mode === 'register' || mode === 'reset';
  // Live, as-you-type validation — show the problem the instant it's clear (a wrong
  // email format, a too-short password, a mismatch) instead of waiting for submit.
  // Guarded so an empty / barely-started field doesn't nag prematurely.
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const emailBad = mode !== 'reset' && f.email.length > 3 && !emailRe.test(f.email);
  const pwShort = pw2 && f.password.length > 0 && f.password.length < 8;
  const pwMismatch = pw2 && f.confirm.length > 0 && f.confirm !== f.password;

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
            <div className="-mt-1"><TotpQuickFill onFill={(c) => setCode(c)} /></div>
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
          {mode === 'register' && <Field label={t('auth.name')}><Input value={f.displayName} onChange={(e) => { nameTouched.current = true; setF({ ...f, displayName: e.target.value }); }} placeholder={t('auth.name.ph', 'How should we call you?')} /></Field>}
          {mode !== 'reset' && <Field label={t('auth.email')}>
            <Input type="email" value={f.email} aria-invalid={(emailTaken || emailBad) || undefined}
              onChange={(e) => { if (emailTaken) setEmailTaken(false); const email = e.target.value; setF((s) => ({ ...s, email, displayName: (mode === 'register' && !nameTouched.current) ? suggestName(email) : s.displayName })); }} placeholder="you@example.com" />
            {emailTaken ? <div className="text-xs text-[var(--error)] mt-1.5 anim-fade">
                {t('auth.err.taken', 'This email already exists.')}{' '}
                <button type="button" onClick={() => { setEmailTaken(false); setMode('login'); }} className="underline underline-offset-2 font-semibold hover:opacity-80 press-sm">{t('auth.err.taken.login', 'Login instead?')}</button>
              </div>
             : emailBad ? <div className="text-xs text-[var(--error)] mt-1.5 anim-fade">{t('auth.err.emailformat', 'Enter a valid email address.')}</div>
             : null}
          </Field>}
          {mode === 'reset' && <Field label={t('auth.token')}><Input value={f.token} onChange={set('token')} placeholder={t('auth.token.ph')} /></Field>}
          {mode !== 'forgot' && <Field label={pw2 ? t('auth.newpw') : t('auth.password')}>
            <PwInput value={f.password} onChange={set('password')} />
            {pwShort && <div className="text-xs text-[var(--warning)] mt-1.5 anim-fade">{t('auth.err.short', 'Password must be at least 8 characters.')}</div>}
          </Field>}
          {pw2 && <Field label={t('auth.confirmpw')}>
            <PwInput value={f.confirm} onChange={set('confirm')} />
            {pwMismatch && <div className="text-xs text-[var(--error)] mt-1.5 anim-fade">{t('auth.err.match', "Passwords don't match.")}</div>}
          </Field>}
          <Button variant="primary" className="w-full" disabled={busy}>{busy ? <><Spinner /> {step || '…'}</> : cta[mode]}</Button>
        </form>
        {(mode === 'login' || mode === 'register') && (oauthProviders?.github || oauthProviders?.discord || oauthProviders?.google) && (
          <>
            <div className="flex items-center gap-3 my-4 text-xs text-[var(--faint)]"><div className="flex-1 h-px bg-[var(--line)]" /> {t('auth.or', 'or')} <div className="flex-1 h-px bg-[var(--line)]" /></div>
            <div className="flex flex-col gap-2">
              {oauthProviders.google && <a href="/api/auth/oauth/google/start"><Button className="w-full"><GoogleIcon size={16} /> {t('auth.oauth.google', 'Continue with Google')}</Button></a>}
              {oauthProviders.github && <a href="/api/auth/oauth/github/start"><Button className="w-full"><GithubIcon size={16} /> {t('auth.oauth.github', 'Continue with GitHub')}</Button></a>}
              {oauthProviders.discord && <a href="/api/auth/oauth/discord/start"><Button className="w-full"><DiscordIcon size={16} className="text-[#5865F2]" /> {t('auth.oauth.discord', 'Continue with Discord')}</Button></a>}
            </div>
          </>
        )}
        <div className="mt-4 flex flex-col items-center gap-1.5 text-sm">
          {mode === 'login' && <button className="text-[var(--muted)] hover:text-[var(--text)]" onClick={() => { setEmailTaken(false); setMode('forgot'); }}>{t('auth.forgot')}</button>}
          <button className="text-[var(--muted)] hover:text-[var(--text)]" onClick={() => { setEmailTaken(false); setMode(mode === 'login' ? 'register' : 'login'); }}>
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
// Getting-started checklist (Goal-Gradient effect): a brand-new dashboard is a wall of
// zeros, which reads as "0% done" and kills momentum. This starts users ABOVE zero
// (account already ✓) and shows a visible path to first value. Controlled by the parent
// so it can hand off to the 2FA nudge once dismissed. Auto-hides when every step is done.
function GettingStarted({ user, items, repos, onSubmit, onDismiss }) {
  const { t } = useI18n();
  const steps = [
    { key: 'account', label: t('gs.account', 'Create your account'), done: true },
    { key: '2fa', label: t('gs.2fa', 'Secure it with 2FA'), done: !!user?.totpEnabled, to: '/profile?setup2fa=1' },
    { key: 'item', label: t('gs.item', 'Submit your first item'), done: (items?.length || 0) > 0, action: 'submit' },
    { key: 'repo', label: t('gs.repo', 'Host your first Server-Repo'), done: (repos?.length || 0) > 0, to: '/hosting' },
  ];
  const done = steps.filter((s) => s.done).length;
  const pct = Math.round((done / steps.length) * 100);
  return (
    <Card className="p-5 mb-6">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="font-semibold flex items-center gap-2"><Rocket size={16} className="text-[var(--primary-2)]" /> {t('gs.title', 'Getting started')}</div>
          <div className="text-xs text-[var(--muted)] mt-0.5">{t('gs.sub', "You're already {pct}% set up — finish the last steps to get the most out of it.").replace('{pct}', pct)}</div>
        </div>
        <button onClick={onDismiss} className="text-[var(--faint)] hover:text-[var(--text)] p-1 shrink-0" title={t('gs.dismiss', 'Dismiss')}><X size={15} /></button>
      </div>
      <div className="flex items-center gap-3 mb-4">
        <div className="progress-track flex-1"><div className="progress-fill is-done pop-in" style={{ width: `${pct}%` }} /></div>
        <span className="text-xs font-semibold tabular-nums text-[var(--muted)] shrink-0">{done}/{steps.length}</span>
      </div>
      <div className="space-y-1">
        {steps.map((st) => {
          const inner = (
            <div className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors ${!st.done && (st.to || st.action) ? 'hover:bg-[var(--surface-2)] press cursor-pointer' : ''}`}>
              {st.done ? <CheckCircle2 size={18} className="text-[var(--success)] shrink-0" /> : <span className="w-[18px] h-[18px] rounded-full border-2 border-[var(--line-strong)] shrink-0" />}
              <span className={`text-sm flex-1 ${st.done ? 'text-[var(--faint)] line-through' : 'font-medium'}`}>{st.label}</span>
              {!st.done && (st.to || st.action) && <ArrowRight size={14} className="text-[var(--primary-2)] shrink-0" />}
            </div>
          );
          if (st.done || (!st.to && !st.action)) return <div key={st.key}>{inner}</div>;
          if (st.action === 'submit') return <button key={st.key} type="button" className="w-full text-left" onClick={onSubmit}>{inner}</button>;
          return <Link key={st.key} to={st.to}>{inner}</Link>;
        })}
      </div>
    </Card>
  );
}

const TWOFA_NUDGE_KEY = 'bcw_2fa_nudge_dismissed';
const GS_DISMISS_KEY = 'bcw_gs_dismissed';
function TwoFactorNudge() {
  const { user } = useAuth(); const { t } = useI18n();
  const [dismissed, setDismissed] = useState(() => { try { return localStorage.getItem(TWOFA_NUDGE_KEY) === '1'; } catch { return false; } });
  if (!user || user.totpEnabled || dismissed) return null;
  const hide = () => { setDismissed(true); try { localStorage.setItem(TWOFA_NUDGE_KEY, '1'); } catch {} };
  return (
    <Card className="p-4 mb-6 flex items-start gap-3 bg-gradient-to-r from-orange-500/12 to-transparent border-[var(--ring)]">
      <span className="grid place-items-center w-10 h-10 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] shrink-0"><ShieldCheck size={18} className="text-[var(--primary-2)]" /></span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold">{t('twofa.nudge.title', 'Don’t risk losing access to your account')}</div>
        <div className="text-xs text-[var(--muted)] mt-0.5">{t('twofa.nudge.d', 'A single leaked password could cost you your repos, submissions and payment history. Add a second factor — about a minute, and you stay in control.')}</div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <Link to="/profile?setup2fa=1"><Button size="sm" variant="primary"><ShieldCheck size={14} /> {t('twofa.nudge.setup', 'Set up')}</Button></Link>
        <button onClick={hide} className="text-[var(--faint)] hover:text-[var(--text)] p-1" title={t('twofa.nudge.later', 'Maybe later')}><X size={16} /></button>
      </div>
    </Card>
  );
}

// Card-payment-terminal (TPE) illustration, tinted by outcome. `ok` → the terminal
// shows an approved slip + green check; else a declined slip + amber cross.
function PaymentTerminal({ ok }) {
  const a1 = ok ? '#34d399' : '#f87171';
  const a2 = ok ? '#059669' : '#dc2626';
  const g = ok ? 'ptok' : 'ptfail';
  return (
    <svg viewBox="0 0 240 210" width="150" height="132" className="mx-auto" role="img" aria-hidden="true">
      <defs>
        <linearGradient id={`${g}-body`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--surface-2)" /><stop offset="1" stopColor="var(--bg-solid)" /></linearGradient>
        <linearGradient id={`${g}-acc`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={a1} /><stop offset="1" stopColor={a2} /></linearGradient>
        {/* userSpaceOnUse + r=100 centred at (120,100) so the glow fades fully to 0
            BEFORE the svg edges — an objectBoundingBox radial was still non-zero at
            the rect boundary, which showed as a hard-cut rectangle around the icon. */}
        <radialGradient id={`${g}-glow`} gradientUnits="userSpaceOnUse" cx="120" cy="100" r="100"><stop offset="0" stopColor={a1} stopOpacity="0.28" /><stop offset="0.6" stopColor={a1} stopOpacity="0.1" /><stop offset="1" stopColor={a1} stopOpacity="0" /></radialGradient>
      </defs>
      <rect x="0" y="0" width="240" height="210" fill={`url(#${g}-glow)`} />
      {/* handheld terminal, slightly tilted for depth */}
      <g transform="rotate(-6 120 120)">
        <rect x="74" y="52" width="92" height="130" rx="17" fill={`url(#${g}-body)`} stroke="var(--line-strong)" strokeWidth="2" />
        {/* screen */}
        <rect x="86" y="64" width="68" height="40" rx="6" fill="#0b1220" />
        <g stroke={a1} strokeWidth="2.6" fill="none" strokeLinecap="round" opacity="0.95"><path d="M104 84 a10 10 0 0 1 0 12" /><path d="M110 80 a17 17 0 0 1 0 20" /></g>
        <rect x="122" y="81" width="24" height="4" rx="2" fill={a1} opacity="0.85" />
        <rect x="122" y="90" width="16" height="4" rx="2" fill="#475569" />
        {/* rounded keypad keys */}
        {[0, 1, 2].map((r) => [0, 1, 2].map((c) => (
          <rect key={`${r}-${c}`} x={90 + c * 24} y={116 + r * 18} width="17" height="12" rx="3.5" fill="var(--line-strong)" />
        )))}
      </g>
      {/* card tapped on top (contactless) */}
      <g transform="rotate(11 152 58)">
        <rect x="120" y="32" width="66" height="43" rx="8" fill={`url(#${g}-acc)`} />
        <rect x="120" y="45" width="66" height="9" fill="#0b1220" opacity="0.32" />
        <rect x="128" y="40" width="13" height="10" rx="2" fill="#fde68a" />
        <rect x="128" y="62" width="28" height="5" rx="2.5" fill="#fff" opacity="0.9" />
      </g>
      {/* outcome badge with a clean ring */}
      <g transform="translate(170 152)">
        <circle r="26" fill="var(--bg-solid)" />
        <circle r="21" fill={`url(#${g}-acc)`} />
        {ok
          ? <path d="M-9 1 l6 6 l12 -13" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          : <path d="M-7 -7 l14 14 M7 -7 l-14 14" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" />}
      </g>
    </svg>
  );
}

function PaymentResultModal({ result, onClose }) {
  const { t } = useI18n();
  const ok = result?.ok;
  const kind = result?.kind;
  const failed = result?.failed;             // true = payment failed (declined), vs plain cancel
  const [inv, setInv] = useState(null);       // most-recent Stripe invoice (for the real PDF)
  const [pay, setPay] = useState(null);       // fallback: local payment row (amount display)
  const [linking, setLinking] = useState(false);
  // The webhook + Stripe invoice can land a beat after the redirect — poll briefly so
  // "Download invoice" lights up once the real invoice exists.
  useEffect(() => {
    if (!ok) return;
    let tries = 0, cancelled = false;
    const poll = async () => {
      try {
        const [iv, r] = await Promise.all([api.get('/me/invoices').catch(() => null), api.get('/me/payments').catch(() => null)]);
        const latestInv = iv?.invoices?.[0]; const latestPay = r?.payments?.[0];
        if (!cancelled && (latestInv || latestPay)) { setInv(latestInv || null); setPay(latestPay || null); if (latestInv) return; }
      } catch {}
      if (tries++ < 6 && !cancelled) setTimeout(poll, 1500);
    };
    poll();
    return () => { cancelled = true; };
  }, [ok]);
  const downloadInvoice = async () => {
    setLinking(true);
    try {
      if (inv?.hasPdf) {
        // Real download through the API (attachment, correct filename).
        const res = await fetch(`/api/me/invoices/${inv.id}/pdf`); const blob = await res.blob();
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `invoice-${inv.number}.pdf`;
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      } else if (pay) {
        const link = await api.get(`/me/payments/${pay.id}/stripe-link`).catch(() => null);
        const url = link?.pdf || link?.hosted || link?.receipt;
        if (url) window.open(url, '_blank', 'noopener');
      }
    } finally { setLinking(false); }
  };
  const src = inv || pay;
  const amount = src ? (() => { const c = inv ? inv.amountCents : pay.amountCents; const cur = (src.currency || 'usd').toUpperCase(); const sym = cur === 'USD' ? '$' : cur === 'EUR' ? '€' : cur === 'GBP' ? '£' : ''; return sym ? `${sym}${(c / 100).toFixed(2)}` : `${(c / 100).toFixed(2)} ${cur}`; })() : null;
  const canDl = (inv?.hasPdf) || !!pay;
  return (
    <Modal open onClose={onClose} title="" width="max-w-sm"
      footer={<>
        {ok && <Button variant="ghost" disabled={!canDl || linking} onClick={downloadInvoice}>{linking ? <Spinner /> : <><Download size={15} /> {t('dash.pay.dl', 'Download invoice')}</>}</Button>}
        <Button variant="primary" onClick={onClose}>{ok ? t('dash.pay.done', 'Done') : t('dash.pay.retry', 'Try again')}</Button>
      </>}>
      <div className="text-center pt-2 pb-1">
        <PaymentTerminal ok={ok} />
        <div className={`text-xl font-extrabold mt-3 ${failed ? 'text-red-400' : ''}`}>{ok ? t('dash.pay.ok.t', 'Payment confirmed') : failed ? t('dash.pay.fail.t', 'Payment failed') : t('dash.pay.cancel.t', 'Checkout cancelled')}</div>
        <p className="text-sm text-[var(--muted)] mt-1.5 max-w-xs mx-auto">
          {ok
            ? (kind === 'feature' ? t('dash.pay.feature.m', 'Your repo is now featured on the public listing.') : t('dash.pay.hosting.m', "Your repo is being provisioned — it'll be online shortly."))
            : failed ? t('dash.pay.fail.m', 'The payment could not be completed — no charge was made. Check your card details and try again.')
            : t('dash.pay.cancel.m', 'No charge was made. You can try again anytime.')}
        </p>
        {ok && (() => {
          const lines = inv?.lines || [];
          const money2 = (c) => { const cur = (inv?.currency || pay?.currency || 'usd').toUpperCase(); const sym = cur === 'USD' ? '$' : cur === 'EUR' ? '€' : cur === 'GBP' ? '£' : ''; return sym ? `${sym}${(c / 100).toFixed(2)}` : `${(c / 100).toFixed(2)} ${cur}`; };
          const single = pay?.description || (kind === 'feature' ? t('dash.pay.boost', 'Repo boost') : t('dash.pay.hostingitem', 'Repo hosting'));
          return (
          <div className="mt-4 rounded-xl border border-[var(--line)] bg-[var(--surface-2)]/50 px-4 py-3 text-left text-sm max-w-xs mx-auto">
            {inv?.number && (
              <div className="flex items-center justify-between gap-3 mb-1.5 pb-1.5 border-b border-[var(--line)]">
                <span className="text-[var(--faint)]">{t('dash.pay.invoice', 'Invoice №')}</span>
                <span className="font-mono text-xs">{inv.number}</span>
              </div>
            )}
            {lines.length > 1 ? (
              <details open className="group/items">
                <summary className="flex items-center justify-between gap-3 cursor-pointer select-none list-none">
                  <span className="text-[var(--faint)] flex items-center gap-1"><ChevronDown size={13} className="transition-transform group-open/items:rotate-180" /> {t('dash.pay.items', '{n} items').replace('{n}', lines.length)}</span>
                  <span className="font-semibold tabular-nums">{amount || money2(lines.reduce((s, l) => s + l.amountCents, 0))}</span>
                </summary>
                <div className="mt-2 space-y-1">
                  {lines.map((l, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 text-[13px]">
                      <span className="truncate text-[var(--muted)]">{l.description}</span>
                      <span className="tabular-nums shrink-0 text-[var(--faint)]">{money2(l.amountCents)}</span>
                    </div>
                  ))}
                </div>
              </details>
            ) : (<>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[var(--faint)]">{t('dash.pay.item', 'Item')}</span>
                <span className="font-medium truncate">{lines[0]?.description || single}</span>
              </div>
              <div className="flex items-center justify-between gap-3 mt-1.5">
                <span className="text-[var(--faint)]">{t('dash.pay.amount', 'Amount')}</span>
                <span className="font-semibold tabular-nums">{amount || <span className="text-[var(--faint)]">{t('dash.pay.processing', 'processing…')}</span>}</span>
              </div>
            </>)}
            <div className="text-[11px] text-[var(--faint)] mt-2 flex items-center gap-1"><Info size={11} /> {t('dash.pay.receipt', 'A receipt is available in the Billing tab.')}</div>
          </div>
          );
        })()}
      </div>
    </Modal>
  );
}

export function Dashboard() {
  const { user } = useAuth(); const toast = useToast(); const nav = useNavigate(); const { t } = useI18n();
  const items = useAsync(() => api.get('/me/items'), []);
  const repos = useAsync(() => api.get('/me/repos'), []);
  const [open, setOpen] = useState(false);
  const [gsDismissed, setGsDismissed] = useState(() => { try { return localStorage.getItem(GS_DISMISS_KEY) === '1'; } catch { return false; } });
  const [editing, setEditing] = useState(null); // the item opened in the view/edit modal
  const cancelDelete = async (it) => { try { await api.post(`/catalog/${it.id}/delete/cancel`); toast.success(t('dash.delcancelled', 'Deletion cancelled.')); items.reload(); } catch { toast.error(t('dash.cancelfail', 'Failed to cancel.')); } };

  // Handle the return trip from a Stripe Checkout redirect (?hosting=ok/cancel, ?feature=ok/cancel).
  // Surfaces a prominent, dismissible confirmation/cancel banner (not just a toast).
  const [sp, setSp] = useSearchParams();
  const { active: introActive } = useIntro(); // hold the payment modal until the site intro finishes
  const [payReturn, setPayReturn] = useState(null); // { ok, kind, failed } | null
  useEffect(() => {
    const hosting = sp.get('hosting'); const feature = sp.get('feature'); const oauth = sp.get('oauth');
    if (!hosting && !feature && !oauth) return;
    if (hosting === 'ok') { setPayReturn({ ok: true, kind: 'hosting' }); repos.reload(); items.reload(); try { localStorage.removeItem('bcw_cart'); } catch {} }
    else if (hosting === 'fail' || hosting === 'failed') { setPayReturn({ ok: false, failed: true, kind: 'hosting' }); }
    else if (hosting === 'cancel') { setPayReturn({ ok: false, kind: 'hosting' }); }
    if (feature === 'ok') { setPayReturn({ ok: true, kind: 'feature' }); repos.reload(); }
    else if (feature === 'fail' || feature === 'failed') { setPayReturn({ ok: false, failed: true, kind: 'feature' }); }
    else if (feature === 'cancel') { setPayReturn({ ok: false, kind: 'feature' }); }
    if (oauth === 'success') toast.success(t('auth.welcome.toast', 'Welcome!'));
    setSp((p) => { const n = new URLSearchParams(p); n.delete('hosting'); n.delete('feature'); n.delete('oauth'); return n; }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const list = items.data?.items || [];
  const rlist = repos.data?.repos || [];
  // My items — search + kind/status filters.
  const [itemQ, setItemQ] = useState('');
  const [itemKind, setItemKind] = useState('all');
  const [itemStatus, setItemStatus] = useState('all');
  const iq = itemQ.trim().toLowerCase();
  const filteredItems = list.filter((it) =>
    (!iq || it.name?.toLowerCase().includes(iq))
    && (itemKind === 'all' || it.kind === itemKind)
    && (itemStatus === 'all' || (itemStatus === 'deleting' ? !!it.deleteAt : it.status === itemStatus)));
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
      {payReturn && !introActive && <PaymentResultModal result={payReturn} onClose={() => setPayReturn(null)} />}
      <SideDash icon={LayoutDashboard} title={t('dash.hi', 'Hi, {name}').replace('{name}', user?.displayName || 'there')} subtitle={t('dash.sub', 'Manage your content, repos and billing.')} tabs={tabs}
        headerActions={<Button variant="primary" onClick={() => setOpen(true)}><Upload size={16} /> {t('sub.title', 'Submit content')}</Button>}>
        {(s) => (<>
          {s === 'overview' && <>
            {/* Goal-gradient onboarding: the checklist owns first-run guidance (incl. 2FA);
                once it's done or dismissed, fall back to the standalone 2FA nudge. */}
            {(() => {
              const complete = !!user?.totpEnabled && list.length > 0 && rlist.length > 0;
              return (!gsDismissed && !complete)
                ? <GettingStarted user={user} items={list} repos={rlist} onSubmit={() => setOpen(true)} onDismiss={() => { setGsDismissed(true); try { localStorage.setItem(GS_DISMISS_KEY, '1'); } catch {} }} />
                : <TwoFactorNudge />;
            })()}
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
            {list.length > 3 && (
              <div className="flex flex-wrap gap-2 mb-3">
                <div className="relative flex-1 min-w-[160px]"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
                  <Input className="!pl-8 !py-1.5 !text-sm" placeholder={t('dash.search', 'Search my items…')} value={itemQ} onChange={(e) => setItemQ(e.target.value)} /></div>
                <Select className="!w-auto !py-1.5 !text-sm" value={itemKind} onChange={(e) => setItemKind(e.target.value)}>
                  <option value="all">{t('dash.allkinds', 'All kinds')}</option><option value="APP">APP</option><option value="PLUGIN">PLUGIN</option><option value="THEME">THEME</option><option value="PRESET">PRESET</option></Select>
                <Select className="!w-auto !py-1.5 !text-sm" value={itemStatus} onChange={(e) => setItemStatus(e.target.value)}>
                  <option value="all">{t('dash.allstatus', 'All statuses')}</option><option value="PUBLISHED">Published</option><option value="PENDING">Pending</option><option value="REJECTED">Rejected</option><option value="deleting">Deleting</option></Select>
              </div>
            )}
            {items.loading ? <Loading /> : (list.length ? (filteredItems.length ? <div className="space-y-2">
              {filteredItems.map((it) => { const I = KIND_ICON[it.kind] || Package; const v = it.kind === 'PLUGIN' ? it.meta?.validation : null; return (
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
            </div> : <div className="text-sm text-[var(--muted)] py-8 text-center">{t('dash.nomatch', 'No items match your filters.')}</div>)
              : <EmptyState icon={Inbox} title={t('dash.noitems', 'No items yet')} sub={t('dash.noitems.s', 'Submit your first app, plugin, theme or preset.')}>
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
  const { user } = useAuth(); const dialog = useDialog(); const toast = useToast(); const { t } = useI18n();
  const [modQ, setModQ] = useState(''); const [modQApplied, setModQApplied] = useState('');
  const [modSort, setModSort] = useState('oldest'); const [modKind, setModKind] = useState(''); const [modType, setModType] = useState('');
  const subs = useAsync(() => api.get(`/mod/submissions?q=${encodeURIComponent(modQApplied)}&sort=${modSort}&kind=${modKind}&type=${modType}`), [modQApplied, modSort, modKind, modType]);
  const approve = async (s) => { try { await api.post(`/mod/submissions/${s.id}/approve`); toast.success(t('mod.approved', 'Approved "{name}".').replace('{name}', s.item?.name)); subs.reload(); } catch { toast.error(t('mod.failed', 'Failed.')); } };
  const reject = async (s) => {
    const reason = await dialog.prompt({ title: t('mod.reject.title', 'Reject submission'), label: t('mod.reject.label', 'Reason (sent to the author)'), placeholder: t('mod.reject.ph', 'Why is this rejected?'), okLabel: t('mod.reject.ok', 'Reject'), danger: true });
    if (!reason) return;
    try { await api.post(`/mod/submissions/${s.id}/reject`, { reason }); toast.success(t('mod.rejected', 'Rejected and author notified.')); subs.reload(); } catch { toast.error(t('mod.failed', 'Failed.')); }
  };
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPERADMIN';
  const isSuperAdmin = user?.role === 'SUPERADMIN';
  const queue = subs.data?.submissions || [];
  const [review, setReview] = useState(null);
  const tabs = [
    { heading: t('adm.h.moderation', 'Moderation') },
    { id: 'moderation', label: t('adm.tab.moderation', 'Moderation'), icon: Inbox, badge: queue.length || undefined },
    { id: 'messages', label: t('adm.tab.messages', 'Messages'), icon: Mail },

    { heading: t('adm.h.users', 'Users & access') },
    { id: 'users', label: t('adm.tab.users', 'Users'), icon: Users },
    { id: 'planusers', label: t('adm.tab.planusers', 'Free vs paid'), icon: Receipt },
    isAdmin && { id: 'access', label: t('adm.tab.access', 'Access & permissions'), icon: Shield },
    isAdmin && { id: 'security', label: t('adm.tab.security', 'Security log'), icon: Lock },

    { heading: t('adm.h.repos', 'Repos & hosting') },
    { id: 'repos', label: t('adm.tab.repos', 'Server repos'), icon: Server },
    isAdmin && { id: 'hosting', label: t('adm.tab.hosting', 'Free hosting'), icon: Rocket },
    isAdmin && { id: 'promotions', label: t('adm.tab.promotions', 'Promotions & codes'), icon: Megaphone },
    isAdmin && { id: 'kofi', label: t('adm.tab.kofi', 'Ko-fi & funding'), icon: KofiIcon },
    isAdmin && { id: 'events', label: t('adm.tab.events', 'Events'), icon: Sparkles },
    isAdmin && { id: 'sso', label: t('adm.tab.sso', 'SSO / OAuth'), icon: Shield },
    isAdmin && { id: 'storage', label: t('adm.tab.storage', 'Storage'), icon: HardDrive },

    isAdmin && { heading: t('adm.h.content', 'Content') },
    isAdmin && { id: 'catalogs', label: t('adm.tab.catalogs', 'Catalogs'), icon: Boxes },
    isAdmin && { id: 'projects', label: t('adm.tab.projects', 'Projects'), icon: Settings2 },
    isAdmin && { id: 'showcase', label: t('adm.tab.showcase', 'Other projects'), icon: Sparkles },
    isAdmin && { id: 'announcements', label: t('adm.tab.announcements', 'Announcements'), icon: BellIcon },

    isAdmin && { heading: t('adm.h.server', 'Server') },
    isAdmin && { id: 'serverperf', label: t('adm.tab.serverperf', 'Server perf'), icon: Cpu },
    isAdmin && { id: 'serveradv', label: t('adm.tab.serveradv', 'Advanced server'), icon: AlertTriangle },

    isAdmin && { heading: t('adm.h.botanalytics', 'Bot & analytics') },
    isAdmin && { id: 'bot', label: t('adm.tab.bot', 'Discord bot'), icon: MessageSquare },
    isAdmin && { id: 'analytics', label: t('adm.tab.analytics', 'Analytics'), icon: TrendingUp },

    isAdmin && { heading: t('adm.h.settings', 'Settings') },
    isAdmin && { id: 'settings', label: t('adm.tab.settings', 'Settings'), icon: Sliders },
  ].filter(Boolean);
  return (
    <SideDash icon={ShieldCheck} title={t('adm.title', 'Admin')} subtitle={t('adm.subtitle', 'Moderation, catalogs, hosting, analytics and settings.')} tabs={tabs}>
      {(s) => (<>
        {s === 'moderation' && <div>
          <h2 className="font-semibold mb-3 flex items-center gap-2"><Inbox size={16} /> {t('mod.queue', 'Moderation queue')}</h2>
          <div className="flex flex-wrap gap-2 mb-3">
            <div className="relative flex-1 min-w-[200px]"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
              <Input className="!pl-9" placeholder={t('mod.search.ph', 'Search by item name, author or email…')} value={modQ} onChange={(e) => setModQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setModQApplied(modQ)} /></div>
            <Button variant="primary" onClick={() => setModQApplied(modQ)}><Search size={15} /> {t('mod.search', 'Search')}</Button>
            <Dropdown value={modKind} onChange={setModKind} options={[
              { value: '', label: t('mod.allkinds', 'All kinds') }, { value: 'APP', label: t('mod.k.app', 'App') },
              { value: 'PLUGIN', label: t('mod.k.plugin', 'Plugin') }, { value: 'THEME', label: t('mod.k.theme', 'Theme') }, { value: 'PRESET', label: t('mod.k.preset', 'Preset') },
            ]} />
            <Dropdown value={modType} onChange={setModType} options={[
              { value: '', label: t('mod.alltypes', 'All types') }, { value: 'NEW', label: t('mod.t.new', 'New') }, { value: 'UPDATE', label: t('mod.t.update', 'Update') },
            ]} />
            <Dropdown value={modSort} onChange={setModSort} options={[
              { value: 'oldest', label: t('mod.oldest', 'Oldest first') }, { value: 'newest', label: t('mod.newest', 'Newest first') },
            ]} />
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
                <Button size="sm" onClick={() => setReview(sub)}><Eye size={15} /> {t('mod.review', 'Review')}</Button>
                <Button size="sm" variant="primary" onClick={() => approve(sub)}><CheckCircle2 size={15} /> {t('mod.approve', 'Approve')}</Button>
                <Button size="sm" onClick={() => reject(sub)}><XCircle size={15} /> {t('mod.reject', 'Reject')}</Button></Card>); })}
          </div> : <EmptyState icon={CheckCircle2} title={t('mod.empty.t', 'Queue is empty')} sub={t('mod.empty.s', 'Nothing waiting for review.')} />)}
          {review && <SubmissionReview sub={review} onClose={() => setReview(null)} onApprove={() => { approve(review); setReview(null); }} onReject={() => { reject(review); setReview(null); }} reload={subs.reload} />}
        </div>}
        {s === 'messages' && <AdminMessages />}
        {s === 'users' && <AdminUsers />}
        {s === 'planusers' && <AdminPlanUsers />}
        {s === 'access' && <AdminAccess isSuperAdmin={isSuperAdmin} />}
        {s === 'security' && <AdminSecurity />}
        {s === 'serverperf' && <AdminServerPerf />}
        {s === 'serveradv' && <AdminServerAdvanced />}
        {s === 'announcements' && <AdminAnnouncements />}
        {s === 'repos' && <AdminRepos />}
        {s === 'catalogs' && <><AdminCatalogCreator /><PluginVerifier /><ThemeVerifier /></>}
        {s === 'hosting' && <AdminFreeHost />}
        {s === 'promotions' && <><AdminCampaigns /><div className="mt-8"><AdminPromo /></div></>}
        {s === 'kofi' && <AdminKofi />}
        {s === 'events' && <AdminEvents />}
        {s === 'sso' && <AdminOAuthClients />}
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
  const toast = useToast(); const { t } = useI18n();
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
      catch { toast.error(t('cc.presetinvalid', 'Preset is not valid JSON.')); }
    }
  };
  const submit = async () => {
    if (f.name.length < 2) return toast.error(t('cc.namereq', 'Name is required.'));
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
      if (f.kind === 'PLUGIN' && res.validation) toast[res.validation.valid ? 'success' : 'error'](res.validation.valid ? t('cc.pubvalidated', 'Plugin "{n}" published & validated.').replace('{n}', f.name) : t('cc.pubinvalid', 'Published but INVALID: {r} — fix before users install.').replace('{r}', res.validation.reason));
      else toast.success(t('cc.published', 'Official {k} "{n}" published.').replace('{k}', KIND_LABEL[f.kind]).replace('{n}', f.name));
      setF({ projectKey: f.projectKey, kind: f.kind, name: '', version: '1.0.0', description: '', tags: '', url: '' }); setFile(null);
    } catch (x) { toast.error(x.data?.error === 'invalid_preset' ? t('cc.presetjsoninvalid', 'Preset JSON is invalid.') : x.data?.error || t('common.failed', 'Failed.')); } finally { setBusy(false); }
  };
  const copy = () => { navigator.clipboard?.writeText(deeplink); toast.success(t('cc.dlcopied', 'Deeplink copied.')); };

  return (
    <div>
      <h2 className="font-semibold mb-1 flex items-center gap-2"><BadgeCheck size={16} className="text-[var(--primary-2)]" /> {t('cc.title', 'Create an official catalog entry')}</h2>
      <p className="text-sm text-[var(--muted)] mb-4" dangerouslySetInnerHTML={{ __html: t('cc.sub', 'Publishes instantly (no moderation) and is flagged <b>Official</b>. BSM offers presets; BMM offers apps, plugins and themes with a <code>bmm://</code> deeplink.') }} />
      <Card className="p-5 space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label={t('cc.project', 'Project')}><Select value={f.projectKey} onChange={(e) => setProject(e.target.value)}><option value="bmm">BMM</option><option value="bsm">BSM</option></Select></Field>
          <Field label={t('cc.type', 'Type')}><Dropdown className="w-full" value={f.kind} onChange={(v) => setF({ ...f, kind: v })} options={kinds.map((k) => ({ value: k, label: KIND_LABEL[k] }))} /></Field>
          <Field label={t('cc.name', 'Name')}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={f.kind === 'PRESET' ? 'Afterburner Boom' : f.kind === 'THEME' ? 'Midnight Orange' : 'Auto Backup'} /></Field>
          <Field label={t('cc.version', 'Version')}><Input value={f.version} onChange={(e) => setF({ ...f, version: e.target.value })} /></Field>
        </div>
        <Field label={t('cc.description', 'Description')}><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder={t('cc.descph', 'What it does, in a sentence or two…')} /></Field>
        <Field label={t('cc.tags', 'Tags (comma-separated)')}><Input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} placeholder="audio, utility, dark-theme" /></Field>
        {f.kind === 'PLUGIN' && <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-2.5 text-xs text-[var(--muted)]" dangerouslySetInnerHTML={{ __html: t('cc.pluginnote', "Host the <code>.bmmplug</code> yourself (URL below) or with us (upload it — priced by size). Either way it's checksum-validated on publish.") }} />}
        {f.kind !== 'PRESET' && <Field label={f.kind === 'PLUGIN' ? t('cc.plugurl', '.bmmplug URL (self-hosted)') : t('cc.dlurl', 'Download URL')} hint={f.kind === 'PLUGIN' ? t('cc.plugurlhint', 'GitHub raw / personal server. Leave empty to host with us via upload.') : t('cc.dlurlhint', 'Where the app/theme is fetched from.')}><Input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder={f.kind === 'PLUGIN' ? 'https://raw.githubusercontent.com/you/repo/main/plugin.bmmplug' : 'https://github.com/you/repo/releases/latest/download/app.zip'} /></Field>}
        <Field label={f.kind === 'PRESET' ? t('cc.presetfile', 'Preset .json (metadata is read from the file)') : f.kind === 'PLUGIN' ? t('cc.plugfile', '.bmmplug file (our-hosted — priced by size)') : t('cc.payloadfile', 'Payload file (optional — zip / wasm)')}>
          <Input type="file" accept={f.kind === 'PRESET' ? '.json,application/json' : f.kind === 'PLUGIN' ? '.bmmplug,.zip' : undefined} onChange={(e) => onFile(e.target.files?.[0] || null)} /></Field>
        {deeplink && (
          <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)] mb-1 flex items-center gap-1"><Link2 size={11} /> {t('cc.deeplink', 'BMM deeplink')}</div>
            <div className="flex items-center gap-2"><code className="text-xs text-[var(--muted)] truncate flex-1">{deeplink}</code><Button size="sm" onClick={copy}><Copy size={13} /></Button></div>
          </div>
        )}
        <div className="flex justify-end"><Button variant="primary" disabled={busy} onClick={submit}>{busy ? <Spinner /> : <><BadgeCheck size={15} /> {t('cc.publish', 'Publish official')}</>}</Button></div>
      </Card>
    </div>
  );
}

// Admin: verify plugin integrity — validate (download+unzip+checksum), inspect content.
function PluginVerifier() {
  const toast = useToast(); const { t } = useI18n();
  const { data, loading, reload } = useAsync(() => api.get('/admin/catalog?kind=PLUGIN'), []);
  const [content, setContent] = useState(null);
  const items = data?.items || [];
  const validate = async (it) => { try { const r = await api.post(`/admin/catalog/${it.id}/validate`); toast[r.valid ? 'success' : 'error'](r.valid ? t('pv.isvalid', '"{n}" is valid.').replace('{n}', it.name) : t('pv.isinvalid', '"{n}" INVALID: {r}').replace('{n}', it.name).replace('{r}', r.reason)); reload(); } catch (x) { toast.error(x.data?.detail || t('pv.valfail', 'Validation failed.')); } };
  const dl = async (it) => { try { const { url } = await api.get(`/admin/catalog/${it.id}/file`); window.open(url, '_blank'); } catch { toast.error(t('pv.nofile', 'This plugin has no downloadable file.')); } };
  return (
    <div className="mt-10">
      <h2 className="font-semibold mb-1 flex items-center gap-2"><ShieldCheck size={16} className="text-[var(--primary-2)]" /> {t('pv.title', 'Plugin verification')}</h2>
      <p className="text-sm text-[var(--muted)] mb-4" dangerouslySetInnerHTML={{ __html: t('pv.sub', 'Download the <code>.bmmplug</code>, unzip it, and verify the package + per-file checksums. Invalid plugins warn users not to install.') }} />
      {loading ? <Loading /> : items.length ? <div className="space-y-2">
        {items.map((it) => { const v = it.meta?.validation; return (
          <Card key={it.id} className="p-4 flex items-center gap-3 flex-wrap">
            <Puzzle size={17} className="text-[var(--primary-2)]" />
            <div className="flex-1 min-w-0"><div className="font-medium truncate">{it.name} <span className="text-xs text-[var(--faint)] font-normal">v{it.version} · {it.owner?.displayName}</span></div>
              <div className="text-xs text-[var(--faint)] mt-0.5">{it.meta?.download_url ? t('pv.selfhosted', 'self-hosted') : it.payloadKey ? t('pv.ourhosted', 'our-hosted') : t('pv.nosource', 'no source')}{v?.sha256 ? ` · ${v.sha256.slice(0, 12)}…` : ''}</div></div>
            {v ? (v.valid ? <Badge tone="green"><CheckCircle2 size={11} /> {t('pv.valid', 'Valid')}</Badge> : <Badge tone="red"><XCircle size={11} /> {v.reason}</Badge>) : <Badge>{t('pv.unchecked', 'Unchecked')}</Badge>}
            <Button size="sm" onClick={() => validate(it)}><ShieldCheck size={14} /> {t('pv.validate', 'Validate')}</Button>
            {(it.payloadKey || it.meta?.download_url) && <Button size="sm" onClick={() => dl(it)}><Download size={14} /> {t('pv.download', 'Download')}</Button>}
            <Button size="sm" onClick={() => setContent(it)}><Files size={14} /> {t('pv.content', 'Content')}</Button>
          </Card>); })}
      </div> : <EmptyState icon={Puzzle} title={t('pv.empty', 'No plugins yet')} />}
      {content && <PluginContentModal item={content} onClose={() => setContent(null)} />}
    </div>
  );
}

// Admin: theme verification — download & inspect a theme's JSON before it goes live.
function ThemeVerifier() {
  const toast = useToast(); const { t } = useI18n();
  const { data, loading } = useAsync(() => api.get('/admin/catalog?kind=THEME'), []);
  const items = data?.items || [];
  const dl = async (it) => { try { const { url } = await api.get(`/admin/catalog/${it.id}/file`); window.open(url, '_blank'); } catch { toast.error(t('tv.nofile', 'This theme has no downloadable file.')); } };
  return (
    <div className="mt-10">
      <h2 className="font-semibold mb-1 flex items-center gap-2"><Palette size={16} className="text-[var(--primary-2)]" /> {t('tv.title', 'Theme verification')}</h2>
      <p className="text-sm text-[var(--muted)] mb-4">{t('tv.sub', "Download and inspect a theme's JSON before it goes live. Themes are served as data, never executed.")}</p>
      {loading ? <Loading /> : items.length ? <div className="space-y-2">
        {items.map((it) => (
          <Card key={it.id} className="p-4 flex items-center gap-3 flex-wrap">
            <Palette size={17} className="text-[var(--primary-2)]" />
            <div className="flex-1 min-w-0"><div className="font-medium truncate">{it.name} <span className="text-xs text-[var(--faint)] font-normal">v{it.version} · {it.owner?.displayName}</span></div>
              <div className="text-xs text-[var(--faint)] mt-0.5">{it.meta?.url || it.meta?.download_url ? t('pv.selfhosted', 'self-hosted') : it.payloadKey ? t('pv.ourhosted', 'our-hosted') : t('pv.nosource', 'no source')}</div></div>
            <Badge tone={statusTone(it.status)}>{it.status}</Badge>
            {(it.payloadKey || it.meta?.url || it.meta?.download_url) && <Button size="sm" onClick={() => dl(it)}><Download size={14} /> {t('pv.download', 'Download')}</Button>}
          </Card>
        ))}
      </div> : <EmptyState icon={Palette} title={t('tv.empty', 'No themes yet')} />}
    </div>
  );
}

// Admin: find a user by id / display name / email / linked creator id, then inspect them.
function AdminUsers() {
  const { t } = useI18n();
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
      <h2 className="font-semibold mb-1 flex items-center gap-2"><Users size={16} className="text-[var(--primary-2)]" /> {t('au.title', 'User search')}</h2>
      <p className="text-sm text-[var(--muted)] mb-4">{t('au.desc', 'Search by user id, Unique BC id (BC-XXXX-XXXX), display name, email, a linked creator id, or a linked Discord (username / id). Click a user to see full details.')}</p>
      <div className="flex gap-2 mb-5">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
          <Input className="!pl-9" placeholder={t('au.search.ph', 'id / display name / email / creator id / Discord…')} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
        </div>
        <Button variant="primary" disabled={busy} onClick={search}>{busy ? <Spinner /> : <><Search size={15} /> {t('au.search', 'Search')}</>}</Button>
      </div>
      {results === null ? <EmptyState icon={Users} title={t('au.find.t', 'Find a user')} sub={t('au.find.s', 'Enter a term above to search.')} />
        : results.length ? <div className="space-y-2">
          {results.map((u) => (
            <button key={u.id} onClick={() => setDetail(u.id)} className="w-full text-left card card-hover p-4 flex items-center gap-3">
              <Avatar user={u} size={40} />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate flex items-center gap-2">{u.displayName} <Badge tone={u.role === 'SUPERADMIN' ? 'red' : u.role === 'ADMIN' ? 'amber' : u.role === 'MOD' ? 'primary' : ''}>{u.role}</Badge></div>
                <div className="text-xs text-[var(--faint)] truncate">{u.email} · {t('au.since', 'since')} {since(u.createdAt)}</div>
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
                {u.creatorIds.length > 0 && <Badge tone="green">{t('au.creatorids', '{n} creator id(s)').replace('{n}', u.creatorIds.length)}</Badge>}
                {u.discord && <Badge tone="primary"><DiscordIcon size={10} /> {t('au.discord', 'Discord')}</Badge>}
              </div>
            </button>
          ))}
          {hasMore && <div className="text-center pt-1"><Button variant="ghost" disabled={busy} onClick={() => load(q, true)}>{busy ? <Spinner /> : t('au.loadmore', 'Load more')}</Button></div>}
        </div> : <EmptyState icon={XCircle} title={t('au.none.t', 'No users found')} sub={t('au.none.s', 'Try a different id, name, email or creator id.')} />}
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
  const { t } = useI18n(); const toast = useToast();
  const [sp] = useSearchParams();
  const [tab, setTab] = useState('paying');
  const [results, setResults] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [includeStaff, setIncludeStaff] = useState(false);
  const [mrr, setMrr] = useState(null); // { totalCents, subCount, annualCents }
  const [q, setQ] = useState(''); const [qApplied, setQApplied] = useState('');
  const load = async (append = false) => {
    setBusy(true);
    try {
      const skip = append ? (results?.length || 0) : 0;
      const { users, hasMore: more, mrr: m } = await api.get(`/admin/billing/users?tab=${tab}&skip=${skip}&take=30${includeStaff ? '&includeStaff=1' : ''}${qApplied ? `&q=${encodeURIComponent(qApplied)}` : ''}`);
      setResults(append ? [...(results || []), ...users] : users); setHasMore(more); if (m) setMrr(m);
    } catch { if (!append) setResults([]); } finally { setBusy(false); }
  };
  const mrrMoney = (c) => `$${((c || 0) / 100).toFixed(2)}`;
  useEffect(() => { load(false); setExpanded(null); /* eslint-disable-next-line */ }, [tab, includeStaff, qApplied]);
  // Deep-link from the Discord payment embed: /admin?s=planusers&user=<id> opens that
  // customer's detail straight away.
  useEffect(() => { const u = sp.get('user'); if (u) setDetail(u); /* eslint-disable-next-line */ }, []);
  const since = (d) => new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const emptyCopy = [t(`pu.empty.${tab}.t`, ''), t(`pu.empty.${tab}.s`, '')];
  return (
    <div>
      <h2 className="font-semibold mb-1 flex items-center gap-2"><Receipt size={16} className="text-[var(--primary-2)]" /> {t('pu.title', 'Free vs paid')}</h2>
      <p className="text-sm text-[var(--muted)] mb-3">{t('pu.desc', "What every customer currently has active: free-tier hosting, paid hosting/boosts, or expired/ended terms. Click a row to see the detail; click the user's name for their full profile.")}</p>
      {mrr && (
        <div className="grid sm:grid-cols-3 gap-3 mb-4">
          <Card className="p-4"><div className="text-xs text-[var(--faint)] flex items-center gap-1.5 mb-1"><RefreshCw size={12} className="text-emerald-400" /> {t('pu.mrr', 'Monthly recurring revenue')}</div><div className="text-2xl font-bold text-emerald-400 tabular-nums">{mrrMoney(mrr.totalCents)}<span className="text-sm font-normal text-[var(--faint)]">/{t('pu.mo', 'mo')}</span></div></Card>
          <Card className="p-4"><div className="text-xs text-[var(--faint)] flex items-center gap-1.5 mb-1"><TrendingUp size={12} className="text-[var(--primary-2)]" /> {t('pu.arr', 'Annualized (est.)')}</div><div className="text-2xl font-bold tabular-nums">{mrrMoney(mrr.annualCents)}<span className="text-sm font-normal text-[var(--faint)]">/{t('pu.yr', 'yr')}</span></div></Card>
          <Card className="p-4"><div className="text-xs text-[var(--faint)] flex items-center gap-1.5 mb-1"><CreditCard size={12} className="text-[var(--primary-2)]" /> {t('pu.activesubs', 'Active subscriptions')}</div><div className="text-2xl font-bold tabular-nums">{mrr.subCount}</div></Card>
        </div>
      )}
      <div className="flex flex-wrap gap-2 items-center mb-3">
        <div className="relative flex-1 min-w-[200px]"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
          <Input className="!pl-8 !py-1.5 !text-sm" placeholder={t('pu.search', 'Search a customer — name, email, creator id…')} value={q}
            onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setQApplied(q.trim())} /></div>
        <Button size="sm" onClick={() => setQApplied(q.trim())}>{t('pu.searchbtn', 'Search')}</Button>
        {qApplied && <Button size="sm" variant="ghost" onClick={() => { setQ(''); setQApplied(''); }}><X size={13} /> {t('pu.clear', 'Clear')}</Button>}
      </div>
      <label className="flex items-center gap-2 text-xs text-[var(--muted)] mb-4 cursor-pointer w-fit">
        <input type="checkbox" checked={includeStaff} onChange={(e) => setIncludeStaff(e.target.checked)} /> {t('pu.includestaff', 'Include staff (admins/mods) — normally excluded from this customer report')}
      </label>
      <div className="flex gap-2 mb-4">
        {PLANUSERS_TABS.map(([id, I, label]) => (
          <button key={id} onClick={() => setTab(id)} className={`flex-1 px-3 py-2 rounded-xl text-sm font-medium border transition ${tab === id ? 'bg-[var(--surface-2)] border-[var(--line)] text-[var(--text)]' : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'}`}>
            <I size={14} className="inline mr-1.5 -mt-0.5" /> {t(`pu.tab.${id}`, label)}</button>
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
              {tab === 'paying' && (u.totalSpentCents != null || u.mrrCents > 0) && (
                <div className="text-xs text-right shrink-0">
                  {u.mrrCents > 0 && <div className="text-sm font-semibold text-emerald-400">{mrrMoney(u.mrrCents)}<span className="text-[var(--faint)] font-normal">/{t('pu.mo', 'mo')}</span></div>}
                  {u.totalSpentCents != null && <div className="text-[var(--faint)]">{t('pu.spent', '{n} spent').replace('{n}', mrrMoney(u.totalSpentCents))} · {t('pu.payments', '{n} payment(s)').replace('{n}', u.paymentCount)}</div>}
                </div>
              )}
              <Badge className="shrink-0">{t('pu.active', '{n} active').replace('{n}', u.active.length)}</Badge>
              <ChevronDown size={15} className={`shrink-0 text-[var(--faint)] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            {isOpen && (
              <div className="px-4 pb-4 pt-1 space-y-1.5 border-t border-[var(--line)]">
                {u.active.map((a, i) => {
                  // Back-compat: tolerate a plain-string entry (old API shape).
                  if (typeof a === 'string') return (
                    <div key={i} className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-[var(--surface-2)]"><span className="truncate">{a}</span></div>
                  );
                  const TypeIcon = a.type === 'subscription' ? RefreshCw : a.type === 'boost' ? Star : a.type === 'catalog' ? Package : Server;
                  const money = (c, cur) => { const C = (cur || 'usd').toUpperCase(); const s = C === 'USD' ? '$' : C === 'EUR' ? '€' : C === 'GBP' ? '£' : ''; return s ? `${s}${(c / 100).toFixed(2)}` : `${(c / 100).toFixed(2)} ${C}`; };
                  const bits = [];
                  if (a.type === 'hosting' && a.specs) bits.push(`${a.specs.storageGB} GB · ${a.specs.uploadMbps} Mbps`);
                  if (a.type === 'boost' && a.featuredUntil) bits.push(`${t('pu.d.until', 'until')} ${since(a.featuredUntil)}`);
                  if (a.type === 'catalog') bits.push(`${a.kind || ''}${a.sizeMB != null ? ` · ${a.sizeMB} MB` : ''}`.trim());
                  if (a.type === 'subscription') { const per = a.intervalCount > 1 ? `/${a.intervalCount} ${a.interval}` : `/${a.interval}`; bits.push(`${money(a.amountCents, a.currency)} ${per}`); if (a.currentPeriodEnd) bits.push(`${t('bill.sub.renews', 'Renews {d}').replace('{d}', since(a.currentPeriodEnd))}`); }
                  if (a.status) bits.push(a.status);
                  if (a.deleteAt) bits.push(`${t('pu.d.deletes', 'deletes')} ${since(a.deleteAt)}`);
                  return (
                    <div key={i} className="flex items-start gap-2.5 text-sm px-3 py-2 rounded-lg bg-[var(--surface-2)]">
                      <TypeIcon size={14} className={`shrink-0 mt-0.5 ${a.paid ? 'text-emerald-400' : 'text-[var(--primary-2)]'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium truncate">{a.name || a.label}</span>
                          <Badge tone={a.paid ? 'green' : ''}>{a.paid ? t('pu.d.paid', 'paid') : t('pu.d.free', 'free')}</Badge>
                          {a.repoId && <a href={`/repo/${a.repoId}`} target="_blank" rel="noreferrer" className="text-[var(--primary-2)] hover:underline text-xs inline-flex items-center gap-0.5">{t('pu.d.open', 'open')} <ArrowUpRight size={11} /></a>}
                        </div>
                        {bits.length > 0 && <div className="text-xs text-[var(--faint)] mt-0.5">{bits.join(' · ')}</div>}
                        {a.spend && a.spend.spentCents > 0 && (
                          <div className="text-xs text-emerald-400/90 mt-0.5">{money(a.spend.spentCents, a.spend.currency)} {t('pu.d.acrosspay', 'across {n} payment(s)').replace('{n}', a.spend.count)}{a.spend.lastAt ? ` · ${t('pu.last', 'last')} ${since(a.spend.lastAt)}` : ''}</div>
                        )}
                        {a.spend?.invoiceNos?.length > 0 && (
                          <div className="text-[11px] text-[var(--faint)] mt-0.5 flex items-center gap-1.5 flex-wrap"><Receipt size={10} className="shrink-0" /> {t('pu.d.invoices', 'Invoices:')}
                            {a.spend.invoiceNos.slice(-3).map((n) => (
                              <button key={n} onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(n); toast.success(t('common.copied', 'Copied.')); }} className="font-mono hover:text-[var(--primary-2)]" title={t('common.copy', 'Copy')}>{n}</button>
                            ))}
                            {a.spend.invoiceNos.length > 3 && <span>+{a.spend.invoiceNos.length - 3}</span>}
                          </div>
                        )}
                        {a.type === 'subscription' && a.mrrCents > 0 && (
                          <div className="text-xs text-emerald-400/90 mt-0.5">≈ {money(a.mrrCents, a.currency)} {t('pu.permo', 'per month')}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
          ); })}
        {hasMore && <div className="text-center pt-1"><Button variant="ghost" disabled={busy} onClick={() => load(true)}>{busy ? <Spinner /> : t('pu.loadmore', 'Load more')}</Button></div>}
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
  const { t } = useI18n();
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
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('gap.accsearch', 'id / display name / creator id / Discord…')} onKeyDown={(e) => e.key === 'Enter' && search()} />
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
          )) : <div className="text-[11px] text-[var(--faint)] px-1">{t('gap.noaccounts', 'No accounts found.')}</div>}
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
  const { t } = useI18n();
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
    try { await api.put('/admin/access-policy', policy); toast.success(t('gap.saved', 'Global access policy saved.')); reload(); }
    catch { toast.error(t('gap.savefail', 'Failed to save.')); } finally { setBusy(false); }
  };

  return (
    <Card className="p-5 space-y-4">
      <div>
        <h2 className="font-semibold mb-1 flex items-center gap-2"><Globe size={16} className="text-[var(--primary-2)]" /> {t('gap.title', 'Global access policy')}</h2>
        <p className="text-sm text-[var(--muted)]">{t('gap.desc', "Applied identically to every hosted repo, on top of each owner's own settings — a ban here blocks a client everywhere; the whitelist here is added to whichever repos require one.")}</p>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={policy.whitelistOnly} onChange={(e) => setPolicy({ ...policy, whitelistOnly: e.target.checked })} /> {t('gap.wlonly', 'Whitelist-only for ALL repos (forces every hosted repo into whitelist mode, site-wide)')}</label>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] flex items-center gap-1.5"><Shield size={12} className="text-emerald-400" /> {t('gap.whitelist', 'Whitelist')}</div>
          <PolicyChipList label={t('gap.ips', 'IPs')} items={policy.whitelistIps || []} onAdd={(v) => addTo('whitelistIps', v)} onRemove={(v) => rm('whitelistIps', v)} placeholder="203.0.113.4" />
          <PolicyChipList label={t('gap.creatorid', 'Creator ID')} items={policy.whitelistKeys || []} onAdd={(v) => addTo('whitelistKeys', v)} onRemove={(v) => rm('whitelistKeys', v)} placeholder="BMM creator id…" />
          <PolicyAccountChips label={t('gap.accounts', 'Accounts')} items={policy.whitelistAccounts || []} onAdd={(e) => addAccount('whitelistAccounts', e)} onRemove={(e) => rmAccount('whitelistAccounts', e)} />
        </div>
        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] flex items-center gap-1.5"><Ban size={12} className="text-red-400" /> {t('gap.blacklist', 'Blacklist')}</div>
          <PolicyChipList label={t('gap.ips', 'IPs')} items={policy.bannedIps || []} onAdd={(v) => addTo('bannedIps', v)} onRemove={(v) => rm('bannedIps', v)} placeholder="198.51.100.7" />
          <PolicyChipList label={t('gap.creatorid', 'Creator ID')} items={policy.bannedKeys || []} onAdd={(v) => addTo('bannedKeys', v)} onRemove={(v) => rm('bannedKeys', v)} placeholder="BMM creator id…" />
          <PolicyAccountChips label={t('gap.accounts', 'Accounts')} items={policy.bannedAccounts || []} onAdd={(e) => addAccount('bannedAccounts', e)} onRemove={(e) => rmAccount('bannedAccounts', e)} />
        </div>
      </div>
      <div className="flex justify-end"><Button variant="primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : t('gap.save', 'Save global policy')}</Button></div>
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
  const { t } = useI18n();
  const [tab, setTab] = useState('logins');
  const [q, setQ] = useState('');
  const [loginFilter, setLoginFilter] = useState('all'); // all | success | failed | suspicious
  const [hours, setHours] = useState('168');
  const logins = useAsync(() => api.get(`/admin/security/logins?hours=${hours}`), [hours]);
  const audit = useAsync(() => api.get(`/admin/security/audit?hours=${hours}`), [hours]);
  const [verify, setVerify] = useState(null); // null | 'checking' | { ok, total, checked, legacy, firstBreak }
  const runVerify = async () => { setVerify('checking'); try { setVerify(await api.get('/admin/security/audit/verify')); } catch { setVerify({ error: true }); } };
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
      <h2 className="font-semibold mb-1 flex items-center gap-2"><Lock size={16} className="text-[var(--primary-2)]" /> {t('sec.title', 'Security log')}</h2>
      <p className="text-sm text-[var(--muted)] mb-3">{t('sec.desc', 'Login attempts (success/fail, IP) and the admin action audit trail.')}</p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <Card className="p-3"><div className="text-[var(--faint)] text-xs mb-1">{t('sec.attempts', 'Attempts')}</div><div className="text-xl font-bold tabular-nums">{attempts.length}</div></Card>
        <Card className="p-3"><div className="text-[var(--faint)] text-xs mb-1">{t('sec.failedn', 'Failed')}</div><div className="text-xl font-bold tabular-nums text-red-400">{failedCount}</div></Card>
        <Card className="p-3"><div className="text-[var(--faint)] text-xs mb-1">{t('sec.uniqueips', 'Unique IPs')}</div><div className="text-xl font-bold tabular-nums">{uniqueIps}</div></Card>
        <Card className="p-3"><div className="text-[var(--faint)] text-xs mb-1 flex items-center gap-1"><AlertTriangle size={11} className={suspiciousIps.size ? 'text-red-400' : ''} /> {t('sec.suspicious', 'Suspicious IPs')}</div><div className={`text-xl font-bold tabular-nums ${suspiciousIps.size ? 'text-red-400' : ''}`}>{suspiciousIps.size}</div></Card>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div className="flex gap-2">
          <button onClick={() => setTab('logins')} className={`px-3 py-1.5 rounded-lg border text-sm ${tab === 'logins' ? 'border-[var(--primary)] bg-orange-500/10' : 'border-[var(--line)] text-[var(--muted)]'}`}>{t('sec.tab.logins', 'Login attempts')}</button>
          <button onClick={() => setTab('audit')} className={`px-3 py-1.5 rounded-lg border text-sm ${tab === 'audit' ? 'border-[var(--primary)] bg-orange-500/10' : 'border-[var(--line)] text-[var(--muted)]'}`}>{t('sec.tab.audit', 'Admin audit trail')}</button>
        </div>
        <div className="flex gap-1">
          {SECURITY_RANGES.map(([h, label]) => (
            <button key={h} onClick={() => setHours(h)} className={`px-2.5 py-1 rounded-lg border text-xs ${hours === h ? 'border-[var(--primary)] text-[var(--primary-2)]' : 'border-[var(--line)] text-[var(--faint)] hover:text-[var(--text)]'}`}>{label}</button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <div className="relative flex-1 min-w-[200px]"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
          <Input className="!pl-9" placeholder={tab === 'logins' ? t('sec.search.logins', 'Search email, IP or account…') : t('sec.search.audit', 'Search actor, action, detail or IP…')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {tab === 'logins' && (
          <Select className="!w-auto" value={loginFilter} onChange={(e) => setLoginFilter(e.target.value)}>
            <option value="all">{t('sec.f.all', 'All outcomes')}</option><option value="success">{t('sec.f.success', 'Success only')}</option><option value="failed">{t('sec.f.failed', 'Failed only')}</option><option value="suspicious">{t('sec.f.suspicious', 'Suspicious IPs only')}</option>
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
                <div className="truncate"><button onClick={() => setQ(a.email)} className="font-medium hover:text-[var(--primary-2)]">{a.email}</button> {a.user && <span className="text-xs text-[var(--faint)]">· {a.user.displayName} ({a.user.role})</span>} {suspiciousIps.has(a.ip) && <Badge tone="red" className="ml-1">{t('sec.bruteforce', 'Brute-force?')}</Badge>}</div>
                <div className="text-[11px] text-[var(--faint)] font-mono"><button onClick={() => setQ(a.ip)} className="hover:text-[var(--primary-2)]">{a.ip}</button> {a.reason ? `· ${a.reason}` : ''}</div>
              </div>
              <span className="text-[11px] text-[var(--faint)] shrink-0">{new Date(a.createdAt).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </Card> : <EmptyState icon={Lock} title={attempts.length ? t('sec.nomatch', 'No matches') : t('sec.none.logins', 'No login attempts in this range')} />)}
      {tab === 'audit' && (
        <Card className="p-3 mb-3 flex items-center gap-3 flex-wrap">
          <ShieldCheck size={16} className="text-emerald-400 shrink-0" />
          <div className="flex-1 min-w-[180px] text-sm">
            <div className="font-medium">{t('sec.tamper.title', 'Tamper-evident log')}</div>
            <div className="text-[11px] text-[var(--faint)]">{t('sec.tamper.desc', 'Every staff action is HMAC-chained — edits or deletions are detectable. Sensitive actions (file downloads, DB writes, power) are anchored off-DB (catches truncation) and alert SUPERADMINs.')}</div>
          </div>
          {verify && verify !== 'checking' && !verify.error && (() => {
            const brk = verify.firstBreak || verify.anchorBreak;
            const reasonLabel = { content_altered: t('sec.r.content', 'Content altered'), chain_broken: t('sec.r.chain', 'Chain broken'), anchored_entry_deleted: t('sec.r.truncated', 'Log truncated'), anchored_entry_altered: t('sec.r.anchored', 'Anchored entry altered') }[brk?.reason] || t('sec.r.tampered', 'Tampered');
            return verify.ok
              ? <Badge tone="green" className="flex items-center gap-1"><CheckCircle2 size={12} /> {t('sec.intact', 'Intact')} · {verify.checked} {t('sec.chained', 'chained')}{verify.anchorsChecked ? ` · ${verify.anchorsChecked} ${t('sec.anchored', 'anchored')}` : ''}{verify.legacy ? ` (+${verify.legacy} ${t('sec.legacy', 'legacy')})` : ''}</Badge>
              : <Badge tone="red" className="flex items-center gap-1"><AlertTriangle size={12} /> {reasonLabel}{brk?.at ? ` @ ${new Date(brk.at).toLocaleString()}` : ''}</Badge>;
          })()}
          {verify?.error && <Badge tone="red">{t('sec.verify.failed', 'Verify failed')}</Badge>}
          <Button size="sm" variant="ghost" disabled={verify === 'checking'} onClick={runVerify}>{verify === 'checking' ? <Spinner /> : <><ShieldCheck size={13} /> {t('sec.verify', 'Verify integrity')}</>}</Button>
        </Card>
      )}
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
      </Card> : <EmptyState icon={Shield} title={entries.length ? t('sec.nomatch', 'No matches') : t('sec.none.audit', 'No audit entries in this range')} />)}
    </div>
  );
}

// A compact multi-line SVG chart for cpu/mem/disk % history — same hand-rolled
// approach as the repo dashboard's traffic chart (no charting library dependency).
function MetricChart({ history }) {
  const [wrapRef, W] = useElementWidth(760); const H = 200; const padL = 32; const padR = 8; const padY = 16;
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
    <div ref={wrapRef} className="w-full">
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="192" preserveAspectRatio="none" className="cursor-crosshair" onMouseMove={onMove} onMouseLeave={() => setHoverIdx(null)}>
      {/* Danger band: anything above 90% is tinted red so sustained pressure is obvious. */}
      <rect x={padL} y={y(100)} width={W - padL - padR} height={y(90) - y(100)} fill="#f87171" opacity="0.08" />
      <line x1={padL} x2={W - padR} y1={y(90)} y2={y(90)} stroke="#f87171" strokeWidth={1} strokeDasharray="4 3" opacity="0.5" />
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
    </div>
  );
}

// Utilisation thresholds → tone. Disk fills slowly so its "warn" is higher; CPU/RAM
// spike, so they warn earlier. Used to colour the KPI cards and the health summary.
const PERF_THRESH = { cpuPct: [75, 90], memPct: [80, 92], diskPct: [85, 95], loadRatio: [1, 1.5] };
const toneFor = (v, [warn, crit]) => v == null ? '' : v >= crit ? 'crit' : v >= warn ? 'warn' : 'ok';
const TONE_TEXT = { ok: 'text-emerald-400', warn: 'text-amber-400', crit: 'text-red-400', '': '' };
const TONE_STROKE = { ok: '#34d399', warn: '#f59e0b', crit: '#f87171', '': 'var(--primary)' };
// kbit/s → a readable rate (Mb/s above 1000, else kb/s).
const fmtKbps = (k) => k == null ? '—' : k >= 1000 ? `${(k / 1000).toFixed(1)} Mb/s` : `${Math.round(k)} kb/s`;

// Server performance dashboard — read-only (no dangerous action lives here, so no
// step-up 2FA required). CPU/RAM/disk/latency/uptime are sampled from INSIDE this
// container every ~10 min by the sweeper (monitor.mjs); a per-container/per-service
// breakdown with restart controls would need Docker-socket access, which is a
// separate, bigger ask (see the "Advanced server management" tab).
function AdminServerPerf() {
  const toast = useToast();
  const { t } = useI18n();
  const { data, loading, reload } = useAsync(() => api.get('/admin/server/metrics'), []);
  const alerts = useAsync(() => api.get('/admin/server/alerts'), []);
  const depsCfg = useAsync(() => api.get('/admin/server/deps-config'), []);
  const [busy, setBusy] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const [depsBusy, setDepsBusy] = useState(false);
  // Live network rate: diff the cumulative rx/tx byte counters between two 30s refreshes.
  const netPrevRef = useRef(null);
  const [liveNet, setLiveNet] = useState({ rx: null, tx: null });
  const [sec, setSec] = useState({ alloc: true, downtime: true, alerts: true }); // collapsible sections
  const toggleSec = (k) => setSec((s) => ({ ...s, [k]: !s[k] }));
  useEffect(() => {
    const cur = data?.net; if (!cur) return;
    const prev = netPrevRef.current;
    if (prev && cur.at > prev.at) {
      const dt = (cur.at - prev.at) / 1000;
      setLiveNet({ rx: Math.max(0, Math.round((cur.rx - prev.rx) * 8 / 1000 / dt)), tx: Math.max(0, Math.round((cur.tx - prev.tx) * 8 / 1000 / dt)) });
    }
    netPrevRef.current = cur;
  }, [data?.net?.at]);
  // Auto-refresh the read-only metrics + alerts every 30s (cheap — deps/SSL config,
  // which rarely changes, is NOT re-polled). Keeps the dashboard live between samples.
  useEffect(() => { const id = setInterval(() => { reload(); alerts.reload(); }, 30_000); return () => clearInterval(id); /* eslint-disable-next-line */ }, []);
  const sampleNow = async () => {
    setBusy(true);
    try { await api.post('/admin/server/sample-now'); toast.success(t('sp.sampled', 'Sampled.')); reload(); alerts.reload(); } catch { toast.error(t('sp.failed', 'Failed.')); } finally { setBusy(false); }
  };
  const toggleDep = async (key, on) => {
    setDepsBusy(true);
    try { await api.put('/admin/server/deps-config', { [key]: on }); depsCfg.reload(); reload(); } catch { toast.error(t('sp.failed', 'Failed.')); } finally { setDepsBusy(false); }
  };
  // Only blank to a spinner on the FIRST load — during the 30s background refresh keep
  // showing the current data (otherwise the whole tab flashes empty every 30s).
  if (loading && !data) return <Loading />;
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
  // Per-metric tone (green/amber/red) + an overall health rollup = the worst of them.
  const loadRatio = latest && totals.cpuCores ? latest.loadAvg1 / totals.cpuCores : null;
  const cpuTone = toneFor(latest?.cpuPct, PERF_THRESH.cpuPct), memTone = toneFor(latest?.memPct, PERF_THRESH.memPct), diskTone = toneFor(latest?.diskPct, PERF_THRESH.diskPct), loadTone = toneFor(loadRatio, PERF_THRESH.loadRatio);
  const worst = [cpuTone, memTone, diskTone, loadTone];
  const health = !latest ? null : worst.includes('crit') ? 'crit' : worst.includes('warn') ? 'warn' : 'ok';
  const healthLabel = { ok: t('sp.health.ok', 'Healthy'), warn: t('sp.health.warn', 'Under load'), crit: t('sp.health.crit', 'Critical') }[health];
  // Per-metric sparklines from the sampled history (oldest→newest).
  const spark = (key) => history.map((h) => h[key]).filter((v) => v != null);
  const kpi = (label, value, Icon, tone, sparkKey) => (
    <Card className="p-3 relative overflow-hidden">
      {sparkKey && spark(sparkKey).length > 1 && <Sparkline data={spark(sparkKey)} stroke={TONE_STROKE[tone]} className="absolute inset-x-0 bottom-0 h-8 w-full opacity-60 pointer-events-none" />}
      <div className="relative">
        <div className="flex items-center gap-2 text-[var(--faint)] text-xs mb-1"><Icon size={13} /> {label}</div>
        <div className={`text-xl font-bold tabular-nums ${TONE_TEXT[tone] || ''}`}>{value}</div>
      </div>
    </Card>
  );
  return (
    <div>
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <h2 className="font-semibold flex items-center gap-2"><Cpu size={16} className="text-[var(--primary-2)]" /> {t('sp.title', 'Server performance')}
          {health && <Badge tone={health === 'ok' ? 'green' : health === 'warn' ? 'amber' : 'red'}>{health === 'ok' ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />} {healthLabel}</Badge>}
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[var(--faint)] flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> {t('sp.auto', 'auto 30s')}</span>
          <Button size="sm" variant="ghost" disabled={busy} onClick={sampleNow}>{busy ? <Spinner /> : <><RefreshCw size={14} /> {t('sp.samplenow', 'Sample now')}</>}</Button>
        </div>
      </div>
      <p className="text-xs text-[var(--muted)] mb-3">{t('sp.desc', 'Metrics reflect this API container\'s own view (os/cgroup) — sampled every ~10 min, auto-refreshed here every 30s. A full per-service breakdown with restart controls needs Docker-socket access (see "Advanced server management").')}</p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        {kpi('CPU', latest ? `${latest.cpuPct.toFixed(0)}%` : '—', Cpu, cpuTone, 'cpuPct')}
        {kpi(t('sp.memory', 'Memory'), latest ? `${latest.memPct.toFixed(0)}%` : '—', Gauge, memTone, 'memPct')}
        {kpi(t('sp.disk', 'Disk'), latest ? `${latest.diskPct.toFixed(0)}%` : '—', HardDrive, diskTone, 'diskPct')}
        {kpi(t('sp.load', 'Load (1m)'), latest ? latest.loadAvg1.toFixed(2) : '—', TrendingUp, loadTone)}
        {kpi(t('sp.uptime', 'Uptime'), latest ? `${(latest.uptimeSec / 3600).toFixed(1)}h` : '—', Clock, '')}
        {kpi(t('sp.latency', 'Avg latency'), latest?.latencyMs != null ? `${latest.latencyMs}ms` : '—', Zap, latest?.latencyMs != null ? toneFor(latest.latencyMs, [400, 1000]) : '')}
        {kpi(t('sp.download', 'Download'), (liveNet.rx ?? latest?.netRxKbps) != null ? fmtKbps(liveNet.rx ?? latest.netRxKbps) : '—', Download, '', 'netRxKbps')}
        {kpi(t('sp.upload', 'Upload'), (liveNet.tx ?? latest?.netTxKbps) != null ? fmtKbps(liveNet.tx ?? latest.netTxKbps) : '—', Upload, '', 'netTxKbps')}
      </div>

      {/* Absolute totals alongside the percentages above — "11% used" only means
          something once you know it's 11% of how much. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Card className="p-3"><div className="flex items-center gap-2 text-[var(--faint)] text-xs mb-1"><Cpu size={13} /> {t('sp.cores', 'CPU cores')}</div><div className="text-xl font-bold tabular-nums">{totals.cpuCores ?? '—'}</div></Card>
        <Card className="p-3"><div className="flex items-center gap-2 text-[var(--faint)] text-xs mb-1"><Gauge size={13} /> {t('sp.ramtotal', 'RAM total')}</div><div className="text-xl font-bold tabular-nums">{memUsedGB != null ? `${memUsedGB.toFixed(1)} / ${gb(totals.memTotalBytes).toFixed(1)} GB` : '—'}</div></Card>
        <Card className="p-3"><div className="flex items-center gap-2 text-[var(--faint)] text-xs mb-1"><HardDrive size={13} /> {t('sp.disktotal', 'Disk total')}</div><div className="text-xl font-bold tabular-nums">{diskUsedGB != null ? `${diskUsedGB.toFixed(0)} / ${gb(totals.diskTotalBytes).toFixed(0)} GB` : '—'}</div></Card>
        <Card className="p-3"><div className="flex items-center gap-2 text-[var(--faint)] text-xs mb-1"><ShieldCheck size={13} /> {t('sp.availability', 'Availability')}</div><div className="text-xl font-bold tabular-nums">{totals.uptimePct != null ? `${totals.uptimePct.toFixed(2)}%` : '—'}</div></Card>
      </div>

      <Card className="p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)]">{t('sp.history', 'CPU / Memory / Disk — history')}</span>
          <span className="flex items-center gap-3 text-[11px] text-[var(--muted)]"><span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#f97316' }} /> CPU</span><span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#38bdf8' }} /> Mem</span><span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#a78bfa' }} /> Disk</span></span>
        </div>
        <MetricChart history={history} />
        {cg?.usedBytes != null && <div className="text-[11px] text-[var(--faint)] mt-2">This process's own cgroup memory: {(cg.usedBytes / 1024 / 1024).toFixed(0)} MB{cg.limitBytes ? ` / ${(cg.limitBytes / 1024 / 1024).toFixed(0)} MB allocated` : ' (no cgroup limit set — showing real usage only)'}.</div>}
      </Card>

      {/* Bandwidth served, broken down by what's consuming it (since the API last started). */}
      {(() => {
        const bw = data?.bandwidthByCat; if (!bw) return null;
        const rows = [['repo', t('sp.bw.repo', 'Repo downloads'), '#f97316'], ['catalog', t('sp.bw.catalog', 'Catalog / submissions'), '#38bdf8'], ['media', t('sp.bw.media', 'Media'), '#a78bfa'], ['other', t('sp.bw.other', 'App / API'), '#64748b']];
        const total = rows.reduce((a, [k]) => a + (bw[k] || 0), 0);
        return (
          <Card className="p-4 mb-4">
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] flex items-center gap-1.5"><Download size={13} className="text-[var(--primary-2)]" /> {t('sp.bw.title', 'Bandwidth served — by consumer')}</span>
              <span className="text-[11px] text-[var(--muted)] tabular-nums">{fmtBytes(total)} {t('sp.bw.since', 'since restart')}</span>
            </div>
            {total > 0 ? <>
              <div className="flex h-2.5 rounded-full overflow-hidden mb-2.5 bg-[var(--surface-2)]">
                {rows.map(([k, , c]) => (bw[k] || 0) > 0 && <div key={k} style={{ width: `${(bw[k] / total) * 100}%`, background: c }} title={`${bw[k]} B`} />)}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                {rows.map(([k, label, c]) => (
                  <div key={k} className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: c }} /><span className="text-[var(--muted)] truncate">{label}</span><span className="ml-auto tabular-nums font-medium">{Math.round(((bw[k] || 0) / total) * 100)}%</span></div>
                ))}
              </div>
              <p className="text-[11px] text-[var(--faint)] mt-2.5">{t('sp.bw.note', 'Counted from response sizes since the API last restarted. Telemetry runs as a separate service, so it isn’t included here.')}</p>
            </> : <div className="text-sm text-[var(--faint)]">{t('sp.bw.none', 'No traffic served yet since restart.')}</div>}
          </Card>
        );
      })()}

      {/* Per-repo ALLOCATED upload + live-served throughput and storage. (CPU is no
          longer a product dimension, so it's not shown here.) */}
      {(() => {
        const ra = data?.repoAllocations;
        if (!ra?.repos?.length) return null;
        return (
          <Card className="p-4 mb-4">
            <button onClick={() => toggleSec('alloc')} className="w-full flex items-center justify-between gap-2 mb-1 flex-wrap text-left">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] flex items-center gap-1.5"><Server size={13} className="text-[var(--primary-2)]" /> {t('sp.alloc', 'Per-repo allocation')} <span className="text-[var(--muted)] normal-case tracking-normal">· {ra.repos.length}</span></span>
              <span className="flex items-center gap-2">
                <span className="text-[11px] tabular-nums text-[var(--muted)] hidden sm:inline">
                  {t('sp.alloc.summary2', '{n} repo(s) · {u} Mbps total upload').replace('{n}', ra.repos.length).replace('{u}', ra.totalUploadMbps)}
                </span>
                <ChevronDown size={15} className={`text-[var(--faint)] transition-transform ${sec.alloc ? '' : '-rotate-90'}`} />
              </span>
            </button>
            {sec.alloc && (() => {
              const totUsed = ra.repos.reduce((a, r) => a + (r.storageUsedBytes || 0), 0);
              const totQuota = ra.repos.reduce((a, r) => a + (r.storageQuotaBytes || 0), 0);
              const totLive = ra.repos.reduce((a, r) => a + (r.liveUploadMbps || 0), 0);
              return (
              <>
                {/* Totals summary — live upload actually served + storage used across all repos. */}
                <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)]/40 p-3 mb-3">
                  <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-[var(--faint)]">
                    <span className="flex items-center gap-1.5">{totLive > 0 && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}{t('sp.alloc.uplivetot', 'Live upload (total)')}: <b className="text-[var(--text)] tabular-nums">{totLive.toFixed(2)} Mbps</b> <span className="text-[var(--faint)]/70">/ {ra.totalUploadMbps} {t('sp.alloc.reserved', 'reserved')}</span></span>
                    <span>{t('sp.alloc.stotot', 'Storage used (total)')}: <b className="text-[var(--text)] tabular-nums">{fmtBytes(totUsed)} / {fmtBytes(totQuota)}</b></span>
                  </div>
                </div>
                <div className="text-[11px] text-[var(--faint)] mb-2">{t('sp.alloc.note3', "Upload = throughput actually served right now vs the plan limit; Storage = what's actually stored vs the quota.")}</div>

                {/* Per-repo table — live upload + storage, each with a real used/total bar. */}
                <div className="max-h-96 overflow-auto -mx-1">
                  <table className="w-full text-sm border-collapse min-w-[480px]">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wider text-[var(--faint)]">
                        <th className="font-semibold text-left py-1.5 pl-1 pr-3 min-w-[150px]">{t('sp.repo', 'Repo')}</th>
                        <th className="font-semibold text-left py-1.5 px-3 min-w-[150px]">{t('sp.upload', 'Upload')}</th>
                        <th className="font-semibold text-left py-1.5 pl-3 pr-1 min-w-[150px]">{t('sp.storage', 'Storage')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--line)]">
                      {ra.repos.map((r) => {
                        const stoUsed = r.storageQuotaBytes ? Math.min(100, (r.storageUsedBytes / r.storageQuotaBytes) * 100) : 0;
                        const stoTone = stoUsed >= 90 ? '#f87171' : stoUsed >= 70 ? '#f59e0b' : '#34d399';
                        const live = r.liveUploadMbps || 0;
                        const cap = r.uploadMbps || 0;
                        const upPct = cap > 0 ? Math.min(100, (live / cap) * 100) : (live > 0 ? 100 : 0);
                        return (
                          <tr key={r.id} className="hover:bg-[var(--surface-2)]/40">
                            <td className="py-2 pl-1 pr-3 min-w-[150px]">
                              <div className="font-medium break-all leading-tight">{r.name}</div>
                              <div className="text-[11px] text-[var(--faint)] flex items-center gap-1.5 flex-wrap">{r.owner}{r.status !== 'ONLINE' && <Badge tone={r.status === 'SUSPENDED' ? 'red' : ''}>{rawStatusLabel(r.status, t)}</Badge>}</div>
                            </td>
                            {/* Live upload actually served now vs the plan limit (0 = idle). */}
                            <td className="py-2 px-3">
                              <div className="flex items-baseline justify-between gap-2 text-[11px] tabular-nums mb-1">
                                <span className="flex items-center gap-1">{live > 0 && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />}<b className="text-[var(--text)]">{live.toFixed(2)}</b> <span className="text-[var(--faint)]">/ {cap} Mbps</span></span>
                                <span className="text-[var(--faint)]">{live <= 0 ? t('sp.alloc.idle', 'idle') : t('sp.alloc.pctused', '{n}%').replace('{n}', upPct.toFixed(0))}</span>
                              </div>
                              <div className="h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className="h-full rounded-full bg-sky-500 transition-all" style={{ width: `${Math.max(live > 0 ? 3 : 0, upPct)}%` }} /></div>
                            </td>
                            {/* Storage actually used vs quota. */}
                            <td className="py-2 pl-3 pr-1">
                              <div className="flex items-baseline justify-between gap-2 text-[11px] tabular-nums mb-1">
                                <span><b className="text-[var(--text)]">{fmtBytes(r.storageUsedBytes)}</b> <span className="text-[var(--faint)]">/ {fmtBytes(r.storageQuotaBytes)}</span></span>
                                <span className="text-[var(--faint)]">{stoUsed < 0.5 ? t('sp.alloc.empty', 'empty') : t('sp.alloc.pctused', '{n}%').replace('{n}', stoUsed.toFixed(0))}</span>
                              </div>
                              <div className="h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className="h-full rounded-full" style={{ width: `${Math.max(2, stoUsed)}%`, background: stoTone }} /></div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
              );
            })()}
          </Card>
        );
      })()}

      <div className="grid sm:grid-cols-2 gap-4 mb-4">
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)]">{t('sp.deps', 'Dependencies')}</span>
            <button className="text-[11px] text-[var(--muted)] hover:text-[var(--text)] hover:underline" onClick={() => setConfiguring((c) => !c)}>{configuring ? t('sp.done', 'Done') : t('sp.configure', 'Configure')}</button>
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
              {Object.keys(deps).length ? Object.entries(deps).map(([k, ok]) => depBadge(ok, labels[k] || k)) : <span className="text-xs text-[var(--faint)]">{t('sp.deps.off', 'All dependency checks are disabled.')}</span>}
            </div>
          )}
        </Card>
        <Card className="p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-2 flex items-center gap-1.5"><Lock size={11} /> {t('sp.ssl', 'SSL certificate')}</div>
          {ssl?.notHttps ? <div className="text-xs text-[var(--muted)] flex items-center gap-1.5"><Info size={12} className="text-[var(--primary-2)] shrink-0" /> {t('sp.ssl.nohttps', 'SITE_URL is http:// — no certificate to probe. HTTPS is provisioned & auto-renewed by Caddy/Let’s Encrypt in production.')}</div>
            : ssl?.daysLeft != null ? <div className="text-sm">{ssl.daysLeft <= 14 ? <Badge tone="red">{t('sp.ssl.left', '{n}d left').replace('{n}', ssl.daysLeft)}</Badge> : ssl.daysLeft <= 30 ? <Badge tone="amber">{t('sp.ssl.left', '{n}d left').replace('{n}', ssl.daysLeft)}</Badge> : <Badge tone="green">{t('sp.ssl.left', '{n}d left').replace('{n}', ssl.daysLeft)}</Badge>} <span className="text-[var(--faint)] text-xs">{t('sp.ssl.expires', 'expires {d}').replace('{d}', new Date(ssl.expiresAt).toLocaleDateString())}</span></div>
            : <div className="text-xs text-[var(--faint)]">{t('sp.ssl.noprobe', "Couldn't probe SITE_URL's certificate.")}</div>}
        </Card>
      </div>

      {downtime.length > 0 && (
        <Card className="p-4 mb-4">
          <button onClick={() => toggleSec('downtime')} className="w-full flex items-center justify-between text-left mb-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] flex items-center gap-1.5"><AlertTriangle size={11} /> {t('sp.downtime', 'Downtime history')} <span className="text-[var(--muted)] normal-case tracking-normal">· {downtime.length}</span></span>
            <ChevronDown size={15} className={`text-[var(--faint)] transition-transform ${sec.downtime ? '' : '-rotate-90'}`} />
          </button>
          {sec.downtime && <>
          <div className="flex items-start justify-between gap-2 mb-3">
            <p className="text-[11px] text-[var(--faint)]">{t('sp.downtime.note', 'Periods where the server stopped reporting — i.e. it was most likely down or restarting.')}</p>
            <Button size="sm" variant="ghost" className="shrink-0" onClick={() => { navigator.clipboard?.writeText(downtime.map((d) => `${new Date(d.from).toLocaleString()} → ${new Date(d.to).toLocaleString()} (${d.minutes} min)`).join('\n')); toast.success(t('common.copied', 'Copied.')); }}><Copy size={12} /> {t('sp.al.copyall', 'Copy all')}</Button>
          </div>
          <div className="space-y-2">
            {downtime.map((d, i) => {
              const dur = d.minutes >= 90 ? `${(d.minutes / 60).toFixed(1)} h` : `~${d.minutes} min`;
              const from = new Date(d.from); const to = new Date(d.to);
              const sameDay = from.toDateString() === to.toDateString();
              const time = (x) => x.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              const day = (x) => x.toLocaleDateString([], { day: 'numeric', month: 'short' });
              return (
                <div key={i} className="flex items-center gap-3 text-sm rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 group">
                  <Badge tone={d.minutes >= 60 ? 'red' : 'amber'} className="shrink-0 tabular-nums">{dur}</Badge>
                  <span className="text-[var(--muted)] min-w-0 flex-1 truncate">
                    {sameDay
                      ? <>{day(from)} · <span className="tabular-nums">{time(from)} → {time(to)}</span></>
                      : <span className="tabular-nums">{day(from)} {time(from)} → {day(to)} {time(to)}</span>}
                  </span>
                  <span className="text-[11px] text-[var(--faint)] shrink-0 tabular-nums hidden sm:inline">{d.minutes} min · {from.getFullYear()}</span>
                  <button onClick={() => { navigator.clipboard?.writeText(`${from.toLocaleString()} → ${to.toLocaleString()} (${d.minutes} min)`); toast.success(t('common.copied', 'Copied.')); }} className="text-[var(--faint)] hover:text-[var(--primary-2)] shrink-0 opacity-0 group-hover:opacity-100 transition" title={t('common.copy', 'Copy')}><Copy size={12} /></button>
                </div>
              );
            })}
          </div>
          </>}
        </Card>
      )}

      <div>
        <button onClick={() => toggleSec('alerts')} className="w-full flex items-center justify-between text-left mb-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] flex items-center gap-1.5">{t('sp.alerts', 'Recent alerts')}{(alerts.data?.alerts || []).length ? <span className="text-[var(--muted)] normal-case tracking-normal">· {alerts.data.alerts.length}</span> : null}</h3>
          <ChevronDown size={15} className={`text-[var(--faint)] transition-transform ${sec.alerts ? '' : '-rotate-90'}`} />
        </button>
        {sec.alerts && (alerts.loading ? <Loading /> : (() => {
          const list = alerts.data?.alerts || [];
          if (!list.length) return <EmptyState icon={CheckCircle2} title={t('sp.alerts.none', 'No alerts')} sub={t('sp.alerts.nonesub', 'Nothing has crossed a threshold yet.')} />;
          // Collapse repeats of the exact same alert (kind+message) into one row with a
          // count + first/last seen, so a long outage doesn't read as a wall of dupes.
          const groups = [];
          const byKey = new Map();
          for (const a of list) {
            const key = `${a.kind}::${a.message}`;
            if (byKey.has(key)) { const g = byKey.get(key); g.count++; g.firstAt = a.createdAt; }
            else { const g = { ...a, count: 1, firstAt: a.createdAt, lastAt: a.createdAt }; byKey.set(key, g); groups.push(g); }
          }
          const copyAll = async () => {
            const log = [
              `BetterCommunity server-perf alerts`,
              `exported: ${new Date().toISOString()}`,
              ``,
              ...groups.map((g) => `[${g.kind}] ${g.message}${g.count > 1 ? ` (×${g.count})` : ''} — last ${new Date(g.lastAt).toLocaleString()}${g.count > 1 ? `, first ${new Date(g.firstAt).toLocaleString()}` : ''}`),
            ].join('\n');
            const ok = await copyText(log);
            ok ? toast.success(t('common.copied', 'Copied.')) : toast.error(t('sp.al.copyfail', 'Could not copy — select the alerts manually.'));
          };
          return (<>
            <div className="flex justify-end mb-1.5"><Button size="sm" variant="ghost" onClick={copyAll}><Copy size={12} /> {t('sp.al.copyall', 'Copy all')}</Button></div>
            <div className="space-y-1.5 max-h-96 overflow-auto pr-1 -mr-1">
              {groups.map((g) => <AlertRow key={g.id} a={g} />)}
            </div>
          </>);
        })())}
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
  const toast = useToast(); const dialog = useDialog(); const { t } = useI18n();
  const [dir, setDir] = useState('.');
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [history, setHistory] = useState(null); // { path, items } for the backup-history modal

  const load = (d) => api.get(`/server/files?path=${encodeURIComponent(d)}`).then((r) => { setData(r); setDir(r.path); setQ(''); }).catch(() => toast.error(t('fm.listfail', 'Failed to list.')));
  useEffect(() => { load('.'); /* eslint-disable-next-line */ }, []);

  const openEntry = async (e) => {
    const full = dir === '.' ? e.name : `${dir}/${e.name}`;
    if (e.isDir) return load(full);
    try { const r = await api.get(`/server/files/read?path=${encodeURIComponent(full)}`); setEditing({ path: r.path, content: r.content }); }
    catch (x) { toast.error(x.data?.error === 'too_large' ? t('fm.toolarge', 'File too large to view here — use download instead.') : t('fm.readfail', 'Failed to read (probably binary — use download instead).')); }
  };
  const up = () => { const parts = dir.split('/').filter((x) => x !== '.'); parts.pop(); load(parts.length ? parts.join('/') : '.'); };
  const saveFile = async () => {
    if (!(await doubleConfirm(dialog, { title: t('fm.savechanges', 'Save changes'), message: t('fm.saveconfirm', 'Overwrite "{p}" on the live server? A backup of the current content is kept automatically.').replace('{p}', editing.path), okLabel: t('common.save', 'Save') }))) return;
    setBusy(true);
    try { await api.put('/server/files/write', { path: editing.path, content: editing.content, confirmToken: 'CONFIRM' }); toast.success(t('fm.savedbackup', 'Saved — a backup of the previous version was kept.')); setEditing(null); }
    catch { toast.error(t('fm.savefail', 'Failed to save.')); } finally { setBusy(false); }
  };
  const delEntry = async (e) => {
    const full = dir === '.' ? e.name : `${dir}/${e.name}`;
    if (!(await doubleConfirm(dialog, { title: t('fm.del', 'Delete'), message: t('fm.delconfirm', 'Delete "{p}"? A backup is kept, but it won\'t reappear in the file manager until restored.').replace('{p}', full), okLabel: t('fm.del', 'Delete') }))) return;
    try { await api.del(`/server/files?path=${encodeURIComponent(full)}&confirmToken=CONFIRM`); toast.success(t('common.deleted', 'Deleted.')); load(dir); } catch { toast.error(t('common.failed', 'Failed.')); }
  };
  const viewHistory = async (full) => {
    try { const r = await api.get(`/server/files/backups?path=${encodeURIComponent(full)}`); setHistory({ path: full, items: r.history }); }
    catch { toast.error(t('fm.histfail', 'Failed to load history.')); }
  };
  const restoreVersion = async (hash) => {
    if (!(await doubleConfirm(dialog, { title: t('fm.restore', 'Restore this version'), message: t('fm.restoreconfirm', 'Overwrite "{p}" with the version from this backup? The current content is backed up first.').replace('{p}', history.path), okLabel: t('fm.restorebtn', 'Restore') }))) return;
    try { await api.post(`/server/files/backups/${hash}/restore`, { path: history.path, confirmToken: 'CONFIRM' }); toast.success(t('fm.restored', 'Restored.')); setHistory(null); load(dir); }
    catch { toast.error(t('fm.restorefail', 'Failed to restore.')); }
  };
  const newFolder = async () => {
    const name = await dialog.prompt({ title: t('fm.newfolder', 'New folder'), label: t('fm.foldername', 'Folder name'), placeholder: 'assets' });
    if (!name) return;
    const full = dir === '.' ? name : `${dir}/${name}`;
    try { await api.post('/server/files/mkdir', { path: full }); toast.success(t('fm.created', 'Created.')); load(dir); }
    catch (x) { toast.error(x.data?.error === 'already_exists' ? t('fm.exists', 'Already exists.') : t('common.failed', 'Failed.')); }
  };
  const newFile = async () => {
    const name = await dialog.prompt({ title: t('fm.newfile', 'New file'), label: t('fm.filename', 'File name'), placeholder: 'notes.txt' });
    if (!name) return;
    const full = dir === '.' ? name : `${dir}/${name}`;
    try { await api.put('/server/files/write', { path: full, content: '' }); toast.success(t('fm.created', 'Created.')); load(dir); }
    catch { toast.error(t('common.failed', 'Failed.')); }
  };
  const rename = async (e) => {
    const newName = await dialog.prompt({ title: t('fm.renametitle', 'Rename "{n}"').replace('{n}', e.name), label: t('fm.newname', 'New name'), placeholder: e.name });
    if (!newName || newName === e.name) return;
    const full = dir === '.' ? e.name : `${dir}/${e.name}`;
    try { await api.put('/server/files/rename', { path: full, newName }); toast.success(t('fm.renamed', 'Renamed.')); load(dir); }
    catch (x) { toast.error(x.data?.error === 'bad_name' ? t('fm.badname', 'Invalid name.') : t('common.failed', 'Failed.')); }
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
        <FileText size={14} className="text-[var(--primary-2)] shrink-0" /> <span className="font-semibold shrink-0">{t('fm.title', 'File manager')}</span>
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
        <Button size="sm" onClick={newFolder}><Plus size={12} /> {t('fm.folder', 'Folder')}</Button>
        <Button size="sm" onClick={newFile}><Plus size={12} /> {t('fm.file', 'File')}</Button>
        {dir !== '.' && <Button size="sm" onClick={up}>{t('fm.up', 'Up')}</Button>}
      </div>
      {editing ? (
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="text-xs text-[var(--faint)] font-mono">{editing.path}</div>
            <button onClick={() => viewHistory(editing.path)} className="text-xs text-[var(--faint)] hover:text-[var(--primary-2)] flex items-center gap-1"><History size={12} /> {t('fm.history', 'History')}</button>
          </div>
          <textarea value={editing.content} onChange={(e) => setEditing({ ...editing, content: e.target.value })} className="w-full h-64 font-mono text-xs bg-[var(--surface-2)] rounded-lg p-3 outline-none" spellCheck={false} />
          <div className="flex gap-2 mt-2"><Button variant="primary" disabled={busy} onClick={saveFile}>{busy ? <Spinner /> : t('common.save', 'Save')}</Button><Button onClick={() => setEditing(null)}>{t('su.cancel', 'Cancel')}</Button></div>
        </div>
      ) : (
        <>
          <div className="relative mb-2"><Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
            <Input className="!pl-8 !py-1.5 !text-xs" placeholder={t('fm.filter', 'Filter this folder…')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
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
            )) : <div className="text-xs text-[var(--faint)] py-4 text-center">{data?.entries?.length ? t('fm.nomatches', 'No matches.') : t('fm.emptydir', 'Empty directory.')}</div>}
          </div>
        </>
      )}
      {history && (
        <Modal open onClose={() => setHistory(null)} title={t('fm.histtitle', 'Backup history — {p}').replace('{p}', history.path)} icon={History} width="max-w-lg">
          {history.items.length ? (
            <div className="divide-y divide-[var(--line)] max-h-96 overflow-auto scroll-thin">
              {history.items.map((h) => (
                <div key={h.hash} className="flex items-center gap-2.5 py-2 text-sm">
                  <div className="flex-1 min-w-0"><div className="truncate">{h.message}</div><div className="text-[11px] text-[var(--faint)]">{new Date(h.at).toLocaleString()} · <code className="font-mono">{h.hash.slice(0, 8)}</code></div></div>
                  <Button size="sm" onClick={() => restoreVersion(h.hash)}>{t('fm.restorebtn', 'Restore')}</Button>
                </div>
              ))}
            </div>
          ) : <div className="text-xs text-[var(--faint)] py-6 text-center">{t('fm.nobackups', 'No backups yet for this file.')}</div>}
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
  const toast = useToast(); const dialog = useDialog(); const { t } = useI18n();
  const [source, setSource] = useState('bcweb'); // 'bcweb' | 'telemetry'
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
  const canEdit = source === 'bcweb'; // the telemetry DB is read-only (no cell/edit routes)
  const dbBase = (s = source) => (s === 'telemetry' ? '/server/telemetry-db' : '/server/db');

  useEffect(() => {
    setTables(null); setActive(null); setRows(null);
    api.get(`${dbBase(source)}/tables`).then((r) => setTables(r.tables))
      .catch((x) => toast.error(x.data?.error === 'telemetry_db_not_configured' ? t('dbv.notconfigured', 'BMM telemetry DB is not configured.') : t('dbv.listfail', 'Failed to list tables.')));
    /* eslint-disable-next-line */
  }, [source]);
  const openTable = async (name, p = 0, s = sort) => {
    setActive(name); setPage(p); setRows(null); setSort(s);
    try {
      const qs = new URLSearchParams({ page: p, pageSize }); if (s.col) { qs.set('sort', s.col); qs.set('dir', s.dir); }
      const r = await api.get(`${dbBase()}/table/${encodeURIComponent(name)}?${qs}`); setRows(r);
    } catch { toast.error(t('dbv.tablefail', 'Failed to load table.')); }
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
      <div className="flex items-center gap-2 mb-2 text-sm flex-wrap"><HardDrive size={14} className="text-[var(--primary-2)]" /><span className="font-semibold">{t('dbv.title', 'Database viewer')}</span>
        <span className="text-xs text-[var(--faint)]">{canEdit ? t('dbv.editcare', '(edit with care)') : t('dbv.readonly', '(read-only)')}</span>
        <div className="ml-auto flex rounded-lg border border-[var(--line)] overflow-hidden text-xs">
          {[['bcweb', 'BCWEB'], ['telemetry', 'BMM Telemetry']].map(([v, l]) => (
            <button key={v} onClick={() => setSource(v)} className={`px-2.5 py-1 ${source === v ? 'bg-[var(--surface-2)] text-[var(--text)] font-medium' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>{l}</button>
          ))}
        </div>
      </div>
      {!tables ? <Loading /> : (
        <div className="grid sm:grid-cols-[180px_1fr] gap-3">
          <div>
            <div className="relative mb-1.5"><Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
              <Input className="!pl-7 !py-1 !text-xs" placeholder={t('dbv.filtertables', 'Filter tables…')} value={tableQ} onChange={(e) => setTableQ(e.target.value)} /></div>
            <div className="max-h-80 overflow-auto scroll-thin space-y-0.5">
              {visibleTables.map((t) => (
                <button key={t.name} onClick={() => openTable(t.name)} className={`w-full text-left px-2 py-1.5 rounded-lg text-xs flex items-center justify-between gap-2 ${active === t.name ? 'bg-[var(--surface-2)] text-[var(--text)] font-medium' : 'text-[var(--muted)] hover:bg-[var(--surface-2)]'}`}>
                  <span className="truncate">{t.name}</span><span className="text-[var(--faint)] shrink-0">{t.approxRows}</span>
                </button>
              ))}
              {!visibleTables.length && <div className="text-xs text-[var(--faint)] py-3 text-center">{t('fm.nomatches', 'No matches.')}</div>}
            </div>
          </div>
          <div className="min-w-0">
            {!active ? <div className="text-xs text-[var(--faint)] py-6 text-center">{t('dbv.picktable', 'Pick a table.')}</div>
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
                    <span>{rows.total} {rows.total !== 1 ? t('dbv.rows', 'rows') : t('dbv.row', 'row')}</span>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={exportCsv}><Download size={12} /> {t('dbv.csv', 'CSV (page)')}</Button>
                      <Button size="sm" disabled={page === 0} onClick={() => openTable(active, page - 1)}>{t('dbv.prev', 'Prev')}</Button>
                      <Button size="sm" disabled={(page + 1) * pageSize >= rows.total} onClick={() => openTable(active, page + 1)}>{t('dbv.next', 'Next')}</Button>
                    </div>
                  </div>
                </>
              )}
          </div>
          {cell && (() => {
            const isPk = rows?.pkColumn === cell.col;
            const protected_ = DB_SENSITIVE_COL.test(cell.col);
            const editable = canEdit && !!rows?.pkColumn && cell.pk != null && !isPk && !protected_;
            const save = async () => {
              if (!(await doubleConfirm(dialog, { title: t('dbv.saverow', 'Save row edit'), message: t('dbv.saverowconfirm', 'Overwrite {t}.{c} (row {pk}) on the live database? The current row is backed up automatically.').replace('{t}', active).replace('{c}', cell.col).replace('{pk}', cell.pk), okLabel: t('common.save', 'Save') }))) return;
              setSaving(true);
              try {
                await api.put(`/server/db/table/${encodeURIComponent(active)}/cell`, { pk: cell.pk, column: cell.col, value: draft, confirmToken: 'CONFIRM' });
                toast.success(t('dbv.rowsaved', 'Saved — the previous row value was backed up.'));
                setCell(null);
                openTable(active, page, sort);
              } catch (x) {
                toast.error(x.data?.error === 'table_protected' ? t('dbv.tableprotected', 'Audit/log tables are read-only — they can\'t be edited here.') : x.data?.error === 'column_protected' ? t('dbv.colprotected', 'This column can\'t be edited here.') : x.data?.error === 'update_failed' ? t('dbv.updatefail', 'Failed: {d}').replace('{d}', x.data?.detail || 'invalid value') : t('common.failed', 'Failed.'));
              } finally { setSaving(false); }
            };
            const viewRowHistory = async () => {
              try { const r = await api.get(`/server/db/backups?table=${encodeURIComponent(active)}&pk=${encodeURIComponent(cell.pk)}`); setRowHistory({ table: active, pk: cell.pk, items: r.history }); }
              catch { toast.error(t('fm.histfail', 'Failed to load history.')); }
            };
            return (
              <Modal open onClose={() => setCell(null)} title={cell.col} icon={HardDrive} width="max-w-lg"
                footer={editable ? <><Button onClick={() => setCell(null)}>{t('su.cancel', 'Cancel')}</Button><Button onClick={viewRowHistory}><History size={13} /> {t('fm.history', 'History')}</Button><Button variant="primary" disabled={saving} onClick={save}>{saving ? <Spinner /> : t('common.save', 'Save')}</Button></> : undefined}>
                {editable ? (
                  <textarea value={draft} onChange={(e) => setDraft(e.target.value)} className="w-full h-40 font-mono text-xs bg-[var(--surface-2)] rounded-lg p-3 outline-none" spellCheck={false} />
                ) : (
                  <>
                    <pre className="text-xs font-mono bg-[var(--surface-2)] rounded-lg p-3 max-h-80 overflow-auto scroll-thin whitespace-pre-wrap break-all">{cell.value === null ? 'null' : cellText(cell.value)}</pre>
                    <p className="text-xs text-[var(--faint)] mt-2">{protected_ ? t('dbv.sensitivenote', "This column can't be edited here (sensitive).") : isPk ? t('dbv.pknote', "The primary key can't be edited.") : t('dbv.nopknote', 'This table has no single-column primary key, so it can only be viewed.')}</p>
                  </>
                )}
              </Modal>
            );
          })()}
          {rowHistory && (
            <Modal open onClose={() => setRowHistory(null)} title={t('dbv.rowhisttitle', 'Row backup history — {t} (pk={pk})').replace('{t}', rowHistory.table).replace('{pk}', rowHistory.pk)} icon={History} width="max-w-lg">
              {rowHistory.items.length ? (
                <div className="divide-y divide-[var(--line)] max-h-96 overflow-auto scroll-thin">
                  {rowHistory.items.map((h) => (
                    <div key={h.hash} className="flex items-center gap-2.5 py-2 text-sm">
                      <div className="flex-1 min-w-0"><div className="truncate">{h.message}</div><div className="text-[11px] text-[var(--faint)]">{new Date(h.at).toLocaleString()} · <code className="font-mono">{h.hash.slice(0, 8)}</code></div></div>
                      <Button size="sm" onClick={async () => {
                        if (!(await doubleConfirm(dialog, { title: t('dbv.restorerow', 'Restore this row'), message: t('dbv.restorerowconfirm', 'Overwrite {t} (pk={pk}) with this backed-up version? Sensitive columns are never restored. The current row is backed up first.').replace('{t}', rowHistory.table).replace('{pk}', rowHistory.pk), okLabel: t('fm.restorebtn', 'Restore') }))) return;
                        try { const r = await api.post(`/server/db/backups/${h.hash}/restore`, { table: rowHistory.table, pk: rowHistory.pk, confirmToken: 'CONFIRM' }); toast.success(t('dbv.rowrestored', 'Restored {n} column(s){s}.').replace('{n}', r.restored.length).replace('{s}', r.skipped.length ? t('dbv.skipped', ', skipped {k}').replace('{k}', r.skipped.length) : '')); setRowHistory(null); setCell(null); openTable(active, page, sort); }
                        catch { toast.error(t('fm.restorefail', 'Failed to restore.')); }
                      }}>{t('fm.restorebtn', 'Restore')}</Button>
                    </div>
                  ))}
                </div>
              ) : <div className="text-xs text-[var(--faint)] py-6 text-center">{t('dbv.norowbackups', 'No backups yet for this row.')}</div>}
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
  const toast = useToast(); const dialog = useDialog(); const { t } = useI18n();
  const me2fa = useAsync(() => api.get('/me/2fa'), []);
  const elevateStatus = useAsync(() => api.get('/server/elevate/status').catch(() => ({ elevated: false })), []);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [restarting, setRestarting] = useState(false);

  const elevate = async () => {
    setBusy(true);
    try { await api.post('/server/elevate', { code: code.trim() }); toast.success(t('asa.elevated', 'Elevated for 15 minutes.')); setCode(''); elevateStatus.reload(); }
    catch (x) { toast.error(x.data?.error === 'invalid_code' ? t('asa.invalidcode', 'Invalid code.') : x.data?.error === '2fa_not_enabled' ? t('asa.no2fa', 'Enable 2FA in your profile first.') : x.data?.error === 'forbidden' ? t('asa.noaccess', "You don't have server-control access.") : t('common.failed', 'Failed.')); }
    finally { setBusy(false); }
  };
  const restart = async () => {
    if (!(await dialog.confirm({ title: t('asa.restarttitle', 'Restart the API server'), message: t('asa.restartconfirm', 'This restarts the api container. Everyone will briefly lose connection (usually a few seconds). Continue?'), okLabel: t('asa.restart', 'Restart'), danger: true }))) return;
    setRestarting(true);
    try { await api.post('/server/restart'); toast.success(t('asa.restarting', 'Restarting — back in a few seconds.')); } catch { toast.error(t('common.failed', 'Failed.')); setRestarting(false); }
  };

  if (me2fa.loading || elevateStatus.loading) return <Loading />;
  if (!me2fa.data?.canControlServer) return <EmptyState icon={AlertTriangle} title={t('asa.notauth', 'Not authorized')} sub={t('asa.notauthsub', 'A SUPERADMIN must grant you server-control access from the Access & permissions tab first.')} />;

  return (
    <div>
      <h2 className="font-semibold mb-1 flex items-center gap-2"><AlertTriangle size={16} className="text-red-400" /> {t('asa.title', 'Advanced server management')}</h2>
      <p className="text-sm text-[var(--muted)] mb-3">{t('asa.sub', "Confined to this API container's own filesystem/process — no host or Docker access today. A fuller per-service view (Docker start/stop/restart/logs, host power) needs a docker-compose change (mounting the Docker socket, or a separate privileged power agent) that hasn't been made yet.")}</p>

      {!elevateStatus.data?.elevated ? (
        <Card className="p-5 max-w-sm">
          <div className="text-sm font-semibold mb-2 flex items-center gap-2"><ShieldCheck size={15} className="text-[var(--primary-2)]" /> {t('asa.stepup', 'Step-up verification required')}</div>
          <p className="text-xs text-[var(--muted)] mb-3">{t('asa.stepupsub', 'Enter a fresh code from your authenticator app to unlock these tools for 15 minutes.')}</p>
          <div className="flex gap-2">
            <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="123456" />
            <Button variant="primary" disabled={busy || code.length !== 6} onClick={elevate}>{busy ? <Spinner /> : t('asa.elevate', 'Elevate')}</Button>
          </div>
          <div className="mt-2"><TotpQuickFill onFill={(c) => setCode(c)} /></div>
        </Card>
      ) : (
        <div className="space-y-4">
          <FileManager />
          <DbViewer />
          <BackupManager />
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-2 text-sm"><RefreshCw size={14} className="text-red-400" /><span className="font-semibold">{t('asa.restartserver', 'Restart server')}</span></div>
            <p className="text-xs text-[var(--muted)] mb-3">{t('asa.restartserversub', "Restarts the api container (Docker's own `restart: unless-stopped` policy brings it right back — no Docker-socket access needed for this).")}</p>
            <Button className="!text-red-400" disabled={restarting} onClick={restart}>{restarting ? <Spinner /> : t('asa.restartnow', 'Restart now')}</Button>
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
  const toast = useToast(); const { t } = useI18n();
  const { data, loading, reload } = useAsync(() => api.get('/server/backups/usage'), []);
  const [limitGB, setLimitGB] = useState('');
  const [busy, setBusy] = useState(false);
  const [gcBusy, setGcBusy] = useState(false);
  const saveLimit = async () => {
    setBusy(true);
    try { await api.put('/server/backups/limit', { maxBytes: limitGB.trim() ? Math.round(Number(limitGB) * 1024 ** 3) : null }); toast.success(t('common.saved', 'Saved.')); setLimitGB(''); reload(); }
    catch { toast.error(t('common.failed', 'Failed.')); } finally { setBusy(false); }
  };
  const runGc = async () => {
    setGcBusy(true);
    try { await api.post('/server/backups/gc'); toast.success(t('bkp.compacted', 'Compacted.')); reload(); } catch { toast.error(t('common.failed', 'Failed.')); } finally { setGcBusy(false); }
  };
  if (loading) return <Loading />;
  const d = data || {};
  const pct = d.maxBytes ? Math.min(100, (d.totalBytes / d.maxBytes) * 100) : 0;
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-2 text-sm"><History size={14} className="text-[var(--primary-2)]" /><span className="font-semibold">{t('bkp.title', 'Backup storage')}</span></div>
      <p className="text-xs text-[var(--muted)] mb-3">{t('bkp.sub', "Every file edit/delete and DB row edit is git-committed first, so it can always be rolled back — plus a full daily snapshot of the file tree. This is separate from the app's own storage (see the Storage tab).")}</p>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div><div className="text-xs text-[var(--faint)] mb-0.5">{t('bkp.filehist', 'File history')}</div><div className="text-lg font-bold tabular-nums">{fmtBytes(d.filesBytes || 0)}</div></div>
        <div><div className="text-xs text-[var(--faint)] mb-0.5">{t('bkp.dbhist', 'DB row history')}</div><div className="text-lg font-bold tabular-nums">{fmtBytes(d.dbBytes || 0)}</div></div>
      </div>
      {d.maxBytes != null && (
        <div className="mb-3">
          <div className="h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className={`h-full ${pct >= 90 ? 'bg-red-500' : 'bg-gradient-to-r from-orange-500 to-amber-400'}`} style={{ width: `${pct}%` }} /></div>
          <div className="text-[11px] text-[var(--faint)] mt-1">{fmtBytes(d.totalBytes)} / {fmtBytes(d.maxBytes)} ({Math.round(pct)}%)</div>
        </div>
      )}
      <div className="grid sm:grid-cols-[1fr_auto_auto] gap-2">
        <Input type="number" value={limitGB} onChange={(e) => setLimitGB(e.target.value)} placeholder={d.maxBytes ? t('bkp.currently', 'Currently {n} GB — blank = unlimited').replace('{n}', (d.maxBytes / 1024 ** 3).toFixed(1)) : t('bkp.limitph', 'Size limit in GB (blank = unlimited)')} />
        <Button variant="primary" disabled={busy} onClick={saveLimit}>{busy ? <Spinner /> : t('bkp.savelimit', 'Save limit')}</Button>
        <Button disabled={gcBusy} onClick={runGc} title={t('bkp.compacttip', 'Runs git gc on the backup repos to reclaim space from old/loose objects. Non-destructive: NO history is deleted — every version can still be restored.')}>{gcBusy ? <Spinner /> : t('bkp.compact', 'Compact backups')}</Button>
      </div>
      <p className="text-[11px] text-[var(--faint)] mt-2" dangerouslySetInnerHTML={{ __html: t('bkp.note', '<b>Compact backups</b> reclaims disk space by garbage-collecting the backup git repos (loose/duplicate objects). It never deletes history — every past version stays restorable.') }} />
    </Card>
  );
}

// Unified "Access & permissions": ONE user search that surfaces EVERY permission
// for the picked user in a single card — role + server-control (SUPERADMIN only)
// and blog-post grants (ADMIN+) — plus the site-wide access policy and a full grants
// overview. Replaces the old split "Roles & access" / "Blog access" tabs, so an
// admin no longer hunts across screens to see what a user can do.
function AdminAccess({ isSuperAdmin }) {
  const toast = useToast();
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState(null);
  const [roleSel, setRoleSel] = useState('USER');
  const [scopeSel, setScopeSel] = useState('global');
  const scopes = useAsync(() => api.get('/blog/my-scopes'), []);
  const grants = useAsync(() => api.get('/admin/blog-permissions'), []);

  const search = async () => {
    if (!q.trim()) return setResults(null);
    setBusy(true);
    try { const { users } = await api.get(`/admin/users?q=${encodeURIComponent(q)}&take=10`); setResults(users); } catch { setResults([]); } finally { setBusy(false); }
  };
  const pick = (u) => { setPicked(u); setRoleSel(u.role); setScopeSel('global'); };
  const saveRole = async () => {
    setBusy(true);
    try { await api.put(`/admin/users/${picked.id}/role`, { role: roleSel }); toast.success(t('acc.rolenow', '{name} is now {role}.').replace('{name}', picked.displayName).replace('{role}', roleSel)); setPicked((p) => ({ ...p, role: roleSel })); }
    catch (x) { toast.error(x.data?.error === 'cannot_change_own_role' ? t('acc.ownrole', "You can't change your own role.") : x.data?.error || t('acc.failed', 'Failed.')); }
    finally { setBusy(false); }
  };
  const toggleServerControl = async () => {
    setBusy(true);
    try { await api.put(`/admin/server-control/${picked.id}`, { granted: !picked.canControlServer }); toast.success((!picked.canControlServer ? t('acc.sc.on', 'Server-control granted to {name}.') : t('acc.sc.off', 'Server-control revoked from {name}.')).replace('{name}', picked.displayName)); setPicked((p) => ({ ...p, canControlServer: !p.canControlServer })); }
    catch { toast.error(t('acc.failed', 'Failed.')); } finally { setBusy(false); }
  };
  const toggleTelemetry = async () => {
    setBusy(true);
    try { await api.put(`/admin/telemetry-access/${picked.id}`, { granted: !picked.canViewTelemetry }); toast.success((!picked.canViewTelemetry ? t('acc.tel.on', 'Telemetry access granted to {name}.') : t('acc.tel.off', 'Telemetry access revoked from {name}.')).replace('{name}', picked.displayName)); setPicked((p) => ({ ...p, canViewTelemetry: !p.canViewTelemetry })); }
    catch { toast.error(t('acc.failed', 'Failed.')); } finally { setBusy(false); }
  };
  const grantBlog = async () => {
    setBusy(true);
    try {
      const [kind, val] = scopeSel.split(':');
      await api.post('/admin/blog-permissions', { userId: picked.id, projectKey: kind === 'project' ? val : null, showcaseSlug: kind === 'showcase' ? val : null });
      toast.success(t('acc.blog.granted', 'Granted blog access to {name}.').replace('{name}', picked.displayName)); grants.reload();
    } catch (x) { toast.error(x.data?.error || t('acc.failed', 'Failed.')); } finally { setBusy(false); }
  };
  const revoke = async (g) => {
    try { await api.del(`/admin/blog-permissions/${g.id}`); toast.success(t('acc.revoked', 'Revoked.')); grants.reload(); } catch { toast.error(t('acc.failed', 'Failed.')); }
  };
  const scopeLabel = (g) => g.showcase ? t('acc.scope.custom', 'Custom · {name}').replace('{name}', g.showcase.name) : g.projectKey ? t('acc.scope.project', 'Project · {key}').replace('{key}', g.projectKey.toUpperCase()) : t('acc.scope.global', 'Global (all blogs)');
  const roleTone = (role) => role === 'SUPERADMIN' ? 'red' : role === 'ADMIN' ? 'amber' : role === 'MOD' ? 'primary' : '';
  const allGrants = grants.data?.grants || [];
  const userGrants = picked ? allGrants.filter((g) => g.user?.id === picked.id) : [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-semibold mb-1 flex items-center gap-2"><Shield size={16} className="text-[var(--primary-2)]" /> {t('acc.title', 'Access & permissions')}</h2>
        <p className="text-sm text-[var(--muted)] mb-3">{isSuperAdmin ? t('acc.desc.super', 'Find a user to manage their role, server-control access and blog-post access — all in one place. Search by user id, display name, email, a linked creator id, or a linked Discord.') : t('acc.desc.admin', 'Find a user to manage blog-post access — all in one place. Search by user id, display name, email, a linked creator id, or a linked Discord.')}</p>
        <div className="flex gap-2 mb-3">
          <div className="relative flex-1"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
            <Input className="!pl-9" placeholder={t('au.search.ph', 'id / display name / email / creator id / Discord…')} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} /></div>
          <Button variant="primary" disabled={busy} onClick={search}>{busy ? <Spinner /> : <><Search size={15} /> {t('acc.search', 'Search')}</>}</Button>
        </div>
        {results && (results.length ? <div className="space-y-1.5">
          {results.map((u) => (
            <button key={u.id} onClick={() => pick(u)} className={`w-full text-left card p-3 flex items-center gap-3 ${picked?.id === u.id ? 'border-[var(--primary)]' : ''}`}>
              <Avatar user={u} size={32} />
              <div className="flex-1 min-w-0"><div className="font-medium truncate flex items-center gap-2">{u.displayName} <Badge tone={roleTone(u.role)}>{u.role}</Badge>{u.canControlServer && <Badge tone="red"><Server size={9} /> {t('acc.server', 'server')}</Badge>}{u.canViewTelemetry && <Badge tone="primary"><TrendingUp size={9} /> {t('acc.telemetry', 'telemetry')}</Badge>}</div><div className="text-xs text-[var(--faint)] truncate">{u.email}</div></div>
            </button>
          ))}
        </div> : <div className="text-sm text-[var(--faint)]">{t('acc.nousers', 'No users found.')}</div>)}
      </div>

      {picked && (
        <Card className="p-5 space-y-5">
          <div className="flex items-center gap-3"><Avatar user={picked} size={40} /><div className="min-w-0"><div className="font-semibold flex items-center gap-2">{picked.displayName} <Badge tone={roleTone(picked.role)}>{picked.role}</Badge></div><div className="text-xs text-[var(--faint)] truncate">{picked.email}</div></div></div>

          {isSuperAdmin && (
            <div className="pt-4 border-t border-[var(--line)]">
              <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">{t('acc.role', 'Role')}</div>
              <div className="flex items-center gap-2">
                <Select className="!w-auto" value={roleSel} onChange={(e) => setRoleSel(e.target.value)}>
                  <option value="USER">USER</option><option value="MOD">MOD</option><option value="ADMIN">ADMIN</option><option value="SUPERADMIN">SUPERADMIN</option>
                </Select>
                <Button size="sm" variant="primary" disabled={busy || roleSel === picked.role} onClick={saveRole}>{busy ? <Spinner /> : t('acc.saverole', 'Save role')}</Button>
              </div>
            </div>
          )}

          {isSuperAdmin && (picked.role === 'ADMIN' || picked.role === 'SUPERADMIN' || picked.canControlServer) && (
            <div className="pt-4 border-t border-[var(--line)]">
              <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">{t('acc.sc.title', 'Server-control tools')}</div>
              <p className="text-xs text-[var(--muted)] mb-2">{t('acc.sc.desc', "Grants access to the server dashboard's dangerous actions (DB viewer, restart) — still gated by that user's own 2FA step-up.")} {!picked.totpEnabled && <span className="text-amber-400">{t('acc.sc.no2fa', "This user hasn't enabled 2FA yet, so the tools stay locked either way.")}</span>}</p>
              <Button size="sm" variant={picked.canControlServer ? 'default' : 'primary'} disabled={busy} onClick={toggleServerControl}>{busy ? <Spinner /> : (picked.canControlServer ? t('acc.sc.revoke', 'Revoke server-control') : t('acc.sc.grant', 'Grant server-control'))}</Button>
            </div>
          )}

          {isSuperAdmin && ['MOD', 'ADMIN', 'SUPERADMIN'].includes(picked.role) && (
            <div className="pt-4 border-t border-[var(--line)]">
              <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5 flex items-center gap-1.5"><TrendingUp size={12} /> {t('acc.tel.title', 'BMM telemetry')}</div>
              <p className="text-xs text-[var(--muted)] mb-2">{t('acc.tel.desc', 'Lets this admin open the BMM telemetry dashboard (gated at the edge by a BCWEB login — no separate telemetry key needed).')} {picked.role === 'SUPERADMIN' && <span className="text-[var(--faint)]">{t('acc.tel.super', 'SUPERADMIN always has access.')}</span>}</p>
              <Button size="sm" variant={picked.canViewTelemetry ? 'default' : 'primary'} disabled={busy || picked.role === 'SUPERADMIN'} onClick={toggleTelemetry}>{busy ? <Spinner /> : (picked.canViewTelemetry ? t('acc.tel.revoke', 'Revoke telemetry access') : t('acc.tel.grant', 'Grant telemetry access'))}</Button>
            </div>
          )}

          <div className="pt-4 border-t border-[var(--line)]">
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">{t('acc.blog.title', 'Blog-post access')}</div>
            {userGrants.length > 0 && <div className="flex flex-wrap gap-1.5 mb-2">
              {userGrants.map((g) => <span key={g.id} className="inline-flex items-center gap-1.5 text-xs pl-2.5 pr-1 py-1 rounded-full border border-[var(--line)] bg-[var(--surface-2)]"><PenSquare size={11} className="text-[var(--primary-2)]" /> {scopeLabel(g)} <button onClick={() => revoke(g)} className="opacity-60 hover:opacity-100 hover:text-red-400" title={t('acc.revoke.title', 'Revoke')}><X size={11} /></button></span>)}
            </div>}
            <div className="flex flex-wrap items-center gap-2">
              <Select className="!w-auto" value={scopeSel} onChange={(e) => setScopeSel(e.target.value)}>
                <option value="global">{t('acc.blog.globalopt', 'Global (all blogs)')}</option>
                {(scopes.data?.projects || []).map((pr) => <option key={pr.key} value={`project:${pr.key}`}>{t('acc.blog.projectopt', 'Project · {name}').replace('{name}', pr.name)}</option>)}
                {(scopes.data?.showcases || []).map((s) => <option key={s.slug} value={`showcase:${s.slug}`}>{t('acc.blog.customopt', 'Custom · {name}').replace('{name}', s.name)}</option>)}
              </Select>
              <Button size="sm" variant="primary" disabled={busy} onClick={grantBlog}>{busy ? <Spinner /> : <><Plus size={14} /> {t('acc.grant', 'Grant')}</>}</Button>
            </div>
          </div>
        </Card>
      )}

      <GlobalAccessPolicyCard />

      <div>
        <h2 className="font-semibold mb-1 flex items-center gap-2"><PenSquare size={16} className="text-[var(--primary-2)]" /> {t('acc.all.title', 'All blog-post grants')}</h2>
        <p className="text-sm text-[var(--muted)] mb-3">{t('acc.all.desc', 'Everyone who can write blog posts, and where. Pick a user above to edit theirs.')}</p>
        {grants.loading ? <Loading /> : allGrants.length ? <div className="space-y-1.5">
          {allGrants.map((g) => (
            <Card key={g.id} className="p-3 flex items-center gap-3">
              <Avatar user={g.user} size={32} />
              <div className="flex-1 min-w-0"><div className="font-medium truncate">{g.user?.displayName || t('acc.deleted', '(deleted)')}</div><div className="text-xs text-[var(--faint)] truncate">{g.user?.email}</div></div>
              <Badge tone="primary">{scopeLabel(g)}</Badge>
              <Button size="sm" variant="ghost" className="!text-red-400" onClick={() => revoke(g)}><Trash2 size={13} /></Button>
            </Card>
          ))}
        </div> : <EmptyState icon={PenSquare} title={t('acc.all.none.t', 'No grants yet')} sub={t('acc.all.none.s', "Regular users can't write blog posts until you grant access above.")} />}
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
  const toast = useToast(); const dialog = useDialog(); const { t } = useI18n();
  const { data, loading, reload } = useAsync(() => api.get('/admin/announcements'), []);
  const [f, setF] = useState({ title: '', body: '', tone: 'info', showBanner: true, linkUrl: '' });
  const [busy, setBusy] = useState(false);
  const [broadcastMsg, setBroadcastMsg] = useState('');
  const [broadcastBusy, setBroadcastBusy] = useState(false);
  const announcements = data?.announcements || [];

  const create = async () => {
    if (f.title.length < 2) return toast.error(t('ann.title.req', 'Title is required.'));
    setBusy(true);
    try { const r = await api.post('/admin/announcements', { ...f, linkUrl: f.linkUrl.trim() || null }); toast.success(t('ann.published', 'Published — notified {n} user(s).').replace('{n}', r.notified)); setF({ title: '', body: '', tone: 'info', showBanner: true, linkUrl: '' }); reload(); }
    catch (x) { toast.error(x.data?.error || t('ann.failed', 'Failed.')); } finally { setBusy(false); }
  };
  const toggleActive = async (a) => { try { await api.put(`/admin/announcements/${a.id}`, { active: !a.active }); reload(); } catch { toast.error(t('ann.failed', 'Failed.')); } };
  const toggleBanner = async (a) => { try { await api.put(`/admin/announcements/${a.id}`, { showBanner: !a.showBanner }); reload(); } catch { toast.error(t('ann.failed', 'Failed.')); } };
  const del = async (a) => {
    if (!(await dialog.confirm({ title: t('ann.del.t', 'Delete announcement'), message: t('ann.del.m', 'Delete "{name}"?').replace('{name}', a.title), okLabel: t('ann.del.ok', 'Delete'), danger: true }))) return;
    try { await api.del(`/admin/announcements/${a.id}`); toast.success(t('ann.deleted', 'Deleted.')); reload(); } catch { toast.error(t('ann.failed', 'Failed.')); }
  };
  const notifyAll = async () => {
    if (broadcastMsg.length < 2) return toast.error(t('ann.msg.req', 'Message is required.'));
    if (!(await dialog.confirm({ title: t('ann.notify.confirm.t', 'Notify every user'), message: t('ann.notify.confirm.m', 'This pushes a notification to every registered user immediately. Continue?'), okLabel: t('ann.notify.confirm.ok', 'Send') }))) return;
    setBroadcastBusy(true);
    try { const r = await api.post('/admin/notify-all', { body: broadcastMsg }); toast.success(t('ann.sent', 'Sent to {n} user(s).').replace('{n}', r.notified)); setBroadcastMsg(''); }
    catch (x) { toast.error(x.data?.error || t('ann.failed', 'Failed.')); } finally { setBroadcastBusy(false); }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-semibold mb-1 flex items-center gap-2"><BellIcon size={16} className="text-[var(--primary-2)]" /> {t('ann.new', 'New announcement')}</h2>
        <p className="text-sm text-[var(--muted)] mb-3">{t('ann.new.sub', 'Shows as a dismissible banner on every page and immediately notifies every user.')}</p>
        <Card className="p-4 space-y-3">
          <div className="grid sm:grid-cols-[1fr_auto] gap-3">
            <Field label={t('ann.title', 'Title')}><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={t('ann.title.ph', 'Scheduled maintenance tonight')} /></Field>
            <Field label={t('ann.tone', 'Tone')}><Select value={f.tone} onChange={(e) => setF({ ...f, tone: e.target.value })}><option value="info">{t('ann.tone.info', 'Info')}</option><option value="warning">{t('ann.tone.warning', 'Warning')}</option><option value="success">{t('ann.tone.success', 'Success')}</option></Select></Field>
          </div>
          <Field label={<span className="flex items-center justify-between w-full">{t('ann.body', 'Body (optional)')} <span className={`text-[10px] tabular-nums ${f.body.length > ANN_BODY_MAX ? 'text-red-400' : 'text-[var(--faint)]'}`}>{f.body.length}/{ANN_BODY_MAX}</span></span>}>
            <Textarea value={f.body} maxLength={ANN_BODY_MAX} onChange={(e) => setF({ ...f, body: e.target.value.slice(0, ANN_BODY_MAX) })} placeholder={t('ann.body.ph', 'More detail shown after the title…')} />
          </Field>
          <Field label={t('ann.link', 'Link (optional)')}><Input value={f.linkUrl} onChange={(e) => setF({ ...f, linkUrl: e.target.value })} placeholder={t('ann.link.ph', '/blog/my-post or https://example.com')} /></Field>
          <label className="flex items-center gap-2 text-sm text-[var(--muted)]"><input type="checkbox" checked={f.showBanner} onChange={(e) => setF({ ...f, showBanner: e.target.checked })} /> {t('ann.showbanner', 'Also show as a dismissible site-wide banner (always notifies everyone either way)')}</label>
          <div className="flex justify-end"><Button variant="primary" disabled={busy} onClick={create}>{busy ? <Spinner /> : <><Bell size={15} /> {t('ann.publish', 'Publish & notify everyone')}</>}</Button></div>
        </Card>
      </div>

      <div>
        <h2 className="font-semibold mb-1 flex items-center gap-2"><Send size={16} className="text-[var(--primary-2)]" /> {t('ann.notify.h', 'Notify everyone (no banner)')}</h2>
        <p className="text-sm text-[var(--muted)] mb-3">{t('ann.notify.sub', "A one-off notification pushed to every user's bell menu, with no site-wide banner.")}</p>
        <Card className="p-4 flex flex-col sm:flex-row gap-2">
          <Input className="flex-1" value={broadcastMsg} onChange={(e) => setBroadcastMsg(e.target.value)} placeholder={t('ann.notify.ph', 'A quick message to every user…')} />
          <Button variant="primary" disabled={broadcastBusy} onClick={notifyAll}>{broadcastBusy ? <Spinner /> : <><Send size={15} /> {t('ann.notify.send', 'Send to everyone')}</>}</Button>
        </Card>
      </div>

      <div>
        <h2 className="font-semibold mb-1 flex items-center gap-2"><Bell size={16} className="text-[var(--primary-2)]" /> {t('ann.list', 'Announcements')}</h2>
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
              <Badge tone={a.active ? 'green' : ''}>{a.active ? t('ann.active', 'active') : t('ann.inactive', 'inactive')}</Badge>
              <Button size="sm" variant="ghost" onClick={() => toggleBanner(a)} title={t('ann.bannertitle', 'Toggle the site-wide banner for this announcement')}>{a.showBanner ? <Monitor size={13} /> : <MonitorOff size={13} />} {a.showBanner ? t('ann.banneron', 'Banner on') : t('ann.banneroff', 'No banner')}</Button>
              <Button size="sm" variant="ghost" onClick={() => toggleActive(a)}>{a.active ? t('ann.deactivate', 'Deactivate') : t('ann.activate', 'Activate')}</Button>
              <Button size="sm" variant="ghost" className="!text-red-400" onClick={() => del(a)}><Trash2 size={13} /></Button>
            </Card>
            );
          })}
        </div> : <EmptyState icon={BellIcon} title={t('ann.none', 'No announcements yet')} />}
      </div>
    </div>
  );
}

function UserDetailModal({ id, onClose }) {
  const { data, loading } = useAsync(() => api.get(`/admin/users/${id}`), [id]);
  const toast = useToast(); const { t } = useI18n();
  const u = data?.user;
  const hosted = (u?.serverRepos || []).filter((r) => r.hosted);
  const listed = (u?.serverRepos || []).filter((r) => !r.hosted);
  const fdate = (d) => new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  // Per-element unique BC id chip (copyable) — shown on each repo / catalog item.
  const BcChip = ({ code }) => code ? (
    <button onClick={() => { navigator.clipboard?.writeText(code); toast.success(t('ud.elemcopied', 'Element BC id copied.')); }}
      className="shrink-0 inline-flex items-center gap-1 text-[10px] font-mono text-[var(--faint)] hover:text-[var(--primary-2)] transition" title={t('ud.elemid', 'Unique element id · {c}').replace('{c}', code)}>
      <Fingerprint size={10} /> {code}
    </button>
  ) : null;
  return (
    <Modal open onClose={onClose} title={t('ud.title', 'User details')} icon={Users} width="max-w-lg"
      footer={<Button variant="ghost" onClick={onClose}>{t('su.close', 'Close')}</Button>}>
      {loading ? <Loading /> : !u ? <EmptyState icon={XCircle} title={t('ud.notfound', 'Not found')} /> : (
        <div className="space-y-5">
          <div className="flex items-center gap-4">
            <Avatar user={u} size={64} />
            <div className="min-w-0">
              <div className="text-lg font-bold flex items-center gap-2">{u.displayName} <Badge tone={u.role === 'SUPERADMIN' ? 'red' : u.role === 'ADMIN' ? 'amber' : u.role === 'MOD' ? 'primary' : ''}>{u.role}</Badge></div>
              <div className="text-sm text-[var(--muted)] flex items-center gap-1.5"><Mail size={13} /> {u.email}</div>
              <div className="text-xs text-[var(--faint)] mt-0.5 flex items-center gap-1.5"><Cookie size={12} /> {t('ud.membersince', 'Member since {d}').replace('{d}', fdate(u.createdAt))}</div>
              <div className="text-[11px] text-[var(--faint)] font-mono mt-0.5">{u.id}</div>
              {u.bcId && (
                <button onClick={() => { navigator.clipboard?.writeText(u.bcId); toast.success(t('ud.bccopied', 'Unique BC id copied.')); }}
                  className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-mono font-semibold text-[var(--primary-2)] px-2 py-1 rounded-md bg-[var(--surface-2)] border border-[var(--line)] hover:border-[var(--primary)]/40 transition"
                  title={t('ud.bcidtip', 'Unique BC id — searchable in User search')}>
                  <Fingerprint size={12} /> {u.bcId} <Copy size={11} className="opacity-60" />
                </button>
              )}
            </div>
          </div>
          {u.bio && <p className="text-sm text-[var(--muted)]">{u.bio}</p>}

          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5 flex items-center gap-1.5"><BadgeCheck size={12} /> {t('ud.creatorids', 'Linked creator ids')}</div>
            {u.creatorLinks.length ? <div className="flex flex-wrap gap-1.5">{u.creatorLinks.map((c) => <Badge key={c.creatorId} tone="green"><code>{c.creatorId}</code>{c.displayName ? ` · ${c.displayName}` : ''}</Badge>)}</div>
              : <div className="text-sm text-[var(--faint)]">{t('ud.nocreator', 'No creator id linked.')}</div>}
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5 flex items-center gap-1.5"><DiscordIcon size={12} /> Discord</div>
            {u.discordLinks?.length ? <div className="space-y-1">{u.discordLinks.map((d) => (
              <div key={d.discordId} className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-[var(--surface-2)]">
                <DiscordIcon size={13} className="text-[#5865F2] shrink-0" />
                <span className="font-medium">{d.username || '—'}</span>
                <code className="text-xs text-[var(--faint)]">{d.discordId}</code>
                <span className="text-[11px] text-[var(--faint)] ml-auto shrink-0">{t('ud.linked', 'linked {d}').replace('{d}', fdate(d.linkedAt))}</span>
              </div>
            ))}</div> : <div className="text-sm text-[var(--faint)]">{t('ud.nodiscord', 'No Discord linked.')}</div>}
          </div>

          {u.subscriptions?.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5 flex items-center gap-1.5"><RefreshCw size={12} /> {t('ud.subs', 'Active subscriptions')} · <span className="text-emerald-400 normal-case">≈ ${(u.mrrCents / 100).toFixed(2)}/{t('pu.mo', 'mo')}</span></div>
              <div className="space-y-1">{u.subscriptions.map((s) => {
                const cur = (s.currency || 'usd').toUpperCase(); const sym = cur === 'USD' ? '$' : cur === 'EUR' ? '€' : cur === 'GBP' ? '£' : '';
                const amt = sym ? `${sym}${(s.amountCents / 100).toFixed(2)}` : `${(s.amountCents / 100).toFixed(2)} ${cur}`;
                const per = s.intervalCount > 1 ? `/${s.intervalCount} ${s.interval}` : `/${s.interval}`;
                return (
                  <div key={s.id} className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-[var(--surface-2)]">
                    <RefreshCw size={13} className="text-[var(--primary-2)] shrink-0" />
                    <span className="flex-1 truncate">{s.kind === 'boost' ? t('bill.sub.boost', 'Repo boost subscription') : t('bill.sub.hosting', 'Hosting subscription')}</span>
                    <span className="font-medium shrink-0">{amt} <span className="text-[var(--faint)] font-normal text-xs">{per}</span></span>
                    {s.currentPeriodEnd && <span className="text-[11px] text-[var(--faint)] shrink-0">{fdate(s.currentPeriodEnd)}</span>}
                  </div>
                );
              })}</div>
            </div>
          )}

          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5 flex items-center gap-1.5"><Receipt size={12} /> {t('ud.payments', 'Payments')} ({u.payments?.length || 0})</div>
            {u.payments?.length ? <div className="space-y-1 max-h-40 overflow-auto pr-1">{u.payments.map((pay) => (
              <div key={pay.id} className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-[var(--surface-2)]">
                <Receipt size={13} className="text-emerald-400 shrink-0" />
                <span className="flex-1 truncate">{pay.description}</span>
                <span className="text-emerald-400 font-medium shrink-0">${(pay.amountCents / 100).toFixed(2)}</span>
                <span className="text-[11px] text-[var(--faint)] shrink-0">{fdate(pay.createdAt)}</span>
              </div>
            ))}</div> : <div className="text-sm text-[var(--faint)]">{t('ud.nopayments', 'No payments — free plan only.')}</div>}
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5 flex items-center gap-1.5"><Rocket size={12} /> {t('ud.hosted', 'Hosted repos')} ({hosted.length})</div>
            {hosted.length ? <div className="space-y-1 max-h-40 overflow-auto pr-1">{hosted.map((r) => <div key={r.id} className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-[var(--surface-2)]"><Server size={13} className="text-[var(--primary-2)] shrink-0" /><span className="flex-1 truncate">{r.name}</span><BcChip code={r.fingerprint} /><Badge tone={r.status === 'ONLINE' ? 'green' : ''}>{r.status}</Badge></div>)}</div>
              : <div className="text-sm text-[var(--faint)]">{t('ud.none', 'None.')}</div>}
          </div>

          {listed.length > 0 && <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5 flex items-center gap-1.5"><GitBranch size={12} /> {t('ud.listed', 'Listed repos')} ({listed.length})</div>
            <div className="space-y-1 max-h-40 overflow-auto pr-1">{listed.map((r) => <div key={r.id} className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-[var(--surface-2)]"><GitBranch size={13} className="text-[var(--primary-2)] shrink-0" /><span className="flex-1 truncate">{r.name}</span><BcChip code={r.fingerprint} />{r.verified && <Badge tone="green">{t('ud.verified', 'verified')}</Badge>}</div>)}</div>
          </div>}

          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5 flex items-center gap-1.5"><Package size={12} /> {t('ud.catalogitems', 'Catalog items')} ({u.items.length})</div>
            {u.items.length ? <div className="space-y-1 max-h-40 overflow-auto pr-1">{u.items.map((it) => { const I = KIND_ICON[it.kind] || Package; return <div key={it.id} className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-[var(--surface-2)]"><I size={13} className="text-[var(--primary-2)] shrink-0" /><span className="flex-1 truncate">{it.name}</span><BcChip code={it.fingerprint} /><Badge tone={statusTone(it.status)}>{it.status}</Badge></div>; })}</div>
              : <div className="text-sm text-[var(--faint)]">{t('ud.none', 'None.')}</div>}
          </div>
        </div>
      )}
    </Modal>
  );
}

function PluginContentModal({ item, onClose }) {
  const { data, loading, err } = useAsync(() => api.get(`/admin/catalog/${item.id}/plugin-content`), [item.id]);
  const { t } = useI18n();
  const kb = (n) => (Number(n) / 1024).toFixed(1);
  // Download a single extracted file (same-origin → session cookie is sent).
  const dlFile = (path) => { const a = document.createElement('a'); a.href = `/api/admin/catalog/${item.id}/plugin-file?path=${encodeURIComponent(path)}`; a.download = path.split('/').pop() || 'file'; document.body.appendChild(a); a.click(); a.remove(); };
  // The endpoint 502s when a plugin has no source (no payload / URL) — surface that
  // gracefully instead of crashing on data.valid.
  const errMsg = data?.error ? (data.detail || data.error) : err ? (err.data?.detail || err.data?.error || t('pcm.nosource', 'This plugin has no downloadable source.')) : null;
  return (
    <Modal open onClose={onClose} title={t('pcm.title', 'Plugin content — {n}').replace('{n}', item.name)} icon={Files} width="max-w-2xl"
      footer={<><Button variant="ghost" onClick={onClose}>{t('su.close', 'Close')}</Button>{data?.downloadUrl && <a href={data.downloadUrl} target="_blank" rel="noreferrer"><Button variant="primary"><Download size={15} /> {t('pcm.dlplug', 'Download .bmmplug')}</Button></a>}</>}>
      {loading ? <Loading /> : errMsg ? (
        <div className="flex items-start gap-2.5 text-sm text-[var(--muted)] py-2">
          <XCircle size={18} className="text-amber-400 shrink-0 mt-0.5" />
          <div>{t('pcm.cannotinspect', 'Could not inspect this plugin:')} <b className="text-[var(--text)]">{errMsg}</b>
            <div className="text-xs text-[var(--faint)] mt-1">{t('pcm.nosourcehint', "A plugin with no uploaded file or download URL can't be unzipped. Add a source, then re-validate.")}</div></div>
        </div>
      ) : data ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            {data.valid ? <Badge tone="green"><CheckCircle2 size={11} /> {t('pv.valid', 'Valid')}</Badge> : <Badge tone="red"><XCircle size={11} /> {data.reason}</Badge>}
            <span className="text-[var(--faint)] text-xs">{kb(data.size)} KB · sha {String(data.sha256).slice(0, 16)}…</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)]">{t('pcm.files', 'Files')} ({(data.files || []).length})</span>
            {data.downloadUrl && <a href={data.downloadUrl} target="_blank" rel="noreferrer" className="text-xs text-[var(--primary-2)] hover:underline flex items-center gap-1"><Download size={12} /> {t('pcm.dlall', 'Download all (.bmmplug)')}</a>}
          </div>
          <div className="space-y-1 max-h-[38vh] overflow-auto">
            {(data.files || []).map((fl) => (
              <div key={fl.path} className="group flex items-center gap-2.5 px-3 py-2 rounded-lg bg-[var(--surface-2)] text-sm">
                {fl.ok ? <CheckCircle2 size={14} className="text-emerald-400 shrink-0" /> : <XCircle size={14} className="text-red-400 shrink-0" />}
                <span className="flex-1 truncate font-mono text-xs">{fl.path}</span>
                <span className="text-xs text-[var(--faint)]">{kb(fl.size)} KB</span>
                <button onClick={() => dlFile(fl.path)} title={t('pcm.dlfile', 'Download this file')} className="text-[var(--faint)] hover:text-[var(--primary-2)] shrink-0"><Download size={13} /></button>
              </div>
            ))}
          </div>
          {data.manifest && <div><div className="text-xs font-semibold text-[var(--faint)] uppercase mb-1.5">{t('pcm.manifest', 'plugin.json (never executed)')}</div>
            <pre className="text-xs bg-[var(--surface-2)] rounded-lg p-3 max-h-48 overflow-auto">{JSON.stringify(data.manifest, null, 2)}</pre></div>}
        </div>
      ) : null}
    </Modal>
  );
}

// Admin: provision a hosted repo for free (no Stripe), optionally for another user.
function AdminFreeHost() {
  const toast = useToast(); const { t } = useI18n();
  const plans = useAsync(() => api.get('/hosting/plans'), []);
  const [f, setF] = useState({ name: '', ownerEmail: '', planId: '', storageGB: 10, uploadMbps: 8, listed: false, mode: 'single' });
  const [custom, setCustom] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (f.name.length < 2) return toast.error(t('fh.namereq', 'Repo name is required.'));
    setBusy(true);
    try {
      const body = { name: f.name, listed: f.listed, mode: f.mode };
      if (f.ownerEmail) body.ownerEmail = f.ownerEmail;
      if (custom) { body.storageGB = Number(f.storageGB); body.uploadMbps = Number(f.uploadMbps); }
      else if (f.planId) body.planId = f.planId;
      await api.post('/admin/repos/host', body);
      toast.success((f.mode === 'multi' ? t('fh.provmulti', 'Multi-repo pool "{name}" provisioned.') : t('fh.provsingle', 'Hosted repo "{name}" provisioned. See it under Server repos.')).replace('{name}', f.name));
      setF({ name: '', ownerEmail: '', planId: '', storageGB: 10, uploadMbps: 8, listed: false, mode: 'single' });
    } catch (x) { toast.error(x.data?.error === 'user_not_found' ? t('fh.usernotfound', 'No user with that email.') : x.data?.error || t('common.failed', 'Failed.')); } finally { setBusy(false); }
  };
  return (
    <div>
      <h2 className="font-semibold mb-1 flex items-center gap-2"><Rocket size={16} className="text-[var(--primary-2)]" /> {t('fh.title', 'Host a Server-Repo (free)')}</h2>
      <p className="text-sm text-[var(--muted)] mb-4">{t('fh.sub', 'Provisions a hosted, sandboxed repo directly — no payment. Leave the email blank to host it under your own account.')}</p>
      <Card className="p-5 space-y-3">
        <div className="flex items-center gap-2 text-sm">
          {[['single', t('fh.single', 'Single repo')], ['multi', t('fh.multi', 'Multi-repo pool')]].map(([m, l]) => (
            <button key={m} onClick={() => setF({ ...f, mode: m })} className={`px-3 py-1.5 rounded-lg border ${f.mode === m ? 'border-[var(--primary)] bg-orange-500/10' : 'border-[var(--line)] text-[var(--muted)]'}`}>{l}</button>
          ))}
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label={f.mode === 'multi' ? t('fh.poolname', 'Pool name') : t('fh.reponame', 'Repo name')}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="official-server-repo" /></Field>
          <Field label={t('fh.owneremail', 'Owner email (optional)')}><Input value={f.ownerEmail} onChange={(e) => setF({ ...f, ownerEmail: e.target.value })} placeholder="you@…" /></Field>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <button onClick={() => setCustom(false)} className={`px-3 py-1.5 rounded-lg border ${!custom ? 'border-[var(--primary)] bg-orange-500/10' : 'border-[var(--line)] text-[var(--muted)]'}`}>{t('fh.useplan', 'Use a plan')}</button>
          <button onClick={() => setCustom(true)} className={`px-3 py-1.5 rounded-lg border ${custom ? 'border-[var(--primary)] bg-orange-500/10' : 'border-[var(--line)] text-[var(--muted)]'}`}>{t('fh.customsize', 'Custom size')}</button>
        </div>
        {custom ? (
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label={t('fh.storage', 'Storage (GB)')}><Input type="number" value={f.storageGB} onChange={(e) => setF({ ...f, storageGB: e.target.value })} /></Field>
            <Field label={t('fh.upload', 'Upload (Mbps)')}><Input type="number" value={f.uploadMbps} onChange={(e) => setF({ ...f, uploadMbps: e.target.value })} /></Field>
          </div>
        ) : (
          <Field label={t('fh.plan', 'Plan')}><Select value={f.planId} onChange={(e) => setF({ ...f, planId: e.target.value })}>
            <option value="">{t('fh.selectplan', 'Select a plan…')}</option>
            {(plans.data?.plans || []).map((pl) => <option key={pl.id} value={pl.id}>{pl.name} — {pl.storageGB}GB</option>)}
          </Select></Field>
        )}
        <label className="flex items-center gap-2 text-sm text-[var(--muted)]"><input type="checkbox" checked={f.listed} onChange={(e) => setF({ ...f, listed: e.target.checked })} /> {t('fh.listpub', 'List publicly once verified')}</label>
        <div className="flex justify-end"><Button variant="primary" disabled={busy} onClick={submit}>{busy ? <Spinner /> : <><Rocket size={15} /> {t('fh.provision', 'Provision (free)')}</>}</Button></div>
      </Card>
    </div>
  );
}

const PROJ_META = { community: { icon: Package, name: 'Community' }, bmm: { icon: Boxes, name: 'BMM' }, bsm: { icon: Music2, name: 'BSM' }, installer: { icon: Download, name: 'Installer' } };
function AdminProjects() {
  const toast = useToast(); const { t } = useI18n();
  const { data, reload } = useAsync(() => api.get('/projects'), []);
  // Showcase ("Other projects") are configurable here too — added automatically.
  const show = useAsync(() => api.get('/admin/showcase'), []);
  const adminMeta = useAsync(() => api.get('/admin/projects'), []);
  const [scheduling, setScheduling] = useState(false);
  const [active, setActive] = useState('bmm');
  const [text, setText] = useState('');
  const [progUrl, setProgUrl] = useState('');
  const [editMode, setEditMode] = useState('form'); // 'form' (visual) | 'json' (raw)
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
      setText(JSON.stringify(cfg, null, 2)); toast.success(t('ap.srcsaved', 'Progress source saved.')); reload(); show.reload?.();
    } catch (x) { toast.error(x.data?.error || t('common.savefail', 'Save failed.')); }
  };
  // A change on GitHub (progress.json, release notes…) can sit in the server's
  // 5-min proxy cache — this makes it visible on the site immediately.
  const flushCache = async () => {
    try { const r = await api.post('/admin/projects/flush-cache'); toast.success(t('ap.cacheflushed', 'Site caches refreshed ({n} entries) — repo changes are live now.').replace('{n}', r.flushed)); }
    catch { toast.error(t('common.failed', 'Failed.')); }
  };
  const previewSource = async () => {
    try { const r = await api.get(`/projects/${active}/progress`); const n = (r.progress?.categories || []).reduce((a, c) => a + (c.items?.length || 0), 0); toast.success(t('ap.fetched', 'Fetched progress.json ({n} items).').replace('{n}', n)); }
    catch (x) { toast.error(x.data?.error || x.data?.detail || t('ap.fetchfail', 'Fetch failed.')); }
  };
  let valid = true; try { JSON.parse(text || '{}'); } catch { valid = false; }
  const format = () => { try { setText(JSON.stringify(JSON.parse(text), null, 2)); } catch { toast.error(t('common.invalidjson', 'Invalid JSON.')); } };
  const save = async () => {
    if (!valid) return toast.error(t('common.invalidjson', 'Invalid JSON.'));
    try { await putConfig(JSON.parse(text)); toast.success(t('ap.saved', '{name} saved.').replace('{name}', isShowcase ? activeShow?.name : PROJ_META[active].name)); reload(); show.reload?.(); }
    catch (x) { toast.error(x.data?.error || t('common.savefail', 'Save failed.')); }
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
      toast.success((!showOnHomeNews ? t('ap.homenews.on', '{name} will now show in home Latest news.') : t('ap.homenews.off', '{name} no longer shows in home Latest news.')).replace('{name}', M.name));
      reload(); show.reload?.();
    } catch { toast.error(t('common.failed', 'Failed.')); }
  };
  // Opt-in "Blog" tab on the project's own page, showing only this project's posts.
  const showBlogTab = isShowcase ? (activeShow?.showBlogTab === true) : (data?.blogTab?.[active] === true);
  const toggleBlogTab = async () => {
    try {
      if (isShowcase) await api.put(`/admin/showcase/${activeShow.id}`, { showBlogTab: !showBlogTab });
      else await api.put(`/admin/projects/${active}/blog-tab`, { show: !showBlogTab });
      toast.success((!showBlogTab ? t('ap.blogtab.on', '{name} now shows a Blog tab.') : t('ap.blogtab.off', '{name} no longer shows a Blog tab.')).replace('{name}', M.name));
      reload(); show.reload?.();
    } catch { toast.error(t('common.failed', 'Failed.')); }
  };
  // Visibility gate — every fixed project except 'community' (which is always public).
  const saveVisibility = async (visibility, whitelist) => {
    try { await api.put(`/admin/projects/${active}/visibility`, { visibility, whitelist }); toast.success(t('ap.vissaved', 'Visibility saved.')); adminMeta.reload?.(); }
    catch { toast.error(t('common.failed', 'Failed.')); }
  };
  return (
    <div className="mt-10">
      <h2 className="font-semibold mb-1 flex items-center gap-2"><Settings2 size={16} className="text-[var(--primary-2)]" /> {t('ap.title', 'Projects config')}</h2>
      <p className="text-sm text-[var(--muted)] mb-4">{t('ap.sub', 'Configure downloads, links, contributors & messages, the progress tracker, legal docs, and the GitHub release-notes source — per project.')}</p>
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
            <ShowcaseIcon icon={s.icon} size={14} fallback={<Sparkles size={14} />} /> {s.name}
          </button>
        ))}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={flushCache} title="Repo changes (progress.json, release notes, links) can sit in a 5-min cache — this applies them now.">
          <RefreshCw size={13} /> {t('ap.refreshcaches', 'Refresh site caches')}
        </Button>
      </div>
      {/* Progress tracker source: pull the project's progress.json from a URL. */}
      <Card className="p-4 mb-4">
        <div className="flex items-center gap-2 mb-2"><TrendingUp size={15} className="text-[var(--primary-2)]" /><span className="font-medium text-sm">{t('ap.progsrc', 'Progress tracker source')}</span></div>
        <p className="text-xs text-[var(--muted)] mb-3">A raw URL to a <code>progress.json</code> ({'{ lastUpdate, art, code, categories:[{ name, items:[{ label, status, percent }] }] }'}). Rendered live on the project page; leave empty to use the inline <code>progress</code> in the config below.</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input className="flex-1" value={progUrl} onChange={(e) => setProgUrl(e.target.value)} placeholder="https://raw.githubusercontent.com/…/progress.json" />
          <div className="flex gap-2">
            <Button variant="ghost" onClick={previewSource} disabled={!progUrl.trim()}><Globe size={14} /> {t('ap.test', 'Test')}</Button>
            <Button variant="primary" onClick={saveSource}><CheckCircle2 size={14} /> {t('ap.savesource', 'Save source')}</Button>
          </div>
        </div>
      </Card>
      <Card className="p-4 mb-4 flex items-center gap-3">
        <Newspaper size={15} className="text-[var(--primary-2)] shrink-0" />
        <div className="flex-1"><span className="font-medium text-sm">{t('ap.homenews', 'Show in home "Latest news"')}</span><p className="text-xs text-[var(--muted)]">{t('ap.homenews.d', "{name}'s posts always appear on /blog regardless of this — this only controls the home page feed.").replace('{name}', M.name)}</p></div>
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
      {/* Existing scheduled update (a single staged content swap per page) — visible
          here with Edit (reopens the form pre-filled) + Cancel (clears the schedule). */}
      {(() => {
        const sched = isShowcase ? activeShow : activeMeta;
        if (!sched?.scheduledAt) return null;
        const when = new Date(sched.scheduledAt);
        const due = when.getTime() <= Date.now();
        const nx = sched.scheduledNext || {};
        const parts = [nx.name && `name → “${nx.name}”`, nx.short && `short → “${nx.short}”`, nx.config && t('apj.configchanges', 'config changes')].filter(Boolean);
        const cancelSchedule = async () => {
          try {
            if (isShowcase) await api.put(`/admin/showcase/${activeShow.id}/schedule`, { at: null });
            else await api.put(`/admin/projects/${active}/schedule`, { at: null });
            toast.success(t('apj.schedcancelled', 'Scheduled update cancelled.')); reload(); show.reload?.(); adminMeta.reload?.();
          } catch { toast.error(t('apj.cannotcancel', 'Could not cancel.')); }
        };
        return (
          <div className={`mb-3 rounded-xl border px-3.5 py-2.5 flex items-start gap-2.5 ${due ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-[var(--primary)]/40 bg-[var(--primary)]/8'}`}>
            <Clock size={16} className={`shrink-0 mt-0.5 ${due ? 'text-emerald-400' : 'text-[var(--primary-2)]'}`} />
            <div className="flex-1 min-w-0 text-sm">
              <div className="font-medium">{due ? t('apj.scheddue', 'Scheduled update is due') : t('apj.schedpending', 'Scheduled update pending')} <span className="font-normal text-[var(--muted)]">· {when.toLocaleString()}</span></div>
              <div className="text-xs text-[var(--faint)]">{parts.length ? t('apj.willapply', 'Will apply: {p}.').replace('{p}', parts.join(', ')) : t('apj.stagedupdate', 'A staged content update.')}{due ? t('apj.appliesnext', ' It applies on the next public view of the page.') : ''}</div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button size="sm" variant="ghost" onClick={() => { if (nx.config) setText(JSON.stringify(nx.config, null, 2)); setScheduling(true); }} title={t('apj.loadstaged', 'Load the staged content into the editor and reschedule')}><PenSquare size={13} /> {t('sh.editbtn', 'Edit')}</Button>
              <Button size="sm" variant="ghost" className="!text-red-400" onClick={cancelSchedule}><X size={13} /> {t('su.cancel', 'Cancel')}</Button>
            </div>
          </div>
        );
      })()}
      <div className="flex justify-end mb-4">
        <Button size="sm" variant="ghost" onClick={() => setScheduling(true)} title={t('apj.stagefuture', 'Stage a future content swap for this page')}><Clock size={13} /> {(isShowcase ? activeShow : activeMeta)?.scheduledAt ? t('apj.reschedule', 'Reschedule') : t('sh.schedtip', 'Schedule an update')}</Button>
      </div>
      <div className="rounded-2xl overflow-hidden border border-[var(--line)]" style={{ boxShadow: 'var(--shadow)' }}>
        <div className="flex items-center justify-between gap-2 px-4 py-2.5 code-chrome flex-wrap">
          <div className="flex items-center gap-2 text-sm font-medium text-[var(--text)]"><M.icon size={15} className="text-orange-400" /> {M.name}</div>
          <div className="flex items-center gap-2">
            {/* Visual form is the default; raw JSON stays as an advanced escape hatch. */}
            <div className="inline-flex rounded-lg border border-[var(--line)] p-0.5 text-xs">
              {[['form', t('su.visual', 'Visual')], ['json', 'JSON']].map(([m, label]) => (
                <button key={m} type="button" onClick={() => setEditMode(m)} disabled={m === 'form' && !valid}
                  className={`px-2.5 py-1 rounded-md ${editMode === m ? 'bg-[var(--surface-2)] text-[var(--text)]' : 'text-[var(--muted)]'} ${m === 'form' && !valid ? 'opacity-40 cursor-not-allowed' : ''}`}>{label}</button>
              ))}
            </div>
            {editMode === 'json' && <Badge tone={valid ? 'green' : 'red'}>{valid ? t('apj.validjson', 'valid JSON') : t('apj.invalidjson', 'invalid JSON')}</Badge>}
            {editMode === 'json' && <Button size="sm" variant="ghost" onClick={format}>{t('apj.format', 'Format')}</Button>}
            <Button size="sm" variant="primary" disabled={!valid} onClick={save}>{t('common.save', 'Save')}</Button>
          </div>
        </div>
        {editMode === 'form' ? (
          valid
            ? <div className="p-3 bg-[var(--bg-solid)] max-h-[70vh] overflow-auto">
                <ProjectConfigEditor value={JSON.parse(text || '{}')} onChange={(cfg) => setText(JSON.stringify(cfg, null, 2))}
                  slug={isShowcase ? activeShow?.slug : active} isShowcase={isShowcase} />
              </div>
            : <div className="p-6 text-sm text-[var(--muted)] bg-[var(--bg-solid)]">The raw JSON is currently invalid — switch to the JSON tab to fix it, then come back.</div>
        ) : (
          <>
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
          </>
        )}
      </div>
      {scheduling && (() => {
        let cfg = {}; try { cfg = JSON.parse(text || '{}'); } catch { /* editor currently has invalid JSON — schedule form starts from {} */ }
        const existing = isShowcase ? activeShow : activeMeta;
        return (
          <ScheduleUpdateModal title={`Schedule an update — ${M.name}`} includeNameShort={isShowcase} existing={existing}
            slug={isShowcase ? activeShow?.slug : active} isShowcase={isShowcase}
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
const OS_SLUG = {
  Windows: null, macOS: 'apple/A2AAAD', iOS: 'apple/A2AAAD', Android: 'android/3DDC84',
  Linux: 'linux/FCC624', Ubuntu: 'ubuntu/E95420', Fedora: 'fedora/51A2DA', Debian: 'debian/A81D33',
  Kali: 'kalilinux/557C94', Arch: 'archlinux/1793D1', Manjaro: 'manjaro/35BF5C',
  'Linux Mint': 'linuxmint/87CF3E', SteamOS: 'steamdeck/1A9FFF', ChromeOS: 'googlechrome/4285F4',
};

function Breakdown({ title, rows, iconOf }) {
  const { t } = useI18n();
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
        )) : <div className="text-sm text-[var(--faint)]">{t('an.nodata', 'No data yet.')}</div>}
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
  const toast = useToast(); const { t } = useI18n();
  const { data, loading, reload } = useAsync(() => api.get('/admin/contact'), []);
  const msgs = data?.messages || [];
  const markRead = async (m) => { if (m.readAt) return; try { await api.post(`/admin/contact/${m.id}/read`); reload(); } catch {} };
  const del = async (m) => { try { await api.del(`/admin/contact/${m.id}`); toast.success(t('common.deleted', 'Deleted.')); reload(); } catch { toast.error(t('common.failed', 'Failed.')); } };
  if (loading) return <Loading />;
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold flex items-center gap-2"><Mail size={16} className="text-[var(--primary-2)]" /> {t('am.title', 'Contact messages')} {data?.unread > 0 && <Badge tone="amber">{t('am.new', '{n} new').replace('{n}', data.unread)}</Badge>}</h2>
        <Button size="sm" variant="ghost" onClick={reload}><RefreshCw size={14} /> {t('am.refresh', 'Refresh')}</Button>
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
                  {!m.readAt && <Badge tone="amber">{t('am.newbadge', 'new')}</Badge>}
                  <span className="text-xs text-[var(--faint)] ml-auto">{new Date(m.createdAt).toLocaleString()}</span>
                </div>
                <div className="text-sm text-[var(--muted)] mt-1.5 break-words prose-sm"><Markdown>{m.body}</Markdown></div>
                <div className="flex items-center gap-2 mt-2.5">
                  <a href={`mailto:${m.email}?subject=${encodeURIComponent(t('am.replysubj', 'Re: your message to BetterCommunity'))}`}><Button size="sm"><Send size={13} /> {t('am.reply', 'Reply')}</Button></a>
                  <Button size="sm" variant="ghost" onClick={() => del(m)}><Trash2 size={13} /> {t('am.delete', 'Delete')}</Button>
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div> : <EmptyState icon={Mail} title={t('am.none.t', 'No messages')} sub={t('am.none.s', 'Contact-form submissions will appear here.')} />}
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
  const toast = useToast(); const { t } = useI18n();
  const it = sub.item || {}; const meta = it.meta || {};
  const dl = meta.download_url || meta.downloadUrl || null;
  const [tags, setTags] = useState(sub.tags || []);
  const [tagInput, setTagInput] = useState('');
  const [comments, setComments] = useState(sub.comments || []);
  const [commentInput, setCommentInput] = useState('');
  const [busy, setBusy] = useState(false);
  const rows = [
    [t('sr.kind', 'Kind'), it.kind], [t('sr.version', 'Version'), it.version && `v${it.version}`], [t('sr.project', 'Project'), it.project?.key?.toUpperCase()],
    [t('sr.author', 'Author'), `${it.owner?.displayName || '—'}${it.owner?.email ? ` · ${it.owner.email}` : ''}`], [t('sr.slug', 'Slug'), it.slug], [t('sr.subtype', 'Submission type'), sub.type],
  ].filter(([, v]) => v);

  const saveTags = async (next) => {
    setTags(next);
    try { await api.put(`/mod/submissions/${sub.id}/tags`, { tags: next }); reload?.(); } catch { toast.error(t('common.failed', 'Failed.')); }
  };
  const addTag = () => { const x = tagInput.trim(); if (x && !tags.includes(x)) saveTags([...tags, x]); setTagInput(''); };
  const removeTag = (x) => saveTags(tags.filter((tg) => tg !== x));

  const addComment = async () => {
    const body = commentInput.trim();
    if (!body) return;
    setBusy(true);
    try { const r = await api.post(`/mod/submissions/${sub.id}/comments`, { body }); setComments((c) => [...c, r.comment]); setCommentInput(''); reload?.(); }
    catch { toast.error(t('common.failed', 'Failed.')); } finally { setBusy(false); }
  };
  const removeComment = async (cid) => {
    try { await api.del(`/mod/submissions/${sub.id}/comments/${cid}`); setComments((c) => c.filter((x) => x.id !== cid)); reload?.(); } catch { toast.error(t('common.failed', 'Failed.')); }
  };

  return (
    <Modal open onClose={onClose} title={t('sr.title', 'Review — {n}').replace('{n}', it.name)} icon={Eye} width="max-w-2xl"
      footer={<><Button variant="ghost" onClick={onClose}>{t('su.close', 'Close')}</Button><Button onClick={onReject}><XCircle size={15} /> {t('sr.reject', 'Reject')}</Button><Button variant="primary" onClick={onApprove}><CheckCircle2 size={15} /> {t('sr.approve', 'Approve')}</Button></>}>
      <div className="grid sm:grid-cols-2 gap-x-4 gap-y-2.5 text-sm mb-4">
        {rows.map(([k, v]) => <div key={k} className="min-w-0"><span className="text-[var(--faint)] text-xs">{k}</span><div className="font-medium truncate">{v}</div></div>)}
      </div>
      {it.description && <div className="mb-4"><div className="text-xs text-[var(--faint)] uppercase font-semibold mb-1">{t('cc.description', 'Description')}</div><p className="text-sm text-[var(--muted)] whitespace-pre-wrap">{it.description}</p></div>}
      {it.tags?.length > 0 && <div className="flex flex-wrap gap-1.5 mb-4">{it.tags.map((tg) => <Badge key={tg}><Tag size={10} /> {tg}</Badge>)}</div>}

      <div className="mb-4 p-3 rounded-lg bg-[var(--surface-2)] border border-[var(--line)]">
        <div className="text-xs font-semibold text-[var(--faint)] uppercase mb-1.5 flex items-center gap-1.5"><Tag size={11} /> {t('sr.modtags', 'Internal mod tags')} <span className="normal-case font-normal">{t('sr.modtagsnote', '(never shown to the author)')}</span></div>
        <div className="flex gap-1.5 mb-2">
          <Input value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder={t('sr.tagph', 'e.g. priority, needs-rework…')} onKeyDown={(e) => e.key === 'Enter' && addTag()} />
          <Button size="sm" onClick={addTag}><Plus size={13} /></Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {tags.length ? tags.map((tg) => <span key={tg} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-500">{tg}<button onClick={() => removeTag(tg)} className="hover:text-red-400"><X size={10} /></button></span>) : <span className="text-xs text-[var(--faint)]">{t('sr.none', 'None')}</span>}
        </div>
      </div>

      <div className="mb-4">
        <div className="text-xs font-semibold text-[var(--faint)] uppercase mb-1.5 flex items-center gap-1.5"><MessageSquare size={11} /> {t('sr.modcomments', 'Mod comments')} <span className="normal-case font-normal">{t('sr.modcommentsnote', '(internal, 200 char max)')}</span></div>
        <div className="space-y-1.5 mb-2 max-h-40 overflow-auto">
          {comments.length ? comments.map((c) => (
            <div key={c.id} className="flex items-start gap-2 text-sm bg-[var(--surface-2)] rounded-lg px-3 py-2">
              <div className="flex-1 min-w-0"><span className="font-medium">{c.author?.displayName || '—'}</span> <span className="text-[var(--muted)]">{c.body}</span></div>
              <button onClick={() => removeComment(c.id)} className="text-[var(--faint)] hover:text-red-400 shrink-0"><X size={12} /></button>
            </div>
          )) : <div className="text-xs text-[var(--faint)]">{t('sr.nocomments', 'No comments yet.')}</div>}
        </div>
        <div className="flex gap-1.5">
          <Input value={commentInput} onChange={(e) => setCommentInput(e.target.value.slice(0, 200))} placeholder={t('sr.commentph', 'Leave a note for other moderators…')} onKeyDown={(e) => e.key === 'Enter' && addComment()} />
          <Button size="sm" disabled={busy} onClick={addComment}>{busy ? <Spinner /> : <Send size={13} />}</Button>
        </div>
        <div className="text-[10px] text-[var(--faint)] mt-1 text-right">{commentInput.length}/200</div>
      </div>

      {dl && <div className="mb-4 flex items-center gap-2 rounded-lg bg-[var(--surface-2)] border border-[var(--line)] px-3 py-2"><Download size={14} className="text-[var(--primary-2)] shrink-0" /><a href={dl} target="_blank" rel="noreferrer" className="text-xs text-[var(--primary-2)] break-all flex-1 hover:underline">{dl}</a></div>}
      {meta.validation && <div className="mb-4"><div className="text-xs font-semibold text-[var(--faint)] uppercase mb-1.5 flex items-center gap-2">{t('sr.pluginval', 'Plugin validation')} {meta.validation.valid ? <Badge tone="green"><CheckCircle2 size={10} /> {t('sr.valid', 'valid')}</Badge> : <Badge tone="red"><XCircle size={10} /> {t('sr.invalid', 'invalid')}</Badge>}</div><pre className="text-xs bg-[var(--surface-2)] rounded-lg p-3 max-h-40 overflow-auto">{JSON.stringify(meta.validation, null, 2)}</pre></div>}
      {Object.keys(meta).length > 0 && <div><div className="text-xs font-semibold text-[var(--faint)] uppercase mb-1.5">{t('sr.fullmeta', 'Full metadata (review before approving)')}</div><pre className="text-xs bg-[var(--surface-2)] rounded-lg p-3 max-h-56 overflow-auto">{JSON.stringify(meta, null, 2)}</pre></div>}
    </Modal>
  );
}

// Admin: generate + manage promo codes (discount / free hosting / free boost).
function AdminKofi() {
  const toast = useToast(); const { t } = useI18n();
  const { data, loading, reload } = useAsync(() => api.get('/admin/kofi/settings'), []);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [grantBusy, setGrantBusy] = useState(false);
  const save = async () => {
    if (!token.trim()) return;
    setBusy(true);
    try { await api.put('/admin/kofi/settings', { token: token.trim() }); toast.success(t('common.saved', 'Saved.')); setToken(''); reload(); }
    catch { toast.error(t('common.failed', 'Failed.')); } finally { setBusy(false); }
  };
  const grant = async () => {
    if (!email.trim()) return;
    setGrantBusy(true);
    try { const r = await api.post('/admin/kofi/grant', { email: email.trim() }); toast.success(t('kf.granted', 'Granted — code {c}.').replace('{c}', r.code)); setEmail(''); }
    catch (x) { toast.error(x.data?.error === 'no_matching_account' ? t('kf.noaccount', 'No account with that email.') : x.data?.error === 'already_granted' ? t('kf.alreadygranted', 'Already granted for this account.') : t('common.failed', 'Failed.')); }
    finally { setGrantBusy(false); }
  };
  if (loading) return <Loading />;
  return (
    <>
      <Card className="p-4 mb-4">
        <div className="flex items-center gap-2 mb-1 text-sm font-semibold"><KofiIcon size={16} className="text-[var(--primary-2)]" /> {t('kf.title', 'Ko-fi donor rewards')}</div>
        <p className="text-xs text-[var(--muted)] mb-3" dangerouslySetInnerHTML={{ __html: t('kf.sub', "A donor whose Ko-fi email matches their BetterCommunity account automatically gets a one-time {off}% hosting discount code (valid on {min}+ month plans). Paste this webhook URL + a secret token into Ko-fi's <b>Settings → Webhooks</b>, using the same token below.").replace('{off}', data?.percentOff ?? 25).replace('{min}', data?.minMonths ?? 12) }} />
        <div className="flex items-center gap-2 mb-3 text-xs">
          <code className="flex-1 bg-[var(--surface-2)] rounded-lg px-2.5 py-1.5 truncate">{data?.webhookUrl}</code>
          <Button size="sm" onClick={() => { navigator.clipboard?.writeText(data?.webhookUrl || ''); toast.success(t('common.copied', 'Copied.')); }}><Copy size={12} /></Button>
        </div>
        {data?.fromEnv ? (
          <div className="mb-4 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--muted)] flex items-center gap-2"><Lock size={13} className="text-[var(--primary-2)] shrink-0" /> {t('kf.tokenenv', 'The verification token is set via the KOFI_WEBHOOK_TOKEN environment variable and is managed outside the dashboard.')}</div>
        ) : (
          <div className="grid sm:grid-cols-[1fr_auto] gap-2 mb-4">
            <Input value={token} onChange={(e) => setToken(e.target.value)} placeholder={data?.configured ? t('kf.tokenset', 'Token configured — enter a new one to replace it') : t('kf.tokenph', 'Ko-fi verification token')} />
            <Button variant="primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : t('kf.savetoken', 'Save token')}</Button>
          </div>
        )}
        {data?.configured && <Badge tone="green" className="mb-3"><CheckCircle2 size={11} /> {data?.fromEnv ? t('kf.configuredenv', 'Configured via env') : t('kf.configured', 'Webhook configured')}</Badge>}
        <div className="pt-3 border-t border-[var(--line)]">
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">{t('kf.manualgrant', 'Manual grant')}</div>
          <p className="text-xs text-[var(--muted)] mb-2">{t('kf.manualsub', 'For a donation you verified by hand (e.g. before the webhook was set up).')}</p>
          <div className="grid sm:grid-cols-[1fr_auto] gap-2">
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="donor@email.com" />
            <Button disabled={grantBusy} onClick={grant}>{grantBusy ? <Spinner /> : t('kf.grantcode', 'Grant 25% code')}</Button>
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
  const toast = useToast(); const dialog = useDialog(); const { t } = useI18n();
  const { data, loading, reload } = useAsync(() => api.get('/admin/kofi/goal'), []);
  const [f, setF] = useState({ title: '', targetAmount: '', currency: 'USD' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data?.goal) setF({ title: data.goal.title || '', targetAmount: String(data.goal.targetAmount ?? ''), currency: data.goal.currency || 'USD' }); }, [data]);
  const save = async () => {
    const amt = Number(f.targetAmount);
    if (!(amt > 0)) return toast.error(t('kg.amt.req', 'Target amount must be greater than 0.'));
    setBusy(true);
    try { await api.put('/admin/kofi/goal', { title: f.title.trim(), targetAmount: amt, currency: f.currency.trim() || 'USD' }); toast.success(t('kg.saved', 'Goal saved — now visible on the homepage.')); reload(); }
    catch { toast.error(t('common.failed', 'Failed.')); } finally { setBusy(false); }
  };
  const clear = async () => {
    if (!(await dialog.confirm({ title: t('kg.rm.t', 'Remove funding goal'), message: t('kg.rm.m', 'The public widget will disappear from the homepage. The running total/tip count keep accumulating in the background.'), okLabel: t('kg.rm.ok', 'Remove') }))) return;
    try { await api.del('/admin/kofi/goal'); toast.success(t('common.removed', 'Removed.')); setF({ title: '', targetAmount: '', currency: 'USD' }); reload(); }
    catch { toast.error(t('common.failed', 'Failed.')); }
  };
  if (loading) return <Loading />;
  const pct = data?.goal ? Math.min(100, Math.round((data.totalAmount / data.goal.targetAmount) * 100)) : 0;
  return (
    <Card className="p-4 mb-4">
      <div className="flex items-center gap-2 mb-1 text-sm font-semibold"><Target size={16} className="text-[var(--primary-2)]" /> {t('kg.title', 'Funding goal (public widget)')}</div>
      <p className="text-xs text-[var(--muted)] mb-3">{t('kg.sub', 'Shown on the homepage with the running total raised + number of tips, sourced from Ko-fi webhook events. Set a target to turn it on.')}</p>
      <div className="rounded-xl bg-[var(--surface-2)] p-3 mb-3 flex items-center gap-4 text-sm">
        <div><span className="text-[var(--faint)]">{t('kg.raised', 'Raised so far:')}</span> <b>{(data?.totalAmount || 0).toFixed(2)} {f.currency || 'USD'}</b></div>
        <div><span className="text-[var(--faint)]">{t('kg.tips', 'Tips:')}</span> <b>{data?.tipCount ?? 0}</b></div>
      </div>
      <div className="grid sm:grid-cols-[1fr_auto_auto] gap-2 mb-2">
        <Field label={t('kg.f.title', 'Title (optional)')}><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={t('kg.f.title.ph', 'Help us cover server costs')} /></Field>
        <Field label={t('kg.f.target', 'Target')}><Input type="number" min="1" value={f.targetAmount} onChange={(e) => setF({ ...f, targetAmount: e.target.value })} placeholder="500" className="w-28" /></Field>
        <Field label={t('kg.f.currency', 'Currency')}><Input value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} placeholder="USD" className="w-20" /></Field>
      </div>
      {data?.goal && (
        <div className="mb-3">
          <div className="h-2 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-400" style={{ width: `${pct}%` }} /></div>
          <div className="text-xs text-[var(--faint)] mt-1">{t('kg.pct', '{p}% of {a} {c} goal — live on the homepage').replace('{p}', pct).replace('{a}', data.goal.targetAmount).replace('{c}', data.goal.currency)}</div>
        </div>
      )}
      <div className="flex gap-2">
        <Button variant="primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : data?.goal ? t('kg.update', 'Update goal') : t('kg.publish', 'Publish goal')}</Button>
        {data?.goal && <Button variant="ghost" className="!text-red-400" onClick={clear}>{t('kg.remove', 'Remove')}</Button>}
      </div>
    </Card>
  );
}

// Admin: generate + manage promo codes (discount / free hosting / free boost).
function AdminPromo() {
  const toast = useToast(); const { t } = useI18n();
  const { data, loading, reload } = useAsync(() => api.get('/admin/promo'), []);
  const [f, setF] = useState({ kind: 'discount', code: '', percentOff: 20, freeMonths: 0, minMonths: 0, storageGB: 10, uploadMbps: 8, hostMonths: 0, boostDays: 7, maxRedemptions: '', perUserLimit: 1, stackable: false, assignType: 'email', assignInput: '', assignedTokens: [], note: '' });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const codes = data?.codes || [];
  const addToken = () => setF((s) => {
    const val = s.assignInput.trim(); if (!val) return s;
    const norm = s.assignType === 'email' ? val.toLowerCase() : val;
    const tok = `${s.assignType}:${norm}`;
    return s.assignedTokens.includes(tok) ? { ...s, assignInput: '' } : { ...s, assignedTokens: [...s.assignedTokens, tok], assignInput: '' };
  });
  const removeToken = (tok) => setF((s) => ({ ...s, assignedTokens: s.assignedTokens.filter((x) => x !== tok) }));
  const create = async () => {
    const body = { kind: f.kind, code: f.code.trim() || undefined, perUserLimit: Number(f.perUserLimit) || 1, stackable: !!f.stackable, ...(f.assignedTokens.length ? { assignedTokens: f.assignedTokens } : {}), note: f.note || undefined, maxRedemptions: f.maxRedemptions ? Number(f.maxRedemptions) : null };
    if (f.kind === 'discount') { if (Number(f.percentOff)) body.percentOff = Number(f.percentOff); if (Number(f.freeMonths)) body.freeMonths = Number(f.freeMonths); if (Number(f.minMonths)) body.minMonths = Number(f.minMonths); }
    if (f.kind === 'free_hosting') { body.storageGB = Number(f.storageGB); if (Number(f.uploadMbps)) body.uploadMbps = Number(f.uploadMbps); if (Number(f.hostMonths)) body.hostMonths = Number(f.hostMonths); }
    if (f.kind === 'free_boost') body.boostDays = Number(f.boostDays);
    try { const r = await api.post('/admin/promo', body); toast.success(t('pc.created', 'Code {code} created.').replace('{code}', r.code.code)); setF((s) => ({ ...s, code: '', assignedTokens: [], assignInput: '' })); reload(); }
    catch (x) { toast.error(x.data?.error === 'discount_needs_value' ? t('pc.err.discount', 'Set a % off or free months.') : x.data?.error === 'code_exists' ? t('pc.err.exists', 'That code already exists.') : x.data?.error === 'hosting_needs_storage' ? t('pc.err.storage', 'Set the storage GB.') : x.data?.error === 'boost_needs_days' ? t('pc.err.boost', 'Set the boost days.') : t('common.failed', 'Failed.')); }
  };
  const toggle = async (c) => { try { await api.patch(`/admin/promo/${c.id}`, { active: !c.active }); reload(); } catch { toast.error(t('common.failed', 'Failed.')); } };
  const toggleStack = async (c) => { try { await api.patch(`/admin/promo/${c.id}`, { stackable: !c.stackable }); reload(); } catch { toast.error(t('common.failed', 'Failed.')); } };
  const del = async (c) => { try { await api.del(`/admin/promo/${c.id}`); reload(); } catch { toast.error(t('common.failed', 'Failed.')); } };
  const [openId, setOpenId] = useState(null);
  const [reds, setReds] = useState({});
  const viewReds = async (c) => {
    if (openId === c.id) { setOpenId(null); return; }
    setOpenId(c.id);
    if (!reds[c.id]) { try { const r = await api.get(`/admin/promo/${c.id}/redemptions`); setReds((s) => ({ ...s, [c.id]: r.redemptions })); } catch { toast.error(t('common.loadfail', 'Failed to load.')); } }
  };
  const desc = (c) => c.kind === 'discount' ? [c.percentOff && t('pc.d.off', '{n}% off').replace('{n}', c.percentOff), c.freeMonths && t('pc.d.mofree', '{n} mo free').replace('{n}', c.freeMonths), c.minMonths && t('pc.d.minterm', '{n}mo+ term only').replace('{n}', c.minMonths)].filter(Boolean).join(' + ')
    : c.kind === 'free_hosting' ? `${c.storageGB}GB${c.uploadMbps ? ` · ${c.uploadMbps}Mbps` : ''}${c.hostMonths ? ` · ${c.hostMonths}mo` : ` · ${t('pc.d.forever', 'forever')}`}`
    : t('pc.d.boost', 'boost {n} days').replace('{n}', c.boostDays);
  return (
    <div>
      <h2 className="font-semibold mb-1 flex items-center gap-2"><Ticket size={16} className="text-[var(--primary-2)]" /> {t('pc.title', 'Promo codes')}</h2>
      <p className="text-xs text-[var(--muted)] mb-3">{t('pc.sub', 'Single-use / limited discount, free-hosting and boost codes — separate from the site-wide Promotions above.')}</p>
      <Card className="p-4 mb-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label={t('pc.f.type', 'Type')}><Dropdown className="w-full" value={f.kind} onChange={(v) => set('kind', v)} options={[{ value: 'discount', label: t('pc.t.discount', 'Discount (% off / months free)') }, { value: 'free_hosting', label: t('pc.t.hosting', 'Free hosting') }, { value: 'free_boost', label: t('pc.t.boost', 'Free boost') }]} /></Field>
          <Field label={t('pc.f.code', 'Code (blank = auto-generate)')}><Input value={f.code} onChange={(e) => set('code', e.target.value)} placeholder="AUTO" /></Field>
          {f.kind === 'discount' && <><Field label={t('pc.f.pctoff', '% off')}><Input type="number" value={f.percentOff} onChange={(e) => set('percentOff', e.target.value)} /></Field><Field label={t('pc.f.freemonths', 'First months free')}><Input type="number" value={f.freeMonths} onChange={(e) => set('freeMonths', e.target.value)} /></Field><Field label={t('pc.f.minterm', 'Min. term months (0 = any)')}><Input type="number" value={f.minMonths} onChange={(e) => set('minMonths', e.target.value)} /></Field></>}
          {f.kind === 'free_hosting' && <><Field label={t('pc.f.storage', 'Storage GB')}><Input type="number" value={f.storageGB} onChange={(e) => set('storageGB', e.target.value)} /></Field><Field label={t('pc.f.upload', 'Upload Mbps')}><Input type="number" value={f.uploadMbps} onChange={(e) => set('uploadMbps', e.target.value)} /></Field><Field label={t('pc.f.duration', 'Duration (months, 0 = forever)')}><Input type="number" value={f.hostMonths} onChange={(e) => set('hostMonths', e.target.value)} /></Field></>}
          {f.kind === 'free_boost' && <Field label={t('pc.f.boostdays', 'Boost days')}><Input type="number" value={f.boostDays} onChange={(e) => set('boostDays', e.target.value)} /></Field>}
          <Field label={t('pc.f.maxred', 'Max redemptions (blank = ∞)')}><Input type="number" value={f.maxRedemptions} onChange={(e) => set('maxRedemptions', e.target.value)} placeholder="∞" /></Field>
          <Field label={t('pc.f.peruser', 'Per-user limit')}><Input type="number" value={f.perUserLimit} onChange={(e) => set('perUserLimit', e.target.value)} /></Field>
          <Field label={t('pc.f.note', 'Note (internal)')}><Input value={f.note} onChange={(e) => set('note', e.target.value)} placeholder={t('pc.f.note.ph', 'e.g. launch promo')} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-[var(--muted)] mt-3 cursor-pointer w-fit" title={t('pc.f.stackable.h', 'Allow this code to be combined with OTHER stackable codes in one cart. Non-stackable codes must be used alone.')}>
          <input type="checkbox" checked={f.stackable} onChange={(e) => set('stackable', e.target.checked)} /> {t('pc.f.stackable', 'Stackable — can be combined with other stackable codes')}
        </label>
        <div className="mt-3">
          <Field label={t('pc.f.assign', 'Assign to specific people (gift code)')} hint={t('pc.f.assign.h2', 'If set, ONLY people matching one of these identifiers can redeem. No linked account required — it unlocks the moment that email / Discord id / creator id / BCWEB id belongs to the signed-in account. Leave empty for anyone.')}>
            <div className="flex flex-col sm:flex-row gap-2">
              <Select className="sm:!w-44" value={f.assignType} onChange={(e) => set('assignType', e.target.value)}>
                <option value="email">{t('pc.assign.email', 'Email')}</option>
                <option value="discord">{t('pc.assign.discord', 'Discord id')}</option>
                <option value="creator">{t('pc.assign.creator', 'BMM creator id')}</option>
                <option value="bcid">{t('pc.assign.bcid', 'BCWEB user id')}</option>
              </Select>
              <Input value={f.assignInput} onChange={(e) => set('assignInput', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addToken())} placeholder={f.assignType === 'email' ? 'user@email.com' : f.assignType === 'discord' ? '123456789012345678' : f.assignType === 'creator' ? 'creator-id' : 'bcweb-user-id'} />
              <Button type="button" onClick={addToken}><Plus size={13} /> {t('pc.assign.add', 'Add')}</Button>
            </div>
            {f.assignedTokens.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {f.assignedTokens.map((tok) => { const [ty, ...rest] = tok.split(':'); const val = rest.join(':'); return (
                  <span key={tok} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[var(--surface-2)] border border-[var(--line)] text-xs">
                    <span className="text-[10px] font-bold uppercase text-[var(--primary-2)]">{ty}</span><span className="font-mono truncate max-w-[14rem]">{val}</span>
                    <button type="button" onClick={() => removeToken(tok)} className="text-[var(--faint)] hover:text-red-400"><X size={11} /></button>
                  </span>
                ); })}
              </div>
            )}
          </Field>
        </div>
        <div className="flex justify-end mt-3"><Button variant="primary" onClick={create}><Plus size={15} /> {t('pc.create', 'Create code')}</Button></div>
      </Card>
      {loading ? <Loading /> : codes.length ? <div className="space-y-2">
        {codes.map((c) => (
          <Card key={c.id} className="p-4">
            <div className="flex items-center gap-3">
              <Ticket size={18} className={c.active ? 'text-[var(--primary-2)]' : 'text-[var(--faint)]'} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap"><code className="font-mono font-semibold">{c.code}</code><button onClick={() => { navigator.clipboard?.writeText(c.code); toast.success(t('common.copied', 'Copied.')); }} className="text-[var(--faint)] hover:text-[var(--primary-2)]"><Copy size={13} /></button>{!c.active && <Badge>{t('pc.disabled', 'Disabled')}</Badge>}{c.stackable && <Badge tone="green"><Layers size={9} /> {t('pc.stackable', 'stackable')}</Badge>}{((c.assignedUserIds?.length || 0) + (c.assignedTokens?.length || 0)) > 0 && <Badge tone="primary"><Gift size={9} /> {t('pc.gift', 'gift · {n}').replace('{n}', (c.assignedUserIds?.length || 0) + (c.assignedTokens?.length || 0))}</Badge>}</div>
                <div className="text-xs text-[var(--muted)] mt-0.5"><Badge tone="primary">{c.kind.replace('_', ' ')}</Badge> {desc(c)}{c.expiresAt ? ` · exp ${new Date(c.expiresAt).toLocaleDateString()}` : ''}{c.note ? ` · ${c.note}` : ''}</div>
              </div>
              <button onClick={() => viewReds(c)} className={`text-xs px-2.5 py-1.5 rounded-lg border ${openId === c.id ? 'border-[var(--primary)] text-[var(--text)]' : 'border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]'}`}><Users size={12} className="inline mr-1" />{c.redeemedCount}{c.maxRedemptions ? `/${c.maxRedemptions}` : ''} {t('pc.used', 'used')}</button>
              <Button size="sm" variant="ghost" onClick={() => toggleStack(c)} title={t('pc.f.stackable.h', 'Allow this code to be combined with OTHER stackable codes in one cart. Non-stackable codes must be used alone.')}><Layers size={13} /> {c.stackable ? t('pc.unstack', 'Unstack') : t('pc.stack', 'Stack')}</Button>
              <Button size="sm" onClick={() => toggle(c)}>{c.active ? t('pc.disable', 'Disable') : t('pc.enable', 'Enable')}</Button>
              <Button size="sm" className="!text-red-400" onClick={() => del(c)}><Trash2 size={14} /></Button>
            </div>
            {openId === c.id && (
              <div className="mt-3 pt-3 border-t border-[var(--line)]">
                {!reds[c.id] ? <div className="text-xs text-[var(--muted)] flex items-center gap-2"><Spinner /> {t('common.loading', 'Loading…')}</div>
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
                  </div> : <div className="text-xs text-[var(--faint)]">{t('pc.noreds', 'No redemptions yet.')}</div>}
              </div>
            )}
          </Card>
        ))}
      </div> : <EmptyState icon={Ticket} title={t('pc.none.t', 'No promo codes yet')} sub={t('pc.none.s', 'Create one above — discount, free hosting, or a free boost.')} />}
    </div>
  );
}

// Admin: site-wide promo CAMPAIGNS (auto-applied discount + announcement badge) —
// distinct from the code-based promo codes above. One resolver picks the campaign
// live right now; its % is applied at checkout and its badge shows across the site.
function AdminCampaigns() {
  const toast = useToast(); const { t } = useI18n();
  const { data, loading, reload } = useAsync(() => api.get('/admin/campaigns'), []);
  const toLocal = (d) => { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
  const blank = () => ({ name: '', kind: 'custom', percentOff: 20, appliesTo: 'all', startsAt: toLocal(new Date()), endsAt: toLocal(new Date(Date.now() + 3 * 864e5)), badgeMessageEn: '', badgeMessageFr: '', badgeColor: '', badgeLink: '', badgeEnabled: true });
  const [f, setF] = useState(blank);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const list = data?.campaigns || [];
  // Quick presets the admin can then tweak.
  const presetRandom = () => setF((s) => ({ ...s, name: 'Flash sale', kind: 'flash', percentOff: 10 + Math.floor(Math.random() * 41), appliesTo: 'all', startsAt: toLocal(new Date()), endsAt: toLocal(new Date(Date.now() + 2 * 864e5)), badgeMessageEn: 'Flash sale — limited time!', badgeMessageFr: 'Vente flash — durée limitée !' }));
  const presetBlackFriday = () => setF((s) => ({ ...s, name: 'Black Friday', kind: 'black_friday', percentOff: 30, appliesTo: 'all', badgeMessageEn: 'Black Friday — 30% off all purchases!', badgeMessageFr: 'Black Friday — 30% sur tous les achats !', badgeColor: '#111111' }));
  const create = async () => {
    if (!f.name.trim()) return toast.error(t('cmp.err.name', 'Name is required.'));
    const body = {
      name: f.name.trim(), kind: f.kind, percentOff: Number(f.percentOff), appliesTo: f.appliesTo,
      startsAt: new Date(f.startsAt).toISOString(), endsAt: new Date(f.endsAt).toISOString(),
      badgeEnabled: !!f.badgeEnabled, badgeMessageEn: f.badgeMessageEn || '', badgeMessageFr: f.badgeMessageFr || '',
      badgeColor: f.badgeColor.trim() || '', badgeLink: f.badgeLink.trim() || '',
    };
    try { await api.post('/admin/campaigns', body); toast.success(t('cmp.created', 'Campaign created.')); setF(blank()); reload(); }
    catch (x) { toast.error(x.data?.error === 'end_before_start' ? t('cmp.err.dates', 'End must be after start.') : x.data?.error === 'bad_color' ? t('cmp.err.color', 'Color must be a hex like #f97316.') : x.data?.error === 'bad_link' ? t('cmp.err.link', 'Link must be an internal /path or an https:// URL.') : t('common.failed', 'Failed.')); }
  };
  const toggle = async (c) => { try { await api.patch(`/admin/campaigns/${c.id}`, { active: !c.active }); reload(); } catch { toast.error(t('common.failed', 'Failed.')); } };
  const del = async (c) => { try { await api.del(`/admin/campaigns/${c.id}`); reload(); } catch { toast.error(t('common.failed', 'Failed.')); } };
  const status = (c) => {
    const now = Date.now(), s = new Date(c.startsAt).getTime(), e = new Date(c.endsAt).getTime();
    if (!c.active) return { label: t('cmp.st.off', 'Disabled'), tone: undefined };
    if (now < s) return { label: t('cmp.st.scheduled', 'Scheduled'), tone: 'primary' };
    if (now > e) return { label: t('cmp.st.ended', 'Ended'), tone: undefined };
    return { label: t('cmp.st.live', 'Live now'), tone: 'green' };
  };
  return (
    <div>
      <h2 className="font-semibold mb-1 flex items-center gap-2"><Megaphone size={16} className="text-[var(--primary-2)]" /> {t('cmp.title', 'Promotions (campaigns)')}</h2>
      <p className="text-xs text-[var(--muted)] mb-3">{t('cmp.sub', 'A site-wide, time-boxed sale: auto-applies its % at checkout and shows an announcement badge across the whole site. One campaign is live at a time (the most recently started wins).')}</p>
      <Card className="p-4 mb-4">
        <div className="flex flex-wrap gap-2 mb-3">
          <Button size="sm" onClick={presetRandom}><Sparkles size={13} /> {t('cmp.preset.random', 'Random flash sale')}</Button>
          <Button size="sm" onClick={presetBlackFriday}><Tag size={13} /> {t('cmp.preset.bf', 'Black Friday')}</Button>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label={t('cmp.f.name', 'Name (internal)')}><Input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Black Friday 2026" /></Field>
          <Field label={t('cmp.f.kind', 'Kind')}><Dropdown className="w-full" value={f.kind} onChange={(v) => set('kind', v)} options={[{ value: 'custom', label: t('cmp.k.custom', 'Custom') }, { value: 'black_friday', label: 'Black Friday' }, { value: 'new_year', label: t('cmp.k.ny', 'New Year') }, { value: 'flash', label: t('cmp.k.flash', 'Flash sale') }]} /></Field>
          <Field label={t('cmp.f.pct', '% off')}><Input type="number" value={f.percentOff} onChange={(e) => set('percentOff', e.target.value)} /></Field>
          <Field label={t('cmp.f.applies', 'Applies to')}><Dropdown className="w-full" value={f.appliesTo} onChange={(v) => set('appliesTo', v)} options={[{ value: 'all', label: t('cmp.a.all', 'All purchases') }, { value: 'hosting', label: t('cmp.a.hosting', 'Hosting only') }, { value: 'boost', label: t('cmp.a.boost', 'Boost only') }]} /></Field>
          <Field label={t('cmp.f.start', 'Starts')}><Input type="datetime-local" value={f.startsAt} onChange={(e) => set('startsAt', e.target.value)} /></Field>
          <Field label={t('cmp.f.end', 'Ends')}><Input type="datetime-local" value={f.endsAt} onChange={(e) => set('endsAt', e.target.value)} /></Field>
          <Field label={t('cmp.f.msgen', 'Badge message (EN)')}><Input value={f.badgeMessageEn} onChange={(e) => set('badgeMessageEn', e.target.value)} placeholder="Black Friday — 30% off!" /></Field>
          <Field label={t('cmp.f.msgfr', 'Badge message (FR)')}><Input value={f.badgeMessageFr} onChange={(e) => set('badgeMessageFr', e.target.value)} placeholder="Black Friday — 30% !" /></Field>
          <Field label={t('cmp.f.color', 'Badge color (hex, blank = brand)')}><Input value={f.badgeColor} onChange={(e) => set('badgeColor', e.target.value)} placeholder="#f97316" /></Field>
          <Field label={t('cmp.f.link', 'Badge link (optional)')} hint={t('cmp.f.link.h', 'Where clicking the badge goes: an internal path like /blog/black-friday, or a full https:// URL.')}><Input value={f.badgeLink} onChange={(e) => set('badgeLink', e.target.value)} placeholder="/blog/… or https://…" /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-[var(--muted)] mt-3 cursor-pointer w-fit">
          <input type="checkbox" checked={f.badgeEnabled} onChange={(e) => set('badgeEnabled', e.target.checked)} /> {t('cmp.f.badge', 'Show the announcement badge across the site')}
        </label>
        <div className="flex justify-end mt-3"><Button variant="primary" onClick={create}><Plus size={15} /> {t('cmp.create', 'Create campaign')}</Button></div>
      </Card>
      {loading ? <Loading /> : list.length ? <div className="space-y-2">
        {list.map((c) => { const st = status(c); return (
          <Card key={c.id} className="p-4">
            <div className="flex items-center gap-3 flex-wrap">
              <Megaphone size={18} className={st.label === t('cmp.st.live', 'Live now') ? 'text-[var(--primary-2)]' : 'text-[var(--faint)]'} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap"><span className="font-semibold">{c.name}</span><Badge tone={st.tone}>{st.label}</Badge><Badge tone="primary">−{c.percentOff}%</Badge>{c.badgeEnabled && <Badge><Megaphone size={9} /> {t('cmp.badgeon', 'badge')}</Badge>}</div>
                <div className="text-xs text-[var(--muted)] mt-0.5">{c.kind.replace('_', ' ')} · {c.appliesTo} · {new Date(c.startsAt).toLocaleString()} → {new Date(c.endsAt).toLocaleString()}{(c.badgeMessageFr || c.badgeMessageEn) ? ` · "${c.badgeMessageFr || c.badgeMessageEn}"` : ''}</div>
              </div>
              <Button size="sm" onClick={() => toggle(c)}>{c.active ? t('cmp.disable', 'Disable') : t('cmp.enable', 'Enable')}</Button>
              <Button size="sm" className="!text-red-400" onClick={() => del(c)}><Trash2 size={14} /></Button>
            </div>
          </Card>
        ); })}
      </div> : <EmptyState icon={Megaphone} title={t('cmp.none.t', 'No campaigns yet')} sub={t('cmp.none.s', 'Create one above — a Black Friday sale, a flash sale, anything.')} />}
    </div>
  );
}

// Admin: site EVENTS (New Year, national holidays…). One event is live at a time; while
// live it plays a full-screen fireworks effect (flag-forming burst for a national
// holiday) and shows a custom announcement. Effect runtime + notifications land in
// later phases; this panel owns the schedule + content + one-at-a-time enforcement.
function AdminEvents() {
  const toast = useToast(); const { t } = useI18n();
  const { data, loading, reload } = useAsync(() => api.get('/admin/events'), []);
  const toLocal = (d) => { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
  const blank = () => ({ name: '', kind: 'custom', countryCode: '', startsAt: toLocal(new Date()), endsAt: toLocal(new Date(Date.now() + 2 * 864e5)), titleEn: '', titleFr: '', messageEn: '', messageFr: '', notifyDaysBefore: 3, eventCode: '', fxDensity: 5, fxFlagDrops: 2, badgeIcon: 'sparkles', promoPercent: 0 });
  const [f, setF] = useState(blank);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const list = data?.events || [];
  const presetNY = () => setF((s) => ({ ...s, name: 'New Year', kind: 'new_year', countryCode: '', badgeIcon: 'party', titleEn: 'Happy New Year!', titleFr: 'Bonne année !', messageEn: 'Fireworks on us', messageFr: 'Des feux d\'artifice pour vous' }));
  const presetHoliday = () => setF((s) => ({ ...s, name: 'National day', kind: 'national_holiday', countryCode: s.countryCode || 'FR', badgeIcon: 'flag', titleEn: 'National day', titleFr: 'Fête nationale', messageEn: 'Celebrating with a flag in the sky', messageFr: 'On célèbre avec un drapeau dans le ciel' }));
  const create = async () => {
    if (!f.name.trim()) return toast.error(t('ev.err.name', 'Name is required.'));
    const body = {
      name: f.name.trim(), kind: f.kind, startsAt: new Date(f.startsAt).toISOString(), endsAt: new Date(f.endsAt).toISOString(),
      titleEn: f.titleEn || '', titleFr: f.titleFr || '', messageEn: f.messageEn || '', messageFr: f.messageFr || '',
      notifyDaysBefore: Number(f.notifyDaysBefore) || 0, eventCode: f.eventCode.trim() || '',
      fxDensity: Number(f.fxDensity) || 5, fxFlagDrops: Number(f.fxFlagDrops) || 0, badgeIcon: f.badgeIcon, promoPercent: Number(f.promoPercent) || 0,
      ...(f.kind === 'national_holiday' ? { countryCode: f.countryCode.trim().toUpperCase() } : {}),
    };
    try { await api.post('/admin/events', body); toast.success(t('ev.created', 'Event created.')); setF(blank()); reload(); }
    catch (x) {
      const e = x.data?.error;
      toast.error(e === 'end_before_start' ? t('ev.err.dates', 'End must be after start.')
        : e === 'country_required' ? t('ev.err.country', 'Pick a country (2-letter code) for a national holiday.')
        : e === 'overlap' ? t('ev.err.overlap', 'Overlaps the active event "{n}" — only one event runs at a time.').replace('{n}', x.data?.with || '')
        : t('common.failed', 'Failed.'));
    }
  };
  const toggle = async (e) => { try { await api.patch(`/admin/events/${e.id}`, { active: !e.active }); reload(); } catch (x) { toast.error(x.data?.error === 'overlap' ? t('ev.err.overlap2', 'Another event is active in that window.') : t('common.failed', 'Failed.')); } };
  const del = async (e) => { try { await api.del(`/admin/events/${e.id}`); reload(); } catch { toast.error(t('common.failed', 'Failed.')); } };
  const status = (e) => {
    const now = Date.now(), s = new Date(e.startsAt).getTime(), en = new Date(e.endsAt).getTime();
    if (!e.active) return { label: t('ev.st.off', 'Disabled'), tone: undefined };
    if (now < s) return { label: t('ev.st.scheduled', 'Scheduled'), tone: 'primary' };
    if (now > en) return { label: t('ev.st.ended', 'Ended'), tone: undefined };
    return { label: t('ev.st.live', 'Live now'), tone: 'green' };
  };
  return (
    <div>
      <h2 className="font-semibold mb-1 flex items-center gap-2"><Sparkles size={16} className="text-[var(--primary-2)]" /> {t('ev.title', 'Events')}</h2>
      <p className="text-xs text-[var(--muted)] mb-3">{t('ev.sub', 'One event runs at a time. While live it plays a fireworks effect (a national holiday forms the country flag) and shows your announcement. Notifications + the event promo/code arrive in the next phases.')}</p>
      <Card className="p-4 mb-4">
        <div className="flex flex-wrap gap-2 mb-3">
          <Button size="sm" onClick={presetNY}><Sparkles size={13} /> {t('ev.preset.ny', 'New Year')}</Button>
          <Button size="sm" onClick={presetHoliday}><Flag size={13} /> {t('ev.preset.holiday', 'National holiday')}</Button>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label={t('ev.f.name', 'Name (internal)')}><Input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="New Year 2027" /></Field>
          <Field label={t('ev.f.kind', 'Kind')}><Dropdown className="w-full" value={f.kind} onChange={(v) => set('kind', v)} options={[{ value: 'custom', label: t('ev.k.custom', 'Custom') }, { value: 'new_year', label: t('ev.k.ny', 'New Year') }, { value: 'national_holiday', label: t('ev.k.holiday', 'National holiday') }]} /></Field>
          {f.kind === 'national_holiday' && <Field label={t('ev.f.country', 'Country code (ISO, e.g. FR, US)')}><Input value={f.countryCode} onChange={(e) => set('countryCode', e.target.value.toUpperCase().slice(0, 2))} placeholder="FR" /></Field>}
          <Field label={t('ev.f.notify', 'Notify users (days before)')}><Input type="number" value={f.notifyDaysBefore} onChange={(e) => set('notifyDaysBefore', e.target.value)} /></Field>
          <Field label={t('ev.f.density', 'Fireworks amount (1–10)')}><Input type="number" min="1" max="10" value={f.fxDensity} onChange={(e) => set('fxDensity', e.target.value)} /></Field>
          <Field label={t('ev.f.flagdrops', 'Flag drops (times the flag forms, random)')}><Input type="number" min="0" max="20" value={f.fxFlagDrops} onChange={(e) => set('fxFlagDrops', e.target.value)} /></Field>
          <Field label={t('ev.f.icon', 'Announcement icon (no emoji)')}><Select value={f.badgeIcon} onChange={(e) => set('badgeIcon', e.target.value)}><option value="sparkles">Sparkles</option><option value="party">Party</option><option value="flag">Flag</option><option value="gift">Gift</option><option value="star">Star</option><option value="rocket">Rocket</option><option value="calendar">Calendar</option><option value="bell">Bell</option></Select></Field>
          <Field label={t('ev.f.start', 'Starts')}><Input type="datetime-local" value={f.startsAt} onChange={(e) => set('startsAt', e.target.value)} /></Field>
          <Field label={t('ev.f.end', 'Ends')}><Input type="datetime-local" value={f.endsAt} onChange={(e) => set('endsAt', e.target.value)} /></Field>
          <Field label={t('ev.f.titleen', 'Title (EN)')}><Input value={f.titleEn} onChange={(e) => set('titleEn', e.target.value)} placeholder="Happy New Year!" /></Field>
          <Field label={t('ev.f.titlefr', 'Title (FR)')}><Input value={f.titleFr} onChange={(e) => set('titleFr', e.target.value)} placeholder="Bonne année !" /></Field>
          <Field label={t('ev.f.msgen', 'Message (EN)')}><Input value={f.messageEn} onChange={(e) => set('messageEn', e.target.value)} /></Field>
          <Field label={t('ev.f.msgfr', 'Message (FR)')}><Input value={f.messageFr} onChange={(e) => set('messageFr', e.target.value)} /></Field>
          <Field label={t('ev.f.promo', 'Event discount % (0 = none)')} hint={t('ev.f.promo.h', 'Creates a site-wide discount + badge for the event window, and (with a code below) an event-only code carrying this %.')}><Input type="number" min="0" max="100" value={f.promoPercent} onChange={(e) => set('promoPercent', e.target.value)} /></Field>
          <Field label={t('ev.f.code', 'Event-only promo code (optional)')} hint={t('ev.f.code.h', 'A code valid ONLY during the event window, broadcast to users in the event notification.')}><Input value={f.eventCode} onChange={(e) => set('eventCode', e.target.value.toUpperCase())} placeholder="NY2027" /></Field>
        </div>
        <div className="flex justify-end mt-3"><Button variant="primary" onClick={create}><Plus size={15} /> {t('ev.create', 'Create event')}</Button></div>
      </Card>
      {loading ? <Loading /> : list.length ? <div className="space-y-2">
        {list.map((e) => { const st = status(e); return (
          <Card key={e.id} className="p-4">
            <div className="flex items-center gap-3 flex-wrap">
              <Sparkles size={18} className={st.tone === 'green' ? 'text-[var(--primary-2)]' : 'text-[var(--faint)]'} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap"><span className="font-semibold">{e.name}</span><Badge tone={st.tone}>{st.label}</Badge><Badge tone="primary">{e.kind.replace('_', ' ')}</Badge>{e.countryCode && <Badge>{e.countryCode}</Badge>}{e.promoPercent > 0 && <Badge tone="primary">−{e.promoPercent}%</Badge>}{e.eventCode && <Badge tone="green"><Ticket size={9} /> {e.eventCode}</Badge>}</div>
                <div className="text-xs text-[var(--muted)] mt-0.5">{e.effect} · fx {e.fxDensity}/10 · {e.fxFlagDrops} {t('ev.flags', 'flag drops')} · {new Date(e.startsAt).toLocaleString()} → {new Date(e.endsAt).toLocaleString()}{e.notifyDaysBefore ? ` · ${t('ev.notifd', 'notify {n}d before').replace('{n}', e.notifyDaysBefore)}` : ''}{(e.titleFr || e.titleEn) ? ` · "${e.titleFr || e.titleEn}"` : ''}</div>
              </div>
              <Button size="sm" onClick={() => toggle(e)}>{e.active ? t('ev.disable', 'Disable') : t('ev.enable', 'Enable')}</Button>
              <Button size="sm" className="!text-red-400" onClick={() => del(e)}><Trash2 size={14} /></Button>
            </div>
          </Card>
        ); })}
      </div> : <EmptyState icon={Sparkles} title={t('ev.none.t', 'No events yet')} sub={t('ev.none.s', 'Create one above — New Year, a national holiday, anything.')} />}
    </div>
  );
}

// Admin: OAuth/OIDC clients — register a service to "Sign in with BetterCommunity".
// BCWEB is the identity provider; discovery lives at /.well-known/openid-configuration.
function AdminOAuthClients() {
  const toast = useToast(); const { t } = useI18n();
  const { data, loading, reload } = useAsync(() => api.get('/admin/oauth-clients'), []);
  const [f, setF] = useState({ name: '', confidential: true, redirectUris: '', scopes: ['openid', 'profile', 'email'] });
  const [created, setCreated] = useState(null); // { id, secret } — shown once
  const list = data?.clients || [];
  const toggleScope = (s) => setF((st) => ({ ...st, scopes: st.scopes.includes(s) ? st.scopes.filter((x) => x !== s) : [...st.scopes, s] }));
  const copy = (v) => { navigator.clipboard?.writeText(v); toast.success(t('common.copied', 'Copied.')); };
  const create = async () => {
    const uris = f.redirectUris.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    if (!f.name.trim()) return toast.error(t('oc.err.name', 'Name is required.'));
    if (!uris.length) return toast.error(t('oc.err.uris', 'Add at least one redirect URI.'));
    try {
      const r = await api.post('/admin/oauth-clients', { name: f.name.trim(), confidential: f.confidential, redirectUris: uris, scopes: f.scopes.length ? f.scopes : undefined });
      setCreated({ id: r.client.id, secret: r.clientSecret });
      setF({ name: '', confidential: true, redirectUris: '', scopes: ['openid', 'profile', 'email'] });
      reload();
    } catch (x) { toast.error(x.data?.error === 'invalid_input' ? t('oc.err.input', 'Check the fields — redirect URIs must be valid absolute URLs.') : t('common.failed', 'Failed.')); }
  };
  const toggle = async (c) => { try { await api.patch(`/admin/oauth-clients/${c.id}`, { active: !c.active }); reload(); } catch { toast.error(t('common.failed', 'Failed.')); } };
  const del = async (c) => { try { await api.del(`/admin/oauth-clients/${c.id}`); reload(); } catch { toast.error(t('common.failed', 'Failed.')); } };
  const rotate = async (c) => { try { const r = await api.post(`/admin/oauth-clients/${c.id}/rotate`); setCreated({ id: c.id, secret: r.clientSecret }); } catch { toast.error(t('common.failed', 'Failed.')); } };
  return (
    <div>
      <h2 className="font-semibold mb-1 flex items-center gap-2"><Shield size={16} className="text-[var(--primary-2)]" /> {t('oc.title', 'SSO — OAuth / OpenID Connect clients')}</h2>
      <p className="text-xs text-[var(--muted)] mb-3">{t('oc.sub', 'Register another service to “Sign in with BetterCommunity”. It discovers everything at')} <code className="text-[11px]">/.well-known/openid-configuration</code>.</p>
      {created && (
        <Card className="p-4 mb-4 border-[var(--primary)]">
          <div className="text-sm font-semibold text-[var(--primary-2)] mb-2">{t('oc.created', 'Client ready — copy the secret now, it is shown only once.')}</div>
          <div className="flex items-center gap-2 text-sm mb-1"><span className="text-[var(--muted)] w-24">client_id</span><code className="font-mono break-anywhere flex-1">{created.id}</code><button onClick={() => copy(created.id)} className="text-[var(--faint)] hover:text-[var(--primary-2)]"><Copy size={13} /></button></div>
          {created.secret
            ? <div className="flex items-center gap-2 text-sm"><span className="text-[var(--muted)] w-24">client_secret</span><code className="font-mono break-anywhere flex-1">{created.secret}</code><button onClick={() => copy(created.secret)} className="text-[var(--faint)] hover:text-[var(--primary-2)]"><Copy size={13} /></button></div>
            : <div className="text-xs text-[var(--muted)]">{t('oc.public', 'Public client — no secret; it must use PKCE.')}</div>}
          <div className="flex justify-end mt-3"><Button size="sm" onClick={() => setCreated(null)}>{t('common.done', 'Done')}</Button></div>
        </Card>
      )}
      <Card className="p-4 mb-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label={t('oc.f.name', 'Client name')}><Input value={f.name} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} placeholder="My service" /></Field>
          <Field label={t('oc.f.type', 'Type')}><Select value={f.confidential ? 'conf' : 'pub'} onChange={(e) => setF((s) => ({ ...s, confidential: e.target.value === 'conf' }))}><option value="conf">{t('oc.t.conf', 'Confidential (server, has a secret)')}</option><option value="pub">{t('oc.t.pub', 'Public (SPA/mobile, PKCE only)')}</option></Select></Field>
        </div>
        <div className="mt-3"><Field label={t('oc.f.uris', 'Redirect URIs (one per line)')} hint={t('oc.f.uris.h', 'Absolute URLs the login flow may return to, e.g. https://app.example.com/callback')}><textarea className="input" rows={2} value={f.redirectUris} onChange={(e) => setF((s) => ({ ...s, redirectUris: e.target.value }))} placeholder="https://app.example.com/callback" /></Field></div>
        <div className="mt-3">
          <div className="text-sm text-[var(--muted)] mb-1.5">{t('oc.f.scopes', 'Scopes')}</div>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {['openid', 'profile', 'email', 'items', 'repos'].map((s) => (
              <label key={s} className="flex items-center gap-1.5 text-sm cursor-pointer" title={{ openid: 'Sign-in / identity (required)', profile: 'Display name & avatar', email: 'Email address', items: 'Read the user\'s catalog items', repos: 'Read the user\'s hosted Server-Repos' }[s]}>
                <input type="checkbox" checked={f.scopes.includes(s)} disabled={s === 'openid'} onChange={() => toggleScope(s)} /> {s}
              </label>
            ))}
          </div>
        </div>
        <div className="flex justify-end mt-3"><Button variant="primary" onClick={create}><Plus size={15} /> {t('oc.create', 'Create client')}</Button></div>
      </Card>
      {loading ? <Loading /> : list.length ? <div className="space-y-2">
        {list.map((c) => (
          <Card key={c.id} className="p-4">
            <div className="flex items-center gap-3 flex-wrap">
              <Shield size={18} className={c.active ? 'text-[var(--primary-2)]' : 'text-[var(--faint)]'} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap"><span className="font-semibold">{c.name}</span>{!c.active && <Badge>{t('oc.disabled', 'Disabled')}</Badge>}<Badge tone="primary">{c.confidential ? t('oc.conf', 'confidential') : t('oc.pub', 'public')}</Badge>{c.scopes.map((s) => <Badge key={s}>{s}</Badge>)}</div>
                <div className="text-xs text-[var(--muted)] mt-0.5 flex items-center gap-1.5"><code className="font-mono break-anywhere">{c.id}</code><button onClick={() => copy(c.id)} className="text-[var(--faint)] hover:text-[var(--primary-2)]"><Copy size={12} /></button> · {c.redirectUris.join(', ')}</div>
              </div>
              {c.confidential && <Button size="sm" variant="ghost" onClick={() => rotate(c)}>{t('oc.rotate', 'Rotate secret')}</Button>}
              <Button size="sm" onClick={() => toggle(c)}>{c.active ? t('oc.disable', 'Disable') : t('oc.enable', 'Enable')}</Button>
              <Button size="sm" className="!text-red-400" onClick={() => del(c)}><Trash2 size={14} /></Button>
            </div>
          </Card>
        ))}
      </div> : <EmptyState icon={Shield} title={t('oc.none.t', 'No OAuth clients yet')} sub={t('oc.none.s', 'Register a service above to let it sign users in with BetterCommunity.')} />}
    </div>
  );
}

// Editor for the bot's gated-role rules. Each rule = one Discord role granted to
// members meeting its own requirements (Discord link / BCWEB account / BMM
// creator id). Add as many as you like.
function GatingRules({ rules, onChange }) {
  const { t } = useI18n();
  const upd = (i, patch) => onChange(rules.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const add = () => onChange([...rules, { roleId: '', label: '', requireDiscord: true, requireBcweb: true, requireBmm: false }]);
  const rm = (i) => onChange(rules.filter((_, k) => k !== i));
  const Chk = ({ on, onToggle, children }) => (
    <label className="flex items-center gap-1.5 text-xs cursor-pointer"><input type="checkbox" checked={!!on} onChange={(e) => onToggle(e.target.checked)} /> {children}</label>
  );
  return (
    <div className="space-y-2">
      {rules.length === 0 && <div className="text-xs text-[var(--faint)] py-1">{t('db.gr.none', 'No role rules yet — add one to start gating.')}</div>}
      {rules.map((r, i) => (
        <div key={i} className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-2.5 space-y-2">
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
            <Field label={t('db.gr.roleid', 'Role ID')}><Input value={r.roleId || ''} onChange={(e) => upd(i, { roleId: e.target.value.trim() })} placeholder="123456789012345678" /></Field>
            <Field label={t('db.gr.label', 'Label (for messages)')}><Input value={r.label || ''} onChange={(e) => upd(i, { label: e.target.value })} placeholder={t('db.gr.labelph', 'Verified / Creator…')} /></Field>
            <Button size="sm" variant="ghost" className="!text-red-400 mb-0.5" onClick={() => rm(i)} title={t('db.gr.remove', 'Remove rule')}><Trash2 size={14} /></Button>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <Chk on={r.requireDiscord} onToggle={(v) => upd(i, { requireDiscord: v })}>{t('db.gr.reqdiscord', 'Requires linked Discord')}</Chk>
            <Chk on={r.requireBcweb} onToggle={(v) => upd(i, { requireBcweb: v })}>{t('db.gr.reqbcweb', 'Requires BCWEB account')}</Chk>
            <Chk on={r.requireBmm} onToggle={(v) => upd(i, { requireBmm: v })}>{t('db.gr.reqbmm', 'Requires BMM creator id')}</Chk>
          </div>
        </div>
      ))}
      <Button size="sm" variant="ghost" onClick={add}><Plus size={13} /> {t('db.gr.add', 'Add role rule')}</Button>
    </div>
  );
}

// Blog "sources" a route can subscribe to — mirrors the source keys the API tags
// each post with (project key, or 'showcase' for Other-projects pages, or '*'=all).
const BLOG_SOURCES = [['*', 'All blogs'], ['bmm', 'BMM'], ['bsm', 'BSM'], ['community', 'Community'], ['installer', 'Installer'], ['showcase', 'Other projects']];

// Per-route editor for blog announcements: each route = a channel (in any server)
// + which blogs to post there. A channel id is globally unique, so routing works
// across every server the bot is in.
const BLOG_SOURCE_KEY = { '*': 'db.src.all', bmm: 'db.src.bmm', bsm: 'db.src.bsm', community: 'db.src.community', installer: 'db.src.installer', showcase: 'db.src.showcase' };
// Editable list of Discord channel ids (add / remove rows). Empty strings are kept
// while editing and filtered out server-side, so a trailing blank row is harmless.
function MultiChannelInput({ value, onChange, placeholder }) {
  const { t } = useI18n();
  const ids = Array.isArray(value) ? value : (value ? [value] : []);
  const list = ids.length ? ids : [''];
  return (
    <div className="space-y-1.5">
      {list.map((id, i) => (
        <div key={i} className="flex gap-1.5">
          <Input value={id} onChange={(e) => onChange(list.map((x, k) => (k === i ? e.target.value : x)))} placeholder={placeholder} />
          {list.length > 1 && <Button size="sm" variant="ghost" onClick={() => onChange(list.filter((_, k) => k !== i))}><Trash2 size={13} /></Button>}
        </div>
      ))}
      <button type="button" onClick={() => onChange([...list, ''])} className="text-xs text-[var(--primary-2)] hover:underline flex items-center gap-1"><Plus size={12} /> {t('db.f.addchan', 'Add another channel')}</button>
    </div>
  );
}

function BlogRoutes({ routes, onChange, guildList }) {
  const { t } = useI18n();
  const set = (i, patch) => onChange(routes.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const toggleSource = (i, key) => {
    const cur = routes[i].sources || ['*'];
    let next;
    if (key === '*') next = ['*'];
    else { next = cur.includes('*') ? [key] : cur.includes(key) ? cur.filter((s) => s !== key) : [...cur, key]; if (!next.length) next = ['*']; }
    set(i, { sources: next });
  };
  return (
    <div className="space-y-2">
      {routes.length === 0 && <div className="text-xs text-[var(--faint)]">{t('db.routes.none', 'No routes — add one. Each route posts the chosen blogs to a channel (in any server the bot is in).')}</div>}
      {routes.map((r, i) => {
        const guild = guildList.find((gg) => gg.id === r.guildId);
        return (
          <div key={i} className="rounded-lg border border-[var(--line)] p-2.5 space-y-2 relative">
            <button onClick={() => onChange(routes.filter((_, k) => k !== i))} className="absolute top-2 right-2 text-[var(--faint)] hover:text-red-400"><Trash2 size={13} /></button>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)]">{t('db.routes.routen', 'Route {n}').replace('{n}', i + 1)}{guild ? ` · ${guild.name}` : ''}</div>
            <Input value={r.channelId || ''} onChange={(e) => set(i, { channelId: e.target.value })} placeholder={t('db.routes.chanph', 'Channel ID (in any server the bot is in)')} />
            {guildList.length > 0 && (
              <Select className="!py-2" value={r.guildId || ''} onChange={(e) => set(i, { guildId: e.target.value })}>
                <option value="">{t('db.routes.serveropt', 'Server (optional — for your reference)')}</option>
                {guildList.map((gg) => <option key={gg.id} value={gg.id}>{gg.name}</option>)}
              </Select>
            )}
            <div className="flex flex-wrap gap-1.5">
              {BLOG_SOURCES.map(([key, label]) => {
                const on = (r.sources || ['*']).includes(key);
                return (
                  <button key={key} type="button" onClick={() => toggleSource(i, key)}
                    className={`px-2 py-0.5 rounded-md text-[11px] border transition ${on ? 'bg-[var(--primary)]/15 border-[var(--primary)]/40 text-[var(--primary-2)]' : 'border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]'}`}>
                    {t(BLOG_SOURCE_KEY[key] || '', label)}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      <Button size="sm" variant="ghost" onClick={() => onChange([...routes, { channelId: '', guildId: '', sources: ['*'] }])}><Plus size={13} /> {t('db.routes.add', 'Add route')}</Button>
    </div>
  );
}

// A styled on/off switch — the classic bot-dashboard module toggle.
function BotSwitch({ checked, onChange, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={!!checked} disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition shrink-0 ${checked ? 'bg-emerald-500' : 'bg-[var(--surface-2)] border border-[var(--line)]'} ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}>
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  );
}

// One server in the dashboard's server picker (avatar + name + member count),
// MEE6/Dyno-style. `dot` shows a green marker when that server has custom config.
function ServerBubble({ name, icon, sub, active, dot, onClick }) {
  const initial = (name || '?').slice(0, 2).toUpperCase();
  return (
    <button onClick={onClick} title={name}
      className={`relative flex items-center gap-2.5 px-3 py-2 rounded-xl border text-left transition shrink-0 w-[180px] ${active ? 'border-[var(--primary)] bg-[var(--primary)]/10' : 'border-[var(--line)] hover:border-[var(--line-strong)] hover:bg-[var(--surface-2)]/50'}`}>
      {icon ? <img src={icon} alt="" className="w-9 h-9 rounded-full shrink-0" />
        : <span className="w-9 h-9 rounded-full shrink-0 grid place-items-center text-xs font-bold bg-gradient-to-br from-orange-500 to-amber-500 text-white">{initial}</span>}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{name}</div>
        {sub && <div className="text-[10px] text-[var(--faint)] truncate">{sub}</div>}
      </div>
      {dot && <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" title="Custom config" />}
    </button>
  );
}

// A feature "module" card: header (icon + title + master switch) over a settings
// body that dims when the module is off. The heart of the bot-dashboard layout.
function ModuleCard({ icon: I, title, desc, enabled, onToggle, action, children }) {
  const off = enabled === false;
  return (
    <Card className={`p-0 overflow-hidden self-start transition ${off ? 'opacity-75' : ''}`}>
      <div className="flex items-start gap-3 p-4">
        <span className={`grid place-items-center w-9 h-9 rounded-lg shrink-0 border ${off ? 'bg-[var(--surface-2)] border-[var(--line)]' : 'bg-[var(--primary)]/10 border-[var(--primary)]/20'}`}><I size={17} className={off ? 'text-[var(--faint)]' : 'text-[var(--primary-2)]'} /></span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm">{title}</div>
          {desc && <div className="text-[11px] text-[var(--faint)] mt-0.5 leading-snug">{desc}</div>}
        </div>
        {action}
        {onToggle && <BotSwitch checked={!!enabled} onChange={onToggle} />}
      </div>
      {/* When the module is toggled off, its config collapses to keep the tab tidy —
          the values persist and reappear on enable (no greyed-out sprawl). */}
      {children && !off && <div className="px-4 pb-4 space-y-2.5 border-t border-[var(--line)] pt-3">{children}</div>}
    </Card>
  );
}

// Live bot console logs (shipped in the heartbeat) — the fastest way to see WHY the
// bot did or didn't do something (e.g. a payment channel not found / no permission).
function BotLogsCard() {
  const { t } = useI18n();
  const [logs, setLogs] = useState(null);
  const [at, setAt] = useState(null);
  const [open, setOpen] = useState(false);
  const load = () => api.get('/admin/bot/logs').then((r) => { setLogs(r.logs || []); setAt(r.at); }).catch(() => {});
  useEffect(() => { if (!open) return; load(); const id = setInterval(load, 5000); return () => clearInterval(id); }, [open]);
  const color = (lv) => lv === 'error' ? 'text-red-400' : lv === 'warn' ? 'text-amber-400' : 'text-[var(--muted)]';
  return (
    <Card className="p-4 mb-4">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between gap-2 text-left">
        <span className="font-medium text-sm flex items-center gap-2"><FileText size={14} className="text-[var(--primary-2)]" /> {t('db.logs', 'Live bot logs')}{at && <span className="text-[11px] text-[var(--faint)] font-normal">· {t('db.logs.updated', 'updated {t}').replace('{t}', new Date(at).toLocaleTimeString())}</span>}</span>
        <ChevronDown size={16} className={`text-[var(--faint)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-3">
          {logs == null ? <div className="text-xs text-[var(--muted)] flex items-center gap-2"><Spinner /> {t('common.loading', 'Loading…')}</div>
            : logs.length === 0 ? <div className="text-xs text-[var(--faint)]">{t('db.logs.none', 'No logs yet — the bot pushes them on its heartbeat (≤60s). If empty, the bot may be offline.')}</div>
            : <div className="rounded-lg bg-[#0b1220] border border-[var(--line)] p-2.5 max-h-72 overflow-auto font-mono text-[11px] leading-relaxed">
                {logs.map((l, i) => (
                  <div key={i} className="whitespace-pre-wrap break-words"><span className="text-[var(--faint)]">{new Date(l.t).toLocaleTimeString()} </span><span className={color(l.level)}>{l.msg}</span></div>
                ))}
              </div>}
          <p className="text-[11px] text-[var(--faint)] mt-1.5">{t('db.logs.note', 'Auto-refreshes every 5s while open. Use “Send test message” above and watch here to see whether a payment posts.')}</p>
        </div>
      )}
    </Card>
  );
}

// Bot message variables — the bot substitutes these when it sends. {code} only resolves
// when a gift is attached. Kept in sync with the bot's substitution (apps/bot).
const BOT_VARS_BASE = [
  { v: '{user}', d: 'Mention the recipient (@Name)' },
  { v: '{username}', d: "The recipient's username" },
  { v: '{server}', d: 'The server name' },
];
const DM_VARS = [...BOT_VARS_BASE, { v: '{code}', d: 'The gift code (only if a gift is attached)' }];
const GIVEAWAY_VARS = [...BOT_VARS_BASE, { v: '{prize}', d: 'The giveaway prize' }, { v: '{code}', d: 'The gift code (only if a gift is attached)' }];

// Substitute variables with sample values for the live preview.
function previewBotMsg(tpl, { code } = {}) {
  return String(tpl || '').replace(/\{user\}/g, '@Alex').replace(/\{username\}/g, 'Alex')
    .replace(/\{server\}/g, 'BetterCommunity').replace(/\{prize\}/g, '1 month of hosting').replace(/\{code\}/g, code || 'BC-7K2M-9XQ4');
}

// A message editor with an insert-at-cursor variable palette + a live preview. `giftCode`
// undefined = no gift line in the preview; '' or a value = show a gift-code chip.
function MessageField({ label, hint, value, onChange, vars, placeholder, giftCode }) {
  const { t } = useI18n();
  const ref = useRef(null);
  const insert = (token) => {
    const el = ref.current;
    if (!el) return onChange(`${value || ''}${token}`);
    const s = el.selectionStart ?? (value || '').length, e = el.selectionEnd ?? (value || '').length;
    const next = (value || '').slice(0, s) + token + (value || '').slice(e);
    onChange(next);
    requestAnimationFrame(() => { try { el.focus(); el.selectionStart = el.selectionEnd = s + token.length; } catch {} });
  };
  return (
    <Field label={label} hint={hint}>
      <Textarea ref={ref} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      <div className="flex flex-wrap items-center gap-1.5 mt-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)]">{t('botvar.insert', 'Insert')}:</span>
        {vars.map((vr) => (
          <button key={vr.v} type="button" onClick={() => insert(vr.v)} title={vr.d}
            className="press-sm text-[11px] font-mono px-1.5 py-0.5 rounded-md border border-[var(--line)] bg-[var(--surface-2)] text-[var(--primary-2)] hover:border-[var(--ring)] transition-colors">{vr.v}</button>
        ))}
      </div>
      <div className="mt-2 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-2.5">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)] mb-1 flex items-center gap-1"><Eye size={10} /> {t('botvar.preview', 'Preview')}</div>
        <div className="text-sm whitespace-pre-wrap break-words">
          {(value || '').trim() ? previewBotMsg(value) : <span className="text-[var(--faint)]">{t('botvar.empty', '(the message the recipient will see)')}</span>}
          {giftCode !== undefined && <div className="mt-1.5"><Badge tone="primary"><Gift size={9} /> {giftCode || 'BC-7K2M-9XQ4'}</Badge></div>}
        </div>
      </div>
    </Field>
  );
}

// Admin: DM a Discord user — plain message and/or a one-off gift promo code minted
// against their linked account. The bot delivers it within ~30s.
function BotDMCard() {
  const { t } = useI18n(); const toast = useToast();
  const [open, setOpen] = useState(false);
  const [discordId, setDiscordId] = useState('');
  const [message, setMessage] = useState('');
  const [picker, setPicker] = useState(false);
  const [mq, setMq] = useState(''); const [mqDeb, setMqDeb] = useState('');
  useEffect(() => { const id = setTimeout(() => setMqDeb(mq), 300); return () => clearTimeout(id); }, [mq]);
  const members = useAsync(() => (picker ? api.get(`/admin/bot/members?take=8${mqDeb ? `&q=${encodeURIComponent(mqDeb)}` : ''}`) : Promise.resolve({ members: [] })), [picker, mqDeb]);
  const [withGift, setWithGift] = useState(false);
  const [gift, setGift] = useState({ kind: 'discount', percentOff: 20, freeMonths: 0, storageGB: 10, uploadMbps: 8, hostMonths: 0, boostDays: 7 });
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!discordId.trim()) return toast.error(t('dm.needid', 'Enter a Discord user id.'));
    setBusy(true);
    try {
      const body = { discordId: discordId.trim(), message };
      if (withGift) {
        const g = { kind: gift.kind };
        if (gift.kind === 'discount') { if (Number(gift.percentOff)) g.percentOff = Number(gift.percentOff); if (Number(gift.freeMonths)) g.freeMonths = Number(gift.freeMonths); }
        if (gift.kind === 'free_hosting') { g.storageGB = Number(gift.storageGB); if (Number(gift.uploadMbps)) g.uploadMbps = Number(gift.uploadMbps); if (Number(gift.hostMonths)) g.hostMonths = Number(gift.hostMonths); }
        if (gift.kind === 'free_boost') g.boostDays = Number(gift.boostDays);
        body.gift = g;
      }
      const r = await api.post('/admin/bot/dm', body);
      toast.success(r.giftCode ? t('dm.sentgift', 'Queued — DM + gift code {c} on its way.').replace('{c}', r.giftCode) : t('dm.sent', 'Queued — the bot DMs it within ~30s.'));
      setMessage(''); setDiscordId('');
    } catch (x) {
      const e = x.data?.error;
      toast.error(e === 'no_linked_account' ? t('dm.nolink', 'That Discord user has no linked BetterCommunity account — a gift code needs one.')
        : e === 'empty_message' ? t('dm.empty', 'Add a message or a gift.')
        : e === 'discount_needs_value' ? t('pc.err.discount', 'Set a % off or free months.')
        : e === 'hosting_needs_storage' ? t('pc.err.storage', 'Set the storage GB.')
        : e === 'boost_needs_days' ? t('pc.err.boost', 'Set the boost days.') : t('common.failed', 'Failed.'));
    } finally { setBusy(false); }
  };
  return (
    <Card className="p-4 mb-4">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between gap-2 text-left">
        <span className="font-medium text-sm flex items-center gap-2"><Mail size={14} className="text-[var(--primary-2)]" /> {t('dm.title', 'Direct message / gift')}</span>
        <ChevronDown size={16} className={`text-[var(--faint)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-[11px] text-[var(--faint)]">{t('dm.note', 'The bot DMs the user directly. A gift mints a one-time promo code reserved for their account and appends it to the message. Requires the user shares a server with the bot and has DMs open.')}</p>
          <Field label={t('dm.userid', 'Discord user id')} hint={t('dm.userid.h', 'Enable Developer Mode in Discord → right-click a user → Copy User ID.')}>
            <div className="flex gap-2">
              <Input value={discordId} onChange={(e) => setDiscordId(e.target.value)} placeholder="123456789012345678" />
              <Button type="button" onClick={() => setPicker((v) => !v)} title={t('dm.pick', 'Pick from members')} className={picker ? '!border-[var(--primary)]' : ''}><Users size={14} /> {t('dm.pick', 'Members')}</Button>
            </div>
          </Field>
          {/* Member picker — search the tracked Discord members and click one to fill the id. */}
          {picker && (
            <div className="rounded-lg border border-[var(--line)] p-2 -mt-1">
              <Input value={mq} onChange={(e) => setMq(e.target.value)} placeholder={t('dm.searchmem', 'Search name or id…')} className="!py-1.5 !text-sm mb-2" />
              {members.loading ? <div className="py-2"><Loading /></div> : (members.data?.members || []).length ? (
                <div className="max-h-52 overflow-auto divide-y divide-[var(--line)]">
                  {members.data.members.map((m) => (
                    <button key={m.discordId} type="button" onClick={() => { setDiscordId(m.discordId); setPicker(false); }}
                      className="w-full flex items-center gap-2 px-1.5 py-1.5 text-left text-sm hover:bg-[var(--surface-2)] rounded">
                      <span className="grid place-items-center w-7 h-7 rounded-full bg-[var(--surface-2)] text-[var(--faint)] shrink-0 text-xs font-bold">{(m.username || '?').slice(0, 2).toUpperCase()}</span>
                      <span className="flex-1 min-w-0"><span className="font-medium truncate block">{m.username || t('dm.unknownuser', 'unknown')}</span><span className="text-[11px] text-[var(--faint)] font-mono">{m.discordId}</span></span>
                      {m.linkedUser ? <Badge tone="green"><CheckCircle2 size={9} /> {t('dm.linked', 'linked')}</Badge> : <Badge>{t('dm.unlinked', 'unlinked')}</Badge>}
                    </button>
                  ))}
                </div>
              ) : <div className="text-xs text-[var(--faint)] px-1.5 py-2">{t('dm.nomembers', 'No members found. The bot populates this once it’s connected and has scanned the server.')}</div>}
            </div>
          )}
          <MessageField label={t('dm.message', 'Message')} value={message} onChange={setMessage} vars={DM_VARS}
            placeholder={t('dm.message.ph', 'Thanks for being awesome, {user}! Here’s a little something…')} giftCode={withGift ? '' : undefined} />
          <label className="flex items-center gap-2 text-sm text-[var(--muted)] cursor-pointer w-fit"><input type="checkbox" checked={withGift} onChange={(e) => setWithGift(e.target.checked)} /> <Gift size={13} className="text-[var(--primary-2)]" /> {t('dm.attachgift', 'Attach a gift promo code')}</label>
          {withGift && (
            <div className="rounded-lg border border-[var(--line)] p-3 grid sm:grid-cols-2 gap-3">
              <Field label={t('pc.f.type', 'Type')}><Dropdown className="w-full" value={gift.kind} onChange={(v) => setGift({ ...gift, kind: v })} options={[{ value: 'discount', label: t('pc.t.discount', 'Discount (% off / months free)') }, { value: 'free_hosting', label: t('pc.t.hosting', 'Free hosting') }, { value: 'free_boost', label: t('pc.t.boost', 'Free boost') }]} /></Field>
              {gift.kind === 'discount' && <><Field label={t('pc.f.pctoff', '% off')}><Input type="number" value={gift.percentOff} onChange={(e) => setGift({ ...gift, percentOff: e.target.value })} /></Field><Field label={t('pc.f.freemonths', 'First months free')}><Input type="number" value={gift.freeMonths} onChange={(e) => setGift({ ...gift, freeMonths: e.target.value })} /></Field></>}
              {gift.kind === 'free_hosting' && <><Field label={t('pc.f.storage', 'Storage GB')}><Input type="number" value={gift.storageGB} onChange={(e) => setGift({ ...gift, storageGB: e.target.value })} /></Field><Field label={t('pc.f.duration', 'Duration (months, 0 = forever)')}><Input type="number" value={gift.hostMonths} onChange={(e) => setGift({ ...gift, hostMonths: e.target.value })} /></Field></>}
              {gift.kind === 'free_boost' && <Field label={t('pc.f.boostdays', 'Boost days')}><Input type="number" value={gift.boostDays} onChange={(e) => setGift({ ...gift, boostDays: e.target.value })} /></Field>}
            </div>
          )}
          <div className="flex justify-end"><Button variant="primary" disabled={busy} onClick={send}>{busy ? <Spinner /> : <><Send size={14} /> {t('dm.send', 'Send')}</>}</Button></div>
        </div>
      )}
    </Card>
  );
}

// Admin: create & manage Discord giveaways — the bot posts an Enter button, collects
// entries, and draws winners at the end (DMing a gift code to each if configured).
function BotGiveawaysCard() {
  const { t } = useI18n(); const toast = useToast(); const dialog = useDialog();
  const [open, setOpen] = useState(false);
  const { data, loading, reload } = useAsync(() => api.get('/admin/bot/giveaways'), []);
  const [f, setF] = useState({ prize: '', channelId: '', durationMinutes: 60, winnersCount: 1, reqLinked: false, reqCreator: false, withGift: false, winnerMessage: 'Congrats {user} — you won {prize}! 🎉 Thanks for entering.', gift: { kind: 'discount', percentOff: 20, freeMonths: 0, storageGB: 10, boostDays: 7 } });
  const [busy, setBusy] = useState(false);
  const giveaways = data?.giveaways || [];
  const create = async () => {
    if (!f.prize.trim() || !f.channelId.trim()) return toast.error(t('gw.needfields', 'Prize and channel id are required.'));
    setBusy(true);
    try {
      const body = { prize: f.prize.trim(), channelId: f.channelId.trim(), durationMinutes: Number(f.durationMinutes) || 60, winnersCount: Number(f.winnersCount) || 1 };
      if (f.winnerMessage.trim()) body.winnerMessage = f.winnerMessage.trim();
      if (f.reqLinked || f.reqCreator) body.requirements = { linked: !!(f.reqLinked || f.reqCreator), creator: !!f.reqCreator };
      if (f.withGift) { const g = { kind: f.gift.kind }; if (f.gift.kind === 'discount') { if (Number(f.gift.percentOff)) g.percentOff = Number(f.gift.percentOff); if (Number(f.gift.freeMonths)) g.freeMonths = Number(f.gift.freeMonths); } if (f.gift.kind === 'free_hosting') g.storageGB = Number(f.gift.storageGB); if (f.gift.kind === 'free_boost') g.boostDays = Number(f.gift.boostDays); body.gift = g; }
      await api.post('/admin/bot/giveaways', body);
      toast.success(t('gw.created', 'Giveaway created — the bot posts it within ~30s.')); setF({ ...f, prize: '' }); reload();
    } catch { toast.error(t('common.failed', 'Failed.')); } finally { setBusy(false); }
  };
  const end = async (g) => { if (!(await dialog.confirm({ title: t('gw.end.t', 'Draw now?'), message: t('gw.end.m', 'End this giveaway now and draw the winners?'), okLabel: t('gw.end.ok', 'Draw now') }))) return; try { await api.post(`/admin/bot/giveaways/${g.id}/end`); toast.success(t('gw.ending', 'Drawing — winners announced within ~30s.')); reload(); } catch { toast.error(t('common.failed', 'Failed.')); } };
  const del = async (g) => { try { await api.del(`/admin/bot/giveaways/${g.id}`); reload(); } catch { toast.error(t('common.failed', 'Failed.')); } };
  return (
    <Card className="p-4 mb-4">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between gap-2 text-left">
        <span className="font-medium text-sm flex items-center gap-2"><Gift size={14} className="text-[var(--primary-2)]" /> {t('gw.title', 'Giveaways')}{giveaways.some((g) => g.status === 'active') && <Badge tone="green">{giveaways.filter((g) => g.status === 'active').length}</Badge>}</span>
        <ChevronDown size={16} className={`text-[var(--faint)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-[11px] text-[var(--faint)]">{t('gw.note', 'Also available as /giveaway (Manage-Server perm). The bot posts an “Enter” button; winners are drawn at the end and DMed a gift code if you attach one.')}</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label={t('gw.prize', 'Prize')}><Input value={f.prize} onChange={(e) => setF({ ...f, prize: e.target.value })} placeholder={t('gw.prize.ph', 'e.g. 1 month of hosting')} /></Field>
            <Field label={t('gw.channel', 'Channel id')} hint={t('db.f.chanid', 'Channel ID')}><Input value={f.channelId} onChange={(e) => setF({ ...f, channelId: e.target.value })} placeholder="123456789012345678" /></Field>
            <Field label={t('gw.duration', 'Duration (minutes)')}><Input type="number" value={f.durationMinutes} onChange={(e) => setF({ ...f, durationMinutes: e.target.value })} /></Field>
            <Field label={t('gw.winners', 'Winners')}><Input type="number" value={f.winnersCount} onChange={(e) => setF({ ...f, winnersCount: e.target.value })} /></Field>
          </div>
          {/* Entry requirements — gate who can enter (enforced server-side on Enter). */}
          <div className="rounded-lg border border-[var(--line)] p-3 space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] flex items-center gap-1.5"><Lock size={11} /> {t('gw.reqs', 'Entry requirements')}</div>
            <label className="flex items-center gap-2 text-sm text-[var(--muted)] cursor-pointer w-fit"><input type="checkbox" checked={f.reqLinked || f.reqCreator} disabled={f.reqCreator} onChange={(e) => setF({ ...f, reqLinked: e.target.checked })} /> {t('gw.req.linked', 'Require a linked BetterCommunity account (Discord ⇄ BCWEB)')}</label>
            <label className="flex items-center gap-2 text-sm text-[var(--muted)] cursor-pointer w-fit"><input type="checkbox" checked={f.reqCreator} onChange={(e) => setF({ ...f, reqCreator: e.target.checked, reqLinked: e.target.checked ? true : f.reqLinked })} /> {t('gw.req.creator', 'Require a linked BMM creator id')}</label>
            <div className="text-[11px] text-[var(--faint)]">{t('gw.req.note', 'Entrants without the required link get a helpful DM/notice pointing them to link — they can enter once linked.')}</div>
          </div>
          {/* Winner DM — customizable, English by default, with insert-at-cursor variables
              + a live preview. The bot substitutes {user}/{prize}/{code} when it sends. */}
          <MessageField label={t('gw.winnermsg', 'Winner DM message')} hint={t('gw.winnermsg.h', 'DMed to each winner when the giveaway ends.')}
            value={f.winnerMessage} onChange={(v) => setF({ ...f, winnerMessage: v })} vars={GIVEAWAY_VARS}
            placeholder={t('gw.winnermsg.ph', 'Congrats {user} — you won {prize}! 🎉')} giftCode={f.withGift ? '' : undefined} />
          <label className="flex items-center gap-2 text-sm text-[var(--muted)] cursor-pointer w-fit"><input type="checkbox" checked={f.withGift} onChange={(e) => setF({ ...f, withGift: e.target.checked })} /> <Gift size={13} className="text-[var(--primary-2)]" /> {t('gw.attachgift', 'DM each winner a gift code')}</label>
          {f.withGift && (
            <div className="rounded-lg border border-[var(--line)] p-3 grid sm:grid-cols-2 gap-3">
              <Field label={t('pc.f.type', 'Type')}><Dropdown className="w-full" value={f.gift.kind} onChange={(v) => setF({ ...f, gift: { ...f.gift, kind: v } })} options={[{ value: 'discount', label: t('pc.t.discount', 'Discount (% off / months free)') }, { value: 'free_hosting', label: t('pc.t.hosting', 'Free hosting') }, { value: 'free_boost', label: t('pc.t.boost', 'Free boost') }]} /></Field>
              {f.gift.kind === 'discount' && <><Field label={t('pc.f.pctoff', '% off')}><Input type="number" value={f.gift.percentOff} onChange={(e) => setF({ ...f, gift: { ...f.gift, percentOff: e.target.value } })} /></Field><Field label={t('pc.f.freemonths', 'First months free')}><Input type="number" value={f.gift.freeMonths} onChange={(e) => setF({ ...f, gift: { ...f.gift, freeMonths: e.target.value } })} /></Field></>}
              {f.gift.kind === 'free_hosting' && <Field label={t('pc.f.storage', 'Storage GB')}><Input type="number" value={f.gift.storageGB} onChange={(e) => setF({ ...f, gift: { ...f.gift, storageGB: e.target.value } })} /></Field>}
              {f.gift.kind === 'free_boost' && <Field label={t('pc.f.boostdays', 'Boost days')}><Input type="number" value={f.gift.boostDays} onChange={(e) => setF({ ...f, gift: { ...f.gift, boostDays: e.target.value } })} /></Field>}
            </div>
          )}
          <div className="flex justify-end"><Button variant="primary" disabled={busy} onClick={create}>{busy ? <Spinner /> : <><Plus size={14} /> {t('gw.create', 'Create giveaway')}</>}</Button></div>

          {loading ? <Loading /> : giveaways.length ? <div className="space-y-2 pt-1">
            {giveaways.map((g) => (
              <div key={g.id} className="flex items-center gap-3 text-sm rounded-lg bg-[var(--surface-2)] px-3 py-2">
                <Gift size={14} className={g.status === 'active' ? 'text-emerald-400 shrink-0' : 'text-[var(--faint)] shrink-0'} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{g.prize} {g.hasGift && <Badge tone="primary"><Gift size={9} /> {t('gw.gift', 'gift')}</Badge>} {g.requirements?.creator ? <Badge tone="amber"><Lock size={9} /> {t('gw.badge.creator', 'creator id')}</Badge> : g.requirements?.linked ? <Badge tone="amber"><Lock size={9} /> {t('gw.badge.linked', 'linked')}</Badge> : null}</div>
                  <div className="text-[11px] text-[var(--faint)]">{g.status === 'active' ? t('gw.endsat', 'ends {d}').replace('{d}', new Date(g.endsAt).toLocaleString()) : t('gw.ended', 'ended · {n} winner(s)').replace('{n}', g.winnerIds?.length || 0)} · {t('gw.entries', '{n} entries').replace('{n}', g.entryCount)}</div>
                </div>
                {g.status === 'active' && <Button size="sm" variant="ghost" onClick={() => end(g)}>{t('gw.drawbtn', 'Draw now')}</Button>}
                <Button size="sm" variant="ghost" className="!text-red-400" onClick={() => del(g)}><Trash2 size={13} /></Button>
              </div>
            ))}
          </div> : <div className="text-xs text-[var(--faint)]">{t('gw.none', 'No giveaways yet.')}</div>}
        </div>
      )}
    </Card>
  );
}

// Diagnostic under the Payments module: shows whether Payment rows even exist, so
// "the bot doesn't post real payments" can be told apart from "no payments recorded
// at all" (= the Stripe webhook isn't reaching the API).
function PaymentsDiag() {
  const { t } = useI18n();
  const { data } = useAsync(() => api.get('/admin/bot/payments/status').catch(() => null), []);
  if (!data) return null;
  const fdate = (d) => d ? new Date(d).toLocaleString() : '—';
  return (
    <div className="mt-2 pt-2 border-t border-[var(--line)] text-[11px] space-y-1">
      <div className="flex items-center gap-3 text-[var(--muted)] flex-wrap">
        <span><b className="text-[var(--text)] tabular-nums">{data.totalPayments}</b> {t('db.pay.diag.total', 'payments recorded')}</span>
        <span><b className="text-[var(--text)] tabular-nums">{data.announced}</b> {t('db.pay.diag.announced', 'announced')}</span>
        <span><b className="text-[var(--text)] tabular-nums">{data.refundEvents}</b> {t('db.pay.diag.refunds', 'refund events')}</span>
        {data.lastPaymentAt && <span>{t('db.pay.diag.last', 'last')}: {fdate(data.lastPaymentAt)}</span>}
      </div>
      <div className="flex items-center gap-2 flex-wrap text-[var(--faint)]">
        <span className={data.stripeKey ? 'text-emerald-400' : 'text-red-400'}>{data.stripeKey ? '✓' : '✗'} {t('db.pay.diag.key', 'Stripe key')}</span>
        <span className={data.webhookSecret ? 'text-emerald-400' : 'text-red-400'}>{data.webhookSecret ? '✓' : '✗'} {t('db.pay.diag.whsecret', 'Webhook secret')}</span>
      </div>
      {!data.webhookSecret && (
        <div className="flex items-start gap-1.5 text-red-400">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" />
          <span>{t('db.pay.diag.nowh', 'STRIPE_WEBHOOK_SECRET is not set — the webhook endpoint returns 503, so no checkout is ever recorded or provisioned (and nothing can be announced). Set it in compose .env.')}</span>
        </div>
      )}
      {data.webhookSecret && data.webhookHint && (
        <div className="flex items-start gap-1.5 text-amber-400">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" />
          <span>{t('db.pay.diag.hint2', 'No payments recorded yet. Stripe events aren’t reaching the API. Forward them to the API container (port 3000, not Stripe’s sample :4242): stripe listen --forward-to http://localhost:3000/hosting/webhook — and use the printed whsec_… as STRIPE_WEBHOOK_SECRET.')}</span>
        </div>
      )}
    </div>
  );
}

function AdminBot() {
  const toast = useToast();
  const { t } = useI18n();
  const { data, loading, reload } = useAsync(() => api.get('/admin/bot/config'), []);
  const [cfg, setCfg] = useState(null);
  const [previewNonce, setPreviewNonce] = useState(0);
  const [tokenInput, setTokenInput] = useState('');
  const [scope, setScope] = useState(''); // '' = global defaults, else a guild id (per-server config)
  useEffect(() => { if (data?.config) setCfg(data.config); }, [data]);
  if (loading || !cfg) return <Loading />;
  const status = data?.status;
  const online = status?.online && status?.at && (Date.now() - new Date(status.at).getTime() < 180000);
  // When the bot is OFFLINE, ping/uptime are stale — showing them as live numbers
  // reads as a contradiction next to the "Offline" pill. Compute an honest "last seen"
  // instead, and only surface the live metrics while genuinely online.
  const lastSeen = (() => {
    if (!status?.at) return null;
    const m = Math.round((Date.now() - new Date(status.at).getTime()) / 60000);
    return m < 1 ? t('db.justnow', 'just now') : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`;
  })();
  // set a nested field: set('welcome.channelId', v)
  const set = (path, val) => setCfg((c) => {
    const next = structuredClone(c); const keys = path.split('.'); let o = next;
    for (let i = 0; i < keys.length - 1; i++) o = (o[keys[i]] ??= {});
    o[keys[keys.length - 1]] = val; return next;
  });
  const save = async () => { try { await api.put('/admin/bot/config', { config: cfg }); toast.success(t('db.saved', 'Bot config saved.')); reload(); } catch { toast.error(t('db.savefail', 'Save failed.')); } };
  const botDisabled = cfg.enabled === false;
  const saveToken = async () => {
    if (!tokenInput.trim()) return toast.error(t('db.token.entered', 'Enter a token.'));
    try { await api.put('/admin/bot/token', { token: tokenInput.trim() }); toast.success(t('db.token.tsaved', 'Token saved — the bot will connect within ~20s.')); setTokenInput(''); reload(); }
    catch (x) { toast.error(x.data?.error === 'bot_enabled' ? t('db.token.offfirst', 'Disable the bot first to change its token.') : x.data?.error === 'token_from_env' ? t('db.token.fromenv', 'Token is set via env — can’t change it here.') : t('db.token.failed', 'Failed.')); }
  };
  const clearToken = async () => {
    try { await api.put('/admin/bot/token', { token: null }); toast.success(t('db.token.cleared', 'Token cleared.')); reload(); }
    catch (x) { toast.error(x.data?.error === 'bot_enabled' ? t('db.token.offfirst', 'Disable the bot first.') : t('db.token.failed', 'Failed.')); }
  };
  const g = (path) => path.split('.').reduce((o, k) => o?.[k], cfg) ?? '';
  const guildList = status?.guildList || [];
  // Blog announcement routes: the new list, or the legacy single channel as one all-sources route.
  const blogRoutes = (cfg.blog?.routes?.length ? cfg.blog.routes : (cfg.blog?.channelId ? [{ channelId: cfg.blog.channelId, sources: ['*'] }] : []));
  // Welcome preview: substitute the message variables with sample values.
  const previewMsg = (tpl) => (tpl || '').replace(/\{user\}/g, '@NewMember').replace(/\{username\}/g, 'NewMember').replace(/\{servername\}/g, 'BetterCommunity').replace(/\{joinnumber\}/g, '1,024').replace(/\{joindate\}/g, new Date().toDateString());

  // ── Per-server scope ─────────────────────────────────────────────────────
  // The four per-server features (moderation / welcome / join-to-create / gating)
  // are edited under a "scope": '' = the Global defaults (top-level cfg, applied to
  // every server without its own config), or a guild id = that server's override in
  // cfg.guilds[id]. Blog/alerts/kofi/limits/token stay global.
  const scopeObj = scope ? (cfg.guilds?.[scope] || {}) : cfg;   // where the 4 features live for the current scope
  const base = scope ? `guilds.${scope}.` : '';
  const isCustomized = scope ? !!cfg.guilds?.[scope] : true;
  const sg = (p) => (base + p).split('.').reduce((o, k) => o?.[k], cfg) ?? '';
  const sset = (p, v) => set(base + p, v);
  const customizeServer = () => set(`guilds.${scope}`, {
    moderation: structuredClone(cfg.moderation || {}),
    welcome: structuredClone(cfg.welcome || {}),
    joinToCreate: structuredClone(cfg.joinToCreate || {}),
    gating: structuredClone(cfg.gating || {}),
  });
  const resetServer = () => setCfg((c) => { const next = structuredClone(c); if (next.guilds) delete next.guilds[scope]; return next; });
  const jtcLobbies = scopeObj.joinToCreate?.lobbies || (scopeObj.joinToCreate?.lobbyChannelId ? [{ lobbyChannelId: scopeObj.joinToCreate.lobbyChannelId, categoryId: scopeObj.joinToCreate.categoryId, tempCategoryName: scopeObj.joinToCreate.tempCategoryName }] : []);
  const purgeChans = scopeObj.moderation?.purgeChannelIds || (scopeObj.moderation?.purgeChannelId ? [scopeObj.moderation.purgeChannelId] : []);
  const scopeName = scope ? (guildList.find((gg) => gg.id === scope)?.name || scope) : t('db.scope.global', 'Global defaults');

  const SectionTitle = ({ icon: I, title, sub }) => (
    <div className="flex items-center gap-2.5 mt-6 mb-3">
      <span className="grid place-items-center w-8 h-8 rounded-lg bg-[var(--primary)]/10 border border-[var(--primary)]/20 shrink-0"><I size={15} className="text-[var(--primary-2)]" /></span>
      <div><div className="font-semibold text-sm">{title}</div>{sub && <div className="text-[11px] text-[var(--faint)]">{sub}</div>}</div>
    </div>
  );

  return (
    <div>
      {/* ── Header ── a defined solid rounded toolbar (its own Card surface) so the
          page's background art never bleeds around the title / Save button. */}
      <div className="sticky top-0 z-20 mb-4">
        <Card className="flex items-center justify-between flex-wrap gap-2 px-4 py-2.5">
          <h2 className="font-semibold flex items-center gap-2 text-base"><DiscordIcon size={18} className="text-[#5865F2]" /> {t('db.title', 'Discord bot')}</h2>
          <div className="flex items-center gap-2.5">
            <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${online ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' : 'text-[var(--faint)] border-[var(--line)]'}`}><span className={`w-2 h-2 rounded-full ${online ? 'bg-emerald-400 animate-pulse' : 'bg-[var(--line-strong)]'}`} /> {online ? t('db.online', 'Online') : t('db.offline', 'Offline')}</span>
            <Button size="sm" variant="primary" onClick={save}><CheckCircle2 size={14} /> {t('db.save', 'Save changes')}</Button>
          </div>
        </Card>
      </div>

      {/* connection error (e.g. privileged intents disabled) — actionable message */}
      {data?.error && (
        <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/[0.07] p-3 flex items-start gap-2.5">
          <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
          <div className="min-w-0"><div className="text-sm font-medium text-red-300">{t('db.cantconnect', 'Bot can’t connect')}</div><div className="text-xs text-red-300/90 mt-0.5 break-words">{data.error}</div></div>
        </div>
      )}

      {/* Master switch + live stats in one hero row */}
      <Card className="p-4 mb-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <label className="flex items-center gap-3 cursor-pointer">
            <span className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${cfg.enabled !== false ? 'bg-emerald-500' : 'bg-[var(--surface-2)] border border-[var(--line)]'}`}>
              <input type="checkbox" className="sr-only" checked={cfg.enabled !== false} onChange={(e) => set('enabled', e.target.checked)} />
              <span className={`inline-block h-4 w-4 rounded-full bg-white transition ${cfg.enabled !== false ? 'translate-x-6' : 'translate-x-1'}`} />
            </span>
            <span className="text-sm font-medium">{cfg.enabled !== false ? t('db.enabled', 'Bot enabled') : t('db.disabled', 'Bot disabled')} <span className="text-[var(--faint)] font-normal">· {t('db.master', 'master switch')}</span></span>
          </label>
          <div className="flex items-center gap-4 text-xs text-[var(--muted)] flex-wrap">
            <span><b className="text-[var(--text)]">{status?.guilds ?? '—'}</b> {t('db.servers', 'servers')}</span>
            <span><b className="text-[var(--text)]">{status?.users ?? '—'}</b> {t('db.users', 'users')}</span>
            <span><b className="text-[var(--text)]">{status?.tempChannels ?? 0}</b> {t('db.tempvoice', 'temp voice')}</span>
            {online ? <>
              <span><b className="text-[var(--text)]">{status?.ping != null ? `${status.ping}ms` : '—'}</b> {t('db.ping', 'ping')}</span>
              <span><b className="text-[var(--text)]">{status?.uptimeSec != null ? `${Math.floor(status.uptimeSec / 3600)}h ${Math.floor((status.uptimeSec % 3600) / 60)}m` : '—'}</b> {t('db.uptime', 'uptime')}</span>
            </> : (
              <span className="flex items-center gap-1 text-[var(--faint)]"><Clock size={11} /> {lastSeen ? t('db.lastseen', 'last seen {t} ago').replace('{t}', lastSeen) : t('db.neverseen', 'never connected')}</span>
            )}
          </div>
        </div>
        {(status?.mod && (status.mod.kicks || status.mod.timeouts || status.mod.purged)) ? (
          <div className="flex items-center gap-4 text-[11px] text-[var(--faint)] mt-2.5 pt-2.5 border-t border-[var(--line)]">
            <span>{status.mod.kicks ?? 0} {t('db.kicked', 'kicked')}</span><span>{status.mod.timeouts ?? 0} {t('db.timedout', 'timed out')}</span><span>{status.mod.purged ?? 0} {t('db.purged', 'purged')}</span><span className="text-[var(--faint)]">{t('db.session', '(this session)')}</span>
          </div>
        ) : null}
      </Card>

      {/* Token + member DB usage, side by side */}
      <div className="grid md:grid-cols-2 gap-4 mb-2">
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-1.5">
            <Lock size={15} className="text-[var(--primary-2)]" /><span className="font-medium text-sm">{t('db.token', 'Bot token')}</span>
            {data?.hasToken ? <Badge tone="green"><CheckCircle2 size={10} /> {t('db.set', 'Set')}</Badge> : <Badge tone="amber">{t('db.notset', 'Not set')}</Badge>}
          </div>
          {data?.tokenFromEnv ? (
            <p className="text-xs text-[var(--muted)]">{t('db.token.env', 'The token is provided via the DISCORD_TOKEN environment variable and is managed outside the dashboard.')}</p>
          ) : botDisabled ? (
            <>
              <p className="text-xs text-[var(--muted)] mb-2">{t('db.token.paste', 'Paste your Discord bot token — it’s stored server-side and the bot connects automatically within ~20s. The token is never shown again.')}</p>
              <div className="flex gap-2">
                <Input type="password" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} placeholder={data?.hasToken ? t('db.token.new', 'New token…') : t('db.token.ph', 'Bot token…')} onKeyDown={(e) => e.key === 'Enter' && saveToken()} />
                <Button variant="primary" onClick={saveToken}>{data?.hasToken ? t('db.token.change', 'Change') : t('db.token.settoken', 'Set token')}</Button>
                {data?.hasToken && <Button className="!text-red-400" onClick={clearToken}>{t('db.token.clear', 'Clear')}</Button>}
              </div>
            </>
          ) : (
            <p className="text-xs text-amber-400/90 flex items-center gap-1.5"><Bell size={12} /> {t('db.token.needoff', 'Turn the bot off (master switch) and Save to change the token.')}</p>
          )}
          {!online && !data?.hasToken && <div className="text-[11px] text-[var(--muted)] mt-2 flex items-center gap-1.5"><Bell size={12} /> {t('db.token.none', 'No token set — add one (or set DISCORD_TOKEN in compose .env) to bring the bot online.')}</div>}
        </Card>

        {data?.storage && (
          <Card className="p-4">
            <div className="flex items-center justify-between mb-1.5"><span className="font-medium text-sm flex items-center gap-2"><HardDrive size={14} className="text-[var(--primary-2)]" /> {t('db.memberdb', 'Member database')}</span>
              <span className="text-xs text-[var(--muted)]">{data.storage.memberCount} {t('db.tracked', 'tracked')}</span></div>
            {(() => { const capMB = cfg.limits?.storageMB || 0; const usedMB = data.storage.usedBytes / (1024 * 1024); const pct = capMB ? Math.min(100, (usedMB / capMB) * 100) : 0; return (
              <>
                <div className="h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className={`h-full ${pct > 90 ? 'bg-red-500' : 'bg-gradient-to-r from-orange-500 to-amber-500'}`} style={{ width: `${pct}%` }} /></div>
                <div className="text-xs text-[var(--faint)] mt-1.5">{usedMB.toFixed(1)} MB {capMB ? t('db.mbcap', '/ {c} MB max').replace('{c}', capMB) : t('db.nocap', '(no cap set)')} {t('db.dbnote', '— oldest inactive members are pruned once over.')}</div>
              </>
            ); })()}
          </Card>
        )}
      </div>

      <BotLogsCard />
      <BotDMCard />
      <BotGiveawaysCard />

      {/* ═══════════ GLOBAL — cross-server ═══════════ */}
      <SectionTitle icon={Globe} title={t('db.sec.global', 'Global — applies across every server')} sub={t('db.sec.global.sub', 'Announcements route by channel (works in any server); limits are shared.')} />
      {/* Masonry columns (not a 2-col grid): the expanded Payments card is much
          taller than the collapsed ones, so a grid left a big empty gap beside it.
          Columns let the short cards pack tight regardless of neighbour height. */}
      <div className="columns-1 md:columns-2 gap-4 [&>*]:mb-4 [&>*]:break-inside-avoid">
        <ModuleCard icon={Newspaper} title={t('db.mod.blog', 'Blog announcements')} desc={t('db.mod.blog.d', 'Post new blog posts to any channel — filter each route by project.')} enabled={!!cfg.blog?.enabled} onToggle={(v) => set('blog.enabled', v)}>
          <BlogRoutes routes={blogRoutes} onChange={(r) => set('blog.routes', r)} guildList={guildList} />
        </ModuleCard>

        <ModuleCard icon={AlertTriangle} title={t('db.mod.alerts', 'Server-perf alerts')} desc={t('db.mod.alerts.d', 'Post CPU/RAM/disk/service-down alerts as they fire.')} enabled={!!cfg.alerts?.enabled} onToggle={(v) => set('alerts.enabled', v)}>
          <Field label={t('db.f.alertch', 'Alerts channel id')} hint={t('db.f.alertch.h', 'Fired thresholds (Server perf tab) are posted here.')}>
            <Input value={g('alerts.channelId')} onChange={(e) => set('alerts.channelId', e.target.value)} placeholder={t('db.f.chanid', 'Channel ID')} />
          </Field>
        </ModuleCard>

        <ModuleCard icon={Heart} title={t('db.mod.kofi', 'Ko-fi tips')} desc={t('db.mod.kofi.d', 'Thank supporters automatically with a running total.')} enabled={!!cfg.kofi?.enabled} onToggle={(v) => set('kofi.enabled', v)}>
          <Field label={t('db.f.tipsch', 'Tips channel id')} hint={t('db.f.tipsch.h', 'Each new tip is posted as a thank-you embed. Old tips are never re-posted.')}>
            <Input value={g('kofi.channelId')} onChange={(e) => set('kofi.channelId', e.target.value)} placeholder={t('db.f.chanid', 'Channel ID')} />
          </Field>
        </ModuleCard>

        <ModuleCard icon={Receipt} title={t('db.mod.pay', 'Payments & refunds')} desc={t('db.mod.pay.d', 'Post each successful Stripe payment and each refund to the chosen channels.')} enabled={!!cfg.payments?.enabled} onToggle={(v) => set('payments.enabled', v)}>
          <Field label={t('db.f.paych', 'Payments channels')} hint={t('db.f.paych.h', 'Every successful payment (hosting, boost…) is posted to each of these channels.')}>
            <MultiChannelInput value={cfg.payments?.channelIds?.length ? cfg.payments.channelIds : (cfg.payments?.channelId ? [cfg.payments.channelId] : [])} onChange={(v) => set('payments.channelIds', v)} placeholder={t('db.f.chanid', 'Channel ID')} />
          </Field>
          <Field label={t('db.f.refundch', 'Refunds channels')} hint={t('db.f.refundch.h', 'Refunds are posted to each of these. Empty = use the payments channels.')}>
            <MultiChannelInput value={cfg.payments?.refundChannelIds?.length ? cfg.payments.refundChannelIds : (cfg.payments?.refundChannelId ? [cfg.payments.refundChannelId] : [])} onChange={(v) => set('payments.refundChannelIds', v)} placeholder={t('db.f.chanid', 'Channel ID')} />
          </Field>
          <div className="pt-1">
            <Button size="sm" onClick={async () => { try { await api.post('/admin/bot/payments/test'); toast.success(t('db.pay.testsent', 'Test queued — the bot posts it within ~2 min. Check the channel (and the bot logs if nothing shows).')); } catch { toast.error(t('common.failed', 'Failed.')); } }}><Bell size={13} /> {t('db.pay.test', 'Send test message')}</Button>
            <p className="text-[11px] text-[var(--faint)] mt-1.5">{t('db.pay.testnote', 'Posts a sample embed to the channels above so you can verify the bot can post there — no real payment needed. Save your channel ids first. Note: only NEW payments are announced after you enable this module (existing ones are skipped).')}</p>
            <PaymentsDiag />
          </div>
        </ModuleCard>

        <ModuleCard icon={Sliders} title={t('db.mod.limits', 'Limits')}>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('db.f.maxtemp', 'Max temp channels')}><Input type="number" value={g('limits.maxTempChannels')} onChange={(e) => set('limits.maxTempChannels', Number(e.target.value))} /></Field>
            <Field label={t('db.f.dbcap', 'Member DB cap (MB)')} hint={t('db.f.dbcap.h', 'Oldest inactive members are pruned once over.')}><Input type="number" value={g('limits.storageMB')} onChange={(e) => set('limits.storageMB', Number(e.target.value))} /></Field>
          </div>
        </ModuleCard>
      </div>

      {/* ═══════════ PER-SERVER ═══════════ */}
      <SectionTitle icon={Server} title={t('db.sec.perserver', 'Per-server configuration')} sub={t('db.sec.perserver.sub', 'Moderation, welcome, join-to-create and gated roles — set independently for each server the bot is in.')} />
      {/* Scope selector — a bot-dashboard server picker (avatars + custom-config dot) */}
      <div className="flex gap-2 mb-3 overflow-x-auto no-scrollbar pb-1">
        <ServerBubble name={t('db.scope.global', 'Global defaults')} sub={t('db.scope.everyserver', 'every server')} active={scope === ''} onClick={() => setScope('')} />
        {guildList.map((gg) => (
          <ServerBubble key={gg.id} name={gg.name} icon={gg.icon} sub={gg.members != null ? t('db.scope.members', '{n} members').replace('{n}', gg.members) : t('db.scope.server', 'server')}
            active={scope === gg.id} dot={!!cfg.guilds?.[gg.id]} onClick={() => setScope(gg.id)} />
        ))}
      </div>
      {guildList.length === 0 && (
        <div className="text-xs text-[var(--muted)] mb-3 flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface-2)]/40 p-3">
          <Bell size={13} /> {t('db.scope.noservers', 'No servers detected yet. Bring the bot online (token above) and add it to your Discord servers — they’ll appear here to configure individually. Until then, edit the Global defaults which apply to every server.')}
        </div>
      )}

      {/* Scope banner */}
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3 rounded-lg border border-[var(--line)] bg-[var(--surface-2)]/40 px-3 py-2">
        <div className="text-xs text-[var(--muted)] flex items-center gap-1.5 min-w-0">
          {scope ? <Server size={13} className="text-[var(--primary-2)] shrink-0" /> : <Globe size={13} className="text-[var(--primary-2)] shrink-0" />}
          <span className="truncate">{t('db.scope.editing', 'Editing')} <b className="text-[var(--text)]">{scopeName}</b>{scope ? (isCustomized ? '' : t('db.scope.usingdefaults', ' — currently using the global defaults')) : t('db.scope.appliedto', ' — applied to any server without its own config')}</span>
        </div>
        {scope && (isCustomized
          ? <Button size="sm" variant="ghost" className="!text-red-400" onClick={resetServer}><Trash2 size={13} /> {t('db.scope.reset', 'Reset to defaults')}</Button>
          : <Button size="sm" variant="primary" onClick={customizeServer}><Plus size={13} /> {t('db.scope.customize', 'Customize this server')}</Button>)}
      </div>

      {scope && !isCustomized ? (
        <div className="text-sm text-[var(--faint)] rounded-xl border border-dashed border-[var(--line)] p-6 text-center">
          <Server size={22} className="mx-auto mb-2 opacity-50" />
          {t('db.scope.prompt', 'This server uses the Global defaults. Click "Customize this server" above to give it its own moderation, welcome, join-to-create and gating settings.')}
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4 items-start">
          {/* Moderation */}
          <ModuleCard icon={Shield} title={t('db.mod.moderation', 'Moderation')} desc={t('db.mod.moderation.d', 'Auto-kick + purge in no-post channels; anti-selfbot timeout.')} enabled={!!scopeObj.moderation?.enabled} onToggle={(v) => sset('moderation.enabled', v)}>
            <label className="flex items-center justify-between gap-2 text-sm"><span>{t('db.f.antiselfbot', 'Anti-selfbot filter')} <span className="text-[var(--faint)]">{t('db.f.antiselfbot.sub', '(mass-mention timeout)')}</span></span><BotSwitch checked={!!scopeObj.moderation?.antiSelfbot} onChange={(v) => sset('moderation.antiSelfbot', v)} /></label>
            <Field label={t('db.f.nopost', 'No-post channels')} hint={t('db.f.nopost.h', 'Posting here kicks the user + purges their messages. A channel id is unique to its server.')}>
              <ChannelIdList ids={purgeChans} onChange={(v) => sset('moderation.purgeChannelIds', v)} placeholder={t('db.f.chanph', 'Channel ID — press Enter')} />
            </Field>
          </ModuleCard>

          {/* Join-to-create */}
          <ModuleCard icon={Mic} title={t('db.mod.jtc', 'Join-to-create voice')} desc={t('db.mod.jtc.d', 'Joining a lobby spawns a personal temp voice room.')} enabled={!!scopeObj.joinToCreate?.enabled} onToggle={(v) => sset('joinToCreate.enabled', v)}
            action={<Button size="sm" variant="ghost" onClick={() => sset('joinToCreate.lobbies', [...jtcLobbies, { lobbyChannelId: '', categoryId: '', tempCategoryName: 'Temp Voice' }])}><Plus size={13} /> {t('db.jtc.addlobby', 'Lobby')}</Button>}>
            {jtcLobbies.length === 0 && <div className="text-xs text-[var(--faint)]">{t('db.jtc.nolobbies', 'No lobbies — add one. Joining that voice channel spawns a temp room in its category.')}</div>}
            {jtcLobbies.map((lb, i) => (
              <div key={i} className="rounded-lg border border-[var(--line)] p-2.5 space-y-2 relative">
                <button onClick={() => sset('joinToCreate.lobbies', jtcLobbies.filter((_, k) => k !== i))} className="absolute top-2 right-2 text-[var(--faint)] hover:text-red-400"><Trash2 size={13} /></button>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)]">{t('db.jtc.lobbyn', 'Lobby {n}').replace('{n}', i + 1)}</div>
                <Input value={lb.lobbyChannelId || ''} onChange={(e) => sset('joinToCreate.lobbies', jtcLobbies.map((x, k) => k === i ? { ...x, lobbyChannelId: e.target.value } : x))} placeholder={t('db.jtc.lobbych', 'Lobby voice channel ID')} />
                <div className="grid grid-cols-2 gap-2">
                  <Input value={lb.categoryId || ''} onChange={(e) => sset('joinToCreate.lobbies', jtcLobbies.map((x, k) => k === i ? { ...x, categoryId: e.target.value } : x))} placeholder={t('db.jtc.catid', 'Category id (auto if empty)')} />
                  <Input value={lb.tempCategoryName || ''} onChange={(e) => sset('joinToCreate.lobbies', jtcLobbies.map((x, k) => k === i ? { ...x, tempCategoryName: e.target.value } : x))} placeholder={t('db.jtc.tempcat', 'Temp category name')} />
                </div>
              </div>
            ))}
          </ModuleCard>

          {/* Welcome / bye */}
          <ModuleCard icon={Sparkles} title={t('db.mod.welcome', 'Welcome / bye')} desc={t('db.mod.welcome.d', 'Animated banner + message when members join or leave.')} enabled={!!scopeObj.welcome?.enabled} onToggle={(v) => sset('welcome.enabled', v)}>
            <Field label={t('db.f.welcomech', 'Welcome channel id')}><Input value={sg('welcome.channelId')} onChange={(e) => sset('welcome.channelId', e.target.value)} placeholder={t('db.f.chanid', 'Channel ID')} /></Field>
            <Field label={t('db.f.joinmsg', 'Join message')} hint="{user} {username} {servername} {joinnumber} {joindate}"><Input value={sg('welcome.joinMessage')} onChange={(e) => sset('welcome.joinMessage', e.target.value)} /></Field>
            <Field label={t('db.f.leavemsg', 'Leave message')}><Input value={sg('welcome.leaveMessage')} onChange={(e) => sset('welcome.leaveMessage', e.target.value)} /></Field>
            <div className="rounded-lg border border-[var(--line)] overflow-hidden" style={{ background: '#0e0c09' }}>
              <div className="flex items-center justify-between px-3 pt-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--faint)]">{t('db.preview', 'Preview · real banner')}</div>
                <button onClick={() => setPreviewNonce((n) => n + 1)} className="text-[10px] text-[var(--primary-2)] hover:underline flex items-center gap-1"><RefreshCw size={10} /> {t('db.refresh', 'Refresh')}</button>
              </div>
              <div className="p-2">
                <img alt="Welcome banner preview" className="w-full rounded-md block"
                  src={`/api/admin/bot/welcome-preview.png?server=${encodeURIComponent(scopeName)}&members=${status?.users || 1024}&username=NewMember&_=${previewNonce}`}
                  onError={(e) => { e.currentTarget.style.display = 'none'; }} />
              </div>
              <div className="px-3 py-2 text-xs text-gray-300 border-t border-white/5">{previewMsg(sg('welcome.joinMessage')) || '—'}</div>
            </div>
          </ModuleCard>

          {/* Gated access */}
          <ModuleCard icon={KeyRound} title={t('db.mod.gating', 'Gated access')} desc={t('db.mod.gating.d', 'Grant roles automatically to members who link their account.')} enabled={!!scopeObj.gating?.enabled} onToggle={(v) => sset('gating.enabled', v)}>
            <p className="text-xs text-[var(--muted)]">{t('db.gating.desc', 'Each rule grants ONE Discord role to members who meet its requirements. Re-checked every ~5 min (granting AND removing); members can run /refreshroles to sync instantly after linking on the site.')}</p>
            <GatingRules rules={Array.isArray(scopeObj.gating?.rules) ? scopeObj.gating.rules : []} onChange={(rules) => sset('gating.rules', rules)} />
          </ModuleCard>
        </div>
      )}

      <AdminBotMembers />
    </div>
  );
}

// The bot's "member database" — DiscordActivity rows, paginated + searchable —
// with the linked BCWEB account shown when there is one.
function AdminBotMembers() {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [link, setLink] = useState(''); // '' | 'linked' | 'unlinked'
  const [rows, setRows] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [counts, setCounts] = useState(null); // { all, linked, unlinked }
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const load = async (append = false, linkOverride) => {
    setBusy(true);
    const lk = linkOverride !== undefined ? linkOverride : link;
    try {
      const skip = append ? (rows?.length || 0) : 0;
      const { members, hasMore: more, counts: c } = await api.get(`/admin/bot/members?q=${encodeURIComponent(q)}&skip=${skip}&take=30${lk ? `&link=${lk}` : ''}`);
      setRows(append ? [...(rows || []), ...members] : members); setHasMore(more); if (c) setCounts(c);
    } catch { if (!append) setRows([]); } finally { setBusy(false); }
  };
  useEffect(() => { load(false); /* eslint-disable-next-line */ }, []);
  const pickLink = (v) => { setLink(v); load(false, v); };
  const since = (d) => d ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
  const tabs = [['', t('bm.all', 'All'), counts?.all], ['linked', t('bm.linked', 'Linked'), counts?.linked], ['unlinked', t('bm.notlinked', 'Not linked'), counts?.unlinked]];
  return (
    <div className="mt-6">
      <button onClick={() => setCollapsed((x) => !x)} className="w-full flex items-center gap-2 mb-1 text-left">
        <Users size={16} className="text-[var(--primary-2)]" />
        <h2 className="font-semibold flex-1">{t('bm.title', 'Members')}{counts ? <span className="text-sm font-normal text-[var(--faint)]"> · {t('bm.count', '{a} total · {l} linked').replace('{a}', counts.all).replace('{l}', counts.linked)}</span> : null}</h2>
        <ChevronDown size={16} className={`text-[var(--faint)] transition-transform ${collapsed ? '-rotate-90' : ''}`} />
      </button>
      <p className="text-sm text-[var(--muted)] mb-3">{t('bm.desc', 'The full roster — the bot scans every member on startup. Shows join date, last message/voice activity, and whether the member has linked a BCWEB account.')}</p>
      {!collapsed && <>
        <div className="flex rounded-lg border border-[var(--line)] overflow-hidden w-fit mb-3">
          {tabs.map(([v, label, n]) => (
            <button key={v} onClick={() => pickLink(v)} className={`px-3 py-1.5 text-xs flex items-center gap-1.5 ${link === v ? 'bg-[var(--surface-2)] text-[var(--text)] font-medium' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>
              {v === 'linked' ? <CheckCircle2 size={12} className="text-emerald-400" /> : v === 'unlinked' ? <XCircle size={12} className="text-[var(--faint)]" /> : null}
              {label}{n != null && <span className="text-[var(--faint)]">{n}</span>}
            </button>
          ))}
        </div>
        <div className="flex gap-2 mb-3">
          <div className="relative flex-1"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
            <Input className="!pl-9" placeholder={t('bm.search', 'Search by Discord id or username…')} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load(false)} /></div>
          <Button variant="primary" disabled={busy} onClick={() => load(false)}>{busy ? <Spinner /> : <><Search size={15} /> {t('bm.searchbtn', 'Search')}</>}</Button>
        </div>
        {rows === null ? <Loading /> : rows.length ? <div className="space-y-1.5">
          {rows.map((m) => (
            <Card key={m.discordId} className="p-3 flex items-center gap-3">
              {m.avatar ? <img src={m.avatar} alt="" className="w-9 h-9 rounded-full shrink-0" /> : <div className="w-9 h-9 rounded-full bg-[var(--surface-2)] grid place-items-center shrink-0"><DiscordIcon size={16} className="text-[#5865F2]" /></div>}
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate flex items-center gap-2">{m.username || m.discordId}
                  {m.linkedUser
                    ? <Badge tone="green"><CheckCircle2 size={11} /> {m.linkedUser.displayName}</Badge>
                    : <Badge><XCircle size={11} /> {t('bm.notlinked', 'Not linked')}</Badge>}
                </div>
                <div className="text-xs text-[var(--faint)] truncate">{t('bm.joined', 'joined')} {since(m.guildJoinedAt)} · {t('bm.lastmsg', 'last message')} {since(m.lastMessageAt)} · {t('bm.lastvoice', 'last voice')} {since(m.lastVoiceJoinAt)} · id {m.discordId}</div>
              </div>
            </Card>
          ))}
          {hasMore && <div className="text-center pt-1"><Button variant="ghost" disabled={busy} onClick={() => load(true)}>{busy ? <Spinner /> : t('bm.loadmore', 'Load more')}</Button></div>}
        </div> : <EmptyState icon={Users} title={link === 'linked' ? t('bm.none.linked', 'No linked members') : link === 'unlinked' ? t('bm.none.unlinked', 'No unlinked members') : t('bm.none', 'No members tracked yet')} sub={link ? t('bm.trother', 'Try another filter.') : t('bm.none.sub', "They'll appear here once the bot scans the server (on startup).")} />}
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
  const toast = useToast(); const { t } = useI18n();
  const { data, loading, reload } = useAsync(() => api.get('/admin/storage'), []);
  const [repoQ, setRepoQ] = useState('');   // search: hosted repos
  const [pendQ, setPendQ] = useState('');   // search: pending deletions
  const cancelRepoDeletion = async (r) => { try { await api.post(`/admin/repos/${r.id}/delete/cancel`); toast.success(t('as.backonline', '"{n}" is back online.').replace('{n}', r.name)); reload(); } catch { toast.error(t('common.failed', 'Failed.')); } };
  if (loading) return <Loading />;
  const d = data || {};
  const rq = repoQ.trim().toLowerCase();
  const filteredRepos = (d.topRepos || []).filter((r) => !rq || r.name?.toLowerCase().includes(rq) || r.owner?.toLowerCase().includes(rq));
  const pq = pendQ.trim().toLowerCase();
  const pendItems = (d.pending?.items || []).filter((i) => !pq || i.name?.toLowerCase().includes(pq) || i.kind?.toLowerCase().includes(pq));
  const pendRepos = (d.pending?.repos || []).filter((r) => !pq || r.name?.toLowerCase().includes(pq) || r.owner?.toLowerCase().includes(pq));
  const areas = d.areas || [];
  const total = d.totals?.bytes || 0;
  const colors = ['bg-orange-500', 'bg-amber-400', 'bg-sky-400', 'bg-red-400'];
  const AREA_ICON = { repos: Server, catalog: Package, blog: Newspaper, other: AlertTriangle };
  const pending = (d.pending?.items?.length || 0) + (d.pending?.repos?.length || 0);
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold flex items-center gap-2"><HardDrive size={16} className="text-[var(--primary-2)]" /> {t('as.title', 'Storage')}</h2>
        <Button size="sm" variant="ghost" onClick={reload}><RefreshCw size={14} /> {t('as.refresh', 'Refresh')}</Button>
      </div>

      <div className="grid sm:grid-cols-[2fr_1fr] gap-3 mb-4">
        <Card className="p-5">
          <div className="text-3xl font-bold">{fmtBytes(total)}</div>
          <div className="text-xs text-[var(--muted)] mb-3">{t('as.acrossobjects', 'across {n} objects in object storage').replace('{n}', d.totals?.count || 0)}</div>
          <div className="h-3 rounded-full overflow-hidden flex bg-[var(--surface-2)]">
            {areas.map((a, i) => <div key={a.key} className={colors[i % colors.length]} style={{ width: `${total ? (a.bytes / total * 100) : 0}%` }} title={`${a.label}: ${fmtBytes(a.bytes)}`} />)}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3 text-xs">
            {areas.map((a, i) => <span key={a.key} className="flex items-center gap-1.5"><span className={`w-2.5 h-2.5 rounded-sm ${colors[i % colors.length]}`} />{a.label} · <b>{fmtBytes(a.bytes)}</b> ({a.count})</span>)}
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2 text-xs text-[var(--faint)] mb-1"><HardDrive size={13} /> {t('as.dball', 'Database (all tables)')}</div>
          <div className="text-2xl font-bold">{d.dbSizeBytes != null ? fmtBytes(d.dbSizeBytes) : '—'}</div>
          <div className="text-[11px] text-[var(--faint)] mt-1">{t('as.dbdesc', 'Users, content, logs, metrics & analytics — everything besides object storage.')}</div>
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
              <div className="text-sm font-medium flex items-center gap-2"><HardDrive size={15} className="text-[var(--primary-2)]" /> {t('as.totalcap', 'Total capacity')}</div>
              <div className="text-xs text-[var(--muted)]"><b className="text-[var(--text)]">{cap.allocatedGB.toFixed(1)}</b> / {cap.usableGB.toFixed(0)} {t('as.gballocated', 'GB allocated')} <span className="text-[var(--faint)]">· {t('as.totalreserved', 'total {t} GB, {r} reserved').replace('{t}', cap.totalGB).replace('{r}', cap.reservedGB)}</span></div>
            </div>
            <div className="h-3 rounded-full bg-[var(--surface-2)] overflow-hidden">
              <div className={`h-full transition-all ${near ? 'bg-gradient-to-r from-red-500 to-orange-500' : 'bg-gradient-to-r from-orange-500 to-amber-400'}`} style={{ width: `${pct}%` }} />
            </div>
            <div className={`text-xs mt-2 ${near ? 'text-red-400' : 'text-[var(--muted)]'}`}>{t('as.usableallocated', '{p}% of usable capacity allocated · {f} GB free').replace('{p}', Math.round(pct)).replace('{f}', cap.freeGB.toFixed(1))}{near ? t('as.pricesrise', ' — prices rise near the limit.') : ''}</div>
            <div className="text-[11px] text-[var(--faint)] mt-1.5">{t('as.hostingquotas', '{h} GB hosting quotas + {s} GB approved submissions').replace('{h}', cap.hostingAllocatedGB?.toFixed(1)).replace('{s}', cap.submissionsPublishedGB?.toFixed(2))}{cap.diskFreeGB != null && <> · {t('as.realdiskfree', 'real disk free:')} <b className="text-[var(--text)]">{cap.diskFreeGB.toFixed(0)} GB</b> / {t('as.gbtotal', '{n} GB total').replace('{n}', cap.diskTotalGB.toFixed(0))}</>}</div>
          </Card>
        );
      })()}

      {/* Full per-purpose ledger — every category that draws real disk space,
          each with its own allocation/usage, so "where did the space go" is
          always answerable instead of one opaque "Total capacity" number. */}
      {d.ledger && (
        <Card className="p-5 mb-4">
          <div className="text-sm font-medium mb-1 flex items-center gap-2"><Sliders size={15} className="text-[var(--primary-2)]" /> {t('as.capbypurpose', 'Capacity by purpose')}</div>
          <div className="text-[11px] text-[var(--faint)] mb-2">{t('as.capbypurposesub', 'Real usage per category — approved submissions move out of the temp margin and into their own permanent bucket once approved.')}</div>
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
            <div className="text-xs text-[var(--faint)] mt-0.5">{t('as.objects', '{n} objects').replace('{n}', a.count)} · <code>{a.prefix}</code></div>
          </Card>); })}
      </div>

      <Card className="p-4 mb-4">
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <div className="text-sm font-medium">{t('as.hostedrepos', 'Hosted repos')} <span className="text-[var(--faint)] font-normal">({(d.topRepos || []).length})</span></div>
          {(d.topRepos || []).length > 2 && (
            <div className="relative w-full sm:w-56"><Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
              <Input className="!pl-8 !py-1.5 !text-sm" placeholder={t('as.searchnameowner', 'Search name or owner…')} value={repoQ} onChange={(e) => setRepoQ(e.target.value)} /></div>
          )}
        </div>
        <div className="grid grid-cols-3 gap-3 text-center mb-3">
          <div><div className="text-xl font-bold">{d.db?.hostedRepos || 0}</div><div className="text-xs text-[var(--muted)]">{t('as.repos', 'repos')}</div></div>
          <div><div className="text-xl font-bold">{fmtBytes(d.db?.repoUsedBytes || 0)}</div><div className="text-xs text-[var(--muted)]">{t('as.used', 'used')}</div></div>
          <div><div className="text-xl font-bold">{fmtBytes(d.db?.repoAllocatedBytes || 0)}</div><div className="text-xs text-[var(--muted)]">{t('as.allocatedquota', 'allocated (quota)')}</div></div>
        </div>
        {filteredRepos.length > 0 ? <div className="space-y-1.5 border-t border-[var(--line)] pt-3 max-h-72 overflow-auto">
          {filteredRepos.map((r) => <div key={r.id} className="flex items-center gap-2 text-sm"><Server size={13} className="text-[var(--faint)] shrink-0" /><span className="flex-1 truncate">{r.name} <span className="text-[var(--faint)]">· {r.owner}</span></span><span className="text-xs text-[var(--muted)] tabular-nums">{fmtBytes(r.used)} / {fmtBytes(r.quota)}</span></div>)}
        </div> : <div className="text-sm text-[var(--muted)] border-t border-[var(--line)] pt-3">{rq ? t('as.norepomatch', 'No repos match your search.') : t('as.nohosted', 'No hosted repos.')}</div>}
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <div className="text-sm font-medium flex items-center gap-2"><Trash2 size={14} className="text-red-400" /> {t('as.pendingdel', 'Pending deletions (72h grace)')}{pending > 0 && <Badge tone="red">{pending}</Badge>}</div>
          {pending > 2 && (
            <div className="relative w-full sm:w-56"><Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
              <Input className="!pl-8 !py-1.5 !text-sm" placeholder={t('as.searchnameownerkind', 'Search name, owner or kind…')} value={pendQ} onChange={(e) => setPendQ(e.target.value)} /></div>
          )}
        </div>
        {pending ? ((pendItems.length + pendRepos.length) ? <div className="space-y-1.5 max-h-72 overflow-auto">
          {pendItems.map((i) => { const I = KIND_ICON[i.kind] || Package; return <div key={i.id} className="flex items-center gap-2 text-sm"><I size={14} className="text-[var(--faint)] shrink-0" /><Badge>{i.kind}</Badge><span className="flex-1 truncate">{i.name}</span><span className="text-xs text-red-400">{t('as.in', 'in')} {fmtRemaining(i.deleteAt)}</span></div>; })}
          {pendRepos.map((r) => <div key={r.id} className="flex items-center gap-2 text-sm"><Server size={14} className="text-[var(--faint)] shrink-0" /><Badge>{t('as.repo', 'repo')}</Badge><span className="flex-1 truncate">{r.name} <span className="text-[var(--faint)]">· {r.owner}</span></span><span className="text-xs text-red-400">{t('as.in', 'in')} {fmtRemaining(r.deleteAt)}</span><Button size="sm" variant="ghost" onClick={() => cancelRepoDeletion(r)}>{t('su.cancel', 'Cancel')}</Button></div>)}
        </div> : <div className="text-sm text-[var(--muted)]">{t('as.nopendmatch', 'No pending deletions match your search.')}</div>) : <div className="text-sm text-[var(--muted)]">{t('as.nothingdel', 'Nothing scheduled for deletion.')}</div>}
      </Card>

      {d.telemetryExternal && <p className="text-xs text-[var(--faint)] mt-3">{t('as.telemreplays', 'Telemetry replays (rrweb) are stored by the separate BMM telemetry service and are not counted here.')}</p>}
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
  const [wrapRef, W] = useElementWidth(800);
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
  const H = 170, padL = 30, padR = 6, padY = 6, n = series.length;
  const max = Math.max(1, ...series.map((s) => Math.max(s.count, s.visitors || 0)));
  const x = (i) => padL + (n <= 1 ? (W - padL - padR) / 2 : (i / (n - 1)) * (W - padL - padR));
  const y = (v) => H - padY - (v / max) * (H - padY * 2);
  const path = (key) => series.map((s, i) => `${i ? 'L' : 'M'} ${x(i).toFixed(1)} ${y(s[key] || 0).toFixed(1)}`).join(' ');
  const area = `${path('count')} L ${x(n - 1).toFixed(1)} ${H - padY} L ${x(0).toFixed(1)} ${H - padY} Z`;
  const labelEvery = Math.ceil(n / 8);
  // Y-axis gridlines at 0 / ¼ / ½ / ¾ / max — finer scale so the exact height of
  // each point is readable, not just "somewhere between zero and the peak".
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ v: Math.round(max * f), py: y(max * f) }));
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

// ISO alpha-2 → localized country name (built-in, no data table).
const countryName = (cc) => { try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(String(cc).toUpperCase()) || cc; } catch { return cc; } };
const flagUrl = (cc, size = '24x18') => `https://flagcdn.com/${size}/${String(cc).toLowerCase()}.png`;
const Flag = ({ cc, className = 'w-4 h-3' }) => cc
  ? <img src={flagUrl(cc)} alt="" className={`${className} rounded-[2px] object-cover shrink-0`} onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
  : <Globe size={13} className="text-[var(--faint)] shrink-0" />;

// Tiny inline area sparkline for KPI-card backgrounds. `data` = array of numbers.
function Sparkline({ data, className = '', stroke = 'var(--primary)' }) {
  if (!data || data.length < 2) return null;
  const W = 120, H = 40, max = Math.max(1, ...data), n = data.length;
  const x = (i) => (i / (n - 1)) * W;
  const y = (v) => H - (v / max) * (H - 3) - 1.5;
  const line = data.map((v, i) => `${i ? 'L' : 'M'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L ${W} ${H} L 0 ${H} Z`;
  const gid = `spk-${Math.random().toString(36).slice(2, 8)}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={className} aria-hidden>
      <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={stroke} stopOpacity="0.28" /><stop offset="100%" stopColor={stroke} stopOpacity="0" /></linearGradient></defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={stroke} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" opacity="0.9" />
    </svg>
  );
}

// Geo panel with Countries / Regions / Cities / Map tabs. Regions & cities carry their
// country so the right flag shows next to a subdivision/city name.
function GeoPanel({ countries, regions, cities, days, hours }) {
  const { t } = useI18n();
  const [tab, setTab] = useState('countries');
  const tabs = [['countries', t('an.geo.countries', 'Countries'), Globe2], ['regions', t('an.geo.regions', 'Regions'), MapPin], ['cities', t('an.geo.cities', 'Cities'), Building2], ['map', t('an.geo.map', 'Map'), MapIcon]];
  const list = tab === 'countries' ? countries : tab === 'regions' ? regions : cities;
  const tot = (list || []).reduce((a, r) => a + r.count, 0) || 1;
  const max = Math.max(1, ...(list || []).map((r) => r.count));
  return (
    <Card className="p-5">
      <div className="flex items-center gap-1 mb-3 border-b border-[var(--line)] -mx-1 px-1">
        {tabs.map(([id, label, Icon]) => (
          <button key={id} onClick={() => setTab(id)} className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border-b-2 -mb-px transition ${tab === id ? 'border-[var(--primary)] text-[var(--text)]' : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'}`}><Icon size={13} /> {label}</button>
        ))}
      </div>
      {tab === 'map' ? <GeoMap days={days} hours={hours} height={340} />
        : (list && list.length) ? (
          <div className="space-y-2.5 max-h-[340px] overflow-auto pr-1">
            {list.map((r, i) => (
              <div key={`${r.label}-${i}`} className="flex items-center gap-3 text-sm">
                <span className="text-[var(--muted)] w-40 shrink-0 flex items-center gap-2 truncate">
                  <Flag cc={r.country || r.label} />
                  <span className="truncate">{tab === 'countries' ? countryName(r.label) : r.label}{tab === 'cities' && r.region ? <span className="text-[var(--faint)]"> · {r.region}</span> : null}</span>
                </span>
                <div className="flex-1 h-2 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className="h-full bg-gradient-to-r from-orange-500 to-amber-500" style={{ width: `${(r.count / max) * 100}%` }} /></div>
                <span className="w-12 text-right font-medium">{Math.round((r.count / tot) * 100)}%</span>
              </div>
            ))}
          </div>
        ) : <div className="text-sm text-[var(--faint)] py-4">{t('an.geo.none', 'No data yet — needs geo-located visits.')}</div>}
    </Card>
  );
}

// ── Web Vitals (real-user performance) ─────────────────────────────────────────
const VITAL_META = {
  LCP:  { label: 'Largest Contentful Paint', unit: 'ms', good: 2500, poor: 4000, fmt: (v) => v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms` },
  CLS:  { label: 'Cumulative Layout Shift', unit: '', good: 0.1, poor: 0.25, fmt: (v) => v.toFixed(3) },
  INP:  { label: 'Interaction to Next Paint', unit: 'ms', good: 200, poor: 500, fmt: (v) => `${Math.round(v)} ms` },
  FCP:  { label: 'First Contentful Paint', unit: 'ms', good: 1800, poor: 3000, fmt: (v) => v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms` },
  TTFB: { label: 'Time to First Byte', unit: 'ms', good: 800, poor: 1800, fmt: (v) => `${Math.round(v)} ms` },
};
const vitalRating = (m, v) => v == null ? null : v <= VITAL_META[m].good ? 'good' : v <= VITAL_META[m].poor ? 'ni' : 'poor';
const vitalColor = (r) => r === 'good' ? 'text-emerald-400' : r === 'ni' ? 'text-amber-400' : r === 'poor' ? 'text-red-400' : 'text-[var(--faint)]';

function WebVitals({ days, hours }) {
  const { t } = useI18n();
  const [pct, setPct] = useState('p75');
  const { data, loading } = useAsync(() => api.get(`/admin/analytics/vitals?${hours ? `hours=${hours}` : `days=${days}`}`), [days, hours]);
  const metrics = data?.metrics || [];
  const pages = data?.pages || [];
  const cell = (m, v) => <span className={vitalRating(m, v) ? vitalColor(vitalRating(m, v)) : ''}>{v == null ? '—' : VITAL_META[m].fmt(v)}</span>;
  return (
    <Card className="p-5 mb-4">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="text-sm font-semibold flex items-center gap-2"><Activity size={15} /> Web Vitals <span className="text-[11px] font-normal text-[var(--faint)]">{t('an.wv.sub', 'real-user performance')}</span></div>
        <div className="flex rounded-lg border border-[var(--line)] overflow-hidden">
          {['p50', 'p75', 'p90', 'p99'].map((p) => <button key={p} onClick={() => setPct(p)} className={`px-2.5 py-1 text-xs uppercase ${pct === p ? 'bg-[var(--surface-2)] text-[var(--text)] font-medium' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>{p}</button>)}
        </div>
      </div>
      {loading ? <div className="h-24 grid place-items-center"><Spinner /></div> : !metrics.some((m) => m.n) ? (
        <div className="text-sm text-[var(--faint)] py-6 text-center">{t('an.wv.none', 'No performance samples yet — collected from real visits (needs analytics consent).')}</div>
      ) : <>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
          {metrics.map((m) => { const v = m[pct]; const r = vitalRating(m.metric, v);
            const trend = (data?.trend || []).filter((x) => x.metric === m.metric).map((x) => x.p75).filter((x) => x != null);
            const stroke = r === 'good' ? '#34d399' : r === 'ni' ? '#f59e0b' : r === 'poor' ? '#f87171' : 'var(--primary)';
            return (
            <div key={m.metric} className="rounded-xl border border-[var(--line)] p-3 relative overflow-hidden">
              {trend.length > 1 && <Sparkline data={trend} stroke={stroke} className="absolute inset-x-0 bottom-0 h-7 w-full opacity-50 pointer-events-none" />}
              <div className="relative">
                <div className="text-[11px] text-[var(--muted)] flex items-center gap-1" title={VITAL_META[m.metric].label}>{m.metric}{m.goodShare != null && <span className="ml-auto text-[10px] text-[var(--faint)]">{m.goodShare}% {t('an.wv.good', 'good')}</span>}</div>
                <div className={`text-xl font-bold mt-1 ${r ? vitalColor(r) : ''}`}>{v == null ? '—' : VITAL_META[m.metric].fmt(v)}</div>
                {m.goodShare != null && <div className="h-1 rounded-full bg-[var(--surface-2)] overflow-hidden mt-1.5 mb-0.5"><div className="h-full" style={{ width: `${m.goodShare}%`, background: m.goodShare >= 75 ? '#34d399' : m.goodShare >= 50 ? '#f59e0b' : '#f87171' }} /></div>}
                <div className="text-[10px] text-[var(--faint)]">{m.n} {t('an.wv.samples', 'samples')} · {t('an.wv.goodle', 'good ≤')} {VITAL_META[m.metric].fmt(VITAL_META[m.metric].good)}</div>
              </div>
            </div>
          ); })}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead><tr className="text-[11px] uppercase text-[var(--faint)] text-left border-b border-[var(--line)]">
              <th className="py-2 font-semibold">{t('an.wv.page', 'Page')}</th><th className="py-2 font-semibold text-right">LCP</th><th className="py-2 font-semibold text-right">CLS</th><th className="py-2 font-semibold text-right">INP</th><th className="py-2 font-semibold text-right">FCP</th><th className="py-2 font-semibold text-right">TTFB</th><th className="py-2 font-semibold text-right">{t('an.wv.samplesCol', 'Samples')}</th>
            </tr></thead>
            <tbody>
              {pages.map((pg) => (
                <tr key={pg.path} className="border-b border-[var(--line)]/60">
                  <td className="py-2 pr-3 font-mono text-xs text-[var(--muted)] truncate max-w-[220px]" title={pg.path}>{pg.path}</td>
                  <td className="py-2 text-right tabular-nums">{cell('LCP', pg.lcp)}</td>
                  <td className="py-2 text-right tabular-nums">{cell('CLS', pg.cls)}</td>
                  <td className="py-2 text-right tabular-nums">{cell('INP', pg.inp)}</td>
                  <td className="py-2 text-right tabular-nums">{cell('FCP', pg.fcp)}</td>
                  <td className="py-2 text-right tabular-nums">{cell('TTFB', pg.ttfb)}</td>
                  <td className="py-2 text-right text-[var(--faint)] tabular-nums">{pg.samples}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-[var(--faint)] mt-3">{t('an.wv.note', 'Per-page p75 (75th percentile) of each metric — the value 75% of real visits are faster than. Green ≤ “good”, amber ≤ “needs improvement”, red above. CLS is unitless; the rest are time.')}</p>
      </>}
    </Card>
  );
}

// Live/recent visitor sessions (Rybbit-style). Auto-refreshes so "in progress" sessions
// update; each row expands to its page-by-page timeline. Built from the pageview stream.
const fmtDur = (s) => s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
const fmtAgo = (d) => { const s = Math.round((Date.now() - new Date(d).getTime()) / 1000); return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`; };

// Anonymous per-session identity (never the real account): a stable "Colour Animal"
// nickname + a Boring-Avatar, both seeded by the daily-rotating visitor hash — the same
// privacy-friendly style as the BMM telemetry dashboard.
const NICK_ADJ = ['Lavender', 'Tan', 'Violet', 'Lime', 'Sapphire', 'Emerald', 'Peach', 'Gray', 'Amethyst', 'Beige', 'Teal', 'Tomato', 'Apricot', 'Aquamarine', 'Salmon', 'Crimson', 'Indigo', 'Olive', 'Coral', 'Azure', 'Maroon', 'Cyan', 'Magenta', 'Amber'];
const NICK_ANIMAL = ['Chimpanzee', 'Tiglon', 'Koi', 'Lynx', 'Anteater', 'Krill', 'Vole', 'Giraffe', 'Canid', 'Urial', 'Zebra', 'Herring', 'Viper', 'Scallop', 'Bison', 'Marten', 'Barracuda', 'Reptile', 'Rook', 'Gayal', 'Otter', 'Falcon', 'Heron', 'Ibex'];
const hashSeed = (seed) => { let h = 0; const s = String(seed || ''); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
function fakeNick(seed) { const h = hashSeed(seed); return `${NICK_ADJ[h % NICK_ADJ.length]} ${NICK_ANIMAL[(h >> 5) % NICK_ANIMAL.length]}`; }

function SessionRow({ s }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const geo = [s.city, s.country].filter(Boolean).join(', ');
  const nick = fakeNick(s.visitor);
  return (
    <div className="rounded-xl border border-[var(--line)] overflow-hidden">
      <button onClick={() => setOpen((x) => !x)} className="w-full flex items-center gap-3 p-3 text-left hover:bg-[var(--surface-2)]/50">
        <span className="relative shrink-0">
          <Avatar seed={s.visitor} size={30} />
          {s.country && <span className="absolute -bottom-1 -right-1 rounded-[2px] overflow-hidden ring-1 ring-[var(--bg-solid)]"><Flag cc={s.country} className="w-3.5 h-2.5" /></span>}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          <BrandImg slug={BROWSER_SLUG[s.browser]} size={14} />
          {OS_SLUG[s.os] ? <BrandImg slug={OS_SLUG[s.os]} size={14} fallback={Monitor} /> : <Monitor size={14} className="text-[var(--faint)]" />}
          {s.device === 'mobile' ? <Zap size={13} className="text-[var(--faint)]" /> : null}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm truncate flex items-center gap-1.5">
            <span className="font-medium">{nick}</span>
            <span className="font-mono text-xs text-[var(--faint)] truncate">{s.entry}</span>
            {s.exit !== s.entry && <><ArrowRight size={11} className="text-[var(--faint)] shrink-0" /><span className="font-mono text-xs text-[var(--faint)] truncate">{s.exit}</span></>}
          </div>
          <div className="text-[11px] text-[var(--faint)] truncate">{geo || t('an.unknown', 'Unknown')} · {refHost(s.ref)}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs flex items-center gap-1.5 justify-end">
            {s.live && <span className="inline-flex items-center gap-1 text-emerald-400"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> {t('an.liveLabel', 'live')}</span>}
            <span className="text-[var(--muted)]">{s.pages} {t('an.pg', 'pg')} · {fmtDur(s.durationSec)}</span>
          </div>
          <div className="text-[11px] text-[var(--faint)]">{t('an.ago', '{n} ago').replace('{n}', fmtAgo(s.end))}</div>
        </div>
        <ChevronDown size={15} className={`text-[var(--faint)] transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-[var(--line)] bg-[var(--surface)]/40 px-3 py-2 space-y-1.5">
          {s.events.map((e, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="w-5 text-center text-[10px] text-[var(--faint)] shrink-0">{i + 1}</span>
              <Eye size={12} className="text-[var(--primary-2)] shrink-0" />
              <span className="font-mono text-[var(--muted)] truncate flex-1">{e.path}</span>
              <span className="text-[var(--faint)] shrink-0 tabular-nums">{new Date(e.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
// ISO alpha-2 → the Natural-Earth country name used in world.json, when it differs from
// the Intl.DisplayNames name. Everything else matches the Intl name directly.
const GEO_NAME_ALIAS = {
  US: 'United States', GB: 'United Kingdom', RU: 'Russia', CZ: 'Czech Rep.', KR: 'Korea',
  KP: 'Dem. Rep. Korea', BA: 'Bosnia and Herz.', MK: 'Macedonia', CI: "Côte d'Ivoire",
  SZ: 'Swaziland', CD: 'Dem. Rep. Congo', CG: 'Congo', CF: 'Central African Rep.',
  SS: 'S. Sudan', DO: 'Dominican Rep.', LA: 'Laos', SY: 'Syria', MD: 'Moldova',
  TZ: 'Tanzania', VN: 'Vietnam', BN: 'Brunei', IR: 'Iran', VE: 'Venezuela', BO: 'Bolivia',
  TW: 'Taiwan', EH: 'W. Sahara', AE: 'United Arab Emirates', GN: 'Guinea', TR: 'Turkey',
};
const geoName = (cc) => GEO_NAME_ALIAS[String(cc).toUpperCase()] || countryName(cc);

// Interactive analytics map with a 2D (mercator) / 3D (globe) toggle — same approach as
// the BMM telemetry dashboard: MapLibre GL + a keyless CARTO dark basemap. Renders EITHER
// a country choropleth (`choropleth`=[{cc,count}], shades world.json countries by traffic)
// OR markers (`points`=[{lat,lng,color,size,title,avatarSeed}]; avatarSeed → a Boring-Avatar
// pin). maplibre + world.json are lazy-loaded.
// Small hover-card body shared by the map tooltips: area name, count, share %, and the
// ▲/▼ change vs the previous equal period.
function GeoHoverCard({ info }) {
  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap">
      {info.cc && <Flag cc={info.cc} />}
      <b>{info.label}</b>
      <span className="text-[var(--muted)]">{info.count} · {info.share}%</span>
      {info.delta != null && <span className={info.delta > 0 ? 'text-emerald-400' : info.delta < 0 ? 'text-red-400' : 'text-[var(--faint)]'}>{info.delta > 0 ? '▲' : info.delta < 0 ? '▼' : ''}{Math.abs(info.delta)}%</span>}
    </div>
  );
}

function AnalyticsMap({ points, choropleth, infoByName, height = 420 }) {
  const { t } = useI18n();
  const boxRef = useRef(null);
  const mapRef = useRef(null);
  const mlRef = useRef(null);
  const markersRef = useRef([]);
  const infoRef = useRef({});
  const [mode, setMode] = useState('globe'); // 'globe' | '2d'
  const [ready, setReady] = useState(false);
  const [hover, setHover] = useState(null); // { info, x, y }
  useEffect(() => { infoRef.current = infoByName || {}; }, [infoByName]);
  const ptSig = (points || []).map((p) => `${p.lat},${p.lng},${p.color},${p.avatarSeed || ''}`).join('|');
  const chSig = (choropleth || []).map((c) => `${c.cc}:${c.count}`).join('|');
  const stablePts = useMemo(() => points || [], [ptSig]); // eslint-disable-line
  const empty = choropleth ? (!choropleth.length && !stablePts.length) : !stablePts.length;

  useEffect(() => {
    let disposed = false;
    (async () => {
      let maplibregl, worldGeo = null;
      try {
        const [mod] = await Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')]);
        maplibregl = mod.default;
        if (choropleth) worldGeo = await fetch('/world.json').then((r) => r.json()).catch(() => null);
      } catch { return; }
      if (disposed || !boxRef.current || mapRef.current) return;
      mlRef.current = maplibregl;
      const STYLE = { version: 8, sources: { base: { type: 'raster', tiles: ['https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap © CARTO' } }, layers: [{ id: 'base', type: 'raster', source: 'base' }] };
      const map = new maplibregl.Map({ container: boxRef.current, style: STYLE, center: [10, 25], zoom: 1.3, attributionControl: false, maxPitch: 0, trackResize: true, projection: { type: mode === 'globe' ? 'globe' : 'mercator' } });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
      map.on('error', () => {});
      map.on('load', () => {
        if (disposed) return;
        try { map.setProjection({ type: mode === 'globe' ? 'globe' : 'mercator' }); } catch {}
        if (worldGeo) {
          try {
            map.addSource('countries', { type: 'geojson', data: worldGeo });
            map.addLayer({ id: 'country-fill', type: 'fill', source: 'countries', paint: { 'fill-color': 'rgba(52,211,153,0.06)', 'fill-outline-color': 'rgba(255,255,255,0.18)' } });
            // Hover a country → show its count / share / vs-previous card.
            map.on('mousemove', 'country-fill', (e) => {
              const name = e.features?.[0]?.properties?.name;
              const info = infoRef.current[name];
              if (info) { map.getCanvas().style.cursor = 'default'; setHover({ info, x: e.point.x, y: e.point.y }); }
              else setHover(null);
            });
            map.on('mouseleave', 'country-fill', () => { map.getCanvas().style.cursor = ''; setHover(null); });
          } catch {}
        }
        try { map.resize(); } catch {}
        setReady(true);
      });
    })();
    return () => {
      disposed = true;
      markersRef.current.forEach((m) => { try { m.root?.unmount(); } catch {} try { m.marker.remove(); } catch {} });
      markersRef.current = [];
      try { mapRef.current?.remove(); } catch {} mapRef.current = null;
    };
    // eslint-disable-next-line
  }, []);

  useEffect(() => { const map = mapRef.current; if (map) { try { map.setProjection({ type: mode === 'globe' ? 'globe' : 'mercator' }); } catch {} } }, [mode]);

  // Choropleth: recolour countries by traffic via a `match` expression on the name.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !choropleth || !map.getLayer('country-fill')) return;
    const max = Math.max(1, ...choropleth.map((c) => c.count));
    const seen = new Set(); const expr = ['match', ['get', 'name']];
    for (const c of choropleth) {
      const n = geoName(c.cc);
      if (!n || seen.has(n)) continue; seen.add(n);
      const a = (0.28 + 0.62 * Math.sqrt(c.count / max)).toFixed(3);
      expr.push(n, `rgba(52,211,153,${a})`);
    }
    expr.push('rgba(52,211,153,0.06)'); // subtle green wash on all other land (Rybbit look)
    try { map.setPaintProperty('country-fill', 'fill-color', seen.size ? expr : 'rgba(52,211,153,0.06)'); } catch {}
  }, [chSig, ready]); // eslint-disable-line

  // Markers (sessions): a Boring-Avatar pin when avatarSeed is set, else a coloured dot.
  useEffect(() => {
    const map = mapRef.current, maplibregl = mlRef.current;
    if (!map || !maplibregl || !ready) return; // markers render alongside a choropleth too
    markersRef.current.forEach((m) => { try { m.root?.unmount(); } catch {} try { m.marker.remove(); } catch {} });
    markersRef.current = [];
    for (const p of stablePts) {
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
      const el = document.createElement('div');
      if (p.title) el.title = p.title;
      let root = null;
      if (p.avatarSeed) {
        const sz = p.size || 26;
        el.style.cssText = `width:${sz}px;height:${sz}px;border-radius:50%;overflow:hidden;box-shadow:0 0 0 2px ${p.color || '#fff'},0 1px 6px rgba(0,0,0,.5);cursor:default;`;
        root = createRoot(el);
        root.render(<Avatar seed={p.avatarSeed} size={sz} />);
      } else {
        const sz = p.size || 12, c = p.color || '#f97316';
        el.style.cssText = `width:${sz}px;height:${sz}px;border-radius:50%;background:${c};box-shadow:0 0 8px ${c};border:1.5px solid rgba(255,255,255,.75);cursor:default;`;
      }
      if (p.info) {
        el.addEventListener('mouseenter', () => { try { const pt = map.project([p.lng, p.lat]); setHover({ info: p.info, x: pt.x, y: pt.y }); } catch {} });
        el.addEventListener('mouseleave', () => setHover(null));
      }
      const marker = new maplibregl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map);
      markersRef.current.push({ marker, root });
    }
  }, [ptSig, ready]); // eslint-disable-line

  return (
    <div className="relative">
      <div ref={boxRef} className="w-full rounded-lg overflow-hidden" style={{ height, background: '#05070d' }} />
      <div className="absolute top-2 right-2 z-10 flex rounded-lg border border-[var(--line)] overflow-hidden bg-[var(--bg-solid)]/80 backdrop-blur">
        {[['2d', '2D'], ['globe', '3D']].map(([v, l]) => (
          <button key={v} onClick={() => setMode(v)} className={`px-2.5 py-1 text-xs ${mode === v ? 'bg-[var(--surface-2)] text-[var(--text)] font-medium' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>{l}</button>
        ))}
      </div>
      {hover && <div className="absolute z-20 text-[11px] px-2 py-1 rounded-md bg-[var(--bg-solid)] border border-[var(--line)] shadow pointer-events-none" style={{ left: Math.min(hover.x + 12, (boxRef.current?.clientWidth || 400) - 160), top: hover.y + 12 }}><GeoHoverCard info={hover.info} /></div>}
      {empty && <div className="absolute inset-0 grid place-items-center text-sm text-[var(--faint)] pointer-events-none">{t('an.map.none', 'No geo-located data yet.')}</div>}
    </div>
  );
}

// Aggregated geography map with a Country / Region toggle. Country → choropleth; Region →
// bubbles at each region's average coordinates. Every area's hover card shows its visit
// count, its share of all located traffic, and the change vs the previous equal period.
// Fetches /admin/analytics/geo. Reused by Geography→Map AND Sessions→Globe.
function GeoMap({ days, hours, height = 420 }) {
  const { t } = useI18n();
  const [level, setLevel] = useState('country'); // 'country' | 'region'
  const { data } = useAsync(() => api.get(`/admin/analytics/geo?${hours ? `hours=${hours}` : `days=${days || 30}`}`), [days, hours]);
  const total = data?.total || 0;
  const countries = data?.countries || [];
  const regions = data?.regions || [];
  const shareOf = (n) => total ? Math.round((n / total) * 1000) / 10 : 0;
  const deltaOf = (count, prev) => prev > 0 ? Math.round(((count - prev) / prev) * 100) : (count > 0 ? 100 : null);
  const infoByName = useMemo(() => {
    const m = {};
    for (const c of countries) m[geoName(c.cc)] = { cc: c.cc, label: countryName(c.cc), count: c.count, share: shareOf(c.count), delta: deltaOf(c.count, c.prev) };
    return m;
    // eslint-disable-next-line
  }, [data]);
  const rmax = Math.max(1, ...regions.map((r) => r.count));
  const cmax = Math.max(1, ...countries.map((c) => c.count));
  const regionBubbles = useMemo(() => regions.filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng)).map((r) => ({
    lat: r.lat, lng: r.lng, size: 9 + Math.sqrt(r.count / rmax) * 26, color: 'rgba(52,211,153,.85)',
    info: { cc: r.cc, label: r.region, count: r.count, share: shareOf(r.count), delta: deltaOf(r.count, r.prev) },
  })), [data]); // eslint-disable-line
  // Country bubbles (a labelled dot per country at its avg coords) shown ON TOP of the
  // choropleth, so the data is always visible even where the fill is faint.
  const countryBubbles = useMemo(() => countries.filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng)).map((c) => ({
    lat: c.lat, lng: c.lng, size: 10 + Math.sqrt(c.count / cmax) * 24, color: 'rgba(52,211,153,.9)',
    info: { cc: c.cc, label: countryName(c.cc), count: c.count, share: shareOf(c.count), delta: deltaOf(c.count, c.prev) },
  })), [data]); // eslint-disable-line
  return (
    <div>
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <div className="flex rounded-lg border border-[var(--line)] overflow-hidden text-xs">
          {[['country', t('an.geo.countries', 'Countries'), Globe2], ['region', t('an.geo.regions', 'Regions'), MapPin]].map(([v, label, I]) => (
            <button key={v} onClick={() => setLevel(v)} className={`px-3 py-1.5 flex items-center gap-1.5 ${level === v ? 'bg-[var(--surface-2)] text-[var(--text)] font-medium' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}><I size={12} /> {label}</button>
          ))}
        </div>
        <span className="text-[11px] text-[var(--faint)]">{t('an.geo.hint', 'Hover an area for its share of traffic + change vs the previous period.')}</span>
      </div>
      {level === 'country'
        ? <AnalyticsMap choropleth={countries} points={countryBubbles} infoByName={infoByName} height={height} />
        : <AnalyticsMap points={regionBubbles} height={height} />}
    </div>
  );
}

function SessionsPanel({ days, hours }) {
  const { t } = useI18n();
  const [data, setData] = useState(null);
  const [collapsed, setCollapsed] = useState(false);
  const [view, setView] = useState('list'); // 'list' | 'globe'
  const load = () => api.get('/admin/analytics/sessions?limit=40').then(setData).catch(() => setData({ sessions: [], liveCount: 0 }));
  useEffect(() => { load(); const id = setInterval(load, 15_000); return () => clearInterval(id); }, []);
  const sessions = data?.sessions || [];
  return (
    <Card className="p-5 mb-4">
      <button onClick={() => setCollapsed((x) => !x)} className="w-full flex items-center gap-2 mb-1 text-left">
        <Activity size={15} className="text-[var(--primary-2)]" />
        <h2 className="font-semibold flex-1 flex items-center gap-2">{t('an.sess.title', 'Sessions')}
          {data?.liveCount > 0 && <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400"><span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> {data.liveCount} {t('an.liveLabel', 'live')}</span>}
        </h2>
        <span className="text-[11px] text-[var(--faint)] mr-1">{t('an.sess.autorefresh', 'auto-refresh 15s')}</span>
        <ChevronDown size={16} className={`text-[var(--faint)] transition-transform ${collapsed ? '-rotate-90' : ''}`} />
      </button>
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <p className="text-sm text-[var(--muted)]">{view === 'globe' ? t('an.sess.descGlobe2', 'Visitors aggregated by country/region — count, share of traffic, and change vs the previous period.') : t('an.sess.descList', 'Recent visitor sessions — click one to see its page-by-page journey. Live = active in the last 5 minutes.')}</p>
        <div className="flex rounded-lg border border-[var(--line)] overflow-hidden shrink-0">
          {[['list', t('an.sess.list', 'List'), LayoutDashboard], ['globe', t('an.sess.globe', 'Globe'), Globe2]].map(([v, label, I]) => (
            <button key={v} onClick={() => setView(v)} className={`px-3 py-1 text-xs flex items-center gap-1.5 ${view === v ? 'bg-[var(--surface-2)] text-[var(--text)] font-medium' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}><I size={12} /> {label}</button>
          ))}
        </div>
      </div>
      {!collapsed && (!data ? <div className="h-20 grid place-items-center"><Spinner /></div>
        : view === 'globe' ? <GeoMap days={days} hours={hours} height={460} />
        : sessions.length ? <div className="space-y-2 max-h-[520px] overflow-auto pr-1">{sessions.map((s) => <SessionRow key={s.visitor + s.start} s={s} />)}</div>
        : <div className="text-sm text-[var(--faint)] py-6 text-center">{t('an.sess.none', 'No sessions yet — needs visitors who accepted analytics cookies.')}</div>)}
    </Card>
  );
}

function AdminAnalytics() {
  const [days, setDays] = useState(30);
  const [hours, setHours] = useState(null); // when set → hourly view (zoom-in)
  const [tab, setTab] = useState('overview'); // sub-tab: overview | sessions | geo | tech | perf
  const toast = useToast();
  const { t } = useI18n();
  const { data, loading } = useAsync(() => api.get(`/admin/analytics?${hours ? `hours=${hours}` : `days=${days}`}`), [days, hours]);
  // Open BMM telemetry via an SSO handoff: mint a short-lived token (this call is
  // admin-gated + 2FA-enforced) and hand it to the telemetry dashboard, so the
  // dashboard is reachable ONLY through an authenticated BCWEB admin.
  const openTelemetry = async () => {
    try { const { url } = await api.post('/admin/telemetry/token', {}); window.open(url, '_blank', 'noopener'); }
    catch (x) { toast.error(x.data?.error === 'no_telemetry_access' ? t('an.telemetry.noperm', 'You need the "telemetry" permission (Access & permissions) to open it.') : t('an.telemetry.err', 'Could not open telemetry — an admin account with 2FA is required.')); }
  };
  const gran = data?.granularity || (hours ? 'hour' : 'day');
  // Ctrl+wheel on the chart: zoom in → hourly (24h); zoom out → back to daily.
  const onZoom = (dir) => { if (dir === 'in') setHours(24); else setHours(null); };
  const top = data?.top || [], refs = data?.refs || [], series = data?.series || [];
  const devices = data?.devices || [], browsers = data?.browsers || [], oses = data?.oses || [], flows = data?.flows || [], countries = data?.countries || [];
  const regions = data?.regions || [], cities = data?.cities || [];
  // Per-bucket arrays for the KPI-card background sparklines.
  const viewsSpark = series.map((s) => s.count);
  const visitorsSpark = series.map((s) => s.visitors || 0);
  const ppsSpark = series.map((s) => (s.visitors ? +(s.count / s.visitors).toFixed(2) : 0));
  const maxTop = Math.max(1, ...top.map((t) => t.count));
  const maxRef = Math.max(1, ...refs.map((r) => r.count));
  const maxSeries = Math.max(1, ...series.map((s) => s.count));
  const maxFlow = Math.max(1, ...flows.map((f) => f.count));
  const ranges = [['24h', '24h'], [7, t('an.range.7d', '7 days')], [30, t('an.range.30d', '30 days')], [90, t('an.range.90d', '90 days')]];
  const activeRange = hours ? '24h' : days;
  const pickRange = (v) => { if (v === '24h') setHours(24); else { setHours(null); setDays(v); } };
  // Period-over-period delta chip (▲/▼ %); for bounce rate a DROP is good (lowerBetter).
  const deltaChip = (cur, prev, lowerBetter) => {
    if (prev == null || cur == null || Number(prev) === 0) return null;
    const pct = Math.round(((cur - prev) / prev) * 100);
    if (pct === 0) return <span className="text-[10px] text-[var(--faint)]">0%</span>;
    const up = pct > 0, good = lowerBetter ? !up : up;
    return <span className={`text-[10px] font-semibold tabular-nums ${good ? 'text-emerald-400' : 'text-red-400'}`} title={t('an.vsprev', 'vs previous period')}>{up ? '▲' : '▼'} {Math.abs(pct)}%</span>;
  };
  const kpi = (Icon, val, label, accent, delta, spark, sparkColor) => (
    <Card className="p-4 relative overflow-hidden">
      {spark && spark.length > 1 && <Sparkline data={spark} stroke={sparkColor || 'var(--primary)'} className="absolute inset-x-0 bottom-0 h-9 w-full opacity-70 pointer-events-none" />}
      <div className="relative">
        <div className="flex items-center justify-between gap-1"><Icon size={16} className={accent || 'text-[var(--primary-2)]'} />{delta}</div>
        <div className="text-2xl font-bold mt-2">{val}</div>
        <div className="text-[11px] text-[var(--muted)]">{label}</div>
      </div>
    </Card>
  );
  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="font-semibold flex items-center gap-2"><TrendingUp size={16} /> {t('an.title', 'Site analytics')}
          {data?.live > 0 && <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400 ml-1"><span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> {data.live} {t('an.live', 'live')}</span>}</h2>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-[var(--line)] overflow-hidden">
            {ranges.map(([d, l]) => <button key={d} onClick={() => pickRange(d)} className={`px-3 py-1.5 text-xs ${activeRange === d ? 'bg-[var(--surface-2)] text-[var(--text)] font-medium' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>{l}</button>)}
          </div>
          <Button size="sm" onClick={openTelemetry}><Gauge size={14} /> {t('an.telemetry', 'BMM telemetry')}</Button>
        </div>
      </div>

      {/* KPI row (Rybbit-style) — always visible above the sub-tabs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 sm:gap-3 mb-4">
        {kpi(Users, data?.uniqueVisitors ?? '—', t('an.kpi.visitors', 'Unique visitors'), null, deltaChip(data?.uniqueVisitors, data?.prev?.uniqueVisitors), visitorsSpark, '#38bdf8')}
        {kpi(Package, data?.sessions ?? '—', t('an.kpi.sessions', 'Sessions'), null, deltaChip(data?.sessions, data?.prev?.sessions), visitorsSpark, '#38bdf8')}
        {kpi(Eye, data?.windowed ?? '—', t('an.kpi.pageviews', 'Pageviews'), null, deltaChip(data?.windowed, data?.prev?.pageviews), viewsSpark)}
        {kpi(TrendingUp, data?.viewsPerVisitor ?? '—', t('an.kpi.pps', 'Pages / session'), null, deltaChip(data?.viewsPerVisitor, data?.prev?.viewsPerVisitor), ppsSpark)}
        {kpi(ArrowUpRight, data?.bounceRate != null ? `${data.bounceRate}%` : '—', t('an.kpi.bounce', 'Bounce rate'), null, deltaChip(data?.bounceRate, data?.prev?.bounceRate, true), viewsSpark, '#f59e0b')}
        {kpi(Zap, data?.live ?? '—', t('an.kpi.live', 'Live (30 min)'), 'text-emerald-400')}
      </div>

      {/* Sub-tab bar — horizontal-scrolls on narrow screens so it never overflows. */}
      <div className="flex gap-1 mb-4 border-b border-[var(--line)] overflow-x-auto no-scrollbar -mx-1 px-1">
        {[['overview', t('an.tab.overview', 'Overview'), TrendingUp], ['sessions', t('an.tab.sessions', 'Sessions'), Activity], ['geo', t('an.tab.geo', 'Geography'), Globe2], ['tech', t('an.tab.tech', 'Tech'), Monitor], ['perf', t('an.tab.perf', 'Performance'), Gauge]].map(([id, label, I]) => (
          <button key={id} onClick={() => setTab(id)} className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition ${tab === id ? 'border-[var(--primary)] text-[var(--text)]' : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'}`}><I size={14} /> {label}</button>
        ))}
      </div>

      {tab === 'overview' && <>
        <Card className="p-4 sm:p-5 mb-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="text-xs font-semibold text-[var(--faint)] uppercase">{gran === 'hour' ? t('an.traffic.hour', 'Traffic per hour · last 24h') : t('an.traffic.day', 'Traffic per day')}</div>
            <div className="flex items-center gap-3 text-[11px] text-[var(--muted)]">
              <span className="hidden sm:flex items-center gap-1 text-[var(--faint)]"><Search size={11} /> {t('an.zoomhint', 'Ctrl + scroll to zoom')}</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-gradient-to-t from-orange-500 to-amber-400" /> {t('an.views', 'Views')}</span><span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-sky-400" /> {t('an.visitors', 'Visitors')}</span></div>
          </div>
          {loading ? <div className="h-40 grid place-items-center text-[var(--faint)] text-sm"><Spinner /></div> : <TrafficChart series={series} gran={gran} onZoom={onZoom} compare={data?.compare} />}
        </Card>
        <div className="grid md:grid-cols-2 gap-4">
          <Card className="p-4 sm:p-5">
            <div className="text-xs font-semibold text-[var(--faint)] uppercase mb-3">{t('an.toppages', 'Top pages')}</div>
            <div className="space-y-2.5">
              {top.length ? top.map((tp) => (
                <div key={tp.path} className="flex items-center gap-3 text-sm">
                  <span className="text-[var(--muted)] truncate w-28 sm:w-40 shrink-0">{tp.path}</span>
                  <div className="flex-1 h-2 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className="h-full bg-gradient-to-r from-orange-500 to-amber-500" style={{ width: `${(tp.count / maxTop) * 100}%` }} /></div>
                  <span className="w-10 text-right font-medium">{tp.count}</span>
                </div>
              )) : <div className="text-sm text-[var(--faint)]">{t('an.nopages', 'No page data yet.')}</div>}
            </div>
          </Card>
          <Card className="p-4 sm:p-5">
            <div className="text-xs font-semibold text-[var(--faint)] uppercase mb-3">{t('an.toprefs', 'Top referrers')}</div>
            <div className="space-y-2.5">
              {refs.length ? refs.map((r) => { const host = refHost(r.ref); return (
                <div key={r.ref} className="flex items-center gap-3 text-sm">
                  <span className="text-[var(--muted)] truncate w-28 sm:w-40 shrink-0 flex items-center gap-2"><BrandImg favicon={/\.[a-z]{2,}$/i.test(host) ? `https://icons.duckduckgo.com/ip3/${host}.ico` : null} /> {host}</span>
                  <div className="flex-1 h-2 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className="h-full bg-gradient-to-r from-sky-500 to-cyan-400" style={{ width: `${(r.count / maxRef) * 100}%` }} /></div>
                  <span className="w-10 text-right font-medium">{r.count}</span>
                </div>); })
                : <div className="text-sm text-[var(--faint)]">{t('an.norefs', 'No referrers yet — most visits are direct.')}</div>}
            </div>
          </Card>
        </div>
      </>}

      {tab === 'sessions' && <SessionsPanel days={days} hours={hours} />}

      {tab === 'geo' && (
        <div className="grid lg:grid-cols-[1.2fr_1.4fr] gap-4">
          <GeoPanel countries={countries} regions={regions} cities={cities} days={days} hours={hours} />
          <Card className="p-4 sm:p-5">
            <div className="text-xs font-semibold text-[var(--faint)] uppercase mb-3 flex items-center gap-1.5"><ArrowRight size={13} /> {t('an.funnel', 'Funnel · page journeys')}</div>
            <Sankey flows={flows} />
          </Card>
        </div>
      )}

      {tab === 'tech' && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Breakdown title={t('an.devices', 'Devices')} rows={devices} iconOf={(l) => { const I = { mobile: Zap, tablet: Package, desktop: Server }[l] || Server; return <I size={13} className="text-[var(--faint)]" />; }} />
          <Breakdown title={t('an.browsers', 'Browsers')} rows={browsers} iconOf={(l) => <BrandImg slug={BROWSER_SLUG[l]} />} />
          <Breakdown title={t('an.os', 'Operating systems')} rows={oses} iconOf={(l) => (OS_SLUG[l] ? <BrandImg slug={OS_SLUG[l]} fallback={Monitor} /> : <Monitor size={13} className="text-[var(--faint)] shrink-0" />)} />
        </div>
      )}

      {tab === 'perf' && <WebVitals days={days} hours={hours} />}

      <p className="text-[11px] text-[var(--faint)] mt-4">{t('an.geonote', 'Geo is resolved from the visitor IP (CDN country header, else an offline GeoIP lookup; local/private IPs get a sample location in dev). The privacy-friendly daily-rotating visitor hash can\'t track people across days.')}</p>
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
          <Field label="Title"><Input value={value.announceTitle} onChange={(e) => set('announceTitle')(e.target.value)} placeholder="Something big is coming…" /></Field>
          <Field label="Logo URL (optional)"><Input value={value.announceLogo || ''} onChange={(e) => set('announceLogo')(e.target.value)} placeholder="https://example.com/logo.png" /></Field>
          <Field label="Markdown description"><Textarea rows={4} value={value.announceMarkdown} onChange={(e) => set('announceMarkdown')(e.target.value)} placeholder="Tell people what's coming — markdown supported." /></Field>
          {/* Optional CTA — points anywhere: an external URL, or an in-site
              /blog/<slug> or /docs/<slug> article. */}
          <div className="grid grid-cols-[130px_1fr] gap-2">
            <Field label="Button label"><Input value={value.announceButtonLabel || ''} onChange={(e) => set('announceButtonLabel')(e.target.value)} placeholder="Learn more" /></Field>
            <Field label="Button link (URL, or /blog/… /docs/…)"><Input value={value.announceButtonUrl || ''} onChange={(e) => set('announceButtonUrl')(e.target.value)} placeholder="/docs/roadmap" /></Field>
          </div>
          <Field label="Reveal at"><Input type="datetime-local" value={value.announceRevealAt || ''} onChange={(e) => set('announceRevealAt')(e.target.value)} /></Field>
          <label className="flex items-center gap-2 text-sm cursor-pointer pt-1"><input type="checkbox" checked={!!value.announceShowPage} onChange={(e) => set('announceShowPage')(e.target.checked)} /> Show the page behind the countdown (adds it as a first tab instead of hiding everything)</label>
          <p className="text-[11px] text-[var(--faint)]">
            {value.announceShowPage
              ? 'The real page stays reachable; the countdown appears as its own first tab. Normal visibility rules apply.'
              : 'Only the countdown is shown until it ends — the rest of the page is hidden from everyone. Visibility takes effect once it\'s over.'}
            {' '}Tip: to <b>swap in new content the moment the countdown ends</b>, use “Schedule an update” with the same date/time — a countdown can trigger an update, and an update can carry a countdown.
          </p>
        </div>
      )}
    </div>
  );
}

// Stage a future content swap: pick a date/time, edit the "next" JSON (+ name/
// short for showcase pages), and it swaps in automatically once due — no admin
// action needed at reveal time. `putSchedule` is the save callback (varies by
// fixed-vs-showcase endpoint); `current` seeds the editor with today's live values.
// A recent server alert — click to expand its full detail (kind, what it means,
// the complete message, and the exact + relative time). The stored alert is just
// { kind, message, createdAt }, so "detail" = the human-readable expansion of that.
// i18n keys per alert kind — resolved in AlertRow (a module const can't call the hook).
const ALERT_KIND = {
  cpu: { l: 'sp.al.cpu', lf: 'High CPU', d: 'sp.al.cpu.d', df: 'CPU usage crossed the alert threshold (>90%).', tone: 'text-amber-400' },
  mem: { l: 'sp.al.mem', lf: 'High memory', d: 'sp.al.mem.d', df: 'Memory usage crossed the alert threshold (>90%).', tone: 'text-amber-400' },
  disk: { l: 'sp.al.disk', lf: 'Low disk', d: 'sp.al.disk.d', df: 'Disk usage crossed the alert threshold (>90%).', tone: 'text-red-400' },
  service_down: { l: 'sp.al.svc', lf: 'Service unreachable', d: 'sp.al.svc.d', df: 'A dependency (DB, storage, bot, Stripe…) failed its health check.', tone: 'text-red-400' },
};
function AlertRow({ a }) {
  const { t } = useI18n(); const toast = useToast();
  const [open, setOpen] = useState(false);
  const k = ALERT_KIND[a.kind];
  const info = k ? { label: t(k.l, k.lf), desc: t(k.d, k.df), tone: k.tone } : { label: a.kind, desc: t('sp.al.generic', 'Threshold alert.'), tone: 'text-red-400' };
  const when = new Date(a.createdAt);
  const ago = (() => { const s = Math.max(0, (Date.now() - when.getTime()) / 1000); if (s < 60) return t('sp.ago.now', 'just now'); if (s < 3600) return t('sp.ago.m', '{n}m ago').replace('{n}', Math.floor(s / 60)); if (s < 86400) return t('sp.ago.h', '{n}h ago').replace('{n}', Math.floor(s / 3600)); return t('sp.ago.d', '{n}d ago').replace('{n}', Math.floor(s / 86400)); })();
  const copy = (e) => { e.stopPropagation(); navigator.clipboard?.writeText(`[${a.kind}] ${a.message} — ${when.toLocaleString()}`); toast.success(t('common.copied', 'Copied.')); };
  return (
    <Card className="p-0 overflow-hidden">
      <button onClick={() => setOpen((v) => !v)} className="w-full p-3 flex items-center gap-3 text-left hover:bg-[var(--surface-2)] transition">
        <AlertTriangle size={15} className={`${info.tone} shrink-0`} />
        <Badge tone={info.tone.includes('red') ? 'red' : 'amber'} className="shrink-0">{info.label}</Badge>
        <span className="flex-1 min-w-0 text-[var(--muted)] truncate">{a.message}</span>
        {a.count > 1 && <Badge className="shrink-0 tabular-nums">×{a.count}</Badge>}
        <button onClick={copy} className="text-[var(--faint)] hover:text-[var(--primary-2)] shrink-0" title={t('common.copy', 'Copy')}><Copy size={13} /></button>
        <span className="text-[11px] text-[var(--faint)] shrink-0 tabular-nums">{ago}</span>
        <ChevronDown size={14} className={`text-[var(--faint)] shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-[var(--line)] text-sm space-y-1.5">
          <div className="text-[var(--muted)]">{info.desc}</div>
          <div className="rounded-lg bg-[var(--surface-2)] border border-[var(--line)] p-2.5 font-mono text-xs text-[var(--text)] whitespace-pre-wrap break-words">{a.message}</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--faint)]">
            <span>{t('sp.al.kindlbl', 'Kind:')} <code className="text-[var(--muted)]">{a.kind}</code></span>
            {a.count > 1
              ? <><span>{t('sp.al.occ', 'Occurrences:')} <b className="text-[var(--muted)]">{a.count}</b></span><span>{t('sp.al.lastlbl', 'Last:')} {when.toLocaleString()}</span>{a.firstAt && <span>{t('sp.al.firstlbl', 'First:')} {new Date(a.firstAt).toLocaleString()}</span>}</>
              : <span>{t('sp.al.whenlbl', 'When:')} {when.toLocaleString()}</span>}
            <span>{ago}</span>
          </div>
        </div>
      )}
    </Card>
  );
}

function ScheduleUpdateModal({ title, current, includeNameShort, existing, onClose, onSave, slug, isShowcase }) {
  const toast = useToast(); const { t } = useI18n();
  const [at, setAt] = useState(existing?.scheduledAt ? new Date(existing.scheduledAt).toISOString().slice(0, 16) : '');
  const [name, setName] = useState(existing?.scheduledNext?.name ?? current.name ?? '');
  const [short, setShort] = useState(existing?.scheduledNext?.short ?? current.short ?? '');
  const [configText, setConfigText] = useState(JSON.stringify(existing?.scheduledNext?.config ?? current.config ?? {}, null, 2));
  const [editMode, setEditMode] = useState('form'); // 'form' (visual) | 'json'
  const [busy, setBusy] = useState(false);
  const hasExisting = !!existing?.scheduledAt;
  let cfgValid = true; try { JSON.parse(configText || '{}'); } catch { cfgValid = false; }
  const save = async () => {
    if (!at) return toast.error(t('su.pickdate', 'Pick a date/time.'));
    let config; try { config = JSON.parse(configText || '{}'); } catch { return toast.error(t('su.cfginvalid', 'Config JSON is invalid.')); }
    const next = includeNameShort ? { name: name.trim(), short: short.trim(), config } : { config };
    setBusy(true);
    try { await onSave(new Date(at).toISOString(), next); toast.success(t('su.scheduled', 'Update scheduled.')); onClose(); }
    catch { toast.error(t('common.failed', 'Failed.')); } finally { setBusy(false); }
  };
  const cancelSchedule = async () => {
    setBusy(true);
    try { await onSave(null, null); toast.success(t('su.cancelled', 'Schedule cancelled.')); onClose(); }
    catch { toast.error(t('common.failed', 'Failed.')); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={title} icon={Clock} width="max-w-lg"
      footer={<>
        {hasExisting && <Button variant="ghost" className="!text-red-400" disabled={busy} onClick={cancelSchedule}>{t('su.cancelsched', 'Cancel schedule')}</Button>}
        <Button variant="ghost" onClick={onClose}>{t('su.close', 'Close')}</Button>
        <Button variant="primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : t('su.schedule', 'Schedule')}</Button>
      </>}>
      <p className="text-sm text-[var(--muted)] mb-3">{t('su.desc', 'Stage new content below — it automatically replaces the current version at the date/time you pick. Nothing changes until then.')}</p>
      <Field label={t('su.switchat', 'Switch at')}><Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></Field>
      {includeNameShort && (
        <div className="grid grid-cols-[1fr_110px] gap-3 mt-3">
          <Field label={t('su.newname', 'New name')}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label={t('su.newshort', 'New short (≤5)')}><Input value={short} maxLength={5} onChange={(e) => setShort(e.target.value)} /></Field>
        </div>
      )}
      <div className="mt-3">
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] block">{t('su.newconfig', 'New config')}</label>
          <div className="inline-flex rounded-lg border border-[var(--line)] p-0.5 text-xs">
            {[['form', t('su.visual', 'Visual')], ['json', 'JSON']].map(([m, label]) => (
              <button key={m} type="button" onClick={() => setEditMode(m)} disabled={m === 'form' && !cfgValid}
                className={`px-2.5 py-1 rounded-md ${editMode === m ? 'bg-[var(--surface-2)] text-[var(--text)]' : 'text-[var(--muted)]'} ${m === 'form' && !cfgValid ? 'opacity-40 cursor-not-allowed' : ''}`}>{label}</button>
            ))}
          </div>
        </div>
        {editMode === 'form'
          ? (cfgValid
              ? <div className="rounded-xl border border-[var(--line)] p-3 max-h-[46vh] overflow-auto bg-[var(--bg-solid)]">
                  <ProjectConfigEditor value={JSON.parse(configText || '{}')} onChange={(cfg) => setConfigText(JSON.stringify(cfg, null, 2))} slug={slug} isShowcase={isShowcase} />
                </div>
              : <div className="text-sm text-[var(--muted)] p-3">{t('su.invalidjsontab', 'Invalid JSON — switch to the JSON tab to fix it.')}</div>)
          : <JsonEditor value={configText} onChange={setConfigText} minH={220} />}
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
  const toast = useToast(); const dialog = useDialog(); const { t } = useI18n();
  const { data, loading, reload } = useAsync(() => api.get('/admin/showcase'), []);
  const [editing, setEditing] = useState(null); // project object or 'new'
  const [scheduling, setScheduling] = useState(null); // project object
  const projects = data?.projects || [];
  const del = async (pr) => { if (!(await dialog.confirm({ title: t('sh.del.t', 'Delete project'), message: t('sh.del.m', 'Delete "{name}"?').replace('{name}', pr.name), okLabel: t('sh.del.ok', 'Delete'), danger: true }))) return; try { await api.del(`/admin/showcase/${pr.id}`); toast.success(t('common.deleted', 'Deleted.')); reload(); } catch { toast.error(t('common.failed', 'Failed.')); } };
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold flex items-center gap-2"><Sparkles size={16} className="text-[var(--primary-2)]" /> {t('sh.title', 'Other projects')}</h2>
        <Button size="sm" variant="primary" onClick={() => setEditing('new')}><Plus size={14} /> {t('sh.new', 'New project')}</Button>
      </div>
      <p className="text-sm text-[var(--muted)] mb-4">{t('sh.sub', 'Feature any project on the public /projects page. Overview is always shown; enable Release notes, Community and Legal per project.')}</p>
      {loading ? <Loading /> : projects.length ? <div className="space-y-2">
        {projects.map((pr) => {
          const announcing = pr.announceEnabled && pr.announceRevealAt && new Date(pr.announceRevealAt) > new Date();
          return (
          <Card key={pr.id} className="p-4 flex items-center gap-3 flex-wrap">
            {pr.icon
              ? <div className="grid place-items-center w-10 h-10 rounded-lg bg-[var(--surface-2)] border border-[var(--line)] shrink-0 text-[var(--primary-2)]"><ShowcaseIcon icon={pr.icon} size={24} rounded={6} /></div>
              : <div className="grid place-items-center w-10 h-10 rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 text-white font-extrabold text-xs shrink-0">{pr.short}</div>}
            <div className="flex-1 min-w-0"><div className="font-medium truncate">{pr.name} <span className="text-xs text-[var(--faint)] font-normal">/project/{pr.slug}</span></div>
              <div className="text-xs text-[var(--faint)] flex items-center gap-1.5 flex-wrap">
                {[pr.config?.tabs?.releases && 'releases', pr.config?.tabs?.community && 'community', pr.config?.tabs?.legal && 'legal'].filter(Boolean).join(' · ') || t('sh.overviewonly', 'overview only')}
                {pr.pinTopbar && <span className="inline-flex items-center gap-0.5 text-[var(--primary-2)]"><Rss size={10} /> topbar</span>}
                {pr.visibility && pr.visibility !== 'public' && <span className="inline-flex items-center gap-0.5"><EyeOff size={10} /> {pr.visibility}</span>}
              </div></div>
            <Badge tone={pr.published ? 'green' : ''}>{pr.published ? t('sh.published', 'published') : t('sh.hidden', 'hidden')}</Badge>
            {announcing && <Badge tone="primary"><Megaphone size={10} /> {t('sh.countdown', 'counting down')}</Badge>}
            {pr.scheduledAt && <Badge tone="primary"><Clock size={10} /> {t('sh.update', 'update')} {new Date(pr.scheduledAt).toLocaleDateString()}</Badge>}
            <Button size="sm" variant="ghost" onClick={() => setScheduling(pr)} title={t('sh.schedtip', 'Schedule an update')}><Clock size={14} /></Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(pr)}><PenSquare size={14} /> {t('sh.editbtn', 'Edit')}</Button>
            <a href={`/project/${pr.slug}`} target="_blank" rel="noreferrer"><Button size="sm" variant="ghost"><ArrowUpRight size={14} /></Button></a>
            <Button size="sm" variant="ghost" onClick={() => del(pr)}><Trash2 size={14} /></Button>
          </Card>
          );
        })}
      </div> : <EmptyState icon={Sparkles} title={t('sh.empty', 'No projects yet')} sub={t('sh.emptysub', 'Add your first featured project.')} />}
      {editing && <ShowcaseEditModal project={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={reload} />}
      {scheduling && (
        <ScheduleUpdateModal title={t('sh.schedmodal', 'Schedule an update — {name}').replace('{name}', scheduling.name)} includeNameShort existing={scheduling}
          slug={scheduling.slug} isShowcase
          current={{ name: scheduling.name, short: scheduling.short, config: scheduling.config }}
          onClose={() => setScheduling(null)}
          onSave={async (at, next) => { await api.put(`/admin/showcase/${scheduling.id}/schedule`, { at, next }); reload(); }} />
      )}
    </div>
  );
}

function ShowcaseEditModal({ project, onClose, onDone }) {
  const toast = useToast(); const { t } = useI18n();
  const isNew = !project;
  const cfg0 = project?.config || {};
  const [name, setName] = useState(project?.name || '');
  const [short, setShort] = useState(project?.short || '');
  const [icon, setIcon] = useState(project?.icon || '');
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
    announceShowPage: project?.announceShowPage ?? false,
    announceButtonLabel: project?.announceButtonLabel ?? '',
    announceButtonUrl: project?.announceButtonUrl ?? '',
  });
  const [iconPick, setIconPick] = useState(false);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (name.trim().length < 2) return toast.error(t('sh.e.namereq', 'Name is required.'));
    if (!short.trim()) return toast.error(t('sh.e.shortreq', 'Short name is required.'));
    let extra = {}; try { extra = JSON.parse(details || '{}'); } catch { return toast.error(t('sh.e.jsoninvalid', 'Details JSON is invalid.')); }
    if (announce.announceEnabled && !announce.announceRevealAt) return toast.error(t('sh.e.revealreq', 'Set a reveal date/time for the announcement.'));
    const config = { ...extra, tabs, tagline };
    const payload = {
      name: name.trim(), short: short.trim(), icon: icon.trim() || null, published, config, pinTopbar, visibility, visibilityWhitelist: whitelist,
      ...announce, announceRevealAt: announce.announceEnabled && announce.announceRevealAt ? new Date(announce.announceRevealAt).toISOString() : null,
    };
    setBusy(true);
    try {
      if (isNew) await api.post('/admin/showcase', payload);
      else await api.put(`/admin/showcase/${project.id}`, payload);
      toast.success(t('common.saved', 'Saved.')); onClose(); onDone();
    } catch (x) { toast.error(x.data?.error || t('common.savefail', 'Save failed.')); } finally { setBusy(false); }
  };
  const Toggle = ({ k, label }) => <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={tabs[k]} onChange={(e) => setTabs({ ...tabs, [k]: e.target.checked })} /> {label}</label>;
  return (
    <Modal open onClose={onClose} title={isNew ? t('sh.new', 'New project') : t('sh.e.edit', 'Edit {name}').replace('{name}', project.name)} icon={Sparkles} width="max-w-lg"
      footer={<><Button variant="ghost" onClick={onClose}>{t('su.cancel', 'Cancel')}</Button><Button variant="primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : t('common.save', 'Save')}</Button></>}>
      <div className="grid grid-cols-[1fr_110px] gap-3">
        <Field label={t('sh.e.pname', 'Project name')}><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Better Something" /></Field>
        <Field label={t('sh.e.pshort', 'Short (≤5)')}><Input value={short} maxLength={5} onChange={(e) => setShort(e.target.value)} placeholder="BS" /></Field>
      </div>
      <div className="mt-3"><Field label={t('sh.e.tagline', 'Tagline')}><Input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder={t('sh.e.taglineph', 'One-line description')} /></Field></div>
      <div className="mt-3"><Field label={t('sh.e.logo', 'Logo / icon')} hint={t('sh.e.logohint', 'Topbar pill + page header + blog-thumbnail fallback. Pick a lucide/brand icon, upload an svg/png, or paste a logo URL.')}>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="w-10 h-10 rounded-lg border border-[var(--line)] shrink-0 grid place-items-center bg-[var(--surface-2)] text-[var(--primary-2)]">
            <ShowcaseIcon icon={icon} size={26} rounded={6} fallback={<Sparkles size={18} className="text-[var(--faint)]" />} />
          </div>
          <Input className="flex-1 min-w-[140px]" value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="lucide name, simple:github, or https://…/logo.png" />
          <Button type="button" size="sm" onClick={() => setIconPick(true)}>{t('sh.e.pick', 'Pick')}</Button>
          <Button type="button" size="sm" onClick={() => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*,.svg'; i.onchange = async () => { const f = i.files?.[0]; if (!f) return; try { toast.info(t('sh.e.uploading', 'Uploading…')); setIcon(await uploadImage(f)); } catch { toast.error(t('sh.e.uploadfail', 'Upload failed.')); } }; i.click(); }}>{t('sh.e.upload', 'Upload')}</Button>
          {icon && <Button type="button" size="sm" variant="ghost" onClick={() => setIcon('')}>{t('sh.e.clear', 'Clear')}</Button>}
        </div>
      </Field></div>
      {iconPick && <IconPicker title={t('sh.e.pickicon', 'Pick a project icon')} onPick={(n) => setIcon(n)} onClose={() => setIconPick(false)} />}
      <div className="mt-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-1.5">{t('sh.e.subtabs', 'Sub-tabs')}</div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 p-3 rounded-lg bg-[var(--surface-2)] border border-[var(--line)]">
          <label className="flex items-center gap-2 text-sm text-[var(--muted)]"><input type="checkbox" checked disabled /> {t('sh.e.overview', 'Overview (always)')}</label>
          <Toggle k="releases" label={t('sh.e.releases', 'Release notes')} />
          <Toggle k="community" label={t('sh.e.community', 'Community')} />
          <Toggle k="legal" label={t('sh.e.legal', 'Legal')} />
        </div>
      </div>
      <div className="mt-3">
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)]">{t('sh.e.details', 'Details (JSON)')}</label>
          <button type="button" onClick={() => setDetails(JSON.stringify(SHOWCASE_TEMPLATE, null, 2))} className="btn btn-sm"><Wand2 size={13} /> {t('sh.e.template', 'Template')}</button>
        </div>
        <p className="text-[11px] text-[var(--faint)] mb-1.5">{t('sh.e.detailshint', 'links (github/source/discord/kofi/website/custom), downloads[], overview media (image/video/replayUrl/rrwebUrl), progressSource, releaseNotes, community, legal cards.')}</p>
        <JsonEditor value={details} onChange={setDetails} minH={220} />
      </div>
      <label className="flex items-center gap-2 text-sm mt-3 cursor-pointer"><input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} /> {t('sh.e.published', 'Published (visible on /projects)')}</label>
      <label className="flex items-center gap-2 text-sm mt-2 cursor-pointer"><input type="checkbox" checked={pinTopbar} onChange={(e) => setPinTopbar(e.target.checked)} /> <Rss size={13} className="text-[var(--primary-2)]" /> {t('sh.e.pin', 'Pin as its own topbar pill (not just the /projects grid)')}</label>
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
  { title: 'Capacity', gk: 'capacity', icon: HardDrive, keys: [
    ['hosting.totalCapacityGB', 'Total capacity (GB)', 'The overall ceiling for everything hosting draws against — checked against the real disk on save.', 'number'],
    ['hosting.reservedFreeGB', 'Reserved free margin (GB)', 'Always kept free below Total capacity, as a safety buffer.', 'number'],
    ['hosting.tempMarginGB', 'Temp margin for submissions (GB)', 'Separate pool for catalog submissions awaiting moderation — full = new uploads refused until reviewed.', 'number'],
    ['hosting.freeTierCapEnabled', 'Cap the free hosting-plan pool', 'When on, the Free hosting plan goes "sold out" once free repos together reach the cap below — paid plans never count against this.', 'bool'],
    ['hosting.freeTierCapGB', 'Free hosting-plan pool cap (GB)', 'Total storage the Free plan can ever occupy across every user, once the toggle above is on.', 'number'],
    ['catalog.freeTierCapEnabled', 'Cap the free catalog-upload pool', 'When on, free catalog file hosting goes "sold out" once free uploads together reach the cap below — paid uploads never count against this.', 'bool'],
    ['catalog.freeTierCapMB', 'Free catalog-upload pool cap (MB)', 'Total payload bytes the free catalog tier can ever occupy across every user, once the toggle above is on.', 'number'],
    ['telemetry.storageLimitGB', 'BMM telemetry storage limit (GB)', 'How much storage the (separate) BMM telemetry database is allowed — shown as used vs. allocated in Total capacity above. 0 = untracked.', 'number'],
    ['hosting.maxUploadMbps', 'Max upload per repo (Mbps)', 'Hard ceiling on the upload bandwidth a single repo can request (custom plans + upgrades). Scarcity may lower it further as capacity fills. Default 1000.', 'number'],
    ['hosting.burstFactor', 'Bandwidth burst factor', 'Smart sharing: while the server is quiet, a repo download may burst to its cap × this factor, borrowing idle capacity. Tightens back to the cap under load. 1 = no bursting. Default 4.', 'number'],
    ['hosting.burstUntilActive', 'Burst until N active transfers', 'Bursting is allowed only while fewer than this many downloads are in flight at once; beyond it, each repo is held to its own cap. Default 3.', 'number'],
  ] },
  { title: 'Blog, docs & history', gk: 'blog', icon: Newspaper, keys: [
    ['blog.maxTotalPosts', 'Max total blog articles', 'Hard cap on the number of blog articles across the whole site. 0 = unlimited. New articles are refused once reached.', 'number'],
    ['blog.maxTotalKB', 'Max total blog size (KB)', 'Hard cap on the combined size of every article body (EN + FR). Enforced on create AND on edits that grow a post. 0 = unlimited.', 'number'],
    ['docs.maxTotalPages', 'Max total doc pages', 'Hard cap on the number of documentation pages. 0 = unlimited. New pages are refused once reached.', 'number'],
    ['docs.maxTotalKB', 'Max total docs size (KB)', 'Hard cap on the combined size of every doc page (EN + FR). Enforced on create AND on edits that grow a page. 0 = unlimited.', 'number'],
    ['history.maxRevisions', 'Edit-history: keep last N revisions', 'How many past snapshots each blog post / doc page keeps before the oldest is overwritten. Default 30.', 'number'],
    ['history.maxRevisionKB', 'Edit-history: max size per item (KB)', 'Also cap each item\'s stored history by size — older snapshots drop once this is exceeded. 0 = size limit off (count only).', 'number'],
  ] },
  { title: 'Security & audit logs', gk: 'security', icon: ShieldCheck, keys: [
    ['audit.maxDays', 'Audit log retention (days)', 'Staff-action log entries older than this are pruned. 0 = keep forever. The log is HMAC-chained (tamper-evident) — pruning is the only sanctioned deletion.', 'number'],
    ['audit.maxEntries', 'Audit log max entries', 'Also cap the staff-action log by entry count — the oldest are pruned past this. 0 = no count cap.', 'number'],
  ] },
  { title: 'Pricing', gk: 'pricing', icon: Receipt, keys: [
    ['pricing.perGBCents', 'Price per GB (¢ / month)', 'Base hosting cost, before the scarcity multiplier. Only applies above the free floor below.', 'number'],
    ['pricing.hostingFreeGB', 'Free hosting floor', 'Every repo\'s first N of storage cost nothing — small personal repos are free. Only the excess is billed.', 'gbmb', 'GB'],
    ['pricing.perUploadMbpsCents', 'Price per Mbps (¢ / month)', 'Cost per Mbps of upload bandwidth allotted to a repo.', 'number'],
    ['pricing.featurePerDayCents', 'Feature (boost) price / day (¢)', 'Cost to keep a repo featured on the public listing.', 'number'],
    ['pricing.catalogHostPerMBCents', 'Catalog file hosting (¢ / MB / month)', 'Charged to non-staff submitters for our-hosted payloads above the free floor below.', 'number'],
    ['pricing.catalogFreeMB', 'Free catalog upload floor', 'Every submission\'s (app/plugin/theme/preset) first N are free — only the excess is billed.', 'gbmb', 'MB'],
  ] },
  { title: 'Feature flags', gk: 'features', icon: Sliders, keys: [
    ['features.hostingEnabled', 'Hosting enabled', 'Turns the whole Server-Repo hosting feature off site-wide when unchecked.', 'bool'],
  ] },
];

// One-line description shown under each settings-group header panel.
const GROUP_DESC = {
  'Capacity': 'Storage ceilings, free-tier pools, telemetry & per-repo CPU/upload limits.',
  'Blog, docs & history': 'Article/page count & size caps, and edit-history retention.',
  'Security & audit logs': 'How long the tamper-evident staff action log is kept.',
  'Pricing': 'What customers pay — per GB, Mbps, CPU, boost & catalog hosting.',
  'Feature flags': 'Master on/off switches.',
};

// GB<->MB conversion for the free-floor unit toggle — the stored setting value
// always stays in its native unit (GB for hostingFreeGB, MB for catalogFreeMB);
// only the on-screen number changes when the admin picks a different unit.
const convertUnit = (value, fromUnit, toUnit) => fromUnit === toUnit ? Number(value) : (fromUnit === 'GB' ? Number(value) * 1024 : Number(value) / 1024);

// Live BMM telemetry config — proxies the telemetry service's own admin API, so
// changes here are APPLIED to the running telemetry service (config.json, no .env
// edit / restart), unlike the display-only telemetry.storageLimitGB setting.
function TelemetryConfigCard() {
  const { t } = useI18n(); const toast = useToast();
  const { data, loading, reload } = useAsync(() => api.get('/admin/telemetry/config').catch((x) => ({ available: false, error: x?.data?.error || 'telemetry_unreachable' })), []);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data?.config) setF({ storageGB: String(Math.round((data.config.storageLimitMb / 1024) * 100) / 100), retentionDays: String(data.config.retentionDays), deleteDelayH: String(data.config.deleteDelayH) }); }, [data]);
  if (loading) return null;
  if (data && data.available === false) {
    const notcfg = data.error === 'telemetry_not_configured';
    return (
      <Card className="p-4 mb-3">
        <div className="text-sm font-medium flex items-center gap-2 mb-1"><Gauge size={15} className="text-sky-400" /> {t('tc.title', 'BMM telemetry (live)')}</div>
        <div className="text-xs text-amber-400/90">{notcfg ? t('tc.notcfg', 'Set TELEMETRY_INTERNAL_URL + TELEMETRY_ADMIN_KEY in the api service env to manage telemetry limits from here.') : t('tc.unreach', 'Telemetry service unreachable right now.')}</div>
      </Card>
    );
  }
  if (!f) return null;
  const usedGB = (data.used_bytes || 0) / (1024 ** 3);
  const limitGB = Number(f.storageGB) || 0;
  const pct = limitGB > 0 ? Math.min(100, (usedGB / limitGB) * 100) : 0;
  const save = async () => {
    setBusy(true);
    try {
      await api.put('/admin/telemetry/config', { storageLimitMb: Math.round(Number(f.storageGB) * 1024), retentionDays: Number(f.retentionDays), deleteDelayH: Number(f.deleteDelayH) });
      toast.success(t('tc.saved', 'Applied to the telemetry service.')); reload();
    } catch { toast.error(t('tc.savefail', 'Could not update telemetry.')); } finally { setBusy(false); }
  };
  return (
    <Card className="p-4 mb-3">
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <div className="text-sm font-medium flex items-center gap-2"><Gauge size={15} className="text-sky-400" /> {t('tc.title', 'BMM telemetry (live)')}</div>
        <Button size="sm" variant="primary" disabled={busy} onClick={save}>{busy ? <Spinner /> : <><CheckCheck size={14} /> {t('tc.apply', 'Apply to telemetry')}</>}</Button>
      </div>
      <p className="text-[11px] text-[var(--faint)] mb-3">{t('tc.sub', 'Edits the telemetry service directly (storage cap, GDPR retention, erase delay) — applied live, no restart. Over-limit data is trimmed immediately on save.')}</p>
      <div className="mb-3">
        <div className="flex items-center justify-between text-xs mb-1"><span className="text-[var(--muted)]">{t('tc.used', 'Used')}</span><span className="tabular-nums font-medium">{usedGB.toFixed(2)}{limitGB > 0 ? ` / ${limitGB} GB` : ` ${t('hs.gbused', 'GB used')}`}</span></div>
        {limitGB > 0 && <div className="h-2 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className={`h-full ${pct > 90 ? 'bg-red-500' : 'bg-sky-500'}`} style={{ width: `${pct}%` }} /></div>}
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <Field label={t('tc.storage', 'Storage cap (GB)')} hint={t('tc.storage.h', 'Oldest events trimmed when exceeded.')}><Input type="number" min="0.125" step="0.5" value={f.storageGB} onChange={(e) => setF({ ...f, storageGB: e.target.value })} /></Field>
        <Field label={t('tc.retention', 'Retention (days)')} hint={t('tc.retention.h', 'Raw events auto-deleted after this.')}><Input type="number" min="1" max="3650" value={f.retentionDays} onChange={(e) => setF({ ...f, retentionDays: e.target.value })} /></Field>
        <Field label={t('tc.delay', 'Erase delay (h)')} hint={t('tc.delay.h', 'Review window before an erasure request auto-applies.')}><Input type="number" min="0" max="720" value={f.deleteDelayH} onChange={(e) => setF({ ...f, deleteDelayH: e.target.value })} /></Field>
      </div>
    </Card>
  );
}

function AdminSettings() {
  const toast = useToast();
  const { t } = useI18n();
  const { data, reload } = useAsync(() => api.get('/admin/settings'), []);
  const cap = useAsync(() => api.get('/hosting/capacity'), []);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(null);
  const [unit, setUnit] = useState({}); // settingKey -> 'MB' | 'GB' (display unit only)
  useEffect(() => { if (data?.settings) setDraft(data.settings); }, [data]);
  const coerce = (v, kind) => kind === 'bool' ? !!v : (v !== '' && !isNaN(Number(v)) ? Number(v) : v);
  const save = async (key, kind) => {
    setBusy(key);
    try { await api.put(`/admin/settings/${key}`, { value: coerce(draft[key], kind) }); toast.success(t('hs.saved', 'Saved.')); reload(); cap.reload?.(); }
    catch (x) { toast.error(x.data?.error === 'exceeds_disk' ? t('hs.exceedsdisk', `Exceeds the real disk capacity (${x.data.diskGB} GB max).`).replace('{n}', x.data.diskGB) : t('hs.savefail', 'Save failed.')); }
    finally { setBusy(null); }
  };
  // "Save all changes" — edit several settings (CPU / storage / upload …) and save them
  // in one click, instead of one Save button per field.
  const KIND_OF = {}; SETTINGS_GROUPS.forEach((g) => g.keys.forEach(([k, , , kind]) => { KIND_OF[k] = kind === 'gbmb' ? 'number' : kind; }));
  const dirtyKeys = Object.keys(KIND_OF).filter((k) => {
    const kind = KIND_OF[k];
    const cur = coerce(draft[k] ?? (kind === 'bool' ? false : ''), kind);
    const saved = data?.settings?.[k] ?? (kind === 'bool' ? false : '');
    return JSON.stringify(cur) !== JSON.stringify(saved);
  });
  const saveAll = async () => {
    setBusy('__all__');
    try {
      for (const k of dirtyKeys) await api.put(`/admin/settings/${k}`, { value: coerce(draft[k], KIND_OF[k]) });
      toast.success(t('hs.savecount', `Saved ${dirtyKeys.length} changes.`).replace('{n}', dirtyKeys.length)); reload(); cap.reload?.();
    } catch (x) { toast.error(x.data?.error === 'exceeds_disk' ? t('hs.exceedsdisk', `Exceeds the real disk capacity (${x.data.diskGB} GB max).`).replace('{n}', x.data.diskGB) : t('hs.savepartial', 'Some changes failed to save.')); }
    finally { setBusy(null); }
  };
  const c = cap.data?.capacity;
  const tempPct = c?.tempMarginGB ? Math.min(100, (c.tempUsedGB / c.tempMarginGB) * 100) : 0;
  return (
    <div className="mt-10">
      {/* Plain header — consistent with every other admin panel (Events, Campaigns…).
          The "Save all" pill still floats to a sticky dock at the bottom-right when
          there are unsaved edits, so pinning the header isn't needed. */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="font-semibold flex items-center gap-2"><Settings2 size={16} className="text-[var(--primary-2)]" /> {t('hs.title', 'Hosting settings')}</h2>
      </div>
      {dirtyKeys.length > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 anim-slide">
          <Button variant="primary" disabled={busy === '__all__'} onClick={saveAll} className="shadow-lg">{busy === '__all__' ? <Spinner /> : <><CheckCheck size={15} /> {t('hs.saveall', 'Save all')} ({dirtyKeys.length})</>}</Button>
        </div>
      )}
      {/* At-a-glance stacked bar of the WHOLE Total capacity — where every GB goes
          (hosting quotas, approved submissions, temp margin, reserved, free) plus the
          separately-tracked free-plan pool. */}
      {c && (() => {
        const total = c.totalGB || 0;
        const seg = (gb, color, label) => ({ gb: Math.max(0, Number(gb) || 0), color, label });
        const segs = [
          seg(c.hostingAllocatedGB, 'var(--primary)', t('hs.seg.hosting', 'Hosting quotas')),
          seg(c.submissionsPublishedGB, '#8b5cf6', t('hs.seg.subs', 'Approved submissions')),
          seg(c.tempUsedGB, '#f59e0b', t('hs.seg.tempuse', 'Temp (in use)')),
          seg((c.tempMarginGB || 0) - (c.tempUsedGB || 0), 'rgba(245,158,11,0.35)', t('hs.seg.tempres', 'Temp (reserved)')),
          seg(c.reservedGB, 'var(--faint)', t('hs.seg.reserved', 'Reserved margin')),
        ];
        const used = segs.reduce((a, s) => a + s.gb, 0);
        const all = [...segs, seg(Math.max(0, total - used), 'var(--surface-2)', t('hs.seg.free', 'Free'))];
        return (
          <Card className="p-4 mb-3">
            <div className="flex items-center justify-between text-sm mb-2 flex-wrap gap-2">
              <span className="flex items-center gap-2 font-medium"><HardDrive size={15} className="text-[var(--primary-2)]" /> {t('hs.totalcap', 'Total capacity')}</span>
              <span className="text-xs text-[var(--muted)] tabular-nums">{t('hs.capused', '{used} / {total} GB used · {free} GB free').replace('{used}', used.toFixed(1)).replace('{total}', total).replace('{free}', Math.max(0, total - used).toFixed(1))}</span>
            </div>
            <div className="flex h-3.5 rounded-full overflow-hidden bg-[var(--surface-2)] border border-[var(--line)]">
              {total > 0 && all.map((s, i) => s.gb > 0.001 && <div key={i} title={`${s.label}: ${s.gb.toFixed(2)} GB`} style={{ width: `${(s.gb / total) * 100}%`, background: s.color }} />)}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5 text-[11px]">
              {all.filter((s) => s.gb > 0.001).map((s, i) => (
                <span key={i} className="flex items-center gap-1.5 text-[var(--muted)]"><span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: s.color }} /> {s.label} <b className="text-[var(--text)] tabular-nums">{s.gb.toFixed(1)}G</b></span>
              ))}
            </div>
            {c.diskFreeGB != null && <div className="text-[11px] text-[var(--faint)] mt-1.5">{t('hs.realdisk', 'Real disk:')} <b className="text-[var(--text)]">{t('hs.gbfree', '{n} GB free').replace('{n}', c.diskFreeGB.toFixed(0))}</b> / {t('hs.gbtotal', '{n} GB total').replace('{n}', c.diskTotalGB?.toFixed(0))}.</div>}
            {c.freeTierCapEnabled && c.freeTierCapGB > 0 && (
              <div className="mt-3 pt-3 border-t border-[var(--line)]">
                <div className="flex items-center justify-between text-xs mb-1"><span className="text-[var(--muted)] flex items-center gap-1.5"><Gift size={12} className="text-emerald-400" /> {t('hs.freepool', 'Free-plan pool (separate)')}</span><span className="tabular-nums font-medium">{(c.freeTierUsedGB || 0).toFixed(1)} / {c.freeTierCapGB} GB</span></div>
                <div className="h-2 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, ((c.freeTierUsedGB || 0) / c.freeTierCapGB) * 100)}%` }} /></div>
              </div>
            )}
            {/* BMM telemetry storage — used vs. the admin-set allocation (separate DB). */}
            {c.telemetryUsedGB != null && (() => {
              const alloc = c.telemetryLimitGB || 0;
              const pct = alloc > 0 ? Math.min(100, (c.telemetryUsedGB / alloc) * 100) : 0;
              return (
                <div className="mt-3 pt-3 border-t border-[var(--line)]">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-[var(--muted)] flex items-center gap-1.5"><Gauge size={12} className="text-sky-400" /> {t('hs.telestore', 'BMM telemetry storage')} {alloc > 0 ? '' : <span className="text-[var(--faint)]">{t('hs.nolimit', '(no limit set)')}</span>}</span>
                    <span className="tabular-nums font-medium">{c.telemetryUsedGB.toFixed(2)}{alloc > 0 ? ` / ${alloc} GB` : ` ${t('hs.gbused', 'GB used')}`}</span>
                  </div>
                  {alloc > 0 && <div className="h-2 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className={`h-full ${pct > 90 ? 'bg-red-500' : 'bg-sky-500'}`} style={{ width: `${pct}%` }} /></div>}
                </div>
              );
            })()}
          </Card>
        );
      })()}
      <TelemetryConfigCard />
      {/* Temp submissions margin — live usage. Uploads (.bmmplugin / .bmmtheme / app
          payloads) are refused once this is full, until moderation clears space. */}
      {c && (
        <Card className="p-4 mb-3">
          <div className="flex items-center justify-between text-sm mb-1.5">
            <span className="flex items-center gap-2 text-[var(--muted)]"><Upload size={14} className="text-[var(--primary-2)]" /> {t('hs.tempstore', 'Temp storage (submissions)')}</span>
            <span className="font-semibold tabular-nums">{(c.tempUsedGB ?? 0).toFixed(2)} / {c.tempMarginGB ?? 0} GB</span>
          </div>
          <div className="h-2 rounded-full bg-[var(--surface-2)] overflow-hidden"><div className={`h-full ${tempPct > 90 ? 'bg-red-500' : 'bg-gradient-to-r from-orange-500 to-amber-400'}`} style={{ width: `${tempPct}%` }} /></div>
          <div className="text-[11px] text-[var(--faint)] mt-1.5">{t('hs.tempnote', 'Submitted files (.bmmplugin, .bmmtheme, app payloads) live here until moderation. When full, new submission uploads are refused.')}</div>
        </Card>
      )}
      <div className="space-y-5">
        {SETTINGS_GROUPS.map((g) => (
          <div key={g.title} className="rounded-2xl border border-[var(--line)] overflow-hidden" style={{ boxShadow: 'var(--shadow)' }}>
            <div className="flex items-center gap-2.5 px-4 py-3 bg-[var(--surface-2)]/40 border-b border-[var(--line)]">
              <span className="grid place-items-center w-8 h-8 rounded-lg bg-[var(--primary)]/10 border border-[var(--primary)]/20 shrink-0"><g.icon size={15} className="text-[var(--primary-2)]" /></span>
              <div className="min-w-0"><div className="text-sm font-semibold">{t(`hs.g.${g.gk}`, g.title)}</div>{GROUP_DESC[g.title] && <div className="text-[11px] text-[var(--faint)] truncate">{t(`hs.gd.${g.gk}`, GROUP_DESC[g.title])}</div>}</div>
            </div>
            <div className="p-3 grid md:grid-cols-2 gap-3">
              {g.keys.map(([k, label, desc, kind, nativeUnit]) => {
                const L = t(`hs.l.${k}`, label);
                const D = t(`hs.d.${k}`, desc);
                const saveLabel = t('hs.save', 'Save');
                return (
                <Card key={k} className="p-4">
                  {kind === 'bool' ? (
                    <div className="flex items-center justify-between gap-3">
                      <label className="flex items-center gap-2.5 text-sm cursor-pointer flex-1"><input type="checkbox" checked={draft[k] !== false && draft[k] !== 'false' && !!draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.checked })} /> <span className="font-medium">{L}</span></label>
                      <Button size="sm" disabled={busy === k} onClick={() => save(k, kind)}>{busy === k ? <Spinner /> : saveLabel}</Button>
                    </div>
                  ) : kind === 'gbmb' ? (() => {
                    const curUnit = unit[k] || nativeUnit;
                    const displayValue = draft[k] !== '' && draft[k] != null ? convertUnit(Number(draft[k]), nativeUnit, curUnit) : '';
                    return (
                      <div className="flex items-end gap-2">
                        <div className="flex-1"><Field label={L}><Input type="number" value={displayValue} onChange={(e) => setDraft({ ...draft, [k]: e.target.value === '' ? '' : convertUnit(Number(e.target.value), curUnit, nativeUnit) })} /></Field></div>
                        <Select className="!w-auto !py-2.5" value={curUnit} onChange={(e) => setUnit({ ...unit, [k]: e.target.value })}><option value="MB">MB</option><option value="GB">GB</option></Select>
                        <Button size="sm" disabled={busy === k} onClick={() => save(k, 'number')}>{busy === k ? <Spinner /> : saveLabel}</Button>
                      </div>
                    );
                  })() : (
                    <div className="flex items-end gap-3">
                      <div className="flex-1"><Field label={L}><Input type="number" value={draft[k] ?? ''} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} /></Field></div>
                      <Button size="sm" disabled={busy === k} onClick={() => save(k, kind)}>{busy === k ? <Spinner /> : saveLabel}</Button>
                    </div>
                  )}
                  <div className="text-[11px] text-[var(--faint)] mt-1.5">{D}</div>
                  {k === 'hosting.totalCapacityGB' && c?.diskTotalGB != null && <div className="text-[11px] text-amber-400/90 mt-1">{t('hs.realdiskcap', "Real disk: {free} GB free / {total} GB total — can't be set above this.").replace('{free}', c.diskFreeGB.toFixed(0)).replace('{total}', c.diskTotalGB.toFixed(0))}</div>}
                </Card>
                );
              })}
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
          {t('set.privacy.more', 'Read more in the')} <Link to="/legal/cookies" className="text-[var(--primary-2)] hover:underline">{t('nav.cookies', 'Cookie Policy')}</Link> {t('set.and', 'and')} <Link to="/legal/privacy" className="text-[var(--primary-2)] hover:underline">{t('nav.privacy', 'Privacy Policy')}</Link>.
        </div>
      </Card>
    </div>
  );
}

/* ─────────────────────────  Contact  ───────────────────────── */
// Email-confirmation landing page (the link in the confirmation email → /verify-email?token=).
export function VerifyEmail() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [state, setState] = useState('working'); // working | ok | error
  useEffect(() => {
    if (!token) { setState('error'); return; }
    api.post('/auth/verify-email', { token }).then(() => setState('ok')).catch(() => setState('error'));
  }, [token]);
  // One card shell for every state — a bare centered message would sit over the orb backdrop.
  return (
    <div className="max-w-md mx-auto py-12">
      <Card className="p-8 text-center">
        {state === 'working' && <div className="grid place-items-center text-[var(--muted)] py-2"><Spinner /><p className="mt-3">{t('verify.working', 'Confirming your email…')}</p></div>}
        {state === 'ok' && <>
          <span className="grid place-items-center w-12 h-12 rounded-2xl bg-[var(--success-bg)] border border-[var(--success-border)] mx-auto mb-4"><CheckCircle2 size={24} className="text-[var(--success)]" /></span>
          <h1 className="text-xl font-semibold mb-1">{t('verify.ok.title', 'Email confirmed')}</h1>
          <p className="text-[var(--muted)] mb-5">{t('verify.ok.sub', 'Your email address is verified — thanks!')}</p>
          <Link to="/dashboard"><Button variant="primary">{t('verify.ok.cta', 'Go to dashboard')}</Button></Link>
        </>}
        {state === 'error' && <>
          <span className="grid place-items-center w-12 h-12 rounded-2xl bg-[var(--error-bg)] border border-[var(--error-border)] mx-auto mb-4"><XCircle size={24} className="text-[var(--error)]" /></span>
          <h1 className="text-xl font-semibold mb-1">{t('verify.err.title', 'Link invalid or expired')}</h1>
          <p className="text-[var(--muted)] mb-5">{t('verify.err.sub', 'This confirmation link is no longer valid. You can request a new one from your profile.')}</p>
          <Link to="/profile"><Button>{t('nav.profile', 'Profile')}</Button></Link>
        </>}
      </Card>
    </div>
  );
}

// OAuth/OIDC consent screen (the /authorize SPA route). The API's /oauth2/authorize
// redirects here with a signed ?rt= token once the user is logged in; we show the
// client + scopes and POST the decision (full-page, so the browser follows the 302
// back to the requesting app).
export function Authorize() {
  const { t } = useI18n();
  const { user, loading: authLoading } = useAuth();
  const [params] = useSearchParams();
  const rt = params.get('rt') || '';
  const [info, setInfo] = useState(null);
  useEffect(() => {
    if (!rt) { setInfo({ error: 'no_request' }); return; }
    api.get(`/oauth2/consent-info?rt=${encodeURIComponent(rt)}`).then(setInfo).catch(() => setInfo({ error: 'invalid' }));
  }, [rt]);
  const SCOPE_META = {
    openid: [ShieldCheck, t('oauth.scope.openid', 'Confirm your identity'), t('oauth.scope.openid.s', 'Verify who you are')],
    profile: [Users, t('oauth.scope.profile', 'Your profile'), t('oauth.scope.profile.s', 'Display name & avatar')],
    email: [Mail, t('oauth.scope.email', 'Your email address'), t('oauth.scope.email.s', 'To identify & contact you')],
    items: [Package, t('oauth.scope.items', 'Your catalog items'), t('oauth.scope.items.s', 'Read your items & submissions')],
    repos: [Server, t('oauth.scope.repos', 'Your Server-Repos'), t('oauth.scope.repos.s', 'Read the hosted repos you own')],
  };
  // Loading / signed-out / error all use the same card shell as the consent screen —
  // a bare centered message would sit over the orb backdrop and lose legibility.
  if (authLoading || (user && !info)) return (
    <div className="max-w-md mx-auto py-12"><Card className="p-10"><div className="grid place-items-center text-[var(--muted)]"><Spinner /></div></Card></div>
  );
  if (!user) return (
    <div className="max-w-md mx-auto py-12">
      <Card className="p-7 text-center">
        <span className="grid place-items-center w-12 h-12 rounded-2xl bg-[var(--surface-2)] border border-[var(--line)] mx-auto mb-4"><Shield size={22} className="text-[var(--primary-2)]" /></span>
        <p className="text-[var(--muted)] mb-4">{t('oauth.needlogin', 'Please sign in to continue.')}</p>
        <Button variant="primary" onClick={() => { window.location.href = `/auth?next=${encodeURIComponent('/authorize?rt=' + rt)}`; }}>{t('nav.login', 'Sign in')}</Button>
      </Card>
    </div>
  );
  if (info?.error) return (
    <div className="max-w-md mx-auto py-12">
      <Card className="p-7 text-center">
        <span className="grid place-items-center w-12 h-12 rounded-2xl bg-[var(--error-bg)] border border-[var(--error-border)] mx-auto mb-4"><Shield size={22} className="text-[var(--error)]" /></span>
        <p className="text-sm text-[var(--muted)]">{t('oauth.err', 'This authorization request is invalid or expired — please start again from the app.')}</p>
      </Card>
    </div>
  );
  return (
    <div className="max-w-md mx-auto py-12">
      <Card className="p-7">
        <div className="flex items-center gap-3.5 mb-6">
          <span className="grid place-items-center w-12 h-12 rounded-2xl bg-gradient-to-br from-orange-500 to-amber-500 text-white text-xl font-bold shrink-0 shadow-lg shadow-orange-500/25">{(info.clientName || '?').charAt(0).toUpperCase()}</span>
          <div className="min-w-0">
            <div className="font-bold text-[17px] leading-tight truncate">{info.clientName}</div>
            <div className="text-sm text-[var(--muted)]">{t('oauth.wants', 'wants to access your BetterCommunity account')}</div>
          </div>
        </div>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] mb-2">{t('oauth.willaccess', 'It will be able to access')}</div>
        <ul className="rounded-xl border border-[var(--line)] divide-y divide-[var(--line)] mb-4 overflow-hidden">
          {(info.scopes || []).map((s) => { const [I, label, sub] = SCOPE_META[s] || [CheckCircle2, s, '']; return (
            <li key={s} className="flex items-center gap-3 px-3.5 py-2.5">
              <span className="grid place-items-center w-8 h-8 rounded-lg bg-[var(--surface-2)] text-[var(--primary-2)] shrink-0"><I size={16} /></span>
              <div className="min-w-0"><div className="text-sm font-medium leading-tight">{label}</div>{sub && <div className="text-xs text-[var(--muted)] truncate">{sub}</div>}</div>
              <CheckCircle2 size={16} className="text-emerald-400 ml-auto shrink-0" />
            </li>
          ); })}
        </ul>
        <p className="text-xs text-[var(--muted)] mb-5 flex items-start gap-1.5"><Lock size={13} className="mt-0.5 shrink-0 text-[var(--faint)]" /> {t('oauth.readonly', "Read-only access — it can't change your password, spend money, or post as you.")}</p>
        <form method="post" action="/oauth2/authorize/decision" className="flex gap-3">
          <input type="hidden" name="request_token" value={rt} />
          <button type="submit" name="decision" value="deny" className="btn flex-1">{t('oauth.deny', 'Deny')}</button>
          <button type="submit" name="decision" value="approve" className="btn btn-primary flex-1">{t('oauth.allow', 'Allow')}</button>
        </form>
        <p className="text-[11px] text-[var(--faint)] mt-3.5 text-center">{t('oauth.signedin', 'Signed in as {name}').replace('{name}', user.displayName || user.email || '')}</p>
      </Card>
    </div>
  );
}

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
  // Prefill the body from a ?topic= (e.g. the Enterprise hosting "Contact us" button).
  const [params] = useSearchParams();
  useEffect(() => {
    if (params.get('topic') === 'enterprise-hosting') {
      const tmpl = fr
        ? "Bonjour, je souhaite un plan d'hébergement sur mesure (entreprise).\nMes besoins :\n- Stockage :\n- Bande passante / upload :\n- Ressources dédiées / SLA :\n- Autre :"
        : 'Hi, I\'d like a custom (enterprise) hosting plan.\nMy needs:\n- Storage:\n- Bandwidth / upload:\n- Dedicated resources / SLA:\n- Other:';
      setMsg((m) => ({ ...m, body: m.body || tmpl }));
    }
  }, [params, fr]);
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
      ['Analytics we run', 'With your cookie consent we collect privacy-friendly, first-party, anonymous page analytics on THIS website (the page path, referrer, and a coarse device/browser type). It is aggregated to understand how the site is used — no third-party trackers, no advertising, no cross-site profiling, and no attempt to identify you personally. You can decline at any time and declining loses no functionality.'],
      ['Content & files you host (Server-Repos)', 'When you host a Server-Repo or upload catalog files, we store those files as a neutral hosting provider so we can serve them for you. We do not inspect their contents beyond the moderation review and the automated integrity checks (SHA / per-file checksums) needed to run the platform, and we do not mine, sell, or repurpose them. If YOU place personal data inside your repo/files, you are the data controller for that data: you must have a lawful basis to store and distribute it, and you must not upload other people’s personal data without their consent or another legal basis. We process it only on your instructions, as your processor, to host and deliver it.'],
      ['Hosting & payments', 'If you purchase Server-Repo hosting, payment is processed by Stripe; we never see your card details. We store your subscription status, the timestamp at which you accepted these policies at checkout, and repo metadata.'],
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
      ['Data & content you host', 'You are solely responsible for everything you upload, host, or distribute through the service, including its legality and any personal data it contains. You warrant that you have the right to store and share it and that it complies with all applicable laws (including data-protection and copyright law). We act only as a neutral hosting/storage provider and, where your content contains personal data, as your data processor acting on your instructions — you remain the data controller. We do not back up your hosted data for you; keep your own copy. You agree to indemnify and hold us harmless from any third-party claim, loss, or liability arising out of the content or data you host.'],
      ['Downloads & use of software and content — at your own risk', 'BetterCommunity lets you download and use the Better* applications (such as BMM, BSM and BetterInstaller) and community-submitted content (mods, plugins, themes, presets and hosted Server-Repos). All of it is provided “as is”, with no warranty of fitness, safety, compatibility or result. You download, install and use it entirely at your own risk. To the maximum extent permitted by law we accept no responsibility for any consequence of downloading or using anything obtained through the platform — including damage to your device, operating system or other software, loss or corruption of files, game or save-file corruption, incompatibility, or any suspension, ban, or penalty imposed on you by a third-party game, storefront, service, or publisher. Verify what you install and keep your own backups.'],
      ['Third-party content & no endorsement', 'Community content is created and published by its authors, not by us. Our moderation and automated integrity checks aim to catch obvious abuse and malware, but they are not a guarantee of safety, quality, legality, or suitability, and listing or hosting content is never an endorsement of it. You alone are responsible for complying with the terms, licences, and rules of any third-party game, platform, mod loader, or software you use this content with — some modifications may breach those third parties’ own terms, and any resulting consequence (including account bans on those services) is yours alone.'],
      ['Accepting these terms', 'You must accept these Terms and the Payments & Refunds policy before you can pay for any hosting or feature. We record the date and time of your acceptance. If we materially change these terms, a new acceptance may be required before your next purchase.'],
      ['Payments', 'Hosting and listing features are billed via Stripe. Prices are shown before you confirm and may change with notice; a change never affects a period already paid for. No refunds for partial periods unless required by law — see the Payments & Refunds policy for the full detail.'],
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
      ['Les statistiques que nous faisons', 'Avec ton accord cookies, nous collectons sur CE site des statistiques de pages internes, anonymes et respectueuses de la vie privée (chemin de page, référent, type d’appareil/navigateur approximatif). Elles sont agrégées pour comprendre l’usage du site — aucun pisteur tiers, aucune publicité, aucun profilage inter-sites, et aucune tentative de t’identifier personnellement. Tu peux refuser à tout moment sans perte de fonctionnalité.'],
      ['Contenu & fichiers que tu héberges (Server-Repos)', 'Quand tu héberges un Server-Repo ou envoies des fichiers de catalogue, nous stockons ces fichiers en tant qu’hébergeur neutre afin de les servir pour toi. Nous n’inspectons pas leur contenu au-delà de la revue de modération et des contrôles d’intégrité automatiques (SHA / checksums par fichier) nécessaires au fonctionnement de la plateforme, et nous ne les exploitons, vendons ni réutilisons jamais. Si TU places des données personnelles dans ton dépôt/tes fichiers, tu en es le responsable de traitement : tu dois disposer d’une base légale pour les stocker et les distribuer, et tu ne dois pas envoyer les données personnelles d’autrui sans leur consentement ou une autre base légale. Nous ne les traitons que sur tes instructions, en tant que sous-traitant, pour les héberger et les diffuser.'],
      ['Hébergement & paiements', 'Si tu paies un hébergement de Server-Repo, le paiement est traité par Stripe ; nous ne voyons jamais ta carte. Nous stockons l’état de ton abonnement, l’horodatage de ton acceptation de ces politiques au paiement, et les métadonnées du dépôt.'],
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
      ['Données & contenu que tu héberges', 'Tu es seul responsable de tout ce que tu envoies, héberges ou distribues via le service, y compris sa légalité et les données personnelles qu’il contient. Tu garantis avoir le droit de le stocker et le partager, et sa conformité à toutes les lois applicables (protection des données et droit d’auteur inclus). Nous agissons uniquement comme hébergeur/stockage neutre et, lorsque ton contenu contient des données personnelles, comme ton sous-traitant agissant sur tes instructions — tu restes le responsable de traitement. Nous ne sauvegardons pas tes données hébergées à ta place ; garde ta propre copie. Tu acceptes de nous garantir et de nous tenir indemnes de toute réclamation, perte ou responsabilité d’un tiers découlant du contenu ou des données que tu héberges.'],
      ['Téléchargements & usage des logiciels et contenus — à tes risques', 'BetterCommunity te permet de télécharger et d’utiliser les applications Better* (comme BMM, BSM et BetterInstaller) et le contenu soumis par la communauté (mods, plugins, thèmes, presets et Server-Repos hébergés). Tout cela est fourni « tel quel », sans aucune garantie d’adéquation, de sécurité, de compatibilité ou de résultat. Tu le télécharges, l’installes et l’utilises entièrement à tes propres risques. Dans la limite permise par la loi, nous n’assumons aucune responsabilité pour les conséquences du téléchargement ou de l’utilisation de quoi que ce soit obtenu via la plateforme — y compris dommages à ton appareil, ton système d’exploitation ou tes autres logiciels, perte ou corruption de fichiers, corruption de jeu ou de sauvegardes, incompatibilité, ou toute suspension, tout bannissement ou toute sanction infligés par un jeu, une boutique, un service ou un éditeur tiers. Vérifie ce que tu installes et garde tes propres sauvegardes.'],
      ['Contenu tiers & absence d’endossement', 'Le contenu communautaire est créé et publié par ses auteurs, pas par nous. Notre modération et nos contrôles d’intégrité automatiques visent à détecter les abus et malwares évidents, mais ils ne garantissent ni la sécurité, ni la qualité, ni la légalité, ni l’adéquation, et le fait de lister ou d’héberger un contenu ne vaut jamais approbation. Tu es seul responsable du respect des conditions, licences et règles de tout jeu, plateforme, mod loader ou logiciel tiers avec lequel tu utilises ce contenu — certaines modifications peuvent enfreindre les conditions de ces tiers, et toute conséquence qui en découle (y compris un bannissement de compte sur ces services) t’incombe seul.'],
      ['Acceptation des présentes conditions', 'Tu dois accepter les présentes Conditions et la politique Paiements & Remboursements avant de pouvoir payer un hébergement ou une option. Nous enregistrons la date et l’heure de ton acceptation. En cas de changement important, une nouvelle acceptation peut être requise avant ton prochain achat.'],
      ['Paiements', 'L’hébergement et la mise en avant sont facturés via Stripe. Les prix sont affichés avant confirmation et peuvent changer avec préavis ; un changement n’affecte jamais une période déjà payée. Pas de remboursement des périodes partielles, sauf obligation légale — voir la politique Paiements & Remboursements pour le détail complet.'],
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
      <div className="flex flex-wrap gap-2 mb-5"><Link to="/legal"><Button size="sm" variant="default"><FileText size={14} /> {t('legal.all', 'All')}</Button></Link>{tabs.map(([k, l, I]) => <Link key={k} to={`/legal/${k}`}><Button size="sm" variant={k === page ? 'primary' : 'default'}><I size={14} /> {l}</Button></Link>)}</div>
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

// The /legal hub — lists every legal/policy document.
export function LegalIndex() {
  const { lang, t } = useI18n();
  const L = LEGAL[lang] || LEGAL.en;
  const S = LEGAL_SUMMARY[lang] || LEGAL_SUMMARY.en;
  const pages = ['about', 'privacy', 'terms', 'cookies', 'refunds'];
  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader icon={FileText} title={t('legal.title', 'Legal & policies')} subtitle={t('legal.sub', 'Our policies and terms, in plain language.')} />
      <div className="grid sm:grid-cols-2 gap-4">
        {pages.map((k) => { const d = L[k]; const I = d.icon; return (
          <Link key={k} to={`/legal/${k}`} className="card card-hover p-5 flex items-start gap-3">
            <span className="grid place-items-center w-10 h-10 rounded-xl bg-[var(--surface-2)] text-[var(--primary-2)] shrink-0"><I size={18} /></span>
            <div className="min-w-0"><div className="font-semibold">{d.title}</div><div className="text-sm text-[var(--muted)] mt-0.5 line-clamp-2">{S[k]}</div></div>
          </Link>
        ); })}
      </div>
    </div>
  );
}
