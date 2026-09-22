# Build context = BCWEB root (needs packages/db). See docker-compose.
FROM node:22-alpine
WORKDIR /app
# `apk upgrade` first, as api/bot/web already do. Without it this image keeps whatever
# package versions the `node:22-alpine` tag was built with — openssl included — so a base
# image published before a distro security fix ships that unfixed package for as long as the
# tag is not rebuilt. This was the only image of the four that skipped it.
RUN apk upgrade --no-cache && apk add --no-cache openssl
# Full install so the `prisma` CLI is available to generate the client.
COPY apps/provisioner/package.json ./package.json
RUN npm install
COPY packages/db ./prisma
COPY apps/provisioner/src ./src
RUN npx prisma generate
CMD ["node", "src/index.mjs"]
