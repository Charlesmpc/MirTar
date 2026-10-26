import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { CodexAdapter } from '../src/codex/adapter.ts';
import type { transcribeNative } from '../src/codex/voice.ts';

function fixture(transcribe: typeof transcribeNative) {
  const queued: any[] = [];
  const adapter = new CodexAdapter({ bin: '', edgePath: '', sessions: [{ id: 'native-session', name: 'Test' }] },
    { async openWebRtc() { throw Error('unused'); } }, { transcribe, rpc: {
      async initialize() {}, close() {},
      async request(method, params) { assert.equal(method, 'thread/queue/add'); queued.push(params); return { queuedSubmission: { id: 'queue-receipt' } }; },
    } });
  return { adapter, queued };
}

test('Codex receives chunks before commit, then queues exactly once after final native recognition', async () => {
  let bytes = 0, close!: (text: string) => void;
  const finalized = new Promise<string>(resolve => { close = resolve; });
  const f = fixture(async (_bin, _media, stream) => { for await (const pcm of stream) bytes += pcm.length; return finalized; });
  try {
    const audio = f.adapter.beginAudio('native-session', new AbortController().signal);
    audio.append(Buffer.alloc(640)); await delay(0); assert.equal(bytes, 640); assert.equal(f.queued.length, 0);
    const committed = audio.commit('original-input', () => {}); await delay(0); assert.equal(f.queued.length, 0);
    close('Complete user request with its final words.'); assert.equal((await committed).submissionId, 'queue-receipt');
    assert.equal(f.queued.length, 1); assert.equal(f.queued[0].threadId, 'native-session');
    assert.equal(f.queued[0].clientUserMessageId, 'original-input');
    assert.equal(f.queued[0].input[0].text, 'Complete user request with its final words.');
    await assert.rejects(audio.commit('duplicate', () => {}), /audio_closed/); assert.equal(f.queued.length, 1);
  } finally { await f.adapter.close(); }
});

test('cancel during recognition and a failed native finalization never queue a partial request', async () => {
  const cancelled = fixture(async (_bin, _media, stream, signal) => {
    const abort = () => stream.abort(); signal.addEventListener('abort', abort, { once: true });
    try { for await (const _pcm of stream) {} signal.throwIfAborted(); return 'Must not submit'; }
    finally { signal.removeEventListener('abort', abort); }
  });
  const controller = new AbortController();
  try {
    const audio = cancelled.adapter.beginAudio('native-session', controller.signal); audio.append(Buffer.alloc(640));
    controller.abort(); await assert.rejects(audio.commit('cancelled', () => {}));
    assert.equal(cancelled.queued.length, 0);
  } finally { await cancelled.adapter.close(); }
  const failed = fixture(async (_bin, _media, stream) => { for await (const _pcm of stream) {} throw Error('native_transcript_timeout'); });
  try {
    const audio = failed.adapter.beginAudio('native-session', new AbortController().signal); audio.append(Buffer.alloc(640));
    await assert.rejects(audio.commit('failed', () => {}), /native_transcript_timeout/); assert.equal(failed.queued.length, 0);
  } finally { await failed.adapter.close(); }
});
