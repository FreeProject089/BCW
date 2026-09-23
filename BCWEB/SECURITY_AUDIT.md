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

### The amplifier: a Content-Security-Policy that permits inline script

**Corrected 2026-08-22, later the same day.** This section first said the webview declares
NO policy. That was wrong: `app.security.csp` is `null` in `src-tauri/tauri.conf.json`, and
I concluded from that alone without looking at `frontend/index.html` — which carries a
detailed `<meta http-equiv="Content-Security-Policy">`. The conclusion below survives the
correction; the reason for it does not, and a reader acting on "there is no CSP" would go
looking for the wrong fix.

What the policy actually says, directive by directive:

| directive | notable |
|---|---|
| `script-src` | **`'unsafe-inline'` and `'unsafe-eval'`** |
| `style-src` | `'unsafe-inline'` (harmless: a style cannot execute) |
| `img-src` / `media-src` | `https://*` |
| `connect-src` | `https://*` |

`'unsafe-inline'` in `script-src` is why an injected `<img src=x onerror=…>` still runs, and
`connect-src https://*` is why, once it runs, it can POST what it reads to any host on the
internet. So the chain holds — missed escape, script, `window.__TAURI__`, 361 commands — but
the fix is "remove `'unsafe-inline'`", not "add a policy".

`'unsafe-eval'` is worth a separate look: `scripts/security-guard.mjs` already fails the
build if `eval(` or `new Function(` appear in the frontend source, so if nothing in a
dependency needs it, that source can go too. The app exposes **361**
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
deliberately. Dropping `'unsafe-inline'` from `script-src` is what breaks the XSS-to-RCE chain, and
inline `style=` is unaffected by it — but the frontend generates **238 inline event
handlers** that it would break, alongside 2492 inline style attributes that keep working
regardless.

That figure was first reported here as 89. It was an undercount: the pattern behind it
listed `onclick`/`onmouseover`/`onerror` and a handful more, and missed `onmouseenter`,
`onmouseleave`, `dblclick`, `keydown` and the rest. 238 is the measured number, and
`scripts/security-guard.mjs` now counts it on every build so the figure cannot go stale
again. (Widening the pattern also needed making it case-SENSITIVE: `/i` matched
`const onClick = (e) => {`, ordinary JavaScript, and inflated the count to 241.)

The shape of the work is unchanged: the hover pairs are pure styling and belong in CSS,
the `onerror` are image fallbacks that fit one delegated capture listener, and most
`onclick` are a uniform `window.fn('id')` that a single delegated dispatcher covers. The
ones that pass `this` or `event` need reading one at a time — that is the part that cannot
be done mechanically, and it is why this is a session of its own rather than a line of
config.

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

### BMM's Rust side and the deeplink surface — checked, holds

**Zip-slip: protected.** Every site that EXTRACTS uses the `zip` crate's `enclosed_name()`,
which returns `None` for an entry that would escape the target directory. Three files call
`.name()` with no `enclosed_name()` beside it — `commands/apps.rs`, `commands/crash.rs`,
`mcp/state_bridge.rs` — and none of them write: crash.rs and state_bridge.rs match entry
names against a fixed list and read the contents, and apps.rs turned out not to be zip at
all (`p.name()` there is a PROCESS name from `sysinfo`, matched by a careless grep).
`archive.rs` also mirrors the guarantee by hand for the non-zip formats, and says so.

