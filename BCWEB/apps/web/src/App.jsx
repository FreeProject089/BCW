import { useEffect, useState, useRef, useLayoutEffect, useSyncExternalStore } from 'react';
import { stageClaimed, subscribeStage } from './hero/scene-stage.js';
import { createPortal } from 'react-dom';
import { Routes, Route, Link, NavLink, Navigate, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { Code2, Boxes, Orbit, Music2, Newspaper, Server, Rocket, LayoutDashboard, Shield, LogOut, Download, Menu, X, Sparkles, Bell, Mail, Home as HomeIcon, ChevronDown, MoreHorizontal, LayoutGrid, ShieldCheck, ArrowUpRight, Info, AlertTriangle, CheckCircle2, Settings as SettingsIcon, BookOpen, Search, Languages, LogIn, Cloud, HelpCircle, UserRound } from 'lucide-react';
import { useAuth } from './pages/auth.jsx';
import { api } from './lib/api.js';
import NavNotifications from './ui/notif-bell.jsx';
import { useReportsUnseen } from './lib/reports-unseen.js';
import { getHero3dDisabled } from './lib/prefs.js';
import { prefersReducedMotion } from './lib/fx-pref.js';
import WelcomePrefs from './ui/WelcomePrefs.jsx';
import { Button, useToast, Modal, useDialog } from './ui/ui.jsx';
import { Badges, BadgeIcon } from './ui/Badges.jsx';
import { ThemeToggle, useTheme } from './ui/theme.jsx';
import { UtilGlyph, utilIconFor, utilSize } from './ui/topbar-glyph.jsx';
import { TopMenu } from './ui/topbar-menu.jsx'; // N-topbar (agent-topbar-N): the grouped topbar menus

import { useI18n, LangToggle, LangSelect } from './i18n.jsx';
import CommandPalette from './ui/command-palette.jsx';
import ShortcutsHost from './ui/shortcuts.jsx';
import { openPalette } from './ui/palette-recent.js';
import { buildDownbar } from './ui/mobilebar-items.js';
import { KofiIcon, GithubIcon, DiscordIcon, RedditIcon, XIcon, YoutubeIcon, TwitchIcon,
  MastodonIcon, BlueskyIcon, InstagramIcon, TelegramIcon, TiktokIcon, appLogoUrl } from './ui/brand.jsx';
import { ShowcaseIcon, IconGlyph } from './ui/md-lite.js'; // M18: icons without the renderer
/**
 * Telemetry, imported so that losing it costs telemetry and not the site.
 *
 * These two were static imports, and both filenames — `analytics.js`, `gtm.js` — are on
 * every content-blocker filter list; Firefox's built-in protection is enough. A blocked
 * request to either one aborted the module graph before React mounted, so the whole app
 * rendered a WHITE PAGE, with two "Loading failed for the module" lines and no stack.
 *
 * It does not reproduce for whoever is investigating: the dev server answers 200 with correct
 * `text/javascript` to anything that asks without a blocker in the way, so the code looks
 * innocent from every angle except the browser that reported it.
 *
 * Nothing here returns a value anybody waits on — they are fire-and-forget side effects — so
 * a rejected import can simply be swallowed. The consent state moved to lib/consent.js, which
 * has a name no filter matches, so the cookie banner keeps working either way.
 */
const telemetry = () => import('./lib/analytics.js').catch(() => null);
const trackPageview = (p) => { void telemetry().then((m) => m?.trackPageview(p)); };
// DYNAMIC, and caught, like everything else in this group. A static import here would put
// the measurement graph in the entry chunk, and these filenames are on every ad-block filter
// list: one blocked request would then be a white page instead of a missing chart. That has
// already happened once here and is why consent.js was pulled out of analytics.js.
const startMeasurement = () => { void import('./lib/measure-boot.js').then((m) => m.startMeasurement()).catch(() => {}); };
import { applySeoHead, setCanonical, fetchRouteMeta, applyRouteMeta } from './lib/seo.js';
import { getOrbTransitionPref, getLogoutConfirm } from './lib/prefs.js';
import { canAdmin, effectiveCaps, hasProjectGrant, utilAllowed } from './lib/roles.js';
import { readLayout, navAlignClass } from './lib/navLayout.js';
import CookieConsent from './ui/CookieConsent.jsx';
import PwaUpdatePrompt from './ui/pwa-update.jsx';
import PwaInstallPrompt from './ui/pwa-install.jsx';
import PromoBadge from './ui/promo-badge.jsx';
import EventEffect from './hero/event-effect.jsx';
import { IntroProvider, useIntro } from './ui/IntroContext.jsx';
import { Suspense } from 'react';
import { ReportJoin } from './ui/report.jsx';
import Avatar from './ui/Avatar.jsx';
// Eager: the initial landing routes + nav-critical modules (the notification map is
// rendered by the always-present nav bell, which keeps dashboard.jsx in the main chunk).
import { Home } from './pages/home.jsx';
import { Catalog, ItemDetail } from './pages/catalog.jsx';
import { DEFAULT_FOOTER_SOCIALS, DEFAULT_FOOTER_COLUMNS } from './ui/footer-default.js';
import { LucideCdnIcon } from './editor/icon-picker.jsx';
import { FooterStatus } from './pages/status-widget.jsx';
import { lazyChunk, lazyNamed, installPreloadErrorHandler } from './lib/lazy-chunk.js';
import { ErrorBoundary } from './ui/ErrorBoundary.jsx';
import './ui/phone-topbar.css'; // M6: the phone topbar
installPreloadErrorHandler();
// Lazy: route-split so the initial bundle no longer ships the whole admin back-office,
// repo tools, editors, etc. — each loads on demand behind the Suspense boundary below.
// Route chunks recover from a stale build instead of crashing — see lib/lazy-chunk.js.
const named = lazyNamed;
// The hero orb pulls in three.js (~460 KB) — lazy-load it so it never blocks first paint
// (it's a decorative backdrop; a null fallback means it just fades in once loaded).
const Hero3D = lazyChunk(() => import('./hero/Hero3D.jsx'));
const CopyVerify = lazyChunk(() => import('./pages/copy-verify.jsx'));
const ClosureCancel = lazyChunk(() => import('./pages/closure.jsx'));
const PollsPage = lazyChunk(() => import('./pages/polls.jsx'));
const CharityPage = lazyChunk(() => import('./pages/charity.jsx'));
const SinglePollPage = lazyChunk(() => import('./pages/polls.jsx').then((m) => ({ default: m.SinglePollPage })));
const DevHub = lazyChunk(() => import('./pages/dev.jsx'));
const StatusPage = lazyChunk(() => import('./pages/status.jsx'));
const DevConfig = lazyChunk(() => import('./pages/dev-config.jsx'));
const NotificationCentre = lazyChunk(() => import('./pages/notifications.jsx'));
const SanctionPage = lazyChunk(() => import('./pages/sanction.jsx'));
const DevTools = lazyChunk(() => import('./pages/dev-tools.jsx'));
const DevMarkdown = lazyChunk(() => import('./pages/dev-markdown.jsx'));
const DevBmd = lazyChunk(() => import('./pages/dev-bmd.jsx'));
const DevEditor = lazyChunk(() => import('./pages/dev-editor.jsx'));
const StudioPage = lazyChunk(() => import('./pages/studio.jsx'));
// The 404 page carries the Orb Fall canvas game — a whole game, in the entry chunk, for a
// route almost nobody reaches. Split out it is worth 9 KB gzip, which is what the bundle
// budget was over by, and it costs a Suspense flash on a page that is already a surprise.
const NotFound = lazyChunk(() => import('./pages/notfound.jsx'));
// Was this document opened with no network at all?
//
// Read ONCE, at module load, and never again. When the service worker cannot reach the site
// it answers a navigation with the precached app shell (scripts/sw-source.js, rule 3), and
// what boots is this app with nothing behind it: every page would render its own "could not
// load" state, one by one, which is a broken site rather than an offline one. So an offline
// boot goes straight to the 404 page, which is the one screen here that needs no server and
// has a game on it. That is the owner's call and it is what makes the offline fallback worth
// having at all.
//
// It is deliberately NOT reactive to going offline mid-session: throwing away the article
// somebody is reading because the train went into a tunnel would be worse than the per-page
// fallbacks they already get. Coming back online DOES clear it, because then the route they
// asked for can finally be shown.
const BOOTED_OFFLINE = typeof navigator !== 'undefined' && navigator.onLine === false;
// Sign-in is a route like any other. It was eager because it is important, which is not
// the same as being needed on first paint: somebody arriving at the home page does not
// need the sign-in form until they click.
const Auth = lazyChunk(() => import('./pages/signin.jsx').then((m) => ({ default: m.Auth })));
const Admin = named(() => import('./pages/admin.jsx'), 'Admin');
const Dashboard = named(() => import('./pages/dashboard.jsx'), 'Dashboard');
const Giveaways = named(() => import('./pages/giveaways.jsx'), 'Giveaways');
const ReposPage = named(() => import('./pages/repos.jsx'), 'ReposPage');
const RepoDashboard = named(() => import('./pages/repo-dashboard.jsx'), 'RepoDashboard');
const ProjectPage = lazyChunk(() => import('./pages/project.jsx'));
const OtherProjects = named(() => import('./pages/project.jsx'), 'OtherProjects');
const ShowcaseProjectPage = named(() => import('./pages/project.jsx'), 'ShowcaseProjectPage');
const Profile = lazyChunk(() => import('./pages/profile.jsx'));
const PublicProfile = lazyChunk(() => import('./pages/publicprofile.jsx'));
const UserSearch = named(() => import('./pages/publicprofile.jsx'), 'UserSearch');
const BlogList = named(() => import('./pages/blog.jsx'), 'BlogList');
const BlogPostPage = named(() => import('./pages/blog.jsx'), 'BlogPostPage');
const Docs = lazyChunk(() => import('./pages/docs.jsx'));
const MyoPage = named(() => import('./pages/myo.jsx'), 'MyoPage');
const MyoRequestPage = named(() => import('./pages/myo.jsx'), 'MyoRequestPage');
const Faq = lazyChunk(() => import('./pages/faq.jsx'));
const Submit = named(() => import('./pages/submit.jsx'), 'Submit');
const CommunityCatalogPage = lazyChunk(() => import('./pages/catalogpage.jsx'));
const ProjectCatalogPage = lazyChunk(() => import('./pages/project-catalog.jsx'));
const RepoPublicPage = lazyChunk(() => import('./pages/repopublic.jsx'));
const Hosting = named(() => import('./pages/hosting.jsx'), 'Hosting');
const Legal = named(() => import('./pages/legal.jsx'), 'Legal');
const LegalIndex = named(() => import('./pages/legal.jsx'), 'LegalIndex');
const LegalArchive = named(() => import('./pages/legal.jsx'), 'LegalArchive');
const FileLink = lazyChunk(() => import('./pages/file-link.jsx'));
const Contact = named(() => import('./pages/contact.jsx'), 'Contact');
const ReportPage = named(() => import('./pages/report.jsx'), 'ReportPage');
const AnonThreadPage = lazyChunk(() => import('./pages/threads.jsx'));
const TeamPage = lazyChunk(() => import('./pages/teams.jsx'));
const TeamJoin = named(() => import('./pages/teams.jsx'), 'TeamJoin');
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
  { type: 'link', to: '/dev', k: 'nav.dev', icon: Code2 },
  { type: 'link', to: '/repos', k: 'nav.repos', icon: Server },
  { type: 'link', to: '/hosting', k: 'nav.hosting', icon: Cloud },
];
// N-topbar (agent-topbar-N): the site's own projects, for the topbar's Projects menu. The
// children of the default "Apps" group, so the two can never list different projects.
const FIXED_PROJECTS = DEFAULT_ITEMS[0].children;

// Icons an admin can pick for a configured nav item — a curated, safe whitelist
// (only these render; an unknown name falls back to Boxes). Keys are the values
// stored in the nav config; keep them stable.
const NAV_ICONS = { Boxes, Orbit, Music2, Newspaper, Server, Rocket, Shield, Download, Sparkles, Mail, Home: HomeIcon, BookOpen, LayoutGrid, Info, Bell, Code: Code2, Search, Cloud, LogIn, LayoutDashboard, HelpCircle };

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

