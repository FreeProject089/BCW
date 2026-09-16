import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { createRoot, type Root } from "react-dom/client";
import { Map as MapIcon, Play, Pause, Globe2, Square } from "lucide-react";
import { useStats, useStore, apiGet, resolvedTheme } from "../lib/store";
import { Drawer, PageHeader, Segmented, Badge } from "../components/ui";
import { ProfileAvatar, Flag } from "../components/visuals";
import { fmtDateTime, dur, nf } from "../lib/format";

// Basemap: OpenStreetMap raster tiles, no API key. Light = the standard OSM tiles from the
// OSMF servers (their usage policy asks for attribution — kept visible — and light use,
// which an admin dashboard is). Dark = CARTO's "dark matter", drawn from the same OSM data
// and also key-free; OSM itself publishes no dark style. The style follows the dashboard
// theme and is swapped in place when the toggle changes.
const TILES = {
  light: { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors' },
  dark: { url: "https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png", attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a>' },
};
const styleFor = (theme: "dark" | "light"): any => ({
  version: 8,
  glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
  sources: { base: { type: "raster", tiles: [TILES[theme].url], tileSize: 256, maxzoom: 19, attribution: TILES[theme].attribution } },
  layers: [{ id: "base", type: "raster", source: "base" }],
});

// User points are clustered by MapLibre itself (a GeoJSON source with `cluster: true`):
// a hundred installs in one city read as one bubble with a count, not a hundred avatars
// on top of each other. Zooming into a cluster expands it; a single point opens the user.
const CLUSTER_SRC = "users";
const CLUSTER_LAYERS = ["users-cluster", "users-cluster-count", "users-point"];

type Tab = "chrono" | "points" | "pays";

export default function MapPage() {
  const s = useStats()!;
  const { theme } = useStore();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"2d" | "globe">("globe");
  const [tab, setTab] = useState<Tab>("points");
  const [sessions, setSessions] = useState<any[]>([]);
  const [repoSel, setRepoSel] = useState<any | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  // markers carry start/end (ms) when they represent a timeline session.
  const markersRef = useRef<{ m: maplibregl.Marker; root: Root; start?: number; end?: number }[]>([]);
  const [t, setT] = useState(0);        // timeline scrub position (ms)
  const [playing, setPlaying] = useState(false);
  const [styleReady, setStyleReady] = useState(0);

  const users = s.map?.users || [];
  const repos = s.map?.repos || [];
  const total = users.length + repos.length;
  const maxC = Math.max(1, ...(s.geo || []).map((g: any) => g.count));
  const resolved = useMemo(() => resolvedTheme(), [theme]);

  const ccOf = (id: string) => s.users.find((u) => u.creator_id === id)?.cc;

  // ── Timeline: join sessions (times) with each user's map point (location) ──
  const userPoint = useMemo(() => {
    const m: Record<string, any> = {};
    for (const u of users) m[u.creator_id] = u;
    return m;
  }, [users]);
  const timeline = useMemo(() => {
    return sessions
      .map((se: any) => {
        const up = userPoint[se.distinct_id];
        const start = Date.parse(se.start);
        if (!up || isNaN(start)) return null;
        const end = Date.parse(se.end);
        return { id: se.session_id, did: se.distinct_id, start, end: isNaN(end) ? start + 60000 : Math.max(end, start + 30000), lat: up.lat, lon: up.lon, country: up.country, entry: se.entry, exit: se.exit, dur: se.duration_s, pv: se.pageviews };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => a.start - b.start) as any[];
  }, [sessions, userPoint]);
  const tRange = useMemo(() => {
    if (!timeline.length) return [0, 0];
    let lo = Infinity, hi = -Infinity;
    for (const e of timeline) { lo = Math.min(lo, e.start); hi = Math.max(hi, e.end); }
    return [lo, hi];
  }, [timeline]);
  const activeAtT = useMemo(() => timeline.filter((e: any) => t >= e.start && t <= e.end), [timeline, t]);

  // recent sessions for the live panel
  useEffect(() => {
    const load = () => apiGet("/api/sessions").then((r) => setSessions(r.sessions || [])).catch(() => {});
    load();
    const iv = setInterval(load, 8000);
    return () => clearInterval(iv);
  }, []);

  // create the map once
  useEffect(() => {
    if (!boxRef.current || mapRef.current) return;
    let mounted = true;
    const map = new maplibregl.Map({
      container: boxRef.current,
      style: styleFor(resolved),
      center: [10, 35],
      zoom: 1.4,
      attributionControl: false,
      maxPitch: 0,
      trackResize: true,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(new maplibregl.AttributionControl({ compact: false }), "bottom-left");
    map.on("error", () => { }); // WebGL worker errors after unmount
    const onStyle = () => { if (mounted) setStyleReady((n) => n + 1); };
    map.on("load", onStyle);
    map.on("style.load", onStyle);
    return () => {
      mounted = false;
      markersRef.current.forEach((x) => { try { x.root.unmount(); } catch { } try { x.m.remove(); } catch { } });
      markersRef.current = [];
      try { map.remove(); } catch { }
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // theme → swap the basemap (setStyle drops our layers; `style.load` re-adds them)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    try { map.setStyle(styleFor(resolved)); } catch { }
  }, [resolved]);

  // every time a style is (re)loaded: projection, country layer, cluster source, markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;
    try { map.setProjection({ type: mode === "globe" ? "globe" : "mercator" } as any); } catch { }
    ensureClusterLayers();
    fetch("/world.json").then((r) => r.json()).then((geo) => {
      const m = mapRef.current;
      if (!m || m !== map) return;
      try {
        if (!m.getSource("countries")) {
          m.addSource("countries", { type: "geojson", data: geo });
          m.addLayer({ id: "country-fill", type: "fill", source: "countries", layout: { visibility: "none" }, paint: { "fill-color": "rgba(91,140,255,0.05)", "fill-outline-color": resolved === "dark" ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.12)" } }, CLUSTER_LAYERS[0]);
        }
        applyChoropleth();
      } catch { }
    }).catch(() => { });
    try { rebuildMarkers(); } catch { }
    try { applyClusters(); } catch { }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleReady]);

  // projection toggle
  useEffect(() => {
    const map = mapRef.current;
    if (map && map.isStyleLoaded()) {
      try { map.setProjection({ type: mode === "globe" ? "globe" : "mercator" } as any); } catch { }
    }
  }, [mode]);

  // ── Clusters (Coordonnées tab) ───────────────────────────────────────────────
  const ensureClusterLayers = () => {
    const map = mapRef.current;
    if (!map || map.getSource(CLUSTER_SRC)) return;
    map.addSource(CLUSTER_SRC, { type: "geojson", data: { type: "FeatureCollection", features: [] }, cluster: true, clusterMaxZoom: 9, clusterRadius: 42 });
    map.addLayer({
      id: "users-cluster", type: "circle", source: CLUSTER_SRC, filter: ["has", "point_count"],
      paint: {
        "circle-color": ["step", ["get", "point_count"], "#5b8cff", 10, "#37d399", 50, "#f4b740"],
        "circle-radius": ["step", ["get", "point_count"], 16, 10, 22, 50, 30],
        "circle-stroke-width": 2, "circle-stroke-color": "rgba(255,255,255,0.55)", "circle-opacity": 0.85,
      },
    });
    map.addLayer({
      id: "users-cluster-count", type: "symbol", source: CLUSTER_SRC, filter: ["has", "point_count"],
      layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 12, "text-font": ["Open Sans Bold", "Noto Sans Bold"] },
      paint: { "text-color": "#0b0d10" },
    });
    map.addLayer({
      id: "users-point", type: "circle", source: CLUSTER_SRC, filter: ["!", ["has", "point_count"]],
      paint: { "circle-color": "#5b8cff", "circle-radius": 7, "circle-stroke-width": 2, "circle-stroke-color": "#ffffff" },
    });
    map.on("click", "users-cluster", async (e) => {
      const f = map.queryRenderedFeatures(e.point, { layers: ["users-cluster"] })[0];
      if (!f) return;
      const src = map.getSource(CLUSTER_SRC) as maplibregl.GeoJSONSource;
      try {
        const zoom = await src.getClusterExpansionZoom(f.properties?.cluster_id);
        map.easeTo({ center: (f.geometry as any).coordinates, zoom: Math.min(zoom, 12) });
      } catch { }
    });
    map.on("click", "users-point", (e) => {
      const f = map.queryRenderedFeatures(e.point, { layers: ["users-point"] })[0];
      const id = f?.properties?.creator_id;
      if (id) navigate(`/users/${encodeURIComponent(id)}`);
    });
    for (const l of ["users-cluster", "users-point"]) {
      map.on("mouseenter", l, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", l, () => { map.getCanvas().style.cursor = ""; });
    }
  };
  const applyClusters = () => {
    const map = mapRef.current;
    if (!map || !map.getSource(CLUSTER_SRC)) return;
    const features = tab === "points"
      ? users.filter((u: any) => u.lon != null && u.lat != null).map((u: any) => ({ type: "Feature", properties: { creator_id: u.creator_id, country: u.country || "" }, geometry: { type: "Point", coordinates: [u.lon, u.lat] } }))
      : [];
    (map.getSource(CLUSTER_SRC) as maplibregl.GeoJSONSource).setData({ type: "FeatureCollection", features } as any);
    for (const l of CLUSTER_LAYERS) if (map.getLayer(l)) map.setLayoutProperty(l, "visibility", tab === "points" ? "visible" : "none");
  };

  // ── Markers: repos always; users only on the timeline tab (each carries start/end) ──
  const rebuildMarkers = () => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    markersRef.current.forEach((x) => { try { x.root.unmount(); } catch { } try { x.m.remove(); } catch { } });
    markersRef.current = [];
    const userPts = tab === "chrono"
      ? timeline.slice(0, 300).map((e: any) => ({ kind: "user", creator_id: e.did, lat: e.lat, lon: e.lon, country: e.country, start: e.start, end: e.end }))
      : [];
    const pts = [...userPts, ...repos.map((r: any) => ({ ...r, kind: "repo" }))];
    for (const p of pts) {
      if (p.lon == null || p.lat == null) continue;
      try {
        const el = document.createElement("div");
        el.style.cursor = "pointer";
        el.title = p.kind === "repo"
          ? `${p.host || ""} · ${p.count} connection(s) — click for details`
          : `${p.creator_id || ""}${p.country ? " · " + p.country : ""} — click to open profile`;
        const root = createRoot(el);
        root.render(
          p.kind === "user" ? (
            <div className="rounded-full ring-2 ring-white/40 shadow" style={{ width: 30, height: 30, overflow: "hidden" }}>
              <ProfileAvatar name={p.creator_id || p.country || "anon"} size={30} />
            </div>
          ) : (
            <div className="rounded-full ring-2 ring-white/50 shadow flex items-center justify-center" style={{ width: 28, height: 28, background: "#a78bfa", color: "#0b0d10" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3 3 6v15l6-3 6 3 6-3V3l-6 3-6-3Z" /></svg>
            </div>
          )
        );
        el.addEventListener("click", () => {
          if (p.kind === "user" && p.creator_id) navigate(`/users/${encodeURIComponent(p.creator_id)}`);
          else if (p.kind === "repo") setRepoSel((s.repos || []).find((r: any) => r.host === p.host) || p);
        });
        const m = new maplibregl.Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(map);
        markersRef.current.push({ m, root, start: p.start, end: p.end });
      } catch { /* skip bad coords silently */ }
    }
    if (tab === "chrono") applyTimelineVis();
  };

  // dim timeline markers that aren't active at the current scrub time
  const applyTimelineVis = () => {
    for (const x of markersRef.current) {
      if (x.start == null) continue;
      const active = t >= x.start && t <= (x.end ?? x.start);
      const el = x.m.getElement();
      el.style.opacity = active ? "1" : "0.10";
      el.style.zIndex = active ? "3" : "0";
      el.style.transition = "opacity .25s ease";
    }
  };

  // choropleth (Pays = countries shaded by user count)
  const applyChoropleth = () => {
    const map = mapRef.current;
    if (!map || !map.getLayer("country-fill")) return;
    if (tab === "pays") {
      const geos = s.geo || [];
      const base = resolved === "dark" ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)";
      if (geos.length === 0) {
        map.setPaintProperty("country-fill", "fill-color", base);
      } else {
        const expr: any[] = ["match", ["get", "name"]];
        for (const g of geos) {
          const a = Math.max(0.15, Math.min(0.85, g.count / maxC));
          expr.push(g.country, `rgba(55,211,153,${a})`);
        }
        expr.push(base);
        map.setPaintProperty("country-fill", "fill-color", expr as any);
      }
      map.setLayoutProperty("country-fill", "visibility", "visible");
    } else {
      map.setLayoutProperty("country-fill", "visibility", "none");
    }
  };

  // re-apply when data/tab/sessions change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    try { rebuildMarkers(); } catch { }
    try { applyClusters(); } catch { }
    try { applyChoropleth(); } catch { }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, s.updated, sessions]);

  useEffect(() => {
    if (tab === "chrono" && tRange[1] > 0) setT(tRange[1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, tRange[0], tRange[1]]);
  useEffect(() => {
    if (tab === "chrono") applyTimelineVis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, tab]);
  useEffect(() => {
    if (!playing || tab !== "chrono" || tRange[1] <= tRange[0]) return;
    const span = tRange[1] - tRange[0];
    const id = setInterval(() => {
      setT((prev) => { const next = prev + span / 160; return next >= tRange[1] ? tRange[0] : next; });
    }, 90);
    return () => clearInterval(id);
  }, [playing, tab, tRange[0], tRange[1]]);

  return (
    <div className="relative">
      <PageHeader
        icon={MapIcon}
        title="Geography"
        sub={<>approximate only, never precise · {nf(users.length)} users · {nf(repos.length)} repos · <span className="text-sub/80">OpenStreetMap tiles, {resolved} basemap</span></>}
        right={<>
          <Segmented value={tab} onChange={setTab} options={[{ key: "chrono", label: "Timeline" }, { key: "points", label: "Points" }, { key: "pays", label: "Countries" }]} />
          <Segmented value={mode} onChange={setMode} options={[{ key: "2d", label: <span className="inline-flex items-center gap-1"><Square size={11} /> 2D</span> }, { key: "globe", label: <span className="inline-flex items-center gap-1"><Globe2 size={11} /> Globe</span> }]} />
        </>}
      />

      <div className="relative card overflow-hidden h-[60vh] md:h-[620px]">
        <div ref={boxRef} style={{ position: "absolute", inset: 0 }} />
        {total === 0 && (
          <div className="absolute inset-x-0 bottom-10 text-center text-xs text-sub pointer-events-none px-4">
            No located users yet — locations resolve server-side from each client's IP once users opt in.
          </div>
        )}
        {tab === "points" && users.length > 0 && (
          <div className="absolute left-3 top-3 hidden sm:block"><Badge tone="brand">clustered · click a bubble to zoom in</Badge></div>
        )}
        {/* sessions panel — on the timeline it lists who was connected at the scrub time */}
        <div className="absolute right-3 top-3 sm:top-auto sm:bottom-12 w-56 sm:w-72 max-h-[45%] overflow-y-auto card bg-panel/90 backdrop-blur p-2">
          <div className="text-[11px] uppercase tracking-wide text-sub px-1 pb-1">
            {tab === "chrono" ? `Connected · ${activeAtT.length}` : "Sessions"}
          </div>
          {(tab === "chrono" ? activeAtT : sessions).length ? (
            (tab === "chrono" ? activeAtT : sessions).slice(0, 10).map((r: any) => (
              <Link to={`/users/${encodeURIComponent(r.distinct_id || r.did)}`} key={r.session_id || r.id} className="flex items-center gap-2 px-1 py-1.5 rounded-lg hover:bg-panel2 text-xs">
                <ProfileAvatar name={r.distinct_id || r.did} size={20} />
                <Flag cc={ccOf(r.distinct_id || r.did)} />
                <span className="truncate flex-1">{r.entry || "—"} → {r.exit || "—"}</span>
                <span className="text-sub">{dur(r.dur ?? r.duration_s)}</span>
              </Link>
            ))
          ) : (
            <div className="text-xs text-sub px-1 py-2">{tab === "chrono" ? "Nobody connected at this moment." : "No sessions."}</div>
          )}
        </div>

        {/* Timeline scrubber */}
        {tab === "chrono" && timeline.length > 0 && (
          <div className="absolute left-3 right-3 sm:right-80 bottom-12 card bg-panel/90 backdrop-blur px-3 py-2 flex items-center gap-3">
            <button onClick={() => setPlaying((p) => !p)} className="pill bg-brand text-white shrink-0 flex items-center gap-1.5" aria-label={playing ? "Pause" : "Play"}>
              {playing ? <Pause size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" />}
              <span className="hidden sm:inline">{playing ? "Pause" : "Play"}</span>
            </button>
            <input
              type="range"
              min={tRange[0]}
              max={tRange[1]}
              value={Math.min(Math.max(t, tRange[0]), tRange[1])}
              step={Math.max(1000, Math.round((tRange[1] - tRange[0]) / 1000))}
              onChange={(e) => { setPlaying(false); setT(+e.target.value); }}
              className="flex-1 accent-brand"
            />
            <span className="text-xs text-sub shrink-0 tabular-nums hidden sm:inline">{t ? fmtDateTime(t) : "—"}</span>
          </div>
        )}
      </div>
      <div className="text-[11px] text-sub mt-2">Last update {fmtDateTime(s.updated)}</div>

      {/* Repo details (the repo.json entry) shown when a repo marker is clicked */}
      <Drawer open={!!repoSel} onClose={() => setRepoSel(null)} title={repoSel ? <span className="font-mono text-xs">{repoSel.host}</span> : ""}>
        {repoSel && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Flag cc={repoSel.geo?.cc} />
              <span className="text-sm">{repoSel.geo?.country || repoSel.country || "—"}{repoSel.geo?.region ? ` · ${repoSel.geo.region}` : ""}{repoSel.geo?.city ? ` · ${repoSel.geo.city}` : ""}</span>
            </div>
            <div className="card divide-y divide-line/60">
              <Row k="Host" v={<span className="font-mono text-xs">{repoSel.host || "—"}</span>} />
              <Row k="Repo name" v={repoSel.repo_name || "—"} />
              <Row k="Connections" v={nf(repoSel.count)} />
              <Row k="Last seen" v={fmtDateTime(repoSel.last_seen)} />
              <Row k="Sample URL" v={repoSel.sample_url ? <a href={repoSel.sample_url} target="_blank" rel="noreferrer" className="text-brand text-xs break-all">{repoSel.sample_url}</a> : "—"} />
            </div>
            {repoSel.sample_url && /^https?:/i.test(repoSel.sample_url) && (
              <a href={repoSel.sample_url.replace(/\/?$/, "/repo.json")} target="_blank" rel="noreferrer" className="inline-block text-sm text-brand">Open repo.json →</a>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-3 py-2 text-sm">
      <span className="text-sub">{k}</span>
      <span className="text-right max-w-[65%] truncate">{v}</span>
    </div>
  );
}
