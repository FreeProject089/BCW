# BCWEB — Backup & Restore

Everything stateful in BCWEB lives in **three places**: the Postgres database, the MinIO
object store (uploads / blog media / hosted repo files), and the tamper-evident audit
anchor. `infra/backup/backup.sh` captures all three; this guide covers running it, storing
copies off-site, and — most importantly — **restoring**.

## What gets backed up

| Source | How | File |
|---|---|---|
| **Postgres** (all app data) | `pg_dump` logical dump (consistent, safe on a live DB) → gzip | `pg-bcweb-<ts>.sql.gz` |
| **MinIO** object storage | tar of the `<project>_minio-data` Docker volume | `minio-<ts>.tar.gz` |
| **Audit anchor** (HMAC chain root) | tar of the `<project>_audit-anchor` volume | `audit-anchor-<ts>.tar.gz` |

> Postgres is dumped with `pg_dump`, **not** by tarring the db volume under a running
> server — a live file copy is inconsistent and can restore to a corrupt state.

## Running it

```bash
# One-off, default target (/var/backups/bcweb):
infra/backup/backup.sh

# Custom target:
BACKUP_DIR=/mnt/backups infra/backup/backup.sh
```

Config via env (defaults in the script): `BACKUP_DIR`, `RETENTION_DAYS` (default 14 — local
backups older than this are pruned), `POSTGRES_USER`/`POSTGRES_DB` (default `bcweb`),
`COMPOSE_DIR`, `COMPOSE_PROJECT_NAME` (volume-name prefix).

## Schedule it (cron on the VPS)

```cron
# Daily at 03:30, appending to a log:
30 3 * * * BACKUP_DIR=/mnt/backups /opt/bcweb/BCW/BCWEB/infra/backup/backup.sh >> /var/log/bcweb-backup.log 2>&1
```

## Off-site copy (strongly recommended)

