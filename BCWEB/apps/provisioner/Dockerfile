# Build context = BCWEB root (needs packages/db). See docker-compose.
#
# Base pinned by tag AND digest: node:22.23.3-alpine3.24, the current node:22-alpine on
# 2026-09-25 (same pin as apps/api, apps/bot and apps/web; bump them together, see
# apps/api/Dockerfile).

# ── Stage 1: install and generate (npm lives here, and only here) ──
FROM node:22.23.3-alpine3.24@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS deps
WORKDIR /app
# openssl before `npm ci`: prisma's postinstall picks its engine build from the openssl it finds.
RUN apk add --no-cache openssl
# Full install so the `prisma` CLI is available to generate the client.
# `npm ci` against the committed lockfile, like api/bot/web: `npm install` with only
# package.json re-resolved every `^` range at build time, so two builds of one commit could
# ship different trees and a compromised patch release landed with no diff to review
# (CWE-1357). ci fails loudly if the lockfile and package.json disagree.
COPY apps/provisioner/package.json apps/provisioner/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY packages/db ./prisma
RUN npx prisma generate

# ── Stage 2: the provisioner runtime (no npm, npx, corepack or yarn) ──
FROM node:22.23.3-alpine3.24@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402
WORKDIR /app
# `apk upgrade` first, as api/bot/web already do. Without it this image keeps whatever
# package versions the base image was built with — openssl included — so a base image
# published before a distro security fix ships that unfixed package until the pin is bumped.
# Then the package managers go: the npm bundled with node:22-alpine carried HIGH/CRITICAL
# advisories in its own dependencies (Trivy image, 2026-09-25), and the provisioner runs
# `node` only (CMD below). apps/api/test/container-images.test.mjs fails if they come back.
RUN apk upgrade --no-cache && apk add --no-cache openssl \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-v*
COPY --from=deps /app/node_modules ./node_modules
COPY apps/provisioner/package.json ./
COPY packages/db ./prisma
COPY apps/provisioner/src ./src
# Not root at runtime (SECURITY_SUMMARY §9 #10, F10-12). The provisioner talks to Postgres
# and S3 only and writes nothing to disk, so everything stays root-owned and read-only to it.
USER node
CMD ["node", "src/index.mjs"]
