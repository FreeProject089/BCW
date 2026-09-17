# BCWEB — Technical Analysis (developer deep-dive)

> A from-scratch explanation of **BetterCommunity Web**: how the whole thing is
> wired, how to host it, and how each subsystem works. Read
> [ARCHITECTURE.md](ARCHITECTURE_EN.md) for the *why* behind the stack; this doc is
> the *how* at the code level. Companion: **App_Features_EN.md** (product tour).
>
> **What this document does and does not do.** It is a **map**, not an inventory. The
> codebase is 71 API route modules, 109 API lib modules, 162 Prisma models and 194 web
> source files; a paragraph per file would be wrong within a week, and nobody would read
> it. So every subsystem is named and placed, and the file-by-file, cannot-go-stale
> answers come from the generated **codebase maps** in Admin → Moderation, documented in
> [CODEBASE_MAPS_EN.md](CODEBASE_MAPS_EN.md): which guard protects which route, the
> schema and its index drift, the migration history, the endpoint and data-flow graphs,
> the infra map. When this document and a map disagree, the map is right.

---

## 1. What BCWEB is

BCWEB is the hub that unites **BMM** (Better Mods Manager), **BSM** (Better Sound
Maker) and future Better\* projects: one account system, per-project blogs &
catalogs, a full admin back-office, paid **Server-Repo** hosting, a Discord bot, and
a marketing site (React SPA with a Three.js hero orb). It's a **monorepo of small
services** glued together by Docker Compose behind a single Caddy reverse proxy.

```
apps/
  api/          Fastify HTTP API (the brain: auth, data, admin, hosting, billing)
  web/          React 18 + Vite SPA (the whole public site + dashboards + editors)
  bot/          discord.js bot (gating, economy, moderation, logging, panels)
  provisioner/  brings hosted repos ONLINE; container isolation is an extension point
packages/
  db/           Prisma schema (schema.prisma) + migrations, shared by api+bot
  bmd/          @bettercommunity/bmd, the B.MD markdown block renderer
  bmd-editor/   @bettercommunity/bmd-editor, the editor built on that renderer
native/         bcweb-native: Rust/napi helpers (zip, zstd, BLAKE3, image resize)
infra/
  compose/      docker-compose.yml + .env(.example)  — the deployment
  caddy/        Caddyfile — edge reverse proxy, security headers, anti-bot
  backup/       backup.sh; the deploy/rollback/ZDD/secret-rotation scripts sit in infra/
guides/         these docs, plus check-links.mjs and check-claims.mjs (both run in CI)
loadtest/       benchmark + stress harness (BENCHMARK.md, run.mjs)
bmm/            telemetry-dashboard only
```

There is no BSM directory and no shared-types package: BSM is a seeded project key.

---

## 2. Runtime topology (how a request flows)

Everything is fronted by **Caddy** on ports 80/443. It matches by **Host header**:

- `localhost` / `SITE_DOMAIN` (and `TUNNEL_DOMAIN`) → the main site block.
  - `handle_path /api/*` → strips `/api` → `reverse_proxy api:3000` (Fastify).
  - `/hosting/*`, `/sitemap.xml`, `/robots.txt`, `/repos.json`, `/catalog.json`,
    `/og/*`, `/oauth2/*` and the OIDC `.well-known` documents → api.
  - everything else → `reverse_proxy web:80` (nginx serving the built SPA).
  - both upstreams go through a `dynamic a` resolver, so a rebuilt container that comes
    back on a new IP is picked up instead of being cached until Caddy reloads.
- `telemetry.localhost` / `TELEMETRY_DOMAIN` → the BMM telemetry dashboard (own origin).
- A repo's bring-your-own domain is admitted by on-demand TLS, which asks
  `http://api:3000/domains/ask` whether a hostname is allowed before issuing a certificate.

> **Gotcha when testing with curl:** the site block matches `Host: localhost`. A
> request with `Host: 127.0.0.1` or `Host: caddy` matches no site and gets Caddy's
> empty default 200. Always test with `curl -H "Host: localhost" http://127.0.0.1/…`
> or `curl http://localhost/…`.

Docker services (`infra/compose/docker-compose.yml`):

