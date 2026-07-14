# Hosting users' Docker projects — architecture & plan (FUTURE, not built yet)

*🇫🇷 [Version française](USER_PROJECT_HOSTING_FR.md).*

> Status: **design only.** Nothing here is implemented. This captures the intended
> path so that when we host users' own containerized projects (a mini-PaaS on top of
> the current Server-Repo hosting), we extend the existing seam instead of bolting on
> the wrong tool.

## Goal

Today BCWEB hosts **Server-Repos** (static/JSON payloads on S3, served by the API).
The future add-on: let a user push a **project as a Docker container** (their app /
bot / small service) and we run it, isolated and quota'd, reachable at a URL.

## Do we need Kubernetes? **No.**

- The app itself never needed K8s — vertical scaling + a managed platform cover it
  (see `DEPLOY_EN.md`).
- For running *users'* containers, K8s is also the wrong first tool: it's heavy to
  operate, and — critically — **plain K8s does NOT safely isolate untrusted code**
  (shared kernel → container-escape risk). You'd still need microVM isolation
  (gVisor / Kata / Firecracker) on top. K8s adds a cluster to operate *and* leaves the
  hard problem (isolation) unsolved.
- Our situation fits a single, **vertically-scalable VPS with direct access** far
  better: drive the Docker Engine directly, add nodes only when one box is truly full.

## The seam already exists

`apps/provisioner/src/index.mjs` → **`spinUpRepoContainer(repo)`** is the marked
extension point, and the `ServerRepo` model already carries the quota fields
(`storageQuotaBytes`, `uploadLimitKbps`, `cpuShare`). The provisioner already owns the
"isolation/quota" concern, decoupled from the web API. User-project hosting = making
`spinUpRepoContainer` actually create a container instead of just staking an S3 prefix.

## Recommended architecture (phased)

**Phase 1 — single VPS, Docker Engine API (dockerode).**
- The provisioner talks to the host Docker socket via **dockerode** and, per project:
  creates a container from the user's image (or a built one), on an **internal Docker
  network**, with **hard limits** (`--memory`, `--cpus`/`CpuShares`, `PidsLimit`,
  read-only rootfs where possible, `--cap-drop ALL`, no host mounts, a quota'd named
  volume for its data).
- **Routing:** Caddy's **on-demand TLS + dynamic upstream** maps `project.<domain>`
  (or `/p/<id>`) → the container's internal port. The provisioner registers/removes the
  route as containers come up/down (Caddy admin API or a generated fragment).
- **Lifecycle:** provisioner reconciles DB desired-state (`PROVISIONING` / `ONLINE` /
  `STOPPED`) with actual containers on each tick — the pattern that's already there.

**Phase 1.5 — isolate untrusted code (do BEFORE opening to the public).**
- Run project containers under **gVisor (`runsc`)** or **Kata/Firecracker** so a hostile
  image can't touch the host kernel. This is the single most important security control;
  a normal Docker container is *not* a trust boundary for arbitrary user code.
- Egress firewall (block SMTP/abuse), per-project CPU/mem/pids/disk caps, log/qps caps.

**Phase 2 — multiple nodes, only when one big VPS is full.**
- Use **Nomad** (+ Consul) as the scheduler: dramatically simpler to run than K8s, with a
  first-class "just run these containers/batch jobs across nodes" model that matches this
  use case. The provisioner submits Nomad jobs instead of calling dockerode directly; the
  DB stays the source of truth.
- **Managed Kubernetes** only if this becomes a large multi-tenant platform with a team to
  operate it — and even then, keep the microVM isolation from Phase 1.5.

## What to prepare now (cheap, no new services)

- Keep the provisioner as the **only** thing that touches runtime isolation (already true).
- When implementing Phase 1, put the Docker driver behind a small interface
  (`spinUp/tearDown/reconcile`) so swapping dockerode → Nomad later is a driver change,
  not a rewrite — mirrors how storage is already S3-interface (MinIO → R2) and the DB is a
  pure `.env` swap.
- Size the VPS with headroom; prefer **vertical upgrades** (more CPU/RAM/disk) over a
  second node for as long as possible.

## One-line summary

Extend the **provisioner + Docker Engine API** on a beefy VPS, isolate untrusted
containers with **gVisor/Firecracker**, route via **Caddy dynamic upstreams**, and only
graduate to **Nomad** (not Kubernetes) when you truly need multiple nodes.
