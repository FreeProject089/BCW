import { lazy, Suspense, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { isDemo, StoreProvider, useStats, useStore } from "./lib/store";
import Layout from "./components/Layout";

// Code-split every page so heavy deps (MapLibre, ECharts) load only on demand,
// keeping the initial bundle small.
const Overview = lazy(() => import("./pages/Overview"));
const Live = lazy(() => import("./pages/Live"));
const Insights = lazy(() => import("./pages/Insights"));
const Versions = lazy(() => import("./pages/Versions"));
const Events = lazy(() => import("./pages/Events"));
const Sessions = lazy(() => import("./pages/Sessions"));
const Pages = lazy(() => import("./pages/Pages"));
const MapPage = lazy(() => import("./pages/MapPage"));
const Funnels = lazy(() => import("./pages/Funnels"));
const Journeys = lazy(() => import("./pages/Journeys"));
const Retention = lazy(() => import("./pages/Retention"));
const Goals = lazy(() => import("./pages/Goals"));
const Users = lazy(() => import("./pages/Users"));
const UserDetail = lazy(() => import("./pages/UserDetail"));
const Bmm = lazy(() => import("./pages/Bmm"));
const Admin = lazy(() => import("./pages/Admin"));
const Storage = lazy(() => import("./pages/Storage"));
const Docs = lazy(() => import("./pages/Docs"));
const DataRequests = lazy(() => import("./pages/DataRequests"));
const Settings = lazy(() => import("./pages/Settings"));

function Spinner({ label }: { label: string }) {
  return (
    <div className="h-full flex items-center justify-center text-sub">
      <div className="flex items-center gap-3">
        <span className="w-4 h-4 rounded-full border-2 border-brand border-t-transparent animate-spin" />
        {label}
      </div>
    </div>
  );
}
function Gate({ children }: { children: React.ReactNode }) {
  const stats = useStats();
  if (!stats) return <Spinner label="Connecting to telemetry stream…" />;
  // Suspense boundary for the lazily-loaded page chunk.
  return <Suspense fallback={<Spinner label="Loading…" />}>{children}</Suspense>;
}

// Full-screen login shown when the dashboard requires the private key.
function Login() {
  const { setAdminKey } = useStore();
  const [k, setK] = useState("");
  return (
    <div className="h-full flex items-center justify-center">
      <form
        onSubmit={(e) => { e.preventDefault(); if (k.trim()) setAdminKey(k.trim()); }}
        className="card p-6 w-80 space-y-3"
      >
        <div className="flex items-center gap-2">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-brand">
            <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <div className="font-semibold">BMM Telemetry — private</div>
        </div>
        <p className="text-xs text-sub">This dashboard is locked. Enter the admin key to view any data.</p>
        <input
          autoFocus
          type="password"
          value={k}
          onChange={(e) => setK(e.target.value)}
          placeholder="Admin key (bmm_sk_…)"
          className="w-full bg-panel2 border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand"
        />
        <button type="submit" className="w-full bg-brand text-white rounded-lg px-4 py-2 text-sm font-medium">Unlock</button>
      </form>
    </div>
  );
}

// Persistent and non-dismissable on purpose: a screenshot of the demo must never be able
// to pass for real telemetry, so there is no close button and no way to scroll past it.
function DemoBanner() {
  return (
    <div role="status" className="shrink-0 flex items-center justify-center gap-2 flex-wrap px-3 py-1.5 text-xs font-medium bg-warn/15 text-warn border-b border-warn/30">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      </svg>
      <span>Demo: every figure on this page is synthetic. No real telemetry, no database, nothing can be saved.</span>
    </div>
  );
}

function Shell() {
  const { authError } = useStore();
  // The demo carries no data of its own to protect, so it is never sent to the login
  // screen: it is reachable even when the real dashboard is locked behind the admin key.
  if (authError && !isDemo()) {
    return (
      <div className="h-full bg-bg text-ink">
        <Login />
      </div>
    );
  }
  return (
    <Routes>
        <Route element={<Layout />}>
          <Route index element={<Gate><Overview /></Gate>} />
          <Route path="live" element={<Gate><Live /></Gate>} />
          <Route path="insights" element={<Gate><Insights /></Gate>} />
          <Route path="versions" element={<Gate><Versions /></Gate>} />
          <Route path="events" element={<Gate><Events /></Gate>} />
          <Route path="sessions" element={<Gate><Sessions /></Gate>} />
          <Route path="pages" element={<Gate><Pages /></Gate>} />
          <Route path="map" element={<Gate><MapPage /></Gate>} />
          <Route path="funnels" element={<Gate><Funnels /></Gate>} />
          <Route path="journeys" element={<Gate><Journeys /></Gate>} />
          <Route path="retention" element={<Gate><Retention /></Gate>} />
          <Route path="goals" element={<Gate><Goals /></Gate>} />
          <Route path="users" element={<Gate><Users /></Gate>} />
          <Route path="users/:id" element={<Gate><UserDetail /></Gate>} />
          <Route path="bmm" element={<Gate><Bmm /></Gate>} />
          <Route path="admin" element={<Gate><Admin /></Gate>} />
          <Route path="storage" element={<Gate><Storage /></Gate>} />
          <Route path="docs" element={<Gate><Docs /></Gate>} />
          <Route path="data-requests" element={<Gate><DataRequests /></Gate>} />
          <Route path="settings" element={<Gate><Settings /></Gate>} />
        </Route>
      </Routes>
  );
}

export default function App() {
  return (
    <StoreProvider>
      {isDemo() ? (
        <div className="h-full flex flex-col">
          <DemoBanner />
          <div className="flex-1 min-h-0">
            <Shell />
          </div>
        </div>
      ) : (
        <Shell />
      )}
    </StoreProvider>
  );
}
