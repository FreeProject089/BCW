# The Good Little User — using BetterCommunity

*A friendly, feature-by-feature guide to BetterCommunity (BCWEB) for everyday members.
For moderators see [MODERATOR_GUIDE_EN.md](MODERATOR_GUIDE_EN.md); for people hosting
their own repos/catalogs see [HOST_GUIDE_EN.md](HOST_GUIDE_EN.md). 🇫🇷 [Version française](USER_GUIDE_FR.md).*

---

## 1. Your account

- **Sign up / sign in** at `/auth`. You can use email + password, or **GitHub / Discord**
  one-click sign-in (your avatar comes across automatically).
- **Two-factor auth (2FA)** is optional but recommended — enable it from your dashboard.
  There's also a standalone local authenticator at `/2fa` (fully offline).
- Your **BC id** (`BC-XXXX-XXXX`) is your stable public identifier. It's shown on your
  profile and repos/catalogs; click it anywhere to copy it.
- **Public profile** lives at `/u/<your-id>`. You control what's shown in
  **Dashboard → Profile → Connections to show** — pick which linked accounts (GitHub,
  Discord, BMM creator id, website, Ko-fi…) appear, and whether the profile is public.

**Do:** enable 2FA, and only expose the connections you're comfortable sharing.
**Don't:** reuse a weak password — a stolen session can be logged out globally, but a weak
password is the first domino.

## 2. Connections & Ko-fi

- Link **GitHub / Discord / YouTube / Twitch / Steam / Ko-fi** from your profile. Linked
  brands appear as compact click-to-copy chips on your public profile (icon + handle).
- **Ko-fi**: paste your handle (bare `name`, `@name`, or a full `ko-fi.com/...` URL — it's
  normalised). It becomes a tip link; a Ko-fi **donor badge** can be granted automatically.

## 3. Browsing content

BetterCommunity aggregates two kinds of downloadable content, both consumable by the
BetterModsManager (BMM) app:

- **Community catalogs** (`/catalog`, individual pages at `/c/<slug>`) — collections of
  plugins / themes / apps / presets. Each page has **"Add to BMM"** deeplinks
  (`bmm://catalog/...`) and a copyable feed URL.
- **Server repos** (`/repos`, individual pages at `/r/<id>`) — hosted or URL-based mod
  sources. Each has an **"Open in BMM"** deeplink and a `repo.json` link.

### Downloading from a repo without BMM

A hosted repo's page lists its **contents** (mods, profiles, …) and every file downloads in
one click, straight from the browser — you don't need BMM installed to grab a single file.
(BMM is still the better route for actually *using* a repo: it syncs and updates it for you.)

Whether you can download depends only on how the owner configured the repo:

| The repo is… | What you get |
|---|---|
| **Open** (no restrictions) | the contents and every download, signed in or not |
| **Restricted** (whitelist, or bans in play) | **sign in first** — we then match your BCWEB account (and its linked Discord) against the owner's list. The contents stay hidden until you're allowed, so a private repo's file list isn't public. |
| You're **banned** from it | nothing — the page reports no access |

If a restricted repo still refuses you after signing in, your account simply isn't on the
owner's list: ask them for access. Linking your Discord (§2) helps — owners often
allow-list Discord accounts rather than BCWEB ids.

**Trust tiers** you'll see on the listing: **Official** (green, BMM team), **Partner**
(blue, trusted members), and **Community** (unverified — add at your discretion).

**Do:** prefer Official/Partner sources when unsure. **Don't:** blindly trust a Community
source you can't identify — check the owner's profile and BC id first.

## 4. Favorites, reviews & profiles

- **Star** a repo to favourite it (purely social; grants no access). Filter the list to
  your favourites.
- Browse other members at `/users` (search by name, BC id, repo id, or catalog id) and
  visit their `/u/:id` profile to see their public repos/catalogs and badges.
- **Badges** are earned (e.g. early sign-up, Ko-fi donor) and shown on your profile.

## 5. Blog, docs & FAQ

- **Blog** (`/blog`) — news and posts, with reactions and co-authors. New posts can be
  announced by email if you're subscribed to the **newsletter** (double opt-in).
- **Docs** (`/docs`) — categorised guides with a GitBook-style layout.
- **FAQ** (`/faq`) — quick answers. If a page is missing, enjoy the little **"Orb Fall"**
  game on the 404 page (there's a leaderboard 😉).

## 6. Reporting problems

- Most content (repos, catalogs, profiles, posts) has a **Report** button. Use it for
  broken, malicious, or rule-breaking content. A report can open a small thread so a
  moderator can ask you follow-up questions.

**Do:** report with a clear reason. **Don't:** use reports to harass — abuse of the report
system is itself moderatable.

## 7. Settings & appearance

- **Settings** (`/settings`) — theme, language (EN/FR everywhere), and **Translucent
  surfaces** (frosted-glass cards, with an opacity slider).
- The **topbar** is configurable by admins; what you see (projects, notifications, etc.)
  can vary per site.

## 8. Privacy in a nutshell

- Only an **essential** session cookie is required. **Analytics is opt-in** — you choose at
  the cookie banner, and can Reject non-essential with one click.
- Analytics is **anonymous and first-party** (no ads, no cross-site tracking).

---

### Quick do / don't recap

| ✅ Do | ❌ Don't |
|---|---|
| Enable 2FA | Reuse a weak password |
| Prefer Official/Partner sources | Blindly trust unidentified Community sources |
| Report bad content with a reason | Weaponise reports |
| Share only the connections you want public | Expose a private handle you'll regret |
