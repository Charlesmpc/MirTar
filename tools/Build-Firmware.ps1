param([string]$Config, [switch]$CompileCheck, [string]$BuildDirectory, [ValidateRange(1,32)][int]$Jobs = 2)
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if ($Config) { throw 'Firmware no longer embeds configuration. Import your device.config.json through the card Wi-Fi setup page after flashing.' }
if (!$BuildDirectory) {
    $buildVersion = (Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json).version
    $BuildDirectory = Join-Path $repoRoot ('.private\build-v' + $buildVersion)
}
$BuildDirectory = [IO.Path]::GetFullPath($BuildDirectory)
$env:IDF_TOOLS_PATH = Join-Path $repoRoot '.private\toolchains\idf-tools'
$env:CCACHE_DISABLE = '1'
Remove-Item Env:MIRTAR_DEVICE_CONFIG -ErrorAction SilentlyContinue
$idfRoot = Join-Path $repoRoot '.private\toolchains\esp-idf-v5.5.6'
python (Join-Path $repoRoot 'tools\patch_windows_compiler_query.py') $idfRoot
if ($LASTEXITCODE) { throw 'Private SDK build helper could not be prepared' }
. (Join-Path $idfRoot 'export.ps1')
$version = idf.py --version
if ($version -notmatch 'ESP-IDF v5\.5\.6') { throw 'ESP-IDF 5.5.6 required' }
Push-Location (Join-Path $repoRoot 'firmware')
try {
    # Each build owns its SDK settings. No private configuration is a build input.
    idf.py -B $BuildDirectory -D "SDKCONFIG=$BuildDirectory/sdkconfig" reconfigure
    if ($LASTEXITCODE) { throw 'Firmware reconfigure failed' }
    ninja -C $BuildDirectory -j $Jobs
    if ($LASTEXITCODE) { throw 'Firmware build failed; no artifact is validated' }
    idf.py -B $BuildDirectory merge-bin -o MirTar-full.bin
    if ($LASTEXITCODE) { throw 'Firmware merge failed' }
    python (Join-Path $repoRoot 'tools\verify_firmware.py') $BuildDirectory
    if ($LASTEXITCODE) { throw 'Firmware verification failed' }
    if ($CompileCheck) { Write-Host 'Build checked. Runtime configuration is performed on the card setup page.' }
} finally { Pop-Location }
