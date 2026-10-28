param([Parameter(Mandatory=$true)][string]$Config,[Parameter(Mandatory=$true)][string]$StateDirectory,[Parameter(Mandatory=$true)][string]$NodePath)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$repoRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
try {
    New-Item -ItemType Directory -Path $StateDirectory -Force | Out-Null
    $backend=& (Join-Path $PSScriptRoot 'Resolve-CodexBackend.ps1') -Config $Config
    $env:MIRTAR_CODEX_BIN=$backend
    $arguments='"'+(Join-Path $repoRoot 'tools\run-bridge-service.ts')+'" "'+$Config+'" "'+$StateDirectory+'"'
    $child=Start-Process -FilePath $NodePath -ArgumentList $arguments -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $StateDirectory 'launcher-stdout.log') -RedirectStandardError (Join-Path $StateDirectory 'launcher-stderr.log') -PassThru -Wait
    exit ([int]$child.ExitCode)
} catch {
    if(Test-Path -LiteralPath $StateDirectory){[IO.File]::AppendAllText((Join-Path $StateDirectory 'launcher-error.log'),($_.Exception.Message+[Environment]::NewLine))}
    exit 1
}