// The bell's badge, shared with the mobile bottom bar.
//
// The bar needs the same number the bell shows, and the obvious way to get it — a second
// fetch — would double a poll that already runs every 60 seconds for every signed-in visitor,
// to render the same digit twice. The bell publishes instead. A module value plus one event
// rather than lifted state: this number changes on a timer, and putting it in App's state
// would re-render the entire shell (nav, main, footer) once a minute for a badge.
let _navBadge = 0;
const NAV_BADGE_EVENT = 'bcw:nav-badge';
function publishNavBadge(n) {
  if (n === _navBadge) return;
  _navBadge = n;
  try { window.dispatchEvent(new CustomEvent(NAV_BADGE_EVENT)); } catch { /* no window */ }
}
function useNavBadge() {
  const [n, setN] = useState(_navBadge);
  useEffect(() => {
    const h = () => setN(_navBadge);
    window.addEventListener(NAV_BADGE_EVENT, h);
    h(); // the bell may have published before this mounted
    return () => window.removeEventListener(NAV_BADGE_EVENT, h);
  }, []);
  return n;
}

// Real app icon when /icons/<app>.png exists, otherwise any Lucide icon or Simple Icons
// brand (via IconGlyph). `item.icon` may be a lucide component (hardcoded NAV) or a string
// name / "simple:<slug>" (admin-configured nav).
// The site mark on its white plate: the topbar brand and the footer brand.
//
// "The logo is a blank white square" has two causes, both reproduced in the DOM:
//   1. The image did not load. `.logo-plate` paints its white background whether or not the
//      <img> inside it ever decodes, so a dead URL (an uploaded mark on a storage bucket that
//      is down, a draft typed into the admin's live preview, a 404) leaves the white plate and
//      nothing on it. Measured with /logo.png answered by a 404: naturalWidth 0, background
//      rgb(255,255,255), i.e. a white square with at most the browser's broken-image glyph.
//   2. The wrong mark. SiteLogo falls back from the light mark to the DARK one when only the
//      dark one is set, and a dark-scheme mark is typically a white glyph: white on the white
//      plate. The plate exists precisely so the mark is always the light-scheme one.
// So: the light mark or the bundled one (never the dark mark on a plate), and a failed load
// falls through to the next candidate instead of leaving the plate empty. If even the bundled
// file cannot load (offline with a cold cache), the plate carries the initials, not nothing.
const BUNDLED_MARK = '/logo.png';
function BrandMark({ src: override = '', alt = '', className = '', style }) {
  const ctx = useTheme();
  const [failed, setFailed] = useState(() => new Set());
  const candidates = [override, ctx?.logos?.light, BUNDLED_MARK].filter(Boolean);
  const src = candidates.find((u) => !failed.has(u));
  if (!src) {
    return (
      <span role={alt ? 'img' : undefined} aria-label={alt || undefined} aria-hidden={alt ? undefined : true}
        className={`logo-plate brand-mark-fallback ${className}`} style={style}>BC</span>
    );
  }
  return (
    <img key={src} src={src} alt={alt} className={`logo-plate ${className}`} style={style}
      onError={() => setFailed((prev) => new Set(prev).add(src))} />
  );
}

// A project's own logo, inferred from where the item points. The hardcoded NAV carries an
// explicit `img`, but the topbar is admin-configurable and the DB copy of it only stores
// an icon NAME — so a configured "Projects" dropdown fell back to a generic Lucide glyph
// and BMM, BSM and BetterInstaller all lost their branding. Deriving it from `to` fixes
// every existing config without anyone re-editing it, and a future entry pointing at a
// project gets its logo for free.
function projectLogo(to) {
  const m = /^\/p\/([a-z0-9-]+)/i.exec(String(to || ''));
  return m ? appLogoUrl(m[1].toLowerCase()) : undefined;
}

// Every branch carries `nav-ic`, which is what the labels-only mode hides.
//
// A structural CSS rule was tried first and was simply wrong: this renders an <img>, an
// arbitrary lucide component or an IconGlyph depending on the item, and inside a pill the
// result is not the first child. Marking the icon is the same thing `.nav-lbl` already does
// for the text, and it is why that rule works and a positional guess did not.
function NavIcon({ item, size = 15 }) {
  const src = item.img || projectLogo(item.to);
  const [ok, setOk] = useState(!!src);
  if (src && ok) return <img src={src} alt="" width={size + 3} height={size + 3} className="nav-ic logo-plate rounded-[4px] object-contain" onError={() => setOk(false)} />;
  if (typeof item.icon !== 'string') { const I = item.icon || Boxes; return <I size={size} className="nav-ic" />; }
  return <IconGlyph name={navIconName(item.icon)} size={size} className="nav-ic" />;
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
const pill = ({ isActive }) => `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition ${isActive ? 'bg-[var(--bg-solid)] text-[var(--accent-ink)] shadow-sm font-medium' : 'text-[var(--muted)] hover:text-[var(--text)]'}`;
const sheet = ({ isActive }) => `flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm ${isActive ? 'bg-[var(--surface-2)] text-[var(--accent-ink)] font-medium' : 'text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'}`;

// Desktop dropdown pill for a configured "group" nav item — Twenty-style: opens on
// hover (with a small close delay so the pointer can travel to the panel) and on click,
// closes on outside-click / Esc / route change. Keyboard-focusable + aria-expanded.
function NavDropdown({ item, t, lang, idx }) {
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
  // The document and window this bar lives in. Normally the page's; inside the admin Live
  // preview it is the preview frame's, and a panel portalled into the PAGE's body (or an
  // outside-click listener on the page's document) would land outside the frame entirely.
  const ownDoc = () => ref.current?.ownerDocument || document;
  useEffect(() => {
    if (!open) return;
    const win = ownDoc().defaultView || window;
    const onScroll = () => place();
    win.addEventListener('scroll', onScroll, true);
    win.addEventListener('resize', onScroll);
    return () => { win.removeEventListener('scroll', onScroll, true); win.removeEventListener('resize', onScroll); };
  }, [open]);
  useEffect(() => {
    // Outside-click closes — but the panel lives outside `ref` (portal), so exclude it too.
    const doc = ownDoc();
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target) && menuRef.current && !menuRef.current.contains(e.target)) setOpen(false); };
    const onEsc = (e) => { if (e.key === 'Escape') setOpen(false); };
    doc.addEventListener('mousedown', onDoc);
    doc.addEventListener('keydown', onEsc);
    return () => { doc.removeEventListener('mousedown', onDoc); doc.removeEventListener('keydown', onEsc); };
  }, []);
  const enter = () => { clearTimeout(closeT.current); setOpen(true); };
  const leave = () => { clearTimeout(closeT.current); closeT.current = setTimeout(() => setOpen(false), 140); };
  return (
    <div ref={ref} className="relative shrink-0" onMouseEnter={enter} onMouseLeave={leave} data-nav-idx={idx}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="true" aria-expanded={open} className={pill({ isActive: active }) + ' shrink-0'}>
        <NavIcon item={item} size={16} /><span className="nav-lbl">{navLabel(item, t, lang)}</span><ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && pos && createPortal(
        <div ref={menuRef} onMouseEnter={enter} onMouseLeave={leave}
          className="fixed z-[70] min-w-[248px] p-1.5 rounded-2xl border border-[var(--line)] topbar anim-fade"
          style={{ left: pos.left, top: pos.top, boxShadow: '0 14px 44px -12px rgba(0,0,0,0.42)' }}>
          {children.map((c, i) => (
            <NavLink key={c.to + i} to={c.to} onClick={() => setOpen(false)} className={({ isActive }) => `flex items-start gap-2.5 p-2 rounded-xl transition ${isActive ? 'bg-[var(--surface-2)]' : 'hover:bg-[var(--surface-2)]'}`}>
              <span className="w-7 h-7 rounded-lg bg-[var(--surface-2)] grid place-items-center shrink-0 text-[var(--accent-ink)]"><NavIcon item={c} size={15} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-[var(--text)] truncate">{navLabel(c, t, lang)}</span>
                {navSubLabel(c, lang) && <span className="block text-xs text-[var(--faint)] truncate">{navSubLabel(c, lang)}</span>}
              </span>
            </NavLink>
          ))}
        </div>,
        ownDoc().body,
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
      <button type="button" onClick={() => setOpen((o) => !o)} className={sheet({ isActive: false }) + ' w-full text-start'} aria-expanded={open}>
        <NavIcon item={item} size={16} /><span className="flex-1">{navLabel(item, t, lang)}</span><ChevronDown size={15} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="ps-3 mt-0.5 space-y-0.5 border-s border-[var(--line)] ms-3">
          {children.map((c, i) => (
            <NavLink key={c.to + i} to={c.to} className={sheet} onClick={onNavigate}><NavIcon item={c} size={16} />{navLabel(c, t, lang)}</NavLink>
          ))}
        </div>
      )}
    </div>
  );
}


/** "Your account is suspended", said by the app rather than discovered by watching things fail.
 *
 *  Until now the only signals were an e-mail and a notification. Once you were signed in,
 *  nothing on screen said so — you found out when your API key answered 403 and your repos
 *  stopped serving, which reads like an outage rather than a decision. It carries the
 *  reference, because that is what a contest is filed against.
 *
 *  Not dismissible: this is not news, it is the state the account is in.
 */
// Asks a signed-in user to agree to a policy change that was published as requiring it.
//
// A banner, not a modal that blocks the site. Nothing about their account changes while they
// have not clicked, and holding the product hostage over a policy update is the pattern this
// platform exists to avoid. It is persistent instead — present on every page until answered,
// which is enough pressure for something that is genuinely their choice.
// Keeps the UI language in step with the signed-in account (B9 Phase 5). On login it adopts the
// account's saved locale (so the choice follows the user across devices); when a logged-in user
// switches language it persists that to the account. A logged-out visitor keeps the localStorage
// choice untouched — an account with NO saved locale is never auto-written on login, only when the
// person actually changes it. Renders nothing.
function LocaleSync() {
  const { lang, setLang } = useI18n();
  const { user } = useAuth();
  const known = useRef(undefined); // what we believe the account's locale is (undefined = not synced yet)
  useEffect(() => {
    if (!user) { known.current = undefined; return; }
    if (known.current !== undefined) return; // already synced this session
    if (user.locale) { known.current = user.locale; if (user.locale !== lang) setLang(user.locale); }
    else known.current = lang; // no account pref → seed with the current choice, don't auto-write
  }, [user, lang, setLang]);
  useEffect(() => {
    if (!user || known.current === undefined || lang === known.current) return;
    known.current = lang;
    api.patch('/me', { locale: lang }).catch(() => {});
  }, [lang, user]);
  return null;
}

function LegalReaccept() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const [pending, setPending] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!user) { setPending([]); return undefined; }
    let alive = true;
    api.get('/me/legal-pending')
      .then((r) => { if (alive) setPending(r?.pending || []); })
      .catch(() => { if (alive) setPending([]); });
    return () => { alive = false; };
  }, [user?.id]);

  if (!user || !pending.length) return null;
  const DOC = {
    privacy: lang === 'fr' ? 'la politique de confidentialité' : 'the Privacy Policy',
    terms: lang === 'fr' ? 'les conditions d’utilisation' : 'the Terms of Service',
    cookies: lang === 'fr' ? 'la politique de cookies' : 'the Cookie Policy',
    refunds: lang === 'fr' ? 'la politique de paiement' : 'the Payments policy',
    about: lang === 'fr' ? 'la page À propos' : 'the About page',
  };
  const names = [...new Set(pending.map((v) => DOC[v.doc] || v.doc))].join(lang === 'fr' ? ' et ' : ' and ');

  const accept = async () => {
    setBusy(true);
    try { await api.post('/me/legal-accept', {}); setPending([]); }
    catch { setBusy(false); }
  };

  return (
    <div className="relative z-20 print:hidden border-b border-[var(--line)]"
      style={{ background: 'color-mix(in srgb, var(--primary) 10%, var(--bg-solid))' }}>
      <div className="max-w-6xl mx-auto px-4 py-2.5 flex flex-wrap items-center gap-3 text-sm">
        <ShieldCheck size={16} className="text-[var(--accent-ink)] shrink-0" />
        <span className="flex-1 min-w-0">
          {lang === 'fr'
            ? `Nous avons mis à jour ${names}. Merci de la lire et de donner votre accord.`
            : `We have updated ${names}. Please read it and confirm your agreement.`}
          {pending[0]?.note && <span className="text-[var(--muted)]"> — {pending[0].note}</span>}
        </span>
        <Link to={`/legal/${pending[0].doc}`} className="shrink-0">
          <Button size="sm">{lang === 'fr' ? 'Lire' : 'Read it'}</Button>
        </Link>
        <Button size="sm" variant="primary" onClick={accept} disabled={busy} className="shrink-0">
          {lang === 'fr' ? 'J’accepte' : 'I agree'}
        </Button>
      </div>
    </div>
  );
}

