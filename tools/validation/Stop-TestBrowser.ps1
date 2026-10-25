param([Parameter(Mandatory = $true)][string]$ProfilePath)
$ErrorActionPreference = 'Stop'
$taskRepoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$taskAllowedPrefix = (Join-Path $taskRepoRoot '.private\codex-validation\rtc-profile-')
$taskProfile = [IO.Path]::GetFullPath($ProfilePath)
if (-not $taskProfile.StartsWith($taskAllowedPrefix, [StringComparison]::OrdinalIgnoreCase) -or
    (Split-Path -Leaf $taskProfile) -notmatch '^rtc-profile-[0-9a-f-]{36}$') {
    throw 'Refusing cleanup outside a MirTar WebRTC test profile'
}
$taskMatch = [regex]::Escape($taskProfile) + '(?=["\s]|$)'
$taskProcesses = @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" |
    Where-Object { $_.CommandLine -match $taskMatch })
foreach ($taskProcess in $taskProcesses) {
    Stop-Process -Id $taskProcess.ProcessId -Force -ErrorAction SilentlyContinue
}
$taskRemaining = @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" |
    Where-Object { $_.CommandLine -match $taskMatch })
[pscustomobject]@{ Matched = $taskProcesses.Count; Remaining = $taskRemaining.Count } | ConvertTo-Json -Compress
if ($taskRemaining.Count -gt 0) { exit 1 }
