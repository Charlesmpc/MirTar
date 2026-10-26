import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { setTimeout as delay } from 'node:timers/promises';

async function fixture() {
  const posts: { path: string; body: any }[] = [], commands: any[] = [];
  let channel: any, source: any, end!: () => void;
  const read = new Promise<any>(resolve => { end = () => resolve({ done: true }); });
  class Context {
    sampleRate = 16000; audioWorklet = { async addModule() {} };
    async resume() {} async close() {}
    createMediaStreamDestination() { return { stream: { getTracks: () => [] } }; }
  }
  class Worklet { port = { postMessage() {}, onmessage: undefined as any }; constructor() { source = this; } connect() {} }
  class Connection {
    connectionState = 'connected'; localDescription = { sdp: 'fixture' };
    addTrack() {} close() {} async createOffer() { return {}; } async setLocalDescription() {} async setRemoteDescription() {}
    createDataChannel() { return channel = { readyState: 'open', send: (value: string) => commands.push(JSON.parse(value)) }; }
  }
  runInNewContext(await readFile(new URL('../src/codex/voice-page.js', import.meta.url), 'utf8'), {
    AudioContext: Context, AudioWorkletNode: Worklet, RTCPeerConnection: Connection, Uint8Array,
    setTimeout, clearTimeout,
    fetch: async (path: string, options?: any) => {
      if (path === 'stream') return { ok: true, body: { getReader: () => ({ read: () => read, async cancel() {} }) } };
      if (path === 'offer') return { ok: true, json: async () => ({ sdp: 'fixture' }) };
      posts.push({ path, body: options?.body ? JSON.parse(options.body) : undefined }); return { ok: true };
    },
  });
  for (let n = 0; !source?.port.onmessage && n < 50; n++) await delay(1);
  assert(source?.port.onmessage); await delay(1);
  const emit = async (event: any) => { await channel.onmessage({ data: JSON.stringify(event) }); };
  const segment = (id: string, text: string, start: number) => emit({ type: 'input_transcript.added', item: { id, text }, start_ms: start, end_ms: start + 100 });
  return { posts, commands, emit, segment, end,
    async drained() { end(); await delay(1); await source.port.onmessage({ data: { drained: true, samples: 3200 } }); },
  };
}

test('only normal session.closed after explicit media drain finalizes all ordered user segments, including the last one', async () => {
  const f = await fixture();
  await f.segment('second', 'old', 200); await f.segment('first', 'Start ', 100);
  await f.segment('second', 'middle ', 200); // Revision of one segment, not a duplicate utterance.
  await f.emit({ type: 'turn.done' }); await f.emit({ type: 'output_transcript.added', item: { text: 'Never submit assistant text' } });
  assert.equal(f.posts.length, 0); assert.equal(f.commands.length, 0);
  await f.drained(); assert.equal(f.commands[0].type, 'session.close');
  assert(!f.posts.some(p => p.path === 'final'));
  await f.segment('first', 'tail.', 300); // Native IDs may restart in a later speech turn.
  await f.emit({ type: 'session.closed', reason: 'client_request' });
  const final = f.posts.find(p => p.path === 'final'); assert(final);
  assert.equal(final.body.text, 'Start middle tail.'); assert.equal(final.body.segments, 3);
});

test('an early or abnormal close cannot finalize a partial recording', async () => {
  const early = await fixture(); await early.segment('first', 'partial', 0);
  await early.emit({ type: 'session.closed', reason: 'client_request' }); early.end();
  assert(early.posts.some(p => p.path === 'failed')); assert(!early.posts.some(p => p.path === 'final'));
  const abnormal = await fixture(); await abnormal.segment('first', 'partial', 0); await abnormal.drained();
  await abnormal.emit({ type: 'session.closed', reason: 'error' });
  assert(abnormal.posts.some(p => p.path === 'failed')); assert(!abnormal.posts.some(p => p.path === 'final'));
});
