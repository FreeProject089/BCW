# BetterCommunity Web (BCWEB) — Architecture

The hub that unites **BMM** (Better Mods Manager), **BSM** (Better Sound Maker) and
future Better* projects: one site, one account system, per-project blogs &
catalogs, an admin back-office, and paid Server-Repo hosting.

> Design goals (from the brief): **scalable**, **secure**, **simple to deploy with
> Docker**. Carte blanche on the *how* — this document is the *how*.

---

## 1. Stack (chosen for consistency + easy self-host)

The existing telemetry-dashboard is Node + Docker, so we stay in that world.

| Layer | Tech | Why |
|---|---|---|
| **API** | Node 20 + **Fastify** + **Zod** (validation) | fast, typed, schema-validated; one container |
| **DB** | **PostgreSQL 16** + **Prisma** (migrations + typed client) | relational data fits catalogs/billing; migrations |
| **Cache / queue** | **Redis** | sessions, rate-limit buckets, background jobs (BullMQ) |
| **Object storage** | **S3-compatible** (**MinIO** for self-host, or AWS S3) | catalog assets, preset files, repo data — never in Postgres/git |
| **Web** | **React + Vite + Tailwind** (matches the ecosystem) | SPA + SSR-light landing; one static bundle served by the proxy |
| **Proxy / TLS** | **Caddy** | automatic HTTPS, routing, one config |
| **Payments** | **Stripe** (Checkout + Billing + webhooks) | tiered + usage pricing, PCI handled by Stripe |
| **Repo hosting runtime** | Docker (provisioner service) | each hosted Server-Repo = an isolated container + quota'd volume |

Everything runs from a single **`docker compose up`** (see `docker-compose.yml`).

---

## 2. Monorepo layout

```
BCWEB/
  apps/
    api/            # Fastify API (auth, catalogs, submissions, hosting, billing, admin)
    web/            # React/Vite/Tailwind front (BetterCommunity + BMM + BSM + dashboards)
    provisioner/    # service that spins up / quota-enforces hosted Server-Repos
  packages/
    db/             # Prisma schema + migrations + client
    shared/         # shared types, zod schemas, constants (pricing tiers, roles)
  bmm/
    telemetry-dashboard/   # moved here (the live BMM telemetry app)
    asset/                 # BMM static assets (logos, screenshots)
    official-server-repo/  # the seed "official" Server-Repo content/config
    other/
  bsm/                     # BSM-specific assets / seed presets
  infra/
    caddy/          # Caddyfile (routing + TLS)
    compose/        # docker-compose.yml, .env.example
  ARCHITECTURE.md
```

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
- Email+password (argon2) accounts, email verification, sessions in Redis.
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
  (see §3.6) — all editable from the admin UI (stored in `admin_settings`).

### 3.6 Server-Repo hosting (paid)
A user can pay to have one of their Server-Repos hosted by us; they get a dashboard
for it.
- **Storage tiers**: 5 / 10 / 25 / 50 GB (configurable).
- **Global capacity guard**: admin sets total available storage; a purchase is
  **refused if it would leave the host under its reserved free margin** (the host
  must always keep ≥ X GB/MB free). Enforced at checkout + by the provisioner.
- **We set the per-repo upload limit** (the limit a repo author configures in BMM
  is ignored for hosted repos — ours wins).
- **Flexible pricing**: price is a function of storage GB + upload limit + CPU
  share, so it scales with what the repo actually costs us. Billed via **Stripe**.
- **Update rule**: to push an update to a hosted repo, the only requirement is a
  **valid SHA** (integrity) — nothing else.

---

## 4. Data model (Postgres / Prisma — core entities)

