# The six open items, with what is already known

Written at the end of a long session so the next one does not re-investigate. Two items from
the same batch are already done (the .bmmpa inspector crash, the duplicate hosting plans) and
one turned out not to be a code problem at all.

Ordered by how much is already settled, not by size.

---

## 1. `?next` is dropped after sign-in — half-diagnosed, do this first

**The finding.** The telemetry SSO gate redirects to `/auth?next=telemetry` (measured: the 302
carries it). `apps/web/src/pages/auth.jsx` never reads `next` — the only match in the file is an
eslint comment. The OAuth return hardcodes its destination: `oauth.mjs:196` redirects to
`${SITE_URL}/dashboard?oauth=success`.

So signing in from the gate lands you on the dashboard, and the telemetry page has to be opened
again by hand. Not a security defect — the gate works and access is correctly granted or
refused — but it reads like a broken SSO.

**Two pieces.** `/auth` honouring `next`, and the OAuth round trip carrying it through the
`state` parameter, which is already signed for CSRF.

**The constraint that decides the design:** `next` must be validated against an allowlist, never
followed as given. A free-form `next` turns the sign-in page into an open redirect — a link
like `/auth?next=https://not-your-site` that forwards the user the moment they have typed their
password. Relative paths only, and a known set of them.

---

## 2. Community catalogues ignore the filters

The filter bar applies to the official catalogue and not to "Catalogues communautaires". Check
whether both lists read the same state or whether the community one has its own fetch —
this is the shape that keeps appearing in this repo: two renderers, one rule, quietly diverged.

**Already ruled out**, so do not start here:

- `pages/dashboard.jsx:680` renders a "Community catalogs" section, but it is the STARRED list
  on the dashboard, not the browsing page.
- `pages/catalogpage.jsx` is a single public catalogue (`/c/:id`), not a list.
- `pages/catalog.jsx` is 233 lines and holds no filter state at all — only a comment about
  building a feed URL that matches what is on screen.

So the filter bar lives elsewhere: a shared component, or the repos page. Find it by searching
for the filter CONTROL, not for the word "community".

---

## 3. Newsletter: preview the mail, as the transactional e-mails already do

The e-mail admin already has a preview. The newsletter composer does not. Reuse the existing
preview component rather than writing a second one — a newsletter that renders differently in
its preview than in the inbox is worse than no preview.

---

## 4. Seed content: rework blog / docs / FAQ, and DOCUMENT the custom markdown

Two halves, and the second is the one with lasting value. BCWEB's markdown has custom
directives (`:::replay` and the GitBook-style block system in `md.jsx`) and there is no single
page explaining them. Write that page first — then rewrite the seed content using it, which
doubles as the proof that the documentation is right.

---

## 5. Polls as a full form builder — images, file upload, full page

The data model already supports more than it exposes: `PollQuestion.kind` is a string, and the
five kinds live in one table in `lib/poll-answer.mjs` (`COLUMN_FOR_KIND`). Adding a kind means
a value column that can hold it and an aggregate that means something — that is the bar the
existing five clear.

**File upload was deliberately left out** of the original design, and the reason still holds: it
needs a storage quota, virus scanning and a retention rule. It is a separate feature wearing
this one's clothes. Decide that before promising it.

The editor is currently a modal (`admin-polls.jsx`, `QuestionsEditor`). Moving it to a full page
is mostly routing; the component itself does not care.

---

## 6. BMM scheduler as a real language

The largest, and the one with a design decision at the front. `.Assets/.md/SCHEDULER_TYPES_DESIGN.md`
has the state: the typed reader, maps, enums and switch-exhaustiveness are done; `import`
(reusable step blocks) is designed and NOT built, and its blocking question is recorded there —
**the CALLER's permissions apply, never the block's**, or an import becomes a way to run actions
a task was refused.

"Use the result of one loop in another" is the concrete ask underneath. Today a loop's output
goes into a list or a map and is read by name, which already works; what is missing is
discoverability and the ability to pass a collection into a called block. That is the same
`import` work.

Docs for it go in BMM Docs and Help & Other. Note that `scheduler.ts` cannot be unit-tested —
it reaches Tauri, the DOM and localStorage at import — so anything visual there is verified by
opening it, and `check-needs-forms` / `check-editor-choices` / `check-step-kinds` cover the
mechanical half.

---

## Not a bug: the cookie warnings

`__cf_bm` is Cloudflare's, `__dcfduid` / `__sdcfduid` are Discord's CDN. They arrive with
externally-hosted images the page loads. No BCWEB code sets them and none can change their
attributes; they clear when those hosts add `Partitioned`.
