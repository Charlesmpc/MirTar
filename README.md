# MirTar

**Your coding agent, in your hand.**

[简体中文](README.zh-CN.md) · [Releases](https://github.com/Charlesmpc/MirTar/releases) · [Setup](docs/bluetooth-0.3.0.zh_CN.md)

MirTar turns a FoloToy AI Passport badge into a handheld controller and reply
screen for the coding agent on your computer. Sit back, press OK, speak, then
read the reply on the badge. At your keyboard, continue in the **same Agent session**.

The idea came from the creator's experience with a phone-to-desktop workflow
using ChatGPT: the remote connection kept dropping. MirTar brings the
badge-to-computer link onto **local Wi-Fi or Bluetooth**, with physical controls
and a screen you can keep in your hand.

| Option | What it gives you | Why use MirTar? |
| --- | --- | --- |
| Bluetooth headset | Convenient microphone and audio | No Agent session selector or text reply screen; MirTar adds dedicated buttons and readable replies. |
| Phone App / cloud-mediated remote workflow | A familiar screen and voice interface | Cloud-mediated control depends on Internet connectivity; it frequently disconnected in the creator's setup. MirTar connects directly to the computer over LAN or Bluetooth. |
| MirTar badge | Voice input, session controls and reply display together | A roughly [50 g badge](https://ai-passport.folotoy.cn/) that is lighter to hold than a phone and leaves your phone free for other things. |

**Keep the control link local.** MirTar requires no public-facing bridge, port
forwarding or cloud relay between the badge and computer. Pair over Bluetooth or
use your trusted LAN, then press and speak. Codex's own service still needs its
normal online access; local connectivity does not make the Agent offline. BLE
uses authenticated encryption and application binding; Wi-Fi currently carries
plaintext traffic and must stay on a trusted LAN.

The OS integration is a separate adapter layer. **Windows is implemented today;
macOS and Linux bridges are planned.** The current Agent adapter is Codex.
**v0.3.1 includes both local Wi-Fi and Bluetooth** (the default), with fixes for
Bluetooth connection/reconnection. The owner reported a successful physical-device
voice test after the fix. A new demo is being prepared.

## How it works

```text
AI Passport microphone / buttons / screen
       ↕ Bluetooth LE (default) or local Wi-Fi
Bridge: device transport → Agent adapter
       ↳ OS adapter: Windows today; macOS / Linux planned
       ↕ native voice, existing session, completed replies
Agent desktop (Codex today)
```

The bridge uses Codex's native voice service, without another ASR provider or ASR
API key. The Agent owns sessions, context and execution. Bluetooth removes the
need for the badge and laptop to share Wi-Fi. Codex's own online access and native
voice limits still apply.

## On the badge

1. Choose a configured computer and press OK.
2. Choose **Bluetooth** (default) or **Wi-Fi**.
3. First time: enter the badge's six-digit code in the Windows pairing dialog.
   Later connections reuse the stored bond.
4. Open an existing session; a single configured session opens automatically.
5. OK starts recording; OK again submits. UP/DOWN scroll; long UP/DOWN changes
   sessions; long OK returns to computer selection.

## Get started

You need an AI Passport, BLE-capable Windows, Node.js **24.13.0+**, Microsoft Edge,
a signed-in Codex desktop application and its executable. Firmware builds use
**ESP-IDF 5.5.6 / LVGL 9.5.0** and Python; configuration/build helpers use PowerShell 7.

```powershell
npm.cmd ci --ignore-scripts
# New configuration only; existing private files will not be overwritten:
.\tools\New-LocalConfig.ps1 -BluetoothOnly -BluetoothName WorkLaptop
.\tools\Start-Bridge.ps1
```

The helper asks for an existing native session ID and generates matching private
configuration. Badge `bluetoothName` must match bridge `bluetooth.hostName`;
display names may differ from Windows system names.

Existing users: update the source and restart the bridge. A working v0.3.0 badge
**does not need reflashing** just to receive the Windows connection fix.

- [Bluetooth setup/troubleshooting](docs/bluetooth-0.3.0.zh_CN.md)
- [Card build and flash guide](docs/device-quickstart.md) / [中文](docs/device-quickstart.zh_CN.md)
- [Windows bridge ZIP guide](docs/windows-bridge-package.md) / [中文](docs/windows-bridge-package.zh_CN.md)
- [v0.3.1 release notes](docs/releases/v0.3.1.md) / [中文](docs/releases/v0.3.1.zh_CN.md)

Downloads contain source, a Windows bridge source package and checksums;
**no personalized firmware**. Fill your own private configuration and build
locally. Do not flash a placeholder compile-check image.

## Scope and limitations

Implemented adapters: Windows host and Codex Agent. Both BLE and trusted-LAN Wi-Fi
are included in the current version, alongside native voice forwarding, existing
desktop sessions, completed text replies, and two display skins.
The OS adapter layer is independent; macOS and Linux implementations are planned.
TTS/card playback, live tool progress/approval UI, Cursor, cloud provisioning and
OTA are not implemented. Maximum recording: 30 seconds.
Incomplete input is not submitted; unknown submission outcomes are not replayed.

BLE uses custom GATT; the badge is not a standard Bluetooth headset. Codex
experimental interfaces depend on the installed version. Sustained throughput,
battery life, sleep recovery, radio switching and other computers need broader testing.

## Configuration and privacy

Only `config/device.example.json` and `config/bridge.example.json` are templates.
Real values belong in ignored `.private/device.config.json` and
`.private/bridge.config.json`. Wi-Fi accepts up to eight SSID/password pairs;
Bluetooth-only installations can use an empty array.

Firmware embeds binding keys and any Wi-Fi credentials. Keep firmware, ELF,
recordings, logs, native session IDs and private configuration out of Git and
releases. Bluetooth requires authenticated encryption and then HMAC binding.
Wi-Fi is explicitly **unencrypted trusted-LAN** transport, not a public Internet
endpoint. No automatic firewall or port-forward changes are made.

```powershell
npm.cmd run hooks:install
npm.cmd run security:check
npm.cmd run audit:privacy
```

The index guard checks local credentials and private/generated files. The privacy
audit also scans reachable Git history and flags personal metadata separately.
Automated checks are not a guarantee of zero leakage. The public repository starts
from an audited source snapshot. Earlier private development history is excluded
from this repository. Keep your own configuration and builds local.

## Development

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run test:security
```

[Product design](DESIGN.md) · [Technical design](TECH_DESIGN.md) ·
[BLE tasks](docs/tech-design-0.3.0.md) · [Protocol](docs/device-protocol.md) ·
[BLE transport](docs/bluetooth-protocol.md) · [Validation](docs/validation/bluetooth-0.3.0.md) ·
[Community publishing](docs/community-publishing.zh_CN.md)

Device transport, Agent and OS adapters are separate. Adding another OS means
implementing its platform integration behind that boundary, including media and
BLE support; the card protocol and Agent session model stay the same. The current
entry point wires up Windows implementations. The native Windows helper uses
OS-provided .NET Framework/WinRT; no .NET SDK or NuGet download is needed.

MirTar draws on mirror and the naming language of the VanTar fictional setting.
See [upstream attribution](firmware/UPSTREAM.md) and the bundled font/BSP licenses.
