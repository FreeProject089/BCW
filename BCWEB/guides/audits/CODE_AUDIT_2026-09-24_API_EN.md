# Code audit, API / bot / infra — Sept 24 2026

Companion to the security section "Full audit, Sept 24 2026 (API, bot, infra)" in
`SECURITY_AUDIT.md`. This file covers what was changed for code quality, and what is left to do
for simplicity, performance and maintainability, with the evidence for each. Priority order used
throughout: security > reliability > simplicity > performance > maintainability. No functional
choice was changed.

## Changed in this audit

### One answer to "who is this request?" (`lib/lib.mjs`, `sessionUser`)

The rule "a session is a verified token WITH a live `Session` row, an account that is not banned,
and the role the database says now" existed once inside `authenticated()` (the four guards), was
re-typed in `optionalAuth()` with one difference (it kept the token's stale role and no `perms`),
and was missing entirely from two routes that verified the cookie themselves. That is the
security finding S-1; the code-quality half is that there are now two functions, not four
spellings:

- `authenticated(req, reply)` — the strict guards, which answer 401/403 themselves;
- `sessionUser(req)` — everything else (soft auth, login-optional pages, forward-auth), which
  returns the user or `null`.

`optionalAuth()` shrank from a hand-copied chain to one call. A gate in
`test/session-side-doors.test.mjs` fails if a file other than `lib.mjs` (and the two refuse-only
hooks, `verify-gate.mjs` and the per-account limiter in `server.mjs`) both names `bcw_session`
and calls `verify(`.

### A storage key is derived, not echoed (`routes/hosting-content.mjs`, `registerRepoFile`)

The key was computed in `presignRepoFile`, sent to the client, and trusted when it came back.
It is now computed where it is stored, from the same two inputs. One source for the key, and the
catalogue path's existing rule (`uploads/<uid>/`) and the repo path no longer disagree about
whether a client may name an object.

### Test fixture hygiene (`test/repo-file-key-confinement.test.mjs`)

Found by the full run, and worth generalising (see "Tests" below): a fixture that creates a
repo with the schema's default `listed: true` and registers a file notifies every MOD/ADMIN on
the database. Under `node --test`'s parallel files that wrote `Notification` rows onto other
files' staff fixtures, and three unrelated files went red at cleanup. The fixture creates
unlisted repos now. Proved both ways (default → 3 red with `Notification_userId_fkey`, twice;
unlisted → 0).

## Left to do, with the evidence

### Maintainability: two rules copied a dozen times

| Rule | Copies | Agree today? | Risk |
|---|---|---|---|
| Real client IP = LAST `X-Forwarded-For` entry | **12** (`server.mjs`, `lib/lib.mjs`, `lib/abuse.mjs`, `lib/geo.mjs`, `lib/siteban.mjs`, `routes/access-policy.mjs`, `auth.mjs`, `feedback.mjs`, `hosting-content.mjs`, `links.mjs`, `misc.mjs`, `server-control.mjs`) | Yes, all twelve take `parts[parts.length - 1]` (checked) | A thirteenth copy written as `[0]` is client-spoofable, and would move rate limits, bans, geo and the audit trail's IP |
| `JWT_SECRET` with the literal dev fallback | **11** files | Yes | Only the boot guard stops production from running on the literal; a new file that forgets the env name would silently sign with the fallback in dev and nothing else would notice |

Recommendation: import `clientIp` from `lib/lib.mjs` everywhere (one line per file; the
per-account limiter in `server.mjs` can import it too), and export the secret from one module.
Then a gate like the `bcw_session` one: no `x-forwarded-for` read outside `lib.mjs`. Not done
here: twelve files, most of them owned by features other agents are editing this week, and the
copies are correct today.

### Performance: whole file tables loaded to serve one file (not measured, by reading)

- `GET /hosting/:owner/:repo/files/*` (`routes/hosting-content.mjs`) loads the repo with
  `include: { files: true }` and then `repo.files.find((f) => f.path === rel)` in JavaScript. A
  BMM sync downloads a repo file by file, so a sync of an N-file repo reads N² rows. The
  `(serverRepoId, path)` unique index already exists (`serverRepoId_path`, used by the upsert):
  `repoFile.findUnique` for the file path, and the full list only for a directory listing, would
  make each download one indexed row.
- `resolve()` in `routes/repo-dashboard.mjs` loads every file for EVERY dashboard route,
  including `activity`, `history` and `traffic`, which never read them. An option to skip the
  include there costs one flag.
- `presignRepoFile` sums `repo.files` in memory for the quota check where
  `storageUsedBytes` (kept by `recomputeUsage`) or one `aggregate` would do.

None of these was measured; they are listed in the order a profiler would likely rank them. The
first is on the hottest public path the API has.

### Simplicity: the two very large route files

`routes/misc.mjs` (4262 lines) and `routes/bot.mjs` (3164 lines) are each several features side by
side, already separated by section comments. The earlier audits show what that costs: the Sept 9
capability refactor converted guards file by file and missed the economy routes because
`bot.mjs` "is not one section" (P-1). Splitting along the existing section comments into files
per feature (as `economy-admin.mjs`, `server-perf.mjs` already are) is mechanical and changes no
behaviour, but it touches the two files every other agent edits, so it was not done during a
week of parallel work. Do it in a quiet window, one section per commit, with the full suite and
`check-capabilities` after each.

### Tests

- **Cleanup that deletes users should delete their `Notification` rows first.** At least
  `economy-history-admin`, `project-catalogs` and `project-content` do not, so any staff-wide
  notification from a neighbouring file (review queue, rights match, `notifyAll`) turns them red.
  A shared helper (`test/fixtures.mjs`: `deleteUsers(p, ids)` removing `Notification`,
  `AuditLogEntry`, `Session`, then the users) would remove the whole class.
- **Run the suite as CI does and also with `--test-concurrency=1`** when a new DB-backed test
  lands: 2245/2245 both ways today (parallel ~25 s, serial 124 s). A test that is green in one
  mode and red in the other is interacting with a neighbour.

## Verification

`apps/api` `npm test` (Postgres, no Redis) on a fresh `bcweb_audit`: 2245/2245, 0 skipped;
`--test-concurrency=1`: 2245/2245. `apps/bot` `npm test`: 212/212. `npm audit --omit=dev`: 0 in
`apps/api` and `apps/bot`. `prisma migrate diff --exit-code`: no difference. `node --check` on
every changed module. Nothing committed.
