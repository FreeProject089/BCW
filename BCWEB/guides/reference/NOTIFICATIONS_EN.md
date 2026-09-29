# Notifications, RSS feeds and the BMM launch card

🇫🇷 [Version française](NOTIFICATIONS_FR.md)

Three things that share one engine:

1. **Notifications**: what lands in a member's bell, their notification centre, the BMM app
   and their personal RSS feed.
2. **RSS / Atom feeds**: a private feed per member, and a public news feed.
3. **The BMM launch card**: what BetterModsManager shows in its start-up window.

Code: `apps/api/src/lib/notify.mjs` (the engine), `apps/api/src/routes/notify.mjs` (feeds,
follows, admin composer), `apps/api/src/lib/bmm-launch.mjs` and
`apps/api/src/routes/bmm-launch.mjs` (the launch card). Tests:
`apps/api/test/notify.test.mjs`, `notify-feeds.test.mjs`, `bmm-launch.test.mjs`.

---

## 1. Sending a notification (for developers)

```js
import { notify } from '../lib/notify.mjs';

await notify({
  audience: 'role:STAFF',            // or userIds: ['…'], see below
  kind: 'moderation.case',           // decides the mute category
  title: 'A case needs review',
  body: 'contact · score 7',         // optional
  titleFr: 'Un cas attend', bodyFr: '…', // optional
  url: '/admin?s=modqueue&case=…',   // an in-app path (or an absolute URL on this site)
  dedupeKey: 'moderation.case:contact:123', // optional, makes the call idempotent
  priority: 1,                       // 0 normal, 1 high, 2 urgent ('normal' | 'high' | 'urgent' also accepted)
  expiresAt: new Date(Date.now() + 7 * 86400e3), // optional
});
// → { ok: true, sendId, deduped, targeted, delivered, muted }  or  { ok: false, error }
```

It **never throws**: a notification is a side effect, and a failed side effect must not fail
the request that caused it. Read `ok`.

### Who it reaches

