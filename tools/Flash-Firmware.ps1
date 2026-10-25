[CmdletBinding(SupportsShouldProcess=$true)]
param([Parameter(Mandatory=$true)][ValidatePattern('^COM[0-9]+$')][string]$Port, [switch]$PreserveNvs, [string]$BuildDirectory)
$ErrorActionPreference = 'Stop'
function Get-VerifiedSha256([string]$Path) {
    # Windows PowerShell's Get-FileHash can inherit -WhatIf and return no hash.
    # Direct read-only hashing keeps preview verification active in both PS5/7.
    $stream = [IO.File]::OpenRead($Path)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','').ToLowerInvariant() }
    finally { $sha.Dispose(); $stream.Dispose() }
}
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$build = if ($BuildDirectory) { [IO.Path]::GetFullPath($BuildDirectory) } else { Join-Path $repoRoot 'firmware\build' }
$manifest = Get-Content -LiteralPath (Join-Path $build 'mirtar-manifest.json') -Raw | ConvertFrom-Json
if ($manifest.templateConfiguration -ne $false) { throw 'This is a template compile-check build. Fill private configuration and build again before flashing.' }
$full = Join-Path $build 'MirTar-full.bin'
if ((Get-VerifiedSha256 $full) -ne $manifest.sha256) { throw 'Firmware hash does not match the verified build' }
if ($manifest.chip -ne 'esp32c3' -or $manifest.sdk -ne '5.5.6') { throw 'Unexpected firmware target' }
if ($PreserveNvs) {
    $parts = Get-Content -LiteralPath (Join-Path $build 'flasher_args.json') -Raw | ConvertFrom-Json
    $flashArgs = @()
    foreach ($property in $parts.flash_files.PSObject.Properties) {
        $partPath = Join-Path $build $property.Value
        $record = $manifest.segments.PSObject.Properties[$property.Name].Value
        if (!$record -or (Get-VerifiedSha256 $partPath) -ne $record.sha256) { throw 'Segment does not match the verified firmware bundle' }
        $flashArgs += @($property.Name, $partPath)
    }
    Write-Host 'Segmented flash: confirm the existing partition layout is compatible; NVS is not written.'
} else {
    $flashArgs = @('0x0', $full)
    Write-Host 'Merged flash replaces the application and may reset stored settings. No whole-chip erase is used.'
}
$pythonExe = Join-Path $repoRoot '.private\toolchains\idf-tools\python_env\idf5.5_py3.12_env\Scripts\python.exe'
if ($PSCmdlet.ShouldProcess($Port, "Flash verified MirTar image SHA256 $($manifest.sha256)")) {
    & $pythonExe -m esptool --chip esp32c3 --port $Port --baud 460800 write_flash @flashArgs
    if ($LASTEXITCODE) { throw 'Flashing failed. Device behaviour has not been validated.' }
    Write-Host 'Flash completed. Startup, Wi-Fi binding, recording and replies still need device validation.'
}
