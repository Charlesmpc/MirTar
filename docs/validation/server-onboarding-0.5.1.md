# Bluetooth recovery validation — 0.5.1

This revision retains the v0.5.0 three-entry home and per-host configuration. It adds a physical pairing-reset action
after one minute without completing binding to an existing host. Reset is never automatic.

## Behavior

- Initial waiting and repeated disconnects share a timer. Authenticated application binding clears it.
- An actual pairing PIN grants a fresh minute so the reset prompt does not immediately replace the code.
- OK opens confirmation; Cancel is selected first. UP/DOWN select; OK confirms. Hold OK returns home.
- Card reset stops the NimBLE host and resets only the active server ID's binary profile before deinitializing.
  Metadata plus A/B store banks belong to each server ID; MirTar config stays in its separate `mirtar` namespace.
- Each server has an automatically generated static identity, allowing a fresh Windows pairing after a scoped reset.
  Enrollment staging is copied/published on physical server confirmation; no address or key is hand-entered.
- Legacy global bonds are retained unused rather than guessed, assigned or globally deleted.
- Failure is reported. A failed stop/deinit requires restart; the UI does not pretend reset succeeded.
- Windows pairing is reset only by the explicit local `-ResetBluetoothPairing` option. It selects one paired record by
  exact configured Bluetooth name and rejects ambiguity. No radio advertisement or failed GATT request can authorize unpairing.
- Explicit Windows cleanup is optional maintenance for old records, not required for new scoped resets. Neither path edits Agent sessions,
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

The actual bond-store host tests additionally cover per-server key/identity isolation, stable IDs across reconnect,
scoped reset with another host unchanged, untouched legacy/config namespaces, staging promotion retaining its identity,
copy/commit failures preserving the previous selected generation, collision/SDK ownership checks and retained CCCD/IRK
records for another host. Manifest generation also verifies actual ELF storage symbols; release guards reject the earlier
reset-all v0.5.1 preview. The per-server implementation supersedes that unreleased local preview.

Physical checks remain pending: screen readability and confirmation/cancel, persistent per-server deletion, retained
other-host bonds/config, fresh Windows PIN with a static random identity, enrollment-to-normal identity reuse,
session/voice/reply path, NVS space with four hosts and failure during flash writes. No card is flashed, reset or unpaired
during development checks. See [storage layout](../bluetooth-storage.md).
