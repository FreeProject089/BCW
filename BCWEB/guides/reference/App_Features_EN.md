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
- **Closing your account** — scheduled 30 days out and reversible for that whole month,
  from a link that works signed out (whoever is stopping a deletion may be on a phone they
  never signed in on). The email carries every invoice, because afterwards there is no
  account to fetch them from. What happens at the end is anonymisation, not a row delete:
  invoices and moderation records survive, everything personal is scrubbed. A one-way hash
  of the address is kept so that signing up again with it reattaches your history —
  including any moderation record. A different address starts genuinely fresh.
- **Ownership transfers** — hand a repository or catalog item to someone else by email.
  They can refuse, nothing moves until they accept, and it expires in 14 days. A hosted
  repo with a live subscription is refused, and so is a free-plan repo: the free tier is
  one per account, so handing one over would spend a free claim the recipient never made.
- **Polls** — answer at `/polls`. Changing your mind replaces your answer rather than
  being refused, and you can withdraw it entirely.

## Browse & catalog
- **Catalog** of apps / plugins / themes / presets — a clean filter bar with a project
  switcher (All / BMM / BSM), sort, search, and icon kind-pills. A **Community catalogs**
  strip under the official grid lists owner-hosted catalogs (kept visually separate from
  the trusted official items).
- **Item pages** with details, versions, downloads (multiple download options render
  as a dropdown), and a copyable `catalog.json` link (BMM-consumable feed).
- **Submit wizard** (`/submit`) — a full-page flow with two paths:
  1. **Propose to the official catalog** (free, moderated): drop a `.bmmplug`, theme /
     preset `.json`, or a whole `catalog.json` and it's **auto-parsed** to prefill the
     form; a catalog file switches to **bulk mode** (one proposal per entry). An
     "Advanced" panel still exposes the raw metadata editor. Uploads up to 100 MB; larger
     files are arranged via the contact page. PoW + undo-toast + moderation are kept.
  2. **Host your own catalog**: **raw** (upload your `catalog.json`, downloads self-hosted
     — free) or **managed** (items + files on our storage, drawn from a storage pool).
- **Community catalogs** — you host your own catalog of apps/plugins/themes. Public or
  **private** (invite-only): a private catalog is never listed and its feed + downloads are
  gated by an access list — **IP, creator id, BC id, email or Discord** (same model as
  Server-Repos), plus **bans** across the site + owner + catalog layers. Each catalog has a
  `/c/:slug` page with one-click **"Add to BMM"** deep-links per kind + a copyable feed URL.
  Admins moderate them (suspend / unlist) under the *Community catalogs* tab.
- **Private-by-default item visibility** (like Server-Repos): an item appears in the public
  catalog + `catalog.json` feed only once an admin validates it. Before then it stays
  **private** but reachable via its own **share link** (`?k=…`) — the owner can share/test
  it, and the same link works once it's public.
- **Suspend** (admin) is harsher than reject: a suspended item is frozen and the owner
  **can't** resubmit it (reject → the owner fixes & resubmits; suspend → contact support).

