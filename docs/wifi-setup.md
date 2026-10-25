# Badge hotspot setup

[简体中文](wifi-setup.zh_CN.md)

v0.4.0 stores configuration at runtime on the badge instead of compiling it into firmware.
Physical wireless, QR and display behavior needs separate device acceptance.

## Open setup

Select a computer and Wi-Fi. With no saved networks, the hotspot starts immediately.
With saved profiles but no IP address after 30 seconds, setup opens automatically.
A dropped Wi-Fi connection starts a new 30-second window. An unavailable bridge or Codex
service does not trigger setup while Wi-Fi itself is connected.
Hold UP on the Wi-Fi transport/waiting page to enter setup manually; hold OK to exit.

## Configure from a phone

1. Scan the badge's Wi-Fi QR or join the displayed `MirTar-Setup-XXXXXX` hotspot using its random password.
2. Stay connected despite the no-Internet warning. Open **http://192.168.4.1** in the browser; automatic captive-page opening is not guaranteed.
3. Enter a **2.4 GHz** SSID and password and save. Leave the password empty only for an open network.
4. The hotspot remains available after a failed/30-second attempt, so correct the fields and retry.
5. On success with computers configured, the hotspot closes. Return your phone to its normal network; the badge connects to the selected bridge.

The latest network is tried first, others remain saved, up to eight profiles. A matching SSID updates its password.
Reopen setup to change networks. The optional checkbox keeps only the newly entered network.
No vendor cloud or mini-program is involved.

## First computer configuration

On Windows, sign in to Codex and prepare a dedicated session. In Windows PowerShell 5.1 or PowerShell 7, choose one command:

```powershell
# Bluetooth only, no home Wi-Fi:
.\tools\New-LocalConfig.ps1 -BluetoothOnly
# OR LAN use: enter the computer normal LAN IPv4 address; home Wi-Fi is entered on the badge page:
.\tools\New-LocalConfig.ps1 -NoWiFiPrompt
```

Connect that computer to the badge hotspot and open the same local page. Expand the computer section
and choose `.private/device.config.json`. Do not import bridge.config.json or a public example template.
For Bluetooth-only use, click the separate computer-import button without entering home Wi-Fi.
For LAN use, fill Wi-Fi and use the main save/connect button. The device URL must use the computer's
normal reachable LAN address, not a Bluetooth-only loopback address.

The imported file defines the computer list: put all intended targets in one file. Existing networks
are retained/merged. Binding keys are randomly generated on the user's computer and transferred
only to the badge. If a phone first configures Wi-Fi without computer settings, the hotspot remains
available for the computer import. Return the computer to its normal network, start Start-Bridge.ps1,
then choose a computer and Bluetooth or Wi-Fi on the badge. Windows asks for the badge's six-digit
pairing code on the first Bluetooth connection.

## Persistence and upgrade

NVS retains settings across reboots. The computer JSON is an import/backup file; phone edits do not
rewrite it automatically. Failed persistence is reported without claiming success. Compatible segmented
flashing preserves NVS; a full erase loses configuration and Bluetooth bonds.
From v0.3.x, import the existing local device JSON after upgrading; compiled settings do not migrate.

The WPA2 hotspot password is random per setup session. Only requests through the setup interface are accepted;
status responses/logs do not return credentials. NVS is not encrypted. A target network also using the
192.168.4.x subnet may conflict with the setup subnet and needs dedicated validation.
