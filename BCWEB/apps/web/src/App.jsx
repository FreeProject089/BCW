import { useEffect, useState, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Routes, Route, Link, NavLink, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Boxes, Music2, Newspaper, Server, Rocket, LayoutDashboard, Shield, LogOut, Download, Menu, X, Sparkles, Bell, Trash2, CheckCheck, Mail, Home as HomeIcon, ChevronDown, MoreHorizontal, LayoutGrid, ShieldCheck, ArrowUpRight, Info, AlertTriangle, CheckCircle2, Settings as SettingsIcon, BookOpen } from 'lucide-react';
import { useAuth } from './pages/auth.jsx';
import { api } from './lib/api.js';
import { Button, useToast, Modal } from './ui/ui.jsx';
import { Badges, BadgeIcon } from './ui/Badges.jsx';
import { ThemeToggle } from './ui/theme.jsx';
import { useI18n, LangToggle, LangSelect } from './i18n.jsx';
import { KofiIcon, GithubIcon, DiscordIcon, RedditIcon } from './ui/brand.jsx';
import { ShowcaseIcon, IconGlyph } from './ui/md.jsx';
import { trackPageview, initVitals, initInteractions, initErrors } from './lib/analytics.js';
import { loadGtmIfConsented } from './lib/gtm.js';
import { getOrbTransitionPref } from './lib/prefs.js';
import { canAdmin, effectiveCaps, hasProjectGrant, utilAllowed } from './lib/roles.js';
import { readLayout, navAlignClass } from './lib/navLayout.js';
import CookieConsent from './ui/CookieConsent.jsx';
import PromoBadge from './ui/promo-badge.jsx';
import EventEffect from './hero/event-effect.jsx';
import { IntroProvider, useIntro } from './ui/IntroContext.jsx';
import { lazy, Suspense } from 'react';
import { ReportJoin } from './ui/report.jsx';
import Avatar from './ui/Avatar.jsx';
// Eager: the initial landing routes + nav-critical modules (the notification map is
// rendered by the always-present nav bell, which keeps dashboard.jsx in the main chunk).
import NotFound from './pages/notfound.jsx';
import { NOTIF, NOTIF_FALLBACK } from './ui/notif.js'; // tiny data module — kept eager for the nav bell
import { Home } from './pages/home.jsx';
import { Catalog, ItemDetail } from './pages/catalog.jsx';
import { Auth } from './pages/signin.jsx';
// Lazy: route-split so the initial bundle no longer ships the whole admin back-office,
// repo tools, editors, etc. — each loads on demand behind the Suspense boundary below.
const named = (imp, key) => lazy(() => imp().then((m) => ({ default: m[key] })));
// The hero orb pulls in three.js (~460 KB) — lazy-load it so it never blocks first paint
// (it's a decorative backdrop; a null fallback means it just fades in once loaded).
const Hero3D = lazy(() => import('./hero/Hero3D.jsx'));
const Admin = named(() => import('./pages/admin.jsx'), 'Admin');
const Dashboard = named(() => import('./pages/dashboard.jsx'), 'Dashboard');
const ReposPage = named(() => import('./pages/repos.jsx'), 'ReposPage');
const RepoDashboard = named(() => import('./pages/repo-dashboard.jsx'), 'RepoDashboard');
const ProjectPage = lazy(() => import('./pages/project.jsx'));
const OtherProjects = named(() => import('./pages/project.jsx'), 'OtherProjects');
const ShowcaseProjectPage = named(() => import('./pages/project.jsx'), 'ShowcaseProjectPage');
const Profile = lazy(() => import('./pages/profile.jsx'));
const PublicProfile = lazy(() => import('./pages/publicprofile.jsx'));
const UserSearch = named(() => import('./pages/publicprofile.jsx'), 'UserSearch');
const BlogList = named(() => import('./pages/blog.jsx'), 'BlogList');
const BlogPostPage = named(() => import('./pages/blog.jsx'), 'BlogPostPage');
const Docs = lazy(() => import('./pages/docs.jsx'));
const MyoPage = named(() => import('./pages/myo.jsx'), 'MyoPage');
const MyoRequestPage = named(() => import('./pages/myo.jsx'), 'MyoRequestPage');
const Faq = lazy(() => import('./pages/faq.jsx'));
const Submit = named(() => import('./pages/submit.jsx'), 'Submit');
const CommunityCatalogPage = lazy(() => import('./pages/catalogpage.jsx'));
const RepoPublicPage = lazy(() => import('./pages/repopublic.jsx'));
const Hosting = named(() => import('./pages/hosting.jsx'), 'Hosting');
const Legal = named(() => import('./pages/legal.jsx'), 'Legal');
const LegalIndex = named(() => import('./pages/legal.jsx'), 'LegalIndex');
const Contact = named(() => import('./pages/contact.jsx'), 'Contact');
const Settings = named(() => import('./pages/account-pages.jsx'), 'Settings');
const Authorize = named(() => import('./pages/account-pages.jsx'), 'Authorize');
const VerifyEmail = named(() => import('./pages/account-pages.jsx'), 'VerifyEmail');
const TwoFactor = named(() => import('./pages/twofa.jsx'), 'TwoFactor');

const KOFI = 'https://ko-fi.com/bettercommunity';
// Clean default topbar shown out of the box (no admin config): the three apps live under
// one "Apps" dropdown, then Blog / Docs / Repos / Hosting as flat links. Mirrors
// DEFAULT_NAV_SEED in pages.jsx so the editor's "Reset to default" restores exactly this.
const DEFAULT_ITEMS = [
  { type: 'group', k: 'nav.apps', icon: Boxes, children: [
    { to: '/p/bmm', k: 'nav.bmm', icon: Boxes, img: '/icons/bmm.png' },
    { to: '/p/bsm', k: 'nav.bsm', icon: Music2, img: '/icons/bsm.png' },
    { to: '/p/installer', k: 'nav.installer', icon: Download, img: '/icons/bi.png' },
  ] },
  { type: 'link', to: '/blog', k: 'nav.blog', icon: Newspaper },
  { type: 'link', to: '/docs', k: 'nav.docs', icon: BookOpen },
  { type: 'link', to: '/repos', k: 'nav.repos', icon: Server },
  { type: 'link', to: '/hosting', k: 'nav.hosting', icon: Rocket },
];

// Icons an admin can pick for a configured nav item — a curated, safe whitelist
// (only these render; an unknown name falls back to Boxes). Keys are the values
// stored in the nav config; keep them stable.
const NAV_ICONS = { Boxes, Music2, Newspaper, Server, Rocket, Shield, Download, Sparkles, Mail, Home: HomeIcon, BookOpen, LayoutGrid, Info, Bell };

// Built-in topbar utility elements, split by their responsive cluster (see Topbar).
// Admins reorder/hide WITHIN a cluster; the keys are the config identifiers — keep stable.
const UTIL_A = ['notifications', 'projects', 'lang', 'theme', 'settings']; // always visible
const UTIL_B = ['dashboard', 'admin', 'profile', 'logout', 'login'];       // lg+ account cluster
export const UTIL_KEYS = [...UTIL_A, ...UTIL_B];
export const NAV_ICON_NAMES = Object.keys(NAV_ICONS);

// lucide export/PascalCase name → CDN kebab-case (BookOpen → book-open) so old configs and
// picker output ("boxes", "simple:youtube") both resolve through IconGlyph.
const navIconName = (icon) => {
  const s = String(icon || 'boxes');
  if (s.startsWith('simple:') || s.startsWith('app:')) return s;
  return s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/\s+/g, '-').toLowerCase();
};

// The admin nav config (items / utility / projectsMode / downbar), fetched once and
// shared by the topbar and the mobile bottom bar so they never disagree or double-fetch.
let _navCfgCache; // undefined = not fetched, null = no config, object = config
let _navCfgPromise;
function useNavConfig() {
  const [cfg, setCfg] = useState(_navCfgCache ?? null);
  useEffect(() => {
    if (_navCfgCache !== undefined) { setCfg(_navCfgCache); return; }
    _navCfgPromise = _navCfgPromise || api.get('/nav')
      .then((r) => { _navCfgCache = r.nav || null; return _navCfgCache; })
      .catch(() => { _navCfgCache = null; return null; });
    let alive = true;
    _navCfgPromise.then((v) => { if (alive) setCfg(v); });
    return () => { alive = false; };
  }, []);
  return cfg;
}

