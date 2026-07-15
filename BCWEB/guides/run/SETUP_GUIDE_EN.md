# BCWEB — Step-by-step setup guide

*🇫🇷 [Version française](SETUP_GUIDE_FR.md).*

A practical, in-order walkthrough for standing up a fresh BCWEB instance: first boot,
the admin account, 2FA, roles, and the optional integrations (Discord bot, Stripe).
For the architecture/feature overview see [README.md](../README.md) and
[ARCHITECTURE.md](../reference/ARCHITECTURE_EN.md) — this doc is just "what do I click/type, in
what order."

## 1. Prerequisites

- Docker + Docker Compose v2 (`docker compose version`).
- A copy of this repo.

## 2. Configure environment variables

```bash
cd infra/compose
cp .env.example .env
```

Open `.env` and set, at minimum:

| Variable | What it's for |
|---|---|
| `POSTGRES_PASSWORD` | Database password — pick a real one, even locally. |
| `JWT_SECRET` | Signs session cookies, 2FA tokens, step-up elevation tokens. Generate with `openssl rand -hex 32`. **The app refuses to boot in production with the insecure default.** |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | MinIO (or real S3) credentials for hosted uploads. |
| `SITE_DOMAIN` / `SITE_URL` | Local dev: leave as `http://localhost`. Production: your real domain — Caddy auto-provisions HTTPS from `SITE_DOMAIN`. |

Everything else (Stripe, GTM, Discord bot, telemetry) is optional and covered in its
own section below — leave those blank for now and come back once the core site is
running.

## 3. First boot

```bash
docker compose up -d
docker compose exec api npm run seed
```

The seed is idempotent (safe to re-run) and creates:
- The four core projects (BMM, BSM, community, installer).
- Default hosting plans.
- **A SUPERADMIN account**: `admin@bettercommunity.local` / `change-me-now`
  (or `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` if you set those env vars before
  seeding). Seeded as **SUPERADMIN** specifically so there's always at least one
  account able to grant/reassign roles afterward.

Check it's healthy:
```bash
curl http://localhost/api/health   # { "ok": true, "db": true, ... }
```

## 4. First login — change the seeded password immediately

1. Go to `http://localhost` → **Sign in** → use the seeded admin credentials above.
2. Go to **Profile** → *Change password* → set a real password. The seeded
   `change-me-now` should never survive past this step, even in a local/dev instance.

## 5. Enable 2FA on the admin account

Profile → **Two-factor authentication** → **Enable 2FA**:

