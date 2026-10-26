import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { CodexRpc } from '../src/codex/rpc.ts';
function fixture() {
  const written: any[] = [], child = new EventEmitter() as ChildProcessWithoutNullStreams;
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.stdin = new Writable({ write(data, _encoding, callback) { written.push(JSON.parse(data.toString())); callback(); } });
  child.kill = () => { child.stdout.destroy(); child.stderr.destroy(); child.emit('exit', 0); return true; };
  const rpc = new CodexRpc('', { child });
  return { rpc, written, push(m: any) { (child.stdout as PassThrough).write(JSON.stringify(m) + '\n'); } };
}
test('server question ID collision never resolves a client RPC; responses retain the original ID and are single use', async () => {
  const f = fixture(); let resolved = false, incoming: any;
  f.rpc.on('request', r => { incoming = r; });
  try {
    const response = f.rpc.request('thread/read', {}, 1000).then(r => { resolved = true; return r; });
    f.push({ id: 1, method: 'item/tool/requestUserInput', params: { questions: [] } }); await delay(0);
    assert.equal(incoming.id, 1); assert.equal(resolved, false);
    await f.rpc.respond(1, { answers: {} }); assert.deepEqual(f.written.at(-1), { id: 1, result: { answers: {} } });
    await assert.rejects(f.rpc.respond(1, {}), /question_expired/);
    f.push({ id: 1, result: { thread: 'expected' } }); assert.deepEqual(await response, { thread: 'expected' });
  } finally { f.rpc.close(); }
});
test('resolved questions cannot be answered later, and unsupported approvals never receive approval', async () => {
  const f = fixture();
  try {
    f.push({ id: 'approval', method: 'item/commandExecution/requestApproval', params: {} }); await delay(0);
    assert.equal(f.written.at(-1).error.code, -32601); assert.equal(f.written.at(-1).result, undefined);
    f.rpc.on('request', () => {}); f.push({ id: 'question', method: 'item/tool/requestUserInput', params: {} });
    f.push({ method: 'serverRequest/resolved', params: { requestId: 'question' } }); await delay(0);
    await assert.rejects(f.rpc.respond('question', {}), /question_expired/);
  } finally { f.rpc.close(); }
});
