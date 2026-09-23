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
- **Trailing slash:** the API answers both spellings — `/api/health` and `/api/health/` hit
  the same route (`ignoreTrailingSlash`). The edge redirects the *site's* paths to the
  slashless form with a 308 (which keeps the method and the body), but `/api` and `/hosting`
  are exempt: a programmatic client gets its answer rather than a redirect it may not follow,
  and under `/hosting` a trailing slash means a directory listing, not the file beside it.

### Auth tiers (the "Auth" column)
| Tag | Meaning |
|---|---|
| **—** | Public, no auth. |
| **user** | Signed-in session cookie. |
| **mod** / **admin** | The moderator or admin *surface*, behind a **2FA-enabled account**. Read it as "at least this far in", not as an exact role: most rows are `requireCap('manage_x')`, which admits ADMIN and SUPERADMIN, any role the capability names, **and** any account whose custom role bundle carries that capability. So an "admin" row is often also open to a MOD or to a cap grantee. Where a row really is `requireRole('ADMIN')` and nothing else, the Purpose column says so. |
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
| GET/POST/DELETE | `/admin/projects/:key/activity-import` | admin (`manage_projects`) | The Activity tab's commit source when GitHub's stats are not enough: POST `{ log, label? }` with the output of `git log --all --format="%H|%aI|%an|%s"` (plain `git log` text is accepted too). Stored as per-day / per-author COUNTS (a few KB, never the messages); GET returns the summary; DELETE goes back to GitHub statistics. While an import exists, `/projects/:key/activity` reads it (`source.imported:true`) and GitHub only supplies the release markers. |
| GET | `/projects` · `/projects/:key` | — | Project config pages (BMM/BSM/…). |
| GET | `/projects/:key/community` · `/progress` · `/releases` | — | Project sub-tab data. |
| PUT | `/projects/:key` | admin | Edit project config. |
| GET | `/projects/:key/content` · `/project/:slug/content` | — (visibility) | G2 + G3: counts of the project's releases, docs and legal pages, and `canEdit` for the caller. |
| GET | `/projects/:key/changelog` · `/project/:slug/changelog` | — (visibility) | The Versions tab: release entries (channel, date, per-language title / highlights / notes / breaking, assets with size + checksum, blog + GitHub links) merged with the page snapshots and the live version. Drafts only for editors. |
| PUT/DELETE | `/projects/:key/changelog/:version` · `/project/:slug/changelog/:version` | editor of THIS project + 2FA | Write (`rename` moves it) or delete one entry. |
| POST | `/projects/:key/changelog/import` · `/project/:slug/changelog/import` | editor + 2FA | Add the project's GitHub releases the history lacks (`{ github? }`); never overwrites. |
| GET | `/projects/:key/pages/:kind` · `/project/:slug/pages/:kind` (+ `/:pslug`) | — (visibility) | The project's own docs (`kind=doc`) or legal pages (`kind=legal`): list, then one page with every language. |
| POST/PUT/DELETE | `/projects/:key/pages/:kind` · `/project/:slug/pages/:kind` (+ `/:pslug`) | editor + 2FA | Create, edit (`baseVersion` → 409 on a concurrent save), delete. Separate from `/docs` and `/admin/legal` (the site's), which stay `manage_docs` / `manage_legal`. |
| POST | `/projects/:key/pages/:kind/import` · `/project/:slug/pages/:kind/import` | editor + 2FA | Read a GitHub `.md` file or folder and return drafts; saves nothing. |
| GET | `/admin/projects` | admin | Admin project list. |
| PUT | `/admin/projects/:key/blog-tab` · `/home-news` · `/visibility` · `/schedule` | admin | Per-project toggles + scheduled update. |
| POST | `/admin/projects/flush-cache` | admin | Flush the GitHub/showcase cache. |
| GET | `/showcase` · `/showcase/:slug` (+ `/community` `/progress` `/releases`) | — | "Other projects" pages. |
| GET/POST/PUT/DELETE | `/admin/showcase[/:id]` (+ `/schedule`) | admin | Manage showcase projects + scheduled swap. |

## 6. Server-Repos (`repos.mjs`)
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/repos` · `/repos.json` | — | Public repo list + aggregate feed (with fingerprint). |
| POST | `/repos` · DELETE `/repos/:id` · PATCH `/repos/:id` | user | Create / delete / edit own repo. `contactEmail` is required when `repoUrl` is given (a repo served elsewhere names somebody to reach), `contactPhone` optional; PATCH is open to the repo's team members, DELETE to the owner. |
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
| POST | `/repos/:id/dashboard/publish` · `/unpublish` · `/ban` · `/unban` | owner | Publish and ban controls. |
| POST | `/repos/:id/dashboard/unlock` · `/lock` | — | Deliberately public: `unlock` IS the password gate (argon2, rate-limited to 10/min, mints the `bcw_rd_<id>` cookie on success) and `lock` only clears that cookie. Listing them as owner-only described a door that has to be open to be knocked on. |
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
| POST | `/hosting/webhook` | webhook | Stripe webhook (provisions repos/boosts/carts on payment, subscription cycles, refunds — signature-verified). Also handles `checkout.session.async_payment_succeeded` (a delayed method clearing later — same delivery as `completed`) and `checkout.session.expired` (a held marketplace pool key goes back). |
| GET | `/marketplace/checkout/:sessionId/status` | user | **Read-only.** What the buyer's return page polls: `{status: pending \| paid \| delivered \| failed, purchase?}`. Ownership-checked (the session must be the caller's). It never delivers — delivery happens in the webhook only. 404 when the session is unknown or somebody else's. |
| GET | `/admin/payments/pending` | manage_hosting | The `PendingCheckout` ledger: every open Stripe checkout (oldest first, with its age in minutes) plus the most recently finished rows. `?limit=` (1–500, default 100). |
| POST | `/admin/payments/reconcile` | manage_hosting | Run the reconciler now. Body `{olderThanMin?}` (default 15, `0` = include checkouts opened seconds ago). Returns `{ok, olderThanMin, summary: {scanned, delivered, alreadyDelivered, failed, stillPending, alerts, errors}}`. 503 `stripe_not_configured` without a key. Audited as `payments.reconcile`. |

**Paid-but-undelivered, and how it is closed.** Every route that opens a Stripe Checkout
(marketplace, hosting, cart, boost, pool, catalog hosting, charity, MYO, showcase listing,
bot) writes a `PendingCheckout` row (`kind`, `sessionId` UNIQUE, `status`) the instant the
session exists. The webhook flips the row to `delivered` (money settled) or `failed`
(expired). If the webhook never ran — API down, endpoint misconfigured — the row stays
`pending`, and `lib/stripe-reconcile.mjs` chases it: at boot (rows older than 1 min), from
the sweeper every ~10 min (older than 15 min), or from the admin button. For each stale row
it retrieves the session from Stripe and **replays the same webhook handler**
(`dispatchStripeEvent`) against it, so there is one delivery path, not two; every branch is
idempotent (marketplace: UNIQUE `checkoutSessionId`, `paymentIntentId` recorded). A paid row
the webhook had not provisioned raises an `ErrorEvent` (source `reconcile`) and notifies every
SUPERADMIN; a row found delivered twice does the same; a row the live webhook did deliver
while the ledger lagged is corrected quietly. The return URL (`/dashboard?market=ok&session_id=…`)
grants nothing: the dashboard polls the status route above until it reads `delivered`.

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
| POST | `/bot/economy/buy` | bot | A `/shop` purchase from Discord. Runs the SAME `buyShopItem()` (`lib/economy-shop.mjs`) as the site's `/me/economy/buy`: price re-read, fulfilment before debit, an `EconomyPurchase` row (the inventory). Badges / pool / boost / hosting / fixed promo codes are delivered by the API; roles and custom rewards are recorded `pending` for an admin. |
| POST | `/me/economy/purchases/:id/reveal` | user | Mint the code of a sealed purchase (promo row assigned to the holder unless the item is giftable; expiry = item.codeDays from now). |
| POST | `/me/economy/purchases/:id/gift` | user | Hand a giftable purchase `{ to }` (id, BC id, e-mail or display name) to another member. |
| POST | `/me/economy/gift` | user | Send points `{ to, points, note? }` — min / daily cap from `economy.gifts`. Both sides get a ledger row; the recipient is notified. |
| GET | `/me/economy/history?kind=` | user | The member's ledger (levelup · grant · purchase · casino · gift_out · gift_in · gift_item_out · gift_item_in). |
| GET | `/admin/economy/stats?days=` | `manage_economy` | Where the points go: totals (members, active 7 d, XP, points, levels) plus generated / won / lost / given / spent for today, yesterday, this week, last week, this month, last month, and a daily series (7–90 days). One GROUP BY per day and kind (`lib/economy-season.mjs`). |
| GET / PUT | `/admin/economy/season` | `manage_economy` | The season schedule (`every`: never / daily / weekly / monthly / quarterly / yearly / custom N days; `weekday`, `dayOfMonth` 1–28, `hour` UTC, `resetXp`, `announce`), the state row (season number, last reset, history) and the next reset. Turning a schedule on starts the clock now. |
| POST | `/admin/economy/season/end` | `manage_economy` | End the season now: every member's points to zero (XP too when `resetXp`), one `season` ledger line per holder. The sweeper runs the same reset when the schedule says so. |
| GET | `/admin/economy/history?q=&kind=` | admin | The whole ledger, by member. Retention: `economy.historyDays` (sweeper). |
| POST | `/bot/economy/reveal` · `/bot/economy/gift` · GET `/bot/economy/history/:discordId` | bot | The same three, for /inventory Reveal / Gift, /gift and /history. |
| GET | `/bot/economy/leaderboard?guildId=&discordId=` | bot | Top 10 — global, or a server's linked members with `guildId`; `me` = the caller's rank. `GET /og/leaderboard.png?guildId=&me=` draws it. |
| GET | `/admin/bot/emoji-keys` · `/admin/bot/emoji/:key.png` · `/admin/bot/emoji-pack.zip` | admin | The bot's button icons: the key list, one PNG, the whole pack. An admin's own mapping in `economy.icons` overrides a key. |
| GET | `/bot/emoji/keys` · `/bot/emoji/:key.png` | bot | The same icon set for the bot itself: at boot it uploads every key as an **application emoji** (`bc_<key>_<version>`), re-uploads the ones whose drawing changed, and never draws a unicode emoji. |
| POST | `/admin/bot/actions` · `/me/discord/guilds/:id/actions` | mod / owner | Now also `role_add` / `role_remove` with `roleId` (+ `guildId` for the admin route). An owner may only name a role the heartbeat lists for that guild. |
| GET / PUT | `/me/discord/guilds/:id` | owner | A server the caller owns or manages. The GET returns its `moderation` (the automod rules + ladder, `features/automod.mjs`) and `logRouting` (`features/logs.mjs`), plus the live `roles` / `channels` from the heartbeat; the PUT accepts `moderation` and `logs` through the bounded `MODERATION_SCHEMA` / `LOGS_SCHEMA` (every number bounded, every action an enum, unknown keys stripped) and MERGES them into `bot.config.guilds[id]` — an owner reaches nothing beyond their own subtrees. |
| POST | `/me/discord/guilds/:id/logs/test` | owner | "Where would this land?" — resolves ONE log category against the **saved** routing (the same order as `resolveRoute()` in `features/logs.mjs`: the category's own route, then its group's, then the log forum, then the log channel, then the `/config` moderation channel) and answers `{ ok, route: { kind, id, tags, from } }`. When it resolves to nothing, `ok` is false and **nothing is queued**. Otherwise a `log_test` BotAction is queued and the bot posts one sample entry there. |
| PUT | `/bot/guilds/:id/features` | bot | The same two subtrees written from Discord (`/logs setup`, `/logs route`): `{ actorDiscordId, patch: { moderation?, logs? } }`, same schemas, same owner-or-linked-manager check. |
| GET | `/bot/economy/purchases/:discordId` | bot | The member's purchases — the `/inventory` command. |
| GET | `/bot/economy/season` | bot | The season schedule, the state row (season number, last reset, history) and the next reset — for the bot's announcement and its "season N" line. |
| POST | `/bot/economy/casino` | bot | One seat against the house: `{ discordId, game, bet, multiplier, note? }`. Limits from `betLimits()` (`maxBet: 0` = no cap, sent as `max: null`), edge from `edgePctFor()` (per game, else global), payout from `payoutFor()` — the edge taxes profit only. Crash's multiplier already carries the edge (`crashPoint()`), so it is passed through untaxed. |
| POST | `/bot/economy/casino/settle` | bot | A live table: `{ game, plays: [{ discordId, bet, multiplier, note? }], pot? }`. With `pot: true` (two or more seats, any game but crash) `splitPot()` rewrites the multipliers: the losers' stakes are the pot, each winner keeps their stake and takes a share ∝ stake × multiplier, the edge is taken once on the share, no winner → the house keeps it. Returns `{ results: [{ discordId, ok, delta, payout, points, share }], edgePct, pot }`. |
| GET | `/bot/economy/leaderboard?discordId=` | bot | Top 10 by level (+ avatar, userId, total). With `discordId`, also `me: { rank, level, xp, points }` for the caller. |
| GET | `/me/economy` | user | Level, XP, points, stats, rates — plus `shopItems`, `purchases`, `pendingDeliveries` for the dashboard card. |
| GET | `/me/economy/shop` | user | The shop from the site: balance, every item (`fulfil: site|admin`, `owned` for a badge already held), and the purchases. |
| POST | `/me/economy/buy` | user (rate-limited) | Buy `{ itemId }` from the site — same function as the bot. 402 `insufficient`, 404 `no_such_item`, 409 for the rest. |
| GET | `/me/economy/purchases` | user | The inventory, newest first, with any code handed over. |
| GET | `/admin/economy/purchases` | admin | Every purchase (pending first) — what a person still has to hand out. |
| POST | `/admin/economy/purchases/:id/deliver` | admin | Mark a role / custom reward as handed out. |
| GET | `/bot/config` · `/bot/token` · `/bot/account/:discordId` | bot | Bot config/token/account lookup. |
| POST | `/bot/heartbeat` · `/bot/activity` · `/bot/link/issue` | bot | Bot heartbeat, activity, link-code issue. |
| POST | `/bot/blog/sync` · `/bot/blog/announced` | bot | Blog-announce queue: the bot asks for the posts due in its channels, then marks what it posted. |
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
| POST | `/admin/economy/race/circuit` | `manage_economy` | A race circuit file, as the admin dropped or pasted it: a Paddock-Manager export (a `segments` list, its own sectors, its own pit lane, `speedFactor` per segment) or a hand-written `{ name, points: [[x, y], …] }`. One object, an array, or `{ circuits: [...] }`. Returns `{ circuits }` in the stored shape (normalised into 0..1 with the aspect kept, resampled to at most 240 points), or 400 `not_a_circuit`. |
| POST | `/admin/economy/race/circuit/resolve` | `manage_economy` | `{ circuit, circuits, seed }` → `{ circuit, builtins }`: the circuit that choice actually runs on, with its geometry, via the same `pickCircuit` the renderer uses. This is what the admin's live preview draws, so "at random" means the same thing in the preview and in the film. |
| POST | `/admin/economy/race/preview.gif` | `manage_economy` | The race film of the settings **in the body** (`circuit`, `circuits`, `laps`, `colours`, `equalStats`, `incidents`, `pitStops`, `seed`, `winner`), not of the saved config, so the admin sees what they are choosing before saving. `image/gif`, `no-store`. |
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
| GET | `/theme` | — | The site theme **and `appIcons`** — the admin-managed Better* project marks the icon picker offers as `app:<key>` (bundled bmm/bsm/bi/bc are the fallback; a stored entry with the same key overrides the image). |
| GET/PUT | `/admin/site/app-icons` | admin | The list `{ icons: [{ key, label, url }] }` — key `[a-z0-9-]{1,24}`, url a site media path or https, max 40, one per key. |
| GET | `/admin/users` · `/admin/users/:id` | admin | User search (id/name/email/creator id/Discord/**BC id**) + detail; both include the account moderation state. |
| PUT | `/admin/users/:id/role` | superadmin | Reassign role. |
| DELETE | `/admin/users/:id/sessions/:sid` | superadmin | Sign one of a user's devices out. Scoped by userId as well as session id; idempotent; effective on that device's next request. The list itself comes back from `/admin/users/:id` as `sessions`, which is `null` (not `[]`) for anyone below SUPERADMIN — each row holds the sign-in IP and its approximate location. |
| POST | `/admin/users/:id/moderate` | admin | **Suspend / ban / reactivate** an account (`action`, optional `durationHours` = temporary else permanent, `reason`). Signs the user out within ~15s, blocks login with the reason + remaining time, emails + notifies them. Staff/self are protected. |
| GET | `/admin/settings` · PUT `/admin/settings/:key` | admin | Pricing/hosting knobs. |
| GET | `/admin/storage` · `/admin/billing/users` | admin | Storage: per-area object usage **+ a grand total across all tiers** (object storage, DB, backups, telemetry) each labelled local/remote; + paying/free users. |
| GET | `/site/showcase` | — | The projects both landing pages (`/` and `/dev`) open with, as media: `{ enabled, intervalMs, items[] }`. Cached 60s. `enabled` is false unless an admin turned it on **and** there is at least one item, so a site that never configured it keeps the hero it has. |
| GET | `/admin/site/showcase` | admin | The RAW stored value, including a list that is switched off — the editor has to see it, or turning it back on would mean retyping it. Also returns `kinds`, `fits` and `max`. |
| PUT | `/admin/site/showcase` | admin | `{ enabled?, intervalMs? (2–30s), items? }`. Each item is `{ id, kind: image\|video\|replay, url, href?, poster?, fit: cover\|contain, scale: 0.5–2, title{en,fr}, blurb{en,fr} }`, max 12. Every URL must be `http(s)` or a same-origin path — `javascript:`, `data:`, `file:` and a protocol-relative `//host` are refused, because each of these ends up in a `src` or an `href` on a public page. Duplicate ids are refused (React would reuse one panel for two projects). A rejection names the offending row and field rather than saying `invalid_input`. |
| GET | `/reviews` | — | Landing testimonials feed: `{ enabled, reviews[] }` (each with EN `body` + `bodyFr`). |
| GET/POST/PATCH/DELETE | `/admin/reviews[/:id]` | admin | Manage landing testimonials (author/role/EN+FR text/rating/enabled/order). |
| PUT | `/admin/reviews/settings` | admin | Toggle the whole reviews section on/off (`{ enabled }`). |
| GET/POST/DELETE | `/admin/contact[/:id]` (+ `/:id/read`) | admin | Contact-message inbox. |
| POST | `/contact` | pow | Public contact form, now the end of a triage. Body: `{ name, email, body, pow, dest?, fields?, kind? }`. `dest` is the destination the questionnaire ended on (`hosting`, `invoice`, `account`, `data_export`, `data_delete`, `security`, `bug`, `other`) and, when given, **it decides the stored `kind`** — a client cannot file a security report into the data-export queue. `fields` is that destination's own answers (an invoice reference, the pool, what was already tried, the required acknowledgements); each is validated against `lib/contact-triage.mjs` and refused with `{ error: 'field_required' \| 'field_too_long' \| 'unknown_destination', field }`. The answers are written above the message in the body the admin inbox already shows. Rights claims and reports do not come here at all: the page routes those to `/rights/notice` and `/reports`. |
| GET | `/accounts/search` · `/stats` | user/— | Account search + public stats. |
| GET | `/admin/analytics` · `/admin/analytics/sessions` · `/admin/analytics/geo` | admin | Analytics dashboard; sessions interleave pageviews with **in-page interactions** (clicks/edits/submits/modals) into each visitor's timeline; geo = country/region/city + globe map. |
| GET | `/admin/analytics/vitals` | admin | Web Vitals: overall percentiles + trend + per-page p75 (`?days=`/`?hours=` for 24h/7d/30d/90d). |
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
| GET | `/admin/server/metrics/daily?days=` | `manage_server` / admin | The daily rollup (CPU, memory, disk, latency averages + peaks per day) for the window, with the same-length window immediately before it: `series`, `current`, `previous`, `change` (per metric: `current`, `previous`, `abs`, `pct` — null against an empty previous window, never 0) and `coverage`. The public status page's former "System metrics" block; `/status` no longer carries `metrics`. Arithmetic in `lib/metrics-compare.mjs`. |
| GET | `/admin/server/metrics/compare?days=` | admin | Long-range comparison out to a year (averages, peaks, load, latency, network, downtime, uptime %) against the period before. |
| POST | `/admin/server/sample-now` · PUT `/deps-config` | admin | Force a sample / edit deps. |
| GET/POST | `/bot/alerts/unannounced` · `/bot/alerts/announced` | bot | Alert-announce queue for the bot. |

## 17. Advanced server management (`server-control.mjs`) — **server-control + step-up 2FA**
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/server/elevate/status` | admin | A status PROBE, so it answers rather than refuses: the `canControlServer` grant is part of the answer, not the gate. It used to sit behind the very thing it reports, so anybody without the grant got a 403 for a perfectly normal state. |
| POST | `/server/elevate` | server-control | Step-up 2FA elevation. This one is gated. |
| GET | `/server/db/tables` · `/db/table/:name` | server-control | DB viewer (read-logged). |
| PUT | `/server/db/table/:name/cell` | server-control | Edit a cell (audit tables refused). |
| GET/POST | `/server/db/backups` · `/db/backups/:hash/restore` | server-control | DB git-style backups. |
| GET/POST/PUT/DELETE | `/server/files*` (read/write/rename/mkdir/download/backups) | server-control | File manager + backups. |
| GET/POST/PUT | `/server/backups/usage` · `/gc` · `/limit` | server-control | Backup housekeeping. |
| POST | `/admin/telemetry/token` | admin | Mint an SSO token to open the BMM telemetry dashboard (HMAC, epoch-bound). |
| GET/PUT | `/admin/telemetry/config` | admin | Read/update the BMM telemetry service's live config (storage limit, retention, erase delay) — proxied to the service. |
| GET | `/server/telemetry-db/tables` · `/table/:name` | server-control | Read-only viewer over the separate BMM telemetry Postgres. |
| GET | `/admin/security/audit` · `/admin/security/logins` | admin | Security log (actions, login attempts, IPs). |
| GET | `/admin/security/audit/verify` | admin | Recompute the whole HMAC chain and cross-check the external anchors. Reports the first break, why, and how much of the log sits after it. |
| GET | `/admin/security/audit/evidence` | admin | The evidence bundle: the break, the hundred rows around it, every anchor, signed with the site key. Signature covers the `bundle` **string**, so a reader verifies exactly the bytes that were signed. |
| POST | `/admin/security/audit/anchor` | admin | Write the newest entry's fingerprint to the anchor volume, outside the database — after which deleting the newest rows becomes detectable. |
| POST | `/admin/security/audit/reseal` | superadmin + elevated | Re-sign the chain from the first break so the **next** alteration is detectable. Refuses unless an evidence bundle was exported after the break, records what it covered, and anchors that record. It does not make the re-signed entries trustworthy. |
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
| GET | `/v1/polls/:id` | `polls:read` | One PUBLIC poll by id — open **or closed** — with every option id (what `/vote` takes), the multi-question form (question ids + choice ids), `myVotes`, and the tally once it may be seen (after you answer, or when closed / `results: always`). Unlisted and private polls answer 404. |
| GET | `/v1/charity` | `charity:read` | Off → 404 `charity_disabled` (see §44). The Community Charity pot this month — the same shape the landing widget reads: association, percent, totals, the vote's id + open flag, and `design` (the landing card's look: `mode` default/custom, frame `width`/`height`, `ink`, `align`, the `backdrop`/`overflow`/`sticker` image URLs with `bleed`, `stickerSize`, `stickerCorner`, `stickerOffset`). |
| GET | `/v1/economy` | `economy:read` | Your Discord level, XP (this level / to next), points, activity counts and the XP rates. |
| GET | `/v1/economy/purchases` | `economy:read` | What you bought in the points shop, with any code handed over and its `delivered`/`pending` status. |
| GET | `/v1/badges` | `badges:read` | The badges on your profile, with `earnedAt` and whether staff or a rule (`how`) granted them. |
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

### 30b. Rights notices (`rights.mjs`)
Formal copyright / trademark / privacy / illegal-content notices (DSA Art. 16, LCEN, Swiss CopA), a protected-works registry with hash + pattern + URL matching, and the admin tooling around them. Rules live in `lib/rights-match.mjs` (pure).

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/rights/resolve?q=` | — | Turn a pasted URL / id into a precise target (repo, catalogue item, user, file). Owner ids are stripped. |
| POST | `/rights/notice` | PoW, account optional | File a notice. Refused unless every element is present (`no_target`, `work_required`, `explanation_short`, `name_required`, `email_invalid`, `good_faith_required`, `accuracy_required`, `signature_required`); `own_content` when every target is the caller's; 5 per day per IP / e-mail. Returns the notice with its `code`. |
| GET | `/rights/notice/:code?email=` | — | Follow a notice by code + the sender's e-mail (404 otherwise). |
| GET | `/me/rights` | user | Notices the caller filed, and those against the caller's content (with the counter-notice they may answer with). |
| GET | `/admin/rights` · `/admin/rights/:id` | `manage_reports` | The queue (filter by status / kind) and one notice with its history. |
| POST | `/admin/rights/:id/status` · `/note` | `manage_reports` | `new` / `reviewing` / `closed`; an internal note. |
| POST | `/admin/rights/:id/takedown` | `manage_reports` | Sanction every target through `/admin/sanctions/content` (same path as a report), record the decision, notify sender and owner, count a strike. |
| POST | `/admin/rights/:id/reject` · `/counter` · `/restore` | `manage_reports` | Reject with a reason (sender told when `tellReporter`); record the owner's counter-notice; lift the sanction. |
| GET/POST/PATCH/DELETE | `/admin/rights/works[/:id]` | `manage_reports` | The protected-works registry: title, owner, hashes, name patterns, URLs. New uploads are matched on save (`flagIfProtected`). |
| POST | `/admin/rights/scan` | `manage_reports` | Re-match existing content against the registry; opens `match` notices. |
| GET/PUT | `/admin/rights/config` | `manage_reports` | `strikeThreshold`, `strikeWindowDays`, `counterDays`, notice e-mail copy. |

### 30c. Teams (`teams.mjs`)
Accounts that manage repos, catalogues and pools together. `canManage()` (`lib/teams.mjs`) = owner, staff, or an active member of the entity's team; billing, deletion and keys stay owner-only.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/teams/:slug` | — | Public card: members, contact e-mail / phone / website / Discord, listed repos and catalogues. |
| GET | `/me/teams` | user | Mine, with `myRole` (owner / admin / member) and `myStatus` (invited / active). |
| POST | `/me/teams` | user | Create `{ name, contactEmail*, contactPhone?, website?, discord?, description? }` (≤ 10 owned). |
| PATCH / DELETE | `/me/teams/:id` | owner (admin for PATCH) | Details; dissolve — members cascade, attached items are detached. |
| POST | `/me/teams/:id/members` | owner / admin | Invite `{ to, role? }` — id, BC id, e-mail or exact display name; the invitee is notified. |
| POST | `/me/teams/:id/accept` · `/decline` | invitee | Answer an invitation. |
| PATCH / DELETE | `/me/teams/:id/members/:userId` | owner (admin may remove members) | Role; remove, or leave (self). |
| POST | `/me/teams/:id/transfer` | owner | `{ userId }` — the new owner; the old one stays admin. |
| PUT | `/me/teams/:id/attach` | team admin + item owner | `{ kind: repo\|catalog\|group, id, attach }`. |

### 30d. Contact threads (`threads.mjs`)
A conversation with the owner and team behind a repo, a catalogue, a profile or a team — not a report. Limits are counted in the database; a blocked account / e-mail can neither open nor answer.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/threads` | optional; PoW + `email` when anonymous | `{ kind: repo\|catalog\|user\|team, targetId, subject, body, email?, name?, pow? }` → 201 with the thread; an anonymous sender also gets `accessToken`. `yourself`, `blocked`, `rate_limited`, `disabled`. |
| GET | `/me/threads?box=inbox\|sent` | user | Inbox = addressed to me or my teams; sent = opened by me; `unread`. |
| GET | `/me/threads/:id` | participant | The thread and its messages (marks my side read); 404 for anyone else. |
| POST | `/me/threads/:id/messages` · `/close` · `/reopen` · `/flag` | participant | Reply (the other side is notified / e-mailed); close; reopen; report to staff. |
| GET / POST | `/threads/t/:token` · `/threads/t/:token/messages` | the token | The anonymous sender's side. |
| GET | `/admin/threads?status=&q=` · `/admin/threads/:id` | `manage_reports` | The queue (`flagged` first) and one thread with hidden messages, sender e-mail and IP. |
| POST | `/admin/threads/:id/close` · `/block` · `/messages/:mid/hide` · `/unhide` | `manage_reports` | Moderation; block adds the sender to the blocklist and blocks every thread they opened. |
| GET | `/legal` | public | Adds `optional: ['dpa']` — documents that ship in the bundle and are OFF until a published `LegalPage` row exists. Their sections are withheld too, `/me/legal-pending` stops asking for their acceptance, and the client hides the bundled copy it holds. Switch one on by publishing its page (`PUT /admin/legal/pages/:id { published }`, or `POST /admin/legal/pages` when there is no row yet). |
| GET / POST | `/me/teams/limits` · `/me/teams/slot/checkout` | session | How many teams the account owns vs may own (`teams.maxOwned` + bought slots; staff uncapped) and the slot price; the checkout is a one-off Stripe payment (`metadata.type = team_slot`) — the webhook writes a `TEAM_SLOT` Payment (idempotent on the session) and increments `User.extraTeamSlots`. `POST /me/teams` answers 409 `too_many_teams` with `{ owned, limit, slot }`. |
| GET / POST / DELETE | `/me/teams/:id/invites` · `/me/teams/:id/invites/:inviteId` · `/teams/join/:token` | owner/admin · anyone signed in | Invitation links (`/teams/join/<token>`, for a role). Two kinds: **one permanent** link per team (`days` absent or 0, never expires) and up to `teams.inviteMaxTemporary` temporary ones, each given one of the `teams.inviteLifetimeDays` lifetimes. `GET` returns `{ invites, permanent, temporary, policy }`, every invite carrying `kind` (`permanent` \| `temporary`), `usable` and its `url`. `POST` answers 409 `permanent_exists`, `too_many_invites` (`{ limit, open }`) or `invalid_lifetime` (`{ allowed }`); only links that still work count against either cap. `DELETE` revokes one (404 when already revoked) and frees its slot at once. `GET /teams/join/:token` says what team and whether the link still works; `POST` joins as an active member (50-member cap). |
| GET | `/f/:token` · `/f/:token/info` | token (+ the owner's session for a deliverable) | A file behind a link that stops working (`ExpiringFile`): a MYO deliverable (30 days after delivery or 7 after the first download, whichever first — the first download is written into the conversation as the proof), a mail attachment (`attachDays`). `info` says status / until when / downloads; the download redirects to the bytes, or answers 410 `expired` / 403 `forbidden`. The sweeper deletes the object a week after the date; archiving a MYO request revokes its links and deletes its attachments. |
| GET / PUT | `/admin/mail/custom-templates` | admin | The composer's own templates `[{ id, label, subject, body, audience, cta? }]` (≤ 30), in the mail's markdown. `POST /admin/mail/send` also takes `attachments: [{ url, name, size }]` (MEDIA uploads), `attachDays` (1–90) and `attachMode: link|inline` (≤ 8 MB total inline). `GET /admin/mail/gallery` returns `builtin[id]`, the built-in body of each editable mail, to edit in place. |
| GET | `/admin/search?q=` | staff | One box over the dashboard's data: accounts, server repos, community catalogues, teams, conversations, reports, sanctions, commissions, blog posts, docs, FAQ, polls, promo codes, other projects — each group only when the caller holds its capability, ≤ 6 rows per group, with the admin `href` to open. The sidebar's search ranks screens locally (FR/EN synonyms, accents, typos) and shows these below. |
| GET | `/admin/media-flags?status=&page=` · POST `/admin/media-flags/:id` | `manage_reports` | Lookalike pictures: uploads whose perceptual hash (64-bit DCT pHash) is within the configured Hamming distance of — or byte-identical to — a picture another account holds; both pictures per flag; `{ status: cleared\|actioned\|pending, note? }` resolves one. |
| GET / PUT / POST | `/admin/media-hashes/stats` · `/settings` · `/scan` · `/:id/preview` | `manage_reports` | Counts and the `{ threshold, enabled }` setting (`media.phash`); `scan` hashes a batch now (`{ backfill: true }` also registers older public-media objects); `preview` serves the picture (a short-lived storage link, the avatar URL, or the bytes of an image inside an archive). Rows are created at presign time and hashed by the sweeper. |
| GET / PUT | `/admin/threads/config` | `manage_reports` | `enabled`, `userPerHour/Day`, `anonPerHour/Day`, `messagesPerHour`, `maxBody`, `blockedEmails[]`, `blockedUserIds[]`. |

## 31. Custom roles & project grants (`roles.mjs`)
SUPERADMIN-authored role bundles layered on top of the role enum, and per-project edit grants.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/admin/showcase-requests/:id/approve` | admin | Now also takes `project` (the full page as the New-project modal writes it: name, short, icon, config, published, pinTopbar, visibility, whitelist, announcement) — “Approve & configure” creates the listing finished instead of bare. |
| PUT/POST | `/admin/custom-roles[/:id]` | superadmin | Accepts `scope: { projectKeys[], showcaseSlugs[], allShowcase }`. A scoped role adds no site-wide capability; it grants content-edit rights on those elements through `projectGrants()`. |
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

**Automatic rules (`Badge.rule.type`).** `signup_nth` (every N), `signup_before` (date), `kofi_donation`, and since 2026-09-05: `level_reached` (level), `messages_sent` (count), `purchases_made` (count), `polls_answered` (count), `items_published` (count), `repo_hosted`, `discord_linked`, `twofa_enabled`, `account_age` (days). Event rules fire at the moment (`grantAutoBadges`, hooked into accrual, purchases, votes, approvals, provisioning, links, 2FA); threshold rules are also swept once a day (`sweepAutoBadges`) so people already past the bar get the badge. Every grant emits `badge.earned`.

## 33. Telemetry access (`telemetry.mjs`)
The forward-auth endpoint the edge calls to gate the BMM telemetry dashboard, and who may reach it.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/telemetry/authorize` | — | Forward-auth probe the edge calls before serving the dashboard. |
| GET | `/admin/telemetry-access/users` | superadmin | Who may reach the dashboard. |
| PUT | `/admin/telemetry-access/:userId` | superadmin | Grant or revoke dashboard access. |
| GET | `/internal/telemetry/identity?creatorId=` | `x-link-secret` | **Server-to-server, for the telemetry service.** Whether a BMM creator id (the hex of an install's ed25519 public key — the telemetry payload carries NO account id) is linked to an account: `{ linked, userId, email, displayName, locale, creatorIds }`. `creatorIds` is every id linked to the same account, so a GDPR request filed for one install covers all of them. Secret = `LINK_LOOKUP_SECRET` (the service's `BC_LINK_SECRET`). |
| POST | `/internal/telemetry/notify` | `x-link-secret` | **Server-to-server.** Send the GDPR confirmation mail: `{ kind: export\|delete, outcome: done\|rejected, requestId, creatorId, creatorIds?, to: { userId } \| { email }, counts?, erased?, attachment?: { filename, base64 } (zip, ≤ 18 MB base64), tooLarge? }`. `to.userId` is resolved to the account's CURRENT address here, in the account's language — the address never leaves BCWEB; `to.email` is what an unlinked install typed. Answers `{ ok, sent }`, or `{ ok:false, reason }` (`email_disabled`, `account_not_found`…) so the service records "not notified" instead of guessing. |
| POST | `/me/telemetry/data-request` | user | File a GDPR request for one of MY linked BMM installs, `{ creatorId, kind: export\|delete }` (Settings → Cookies & privacy → BMM telemetry). The creator id must be in the caller's `CreatorLink`s — that is the proof — and the request is proxied to the telemetry service (`TELEMETRY_INTERNAL_URL` + the public `TELEMETRY_API_KEY`) with `source: bcweb`; the confirmation (export attached) goes to the account's e-mail, nothing is typed. `{ ok, id, duplicate }`; 403 `not_your_creator_id`, 503 `telemetry_not_configured`, 502 `telemetry_unreachable`. 10/h. Audited `telemetry.data_request`. |

**GDPR flow, end to end.** A request is (creator id, kind) and reaches the telemetry
service's `data_requests` table from three places: BMM (Settings › Privacy, with a typed
address), a signed-in account here (the route above, no address), or the dashboard's
Data-requests screen (an admin filing for someone who wrote in). The service asks
`/internal/telemetry/identity` when filing and again when processing: a linked account never
carries a typed address (the mail goes to the account, which is what stops anyone redirecting
someone else's export), an unlinked install must give one. Exports are processed within a
minute (one zip per person: `README.txt`, `tables/<name>.json`, `replays/<session>.bmmreplay`,
`export.json`, attached when ≤ 12 MB); erasures wait the review delay (`TELEMETRY_DELETE_DELAY_H`,
live-editable) unless an admin processes them, then delete from the same table list the export
reads, remove geo rows nobody else shares, and anonymise the request row (`erased:<hash>`).
Every outcome is written to the service's audit log and mailed through `/internal/telemetry/notify`.

**Sampling.** The dashboard's Settings screen (or `GET/PUT /admin/telemetry/config` above,
key `sampling`) holds a total cap plus a percentage per element kind (`events`, `replay`,
`errors`, `perf`, `benchmarks`, `logs`). The decision is deterministic per install and per kind
(`fnv1a32("creatorId:kind") % 10000 < pct × 100`), delivered to BMM in every `/batch` answer
and on the service's `GET /config`; the service applies the same rule on ingest. It reduces
what is collected and never touches what is already stored.

**Map.** The dashboard's Geography screen draws OpenStreetMap raster tiles (no API key —
standard OSM tiles in light, CARTO dark-matter from the same OSM data in dark, attribution
always shown) and clusters user points server-free in MapLibre; locations stay approximate.

## 34. Developer tools (`devtools.mjs`)
The inspector, the maps the admin dashboard draws from, and two checkers that read an artifact
before it is published.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/dev/inspect` | signed in | Read a BMM document and report what it is. |
| POST | `/admin/inspect` | `manage_catalogs` / mod | The same reader, on the moderation door. |
| POST | `/dev/validate-recipe` | signed in | Check a BetterInstaller `installer.toml` against the published schema. |
| POST | `/dev/validate-feed` | signed in | Check a catalogue feed (by URL or body). |
| GET | `/admin/schema-map`, `/admin/rbac-map`, `/admin/compose-map`, `/admin/secrets-map`, `/admin/infra-map`, `/admin/migration-map`, `/admin/data-flow`, `/admin/config-diff` | admin | The generated maps behind the admin dashboard. All eight are `requireRole('ADMIN')`, not SUPERADMIN, which this table claimed until it was checked against the code. The secrets map reports env-var NAMES and whether each is guarded at boot, never a value. |


### The two artifacts these tools read

Neither checker keeps its own copy of what it is checking against, and both say so on screen
when the artifact is missing rather than pretending every name they do not recognise is a typo.

| Asset key | Produced by | Feeds |
|---|---|---|
| `bmms-vocabulary.json` | `node scripts/gen-bmms-reference.mjs` in BMM | the `.bmmscript` checker, which runs in the BROWSER (`apps/web/src/lib/bmmscript-lint.js`, surfaced at `/dev/tools`) and has no route of its own: it fetches this asset and checks the shape when it is missing |
| `installer-schema` | `bpkg schema --out schema/installer-schema.json` in BetterInstaller | `POST /dev/validate-recipe` |

Upload each as a platform asset under that key.

!!! warning "They go stale silently, and only on this side"

    BMM's CI regenerates its vocabulary and fails if somebody forgets — so the file in that
    repository is always right. Nothing here can tell that the copy uploaded to this site is
    six months older.

    The symptom is a checker that reports valid action names as unknown, which reads as a broken
    file rather than a stale upload. Re-upload after BMM's language grows: it is currently 104
    actions, 37 conditions and 59 keywords.

**What the inspector recognises.** By SHAPE, never by a claim in the file — a document saying
`format: "mm"` proves nothing about itself, and a signed one that lies about its own type is
exactly the case moderation exists for:

| Reported as | Recognised by |
|---|---|
| `bmmpa` | `magic: "BMMPA"`, or an array/`tasks` of objects with `steps` |
| `bmmnav` | `format: "bmmnav"` |
| `bmmlaunch` | a launch pack: `kind: "bmm-launchpack"`, or a `name` alongside `exe_paths[]` |
| `bmmreplay` | `events` alongside `console`/`rustLog`, or a bare rrweb event array |
| `bmmplug` | a plugin manifest: `id` + `name` **and** one of `apply_mode` / `permissions` / `modlist` / `assets` / `scripts` |
| `mm-locked` | `bmm_locked: true` + a `sealed` block (contents encrypted; the header stays readable on purpose) |
| `repo` | a Server-Repo manifest: `profiles[]` carrying `mods` |
| `mm` | `format_version` + `mods[]` |
| `bmp` | modpack: `mods[]` whose entries have `mod_id` + `file_manifest` |
| `cbmp` | modpack catalogue: `modpacks[]` with a `file` each |
| `bmmcat` | any other catalogue — checked LAST, because `modpacks` is one of its arrays too |

Two of these are recent, and both existed as a hole rather than a decision. A **`repo` manifest**
is the file a moderator opening a hosted repo is most likely to be holding — and the one that now
carries plugins, themes, scheduled tasks and catalogues as extras. A **plugin manifest** is what
the unknown-format hint has been telling people to paste for as long as it has existed, while
doing so answered "not a recognised BMM format": the advice was right and the reader was missing.

A **launch pack** is the newest and the loudest: its entire content is a list of programs that
will be started on the machine that imports it. The reader says how many, prints every path
exactly as written — never resolving one, never opening one — and flags two things a filename
cannot show: which programs go through a **shell** (BMM's own launcher runs a `.ps1` with the
execution policy bypassed and a `.bat` through `cmd`), and which are named by a **relative**
path, which resolves against whatever folder happens to be current when it fires.

A plugin is the one thing here that is CODE running inside somebody's BMM, so its summary is
ordered by what has to be decided about it: what it may reach (permissions), whether it runs
anything (scripts), what it changes (its mod list), then what it ships alongside (assets). The
asset list is a **declaration** — written from disk when the plugin was packed, and editable by
hand afterwards — so it is reported as what the manifest says, not as what is in the archive.

`signature` is reported for **every** format, including the ones BMM does not sign yet:
"unsigned" is an answer, and it is the one a reviewer needs to see rather than a blank space
where a verdict would go. For an archive the entries travel as `name` + `sha256` and the file
itself never leaves the reviewer's machine — the signature covers exactly that list.

Nothing here writes. An inspector for untrusted content that stores what it read is a way to get
content stored.

## 36. Content export (`content-backup.mjs`)
The written content, as JSON, for reading elsewhere — **not** a restore point.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/admin/content-backup/preview` | ADMIN + server-control + step-up | Every section with its row count and whether it is on by default. The counts come first because "which sections" is not a choice without a number beside each one. |
| GET | `/admin/content-backup?include=a,b` | ADMIN + server-control + step-up | A zip, one JSON file per selected section. |

Accounts are exported through an **explicit `select`** — never a whole row with fields
deleted afterwards, because a spread hands over whatever column is added next and the day
that column is a secret nobody is reading this file. `content-backup.test.mjs` asserts it
against the source and runs without a database, so it fails on a laptop with nothing
running.

The chain is the one every other tool on that screen uses — the DB viewer, the file
manager, Docker and power all run `[ADMIN, canControlServer, elevated]`. It hands over every
account record and every word on the site in one file, so being the one button on that screen
any admin could press was not a difference worth defending.

Catalogues and repositories default **off**: their rows are metadata pointing at objects in
MinIO that the zip does not carry. See [BACKUP_EN.md](../run/BACKUP_EN.md) for which of the
three things called "backup" answers which question.

## 37. Webhooks (`webhooks.mjs`, `lib/webhooks.mjs`)
Outgoing webhooks an account subscribes from Dev → Config. Every delivery is signed (`X-Webhook-Signature`, HMAC over `timestamp.body` with the endpoint's secret) and retried on a back-off (1 min → 10 h, six attempts).

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/v1/webhook-events` | — | Every event and what it means. |
| GET/POST | `/me/webhooks` | user | List / create an endpoint `{ url, events[] }` — the secret is returned once. |
| PATCH/DELETE | `/me/webhooks/:id` | user | Edit (url, events, enabled) / remove. |
| POST | `/me/webhooks/:id/rotate` · `/test` | user | New secret · send a `ping`. |
| GET | `/me/webhooks/:id/deliveries` · POST `…/deliveries/:did/replay` | user | The delivery log · resend one. |
| GET | `/admin/webhooks` | admin | Every endpoint, for support. |

**Events.** Content: `catalog.item.published` · `.updated` · `.removed` · `.submitted`, `repo.updated`, `repo.status.changed`, `item.downloaded` (coalesced per minute), `item.milestone`, `repo.downloaded` (coalesced), `review.posted`, `stats.daily`. Account: `pool.storage.warning` · `.changed`, `subscription.expiring`, `sanction.issued`, `transfer.offered`. Community & economy (2026-09-05): `poll.opened` / `poll.closed` (**broadcast** — to every endpoint subscribed, carries the option ids to answer with), `charity.month.closed` (**broadcast**), `badge.earned` (a rule, a purchase, staff, or an easter egg — `via` says which), `economy.level_up` (`level`, `from`, `pointsGranted`), `shop.purchased` (`purchaseId`, `kind`, `cost`, `status`).

## 38. Repo agent — a server the owner runs (`repo-agent.mjs`)
A repo hosted somewhere else, managed from here without us holding a key to that machine. The
obvious shape for "manage my server from BCWEB" is an SSH key; we refuse to take one, because a
private key that opens a shell on a box we do not own is the worst asset a web platform can
store — a breach here would stop costing accounts and start costing users their servers. The
direction is reversed instead: **their** machine holds a bearer token for **us**.

The owner mints the token in the repo dashboard (Server tab, external repos only). It is shown
once and stored as a sha256 hash, exactly like a personal API key; there is no endpoint that can
read it back, and rotating is the recovery path.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/me/repos/:id/agent` | owner | Status: prefix, last call, what the machine reported. Never the secret. |
| POST | `/me/repos/:id/agent` | owner | Create or rotate. Returns `{ token }` — the only time it exists here. |
| DELETE | `/me/repos/:id/agent` | owner | Revoke. The row stays so the panel can still say what was in use. |
| POST | `/me/repos/:id/agent/command` | owner | Queue one job: `rescan` or `ping`. One slot, not a queue. |
| POST | `/agent/hello` | agent token | Heartbeat. Body `{ version?, host? }` → `{ repo, command }`. |
| POST | `/agent/report` | agent token | `{ ok, command?, fileCount?, totalBytes?, manifestSha?, error? }`. |

**The loop.** `hello` on a timer → if `command` is non-null, do it locally → `report` **naming
that command**, which is what clears it. A report that does not name the job leaves it queued,
so a routine heartbeat cannot swallow a job the owner queued a second earlier.

**What it cannot do.** A report writes to the agent's own row and nothing else — never the
repo's `status`, `sha`, `verified` or `pendingReview`. Those decide what the public list shows
and whether a moderator has checked the content, and a self-reported number from a machine we do
not run must not move them. A stolen token therefore buys an attacker the ability to lie about a
file count, and revoking is one row.

## 39. Custom domains (`domains.mjs`, `lib/domain.mjs`)
A paying owner points their own hostname at us and their repo or catalogue answers on it. A row
in `CustomDomain` is permission to spend a real resource on somebody else's name — the edge
obtains a TLS certificate on demand — so the rules are enforced in three places, not one.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/domains/ask?domain=` | — (the edge) | Caddy's `on_demand_tls { ask }`. 200 = issue a certificate, anything else = refuse. |
| GET | `/domains/guide?host=` | — | The two records for an example host (or the one given), built by the same helper as the owner's: the `_bcw-verify` TXT proof (placeholder token) and the CNAME `pointer` to the site's own hostname. What /hosting shows. |
| GET | `/me/:kind/:id/domain` | owner | The domain and the DNS records to add (`record` = the TXT proof, `pointer` = the CNAME). `:kind` is `repos` or `catalogs`. |
| PUT | `/me/:kind/:id/domain` | owner | Claim a host. A new host means a new token and verification from zero. |
| DELETE | `/me/:kind/:id/domain` | owner | Remove it. The bettercommunity address is unaffected. |
| POST | `/me/:kind/:id/domain/verify` | owner | Resolve `_bcw-verify.<host>` TXT now and compare. Also answers `traffic: ok / missing / unknown` (does the name already resolve to us), which is informational and never part of `verified`. |

**Proof of control.** A TXT record at `_bcw-verify.<host>` carrying a per-domain token. Per
domain rather than per account, so removing one does not invalidate a record already published
for another.

**Eligibility** is a paid pool, checked when claiming, when the edge asks, and on every request
— a pool that lapses has to stop being a reason to renew a certificate and stop resolving to
content, or cancelling would leave us serving traffic and buying certificates indefinitely.

**Routing.** An `onRequest` hook rewrites a request arriving on a customer host: `/` becomes
the repo's `repo.json` (or the catalogue's `catalog.json`), and `/x/y` becomes
`/hosting/<hostPath>/files/x/y`. Everything downstream — access lists, sync password, counters,
the directory-listing switch — is the code that was already there. The lookup is skipped for our
own host (which is every request in practice) and memoised for a minute otherwise.

