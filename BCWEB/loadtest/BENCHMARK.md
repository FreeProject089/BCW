# BCWEB Load Benchmark

> 🇫🇷 Version française : [BENCHMARK_FR.md](BENCHMARK_FR.md)

Full stack under test: Caddy → nginx (SPA) / Fastify API → Postgres, all in Docker Desktop on the dev machine, load generated with autocannon from the same machine (loopback).

## The harness (rewritten 2026-07-15)

`run.mjs` is now a multi-**scenario**, named-**level** stress ladder that captures the full
latency tail and writes a report meant to be read by **a human or an AI**. Rerun anytime
(`cd loadtest && npm install && node run.mjs`, stack up):

```
BASE=http://localhost:3000 node run.mjs     # straight at the API container
BASE=http://localhost      node run.mjs     # through Caddy (auto-adds /api)
QUICK=1 node run.mjs                         # 2 low levels, 5s each (smoke)
DURATION=15 LEVELS=chill,normal,busy node run.mjs
CONNS=10,100,1000 node run.mjs               # custom numeric ladder
SCENARIOS=cached,feed node run.mjs           # subset of endpoint mixes
RPM_PER_USER=6 node run.mjs                  # tune the min-spec user model
```

- **Levels** (concurrency, chill → extreme): `chill` (10) · `normal` (50) · `busy` (200) ·
  `heavy` (1,000) · `extreme` (5,000). `QUICK=1` runs the two lowest; override with `CONNS=`.
- **Scenarios** (endpoint mixes = different data shapes/costs):
  - `cached` — cheap cached/liveness reads (`/health`, `/kofi/stats`): the cache + event-loop path.
  - `db-read` — DB list queries (`/projects`, `/showcase`, `/catalog`).
  - `feed` — the heaviest public render, the top-500 `catalog.json` feed.
  - `mixed` — a realistic read-weighted blend (this is what the min-spec is anchored to).
- **Per level it records** throughput (req/s + real *served* 2xx/s), the latency tail
  **p50 / p90 / p99 / p99.9**, `non-2xx` / errors / timeouts, and a **live `/health` ping
  probe** issued *during* the flood — if that ping's p99 explodes, the Node event loop is
  CPU-starved (the single most useful bottleneck signal).
- **It writes** (all git-ignored, regenerate per run):
  - `report.md` — human+AI report: per-scenario tables, a saturation **knee**, a
    plain-language **bottleneck diagnosis**, an extrapolated **minimum-server-spec** table
    (users → vCPU/RAM), and a Core Web Vitals note.
  - `report.json` — the same data, machine-readable (diff it between runs; the knee moving
    up is the win condition).

The historical entries below predate this harness but the picture holds: on one loopback
box the honest signals are served req/s, the p99/p99.9 tail, and where errors/timeouts first
appear — the upper levels are mostly the rate limiter shedding load *by design*.

### Re-run 2026-07-10 (API container directly, :3000)
Confirms the same picture: the API absorbs **~10–11k req/s at p99 < 20 ms with 0
errors and 0 timeouts**, and even at low concurrency almost every request past the
first per-IP window comes back non-2xx — the anti-abuse **rate limiter shedding load
by design**. The server never falls over under the flood; that's the headline. The
runner now prints a `2xx/s` (real served throughput) and `non2xx` column, plus a
per-endpoint headline, so the limiter's effect is explicit rather than hidden in a
"req/s" number that's mostly rejections.

## Results

### Static SPA shell (Caddy → nginx)

| Concurrent conns | Req/s | p50 | p99 | Errors |
|---|---|---|---|---|
| 100 | **11,000** | 9 ms | 12 ms | 0 |
| 1,000 | 8,700 | 103 ms | 872 ms | 0 |
| 5,000 | 8,200 | 481 ms | 5.2 s | 0 |
| 10,000 | 0 (client collapse) | — | — | — |

### API endpoints (`/api/projects`, `/api/showcase`, `/api/kofi/stats`)

| Concurrent conns | Req/s (all responses) | p50 | p99 | Notes |
|---|---|---|---|---|
| 100 | 6,600–8,100 | 10–11 ms | 25–68 ms | most responses are **429s** (rate limiter, by design) |
| 1,000 | 1,000–6,000 | 19–388 ms | 1.6–3.8 s | 429s + first connection errors on /showcase |
| 5,000 | 27–1,800 | 8–13 s | 10–13 s | heavy connection errors — saturation point |
| 10,000 | 0 | — | — | client-side socket exhaustion (see below) |

