# Native voice finalization — local bridge patch

Date: 2026-10-26. Historical buffered-audio investigation after v0.5.1, before the streaming implementation in [v0.5.2](streaming-voice-0.5.2.md). The v0.5.2 implementation supersedes the local timeout-only patch described below; these results document the original failure, not the current media path.

The owner reported a generic card error after a 20–30 second recording. The bridge listener remained available;
the newest receipt had no accepted submission ID, and no matching queued input or recent task turn was found.
Native logs showed transcript segments continuing before the voice connection ended. No original audio was replayed.

Recognition-only checks used existing synthetic WAVs, a temporary read-only native voice thread and an isolated Edge
profile. They did not enqueue a message, execute an Agent task, use another ASR provider or require another API key.
Only counts and timings are recorded here; diagnostic files and transcripts remain outside public source.

| Check | Result |
| --- | --- |
| 8.2145-second synthetic clip, original window | PASS; complete native transcript in about 24.7 seconds |
| 26.929-second synthetic clip, original 25-second finalization window | FAIL at about 65.6 seconds; one completed user part and 245 pending characters; deltas were still arriving within the preceding second |
| Same 26.929-second clip, 60-second finalization window | PASS at about 98.1 seconds; 408 transcript characters, no unfinished delta, both spoken ending markers present |
| TypeScript | PASS |
| Bridge tests | 18 PASS, including unknown-error redaction; rerun outside the sandbox after a loopback test was blocked with EACCES |

The patch extends the post-playback transcript window from 25 to 60 seconds and retains the separate 110-second overall
voice timeout. Existing finalization checks remain required; incomplete text is not submitted or replayed. The bridge
prints an allowlisted diagnostic code, including `native_transcript_timeout`, without upstream text, paths or credentials.

At the time of this experiment, restarting the bridge was required to load that local patch. Firmware and session activation are unchanged.
Card microphone acceptance after restart remains to be checked by the owner. Long-input latency is still substantial;
this change addresses premature failure rather than proving faster recognition or success under every network condition.
