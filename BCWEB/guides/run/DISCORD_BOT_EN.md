# The Discord bot

`apps/bot` is a shipped service, not an add-on: it is BetterCommunity's presence inside a
Discord server. It holds **no database credentials**. Every read and write goes through the
API's `/bot/*` surface with a shared secret, which is what keeps it a separate container.

Almost everything it does is configured from the site (Admin → **Discord bot**, and the
server owner's own Discord dashboard) and picked up within 30 seconds, without a redeploy.

> Where this guide says nothing, it says so. Anything marked *not verified here* was not
> confirmed against the code when this page was written.

**See also:** [Architecture §3.7](../reference/ARCHITECTURE_EN.md) for the design,
[Technical analysis §7](../reference/Technical_Analysis_EN.md) for the module map,
[Setup guide §8](SETUP_GUIDE_EN.md) for the short install path,
[Env reference](ENV_EN.md) for the variables.

---

## 1. Install it and give it a token

1. Create an application and a bot in the
   [Discord Developer Portal](https://discord.com/developers/applications).
2. Under **Bot → Privileged Gateway Intents**, enable **Server Members** and
   **Message Content**. Both are required: the login fails without them, and the bot
   reports the reason to the dashboard rather than looping in silence. The other intents it
   asks for (guilds, voice states, messages, message reactions, moderation, expressions,
   webhooks) are not privileged.
3. Copy the token, then either:
   - paste it in Admin → Discord bot → Overview → **Bot token**, or
   - set `DISCORD_TOKEN` in `infra/compose/.env`.
4. Invite the bot to the server. The site builds the invite link itself, on the **user**
   Dashboard → **Discord servers** (not the admin screen): the bot reports its own
   application id on every heartbeat, so nobody has to paste a client id. The link asks for
   `bot` and `applications.commands`, with a permission set covering manage roles, manage
   channels, kick, ban, timeout, move members, send messages, embed links, read message
   history and view channels. It does not ask for Administrator.
5. `docker compose up -d bot`.

**Which token wins.** `DISCORD_TOKEN` from the environment always wins. When it is set, the
API refuses to change the stored one at all (`PUT /admin/bot/token` answers 409
`token_from_env`), and the dashboard field is replaced by a note saying so.

**The bot must be disabled to change the stored token.** With `enabled` still true, the same
route answers 409 `bot_enabled`, and the dashboard hides the field until you switch the bot
off. Switch it off, change the token, switch it back on.

**Only an administrator may set it.** That one route is guarded by the ADMIN role rather
than by the `manage_bot` capability, deliberately: a credential is not delegable. Somebody
granted `manage_bot` can configure everything else and sees a note telling them the token is
not theirs to set.

**How the stored token is kept.** As an `AdminSetting` row under the key `bot.token`, in
plain JSON. It is **not encrypted at rest**: anyone with database access can read it. Treat
a database dump as you would the token itself. No API route ever returns it to the browser
(the admin config route answers with `hasToken` and `tokenFromEnv` booleans only).
`GET /bot/token` returns `null` while the bot is disabled, which is how "disabled" is
enforced even if the container keeps running.

**No restart is ever needed.** `index.mjs` is a connection manager, not a plain boot. A
supervisor tick every 20 seconds connects when a token appears, reconnects when the token
changes or when an admin presses **Reconnect**, and disconnects when the bot is switched
off. With no token the process idles and keeps polling; it does not exit.

**Failed logins back off** instead of hammering Discord: 10 minutes on an invalid token
(it waits for the token to change), 1 minute when the privileged intents are disabled (so
enabling them in the portal reconnects promptly), 30 seconds otherwise.

### Environment

| Var | Purpose |
|---|---|
| `DISCORD_TOKEN` | Bot token. Empty: the bot idles until a token is set in the dashboard. Set: it wins and locks the dashboard field. |
| `BCWEB_API_URL` | Internal API base. Default `http://api:3000`. |
| `BOT_SHARED_SECRET` | The credential on every `/bot/*` call. The API accepts `BOT_SHARED_SECRET`, else `LINK_LOOKUP_SECRET`, else the literal `dev-bot-secret`, and the production boot guard refuses to start without one of the first two. Compared in constant time. |
| `SITE_URL` | The public site URL the bot puts in its links and buttons. |

Note that `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` are the **OAuth login** identity, a
different thing from the bot token. See [Setup guide §8b](SETUP_GUIDE_EN.md).

---

## 2. How it is configured

Three screens:

- **Admin → Discord bot** (`manage_bot`). A left module rail rather than one long scroll:
  Overview (token, master switch, Reconnect, storage bar, member database, live logs, DM a
  member), Announcements (announcement routes, blog routes, alerts, Ko-fi, payments),
  Community (role panels, broadcast DM, giveaways), Per-server (the server picker, banned
  servers, and per-server moderation / logs / voice / welcome / gating), Members (the roster
  and the economy views, including seasons), Economy (currency, XP curve, casino, shop,
  gifts, history, icons), Limits.
- **Admin → Languages** edits the bot's dictionary, an override layer per language on top of
  what the bot shipped. It needs `translate_site`, not `manage_bot`.
- **Dashboard → Discord servers** is the server owner's own screen: automod, logs, welcome,
  join-to-create, gated roles and role panels, blog routes, and a read-only member list with
  queued moderation actions. A user sees a server if they own it or hold Manage Server on it,
  re-checked server-side on every call; they must link their Discord first. The storage pool
  and the byte budget are **not** there: those belong to the account holder on the site.

The bot pulls one config object from `GET /bot/config` and caches it for 30 seconds, so a
dashboard change takes effect within half a minute.

- **Global settings** apply everywhere the bot is: the master enable, blog routes, alerts,
  Ko-fi, payments, announcements, DMs, giveaways, role panels, the economy and its casino
  and seasons, the icon set, the member database, the storage limits, banned servers.
- **Per-server settings** live under `guilds[<guildId>]` and *replace* the global default
  for that server. Only five features are per-server: `moderation`, `welcome`,
  `joinToCreate`, `gating`, `logs`. A server without an override follows the global value,
  so a single-server install needs no per-server config at all.

Two things can be configured **from inside Discord**, by the server owner or a manager whose
Discord is linked to a BetterCommunity account: `/config` (the bot's language here, whether
it moderates, its log channel) and `/logs` (where each log category goes). Both write through
the API, which re-checks the actor itself: the bot is trusted to report who pressed the
button and nothing more. The link requirement is deliberate: a Discord snowflake on its own
is nobody the platform has a record of, so there would be nothing to write an audit line
against.

Storage and billing decisions are **not** exposed in Discord. They belong to the account
holder on the site.

---

## 3. What each feature does

### Account linking and gated access

`/link` issues a code the member redeems on `SITE_URL/profile` to bind their Discord id to
their BetterCommunity account. **Gating** then grants roles: a list of rules, each with its
own requirements (a linked Discord, a BCWEB account, a BMM creator id) and its own role.
A legacy single-role config is still honoured.

Roles are reconciled in both directions, granted *and* removed, on join, every 5 minutes
across every server, on `/verify` or `/refreshroles`, and promptly after a website Discord
sign-in (the link buffer is drained every 30 seconds). A role the bot cannot assign (missing
permission, or the role sits above the bot's own) is skipped silently for that member; the
dashboard's role picker reports a role's position so it can warn you first.

### Moderation, automod and the warn ladder

- `/clear [count]` bulk-deletes up to 100 recent messages (Manage Messages).
- `/warn <member> <reason>` and `/warnings <member>` (Moderate Members). The **record lives
  on the site**, not in the bot: a warning given here and one given from the admin screen are
  the same row. If the site refuses the write, the reply says the warning was **not**
  recorded rather than pretending.
- **No-post channels**: posting in one deletes the poster's recent messages in it and kicks
  them.
- `/lockdown on|off [minutes]` raises verification and times out new joiners by hand.

The **automod** is data driven. Eleven rules: spam, mass mentions, invites, links, words,
caps, zalgo, attachments, account age, selfbot, raid. Each has its own thresholds and an
action from `log` / `delete` / `warn` / `timeout` / `kick` / `ban`, plus three parameters
every rule accepts: whether the message is deleted, whether the member is told by DM, and a
**watch-only** switch that records the rule firing and carries nothing out. Message rules
also take their own role/channel exemptions on top of the global list (roles, channels,
users, and moderators, who are exempt by default). When several rules fire at once the most
severe wins; they are never stacked.

The **warn ladder** (`warnThresholds`) is shared by `/warn` and the automod: rows of "at N
warnings, do X", matched on the exact count, so the warning that crosses a line fires and
later ones do not. `warnDecayHours` (default 168) is how long a warning counts.

Defaults worth knowing: automod on, with spam, mentions, invites, zalgo, attachments,
selfbot and raid enabled; links, words, caps and account age off.

Moderation the website asked for (a ban, a kick, a timeout decided in the admin screens) is
**queued** by the site and carried out by a poller here, because the website cannot reach
Discord. The outcome is always reported back, failures included: Discord refuses these
constantly for reasons that are nobody's mistake, and an admin watching a button go green
while nothing happened is what that queue exists to avoid. A timeout longer than Discord's
own 28-day ceiling is rejected outright rather than silently clamped.

### Logging

23 categories in 8 groups (messages, members, voice, automod, moderation, server, bot,
economy), each routed independently to a **forum** (one tagged post per category, or one per
day), a **text channel**, or nowhere. A route may be set per category or per group; the exact
category wins over its group, both win over the server's default forum or channel.

From Discord: `/logs setup` creates the forum with its tags, `/logs route` points a category
or a group somewhere, `/logs test` posts a sample entry where that category resolves, and
`/logs status` lists every category with its destination (Manage Server).

A per-destination queue merges bursts and respects Discord's rate limits. Admin **alerts**
are global rather than per-server, and can also be sent to one forum where each alert kind
(perf, incident, Ko-fi, payments, contact, legal, moderation, announcements) becomes its own
tagged post.

### Welcome and goodbye

An animated 1200x400 GIF banner on the BCWEB dark theme (the member's avatar and name over
drifting particles) plus a message with variables: `{user}`, `{username}`, `{servername}`,
`{joinnumber}`, `{joindate}`. Six built-in backgrounds (dark, midnight, plum, forest, rose,
slate), or a custom one **uploaded to the site**: the bot only accepts a site media path, never
an arbitrary URL, because the bot runs inside the Docker network and "fetch whatever the config
says" would let a crafted config reach anything on it. The GIF encoder and the canvas library
are both optional at runtime; if either is missing the message still goes out, without the
banner.

### Join-to-create voice

Joining the configured lobby creates a personal temp voice channel in a dedicated category
and posts a control panel: rename (12-minute cooldown), user limit, region, lock/unlock,
private toggle, whitelist, kick, ban/unban, unkick, and one saved voice preset. Only the room
owner operates the controls; when the owner has left, anyone still in the room can claim it.

The owner is recorded **in the room itself**, as the permission overwrite granting Manage
Channels, so a sweep on startup and every two minutes re-adopts rooms a previous process
created and deletes the empty ones. An auto-created category is removed with its last room.
`limits.maxTempChannels` (default 50) caps the rooms per server.

### Self-serve role panels

A rules post or a "pick your pings" post with its roles attached as buttons or as a dropdown.
Editing the panel in the dashboard **is** publishing it: the bot compares a fingerprint of
what the panel should look like against what it last posted, so there is no Publish button to
remember, and an edit that changes nothing visible re-posts nothing. A click reads the panel
definition fresh rather than trusting a message that may be months old.

### Onboarding

The moment the bot joins a server it posts one card in the system channel (else the first
text channel it may write in, else a DM to the owner): link an account, pick the bot's
language for this server, open the dashboard. `/setup` posts it again.

### Giveaways

Two kinds. **Staff** giveaways are created on the dashboard and can carry an inventory
reward. **Member** giveaways are `/giveaway <prize> <minutes> [winners]`, Discord-only,
capped at 5 active per server; the prize is whatever the host hands over. The bot posts the
card with an Enter button, draws when the end time passes, and records entries and winners on
the site. A giveaway may require a linked account, or a linked account with a BMM creator id.

### Posting on the site's behalf

Each of these is a poller with the same shape: ask the API what has not been announced, post
it, mark it done **server-side**, so a restart never re-announces anything.

| What | Cadence | Notes |
|---|---|---|
| Blog posts | 5 min | Multiple routes; each route picks a channel and which blogs to include (`*`, a project key, or `showcase`). A channel id is globally unique, so a route can target any server the bot is in. Dedup is per channel. |
| Server-perf alerts | 2 min | CPU / RAM / disk / service-down, from the API's monitor. A separate general channel for incidents is optional. |
| Ko-fi tips | 2 min | With the running total. Also copied to the admin-alerts forum. |
| Stripe payments and refunds | 2 min | Multiple channels each; refunds fall back to the payment channels. The customer e-mail is masked and display names are stripped of Discord markdown. |
| Announcements | 20 s | Events, promotions, commission requests, incidents. A role is pinged only when one is urgent. |
| Admin DMs | 30 s | A message, optionally carrying a gift code. An unreachable user is dropped rather than retried forever. |
| DM broadcast | 30 s | **Paced on purpose**: 10 per poll, a second apart, so roughly 1200 an hour. Discord treats a DM burst as spam and the account that gets flagged is the bot. Progress is a row on the server, so a restart resumes instead of DMing everyone twice. |
| Role panels | 60 s | See above. |
| Economy seasons | 10 min | The first poll after a restart seeds the season number and announces nothing. |

### The economy

Off by default. Messages, reactions and voice time earn XP; XP earns levels; levels hand out
points; points buy shop items and casino bets.

The bot buffers activity per member and flushes it once a minute. It buffers **everyone** and
lets the API decide: only a member whose Discord is linked to a BCWEB account is credited.
An unlinked member's `/level` card shows what is waiting for them rather than claiming
nothing accrues.

Defaults, all editable: 5 XP per message, 1 per reaction, 3 per voice minute; the curve is
100 XP for level 1 multiplied by 1.18 per level; 10 points granted every 5 levels; the point
ledger is kept 180 days (0 = forever); gifts on, minimum 1, no daily cap (0 = none).

The **shop** sells badges, Discord roles, storage pools, boosts, free hosting, promo codes
and custom rewards. The API is authoritative on every purchase: it re-reads the price, checks
stock and exclusivity, debits atomically and records the row. A code arrives **sealed**:
Reveal mints it, or Gift hands the unopened item to somebody else. A role or a custom reward
shows as *pending* until an admin hands it out. An item can be hidden from the Discord shop
while staying on the site, and vice versa.

`/gift` moves points between members, within the minimum and the daily cap the admins set.
`/history` lists the last movements, filterable by kind. `/leaderboard` draws the board as a
picture rendered by the site, this server or global, with your own rank.

**Seasons** reset the points on a schedule the admin sets (daily, weekly, monthly, quarterly,
yearly, or every N days/weeks/months, plus "never", which is the default), with XP kept or
wiped. Everything is UTC, and the hour of the reset defaults to 04:00. The schedule lives in
the bot config; the clock (season number, last reset, history) lives in its own setting row,
so saving the config cannot rewind it. A reset zeroes the points and writes one ledger row per
holder. `/season` shows which season is running and when it ends, as a Discord timestamp, so the countdown keeps
ticking on a card the bot never redraws and every reader sees it in their own locale. A new
season is announced once per server, through the `economy.season` log route if there is one,
else the server's general announcement channel.

### The casino

Off by default (`economy.casino.enabled`). Bet limits default to min 1, max 100; **max 0
means no cap**, and the table then says so rather than silently clamping an all-in.

Six games are played on your own, against the house: **coin flip** (2x, 50%), **dice** (win
on 4 to 6, 2x), **slots** (8x for three of a kind, 1.5x for two), **roulette** (European
wheel: a colour 2x, green 14x, an exact number 35x), **wheel** (pick a multiplier: 2x at 45%,
3x at 24%, 5x at 16%, 10x at 9%, 20x at 4%, 50x at 2%), **plinko** (low 0.5x-5x, medium
0.3x-13x, high 0.2x-50x).

Two more exist only as **live tables** other members join from the same card: **race** (six
cars, pick yours, 6x alone) and **pot** (everyone stakes what they like, one takes it all,
odds proportional to stake, two players minimum). The four classic games can also be played
as **multi**: one shared roll for the whole table. Every table has a 6-character code from an
alphabet with no look-alikes, a visibility (public, this server, or private), and mirror cards
in every channel a player joined from. An idle or finished table is swept after 10 minutes; a
running one never is.

**The house edge taxes the profit of a win, never the stake.** A 1x bucket returns the bet to
the point; a 0.3x bucket returns exactly 30% of it. It is one global percentage (default 5)
with an optional override per game.

**A table with two or more seats is zero-loss: the house takes nothing from it.** The losers'
stakes form the pot, each winner keeps their own stake and takes a share of the pot in
proportion to their stake, and the sum paid out equals the sum staked to the point. With no
winner at all, every seat gets its stake back. Alone at a table you play the house as usual.

`/casino` with no options opens the interactive table: pick the game, the bet and the game's
own options from menus, then Play. The slash options are shortcuts to the same roll. The
whole choice travels in the buttons' custom ids, so the table survives a bot restart with no
session state.

**Known gap.** The API's rules library and the admin dashboard both still carry a **crash**
game, and the default config enables it under `economy.casino.live`. The bot implements no
crash game: it is in neither the single-player roll nor the live tables, and `/casino` offers
no crash option. Turning it on in the dashboard has no effect in Discord today.

### The member database

A full roster scan on startup and every 30 minutes pushes every non-bot member of every
server (id, username, avatar, join date, role names, nickname) to the site, so the admin
member database is not just whoever happened to talk. It needs the Server Members intent,
and it is skipped entirely when the member database is switched off.

### Icons and languages

The bot draws **no unicode emoji**. Every glyph is one of the site's icons, uploaded once as
an **application emoji** (`bc_<key>_<version>`), which works in every server and in DMs. An
admin can override any key with their own custom emoji. A key nobody mapped draws nothing:
the label stands alone, never a stray emoji.

Four languages ship: English, French, German, Spanish. Which one a card uses: the server's
choice if its manager picked one in `/setup` or `/config`, otherwise the reader's own Discord
locale, otherwise English. The whole dictionary is editable from the site's **Languages**
screen; the bot ships its English dictionary to the site on its first heartbeat, because the
bot is the only place that dictionary lives.

Cards posted by a poller (a giveaway, the voice panel) have no reader whose language to use,
so their labels are English. The help card a button opens is in the presser's language.

---

## 4. Every slash command

| Command | Who | What |
|---|---|---|
| `/link` | anyone | Get a code to link your Discord to a BetterCommunity account. |
| `/verify` | anyone | Re-check your links and update your access roles. |
| `/refreshroles` | anyone | Same as `/verify`. |
| `/voice` | anyone | The control panel for your temp voice room. |
| `/help [topic]` | anyone | What each part of the bot does. Same text as the **Learn more** buttons. |
| `/appeal` | anyone | Answers even in a blocked server: the block's reference and how to contest it. |
| `/level` | anyone | Your level, XP and points. |
| `/profile [member]` | anyone | A member's BetterCommunity profile, with the same card a shared profile link unfurls. |
| `/shop` | anyone | The points shop, 8 items a page. |
| `/inventory` | anyone | What you bought: reveal codes, gift items. |
| `/gift <member> <points> [note]` | anyone | Give points to another member. |
| `/history [kind]` | anyone | Your last point movements. |
| `/season` | anyone | How long until the points season resets. |
| `/leaderboard [scope]` | anyone | Top members, this server or global. |
| `/casino [bet] [game] [bet_on] [number] [target] [risk] [visibility] [join] [lobbies]` | anyone | The casino. No options opens the interactive table. |
| `/giveaway <prize> <minutes> [winners]` | anyone | Start a giveaway here. Max 5 active per server. |
| `/clear [count]` | Manage Messages | Delete up to 100 recent messages. |
| `/warn <member> <reason>` | Moderate Members | Warn a member. Recorded on the site. |
| `/warnings <member>` | Moderate Members | The warnings on a member, revoked ones struck through. |
| `/lockdown <on\|off> [minutes]` | Moderate Members | Raid lockdown by hand. |
| `/config` | server managers | This server's bot: language, moderation, log channel. |
| `/setup` | Manage Server | Post the welcome card again. |
| `/logs setup\|route\|test\|status` | Manage Server | Where each kind of event is logged. |

Commands are registered globally on every connect, so a change reaches every server the bot
is in.

---

## 5. What it stores, and the caps

The bot itself keeps almost nothing: its in-process state is the temp voice rooms, a few
throttles, the moderation counters and a ring buffer of its own console output. Everything
durable is a row on the site.

`limits` in the bot config is the budget:

| Key | Default | What |
|---|---|---|
| `maxTempChannels` | 50 | Temp voice rooms per server. Read by the bot. |
| `storageMB` | 200 | The byte budget the member database is held to. A row is counted at roughly 512 bytes, so the default is about 409,000 members. 0 means no cap. |
| `keepLinked` | true | A member with a linked site account is never evicted: hitting the limit prunes unlinked rows first. |
| `purgeUnlinks` | true | **Not implemented.** The switch is in the dashboard and in the defaults; no code reads it. |
| `relinkDays` | 0 | **Not implemented.** Same: the field is editable and nothing reads it. |

`memberStorage` decides what the roster scan keeps: `enabled` (default true),
`evictInactive` (true) and `inactiveDays` (30). "Inactive" means no message and no voice
join inside that window; a row that has never recorded either counts as inactive. When the
cap is reached, inactive unlinked rows are evicted oldest first to make room; linked members
are kept while `keepLinked` holds. The API answers `full` once the budget is gone and the bot
stops pushing the rest of that roster rather than serialising it for nothing. A background
sweep every 10 minutes trims the table back to 95% of the cap, and that pass is allowed to
evict active unlinked rows too once the inactive ones run out.

`economy.historyDays` (180) is how long the point ledger is kept; 0 keeps it forever. The
sweep runs once a day.

**Discord moderation logs are not capped.** `ModerationLog` rows are written only for a
server whose owner turned logging storage on, and nothing prunes them. Size that table
yourself. (Admin → Storage lists it beside the Discord roster.)

The **welcome banner background** is the one place a config value becomes a fetch, and it is
restricted to a site media path by the same regex on both sides.

---

## 6. Operating it

- **Heartbeat, every 60 seconds.** It carries uptime, guild and user counts, temp-channel
  count, gateway ping, the moderation counters, the last 60 log lines, the bot's application
  id, and for each server (up to 200) its name, icon, member count, owner, best-effort list
  of Manage-Server admins, up to 100 assignable roles with their colour and position, and up
  to 200 channels. That is what feeds the dashboard's server picker and its role and channel
  pickers, and it is why a picker can warn that a role sits above the bot's own. The
  dashboard calls the bot **online** when the last heartbeat is under two minutes old.
- **Live logs and errors.** Every gateway handler is wrapped. An error is logged, shipped in
  the heartbeat tail, reported as an `ErrorEvent` on the site **with what it was handling**
  (the command or button, the server, the member), and written to that server's own
  `bot.errors` log category. "Invalid Form Body" without the command that built the form is a
  message nobody can act on.
- **Reconnect** from the dashboard tears the client down cleanly and rebuilds it, the same
  path a token rotation takes. The stamp is seeded on the first tick, so deploying the
  container does not trigger a spurious reconnect.
- **Blocking a server.** An admin can ban a guild in `leave` mode (the bot leaves and leaves
  again if re-invited) or `disable` mode (it stays and every command is inert). The immediate
  response is on join; a 20-second sweep is the backstop for a ban added while the bot was
  already there. `/appeal` keeps answering in a blocked server, because finding the reference
  is the one thing a moderator of a blocked server needs.
- **A member re-scan** requested from Admin → Member database rides back on the heartbeat
  answer and runs at once instead of waiting for the 30-minute cycle.
- **A stale button** (a message older than the deploy that renamed its id) is answered with a
  "this card is out of date" line rather than left to spin and show "This interaction
  failed", which reads as the bot being down.

### When something is wrong

| Symptom | Look at |
|---|---|
| Never connects | Admin → Discord bot shows the reason the login failed. "Privileged intents disabled" and "Invalid bot token" are reported verbatim. |
| Connects, does nothing | The master `enabled` switch, and whether this server is in `bannedGuilds`. |
| A role is never granted | Gating rules, and whether the role sits above the bot's own. |
| Payments never posted | Admin → Discord bot → Payments has a Stripe key / webhook diagnostic. It is almost always the Stripe webhook not reaching the API. See [Deploy §6](DEPLOY_EN.md). |
| A log category goes nowhere | `/logs status` says where each one resolves right now, and `/logs test` proves it. |
| 401 on every API call | `BOT_SHARED_SECRET` does not match the API's. |

---

## 7. Security notes

- Every `/bot/*` route is authenticated by the `x-bot-secret` header, compared in constant
  time. There is **no rate limit** on those routes: the shared secret is the whole gate.
- One `/bot/*` route is deliberately public and unauthenticated: `GET /bot/invite`, which
  returns the invite URL. A client id is not a secret.
- `PUT /bot/guilds/:id/settings` and `PUT /bot/guilds/:id/features` check the actor the bot
  reports against the guild's owner and manager list **and** require a linked account, so a
  compromised bot secret still cannot rewrite a server's settings as any member.
  `PUT /bot/guilds/:id/language` has no such actor check: the shared secret alone is enough
  to change a server's bot language.
- Refund and payment announcements mask the customer e-mail and strip Discord markdown from
  display names before posting.

## 8. Not verified here

- Whether every dashboard control named in this page renders in the current UI. The
  behaviour described was read from the bot and the API; the screens were read separately
  and may have moved.
- `BotGuild.memberMode` (`none` / `moderation` / `pool`) and `storageQuotaBytes` still exist
  and are still settable through the admin guild route, but the member-write paths budget
  against the single global `limits.storageMB` instead. What, if anything, `memberMode` still
  changes was not established.
- `apps/bot/README.md` still says the process exits when no token is set. The Dockerfile and
  `index.mjs` say it idles and keeps polling, which is what was verified here. That file was
  left as it is.
