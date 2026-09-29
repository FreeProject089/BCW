# BCWEB — CI/CD: every workflow (EN)

> 🇫🇷 Version française : [CI_CD_FR.md](CI_CD_FR.md)

Everything GitHub Actions runs for this repository, in one place: what starts each workflow,
what it checks, what makes it fail, what it leaves behind, what it needs configured, and how
to run the same thing on your machine. The workflows live in `BCW/.github/workflows/`.
The security scans have their own detailed guide: [SECURITY_CI_EN.md](SECURITY_CI_EN.md).

| Workflow | File | Starts on | Fails when |
|---|---|---|---|
| **BCWEB CI** | `ci.yml` | push / pull request touching `BCWEB/**` or `.github/**` | a build, lint, test, schema, Caddyfile, secret or dependency check fails |
| **BCWEB security** | `security.yml` | same, + Mondays 03:17 UTC, + by hand | the security gate finds something at or above the threshold (default HIGH) in Gitleaks, Semgrep or Trivy |
| **BCWEB DAST** | `dast.yml` | pull requests touching the API, web, packages, Caddy or the DAST files; Tuesdays 04:41 UTC; by hand | the gate finds something at or above the threshold in ZAP or Nuclei, or the scan could not run properly |
| **BCWEB deploy (production)** | `deploy.yml` | by hand on `master`, or after a green **BCWEB CI** on `master` when `CD_AUTO_DEPLOY` = `true` | **BCWEB security** has not passed for that commit (after waiting up to 20 min), or the SSH deploy through the server's gate fails |
| **Publish B.MD** | `publish-bmd.yml` | a tag `bmd-v<version>`, or by hand (verify only unless *publish* is ticked) | the tag and the two package versions disagree, a B.MD gate fails, the tarball does not install and render with npm and pnpm, `publint` / `arethetypeswrong` / `npm audit` object, or npm refuses the publish |

Every job asks for its own permissions and nothing else (`contents: read` almost everywhere);
the only jobs that may write are named below. Every action is pinned by commit SHA, every
scanner image by tag and digest.

---

## BCWEB CI (`ci.yml`)

The build and correctness net. No infrastructure needed; checks run against the source with
dummy values.

| Job | What it checks |
|---|---|
| Web build (vite) | `npm ci`, `npm run lint`, `npm run i18n:check`, `npm run css:check`, `npm run legal:check`, `npm run build`, `npm run budget` in `apps/web` |
| API syntax + Prisma + billing tests | `node --check` on every API module, env vars documented, the guides' claims (`guides/check-claims.mjs`), seeded links, the markdown guide, `prisma validate`, `migrate deploy` on a throw-away Postgres, the migration drift check, `npm test` |
| Native addon (Rust) | `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`, the addon builds and loads, native-path tests |
| Caddyfile | `caddy validate` with the image the stack runs, and `infra/caddy/site.mjs selftest` |
| Secret scan | `.github/scripts/secret-scan.mjs` (self-test, then every tracked file, `*.example` included) |
| npm audit / cargo audit | `.github/scripts/dep-audit.mjs`, high and critical fail unless explained in `.github/audit-ignore.json` |

- **Gate:** any failing step. **Artifacts:** none. **Variables / secrets:** none.
- **Locally:** the same commands, from the folder each job uses. Match the API tests to CI:
  `DATABASE_URL` pointing at a throw-away Postgres, no `REDIS_URL`, and the API stopped.

---

## BCWEB security (`security.yml`)

| Job | Tool | Blocks by default on | Artifact |
|---|---|---|---|
| Security gate + DAST scope (self-tests) | node --test | a broken gate, scope check or deploy verdict (`security-verdict.mjs`) | — |
| Secrets in git history | Gitleaks | any unreviewed secret (push/PR: its commits; schedule/manual: all history) | `security-gitleaks` |
| SAST | Semgrep (pinned rules) | ERROR | `security-semgrep` |
| Dependencies + Dockerfiles | Trivy fs | HIGH / CRITICAL | `security-trivy-fs` |
| Container image (×5) | Trivy image | HIGH / CRITICAL | `security-trivy-image-<name>` |
| Code scanning upload (×7) | upload-sarif | a SARIF that GitHub rejects | — |
| Gate table on the pull request | gh api | never (a notice when it cannot post) | — |

