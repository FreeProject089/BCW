# Topology — how many machines, and what goes where

Where each piece of BCWEB runs. Start at **one VPS**; the later shapes exist for when a
specific thing hurts, and each says which thing.

This guide is about **placement**. It does not repeat what the others cover:

- Getting it up the first time → [QUICKSTART_EN.md](QUICKSTART_EN.md)
- The full production path (DNS, HTTPS, Stripe) → [DEPLOY_EN.md](DEPLOY_EN.md)
- What each variable means → [ENV_EN.md](ENV_EN.md)
- Turning on a specific add-on (CDN, PgBouncer, R2…) → [ADDONS_EN.md](ADDONS_EN.md)

---

## Read this before you split anything

**Splitting machines does not make a site faster.** It moves a bottleneck and adds a
network hop, a second thing to secure, and a second thing to back up. Every shape below is
strictly more work than the one before it.

Go up a level when you can point at the symptom:

| Symptom | Shape to move to |
|---|---|
| Nothing hurts | Stay on **① one VPS** |
| The database is starved of RAM/IO while the web side idles (or you want them backed up separately) | **② database on its own machine** |
| One API container saturates: CPU pinned, latency climbing under load | **③ several API replicas** |
| A single API machine cannot keep up even with replicas, or you want zero-downtime deploys | **④ several web machines behind a load balancer** |

If you cannot name the symptom, the answer is **scale the machine you already have**. A
single well-sized VPS carries this workload a very long way, and it is the cheapest change
you will ever make.

---

## ① One VPS — the normal shape

Everything on one machine, which is what `infra/compose/docker-compose.yml` describes:
Caddy, the web build, the API, Postgres, Redis, MinIO, the bot, the telemetry service and
its own Postgres.

```bash
cd infra/compose
cp .env.example .env      # then edit it — see ENV_EN.md
docker compose up -d
```

Then seed the database (projects, the admin account, plans, docs, FAQ):

```bash
docker compose exec api npm run setup
```

Set `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` in `.env` **before that first run**, or
you get `admin@bettercommunity.local` / `change-me-now`. The account is only created when
it does not already exist, so re-running never resets a password you have since changed.

**Sizing.** 4 vCPU / 8 GB is comfortable for a community site; 2/4 works if you are not
hosting large repos. Disk is what actually runs out — hosted repos and catalog payloads
live in MinIO, so size it against `hosting.totalCapacityGB` rather than against traffic.

**Backups matter more than topology.** One machine means one thing to lose. Set up
[BACKUP_EN.md](BACKUP_EN.md) before you worry about any of the shapes below, and restore
from it once so you know it works.

---

## ② Database on its own machine

**Move here when** Postgres is competing with the web side for RAM or IO, or you want the
database backed up, patched and restarted on its own schedule. Also the shape you get for
free by using a managed Postgres.

It is a `.env` change and nothing else — the API talks to whatever those URLs point at:

```ini
DATABASE_URL=postgresql://user:pass@db-host:5432/bcweb?sslmode=require
DIRECT_DATABASE_URL=postgresql://user:pass@db-host:5432/bcweb?sslmode=require
```

```bash
docker compose up -d api provisioner
```

**Both variables, always.** `DATABASE_URL` is the runtime (pooled) connection;
`DIRECT_DATABASE_URL` is a direct one for migrations, which cannot run through a pooler in
transaction mode. Prisma fails with a `P1012` when one is missing, and that error looks
nothing like "you forgot an environment variable".

**Stop the local `db` service** so you are not running a Postgres nobody uses:

```bash
docker compose stop db
```

Do not `docker compose down -v` — that deletes the `db-data` volume with the old database
in it. Keep it until the new machine is proven.

**Lock the database down.** It is now reachable over a network:

- `sslmode=require` in both URLs, non-negotiable.
- Firewall 5432 to the web machine's IP only. A Postgres open to the internet is found by
  scanners in hours.
- A dedicated role for the app — not `postgres`.

