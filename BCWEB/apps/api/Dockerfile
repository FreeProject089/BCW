# Build context = BCWEB root (see docker-compose: context ../.., dockerfile apps/api/Dockerfile).

# ── Stage 1: build the native (Rust) addon for musl — BLAKE3 + off-event-loop zip parsing
# (see native/ and guides/RUST_WORKERS_PLAN). Verified to compile in rust:1-alpine. The app
# falls back to adm-zip if the addon is absent, so this stage is a pure accelerator. ──
FROM rust:1-alpine AS native
RUN apk add --no-cache musl-dev nodejs npm
WORKDIR /native
COPY native/package.json native/package-lock.json ./
RUN npm install --no-audit --no-fund
COPY native/Cargo.toml native/Cargo.lock native/build.rs ./
COPY native/src ./src
COPY native/core ./core
RUN npx napi build --platform --release

# ── The Node base, pinned by tag AND digest (every stage below uses this exact image) ──
# node:22.23.3-alpine3.24, the current node:22-alpine on 2026-09-25. To bump:
#   docker buildx imagetools inspect node:22-alpine   (the Digest line, the index digest)
# and change the tag and digest together in apps/api, apps/bot, apps/provisioner and apps/web.
# A floating `node:22-alpine` meant two builds of one commit could get two different bases,
# and nothing recorded which one production ran.

# ── Stage 2: install and generate (npm lives here, and only here) ──
FROM node:22.23.3-alpine3.24@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS deps
WORKDIR /app
# openssl BEFORE `npm ci`: prisma's postinstall picks the engine build for the openssl it
# finds (linux-musl-openssl-3.0.x), and the runtime stage has the same openssl.
RUN apk add --no-cache openssl
# Full install (incl. the `prisma` CLI) — needed for `generate` below and for
# `migrate deploy` at runtime (boot-migrate.mjs runs the CLI through lib/prisma-cli.mjs).
# `npm ci`, not `npm install`, and the lockfile is COPYed so it means something: with only
# package.json in the image every `^` range was re-resolved at BUILD time, so a compromised
# patch release of any transitive package shipped to production without a lockfile diff to
# review (CWE-1357), and two builds of one commit could differ. Not `--omit=dev`: the
# `prisma` CLI is needed by `generate` below and by boot-migrate.mjs at runtime.
COPY apps/api/package.json apps/api/package-lock.json ./
RUN npm ci --no-audit --no-fund
# Schema at the conventional ./prisma so the CLI finds it + this project's package.json.
COPY packages/db ./prisma
RUN npx prisma generate

# ── Stage 3: the API runtime (no npm, npx, corepack or yarn) ──
FROM node:22.23.3-alpine3.24@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402
WORKDIR /app

# openssl → Prisma query engine on alpine/musl. fontconfig + DejaVu give @napi-rs/canvas
# real fonts so the welcome-banner preview text ("sans-serif") actually renders.
# git → the Advanced Server Management file/DB-edit backup system shells out to
# the real `git` CLI (see gitbackup.mjs) rather than a JS git implementation.
# `apk upgrade` pulls Alpine's security fixes published after the base image (libexpat, which
# git and fontconfig bring in, was one on 2026-09-25).
#
# Then the package managers go. The npm bundled with node:22-alpine carried HIGH/CRITICAL
# advisories in its own dependencies (tar, brace-expansion, cross-spawn, … — Trivy image,
# 2026-09-25) in code the API never runs; and an `npx` in a production container is a way to
# fetch and execute a package nobody reviewed. Nothing at runtime needs them: the prisma CLI
# runs as `node node_modules/prisma/build/index.js` (src/lib/prisma-cli.mjs), and the
# one-off commands are `node src/<script>.mjs` (`docker compose exec api node src/setup.mjs`).
# test/container-images.test.mjs fails if any of this comes back.
RUN apk upgrade --no-cache && apk add --no-cache openssl fontconfig font-dejavu git \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-v*

COPY --from=deps /app/node_modules ./node_modules
COPY apps/api/package.json ./
COPY packages/db ./prisma
COPY apps/api/src ./src
# The studio document package (validateDoc, the same module the web renders with). The API
# imports it by the RELATIVE path it has in the repo, src/lib -> ../../../../packages/studio;
# from /app/src/lib those four steps up end at the filesystem root, so the package sits at
# /packages/studio and the one import line works unchanged here and in a checkout.
COPY packages/studio /packages/studio

# Native addon next to the app root (lib/native.mjs looks in ../../native from src/lib).
# Optional: if this were ever missing the app just uses the JS fallback.
COPY --from=native /native/index.js /native/index.d.ts /native/*.node ./native/

# Not root at runtime (SECURITY_SUMMARY §9 #10, F10-12): an RCE in the API was root in the
# container. Everything above ran as root on purpose (node_modules from the deps stage, where
# npm ci and prisma generate ran; the native copy), so node_modules/ and native/ stay root-owned and READ-ONLY to the process: a
# compromised API cannot rewrite its own dependencies.
#
# What `node` must be able to write, and nothing more:
#   /var/audit     the audit-chain anchor (a named volume; compose's volume-perms one-shot
#                  hands an OLDER, root-owned volume over to uid 1000 before the api starts;
#                  a fresh volume inherits this directory's owner from the image)
#   /app-backups   SERVER_BACKUP_ROOT: git backups of edited files, snapshots, erasures.jsonl
#   /app, src/, prisma/   the admin file manager edits files under FILES_ROOT=/app (behind
#                  the elevated-admin gate); non-recursive on /app itself so node_modules
#                  is not included.
RUN mkdir -p /var/audit /app-backups \
 && chown node:node /app /var/audit /app-backups \
 && chown -R node:node /app/src /app/prisma
USER node

EXPOSE 3000
# Schema management at boot = checked-in migrations via `migrate deploy` (NOT `db push`,
# which can silently drop data on a rename/narrowing). boot-migrate.mjs makes deploy safe
# on every DB state — fresh (applies the baseline), a DB previously synced with db push
# (baselines it so deploy is a no-op, never recreating tables), and already-migrated
# (applies pending migrations). See src/boot-migrate.mjs. `exec` so node REPLACES the
# shell as PID 1 and receives SIGTERM directly — otherwise the shell holds PID 1 and
# swallows the signal, so the API's graceful shutdown never runs and every stop/redeploy
# hard-kills in-flight requests.
# (For Kubernetes, move the migrate step to an initContainer/Job so N replicas don't
#  race the schema sync — see infra/k8s/README.md.)
#
# NODE_OPTIONS caps the V8 old-space heap. Without it V8 sizes the heap from the HOST's
# total RAM (it doesn't read the cgroup limit), so in a memory-limited container it happily
# grows past the limit and gets OOM-killed instead of collecting. 384 MB leaves headroom
# under a 512 MB container for the Prisma query engine + native addon, which live OUTSIDE
# the JS heap. Raise it in tandem with the container's mem_limit.
ENV NODE_OPTIONS="--max-old-space-size=384"
CMD sh -c "node src/boot-migrate.mjs && exec node src/server.mjs"
