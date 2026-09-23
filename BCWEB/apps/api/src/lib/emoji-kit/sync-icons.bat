@echo off
rem BetterCommunity - put the bot's icons on Discord as application emojis (Windows).
rem
rem This file is the same for everybody: it is not generated from anything stored on the
rem site, it holds no token and no address, and it downloads nothing. It reads the PNGs in
rem the "icons" folder next to it, asks Discord which of them the application already has,
rem uploads the ones it is missing, and writes app-emojis.json for you to import on the site.
rem
rem The bot token is asked for when it runs (typed hidden), or read from the DISCORD_TOKEN
rem environment variable. It is sent to discord.com only, and never written to disk.
rem Set BC_YES=1 to skip the "upload now?" question.
rem
rem The PowerShell below the marker line is run from this same file: nothing is fetched.
setlocal
set "BC_SELF=%~f0"
set "BC_DIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s = [IO.File]::ReadAllText($env:BC_SELF); $i = $s.IndexOf('#' + '==PS=='); Invoke-Expression $s.Substring($i)"
set "BC_CODE=%ERRORLEVEL%"
echo.
pause
exit /b %BC_CODE%
#==PS==
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Net.Http
$Api = 'https://discord.com/api/v10'
$Ua = 'DiscordBot (https://bettercommunity.ch, 1.0) BetterCommunity-emoji-kit'
$Dir = Join-Path $env:BC_DIR 'icons'
$Out = Join-Path $env:BC_DIR 'app-emojis.json'

Write-Host ''
Write-Host 'BetterCommunity: bot icons to Discord application emojis'
Write-Host '---------------------------------------------------------'
if (-not (Test-Path -LiteralPath $Dir)) { Write-Host "There is no 'icons' folder next to this script. Unzip the whole kit, then run it again."; exit 1 }
$Files = @(Get-ChildItem -LiteralPath $Dir -Filter '*.png' | Where-Object { $_.Name -cmatch '^bc_[a-z0-9_]+_[0-9a-f]{8}\.png$' -and $_.Length -le 262144 } | Sort-Object Name)
if ($Files.Count -eq 0) { Write-Host 'The icons folder holds no bc_<key>_<version>.png file.'; exit 1 }

$Token = [string]$env:DISCORD_TOKEN
if (-not $Token.Trim()) {
  Write-Host 'Paste the bot token (Discord Developer Portal > your application > Bot > Reset Token).'
  Write-Host 'It is typed hidden, sent to discord.com only, and not saved anywhere.'
  $Sec = Read-Host -AsSecureString 'Bot token'
  $B = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Sec)
  try { $Token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($B) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($B) }
}
$Token = $Token.Trim()
if (-not $Token) { Write-Host 'No token given. Nothing was done.'; exit 1 }

$Http = New-Object System.Net.Http.HttpClient
$Http.Timeout = [TimeSpan]::FromSeconds(60)
[void]$Http.DefaultRequestHeaders.TryAddWithoutValidation('Authorization', "Bot $Token")
[void]$Http.DefaultRequestHeaders.TryAddWithoutValidation('User-Agent', $Ua)

function Scrub([string]$s) { if ($Token) { return $s.Replace($Token, '[token]') } return $s }

function Invoke-Discord([string]$Method, [string]$Path, [string]$Json) {
  for ($i = 0; $i -lt 5; $i++) {
    $Req = New-Object System.Net.Http.HttpRequestMessage ([System.Net.Http.HttpMethod]::new($Method)), ($Api + $Path)
    if ($Json) { $Req.Content = New-Object System.Net.Http.StringContent ($Json, [Text.Encoding]::UTF8, 'application/json') }
    $Res = $Http.SendAsync($Req).GetAwaiter().GetResult()
    $Body = $Res.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    $Code = [int]$Res.StatusCode
    if ($Code -eq 429) {
      $Wait = 1.0
      try { $Wait = [double](ConvertFrom-Json $Body).retry_after } catch { }
      Write-Host ("  Discord asks to wait {0:N1}s" -f $Wait)
      Start-Sleep -Milliseconds ([int]($Wait * 1000) + 250)
      continue
    }
    if ($Code -ge 500) { Start-Sleep -Seconds ($i + 1); continue }
    if ($Code -lt 200 -or $Code -ge 300) {
      $Msg = ''
      try { $Msg = [string](ConvertFrom-Json $Body).message } catch { }
      throw (Scrub "Discord answered $Code $Msg")
    }
    if ($Res.Headers.Contains('X-RateLimit-Remaining')) {
      $Rem = @($Res.Headers.GetValues('X-RateLimit-Remaining'))[0]
      if ($Rem -eq '0' -and $Res.Headers.Contains('X-RateLimit-Reset-After')) {
        $Ra = [double](@($Res.Headers.GetValues('X-RateLimit-Reset-After'))[0])
        Start-Sleep -Milliseconds ([int]($Ra * 1000) + 100)
      }
    }
    if ($Body) { return (ConvertFrom-Json $Body) }
    return $null
  }
  throw 'Discord is still rate limiting after 5 attempts.'
}

