# Multi-question polls — the design, before the code

You asked for polls "as complete as Google Forms". This is the schema and the migration,
written first, because the risk here is not difficulty — it is ending up with two poll systems
that both half-work.

Nothing in this document is built yet. It exists so the decisions can be argued with while
they are still cheap.

---

## What exists today

One question, fixed options, one row per tick.

```
Poll        question, description, audience, multiple, maxChoices,
            status, opensAt, closesAt, results, pinned, createdBy
PollOption  pollId, label, sort
PollVote    pollId, optionId, userId | voterKey, wasLoggedIn
```

It is a good single-question poll. Every field on it earns its place, and the vote table
already solves the two hard problems — one identity for signed-in and anonymous voters, and
`wasLoggedIn` preserved when an account closes so a published result cannot shift underneath
somebody.

What it cannot do: ask a second question, ask for anything that is not a fixed choice, require
an answer, or show a question only when an earlier one was answered a particular way.

---

## The shape

Four models instead of three. The names avoid `Form` on purpose — the thing is already called
a Poll everywhere in the UI, the API and the admin, and renaming it would touch far more than
this feature.

```
Poll          (unchanged fields kept; `question` becomes the TITLE)
PollQuestion  pollId, kind, label, help, required, sort, config Json
PollChoice    questionId, label, sort          ← replaces PollOption
PollAnswer    pollId, questionId, choiceId?, text?, number?, date?,
              userId | voterKey, wasLoggedIn, createdAt
```

### Why `PollAnswer` has four value columns rather than one Json

A single `value Json` would be shorter and would make every question type free. It also makes
every aggregate a scan: "average rating" over a Json column cannot use an index, and the stats
this feature exists for become a full read of the answer table for one number.

Four typed columns keep the common questions aggregable in SQL, and `config Json` on the
QUESTION carries the parts that genuinely vary (min/max of a scale, whether "other" is
allowed) and are never aggregated.

Exactly one value column is non-null per row. That is a check constraint, not a convention —
a row with both `text` and `number` set has no defined meaning and will be written by somebody
eventually.

### The question kinds

| kind | value column | config |
|---|---|---|
| `choice` | `choiceId` | `multiple`, `maxChoices`, `allowOther` |
| `text` | `text` | `maxLength`, `multiline` |
| `scale` | `number` | `min`, `max`, `minLabel`, `maxLabel` |
| `date` | `date` | `min`, `max` |
| `number` | `number` | `min`, `max`, `step` |

Five, not fifteen. Each one earns a value column and an aggregate that means something. File
upload is deliberately absent: it needs storage quota, virus scanning and a retention rule,
and it is a separate feature wearing this one's clothes.

### Conditional questions

`PollQuestion.showIf Json?` — `{ questionId, equals: choiceId }` and nothing more for now.

Full branching logic (and/or trees, jumps to sections) is where form builders become
unmaintainable. One condition on one earlier answer covers the case people actually ask for —
"only show this if they said yes" — and can be evaluated in the client and re-checked on the
server in a few lines. If it proves too thin, widening a Json column is easy; narrowing a
branching engine is not.

---

## What breaks, and what it costs

**Every existing poll must keep working, unchanged, for readers and voters.** Count the live
polls and their votes before starting — the migration below is written to be safe either way,
but "there is barely any data" is a claim to check, not to assume.

The migration is mechanical because the current model is a special case of the new one:

1. For each `Poll`, create one `PollQuestion` — `kind: 'choice'`, `label` = the old
   `question`, `sort: 0`, `config` = `{ multiple, maxChoices }` copied off the poll.
2. For each `PollOption`, create a `PollChoice` on that question, keeping `id` so nothing that
   references an option id breaks.
3. For each `PollVote`, create a `PollAnswer` with `choiceId` = the old `optionId`, keeping
   `userId`, `voterKey`, `wasLoggedIn` and `createdAt` verbatim.
4. Leave `Poll.question`, `PollOption` and `PollVote` IN PLACE, unread, for one release.

Step 4 is the important one. A migration that drops the old tables in the same release has no
way back if the new reader is wrong about something; keeping them costs a few megabytes and
makes the rollback a code revert instead of a restore.

