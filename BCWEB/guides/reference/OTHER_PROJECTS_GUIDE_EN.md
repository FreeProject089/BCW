# Other Projects — Complete Guide

*🇫🇷 [Version française](OTHER_PROJECTS_GUIDE_FR.md).*

"Other projects" lets an admin feature ANY project on the site with the same rich page style as BMM/BSM (tabs, downloads, progress tracker, release notes, community, legal) — without touching code. Each one gets a public page at `/project/<slug>` and a card on the `/projects` grid.

Everything here is managed from **Admin → Content → Other projects** (create/edit/delete) and **Admin → Content → Projects** (the shared config editor, where each Other Project appears as its own tab).

People outside the team can also *ask* to be listed, once an admin opens that door — section 9.

---

## 1. Creating a project

**Admin → Other projects → New project.**

| Field | Meaning |
|---|---|
| Project name | Full display name (also generates the URL slug, e.g. "Better Sound Maker" → `/project/better-sound-maker`). |
| Short (≤5) | The 2–5 character badge shown on cards and the topbar pill (e.g. `BSM`). |
| Tagline | One-line description under the name. |
| Sub-tabs | Overview is always on. Toggle **Release notes**, **Community**, **Legal** per project. |
| Details (JSON) | The full page config — see section 2. The **Template** button pre-fills a valid skeleton. |
| Published | Off = hidden everywhere (a draft). On = live, subject to Visibility (section 3). |
| Pin as its own topbar pill | Adds the project next to BMM/BSM in the top navigation, not just the /projects grid. |

## 2. The config JSON

All sections are optional — leave out what you don't use.

```jsonc
{
  "tagline": "One-line description",

  // Download button(s). ONE entry = a single button. SEVERAL entries = a
  // split-button: the primary opens directly, the chevron opens a dropdown
  // listing every option with its own label (installer / portable / source…).
  "downloads": [
    { "label": "Download (Windows)", "url": "https://…", "primary": true },
    { "label": "Source code",        "url": "https://github.com/…" }
  ],

  // Icon link row under the header. All optional.
  "links": {
    "github": "", "source": "", "discord": "", "kofi": "",
    "reddit": "", "website": "", "docs": "",
    "customLabel": "", "customUrl": ""      // one free-form extra link
  },

  // Overview hero media — pick ONE: image, video, or an rrweb replay.
  "overview": { "image": "", "video": "", "replayUrl": "", "rrwebUrl": "" },

  // Progress tracker: a raw URL to progress.json
  // ({ lastUpdate, art, code, categories:[{ name, items:[{ label, status, percent }] }] }).
  // Fallback: inline "progressData" with the same shape.
  "progressSource": "https://raw.githubusercontent.com/…/progress.json",

  // Release notes tab: lists every .md in a GitHub folder (sub-folders become
  // collapsible groups). Files are fetched sha-versioned, so edits show up
  // without cache tricks.
  "releaseNotes": { "owner": "you", "repo": "your-repo", "branch": "main", "path": "notes" },

  // Community tab: either a remote contributors.json (cached 5 min, flushable
  // from Projects config → "Refresh site caches"), inline contributors, or a
  // single CTA link via "url".
  "community": {
    "url": "",
    "contributorsUrl": "https://raw.githubusercontent.com/…/contributors.json",
    "contributors": [
      { "display_name": "Name", "role": "Role", "description": "", "pfp": "https://…",
        "links": { "github": "", "website": "" }, "category": "staff" }
    ],
    "messages": [ { "message": "Rotating ticker message" } ]
  },

  // Legal tab: a grid of cards. icon: shield | lock | book | file | scroll | globe | docs.
  // title/text accept a plain string OR { "en": "...", "fr": "..." }.
  "legal": [
    { "icon": "shield", "title": "License", "text": "MIT", "url": "https://…" }
  ]
}
```

## 3. Visibility

Set per project, in the edit modal (and for the fixed BMM/BSM/Installer pages under **Projects config** — Community is always public):

- **Public** — everyone sees the page; it's listed on /projects and can be pinned to the topbar.
- **Unlisted** — hidden from the topbar/projects grid, but anyone WITH the direct `/project/<slug>` link can view it. Good for soft-launches.
- **Private** — nobody can view it (admins manage it through the dashboard as usual).
- **Whitelist** — only the listed accounts can view it. Entries can be:
  - a **BC account** (searched by name/email/id),
  - a **Discord account** (must be linked to a BC account),
  - a raw **BMM creator id** (any account that has linked that creator id).

Visitors who fail the check get a neutral "Not available" page (the API returns 403).

## 4. Project announcements (countdown teaser)

For a project you want to TEASE before launch, enable **Project announcement** in the edit modal:

- **Title** — the "coming soon" headline.
- **Logo URL** — optional image above the headline.
- **Markdown description** — full markdown (GitHub alerts, badges, images…).
- **Reveal at** — date/time when the countdown ends.

