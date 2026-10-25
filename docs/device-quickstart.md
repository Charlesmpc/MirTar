# Card and Windows bridge quickstart

[简体中文](device-quickstart.zh_CN.md)

**v0.3.1:** Boot now opens the computer list, then the connection-method screen
with Bluetooth selected by default. See [Bluetooth setup](bluetooth-0.3.0.zh_CN.md)
and [transport contract](bluetooth-protocol.md). The original M1 Wi-Fi instructions
below apply when Wi-Fi is selected.

This is a development build for Windows, a trusted LAN, and pre-existing Codex desktop sessions. Keep the repository private. Real configuration, recordings, receipts, toolchains and firmware remain under ignored local paths. There is no cloud registration or hotspot provisioning.

## Configuration

Copy the shape in `config/device.example.json` into `.private/device.config.json`, fill it locally, and remove `"template": true`. `wifiNetworks` accepts 0–8 SSID/password pairs (empty for Bluetooth-only), attempted in order. A failed attempt advances to the next entry; after the list is exhausted, attempts repeat. Only 2.4 GHz Wi-Fi is supported by this board. The bridge address must be reachable from the selected network; Wi-Fi connectivity alone does not make a configured computer reachable.

`targets` accepts up to four configured computers. Each target has its own LAN WebSocket address and shared binding secret. `.private/bridge.config.json` must authorize the same `deviceId` and secret. Use a random secret of at least 32 characters. The native Codex session IDs remain owned by Codex; do not create replacement sessions in the bridge. Up to eight existing desktop sessions can be exposed, with display names at most 60 UTF-8 bytes.

The default bridge port is **TCP 28743**. It is configurable: each device target URL must match that computer's bridge `listen.port` and firewall rule. The helper accepts `-Port <number>` for new configuration. After changing a device target port, rebuild and reflash the firmware; restart the bridge after changing its configuration.

Alternatively, run the local helper in PowerShell 7:

```powershell
.\tools\New-LocalConfig.ps1 -SessionId <native-thread-uuid> -BridgeAddress <computer-LAN-IPv4>
.\tools\New-LocalConfig.ps1 -AddWiFi
```

The helper prompts locally for the SSID and hidden password and generates matching binding secrets. Do not paste passwords into chat or commit the files. It refuses to overwrite existing configuration. Edit `skin` to `reading` or `terminal` to select the candidate visual style.

## Start and build

```powershell
npm.cmd ci --ignore-scripts
npm.cmd run check
npm.cmd test
.\tools\Start-Bridge.ps1
# In another terminal:
.\tools\Build-Firmware.ps1
```

The build helper uses the project-local ESP-IDF 5.5.6 installation under `.private/toolchains`. If the toolchain is not present, follow the official ESP-IDF installation workflow; do not replace an existing global toolchain. `Build-Firmware.ps1 -Config .private/compile.config.json -CompileCheck` is a template compile check only, not a Wi-Fi-ready deliverable.

The bridge binds only to the configured interface, with HMAC challenge-response device binding. M1 explicitly uses unencrypted LAN WebSocket transport (`allowLanPlaintext: true`); audio and reply traffic are not encrypted. No automatic firewall changes or port forwarding are made. If Windows asks about firewall access, scope it to the trusted private network and the intended bridge program; network policy and computer reachability remain environment-specific checks.

## Flash and use

After a successful configured build, `firmware/build/MirTar-full.bin` is the merged image for offset **0x0**. `firmware/build/mirtar-manifest.json` records its hash and matching ELF hash; `verify_firmware.py` checks each actual flash segment against the merged image. Do not flash a template build, or put the application-only `MirTar.bin` at 0x0.

When ready to flash locally, run `tools/Flash-Firmware.ps1 -Port COMx` with the actual device port. It verifies the image hash and refuses template builds. `-WhatIf` previews the write; `-PreserveNvs` uses only the verified segments, subject to a compatible existing partition layout. The build always reconfigures to avoid accidentally reusing an older embedded configuration.

Flashing replaces the current application. A merged image can reset stored settings; no whole-chip erase is required. Identify the actual device port and use a compatible segmented flash if preserving existing NVS data is required. This guide does not grant an agent permission to flash an arbitrary connected device.

On this Windows host, genuine compiler queries intermittently return empty or truncated stdout. The build helper applies recorded bounded retries to the private SDK's compiler and linker metadata helpers. Linker metadata must match every member and section name/size in the actual ELF archive and pass the SDK grammar parser; it is never synthesized. Persistent failure remains fatal. No antivirus, endpoint protection, certificate or global shell setting is changed.

On startup choose a configured computer, then Bluetooth (default) or Wi-Fi. Wi-Fi tries the preset networks only when selected. The card binds using the pre-shared configuration. A single available session opens automatically; otherwise choose a session with UP/DOWN and OK.

- Short OK starts recording; the second short OK ends and submits it. Audio buffered at the bridge is not sent to Codex before commit.
- Short UP/DOWN reads the content. Long UP/DOWN changes the session while not recording.
- Long OK cancels an unsubmitted recording and returns to the computer list. It does not cancel an already accepted desktop task.
- One recording is limited to 30 seconds. Reaching the limit or losing the network cancels an unsubmitted input.
- An uncertain native submission is not replayed. Check the desktop before repeating the request.

## Current limits

The adapter uses signed-in Codex native WebRTC v3 for voice and the native queue for the target desktop session. It does not add an ASR model, service or API key. Native account access and service limits still apply. Microsoft Edge acts as an isolated local WebRTC media engine, using a dedicated workspace-owned headless profile.

Only completed formal Agent replies are displayed. Live tool progress and approval status are not reliably available through this history path; handle approvals on the desktop. Optional TTS/card playback is not implemented in this increment and is advertised as disabled.

The 16px font contains 7,540 verified rasterized glyphs covering printable ASCII, GB2312 and fixed UI additions. Unsupported characters, including many emoji/rare Chinese characters, retain visible missing-glyph placeholders; the desktop has the full response. Chinese rendering, microphone levels, physical buttons, audio timing, battery reporting, Wi-Fi failover, memory and actual display layout require device testing.
