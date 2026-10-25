param([string]$HostName, [switch]$CompileOnly, [switch]$Pairing, [switch]$ForgetPairing)
$ErrorActionPreference = 'Stop'
if ($Pairing -and $ForgetPairing) { throw 'Pairing and ForgetPairing cannot be combined.' }
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$source = Join-Path $repoRoot 'bridge\native\BluetoothWorker.cs'
$gateSource = Join-Path $repoRoot 'bridge\native\BleNotificationGate.cs'
$outputDir = Join-Path $repoRoot '.private\native'
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$compilerRoot = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$metadata = Join-Path $env:WINDIR 'System32\WinMetadata'
$hashInput = [IO.File]::ReadAllText($source) + [IO.File]::ReadAllText($gateSource)
$hasher = [Security.Cryptography.SHA256]::Create()
try { $hash = [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($hashInput))).Replace('-', '') }
finally { $hasher.Dispose() }
$exe = Join-Path $outputDir ('MirTar-Bluetooth-' + $hash.Substring(0,12) + '.exe')
$hashPath = $exe + '.sha256'
if (!(Test-Path $exe) -or !(Test-Path $hashPath) -or (Get-Content $hashPath -Raw).Trim() -ne $hash) {
    $references = @('System.dll','System.Core.dll','System.Web.Extensions.dll','System.Windows.Forms.dll','System.Drawing.dll',
        (Join-Path $compilerRoot 'System.Runtime.dll'), (Join-Path $compilerRoot 'System.Runtime.WindowsRuntime.dll'),
        (Join-Path $compilerRoot 'System.Threading.Tasks.dll'),
        (Join-Path $compilerRoot 'System.ObjectModel.dll'), (Join-Path $compilerRoot 'System.Runtime.InteropServices.WindowsRuntime.dll'),
        (Join-Path $metadata 'Windows.Devices.winmd'), (Join-Path $metadata 'Windows.Foundation.winmd'),
        (Join-Path $metadata 'Windows.Storage.winmd'))
    $compilerArgs = @('/nologo', '/target:exe', ('/out:' + $exe)) + @($references | ForEach-Object { '/r:' + $_ }) + @($source, $gateSource)
    $diagnostic = & (Join-Path $compilerRoot 'csc.exe') @compilerArgs 2>&1
    if ($LASTEXITCODE -ne 0) { [Console]::Error.WriteLine(($diagnostic -join "`n")); throw 'Bluetooth worker build failed' }
    Set-Content -LiteralPath $hashPath -Value $hash -Encoding ASCII
}
if (!$CompileOnly) {
    if ($ForgetPairing) { & $exe $HostName '--forget' }
    elseif ($Pairing) { & $exe $HostName '--pair' } else { & $exe $HostName }
    exit $LASTEXITCODE
}
