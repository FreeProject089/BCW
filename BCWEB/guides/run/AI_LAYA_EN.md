# BCWEB — Optional AI for moderation (Laya) (EN)

🇫🇷 [Version française](AI_LAYA_FR.md)

BCWEB can ask a classifier for a second opinion on what people send it: a contact message, a
comment, a crash report, a Discord message. **It is off by default, and everything works
without it**: the rules engine decides on its own, and AI only ever adds a signal to it.

This guide covers what the AI is and is not, what it costs the server, how to turn it on and
off (including the kill switch), what text leaves the API, and what was and was not verified.

---

## 1. What it is, and what it is not

The default provider is **Laya** (`convaiinnovations/laya-multilingual`, Apache-2.0): a
322-million-parameter classifier (mmBERT-base) that reads a text in 100+ languages and answers
fixed questions about it:

- **yes / no with a probability**: "is this spam?", "is this phishing?", "is this insulting?",
  "is this written to provoke?", "is this off topic?", "does this threaten legal action?";
- **one choice among a list**: "which crash category?", "which of these tags?".

It **never writes text**. It cannot draft a reply or a description; it can only score and pick.

**Its accuracy is modest.** The model card itself reports that it is over-confident (mean
confidence 0.75 to 0.83 for a much lower accuracy), weaker on English than the English-only
checkpoint, and poor on low-resource languages. So in BCWEB:

- an AI score can **raise a case** to flag or review; it is **never the sole reason for a
  block**, a ban, or any final decision;
- **reports and legal notices always end with a human** (the AI never closes one);
- on Discord, an AI verdict can at most **delete a message or warn**, never time out, kick or ban.

## 2. The three providers

| Provider | What happens | Who sees the text |
|---|---|---|
| **Rules only** (`off`, the default) | No AI call at all. | Nobody new. |
| **Laya, on this server** (`laya`) | The API calls a sidecar container (`laya`) over the internal Docker network. | Only your server. |
| **External AI API** (`external`) | The API calls an OpenAI-compatible endpoint: `/moderations` (measures toxic and self-harm only) or `/chat/completions` in "chat" mode (every label). | **A third party.** See section 8. |

The model is **never** loaded inside the API process: a 322M model would take the API's
memory and CPU with it. The API only makes HTTP calls, with the guards of section 4.

## 3. Where it is asked

Each place has its own switch in **Admin → Moderation → AI provider**, all off until ticked,
and they only count while the global switch is on:

| Place | Questions asked (one request per item) |
|---|---|
| Contact form | spam, phishing, toxic, troll, legal threat |
| Reports | spam, toxic, legal threat, self-harm (always ends in human review) |
| Legal and rights notices | spam, legal threat (always human review) |
| Crash reports | spam, off topic, + crash category |
| Bug reports, suggestions | spam, toxic (, troll), off topic, + category |
| Member and team messages | spam, phishing, toxic (, troll) |
| Comments, reviews, showcase | spam, phishing, toxic, troll, off topic |
| Discord automod | phishing, spam, troll, toxic (paid servers only, section 6) |
| Phishing links anywhere | phishing, spam |

The moderation engine (`apps/api/src/lib/moderation/`) decides when to ask: rules first, AI only
in the grey zone, and after the response unless a place's policy says otherwise.

**The BMM helper** (`POST /api/ai/bmm/suggest`, off unless "BMM helper" is ticked) lets a
signed-in member (session, or an API key with the `ai:suggest` scope) ask for a tag, a
category, the language, an adult-content check or a crash cause for a text of at most 4000
characters. Answer: `{ ok: true, provider, result: { choice, probs, p } }`, or
`{ ok: false, reason }` with `disabled`, `busy`, `unavailable` or `rate_limited`.

