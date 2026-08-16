# BCWEB — API Reference

*🇫🇷 [Version française](API_Reference_FR.md).*

Complete list of the BetterCommunity Web HTTP API. All routes are served under the
**`/api`** prefix at the site base URL (dev: `http://localhost:5176/api/...`). Generated
from the Fastify route modules in `apps/api/src/routes/`.

## Conventions

- **Base:** `<SITE_URL>/api` — e.g. `http://localhost:5176/api/health`.
- **Format:** JSON in / JSON out. Auth is a **session cookie** (set by login), except
  where noted (bot secret / webhook signature).
- **Health:** `GET /api/health` → `{ ok, db, ts }` (no auth).

### Auth tiers (the "Auth" column)
| Tag | Meaning |
|---|---|
| **—** | Public, no auth. |
| **user** | Signed-in session cookie. |
| **mod** / **admin** | `requireRole('MOD'/'ADMIN')` — **2FA-enabled account required**. |
| **superadmin** | `requireRole('SUPERADMIN')` only. |
| **server-control** | `canControlServer` grant **+ step-up 2FA elevation cookie**. |
| **bot** | Discord bot shared secret (`x-bot-secret` header), constant-time checked. |
| **webhook** | External signature/token (Stripe / Ko-fi), constant-time checked. |
| **pow** | Public but requires a proof-of-work token (anti-spam). |

> The paginated/list conventions: most list endpoints accept `?q=` (search),
> `?skip=`/`?take=` (paging), and return `{ items, hasMore }`-shaped payloads.

---

## 1. Auth & account (`auth.mjs`)
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/auth/register` | pow | Create an account (argon2id) → routes to optional 2FA. |
| POST | `/auth/login` | — | Password login; returns `{ twoFactorRequired, tempToken }` if 2FA. |
| POST | `/auth/login/2fa` | — | Complete login with a TOTP/recovery code. |
| POST | `/auth/logout` | user | Clear the session. |
| GET | `/auth/pow` | — | Fetch a proof-of-work challenge (for register/contact). |
| POST | `/auth/reset/request` | — | Request a password-reset token. |
| POST | `/auth/reset/confirm` | — | Set a new password with the token. |
| GET | `/me` | user | Current account. |
| PATCH | `/me` | user | Update profile (displayName, bio, avatar…). |
| POST | `/me/password` | user | Change password. |
| GET | `/me/2fa` | user | 2FA status. |
| POST | `/me/2fa/setup` | user | Begin 2FA (returns QR + secret). |
| POST | `/me/2fa/enable` | user | Confirm + enable 2FA (returns recovery codes). |
| POST | `/me/2fa/disable` | user | Disable 2FA (password + code). |
| GET | `/me/sessions` | user | Signed-in devices for this account. Returns `{ sessions[], currentTracked }`; each entry carries `current`, `ip`, `device`, `browser`, `os`, `country`, `region`, `city`, `createdAt`, `lastSeenAt`. Live rows only, newest activity first, capped at 100. `currentTracked:false` means the caller's own token predates session tracking and so is absent from the list. |
| DELETE | `/me/sessions/:id` | user + re-auth | Revoke one device. **Body: `{ password, code }`** — the password is required, and `code` is a TOTP when the account has 2FA; an OAuth-only account with no password and no 2FA passes on the session alone. Scoped by account as well as id, so an id belonging to someone else returns 404 rather than acting. Idempotent. Revoking your own session also clears the cookie and answers `{ ok, self:true }`. Refusals are `403 wrong_password` / `403 bad_code`. |
| DELETE | `/me/sessions` | user + re-auth | Revoke every OTHER device, keeping the caller's. Same `{ password, code }` body and refusals as above. Returns `{ ok, revoked }`. |

## 2. OAuth login (`oauth.mjs`)
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/auth/oauth/providers` | — | Which providers are configured (feature probe). |
| GET | `/auth/oauth/:provider/start` | — | Begin GitHub/Discord OAuth (HMAC-signed state). |
| GET | `/auth/oauth/:provider/callback` | — | OAuth callback → creates/links account. |
| GET | `/me/oauth` | user | Linked OAuth identities. |