The uniqueness constraints move with the data: today one vote per (poll, voter) or per
(poll, voter, option) for multi-choice. On the new shape that becomes one answer per
(question, voter) for single-choice, and per (question, voter, choice) for multiple. Both are
partial indexes, because `voterKey` is null for signed-in voters and `userId` is null for
anonymous ones — the same NULL-distinctness the current schema already relies on.

---

## What the stats do

`poll-stats.mjs` already counts people rather than ticks and refuses to call a small poll a
result. Both properties survive: `voterCount` keys on the same identity, and the lead test
applies per question rather than per poll.

The new aggregates it gains are the ones the typed columns exist for — mean and distribution
for `scale` and `number`, and a completion funnel (how many started, how many reached the
last required question), which is the number a form owner actually wants and no single-question
poll can have.

---

## Grids — built (`859fd5b`), and the design above was wrong about the migration

A grid is N rows sharing one set of columns: "rate each of these on the same scale". Each answer
says WHICH ROW and WHICH COLUMN, and `PollAnswer` had no row field.

**This section originally claimed it needed none** — reuse `number` for the row, the way ranking
reuses it for the rank, and ship without a migration. That was wrong, and the reason is the
unique key rather than the columns:

```
@@unique([questionId, userId,   choiceId])
@@unique([questionId, voterKey, choiceId])
```

A grid repeating a column across rows — "Speed: good, Docs: good" — is the NORMAL case, and to
that key it is one voter picking `good` twice. Worse than an error: the write path is
`createMany({ skipDuplicates: true })`, so it would not raise. The second row would be dropped
and the grid would come back half-answered with nothing anywhere saying why. A row index parked
in `number` is invisible to the key.

Measured rather than argued: putting the old key back and writing the normal case through it
stored **1 of 2 rows**; the new key stores 2 of 2.

So `PollAnswer.slot` — which sub-item of the question a row answers. `NOT NULL DEFAULT 0`,
because a nullable column in a unique key disables it: every NULL is distinct from every other
in Postgres, which is the same property the `userId`/`voterKey` pair relies on and the reason a
nullable discriminator would have looked right and done nothing.

| kind | choiceId | number | slot |
|---|---|---|---|
| `choice` | the answer | — | 0 |
| `ranking` | which item | its rank, from 1 | 0 |
| `grid` | which COLUMN was picked | — | which ROW, from 0 |

Rows live in `config.rows: string[]` — they are labels, not answerable things, so they need no
table of their own. Columns are the question's existing choices. `config.requireAllRows` says
whether a partial grid is allowed, defaulting to the question's own `required`.

The row index must ARRIVE as a number: `Number(null)` and `Number([])` are both 0, so a gate
that coerced before checking would file every malformed entry under row 0 and then blame the
client's honest second answer as a duplicate.

**Validate the whole submission, like ranking.** One answer per row, no row twice, no row index
past the end. A grid half-answered is the same problem as a partial ranking: averaging a column
across people who filled different rows compares numbers that do not mean the same thing — so
either require every row or record which were skipped, and say which in the config.

**The trap to avoid:** do NOT model a grid as several hidden questions. It would work, and then
the editor would show rows nobody added, deleting one would orphan answers, and the completion
funnel would count a five-row grid as five questions somebody failed to finish.

## What this is not

Not a form builder for arbitrary data collection. No file upload, no payment, no e-mail
notification per response, no export to a spreadsheet service. Each is a real feature, and
none of them is implied by "more than one question".

---

---

## Progress

**Step 1 — done** (`8ac624c`). `PollQuestion` / `PollChoice` / `PollAnswer` created, old tables
untouched, and `apps/api/src/backfill-polls.mjs` converting each poll into a one-question poll.
Drift is zero: `prisma migrate diff --exit-code` returns 0.

The backfill was verified against real rows, not an empty table — this database has no polls, so
it would otherwise have shipped untested. Seeded one poll / two options / two votes, ran dry →
commit → commit again (1/2/2, then 0/0/0 "already converted"), checked the converted rows
carried the right labels, config and `wasLoggedIn` flags, then removed the fixture.

**Answer validation — done** (`2cbbf19`). `apps/api/src/lib/poll-answer.mjs`, pure and tested
19/19, ready for the vote endpoint to call. Two rules that the obvious implementation gets
wrong: a choice id is checked for MEMBERSHIP of its question (an id from another question is a
real row), and numbers gate on TYPE before parsing (`Number([])` is 0).