**Which key BMM uses.** BMM calls it with the API key it already stores: the one this site
mints when an account is linked in BMM (or from "get a notifications key"). Keys minted from
now on carry `notifications:read` **and** `ai:suggest`. A key issued before keeps exactly the
scopes it had, and is refused with `403 insufficient_scope`: its owner gets the new scope by
asking for a new key, never by having an old one widened. A key call is not held to the
"confirm your email" rule, and it is rate-limited like a session call (30 a minute, then the
layer's own per-user budget).

**Who configures it.** The AI provider panel and every `/api/admin/ai/*` door ask for the
**Configure moderation** capability (`manage_moderation`), the same as the moderation engine it
belongs to. Pulling the kill switch is open to that capability; switching the AI back on is an
admin's call.

## 4. What it costs, and why it cannot eat the server

**Resources of the Laya sidecar** (from the Hugging Face listing, 2026-09-29):

| | Size |
|---|---|
| Model on disk (`laya-models` volume) | about **0.7 GB** (644 MB of weights + 34 MB tokenizer) |
| Image (Python slim, CPU-only torch) | about 1 to 1.5 GB |
| RAM once loaded | about 1.5 GB; the container is capped at **2 GB** |
| CPU | capped at **1.5 CPU**, 2 torch threads |
| Latency | 33 ms per question on a T4 GPU; on CPU, budget 150 to 400 ms per item |

**Guards in the API** (`apps/api/src/lib/moderation/ai.mjs`), all adjustable from the admin
screen within hard bounds, several also from the environment:

- **Timeout** per call (default 1.5 s): past it, the answer is "no AI", never a wait.
- **Concurrency** (default 1 call at a time) and a **bounded queue** (default 16 waiting); a
  caller that cannot get in gets "busy" at once.
- **Input cap**: the text is reduced to plain text (tags removed, control characters removed,
  link URLs kept visible) and cut to 2000 characters before it leaves.
- **Circuit breaker**: after 5 consecutive failures, AI pauses for 60 s, then one probe decides.
- **Rate limits** per person and for the whole site, per minute (shared through Redis when
  `REDIS_URL` is set, in memory otherwise).
- **Cache**: the same text asked the same questions within 2 minutes is answered from memory.
- **Metrics**: queue, calls in flight, p50/p95 latency, counters, last error, on the admin screen.

Whatever happens (off, killed, down, busy, slow, garbage), the AI layer answers "nothing" and
the rules decide alone. It never throws an error into a request.

## 5. Turning it on, turning it off

### Laya on this server

1. In `infra/compose/.env`:
   ```
   COMPOSE_PROFILES=ai              # with PgBouncer too: COMPOSE_PROFILES=pgbouncer,ai
   LAYA_API_KEY=<openssl rand -hex 32>
   ```
   Put the profile in `.env`, not on the command line: `infra/deploy.sh` runs a plain
   `docker compose up -d`, which reads `.env` and would otherwise stop the sidecar.
   **The key is mandatory.** Without it (or with the `.env.example` placeholder, or shorter
   than 16 characters) the image's entrypoint (`infra/laya/entrypoint.py`) refuses to start:
   `laya-fetch` exits with code 64 and a line in `docker compose logs laya-fetch` saying why,
   and `laya`, which waits for it, never starts. The API then shows Laya as **"Not
   configured"** and never calls it. Compose itself does not refuse (`${LAYA_API_KEY:?}`
   would make every `docker compose` command fail on a server that never enabled the `ai`
   profile: Compose resolves variables for all services before it applies profiles), so the
   check lives in the image.
2. Build and start: `docker compose --profile ai build laya` then `docker compose up -d`.
   The first start runs `laya-fetch` once, which downloads the checkpoint (~0.7 GB) into the
   `laya-models` volume; then `laya` serves it **offline** on the internal `ai` network (no
   published port, no route to the internet). `LAYA_REVISION=reviewed` pins the checkpoint to
   the commit laya 0.3.21 reviewed.
3. In **Admin → Moderation → AI provider**: pick "Laya", switch AI on, tick the places, and
   use the **Try it** box to see a real answer and its latency.

### An external API

Set `AI_EXTERNAL_URL` (the base, for example `https://api.example.com/v1`) and
`AI_EXTERNAL_KEY` in `.env`, restart the API, then pick "External AI API" on the admin screen.
The URL must be **https and public**: http, private or loopback addresses, internal names,
credentials in the URL and query strings are refused, and every DNS answer is checked again at
call time. Only for a model you host on your own network, `AI_EXTERNAL_ALLOW_PRIVATE=1` lifts
the address rules. The URL and the key are read from the environment only: never stored in
the database, never logged, never shown on the admin screen (it says "configured" or "refused").

### Turning it off: four levels

| From the lightest to the hardest | Effect |
|---|---|
| Untick a place | That place goes back to rules only. |
| Global switch off, or provider "Rules only" | No AI anywhere; the sidecar keeps running idle. |
| **Kill switch** (admin screen, "Cut AI now") | Every AI call is cut at once (this API process immediately, every other replica within 3 s). The rules keep running. Stays cut until an admin releases it. |
| **`AI_KILL_SWITCH=1`** in `.env` + restart the API | Same, but **an admin cannot release it** from the site: only the operator can. |