// A pinned showcase project's icon (a string) → the shape NavIcon renders: a URL/path
// becomes an <img>, a name goes through IconGlyph — same result as ShowcaseIcon.
const showcaseChildIcon = (icon) => /^(https?:|data:|\/)/i.test(icon || '') ? { img: icon } : { icon: icon || 'sparkles' };

// Mobile bottom bar items derived from the nav config: home first, then the leading
// top-level LINK items (groups are skipped — a bottom bar can't nest). Capped so the bar
// stays legible on a phone. `k`-less items carry raw label/labelFr like configured nav.
function deriveDownbar(items) {
  const leaves = (items || []).filter((it) => it.type !== 'group' && it.to).slice(0, 4);
  return [{ to: '/', k: 'nav.home', icon: HomeIcon, exact: true }, ...leaves];
}

// Real app icon when /icons/<app>.png exists, otherwise any Lucide icon or Simple Icons
// brand (via IconGlyph). `item.icon` may be a lucide component (hardcoded NAV) or a string
// name / "simple:<slug>" (admin-configured nav).
function NavIcon({ item, size = 15 }) {
  const [ok, setOk] = useState(!!item.img);
  if (item.img && ok) return <img src={item.img} alt="" width={size + 3} height={size + 3} className="rounded-[4px] object-contain" onError={() => setOk(false)} />;
  if (typeof item.icon !== 'string') { const I = item.icon || Boxes; return <I size={size} />; }
  return <IconGlyph name={navIconName(item.icon)} size={size} />;
}

// A nav item's visible text. Hardcoded items carry a translation key `k`; admin-configured
// items carry raw label / labelFr (the visitor's language wins, falling back to label).
function navLabel(item, t, lang) {
  if (item.k) return t(item.k);
  return (lang === 'fr' && item.labelFr) ? item.labelFr : (item.label || '');
}
function navSubLabel(item, lang) {
  return (lang === 'fr' && item.descFr) ? item.descFr : (item.desc || '');
}

// Segmented "pill" nav link (desktop) + hamburger-sheet row. Module-scope so the
// dropdown/accordion components below can share the exact same styling.
const pill = ({ isActive }) => `flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition ${isActive ? 'bg-[var(--bg-solid)] text-[var(--primary)] shadow-sm font-medium' : 'text-[var(--muted)] hover:text-[var(--text)]'}`;
const sheet = ({ isActive }) => `flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm ${isActive ? 'bg-[var(--surface-2)] text-[var(--primary)] font-medium' : 'text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'}`;

