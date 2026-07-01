# Build context = BCWEB root (needs packages/db). See docker-compose.
FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache openssl
# Full install so the `prisma` CLI is available to generate the client.
COPY apps/provisioner/package.json ./package.json
RUN npm install
COPY packages/db ./prisma
COPY apps/provisioner/src ./src
RUN npx prisma generate
CMD ["node", "src/index.mjs"]