| Service | Image / build | Role |
|---|---|---|
| `caddy` | caddy:2-alpine | reverse proxy, TLS, security headers, edge anti-bot (Caddyfile is bind-mounted → `docker compose restart caddy` reloads) |
| `web` | build apps/web → nginx:alpine | serves the static Vite bundle (`apps/web/nginx.conf`) |
| `api` | build apps/api (Node 22, with a `rust:1-alpine` stage that builds bcweb-native) | Fastify API, port 3000 (internal) |
| `bot` | build apps/bot (Node 22) | Discord bot (no exposed port) |
| `provisioner` | build apps/provisioner (Node 22) | repo bring-up worker |
| `db` | postgres:16-alpine | primary datastore |
| `redis` | redis:7-alpine | rate-limit buckets, the shared L2 read cache, monitor state |
| `pgbouncer` | edoburu/pgbouncer | **opt-in**: only starts with `--profile pgbouncer`. Shares a small pool of real Postgres connections across API replicas. Point the API at it with `DB_HOST=pgbouncer DB_PORT=6432 DB_URL_PARAMS=?pgbouncer=true`; `DIRECT_DATABASE_URL` stays on `db:5432` so migrations keep a direct connection |
| `minio` | minio/minio | S3-compatible object storage for uploads (ports 9000/9001) |
| `telemetry` + `telemetry-db` | BMM dashboard + postgres:16-alpine | separate origin analytics for BMM |

**Config discipline:** any new API env var must be **explicitly whitelisted** in the
`api` service's `environment:` block in docker-compose.yml, or the container won't see
it even if it's in `.env`.

---

## 3. How to host it (deploy)

```bash
cd infra/compose
cp .env.example .env          # set POSTGRES_PASSWORD, JWT_SECRET (openssl rand -hex 32), S3 keys
docker compose up -d          # brings up the whole stack
docker compose exec api npm run seed        # projects, hosting plans, one SUPERADMIN
docker compose exec api npm run seed:demo   # DEV ONLY: a realistic demo catalog to look at
curl http://localhost/api/health       # { ok:true, db:true }
```

The full operator walkthrough (admin account, 2FA, roles, OAuth, Discord bot, Stripe,
production checklist) is in **[SETUP_GUIDE.md](../run/SETUP_GUIDE_EN.md)**. Rebuild/redeploy a
single service after a code change:

```bash
docker compose -f infra/compose/docker-compose.yml build web api
docker compose -f infra/compose/docker-compose.yml up -d web api
# Caddyfile changes: docker compose restart caddy  (bind-mounted, no rebuild)
```

`server.mjs` **refuses to boot in production** on the default `JWT_SECRET` — a
fail-safe so a misconfigured deploy can't ship with a guessable signing key.

---

## 4. Data model (`packages/db/schema.prisma`)

Postgres via Prisma: **162 models**. The load-bearing ones, the spine everything else
hangs off:

- **User** — email, `passwordHash` (argon2id, *nullable* for OAuth-only accounts),
  `role` (USER/MOD/ADMIN/SUPERADMIN), `totpSecret`/`totpEnabled`/`totpRecoveryCodes`,
  `canControlServer` (server-control grant), `kofiDonorAt` (one-time discount gate).
  Relations to items, repos, submissions, notifications, posts, payments, creator &
  Discord links, OAuth accounts, audit entries, favorites.
- **OAuthAccount** — GitHub/Discord *auth* identity (distinct from DiscordLink).
- **CreatorLink** / **DiscordLink** — BMM creator ids / Discord ids paired to an
  account (gating + telemetry + free-tier claims). 2-week unlink lock.
- **CatalogItem** — app/plugin/theme/preset: owner, project, kind, slug, `payloadKey`
  (S3), status (PENDING/…), views/downloads, `deleteAt` (72h grace).
- **Submission** / **SubmissionComment** — the moderation queue.
- **Project** / **BlogPost** / **BlogPermission** — projects, per-project blogs,
  granular blog grants. **ShowcaseProject** — the admin-managed "Other projects".
- **ServerRepo** / **RepoFile** / **RepoFavorite** / **RepoAuditLog** /
  **RepoAccessEvent** — hosted repos, their files, stars, audit + traffic events.
- **HostingPlan** / **HostingGroup** / **Subscription** / **Payment** /
  **PromoCode** / **PromoRedemption** / **FreeTierClaim** — billing + free tier.
- **GlobalAccessPolicy** (singleton) / **UserAccessPolicy** — whitelist/ban layered
  over per-repo settings.
