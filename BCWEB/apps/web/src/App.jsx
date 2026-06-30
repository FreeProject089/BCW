import { Routes, Route, Link, NavLink, Navigate } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { Home, Catalog, ItemDetail, Blog, Repos, Auth, Dashboard, Admin } from './pages.jsx';

function Nav() {
  const { user, logout } = useAuth();
  const link = ({ isActive }) => 'px-3 py-2 rounded-lg ' + (isActive ? 'text-accent' : 'text-slate-300 hover:text-white');
  return (
    <header className="sticky top-0 z-10 backdrop-blur border-b border-line bg-ink/80">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-2">
        <Link to="/" className="font-extrabold text-lg mr-2"><span className="accent-text">BetterCommunity</span></Link>
        <NavLink to="/catalog?project=bmm" className={link}>BMM</NavLink>
        <NavLink to="/catalog?project=bsm&kind=PRESET" className={link}>BSM</NavLink>
        <NavLink to="/blog" className={link}>Blog</NavLink>
        <NavLink to="/repos" className={link}>Server Repos</NavLink>
        <div className="flex-1" />
        {user ? (
          <>
            <NavLink to="/dashboard" className={link}>Dashboard</NavLink>
            {(user.role === 'ADMIN' || user.role === 'MOD') && <NavLink to="/admin" className={link}>Admin</NavLink>}
            <button className="btn" onClick={logout}>Logout</button>
          </>
        ) : (
          <NavLink to="/auth" className="btn btn-primary">Sign in</NavLink>
        )}
      </div>
    </header>
  );
}

function Protected({ children, role }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="max-w-6xl mx-auto p-8 text-slate-400">Loading…</div>;
  if (!user) return <Navigate to="/auth" replace />;
  if (role && !role.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <>
      <Nav />
      <main className="max-w-6xl mx-auto px-4 py-8">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/catalog" element={<Catalog />} />
          <Route path="/item/:slug" element={<ItemDetail />} />
          <Route path="/blog" element={<Blog />} />
          <Route path="/repos" element={<Repos />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
          <Route path="/admin" element={<Protected role={['MOD', 'ADMIN']}><Admin /></Protected>} />
          <Route path="*" element={<div className="text-slate-400">Not found.</div>} />
        </Routes>
      </main>
      <footer className="border-t border-line mt-16">
        <div className="max-w-6xl mx-auto px-4 py-8 text-sm text-slate-500">
          BetterCommunity — BMM · BSM · friends.
        </div>
      </footer>
    </>
  );
}
