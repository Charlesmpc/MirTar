param([string]$Config, [Parameter(Mandatory=$true)][string]$WorkingDirectory, [string]$Name='MirTar Agent')
$ErrorActionPreference='Stop'
$repoRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if(!$Config){$Config=Join-Path $repoRoot '.private\bridge.config.json'}
$Config=[IO.Path]::GetFullPath($Config)
$WorkingDirectory=(Resolve-Path -LiteralPath $WorkingDirectory).Path
Push-Location $repoRoot
try{node tools/new-agent-session.ts $Config $WorkingDirectory $Name;if($LASTEXITCODE){throw 'Session setup failed; see the private setup receipt if one was created.'}}finally{Pop-Location}
