param([string]$DeviceId, [string]$Config, [string]$OutputPath, [switch]$WiFi, [string]$BridgeAddress)
$ErrorActionPreference='Stop'
$repoRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$privateRoot=Join-Path $repoRoot '.private'
if (!$Config) { $Config=Join-Path $privateRoot 'bridge.config.json' }
if (!$OutputPath) { $OutputPath=Join-Path $privateRoot 'device.export.config.json' }
$OutputPath=[IO.Path]::GetFullPath($OutputPath)
if (!$OutputPath.StartsWith($privateRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Exported credentials must stay in .private.' }
if (Test-Path -LiteralPath $OutputPath) { throw 'Output exists; no files were overwritten.' }
$bridge=Get-Content -LiteralPath $Config -Raw | ConvertFrom-Json
if (!$DeviceId) {
    if (@($bridge.devices).Count -ne 1) { throw 'Use -DeviceId to select the card shown on the upload page.' }
    $DeviceId=$bridge.devices[0].id
}
$devices=@($bridge.devices | Where-Object { $_.id -eq $DeviceId })
if ($devices.Count -ne 1) { throw 'The selected card is not authorized in this bridge configuration.' }
$id=if ($bridge.server.id) { $bridge.server.id } else { $bridge.bluetooth.hostName }
$name=if ($bridge.server.name) { $bridge.server.name } else { $bridge.bluetooth.hostName }
$server=@{id=$id;name=$name;bluetoothName=$bridge.bluetooth.hostName;secret=$devices[0].secret;wifi=$null}
if ($WiFi) {
    if (!$BridgeAddress) { $BridgeAddress=$bridge.listen.host }
    $ip=$null
    if (![Net.IPAddress]::TryParse($BridgeAddress,[ref]$ip) -or $ip.AddressFamily -ne 'InterNetwork' -or $BridgeAddress.StartsWith('127.') -or $BridgeAddress -eq '0.0.0.0') { throw 'Specify the real computer LAN IPv4 using -BridgeAddress.' }
    $ssid=Read-Host 'This host 2.4 GHz Wi-Fi SSID'
    if (![Text.Encoding]::UTF8.GetByteCount($ssid) -or [Text.Encoding]::UTF8.GetByteCount($ssid) -gt 32) { throw 'SSID must be 1-32 UTF-8 bytes.' }
    $hidden=Read-Host 'This host Wi-Fi password (hidden)' -AsSecureString
    $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($hidden)
    try {
        $password=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
        $size=[Text.Encoding]::UTF8.GetByteCount($password)
        if ($size -gt 63 -or ($size -gt 0 -and $size -lt 8)) { throw 'Password must be empty or 8-63 UTF-8 bytes.' }
        $server.wifi=@{ssid=$ssid;password=$password;url="ws://${BridgeAddress}:$($bridge.listen.port)/device"}
    } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer);$password=$null }
}
@{version=2;deviceId=$DeviceId;skin='reading';allowLanPlaintext=$true;servers=@($server)} | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $OutputPath -Encoding utf8
Write-Host 'Device config exported with the existing binding key; no private values were printed.'
