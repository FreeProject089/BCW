# BCWEB on Kubernetes — future-ready manifests (NOT in use yet)

These files are an **inert starting point**. Nothing here runs today — the live
deployment is Docker Compose (`infra/compose`). Keep it that way until a single
box genuinely stops being enough (see the note at the bottom). This directory
exists so the migration, when it happens, is a *configuration* exercise, not a
rewrite — the app is already 12-factor (env config, stateless API, shared Redis
limiter, storage externalisable to R2).

## What runs where

Do **not** run stateful infra inside the cluster to start with — use managed
services (far less ops than self-hosting Postgres/Redis with PVs + operators):

| Piece            | In cluster? | Recommended                              |
|------------------|-------------|------------------------------------------|
| API (`api`)      | ✅ Deployment + HPA | your image in a registry           |
| Web (`web`)      | ✅ Deployment | static nginx image                      |
| Postgres         | ❌          | managed (Neon / Supabase / RDS)          |
| Redis            | ❌          | managed (Upstash / ElastiCache)          |
| Object storage   | ❌          | Cloudflare R2 (`S3_*` env, already supported) |
| Edge / routing   | ✅          | reuse the **Caddyfile** (see below) or `ingress.yaml` |
| CDN              | in front    | Cloudflare — biggest single win          |

## Files

- `namespace.yaml` — the `bcweb` namespace.
- `secret.example.yaml` — **template only**, same role as `.env.example`. Copy to
  `secret.yaml` (gitignored), fill real values, `kubectl apply`. Never commit real
  secrets. Better: use a managed secret store (External Secrets / SealedSecrets).
- `configmap.yaml` — non-secret runtime config.
- `migrate-job.yaml` — runs `prisma db push` **once** per deploy. In K8s the schema
  sync must NOT live in the API container (N replicas would race it), so the API
  Deployment overrides the image CMD to just `node src/server.mjs` and this Job owns
  the schema. Swap to `prisma migrate deploy` once migrations are committed.
- `api.yaml` — API Deployment (+ Service). Wires the probes and graceful drain that
  already exist in the code: `livenessProbe → /live` (cheap, never restarts on a DB
  blip), `readinessProbe → /ready` (503 pulls the pod from the LB while the DB is
  down). `terminationGracePeriodSeconds: 30` > the app's 10 s drain budget, and a
  `preStop` sleep lets Endpoints deregister before SIGTERM so no request lands on a
  draining pod. `RollingUpdate maxUnavailable: 0` = zero-downtime.
- `web.yaml` — Web Deployment (+ Service).
- `hpa.yaml` — HorizontalPodAutoscaler for the API (CPU-based, 2→8).
- `ingress.yaml` — idiomatic nginx-ingress routing. **Adjust the path prefixes to
  match the Caddyfile** (many prefixes route to the API there).

## Two migration paths for the edge

1. **Pragmatic (recommended first):** deploy the existing `caddy:2-alpine` with your
   current `Caddyfile` as a Deployment + `LoadBalancer` Service. Zero routing to
   re-derive — the file you already trust keeps working. Skip `ingress.yaml`.
2. **Idiomatic:** use `ingress.yaml` with an ingress controller + cert-manager, and
   port the Caddy route table into it.

## Deploy (once you actually need it)

```sh
# build + push your images first (set your registry in the manifests)
kubectl apply -f namespace.yaml
kubectl apply -f configmap.yaml -f secret.yaml   # secret.yaml = your filled copy
kubectl apply -f migrate-job.yaml && kubectl -n bcweb wait --for=condition=complete job/bcweb-migrate --timeout=120s
kubectl apply -f api.yaml -f web.yaml -f hpa.yaml -f ingress.yaml
```

## Don't migrate prematurely

A single 2 vCPU / 4 GB box already serves thousands of concurrent users
(`benchmarks/`); the real ceiling is Postgres connections, solved by the managed
DB + PgBouncer path, not by an orchestrator. If you want managed scaling *without*
running a cluster, **Fly.io / Railway / Render** deploy these same images and give
you ~90 % of the benefit for ~10 % of the ops. Reach for real K8s only when you
need multi-node autoscaling + self-healing — and even then use **managed** K8s
(GKE Autopilot / DO Kubernetes / EKS), never a hand-rolled control plane.
