// The synthetic dataset behind /demo: one seeded generator that fills every panel the
// real dashboard has, so the tour is the whole product and not three charts and blank
// space. Nothing here touches the network or the database — the demo is a pure function
// of DEMO_SEED, which is why a screenshot taken for the docs keeps matching the page.
//
// Times are the one thing that is not frozen: everything is offset from today's UTC
// midnight, so two loads on the same day are identical while a demo left up for a month
// never reads as stale telemetry from March.
import { ALL_DIAGRAMS, ALL_MODALS, ALL_PAGES } from "./constants";
import type { LiveInstance, Stats, UserRow } from "./types";

/** Change this and every number on /demo changes with it; leave it and the docs keep
 *  matching the screenshots that were taken from them. */
const DEMO_SEED = 0x6b_4d_4d_01;

/** mulberry32: 32-bit, seedable, and short enough to read. Quality is irrelevant here —
 *  reproducibility is the whole point. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY = 86400000;
const HOUR = 3600000;
/** "Now" for the demo: 14:00 UTC today, so the last 24h of every chart is full. */
const NOW = Math.floor(Date.now() / DAY) * DAY + 14 * HOUR;

const COUNTRIES: { country: string; cc: string; lat: number; lon: number; region: string; city: string; weight: number }[] = [
  { country: "France", cc: "fr", lat: 48.86, lon: 2.35, region: "Île-de-France", city: "Paris", weight: 26 },
  { country: "Germany", cc: "de", lat: 52.52, lon: 13.4, region: "Berlin", city: "Berlin", weight: 18 },
  { country: "United States", cc: "us", lat: 40.71, lon: -74.01, region: "New York", city: "New York", weight: 17 },
  { country: "United Kingdom", cc: "gb", lat: 51.51, lon: -0.13, region: "England", city: "London", weight: 11 },
  { country: "Canada", cc: "ca", lat: 45.5, lon: -73.57, region: "Quebec", city: "Montréal", weight: 8 },
  { country: "Poland", cc: "pl", lat: 52.23, lon: 21.01, region: "Mazowieckie", city: "Warsaw", weight: 7 },
  { country: "Brazil", cc: "br", lat: -23.55, lon: -46.63, region: "São Paulo", city: "São Paulo", weight: 6 },
  { country: "Japan", cc: "jp", lat: 35.68, lon: 139.69, region: "Tōkyō", city: "Tokyo", weight: 4 },
  { country: "Australia", cc: "au", lat: -33.87, lon: 151.21, region: "New South Wales", city: "Sydney", weight: 3 },
];

const OSES = ["Windows 11 (26100)", "Windows 10 (19045)", "Ubuntu 24.04", "macOS 15.1", "Fedora 41"];
const GPUS = ["NVIDIA GeForce RTX 4070", "NVIDIA GeForce RTX 3060", "AMD Radeon RX 7800 XT", "Intel Arc A770", "Apple M3", "Intel UHD 770"];
const CPUS = ["AMD Ryzen 7 7800X3D", "Intel Core i7-13700K", "AMD Ryzen 5 5600", "Intel Core i5-12400F", "Apple M3"];
const VERSIONS = ["3.4.1", "3.4.0", "3.3.2", "3.3.0", "3.2.5"];
const THEMES = ["Midnight", "Nord Frost", "Solarized Warm", "BMM Classic", "Rosé Pine", "High Contrast"];
const LANGS = ["fr-FR", "en-US", "de-DE", "pt-BR", "pl-PL", "ja-JP"];
const NAMES = [
  "Aurelie", "Nils", "Marek", "Sophie", "Tomas", "Hanna", "Diego", "Keiko", "Owen", "Lucia",
  "Emil", "Farah", "Jonas", "Priya", "Cato", "Milan", "Ines", "Ravi",
];

const VIEWS = ["library", "profiles", "mapper", "repo", "modpacks", "apps", "plugins", "settings", "docs", "help"];
const EVENT_NAMES = [
  "page_enter", "click", "modal_open", "feature", "outbound", "copy", "form_submit",
  "input_change", "session_start", "session_end", "perf", "webvitals", "benchmark",
  "repo_connect", "tutorial", "error",
];
const FEATURES = ["mod-search", "conflict-resolver", "profile-switch", "bulk-enable", "mapper-autodetect", "repo-sync", "launchpack", "theme-editor"];
const TUTORIALS = ["interactive-tutorial:start", "interactive-tutorial:library", "interactive-tutorial:profiles", "interactive-tutorial:done"];
const BENCH_OPS = ["hash_blake3", "zip_read", "zip_write", "fs_walk", "json_parse", "sqlite_insert", "copy_large", "integrity_check"];

