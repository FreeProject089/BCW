# BetterCommunity Discord bot. It always stays up: with no token it idles and polls the API,
# connecting as soon as one is set (env DISCORD_TOKEN, or the admin dashboard — which is the
# point, the token can be set/rotated with no container restart).
# (This used to exit 0 without a token; it hasn't for a while — verified: it logs
#  "will connect when a token is set" and keeps running.)
#
# Base pinned by tag AND digest: node:22.23.3-alpine3.24, the current node:22-alpine on
# 2026-09-25 (same pin as apps/api, apps/provisioner and apps/web; bump them together, see
# apps/api/Dockerfile).

# ── Stage 1: install (npm lives here, and only here) ──
FROM node:22.23.3-alpine3.24@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS deps
WORKDIR /app
# ci, not install: `npm install` re-resolves every `^` range at build time, so two builds of
# the same commit could ship different dependency trees — and it silently ignores the
# lockfile when only package.json is copied. `npm ci` installs the locked tree exactly, and
# fails loudly if the lockfile and package.json ever disagree.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ── Stage 2: the bot runtime (no npm, npx, corepack or yarn) ──
FROM node:22.23.3-alpine3.24@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402
WORKDIR /app
# Patch OS packages (Alpine fixes published after the base image: openssl, libexpat, …) + add
# runtime deps: fontconfig + a font so @napi-rs/canvas can render the welcome banner text.
# Then remove the package managers: the npm bundled with node:22-alpine carried HIGH/CRITICAL
# advisories in its own dependencies (Trivy image, 2026-09-25) and the bot runs `node` only
# (CMD below). apps/api/test/container-images.test.mjs fails if they come back.
RUN apk upgrade --no-cache && apk add --no-cache fontconfig ttf-dejavu \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-v*
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
# Not root at runtime (SECURITY_SUMMARY §9 #10, F10-12). The bot writes nothing to disk (its
# state lives in the API), so no directory needs handing over: node_modules and src stay
# root-owned and read-only to the process.
USER node
CMD ["node", "src/index.mjs"]
