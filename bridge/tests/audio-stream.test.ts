import test from 'node:test';
import assert from 'node:assert/strict';
import { PcmStream, MAX_PENDING_AUDIO_BYTES } from '../src/audio-stream.ts';
import { AudioInput, MAX_AUDIO_BYTES, MAX_RECORDING_SECONDS } from '../src/protocol.ts';

test('ten minutes pass through the validator and consumer without retaining a whole recording', async () => {
  assert.equal(MAX_RECORDING_SECONDS, 600); assert.equal(MAX_AUDIO_BYTES, 19200000);
  const input = new AudioInput(1, 'native'), stream = new PcmStream(), iterator = stream[Symbol.asyncIterator]();
  const frame = Buffer.alloc(652); frame.write('MTA1'); frame.writeUInt32LE(1, 4);
  for (let n = 0; n < 30000; n++) {
    frame.writeUInt32LE(n, 8); stream.append(input.append(frame));
    assert.equal((await iterator.next()).value!.length, 640);
    assert.equal(stream.pendingBytes, 0);
  }
  input.finish(30000); stream.end(); assert.equal((await iterator.next()).done, true);
  assert.equal(stream.totalBytes, MAX_AUDIO_BYTES);
  frame.writeUInt32LE(30000, 8); assert.throws(() => input.append(frame), /audio_limit/);
});

test('a stalled laptop consumer has a bounded backlog and never overwrites unread audio', async () => {
  const stream = new PcmStream(); const chunk = Buffer.alloc(640, 12);
  for (let n = 0; n < MAX_PENDING_AUDIO_BYTES / chunk.length; n++) stream.append(chunk);
  assert.throws(() => stream.append(chunk), /audio_backpressure/);
  assert.equal(stream.pendingBytes, MAX_PENDING_AUDIO_BYTES);
  const iterator = stream[Symbol.asyncIterator](); assert.deepEqual((await iterator.next()).value, chunk);
  stream.abort(); await assert.rejects(iterator.next(), /input_cancelled/);
  assert.equal(stream.pendingBytes, 0);
});

test('explicit end drains queued bytes; cancel wakes a waiting consumer and discards them', async () => {
  const stream = new PcmStream(), iterator = stream[Symbol.asyncIterator]();
  const waiting = iterator.next(); stream.append(Buffer.from([1, 2])); stream.end();
  assert.deepEqual((await waiting).value, Buffer.from([1, 2])); assert((await iterator.next()).done);
  assert.throws(() => stream.append(Buffer.alloc(2)), /audio_closed/);
  const cancelled = new PcmStream(), reader = cancelled[Symbol.asyncIterator]();
  const blocked = reader.next(); cancelled.abort(); await assert.rejects(blocked, /input_cancelled/);
});