try {
  $App = Invoke-Discord 'GET' '/applications/@me' ''
  $AppId = [string]$App.id
  $List = @((Invoke-Discord 'GET' "/applications/$AppId/emojis" '').items)
} catch {
  Write-Host ('Could not read the application: ' + (Scrub ([string]$_)))
  Write-Host 'Check the token: it is the BOT token of the application, not a user token or the client secret.'
  exit 1
}

$Have = @{}
foreach ($E in $List) { if ($E -and $E.name) { $Have[[string]$E.name] = $E } }
$Plan = @()
foreach ($F in $Files) {
  $Name = [IO.Path]::GetFileNameWithoutExtension($F.Name)
  $Key = ($Name -replace '_[0-9a-f]{8}$', '') -replace '^bc_', ''
  $Older = @($List | Where-Object { $_.name -cmatch ('^bc_' + [regex]::Escape($Key) + '_[0-9a-f]{8}$') -and $_.name -cne $Name })
  if ($Have.ContainsKey($Name)) { $St = 'present' } elseif ($Older.Count -gt 0) { $St = 'mismatched' } else { $St = 'missing' }
  $Plan += [pscustomobject]@{ Name = $Name; Key = $Key; File = $F.FullName; Status = $St }
}

$Todo = @($Plan | Where-Object { $_.Status -ne 'present' })
Write-Host ''
Write-Host ("Application: {0} emoji(s) on Discord. Icons in this kit: {1}." -f $List.Count, $Plan.Count)
Write-Host ("  on Discord: {0}   older drawing only: {1}   missing: {2}" -f @($Plan | Where-Object { $_.Status -eq 'present' }).Count, @($Plan | Where-Object { $_.Status -eq 'mismatched' }).Count, @($Plan | Where-Object { $_.Status -eq 'missing' }).Count)
foreach ($P in $Todo) { Write-Host ("  {0,-11} {1}" -f $P.Status, $P.Name) }

$Failed = 0
if ($Todo.Count -gt 0) {
  if ((2000 - $List.Count) -lt $Todo.Count) { Write-Host ("Only room for {0} more emoji(s): Discord allows 2000 per application." -f [Math]::Max(0, 2000 - $List.Count)) }
  $Go = ($env:BC_YES -eq '1')
  if (-not $Go) { $Go = ((Read-Host ("Upload these {0} icon(s) now? [y/N]" -f $Todo.Count)) -match '^(y|yes|o|oui)$') }
  if (-not $Go) { Write-Host 'Nothing uploaded.' }
  else {
    $N = 0
    foreach ($P in $Todo) {
      $N++
      try {
        $B64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($P.File))
        $Json = ConvertTo-Json -Compress @{ name = $P.Name; image = ('data:image/png;base64,' + $B64) }
        $E = Invoke-Discord 'POST' "/applications/$AppId/emojis" $Json
        $Have[[string]$E.name] = $E
        Write-Host ("  [{0}/{1}] uploaded {2}" -f $N, $Todo.Count, $P.Name)
      } catch {
        $Failed++
        Write-Host ("  [{0}/{1}] FAILED {2}: {3}" -f $N, $Todo.Count, $P.Name, (Scrub ([string]$_)))
      }
    }
  }
} else { Write-Host 'Every icon in the kit is already on Discord.' }

# The map the site imports: every application emoji whose name and id it accepts.
$Emojis = [ordered]@{}
$Animated = @()
foreach ($E in $Have.Values) {
  $Nm = [string]$E.name; $Id = [string]$E.id
  if ($Nm -cmatch '^[a-z0-9_]{2,32}$' -and $Id -match '^\d{17,20}$') { $Emojis[$Nm] = $Id; if ($E.animated) { $Animated += $Nm } }
}
$Map = [ordered]@{ appId = $AppId; generatedAt = (Get-Date).ToUniversalTime().ToString('o'); emojis = $Emojis; animated = $Animated }
[IO.File]::WriteAllText($Out, (ConvertTo-Json -Depth 4 $Map), (New-Object Text.UTF8Encoding $false))
Write-Host ''
Write-Host ("Wrote {0} ({1} emoji(s))." -f $Out, $Emojis.Count)
Write-Host 'Last step: on the site, Discord bot > Icons on Discord > Import the map, choose app-emojis.json.'
if ($Failed -gt 0) { Write-Host ("{0} upload(s) failed; run the script again to retry them." -f $Failed); exit 2 }
exit 0
