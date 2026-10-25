# Server onboarding (development build)

This branch starts from v0.3.1, retaining the reading skin and Codex voice path. Its version is `0.5.1`.
It does not replace the v0.4.0 community submission. Compilation and host tests do not establish device acceptance.

The home screen has **Server list** when hosts exist, plus **Add server** and **Add config-file**.
Server list opens saved hosts; Bluetooth is the default transport.
Hold OK to cancel and return home. Successful additions/imports also return home.

## Add server: Bluetooth only

Prepare Windows, BLE, Node.js 24.13+, Edge, signed-in Codex and an existing desktop session.
Run `npm.cmd ci --ignore-scripts`. Without existing private settings, run
`.\tools\New-LocalConfig.ps1 -BluetoothOnly` and provide the session ID. Existing files are never overwritten.

1. Select **Add server** on the card; the enrollment window lasts about two minutes.
2. On the computer run `.\tools\Add-Server.ps1`; accept its computer-name default or enter a display name.
   Alternatively specify `-Name 'Work laptop'`.
3. Enter the card's six-digit code in the Windows prompt. The computer internally discovers cards in enrollment mode;
   the card does not scan or list nearby computers.
4. Check the host name on the card and **press OK to save**, or hold OK to cancel.
5. Restart the regular bridge with `.\tools\Start-Bridge.ps1`, then choose that host under Server list and use Bluetooth.

The enrollment tool does not initialize the Agent or submit tasks. It saves a random binding key locally before offering it
over authenticated/encrypted BLE. The card acknowledges only after saving. A cancelled or uncertain exchange may retain
an unused computer-side device entry for retry; keys and Bluetooth bonds are not silently erased or rotated.
The stable server ID survives display-name changes. Existing bridge processes need restarting to load new bindings.
With four hosts saved, update an existing entry through a file instead.

## Bluetooth recovery after one minute

After one minute without completing Bluetooth binding to an existing host, the connection/retry screen offers
**Reset Bluetooth pairing**. Repeated disconnects do not restart the timer. Press OK, select Reset with UP/DOWN,
then OK again; Cancel is selected first.

Reset affects only the current `server.id`'s binary Bluetooth profile and badge identity. Other hosts' bonds,
server configuration, application keys and Wi-Fi remain unchanged. Press OK to reconnect and enter the new PIN
in Windows while the bridge remains running. The new identity establishes a fresh pairing for this host.

Profiles are generated automatically, without hand-edited Bluetooth addresses or keys in config-file. Enrollment
is assigned to `server.id` on physical confirmation. Display-name and Wi-Fi changes preserve its profile.
Legacy shared bonds remain untouched and unassigned; each host pairs once under the new storage design.
See [Bluetooth storage](bluetooth-storage.md).

Hold OK to exit. Timeout alone never removes a bond or replays audio. Failed resets are reported.
Wi-Fi, enrollment and config upload do not offer this action. The explicit Windows maintenance option
`Start-Bridge.ps1 -ResetBluetoothPairing` remains available for old records but is not required by the new flow.

## Add config-file: local hotspot upload

1. Prepare a real **version 2** device config; remove the public template's `template: true`.
2. Choose **Add config-file**. Scan the card's Wi-Fi QR or manually join its displayed `MirTar-Setup-XXXXXX`
   hotspot with the displayed random password. Stay connected despite the no-internet warning.
3. On the phone or computer open **http://192.168.4.1**, select the device JSON and click Upload and save.
4. Wait for success; the card closes the hotspot and returns home. Rejoin the computer's normal network,
   start the bridge, and choose the host under Server list.

Retry failed uploads on the same page; hold OK to exit. This page only uploads files, without network/device searches,
separate Wi-Fi entry or vendor-cloud access. The address is fixed; automatic captive-browser opening is not promised.
The phone must already have the file, or use the computer directly. The page shows the card's deviceId.
An empty card can adopt the file's deviceId; a configured card requires the existing identity.

## Host-owned configuration

See [the public v2 template](../config/device.example.json). Real files stay in ignored `.private/`.
Root fields are `version: 2`, `deviceId`, `skin`, `allowLanPlaintext: true`, and `servers`.
Each host has a stable `id`, display `name`, `bluetoothName` matching `bridge.bluetooth.hostName`, and its binding `secret`.
Its optional `wifi` contains **that host's** `ssid`, `password`, and `url` (`ws://LAN_IP:28743/device`).
Bluetooth-only hosts can omit `wifi` or use null. There is no global network list.

Imports add/update by server ID and preserve other hosts; an updated entry is replaced in full.
Up to four hosts and 4096-byte files are accepted; Bluetooth names must be distinct.
Host names allow 40 UTF-8 bytes; Wi-Fi is 2.4 GHz, SSIDs allow 32 bytes, passwords are empty or 8–63 bytes.
Selecting Wi-Fi uses only the chosen host's network/address. After about 30 seconds without a connection the card reports
failure; it never automatically opens setup. Bridge unavailability does not trigger a hotspot.
For LAN use, allow the configured TCP port (28743 by default) only on a trusted private Windows network.
Bluetooth needs no LAN firewall port.

Run `New-LocalConfig.ps1` to create a file with Wi-Fi, or use `-BluetoothOnly`.
Optional `-Name`, `-ServerId`, and `-DeviceId` set identities. `-NoWiFiPrompt` only asks for a LAN computer address;
edit the host's JSON Wi-Fi later. `-AddWiFi -ServerId ID` updates one host's network.
Changed addresses/passwords require another file upload, without recompilation.
After Bluetooth enrollment, `Export-DeviceConfig.ps1 -DeviceId CARD_ID` exports the actual existing bridge binding.
Add `-WiFi -BridgeAddress LAN_IP` to enter that host's network. Output defaults to `.private/device.export.config.json`
and never overwrites a file. Without `-WiFi`, reimporting that Bluetooth-only entry removes its prior Wi-Fi settings.

Legacy v1 files must be converted with `.\tools\Convert-DeviceConfig.ps1`, producing `.private/device.v2.config.json`
without editing the original. A single legacy network is copied into each host. With several networks, explicitly provide
`-ServerWiFiIndex @{ WorkLaptop=0; HomeLaptop=1 }`; indices are zero-based and associations are never guessed.
Compiled v0.3.1 config and v0.4.0's old NVS format are not automatically migrated or erased.

## Build and validation

Run `npm.cmd run check`, `npm.cmd test`, and `npm.cmd run test:portal`.
Firmware builds use PowerShell 7 with ESP-IDF 5.5.6: `.\tools\Build-Firmware.ps1`.
The merged output is `.private/build-v0.5.1/MirTar-full.bin`, flashed at **0x0**.
With a compatible partition layout, segmented `Flash-Firmware.ps1 -Port COMx -PreserveNvs` preserves NVS;
add `-WhatIf` for a device-free preview. Preserve original files and verified firmware first.
No automatic flashing is authorized. Public builds never contain actual credentials; their `-Config` is disabled.
The separate `Build-PersonalFirmware.ps1` packages private NVS presets; see [build variants](build-variants.zh_CN.md).

Press OK to record and again to submit; UP/DOWN scroll, hold them to switch sessions, hold OK to return home.
Codex still owns sessions and ASR. No TTS, Cursor, other host OS or OTA implementation is added.
NVS is not encrypted; business Wi-Fi is trusted-LAN plaintext. Config, backups, audio and logs must stay private.
Hardware acceptance remains pending: new navigation, enrollment/cancellation/reconnection, confirmed persistence,
hotspot QR/upload, restart recovery, host-specific Wi-Fi selection and voice/reply continuity.
