param([Parameter(Mandatory=$true)][ValidatePattern('^[a-zA-Z0-9_-]{1,20}$')][string]$HostName, [string]$Config)
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (!$Config) { $Config = Join-Path $repoRoot '.private\bridge.config.json' }
$settings = Get-Content -LiteralPath $Config -Raw | ConvertFrom-Json
$settings | Add-Member -NotePropertyName bluetooth -NotePropertyValue ([pscustomobject]@{enabled=$true;hostName=$HostName}) -Force
$settings | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $Config -Encoding UTF8
Write-Host 'Bluetooth enabled. Restart the bridge. Credential values were not printed.'
