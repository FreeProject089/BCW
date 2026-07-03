# BetterCommunity Discord bot. Boots only when DISCORD_TOKEN is provided; otherwise
# it exits 0 cleanly (so the stack still comes up without a token during dev).
FROM node:20-alpine
WORKDIR /app
# fontconfig + a font so @napi-rs/canvas can render the welcome banner text.
RUN apk add --no-cache fontconfig ttf-dejavu
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src
CMD ["node", "src/index.mjs"]
