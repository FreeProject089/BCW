# BCWEB — API Reference

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
| GET | `/catalog` | — | Browse published items (filter by project/kind/search). |
| GET | `/catalog/:slug` | — | One item's detail. |
| GET | `/catalog/:slug/download` · `/dl` | — | Pre-signed download of a published payload. |
| GET | `/catalog.json` · `/catalog/:slug/catalog.json` | — | BMM-consumable catalog feed. |
| GET | `/catalog/hosting-quote` | user | Price preview for hosting an item. |
| POST | `/catalog` | user | Submit a new item (→ moderation). |
| POST | `/catalog/:id/update` | user | Propose an update. |
| POST | `/catalog/:id/delete` · `/delete/cancel` | user | Schedule/cancel deletion (72h grace). |
| POST | `/catalog/:id/hosting/cancel` | user | Cancel an item's paid hosting. |
| POST | `/catalog/downloads` | — | Record download events. |
| GET | `/me/items` · `/me/items/:id/payload` | user | My items + payload access. |
| GET | `/mod/submissions` | mod | Moderation queue. |
| POST | `/mod/submissions/:id/approve` · `/reject` | mod | Approve/reject a submission. |
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
| GET | `/blog/mine` · `/blog/my-scopes` | user | Posts/scopes I can write. |
| GET | `/blog-admin` | admin | Admin blog overview. |
| GET/POST/DELETE | `/admin/blog-permissions[/:id]` | admin | Granular blog-permission grants. |

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
| PATCH | `/admin/repos/:id` | admin | Admin edit. |

## 7. Repo owner dashboard (`repo-dashboard.mjs`)
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/repos/:id/dashboard` · `/activity` · `/traffic` | user (owner) | Dashboard, activity log, traffic graph. |
| POST | `/repos/:id/dashboard/files` · `/files/presign` · `/files/download-zip` · DELETE `/files/:fid` | owner | File manager + bulk zip. |
| POST | `/repos/:id/dashboard/publish` · `/unpublish` · `/lock` · `/unlock` · `/ban` · `/unban` | owner | Publish/lock/ban controls. |
| PUT | `/repos/:id/dashboard/access` · `/settings` | owner | Access control + settings. |

## 8. Hosted repo content & files (`hosting-content.mjs`)
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/hosting/:owner/:repo/repo.json` · `/files/*` | — | Public served repo content (sandboxed, download-only). |
| GET/POST/DELETE | `/repos/:id/files[/:fid]` · `/files/presign` | user | Manage a repo's files. |
| POST | `/repos/:id/publish` · `/unpublish` | user | Publish state. |
| GET/POST | `/admin/repos/:id/files` (+ `/download`, `/download-all`, `/publish`, `/unpublish`) | admin | Admin file access. |

## 9. Hosting, billing & Stripe (`hosting.mjs`, `stripe-webhook.mjs`)
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/hosting/plans` · `/capacity` · `/price` · `/feature-price` | — | Plans, capacity, live price preview. |
| POST | `/hosting/checkout` | user | Stripe Checkout for a hosted repo. |
| POST | `/repos/:id/feature/checkout` | user | Checkout for a repo feature/boost. |
| POST | `/me/billing/portal` | user | Stripe Customer Portal link. |
| GET | `/me/payments` · `/me/payments/:id` | user | Payment history. |
| POST | `/hosting/webhook` | webhook | Stripe webhook (provisions on payment, signature-verified). |

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
| GET/PUT | `/admin/bot/config` · `/admin/bot/token` | admin | Bot config + token (dashboard). |
| GET | `/admin/bot/members` · `/admin/bot/welcome-preview.png` | admin | Members view + welcome image. |
| GET/POST/DELETE | `/me/discord/links` · `/me/discord/redeem` | user | Link/unlink Discord. |

## 14. Creator/Discord links (`links.mjs`) & promo codes (`promo.mjs`)
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET/POST/DELETE | `/me/creator-links[/:id]` | user | Link BMM creator ids. |
| POST | `/link/discord` · `/link/request` · `/link/lookup` · GET `/link/status` | user/— | Pairing-code flow. |
| GET/POST/PATCH/DELETE | `/admin/promo[/:id]` (+ `/:id/redemptions`) | admin | Manage promo codes + see redemptions. |
| GET/POST | `/me/promo/validate` · `/me/promo/redeem` | user | Validate/redeem a code. |

## 15. Admin: users, settings, storage, contact, stats (`misc.mjs`, `analytics.mjs`)
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/admin/users` · `/admin/users/:id` | admin | User search (id/name/email/creator id/Discord/**BC id**) + detail. |
| PUT | `/admin/users/:id/role` | superadmin | Reassign role. |
| GET | `/admin/settings` · PUT `/admin/settings/:key` | admin | Pricing/hosting knobs. |
| GET | `/admin/storage` · `/admin/billing/users` | admin | Storage consumers + paying/free users. |
| GET/POST/DELETE | `/admin/contact[/:id]` (+ `/:id/read`) | admin | Contact-message inbox. |
| POST | `/contact` | pow | Public contact form. |
| GET | `/accounts/search` · `/stats` | user/— | Account search + public stats. |
| GET/POST | `/admin/analytics` · `/analytics/pageview` | admin/— | Analytics dashboard + first-party pageview. |
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
| POST | `/server/restart` | server-control | Restart the stack. |
| GET | `/admin/security/audit` · `/admin/security/logins` | admin | Security log (actions, login attempts, IPs). |
| GET/PUT | `/admin/server-control/users` · `/admin/server-control/:userId` | superadmin | Grant/revoke the server-control permission. |

---

*250 endpoints total. Generated 2026-07-03 from `apps/api/src/routes/`. For request/response
shapes, read the corresponding route module — each is small and commented.*
