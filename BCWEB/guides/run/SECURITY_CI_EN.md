# BCWEB — Security testing in CI (EN)

> 🇫🇷 Version française : [SECURITY_CI_FR.md](SECURITY_CI_FR.md)
> The overview of every workflow (CI, security, DAST, deploy) is [CI_CD_EN.md](CI_CD_EN.md).

Automated security testing, **no AI**, on every push and pull request, weekly on a schedule,
and on demand. Five open-source tools, each pinned, each writing a report that one small gate
script reads and judges by severity:

| Tool | What it looks at | Workflow / job |
|---|---|---|
| **Gitleaks** | secrets in the **git history** (every commit) | `security.yml` / `gitleaks` |
| **Semgrep** | the source code (SAST): Node/Fastify, React, Rust, Dockerfiles, nginx, GitHub Actions | `security.yml` / `semgrep` |
| **Trivy** (fs) | the lockfiles (npm, cargo) and the Dockerfiles (misconfiguration) | `security.yml` / `trivy-fs` |
| **Trivy** (image) | the five images as built: OS packages, bundled npm, secrets in a layer | `security.yml` / `trivy-image` |
| **OWASP ZAP** | a running site: headers, CSP, cookies, info leaks (passive + spiders) | `dast.yml` / `local`, `staging` |
| **Nuclei** | a running site: known exposures and misconfigurations (non-intrusive templates) | `dast.yml` / `local`, `staging` |

They **complement** the checks `ci.yml` already had, they do not replace them:
`secret-scan.mjs` still guards the current tree (Gitleaks adds the history), `dep-audit.mjs`
still runs `npm audit` / `cargo audit` with its reasoned ignore list (Trivy adds a second
advisory database, the Dockerfiles and the images).

---

## 1. The gate: what fails a build

Every scanner exits 0 and writes its report (JSON; JSONL for Nuclei). Then
`.github/scripts/security-gate.mjs` reads it, puts every finding on one scale —
critical > high > medium > low > info — prints a table and decides:

| Severity | Default | Can it block? |
|---|---|---|
| CRITICAL, HIGH | **blocks** | yes |
| MEDIUM | passes | only if the threshold is set to `medium` (or `low`) |
| LOW | passes | only if somebody sets the threshold to `low` on purpose |
| INFO | passes | **never** |
| Gitleaks (any secret) | **blocks** | always: there is no "low" leaked credential |

How each tool maps: Semgrep ERROR→high, WARNING→medium, INFO→low; Trivy as written, and an
UNKNOWN (not yet rated) advisory counts as **high** until it is rated; ZAP risk
High/Medium/Low/Informational; Nuclei as written. An alert a person marked "false positive"
inside ZAP (confidence 0) is not counted.

**The threshold is a repository variable** (Settings → Secrets and variables → Actions →
Variables), the same names as the BMM / BetterInstaller pipelines:

| Variable | Values | Meaning |
|---|---|---|
| `SECURITY_GATE_SEVERITY` | `critical` `high` `medium` `low` | the LOWEST severity that fails a build. Unset = `high` |
| `SECURITY_GATE_SEVERITY_SEMGREP` / `_TRIVY` / `_ZAP` / `_NUCLEI` | same | overrides it for one tool |

So "MEDIUM blocks" is `SECURITY_GATE_SEVERITY` = `medium`, and "MEDIUM blocks for ZAP only"
is `SECURITY_GATE_SEVERITY_ZAP` = `medium`. A value that is not one of the four is **refused**
(the job fails with exit 2) rather than guessed: a typo must not become "nothing blocks".
`SECURITY_GATE_SEVERITY_GITLEAKS` is accepted and ignored, with a line saying so.

The gate also fails (exit 2) when it cannot trust the report: missing, not valid JSON, not the
tool's shape, a Semgrep run that scanned no file. **A scan that did not run is not a scan that
found nothing.** The DAST jobs add three checks of the same kind: Nuclei must have loaded
thousands of templates and finished without dropping the target, and the instance must still
answer after the scans (the API's abuse guard blocks an address for ten minutes after repeated
scanner hits, and a blocked scanner sees nothing).

