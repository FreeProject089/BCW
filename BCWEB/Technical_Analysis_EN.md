# BCWEB — Technical Analysis (developer deep-dive)

> A from-scratch explanation of **BetterCommunity Web**: how the whole thing is
> wired, how to host it, what every file does, and how each subsystem works. Read
> [ARCHITECTURE.md](./ARCHITECTURE.md) for the *why* behind the stack; this doc is
> the *how* at the code level. Companion: **App_Features_EN.md** (product tour).
>
> This file is intentionally **not committed** — it's a living engineering reference.

---

## 1. What BCWEB is

BCWEB is the hub that unites **BMM** (Better Mods Manager), **BSM** (Better Sound
Maker) and future Better\* projects: one account system, per-project blogs &
catalogs, a full admin back-office, paid **Server-Repo** hosting, a Discord bot, and
a marketing site (React SPA with a Three.js hero orb). It's a **monorepo of small
services** glued together by Docker Compose behind a single Caddy reverse proxy.

```
apps/
  api/          Fastify HTTP API (the brain — auth, data, admin, hosting, billing)
  web/          React 18 + Vite SPA (the whole public site + dashboards)
  bot/          Discord.js bot (gating, Ko-fi, alerts, moderation, panels)
  provisioner/  brings hosted repos ONLINE, owns isolation/quota (extension point)
packages/
  db/           Prisma schema (schema.prisma) + generated client, shared by api+bot
infra/
  compose/      docker-compose.yml + .env(.example)  — the deployment
  caddy/        Caddyfile — edge reverse proxy, security headers, anti-bot
loadtest/       benchmark + stress harness (BENCHMARK.md, run.mjs)
bmm/, bsm/      per-project assets, telemetry dashboard, seed presets
```

---

## 2. Runtime topology (how a request flows)

Everything is fronted by **Caddy** on ports 80/443. It matches by **Host header**:

- `localhost` / `SITE_DOMAIN` → the main site block.
  - `handle_path /api/*` → strips `/api` → `reverse_proxy api:3000` (Fastify).
  - `/hosting/*`, `/sitemap.xml`, `/robots.txt`, `/repos.json`, `/catalog.json` → api.
  - everything else → `reverse_proxy web:80` (nginx serving the built SPA).
- `telemetry.localhost` / `TELEMETRY_DOMAIN` → the BMM telemetry dashboard (own origin).

> **Gotcha when testing with curl:** the site block matches `Host: localhost`. A
> request with `Host: 127.0.0.1` or `Host: caddy` matches no site and gets Caddy's
> empty default 200. Always test with `curl -H "Host: localhost" http://127.0.0.1/…`
> or `curl http://localhost/…`.

Docker services (`infra/compose/docker-compose.yml`):

| Service | Image / build | Role |
|---|---|---|
| `caddy` | caddy:2-alpine | reverse proxy, TLS, security headers, edge anti-bot (Caddyfile is bind-mounted → `docker compose restart caddy` reloads) |
| `web` | build apps/web → nginx:alpine | serves the static Vite bundle (`apps/web/nginx.conf`) |
| `api` | build apps/api (Node 20) | Fastify API, port 3000 (internal) |
| `bot` | build apps/bot | Discord bot (no exposed port) |
| `provisioner` | build apps/provisioner | repo bring-up worker |
| `db` | postgres:16 | primary datastore |
| `redis` | redis | sessions/rate-limit buckets/jobs |
| `minio` | minio | S3-compatible object storage for uploads (ports 9000/9001) |
| `telemetry` + `telemetry-db` | BMM dashboard | separate origin analytics for BMM |

**Config discipline:** any new API env var must be **explicitly whitelisted** in the
`api` service's `environment:` block in docker-compose.yml, or the container won't see
it even if it's in `.env`.

---

## 3. How to host it (deploy)

```bash
cd infra/compose
cp .env.example .env          # set POSTGRES_PASSWORD, JWT_SECRET (openssl rand -hex 32), S3 keys
docker compose up -d          # brings up the whole stack
docker compose exec api npm run seed   # projects, hosting plans, one SUPERADMIN
curl http://localhost/api/health       # { ok:true, db:true }
```

The full operator walkthrough (admin account, 2FA, roles, OAuth, Discord bot, Stripe,
production checklist) is in **[SETUP_GUIDE.md](./SETUP_GUIDE.md)**. Rebuild/redeploy a
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

Postgres via Prisma. The load-bearing models:

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

---

## 5. API layer (`apps/api/src`)

`server.mjs` boots Fastify, registers plugins (cookies, rate-limit, multipart),
mounts every route module, starts background workers (`sweeper.mjs`, `monitor.mjs`),
and enforces the production-secret fail-safe. `lib.mjs` holds the shared helpers:
`db()` (Prisma singleton), `requireRole(...)` preHandler (also requires `totpEnabled`
for MOD/ADMIN/SUPERADMIN — the 2FA-gated admin surface, with implicit SUPERADMIN
bypass), `requireElevated()` (server-control step-up), `logAudit()`, `slugify()`, and
`safeEqual()` (sha256 → `crypto.timingSafeEqual`, constant-time secret compare).

### Route modules (`apps/api/src/routes/`)

