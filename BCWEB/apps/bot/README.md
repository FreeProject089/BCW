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

## Plans, credits and the voice panel: what came from the OFD bot (agent-bcw-bot, 2026-09-30)

The owner's other bot (`OFD/BotDiscord`, TypeScript/pnpm, proprietary licence that allows reuse
in the owner's own projects) was the model. Nothing was copied wholesale (no `.env`, no
`node_modules`, no TypeScript packages): the ideas were ported into BCWEB's JavaScript and its
existing plan model (a plan is a `HostingPlan` row, entitlements are computed).

| From OFD | Adapted here |
|---|---|
| `packages/shared/src/plans.ts` Free / Premium / Ultra, `TIER_FEATURES`, AI limits `ai.platform_monthly` | `apps/api/src/lib/bot-billing.mjs` `TIER_PRESETS` (Free / Pro / Ultra), limits `aiMonthly` and `storageMB` in `bot-entitlements.mjs`; `npm run seed:bot-plans` writes Pro and Ultra as plan rows |
| `docs/features/ia.md`: platform AI quota, then 1 AI credit per call; BYOK on paid plans | allowance, then credits (`BotCreditLedger`, idempotent on the Stripe session); BYOK allowed on every plan with a small credit fee, free with `aiByok`; the owner's own monthly cap; only successful calls count |
| AI key sealed, last 4 chars shown | `BotAiSettings`, sealed with `lib/ai-keys.mjs` for `guild:<id>` only |
| `rate-limits.ts` / Redis `rateLimit(key, n, window)` | `src/throttle.mjs`: in-process token buckets + a bounded work queue (AI calls, welcome banners); the API keeps its own burst limit |
| `PREMIUM_REQUIRED` / `LIMIT_REACHED` replies, `PremiumLock` | `src/paywall.mjs` card with link buttons to `/bot/pricing?feature=…&guild=…` and `/bot/features#…`; the dashboard's `PaywallModal` |
| `jtc-panel.ts`: owner panel, user selects, bitrate by boost tier, transfer | `src/features/panel.mjs`: dropdowns (privacy, limit, settings, members), bitrate and transfer behind `jtcPro`; every old custom id still answers |
| `DashboardLayout.tsx`, `PremiumPage.tsx`, pricing page | `apps/web/src/pages/discord-dashboard.jsx` (server rail, overview, modules, plan and credits) and `pages/bot-public.jsx` (`/bot/features`, `/bot/pricing`) |

Not ported: OFD's OS mode, Discord SKUs, dynamic pricing/loyalty rules, the linked text channel of
voice rooms, and the per-plan storage enforcement (`storageMB` is shown; member storage stays on
the site-wide policy).
