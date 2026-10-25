import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioInput, authProof, verifyProof, truncateUtf8, pcm16kToWav24k } from '../src/protocol.ts';

test('binding proof is tied to the challenge; malformed and replayed proofs fail', () => {
  const secret = 'a'.repeat(64), challenge = 'b'.repeat(64);
  assert(verifyProof(secret, challenge, authProof(secret, challenge)));
  assert(!verifyProof(secret, 'c'.repeat(64), authProof(secret, challenge)));
  assert(!verifyProof(secret, challenge, 'not hex'));
});
test('audio rejects wrong input IDs, missing frames and duplicates before commit', () => {
  const input = new AudioInput(12, 'native-session');
  const frame = Buffer.alloc(652); frame.write('MTA1'); frame.writeUInt32LE(12, 4);
  input.append(frame);
  assert.throws(() => input.append(frame), /invalid_audio_frame/);
  assert.throws(() => input.finish(3), /incomplete_audio/);
  for (let i = 1; i < 5; i++) { frame.writeUInt32LE(i, 8); input.append(frame); }
  assert.equal(input.finish(5).length, 3200);
});
test('UTF-8 reply truncation retains complete Chinese and supplementary characters', () => {
  assert.equal(truncateUtf8('中文🙂abc', 7), '中文');
  assert.equal(truncateUtf8('中文🙂abc', 10), '中文🙂');
});
test('16k PCM becomes a valid 24k mono WAV with bounded interpolation', () => {
  const pcm = Buffer.alloc(320); for (let i = 0; i < 160; i++) pcm.writeInt16LE(i * 100, i * 2);
  const wav = pcm16kToWav24k(pcm);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF'); assert.equal(wav.readUInt32LE(24), 24000);
  assert.equal(wav.length, 44 + 240 * 2); assert.equal(wav.readUInt32LE(40), 480);
  assert.equal(wav.readInt16LE(44 + 120 * 2), 8000);
});
