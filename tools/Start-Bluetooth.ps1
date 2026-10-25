param([string]$HostName, [switch]$CompileOnly, [switch]$Pairing)
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$source = Join-Path $repoRoot 'bridge\native\BluetoothWorker.cs'
$outputDir = Join-Path $repoRoot '.private\native'
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$compilerRoot = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$metadata = Join-Path $env:WINDIR 'System32\WinMetadata'
$hash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
$exe = Join-Path $outputDir ('MirTar-Bluetooth-' + $hash.Substring(0,12) + '.exe')
$hashPath = $exe + '.sha256'
if (!(Test-Path $exe) -or !(Test-Path $hashPath) -or (Get-Content $hashPath -Raw).Trim() -ne $hash) {
    $references = @('System.dll','System.Core.dll','System.Web.Extensions.dll','System.Windows.Forms.dll','System.Drawing.dll',
        (Join-Path $compilerRoot 'System.Runtime.dll'), (Join-Path $compilerRoot 'System.Runtime.WindowsRuntime.dll'),
        (Join-Path $compilerRoot 'System.Threading.Tasks.dll'),
        (Join-Path $compilerRoot 'System.ObjectModel.dll'), (Join-Path $compilerRoot 'System.Runtime.InteropServices.WindowsRuntime.dll'),
        (Join-Path $metadata 'Windows.Devices.winmd'), (Join-Path $metadata 'Windows.Foundation.winmd'),
        (Join-Path $metadata 'Windows.Storage.winmd'))
    $compilerArgs = @('/nologo', '/target:exe', ('/out:' + $exe)) + @($references | ForEach-Object { '/r:' + $_ }) + $source
    $diagnostic = & (Join-Path $compilerRoot 'csc.exe') @compilerArgs 2>&1
    if ($LASTEXITCODE -ne 0) { [Console]::Error.WriteLine(($diagnostic -join "`n")); throw 'Bluetooth worker build failed' }
    Set-Content -LiteralPath $hashPath -Value $hash -Encoding ASCII
}
if (!$CompileOnly) {
    if ($Pairing) { & $exe $HostName '--pair' } else { & $exe $HostName }
    exit $LASTEXITCODE
}
