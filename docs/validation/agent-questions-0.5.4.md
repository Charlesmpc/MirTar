# Agent questions — 0.5.4 development validation

Date: 2026-10-26. Public ESP-IDF 5.5.6 build; Windows host; installed Codex `0.164.0-alpha.11.1`.
This record separates real backend evidence, host simulation and untested hardware/UI behavior.

## Implemented

- Optional, explicitly configured bridge-owned sessions. Legacy desktop forwarding remains the default for old configs.
- New-AgentSession creates and initializes a dedicated persistent session; New-LocalConfig supports BridgeOwned with no desktop UUID.
- Normal bridge-owned input uses turn/start. Native item/tool/requestUserInput and the dedicated mirtar_ask_user tool use
  original JSON-RPC responses. Answers never enter thread/queue/add or start another Agent task.
- AgentAdapter exposes questions, answer audio, choice/skip and task state. The card has a scrolling question screen and
  answer menu with voice, options, group skip and back. Existing long-press navigation and Delete server remain.
- Question batches are scoped by connection request, session, turn, interaction and question. Earlier answers are retained
  until the group is complete; unresolved requests survive card reconnect while the backend stays running.
- Secret-marked prompts are redacted. Unsupported execution/permission requests are never approved by the bridge.
- Intent receipts precede native mutations. Unknown answer delivery freezes retries; cancellation, stale questions and foreign
  sessions cannot submit partial audio or create a replacement task. JSON-RPC request IDs in opposite directions cannot collide.

## Real backend checks

| Check | Actual evidence | Result |
| --- | --- | --- |
| Native requestUserInput availability | Default execution mode reported tool unavailable; Plan mode emitted the native request and accepted the fixed Blue test answer | PASS; use a dedicated tool in ordinary execution mode |
| Dedicated question tool | Real Codex asked two questions; first answered with Blue option, second through the audio-commit path with simulated ORBIT recognition; original task returned MIRTAR_RESULT_Blue_ORBIT | PASS; this test alone is not real ASR evidence |
| Original request + real ASR | WebSocket card simulator received a real question, sent locally synthesized “The test word is orbit”; native WebRTC emitted connected, first_transcript, audio_drained and session_closed; original Agent returned LIVE_AUDIO_OK_ORBIT | PASS in two runs, 37.04 and 32.79 seconds |
| No extra task for an answer | One Agent turn/start, one original tool-response write, zero desktop queue/add calls in the real-ASR round-trip | PASS |
| Desktop history access | Codex desktop read_thread returned the named test session, completed dynamic tool item and expected final answer | PASS; not a graphical UI takeover test |
| Context continuity after bridge exit | New process resumed exactly the same stored thread; following read-only test returned HANDOFF_ORBIT | PASS |
| Windows setup | New-AgentSession ran under Windows PowerShell 5.1, persisted a new session and preserved existing entries | PASS |
| Fresh config without desktop UUID | Isolated copy ran New-LocalConfig -BridgeOwned -BluetoothOnly; one bridge-owned session was saved; original real config hash unchanged | PASS, Windows PowerShell 5.1.26100.9711 |

All backend tests used separate, harmless test conversations. No existing work conversation was resumed or changed.
Only the fixed synthetic test audio was sent to native Codex recognition. No user recordings or screenshots were uploaded.
Personal session IDs, paths, audio, setup receipts and raw diagnostics remain local and are not part of public source.

## Regression and firmware

Host checks cover original voice/transport behavior plus request-ID collisions, native/dynamic result envelopes, multi-question
ordering, options, secrets, skip, cancel, stale completions, ownership failure, delivery failure, cross-session isolation,
card disconnect/reconnect, duplicate choice receipts and late audio results. Firmware host checks run the actual question
parser and recording/answer guards, including oversized/invalid messages and immutable rejected updates.
TypeScript check, **51 bridge tests**, four portal tests, the actual C configuration/question/bond/deletion checks,
and six public/personal firmware-bundle guard tests all pass.

