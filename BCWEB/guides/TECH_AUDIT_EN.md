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
`apps/web/src/pages/pages.jsx` **was** ~10k lines (dozens of admin components) — it has since
been split into per-route feature modules and is now a 210-line shared-helper module (see P2).
`repos.jsx` (~2k) and `i18n.jsx` are still large. The consequences that drove the split: slow
editors, painful conflicts, hard onboarding, and the recurring "missing import" runtime crashes
(X, Calendar) — bare JSX identifiers pass the build and explode at render. That last class is
now caught structurally by the ESLint `no-undef` gate in CI.

### 3.4 🟠 Single-process assumptions
The SSE events feed (`feedBus`), various in-memory caches, and rate-limit state are
in-process. Sweepers/schedulers assume one instance (no distributed locks). Fine for the
current single-container deploy — but scaling to replicas requires a Redis pub/sub pass
(documented in code, not implemented).

### 3.5 🟠 Schema management: `prisma db push` at boot with `--accept-data-loss`
No migration history. A schema edit that renames/narrows a column can silently drop data in
production. Moving to `prisma migrate` (with checked-in migrations) is the safe path.

### 3.6 🟡 Unbounded table growth — largely addressed
`AnalyticsEvent`, `InteractionEvent`, `WebVital`, `LoginAttempt` used to grow forever. A
retention sweep (`sweepAnalyticsRetention`, config in `lib/retention.mjs`) now purges rows
past a per-table age window (defaults 365/120/120/180 days; 0 = keep forever; admin-tunable
via `GET/PUT /admin/analytics/retention`), batched at 5k rows/table/sweep. Very large tables
may still want partitioning, but growth is now bounded by default.

### 3.7 🟡 Convention-only i18n — now tooled
FR/EN parity used to be discipline, not tooling — a missing key silently fell back to English,
and a duplicate dict key silently overrode an earlier one (which had let two features collide on
the same key). **DONE** — `scripts/i18n-check.mjs` (CI `npm run i18n:check --strict`) now fails on
duplicate keys and on any `t()` key with no `DICT.fr` entry. It caught 8 duplicate-key bugs (incl.
the OAuth-clients heading rendering "Mes catalogues") and 26 English-fallback gaps, all fixed.

### 3.7b ✅ Dependency vulnerabilities — resolved
`npm audit` for `apps/api` now reports **0 vulnerabilities** (web = 0, bot = 0 throughout).
The three roots, all cleared this pass:
- **`ip-address`** (via `geoip-lite`) — XSS in `Address6` HTML-emitting methods. **DONE** —
  bumped **geoip-lite 1.4.10 → 2.0.3** (pulls `ip-address@10`); the advisory no longer appears.
  It was never reachable anyway (`geoip-lite` only parses addresses). 2.0.3 bundles its data in
  the tarball with no postinstall, so `npm ci` needs no download or MaxMind key; `lookup()` shape
  is unchanged, no code change needed.
- **`fast-uri`** (via Fastify 4) — path-traversal / host-confusion advisories. **DONE** — upgraded
  **Fastify 4.29 → 5.10** + the three `@fastify` plugins (cookie/cors/rate-limit) to their v5
  majors. Small footprint made it safe (no `reply.res`/`request.req`/`routerPath`/`getResponseTime`;
  the touched APIs — `setErrorHandler`, `addContentTypeParser` raw-body — are unchanged in v5), so
  no code change. Verified: suite 30/30 green on v5, server boots with all plugins + 40 routes and
  `/ready`+`/live` 200.
- **`nodemailer`** (direct dep) — a batch of advisories published since the first audit (SMTP
  command injection via CRLF, addressparser DoS, jsonTransport/raw file-read & SSRF, OAuth2 TLS
  validation). **DONE** — bumped **6.9.14 → 9.0.3**; the advisories no longer appear. Our usage is
  the stable core (`createTransport` host/port/secure/auth + `sendMail`), unchanged across 6→9,
  so no code change; the fixes are internal hardening.

All three are done; the API dependency tree is clean. Keep running `npm audit` periodically so
newly-published advisories (like the nodemailer batch that appeared mid-audit) surface early — a
hard CI gate is deliberately avoided, since it would fail unrelated PRs whenever an advisory drops.