**Refused hostnames**: wildcards (an on-demand certificate cannot be a wildcard), IP addresses,
single labels, anything with an underscore, and any name at or under our own — compared with a
dot, so `notbettercommunity.test` is not treated as a subdomain of `bettercommunity.test`.

## 40. Linking a git forge (`lib/gitsource.mjs`)
"Link my git repo" means pasting `https://github.com/me/mods`, which is a WEB PAGE: a client
fetching it gets HTML, fails to parse a manifest out of it, and reports the repo as broken. The
address is converted to the raw file the forge serves for the same tree, on repo create and on
repo edit — both doors, because a rule applied to one of two is a rule that depends on which
door somebody used.

| Pasted | Becomes |
|---|---|
| `github.com/me/mods` | `raw.githubusercontent.com/me/mods/HEAD/repo.json` |
| `github.com/me/mods/tree/dev` | `raw.githubusercontent.com/me/mods/dev/repo.json` |
| `gitlab.com/team/sub/proj` | `gitlab.com/team/sub/proj/-/raw/HEAD/repo.json` |
| `codeberg.org/me/mods` | `codeberg.org/me/mods/raw/branch/HEAD/repo.json` |

`HEAD`, never `main` — a repository whose default branch is called something else would 404,
and that 404 reads as "the manifest is missing". A URL that is already raw is left exactly as
it is; so is any host that is not a forge we know.

