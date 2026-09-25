# Multi-stage: build the Vite SPA, then serve the static bundle with nginx.
# Build context is the BCWEB root (see infra/compose): the app imports the B.MD kit from
# packages/bmd in place, so that folder has to sit two levels above the app, as in the repo.
# Build stage base pinned by tag AND digest (node:22.23.3-alpine3.24, the current
# node:22-alpine on 2026-09-25; the same pin as apps/api, apps/bot and apps/provisioner).
FROM node:22.23.3-alpine3.24@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS build
WORKDIR /repo/apps/web
# `npm ci` against the committed lockfile, like the api and the bot: `npm install` with only
# package.json in the image re-resolved every `^` range at build time, so the bundle every
# visitor runs was built from whatever npm answered that day (CWE-1357).
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY packages/bmd /repo/packages/bmd
# The editor package sits beside the kit and is aliased the same way (vite.config.js).
COPY packages/bmd-editor /repo/packages/bmd-editor
# The studio document package: src/lib/canvas.js, css-scope.js and svg-safe.js re-export it
# by relative path, so it has to be where the repo has it.
COPY packages/studio /repo/packages/studio
COPY apps/web/ ./
# Vite bakes VITE_* vars into the bundle at build time (not readable at runtime),
# so the Google Tag id has to come in as a build arg, not a container env var.
ARG VITE_GTM_ID
ENV VITE_GTM_ID=$VITE_GTM_ID
# Search Console's ownership token, written into the served <head> by vite.config.js
# (verificationTag): Google's HTML-tag check reads the page as served, before any JS runs.
ARG GOOGLE_SITE_VERIFICATION
ENV GOOGLE_SITE_VERIFICATION=$GOOGLE_SITE_VERIFICATION
RUN npm run build

# Served by nginx as an UNPRIVILEGED user (Trivy DS-0002, 2026-09-25). `nginx:alpine` started
# its master process as root; `nginxinc/nginx-unprivileged` is the same nginx built by the
# same maintainers to run entirely as uid 101 (pid file and temp paths under /tmp), which
# means it cannot bind a port below 1024: it listens on 8080 (apps/web/nginx.conf), and every
# consumer says so — infra/caddy/Caddyfile (web_upstream, port 8080), the compose healthcheck,
# and the DAST local instance (.github/workflows/dast.yml). Pinned by tag and digest
# (nginx 1.31.6 on Alpine 3.24, 2026-09-25); to bump:
#   docker buildx imagetools inspect nginxinc/nginx-unprivileged:alpine
FROM nginxinc/nginx-unprivileged:1.31.6-alpine3.24@sha256:6a23acdfca2b9cfbcec61419e3f1426bcbedb91362f2f19306a8567423bb4612
# `apk upgrade` needs root for the time of that one layer (Alpine fixes published after the
# base image: curl, libexpat, …); the image's own user comes straight back.
USER root
RUN apk upgrade --no-cache
USER 101
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
