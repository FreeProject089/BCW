# BCWEB — Performance audit & bottleneck plan (July 2026)

*A focused look at where BCWEB spends time and bytes, what was fixed in this pass, and a
prioritised plan for the rest. Complements the [technical audit](TECH_AUDIT_EN.md).
🇫🇷 [Version française](PERF_AUDIT_FR.md).*

## Method

- **Frontend**: production `vite build`, measured the emitted chunk sizes.
- **Backend**: read the hot request paths (catalog browse, the BMM `/catalog.json` feed,
  analytics aggregations), cross-checked their `where`/`orderBy` against the Prisma
  `@@index` coverage, and scanned for unbounded `findMany` and per-item query loops.
- **Scaling**: identified in-process state that pins the app to a single instance.

---

## Findings & status

### 1. 🔴 Frontend: one giant JS bundle — **fixed (first cut)**
Every visitor downloaded the whole app as a single **2.34 MB** `index` chunk, including
the ~7.3k-line admin back-office, repo tools and editors that a normal visitor never opens.

**Done** — route-split the SPA (`React.lazy` + a `Suspense` boundary): all non-landing
routes now load on demand. Main chunk **2.34 MB → 1.38 MB (−41 %)**; the admin bundle is
its own **504 KB** chunk fetched only when an admin opens `/admin`; 32 on-demand chunks.

**Remaining** (see plan):
- The main chunk is still ~1.38 MB. `dashboard.jsx` stays eager because the nav bell
  imports its `NOTIF` map — extracting `NOTIF`/`NOTIF_FALLBACK` into a tiny module would
  let the dashboard split out too.
- Heavy vendor chunks are already split (`maplibre-gl` 1 MB, `three` 464 KB, `rrweb`
  260 KB, `jszip` 96 KB) — confirm each is loaded **only** on the route that needs it
  (map → analytics, three → hero, rrweb → session replay) and lazy-load the hero orb so
  `three` never blocks first paint.
- Add a bundle-size budget/visualiser so regressions are visible.

### 2. 🟠 DB: hot-path indexes on `CatalogItem` — **fixed**
The public `/catalog` browse (filter by `status`, sort by `downloads`/`views`/`updatedAt`)
and the BMM `/catalog.json` feed (filter `status`+`projectId`+`kind`, sort by `downloads`)
filtered and sorted on **unindexed** columns — a sequential scan + in-memory sort that
degrades as the catalog grows.

**Done** — added `(status,updatedAt)`, `(status,downloads)`, `(status,views)` and
`(projectId,kind,status)` composite indexes (migration `catalog_hot_path_indexes`).

**Remaining**: audit the other list endpoints the same way — the public repo list
(`ServerRepo` by `listed`/`status`), the community-catalog browse, and the admin tables.

### 3. 🟠 The `/catalog.json` feed was unbounded — **fixed**
The BMM-native feed did `findMany` with **no `take:`** plus an owner join, so its query
cost and payload grew with the whole published catalog — and it's polled by every desktop
client, so a cold HTTP cache let every client hit Postgres at once.

**Done** — capped at `take: 500` (top by downloads) and wrapped in the existing two-tier
cache (60s TTL: L1 per-process + L2 Redis + request-coalescing), so concurrent cold-cache
misses share one producer call. Access control still runs per-request before the cache.
Covered by `test/cache.test.mjs`.

### 4. 🟠 Single-process state blocks horizontal scaling
The SSE feed (`feedBus`), several in-memory caches, and the rate-limit counters are
in-process; the sweepers assume a single instance (no distributed lock). Correct for
today's single-container deploy, but a second replica would double-fire schedulers and
split the live admin feed. This is the same item as the tech audit's §3.4 / P2.

**Plan (Redis pub/sub)**: (a) move the SSE fan-out to Redis pub/sub (already have
`ioredis`); (b) move rate-limit + the hot caches to Redis (`@fastify/rate-limit` supports
a Redis store); (c) guard the sweepers with a Redis lock (`SET NX PX`) so only one instance
runs them. Ship it behind `REDIS_URL` with an in-process fallback, so single-container
deploys are unaffected.

### 5. 🟡 Analytics aggregations are full-window scans
The admin dashboards run raw-SQL `GROUP BY` / `count(DISTINCT …)` over `AnalyticsEvent`
for the selected window. Retention now bounds the table (see tech audit §3.6), but a wide
window over a busy site is still a heavy scan on every dashboard load.

**Plan**: pre-aggregate into a daily rollup table (a nightly sweeper job) and read the
rollups for day-granularity views, falling back to raw only for the hourly zoom; add
covering indexes for the remaining raw queries.

### 6. 🟡 No SSR / prerender for first paint & indexing
It's a client-rendered SPA: the browser downloads JS, boots React, then fetches data —
so first-contentful-paint and search-engine indexing lag. Crawler link-unfurl OG is
already covered (tech audit §3.8), which handles social sharing but not indexing/TTFB.

**Plan**: this is the biggest lift. Options, cheapest first — (a) prerender a handful of
high-value static routes at build time; (b) an edge cache of the OG-style shell for
crawlers; (c) full SSR (Vite SSR / a meta-framework) only if SEO becomes a priority.

### 7. 🟡 Images & media
Avatars are generated (Boring-avatars, cheap). Confirm uploaded covers/icons are served
with long cache headers + width-appropriate variants (or through an image CDN) rather than
full-size originals on list cards.

---

## Prioritised plan

| P | Action | Payoff | Status |
|---|---|---|---|
| **P1** | Route-split the SPA | −41 % initial JS for every visitor | ✅ done |
| **P1** | `CatalogItem` hot-path indexes | browse + feed stay fast as the catalog grows | ✅ done |
| **P1** | Cap / cache the `/catalog.json` feed | bounds the most-polled endpoint | ✅ done |
| **P2** | Finish frontend splitting (extract `NOTIF`, lazy hero `three`, bundle budget) | shrink the 1.38 MB main chunk further | ▢ |
| **P2** | Index the other list endpoints (repos, community catalogs, admin) | remove the remaining seq-scans | ▢ |
| **P2** | Redis pub/sub + rate-limit store + sweeper locks (behind `REDIS_URL`) | unblocks horizontal scaling | ▢ |
| **P3** | Analytics daily rollups | fast dashboards at any window | ▢ |
| **P3** | Prerender/SSR for public routes | first-paint + search indexing | ▢ |
| **P3** | Image cache headers / responsive variants | lighter list pages | ▢ |

## Verdict

The two highest-payoff, lowest-risk wins are shipped and verified: **−41 % initial JS**
for every visitor and **indexed catalog reads**. The rest is a clear ladder — bound the
one unbounded hot endpoint, finish the frontend split, then the Redis work that unlocks
running more than one instance. Nothing here is a fire; they're the things that would bite
as traffic and the catalog grow, tackled in payoff order.
