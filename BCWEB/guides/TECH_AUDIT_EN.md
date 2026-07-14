# BCWEB — Technical Audit (July 2026)

*A frank, complete assessment of the BetterCommunity Web platform: architecture, strengths,
weaknesses, risks, and a prioritized action plan. Complements the feature-by-feature
[Technical_Analysis_EN.md](Technical_Analysis_EN.md). 🇫🇷 [Version FR](TECH_AUDIT_FR.md).*

---

## 1. What BCWEB is, technically

A **npm-workspaces monorepo**:

| Part | Stack | Role |
|---|---|---|
| `apps/api` | Node 20+, **Fastify**, **Prisma** → PostgreSQL, Redis, S3-compatible object storage (MinIO) | All business logic: accounts, catalogs, Server-Repo hosting, billing (Stripe), moderation, analytics, Discord-bot config, OIDC provider |
| `apps/web` | **React 18 + Vite**, react-router, hand-rolled UI kit (`ui/ui.jsx`), no CSS framework beyond utility classes | SPA frontend, FR/EN i18n, theming + translucent surfaces |
| `apps/bot` | discord.js | Community Discord bot (gating, welcome, payments, giveaways…) |
| `packages/db` | One Prisma schema | Single source of truth for ~60 models |
| `infra/` | Docker Compose + **Caddy** edge (TLS, anti-bot, CSP), backup scripts, inert k8s manifests | Single-VPS production deploy |
| `bmm/telemetry-dashboard` | Rust/Axum + React | Separate opt-in telemetry collector |

Deployment is **Docker Compose on one VPS** — deliberately (k8s evaluated and deferred);
scaling ladder documented (CDN → managed DB → replicas).

## 2. Strengths

### 2.1 Security posture (well above hobby grade)
- argon2id passwords, optional TOTP 2FA, httpOnly/SameSite session cookies, short-lived
  **elevated** cookie for server-control actions.
- **Capability-based admin** (`requireCap`) + strict role hierarchy (USER→MOD→ADMIN→SUPERADMIN,
  act-only-below-you), granular blog permissions.
- **Tamper-evident audit chain** (HMAC hash chain + verify endpoint), sensitive-action alerts,
  protected audit tables in the DB viewer.
- Consistent defensive patterns: constant-time secret compares, SSRF allow-lists, path-traversal
  guards on every storage key, presigned uploads (bytes never transit the API), media served
  `attachment`+`nosniff` (stored-XSS kill), open-redirect guards, rate limits + edge PoW anti-bot,
  strict zod validation at every route boundary.
- Repeated in-session security reviews found no new HIGH/MEDIUM issues across large batches.

### 2.2 Privacy & compliance
- First-party, consent-gated, anonymous analytics (daily-rotating visitor hash, no third parties).
- GDPR-conscious legal pages (Art. 6 bases, transfers, processors, withdrawal) kept **accurate**
  to what's collected; cookie consent with equal-prominence Reject + granular categories.

### 2.3 Product/domain design
- **Pooled-storage billing** with one source of truth (`recomputePoolBytes`): repos + catalogs
  share fungible pool bytes; merge/split/consolidation all reduce to that invariant. Idempotent
  Stripe webhooks; prepaid + recurring + grace windows + free-tier claims that survive
  unlink/relink.
- Reused primitives instead of one-offs: the `?k=` share-key pattern (catalogs → repos), the
  toast-undo pattern, the `.card`/glass surface contract, the GitHub-Releases-compatible
  update feed, config-snapshot versioning.
- BMM-native feeds + deeplinks make the platform genuinely useful to the desktop apps, with
  BCWEB-first / GitHub / local fallback chains so no single point of failure bricks clients.

### 2.4 Operations & docs
- One-command deploy, `/live` + `/ready` probes, graceful shutdown, documented backup/restore,
  load-test + benchmark suites, capacity-aware ("scarcity") pricing.
- Unusually complete bilingual documentation: deploy, env, Docker, backups, features, user/
  moderator/host guides, auto-update — all current.

### 2.5 Frontend consistency
- One UI kit, one i18n convention (`t(key, fallback)`), one theming contract; features look and
  behave alike. Bundle-splitting and caching where it hurt.

## 3. Weaknesses & risks

### 3.1 🔴 No automated tests (the #1 risk)
There is **no unit, integration, or E2E test**. Verification is `node --check`, `vite build`,
`prisma validate`, and manual runs. The most dangerous surface is billing (webhooks, pool
recompute, consolidation — the Stripe consolidation round-trip shipped code-reviewed but
runtime-untested). A regression here charges real users wrongly.

