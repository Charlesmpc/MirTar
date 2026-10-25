# Windows bridge package

> 当前开发版的主机、配置与引导逻辑见[新设计与步骤](server-onboarding.zh_CN.md)。下文保留为旧版历史说明，配置结构和启动步骤不再作为当前指引。

[简体中文](windows-bridge-package.zh_CN.md)

The preview ZIP contains the Windows bridge's Node.js/TypeScript sources, tests, startup helpers and placeholder templates. Dependencies are installed locally. Node.js itself, Codex, Microsoft Edge and configured badge firmware are not bundled. Use the full source archive or repository for firmware builds.

## Start

1. Use Windows with PowerShell 7, Node.js 24.13.0 or newer, Microsoft Edge and a signed-in Codex desktop application.
2. Extract the ZIP into a normal writable folder. Open PowerShell 7 in the extracted `MirTar-windows-bridge` folder.
3. Install the pinned dependencies:

   ```powershell
   npm.cmd ci --ignore-scripts
   ```

4. Create `.private` inside that folder. For an already configured badge, copy its matching bridge configuration locally to `.private/bridge.config.json`. Otherwise use `config/bridge.example.json` as the shape: fill the actual LAN address, device ID and matching binding key, the real Codex executable (`.exe`) path, Edge path and an existing desktop session UUID. Templates contain no usable binding credentials. Keep all real configuration local.
5. For Wi-Fi, the bridge's `listen.port`, badge target URL and Windows firewall rule must agree. The default is **TCP 28743**. Limit the firewall rule to the trusted private LAN. Keep Codex and the intended desktop session open.
6. Start:

   ```powershell
   .\tools\Start-Bridge.ps1
   ```

   Or pass another private computer configuration with `-Config .private/bridge.other.config.json`.
7. For Bluetooth, match badge `bluetoothName` to bridge `bluetooth.hostName`. Wait for `Bluetooth: scanning`, enter the badge passkey on first pairing, then wait for `Bluetooth: connected`. Loopback listening when the old LAN IP is unavailable is normal. Keep the terminal running; Ctrl+C stops it.

`npm.cmd run check` and `npm.cmd test` are available for diagnostics. This ZIP is a runtime source package, not a Git checkout or Windows installer. Git-hook setup applies to repository clones.

## Device and privacy

The badge uses Bluetooth LE by default, or trusted-LAN Wi-Fi; Codex uses its normal online service. Firmware embeds Wi-Fi credentials and binding keys at build time, so release downloads contain no configured `.bin`, `.elf`, device configuration or private bridge configuration. Build personalized firmware locally from the full source after filling `.private/device.config.json`; do not upload the resulting binary. The [card quickstart](device-quickstart.md) describes local builds and USB flashing.

The preview displays completed replies. TTS and reliable tool-progress/approval reporting are unavailable. See the [release notes](releases/v0.3.1.md) for validation limits.

The bridge ZIP includes tools/Start-Bluetooth.ps1, tools/Enable-Bluetooth.ps1 and
bridge/native/BluetoothWorker.cs. Windows compiles the helper locally; no native
binary or .NET SDK download is bundled. Repository audits/hooks require Git.