**This is not git.** No clone, no protocol, no credentials, no history: the forge is being used
as a static file host, which is what a repo already is. It therefore works with the client that
exists today and costs nothing to serve, and a PRIVATE repository is not supported — its raw
URLs need a token, and holding somebody's forge token would be the same mistake as holding
their SSH key.

## 41. History (`lib/changelog.mjs`, `ChangeEvent`)
What changed on a repo, a catalogue or a pool — with the diff, not just the verb. The per-repo
audit log that existed before had the weakness every audit log has: a free-text `detail`, so the
commonest row on the platform read "sandbox settings updated". True, useless, and unanswerable.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/repos/:id/dashboard/history` | dashboard | Newest first. `?limit=` (max 200) and `?before=<ISO>` to page. |

A row carries `action` (a closed list: `settings`, `access`, `publish`, `unpublish`, `file.add`,
`file.update`, `file.remove`, `domain`, …), a one-line `summary`, and `changes`:
`[{ field, from, to }]`.

**What a diff may never contain**, decided in one place because a diff written at nine call
sites is nine chances to leak: any field whose last path segment looks like a secret (password,
hash, token, key, share key) is dropped; an array becomes `[3]` and an object `{2}` — never
their contents, because a ban list is IP addresses and a timeline is readable by every
collaborator; and the walk stops after one level of nesting, since no denylist keeps up with a
JSON blob that grows.

**No prose in stored strings.** `summaryFor` returns the field name for a single change and
nothing at all for several, and counts are bracket notation rather than "3 items" — these
strings are stored as written and rendered as-is into a page that may be in French, so an
English sentence built on the server would travel straight past i18n.

**Not file-content versioning.** Keeping every version of every uploaded file is a different
product with a storage bill attached. A file change records its size and checksum, before and
after, which is what lets somebody find when content moved and compare it against a copy they
kept.

## 42. Included boosts (`boosts.mjs`, `lib/boostcredit.mjs`)
A hosting plan can come with N boosts every M months, each worth D days of being featured. They
are granted as ROWS in `BoostCredit`, not counted on the subscription: "you have 2" answers
nothing when somebody asks where the others went, and a counter has to be adjusted by every
writer, so it drifts the first time one of them fails halfway.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/me/boosts` | user | The ledger, how many are usable, and every repo AND catalogue one can be spent on. |
| POST | `/me/boosts/spend` | user | `{ kind: 'repo' \| 'catalog', id }`. |
| POST | `/admin/hosting/boosts/grant` | manage_hosting | Hand one out — support, an apology, a giveaway. |

