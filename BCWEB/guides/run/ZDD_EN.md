# Zero-downtime deploy — `infra/zdd.sh`

`infra/deploy.sh` is safe (backup, verify, roll back) and it is **down while it works**:
`docker compose up -d --build` stops the old api and web containers before the new ones
serve. On a quiet site that gap is seconds; during it, every request is a 502.

`infra/zdd.sh` closes the gap: for each user-facing service it **starts the new container
beside the old one**, waits until Docker calls it healthy, and only then retires the old one.
At no point does the site have zero serving containers.

```bash
infra/zdd.sh                # backup, pull, build, roll api+web, refresh the rest
infra/zdd.sh --no-pull      # deploy the working tree as it stands
infra/zdd.sh --no-backup    # you took a dump minutes ago
infra/zdd.sh --dry-run      # print the plan, change nothing
```

## Why the hand-over is invisible

Three pieces, and the script only works because all three are in place:

1. **Caddy resolves `api` and `web` dynamically** (10s DNS refresh) and **retries failed
   dials for 12s** (`lb_try_duration`, in `infra/caddy/Caddyfile`). During the overlap both
   containers serve; when the old one leaves DNS, any request that races the refresh window
   is retried against the survivor instead of answered 502. Dial failures only — a request
   the upstream *accepted* is never replayed, because replaying a non-idempotent write is
   worse than failing it.
2. **The API drains on SIGTERM** (`server.mjs`): `docker stop` lets in-flight requests
   finish, then closes the DB/Redis handles.
3. **Both services have healthchecks**, so "the new container serves" is a state the script
   can wait on — not a sleep and a hope. Rolled replicas land on arbitrary host ports (the
   api publishes a range), which is why the wait uses container health, not a port probe.

## The failure mode is the point

If a new container never becomes healthy, the **new** ones are removed and the **old ones
are still serving — they were never touched**. A failed deploy is a log line, not an outage.
(`deploy.sh` fails the other way round: broken first, then rolled back. Keep it for cold
starts and for the one case below.)

## What this demands of migrations — read before relying on it

The new api container runs its migrations at boot, **while the old code is still serving**.
So between two adjacent deploys, migrations must be **additive** (expand → migrate code →
contract): add the column now, drop or rename only in the deploy *after* the one that
stopped using it. A destructive migration makes the old containers throw during the overlap
— the downtime you were avoiding, moved into the database where it is worse.

**If a deploy must break the schema, use `deploy.sh` and accept the gap.**

## What rolls, what restarts, what is never touched

| Service | Treatment | Why |
| :--- | :--- | :--- |
| `api`, `web` | Rolled (new beside old) | A visitor is looking at these. API first: it runs the migrations, and web's new bundle may call routes only the new API has. |
| `bot`, `telemetry`, `provisioner` | Plain recreate | A bot reconnecting or a dashboard blinking is not an outage. |
| `caddy` | **`caddy reload`**, never restart | A restart *is* the outage. Reload applies a changed Caddyfile with no dropped connections; unchanged, it is a no-op. |
| `db`, `redis`, `minio` | Never touched | Stateful. Rolling them needs a failover story this stack does not have and should not pretend to. |

## Knobs

| Env | Default | Meaning |
| :--- | :--- | :--- |
| `HEALTH_TIMEOUT` | 180 | Seconds to wait for a new container before giving up (and keeping the old ones). |
| `DRAIN_GRACE` | 30 | Seconds `docker stop` waits for the drain before SIGKILL. |
