param([string]$Config, [switch]$CompileCheck, [string]$BuildDirectory)
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (!$Config) { $Config = Join-Path $repoRoot '.private\device.config.json' }
$Config = [IO.Path]::GetFullPath($Config)
if (!$BuildDirectory) { $BuildDirectory = Join-Path $repoRoot 'firmware\build' }
$BuildDirectory = [IO.Path]::GetFullPath($BuildDirectory)
$settings = Get-Content -LiteralPath $Config -Raw | ConvertFrom-Json
if ($settings.template -and !$CompileCheck) { throw 'Fill a private configuration first. Template builds require -CompileCheck and are not ready for device use.' }
$env:IDF_TOOLS_PATH = Join-Path $repoRoot '.private\toolchains\idf-tools'
$env:MIRTAR_DEVICE_CONFIG = $Config
$idfRoot = Join-Path $repoRoot '.private\toolchains\esp-idf-v5.5.6'
python (Join-Path $repoRoot 'tools\patch_windows_compiler_query.py') $idfRoot
if ($LASTEXITCODE) { throw 'Private SDK build helper could not be prepared' }
. (Join-Path $idfRoot 'export.ps1')
$version = idf.py --version
if ($version -notmatch 'ESP-IDF v5\.5\.6') { throw 'ESP-IDF 5.5.6 required' }
Push-Location (Join-Path $repoRoot 'firmware')
try {
    # The configuration path is supplied via an environment variable, which Ninja
    # does not track. Reconfigure explicitly so a previous template is never reused.
    # Keep sdkconfig beside this build. An older Wi-Fi-only sdkconfig must not
    # silently override Bluetooth defaults, and separate builds stay isolated.
    idf.py -B $BuildDirectory -D "SDKCONFIG=$BuildDirectory/sdkconfig" reconfigure
    if ($LASTEXITCODE) { throw 'Firmware reconfigure failed' }
    idf.py -B $BuildDirectory build
    if ($LASTEXITCODE) { throw 'Firmware build failed; no artifact is validated' }
    idf.py -B $BuildDirectory merge-bin -o MirTar-full.bin
    if ($LASTEXITCODE) { throw 'Firmware merge failed' }
    python (Join-Path $repoRoot 'tools\verify_firmware.py') $BuildDirectory
    if ($LASTEXITCODE) { throw 'Firmware verification failed' }
    if ($CompileCheck) { Write-Host 'COMPILE CHECK ONLY: template configuration, not ready for actual Wi-Fi/binding.' }
} finally { Pop-Location }
