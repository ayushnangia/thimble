# doctor.ps1: checks thimble for GitHub Copilot CLI (see doctor.mjs). Usage: .\doctor.ps1 [-Fetch]
param([switch]$Fetch)
$ErrorActionPreference = 'Stop'
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  Write-Output 'FAIL  node: not found on PATH'
  Write-Output '      fix: install Node 22 (winget install OpenJS.NodeJS.LTS); the extension itself runs in Copilot CLI'
  exit 1
}
$args2 = @("$PSScriptRoot\doctor.mjs")
if ($Fetch) { $args2 += '--fetch' }
& $node @args2
exit $LASTEXITCODE