```
User(id, email, passwordHash, displayName, role[USER|MOD|ADMIN], emailVerified, createdAt)
Session(id, userId, expiresAt)            # also mirrored in Redis
Project(id, key[bmm|bsm|community], name)
BlogPost(id, projectId, authorId, title, slug, body, status[DRAFT|PUBLISHED], publishedAt)

CatalogItem(id, projectId, kind[APP|PLUGIN|THEME|PRESET], ownerId, name, slug,
            description, tags[], version, status[PENDING|PUBLISHED|REJECTED|HIDDEN],
            payloadKey/*S3*/, meta jsonb, createdAt, updatedAt)
Submission(id, itemId, ownerId, type[NEW|UPDATE], status, reviewerId, reason, createdAt)
Notification(id, userId, kind, body, readAt, createdAt)

ServerRepo(id, ownerId, name, hosted bool, status, region, publicUrl,
           storageQuotaBytes, storageUsedBytes, uploadLimitKbps, cpuShare,
           seed, createdAt)
HostingPlan(id, name, storageGB, uploadLimitKbps, cpuShare, priceMonthlyCents)
Subscription(id, userId, serverRepoId, stripeSubId, planId, status, currentPeriodEnd)
Invoice(id, subscriptionId, stripeInvoiceId, amountCents, status, createdAt)

AdminSetting(key, value jsonb)            # global hosting cap, reserved free margin,
                                          # pricing knobs (price/GB, upload, cpu)…
```

Object storage (S3/MinIO) holds the heavy bytes (catalog payloads, preset `.json`,
repo data); Postgres holds metadata + pointers (`payloadKey`).

---

## 5. Security

- **AuthN**: argon2id password hashing, email verification, sessions in Redis with
  rotation; optional TOTP 2FA for admins.
- **AuthZ**: role-based (USER / MOD / ADMIN) middleware; owners can only touch their
  own items; submissions only move state via mod/admin.
- **Input**: every route validates body/query with **Zod**; size caps on uploads.
- **Uploads**: client uploads go to S3 via **pre-signed URLs** (never proxy GBs
  through the API); server records metadata after a verify step.
- **Catalog payloads** are scanned for shape (preset JSON schema; plugin manifest)
  before PUBLISHED. Served read-only.
- **Hosted repos** are isolated (one container + quota'd volume each); the
  provisioner enforces storage + upload + CPU caps; updates require a **valid SHA**.
- **Rate limiting** (Redis buckets) on auth + submission + API.
- **Stripe** handles card data (PCI out of scope); webhooks are signature-verified.
- **Secrets** only via env / Docker secrets — never committed (`.gitignore`).

---

## 6. Scalability

- **API is stateless** (sessions/cache in Redis) → scale horizontally behind Caddy.
- **Postgres** as the source of truth; read replicas later if needed.
- **Object storage** scales independently (S3) + can sit behind a CDN for catalog
  downloads.
- **Background jobs** (BullMQ on Redis): moderation notifications, repo
  provisioning/teardown, usage metering, Stripe reconciliation — decoupled from
  request latency.
- **Provisioner** is its own service → hosting load is isolated from the web API.

---

## 7. Deploy (simple, Docker)

```
cd BCWEB/infra/compose
cp .env.example .env        # set DB password, JWT secret, Stripe keys, S3 creds…
docker compose up -d        # api + web + postgres + redis + minio + caddy
```
Caddy terminates TLS and routes:
`/` → web, `/api` → api, `/telemetry` → BMM telemetry-dashboard,
hosted repos → provisioner-managed containers (sub-domains).

---

## 8. Phased roadmap

1. **Foundation** (this commit): monorepo skeleton, docker-compose, DB schema,
   API boots (`/health`, auth scaffold), web shell. ← we are here
2. **Accounts + Blog + Catalog browse** (read paths + landing).
3. **Submissions + moderation** (user dashboard, admin queue, notifications).
4. **BSM presets** (upload `.json`, schema-validate, browse).
5. **Server-Repo list + status** (read), then **provisioner**.
6. **Stripe hosting** (plans, checkout, webhooks, quota/capacity enforcement).
7. **Admin settings** (limits + pricing knobs), telemetry SSO.

Each phase is independently shippable and Dockerized.