## 3. Catalog & moderation (`catalog.mjs`, `uploads.mjs`)
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/catalog` | — | Browse **published** items only (filter by project/kind/search). |
| GET | `/catalog/:slug` | — / owner / `?k=` | One item's detail. A non-published item stays **private**: reachable only via its own share link (`?k=<shareKey>`) or by its owner/an admin — it returns `private:true` and is never in the public list/feed. Mirrors Server-Repos. |
| GET | `/catalog/:slug/download` · `/dl` | — / owner / `?k=` | Pre-signed download of a payload — same private-link gate; downloads only count on a genuine public hit. |
| GET | `/catalog.json` · `/catalog/:slug/catalog.json` | — / `?k=` | BMM-consumable catalog feed. Public feed is published-only; the per-item feed honours `?k=` so an owner can import an unlisted item into BMM. |
| GET | `/catalog/hosting-quote` | user | Price preview for hosting an item. |
| POST | `/catalog` | user | Submit a new item (→ moderation). |
| POST | `/catalog/:id/update` | user | Propose an update. |
| POST | `/catalog/:id/delete` · `/delete/cancel` | user | Schedule/cancel deletion (72h grace). |
| POST | `/catalog/:id/hosting/cancel` | user | Cancel an item's paid hosting. |
| POST | `/catalog/downloads` | — | Record download events. |
| GET | `/me/items` · `/me/items/:id/payload` | user | My items + payload access. |
| GET | `/mod/submissions` | mod | Moderation queue. `?status=PENDING\|REJECTED\|SUSPENDED\|PUBLISHED` (default PENDING) + `?q/kind/type/sort`. |
| POST | `/mod/submissions/:id/approve` · `/reject` | mod | Approve → published, or reject (reason → owner; owner can then edit & resubmit). |
| POST | `/mod/submissions/:id/suspend` | admin | **Suspend** an item (reason). Harsher than reject: the owner **can't** resubmit (`/catalog/:id/update` returns `item_suspended`). Reversible via approve/reject. |
| PUT | `/mod/submissions/:id/tags` | mod | Tag a submission. |
| POST/DELETE | `/mod/submissions/:id/comments[/:cid]` | mod | Moderation comments. |
| GET | `/admin/catalog` · `/admin/catalog/:id/file` | admin | Admin catalog view + raw file. |
| POST | `/admin/catalog` · `/admin/catalog/:id/validate` | admin | Admin create / plugin integrity check. |
| GET | `/admin/catalog/:id/plugin-content` · `/plugin-file` | admin | Inspect a plugin package. |
| POST | `/uploads/presign` | user | Pre-signed S3 PUT (size/type capped). |
| GET | `/media/*` | — | Served media assets. |

## 4. Blog (`blog.mjs`)
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/blog` · `/blog/:slug` | — | Public blog list + post (`?home=1` for Latest news). |
| POST | `/blog` · PATCH `/blog/:id` · DELETE `/blog/:id` | mod/grant | Create/edit/delete a post. |
| GET | `/blog/my-scopes` | user | Which blogs I may write to. |
| GET/POST/DELETE | `/admin/blog-permissions[/:id]` | admin | Granular blog-permission grants. |

## 4b. Newsletter (`newsletter.mjs`)
GDPR-correct: double opt-in on subscribe, one-click no-login unsubscribe in every email,
and sends are admin-triggered only (no auto-send on publish).
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/newsletter/subscribe` | — | Subscribe (double opt-in): create a `pending` row + email a confirm link. Body `{ email, locale? }`. Idempotent; never leaks whether an address exists. |
| GET | `/newsletter/confirm?token=` | — | Confirm from the email link → `active`. Returns an HTML page. |
| GET | `/newsletter/unsubscribe?token=` | — | One-click, no-login unsubscribe (GDPR). Returns an HTML page. |
| GET | `/admin/newsletter` | admin | List subscribers + counts (active / pending / unsubscribed). |
| POST | `/admin/newsletter/broadcast` | admin | Manual send to ACTIVE subscribers. Body `{ subject, title, body, url? }`. Each email carries the unsubscribe footer. |

## 5. Projects & "Other projects" showcase (`projects.mjs`, `showcase.mjs`)
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/projects` · `/projects/:key` | — | Project config pages (BMM/BSM/…). |
| GET | `/projects/:key/community` · `/progress` · `/releases` | — | Project sub-tab data. |
| PUT | `/projects/:key` | admin | Edit project config. |
| GET | `/admin/projects` | admin | Admin project list. |
| PUT | `/admin/projects/:key/blog-tab` · `/home-news` · `/visibility` · `/schedule` | admin | Per-project toggles + scheduled update. |
| POST | `/admin/projects/flush-cache` | admin | Flush the GitHub/showcase cache. |
| GET | `/showcase` · `/showcase/:slug` (+ `/community` `/progress` `/releases`) | — | "Other projects" pages. |
| GET/POST/PUT/DELETE | `/admin/showcase[/:id]` (+ `/schedule`) | admin | Manage showcase projects + scheduled swap. |

## 6. Server-Repos (`repos.mjs`)
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/repos` · `/repos.json` | — | Public repo list + aggregate feed (with fingerprint). |
| POST | `/repos` · DELETE `/repos/:id` · PATCH `/repos/:id` | user | Create / delete / edit own repo. |
| POST | `/repos/:id/check` · `/list` · `/favorite` · `/push` | user | Verify / list / star / update a repo (SHA-only push). |
| GET | `/me/repos` · `/me/hosting/groups` | user | My repos + hosting pools. |
| POST | `/me/repos/:id/renew` · `/upgrade` · `/to-multi` · `/to-single` | user | Lifecycle/plan changes. |
| PUT | `/me/repos/:id/quota` · `/settings` | user | Quota + settings. |
| POST | `/me/hosting/groups/:id/repos` | user | Add a repo to a pool. |
| GET | `/admin/repos` · `/admin/repos/identify?fp=` | admin | Admin list + **BC-id lookup**. |
| POST | `/admin/repos/host` · `/:id/verify` · `/reject` · `/revalidate` · `/delete/cancel` · `/check-all` | admin | Admin provisioning/moderation. |
| PATCH | `/admin/repos/:id` | admin | Admin edit — incl. `status` and `category` (**trust tier**: community / partner / official; official+partner float to the top of the public list and get a badge). |
| POST | `/admin/repos/:id/feature` | admin | Boost (feature) a repo for N days (free). |

> **SUSPENDED repos are frozen for the owner.** When a repo's status is `SUSPENDED`, the
> owner (USER role) config mutations — `PATCH /repos/:id`, `PUT /me/repos/:id/settings`
> · `/quota`, `POST /me/repos/:id/upgrade` · `/to-multi` · `/to-single` — return
> `403 { error: 'repo_suspended' }`. Only recovery (`/renew`, `/delete/cancel`) stays open
> to the owner; staff manage everything via `/admin/repos` regardless of status.

## 7. Repo owner dashboard (`repo-dashboard.mjs`)
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/repos/:id/dashboard` · `/activity` · `/traffic` | user (owner) | Dashboard (incl. status + trust tier), activity log, traffic graph — stays viewable even when suspended. |
| POST | `/repos/:id/dashboard/files` · `/files/presign` · `/files/download-zip` · DELETE `/files/:fid` | owner | File manager + bulk zip. |
| POST | `/repos/:id/dashboard/publish` · `/unpublish` · `/lock` · `/unlock` · `/ban` · `/unban` | owner | Publish/lock/ban controls. |
| PUT | `/repos/:id/dashboard/access` · `/settings` | owner | Access control + settings. |

> **Suspended repos are fully frozen**: a `SUSPENDED` repo refuses **every** non-GET here (files add/delete, publish/list, settings, access, state) with `403 repo_suspended` — the dashboard stays read-only until an admin lifts it.

## 8. Hosted repo content & files (`hosting-content.mjs`)
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/hosting/:owner/:repo/repo.json` · `/files/*` | — | Public served repo content (sandboxed, download-only). This is what BMM pulls **and** what the repo page's download buttons link to — one gate, one set of caps/counters. A browser's session counts as identity here (same whitelist/ban entries as BMM's `X-Creator-ID`). |
| GET | `/r/:id/contents` | — | The repo's file list for its web page, plus an `access` verdict (`canDownload`, `restricted`, `reason`). Same visibility rule as `GET /r/:id` (listed+verified, share link `?k=`, or owner/staff). Open repo → full list for anyone. Any restriction + signed out → `reason: 'login_required'` and the **list is withheld**, not just the button (a private repo must not leak its filenames). Banned → 403. Restricted responses are `no-store`. |
| GET/POST/DELETE | `/repos/:id/files[/:fid]` · `/files/presign` | user | Manage a repo's files. |
| POST | `/repos/:id/publish` · `/unpublish` | user | Publish state. |
| GET/POST | `/admin/repos/:id/files` (+ `/download`, `/download-all`, `/publish`, `/unpublish`) | admin | Admin file access. |

## 9. Hosting, billing & Stripe (`hosting.mjs`, `stripe-webhook.mjs`)
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/hosting/plans` · `/capacity` · `/price` · `/feature-price` | — | Plans, capacity, live price preview. |
| POST | `/hosting/checkout` | user | Stripe Checkout for a single hosted repo (supports `autoRenew`). |
| POST | `/repos/:id/feature/checkout` | user | Checkout for a repo feature/boost (one-time or `autoRenew`). |
| POST | `/hosting/cart/quote` | user | Price a **shopping cart** (repos + boosts) live, validating/combining stacked promo codes — no side effects. |
| POST | `/hosting/cart/checkout` | user | One Stripe Checkout for a whole cart. Requires `acceptedTerms:true`; persists a `PendingCart`; per-item `autoRenew` saves the card + the webhook starts a subscription. |
| POST | `/me/billing/portal` | user | Stripe Customer Portal link. |
| GET | `/me/billing/overview` | user | Active Stripe subscriptions (kind, repo name, renew/trial date, cancel state). |
| GET | `/me/invoices` | user | Full Stripe invoice history (one-time + every subscription cycle). |
| GET | `/me/invoices/:id/pdf` | user | Stream the real Stripe invoice PDF as an attachment (ownership-checked). |
| GET | `/me/payments` · `/me/payments/:id` | user | Local payment ledger. |
| GET | `/me/payments/:id/stripe-link` | user | Resolve the genuine Stripe hosted-invoice / receipt URL for a payment. |
| POST | `/me/subscriptions/:id/cancel` | user | Stop auto-renew (`cancel_at_period_end`) or resume (`{resume:true}`), ownership-checked. |
| POST | `/hosting/webhook` | webhook | Stripe webhook (provisions repos/boosts/carts on payment, subscription cycles, refunds — signature-verified). |

## 10. Announcements & notifications (`announcements.mjs`, part of `misc.mjs`)
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/announcements` | — | Active site-wide banner/announcements. |
| GET/POST/PUT/DELETE | `/admin/announcements[/:id]` | admin | Manage announcements (banner toggle, type icons). |
| POST | `/admin/notify-all` | admin | Push a notification to every user. |
| GET | `/me/notifications` | user | My notifications. |
| POST | `/me/notifications/:id/read` · `/read-all` | user | Mark read. |
| DELETE | `/me/notifications[/:id]` | user | Clear one/all. |

## 11. Access policy (`access-policy.mjs`)
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET/PUT | `/admin/access-policy` | superadmin | Global whitelist/ban policy. |
| GET/PUT | `/me/access-policy` | user | Per-owner policy for own repos. |

## 12. Ko-fi (`kofi.mjs`)
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/webhooks/kofi` | webhook | Ko-fi webhook (donor flag, tip log; constant-time token). |
| GET | `/kofi/stats` | — | Public funding-goal stats. |
| GET/PUT/DELETE | `/admin/kofi/goal` | admin | Manage the funding goal. |
| GET/PUT | `/admin/kofi/settings` | admin | Ko-fi integration settings. |
| POST | `/admin/kofi/grant` | admin | Manually grant the donor benefit. |

## 13. Discord bot API (`bot.mjs`)
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/bot/config` · `/bot/token` · `/bot/account/:discordId` | bot | Bot config/token/account lookup. |
| POST | `/bot/heartbeat` · `/bot/activity` · `/bot/link/issue` | bot | Bot heartbeat, activity, link-code issue. |
| GET/POST | `/bot/blog/unannounced` · `/blog/announced` | bot | Blog-announce queue. |
| GET/POST | `/bot/kofi/unannounced` · `/kofi/announced` | bot | Ko-fi tip announce queue. |
| GET/POST | `/bot/payments/unannounced` · `/payments/announced` | bot | Payment/refund announce queue (+ read-once `test` ping). |
| GET/POST | `/bot/dm/pending` · `/dm/sent` | bot | DM delivery queue. |
| GET/POST | `/bot/giveaways/active` · `/:id/posted` · `/:id/enter` · `/:id/drawn` · `/create` | bot | Giveaway sync (post, enter, draw, /giveaway create). |
| GET/PUT | `/admin/bot/config` · `/admin/bot/token` | admin | Bot config + token (dashboard). |
| GET | `/admin/bot/logs` | admin | Recent bot console logs (live logs tab). |
| POST | `/admin/bot/payments/test` | admin | Fire a one-off test payment embed to the configured channels. |
| POST | `/admin/bot/dm` | admin | DM a user a message + optional minted gift promo code. |
| GET/POST/DELETE | `/admin/bot/giveaways[/:id]` (+ `/:id/end`) | admin | Create/list/draw/delete giveaways. |
| GET | `/admin/bot/members` · `/admin/bot/welcome-preview.png` | admin | Members view + welcome image. |
| GET/POST/DELETE | `/me/discord/links` · `/me/discord/redeem` | user | Link/unlink Discord. |

## 14. Creator/Discord links (`links.mjs`) & promo codes (`promo.mjs`)
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET/POST/DELETE | `/me/creator-links[/:id]` | user | Link BMM creator ids. |
| POST | `/link/discord` · `/link/request` · `/link/lookup` · GET `/link/status` | user/— | Pairing-code flow. |
| GET/POST/PATCH/DELETE | `/admin/promo[/:id]` (+ `/:id/redemptions`) | admin | Manage promo codes + redemptions. Codes support `stackable` (combine in a cart) and `assignedUserIds`/`assignedEmails` (gift codes — only those accounts may redeem). |
| GET/POST | `/me/promo/validate` · `/me/promo/redeem` | user | Validate/redeem a code. |

## 15. Admin: users, settings, storage, contact, stats (`misc.mjs`, `analytics.mjs`)
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/admin/users` · `/admin/users/:id` | admin | User search (id/name/email/creator id/Discord/**BC id**) + detail; both include the account moderation state. |
| PUT | `/admin/users/:id/role` | superadmin | Reassign role. |
| DELETE | `/admin/users/:id/sessions/:sid` | superadmin | Sign one of a user's devices out. Scoped by userId as well as session id; idempotent; effective on that device's next request. The list itself comes back from `/admin/users/:id` as `sessions`, which is `null` (not `[]`) for anyone below SUPERADMIN — each row holds the sign-in IP and its approximate location. |
| POST | `/admin/users/:id/moderate` | admin | **Suspend / ban / reactivate** an account (`action`, optional `durationHours` = temporary else permanent, `reason`). Signs the user out within ~15s, blocks login with the reason + remaining time, emails + notifies them. Staff/self are protected. |
| GET | `/admin/settings` · PUT `/admin/settings/:key` | admin | Pricing/hosting knobs. |
| GET | `/admin/storage` · `/admin/billing/users` | admin | Storage: per-area object usage **+ a grand total across all tiers** (object storage, DB, backups, telemetry) each labelled local/remote; + paying/free users. |
| GET | `/reviews` | — | Landing testimonials feed: `{ enabled, reviews[] }` (each with EN `body` + `bodyFr`). |
| GET/POST/PATCH/DELETE | `/admin/reviews[/:id]` | admin | Manage landing testimonials (author/role/EN+FR text/rating/enabled/order). |
| PUT | `/admin/reviews/settings` | admin | Toggle the whole reviews section on/off (`{ enabled }`). |
| GET/POST/DELETE | `/admin/contact[/:id]` (+ `/:id/read`) | admin | Contact-message inbox. |
| POST | `/contact` | pow | Public contact form. |
| GET | `/accounts/search` · `/stats` | user/— | Account search + public stats. |
| GET | `/admin/analytics` · `/admin/analytics/sessions` · `/admin/analytics/geo` | admin | Analytics dashboard; sessions interleave pageviews with **in-page interactions** (clicks/edits/submits/modals) into each visitor's timeline; geo = country/region/city + globe map. |
| GET | `/admin/analytics/vitals` · `/admin/analytics/vitals/page?path=` | admin | Web Vitals: overall percentiles + trend + per-page p75 (`?days=`/`?hours=` for 24h/7d/30d/90d); `/page` breaks ONE path down by device / browser / OS / country. |
| GET | `/admin/analytics/events?path=&kinds=&days=` | admin | Custom-events feed: merged pageview + interaction stream (newest first) with per-kind counts, filterable by path (contains) and kind. |
| GET | `/admin/analytics/errors?path=&days=` | admin | Client errors grouped by message: occurrences, distinct sessions, first/last seen, latest sample (path/stack/device/browser/OS/country). |
| GET/POST/PATCH/DELETE | `/admin/analytics/goals[/:id]` | admin | Conversion goals — match a pageview (path) or interaction (kind + label); GET returns completions + unique-visitor conversion rate over `?days=`. |
| POST | `/analytics/pageview` · `/analytics/vital` · `/analytics/interactions` · `/analytics/error` | — | First-party, consent-gated ingest (pageview, Web Vital w/ device/browser/OS/country, batched interaction events — labels only, never field values, and uncaught errors — bounded message/stack, rate-limited). |
| GET | `/events/active` | — | The live event (drives the fireworks effect + announcement badge; national-day badge shows the country flag). |
| GET/POST/PATCH/DELETE | `/admin/events[/:id]` | admin | Manage events (New Year / national holiday / custom): window, fireworks `fxDensity` (amount) / `fxSize` / `fxFlagDrops`, country flag, badge `linkUrl` (clickable → path or URL), promo %, event code. The admin UI has a live **Preview** (dispatches the effect on-demand); users can disable the effect per-device in Settings. |
| GET | `/sitemap.xml` · `/robots.txt` | — | SEO files. |

## 16. Server performance & alerts (`server-perf.mjs`)
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/admin/server/metrics` · `/alerts` · `/deps-config` | admin | Live CPU/RAM/disk metrics, alert log, dependency list. |
| POST | `/admin/server/sample-now` · PUT `/deps-config` | admin | Force a sample / edit deps. |
| GET/POST | `/bot/alerts/unannounced` · `/bot/alerts/announced` | bot | Alert-announce queue for the bot. |

## 17. Advanced server management (`server-control.mjs`) — **server-control + step-up 2FA**
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/server/elevate/status` · POST `/server/elevate` | server-control | Step-up 2FA elevation. |
| GET | `/server/db/tables` · `/db/table/:name` | server-control | DB viewer (read-logged). |
| PUT | `/server/db/table/:name/cell` | server-control | Edit a cell (audit tables refused). |
| GET/POST | `/server/db/backups` · `/db/backups/:hash/restore` | server-control | DB git-style backups. |
| GET/POST/PUT/DELETE | `/server/files*` (read/write/rename/mkdir/download/backups) | server-control | File manager + backups. |
| GET/POST/PUT | `/server/backups/usage` · `/gc` · `/limit` | server-control | Backup housekeeping. |
| POST | `/admin/telemetry/token` | admin | Mint an SSO token to open the BMM telemetry dashboard (HMAC, epoch-bound). |
| GET/PUT | `/admin/telemetry/config` | admin | Read/update the BMM telemetry service's live config (storage limit, retention, erase delay) — proxied to the service. |
| GET | `/server/telemetry-db/tables` · `/table/:name` | server-control | Read-only viewer over the separate BMM telemetry Postgres. |
| GET | `/admin/security/audit` · `/admin/security/logins` | admin | Security log (actions, login attempts, IPs). |
| GET/PUT | `/admin/server-control/users` · `/admin/server-control/:userId` | superadmin | Grant/revoke the server-control permission. |

---

## 18. Personal API keys & the public v1 API (`api-keys.mjs`)
Named, scoped keys the account owner mints for the public API. Every `/v1/*` route is authenticated by a key and refuses anything outside its scopes.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/me/api-keys` | user | List your keys (never the secret). |
| POST | `/me/api-keys` | user | Mint a key — the secret is returned once. |
| DELETE | `/me/api-keys/:id` | user | Revoke a key. |
| GET | `/v1/scopes` | — | Scope catalogue (what a key may be granted). |
| GET | `/v1/account` | `account:read` | The key owner’s account. |
| GET | `/v1/notifications` | `notifications:read` | Notifications since a watermark (BMM polls this). |
| PATCH | `/v1/account` | `account:write` | Update the owner’s profile fields. |
| GET | `/v1/repos` | `repos:read` | Repos visible to the key. |
| GET | `/v1/repos/:id/files` | `repos:read` | File listing for one repo. |
| GET | `/v1/repos/:id/changes` | `repos:read` | Incremental change feed for one repo. |
| GET | `/v1/users/:id` | `users:read` | One public user. |
| GET | `/v1/users` | `users:read` | User directory. |
| GET | `/v1/catalog` | `catalog:read` | Catalog feed. |
| GET | `/v1/catalog/changes` | `catalog:read` | Incremental catalog changes. |
| GET | `/v1/pools` | `pools:read` | Your storage pools: capacity, what draws from them, the subscription behind them. |
| GET | `/v1/catalogs` | `catalogs:read` | The catalogs you own — including unlisted and hidden ones. |
| GET | `/v1/catalogs/:id/items` | `catalogs:read` | Items inside one of your catalogs, whatever their status. |
| GET | `/v1/payments` | `payments:read` | Your own payment history. Amounts and dates, never card data. |
| GET | `/v1/polls` | `polls:read` | Polls open to you, and how you answered. |
| POST | `/v1/polls/:id/vote` | `polls:write` | Answer a poll. Replaces a previous answer, like the site. |
| GET | `/v1/transfers` | `transfers:read` | Ownership transfers offered to or by you. Read-only on purpose. |
| POST | `/v1/notifications/:id/read` | `notifications:write` | Mark one notification read. |
| POST | `/v1/notifications/read-all` | `notifications:write` | Mark every unread notification read. |

## 19. Avatars (`avatar.mjs`)
Deterministic avatar rendering by account id.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/avatar/:id` | — | Rendered avatar image for an account. |

## 20. Promo campaigns (`campaigns.mjs`)
Site-wide promotional campaigns and the badge the front end shows while one is live.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/promo/campaign/active` | — | The live campaign, if any. |
| GET | `/admin/campaigns` | admin | List campaigns. |
| POST | `/admin/campaigns` | admin | Create a campaign. |
| PATCH | `/admin/campaigns/:id` | admin | Edit a campaign. |
| DELETE | `/admin/campaigns/:id` | admin | Delete a campaign. |

## 21. Community catalogs (`catalogs.mjs`)
User-owned catalogs and their items, the public feed BMM reads, and the moderation surface.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/c` | — | Public catalog index. |
| GET | `/c/:slug` | — (soft) | One public catalog. |
| POST | `/c/:slug/favorite` | user | Toggle a favourite. |
| GET | `/me/favorites` | user | Your favourited catalogs. |
| GET | `/c/:slug/catalog.json` | — (soft) | BMM-native feed for this catalog. |
| GET | `/c/:slug/items/:islug/dl` | — (soft) | Download one item (counts a download). |
| GET | `/me/catalogs` | user | Catalogs you own. |
| GET | `/me/catalogs/:id` | user | One of your catalogs. |
| POST | `/me/catalogs` | user | Create a catalog. |
| PATCH | `/me/catalogs/:id` | user | Edit a catalog. |
| POST | `/me/catalogs/:id/rotate-key` | user | Rotate the private share key. |
| DELETE | `/me/catalogs/:id` | user | Delete a catalog. |
| POST | `/me/catalogs/:id/items` | user | Add an item. |
| PATCH | `/me/catalogs/:id/items/:iid` | user | Edit an item. |
| DELETE | `/me/catalogs/:id/items/:iid` | user | Remove an item. |
| GET | `/admin/catalogs` | `manage_catalogs` / mod | Moderation list. |
| POST | `/admin/catalogs/:id/:action` | `manage_catalogs` | Moderation action on a catalog. |
| GET | `/admin/catalogs/:id/items` | `manage_catalogs` / mod | Items of a catalog under review. |
| GET | `/admin/catalogs/:id/items/:itemId/inspect` | `manage_catalogs` / mod | Inspect an item’s payload. |
| GET | `/admin/catalogs/:id/items/:itemId/download` | `manage_catalogs` / mod | Download an item for review. |

## 22. Social connections (`connections.mjs`)
Linking third-party accounts (and Ko-fi) to a profile, separately from OAuth sign-in.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/auth/connect/providers` | — | Which connection providers are configured. |
| GET | `/me/connections` | user | Your linked accounts. |
| DELETE | `/me/connections/:provider` | user | Unlink a provider. |
| PUT | `/me/connections/kofi` | user | Set the Ko-fi handle. |
| GET | `/auth/connect/:provider/start` | user | Begin linking a provider. |
| GET | `/auth/connect/:provider/callback` | — | Provider callback → links the account. |

## 23. Documentation pages (`docs.mjs`)
The role-gated Docs section: pages, search, revision history and per-page comments.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/docs` | — (soft) | Doc tree visible to the caller. |
| GET | `/docs/search` | — (soft) | Search the docs. |
| GET | `/docs/:slug` | — (soft) | One doc page. |
| POST | `/docs/:id/feedback` | — | Was this page helpful? |
| POST | `/docs` | `manage_docs` / admin | Create a page. |
| PATCH | `/docs/:id` | `manage_docs` / admin | Edit a page. |
| GET | `/docs/:id/history` | — (soft) | Revision list. |
| GET | `/docs/:id/history/:revId` | — (soft) | One revision. |
| GET | `/docs/:id/comments` | — (soft) | Comments on a page. |
| POST | `/docs/:id/comments` | `manage_docs` / admin | Add a comment. |
| PATCH | `/docs/:id/comments/:cid` | `manage_docs` / admin | Edit a comment. |
| GET | `/docs/:id/comments/:cid/history` | — (soft) | Comment edit history. |
| DELETE | `/docs/:id/comments/:cid` | `manage_docs` / admin | Delete a comment. |
| PATCH | `/docs` | `manage_docs` / admin | Reorder / bulk-update pages. |
| DELETE | `/docs/:id` | `manage_docs` / admin | Delete a page. |

## 24. Site events (`events.mjs`)
Scheduled site-wide events the front end reacts to.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/events/active` | — | Events currently running. |
| GET | `/admin/events` | admin | List events. |
| POST | `/admin/events` | admin | Create an event. |
| PATCH | `/admin/events/:id` | admin | Edit an event. |
| DELETE | `/admin/events/:id` | admin | Delete an event. |

## 25. FAQ (`faq.mjs`)
The public FAQ and its admin CRUD.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/faq` | — (soft) | Public FAQ entries. |
| GET | `/admin/faq` | `manage_faq` | All entries, including hidden. |
| POST | `/admin/faq` | `manage_faq` | Create an entry. |
| PATCH | `/admin/faq/:id` | `manage_faq` | Edit an entry. |
| DELETE | `/admin/faq/:id` | `manage_faq` | Delete an entry. |

## 26. 404 game leaderboard (`game.mjs`)
Scores for the “Orb Fall” game on the 404 page.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/game/score` | user | Submit a score. |
| GET | `/game/leaderboard` | — | Top scores. |

## 27. Make Your Own (paid commissions) (`myo.mjs`)
The two-stage commission flow: a paid consultation, then a quote. Requests carry a message thread, streamed over SSE.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/myo/products` | — | Purchasable commission products. |
| POST | `/myo/requests` | user | Open a request (consultation stage). |
| POST | `/myo/requests/:id/pay` | user | Pay the consultation fee. |
| GET | `/myo/requests` | user | Your requests. |
| GET | `/myo/requests/:id` | user | One request with its thread. |
| POST | `/myo/requests/:id/messages` | user | Post to the thread. |
| GET | `/myo/requests/:id/stream` | user | SSE stream of the thread. |
| POST | `/myo/requests/:id/close` | user | Close a request. |
| POST | `/myo/requests/:id/reopen` | user | Reopen a request. |
| POST | `/myo/quotes/:id/pay` | user | Pay an issued quote. |
| GET | `/admin/myo/products` | `manage_myo` | List products. |
| POST | `/admin/myo/products` | `manage_myo` | Create a product. |
| PUT | `/admin/myo/products/:id` | `manage_myo` | Edit a product. |
| DELETE | `/admin/myo/products/:id` | `manage_myo` | Delete a product. |
| GET | `/admin/myo/requests` | `manage_myo` | All requests. |
| POST | `/admin/myo/requests/:id/quotes` | `manage_myo` | Issue a quote. |
| POST | `/admin/myo/quotes/:id/withdraw` | `manage_myo` | Withdraw a quote. |
| POST | `/admin/myo/requests/:id/deliverables` | `manage_myo` | Attach deliverables. |
| PUT | `/admin/myo/requests/:id/status` | `manage_myo` | Set request status. |
| GET | `/admin/myo/settings` | `manage_myo` | MYO settings. |
| PUT | `/admin/myo/settings` | `manage_myo` | Update MYO settings. |

## 28. OAuth2 / OIDC provider (`oidc-provider.mjs`)
BCWEB acting as an identity provider for other applications, plus the admin client registry.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/.well-known/openid-configuration` | — | OIDC discovery document. |
| GET | `/.well-known/jwks.json` | — | Signing keys. |
| GET | `/oauth2/authorize` | — (soft) | Authorization endpoint. |
| GET | `/oauth2/consent-info` | — | What the client is asking for. |
| POST | `/oauth2/authorize/decision` | — (soft) | Record the user’s consent decision. |
| POST | `/oauth2/token` | — | Token endpoint. |
| GET | `/oauth2/userinfo` | — | UserInfo (GET). |
| POST | `/oauth2/userinfo` | — | UserInfo (POST). |
| GET | `/oauth2/me/items` | — | The subject’s catalog items. |
| GET | `/oauth2/me/repos` | — | The subject’s repos. |
| POST | `/oauth2/revoke` | — | Revoke a token. |
| GET | `/admin/oauth-clients` | admin | Registered clients. |
| POST | `/admin/oauth-clients` | admin | Register a client. |
| PATCH | `/admin/oauth-clients/:id` | admin | Edit a client. |
| POST | `/admin/oauth-clients/:id/rotate` | admin | Rotate a client secret. |
| DELETE | `/admin/oauth-clients/:id` | admin | Delete a client. |

## 29. Platform assets & update feeds (`platform-assets.mjs`)
Hosted installers and JSON assets, and the GitHub-Releases-compatible update feed apps poll.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/admin/assets` | admin | List platform assets. |
| PUT | `/admin/assets/json/:key` | admin | Write a JSON asset (links.json, contributors.json…). |
| POST | `/admin/assets/presign` | admin | Presign a file upload. |
| PUT | `/admin/assets/file/:key` | admin | Register an uploaded file. |
| DELETE | `/admin/assets/:key` | admin | Delete an asset. |
| GET | `/updates/:app/latest` | — | Latest release (GitHub-Releases-compatible). |
| GET | `/updates/:app/releases` | — | Release list. |
| GET | `/assets/:key` | — | Fetch a hosted asset. |

## 30. Reports (`reports.mjs`)
User-filed reports with a participant thread, invites, and the moderation queue.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/reports/config` | — | Reporting categories shown to users. |
| POST | `/reports` | user | File a report. |
| GET | `/me/reports` | user | Your reports. |
| GET | `/me/reports/:id` | user | One of your reports. |
| POST | `/me/reports/:id/messages` | user | Post to your report thread. |
| POST | `/me/reports/:id/status` | user | Change status where you are allowed to. |
| GET | `/me/reports/:id/stream` | user | SSE stream of your report. |
| GET | `/admin/reports` | `manage_reports` / mod | Moderation queue. |
| GET | `/admin/reports/:id` | `manage_reports` / mod | One report. |
| POST | `/admin/reports/:id/participants` | `manage_reports` | Add a participant. |
| DELETE | `/admin/reports/:id/participants/:userId` | `manage_reports` | Remove a participant. |
| POST | `/admin/reports/:id/invites` | `manage_reports` | Create an invite link. |
| DELETE | `/admin/reports/:id/invites/:inviteId` | `manage_reports` | Revoke an invite. |
| GET | `/reports/join/:token` | user | Preview an invite. |
| POST | `/reports/join/:token` | user | Accept an invite. |
| POST | `/admin/reports/:id/messages` | `manage_reports` / mod | Reply as staff. |
| POST | `/admin/reports/:id/status` | `manage_reports` / mod | Set status. |
| DELETE | `/admin/reports/:id` | `manage_reports` | Delete a report. |
| GET | `/admin/reports/config` | `manage_reports` / mod | Read the reporting config. |
| PUT | `/admin/reports/config` | `manage_reports` | Update the reporting config. |

## 31. Custom roles & project grants (`roles.mjs`)
SUPERADMIN-authored role bundles layered on top of the role enum, and per-project edit grants.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/admin/custom-roles` | superadmin | List custom roles. |
| POST | `/admin/custom-roles` | superadmin | Create a custom role. |
| PUT | `/admin/custom-roles/:id` | superadmin | Edit a custom role. |
| DELETE | `/admin/custom-roles/:id` | superadmin | Delete a custom role. |
| PUT | `/admin/users/:id/custom-roles` | superadmin | Assign custom roles to a user. |
| GET | `/admin/project-permissions` | admin | List per-project grants. |
| POST | `/admin/project-permissions` | admin | Grant project edit rights. |
| DELETE | `/admin/project-permissions/:id` | admin | Revoke a grant. |

## 32. Public profiles & badges (`social.mjs`)
Public profile reads, user search, and the badge system.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/u/:id` | — (soft) | A public profile (respects its privacy setting). |
| GET | `/users/search` | — (soft) | Search users. |
| GET | `/badges/trigger/:trigger` | — | Badges attached to a trigger. |
| POST | `/me/badges/claim` | user | Claim a claimable badge. |
| GET | `/admin/badges` | admin | List badges. |
| POST | `/admin/badges` | admin | Create a badge. |
| PATCH | `/admin/badges/:id` | admin | Edit a badge. |
| DELETE | `/admin/badges/:id` | admin | Delete a badge. |
| GET | `/admin/badges/:id/holders` | admin | Who holds a badge. |
| POST | `/admin/badges/:id/grant` | admin | Grant a badge. |
| DELETE | `/admin/badges/:id/holders/:userId` | admin | Take a badge back. |

## 33. Telemetry access (`telemetry.mjs`)
The forward-auth endpoint the edge calls to gate the BMM telemetry dashboard, and who may reach it.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/telemetry/authorize` | — | Forward-auth probe the edge calls before serving the dashboard. |
| GET | `/admin/telemetry-access/users` | superadmin | Who may reach the dashboard. |
| PUT | `/admin/telemetry-access/:userId` | superadmin | Grant or revoke dashboard access. |

*Generated from `apps/api/src/routes/` (last refreshed 2026-08-13 — sections 18-33 added: every route module that previously had no section at all, plus the signed-in devices endpoints in §1. Paths, methods and the Auth column were extracted from the source rather than written from memory). For request/response shapes, read the corresponding route module — each is small and commented.*
