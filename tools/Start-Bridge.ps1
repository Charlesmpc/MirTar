param([string]$Config)
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (!$Config) { $Config = Join-Path $repoRoot '.private\bridge.config.json' }
Push-Location $repoRoot
try { node bridge/src/main.ts $Config } finally { Pop-Location }
