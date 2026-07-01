# Build context = BCWEB root (see docker-compose: context ../.., dockerfile apps/api/Dockerfile).
FROM node:20-alpine
WORKDIR /app

# openssl is needed by the Prisma query engine on alpine/musl.
RUN apk add --no-cache openssl

# Full install (incl. the `prisma` CLI) — needed for generate at build + db push at runtime.
COPY apps/api/package.json ./package.json
RUN npm install

# Schema at the conventional ./prisma so the CLI finds it + this project's package.json.
COPY packages/db ./prisma
COPY apps/api/src ./src
RUN npx prisma generate

EXPOSE 3000
# No committed migrations yet → `db push` syncs the schema straight to Postgres
# (creates all tables). Swap to `migrate deploy` once migrations are committed.
CMD sh -c "npx prisma db push --skip-generate --accept-data-loss; node src/server.mjs"
