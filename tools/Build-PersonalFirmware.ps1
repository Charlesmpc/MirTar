param([Parameter(Mandatory=$true)][string]$Config, [ValidatePattern('^[a-z0-9][a-z0-9-]{0,19}$')][string]$Name = 'personal', [string]$PublicBuildDirectory, [string]$OutputDirectory)
$ErrorActionPreference='Stop'
$repoRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$version=(Get-Content -Raw (Join-Path $repoRoot 'package.json') | ConvertFrom-Json).version
if (!$PublicBuildDirectory) { $PublicBuildDirectory=Join-Path $repoRoot ('.private\build-v'+$version) }
if (!$OutputDirectory) { $OutputDirectory=Join-Path $repoRoot ('.private\build-v'+$version+'-'+$Name) }
$python=Join-Path $repoRoot '.private\toolchains\idf-tools\python_env\idf5.5_py3.12_env\Scripts\python.exe'
& $python (Join-Path $repoRoot 'tools\package_personal_firmware.py') --public-build $PublicBuildDirectory --config $Config --name $Name --output $OutputDirectory
if ($LASTEXITCODE) { throw 'Personal image generation failed. No device was flashed.' }
Write-Host 'PERSONAL IMAGE ONLY. Complete flashing replaces NVS, including old Bluetooth bonds. Never upload this image.'
