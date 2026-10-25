# v0.4.0 runtime setup validation

## Implemented behavior

- Selecting Wi-Fi with no saved profiles opens setup immediately.
- With saved profiles, 30 seconds without an IP address opens setup. Wi-Fi loss starts a new window; an unavailable bridge alone does not.
- Random WPA2 setup hotspot, on-screen Wi-Fi QR and manual `http://192.168.4.1` entry.
- Network form plus local device-configuration import; Bluetooth-only import needs no home network.
- Runtime NVS storage, bounded profile/config parsing, no compiled private configuration.
- Retry failed connection on the existing setup page; long OK cancels and closes setup. Hold UP on the Wi-Fi transport/waiting page reopens setup.

## Host validation

The actual `runtime_config.c` is compiled with the SDK's real cJSON and a simulated NVS backend. Tests exercise:
default/no-target startup data, save/load round-trip, failed-commit propagation, profile replacement and eight-profile bounds,
open/invalid-password cases, Bluetooth-only config import, template rejection, invalid/trailing/embedded-NUL JSON,
SSID matching with dirty trailing bytes and 32-byte names, and before/at/after the 30-second deadline with transport/cancel/IP guards.
The NVS simulator is not physical flash and does not establish power-loss behavior.

Eight Node tests execute the actual setup-page script, covering initial state, CSRF-protected JSON submission,
UTF-8 length validation, oversized imports, completion, Bluetooth-only import and Windows UTF-8 BOM files.
Existing eight bridge protocol/integration tests remain applicable. TypeScript is checked separately.
The page was visually inspected in a desktop browser and at a 390-pixel phone viewport using a labeled synthetic server.

Builds use ESP-IDF 5.5.6 in an isolated `.private/build-v0.4.0` directory. The merged image must match every flash segment,
identify as v0.4.0, and pass a scan against known local credentials and identifiers before release.
The build manifest records actual hashes and `deviceTested: false`; only a successful final build establishes those results.

## Physical device: not validated for this revision

No device was flashed or reset during this work. Pending acceptance: boot/UI/QR readability and phone scanning,
hotspot authentication and actual 192.168.4.1 reachability, good/wrong passwords, 30-second fallback,
AP/STA channel changes, switching/reconnection, NVS reboot persistence, max-size configuration/heap,
subnet overlap, Bluetooth-only first setup, and voice/reply continuity after import.
The earlier owner-reported v0.3.x voice test does not establish v0.4.0 setup acceptance.

## Known limitations

- No captive DNS redirect: manually open the address if the phone does not offer a setup browser.
- Phone input does not rewrite the computer JSON backup. Imported computer lists replace the list with the file's targets.
- The setup AP uses 192.168.4.0/24; overlap with the target LAN needs validation.
- NVS is not encrypted. No factory reset UI, cloud provisioning, OTA, TTS, Cursor or additional host OS implementation is included.
- Corrupt stored configuration enters a recovery/default configuration for explicit re-entry; NVS initialization errors are shown without erasing storage.
