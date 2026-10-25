# Server onboarding validation — 0.5.0

This development branch starts from the v0.3.1 public snapshot. It selectively reuses the v0.4.0 hotspot server,
QR renderer and Windows build fixes, with a new file-only page and host-owned v2 configuration.
It does not rewrite the public v0.4.0 release or its pending community submission.

## Implemented behavior

- Three home entries: Server list (when hosts exist), Add server, Add config-file. Empty host lists do not index/modulo zero.
- Add server is authenticated/encrypted BLE enrollment only. Windows internally discovers an enrollment-mode card;
  the card does not scan/list computers. A six-digit Windows PIN precedes host metadata and binding exchange.
- The card requires physical OK on the host-name confirmation before persisting. Hold OK or the enrollment timeout cancels.
- Windows saves a key before offering it; failed/uncertain enrollment retains it for retry. No Agent adapter/session operation
  is initialized by enrollment. The normal bridge must restart to load new authorization records.
- Host name and stable ID are separate. Add-Server permits a display name. Re-enrollment preserves that host's saved Wi-Fi.
- Add config-file explicitly opens a random WPA2-protected setup AP at 192.168.4.1, with QR/manual credentials.
  No automatic hotspot fallback, separate SSID form, cloud setup, computer search or network-selection UI.
- File imports merge host IDs, preserve other hosts, reject identity changes on configured cards and disallow global networks.
- Selecting Wi-Fi loads only that host's own SSID/password/URL. About 30 seconds without an IP reports failure, without opening setup.
- Old files can be converted into a distinct ignored file; no original config, NVS, Bluetooth bond or old binary is automatically erased.

## Host checks

The actual runtime_config.c is compiled with SDK cJSON and simulated NVS. Assertions cover defaults,
NVS round trip and commit-failure propagation, per-host Wi-Fi isolation, stable-ID update/merge,
Bluetooth-only hosts, four-host limits, duplicate IDs/names, configured-card identity protection,
empty-card adoption, legacy/template rejection, bounded/deep/NUL/trailing JSON and recording guards.
Private v2 files can additionally be checked by this exact compiled parser without printing values.
The simulated NVS backend does not establish physical flash/power-loss behavior.

Five onboarding protocol tests cover persist-before-send ordering, real confirmation receipts, write failure,
stale nonce rejection, key reuse, timeout and malformed/binary input. Existing eight bridge tests remain applicable.
Four page-script tests cover file-only controls, card identity, CSRF POST, BOM handling, invalid/oversized inputs,
save failure and saved completion. The real page script runs in a Node VM with a synthetic DOM/network.
The current upload HTML was also visually inspected in a browser through a labeled localhost preview with a synthetic card ID;
this is page-layout evidence, not a physical-device screenshot or radio test.
TypeScript and Windows native worker compilation are checked separately; no actual radio/pairing is exercised by those checks.
The native worker is built into a content-hashed filename so a running older helper is not overwritten.

### Windows notification subscription recovery

An owner-reported v0.5.0-charles log showed successful cached service/characteristic discovery,
one successful subscribe and repeated `subscribe_unreachable` failures. This does not establish one unique radio/bond cause.
Code inspection found that the native helper previously emitted `connected` before CCCD subscription completed;
the bridge could therefore close it after its five-second application authentication timeout during a slow GATT operation.

The helper now buffers early notifications with byte/count bounds and emits application readiness only after successful
subscription, followed by the buffered hello in order. It retries `Unreachable` at most three times per attempt,
then refreshes services and characteristics without cache on a separate connection before reconnecting.
The usual cached path retains handler-before-MaintainConnection ordering for restored bonded CCCDs.
Connection IDs isolate late disconnects, notifications, write acknowledgements and commands from a newer link.
Subscribe attempt, duration, communication status and ATT protocol errors are logged without identifiers or secrets.
No bonds are removed automatically.

`tools/Test-Bluetooth.ps1` compiles the actual worker and exercises its notification gate, including a pending
subscription lasting 5.2 seconds, ordered once-only hello delivery, failed subscribe, bounded buffering and close races.
Three Node worker tests cover readiness, obsolete callbacks and write acknowledgements. All 16 bridge tests and
TypeScript checks passed; the loopback integration test required execution outside the network-restricted sandbox.
These are host tests. Actual subscription/reconnect and voice after this fix still require owner validation;
the card firmware and its prebuilt images are unchanged. Stop/restart the old bridge to load both updated worker files.

Windows API references: [GATT client connection and variable operation time](https://learn.microsoft.com/en-us/windows/apps/develop/devices-sensors/gatt-client)
and [system-wide GATT cache behavior](https://learn.microsoft.com/en-us/uwp/api/windows.devices.bluetooth.bluetoothcachemode).

## Build and privacy

Builds use ESP-IDF 5.5.6 and a separate `.private/build-v0.5.0` directory. The verifier compares actual flash segments,
records version/hash and audits the merged binary against known local private credentials/identifiers.
Only a successful build and generated manifest confirm completion. The manifest must retain `deviceTested: false`.
Source/index privacy guards also run before committing. Private config/export/backup files and all build outputs stay ignored.

Public v0.5.0 additionally requires actual app version 0.5.0, no preset NVS data and explicit publishable/public manifest flags.
Personal variants share the same app but add a local NVS preset and a display suffix; their manifest forbids publication.
Five bundle checks cover clean export, relabeled personal data, falsified flags/version, segment mutation and a cross-page
SDK NVS generation/decode round trip. Successful personal readback does not establish physical boot/bond behavior.

## Physical acceptance pending

No card is flashed, reset, paired or controlled during development verification. Pending: home/navigation and QR readability,
new BLE enrollment including confirm/cancel/reconnect, hotspot reachability/upload, NVS persistence across restart,
host-specific Wi-Fi use, resource/heap behavior and the voice/reply path after new enrollment/import.
Prior owner acceptance of v0.3.x does not validate these changed workflows.

Limits: NVS is not encrypted; business Wi-Fi is trusted-LAN plaintext; the hotspot has no captive-DNS auto-popup.
Four hosts/bonds are supported; removal/reset UI, macOS/Linux, Cursor, TTS and OTA are outside this revision.
