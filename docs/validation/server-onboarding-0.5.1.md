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
or personal findings. The automated development flash check used `-WhatIf` only; later owner-run device validation is recorded below.

The actual bond-store host tests additionally cover per-server key/identity isolation, stable IDs across reconnect,
scoped reset with another host unchanged, untouched legacy/config namespaces, staging promotion retaining its identity,
copy/commit failures preserving the previous selected generation, collision/SDK ownership checks and retained CCCD/IRK
records for another host. Manifest generation also verifies actual ELF storage symbols; release guards reject the earlier
reset-all v0.5.1 preview. The per-server implementation supersedes that unreleased local preview.

## Owner-reported device acceptance — 2026-10-25

The owner confirmed that v0.5.1 was verified successfully on a physical card. This records the owner's test result;
the automated build and host checks above remain separate evidence. Personal firmware, configuration, device logs
and pairing records are kept locally and are not attached to this public report.

The report did not enumerate individual scenarios. Clean-NVS first-use enrollment, cross-host bond retention,
four-host capacity and interrupted-write recovery still need recorded case-by-case device coverage.
No additional device actions were performed while recording this result. See [storage layout](../bluetooth-storage.md).
