[CmdletBinding()]
param(
    [ValidateSet('Install','Start','Stop','Restart','Status','Logs','Uninstall')][string]$Action='Status',
    [string]$Config,[switch]$NoStart,[switch]$ReplaceExisting
)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$repoRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if(!$Config){$Config=Join-Path $repoRoot '.private\bridge.config.json'}
$Config=[IO.Path]::GetFullPath($Config)
$sha=[Security.Cryptography.SHA256]::Create()
try{$identity=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Config.ToLowerInvariant())))).Replace('-','').Substring(0,12).ToLowerInvariant()}finally{$sha.Dispose()}
$taskName='MirTar-Bridge-'+$identity
$stateDirectory=Join-Path $repoRoot ('.private\bridge-service\'+$identity)
$runner=Join-Path $PSScriptRoot 'Run-BridgeService.ps1'
$description='MirTar managed bridge '+$identity

function Get-ManagedTask {
    $task=Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue
    if($task -and ($task.Description -ne $description -or $task.Actions.Arguments -notlike ('*'+$runner+'*'))){throw 'Task name belongs to another installation; no task was changed.'}
    return $task
}
function Get-Runtime {
    $path=Join-Path $stateDirectory 'runtime.local.json'
    if(Test-Path -LiteralPath $path){try{return (Get-Content -LiteralPath $path -Raw | ConvertFrom-Json)}catch{return $null}}
    return $null
}
function Get-OwnedProcess($runtime) {
    if(!$runtime -or !$runtime.supervisorPid){return $null}
    $process=Get-CimInstance Win32_Process -Filter ('ProcessId = '+[int]$runtime.supervisorPid)
    if($process -and $process.Name -eq 'node.exe' -and $process.CommandLine -and $process.CommandLine.Replace('/','\').Contains($stateDirectory) -and $process.CommandLine -match 'run-bridge-service\.ts'){return $process}
    return $null
}
function Show-Status {
    $task=Get-ManagedTask;$runtime=Get-Runtime
    $running=[bool](Get-OwnedProcess $runtime)
    $phase=if($running){$runtime.phase}elseif($task -and [string]$task.State -in @('Running','Queued')){'Starting'}elseif($runtime -and $runtime.phase -eq 'failed'){'Failed'}else{'Stopped'}
    [pscustomobject]@{TaskName=$taskName;Installed=[bool]$task;TaskState=$(if($task){[string]$task.State}else{'NotInstalled'});BridgeState=$phase;AutoStartAtLogin=([bool]($task -and $task.Triggers.Count));BridgePid=$(if($running){$runtime.bridgePid}else{$null});Config=$Config;Log=(Join-Path $stateDirectory 'bridge.log')}
}
function Stop-ManagedBridge {
    $task=Get-ManagedTask
    if(!$task -or [string]$task.State -ne 'Running'){return}
    $runtime=Get-Runtime
    if(Get-OwnedProcess $runtime){
        $temporary=Join-Path $stateDirectory ([guid]::NewGuid().ToString()+'.tmp')
        [IO.File]::WriteAllText($temporary,(@{nonce=$runtime.nonce}|ConvertTo-Json -Compress),(New-Object Text.UTF8Encoding($false)))
        Move-Item -LiteralPath $temporary -Destination (Join-Path $stateDirectory 'stop.local.json') -Force
    } else {
        # A task that has not launched its supervisor yet has no active card work.
        Stop-ScheduledTask -TaskName $taskName
    }
    $deadline=[DateTime]::UtcNow.AddSeconds(30)
    do {
        if([string](Get-ManagedTask).State -ne 'Running'){return}
        Start-Sleep -Milliseconds 250
    } while([DateTime]::UtcNow -lt $deadline)
    throw 'Bridge is still stopping; inspect Status and the private log before retrying.'
}
function Stop-PreviousBridge {
    $settings=Get-Content -LiteralPath $Config -Raw | ConvertFrom-Json
    $port=[int]$settings.listen.port
    $seen=@{}
    foreach($listener in @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)){
        if($seen.ContainsKey([string]$listener.OwningProcess)){continue};$seen[[string]$listener.OwningProcess]=$true
        $process=Get-CimInstance Win32_Process -Filter ('ProcessId = '+[int]$listener.OwningProcess)
        if(!$process -or $process.Name -ne 'node.exe' -or !$process.CommandLine -or $process.CommandLine -notmatch 'bridge[/\\]src[/\\]main\.ts' -or $process.CommandLine.Replace('/','\').IndexOf($Config,[StringComparison]::OrdinalIgnoreCase) -lt 0){
            throw 'Configured port belongs to another process. It was not stopped.'
        }
        $owner=Invoke-CimMethod -InputObject $process -MethodName GetOwnerSid
        if($owner.Sid -ne [Security.Principal.WindowsIdentity]::GetCurrent().User.Value){throw 'Existing bridge belongs to another user. It was not stopped.'}
        if(!$ReplaceExisting){throw 'A foreground bridge is already running. Stop it first, or install with -ReplaceExisting to migrate this verified bridge.'}
        # Only this config's verified Node process tree; never the desktop Agent.
        & taskkill.exe /PID ([string]$process.ProcessId) /T /F | Out-Null
        if($LASTEXITCODE){throw 'Previous bridge did not stop; no replacement was started.'}
    }
}

switch($Action){
    'Install' {
        if(!(Test-Path -LiteralPath $Config -PathType Leaf)){throw 'Create the local bridge configuration before installing the service.'}
        $node=(Get-Command node.exe -ErrorAction Stop).Source
        $version=[version]((& $node --version).Trim().TrimStart('v'))
        if($version -lt [version]'24.13.0'){throw 'Node.js 24.13.0 or newer is required.'}
        $existing=Get-ManagedTask
        $needsMigration=(!$existing -or [string]$existing.State -ne 'Running')
        New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
        $arguments='-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+$runner+'" -Config "'+$Config+'" -StateDirectory "'+$stateDirectory+'" -NodePath "'+$node+'"'
        $executable=Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $taskAction=New-ScheduledTaskAction -Execute $executable -Argument $arguments -WorkingDirectory $repoRoot
        $user=[Security.Principal.WindowsIdentity]::GetCurrent()
        $principal=New-ScheduledTaskPrincipal -UserId $user.User.Value -LogonType Interactive -RunLevel Limited
        $trigger=New-ScheduledTaskTrigger -AtLogOn -User $user.Name
        $trigger.Delay='PT10S'
        $settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
        $task=New-ScheduledTask -Action $taskAction -Trigger $trigger -Principal $principal -Settings $settings -Description $description
        Register-ScheduledTask -TaskName $taskName -TaskPath '\' -InputObject $task -Force | Out-Null
        if(!$NoStart){if($needsMigration){Stop-PreviousBridge};Start-ScheduledTask -TaskName $taskName}
        Show-Status
    }
    'Start' {
        $task=Get-ManagedTask;if(!$task){throw 'Install the bridge service first with -Action Install.'}
        if([string]$task.State -ne 'Running'){Stop-PreviousBridge;Start-ScheduledTask -TaskName $taskName}
        Show-Status
    }
    'Stop' {Stop-ManagedBridge;Show-Status}
    'Restart' {
        if(!(Get-ManagedTask)){throw 'Install the bridge service first.'}
        Stop-ManagedBridge;Stop-PreviousBridge;Start-ScheduledTask -TaskName $taskName;Show-Status
    }
    'Status' {Show-Status}
    'Logs' {
        $path=Join-Path $stateDirectory 'bridge.log'
        if(!(Test-Path -LiteralPath $path)){throw 'No bridge log yet. Check Status and the launcher logs in the private service folder.'}
        Get-Content -LiteralPath $path -Tail 50
    }
    'Uninstall' {
        Stop-ManagedBridge
        if(Get-ManagedTask){Unregister-ScheduledTask -TaskName $taskName -TaskPath '\' -Confirm:$false}
        Show-Status
    }
}
