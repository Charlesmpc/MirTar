import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

async function createWorklet() {
  let Processor: any;
  class Base { port = { onmessage: undefined as any, postMessage: (message: any) => messages.push(message) }; }
  const messages: any[] = [];
  runInNewContext(await readFile(new URL('../src/codex/voice-worklet.js', import.meta.url), 'utf8'), {
    AudioWorkletProcessor: Base, sampleRate: 16000, Float32Array, DataView,
    registerProcessor(_name: string, source: any) { Processor = source; },
  });
  return { processor: new Processor(), messages };
}

test('worklet ring wraps for ten minutes, preserves order, and signals drain only after the final samples and silence', async () => {
  const { processor, messages } = await createWorklet();
  const pcm = new Int16Array(320); pcm.fill(8192);
  const output = new Float32Array(128); let nonzero = 0;
  for (let n = 0; n < 30000; n++) {
    processor.port.onmessage({ data: pcm.buffer });
    // Exactly 20ms of media time, alternating two and three 128-sample blocks.
    for (let block = 0; block < (n % 2 ? 3 : 2); block++) {
      processor.process([], [[output]]);
      for (const sample of output) { if (sample) { assert.equal(sample, 0.25); nonzero++; } }
    }
  }
  assert.equal(messages.length, 0); processor.port.onmessage({ data: { end: true } });
  for (let n = 0; n < 400; n++) {
    processor.process([], [[output]]);
    for (const sample of output) if (sample) { assert.equal(sample, 0.25); nonzero++; }
  }
  assert.equal(nonzero, 16000 * 600); assert.equal(messages.length, 1);
  assert.equal(messages[0].drained, true); assert.equal(messages[0].samples, nonzero);
});

test('worklet refuses overflow rather than silently replacing unread samples', async () => {
  const { processor, messages } = await createWorklet();
  processor.port.onmessage({ data: new ArrayBuffer(16000 * 30 * 2) });
  processor.port.onmessage({ data: new ArrayBuffer(2) });
  assert.equal(messages.length, 1); assert.equal(messages[0].error, true);
  processor.port.onmessage({ data: { end: true } });
  processor.process([], [[new Float32Array(128)]]);
  assert.equal(messages.length, 1);
});
