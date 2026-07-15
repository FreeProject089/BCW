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

**Done (second cut)** — extracted the `NOTIF` map into a tiny `ui/notif.js` so the nav
bell no longer pins `dashboard.jsx` to the main chunk (dashboard now route-splits), and
lazy-loaded the Hero3D orb so `three` (~460 KB) loads after first paint. Main chunk
**1.38 MB → 1.23 MB** (now **−47 %** vs the original 2.34 MB).

**Guard added** — `scripts/bundle-budget.mjs` (CI `npm run budget`) fails if the gzipped
entry chunk exceeds 430 KB (currently ~372 KB), so a regression like eager-importing a
heavy route can't slip back in.

**Remaining**: the map (`maplibre-gl` 1 MB) / `rrweb` / `jszip` chunks are already split —
confirm each loads only on its route.

### 2. 🟠 DB: hot-path indexes on `CatalogItem` — **fixed**
The public `/catalog` browse (filter by `status`, sort by `downloads`/`views`/`updatedAt`)
and the BMM `/catalog.json` feed (filter `status`+`projectId`+`kind`, sort by `downloads`)
filtered and sorted on **unindexed** columns — a sequential scan + in-memory sort that
degrades as the catalog grows.

**Done** — added `(status,updatedAt)`, `(status,downloads)`, `(status,views)` and
`(projectId,kind,status)` composite indexes on `CatalogItem` (migration
`catalog_hot_path_indexes`); and a `(listed,verified,pendingReview,createdAt)` covering
index on `ServerRepo` for the public `/repos` list (migration `repos_list_index`). The
community-catalog browse already had `(status,listed)`.

**Remaining**: the heavy admin tables (analytics, audit log) — lower priority since
they're admin-only, not on visitor hot paths.

### 3. 🟠 The `/catalog.json` feed was unbounded — **fixed**
The BMM-native feed did `findMany` with **no `take:`** plus an owner join, so its query
cost and payload grew with the whole published catalog — and it's polled by every desktop
client, so a cold HTTP cache let every client hit Postgres at once.

**Done** — capped at `take: 500` (top by downloads) and wrapped in the existing two-tier
cache (60s TTL: L1 per-process + L2 Redis + request-coalescing), so concurrent cold-cache
misses share one producer call. Access control still runs per-request before the cache.
Covered by `test/cache.test.mjs`.

