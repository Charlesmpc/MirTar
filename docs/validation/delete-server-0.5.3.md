# Delete server — 0.5.3 development

## Behavior

Server list → select a host → Bluetooth / Wi-Fi / **Delete server**.
The confirmation names the host and defaults to Cancel. Only an explicit second OK on Delete performs deletion.
Cancel and holding OK before confirmation never mutate storage. The home screen layout is unchanged.

The entire selected server object is removed, including its binding key, Wi-Fi SSID/password and LAN URL.
Its Bluetooth root profile (including the private badge identity) and both NimBLE storage generations are erased.
Unassigned temporary enrollment data is cleared with the radio stopped. Other saved server profiles and the
legacy, unassigned shared store are preserved. Bluetooth re-addition gets a fresh identity.
The card device ID and skin are preserved. Deleting the last host produces an empty list and leaves the two add entries.

Deletion is local to the badge. It does not alter Windows records, bridge config-files, source presets or Agent sessions.
Reimporting an old config-file or flashing a complete personal preset can add the host again.
NVS erasure here means logical removal; it does not promise forensic flash sanitization.

## Persistence and failure handling

`runtime_config.c` makes a copy with one whole server removed, matched by stable ID, not name or array position.
`server_delete.c` saves a versioned intent in the `mt_delete` NVS namespace before any erasure.
With all transports stopped, recovery erases the two Bluetooth banks and root, saves the updated config, then
clears the intent. Each step is idempotent. The root checks the full owner ID before using its hashed storage index.

A failed step leaves the card on an OK-to-retry screen; it cannot reconnect or import a file over incomplete deletion.
Boot processes the intent before loading usable hosts or opening any transport. A failed intent write has no
authorized deletion to recover after reboot; the host remains and can be deleted again. An in-memory retry retains
the intended ID, so it retries the initial write rather than falsely reporting success.
No `nvs_flash_erase()` or global Bluetooth bond clear is used.

## Verification

2026-10-26, host-side C checks using the real configuration, bond-store and deletion code:

- Whole-object removal, source config unchanged, device ID/skin preserved, last-host removal, invalid/missing IDs.
- Same display names with different IDs: selected host removed, other host's Wi-Fi, identity and bonds retained.
- Both Bluetooth generations and enrollment copies cleared; re-add creates a fresh identity.
- Failed intent commit, bank commit, config commit and final intent-clear commit; retries recover without restoring old keys.
- Mismatched profile owner rejected without erasing that profile; Wi-Fi-only host with no prior Bluetooth store.
- Existing config/menu record guards, server-scoped bond tests and 29 bridge regression tests pass.

Run `npm.cmd run test:firmware`, `npm.cmd run test:bonds`, `npm.cmd run test:server-delete`,
`npm.cmd run check`, and `npm.cmd test`. Host simulation does not emulate every ESP NVS power-failure behavior.

ESP-IDF **5.5.6** public firmware compilation and image audit: **PASS** (2026-10-26).
The actual application descriptor is `0.5.3`; deletion/recovery symbols are present in the linked ELF.
The public merged image is 2,814,704 bytes, its NVS region is empty, and known credential/personal matches are zero.

```text
MirTar-full.bin (0x0):     f9e30d7f4d13d0799a90b47bd72db985cfbc252131e1fa77c2cdc64337a26cac
MirTar.bin (0x10000):     6cd4736f34f7d5cfc71fb061ec1ae6234f57c1ece5e4920044bbb8d7f86e9e40
partition-table.bin:      420931e3f5af072d899b5357c043fd9f283bf165fc9df6113b6d43d82b48a06d
```

To preserve existing badge configuration, use the matching partition layout with an app-only or segmented
NVS-preserving upgrade. A merged image writes the NVS range too. This build is not a personal preset or a formal release.
Physical button navigation, power-loss recovery on a real badge and Windows re-pairing after deletion are still untested.
No hardware has been flashed, erased, unpaired or reset for these checks. No personal preset is a public build input.

## Separate follow-up

[Issue #1](https://github.com/Charlesmpc/MirTar/issues/1) concerns forwarding pending Agent questions and voice answers.
It is not implemented by Delete server; public 0.5.3 development must not claim that interaction is available.
