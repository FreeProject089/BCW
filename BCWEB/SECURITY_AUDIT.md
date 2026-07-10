# Security / CWE Audit — 2026-07-03

Scope: BCWEB (Fastify API + Discord bot + React web), BMM (Tauri/Rust desktop app), BetterInstaller (Rust). Focus on the OWASP/CWE classes that actually apply to this stack: injection (SQL/command), path traversal (CWE-22), SSRF (CWE-918), auth/authorization gaps (CWE-285/287), secrets exposure (CWE-798), and archive extraction (zip-slip).

**Headline: no high-severity issues found.** The load-bearing danger spots are already defended, mostly with the right patterns and explaining comments. A few low-severity / defense-in-depth notes below.

---

## Reviewed and found SAFE

### SQL injection (CWE-89) — DB viewer raw SQL
`server-control.mjs` uses `$queryRawUnsafe`/`$executeRawUnsafe` for the admin DB viewer (table/column names can't be bound parameters). **Not injectable**: every table name is checked against `pg_class` and every column name against `information_schema.columns` *before* interpolation, sort direction is whitelisted to ASC/DESC, and all values are passed as bound `$1/$2` parameters. The whole surface is behind the `DANGEROUS` preHandler (session + `canControlServer` + step-up 2FA elevation), and sensitive columns (`password/secret/token/hash/totp`) are refused. Correctly built.

### Command injection (CWE-78) — git backup
`gitbackup.mjs` shells to the real `git` via `execFile('git', [...args])` — array arguments, no shell, so no metacharacter injection. Repo root is a fixed container path. Safe.

### Path traversal (CWE-22)
- File manager (`server-control.mjs`): `safePath()` resolves the user path against `FILES_ROOT` and rejects anything that doesn't stay within it (`resolved === root || resolved.startsWith(root + sep)`). Confined to the container's own FS, no host mount / Docker socket.
- Archive extraction (`src-tauri/src/archive.rs`): uses the zip crate's `enclosed_name()`, which returns `None` for any entry that would escape the target dir — the correct zip-slip defense — and skips those entries.

### SSRF (CWE-918)
`net.mjs`'s `safeFetch()` is used for every user-influenced outbound fetch (plugin/repo URLs, admin project sources, Ko-fi has no outbound). It: allows only http/https, resolves the hostname via DNS and blocks private/loopback/link-local/CGNAT/multicast ranges (incl. `169.254.169.254` cloud metadata), blocks `localhost`/`*.local`/`*.internal`, and **re-checks every redirect hop manually** so a public URL can't 30x-bounce inward. Strong.

### Secrets (CWE-798)
`infra/compose/.env.example` no longer contains any real secret — the previously-committed live Discord token is gone (field is blank), and the only non-placeholder value is `S3_ACCESS_KEY=bcweb-minio` (a non-sensitive MinIO username default). Server refuses to boot in production on the default `JWT_SECRET` (fail-safe in `server.mjs`).

### Authorization (CWE-285)
Admin-tier routes go through `requireRole()`, which additionally requires `totpEnabled` for MOD/ADMIN/SUPERADMIN (2FA-gated admin surface). Server-control ("Advanced server management") layers `canControlServer` + a separate short-lived step-up elevation cookie on top, plus double-confirm tokens on destructive file/DB writes. OAuth login (new) uses HMAC-signed, time-bound `state` for CSRF and only trusts provider-verified emails.

---

## Low-severity / defense-in-depth notes

1. **Ko-fi webhook token comparison is not constant-time** (`routes/kofi.mjs`): `payload.verification_token !== expected` is a plain string compare. Timing side-channel is negligible over the network for a random shared token, but for hygiene it could use `crypto.timingSafeEqual`. *Severity: informational.*

2. **SSRF DNS-rebinding TOCTOU** (`net.mjs`): the hostname is resolved for the check, then `fetch()` resolves it again independently — a hostile DNS server could return a public IP to the check and a private IP to the fetch. Pinning the vetted IP would close it, but Node's `fetch` doesn't expose per-request resolution easily; the current approach matches common practice and the risk requires attacker-controlled DNS + precise timing. *Severity: low.*

3. **VBS launcher escaping** (`src-tauri/src/mcp/tools/launch_packs.rs`): the launch-pack builder writes user-chosen exe paths into a `.vbs` with only `"`→`""` escaping and into a PowerShell `.lnk` script with `'`→`''` escaping (the correct escapes for each context). The input is the *local user's own* selected executables (they're building their own launcher from their own files), not a remote/other-user surface, so the trust boundary isn't crossed. Left as-is; noted for awareness if launch-pack definitions ever become shareable/importable from untrusted sources. *Severity: low, context-dependent.*