## What this means

1. **The single most important number:** the static site serves **~11k req/s at 9 ms median** — a real page load is ~10 requests, so the shell alone can absorb roughly **1,000 page loads per second** (~60k page views/min) on this hardware before any CDN.

2. **The API is deliberately capped per IP.** The global Fastify rate limiter allows **600 req/min per IP**; sustained load from one address immediately turns into fast 429 responses (served at 6–8k/s, ~10 ms — the limiter itself is cheap). That's good DoS posture: one abusive client can't reach the database. It also means a single-IP benchmark cannot measure "true" DB throughput above 10 req/s — by design.

3. **Where it starts to struggle:** the proxied API path degrades sharply around **~5,000 concurrent connections** (p50 jumps to 8–13 s, connection errors appear) — the bottleneck is connection handling in the Caddy→Fastify hop, not Postgres (the queries themselves stay ~10 ms when they get through). The static path holds ~8k req/s at 5k conns with elevated tail latency but zero errors.

4. **The 10k / 100k / 1M levels can't be honestly measured from one dev box.** At 10,000 connections the *load generator* dies first (Windows loopback ephemeral-port/socket exhaustion — 0 requests even against nginx, which was fine at 5k). Simulating 100k–1M users requires distributed generators (k6 cloud / many VMs) and, realistically, horizontal API replicas + a CDN in front. Extrapolation from these numbers:
   - **~10k concurrent *browsing users*** (mixed static+API at human request rates, not open sockets): comfortable — static path has huge headroom and per-user API traffic is tiny.
   - **~100k concurrent users**: needs a CDN for the shell + 2–4 API replicas behind Caddy; Postgres reads here are light enough that a single instance with a connection pooler likely still holds.
   - **1M concurrent users**: out of scope for a single VPS by any measure — CDN + multiple API nodes + managed Postgres with read replicas.

## Bottleneck order (first to break → last)

1. Per-IP API rate limit (by design, 600/min) — protects everything behind it.
2. Caddy↔Fastify proxied connection handling (~5k concurrent sockets).
3. Static nginx path (~8–11k req/s sustained, error-free to 5k conns).
4. Postgres — never the limiter in these runs (queries ~10 ms under load).

## Recommendations (if/when real traffic approaches these levels)

- Put a CDN (Cloudflare) in front — the SPA shell + assets drop to near-zero origin load, and it absorbs the 100k+ tier for free.
- Raise Fastify's `connectionTimeout`/`keepAliveTimeout` and consider `reusePort` clustering (2–4 API processes) if sustained >1k concurrent API sockets is ever real.
- The per-IP 600/min limit is generous for humans (10 req/s); keep it.

---

## Re-run 2026-07-10b — with a real-latency probe

