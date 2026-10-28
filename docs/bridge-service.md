# Windows background bridge

The 0.5.4 bridge can run as a current-user scheduled task. It starts ten seconds after Windows login,
without a terminal window, and retries failures up to three times at one-minute intervals. Duplicate starts are ignored.
It runs inside the user's desktop session so Bluetooth PIN prompts and the native voice browser can work.
It is not a Session 0 system service: it stops on logout/shutdown and starts on the next login.

## Install

Prepare this computer's local configuration and Codex login first. From the bridge folder:

```powershell
.\tools\Manage-BridgeService.ps1 -Action Install
```

Configuration, sessions, working directories, Wi-Fi and pairing are preserved. Stop an existing foreground bridge
with Ctrl+C first, or explicitly migrate that configuration's verified bridge process:

```powershell
.\tools\Manage-BridgeService.ps1 -Action Install -ReplaceExisting
```

Migration briefly disconnects the card. It only stops the verified bridge process tree for the same user/config,
never the desktop Codex app, another project, or an unrelated port owner. Installation affects the current computer only.

## Manage

```powershell
.\tools\Manage-BridgeService.ps1 -Action Status
.\tools\Manage-BridgeService.ps1 -Action Start
.\tools\Manage-BridgeService.ps1 -Action Stop
.\tools\Manage-BridgeService.ps1 -Action Restart
.\tools\Manage-BridgeService.ps1 -Action Logs
```

Start is idempotent. Stop requests bridge/audio/transport cleanup before exit. Finish current work before stopping or
restarting; unfinished audio/answers are never automatically replayed. `BridgeState: running` means that instance reported
listener readiness; physical Bluetooth and voice still need card testing. Stop this task before using foreground Start-Bridge.
For Add server, Stop, run Add-Server, then Start to reload new bindings. Background mode does not resolve competing desktop
and bridge ownership of the same Codex conversation.

Private state/logs are in `.private/bridge-service/<config-path-id>/`. UTF-8 `bridge.log` merges native stdout/stderr.
Logs larger than 5 MiB rotate on the next start, retaining one `.previous` file. Check `launcher-error.log` and
`launcher-stderr.log` if initialization fails. These files may contain private paths, addresses, or conversation data: never upload them.

If a Store update moves a configured desktop Codex executable, the launcher resolves the current installed backend for
that process only. It changes neither global Codex settings nor the saved bridge config. A missing custom CLI path must
be fixed explicitly rather than silently selecting another CLI.

## Other configurations and uninstall

Every action accepts `-Config 'D:\Private\bridge.config.json'`; each config path has a stable task identity.
Uninstall before moving the project/config, then install from its new location. Use `Install -NoStart` to register without
starting immediately.

```powershell
.\tools\Manage-BridgeService.ps1 -Action Uninstall
```

Uninstall stops and removes this task, preserving config, pairing, work files and logs. If Windows policy denies scheduled
task creation, installation reports the error and leaves an existing foreground bridge running.