/** Pick from a list with a stable bias towards the head, so distributions look real. */
const pick = <T,>(r: () => number, xs: T[]): T => xs[Math.min(xs.length - 1, Math.floor(Math.abs(r() - r() * 0.4) * xs.length))];
const int = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const hex = (r: () => number, n: number) => Array.from({ length: n }, () => "0123456789abcdef"[int(r, 0, 15)]).join("");
const iso = (ms: number) => new Date(ms).toISOString();

export interface DemoCreator {
  id: string;
  name: string;
  geo: (typeof COUNTRIES)[number];
  os: string;
  gpu: string;
  cpu: string;
  version: string;
  theme: string;
  lang: string;
  ram: number;
  sessions: number;
  firstMs: number;
  lastMs: number;
  isVm: boolean;
}

/** The roster every other panel is built from: one creator is the same person on the map,
 *  in the user table, in Live and in the benchmark list. */
function creators(r: () => number): DemoCreator[] {
  return NAMES.map((name, i) => {
    const geo = COUNTRIES[Math.floor(r() * r() * COUNTRIES.length)] || COUNTRIES[0];
    const firstMs = NOW - int(r, 6, 170) * DAY;
    return {
      id: `bmm_${hex(r, 24)}`,
      name,
      geo,
      os: pick(r, OSES),
      gpu: pick(r, GPUS),
      cpu: pick(r, CPUS),
      version: pick(r, VERSIONS),
      theme: pick(r, THEMES),
      lang: geo.cc === "fr" ? "fr-FR" : pick(r, LANGS),
      ram: pick(r, [8, 16, 16, 32, 32, 64]),
      sessions: int(r, 2, 140),
      firstMs,
      lastMs: NOW - int(r, 0, 6) * HOUR - i * 97_000,
      isVm: r() > 0.86,
    };
  });
}

/** Count occurrences into the {k, v} rows the dashboard's list/donut helpers expect. */
const kv = (entries: [string, number][]) => entries.map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v);

function series(r: () => number) {
  // A day-shaped curve: quiet at night, a plateau over the European evening.
  const shape = (h: number) => 0.35 + 0.65 * Math.sin(((h - 3) / 24) * Math.PI) ** 2;
  return Array.from({ length: 24 }, (_, i) => {
    const ms = NOW - (23 - i) * HOUR;
    const h = new Date(ms).getUTCHours();
    const base = shape(h) * (0.9 + r() * 0.25);
    const users = Math.round(48 * base);
    const sessions = Math.round(users * (1.5 + r() * 0.5));
    const pageviews = Math.round(sessions * (5.5 + r() * 2.5));
    return { hour: iso(ms).slice(0, 13) + ":00", users, sessions, pageviews, events: Math.round(pageviews * (2.2 + r() * 0.8)) };
  });
}

/** The Overview granularity switch reads `buckets[gran]`; every option needs a curve or
 *  the chart silently falls back to the hourly one and the switch looks broken. */
function buckets(r: () => number) {
  const make = (n: number, stepMs: number, label: (ms: number) => string) =>
    Array.from({ length: n }, (_, i) => {
      const ms = NOW - (n - 1 - i) * stepMs;
      const h = new Date(ms).getUTCHours();
      const base = (0.35 + 0.65 * Math.sin(((h - 3) / 24) * Math.PI) ** 2) * (0.85 + r() * 0.3);
      const scale = stepMs / HOUR;
      const users = Math.max(1, Math.round(48 * base * Math.min(1, scale + 0.35)));
      const sessions = Math.round(users * (1.4 + r() * 0.6));
      const pageviews = Math.round(sessions * (5 + r() * 3));
      return { t: label(ms), users, sessions, pageviews, events: Math.round(pageviews * 2.4) };
    });
  const hm = (ms: number) => iso(ms).slice(11, 16);
  return {
    "15m": make(48, 15 * 60000, hm),
    "30m": make(48, 30 * 60000, hm),
    "1h": make(24, HOUR, (ms) => iso(ms).slice(11, 13) + "h"),
    "1d": make(30, DAY, (ms) => iso(ms).slice(5, 10)),
  };
}

