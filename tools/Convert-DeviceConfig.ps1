param([string]$InputPath, [string]$OutputPath, [hashtable]$ServerWiFiIndex)
$ErrorActionPreference='Stop'
$repoRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$privateRoot=Join-Path $repoRoot '.private'
if (!$InputPath) { $InputPath=Join-Path $privateRoot 'device.config.json' }
if (!$OutputPath) { $OutputPath=Join-Path $privateRoot 'device.v2.config.json' }
$OutputPath=[IO.Path]::GetFullPath($OutputPath)
if (!$OutputPath.StartsWith($privateRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Converted credentials must stay inside .private.' }
if (Test-Path -LiteralPath $OutputPath) { throw 'Output exists; no file was overwritten.' }
$old=Get-Content -LiteralPath $InputPath -Raw | ConvertFrom-Json
if ($old.version -ne 1 -or $old.template -or !@($old.targets).Count) { throw 'Expected a real version 1 device configuration.' }
$servers=@()
foreach ($target in $old.targets) {
    $bt=if ($target.bluetoothName) { $target.bluetoothName } else { $target.name }
    $wifi=$null
    $networks=@($old.wifiNetworks)
    if ($networks.Count) {
        if ($networks.Count -eq 1) { $index=0 }
        elseif ($ServerWiFiIndex -and $ServerWiFiIndex.ContainsKey($bt)) { $index=[int]$ServerWiFiIndex[$bt] }
        else { throw 'Multiple old networks: provide -ServerWiFiIndex mapping each Bluetooth name to a zero-based network index. No output written.' }
        if ($index -lt 0 -or $index -ge $networks.Count) { throw 'Network index out of range.' }
        $wifi=@{ssid=$networks[$index].ssid;password=$networks[$index].password;url=$target.url}
    }
    $servers+=@(@{id=$bt;name=$target.name;bluetoothName=$bt;secret=$target.secret;wifi=$wifi})
}
$next=@{version=2;deviceId=$old.deviceId;skin=$old.skin;allowLanPlaintext=$old.allowLanPlaintext;servers=$servers}
$next | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $OutputPath -Encoding utf8
Write-Host "Converted $($servers.Count) hosts. Original file untouched; private values were not printed."