To reclaim the sidecar's memory and CPU as well: `docker compose --profile ai stop laya`, and
remove `ai` from `COMPOSE_PROFILES` so the next deploy does not start it again.

## 6. Discord: the AI-assisted automod (a paid option)

Server owners find it in their dashboard, **Automod → AI-assisted check**. It is the plan
feature **`aiAutomod`**, which is **paid by default**: a server without a plan that includes it
cannot switch it on (the API refuses the save with "needs a Discord bot plan"), and the bot is
served it switched off. An admin can make it free by ticking it in the bot free tier (Admin →
Hosting plans), or sell it in a bot plan.

How a message goes through it:

1. **Fixed checks first**, inside the bot, free and instant: a link that imitates Discord,
   Steam, PayPal, GitHub and other login pages (d1scord, st3am, dlscord, steamcommunlty…), a
   punycode or raw-IP address, a login hidden in the link, a "free Nitro" lure on a link
   shortener. When they are sure, they act alone with the action the owner picked.
2. **Only a message no rule caught** is sent to the site's API (`POST /bot/ai/automod`), which
   checks the plan **again** (the bot is not trusted with that), applies a per-server budget,
   and asks the AI. The bot waits at most 2.5 s; on any failure, nothing happens.
3. The AI verdict costs at most **delete** or **warn**.

## 7. Configuration reference

On the admin screen (stored in the `ai.config` and `ai.killed` settings; both also go through
the generic settings door and the config import with the same validation):
provider, global switch, per-place switches, BMM helper, flag and review thresholds (for the
moderation engine), timeout, concurrency, queue, queue wait, characters sent, breaker, rate
limits, cache duration, external mode and model name.

In `.env` (a value set here **wins** over the admin screen, which greys the field):

| Variable | Purpose |
|---|---|
| `COMPOSE_PROFILES` | add `ai` to start the sidecar (`laya-fetch` then `laya`). |
| `LAYA_API_KEY` | bearer key shared by the API and the sidecar. **Mandatory with the `ai` profile**: without it the sidecar refuses to start and the API reports Laya "Not configured" (it is never called). |
| `LAYA_URL` | the sidecar's address, default `http://laya:8000`. |
| `LAYA_REVISION` | checkpoint pin: `reviewed` (default) or a commit SHA. |
| `LAYA_CPUS` / `LAYA_MEM_LIMIT` / `LAYA_THREADS` | the sidecar's ceiling (default 1.5 CPU, 2g, 2 threads). |
| `AI_KILL_SWITCH` | `1` = AI cut, and an admin cannot release it. |
| `AI_PROVIDER` | force `off`, `laya` or `external`. |
| `AI_TIMEOUT_MS` / `AI_CONCURRENCY` | force the timeout and the concurrency. |
| `AI_EXTERNAL_URL` / `AI_EXTERNAL_KEY` | the external API (https, public). **Secret key.** |
| `AI_EXTERNAL_ALLOW_PRIVATE` | `1` = allow http and private addresses, for your own model only. |

## 8. Privacy: what text leaves the API

- **Rules only**: nothing leaves.
- **Laya**: the checked text, cleaned and cut to 2000 characters, goes from the API to the
  `laya` container on the same machine, over an internal network. No user id, email, IP or
  account data is sent: only the text and, for the "off topic" question, a short description of
  the place. Nothing is written to disk by the API; the answer (scores, not text) is kept in
  memory for 2 minutes under a hash of the text. The sidecar runs at log level `warning`, so
  it does not write an access line per request.
- **Discord automod**: the text of the checked messages goes from the bot to the API, then as
  above. It is scored and not kept.
- **External API**: the checked text goes to **a third party**, under their terms and in their
  country. **Before switching it on**, the privacy policy must name that provider, what is sent
  and why (legitimate interest in moderation), and the data-processing agreement with them must
  exist. The privacy policy's processor list says "an AI provider, only if we switch one on";
  when you do, add its name there in the same change that turns it on, because a feature that
  ships silently falsifies the legal pages.

## 9. When something looks wrong

