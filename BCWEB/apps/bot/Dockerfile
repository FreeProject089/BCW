# BetterCommunity Discord bot. It always stays up: with no token it idles and polls the API,
# connecting as soon as one is set (env DISCORD_TOKEN, or the admin dashboard — which is the
# point, the token can be set/rotated with no container restart).
# (This used to exit 0 without a token; it hasn't for a while — verified: it logs
#  "will connect when a token is set" and keeps running.)
FROM node:22-alpine
WORKDIR /app
# Patch OS packages (pulls fixed openssl 3.5.7-r0 etc.) + add runtime deps: fontconfig +
# a font so @napi-rs/canvas can render the welcome banner text.
RUN apk upgrade --no-cache && apk add --no-cache fontconfig ttf-dejavu
# ci, not install: `npm install` re-resolves every `^` range at build time, so two builds of
# the same commit could ship different dependency trees — and it silently ignores the
# lockfile when only package.json is copied. `npm ci` installs the locked tree exactly, and
# fails loudly if the lockfile and package.json ever disagree.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY src ./src
CMD ["node", "src/index.mjs"]
