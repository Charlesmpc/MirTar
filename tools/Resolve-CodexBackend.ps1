param([Parameter(Mandatory=$true)][string]$Config)
$ErrorActionPreference='Stop'
$settings=Get-Content -LiteralPath $Config -Raw | ConvertFrom-Json
$backend=[string]$settings.codex.bin
if(Test-Path -LiteralPath $backend -PathType Leaf){return $backend}
# Only relocate an explicitly configured Store backend. A custom CLI remains the user's choice.
if($backend -notmatch '[\\/]WindowsApps[\\/]OpenAI\.Codex_'){throw 'Configured Codex executable is unavailable; update the local bridge config.'}
$candidates=@(Get-AppxPackage -Name 'OpenAI.Codex' | Sort-Object Version -Descending | ForEach-Object {Join-Path $_.InstallLocation 'app\resources\codex.exe'} | Where-Object {Test-Path -LiteralPath $_ -PathType Leaf})
if(!$candidates.Count){throw 'Desktop Codex backend is unavailable; open or reinstall the desktop app.'}
return $candidates[0]
