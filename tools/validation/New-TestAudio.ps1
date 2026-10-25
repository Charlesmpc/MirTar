# Run with Windows PowerShell (powershell.exe), which includes System.Speech.
# Offline fixture only: no microphone, network request, playback, or Agent input.
param([ValidateSet('recognition', 'agent-task')][string]$Scenario = 'recognition')
$ErrorActionPreference = 'Stop'
$taskRepoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$taskOutputDirectory = Join-Path $taskRepoRoot '.private\codex-validation'
$taskFileName = if ($Scenario -eq 'agent-task') { 'synthetic-agent-task.wav' } else { 'synthetic-input.wav' }
$taskOutputPath = Join-Path $taskOutputDirectory $taskFileName
$taskText = if ($Scenario -eq 'agent-task') {
    'Please run a local PowerShell command to calculate seven hundred and thirty-one multiplied by nine hundred and forty-seven. Do not change any files. Reply with the numerical result and the word completed.'
} else {
    'This is a MirTar input test. Please reply only with the words cobalt seven. Do not use any tools.'
}
if (Test-Path -LiteralPath $taskOutputPath) { throw 'Fixture already exists; preserve it for reproducibility.' }
New-Item -ItemType Directory -Force -Path $taskOutputDirectory | Out-Null
Add-Type -AssemblyName System.Speech
$taskSynth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $taskSynth.SelectVoice('Microsoft Zira Desktop')
    $taskFormat = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(
        24000,
        [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
        [System.Speech.AudioFormat.AudioChannel]::Mono
    )
    $taskSynth.SetOutputToWaveFile($taskOutputPath, $taskFormat)
    $taskSynth.Speak($taskText)
    $taskSynth.SetOutputToNull()
} finally {
    $taskSynth.Dispose()
}
[pscustomobject]@{
    Length = (Get-Item -LiteralPath $taskOutputPath).Length
    Sha256 = (Get-FileHash -LiteralPath $taskOutputPath -Algorithm SHA256).Hash
} | ConvertTo-Json -Compress