function SanctionBanner() {
  const { user } = useAuth();
  const { t } = useI18n();
  const s = user?.sanction;
  if (!user || !user.status || user.status === 'active') return null;
  const banned = user.status === 'banned';
  const until = user.moderationUntil ? new Date(user.moderationUntil) : (s?.expiresAt ? new Date(s.expiresAt) : null);
  return (
    <div className="relative z-20 w-full" style={{ background: banned ? 'var(--error)' : 'var(--warning)' }}>
      <div className="max-w-6xl mx-auto px-4 py-2.5 flex items-start gap-2.5 text-white text-[13px]">
        <AlertTriangle size={15} className="shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <span className="font-semibold">
            {banned ? t('lockb.banned', 'Your account is banned.') : t('lockb.susp', 'Your account is suspended.')}
          </span>{' '}
          <span className="opacity-90">
            {until
              ? t('lockb.until', 'Until {d}.').replace('{d}', until.toLocaleString())
              : t('lockb.noend', 'No end date has been set.')}
            {' '}{t('lockb.what', 'Your repos and catalog items are offline while it lasts.')}
            {(s?.reason || user.moderationReason) ? ` ${t('lockb.reason', 'Reason')}: ${s?.reason || user.moderationReason}` : ''}
          </span>
        </div>
        {s?.code && (
          <Link to={`/sanctions/${s.code}`} className="shrink-0 underline underline-offset-2 font-medium whitespace-nowrap">
            {s.contestedAt ? t('lockb.open', 'Open {c}').replace('{c}', s.code) : t('lockb.contest', 'Read it & contest')}
          </Link>
        )}
      </div>
    </div>
  );
}

// The topbar bell lives in ui/notif-bell.jsx (NavNotifications), with the list it shares with
// the notification centre. `onBadge` is how it publishes the number for the mobile bar.

