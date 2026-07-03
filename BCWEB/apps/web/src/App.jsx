import { useEffect, useState, useRef } from 'react';
import { Routes, Route, Link, NavLink, Navigate, useLocation } from 'react-router-dom';
import { Boxes, Music2, Newspaper, Server, Rocket, LayoutDashboard, Shield, LogOut, Download, Menu, X, Sparkles, Bell, Trash2, CheckCheck, Mail, Home as HomeIcon, ChevronDown, MoreHorizontal, LayoutGrid, ShieldCheck, ArrowUpRight, Info, AlertTriangle, CheckCircle2, Settings as SettingsIcon } from 'lucide-react';
import { useAuth } from './auth.jsx';
import { api } from './api.js';
import { Button } from './ui.jsx';
import { ThemeToggle } from './theme.jsx';
import { useI18n, LangToggle, LangSelect } from './i18n.jsx';
import { KofiIcon, GithubIcon, DiscordIcon, RedditIcon } from './brand.jsx';
import { trackPageview } from './analytics.js';
import { loadGtmIfConsented } from './gtm.js';
import { getOrbTransitionPref } from './prefs.js';
import CookieConsent from './CookieConsent.jsx';
import Hero3D from './Hero3D.jsx';
import { IntroProvider, useIntro } from './IntroContext.jsx';
import ProjectPage, { OtherProjects, ShowcaseProjectPage } from './project.jsx';
import Profile from './profile.jsx';
import Avatar from './Avatar.jsx';
import { BlogList, BlogPostPage } from './blog.jsx';
import { ReposPage } from './repos.jsx';
import { RepoDashboard } from './repo-dashboard.jsx';
import { Home, Catalog, ItemDetail, Hosting, Auth, Dashboard, Admin, Legal, Contact, Settings, NOTIF, NOTIF_FALLBACK } from './pages.jsx';

const KOFI = 'https://ko-fi.com/bettercommunity';
const NAV = [
  { to: '/p/bmm', k: 'nav.bmm', icon: Boxes, img: '/icons/bmm.png' },
  { to: '/p/bsm', k: 'nav.bsm', icon: Music2, img: '/icons/bsm.png' },
  { to: '/p/installer', k: 'nav.installer', icon: Download, img: '/icons/bi.png' },
  { to: '/blog', k: 'nav.blog', icon: Newspaper },
  { to: '/repos', k: 'nav.repos', icon: Server },
  { to: '/hosting', k: 'nav.hosting', icon: Rocket },
];

// Real app icon when /icons/<app>.png exists, otherwise the lucide fallback.
function NavIcon({ item, size = 15 }) {
  const [ok, setOk] = useState(!!item.img);
  if (item.img && ok) return <img src={item.img} alt="" width={size + 3} height={size + 3} className="rounded-[4px] object-contain" onError={() => setOk(false)} />;
  const I = item.icon;
  return <I size={size} />;
}

function timeAgo(d, justnow) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return justnow;
  const m = Math.floor(s / 60); if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// Global notifications bell — visible on every page in the topbar when signed in.