- **LoginAttempt** / **AuditLogEntry** / **ServerMetricSample** / **ServerAlertLog** —
  security + ops telemetry. **KofiDonation**, **Announcement**, **AdminSetting**,
  **ContactMessage**, **AnalyticsEvent**, **PasswordReset**.

The remaining ~125 models belong to one subsystem each, and knowing the family name is
enough to find them in the schema:

| Family | Models start with / include |
|---|---|
| Discord | `DiscordActivity`, `BotGuild`, `BotAction`, `BotWarn`, `BotAnnouncement`, `DiscordEconomy`, `ModerationLog` |
| Economy & games | `UserEconomy`, `EconomyPurchase`, `EconomyLedger`, `GameScore`, `GameAward` |
| Polls | `Poll`, `PollQuestion`, `PollChoice`, `PollOption`, `PollVote`, `PollAnswer` |
| Blog & docs | `BlogComment`, `BlogRevision`, `BlogReaction`, `DocPage`, `DocRevision`, `DocComment`, `CommentRevision` |
| Teams & the task board | `Team`, `TeamMember`, `TeamInvite`, `StaffTeam`, `StaffTeamMember`, `AdminTask`, `AdminTaskEvent` |
| Contact, reports, feedback | `ContactThread`, `ContactThreadMessage`, `ContactTicket`, `ContactReply`, `Report`, `ReportMessage`, `Feedback` |
| Commerce beyond hosting | `MyoProduct`/`MyoRequest`/`MyoQuote`/`MyoDeliverable`, `ProjectProduct`, `MarketplaceSeller`, `PendingCart`, `PendingCheckout`, `FeatureSubscription`, `BoostCredit` |
| OIDC provider | `OidcKey`, `OAuthClient`, `OAuthCode`, `OAuthConsent`, `OAuthRefreshToken`, `OAuthPairwiseSub` |
| Legal & rights | `LegalVersion`, `LegalCategory`, `LegalPage`, `LegalSection`, `RightsNotice`, `ProtectedWork`, `BlockedUrl` |
| Charity | `CharityPot`, `CharityContribution` |
| Analytics & status | `AnalyticsDaily`, `AnalyticsGoal`, `WebVital`, `InteractionEvent`, `ErrorEvent`, `ServiceOutage`, `IncidentNote`, `StatusSubscriber`, `SessionReplay` |
| Public API | `ApiKey`, `ApiUsageDay`, `ApiRequest` |
| Domains & repo agents | `CustomDomain`, `RepoAgent`, `ChangeEvent` |
| Media safety | `MediaHash`, `MediaFlag`, `ExpiringFile` |
| Runtime locales | `SiteLocale` |

The **schema map** (Admin → Moderation) draws this live from `schema.prisma`, including
index drift: an index created in raw SQL and never declared in the schema, which the next
generated migration would propose dropping. Trust it over this table.

---

## 5. API layer (`apps/api/src`)

Three things sit directly in `apps/api/src`: `server.mjs`, the seed and maintenance
scripts (`seed.mjs`, `seed-content.mjs`, `seed-docs.mjs`, `seed-faq.mjs`,
`seed-site-guide.mjs`, `seed-demo.mjs`, `setup.mjs`, `boot-migrate.mjs` and a handful of
one-shot data-fix scripts), and the two directories below: `routes/` (71 modules) and
`lib/` (109 modules).

`server.mjs` boots Fastify, registers plugins (cookies, rate-limit, multipart),
mounts every route module, starts background workers (`lib/sweeper.mjs`,
`lib/monitor.mjs`),
and enforces the production-secret fail-safe. `lib/lib.mjs` holds the shared helpers:
`db()` (Prisma singleton), `requireRole(...)` preHandler (also requires `totpEnabled`
for MOD/ADMIN/SUPERADMIN — the 2FA-gated admin surface, with implicit SUPERADMIN
bypass), `requireElevated()` (server-control step-up), `logAudit()`, `slugify()`, and
`safeEqual()` (sha256 → `crypto.timingSafeEqual`, constant-time secret compare).

### Route modules (`apps/api/src/routes/`)

All 71, grouped by subsystem. The point of the table is to let you open the right file,
not to restate what is in it; **which guard protects which route** is answered live by
the RBAC map (Admin → Moderation), which reads the route files themselves.

