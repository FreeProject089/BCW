# Build context = BCWEB root (see docker-compose: context ../.., dockerfile apps/api/Dockerfile),
# so we can pull in the shared packages/db Prisma schema.
FROM node:20-alpine
WORKDIR /app

COPY apps/api/package.json ./package.json
RUN npm install --omit=dev

# Shared Prisma schema at /packages/db -> matches the "../../packages/db" the
# package.json scripts use from WORKDIR /app (/app/../.. = /).
COPY packages/db /packages/db
COPY apps/api/src ./src
RUN npx prisma generate --schema /packages/db/schema.prisma || true

EXPOSE 3000
CMD sh -c "npx prisma migrate deploy --schema /packages/db/schema.prisma || true; node src/server.mjs"
