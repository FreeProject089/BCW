# Run the pending migrations and put the regenerated Prisma client where the API
# actually loads it. One command, because doing this by hand has three traps that each
# produce a SILENT failure — every one of them documented in this repo's history:
#
#   1. Prisma CLI needs BOTH DATABASE_URL and DIRECT_DATABASE_URL, or it dies with a
#      P1012 that looks nothing like a missing env var.
#   2. `prisma generate` resolves its output from the SCHEMA's location, walks up past
#      packages/db (no package.json) and lands in the PARENT repo's node_modules —
#      a client the API never loads. Regenerating "again" changes nothing; the copy the
#      API reads must be mirrored into apps/api/node_modules/.prisma/client.
#   3. The API caches its client in a module-level singleton, so a correct client on
#      disk means nothing to a running process — and a RUNNING API holds the query
#      engine DLL open, which kills the mirror copy halfway. Stop it first.
#
# Usage, from BCWEB/:   powershell -ExecutionPolicy Bypass -File scripts/migrate-and-mirror.ps1
#
# THIS SCRIPT IS FOR THE HOST-DEV WORKFLOW ONLY (npm run dev against a Postgres that
# publishes localhost:5432). Under Docker Compose it will always refuse: the db service
# deliberately does NOT publish 5432 to the host, so "Postgres is not reachable" is this
# deployment telling you you're holding the wrong tool. The Docker path needs none of
# this — the API image self-migrates at boot (boot-migrate.mjs). There:
#
#     docker compose build api web && docker compose up -d api web
#
# then read `docker compose logs api` for the "Applying migration" lines. Verified live
# Aug 12 2026: both pending migrations applied that way, /v1/scopes answering.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

# ── Credentials from the compose env (the local defaults live there) ─────────
$envFile = Join-Path $root 'infra\compose\.env'
$user = 'bcweb'; $pass = ''; $db = 'bcweb'
foreach ($line in Get-Content $envFile) {
    if ($line -match '^POSTGRES_USER=(.+)$')     { $user = $Matches[1].Trim() }
    if ($line -match '^POSTGRES_PASSWORD=(.+)$') { $pass = $Matches[1].Trim() }
    if ($line -match '^POSTGRES_DB=(.+)$')       { $db   = $Matches[1].Trim() }
}
if (-not $pass) { throw "POSTGRES_PASSWORD not found in $envFile" }
$url = "postgresql://${user}:${pass}@localhost:5432/${db}"
$env:DATABASE_URL = $url
$env:DIRECT_DATABASE_URL = $url   # trap 1

# ── Preconditions ────────────────────────────────────────────────────────────
if (-not (Test-NetConnection -ComputerName localhost -Port 5432 -InformationLevel Quiet -WarningAction SilentlyContinue)) {
    throw 'Postgres is not reachable on localhost:5432 - start Docker Compose first.'
}
$apiProc = Get-Process -Name node -ErrorAction SilentlyContinue
if ($apiProc) {
    Write-Warning 'node process(es) running. If one is the API, the client mirror below WILL fail half-way (trap 3). Stop the API, then re-run.'
}

Set-Location $root

# ── 1. Apply the pending migrations ─────────────────────────────────────────
Write-Host "== prisma migrate deploy" -ForegroundColor Cyan
npx prisma migrate deploy --schema packages/db/schema.prisma
if ($LASTEXITCODE -ne 0) { throw 'migrate deploy failed' }

# ── 2. Regenerate, then mirror to where the API loads from (trap 2) ─────────
Write-Host "== prisma generate + mirror" -ForegroundColor Cyan
npx prisma generate --schema packages/db/schema.prisma
if ($LASTEXITCODE -ne 0) { throw 'generate failed' }

$parentClient = Join-Path (Split-Path -Parent (Split-Path -Parent $root)) 'node_modules\.prisma\client'
$apiClient    = Join-Path $root 'apps\api\node_modules\.prisma\client'
if (-not (Test-Path $parentClient)) { throw "generated client not found at $parentClient" }
New-Item -ItemType Directory -Force $apiClient | Out-Null
Copy-Item -Path (Join-Path $parentClient '*') -Destination $apiClient -Recurse -Force

# The mirror only counts if the NEW models made it across.
$idx = Join-Path $apiClient 'index.d.ts'
$hasNew = (Select-String -Path $idx -Pattern 'catalogAuditLog' -Quiet) -and (Select-String -Path $idx -Pattern 'bodyFr' -Quiet)
if (-not $hasNew) { throw 'mirror copied, but the API client does NOT contain the new models - was the API holding the DLL open?' }

Write-Host ''
Write-Host 'OK: migrations applied, client mirrored and verified.' -ForegroundColor Green
Write-Host 'NOW RESTART THE API (trap 3: it caches the old client in a singleton).' -ForegroundColor Yellow
Write-Host 'Then smoke-test:  curl http://localhost:PORT/api/v1/scopes'
