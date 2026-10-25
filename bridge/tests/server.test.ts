import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { setTimeout as delay } from 'node:timers/promises';
import { authProof } from '../src/protocol.ts';
import { startBridge } from '../src/server.ts';
import type { AgentAdapter, BridgeConfig } from '../src/contracts.ts';

test('device binds, commits only on explicit end, receives native-style reply; cancel never submits', async () => {
  const secret = randomBytes(32).toString('hex'), root = await mkdtemp(join(tmpdir(), 'mirtar-test-'));
  const messages: any[] = []; let submissions = 0, completed = false, sourceInput = '';
  const adapter: AgentAdapter = {
    id: 'test-fixture', sessions: async () => [{ id: 'session-1', name: 'mirtar #1' }, { id: 'session-2', name: 'mirtar #2' }],
    history: async session => completed && session === 'session-2' ? [{ turnId: 'turn-1', text: '中文回复', completed: true, inputId: sourceInput }] : [],
    submitAudio: async (session, pcm, inputId, _signal, progress) => { assert.equal(session, 'session-2'); assert.equal(pcm.length, 6400); sourceInput = inputId; submissions++; progress('recognizing'); completed = true; return { submissionId: 'native-queue-1' }; },
    close: async () => {},
  };
  const config: BridgeConfig = { version: 1, listen: { host: '127.0.0.1', port: 0, allowLanPlaintext: true }, devices: [{ id: 'test', secret }], codex: { bin: '', edgePath: '', sessions: [] } };
  const bridge = await startBridge(config, adapter, root);
  const address = bridge.address; assert(address && typeof address === 'object');
  const ws = new WebSocket(`ws://127.0.0.1:${address.port}/device`);
  ws.on('message', raw => messages.push(JSON.parse(raw.toString())));
  async function wait(type: string) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) { const index = messages.findIndex(m => m.type === type); if (index >= 0) return messages.splice(index, 1)[0]; await delay(10); }
    throw Error('missing ' + type);
  }
  const send = (m: unknown) => ws.send(JSON.stringify(m));
  try {
    await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    send({ type: 'hello', version: 1, deviceId: 'test', bootId: 'f'.repeat(32) });
    const challenge = await wait('challenge'); send({ type: 'auth', proof: authProof(secret, challenge.challenge) });
    assert.equal((await wait('bound')).sessions[0].id, 'session-1');
    send({ type: 'select', sessionId: 'session-1' }); await wait('selected');
    send({ type: 'begin', id: 1 }); await wait('state');
    send({ type: 'select', sessionId: 'session-2' }); assert.equal((await wait('error')).code, 'recording_locked');
    const frame = Buffer.alloc(652); frame.write('MTA1'); frame.writeUInt32LE(1, 4);
    for (let i = 0; i < 10; i++) { frame.writeUInt32LE(i, 8); ws.send(frame); }
    await delay(50); assert.equal(submissions, 0);
    send({ type: 'cancel' }); await wait('state'); await delay(30); assert.equal(submissions, 0);
    send({ type: 'select', sessionId: 'session-2' }); await wait('selected');
    send({ type: 'begin', id: 2 });
    frame.writeUInt32LE(2, 4);
    for (let i = 0; i < 10; i++) { frame.writeUInt32LE(i, 8); ws.send(frame); }
    send({ type: 'commit', id: 2, frames: 10 });
    assert.equal((await wait('reply')).text, '中文回复'); assert.equal(submissions, 1);
    // Reusing the same boot/input identity must not submit a second native task.
    send({ type: 'begin', id: 2 });
    for (let i = 0; i < 10; i++) { frame.writeUInt32LE(i, 8); ws.send(frame); }
    send({ type: 'commit', id: 2, frames: 10 }); await delay(100); assert.equal(submissions, 1);
  } finally { ws.terminate(); await bridge.close(); await rm(root, { recursive: true, force: true }); }
});