## Hosting (storage pools)
- **Buy storage, use it freely** — a hosting purchase provisions a **storage pool** (not a
  single fixed repo). Fill it however you like: one repo, several repos, catalogs, or a
  mix — repos and catalogs share the same pool bytes, and freeing one returns the space to
  the other. A freshly-bought empty pool shows in *My Repos* as an actionable card ("Add
  repo" / "Add catalog"). Plans (5/10/25/50 GB + custom) and a $0 free tier.
- **The plan card reads at a glance** — each paid plan lists what it gives in one column:
  the storage, the download bandwidth, the boosts it includes (with a line saying what a
  boost does), the custom domain, and where the free tier stands right now. The recommended
  plan is lifted forward rather than only tinted. Checkout and the flexible prepaid term are
  unchanged.
- **The two most expensive plans include boosts** — a boost is the existing *featured*
  credit: it puts a repo or a catalogue first in the public listing for a few days. The
  count, the period and the days are set per plan in Admin → Hosting → Plans, and the
  sweeper grants them once per period (idempotent — a unique index, not a check, so two
  sweepers running at once still grant once). Spend them from *My boosts*.
- **Billing anchors to the pool** — the subscription (prepaid term or auto-renew) is on the
  pool, so a purchase can hold repos, catalogs, or nothing yet. On lapse the whole pool
  (its repos **and** catalogs) is suspended with the usual 72h delete grace; renewing (auto
  or manual) restores everything.
- **Pool management** — pools are **collapsible** and each takes its own **colour** in the
  dashboard. **Merge** several pools into one (multi-select → merge, with a 6s undo toast;
  repos, catalogs **and** subscriptions move together); admins can **split** a merged pool
  back apart. A merged pool that carries several paid recurring subs shows a **consolidation
  savings quote** and can consolidate them into one bigger plan via Stripe (admin-tunable
  discount; only recurring subs, so a prepaid term is never forfeited).
- **Share an unlisted repo** — every repo has a public page at `/r/<id>` with an "Open in
  BMM" deeplink; an *unlisted* repo can still be shared via an owner-minted link
  `/r/<id>?k=<key>` (mirrors private catalogs' `?k=` share links).
- **Host a repo** (paid or free-tier), owner **self-publish**, auto URL.
- **Trust tiers** — Community / Partner / Official badges (official + partner float to the
  top of the public list); filterable on the public /repos page and searchable/filterable
  in the admin list. Shown in My Repos and the per-repo dashboard.
- **Suspended = fully frozen** — a suspended repo is read-only everywhere: no file add/
  delete, no publish/list, no settings/access/state change (enforced client + server).
  The dashboard stays viewable; the owner contacts support to lift it.
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
- **Listing requests** — people outside the team can ask for their project to be in the
  grid, free or paid, each door switched on separately (both off by default). Paying
  buys a place in the review queue and nothing else; approval creates the page
  unpublished and unlisted. → [OTHER_PROJECTS_GUIDE_EN.md](OTHER_PROJECTS_GUIDE_EN.md)
- **Developer tools** (`/dev/tools`) — inspect a BMM file (the same inspector moderation
  uses, on a developer endpoint) and check a `.bmmscript` before publishing it. The inspector
  reads ten BMM document types **by shape**, never by what the file claims to be — including
  a Server-Repo manifest and a plugin manifest, the two a reviewer is most likely to be
  holding. Full table → [API_Reference_EN.md](API_Reference_EN.md) §34. The
  checker verifies **shape** (unbalanced braces) and **names** against the vocabulary BMM
  publishes — deliberately not a second compiler, since BMM's only one is in Rust and a
  copy here would be wrong the day it was written.
- **Project Announcements** — pre-launch countdown teaser, topbar pin, auto-swap to the
  real page at reveal time; per-page visibility gate.
- **Scheduled updates** — stage project content to go live at a future date/time (lazy,
  no cron), cancellable.
- **Optional legal documents** — a document that ships with the app but is not true of every deployment (today the Data Processing Addendum) stays OFF until Admin → Legal publishes it. While it is off its page answers "not part of this site's terms", the API does not serve its text, it is absent from the menu and the index, the privacy policy's pointer to it disappears, and no account is asked to accept it.
- **Teams: links and slots** — an owner or admin mints invitation links that anyone signed in can open to join with the chosen role. A team holds at most **one permanent link** (never expires, copy it once, revoke and remake it whenever) plus a configurable number of **temporary** links, each with its own lifetime and a delete button showing what is left of it; the server refuses a second permanent link and any lifetime the admin does not offer. Both caps live in Hosting settings → Pricing beside the team limit (`teams.inviteMaxTemporary`, `teams.inviteLifetimeDays`). An account owns up to the admin's limit of teams, and one more is a one-off Stripe payment for a permanent slot.
- **Files that expire** — one mechanism (`/f/<token>`) for Make Your Own deliverables (30 days after delivery or 7 after the first download; the first download is the proof, written into the conversation; archives keep no attachments), mail attachments (dated links, or inline when small) and any file handed out for a while. Mail: the composer keeps the admin's own templates and the gallery lets a built-in wording be edited in place instead of rewritten; the header logo sits on a white plate.
- **Admin search** — the dashboard sidebar's box finds screens by label, synonym (FR/EN), accent-insensitive prefix or a one-letter typo, ranked from the admin guide's own text, and below them the data itself (accounts, repos, catalogues, teams, conversations, reports, sanctions, commissions, posts, docs, FAQ, polls, codes) through `/admin/search`.
- **Lookalike pictures** — every uploaded image (and the images inside uploaded archives, and linked avatars) gets a perceptual hash; one within a few bits of another account's picture, or byte-identical to it, lands in Admin → Moderation → Lookalike pictures with both pictures side by side, to clear or act on.
- **Discord bot: finding your way** — a screen opened from another screen draws **one Back
  button** that reopens the one you came from. Where you came from travels in the button's own
  custom id rather than in server-side state; it is one hop, not a browser history. `/help` browses the same explanations the **Learn more** button on each
  feature card gives, from one index (link, level, shop, inventory, casino, live tables,
  giveaway, voice, logs, config), and the text lives in the bot's dictionary like every other
  string it says, so it is translatable and overridable from the site's Languages screen.
- **Discord bot** — multi-role gated access with per-role requirements + `/refreshroles`,
  Ko-fi tip announcements, server-perf alerts, moderation, welcome, join-to-create
  voice, blog announcements. The `/casino` has **live tables** (a six-car race with the car
  picked from a dropdown — a Paddock-Manager simulation run fast: the admin picks the circuit (a built-in, a generated one per race, or one imported as JSON), the laps, the cars' colours, equal machines or a realistic grid, incidents and pit stops, under Discord bot → Economy → Casino → Race — a stake-weighted pot, and a shared roll of any single-player game)
  that other members join from the same message; with two or more seated the table settles
  **between the players** — the losers' stakes are the pot, split by stake × multiplier,
  edge on the share only — and the admin sets the **house edge per game** and a max bet where
  **0 means no cap** (all-in is then really all of it). The economy has **seasons** — points reset on a schedule (daily to yearly or every N days, UTC, XP kept or wiped, announced by the bot) or by hand — and a **statistics** card: generated / won / lost / given / spent for today vs yesterday, this week vs last, this month vs last, with a daily chart per flow. Every message is an embed. Per-server settings are edited under a
  server picker that shows which servers the bot is in, and the section navigation works on
  phones. An admin can **block a server** — the bot leaves and never rejoins, or stays but
  every command is inert there — and an `/appeal` command (which still answers in a blocked
  server) returns the block's reference plus a link to the contact page. Welcome/bye banners
  take a **custom background** uploaded on the spot, kept as a site-hosted (moderatable) image.
  **Automod** — eleven data-driven rules (spam, mass mentions, invites, links, words, caps,
  zalgo, attachments, account age, selfbot, raid). Each rule reads as two sentences: what it
  catches, with its numbers as the fields you type in ("more than 6 messages in 5 seconds"),
  and what it then does. Beyond the action (log / delete / warn / timeout / kick / ban,
  quarantine for account age) every rule carries its own **parameters** — the timeout length,
  whether the message is deleted, whether the member is told by DM, and a **watch-only** switch
  that records the rule firing without carrying anything out — plus its **own exemptions**
  (roles, channels) on top of the global list (roles, channels, members, moderators). A rule
  saved before those parameters existed keeps behaving exactly as it did.
  The **warn ladder** is editable from both dashboards: "at N warnings, do X" rows added and
  removed freely, sorted by count, each with a duration where the action takes one, and the
  decay window (how long a warning counts) beside them. Only the step whose number a member
  has just reached fires, never the ones below it and never twice.
  **Log routing**: a forum (one tagged post per category or per day) or a text channel, with
  a route per group and per category (23 categories in 8 groups). Every row states the
  **destination it resolves to right now**, in words — "goes to #mod-log", "goes to the logs
  forum, tag Server", "nowhere" — so an inherited route shows the place it ends at rather than
  the word "default", and each category has a **test button** that posts a sample entry and
  says where it went. Roles, channels and members are picked from searchable lists fed by the
  bot's heartbeat (a role's colour, a channel's `#`, forum apart from text), with the raw id
  box kept as the fallback when the bot has reported nothing.
  Both are edited from the server owner's own dashboard (Automod / Logs sections) and from the
  admin bot tab under the server picker, where a **Global defaults** bubble edits what every
  server without its own config follows; the admin's Alerts module can also name an **alerts
  forum** so every admin alert kind becomes a tagged post.
- **Community Charity** — each month a share of eligible revenue goes to a community-chosen
  association, paid manually. It is an admin **switch** (Admin → Ko-fi & funding → Community
  Charity): off, `/charity` says the programme is not running, the command palette hides the
  entry, the sitemap leaves it out and every public charity route (`/charity/current`,
  `/charity/contribute`, `/v1/charity`) answers 404 `charity_disabled`. The month's vote is picked from the poll list rather than a
  pasted id, and a gift credits the pot **net of the card-processing fee** (the exact fee read
  from Stripe); the giver is shown the fee and told donations are final before paying.
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
  grant the server-control permission. **Granular capabilities** let a MOD/USER be granted
  exactly one admin area (`manage_users` / `manage_repos` / `manage_analytics` /
  `manage_newsletter` / `manage_faq` / `manage_catalogs`) — the dashboard then shows only
  their sections and the API enforces each action; grants take effect without re-login and
  a missing permission surfaces an explicit toast.
- **Admin guide** — a searchable, bilingual reference **inside the dashboard** that explains
  every admin screen, grouped exactly like the sidebar (what it does, who sees the result, and
  the traps worth knowing). Visible to any staff member.
- **Languages & translation** — a Languages editor edits **every UI string live**: the
  built-in English and French as an override layer (clear a field to fall back to the shipped
  wording), plus any language you add — including **right-to-left** ones, which set their
  reading direction on the page. Three **translator capabilities** (`translate_site`,
  `translate_blog`, `translate_docs`) let someone translate without being handed admin, and the
  Languages tab shows for anyone holding `translate_site`. Saving applies for everyone within a
  minute (public strings are cached). This replaced the old home-page-only text editor, which is
  now the page **layout** (variant + which sections show + the suite row).
- **Inline permissions** — a SUPERADMIN sets a user's role tier and toggles their capability
  bundles straight from the user-details modal, which also folds its heavy sections (devices,
  billing, hosted content, account actions) behind one "Show more" so it opens calm.
- **Community catalogs** (cap `manage_catalogs`) — moderate owner-hosted catalogs: search,
  **suspend** (hidden from everyone), **unlist** (out of the public browser, URL still
  works), and the reverse.
- **Repos & hosting** — server repos (search + tier/status filters; expiry, payment
  status, cancellation), free hosting, promo codes (discount / free hosting / free boost),
  storage — a **grand total across all tiers** (object storage, database, backups,
  telemetry) each labelled **local or remote** so a backend on another server is clear.
- **Content** — catalogs, projects config, other projects, **reviews** (admin-curated
  landing testimonials: EN + FR text, rating, per-review + whole-section toggle),
  **events** (New Year / national holiday / custom: on-demand fireworks **preview**,
  configurable **amount + size + flag-drop rate**, calm sky-confined bursts, national-day
  badge shows the country flag and can link to a URL you choose; users can turn the
  fireworks off in Settings),
  announcements (site-wide banner + typed notifications, body size limit, per-type icons).
- **Page builder** — build a public page out of blocks, and edit the ones the site
  already ships. It opens on the page **as visitors see it**, with an edit layer over the
  top, so a change is judged against the real thing rather than a wireframe of it.
  - *Layout*: section, row, column, and a **card grid** whose cards hold other blocks —
    so a card is not a title-and-blurb pair with a third field bolted on later. Each card
    takes an image or a colour fill, an icon, a link and any content inside.
  - *Content*: heading, **text (full BCWEB custom markdown — every directive, not a
    subset)**, buttons (filled or outline, three sizes — the same two classes the
    markdown `:button` directive renders, so a page and a doc page cannot drift), image,
    spacer, **divider** (line, dashed, dots, gradient or plain space, optionally labelled), and a **stat** reading one of eleven live site
    numbers.
  - *Dynamic*: the landing sections themselves — showcase, products, news, poll, reviews,
    Make-Your-Own, dev tools — each with **styles**, because the same news is a different
    section at the top of a page and at the bottom of one.
  - `{{members}}`, `{{downloads}}` and the rest are substituted in any text. The list is an
    allowlist, not a path into the database. An unknown name renders as nothing in text and
    as — in a stat tile: never as `0`, which would be a measurement rather than an absence.
  - **Full width** folds the palette and the properties away, so the page is judged at the
    width it will really have rather than in the column left over inside a dashboard.
  - **At** renders the page at a real screen width — 1440, 1280, 1024, 768 or 390 — and
    scales the frame down to fit, showing the percentage. Scaled, not narrowed: the element
    keeps its real width, so every media query answers the way it will on that screen.
    Shrinking the element instead would have gone on answering for the window, which is the
    one thing a responsive preview must not do.
  - The **Start from** presets rebuild the real landing pages out of blocks — the same
    sections, in the same order, carrying the same wording. They are named and described
    exactly as the home-page editor names them, from one shared list, and the one the site
    currently opens with is marked **live**: a landing page is chosen by its description,
    and two screens describing the same three pages differently is one of them being wrong.
    Two checks hold this — one to the variant list the public page renders from, one to the
    names — so a preset can neither become a different page nor acquire a second name.
  - The site-wide orb is a **page setting**, not a block — it is mounted once behind
    everything, and a block that "contained" it would be a second orb in front of the first.
- **Official projects** — add and edit the projects the site is about from the dashboard.
  The built-in keys still exist; new ones are ordinary rows, so a project no longer needs a
  migration to be born.
- **Content export** (Advanced server management) — docs, blog, FAQ, legal versions, site
  settings, reviews and account records, as one JSON file per section in a zip, with the row
  count of each shown before you choose. Accounts are records only — no password hashes, no
  2FA secrets, no tokens. Catalogues and repositories are off by default because their rows
  point at files the zip does not carry. Six of the nine sections **import** as well — docs, blog, FAQ, legal versions, settings and
  reviews/polls; accounts, catalogues and repositories are export-only and marked so on the
  row. An import replaces entries with the same id and leaves alone anything the zip has never
  heard of, and what the site said beforehand is committed to a git history first — so the
  toast’s Undo and the rollback list are the same act. Still not a disaster-recovery point; see
  **[BACKUP_EN.md](../run/BACKUP_EN.md)** for which of the three "backups" answers which
  question.
- **Markdown kit download** (`/dev/markdown`) — take the renderer itself. Tick the parts you
  want — the 384 emoji shortcodes, the inline brand logos, the two blocks that need a
  component of yours (`:::roadmap`, `:::replay`) — and the zip is packed with the rest cut
  out at marked regions, file list and size shown first. A part that fails to cut cleanly
  refuses to pack rather than shipping a file with a dangling import.
  **JavaScript or TypeScript**, chosen before the download: the TS build ships the type
  declarations and a `tsconfig.json`, the JS one cuts the type section out of its README
  rather than leaving instructions for files it did not send.
- **Server** — live perf dashboard (CPU/RAM/disk/uptime totals + hover values +
  Discord alerts), and the **daily figures** (CPU, memory, disk, latency by day) that used to
  be the public status page's "System metrics" block — now admin-only, each chart compared
  with the same-length period before it (delta % per metric, up coloured as worse); the
  public `/status` no longer carries them. Advanced server management (DB viewer with audit log, file manager,
  Docker, restart/power) behind a server-control grant + step-up 2FA.
- **Security log** — login attempts, connected IPs, admin actions; DB-viewer reads are
  logged and audit tables are tamper-protected.
- **Bot & analytics** — privacy-friendly first-party analytics with a **sessions feed**
  (per-session Boring-avatar + geo) whose timeline interleaves pageviews with **in-page
  interactions** (which button was clicked / field edited / modal opened — labels only,
  never values; consent-gated). **Settings** (pricing knobs, hosting caps, free-tier limits).
- **Polls** (`manage_polls`) — ask a question, pick who may answer (members only, one
  vote each and exact; or everybody, deduplicated by a per-poll device fingerprint), and
  when the tally becomes visible (after answering by default — a running total shown
  beforehand steers the answer). Options freeze once somebody has answered: editing them
  later leaves a tally that still adds up and no longer means anything. Every result is
  reported split signed-in / anonymous, and the anonymous half is labelled an estimate,
  because two people behind one router count once and one person on two devices counts
  twice.
- **Public API** (`manage_api`) — what each key is being used for. Two datasets, kept
  apart on purpose: a per-day COUNT of calls and errors that is exact and kept, and a
  short-lived SAMPLE of individual calls for explaining an incident. The call list says so
  on its face, in the place someone would otherwise start counting rows. Revoking a key
  notifies its owner, because a key going dead unexplained is a support ticket that starts
  from the wrong theory.
- **SSO — People** — beside the client registry, who actually granted what: the person,
  the app, how many live sessions, and a button to cut it. Cutting revokes the refresh
  tokens in the same breath (a consent dropped alone leaves the app working until its
  tokens expire) and tells the person, so their next re-prompt does not read as a bug in
  that app. The two halves of "SSO" are labelled and never merged: signing in HERE with
  GitHub, versus signing in to an outside app with this account.
- **Account closure, staff side** — user details opens with the closure state, because a
  pending closure changes what every other action on that screen means. Staff can schedule
  one with a required reason; the person is emailed the reason, the date and a link to
  contact us — not a one-click undo, since a closure staff decided is not one the holder
  reverses themselves.
- **Pending payments** (Hosting & billing) — every Stripe checkout is written to a ledger
  when it opens and finished by the webhook. The tab lists the ones still open (with their
  age) and the recently finished ones; **Reconcile now** asks Stripe what happened to every
  checkout older than 15 minutes and delivers what was paid for (**Include recent** does the
  same for checkouts opened seconds ago, for when the webhook was known to be down). The same
  reconciler runs at boot and every ten minutes on its own; a payment taken and not delivered
  also lands on the Errors page and notifies super-admins.
- **Marketplace product wizard** — New / Edit product is a four-step wizard (Basics →
  Files & delivery → Pricing → Preview & publish). Each step validates on Next with the
  error under the field; visited steps are clickable, unvisited ones are not; every
  keystroke is kept in this tab's session so a mis-click outside the modal loses nothing
  (**Save draft** keeps it explicitly, and a re-open says "picked up where you left off"
  with a Discard option). Nothing reaches the API before Publish on the last step.
- **Buyer's return page** — after a marketplace payment the dashboard says "Confirming your
  payment" and polls a read-only status route until the webhook has delivered, then shows
  the key / content / link right there. The return URL itself grants nothing.

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
- **Site theme** (SUPERADMIN) — an accent gradient, per-mode page colours, a full token
  catalogue and glow-geometry editor, a composed live preview — and **export/import** of a
  whole look as a JSON file. The accent is chosen as a **fill**, and a fill only has to be
  visible, not legible, so the accent **as text** is its own token, `--accent-ink`: the same
  hue walked toward the page's own ink until it clears 4.5:1, recomputed per mode from the
  site's accent. A custom accent therefore gets a readable ink without anybody picking a
  second colour and keeping it in step.
- **Mobile bottom bar** — the phone tab bar is configurable: **icon-only / text-only / both**,
  and a custom set of up to five buttons (each an icon, an FR/EN name and a path) that replaces
  the auto-derived set.
- **Loading skeletons** — list and grid pages (repos, catalogue, blog, the dashboard) show
  placeholder cards shaped like their content while loading, instead of a centred spinner.
- **Project pages** — the Overview carries **highlights** (featured updates, videos, live
  streams and announcements — YouTube/Twitch/mp4 embed inline) and an optional **headline
  counter**, above the media frame and progress tracker; the Activity tab shows contributor
  **avatars** and a commit calendar you can **tap for a day's detail**, and timeline notes
  render as Markdown. A project's custom pages are drawn in the **studio**: blocks placed by
  hand on a 1200px board (text, image, box, video, embed, replay, **button** — plain, card or
  dropdown, with link / copy / scroll / download / API actions), a separate **phone board**
  (390px) beside the light and dark variants, per-block **animations** (fade, rise, slide,
  zoom, pulse, float, custom keyframes; on show, on load, after a delay, on hover; looped or
  not), a **Layers** panel (name, lock, hide, reorder), rotation, shadow, hover effects, a
  block-wide link, text alignment, a chosen grid step and presets to start from; **shapes** (twelve, as inline SVG with fill / gradient / stroke / label), **pasted SVG** through an allow-list sanitiser, twelve **tiling patterns**, a **page stylesheet** scoped to the page (external url(), @import and expression() refused and reported), per-block classes and inline style, the full **B.MD editor** for text blocks, copy / paste, zoom, and `.css` / `.svg` imports.
  The **home page** can be drawn too: each of its custom sections (Admin → Navigation and
  footer → Home page) carries a **Written / Drawn** switch, and a drawn one opens in the same
  studio. Switching to Drawn keeps the section's Markdown, so trying the studio and changing
  your mind does not lose the words; a section set to Drawn with nothing on the board still
  falls back to what was written.
  The studio is **a page of its own** at `/studio/<project|showcase|home>/<id>/<index>` (opened
  from "Open the studio" in the page settings; the address without an index lists that
  page's canvases): a top bar (back, document name, save state, undo / redo, the light / dark
  / phone board switch, the previews, Save), a left pane (**Blocks** palette, **Layers**,
  **Components**), the canvas, and a right pane (properties). From 1024px the three sit side
  by side; below, the canvas takes the width and the two panels are bottom sheets picked from
  a Blocks · Canvas · Properties tab row. Edits are kept as a **draft in the tab** until Save
  (which writes the whole page config through the same route the settings form uses), and
  leaving with unsaved changes asks first. **Preview** renders the canvas with the public
  renderer in a desktop, tablet (820px) or phone (390px, stacked) frame, replays the entrance
  animations on demand, and can show the **whole project page** with the draft in its tab.
  **Components**: select blocks, "Save as component" (name + thumbnail), and the Components
  tab lists them per account; insert places a linked copy, **Detach** unlinks it, **Update all
  copies** rebuilds every copy on the page from the saved definition, **Redefine from
  selection** replaces the definition. Keyboard: Del, Ctrl+Z / Ctrl+Y, Ctrl+D duplicate,
  Ctrl+A, Ctrl+C / V, Ctrl+S save, arrows nudge one grid step and Shift+arrows ten; plus
  alignment guides and snapping, marquee multi-select, z-order, lock / hide, a grid toggle and
  zoom (fit / 100% / + / -).
- **Teams & contact** — a team (one contact address, roles, invitations by BC id / e-mail /
  name, a public page at `/t/<slug>`) manages the repos, catalogues and pools its owner
  attaches; a **Contact** button on every repo, catalogue, profile and team opens a
  conversation with the owner and the team — in both dashboards, or by an e-mailed private
  link for a visitor without an account — with database-counted limits, a blocklist, and staff
  moderation (hide, close, block) under Admin → Messages. A repo served from its owner's own
  server must publish a contact e-mail.
- **Rights notices** — `/report` files a formal copyright / trademark / privacy / illegal-
  content notice with every legally required element, resolving a pasted link to a precise
  target (repo, catalogue entry, user, file); notice codes to follow up, counter-notices,
  strikes, a **protected-works registry** whose hashes / patterns / URLs flag matching uploads
  on save, and an admin **Rights** queue with takedown, reject, restore and scan.
- **Contact is a triage** — `/contact` asks two short questions instead of offering one form
  with a topic dropdown, and sends the person to the destination that fits. A copyright or
  takedown claim and a report about content or a person are handed to the flows that already
  exist (`/report` and the report modal), carrying the address already typed, so nobody is
  asked the same question twice. The rest end on a small form that asks the two or three
  things its answer needs: the pool for a hosting question, the reference for an invoice, what
  was already tried for an account problem, where it is plus a no-secrets acknowledgement for a
  security report, the account and a permanence acknowledgement for erasure. Every field is
  validated again on the server, the destination (not the browser) decides which admin queue
  the message is counted in, and the answers are written above the message so staff still read
  one thread in one place. Going back never loses what was typed, and a `?topic=` link from
  another page still skips straight to its form with its template.
- **Legal** — Privacy, Terms, Cookies, **About**, **Payments & Refunds** (EN/FR). On a
  document page the other documents are one control that names the one you are reading and
  opens the list: it cannot overflow, it cuts no label, and it works the same on a phone as on
  a desktop, however many documents an admin adds.

## Abuse & safety
- Edge anti-bot / anti-DDoS (Caddy + Fastify), proof-of-work on sign-up & contact,
  constant-time secret checks, SSRF-guarded outbound fetches, sandboxed hosted content
  (never executed; download-only; bans/whitelist/bandwidth enforced at serve time).
