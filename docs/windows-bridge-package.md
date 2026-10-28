# Windows bridge package (0.5.4)

[中文](windows-bridge-package.zh_CN.md)

The package contains runtime source, startup/background helpers and configuration templates. It includes no personal
configuration, Node.js, Codex or Edge. Firmware is provided separately in the Release; firmware builds require full source.

## First use

1. Prepare Bluetooth-capable Windows, PowerShell 5.1 or 7, Node.js 24.13+, Edge, and an installed, signed-in Codex desktop app.
2. Extract to a writable folder. Inside `MirTar-windows-bridge`, run:

   ```powershell
   npm.cmd ci --ignore-scripts
   .\tools\New-LocalConfig.ps1 -BluetoothOnly -BridgeOwned
   ```

   Setup prefers the desktop app's native backend and needs no existing desktop conversation ID. Do not reinitialize
   existing configuration. Add `-WorkingDirectory 'D:\Projects\MyProject'` to select an existing writable project.
3. Select Add server on the card and run `.\tools\Add-Server.ps1` on the computer. Enter a display name or press Enter.
   Enter the card's six-digit PIN in Windows, then confirm with OK on the card. Wait for the saved confirmation and home page.
4. Install and start the background bridge:

   ```powershell
   .\tools\Manage-BridgeService.ps1 -Action Install
   ```

   The default workspace is `MirTar/workspaces/default` under the current user's home. First start initializes and saves
   the MirTar Agent session and its directory; later logins start it automatically. Select Server list → computer →
   Bluetooth → MirTar Agent on the card and wait for ready.
5. OK records and OK again sends. UP/DOWN scrolls; hold them to switch sessions. Hold OK to return home. For a dedicated
   session's question, OK opens the answer menu for a voice reply or option selection.

## Existing configuration and background controls

Real configuration stays in local `.private/bridge.config.json`. Existing sessions and bindings are preserved.
For old desktop-only configuration, stop the bridge and use `New-AgentSession.ps1` to add a separate bridge-owned session.
See [questions and workspace configuration](agent-questions.md). Do not merely relabel an existing desktop thread ID.

```powershell
.\tools\Manage-BridgeService.ps1 -Action Status
.\tools\Manage-BridgeService.ps1 -Action Stop
.\tools\Manage-BridgeService.ps1 -Action Start
.\tools\Manage-BridgeService.ps1 -Action Restart
.\tools\Manage-BridgeService.ps1 -Action Logs
```

Find the task in Task Scheduler Library; Status prints its name. For older hidden installations, enable View → Show Hidden Tasks.
Run one instance per config. Stop background mode before using foreground `Start-Bridge.ps1`. Restart after Add server to
reload bindings. Logs/state stay in ignored `.private/bridge-service/`.

Legacy desktop forwarding still needs desktop activation; bridge-owned mode executes directly. Desktop and bridge cannot
own the same session simultaneously. Finish the task and stop the current client before switching. Card permission approvals,
secret input and reply TTS are not implemented.

## Optional LAN and upgrades

Bluetooth needs no card Wi-Fi setup; Codex still needs internet access. For optional per-computer Wi-Fi/config-file setup,
see [server onboarding](server-onboarding.md). Use a trusted LAN only. The default TCP port is 28743; listener, card URL and
firewall rules must agree.

Existing cards can flash public `MirTar.bin` at `0x10000` to retain settings and pairings. The complete `MirTar-full.bin`
starts at `0x0` and may replace settings and bonds; community installation uses the public complete image. Public artifacts
contain no author Wi-Fi, bindings or sessions. Personal images stay local and must never be uploaded.

Windows compiles the BLE helper with its built-in .NET Framework compiler; no separate .NET SDK/native executable is bundled.
Install development dependencies for full source checks. The package is not a Git checkout. See [background service](bridge-service.md)
and [validation](validation/agent-questions-0.5.4.md).
