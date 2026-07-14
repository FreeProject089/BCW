# BCWEB Guides

All BetterCommunity Web documentation, in one place. Each guide is either split into
a separate 🇬🇧 EN and 🇫🇷 FR file, or is bilingual within a single file (noted below).

### 👥 Using BetterCommunity (for members, moderators & hosts)

| Guide | 🇬🇧 EN | 🇫🇷 FR |
|---|---|---|
| 🧑 **The good little user** (every feature, for everyday members) | [USER_GUIDE_EN.md](USER_GUIDE_EN.md) | [USER_GUIDE_FR.md](USER_GUIDE_FR.md) |
| 🛡️ **The good little moderator** (tools, roles, judgement) | [MODERATOR_GUIDE_EN.md](MODERATOR_GUIDE_EN.md) | [MODERATOR_GUIDE_FR.md](MODERATOR_GUIDE_FR.md) |
| 🚀 **The good little host** (repos, catalogs, pools, billing) | [HOST_GUIDE_EN.md](HOST_GUIDE_EN.md) | [HOST_GUIDE_FR.md](HOST_GUIDE_FR.md) |

### 🛠️ Running / deploying the platform

| Guide | 🇬🇧 EN | 🇫🇷 FR |
|---|---|---|
| ⭐ **Production quickstart** (fresh VPS → live in ~15 min) | [QUICKSTART_EN.md](QUICKSTART_EN.md) | [QUICKSTART_FR.md](QUICKSTART_FR.md) |
| 🔄 **Auto-updates** (how BMM/BSM update + hosting release feeds on BCWEB) | [AUTO_UPDATE_EN.md](AUTO_UPDATE_EN.md) | [AUTO_UPDATE_FR.md](AUTO_UPDATE_FR.md) |
| **Deploy to production** (full guide: Docker, HTTPS, Stripe, backups, scaling) | [DEPLOY_EN.md](DEPLOY_EN.md) | [DEPLOY_FR.md](DEPLOY_FR.md) |
| **Enable the optional add-ons** (CDN, PgBouncer, replicas, R2, separate DB, off-site backup) | [ADDONS_EN.md](ADDONS_EN.md) | [ADDONS_FR.md](ADDONS_FR.md) |
| **Backup & restore** (Postgres + MinIO + audit anchor, cron, off-site, restore steps) | [BACKUP_EN.md](BACKUP_EN.md) | [BACKUP_FR.md](BACKUP_FR.md) |
| **`.env` variables explained** | [ENV_EN.md](ENV_EN.md) | [ENV_FR.md](ENV_FR.md) |
| **Docker files explained** (services, volumes, prod updates) | [DOCKER_EN.md](DOCKER_EN.md) | [DOCKER_FR.md](DOCKER_FR.md) |
| **Domain & HTTPS** (Caddy + Let's Encrypt) | [DOMAIN_SETUP.md](DOMAIN_SETUP.md) *(bilingual)* | ↩︎ same file |
| **App features** | [App_Features_EN.md](App_Features_EN.md) | [App_Features_FR.md](App_Features_FR.md) |
| **Technical analysis** (dev deep-dive) | [Technical_Analysis_EN.md](Technical_Analysis_EN.md) | [Technical_Analysis_FR.md](Technical_Analysis_FR.md) |
| **Step-by-step setup** (admin, 2FA, roles, integrations) | [SETUP_GUIDE.md](SETUP_GUIDE.md) | *résumé FR en tête* |
| **Architecture** (design & roadmap) | [ARCHITECTURE.md](ARCHITECTURE.md) | *résumé FR en tête* |
| **API reference** (endpoint catalog) | [API_Reference_EN.md](API_Reference_EN.md) | *résumé FR en tête* |
| **Other Projects / showcase feature** | [OTHER_PROJECTS_GUIDE.md](OTHER_PROJECTS_GUIDE.md) | *résumé FR en tête* |
| **Hosting users' Docker projects** (future design) | [USER_PROJECT_HOSTING.md](USER_PROJECT_HOSTING.md) | *résumé FR en tête* |

*« résumé FR en tête » = an English doc with a substantive French summary at the top; ask for
a full parallel FR translation if you want one.*

> Project-level docs stay at the repo root: [`README.md`](../README.md) and the
> [`SECURITY_AUDIT.md`](../SECURITY_AUDIT.md).

## Quick answers

- **How is SSL/HTTPS configured?** It's automatic — Caddy provisions and renews a
  Let's Encrypt certificate for your domain. You only set `SITE_DOMAIN` + `SITE_URL`
  in `infra/compose/.env` and open ports 80/443. Full steps in
  [DOMAIN_SETUP.md](DOMAIN_SETUP.md) and [DEPLOY_EN.md](DEPLOY_EN.md) §4.
- **The Discord bot doesn't post payments.** Check admin → Discord bot → Payments for
  the Stripe key / webhook secret ✓/✗ diagnostic. Almost always the Stripe webhook
  isn't reaching the API — see [DEPLOY_EN.md](DEPLOY_EN.md) §6.
- **Load / benchmark.** See [`../loadtest/BENCHMARK.md`](../loadtest/BENCHMARK.md) and
  run `cd loadtest && npm install && node run.mjs`.
- **Let another app "Sign in with BetterCommunity"?** BCWEB is an OpenID Connect provider —
  register the app in Admin → **SSO / OAuth**, then point its OIDC library at
  `<SITE_URL>/.well-known/openid-configuration`. Zero config; details in
  [DEPLOY_EN.md](DEPLOY_EN.md) §8b.
