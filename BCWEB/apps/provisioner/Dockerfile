# Build context = BCWEB root (needs packages/db). See docker-compose.
FROM node:22-alpine
WORKDIR /app
# `apk upgrade` first, as api/bot/web already do. Without it this image keeps whatever
# package versions the `node:22-alpine` tag was built with — openssl included — so a base
# image published before a distro security fix ships that unfixed package for as long as the
# tag is not rebuilt. This was the only image of the four that skipped it.
RUN apk upgrade --no-cache && apk add --no-cache openssl
# Full install so the `prisma` CLI is available to generate the client.
# `npm ci` against the committed lockfile, like api/bot/web: `npm install` with only
# package.json re-resolved every `^` range at build time, so two builds of one commit could
# ship different trees and a compromised patch release landed with no diff to review
# (CWE-1357). ci fails loudly if the lockfile and package.json disagree.
COPY apps/provisioner/package.json apps/provisioner/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY packages/db ./prisma
COPY apps/provisioner/src ./src
RUN npx prisma generate
# Not root at runtime (SECURITY_SUMMARY §9 #10, F10-12). The provisioner talks to Postgres
# and S3 only and writes nothing to disk, so everything stays root-owned and read-only to it.
USER node
CMD ["node", "src/index.mjs"]
