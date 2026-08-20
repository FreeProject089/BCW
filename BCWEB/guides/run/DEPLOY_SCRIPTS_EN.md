# The deploy scripts — which one, and when

*🇫🇷 [Version française](DEPLOY_SCRIPTS_FR.md).*

Four scripts in `infra/`. They do different things and are not interchangeable; picking the
wrong one costs you either time or a database.

## The cheat sheet

```bash
infra/bootstrap.sh      # FIRST time on a fresh machine
infra/deploy.sh         # normal update — backs up, rolls back on its own
infra/deploy-fast.sh    # small update — rebuilds only what changed
infra/rollback.sh       # go back deliberately, after the fact
```

Every one of them takes `--dry-run`, which prints each step and changes nothing. It is safe to
run right now, production included, and it is the best way to find out what a script will do
before it does it.

| Your situation | The script |
|---|---|
| Fresh machine, nothing installed | `bootstrap.sh` |
| You pushed code and want it live | `deploy.sh` |
| A copy fix, some CSS, nothing touching the database | `deploy-fast.sh` |
| The deploy succeeded but something is broken | `rollback.sh` |
| The deploy never came up | nothing to do — `deploy.sh` already rolled back |

---

## Fast deploy and fast update

This is the part you type most often.

**Normal update** — the default, and the one to use when unsure:

```bash
infra/deploy.sh
```

It backs up, pulls, rebuilds, **waits for `/ready` to actually answer**, and puts the previous
commit back if the site never comes up. Budget two to three minutes.

**Fast update** — for a change that does not touch the database:

```bash
infra/deploy-fast.sh
```

It reads the `git diff` between the old and new commit and **rebuilds only the services whose
sources moved**. A change under `apps/web` never rebuilds the API image. It skips the dump —
and **refuses to run** if the update contains a migration, because that is precisely the case
where the dump is the only way back. It still waits on `/ready`: "fast" is worth nothing if it
hides a site that did not start.

If nothing under `apps/` or `packages/` changed, it says so and rebuilds nothing at all.

!!! warning "`deploy-fast.sh` does not roll back"
    That is what makes it fast. If it fails, run `infra/rollback.sh`.

---

## `bootstrap.sh` — the first time

```bash
infra/bootstrap.sh
```

This is not `deploy.sh`. `deploy.sh` updates an install that already exists: the first time
there is nothing to back up, nothing to pull, and nothing to roll back to. What the first time
needs instead is the part everybody gets wrong: **real secrets, before anything starts**.

`.env.example` is committed to a public repo, placeholders and all. Copy it, start the stack,
and you are running on a `JWT_SECRET` anyone reading the repo already knows — which means
anyone can forge an admin session. The API refuses to start in production in that state, so the
usual first experience is a container that will not boot, with an error nobody expects during
an install.

Three of those secrets ship **commented out** in `.env.example` (`#BOT_SHARED_SECRET=`), so the
code falls back to values from the repository with nothing reporting it. The script uncomments
and fills them, then **verifies** the four that matter carry a value before going on.

`POSTGRES_PASSWORD` has a second reason to be handled here: Postgres reads it only when it
initialises its data volume, on the very first start. Change it afterwards and `.env` and the
database disagree forever, the only cure being to delete the volume.

The script then starts the stack, waits for `/ready` (migrations run at boot, so that wait
covers the schema being created), and seeds.

It **refuses to run if `infra/compose/.env` already exists** — overwriting it would change the
Postgres password without changing the database.

```bash
infra/bootstrap.sh --no-seed    # start it, leave the database empty
```

!!! danger "The admin account"
    Set `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` in `.env` **before** the seed step, or the
    account is created as `admin@bettercommunity.local` / `change-me-now`. The seed is
    idempotent and only creates the account when none exists, so re-running never resets a
    password you have since changed.

What `bootstrap.sh` cannot do for you: the domain (six values on `localhost` — see
[DOMAIN_SETUP_EN.md](DOMAIN_SETUP_EN.md)) and backups ([BACKUP_EN.md](BACKUP_EN.md)). It
reminds you of both at the end.

---

## `deploy.sh` — the normal update

```bash
infra/deploy.sh
infra/deploy.sh --dry-run       # print everything, change nothing
infra/deploy.sh --no-backup     # skip the dump (you took one two minutes ago)
infra/deploy.sh --no-rollback   # leave the broken version up so you can look at it
```

Three things around `git pull && docker compose up -d --build`, and nothing else:

1. **A dump first.** Migrations run at container boot and do not run backwards. Going back to
   the previous commit restores the code and leaves the schema where it is, so the dump taken
   beforehand is the only thing that can undo a bad migration.
2. **A wait on `/ready`.** That endpoint returns 503 until the API can reach the database, so
   "the container started" and "the site works" are not confused with each other.
3. **An automatic rollback of the CODE** if the probe never goes green.

It refuses to start with uncommitted changes in the tree, because the rollback is a
`git reset --hard` and would take them with it.

It does **not** restore the database automatically — a rollback that rewrites data can destroy
work committed between the dump and the failure. The dump's path is printed; restoring it is
your call.

---

## `rollback.sh` — going back after the fact

```bash
infra/rollback.sh               # back one commit
infra/rollback.sh <commit>      # back to a specific commit
infra/rollback.sh --dry-run
```

`deploy.sh` already rolls back on its own when a deploy never becomes ready. This is for the
other case, the more common one: the deploy **succeeded**, the site came up fine, and twenty
minutes later somebody notices what it broke. Nothing fires automatically then, because nothing
failed.

It prints the commits it is undoing, the command to undo the rollback itself, and — **before**
acting, while it can still be cancelled — a warning if the range contains a migration. In that
case the schema stays as it is now and the old code runs against it: usually fine, occasionally
not, and no script can tell the difference.

---

## What none of these scripts do

None of them restores the database. That is deliberate and it applies to all four: a restore
discards whatever was written since the dump, and only a human can say whether that is
acceptable. The procedure is in [BACKUP_EN.md](BACKUP_EN.md).

And a backup you have never restored is a hypothesis, not a backup. Try it once on a throwaway
machine, before you need it.
