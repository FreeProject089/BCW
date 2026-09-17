# BetterCommunity Web (BCWEB) — Architecture

*🇫🇷 [Version française](ARCHITECTURE_FR.md).*

The hub that unites **BMM** (Better Mods Manager), **BSM** (Better Sound Maker),
**BetterInstaller** and future Better* projects: one site, one account system,
per-project blogs & catalogs, an admin back-office, a Discord bot, and paid Server-Repo
hosting.

> Design goals (from the brief): **scalable**, **secure**, **simple to deploy with
> Docker**. Carte blanche on the *how* — this document is the *how*.

> This document is the **shape** of the system: the services, the boundaries between
> them, and the reasoning. It is deliberately short. File-level detail lives in
> [Technical_Analysis_EN.md](Technical_Analysis_EN.md), and the generated,
> cannot-go-stale views of the routes, schema and dependency graph are the admin
> codebase maps in [CODEBASE_MAPS_EN.md](CODEBASE_MAPS_EN.md).

---

## 1. Stack (chosen for consistency + easy self-host)

The existing telemetry-dashboard is Node + Docker, so we stay in that world.

| Layer | Tech | Why |
|---|---|---|
| **API** | Node 22 + **Fastify 5** + **Zod** (validation) | fast, typed, schema-validated; one container |
| **DB** | **PostgreSQL 16** + **Prisma** (migrations + typed client) | relational data fits catalogs/billing; migrations |
| **Cache** | **Redis 7** | rate-limit buckets shared across API replicas, the two-tier public-read cache, perf/monitor state. Every consumer degrades to in-process behaviour when Redis is absent |
| **Object storage** | **S3-compatible** (**MinIO** for self-host, or AWS S3) | catalog assets, preset files, repo data — never in Postgres/git |
| **Web** | **React 18 + Vite + Tailwind** (matches the ecosystem) | SPA; one static bundle served by nginx behind the proxy |
| **Proxy / TLS** | **Caddy 2** | automatic HTTPS, routing, one config |
| **Payments** | **Stripe** (Checkout + Billing + webhooks) | tiered + usage pricing, PCI handled by Stripe |
| **Native helpers** | **Rust** via napi-rs (`native/`) | zip, zstd, BLAKE3 and image resize on a worker thread instead of the event loop; a JS fallback keeps a build without the addon working |
| **Repo hosting runtime** | provisioner service (Node) | allocates a storage area per hosted Server-Repo and publishes its URL |

Everything runs from a single **`docker compose up`** (see `infra/compose/docker-compose.yml`).

---

## 2. Monorepo layout

```
BCWEB/
  apps/
    api/            # Fastify API (auth, catalogs, submissions, hosting, billing, admin,
                    #   the surface the Discord bot calls): 71 route modules, 109 lib modules
    web/            # React/Vite/Tailwind front: the public site, every dashboard, the editors
    bot/            # Discord bot (discord.js): gating, economy, moderation, logging, panels
    provisioner/    # brings hosted Server-Repos online (storage area + published URL)
  packages/
    db/             # Prisma schema (schema.prisma) + migrations, shared by api + bot
    bmd/            # @bettercommunity/bmd, the B.MD markdown block renderer
    bmd-editor/     # @bettercommunity/bmd-editor, the editor built on that renderer
  bmm/
    telemetry-dashboard/   # the live BMM telemetry app (served on its own origin)
  native/           # bcweb-native: Rust/napi helpers (zip, zstd, BLAKE3, image resize)
  infra/
    caddy/          # Caddyfile (routing + TLS)
    compose/        # docker-compose.yml
    backup/         # backup.sh
                    # plus the deploy/rollback/zero-downtime/secret-rotation scripts
                    #   and env-spec.txt, all sitting directly in infra/
  guides/
    reference/      # this file, the API reference, the codebase maps, the feature tour
    run/            # deploy, env, setup, commands
    use/            # user, host and moderator guides
    audits/         # tech, perf and security audits
    check-links.mjs, check-claims.mjs   # the two checks CI runs over the guides
  loadtest/         # benchmark + stress harness (run.mjs, BENCHMARK.md)
  scripts/          # migrate-and-mirror.ps1 (the Prisma two-client mirror)
```