function cohorts(r: () => number, unitMs: number, n: number, cols: number) {
  return Array.from({ length: n }, (_, i) => {
    const size = int(r, 40, 220);
    const cells = Array.from({ length: Math.max(1, cols - i) }, (_, c) => ({
      // Week 0 is always the whole cohort; the curve then decays with a floor, the shape
      // a real retention grid has.
      pct: c === 0 ? 100 : Math.max(6, Math.round((72 / (1 + c * 0.75)) * (0.85 + r() * 0.3))),
    }));
    return { cohort_start: iso(NOW - (n - 1 - i + 1) * unitMs).slice(0, 10), size, cells };
  }).reverse();
}

export function buildDemoStats(): Stats {
  const r = rng(DEMO_SEED);
  const people = creators(r);
  const ser = series(r);

  const totalUsers = 1284;
  const geo = COUNTRIES.map((c) => ({ country: c.country, count: Math.round((c.weight / 100) * totalUsers) }));
  const country_cc = Object.fromEntries(COUNTRIES.map((c) => [c.country, c.cc]));

  const pages = VIEWS.map((view, i) => ({
    view,
    enters: Math.round(9400 / (i + 1.35)),
    avg_dwell_ms: int(r, 9_000, 145_000),
    lcp: int(r, 900, 4600),
    cls: round(r() * 0.28, 3),
    inp: int(r, 60, 460),
    fcp: int(r, 500, 2900),
    ttfb: int(r, 90, 1500),
    fps: int(r, 34, 60),
    ft: round(int(r, 12, 34) + r(), 1),
    events: Math.round(21_000 / (i + 1.2)),
  }));

  // Page-to-page transitions, both for the Overview "top paths" bars and the Funnels sankey.
  const funnels: { path: string; count: number }[] = [];
  for (let i = 0; i < VIEWS.length; i++) {
    for (let j = 0; j < VIEWS.length; j++) {
      if (i === j) continue;
      const count = Math.round(1400 / ((i + 1) * (j + 1.6)));
      if (count > 24) funnels.push({ path: `${VIEWS[i]}→${VIEWS[j]}`, count });
    }
  }
  funnels.sort((a, b) => b.count - a.count);

  const live: LiveInstance[] = people.slice(0, 9).map((p, i) => ({
    creator_id: p.id,
    status: i === 7 ? "crashed" : i === 5 || i === 8 ? "away" : "online",
    country: p.geo.country,
    cc: p.geo.cc,
    version: p.version,
    view: pick(r, VIEWS),
    fps: int(r, 38, 60),
    ft: round(int(r, 13, 30) + r(), 1),
    heap: int(r, 120, 480),
    ago_s: int(r, 3, 540),
    started_at: NOW - int(r, 4, 190) * 60000,
    session_id: `sess_${hex(r, 12)}`,
    cpu: p.cpu,
    gpu: p.gpu,
    ram_gb: p.ram,
    os: p.os,
    is_vm: p.isVm,
  }));

  const users: UserRow[] = people.map((p, i) => ({
    creator_id: p.id,
    versions: [p.version, ...VERSIONS.filter((v) => v !== p.version).slice(0, 1)],
    ips: [`203.0.113.${int(r, 2, 250)}`],
    names: [p.name],
    country: p.geo.country,
    city: p.geo.city,
    region: p.geo.region,
    cc: p.geo.cc,
    // Jitter around the capital so a dozen installs in one country read as a cluster.
    lat: round(p.geo.lat + (r() - 0.5) * 4.5, 3),
    lon: round(p.geo.lon + (r() - 0.5) * 6, 3),
    config: {
      os: p.os,
      cpu: p.cpu,
      gpu: p.gpu,
      ram_gb: p.ram,
      locale: p.lang,
      theme: p.theme,
      theme_kind: i % 3 === 0 ? "custom" : "built-in",
      monitor_count: int(r, 1, 3),
      primary_resolution: pick(r, ["2560x1440", "1920x1080", "3440x1440", "3840x2160"]),
      counts: { mods: int(r, 12, 940), profiles: int(r, 1, 14), modpacks: int(r, 0, 9), plugins: int(r, 0, 11), themes: int(r, 1, 6) },
      // Only some installs opt into the extra hardware block, exactly as in production.
      ...(i % 4 === 0
        ? {
            hw_extra: {
              motherboard: "ASUS ROG STRIX B650-A",
              bios_version: "2.18",
              bios_manufacturer: "American Megatrends",
              machine_uuid: hex(r, 32),
              os_version: p.os,
              logical_processors: int(r, 8, 32),
              cpu_cores: int(r, 6, 16),
              cpu_threads: int(r, 12, 32),
              l2_cache_kb: 8192,
              l3_cache_kb: 32768,
              firmware_type: "2",
              secure_boot: "on",
              tpm: "2.0",
              disks: [{ model: "Samsung SSD 990 PRO", size_gb: 2000, interface: "NVMe", serial: hex(r, 10).toUpperCase() }],
            },
          }
        : {}),
    },
    sessions: p.sessions,
    first_seen: iso(p.firstMs),
    last_seen: iso(p.lastMs),
    benchmarks: [],
    // Two of the roster have a linked BetterCommunity account, one of those a Discord link,
    // so the profile screen shows both the linked and the unlinked shape.
    ...(i === 0
      ? {
          account: {
            accountId: `acc_${hex(r, 10)}`,
            displayName: `${p.name} (demo)`,
            discord: {
              id: String(int(r, 100000000000000000, 999999999999999999)),
              username: p.name.toLowerCase(),
              avatar: null,
              linkedAt: iso(p.firstMs + DAY),
              guildJoinedAt: iso(p.firstMs),
              lastMessageAt: iso(NOW - 3 * HOUR),
              lastVoiceJoinAt: iso(NOW - 2 * DAY),
              lastVoiceCreateAt: null,
            },
          },
        }
      : i === 1
      ? { account: { accountId: `acc_${hex(r, 10)}`, displayName: `${p.name} (demo)`, discord: null } }
      : {}),
  }));

  const benchmarks_recent = people.slice(0, 6).flatMap((p, i) =>
    [0, 1].map((k) => {
      const total = int(r, 2400, 7200) * (k === 0 ? 1 : 1.12);
      return {
        creator_id: p.id,
        total_ms: round(total, 1),
        throughput_mbps: round(int(r, 180, 1350) + r(), 1),
        dataset_bytes: int(r, 180, 720) * 1048576,
        source: k === 0 ? "manual" : "scheduled",
        ops: Object.fromEntries(BENCH_OPS.map((op) => [op, round((total / BENCH_OPS.length) * (0.6 + r() * 0.9), 2)])),
        ts: NOW - (k === 0 ? i * 4 * HOUR : (i * 4 + 30) * HOUR),
      };
    })
  );

  const repos = ["repo.bettermods.dev", "mods.exemple.fr", "cdn.modvault.io", "files.bmm-community.net", "nas.lan.local"].map((host, i) => {
    const g = COUNTRIES[i % COUNTRIES.length];
    return {
      host,
      count: Math.round(420 / (i + 1.1)),
      repo_name: host.split(".")[0],
      last_seen: NOW - i * 5 * HOUR,
      sample_url: `https://${host}/public`,
      lat: g.lat,
      lon: g.lon,
      geo: { country: g.country, cc: g.cc, region: g.region, city: g.city },
    };
  });

  const wvSeries = Array.from({ length: 24 }, (_, i) => ({
    hour: iso(NOW - (23 - i) * HOUR).slice(0, 13) + ":00",
    lcp: int(r, 1500, 3400),
    fcp: int(r, 700, 2100),
    inp: int(r, 90, 320),
    cls: round(r() * 0.2, 3),
    ttfb: int(r, 120, 900),
  }));

  const hour_of_day = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    sessions: Math.round(430 * (0.25 + 0.75 * Math.sin(((h - 3) / 24) * Math.PI) ** 2) * (0.9 + r() * 0.2)),
  }));
  const peak_hour = hour_of_day.reduce((a, b) => (b.sessions > a.sessions ? b : a)).hour;

  const modalIds = ALL_MODALS.slice(0, 22);
  const goalDefs: [string, string, string, number, number][] = [
    ["First profile created", "event", "profile_create", 500, 412],
    ["Repo connected", "event", "repo_connect", 400, 407],
    ["Mapper opened", "modal", "modal-mapper-input", 300, 188],
    ["Tutorial finished", "feature", "interactive-tutorial", 250, 96],
    ["Benchmark run", "event", "benchmark", 200, 143],
  ];

  return {
    updated: NOW,
    totals: {
      users: totalUsers,
      events: 2_418_907,
      sessions: 31_460,
      pageviews: 184_233,
      avg_session_min: 14.6,
      pages_per_session: 5.9,
      valid_repos: repos.length,
      repo_connections: repos.reduce((a, b) => a + b.count, 0),
      benchmarks: 738,
      live: live.filter((l) => l.status !== "offline").length,
      ...({ avg_events_per_session: 76.9, avg_sessions_per_user: 24.5 } as any),
    },
    series: ser,
    activity_min: Array.from({ length: 60 }, (_, i) => ({ t: i, events: int(r, 8, 90) })),
    events: EVENT_NAMES.map((event, i) => ({ event, count: Math.round(320_000 / (i + 1.25)) })),
    pages,
    pages_vitals: pages.map((p) => ({ view: p.view, lcp: p.lcp, cls: p.cls, inp: p.inp })),
    funnels,
    perf: {
      fps_avg: 54,
      frametime_avg_ms: 18.4,
      frametime_worst_ms: 214,
      heap_avg_mb: 286,
      bench_mbps_avg: 712,
      byView: VIEWS.map((view) => ({ view, fps: int(r, 31, 60), ft: round(int(r, 13, 33) + r(), 1), worst: int(r, 38, 260), heap: int(r, 140, 520), n: int(r, 120, 2400) })),
    },
    geo,
    country_cc,
    regions: COUNTRIES.map((c) => ({ region: `${c.region}, ${c.cc.toUpperCase()}`, count: Math.round((c.weight / 100) * totalUsers * 0.7) })),
    os: kv(OSES.map((o, i) => [o, Math.round(totalUsers / (i + 1.3))])),
    gpu: kv(GPUS.map((g, i) => [g, Math.round(totalUsers / (i + 1.5))])),
    vm_count: people.filter((p) => p.isVm).length * 14,
    repos,
    map: {
      users: users.map((u) => ({ creator_id: u.creator_id, lat: u.lat, lon: u.lon, country: u.country })),
      repos: repos.map((x) => ({ host: x.host, lat: x.lat, lon: x.lon, country: x.geo.country, count: x.count, kind: "repo" })),
    },
    retention: cohorts(r, 7 * DAY, 8, 8),
    themes: kv(THEMES.map((t, i) => [t, Math.round(totalUsers / (i + 1.4))])),
    theme_kind: kv([["built-in", 912], ["custom", 306], ["imported", 66]]),
    languages: kv(LANGS.map((l, i) => [l, Math.round(totalUsers / (i + 1.2))])),
    tasky: { visible: 964, hidden: 320, animations: 811, tooltips: 1_046 },
    modals: kv(modalIds.map((m, i) => [m, Math.round(14_000 / (i + 1.3))])),
    features: kv(FEATURES.map((f, i) => [f, Math.round(26_000 / (i + 1.2))])),
    tutorial: kv(TUTORIALS.map((t, i) => [t, Math.round(1_900 / (i + 1.1))])),
    webvitals: { lcp: 2180, fcp: 1240, inp: 178, cls: 0.07, ttfb: 340, n: 48_912 },
    webvitals_series: wvSeries,
    goals: goalDefs.map(([name, type, target, target_count, conversions], id) => ({
      id: id + 1,
      name,
      type,
      target,
      target_count,
      conversions,
      progress: Math.min(100, Math.round((conversions / target_count) * 100)),
      rate: round((conversions / totalUsers) * 100, 1),
      reached: conversions >= target_count,
    })),
    live,
    live_count: live.length,
    benchmarks_recent,
    benchmarks_ops: BENCH_OPS.map((op, i) => ({ op, avg_ms: round(640 / (i + 1.2), 1) })).sort((a, b) => b.avg_ms - a.avg_ms),
    users,
    privacy: { retention_days: 180, delete_delay_h: 48, pending_deletions: 2, pending_requests: 3 },
    ...({
      buckets: buckets(r),
      hour_of_day,
      peak_hour,
      retention_daily: cohorts(r, DAY, 10, 10),
      webvitals_pct: Object.fromEntries(
        (["lcp", "fcp", "inp", "cls", "ttfb"] as const).map((k) => {
          const base = { lcp: 2180, fcp: 1240, inp: 178, cls: 0.07, ttfb: 340 }[k];
          return [k, { p50: round(base * 0.78, k === "cls" ? 3 : 0), p75: round(base, k === "cls" ? 3 : 0), p90: round(base * 1.42, k === "cls" ? 3 : 0), p99: round(base * 2.35, k === "cls" ? 3 : 0) }];
        })
      ),
      modals_all: ALL_MODALS,
      modals_detail: modalIds.map((name, i) => ({ name, opens: Math.round(14_000 / (i + 1.3)), fps: int(r, 36, 60), ft: round(int(r, 12, 32) + r(), 1) })),
      access: kv([["scoped (recommended)", 1_042], ["full disk", 198], ["portable", 44]]),
      content: [
        { key: "mods", total: 214_882, avg: 167, users: totalUsers },
        { key: "profiles", total: 6_104, avg: 4.8, users: totalUsers },
        { key: "modpacks", total: 2_318, avg: 1.8, users: 902 },
        { key: "plugins", total: 3_996, avg: 3.1, users: 764 },
        { key: "themes", total: 4_502, avg: 3.5, users: totalUsers },
        { key: "launchpacks", total: 1_188, avg: 0.9, users: 512 },
      ],
      catalog: {
        pages: ALL_PAGES,
        tabs: ["library/installed", "library/conflicts", "settings/themes", "settings/privacy", "repo/browser", "plugins/catalogue", "docs/faq"],
        modals: ALL_MODALS,
        diagrams: ALL_DIAGRAMS,
        guides: ["getting-started.md", "conflicts.md", "server-repo.md", "plugins-api.md", "benchmarks.md"],
        labels: { library: "Library", profiles: "Profiles", mapper: "Mod Mapper", repo: "Server Repo" },
      },
    } as any),
  } as Stats;
}

