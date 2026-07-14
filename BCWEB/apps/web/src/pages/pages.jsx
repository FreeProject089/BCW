import { useEffect, useState, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Link, useParams, useSearchParams, useNavigate } from 'react-router-dom';
import {
  Boxes, Music2, Puzzle, Palette, Server, Rocket, Download, ArrowRight, Search, Upload,
  Bell, CheckCircle2, XCircle, Clock, Package, ShieldCheck, Inbox, Tag, FileJson, HardDrive, HelpCircle,
  Cpu, Gauge, TrendingUp, Eye, Sparkles, Lock, Zap, Users, GitBranch, Settings2,
  Newspaper, LayoutDashboard, Cookie, Sliders, Heart, Trash2, PenSquare, Star, Bell as BellIcon, CheckCheck, ArrowUpRight,
  Receipt, Wand2, Plus, Link2, Copy, Globe, BadgeCheck, Mail, Send, MessageSquare, Files, RefreshCw, X, ChevronDown, Monitor, MonitorOff, AlertTriangle, Ticket,
  CreditCard, Gift, Archive, Shield, Ban, FolderGit2, FileText, History, Target, Megaphone, EyeOff, Rss,
  Info, Orbit, Fingerprint, Layers, MapPin, Globe2, Activity, Building2, Map as MapIcon, ShoppingCart,
  Mic, KeyRound, MousePointerClick, PanelTop, Navigation, Save, Loader2,
  Home as HomeIcon, BookOpen, LayoutGrid, Smartphone, Monitor as MonitorIcon, Upload as UploadIcon, RotateCcw, Calendar,
} from 'lucide-react';
import { api, uploadPayload, uploadImage, uploadAsset } from '../lib/api.js';
import { useAuth } from './auth.jsx';
import { useI18n } from '../i18n.jsx';
import { useTheme } from '../ui/theme.jsx';
import { getConsent, setConsent } from '../lib/analytics.js';
import { SKIP_KEY, useIntro } from '../ui/IntroContext.jsx';
import { getGlassPrefs, setGlassPrefs, getOrbTransitionPref, setOrbTransitionPref } from '../lib/prefs.js';
import { MyRepos, AdminRepos, AdminPools, Billing, rawStatusLabel } from './repos.jsx';
import { TotpQuickFill } from './twofa-fill.jsx';
import { AuthorsRow, MarkdownEditor } from './blog.jsx';
import Avatar, { VARIANTS as AV_VARIANTS, PALETTES as AV_PALETTES } from '../ui/Avatar.jsx';
import { Badges, BadgeIcon } from '../ui/Badges.jsx';
import { ReportThread, ReportComposer, ReportModal } from '../ui/report.jsx';