1. The app shows a QR code and, below it, the same secret as plain text (for
   authenticators that can't scan, e.g. some CLI tools). Scan it with Google
   Authenticator, Authy, 1Password, etc. — or enter the secret manually.
2. Enter the 6-digit code your authenticator now shows → **Confirm & enable**.
3. You'll be shown **8 one-time recovery codes exactly once** — click
   **Download codes** (saves a `.txt`, named `{name}_2FA_{date}.txt`) or copy them
   somewhere safe before dismissing. Each code works once if you lose your device.
4. From now on, logging in asks for a 2FA code after the password.

2FA is **self-service only** — an admin can never enable/disable it for another
account, since it's a personal auth factor. To disable it later: Profile → Two-factor
→ enter your current password **and** a current code (or a recovery code).

## 6. Roles & access (SUPERADMIN only)

Admin dashboard → **Roles & access** (visible to SUPERADMIN only — regular ADMINs
don't see this tab):

- **Find a user** → search by id / display name / email / linked creator id / linked
  Discord → pick someone → **reassign their role** (USER/MOD/ADMIN/SUPERADMIN). You
  can't change your own role here (avoids accidentally locking yourself out) — get
  another SUPERADMIN to do it, or use the seed account.
- **Global access policy** (same screen) — an optional site-wide whitelist/blacklist
  applied to every hosted Server-Repo, on top of each repo's own settings. Leave
  everything empty/off unless you specifically need it.
- **Server-control tools** — grant this to a specific ADMIN/SUPERADMIN if you want
  them to reach the "Advanced server management" tab (file manager, DB viewer,
  restart). They must have their **own** 2FA enabled (step 5) — the grant alone
  isn't enough, they also re-verify with a fresh code each time they use those tools
  (a separate "step-up" from the login 2FA).

Blog-post permission grants live in their own **Blog access** tab (ADMIN+, not
SUPERADMIN-only) — separate from role/policy management.

**Unique BC id.** Every account has a stable **Unique BC id** (`BC-XXXX-XXXX`),
shown on its admin user card/modal (copyable). You can paste one straight into the
**Find a user** box to jump to that account — handy for support tickets where a user
quotes their id but not their email. Each hosted repo / catalog item also carries its
own element id (`BCR-…` / `BCI-…`) on the user modal. These are HMACs of the account
id (they reveal nothing on their own and aren't secrets).

## 7. Explore the rest of the admin dashboard

Once the basics above are done, the sidebar is grouped by topic — skim each section
once so you know what's there:

- **Moderation** — the submission queue (search/filter/tag/comment on pending items).
- **Users & access** — Users, Free vs paid, Roles & access, Blog access, Security log.
- **Repos & hosting** — Server repos, Free hosting, Promo codes, Storage.
- **Content** — Catalogs, Projects, Other projects, Announcements.
- **Server** — Server perf (live CPU/RAM/disk/latency + alerts), Advanced server
  management (step-up gated).
- **Bot & analytics** — Discord bot config, Analytics.
- **Settings** — pricing knobs, hosting caps, free-tier limits, etc.

## 8. Optional: Discord bot

Admin dashboard → **Discord bot**:

1. Create a bot in the [Discord Developer Portal](https://discord.com/developers/applications),
   enable the **Server Members** and **Message Content** privileged intents, and copy
   its token.
2. Paste the token in the dashboard's **Bot token** field and save — or set
   `DISCORD_TOKEN` in `.env` (the env var always wins over the dashboard-stored one).
3. Configure moderation, welcome messages, join-to-create voice, blog announcements,
   and **server-perf alerts** (a channel field — posts CPU/RAM/disk/service-down
   alerts as they fire) from the same screen.
4. **Payments & refunds module** — when enabled, the bot posts every successful Stripe
   payment and every refund to Discord. Both accept **multiple channel ids** (click
   "Add another channel"): a payment is posted to *all* payment channels, a refund to
   *all* refund channels (or the payment channels if you leave refunds empty).
   Refund embeds mask the customer email. Requires Stripe (section 9) so the webhook
   records payments/refunds for the bot to announce.
5. In production, also set `BOT_SHARED_SECRET` in `.env` (defaults to an insecure
   dev value) — it's the shared secret between the API and the bot container.

## 8b. Optional: GitHub / Discord OAuth login ("Continue with…")

Lets visitors sign in / sign up with GitHub or Discord instead of a password. The
buttons only appear once the credentials are configured (the frontend probes
`/api/auth/oauth/providers` and hides a provider that isn't set up), so you can leave
this off with no visible trace.

1. **GitHub** — create an OAuth App at *GitHub → Settings → Developer settings → OAuth
   Apps*. Set the callback URL to `https://your-domain/api/auth/oauth/github/callback`
   (local: `http://localhost/api/auth/oauth/github/callback`). Copy the client id +
   secret into `.env` as `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`.
2. **Discord** — in the [Discord Developer Portal](https://discord.com/developers/applications)
   → your app → **OAuth2**, add the same-shaped redirect
   (`…/api/auth/oauth/discord/callback`), and copy the client id + secret into `.env`
   as `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`. (This is the OAuth app identity —
   distinct from the bot's `DISCORD_TOKEN` in step 8.)
3. `docker compose up -d api web` to pick up the env. State is CSRF-protected with an
   HMAC-signed, time-bound `state` param, and only provider-*verified* emails are
   trusted. Accounts created purely via OAuth have no password (login tells them to
   use the provider); they can set one later from Profile.
4. New accounts — however they sign up — are offered an **optional 2FA setup** step,
   and any signed-in account without 2FA sees a dismissible dashboard nudge proposing
   it.

## 9. Optional: Stripe (paid hosting/catalog billing)

1. Get API keys at `dashboard.stripe.com` (use **test mode** keys while developing),
   set `STRIPE_SECRET_KEY` in `.env`.
2. Create a webhook endpoint pointing at `https://your-domain/api/hosting/webhook`
   and set `STRIPE_WEBHOOK_SECRET` to its signing secret. Enable **exactly these
   events** (the handler in `apps/api/src/routes/stripe-webhook.mjs` listens for them):
   - `checkout.session.completed` — provisions hosting / boosts / upgrades / renewals.
   - `invoice.paid` — recurring auto-renew cycles (hosting subs + boost subs).
   - `invoice.payment_failed` — warns the owner a renewal charge failed.
   - `customer.subscription.deleted` — suspends when a subscription finally ends.
   - `charge.refunded` — records refunds (surfaced in the bot's refund channels).
   For **local** testing, run `stripe listen --forward-to localhost/api/hosting/webhook`
   and use the CLI's printed signing secret as `STRIPE_WEBHOOK_SECRET`.
3. Enable the Stripe **Customer Portal** (needed for the "Manage billing" link and to
   let users cancel/change subscriptions).
4. **Invoices are real Stripe documents.** One-time checkouts are created with
   `invoice_creation` on, and Billing → *Invoice* / the payment-success modal resolve
   the genuine Stripe hosted-invoice/receipt **PDF** live (older payments, pre-upgrade,
   fall back to the styled in-app receipt). Nothing to configure — just don't disable
   invoice emails/PDFs in your Stripe settings if you want the PDF link.
5. **Auto-renew** — the hosting "Renew" row and the boost modal both have an
   *auto-renew* toggle that starts a recurring subscription instead of a one-time
   charge; `invoice.paid` (step 2) drives the renewals.
6. Once `STRIPE_SECRET_KEY` is set, the Server perf tab's dependency list
   automatically starts checking Stripe's reachability too.

## 10. Optional: BMM telemetry dashboard

The telemetry service (`bmm/telemetry-dashboard`, its own container + SQLite) collects
opt-in BMM app analytics. Config env lives in `bmm/telemetry-dashboard/.env`
(`API_KEY` must match the BMM app's `analytics_key`; `ADMIN_KEY` unlocks the admin
panel). Beyond first boot you **don't** edit that `.env` for day-to-day limits:

- **Storage cap, GDPR retention, and erase delay are editable LIVE** from
  Admin → **Hosting settings** → the *"BMM telemetry (live)"* card. Saving pushes to
  the telemetry service, persists to its `config.json` (overrides `.env`, survives
  restarts), and trims over-limit data immediately — no restart.
- For BCWEB to reach the telemetry service, the `api` container needs
  `TELEMETRY_INTERNAL_URL` (default `http://telemetry:8900`) and `TELEMETRY_ADMIN_KEY`
  (= the telemetry service's `ADMIN_KEY`) — both already wired in
  `infra/compose/docker-compose.yml`, so setting `TELEMETRY_ADMIN_KEY` in `.env` is
  enough.
- Admins with telemetry access get an SSO "open telemetry" button (no static key
  needed); grant it per-user in **Roles & access**.

## 11. Production checklist

- Follow **[DOMAIN_SETUP.md](DOMAIN_SETUP_EN.md)** to move off `localhost` onto your
  own domain with automatic HTTPS (Caddy + Let's Encrypt), including the optional
  `telemetry.<domain>` sub-domain.
- See the **Production checklist** in [README.md](../README.md) for the full list
  (backups, Stripe **live** keys + a live-mode webhook, secrets rotation, etc.).
- Make sure every SUPERADMIN and ADMIN account has 2FA enabled (step 5) before
  go-live, and that `JWT_SECRET` / `BOT_SHARED_SECRET` / `TELEMETRY_ADMIN_KEY` are all
  real random values, not the dev defaults.