| Symptom on the admin screen | Likely cause |
|---|---|
| "Not configured" | `LAYA_API_KEY` is not set for the API. Set it in `.env` (the same value the sidecar gets) and restart the API. |
| "Not reachable" | The sidecar is not running (profile missing, or it refused to start without its key: `docker compose logs laya-fetch`), still loading, or `LAYA_API_KEY` differs between the two sides. `docker compose ps laya`, `docker compose logs laya`. |
| Many "timed out" | CPU too small for the load: raise `LAYA_CPUS`, or lower what is sent (fewer places, fewer characters), or raise the timeout a little. |
| "Paused after repeated failures" | The breaker opened; it retries by itself after the pause. |
| "Busy" in the test box | The queue is full: concurrency 1 with a slow CPU. That is the guard working. |
| `laya-fetch` exits with an error | No internet on first start, or Hugging Face unreachable. It only needs to succeed once. |

## 10. What was verified, and what was not

Verified (2026-09-29): the AI layer against a fake sidecar (timeout, breaker, full queue, kill
switch by setting and by env, cache, truncation, garbage answers, rate limits, external URL
rules, no key or URL in the status), the routes (auth, validation, disabled answer, kill switch
round trip, bot secret and plan), the bot's fixed phishing checks and AI follow-up, the
dashboard and bot agreeing on the saved shape, `docker compose config` with and without the
`ai` profile.

Also verified (2026-09-29, security hardening of the image): `docker build --pull` of
`infra/laya/Dockerfile` (Debian 13, two stages, no pip at runtime, unused Debian packages
purged; about **1.35 GB**), the Trivy image scan judged by the CI gate (0 CRITICAL, 0 HIGH
beyond the four reviewed entries of `.github/security/trivyignore.yaml`), the entrypoint
refusing to start without `LAYA_API_KEY` (exit 64), the imports of laya, torch 2.9.1+cpu and
transformers, and `laya-serve` starting as uid 10001 with `--cap-drop ALL`, no network and no
model preloaded, its HEALTHCHECK answering.

**Not verified: the model was never downloaded nor used to classify anything.** The RAM
figure and the latency on your CPU are estimates until you run
`docker compose --profile ai up -d` and watch it once. The Laya answer format was read from the
package source (laya 0.3.21, `laya/serve.py`), not observed live.

## 11. Usage analytics, and what is built on this layer (aios)

Every call through this layer is now counted, per day, surface and provider: calls, failures,
timeouts, a latency histogram (p50 / p95), cache hits, rate-limited and dropped calls, breaker
openings and the calls it refused, tokens and an estimated cost for the external provider. Also
counted: the decisions the AI raised above the rules, and how often a moderator's verdict agreed
with it (a flagged case removed or sanctioned) or not (closed as a false positive or dismissed).
**Counts only**: no text, excerpt or hash of a text is stored. The status box above still shows
the live, in-memory figures of this process; the dashboard shows the stored history.

The dashboard, the member helpers (tag and language suggestions, the check before posting,
description drafts), members' own keys, the site key and the staff tools are documented in
[AI_FEATURES_EN.md](AI_FEATURES_EN.md): **Admin → Moderation → AI helpers**.

## 12. BMM live errors in the telemetry dashboard (telemetry-live)

The telemetry service (`bmm/telemetry-dashboard`) receives BMM's live error reports on `/issues`
and groups them in its **Issues** screen. Each NEW group is sent to this layer for four labels:
category, severity, "user environment or BMM bug", and whether a similar earlier group is the same
problem. The call is server-to-server, `POST /internal/telemetry/classify-issue` with the shared
`x-link-secret` (the same secret as the GDPR identity calls), and goes through the pipeline above:
kill switch, the one concurrency slot, breaker, cache, usage analytics under the feature
`telemetry_issues` (Admin → Moderation → AI helpers, staff features, on by default).

- **Why through the API and not straight to the sidecar:** one key (`LAYA_API_KEY` stays here),
  one queue (a second client would bypass the concurrency budget moderation relies on), one
  switch, one set of usage counters. The telemetry container needs no `ai` network.
- **Laya only.** The route refuses with `not_laya` when the provider is the external one: issue
  text is not sent to a third party.
- **Never on the ingest path.** The telemetry service queues the group and moves on; its worker
  has its own timeout (10 s), breaker (5 failures, 2 min), cache (1 h) and backs off 5 minutes
  when the answer is `disabled`, `unconfigured`, `feature_off` or `not_laya`.
- **Off:** any of the four levels in §5, the feature switch, the dashboard's own switch (Issues →
  Laya), or `ISSUES_AI=0` on the `telemetry` service (`TELEMETRY_ISSUES_AI` in `.env`).
- Staff corrections are stored next to Laya's labels, never over them; the Issues screen shows how
  often staff kept Laya's category.