// A stable-but-varied Boring-avatar look for an anonymous analytics session (keyed by
// the visitor hash) — so each session gets its OWN geometric avatar instead of the
// generic BC brand icon, and the same visitor always looks the same.
const AV_PAL_LIST = Object.values(AV_PALETTES);
export function seededAvatar(seed) {
  let h = 0; const s = String(seed || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return { variant: AV_VARIANTS[h % AV_VARIANTS.length], colors: AV_PAL_LIST[(h >> 5) % AV_PAL_LIST.length] };
}
import { createRoot } from 'react-dom/client';
import { AppLogo, KofiIcon, GithubIcon, DiscordIcon, RedditIcon, GoogleIcon } from '../ui/brand.jsx';
import { Button, Card, Badge, Input, Textarea, Select, Dropdown, Field, PageHeader, EmptyState, Spinner, Modal, useDialog, useToast, copyText } from '../ui/ui.jsx';
import Markdown, { ShowcaseIcon } from '../ui/md.jsx';
import IconPicker from '../editor/icon-picker.jsx';
import { IconGlyph } from '../ui/md.jsx';
import ProjectConfigEditor from '../editor/project-config-editor.jsx';

/* ── helpers ── */
export function useAsync(fn, deps = []) {
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
export function useElementWidth(fallback = 760) {
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
export const KIND_ICON = { APP: Boxes, PLUGIN: Puzzle, THEME: Palette, PRESET: FileJson };
export const KIND_LABEL = { APP: 'App', PLUGIN: 'Plugin', THEME: 'Theme', PRESET: 'Preset' };
export const statusTone = (s) => s === 'PUBLISHED' ? 'green' : (s === 'REJECTED' || s === 'SUSPENDED') ? 'red' : 'amber';
export const Loading = () => <div className="flex items-center gap-2 text-[var(--muted)] py-10"><Spinner /> Loading…</div>;
// CSV cell that is safe against spreadsheet formula injection (CWE-1236): a value that
// starts with =, @, or a +/- that isn't a plain number is prefixed with ' so Excel/Sheets
// treat it as text, then quoted if it contains CSV specials. Analytics paths, emails, IPs,
// audit details etc. can be attacker-influenced, so every export routes through this.
export const csvCell = (s) => {
  let v = String(s ?? '');
  if (/^[=@\t\r]/.test(v) || (/^[+\-]/.test(v) && !Number.isFinite(Number(v)))) v = `'${v}`;
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};
// Coarse "time left" for a scheduled deletion.
export function fmtRemaining(deleteAt) {
  const ms = new Date(deleteAt).getTime() - Date.now();
  if (ms <= 0) return 'soon';
  const h = Math.floor(ms / 3600000);
  return h >= 1 ? `${h}h` : `${Math.max(1, Math.floor(ms / 60000))}m`;
}

// A friendlier JSON editor: framed panel with a live valid/invalid indicator, a
// one-click Format button, and tab-to-indent — replaces the raw ugly <textarea>.
export function JsonEditor({ value, onChange, placeholder, minH = 170 }) {
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
export function SideDash({ title, subtitle, icon, tabs, headerActions, children }) {
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
      <tb.icon size={16} className={`shrink-0 ${active === tb.id ? 'text-[var(--primary-2)]' : ''}`} /> <span className="min-w-0 truncate">{tb.label}</span>
      {tb.badge ? <Badge tone="primary" className="ml-auto shrink-0">{tb.badge}</Badge> : null}
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
        // If, by the time this fires, the element is already substantially inside (or
        // above) the viewport — i.e. the user fast-scrolled or jumped past the trigger —
        // snap it in with a short fade instead of playing the long rise+blur while it's
        // on screen (that's the glitchy "late spawn" seen on Latest news / reviews when
        // scrolling fast). Threshold raised to 0.85 so only elements JUST entering at the
        // very bottom edge get the full animation. Fresh-measured (not the stale rect).
        if (el.getBoundingClientRect().top < window.innerHeight * 0.85) el.classList.add('reveal-instant');
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
      // If the element is already at or ABOVE the fold when we start observing it —
      // e.g. async content (the reviews grid) that renders after a FAST scroll past
      // its position — reveal it now. The IntersectionObserver only fires for elements
      // crossing INTO view from below, so it would leave these stuck at opacity:0
      // ("reviews hidden / buggy when you scroll fast").
      if (el.getBoundingClientRect().top < window.innerHeight) { el.classList.add('reveal-instant', 'in'); return; }
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
  const { data: reviewsData } = useAsync(() => api.get('/reviews').catch(() => null), []);
  const { user } = useAuth();
  const { t, lang } = useI18n();
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
        {/* Clean self-contained step cards — no roadmap rail, no "Step N" label. The icon
            chip and a big ghost number share the top row (balanced, fully inside the
            padding), then title · description · CTA. */}
        <div className="reveal-stagger grid md:grid-cols-3 gap-5">
          {[[Users, t('home.step1'), t('home.step1.d'), user ? '/profile' : '/auth', user ? t('home.step1.done', "You're set — view profile") : t('home.step1.cta', 'Sign up free')],
            [Upload, t('home.step2'), t('home.step2.d'), '/catalog', t('home.step2.cta', 'Browse the catalog')],
            [Rocket, t('home.step3'), t('home.step3.d'), '/hosting', t('home.step3.cta', 'See hosting plans')]].map(([I, title, d, to, cta], i) => (
            <Link key={title} to={to} className="group">
              <Card hover className="p-7 h-full flex flex-col group-hover:border-[color-mix(in_srgb,var(--primary)_45%,var(--line))] transition-colors">
                <div className="flex items-center justify-between mb-6">
                  <span className="grid place-items-center w-12 h-12 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 shadow-lg shadow-orange-500/25 transition-transform duration-300 group-hover:scale-105">
                    <I size={22} className="text-white" />
                  </span>
                  <span aria-hidden className="text-[52px] leading-none font-black text-[var(--line-strong)] select-none pointer-events-none transition-colors group-hover:text-[color-mix(in_srgb,var(--primary)_32%,var(--line-strong))]">{i + 1}</span>
                </div>
                <div className="font-bold text-lg leading-snug">{title}</div>
                <div className="text-sm text-[var(--muted)] mt-2 leading-relaxed flex-1">{d}</div>
                <div className="text-sm text-[var(--primary-2)] mt-6 flex items-center gap-1.5 font-semibold">{cta} <ArrowRight size={14} className="transition-transform group-hover:translate-x-1" /></div>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      {/* community reviews / testimonials — admin-curated, hidden when off or empty */}
      {reviewsData?.enabled && reviewsData.reviews?.length > 0 && (
        <section>
          <SectionKicker n="04" label={t('home.k.reviews', 'Reviews')} />
          <div className="reveal-on-scroll text-center mb-9">
            <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight">{t('home.reviews.title', 'What the community says')}</h2>
            <p className="text-[var(--muted)] mt-2.5">{t('home.reviews.sub', 'Real words from people building with Better* tools.')}</p>
          </div>
          {/* Auto-scrolling marquee (pauses on hover). The list is duplicated so it
              loops seamlessly; speed scales with how many reviews there are. */}
          <div className="reveal-on-scroll reviews-marquee relative overflow-hidden">
            {/* Each card carries its OWN right margin (not a flex `gap`) so the duplicated
                list is exactly two equal-width copies — translateX(-50%) then lands on a
                perfect seam and the loop is continuous with no pause/jump. */}
            <div className="reviews-track flex py-1" style={{ animationDuration: `${Math.max(24, reviewsData.reviews.length * 10)}s` }}>
              {[...reviewsData.reviews, ...reviewsData.reviews].map((rv, idx) => {
                const text = (lang === 'fr' && rv.bodyFr) ? rv.bodyFr : rv.body;
                const av = rv.avatar || {};
                return (
                  <Card key={idx} className="w-[340px] max-w-[80vw] shrink-0 mr-5 p-6 flex flex-col" style={{ background: 'var(--bg-solid)' }} aria-hidden={idx >= reviewsData.reviews.length}>
                    {rv.rating > 0 && (
                      <div className="flex items-center gap-0.5 mb-3">
                        {[1, 2, 3, 4, 5].map((n) => <Star key={n} size={15} className={n <= rv.rating ? 'text-amber-400' : 'text-[var(--line-strong)]'} fill={n <= rv.rating ? 'currentColor' : 'none'} />)}
                      </div>
                    )}
                    <p className="text-sm text-[var(--muted)] leading-relaxed flex-1">“{text}”</p>
                    <div className="flex items-center gap-3 mt-4 pt-4 border-t border-[var(--line)]">
                      <Avatar image={av.image} variant={av.variant || 'beam'} seed={av.seed || rv.author} colors={av.colors} size={38} />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">{rv.author}</div>
                        {rv.role && <div className="text-xs text-[var(--faint)] truncate">{rv.role}</div>}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* latest posts */}
      <section>
        <SectionKicker n={reviewsData?.enabled && reviewsData.reviews?.length ? '05' : '04'} label={t('home.k.news', 'From the blog')} />
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
      {/* Filter bar: project switcher · search · kind pills · sort — grouped into one
          tidy card instead of a loose flex row. */}
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)]/40 p-3 mb-5 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          {[['', t('cat.allprojects', 'All')], ['bmm', 'BMM'], ['bsm', 'BSM']].map(([pk, l]) => (
            <button key={pk} onClick={() => { set('project', pk); if (kind) set('kind', ''); }} className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${project === pk ? 'bg-gradient-to-br from-orange-500 to-amber-500 text-white shadow-sm' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}>{l}</button>
          ))}
          <div className="flex-1" />
          <Select className="!w-auto" value={sort} onChange={(e) => set('sort', e.target.value)}>{SORTS.map(([v, l]) => <option key={v} value={v}>{t(`cat.sort.${v}`, l)}</option>)}</Select>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
            <Input className="!pl-9" placeholder={t('cat.search', 'Search mods, plugins, themes & presets…')} defaultValue={q} onKeyDown={(e) => e.key === 'Enter' && set('q', e.target.value)} />
          </div>
          {/* Kinds are project-scoped: presets are a BSM thing; BMM has apps/plugins/themes. */}
          <div className="flex gap-1.5 flex-wrap">
            {(project === 'bsm' ? ['', 'PRESET'] : project === 'bmm' ? ['', 'APP', 'PLUGIN', 'THEME'] : ['', 'APP', 'PLUGIN', 'THEME', 'PRESET']).map((k) => {
              const I = k ? (KIND_ICON[k] || Package) : Package;
              return <button key={k} onClick={() => set('kind', k)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition ${kind === k ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary-2)] font-medium' : 'border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--line-strong)]'}`}><I size={14} /> {k ? (KIND_LABEL[k] || k) : t('cat.all', 'All')}</button>;
            })}
          </div>
        </div>
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
      <CommunityCatalogsStrip />
    </div>
  );
}

// A strip of community-hosted catalogs under the official grid — separate from the
// trusted official items (different trust level), each linking to its /c/:slug page.
function CommunityCatalogsStrip() {
  const { t } = useI18n();
  const { data } = useAsync(() => api.get('/c'), []);
  const cats = data?.catalogs || [];
  if (!cats.length) return null;
  return (
    <div className="mt-8">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="font-semibold flex items-center gap-2"><Boxes size={16} className="text-[var(--primary-2)]" /> {t('cc.pub.title', 'Community catalogs')}</h2>
        <Badge tone="">{cats.length}</Badge>
      </div>
      <p className="text-sm text-[var(--muted)] mb-3">{t('cc.pub.desc', 'Catalogs hosted by community members — added directly in BMM as a source. Unverified; add at your own discretion.')}</p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cats.map((c) => (
          <Link key={c.id} to={`/c/${c.slug}`}><Card hover className="p-4 h-full">
            <div className="flex items-center justify-between"><div className="grid place-items-center w-9 h-9 rounded-lg bg-emerald-500/10 border border-[var(--line)]"><Boxes size={17} className="text-emerald-400" /></div><Badge tone="">{c.itemCount} {t('cc.items', 'items')}</Badge></div>
            <div className="font-semibold mt-3">{c.name}</div>
            <div className="text-sm text-[var(--muted)] mt-1 line-clamp-2">{c.description || t('cat.nodesc', 'No description.')}</div>
            <div className="text-xs text-[var(--faint)] mt-3 flex items-center gap-3"><span className="flex items-center gap-1"><Users size={12} /> {c.owner}</span><span className="flex items-center gap-1"><Download size={12} /> {c.downloads ?? 0}</span></div>
          </Card></Link>
        ))}
      </div>
    </div>
  );
}

export function ItemDetail() {
  const { slug } = useParams();
  const [sp] = useSearchParams();
  const toast = useToast(); const { t } = useI18n();
  // A private/unlisted item is reachable only with its share key (?k=…) — carry it
  // through to the detail + download calls so the owner's shared link works end-to-end.
  const key = sp.get('k');
  const kq = key ? `?k=${encodeURIComponent(key)}` : '';
  const { data, loading, err } = useAsync(() => api.get(`/catalog/${slug}${kq}`), [slug, kq]);
  const [warn, setWarn] = useState(false);
  if (loading) return <Loading />;
  if (err) return <EmptyState icon={XCircle} title={t('item.notfound', 'Not found')} />;
  const it = data.item; const I = KIND_ICON[it.kind] || Package;
  const v = it.kind === 'PLUGIN' ? it.meta?.validation : null; // { valid, reason, sha256, files }
  const doDownload = async () => { try { const { url } = await api.get(`/catalog/${slug}/download${kq}`); window.open(url, '_blank'); } catch { toast.error(t('cat.dlfail', 'Download failed.')); } };
  // Invalid plugins pop a warning first; the user must confirm to proceed.
  const download = () => { if (v && v.valid === false) return setWarn(true); doDownload(); };
  // BMM installs APP/PLUGIN/THEME via a bmm://catalog/<kind>/install deeplink (handled
  // in BMM's deep_link_manager). Resolve a real download URL, then fire the deeplink.
  const bmmInstallable = ['APP', 'PLUGIN', 'THEME'].includes(it.kind) && (it.payloadKey || it.meta?.download_url || it.meta?.download?.url);
  const openInBmm = async () => {
    let url = it.meta?.download_url || it.meta?.download?.url;
    if (!url && it.payloadKey) { try { const r = await api.get(`/catalog/${slug}/download${kq}`); url = r.url; } catch {} }
    if (!url) return toast.error(t('item.nourl', 'No download URL for this item.'));
    const type = it.kind === 'APP' ? (it.meta?.download?.file_type || 'exe') : '';
    const dl = `bmm://catalog/${it.kind.toLowerCase()}/install?name=${encodeURIComponent(it.name)}&url=${encodeURIComponent(url)}${type ? `&type=${type}` : ''}`;
    window.location.href = dl;
  };
  return (
    <div className="max-w-3xl">
      {it.private && (
        <Card className="p-3.5 mb-5 flex items-center gap-2.5 bg-amber-500/8 border-amber-500/30">
          <Lock size={17} className="text-amber-400 shrink-0" />
          <div className="text-sm"><b>{t('item.private.t', 'Private — not listed publicly')}</b> <span className="text-[var(--muted)]">{t('item.private.d', 'This item isn’t in the public catalog yet. Only people with this direct link can see it; it’ll be listed once an admin validates it.')}</span></div>
        </Card>
      )}
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
    { icon: Upload, label: t('sub.title', 'Submit content'), to: '/submit' },
    { icon: Rocket, label: t('dash.hostrepo', 'Host a repo'), to: '/hosting' },
    { icon: Package, label: t('dash.browse', 'Browse catalog'), to: '/catalog?project=bmm' },
    { icon: LayoutDashboard, label: t('dash.editprofile', 'Edit profile'), to: '/profile' },
  ];
  const tabs = [
    { id: 'overview', label: t('dash.overview', 'Overview'), icon: LayoutDashboard },
    { id: 'items', label: t('dash.myitems', 'My items'), icon: Package, badge: list.length || undefined },
    { id: 'catalogs', label: t('dash.mycatalogs', 'My catalogs'), icon: Boxes },
    { id: 'repos', label: t('dash.myrepos', 'My repos'), icon: Server, badge: rlist.length || undefined },
    { id: 'billing', label: t('dash.billing', 'Billing'), icon: Receipt },
    { id: 'reports', label: t('dash.reports', 'Reports & contact'), icon: MessageSquare },
  ];
  return (
    <>
      {payReturn && !introActive && <PaymentResultModal result={payReturn} onClose={() => setPayReturn(null)} />}
      <SideDash icon={LayoutDashboard} title={t('dash.hi', 'Hi, {name}').replace('{name}', user?.displayName || 'there')} subtitle={t('dash.sub', 'Manage your content, repos and billing.')} tabs={tabs}
        headerActions={<Link to="/submit"><Button variant="primary"><Upload size={16} /> {t('sub.title', 'Submit content')}</Button></Link>}>
        {(s) => (<>
          {s === 'overview' && <>
            {/* Goal-gradient onboarding: the checklist owns first-run guidance (incl. 2FA);
                once it's done or dismissed, fall back to the standalone 2FA nudge. */}
            {(() => {
              const complete = !!user?.totpEnabled && list.length > 0 && rlist.length > 0;
              return (!gsDismissed && !complete)
                ? <GettingStarted user={user} items={list} repos={rlist} onSubmit={() => nav('/submit')} onDismiss={() => { setGsDismissed(true); try { localStorage.setItem(GS_DISMISS_KEY, '1'); } catch {} }} />
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
              <Link to="/submit"><Button size="sm"><Upload size={14} /> {t('dash.new', 'New')}</Button></Link>
            </div>
            {list.length > 3 && (
              <div className="flex flex-wrap gap-2 mb-3">
                <div className="relative flex-1 min-w-[160px]"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
                  <Input className="!pl-8 !py-1.5 !text-sm" placeholder={t('dash.search', 'Search my items…')} value={itemQ} onChange={(e) => setItemQ(e.target.value)} /></div>
                <Select className="!w-auto !py-1.5 !text-sm" value={itemKind} onChange={(e) => setItemKind(e.target.value)}>
                  <option value="all">{t('dash.allkinds', 'All kinds')}</option><option value="APP">APP</option><option value="PLUGIN">PLUGIN</option><option value="THEME">THEME</option><option value="PRESET">PRESET</option></Select>
                <Select className="!w-auto !py-1.5 !text-sm" value={itemStatus} onChange={(e) => setItemStatus(e.target.value)}>
                  <option value="all">{t('dash.allstatus', 'All statuses')}</option><option value="PUBLISHED">Published</option><option value="PENDING">Pending</option><option value="REJECTED">Rejected</option><option value="SUSPENDED">Suspended</option><option value="deleting">Deleting</option></Select>
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
                    {/* Public listing needs admin validation; until then the item is private
                        but the owner can always share its own direct link (like a repo). */}
                    {(() => {
                      const isPub = it.status === 'PUBLISHED';
                      const link = isPub ? `${location.origin}/item/${it.slug}` : (it.shareKey ? `${location.origin}/item/${it.slug}?k=${it.shareKey}` : null);
                      if (!link || it.deleteAt) return null;
                      return (
                        <button onClick={() => { copyText(link); toast.success(isPub ? t('dash.pubcopied', 'Public link copied.') : t('dash.privcopied', 'Private share link copied.')); }}
                          className="mt-1 inline-flex items-center gap-1 text-[11px] text-[var(--faint)] hover:text-[var(--primary-2)] transition" title={link}>
                          {isPub ? <Globe size={11} /> : <Lock size={11} />} {isPub ? t('dash.copypublic', 'Copy public link') : t('dash.copyprivate', 'Copy private link')}
                        </button>
                      );
                    })()}
                    {it.status === 'SUSPENDED' && <div className="text-[11px] text-red-400 mt-0.5">{t('dash.suspendednote', 'Suspended by an admin — you can’t edit or resubmit it. Contact support to appeal.')}</div>}
                  </div>
                  {it.deleteAt
                    ? <><Badge tone="red"><Trash2 size={11} /> {t('dash.deletingin', 'Deleting in')} {fmtRemaining(it.deleteAt)}</Badge>
                        <Button size="sm" variant="ghost" onClick={() => cancelDelete(it)}>{t('common.cancel', 'Cancel')}</Button></>
                    : <><Badge tone={statusTone(it.status)}>{it.status}</Badge>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(it)}><PenSquare size={14} /> <span className="hidden sm:inline">{t('dash.viewedit', 'View / edit')}</span></Button></>}
                </Card>); })}
            </div> : <div className="text-sm text-[var(--muted)] py-8 text-center">{t('dash.nomatch', 'No items match your filters.')}</div>)
              : <EmptyState icon={Inbox} title={t('dash.noitems', 'No items yet')} sub={t('dash.noitems.s', 'Submit your first app, plugin, theme or preset.')}>
              <Link to="/submit"><Button variant="primary"><Upload size={15} /> {t('sub.title', 'Submit content')}</Button></Link></EmptyState>)}
          </div>}

          {s === 'catalogs' && <OwnerCatalogs />}
          {s === 'repos' && <MyRepos />}
          {s === 'billing' && <Billing />}
          {s === 'reports' && <MyReports />}
        </>)}
      </SideDash>

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
    } catch (x) { toast.error(x.data?.error === 'item_suspended' ? t('ie.suspended', 'This item was suspended by an admin — you can’t edit or resubmit it. Contact support to appeal.') : (x.data?.error || x.message || t('ie.savefail2', 'Failed to save.'))); } finally { setBusy(false); }
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
