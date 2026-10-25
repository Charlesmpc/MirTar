$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$fixture = Join-Path $repoRoot ('.private\host-tests\bridge-recovery-' + [Guid]::NewGuid().ToString('N'))
$fixtureTools = Join-Path $fixture 'tools'
New-Item -ItemType Directory -Force -Path $fixtureTools | Out-Null
foreach ($name in @('Start-Bridge.ps1','Reset-BluetoothPairing.ps1')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $fixtureTools $name)
}
$config = Join-Path $fixture 'test.json'
[IO.File]::WriteAllText($config, '{"bluetooth":{"hostName":"TestLaptop"}}')
$recoveryTest = [PSCustomObject]@{Receipt=(Join-Path $fixture 'explicit-reset.txt'); ExitCode=0; NodeCalls=0; Running=$false}
# Only this isolated test process has these mocks. No real Bluetooth API/process is accessed.
function Get-Process { param([string]$Name) if ($recoveryTest.Running) { [PSCustomObject]@{Id=1} } }
function node { param([string]$Script,[string]$Config) $recoveryTest.NodeCalls++ }
@'
param([string]$HostName,[switch]$ForgetPairing)
if ($HostName -ne 'TestLaptop' -or !$ForgetPairing) { throw 'Incorrect reset target/flag' }
[IO.File]::WriteAllText($recoveryTest.Receipt, 'called')
& $env:ComSpec /c exit ($recoveryTest.ExitCode)
'@ | Set-Content -LiteralPath (Join-Path $fixtureTools 'Start-Bluetooth.ps1') -Encoding UTF8

& (Join-Path $fixtureTools 'Start-Bridge.ps1') -Config $config
if (Test-Path -LiteralPath $recoveryTest.Receipt) { throw 'Default startup reset a pairing' }
if ($recoveryTest.NodeCalls -ne 1) { throw 'Default startup did not run bridge' }

$recoveryTest.Running = $true
$blocked = $false
try { & (Join-Path $fixtureTools 'Start-Bridge.ps1') -Config $config -ResetBluetoothPairing } catch { $blocked = $true }
if (!$blocked -or (Test-Path -LiteralPath $recoveryTest.Receipt) -or $recoveryTest.NodeCalls -ne 1) {
    throw 'Active-worker guard did not stop reset/startup'
}

$recoveryTest.Running = $false
& (Join-Path $fixtureTools 'Start-Bridge.ps1') -Config $config -ResetBluetoothPairing
if (!(Test-Path -LiteralPath $recoveryTest.Receipt) -or $recoveryTest.NodeCalls -ne 2) {
    throw 'Explicit reset was not completed before startup'
}

$recoveryTest.ExitCode = 1
$blocked = $false
try { & (Join-Path $fixtureTools 'Start-Bridge.ps1') -Config $config -ResetBluetoothPairing } catch { $blocked = $true }
if (!$blocked -or $recoveryTest.NodeCalls -ne 2) { throw 'Failed reset still started bridge' }
Write-Output 'PASS: ordinary startup never resets; explicit reset targets config; active worker/failure block startup. No device was accessed.'
