# Multi-stage: build the Vite SPA, then serve the static bundle with nginx.
# Build context is the BCWEB root (see infra/compose): the app imports the B.MD kit from
# packages/bmd in place, so that folder has to sit two levels above the app, as in the repo.
FROM node:22-alpine AS build
WORKDIR /repo/apps/web
COPY apps/web/package.json ./
RUN npm install
COPY packages/bmd /repo/packages/bmd
COPY apps/web/ ./
# Vite bakes VITE_* vars into the bundle at build time (not readable at runtime),
# so the Google Tag id has to come in as a build arg, not a container env var.
ARG VITE_GTM_ID
ENV VITE_GTM_ID=$VITE_GTM_ID
RUN npm run build

FROM nginx:alpine
RUN apk upgrade --no-cache   # patch OS packages (curl, etc.)
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
