import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { safeInputErrorCode } from '../src/input-error.ts';

test('reports transcript finalization timeout separately from a voice connection failure', () => {
  assert.equal(safeInputErrorCode(new Error('native_transcript_timeout')), 'native_transcript_timeout');
  assert.equal(safeInputErrorCode(new Error('native_voice_failed')), 'native_voice_failed');
});

test('upstream private details cannot enter the public diagnostic code', () => {
  const privateDetail = 'private-input-' + randomUUID();
  assert.equal(safeInputErrorCode(new Error(privateDetail)), 'input_failed');
  assert.equal(safeInputErrorCode(new Error('native_voice_failed: ' + privateDetail)), 'input_failed');
  assert.equal(safeInputErrorCode({ message: privateDetail }), 'input_failed');
  assert.equal(safeInputErrorCode(null), 'input_failed');
});