// ── Drill-down answers ───────────────────────────────────────────────────────
// The pages that fetch on demand get the same treatment: derived from the roster so a
// session in the table belongs to a user who exists on the map and in Live.

function sessionEvents(r: () => number, startMs: number, n: number, modal: string) {
  const out: any[] = [];
  let t = startMs;
  for (let i = 0; i < n; i++) {
    t += int(r, 4_000, 95_000);
    const view = pick(r, VIEWS);
    const kind = r();
    out.push(
      kind < 0.45
        ? { event: "page_enter", view, ts: iso(t), dwell_ms: int(r, 3_000, 120_000) }
        : kind < 0.62
        ? { event: "click", view, modal: r() > 0.7 ? modal : undefined, detail: `Bouton « ${pick(r, ["Activer", "Synchroniser", "Analyser", "Exporter", "Résoudre"])} »`, ts: iso(t) }
        : kind < 0.72
        ? { event: "modal_open", view, name: modal, title: "Conflits détectés", ts: iso(t) }
        : kind < 0.8
        ? { event: "feature", view, detail: pick(r, FEATURES), ts: iso(t) }
        : kind < 0.87
        ? { event: "outbound", view, detail: "bettermods.dev/docs", ts: iso(t) }
        : kind < 0.93
        ? { event: "copy", view, modal, detail: "Chemin du profil", ts: iso(t) }
        : kind < 0.97
        ? { event: "input_change", view, detail: "Filtre de recherche", ts: iso(t) }
        : { event: "error", view, detail: "ENOENT: profile.json", ts: iso(t) }
    );
  }
  return out;
}

