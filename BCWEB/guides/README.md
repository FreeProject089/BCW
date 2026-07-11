# BCWEB Guides

All BetterCommunity Web documentation, in one place. Each guide is either split into
a separate 🇬🇧 EN and 🇫🇷 FR file, or is bilingual within a single file (noted below).

| Guide | 🇬🇧 EN | 🇫🇷 FR |
|---|---|---|
| ⭐ **Production quickstart** (fresh VPS → live in ~15 min) | [QUICKSTART_EN.md](QUICKSTART_EN.md) | [QUICKSTART_FR.md](QUICKSTART_FR.md) |
| **Deploy to production** (full guide: Docker, HTTPS, Stripe, backups, scaling) | [DEPLOY_EN.md](DEPLOY_EN.md) | [DEPLOY_FR.md](DEPLOY_FR.md) |
| **Docker files explained** (services, volumes, prod updates) | [DOCKER_EN.md](DOCKER_EN.md) | [DOCKER_FR.md](DOCKER_FR.md) |
| **Local setup / dev** | [SETUP_GUIDE.md](SETUP_GUIDE.md) *(bilingual)* | ↩︎ same file |
| **Domain & HTTPS** (Caddy + Let's Encrypt) | [DOMAIN_SETUP.md](DOMAIN_SETUP.md) *(bilingual)* | ↩︎ same file |
| **Hosting users' Docker projects** (future design) | [USER_PROJECT_HOSTING.md](USER_PROJECT_HOSTING.md) *(bilingual)* | ↩︎ same file |
| **App features** | [App_Features_EN.md](App_Features_EN.md) | [App_Features_FR.md](App_Features_FR.md) |
| **Technical analysis** | [Technical_Analysis_EN.md](Technical_Analysis_EN.md) | [Technical_Analysis_FR.md](Technical_Analysis_FR.md) |
| **Architecture** | [ARCHITECTURE.md](ARCHITECTURE.md) | — |
| **API reference** | [API_Reference_EN.md](API_Reference_EN.md) | — |
| **Other Better\* projects** | [OTHER_PROJECTS_GUIDE.md](OTHER_PROJECTS_GUIDE.md) | — |

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