### 3.8 🟡 Miscellaneous
- Host-side DX footguns: scripts require the container env/generated client (now guarded with
  friendly errors, but the general pattern remains).
- Accessibility is partial (aria attributes exist in places; no systematic audit).
- SEO: crawler link-unfurl OG now covers every shareable page (home, catalog, items, community
  catalogs, public repos, public profiles, blog, showcase, static), each behind the app's own
  visibility gate + tested. Full SSR/prerender for search-engine indexing is still a larger effort.
- Bus factor ≈ 1; the deep billing edge cases live in code comments and one person's head.

## 4. Prioritized action plan

| P | Action | Why |
|---|---|---|
| **P1** | Minimal CI: build web, `node --check` API, `prisma validate`, secret scanning | Catches broken builds + leaked secrets at commit time |
| **P1** | Tests for billing: **DONE** — pricing math (`pricing.test.mjs`: `priceCents`/`termTotalCents`/`capacityFactors` + discount & scarcity invariants + consolidation free-floor) **and** the pool-billing invariant (`pool-billing.test.mjs`: `recomputePoolBytes` sum-of-active-subs, lapse→suspend+hide+72h grace, renewal→restore, partial-lapse-keeps-content, idempotent no-op) plus **end-to-end webhook tests** (`webhook.test.mjs`: a genuinely-signed event through the real handler — bad-signature→400, `customer.subscription.deleted`→lapse-suspends, `checkout.session.completed{pool_renew}`→restore) — all in CI against a throwaway Postgres service (**25 tests**). §1 billing risk is now covered end-to-end for the DB-driven lifecycle | Highest-blast-radius code |
| **P1** | Switch `db push` → `prisma migrate` **DONE** — a `0_init` baseline + `src/boot-migrate.mjs` (adopts fresh / db-push / migrated DBs safely, verified for zero data loss); Dockerfile boots via `migrate deploy`; CI applies migrations + a drift check (schema-without-migration fails) | Removes silent-data-loss risk on schema changes |
| **P2** | Split `pages.jsx` into feature modules **DONE** — the ~10k-line monolith is now a 210-line shared-helper module; every route moved to its own file (`home`, `catalog`, `signin`, `hosting`, `dashboard`, `account-pages`, `legal`, `contact`, and the whole ~7.3k-line admin back-office → `admin.jsx`). Two dead pages dropped. Each extraction guarded by **ESLint `no-undef`** (apps/web `eslint.config.js`, wired into CI — it caught every missing import that `vite build` accepted silently) + a browser boot smoke-test. `repos.jsx` (~2k) is the remaining large file to split next | Maintainability + prevents the recurring import crashes |
| **P2** | Analytics retention sweeps (cap by age/rows) **DONE** — `sweepAnalyticsRetention` purges AnalyticsEvent/InteractionEvent/WebVital/LoginAttempt past per-table windows (defaults 365/120/120/180d, 0 = keep forever), batched 5k/table/sweep, admin-tunable via `/admin/analytics/retention`; 5 tests (pure resolver + DB purge/keep), full suite 30/30 green | Keeps the DB healthy long-term |
| **P2** | Redis pub/sub for SSE + shared rate limits (when replicas become real) | Unblocks horizontal scaling |
| **P3** | i18n key-parity lint **DONE** (`scripts/i18n-check.mjs`, CI-wired, `--strict`; fixed 8 duplicate-key bugs + 26 EN-fallback gaps). OG unfurl coverage for all public/shareable pages **DONE** (gated + tested). Remaining: accessibility pass; error monitoring; full SSR for search indexing | Polish & reach |

## 5. Verdict

BCWEB is an unusually well-secured, well-documented, feature-dense platform for its team size,
with a coherent domain model (pools, capabilities, share keys) that composes instead of
sprawling. Its central weakness is **verification**: everything rests on careful code review
and manual testing — no automated safety net under the billing system or the 60-model schema.
The P1 items (CI, billing tests, migrations) are cheap relative to the risk they retire and
should come before the next feature wave.
