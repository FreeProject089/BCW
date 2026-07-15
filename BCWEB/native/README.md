# bcweb-native

Native (Rust) helpers for the CPU-heavy work that otherwise blocks the Node event loop.
Each function runs on a **worker thread** (napi-rs `AsyncTask`) and returns a Promise, so
the main thread is never blocked — unlike the synchronous `adm-zip` parse it replaces.

Grounded in the [Rust workers plan](../guides/audits/RUST_WORKERS_PLAN_EN.md). This is **P1** of
that plan (ZIP off the event loop + BLAKE3), built and verified.

## Exports (via napi, camelCased in JS)

| JS | What |
|---|---|
| `zipEntries(buf) → [{name,size}]` | list a zip's entries |
| `zipReadAll(buf) → [{name,data:Buffer}]` | list + inflate non-dir entries (replaces `new AdmZip(buf)` + `getData()`) |
| `zipEntry(buf, name) → Buffer\|null` | extract ONE entry (replaces `getEntry(name).getData()`) |
| `zipCreate([{name,data}]) → Buffer` | build a deflate zip (replaces `new AdmZip()` + `addFile` + `toBuffer`) |
| `dirScan(root) → [{path,size}]` | recursive file listing (relative, forward-slashed) |
| `zstdCompress(buf,level)` / `zstdDecompress(buf) → Buffer` | zstd for **internal artifacts** only |
| `imageResizeJpeg(buf,width,q) → Buffer\|null` | downscale a raster → JPEG (null = don't upscale) |
| `blake3Hex(buf) → string` | BLAKE3 hex — **internal integrity only**, never the public `sha256` contract |

All are async (Promise) — they run on a worker thread. `lib/native.mjs` wraps them
(`zipEntries`/`zipReadAll`/`zipEntry`/`zipCreate`/`dirScan`/`imageThumb`/`zstd*`/`blake3Hex`)
with a JS fallback so a build without the addon still works.

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

## Production — wired + verified

`apps/api/Dockerfile` is a two-stage build: a `rust:1-alpine` `native` stage runs
`napi build`, and the runtime `COPY --from=native` drops the musl `.node` + loaders at
`/app/native` (the wrapper looks in `../../native` relative to `src/lib/`). Verified
end-to-end: the addon compiles for `x86_64-unknown-linux-musl` and loads in the
`node:20-alpine` runtime — a container reports `hasNative=true` and runs BLAKE3/zip on a
worker thread. If the addon were ever absent, the app still runs on the JS fallback (no
regression).

Note: napi's generated `index.js` musl probe can mis-resolve, so `lib/native.mjs` tries
`index.js` first and then falls back to `require`-ing the `.node` directly.