A backup on the same box is not a backup. Point `BACKUP_REMOTE` at an [rclone](https://rclone.org)
remote (configure once with `rclone config` — Backblaze B2 / S3 / Cloudflare R2 / Google
Drive all work):

```bash
BACKUP_REMOTE=b2:my-bucket/bcweb infra/backup/backup.sh
```

The script runs `rclone copy "$BACKUP_DIR" "$BACKUP_REMOTE"` after each backup. Give the
remote its own **lifecycle/versioning** (e.g. keep 30–90 days) so a bad local run can't
delete your off-site history.

## Encrypting the dump (recommended before any off-site copy)

`pg_dump` writes **the whole database in cleartext** — every address, every profile, every
session. rclone then copies that to a bucket somebody else operates. Encrypt it first:

```bash
# age (simplest). Generate the key OFF the server, keep the private half off it too.
age-keygen -o backup.key            # do this on your own machine
grep 'public key' backup.key        # -> age1...
BACKUP_AGE_RECIPIENT=age1... infra/backup/backup.sh

# or gpg, if that is what you already run
BACKUP_GPG_RECIPIENT=you@example.com infra/backup/backup.sh
```

A **public** key on purpose. A passphrase would have to live on the machine taking the
backups, which means the machine most likely to be compromised is the one that can read every
backup it ever took. With a recipient key the server can only write; reading needs the private
half, which never touches it.

If the tool named is missing the script **stops** rather than writing plaintext under a name
that says otherwise. Restore with `age -d -i backup.key pg-*.sql.gz.age | gunzip | psql …`
(or `gpg -d`).

## What an erasure request reaches, and what it does not

Two different things are called "backup" here, and only one of them can be erased:

| | What it is | Erasure |
|---|---|---|
| **Row & file history** (in the app, Advanced server) | A snapshot of a row before each edit, git-committed | **Yes.** Each user's snapshots are encrypted with their own key; erasing the account destroys the key, so their snapshots become unreadable — including in copies already synced elsewhere — while everybody else's still restore. |
| **`backup.sh` dumps** | A full `pg_dump` for disaster recovery | **No.** A dump is a frozen copy of the whole database; a user erased today is still in yesterday's dump. |

That second row is not a defect to hide, it is how dumps work — and the accepted answer is
not to rewrite them. It is:

1. **A short, documented retention window.** `RETENTION_DAYS` (14 by default) is how long an
   erased person can still be in a dump. Say that number in your privacy policy.
2. **Replay erasures after any restore.** A dump older than an erasure brings the person
   back. Before the stack serves traffic again, re-run the erasures recorded since the dump
   was taken — the audit log has them (`user.erased`).

Restoring an old dump without step 2 undoes every erasure made since it was taken. Put it in
the restore runbook, not in somebody's memory.

## Restore

Run from `infra/compose/` (where `docker compose` sees the stack). **Restoring overwrites
current data — take a fresh backup first if the data still matters.**

### 1. Postgres

```bash
cd infra/compose
# (optional) drop & recreate a clean schema first if restoring into a dirty DB:
#   docker compose exec -T db psql -U bcweb -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
gunzip -c /var/backups/bcweb/pg-bcweb-<ts>.sql.gz | docker compose exec -T db psql -U bcweb bcweb
```

The API applies the checked-in migrations at boot (`boot-migrate.mjs` → `prisma migrate
deploy`), so the schema self-heals — but the dump already contains it, so a plain restore is
enough. Restart the api after restoring: `docker compose restart api`.

### 2. MinIO object storage

```bash
cd infra/compose
docker compose stop api web            # avoid writes during restore
# Wipe + repopulate the volume from the archive:
docker run --rm -v bcweb_minio-data:/data -v /var/backups/bcweb:/backup alpine \
  sh -c 'rm -rf /data/* && tar xzf /backup/minio-<ts>.tar.gz -C /data'
docker compose start api web
```

(Replace `bcweb_` with your `COMPOSE_PROJECT_NAME` prefix if different.)

### 3. Audit anchor (only if you also restored the DB from the same point)

```bash
docker run --rm -v bcweb_audit-anchor:/data -v /var/backups/bcweb:/backup alpine \
  sh -c 'rm -rf /data/* && tar xzf /backup/audit-anchor-<ts>.tar.gz -C /data'
```

Keep the DB and audit-anchor from the **same** backup run so the audit HMAC chain still
verifies (`/admin/security` → verify chain).

## The in-app backups are a different thing

Advanced server management has two of its own tools, and neither **replaces** anything
above. Three things are called "backup" here; confusing them is the dangerous mistake, so
plainly:

| | `infra/backup/backup.sh` | In-app snapshots | Content export |
|---|---|---|---|
| Postgres data (accounts, repos, catalogs, payments) | **Yes** | No | Partly — as readable JSON, see below |
| MinIO objects (uploaded files, hosted repo bytes) | **Yes** | No | No |
| Edit history of files touched through the file manager | No | **Yes** | No |
| Edit history of DB rows touched through the DB viewer | No | **Yes** | No |
| Can be restored back into BCWEB | **Yes** | **Yes** | **No** — it is an export, not a restore point |
| Readable without BCWEB | No | No | **Yes** — plain JSON in a zip |
| Survives losing the machine | Yes, once copied off-site | Only if downloaded | Only if downloaded |

### Content export

"Advanced server management → Content export" downloads the **written** content — docs,
blog, FAQ, legal versions, site settings, reviews and account records — as one JSON file per
section inside a zip. Each section shows its row count before you download, so you take a
choice rather than a guess.

It exists for the questions the other two answer badly: *what did that page say last month*,
*I am moving to another install*, *I want to read what is in there without a database*.

Three things about it are deliberate and worth knowing before you rely on it:

- **It is not a restore point.** Nothing reads a content export back in. For "the server is
  gone", use the script at the top of this page.
- **Accounts are records only** — id, email, display name, role, status, bio, avatar. No
  password hashes, no 2FA secrets, no tokens. That is what makes the zip safe to keep on a
  laptop, and it is why restoring people means re-inviting them.
- **Catalogues and repositories are off by default.** Their rows are metadata pointing at
  files in MinIO that the zip does not contain. On by default, the archive would look more
  complete than it is — which is a backup's worst failure, because you find out when you
  need it.

An in-app snapshot is a **git bundle of that edit history**, frozen with its size, a
sha256, and an Ed25519 signature. It answers "put that file back". It does not answer "the
server is gone" — that is what the script above is for.

### Taking, keeping, reading

- **Back up now** takes one immediately (files, DB rows, or both). The file history is
  refreshed first, so the snapshot includes changes made moments earlier.
- **Keep N** rotates per kind — ten daily file snapshots cannot evict every DB snapshot
  from a shared budget. `0` disables rotation entirely and means it: nothing is deleted.
- The daily sweeper takes one and rotates too, so the retention is a policy rather than a
  reminder to press a button.
- **Inspect** runs `git bundle verify` and lists the tip commits, and separately checks the
  recorded sha256 against the file on disk. The two answer different questions: git says
  the file is a coherent bundle, the digest says it is the file *we* wrote.
- **Import** accepts a `.bundle` taken off this box or from another server. It is verified
  before it is stored, so the list never holds something that cannot be restored.

### Rolling back

Only from the inspector, and only after typing `CONFIRM`. A safety snapshot of the current
state is taken first and the rollback is **refused** if that fails — a rollback with no way
back is a restore performed hopefully.

Ticking "also write these files over the live application directory" is the irreversible
half. It copies the restored tree **over** what is there; it does not remove files created
since, because that directory is the running application and deleting unknown paths deletes
uploads and caches. Anything left over is listed afterwards, so the result is a merge you
can see rather than a rollback you assumed.

## Verify your backups

A backup you've never restored is a hope, not a plan. Periodically: spin up a throwaway
Postgres, restore the latest `pg-*.sql.gz` into it, and confirm row counts look sane.
`gzip -t pg-*.sql.gz` at least checks the archive isn't truncated.

## Checklist

- [ ] `backup.sh` scheduled in cron.
- [ ] `BACKUP_REMOTE` set → off-site copies land.
- [ ] Off-site bucket has versioning/lifecycle.
- [ ] A restore has been tested at least once.
- [ ] Retention (`RETENTION_DAYS`) matches your recovery-window needs.
