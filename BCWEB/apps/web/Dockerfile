# Multi-stage: build the Vite SPA, then serve the static bundle with nginx.
# Build context is the BCWEB root (see infra/compose): the app imports the B.MD kit from
# packages/bmd in place, so that folder has to sit two levels above the app, as in the repo.
FROM node:22-alpine AS build
WORKDIR /repo/apps/web
COPY apps/web/package.json ./
RUN npm install
COPY packages/bmd /repo/packages/bmd
# The editor package sits beside the kit and is aliased the same way (vite.config.js).
COPY packages/bmd-editor /repo/packages/bmd-editor
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

FROM nginx:alpine
RUN apk upgrade --no-cache   # patch OS packages (curl, etc.)
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
