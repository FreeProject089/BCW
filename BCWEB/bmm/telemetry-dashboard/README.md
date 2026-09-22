# BMM Telemetry Dashboard

Privacy-first, opt-in telemetry for Better Mods Manager.

**Stack (v2 — scalable):**

- **Backend** — Rust + [Axum](https://github.com/tokio-rs/axum) + **PostgreSQL** (`sqlx`). All
  stats are derived from a single `events` table, so retention and per-packet
  erasure are exact. Live updates are pushed to the dashboard over **SSE**.
- **Frontend** — React + TypeScript + Tailwind + ECharts + MapLibre (`web/`), multi-page,
  lucide icons, dark / light / system theme.
- **Docker** — `docker compose up` brings up Postgres + API + dashboard.

Data lives in Postgres (the `pgdata` volume), so **restarting the server keeps
every past event** — nothing is lost.

```
telemetry-dashboard/
  server/   Rust/Axum API + Postgres layer + stats derivation
    src/gdpr.rs      one person's export package + exact erasure (same table list for both)
    src/bc.rs        server-to-server calls to BetterCommunity (identity, notify)
    src/sampling.rs  deterministic per-install sampling (shared with the BMM client)
  web/      React/Tailwind dashboard (built to web/dist, served by the API)
    src/lib/replay-decode.ts   .bmmreplay / rrweb stream decoder (unit-tested)
  Dockerfile, docker-compose.yml
  *.mjs     legacy Express/SQLite version (deprecated, kept for reference)
```

## Run with Docker (recommended)

```bash
cd telemetry-dashboard
# optionally set keys:  export API_KEY=...  ADMIN_KEY=...
docker compose up --build
# dashboard + API on http://localhost:8900
```

Inside BCWEB the service is a member of `infra/compose/docker-compose.yml` (service
`telemetry`); every variable below is set there from BCWEB's `.env` — the `server/.env`
file is NOT read in Docker (see `.env.example`).

## Run locally (dev)

```bash
# 1) Postgres
docker run -d --name bmm-pg -e POSTGRES_USER=bmm -e POSTGRES_PASSWORD=bmm \
  -e POSTGRES_DB=telemetry -p 5432:5432 postgres:16-alpine

# 2) API (reads server/.env — copy from .env.example)
cd server && cargo run
#   → http://localhost:8900

# 3) Dashboard with hot reload (proxies /api, /batch, /config, /*-request to :8900)
cd web && npm install && npm run dev
#   → http://localhost:5180
```

## Verify without a database

```bash
cd server && cargo build && cargo test      # unit tests: gdpr zip, sampling buckets, bc identity merge
cd web && npm run build && npm test         # tsc + vite; node --test over the replay decoder
```

## Demo mode (`/demo`)

`/demo` shows the whole dashboard filled with synthetic data: `http://telemetry.localhost/demo`,
or `http://localhost:5180/demo` in dev. It needs no database, no backend and no admin key, and a
permanent banner says so on every screen so a screenshot can never pass for real telemetry.

- The data is generated in the browser from a fixed seed (`DEMO_SEED` in `web/src/lib/demo-data.ts`),
  so two loads render the same page and docs screenshots keep matching. Only the date labels move:
  everything is offset from today's UTC midnight so a long-lived demo never reads as stale.
- The route is read-only by construction, not by permission: in demo mode `lib/store.tsx` opens no
  stream, calls no `fetch`, and answers every write with `Demo mode is read-only: nothing is saved.`
- The auth gate ignores it. `require_viewer` only wraps `/api/*`, so the SPA at `/demo` was never
  gated server-side; the client-side login screen is skipped because the demo holds no real data
  to protect. It stays reachable when the real dashboard is locked behind `ADMIN_KEY`.

To change what the demo shows, edit `web/src/lib/demo-data.ts`; change `DEMO_SEED` to reshuffle
every figure at once.

## Configuration (`server/.env` standalone, compose in BCWEB)

| Var             | Default                                        | Meaning                                   |
| --------------- | ---------------------------------------------- | ----------------------------------------- |
| `PORT`          | `8900`                                         | HTTP port                                 |
| `API_KEY`       | _(empty)_                                      | PUBLIC key the BMM client sends in every batch |
| `ADMIN_KEY`     | _(empty)_                                      | the real secret: unlocks every `/api/*` read and write |
| `RETENTION_DAYS`| `180`                                          | initial default; changed live from Settings |
| `DELETE_DELAY_H`| `72`                                           | initial default; changed live from Settings |
| `DATABASE_URL`  | `postgres://bmm:bmm@localhost:5432/telemetry`  | Postgres DSN                              |
| `STATIC_DIR`    | `public`                                       | built dashboard to serve at `/`           |
| `BC_API_URL`    | _(empty)_                                      | BetterCommunity API base (compose: `http://api:3000`). Empty = no account lookup, no mail |
| `BC_LINK_SECRET`| _(empty)_                                      | shared secret sent as `x-link-secret` (= BCWEB `LINK_LOOKUP_SECRET`); also verifies the SSO token |
| `RATE_PER_MIN` / `MAX_BATCH` / `SOFT_DB_MB` | `240` / `1000` / `5120` | ingest guards |

**Live settings** (Settings screen, or BCWEB → Admin → Hosting settings, or
`GET/POST /api/admin/config`) are stored in the `meta` table and override the env defaults
without a restart: `retentionDays`, `deleteDelayH`, `storageLimitMb`, `sampling`.

## Endpoints

Public (ingest key):

| Method | Path                     | Purpose                                            |
| ------ | ------------------------ | -------------------------------------------------- |
| POST   | `/batch`                 | ingest a PostHog-style batch (tagged by packet id). The answer carries the current `sampling` document |
| GET    | `/config?api_key=`       | client handshake: `{ sampling, retention_days, delete_delay_h }` — no collected data |
| POST   | `/delete-request`        | erasure of ONE packet (applied after the review delay) |
| POST   | `/data-request`          | GDPR request `{ api_key, creator_id, kind: export\|delete, email?, source?: bmm\|bcweb }` |
| GET    | `/api/packet-status?ids=`| deletion status per packet (BMM polls this)        |

Viewer (`X-Admin-Key`, or the BetterCommunity SSO token as `X-BC-Token` / `?bc=`):

| Method | Path                     | Purpose                                            |
| ------ | ------------------------ | -------------------------------------------------- |
| GET    | `/api/stats` · `/api/stream` | full payload snapshot · **SSE** live push     |
| GET    | `/api/sessions` · `/api/event?name=` · `/api/user?id=` · `/api/replay?session_id=` | drill-downs |
| POST   | `/api/funnel` · `/api/journeys` | funnel / journey queries                    |
| GET/POST/DELETE | `/api/goals`    | goals                                              |
| GET    | `/api/admin/deletions` · POST `/api/admin/decide` | packet-deletion queue · approve / reject now |
| GET    | `/api/admin/data-requests` | GDPR queue `{ requests, delete_delay_h, bc_configured }`, pending first |
| POST   | `/api/admin/data-request` | file a request from the dashboard `{ creator_id, kind, email?, note? }` |
| POST   | `/api/admin/data-request/process` | process one now `{ id }` (export → build + mail; delete → erase + mail) |
| POST   | `/api/admin/data-request/decide` | `{ id, status: rejected }` (the person is told when a recipient is known) |
| GET    | `/api/admin/gdpr/identity?creator_id=` | what BetterCommunity knows: linked account + every creator id on it |
| GET    | `/api/admin/gdpr/export?creator_id=` | the package as a zip, right now (audited) |
| GET    | `/api/admin/user-packets?q=` · POST `…/delete` · GET `…/download` | per-user packet search / erase / dump |
| GET/POST | `/api/admin/config`    | live settings incl. `sampling`                     |
| GET/POST | `/api/admin/sampling`  | the sampling document alone                        |
| GET    | `/api/admin/storage` · `/api/admin/audit` · `/api/admin/backup` … | storage, audit trail, backups, recaps |

## GDPR: export and erasure of one person

An install is only ever its **creator id** (the hex of its ed25519 public key, sent as
`distinct_id`). The telemetry payload carries **no account id**. Whether that id is linked to
a BetterCommunity account is BCWEB's knowledge, asked at request time and never stored with
the telemetry rows:

```
BMM (Settings › Privacy)  ─┐                                   ┌─ GET  /internal/telemetry/identity?creatorId=
BCWEB (account Settings)  ─┼─ POST /data-request ─► data_requests ─┤        → { linked, userId, email, creatorIds }
Dashboard (Data requests) ─┘        (kind, source)             └─ POST /internal/telemetry/notify  (the mail)
```

1. **Filing.** `POST /data-request` (or the dashboard form). The identity is looked up: a
   **linked** account never carries a typed address — the confirmation goes to the account's
   own e-mail, resolved by BCWEB at send time (a typed address on a linked install would let
   anyone redirect someone else's export). An **unlinked** install must give an address.
   One open request per (creator id, kind): filing twice returns `duplicate: true`.
2. **Processing.** Exports run within a minute of filing (nothing to review). Deletions wait
   the review delay, or an admin processes them now. The identity is re-resolved, and every
   creator id linked to the same account is covered by the one request.
   - **Export** — `gdpr::export_identity` reads every table in `IDENTITY_TABLES` (events,
     benchmarks, user_ips, live_instances, data_requests), the geo rows of the person's IPs,
     the deletion requests of their packets, and every replay session decoded to an rrweb
     event array. `build_zip` packs `README.txt`, `tables/<name>.json`,
     `replays/<session>.bmmreplay`, `export.json`. Up to 12 MB it is attached to the mail;
     above that the mail says an admin will hand it over and the dashboard keeps the download.
   - **Erase** — `gdpr::erase_identity` deletes from the SAME table list (an export that reads
     a table the erasure does not delete is a promise the erasure breaks), removes the
     packets' deletion rows, removes geo rows no other user shares, and **anonymises** the
     request rows (creator id → `erased:<hash12>`, addresses nulled) so the fact that the
     request was fulfilled survives without the identity.
3. **Notification.** `POST /internal/telemetry/notify` on BCWEB sends the mail in the
   account's language (`to: { userId }` or `{ email }`); the outcome (`ok`, reason) is stored
   in the request's `result` and shown on the screen — "not mailed" is shown, not hidden.
4. **Audit.** `gdpr_export`, `gdpr_erase`, `data_request_create/reject` rows in `audit`
   (Storage › Audit), with the admin's IP + fingerprint when it was a dashboard action.

Both BCWEB endpoints are behind `x-link-secret`; see BCWEB
`guides/reference/API_Reference_EN.md` §33.

## Sampling

Percentages per element kind plus a total cap, edited on **Settings** (or from BCWEB) and
stored as `meta.sampling`:

```json
{ "total": 100, "events": 100, "replay": 25, "errors": 100, "perf": 50, "benchmarks": 100, "logs": 100 }
```

- Deterministic **per install and per kind**: `fnv1a32("{creator_id}:{kind}") % 10000 <
  pct * 100`. An install is fully in or fully out of a kind, so its data stays coherent
  instead of being a random 30 % of its events. The total cap applies first.
- Delivered in every `/batch` answer and on `GET /config`. BMM (`src-tauri/src/commands/
  analytics.rs`) stores the document and drops excluded events before queuing them; the
  server applies the same rule on ingest so an old client is trimmed to the same population.
- Kinds: `events` (default), `replay` (`$replay`), `errors` (`$error*`, crash…), `perf`
  (`perf`, web vitals), `benchmarks`, `logs` (`$log_js`, `$log_rust`). Mapping in
  `sampling::kind_of`, mirrored by `sampling_kind` in BMM. Reference FNV vectors are asserted
  on both sides.

## Replay player

`web/src/lib/replay-decode.ts` normalises any rrweb stream before it reaches the player:
sorted by timestamp (chunks arrive out of order), duplicates from overlapping chunks dropped,
everything before the first FullSnapshot trimmed (rrweb cannot paint mutations onto an empty
document — the black frame), and it reports `has_snapshot` so the screen says so instead.
It reads `.bmmreplay` files plain or gzip'd (header sniffed; `DecompressionStream`). The player
re-seeks after a hidden tab (rAF is paused there) and falls back to an interval ticker while
hidden; a `.bmmreplay` can be opened from disk on any session. BMM's recorder forces a full
snapshot when the telemetry stream subscribes, so new streams always start playable.

## Map

OpenStreetMap raster tiles, no key: standard OSM tiles in light, CARTO dark-matter (OSM data)
in dark, swapped with the theme; attribution control always visible. User points are a
clustered GeoJSON source (count bubbles; click to expand, click a point to open the user);
the Timeline tab keeps avatar markers with the scrubber; Countries shades a choropleth.

## Privacy

- **Opt-in only** — nothing is collected without consent.
- **Addresses are truncated before they are stored** — IPv4 to `/24`, IPv6 to `/48`
  (`server/src/anon.rs`). That is what goes into `user_ips`, into the `geo` cache key, into
  the stored `$identify` profile, into the live cards and into the admin audit trail. The
  exact address exists only in memory, for the length of one request, as the key of the
  ingest rate limiter — it is never written down. The LAN address a client used to report
  about itself (`private_ip`) is dropped at ingest.
- **Approximate geo only** — the lookup runs on the truncated address and the answer is
  stored rounded to one decimal degree (~11 km): country / region / city, never a precise
  location. The map rounds + jitters on top of that.
- **Right to erasure** — per packet (`/delete-request`) or per person (`/data-request`,
  kind `delete`), logged, confirmed by mail when a recipient is known.
- **Right to access** — one zip per person, see above.
- **Retention** — data older than `RETENTION_DAYS` (live-editable) is purged automatically:
  events, benchmarks and replay chunks, and — since `0011` — the side tables too
  (`user_ips`, `geo`, `live_instances`), which used to outlive by years the events they
  described. Erasing a packet also drops what is left of an install that now has no data.
- **Sampling** — reduces what is collected, never touches what is already stored.
