# Multi-stage: build the Vite SPA, then serve the static bundle with nginx.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
# Vite bakes VITE_* vars into the bundle at build time (not readable at runtime),
# so the Google Tag id has to come in as a build arg, not a container env var.
ARG VITE_GTM_ID
ENV VITE_GTM_ID=$VITE_GTM_ID
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
