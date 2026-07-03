# BCWEB Load Benchmark — 2026-07-03

Full stack under test: Caddy → nginx (SPA) / Fastify API → Postgres, all in Docker Desktop on the dev machine, load generated with autocannon from the same machine (loopback). 10s per level, connection ladder 100 → 1,000 → 5,000 → 10,000.

Rerun anytime: `cd loadtest && npm i autocannon && node run.mjs` (stack must be up).

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