function NavNotifications() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const ref = useRef(null);
  const load = () => api.get('/me/notifications').then((d) => setItems(d.notifications || [])).catch(() => {});
  useEffect(() => { load(); const id = setInterval(load, 60000); return () => clearInterval(id); }, []);
  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc); return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  const unread = items.filter((n) => !n.readAt).length;
  const markOne = async (n) => { if (n.readAt) return; setItems((s) => s.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x))); try { await api.post(`/me/notifications/${n.id}/read`); } catch {} };
  const markAll = async () => { setItems((s) => s.map((x) => ({ ...x, readAt: x.readAt || new Date().toISOString() }))); try { await api.post('/me/notifications/read-all'); } catch {} };
  const del = async (n) => { setItems((s) => s.filter((x) => x.id !== n.id)); try { await api.del(`/me/notifications/${n.id}`); } catch {} };
  // Menu-only dismiss — just clears what's shown here, nothing is deleted server-side
  // (they'll be back next reload). The dashboard's Notifications tab has the real
  // "delete everything" action.
  const clearMenu = () => setItems([]);
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
              <button onClick={() => markOne(n)} className="flex gap-2.5 items-start text-left min-w-0 flex-1">
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
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const segNavRef = useRef(null);
  // Which fixed-project pills the CURRENT visitor can actually view (per-key
  // visibility, computed server-side) + any showcase projects an admin pinned
  // to the topbar (task: Project Announcement pages / visibility system).
  const [projVisible, setProjVisible] = useState(null); // { bmm: true, bsm: false, ... } | null (not loaded yet -> show all)
  const [pinnedShowcase, setPinnedShowcase] = useState([]);
  useEffect(() => {
    api.get('/projects').then((r) => setProjVisible(r.visible || null)).catch(() => {});
    api.get('/showcase').then((r) => setPinnedShowcase((r.projects || []).filter((p) => p.pinTopbar))).catch(() => {});
  }, []);
  const visibleNav = NAV.filter((n) => {
    const key = n.to.replace('/p/', '');
    return !projVisible || projVisible[key] !== false;
  });
  // Segmented "pill" nav links (desktop).
  const pill = ({ isActive }) => `flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition ${isActive ? 'bg-[var(--bg-solid)] text-[var(--primary)] shadow-sm font-medium' : 'text-[var(--muted)] hover:text-[var(--text)]'}`;
  const sheet = ({ isActive }) => `flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm ${isActive ? 'bg-[var(--surface-2)] text-[var(--primary)] font-medium' : 'text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'}`;
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
        <nav ref={segNavRef} className="hidden lg:flex items-center gap-0.5 rounded-full bg-[var(--surface-2)] p-1 border border-[var(--line)] min-w-0 overflow-x-auto no-scrollbar">
          {visibleNav.map((n) => <NavLink key={n.to} to={n.to} title={t(n.k)} className={(s) => pill(s) + ' shrink-0'}><NavIcon item={n} size={15} /><span className="hidden 2xl:inline">{t(n.k)}</span></NavLink>)}
          {pinnedShowcase.map((p) => (
            <NavLink key={p.slug} to={`/project/${p.slug}`} title={p.name} className={(s) => pill(s) + ' shrink-0'}>
              <Sparkles size={15} /><span className="hidden 2xl:inline">{p.isAnnouncing ? p.announceTitle || p.name : p.name}</span>
            </NavLink>
          ))}
        </nav>
        <div className="flex-1 min-w-[8px]" />
        {/* Right cluster, grouped by purpose: content actions (Projects,
            notifications) · then preferences (language, theme, settings), split
            by a subtle divider so it reads as two tidy groups, not one jumble. */}
        <div className="flex items-center gap-0.5 shrink-0">
          <NavLink to="/projects" className={({ isActive }) => `nav-link !px-2 ${isActive ? 'nav-link-active' : ''}`} title={t('nav.projects')} aria-label={t('nav.projects')}><Boxes size={16} /></NavLink>
          {user && <NavNotifications />}
          <span className="w-px h-5 bg-[var(--line)] mx-1" />
          <LangToggle />
          <ThemeToggle />
          <NavLink to="/settings" className={({ isActive }) => `nav-link !px-2 ${isActive ? 'nav-link-active' : ''}`} title={t('nav.settings', 'Settings')} aria-label="Settings"><SettingsIcon size={16} /></NavLink>
        </div>
        <div className="hidden lg:flex items-center gap-1 shrink-0 pl-1 ml-1 border-l border-[var(--line)]">
          {user ? (
            <>
              <NavLink to="/dashboard" className={(s) => pill(s) + ' !py-2'} title={t('nav.dashboard')}><LayoutDashboard size={15} /><span className="hidden xl:inline">{t("nav.dashboard")}</span></NavLink>
              {(user.role === 'ADMIN' || user.role === 'MOD' || user.role === 'SUPERADMIN') && <NavLink to="/admin" className={(s) => pill(s) + ' !py-2'} title={t('nav.admin')}><Shield size={15} /><span className="hidden xl:inline">{t("nav.admin")}</span></NavLink>}
              <Link to="/profile" className="rounded-full p-0.5 hover:ring-2 hover:ring-[var(--line-strong)] transition" title={user.displayName}><Avatar user={user} size={28} /></Link>
              <Button variant="ghost" size="sm" onClick={logout} title={t('nav.signout')}><LogOut size={15} /></Button>
            </>
          ) : <Link to="/auth"><Button variant="primary" size="sm" className="whitespace-nowrap rounded-full">{t("nav.signin")}</Button></Link>}
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
            {visibleNav.map((n) => <NavLink key={n.to} to={n.to} className={sheet} onClick={() => setOpen(false)}><NavIcon item={n} size={16} />{t(n.k)}</NavLink>)}
            {pinnedShowcase.map((p) => <NavLink key={p.slug} to={`/project/${p.slug}`} className={sheet} onClick={() => setOpen(false)}><Sparkles size={16} />{p.isAnnouncing ? p.announceTitle || p.name : p.name}</NavLink>)}
            <NavLink to="/projects" className={sheet} onClick={() => setOpen(false)}><Boxes size={16} /> {t('nav.projects')}</NavLink>
            <NavLink to="/contact" className={sheet} onClick={() => setOpen(false)}><Mail size={16} /> Contact</NavLink>
            <NavLink to="/settings" className={sheet} onClick={() => setOpen(false)}><SettingsIcon size={16} /> {t('nav.settings', 'Settings')}</NavLink>
          </div>
          <div className="h-px bg-[var(--line)] my-2" />
          <div className="grid grid-cols-2 gap-1">
            {user ? (<>
              <NavLink to="/dashboard" className={sheet} onClick={() => setOpen(false)}><LayoutDashboard size={16} />{t("nav.dashboard")}</NavLink>
              {(user.role === 'ADMIN' || user.role === 'MOD' || user.role === 'SUPERADMIN') && <NavLink to="/admin" className={sheet} onClick={() => setOpen(false)}><Shield size={16} />{t("nav.admin")}</NavLink>}
              <NavLink to="/profile" className={sheet} onClick={() => setOpen(false)}><Avatar user={user} size={18} /> Profile</NavLink>
              <button className={sheet({ isActive: false }) + ' text-left'} onClick={() => { logout(); setOpen(false); }}><LogOut size={16} />{t("nav.signout")}</button>
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
  const { t } = useI18n();
  const [showLabels, setShowLabels] = useState(true);
  useEffect(() => {
    let tmr;
    const onScroll = () => { setShowLabels(false); clearTimeout(tmr); tmr = setTimeout(() => setShowLabels(true), 220); };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); clearTimeout(tmr); };
  }, []);
  const tab = ({ isActive }) => `flex-1 flex flex-col items-center justify-center py-1.5 ${isActive ? 'text-[var(--primary)]' : 'text-[var(--muted)]'}`;
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-[var(--line)] topbar flex items-stretch px-1" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {BOTTOM.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.exact} className={tab}>
          {({ isActive }) => <>
            <span className={`grid place-items-center w-9 h-7 rounded-full transition ${isActive ? 'bg-[var(--surface-2)]' : ''}`}><NavIcon item={n} size={18} /></span>
            <span className={`text-[10px] leading-none overflow-hidden transition-all duration-200 ${showLabels ? 'max-h-4 opacity-100 mt-0.5' : 'max-h-0 opacity-0 mt-0'}`}>{t(n.k)}</span>
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
function Footer() {
  const { t } = useI18n();
  return (
    <footer className="mt-24 relative">
      {/* gradient accent line */}
      <div className="h-px bg-gradient-to-r from-transparent via-[var(--primary)]/40 to-transparent" />
      <div className="max-w-6xl mx-auto px-4 py-14 flex flex-col md:grid md:gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        {/* brand block */}
        <div className="mb-4 md:mb-0">
          <div className="flex items-center gap-2.5 font-extrabold text-lg"><img src="/logo.png" alt="BC" className="w-9 h-9 rounded-xl" /> BetterCommunity</div>
          <p className="text-sm text-[var(--muted)] mt-3 max-w-xs leading-relaxed">{t('foot.tagline')}</p>
          <div className="flex items-center gap-2 mt-5">
            {SOCIAL.map((s) => (
              <a key={s.label} href={s.href} target="_blank" rel="noreferrer" title={s.label}
                className="grid place-items-center w-9 h-9 rounded-xl border border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--line-strong)] hover:bg-[var(--surface-2)] transition">
                <s.Icon size={16} className={s.kofi ? 'text-orange-400' : ''} />
              </a>
            ))}
          </div>
        </div>
        <FooterCol title={t('foot.products')} links={[['BMM', '/p/bmm'], ['BSM', '/p/bsm'], ['BetterInstaller', '/p/installer'], [t('nav.hosting'), '/hosting']]} />
        <FooterCol title={t('foot.community')} links={[[t('foot.about', 'About'), '/about'], ['Blog', '/blog'], [t('nav.repos'), '/repos'], ['Contact', '/contact'], [t('foot.kofi'), KOFI, true]]} />
        <FooterCol title={t('foot.legal')} links={[[t('foot.privacy'), '/privacy'], [t('foot.terms'), '/terms'], [t('foot.cookies'), '/cookies'], [t('foot.refunds', 'Payments & Refunds'), '/refunds']]} />
      </div>
      <div className="border-t border-[var(--line)]"><div className="max-w-6xl mx-auto px-4 py-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 text-xs text-[var(--faint)] pb-24 md:pb-5">
        <span>© {new Date().getFullYear()} BetterCommunity. {t('foot.rights')}</span>
        <div className="flex items-center gap-4 flex-wrap">
          <LangSelect />
          <span className="flex items-center gap-1.5"><Sparkles size={12} className="text-[var(--primary-2)]" /> Built for the Better* community</span>
        </div>
      </div></div>
    </footer>
  );
}

const ADMIN_TIER_ROLES = ['MOD', 'ADMIN', 'SUPERADMIN'];

function Protected({ children, role }) {
  const { t } = useI18n();
  const { user, loading } = useAuth();
  if (loading) return <div className="max-w-6xl mx-auto p-8 text-[var(--muted)]">Loading…</div>;
  if (!user) return <Navigate to="/auth" replace />;
  // SUPERADMIN implicitly satisfies every route role-gate — same reasoning as the
  // backend's requireRole() — instead of retrofitting every <Protected role={...}> call site.
  if (role && user.role !== 'SUPERADMIN' && !role.includes(user.role)) return <Navigate to="/" replace />;
  // The admin dashboard (and everything it talks to — the API enforces this too,
  // in requireRole()) requires 2FA, whatever the exact role — a password alone
  // isn't enough for a surface this privileged.
  if (role && ADMIN_TIER_ROLES.includes(user.role) && !user.totpEnabled) {
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

const TITLES = { '/': 'Home', '/catalog': 'Catalog', '/blog': 'Blog', '/repos': 'Server Repos', '/hosting': 'Hosting', '/projects': 'Projects', '/contact': 'Contact', '/auth': 'Sign in', '/profile': 'Profile', '/dashboard': 'Dashboard', '/admin': 'Admin', '/settings': 'Settings', '/about': 'About', '/privacy': 'Privacy', '/terms': 'Terms', '/cookies': 'Cookies', '/refunds': 'Payments & Refunds' };

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
  useEffect(() => { loadGtmIfConsented(); }, []);
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
        <Hero3D />
        <AppReveal>
          <Nav />
          <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-10 anim-fade">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/catalog" element={<Catalog />} />
              <Route path="/item/:slug" element={<ItemDetail />} />
              <Route path="/blog" element={<BlogList />} />
              <Route path="/blog/:slug" element={<BlogPostPage />} />
              <Route path="/repos" element={<ReposPage />} />
              <Route path="/repo/:id" element={<RepoDashboard />} />
              <Route path="/hosting" element={<Hosting />} />
              <Route path="/p/:key" element={<ProjectPage />} />
              <Route path="/projects" element={<OtherProjects />} />
              <Route path="/project/:slug" element={<ShowcaseProjectPage />} />
              <Route path="/profile" element={<Protected><Profile /></Protected>} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/contact" element={<Contact />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/about" element={<Legal page="about" />} />
              <Route path="/privacy" element={<Legal page="privacy" />} />
              <Route path="/terms" element={<Legal page="terms" />} />
              <Route path="/cookies" element={<Legal page="cookies" />} />
              <Route path="/refunds" element={<Legal page="refunds" />} />
              <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
              <Route path="/admin" element={<Protected role={['MOD', 'ADMIN']}><Admin /></Protected>} />
              <Route path="*" element={<div className="text-[var(--muted)]">Not found.</div>} />
            </Routes>
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
