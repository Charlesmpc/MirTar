# 0.3.0 validation — 2026-10-25

## Build

- ESP-IDF 5.5.6 / ESP32-C3 / LVGL 9.5.0; NimBLE enabled, peripheral role,
  one connection, four persistent bonds, preferred MTU 247.
- Placeholder build passed before switching the isolated build to private device
  configuration. Final personalized image is under `.private/build-v0.3.0` and
  contains real configuration; it must not be committed or uploaded.
- Final version is 0.3.0. Bootloader, partition table and app match the merged
  image byte for byte. Existing partition layout remains unchanged.
- Static RAM sections: IRAM text 125,410 bytes, DRAM data 14,884 bytes, DRAM BSS
  85,520 bytes in the template build. These are section sizes, not runtime free
  heap. Heap, largest block and active transport are printed at link readiness.
- Radio-switch cleanup deinitializes the old NimBLE host/controller or Wi-Fi
  driver/netif. The earlier 0.2.0 default build folder is retained untouched.
- Windows native worker compiles using the OS compiler and WinMetadata, without
  installing a .NET SDK or NuGet dependency. TypeScript no-emit check passed.
- Six private-file protection tests passed; the staged source/configuration
  templates passed the credential-aware index guard. No configured firmware,
  private configuration or native helper binary is staged.
- Flash helper preview validates the personalized merged image and all segments
  with an isolated build directory and `-PreserveNvs -WhatIf`, without touching a
  serial port. Direct read-only SHA256 avoids Windows PowerShell inheriting
  WhatIf into Get-FileHash and returning no digest.

## Host tests

- Eight protocol/integration tests pass: BLE framing at ATT value sizes 20, 97
  and 244; sequence wrap, UTF-8 and PCM reassembly; missing/duplicate/interleaved
  and oversized messages; shared HMAC/audio/reply flow; simultaneous device
  exclusion; existing WebSocket audio/reply/no-replay tests.
- Tests use mocked Agent adapters and in-memory GATT packets. They do not prove
  native radio delivery, real Codex execution over BLE, or physical-card UI.
- Actual Windows adapter lookup and BLE scanning succeeded. The bridge's internal
  worker started and stopped cleanly using an isolated discovery name, without
  pairing a device. A PS7-inherited PSModulePath initially hid Windows PowerShell
  cmdlets; the child now uses only its own Windows PowerShell system modules.

## Device tests

The user flashed 0.3.0 and entered the card's passkey. The agent did not flash,
reset, unpair, or erase the device. Windows subsequently reported an existing bond.

Live investigation reproduced `0x80070016` during filtered uncached service
discovery. Full service enumeration succeeded (three services, two MirTar
characteristics). The first implementation then missed the initial hello after
bonded reconnection: notification subscription could restore before the Windows
receiver was registered. The worker now uses cached discovery with UUID filtering,
registers the receiver before maintaining the connection, and propagates negotiated
MTU changes. Encryption/authentication and application HMAC remain required.

Two consecutive worker restart/reconnect cycles passed on the physical badge:
hello, challenge, auth, bound, select, selected, and an existing native Codex reply.
GATT writes were acknowledged, the outgoing queue drained, the peer remained
connected, and the negotiated characteristic value size was 244 bytes. The probe
used real Codex session/history reads but explicitly rejected audio submission;
it did not enqueue a new Agent task. Reply screen appearance was not visually
inspected. Native worker compile, TypeScript check and all eight protocol tests
passed after the fix.

New voice input over BLE, sustained audio/throughput, device reboot bond reuse,
other-computer switching, Wi-Fi switching, power and sleep recovery remain
unverified. The prior full voice demo establishes the 0.2.0 Wi-Fi baseline only.

Before acceptance: pair WorkLaptop with its six-digit card code; record and receive a
reply in the same native desktop session; reboot and reconnect without entering
the code again; switch to the other configured computer; test 30-second audio and
explicit Wi-Fi selection; inspect reported heap and confirm no replay after loss.

Windows discovery behavior reference: [BluetoothCacheMode](https://learn.microsoft.com/en-us/uwp/api/windows.devices.bluetooth.bluetoothcachemode).
Cached discovery may retrieve attributes from the device on cache miss; cached
metadata alone is not treated as proof of an authenticated live connection.

## v0.3.1 owner acceptance

After the Windows fix, the owner reported the physical voice test passed and
requested v0.3.1. This is owner-reported acceptance of the interaction; it does
not certify long-duration audio, battery life or other untested environments.
