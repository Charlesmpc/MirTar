# MirTar

**Your coding agent, in your hand.**

[简体中文](README.zh-CN.md) · [Releases](https://github.com/Charlesmpc/MirTar/releases) · [Setup](docs/server-onboarding.md)

<p align="center"><img src="docs/images/mirtar-cover.png" width="440" alt="MirTar concept illustration: a voice conversation connects a handheld interface to a laptop"></p>

*Concept illustration; not a photograph or screenshot of the badge.*

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
**Current version: v0.5.2** — live native voice forwarding and up to 10 minutes per recording.
The bridge forwards audio while you speak, then submits once after you press OK again and native transcription has finished. Update the bridge for streaming; update the firmware as well to remove its old 30-second limit.
See the [v0.5.2 validation and upgrade notes](docs/validation/streaming-voice-0.5.2.md).
The new home has **Server list / Add server / Add config-file**. Bluetooth enrollment exchanges host identity and binding;
file import uses an explicitly opened card hotspot. Each host owns its own optional Wi-Fi settings.
The owner confirmed successful physical-device validation of v0.5.1 on 2026-10-25.
See the [validation record](docs/validation/server-onboarding-0.5.1.md) for the evidence and remaining test coverage.

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

1. Use **Server list** for saved hosts; **Add server** enrolls through Bluetooth only.
2. **Add config-file** opens a card hotspot. Join using its QR/on-screen password, browse to
   `http://192.168.4.1`, and upload a prepared version 2 device JSON.
3. Select a saved host, then Bluetooth (default) or that host's configured Wi-Fi.
4. OK records; OK again submits. UP/DOWN scroll; hold them to change sessions. Hold OK to return home.

**v0.5.1 Bluetooth recovery:** After one minute without binding, the card offers a physically confirmed reset.
Opaque Bluetooth profiles are generated and stored per `server.id`. Reset affects only the selected host;
other hosts, Wi-Fi and application binding remain intact. Reconnect and enter the new Windows PIN.
See [Bluetooth recovery](docs/server-onboarding.md#bluetooth-recovery-after-one-minute).

## Get started

Windows, BLE, Node.js **24.13.0+**, Edge, and a signed-in Codex desktop session are required.
Configuration helpers support Windows PowerShell 5.1 and PowerShell 7. Firmware builds use PowerShell 7,
**ESP-IDF 5.5.6 / LVGL 9.5.0**, and Python.

```powershell
npm.cmd ci --ignore-scripts
# Only if private configuration does not already exist:
.\tools\New-LocalConfig.ps1 -BluetoothOnly
# On the card choose Add server, then run this on the computer:
.\tools\Add-Server.ps1
# Complete the PIN prompt, press OK on the card, then start/restart the regular bridge:
.\tools\Start-Bridge.ps1
```

The host display name defaults to the computer name and can be changed during Add-Server or with `-Name`.
Stable server IDs keep renaming separate from identity. The card does not scan/list nearby computers;
Windows internally discovers the card in its explicit Bluetooth enrollment window.

Alternatively, use **Add config-file** with a prepared file. Import adds/updates stable host IDs and preserves others.
For legacy v1 settings, run `Convert-DeviceConfig.ps1` and upload the new `.private/device.v2.config.json`.
The old file stays untouched. Bluetooth-enrolled bindings can be exported with `Export-DeviceConfig.ps1`.
v0.3.1 compiled settings and v0.4.0 stored settings are not automatically migrated.

- [Complete server setup and file format](docs/server-onboarding.md) / [中文](docs/server-onboarding.zh_CN.md)
- [Build and flash](docs/device-quickstart.md) / [中文](docs/device-quickstart.zh_CN.md)
- [Validation status](docs/validation/server-onboarding-0.5.1.md)

v0.5.1 was submitted for community review on 2026-10-25 (project 1619, revision 3705).
The verified receipt is **pending review**, not confirmation of public availability.
Build the credential-free image locally; preserve earlier verified images for rollback.

The public firmware version is **0.5.2**. A default build never reads personal config and starts with no saved hosts on fresh NVS.
Use `Build-PersonalFirmware.ps1` for a separately labeled local image containing an NVS preset. Its app remains version 0.5.2;
its package and card label include the selected personal suffix. Personal images must never enter a Release or community upload.
One public codebase is maintained; the old private history archive does not need ongoing development.
See [build variants and publication guards](docs/build-variants.zh_CN.md).

## Scope and limitations

Implemented adapters: Windows host and Codex Agent. Both BLE and trusted-LAN Wi-Fi
are included in the current version, alongside native voice forwarding, existing
desktop sessions, completed text replies, and two display skins.
The OS adapter layer is independent; macOS and Linux implementations are planned.
TTS/card playback, live tool progress/approval UI, Cursor, cloud provisioning and
OTA are not implemented. Maximum recording: 10 minutes; press OK again before the limit. Reaching the hard limit cancels the recording instead of submitting without confirmation.
Native voice still requires Codex online access; startup and finalization latency remain. No independent ASR provider or extra API key is introduced.
Incomplete input is not submitted; unknown submission outcomes are not replayed.

BLE uses custom GATT; the badge is not a standard Bluetooth headset. Codex
experimental interfaces depend on the installed version. Sustained throughput,
battery life, sleep recovery, radio switching and other computers need broader testing.

## Configuration and privacy

Only `config/device.example.json` and `config/bridge.example.json` are templates.
Real values belong in ignored `.private/` device/bridge files. Device configuration version 2 uses
`servers[]`, with optional `wifi: {ssid, password, url}` under each host. Bluetooth-only hosts omit it or use null.
There is no global Wi-Fi list. Up to four hosts are stored on the card.

Public firmware does not contain actual credentials. Import/enrollment or a local personal preset stores them in unencrypted NVS.
Keep personalized legacy firmware, ELF, recordings, logs, native session IDs, private configuration and backups out of Git/releases. Bluetooth requires authenticated encryption and then HMAC binding.
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
