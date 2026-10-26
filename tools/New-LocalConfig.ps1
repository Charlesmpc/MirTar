param([string]$SessionId, [string]$BridgeAddress, [ValidateRange(1024,65535)][int]$Port = 28743, [switch]$AddWiFi,
    [ValidatePattern('^[a-zA-Z0-9_-]{1,20}$')][string]$BluetoothName = $env:COMPUTERNAME, [switch]$BluetoothOnly, [switch]$NoWiFiPrompt, [string]$CodexBin, [string]$Name, [string]$ServerId, [ValidatePattern('^[a-zA-Z0-9_-]{1,40}$')][string]$DeviceId = 'mirtar-card-1', [switch]$BridgeOwned, [string]$WorkingDirectory)
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$privateDir = Join-Path $repoRoot '.private'
$devicePath = Join-Path $privateDir 'device.config.json'
$bridgePath = Join-Path $privateDir 'bridge.config.json'
if($BridgeOwned){
    if($AddWiFi -or $SessionId -or !$WorkingDirectory){throw 'BridgeOwned requires -WorkingDirectory and cannot be combined with AddWiFi or SessionId.'}
    $WorkingDirectory=(Resolve-Path -LiteralPath $WorkingDirectory).Path
    if(!(Test-Path -LiteralPath $WorkingDirectory -PathType Container)){throw 'WorkingDirectory must be an existing folder.'}
}
function Complete-OwnedSetup {
    if($BridgeOwned){& (Join-Path $PSScriptRoot 'New-AgentSession.ps1') -Config $bridgePath -WorkingDirectory $WorkingDirectory -Name 'mirtar #1'}
}
New-Item -ItemType Directory -Path $privateDir -Force | Out-Null
if ($AddWiFi) {
    $device = Get-Content -LiteralPath $devicePath -Raw | ConvertFrom-Json
    if ($device.version -ne 2) { throw 'Convert the old device file first with Convert-DeviceConfig.ps1.' }
    if (!$ServerId -and @($device.servers).Count -ne 1) { throw 'Use -ServerId to choose which host receives Wi-Fi.' }
    $chosen = @($device.servers | Where-Object { !$ServerId -or $_.id -eq $ServerId })
    if ($chosen.Count -ne 1) { throw 'ServerId must identify exactly one host.' }
    $server = $chosen[0]
} else {
    if ((Test-Path -LiteralPath $devicePath) -or (Test-Path -LiteralPath $bridgePath)) { throw 'Private configuration already exists. Edit it locally or use -AddWiFi; no files were overwritten.' }
    if (!$BridgeOwned -and !$SessionId) { $SessionId = Read-Host 'Existing Codex desktop thread UUID' }
    if (!$BridgeOwned -and $SessionId -notmatch '^[a-fA-F0-9-]{36}$') { throw 'Invalid native thread ID' }
    if (!$BridgeAddress) { $BridgeAddress = if ($BluetoothOnly) { '127.0.0.1' } else { Read-Host 'This Windows computer LAN IPv4 address' } }
    $parsedAddress = $null
    if (![Net.IPAddress]::TryParse($BridgeAddress, [ref]$parsedAddress) -or $parsedAddress.AddressFamily -ne 'InterNetwork') { throw 'Use a LAN IPv4 address' }
    $secretBytes = New-Object byte[] 32
    $random = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $random.GetBytes($secretBytes) } finally { $random.Dispose() }
    $secret = [BitConverter]::ToString($secretBytes).Replace('-','').ToLowerInvariant()
    if (!$ServerId) { $ServerId = [Guid]::NewGuid().ToString() }
    if ($ServerId -notmatch '^[a-zA-Z0-9_-]{1,40}$') { throw 'Invalid ServerId' }
    if (!$Name) { $Name = $env:COMPUTERNAME }
    if (!$Name -or [Text.Encoding]::UTF8.GetByteCount($Name) -gt 40 -or $Name -match '[\x00-\x1f\x7f]') { throw 'Server name must be 1-40 UTF-8 bytes without control characters.' }
    $server = [pscustomobject]@{id=$ServerId;name=$Name;bluetoothName=$BluetoothName;secret=$secret;wifi=$null}
    $device = [pscustomobject]@{version=2;deviceId=$DeviceId;skin='reading';allowLanPlaintext=$true;servers=@($server)}
    if (!$CodexBin) {
        $command = Get-Command codex -ErrorAction SilentlyContinue
        if ($command -and [IO.Path]::GetExtension($command.Source) -eq '.exe') { $CodexBin = $command.Source }
        elseif ($command) {
            # npm exposes a .ps1/.cmd shim; the bridge needs the real native executable.
            $npmRoot = Split-Path -Parent $command.Source
            $arch = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
            $platform = if ($arch -eq 'Arm64') { 'arm64'; } else { 'x64'; }
            $triple = if ($arch -eq 'Arm64') { 'aarch64-pc-windows-msvc'; } else { 'x86_64-pc-windows-msvc'; }
            $vendorRoots = @(
                (Join-Path $npmRoot "node_modules\@openai\codex\node_modules\@openai\codex-win32-$platform\vendor"),
                (Join-Path $npmRoot "node_modules\@openai\codex-win32-$platform\vendor"),
                (Join-Path $npmRoot 'node_modules\@openai\codex\vendor')
            )
            foreach ($vendorRoot in $vendorRoots) {
                foreach ($folder in @('bin','codex')) {
                    $candidate = Join-Path $vendorRoot "$triple\$folder\codex.exe"
                    if (Test-Path -LiteralPath $candidate -PathType Leaf) { $CodexBin = $candidate; break }
                }
                if ($CodexBin) { break }
            }
        }
        if (!$CodexBin) { $CodexBin = Read-Host 'Full path to the native Codex .exe (not the npm .ps1/.cmd wrapper)' }
    }
    if ([IO.Path]::GetExtension($CodexBin) -ne '.exe' -or !(Test-Path -LiteralPath $CodexBin -PathType Leaf)) { throw 'Provide the actual native Codex executable with -CodexBin.' }
    $bridge = @{version=1;server=@{id=$ServerId;name=$Name};bluetooth=@{enabled=$true;hostName=$BluetoothName};listen=@{host=$BridgeAddress;port=$Port;allowLanPlaintext=$true};devices=@(@{id=$device.deviceId;secret=$secret});codex=@{bin=$codexBin;edgePath='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe';sessions=@(@{id=$SessionId;name='mirtar #1'})}}
    if($BridgeOwned){$bridge.codex.sessions=@()}
}
if (($BluetoothOnly -or $NoWiFiPrompt) -and !$AddWiFi) {
    $device | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $devicePath -Encoding utf8
    $bridge | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $bridgePath -Encoding utf8
    Complete-OwnedSetup
    Write-Host 'Private computer configuration saved. Import device.config.json on the card setup page; home Wi-Fi credentials were not requested.'
    return
}
$ssid = Read-Host '2.4 GHz Wi-Fi name (SSID)'
if (![Text.Encoding]::UTF8.GetByteCount($ssid) -or [Text.Encoding]::UTF8.GetByteCount($ssid) -gt 32) { throw 'SSID must be 1–32 UTF-8 bytes' }
$securePassword = Read-Host 'Wi-Fi password (hidden; stays in local private configuration)' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
    $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    $passwordSize = [Text.Encoding]::UTF8.GetByteCount($password)
    if ($passwordSize -gt 63 -or ($passwordSize -gt 0 -and $passwordSize -lt 8)) { throw 'Password must be empty or 8-63 UTF-8 bytes' }
    if ($AddWiFi) {
        $currentUrl = if ($server.wifi) { $server.wifi.url } else { $null }
        if (!$currentUrl) { $currentUrl = Read-Host 'This host bridge URL (ws://LAN_IP:28743/device)' }
    } else { $currentUrl = "ws://${BridgeAddress}:${Port}/device" }
    $server.wifi = [pscustomobject]@{ssid=$ssid;password=$password;url=$currentUrl}
    $device | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $devicePath -Encoding utf8
    if (!$AddWiFi) { $bridge | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $bridgePath -Encoding utf8 }
} finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $password = $null }
Complete-OwnedSetup
Write-Host 'Host Wi-Fi saved in private version 2 configuration. Values were not printed.'
Write-Host 'Update one host with -AddWiFi -ServerId ID. Import the device file with Add config-file.'
