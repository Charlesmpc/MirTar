import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { BleAssembler, fragmentBle } from '../src/transport/ble-framing.ts';
import { startBridge } from '../src/server.ts';
import { authProof } from '../src/protocol.ts';
import type { AgentAdapter, BridgeConfig } from '../src/contracts.ts';

class FakeGattPeer extends EventEmitter {
  readyState = 1; bufferedAmount = 0;
  incoming = new BleAssembler(); outgoing = new BleAssembler();
  tx = 0; rx = 0; messages: any[] = [];
  send(text: string) {
    for (const packet of fragmentBle(Buffer.from(text), false, this.tx++, 20)) {
      const result = this.outgoing.append(packet); if (result) this.messages.push(JSON.parse(result.data.toString()));
    }
  }
  receive(data: Buffer, binary = false) {
    for (const packet of fragmentBle(data, binary, this.rx++, 244)) {
      const result = this.incoming.append(packet); if (result) this.emit('message', result.data, result.binary);
    }
  }
  control(value: unknown) { this.receive(Buffer.from(JSON.stringify(value))); }
  close() { if (this.readyState === 3) return; this.readyState = 3; this.emit('close'); }
  terminate() { this.close(); }
  ping() { this.emit('pong'); }
  async wait(type: string) {
    for (let n = 0; n < 500; n++) {
      const i = this.messages.findIndex(m => m.type === type);
      if (i >= 0) return this.messages.splice(i, 1)[0]; await delay(10);
    }
    throw Error('missing ' + type);
  }
}
test('fragmented BLE uses shared authentication, audio and native-session reply path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mirtar-ble-')), secret = 'a'.repeat(64);
  let input = '', submissions = 0;
  const adapter: AgentAdapter = {
    id: 'ble-test', sessions: async () => [{ id: 'native', name: 'desktop session' }],
    history: async () => input ? [{ turnId: 'reply', text: '同一会话的回复', completed: true, inputId: input }] : [],
    beginAudio: (id, signal) => { let bytes = 0; return {
      append: pcm => { signal.throwIfAborted(); bytes += pcm.length; },
      commit: async clientId => { signal.throwIfAborted(); assert.equal(id, 'native'); assert.equal(bytes, 6400); input = clientId; submissions++; return { submissionId: 'accepted' }; },
    }; },
    close: async () => {},
  };
  const config: BridgeConfig = { version: 1, listen: { host: '127.0.0.1', port: 0, allowLanPlaintext: true },
    devices: [{ id: 'badge', secret }], codex: { bin: '', edgePath: '', sessions: [] } };
  const bridge = await startBridge(config, adapter, root); const peer = new FakeGattPeer();
  try {
    bridge.acceptPeer(peer);
    peer.control({ type: 'hello', version: 1, deviceId: 'badge', bootId: 'b'.repeat(32) });
    const { challenge } = await peer.wait('challenge'); peer.control({ type: 'auth', proof: authProof(secret, challenge) });
    assert.equal((await peer.wait('bound')).sessions[0].id, 'native');
    peer.control({ type: 'select', sessionId: 'native' }); await peer.wait('selected');
    peer.control({ type: 'begin', id: 1 });
    const frame = Buffer.alloc(652); frame.write('MTA1'); frame.writeUInt32LE(1, 4);
    for (let n = 0; n < 10; n++) { frame.writeUInt32LE(n, 8); peer.receive(frame, true); }
    await delay(20); assert.equal(submissions, 0);
    peer.control({ type: 'commit', id: 1, frames: 10 });
    assert.equal((await peer.wait('reply')).text, '同一会话的回复'); assert.equal(submissions, 1);
    // A second transport may not attach the same device concurrently.
    const other = new FakeGattPeer(); bridge.acceptPeer(other);
    other.control({ type: 'hello', version: 1, deviceId: 'badge', bootId: 'c'.repeat(32) });
    await other.wait('error'); assert.equal(other.readyState, 3);
  } finally { peer.close(); await bridge.close(); await rm(root, { recursive: true, force: true }); }
});

test('workspace setup failures reach an authenticated card and cannot start audio', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mirtar-workspace-protocol-')), secret = 'a'.repeat(64);
  let initial = true, starts = 0;
  const adapter: AgentAdapter = {
    id: 'workspace-test', sessions: async () => initial ? [] : [{ id: 'project', name: 'Project' }],
    setupError: () => initial ? 'session_workspace_unavailable' : undefined,
    activateSession: async () => { throw Error('session_workspace_unavailable'); },
    history: async () => [], beginAudio() { starts++; throw Error('must not record'); }, close: async () => {},
  };
  const config: BridgeConfig = { version: 1, listen: { host: '127.0.0.1', port: 0, allowLanPlaintext: true },
    devices: [{ id: 'badge', secret }], codex: { bin: '', edgePath: '', sessions: [] } };
  const bridge = await startBridge(config, adapter, root), peers: FakeGattPeer[] = [];
  async function connect() {
    const peer = new FakeGattPeer(); peers.push(peer); bridge.acceptPeer(peer);
    peer.control({ type: 'hello', version: 1, deviceId: 'badge', bootId: 'b'.repeat(32) });
    const { challenge } = await peer.wait('challenge'); peer.control({ type: 'auth', proof: authProof(secret, challenge) });
    return peer;
  }
  try {
    let peer = await connect(); assert.deepEqual((await peer.wait('bound')).sessions, []);
    assert.equal((await peer.wait('error')).code, 'session_workspace_unavailable'); peer.close();
    initial = false; peer = await connect(); await peer.wait('bound');
    peer.control({ type: 'select', sessionId: 'project' });
    const error = await peer.wait('error'); assert.equal(error.code, 'session_workspace_unavailable'); assert.equal(error.sessionId, 'project');
    peer.control({ type: 'begin', id: 1 }); await peer.wait('error'); assert.equal(starts, 0);
  } finally { for (const peer of peers) peer.close(); await bridge.close(); await rm(root, { recursive: true, force: true }); }
});