// Desktop dropdown pill for a configured "group" nav item — Twenty-style: opens on
// hover (with a small close delay so the pointer can travel to the panel) and on click,
// closes on outside-click / Esc / route change. Keyboard-focusable + aria-expanded.
function NavDropdown({ item, t, lang }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);   // { left, top } fixed coords for the portaled panel
  const ref = useRef(null);               // the trigger wrapper
  const menuRef = useRef(null);           // the portaled panel
  const closeT = useRef(null);
  const loc = useLocation();
  const children = item.children || [];
  const active = children.some((c) => loc.pathname === c.to || loc.pathname.startsWith(c.to + '/'));
  useEffect(() => { setOpen(false); }, [loc.pathname]);
  // The panel is rendered in a portal (see below) so it can escape the nav's
  // overflow-x-auto clip; anchor it under the trigger and keep it there on scroll/resize.
  const place = () => { const r = ref.current?.getBoundingClientRect(); if (r) setPos({ left: r.left, top: r.bottom + 6 }); };
  useLayoutEffect(() => { if (open) place(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onScroll = () => place();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => { window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', onScroll); };
  }, [open]);
  useEffect(() => {
    // Outside-click closes — but the panel lives outside `ref` (portal), so exclude it too.
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target) && menuRef.current && !menuRef.current.contains(e.target)) setOpen(false); };
    const onEsc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onEsc); };
  }, []);
  const enter = () => { clearTimeout(closeT.current); setOpen(true); };
  const leave = () => { clearTimeout(closeT.current); closeT.current = setTimeout(() => setOpen(false), 140); };
  return (
    <div ref={ref} className="relative shrink-0" onMouseEnter={enter} onMouseLeave={leave}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="true" aria-expanded={open} className={pill({ isActive: active }) + ' shrink-0'}>
        <NavIcon item={item} size={16} /><span className="nav-lbl">{navLabel(item, t, lang)}</span><ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && pos && createPortal(
        <div ref={menuRef} onMouseEnter={enter} onMouseLeave={leave}
          className="fixed z-[70] min-w-[248px] p-1.5 rounded-2xl border border-[var(--line)] topbar anim-fade"
          style={{ left: pos.left, top: pos.top, boxShadow: '0 14px 44px -12px rgba(0,0,0,0.42)' }}>
          {children.map((c, i) => (
            <NavLink key={c.to + i} to={c.to} onClick={() => setOpen(false)} className={({ isActive }) => `flex items-start gap-2.5 p-2 rounded-xl transition ${isActive ? 'bg-[var(--surface-2)]' : 'hover:bg-[var(--surface-2)]'}`}>
              <span className="w-7 h-7 rounded-lg bg-[var(--surface-2)] grid place-items-center shrink-0 text-[var(--primary-2)]"><NavIcon item={c} size={15} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-[var(--text)] truncate">{navLabel(c, t, lang)}</span>
                {navSubLabel(c, lang) && <span className="block text-xs text-[var(--faint)] truncate">{navSubLabel(c, lang)}</span>}
              </span>
            </NavLink>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

// Mobile hamburger-sheet accordion for a configured "group" — tap the header to
// expand its links inline (no floating panel on a touch surface).
function NavSheetGroup({ item, t, lang, onNavigate }) {
  const [open, setOpen] = useState(false);
  const children = item.children || [];
  return (
    <div className="col-span-2">
      <button type="button" onClick={() => setOpen((o) => !o)} className={sheet({ isActive: false }) + ' w-full text-left'} aria-expanded={open}>
        <NavIcon item={item} size={16} /><span className="flex-1">{navLabel(item, t, lang)}</span><ChevronDown size={15} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="pl-3 mt-0.5 space-y-0.5 border-l border-[var(--line)] ml-3">
          {children.map((c, i) => (
            <NavLink key={c.to + i} to={c.to} className={sheet} onClick={onNavigate}><NavIcon item={c} size={16} />{navLabel(c, t, lang)}</NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

function timeAgo(d, justnow) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return justnow;
  const m = Math.floor(s / 60); if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// Global notifications bell — visible on every page in the topbar when signed in.
// Where a notification takes you when clicked (by kind) — makes the bell actionable
// instead of just informational. Falls back to no navigation for pure-info kinds.
const NOTIF_LINK = {
  submission_approved: '/dashboard', submission_rejected: '/dashboard',
  repo_verified: '/repos', repo_published: '/dashboard?s=repos', repo_rejected: '/dashboard?s=repos',
  repo_access_granted: '/dashboard?s=repos', repo_renew: '/dashboard?s=repos', repo_upgrade: '/dashboard?s=repos',
  repo_review: '/admin?s=moderation',
  hosting_started: '/dashboard?s=repos', hosting_online: '/dashboard?s=repos', hosting_stopped: '/dashboard?s=repos', hosting_expiring: '/dashboard?s=repos',
  feature_active: '/dashboard?s=repos', server_alert: '/admin?s=serverperf',
  creator_linked: '/profile', discord_linked: '/profile',
  kofi_reward: '/dashboard', promo_redeemed: '/dashboard', discount: '/hosting', free_hosting: '/dashboard?s=repos', free_pool: '/dashboard?s=repos', free_boost: '/dashboard?s=repos',
};

function NavNotifications() {
  const { t } = useI18n();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const ref = useRef(null);
  // Locally-read ids (so a 60s poll can't revert an optimistic mark-read) + a persisted
  // "cleared before" timestamp (so Clear is durable — cleared notifs don't come back on
  // the next poll/reload; only newer ones appear).
  const readIds = useRef(new Set());
  const clearedAt = useRef((() => { try { return Number(localStorage.getItem('bcw_notif_cleared')) || 0; } catch { return 0; } })());
  const load = () => api.get('/me/notifications').then((d) => {
    const list = (d.notifications || []).filter((n) => new Date(n.createdAt).getTime() > clearedAt.current);
    setItems(list.map((n) => (readIds.current.has(n.id) && !n.readAt ? { ...n, readAt: new Date().toISOString() } : n)));
  }).catch(() => {});
  useEffect(() => { load(); const id = setInterval(load, 60000); return () => clearInterval(id); }, []);
  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc); return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  const unread = items.filter((n) => !n.readAt).length;
  const markOne = async (n) => { if (n.readAt) return; readIds.current.add(n.id); setItems((s) => s.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x))); try { await api.post(`/me/notifications/${n.id}/read`); } catch {} };
  // Click = mark read + go to the relevant page (if the kind maps to one).
  const openNotif = (n) => { markOne(n); const to = NOTIF_LINK[n.kind]; if (to) { setOpen(false); nav(to); } };
  const markAll = async () => { items.forEach((x) => readIds.current.add(x.id)); setItems((s) => s.map((x) => ({ ...x, readAt: x.readAt || new Date().toISOString() }))); try { await api.post('/me/notifications/read-all'); } catch {} };
  const del = async (n) => { setItems((s) => s.filter((x) => x.id !== n.id)); try { await api.del(`/me/notifications/${n.id}`); } catch {} };
  // Durable menu dismiss: remember "everything up to now is cleared" so the poll/reload
  // won't bring them back (only genuinely newer notifications will). The dashboard's
  // "delete everything" action.
  const clearMenu = () => { clearedAt.current = Date.now(); try { localStorage.setItem('bcw_notif_cleared', String(clearedAt.current)); } catch {} setItems([]); };
  return (
    <div className="relative" ref={ref}>
      <button className="nav-link !px-2 relative" onClick={() => { setOpen((o) => !o); if (!open) load(); }} title={t('nav.notifications')} aria-label={t('nav.notifications')}>
        <Bell size={16} />
        {unread > 0 && <span className="absolute top-0.5 right-0.5 min-w-[15px] h-[15px] px-1 rounded-full bg-[var(--primary)] text-white text-[9px] font-bold grid place-items-center">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="fixed left-2 right-2 top-16 w-auto sm:absolute sm:left-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-[21rem] flex flex-col max-h-[26rem] rounded-xl border border-[var(--line-strong)] z-[60] anim-fade overflow-hidden"
          style={{ background: 'var(--bg-solid)', boxShadow: '0 20px 60px -12px rgba(0,0,0,0.55), 0 0 0 1px var(--line)' }}>
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--line)] shrink-0" style={{ background: 'var(--bg-solid)' }}>
            <span className="text-sm font-semibold flex items-center gap-1.5"><Bell size={14} className="text-[var(--primary-2)]" /> {t('nav.notifications')}{unread > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--primary)] text-white">{unread}</span>}</span>
            <span className="flex items-center gap-2.5 shrink-0">
              {unread > 0 && <button className="text-xs text-[var(--primary-2)] hover:underline flex items-center gap-1" onClick={markAll}><CheckCheck size={12} /> {t('notif.markall')}</button>}
              {items.length > 0 && <button className="text-xs text-[var(--faint)] hover:text-[var(--text)] hover:underline flex items-center gap-1" onClick={clearMenu} title={t('notif.clearmenu.hint')}><X size={12} /> {t('notif.clear')}</button>}
            </span>
          </div>
          <div className="overflow-y-auto flex-1 min-h-0">
          {items.length ? items.slice(0, 30).map((n) => { const m = NOTIF[n.kind] || NOTIF_FALLBACK; return (
            <div key={n.id} className={`group w-full px-3 py-2.5 border-b border-[var(--line)] hover:bg-[var(--surface-2)] flex gap-2.5 items-start ${n.readAt ? '' : 'bg-orange-500/5'}`}>
              <button onClick={() => openNotif(n)} className={`flex gap-2.5 items-start text-left min-w-0 flex-1 ${NOTIF_LINK[n.kind] ? 'cursor-pointer' : ''}`}>
                <span className={`grid place-items-center w-7 h-7 rounded-lg shrink-0 mt-0.5 ${m.tint}`}><m.icon size={13} className={m.tone} /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className={`text-[9px] font-semibold uppercase tracking-wider ${m.tone}`}>{m.label}</span>
                    {!n.readAt && <span className="w-1.5 h-1.5 rounded-full bg-[var(--primary)] shrink-0" />}
                  </span>
                  <span className="text-sm text-[var(--text)] block leading-snug break-words [overflow-wrap:anywhere]">{n.body}</span>
                  <span className="text-[11px] text-[var(--faint)]">{timeAgo(n.createdAt, t('notif.justnow'))}</span>
                </span>
              </button>
              <button onClick={() => del(n)} title="Delete" className="shrink-0 text-[var(--faint)] hover:text-red-400 opacity-0 group-hover:opacity-100 transition mt-0.5"><Trash2 size={13} /></button>
            </div>
          ); }) : <div className="px-3 py-8 text-center text-sm text-[var(--muted)]">{t('notif.none')}</div>}
          </div>
          <Link to="/dashboard?s=overview" onClick={() => setOpen(false)} className="block text-center text-xs text-[var(--muted)] hover:text-[var(--text)] py-2 border-t border-[var(--line)] shrink-0" style={{ background: 'var(--bg-solid)' }}>{t('notif.open')}</Link>
        </div>
      )}
    </div>
  );
}

// Primary destinations for the mobile bottom tab bar.
const BOTTOM = [
  { to: '/', k: 'nav.home', icon: HomeIcon, exact: true },
  { to: '/p/bmm', k: 'nav.bmm', icon: Boxes, img: '/icons/bmm.png' },
  { to: '/p/bsm', k: 'nav.bsm', icon: Music2, img: '/icons/bsm.png' },
  { to: '/hosting', k: 'nav.hosting', icon: Rocket },
];

function Nav() {
  const { user, logout } = useAuth();
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const segNavRef = useRef(null);
  const neededRef = useRef(0);                     // seg-nav width needed WITH labels
  const [compact, setCompact] = useState(false);   // icons-only (pills + Dashboard/Admin) when tight
  // Which fixed-project pills the CURRENT visitor can actually view (per-key
  // visibility, computed server-side) + any showcase projects an admin pinned
  // to the topbar (task: Project Announcement pages / visibility system).
  const [projVisible, setProjVisible] = useState(null); // { bmm: true, bsm: false, ... } | null (not loaded yet -> show all)
  const [pinnedShowcase, setPinnedShowcase] = useState([]);
  const navCfg = useNavConfig(); // admin-configured nav (null -> use hardcoded NAV), shared with the bottom bar
  useEffect(() => {
    api.get('/projects').then((r) => setProjVisible(r.visible || null)).catch(() => {});
    api.get('/showcase').then((r) => setPinnedShowcase((r.projects || []).filter((p) => p.pinTopbar))).catch(() => {});
  }, []);
  // Per-project visibility still applies to any nav link that points at a project page,
  // whether it comes from the hardcoded NAV or an admin's custom config.
  const gateTo = (to) => { const m = /^\/p\/([^/]+)/.exec(to || ''); return !m || !projVisible || projVisible[m[1]] !== false; };
  // Effective top-level items: the admin config when present, else the built-in NAV
  // (adapted to the same shape). Groups drop children the visitor can't see, and a
  // group with no visible children (or a hidden link) disappears entirely.
  const rawItems = (navCfg?.items?.length)
    ? navCfg.items
    : DEFAULT_ITEMS;
  const effItems = rawItems
    .map((it) => it.type === 'group' ? { ...it, children: (it.children || []).filter((c) => gateTo(c.to)) } : it)
    .filter((it) => it.type === 'group' ? it.children.length > 0 : gateTo(it.to));
  // Admin-pinned showcase projects: shown as their own inline pills (default) or grouped
  // under a single "Projects" hover-dropdown when the admin chose projectsMode:'dropdown'.
  // Each keeps its own icon. Visitor-gated project links already filtered upstream.
  const projectsDropdown = navCfg?.projectsMode === 'dropdown' && pinnedShowcase.length > 0;
  const projectsGroup = projectsDropdown ? {
    type: 'group', k: 'nav.projects', icon: Boxes,
    children: pinnedShowcase.map((p) => ({
      to: `/project/${p.slug}`,
      label: p.isAnnouncing ? (p.announceTitle || p.name) : p.name,
      ...showcaseChildIcon(p.icon),
    })),
  } : null;
  // Now that the segmented nav scrolls horizontally when it doesn't all fit, keep
  // the current page's pill actually in view instead of possibly scrolled off.
  // scrollIntoView() was unreliable here (this row sits in a `position:sticky`
  // header, which makes browsers skip/misjudge the scroll) — compute it by hand.
  // A single rAF fired too early on first mount (icons/fonts not painted yet, so
  // scrollWidth wasn't final) — a short timeout gives layout a moment to settle.
  useEffect(() => {
    const id = setTimeout(() => {
      const nav = segNavRef.current;
      const active = nav?.querySelector('a[aria-current="page"]');
      if (!nav || !active) return;
      // getBoundingClientRect (not offsetLeft) so this is correct regardless of
      // which ancestor ends up being the positioned offsetParent.
      const navBox = nav.getBoundingClientRect(); const activeBox = active.getBoundingClientRect();
      const activeLeft = activeBox.left - navBox.left + nav.scrollLeft;
      const activeRight = activeLeft + activeBox.width;
      if (activeLeft < nav.scrollLeft) nav.scrollLeft = activeLeft;
      else if (activeRight > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = activeRight - nav.clientWidth;
    }, 60);
    return () => clearTimeout(id);
  }, [loc.pathname]);
  // Pill labels show only when the WHOLE labeled row fits the seg-nav's box — so a
  // label is never half-clipped, and they DO appear the moment there's room. No
  // hysteresis and no coupling to the Dashboard/Admin labels: those are on their own
  // fixed breakpoint (xl:inline), so toggling the pills can't change the seg-nav's
  // box width and there's nothing to oscillate against. `neededRef` caches the
  // labeled width (measured only while labels show) so the icon-only scrollWidth
  // never fools the "does it fit?" test. Under 1250px it's always icons-only.
  useLayoutEffect(() => {
    const el = segNavRef.current;
    if (!el) return;
    const measure = () => {
      if (window.innerWidth < 1250) { setCompact(true); return; }
      if (!el.classList.contains('is-compact')) neededRef.current = el.scrollWidth;
      const need = neededRef.current || el.scrollWidth;
      setCompact(el.clientWidth < need - 2); // -2 for sub-pixel rounding
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [lang, effItems.length, pinnedShowcase.length, !!user, (user && (user.role === 'ADMIN' || user.role === 'MOD' || user.role === 'SUPERADMIN'))]);
  // ── Configurable topbar utility elements ──────────────────────────────────────
  // Admins can show/hide and reorder the built-in buttons (per nav.config.utility),
  // WITHIN their responsive cluster so the layout can't break: cluster A is always
  // visible (notifications · projects · lang · theme · settings), cluster B is the
  // lg+ account cluster (dashboard · admin · profile · logout / login). Each element
  // still has a hard precondition (auth, admin) that the config can only further hide.
  const uCfg = navCfg?.utility || {};
  // Admin-configured desktop layout (align · density · labels), via the shared reader the
  // preview also uses. labels:'icons' reuses the existing responsive icons-only mode by
  // FORCING is-compact regardless of width; density:'compact' tightens the pill gap.
  const layout = readLayout(navCfg?.layout);
  const iconsOnly = layout.labels === 'icons';
  const uVisible = (k) => uCfg[k]?.visible !== false; // default: shown
  const orderIn = (list) => [...list].sort((a, b) => (uCfg[a]?.order ?? list.indexOf(a)) - (uCfg[b]?.order ?? list.indexOf(b)));
  const clusterA = orderIn(UTIL_A);
  const clusterB = orderIn(UTIL_B);
  // The auth/staff precondition is applied once, from the shared rule the Live preview
  // also uses — never re-tested per case below.
  const utilNode = (k) => {
    if (!utilAllowed(k, user)) return null;
    switch (k) {
      case 'notifications': return <NavNotifications key="u-notif" />;
      case 'projects': return <NavLink key="u-proj" to="/projects" className={({ isActive }) => `hidden sm:inline-flex nav-link !px-2 ${isActive ? 'nav-link-active' : ''}`} title={t('nav.projects')} aria-label={t('nav.projects')}><Boxes size={16} /></NavLink>;
      case 'lang': return <LangToggle key="u-lang" />;
      case 'theme': return <ThemeToggle key="u-theme" />;
      case 'settings': return <NavLink key="u-set" to="/settings" className={({ isActive }) => `nav-link !px-2 ${isActive ? 'nav-link-active' : ''}`} title={t('nav.settings', 'Settings')} aria-label="Settings"><SettingsIcon size={16} /></NavLink>;
      case 'dashboard': return <NavLink key="u-dash" to="/dashboard" className={(s) => pill(s) + ' !py-2 !px-2.5'} title={t('nav.dashboard')} aria-label={t('nav.dashboard')}><LayoutDashboard size={15} /></NavLink>;
      case 'admin': return <NavLink key="u-adm" to="/admin" className={(s) => pill(s) + ' !py-2 !px-2.5'} title={t('nav.admin')} aria-label={t('nav.admin')}><Shield size={15} /></NavLink>;
      case 'profile': return <Link key="u-prof" to="/profile" className="rounded-full p-0.5 hover:ring-2 hover:ring-[var(--line-strong)] transition" title={user.displayName}><Avatar user={user} size={28} /></Link>;
      case 'logout': return <Button key="u-out" variant="ghost" size="sm" onClick={logout} title={t('nav.signout')}><LogOut size={15} /></Button>;
      case 'login': return <Link key="u-login" to="/auth"><Button variant="primary" size="sm" className="whitespace-nowrap rounded-full">{t('nav.signin')}</Button></Link>;
      default: return null;
    }
  };
  const renderUtil = (k) => (uVisible(k) ? utilNode(k) : null);
  return (
    <header className="sticky top-0 z-40 px-2 sm:px-3 pt-2 sm:pt-3">
      <div className="max-w-7xl mx-auto rounded-2xl border border-[var(--line)] px-2.5 sm:px-3 h-14 flex items-center gap-1 flex-nowrap topbar"
        style={{ boxShadow: '0 10px 34px -14px rgba(0,0,0,0.30)' }}>
        <Link to="/" className="flex items-center gap-2 font-extrabold text-[15px] mr-1 shrink-0" onClick={() => setOpen(false)}>
          <img src="/logo.png" alt="BC" className="w-8 h-8 rounded-xl" />
          <span className="text-[var(--text)] hidden sm:inline">BetterCommunity</span>
        </Link>
        {/* desktop segmented nav — icons-only when tight, icons+labels at xl+.
            Shown from `lg:` up (not `md:`) so it never has to compete for room
            with the dashboard/admin/profile cluster below at in-between widths —
            that's what caused the overlapping/cut-off "buggy" look around
            700-950px. Below `lg:` everything lives in the hamburger sheet instead. */}
        {/* Outer flex-1 track = the room the nav may use (drives the fit measurement +
            horizontal scroll). The rounded background lives on the INNER nav which is
            content-width, so the pill bar ends right after the last tab instead of
            stretching the whole width. */}
        <div ref={segNavRef} className={`seg-nav ${compact || iconsOnly ? 'is-compact' : ''} hidden lg:flex flex-1 min-w-0 overflow-x-auto no-scrollbar ${navAlignClass(layout.align)}`}>
          <nav className={`inline-flex items-center rounded-full bg-[var(--surface-2)] p-1 border border-[var(--line)] shrink-0 ${layout.density === 'compact' ? 'gap-0' : 'gap-0.5'}`}>
            {effItems.map((it, i) => it.type === 'group'
              ? <NavDropdown key={'g' + i} item={it} t={t} lang={lang} />
              : <NavLink key={it.to} to={it.to} title={navLabel(it, t, lang)} aria-label={navLabel(it, t, lang)} className={(s) => pill(s) + ' shrink-0'}><NavIcon item={it} size={16} /><span className="nav-lbl">{navLabel(it, t, lang)}</span></NavLink>)}
            {projectsDropdown
              ? <NavDropdown key="proj-dd" item={projectsGroup} t={t} lang={lang} />
              : pinnedShowcase.map((p) => (
                <NavLink key={p.slug} to={`/project/${p.slug}`} title={p.name} aria-label={p.name} className={(s) => pill(s) + ' shrink-0'}>
                  <ShowcaseIcon icon={p.icon} size={15} fallback={<Sparkles size={15} />} /><span className="nav-lbl">{p.isAnnouncing ? p.announceTitle || p.name : p.name}</span>
                </NavLink>
              ))}
          </nav>
        </div>
        {/* Below lg the segmented nav is hidden, so this spacer takes the slack and
            pushes the whole right cluster to the right edge (was left-glued). */}
        <div className="flex-1 min-w-[8px] lg:flex-none lg:w-2 shrink-0" />
        {/* Right cluster A — always visible, admin-configurable order/visibility. */}
        <div className="flex items-center gap-0.5 shrink-0">
          {clusterA.map(renderUtil)}
        </div>
        {/* Right cluster B — lg+ account cluster, admin-configurable order/visibility. */}
        <div className="hidden lg:flex items-center gap-1 shrink-0 pl-1 ml-1 border-l border-[var(--line)]">
          {clusterB.map(renderUtil)}
        </div>
        {/* below lg: profile/sign-in shortcut + menu (the hamburger sheet already
            has nav links + dashboard/admin/profile/logout, so nothing is lost). */}
        <div className="lg:hidden flex items-center gap-1 shrink-0">
          {user ? <Link to="/profile" onClick={() => setOpen(false)}><Avatar user={user} size={28} /></Link>
            : <Link to="/auth"><Button variant="primary" size="sm" className="rounded-full">{t('nav.signin')}</Button></Link>}
          <button className="nav-link !px-2 shrink-0" onClick={() => setOpen((v) => !v)} aria-label="Menu">{open ? <X size={20} /> : <Menu size={20} />}</button>
        </div>
      </div>

      {/* full menu sheet (below lg:) */}
      {open && (
        <div className="lg:hidden mt-2 mx-2 sm:mx-3 rounded-2xl border border-[var(--line)] p-2 topbar anim-fade" style={{ boxShadow: '0 10px 34px -14px rgba(0,0,0,0.30)' }}>
          <div className="grid grid-cols-2 gap-1">
            {effItems.map((it, i) => it.type === 'group'
              ? <NavSheetGroup key={'g' + i} item={it} t={t} lang={lang} onNavigate={() => setOpen(false)} />
              : <NavLink key={it.to} to={it.to} className={sheet} onClick={() => setOpen(false)}><NavIcon item={it} size={16} />{navLabel(it, t, lang)}</NavLink>)}
            {projectsDropdown
              ? <NavSheetGroup key="proj-dd" item={projectsGroup} t={t} lang={lang} onNavigate={() => setOpen(false)} />
              : pinnedShowcase.map((p) => <NavLink key={p.slug} to={`/project/${p.slug}`} className={sheet} onClick={() => setOpen(false)}><ShowcaseIcon icon={p.icon} size={16} fallback={<Sparkles size={16} />} />{p.isAnnouncing ? p.announceTitle || p.name : p.name}</NavLink>)}
            {uVisible('projects') && <NavLink to="/projects" className={sheet} onClick={() => setOpen(false)}><Boxes size={16} /> {t('nav.projects')}</NavLink>}
            <NavLink to="/contact" className={sheet} onClick={() => setOpen(false)}><Mail size={16} /> Contact</NavLink>
            {uVisible('settings') && <NavLink to="/settings" className={sheet} onClick={() => setOpen(false)}><SettingsIcon size={16} /> {t('nav.settings', 'Settings')}</NavLink>}
          </div>
          <div className="h-px bg-[var(--line)] my-2" />
          <div className="grid grid-cols-2 gap-1">
            {user ? (<>
              {uVisible('dashboard') && <NavLink to="/dashboard" className={sheet} onClick={() => setOpen(false)}><LayoutDashboard size={16} />{t("nav.dashboard")}</NavLink>}
              {uVisible('admin') && canAdmin(user) && <NavLink to="/admin" className={sheet} onClick={() => setOpen(false)}><Shield size={16} />{t("nav.admin")}</NavLink>}
              {uVisible('profile') && <NavLink to="/profile" className={sheet} onClick={() => setOpen(false)}><Avatar user={user} size={18} /> Profile</NavLink>}
              {uVisible('logout') && <button className={sheet({ isActive: false }) + ' text-left'} onClick={() => { logout(); setOpen(false); }}><LogOut size={16} />{t("nav.signout")}</button>}
            </>) : <Link to="/auth" className="col-span-2" onClick={() => setOpen(false)}><Button variant="primary" className="w-full">{t("nav.signin")}</Button></Link>}
          </div>
        </div>
      )}
      {/* Lives inside the same sticky header, so it rides along under the topbar
          pill instead of scrolling away with the page content underneath it. */}
      <AnnouncementBanner />
    </header>
  );
}

// App-style bottom tab bar (mobile only). Labels collapse while actively scrolling
// and slide back in when the user stops — a clean, contextual reveal.
function MobileTabBar() {
  const { t, lang } = useI18n();
  const navCfg = useNavConfig();
  const [showLabels, setShowLabels] = useState(true);
  useEffect(() => {
    let tmr;
    const onScroll = () => { setShowLabels(false); clearTimeout(tmr); tmr = setTimeout(() => setShowLabels(true), 220); };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); clearTimeout(tmr); };
  }, []);
  // Off when the admin disabled it. Otherwise it mirrors the configured nav items (home +
  // the leading links) when a custom nav exists, else the default app-shortcut bar.
  if (navCfg?.downbar?.enabled === false) return null;
  const items = navCfg?.items?.length ? deriveDownbar(navCfg.items) : BOTTOM;
  const label = (n) => (n.k ? t(n.k) : navLabel(n, t, lang));
  const tab = ({ isActive }) => `flex-1 flex flex-col items-center justify-center py-1.5 ${isActive ? 'text-[var(--primary)]' : 'text-[var(--muted)]'}`;
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-[var(--line)] topbar flex items-stretch px-1" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {items.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.exact} className={tab} title={label(n)} aria-label={label(n)}>
          {({ isActive }) => <>
            <span className={`grid place-items-center w-9 h-7 rounded-full transition ${isActive ? 'bg-[var(--surface-2)]' : ''}`}><NavIcon item={n} size={18} /></span>
            <span className={`text-[10px] leading-none overflow-hidden transition-all duration-200 ${showLabels ? 'max-h-4 opacity-100 mt-0.5' : 'max-h-0 opacity-0 mt-0'}`}>{label(n)}</span>
          </>}
        </NavLink>
      ))}
    </nav>
  );
}

