# ── Build the React dashboard ───────────────────────────────────────────────
FROM node:24-alpine AS web
WORKDIR /web
# `npm ci` + the lockfile: `npm install` with no lockfile in the image re-resolves every
# `^` range at build time, so the dashboard's dependency tree was decided by whatever npm
# answered that day rather than by the reviewed lockfile (CWE-1357).
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ .
RUN npm run build

# ── Build the Axum server ───────────────────────────────────────────────────
FROM rust:1.93-slim AS server
WORKDIR /app
COPY server/Cargo.toml server/Cargo.lock ./
COPY server/migrations ./migrations
COPY server/src ./src
RUN cargo build --release

# ── Runtime ─────────────────────────────────────────────────────────────────
# distroless/cc (glibc + libgcc + ca-certificates; no shell, no perl, no openssl) — the
# server is a rustls-only Rust binary (sqlx + reqwest use rustls, not openssl), so it needs
# nothing more. Dropping debian-slim removes the passive `perl` package and its unfixed
# CVEs (CVE-2026-12087 etc.) that were never actually reachable here.
#
# `:nonroot` (SECURITY_SUMMARY §9 #10, F10-12): the same image with uid 65532 as the default
# user instead of root. The server writes nothing to disk (Postgres holds its state, the
# dashboard is read from /app/public) and listens on 8900, above 1024, so it needs no
# privilege at all.
# Debian 13 (trixie), not 12, and pinned by digest like every other BCWEB base image.
# - 13: the builder above (`rust:1.93-slim`) is trixie, so the binary links against glibc
#   2.41; a bookworm runtime ships 2.36 and only ran it as long as no newer symbol got used.
#   Bookworm is also on LTS now and its distroless image still carried tzdata 2026b, which
#   turned the security gate red (DLA-4792-1, fixed in 2026c) with no change in this repo.
# - the digest (multi-arch index): a floating tag let the build take whatever distroless
#   published that day. Bump it deliberately, then rescan as security.yml does:
#   `docker buildx imagetools inspect gcr.io/distroless/cc-debian13:nonroot`.
FROM gcr.io/distroless/cc-debian13:nonroot@sha256:54df941ed0d06a1bd95ef5e0ce391fd8d9f94b64782dc9a60062727849ee3f97
WORKDIR /app
COPY --from=server /app/target/release/bmm-telemetry-server /usr/local/bin/bmm-telemetry-server
COPY --from=web /web/dist ./public
ENV STATIC_DIR=/app/public
EXPOSE 8900
# Already the image's default user (:nonroot is uid 65532); written out so a reader, and the
# Dockerfile scanners in .github/workflows/security.yml (Trivy DS-0002, Semgrep missing-user),
# see it without knowing the base image. Changes nothing at runtime.
USER nonroot
CMD ["/usr/local/bin/bmm-telemetry-server"]
