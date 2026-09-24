# Security summary: BCWEB, BMM and BetterInstaller

🇫🇷 [Version française](SECURITY_SUMMARY_FR.md)

**Written 2026-09-24.** Plan item H1. Read against the code at these commits:

| Product | Repository | Commit (plus the working tree of that day) |
|---|---|---|
| BCWEB (BetterCommunity web platform) | `BCW` | `055cbbc6` |
| BMM (BetterModsManager, desktop app) | `BetterModsManager`, branch `Tdev` | `32046d75` |
| BetterInstaller | `BetterInstaller` | `a52ce16` |

This is the one document to read first. It is not a pentest report and it is not a
certification. It says what each product protects, where each protection lives in the code,
what personal data is held and for how long, where the secrets are, how the dependencies and
releases are trusted, what the legal pages promise, what was found and fixed in September 2026,
and what is still waiting on a decision.

**How the claims were checked.** Every "the code does X" below carries a file and line. Each one
was opened and read on 2026-09-24, not copied from an earlier audit. Where a claim could not be
checked from the repository (production state, a secret rotation, a real certificate), it is
marked **not verified** and listed in [§10](#10-what-this-document-could-not-verify).

**Paths.** A BCWEB path is relative to `BCW/BCWEB/`. A BMM path is relative to the
BetterModsManager repository root. A BetterInstaller path is relative to `BetterInstaller/`.

**Sources.** The detailed records this summary condenses:

- BCWEB, bot, B.MD: [`SECURITY_AUDIT.md`](../SECURITY_AUDIT.md) (every dated pass since July),
  [API code audit](audits/CODE_AUDIT_2026-09-24_API_EN.md),
  [web code audit](audits/CODE_AUDIT_2026-09-24_WEB_EN.md),
  [CVE/CWE audit of 2026-08-29](audits/SECURITY_AUDIT_2026-08-29_EN.md).
- BMM and BetterInstaller, in the BMM repository: `.Assets/.md/CWE_REMEDIATION_PLAN.md`,
  `.Assets/.md/AUDIT-SEPT24-BMM-RUST.md`, `.Assets/.md/AUDIT-SEPT24-BMM-FRONT.md`,
  `.Assets/.md/PLAN-PENTEST-SEPT22-2026.md`, `.Assets/.md/PLAN-PENTEST-SEPT9-2026.md`.
- BetterInstaller: `docs/AUDIT-SEPT24.md`, `SECURITY.md`, `docs/SIGNING.md`, `docs/UPDATES.md`.

---

## Contents

1. [At a glance](#1-at-a-glance)
2. [Scope and threat model](#2-scope-and-threat-model)
3. [Where each trust boundary is enforced](#3-where-each-trust-boundary-is-enforced)
4. [Personal data](#4-personal-data)
5. [Secrets](#5-secrets)
6. [Supply chain](#6-supply-chain)
7. [Compliance](#7-compliance)
8. [Findings history, September 2026](#8-findings-history-september-2026)
9. [Open risks and owner decisions, ranked](#9-open-risks-and-owner-decisions-ranked)
10. [What this document could not verify](#10-what-this-document-could-not-verify)
11. [How to keep this true](#11-how-to-keep-this-true)

---

## 1. At a glance

| | BCWEB | BMM | BetterInstaller |
|---|---|---|---|
| What an attacker wants | an account (above all a staff one), money-like values (points, purchases), private repos and conversations, the ability to run script on the site | code execution on the user's PC, file write outside a folder, the user's tokens | a setup that installs or runs something the publisher did not ship, or deletes more than it installed |
| Strongest controls | one session check for every door, 2FA wall on every staff door, capability matrix proven over HTTP for all 1205 routes, SSRF guard with DNS pinning, zod allowlists, hash-chained audit log | local API on 127.0.0.1 with a token, strict script CSP, one deep-link gate shared by TS and Rust, imported tasks stripped of every permission, path guards on every write | Ed25519-signed packages, signed header (format v2), version and app-id check on updates, uninstall limited to what was installed, DLL search hardened |
| Weakest point today | the site CSP still allows inline script, so any missed escape becomes script | the MCP sidecar binary in the repo predates three fixes; the in-app updater trusts an unsigned manifest | `update.json` and `installer.toml` are not signed; only Authenticode over the finished setup covers the config |
| Found and fixed in Sept 2026 | about 70 findings, about 20 of them rated High | about 25 findings, 1 Critical and 8 High | 13 findings in the Sept 24 audit plus 5 in the card 9 pass |
| Open, each with a recommended decision | §9 items 1, 2, 4, 5, 8, 10-13, 17, and the list below it | §9 items 3, 6, 7, 9, 14-16, and the list below it | §9 item 6, and five smaller cards |

The single most important open item is not code: **a real Discord bot token was committed in
`infra/compose/.env.example` and there is no confirmation that it was rotated** (§5.4).

---

## 2. Scope and threat model

### 2.1 BCWEB

**What it is.** A Fastify API with Prisma on Postgres (`apps/api`), a React single-page app
(`apps/web`), a discord.js bot (`apps/bot`), the B.MD markdown kit and the studio
(`packages/`), MinIO for object storage, Redis for cache and rate-limit counters, Caddy as the
only public edge, all in one Docker Compose file (`infra/compose/docker-compose.yml`). A
separate Rust telemetry service for BMM (`bmm/telemetry-dashboard`) sits behind the same Caddy.

**Assets.** Accounts and their sessions, staff powers (roles, 32 capabilities, per-project
grants), money and money-like values (Stripe subscriptions, marketplace sales, economy points,
shop codes), hosted repos and catalogues (private ones behind share keys, passwords and signed
keys), conversations (member, team and anonymous), the audit log, and the secrets in `.env`.

**Actors.** Anonymous visitors; members (any account can publish B.MD content, create repos,
open conversations); per-project grantees and translators (limited powers); MOD, ADMIN and
SUPERADMIN staff; the Discord bot (a trusted server-side process holding one shared secret);
BMM clients (identified by a Creator ID and optionally a signed key proof); Stripe and Ko-fi
webhooks; third-party servers that BCWEB fetches from (plugin downloads, webhooks, monitors).

**Trust boundaries.**

1. Internet to Caddy: TLS, security headers, the only published ports on a correctly
   firewalled host (see §9, item 2, for why that is not automatic).
2. Caddy to the API: the API trusts the LAST `X-Forwarded-For` entry, the one Caddy appends.
3. Browser to API: a session cookie, then a role, capability, project grant or ownership check.
4. Author to reader: everything a member writes (B.MD, studio pages, CSS, SVG, links) is
   rendered to other people, staff included.
5. API to the outside world: every user-influenced fetch goes through the SSRF guard.
6. Bot to API: one shared secret, no narrower scope.
7. Webhook senders to API: HMAC signatures (Stripe, code webhooks) or a shared token (Ko-fi).

### 2.2 BMM

**What it is.** A Tauri v2 desktop app (Rust in `src-tauri/`, TypeScript in `frontend/src/`)
that manages game mods. Around the core: a local HTTP API for plugins and the CLI, an MCP server
(a separate binary shipped as a sidecar), `bmm://` deep links, a task scheduler that can mirror
tasks into the Windows Task Scheduler, a built-in repo server that can be exposed to the LAN or
the internet, sandboxed custom pages (`bmmpage://`), and an optional link to BetterCommunity.

**Assets.** The user's files and the ability to run programs as the user, the local API token,
plugin tokens, the scheduler key, repo passwords, a GitHub token if one was entered, the creator
key (an Ed25519 identity whose private half is sealed with DPAPI on Windows).

**Actors.** The user; any web page (it can fire a `bmm://` link); authors of mods, repos,
catalogues, themes, plugins, modpacks, tasks and launch packs that the user imports; anyone who
reaches the repo server; local processes (they can reach 127.0.0.1); an AI agent through MCP.

**Trust boundaries.**

1. Imported content to the webview: any script in the main webview reaches
   `window.__TAURI__` (`src-tauri/tauri.conf.json:12`, `withGlobalTauri: true`) and through it
   every command. XSS here is code execution, which is why the CSP matters.
2. Web page to deep-link handler: the gate decides whether to ask, refuse or run.
3. Imported task or plugin to the scheduler: permissions are reset at import.
4. Local process to the local API: token, per-plugin permissions.
5. Remote repo to the disk: every path in a manifest is checked before any write.
6. LAN or internet to the repo server: read-only, file allowlist at the root.

### 2.3 BetterInstaller

**What it is.** A Rust workspace: `bpkg-core` (package format, signing, updates),
`bpkg-cli`, and a Slint GUI `installer`. A setup is the engine executable, then the `.bpkg`
package, then `installer.toml`, then a 24-byte trailer.

**Assets.** The publisher's Ed25519 private key (it signs every BMM update), the user's
install folder and registry, and the trust decision shown on the Welcome page.

**Actors.** The publisher; whoever re-stamps a setup with another `installer.toml`; a mirror
or the host of `update.json`; files planted next to a setup in the Downloads folder; other
processes of the same user.

**Trust boundaries.** The signature covers bytes `0 .. 24+N+M` of the `.bpkg` (header,
manifest, payload). It does **not** cover `installer.toml`, which carries the public key, the
paths and the prerequisites. Only an Authenticode signature applied after `bpkg build` covers the
whole setup (`docs/AUDIT-SEPT24.md`, BI-06).

---

## 3. Where each trust boundary is enforced

### 3.1 BCWEB

**Authentication.**
- Passwords are hashed with argon2id: `apps/api/src/routes/auth.mjs:189`.
- Login brute force: after 3 failures in 15 minutes for an address, a proof of work is required,
  counted per address across every IP and deliberately not a lockout (`auth.mjs:159-175`).
- The second factor has its own ceiling: 10 wrong codes in 15 minutes for one account answer
  `429 2fa_locked` without checking anything (`auth.mjs:21`, finding S-3).
- OAuth sign-in and account linking bind the flow to the browser with a nonce cookie
  (`apps/api/src/routes/oauth.mjs:173`, fix for the Sept 7 account takeover).
- The server refuses to start in production on a secret that is in the repository (JWT, bot and
  link secrets): `apps/api/src/lib/boot-guard.mjs:25-40`, called at `apps/api/src/server.mjs:113-129`.

**Sessions and 2FA.**
- The session is an httpOnly, `SameSite=Lax` cookie, `Secure` when `SITE_URL` is https:
  `apps/api/src/lib/lib.mjs:85-86`.
- One question decides who a request is: a verified token that carries a session id (`sid`), a
  live `Session` row, an account that is not locked, and the role the database holds now.
  `authenticated()` (`lib.mjs:820`) serves the guards, `sessionUser()` (`lib.mjs:843`) serves
  every other door. `tokenAcceptable()` (`lib.mjs:806`) refuses any token without a `sid`, which
  is what stops the other five JWT kinds signed with the same secret (2FA-pending, elevation,
  consent, repo dashboard, telemetry) from being used as a session. Two routes that bypassed
  this were the High finding S-1 (Sept 24), and a test now fails if a third appears
  (`apps/api/test/session-side-doors.test.mjs`).
- Every staff door requires TOTP: `requireRole(...)` with a role list and `requireCap(...)` call
  `ensure2fa()` (`lib.mjs:780`, `873-890`, `936-950`), as does `requireEditor()` for project
  grantees (`lib.mjs:955`).
- A suspended account keeps sign-in (to read why and appeal) and loses every staff power:
  `staffLocked()` (`lib.mjs:866`).
- Server administration (database viewer, file manager, backups) needs ADMIN, the
  `canControlServer` flag re-read from the database, and a short-lived elevation cookie bound to
  the same user: `requireElevated()` (`lib.mjs:212-219`).
- Password change revokes every other session; password reset revokes all of them (Sept 7 fix).

**Capabilities and RBAC.** Roles are USER, MOD, ADMIN, SUPERADMIN; custom roles bundle
capabilities without changing the role; per-project grants cover one project. The matrix test
`apps/api/test/capability-route-matrix.test.mjs` registers every route with its handler stubbed
and proves, for 1205 live routes, that each capability opens exactly its own doors, that no
combination opens a role-only door, that anonymous callers get 401 everywhere and that a missing
2FA is refused everywhere. `apps/web/scripts/check-capabilities.mjs` holds a ratchet on how far
each capability reaches.

**CSRF.** There is **no CSRF token** on cookie-authenticated routes. The defence is
`SameSite=Lax` (a cross-site POST carries no cookie) plus the removal of every same-origin
request primitive from authored content: B.MD live blocks and the `:action` button fetch with
`credentials: 'omit'` (findings Sept 7-7, F6-5, B-1, W3). The residual risk and the
recommendation are in §9 (other open items).

**CSP and headers.** Caddy sets HSTS (`infra/caddy/Caddyfile:104`), `X-Frame-Options` and
`frame-ancestors 'self'`, `nosniff`, and this CSP (`Caddyfile:109`):
`script-src 'self' 'unsafe-inline'` plus Google Tag Manager hosts, `connect-src 'self' https: …`.
So the CSP blocks third-party script hosts and framing, but it **does not stop an injected inline
script and does not stop exfiltration to any https host** (F10-9, open). The telemetry
dashboard origin has its own headers and a CSP written but commented out (`Caddyfile:298-304`).

**Rate limits and abuse.** A global limit per client IP (600/min by default, Redis-backed when
available) with a ban step: `server.mjs:299-310`. Per-route limits on sensitive routes. Site
bans by IP, CIDR, User-Agent fragment and Creator ID, plus an automatic shield after repeated
rate-limit hits (`apps/api/src/lib/siteban.mjs`, `apps/api/src/lib/abuse.mjs`). The client IP is
read in one place, the LAST `X-Forwarded-For` entry (`apps/api/src/lib/client-ip.mjs:8-14`,
consolidated from twelve copies in `2a472ccd`). That rule is only safe when every request comes
through Caddy (§9, item 2).

**SSRF guard.** `safeFetch()` (`apps/api/src/lib/net.mjs:145`) allows http and https only,
resolves the name and refuses private, loopback, link-local (including the cloud metadata
address), CGNAT and reserved ranges, pins the vetted address into the connection so DNS
rebinding cannot swap it (`net.mjs:133`), and re-checks every redirect hop by hand. IPv6 forms
that carry an IPv4 (mapped, compatible, NAT64, 6to4) are judged by the IPv4 inside
(`net.mjs:44-70`, finding B-5). Used for plugin downloads, webhooks and status monitors.

**Uploads.**
- Presigned uploads sign an explicit `ContentType` (`apps/api/src/lib/storage.mjs:40`), so the
  stored type is the one the API chose.
- A repo file's storage key is derived by the server, never taken from the client
  (`apps/api/src/routes/hosting-content.mjs:262-271`, finding S-2).
- Downloaded plugin archives are capped at 256 MB while streaming, and archives are refused
  before inflating when their declared size passes 1 GiB (F10-1).
- Hosted repo files are served as JSON, text or octet-stream only, with `nosniff`; attachments
  are served `Content-Disposition: attachment`; uploaded SVG is refused on the conversation path.
- Bot icons are re-encoded from pixels into a fresh 128x128 PNG, and images whose header states
  more than 4096 px a side are refused before decoding (F5-2).

**Webhooks.** Stripe events are verified against the raw body with `constructEvent`
(`apps/api/src/routes/stripe-webhook.mjs:920`); a missing secret refuses every event. Code
webhooks use HMAC with a constant-time compare and refuse a project with no secret. Outgoing
webhooks go through `safeFetch` and are signed.

**Audit hash chain.** Every privileged staff action is written to `AuditLogEntry` with an HMAC
chained to the previous entry (`auditHash`, `lib.mjs:234`), keyed with `AUDIT_SECRET` (falls
back to `JWT_SECRET`). `GET /admin/security/audit/verify` recomputes the chain
(`apps/api/src/routes/server-control.mjs:248`). The audit tables are read-only in the database
viewer.

**Logs.** Request URLs are logged as the path only, query values replaced by their names, and
path segments that are credentials (`/threads/t/…`, `/f/…`, `/auth/oauth/link/…`) replaced by an
ellipsis (`server.mjs:172-182`, `redactPath` in `apps/api/src/lib/errorlog.mjs`; findings of
Aug 22 and F4).

**Authored content (B.MD, studio, themes).** Rendering is an allowlist (rehype-sanitize schema,
`safeUrl`, `safeStyle` judging the decoded CSS, `scopeCss` with a balanced-parenthesis scanner,
`sanitizeSvg` rebuilding markup). Translated strings with markup go through `RichText`, never
`innerHTML` (W2). Links stored in project configs are refused at write when their scheme is
`javascript:` or `vbscript:` (`apps/api/src/lib/config-links.mjs`, A-4). 42 hostile documents are
rendered on every lint by `apps/web/scripts/check-md-security.mjs`.

**Bot.** Every `/bot/*` route but the public invite checks `x-bot-secret` in constant time
(`botAuth`, `lib.mjs:204-210`). The secret is `BOT_SHARED_SECRET`, falling back to
`LINK_LOOKUP_SECRET` (`lib.mjs:195`). It is the whole authorisation model for about 60 routes,
one of which returns the Discord bot token (`apps/api/src/routes/bot.mjs:1354`). See §9.

### 3.2 BMM

**Local API.** Binds `127.0.0.1` only (`src-tauri/src/api/mod.rs:5129`). Every protected route
needs `Authorization: Bearer`; the token is re-read on each request and compared in constant
time, and an empty configured token admits nobody (`ct_eq`, `api/mod.rs:797-803`, finding F1 of
the Rust audit). A plugin's own token carries only that plugin's permissions; identity comes from
the token, not from a header. CORS answers only the Tauri origins, `https://bettercommunity.ch`
and any origin the user adds; a debug build allows any origin (`api/mod.rs:4405-4449`). Five
routes need no token (`/api/health`, `/api/status`, `/api/creator-id`, `/api/check-update`,
`/api/language/template`); a DNS-rebinding page could read them (no `Host` check, open card).

**Webview CSP.** The meta policy in `frontend/index.html:6-7` has **no `'unsafe-inline'` and no
`'unsafe-eval'` in `script-src`** since `ed120fd7` and `623ffa06` (both 2026-08-22).
`scripts/security-guard.mjs` fails the build on any inline event handler, handler built at
runtime, `eval(` or `new Function(` (baselines 0, lines 76-77). Still broad: `img-src https://*`
and `connect-src https://*` (repos and mod images live at arbitrary URLs), and `blob:` in
`script-src`. The Tauri-level CSP is `null` (`src-tauri/tauri.conf.json:31`); the meta tag is the
policy.

**Deep links.** One gate for every `bmm://` link: `decideLink()` and `admitLink()` in
`frontend/src/core/deeplink-guard.ts:203`, `495`. Links from the OS arrive as origin `external`
and are asked or refused (`frontend/src/core/deep_link_manager.ts:103-105`). The window function
cannot claim a trusted origin (`windowOrigin()`, `deeplink-guard.ts:55`); the trusted callers
(scheduler, local API) use a dispatcher that is not on `window`. Catalogue actions are parsed by
the same function on both sides (`catalogRoute()`, `deeplink-guard.ts:121`), which closed the
Critical of card 7. Rust re-applies the hard limits for app and plugin installs
(`src-tauri/src/commands/link_guard.rs:31` `path_refusal`, `:102` `redirect_refusal`, `:168`,
`:213`); themes have no Rust second layer (open). Deep-link URLs are masked before logging
(`linkForLog()`, `deeplink-guard.ts:466`). Deep links can be switched off entirely
(`deep_link_manager.ts:178`).

**Task permissions.** An imported task (`.bmmpa`, plugin automation, `.bmmscript`) is stored
disabled with every permission set to false, and the user is told what it asked for
(`sanitiseImportedTask()`, `frontend/src/features/settings/scheduler.ts:952`). The review screens
and the runtime read grants through one function and one vocabulary
(`grantedPermissions()` and `RISK_KEYS`, `frontend/src/features/settings/bmmpa-inspect.ts:22`,
`35`; test `tests/task-perms-parity.test.mjs`). A task created through MCP gets an explicit
all-false `perms` (`creation_defaults`, `src-tauri/src/mcp/state_bridge.rs:1424`).

**Path confinement.** `safe_relative_path()` refuses rooted, drive, UNC, `:` (including NTFS
streams), NUL, `..` and dot-or-space-only segments; `safe_folder_name()` allows one plain
component (`src-tauri/src/fs_utils.rs:655`, `681`). Repo sync refuses the whole manifest before
any write if one path is unsafe; app installs and launch packs use the folder rule. Archive
extraction refuses the whole archive if any entry, directories included, would escape
(`src-tauri/src/archive.rs`, C10-A). Exception: `read_file_base64` reads any path
(`src-tauri/src/commands/disk.rs:496-500`); only BMM's own dialogs call it today (open card).

**Repo server.** Binds `0.0.0.0` when the user chooses to host
(`src-tauri/src/commands/repo_server.rs:803`). Read-only. At the root it serves only
`repo.json`, `Info.json` and `monitoring.json` (`builtin_may_serve`, `repo_server.rs:1028`), so the
standalone server's `server.js`, access and ban lists are no longer served (finding F3).
`monitoring.json` is public by design and lists each active downloader's IP and Creator ID
(`repo_server.rs:483-497`, §9).

**MCP bridge.** The MCP server calls the local API with the admin token, but its generic
`api_call` allows GET and POST only (`src-tauri/src/mcp/state_bridge.rs:1244-1246`). This is not
the real boundary (MCP has its own delete tools); the per-route permissions of the API are. The
shipped sidecar binary is older than the code (§9, item 7).

**Updates.** The in-app incremental updater reads a release manifest from GitHub or the BCWEB
feed over https, requires https for every file and checks each file's SHA-256 before writing
(`src-tauri/src/commands/autoupdate.rs:64`, `433`, `512`). The manifest itself is not signed.
Full installs and updates through BetterInstaller are Ed25519-signed and the BMM setup pins the
public key with `require_signature = true` (`BetterInstaller/examples/bmm/installer.toml:63-64`).

**Commands and processes.** Every spawn goes through `crate::commands::proc` helpers with
argument arrays; PowerShell values are passed as environment variables, never spliced into the
script (`proc::hidden_powershell`, finding F4 of the Rust audit).

### 3.3 BetterInstaller

- **Signatures.** Format v2 signs the header, manifest and payload (`17240a4`). A present but
  invalid signature is always refused. A `public_key` that does not parse, or
  `require_signature` without a key, makes the config fail to load
  (`crates/bpkg-core/src/config.rs:424`, BI-03). Verification and extraction read the same bytes
  (`crates/bpkg-core/src/package/reader.rs:178`, BI-08). An entry missing from the manifest is
  never installed (C9-D). Only a checked signature shows the green badge (BI-11), and a product's
  translation catalogue cannot reword the verdict (C9-A).
- **Rollback and downgrade.** An update must carry the expected app id and exactly the offered
  version, newer than the installed one (`check_offered`, `crates/bpkg-core/src/update.rs:194`,
  BI-05). A failed update keeps the snapshot if the restore is incomplete and refuses to start
  over an unfinished one (BI-04). `update.json` itself is unsigned (§9).
- **Authenticode.** The reader finds its trailer before a certificate table, so a setup signed
  after `bpkg build` still works (BI-06). Signing with a real certificate was not tested.
- **DLL planting.** Static imports resolve from System32 only (`crates/installer/build.rs:21`,
  `/DEPENDENTLOADFLAG:0x800`) and later loads are restricted with `SetDefaultDllDirectories`
  (`crates/installer/src/main.rs:162-170`). A test reads the flag back from the built binary
  (`crates/installer/tests/pe_hardening.rs`).
- **Uninstall confinement.** A folder is removed whole only if the install created it or found
  it empty (`owns_dir`, `crates/installer/src/uninstall.rs:42`); otherwise only the recorded
  files go. Drive roots, folders directly below a root and the home folder are never removed
  whole. Registry names, app id and protocol are validated at load
  (`crates/bpkg-core/src/config.rs:390`, BI-02). Config paths are relative and confined
  (`config.rs:458`, C9-C). Only the package's own executables are closed (BI-09).
- **Temporary files.** One private run folder per process, random name, `0700` on Unix,
  files opened with `create_new` (`crates/bpkg-core/src/tmp.rs:38`, `63`, C9-B).
- **Key handling.** `bpkg keygen` refuses to overwrite a key and writes it `0600` on Unix
  (`crates/bpkg-core/src/sign.rs:30-34`, BI-10).

---

## 4. Personal data

### 4.1 BCWEB

| Data | Where | Retention (as enforced or stated) | Who reads it |
|---|---|---|---|
| Account: e-mail, display name, argon2id hash, TOTP secret, recovery codes, avatar, bio | Postgres `User` | while the account is open | the member; staff within their capability |
| Sign-in sessions: IP, approximate location, browser and OS, times | `Session` | until expiry or sign-out; revoked rows deleted 30 days later | the member; a SUPERADMIN for recovery |
| Sign-in attempts and alerts | `LoginAttempt`, alerts | 180 days by default | staff |
| Analytics (consent-gated in the browser) | analytics tables | page views 365 days, clicks and vitals 120, errors 90, replays 30 (defaults, admin-changeable) | admins |
| Repo and catalogue access events (incl. IP; the repo sandbox key in clear for the owner) | access tables | 30 days, at most 5000 per item | the owner |
| Sent-mail log | `MailLog` | 90 days, at most 20 000 | `manage_users`, addresses masked in the list |
| BMM device fingerprint hashes | `CreatorFingerprint` | 180 days after last seen | `manage_users` |
| Feedback and crash reports | Postgres + S3 | attachments 90 days, closed reports 365 days | staff |
| Conversations and attachments | Postgres + S3 | while the conversation exists; anonymous links never expire (§9) | the participants; staff with 2FA |
| Payments and invoices | Stripe + `Payment` rows | 10 years (Swiss accounting law) | billing staff |
| Database backups | backup host | 14 days (`infra/backup/backup.sh:29`) | operator |

These periods are the ones stated in the privacy policy (`apps/web/src/pages/legal.jsx:33`);
the sweepers that apply them were not all re-read for this summary.

**Account closure.** A member closing their account gets 30 days to cancel
(`apps/api/src/routes/closure.mjs:33`). At the date, the account is anonymised in place
(`anonymiseAccount`, `closure.mjs:503`): address replaced, name, hash, TOTP, avatar and Stripe
customer cleared, every session, refresh token and API key revoked, consents, provider links,
creator links and reviews deleted. The row itself stays because the audit chain references it.
A staff-closed account also loses its repos, catalogues and items, with their S3 objects
(`closure.mjs:463-478`). Known gaps: `PasswordReset` rows are not deleted (both consumers now
refuse them, F23-2), and avatar and feedback objects in S3 are not enumerated for deletion.

**Backups and erasure.** Row history backups are encrypted per user and the key is destroyed on
erasure (crypto-shredding, `apps/api/src/lib/shred.mjs`). Full database dumps are kept 14 days.
After a restore, `apps/api/src/replay-erasures.mjs` re-applies the erasures recorded outside the
database (`apps/api/src/lib/erasure-log.mjs`). This step is manual and the
[restore procedure](run/BACKUP_EN.md#restore) does not name it (§9).

**Data export.** `GET /me/export` (`apps/api/src/routes/my-backup.mjs:91`) returns the member's
own rows with credentials redacted.

**What leaves the server.** Stripe (payments), Discord (bot, OAuth), GitHub, Google, Twitch and
Steam (sign-in and connections), the mail provider, Google Tag Manager and Analytics in the
browser only after consent (`apps/web/src/lib/consent.js`), and Ko-fi. The privacy policy lists
them as processors.

### 4.2 BMM

- **On the machine.** `data.json` and settings (API token, plugin tokens, scheduler key, repo
  passwords, GitHub token), the sealed creator key (DPAPI plus a registry copy), session logs,
  crash reports, optional session replays.
- **Telemetry is opt-in.** Nothing is collected until the user accepts BMM's own consent screen
  (`frontend/src/core/analytics.ts:3`, `78-83`). The installer's telemetry box is unticked and
  only offers the question (`BetterInstaller/examples/bmm/installer.toml:241-257`); the weekly
  hardware report is a separate unticked box (`:287-295`). Discord Rich Presence is off by default
  (`src-tauri/src/state.rs:215`). The session-recorder box is ticked by default but only matters
  under telemetry consent (`installer.toml:269-278`, BI card C-8).
- **On the telemetry server.** IPs are truncated to /24 or /48 before storage, including the
  client-reported public IP, and locations are rounded
  (`bmm/telemetry-dashboard/server/src/anon.rs:59`, used in `main.rs:378` and `db.rs:256`).
  Retention 180 days by default (`server/src/config.rs:36`), extended to side tables
  (`db.rs:573`).
- **What else leaves the machine.** The Creator ID goes only to first-party hosts
  (`src-tauri/src/commands/net.rs:51-57`); a key proof is sent only to a source the user
  configured a key for. Crash and bug reports are redacted before they leave (`src-tauri/src/commands/crash.rs`, `report_redact.rs`); the September audits did not re-read that redaction end to end.
  A v5 creator proof carries four salted one-way hardware hashes when the user links an account or
  sends a report; the salt is public per site, so the hashes are slow hashes, not a MAC (C8-B).
- **The repo server exposes others' data.** When a user hosts a repo, `monitoring.json` publishes
  the IP and Creator ID of everyone downloading at that moment. BMM's `PRIVACY.md` does not
  mention it (§9).

### 4.3 BetterInstaller

The installer stores a receipt and `uninstall-info.json` locally and sends nothing itself. The
setup options that make BMM send data are unticked (tested by the defaults test named in
`docs/AUDIT-SEPT24.md`), except the session recorder noted above.

---

## 5. Secrets

### 5.1 Where they live

| Secret | Where | Notes |
|---|---|---|
| `JWT_SECRET` (sessions and five other token kinds), `AUDIT_SECRET` | `infra/compose/.env` | one module reads it (`apps/api/src/lib/jwt-secret.mjs`, `4457cc77`); boot refuses the repository default in production |
| `BOT_SHARED_SECRET`, `LINK_LOOKUP_SECRET`, `BC_LINK_SECRET` | `.env` | boot guard covers them; the bot secret falls back to the link secret |
| Database, MinIO, Redis credentials | `.env` | Redis has no password and publishes no port |
| Stripe keys and webhook secret, OAuth client secrets, mail credentials | `.env` | |
| Discord bot token | `.env` (env wins) or the `bot.token` admin setting | served to the bot by `GET /bot/token` |
| Ko-fi token, backup signing key, OIDC attestation key | admin settings | excluded from exports and imports by name (`SECRET_SETTING_KEYS`) |
| Per-user backup keys | database | destroyed on erasure |
| BMM API token, plugin tokens, scheduler key, repo passwords, GitHub token | BMM `data.json` | stripped from exports; not restored over the local ones (Rust audit F1) |
| BMM creator key seeds | DPAPI store plus registry copy; decoded copy held in process memory | §9, item 14 |
| BMM update-signing Ed25519 key | GitHub secret `BMM_PRIVATE_KEY`, written to disk in the release job | passed as an environment variable, not spliced (`.github/workflows/release.yml:79-83`) |
| BetterInstaller publisher keys | publisher's disk | `create_new`, `0600` |

### 5.2 Rotation

- Sessions: revoke a device from the sessions panel; changing the password revokes the others.
- The BMM API token is rotatable from Plugins & API and takes effect on the next request.
- A repo dashboard password change invalidates every cookie issued for the old one (S-4).
- `JWT_SECRET` rotation signs everybody out and changes the BC support ids derived from it;
  `apps/api/src/lib/jwt-secret.mjs` holds one key, with no second key for a rollover.
- The BMM update key cannot be rotated without shipping a new pinned public key to every
  install first; `bpkg keygen` refuses to overwrite it for that reason.

### 5.3 What is never logged (CWE-532)

- BCWEB request logs keep paths only, with credential path segments replaced (§3.1, Logs).
- Error rows use the same `redactPath`; task proposals built from errors scrub key=value,
  key: value, tokens, e-mails, IPv4 and IPv6 (B-4).
- Exports and backups run `stripSecrets` over values, not only over names (F23-4). The one
  exception is `GET /admin/settings`, which filters by name only (O2, open).
- BMM masks secret-named query parameters before logging a deep link (F2 of the front audit).
- BMM crash reports and link-triggered exports go through the same redaction, including secrets
  kept in their own files.
- CI: the BMM signing key goes through `env:`, never into the script text (C10-H).

### 5.4 The known incident: a Discord token in `.env.example`

In July 2026 a real Discord bot token was found hardcoded in `infra/compose/.env.example`,
committed since the first commit of the repository. It was the same token as the live one in the
real `.env`. The value in the example file was blanked, and the local unpushed history was
squashed so that no pushable commit carried it.

State on 2026-09-24:
- `infra/compose/.env.example:164` is `DISCORD_TOKEN=` with no value.
- Scanning all 2018 commits reachable from every ref of this clone with the CI secret pattern
  finds **no** Discord-token-shaped value (one match is a fake test fixture on a backup branch).
- **Not verified:** whether the token was rotated in the Discord Developer Portal. Every audit
  since July lists the rotation as outstanding. A token that was ever in a public repository must
  be treated as known to others, whatever the history shows now.
- **Not verified:** whether GitHub still serves an older object by its hash.
- The CI secret scan excludes `*.example`, `*.md` and `guides/`, so it could not have caught this
  and would not catch a repeat. Recommendation in §9, item 1.

---

## 6. Supply chain

| Control | BCWEB | BMM | BetterInstaller |
|---|---|---|---|
| Dependency audit | `npm audit --omit=dev`: 0 in `apps/api` and `apps/bot`; `apps/web` has `maplibre-gl` (critical, judged unreachable, F10-14). Run by hand in audits, **not in CI** | `npm audit`: 0; `cargo audit`: `sevenz-rust` (mitigated by BMM's own guard), `h2` 0.3 (local DoS, needs warp to axum), `rsa` Marvin (signing only). Not in CI | `cargo audit`: 0 vulnerabilities after BI-13; unmaintained Slint transitive crates remain |
| Lockfiles | v3, every entry from registry.npmjs.org with an integrity hash; `apps/api`, `apps/bot` and the telemetry web build use `npm ci`; `apps/web/Dockerfile:7` and `apps/provisioner/Dockerfile:11` still `npm install`, and the provisioner has no lockfile | v3, same checks | `Cargo.lock` committed |
| CI token | `permissions: contents: read` (`BCW/.github/workflows/ci.yml`) | same, `release.yml` job has `contents: write` | same |
| Action pinning | tags (`actions/checkout@v5`) | tags, and `dtolnay/rust-toolchain@stable` is a branch, in the job that holds the update-signing key (F10-5, open) | tags and a branch |
| Secret scanning | CI grep for Stripe, Discord and private-key shapes, excluding examples and docs; GitHub push protection blocked a push once (GH013) | GitHub push protection | GitHub push protection |
| Signed commits | most commits show a valid signature (`%G?` = G); some do not | recent commits signed | recent commits signed, two not |
| Release signing | not applicable (server) | updates Ed25519-signed through BetterInstaller; the incremental manifest is unsigned | packages Ed25519-signed; setups not Authenticode-signed today |
| Base images | pinned by tag, `apk upgrade` in three of four Dockerfiles; `minio:latest` and `pgbouncer:latest` float | n/a | Docker dev image |
| Containers | every service runs as root (F10-12, open) | n/a | n/a |

One unpinned artefact everywhere Prisma is installed: `@prisma/engines` downloads binaries at
install time, outside any lockfile hash.

---

## 7. Compliance

**Legal texts.** BCWEB publishes Terms, Privacy, Payments and Refunds, a notice-and-action page
(DSA Article 16, LCEN, Swiss CopA), and a Data Processing Addendum for customers who use the bot
or marketplace as controllers (`apps/web/src/pages/legal.jsx`, EN and FR, last updated
2026-09-24; the `legal:check` gate keeps that date honest). BMM ships `PRIVACY.md`, `TOS.md` and
their French versions. The service is operated from Switzerland and hosted in France; the texts
cite GDPR and the Swiss nLPD.

**Consent.** BCWEB loads Tag Manager and Analytics only after consent. BMM collects nothing before
its own consent screen; the installer's data options are unticked and do not stand in for that
consent.

**Data subject requests.** Access and portability: `GET /me/export`. Erasure: account closure with
a 30-day cancellation window, then anonymisation. Objection and anything else: the Contact page,
read by a person. The fingerprint section names canvas fingerprinting as a tracking technique,
states the legal basis (legitimate interest against free-tier abuse and ban evasion) and the
180-day retention.

**Breach notification.** The privacy policy promises notification within 72 hours where the law
requires; the DPA promises customers 48 hours.

**What is NOT claimed, and should not be.**
- No certification (ISO 27001, SOC 2) and no external penetration test. Every audit listed here
  was run by the project itself, with AI agents, on local stacks.
- No US DMCA procedure and no safe-harbour claim.
- No at-rest encryption of the live database; crypto-shredding covers backups only.
- No guarantee of availability beyond a paid term.

**Where the legal pages say more than the code does today** (checked 2026-09-24):
- "A Content-Security-Policy constrains what can run in your browser" (`legal.jsx:36`): true for
  script origins, not for inline script (F10-9).
- "We take a daily backup": depends on the operator installing the cron; `infra/bootstrap.sh`
  only reminds them.
- "The erasures made since it was taken are re-applied before the site serves anyone again"
  (`legal.jsx:33`): a manual step, missing from the restore procedure (§9, item 13).
- "We tell you in advance" if the service stops (`legal.jsx:79`): no notice period in days
  (§9, item 17).

---

## 8. Findings history, September 2026

Every finding below was reproduced before the fix and re-measured after, most with a test that
was run red first. Severity as rated in the source record (CVSS 3.1 where given). Commits are in
the repository of the product.

| Id | Product | Sev. | What was wrong, in one line | Commit |
|---|---|---|---|---|
| **Sept 7 pentest** | | | | |
| 7-1 | BCWEB | High | OAuth "add a sign-in method" callback bound nothing to the browser: account takeover | `6b478583` |
| 7-2 | BCWEB | High | Economy balance read then written absolutely: points minted, items double-charged | `6b478583` |
| 7-3 | BCWEB | High | `/v1/polls` listed private polls and staff-only tallies | `6b478583` |
| 7-4 | BCWEB | High | Suspended or taken-down repos kept serving every file | `6b478583` |
| 7-5 | BCWEB | High | Stored XSS through B.MD `doc-comment data-link="javascript:…"` | `6b478583` |
| 7-6 | BCWEB | Med | CSS injection through any directive `color=` | `6b478583` |
| 7-7 | BCWEB | Med | B.MD live blocks fetched with the reader's cookies; `:action` was one-click CSRF | `6b478583` |
| 7-8 | BCWEB | Med | Sessions survived a password change or reset | `6b478583` |
| 7-9 | BCWEB | Med | Shop reveal codes from `Math.random()` | `6b478583` |
| 7-10 | BCWEB | Low | Hardening: TOTP compare, sitemap escaping, key-proof lifetime, an argument shift | `6b478583` |
| 7-11 | BMM | n/r | Community renderer kept overlay styles and failed open without DOMPurify | `3c686f19` |
| 7b-1 | BCWEB | Med | Site-theme colour gate let `url()` through: every visitor fetched a third party | `86ecfc66` |
| 7b-2 | BCWEB | Low | Goal measurement trusted a prototype key before an interpolated column | `86ecfc66` |
| **Sept 9 pentest** | | | | |
| P-1 | BCWEB | High | `manage_bot` could mint currency and set the bot token | `dcd82ce3` |
| P-2 | BCWEB | Low | `manage_announcements` granted a tab and no route | `dcd82ce3` |
| A-1 | BCWEB | Med | One Stripe event delivered twice made two purchases | `69d75e87` |
| A-2 | BCWEB | Med | "Only 3 exist" sold 12 under concurrency | `69d75e87` |
| A-3 | BCWEB | n/r | An undeliverable purchase told the buyer it was ready | `607021ea` |
| C-1 | BCWEB | High | A one-page grant put a product on another page's shop | `af1e001c` |
| E-1 | BCWEB | High | `z.string().url()` accepted `javascript:` on a marketplace link | `17d3ca41` |
| E-2 | BCWEB | High | Script URL on the OAuth consent screen, set by any account | `dcabad8c` |
| E-3 | BCWEB | n/r | Admin OAuth client routes skipped the redirect-URI check | `dcabad8c` |
| E-4 | BCWEB | n/r | Repo link buttons were unvalidated strings | `218c05c2` |
| G-1 | BMM | High | `open_external` passed URLs to `cmd /C start`: RCE from a blog comment | `373b1510` |
| D-1 | BCWEB | decision | An undeliverable purchase now refunds itself | `dad5296d` |
| D-2 | BI | decision | Format v2: the signature covers the header | `17240a4` |
| D-3 | BMM | decision | The bot invite stops asking for Administrator | `3247ea0b` |
| **Sept 22-23 pentest, round 1** | | | | |
| K-1 | BMM | Crit | Gate and handler parsed catalogue deep links differently: RCE from any web page | `588cb8e0` |
| K-2 | BMM | High | Imported automation kept the deep-link capability it was stripped of | `588cb8e0` |
| K-3 | BMM | Med | Unchecksummed plugin download could be redirected to another host | `588cb8e0` |
| K-4 | BMM | Med | Link-triggered export missed secrets kept in their own file | `588cb8e0` |
| F10-1 | BCWEB | High | Plugin zip downloaded and inflated with no bound (1014:1 bomb) | `2138af12` |
| F10-2 | BCWEB | High | `adm-zip` 0.6.0 advisories | `2138af12` |
| F10-3 | BCWEB | Low | `.dockerignore` never read: 471 MB build context including `.env` | `2138af12` |
| F10-4 | all | Med | No CI `permissions:` block | `2138af12`, `f6b64926`, `680531a` |
| F10-6/7/8 | BCWEB | Med | Missing headers on telemetry, S3 and customer domains; no HSTS | `2138af12` |
| F10-11 | BCWEB | Med | API image built without its lockfile (api fixed, web and provisioner open) | `2138af12` |
| C10-A | BMM | Low | A 7z directory entry could escape the destination | `f6b64926` |
| C10-B/C | BMM, BI, telemetry | Med/High | `rustls` and `quinn-proto` advisories (lockfile bumps) | `f6b64926`, `680531a`, `2138af12` |
| C10-H | BMM | Info | Signing key spliced into a PowerShell script in CI | `f6b64926` |
| F23-1 | BCWEB | Med | Content-backup import wrote any admin setting unchecked | `5dfde1b3` |
| F23-2 | BCWEB | Med | A leftover reset token reopened a closed account | `5dfde1b3` |
| F23-3 | BCWEB | Med | A planted demo session never expired | `5dfde1b3` |
| F23-4 | BCWEB | Med | Backup export carried a webhook secret field | `5dfde1b3` |
| F23-5 | BCWEB | Low | One creator identity, two accounts, by flipping case | `5dfde1b3` |
| F1 | BCWEB | Med | Close/reopen loop mailed a chosen address without limit | `1d092c04` |
| F2 | BCWEB | Med | An admin without 2FA read any conversation through the member route | `1d092c04` |
| F3 | BCWEB | Med | A MOD received every repo's share key, password hash and sandbox keys | `1d092c04` |
| F4 | BCWEB | Med | Credentials in URL paths reached the logs | `1d092c04` |
| F5, F6, F7 | BCWEB | Low/Med | Blocked sender could trigger mail; copy verifier hid the signed text; orphan cursors | `1d092c04` |
| F5-1 | BCWEB | Med | Warn ladder race: the fastest spammer skipped the timeout and ban steps | `261b6ecb` |
| F6-1..F6-5 | BCWEB | Med | CSS escapes and `var()` past `scopeCss`, inline style and B.MD `style=`; `constructor` crash; `:::roadmap` with cookies | `261b6ecb` |
| F5-2, F5-3, F5-4 | BCWEB | Med/Low | Bot icon pixel bomb; duplicated giveaway winner paid twice; raw control bytes in `url.js` | `261b6ecb` |
| F8-1, F8-2 | BCWEB | Med/Low | Fingerprint ranking could be flooded; a ban entry missed another spelling | `49d41460` |
| C8-A | BMM | Med | Factory-default firmware made unrelated machines share one fingerprint | `c9edec3c` |
| C9-A..C9-E | BI | Med/Low | Catalogue could reword the signature verdict; predictable temp files; unvalidated config paths; unlisted archive entries; bidi overrides | `040eada` |
| S1-S5 | BCWEB | n/r | Studio phase 0: stored XSS through a button link, the `api` action, CSS values, overlays; cross-project studio read | `8e446823` |
| **Sept 24, round 2** | | | | |
| B-1 | BCWEB | High | B.MD `:action` pressed with the reader's session, from an anonymous contact message | `7210e7aa` |
| B-2..B-5 | BCWEB | Med/Low | `/\host` read as a path; stored components unvalidated; IPv6 and `key: value` in task text; SSRF through IPv6 forms of private IPv4 | `7210e7aa` |
| C-1 (r2) | BCWEB | Med | Case-insensitive "equals" was an ILIKE: `%` and `_` were wildcards (15 sites) | `7e9fc512` |
| R8-1 | BCWEB | Med | Any ADMIN could write the delete list `clear-demo` runs | `7e9fc512` |
| C-2, M11, M21 | BCWEB | Med/Low | Creator-id ban case in hosting; review approve race; bot plan and cross-server panel gaps | `7e9fc512` |
| A-1 (r2) | BCWEB | Med | A suspended account kept every staff power (1018 doors) | `75da20e0` |
| A-2, A-3 | BCWEB | Med | Code-graph routes had no project check; history leaked studio drafts | `75da20e0` |
| A-4 | BCWEB | High | A project grantee could store a `javascript:` link on the public project page | `75da20e0` |
| A-5 | BCWEB | tooling | The RBAC map called seven open routes guarded | `75da20e0` |
| **Sept 24, full audits** | | | | |
| S-1 | BCWEB | High | Repo dashboard and telemetry gate accepted the 2FA-pending token as a session | `cb56bdf3` |
| S-2 | BCWEB | Med | A repo file's storage key came from the client: any bucket object could be served | `cb56bdf3` |
| S-3 | BCWEB | High | No per-account ceiling on the 2FA step | `cb56bdf3` |
| S-4, S-5 | BCWEB | Med/Low | Dashboard password cookie outlived the password; unconfirmed collaborator address; soft auth used the token's stale role | `cb56bdf3` |
| W1 | BCWEB | High | Studio SVG sanitiser rebuilt `<img onerror>` by removing a tag | `cb56bdf3` |
| W2 | BCWEB | High | Translator wording reached `innerHTML` on checkout and admin screens | `cb56bdf3` |
| W3, W4, W5 | BCWEB | Low/Med | `::replay` with cookies; `?next=` open redirect through `/api/avatar`; KaTeX drawing over the page | `cb56bdf3` |
| Rust F1 | BMM | High | A restored backup set this machine's API token, scheduler key and CORS list | `db9ba5fa` |
| Rust F2 | BMM | High | Repo sync wrote wherever the manifest said (file write, code at logon) | `db9ba5fa` |
| Rust F3 | BMM | High | Built-in repo server served the standalone server's admin password | `db9ba5fa` |
| Rust F4 | BMM | High | PowerShell injection through Unicode single quotes | `db9ba5fa` |
| Rust F5 | BMM | High | App catalogue id named the install folder later removed | `db9ba5fa` |
| Rust F6 | BMM | Med | Sandboxed-page broker followed redirects anywhere and spliced origins into the CSP | `db9ba5fa` |
| Front F1 | BMM | High | Foreign markup could fire a trusted deep link through `data-act` | `648bf22a` |
| Front F2, F3 | BMM | Med | Deep-link passwords in logs and telemetry; stored XSS in the modpack creator | `648bf22a` |
| R13-1, R13-2 | BMM | Med/Low | A `.bmmscript` granting `resources` reviewed as safe; MCP task without perms could fire any deep link | `12dd045f` |
| R12-1, R12-2 | BMM | Low | Seeds left in freed heap blocks; v1 proof weaker audience check | `12dd045f` |
| R13-3 | BMM | Low | Governor waits blocked async workers and bypassed slots | `32046d75` |
| BI-01 | BI | High | Uninstall deleted the whole folder the user picked | `a52ce16` |
| BI-02 | BI | High | Empty names made uninstall delete `HKCU\Software\Classes` | `a52ce16` |
| BI-03 | BI | High | Update applied an unverified download on a malformed key | `a52ce16` |
| BI-04..BI-13 | BI | Med/Low | Rollback lost the good copy; downgrade and cross-app replay; Authenticode broke the setup; DLL planting; TOCTOU; `taskkill` by name; key overwrite; badge; parser bounds; `quick-xml` | `a52ce16` |

---

## 9. Open risks and owner decisions, ranked

The owner has delegated every open decision (2026-09-24). So each card below carries **one
recommended decision**, not a list of options: it is what should be applied. Ranked by what a
failure would cost multiplied by how reachable it is today.

| # | Item | Product | Why it matters | Recommended decision |
|---|---|---|---|---|
| 1 | **Discord token rotation unconfirmed** | BCWEB | A token that was public controls the bot in every guild | Reset the token in the Discord Developer Portal today, put the new one in `.env` only, and record the date in `SECURITY_AUDIT.md`. Extend the CI secret scan to `*.example` files for the Discord, Stripe and private-key shapes (placeholders stay allowed because they are empty). |
| 2 | **API and MinIO ports published on every interface** (new) | BCWEB | `infra/compose/docker-compose.yml:77` and `:101` publish MinIO `9000`/`9001` and the API `3000-3009` on all interfaces. The guides rely on `ufw`, which Docker-published ports bypass on a standard install. Reached directly, the API trusts a client-written `X-Forwarded-For` (rate limits, bans, audit IPs), skips the edge's `/api/domains/ask` block and every header; the MinIO console is open to password guessing | Publish those ports on `127.0.0.1` only (`"127.0.0.1:3000-3009:3000"`, `"127.0.0.1:9000:9000"`, `"127.0.0.1:9001:9001"`); browsers reach S3 through Caddy (`S3_DOMAIN`). Then scan the production host from outside. The compose file carries the owner's uncommitted edit: apply the change on top of it, never stage that edit. |
| 3 | **CI actions on moving refs in the job holding the update-signing key** (F10-5) | BMM, all | A compromised action release could steal the key that every installed BMM trusts | Pin every third-party action to a full SHA in all three repositories (SHAs listed in F10-5, re-resolved on the day), with `with: { toolchain: stable }` on `dtolnay/rust-toolchain`. |
| 4 | **Bot shared secret** | BCWEB | One unscoped secret authorises about 60 routes, including `GET /bot/token`, economy minting, warnings and guild ownership; it falls back to `LINK_LOOKUP_SECRET`, shared with the telemetry link lookup | Remove the fallback: the bot routes accept `BOT_SHARED_SECRET` only, and the boot guard requires it. Remove `GET /bot/token`: the bot reads `DISCORD_TOKEN` from its own environment. Move the casino roll to the API so the bot no longer sends a `multiplier`. |
| 5 | **CSP `'unsafe-inline'`** (F10-9) | BCWEB | W1, W2 and A-4 were script only because of it; it also allows `connect-src https:` | Drop `'unsafe-inline'` from `script-src`: move the theme bootstrap to a static file and load GTM from a hashed snippet. Narrow `connect-src` to `'self'` plus the hosts the site really calls. Add a gate that fails if `'unsafe-inline'` comes back in `script-src`. |
| 6 | **Unsigned `update.json`** (C-1) | BI, BMM | The update host can withhold updates or offer an older genuine release that is newer than the installed one; BMM's incremental manifest is also unsigned | Sign the update metadata with the publisher key, with an expiry date (7 days) checked by the client; apply the same signature to BMM's incremental manifest. Ship it as the next BetterInstaller format change. |
| 7 | **Rebuild the MCP sidecar** | BMM | `src-tauri/binaries/bmm-mcp-server-x86_64-pc-windows-msvc.exe` is dated 2026-08-29; the MCP sources changed after (R13-2, launch-pack F4/F5). A release built now ships the old behaviour | Rebuild it now (`cargo build --release --example bmm-mcp-server`), and build it inside `release.yml` from then on so the checked-in binary is never what ships. |
| 8 | **S-2 production SQL** and the A-4 config scan | BCWEB | Rows written before S-2 keep a client-chosen key; configs stored before A-4 can still hold a script link | Run both once on production, read-only: `SELECT id, "serverRepoId", key FROM "RepoFile" WHERE key NOT LIKE 'hosting/' \|\| "serverRepoId" \|\| '/%';` and the `configLinkProblems` scan. Any row found: re-derive the key, or remove the link, and write an audit line. Both returned 0 on dev. |
| 9 | **`monitoring.json` publishes downloaders' IPs** | BMM | Personal data of third parties, public on a user's repo server, not in `PRIVACY.md` | Publish aggregates only (active count, bytes, per-file progress) with no IP and no Creator ID; keep the detail in the host's own BMM screen. Say it in `PRIVACY.md` and `PRIVACY_FR.md`. |
| 10 | **Containers run as root** (F10-12) | BCWEB | Multiplies any RCE | Run api, bot and provisioner as `USER node` with a `chown` of the backup volume, and telemetry on `gcr.io/distroless/cc-debian12:nonroot`. Verify with one stack run before deploying. |
| 11 | **Anonymous conversation link never expires** (O5) | BCWEB | `ContactThread.accessToken` (`packages/db/schema.prisma:4569`): a forwarded mail opens the thread for ever | Expire the link 12 months after the last activity (the sender can ask for a new one by e-mail), and give the answering side a "revoke link" button that issues a new token. |
| 12 | **R1: Caddy config from the admin** | BCWEB | Today Caddy sites are added with `infra/caddy/site.mjs` on the server, validated before any reload; no API writes Caddy config | Do not build it. Caddy stays managed from the server with `site.mjs`; the admin may only display the list of sites, read-only. |
| 13 | **Restore does not replay erasures** (new) | BCWEB | The privacy policy promises it; `apps/api/src/replay-erasures.mjs` exists but the restore steps do not run it and restart the API first | Add the replay to the restore procedure (EN and FR guides), between the database restore and the API start: `docker compose exec api node src/replay-erasures.mjs --write` with `web` stopped. |
| 14 | **Creator-key seeds resident in memory** (R12 card 1) | BMM | `STORE` (`src-tauri/src/commands/creator_v5.rs:234`) and `DECODED` (`creator_v5/keystore.rs:857`) keep decoded seeds for the process lifetime; a dump carries them | Accept and document. A process that can read BMM's memory runs as the user and can call DPAPI itself; the cache exists for proof speed. Write the accepted risk in `creator_v5.rs` and in this document. |
| 15 | **Dead deep-link action** (R13 card 5, front C4) | BMM | The scheduler's `deeplink` step dispatches events nothing listens to (`frontend/src/features/settings/scheduler.ts:3371-3376`); in-docs deep links call a function that is not exported (`frontend/src/docs/docs-hub.ts:3203`) | Remove the generic `deeplink` step (the typed actions cover the real uses; an existing task keeps loading and shows the step as removed). Route in-docs links through `window.__bmmDeeplink(url)`, whose origin is untrusted, so the user is asked. |
| 16 | **`read_file_base64` unconfined** | BMM | Arbitrary file read the day a plugin or MCP tool reaches it | Confine it to the configured profile roots plus BMM's log and crash folders, with the same guard as the other disk commands. |
| 17 | **Shutdown notice period** | BCWEB legal | The Terms promise notice "in advance" if the service stops, without a number of days | 60 days' notice by e-mail and in the account, content downloadable until the end, prorated refund (already written). Write "60 days" in the Terms and the Payments page, EN and FR, and bump the legal date. |

**Other open items, each with its decision.**

| Item | Product | Recommended decision |
|---|---|---|
| No CSRF token on cookie-authenticated routes | BCWEB | Refuse state-changing requests authenticated by cookie when `Sec-Fetch-Site` is `cross-site` (or, without that header, when `Origin` is not the site); Bearer, API-key and bot-secret requests are exempt. |
| `PasswordReset` rows kept after closure (F23-2 residual) | BCWEB | Delete `PasswordReset` and `EmailVerification` rows in `anonymiseAccount`. |
| Avatar and feedback objects left in S3 on erasure | BCWEB | Delete the subject's avatar and feedback attachment objects in the erasure step. |
| O1: private catalogue share key echoed to whitelisted viewers | BCWEB | Remove `shareKey` from the shared serialiser; return it only on the owner's own routes. |
| O2: `GET /admin/settings` filters secrets by name only | BCWEB | Run `stripSecrets` over every value before answering. |
| O3: raw exception text in responses | BCWEB | Return fixed error tokens on public routes and log the detail server-side; keep detail for SUPERADMIN tools only. |
| O4: `fileSer` spreads the storage key | BCWEB | Replace the spread with an explicit field list without `key`. |
| `DOMAIN_ASK_KEY`, `CUSTOM_DOMAIN_MATCHER` reach no container (F10-10) | BCWEB | Pass `DOMAIN_ASK_KEY` to api and caddy and `CUSTOM_DOMAIN_MATCHER` to caddy in compose, and set a random key in production. |
| Web image built with `npm install`; provisioner has no lockfile | BCWEB | Apply the written `npm ci` patch to `apps/web/Dockerfile`; generate and commit a lockfile for the provisioner and switch it to `npm ci`. |
| `minio:latest`, `pgbouncer:latest` | BCWEB | Pin both to a version tag and bump them on purpose. |
| No dependency audit in CI | all | Add `npm audit --omit=dev --audit-level=high` and `cargo audit` jobs to the three CIs, blocking, with a small committed allowlist of advisories already judged unreachable (maplibre F10-14, `rsa`, `quick-xml`). |
| Native zip path has no `take()` bound | BCWEB | Add `.take(limit)` on the entry reader in `native/core/src/lib.rs` and rebuild the addon. |
| ~70 `href` sinks trust the write side | BCWEB | Add a `safeHref()` in the shared link components now; move to React 19 when the dependency allows. |
| `apiUrl()` has no host allowlist | BCWEB | Live B.MD blocks fetch from the site's own origin plus an admin-configured host list, empty by default. |
| Staff hold owner rights on every repo dashboard | BCWEB | MOD gets read-only access; writing (upload, publish, access list) needs ADMIN. |
| A staff read of a conversation writes no audit line (F2 residual) | BCWEB | Write an audit line whenever staff open a conversation they are not part of. |
| `@page` survives `scopeCss` | BCWEB | Refuse `@page` in authored CSS. |
| First-pin land-grab not shown in BMM (C8-C) | BMM | Show `key_fork`, `key_retired` and `upgraded_key_required` on the identity card in Settings, with the link to reset the pin. |
| `FP_ROUNDS` 20 000 against 200 000 in v4 | BMM | Accept: raising it invalidates every stored hash, and the cost that matters (confirming a guess) stays one hash either way. |
| `/link/request` pairing for unpinned creator ids; fingerprint rows for unowned ids | BCWEB | Accept both as documented compatibility and anti-evasion trade-offs. |
| Theme install by link has no Rust second check | BMM | Add a `link_install_theme` command with the same https, host and size rules as the plugin path. |
| Plugin catalogues carry no checksum | BMM | Make `sha256` mandatory in the plugin catalogue format; for one release, entries without it install only after a warning. |
| Local API has no `Host` check | BMM | Accept only `127.0.0.1:<port>` and `localhost:<port>` as `Host`, plus hosts the user adds for a tunnel. |
| `h2` 0.3 through warp | BMM | Accept for now (local denial of service only); plan the warp to axum migration with the next API rework. |
| No size caps on extraction and download | BMM | Cap a download at 4 GiB streamed and refuse an archive whose declared total exceeds 16 GiB or 1000:1, before extracting. |
| `.DATABMM` restore of page grants and tasks from someone else | BMM | Warn before restoring those two sections when the bundle's `author_id` is not this user's, and import tasks disabled. |
| Exports carry `github_token`; the unattended export copies `data.json` raw | BMM | Strip `github_token` from every export (the local one is kept on restore) and route the unattended export through `build_export_json`. |
| `pause_all` has no end and no banner | BMM | Show `paused_all` in the resources status with a banner, and resume automatically when the task that paused ends. |
| `requirePerm` accepts any truthy grant | BMM | Grant only on `=== true`. |
| Handoff `install_dir` not validated (C9-F) | BMM | Accept it only if it equals BMM's own install directory; validate `settings.language` like the other fields. |
| Catalogue checksum mismatch can be overridden in-app | BMM | Keep the override in the app (it is the user's own choice, after a warning) and keep the hard refusal on link-triggered installs; correct the BMM Docs sentence that says "verified before it can run". |
| Armed task exporting to a UNC path without a dialog | BMM | Keep (nightly backup to a NAS is intended); the path is confirmed once when the task is saved. |
| `installer.toml` authenticated only by Authenticode | BI | Buy a code-signing certificate and sign every BMM setup after `bpkg build`; put a config hash in the signed manifest in the same format change as item 6. |
| C-2 app left running on a remote update | BI | Close the app after the download and before the apply, as the local path does. |
| C-3 files added by updates not recorded | BI | Record them in `uninstall-info.json`. |
| C-5 three version comparators | BI | Keep one (`crate::version`) and delete the other two. |
| C-6 processes closed by name | BI | Close by full image path. |
| C-8 session recorder ticked by default | BI | Untick it by default, like every other option that sends data. |

**Applied on 2026-09-24 (agent-sec-api).** #4, #11, #13 and #17 above, and from the list: CSRF, `PasswordReset`/`EmailVerification` rows, avatar and feedback objects on erasure, O1, O2, O3, O4, staff on repo dashboards (MOD read-only), the staff conversation-read audit line and `@page`. Fixes and their born-red tests: `SECURITY_AUDIT.md`, "§9 decisions applied". Left for the compose owner: `BOT_SHARED_SECRET` still falls back to `LINK_LOOKUP_SECRET` in `infra/compose/docker-compose.yml`.

---

## 10. What this document could not verify

- Whether the leaked Discord token was rotated, and whether GitHub still serves an old object.
- Anything on the production server: open ports and firewall rules, the S-2 and A-4 scans, the
  backup cron, the telemetry and analytics sweepers actually running, the legal text possibly
  overridden by a copy saved from the admin legal editor.
- That Docker-published ports bypass `ufw` on the production host specifically (it is the
  documented Docker behaviour; it was not measured there).
- The CSP in a browser, a real Authenticode signature, macOS paths, a launched BMM, and the
  Discord bot against a live gateway. The audits behind this summary state the same limits.
- Retention periods in §4.1 were read in the privacy policy; not every sweeper was re-read.

---

## 11. How to keep this true

**What a gate enforces today.**

| Property | Gate | Where it runs |
|---|---|---|
| No route loses its guard; capabilities open only their doors | `apps/api/test/capability-route-matrix.test.mjs`, `apps/web/scripts/check-capabilities.mjs` | BCW CI (`npm test`, web lint) |
| No third door reads the session cookie alone | `apps/api/test/session-side-doors.test.mjs` | BCW CI |
| No `javascript:` in stored URL fields | `apps/web/scripts/check-url-schemas.mjs`, `apps/api/test/config-links.test.mjs` | BCW CI |
| Authored content stays inert | `apps/web/scripts/check-md-security.mjs` (42 hostile documents), `check-site-theme.mjs`, the `rich-text` innerHTML sweep, `bmd-action`, `svg-safe-reparse` tests | BCW CI |
| SSRF ranges | `ssrf-ranges`, `ssrf-rebind`, `ssrf-embedded-v4` tests | BCW CI |
| Committed secrets | `.github/scripts/secret-scan.mjs` (Discord, Stripe, `whsec_`, private keys; `*.example` included, `*.md` and `guides/` excluded; a self-test plants 8 secrets each run) | BCW CI |
| Dependency advisories | `.github/scripts/dep-audit.mjs` (`npm audit --omit=dev --audit-level=high`, `cargo audit`), blocking, with a per-folder reasoned ignore list `.github/audit-ignore.json` | CI of all three repos |
| Third-party actions | every `uses:` pinned to a full commit SHA, tag in a comment | CI of all three repos |
| MCP sidecar freshness | `release.yml` builds `bmm-mcp-server` and checks its `--version` before bundling | BMM release |
| Legal date not older than the legal text | `apps/web/scripts/check-legal-fresh.mjs` | BCW CI |
| Guides describe the real stack | `guides/check-claims.mjs`, `guides/check-links.mjs` | BCW CI (claims), by hand (links) |
| Caddyfile valid for the Caddy that runs | `caddy validate` job | BCW CI |
| No inline handler, no `eval` in BMM | `scripts/security-guard.mjs` | BMM `ci` script and build |
| Deep-link routes all decided | `scripts/deeplink-map.mjs --check`, `tests/deeplink-guard.test.mjs` | BMM CI |
| Task permission vocabulary is one list | `tests/task-perms-parity.test.mjs`, `check-condition-perms.mjs` | BMM CI |
| API permissions and secrets | `check-api-perms.mjs`, `check-api-secrets.mjs`, `check-dev-toggles.mjs` | BMM CI |
| Rust path guards, token compare, redaction | `cargo test` (608 tests) | BMM CI |
| Installer signature, rollback, uninstall, DLL flag, docs match format | `cargo test --workspace`, `pe_hardening.rs`, `docs_match_format.rs`, clippy `-D warnings` | BI CI (Windows and Linux) |

**What has no gate.**
- No Dependabot (the audit job fails on a known advisory, it does not open an upgrade).
- Container user, base-image digests, published ports.
- The CSP text itself (a change back to `'unsafe-inline'` on BCWEB would pass CI; on BMM
  `security-guard.mjs` only counts handlers, it does not read the meta tag).
- Whether the legal pages say what the code does (only the date is checked). Re-read §7 when a
  feature that touches personal data ships.
- Secret rotation and the restore runbook.

**When to update this document.** After every pentest round or audit, when an item in §9 is
closed or decided, and when a new data flow or a new trust boundary ships. Keep every claim tied
to a file and line, and re-read the line rather than the previous audit.
