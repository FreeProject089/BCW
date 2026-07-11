# BCWEB — App Features

> A feature-by-feature tour of **BetterCommunity Web** from a product/user angle. For
> the engineering view see **Technical_Analysis_EN.md**. Not committed — living doc.

## Accounts & sign-in
- **Email + password** (argon2id) sign-up/login, password reset by token.
- **Continue with GitHub / Discord** (OAuth2) — buttons appear only when configured.
- **Two-factor authentication (TOTP)** — QR + manual key, 8 one-time recovery codes
  (downloadable `.txt`), self-service enable/disable. Required for all admin tiers.
- **Optional 2FA at sign-up** — new accounts (incl. via GitHub/Discord) are offered a
  2FA setup step; any signed-in account without 2FA sees a dismissible dashboard nudge.
- **Profile** — avatar (generated), bio, change password, hidden-by-default Personal
  info, link BMM **creator ids** and **Discord**, quick link to Settings.
- **Unique BC id** — every account has a stable `BC-XXXX-XXXX` support id.

## Browse & catalog
- **Catalog** of apps / plugins / themes / presets, filter by project / kind / search.
- **Item pages** with details, versions, downloads (multiple download options render
  as a dropdown), and a copyable `catalog.json` link (BMM-consumable feed).
- **Submit** an item or propose an update → goes to the moderation queue; presets and
  plugin packages are validated (integrity + checksums).
- **Private-by-default visibility** (like Server-Repos): an item appears in the public
  catalog + `catalog.json` feed only once an admin validates it. Before then it stays
  **private** but reachable via its own **share link** (`?k=…`) — the owner can share/test
  it, and the same link works once it's public.
- **Suspend** (admin) is harsher than reject: a suspended item is frozen and the owner
  **can't** resubmit it (reject → the owner fixes & resubmits; suspend → contact support).

## Server-Repo hosting
- **Host a repo** (paid or free-tier), owner **self-publish**, auto URL.
- **Trust tiers** — Community / Partner / Official badges (official + partner float to the
  top of the public list); filterable on the public /repos page and searchable/filterable
  in the admin list. Shown in My Repos and the per-repo dashboard.
- **Per-repo dashboard** — file manager, bulk-download as zip, traffic/usage graph,
  git-style backup/rollback, favorites (star + owner-visible count), access control
  (owner / email / password), and a per-repo element **BC id** (`BCR-…`).
- **Public feeds** — `/repos.json` aggregate index, per-repo `repo.json`.
- **Free tier** — 1 free repo + 1 free catalog item per account & per creator id
  (survives unlink/relink), with MB/GB unit display and optional caps.

## Community & content
- **Blogs** — home "Latest news" (featured first, then a cascade) + per-project blogs,
  granular blog-permission grants.
- **Projects** — rich project pages (BMM/BSM/BetterInstaller) with tabs, downloads,
  release notes, community, legal.
- **Other projects** — admins feature ANY project with the same page style, no code
  (managed from the admin dashboard); each gets `/project/<slug>` + a card.
- **Project Announcements** — pre-launch countdown teaser, topbar pin, auto-swap to the
  real page at reveal time; per-page visibility gate.
- **Scheduled updates** — stage project content to go live at a future date/time (lazy,
  no cron), cancellable.
- **Discord bot** — multi-role gated access with per-role requirements + `/refreshroles`,
  Ko-fi tip announcements, server-perf alerts, moderation, welcome, join-to-create
  voice, blog announcements. Every message is an embed.
- **Ko-fi** — a funding-goal widget pinned at the bottom of the homepage, donor-linked
  25% hosting discount.

## Admin back-office
- **Moderation queue** — search / filter (incl. by status: pending / rejected /
  suspended / published) / tag / comment; approve, reject (owner can fix & resubmit), or
  **suspend** (owner can't resubmit).
- **Users** — search by id / name / email / creator id / Discord / **Unique BC id**;
  user modal shows the BC id + each repo/item's element id, roles, links, payments.
- **Account moderation** — **suspend or ban** an account (temporary with a countdown, or
  permanent), with a reason that's shown at sign-in, emailed, and notified; the account is
  signed out within ~15s and blocked from logging back in until it lifts (permanent →
  contact support). Staff/self are protected.
- **Roles & access** (SUPERADMIN) — reassign roles; global whitelist/ban policy;
  grant the server-control permission.
- **Repos & hosting** — server repos (search + tier/status filters; expiry, payment
  status, cancellation), free hosting, promo codes (discount / free hosting / free boost),
  storage — a **grand total across all tiers** (object storage, database, backups,
  telemetry) each labelled **local or remote** so a backend on another server is clear.
- **Content** — catalogs, projects config, other projects, **reviews** (admin-curated
  landing testimonials: EN + FR text, rating, per-review + whole-section toggle),
  **events** (New Year / national holiday / custom: on-demand fireworks preview,
  configurable density + flag-drop rate, national-day badge shows the country flag),
  announcements (site-wide banner + typed notifications, body size limit, per-type icons).
- **Server** — live perf dashboard (CPU/RAM/disk/uptime totals + hover values +
  Discord alerts); Advanced server management (DB viewer with audit log, file manager,
  Docker, restart/power) behind a server-control grant + step-up 2FA.
- **Security log** — login attempts, connected IPs, admin actions; DB-viewer reads are
  logged and audit tables are tamper-protected.
- **Bot & analytics** — privacy-friendly first-party analytics with a **sessions feed**
  (per-session Boring-avatar + geo) whose timeline interleaves pageviews with **in-page
  interactions** (which button was clicked / field edited / modal opened — labels only,
  never values; consent-gated). **Settings** (pricing knobs, hosting caps, free-tier limits).

## Look & feel
- **Three.js hero orb** — builds itself from shards on intro, spirals as you scroll
  (journey scales with page length), particles orbit it, hover/click shatters &
  recomposes, optional page-transition dive (off by default).
- **Progressive scroll reveals** across the homepage (fast-scroll-safe).
- **Themes** (light/dark), **translucent surfaces** setting (cards + modals, %),
  **intro toggle**, **default language / theme**, cookie/privacy choice — all in
  **Settings**.
- **i18n** EN/FR everywhere; language switcher is a one-tap toggle at 2 languages and
  an automatic dropdown beyond that, plus a footer switcher (desktop + mobile).
- **Legal** — Privacy, Terms, Cookies, **About**, **Payments & Refunds** (EN/FR).

## Abuse & safety
- Edge anti-bot / anti-DDoS (Caddy + Fastify), proof-of-work on sign-up & contact,
  constant-time secret checks, SSRF-guarded outbound fetches, sandboxed hosted content
  (never executed; download-only; bans/whitelist/bandwidth enforced at serve time).