The runner now has **Phase 1** (a light per-endpoint latency probe at 1 connection,
which stays under the per-IP limiter's fresh window → genuine 2xx responses) and
**Phase 2** (the stress ladder). This finally separates "how fast is a real request"
from "how does it behave under a flood".

### Phase 1 — real latency (what a user actually feels)

| Endpoint | p50 | p99 | avg |
|---|---|---|---|
| `/health` | 0 ms | 6 ms | 0.6 ms |
| `GET /projects` (DB + visibility) | 2 ms | 5 ms | 2.6 ms |
| `GET /showcase` (DB list) | 1 ms | 6 ms | 1.7 ms |
| `GET /kofi/stats` (DB aggregate) | 1 ms | 5 ms | 1.5 ms |

**Every endpoint answers in 1–6 ms.** The Postgres queries are not a bottleneck.

### Phase 2 — under flood (50 / 250 / 1000 conns, loopback)

- `/health` (rate-limit-exempt): **~8k req/s all-2xx** at p99 10 ms (50 conns),
  degrading to p99 ~460 ms at 1,000 conns — that's the raw request-handling ceiling
  of one dev box (Docker Desktop, loopback).
- DB endpoints: **~0 served 2xx, ~70–80k rejected/window** — the per-IP limiter
  (600/min) sheds the flood with **0 errors, 0 timeouts, low latency**. Intended DoS
  posture: one IP can't reach the DB in bulk.

## What to optimize (in priority order)

1. **Put a CDN in front (Cloudflare/R2).** Biggest single win: the SPA shell + assets
   + hosted-repo downloads leave the origin almost entirely. Absorbs the 100k+ tier
   for free.
2. **Postgres connection pooler (PgBouncer)** once you run more than one API replica —
   the queries are 1–3 ms, so the limit is connection count, not query time.
3. **Optional Redis cache** on the hot public reads (`/projects`, `/showcase`,
   `/kofi/stats`) with a short TTL — not needed yet (1–3 ms), worth it only if a CDN
   isn't fronting them and traffic climbs.
4. **Keep the per-IP rate limit** (600/min is generous for a human at ~10 req/s) — it's
   cheap and it's what keeps the DB safe under abuse.
5. Object storage (hosted files): serve downloads via the CDN / an S3-compatible edge
   rather than straight from MinIO once download volume is real.

## Server sizing (estimates, this stack = api + web + postgres + redis + minio + caddy + bot + telemetry)

| Tier | Users | vCPU | RAM | Disk | Notes |
|---|---|---|---|---|---|
| **Minimum** | up to ~1k registered / low-hundreds concurrent | **2** | **4 GB** | 40 GB SSD + hosting quota | Single VPS, everything in one compose. 2 GB works but is tight with MinIO+PG+Redis+bot. |
| **Comfortable** | few thousand | 4 | 8 GB | 80 GB SSD + quota | Add a CDN for static; PgBouncer if you add API replicas. |
| **Scale-out** | 10k+ concurrent | 8+ (spread) | 16 GB+ | managed | CDN + 2–4 API replicas behind Caddy + managed Postgres (read replica) + S3/R2 for files. |

**Estimation basis:** a browsing user makes only a few requests per minute, and each
is 1–6 ms of server time. A single 2 vCPU / 4 GB box therefore serves **thousands of
concurrent browsing users** comfortably; the practical ceilings are (a) connection
handling at very high concurrency and (b) the single Postgres — both solved by a CDN +
replicas long before CPU/RAM is the limit. Disk is driven almost entirely by how much
hosted-repo storage you sell, not by the app itself (~5–10 GB base).

## Stress test 2026-07-10b (up to 5,000 concurrent connections)

Same box, ladder 100 → 1,000 → 5,000 conns, 10 s each. **Headline: the server survives
5,000 concurrent connections with 0 errors and 0 timeouts** — latency degrades
gracefully (backpressure) but nothing falls over.

| Endpoint | 100 conns | 1,000 conns | 5,000 conns |
|---|---|---|---|
| `/health` (unlimited) | 5.4k rq/s · p99 28 ms | 4.7k · p99 1.1 s | 3.3k · p99 6.2 s |
| `/projects` (rate-limited) | 9.0k rq/s · p99 27 ms | 10.3k · p99 88 ms | 6.1k · p99 5.3 s |
| `/showcase` | 7.9k · p99 25 ms | 8.2k · p99 536 ms | 4.2k · p99 9.5 s |
| `/kofi/stats` | 9.3k · p99 21 ms | 7.1k · p99 1.6 s | 4.5k · p99 8.9 s |

`err` and `timeout` were **0 at every level** — the degradation is pure tail-latency,
not failure. On real hardware behind a CDN + multiple API replicas, the per-node
concurrency each node sees is a fraction of this, so these are pessimistic single-box
loopback numbers.

## Optimization applied — micro-cache on hot public reads (before → after)

Applied a small in-process TTL cache (`apps/api/src/cache.mjs`, with request-coalescing)
to the two visitor-independent public reads, plus `Cache-Control` headers so a CDN can
hold them too:
- `GET /kofi/stats` — 15 s TTL (invalidated on a new tip)
- `GET /showcase` — 10 s TTL (invalidated on admin edits)

`/projects` was **not** cached: it's per-visitor (visibility whitelist) and has a
scheduled-swap side effect, so caching it would risk stale/leaked visibility.

**Real-latency probe, before vs after (avg):**

| Endpoint | Before | After | Δ |
|---|---|---|---|
| `GET /showcase` | 3.34 ms | **0.50 ms** | −85% |
| `GET /kofi/stats` | 1.59 ms | **0.34 ms** | −79% |
| `GET /projects` (uncached) | 2.75 ms | 1.75 ms | (variance) |

The **bigger, production-relevant** win doesn't show in a single-IP benchmark (the rate
limiter already caps DB hits per IP): under real multi-IP traffic, these endpoints now
hit Postgres **once per TTL window** instead of once per request, and the coalescing
means a cache-expiry under load is a single DB query, not a stampede. Cache-Control also
lets browsers/CDN serve repeats with zero origin hits.