**Deeplinks: gated where it counts.** `bmm://` carries 44 actions and any web page can
trigger one, so the first is the alarming one: `api`, with `method` and `path`. It is
guarded — the path must start with `/api/`, and **every non-GET method requires an explicit
confirmation dialog**, with the threat model written in the code ("any website or app can
trigger a bmm:// link, so a bare click must not be able to silently mutate app state").
The confirmation preview escapes its parameters.

GET is not confirmed, which is correct here for a reason worth checking rather than
assuming: the 18 GET routes on the internal API are all reads — health, status, mods,
data, profiles, plugins, creator-id, check-update, modpacks, repo/info. No GET with a side
effect, so the unconfirmed path cannot change anything. Deeplinks can also be disabled
wholesale (`bmm_deeplink_allow_global`).

**The `bmmpage://` broker: sound.** It identifies a caller by `e.source` — mapping the
message's source Window to a known page frame — rather than by `e.origin`, and grants are
looked up per page. That is the stronger check for these frames: an opaque-origin iframe
reports `e.origin === "null"`, so an origin-string comparison would be the weaker test here,
not the safer one.

### Not covered

BetterInstaller. And on BMM, the ~67 remaining unescaped interpolations above still need
triage — the CSP work is what makes them matter.



# Pentest — 2026-09-07 (September cycle, `.Assets/PLAN-PENTEST-SEPT2026.md`)

The whole plan run: twelve cards, the eight highest-impact ones (feedback, economy, B.MD, public
API, auth, hosting-settings, bot, repos) reviewed in depth, the regression card re-run live. The
new surfaces since 2026-08-22 (feedback centre, economy shop/casino/gifts, B.MD 3.0 live
directives, the bans & shield I had just added, the OAuth link flow) were the focus. Findings
proven by running against the local Docker stack where a request could show it, and by code where
the exploit would have written to prod-linked data (the bot) or needed a seeded account.

Ten issues fixed, most High. Everything else re-verified safe or documented below with a
recommendation. No `git push`; changes committed locally.

## Fixed

### 1. Account takeover via the OAuth "add a sign-in method" callback (CWE-352, high)
`routes/oauth.mjs`. The signed `state` bound **nothing** to the browser that started the flow —
only `{provider, nonce, ts, next}`. The callback is a GET, `optionalAuth()` reads the session from
the `bcw_session` cookie, and that cookie is `sameSite: lax`, so it is sent on a top-level GET
navigation. An attacker completes the provider step as **themselves** (capturing a valid `state` —
it comes back in the `/start` redirect — and a `code` for their own identity), then lures a
logged-in victim to `…/auth/oauth/github/callback?code=<attacker>&state=<valid>`. The victim's
cookie rides along; the `req.user?.uid` branch links the **attacker's** GitHub identity onto the
**victim's** account. The attacker then "Sign in with GitHub" → the victim's account. The same
missing binding was a login-CSRF on the logged-out branch.

Fixed by binding the flow to the browser: `/start` now sets a random nonce in an httpOnly cookie
(`bcw_oauth`) and embeds its SHA-256 in the signed state; the callback requires
`sha256(cookie) === state.bind` and clears the cookie before any linking or session issue. The
attacker cannot set that cookie in the victim's browser, so a lured callback carries no matching
nonce and is refused. The social-**connect** flow was already safe (its state carries the acting
`uid`, and it targets that uid, not the session) and is untouched.

### 2. Economy: points minted from nothing, and double-charged items (race, high)
`lib/economy-shop.mjs`. `movePoints` read the balance and wrote back an **absolute** value — a
read-modify-write with no transaction or row lock. Two concurrent gifts of the whole balance each
read the same figure; the sender was debited once (the second write lost) while the recipient was
credited twice — net points created. The same primitive double-charged a buy (`C ≤ balance < 2C`,
fired twice → two items, one debit).

`movePoints` is now atomic: a debit is a single conditional `updateMany({ where: { points: { gte }
}, data: { decrement } })` that returns `null` when the balance cannot cover it (a settlement that
should floor instead — a casino loss — passes `{ clamp: true }`). `giftPoints` credits the
recipient **only** if the sender debit succeeded; `buyShopItem` charges atomically **first** and
refunds on any fulfilment failure. Stock/exclusivity had a count-then-insert race with no DB
constraint behind it; a compensating post-insert re-rank now unwinds (row dropped, badge grant
undone, points refunded) any purchase that pushed the item past its limit, so a limited item can
no longer be oversold.

### 3. `/v1/polls` leaked unlisted/private polls and staff-only tallies (broken access control, high)
`routes/api-keys.mjs`. The `/v1/polls` list queried `where: { status: 'open' }` with **no**
visibility filter, so any user's self-minted `polls:read` key read every unlisted/private open
poll (id, question, description, options). Both `/v1/polls` and `/v1/polls/:id` computed `counted`
locally (`mine.length > 0 || results === 'always' [|| status === 'closed']`), ignoring
`results: 'staff'` — so a staff-only tally leaked on a closed poll (no vote needed) or after one
vote. This is the third re-derivation of the rule the `two-rules-one-truth` memory is about.
Fixed by routing both through the canonical `listWhere({ role: null })` and `maySeeResults(poll,
{ isStaff: false, hasVoted })` — the same single rules the website uses.

### 4. Suspended / taken-down repos kept serving every file (broken access control, high)
`routes/hosting-content.mjs`. The three public serve paths (`serveManifest`, `files/*`,
`/r/:id/contents`) gated on `published` only. Moderation take-down, account closure and lapsed
subscriptions all set `status` to `SUSPENDED`/`OFFLINE` and leave `published` true, so a
taken-down repo (malware, DMCA, non-payment) kept returning 200 with the full bytes — the
take-down was cosmetic, freezing only the owner's dashboard. Catalogs already honoured `status`;
repos were the outlier. All three paths now also refuse `SUSPENDED`/`OFFLINE`.

### 5. Stored XSS in B.MD via `<doc-comment data-link="javascript:…">` (high)
`packages/bmd/src/blocks.jsx`. `DocComment` promoted its `data-link`/`data-img`/`data-video`
attributes to `href`/`src` at React render time — **after** the sanitiser's URL pass had run — so
a `data-link="javascript:…"` reached the DOM. A non-staff author (project page config, a granted
blog co-author, a public comment) could land arbitrary JS in the BCWEB origin for any reader,
including an admin. Fixed by routing all three through `safeUrl` (the same gate native `<a>`/`<img>`
URLs get) and dropping anything it refuses; verified `javascript:`/`data:`/protocol-relative are
stripped while `https:`/paths/`mailto:` pass.

### 6. CSS injection via any directive `color=` (medium)
`packages/bmd/src/directives.js`. `color=` was written raw into an inline style as `--x:<value>`
at ~15 sites; the downstream style sanitiser denylist missed most properties (it stripped
`position:fixed` but allowed `position:absolute`, `transform`, `z-index`, `width:100vw`, external
`url()`). A content author could paint a full-viewport overlay (clickjacking/defacement). Closed at
the source with an **allowlist** `safeColor` (a real colour token or a `var(--…)` only), applied
once where attributes are parsed. Four payloads added to the `check-md-security` gate (now 42
hostile docs), each failing before the fix and passing after.

### 7. B.MD live directives read credentialed same-origin data; `:action` was one-click CSRF (medium)
`packages/bmd/src/blocks.jsx`. `:counter`/`:include`/`:openapi` fetched with the reader's cookies
(default `same-origin`), so an author-supplied `src=/api/me/…` rendered the reader's own private
data into a page the author controls. Those three now fetch with `credentials: 'omit'` (they show
public data; unauthenticated is correct). `:action{method=POST}` was a silent one-click same-origin
CSRF primitive; it now requires a confirmation for any state-changing method even when the author
set none, naming the method and target. The deeper fix — CSRF tokens on cookie-authed mutating API
routes — is recommended below (the API has none today).

### 8. Sessions survived a password change / reset (session management, medium)
`routes/auth.mjs`. `/me/password` and `/auth/reset/confirm` updated the hash but never touched the
`session` table, so an attacker's 7-day token stayed live through the exact recovery step meant to
kill it (the admin-set path already revoked everywhere — the safe pattern existed, unused).
`/me/password` now revokes every **other** session (keeps the current one); `reset/confirm` revokes
**all**.

### 9. Shop reveal codes drawn from `Math.random()` (weak randomness, medium)
`lib/economy-shop.mjs`. Codes granting free hosting / storage / a discount were `'SHOP' +
Math.random().toString(36)…` — a non-cryptographic PRNG whose state is recoverable from a few
outputs, and a giftable item's code is open (anyone-redeemable). Now `crypto.randomInt` over an
unambiguous 10-char alphabet.

### 10. Hardening batch (low, defence-in-depth)
- **TOTP** (`lib/totp.mjs`): the code compare was `===`; now `crypto.timingSafeEqual`.
- **Sitemap** (`routes/misc.mjs`): `seo.sitemapExtra` entries reached `<loc>` unescaped and the
  filter (`/^\/[^\s]*$/`) allowed `<>&"'`, so an admin-capability holder could inject `<loc>`
  entries or break the feed. `<loc>` is XML-escaped now and the filter rejects `//` and XML-special
  characters.
- **Key proof** (`lib/keyauth.mjs`): `verifyProof` enforced no ceiling on `exp` (a captured proof
  is a bearer secret until it expires). Now refuses a proof valid for more than 10 minutes; the
  honest client uses ~120s.
- **`/v1/economy/purchases`** (`routes/api-keys.mjs`): an argument-shift (`listPurchases(db, uid,
  200)` against `(p, eco, userId, take)`) queried `userId: 200` and always returned empty — a
  correctness bug fixed in passing.

## Reviewed and found safe (worth recording)

- **Public API scopes** — every `/v1` data route carries a scope; `apiAuth` fails closed on
  missing/expired/revoked key and suspended/banned owner; keys are SHA-256 at rest over 256-bit
  random, revocation is immediate (no cache); `/admin/api/limits` clamps 0/negative/over-max.
- **Webhooks** — delivery via `safeFetch`: scheme http/https only, private/loopback/link-local/
  `169.254.169.254` blocked, DNS resolved and pinned into the agent (rebinding-proof), every
  redirect hop re-checked; HMAC-SHA256 over `timestamp.body`; broadcast limited to public events.
- **Feedback centre** — S3 key is `feedback/<project>/<id>/<i>-<safeName>` (project regex-validated,
  id a random UUID, name stripped of separators/NUL); attachments served `Content-Disposition:
  attachment` behind the edge's nosniff + `frame-ancestors 'self'`; storage-config values clamped,
  `0` treated as off; every `/admin/feedback/*` route guarded; anonymous e-mail submissions give no
  existence signal; admin renders title/body/steps as text, no HTML sink.
- **Bot custom-id authorization** — every interaction derives the actor from `interaction.user.id`;
  role-panel/voice-panel/giveaway/shop/inventory/casino ids are re-checked against fresh server
  state (a crafted id cannot grant a role or operate another member's card); moderation and the
  warn ladder re-check Discord hierarchy through the modqueue; all 46 mutating `/bot/*` routes carry
  `botAuth` (constant-time), the one open route returns only the public invite.
- **Repos / catalogs** — keypair auth enforced on every serve path (ed25519 + RSA-SHA2/ECDSA, alg
  cross-checked, SHA-1/`none` rejected); sync-password Argon2 with a per-`(repo,sha256(pw))` verdict
  cache; share keys `timingSafeEqual`, not logged; transfers are authenticated in-app actions to an
  existing active account (no token-in-link, no pre-registration takeover); zip-slip closed on both
  the server (`zip-path.mjs`) and the Rust client (`enclosed_name`/`is_unsafe_rel_path`).
- **Auth** — OAuth link-proposal requires the account's own password or a code mailed to the
  existing address (controlling a provider email is not enough), single-use + 15-min; already-linked
  identity refused not moved; session `sid` checked every request; export reads only the subject's
  rows and redacts credentials; OIDC rotates refresh tokens and revokes the family on reuse.
- **Hosting settings → HTML** — `seo.gtmId` validated `^(GTM-…|G-…)$` server-side and
  `encodeURIComponent`'d client-side; `googleVerify`/`bingVerify` reach the DOM via `setAttribute`
  (no HTML parse); `/admin/settings/:key` is `requireRole('ADMIN')` (a capability alone is not
  enough); the seed generator's exported prefixes never include the bot/Ko-fi tokens or env secrets.
- **Regression (2026-08-22)** — the secret-in-query-string log leak stays fixed: a canary
  `?k=…&password=…` against the running API wrote only `queryKeys:["k","password"]`, zero values.

## Open — documented, not changed (recommendation, and why left)

- **The API has no CSRF token on cookie-authed mutating routes.** `:action`'s one-click CSRF is
  mitigated (forced confirm), but the class remains for any future same-origin content-injection.
  Recommend a Sec-Fetch-Site / Origin check that applies only to cookie-authenticated (not
  Bearer/API-key/bot-secret) state-changing requests — safe because the web app and API are
  same-origin and token clients are exempt. Left out of this pass as a systemic change to validate
  against every flow first.
- **Bot shared secret is a god-credential, and `/bot/economy/casino` trusts a client `multiplier`.**
  Anyone holding `BOT_SHARED_SECRET` (or on the bot container) can mint unlimited points or seize a
  guild dashboard via a crafted heartbeat `ownerId`. By design (server-to-server trust) and gated by
  the boot guard against the dev default; not member-reachable. Recommend moving the casino RNG
  server-side and cross-checking heartbeat ownership against a Discord-verified value.
- **Feedback storage cap evicts oldest-first.** One IP within the rate limit can push past the
  global cap; the hourly sweeper then strips the *earliest* legitimate reports' attachments. A
  per-sender share of the cap (or eviction by an abuse signal) would stop one submitter forcing
  eviction of others'. Also: `POST /admin/feedback/storage/purge` and `DELETE /admin/feedback/:id`
  are not written to the audit chain, and `/status` + `/reply` are guarded by the read capability
  (MOD) not the write one — confirm that matches the intended MOD boundary.
- **"Unlisted" repos are reachable at a guessable slug URL without the share key** — the byte routes
  don't consult `shareKey`/`listed`, only `published` + the access lists. If this is meant to be
  YouTube-unlisted (link-shareable, not private) it is working as intended; if users expect privacy
  from unlisting alone, gate the byte routes on the share key too. A behaviour decision, left for you.
- **Sealed shop purchases are repriced from live config at reveal** (`revealPurchase` reads the
  current item's gb/days/percentOff), so an admin editing an item up or down after purchase changes
  what an unrevealed purchase delivers, and a deleted item silently reveals as the `|| 1`GB/`|| 7`day
  fallback. Snapshot the resolved delivery onto the purchase row at buy time.
- **Erasure does not provably delete S3 blobs** (feedback attachments, avatars) — the DB pointer is
  gone, the object may remain. Enumerate the subject's asset keys and issue S3 deletes in the erase
  commit (GDPR completeness, not an access bug).

## Not run
No Postgres-backed API test suite run (it would mutate the dev DB); economy and poll fixes verified
by code + syntax + the security gate, not by a live seeded race harness — worth one before sign-off.
BMM and BetterInstaller only type-checked/gated, not launched (no Tauri here). The bot was never
driven (prod-linked).

# Pentest — 2026-09-07b (second pass over `.Assets/PLAN-PENTEST-SEPT2026.md`)

A deliberate re-run of the same plan, on the user's instruction to insist rather than trust the
first pass. It was aimed at the three places a second look is worth anything:

1. **Code written after the first pass.** The site-theme rework (gradients as stored data,
   per-scheme logos, ten new tokens), the studio permission flag, the raw-SQL goal measurement,
   the canvas, the B.MD table ops and the feedback request ceiling all landed *after* the
   2026-09-07 audit, so none of them had ever been looked at. This is where the finding was.
2. **What the first pass recorded as "Not run".** Its own closing note said the economy fixes
   were "verified by code + syntax + the security gate, not by a live seeded race harness —
   worth one before sign-off". That harness exists now and has been run.
3. **The cards that got the least depth** — 9 (BMM desktop), 12 (regression).

## Fixed

### 1. A site-theme token or gradient stop could make every visitor fetch a third-party URL (CSS injection, medium)
`apps/web/src/ui/theme.jsx`, `apps/api/src/lib/config-schemas.mjs`.

The theme's colour gate was a shape check whose third branch was
`color-mix\(in srgb[^;{}]*\)` — which reads as "a colour" and means "anything at all, as long
as it has no semicolon or brace and ends in a paren". `color-mix(in srgb, red, blue)
url(https://evil/x)` satisfies it, and `background: <colour> <image>` is perfectly valid CSS,
so a single page token turned every `.card` on the site into a request to a third party.

Proven end to end rather than argued: the string passed the client gate, passed the API's copy
of it (`pageColours.safeParse` → success), was emitted into the theme `<style>`, and the
browser resolved `background` to `url("https://evil/x")`. The edge CSP does not stop it —
`img-src` allows `https:`. It fires on every page load, for every visitor, and *outside*
anything the cookie banner governs, because the banner gates scripts and knows nothing about
stylesheets. The same value was accepted as a gradient stop, which lands in `.btn-primary`'s
`background` — the property that actually performs the fetch.

It needs the SUPERADMIN role, so it is not privilege escalation. It is recorded as a real
finding anyway because of what it says about the first pass: that pass closed exactly this
class for B.MD's directive `color=` with an allowlist (`safeColor`), and left the copy that
reaches *every page* rather than one document. One of two gates hardened is the shape a second
look is for.

Now an allowlist, in `apps/web/src/ui/theme-colour.js` (its own import-free module so the
gradient stops and the page tokens cannot each grow their own opinion, and so the check script
can run it in plain node). A hex, an rgb/hsl function of numbers, a bare colour name, a
`var(--token)`, or a `color-mix(in srgb, …)` whose arguments are themselves those things with
an optional percentage. Nothing else — no `url()`, no `image-set()`, no `element()`, no
`attr()`.

`scripts/check-site-theme.mjs` now carries the payloads: 12 hostile values and 10 legitimate
ones, asserted identically on **both** implementations, plus an assertion that the client and
the API agree case-by-case on gradient stops. Mutation-verified: restoring the old regex on
either side alone fails the check (exit 1) naming the value that got through.

That agreement check earned its place immediately — it caught two drifts introduced *by this
very fix*, before either could ship:

- tightening the token gate silently **widened** both gradient-stop gates, because
  `safeColour` accepts any `var(--token)` (a derived surface legitimately reads
  `color-mix(in srgb, var(--text) 12%, …)`) while the stop rule had never allowed a bare
  `var()` at all;
- narrowing the client back then left the **API** the looser of the two.

A bare `var(--x)` in a stop is now the four accent references only, on both sides.

### 2. `measureGoal` guarded an interpolated column name with a bare property read (low)
`apps/api/src/lib/goal-stats.mjs`. `if (DIMENSION_KINDS[g.kind])` is truthy for every member of
`Object.prototype` — `constructor`, `toString`, `valueOf` — and `field` then stringifies a
**function** into the SQL as a quoted identifier
(`"function toString() { [native code] }"`). No quote character survives that stringification,
so it is a 500 rather than an injection, and the write path's `z.enum` means no such row can be
created through the API today. It is fixed regardless: a guard shaped "is this key truthy" is
the wrong thing to put in front of an interpolated column name, and `Object.hasOwn` is the same
line. Pinned by a test that needs no database, so it runs even when the rest of that suite
skips.

## Re-verified by RUNNING it — the first pass's "Not run" list

### Economy concurrency (card 2's unmet "Done" criterion)
A race harness now exists, run inside the api container against the real Postgres with its own
throwaway users, removed afterwards. Twenty rounds each of: six concurrent debits of the whole
balance; six 200-point debits against 1000; and a four-way gift race where each winner credits
a second account.

**Result: clean.** Exactly one whole-balance debit wins per round, the balance never goes
negative, and the total number of points across both accounts is unchanged by the gift race.

The result is only worth the mutation that backs it. Putting the pre-fix read-modify-write back
**inside the container only** reproduces the original bug exactly: 6 of 6 debits of the whole
balance succeed, the partial race ends at 800 where the arithmetic says −200, and the gift race
leaves **4000 points where 1000 were seeded** — points minted from nothing, four times over.
Restored, 20 clean rounds. The September fix holds under real concurrency; that is now a
measurement rather than a reading.

### Card 12 — regression, re-run live

| Probe | Result |
|---|---|
| Secrets in a query string reaching the log | `"url":"/api/health","queryKeys":["k","password"]` — names only, no values. The log line is quoted here because a canary probe that was never logged proves nothing. |
| Unsigned Stripe event | `POST /webhook` → **400** `{"error":"bad_signature"}` (the August note recorded 503; same refusal, clearer code). |
| Admin routes without a session | `PUT /admin/theme` → 401, `GET /admin/feedback` → 401. |

### Card 9 — BMM desktop, the two questions that were open

- **`read_file_base64` has no path confinement at all** (`std::fs::read(&path)`, no guard) —
  and no untrusted caller can reach it. Traced every surface: it is registered as a Tauri
  command and called only from BMM's own feedback and BetaHub modals, where the path comes from
  a native file dialog; it appears in no API action registry and no MCP tool; and custom
  `bmmpage://` pages are sandboxed *without* `allow-same-origin`, so they have no `invoke` at
  all. Not a finding by the plan's own exclusion ("no lack of hardening without a path"), but
  recorded below as a recommendation, because the day it is exposed to a plugin or an MCP tool
  it becomes arbitrary file read with no second gate.
- **A scheduled task cannot grant itself permissions.** `sanitiseImportedTask` sets every
  permission to false and imports the task **disabled**, then tells the user which ones it
  asked for. So the hostile path card 9 asks about — a catalog or plugin shipping a task that
  reads a file (`fs`) and posts it (`http`, gated behind `command`) — is closed at import, not
  at execution.

## Open — recommendations, unchanged from the first pass unless noted

Everything in the 2026-09-07 "Open" section still stands and is not repeated. Added by this
pass:

- **Confine `read_file_base64` now, not when it is exposed.** The other disk commands carry the
  CWE-22 guard; this one predates the plugin and MCP surfaces and has never needed it. Confining
  it to the configured profile roots plus the crash/log directories costs nothing today and
  removes the question permanently. (`external-drive-paths`: the confinement must be to the
  *configured roots*, not to the app directory — absolute paths on other drives are legitimate
  here.)
- **The theme's colour gate and B.MD's are now two allowlists with the same job.** They are
  deliberately separate (different value vocabularies: B.MD has no `color-mix`), and each is
  now gated — but a third emitter of author-controlled CSS would start from neither. Worth one
  shared module the next time one is added.

## Not run
The Postgres-backed API suite was not run in full (it writes to the dev database); the economy
harness is the exception and cleans up after itself. BMM was not launched (no Tauri here) — its
half is `tsc` + the gates + reading. The Discord bot was never driven (prod-linked), per the
plan's rule 3. Cards 10 (BetterInstaller) and 11 (infra) were not re-run: nothing in them
changed since the first pass, and re-reading unchanged files is not a second opinion.

---

# Pentest 2026-09-22 — Card 10, supply chain and configuration

Plan: `.Assets/.md/PLAN-PENTEST-SEPT22-2026.md`, card 10 (N). Scope: dependency advisories and
their REACHABILITY, lockfile integrity, container and edge configuration, CI workflows, and the
env surface. BMM/BetterInstaller findings from the same card are in
`.Assets/.md/CWE_REMEDIATION_PLAN.md`; this file holds BCWEB, the bot and the telemetry
dashboard. Nothing was committed. The Discord bot was never started.

## Measured first — the audit sweep

`npm audit --omit=dev`, then again with dev, in every JS workspace. `packages/bmd` and
`packages/bmd-editor` declare only `peerDependencies` and have no lockfile, so there is nothing
to audit in them — not an omission.

| Workspace | prod before | prod after | dev before | dev after |
|---|---|---|---|---|
| `apps/api` | 1 high | **0** | 1 high | **0** |
| `apps/web` | 1 critical | 1 critical | 4 | 4 |
| `apps/bot` | 0 | 0 | 0 | 0 |
| `loadtest` | 0 | 0 | 0 | 0 |
| BMM root | 0 | 0 | 0 | 0 |
| `bmm/telemetry-dashboard/web` | 6 | **4** | 10 | **6** |
| `bmm/telemetry-dashboard` (root) | 2 | 2 | 2 | 2 |
| `native` | 0 | 0 | 0 | 0 |

`cargo audit` was run on `native/` and `native/core/` (clean, no output) and on the telemetry
server (below). The Rust crates of BMM and BetterInstaller are in the other sink.

---

## Findings, most severe first

### F10-1 — A zip from a stranger's server is downloaded and inflated with no bound (FIXED)

**CWE-409 / CWE-789 / CWE-400.** CVSS 3.1 **7.5 high** —
`AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:N/A:H` (PR:L because the submitting path needs an account; the
admin inspect routes need MOD/ADMIN, but the *bytes* are chosen by whoever submitted the item).

This is where the `adm-zip` advisory actually lands, and it is worse than the advisory.

`fetchPluginBytes` (`apps/api/src/lib/plugin.mjs`) did `Buffer.from(await res.arrayBuffer())` on
a **submitted item's `download_url`**. `safeFetch` decides *where* we may connect (SSRF); it does
not decide *how much* we may read, and the 15 s timeout is no bound either — a host on a fast
link delivers gigabytes inside it. `zipReadAll` (`apps/api/src/lib/native.mjs`) then materialised
**every** entry in memory with no budget. Callers: `validatePlugin`, `/admin/catalog/:id/inspect`,
`/admin/catalog/:id/plugin-content`, `/admin/catalog/:id/entry`, the community-catalogue twins in
`catalogs.mjs`, `content-backup.mjs`, `projects.mjs`.

The API container is `mem_limit` 512 MB with `--max-old-space-size=384` (apps/api/Dockerfile), so
this is not an exception a route can catch — it is the container being OOM-killed, taking every
in-flight request with it.

*Trigger, measured.* A zip holding 8 MB of zeros is **8 273 bytes** on the wire and the
pre-fix `zipReadAll` returned **8 388 608 bytes** from it — a measured **1014:1** ratio. Scale the
same archive to a 256 MB upload and it is ~250 GB of Buffer.

*Refuted along the way.* npm audit's headline for `adm-zip` GHSA-7q85-xj36-vmfc reads as if the
upgrade closes this. It does not. Reading `node_modules/adm-zip/methods/inflater.js` at both
versions: 0.6.0 passed `maxOutputLength: expectedLength` — the cap **is** the attacker's declared
size — and 0.6.1 only adds a 1-byte floor so an entry declaring **zero** cannot escape the cap.
An entry that honestly declares four gigabytes is still inflated in full by every adm-zip version.
The native Rust path is worse still: `native/core/src/lib.rs` does
`Vec::with_capacity(size as usize)` from the same declared size, so merely *claiming* 100 GB is
an immediate 100 GB reservation, and a Rust allocation failure aborts the process rather than
unwinding.

*Fix.* Two bounds, both in files this card owns:

- `fetchPluginBytes` now reads `res.body` chunk by chunk against `PLUGIN_FETCH_MAX_BYTES`
  (256 MB) and throws `too_large`. `content-length` is checked first as a cheap refusal but is
  treated as a hint, not a bound — a hostile server can omit or lie about it.
- `zipReadAll(buf, { maxTotalBytes = ZIP_INFLATE_BUDGET })`, 1 GiB, summed over the entries'
  **declared** sizes from the header-only `zipEntries`, refused with `zip_too_large` **before**
  anything is inflated. Header-only on both the native and the JS path, so a refusal costs a
  central-directory parse, not a gigabyte.

*Why the fix holds.* Declared-large is now refused before any allocation, on both paths, which
also removes the `with_capacity` hazard. Declared-small-but-actually-large is capped by zlib on
the JS path (`maxOutputLength` = the small declared size). And the budget cannot regress a path
that works today: a `zipReadAll` materialising more than a gigabyte of buffers is already
OOM-killed inside a 512 MB container, so the only behaviour that changes is a crash becoming a
catchable error.

*Residual (owner).* On the **native** path a lying-small declaration is still inflated without a
limit — `native/core/src/lib.rs` uses `read_to_end` with no `take()`. It is now bounded to
~1000 x the compressed input, and the compressed input is bounded to 256 MB by the fetch cap, so
the worst case is no longer unbounded but is still large. The Rust fix is a `.take(limit)` on the
entry reader; it needs a napi rebuild to verify, which is why it is not in this run.

*Tests.* `apps/api/test/native.test.mjs` +2: a real bomb-shaped archive refused with
`zip_too_large` and the same bytes read back in full when the budget is raised (proving the
refusal is the pre-check, not a failed inflate), and a sum-over-entries case with the exact
boundary (2999 refused, 3000 allowed). Suite: **1771 -> 1773 tests, 1731 pass, 0 fail, 42
skipped** — the same 42 as the baseline, skipped for want of a `DATABASE_URL`, per the
`bcweb` skill's note on running the suite as CI runs it.

### F10-2 — `adm-zip` 0.6.0 (GHSA-7q85-xj36-vmfc, GHSA-xcpc-8h2w-3j85, GHSA-vwc7-r8mq-g2x9) (FIXED)

**CWE-789 / CWE-59.** High (7.5) for the allocation pair; the symlink one is moderate (6.5) and
**not reachable** — `grep` for `extractAllTo` / `extractEntryTo` / `.extract(` across
`apps/api/src` returns nothing, so nothing here ever writes an adm-zip entry to disk.

Bumped `apps/api` to **0.6.1** — a patch release, already inside the declared `^0.6.0` range.
`npm install adm-zip@0.6.1` also tightened `package.json` to `^0.6.1`, which is the right floor.
`npm audit --omit=dev` in `apps/api`: **1 high -> 0**. The test suite is byte-identical before and
after (1771 tests, 1729 pass, 0 fail, 42 skipped, both runs). The allocation half of this
advisory is only really closed by F10-1 — see the refutation there.

### F10-3 — The `.dockerignore` that was never read: 471 MB of context, including `.env` (FIXED)

**CWE-200 / CWE-538.** CVSS 3.1 **4.0 low** — `AV:L/AC:L/PR:L/UI:N/S:U/C:L/I:N/A:L`. Local
exposure to the Docker daemon and to build layers, not a remote path.

`apps/web/.dockerignore` exists and lists `node_modules`, `dist`, `.vite`, `*.log`. Docker reads
`.dockerignore` at the **context root**, and `infra/compose` sets `context: ../..` — the BCWEB
root. So that file has never applied to any build, and there was no file at the root.

*Refuted first, and this mattered.* The tidy fix looked like renaming it to
`apps/web/Dockerfile.dockerignore`, the per-Dockerfile convention. Measured on the Docker running
this machine (29.6.1) with a throwaway three-file context: with `Dockerfile.dockerignore` beside
the Dockerfile, `.env` and `node_modules` were **still copied** — it did nothing. Only a file at
the context root worked. Shipping the rename would have been a fix that fixes nothing and reads
in review as if it did.

*Measured before and after*, listing what `COPY apps/web/ ./` actually receives:

| | context transferred | `node_modules` entries in the build stage | `.env*` |
|---|---|---|---|
| before | **471.26 MB** | **533** | present |
| after | **36.04 MB** | none | none |

Note what was in that context: `infra/compose/.env`, which holds the real secrets, was scanned
and offered to the daemon on every build of three images.

*Fix.* New `BCWEB/.dockerignore` excluding `**/node_modules`, `**/.env*` (keeping
`!**/.env.example`), `**/dist`, `**/target`, `**/.vite`, `**/build`, `.git`, `.github`,
`.claude`, logs. Every path the three Dockerfiles COPY is listed in the file's own comment and
was verified present afterwards: `apps/web/package.json`, `apps/web/vite.config.js`,
`packages/bmd/package.json`, `packages/bmd/src/index.jsx`.

*Verified by build,* not by reading: `apps/web` builds green end to end with it
(`npm ci` -> 652 packages -> `built in 55.18s` -> image named), and `apps/provisioner` builds
green. A first attempt failed on `Could not resolve "./studio-tour.jsx"` — that was a stale
cached COPY layer from before a parallel agent added the file, not this change; `--no-cache`
is green.

### F10-4 — No CI `permissions:` block: GITHUB_TOKEN ran at the repository default (FIXED)

**CWE-732 / CWE-250.** CVSS 3.1 **6.6 medium** — `AV:N/AC:H/PR:N/UI:N/S:C/C:L/I:H/A:L`
(AC:H, S:C: it takes a compromised third-party action to use the token, and the impact lands on
the repository, a different component).

`BCW/.github/workflows/ci.yml` declared no `permissions:` at all, so `GITHUB_TOKEN` carried
whatever the repository default is — write-all on a repository created before GitHub changed the
default — and that token was in the environment of every step, including third-party actions
pinned to **moving refs** (F10-5). Nothing in the file writes anything: it checks out, installs,
builds, `docker run ... caddy validate`, and `git grep`.

Added `permissions: { contents: read }` at the top. The same block was added to BMM's and
BetterInstaller's CI (recorded in the other sink). `release.yml` is untouched on this point: its
job already declares `contents: write` for `gh release create`, and a job-level block replaces
the top-level one. All four files re-parsed with `js-yaml` afterwards.

### F10-5 — Third-party CI actions pinned to moving refs, in the job that holds the update-signing key (OWNER)

**CWE-829.** CVSS 3.1 **8.1 high** — `AV:N/AC:H/PR:N/UI:N/S:C/C:H/I:H/A:N`. The severity is
the *consequence*, not the likelihood.

Every workflow in all three repositories uses:

| Action | Pinned to | What that is |
|---|---|---|
| `dtolnay/rust-toolchain@stable` | a **branch** | moves on every release of the action |
| `Swatinem/rust-cache@v2` | a tag | maintainer can repoint it |
| `actions/checkout@v4`, `actions/setup-node@v4` | tags | GitHub-owned; same class, lower risk |

BMM's `release.yml` is the one that matters: it writes the **Ed25519 private key that signs every
BMM update** to `betterinstaller-src/examples/bmm/keys/private.key`, and `Swatinem/rust-cache@v2`
runs a post step in that same job, after the key is on disk. An installed BMM accepts an update
*because* it verifies against the public half baked into `installer.toml`, so theft of that key
is not a leak, it is a supply-chain compromise of every installed copy.

*Refuted:* rust-cache does **not** capture the key — it saves `~/.cargo` and `<workspace>/target`,
and the key is at `examples/bmm/keys`. The exposure is the arbitrary JS an action's post step can
run in a job where the file exists, not the cache.

*Not applied, deliberately.* `dtolnay/rust-toolchain` derives the toolchain **from the ref**, so
pinning it to a SHA requires also adding `with: { toolchain: stable }`. That is a CI change that
cannot be verified from here, and an unverified CI edit is how a fix becomes an outage. SHAs
resolved for the owner (`git ls-remote`, 2026-09-22):

```
dtolnay/rust-toolchain  refs/heads/stable  6bed0761d98439e5a578e2877258200ad565ba87
Swatinem/rust-cache     refs/tags/v2       49a0bdc70d2e1b713ca9e2869b211fcce03d3c1c
actions/checkout        refs/tags/v4       11d5960a326750d5838078e36cf38b85af677262
actions/setup-node      refs/tags/v4       49933ea5288caeca8642d1e84afbd3f7d6820020
```

### F10-6 — The telemetry dashboard origin had no security headers at all (FIXED)

**CWE-1021 / CWE-319.** CVSS 3.1 **5.4 medium** — `AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N`.

`{$TELEMETRY_DOMAIN}` in `infra/caddy/Caddyfile` served the dashboard with `encode` and nothing
else: no `X-Frame-Options`, no `frame-ancestors`, no `nosniff`, no `Referrer-Policy`, no HSTS.
It is the most privileged surface on the platform — every installation's telemetry behind a
session cookie and `canViewTelemetry` — and any page on the internet could frame it and drive an
authenticated admin's clicks.

Added `nosniff`, `X-Frame-Options DENY` (verified nothing frames it: no iframe in `apps/web`
points at the dashboard), `Referrer-Policy no-referrer`, `Permissions-Policy`, HSTS, `-Server`.

A CSP is **written into the file but left commented**, with the reason. The dashboard is not
self-contained: `MapPage.tsx` pulls raster tiles from `tile.openstreetmap.org` and
`basemaps.cartocdn.com` and glyphs from `fonts.openmaptiles.org`, `visuals.tsx` pulls flags from
`flagcdn.com`, and `index.html` loads Inter from `rsms.me`. The first draft of this fix shipped
`default-src 'self'; connect-src 'self'` — reading those five files is what refuted it. A CSP one
host short white-pages an admin surface, and that has to be confirmed in a browser against the
running stack. **Owner: enable the commented line after that check.**

### F10-7 — No HSTS anywhere (FIXED for our own origins)

**CWE-319.** CVSS 3.1 **5.9 medium** — `AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:N/A:N`.

Caddy does not send HSTS on its own. Without it the *first* request a visitor makes to the bare
domain is plain HTTP and can be intercepted before the redirect to HTTPS is ever seen; the
session cookie is `Secure`, but the login page and every link on it are not protected on that
first hop.

Added `Strict-Transport-Security "max-age=31536000; includeSubDomains"` to the site block and the
telemetry block. `includeSubDomains` because the dashboard and the S3 origin are subdomains of
the same zone and share the session cookie. **No `preload`** — that is a one-way submission to a
browser-vendor list and is the owner's call. Sent unconditionally: a browser ignores the header
when it arrives over plain HTTP, so the local `http://localhost:5176` default is unaffected.

**Not** added to the customer-domain block, on purpose: pinning a year of HTTPS-only onto a
domain the *customer* owns follows them if they later point it at a plain-HTTP host. That
commitment belongs in the custom-domain terms, not in a config default. The reasoning is written
into the Caddyfile beside the commented directive.

### F10-8 — The customer-domain and S3 origins were missing framing and sniffing protection (PARTLY FIXED)

**CWE-1021 / CWE-430.** CVSS 3.1 **4.3 medium** — `AV:N/AC:L/PR:N/UI:R/S:U/C:L/I:L/A:N`.

The customer-domain catch-all carried only `nosniff` and `Referrer-Policy`, and the MinIO origin
carried **nothing** although it serves user-uploaded bytes.

Added: `X-Frame-Options SAMEORIGIN` + `Permissions-Policy` on customer domains;
`nosniff` + `X-Frame-Options SAMEORIGIN` + `Referrer-Policy no-referrer` + `-Server` on the S3
origin. `nosniff` is safe there *specifically* because `storage.mjs` signs an explicit
`ContentType` into every presigned PUT (lines 40/45), so an object's declared type is the one the
API chose — nosniff cannot break an asset by refusing a merely-guessed type.

**Open, owner:** nothing sets `Content-Disposition` on the S3 origin, so an object stored as
`text/html` **renders as a page** on a sub-domain of the brand. That is an upload-policy question
(which content types may be presigned at all), not an edge one, and belongs to the file-upload
card rather than this one. A `CSP: sandbox` for customer domains is written into the Caddyfile as
a comment with the same treatment — it would stop an uploaded page scripting, and it would also
stop a legitimate repo index that uses JavaScript, which is a product decision.

**Validated:** `caddy validate --config Caddyfile --adapter caddyfile` against `caddy:2-alpine`
— the same image compose runs, which is the CI step — green before and after. `caddy adapt` then
confirms the headers reached the JSON and reached the right sites: HSTS x2 (site, telemetry),
`X-Frame-Options` x4, `X-Content-Type-Options` x4.

### F10-9 — The site CSP allows `'unsafe-inline'` scripts and `connect-src https:` (OWNER)

**CWE-1021 / CWE-79 (mitigation gap).** No CVSS: this is a missing mitigation, not a
vulnerability, and the plan's own rule excludes hardening with no path. Saying it out loud
because card 10 asks for it explicitly.

```
script-src 'self' 'unsafe-inline' https://www.googletagmanager.com ...
connect-src 'self' https: http://localhost:9000 ws: wss:
```

`'unsafe-inline'` in `script-src` means the CSP stops **no** injected script, and
`connect-src https:` means it stops **no** exfiltration either — the two things a CSP is for.
`frame-ancestors 'self'` and `base-uri 'self'` do work; there is no `'unsafe-eval'`. Closing this
is a nonce or hash pass over the inline theme bootstrap and the GTM snippet in `apps/web`, which
belongs to the agent that owns that directory. Left as an owner item.

### F10-10 — `DOMAIN_ASK_KEY` and `CUSTOM_DOMAIN_MATCHER` are documented but reach no container (OWNER)

**CWE-1188.** CVSS 3.1 **3.7 low** — `AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N`.

`scripts/check-env-documented.mjs` reports seven variables `.env.example` documents that compose
no longer reads, and two of them are load-bearing in the Caddyfile:

- `CUSTOM_DOMAIN_MATCHER` — the caddy service does not pass it, so the block always falls back
  to `http://custom-domains.invalid`. An owner who sets it in `.env` as `.env.example:307` tells
  them to gets no custom domains and no error. Fails **closed**, so it is a functional gap, not
  a hole.
- `DOMAIN_ASK_KEY` — same, so `on_demand_tls { ask ...?key= }` always sends an empty key, and
  `domains.mjs:172` treats an empty `DOMAIN_ASK_KEY` as "no guard". The `/domains/ask` oracle
  (200 = that hostname is hosted here, for any name a stranger tries, CWE-200) therefore rests
  on a single layer: the edge's `handle /api/domains/ask* { respond 404 }`. That layer is real
  and correctly ordered before `handle_path /api/*` — I checked the block order — but the key
  exists precisely to be the half that survives the API being reachable some other way, and as
  shipped it cannot be switched on. Setting it in `.env` today changes nothing at all, because
  neither service reads it.

Not fixed here: `infra/compose/docker-compose.yml` carries the owner's uncommitted edit and is
out of bounds for this run. It needs `DOMAIN_ASK_KEY` and `CUSTOM_DOMAIN_MATCHER` added to the
`caddy` (and, for the key, `api`) service environment.

### F10-11 — `apps/api` and `apps/provisioner` build from `npm install` with no lockfile in the image (api FIXED, provisioner OWNER)

**CWE-1357 / CWE-494.** CVSS 3.1 **5.6 medium** —
`AV:N/AC:H/PR:N/UI:N/S:C/C:H/I:H/A:H` (it takes a compromised upstream patch release; the
impact is a production image).

`apps/bot/Dockerfile` carries a comment explaining exactly why `npm ci` and not `npm install` —
and `apps/api`, `apps/web`, `apps/provisioner` and `bmm/telemetry-dashboard` all did the
opposite, copying only `package.json`. Every `^` range was re-resolved at **build** time, so two
builds of one commit could ship different trees and a compromised patch release of any transitive
package reached production with no lockfile diff to review.

- **`apps/api` — fixed.** Now `COPY apps/api/package.json apps/api/package-lock.json ./` +
  `npm ci` (not `--omit=dev`: the `prisma` CLI is needed by `generate` at build and by
  `boot-migrate.mjs` at runtime). Verified with a real `node:22-alpine` build of exactly that
  step: `added 265 packages` including the native `argon2`.
- **`bmm/telemetry-dashboard` — fixed** the same way for its `web/` stage.
- **`apps/web` — NOT applied.** The change is written and was verified green
  (`npm ci` -> 652 packages, `built in 55.18s`), then **reverted**, because a parallel agent
  owns `apps/web` for this run and the rule is not to edit any file there. The two-line patch is
  in the report from this card; it is worth applying.
- **`apps/provisioner` — cannot be fixed.** It has **no `package-lock.json` at all**
  (`npm ci` there exits 1). Its tree is decided fresh on every image build. Generating a lockfile
  is a dependency-resolution act with an owner decision attached, so it is not in this run.

### F10-12 — Every service container runs as root (OWNER)

**CWE-250.** CVSS 3.1 **4.6 medium** — `AV:N/AC:H/PR:H/UI:N/S:C/C:L/I:L/A:L`. It is a
blast-radius multiplier on some other bug, not a way in.

None of `apps/api`, `apps/bot`, `apps/provisioner` or `bmm/telemetry-dashboard` sets `USER`.
`node:*-alpine` and `gcr.io/distroless/cc-debian12` both default to root, so an RCE in the API
is root in the container. (`apps/web` is `nginx:alpine`, whose workers already drop to `nginx`.)

Not applied: `USER node` interacts with volume ownership — the api writes git backups through
`gitbackup.mjs` and `npm ci`/`prisma generate` ran as root, so the fix is `chown` plus
`USER` plus a stack run to prove it, and the stack cannot be brought up under this card's rules
(compose is off-limits). For the telemetry image the fix is smaller:
`gcr.io/distroless/cc-debian12:nonroot`.

### F10-13 — Base images pinned by tag, not digest (OWNER, accepted risk)

**CWE-1357.** Informational. `node:22-alpine`, `node:24-alpine`, `nginx:alpine`, `rust:1-alpine`,
`rust:1.93-slim`, `gcr.io/distroless/cc-debian12`, `postgres:16-alpine`, `redis:7-alpine`,
`caddy:2-alpine`, `minio/minio:latest`, `edoburu/pgbouncer:latest`. Digest pinning trades
"the same image every time" against "you must bump it to get security patches". Three of the four
Dockerfiles mitigate the second half with `apk upgrade --no-cache`; `minio/minio:latest` and
`edoburu/pgbouncer:latest` are the two worth naming, because `:latest` is neither reproducible
nor patched on a schedule.

**Fixed in passing:** `apps/provisioner/Dockerfile` was the only one of the four missing
`apk upgrade` — it did `apk add --no-cache openssl` alone, so it shipped whatever openssl the
base tag was built with. Now `apk upgrade --no-cache && apk add --no-cache openssl`; the image
rebuilds green (`Generated Prisma Client (v5.22.0)`).

### F10-14 — `maplibre-gl` GHSA-jrc7-96c5-q579 (critical) is NOT reachable (NO ACTION)

**CWE-79.** Critical by CVSS; **not reachable here**, and the fix is a major bump, so it is
proposed, not applied (the card's rule).

The bypass is in `DOM.sanitize()`, which maplibre applies to **attribution HTML and popup
content**. Both consumers feed it constants:

- `apps/web/src/pages/admin.jsx:17109` — `attribution: '(c) OpenStreetMap (c) CARTO'`, a literal,
  and the map is built with `attributionControl: false`.
- `bmm/telemetry-dashboard/web/src/pages/MapPage.tsx:18-19` — two literal attribution strings.

Neither file contains `Popup`, `setHTML` or `innerHTML` on the map. Markers are built from
`p.lng`/`p.lat` numbers with a custom element. So no attacker-controlled HTML reaches the
sanitizer, on either surface, and both surfaces are admin-only anyway.

**Proposed, not applied:** `maplibre-gl` 5.x -> **6.10.0** is semver-major in both apps. Worth
scheduling; not worth a blind bump in a security run.

### F10-15 — Remaining telemetry-dashboard advisories (PARTLY FIXED)

`npm audit fix` **without** `--force` on `bmm/telemetry-dashboard/web`: prod **6 -> 4**, dev
**10 -> 6**, `package.json` **unchanged** (lockfile-only, transitive: `nanoid`, `postcss`,
`browserslist`, `baseline-browser-mapping`). Verified by rebuilding: `npm ci` -> 183 packages,
`built in 13.27s`.

Left, all requiring a major bump — **proposed, not applied**:

- `maplibre-gl` critical — see F10-14, not reachable.
- `echarts` < 6.1.0, moderate XSS. Reachability not proven either way: echarts XSS is normally a
  rich-text/formatter path, and the dashboard does render fleet-supplied strings in tooltips. It
  is an admin-only surface behind `canViewTelemetry`. Bump to 6.1.0 and re-check the charts.
- `react-router-dom` 7.17 -> 7.18.4, moderate open redirect via a backslash in `<Link>`/
  `useNavigate`. Reachable only where a route target comes from data; admin-only.

### F10-16 — `bmm/telemetry-dashboard` root: two advisories in code that is not deployed (OWNER)

`adm-zip` <= 0.6.0 and `qs` in `bmm/telemetry-dashboard/package.json` (express + better-sqlite3 +
adm-zip, entry `server.mjs`). That is the **old Node/SQLite collector**, superseded by the
Rust/Axum/Postgres server: the Dockerfile builds `server/` and `web/` and never copies
`server.mjs`, and compose runs that image. So neither advisory is reachable in anything deployed.

It is still two permanent red lines in `npm audit` over code nothing runs. **Owner decision:**
delete `server.mjs`, `db.mjs`, `stats.mjs` and that `package.json`, or mark them archived — an
audit finding nobody can act on is how real ones start being skipped.

---

## Checked and clean — stated so it is not re-checked

- **Lockfile integrity.** `npm ci --dry-run` in every workspace that has a lockfile: `apps/api`,
  `apps/web`, `apps/bot`, `loadtest`, BMM root, `telemetry-dashboard`, `telemetry-dashboard/web`,
  `native` — none reported a `package.json` / lockfile disagreement (`npm ci` fails loudly on
  that, and did not). Two reported node_modules drift against the lockfile (BMM root has two
  extra packages incl. `lucide`; `telemetry-dashboard` is missing `accepts`), which is a local
  `node_modules` state, not lockfile drift. `apps/provisioner` has no lockfile — F10-11.
- **No dependency resolved from outside the registry.** All eight lockfiles are
  `lockfileVersion 3`; every `resolved` is `https://registry.npmjs.org/`; **zero** entries lack
  an `integrity` hash. No git or http-tarball dependencies.
- **Install scripts.** `@prisma/client`, `@prisma/engines`, `prisma`, `argon2`, `better-sqlite3`,
  `esbuild`, `fsevents` — all expected (native compilation, engine fetch), none unexplained.
  Worth one line: `@prisma/engines`' postinstall **downloads binaries at install time**, and
  those bytes are not covered by any lockfile `integrity` hash. It is how Prisma works; it is
  also the one unpinned artefact in the tree (CWE-494).
- **`pull_request_target`:** none, in any workflow, in any of the three repositories. No secret
  is echoed; the BCW CI workflow uses no secrets at all.
- **Env surface, all three checkers green:**
  `infra/check-env-spec.mjs` -> `.env wizard spec OK — 38 questions, every key real, both
  scripts read it`; `apps/api/scripts/check-env-documented.mjs` -> `env documented — 63 compose
  variable(s): 67 in .env.example, 16 internal` (plus the seven-unread note behind F10-10);
  `guides/check-claims.mjs` -> `checked 63 guides against 18 services, 36 scripts, 321 env vars —
  every service, script, variable and path a guide names exists`.
- **The leaked Discord token is gone.** `bcweb-leaked-discord-token` recorded a real bot token
  committed in `.env.example`. `infra/compose/.env.example:157` is now `DISCORD_TOKEN=` (empty)
  and `infra/env-spec.txt:70` describes it as a secret with no value. The CI secret-scan job
  excludes `*.example`, so it would never have caught it — the exclusion is still there, which is
  correct for placeholders but means this file needs a human, not the gate.
- **Build-arg secrets:** `apps/web/Dockerfile` takes `VITE_GTM_ID` and
  `GOOGLE_SITE_VERIFICATION` as `ARG`s and they do land in a layer — neither is a secret. The GTM
  id is public in the bundle by design and the Search Console token is public in the served
  `<head>` by design. Not a finding.
- **`native` and `native/core`:** `cargo audit` clean, no output.

## What was NOT checked

- **No CSP was enforced on the telemetry origin**, so the commented policy in F10-6 is unproven
  in a browser. It needs the stack up and a look at the network panel on `/map`.
- **The `apps/web` Dockerfile fix was built green and then reverted**, because that directory
  belongs to another agent this run. It is not in the tree.
- **`apps/provisioner` has no lockfile**, so nothing about its dependency tree could be audited
  at all — `npm audit` there has nothing to read.
- **The API suite ran without Postgres** (42 tests skipped, identically before and after). None
  of the skipped tests touch the zip path; the two new ones do not need a DB.
- **No container was run as a non-root user** to see whether `USER node` breaks the api's git
  backup volume (F10-12) — that needs the stack, and compose is off-limits under this card.

---

# Pentest 2026-09-22 — Cards 2 and 3, authentication & linking, config transfer / backup / demo

Plan: `.Assets/.md/PLAN-PENTEST-SEPT22-2026.md`, cards 2 (B, C) and 3 (D, E). Scope: `oauth.mjs`,
`connections.mjs`, `social.mjs`, `links.mjs`, `auth.mjs`, `config-transfer.mjs`,
`content-backup.mjs`, `demo.mjs` and their libs (`verify-gate`, `login-alert`, `secret-guard`,
`creator-identity`, `creator-proof`, `onboarding`, `demo`). Nothing was committed. The Discord bot
was never started. Every fixture written to the dev database was removed and the removal verified.

**No stack was running**, so nothing here was proven through Caddy: port 5176 answers a different
project entirely. Every finding below is measured either against the modules through the real
Fastify handlers (`app.inject`) or against the dev Postgres directly — which is how the suite runs
in CI, and is what the "measured before AND after" rule needs. What that costs is written under
*What was NOT checked*.

Suite, run the CI way (`DATABASE_URL` set, `REDIS_URL` unset): **1900 -> 1913 tests, 1913 pass, 0
fail, 0 skipped**. `test/thread-copy-abuse.test.mjs` is card 1's, untracked and in flight in the
same working tree; it is excluded from that count and its 4 failures are not this card's.

## Findings, most severe first

### F23-1 — A content-backup zip wrote any admin setting, unchecked, at a lower rank than the screen that owns it (FIXED)

**CWE-862 / CWE-269 / CWE-20.** CVSS 3.1 **6.8 medium** —
`AV:N/AC:L/PR:H/UI:R/S:U/C:N/I:H/A:L`. PR:H because the route is `requireRole('ADMIN')` +
`requireCanControlServer()` + `requireElevated()`; the point is that it is **not** SUPERADMIN, and
the door it opens is.

`POST /admin/content-backup/import` restored the `settings` section with

```js
rows.filter((r) => !SECRET_SETTING_KEYS.has(r.key)).map((r) => p.adminSetting.upsert({ where: { key: r.key }, update: r, create: r }))
```

— the four credential keys excluded and **nothing else checked**. The site's own settings door,
`PUT /admin/settings/:key`, runs every write through `checkAdminSetting` (`routes/misc.mjs:704`),
which refuses the credential keys, refuses `demo.*` (`routes/demo.mjs` owns those and clamps
them), refuses `SUPERADMIN_ONLY_SETTINGS` to an ADMIN, and validates the handful of values that
break the site when they are wrong. A hand-edited zip skipped all of it.

*Trigger, measured.* Four rows through `SECTIONS.settings.restore` with a recording client, and
the same four through `checkAdminSetting` as `role: 'ADMIN'`, against the dev database:

| planted row | the zip wrote it | `PUT /admin/settings/:key` as ADMIN |
|---|---|---|
| `marketplace.feePercentBp: 0` | yes | `403 superadmin_required` |
| `demo.session: {…}` | yes | `409 use_demo_routes` |
| `hosting.termMinMonths: 999` | yes | `400 invalid_term_bound` |
| `seo.gtmId: "not-a-tag-id"` | yes | `400 bad_gtm_id` |

The first is money: the marketplace fee is one of the two rows the site reserves for SUPERADMIN,
and an admin with the server-control grant could set it to 0 (or to 100%) through a file. The
second is F23-3's door.

*Fix.* `SECTIONS.settings.restore` is now async and puts every row through `checkAdminSetting`
with the **importing admin's own role**, writes `checkAdminSetting`'s returned (normalised) value
rather than the zip's raw one, and reports each refusal by key and reason in the response
(`refused: [{ key, error }]`) instead of dropping it silently. The route `await`s the restore —
which is what lets a section check before it writes — and still receives the operation list, so
the one-transaction-per-section guarantee is untouched. The rollback route takes the same path.

*Why it holds.* There is now one policy function and two callers, instead of two policies. A rule
the import could drift away from is a rule written twice; `checkAdminSetting` is imported, never
copied — the same discipline `lib/config-transfer.mjs` already follows for its schemas. And the
gate is the caller's live role, so an import is neither a way up (an ADMIN cannot write the
SUPERADMIN rows) nor a way down (a SUPERADMIN restoring their own backup gets it all back, which
is asserted separately).

*Tests.* `apps/api/test/content-backup-settings-policy.test.mjs`, new: the four-row table above
asserted as refusals with their exact reasons, the SUPERADMIN counterpart, and the "a restore
still hands back operations rather than running them" invariant re-asserted for the async form.
**RED at HEAD** on 2 of the 3 import tests.

### F23-2 — A leftover password-reset token reopened a CLOSED account (FIXED)

**CWE-613 / CWE-285.** CVSS 3.1 **6.5 medium** —
`AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:N`. AC:H because it needs a token that is live at the moment
the closure sweeps.

Card 2 asks whether a closed account can be revived. It could.

`anonymiseAccount` (`routes/closure.mjs`) says it removes "everything that could still let
somebody in", and removes a great deal: the password hash, every session, the refresh tokens, the
API keys, the consents, the pairwise subs, and the GitHub/Discord/Google links. It does **not**
delete `PasswordReset` rows. `POST /auth/reset/confirm` never asked whose account a token belonged
to, and `POST /auth/login` had no `closedAt` check of its own — it only ever failed on a closed
account incidentally, because there was no hash to compare against.

So: a reset token issued in the hour before the sweep ran, or a 24-hour *set a password* link from
an OAuth signup (`oauth.mjs sendPasswordSetup`), wrote a fresh hash onto the anonymised row. The
address to sign in with afterwards is not a secret: `anonymiseAccount` rewrites it to
`closed+<userId>@account.invalid`, and the user id is on display in half the admin surface.

*Trigger, measured.* Fixture account, a reset token, then `anonymiseAccount`: the row came back
`closedAt` set and `passwordHash: null`, and the token came back **live and unused**. Driven
through the real handlers at HEAD, `POST /auth/reset/confirm` answered `{"ok":true}` and
`POST /auth/login` answered with the full signed-in user object and a session cookie.

*Fix.* Two refusals in `routes/auth.mjs`, because either alone leaves the other as the rule.
`/auth/reset/confirm` reads the target's `closedAt` and, when it is set, **burns the token** (a
token that still works is one that gets tried again) and answers the same `invalid_token` as an
expired one. `/auth/login` refuses a `closedAt` row outright, in the same `invalid_credentials`
words as a wrong password — so the closed address of a real person is not confirmable from the
login form.

*Why it holds.* The login route is the one place that decides who gets a session, and it now has
its own rule rather than inheriting a side effect of what `anonymiseAccount` happens to clear. The
reset route refuses at the account, not at the token, so every future way of minting a
`PasswordReset` row is covered without being enumerated.

*Residual (owner).* `anonymiseAccount` still leaves the `PasswordReset` rows in the table. Both
consumers now refuse them, so nothing uses them — but a closure that claims to remove every way in
should also stop keeping them, and `closure.mjs` is outside this card's files. **Owner card:**
add `p.passwordReset.deleteMany({ where: { userId } })` (and `emailVerification`) to the
`Promise.all` in `anonymiseAccount`.

*Tests.* `apps/api/test/closed-account-revival.test.mjs`, new, 2 tests through `app.inject`:
the reset is refused *and* the token is burned *and* the closed row still has no password; and the
login refuses with a body byte-identical to a wrong password. **Both RED at HEAD** — `{"ok":true}`
and a full user object respectively.

### F23-3 — A planted `demo.session` never expired: the ceiling was only a ceiling on the past (FIXED)

**CWE-20 / CWE-613.** CVSS 3.1 **4.3 medium** —
`AV:N/AC:L/PR:H/UI:R/S:U/C:L/I:L/A:N`. Chained behind F23-1, which is the door.

`lib/demo.mjs normalize()` exists to re-apply demo mode's limits on the way **out** of the
database, and its docstring names the case it refuses: "an `expiresAt` in 2099 would make a demo
that never ends". The clamp is

```js
expiresAt: new Date(Math.min(expires, started + MAX_MINUTES * 60_000)).toISOString()
```

which is a ceiling relative to `startedAt` — so it caps nothing at all on a row whose **start** is
in the future. A row dated 2099 is comfortably inside its own start plus eight hours, so
`readDemoSession` found it unexpired and served it.

*Trigger, measured.* A planted row with `startedAt: 2099-01-01`, `expiresAt: +1h`, read through
`readDemoSession`: accepted, `expiresAt` 2099-01-01T01:00:00Z, **`expiresInSec` 2 280 788 983 —
26 398 days** against a `MAX_MINUTES` of 480. `PUT /admin/settings/demo.session` refuses `demo.*`,
so the way to plant it was F23-1's unchecked settings restore.

*Fix.* `const startedMs = Math.min(started, Date.now())`, used for both the reported `startedAt`
and the clamp. A session `startDemo` wrote is unaffected (it always writes `new Date()`); a
planted one now expires at most `MAX_MINUTES` after it is first read.

*Why it holds.* The ceiling is now anchored to a value the row cannot choose. Everything else
`normalize` already did right stays — `n` clamped to `MAX_ITEMS`, the `dm_[0-9a-f]{32}` id shape,
a non-integer seed rejected — and the row is still deleted rather than served when it is expired
or malformed.

*Refuted along the way.* The rest of demo mode held under the same pressure and is recorded under
*Reviewed and found safe*.

*Tests.* `apps/api/test/demo-mode.test.mjs` +1, inside the existing HTTP suite: plant the 2099 row,
`GET /admin/demo`, assert the served session expires within the ceiling. Cleanup is in a `finally`
so a failure cannot cascade into its neighbours. **RED at HEAD** (1 fail of 22), green after
(22 of 22).

### F23-4 — The export promised "no API tokens" and carried a credential FIELD (FIXED)

**CWE-200 / CWE-532.** CVSS 3.1 **4.9 medium** —
`AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:N/A:N`. The zip is meant to leave the building — that is what the
feature is for — and its own header says what is not in it.

`20fd0998` excluded the four credential **rows** from the content backup. A row is not the unit a
secret lives in. `codegraph.settings.<project>` holds a webhook `secret` beside a harmless `url`
(`routes/projects.mjs CODEGRAPH_SETTINGS_BODY`, written by `requireEditor()` — not even an admin),
and that key is not on the credential list, so the whole value went into `settings.json` under a
header promising "no password hashes, no TOTP secrets, **no API tokens**". `lib/secret-guard.mjs`
has stripped credential FIELDS as well as rows since the day it was written, and the config
transfer uses it; this exporter did not, and the two were describing the same policy.

*Trigger, measured.* A fixture row `codegraph.settings.__pentest_probe = { url, secret:
'hunter2-webhook-shared-secret' }` written to the dev database, then `SECTIONS.settings.read(p)`:
the secret came back in full. `findSecrets` on the same value: `[{ path: 'secret', reason:
'secret_field' }]` — the policy already knew, the exporter never asked. Fixture removed and the
removal verified.

*Scanned, and clean today.* All 44 non-credential `AdminSetting` rows on the dev install through
`findSecrets`: **0** would have leaked. The finding is latent, not live — stated so it is not
overstated.

*Fix.* `SECTIONS.settings.read` runs `stripSecrets` over each row's value and pushes what it
removed, by path, into an optional sink. The export route passes that sink to **every** section
(so the next one that strips something is reported without anybody wiring it up), records the
paths per section as `manifest.sections.<id>.redacted`, and adds a manifest note. The restore then
calls `keepLocalSecrets(incoming, current)` — the same helper the config transfer uses — so an
import of a stripped row keeps the secret the receiving install already has instead of silently
erasing it.

*Why it holds.* One definition of "secret" for all three exporters, which is the whole reason
`lib/secret-guard.mjs` exists. And the strip is reported rather than silent: a backup that quietly
drops a field is how somebody restores it elsewhere and spends a day wondering why the webhook
never fires.

*Tests.* `content-backup-settings-policy.test.mjs`: the `url` survives, the `secret` does not, an
ordinary row is untouched, the removal is reported by path, and a restore of the stripped row
keeps the local secret. **RED at HEAD** on 2 of them.

### F23-5 — One creator identity, two accounts, by flipping the case (FIXED)

**CWE-178 (improper handling of case sensitivity) / CWE-20.** CVSS 3.1 **3.7 low** —
`AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:L/A:N`. Low because the id must already be UNPINNED (v4), and an
unpinned id being claimable by whoever knows it is an accepted risk recorded at the route.

A Creator ID is the hex of an ed25519 public key, so two spellings are one identity — and the v5
half of the system agrees: `creatorProofGate` lowercases the claimed id before it looks for a key
pin, and `acceptCreatorProof` pins the lowercased id. `POST /link/request` did not. Its "already
linked?" check was `creatorLink.findUnique({ where: { creatorId } })`, exact, on a case-sensitive
Postgres text column — so the UPPER-case spelling of an id that is already somebody's answered
"nobody holds it" and a pairing code was issued. `POST /me/creator-links` then made a **second**
`CreatorLink` for one identity, against the "One creator id ↔ one account" rule written two lines
above it.

*Trigger, measured.* A fixture `CreatorLink` on a lowercase id, then `POST /link/request` through
the real handler: the exact spelling answered `{ linked: true }`, the upper-case spelling answered
with a fresh pairing code. Fixtures removed in a `finally`.

*Refuted.* This is **not** a way past the v5 pin, and not a way past a ban. `creatorProofGate`
lowercases, so a pinned id answers `proof_required` in either spelling; `siteban.mjs` and the
global access policy both compare `.toLowerCase()`; `feedback.mjs` lowercases the `X-Creator-ID`
header before it resolves an account. And `FreeTierClaim` is keyed on `userId` OR the creator ids,
so the case variant buys no extra free tier. What it buys is a duplicate identity row.

*Fix.* Both checks are now case-insensitive (`findFirst` with `mode: 'insensitive'`) — the
existence test in `/link/request` and the one-id-one-account test in `/me/creator-links`, so a
code minted before the fix still cannot land as a second link. The **lookups** are deliberately
left exact: lowercasing them would stop resolving any mixed-case row an older client already
created, which is a breakage, not a fix.

*Tests.* `apps/api/test/link-request-limit.test.mjs` +1: an id linked in lower case is answered
`{ linked: true }` for the upper-case spelling and no code is issued. **RED at HEAD.**

### F23-6 — `X-Creator-ID` bans are matched case-sensitively (OWNER, not fixed here)

**CWE-178.** CVSS 3.1 **5.3 medium** — `AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N`.

The same confusion as F23-5, in a file this card does not own. `routes/hosting-content.mjs`:

```js
const creatorId = req.headers['x-creator-id'] ? String(req.headers['x-creator-id']).slice(0, 120) : null;
…
const banned = policies.some((pol) => … || (creatorId && (pol.bannedKeys || []).includes(creatorId)) || matchAccountList(pol.bannedAccounts, userId, discordId)) …
```

`includes` is an exact string match, and `resolveIdentity` looks the CreatorLink up with the raw
header too. So a banned creator flips the case of its own id and **two** gates miss at once: the
key ban (the id no longer matches `bannedKeys`) and the account ban (the id no longer resolves a
`userId`, and a BMM sync carries no session cookie to fall back on). The whitelist misses the same
way, which is a nuisance rather than a hole.

Not fixed here: `hosting-content.mjs` belongs to no card in this run's file split and three other
agents are in this working tree. **Owner card**, and the patch is small: lowercase once in
`resolveIdentity` (`String(...).slice(0, 120).toLowerCase()`) and compare the policy arrays
case-insensitively rather than with `includes`, since stored entries may be mixed case. A test
belongs with it: a repo whose `bannedKeys` holds the lower-case id must refuse the upper-case
header.

## Reviewed and found safe (worth recording, so it is not re-attacked blind)

- **Steam OpenID 2.0** (`connections.mjs`). Every angle the card names, refuted.
  `steamAssertionShape` pins `openid.ns` to the 2.0 URI, refuses any `mode` but `id_res`, pins
  `op_endpoint` to `https://steamcommunity.com/openid/login`, requires `identity === claimed_id`
  against `^https://steamcommunity\.com/openid/id/(\d{17})$`, and requires all six of
  `op_endpoint, claimed_id, identity, return_to, response_nonce, assoc_handle` to be in the signed
  list. `return_to` is compared against the value **recomputed from the signed state that came
  back**, not against a prefix — extra query parameters change it and are refused. The
  `check_authentication` body is rebuilt as a string-only copy of the `openid.*` keys, so a
  repeated parameter (an array in the parsed query) cannot smuggle a second value past what was
  checked. Replay is refused twice over: the browser-bound `bcw_connect` cookie is single-use, and
  a verified `response_nonce` is burned. The in-process nonce map does not survive a restart — but
  the state that carries the assertion names a fixed `uid`, so a replay can only re-link the same
  connection to the same account.
- **The link-conflict cookie** (`oauth.mjs`). HMAC domain-separated from the OAuth state
  (`conflict.${payload}` vs the bare payload), so neither can be presented as the other. It is
  bound to `uid` and `/me/oauth/conflict` refuses a blob whose `uid` is not the caller's, clears
  it on read, and it dies after 5 minutes. It carries a masked address, a 64-character display
  name and a `passwordless` boolean about an account whose provider identity the reader has just
  proved they control. Replay inside the window is by the same account, about the same fact.
- **Creator key v5** (`creator-identity.mjs`, `creator-proof.mjs`). Downgrade: a `bmmc1` proof for
  a pinned id is `upgraded_key_required`, and a ban is keyed on the Creator ID, which v5 keeps —
  so upgrading or downgrading changes no ban. Fork: a chain must contain the pinned `kid` **at the
  index it was pinned at** (`v.kids[pin.seq] !== pin.kid`), and a shorter chain is `key_retired`;
  the racing-first-proof path re-reads the winner and applies the same rule. Replay: the nonce is a
  primary key in Postgres, not a process map, so a restart does not forget it, and it is burned
  before anything else is written. Site binding: `aud` is compared against this deployment's own
  origin and is inside the signed bytes; the `bmmc5.` prefix is inside them too, so a v5 proof
  cannot be relabelled `bmmc1.` to skip the nonce.
- **The verify gate** (`lib/verify-gate.mjs`). Deny-by-default for every write, so "a route added
  since that should be behind it" cannot exist by construction — the question is whether the
  ALLOW list is too wide, and it is not: `/auth/**` is credentials only (10 write routes, all of
  them register / verify / reset / login / logout / oauth-link), and the `/me/*` entries are the
  account's own settings, its notifications, its sessions and leaving. `normalizePath` strips the
  query, the fragment, a trailing slash and one `/api` prefix; `segMatch` cannot be walked past a
  segment (Fastify does not resolve `..` in a route path, and the edge normalises before us).
  **The bypass worth naming and ruling out**: the gate reads `req.cookies.bcw_session` only, so a
  credential that carries no cookie would walk around it — and the only such credential is an
  `ApiKey`, whose two minting routes (`/me/api-keys`, `/me/notifications-key`) are both refused by
  the gate. `presentedKey()` accepts `Authorization: Bearer` and `X-Api-Key` for API keys only;
  there is no header path to a session JWT anywhere in `lib.mjs`.
- **Login alerts** (`lib/login-alert.mjs`). No suppression and no enumeration found. The dedup key
  is `(userId, reason, fingerprint)` and only a successful sign-in can write one, so it cannot be
  pre-poisoned; `knownFingerprints`/`knownCountries` come from the account's own `Session` rows,
  which only the owner can create. Matching the victim's User-Agent does silence `new_device` —
  that is the documented cost of a coarse fingerprint — but `new_country` and `after_failures`
  still fire, and `after_failures` is the one that fires on a **known** device. Nothing here runs
  before authentication, so there is no oracle.
- **Config transfer import** (`lib/config-transfer.mjs`). Genuinely the stronger of the two import
  doors and the model F23-1 was fixed towards: SUPERADMIN, every value checked with the schema
  **imported from** the live admin route, `exclusionReason` refusing the credential and runtime
  keys by key, `findSecrets` refusing a planted credential on the way in, `keepLocalSecrets`
  preserving what the receiving install holds, and a whole-bundle `findSecrets` on the way out
  that throws rather than shipping. A domain with one bad item is not applied at all.
- **Demo mode, the rest of it.** `sessionMatches` is `safeEqual`, so the session id is not a
  timing oracle; every route is `requireRole('ADMIN')` (which carries the admin 2FA gate) and the
  guard runs before the handler, so a guess never learns whether a demo is running; `stopDemo`
  deletes by the `demo.` **prefix** and `demoAudit` counts what is left and names it, and both
  throw rather than reporting zero on a database error. `DELETE /admin/demo` answers 500 if
  anything demo survived, so "off" cannot be reported over a leftover. Apart from F23-3, "off"
  could not be made to lie.

## Open — recommendations, not changed

- **`/link/request` still hands a stranger the pairing code of an UNLINKED, UNPINNED creator id.**
  Unchanged, recorded, and the owner's decision: it is the compatibility path for clients with no
  v5 key, the residual risk is written out at the route, and the cure is a v5 key on the id
  (`/link/upgrade`). F23-5 narrowed it — an id that is already LINKED is now refused in either
  spelling — but a never-claimed id is still first-come.
- **F23-2's residual and F23-6**, above, both owner cards.
- **`hitLinkLimit` and the Steam nonce map are per-process.** Both say so. An attacker across many
  source addresses and many replicas is not what they stop; they raise the cost of enumeration.

## What was NOT checked

- **Nothing went through Caddy.** No BCWEB stack was running (port 5176 serves an unrelated
  project), so the edge's own behaviour — the `/api` strip, header handling, the rate limiter's
  `X-Forwarded-For` key under a real proxy — is not covered by anything here. The handler-level
  proofs use `app.inject`, which skips the edge by design.
- **No real provider round trip.** GitHub, Discord, Google, Twitch and Steam were attacked at the
  code that validates their answers, never by holding a real assertion. `connectBound` /
  `verifyState` were read and reasoned about, not exercised against a live redirect.
- **The conflict cookie was not driven through a browser**, so "another account cannot read it" is
  argued from the `uid` check and the `httpOnly`/`sameSite:lax`/`path:/` attributes, not observed.
- **`/link/lookup`** was read (shared secret, `safeEqual`) and not attacked: it needs
  `LINK_LOOKUP_SECRET`, and the telemetry service it serves was out of scope for these two cards.
- **The web side of any of this.** `apps/web/src/**` belongs to another agent this run and was not
  read, so nothing is claimed about what the admin screens do with the new `refused` list or the
  manifest's `redacted` paths.

---

# Pentest 2026-09-23 — Cards 1 and 4, conversations and data exposure

Plan: `.Assets/.md/PLAN-PENTEST-SEPT22-2026.md`, cards 1 (A — conversations, files, signed
copies) and 4 (F, J — data exposure and route guards). Scope: the Sept 22 conversation rework
(`20fd0998`) and every route added since Sept 9. Local stack only, dev database, fixtures
removed. The Discord bot was never started. Nothing was committed and nothing was pushed.

Method: read, then attack, then **refute**. Every finding below was measured with a canary
value or a counted side effect BEFORE the fix and again after; every one carries a test that
was red first. Several leads that a reading suggested were dropped because the request refused
them — they are in "Angles that found nothing".

Tests: `apps/api/test/thread-copy-abuse.test.mjs` (6 new), `apps/api/test/repo-credentials.test.mjs`
(2 new), one rewritten assertion in `apps/api/test/conversation-copy.test.mjs`. Suite run as
CI runs it (`DATABASE_URL` set, `REDIS_URL` unset): **1926 tests, 0 skipped, 1925 pass** —
1916 before this work, green then. The one failure is `legal-freshness` /
"says a date that its own history agrees with", which reads the real
`apps/web/src/pages/legal.jsx`; that file is being edited by another agent in this shared tree
right now and is not touched by anything here. It was green on the first run of this session
and went red between two runs with none of my files changed in between.

## Findings, most severe first

### F1 — Closing a conversation was an unbounded mail sender, aimed at any address (FIXED)

**CWE-770 / CWE-405.** CVSS 3.1 **6.5 medium** — `AV:N/AC:L/PR:L/UI:N/S:C/C:N/I:L/A:L`
(S:C because the harm lands on a third party's mailbox and on our sending reputation, not on
this server).

**Trigger.** `POST /me/threads/:id/close` calls `mailCopiesOnClose`, which mails each side a
signed copy with a zip attached. `close` and `reopen` are ordinary participant moves with no
rate limit and no memory, so `close, reopen, close, reopen, …` sends a mail per cycle, for
ever. The address is not the attacker's: on an anonymous thread it is whatever was typed into
the contact form, never confirmed. So:

1. Mallory owns a repo (any account can create one).
2. She opens an **anonymous** thread to her *own* repo — the "not to yourself" check is
   `if (uid && target.ownerId === uid)`, and an anonymous opener has no `uid` — with
   `email: victim@example.com`.
3. Signed in as the owner, she loops close/reopen.

Measured before the fix: **6 cycles produced 12 mails, 6 of them to the chosen address**, each
with a 2.8 kB zip attached, subject "Your copy of the conversation: …", from our domain. The
sibling route knew better: `POST /me/threads/:id/copy/mail` is capped at 5 an hour.

**Fix** (`apps/api/src/routes/threads.mjs`). Two layers.

* `claimCopyMail()` — a copy for a SIDE goes out at most once per 24 h, recorded in the
  database (`ConversationCursor`, under its own `kind: 'thread-copy'`, claimed by
  compare-and-set so two closes racing cannot both send). Not a one-shot flag: a conversation
  genuinely reopened weeks later and closed again should get its copy.
* `close` / `reopen` / `archive` now carry `rateLimit: { max: 30, timeWindow: '1 hour' }`.

**Why it holds.** The amplifier was "one close, one mail" with closes free. The claim removes
the multiplier at the source — the second close of the same conversation sends nothing at all,
whoever asks and however often — and the tap bounds the request rate even if a future caller
reaches `mailCopiesOnClose` by another path. It is in the database, so a restart does not
reopen it, and it is per side, so the answering side being several people still costs one mail.

**Test (red first).** `thread-copy-abuse.test.mjs`, "close/reopen in a loop mails ONE copy per
side, not one per close": 5 cycles, asserts at most 1 mail to the third-party address and at
most 2 in total. Before the fix: 10 and 10. `conversation-copy.test.mjs` also now asserts that
a second `mailCopiesOnClose` on the same thread returns 0.

### F2 — An admin read and exported any private conversation without passing the 2FA gate (FIXED)

**CWE-863 / CWE-306.** CVSS 3.1 **6.5 medium** — `AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:L/A:N`.

**Trigger.** `participant()` in `threads.mjs` lets `isStaff(user)` (ADMIN / SUPERADMIN) into any
conversation. The routes that use it are `requireRole()` **with no roles**, and `requireRole`
only calls `ensure2fa` when roles were named — so the staff path never met the wall. The admin
door on the same data does: `requireCap('manage_reports')` always calls it.

Measured before the fix, with one ADMIN account, `totpEnabled: false`:

| request | before |
|---|---|
| `GET /admin/threads/<id>` | 403 `2fa_required` |
| `GET /me/threads/<id>` | **200**, `side: "staff"`, the whole thread |
| `GET /me/threads/<id>/copy` | **200 application/zip**, the signed export |

Same account, same data, two doors, one unlocked — and the member door writes no audit line
either, while `DELETE /admin/threads/:id` does.

**Fix.** `ensure2fa` is now exported from `lib/lib.mjs` (with the reason written above it), and
`participant()` calls it on the branch that is neither owner nor sender. Participants are
untouched: the gate only ever runs for somebody who is in neither side of the conversation.

**Why it holds.** The gate is attached to the POWER rather than to a URL prefix, which is what
the bug was: `/admin/*` was treated as the definition of a staff surface, and a staff surface
that is not named `/admin/*` slipped past. Any future route that reaches a conversation through
`participant()` inherits it.

**Test (red first).** `thread-copy-abuse.test.mjs`, "a staff account without 2FA cannot read,
or export, a conversation it is not in" — asserts the admin route and the member route now
agree (403 `2fa_required` on both, and on `/copy`).

**Left open (owner):** a staff read of a conversation they are not in still writes no audit
line, on either door. `DELETE`, `close`, `block` and `hide` all do.

### F3 — A MOD received the share key, sync password hash and sandbox keys of every repo (FIXED)

**CWE-200 / CWE-522.** CVSS 3.1 **6.5 medium** — `AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:N/A:N`.

**Trigger.** `ser()` in `routes/repos.mjs` was a **spread** of the `ServerRepo` row minus one
column, with a comment saying `dashPassword` is removed "so it can never leak to a client".
Four more secrets sit in that row and rode out with it. `GET /admin/repos`
(`requireCap('manage_repos', 'MOD')`) fetches with `include`, not `select`, so a MOD received,
for **every repo on the site**:

| column | what it is |
|---|---|
| `shareKey` | the whole of `/r/<id>?k=…` — access to a private repo's page |
| `syncPasswordHash` | argon2 hash of the owner's download password (offline crackable) |
| `settings.access.keys` | the sandbox keys a whitelisted client presents to download |
| `settings.access.ips` | the owner's whitelisted addresses |
| `accessEmails[]` | the collaborators' e-mail addresses |

Measured with canary values: all five present in the body of `GET /admin/repos` as a plain
`MOD`. `GET /me/repos` also returned the owner their own `syncPasswordHash` — a password hash
has no reader in a browser, and the sibling model already knew it
(`hasPassword: !!c.syncPasswordHash` in `catalogs.mjs`, `hasSyncPassword` in
`repo-dashboard.mjs`). The public `GET /repos` was already safe: its query uses an explicit
`select`.

**Fix.** `ser()` now strips `syncPasswordHash` for everybody and reports `hasSyncPassword` and
`hasShareKey` instead. A new `serStaff()` additionally removes `shareKey`, `accessEmails` and
the key/IP lists inside `settings`, replacing them with counts; it is used by the four staff
routes that return somebody else's repo (`GET /admin/repos`, `POST /admin/repos/host`,
`PATCH /admin/repos/:id`, `POST /admin/repos/:id/feature`). The owner keeps their own share key
and their own whitelist — they need both.

**Why it holds.** `manage_repos` and `MOD` are moderation grants, not "open every private repo".
The booleans and counts say everything a moderation screen has to say, and the thing that made
this survivable — a spread pretending to be an allowlist — is now bounded by a test written as
canaries rather than by a reviewer noticing a new column.

**Test (red first).** `repo-credentials.test.mjs`, two tests: a MOD's listing contains none of
the five canaries but still reports `hasDashPassword` / `hasSyncPassword` / `hasShareKey`; the
owner keeps `shareKey` and their sandbox keys and never receives either password hash.

### F4 — The path can be the credential, and only the query string was redacted (FIXED)

**CWE-532.** CVSS 3.1 **5.3 medium** — `AV:N/AC:H/PR:L/UI:N/S:U/C:H/I:L/A:N`.

**Trigger.** The August fix for logged share keys (see "Re-audit — 2026-08-22") strips the
QUERY STRING: `pathOnly(url) = url.split('?')[0]`, used by the `req` log serialiser, by the 500
handler and by `ErrorEvent.path`. On a handful of routes the secret is in the **path**:

* `/threads/t/<accessToken>` — read a private conversation, answer in the sender's name,
  download the signed copy, make the server mail it. 24 random bytes, no expiry, survives
  archiving and closing.
* `/f/<token>` — a mail attachment or MYO deliverable link.
* `/auth/oauth/link/<token>` — binds a provider to an account.

Demonstrated with a canary: a request to `/threads/t/SECRETTOKEN123?k=QUERYSECRET` produced

```
{"level":30,"req":{"method":"GET","url":"/threads/t/SECRETTOKEN123","queryKeys":["k"]},"msg":"incoming request"}
{"level":50,"path":"/threads/t/SECRETTOKEN123","msg":"request error"}
```

— the query secret masked, the path secret whole, on **every** request (level 30), and into
`ErrorEvent.path` on a 500. `ErrorEvent` is readable with `manage_analytics`, a capability that
grants no access to any of those conversations. Exactly the class the earlier fix was written
for, missed because the rule it wrote down was "a query string is a secret" rather than "these
routes carry a bearer token".

**Fix.** `redactPath(url)` in `lib/errorlog.mjs`: `pathOnly`, then the segment after a
credential-bearing prefix (`/threads/t/`, `/f/`, `/auth/oauth/link/`) replaced with an ellipsis,
the rest of the path kept (`/threads/t/…/files/abc` still says what was asked for). Used by
`recordServerError` **and** by both log sites in `server.mjs`, so the row and the line cannot
disagree — which is the mistake the August fix itself made and had to correct.

**Why it holds.** Prefix-matched, so a route added under `/threads/t/` is covered the day it is
written, and a path that merely looks similar (`/me/threads/<id>`) is not, because an id is not
a credential and a log with no identifier is a log nobody can use.

**Test (red first).** `thread-copy-abuse.test.mjs`, "a path that IS a credential is redacted
out of logs and error rows" — seven cases, including the negative one.

### F5 — A blocked sender could still make the server mail them (FIXED)

**CWE-770 / CWE-863.** CVSS 3.1 **3.7 low** — `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L`.

**Trigger.** `POST /threads/t/:token/copy/mail` looked the thread up by token and mailed a copy
with no status check. Staff blocking a sender sets every one of their threads to `blocked`; the
unread-mail flush already skips a blocked thread, this route did not. Measured: 200 `{ok:true}`
on a thread set to `blocked`. A block is the one tool moderation has against a sender who costs
us something, and this was the hole in it.

**Fix.** 403 `blocked` when `status === 'blocked'`. Reading the conversation by token still
works after archiving, closing and blocking — that is the deliberate rule everywhere here and
is unchanged; what stops is a button that makes the server send mail.

**Test (red first).** `thread-copy-abuse.test.mjs`, "a blocked sender cannot keep making the
server mail them".

### F6 — `/conversation-copy/verify` said "valid" without showing what was signed (FIXED)

**CWE-345.** CVSS 3.1 **4.3 medium** — `AV:N/AC:L/PR:N/UI:R/S:U/C:N/I:L/A:N`.

**Trigger.** The archive carries `conversation.html` (the readable copy),
`conversation.payload.json` (the signed bytes) and `conversation.sig`. **Nothing signs the
HTML.** A recipient can edit one sentence of `conversation.html`, hand somebody the whole
archive, and the page they are told to check it on — `POST /conversation-copy/verify`, which
returned only `subject`, `about`, `with`, a message *count* and the issue date — answers
"valid". Editing a body rather than adding a message leaves the count right too. The verifier
exists to contradict a doctored copy and could not, because it never showed the authentic text.

**Fix.** The route now also returns the messages from the signed payload (`at`, `side`, `from`,
`body`, file names and sizes, capped at 2000). Not a disclosure: the caller already holds the
signed document those bytes came from.

**Why it holds.** The check becomes a comparison instead of a badge — the reader sees the true
conversation beside the one they were handed.

**Owner item:** the web page at `/verify-copy` must render `messages` for this to reach a human.
`apps/web/src/**` belongs to another agent this run, so the API half is in and the page half is
not.

**Test (red first).** `thread-copy-abuse.test.mjs`, "verifying a copy shows what was signed, so
a doctored readable copy is contradicted".

### F7 — A deleted conversation left its cursors behind (FIXED, hygiene)

`ConversationCursor` names its conversation by a plain string, so nothing cascades.
`DELETE /admin/threads/:id` deleted the thread, its messages (cascade) and its files, under a
comment saying "what is kept is the audit line" — and left the read receipts, the pending
"you have unread messages" clock and (now) the copy claims pointing at a conversation that no
longer exists. Fixed in the same route — and, because that route is only one of four places a
conversation dies (the staff delete, a team being dissolved, account erasure, the demo clear),
`pruneOrphanCursors()` in `lib/receipts.mjs` is the backstop: run each sweeper tick, bounded
per pass like every other retention step, covering all four cursor kinds.

Not a vulnerability; a promise the code did not keep, and a row that would have let a later
reader tell that a conversation had existed, and name its id, after somebody was told it was
gone. Run once against the dev database while writing this: **5 orphan cursors**, all debris
from conversations already deleted.

**Test (red first).** `thread-copy-abuse.test.mjs`, "a cursor whose conversation is gone is
swept, and a live one is left alone".

## Open — documented, not changed

### O1 — `GET /c/:slug` hands a private catalogue's share key to a whitelisted viewer (OWNER)

**CWE-200, low.** `ser(c)` in `routes/catalogs.mjs:293` is a proper allowlist but it *names*
`shareKey`, and it feeds the public routes `GET /c` and `GET /c/:slug`. `catalogGate` admits a
caller to a **private** catalogue either with a matching `?k=` **or** through
`accessListMatches(acc, identity)` — so a whitelisted creator id or IP that never held the share
key receives it in the response body, and can pass the link to anybody. Verified by request that
a private catalogue refuses an anonymous reader (403) and echoes the key to a reader who already
presented it (harmless); the access-list path was **not** reproduced — it needs a signed
identity — so this is reported on the code, not on a measurement. Fix: drop `shareKey` from the
shared serialiser and add it only where the owner reads their own catalogue. It is one field in
one allowlist, but `ser` also feeds `/me/catalogs` and the copy-share-link UI, and
`apps/web/src/**` is another agent's this run, so it was not changed blind.

### O2 — `GET /admin/settings` returns nested secrets (OWNER)

`routes/misc.mjs:4001` filters by an exact-name denylist (`SECRET_SETTING_KEYS` in
`lib/secret-guard.mjs`: `bot.token`, `kofi.token`, `backup.signingKey`,
`identity.attestation.privateKeyPem`) and does **not** run `stripSecrets()`. So
`codegraph.settings.<projectKey>.secret` — the GitHub webhook HMAC
(`routes/code-webhook.mjs:41`) — reaches the response whole, although its own route deliberately
masks it (`routes/projects.mjs:825`, `hasSecret: !!sec.secret`, with a comment saying it is
"written but NEVER read back"). ADMIN-only, and ADMIN holds every capability, so this is defence
in depth rather than a privilege break; it matters because the same hole swallows any secret
pasted into a free-text setting. Fix: run the existing `stripSecrets` / `secretShape` over the
values, not just over the names. Not applied — `misc.mjs` is four thousand lines of shared
surface and three other agents are in this tree.

### O3 — Raw exception text in response bodies (OWNER)

Sixteen routes send `String(e.message)` to the client. The public ones —
`/projects/:key/{progress,releases,activity,community}` (`projects.mjs:1007, 1044, 1111, 1133`)
and the four `/showcase/:slug/*` twins (`showcase.mjs:113, 136, 161, 175`), all `optionalAuth()`
— are the ones worth changing. Staff-only ones that hand back filesystem errors with absolute
server paths: `devtools.mjs:218, 277, 416`; `lib/gitbackup.mjs:215` returns subprocess
**stderr**. No route returns a Prisma code or a SQL string: every `P2002` / `P2003` / `P2034`
site branches on the code and returns a fixed token. Two near-misses send `e.code` blind and
would echo `"error":"P2002"` if a Prisma error escaped the same `try`:
`hosting-content.mjs:363, 420` and `repo-dashboard.mjs:155, 218`.

### O4 — `fileSer` spreads a `RepoFile` row, storage key included (OWNER)

`hosting-content.mjs:30` and `repo-dashboard.mjs:18` both do `{ ...f, size: Number(f.size) }`,
which ships the raw object-storage `key`. It reaches `GET /repos/:id/dashboard`, whose guard
admits the owner, a whitelisted collaborator **or anyone holding the dashboard password**. Same
class as F3, different model; not fixed because the dashboard is a shared surface and the fix
wants a real allowlist rather than a second denylist.

### O5 — The anonymous conversation link never expires (OWNER DECISION)

24 random bytes (192 bits — the entropy is fine) and no expiry at all. It survives
auto-archiving, closing and a staff block, and there is no rotate or revoke. That is deliberate
— an anonymous sender has nothing else — but it means a mail forwarded two years ago still
opens a conversation and downloads its signed copy. Worth a decision: expire N months after
`lastActivityAt`, or offer the answering side a revoke.

## Angles that found nothing — stated so they are not re-run

* **`/conversation-copy/verify` as an oracle.** Key confusion: a document carrying its own
  public key and a signature made with the matching private key returns `tampered`; the route
  reads `signingKey(p)` and never the document. Canonicalisation: an added payload key, a
  removed one (`recipient.name`) and a one-byte change to a message body all return `tampered`.
  `keyId` is compared with `!==` but it is public and is only a pre-filter. **Zip-slip does not
  apply** — the route takes JSON, never an archive, and `buildCopyZip` only ever writes seven
  fixed names.
* **Attachments.** Proved by request on a team inbox with attachments enabled: a filename of
  `../../../../etc/passwd` is sanitised to `.._.._.._.._etc_passwd` and the key is
  `contact/<threadId>/<uuid>-<name>`; `image/svg+xml` is refused 415; HTML bytes declared
  `image/png` are stored but served `Content-Type: image/png` with
  `X-Content-Type-Options: nosniff` and `Content-Disposition: attachment`, so no browser renders
  them on our origin. **One thread's token cannot address another thread's file** — `sendFile`
  filters on `{ id, threadId }`; measured 404.
* **Thread IDOR.** A member who is neither participant nor staff gets 404 on `/me/threads/:id`
  (not 403 — existence is not confirmed). `?project=<ref>` on `/me/threads` is ANDed with the
  viewer's own rule, so it narrows and cannot widen.
* **Route guards (card 4, J).** A parser that reads the whole handler — balanced-brace options
  object, hoisted `const` guards resolved transitively, and the body, because
  `if (!botAuth(req, reply)) return;` is a guard — over all **1151** routes. 121 carry no guard
  expression and **every one of them is explicable**: `/bot/*` (shared secret, checked in the
  body), `/v1/*` (`apiAuth(scope)`), `/oauth2/*` (`oauthBearer(scope)`), `/agent/*`
  (`authAgent`), `/repos/:id/dashboard/*` (`resolve()`), `/threads/t/:token/*` (the token IS the
  credential), plus the genuinely public ones (`/v1/scopes`, `/v1/webhook-events`,
  `/bot/invite`, `/repos/:id/dashboard/{unlock,lock}`). **No `/admin/*` route and no `/me/*`
  route is missing its guard.** The earlier parser's 19 false positives were all the
  hoisted-const and multi-line-options shapes; this one produces none of them. The script was
  kept out of the tree — it is a probe, not a gate.
* **MailLog (card 4, F).** Correct as built: the list masks (`go•••@gm•••.com`), the `q` filter
  searches `subject` and `mailId` and **never** the address (so it cannot be a "was mail sent to
  X?" oracle), the full address is on the detail route only, both routes are
  `requireCap('manage_users')`, subjects and transport errors go through `redactMailText`, and
  the table has no body column.
* **Catalogue traffic `keyed` (card 4, F).** `catalogAccessRow` (`lib/access-traffic.mjs:59`)
  consumes `req.query.k` only to compute a boolean via `safeEqual`; the value is never assigned
  to a column, the row has no `url` field, and `path` is a caller-supplied constant, not
  `req.url`. The repo side is different by design: `RepoAccessEvent.accessKey`
  (`hosting-content.mjs:47`) stores the sandbox key in clear for 30 days, visible only on the
  owner's `/repos/:id/dashboard/traffic` — documented, owner-visible, left alone.
* **Rate limits on the thread routes.** `POST /threads` 12 per 10 min,
  `/me/threads/:id/messages` 40/h, `/threads/t/:token/messages` 10/h, both `copy/mail` 5/h, plus
  the database-counted `userPerHour` / `anonPerHour` / `messagesPerHour`. The gap was the state
  changes, and only those (F1).
* **The anonymous unread mail as a spam or enumeration primitive.** `flushAnonThreadMails` mails
  only the address the thread already carries, one mail per burst (`anonMailDebounceMin`, 10 min
  by default), claimed with compare-and-set so the timer and the sweeper cannot both send, and
  skipped entirely on a blocked thread. It enumerates nothing.
* **Public repo listing.** `GET /repos` never carried a share key: its query uses an explicit
  Prisma `select`, so F3's columns were never fetched. Measured, not assumed.

## Not covered by this pass

* The web half of F6 — `/verify-copy` must render the `messages` the API now returns.
  `apps/web/src/**` is another agent's this run.
* O1 to O4 are unfixed on purpose (the reason is given with each).
* The API server was **left running** during the test runs, against the house rule, because
  three other agents share this tree and this database. `rollup.test.mjs` passed anyway, so the
  sweeper had not written `analytics.rollupAt` during the window; a run on a quiet machine would
  be a firmer 1925.
* No browser was involved. Every statement here comes from a request, a canary value found in a
  response body or a log line, or a counted side effect.

---

# Pentest 2026-09-23 — Cards 5 and 6, bot surfaces and CSS/HTML injection

Plan: `.Assets/.md/PLAN-PENTEST-SEPT22-2026.md`, cards 5 (G) and 6 (H, plus the B.MD half).
Scope: every route the bot's shared secret reaches, the application-emoji map and the new
admin-added icons (`7fd74a7f`), the giveaway draw, the warn ladder, the alert incident model,
the Stripe status fetch, `/bot/status` and presence templating; then `scopeCss` again after
`7447367f`, the B.MD sanitize schema, and the charity `code` block model. **The Discord bot was
never started and no Discord API call was made** — everything here is reading, `node --check`
and tests. Nothing was committed. Tests were run the CI way
(`node --test test/*.test.mjs`), and the concurrency work also against the local dev Postgres;
fixtures clean up after themselves (verified: zero rows left behind).

## The bot's shared secret, and what it is worth

`botAuth()` (`apps/api/src/lib/lib.mjs:200`) compares `x-bot-secret` against
`BOT_SHARED_SECRET || LINK_LOOKUP_SECRET` with `safeEqual`. One secret, no scoping, no expiry,
no per-route capability. It reaches **59 routes** across five files:

| File | Routes | What the secret authorises |
|---|---|---|
| `routes/bot.mjs` | 51 | the bot's whole config, **`GET /bot/token` (the live Discord bot token)**, guild settings / language / features, per-guild storage mode, warnings, member activity and roster sync, giveaway create / enter / posted / **drawn**, the economy (`accrue`, `buy`, `gift`, `reveal`, `casino`, `casino/settle`, balance and history for ANY Discord id), pairing codes (`/bot/link/issue`), the DM and announcement queues, blog / Ko-fi / payment announcement state, error rows and the heartbeat |
| `routes/bot-emoji.mjs` | 3 | the icon list, each 128×128 tile, and `PUT /bot/emoji/map` — the stored `name → id` map that becomes `<:name:id>` inside bot messages |
| `routes/server-perf.mjs` | 4 | read every unannounced / pending **alert** and mark them announced or posted |
| `routes/economy-admin.mjs` | 1 | the current economy season |
| `routes/status.mjs` | 1 | `/bot/status` |

**If it leaks:** the holder reads the Discord bot token (and from there owns the bot), mints
economy points for any Discord id, issues and reads warnings against any member, re-points every
guild's log channel, declares themselves the winner of any running giveaway, declares themselves
the OWNER of any guild through the heartbeat's `guildList[].ownerId` — which is what the
user-facing guild dashboard trusts (B10) — and silences every server alert by marking it
announced. That is the design (the bot is a trusted process on a host we control) and it is
worth writing down that **nothing narrows it**: the secret is the entire authorisation model for
all 59 routes. The mitigations in place are that it is a boot-guard-enforced env variable, that
it is compared in constant time from ONE implementation (the two copies that had drifted are
gone), and that the routes validate their inputs strictly.

Two routes take an ACTOR on top of the secret: `GET/PUT /bot/guilds/:id/settings` reads
`actorDiscordId`, runs it through `canConfigureGuild`, and audits against the linked account
rather than the snowflake. `PUT /bot/guilds/:id/language` does not — with the secret, any
guild's language can be set. Inside the bot's trust boundary, so not a finding.

## Findings, most severe first

### F5-1 — The warn ladder never fired for the member who spammed fastest (FIXED)

**CWE-367 (TOCTOU race).** CVSS 3.1 **6.5 medium** — `AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:H/A:N`
(PR:L — any member of a server the bot is in; no site account needed).

`issueWarn()` (`apps/api/src/lib/warns.mjs`) counted the warnings still standing and then wrote
one, in two statements:

```js
const count = 1 + await p.botWarn.count({ where: { discordId, revokedAt: null } });
const triggered = actionFor(count, …);     // EXACT match on the count, by design
const warn = await p.botWarn.create({ … });
```

`actionFor` matches the count **exactly** — deliberately, so a step fires once and not for ever
after. A count that no warning ever claims is therefore a step that never fires. And warnings
arrive together in precisely the case the ladder exists for: automod runs one handler per
`messageCreate` (`apps/bot/src/features/automod.mjs` → `recordAutomodWarn` → `api.warn` →
`POST /bot/warns`), so a member posting four messages in the same instant produces four
concurrent calls.

**Trigger, measured against the dev Postgres** (`apps/api/test/warn-ladder-race.test.mjs` run
against the pre-fix module):

```
counts claimed by 4 concurrent warnings:  [1, 1, 1, 1]
counts claimed by the next 4:             [5, 5, 5, 5]
```

Eight warnings landed. The default ladder is 3 → timeout, 5 → kick, 7 → ban. **The 3 and the 7
were never anybody's count, so neither fired**, and the 5 fired four times at once. Spamming
faster bought fewer consequences than spamming slowly, and the moderation queue recorded four
identical kick requests for one offence.

**Fix.** The count and the insert are one transaction, serialised per target by a Postgres
transaction-scoped advisory lock:

```js
const { count, triggered, warn } = await p.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`botwarn:${discordId}`}))`;
  … count, decide, create …
});
```

**Why it holds.** Two statements that must agree are now one critical section; the lock is keyed
to the member, so warnings for different people never wait on each other, and it is released by
the commit or the rollback — no path leaks it. No migration was needed (a unique ordinal column
was the alternative). The queued action, the moderation log and the DM stay outside the
transaction so it is short. The second caller blocks and then counts the row the first one
wrote, so every warning gets its own number.

**Test.** `apps/api/test/warn-ladder-race.test.mjs` — eight concurrent `issueWarn` calls must
claim `[1..8]` and fire each ladder step exactly once. RED before (numbers above), GREEN after.
Skips cleanly without `DATABASE_URL`, like every other DB test here.

### F6-1 — `scopeCss`: two more ways to write a URL it could not read (FIXED)

**CWE-20 / CWE-116.** CVSS 3.1 **5.4 medium** — `AV:N/AC:L/PR:L/UI:R/S:C/C:L/I:L/A:N`
(PR:L — a project editor, or an admin with the charity card; the victim is every visitor).

`7447367f` closed three of these. The rule it added — every string inside `image-set()` /
`src()` is a URL and goes through `urlOk` — was a regex,
`\b(?:-webkit-|…)?(?:image-set|src)\s*\(([^()]*)\)` with `(['"])((?:[^'"\\]|\\.)*)\1` over the
inner text. Two ways of writing the same string walked past it, and **both reported nothing
refused**, which is the worse failure mode: the author is told the stylesheet was accepted whole.

1. **A line continuation.** A backslash before a newline inside a CSS string is deleted by the
   browser and the halves are joined. The string regex cannot match it (`\\.` — `.` is not a
   newline), so no string was found, `bad` stayed `null`, and the whole function was returned
   untouched:

   ```css
   a { background-image: image-set("https:\
   //evil.test/x.png" 1x) }        /* refused: []   — and the browser fetches it */
   ```

2. **`var()` indirection.** `([^()]*)` cannot see past a nested function, so
   `image-set(var(--u) 1x)` never matched at all, with the URL parked in a custom property —
   or, since `@property` bodies are kept verbatim, in an `initial-value`:

   ```css
   a { --u: "https://evil.test/x.png"; background-image: image-set(var(--u) 1x) }
   @property --u { syntax: "*"; inherits: false; initial-value: "https://evil.test/x.png" }
   ```

Impact is the channel this file exists to close: every visitor to a studio page, a charity card
or a site theme fetches an attacker-chosen third-party URL — their IP and User-Agent, and with
attribute selectors the usual CSS exfiltration primitive.

**Fix** (`apps/web/src/lib/css-scope.js`):

* `decodeCssEscapes` now removes a backslash-newline first, alongside the hex escapes, for
  exactly the reason the hex escapes are decoded there: every later rule matches literal text,
  and this is how you write the same text without it.
* the regex is replaced by `refuseImageFns()`, a **balanced-parenthesis scanner** that is
  fail-closed. It reads the whole argument list (skipping strings correctly), refuses any nested
  function that is not `url` / `src` / `image-set` / `type` / `format` / `tech` / `local` — so
  `var()`, `env()` and `attr()` are refusals rather than blind spots — and then checks every
  remaining string with `urlOk`. A function with no balanced close is refused too.

**Why it holds.** The rule is now "decode what the browser decodes, read the argument list the
way a parser does, refuse what cannot be read". A value whose URL is not statically visible is
no longer *passed* because it was invisible; it is *refused* because it was invisible. The
descriptor functions are blanked before the string check, so a legitimate `image-set` with
`type("image/png")` still renders.

**Test.** `apps/web/test/canvas-shapes.test.mjs` — "a line continuation inside an image string is
still that string" and "an image function whose argument this cannot read is refused, not
trusted". Both RED before, GREEN after, with the legitimate shapes (`image-set("/a.png" 1x,
"/b.png" 2x)`, `type(…)`, a nested `url(/a.png)`) asserted to survive.

### F6-2 — `safeInlineStyle` had none of the three protections the stylesheet door has (FIXED)

**CWE-116.** CVSS 3.1 **5.4 medium** — `AV:N/AC:L/PR:L/UI:R/S:C/C:L/I:L/A:N`.

Same file, other door. A studio block's own `style` goes through `safeInlineStyle`, which tested
the RAW text for `url(` and knew nothing about escapes or about the two functions that name a
URL without writing one. Measured before:

```
'background:\75 rl(https://evil.test/x.png)'               -> { background: '\75 rl(https://evil.test/x.png)' }
'background-image:image-set("https://evil.test/x.png" 1x)' -> { backgroundImage: 'image-set(…)' }
'background-image:src("https://evil.test/x.png")'          -> { backgroundImage: 'src(…)' }
```

All three reach `el.style` and fetch. `\75 rl(` is the identical escape `7447367f` fixed in
`scopeCss` — the fix was applied to one of the two exported entry points.

**Fix.** Every test now runs against the DECODED declaration (what the browser reads) while what
is emitted is what the author wrote, and `refuseImageFns` is shared with `scopeCss`. The split on
`;` still happens on the raw text, so an escaped `\3b` cannot hide a second declaration from the
split — a browser does not treat it as a separator either.

**Why it holds.** The two doors share one implementation of "where a URL may point", and the
check is made on the string the CSS parser will see rather than on the string the author typed.

**Test.** "an inline style is read the way the browser reads it" — RED before, GREEN after;
`url(/ok.png)` and `image-set("/a.png" 1x)` still arrive unchanged.

### F6-3 — A B.MD `style=` could take over the page through one CSS escape (FIXED)

**CWE-116, enabling CWE-1021 (UI redressing).** CVSS 3.1 **5.4 medium** —
`AV:N/AC:L/PR:L/UI:R/S:C/C:L/I:L/A:N`.

`safeStyle` is the boundary for every `style=` an author writes in a blog post, a doc page or a
**comment**. Its own comment names the live threat: "`position: fixed` needs no script at all. A
`<div style="position:fixed;inset:0">` in a comment covers the page — a defacement, or a login
box drawn over somebody else's." Every one of its rules matched literal text, and a CSS escape is
decoded while the ident is tokenised — in a property name exactly as in a value. Measured before:

```
'position:fixed;inset:0'      -> 'inset:0'                    (refused, correctly)
'position:\66 ixed;inset:0'   -> 'position:\66 ixed; inset:0'  (kept — and IS position:fixed)
'\70 osition:fixed'           -> '\70 osition:fixed'           (kept — and IS position:fixed)
'width:expre\73 sion(1)'      -> kept
```

The `expression()` / `behavior:` / `-moz-binding` escapes are dead vectors in current browsers;
`position: fixed|sticky` is not, and it is the one the refusal was written for.

**Fix.** `safeStyle` moved into its own dependency-free module,
`packages/bmd/src/style-safe.js` (re-exported from `sanitize.js`, so no importer changed), and
every rule now runs against the decoded declaration while the declaration kept is the one the
author wrote.

**Why it holds.** Same principle as F6-1/F6-2: judge what the browser reads. The decoder
implements the CSS escape grammar (hex with its single optional whitespace terminator, the line
continuation, and the literal form), so there is no third spelling of `position` left. Nothing
legitimate is rewritten — `content:"\201C"` goes through byte for byte.

**Test.** `apps/api/test/bmd-style-safe.test.mjs` (the API runner is where the runner is; the
module has no imports for exactly that reason). RED before: 2 of its 4 suites failed.

### F6-4 — `style="constructor:1"` crashed the whole document's render (FIXED)

**CWE-1321 (prototype-chain lookup on author input) → CWE-248.** CVSS 3.1 **4.3 medium** —
`AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:N/A:L`.

```js
const CSS_ESCAPES_FLOW = { position: /^\s*(fixed|sticky)\s*$/i };
…
if (CSS_ESCAPES_FLOW[prop]?.test(val)) return '';
```

`prop` is whatever the author wrote. `constructor` is a lowercase word, so
`CSS_ESCAPES_FLOW['constructor']` finds `Object` — not null, so `?.` does not short-circuit —
and `.test` is `undefined`:

```
safeStyle('constructor:1')  ->  THREW: CSS_ESCAPES_FLOW[prop]?.test is not a function
```

Thrown inside `rehypeSafeStyle`'s `visit()`, so it takes the whole unified transform with it: one
comment or one post containing `<div style="constructor:1">` makes the page fail to render for
everyone. (`toString` and `valueOf` produced junk; `constructor`, `__proto__` and
`hasOwnProperty` threw.)

**Fix.** `CSS_ESCAPES_FLOW` is a `Map`. **Why it holds:** a `Map` has no prototype chain to walk
from a string key, so the lookup can only find what was put in it. **Test:** "a property name
borrowed from Object.prototype does not throw" — five names, `assert.doesNotThrow`. RED before.

### F6-5 — `:::roadmap{src=…}` fetched with the reader's session and no URL policy (FIXED)

**CWE-359 / CWE-441 (confused deputy, read-only).** CVSS 3.1 **4.3 medium** —
`AV:N/AC:L/PR:L/UI:R/S:U/C:L/I:N/A:N`.

Every other live B.MD block funnels its `src` through `apiUrl()` (= `safeUrl` + the host policy)
and fetches with `credentials: 'omit'`: `::fetch` (`blocks.jsx:368`), `::include` (`:454`),
`::openapi` (`:478`). `DocRoadmap` did neither:

```js
const src = p.dataSrc || p['data-src'] || '';
…
fetch(src).then((r) => …)        // default credentials: 'same-origin'
```

So `:::roadmap{src=/api/…}` in any post read the READER's own authenticated endpoint and drew the
answer into the page, and `src=https://anywhere/` was an unvetted third-party fetch from every
reader's browser. Same class as the Sept-7 finding "B.MD live directives read credentialed
same-origin data" — one block was missed when the others were fixed.

**Fix.** `const src = apiUrl(…)` and `fetch(src, { credentials: 'omit' })`, identical to its three
siblings. **Why it holds:** the URL now goes through the single policy every other block uses, and
the request carries no ambient authority, so there is no deputy left to confuse. **Verified by**
`check-md-security.mjs` (42 hostile documents), `check-md-renders.mjs` (95 directives through the
real component) and `lint-bmd.mjs`, all green, plus a grep asserting `credentials: 'omit'` on all
four fetch sites in `blocks.jsx`.

### F5-2 — A bot icon was bounded in bytes, not in pixels (FIXED)

**CWE-409 (decompression bomb) / CWE-789.** CVSS 3.1 **4.9 medium** —
`AV:N/AC:L/PR:H/UI:N/S:U/C:N/I:N/A:H` (PR:H — `manage_bot`).

`POST /admin/bot/custom-icons` caps the data URL at 2 MB **before decoding the base64** — a good
cap on the wrong quantity. Bytes say nothing about what a decoder must allocate. A PNG of one
flat colour at 60000×60000 is about 400 KB on the wire and roughly 14 GB once
`@napi-rs/canvas`'s `loadImage` has it, and `prepareCustomIcon` handed the buffer straight over
after the magic-byte sniff. Measured: with the gate removed, the test that posts the bomb does not
fail an assertion — **the process dies**.

**Fix.** `imageSize(buf)` reads the declared size out of the header (PNG IHDR, GIF screen
descriptor, WebP VP8X/VP8/VP8L, JPEG's first SOFn) and `prepareCustomIcon` refuses anything over
4096 px a side, **or anything whose header does not state a size at all**.

**Why it holds.** The refusal happens on the first two dozen bytes, before a decoder is involved,
and it fails closed: an image that will not say how big it is is exactly the image the cap exists
for. The four formats checked are the four the sniffer already admits, so nothing reaches
`loadImage` unmeasured.

**Test.** `apps/api/test/bot-custom-icon-bomb.test.mjs` — a hand-built PNG, `imageSize` over the
shapes, the bomb refused with the pixel cap named, and a PNG signature with no IHDR refused. RED
before (process death), GREEN after. No DB, no canvas.

### F5-3 — A duplicated winner id paid an unlinked winner twice (FIXED)

**CWE-837 (improper enforcement of a single unique action).** CVSS 3.1 **2.7 low** —
`AV:N/AC:L/PR:H/UI:N/S:U/C:N/I:L/A:N` (inside the bot's own trust boundary).

`POST /bot/giveaways/:id/drawn` takes `winnerIds: z.array(…).max(50)` with no uniqueness and
loops over it. "Paying twice is prevented twice", says `giveaway-reward.mjs`, and it is — for a
LINKED winner: `claimDraw()` takes the draw with one conditional update, and `awardEconomyReward`
refuses a second ledger row on `ref: giveaway:<id>`. The **shadow** path (an unlinked Discord id,
credited on `DiscordEconomy`) has no ledger to check, and the guard's own comment says so: "that
credit has no ledger, so only guard 1 covers it". Guard 1 covers a second REQUEST; it does not
cover the same id twice in one list.

**Fix.** `b.data.winnerIds = [...new Set(b.data.winnerIds)]` immediately after parsing, with the
reason written beside it. **Why it holds:** the draw is claimed once, so this is the only door a
duplicate could come through; after the dedupe the loop body runs at most once per id, which is
what both guards already assume. It also stops a duplicated LINKED winner receiving two inventory
rows for one prize.

### F5-4 — `packages/bmd/src/url.js` was a binary file to every gate that greps (FIXED)

**Hardening, no CVSS.** `const STRIP = /[…]/g` — the guard that removes control characters before
a URL's scheme is read — was written with **raw 0x00, 0x1F and 0x7F bytes in the source**. It
behaves correctly, and that is the trap: `grep` calls the file binary and prints
`Binary file … matches` instead of the line, so every text gate and secret scan that walks this
tree skips the file that decides whether `java<TAB>script:` is a scheme. Fourth sighting of this
family in this project (`control-byte-in-a-pattern`, `generated-regex-backspace-trap`).

**Fix.** `/[\x00-\x1f\x7f\s]/g` — the same class, written with escapes. **Why it holds:** proved
identical rather than assumed. `safeUrl` was run over the same inputs before and after:
`java<TAB>script:` refused, `java<DEL>script:` refused, `java<0x01>script:` refused, `//evil.com`
refused, `https://my-site.example.com/a-b` unchanged with its hyphens intact. A sweep of
`packages/bmd/src`, `apps/api/src`, `apps/bot/src` and `apps/web/src/lib` found no other source
file containing a raw control byte.

> A near-miss worth recording. Read in a terminal, that line looks like `[ -\s]`, and `[ -\s]` in
> JavaScript (Annex B) is the three atoms `' '`, `'-'` and `\s` — it would have stripped every
> **hyphen** from every URL B.MD renders, silently sending a reader of `https://my-site.example.com`
> to `https://mysite.example.com`, a domain somebody else can register. Running the real module
> refuted it in one call. The probe was the thing that was wrong, again.

## Attacked and found to hold — stated so it is not re-attacked

**The emoji map (`PUT /bot/emoji/map`).** Names are `^[a-z0-9_]+$` 2–32 and ids are
`^\d{17,20}$`, enforced by zod on all three accepted body shapes, with the offending entry named
rather than silently dropped. The map becomes `<:name:id>` inside bot messages, and neither
character class can escape that token or reach Discord markup. `__proto__` passes the name regex
and assigns through the `__proto__` setter — it tries to set the prototype of a local object
literal to a **string**, which JavaScript ignores, and `JSON.stringify` never serialises it; the
entry simply disappears. 2000-entry cap, matching Discord's. No finding.

**Custom icons (`7fd74a7f`), apart from F5-2.** Keys are `^[a-z0-9_]{2,32}$` and may not shadow a
built-in. The uploaded image is sniffed by **magic bytes**, never by a declared content-type; the
base64 is refused on the STRING length so an oversize payload is never materialised; and — the
answer to "can an uploaded image carry something that is not an image" — **the original bytes are
never stored or served**. The image is re-drawn into a fresh 128×128 canvas and `encode('png')`-ed,
so a polyglot, an appended payload, EXIF and an SVG-in-a-PNG are destroyed by construction; what
is stored is our own encoder's output. `readStore` re-validates every key on the way OUT, so a row
written by another path cannot reintroduce a bad one. Count, per-icon and whole-row caps are all
checked, and the 128×128 PNG is refused if it exceeds Discord's own 256 KiB before anything is
sent anywhere. The glyph path renders through the same tile renderer as a built-in, with
`#rrggbb`-validated colours and an allowlisted shape.

**The giveaway draw race, apart from F5-3.** `claimDraw()` is one conditional
`updateMany({ where: { id, status: 'active' } })` and returns true only for `count === 1`; the
loser is told `already: true` and delivers nothing, so parallel `/drawn` calls pay once. The
second guard (`awardEconomyReward` refusing a duplicate ledger `ref`) is real and independent.
`/bot/giveaways/:id/enter` deduplicates entrants and enforces `requirements.linked` / `.creator`
server-side rather than trusting the Discord button. `/bot/giveaways/create` caps a guild at five
active member-run giveaways.

**The automod warn policy, apart from F5-1.** "Can a rule be made to warn someone else?" — no:
`POST /bot/warns` takes `discordId` and a `by` LABEL, and the label is used for nothing but the
record ("the bot is authenticated, the moderator is not" is written there and is true).
"Never warn?" — `normalizeThresholds` drops a count below 1 and an unknown action, refuses two
steps on the same count, and sorts highest-first; `actionFor` matches exactly, so no step stacks
and no step repeats; `log` / `delete` / `warn` are explicit no-ops kept so a step can be disabled
without deleting it. A revoked warning stays in the record and is excluded from the count. The
only way to make a step not fire was the race.

**The alert incident model.** `planAlert` is pure: one open row per key, severity only ever
raised, a re-open inside 30 minutes is the same incident, and only a NEW or ESCALATED incident
sets `fired`. The Details link is `${SITE_URL}/admin?s=serverperf&alert=` +
`encodeURIComponent(id)` — a fixed host and an encoded parameter, so no open redirect.
`POST /bot/alerts/posted` takes ids of up to 40 characters into an object map; `__proto__` there
assigns an object to the `__proto__` setter of a **local spread copy**, which changes that
object's prototype and nothing else — `Object.entries` in `prunePosts` and `JSON.stringify` on the
way to the DB both see own properties only. The map is pruned to 300 entries and seven days.
*Suppressing* alerts needs the shared secret (inventory above). *Causing* one: the
unauthenticated `POST /analytics/error` (120/min rate limit, another card's file) feeds the
`errors:client` burst rule — but that rule is KEYED, so it produces one open incident that is
updated rather than a stream, and the keyless "a new kind of error appeared" rule is restricted to
`source IN ('server','bot')`, which no public route can write. Bounded; recorded as a note for
card 4's owner rather than a finding here.

**The Stripe status fetch.** A constant `https://www.stripestatus.com/api/v2/status.json` — no
host comes from configuration, so there is no SSRF parameter. 5 s `AbortSignal.timeout`, one
request per 5-minute TTL shared process-wide, never more than one in flight, and a failure backs
off ten minutes. A failure **opens nothing**: the last good answer is kept and marked `stale`, an
unknown indicator maps to `unknown` rather than to `operational` ("guessing green is the failure
this module exists to fix"), and `stripeUp()` returns `null` for unknown, which the status page
renders as not-configured. Two nits, neither a finding: redirects are followed (the `fetch`
default — bounded by the response only ever being parsed as JSON and sliced), and `r.json()` has
no body-size cap, so a hostile *stripestatus.com* could feed a large document.

**`/bot/status` and presence templating.** `/bot/status` returns exactly what the public `/status`
page returns plus Stripe's own state; `cause` — the field that holds
`connect ECONNREFUSED 172.20.0.5:5432` — is excluded there as it is on the public page, and no
hostname, port, threshold or dependency configuration appears in the response. The presence
`fill()` is `String(s).replace(/\{(\w+)\}/g, …)`: a **single pass**, so a substituted value
containing `{guilds}` is not re-expanded and there is no recursion to drive. The variables are two
integers, a translated word from a fixed three-item set, and Stripe's own description (already
sliced to 200, then the whole line to 128). Nothing a member should not see: `{members}` is an
aggregate count across the bot's guilds, and a presence line is not a message, so there is no
mention or markdown to inject.

**`scopeCss`, the rest of card 6's list.** Each attacked, each held after the two fixes: hex
escapes of 1–6 digits with every terminator (`\75 rl(`, `\75rl(`, `\000075rl(`, seven digits,
`\r\n`); a doubled backslash before a hex escape (the scoper refuses it, and a browser would not
parse it as a URL either — the divergence is in the safe direction); `@import` split by a comment,
hidden in a string, written `@\69 mport`, and `@@importimport` (not an at-keyword to a browser
either); `@font-face { src: url(…) }` — the URL pass runs over the whole sheet before `walk`, so
the verbatim-kept at-rules are covered; `@supports` prelude smuggling; `cross-fade()` and a nested
`url()` inside `image-set` (handled by the `url()` pass, which leaves a legal `none` behind);
`element()` and `paint()` (no network — `paint()` needs a worklet the author cannot register).
Selector escape from the scope was attacked through `prefixSelector`'s `split(',')` inside `:is()`
/ `:not()` and through the `startsWith(scope)` shortcut: every top-level part is either prefixed
or begins with the scope's own attribute selector, and neither arrangement yields a selector that
matches outside the canvas. `@page` IS kept verbatim and does apply to the printed page — it can
carry margins and a size and no URL (the URL pass covers it), so it is noted below rather than
refused.

**The refusal-mutates-a-neighbour class** (the `@import` bug of `7447367f`) was re-attacked and is
closed: `@import` / `@charset` are removed as whole statements, semicolon included, and
`a{content:"@import url(x);"}` leaves `a{content:""}` with the next rule intact. One new instance
was introduced by this pass's own fix and removed before it shipped — an `image-set(` with no
balanced close made `refuseImageFns` return early and truncate the rest of the stylesheet. It now
refuses the function and resumes scanning after its `(`, and there is a test for it.

**The B.MD sanitize schema.** An allowlist, so an oddly-spelled event handler has nothing to be
allowed by. `srcset` is on no tag (`img` spreads the default and adds
`src/alt/loading/className/width/height/decoding`; `source` is `['src','type']` and REPLACES the
default), so the `srcset` / `imagesrcset` detour does not exist. Every URL-bearing attribute goes
through `safeUrl`: `data:` refused, protocol-relative `//evil` refused rather than repaired,
whitespace and control characters stripped before the scheme is read (`java<TAB>script:`), `/a:b`
correctly treated as a path, and an external anchor always gets `rel="noopener noreferrer"`.
`iframe` survives sanitisation and is then dropped by `rehypeIframeAllowlist` unless the host
vouches for its src. `svg`, `use` and `xlink` are not in `tagNames` at all.
`check-md-security.mjs` renders 42 hostile documents through the real component on every lint, and
it is green.

**The charity `code` block model.** `normBlocks` is an allowlist REBUILD, not a filter: an unknown
`kind` is dropped whole, `id` is forced to `^[A-Za-z0-9_-]{1,24}$` so it cannot escape the
`[data-b="…"]` selector it is used in, `text` is capped and rendered as a text node (there is no
markup path), `src` exists only for `kind: 'image'` and must be a site media path or `http(s)` —
no `data:`, no `javascript:` — and `size` is clamped. `cls` goes through `safeClasses` at render.
The stylesheet is scoped by `scopeCss`, the same single sanitiser, and injected as
`<style>{scoped}</style>`, which React writes as a text node, so a `</style>` in author CSS is not
a parse escape. This app is a client-rendered SPA; there is no SSR path where that would differ.

## Angles that found nothing at all

* `POST /bot/errors` — message 400, stack 6000, a context object with three capped fields;
  deduplicated per message per minute; the context is JSON-stringified into the stack text, never
  interpolated into a query.
* `POST /bot/heartbeat` — every field declared (the schema strips unknowns, and the comments say
  so where that has bitten before); guild, role and channel lists capped at 200 / 100 / 200.
* `POST /bot/activity` — per-guild composite key, a capacity budget with eviction, and it stores
  nothing at all when the guild's member mode is `none`.
* `POST /bot/link/issue` — returns `{ linked: true }` without minting a code when a link already
  exists; the code is eight characters from a 32-symbol unambiguous alphabet drawn with
  `randomInt`.
* Presence `{…}` expansion: no recursive expansion, no author-controlled key set.
* `scopeCss` output injected into `<style>`: no escape.
* B.MD: `srcset`, `xlink:href`, SVG `use`, oddly-spelled `on*`, and `javascript:` in tab /
  newline / NUL / percent encodings — all refused by the allowlist or by `safeUrl`.

## Open — not changed, with the reason

* **The bot's shared secret is one unscoped credential for 59 routes, one of which hands out the
  Discord bot token.** Narrowing it (per-route scopes, or at minimum a second secret in front of
  `GET /bot/token`) is an owner decision that needs a bot-side change, so it is written up above
  rather than done here.
* **`DocReplay` passes `data-src` to the host application's replay player unfiltered**, unlike its
  four siblings. The player lives in `apps/web/src/ui/` — another agent's files this run — so this
  is a card, not a fix: it should get the same `apiUrl()` treatment as F6-5.
* **`apiUrl()` calls `safeUrl` with `kind: 'api'`**, which no branch of `safeUrl` knows; it falls
  through to `policy.allowHosts`, and with no allowlist configured a live block may fetch any
  `https` host. That may well be the intent (an `::openapi{src=…}` pointing at a public spec), but
  the *kind* reads as if it were doing something it is not. Worth an explicit `allowHosts` for the
  doc site and a `kind` the function actually handles.
* **`@page` survives `scopeCss` verbatim** and is not confined to the canvas. It can set page
  margins and size for printing and nothing else; refusing it would still be defensible.
* **`stripeStatus()` follows redirects and parses an unbounded body** from a third party.

## Not run / not checked

* **No browser was involved.** The CSS findings are argued from the CSS Syntax tokenizer rules
  (an escaped newline inside a string; escapes inside idents, property names included) and
  measured against the filters, not observed in a rendering engine. They should be confirmed once
  in a real browser on a studio page before the owner-facing summary describes them as exploited.
* **The bot was never started**, so nothing here was measured against a live Discord gateway: the
  automod concurrency claim rests on reading `onAutomodMessage` (one handler per `messageCreate`,
  all async, none awaited by the next) plus the API-side race, which WAS measured.
* **`@napi-rs/canvas` itself was not fuzzed.** The decompression bomb is bounded now; a
  memory-safety bug in the underlying Rust decoders is a supply-chain question (card 10).
* **No HTTP-level parallel harness was run against a live API.** The giveaway and warn concurrency
  was exercised at the library level against the real database, which is where both races live.

---

# Pentest 2026-09-22 — Card 8: creator key v5 (L), the BCWEB half

Run 2026-09-23. Surface: `apps/api/src/lib/creator-proof.mjs`, `lib/creator-identity.mjs`,
`routes/admin-fingerprint.mjs`, the creator parts of `routes/links.mjs`, and the two places
outside them that compare a creator id (`lib/siteban.mjs`, `accessListMatches` in `lib/lib.mjs`).
BMM's half — the proof minter, the fingerprint groups, the brute-force cost — is in
`.Assets/.md/CWE_REMEDIATION_PLAN.md`, section "Carte 8".

Angles attacked: **forgery and replay** (audience binding, the nonce across a restart and a
shared database, chain forks/loops/length, clock skew at both ends), **downgrade and ban
evasion** (v5 back to v4 in every spelling of the id, `/link/upgrade` twice or by someone else,
whether a ban / free-tier claim / site policy can be shed), **fingerprint privacy** (is the salt
per-site, can one site ask for another site's, can a hash be cracked), and **the admin
analyser** (gating, what it shows to whom, whether its ranking deanonymises). Two further rounds
after F8-1 added nothing.

## F8-1 — The similarity ranking could be drowned, and it said nothing about it (FIXED)

**CWE-807 (reliance on an untrusted input in a security decision) + CWE-770 (allocation without
limits).** Medium. **CVSS 3.1 5.8** — `AV:N/AC:L/PR:N/UI:R/S:C/C:N/I:L/A:N`. Changed scope,
because the damage lands on a THIRD PARTY: the id that a moderator bans instead.

**Trigger.** The fingerprint in a v5 proof is entirely client-asserted (the module says so), and
a creator id costs one ed25519 keygen to mint. `POST /api/link/upgrade` takes a self-minted id
with **no account, no link and no authentication** — it only has to carry a valid v5 proof,
which the attacker signs with their own root key. Every accepted proof writes up to four
`CreatorFingerprint` rows with hashes the caller chose. So:

```
for i in 1..N:                       # 20/min/IP, i.e. ~28 800 a day from one address
    k    = new ed25519 key           # a fresh creator id
    POST /api/link/upgrade { proof: v5(k, aud, fp={board: H}) }
```

`creatorAnalysis` then looked for other ids carrying `H` with `take: 500`, scored every match
by `weight.board = 4`, sorted, and printed the top 25. With 501 ids tied on the same score the
25 it printed were **arbitrary** — the one match that mattered might not be among them, and
nothing in the answer said so. An evader who had already read their own hash out of their own
proof (it is base64url in plain sight) could pre-empt exactly this.

The same lever pointed at storage: nothing capped how many distinct values one id could record,
so an unauthenticated caller could write rows for as long as it liked, retained 180 days.

**Fix** (`lib/creator-identity.mjs`):

1. `FP_MAX_VALUES_PER_COMPONENT = 8`. A known hash is always ticked over — refusing that would
   only blind `stabilityOf` — but a NEW value is refused once an id holds eight of a component.
   A real machine has one to three over its life.
2. `FP_SHARED_MAX = 20`. Before anything is read as evidence, one `groupBy` counts how many
   **distinct ids** carry each of this id's hashes. A hash above the threshold is left out of
   the matching and reported as `overshared: [{component, hash, ids}]`, and every row now
   carries `sharedWithIds` and `discriminating`. `take` is no longer an arbitrary page: it is
   `FP_SHARED_MAX × FP_MAX_VALUES_PER_COMPONENT × 4`, which is the true bound once the wide
   hashes are gone.

**Why it holds.** The ranking now only ever sorts matches that are *rare*, so a score cannot be
manufactured by volume — flooding a hash pushes it over `FP_SHARED_MAX` and takes it out of the
ranking entirely, with the count on screen. That is the honest answer: "400 ids carry this hash"
is a sentence a moderator acts on correctly, and a confident list of 25 strangers is not. The
storage lever is bounded per id. The remaining growth (one id, eight values, per component) is
bounded by the rate limit and the 180-day sweep.

A second, independent cause of the same collision — firmware with no serial programmed, where
the whole `board` group hashed to a constant shared by every such machine on earth — was fixed
on the BMM side in the same run (C8-A). `FP_SHARED_MAX` is what protects the rows recorded
before that fix, and any future group that collapses.

**Tests** (`apps/api/test/creator-key-v5.test.mjs`):
`a hash flooded across many ids is reported as such, not ranked as evidence` and
`one id cannot record an unbounded number of values for a component`.
**Both measured RED first**: with the two fixes reverted, the first fails on `discriminating`
still being true and `similar` still listing strangers, the second counts 14 rows where 8 is the
cap. Green after.

## F8-2 — A creator id was banned in one spelling and matched in another (FIXED)

**CWE-178 (improper handling of case sensitivity).** Low. **CVSS 3.1 3.7** —
`AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:L/A:N`.

**Trigger.** A creator id is the hex of an ed25519 public key, so `abcd…` and `ABCD…` are the
same key and the same person. Everything that goes through a PROOF already agreed on lower case
(`verifyCreatorProof` lowercases, `acceptCreatorProof` pins the lowercased id, the admin tool
lowercases what it is handed, and `/link/request` was fixed to look the link up case-insensitively
earlier this month). The two lists that do **not** go through a proof did not:

* `lib/siteban.mjs` — `compile()` lower-cased its IP entries and its User-Agent entries and
  **not** its creator ids, and the `onRequest` hook did `c.creators.has(String(cid))` on the raw
  header;
* `accessListMatches` in `lib/lib.mjs` — `(list.keys || []).includes(creatorId)` against the raw
  `X-Creator-ID`, which is what the site-wide `GlobalAccessPolicy`, every owner's
  `UserAccessPolicy` and every repo's own policy are matched with.

So a ban entry recorded in any spelling other than the one the client happened to send never
fired. Not a refusal, not a log line — a ban that quietly did nothing, and a whitelist entry
that was quietly a lock-out.

**Refuted first, and this is why it is Low, not High.** As an *evasion* primitive it is worth
nothing: the site-ban hook is `if (cid && …)`, so simply **omitting** the header evades it too,
and the access policies then match nothing either way, and `resolveClientIdentity` finds no
CreatorLink for the upper-case spelling so no account-based entry matches. Every downstream
check treats "upper case" exactly as it treats "no header". `/link/request` and `/link/upgrade`
were checked separately and are **not** affected — `creatorProofGate` lowercases before it looks
for a key pin, so no spelling of an upgraded id gets a bare-v4 answer. The real exposure is the
other direction: **an admin's ban, silently inert**, which is the failure mode nobody audits
because the screen says the ban is there.

**Fix.** `normaliseCreatorId()` in `creator-proof.mjs` (trim + lower case), written once and
used on **both sides** of every comparison: `siteban.mjs`'s `compile()` and its hook,
`accessListMatches`'s `keys` and its `{type:'creator'}` accounts. Nothing stored is rewritten,
so no migration and no behaviour change for the lower-case spelling everyone already uses.

**Tests:** `an access list matches a creator id in any spelling, on either side` (pure, both
directions, plus a negative so it cannot pass by matching everything) and, through the real
`installSiteBans` hook against the real database, one line added to
`a banned v4 id stays banned after upgrading…`. **Measured RED first** (`UPPER -> 200` where
`lower -> 403`), green after.

## Angles that found nothing

* **Audience binding.** A proof names `aud` inside the signed bytes and `expectedProofAudience()`
  comes from this deployment's `SITE_URL`, never from the token. A proof for site A presented to
  site B is refused before the signature is even checked. Trailing slashes are normalised on both
  sides, so `https://x` and `https://x/` are one audience and not a bypass.
* **Replay.** The nonce is burned in `CreatorProofNonce` (primary key), so it survives a restart
  and is shared by every replica on the same database — the two cases an in-memory set would
  miss. It is burned **after** the stateless checks, so an unauthenticated caller cannot fill the
  table with nonces from unsigned garbage, and **before** the pin is written, so a proof that was
  accepted has been used. Rows expire at the proof's own `exp` and `pruneCreatorIdentity` sweeps
  them (wired in `lib/sweeper.mjs`).
* **Downgrade.** A bare `bmmc1` proof for a pinned id is `upgraded_key_required` in every
  spelling: `verifyCreatorProof` lowercases `cid`, the hex regex admits no whitespace or
  alternative encoding, and the pin is stored and looked up lower-cased. A v5 proof cannot be
  relabelled `bmmc1.` because v5 signs `"bmmc5." + segment` and v1 verifies the bare segment
  (existing test), and the reverse fails for the same reason.
* **Chain forks and loops.** `verifyKeyChain` requires `prev` = the previous key, `seq` = i+1,
  a constant `cid`, and a signature by `prev`; `acceptCreatorProof` then requires the pinned key
  to sit in the chain **at the position it was pinned at**, so a second chain started from the
  root is `key_fork` and an older key is `key_retired`. A chain that loops or re-uses a retired
  key buys nothing: building one already needs the current key. `MAX_CHAIN = 8` on both sides
  bounds the work at 8 ed25519 verifies, and the whole token at 8 KiB.
* **`/link/upgrade` run twice, or by someone else.** It is idempotent in the only sense that
  matters — a second proof with a higher `seq` through the pinned key moves the pin, anything
  else is refused — and it can only ever pin an id whose ROOT key the caller holds, because the
  first chain link must be signed by the cid itself. It carries nothing across: bans,
  `FreeTierClaim` and `CreatorLink` are keyed on the Creator ID, which v5 does not change, which
  is the whole compatibility argument and is covered by an existing test.
* **The admin analyser's gating.** Reading is `manage_users`; the ban sections need
  `manage_sanctions` and are `undefined` without it; resetting a pin is `manage_sanctions`; every
  lookup writes an audit line naming the id. Anonymous 401, member 403, moderator 200-without-bans,
  admin 200-with-bans, and no e-mail address anywhere in the answer — all asserted by the existing
  test, all still green. *Noted, not changed:* `similar` shows a moderator that two ACCOUNTS
  share a machine, which is a fact the users list does not contain even though each field in it
  is one that list already shows. That is the tool's purpose and `manage_users` is the right
  gate, but it is the one place where the tool tells a moderator something genuinely new about a
  person, and it belongs in the owner-facing summary (H1) rather than being silently fine.
* **Fingerprint privacy, server side.** Only `/^[0-9a-f]{32}$/` survives `cleanFingerprint`;
  everything else a client puts in `fp` is dropped, including a raw serial. Nothing raw ever
  reaches the database. The per-site salt and the real cost of cracking a hash are measured in
  the BMM sink (C8-B): the short version is that the salt is public, so the hashes are a slow
  hash and not a MAC, confirming a *guessed* machine costs one hash, and cross-site correlation
  stays closed for every group that still has a real serial in it.

## Open — not changed, with the reason

* **Any caller can create `CreatorFingerprint` rows for an id nobody owns.** F8-1 bounds it per
  id and neuters its effect on the ranking, but the rows still exist, and the honest way to close
  it is to record a fingerprint only for a cid with a `CreatorLink` — which costs an account.
  That would also blind the tool for exactly the unlinked evaders it is aimed at. **Owner
  decision**, written here rather than taken.
* **`FP_ROUNDS = 20 000` in BMM against `200 000` in the v4 KDF**, for a *lower*-entropy input.
  Raising it is ~20 ms once per session and ten times the attacker's cost, but it invalidates
  every `CreatorFingerprint` row already stored. A data migration, not a code fix. See C8-B.
* **A first-pin land-grab.** For an upgraded install the root is still the hardware-derivable v4
  key, so somebody who can read a machine's serials can pin that id to their own key before the
  owner's BMM does; the owner is then refused `key_fork` for ever, and BMM says nothing because
  `registerKeyV5` swallows the error. The recovery exists here
  (`DELETE /me/creator-links/:id/key-pin`, owner-only, and the staff reset). The missing half is
  BMM telling the user — filed as C8-C in the BMM sink, in another agent's file this run.

## Verification run for this card

* `node --check` on every file touched (`creator-identity.mjs`, `creator-proof.mjs`, `lib.mjs`,
  `siteban.mjs`, `links.mjs`, `admin-fingerprint.mjs`, the test file): clean.
* `creator-key-v5.test.mjs`: **20 / 20** (17 existing + 3 new, plus one assertion added to the
  existing ban test). Each of the four new checks was **measured RED** with only its fix lines
  reverted (from file copies, not git), then green with them restored.
* `npm test` the CI way (`DATABASE_URL` set, `REDIS_URL` unset): **1929 tests, 1928 pass, 1 fail,
  0 skipped.** The failure is unrelated and pre-existing: `legal-freshness.test.mjs` says *"The
  legal pages changed on 2026-09-23 but still say last updated 2026-09-22"*. That is
  `apps/web/src/pages/legal.jsx`, committed today by the UX sweep (`5311c4cd`), in another
  agent's files and outside this card. It needs `LEGAL_UPDATED` bumped.
* **An incident worth knowing, because it looked like a regression:** partway through, the whole
  `bcweb-*` compose stack had been stopped (clean exit 0) and an unrelated `ofd` stack started. The
  v5 file then reported 11 failures out of 21. Those were every database test timing out on
  `Can't reach database server at 127.0.0.1:5432`, plus the file's `after()` hook. They were not
  test failures. Only `bcweb-db-1` was started to run this suite (no api, no bot; the compose file
  was not touched), and it was stopped again afterwards. Fixtures are removed by the suite's own
  `after()`, and the ban policy is saved and restored around the run.
