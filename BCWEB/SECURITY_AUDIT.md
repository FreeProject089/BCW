# Security / CWE Audit — 2026-07-03

> **Re-verified 2026-07-13** — remediations still in place after the `src` reorg (shared api
> services moved to `apps/api/src/lib/`, so `safeEqual` now lives in `apps/api/src/lib/lib.mjs`,
> `safeFetch` in `lib/net.mjs`, git backup in `lib/gitbackup.mjs`; routes unchanged). The
> July analytics additions (Web Vitals breakdowns, events feed, error tracking, goals) were
> reviewed the same day: SQL uses whitelisted identifiers + bound params (no injection), the
> admin routes are `requireRole('ADMIN')`, ingestion is consent-gated + rate-limited + bounded,
> React escapes all rendered error/stack/label text, and CSV exports go through `csvCell`
> (CWE-1236). No new high-severity issues.

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

- **Constant-time secret comparisons — DONE.** Added `safeEqual()` in `apps/api/src/lib/lib.mjs` (sha256 both sides → `crypto.timingSafeEqual`, length-safe, never throws) and applied it everywhere a shared secret / signature was compared with `===`/`!==`: the Ko-fi webhook `verification_token` (`routes/kofi.mjs`), the bot shared secret `x-bot-secret` (`routes/bot.mjs`), the proof-of-work HMAC signature (`routes/auth.mjs`), and the OAuth `state` CSRF HMAC (`routes/oauth.mjs`). This closes the timing side-channel for all of them.
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

---

# Re-audit — 2026-08-22 (request logging, OIDC, webhooks, uploads, rate limit)

One HIGH finding, fixed. Everything else in scope was re-verified and is clean.

## Fixed: the API logged private share keys and repo passwords on every request

**CWE-532, high.** `Fastify({ logger: true })` uses the default request serialiser, which
writes `req.url` **raw**. On this API the query string is sometimes the credential:

- `/r/<id>?k=<shareKey>` is how a private repo is shared.
- `?password=` is an accepted alternative to the `X-Repo-Password` header for repo sync
  (`presentedPassword`, `apps/api/src/routes/hosting-content.mjs`).

So every hit on a private link wrote a live secret to stdout at level 30 — on the normal
path, not on an error — and stdout is what gets shipped to a log pipeline. Anyone able to
read those logs could replay the link or the password.

Found by running it, not by reading it. A request carrying canary values produced:

```
{"level":30,"req":{"url":"/r/…?k=LEAKCANARY123&password=PWCANARY456"},"msg":"incoming request"}
```

and after the fix:

```
{"level":30,"req":{"url":"/r/…","queryKeys":["k","password"]},"msg":"incoming request"}
```

with zero canary hits left in the log. A custom `serializers.req` keeps what the default
gives (method, host, remote address) and replaces `url` with the path. Key **names** are
kept: knowing a request carried `k` helps when reading a log; knowing its value is the
breach.

Two related things in the same commit:

- The 500 handler logged `req.url` raw as well, while `recordServerError` right beside it
  already stripped the query — one rule written twice, disagreeing, so the same request
  produced a sanitised `ErrorEvent` row and an unsanitised log line. `pathOnly` is exported
  from `lib/errorlog.mjs` now and both use it.
- The house rule this broke ("never log a raw request URL server-side") held everywhere it
  was applied by hand, and failed where a framework default did the logging instead. Worth
  remembering as a class, not as one bug.

## Re-verified and found SAFE

Listed so a later pass knows what is already covered.

