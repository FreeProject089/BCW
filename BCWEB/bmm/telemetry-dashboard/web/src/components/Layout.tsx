import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  LayoutDashboard, Radio, Lightbulb, Users, Map as MapIcon, TrendingUp, Tags, Zap, ListOrdered, Route, Filter, Target,
  FileText, Boxes, ShieldCheck, Database, BookOpen, ShieldAlert, SlidersHorizontal, Menu, ArrowLeft, Sun, Moon, Monitor, Package, type LucideIcon,
} from "lucide-react";
import { useStore, bcHome, type Theme } from "../lib/store";
import { Segmented } from "./ui";

// Nav grouped into bands, so nineteen destinations read as five themes rather than one
// long undifferentiated list. `adv: true` = a deep-dive screen, hidden in Simple.
//
// The Simple/Advanced switch decides what the NAVIGATION offers: Simple is the screens that
// answer "what is happening", Advanced is everything. Nothing is removed — an advanced page
// stays reachable by URL, and the one you are ON is never hidden out from under you.
const NAV: { group: string; items: { to: string; label: string; icon: LucideIcon; adv?: boolean; badge?: (s: any) => number }[] }[] = [
  {
    group: "Temps réel",
    items: [
      { to: "/", label: "Overview", icon: LayoutDashboard },
      { to: "/live", label: "Live", icon: Radio },
      { to: "/insights", label: "Insights", icon: Lightbulb },
    ],
  },
  {
    group: "Audience",
    items: [
      { to: "/users", label: "Users", icon: Users },
      { to: "/map", label: "Map", icon: MapIcon },
      { to: "/retention", label: "Retention", icon: TrendingUp, adv: true },
      { to: "/versions", label: "Versions", icon: Tags },
    ],
  },
  {
    group: "Comportement",
    items: [
      { to: "/events", label: "Events", icon: Zap, adv: true },
      { to: "/sessions", label: "Sessions", icon: ListOrdered, adv: true },
      { to: "/journeys", label: "Journeys", icon: Route, adv: true },
      { to: "/funnels", label: "Funnels", icon: Filter, adv: true },
      { to: "/goals", label: "Goals", icon: Target, adv: true },
    ],
  },
  {
    group: "Produit",
    items: [
      { to: "/pages", label: "Pages & perf", icon: FileText },
      { to: "/bmm", label: "BMM insights", icon: Boxes },
    ],
  },
  {
    group: "Ops",
    items: [
      { to: "/data-requests", label: "Data requests", icon: ShieldAlert, badge: (s) => (s?.privacy?.pending_requests ?? 0) + (s?.privacy?.pending_deletions ?? 0) },
      { to: "/settings", label: "Settings", icon: SlidersHorizontal, adv: true },
      { to: "/admin", label: "Admin", icon: ShieldCheck, adv: true },
      { to: "/storage", label: "Stockage", icon: Database, adv: true },
      { to: "/docs", label: "Documentation", icon: BookOpen },
    ],
  },
];

const THEME_NEXT: Record<Theme, Theme> = { dark: "light", light: "system", system: "dark" };
const THEME_ICON: Record<Theme, LucideIcon> = { dark: Moon, light: Sun, system: Monitor };
const THEME_LABEL: Record<Theme, string> = { dark: "Sombre", light: "Clair", system: "Système" };

export default function Layout() {
  const { stats, connected, adminKey, setAdminKey, viewMode, setViewMode, theme, setTheme } = useStore();
  const liveN = stats?.totals?.live ?? 0;
  const [navOpen, setNavOpen] = useState(false);
  const { pathname } = useLocation();
  // The page you are currently on is always listed, whatever the mode — a switch that makes
  // the sidebar entry for the screen under your cursor disappear reads as a bug, not as a
  // filter. A group whose every item is filtered out drops its heading too.
  const shownNav = NAV
    .map((sec) => ({ ...sec, items: sec.items.filter((n) => viewMode === "advanced" || !n.adv || n.to === pathname) }))
    .filter((sec) => sec.items.length > 0);
  const ThemeIcon = THEME_ICON[theme];

  return (
    <div className="flex h-full">
      {/* mobile backdrop */}
      {navOpen && <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setNavOpen(false)} />}

      <aside className={`fixed md:static z-40 h-full w-60 shrink-0 border-r border-line bg-panel flex flex-col transition-transform duration-200 ${navOpen ? "translate-x-0" : "-translate-x-full"} md:translate-x-0`}>
        <div className="px-4 h-14 flex items-center gap-2.5 border-b border-line">
          <span className="grid place-items-center w-8 h-8 rounded-lg bg-brand/15 border border-brand/25"><Package size={16} className="text-brand" /></span>
          <div className="leading-tight">
            <div className="font-semibold tracking-tight text-sm">BMM Telemetry</div>
            <div className="text-[10px] text-sub">privacy-first, opt-in</div>
          </div>
        </div>
        <nav className="p-2 flex-1 overflow-y-auto">
          {shownNav.map((section) => (
            <div key={section.group} className="mb-1">
              <div className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-wider text-sub/70 font-semibold">{section.group}</div>
              {section.items.map((n) => {
                const I = n.icon;
                const b = n.badge ? n.badge(stats) : 0;
                return (
                  <NavLink key={n.to} to={n.to} end={n.to === "/"} onClick={() => setNavOpen(false)} className={({ isActive }) => `navlink ${isActive ? "navlink-active" : ""}`}>
                    <I size={16} strokeWidth={1.8} />
                    <span className="flex-1">{n.label}</span>
                    {b > 0 && <span className="pill bg-warn/20 text-warn text-[10px] font-semibold">{b}</span>}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="p-3 border-t border-line text-[11px] text-sub">
          Approximate geo only · exact erasure
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 shrink-0 border-b border-line bg-panel/70 backdrop-blur sticky top-0 z-20 flex items-center justify-between px-3 md:px-5 gap-2">
          <div className="flex items-center gap-2 text-sm min-w-0">
            <button onClick={() => setNavOpen((o) => !o)} className="md:hidden p-1.5 -ml-1 rounded-lg hover:bg-panel2 shrink-0" aria-label="Menu">
              <Menu size={20} />
            </button>
            <a href={bcHome()} title="Back to BetterCommunity" className="flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-xs hover:bg-panel2 hover:border-brand transition shrink-0">
              <ArrowLeft size={14} />
              <span className="hidden sm:inline">BetterCommunity</span>
            </a>
            <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${connected ? "bg-good animate-pulse" : "bg-warn"}`} />
            <span className="text-sub hidden sm:inline">{connected ? "Live" : "Reconnecting…"}</span>
            <span className="text-sub mx-1 sm:mx-2 hidden sm:inline">·</span>
            <span className="font-medium tabular-nums">{liveN}</span>
            <span className="text-sub">online</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Segmented
              value={viewMode}
              onChange={setViewMode}
              options={[{ key: "simple", label: "Simple" }, { key: "advanced", label: "Avancé" }]}
            />
            <button onClick={() => setTheme(THEME_NEXT[theme])} className="btn btn-ghost px-2" title={`Thème : ${THEME_LABEL[theme]}`} aria-label="Theme">
              <ThemeIcon size={15} />
            </button>
            <input
              value={adminKey}
              onChange={(e) => setAdminKey(e.target.value)}
              placeholder="Admin key"
              type="password"
              className="input py-1.5 w-24 sm:w-40 hidden sm:block"
            />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-3 md:p-5">
          <div className="max-w-[1500px] mx-auto">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
