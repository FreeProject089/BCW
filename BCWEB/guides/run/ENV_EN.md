# BCWEB — The `.env` variables explained (EN)

> 🇫🇷 [ENV_FR.md](ENV_FR.md) · Full deployment: [DEPLOY_EN.md](DEPLOY_EN.md) · add-ons: [ADDONS_EN.md](ADDONS_EN.md)
>
> The real `.env` lives in `infra/compose/.env` (copied from `.env.example`). It is **never
> committed** (it holds your secrets). This document explains every variable.

**Generate secrets** with `openssl rand -hex 32` (for `JWT_SECRET`, etc.).

---

## 1. Database (required)
| Variable | Purpose |
|---|---|
| `POSTGRES_USER` | Postgres user (default `bcweb`) |
| `POSTGRES_PASSWORD` | **DB password — set a strong one** |
| `POSTGRES_DB` | database name (default `bcweb`) |

## 2. Security (required)
| Variable | Purpose |
|---|---|
| `JWT_SECRET` | signs sessions/cookies. **Long random string** (`openssl rand -hex 32`). In production the API refuses to boot with the example value. |
| `LINK_LOOKUP_SECRET` | signs the BMM↔BCWEB link lookup and the telemetry SSO handoff (the telemetry service verifies the same value as `BC_LINK_SECRET`). Has a fallback — but it's `dev-link-secret`, committed in this repo, so set it. `openssl rand -hex 32`. |
| `BOT_SHARED_SECRET` | the Discord bot's API credential. Unset, compose gives **both** the api and the bot `LINK_LOOKUP_SECRET`'s value, so they agree — only set this to give the bot its own secret. Running the bot **outside** compose is the exception: its code reads only this one. |
| `AUDIT_SECRET` | HMAC key for the tamper-evident staff audit chain. Unset → falls back to `JWT_SECRET` (fine). ⚠️ **Changing it once entries exist invalidates verification of every earlier entry** — set it once, before going live. |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | The first SUPERADMIN account, created by `npm run setup`. **Set both before the first run**: the account is only created when it does not already exist, so changing them later does nothing. Left unset, every install ships with the same published default (`admin@bettercommunity.local` / `change-me-now`). |

## 3. Domain & HTTPS (required in production)
| Variable | Purpose |
|---|---|
| `SITE_DOMAIN` | your **bare** domain (e.g. `community.example.com`) — Caddy binds to it and auto-provisions HTTPS. (Local: `http://localhost:5176`) |
| `SITE_URL` | the **full public URL** (e.g. `https://community.example.com`) — used in emails, Stripe redirects, bot links, and the OIDC issuer. |
| `COOKIE_DOMAIN` | `.your-domain.com` (leading dot) so the session cookie also reaches sub-domains (telemetry). Local: `localhost`. |

## 4. Object storage — MinIO / S3 (required)
| Variable | Purpose |
|---|---|
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | object-storage credentials (bundled MinIO by default). |
| `S3_BUCKET` | bucket name (default `bcweb`). |
| `S3_ENDPOINT` | S3 endpoint (default internal MinIO `http://minio:9000`). |
| `S3_REGION` | region (`us-east-1` local, `auto` for Cloudflare R2). |
| `S3_PUBLIC_ENDPOINT` | the **public** storage URL (browsers reach it via pre-signed URLs). |
| `REPO_EXPORT_MAX_MB` | cap (MB) on the admin "download whole repo as one zip" review endpoint. The export streams, so this bounds transfer size, not memory. Default `250`; past it an admin fetches files individually. |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW` | per-IP request budget. Defaults `600` / `1 minute` — generous for a human (~10 req/s) and what keeps the DB safe under abuse, so **keep the default in production**. Raise it only to benchmark a route's raw capacity (`loadtest/`), since from one IP the limiter otherwise sheds the flood and every number is just 429s. |

*(To migrate to Cloudflare R2, change only these 5 — see [ADDONS_EN.md](ADDONS_EN.md) §4.)*

## 5. Payments — Stripe (optional)
| Variable | Purpose |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe secret key (paid hosting/boosts). |
| `STRIPE_WEBHOOK_SECRET` | webhook signing secret (`whsec_…`). **Without it the webhook returns 503** → no checkout is recorded. |

## 6. OAuth login (optional — "Sign in with …")
| Variable | Purpose |
|---|---|
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub login. |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | Discord login. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google login. |

Callback to register at each provider: `<SITE_URL>/api/auth/oauth/<provider>/callback`.

## 7. Discord bot (optional)
| Variable | Purpose |
|---|---|
| `DISCORD_TOKEN` | bot token. Empty = bot idle (you can also set it from the admin). |

## 8. BMM telemetry (optional)
| Variable | Purpose |
|---|---|
| `TELEMETRY_DOMAIN` | telemetry dashboard sub-domain (e.g. `https://telemetry.your-domain.com`). |
| `TELEMETRY_PUBLIC_URL` | URL the "open telemetry" button uses — keep equal to `TELEMETRY_DOMAIN`. |
| `TELEMETRY_ADMIN_KEY` | server-to-server admin key to manage the telemetry limits. |
| `TELEMETRY_API_KEY` | telemetry ingestion key. |