ESP32-C3 public firmware compiled with actual question parser/answer symbols linked; merged NVS is empty.
No private preset is an input. The unchanged partition layout supports an NVS-preserving app/segmented upgrade.
Final checked public image (no personal preset):

```text
Version:                  0.5.4
MirTar-full.bin (0x0):     428cff631033614b44539eb2af84003e7f23f226523b47202b910e6c11a610f3
MirTar.bin (0x10000):     ba2c8cd8a6701c2fabd1ac6e9e1cb322c9bd12d656912e36f003b88550238183
Merged bytes:             2820352
NVS:                      empty
```

Use an app-only or segmented NVS-preserving upgrade to retain existing personal configuration and pairing records.
No personal image is a public release asset. No hardware was flashed during these checks.

## First-start workspace follow-up (2026-10-27)

The bridge now bootstraps an empty session list on startup. It creates a writable default folder under the user's home,
or uses an explicitly configured existing project, then persists the native session ID and per-session `cwd`.
The card only receives a configuration error code; absolute local paths stay on the computer.

- Eight added setup/adapter tests cover default creation, saved-session reuse across restarts, explicit and host-default
  paths, preservation of legacy sessions/bindings, missing/unusable directories, recorded bootstrap recovery, concurrent
  edits, unknown creation outcomes, concurrent setup exclusion, and a directory removed after activation.
- A ninth added bridge test sends setup/selection failures through the authenticated fragmented BLE protocol and verifies
  that an unselected unavailable session cannot start audio. Actual C checks verify the setup-error page blocks recording.
- Windows PowerShell 5.1 ran default and custom `New-LocalConfig -BridgeOwned` setups in isolated ignored folders;
  both saved empty session lists for first-start initialization. Optional `New-AgentSession` arguments and helper syntax passed.
- The installed real Codex backend initialized a separate test session using only the fixed `MIRTAR_READY` prompt.
  Its workspace and native ID were persisted, a second setup pass reused them without another creation request,
  and a fresh adapter resumed the same thread. The actual user's bridge config hash remained unchanged.
- The updated public firmware compiled successfully. Its manifest reports no embedded/personal configuration, empty NVS,
  and zero known credential/personal matches. Physical card display/button acceptance is still pending.

These checks do not establish recovery of an unfinished Agent task or question after a bridge crash.
Setup receipts prevent automatic duplicate creation when initialization has an unknown outcome.

## Background service and owner confirmation (2026-10-28)

Three additional bridge checks cover a real child process lifecycle (duplicate start, stale stop requests, graceful stop
and restart), worker failure status, and clean rejection of an occupied port without an unhandled WebSocket error.
The same management scripts were installed in two Windows user sessions. Login triggers, one-instance policy, listener
ownership, automatic executable relocation and exact preservation of private configuration were checked. A live stop/restart
cycle passed on the local installation; remote idempotent startup passed. No user logout/reboot was performed to test the trigger.

The owner confirmed Add server and a physical Bluetooth voice/reply round-trip with the 0.5.4 application. A legacy desktop
request was accepted but remained queued until its desktop conversation was activated; the same original request then completed
and the owner confirmed the reply appeared on the card. No message was replayed. This does not validate physical card questions
or deletion. A desktop writer conflict was also reproduced: merely switching desktop chats did not release ownership.

## Remaining coverage

- The public merged image has not been flashed by the agent. Owner confirmation covers the basic Bluetooth voice/reply flow,
  not every question/menu/deletion path. Those physical buttons, readability and question audio still need acceptance.
- Desktop API access and new-process continuation do not establish simultaneous desktop/card control or graphical takeover.
- Bridge-process restart/crash recovery of unfinished questions is not promised. Card-only reconnect is tested separately.
- Native desktop popups in legacy forwarding sessions are not redirected. Users must select a new bridge-owned session.
- Native model behavior may choose not to ask; the dedicated question tool is an available interaction path, not a guarantee
  that every model utterance becomes a question. Experimental Codex interfaces and other installed versions need revalidation.
- Execution/permission approvals, secret input UI and desktop-only tools are outside this implementation.

Documentation basis: [official Codex App Server](https://learn.chatgpt.com/docs/app-server).
