# Feedback & crash centre

One inbox per project for what an app sends: **feedback**, **bug reports**, **crash dumps**.
BMM posts here instead of BetaHub; any other project (BSM, a plugin, a website) can too — the
endpoint is plain JSON, no SDK.

Admin screen: **Moderation → Feedback & crashes**. Capability: `manage_reports` (MOD reads and
replies; ADMIN edits settings and deletes).

## Endpoint

```
GET  /api/feedback/<project>/config      what the client may send (public)
POST /api/feedback/<project>             submit (public; session cookie or X-Creator-ID optional)
```

`<project>` is a fixed project key (`bmm`, `bsm`) or a showcase slug. A project must be
**switched on** in the admin screen first; until then both routes answer `enabled:false` /
`404 project_disabled` and a well-behaved client shows a toast and moves on.

### Submit body

```json
{
  "kind": "bug",                       // feedback | bug | crash
  "title": "Crash when opening Themes",
  "body": "Steps…",
  "email": "me@example.com",           // optional; anonymous senders may be required to give one
  "discord": "user#0001",              // optional, informational
  "appVersion": "1.4.2",
  "os": "Windows 11",
  "meta": { "buildDate": "…", "profile": "…" },   // any JSON, 16 KB max
  "fingerprint": "sha1-of-the-stack",   // optional; same fingerprint from the same sender inside the dedupe window = +1
  "attachments": [ { "name": "crash.zip", "type": "application/zip", "data": "<base64>" } ]
}
```

Responses:

| Status | Body | Meaning |
|---|---|---|
| 200 | `{ ok, id, threadId, linked, duplicate? }` | Stored. `threadId` when a dashboard thread was opened. |
| 202 | `{ ok, sampled:false }` | Crash sampling dropped it. Do not retry. |
| 404 | `project_disabled` | Project unknown or off. |
| 403 | `kind_disabled` | This kind is off for the project. |
| 413 | `body_too_large` · `attachments_too_large` · `too_many_attachments` | Over a cap (the cap is in the body). |
| 422 | `version_too_old` · `version_blocked` · `filtered` · `contact_required` | Refused by a filter. Do not retry. |
| 429 | `rate_limited` · `project_quota` (+ `retryAfterSec`) | Come back later. |
| 503 | `storage_unavailable` | Attachments could not be stored; retry later. |

### Who gets the answer

- **Session cookie or `X-Creator-ID`** (BMM's creator id, resolved to the linked account) →
  a thread opens in the sender's **Dashboard → Messages & reports**. A staff reply there is a
  notification, a mail, and — for BMM — a line in the app's own notification centre.
- **E-mail only** → confirmation mail; staff replies go by mail.
- **Neither** → read-only; the report is still stored.

## Settings (per project)

Switch, accepted kinds, crash sampling (% kept), max text KB, max attachments (count + total
MB), dedupe window, minimum version, refused versions, refused words, anonymous-needs-e-mail,
open a thread for linked senders, mail fallback for anonymous senders.

## Rate limits (global)

Feedback endpoint: per IP, per account, per project per day. Platform-wide API ceilings (every
route): **requests / min per IP** (`hosting.apiRateLimitMax`) and **requests / min per signed-in
account** (`hosting.apiRateLimitPerAccount`, new). Both re-read every 15 s — no restart.

## Storage

Attachments live in object storage under `feedback/<project>/<id>/` and are served only
through `GET /api/admin/feedback/:id/attachments/:i` (staff). Deleting a report deletes them.

## From BMM

`frontend/assets/links.json` → `feedback_endpoint` (default
`https://bettercommunity.ch/api/feedback/bmm`). Empty string = fall back to the BetaHub client.
`feedback_web` = the page where a linked user follows their reports. BMM queues a report it
could not send (BetterCommunity down) and retries on the next start; it also throttles itself
(5 / 10 min, 20 / day) before the server does.
