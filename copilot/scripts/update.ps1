# update.ps1: update GitHub Copilot CLI and thimble's Copilot plugin, for a daily scheduled task.
#   - copilot update
#   - copilot plugin update thimble (or install it from the fork when it is missing)
#   - refresh thimble's upstream cache (~/.thimble-copilot/upstream), which an installed plugin reads its prompts from
# Prints the versions, logs to %LOCALAPPDATA%\thimble-copilot\update.log, and exits nonzero on any failure.
# Usage: .\update.ps1 [-Source ayushnangia/thimble:copilot] [-Name thimble] [-SkipCli]
param(
  [string]$Source = 'ayushnangia/thimble:copilot',
  [string]$Name = 'thimble',
  [string]$Repo = 'https://github.com/ayushnangia/thimble.git',
  [switch]$SkipCli
)
$ErrorActionPreference = 'Continue'
$logDir = Join-Path $env:LOCALAPPDATA 'thimble-copilot'
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir 'update.log'
$failed = 0
function Log([string]$msg) { $line = "$(Get-Date -Format s) $msg"; Write-Host $line; Add-Content -Path $log -Value $line }
function Step([string]$what, [scriptblock]$do) {
  Log "-- $what"
  $out = & $do 2>&1 | Out-String
  $code = $LASTEXITCODE
  if ($out.Trim()) { Log $out.Trim() }
  if ($code -ne 0) { Log "FAILED ($code): $what"; $script:failed++ }
}

Log "thimble-copilot update start"
if (-not (Get-Command copilot -ErrorAction SilentlyContinue)) { Log 'FAILED: copilot is not on PATH'; exit 1 }

if (-not $SkipCli) { Step 'copilot update' { copilot update } }

$installed = $false
try { $installed = [bool](copilot plugin list --json | ConvertFrom-Json | Where-Object { $_.name -eq $Name }) } catch { Log "warn: could not read plugin list: $_" }
if ($installed) { Step "copilot plugin update $Name" { copilot plugin update $Name } }
else { Step "copilot plugin install $Source" { copilot plugin install $Source } }

$home2 = if ($env:THIMBLE_COPILOT_HOME) { $env:THIMBLE_COPILOT_HOME } else { Join-Path $HOME '.thimble-copilot' }
$up = Join-Path $home2 'upstream'
if (Test-Path (Join-Path $up '.git')) {
  Step 'refresh upstream cache' { git -C $up fetch --depth 1 origin main; if ($LASTEXITCODE -eq 0) { git -C $up reset --hard FETCH_HEAD } } | Out-Null
} else {
  New-Item -ItemType Directory -Force $home2 | Out-Null
  Step 'clone upstream cache' { git -c core.longpaths=true clone --depth 1 --filter=blob:none --sparse --config core.longpaths=true $Repo $up; if ($LASTEXITCODE -eq 0) { git -C $up sparse-checkout set plugin } } | Out-Null
}

Log "copilot: $((copilot --version 2>&1 | Select-Object -First 1))"
try { $p = copilot plugin list --json | ConvertFrom-Json | Where-Object { $_.name -eq $Name }; Log "plugin: $Name $($p.version)" } catch { Log "plugin: unknown" }
Log "upstream: $((git -C $up rev-parse --short HEAD 2>&1))"
Log "thimble-copilot update end, failures: $failed"
exit ([int]($failed -gt 0))