Admin plan fields: `boostsPerPeriod` (0 = none, and that is the default because every plan that
existed before this column included none), `boostPeriodMonths`, `boostDays`.

**Granting** runs on the sweeper and is idempotent through a unique index
`(subscriptionId, periodStart, seq)`, not a check-then-write — two containers running the
sweeper at the same instant would both pass a check. The period is anchored to the
subscription's own start, not the calendar: somebody who bought on the 28th would otherwise
receive a second month's worth three days later. `Subscription.createdAt` was added for this;
it did not exist.

**Spending stacks.** A boost applied to something already featured extends from the current end
date, not from now — measuring from now would silently destroy the remainder for somebody who
is stacking them precisely so there is no gap. The credit is claimed with a guarded
`updateMany` (`usedAt: null` in the WHERE), so two clicks cannot spend one credit twice.

**Catalogues too.** Both the repo and the catalogue listings have always sorted by
`featuredUntil`, so a featured catalogue already surfaced; what did not exist was any way to
make one.

## 43. What counts as a repo at a URL (`lib/repokind.mjs`)
An external repo is a URL, and until now exactly one answer at that URL counted: a
current-format `repo.json`. Anything else was `valid: false`, which for a listed repo means
never verified, which means never public — so the most common way people already publish files,
a plain web server with directory listing on, could be registered, showed as online, and
silently never appeared, with nothing saying why.