While the countdown runs, **everyone** who opens `/project/<slug>` sees the teaser page (logo + live D/H/M/S countdown + markdown) instead of the real page — even if visibility is private/whitelist; that's the point of an announcement. The project still appears on /projects and (if pinned) in the topbar, labeled with the announcement title. The moment the countdown hits zero, the page automatically switches to the real project page (viewers on the page see it swap without a refresh) and normal Visibility rules take over.

Typical soft-launch recipe: visibility **Unlisted** + announcement enabled + pin to topbar → the teaser hypes everyone, and at reveal time only people you gave the link to (or switch to Public then) see the real page.

## 5. Scheduled updates

Any project page (Other Projects AND the fixed BMM/BSM/Installer/Community configs) can stage a **future content swap**:

- Other projects: the clock icon on the project's row (Admin → Other projects), or the "Schedule an update" button in Projects config.
- Fixed projects: the "Schedule an update" button in Projects config.

Pick a date/time and edit the "next" content (name/short + config JSON for Other Projects; config JSON only for fixed pages). Nothing changes until the moment passes — then the staged version replaces the live one automatically (applied lazily on the first page view after the deadline; no cron, no admin action). A pending schedule shows as an `update <date>` badge on the project row; re-opening the schedule modal lets you edit or **Cancel schedule**.

## 6. Blog integration

Each Other Project can have its own blog space:

- **Show "Blog" tab on the project page** (Projects config) — adds a Blog tab listing only this project's posts.
- **Show in home "Latest news"** — whether its posts also surface on the homepage feed (they always show on /blog).
- Post to it from the Blog admin by picking the project's "custom page" as the post's space.

## 7. Caching notes

`progressSource`, `releaseNotes` and `contributorsUrl` responses are proxied through a shared 5-minute GitHub cache. Raw-URL fetches are sha-versioned, so file edits on GitHub usually appear immediately; if something looks stale, use **Projects config → Refresh site caches**.

## 8. Quick recipes

- **Feature a finished side project**: New project → fill downloads/links/legal → Published + Public. Done.
- **Tease an unreleased project**: New project → announcement enabled with a reveal date → pin to topbar → visibility Unlisted (or Public at reveal).
- **Beta gated to testers**: visibility Whitelist → add testers by BC account/Discord/creator id → share the direct link.
- **Coordinated v2 launch**: Schedule an update with the v2 config timed to your release moment — the page flips itself while you sleep.

---

## 9. Letting people ask to be listed

Everything above is the admin creating a page. This section is the other direction: somebody
who is not staff asking for their project to be in the grid.

**Both doors are off by default**, and a fresh install offers nothing. Turn them on in
**Admin → Hosting settings → Other projects**:

| Setting | What it does |
|---|---|
| Accept listing requests (free) | Shows a *Submit your project* form on `/projects`. |
| Accept PAID listing requests | Adds a paid option beside the free one — or instead of it, if the free one is off. |
| Paid request price (cents) | `2000` = 20.00, charged once. |
| Paid request currency | Lowercase three-letter code (`usd`, `eur`, `chf`); Stripe must accept it for your account. |
| Max pending requests per person | How many un-reviewed requests one account may hold. `0` = no limit. |

With neither on, the form is not rendered *and* `POST /showcase-requests` refuses — the switch is
not decoration on a route that would have accepted anyway. A submission box on a site whose
owner is not reading submissions is worse than no box.

**Paying does not buy a listing.** A paid request goes through the same review as a free one;
the money buys a place in the queue and nothing else. That sentence is on the form itself, above
the button, because somebody about to pay deserves to know it before they click rather than
after they are rejected. If you reject a paid request, a refund is owed and no code issues it —
that is a conversation.

### Reviewing them

The queue sits at the top of **Admin → Content → Projects**, above the per-project editors,
filterable by pending / approved / rejected. Requesters need a **verified e-mail**, because a
rejection with a reason is useless if it cannot reach anybody.

Before approving you can correct the **slug** and the **short label** — the applicant's are a
proposal, and a slug is a URL that cannot be changed painlessly later.

**Approving creates the page unpublished and unlisted.** It puts nothing in front of anybody:
the page exists at its own address, stays out of the `/projects` grid, and somebody still has to
fill in the config (section 2) and decide to show it (section 3). Approval means "yes, this
belongs here", not "publish it now" — different decisions, usually on different days.

A slug that already belongs to a live project is refused at approval rather than silently
overwriting it. At submission time the clash is handled differently: the request keeps a
suffixed slug, because two people may propose the same name and both deserve an answer.

### From the applicant's side

The form is on `/projects`, and their own requests are listed with the status. They can
**withdraw** one while it is still pending. A free withdrawal deletes the request; a **paid** one
is kept and marked rejected instead — money changed hands, and deleting the only record of what
it was for helps nobody.

---
