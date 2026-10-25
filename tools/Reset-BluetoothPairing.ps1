param([string]$Config)
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (!$Config) { $Config = Join-Path $repoRoot '.private\bridge.config.json' }
$settings = [IO.File]::ReadAllText([IO.Path]::GetFullPath($Config)) | ConvertFrom-Json
$hostName = $settings.bluetooth.hostName
if (!$hostName) { $hostName = [Environment]::MachineName }
if ($hostName -notmatch '^[a-zA-Z0-9_-]{1,20}$') { throw 'Invalid Bluetooth host name in bridge config.' }
if (Get-Process -Name 'MirTar-Bluetooth*' -ErrorAction SilentlyContinue) {
    throw 'Stop the MirTar bridge and Add-Server tools first (Ctrl+C), then retry. No pairing was changed.'
}
Write-Host 'Removing only the Windows pairing entry matching this configured MirTar host. Badge/bridge configuration is retained.'
& (Join-Path $PSScriptRoot 'Start-Bluetooth.ps1') -HostName $hostName -ForgetPairing
if ($LASTEXITCODE) { throw 'Could not reset the exact Windows pairing entry. Remove the badge in Windows Bluetooth settings, then restart the bridge.' }
Write-Host 'Windows pairing reset finished. If an old MirTar-Add entry remains, remove that badge entry in Windows Bluetooth settings.'