| Surface | What was checked | Result |
|---|---|---|
| Stripe webhook | `constructEvent(rawBody, sig, secret)`; behaviour with no secret configured | Verified; **fails closed** with 503 rather than processing unsigned events |
| OIDC `redirect_uri` | exact match against `client.redirectUris`, checked *before* any redirect; re-checked at token exchange; `post_logout_redirect_uri` allowlisted | Safe |
| OIDC PKCE | required for public clients (`!confidential && !challenge` → `invalid_request`); `code_challenge_method` forced to S256 | Safe |
| OIDC client auth | `safeEqual(sha256(secret), client.secretHash)` | Constant-time |
| OIDC code reuse | single-use claimed atomically: `updateMany({ where: { code, usedAt: null } })` | Race-safe |
| Code webhook | HMAC with `safeEqual`; a project with no secret is **refused**, never accepted unsigned | Safe |
| Session cookies | `httpOnly`, `sameSite: lax`, `secure` from `COOKIE_SECURE`, scoped path | Safe |
| Presigned uploads | key = `<prefix>/<randomUUID()>-<safe>`, where `safe` is `filename.replace(/[^a-zA-Z0-9._-]/g,'_')` — no separators survive | No traversal |
| Media proxy `/media/*` | `blog/` prefix only, `..` rejected, `nosniff` + sandbox CSP + Content-Disposition so an uploaded SVG cannot execute on our origin | Safe |
| SSRF | every `fetch()` outside `safeFetch` targets a hardcoded host; the GitHub ones interpolate only into the *path* | Safe |
| Mass assignment | every `data: { ...b.data }` spreads **zod-validated** output, and zod strips unknown keys | Safe by construction |
| HTML injection in e-mail | user text reaching `mailShell` goes through `escapeHtml`; the unescaped interpolations are closed `z.enum` values or numbers | Safe |
| Admin routes | no `app.post/put/patch/delete('/admin/…')` without a `preHandler` | Safe |
| Secret comparison | no secret compared with `===` (the single grep hit is a `typeof` check) | Safe |
| Raw SQL | `$queryRawUnsafe` / `$executeRawUnsafe` appear only in CLI scripts, interpolating table names read back from `pg_tables` | Not reachable from a request |
| `eval` / `new Function` | none | — |

## Login brute force — reviewed, no change needed

Recorded because it looks like a gap and is not. After 3 failures in 15 minutes the login
endpoint demands a proof of work, and the count is kept **per e-mail across every IP**:
credential stuffing is distributed by definition, so a per-IP limit never sees it. It is
deliberately **not** a lockout — locking an account after N failures turns the login form
into a denial-of-service weapon against its owner, and a PoW costs the attacker seconds per
attempt while costing the real owner a progress line.

The count is kept on the submitted address whether or not it belongs to an account, so the
response cannot be used to tell existing addresses from absent ones.

## Not covered by this pass

- The Discord bot and BMM/BetterInstaller (last covered 2026-07-18).
- Anything reachable only behind an admin session: the routes were checked for their
  guards, and the guards were confirmed to return 401 unauthenticated, but the screens
  themselves were not driven.
- Dependency CVEs — handled separately.

**Testing note.** Through Caddy, `curl` on `/api/admin/…` answers an **empty 200** even with
no session. That is the edge, not the route: from inside the API container the same routes
answer `401 {"error":"unauthenticated"}`. Curl at the edge is not a valid auth test on this
stack.

## Second sitting, same day — IDOR, token confusion, 2FA elevation

### IDOR on the owner-facing routes: clean, 49/49

Every `/me/…/:id` route ties the object to the caller — by a direct `ownerId: req.user.uid`
filter, through a helper (`ownRepo`, `ownRepoMutable`, `canAccessReport`), or, for billing
objects, through the Stripe customer (`inv.customer !== u.stripeCustomerId`).

Worth recording about the method: a first scan using a 12-line window "found" eight
unguarded routes, all of them false. The check has to read the WHOLE handler — several
verify ownership thirty lines down, and a helper called `ownRepoMutable` does not match a
pattern written for `owned*`.

**Design note, not a finding.** `ownRepo` reads
`if (repo.ownerId !== user.uid && user.role === 'USER') return { err: 403 }`, so every
non-`USER` role (MOD, ADMIN, SUPERADMIN) can write ANY repo through the owner-facing
routes — including minting a share key for a private one. It is deliberate and commented
("Staff still manage it via /admin/repos"), and custom roles do not reach it: `CustomRole`
carries capabilities and never changes `User.role`. Flagged only because it is broader
than "moderate content", and a future MOD-scoped review should decide whether it should be
a capability rather than "not a USER".

### Token confusion across one secret: blocked, and deliberately

Six kinds of JWT are signed with `JWT_SECRET` and told apart only by their claims: the
session (`uid, role, sid`), `server-control`, `2fa-pending`, `oauth-consent`, the
repo-dashboard (`rid, scope`), and `telemetry`. The session token carries no `purpose`, so
"does `jwt.verify` alone let one stand in for another?" is a real question.

The answer is `tokenAcceptable`: `if (!claims.sid) return { ok: false, error:
'session_revoked' }`. Only the session token has a `sid`, so nothing else can be presented
as one. The one that would have mattered is `2fa-pending` — issued after the password and
before the second factor. Had it been accepted as a session cookie, two-factor
authentication would have been an optional step.

Verified by forging each token type with the running instance's secret and presenting it
as `bcw_session`, **with a genuine session token as a control**:

