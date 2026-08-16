# What is left of the batch — ONE item

Everything else shipped. The only open chantier is **item 6, the scheduler as a language**
(`import`: reusable step blocks). Its design is settled in
`.Assets/.md/SCHEDULER_TYPES_DESIGN.md`, including the decision that gates it — the CALLER's
permissions apply, never the block's — and it is a kind-level change, so
`check-step-kinds` will catch the two walkers that fail silently.

---

## The original header, kept for the record

Four of the six shipped after this was first written, so the entries below them are kept only
for the reasoning they record, marked DONE with their commit. Read the two open ones.

**Still open:** the seed rework (item 4, half of it) and the scheduler-as-a-language (item 6).

**Done:** `?next` after sign-in (`9fbf77a` password, `f9507f2` OAuth) · community catalogues
now obey the filters (`ea23026`) · the newsletter preview (`fda2cf0`) · the custom-markdown
reference (`04f3fde`, now at `guides/reference/CUSTOM_MARKDOWN.md`). Plus, from the same batch,
the .bmmpa inspector crash and the duplicate hosting plans, and the cookie warnings which turned
out not to be a code problem at all.

Two entries below were WRONG when first written and are corrected in place. Both said a feature
was missing when it existed — `signin.jsx` already honoured `next`, and `catalog.jsx` keeps its
filters in URL params rather than state. If a note here says something is absent, check before
building on it.

---

## 1. `?next` is dropped after sign-in — half-diagnosed, do this first

**Corrected after a second look — the first diagnosis named the wrong file.** `auth.jsx` is the
auth CONTEXT (62 lines). The sign-in page is `pages/signin.jsx`, and it already honours `next`:

```js
if (next && next.startsWith('/oauth2/')) { window.location.href = next; return; }
nav(next && next.startsWith('/') ? next : '/profile', { replace: true });
```

That `startsWith('/')` is also already the open-redirect guard — `?next=https://not-your-site`
does not survive it. So the security constraint I first wrote up as the hard part is **met**.

**The real gap is smaller and more specific.** The telemetry gate sends `?next=telemetry` — a
bare TOKEN, not a path (measured: the 302 carries exactly that). It does not start with `/`, so
it falls through to `/profile`. And it cannot simply be made a path, because the dashboard is on
a different HOST (`TELEMETRY_DOMAIN`), not a route of this SPA.

So `next` here is a symbolic destination, and the fix is a small map from known tokens to
absolute URLs — which is the allowlist, arrived at for a different reason than I first gave.
The open question is how the SPA learns `TELEMETRY_PUBLIC_URL`: check whether it is already
exposed (a VITE_ var or a config endpoint) before inventing a way.

**Second piece, unchanged:** the OAuth return hardcodes `${SITE_URL}/dashboard?oauth=success`
(`oauth.mjs:196`), so a social sign-in ignores `next` entirely. Carry it through the `state`
parameter, which is already signed for CSRF.

Not a security defect either way — the gate works and access is correctly granted or refused.
It reads like a broken SSO, which is a different and cheaper problem.

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

## 4. Seed content — DONE (`04f3fde` reference, `28ddeeb` the one block that was missing)

The rework turned out to be nine tenths already finished. `seed-docs.mjs` uses the custom blocks
127 times; `seed-faq.mjs` used none, and its answers are short and direct enough that wrapping
them would have been decoration. Exactly one answer earned a callout — the shared-game-folder
trap — and has it, in both languages, verified rendering in the browser.

Recorded because the instinct on reading this item was to rewrite everything, and the right
answer was to change one thing. Kept below for the reasoning only.

## 4-bis. The original note, for reference

The documentation half is DONE (`04f3fde` → `guides/reference/CUSTOM_MARKDOWN.md`, sixteen
directives extracted from `md.jsx` rather than remembered).

What remains is rewriting `apps/api/src/seed-*.mjs` content to actually use those blocks — which
doubles as the proof the reference is right, because writing real posts against it is what
surfaces a directive that was documented wrong.

Start from the reference, not from the existing seed text: the point is content that shows the
blocks off, not the same paragraphs with callouts sprinkled on.

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