There is no shared-types package (an earlier draft of this document promised one) and no
BSM directory: BSM is a seeded **project key**, with a page, a blog and a catalog, rather
than a folder of its own.

---

## 3. Domains & features

### 3.1 BetterCommunity (the main site)
- Landing page + **unified blog**: news aggregated from each project (BMM, BSM…),
  filterable by project. Posts authored from the admin dashboard.

### 3.2 BMM section
- **Blog**, **Download** page (pulls latest GitHub release / update.json).
- **Server-Repo list** (browse public repos + status: online, size, mods).
- **Catalogs**: **Apps**, **Plugins**, **Themes** — each browseable + searchable.
  - Users can **submit** their own app/plugin/theme to a catalog → **moderation
    queue** → admin/mod **approve** (publishes) or **reject** (notifies the user).

### 3.3 BSM section (initial scope)
- **Blog**.
- **Community presets**: one `.json` = one preset. The preset always carries its
  metadata (`name`, `color`, `version`, `UpdateNumber`, `date`, `assetPaths[]`…).
  Users can **request** to post a preset → same moderation flow.

### 3.4 Accounts & user dashboard
- Email+password (argon2id) accounts, email verification, plus GitHub/Discord OAuth.
  A session is a signed cookie carrying a `Session` row id, so a device can be revoked
  from the account's session panel without waiting for the token to expire.
- An account is **required to submit** to any official catalog.
- **User dashboard**: manage your uploaded catalog items (apps/plugins/themes/
  presets) → **propose updates**, see moderation status, manage your hosted
  Server-Repos (below).

### 3.5 Admin dashboard
- Moderate every catalog (BMM + BSM): **approve / reject** submissions, with a
  rejection reason → **notification** to the user.
- Access the **BMM telemetry dashboard** (embedded / SSO link).
- See & manage **Server-Repos** (status, add one easily).
- **Set platform limits**: global hosting capacity, per-tier quotas, pricing knobs
  (see §3.6), all editable from the admin UI, stored as key/value rows in the
  `AdminSetting` model (no table-name mapping: Prisma's default name is used).

### 3.6 Server-Repo hosting (paid)
A user can pay to have one of their Server-Repos hosted by us; they get a dashboard
for it.
- **Storage tiers**: the seed ships Free (1 GB, $0) plus Pool 5 / 10 / 25 / 50 GB; plans
  are rows in `HostingPlan`, so an operator can edit or add tiers.
- **Global capacity guard**: admin sets total available storage; a purchase is
  **refused if it would leave the host under its reserved free margin** (the host
  must always keep ≥ X GB/MB free). Enforced at checkout + by the provisioner.
- **We set the per-repo upload limit** (the limit a repo author configures in BMM
  is ignored for hosted repos — ours wins).
- **Flexible pricing**: price is a function of storage GB + upload limit + CPU
  share, so it scales with what the repo actually costs us. Billed via **Stripe**.

### 3.7 Discord bot (`apps/bot`)

A shipped service, not an add-on: it is the site's presence inside a community server.
It holds **no database credentials**: every read and write goes through the API's
`/bot/*` surface with a shared secret, which is what keeps it a separate container.

`index.mjs` is a connection manager rather than a plain boot: it connects when a token
exists and the bot is enabled, reconnects when the token changes, and disconnects when
it is disabled, so an admin can set or rotate the token from the dashboard without
restarting the container. Around it sit eight more top-level modules: `config.mjs`
(the admin-edited config, refetched every 30 s, with `DISCORD_TOKEN` from the env
winning), `api.mjs`, `commands.mjs` (slash commands + interaction routing), `ui.mjs`,
`i18n.mjs`, `store.mjs`, `logbuffer.mjs`, and two added most recently:

- **`nav.mjs`**, the one Back button. A component interaction carries nothing but a
  custom id, so a screen opened from another screen used to be a dead end. The origin now
  travels **inside the custom id** of the button that opened the next screen, and the
  destination draws a single consistent Back from it, instead of a Back hand-wired per
  screen that points somewhere wrong six screens later.
- **`help.mjs`**, the single source for a feature's long explanation, read two ways: the
  "Learn more" button on the feature's own card (answered ephemerally, so the channel is
  untouched) and `/help`. Neither owns the text, so they cannot drift apart.