## BetterInstaller

BetterInstaller now HAS code (a Rust workspace under `BetterInstaller/crates`, contrary to the older "no code yet" note). A quick pass shows the same defensive patterns as BMM (Tauri/Rust idioms). No injection or traversal issues surfaced in the spot-check, but it wasn't audited in the same depth as BCWEB/BMM here — recommend a dedicated pass before its first public release, focused on: the download/verify pipeline (signature/hash checking of fetched artifacts), the handoff contract with BMM, and any elevation/UAC path.

## Remediation (applied 2026-07-03)

- **Constant-time secret comparisons — DONE.** Added `safeEqual()` in `apps/api/src/lib.mjs` (sha256 both sides → `crypto.timingSafeEqual`, length-safe, never throws) and applied it everywhere a shared secret / signature was compared with `===`/`!==`: the Ko-fi webhook `verification_token` (`routes/kofi.mjs`), the bot shared secret `x-bot-secret` (`routes/bot.mjs`), the proof-of-work HMAC signature (`routes/auth.mjs`), and the OAuth `state` CSRF HMAC (`routes/oauth.mjs`). This closes the timing side-channel for all of them.
- **DB-viewer audit-table protection — DONE** (separate hardening pass): `AuditLogEntry`/`LoginAttempt`/`RepoAuditLog` are read-only in the viewer; edit/restore attempts are refused and logged.
- **SSRF DNS-rebind TOCTOU — accepted/low.** `safeFetch` resolves + blocks private ranges and re-checks every redirect hop. The residual rebind gap (check-then-fetch resolve independently) is inherent to Node's `fetch`, which doesn't expose per-request IP pinning; the risk requires an attacker-controlled DNS server *and* precise timing, and matches common practice. Documented, not changed.
- **Launch-pack VBS/PS escaping — no change.** Local user's own files only (not a remote/other-user surface); the `"`→`""` / `'`→`''` escapes are correct for their contexts. Revisit only if launch-pack definitions ever become shareable/importable from untrusted sources.
- **Committed Discord token — dropped from the local branch.** The live token had been committed in `infra/compose/.env.example` since the initial commit and later re-flagged by GitHub push protection (GH013) at commit `122d96c`. All local unpushed history was squashed into a single clean `v1` commit built from the current tree, in which `DISCORD_TOKEN=` is empty and no token appears in the pushable range. *Residual:* the token may still exist in the ALREADY-PUSHED remote history (below the squash base) — that requires a remote history rewrite to purge — and **the token itself must still be rotated in the Discord Developer Portal** regardless.
- **Per-element / per-account BC ids — not a secret.** The `BC-`/`BCR-`/`BCI-XXXX-XXXX` ids are HMAC-SHA256(JWT_SECRET, account/element material) truncated to a short base32 code. They're opaque support references (reveal nothing about the underlying ids) and the admin lookup recomputes them server-side; no reversibility or enumeration risk of concern.

## Recommendation summary

| Item | Severity | Status |
|---|---|---|
| DB viewer raw SQL | — | Safe (+ audit tables now read-only) |
| git/exec, path traversal, zip-slip, SSRF, secrets, authz | — | Safe |
| Ko-fi / bot / PoW / OAuth secret compares | Info | **Fixed — constant-time** |
| SSRF DNS-rebind TOCTOU | Low | Accepted (Node fetch limitation, documented) |
| Launch-pack VBS/PS escaping | Low | Fine for local-only input |
| BetterInstaller | — | Dedicated pre-release audit of download/verify + handoff |

---

# Re-audit — 2026-07-08 (analytics/telemetry surfaces + Docker images)

Second pass focused on the code added since (analytics ingest, session/geo endpoints, the
BMM telemetry service linked to BCWEB) plus a container CVE scan.

## Fixed

- **CWE-208 — timing-unsafe key compare (telemetry).** `X-Admin-Key` / `?key=` /
  `?admin_key=` and the ingest `api_key` were compared with `==`, which short-circuits on
  the first differing byte (leaks the secret prefix via timing). Added a constant-time
  `ct_eq()` and routed every key check through it (`main.rs`), matching the HMAC BC-token
  path which was already constant-time.
- **CWE-639 — IDOR in comment edit-history** (`/{blog,docs}/:id/comments/:cid/history`):
  now verifies the comment belongs to the post/page before returning revisions.
- **CWE-770 — rate limits** added per-route to the unauthenticated analytics ingest
  (pageview/vital/replay) on top of the global limiter.
- **Docker CVEs** (`docker scout`): telemetry → `distroless/cc` (dropped the unreachable
  `perl` critical/highs → **0 vulns**); bot `openssl` CRITICAL → patched via `apk upgrade`.
- **CSP**: MapLibre worker via `worker-src 'self' blob:` instead of widening `script-src`.

## Reviewed — safe

- Telemetry `format!("… FROM {table}")` interpolates only **hardcoded** table arrays — no
  user input → not injectable. Telemetry SQL is otherwise sqlx-parameterized.
- Analytics ingest is bounded by zod; the admin analytics/geo/sessions/vitals endpoints are
  all `requireRole('ADMIN')`. Session identities shown on the map are anonymous (derived
  from the daily-rotating visitor hash), never real accounts.
- `devRealGeo` outbound lookup uses hardcoded hosts (ipify/ifconfig) — no SSRF.

## Open recommendations

| Item | Severity | Status |
|---|---|---|
| Telemetry runs open when `ADMIN_KEY`/`API_KEY` unset | Medium | Dev-only + Caddy `forward_auth` in prod; add a prod guard or ensure keys always set |
| Live Discord token in pushed history | High | **Rotate in the Discord Developer Portal** (unchanged since first audit) |
| Residual Docker CVEs (alpine curl / debian perl / bundled npm tar) | Low | Unfixed upstream or non-runtime-reachable bundled tooling; re-scan after base-image refresh |
| CSRF via per-request tokens on mutations | Low | `sameSite=lax` already blocks standard cross-site cases |

# Re-audit — 2026-07-10 (2FA authenticator, payments/embeds, webhook)

## Fixed / hardened

- **CWE-312 — cleartext storage of secrets (local 2FA authenticator, `twofa.jsx` /
  `twofa-lib.js`)**: the local TOTP vault (localStorage) now supports **optional
  passphrase encryption at rest** (AES-256-GCM, PBKDF2-SHA256 210k iters, random
  salt+IV per write). Exports can likewise be encrypted. Fully offline — the page
  imports no network client; codes are computed with Web Crypto.
- **CWE-400 — uncontrolled resource consumption (2FA import / QR)**: `parseOtpauth`
  and `sanitizeAccount` clamp every field from untrusted QR/import input — `digits`
  6–8, `period` 15–120, algorithm whitelisted, secret/label/issuer length-capped —
  so a crafted `digits: 99999` can no longer blow up `10**digits`/`padStart`. QR is
  decoded locally with jsQR off a canvas (no upload, no third-party network).
- **CWE-79 / content injection (Discord payment embeds, `payments.mjs`)**:
  user-controlled display name + description are markdown-stripped and length-capped
  before entering the embed, so a crafted name can't inject links/formatting into the
  announcement channel. Customer emails are masked.
- **Stripe webhook robustness**: raw-body parser scoped to `/hosting/webhook` (+ a
  `/webhook` alias) verifies the signature against exact bytes; the endpoint 503s
  (records nothing) if `STRIPE_WEBHOOK_SECRET` is unset. An admin diagnostic surfaces
  the Stripe-key / webhook-secret state so a misconfigured deploy is obvious rather
  than silently swallowing checkouts.
- **Promo assignment (`promo.mjs`)**: `assignmentMatches()` resolves typed assignment
  tokens (email / discord / creator / bcid) against the redeeming account's *own*
  verified identifiers at redeem time — an attacker can't satisfy a gift code they
  don't actually own; redemption stays atomic (Serializable tx, DB-side cap).
- **Giveaway entry gate (`bot.mjs`)**: linked-account / creator-id requirements are
  enforced server-side on `/bot/giveaways/:id/enter` (the Discord button can't be
  trusted); bot-facing endpoints stay behind `x-bot-secret` (constant-time compare).

## Reviewed — safe

- The 2FA authenticator makes **zero network calls** (verified: `twofa.jsx` imports
  only `i18n`/`ui`/`twofa-lib`). Secrets never leave the device. Camera QR requires a
  secure context; the stream is stopped on unmount/stop (no leak).
- Bot `/bot/payments/:id/invoice` (botAuth) returns Stripe's own no-auth
  `invoice_pdf` URL only — no arbitrary URL passthrough, ownership implied by the
  Payment→session lookup.
- `/admin/billing/users?q=` and `/admin/bot/members?q=` pass the query to Prisma
  `contains` (parameterized) — no injection; both are `requireRole`-gated.

## Open recommendations (unchanged)

- **Rotate the live Discord token** in the Developer Portal — still outstanding.
- Ensure telemetry `ADMIN_KEY`/`API_KEY` are always set in production (Caddy
  `forward_auth` covers the edge).

# Re-audit — 2026-07-10b (fixing the open items + a fresh sweep)

## Fixed

- **CWE-306 — telemetry ingest open when `API_KEY` unset** (was the standing Medium
  "runs open"): `okKey` now **fails closed in production** — `cfg.API_KEY ? k === cfg.API_KEY : !IS_PROD`. With `NODE_ENV=production` and no `API_KEY`, ingest is rejected
  (401) instead of accepting everything, and the server logs a loud SECURITY warning
  at boot. Dev keeps keyless ingest for convenience. (`bmm/telemetry-dashboard/server.mjs`)
- **CWE-22 — path traversal in the git-backed backups** (defense-in-depth behind the
  elevated-admin gate): added a central `safeJoin(repoRoot, relPath)` in
  `gitbackup.mjs` that resolves the caller path and refuses anything escaping the repo
  root. Wired into `backupFile`, `fileHistory`, and `fileAtCommit`; `fileAtCommit` also
  validates the commit `hash` is hex before `git show <hash>:<path>`. So a crafted
  `table`/`pk`/`hash` on the DB-viewer backup/restore endpoints can no longer read or
  write outside `/app-backups`.

## Reviewed — safe (this sweep)

- **DB viewer SQL** (`server-control.mjs` `$queryRawUnsafe`): table names validated
  against `pg_class`, sort/edit columns against `information_schema.columns`, pk column
  from `singlePkColumn()` — all identifier-allowlisted before interpolation; row values
  are parameterized (`$1/$2`). Sensitive/log tables blocked (`PROTECTED_TABLES`,
  `SENSITIVE_COL`). Not injectable.
- **Bot payment PDF** (`/bot/payments/:id/invoice`, botAuth): returns only Stripe's own
  no-auth `invoice_pdf` URL for a Payment the caller looked up — no arbitrary-URL
  passthrough, no SSRF.
- No `$queryRawUnsafe`/`fetch(<user-url>)`/user-path `readFile` found elsewhere in the
  API. Telemetry CORS is `*` with **no credentials** (a public ingest sink) — not a
  CWE-942 credentialed-reflection case.

## Open recommendations (still user-action, not code)

- **Rotate the live Discord token** in the Developer Portal — outstanding.
- Residual upstream Docker base-image CVEs — re-scan after a base refresh.
- CSRF: `sameSite=lax` blocks cross-site POST (the cookie isn't sent), so mutations are
  already protected without per-request tokens; revisit only if a state-changing GET is
  ever added.

# Re-audit — 2026-07-10c (perf/infra layer + docs/env pass)

## Fixed

- **CWE-284 — access-control bypass via shared caches (hosted downloads & repo.json)**:
  the perf pass had added `Cache-Control: public` to `/hosting/:owner/:repo/files/*`
  (and `repo.json` already shipped `public, max-age=60`) even though both routes
  enforce PER-REQUESTER access (`sandboxGate`: IP/key/account bans + whitelist mode +
  global/owner policies). A CDN or shared proxy would have served the cached copy to
  banned / non-whitelisted requesters, straight around the gate. New `repoRestricted()`
  helper: any restriction ⇒ `Cache-Control: private, no-store` (and no ETag); only
  truly open repos are shared-cacheable. Found by auditing our own new code.
- **Telemetry ingest**: the compose telemetry service now pins `NODE_ENV=production`,
  so the 2026-07-10b fail-closed guard actually engages if `TELEMETRY_API_KEY` is ever
  blanked (harmless in dev — the key is always set by compose defaults).

## Reviewed — safe (this sweep)

- **cache.mjs / redis.mjs**: cache keys are fixed strings (no user input → no cache-key
  injection); cached values are the visitor-independent public payloads only
  (`/showcase` filters to public/announcing INSIDE the producer; `/kofi/stats` is a
  public aggregate). Nothing per-session is ever cached. Redis holds only this public
  cache + rate-limit counters — no secrets.
- **Redis exposure**: the `redis` service publishes no ports (compose-network only).
  Note: no AUTH configured — acceptable while unexposed; set `requirepass` if it is
  ever published or the network is shared.
- **PgBouncer profile**: opt-in, internal-only, `AUTH_TYPE=scram-sha-256`; Prisma
  `directUrl` keeps migrations off the pooler. No new exposure by default (profile
  disabled unless requested).
- **Caddy `/assets/*` immutable header**: static, content-hashed files only; the HTML
  shell stays no-cache (deploy freshness).
- **S3 endpoint/region now env-driven**: same defaults as the previous hardcoded
  values; R2 migration is config-only. `.env.example` verified to contain placeholders
  only (no live secrets; `DISCORD_TOKEN` is blank).

## Open recommendations

- Rotate the live Discord token (unchanged — user action).
- If Redis is ever exposed beyond the compose network, add `requirepass` and point
  `REDIS_URL` at `redis://:pass@redis:6379`.