**Two unrelated defects fixed on the way**, both found by diffing the schema against the live
database: `Report.reporterId` had no `ON DELETE SET NULL` despite a migration whose comment
claimed it enabled anonymising, and `ContactMessage(kind, status)` existed in the database
without being declared on the model.

**Step 2 — the API half — done.** `GET /polls/:id` serves `questions` beside everything it
already served (`d8f391b`), and a vote now writes PollVote **and** PollAnswer in one
transaction, with withdrawal clearing both (`7d206d4`). Without that mirror the new tables would
have gone stale from the first person to answer after the migration — and stale is worse than
empty, because it looks like data.

**Step 4 — statistics — done early** (`13d0629`, `0b14f98`), because it is pure and testable
today whereas the page is not. Per-question tallies, numeric summaries with the median beside
the mean, and a completion funnel counting PEOPLE. Served by the existing admin stats endpoint,
beside its current shape.

**Editing — done** (`4cd7399`, `a39eebc`). `PUT /admin/polls/:id/questions` sets the whole set
at once, refusing with 409 when it would destroy answers and naming which ones. Two destructive
cases, and the second looks harmless: removing a question, and keeping its id while changing its
KIND — the value lives in a column chosen by the kind.

**A real leak fixed on the way** (`8cd9854`). `results:'staff'` was never checked by the public
route's `canSeeResults`, whose last clause returns true for any poll that is not currently open.
A staff-only tally was private while the poll was open and public to everyone once it closed. It
surfaced only because `lib/poll-view.mjs` stated the same rule properly and the two disagreed on
exactly one pair — closed AND staff-only.

**Step 3 — the editor and the page — done.** Both exist, and two defects of the same shape came
out of building them: the code could do it and nothing reached it.

- The editor offered `ranking` from the day it shipped, and `PUT /admin/polls/:id/questions`
  restated its kinds by hand as `choice/text/scale/date/number`. Saving a ranking question
  returned a bare `invalid_input` naming no field. The enum is DERIVED from `COLUMN_FOR_KIND`
  now, so a kind that can be stored can be reached.
- `questionStats` had no branch for `ranking` or `grid`, so both fell to the date parser at the
  bottom and reported `answered: 0` — the same default-case trap `validateAnswer` hit. And the
  per-question statistics the API had served since the stats library landed were read by no
  screen at all; they render in the admin results modal now.

**What is still missing:** a question's CHOICES cannot be edited after it is created. The update
branch of `PUT /admin/polls/:id/questions` writes `kind/label/help/required/sort/config/showIf`
and never touches `choices` — only the create branch does. So a typo in an option, or a column
in a grid, is fixable today only by deleting the question and losing its answers. Pre-existing,
not introduced by grids, and made more visible by them.

### Before running the API tests, know where you are

There is no place on this machine where the suite runs as CI runs it, and both wrong places
report a number that looks real:

- **On the host**: `docker port bcweb-db-1` prints nothing — 5432 is not published — so a
  hand-made `DATABASE_URL` connects to nothing and ~31 DB-touching tests FAIL. (Without
  `DATABASE_URL` they skip instead, which at least says so.)
- **Inside `bcweb-api-1`**: the database is reachable, but the container has no `/web` and no
  `/packages`, so tests reading those files fail with ENOENT — and the running server's sweeper
  makes `rollup.test.mjs` fail for reasons unrelated to any change.

Publishing 5432 in `docker-compose.yml` would make the suite measurable from the host. That is
an infrastructure change and the owner's call.

## The order to build it

1. Schema + migration + backfill, old tables retained. Nothing reads the new tables yet.
2. The reader: the public poll page and the vote endpoint use the new shape. Old polls are
   indistinguishable because their backfill made them one-question polls.
3. The editor: add, reorder and delete questions. This is the largest piece and it is last on
   purpose — until it exists, every poll is still a valid one-question poll.
4. Stats per question, and the completion funnel.
5. A release later: stop writing the old tables, then a release after that, drop them.

Steps 1 and 2 are shippable on their own and change nothing anybody can see. That is the point
of the order.
