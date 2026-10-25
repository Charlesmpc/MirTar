# Device protocol v1

[简体中文](device-protocol.zh_CN.md)

M1 uses native WebSocket clients at `/device`, JSON text control frames and binary PCM frames. It is Agent-neutral: no Codex method names appear on the card wire. The Windows bridge contains the concrete Agent adapter.

## Binding and sessions

The configured device opens its target URL and sends `{type:"hello",version:1,deviceId,bootId}`. `bootId` is 16 random bytes encoded as 32 lowercase hexadecimal characters. The bridge returns `{type:"challenge",challenge}` with 32 random bytes encoded as 64 hex characters. The device replies `{type:"auth",proof}` where `proof` is lowercase hex HMAC-SHA256(shared secret as UTF-8, challenge as UTF-8). Authentication must complete in five seconds. The bridge allows one active connection per configured device.

Success returns `{type:"bound",version:1,adapterId,sessions,audio,capabilities}`. `sessions` contains only available configured native IDs/display names. Initial capabilities explicitly advertise `liveRuntimeState:false`, `approvals:false`, `tts:false`, `textReply:true`. Choose an ID using `{type:"select",sessionId}`; the response is `{type:"selected",sessionId}`. An unavailable ID is not replaced or silently created.

## Two-press recording

The first OK sends `{type:"begin",id}` with a nonzero 32-bit integer, increasing per boot. The bridge locks the currently selected session for this input and answers a `state` message. Capture is 16 kHz signed little-endian PCM16, mono. Audio frames have this exact layout:

| Offset | Bytes | Meaning |
| --- | --- | --- |
| 0 | 4 | ASCII `MTA1` |
| 4 | 4 | Input ID, uint32 little endian |
| 8 | 4 | Sequence, uint32 little endian, starting at zero |
| 12 | 2–1280, even | PCM bytes; current firmware uses 640 bytes / 20 ms |

Frames must arrive in order with no duplicate or missing sequence. Maximum buffered audio is 960,000 bytes (30 seconds); a recording expires after 35 seconds on the bridge. Before commit, audio stays in bridge memory and is not delivered to the Agent voice service.

The second OK sends `{type:"commit",id,frames}`. The count must match all received frames. `{type:"cancel"}` discards unsubmitted capture; cancellation during processing is best effort and cannot recall an accepted native queue item. Switching sessions during recording is rejected. Reading another session after submit does not cancel the Agent task.

## Results and recovery

`state` messages include `sessionId`, input `id`, and a precise state: `recording`, `recognizing`, `submitting`, `accepted`, `completed`, or `submission_unknown`. `accepted` means the native Agent queue acknowledged the input, not that execution finished. `completed` is correlated to the submitted native client message, using the returned client identity or the exact submitted user text retained only in bounded memory; a pre-existing baseline turn is excluded. `reply` contains `sessionId`, `turnId`, `text`, `completed` and `truncated`. The current Codex path emits only completed formal replies, polling every 1.5 seconds. Cards filter the native session ID before displaying content.

The bridge stores a minimal receipt before native submission, keyed by SHA256(deviceId + ":" + bootId + ":" + inputId). Reusing that identity cannot enqueue again, including after bridge restart. Receipts retain only submission identity/status, never audio, transcript or conversation history. An unknown receipt is deliberately not automatically retried. Bridge shutdown/network loss may leave accepted work running on the desktop.

Bounds: client control messages ≤2,048 bytes; incoming WebSocket payload ≤8,192 bytes; queued receive data ≤128 KiB; outgoing card messages ≤8,000 UTF-8 bytes. Reply text is truncated on Unicode boundaries to ≤6,144 bytes, and further reduced if JSON escaping would exceed the wire limit. No transcript or raw microphone recording is logged by the bridge. The card keeps a bounded current reply and deferred reply, not a new formal history store.

The bridge pings every 15 seconds and terminates an unresponsive client on the next interval. Wi-Fi retries configured entries; WebSocket reconnect never replays an input. Unknown acceptance, unavailable native state, microphone failures and playback capabilities must remain distinguishable from success. There is no automatic firewall opening, public listener, cloud binding or remote authentication claim in v1.