### 4. 🟠 Single-process state blocked horizontal scaling — **done**
The SSE feed, caches, rate-limit counters and sweepers were all in-process. All four are
now Redis-backed behind `REDIS_URL`, with an in-process fallback so the single-container
deploy is unaffected:
- **Rate-limit** → shared Redis store (`@fastify/rate-limit`'s `redis` option). *(already in place)*
- **Hot public reads** → two-tier cache (`lib/cache.mjs`): L1 per-process + L2 Redis + request
  coalescing. *(already in place; now also used by `/catalog.json`)*
- **SSE admin live feed** → each ingested event is published to a Redis channel; every
  instance runs a subscriber that re-emits other replicas' events onto its local bus
  (tagged with a per-process id to skip self-echo). **Done this pass.**
- **Sweeper** → a `SET NX PX` lock elects a single runner per tick across replicas (expires
  on its own; a Redis error fails safe). **Done this pass.**

Verified against real Postgres + Redis: subscriber `NUMSUB=1`, ingestion publishes to the
feed channel, and the fallback path stays 39/39 green with no Redis.

### 5. 🟡 Analytics aggregations are full-window scans
The admin dashboards run raw-SQL `GROUP BY` / `count(DISTINCT …)` over `AnalyticsEvent`
for the selected window. Retention now bounds the table (see tech audit §3.6), but a wide
window over a busy site is still a heavy scan on every dashboard load.

**Done (time-series)** — an `AnalyticsDaily` rollup (day → views + distinct visitors),
populated by the sweeper (trailing-3-days refresh each tick + a once/day full recompute
that also backfills on first run). `/admin/analytics` now reads it for the day-granularity
series (a `<=~365`-row PK read) instead of two full-window `GROUP BY` scans; the hourly zoom
stays raw. Rows persist beyond raw retention, so they double as long-term history. Covered
by `rollup.test.mjs`.

**Remaining**: the other ~15 dashboard aggregations (top pages, device/browser/os/geo
breakdowns) still scan the window — those would each need their own rollup dimension, a
much larger schema + producer. Lower priority now that retention bounds the table and the
heaviest repeated query (the series) is off the scan path.

### 6. 🟡 No SSR / prerender for first paint & indexing
It's a client-rendered SPA: the browser downloads JS, boots React, then fetches data —
so first-contentful-paint and search-engine indexing lag. Crawler link-unfurl OG is
already covered (tech audit §3.8), which handles social sharing but not indexing/TTFB.

**Plan**: this is the biggest lift. Options, cheapest first — (a) prerender a handful of
high-value static routes at build time; (b) an edge cache of the OG-style shell for
crawlers; (c) full SSR (Vite SSR / a meta-framework) only if SEO becomes a priority.

### 7. 🟡 Images & media — partly done
Avatars are generated (Boring-avatars, cheap) and cached a day. Uploaded covers/icons go
through the `/media/*` proxy; each key carries a `randomUUID()`, so a URL's bytes never
change — **now served `immutable, max-age=1yr`** (was 1 day), so the browser/CDN never
re-validates.

**Resize endpoint added** — `/media/*?w=<width>` (snapped to 64…768) downscales raster
images to webp via `@napi-rs/canvas`, each variant resized once into a small LRU and
served immutable (an 800px source → 256px is ~78 % smaller). Decoding on the JS main
thread is a Rust-worker candidate (see the [Rust workers plan](RUST_WORKERS_PLAN_EN.md) §P3).

**Front-end adoption started** — a `lib/img.js` `thumb(url,w)` helper appends `?w=` only to
`/media` URLs (external/data URLs untouched); wired into the busiest cover grids (blog +
project/showcase cards). Remaining cover renders (catalog items, etc.) adopt the same
helper. Longer term, serving `/media` straight from object storage / a CDN would take the
byte-proxying off the Node API entirely.

---

## Prioritised plan

| P | Action | Payoff | Status |
|---|---|---|---|
| **P1** | Route-split the SPA | −41 % initial JS for every visitor | ✅ done |
| **P1** | `CatalogItem` hot-path indexes | browse + feed stay fast as the catalog grows | ✅ done |
| **P1** | Cap / cache the `/catalog.json` feed | bounds the most-polled endpoint | ✅ done |
| **P2** | Finish frontend splitting (extract `NOTIF`, lazy hero `three`) | main chunk 1.38 → 1.23 MB (−47 % total); bundle budget still ▢ | ✅ done |
| **P2** | Index the public list endpoints (repos, community catalogs) | remove the seq-scans; admin tables still ▢ | ✅ done |
| **P2** | Redis pub/sub + rate-limit store + sweeper locks (behind `REDIS_URL`) | unblocks horizontal scaling | ✅ done |
| **P3** | Analytics daily rollups (time-series) | day-series is a PK read, not a full scan | ✅ done |
| **P3** | Prerender/SSR for public routes | first-paint + search indexing | ▢ |
| **P3** | Image cache headers (done: immutable /media) / responsive variants (▢) | lighter list pages | ◑ partial |

## Verdict

The two highest-payoff, lowest-risk wins are shipped and verified: **−41 % initial JS**
for every visitor and **indexed catalog reads**. The rest is a clear ladder — bound the
one unbounded hot endpoint, finish the frontend split, then the Redis work that unlocks
running more than one instance. Nothing here is a fire; they're the things that would bite
as traffic and the catalog grow, tackled in payoff order.
