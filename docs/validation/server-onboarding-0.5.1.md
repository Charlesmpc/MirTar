# Bluetooth recovery validation — 0.5.1

This revision retains the v0.5.0 three-entry home and per-host configuration. It adds a physical pairing-reset action
after one minute without completing binding to an existing host. Reset is never automatic.

## Behavior

- Initial waiting and repeated disconnects share a timer. Authenticated application binding clears it.
- An actual pairing PIN grants a fresh minute so the reset prompt does not immediately replace the code.
- OK opens confirmation; Cancel is selected first. UP/DOWN select; OK confirms. Hold OK returns home.
- Card reset stops the NimBLE host, clears only the Bluetooth store, then deinitializes before allowing reconnect.
  The SDK store uses `nimble_bond`; MirTar host/Wi-Fi/binding config remains in the separate `mirtar` namespace.
- All card bonds are reset: v0.5.0 had no persisted server-ID/Bluetooth-identity mapping for reliable selective deletion.
- Failure is reported. A failed stop/deinit requires restart; the UI does not pretend reset succeeded.
- Windows pairing is reset only by the explicit local `-ResetBluetoothPairing` option. It selects one paired record by
  exact configured Bluetooth name and rejects ambiguity. No radio advertisement or failed GATT request can authorize unpairing.
- Old enrollment names may require manual removal in Windows Bluetooth settings. Neither recovery path edits Agent sessions,
  regenerates application keys, submits a task or automatically replays audio.
- Native subscribe readiness buffering, bounded retries, cache refresh and connection-generation isolation are retained.
  Subscribe durations and ATT codes are logged; card logs add connect, disconnect and encryption status without keys/PINs.

## Evidence and limits

The owner reported repeated CCCD failures within 151–352 ms and a failed uncached service query. That log does not support
the five-second authentication timer as its direct cause. The owner confirmed a full personal-image flash without fresh
Windows PIN entry, and later reported manual Windows repair did not restore a connection. A passive USB read captured no
new bytes, so it did not establish a peripheral encryption error code. Bond mismatch remains a supported diagnosis, not a
verified packet-level finding.

Host checks cover the actual state code at the one-minute boundary, repeated disconnects, recovery eligibility, success
cleanup and exclusion from Wi-Fi/enrollment/upload/reading/recording. Existing configuration, protocol and no-replay tests
remain applicable. Windows native compilation and gate tests do not exercise the Bluetooth radio. Build receipts and image
audits are recorded separately from device acceptance.

Completed: ESP-IDF 5.5.6 public firmware build/export with actual app version 0.5.1; empty public NVS verification;
zero known-credential/personal matches in the public binary; personal preset readback; TypeScript check; all 16 bridge
tests; native worker compilation and slow-subscribe/notification-gate tests; actual C state/config host tests; four isolated
PowerShell recovery scenarios (ordinary startup, active-worker guard, explicit reset and failed reset). PowerShell tests use
mock Bluetooth/node commands and do not remove real pairings. Source index/history privacy audit found zero credential
or personal findings. Flash validation was `-WhatIf` only.

Physical checks remain pending: screen readability and physical confirmation/cancel, persistent bond deletion and retained
configuration, fresh Windows PIN after clearing both ends, restored session/voice/reply path, other-host re-pairing and
failure during a persistent-store write. No card is flashed, reset or unpaired during development checks.