Two kinds now: a MANIFEST is a repo that describes itself, a LISTING is a directory a client
walks. BMM has read the second since the beginning (it parses the index and uses each row's
size and date to skip re-hashing unchanged files); the platform simply had no word for it.

Recognition is deliberately narrow, because "valid" makes a repo verified and public — a claim
that it works. A listing needs an `Index of /…` heading or a run of links inside a `<pre>`, near
the START of the document, and at least two entries. A homepage with links is refused. The
content type is a hint and never the decision: servers send `text/html` over manifests and
`application/json` over 404 pages often enough that trusting it would misclassify both.

`checkRepoHealth(repo, fetcher = safeFetch)` takes its fetcher so this is testable — safeFetch
refuses loopback addresses, the SSRF guard doing its job, so a probe against a local test server
gets a refusal that reads as broken code.

## 44. Community Charity (`charity.mjs`)
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/charity/current` | — | This month's pot: association, percent, totals, the vote (id + open), `design`. Cached 30 s. **Switched off → 404 `charity_disabled`** (`{ error, enabled:false }`), the same answer as `/charity/contribute` and `/v1/charity` — a feature that is off is not there. |
| POST | `/charity/contribute` | optional user | Start a gift checkout `{ amountCents }` (anonymous allowed). Validation first (`too_small`…), then the switch (404 `charity_disabled`), then Stripe (503 `stripe_not_configured`). |
| GET / PUT | `/admin/charity` | `manage_donations` | The config (`enabled`, `percent` ≤ 50, `currency`, `association`, the landing `design`) + this month's pot and the revenue preview. Admin → Ko-fi & funding → Community Charity. |
| PUT | `/admin/charity/pot` · POST `/close` | `manage_donations` | Edit the month's pot (linked vote, association, status, proof) / freeze BetterCommunity's share. |

## 45. Studio components (`studio.mjs`)
The studio (`/studio/:kind/:id/:index` on the web) lets an author keep a group of canvas blocks
as a named component and drop copies on other pages. The list is personal — one JSON value per
| GET | `/charity/history` | — | The months before this one, newest first (up to 24): association, status, the two streams and their total, the number of gifts, and the proof link + date once paid. Never who gave (no user ids, no admin note). Same switch: off → 404 `charity_disabled`. Cached 60 s. |
user in the key/value settings store (`studio.components:<userId>`), no table of its own — and
is read whole when the studio opens and written whole on every change.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/me/studio/components` | user | Your saved components: `{ components: [{ id, name, w, h, blocks[], createdAt }] }`. |
| PUT | `/me/studio/components` | user | Replace the list. At most 60 components of 40 blocks each, 512 KB in all (413 `too_large`); a bad shape is 400 `invalid_input`; duplicate ids collapse to the first. Block contents are free-form canvas JSON — the renderer normalises them (`apps/web/src/lib/canvas.js`). |

*Generated from `apps/api/src/routes/` (last checked against the source 2026-09-17: the auth column was re-read route by route, and three rows that promised a stricter gate than the code enforces were corrected. §35 was the page builder and no longer exists; the numbering keeps its hole rather than renumbering forty sections around it. Coverage is NOT complete: about 22 of 71 route modules have a section, and the rest are reachable through the generated maps in §34. Earlier refresh 2026-08-13 — sections 18-33 added: every route module that previously had no section at all, plus the signed-in devices endpoints in §1; §34 added 2026-08-27 with the inspector’s format table; §§35-36 added 2026-08-29 for the page builder and the content export; §37 (webhooks) and the 2026-09-05 rows in §§5, 13, 15, 18 — commit import, the site shop + inventory, app icons, `/v1/polls/:id`, `/v1/charity`, `/v1/economy`, `/v1/badges`. Paths, methods and the Auth column were extracted from the source rather than written from memory). For request/response shapes, read the corresponding route module — each is small and commented.*