const SOCIAL = [
  { Icon: GithubIcon, href: 'https://github.com/FreeProject089', label: 'GitHub' },
  { Icon: DiscordIcon, href: 'https://discord.com/invite/CTaaEF9R75', label: 'Discord' },
  { Icon: RedditIcon, href: 'https://www.reddit.com/r/BetterModManager/', label: 'Reddit' },
  { Icon: KofiIcon, href: KOFI, label: 'Ko-fi', kofi: true },
];
// A footer link column. On desktop it's always expanded; on phone the title becomes
// a collapsible accordion header (collapsed by default).
// Admin-configured footer, fetched once and cached in a module promise like the nav config.
// Null means "not configured" — the built-in footer below is then used unchanged, so this is
// purely additive and a broken/absent config can never leave the page without a footer.
let _footCfgPromise = null;
function useFooterConfig() {
  const [cfg, setCfg] = useState(null);
  useEffect(() => {
    _footCfgPromise = _footCfgPromise || api.get('/footer').then((r) => r.footer || null).catch(() => null);
    let alive = true;
    _footCfgPromise.then((v) => { if (alive) setCfg(v); });
    return () => { alive = false; };
  }, []);
  return cfg;
}
// `on` is per link and per column: a phone genuinely wants fewer footer links than a desktop,
// and hiding them with CSS would still ship them to the DOM and to screen readers.
const showsOn = (item, mobile) => {
  const v = item?.on || 'both';
  return v === 'both' || (mobile ? v === 'mobile' : v === 'desktop');
};