| Subsystem | Files |
|---|---|
| **Accounts & identity** (14) | `auth.mjs` (register/login/logout, password reset, proof-of-work, the TOTP login step, `oauth_only_account`), `oauth.mjs` (GitHub/Discord OAuth2, HMAC-signed `state`, provider-verified email only), `misc.mjs` (`/me`, admin user search + detail incl. **BC id**), `roles.mjs`, `admin-search.mjs`, `connections.mjs`, `links.mjs` (creator/Discord pairing), `avatar.mjs`, `social.mjs`, `api-keys.mjs`, `oidc-provider.mjs`, `transfers.mjs` (ownership transfer), `closure.mjs` (account closure + survey), `rights.mjs` |
| **Content & site** (15) | `blog.mjs`, `docs.mjs`, `faq.mjs`, `projects.mjs`, `showcase.mjs`, `showcase-requests.mjs`, `og.mjs` (rendered OG/Twitter images), `locales.mjs` (runtime language overrides), `studio.mjs`, `polls.mjs`, `campaigns.mjs`, `events.mjs`, `newsletter.mjs`, `announcements.mjs`, `status.mjs` |
| **Catalog & uploads** (7) | `catalog.mjs` (browse/submit, the `catalog.json` feed, downloads), `catalogs.mjs` (community catalogs), `uploads.mjs` (pre-signed S3 PUT, direct to MinIO, size/type capped), `files.mjs`, `marketplace.mjs`, `media-flags.mjs`, `platform-assets.mjs` |
| **Repos & hosting** (7) | `repos.mjs` (public list + **fingerprint**), `repo-dashboard.mjs` (owner dashboard, files, favorites), `repo-agent.mjs` (manage a repo on the owner's own server), `hosting.mjs` (plans, capacity, price), `hosting-content.mjs` (serve-time sandbox: bans, whitelist, bandwidth), `domains.mjs` (bring-your-own domain + the Caddy `ask` endpoint), `boosts.mjs` |
| **Billing** (6) | `stripe-webhook.mjs`, `payments-admin.mjs`, `promo.mjs`, `kofi.mjs` (webhook with a constant-time token, donor flag, goal stats), `charity.mjs`, `myo.mjs` |
| **Moderation & safety** (6) | `reports.mjs`, `sanctions.mjs`, `site-bans.mjs`, `access-policy.mjs` (global + per-user whitelist/ban), `feedback.mjs`, `threads.mjs` |
| **Ops & server control** (10) | `server-perf.mjs`, `server-control.mjs` (DB viewer / file manager / Docker / power, behind a DANGEROUS preHandler = session + `canControlServer` + step-up 2FA, audit tables read-only), `devtools.mjs`, `content-backup.mjs`, `my-backup.mjs`, `history.mjs`, `telemetry.mjs`, `analytics.mjs` (first-party), `webhooks.mjs`, `code-webhook.mjs` |
| **Discord & game** (4) | `bot.mjs` (the surface the bot calls, constant-time `x-bot-secret`), `bot-emoji.mjs`, `economy-admin.mjs`, `game.mjs` |
| **Teams & tasks** (2) | `teams.mjs`, `tasks.mjs` |

### Non-route modules (`apps/api/src/lib/`)

All 109, same treatment. `lib.mjs` is the shared-helper module described above; the rest:

| Group | Modules |
|---|---|
| **Request plumbing** (14) | `lib.mjs`, `cache.mjs`, `redis.mjs`, `net.mjs`, `abuse.mjs`, `flags.mjs`, `boot-guard.mjs`, `boundedmap.mjs`, `errorlog.mjs`, `apiusage.mjs`, `geo.mjs`, `locales.mjs`, `thresholds.mjs`, `native.mjs` |
| **Storage & files** (14) | `storage.mjs`, `zip-path.mjs`, `expiring-files.mjs`, `media-hash.mjs`, `phash.mjs`, `plugin.mjs`, `bmm-formats.mjs`, `bmm-signature.mjs`, `bmmpa.mjs`, `snapshots.mjs`, `gitbackup.mjs`, `gitsource.mjs`, `seed-export.mjs`, `shred.mjs` |
| **Identity, access, privacy** (19) | `totp.mjs`, `signing.mjs`, `keyauth.mjs`, `creator-proof.mjs`, `identity-attestation.mjs`, `repofingerprint.mjs`, `siteban.mjs`, `sanctions.mjs`, `warns.mjs`, `urlblock.mjs`, `reserved-names.mjs`, `bot-guild-access.mjs`, `oidc.mjs`, `retention.mjs`, `erasure-log.mjs`, `user-erase.mjs`, `user-export.mjs`, `rights-match.mjs`, `staff-notes.mjs` |
| **Billing & hosting** (9) | `boostcredit.mjs`, `pending-checkout.mjs`, `stripe-reconcile.mjs`, `promo-rules.mjs`, `domain.mjs`, `repokind.mjs`, `charity.mjs`, `goal-stats.mjs`, `gift.mjs` |
| **Content, projects, comms** (18) | `project-config.mjs`, `project-keys.mjs`, `project-link.mjs`, `config-diff.mjs`, `config-schemas.mjs`, `catalog-kinds.mjs`, `changelog.mjs`, `studio-components.mjs`, `recipe-check.mjs`, `legal-freshness.mjs`, `contact-triage.mjs`, `mail.mjs`, `mail-samples.mjs`, `status-page.mjs`, `status-notify.mjs`, `threadbus.mjs`, `tasks.mjs`, `teams.mjs` |
| **Polls** (5) | `poll-answer.mjs`, `poll-edit.mjs`, `poll-stats.mjs`, `poll-view.mjs`, `poll-visibility.mjs` |
| **Economy & games** (8) | `economy-curve.mjs`, `economy-season.mjs`, `economy-shop.mjs`, `game-season.mjs`, `casino-gif.mjs`, `casino-race.mjs`, `casino-rules.mjs`, `leaderboard-card.mjs` |
| **Discord** (2) | `bot-emoji.mjs`, `discord-storage.mjs` |
| **Generated images** (3) | `avatar-image.mjs`, `brand-logo-data.mjs`, `og-banner-data.mjs` |
| **Ops** (6) | `monitor.mjs`, `sweeper.mjs`, `metrics-compare.mjs`, `git-activity.mjs`, `webhooks.mjs`, `attention.mjs` |
| **The codebase maps** (11) | `rbac-map.mjs`, `schema-map.mjs`, `migration-map.mjs`, `endpoint-graph.mjs`, `code-graph.mjs`, `code-flow.mjs`, `data-flow.mjs`, `infra-map.mjs`, `compose-map.mjs`, `stack-detect.mjs`, `secrets-map.mjs` |

The ones worth reading before you touch anything near them:

- **`storage.mjs`**: S3-compatible storage, MinIO by default; endpoint and region are
  env-driven, so a Cloudflare R2 swap is config-only.
- **`net.mjs`**: `safeFetch`, the SSRF guard: resolve DNS, block private, loopback,
  link-local, CGNAT and metadata ranges, and re-check on every redirect hop.
- **`gitbackup.mjs`**: git-style file/DB backup via `execFile('git', …)`: no shell, and
  path-traversal-guarded.
- **`native.mjs`**: the wrapper over the Rust addon (zip, zstd, BLAKE3, image resize)
  with a JS fallback, so a build without the addon still works.
- **`repofingerprint.mjs`**: the **BC id** system (§8).
- **`abuse.mjs`**, **`monitor.mjs`**, **`sweeper.mjs`**, **`totp.mjs`**: anti-bot guards,
  perf sampling and alerting, expiry sweeps, RFC 6238.

`seed.mjs` is **not** in `lib/`: it and the other seed scripts sit one level up, in
`apps/api/src/`, because they are entry points run by `npm run seed`, not imports.

### Performance layer (`cache.mjs`, `redis.mjs`)

- **`redis.mjs`** — one lazy shared ioredis client (from `REDIS_URL`); everything using
  it degrades gracefully to in-process behaviour when Redis is absent/down.
- **`cache.mjs`** — two-tier TTL cache for hot, visitor-independent public reads:
  L1 per-process Map + L2 Redis (shared across api replicas), with request-coalescing
  (concurrent misses share one producer call — no DB stampede at expiry).
  Used by `GET /kofi/stats` (15 s, invalidated on a new tip) and `GET /showcase`
  (10 s, invalidated on admin edits). `/projects` is deliberately NOT cached
  (per-visitor visibility + scheduled-swap side effect).
- **Rate limiter** — `@fastify/rate-limit`, 600/min per real client IP; Redis-backed
  when `REDIS_URL` is set so the budget is shared across replicas. `/health` is exempt
  (Docker probe) and its logs are silenced. Rate-limit rejections reply 429 via the
  central error handler without error-level logging.
- **CDN-ready caching** — nginx and Caddy mark hashed `/assets/*` immutable; hosted
  file downloads get `Cache-Control: max-age=300` + an `ETag` (sha256); `repo.json`
  60 s. A free Cloudflare CDN in front therefore offloads most read traffic with zero
  code changes. PgBouncer ships as an opt-in compose profile for multi-replica setups
  (Prisma `directUrl` keeps migrations on the direct connection).
  Benchmarks + sizing: `loadtest/BENCHMARK.md`.

---

## 6. Web SPA (`apps/web/src`)

React 18 + Vite + Tailwind, one bundle served by nginx. Only four files sit at the root
of `apps/web/src`: `main.jsx` (boots the app, applies theme + translucency prefs
pre-paint to avoid flashes), `App.jsx` (router, top nav, footer, and the mount point for
the permanent `Hero3D` backdrop), `i18n.jsx` (the EN/FR dictionaries plus
`LangToggle`/`LangSelect`: a toggle at ≤2 languages, an automatic **dropdown at >2**) and
`index.css`. Everything else is in five directories:

| Directory | What is in it |
|---|---|
| `pages/` (80) | one file per route area. `home.jsx` + `home-sections.jsx` + `home-variants.jsx`, `catalog.jsx`/`catalogpage.jsx`/`submit.jsx`, `auth.jsx`/`signin.jsx`/`twofa.jsx`, `dashboard.jsx`, `profile.jsx`/`publicprofile.jsx`, `repos.jsx`/`repo-dashboard.jsx`/`repopublic.jsx`/`repos-admin.jsx`, `project.jsx`, `blog.jsx`, `docs.jsx`, `faq.jsx`, `polls.jsx`, `teams.jsx`, `threads.jsx`, `studio.jsx`, `hosting.jsx`, `charity.jsx`, `myo*.jsx`, `legal.jsx`, `status*.jsx`, the `discord-*.jsx` bot dashboards and the `dev-*.jsx` tools |
| `lib/` (46) | non-visual logic: `api.js` (the fetch wrapper), `prefs.js`, `pow.js`/`pow-worker.js` (client proof-of-work), `analytics.js` + `gtm.js` (consent-gated Google Tag Manager), `consent.js`, `roles.js`, `seo.js`, `money.js`, `format.js`, `merge3.js`, `zip-read.js`, `navLayout.js`, `lazy-chunk.js` |
| `ui/` (43) | shared components: `ui.jsx`, `md.jsx` (markdown), `theme.jsx` + the `theme-*.js` token/preset files, `brand.jsx`, `Avatar.jsx`, `CookieConsent.jsx`, `ErrorBoundary.jsx`, `command-palette.jsx`, `IntroContext.jsx`, the `*-map.jsx` codebase-map viewers |
| `editor/` (14) | the authoring surfaces, which the earlier version of this document omitted entirely: `markdown-editor.jsx` (the B.MD editor host), `project-config-editor.jsx`, `canvas-studio.jsx` + `studio-dock.jsx` + `studio-shortcuts.jsx`, `table-builder.jsx`, `icon-picker.jsx`, `kbd-picker.jsx`, `history-modal.jsx`, `diff-merge-modal.jsx`, `comments-modal.jsx`, `selection-toolbar.jsx`, `site-theme-cards.jsx` |
| `hero/` (9) | `Hero3D.jsx` and the other Three.js surfaces (`HeroShowcase.jsx`, `ProjectShowcase.jsx`, `ScenePreview.jsx`, `scene-shapes.js`, `scene-events.js`), plus `RrwebPreview.jsx` |

`auth.jsx` (the auth context: `{ user, loading, login, loginWith2fa, register, logout }`)
lives in `pages/`, next to the screens that use it.

Two corrections worth stating outright, because the old text sent readers to the wrong
file: **the Admin dashboard is not in `pages.jsx`.** It is `pages/admin.jsx`, about
24,000 lines, and that is where `AdminUsers` and `UserDetailModal` are defined; eighteen
further admin screens have been split out into `pages/admin-*.jsx`. `pages/pages.jsx` is
about 640 lines and holds only a few shared page pieces.

The **markdown renderer** is no longer local either: blog, docs and project pages render
through `@bettercommunity/bmd` from `packages/bmd`, with `ui/md.jsx` as the thin app-side
wrapper and `packages/bmd-editor` behind the editing UI. See
[CUSTOM_MARKDOWN.md](CUSTOM_MARKDOWN.md) for the directive set.

### The hero orb (`Hero3D.jsx`, `IntroContext.jsx`)

A single Three.js canvas that is BOTH the intro loader AND the permanent background:

- **Intro:** the orb **builds itself from shards** — starts fully fractured
  (`fractureState=1`, reseeded), assembles into the whole orb (`→0`) while scaling up,
  then glides to its small background corner. Skippable; gated only on the explicit
  `bcweb_skip_intro` localStorage flag (NOT `prefers-reduced-motion`, which Windows
  silently enables and would kill the intro).
- **Scroll:** a per-load-randomized **spiral** descent; its length (turns + drop)
  scales with page height via a `pageSpan` factor (long page = longer journey).
  Exposes `--reveal-x` so homepage reveals drift in from the orb's side.
- **Fracture:** hover/click raycasts the orb → shatters into real triangular shards
  and recomposes (GSAP-tweened `fractureState` → `uFracture` uniform).
- **Optional page transition** (off by default, `bcw_orb_page_transition` pref): on
  navigation the router dispatches `bcweb:orb-transition`; the orb bursts, the camera
  dives toward a random shard (offset applied additively on top of the parallax base
  so they don't fight), then recomposes.

Homepage reveals: `useScrollReveal` uses an IntersectionObserver + MutationObserver
(for async content). Fast-scroll fix: if a reveal fires while its element is already
well inside/above the viewport, it snaps in (`reveal-instant`) instead of playing the
long rise+blur on-screen. Stagger delay is capped so long grids don't trail the scroll.

---

## 7. Discord bot (`apps/bot/src`)

Ten top-level modules and 28 features. The bot holds **no database credentials**:
everything goes through the API's `/bot/*` surface with the shared `x-bot-secret`, which
is what lets it be a separate container.

`index.mjs` is a **connection manager**, not a plain boot: it connects when a token exists
and the bot is enabled, reconnects when the token changes, and disconnects when it is
disabled, so the token can be set or rotated from the dashboard with no restart. It also
registers the gateway-event handlers, one line per event.

| Module | What it is |
|---|---|
| `config.mjs` | the admin-edited config, refetched every 30 s; `DISCORD_TOKEN` from the env wins |
| `api.mjs` | the thin BCWEB client (shared secret, `SITE_URL`) |
| `commands.mjs` | slash commands + interaction routing |
| `ui.mjs` | the Components V2 builder every message goes through |
| `i18n.mjs` | admin overrides → built-in dictionary → English; server language, else the member's Discord locale |
| `store.mjs` | in-memory runtime state (temp voice rooms, throttles, mod counters) |
| `logbuffer.mjs` | ring buffer of the bot's own console output, shipped in the heartbeat and shown live in the admin tab |
| `nav.mjs` | **added most recently.** A component interaction carries nothing but a custom id, so a screen opened from another screen used to be a dead end. The origin now travels inside the custom id of the button that opens the next screen (`eco:shop:lvl` = "open the shop, you came from the level card"), and the destination draws one consistent Back from it, instead of a Back hand-wired per screen that points somewhere wrong six screens later |
| `help.mjs` | **added most recently.** The single source for a feature's long explanation, read two ways: the "Learn more" button on the feature's card (answered ephemerally, so the channel is untouched) and `/help`. Neither owns the text, so they cannot drift apart |

`features/` (28), by area:

- **Access & onboarding**: `gating.mjs` (multi-role gated access, per-role requirements,
  periodic re-verify, `/refreshroles`), `onboarding.mjs` (the card a server sees when the
  bot arrives and on `/setup`), `configure.mjs`, `rolepanel.mjs`, `welcome.mjs`,
  `scanMembers.mjs` (full roster push, so the admin member database is not just whoever
  happened to talk), `links.mjs` (drains the pending Discord-link buffer promptly).
- **Moderation & logging**: `moderation.mjs`, `automod.mjs` (data-driven rules,
  deterministic decisions in pure functions, Discord kept at arm's length),
  `modqueue.mjs` (moderation the website asked for, since the website cannot reach
  Discord), `logs.mjs` (a routing table per guild, forum posts with tags, batching, a
  per-destination queue that respects rate limits), `logevents.mjs`, `logcmd.mjs`.
- **Economy & games**: `economy.mjs` (buffers messages, reactions and voice seconds,
  flushes to the API once a minute; only linked accounts earn), `season.mjs`,
  `casino-live.mjs`, `casino-lobbies.mjs` (deliberately Discord-free, so a plain node test
  can drive it), `giveaways.mjs`.
- **Posting on the site's behalf**: `announce.mjs` + `announce-route.mjs` (where an
  announcement goes and who gets pinged), `blog.mjs`, `kofi.mjs`, `payments.mjs`
  (payments and refunds), `alerts.mjs` (server-perf alerts), `dm.mjs` (queued admin DMs),
  `panel.mjs`, `icons.mjs` (uploads the site's icon PNGs as application emojis),
  `joinToCreate.mjs` (temporary voice rooms).

Every message is a **Discord Components V2 container** built by `ui.mjs`, not an embed:
no `content`, no `embeds`, at most 40 components and 4000 characters, and the flag cannot
be changed by an edit, so a V2 message is edited as V2. Needs the **Server Members** and
**Message Content** privileged intents (the reaction, moderation, expression and webhook
intents it also requests are not privileged).

---

## 8. The BC id system (`repofingerprint.mjs`)

Opaque, stable support/moderation references. All are
`HMAC-SHA256(JWT_SECRET, material)` truncated to 8 base32 chars (alphabet
`ABCDEFGHJKLMNPQRSTVWXYZ23456789` — no vowels/ambiguous), formatted `PREFIX-XXXX-XXXX`:

- `userBcId(userId)` → **`BC-XXXX-XXXX`** — account-level, from the immutable account
  id (stable + searchable). Shown on admin user cards/modals.
- `repoFingerprint({repoId, ownerId, creatorIds, discordIds, kofi})` → **`BCR-…`**.
- `itemFingerprint({itemId, ownerId, creatorIds})` → **`BCI-…`**.
- `findUserIdByBcId(p, code)` — resolves a pasted `BC-…` back to a user by
  recomputing over all accounts (admin-only). `bcIdBody`/`looksLikeBcId` tolerate
  case/spacing/missing-prefix so `bc 7k2m9xq4`, `BC-7K2M-9XQ4`, `BCQQEHCQAF` all match.

They reveal nothing on their own and aren't secrets.

---

## 9. Security model

- **Auth**: argon2id, HMAC-signed cookies/2FA/step-up tokens, TOTP 2FA required for
  admin tiers, step-up elevation for server-control, OAuth CSRF via signed `state`.
- **Constant-time** secret compares everywhere (`safeEqual`): Ko-fi token, bot secret,
  PoW HMAC, OAuth state.
- **Injection**: Prisma parameterised; DB-viewer raw SQL validates table/column names
  against `pg_class`/`information_schema` before interpolation; git via `execFile`
  (no shell).
- **SSRF**: `safeFetch` blocks private ranges + re-checks redirects.
- **Traversal/zip-slip**: `safePath()` confines the server-control file manager to its
  root; every name written into a zip we hand out goes through `zipEntryName()` in
  `lib/zip-path.mjs`, which drops `.` and `..` segments, normalises backslashes and
  strips a Windows drive prefix, so the archive cannot instruct an extractor to write
  outside the target directory.
- **Edge**: CSP + security headers + bad-UA/scan-path blocks (Caddy) + Fastify
  anti-bot + proof-of-work on signup/contact.
- Audit tables (`AuditLogEntry`/`LoginAttempt`/`RepoAuditLog`) are read-only in the DB
  viewer.

---

## 10. Dev workflow cheatsheet

```bash
# frontend dev (proxies /api → :3000)
cd apps/web && npm run dev
# rebuild + redeploy after edits
docker compose -f infra/compose/docker-compose.yml build web api && \
  docker compose -f infra/compose/docker-compose.yml up -d web api
# validate configs
docker compose exec web nginx -t
docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
# load/stress test
node loadtest/run.mjs   # see loadtest/BENCHMARK.md
# the guides: every relative link resolves, and every service/script/variable/path
# a guide names actually exists (both run in CI)
node guides/check-links.mjs
node guides/check-claims.mjs
```

Undo the last commit but keep the changes staged: `git reset --soft HEAD~1`.
