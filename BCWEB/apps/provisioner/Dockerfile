# Build context = BCWEB root (needs packages/db). See docker-compose.
FROM node:20-alpine
WORKDIR /app
COPY apps/provisioner/package.json ./package.json
RUN npm install --omit=dev
COPY packages/db /packages/db
COPY apps/provisioner/src ./src
RUN npx prisma generate --schema /packages/db/schema.prisma || true
CMD ["node", "src/index.mjs"]
