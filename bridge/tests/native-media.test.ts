import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { PcmStream } from '../src/audio-stream.ts';
import { transcribeNative, drainVoiceCleanup } from '../src/codex/voice.ts';
import type { MediaHost } from '../src/host/contracts.ts';

class FixtureRpc extends EventEmitter {
  async initialize() {}
  async request(method: string) { return method === 'thread/start' ? { thread: { id: 'voice-fixture' } } : {}; }
  close() {}
}

test('cancelling after media HTTP headers were sent rejects cleanly and releases the connection', async () => {
  const input = new PcmStream(), controller = new AbortController(), rpc = new FixtureRpc();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, stopped = false;
  let mediaJob: Promise<void> | undefined;
  const media: MediaHost = { async openWebRtc(url) {
    mediaJob = (async () => {
      const response = await fetch(new URL('stream', url)); reader = response.body!.getReader();
      assert.equal((await reader.read()).value!.length, 640); controller.abort();
      await reader.read().catch(() => {});
    })(); mediaJob.catch(() => {});
    return { async stop() { stopped = true; } };
  } };
  const result = transcribeNative('', media, input, controller.signal, () => {}, { rpc });
  input.append(Buffer.alloc(640));
  await assert.rejects(result, /input_cancelled/); await mediaJob; await drainVoiceCleanup(); assert(stopped);
});

test('native completion refuses a wrong sample count and requires normal close after media drain', async () => {
  for (const valid of [false, true]) {
    const input = new PcmStream(), controller = new AbortController(), rpc = new FixtureRpc();
    let mediaJob: Promise<void> | undefined;
    const media: MediaHost = { async openWebRtc(url) {
      mediaJob = (async () => {
        const response = await fetch(new URL('stream', url)); await response.arrayBuffer();
        const drained = await fetch(new URL('drained', url), { method: 'POST', body: JSON.stringify({ samples: valid ? 320 : 319 }) });
        assert.equal(drained.status, valid ? 200 : 502);
        if (valid) {
          const final = await fetch(new URL('final', url), { method: 'POST', body: JSON.stringify({ text: 'Final complete input.', reason: 'client_request', segments: 1 }) });
          assert.equal(final.status, 200);
        }
      })(); mediaJob.catch(() => {}); return { async stop() {} };
    } };
    const result = transcribeNative('', media, input, controller.signal, () => {}, { rpc });
    input.append(Buffer.alloc(640)); input.end();
    if (valid) assert.equal(await result, 'Final complete input.'); else await assert.rejects(result, /native_voice_failed/);
    await mediaJob; await drainVoiceCleanup(); await delay(0);
  }
});
