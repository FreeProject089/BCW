# BCWEB — Rust workers plan (offloading CPU-heavy work)

*A plan for moving the CPU-bound, event-loop-blocking work in the Node API into a Rust
native module. Grounded in the actual call sites in `apps/api`. 🇫🇷 [Version française](RUST_WORKERS_PLAN_FR.md).
Complements the [performance audit](PERF_AUDIT_EN.md).*

## Why

Node is single-threaded for JS. Today several hot paths do **synchronous, CPU-bound work
on the event loop**, so while they run *nothing else on that instance is served*:

- **`adm-zip` is fully synchronous.** `new AdmZip(buf)` parses the entire archive in one
  blocking call. It runs on **every** upload validation and repackage:
  - `lib/plugin.mjs` — `validatePlugin` (opens the uploaded plugin zip, walks entries).
  - `routes/catalog.mjs` — validate + extract a single entry + repackage on submit/edit.
  - `routes/catalogs.mjs`, `routes/hosting-content.mjs` — catalog/repo file handling.
  A multi-MB zip from one uploader stalls the whole API for the parse duration.
- **Hashing** — ~70 `createHash('sha256')` sites: catalog payload integrity, repo
  fingerprints (`repofingerprint.mjs`), plugin outer hash. SHA-256 in JS is fine for
  small inputs but adds up over large payloads.
- **Compression / archiving** — `archiver` streams zips for repo/catalog exports; gzip on
  various responses.
- **Filesystem scans** — `lib/gitbackup.mjs` walks trees recursively (`repoSizeBytes`,
  `snapshotTree`), and shells out to `git gc`.

The pattern is already established: the API ships **native addons today** — `argon2`
(password hashing) and `@napi-rs/canvas` (image generation). And the **BMM desktop app is
already Rust** (Tauri v2), so a shared crate is realistic.

## The worker's surface

Mirroring the target you sketched, one Rust module exposes:

```
Rust worker  (napi-rs native module, async → off the JS event loop)
 ├─ BLAKE3        hash(bytes) / hash_file(path)      → replaces sha256 where we control both ends
 ├─ zstd          compress(bytes,level) / decompress → replaces gzip for internal artifacts
 ├─ fs scan       walk(root) → [{path,size,mtime,hash?}]  → replaces the recursive readdir walks
 ├─ ZIP           read_entries / extract_one / repackage → replaces adm-zip (off-thread)
 └─ manifest      build_manifest(root|zip) → {files, hashes, sizes, total}
```

- **BLAKE3** is much faster than SHA-256 and parallelises internally. Use it for
  **internal** integrity (payload dedup, backup manifests, cache keys) where BCWEB is both
  producer and consumer. Keep **SHA-256 on the public API contract** (the `catalog.json`
  feed advertises `sha256`, and clients verify it) — don't break that; hash both if needed.
- **zstd** for internal artifacts (backup snapshots, temp payloads). The public download
  format stays whatever clients expect.
- Everything is exposed as **async napi-rs functions** so the work runs on a Rust/libuv
  worker thread, never the JS event loop.

## Architecture — recommended: napi-rs native module

| Option | Verdict |
|---|---|
| **napi-rs native addon** (`.node`) | **Recommended.** Same model as the existing `argon2` / `@napi-rs/canvas` deps; in-process, zero IPC, `Buffer`↔`&[u8]` zero-copy; async tasks run off the event loop. |
| Sidecar binary + IPC (stdin/stdout or a socket) | More moving parts (process mgmt, serialization, backpressure). Only if we want hard isolation or a language boundary. |
| WASM | No threads/filesystem without extra shims; slower than native for this. Not worth it here. |

A single crate `native/` compiled with napi-rs, published as an internal workspace package
(`@bcweb/native`), imported by `apps/api`. Share the core logic with the BMM Tauri app via
a plain Rust crate that both the napi wrapper and Tauri depend on.

## Build & deploy

- **Local dev**: `napi build` produces a platform `.node`; prebuilds per platform so
  contributors don't need a Rust toolchain (napi-rs has this out of the box).
- **Docker (Linux prod)**: build the `.node` in a Rust stage of the API Dockerfile, copy it
  into the runtime image (multi-stage). Cross-compile targets: `x86_64-unknown-linux-gnu`
  (or `-musl` for Alpine). Windows dev target `x86_64-pc-windows-msvc`.
