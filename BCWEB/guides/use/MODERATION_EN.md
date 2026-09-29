# The moderation engine

*How BetterCommunity decides what to do with a message, a report, a form or a link: the
surfaces, the rules, the policies, the review queue, the optional AI and its kill switch, and
what is kept about whom. 🇫🇷 [Version française](MODERATION_FR.md).*

The engine lives in `apps/api/src/lib/moderation/`. The admin screen is **Admin → Moderation →
Moderation engine** (`/admin?s=modqueue`). It is **rules first**: every decision can be
explained line by line, the site works exactly the same with the AI off, and anything that
matters goes to a person.

---

## 1. Surfaces: where content enters

| Surface | Where it comes from | What the engine can do there |
|---|---|---|
| `contact` | the Contact form (support, account, billing, other) | **hold** the message out of the inbox until a moderator releases it (the sender is told "sent" either way) |
| `legal` | Contact form legal kinds (report, copyright, data export, data erasure, appeal), the rights-notice form | nothing but open a **review** case beside it |
| `report` | a new report, and the reporter's messages in it | nothing but open a **review** case beside it |
| `bug`, `suggestion` | Contact form with that kind; the feedback centre (`POST /feedback/:key`, feedback and bug) | refuse (`422 filtered`) or hold (filed as *ignored*) |
| `crash` | the feedback centre, crash dumps | refuse or hold, like bug |
| `member_message` | contact threads to a member, a repo, a catalog, a project | refuse (`422 content_refused`) or hold (message hidden) |
| `team_message` | the same, when a team answers the inbox | refuse or hold |
| `community` | project reviews | refuse (`400 content_refused`); a review already waits for approval, so it is never "held" |
| `discord_automod` | the Discord bot asks (`POST /bot/moderation/check`) | **advise** only: the bot decides |
| `phishing` | the bot asks about links | advise only |

Staff messages in threads are never moderated. A security report sent through the contact form
is checked for spam signals, but its text is never copied into a case and it is never held.

## 2. Rules

Every rule fires a **reason** with a **weight**. The score is the sum. No rule is a verdict on
its own, except the two that are: a `javascript:` / `data:` link, and a domain on the blocklist.

| Family | Rules (default weight) |
|---|---|
| Links | script scheme (100), blocklisted domain (100: the admin list and the Terms blocklist of links refused from listings), lookalike of a protected brand (70: IDN/punycode homoglyphs, one or two letters away), brand in front of another domain (50), gift/nitro scam (45), brand inside a domain (40), mixed scripts (40), raw IP (35), sign-in/wallet path on a foreign domain naming a brand (30), punycode (20), shortener (20), more than five sites (15), risky TLD (8) |
| Lists | your keywords (matched as whole words after normalisation: case, accents, invisible characters, Cyrillic/Greek lookalike letters; optionally "loose", through leetspeak and spacing) and your patterns (checked regular expressions) |
| Shape | mass mentions (30), zalgo (25), invisible characters (20), repetition (15), capitals (10) |
| Behaviour | flood over the surface limit (40), far over it (70), same text from 3+ senders (45), same text twice from one sender (20), near-duplicate (15) |
| Trust | only when something else already fired: account less than a day / a week old (15 / 8), e-mail not confirmed (10), active sanctions (15 each, max 30), restricted account (20), no account (5); an established account (-10); staff (-50, always) |

Protected brands are built in (BetterCommunity, Discord, Steam, GitHub, PayPal, Stripe, Nexus
Mods, CurseForge, Epic, Ko-fi, Patreon, Google, Microsoft, Apple) and you can add your own with
their official domains. Short brand names are only matched exactly, so "stream" is not taken
for "steam".

**Flood** counts a signed-in author as themself and an anonymous sender by address (hashed),
in Redis when `REDIS_URL` is set so every API replica agrees, in a bounded memory map
otherwise. Colleagues behind one office IP are separate people. Duplicates are compared by a
hash of the normalised text, never the text itself, and only for texts of 30 characters or
more ("thanks, fixed it" from two people is not a campaign).

### Patterns: why some regular expressions are refused

A regular expression runs on text an attacker wrote, and one cannot be stopped once it has
started. So a pattern is refused when saved if it has a repeated group that can itself repeat
(`(a+)+`, `(a|aa)*`), more than one unbounded repeat (`.*a.*b`: use `.{0,40}`), a
backreference, matches an empty text, is longer than 200 characters, or is slow on a timed
hostile input. At run time the text is matched in chunks of 1 000 characters and the whole
pattern pass stops after 25 ms, saying so in the reasons. Keywords never become a regex.

## 3. Policies: what the engine may do

Each surface has a **mode** and four **thresholds** (default 30 / 55 / 75 / 90):