| File | Owns |
|---|---|
| `auth.mjs` | register/login/logout, password reset, proof-of-work (`/auth/pow`), TOTP login step (`/auth/login/2fa`); `oauth_only_account` handling |
| `oauth.mjs` | GitHub/Discord OAuth2 login/signup — HMAC-signed `state`, provider-verified email only, `/auth/oauth/providers` feature-probe |
| `misc.mjs` | `/me`, admin **user search + detail** (creator/Discord/**BC id** search), roles, billing/users list |
| `catalog.mjs` | browse/submit catalog items, `catalog.json` feed, downloads |
| `uploads.mjs` | pre-signed S3 PUT (direct-to-MinIO, size/type capped) |
| `blog.mjs` | per-project blog CRUD + home Latest-news |
| `projects.mjs` / `showcase.mjs` | fixed project config + "Other projects" showcase, scheduled updates, announcements/visibility |
| `repos.mjs` / `repo-dashboard.mjs` | Server-Repos public list (+ **fingerprint**), owner dashboard, files, favorites, admin identify lookup |
| `hosting.mjs` / `hosting-content.mjs` / `stripe-webhook.mjs` | plans, capacity, price, Stripe checkout/portal/webhook, serve-time sandbox (bans/whitelist/bandwidth) |
| `announcements.mjs` | site-wide banner + notifications |
| `access-policy.mjs` | global + per-user whitelist/ban |
| `server-perf.mjs` / `server-control.mjs` | perf dashboard; DB viewer/file manager/Docker/power (DANGEROUS preHandler = session + `canControlServer` + step-up 2FA; audit tables read-only) |
| `kofi.mjs` | Ko-fi webhook (constant-time token), donor flag, goal stats |
| `bot.mjs` | API surface the Discord bot calls (constant-time `x-bot-secret`) |
| `promo.mjs` / `links.mjs` / `analytics.mjs` | promo codes, creator/Discord pairing, first-party analytics |

### Non-route modules

`storage.mjs` (S3/MinIO + prefix usage), `net.mjs` (`safeFetch` — SSRF guard: DNS
resolve + block private/loopback/link-local/CGNAT/metadata ranges, re-check every
redirect hop), `abuse.mjs` (Fastify anti-bot/anti-DDoS guards), `gitbackup.mjs`
(git-style file/DB backup via `execFile('git', …)`, no shell), `plugin.mjs` (plugin
integrity validate/inspect), `monitor.mjs` (perf sampling + alerting),
`sweeper.mjs` (expiry sweeps: repos, submissions, deleteAt), `totp.mjs` (RFC 6238),
`repofingerprint.mjs` (the **BC id** system, §8), `seed.mjs` (idempotent bootstrap).

---

## 6. Web SPA (`apps/web/src`)

React 18 + Vite + Tailwind, one bundle served by nginx. `main.jsx` boots the app
(applies theme + translucency prefs pre-paint to avoid flashes). `App.jsx` holds the
router, top nav, footer, and mounts the permanent `Hero3D` backdrop. `api.js` is the
fetch wrapper; `auth.jsx` the auth context (`{ user, loading, login, loginWith2fa,
register, logout }`).

Key files: `pages.jsx` (the big one — Home, Catalog, Auth, Dashboard, Settings,
Contact, and the entire **Admin** dashboard incl. `AdminUsers`/`UserDetailModal`),
`profile.jsx`, `repos.jsx` + `repo-dashboard.jsx`, `project.jsx` (project pages +
"Other projects" + showcase + announcement countdown), `blog.jsx`, `uploads.jsx`,
`i18n.jsx` (EN/FR dictionaries + `LangToggle`/`LangSelect` — toggle at ≤2 langs, auto
**dropdown at >2**), `theme.jsx`, `prefs.js` (translucency + orb-page-transition
prefs), `pow.js`/`pow-worker.js` (client proof-of-work), `md.jsx` (markdown),
`ui.jsx` (shared components), `brand.jsx` (logos), `CookieConsent.jsx`, `analytics.js`
+ `gtm.js` (consent-gated Google Tag Manager).

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

`index.mjs` boots discord.js; `config.mjs` merges DB config (dashboard) with env
(`DISCORD_TOKEN` wins); `api.mjs` calls the BCWEB API with the shared `x-bot-secret`;
`store.mjs` local state. Features in `features/`: `gating.mjs` (multi-role gated
access with per-role requirements + periodic re-verify + `/refreshroles`),
`kofi.mjs` (Ko-fi tip embeds), `alerts.mjs` (server-perf alerts), `moderation.mjs`,
`welcome.mjs`, `joinToCreate.mjs` (voice), `blog.mjs` (post announcements),
`panel.mjs` (embed panels). Every bot message is an embed. Needs the **Server
Members** + **Message Content** privileged intents.

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

## 9. Security model (summary — full audit in SECURITY_AUDIT.md)

- **Auth**: argon2id, HMAC-signed cookies/2FA/step-up tokens, TOTP 2FA required for
  admin tiers, step-up elevation for server-control, OAuth CSRF via signed `state`.
- **Constant-time** secret compares everywhere (`safeEqual`): Ko-fi token, bot secret,
  PoW HMAC, OAuth state.
- **Injection**: Prisma parameterised; DB-viewer raw SQL validates table/column names
  against `pg_class`/`information_schema` before interpolation; git via `execFile`
  (no shell).
- **SSRF**: `safeFetch` blocks private ranges + re-checks redirects.
- **Traversal/zip-slip**: `safePath()` confinement; archive extraction via
  `enclosed_name()`.
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
```

Undo the last commit but keep the changes staged: `git reset --soft HEAD~1`.
