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
