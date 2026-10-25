# First card-loop implementation validation

[简体中文](m1-first-loop.zh_CN.md)

Validation snapshot: 2026-10-24, before the first implementation commit on `codex/m1-card-loop`. At the time of this snapshot the increment was uncommitted, no Git push or hardware flash had been performed, and GitHub readback confirmed the repository remained private. Later commits do not imply physical-card acceptance.

| Check | Result | Evidence and boundary |
| --- | --- | --- |
| Bridge build/type check | PASS | Node 24.13.0, TypeScript 5.9.3, `npm run check` |
| Host tests | PASS | Five Node tests: binding proof/replay rejection, frame integrity, UTF-8 bounds, PCM resampling, WebSocket bind/cancel/commit/deduplication/two-session routing |
| Real Codex integration | PASS | Synthetic device used the production bridge protocol, native WebRTC v3, original desktop queue and formal reply polling. Input/reply correlation passed after Windows host services were isolated. |
| Firmware build | PASS | ESP-IDF 5.5.6, LVGL 9.5.0, ESP32-C3, 8 MB, no PSRAM. C sources, generated font, final ELF and application binary built successfully. |
| Firmware packaging | PASS | Actual bootloader, partition table and app bytes match the merged image; matching ELF and segment hashes recorded in `firmware/build/mirtar-manifest.json`. |
| Private configuration | PASS | Configuration/header/firmware ignored by Git. Multi-network generation and invalid SSID rejection tested. Template image is rejected before serial access. |
| Device tests | NOT RUN | User is outside the intended Wi-Fi environment. Build uses template values; no card flashing or physical acceptance is claimed. |

## Desktop execution evidence

The dedicated **MirTar 验证** desktop session received the synthetic request to calculate `731 * 947` locally without changing files. The original desktop Agent executed PowerShell with exit code 0/output `692257`, and replied `692257 completed`. Production bridge runs generated distinct native turns, including `01a16cf8-2ff0-7fa3-bb48-a2c2a1f43e26`, `01a16cff-34ce-7f70-a2f2-aa48972476e2`, and the final host-isolation regression `01a16dfc-56c2-7102-9bff-d574c445deec`. The final simulator reported `INPUT_CORRELATION_PASS`. No bridge/card ASR service or new API key was introduced. Workspace-owned WebRTC media processes were checked after tests; none remained at that check.

The device client uploaded 674 PCM frames, 13.4645 seconds after conversion. This was buffered and committed explicitly. These numbers describe the input fixture, not network/recognition performance or hardware microphone quality. Native tests cover one real desktop session; two-session routing is host-tested with a fixture, not yet validated on two real desktop sessions.

## Exact template build

- Merged image: `firmware/build/MirTar-full.bin`, offset `0x0`, **2,477,024 bytes**.
- Merged SHA256: `ca1da18f751c397dbcd7001370b5834f8357597b33fb550edd63460e72b436e6`.
- ELF SHA256: `0893802781aaa8f3303e32569f5958c6cce6c54729fd929b2234f44f5800bda3`.
- Application image: 2,411,488 bytes; 71% of the factory partition remains free.
- Link-time DRAM: 189,458 bytes used / 131,838 bytes remaining in the reported region. This is not runtime free heap after Wi-Fi, audio, stacks and display allocations.
- The embedded configuration is explicitly marked **templateConfiguration=true**. Do not use this image as a configured device build.

The private SDK has recorded Windows build-helper changes: bounded retries for successful-but-empty compiler queries, and strict objdump output verification against every physical ELF archive member/section name/size plus the original SDK grammar. Non-empty truncation rejection was tested. Real metadata is retried, never synthesized. No endpoint protection or system certificate settings were changed. The final build used the activated SDK environment; firmware and debug artifacts remain local and ignored.

## First physical startup and backlight correction (2026-10-24)

The first configured image had SHA256 `e1ae21814ba20af0f368d4aaab42d752512cb4987ffda789056fe6fcc74efe06`, with matching ELF SHA256 `5ba675d8af7666ab86bf3addb781ae83dd00fe7c85578ec2f2a86a4c7d5e5bd4`. After the user's USB flash, the display remained dark. A 20-second USB startup capture showed the new ESP-IDF 5.5.6 bootloader loading the factory application and `MirTar startup: heap=94204 largest=86016, microphone_idle=off`, followed by Wi-Fi initialization output. No panic or repeated boot was captured. Two I2S disable errors did not stop startup; their effect on later recording remains unverified.

The user confirmed a startup sound but no backlight. Source inspection found that the BSP initializes backlight PWM with duty zero, while MirTar never enabled it. The application now calls `bsp_display_backlight(80)` after creating and rendering the startup UI. The original image, matching ELF, configuration and redacted diagnostic log are preserved under ignored `.private/` paths. A successful rebuild alone will not validate the correction: reflash the corrected image, confirm a visible startup screen and readable text, then test binding and recording. No configured binaries, private configuration or raw device logs belong in Git.

The device's USB identity also matched the LAN neighbor with an established TCP connection to the configured bridge port, confirming network reachability, without proving session binding or audio submission. The backlight correction built and passed merged-segment verification: full image SHA256 `7fe3a798738a051c460ce24ac2a2301c8eac9a815851a7d6f2c0cd358e43bb13`, 2,477,488 bytes at `0x0`, matching ELF SHA256 `f8726e0230d119197993e327ebc9ed36388cdc0321879f9297bfb529079942a1`. Embedded configuration is unchanged and is not a template. Host tests were not rerun for this BSP-call-only correction; validation still requires a physical reflash and visual check. The corrected image has not been flashed by the agent.

## Still unverified

Later user observation on the original configured image: while the display was dark, pressing OK, speaking and pressing OK again delivered the message to the intended MirTar desktop session. Record this as **user-reported physical voice-input success**, beyond the earlier synthetic-device integration. It does not verify the corrected image's display, card reply rendering, sustained recording or other pending checks below.

Physical Wi-Fi list failover, wrong-password behaviour, LAN reachability/firewall policy, binding/rebinding on card, microphone wake/capture/levels, frame pacing, 30-second cancellation, display/glyph rendering, scrolling, physical key semantics, power/battery, runtime heap/stack margins, sustained multiple turns, real two-session routing, disconnect timing around acceptance and long replies. Live runtime/approval reporting is unavailable through the current path, and TTS is explicitly disabled. Native speech service quota/availability and overall latency are not guaranteed by these tests.

Next: fill `.private/device.config.json` and `.private/bridge.config.json` locally, including the `wifiNetworks` array, rebuild and verify the configured image, identify the actual USB port, then arrange card testing in the target network. Do not upload configuration-bearing binaries or credentials.
