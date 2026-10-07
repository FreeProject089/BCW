# BCWEB — The `.env` variables explained (EN)

> 🇫🇷 [ENV_FR.md](ENV_FR.md) · Full deployment: [DEPLOY_EN.md](DEPLOY_EN.md) · add-ons: [ADDONS_EN.md](ADDONS_EN.md)
>
> The real `.env` lives in `infra/compose/.env` (copied from `.env.example`). It is **never
> committed** (it holds your secrets). This document explains every variable.

**You do not have to write it by hand.** `infra/configure-env.sh` (or `configure-env.ps1` on
Windows) asks for each value, explains it, generates the secrets, and refuses combinations that
cannot work — see
[DEPLOY_SCRIPTS_EN.md](DEPLOY_SCRIPTS_EN.md#configure-envsh--building-the-env-yourself). This
page is the reference for what each answer means, and for editing a .env you already have.

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
| `LINK_LOOKUP_SECRET` | signs the BMM↔BCWEB link lookup and the telemetry SSO handoff (the telemetry service verifies the same value as `BC_LINK_SECRET`). Has a fallback — but it's `dev-link-secret`, committed in this repo, so set it. `openssl rand -hex 32`. Its own value: it never falls back to `JWT_SECRET`, and the production boot refuses a value equal to `JWT_SECRET` (the telemetry service holds it). |
| `BOT_SHARED_SECRET` | the Discord bot's API credential. Unset, compose gives **both** the api and the bot `LINK_LOOKUP_SECRET`'s value, so they agree — **set it in production**: the API code reads only this one since September 2026 (no `LINK_LOOKUP_SECRET` fallback, SECURITY_SUMMARY §9 #4), and compose's own fallback to the link secret is what still makes an unset value work — the two services must not share a secret. |
| `AUDIT_SECRET` | HMAC key for the tamper-evident staff audit chain. Unset → falls back to `JWT_SECRET` (fine). ⚠️ **Changing it once entries exist invalidates verification of every earlier entry** — set it once, before going live. |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | The first SUPERADMIN account, created by `npm run setup`. **Set both before the first run**: the account is only created when it does not already exist, so changing them later does nothing. Left unset, every install ships with the same published default (`admin@bettercommunity.local` / `change-me-now`). |

## 3. Domain & HTTPS (required in production)
| Variable | Purpose |
|---|---|
| `SITE_DOMAIN` | your **bare** domain (e.g. `community.example.com`) — Caddy binds to it and auto-provisions HTTPS. (Local: `http://localhost:5176`) |
| `SITE_URL` | the **full public URL** (e.g. `https://community.example.com`) — used in emails, Stripe redirects, bot links, and the OIDC issuer. |
| `COOKIE_DOMAIN` | `.your-domain.com` (leading dot) so the session cookie also reaches sub-domains (telemetry). Local: `localhost`. |

## 4. Object storage — S3 (required)
| Variable | Purpose |
|---|---|
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | object-storage credentials. The bundled `storage` service (versitygw) takes them **as** its root credentials: nothing is stored in the data, and changing them means recreating `storage`, `api` and `provisioner` together. **In production (`NODE_ENV=production`) the API refuses to boot** when `S3_SECRET_KEY` is empty, is one of the `change-me…` placeholders of `.env.example`, or is shorter than 24 characters: with storage public on `S3_DOMAIN`, the example value would let anyone who read that file sign requests as storage's root. `openssl rand -hex 32`; `infra/gen-secrets.ps1`, `infra/bootstrap.sh` and `node infra/rotate-secrets.mjs` all write a long one. Development (`npm run dev`, no `NODE_ENV=production`) is not checked. |
| `S3_BUCKET` | bucket name (default `bcweb`). |
| `S3_ENDPOINT` | S3 endpoint (default the internal `storage` service, `http://storage:9000`). An old `.env` that still says `http://minio:9000` points at a service that no longer exists: remove the line. |
| `S3_REGION` | region (`us-east-1` local, `auto` for Cloudflare R2). Compose hands the same value to the bundled `storage`, which checks signatures against it. |
| `S3_HOST_PORT` | host port `storage` is published on, `127.0.0.1` only (default `9000`). Change it only when 9000 is taken on the machine, and change `S3_PUBLIC_ENDPOINT` to the same port. |
| `S3_CORS_ALLOW_ORIGIN` | CORS origin the bundled `storage` answers pre-signed browser uploads for. Default `*` — fine behind the bundled setup; narrow it to your `SITE_URL` once storage is public on `S3_DOMAIN`. One origin. Replaces `MINIO_API_CORS_ALLOW_ORIGIN`, which now does nothing. |
| `S3_DOMAIN` | the hostname **Caddy** serves object storage on (e.g. `s3.your-domain.com`). Unset, the Caddy block carries a name nobody can ask for and storage stays on `:9000` — intended locally. It pairs with `S3_PUBLIC_ENDPOINT`: one is what Caddy listens for, the other is what gets written into the signed URL. |
| `CUSTOM_DOMAIN_MATCHER` | set to `https://` to serve paying owners on **their own hostnames**. Unset, that Caddy block is bound to a name nobody can request, so a stack that has not opted in costs nothing. The certificate for each customer name is obtained on demand, at the first handshake — there is no list of domains in the config, because the list is in the database. |
| `DOMAIN_ASK_KEY` | a shared secret between Caddy and the API for the certificate question (`/domains/ask`). Without it, anyone who can reach that endpoint learns whether a hostname they name is hosted here; the edge blocks the public path either way, and this covers the API being reachable another way. Any long random string. Compose passes it to **both** `api` and `caddy`; set it in production. |
| `CSP_CONNECT_SRC_EXTRA` | extra origins the browser may fetch from, space-separated, appended to the site CSP's `connect-src` by Caddy. Empty by default: the site, the storage origin (`S3_PUBLIC_ENDPOINT`, `S3_DOMAIN`) and a fixed list (GitHub raw, the icon CDNs, Google Analytics after consent, the map tiles). A host an admin adds to the live-block list (Admin > Settings) or a project's live-number source on another host must be listed here too, or the browser refuses the request. Restart `caddy` after a change. |
| `TLS_TERMINATED_UPSTREAM` | `true` when HTTPS ends **in front of** this server: a hosting relay, a router or another proxy holds the certificates and forwards plain HTTP to port 80 here (BetterCommunity production since October 2026). Then `SITE_DOMAIN`, `TELEMETRY_DOMAIN` and `S3_DOMAIN` are written `http://name` (Caddy must not try to obtain certificates the front proxy holds: it fails and retries for ever, and its :80 → https redirect loops through the proxy), while `SITE_URL`, `TELEMETRY_PUBLIC_URL` and `S3_PUBLIC_ENDPOINT` stay `https://`. Read by `infra/caddy/site.mjs`: `add` then writes `http://` site addresses, and `apply` / `status` warn about any extra site without one. Compose does not read it. |
| `TRUSTED_PROXIES` | the front proxy's address(es) **as Caddy sees them** (IP or CIDR, space-separated, e.g. `192.168.1.254/32`). Caddy then takes the real client from the `X-Forwarded-For` that proxy sends (the right-most untrusted address, which a client cannot forge) and hands the API one address. Empty (default) = trust nobody, as before. Without it behind a front proxy, every visitor has the proxy's IP: rate limits are shared by everybody and an IP ban bans the whole site. Restart `caddy` after a change. |
| `REPO_PUBLIC_BASE` | public base for hosted repos (e.g. `https://your-domain.com/repos`). This value goes **into** the addresses handed to BMM: left on localhost in production, every published repo points at the visitor's own machine. |
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
| `TELEMETRY_RETENTION_DAYS` | how many days of telemetry events are kept before purging. |
| `TELEMETRY_DELETE_DELAY_H` | delay (hours) before a data-deletion request is carried out — the window in which it can still be cancelled. |
| `TELEMETRY_ISSUES_AI` | `1` (default) lets the dashboard ask Laya, through the API, to label live BMM issue groups (category, severity, likely duplicate); `0` turns it off from the telemetry side. Also off when the API's AI layer or the dashboard switch is off. |
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
| `COMPOSE_PROFILES` | which compose **profiles** are active (`pgbouncer`, `ai`; comma-separated for both). Set it here rather than as a `--profile` flag: a flag lasts one command, and `infra/deploy.sh` runs a plain `up -d` that would stop the pooler while `DB_HOST` still points the API at it. |
| `PGBOUNCER_UPSTREAM_HOST` / `PGBOUNCER_UPSTREAM_PORT` | make PgBouncer pool a managed/remote DB instead of the local `db`. |
| `API_REPLICAS` | how many `api` containers to run (default `1`). Raise it only when one saturates, and turn PgBouncer on at the same time. Use this rather than `--scale api=N`: the flag does not survive the next `docker compose up -d`, and `deploy.sh` runs exactly that. |

## 11b. Optional AI for moderation (see [AI_LAYA_EN.md](AI_LAYA_EN.md))
All empty = AI off, rules only. A value set here **wins** over the admin screen (Admin →
Moderation → AI provider), which greys the field.

| Variable | Purpose |
|---|---|
| `LAYA_API_KEY` | bearer key shared by the API and the Laya sidecar (`openssl rand -hex 32`). **Secret. Mandatory with the `ai` profile**: the sidecar refuses to start without it (or with the `.env.example` placeholder, or under 16 characters), and the API reports Laya "Not configured" and never calls it. Unused without the profile, where it may stay empty. |
| `LAYA_URL` | the sidecar's address. Default `http://laya:8000`; change it only if you run Laya elsewhere. |
| `LAYA_REVISION` | checkpoint pin: `reviewed` (default, the commit laya 0.3.21 reviewed) or a commit SHA. |
| `LAYA_CPUS` / `LAYA_MEM_LIMIT` / `LAYA_THREADS` | the sidecar's hard ceiling: default `1.5` CPU, `2g`, `2` torch threads. |
| `AI_KILL_SWITCH` | `1` = every AI call cut, and an admin **cannot** release it from the site. The rules keep running. |
| `AI_PROVIDER` | force `off`, `laya` or `external`. |
| `AI_TIMEOUT_MS` / `AI_CONCURRENCY` | force the per-call deadline (default 1500) and the calls at once (default 1). |
| `AI_EXTERNAL_URL` | base of an OpenAI-compatible API, e.g. `https://api.example.com/v1`. https and public only. A **third party**: update the privacy policy first. |
| `AI_EXTERNAL_KEY` | its key. **Secret.** Read from here only: never stored, logged or shown. |
| `AI_EXTERNAL_ALLOW_PRIVATE` | `1` = allow http and private addresses, for a model you host on your own network. Applies to the operator's provider and the **site key** only; a member's own key or a Discord server's key never gets it (that would be SSRF from the API's network). |
| `AI_KEYS_SECRET` | seals the AI keys stored in the database (members' own keys, the site key; [AI_FEATURES_EN.md](AI_FEATURES_EN.md)). **Secret.** Empty = derived from `JWT_SECRET`. Changing it makes every stored key unreadable: they must be typed again. |

## 12. Misc
| Variable | Purpose |
|---|---|
| `VITE_GTM_ID` | Google Tag / GA4 id (`GTM-XXXXXXX` or `G-XXXXXXXXXX`). Can also be set in the dashboard (Hosting settings → Search & discoverability → SEO health → "Tag Manager & ownership tokens") with no rebuild. This one is baked in at build time (a compose build arg) and **wins** over the dashboard; the SEO health card shows "From the build" when it does. Consent-gated either way. Public, not a secret. |
| `GOOGLE_SITE_VERIFICATION` | Google Search Console ownership token (the `content` of its `google-site-verification` meta tag; the whole tag is accepted and reduced to its content). Read by the **API at runtime** and served in that meta tag, so a change needs an API restart, not a rebuild. **Wins** over the token saved in the dashboard; the SEO health card shows "From the environment" when it does. Public, not a secret. |
| `NODE_OPTIONS` | V8 flags for the API. The image already sets `--max-old-space-size=384`: V8 sizes its heap from the **host's** RAM and does *not* read the cgroup limit, so in a memory-limited container an unbounded heap grows past the limit and gets OOM-killed instead of collecting. Raise it in tandem with the container's memory limit. |
| `KOFI_WEBHOOK_TOKEN` | Ko-fi webhook verification token. Set here, it **wins over** the admin-set token and locks it in the dashboard (same pattern as `DISCORD_TOKEN`). Blank = manage it from the admin UI. |
| `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` | Twitch **profile connection** (not login). Register `<SITE_URL>/api/auth/connect/twitch/callback`. |
| `STEAM_API_KEY` | Steam profile connection (OpenID — no secret). [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey). |

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
`S3_ACCESS_KEY`, `S3_SECRET_KEY` (24+ characters, not the example value). Everything else is optional and enabled as needed.