`features/` holds 28 modules, among them gating (multi-role, per-role requirements,
periodic re-verify), the economy and its seasons, the live casino and its lobbies,
giveaways, automod, moderation and the mod queue the website hands it, logging
(a routing table per guild), role panels, onboarding, announcements, payment and Ko-fi
posts, join-to-create voice rooms, member scans and application-emoji icons.

Every message is a **Discord Components V2 container** built by `ui.mjs`: no `content`,
no `embeds`, at most 40 components and 4000 characters. Requires the **Server Members**
and **Message Content** privileged intents.

---

## 4. Data model (Postgres / Prisma — core entities)

`packages/db/schema.prisma` declares **162 models**. The ones below are the spine the
rest hangs off; everything else (economy, polls, docs, teams, tasks, MYO, OIDC, charity,
legal, analytics…) is reachable from them. The live, generated picture of the whole
schema (widest models, most depended-on models, index drift) is the schema map
described in [CODEBASE_MAPS_EN.md](CODEBASE_MAPS_EN.md); prefer it over any list here,
because it reads the schema instead of remembering it.

```
User(id, email, passwordHash?, displayName, role[USER|MOD|ADMIN|SUPERADMIN],
     permissions[], customRoleIds[], emailVerified, stripeCustomerId?, createdAt)
Session(id, userId, ip?, userAgent?, device?, browser?, os?, country?, region?, city?,
        createdAt, lastSeenAt, revokedAt?)
Project(id, key, name, showOnHomeNews, showBlogTab, visibility, scheduledAt?)
BlogPost(id, projectId?, showcaseProjectId?, authorId, title, slug, excerpt, body,
         titleFr?/excerptFr?/bodyFr?, status[DRAFT|PUBLISHED], publishedAt?, version)

CatalogItem(id, projectId, kind[APP|PLUGIN|THEME|PRESET|MODPACK|TUTORIAL|LIST], ownerId,
            name, slug, description, tags[], version,
            status[PENDING|PUBLISHED|REJECTED|HIDDEN|SUSPENDED],
            payloadKey/*S3*/, payloadSize, meta jsonb, views, downloads,
            deleteAt?, createdAt, updatedAt)
Submission(id, itemId, ownerId, type[NEW|UPDATE], status, reviewerId?, reason?, tags[],
           createdAt)
Notification(id, userId, kind, body, bodyFr?, href?, readAt?, createdAt)

ServerRepo(id, ownerId, name, hosted bool, freePlan, status, region, publicUrl,
           storageQuotaBytes, storageUsedBytes, uploadLimitKbps, cpuShare,
           seed, sha, listed, verified, groupId?, teamId?, deleteAt?, createdAt)
HostingPlan(id, name, storageGB, uploadLimitKbps, cpuShare, priceMonthlyCents, active,
            boostsPerPeriod, boostPeriodMonths, boostDays)
Subscription(id, userId, serverRepoId?, hostingGroupId?, poolContribBytes, planId,
             stripeSubId?, status, currentPeriodEnd?, createdAt)
Payment(id, userId, serverRepoId?, hostingGroupId?, kind[FEATURE|HOSTING|MYO_*|…],
        description, amountCents, currency, days?, stripeSessionId?, status, createdAt)

AdminSetting(key, value jsonb)            # global hosting cap, reserved free margin,
                                          # pricing knobs (price/GB, upload, cpu)…
```

There is no `Invoice` model: a completed charge is a `Payment` row, and Stripe keeps the
invoice itself. A subscription may point at a single `ServerRepo` (the legacy shape) or
at a `HostingGroup` storage pool (the current one), which is why both ids are nullable.