- **Write permissions:** `Code scanning upload` has `security-events: write`; `Gate table on
  the pull request` has `pull-requests: write`. Nothing else writes.
- **Artifacts** (14 days): each report as JSON, its SARIF, `<tool>-summary.md` and
  `gate-<tool>.json` (the verdict the PR comment is built from).
- **Locally:** every command is in [SECURITY_CI_EN.md](SECURITY_CI_EN.md#2-each-scan-and-how-to-run-it-by-hand).

## BCWEB DAST (`dast.yml`)

| Job | What | Artifact |
|---|---|---|
| DAST on a CI-local instance | starts Postgres + the API (production mode, throw-away secrets) + the built web behind the repository's Caddyfile inside the runner, then ZAP baseline and Nuclei | `dast-local` |
| DAST on staging | the same scans against `DAST_STAGING_URL`, only by hand or on the schedule, only if allowlisted | `dast-staging` |
| Code scanning upload (×4) | ZAP and Nuclei SARIF, categories `dast-zap-local`, `dast-nuclei-local`, `dast-zap-staging`, `dast-nuclei-staging` | — |
| DAST table on the pull request | the gate table, its own sticky comment | — |

- **Gate:** ZAP and Nuclei findings at or above the threshold, or a scan that did not run
  properly (scope refused, Nuclei loaded no templates or dropped the target, the instance
  stopped answering or blocked the scanners).
- **Production is never a target** — hard-coded refusal of bettercommunity.ch and the
  production server's address, firewall rules, and a DNS sinkhole, all before the first request
  ([SECURITY_CI_EN.md](SECURITY_CI_EN.md#3-the-ci-local-instance-and-testing-without-touching-production)).
- **Artifacts** (14 days): `zap.json`, `zap.html`, `zap.md`, `zap.sarif.json`, `nuclei.jsonl`,
  `nuclei.sarif`, the logs of the API, the edge and nginx, and the gate summaries.

---

## BCWEB deploy (`deploy.yml`) — the CD

Deploys the tip of `master` to the production VPS through **one forced SSH command**:

1. The runner connects with the key in `DEPLOY_SSH_KEY`. On the server that key is pinned in
   `authorized_keys` with `restrict,command=".../deploy-gate.sh"`: whatever the runner asks,
   sshd runs `infra/deploy-gate.sh` (installed outside the repository, so a commit cannot
   rewrite the gate that deploys it).
2. The gate accepts only `status` and `deploy <sha>` (with `--dry-run`), and only when `<sha>`
   is the **current tip of `origin/master`**, fetched by the server itself — an old or
   branch-only commit cannot be pushed to production with that key.
3. It then runs `infra/deploy.sh` (backup, pull, build, wait for `/ready`, roll the code back
   if it never comes up), then the job asks for `status` and keeps the log.

**Before any of that**, before the deploy key is even written to the runner's disk, the job
checks that **BCWEB security** passed for the very commit it deploys:

- it lists the workflow runs of that commit through the API (`gh api`, with the job's own
  token and read-only `actions: read` / `checks: read`, granted to that job only) and hands
  them to `.github/scripts/security-verdict.mjs`;
- a run named *BCWEB security*, for that exact SHA, from a `push`, `workflow_dispatch` or
  `schedule` event, concluded `success` → the deploy goes on. A `pull_request` run does not
  count: it tested the merge of a branch, not this commit;
- no such run yet, or one queued / in progress → it asks again every 30 seconds, for up to
  **20 minutes**, then fails with "no successful BCWEB security run for it after 20 minutes";
- every run for the commit finished and none succeeded (failure, cancelled, timed out) → it
  fails at once. Fix the findings (or re-run the workflow if it was a flake) and deploy again.

**DAST stays advisory for the deploy.** *BCWEB DAST* does not run on the push to `master` (it
runs on pull requests, weekly and by hand), it needs ten minutes and a whole running instance,
and what it judges is the headers and behaviour of the site rather than one commit's code.
Waiting for it would mean either no automatic deploy at all or a deploy gated on last
Tuesday's scan. Its findings are read on the pull request and in the weekly run.
4. **Kill switch:** while `/srv/BetterCommunity/deploy-gate.disabled` exists on the server,
   every deploy is refused (status still answers).

- **Triggers:** Actions → *BCWEB deploy (production)* → Run workflow on `master` (a dry run is
  available); or automatically after a green *BCWEB CI* on a push to `master`, only if the
  variable `CD_AUTO_DEPLOY` is exactly `true`. Both go through the `production` environment:
  add required reviewers there to make every deploy wait for an approval.
- **Gate:** a green *BCWEB security* run for the commit (above), then the SSH command's exit
  code. Starting after a green *BCWEB CI* is the trigger; the security wait is a step.
- **Artifact:** `deploy-log-<run id>`, 90 days.
- **Locally:** `ssh -i <key> -p <port> <user>@<host> status` (or `deploy <sha> --dry-run`);
  the server side is described in [DEPLOY_EN.md](DEPLOY_EN.md), section 9, "From GitHub (CD)".

---

## Publishing B.MD (`publish-bmd.yml`)

Publishes **`@bettercommunity/bmd`** and **`@bettercommunity/bmd-editor`** (versioned together)
to the npm registry. pnpm, yarn and bun install from that same registry, so there is no second
publish "for pnpm"; what matters for pnpm is that the package installs under its strict
`node_modules`, and the workflow proves that on every release.

| Job | Permissions | What it does |
|---|---|---|
| Build, test, pack (npm + pnpm) | `contents: read`, no secret | tag = version check, `npm ci` in `apps/web`, the B.MD gates (lint, `check-md-*`, registry and URL-policy tests, README table), builds `dist/` (`packages/bmd/scripts/build.mjs`), `check-bmd-publish`, then `packages/bmd/scripts/smoke.mjs`: packs both packages, installs the tarballs with **npm and pnpm**, imports every export, server-renders every directive example, compiles a TypeScript consumer, `npm audit`; again on React 18; then `publint` and `arethetypeswrong` on the tarballs, uploaded as the artifact `bmd-tarballs` |
| npm publish (provenance) | `contents: read`, `id-token: write`, environment `npm` | downloads those tarballs and runs `npm publish <tarball> --provenance --access public` (renderer first, then editor); a version already on npm is skipped, a pre-release goes to the `next` dist-tag. No checkout, no package script runs next to the credentials |

**Token or trusted publishing.** The job is written for **npm trusted publishing** (OIDC): npm
exchanges the run's GitHub identity for a one-time publish credential, nothing long-lived is
stored anywhere, and provenance is attached automatically. It is the steady state. A trusted
publisher can only be added to a package that already exists on npm, so the **first** release
goes through a token (`NPM_TOKEN`, a secret of the `npm` environment). npm tries OIDC first and
falls back to that token, so the same job serves both; delete the secret once the trusted
publishers are set. Provenance needs a public repository, which `FreeProject089/BCW` is, and a
`repository.url` in each `package.json` that names it (checked by npm at publish time).

### Status: 3.1.0 is published (2026-09-29)

**`@bettercommunity/bmd@3.1.0`** and **`@bettercommunity/bmd-editor@3.1.0`** were published on
**2026-09-29** by this workflow, through `NPM_TOKEN`, **with provenance** (the npm page of each
package shows the workflow run and the commit it was built from). Steps 1 to 4 below are done;
**step 5 is the one left**. The site says so too: `/dev/bmd`, `/dev/editor` and the B.MD card
on `/dev` show a "Published on npm" block whose versions are read from each `package.json` at
build time (`apps/web/src/ui/bmd-npm.jsx`), never fetched from the registry by the browser.

**What the first release taught:**

- **The token must be "Read and write"** on the packages, with *bypass two-factor
  authentication* ticked. A token limited to **"stage only"** (staged publishing) is refused
  for a direct `npm publish`, and a token without the 2FA bypass cannot publish from CI, which
  cannot answer an OTP prompt.
- **`./tarballs`, not `tarballs`.** The first run failed on a path: npm reads a bare
  `tarballs/x.tgz` as a GitHub `owner/repo` shorthand and tried `git ls-remote
  ssh://git@github.com/tarballs/...`. The publish loop now passes `./tarballs/*.tgz` (commit
  08478530); keep the `./` if you ever touch that loop.
- A re-run is safe: a version already on npm is skipped, so a half-finished release completes.

**Next steps:** configure the npm **Trusted Publisher** on **both** packages (step 5), then
**delete the `NPM_TOKEN` secret** of the `npm` environment and revoke the token on npmjs.com.
From then on a release is only step 4, and no long-lived credential exists.

### What the owner does, once

1. **The npm scope.** On npmjs.com, signed in: *Add Organization* → name **`bettercommunity`**
   (the free plan is enough for public packages). The scope did not exist on 2026-09-26.
   Turn on two-factor authentication for the account if it is not already.
2. **The first-release token.** Account → *Access Tokens* → *Generate New Token* →
   *Granular Access Token*: packages and scopes **read and write**, limited to the
   `@bettercommunity` scope (or "all packages" of the org), expiry 7 days, and tick *bypass
   two-factor authentication* (a CI run cannot answer a 2FA prompt). **Not "stage only"**:
   that permission cannot publish directly (learned on the 3.1.0 release).
3. **The GitHub environment.** Repository → Settings → Environments → *New environment*
   **`npm`**. Optionally add yourself as a required reviewer: every publish then waits for a
   click. Add the secret **`NPM_TOKEN`** there with the token from step 2.
4. **Release.** Both `package.json` files already say `3.1.0` and the changelog has its
   section. Push the tag: `git tag bmd-v3.1.0` then `git push origin bmd-v3.1.0`. Watch
   *Actions → Publish B.MD*; the summary lists what was published.
5. **Switch to trusted publishing** (after the first release): on npmjs.com, each package →
   *Settings* → *Trusted Publisher* → GitHub Actions: owner `FreeProject089`, repository
   `BCW`, workflow `publish-bmd.yml`, environment `npm`. Do it for both packages, then delete
   the `NPM_TOKEN` secret and revoke the token. Optionally set *Require two-factor
   authentication and disallow tokens* on both packages: from then on only this workflow can
   publish them.

Every later release is step 4 with the new version: bump both `package.json` files, cut the
`## <version>` section in `packages/bmd/CHANGELOG.md`, push `bmd-v<version>`.

**By hand, without CI** (not recommended; no verification runs): `npm pack` then
`npm publish <tarball> --access public --provenance=false` from `packages/bmd`, then from
`packages/bmd-editor`. `--provenance=false` is needed because `publishConfig.provenance` is on
and provenance can only be generated inside CI.

- **Locally, the same checks:** in `apps/web` after `npm ci`, `node ../../packages/bmd/scripts/build.mjs`,
  `node scripts/check-bmd-publish.mjs`, then
  `node ../../packages/bmd/scripts/smoke.mjs --clients npm,pnpm --types --audit` (needs the
  network and pnpm on the PATH).
- **Artifact:** `bmd-tarballs`, 14 days.

---

## Variables and secrets to configure

Settings → Secrets and variables → Actions.

| Name | Kind | Used by | Default / meaning |
|---|---|---|---|
| `SECURITY_GATE_SEVERITY` | variable | security, DAST | `high`; `critical` / `high` / `medium` / `low` = the lowest severity that fails |
| `SECURITY_GATE_SEVERITY_SEMGREP`, `_TRIVY`, `_ZAP`, `_NUCLEI` | variable | security, DAST | unset; per-tool override |
| `DAST_STAGING_URL` | variable | DAST | unset = no staging scan |
| `DAST_ALLOWED_HOSTS` | variable | DAST | hosts allowed as a staging target, exact names |
| `DAST_DENY_HOSTS` | variable | DAST | extra hosts (and their subdomains) never scanned |
| `DAST_ALLOW_ACTIVE_STAGING` | variable | DAST | `true` allows the active ZAP scan on staging |
| `DAST_NUCLEI_RATE_LIMIT` | variable | DAST | `10` requests/s on staging |
| `DEPLOY_SSH_KEY` | **secret** | deploy | the private deploy key (ed25519, no passphrase) |
| `DEPLOY_HOST`, `DEPLOY_PORT`, `DEPLOY_USER` | variable | deploy | the server |
| `DEPLOY_KNOWN_HOSTS` | variable | deploy | the server's host key line(s); required, no trust-on-first-use |
| `CD_AUTO_DEPLOY` | variable | deploy | `true` = deploy after every green CI on `master` |
| `NPM_TOKEN` | **secret** (environment `npm`) | publish-bmd | a granular npm token ("Read and write", bypass 2FA) for the FIRST B.MD release only. 3.1.0 is out (2026-09-29): delete it once the trusted publishers are configured |

The security and DAST workflows need **no secret**: they use the run's own token for the
two writes above. The CI-local DAST instance generates its secrets at run time.

---

## Reading the results

- **The run's Summary page** holds each gate's table (tool, threshold, counts per severity,
  what blocks). The log of the `gate` step prints the same with one line per finding, and a
  red annotation per blocking finding.
- **Artifacts** (bottom of the run page) hold the full reports: JSON, SARIF, ZAP's HTML.
- **The pull-request comment.** On a pull request, *Gate table on the pull request* posts one
  comment, and every later run **edits that same comment** (it finds it by the hidden marker
  `<!-- bcw-security-gate -->`). The DAST workflow keeps its own, marker
  `<!-- bcw-security-gate-dast -->`: the two finish at different times, and one shared comment
  would let the later run erase the other's table. Columns: tool, threshold, critical, high,
  medium, low, info, blocking, verdict, and the link to the run and its artifacts. A pull
  request from a fork gets a read-only token: no comment, a notice, the table stays in the run
  summary.
- **Security tab → Code scanning.** Semgrep, Trivy (fs and each image), ZAP and Nuclei upload
  their SARIF, one *category* per tool (and per image / target), so each alert is tracked from
  run to run: opened, fixed, reintroduced. Filter by *Tool* or by category. On a pull request,
  new alerts from Semgrep and Trivy fs are annotated on the changed lines; DAST alerts point
  at a URL, not a file, so they are listed but not drawn on lines. The upload happens even
  when the gate failed. If the repository cannot use code scanning (a private repository
  without GitHub Advanced Security) the job says so in a notice and the SARIF stays in the
  artifact — nothing fails for that reason. This repository is public: code scanning is
  available at no cost.

## Dismissing a false positive properly

Two ways exist; they are not equal.

1. **Preferred: a reviewed exclusion in the repository**, in the tool's own file, with the
   reason, the reviewer and the date, as narrow as the tool allows (a Gitleaks fingerprint, a
   `nosemgrep` on one line, a Trivy entry scoped to a file with an expiry, a ZAP rule with a
   reason). It goes through a pull request, it is versioned, and it changes what the **gate**
   decides. The files and the syntax: [SECURITY_CI_EN.md](SECURITY_CI_EN.md#5-excluding-a-finding-a-reviewed-false-positive).
2. **A dismissal in the Security tab** (alert → *Dismiss alert* → *False positive* / *Used in
   tests* / *Won't fix*, with a comment). It only changes GitHub's view: the gate reads the
   scanner's report, not the alert's state, so **a blocking finding keeps failing the build**.
   Use it for an alert below the threshold that you have judged and do not want to see again;
   write the justification in the comment.

Never lower `SECURITY_GATE_SEVERITY` or delete a step to get past one finding: that switches
the check off for every finding after it.

---

## Decisions still open

- *Decided 2026-09-25:* a deploy waits for a green *BCWEB security* run for its commit (above);
  DAST stays advisory. Until the findings of
  [SECURITY_CI_EN.md](SECURITY_CI_EN.md#6-what-the-scans-found-on-2026-09-25-and-what-was-done)
  are all closed, the security workflow can be red, and then **no deploy goes through**: that
  is the intended effect, not a bug of the deploy.
- The report artifacts of a public repository can be downloaded by any signed-in GitHub user.
  Gitleaks' report is redacted; the others describe the code (public anyway) and a throw-away
  instance. A DAST run against a real staging site would publish its findings the same way.