Every job writes the table to its log, to the run's **Summary** page, and as
`<tool>-summary.md` in its artifact. On a pull request it also appears as one comment,
updated in place ([CI_CD_EN.md](CI_CD_EN.md#reading-the-results)).

The gate is tested before anything else runs (`gate-selftest` job):

```bash
node --test .github/scripts/security-gate.test.mjs .github/scripts/dast-scope.test.mjs
```

---

## 2. Each scan, and how to run it by hand

Run everything from the **repository root** (`BCW/`). The images are the ones the workflows
use, pinned by tag and digest; copy them from the `env:` block of `.github/workflows/security.yml`
or `dast.yml` (shown shortened below as `$GITLEAKS_IMAGE` & co). On Windows (Git Bash) put
`MSYS_NO_PATHCONV=1` in front of `docker run`, or Git Bash rewrites the container paths.

Then judge any report exactly as CI does:

```bash
node .github/scripts/security-gate.mjs --tool semgrep --report reports/semgrep.json
env SECURITY_GATE_SEVERITY=medium node .github/scripts/security-gate.mjs --tool semgrep --report reports/semgrep.json
```

### Gitleaks — secrets in the history

- **Push / pull request**: only the commits it brings (`before..after`, `base..head`): those
  are what it can still fix.
- **Weekly schedule / manual run**: the **whole history of every ref**. An old secret shows up
  here, and keeps showing up until it is rotated and reviewed.
- Config: `.github/security/gitleaks.toml` = Gitleaks' built-in rules plus a Discord **bot
  token** rule (the shape this project leaked once; the built-in Discord rules do not match
  it). The report is **redacted**: artifacts of a public repository must not be a second leak.

```bash
mkdir -p reports
docker run --rm -v "$PWD:/repo:ro" -v "$PWD/reports:/reports" \
  -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0=/repo \
  "$GITLEAKS_IMAGE" git --config /repo/.github/security/gitleaks.toml \
  --gitleaks-ignore-path /repo/.github/security/.gitleaksignore \
  --redact --no-banner --exit-code 0 --report-format json --report-path /reports/gitleaks.json /repo
# only some commits:  add  --log-opts="origin/master..HEAD"
```

Read the log: it must say `N commits scanned` with N > 0. When git inside the container
refuses the checkout ("dubious ownership"), Gitleaks logs an error, scans **0 commits** and
still writes an empty report — which is why the `safe.directory` line is there, and why the
job checks the count.

### Semgrep — SAST

The rules are **not** a registry pack (`p/javascript` changes on semgrep.dev without a
version bump, so two runs of one commit could disagree). They are the `semgrep/semgrep-rules`
repository at one commit, fetched by hash, and only the `security` rules that fit this stack —
JavaScript, React, Rust, Dockerfile, nginx, GitHub Actions, compose — without the `audit`
tier (Semgrep's "manual review, many false positives" rules: ~400 extra findings here, almost
all noise). The selection lives in `.github/scripts/semgrep-rules.sh`; CI and you run the same
one. Semgrep's default ignores apply (`node_modules`, `dist`, `build`, `test/`, `tests/`).

```bash
env SEMGREP_RULES_SHA=<the SHA in security.yml> bash .github/scripts/semgrep-rules.sh /tmp/semgrep-rules
docker run --rm -v "$PWD:/src:ro" -v /tmp/semgrep-rules:/rules:ro -v "$PWD/reports:/reports" -w /src \
  -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0=/src \
  "$SEMGREP_IMAGE" semgrep scan --metrics=off --disable-version-check --config /rules \
  --json-output=/reports/semgrep.json --sarif-output=/reports/semgrep.sarif --quiet /src
```

### Trivy fs — lockfiles and Dockerfiles

`--scanners vuln,misconfig` over the checkout. Two things are shared with `ci.yml`'s audit on
purpose, so the two cannot disagree silently: the scope (the telemetry dashboard's **root**
lockfile belongs to the deprecated Express version no image builds; `npm-audit` skips it for
that reason) and the reviewed exception (`GHSA-jrc7-96c5-q579` / `CVE-2026-85061`, maplibre,
judged in `.github/audit-ignore.json` and mirrored in `.github/security/trivyignore.yaml`
with an expiry).

```bash
docker run --rm -v "$PWD:/src:ro" -v "$PWD/reports:/reports" -v trivy-cache:/root/.cache/trivy -w /src \
  "$TRIVY_IMAGE" fs --scanners vuln,misconfig \
  --skip-files BCWEB/bmm/telemetry-dashboard/package-lock.json \
  --ignorefile .github/security/trivyignore.yaml --show-suppressed \
  --format json --output /reports/trivy-fs.json --exit-code 0 .
```

The advisory database is downloaded at each run and is **not** pinned, deliberately: a new
advisory against an unchanged lockfile is what this job is for — it can turn a run red without
a code change.

### Trivy image — the five images

Each image is built as `infra/compose/docker-compose.yml` builds it (`--pull`: today's base
image), saved to a tarball and scanned from it (the scanner never gets the Docker socket),
for vulnerabilities (OS packages and every language package in the image, including the
`npm` that ships inside `node:22-alpine`) and for secrets baked into a layer.

```bash
docker build --pull -t bcweb-api:scan -f BCWEB/apps/api/Dockerfile BCWEB
docker save -o /tmp/image.tar bcweb-api:scan
docker run --rm -v /tmp:/img:ro -v "$PWD/reports:/reports" -v "$PWD/.github/security:/cfg:ro" \
  -v trivy-cache:/root/.cache/trivy "$TRIVY_IMAGE" image --input /img/image.tar \
  --scanners vuln,secret --ignorefile /cfg/trivyignore.yaml --show-suppressed \
  --format json --output /reports/trivy-image-api.json --exit-code 0
```

(bot: context `BCWEB/apps/bot`; telemetry: context `BCWEB/bmm/telemetry-dashboard`; web and
provisioner: context `BCWEB`, Dockerfile under `BCWEB/apps/…`.)

### ZAP and Nuclei — DAST

**What is scanned.** By default an instance the job starts itself (section 3), never a deployed
site. `.github/scripts/dast-scope.mjs` runs first and refuses anything out of scope before a
single request is sent.

**ZAP** runs `zap-baseline.py`: the passive rules, the traditional spider (2 minutes) and the
AJAX spider — no attack payload. The **active** scan (`zap-full-scan.py`) runs only when
somebody starts the DAST workflow by hand with `zap_mode = full`, against the CI-local
instance; on staging it is refused unless `DAST_ALLOW_ACTIVE_STAGING` = `true`. A hook
(`.github/security/zap-hooks.py`) has ZAP write its own SARIF.

**Nuclei** runs the `http` templates of `nuclei-templates` at one commit, without the tags
`dos`, `fuzz`, `intrusive`, `bruteforce`, `default-login`, without the `http/fuzzing` and
`http/credential-stuffing` folders, without out-of-band callbacks (`-ni`), without following
redirects (`-dr`), at 100 requests/s on the CI-local instance and 10 (or
`DAST_NUCLEI_RATE_LIMIT`) on staging.

Both are wrapped in `.github/scripts/dast-scan.sh` so CI and you run them the same way:

```bash
node .github/scripts/dast-scope.mjs --target http://localhost --mode local
env NUCLEI_TEMPLATES_SHA=<the SHA in dast.yml> bash .github/scripts/dast-scan.sh templates /tmp/nuclei-templates
env TARGET=http://localhost REPORTS="$PWD/reports" DOCKER_NET_ARGS="--network container:edge" \
  ZAP_IMAGE="$ZAP_IMAGE" ZAP_RULES=.github/security/zap-rules.tsv bash .github/scripts/dast-scan.sh zap
env TARGET=http://localhost REPORTS="$PWD/reports" DOCKER_NET_ARGS="--network container:edge" \
  NUCLEI_IMAGE="$NUCLEI_IMAGE" NUCLEI_TEMPLATES=/tmp/nuclei-templates bash .github/scripts/dast-scan.sh nuclei
node .github/scripts/security-gate.mjs --tool zap --report reports/zap/zap.json --zap-rules .github/security/zap-rules.tsv
node .github/scripts/security-gate.mjs --tool nuclei --report reports/nuclei/nuclei.jsonl
```

---

## 3. The CI-local instance, and testing without touching production

The `local` DAST job builds a small copy of the stack inside the runner, as production runs
it, and scans that:

1. a Postgres service; the checked-in migrations (`prisma migrate deploy`); the base and demo
   seeds (`npm run seed:demo` content) so the spiders find pages;
2. the API as `node src/server.mjs` with **`NODE_ENV=production`**, so the boot guard
   (`apps/api/src/lib/boot-guard.mjs`) runs as in production. It refuses the repository's
   placeholder secrets, so every secret is generated for this run with `openssl rand` and
   thrown away. `SITE_URL=http://localhost` is a warning there, not a refusal;
3. **no** bot, Stripe, Discord, mail or object storage: their variables are left unset (the API
   runs without them; storage points at a closed port). `RATE_LIMIT_MAX` is raised — the
   documented operator knob — or one scanner address would be measuring the limiter; the
   per-route limits stay (a few hundred 429s are normal and reported);
4. the built web served by `nginx:alpine` with the repository's `nginx.conf`, and **the
   repository's own Caddyfile** in front (`caddy:2-alpine`, the image compose uses). So the
   headers, CSP, redirects and edge rules ZAP judges are production's. The scanners join the
   edge container's network and scan `http://localhost`; nothing is published on the runner.

**To rehearse it on your machine** (never against the dev stack's own database):

```bash
# 1. a throw-away database in the dev Postgres (or any Postgres)
docker exec bcweb-db-1 psql -U bcweb -d postgres -c "CREATE ROLE secci LOGIN PASSWORD '<random>'" -c "CREATE DATABASE bcweb_secci OWNER secci"
cd BCWEB/apps/api
env DATABASE_URL=postgresql://secci:<random>@127.0.0.1:5432/bcweb_secci DIRECT_DATABASE_URL=postgresql://secci:<random>@127.0.0.1:5432/bcweb_secci npx prisma migrate deploy --schema ../../packages/db/schema.prisma
# 2. seed (without NODE_ENV=production), then start the API on :3000 with the variables of the
#    "Start the API" step of dast.yml (random secrets, NODE_ENV=production, SITE_URL=http://localhost)
# 3. build the web:  cd BCWEB/apps/web && npm run build
# 4. web + edge, from the repository root:
docker network create dast
docker run -d --name web --network dast --network-alias web -v "$PWD/BCWEB/apps/web/dist:/usr/share/nginx/html:ro" -v "$PWD/BCWEB/apps/web/nginx.conf:/etc/nginx/conf.d/default.conf:ro" nginx:alpine
docker run -d --name edge --network dast --add-host api:host-gateway -v "$PWD/BCWEB/infra/caddy:/etc/caddy:ro" caddy:2-alpine caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
# 5. the commands of section 2 (ZAP and Nuclei)
# 6. clean up: docker rm -f web edge; docker network rm dast; stop the API;
#    DROP DATABASE bcweb_secci; DROP ROLE secci
```

The Caddyfile's upstreams are `api:3000` and `web:80`, so port 3000 must be free for the API.

**Why production cannot be hit**, three independent ways, all before the first request:

1. `dast-scope.mjs` refuses **bettercommunity.ch and every subdomain**, the production server
   **45.145.164.20** (as a literal target, and as what any target resolves to), anything in
   `DAST_DENY_HOSTS`, a staging name that resolves to the same address as production, and in
   local mode anything but localhost. Hard-coded — no variable switches it off — and tested
   (`dast-scope.test.mjs`, which was red before the script existed).
2. `.github/scripts/dast-block-production.sh` adds firewall rules on the runner rejecting every
   packet to 45.145.164.20 and to what the production names resolve to, for the host and for
   every container, and reads each rule back.
3. The production names resolve to a dead loopback address inside the scanner containers.

---

## 4. Adding or excluding a target

The only targets are the CI-local instance and **one** staging URL:

| Variable | Example | Meaning |
|---|---|---|
| `DAST_STAGING_URL` | `https://staging.example.org` | the staging site. Scanned on the weekly schedule when set, or by hand (Run workflow → `target: staging`) |
| `DAST_ALLOWED_HOSTS` | `staging.example.org` | the hosts that may be scanned, comma- or space-separated, **exact** names (no wildcards). A staging URL whose host is not here is refused |
| `DAST_DENY_HOSTS` | `example.org` | extra hosts that must never be scanned; each entry denies that host **and its subdomains**. Deny always wins |
| `DAST_ALLOW_ACTIVE_STAGING` | `true` | allows `zap_mode = full` (active attack scan) on staging. Unset = refused |
| `DAST_NUCLEI_RATE_LIMIT` | `10` | requests/s for Nuclei on staging (default 10) |

To **add** a staging target: set `DAST_STAGING_URL`, put its host in `DAST_ALLOWED_HOSTS`, and
check that it does not share an address with production (the scope check refuses it
otherwise). To **exclude** one: remove it from `DAST_ALLOWED_HOSTS` or add it to
`DAST_DENY_HOSTS`. Production needs nothing: it is hard-coded. A staging site behind a login or
basic auth is not supported as is (no secret is configured): that is a decision to take first.

---

## 5. Excluding a finding (a reviewed false positive)

The rule for every tool: **an exclusion is written in the repository, next to the tool's
config, with the reason, the reviewer and the date — and it is as narrow as the tool allows.**
It is reviewed in a pull request like code. A real finding is fixed, or left failing for a
decision; it is never excluded to make a build green.

| Tool | Where | How narrow |
|---|---|---|
| Gitleaks | `.github/security/.gitleaksignore` | one **fingerprint** = one commit, file, rule, line. The same value committed again fails again |
| Semgrep | on the line: `// nosemgrep: <rule-id> -- <reason>` | one rule, one line |
| Trivy | `.github/security/trivyignore.yaml` | one advisory or check, scoped to `paths:`, with a `statement:` and an `expired_at:` date (it comes back on that date) |
| ZAP | `.github/security/zap-rules.tsv`: `<plugin id>` TAB `IGNORE` TAB `(<reason>)` | one plugin; the gate **refuses** an IGNORE line without a reason |
| Nuclei | `-et <template>` in `.github/scripts/dast-scan.sh`, with a comment | one template |

`npm audit` / `cargo audit` keep their own list, `.github/audit-ignore.json` (unchanged).

**Dismissing an alert in the Security tab is not an exclusion.** It hides the alert on GitHub
but the gate reads the scanner's report, not GitHub's alert state, so a build that fails keeps
failing. Use a dismissal (with its reason: *false positive*, *used in tests*, *won't fix* and a
comment) only for an alert that does **not** block — typically a MEDIUM or LOW — and prefer the
in-repository exclusion for anything else: it is versioned, reviewed, applies to the gate and
to the artifact, and survives a re-upload. See [CI_CD_EN.md](CI_CD_EN.md#reading-the-results).

---

## 6. What the scans found on 2026-09-25, and what was done

Run locally with the pinned versions, against this repository and a CI-local instance.

| Tool | Finding | Done |
|---|---|---|
| Semgrep | `apps/api/src/lib/shred.mjs`: AES-GCM decipher without `authTagLength` — a 4-byte tag was accepted (forgery in 2^32 tries) | **fixed** (`authTagLength: 16`) + a test that was red on the old code |
| Semgrep | `apps/web/src/ui/post-bits.jsx`: `innerHTML` for a comment counter | **fixed** (`textContent`, same rendering) |
| Nuclei | open redirect at the edge: `/%5Cevil.example/` answered `308 Location: /\evil.example` (the trailing-slash rule of the Caddyfile) | **fixed** in `infra/caddy/Caddyfile`, validated with `caddy validate` and `site.mjs selftest`, re-scanned clean |
| Trivy / Semgrep | telemetry `Dockerfile`: no `USER` (the distroless `:nonroot` base already runs as uid 65532) | made explicit (`USER nonroot`, no runtime change) |
| Semgrep | 8 false positives (SQL built from identifiers checked against `pg_class`; server-side probes of compose services) | `nosemgrep` on each line, with the reason |
| Gitleaks | 25 false positives in history (test fixtures containing FAKE/TEST, doc placeholders, localStorage key names) | `.gitleaksignore`, by fingerprint |
| Gitleaks | `TELEMETRY_API_KEY` value in `infra/compose/.env.example` history (2 commits) | **not excluded** — owner's decision (public ingest key by design?) |
| Semgrep | 44 ERROR in the deprecated telemetry Express version (`bmm/telemetry-dashboard/*.mjs`, `public/app.js`), built into no image | **not excluded** — owner's decision (delete the legacy files?) |
| Trivy fs | `DS-0002`: `apps/web/Dockerfile` runs nginx as root | **not excluded** — owner's decision (unprivileged nginx means another port in the Caddyfile) |
| Trivy image | api, bot, provisioner: HIGH/CRITICAL in the `npm` bundled with `node:22-alpine` (tar, brace-expansion, pacote, sigstore…); libexpat in several images | **not excluded** — owner's decision (base image bump, or no npm in the runtime images) |
| ZAP | MEDIUM: CSP `style-src 'unsafe-inline'`, wildcard sources, no `form-action`; LOW: missing COEP/COOP/CORP | below the default threshold; listed for the owner |

---

## 7. Versions, and how to bump them

| What | Pinned as | Where |
|---|---|---|
| Gitleaks, Semgrep, Trivy, ZAP, Nuclei | image `tag@sha256:digest` | `env:` of `security.yml`, `dast.yml` |
| Semgrep rules | `semgrep/semgrep-rules` commit | `SEMGREP_RULES_SHA` in `security.yml` |
| Nuclei templates | `nuclei-templates` commit (tag v10.4.9) | `NUCLEI_TEMPLATES_SHA` in `dast.yml` |
| GitHub actions | commit SHA, tag in a comment | every `uses:` |
| Trivy's advisory database | **not pinned**, on purpose | — |

To bump an image: `docker buildx imagetools inspect <image>:<new tag>` gives the digest; change
tag and digest together, run the scans locally, read what changed. To bump rules or templates:
the new commit SHA, the same. To bump an action: `git ls-remote https://github.com/<owner>/<repo>
refs/tags/<tag>` (an annotated tag needs `^{}`), read the diff, change SHA and comment.
