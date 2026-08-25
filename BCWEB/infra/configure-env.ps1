# Build a complete .env by answering questions, with every answer explained.
#
# The Windows half of infra/configure-env.sh. Both read infra/env-spec.txt, so the questions,
# their order, their defaults and their explanations exist ONCE. Two scripts with their own
# question lists is two lists that drift, and the drift only shows up as two operators with
# different files and no idea why.
#
#   .\infra\configure-env.ps1                  interactive, writes infra\compose\.env
#   .\infra\configure-env.ps1 -Force           overwrite an existing .env (a backup is kept)
#   .\infra\configure-env.ps1 -Out C:\tmp\e    write somewhere else, change nothing
#
# Windows PowerShell 5.1 compatible: no ternary, no ??, no pipeline chain operators.
[CmdletBinding()]
param(
  [switch]$Force,
  [string]$Out
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$spec = Join-Path $here 'env-spec.txt'
$example = Join-Path $here 'compose\.env.example'
if (-not $Out) { $Out = Join-Path $here 'compose\.env' }

if (-not (Test-Path $spec)) { throw "missing $spec" }
if (-not (Test-Path $example)) { throw "missing $example" }

if ((Test-Path $Out) -and (-not $Force)) {
  Write-Host "A .env already exists at $Out." -ForegroundColor Yellow
  Write-Host ''
  Write-Host '  Rewriting POSTGRES_PASSWORD against an already-initialised database locks you out'
  Write-Host '  of your own Postgres - the volume keeps the password it was created with - so this'
  Write-Host '  refuses rather than guessing that you meant it.'
  Write-Host ''
  Write-Host '  To change a few values:      edit it, or run infra/prod-env.sh on the server'
  Write-Host '  To rebuild it from scratch:  .\infra\configure-env.ps1 -Force   (the old one is backed up)'
  exit 1
}

# Answers, last write wins - the derived section at the end corrects some of them.
$answers = [ordered]@{}
function Get-Answer([string]$k) { if ($answers.Contains($k)) { return $answers[$k] } return '' }

function New-Secret {
  # 24 bytes as hex. RandomNumberGenerator, not Get-Random: this value signs sessions.
  $bytes = New-Object byte[] 24
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return -join ($bytes | ForEach-Object { $_.ToString('x2') })
}

function Show-Help([string]$text) {
  if (-not $text) { return }
  foreach ($line in ($text -split '\\n')) {
    if ($line.Trim()) { Write-Host ("   " + $line) -ForegroundColor DarkGray }
  }
}

# =SOMEKEY takes another answer; =host(KEY) strips the scheme and the port.
function Resolve-Default([string]$def) {
  if ($def -like '=host(*)') {
    $k = $def -replace '^=host\(', '' -replace '\)$', ''
    $v = Get-Answer $k
    $v = $v -replace '^[a-z]+://', ''
    return ($v -split '[:/]')[0]
  }
  if ($def -like '=*') { return (Get-Answer ($def.Substring(1))) }
  return $def
}

function Should-Ask([string]$cond) {
  if (-not $cond) { return $true }
  $k, $want = $cond -split '=', 2
  $have = Get-Answer $k
  if ($want -eq '*') { return [bool]$have }
  return ($have -eq $want)
}

Write-Host ''
Write-Host '  BCWEB - build a .env' -ForegroundColor White
Write-Host ''
Write-Host '  Every question explains what the value does and what happens if you skip it.'
Write-Host '  Press Enter to take the [default]. Nothing is written until the very end.'
Write-Host ''

$section = ''
foreach ($raw in (Get-Content -LiteralPath $spec -Encoding UTF8)) {
  if (-not $raw -or $raw.StartsWith('#')) { continue }
  # -1 keeps trailing empty fields, so a row ending in an empty HELP still has six parts.
  $f = $raw -split '\|', 6
  if ($f.Count -lt 5) { continue }
  $key = $f[0]; $sect = $f[1]; $kind = $f[2]; $def = $f[3]; $prompt = $f[4]
  $help = ''
  if ($f.Count -ge 6) { $help = $f[5] }

  $cond = ''
  if ($help -like 'when:*') {
    $cond = ($help -replace '^when:([^ ]*).*$', '$1')
    $help = ($help -replace '^when:[^ ]*\s{0,2}', '')
  }
  if (-not (Should-Ask $cond)) { continue }

  if ($sect -ne $section) {
    $section = $sect
    Write-Host ''
    Write-Host ("-- " + $section + " " + ('-' * 40)) -ForegroundColor Cyan
  }

  if ($kind -eq 'info') { Show-Help $help; continue }

  $d = Resolve-Default $def
  Show-Help $help

  $ans = ''
  switch ($kind) {
    'choice' {
      $opts = $d -split ','
      $first = $opts[0]
      $shown = ($opts | ForEach-Object { if ($_ -eq '') { '(empty)' } else { $_ } }) -join ' / '
      Write-Host ("   options: " + $shown) -ForegroundColor DarkGray
      $ans = Read-Host ("? " + $prompt + " [" + $first + "]")
      if (-not $ans) { $ans = $first }
    }
    'bool' {
      $ans = Read-Host ("? " + $prompt + " [" + $d + "]")
      if (-not $ans) { $ans = $d }
      if ($ans -match '^(y|yes|true|1)$') { $ans = 'true' } else { $ans = 'false' }
    }
    'secret' {
      # Offered, not imposed: somebody pasting a key they already hold must not have to
      # fight a generator for the field.
      $gen = New-Secret
      if ($d) { $gen = $d }
      $secure = Read-Host ("? " + $prompt + " [Enter = generate]") -AsSecureString
      $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
      if ($plain) { $ans = $plain } else { $ans = $gen }
    }
    'url' {
      $ans = Read-Host ("? " + $prompt + " [" + $d + "]")
      if (-not $ans) { $ans = $d }
      $ans = $ans.TrimEnd('/')
    }
    default {
      $ans = Read-Host ("? " + $prompt + " [" + $d + "]")
      if (-not $ans) { $ans = $d }
    }
  }

  $answers[$key] = $ans
  Write-Host ''
}

# -- derived ------------------------------------------------------------------
#
# Announced, never silent. A value in the file that nobody typed and nobody was told about is
# the hardest kind to debug six months later.
Write-Host ''
Write-Host ("-- Derived " + ('-' * 40)) -ForegroundColor Cyan

if ((Get-Answer 'DB_MODE') -eq 'managed') {
  Write-Host '   - the bundled Postgres container is not started' -ForegroundColor DarkGray
  Write-Host '   - DATABASE_URL is used as given, so the parts below are ignored' -ForegroundColor DarkGray
}

$replicas = Get-Answer 'API_REPLICAS'
if (-not $replicas) { $replicas = '1' }
if ($replicas -ne '1' -and (Get-Answer 'REDIS_ENABLED') -ne 'true') {
  Write-Host ("   ! API_REPLICAS=" + $replicas + " with Redis off. Turning Redis ON - without it every") -ForegroundColor Yellow
  Write-Host '     replica runs the background sweeper, and expiry e-mails go out once per replica.' -ForegroundColor Yellow
  # Corrected rather than refused: replicas without Redis is not a configuration anybody
  # wants, it is a mistake with a known fix.
  $answers['REDIS_ENABLED'] = 'true'
}
if ($replicas -ne '1' -and -not (Get-Answer 'COMPOSE_PROFILES') -and (Get-Answer 'DB_MODE') -eq 'bundled') {
  Write-Host ("   - consider COMPOSE_PROFILES=pgbouncer: " + $replicas + " replicas open " + $replicas + " sets of connections") -ForegroundColor DarkGray
}

# -- write --------------------------------------------------------------------
#
# Built FROM .env.example so every comment survives and any variable the wizard does not ask
# about still lands with its documented default. A generated .env that drops the explanations
# is a file nobody can edit six months later.
$lines = New-Object System.Collections.Generic.List[string]
foreach ($line in (Get-Content -LiteralPath $example -Encoding UTF8)) {
  if ($line -match '^([A-Z][A-Z0-9_]*)=') {
    $k = $Matches[1]
    if ($answers.Contains($k)) { $lines.Add($k + '=' + $answers[$k]) } else { $lines.Add($line) }
  }
  elseif ($line -match '^#([A-Z][A-Z0-9_]*)=') {
    # A commented-out variable the wizard asked about becomes a real line; the rest stay
    # commented, which is what keeps the example's "here is what you could set" intact.
    $k = $Matches[1]
    if ($answers.Contains($k) -and $answers[$k]) { $lines.Add($k + '=' + $answers[$k]) } else { $lines.Add($line) }
  }
  else { $lines.Add($line) }
}
$lines.Add('')
$lines.Add('# -- Written by infra/configure-env.ps1 --------------------------------------')
foreach ($k in $answers.Keys) {
  if (-not ($lines -match ('^' + [regex]::Escape($k) + '='))) { $lines.Add($k + '=' + $answers[$k]) }
}

if (Test-Path $Out) {
  $bak = $Out + '.bak.' + (Get-Date -Format 'yyyyMMddHHmmss')
  Copy-Item -LiteralPath $Out -Destination $bak
  Write-Host ("   - previous .env kept as " + $bak) -ForegroundColor DarkGray
}
# UTF8 without a BOM: docker compose reads this file, and a BOM makes the first variable's
# name start with an invisible character that nothing reports and nothing matches.
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllLines($Out, $lines, $utf8NoBom)

Write-Host ''
Write-Host ("  Written: " + $Out) -ForegroundColor White
Write-Host ''
Write-Host '  Next (on the server):'
Write-Host '    docker compose -f infra/compose/docker-compose.yml up -d --build'
Write-Host '    docker compose -f infra/compose/docker-compose.yml exec api npm run setup'
Write-Host ''
Write-Host '  setup migrates and seeds projects, the admin account, plans, docs and the FAQ.'
Write-Host '  It is idempotent, so re-running it later is how you pick up new docs and FAQ entries.'
Write-Host ''
