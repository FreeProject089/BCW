# bcweb-native

Native (Rust) helpers for the CPU-heavy work that otherwise blocks the Node event loop.
Each function runs on a **worker thread** (napi-rs `AsyncTask`) and returns a Promise, so
the main thread is never blocked — unlike the synchronous `adm-zip` parse it replaces.

Grounded in the [Rust workers plan](../guides/RUST_WORKERS_PLAN_EN.md). This is **P1** of
that plan (ZIP off the event loop + BLAKE3), built and verified.

## Exports (via napi, camelCased in JS)

| JS | What |
|---|---|
| `zipEntries(buf) → Promise<[{name,size}]>` | list a zip's entries |
| `zipReadAll(buf) → Promise<[{name,data:Buffer}]>` | list + inflate non-dir entries (replaces `new AdmZip(buf)` + `getData()`) |
| `blake3Hex(buf) → Promise<string>` | BLAKE3 hex — **internal integrity only**, never the public `sha256` contract |

## It's optional — there's always a JS fallback

The app never imports this crate directly. It goes through
[`apps/api/src/lib/native.mjs`](../apps/api/src/lib/native.mjs), which loads the built
addon if present and otherwise falls back to `adm-zip` / returns `null` for BLAKE3. So a
checkout without the addon runs fine (just on the main thread) — same graceful-degradation
idea as `getRedis()`. `validatePlugin` already routes its zip parse through the wrapper.

## Build

```bash
cd native
npm install          # @napi-rs/cli
npm run build        # → bcweb-native.<platform>.node + index.js + index.d.ts
```

`blake3` uses its **`pure`** feature (no C/ASM) so it builds without a MASM/clang assembler.
The `.node` binary is git-ignored (platform-specific); `index.js` / `index.d.ts` are the
small generated loaders.

Verified on `x86_64-pc-windows-msvc`: `cargo check` + `napi build` succeed; `zipReadAll`
matches `adm-zip` byte-for-byte and `validatePlugin` still verifies packages (see
`apps/api/test/native.test.mjs`, part of the API suite).

## Deploying it (production) — TODO, needs Alpine verification

The runtime image is `node:20-alpine` (musl), so prod needs the addon built for
`x86_64-unknown-linux-musl`. Add a build stage to `apps/api/Dockerfile` and copy the
artifacts next to the app root (the wrapper looks in `../../native` and `../../../native`
relative to `src/lib/`, i.e. `/app/native` or `/app/../native`):

```dockerfile
# ── native addon (built for musl) ──
FROM rust:1-alpine AS native
RUN apk add --no-cache musl-dev nodejs npm
WORKDIR /native
COPY native/ ./
RUN npm install && npx napi build --platform --release

# … in the runtime stage, after COPY apps/api/src ./src :
# COPY --from=native /native/index.js /native/index.d.ts /native/*.node ./native/
```

This isn't wired into the live Dockerfile yet because the musl build hasn't been verified
in this environment, and a failing build stage would break deploys. Until it is, prod runs
the JS fallback (no regression). Verify the stage in a real Alpine build, then enable it.