### 3.2 🔴 No CI/CD
Nothing prevents committing a broken build or a leaked secret. (Two real incidents: a live
Discord token in `.env.example` history; a webhook secret pasted in plaintext chat.) A minimal
pipeline (build + checks + secret scan) would catch both classes.

### 3.3 🟠 Monolith files
`apps/web/src/pages/pages.jsx` is ~10k lines (dozens of admin components), `repos.jsx` and
`i18n.jsx` are huge. Consequences: slow editors, painful conflicts, hard onboarding, and the
recurring "missing import" runtime crashes seen this month (X, Calendar) — bare JSX
identifiers pass the build and explode at render. Extraction into feature modules is overdue.

### 3.4 🟠 Single-process assumptions
The SSE events feed (`feedBus`), various in-memory caches, and rate-limit state are
in-process. Sweepers/schedulers assume one instance (no distributed locks). Fine for the
current single-container deploy — but scaling to replicas requires a Redis pub/sub pass
(documented in code, not implemented).

### 3.5 🟠 Schema management: `prisma db push` at boot with `--accept-data-loss`
No migration history. A schema edit that renames/narrows a column can silently drop data in
production. Moving to `prisma migrate` (with checked-in migrations) is the safe path.

### 3.6 🟡 Unbounded table growth
`AnalyticsEvent`, `InteractionEvent`, `WebVital`, `LoginAttempt` grow forever (some tables have
caps; analytics retention is partial). Raw-SQL aggregations will degrade; needs retention
sweeps or partitioning before the tables get big.

### 3.7 🟡 Convention-only i18n
FR/EN parity is discipline, not tooling — a missing key silently falls back to English.
A key-parity lint would make it structural.

### 3.7b 🟡 Dependency vulnerabilities (transitive, low reachability)
`npm audit` (Jul 2026): **web = 0**, **bot = 0**, **api = 5 high + 2 moderate, all transitive**,
**0 critical**. The two roots:
- **`fast-uri@2.4.0`** (via Fastify 4) — path-traversal / host-confusion advisories. Patched
  only by upgrading **Fastify 4 → 5** (a deliberate breaking migration, not `audit fix --force`).
  Reachability is low (Fastify does its own path normalisation), but it should be scheduled.
- **`ip-address`** (via `geoip-lite`) — XSS in `Address6` HTML-emitting methods. **Not reachable**:
  `geoip-lite` only parses addresses, never calls those HTML methods. Fixed by `geoip-lite` 1→2.

Action: track the **Fastify 4→5** and **geoip-lite 1→2** upgrades as their own tested tasks;
don't blind-`--force` them (both are breaking and would risk the API build).

### 3.8 🟡 Miscellaneous
- Host-side DX footguns: scripts require the container env/generated client (now guarded with
  friendly errors, but the general pattern remains).
- Accessibility is partial (aria attributes exist in places; no systematic audit).
- SEO limited by the SPA (some OG/meta routes exist; no SSR/prerender).
- Bus factor ≈ 1; the deep billing edge cases live in code comments and one person's head.

## 4. Prioritized action plan

| P | Action | Why |
|---|---|---|
| **P1** | Minimal CI: build web, `node --check` API, `prisma validate`, secret scanning | Catches broken builds + leaked secrets at commit time |
| **P1** | Tests for billing: webhook fixtures (checkout/renew/consolidate/lapse), `recomputePoolBytes` invariants, authz middlewares | Highest-blast-radius code, currently untested |
| **P1** | Switch `db push` → `prisma migrate` | Removes silent-data-loss risk on schema changes |
| **P2** | Split `pages.jsx` / `repos.jsx` into feature modules; ESLint (no-undef would have caught the crash bugs) | Maintainability + prevents the recurring import crashes |
| **P2** | Analytics retention sweeps (cap by age/rows) | Keeps the DB healthy long-term |
| **P2** | Redis pub/sub for SSE + shared rate limits (when replicas become real) | Unblocks horizontal scaling |
| **P3** | i18n key-parity lint; accessibility pass; error monitoring; OG/prerender for public pages | Polish & reach |

## 5. Verdict

BCWEB is an unusually well-secured, well-documented, feature-dense platform for its team size,
with a coherent domain model (pools, capabilities, share keys) that composes instead of
sprawling. Its central weakness is **verification**: everything rests on careful code review
and manual testing — no automated safety net under the billing system or the 60-model schema.
The P1 items (CI, billing tests, migrations) are cheap relative to the risk they retire and
should come before the next feature wave.
