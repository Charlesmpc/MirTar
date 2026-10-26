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
TypeScript check, **39 bridge tests**, four portal tests, the actual C configuration/question/bond/deletion checks,
and six public/personal firmware-bundle guard tests all pass.

ESP32-C3 public firmware compiled with actual question parser/answer symbols linked; merged NVS is empty.
No private preset is an input. The unchanged partition layout supports an NVS-preserving app/segmented upgrade.
Final checked development image (no personal preset):

```text
Version:                  0.5.4
MirTar-full.bin (0x0):     7671e6a50704e58f24a08b2d9b29628d4a3d63d80f8cf9c4b1f2785755ddff89
MirTar.bin (0x10000):     83ee043bad5b6ec34be466d9a00a729afbc29390d41ecb046c3c2d2a57de91b9
Merged bytes:             2819872
NVS:                      empty
```

Use an app-only or segmented NVS-preserving upgrade to retain existing personal configuration and pairing records.
No personal image is a public release asset. No hardware was flashed during these checks.

## Remaining coverage

- No actual badge has been flashed for this feature. Physical buttons, small-screen readability and question audio over the
  real BLE radio or Wi-Fi need owner acceptance. Host protocol/framing tests do not substitute for this.
- Desktop API access and new-process continuation do not establish simultaneous desktop/card control or graphical takeover.
- Bridge-process restart/crash recovery of unfinished questions is not promised. Card-only reconnect is tested separately.
- Native desktop popups in legacy forwarding sessions are not redirected. Users must select a new bridge-owned session.
- Native model behavior may choose not to ask; the dedicated question tool is an available interaction path, not a guarantee
  that every model utterance becomes a question. Experimental Codex interfaces and other installed versions need revalidation.
- Execution/permission approvals, secret input UI and desktop-only tools are outside this implementation.

Documentation basis: [official Codex App Server](https://learn.chatgpt.com/docs/app-server).