| Score reaches | Raw decision |
|---|---|
| flag | FLAG |
| review | REVIEW |
| quarantine | QUARANTINE |
| block | BLOCK |

| Mode | What happens |
|---|---|
| **Act automatically** | QUARANTINE holds the content until a moderator releases it; BLOCK refuses it where the form can say no, holds it where it cannot |
| **Flag only** | the content goes through; a FLAG case opens |
| **Manual review** | the content goes through; a REVIEW case opens |
| **Analysis only** | nothing happens; the case is only logged for the stats ("what would the rules have done?") |

**Report and legal are always manual review.** The server refuses to save them as automatic,
the AI cannot change that, and a clean report opens no case at all: the Reports and Rights
queues are already where a person reads them.

**Shipped defaults:** nothing holds or refuses anything until you choose "Act automatically"
for a surface. Everything flags, reports and legal are reviewed, crash reports are only
analysed. Watch the flagged cases for a week, then switch the surfaces you trust.

Per surface you also set: ask the AI when unsure, wait for its answer, notify staff of cases to
review (at most one notice per surface per ten minutes), and the flood limit.

## 4. The review queue

Held content first, then by score. A case shows the decision (and what the rules said before the
policy), every reason with its weight, what the AI said if it was asked, the author and how many
other cases they have, and a link to where the content lives. Actions:

| Action | Effect |
|---|---|
| Approve / Release | held content is put back (a held contact message is filed in the inbox, dated when it was sent; a hidden thread message is shown; a feedback row goes back to *new*) |
| Remove | the content leaves its audience: a thread message is hidden, feedback is filed as *ignored*, a project review is rejected, a contact message is marked read. Nothing is deleted |
| Warn the author | a *warning* sanction with a code, mailed to the author (needs **Manage users** as well), optionally removing the content |
| False positive | approve, and teach the rules: this exact text never scores again, and the domains you tick join the allowlist |
| Dismiss | nothing to do |

Every action is a line in the tamper-evident staff audit log. The queue is open to the **MOD**
role and to the `manage_moderation` capability; policies, rules and the kill switch need
`manage_moderation` (admins hold every capability).

The **Rules & test** tab has a "Test this text" box: it runs every rule on what you paste, with
the saved rules and policy, and shows what fired. Nothing is stored or counted.

## 5. The AI: an optional signal

The AI layer (`lib/moderation/ai.mjs`, set up in [AI (Laya)](../run/AI_LAYA_EN.md)) is asked
only in the **grey zone**, a score between half the flag threshold and the block threshold, and
only where all of these say yes: the surface policy ("ask the AI when unsure"), the AI layer's
own switch for that surface, and the kill switch being off.

- By default it is asked **after** the response: nobody waits for a model. With "wait for its
  answer" the request waits, under a hard timeout (200 to 5 000 ms), and a timeout is simply no
  AI.
- It can raise a case to **REVIEW at most**. It never holds, never refuses, is never the reason
  for a BLOCK, and never closes a report or a legal request.
- AI off, killed, down, slow or broken: every surface answers on the rules alone. A missing or
  broken `ai.mjs` means "no AI", never an error.

**The kill switch** (Admin → Moderation engine → AI, or the AI provider panel) stops every AI
call at once, on every replica within seconds, without touching the rules. It is the same
switch the AI layer reads (`ai.killed`); `AI_KILL_SWITCH=1` in the environment wins over it.
Anyone who configures moderation can pull it; only an admin can switch the AI back on.

## 6. Privacy: what is kept about whom

- A case keeps: the surface, the decision, the reasons, the score, who wrote it (an account
  id, or a hash of the IP address, or a Discord id), a text excerpt (up to 2 000 characters) and,
  for a held contact message, the message itself until it is released.
- A case about a **report or a legal request never copies the text**: those carry people's
  identities and are read in their own queue, with their own permissions.
- The text and any held copy of a closed case are **purged** after the retention period
  (Policies tab, default 90 days). The decision and its reasons stay: they are the record of
  how the queue was run.
- Duplicate and flood counters store hashes, never text, and expire with their window.
- Erasing an account removes its link to its cases and their text.
- Nothing leaves the server unless the AI layer is configured with an **external** provider;
  see the AI guide for what is then sent.

## 7. For developers

- `moderate(surface, { text, links, authorId, ip, meta }, opts)` returns
  `{ decision, action, score, reasons, caseId, ai }`. `action` is what the route does:
  `allow`, `hold` or `refuse`, derived from the decision and what the route said it can do
  (`canHold`, `canRefuse`).
- Wire a new surface through `lib/moderation/index.mjs`, not the engine files.
- The engine fails open: an internal error returns ALLOW with an `engine.error` reason.
- Tests: `test/moderation-rules.test.mjs` (pure rules) and `test/moderation-engine.test.mjs`
  (database and routes).
