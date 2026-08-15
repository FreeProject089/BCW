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

## What this is not

Not a form builder for arbitrary data collection. No file upload, no payment, no e-mail
notification per response, no export to a spreadsheet service. Each is a real feature, and
none of them is implied by "more than one question".

---

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
