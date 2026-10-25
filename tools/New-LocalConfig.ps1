param([string]$SessionId, [string]$BridgeAddress, [ValidateRange(1024,65535)][int]$Port = 28743, [switch]$AddWiFi,
    [ValidatePattern('^[a-zA-Z0-9_-]{1,20}$')][string]$BluetoothName = $env:COMPUTERNAME, [switch]$BluetoothOnly)
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$privateDir = Join-Path $repoRoot '.private'
$devicePath = Join-Path $privateDir 'device.config.json'
$bridgePath = Join-Path $privateDir 'bridge.config.json'
New-Item -ItemType Directory -Path $privateDir -Force | Out-Null
if ($AddWiFi) {
    $device = Get-Content -LiteralPath $devicePath -Raw | ConvertFrom-Json
    if (@($device.wifiNetworks).Count -ge 8) { throw 'At most 8 Wi-Fi networks' }
} else {
    if ((Test-Path -LiteralPath $devicePath) -or (Test-Path -LiteralPath $bridgePath)) { throw 'Private configuration already exists. Edit it locally or use -AddWiFi; no files were overwritten.' }
    if (!$SessionId) { $SessionId = Read-Host 'Existing Codex desktop thread UUID' }
    if ($SessionId -notmatch '^[a-fA-F0-9-]{36}$') { throw 'Invalid native thread ID' }
    if (!$BridgeAddress) { $BridgeAddress = if ($BluetoothOnly) { '127.0.0.1' } else { Read-Host 'This Windows computer LAN IPv4 address' } }
    $parsedAddress = $null
    if (![Net.IPAddress]::TryParse($BridgeAddress, [ref]$parsedAddress) -or $parsedAddress.AddressFamily -ne 'InterNetwork') { throw 'Use a LAN IPv4 address' }
    $secretBytes = New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Fill($secretBytes)
    $secret = [Convert]::ToHexString($secretBytes).ToLowerInvariant()
    $device = [pscustomobject]@{version=1;deviceId='mirtar-card-1';skin='reading';allowLanPlaintext=$true;wifiNetworks=@();targets=@(@{name=$BluetoothName;bluetoothName=$BluetoothName;url="ws://${BridgeAddress}:${Port}/device";secret=$secret})}
    $codexBin = (Get-Command codex -ErrorAction Stop).Source
    $bridge = @{version=1;bluetooth=@{enabled=$true;hostName=$BluetoothName};listen=@{host=$BridgeAddress;port=$Port;allowLanPlaintext=$true};devices=@(@{id=$device.deviceId;secret=$secret});codex=@{bin=$codexBin;edgePath='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe';sessions=@(@{id=$SessionId;name='mirtar #1'})}}
}
if ($BluetoothOnly -and !$AddWiFi) {
    $device | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $devicePath -Encoding utf8
    $bridge | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $bridgePath -Encoding utf8
    Write-Host 'Bluetooth-only private configuration saved. No Wi-Fi credentials required.'
    return
}
$ssid = Read-Host '2.4 GHz Wi-Fi name (SSID)'
if (![Text.Encoding]::UTF8.GetByteCount($ssid) -or [Text.Encoding]::UTF8.GetByteCount($ssid) -gt 32) { throw 'SSID must be 1–32 UTF-8 bytes' }
$securePassword = Read-Host 'Wi-Fi password (hidden; stays in local private configuration)' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
    $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    if ([Text.Encoding]::UTF8.GetByteCount($password) -gt 63) { throw 'Password exceeds 63 UTF-8 bytes' }
    $device.wifiNetworks = @($device.wifiNetworks) + @(@{ssid=$ssid;password=$password})
    $device | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $devicePath -Encoding utf8
    if (!$AddWiFi) { $bridge | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $bridgePath -Encoding utf8 }
} finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $password = $null }
Write-Host "Private configuration saved. Wi-Fi entries: $(@($device.wifiNetworks).Count). Values were not printed."
Write-Host 'Add another network with tools\New-LocalConfig.ps1 -AddWiFi, or edit .private\device.config.json locally.'
