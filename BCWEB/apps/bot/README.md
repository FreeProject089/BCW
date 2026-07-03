# BetterCommunity Discord bot

A standalone Discord bot for the BetterCommunity server. It talks to the BCWEB API
(server-to-server, shared secret) for its config, account linking, and heartbeats —
so most behaviour is tunable from **Admin → Discord bot** without a redeploy.

## Features
- **Moderation** — `/clear` (bulk delete ≤100), a configurable "no-post" channel that
  kicks the poster and purges their recent messages, and a light anti-selfbot filter.
- **Join-to-create voice** — joining the configured lobby VC creates a personal temp
  channel (in a dedicated, auto-managed category) and posts a **Components V2 control
  panel**: rename (12-min cooldown), user limit, region, lock/unlock, private toggle,
  whitelist, kick, ban/unban, unkick, and save/import one voice preset.
- **Welcome / bye** — an animated 1200×400 GIF banner on the BCWEB dark theme (member
  avatar + name, drifting particles) plus a variable message
  (`{user} {username} {servername} {joinnumber} {joindate}`). Falls back to a static
  PNG if the GIF encoder is unavailable.
- **Account linking** — `/link` issues a code; the user redeems it on
  `SITE_URL/profile` to bind their Discord id to their BetterCommunity account.
- **Gated access** — grants a configured role to members who meet the link
  requirements (BMM creator id / Discord link / BCWEB account); re-checked on join,
  every 5 min, and on demand via `/verify`.
- **Heartbeats** — posts uptime / guild / user / temp-channel counts to the API for
  the admin dashboard.

## Configuration (env)
| Var | Purpose |
|-----|---------|
| `DISCORD_TOKEN` | Bot token. **Without it the process exits 0 (idle).** |
| `BCWEB_API_URL` | Internal API base (default `http://api:3000`). |
| `BOT_SHARED_SECRET` | Must match the API's `BOT_SHARED_SECRET`. |
| `SITE_URL` | Public site URL used in the `/link` message. |

Set `DISCORD_TOKEN` (and optionally the channel IDs under **Admin → Discord bot**),
then `docker compose up -d bot`.

## Notes
- Requires the **Server Members** and **Message Content** privileged intents enabled
  in the Discord developer portal, plus **Manage Roles** (above the gate role in the
  hierarchy) for gated access, and **Manage Channels / Move Members** for join-to-create.
