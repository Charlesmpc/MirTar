import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { attachWindowsBleWorker } from '../src/transport/windows-ble.ts';
import { fragmentBle } from '../src/transport/ble-framing.ts';
import type { DevicePeer } from '../src/transport/peer.ts';

function fixture() {
  const process = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: 0,
  });
  const accepted: DevicePeer[] = [], commands: any[] = [];
  process.stdin.on('data', data => { for (const line of String(data).trim().split('\n')) commands.push(JSON.parse(line)); });
  const transport = attachWindowsBleWorker(process as unknown as ChildProcessWithoutNullStreams, peer => accepted.push(peer));
  const emit = (value: unknown) => process.stdout.write(JSON.stringify(value) + '\n');
  const connect = (connectionId: number) => emit({ type: 'connected', connectionId, valueSize: 20 });
  const packet = (connectionId: number, text: string) => {
    for (const p of fragmentBle(Buffer.from(text), false, 0, 20)) emit({ type: 'packet', connectionId, data: p.toString('base64') });
  };
  return { accepted, commands, transport, emit, connect, packet };
}

test('discovery and subscribe retries do not expose an application peer', async () => {
  const f = fixture();
  try {
    f.emit({ type: 'status', code: 'subscribe_retry_1' });
    assert.equal(f.accepted.length, 0);
    f.connect(1); const packets: string[] = [];
    f.accepted[0].on('message', bytes => packets.push(bytes.toString()));
    f.packet(1, 'buffered hello');
    assert.deepEqual(packets, ['buffered hello']);
  } finally { await f.transport.close(); }
});

test('late callbacks and duplicate readiness cannot replace or close a new connection', async () => {
  const f = fixture();
  try {
    f.connect(1); const old = f.accepted[0];
    f.connect(2); const current = f.accepted[1];
    let messages = 0, pongs = 0;
    current.on('message', () => messages++); current.on('pong', () => pongs++);
    assert.equal(old.readyState, 3);
    f.emit({ type: 'disconnected', connectionId: 1 });
    f.emit({ type: 'pong', connectionId: 1 });
    f.packet(1, 'old hello'); f.connect(2); f.connect(1);
    old.close(); old.ping();
    assert.equal(current.readyState, 1); assert.equal(f.accepted.length, 2);
    assert.equal(messages, 0); assert.equal(pongs, 0); assert.equal(f.commands.length, 0);
    f.packet(2, 'new hello'); f.emit({ type: 'pong', connectionId: 2 });
    assert.equal(messages, 1); assert.equal(pongs, 1);
    current.ping(); assert.deepEqual(f.commands.pop(), { type: 'ping', connectionId: 2 });
    f.emit({ type: 'disconnected', connectionId: 2 }); assert.equal(current.readyState, 3);
  } finally { await f.transport.close(); }
});

test('a write acknowledgement from an old connection cannot release a new write', async () => {
  const f = fixture();
  try {
    f.connect(1); f.accepted[0].send('old'); await delay(5);
    assert.equal(f.commands[0].connectionId, 1);
    f.connect(2); f.accepted[1].send('new message long enough for two packets'); await delay(5);
    const first = f.commands.at(-1);
    assert.equal(first.connectionId, 2);
    const count = f.commands.length;
    f.emit({ type: 'written', connectionId: 1, id: first.id }); await delay(5);
    assert.equal(f.commands.length, count);
    f.emit({ type: 'written', connectionId: 2, id: first.id }); await delay(5);
    assert.equal(f.commands.length, count + 1);
    assert.equal(f.commands.at(-1).connectionId, 2);
    f.emit({ type: 'disconnected', connectionId: 2 }); await delay(5);
  } finally { await f.transport.close(); }
});
