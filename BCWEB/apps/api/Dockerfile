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

# ── Stage 2: the API runtime ──
FROM node:22-alpine
WORKDIR /app

# openssl → Prisma query engine on alpine/musl. fontconfig + DejaVu give @napi-rs/canvas
# real fonts so the welcome-banner preview text ("sans-serif") actually renders.
# git → the Advanced Server Management file/DB-edit backup system shells out to
# the real `git` CLI (see gitbackup.mjs) rather than a JS git implementation.
RUN apk upgrade --no-cache && apk add --no-cache openssl fontconfig font-dejavu git

# Full install (incl. the `prisma` CLI) — needed for `generate` at build and for
# `migrate deploy` at runtime (boot-migrate.mjs shells out to the CLI).
COPY apps/api/package.json ./package.json
RUN npm install

# Schema at the conventional ./prisma so the CLI finds it + this project's package.json.
COPY packages/db ./prisma
COPY apps/api/src ./src
RUN npx prisma generate

# Native addon next to the app root (lib/native.mjs looks in ../../native from src/lib).
# Optional: if this were ever missing the app just uses the JS fallback.
COPY --from=native /native/index.js /native/index.d.ts /native/*.node ./native/

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
