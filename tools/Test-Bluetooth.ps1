$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
& (Join-Path $PSScriptRoot 'Start-Bluetooth.ps1') -CompileOnly
if ($LASTEXITCODE) { throw 'Bluetooth worker compilation failed' }
$output = Join-Path $repoRoot '.private\host-tests'
New-Item -ItemType Directory -Force -Path $output | Out-Null
$exe = Join-Path $output 'BleNotificationGateTest.exe'
$receipt = Join-Path $output 'ble-notification-gate.receipt.txt'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $compiler /nologo /target:exe ('/out:' + $exe) (Join-Path $repoRoot 'bridge\native\BleNotificationGate.cs') (Join-Path $repoRoot 'bridge\tests\BleNotificationGateTest.cs')
if ($LASTEXITCODE) { throw 'Bluetooth lifecycle test compilation failed' }
if (Test-Path -LiteralPath $receipt) { Remove-Item -LiteralPath $receipt }
& $exe $receipt
if ($LASTEXITCODE -or !(Test-Path -LiteralPath $receipt)) { throw 'Bluetooth lifecycle tests did not produce a success receipt' }
$result = [IO.File]::ReadAllText($receipt)
if (!$result.StartsWith('PASS:')) { throw 'Bluetooth lifecycle tests failed' }
Write-Output $result.Trim()
