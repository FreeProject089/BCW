# Fill .env.example's secrets with freshly generated ones, on Windows.
#
# infra/bootstrap.sh does this on a Linux server, with openssl. This is the same job for
# somebody on Windows who just wants a filled-in file to look at or start from, and it
# deliberately writes a DIFFERENT filename so it can never clobber a live .env - changing
# POSTGRES_PASSWORD against an already-initialised database locks you out of your own
# Postgres, which is the one mistake here that is not undoable.
#
# The trap this exists to avoid, and the one bootstrap.sh was already bitten by: three of
# the secrets the API refuses to boot without ship COMMENTED OUT in .env.example
# (`#LINK_LOOKUP_SECRET=`). A generator that only matches `^KEY=` writes a file that looks
# secured, and the API will not start. This uncomments them.

[CmdletBinding()]
param(
    # Where to write. Defaults beside .env.example.
    [string]$Out = '',
    # Overwrite an existing output file.
    [switch]$Force,
    # Print what would be written, touch nothing.
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$example = Join-Path $here 'compose\.env.example'
if (-not $Out) { $Out = Join-Path $here 'compose\.env.exempletest' }

if (-not (Test-Path $example)) { Write-Host "not found: $example" -ForegroundColor Red; exit 1 }
if ((Test-Path $Out) -and -not $Force -and -not $DryRun) {
    Write-Host "$Out already exists. Re-run with -Force to replace it." -ForegroundColor Yellow
    exit 1
}

# Cryptographic randomness, not Get-Random: Get-Random is seeded PRNG output and is not
# fit for a value that authenticates anything.
function New-Secret([int]$bytes = 32) {
    $b = New-Object byte[] $bytes
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
    -join ($b | ForEach-Object { $_.ToString('x2') })
}

# A password that survives being pasted through a shell, a YAML file and a connection
# string: hex only. A generated password containing @ : / # is a Postgres URL that parses
# into something else entirely, and the failure looks like a wrong password.
function New-Password([int]$bytes = 24) { New-Secret $bytes }

# What gets a fresh value, and why it matters. `boot` marks the ones the API's boot guard
# refuses to start without (see productionSecretProblems in apps/api/src/lib/boot-guard.mjs).
$targets = @(
    @{ Key = 'POSTGRES_PASSWORD';   Gen = { New-Password };     Boot = $false; Why = 'Postgres superuser. Read ONLY when the volume is first initialised.' }
    @{ Key = 'JWT_SECRET';          Gen = { New-Secret };       Boot = $true;  Why = 'Signs session tokens. The repo default is public knowledge.' }
    @{ Key = 'LINK_LOOKUP_SECRET';  Gen = { New-Secret };       Boot = $true;  Why = 'Covers BOTH the bot auth and the telemetry link lookup.' }
    @{ Key = 'BOT_SHARED_SECRET';   Gen = { New-Secret };       Boot = $true;  Why = 'Authenticates the Discord bot against /bot/*.' }
    @{ Key = 'AUDIT_SECRET';        Gen = { New-Secret };       Boot = $false; Why = 'HMAC chain over the staff audit log; changing it breaks verification of old entries.' }
    @{ Key = 'S3_SECRET_KEY';       Gen = { New-Password };     Boot = $false; Why = 'MinIO / object storage. Must match what MinIO was initialised with.' }
    @{ Key = 'TELEMETRY_ADMIN_KEY'; Gen = { New-Secret 24 };    Boot = $false; Why = 'Admin access to the telemetry dashboard.' }
    @{ Key = 'SEED_ADMIN_PASSWORD'; Gen = { New-Password 18 };  Boot = $false; Why = 'The first admin account, IF the seed has not run yet. Set it BEFORE seeding.' }
)

$lines = [System.IO.File]::ReadAllLines($example)
$set = @{}

for ($i = 0; $i -lt $lines.Length; $i++) {
    foreach ($t in $targets) {
        # `^\s*#?\s*KEY=` - the `#?` is the whole point. Three of these are commented out
        # in the example and a generator that misses them produces a file that cannot boot.
        $pattern = '^\s*#?\s*' + [regex]::Escape($t.Key) + '\s*='
        if ($lines[$i] -match $pattern) {
            $value = & $t.Gen
            $lines[$i] = "$($t.Key)=$value"      # uncommented, by construction
            $set[$t.Key] = $value
            break
        }
    }
}

$missing = $targets | Where-Object { -not $set.ContainsKey($_.Key) }

# Left alone ON PURPOSE, and named so the leftover is a decision rather than an oversight.
# REDIS_PASSWORD ships commented out and the compose Redis is started WITHOUT one:
# uncommenting it here would hand the API a password Redis does not want, and the failure
# reads as a cache outage rather than as a config mistake.
$skipped = @(
    @{ Key = 'REDIS_PASSWORD'; Why = 'Optional. The compose Redis runs with no password - setting one here breaks the connection unless you configure Redis to match.' }
)

Write-Host ''
Write-Host 'Generated:' -ForegroundColor Cyan
foreach ($t in $targets) {
    if (-not $set.ContainsKey($t.Key)) { continue }
    $tag = if ($t.Boot) { '[boot]' } else { '      ' }
    # The VALUE is not printed. It is in the file; echoing it puts it in the console
    # history and in any terminal recording.
    Write-Host ("  {0} {1,-22} {2}" -f $tag, $t.Key, $t.Why)
}
if ($missing) {
    Write-Host ''
    Write-Host 'NOT found in .env.example (so NOT set) - check the template:' -ForegroundColor Yellow
    foreach ($m in $missing) { Write-Host "  $($m.Key)" }
}

$left = $skipped | Where-Object { (Select-String -Path $example -Pattern ('^\s*#?\s*' + [regex]::Escape($_.Key) + '\s*=') -Quiet) }
if ($left) {
    Write-Host ''
    Write-Host 'Left as-is (still a placeholder, on purpose):' -ForegroundColor DarkGray
    foreach ($k in $left) { Write-Host ("  {0,-22} {1}" -f $k.Key, $k.Why) }
}

if ($DryRun) { Write-Host ''; Write-Host "dry run - nothing written"; exit 0 }

# LF, not CRLF: this file is read by docker compose and, on a deploy, by a Linux shell.
$text = ($lines -join "`n") + "`n"
[System.IO.File]::WriteAllText($Out, $text, (New-Object System.Text.UTF8Encoding($false)))

Write-Host ''
Write-Host "wrote $Out" -ForegroundColor Green
Write-Host ''
Write-Host "This file contains REAL secrets. The repo .gitignore covers it (.env.*),"
Write-Host "but it is still a file full of live keys sitting on your disk."
Write-Host "To use it for real: rename it to infra/compose/.env - and do NOT do that"
Write-Host "against a database that already exists, because POSTGRES_PASSWORD is only"
Write-Host "read when the volume is first initialised."
