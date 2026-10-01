# BCWEB — AI helpers, members' own keys and AI usage analytics (EN)

🇫🇷 [Version française](AI_FEATURES_FR.md)

The AI provider layer ([AI_LAYA_EN.md](AI_LAYA_EN.md)) is what BCWEB asks. This guide covers
what is **built on it**: the helpers members use while they write, the tools staff use on the
queues, the keys the writing helpers run on, the limits, and the dashboard that shows what all
of it costs. **Every member helper is off by default**, the kill switch cuts all of it, and the
site works the same with every helper gone.

---

## 1. The features

| Feature | For | What it needs | Without AI |
|---|---|---|---|
| Tag and category suggestions | members (submit page) | the classifier (Laya or the external provider) | word matching on our server |
| Language detection | members | the classifier | function-word matching on our server |
| Check before posting | members | the moderation rules, + the classifier in the grey zone | the rules alone |
| Description drafts | members | a **generative** key: the member's own (BYOK) or the site key | not offered |
| Queue triage | staff | nothing (rules score, AI signal already on the case, age) | same |
| Duplicate detection | staff (needs Reports too) | nothing (word shingles, Jaccard) | same |
| Crash causes | staff (needs Reports too) | the classifier for the 8 largest groups | keyword causes |
| Thread summaries | staff (needs Reports too) | the **site key only** (never a staff member's own key) | not offered |

Laya classifies and never writes, so the two "draft" features need an OpenAI-compatible
`/chat/completions` endpoint: a key a member brings, or the site key.

The **check before posting** is a moderation dry run: nothing is counted by the flood rules,
nothing is stored, no case is opened, and the answer is COARSE: a level (ok / maybe / likely)
and kinds of problem (a risky link, the tone, spam, formatting, watched words). It never names
the rule, the word or the list that fired, and it ignores the author's account age (that is not
the text's fault).

## 2. Who may use what

**Admin → Moderation → AI helpers → Features and limits** (capability `manage_moderation`).

- Each member helper: on/off, **who** (every member / paying members / staff only), and two
  daily allowances: free, and paid (paying members and staff). "Paying" means an active
  subscription on a plan whose price is above zero; a free plan is not a paid plan.
- Staff tools: on/off. Duplicates, crash causes and summaries also need `manage_reports`,
  because they read the report and feedback queues.
- Limits for every helper call: per person per minute, per IP per minute, whole site per day.
  They answer `429` with the scope (`user`, `ip`, `global`, `feature`) and a `Retry-After`.
  The daily allowance is read from the usage table, so it survives a restart and is shared by
  every replica; the minute limits use Redis when `REDIS_URL` is set, memory otherwise.
- The moderation surfaces keep their own per-minute limits (Moderation engine screen).

## 3. Keys

**Members' own keys (BYOK).** Off until "members may bring their own key" is ticked. A member
then adds, in **Settings → AI helpers**, the base address of an OpenAI-compatible API, the key
and optionally a model. The key is sealed (AES-256-GCM, `lib/ai-keys.mjs`) before it is stored,
never returned to any browser (the member sees the host and the last four characters), and
deleted with the account. The address follows the external provider's rules: https, public, no
credentials, no query. A daily call limit per member protects their bill.
`AI_EXTERNAL_ALLOW_PRIVATE=1` never applies to a member's key or a Discord server's key: only
the operator's provider and the site key may use a private address (anything else would let a
member aim the API at 127.0.0.1, the LAN or the cloud metadata address).

**The site key.** Admins only (a moderator with `manage_moderation` sees whether one is set,
not the form). Sealed the same way, stored in `AdminSetting ai.siteKey`, kept out of
`GET /admin/settings`, the settings door and every export. It serves:
- the staff summaries, always and only through it: a report is the platform's data, so it never
  goes out with a moderator's personal key (no site key = no summary, reason `no_site_key`);
- paying members' drafts, only if "include it in paid plans" is ticked (you pay for those).
Its own per-person and whole-site daily ceilings apply on top of the features' limits.

**Sealing secret.** `AI_KEYS_SECRET` in `.env` (see [ENV_EN.md](ENV_EN.md)); empty = derived
from `JWT_SECRET` with its own label. Changing it makes every stored key unreadable: members
and the site key must be entered again. That is the intended failure: unreadable, never read
by the wrong party.

