# v0.5.2 streaming voice and ten-minute capture

Date: 2026-10-26. Windows bridge / Codex native voice. This release retains Agent-owned desktop sessions and the existing Bluetooth/LAN device protocol. It changes the media path, not desktop session activation.

## Behavior

- Firmware capture and bridge reception accept up to 600 seconds of 16 kHz PCM16 mono audio (19,200,000 cumulative bytes). The card continues sending 640-byte / 20 ms frames and does not retain a complete recording. Press OK again before the hard limit; reaching the limit cancels instead of implicitly submitting a task.
- At the first OK, the bridge opens native voice and forwards validated audio incrementally. Laptop queues are bounded to 30 seconds per stage. They fail on overflow rather than overwriting unread speech. No whole-recording WAV conversion/replay remains in the production path.
- The second OK must supply the exact final input ID/frame count. The media engine drains that exact sample count, emits two seconds of silence, and sends `session.close`. User transcript segments (identified by native ID plus audio start time) and `session.closed` are received on the same ordered native data channel. Only a normal `client_request` close after media drain permits one complete-text Agent queue submission.
- A quiet period, assistant response or single completed phrase is not the whole-input completion marker. Missing/abnormal finalization, cancel, disconnect and frame loss never submit partial text. Unknown queue acceptance is never automatically retried.
- Native voice uses the existing Codex sign-in. No additional ASR provider, API key or local recognition model is introduced. Startup and server finalization latency remain; this is not offline recognition.
- Isolated browser cleanup is profile-scoped, starts after native finalization, and is awaited on bridge shutdown. It no longer delays a finalized input's queue submission.

## Evidence

Recognition tests use synthetic speech and temporary read-only voice threads. They do not enqueue an Agent task, access the microphone, replay personal recordings or attach transcripts/logs to public source.

| Check | Result |
| --- | --- |
| Explicit native graceful-close protocol | PASS: WebRTC v3 accepted `session.close` and returned `session.closed`, reason `client_request` |
| Real-time 26.929-second stream | PASS: connected at 13.787 s; first transcript at 19.058 s (before commit at 26.986 s); all audio drained at 42.729 s; close acknowledged at 43.423 s; 408 user transcript characters and both spoken ending markers present |
| Same test, including then-blocking browser cleanup | Returned at 49.857 s, versus about 98.1 s for the previous buffered-replay implementation; cleanup was subsequently moved off the submission path |
| Full 600-second native streaming run | PASS: 600.004 s capture; connected at 12.055 s; first transcript at 15.174 s; exact sample drain at 614.058 s; normal native close at 615.146 s; function returned at 615.161 s (15.157 s after commit). All 20 spoken verification markers retained, 1,835 transcript characters, peak Node-side pending PCM 385,920 bytes |
| TypeScript and bridge regression tests | 29 PASS; includes ten-minute validator/worklet wraparound, backpressure, final marker ordering, abnormal/early close, explicit commit, cancel and no replay |
| Firmware host tests | PASS: configuration/menu guards and server-scoped bond storage |
| ESP-IDF 5.5.6 public firmware build | PASS; merged image 2,811,888 bytes, empty NVS, zero known credential/personal byte matches; no device flash performed |
| Actual mid-stream native cancellation | PASS: cancelled after media connection; clean `input_cancelled`, no HTTP-header crash and no queue submission |
| Physical badge acceptance of v0.5.2 | Not performed; v0.5.1 owner acceptance does not validate the new release |

Earlier development runs exposed a cancellation path that attempted to write HTTP headers twice. That path is fixed and covered by real native cancellation and fixture HTTP regression checks. The complete sequential 600-second run above is the long-run release evidence.

The first connection still has measurable setup cost. Long-running native recognition and network conditions affect tail latency; no fixed few-second completion guarantee is made.

## Upgrade / 升级

1. Stop the running bridge with Ctrl+C, then update the checkout to v0.5.2. Keep `.private` local; configuration schema, server IDs and Bluetooth storage are unchanged.
2. Run `npm.cmd ci --ignore-scripts` if dependencies are absent, then `.\tools\Start-Bridge.ps1`. The console should include `Voice: live native stream | max 10 min`. An older running process does not load new source automatically.
3. A v0.5.1 card can use streaming with the new bridge but retains its old 30-second capture cap. For ten-minute capture, also update the firmware. Existing v0.5.1 devices should use the compatible segmented flash with `-PreserveNvs` to retain configuration and pairings; do not erase the card. Full merged flashing can replace NVS.
4. After building the public image, use the actual enumerated port (the placeholder below must be replaced):

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\Flash-Firmware.ps1 -Port COM_PORT -BuildDirectory .private/build-v0.5.2 -PreserveNvs
```

5. Reconnect the card, press OK to speak and OK again to submit. Check the original desktop session and badge reply. Start with a short recording, then a longer one. Close/focus problems of a desktop session are a separate issue and are not fixed by this release.

公版固件从空主机列表开始；公开包不含个人配置、Wi-Fi 密码、主机地址或蓝牙配对资料。已有 0.5.1 卡片保留 NVS 升级时继续使用原有配置。桥接与固件都要更新才能使用 10 分钟上限；只更新桥接，也能使用实时转发，但卡片仍最多录 30 秒。没有执行实机刷写。
