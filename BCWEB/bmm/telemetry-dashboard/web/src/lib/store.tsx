import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { Stats } from "./types";

// ── Demo mode ───────────────────────────────────────────────────────────────
// /demo shows the dashboard fully populated with synthetic data. The switch is read from
// the URL once, at module load, because every request helper below has to know: in demo
// mode NOTHING in this file opens a socket, calls fetch or writes localStorage. That is
// the guarantee, and it is enforced here rather than per page so a new page cannot leak
// past it. The banner and the auth bypass live in App.tsx; this is the data side.
const DEMO_PREFIX = "/demo";
const demoMode = typeof location !== "undefined" && (location.pathname === DEMO_PREFIX || location.pathname.startsWith(DEMO_PREFIX + "/"));
/** True when the page is the synthetic tour rather than real telemetry. */
export const isDemo = () => demoMode;
/** Router basename, so every existing absolute <Link to="/live"> stays inside the demo. */
export const routerBase = () => (demoMode ? DEMO_PREFIX : undefined);
// The dataset is imported dynamically and only from the demo path: imported statically it
// hoists into the entry chunk and every real visitor pays for data they will never see.
const demoModule = () => import("./demo-data");

export type ViewMode = "simple" | "advanced";
export type Theme = "dark" | "light" | "system";

/** Apply a theme choice to <html data-theme>; "system" removes the stamp (CSS follows the OS). */
export function applyTheme(t: Theme) {
  const el = document.documentElement;
  if (t === "system") el.removeAttribute("data-theme");
  else el.setAttribute("data-theme", t);
}

interface StoreValue {
  stats: Stats | null;
  connected: boolean;
  authError: boolean;
  adminKey: string;
  setAdminKey: (k: string) => void;
  viewMode: ViewMode;
  setViewMode: (m: ViewMode) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
}

const Ctx = createContext<StoreValue>(null as any);
export const useStore = () => useContext(Ctx);
export const useStats = () => useContext(Ctx).stats;
/** Dashboard density: "simple" (essentials only) vs "advanced" (everything). Persisted. */
export const useViewMode = () => {
  const { viewMode, setViewMode } = useContext(Ctx);
  return [viewMode, setViewMode] as const;
};

// The viewer key is the private admin key; it gates every data endpoint.
const key = () => localStorage.getItem("bmm_admin_key") || "";