function demoSessions() {
  const r = rng(DEMO_SEED ^ 0x5e55);
  const people = creators(rng(DEMO_SEED));
  return Array.from({ length: 40 }, (_, i) => {
    const p = people[i % people.length];
    const duration_s = int(r, 120, 4_200);
    const end = NOW - i * int(r, 6, 40) * 60000;
    const start = end - duration_s * 1000;
    return {
      session_id: `sess_${hex(r, 12)}`,
      distinct_id: p.id,
      entry: pick(r, VIEWS),
      exit: pick(r, VIEWS),
      pageviews: int(r, 2, 34),
      events: int(r, 8, 190),
      duration_s,
      start: iso(start),
      end: iso(end),
    };
  });
}

/** Read-only answers for the fetch-on-demand endpoints, keyed by path. Anything not listed
 *  returns an empty object, which every caller already tolerates. */
export function demoApiGet(url: string): any {
  const [path, qs = ""] = url.split("?");
  const q = new URLSearchParams(qs);
  const r = rng(DEMO_SEED ^ 0xa11);
  const sessions = demoSessions();
  const people = creators(rng(DEMO_SEED));

  switch (path) {
    case "/api/sessions":
      return { sessions };

    case "/api/user": {
      const id = q.get("id") || "";
      const mine = sessions.filter((s) => s.distinct_id === id).slice(0, 6);
      return {
        sessions: mine.map((s) => ({
          session_id: s.session_id,
          start: s.start,
          end: s.end,
          events: sessionEvents(r, Date.parse(s.start), Math.min(28, s.events), "modal-conflict-warning"),
        })),
      };
    }

    case "/api/event": {
      const name = q.get("name") || "click";
      return {
        occurrences: Array.from({ length: 24 }, (_, i) => ({
          distinct_id: people[i % people.length].id,
          ts: iso(NOW - i * int(r, 3, 45) * 60000),
          props: { view: pick(r, VIEWS), version: pick(r, VERSIONS), $event: name, ok: r() > 0.15 },
        })),
      };
    }

    case "/api/versions":
      return {
        versions: VERSIONS.map((version, i) => ({
          version,
          users: Math.round(1_900 / (i + 1.15)),
          current_users: Math.round(560 / (i + 1.35)),
          crashes: Math.max(0, 34 - i * 8),
          first_ms: NOW - (160 - i * 26) * DAY,
          last_ms: NOW - i * 2 * DAY,
        })),
      };

    case "/api/replay":
      // No DOM recording: RrwebReplay then shows its event reconstruction, which is the
      // more useful half to demo anyway (and keeps the bundle free of a fake snapshot).
      return { events: [] };

    case "/api/admin/storage":
      return {
        storage_bytes: 3_186_852_000,
        storage_limit_mb: 5120,
        tables: [
          { table: "events", bytes: 2_461_000_000, rows: 2_418_907 },
          { table: "replay_chunks", bytes: 548_000_000, rows: 41_204 },
          { table: "sessions", bytes: 104_000_000, rows: 31_460 },
          { table: "users", bytes: 38_400_000, rows: 1_284 },
          { table: "packets", bytes: 22_100_000, rows: 9_871 },
          { table: "benchmarks", bytes: 9_200_000, rows: 738 },
          { table: "audit", bytes: 3_150_000, rows: 1_412 },
        ],
        replays: Array.from({ length: 8 }, (_, i) => ({
          session_id: `sess_${hex(r, 12)}`,
          distinct_id: people[i % people.length].id,
          chunks: int(r, 4, 180),
          bytes: int(r, 220_000, 26_000_000),
          last_ms: NOW - i * 3 * HOUR,
        })),
        packets: Array.from({ length: 10 }, (_, i) => ({
          packet_id: `pkt_${hex(r, 16)}`,
          events: int(r, 40, 3_400),
          bytes: int(r, 18_000, 4_200_000),
          last_ms: NOW - i * 90 * 60000,
        })),
      };

    case "/api/admin/audit":
      return {
        audit: ["backup_export", "replay_download", "recap_export", "deletion_decide", "storage_limit", "packet_delete", "replay_delete", "recap_import"].flatMap((action, i) =>
          Array.from({ length: 2 }, (_, k) => ({
            id: i * 2 + k + 1,
            action,
            target: `${action.split("_")[0]}_${hex(r, 8)}`,
            ip: `198.51.100.${int(r, 2, 250)}`,
            fp: hex(r, 12),
            at: NOW - (i * 2 + k) * 5 * HOUR,
          }))
        ),
      };

    case "/api/admin/recaps":
      return {
        recaps: Array.from({ length: 5 }, (_, i) => ({
          id: i + 1,
          month: iso(NOW - i * 30 * DAY).slice(0, 7),
          source: i % 2 ? "import" : "local",
          anon: i % 3 === 0,
          created_at: NOW - i * 30 * DAY,
        })),
      };

    case "/api/admin/recap":
    case "/api/admin/recap/get":
      return {
        month: iso(NOW - 30 * DAY).slice(0, 7),
        anonymized: false,
        totals: { events: 812_340, sessions: 9_812, pageviews: 61_204, users: 1_102, avg_session_min: 15, pages_per_session: 6 },
        top_events: EVENT_NAMES.slice(0, 10).map((k, i) => ({ k, v: Math.round(96_000 / (i + 1.2)) })),
        top_pages: VIEWS.map((k, i) => ({ k, v: Math.round(11_000 / (i + 1.3)) })),
        os: OSES.map((k, i) => ({ k, v: Math.round(1_100 / (i + 1.3)) })),
      };

    case "/api/admin/deletions":
      return {
        deletions: Array.from({ length: 6 }, (_, i) => ({
          packet_id: `pkt_${hex(r, 16)}`,
          status: i < 2 ? "pending" : i === 5 ? "rejected" : "done",
          decided_by: i === 4 ? "auto_purge" : i < 2 ? null : "admin",
          requested_at: NOW - (i + 1) * 9 * HOUR,
          scheduled_at: NOW + (i < 2 ? (2 - i) * 12 * HOUR : -i * HOUR),
          decided_at: i < 2 ? null : NOW - i * 5 * HOUR,
        })),
      };

    case "/api/admin/data-requests":
      return {
        bc_configured: true,
        delete_delay_h: 48,
        requests: [
          { id: 104, creator_id: people[0].id, kind: "export", source: "bmm", email: null, account_id: "acc_demo0001", note: "in-app request", status: "pending", result: {}, created_ms: NOW - 2 * HOUR },
          { id: 103, creator_id: people[3].id, kind: "delete", source: "bcweb", email: null, account_id: "acc_demo0002", note: null, status: "pending", result: {}, created_ms: NOW - 9 * HOUR },
          { id: 102, creator_id: people[5].id, kind: "export", source: "dashboard", email: "demo@example.org", account_id: null, note: "wrote in by mail", status: "pending", result: {}, created_ms: NOW - 20 * HOUR },
          { id: 101, creator_id: people[7].id, kind: "export", source: "bmm", email: "demo2@example.org", account_id: null, note: null, status: "done", result: { counts: { events: 18_204, sessions: 142 }, bytes: 4_812_000, mail: { ok: true } }, created_ms: NOW - 3 * DAY, decided_ms: NOW - 3 * DAY + HOUR, notified_ms: NOW - 3 * DAY + HOUR },
          { id: 100, creator_id: "erased:9f2c1b7a", kind: "delete", source: "bcweb", email: null, account_id: "acc_demo0003", note: null, status: "done", result: { erased: { events: 22_118, sessions: 301 }, creator_ids: ["a", "b"], mail: { ok: true } }, created_ms: NOW - 6 * DAY, decided_ms: NOW - 5 * DAY, notified_ms: NOW - 5 * DAY },
          { id: 99, creator_id: people[9].id, kind: "delete", source: "dashboard", email: null, account_id: null, note: "no recipient on file", status: "rejected", result: { mail: { ok: false, reason: "no recipient" } }, created_ms: NOW - 8 * DAY, decided_ms: NOW - 8 * DAY + 2 * HOUR },
        ],
      };

    case "/api/admin/gdpr/identity":
      return { identity: { linked: true, account_id: "acc_demo0001", display_name: "Demo account" } };

    case "/api/admin/config":
      return { config: { storageLimitMb: 5120, retentionDays: 180, deleteDelayH: 48, sampling: { total: 100, events: 100, replay: 25, errors: 100, perf: 60, benchmarks: 100, logs: 40 } } };

    case "/api/admin/user-packets":
      return {
        packets: Array.from({ length: 7 }, (_, i) => ({
          packet_id: `pkt_${hex(r, 16)}`,
          distinct_id: people[i % people.length].id,
          events: int(r, 40, 3_400),
          bytes: int(r, 18_000, 4_200_000),
          first_ms: NOW - (i + 2) * DAY,
          last_ms: NOW - i * 4 * HOUR,
          status: i === 0 ? "pending" : "done",
        })),
      };

    case "/api/admin/backup":
      return { demo: true, note: "Backups are disabled in the demo." };

    default:
      return {};
  }
}

