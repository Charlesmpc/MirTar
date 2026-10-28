import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { CodexAdapter } from '../src/codex/adapter.ts';

function fixture() {
  const rpc = new EventEmitter() as EventEmitter & { initialize(): Promise<void>; request(method: string, p: any): Promise<any>; close(): void;
    respond(id: string | number, result: any): Promise<void>; rejectRequest(id: string | number): Promise<void> };
  const calls: any[] = [], responses: any[] = [], rejected: any[] = []; let final = false;
  rpc.initialize = async () => {}; rpc.close = () => {};
  rpc.respond = async (id, result) => { responses.push({ id, result }); };
  rpc.rejectRequest = async id => { rejected.push(id); };
  rpc.request = async (method, p) => {
    calls.push({ method, p });
    if (method === 'thread/loaded/list') return { data: [] };
    if (method === 'thread/resume') return { thread: { id: p.threadId } };
    if (method === 'turn/start') {
      rpc.emit('notification', 'turn/started', { threadId: p.threadId, turn: { id: 'turn-a' } });
      rpc.emit('request', { id: 1, method: 'item/tool/call', params: { threadId: p.threadId, turnId: 'turn-a', callId: 'call-a', tool: 'mirtar_ask_user', namespace: null,
        arguments: { questions: [{ id: 'word', question: 'Test word?' }] } } });
      return { turn: { id: 'turn-a' } };
    }
    if (method === 'thread/turns/list') return { data: final ? [{ id: 'turn-a', status: 'completed', items: [{ type: 'agentMessage', text: 'DONE' }] }] : [] };
    throw Error('unexpected RPC');
  };
  const adapter = new CodexAdapter({ bin: '', edgePath: '', sessions: [{ id: 'session-a', name: 'Card', execution: 'bridge', cwd: tmpdir() }] },
    { async openWebRtc() { throw Error('unused'); } }, { rpc, transcribe: async (_bin, _media, input) => { for await (const _ of input) {} return 'ORBIT'; } });
  return { rpc, calls, responses, rejected, adapter, complete() { final = true; rpc.emit('notification', 'turn/completed', { threadId: 'session-a', turn: { id: 'turn-a', status: 'completed' } }); } };
}
test('managed mode drives a real turn, replies to its question through audio, and never queues a new desktop message', async () => {
  const f = fixture();
  try {
    await f.adapter.submitText('session-a', 'Task', 'original-input', new AbortController().signal);
    f.rpc.emit('notification','turn/completed',{threadId:'session-a',turn:{id:'old-turn',status:'completed'}});
    assert.equal(f.adapter.activity('session-a')?.state, 'running'); const q = f.adapter.question('session-a')!; assert.ok(q);
    assert.throws(() => f.adapter.beginAudio('session-a', new AbortController().signal), /busy/);
    const audio = f.adapter.beginAnswerAudio('session-a', q, new AbortController().signal); audio.append(Buffer.alloc(640));
    await audio.commit('answer-input', () => {});
    assert.deepEqual(f.responses, [{ id: 1, result: { success: true, contentItems: [{ type: 'inputText', text: JSON.stringify({ answers: { word: { answers: ['ORBIT'] } }, skipped: false }) }] } }]);
    assert.equal(f.calls.filter(c => c.method === 'turn/start').length, 1); assert.equal(f.calls.filter(c => c.method === 'thread/queue/add').length, 0);
    f.complete(); assert.equal(f.adapter.question('session-a'), undefined); assert.equal(f.adapter.activity('session-a')?.state, 'completed');
    assert.deepEqual(await f.adapter.history('session-a'), [{ turnId: 'turn-a', completed: true, inputId: 'original-input', text: 'DONE' }]);
  } finally { await f.adapter.close(); }
});
test('failed session ownership never falls back to the desktop queue or creates a replacement session', async () => {
  const f=fixture(); const original=f.rpc.request;
  f.rpc.request=async(method,p)=>{if(method==='thread/resume')throw Error('writer is busy');return original(method,p);};
  try{await assert.rejects(f.adapter.submitText('session-a','Task','input',new AbortController().signal),/writer is busy/);
    assert.equal(f.calls.filter(c=>c.method==='turn/start'||c.method==='thread/start'||c.method==='thread/queue/add').length,0);
  }finally{await f.adapter.close();}
});
test('late or foreign requests and permission approvals are rejected; resolved questions cannot consume finished ASR', async () => {
  const f = fixture();
  try {
    await f.adapter.submitText('session-a', 'Task', 'input', new AbortController().signal);
    for (const [id, method, p] of [[2, 'item/commandExecution/requestApproval', { threadId: 'session-a', turnId: 'turn-a' }],
      [3, 'item/tool/requestUserInput', { threadId: 'unallowed', turnId: 'turn-a' }],
      [4, 'item/tool/requestUserInput', { threadId: 'session-a', turnId: 'old-turn' }]] as const)
      f.rpc.emit('request', { id, method, params: p });
    assert.deepEqual(f.rejected, [2, 3, 4]);
    const q = f.adapter.question('session-a')!, audio = f.adapter.beginAnswerAudio('session-a', q, new AbortController().signal);
    audio.append(Buffer.alloc(640)); f.rpc.emit('notification', 'serverRequest/resolved', { threadId: 'session-a', requestId: 1 });
    await assert.rejects(audio.commit('late-answer', () => {}), /question_expired/); assert.equal(f.responses.length, 0);
    f.rpc.emit('unavailable'); assert.equal(f.adapter.activity('session-a')?.state, 'interrupted');
  } finally { await f.adapter.close(); }
});