## 9. Transactional email (optional — confirmation + password reset)
| Variable | Purpose |
|---|---|
| `EMAIL_ENABLED` | `true` to enable sending. **Off by default** → password reset returns the token in the response (dev), no email is sent. |
| `SMTP_HOST` | SMTP server (e.g. `mail.infomaniak.com`). |
| `SMTP_PORT` | `587` (STARTTLS) or `465` (implicit TLS). |
| `SMTP_USER` | SMTP login = a **real mailbox** (not an alias). |
| `SMTP_PASS` | that mailbox's password. **Secret.** ⚠️ a `$` in the password must be **doubled** `$$` in `.env` (Docker Compose interpolation). |
| `SMTP_FROM` | the displayed sender, e.g. `BetterCommunity <noreply@your-domain.com>` (may be an alias of the authenticated mailbox). |

## 10. Redis (optional)
| Variable | Purpose |
|---|---|
| `REDIS_PASSWORD` | Redis AUTH password (internal). The default is fine for one box; set a strong one in production anyway. |

## 11. DB on a separate server / PgBouncer (advanced — see [ADDONS_EN.md](ADDONS_EN.md))
| Variable | Purpose |
|---|---|
| `DATABASE_URL` | full-URL override → point the stack at a **managed / 2nd-VPS Postgres** (pooled endpoint). Empty = local Postgres. |
| `DIRECT_DATABASE_URL` | direct (non-pooled) URL — for migrations. |
| `DB_HOST` / `DB_PORT` / `DB_URL_PARAMS` | route the API through **PgBouncer** (`pgbouncer` / `6432` / `?pgbouncer=true`). |
| `PGBOUNCER_UPSTREAM_HOST` / `PGBOUNCER_UPSTREAM_PORT` | make PgBouncer pool a managed/remote DB instead of the local `db`. |

## 12. Misc
| Variable | Purpose |
|---|---|
| `VITE_GTM_ID` | Google Tag Manager ID (front-end analytics, optional). Injected at build time. |
| `NODE_OPTIONS` | V8 flags for the API. The image already sets `--max-old-space-size=384`: V8 sizes its heap from the **host's** RAM and does *not* read the cgroup limit, so in a memory-limited container an unbounded heap grows past the limit and gets OOM-killed instead of collecting. Raise it in tandem with the container's memory limit. |
| `KOFI_WEBHOOK_TOKEN` | Ko-fi webhook verification token. Set here, it **wins over** the admin-set token and locks it in the dashboard (same pattern as `DISCORD_TOKEN`). Blank = manage it from the admin UI. |
| `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` | Twitch **profile connection** (not login). Register `<SITE_URL>/api/auth/connect/twitch/callback`. |
| `STEAM_API_KEY` | Steam profile connection (OpenID — no secret). [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey). |
| `MINIO_API_CORS_ALLOW_ORIGIN` | CORS origin MinIO answers pre-signed browser uploads for. Default `*` — fine behind the bundled setup; narrow it to your `SITE_URL` if you expose MinIO publicly. |

> **A variable only works if compose forwards it.** The API reads `process.env`, but in Docker
> it only sees what `infra/compose/docker-compose.yml` passes to the `api` service. Adding a
> variable to `.env` that compose doesn't forward does nothing — the code silently uses its
> default. If you add a new one, add it in both places (this bit us: `RATE_LIMIT_MAX`,
> `REPO_EXPORT_MAX_MB` and `AUDIT_SECRET` were documented here while compose dropped them).
> Check with `docker compose config` — it prints what each service will actually receive.

*(Internal variables with safe defaults, rarely touched: `TELEMETRY_INTERNAL_URL`,
`TELEMETRY_DATABASE_URL`, `DISCORD_CONTACT_WEBHOOK`. The **OpenID Connect SSO** needs no
variable — the key is auto-generated and the issuer = `SITE_URL`.)*

---

### Bare minimum to boot in production
`POSTGRES_PASSWORD`, `JWT_SECRET`, `SITE_DOMAIN`, `SITE_URL`, `COOKIE_DOMAIN`,
`S3_ACCESS_KEY`, `S3_SECRET_KEY`. Everything else is optional and enabled as needed.
