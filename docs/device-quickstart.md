# Card and Windows bridge quickstart

[简体中文](device-quickstart.zh_CN.md)

v0.4.0 uses one firmware image with runtime configuration through the badge hotspot.
Wi-Fi credentials and computer binding keys are no longer compiled into the image.
See [hotspot setup](wifi-setup.md). Build/host validation and physical-device acceptance are reported separately.

## Prepare the computer

Use Windows, Node.js 24.13.0+, Microsoft Edge, a signed-in Codex desktop app and a dedicated existing session.
Run in Windows PowerShell 5.1 or PowerShell 7 (firmware builds below require PowerShell 7):

```powershell
npm.cmd ci --ignore-scripts
# Bluetooth only, without home Wi-Fi:
.\tools\New-LocalConfig.ps1 -BluetoothOnly
# OR LAN use: enter the computer LAN address, leave home Wi-Fi to the setup page:
.\tools\New-LocalConfig.ps1 -NoWiFiPrompt
```

Choose one configuration command. It prompts for the native session ID and generates matching private
`.private/device.config.json` and `.private/bridge.config.json` with a locally random binding key.
Existing files are never overwritten; an existing personal configuration can be reused.
The badge supports up to four computers and eight networks. Put all computers into one device file's `targets`.
Match device ID, binding key and Bluetooth host name with the corresponding bridge.

The default port is TCP 28743; the helper accepts `-Port`. For Wi-Fi, the target URL, bridge listener and firewall
must agree. Allow only a trusted private LAN. No automatic firewall or public exposure changes are made.
Bluetooth does not need a LAN firewall port. Import updated computer/port settings through the page and restart
the bridge after editing its configuration; rebuilding firmware is unnecessary.

## Build and flash

Use ESP-IDF 5.5.6. Project scripts use its isolated installation under `.private/toolchains`;
do not replace existing global tools. The equivalent idf.py workflow is available in the matching SDK environment.

```powershell
.\tools\Build-Firmware.ps1
# Preview only; does not access the device:
.\tools\Flash-Firmware.ps1 -Port COMx -PreserveNvs -WhatIf
# After you confirm the serial port and compatible partition layout:
.\tools\Flash-Firmware.ps1 -Port COMx -PreserveNvs
```

The default directory is `.private/build-v0.4.0/`. `MirTar-full.bin` is the merged image for offset **0x0**;
never substitute the app-only `MirTar.bin`. Verification compares every actual flash segment and records hashes/version.
Use `-BuildDirectory` to select another bundle. Builds do not read private configuration; the old `-Config` switch is rejected.

`-PreserveNvs` uses compatible segmented flashing to retain settings and Bluetooth bonds. Merged flashing can clear NVS.
Do not erase the whole device by default. This guide does not authorize an Agent to flash attached hardware automatically.
Configuration compiled into v0.3.x does not migrate automatically: import your existing local device JSON after upgrading.

## First setup and connection

1. Select Wi-Fi on the badge. With no saved networks, setup starts immediately; failed Wi-Fi connection opens it after 30 seconds.
2. Scan the Wi-Fi QR or join the displayed `MirTar-Setup-XXXXXX` with its random password. Stay connected despite the no-Internet warning and open `http://192.168.4.1` in your phone browser.
3. Enter a 2.4 GHz Wi-Fi network and save. Failed connection can be retried on the same page. Hold UP on the Wi-Fi connection/waiting screen to reopen setup when changing networks.
4. For first use, connect your computer to the same badge hotspot and import `.private/device.config.json` on the page. For Bluetooth only, use the separate computer-import button without entering home Wi-Fi.
5. Return the computer to its normal network and run `.\tools\Start-Bridge.ps1`. Choose computer and transport on the badge. Bluetooth is the default once computers are configured; enter the displayed six-digit code in Windows on first pairing.

Networks are stored on the badge; phone edits do not automatically update the computer's JSON.
If Wi-Fi connects but the computer has not been configured, the hotspot stays open until import or long OK to exit.
An unavailable bridge does not trigger the Wi-Fi timeout when Wi-Fi itself is connected.

## Daily controls and limits

- OK starts recording; OK again submits. Maximum 30 seconds per input.
- UP/DOWN scroll; hold UP/DOWN to change sessions when not recording.
- Hold OK to cancel unsubmitted recording and return to computer selection. Accepted computer tasks continue.
- One session opens automatically; otherwise select with UP/DOWN and OK. Unknown submissions are never replayed.

Codex owns sessions and provides native voice; no additional ASR service or key is required. Codex still needs normal online access.
Only completed replies are displayed. TTS, live tool progress, badge approvals, Cursor and other OS implementations remain unavailable.
Wi-Fi business traffic is trusted-LAN plaintext; BLE uses authenticated encryption and application binding. NVS is not encrypted.
Keep private configurations, recordings, ELF files, logs and receipts ignored. Public firmware must contain only the generic program.
Unsupported characters show placeholders; the desktop remains authoritative. Throughput, power use and physical controls need device acceptance.