| presented as `bcw_session` | result |
|---|---|
| a real session token (control) | **200** — without this the rest proves nothing |
| `2fa-pending` | 401 |
| `server-control` (elevated) | 401 |
| `oauth-consent` | 401 |
| repo-dashboard (`rid`/`scope`) | 401 |
| `telemetry` | 401 |
| a `sid` naming no session row | 401 |
| another user's `sid` | 401 |

### 2FA elevation (`bcw_elevated`): correct

`requireElevated` verifies the signature, requires `purpose === 'server-control'`, and
binds the token to the session user (`claims.uid !== req.user?.uid` → refuse). Tested
against the guard directly — seven cases, control passing:

valid + same user → allowed; issued for another user → 401; a session token replayed as
elevation → 401; a `2fa-pending` token replayed as elevation → 401; signed with a
different secret → 401; expired → 401; absent → 401.

Route-level testing was abandoned in favour of the guard: `requireCanControlServer()` runs
first and returned 403 for every case, so every result measured that guard and not this
one. Testing elevation through a route would have meant flipping `canControlServer` on a
real account, which is not a change to make casually on somebody's database for a test
that a direct call answers exactly.

### Fixed in the same sitting (found while adding the payments flag)

`POST /me/hosting/groups/:id/consolidate` used the imported `stripe` — the FUNCTION
exported by `hosting.mjs` — as if it were a client: `if (!stripe)` (a function is never
falsy, so the guard was dead) and `stripe.checkout.sessions.create(...)` (a property read
on a function). Every request to that endpoint returned 500. Confirmed against `HEAD`
before any of this session's edits, and reproduced in the container.

## BMM (Tauri desktop) — 2026-08-22

### The amplifier: no Content-Security-Policy on the webview

`app.security.csp` is `null` in `src-tauri/tauri.conf.json`. The app exposes **361**
`#[tauri::command]` functions, and its own capability file records why that matters:
"most BMM file work happens in Rust commands, which capabilities don't gate." So script
running in the webview reaches `window.__TAURI__` and through it file read/write and
process spawn — any XSS here is remote code execution, not a layout bug.

Escaping is applied **by hand**: `escHtml` appears 692 times, and roughly 70
interpolations of `.name` / `.description` / `.author` into HTML do not use it. 692 correct
applications and one miss is exactly the shape a hand-applied rule fails in.

### Fixed: three of those carry data from outside the machine

| Where | Field | Reachable how |
|---|---|---|
| `repo-sync.ts:386` | a profile name from a **remote `repo.json`** | subscribe to a hostile repo — ordinary BMM usage |
| `repo-sync.ts:868` | same, second view | same |
| `mods-list.ts:526` | a **mod's name** (its folder or archive) | install a malicious mod |

The mod-name one is the clearest illustration: the same field is already escaped in
`mods-details.ts` and `mods-conflicts.ts`. One site out of three was missed.

### NOT fixed, and the reason is a measurement

The missing CSP is the finding underneath the other three, and it is left open
deliberately. `script-src 'self'` is the directive that breaks the XSS-to-RCE chain, and
inline `style=` is unaffected by it — but the frontend generates **74 inline event
handlers** (`onclick=`, `onerror=`, `onfocus=`) that it would break, alongside **2492
inline style attributes** that need `style-src 'unsafe-inline'` to keep working.

Adding it blind to a desktop application that cannot be launched from this environment
would trade a possible compromise for a certain breakage. The order of work is: migrate
the 74 handlers to `addEventListener`, add
`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'`, then run the app.

### The remaining ~67, by file — to triage, not 67 findings

Most carry app-internal strings, and calling them all vulnerabilities would bury the three
that are not. Worth reading in this order, because the data is least trusted at the top:

    features/plugins/plugins.ts      4    third-party plugin metadata
    features/mods/modpack-creator.ts 5    modpack contents
    features/settings/scheduler.ts   7    user-authored, persisted
    ui/navbar-customize.ts           4    user-authored, persisted
    features/settings/crash-manager.ts 4  crash payloads
    features/betahub/betahub-modals.ts 4
    ui/app.ts                        8
    ui/tutorial-engine.ts            5
    ui/components.ts / kit.ts        7
    ui/update-notes.ts               3    release notes fetched remotely

### Not covered

BetterInstaller, and BMM's Rust side — the deeplink handler, archive extraction (zip-slip),
and the `bmmpage://` broker — which the 2026-07-18 pass covered and this one did not revisit.