function FooterCol({ title, links }) {
  const [open, setOpen] = useState(false);
  const render = ([l, to, ext]) => ext
    ? <a key={l} href={to} target="_blank" rel="noreferrer" className="text-sm text-[var(--muted)] hover:text-[var(--primary-2)] transition w-fit">{l}</a>
    : <Link key={l} to={to} className="text-sm text-[var(--muted)] hover:text-[var(--primary-2)] transition w-fit">{l}</Link>;
  return (
    <div className="border-b border-[var(--line)] md:border-0">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between py-3.5 md:py-0 md:mb-3 md:cursor-default text-left">
        <span className="text-xs font-semibold text-[var(--faint)] uppercase tracking-wider">{title}</span>
        <ChevronDown size={15} className={`md:hidden text-[var(--faint)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <div className={`flex-col gap-2.5 pb-4 md:pb-0 md:flex ${open ? 'flex' : 'hidden'}`}>{links.map(render)}</div>
    </div>
  );
}
// Compact newsletter signup for the footer — mobile-clean (input + button stack /
// stay side-by-side with min-w-0). Shows a success toast on subscribe (#5).
function FooterNewsletter() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim() || busy) return;
    setBusy(true);
    try {
      await api.post('/newsletter/subscribe', { email: email.trim(), locale: lang === 'fr' ? 'fr' : 'en' });
      toast.success(t('news.check', 'Almost there — check your inbox to confirm your subscription.'));
      setEmail('');
    } catch { toast.error(t('news.err', 'Could not subscribe — check the address and try again.')); }
    finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="mt-6 max-w-xs">
      <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-2">{t('news.foot', 'Newsletter')}</div>
      <div className="flex gap-2">
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('news.ph', 'you@example.com')}
          className="flex-1 min-w-0 rounded-lg border border-[var(--line)] bg-[var(--bg-solid)] px-3 py-2 text-sm outline-none focus:border-[var(--primary)]" />
        <button type="submit" disabled={busy} className="shrink-0 rounded-lg bg-[var(--primary)] text-white px-3.5 py-2 text-sm font-semibold hover:brightness-110 disabled:opacity-50 transition">{busy ? '…' : t('news.cta', 'Subscribe')}</button>
      </div>
    </form>
  );
}

// The "Built for the Better* community" tagline is a secret: click it 5× to reveal a
// modal with an admin-customisable message, which grants a hidden footer badge (if a
// badge with grant=easter_egg + trigger="footer5x" exists and you're signed in).
function FooterEgg() {
  const { t } = useI18n(); const toast = useToast();
  const { user } = useAuth();
  const [clicks, setClicks] = useState(0);
  const [open, setOpen] = useState(false);
  const [badge, setBadge] = useState(null); // { name, icon, iconType, color, message }
  const [claimed, setClaimed] = useState(false);
  const timer = useRef(null);
  const onClick = async () => {
    const n = clicks + 1; setClicks(n);
    clearTimeout(timer.current); timer.current = setTimeout(() => setClicks(0), 1200); // must be quick taps
    if (n >= 5) {
      setClicks(0);
      try { const r = await api.get('/badges/trigger/footer5x'); if (r.badge) { setBadge(r.badge); setOpen(true); } }
      catch { /* no easter-egg badge configured — stay silent */ }
    }
  };
  const claim = async () => {
    try { const r = await api.post('/me/badges/claim', { trigger: 'footer5x' }); setClaimed(true); toast.success(r.alreadyHad ? t('egg.already', 'You already have this badge.') : t('egg.granted', 'Badge unlocked! 🎉')); }
    catch { toast.error(t('egg.failed', 'Could not claim right now.')); }
  };
  return (
    <>
      <button onClick={onClick} className="flex items-center gap-1.5 hover:text-[var(--muted)] transition select-none" title="✨">
        <Sparkles size={12} className="text-[var(--primary-2)]" /> Built for the Better* community
      </button>
      {open && badge && <Modal open onClose={() => setOpen(false)} title={badge.name || t('egg.title', 'You found a secret!')}
        icon={undefined} width="max-w-sm">
        <div className="text-center py-2">
          <div className="w-16 h-16 rounded-2xl grid place-items-center mx-auto mb-3" style={{ background: `color-mix(in srgb, ${badge.color || 'var(--primary)'} 16%, transparent)` }}>
            <BadgeIcon badge={badge} size={34} />
          </div>
          <p className="text-sm text-[var(--muted)] whitespace-pre-wrap break-words">{badge.message || t('egg.default', 'Thanks for being curious. Here\'s a little something.')}</p>
          <div className="mt-4">
            {!user ? <p className="text-xs text-[var(--faint)]">{t('egg.signin', 'Sign in to keep this badge on your profile.')}</p>
              : claimed ? <p className="text-sm font-medium text-[var(--primary-2)] flex items-center justify-center gap-1.5"><CheckCircle2 size={15} /> {t('egg.done', 'Added to your profile.')}</p>
              : <Button variant="primary" onClick={claim}>{t('egg.claim', 'Claim badge')}</Button>}
          </div>
        </div>
      </Modal>}
    </>
  );
}

function Footer() {
  const { t, lang } = useI18n();
  const cfg = useFooterConfig();
  // Which device is on screen. The `on` filter REMOVES links rather than hiding them, so it
  // has to be decided in JS: a CSS-hidden link is still in the DOM and still announced by a
  // screen reader, which is not what "hide this on mobile" means.
  const [isMobile, setIsMobile] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(max-width: 767px)').matches);
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const mq = matchMedia('(max-width: 767px)');
    const on = (e) => setIsMobile(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const frOr = (v, base) => (lang === 'fr' && v && v.trim()) ? v : base;
  // Configured columns, filtered for this device. Empty → the built-in columns below stand.
  const cols = (cfg?.columns || [])
    .filter((c) => showsOn(c, isMobile))
    .map((c) => ({
      title: frOr(c.titleFr, c.title),
      links: (c.links || []).filter((l) => showsOn(l, isMobile))
        .map((l) => [frOr(l.labelFr, l.label), l.to, /^https?:\/\//i.test(l.to)]),
    }))
    .filter((c) => c.links.length);
  return (
    <footer className="mt-16 md:mt-24 relative clear-both">
      {/* gradient accent line */}
      <div className="h-px bg-gradient-to-r from-transparent via-[var(--primary)]/40 to-transparent" />
      <div className="max-w-6xl mx-auto px-4 py-14 flex flex-col md:grid md:gap-10"
        style={{ gridTemplateColumns: `1.4fr repeat(${cols.length || 3}, 1fr)` }}>
        {/* brand block */}
        <div className="mb-4 md:mb-0">
          <div className="flex items-center gap-2.5 font-extrabold text-lg"><img src="/logo.png" alt="BC" className="w-9 h-9 rounded-xl" /> BetterCommunity</div>
          <p className="text-sm text-[var(--muted)] mt-3 max-w-xs leading-relaxed">{frOr(cfg?.brand?.taglineFr, cfg?.brand?.tagline) || t('foot.tagline')}</p>
          <div className={`items-center gap-2 mt-5 ${cfg && cfg.brand?.socials === false ? 'hidden' : 'flex'}`}>
            {SOCIAL.map((s) => (
              <a key={s.label} href={s.href} target="_blank" rel="noreferrer" title={s.label}
                className="grid place-items-center w-9 h-9 rounded-xl border border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--line-strong)] hover:bg-[var(--surface-2)] transition">
                <s.Icon size={16} className={s.kofi ? 'text-orange-400' : ''} />
              </a>
            ))}
          </div>
          {(!cfg || cfg.brand?.newsletter !== false) && <FooterNewsletter />}
        </div>
        {cols.length
          ? cols.map((c) => <FooterCol key={c.title} title={c.title} links={c.links} />)
          : <>
        <FooterCol title={t('foot.products')} links={[['BetterModsManager', '/p/bmm'], ['BetterSoundMaker', '/p/bsm'], ['BetterInstaller', '/p/installer'], [t('nav.hosting'), '/hosting'], [t('myo.badge', 'Make Your Own'), '/myo']]} />
        <FooterCol title={t('foot.community')} links={[[t('foot.about', 'About'), '/legal/about'], ['Blog', '/blog'], [t('nav.docs', 'Docs'), '/docs'], [t('faq.title', 'FAQ'), '/faq'], [t('nav.repos'), '/repos'], [t('foot.members', 'Members'), '/users'], [t('tfa.short', 'Authenticator (2FA)'), '/2fa'], ['Contact', '/contact'], [t('foot.kofi'), KOFI, true]]} />
        <FooterCol title={t('foot.legal')} links={[[t('legal.all', 'All'), '/legal'], [t('foot.privacy'), '/legal/privacy'], [t('foot.terms'), '/legal/terms'], [t('foot.cookies'), '/legal/cookies'], [t('foot.refunds', 'Payments & Refunds'), '/legal/refunds']]} />
          </>}
      </div>
      <div className="border-t border-[var(--line)]"><div className="max-w-6xl mx-auto px-4 py-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 text-xs text-[var(--faint)] pb-24 md:pb-5">
        <span>© {new Date().getFullYear()} BetterCommunity. {t('foot.rights')}</span>
        <div className="flex items-center gap-4 flex-wrap">
          <LangSelect />
          <FooterEgg />
        </div>
      </div></div>
    </footer>
  );
}

// canAdmin / ADMIN_TIER_ROLES now live in lib/roles.js — the admin's topbar Live preview
// has to apply the same rules, and keeping a second copy here is what let the two drift.
// (May this user reach the admin dashboard at all? True for the staff roles, and also for
// a plain user granted at least one capability — the dashboard then shows only what their
// capabilities unlock. The API enforces each action via requireCap(), so this only governs
// surface visibility.)

function Protected({ children, role }) {
  const { t } = useI18n();
  const { user, loading } = useAuth();
  if (loading) return <div className="max-w-6xl mx-auto p-8 text-[var(--muted)]">Loading…</div>;
  if (!user) return <Navigate to="/auth" replace />;
  // SUPERADMIN implicitly satisfies every route role-gate — same reasoning as the
  // backend's requireRole() — instead of retrofitting every <Protected role={...}> call site.
  // A capability-granted user is also admitted to a role-gated surface (the dashboard hides
  // what they can't touch); the backend still gates each action with requireCap().
  // Bypass the specific role list for cross-cutting access: SUPERADMIN, anyone holding a
  // capability (individually OR via a custom role — effectiveCaps), or a per-project
  // grantee. NOT plain MOD/ADMIN — those still match against `role` directly.
  const elevated = user.role === 'SUPERADMIN' || effectiveCaps(user).length > 0 || hasProjectGrant(user);
  if (role && !elevated && !role.includes(user.role)) return <Navigate to="/" replace />;
  // The admin dashboard (and everything it talks to — the API enforces this too,
  // in requireRole()/requireCap()) requires 2FA, whatever the exact role or grant — a
  // password alone isn't enough for a surface this privileged.
  if (role && canAdmin(user) && !user.totpEnabled) {
    return (
      <div className="max-w-sm mx-auto py-16">
        <div className="card p-6 text-center">
          <div className="w-12 h-12 rounded-2xl bg-orange-500/10 border border-[var(--line)] grid place-items-center mx-auto mb-3"><ShieldCheck size={22} className="text-[var(--primary-2)]" /></div>
          <h1 className="text-lg font-semibold">{t('admin.2fa.title', 'Two-factor authentication required')}</h1>
          <p className="text-sm text-[var(--muted)] mt-1 mb-4">{t('admin.2fa.sub', 'The admin dashboard requires 2FA on your account, even for admins. Enable it in your profile to continue.')}</p>
          <Link to="/profile"><Button variant="primary" className="w-full">{t('admin.2fa.cta', 'Go to profile')}</Button></Link>
        </div>
      </div>
    );
  }
  return children;
}

const TITLES = { '/': 'Home', '/catalog': 'Catalog', '/submit': 'Submit', '/blog': 'Blog', '/docs': 'Docs', '/faq': 'FAQ', '/repos': 'Server Repos', '/hosting': 'Hosting', '/projects': 'Projects', '/contact': 'Contact', '/auth': 'Sign in', '/profile': 'Profile', '/dashboard': 'Dashboard', '/admin': 'Admin', '/settings': 'Settings', '/2fa': 'Authenticator', '/legal': 'Legal', '/legal/about': 'About', '/legal/privacy': 'Privacy', '/legal/terms': 'Terms', '/legal/cookies': 'Cookies', '/legal/refunds': 'Payments & Refunds' };

// Site-wide banner(s) for active admin announcements. Dismissal is per-announcement
// (by id) and persisted in localStorage, so re-dismissing after a page reload isn't
// needed but a NEW announcement still shows even if an old one was dismissed.
const DISMISSED_KEY = 'bcw_dismissed_announcements';
function AnnouncementBanner() {
  const [announcements, setAnnouncements] = useState([]);
  const [dismissed, setDismissed] = useState(() => { try { return JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]'); } catch { return []; } });
  useEffect(() => { api.get('/announcements').then((r) => setAnnouncements(r.announcements || [])).catch(() => {}); }, []);
  const dismiss = (id) => {
    const next = [...dismissed, id];
    setDismissed(next);
    try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(next)); } catch {}
  };
  const visible = announcements.filter((a) => !dismissed.includes(a.id));
  if (!visible.length) return null;
  const TONE = { info: 'bg-orange-500/10 border-orange-500/25 text-[var(--text)]', warning: 'bg-amber-500/10 border-amber-500/30 text-amber-400', success: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' };
  const TONE_ICON = { info: Info, warning: AlertTriangle, success: CheckCircle2 };
  return (
    <div className="max-w-7xl mx-auto px-2 sm:px-3 pt-2 space-y-2">
      {visible.map((a) => {
        const isExternal = /^https?:\/\//i.test(a.linkUrl || '');
        const clickable = !!a.linkUrl;
        const Wrapper = isExternal ? 'a' : clickable ? Link : 'div';
        const wrapperProps = isExternal
          ? { href: a.linkUrl, target: '_blank', rel: 'noopener noreferrer' }
          : clickable ? { to: a.linkUrl } : {};
        const TIcon = TONE_ICON[a.tone] || Info;
        return (
          <Wrapper key={a.id} {...wrapperProps}
            className={`rounded-xl border px-3.5 sm:px-4 py-3 flex items-start gap-2.5 sm:gap-3 ${TONE[a.tone] || TONE.info} ${clickable ? 'hover:brightness-95 transition cursor-pointer' : ''}`}>
            <TIcon size={16} className="shrink-0 mt-0.5" />
            {/* Stacked title/body (not a single dash-joined line) so it reads cleanly
                on a phone-width screen instead of getting cramped or truncated. */}
            <div className="flex-1 min-w-0">
              <div className="font-semibold leading-snug break-words">{a.title}</div>
              {a.body && <div className="text-[var(--muted)] text-sm mt-0.5 leading-snug break-words">{a.body}</div>}
            </div>
            {clickable && <ArrowUpRight size={15} className="shrink-0 mt-0.5 opacity-70" />}
            <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); dismiss(a.id); }} className="shrink-0 text-[var(--faint)] hover:text-[var(--text)]"><X size={15} /></button>
          </Wrapper>
        );
      })}
    </div>
  );
}

export default function App() {
  const loc = useLocation();
  const toast = useToast();
  const { t } = useI18n();
  useEffect(() => { loadGtmIfConsented(); initVitals(); initInteractions(); initErrors(); }, []);
  // Global "you don't have permission" toast — the api client dispatches bcw:forbidden on
  // any missing_permission 403, so the user is told exactly what they lack no matter which
  // screen triggered it.
  useEffect(() => {
    const onForbidden = (e) => { const cap = e.detail?.capability; toast.error(t('perm.denied', "You don't have permission for this — “{cap}” is required.").replace('{cap}', t('perm.cap.' + cap, cap || 'this action'))); };
    window.addEventListener('bcw:forbidden', onForbidden);
    return () => window.removeEventListener('bcw:forbidden', onForbidden);
    // eslint-disable-next-line
  }, []);
  useEffect(() => { trackPageview(loc.pathname + loc.search); }, [loc.pathname, loc.search]);
  // Optional cinematic route transition — let the hero orb know we navigated so it
  // can shatter + dive into a random shard + recompose. OFF by default (pref read
  // live so toggling in Settings takes effect without a reload). Skips the very
  // first render so it only fires on real navigations, not the initial load.
  const firstNav = useRef(true);
  useEffect(() => {
    if (firstNav.current) { firstNav.current = false; return; }
    if (getOrbTransitionPref()) window.dispatchEvent(new CustomEvent('bcweb:orb-transition'));
  }, [loc.pathname]);

  // Replay the content fade on EVERY navigation.
  //
  // `.anim-fade` is a CSS animation, and a CSS animation runs when the element appears. <main>
  // never unmounts — React keeps the same node and swaps its children — so the fade played
  // once, on the first page load, and never again. Moving between sections looked like it
  // animated only because the whole page content changed at once; moving from /docs/a to
  // /docs/b changes less, and with no animation at all the swap read as a jump.
  //
  // Re-triggered by class rather than by keying <main> on the pathname: a key would remount
  // the entire page subtree on every navigation, which for a same-route param change
  // (/docs/a -> /docs/b) would throw away the Docs component's own state — sidebar, scroll,
  // open categories — on every click in its own sidebar. Reading offsetWidth between the
  // remove and the add is what forces the reflow that makes the browser treat it as a new
  // animation instead of a no-op.
  const mainRef = useRef(null);
  useEffect(() => {
    const el = mainRef.current;
    if (!el || firstNav.current) return;
    el.classList.remove('anim-fade');
    void el.offsetWidth;
    el.classList.add('anim-fade');
  }, [loc.pathname]);
  // Per-route document title (helps SEO + shows in tabs/history).
  useEffect(() => {
    const p = loc.pathname;
    let t = TITLES[p];
    if (!t) {
      if (p.startsWith('/p/')) t = (p.split('/')[2] || '').toUpperCase();
      else if (p.startsWith('/project/') || p.startsWith('/item/') || p.startsWith('/blog/')) t = 'BetterCommunity';
    }
    document.title = t && p !== '/' ? `${t} · BetterCommunity` : 'BetterCommunity — The home for all Better* projects';
  }, [loc.pathname]);
  return (
    <IntroProvider>
      <div className="min-h-screen flex flex-col">
        {/* Keyboard skip link: first focusable element, off-screen until focused, so
            keyboard/screen-reader users can jump straight past the nav to the content. */}
        <a href="#main-content" className="skip-link">{t('a11y.skip', 'Skip to content')}</a>
        <Suspense fallback={null}><Hero3D /></Suspense>
        <AppReveal>
          <PromoBadge />
          <EventEffect />
          <Nav />
          {/* relative z-10: keep the page content (and any in-page overlays like the
              mobile dashboard nav sheet) stacked ABOVE the footer, which follows in the
              DOM and would otherwise paint over an open dropdown on short pages. */}
          <main ref={mainRef} id="main-content" tabIndex={-1} className="relative z-10 flex-1 w-full max-w-6xl mx-auto px-4 py-10 anim-fade">
            <Suspense fallback={<div className="flex justify-center py-20 text-[var(--muted)]"><span className="anim-fade">…</span></div>}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/catalog" element={<Catalog />} />
              <Route path="/submit" element={<Submit />} />
              <Route path="/c/:slug" element={<CommunityCatalogPage />} />
              <Route path="/r/:id" element={<RepoPublicPage />} />
              <Route path="/item/:slug" element={<ItemDetail />} />
              <Route path="/blog" element={<BlogList />} />
              <Route path="/blog/:slug" element={<BlogPostPage />} />
              <Route path="/docs" element={<Docs />} />
              <Route path="/docs/:slug" element={<Docs />} />
              <Route path="/faq" element={<Faq />} />
              <Route path="/repos" element={<ReposPage />} />
              <Route path="/repo/:id" element={<RepoDashboard />} />
              <Route path="/hosting" element={<Hosting />} />
              <Route path="/myo" element={<MyoPage />} />
              <Route path="/myo/:id" element={<Protected><MyoRequestPage /></Protected>} />
              <Route path="/p/:key" element={<ProjectPage />} />
              <Route path="/projects" element={<OtherProjects />} />
              <Route path="/project/:slug" element={<ShowcaseProjectPage />} />
              <Route path="/profile" element={<Protected><Profile /></Protected>} />
              <Route path="/users" element={<UserSearch />} />
              <Route path="/u/:id" element={<PublicProfile />} />
              <Route path="/reports/join/:token" element={<ReportJoin />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/authorize" element={<Authorize />} />
              <Route path="/verify-email" element={<VerifyEmail />} />
              <Route path="/contact" element={<Contact />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/2fa" element={<TwoFactor />} />
              <Route path="/legal" element={<LegalIndex />} />
              <Route path="/legal/about" element={<Legal page="about" />} />
              <Route path="/legal/privacy" element={<Legal page="privacy" />} />
              <Route path="/legal/terms" element={<Legal page="terms" />} />
              <Route path="/legal/cookies" element={<Legal page="cookies" />} />
              <Route path="/legal/refunds" element={<Legal page="refunds" />} />
              {/* Old flat URLs → new /legal/* (keep existing links & SEO working) */}
              <Route path="/about" element={<Navigate to="/legal/about" replace />} />
              <Route path="/privacy" element={<Navigate to="/legal/privacy" replace />} />
              <Route path="/terms" element={<Navigate to="/legal/terms" replace />} />
              <Route path="/cookies" element={<Navigate to="/legal/cookies" replace />} />
              <Route path="/refunds" element={<Navigate to="/legal/refunds" replace />} />
              <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
              <Route path="/admin" element={<Protected role={['MOD', 'ADMIN']}><Admin /></Protected>} />
              <Route path="*" element={<NotFound />} />
            </Routes>
            </Suspense>
          </main>
          <Footer />
          <MobileTabBar />
          <CookieConsent />
        </AppReveal>
      </div>
    </IntroProvider>
  );
}

// Keeps the real nav/content mounted (already loading/ready) but invisible
// while Hero3D's intro sequence is playing, then fades it in as the orb
// settles into its background position — one continuous reveal, not a swap.
function AppReveal({ children }) {
  const { active } = useIntro();
  return (
    <div className="flex-1 flex flex-col" style={{ opacity: active ? 0 : 1, transition: active ? 'none' : 'opacity .7s ease .05s' }}>
      {children}
    </div>
  );
}
