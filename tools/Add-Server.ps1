param([string]$Name, [string]$Config)
$ErrorActionPreference='Stop'
$repoRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (!$Config) { $Config=Join-Path $repoRoot '.private\bridge.config.json' }
if (!$Name) { $Name=Read-Host "Server display name (Enter = $env:COMPUTERNAME)" }
if (!$Name) { $Name=$env:COMPUTERNAME }
Push-Location $repoRoot
try { node tools/add-server.ts $Config $Name; if ($LASTEXITCODE) { throw 'Adding server did not complete; local keys were retained for retry.' } }
finally { Pop-Location }
