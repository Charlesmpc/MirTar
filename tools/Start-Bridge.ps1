param([string]$Config, [switch]$ResetBluetoothPairing)
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (!$Config) { $Config = Join-Path $repoRoot '.private\bridge.config.json' }
if ($ResetBluetoothPairing) { & (Join-Path $PSScriptRoot 'Reset-BluetoothPairing.ps1') -Config $Config }
Push-Location $repoRoot
try { node bridge/src/main.ts $Config } finally { Pop-Location }