/** Funnel and journey results are computed from the posted steps, so the controls on those
 *  screens actually respond instead of showing one frozen answer. */
export function demoApiPost(url: string, body: any): any {
  const r = rng(DEMO_SEED ^ 0xf00);
  if (url === "/api/funnel") {
    const steps: string[] = (body?.steps || []).filter(Boolean);
    const total = 4_820;
    let n = total;
    return {
      total,
      steps: steps.map((step, i) => {
        const prev = n;
        n = i === 0 ? total : Math.round(n * (0.74 - r() * 0.18));
        return { step, count: n, pct: Math.round((n / total) * 100), drop: i === 0 ? 0 : prev - n };
      }),
    };
  }
  if (url === "/api/journeys") {
    const depth: number = Math.max(2, Math.min(6, body?.steps ?? 4));
    const perLevel = 4;
    const nodes: any[] = [];
    const links: any[] = [];
    for (let d = 0; d < depth; d++) {
      for (let i = 0; i < perLevel; i++) {
        const view = VIEWS[(d * 2 + i) % VIEWS.length];
        nodes.push({ name: `${d}:${view}`, label: view, depth: d });
        if (d > 0) {
          for (let k = 0; k < perLevel; k++) {
            const value = Math.round(300 / ((d + 1) * (i + 1) * (k + 1.2)));
            if (value > 3) links.push({ source: `${d - 1}:${VIEWS[((d - 1) * 2 + k) % VIEWS.length]}`, target: `${d}:${view}`, value });
          }
        }
      }
    }
    return { paths: 182, nodes, links };
  }
  return {};
}
