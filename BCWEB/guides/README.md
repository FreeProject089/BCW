# BCWEB Guides

**Start here.** Every guide has a 🇬🇧 English and a 🇫🇷 French file. Find your case in the
first table, follow the link, done — you shouldn't have to open five files to find one answer.

```
guides/
├── use/         you're USING BetterCommunity (member, moderator, host)
├── run/         you're INSTALLING or OPERATING it (VPS, Docker, env, backups)
├── reference/   you want to UNDERSTAND it (architecture, API, features)
└── audits/      point-in-time audits & plans (historical record — see below)
```

## I want to…

| I want to… | Read | 🇬🇧 | 🇫🇷 |
|---|---|---|---|
| **Get it online, fast** (fresh VPS → live in ~15 min) | Quickstart | [EN](run/QUICKSTART_EN.md) | [FR](run/QUICKSTART_FR.md) |
| **Deploy it properly** (the full path: DNS, HTTPS, Stripe, backups, scaling) | Deploy | [EN](run/DEPLOY_EN.md) | [FR](run/DEPLOY_FR.md) |
| **Configure it after install** (admin account, 2FA, roles, integrations) | Setup guide | [EN](run/SETUP_GUIDE_EN.md) | [FR](run/SETUP_GUIDE_FR.md) |
| **Know what a `.env` variable does** | Env reference | [EN](run/ENV_EN.md) | [FR](run/ENV_FR.md) |
| **Point a domain at it / fix HTTPS** | Domain & HTTPS | [EN](run/DOMAIN_SETUP_EN.md) | [FR](run/DOMAIN_SETUP_FR.md) |
| **Understand the Docker setup** (services, volumes, updating prod) | Docker | [EN](run/DOCKER_EN.md) | [FR](run/DOCKER_FR.md) |
| **Not lose data** (backup, restore, off-site, cron) | Backup & restore | [EN](run/BACKUP_EN.md) | [FR](run/BACKUP_FR.md) |
| **Decide how many machines** (1 VPS, DB on its own, several web hosts) | Topology | [EN](run/TOPOLOGY_EN.md) | [FR](run/TOPOLOGY_FR.md) |
| **Scale it up** (CDN, PgBouncer, replicas, R2, separate DB) | Add-ons | [EN](run/ADDONS_EN.md) | [FR](run/ADDONS_FR.md) |
| **Ship app updates through BCWEB** (BMM/BSM release feeds) | Auto-updates | [EN](run/AUTO_UPDATE_EN.md) | [FR](run/AUTO_UPDATE_FR.md) |
| **Use the site as a member** | User guide | [EN](use/USER_GUIDE_EN.md) | [FR](use/USER_GUIDE_FR.md) |
| **Moderate** (tools, roles, judgement calls) | Moderator guide | [EN](use/MODERATOR_GUIDE_EN.md) | [FR](use/MODERATOR_GUIDE_FR.md) |
| **Host a repo or a catalog** (pools, billing, access) | Host guide | [EN](use/HOST_GUIDE_EN.md) | [FR](use/HOST_GUIDE_FR.md) |
| **See every feature** | App features | [EN](reference/App_Features_EN.md) | [FR](reference/App_Features_FR.md) |
| **Call the API** | API reference | [EN](reference/API_Reference_EN.md) | [FR](reference/API_Reference_FR.md) |
| **Understand the design** (subsystems, decisions, roadmap) | Architecture | [EN](reference/ARCHITECTURE_EN.md) | [FR](reference/ARCHITECTURE_FR.md) |
| **Work on the code** (from-scratch dev deep-dive) | Technical analysis | [EN](reference/Technical_Analysis_EN.md) | [FR](reference/Technical_Analysis_FR.md) |
| **Add a project to the showcase** | Other projects | [EN](reference/OTHER_PROJECTS_GUIDE_EN.md) | [FR](reference/OTHER_PROJECTS_GUIDE_FR.md) |
| **Host users' own Docker projects** (design, not built) | User project hosting | [EN](reference/USER_PROJECT_HOSTING_EN.md) | [FR](reference/USER_PROJECT_HOSTING_FR.md) |

## Which "how to run it" guide do I actually want?

Three guides cover installation and they **do overlap** — this is the difference, so you only
read one:

- **[Quickstart](run/QUICKSTART_EN.md)** — the shortest path to a live site. Copy-paste, few
  explanations. Start here.
- **[Deploy](run/DEPLOY_EN.md)** — the same ground *plus* everything Quickstart skips: DNS,
  certificates, Stripe webhooks, the bot, backups, scaling. Read it when Quickstart isn't
  enough, or when something breaks.
- **[Setup guide](run/SETUP_GUIDE_EN.md)** — starts *after* the stack is up: the admin
  account, 2FA, roles, connecting integrations.

Rough rule: **Quickstart** to get it up → **Setup guide** to configure it → **Deploy** as the
reference when you need the detail.

## Audits (`audits/`) — historical, not instructions

These are **dated snapshots**, not guides. They record what was wrong at a point in time and
what was done about it. Every item in all three is **completed** (Jul 2026) — they're kept for
the reasoning, not as a to-do list. Don't follow them as setup instructions.

| Audit | 🇬🇧 | 🇫🇷 |
|---|---|---|
| Technical audit (strengths, risks, action plan) | [EN](audits/TECH_AUDIT_EN.md) | [FR](audits/TECH_AUDIT_FR.md) |
| Performance audit (bottlenecks + fix plan) | [EN](audits/PERF_AUDIT_EN.md) | [FR](audits/PERF_AUDIT_FR.md) |
| Rust workers plan (moving CPU work off the event loop) | [EN](audits/RUST_WORKERS_PLAN_EN.md) | [FR](audits/RUST_WORKERS_PLAN_FR.md) |

## Elsewhere in the repo

- Project overview → [`../README.md`](../README.md)
- Security audit → [`../SECURITY_AUDIT.md`](../SECURITY_AUDIT.md)
- Load/stress harness + **measured numbers** → [`../loadtest/BENCHMARK.md`](../loadtest/BENCHMARK.md)
  ([FR](../loadtest/BENCHMARK_FR.md)). Run it: `cd loadtest && npm install && node run.mjs` →
  open `report.html`.
- Native Rust addon → [`../native/README.md`](../native/README.md)

## Quick answers

- **What VPS do I need?** Sizing table from real measurements, not guesses →
  [`../loadtest/BENCHMARK.md`](../loadtest/BENCHMARK.md) § Server sizing.
- **How is SSL/HTTPS configured?** Automatic — Caddy provisions and renews a Let's Encrypt
  certificate. Set `SITE_DOMAIN` + `SITE_URL` in `infra/compose/.env`, open ports 80/443.
  → [Domain & HTTPS](run/DOMAIN_SETUP_EN.md), [Deploy §4](run/DEPLOY_EN.md).
- **The Discord bot doesn't post payments.** Check admin → Discord bot → Payments for the
  Stripe key / webhook ✓/✗ diagnostic. It's almost always the Stripe webhook not reaching the
  API → [Deploy §6](run/DEPLOY_EN.md).
- **Let another app "Sign in with BetterCommunity"?** BCWEB is an OpenID Connect provider —
  register the app in Admin → **SSO / OAuth**, then point its OIDC library at
  `<SITE_URL>/.well-known/openid-configuration` → [Deploy §8b](run/DEPLOY_EN.md).

---

*Adding a guide? Put it in the folder that matches the reader's intent, ship EN **and** FR,
add a row above, and run `node guides/check-links.mjs` — the guides cross-link heavily and a
dead markdown link fails silently at read time, not at build time.*
