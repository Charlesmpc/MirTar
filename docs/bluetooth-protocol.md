# BLE transport, 0.3.0

BLE carries the existing [device protocol v1](device-protocol.md), without Agent
method names or a separate ASR. ESP32-C3 is the GATT peripheral; Windows is central.
Discovery name is `MirTar-<bluetoothName>` (ASCII name 1–20 characters). The name
must match bridge `bluetooth.hostName`. Discovery is not authorization.

Service: `9a9d0001-4dc1-4c62-8c18-3578e35c7ab1`.
RX: `9a9d0002-4dc1-4c62-8c18-3578e35c7ab1` (Windows writes with response).
TX: `9a9d0003-4dc1-4c62-8c18-3578e35c7ab1` (badge notifications).

Both characteristics require encrypted, authenticated pairing. The badge displays
a random six-digit passkey and Windows asks the operator to enter it. Bond keys
persist in Windows / NimBLE NVS. Existing bonds are never silently evicted to
recover a mismatch. The existing HMAC challenge follows subscription, before
session access. A device cannot attach to BLE and WebSocket at the same time.

Each characteristic value has a six-byte header: byte 0 kind (0 JSON / 1 MTA1
binary), byte 1 message sequence modulo 256, bytes 2–3 offset LE, bytes 4–5 total
message bytes LE. Body follows. Bounds: nonempty messages ≤8192 bytes; characteristic
values ≤244 bytes or negotiated MTU minus 3. First sequence may be any value;
subsequent complete messages must be consecutive. No interleaving. Reassembly
rejects missing/duplicate/out-of-order fragments and allocates only after bounds
validation. A message must finish within five seconds. Disconnect resets framing.

The badge serializes control/audio notifications, retries bounded controller
congestion, and closes the link rather than continuing after a partial send.
Windows serializes response writes with an acknowledgement and five-second timeout
per write, and applies bounded outgoing queues. Original MTA1 frame IDs, frame
counts, recording limits and durable no-replay receipts remain authoritative.

Target connection intervals are 7.5–15 ms, preferred MTU 247. These requests are
not a throughput guarantee: Windows adapter/driver/MTU determine real performance.
Sustained 32 KB/s PCM and microphone capture need physical-device validation.

The TypeScript transport implements DevicePeer and attaches to the same protocol
hub as WebSocket. The native WinRT worker is internal to the Windows host adapter,
using bounded JSON-lines/base64 on stdio, with no microphone content in logs.
Other operating systems can implement another DevicePeer without changing Agents.