| Target | Reaches |
|---|---|
| `userIds: [...]` | those accounts (duplicates collapsed, closed accounts skipped) |
| `audience: 'all'` | every open account |
| `audience: 'role:MOD'` | one role: `USER`, `MOD`, `ADMIN`, `SUPERADMIN`, or `STAFF` for the three staff tiers |
| `audience: 'cap:manage_reports'` | whoever holds a capability (admins, direct grants, custom roles, a MOD's defaults) |
| `audience: 'project:bmm:followers'` | the members following a project (the key, `sc:<slug>`, or a bare showcase slug) |

### Idempotence

With a `dedupeKey`, a second call does nothing and answers `deduped: true`. Two calls at the
same moment deliver once. A send interrupted half-way (the process died) is **resumed** by the
next call with the same key, and nobody receives it twice: every row records its send, and
(send, recipient) is unique.

### Fan-out

One row per recipient, written in chunks of 1000. A broadcast row plus a per-user read state
would have needed every reader rewritten (the bell, the centre, the public API that BMM
reads, the OAuth endpoint); per-user rows keep them all unchanged and make mutes, read state and
deletion per person. Each call also writes one `NotificationSend` row: the admin history, the
idempotence key, and the source of the public feed.

### Mutes

A member switches categories off in *Notifications → What you hear about*. The kind decides
the category (`NOTIF_CATEGORIES` in `lib/lib.mjs`). Muting is applied **at write**: a muted
member gets no row at all. New categories: **Projects you follow** (`project_…` kinds) and
**Moderation queue** (`moderation.…`, listed for staff only). **Account & security** cannot be
muted; an unknown kind falls into it, so it is delivered rather than dropped.

### Expiry

`expiresAt` hides the row from every reader from that moment, and the sweeper deletes it
within ten minutes. Send records older than a year go too, except those in the public feed.

---

## 2. Following a project

A **Follow** button sits on every project page. Following means one thing: a new post in
that project's blog reaches you as a notification (kind `project_post`), once per post, on its
first publication, only while the project is public. Staff can switch this off site-wide in
*Admin → Writing & notices → Send a notification*. A member sees and removes what they follow
in */notifications*.

---

## 3. The admin composer

*Admin → Writing & notices → Send a notification* (capability `manage_announcements`).

- **To**: named accounts (search), a role, everyone, or a project's followers.
- **Kind**: *News* (the member can mute it) or, for named accounts only, *Account notice*
  (always delivered).
- **Preview** counts who is reached after mutes and shows the exact text in each language.
- **Same content guard**: the same text to the same audience within 24 hours is refused
  until the admin confirms.
- **Double click safe**: the form carries a request id; a retried send is the same send.
- **Rate limit**: 10 sends per 10 minutes per admin.
- **Audit**: every send is written to the tamper-evident audit log (`notify.sent`).
- **Public feed**: a message to everyone can also be listed in `/feeds/news.xml`.

---

## 4. RSS and Atom feeds

| Feed | URL | Who |
|---|---|---|
| Public news | `/feeds/news.xml`, `/feeds/news.atom` (`?lang=fr` for French) | anybody |
| Personal | `/feeds/u/<id>.<secret>.xml` or `.atom` | whoever holds the URL |

The personal feed lists the member's last 50 live notifications, in the language of their
account (`?lang=` overrides). It is created, replaced and turned off in */notifications*.

**The personal URL is a credential.** So:

- only the SHA-256 of the secret is stored, compared in constant time;
- it is shown **once**, when created. Lost it: replace it (the old URL dies at once);
- a wrong secret, an unknown id, a closed or banned account all answer the same `404`;
- the path is redacted in the API's log lines and error records (`errorlog.mjs`), because the
  secret is in the path, not the query string;
- responses carry `Cache-Control: private` and `Referrer-Policy: no-referrer`.

Both feeds send an `ETag` and answer `If-None-Match` with `304`. Every text is XML-escaped and
characters XML forbids are removed.

**Routing**: Caddy sends `/feeds/*` to the API unprefixed (`infra/caddy/Caddyfile`); the Vite
dev server does the same. The API also answers them under `/api/feeds/…`.

---

## 5. The BMM launch card

*Admin → Writing & notices → BMM launch card* (capability `manage_announcements`).

BMM asks, at start-up:

```
GET /api/bmm/launch?version=<bmm semver>&lang=<fr|en>
```

```json
{ "v": 1, "generatedAt": "ISO", "items": [
  { "id": "…", "rev": 3, "kind": "blog",
    "title": "…", "summary": "… (plain text, at most 400 characters)",
    "url": "https://…", "imageUrl": "https://… or null", "publishedAt": "ISO",
    "display": { "mode": "always | once | times", "times": 3,
                 "from": "ISO or null", "until": "ISO or null",
                 "minVersion": "semver or null", "maxVersion": "semver or null" },
    "priority": 0 } ] }
```

Each card is one of: **the newest post of a blog** (BMM's by default), **a chosen post**, or a
**custom card** (title, summary, https link, picture, both languages). Settings per card: shown
*once*, *a number of times* or *at every launch*; from/until dates; minimum/maximum BMM
version; priority; on/off. A global switch turns the whole thing off ("none").

- Only **active** cards are served: switched on, inside their dates, matching the version
  when BMM sends one (the bounds also travel in the card, so the app can check them itself).
- **`rev`** moves when what a card *says* changes (a new latest post, an edited title or
  picture). The app counts displays per id and rev, so a new rev shows the card again.
  Changing only how often or when it shows does not move it.
- **Links**: only absolute `https://` URLs leave, parsed rather than prefix-matched
  (`javascript:`, `data:`, plain `http:` and URLs with credentials are refused when saving
  and filtered again when serving). The single exception: on a development install whose own
  site address is `http://localhost`, its blog links are http.
- **Caching**: the resolved cards are cached for a minute (invalidated on every admin save);
  the response has `Cache-Control: public, max-age=60` and an `ETag` computed over the items.
- The admin screen previews each card the way the app draws it, in English and French.

---

## Personal data

Following a project (which account follows which project, since when) and the personal feed
token (a hash, its creation date, when a reader last used it) are new records. Both are
erased with the account and are described in the Privacy Policy (*Notifications, follows and
your RSS feed*).
