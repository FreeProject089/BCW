import { useEffect, useState } from 'react';
import { Routes, Route, Link, NavLink, Navigate, useLocation } from 'react-router-dom';
import { Boxes, Music2, Newspaper, Server, Rocket, LayoutDashboard, Shield, LogOut, Download, Menu, X, Heart } from 'lucide-react';
import { useAuth } from './auth.jsx';
import { Button } from './ui.jsx';
import { ThemeToggle } from './theme.jsx';
import { useI18n, LangToggle } from './i18n.jsx';
import { trackPageview } from './analytics.js';
import CookieConsent from './CookieConsent.jsx';
import Hero3D from './Hero3D.jsx';
import ProjectPage from './project.jsx';
import Profile from './profile.jsx';
import Avatar from './Avatar.jsx';
import { BlogList, BlogPostPage } from './blog.jsx';
import { ReposPage } from './repos.jsx';
import { Home, Catalog, ItemDetail, Hosting, Auth, Dashboard, Admin, Legal } from './pages.jsx';

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

function Nav() {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const cls = ({ isActive }) => 'nav-link' + (isActive ? ' nav-link-active' : '');
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--line)] topbar">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center gap-1">
        <Link to="/" className="flex items-center gap-2 font-extrabold text-[15px] mr-2" onClick={() => setOpen(false)}>
          <img src="/logo.png" alt="BC" className="w-8 h-8 rounded-lg" />
          <span className="text-[var(--text)]">BetterCommunity</span>
        </Link>
        <nav className="hidden md:flex items-center gap-0.5">
          {NAV.map((n) => <NavLink key={n.to} to={n.to} className={cls}><NavIcon item={n} size={15} />{t(n.k)}</NavLink>)}
        </nav>
        <div className="flex-1" />
        <LangToggle />
        <ThemeToggle />
        <div className="hidden md:flex items-center gap-1">
          {user ? (
            <>
              <NavLink to="/dashboard" className={cls}><LayoutDashboard size={15} />{t("nav.dashboard")}</NavLink>
              {(user.role === 'ADMIN' || user.role === 'MOD') && <NavLink to="/admin" className={cls}><Shield size={15} />{t("nav.admin")}</NavLink>}
              <Link to="/profile" className="nav-link !px-1" title={user.displayName}><Avatar user={user} size={26} /></Link>
              <Button variant="ghost" size="sm" onClick={logout} title="Sign out"><LogOut size={15} /></Button>
            </>
          ) : <Link to="/auth"><Button variant="primary" size="sm">{t("nav.signin")}</Button></Link>}
        </div>
        <button className="md:hidden nav-link" onClick={() => setOpen((v) => !v)} aria-label="Menu">{open ? <X size={20} /> : <Menu size={20} />}</button>
      </div>
      {/* mobile menu */}
      {open && (
        <div className="md:hidden border-t border-[var(--line)] px-4 py-3 flex flex-col gap-1 topbar anim-fade">
          {NAV.map((n) => <NavLink key={n.to} to={n.to} className={cls} onClick={() => setOpen(false)}><NavIcon item={n} size={16} />{t(n.k)}</NavLink>)}
          <div className="h-px bg-[var(--line)] my-1" />
          {user ? (<>
            <NavLink to="/dashboard" className={cls} onClick={() => setOpen(false)}><LayoutDashboard size={16} />{t("nav.dashboard")}</NavLink>
            {(user.role === 'ADMIN' || user.role === 'MOD') && <NavLink to="/admin" className={cls} onClick={() => setOpen(false)}><Shield size={16} />{t("nav.admin")}</NavLink>}
            <NavLink to="/profile" className={cls} onClick={() => setOpen(false)}><Avatar user={user} size={18} /> Profile</NavLink>
            <button className="nav-link text-left" onClick={() => { logout(); setOpen(false); }}><LogOut size={16} />{t("nav.signout")}</button>
          </>) : <Link to="/auth" onClick={() => setOpen(false)}><Button variant="primary" className="w-full mt-1">{t("nav.signin")}</Button></Link>}
        </div>
      )}
    </header>
  );
}

function Footer() {
  const { t } = useI18n();
  const col = (title, links) => (
    <div><div className="text-xs font-semibold text-[var(--faint)] uppercase tracking-wider mb-3">{title}</div>
      <div className="flex flex-col gap-2">{links.map(([l, to, ext]) => ext
        ? <a key={l} href={to} target="_blank" rel="noreferrer" className="text-sm text-[var(--muted)] hover:text-[var(--text)]">{l}</a>
        : <Link key={l} to={to} className="text-sm text-[var(--muted)] hover:text-[var(--text)]">{l}</Link>)}</div></div>
  );
  return (
    <footer className="border-t border-[var(--line)] mt-24">
      <div className="max-w-6xl mx-auto px-4 py-12 grid grid-cols-2 md:grid-cols-4 gap-8">
        {col(t('foot.products'), [['BMM', '/p/bmm'], ['BSM', '/p/bsm'], ['BetterInstaller', '/p/installer'], [t('nav.hosting'), '/hosting']])}
        {col(t('foot.community'), [['Blog', '/blog'], [t('nav.repos'), '/repos'], [t('foot.kofi'), KOFI, true]])}
        {col(t('foot.legal'), [[t('foot.privacy'), '/privacy'], [t('foot.terms'), '/terms'], [t('foot.cookies'), '/cookies']])}
        <div><div className="flex items-center gap-2 font-bold"><img src="/logo.png" alt="BC" className="w-6 h-6 rounded-md" /> BetterCommunity</div>
          <p className="text-sm text-[var(--muted)] mt-2">{t('foot.tagline')}</p>
          <a href={KOFI} target="_blank" rel="noreferrer" className="btn btn-sm mt-3"><Heart size={14} className="text-orange-400" /> Ko-fi</a></div>
      </div>
      <div className="border-t border-[var(--line)]"><div className="max-w-6xl mx-auto px-4 py-5 text-xs text-[var(--faint)]">© {new Date().getFullYear()} BetterCommunity. {t('foot.rights')}</div></div>
    </footer>
  );
}

function Protected({ children, role }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="max-w-6xl mx-auto p-8 text-[var(--muted)]">Loading…</div>;
  if (!user) return <Navigate to="/auth" replace />;
  if (role && !role.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const loc = useLocation();
  useEffect(() => { trackPageview(loc.pathname + loc.search); }, [loc.pathname, loc.search]);
  return (
    <div className="min-h-screen flex flex-col">
      <Hero3D />
      <Nav />
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-10 anim-fade">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/catalog" element={<Catalog />} />
          <Route path="/item/:slug" element={<ItemDetail />} />
          <Route path="/blog" element={<BlogList />} />
          <Route path="/blog/:slug" element={<BlogPostPage />} />
          <Route path="/repos" element={<ReposPage />} />
          <Route path="/hosting" element={<Hosting />} />
          <Route path="/p/:key" element={<ProjectPage />} />
          <Route path="/profile" element={<Protected><Profile /></Protected>} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/privacy" element={<Legal page="privacy" />} />
          <Route path="/terms" element={<Legal page="terms" />} />
          <Route path="/cookies" element={<Legal page="cookies" />} />
          <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
          <Route path="/admin" element={<Protected role={['MOD', 'ADMIN']}><Admin /></Protected>} />
          <Route path="*" element={<div className="text-[var(--muted)]">Not found.</div>} />
        </Routes>
      </main>
      <Footer />
      <CookieConsent />
    </div>
  );
}