// BetterCommunity SSO token: when the dashboard is opened from the BCWEB admin panel
// it arrives as `#bc=<token>` — capture it once into localStorage, then it's sent as
// X-BC-Token on every request (grants viewer access without the static admin key).
export function captureBcToken() {
  try {
    const m = location.hash.match(/[#&]bc=([^&]+)/);
    if (m) {
      localStorage.setItem("bmm_bc_token", decodeURIComponent(m[1]));
      const h = location.hash.match(/[#&]home=([^&]+)/);
      if (h) localStorage.setItem("bmm_bc_home", decodeURIComponent(h[1]));
      history.replaceState(null, "", location.pathname + location.search); // scrub the token from the URL
    }
  } catch { /* ignore */ }
}
const bcToken = () => localStorage.getItem("bmm_bc_token") || "";
export const hasBcToken = () => !!bcToken();
/** BCWEB home URL to return to (passed in the SSO handoff; sensible dev fallback). */
export const bcHome = () => localStorage.getItem("bmm_bc_home") || "http://localhost:5176";

// A stable per-browser fingerprint (classic UA + locale + screen + tz + a
// persistent salt) sent on every request so the server can attribute admin
// actions (downloads / deletes / backups) in the audit log.
function fingerprint(): string {
  try {
    let fp = localStorage.getItem("bmm_admin_fp");
    if (!fp) {
      const seed = [navigator.userAgent, navigator.language, `${screen.width}x${screen.height}x${screen.colorDepth}`, Intl.DateTimeFormat().resolvedOptions().timeZone, Math.random().toString(36).slice(2)].join("|");
      let h = 5381;
      for (let i = 0; i < seed.length; i++) h = ((h << 5) + h + seed.charCodeAt(i)) >>> 0;
      fp = h.toString(16) + Date.now().toString(36);
      localStorage.setItem("bmm_admin_fp", fp);
    }
    return fp;
  } catch { return "unknown"; }
}
const authHeaders = (): Record<string, string> => ({ ...(key() ? { "X-Admin-Key": key() } : {}), ...(bcToken() ? { "X-BC-Token": bcToken() } : {}), "X-Admin-Fp": fingerprint() });

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [connected, setConnected] = useState(false);
  const [authError, setAuthError] = useState(false);
  const [adminKey, setAdminKeyState] = useState(() => localStorage.getItem("bmm_admin_key") || "");
  const [viewMode, setViewModeState] = useState<ViewMode>(() => (localStorage.getItem("bmm_view_mode") === "advanced" ? "advanced" : "simple"));
  const [theme, setThemeState] = useState<Theme>(() => {
    const v = localStorage.getItem("bmm_theme");
    return v === "light" || v === "system" ? v : "dark";
  });
  const esRef = useRef<EventSource | null>(null);
  const pollRef = useRef<number | null>(null);

  const setAdminKey = (k: string) => {
    if (demoMode) return; // the demo must not leave anything behind in this browser
    localStorage.setItem("bmm_admin_key", k);
    setAdminKeyState(k);
  };
  const setViewMode = (m: ViewMode) => {
    localStorage.setItem("bmm_view_mode", m);
    setViewModeState(m);
  };
  const setTheme = (t: Theme) => {
    localStorage.setItem("bmm_theme", t);
    setThemeState(t);
    applyTheme(t);
  };
  useEffect(() => { applyTheme(theme); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Demo: build the payload once from the lazily-loaded generator. Gate already shows the
  // spinner while stats is null, so there is nothing else to coordinate.
  useEffect(() => {
    if (!demoMode) return;
    let on = true;
    demoModule().then((m) => on && setStats(m.buildDemoStats()));
    return () => { on = false; };
  }, []);

  useEffect(() => {
    if (demoMode) return; // no stream, no polling, no database
    let closed = false;
    const clearPoll = () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
    const startPoll = () => {
      if (pollRef.current) return;
      const tick = async () => {
        try {
          const r = await fetch("/api/stats", { headers: authHeaders() });
          if (r.status === 401) {
            setAuthError(true);
            clearPoll();
            return;
          }
          if (r.ok) {
            setAuthError(false);
            setStats(await r.json());
          }
        } catch {
          /* ignore */
        }
      };
      tick();
      pollRef.current = window.setInterval(tick, 10000);
    };
    // Probe auth first: 401 → show login; otherwise open the live stream.
    const start = async () => {
      try {
        const r = await fetch("/api/stats", { headers: authHeaders() });
        if (r.status === 401) {
          setAuthError(true);
          return;
        }
        setAuthError(false);
        if (r.ok) setStats(await r.json());
      } catch {
        /* offline — fall through to SSE/poll which will retry */
      }
      connect();
    };
    const connect = () => {
      try {
        // EventSource can't set headers, so pass the key/BC token as a query param.
        const k = key();
        const qs = bcToken() ? `?bc=${encodeURIComponent(bcToken())}` : (k ? `?key=${encodeURIComponent(k)}` : "");
        const es = new EventSource(`/api/stream${qs}`);
        esRef.current = es;
        es.onopen = () => {
          setConnected(true);
          setAuthError(false);
          clearPoll();
        };
        es.onmessage = (e) => {
          try {
            setStats(JSON.parse(e.data));
          } catch {
            /* ignore */
          }
        };
        es.onerror = () => {
          setConnected(false);
          es.close();
          esRef.current = null;
          startPoll();
          if (!closed) setTimeout(connect, 4000);
        };
      } catch {
        startPoll();
      }
    };
    start();
    return () => {
      closed = true;
      esRef.current?.close();
      clearPoll();
    };
  }, [adminKey]);

  // The admin-gated panels key off a non-empty admin key; the demo hands them a marker so
  // the tour reaches them. It is never sent anywhere: every helper below short-circuits.
  const effectiveKey = demoMode ? "demo" : adminKey;
  return <Ctx.Provider value={{ stats, connected: demoMode ? true : connected, authError: demoMode ? false : authError, adminKey: effectiveKey, setAdminKey, viewMode, setViewMode, theme, setTheme }}>{children}</Ctx.Provider>;
}

// ── REST helpers (drill-downs + admin writes) — all carry the viewer key ────
/** POSTs that only read. Everything else is a write, and the demo answers it with this. */
const DEMO_READS = new Set(["/api/funnel", "/api/journeys"]);
const DEMO_WRITE_REFUSAL = "Demo mode is read-only: nothing is saved.";

export async function apiGet<T = any>(url: string): Promise<T> {
  if (demoMode) return (await demoModule()).demoApiGet(url) as T;
  const r = await fetch(url, { headers: authHeaders() });
  return r.json();
}
export async function apiPost<T = any>(url: string, body: any, adminKey?: string): Promise<T> {
  // A POST is either a read dressed as a POST (funnel, journeys) or a write. The demo
  // answers the first kind and refuses the second; either way nothing leaves the page.
  if (demoMode) {
    const { demoApiPost } = await demoModule();
    return { ...demoApiPost(url, body), ...(DEMO_READS.has(url) ? {} : { error: DEMO_WRITE_REFUSAL }) } as T;
  }
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(), ...(adminKey ? { "X-Admin-Key": adminKey } : {}) },
    body: JSON.stringify(body),
  });
  return r.json();
}
export async function apiDelete<T = any>(url: string, adminKey?: string): Promise<T> {
  if (demoMode) return { error: DEMO_WRITE_REFUSAL } as T;
  const r = await fetch(url, { method: "DELETE", headers: { ...authHeaders(), ...(adminKey ? { "X-Admin-Key": adminKey } : {}) } });
  return r.json();
}

/** Fetch a binary (the GDPR zip) with the viewer headers and hand it to the browser. */
export async function apiDownload(url: string, filename: string): Promise<boolean> {
  if (demoMode) return false;
  const r = await fetch(url, { headers: authHeaders() });
  if (!r.ok) return false;
  const blob = await r.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return true;
}
/** The current theme as resolved on <html> (for canvases that cannot read CSS vars). */
export function resolvedTheme(): "dark" | "light" {
  const t = document.documentElement.getAttribute("data-theme");
  if (t === "light" || t === "dark") return t;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