// `preview` (admin Live preview only): { cfg, user }. The bar then renders from the editor's
// draft config and a stand-in viewer instead of /nav and the signed-in account, and never
// fetches anything personal (notifications, report counts). Everything else, every rule,
// class and component, is the one visitors get; that is the point of the preview.
export function Nav({ preview = null } = {}) {
  const { user: authUser, logout: rawLogout } = useAuth();
  const user = preview ? preview.user : authUser;
  const { t, lang } = useI18n();
  const dialog = useDialog();
  const theme = useTheme()?.theme || 'dark';
  // One wrapper for every sign-out control on this bar. Two call sites (the icon and the
  // phone sheet) would otherwise honour the setting separately, and the one that forgot
  // would be the one people use.
  const logout = async () => {
    if (preview) return;
    if (getLogoutConfirm() && !(await dialog.confirm({
      title: t('nav.signout.t', 'Sign out?'),
      message: t('nav.signout.m', 'You will need to sign in again, including your second factor if you use one.'),
      okLabel: t('nav.signout', 'Sign out'), danger: true,
    }))) return;
    rawLogout();
  };
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  // The phone sheet is an overlay (see the header below), so Escape has to close it: with
  // the page hidden behind it there is no longer anywhere else to click by accident.
  //
  // And a press ANYWHERE outside the sheet closes it, not only on the transparent backdrop.
  // The backdrop lives inside the header's stacking context, so the fixed bottom bar (z-40,
  // later in the DOM) paints over it: measured at 375x812, a tap on the bar's Search tab
  // with the menu open opened the command palette ON TOP of the still-open menu. Capture
  // phase, so it runs before whatever the pressed control does; the toggle is excluded
  // because its own click is what flips the state.
  const sheetRef = useRef(null);
  const toggleRef = useRef(null);
  const backdropRef = useRef(null);
  const headerRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onEsc = (e) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      toggleRef.current?.focus();   // back where the keyboard user opened it from
    };
    const onDown = (e) => {
      const tgt = e.target;
      if (sheetRef.current?.contains(tgt) || toggleRef.current?.contains(tgt)) return;
      // The backdrop closes on its own CLICK. Closing on its pointerdown would unmount it
      // before the click, and the click would then land on whatever page link was under it.
      if (tgt === backdropRef.current) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onEsc);
    document.addEventListener('pointerdown', onDown, true);
    return () => { document.removeEventListener('keydown', onEsc); document.removeEventListener('pointerdown', onDown, true); };
  }, [open]);
  // A route change always closes it (the back button included, which no link's onClick sees).
  useEffect(() => { setOpen(false); }, [loc.pathname]);
  // The header's real height, for everything that has to clear it: anchor jumps, the admin
  // rail's sticky offset and height, the phone sheet's max height. It is not a constant: the
  // announcement banner rides inside the header. Measured once synchronously (a ResizeObserver
  // never fires in a background tab) and then observed. Not for the admin's preview copy of
  // this bar, which lives in a frame and must not rewrite the page's own value.
  useLayoutEffect(() => {
    if (preview) return undefined;
    const el = headerRef.current;
    if (!el) return undefined;
    const write = () => document.documentElement.style.setProperty('--header-h', `${Math.round(el.getBoundingClientRect().height)}px`);
    write();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(write);
    ro.observe(el);
    return () => ro.disconnect();
  }, [preview]);
  const segNavRef = useRef(null);
  const neededRef = useRef(0);                     // seg-nav width needed WITH labels
  const [compact, setCompact] = useState(false);   // icons-only (pills + Dashboard/Admin) when tight
  // Which fixed-project pills the CURRENT visitor can actually view (per-key
  // visibility, computed server-side) + any showcase projects an admin pinned
  // to the topbar (task: Project Announcement pages / visibility system).
  const [projVisible, setProjVisible] = useState(null); // { bmm: true, bsm: false, ... } | null (not loaded yet -> show all)
  const [pinnedShowcase, setPinnedShowcase] = useState([]);
  const [showcaseAll, setShowcaseAll] = useState([]); // N-topbar: the Projects menu lists some when none is pinned
  const navCfgLive = useNavConfig(); // admin-configured nav (null -> use hardcoded NAV), shared with the bottom bar
  const navCfg = preview ? preview.cfg : navCfgLive;
  // Admin-configured desktop layout (align · density · labels · projectsMax), via the shared
  // reader the preview also uses. labels:'icons' reuses the existing responsive icons-only
  // mode by FORCING is-compact regardless of width; density:'compact' tightens the pill gap.
  //
  // Declared HERE, next to the config it reads, and not further down where it used to sit:
  // the projects dropdown below needs projectsMax, and a `const` read above its declaration
  // is a ReferenceError at first render, not a warning. This app has already shipped that
  // exact bug once (/dev/tools, "can't access lexical declaration before initialization").
  const layout = readLayout(navCfg?.layout);
  useEffect(() => {
    api.get('/projects').then((r) => setProjVisible(r.visible || null)).catch(() => {});
    api.get('/showcase').then((r) => { const all = r.projects || []; setShowcaseAll(all); setPinnedShowcase(all.filter((p) => p.pinTopbar)); }).catch(() => {});
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
  // The dropdown is a SHORTCUT to the most important few, not a copy of the catalogue.
  //
  // Past about six entries a hover menu is a list you have to read standing up, and it hides
  // the rest of the topbar while you do. So it shows `projectsMax` and then hands over to
  // /projects — which already lists every showcase project, pinned or not, with taglines and
  // icons, and is a page you can link to, search and come back to.
  //
  // "All projects" is appended even when nothing was truncated: the page holds the UNPINNED
  // ones too, so it always has more than this menu does. Saying so once is better than a
  // visitor concluding these are all of them.
  const projectsGroup = projectsDropdown ? {
    type: 'group', k: 'nav.projects', icon: Orbit,
    children: [
      ...pinnedShowcase.slice(0, layout.projectsMax).map((p) => ({
        to: `/project/${p.slug}`,
        label: p.isAnnouncing ? (p.announceTitle || p.name) : p.name,
        ...showcaseChildIcon(p.icon),
      })),
      {
        to: '/projects',
        label: t('nav.allProjects', 'All projects'),
        desc: pinnedShowcase.length > layout.projectsMax
          ? t('nav.allProjectsMore', '{n} more, and everything not pinned here')
            .replace('{n}', String(pinnedShowcase.length - layout.projectsMax))
          : t('nav.allProjectsAll', 'Everything, including what is not pinned here'),
        icon: 'boxes',
      },
    ],
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
    // The window this bar is laid out in: the page's, or the preview frame's.
    const win = el.ownerDocument?.defaultView || window;
    const measure = () => {
      if (win.innerWidth < 1250) { setCompact(true); return; }
      if (!el.classList.contains('is-compact')) neededRef.current = el.scrollWidth;
      const need = neededRef.current || el.scrollWidth;
      setCompact(el.clientWidth < need - 2); // -2 for sub-pixel rounding
    };
    measure();
    const RO = win.ResizeObserver || ResizeObserver;
    const ro = new RO(measure);
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
  const iconsOnly = layout.labels === 'icons';
  // The mirror of iconsOnly. Kept as a separate flag rather than a ternary on one class,
  // because the two are not opposites: the responsive `compact` mode can force icons-only
  // at a narrow width, and text-only must not fight it — a pill with neither icon nor label
  // is an empty pill.
  const textOnly = layout.labels === 'labels';
  const uVisible = (k) => uCfg[k]?.visible !== false; // default: shown
  const orderIn = (list) => [...list].sort((a, b) => (uCfg[a]?.order ?? list.indexOf(a)) - (uCfg[b]?.order ?? list.indexOf(b)));
  const clusterA = orderIn(UTIL_A);
  const clusterB = orderIn(UTIL_B);
  // The auth/staff precondition is applied once, from the shared rule the Live preview
  // also uses — never re-tested per case below.
  // The icon an admin picked for a button, for the theme on screen (ui/topbar-glyph.jsx).
  const ug = (k, Fallback) => <UtilGlyph k={k} entry={uCfg[k]} theme={theme} fallback={Fallback} />;
  const hasIcon = (k, th) => !!utilIconFor(uCfg[k], th);
  const themeKnob = (th) => (hasIcon('theme', th) ? <UtilGlyph k="theme" entry={uCfg.theme} theme={th} size={Math.min(utilSize('theme', uCfg.theme), 14)} /> : null);
  const utilNode = (k) => {
    if (!utilAllowed(k, user)) return null;
    switch (k) {
      // The preview draws the bell without its fetches: it would otherwise show the ADMIN's
      // own notifications inside a "signed-out visitor" preview.
      case 'notifications': return preview
        ? <span key="u-notif" className="nav-link !px-2 relative" title={t('nav.notifications')}>{ug('notifications', Bell)}</span>
        : <NavNotifications key="u-notif" onBadge={publishNavBadge} icon={hasIcon('notifications', theme) || uCfg.notifications?.size ? ug('notifications', Bell) : null} />;
      // N-topbar: a menu (the site's projects, then the other projects), not a bare link.
      case 'projects': return <span key="u-proj" className="hidden sm:inline-flex">{projectsMenu}</span>;
      // Inert in the preview: it would switch the ADMIN's language, not the preview's.
      case 'lang': return <span key="u-lang" className={preview ? 'pointer-events-none contents' : 'contents'}><LangToggle type={uCfg.lang?.type || 'auto'} icon={hasIcon('lang', theme) || uCfg.lang?.size ? ug('lang', Languages) : null} /></span>;
      case 'theme': return <ThemeToggle key="u-theme" lightIcon={themeKnob('light')} darkIcon={themeKnob('dark')} />;
      case 'settings': return <NavLink key="u-set" to="/settings" className={({ isActive }) => `nav-link !px-2 ${isActive ? 'nav-link-active' : ''}`} title={t('nav.settings', 'Settings')} aria-label={t('nav.settings', 'Settings')}>{ug('settings', SettingsIcon)}</NavLink>;
      case 'dashboard': return <NavLink key="u-dash" to={unseen.mine > 0 ? '/dashboard?s=reports' : '/dashboard'} className={(s) => pill(s) + ' !py-2 !px-2.5 relative'} title={t('nav.dashboard')} aria-label={t('nav.dashboard')}>{ug('dashboard', LayoutDashboard)}{unseenDot(unseen.mine, t('nav.unseen.mine', '{n} report thread(s) with a reply you have not seen').replace('{n}', String(unseen.mine)))}</NavLink>;
      case 'admin': return <NavLink key="u-adm" to={unseen.staff > 0 ? '/admin?s=reports' : '/admin'} className={(s) => pill(s) + ' !py-2 !px-2.5 relative'} title={t('nav.admin')} aria-label={t('nav.admin')}>{ug('admin', Shield)}{unseenDot(unseen.staff, t('nav.unseen.staff', '{n} report thread(s) waiting for staff').replace('{n}', String(unseen.staff)))}</NavLink>;
      case 'profile': return <Link key="u-prof" to="/profile" className="rounded-full p-0.5 hover:ring-2 hover:ring-[var(--line-strong)] transition" title={user.displayName}><Avatar user={user} size={utilSize('profile', uCfg.profile)} /></Link>;
      case 'logout': return <Button key="u-out" variant="ghost" size="sm" onClick={logout} title={t('nav.signout')}>{ug('logout', LogOut)}</Button>;
      // Sign in is a text button; an icon is only drawn when one was picked.
      case 'login': return <Link key="u-login" to="/auth"><Button variant="primary" size="sm" className="whitespace-nowrap rounded-full">{hasIcon('login', theme) && ug('login')}{t('nav.signin')}</Button></Link>;
      default: return null;
    }
  };
  const renderUtil = (k) => (uVisible(k) ? utilNode(k) : null);
  // Unseen report threads, on the entry that leads to them: your own on Dashboard, the staff
  // queue on Admin. The count is lib/reports-unseen.js (one shared poll of the Report flags).
  const unseen = useReportsUnseen(!!user && !preview);
  const unseenDot = (n, label) => n > 0 && <span className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-1 rounded-full bg-[var(--primary)] text-[var(--on-primary)] text-[9px] font-bold grid place-items-center" title={label} aria-label={label}>{n > 9 ? '9+' : n}</span>;
  // N-topbar (agent-topbar-N): the grouped menus (ui/topbar-menu.jsx).
  // Dashboard + Admin are one menu, Profile + Sign out are the account menu, and Projects lists
  // the site's own projects then the other projects. Each member still passes the SAME two
  // tests as a loose button (the admin's show/hide in nav.config.utility, and the shared
  // auth/staff rule utilAllowed from lib/roles.js), and the menu takes the place of its first
  // member in the configured order. A group left with one member is that member's plain
  // button again: a menu of one is a detour.
  const shownB = (k) => uVisible(k) && utilAllowed(k, user);
  const dashKeys = clusterB.filter((k) => (k === 'dashboard' || k === 'admin') && shownB(k));
  const acctKeys = clusterB.filter((k) => (k === 'profile' || k === 'logout') && shownB(k));
  const unseenLabel = (k) => (k === 'admin'
    ? t('nav.unseen.staff', '{n} report thread(s) waiting for staff').replace('{n}', String(unseen.staff))
    : t('nav.unseen.mine', '{n} report thread(s) with a reply you have not seen').replace('{n}', String(unseen.mine)));
  const dashItem = (k) => (k === 'admin'
    ? { key: 'adm', to: unseen.staff > 0 ? '/admin?s=reports' : '/admin', icon: ug('admin', Shield), label: t('nav.admin'), desc: t('nav.menu.admin.d', 'Run the site: content, people, settings'), badge: unseen.staff, badgeTitle: unseenLabel('admin') }
    : { key: 'dash', to: unseen.mine > 0 ? '/dashboard?s=reports' : '/dashboard', icon: ug('dashboard', LayoutDashboard), label: t('nav.dashboard'), desc: t('nav.menu.dash.d', 'Your repos, catalogues and activity'), badge: unseen.mine, badgeTitle: unseenLabel('dashboard') });
  const acctItem = (k) => (k === 'logout'
    ? { key: 'out', onSelect: logout, icon: ug('logout', LogOut), label: t('nav.signout'), tone: 'danger' }
    : { key: 'prof', to: '/profile', icon: <UserRound size={16} />, label: t('nav.profile', 'Profile'), desc: t('nav.menu.prof.d', 'Your public profile and your account') });
  const dashUnseen = (dashKeys.includes('dashboard') ? unseen.mine : 0) + (dashKeys.includes('admin') ? unseen.staff : 0);
  const onDash = /^\/(dashboard|admin)(\/|$)/.test(loc.pathname);
  const dashTitle = t('nav.menu.dashboards', 'Dashboards');
  const dashMenu = dashKeys.length === 2 && (
    <TopMenu key="u-dashmenu" dataKey="dashboards" label={dashTitle} chevron
      triggerClass={`tmenu-pill ${onDash ? 'is-current' : ''}`}
      trigger={<>{ug('dashboard', LayoutDashboard)}{dashUnseen > 0 && <span className="tmenu-dot" aria-hidden>{dashUnseen > 9 ? '9+' : dashUnseen}</span>}</>}
      sections={[{ key: 'd', items: dashKeys.map(dashItem) }]} />
  );
  const acctHead = user && (
    <div className="tmenu-head">
      <Avatar user={user} size={36} />
      <span className="tmenu-head-txt">
        <span className="tmenu-head-name">{user.displayName}</span>
        {user.email && <span className="tmenu-head-sub">{user.email}</span>}
      </span>
    </div>
  );
  const acctTitle = t('nav.menu.account', 'Your account');
  const acctMenu = acctKeys.length === 2 && (
    <TopMenu key="u-acctmenu" dataKey="account" label={acctTitle} title={user?.displayName} triggerClass="tmenu-avatar"
      trigger={<Avatar user={user} size={utilSize('profile', uCfg.profile)} />} header={acctHead}
      sections={[{ key: 'a', items: acctKeys.map(acctItem) }]} />
  );
  // Cluster B with the two groups folded in: the menu at its first member, nothing at the second.
  const renderB = (k) => {
    if (dashMenu && dashKeys.includes(k)) return k === dashKeys[0] ? dashMenu : null;
    if (acctMenu && acctKeys.includes(k)) return k === acctKeys[0] ? acctMenu : null;
    return renderUtil(k);
  };
  // The phone bar has no cluster B: its avatar opens ONE menu holding both groups, titled.
  const phoneAccount = user && (dashKeys.length + acctKeys.length > 0) && (
    <TopMenu dataKey="phone-account" label={acctTitle} title={user.displayName} triggerClass="tbar-av"
      trigger={<><Avatar user={user} size={30} />{dashUnseen > 0 && <span className="tmenu-dot" aria-hidden>{dashUnseen > 9 ? '9+' : dashUnseen}</span>}</>}
      header={acctHead}
      sections={[
        { key: 'd', title: dashTitle, items: dashKeys.map(dashItem) },
        { key: 'a', title: acctKeys.length && dashKeys.length ? acctTitle : '', items: acctKeys.map(acctItem) },
      ]} />
  );
  // Projects: the site's own (the /p/<key> pages, each still behind its visibility gate), then
  // the other projects (the pinned ones, or the first few when none is pinned, capped like the
  // pill dropdown), then the page that lists every other project.
  const fixedProjects = FIXED_PROJECTS.filter((c) => gateTo(c.to));
  const otherProjects = (pinnedShowcase.length ? pinnedShowcase : showcaseAll).slice(0, layout.projectsMax);
  const onProjects = loc.pathname === '/projects' || /^\/(p|project)\//.test(loc.pathname);
  const projectsMenu = (
    <TopMenu dataKey="projects" label={t('nav.projects')} triggerClass={`nav-link !px-2 tmenu-icon ${onProjects ? 'is-current' : ''}`}
      trigger={ug('projects', Orbit)}
      sections={[
        { key: 'ours', title: t('nav.menu.proj.ours', 'Projects'), items: fixedProjects.map((c, i) => ({ key: 'f' + i, to: c.to, icon: <NavIcon item={c} size={18} />, label: navLabel(c, t, lang) })) },
        { key: 'others', title: t('nav.menu.proj.others', 'Other projects'), items: [
          ...otherProjects.map((p) => ({
            key: 'o-' + p.slug, to: `/project/${p.slug}`,
            icon: <ShowcaseIcon icon={p.icon} size={18} fallback={<Sparkles size={18} />} />,
            label: p.isAnnouncing ? (p.announceTitle || p.name) : p.name,
          })),
          { key: 'all', to: '/projects', end: true, icon: <LayoutGrid size={17} />, label: t('nav.menu.proj.all', 'All other projects'),
            desc: t('nav.menu.proj.all.d', 'Everything, including what is not listed here') },
        ] },
      ]} />
  );
  // fin N-topbar (agent-topbar-N)
  return (
    <header ref={headerRef} className="sticky top-0 z-40 px-2 sm:px-3 pt-2 sm:pt-3">
      {/* The bar and the phone sheet share this box. It is `relative` and it carries the
          max width, because the sheet hangs off it as an OVERLAY — see below for why. */}
      <div className="max-w-7xl mx-auto relative">
      <div className="tbar rounded-2xl border border-[var(--line)] px-2.5 sm:px-3 h-14 flex items-center gap-1 flex-nowrap topbar"
        style={{ boxShadow: '0 10px 34px -14px rgba(0,0,0,0.30)' }}>
        {/* D2: the mark is decorative (the name is the link's label), so alt="" and the name on
            the link. alt="BC" printed the letters "BC" on the white plate whenever the image
            had not decoded yet: in the admin's Live preview frame that was most of the time,
            and it read as a fake logo. */}
        <Link to="/" aria-label="BetterCommunity" className="flex items-center gap-2 font-extrabold text-[15px] me-1 shrink-0" onClick={() => setOpen(false)}>
          {hasIcon('brand', theme)
            ? <span className="grid place-items-center shrink-0" style={{ width: utilSize('brand', uCfg.brand), height: utilSize('brand', uCfg.brand) }}>{ug('brand')}</span>
            : <BrandMark alt="" className="rounded-xl object-contain" style={{ width: utilSize('brand', uCfg.brand), height: utilSize('brand', uCfg.brand) }} />}
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
        <div ref={segNavRef} className={`seg-nav ${compact || iconsOnly ? 'is-compact' : ''} ${textOnly && !(compact || iconsOnly) ? 'is-textonly' : ''} hidden lg:flex flex-1 min-w-0 overflow-x-auto no-scrollbar ${navAlignClass(layout.align)}`}>
          <nav className={`inline-flex items-center rounded-full bg-[var(--surface-2)] p-1 border border-[var(--line)] shrink-0 ${layout.density === 'compact' ? 'gap-0' : 'gap-0.5'}`}>
            {effItems.map((it, i) => it.type === 'group'
              ? <NavDropdown key={'g' + i} item={it} t={t} lang={lang} idx={it._idx} />
              : <NavLink key={it.to} to={it.to} data-nav-idx={it._idx} title={navLabel(it, t, lang)} aria-label={navLabel(it, t, lang)} className={(s) => pill(s) + ' shrink-0'}><NavIcon item={it} size={16} /><span className="nav-lbl">{navLabel(it, t, lang)}</span></NavLink>)}
            {projectsDropdown
              ? <NavDropdown key="proj-dd" item={projectsGroup} t={t} lang={lang} />
              : pinnedShowcase.map((p) => (
                <NavLink key={p.slug} to={`/project/${p.slug}`} title={p.name} aria-label={p.name} className={(s) => pill(s) + ' shrink-0'}>
                  <span className="nav-ic inline-flex"><ShowcaseIcon icon={p.icon} size={15} fallback={<Sparkles size={15} />} /></span><span className="nav-lbl">{p.isAnnouncing ? p.announceTitle || p.name : p.name}</span>
                </NavLink>
              ))}
          </nav>
        </div>
        {/* Below lg the segmented nav is hidden, so this spacer takes the slack and
            pushes the whole right cluster to the right edge (was left-glued). */}
        <div className="flex-1 min-w-[8px] lg:flex-none lg:w-2 shrink-0" />
        {/* Right cluster A — always visible, admin-configurable order/visibility. */}
        <div className="tbar-utils flex items-center gap-0.5 shrink-0">
          {clusterA.map(renderUtil)}
        </div>
        {/* Right cluster B — lg+ account cluster, admin-configurable order/visibility. */}
        <div className="hidden lg:flex items-center gap-1 shrink-0 ps-1 ms-1 border-s border-[var(--line)]">
          {clusterB.map(renderB)}
        </div>
        {/* below lg: profile/sign-in shortcut + menu (the hamburger sheet already
            has nav links + dashboard/admin/profile/logout, so nothing is lost).

            A <nav>, not a <div>, and that is the whole point of the element here. The
            segmented nav above is `hidden lg:flex` and the bottom bar is `md:hidden`, so
            between 768px and 1023px the page had NO navigation landmark at all: measured on
            22 pages at 768. This cluster owns the menu at those widths, so it is the
            landmark. */}
        {/* M6: the phone end of the bar is one capsule (account + menu), styled in
            ui/phone-topbar.css; the icon turns from bars to a cross. */}
        <nav aria-label={t('nav.menu.aria', 'Site menu')} className="tbar-phone lg:hidden flex items-center gap-1 shrink-0">
          {user ? (phoneAccount || <Link to="/profile" className="tbar-av" title={user.displayName} aria-label={t('nav.profile', 'Profile')} onClick={() => setOpen(false)}><Avatar user={user} size={30} /></Link>)
            : <Link to="/auth" className="tbar-signin"><Button variant="primary" size="sm" className="rounded-full">{t('nav.signin')}</Button></Link>}
          <button ref={toggleRef} type="button" className={`tbar-menu shrink-0 ${open ? 'is-open' : ''}`} onClick={() => setOpen((v) => !v)} aria-expanded={open}
            aria-label={open ? t('nav.menu.close', 'Close the menu') : t('nav.menu.aria', 'Site menu')}>
            <span className="tbar-menu-ic" aria-hidden><Menu size={20} className="tbar-menu-bars" /><X size={20} className="tbar-menu-x" /></span>
          </button>
        </nav>
      </div>

      {/* The phone menu (below lg:). Same visual language as the bottom bar: see MobileMenu.
          It used to be rendered here as an ordinary block inside the sticky header, which
          means it took part in the layout: opening it grew the header from 64px to 407px and
          pushed the whole page down by 343px (measured at 375x812 — main's top went 64 -> 407,
          body scrollHeight 6958 -> 7300). Every card under the bar jumped a screenful, which
          is what "opening the dropdown breaks the layout" was.
          A menu is an overlay, so it is positioned as one: absolute, hung under the bar, out
          of flow. Nothing below it moves. The sheet keeps its own margins and max-width, so
          the look committed in 20fd0998 is untouched — only the box it sits in changed. */}
      {open && (
        <div ref={sheetRef} className="absolute left-0 right-0 top-full z-10 lg:hidden">
          <MobileMenu cfg={navCfg?.mobileMenu} items={effItems} projectsGroup={projectsDropdown ? projectsGroup : null}
            pinned={projectsDropdown ? [] : pinnedShowcase} user={user} uVisible={uVisible} ug={ug}
            onClose={() => setOpen(false)} onLogout={() => { logout(); setOpen(false); }} />
        </div>
      )}
      </div>
      {/* An overlay hides what is under it, so it also has to be dismissable from there:
          a tap anywhere outside closes, and so does Escape. In flow neither was needed —
          you could always see and reach the page. `-z-10` keeps it behind the sheet and the
          bar while still covering the page. */}
      {/* Dimmed, so it reads as "the page is behind the menu, tap it to go back" rather than
          as a page that has stopped responding (it was fully transparent). */}
      {open && <button ref={backdropRef} type="button" className="msheet-scrim fixed inset-0 -z-10 lg:hidden cursor-default" aria-hidden tabIndex={-1} onClick={() => setOpen(false)} />}
      {/* Lives inside the same sticky header, so it rides along under the topbar
          pill instead of scrolling away with the page content underneath it. */}
      <AnnouncementBanner />
    </header>
  );
}

// The phone menu: what the hamburger opens below `lg`.
//
// It used to be a plain two-column list of rows, a different object from everything around
// it, while the bottom bar under the thumb had its own floating surface, pill icons and accent
// states. They are the same kind of thing (the site's navigation, on a phone), so this is now
// drawn in the bar's language: the same floating surface and radius (.msheet mirrors .mbar),
// the same pill behind the icon, the same accent on the page you are on, and a grid of tiles
// shaped like the bar's tabs rather than a list of rows.
//
// nav.config.mobileMenu (all optional, the defaults reproduce a sensible menu with no config):
//   layout   'tiles' | 'list'   tiles = the bar-like grid; list = rows, for long labels
//   columns  3 | 4              tiles per row
//   contact  boolean            the Contact shortcut (default on)
//   extras   [{ label, labelFr, to, icon }]  extra shortcuts, the same shape as a bottom-bar
//            dropup link, so an admin builds both with the same fields
export const MOBILE_MENU_DEFAULT = { layout: 'tiles', columns: 4, contact: true, extras: [] };
export function readMobileMenu(c) {
  const m = c || {};
  return {
    layout: m.layout === 'list' ? 'list' : 'tiles',
    columns: m.columns === 3 ? 3 : 4,
    contact: m.contact !== false,
    extras: (Array.isArray(m.extras) ? m.extras : []).filter((x) => x && String(x.to || '').startsWith('/')).slice(0, 8),
  };
}
function MobileMenu({ cfg, items, projectsGroup, pinned, user, uVisible, ug, onClose, onLogout }) {
  const { t, lang } = useI18n();
  const m = readMobileMenu(cfg);
  const [openGroup, setOpenGroup] = useState(null);
  const tiles = m.layout === 'tiles';
  const withIcon = (n) => (typeof n.icon === 'string' && NAV_ICONS[n.icon] ? { ...n, icon: NAV_ICONS[n.icon] } : n);
  const cell = ({ isActive }) => `msheet-tile ${isActive ? 'is-active' : ''}`;
  // One tile / row. `glyph` is a node (a configured utility icon); otherwise the item's own.
  const link = (key, to, label, glyph, extra = {}) => (
    <NavLink key={key} to={to} end={to === '/'} className={cell} onClick={onClose} {...extra}>
      <span className="msheet-ic">{glyph}</span><span className="msheet-lbl">{label}</span>
    </NavLink>
  );
  const group = (key, g) => {
    const on = openGroup === key;
    return [
      <button key={key} type="button" className={`msheet-tile ${on ? 'is-open' : ''}`} aria-expanded={on} onClick={() => setOpenGroup(on ? null : key)}>
        <span className="msheet-ic"><NavIcon item={withIcon(g)} size={18} /><ChevronDown size={11} className="msheet-chev" /></span>
        <span className="msheet-lbl">{navLabel(g, t, lang)}</span>
      </button>,
      on && (
        <div key={key + '-kids'} className="msheet-kids">
          {(g.children || []).map((c, j) => link(key + '-' + j, c.to, navLabel(c, t, lang), <NavIcon item={withIcon(c)} size={17} />))}
        </div>
      ),
    ];
  };
  const nav = [
    ...items.flatMap((it, i) => (it.type === 'group'
      ? group('g' + i, it)
      : [link('l' + i, it.to, navLabel(it, t, lang), <NavIcon item={withIcon(it)} size={18} />, { 'data-nav-idx': it._idx })])),
    ...(projectsGroup ? group('proj', projectsGroup) : []),
    ...pinned.map((p) => link('p-' + p.slug, `/project/${p.slug}`, p.isAnnouncing ? p.announceTitle || p.name : p.name,
      <ShowcaseIcon icon={p.icon} size={18} fallback={<Sparkles size={18} />} />)),
  ];
  const shortcuts = [
    uVisible('projects') && link('s-proj', '/projects', t('nav.projects'), ug('projects', Orbit)),
    m.contact && link('s-contact', '/contact', t('nav.contact', 'Contact'), <Mail size={18} />),
    uVisible('settings') && link('s-set', '/settings', t('nav.settings', 'Settings'), ug('settings', SettingsIcon)),
    ...m.extras.map((x, i) => link('x' + i, x.to, navLabel(x, t, lang) || x.to, <NavIcon item={withIcon({ ...x, icon: x.icon || 'Boxes' })} size={18} />)),
  ].filter(Boolean);
  const account = user ? [
    uVisible('dashboard') && link('a-dash', '/dashboard', t('nav.dashboard'), ug('dashboard', LayoutDashboard)),
    uVisible('admin') && canAdmin(user) && link('a-adm', '/admin', t('nav.admin'), ug('admin', Shield)),
    uVisible('profile') && link('a-prof', '/profile', t('nav.profile', 'Profile'), <Avatar user={user} size={20} />),
    uVisible('logout') && (
      <button key="a-out" type="button" className="msheet-tile" onClick={onLogout}>
        <span className="msheet-ic">{ug('logout', LogOut)}</span><span className="msheet-lbl">{t('nav.signout')}</span>
      </button>
    ),
  ].filter(Boolean) : [];
  const section = (title, kids) => kids.length > 0 && (
    <section className="msheet-sec">
      <div className="msheet-h">{title}</div>
      <div className={`msheet-grid ${tiles ? 'is-tiles' : 'is-list'}`} style={tiles ? { gridTemplateColumns: `repeat(${m.columns}, minmax(0, 1fr))` } : undefined}>{kids}</div>
    </section>
  );
  // The grip says "this can be pushed away", so it can: a swipe up on the sheet closes it,
  // the way a sheet hung from the top of the screen is dismissed. Only from the sheet's own
  // top (scrollTop 0), so scrolling a long menu back up never closes it by accident.
  const swipe = useRef(null);
  const onTouchStart = (e) => { const el = e.currentTarget; swipe.current = el.scrollTop <= 0 ? e.touches[0].clientY : null; };
  const onTouchEnd = (e) => {
    const y0 = swipe.current; swipe.current = null;
    if (y0 != null && y0 - e.changedTouches[0].clientY > 60) onClose();
  };
  return (
    <div className="lg:hidden msheet topbar anim-fade" role="navigation" aria-label={t('nav.menu.aria', 'Site menu')}
      onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className="msheet-grip" aria-hidden />
      {section(t('nav.menu.nav', 'Browse'), nav)}
      {section(t('nav.menu.short', 'Shortcuts'), shortcuts)}
      {user
        ? section(t('nav.menu.account', 'Your account'), account)
        : uVisible('login') && (
          <Link to="/auth" onClick={onClose} className="msheet-cta">
            {ug('login', LogIn)} {t('nav.signin')}
          </Link>
        )}
      {/* The way out, said in words and at the bottom of the sheet: that is where the thumb
          already is after reading the tiles. The only close control used to be the X in
          the top-right corner of the bar, the hardest spot on a phone to reach one-handed. */}
      <button type="button" className="msheet-close" onClick={onClose}>
        <X size={16} aria-hidden /> {t('nav.menu.close', 'Close the menu')}
      </button>
    </div>
  );
}

// App-style bottom tab bar (mobile only).
//
// WHAT IT SHOWS is decided in ui/mobilebar-items.js (shared with the admin editor); read the
// header there for why the defaults changed. This function is the rendering, and it exists to
// fix three complaints about the old one:
//
//   · it was a default tab bar. It now floats clear of the edge on the site's own surface,
//     with the active tab carrying a real accent pill and a filament above it;
//   · the active state had a Tailwind `transition` on a class that never animated anything
//     visible. The pill now scales and fades from the tab it left, the icon lifts, and the
//     whole thing is off under prefers-reduced-motion (see .mbar in index.css);
//   · it sat ON the end of the page. There is now a spacer the exact height of the bar, so
//     the last row of any page can still be scrolled to.
//
// Labels do NOT collapse while scrolling any more. They did, sliding back 220ms after the
// last scroll event, and it reads as the bar breaking rather than as a considerate touch: the
// labels are gone for exactly as long as the eye is moving and back once it has landed
// somewhere else, so the reader sees the flicker and never the reason for it. It also put a
// scroll listener and a timer on every page for every visitor on a phone, to hide four words
// that were never in the way.
// `preview`: { cfg, user }, as for <Nav>. The admin Live preview renders this very bar
// inside a phone-sized frame, where `fixed` docks it to the bottom of the frame.
export function MobileTabBar({ preview = null } = {}) {
  const { t, lang } = useI18n();
  const { user: authUser } = useAuth();
  const user = preview ? preview.user : authUser;
  const navCfgLive = useNavConfig();
  const navCfg = preview ? preview.cfg : navCfgLive;
  const badge = useNavBadge();
  const [openUp, setOpenUp] = useState(null); // index of the open dropup sheet, or null
  const bar = buildDownbar(navCfg, { signedIn: !!user });
  // Hooks are all above this line: the bar can be switched off by an admin, and an early
  // return before a hook is the classic way to break a component on a config change.
  if (!bar) return null;
  const { display, items } = bar;
  const showIcon = display !== 'text';
  const showText = display !== 'icon';
  const labelVisible = showText;
  // A hardcoded slot carries a translation key; a configured one carries label/labelFr.
  // The fallbacks are spelled out here because these two keys are new.
  const label = (n) => {
    if (n.k === 'downbar.search') return t('downbar.search', 'Search');
    if (n.k === 'downbar.me') return t('downbar.me', 'My space');
    return n.k ? t(n.k) : navLabel(n, t, lang);
  };
  // Slot icons are stored as NAMES (the shared module has no business importing lucide).
  // A name in the whitelist becomes the bundled component; anything else falls through to
  // NavIcon's existing string handling (IconGlyph / a project logo).
  const withIcon = (n) => (typeof n.icon === 'string' && NAV_ICONS[n.icon] ? { ...n, icon: NAV_ICONS[n.icon] } : n);
  const txt = (n) => showText && (
    <span className={`mbar-lbl ${labelVisible ? 'is-on' : ''} ${display === 'text' ? 'is-only' : ''}`}>{label(n)}</span>
  );
  // The unread count, on whichever slot asked for it. Capped at 9+: the bar has room for one
  // glyph, and "23" in a 14px dot is a smudge. The full number is in the title, which is also
  // what stops this being a clipped value with no way to read it.
  const dot = (n) => {
    if (n.badge !== 'notifs' || badge <= 0) return null;
    const full = t('downbar.unread', '{n} unread').replace('{n}', String(badge));
    return <span className="mbar-badge" title={full} aria-label={full}>{badge > 9 ? '9+' : badge}</span>;
  };
  const glyph = (n, size = 19) => showIcon && (
    <span className="mbar-ic"><NavIcon item={withIcon(n)} size={size} />{dot(n)}</span>
  );
  return (
    <>
      {/* The page has to END above the bar. Without this the last control on every page sat
          under a floating bar that no amount of scrolling could move — the one bug a bottom
          bar always has. The height is the bar plus its float gap plus the home indicator. */}
      <div className="mbar-spacer md:hidden" aria-hidden />
      {/* An invisible catcher so a tap anywhere else closes an open dropup. Below the nav in
          the stack (nav is rendered after), above the page. */}
      {openUp != null && <div className="md:hidden fixed inset-0 z-40" onClick={() => setOpenUp(null)} aria-hidden />}
      {/* `md:hidden` and `flex` are both Tailwind display utilities, so Tailwind's own output
          order decides which wins and the bar really does disappear at md+. Setting `display`
          in the .mbar rule instead would have depended on where the appended block lands
          relative to the utility layer, which is not something to leave to chance. */}
      <nav className="mbar topbar md:hidden fixed z-40 flex items-stretch" aria-label={t('downbar.aria', 'Main shortcuts')}>
        {items.map((n, i) => {
          // The raised main action. On the default bar this is Search, and it opens the same
          // ⌘K palette the desktop has — the phone had no way in at all.
          if (n.kind === 'primary') {
            const press = () => { if (n.act === 'search' && !preview) openPalette(); };
            const inner = (active) => <>
              <span className={`mbar-raise ${active ? 'is-on' : ''}`}><NavIcon item={withIcon(n)} size={22} /></span>
              {txt(n)}
            </>;
            if (n.act) {
              return (
                <button key={i} type="button" onClick={press} className="mbar-tab is-raised" title={label(n)} aria-label={label(n)}>
                  {inner(false)}
                </button>
              );
            }
            return (
              <NavLink key={i} to={n.to || '/'} end={n.exact} className="mbar-tab is-raised" title={label(n)} aria-label={label(n)}>
                {({ isActive }) => inner(isActive)}
              </NavLink>
            );
          }
          // A dropup: tap to raise a small sheet of links above the bar.
          if (n.kind === 'dropup') {
            const open = openUp === i;
            const kids = n.children || [];
            return (
              <div key={i} className="mbar-slot">
                {open && (
                  <div className="mbar-up" style={{ background: 'var(--bg-solid)' }}>
                    {kids.length === 0
                      ? <div className="px-3 py-2 text-xs text-[var(--faint)]">{t('downbar.empty', 'Nothing here yet')}</div>
                      : kids.map((c, j) => (
                        <NavLink key={j} to={c.to} onClick={() => setOpenUp(null)} className={({ isActive }) => `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm ${isActive ? 'text-[var(--accent-ink)] bg-[var(--surface-2)]' : 'text-[var(--muted)] hover:bg-[var(--surface-2)]'}`}>
                          <NavIcon item={withIcon(c)} size={16} /> <span className="truncate" title={label(c)}>{label(c)}</span>
                        </NavLink>
                      ))}
                  </div>
                )}
                <button type="button" onClick={() => setOpenUp(open ? null : i)} aria-expanded={open} title={label(n)} aria-label={label(n)}
                  className={`mbar-tab ${open ? 'is-active' : ''}`}>
                  {glyph(n)}
                  {txt(n)}
                </button>
              </div>
            );
          }
          return (
            <NavLink key={i} to={n.to} end={n.exact} title={label(n)} aria-label={label(n)}
              className={({ isActive }) => `mbar-tab ${isActive ? 'is-active' : ''}`}>
              {glyph(n)}
              {txt(n)}
            </NavLink>
          );
        })}
      </nav>
    </>
  );
}

const SOCIAL = [
  { Icon: GithubIcon, href: 'https://github.com/FreeProject089', label: 'GitHub' },
  { Icon: DiscordIcon, href: 'https://discord.com/invite/CTaaEF9R75', label: 'Discord' },
  { Icon: RedditIcon, href: 'https://www.reddit.com/r/BetterModManager/', label: 'Reddit' },
  { Icon: KofiIcon, href: KOFI, label: 'Ko-fi', kofi: true },
];
// The bundled brand marks, by the key a configured social stores. lucide dropped its brand
// icons, so these cannot come from the icon picker and have to be resolvable by name.
// The bundled brand marks, keyed by what a configured social stores.
//
// This list used to hold four, and everything else fell through to a lucide name — which
// looks like a sensible escape hatch and is a trap: lucide DROPPED its brand icons, so
// `youtube`, `twitch`, `instagram` and the rest resolve to a 404, and the renderer paints a
// mask whose URL 404s as nothing at all. An admin adding YouTube got an empty circle
// indistinguishable from a working button, with no error anywhere.
//
// So every network somebody is actually likely to add is bundled. The lucide fallback stays
// for the ones nobody anticipated, where an empty circle is at least an honest "we do not
// have this one" rather than a silent failure on a mainstream network.
export const SOCIAL_ICONS = {
  github: GithubIcon, discord: DiscordIcon, reddit: RedditIcon, kofi: KofiIcon,
  x: XIcon, twitter: XIcon, youtube: YoutubeIcon, twitch: TwitchIcon,
  mastodon: MastodonIcon, bluesky: BlueskyIcon, instagram: InstagramIcon,
  telegram: TelegramIcon, tiktok: TiktokIcon,
};
// One social button, from config. A known brand key renders the bundled SVG; anything else
// is taken as a lucide name so an admin can add a network we never anticipated.
function FooterSocial({ item }) {
  const Brand = SOCIAL_ICONS[String(item.icon || '').toLowerCase()];
  return (
    <a href={item.href} target={/^https?:/i.test(item.href) ? '_blank' : undefined} rel="noreferrer" title={item.label}
      className="foot-social grid place-items-center w-9 h-9 rounded-xl border border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--line-strong)] hover:bg-[var(--surface-2)] transition">
      {Brand ? <Brand size={16} className={item.icon === 'kofi' ? 'text-orange-400' : ''} /> : <LucideCdnIcon name={item.icon} size={16} />}
      {/* The label is the accessible name. `title` alone is a tooltip, not a name, so a
          screen reader announced twelve identical "link"s. */}
      <span className="sr-only">{item.label || item.icon}</span>
    </a>
  );
}
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
    ? <a key={l} href={to} target="_blank" rel="noreferrer" className="foot-link text-sm text-[var(--muted)] hover:text-[var(--accent-ink)] transition w-fit">{l}</a>
    : <Link key={l} to={to} className="foot-link text-sm text-[var(--muted)] hover:text-[var(--accent-ink)] transition w-fit">{l}</Link>;
  return (
    <div className="border-b border-[var(--line)] last:border-b-0 md:border-0">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="foot-col-head w-full flex items-center justify-between py-2.5 md:py-0 md:mb-3 md:cursor-default text-start">
        {/* `--muted`, not `--faint`: this is a column HEADING, not a caption. On the footer
            band it measured 2.79:1 in the light theme — --faint is sized for text on a card,
            and the band is the page colour with the grain over it. */}
        <span className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">{title}</span>
        <ChevronDown size={15} className={`md:hidden text-[var(--muted)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <div className={`foot-col-links flex-col gap-2.5 pb-2 md:pb-0 md:flex ${open ? 'flex' : 'hidden'}`}>{links.map(render)}</div>
    </div>
  );
}
// Compact newsletter signup for the footer — mobile-clean (input + button stack /
// stay side-by-side with min-w-0). Shows a success toast on subscribe (#5).
function FooterNewsletter({ cfg, inert = false }) {
  const { t, lang } = useI18n();
  // An empty field means "keep following the dictionary", so a site that never edits the
  // copy still switches language properly. Only a value someone typed wins.
  const pick = (en, fr, fallback) => ((lang === 'fr' && fr && fr.trim()) ? fr : (en && en.trim()) ? en : fallback);
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (inert || !email.trim() || busy) return; // N-topbar: the admin's preview never subscribes anybody
    setBusy(true);
    try {
      await api.post('/newsletter/subscribe', { email: email.trim(), locale: lang === 'fr' ? 'fr' : 'en' });
      toast.success(t('news.check', 'Almost there, check your inbox to confirm your subscription.'));
      setEmail('');
    } catch { toast.error(t('news.err', 'Could not subscribe, check the address and try again.')); }
    finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="mt-5 md:mt-6 max-w-md md:max-w-xs">
      <div className="text-xs font-semibold uppercase tracking-wider text-[var(--faint)] mb-2">{pick(cfg?.title, cfg?.titleFr, t('news.foot', 'Newsletter'))}</div>
      {pick(cfg?.text, cfg?.textFr, '') && <p className="text-xs text-[var(--muted)] mb-2 leading-relaxed">{pick(cfg?.text, cfg?.textFr, '')}</p>}
      <div className="flex gap-2">
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder={pick(cfg?.placeholder, cfg?.placeholderFr, t('news.ph', 'you@example.com'))}
          className="input flex-1 min-w-0" />
        <button type="submit" disabled={busy} className="shrink-0 rounded-lg bg-[var(--primary)] text-[var(--on-primary)] px-3.5 py-2 text-sm font-semibold hover:brightness-110 disabled:opacity-50 transition">{busy ? '…' : pick(cfg?.button, cfg?.buttonFr, t('news.cta', 'Subscribe'))}</button>
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
      <button onClick={onClick} className="foot-egg flex items-center gap-1.5 hover:text-[var(--muted)] transition select-none" title="✨">
        <Sparkles size={12} className="text-[var(--accent-ink)]" /> {t('foot.built', 'Built for the Better* community')}
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
              : claimed ? <p className="text-sm font-medium text-[var(--accent-ink)] flex items-center justify-center gap-1.5"><CheckCircle2 size={15} /> {t('egg.done', 'Added to your profile.')}</p>
              : <Button variant="primary" onClick={claim}>{t('egg.claim', 'Claim badge')}</Button>}
          </div>
        </div>
      </Modal>}
    </>
  );
}

// N-topbar (agent-topbar-N): `preview` = { cfg } renders the footer from an admin's DRAFT, for the
// footer editor's Live preview (pages/admin.jsx). `cfg` is what GET /footer would return for it:
// the config when "Use this footer" is on, null (the built-in footer) when it is off. Exported
// for that preview only, like <Nav preview>: one component, so the preview cannot drift.
export function Footer({ preview = null } = {}) {
  const { t, lang } = useI18n();
  const liveCfg = useFooterConfig();
  const cfg = preview ? preview.cfg : liveCfg;
  const rootRef = useRef(null);
  // Which device is on screen. The `on` filter REMOVES links rather than hiding them, so it
  // has to be decided in JS: a CSS-hidden link is still in the DOM and still announced by a
  // screen reader, which is not what "hide this on mobile" means.
  // Asked of the window the footer is laid out in: the page's, or the preview frame's (a 375px
  // frame is a phone even when the admin's window is 1280px wide).
  const [isMobile, setIsMobile] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(max-width: 767px)').matches);
  useEffect(() => {
    const win = rootRef.current?.ownerDocument?.defaultView || (typeof window !== 'undefined' ? window : null);
    if (!win || typeof win.matchMedia === 'undefined') return undefined;
    const mq = win.matchMedia('(max-width: 767px)');
    setIsMobile(mq.matches);
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
  // `socials` accepts three stored shapes, because it started life as a boolean and saved
  // configs still hold one: absent/true = the built-in row, false = no row, array = itself.
  // Treating the boolean as "not an array" and rendering nothing would have silently wiped
  // the social row from every footer already configured.
  const rawSocials = cfg?.brand?.socials;
  const socials = Array.isArray(rawSocials) ? rawSocials.filter((x) => x && x.href && x.icon)
    : rawSocials === false ? []
    : DEFAULT_FOOTER_SOCIALS;
  // Same three shapes for the newsletter block.
  const rawNews = cfg?.brand?.newsletter;
  const news = (rawNews && typeof rawNews === 'object') ? rawNews : { on: rawNews !== false };
  const bottom = cfg?.bottom || {};
  const year = new Date().getFullYear();
  const bottomText = frOr(bottom.textFr, bottom.text);
  return (
    // `plate plate-band`: the footer is a band of the page colour, so its small faint text
    // is read on the page and not on whatever frame of the 3D backdrop is behind it.
    <footer ref={rootRef} className="plate plate-band mt-16 md:mt-24 relative clear-both">
      {/* gradient accent line */}
      <div className="h-px bg-gradient-to-r from-transparent via-[var(--primary)] to-transparent" />
      {/* Phone (below md): one column in reading order, brand, socials, newsletter, status,
          then the link columns folded into ONE grouped box, then the fine print. Measured at
          375 before this pass: 778px of footer, the uptime figure wrapping onto its own line
          as "· 99.5% over 90 days", and 96px of bottom padding stacked on top of the bottom
          bar's own spacer (the page already ends above the bar: .mbar-spacer follows). */}
      <div className={`foot-body max-w-6xl mx-auto px-4 pt-8 pb-6 md:py-14 md:grid md:gap-10 ${cfg?.mobile?.layout === 'grid' ? 'grid grid-cols-2 gap-x-6 gap-y-6' : 'flex flex-col'}`}
        style={{ gridTemplateColumns: `1.4fr repeat(${cols.length || 3}, 1fr)` }}>
        {/* brand block — hidden on a phone when the config says so */}
        {(!isMobile || cfg?.mobile?.brand !== false) && (
        <div className={`mb-6 md:mb-0 ${cfg?.mobile?.layout === 'grid' ? 'col-span-2 md:col-span-1' : ''}`}>
          <div className="flex items-center gap-2.5 font-extrabold text-lg">
            <BrandMark src={cfg?.brand?.logo || ''} className="w-8 h-8 rounded-xl object-contain shrink-0" />
            {cfg?.brand?.name || 'BetterCommunity'}
          </div>
          <p className="text-sm text-[var(--muted)] mt-2 md:mt-3 max-w-xs leading-relaxed">{frOr(cfg?.brand?.taglineFr, cfg?.brand?.tagline) || t('foot.tagline')}</p>
          {socials.length > 0 && (
            <div className="flex items-center gap-2 mt-4 md:mt-5 flex-wrap">
              {socials.map((x, i) => <FooterSocial key={`${x.icon}-${i}`} item={x} />)}
            </div>
          )}
          {news.on !== false && <FooterNewsletter cfg={news} inert={!!preview} />}
          {/* Under the newsletter, because they are the same kind of thing: the two facts
              about the site itself that belong at the bottom of every page rather than in
              the middle of one. */}
          {cfg?.brand?.status !== false && <FooterStatus only={cfg?.brand?.statusServices || []} style={cfg?.brand?.statusStyle || 'line'} />}
        </div>
        )}
        {/* On a phone the columns are accordions, grouped in one box so they read as one
            list of three and not as three stray rules across the page. `md:contents` drops
            the box from md up, where each column is a cell of the footer grid again. */}
        <div className={`md:contents ${cfg?.mobile?.layout === 'grid' ? 'col-span-2 grid grid-cols-2 gap-x-6 gap-y-2' : 'foot-cols'}`}>
        {cols.length
          ? cols.map((c) => <FooterCol key={c.title} title={c.title} links={c.links} />)
          // The built-in footer, from the SAME list the admin editor edits and resets to.
          // It used to be written out again here, inline — so adding a link to
          // footer-default.js changed the editor and changed nothing on the site, which is
          // exactly what happened to the Status link.
          : DEFAULT_FOOTER_COLUMNS.map((c) => (
            <FooterCol key={c.key} title={t(c.key, c.title)}
              links={c.links.map((l) => [l.key ? t(l.key, l.label) : l.label, l.to, l.ext])} />
          ))}
        </div>
      </div>
      {/* The fine print. Centred and stacked on a phone (copyright, then language + the
          egg on one row); one justified row from md up. No bottom padding for the phone bar:
          the .mbar-spacer after the footer is exactly the bar's height already. */}
      <div className="border-t border-[var(--line)]"><div className="foot-fine max-w-6xl mx-auto px-4 py-4 md:py-5 flex flex-col md:flex-row md:flex-wrap items-center md:justify-between gap-x-4 gap-y-2 text-xs text-[var(--faint)] text-center md:text-start">
        {/* {year} is expanded here so "© {year} …" stays right on 1 January without an edit. */}
        <span>{bottom.copyright === false ? '' : (bottomText
          ? bottomText.replace(/\{year\}/g, year)
          : `© ${year} ${cfg?.brand?.name || 'BetterCommunity'}. ${t('foot.rights')}`)}</span>
        <div className="flex items-center justify-center gap-x-4 gap-y-1 flex-wrap">
          {/* Inert in the preview: they would switch the ADMIN's language, or call the badge API. */}
          {bottom.lang !== false && <span className={preview ? 'pointer-events-none contents' : 'contents'}><LangSelect type={bottom.langType || 'dropdown'} /></span>}
          {bottom.egg !== false && <span className={preview ? 'pointer-events-none contents' : 'contents'}><FooterEgg /></span>}
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
          <div className="w-12 h-12 rounded-2xl bg-orange-500/10 border border-[var(--line)] grid place-items-center mx-auto mb-3"><ShieldCheck size={22} className="text-[var(--accent-ink)]" /></div>
          <h1 className="text-lg font-semibold">{t('admin.2fa.title', 'Two-factor authentication required')}</h1>
          <p className="text-sm text-[var(--muted)] mt-1 mb-4">{t('admin.2fa.sub', 'The admin dashboard requires 2FA on your account, even for admins. Enable it in your profile to continue.')}</p>
          <Link to="/profile"><Button variant="primary" className="w-full">{t('admin.2fa.cta', 'Go to profile')}</Button></Link>
        </div>
      </div>
    );
  }
  return children;
}

const TITLES = { '/': 'Home', '/catalog': 'Catalog', '/submit': 'Submit', '/blog': 'Blog', '/docs': 'Docs', '/faq': 'FAQ', '/repos': 'Server Repos', '/hosting': 'Hosting', '/projects': 'Projects', '/contact': 'Contact', '/auth': 'Sign in', '/profile': 'Profile', '/dashboard': 'Dashboard', '/admin': 'Admin', '/settings': 'Settings', '/2fa': 'Authenticator', '/legal': 'Legal', '/legal/about': 'About', '/legal/privacy': 'Privacy', '/legal/terms': 'Terms', '/legal/cookies': 'Cookies', '/legal/refunds': 'Payments & Refunds', '/legal/dpa': 'Data Processing Addendum' };

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
  const TONE = { info: 'bg-orange-500/10 border-orange-500/25 text-[var(--text)]', warning: 'bg-warning-bg border-warning-border text-warning', success: 'bg-success-bg border-success-border text-success' };
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

// Where the page is scrolled after a navigation.
//
// There was no rule at all: <main> swaps its children and the window keeps its scrollY, so
// opening a page from the footer of a long one landed you in the footer of the new one.
// The rules, in order:
//   · Back / Forward (POP) belong to the browser. Its own restoration puts you back where
//     you were; overriding it is what makes "back" feel broken.
//   · A URL with a #fragment scrolls to that element, clearing the sticky header (its
//     scroll-margin-top, or the header's measured height if that is larger). The element
//     may not exist yet (a lazy route, data still loading), so it is looked for a few times
//     over ~3s and the search stops the moment the reader scrolls on their own.
//   · A new PATH goes to the top.
//   · The same path with only the query changed does NOT move: that is a tab, a filter or
//     a sort (the admin's ?s=, the catalogue's filters), and jumping would lose your place.
//   · A caller can override per navigation with state { scroll: 'top' | 'keep' }.
// The first load is left alone unless it carries a fragment: a reload restores its own
// position, and a fresh visit is at the top anyway.
const ANCHOR_TRIES_MS = 3000;
function anchorTarget(id) {
  if (!id) return null;
  // B.MD prefixes heading ids with `user-content-` when it sanitizes, and the links that
  // point at them keep the bare slug (see the anchor-prefix trap): try both.
  return document.getElementById(id) || document.getElementById(`user-content-${id}`)
    || document.querySelector(`[name="${CSS.escape(id)}"]`);
}
function scrollToAnchor(el, smooth) {
  const header = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 68;
  const margin = Math.max(parseFloat(getComputedStyle(el).scrollMarginTop) || 0, header + 12);
  const top = el.getBoundingClientRect().top + window.scrollY - margin;
  window.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
}
// Where each history entry was scrolled to, by location.key. Needed for Back/Forward: the
// browser does restore, but it does so at popstate, BEFORE the previous page has rendered
// again (a lazy chunk, data still loading), so it clamps to whatever height the fallback has.
// Measured: bottom of /legal/privacy at y=10920, open /faq, Back -> y=456. The browser's
// attempt stands; this only finishes it once the page is tall enough again.
const SCROLL_AT = new Map();
// Retry `attempt` (returns true when done) for up to `ms`, and give up the moment the reader
// scrolls or types: moving them a second later, once they have started reading, is worse
// than not moving them at all.
function retryUntil(attempt, ms) {
  let done = false;
  let timer = null;
  const stop = () => { done = true; };
  const t0 = Date.now();
  const tick = () => {
    if (done) return;
    if (attempt()) { done = true; return; }
    if (Date.now() - t0 < ms) timer = setTimeout(tick, 120);
  };
  window.addEventListener('wheel', stop, { passive: true });
  window.addEventListener('touchmove', stop, { passive: true });
  window.addEventListener('keydown', stop);
  tick();
  return () => {
    done = true; clearTimeout(timer);
    window.removeEventListener('wheel', stop); window.removeEventListener('touchmove', stop); window.removeEventListener('keydown', stop);
  };
}
function useRouteScroll() {
  const loc = useLocation();
  const navType = useNavigationType();
  // Keyed by location.key, not "the previous run": StrictMode runs every effect twice, and a
  // plain previous-value ref made the second run see the SAME location as its predecessor,
  // so a fragment on first load was dropped (measured: /legal/privacy#s3 stayed at y=0).
  const hist = useRef({ key: null, loc: null, before: null });
  useEffect(() => {
    const h = hist.current;
    if (h.key !== loc.key) { h.before = h.loc; h.key = loc.key; h.loc = loc; }
    const before = h.before;
    const first = before === null;
    const saved = SCROLL_AT.get(loc.key);
    // Record this entry's position as the reader moves, for when they come back to it.
    const key = loc.key;
    const record = () => SCROLL_AT.set(key, window.scrollY);
    window.addEventListener('scroll', record, { passive: true });
    const cleanups = [() => window.removeEventListener('scroll', record)];
    const cleanup = () => cleanups.forEach((f) => f());

    if (navType === 'POP' && !first) {
      if (saved == null) return cleanup;   // an entry from before this page load: the browser's
      cleanups.push(retryUntil(() => {
        if (Math.abs(window.scrollY - saved) <= 2) return true;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        if (max + 2 < saved) return false;  // not tall enough yet: the page is still arriving
        window.scrollTo({ top: saved, left: 0, behavior: 'auto' });
        return true;
      }, 2500));
      return cleanup;
    }
    const want = loc.state && typeof loc.state === 'object' ? loc.state.scroll : undefined;
    if (want === 'keep') return cleanup;
    const samePath = !first && before.pathname === loc.pathname;
    let id = '';
    try { id = decodeURIComponent(loc.hash.replace(/^#/, '')); } catch { id = loc.hash.replace(/^#/, ''); }
    if (!id) {
      if (!first && (!samePath || want === 'top')) window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      return cleanup;
    }
    // A fragment. A new page starts from the top, so a target that never turns up leaves
    // you at the top of the page you asked for rather than at a stale depth.
    if (!first && !samePath) window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    const smooth = samePath && !prefersReducedMotion();
    cleanups.push(retryUntil(() => {
      const el = anchorTarget(id);
      if (el) scrollToAnchor(el, smooth);
      return !!el;
    }, ANCHOR_TRIES_MS));
    return cleanup;
    // loc.key changes on every navigation, including a click on the link you are already on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.key]);
}

export default function App() {
  const loc = useLocation();
  useRouteScroll();
  const toast = useToast();
  const { t, lang } = useI18n();
  // See BOOTED_OFFLINE above. One-way: it can only be cleared, by the network coming back.
  const [offline, setOffline] = useState(BOOTED_OFFLINE);
  // A studio page with its own 3D background takes the stage (hero/scene-stage.js): one scene,
  // one WebGL context per page, so the backdrop below steps down while it is shown.
  const pageScene = useSyncExternalStore(subscribeStage, stageClaimed, () => false);
  useEffect(() => {
    if (!offline) return undefined;
    const back = () => setOffline(false);
    window.addEventListener('online', back);
    return () => window.removeEventListener('online', back);
  }, [offline]);
  // Session replay is imported LAZILY and last: it is the only one of these that can pull in
  // rrweb, and a visitor who declined analytics or an install with the switch off must never
  // download it. initReplay() checks consent before the dynamic import resolves anything heavy.
  // One call, and the cookie banner makes the SAME one when the visitor accepts. This used
  // to be five separate starts here and a single `loadGtmIfConsented()` there — so on a first
  // visit GTM started on accept and interactions, vitals, errors and replay did not, for the
  // whole of the visit in which consent was actually given.
  useEffect(() => { startMeasurement(); }, []);
  // Search-engine head tags. Separate from the block above because it is NOT analytics and
  // must not be consent-gated: a description and an ownership token are part of the page, not
  // something done to the visitor.
  useEffect(() => { applySeoHead(lang); }, [lang]);
  // A single-page app serves the same HTML at every path, so without a canonical link every
  // route claims to be the same document — and duplicate content is the one SEO problem that
  // quietly caps a whole site rather than one page.
  useEffect(() => { setCanonical(loc.pathname); }, [loc.pathname]);
  // Global "you don't have permission" toast — the api client dispatches bcw:forbidden on
  // any missing_permission 403, so the user is told exactly what they lack no matter which
  // screen triggered it.
  useEffect(() => {
    const onForbidden = (e) => { const cap = e.detail?.capability; toast.error(t('perm.denied', "You don't have permission for this: “{cap}” is required.").replace('{cap}', t('perm.cap.' + cap, cap || 'this action'))); };
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
    // D4 (agent-admin-D): the scene's own "on each page change" transition, when the admin
    // configured one (hero/Hero3D.jsx decides; this only says a page changed).
    window.dispatchEvent(new CustomEvent('bcw:route-change'));
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
  // Per-route head: an instant title from the static table (so the tab never lags), then the
  // full set — title, description, og/twitter, robots, JSON-LD — from the API's resolver, the
  // same one crawlers are served. `alive` drops a slow answer that lands after the next
  // navigation, so a fast back-and-forth never leaves the previous page's title behind.
  useEffect(() => {
    const p = loc.pathname;
    let t = TITLES[p];
    if (!t) {
      if (p.startsWith('/p/')) t = (p.split('/')[2] || '').toUpperCase();
      else if (p.startsWith('/project/') || p.startsWith('/item/') || p.startsWith('/blog/')) t = 'BetterCommunity';
    }
    document.title = t && p !== '/' ? `${t} · BetterCommunity` : 'BetterCommunity: The home for all Better* projects';
    let alive = true;
    fetchRouteMeta(p, lang).then((m) => { if (alive && m && m.path === p) applyRouteMeta(m); });
    return () => { alive = false; };
  }, [loc.pathname, lang]);
  return (
    <IntroProvider>
      <div className="min-h-screen flex flex-col">
        {/* Keyboard skip link: first focusable element, off-screen until focused, so
            keyboard/screen-reader users can jump straight past the nav to the content. */}
        <a href="#main-content" className="skip-link">{t('a11y.skip', 'Skip to content')}</a>
        {/* Read once at mount, not reactively: turning the orb off mid-session and
            tearing down a live WebGL context is a worse experience than the reload the
            Settings row already tells you to do. Not rendering it means no GPU context and
            no render loop, which is the cost that is felt. M18 (agent-perf-M18): the three.js
            chunk is no longer preloaded either; main.jsx fetches it only when the orb is on. */}
        {/* Two votes, and only one of them can turn it ON.
            The visitor's preference is absolute: somebody who switched the orb off did so for
            motion, for a weak GPU, or because they did not want it, and no page setting
            overrides that. A built page can only take it AWAY — which is what a custom
            landing page with its own full-bleed hero needs, and why there is no `orb: 'on'`.
            Read at mount like the preference itself: tearing down a live WebGL context on a
            route change is worse than the backdrop being constant. */}
        {/* Its own boundary: if the 3D chunk cannot be fetched at all (after lazyChunk's retry and
            reload), the throw used to reach the ROOT boundary and replace the whole site with the
            error card, for a decorative backdrop. Contained here, the page renders without it;
            every other failure mode is handled inside Hero3D with a still drawing of the scene. */}
        {/* A page that brings its own 3D background (a studio page, PLAN-STUDIO-2026 2.4) takes
            the backdrop's place while it is shown: a page has one scene and one WebGL context. */}
        {!getHero3dDisabled() && !pageScene && <ErrorBoundary fallback={null}><Suspense fallback={null}><Hero3D /></Suspense></ErrorBoundary>}
        <AppReveal>
          <PromoBadge />
          <EventEffect />
          <Nav />
          {/* relative z-10: keep the page content (and any in-page overlays like the
              mobile dashboard nav sheet) stacked ABOVE the footer, which follows in the
              DOM and would otherwise paint over an open dropdown on short pages. */}
          <LocaleSync />
          <CommandPalette />
          <ShortcutsHost />
          <SanctionBanner />
          <LegalReaccept />
          {/* One-time, and it answers the cookie question itself — so it replaces the
              banner rather than stacking a second prompt on top of it. */}
          <WelcomePrefs />
          <main ref={mainRef} id="main-content" tabIndex={-1}
            className={`relative z-10 flex-1 w-full mx-auto px-4 py-10 anim-fade ${/^\/docs(\/|$)/.test(loc.pathname) ? 'max-w-[84rem]' : 'max-w-6xl'}`}>
            <Suspense fallback={<div className="flex justify-center py-20 text-[var(--muted)]"><span className="anim-fade">…</span></div>}>
            {offline ? <NotFound offline /> : (
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/catalog" element={<Catalog />} />
              <Route path="/submit" element={<Submit />} />
              <Route path="/c/:slug" element={<CommunityCatalogPage />} />
              <Route path="/catalog/:scope/:ref/:id" element={<ProjectCatalogPage />} />
              <Route path="/r/:id" element={<RepoPublicPage />} />
              <Route path="/item/:slug" element={<ItemDetail />} />
              <Route path="/giveaways" element={<Giveaways />} />
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
              {/* No auth guard, deliberately: this is the page that STOPS a deletion,
                  and the person clicking it may not be signed in anywhere. */}
              <Route path="/account/closure/cancel" element={<ClosureCancel />} />
          {/* Open to visitors: a poll whose audience is "everyone" has to be reachable
              without an account, and one for members says so on the card itself. */}
          <Route path="/polls" element={<PollsPage />} />
          <Route path="/charity" element={<CharityPage />} />
          {/* An unlisted poll is in no list by design, so a link to /polls cannot reach it —
              this is the only way in, and ?k= is read from the query string. */}
          <Route path="/polls/:id" element={<SinglePollPage />} />
          {/* Open to visitors: reading how to build against the site should not require
              an account, and the two things that do (an app, a key) say so themselves. */}
          <Route path="/status" element={<StatusPage />} />
          <Route path="/dev" element={<DevHub />} />
          <Route path="/dev/config" element={<DevConfig />} />
          <Route path="/notifications" element={<NotificationCentre />} />
          {/* Every moderation e-mail has been linking here. It did not exist — the notice
              went out with a "read it and contest" button that landed on the 404 page. */}
          <Route path="/sanctions/:code" element={<SanctionPage />} />
          <Route path="/dev/tools" element={<DevTools />} />
          <Route path="/dev/markdown" element={<DevMarkdown />} />
          <Route path="/dev/bmd" element={<DevBmd />} />
          <Route path="/dev/editor" element={<DevEditor />} />
              <Route path="/authorize" element={<Authorize />} />
              <Route path="/verify-email" element={<VerifyEmail />} />
              <Route path="/contact" element={<Contact />} />
              <Route path="/verify-copy" element={<CopyVerify />} />
              <Route path="/report" element={<ReportPage />} />
              <Route path="/messages/t/:token" element={<AnonThreadPage />} />
              <Route path="/teams/join/:token" element={<TeamJoin />} />
              <Route path="/t/:slug" element={<TeamPage />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/2fa" element={<TwoFactor />} />
              <Route path="/legal" element={<LegalIndex />} />
              {/* Archived versions. Linked from the admin editor and from an acceptance
                  record, so this route is what makes those references resolve. */}
              <Route path="/legal/archive/:id" element={<LegalArchive />} />
              <Route path="/f/:token" element={<FileLink />} />
              <Route path="/legal/about" element={<Legal page="about" />} />
              <Route path="/legal/privacy" element={<Legal page="privacy" />} />
              <Route path="/legal/terms" element={<Legal page="terms" />} />
              <Route path="/legal/cookies" element={<Legal page="cookies" />} />
              <Route path="/legal/refunds" element={<Legal page="refunds" />} />
              {/* Anything an admin created. The five static paths above still win — the
                  router ranks a literal segment over a dynamic one regardless of order — and
                  /legal/archive/:id wins on segment count, so a document keyed "archive"
                  cannot shadow the archive. Written last because that is how it reads. */}
              <Route path="/legal/:key" element={<Legal />} />
              {/* Old flat URLs → new /legal/* (keep existing links & SEO working) */}
              <Route path="/about" element={<Navigate to="/legal/about" replace />} />
              <Route path="/privacy" element={<Navigate to="/legal/privacy" replace />} />
              <Route path="/terms" element={<Navigate to="/legal/terms" replace />} />
              <Route path="/cookies" element={<Navigate to="/legal/cookies" replace />} />
              <Route path="/refunds" element={<Navigate to="/legal/refunds" replace />} />
              <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
              <Route path="/admin" element={<Protected role={['MOD', 'ADMIN']}><Admin /></Protected>} />
              {/* The studio on its own surface (pages/studio.jsx). Signed-in only here; WHO may
                  draw is the page's own guard (lib/roles.js canUseStudio, then the server):
                  the admin's role gate let any MOD or page grantee in (PLAN-STUDIO-2026 1.5).
                  It draws itself over the shell (position: fixed), so it sits inside <main>
                  like every other route without needing a second layout. */}
              <Route path="/studio/:kind/:id/:index?" element={<Protected><StudioPage /></Protected>} />
              <Route path="*" element={<NotFound />} />
            </Routes>
            )}
            </Suspense>
          </main>
          <Footer />
          <MobileTabBar />
          <CookieConsent />
          <PwaUpdatePrompt />
          <PwaInstallPrompt />
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