Object storage (S3/MinIO) holds the heavy bytes (catalog payloads, preset `.json`,
repo data); Postgres holds metadata + pointers (`payloadKey`).

---

## 5. Security

- **AuthN**: argon2id password hashing, email verification, sessions as signed cookies
  backed by a revocable `Session` row; TOTP 2FA **required** for MOD/ADMIN/SUPERADMIN.
- **AuthZ**: role-based (USER / MOD / ADMIN / SUPERADMIN) middleware, plus fine-grained
  capability grants and SUPERADMIN-authored custom roles layered on top; owners can only
  touch their own items; submissions only move state via mod/admin.
- **Input**: every route validates body/query with **Zod**; size caps on uploads.
- **Uploads**: client uploads go to S3 via **pre-signed URLs** (never proxy GBs
  through the API); server records metadata after a verify step.
- **Catalog payloads** are scanned for shape (preset JSON schema; plugin manifest)
  before PUBLISHED. Served read-only.
- **Hosted repos** get their own storage area, with the plan's storage quota and upload
  cap enforced at serve time. Per-repo container isolation is a marked extension point in
  the provisioner (`spinUpRepoContainer()`), not something it does today.
- **Rate limiting** (Redis buckets) on auth + submission + API.
- **Stripe** handles card data (PCI out of scope); webhooks are signature-verified.
- **Secrets** only via env / Docker secrets — never committed (`.gitignore`).

---

## 6. Scalability

- **API carries no per-process state that matters** (the rate-limit budget and the hot
  public-read cache live in Redis when it is configured) → scale horizontally behind
  Caddy. **PgBouncer** ships as an opt-in compose profile for that case.
- **Postgres** as the source of truth; read replicas later if needed.
- **Object storage** scales independently (S3) + can sit behind a CDN for catalog
  downloads.
- **Background work** runs as in-process workers started by `server.mjs`, not a job
  queue: `sweeper.mjs` (expiry sweeps for repos, submissions, scheduled deletions,
  included-boost grants) and `monitor.mjs` (perf sampling + alerting).
- **Provisioner** is its own service → hosting load is isolated from the web API.

---

## 7. Deploy (simple, Docker)

```
cd BCWEB/infra/compose
cp .env.example .env        # set DB password, JWT secret, Stripe keys, S3 creds…
docker compose up -d        # db, redis, minio, api, web, bot, provisioner,
                            # telemetry + telemetry-db, caddy
                            # (pgbouncer only with --profile pgbouncer)
```
Caddy terminates TLS and routes, on the main site block: `/api/*` → api (the `/api`
prefix is stripped), `/hosting/*`, `/repos.json`, `/catalog.json`, `/sitemap.xml`,
`/robots.txt`, `/og/*`, `/oauth2/*` and the OIDC `.well-known` documents → api, and
everything else → web (nginx serving the built SPA). The telemetry dashboard is a
**separate site block** on its own domain, not a path. Hosted repo content is served by
the API under `/hosting/*`; a repo's bring-your-own domain is admitted by Caddy's
on-demand TLS, which asks the API (`/domains/ask`) whether a hostname is allowed.

The full deploy walkthrough is in [DEPLOY_EN.md](../run/DEPLOY_EN.md).

---

## 8. Where the original plan landed

The seven phases this document was written around (foundation, accounts + blog +
catalog browse, submissions + moderation, presets, Server-Repo list then provisioner,
Stripe hosting, admin settings + telemetry SSO) have all shipped, and the platform has
grown well past them (Discord bot, economy, polls, docs, teams, task board, MYO, an OIDC
provider, charity pots, a per-instance legal surface).

Treat sections 1 to 7 as the shape of the system, not as a plan. For what the product
actually does today, read **[App_Features_EN.md](App_Features_EN.md)**; for how it is
wired at the code level, **[Technical_Analysis_EN.md](Technical_Analysis_EN.md)**.