## 4. The usage dashboard

**Admin → Moderation → AI helpers → Usage**, for today, 7, 30 or 90 days:

- calls, error rate, timeouts, p50 / p95 latency, cache hit rate, breaker openings and the
  calls it refused, queue drops, rate-limited calls, tokens and an estimated cost;
- per surface / feature (`mod:contact`, `describe`, …) and per provider (Laya, external API,
  members' own keys, site key, rules only);
- the decisions the AI raised above the rules, how often a human judged it wrong (a case the AI
  flagged, closed as a false positive or dismissed; or a member pressing "this warning is
  wrong") and right (removed or sanctioned);
- the top consumers (per account calls, tokens, cost).

**What is stored**: `AiUsageDay` (one row per day, feature and provider: counters, a latency
histogram, tokens, cost) and `AiUserUsageDay` (per account, day and feature: calls, tokens,
cost). No text, no excerpt, no hash of a text, no URL, no key: the recorder takes named numbers
and short names and drops everything else. Counts are buffered in memory and written every
15 seconds, so a call never waits on a statistics write (a crash loses at most 15 seconds of
counts). The per-account rows are pruned after `retentionDays` (default 90, 7 to 730) by the
sweeper and deleted with the account; the daily aggregates name nobody and are kept.

**Cost** is an estimate: tokens × the per-million prices you typed for the site key and the
external provider. Members' own keys and Laya count as zero. Your provider's invoice is the
truth.

## 5. Where the text goes

Every helper button says it before it is pressed:

| Source | Where the text goes |
|---|---|
| Laya | the `laya` container on your server; nothing leaves |
| External provider | the provider in `AI_EXTERNAL_URL`, a third party |
| Member's own key | the provider the member chose, under their agreement with it |
| Site key | the provider of the site key, your processor |
| Local / rules | nowhere: word matching and the moderation rules, on the API |

**Capacity.** Moderation and the helpers (smart search, BMM suggestions, the `feat:*`
helpers) do not share a queue or a budget. The helpers get at most one slot less than the
concurrency setting (moderation keeps one when there are two or more), a quarter of the queue
and half of the per-minute budget; a waiting moderation call goes first and drops the queued
helpers. A burst of anonymous searches answers `busy` or `rate_limited` to the searches, never
to moderation.

A summary sends the thread's messages with their roles (reporter, staff, system), never names
or e-mail addresses. A draft sends the item's type, name and the member's notes. Before you
switch on the site key for either, name its provider in the privacy policy's processor list
(the policy already describes the helpers, BYOK and the statistics).

## 6. When something looks wrong

| Symptom | Likely cause |
|---|---|
| A member sees no helper at all | none is switched on, or every one is limited to a plan they do not have |
| "Add your own AI key" on the draft button | BYOK is on but they have no key, and the site key is not included in their plan |
| "Your saved key can no longer be read" | `AI_KEYS_SECRET` (or `JWT_SECRET` when it is empty) changed: the key must be entered again |
| "The provider refused the key" | the provider answered 401/403 |
| 429 `quota_reached` | the member used the feature's daily allowance; it resets at midnight UTC |
| Tags or language say "worked out by word matching" | the classifier is off, killed, or its provider is not configured |
| The dashboard stays at zero | no call yet, or counts still in the 15-second buffer (the dashboard flushes it first) |

## 7. What was verified, and what was not

Verified (2026-09-29): the recorder and the report arithmetic (percentiles from the histogram,
rates, filled series, top users, pricing), the pipeline counting every outcome (ok, cache hit,
killed, disabled, breaker opened once and the refused calls apart), the key sealing (owner
check, rotated secret, tampered envelope), the URL rules, the no-AI fallbacks, the coarse check,
and every door on a throwaway database against fake providers on 127.0.0.1: a key goes in and
never comes out, paid-only gating, per-minute, per-IP and daily limits, a draft sent with the
member's key and counted without its text, the site key admin-only and never read back, the
staff tools refusing a member, triage order, OS mode's site-wide switch.

**Not verified**: no real external AI provider was called (by design), and the helpers were
checked in the browser only as far as the build, lint and i18n gates go.
