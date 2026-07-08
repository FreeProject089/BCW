# ── Build the React dashboard ───────────────────────────────────────────────
FROM node:24-alpine AS web
WORKDIR /web
COPY web/package.json ./
RUN npm install
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
FROM gcr.io/distroless/cc-debian12
WORKDIR /app
COPY --from=server /app/target/release/bmm-telemetry-server /usr/local/bin/bmm-telemetry-server
COPY --from=web /web/dist ./public
ENV STATIC_DIR=/app/public
EXPOSE 8900
CMD ["/usr/local/bin/bmm-telemetry-server"]