### Several databases

There are three different things people mean by this, and they are not interchangeable.

**Telemetry on its own Postgres — already done.** `TELEMETRY_DATABASE_URL` points at a
separate instance and the compose file already runs one. It is the right model for data
that never needs a transaction with the rest.

**Read replicas** — same data, reads spread across copies. Nothing in the app routes reads
today: one Prisma client, one URL. Adding it means the `@prisma/extension-read-replicas`
extension in `lib.mjs`'s `db()`, plus handling **replication lag**: after a write, reading
from a replica can return the old value, so any "write then immediately read it back" path
has to be forced onto the primary. Do not add replicas before the cache and PgBouncer,
which are cheaper and usually enough.

**Sharding** — users split across N databases by key. Prisma does not do this; it would be
application-level routing, and cross-shard joins, transactions and counters each become
their own project. This is almost certainly not your answer.

---

## ③ Several API replicas — one web machine

**Move here when** one API container saturates. The API is stateless and its cache and rate
limiter are shared through Redis, so replicas behave as one.

It is `docker compose up -d --scale api=3` and nothing else — the host port is a range and
Caddy re-resolves `api`, so both of the things that used to need hand-editing are already in
the repo. [ADDONS_EN.md](ADDONS_EN.md) §3 has the detail, including the one proxy that stays
static.

Two things to have in place first:

- **PgBouncer** (§2). Each replica opens its own database connections; the pooler is what
  keeps the total bounded. Postgres runs out of connection slots long before it runs out of
  CPU.
- **`REDIS_URL` set.** Beyond the cache and rate limiter, live chat (commissions and report
  threads) publishes over Redis so a message reaches readers on *every* replica. Without
  it, the bus is in-process: a message posted on replica A never reaches a reader on
  replica B, who simply sees nothing until they reload.

---

## ④ Several web machines

**Move here when** even a replicated API on one machine cannot keep up, or you want
rolling deploys with no downtime.

Each web machine runs Caddy + web + API replicas; Postgres, Redis and MinIO are shared and
must already be OFF those machines (shape ②). What changes:

- **A load balancer in front**, with **sticky sessions not required** — auth is a signed
  cookie, so any machine can serve any request. That is the property that makes this shape
  simple; do not break it by putting state in a process.
- **Redis becomes mandatory infrastructure**, not an add-on. It is what makes the rate
  limit one shared budget, the cache coherent, and live chat cross-machine.
- **Object storage must be shared** — MinIO on its own host, or R2 ([ADDONS_EN.md](ADDONS_EN.md) §4).
  Two machines with two local MinIOs means an upload exists on one and 404s on the other.
- **One machine runs the singletons.** The Discord bot and the sweeper must not run in
  duplicate: two bots answer every command twice, and two sweepers race on the same rows.
  Run them on one machine only.
- **`COOKIE_DOMAIN`** must cover every hostname you serve, or sessions break as the load
  balancer moves people between them.

There are no Kubernetes manifests in this repository. An earlier draft of this guide said an
infra/k8s directory existed; it does not, and pointing somebody at a directory that is not
there is worse than saying nothing.

Nothing in the project requires Kubernetes anyway. Compose on two or three machines is
simpler to reason about and to debug at three in the morning, which is the only time the
difference matters.

---

## What to check after any move

Whatever shape you land on, verify the same four things:

```bash
curl -sS https://<your-domain>/api/health          # the API answers
curl -sS https://<your-domain>/api/ready           # it can reach the database
docker compose logs --tail=50 api                  # no restart loop
```

Then, from the repo:

```bash
cd apps/api && npm run test:e2e                    # real HTTP against the running site
```

Point it elsewhere with `E2E_BASE_URL=https://<your-domain>`. It is read-only. If it prints
`NOTHING WAS TESTED`, no server answered — a run where everything skips still exits 0, so
read that banner rather than the exit code.

And restore a backup into a throwaway machine. A backup you have never restored is a
hypothesis, not a backup.