- **Keep a JS fallback** for every function (adm-zip / crypto / readdir) selected at load
  time if the native module is missing — so a build without the addon still runs, degraded.
  Mirrors how `getRedis()` degrades to in-process.

## Phasing

| Phase | Move | Why first / risk |
|---|---|---|
| **P1 ✅ done** | **ZIP off the event loop** — the `native/` crate exposes async `zipReadAll`/`zipEntries` (+ `blake3Hex`); `lib/native.mjs` wraps them with an adm-zip fallback, and `validatePlugin` now parses through it (sha256 stays in JS). Built + verified on Windows AND in Docker (rust:1-alpine → node:20-alpine musl, `hasNative=true` in the container); `native.test.mjs` proves byte-parity with adm-zip. Wired into `apps/api/Dockerfile` as a two-stage build — runs in production. | Biggest event-loop win: a big upload no longer blocks the instance. Behaviour-preserving (byte-parity test). |
| **P1 ✅ done** | **`fs scan`** — `dir_scan(root)` in Rust; wired into `gitbackup.mjs` `repoSizeBytes` (tree walk off the loop). Also `zip_entry` (single extract) + `zip_create` (write) — so the repo export and every zip parse/extract in `catalog.mjs`/`catalogs.mjs`/`hosting-content.mjs` go through the worker; adm-zip now survives only as the JS fallback. | Internal-only, pure CPU/IO, byte-parity tested. |
| **P2 ✅ done** | **zstd** — `zstd_compress`/`zstd_decompress` (C zstd, verified to build for musl), exposed + round-trip tested. No current call site (backups are git-based; no internal blob to compress yet), so it ships as ready infra for future artifacts/manifests, per the format-decision note above. | No external contract. |
| **P2 ✅ done** | **BLAKE3** — `blake3_hex` (async, `pure` feature) exposed + tested for internal integrity (dedup / cache / manifest keys). SHA-256 is untouched on the public `catalog.json` contract. | Client-facing `sha256` untouched. |
| **P3 ✅ done** | **Image resize** — `image_resize_jpeg` (Rust `image` crate, worker thread) wired into the `/media?w=` thumbnail endpoint via `imageThumb` (native JPEG, `@napi-rs/canvas` webp fallback). | Off the main thread. |

## Risks & guardrails

- **Native build in CI/Docker** — add a Rust build stage; cache the cargo registry; the
  existing `secret-scan` / tests jobs are unaffected. Ship prebuilds so `npm ci` on a dev
  box doesn't need Rust.
- **The public `sha256` contract** — the `catalog.json` feed and clients depend on it.
  BLAKE3 is for internal use only; where a value crosses the API boundary, keep SHA-256.
- **Memory** — pass `Buffer`s by reference (napi-rs zero-copy); stream large zips rather
  than materialising them, same as today.
- **Fallback parity** — the JS fallback and the Rust path must produce identical results;
  add a test that runs a fixture zip/hash through both and asserts equality.
- **Don't over-reach** — small hashes (session tokens, a 32-byte fingerprint) stay in
  Node `crypto`; the win is only for the large, blocking payloads above.

## Expected payoff

- The API stops stalling on multi-MB zip parses (the clearest latency spike today).
- Faster hashing/compression on large payloads, off the event loop.
- A shared Rust core with the BMM Tauri app — one implementation of scan/hash/zip/manifest
  for both the desktop client and the server.

## Verdict — implemented

All phases are built, tested, and running in production. The `native/` crate exposes
`zipEntries`/`zipReadAll`/`zipEntry`/`zipCreate`, `dirScan`, `zstdCompress`/`zstdDecompress`,
`imageResizeJpeg`, and `blake3Hex` — all async (worker thread). `lib/native.mjs` wraps each
with a JS fallback, so a checkout without the addon still runs; `native.test.mjs` proves
parity for every one. It builds for Windows and Alpine musl, is wired into the API Dockerfile
(two-stage), and `hasNative=true` in the container. adm-zip now survives only as the wrapper's
fallback. `zstd`/`blake3` are ready infra (no internal call site yet). The obvious next steps,
when needed: a native zip *streaming* writer for very large exports, and sharing the crate's
core with the BMM Tauri app.
