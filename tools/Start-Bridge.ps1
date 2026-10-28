param([string]$Config, [switch]$ResetBluetoothPairing)
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (!$Config) { $Config = Join-Path $repoRoot '.private\bridge.config.json' }
if (!$ResetBluetoothPairing -and (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'Manage-BridgeService.ps1'))) {
    try {
        $service=& (Join-Path $PSScriptRoot 'Manage-BridgeService.ps1') -Action Status -Config $Config
        if($service.Installed -and $service.TaskState -in @('Running','Queued')){
            Write-Host 'MirTar background bridge is already active. Use tools\Manage-BridgeService.ps1 -Action Status, Stop or Restart.'
            return
        }
    } catch { Write-Verbose 'Background task status unavailable; foreground startup will validate the port.' }
}
if ($ResetBluetoothPairing) { & (Join-Path $PSScriptRoot 'Reset-BluetoothPairing.ps1') -Config $Config }
$previousBackend=$env:MIRTAR_CODEX_BIN
Push-Location $repoRoot
try {
    $env:MIRTAR_CODEX_BIN=& (Join-Path $PSScriptRoot 'Resolve-CodexBackend.ps1') -Config $Config
    node bridge/src/main.ts $Config
} finally {
    if($null -eq $previousBackend){Remove-Item Env:MIRTAR_CODEX_BIN -ErrorAction SilentlyContinue}else{$env:MIRTAR_CODEX_BIN=$previousBackend}
    Pop-Location
}
