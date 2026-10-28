param([string]$Config, [string]$WorkingDirectory, [string]$Name='MirTar Agent')
$ErrorActionPreference='Stop'
$repoRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if(!$Config){$Config=Join-Path $repoRoot '.private\bridge.config.json'}
$Config=[IO.Path]::GetFullPath($Config)
if($WorkingDirectory){$WorkingDirectory=[IO.Path]::GetFullPath($WorkingDirectory)}
Push-Location $repoRoot
try{node tools/new-agent-session.ts $Config "$(if($WorkingDirectory){$WorkingDirectory}else{'--default'})" $Name;if($LASTEXITCODE){throw 'Session setup failed; see the message above. Existing bindings were preserved.'}}finally{Pop-Location}
